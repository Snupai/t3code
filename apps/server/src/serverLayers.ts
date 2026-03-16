import path from "node:path";
import { homedir } from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { type ProviderSessionStartInput } from "@t3tools/contracts";
import { Effect, FileSystem, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { CheckpointDiffQueryLive } from "./checkpointing/Layers/CheckpointDiffQuery";
import { CheckpointStoreLive } from "./checkpointing/Layers/CheckpointStore";
import { ServerConfig } from "./config";
import { OrchestrationCommandReceiptRepositoryLive } from "./persistence/Layers/OrchestrationCommandReceipts";
import { OrchestrationEventStoreLive } from "./persistence/Layers/OrchestrationEventStore";
import { ProviderSessionRuntimeRepositoryLive } from "./persistence/Layers/ProviderSessionRuntime";
import { OrchestrationEngineLive } from "./orchestration/Layers/OrchestrationEngine";
import { CheckpointReactorLive } from "./orchestration/Layers/CheckpointReactor";
import { OrchestrationReactorLive } from "./orchestration/Layers/OrchestrationReactor";
import { ProviderCommandReactorLive } from "./orchestration/Layers/ProviderCommandReactor";
import { OrchestrationProjectionPipelineLive } from "./orchestration/Layers/ProjectionPipeline";
import { OrchestrationProjectionSnapshotQueryLive } from "./orchestration/Layers/ProjectionSnapshotQuery";
import { ProviderRuntimeIngestionLive } from "./orchestration/Layers/ProviderRuntimeIngestion";
import { RuntimeReceiptBusLive } from "./orchestration/Layers/RuntimeReceiptBus";
import { ProviderUnsupportedError } from "./provider/Errors";
import { makeCodexAdapterLive } from "./provider/Layers/CodexAdapter";
import {
  makeHeadlessJsonCliAdapter,
  parseClaudeLine,
  parseCursorAgentLine,
  parseGeminiLine,
  parseOpenCodeLine,
} from "./provider/Layers/HeadlessJsonCliAdapter";
import { makeProviderAdapterRegistryLive } from "./provider/Layers/ProviderAdapterRegistry";
import { makeProviderServiceLive } from "./provider/Layers/ProviderService";
import { ProviderSessionDirectoryLive } from "./provider/Layers/ProviderSessionDirectory";
import { ProviderService } from "./provider/Services/ProviderService";
import { makeEventNdjsonLogger } from "./provider/Layers/EventNdjsonLogger";

import { TerminalManagerLive } from "./terminal/Layers/Manager";
import { KeybindingsLive } from "./keybindings";
import { GitManagerLive } from "./git/Layers/GitManager";
import { GitCoreLive } from "./git/Layers/GitCore";
import { GitHubCliLive } from "./git/Layers/GitHubCli";
import { CodexTextGenerationLive } from "./git/Layers/CodexTextGeneration";
import { GitServiceLive } from "./git/Layers/GitService";
import { BunPtyAdapterLive } from "./terminal/Layers/BunPTY";
import { NodePtyAdapterLive } from "./terminal/Layers/NodePTY";
import { AnalyticsService } from "./telemetry/Services/AnalyticsService";

function expandHomePath(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed === "~") {
    return homedir();
  }
  if (trimmed.startsWith("~/")) {
    return path.join(homedir(), trimmed.slice(2));
  }
  return trimmed;
}

function buildHeadlessEnv(
  input: ProviderSessionStartInput,
  providerEnvKey: "CURSOR_CONFIG_DIR" | "OPENCODE_HOME" | "GEMINI_CLI_HOME" | null,
  providerHomePath: string | undefined,
): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (providerEnvKey && providerHomePath) {
    env[providerEnvKey] = providerHomePath;
  }
  return env;
}

function getCursorBinaryPath(input: ProviderSessionStartInput): string {
  return expandHomePath(input.providerOptions?.cursor?.binaryPath) ?? "cursor-agent";
}

function getOpenCodeBinaryPath(input: ProviderSessionStartInput): string {
  return expandHomePath(input.providerOptions?.opencode?.binaryPath) ?? "opencode";
}

function getClaudeBinaryPath(input: ProviderSessionStartInput): string {
  return expandHomePath(input.providerOptions?.claude?.binaryPath) ?? "claude";
}

