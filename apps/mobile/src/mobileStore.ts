import {
  ApprovalRequestId,
  CommandId,
  DEFAULT_MODEL_BY_PROVIDER,
  MessageId,
  type ModelSlug,
  type OrchestrationReadModel,
  ProjectId,
  type ProviderKind,
  type ServerConfig,
  ThreadId,
  TurnId,
  type ProviderApprovalDecision,
  type ServerConnectionProfileImport,
} from "@t3tools/contracts";
import { toSortedCompat } from "@t3tools/shared/array";
import { normalizeServerConnectionUrl } from "@t3tools/shared/connectionProfile";
import { parseMobilePairingLink } from "@t3tools/shared/mobilePairing";
import { AppState } from "react-native";
import { create } from "zustand";

import { createStableId, currentIsoTimestamp, inferProjectTitleFromPath } from "./lib/ids";
import { sendLocalNotification } from "./lib/notifications";
import { buildPendingUserInputAnswers } from "./lib/pendingRequests";
import type {
  GitStatusInfo,
  MobileConnectionPhase,
  MobilePersistedState,
  MobileServerProfile,
  NotificationSettings,
  PendingUserInputDraftAnswer,
  PendingUserInputDraftsByThreadId,
} from "./mobileTypes";
import { DEFAULT_NOTIFICATION_SETTINGS } from "./mobileTypes";
import { MobileServerRuntime } from "./mobileRuntime";
import { readPersistedMobileState, writePersistedMobileState } from "./storage/mobileStorage";

interface MobileAppStore extends MobilePersistedState {
  readonly loaded: boolean;
  readonly connectionPhase: MobileConnectionPhase;
  readonly connectionError: string | null;
  readonly readModel: OrchestrationReadModel | null;
  readonly serverConfig: ServerConfig | null;
  readonly pendingImport: ServerConnectionProfileImport | null;
  readonly drawerOpen: boolean;
  readonly pendingUserInputDraftsByThreadId: PendingUserInputDraftsByThreadId;
  readonly refreshing: boolean;
  readonly gitStatusByProjectId: Record<string, GitStatusInfo>;
  readonly hydrate: () => Promise<void>;
  readonly setDrawerOpen: (open: boolean) => void;
  readonly setPendingImport: (payload: ServerConnectionProfileImport | null) => void;
  readonly importPairingLink: (url: string) => Promise<void>;
  readonly connectProfile: (profileId: string) => Promise<void>;
  readonly upsertImportedProfile: (payload: ServerConnectionProfileImport) => Promise<void>;
  readonly upsertManualProfile: (input: {
    readonly label: string;
    readonly serverUrl: string;
    readonly authToken: string;
  }) => Promise<void>;
  readonly disconnect: () => Promise<void>;
  readonly removeProfile: (profileId: string) => Promise<void>;
  readonly setDraft: (threadId: string, text: string) => Promise<void>;
  readonly rememberProject: (projectId: string) => Promise<void>;
  readonly rememberThread: (threadId: string) => Promise<void>;
  readonly createThread: (
    projectId: string,
    provider?: ProviderKind,
    model?: ModelSlug,
  ) => Promise<void>;
  readonly addProject: (workspaceRoot: string) => Promise<void>;
  readonly sendMessage: (threadId: string, text: string) => Promise<void>;
  readonly interruptThread: (threadId: string, turnId?: string) => Promise<void>;
  readonly respondApproval: (
    threadId: string,
    requestId: string,
    decision: ProviderApprovalDecision,
  ) => Promise<void>;
  readonly setPendingUserInputDraft: (
    threadId: string,
    questionId: string,
    draft: PendingUserInputDraftAnswer,
  ) => void;
  readonly respondUserInput: (
    threadId: string,
    requestId: string,
    answers: Record<string, string>,
  ) => Promise<void>;
  readonly refreshSnapshot: () => Promise<void>;
  readonly deleteThread: (threadId: string) => Promise<void>;
  readonly renameThread: (threadId: string, title: string) => Promise<void>;
  readonly deleteProject: (projectId: string) => Promise<void>;
  readonly renameProject: (projectId: string, title: string) => Promise<void>;
  readonly setPreferredProvider: (provider: ProviderKind) => Promise<void>;
  readonly setPreferredModel: (model: ModelSlug | null) => Promise<void>;
  readonly setNotificationSettings: (settings: Partial<NotificationSettings>) => Promise<void>;
  readonly fetchGitStatus: (projectId: string) => Promise<void>;
}

