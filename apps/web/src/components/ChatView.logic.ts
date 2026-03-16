import {
  ProjectId,
  type ProviderKind,
  type ServerProviderCatalog,
  type ThreadId,
} from "@t3tools/contracts";
import { type ChatMessage, type Thread } from "../types";
import { randomUUID } from "~/lib/utils";
import { getAppModelOptions } from "../appSettings";
import { type ComposerImageAttachment, type DraftThreadState } from "../composerDraftStore";
import { Schema } from "effect";
import { normalizeModelSlug } from "@t3tools/shared/model";

export const LAST_INVOKED_SCRIPT_BY_PROJECT_KEY = "t3code:last-invoked-script-by-project";
const WORKTREE_BRANCH_PREFIX = "t3code";

export const LastInvokedScriptByProjectSchema = Schema.Record(ProjectId, Schema.String);

export function buildLocalDraftThread(
  threadId: ThreadId,
  draftThread: DraftThreadState,
  fallbackModel: string,
  error: string | null,
): Thread {
  return {
    id: threadId,
    codexThreadId: null,
    projectId: draftThread.projectId,
    title: "New thread",
    provider: "codex",
    model: fallbackModel,
    runtimeMode: draftThread.runtimeMode,
    interactionMode: draftThread.interactionMode,
    session: null,
    messages: [],
    error,
    createdAt: draftThread.createdAt,
    latestTurn: null,
    lastVisitedAt: draftThread.createdAt,
    branch: draftThread.branch,
    worktreePath: draftThread.worktreePath,
    turnDiffSummaries: [],
    activities: [],
    proposedPlans: [],
  };
}

export function revokeBlobPreviewUrl(previewUrl: string | undefined): void {
  if (!previewUrl || typeof URL === "undefined" || !previewUrl.startsWith("blob:")) {
    return;
  }
  URL.revokeObjectURL(previewUrl);
}

export function revokeUserMessagePreviewUrls(message: ChatMessage): void {
  if (message.role !== "user" || !message.attachments) {
    return;
  }
  for (const attachment of message.attachments) {
    if (attachment.type !== "image") {
      continue;
    }
    revokeBlobPreviewUrl(attachment.previewUrl);
  }
}

export function collectUserMessageBlobPreviewUrls(message: ChatMessage): string[] {
  if (message.role !== "user" || !message.attachments) {
    return [];
  }
  const previewUrls: string[] = [];
  for (const attachment of message.attachments) {
    if (attachment.type !== "image") continue;
    if (!attachment.previewUrl || !attachment.previewUrl.startsWith("blob:")) continue;
    previewUrls.push(attachment.previewUrl);
  }
  return previewUrls;
}

export type SendPhase = "idle" | "preparing-worktree" | "sending-turn";

export interface PullRequestDialogState {
  initialReference: string | null;
  key: number;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Could not read image data."));
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Failed to read image."));
    });
    reader.readAsDataURL(file);
  });
}

export function buildTemporaryWorktreeBranchName(): string {
  // Keep the 8-hex suffix shape for backend temporary-branch detection.
  const token = randomUUID().slice(0, 8).toLowerCase();
  return `${WORKTREE_BRANCH_PREFIX}/${token}`;
}

export function cloneComposerImageForRetry(
  image: ComposerImageAttachment,
): ComposerImageAttachment {
  if (typeof URL === "undefined" || !image.previewUrl.startsWith("blob:")) {
    return image;
  }
  try {
    return {
      ...image,
      previewUrl: URL.createObjectURL(image.file),
    };
  } catch {
    return image;
  }
}

export function getCustomModelOptionsByProvider(settings: {
  customCodexModels: readonly string[];
  customCursorModels: readonly string[];
  customOpenCodeModels: readonly string[];
  customClaudeModels: readonly string[];
  customGeminiModels: readonly string[];
}): Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>> {
  return {
    codex: getAppModelOptions("codex", settings.customCodexModels),
    cursor: getAppModelOptions("cursor", settings.customCursorModels),
    opencode: getAppModelOptions("opencode", settings.customOpenCodeModels),
    claude: getAppModelOptions("claude", settings.customClaudeModels),
    gemini: getAppModelOptions("gemini", settings.customGeminiModels),
  };
}

export function mergeProviderModelOptionsByProvider(
  baseOptionsByProvider: Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>>,
  inspectedProviders: ReadonlyArray<Pick<ServerProviderCatalog, "provider" | "models">>,
): Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>> {
  const mergedByProvider: Record<ProviderKind, Array<{ slug: string; name: string }>> = {
    codex: [],
    cursor: [],
    opencode: [],
    claude: [],
    gemini: [],
  };

  for (const providerCatalog of inspectedProviders) {
    for (const model of providerCatalog.models) {
      const normalizedSlug = normalizeModelSlug(model.slug, providerCatalog.provider);
      if (!normalizedSlug) {
        continue;
      }
      mergedByProvider[providerCatalog.provider].push({
        slug: normalizedSlug,
        name: model.name,
      });
    }
  }

  for (const provider of Object.keys(baseOptionsByProvider) as ProviderKind[]) {
    mergedByProvider[provider].push(...baseOptionsByProvider[provider]);
  }

  const dedupedByProvider = { ...mergedByProvider } as Record<
    ProviderKind,
    ReadonlyArray<{ slug: string; name: string }>
  >;
  for (const provider of Object.keys(mergedByProvider) as ProviderKind[]) {
    const seen = new Set<string>();
    dedupedByProvider[provider] = mergedByProvider[provider].filter((option) => {
      if (seen.has(option.slug)) {
        return false;
      }
      seen.add(option.slug);
      return true;
    });
  }

  return dedupedByProvider;
}