function getGeminiBinaryPath(input: ProviderSessionStartInput): string {
  return expandHomePath(input.providerOptions?.gemini?.binaryPath) ?? "gemini";
}

export function makeServerProviderLayer(): Layer.Layer<
  ProviderService,
  ProviderUnsupportedError,
  SqlClient.SqlClient | ServerConfig | FileSystem.FileSystem | AnalyticsService
> {
  return Effect.gen(function* () {
    const { stateDir } = yield* ServerConfig;
    const providerLogsDir = path.join(stateDir, "logs", "provider");
    const providerEventLogPath = path.join(providerLogsDir, "events.log");
    const nativeEventLogger = yield* makeEventNdjsonLogger(providerEventLogPath, {
      stream: "native",
    });
    const canonicalEventLogger = yield* makeEventNdjsonLogger(providerEventLogPath, {
      stream: "canonical",
    });
    const providerSessionDirectoryLayer = ProviderSessionDirectoryLive.pipe(
      Layer.provide(ProviderSessionRuntimeRepositoryLive),
    );
    const codexAdapterLayer = makeCodexAdapterLive(
      nativeEventLogger ? { nativeEventLogger } : undefined,
    );
    const cursorAdapter = yield* makeHeadlessJsonCliAdapter({
      provider: "cursor",
      displayName: "Cursor Agent",
      binaryName: "cursor-agent",
      capabilities: {
        approvalRequired: false,
        conversationRollback: false,
        sessionModelSwitch: "in-session",
      },
      getEnv: (input) =>
        buildHeadlessEnv(
          input,
          "CURSOR_CONFIG_DIR",
          expandHomePath(input.providerOptions?.cursor?.configDir),
        ),
      buildSpawnConfig: ({ session, input }) => ({
        command: getCursorBinaryPath({
          ...session.session,
          providerOptions: session.providerOptions,
        } as ProviderSessionStartInput),
        args: [
          "--print",
          "--output-format",
          "stream-json",
          ...(session.sessionId ? ["--resume", session.sessionId] : []),
          ...((input.model ?? session.model)
            ? ["--model", input.model ?? session.model ?? ""]
            : []),
          input.input ?? "",
        ],
        env: session.env,
      }),
      parseLine: parseCursorAgentLine,
      ...(nativeEventLogger ? { nativeEventLogger } : {}),
    });
    const opencodeAdapter = yield* makeHeadlessJsonCliAdapter({
      provider: "opencode",
      displayName: "OpenCode",
      binaryName: "opencode",
      capabilities: {
        approvalRequired: false,
        conversationRollback: false,
        sessionModelSwitch: "in-session",
      },
      getEnv: (input) =>
        buildHeadlessEnv(
          input,
          "OPENCODE_HOME",
          expandHomePath(input.providerOptions?.opencode?.homePath),
        ),
      buildSpawnConfig: ({ session, input }) => ({
        command: getOpenCodeBinaryPath({
          ...session.session,
          providerOptions: session.providerOptions,
        } as ProviderSessionStartInput),
        args: [
          "run",
          "--format",
          "json",
          ...(session.sessionId ? ["--session", session.sessionId] : []),
          ...((input.model ?? session.model)
            ? ["--model", input.model ?? session.model ?? ""]
            : []),
          input.input ?? "",
        ],
        env: session.env,
      }),
      parseLine: parseOpenCodeLine,
      ...(nativeEventLogger ? { nativeEventLogger } : {}),
    });
    const claudeAdapter = yield* makeHeadlessJsonCliAdapter({
      provider: "claude",
      displayName: "Claude",
      binaryName: "claude",
      capabilities: {
        approvalRequired: false,
        conversationRollback: false,
        sessionModelSwitch: "in-session",
      },
      getEnv: () => ({ ...process.env }),
      buildSpawnConfig: ({ session, input }) => {
        const settingsPath = expandHomePath(session.providerOptions?.claude?.settingsPath);
        return {
          command: getClaudeBinaryPath({
            ...session.session,
            providerOptions: session.providerOptions,
          } as ProviderSessionStartInput),
          args: [
            "-p",
            "--verbose",
            "--output-format",
            "stream-json",
            "--permission-mode",
            "bypassPermissions",
            ...(session.sessionId ? ["--resume", session.sessionId] : []),
            ...((input.model ?? session.model)
              ? ["--model", input.model ?? session.model ?? ""]
              : []),
            ...(settingsPath ? ["--settings", settingsPath] : []),
            input.input ?? "",
          ],
          env: session.env,
        };
      },
      parseLine: parseClaudeLine,
      ...(nativeEventLogger ? { nativeEventLogger } : {}),
    });
    const geminiAdapter = yield* makeHeadlessJsonCliAdapter({
      provider: "gemini",
      displayName: "Gemini",
      binaryName: "gemini",
      capabilities: {
        approvalRequired: false,
        conversationRollback: false,
        sessionModelSwitch: "in-session",
      },
      getEnv: (input) =>
        buildHeadlessEnv(
          input,
          "GEMINI_CLI_HOME",
          expandHomePath(input.providerOptions?.gemini?.homePath),
        ),
      buildSpawnConfig: ({ session, input }) => ({
        command: getGeminiBinaryPath({
          ...session.session,
          providerOptions: session.providerOptions,
        } as ProviderSessionStartInput),
        args: [
          "--prompt",
          input.input ?? "",
          "--output-format",
          "stream-json",
          "--approval-mode",
          "yolo",
          ...(session.sessionId ? ["--resume", session.sessionId] : []),
          ...((input.model ?? session.model)
            ? ["--model", input.model ?? session.model ?? ""]
            : []),
        ],
        env: session.env,
      }),
      parseLine: parseGeminiLine,
      ...(nativeEventLogger ? { nativeEventLogger } : {}),
    });
    const adapterRegistryLayer = makeProviderAdapterRegistryLive({
      extraAdapters: [cursorAdapter, opencodeAdapter, claudeAdapter, geminiAdapter],
    }).pipe(Layer.provide(codexAdapterLayer), Layer.provideMerge(providerSessionDirectoryLayer));
    return makeProviderServiceLive(
      canonicalEventLogger ? { canonicalEventLogger } : undefined,
    ).pipe(Layer.provide(adapterRegistryLayer), Layer.provide(providerSessionDirectoryLayer));
  }).pipe(Layer.unwrap);
}