let activeRuntime: MobileServerRuntime | null = null;

function disposeActiveRuntime(): void {
  activeRuntime?.dispose();
  activeRuntime = null;
}

async function persistStoreState(
  nextState: Pick<
    MobileAppStore,
    | "profiles"
    | "activeProfileId"
    | "draftsByServerUrl"
    | "lastOpenedProjectIdByServerUrl"
    | "lastOpenedThreadIdByServerUrl"
    | "notificationSettings"
    | "preferredProvider"
    | "preferredModel"
  >,
  previousProfiles: readonly MobileServerProfile[] = [],
): Promise<void> {
  await writePersistedMobileState(
    {
      profiles: nextState.profiles,
      activeProfileId: nextState.activeProfileId,
      draftsByServerUrl: nextState.draftsByServerUrl,
      lastOpenedProjectIdByServerUrl: nextState.lastOpenedProjectIdByServerUrl,
      lastOpenedThreadIdByServerUrl: nextState.lastOpenedThreadIdByServerUrl,
      notificationSettings: nextState.notificationSettings,
      preferredProvider: nextState.preferredProvider,
      preferredModel: nextState.preferredModel,
    },
    previousProfiles,
  );
}

function getActiveProfile(
  state: Pick<MobileAppStore, "profiles" | "activeProfileId">,
): MobileServerProfile | null {
  return state.profiles.find((profile) => profile.id === state.activeProfileId) ?? null;
}

function nextCommandId(): CommandId {
  return CommandId.makeUnsafe(createStableId());
}

function normalizeCandidateProfile(
  profiles: readonly MobileServerProfile[],
  input: {
    readonly label: string;
    readonly serverUrl: string;
    readonly authToken: string;
  },
): MobileServerProfile {
  const label = input.label.trim();
  if (label.length === 0) {
    throw new Error("Enter a profile label.");
  }
  const parsed = normalizeServerConnectionUrl(input.serverUrl);
  if (!parsed.ok || !parsed.normalizedUrl) {
    throw new Error(parsed.error ?? "Enter a valid server URL.");
  }

  const existing = profiles.find((profile) => profile.serverUrl === parsed.normalizedUrl);
  const timestamp = currentIsoTimestamp();

  return {
    id: existing?.id ?? createStableId(),
    label,
    serverUrl: parsed.normalizedUrl,
    authToken: input.authToken.trim(),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}

function getCurrentPersistFields(get: () => MobileAppStore) {
  return {
    profiles: get().profiles,
    activeProfileId: get().activeProfileId,
    draftsByServerUrl: get().draftsByServerUrl,
    lastOpenedProjectIdByServerUrl: get().lastOpenedProjectIdByServerUrl,
    lastOpenedThreadIdByServerUrl: get().lastOpenedThreadIdByServerUrl,
    notificationSettings: get().notificationSettings,
    preferredProvider: get().preferredProvider,
    preferredModel: get().preferredModel,
  };
}

async function connectWithProfile(profile: MobileServerProfile): Promise<void> {
  disposeActiveRuntime();
  const runtime = new MobileServerRuntime(profile, {
    onReady: ({ snapshot, serverConfig }) => {
      useMobileAppStore.setState({
        connectionPhase: "ready",
        connectionError: null,
        readModel: snapshot,
        serverConfig,
      });
    },
    onFailure: (message) => {
      useMobileAppStore.setState({
        connectionPhase: "failed",
        connectionError: message,
      });
    },
    onDomainEvent: (event) => {
      const state = useMobileAppStore.getState();
      const isBackground = AppState.currentState !== "active";
      if (!isBackground) return;

      const settings = state.notificationSettings;
      const eventType = (event as { type?: string }).type;

      if (eventType === "thread.approval-requested") {
        const threadId = (event as { threadId?: string }).threadId;
        const thread = state.readModel?.threads.find((t) => t.id === threadId);
        void sendLocalNotification(
          "approval",
          "Approval needed",
          thread ? `Action required in "${thread.title}"` : "A thread requires approval.",
          settings,
          { threadId },
        );
      } else if (eventType === "thread.user-input-requested") {
        const threadId = (event as { threadId?: string }).threadId;
        const thread = state.readModel?.threads.find((t) => t.id === threadId);
        void sendLocalNotification(
          "user-input",
          "Input needed",
          thread ? `Input required in "${thread.title}"` : "A thread requires input.",
          settings,
          { threadId },
        );
      } else if (eventType === "thread.errored") {
        const threadId = (event as { threadId?: string }).threadId;
        const thread = state.readModel?.threads.find((t) => t.id === threadId);
        void sendLocalNotification(
          "error",
          "Thread error",
          thread ? `Error in "${thread.title}"` : "A thread encountered an error.",
          settings,
          { threadId },
        );
      } else if (eventType === "thread.turn-completed") {
        const threadId = (event as { threadId?: string }).threadId;
        const thread = state.readModel?.threads.find((t) => t.id === threadId);
        void sendLocalNotification(
          "turn-completed",
          "Turn completed",
          thread ? `Turn finished in "${thread.title}"` : "A turn has completed.",
          settings,
          { threadId },
        );
      }
    },
  });
  useMobileAppStore.setState({
    connectionPhase: "connecting",
    connectionError: null,
    readModel: null,
    serverConfig: null,
  });
  await runtime.start();
  activeRuntime = runtime;
}

export const useMobileAppStore = create<MobileAppStore>((set, get) => ({
  loaded: false,
  profiles: [],
  activeProfileId: null,
  draftsByServerUrl: {},
  lastOpenedProjectIdByServerUrl: {},
  lastOpenedThreadIdByServerUrl: {},
  notificationSettings: DEFAULT_NOTIFICATION_SETTINGS,
  preferredProvider: "codex" as ProviderKind,
  preferredModel: null,
  connectionPhase: "idle",
  connectionError: null,
  readModel: null,
  serverConfig: null,
  pendingImport: null,
  drawerOpen: false,
  pendingUserInputDraftsByThreadId: {},
  refreshing: false,
  gitStatusByProjectId: {},
  hydrate: async () => {
    const persisted = await readPersistedMobileState();
    set({
      loaded: true,
      profiles: persisted.profiles,
      activeProfileId: persisted.activeProfileId,
      draftsByServerUrl: persisted.draftsByServerUrl,
      lastOpenedProjectIdByServerUrl: persisted.lastOpenedProjectIdByServerUrl,
      lastOpenedThreadIdByServerUrl: persisted.lastOpenedThreadIdByServerUrl,
      notificationSettings: persisted.notificationSettings,
      preferredProvider: persisted.preferredProvider,
      preferredModel: persisted.preferredModel,
    });
    if (persisted.activeProfileId) {
      await get().connectProfile(persisted.activeProfileId);
    }
  },
  setDrawerOpen: (open) => set({ drawerOpen: open }),
  setPendingImport: (payload) => set({ pendingImport: payload }),
  importPairingLink: async (url) => {
    set({ pendingImport: parseMobilePairingLink(url) });
  },
  connectProfile: async (profileId) => {
    const profile = get().profiles.find((entry) => entry.id === profileId);
    if (!profile) {
      throw new Error("Selected server profile was not found.");
    }
    await connectWithProfile(profile);
    const previousProfiles = get().profiles;
    set({ activeProfileId: profile.id });
    await persistStoreState(
      { ...getCurrentPersistFields(get), activeProfileId: profile.id },
      previousProfiles,
    );
  },
  upsertImportedProfile: async (payload) => {
    const previousProfiles = get().profiles;
    const profile = normalizeCandidateProfile(previousProfiles, payload);
    await connectWithProfile(profile);
    const nextProfiles = toSortedCompat(
      [
        ...previousProfiles.filter(
          (entry) => entry.id !== profile.id && entry.serverUrl !== profile.serverUrl,
        ),
        profile,
      ],
      (left, right) => left.label.localeCompare(right.label),
    );
    set({
      profiles: nextProfiles,
      activeProfileId: profile.id,
      pendingImport: null,
    });
    await persistStoreState(
      {
        ...getCurrentPersistFields(get),
        profiles: nextProfiles,
        activeProfileId: profile.id,
      },
      previousProfiles,
    );
  },
  upsertManualProfile: async (input) => {
    await get().upsertImportedProfile({
      version: 1,
      label: input.label,
      serverUrl: input.serverUrl,
      authToken: input.authToken,
    });
  },
  disconnect: async () => {
    disposeActiveRuntime();
    const previousProfiles = get().profiles;
    set({
      activeProfileId: null,
      connectionPhase: "idle",
      connectionError: null,
      readModel: null,
      serverConfig: null,
      drawerOpen: false,
      gitStatusByProjectId: {},
    });
    await persistStoreState(
      { ...getCurrentPersistFields(get), activeProfileId: null },
      previousProfiles,
    );
  },
  removeProfile: async (profileId) => {
    const previousProfiles = get().profiles;
    const nextProfiles = previousProfiles.filter((profile) => profile.id !== profileId);
    const isActive = get().activeProfileId === profileId;
    if (isActive) {
      disposeActiveRuntime();
    }
    set({
      profiles: nextProfiles,
      activeProfileId: isActive ? null : get().activeProfileId,
      connectionPhase: isActive ? "idle" : get().connectionPhase,
      connectionError: isActive ? null : get().connectionError,
      readModel: isActive ? null : get().readModel,
      serverConfig: isActive ? null : get().serverConfig,
    });
    await persistStoreState(
      {
        ...getCurrentPersistFields(get),
        profiles: nextProfiles,
        activeProfileId: isActive ? null : get().activeProfileId,
      },
      previousProfiles,
    );
  },
  setDraft: async (threadId, text) => {
    const activeProfile = getActiveProfile(get());
    if (!activeProfile) {
      return;
    }
    const nextDraftsByServerUrl = {
      ...get().draftsByServerUrl,
      [activeProfile.serverUrl]: {
        ...get().draftsByServerUrl[activeProfile.serverUrl],
        [threadId]: text,
      },
    };
    set({ draftsByServerUrl: nextDraftsByServerUrl });
    await persistStoreState(
      { ...getCurrentPersistFields(get), draftsByServerUrl: nextDraftsByServerUrl },
      get().profiles,
    );
  },
  rememberProject: async (projectId) => {
    const activeProfile = getActiveProfile(get());
    if (!activeProfile) {
      return;
    }
    const next = {
      ...get().lastOpenedProjectIdByServerUrl,
      [activeProfile.serverUrl]: projectId,
    };
    set({ lastOpenedProjectIdByServerUrl: next });
    await persistStoreState(
      { ...getCurrentPersistFields(get), lastOpenedProjectIdByServerUrl: next },
      get().profiles,
    );
  },
  rememberThread: async (threadId) => {
    const activeProfile = getActiveProfile(get());
    if (!activeProfile) {
      return;
    }
    const next = {
      ...get().lastOpenedThreadIdByServerUrl,
      [activeProfile.serverUrl]: threadId,
    };
    set({ lastOpenedThreadIdByServerUrl: next });
    await persistStoreState(
      { ...getCurrentPersistFields(get), lastOpenedThreadIdByServerUrl: next },
      get().profiles,
    );
  },
  createThread: async (projectId, provider, model) => {
    const project = get().readModel?.projects.find((entry) => entry.id === projectId);
    if (!project || !activeRuntime) {
      return;
    }
    const resolvedProvider = provider ?? get().preferredProvider;
    const resolvedModel =
      model ??
      get().preferredModel ??
      project.defaultModel ??
      DEFAULT_MODEL_BY_PROVIDER[resolvedProvider];
    await activeRuntime.dispatchCommand({
      type: "thread.create",
      commandId: nextCommandId(),
      threadId: ThreadId.makeUnsafe(createStableId()),
      projectId: ProjectId.makeUnsafe(projectId),
      title: "New thread",
      provider: resolvedProvider,
      model: resolvedModel,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt: currentIsoTimestamp(),
    });
  },
  addProject: async (workspaceRoot) => {
    if (!activeRuntime) {
      return;
    }
    await activeRuntime.dispatchCommand({
      type: "project.create",
      commandId: nextCommandId(),
      projectId: ProjectId.makeUnsafe(createStableId()),
      title: inferProjectTitleFromPath(workspaceRoot),
      workspaceRoot: workspaceRoot.trim(),
      createdAt: currentIsoTimestamp(),
    });
  },
  sendMessage: async (threadId, text) => {
    if (!activeRuntime) {
      return;
    }
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return;
    }
    await activeRuntime.dispatchCommand({
      type: "thread.turn.start",
      commandId: nextCommandId(),
      threadId: ThreadId.makeUnsafe(threadId),
      message: {
        messageId: MessageId.makeUnsafe(createStableId()),
        role: "user",
        text: trimmed,
        attachments: [],
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: currentIsoTimestamp(),
    });
    const activeProfile = getActiveProfile(get());
    if (activeProfile) {
      const nextDraftsByServerUrl = {
        ...get().draftsByServerUrl,
        [activeProfile.serverUrl]: {
          ...get().draftsByServerUrl[activeProfile.serverUrl],
          [threadId]: "",
        },
      };
      set({ draftsByServerUrl: nextDraftsByServerUrl });
      await persistStoreState(
        { ...getCurrentPersistFields(get), draftsByServerUrl: nextDraftsByServerUrl },
        get().profiles,
      );
    }
  },
  interruptThread: async (threadId, turnId) => {
    if (!activeRuntime) {
      return;
    }
    await activeRuntime.dispatchCommand({
      type: "thread.turn.interrupt",
      commandId: nextCommandId(),
      threadId: ThreadId.makeUnsafe(threadId),
      ...(turnId ? { turnId: TurnId.makeUnsafe(turnId) } : {}),
      createdAt: currentIsoTimestamp(),
    });
  },
  respondApproval: async (threadId, requestId, decision) => {
    if (!activeRuntime) {
      return;
    }
    await activeRuntime.dispatchCommand({
      type: "thread.approval.respond",
      commandId: nextCommandId(),
      threadId: ThreadId.makeUnsafe(threadId),
      requestId: ApprovalRequestId.makeUnsafe(requestId),
      decision,
      createdAt: currentIsoTimestamp(),
    });
  },
  setPendingUserInputDraft: (threadId, questionId, draft) => {
    set((state) => ({
      pendingUserInputDraftsByThreadId: {
        ...state.pendingUserInputDraftsByThreadId,
        [ThreadId.makeUnsafe(threadId)]: {
          ...state.pendingUserInputDraftsByThreadId[ThreadId.makeUnsafe(threadId)],
          [questionId]: draft,
        },
      },
    }));
  },
  respondUserInput: async (threadId, requestId, answers) => {
    if (!activeRuntime) {
      return;
    }
    await activeRuntime.dispatchCommand({
      type: "thread.user-input.respond",
      commandId: nextCommandId(),
      threadId: ThreadId.makeUnsafe(threadId),
      requestId: ApprovalRequestId.makeUnsafe(requestId),
      answers,
      createdAt: currentIsoTimestamp(),
    });
    set((state) => {
      const nextDrafts = { ...state.pendingUserInputDraftsByThreadId };
      delete nextDrafts[ThreadId.makeUnsafe(threadId)];
      return {
        pendingUserInputDraftsByThreadId: nextDrafts,
      };
    });
  },
  refreshSnapshot: async () => {
    if (!activeRuntime) {
      return;
    }
    set({ refreshing: true });
    try {
      await activeRuntime.refreshSnapshot();
    } finally {
      set({ refreshing: false });
    }
  },
  deleteThread: async (threadId) => {
    if (!activeRuntime) {
      return;
    }
    await activeRuntime.dispatchCommand({
      type: "thread.delete",
      commandId: nextCommandId(),
      threadId: ThreadId.makeUnsafe(threadId),
    });
  },
  renameThread: async (threadId, title) => {
    if (!activeRuntime) {
      return;
    }
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      return;
    }
    await activeRuntime.dispatchCommand({
      type: "thread.meta.update",
      commandId: nextCommandId(),
      threadId: ThreadId.makeUnsafe(threadId),
      title: trimmed,
    });
  },
  deleteProject: async (projectId) => {
    if (!activeRuntime) {
      return;
    }
    await activeRuntime.dispatchCommand({
      type: "project.delete",
      commandId: nextCommandId(),
      projectId: ProjectId.makeUnsafe(projectId),
    });
  },
  renameProject: async (projectId, title) => {
    if (!activeRuntime) {
      return;
    }
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      return;
    }
    await activeRuntime.dispatchCommand({
      type: "project.meta.update",
      commandId: nextCommandId(),
      projectId: ProjectId.makeUnsafe(projectId),
      title: trimmed,
    });
  },
  setPreferredProvider: async (provider) => {
    set({ preferredProvider: provider, preferredModel: null });
    await persistStoreState(
      { ...getCurrentPersistFields(get), preferredProvider: provider, preferredModel: null },
      get().profiles,
    );
  },
  setPreferredModel: async (model) => {
    set({ preferredModel: model });
    await persistStoreState(
      { ...getCurrentPersistFields(get), preferredModel: model },
      get().profiles,
    );
  },
  setNotificationSettings: async (partial) => {
    const next = { ...get().notificationSettings, ...partial };
    set({ notificationSettings: next });
    await persistStoreState(
      { ...getCurrentPersistFields(get), notificationSettings: next },
      get().profiles,
    );
  },
  fetchGitStatus: async (projectId) => {
    if (!activeRuntime) {
      return;
    }
    const status = await activeRuntime.getGitStatus(projectId);
    if (status) {
      set((state) => ({
        gitStatusByProjectId: {
          ...state.gitStatusByProjectId,
          [projectId]: status,
        },
      }));
    }
  },
}));

export function getComposerDraftForThread(threadId: string): string {
  const state = useMobileAppStore.getState();
  const activeProfile = getActiveProfile(state);
  if (!activeProfile) {
    return "";
  }
  return state.draftsByServerUrl[activeProfile.serverUrl]?.[threadId] ?? "";
}

export function buildUserInputAnswersForThread(
  threadId: string,
  questions: Parameters<typeof buildPendingUserInputAnswers>[0],
): Record<string, string> | null {
  const drafts =
    useMobileAppStore.getState().pendingUserInputDraftsByThreadId[ThreadId.makeUnsafe(threadId)];
  return buildPendingUserInputAnswers(questions, drafts ?? {});
}

export function setMobileRuntimeForegroundState(active: boolean): void {
  activeRuntime?.setForegroundActive(active);
}

export function getActiveRuntime(): MobileServerRuntime | null {
  return activeRuntime;
}