export function makeServerRuntimeServicesLayer() {
  const gitCoreLayer = GitCoreLive.pipe(Layer.provideMerge(GitServiceLive));
  const textGenerationLayer = CodexTextGenerationLive;

  const orchestrationLayer = OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionPipelineLive),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
  );

  const checkpointDiffQueryLayer = CheckpointDiffQueryLive.pipe(
    Layer.provideMerge(OrchestrationProjectionSnapshotQueryLive),
    Layer.provideMerge(CheckpointStoreLive),
  );

  const runtimeServicesLayer = Layer.mergeAll(
    orchestrationLayer,
    OrchestrationProjectionSnapshotQueryLive,
    CheckpointStoreLive,
    checkpointDiffQueryLayer,
    RuntimeReceiptBusLive,
  );
  const runtimeIngestionLayer = ProviderRuntimeIngestionLive.pipe(
    Layer.provideMerge(runtimeServicesLayer),
  );
  const providerCommandReactorLayer = ProviderCommandReactorLive.pipe(
    Layer.provideMerge(runtimeServicesLayer),
    Layer.provideMerge(gitCoreLayer),
    Layer.provideMerge(textGenerationLayer),
  );
  const checkpointReactorLayer = CheckpointReactorLive.pipe(
    Layer.provideMerge(runtimeServicesLayer),
  );
  const orchestrationReactorLayer = OrchestrationReactorLive.pipe(
    Layer.provideMerge(runtimeIngestionLayer),
    Layer.provideMerge(providerCommandReactorLayer),
    Layer.provideMerge(checkpointReactorLayer),
  );

  const terminalLayer = TerminalManagerLive.pipe(
    Layer.provide(
      typeof Bun !== "undefined" && process.platform !== "win32"
        ? BunPtyAdapterLive
        : NodePtyAdapterLive,
    ),
  );

  const gitManagerLayer = GitManagerLive.pipe(
    Layer.provideMerge(gitCoreLayer),
    Layer.provideMerge(GitHubCliLive),
    Layer.provideMerge(textGenerationLayer),
  );

  return Layer.mergeAll(
    orchestrationReactorLayer,
    gitCoreLayer,
    gitManagerLayer,
    terminalLayer,
    KeybindingsLive,
  ).pipe(Layer.provideMerge(NodeServices.layer));
}
