import { spawnSync } from "node:child_process";
import { homedir } from "node:os";

import {
  MODEL_OPTIONS_BY_PROVIDER,
  type ProviderKind,
  type ProviderStartOptions,
  type ServerInspectProvidersInput,
  type ServerProviderAuthStatus,
  type ServerProviderCatalog,
} from "@t3tools/contracts";
import { Effect, Layer, Ref } from "effect";

import { ServerConfig } from "../../config.ts";
import { ProviderInspector, type ProviderInspectorShape } from "../Services/ProviderInspector.ts";

const CACHE_TTL_MS = 30_000;
const COMMAND_TIMEOUT_MS = 4_000;
const ANSI_ESCAPE_REGEX = new RegExp(String.raw`\u001B\[[0-9;]*m`, "g");

type CommandResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
  readonly error?: Error;
  readonly timedOut: boolean;
};

type EffectiveProviderConfig = {
  readonly provider: ProviderKind;
  readonly binaryPath: string;
  readonly env: NodeJS.ProcessEnv;
  readonly configPath?: string;
};

const DEFAULT_BINARY_BY_PROVIDER: Record<ProviderKind, string> = {
  codex: "codex",
  cursor: "cursor-agent",
  opencode: "opencode",
  claude: "claude",
  gemini: "gemini",
};

const PROVIDER_CAPABILITIES: Record<ProviderKind, ServerProviderCatalog["capabilities"]> = {
  codex: {
    approvalRequired: true,
    conversationRollback: true,
    sessionModelSwitch: "in-session",
  },
  cursor: {
    approvalRequired: false,
    conversationRollback: false,
    sessionModelSwitch: "in-session",
  },
  opencode: {
    approvalRequired: false,
    conversationRollback: false,
    sessionModelSwitch: "in-session",
  },
  claude: {
    approvalRequired: false,
    conversationRollback: false,
    sessionModelSwitch: "in-session",
  },
  gemini: {
    approvalRequired: false,
    conversationRollback: false,
    sessionModelSwitch: "in-session",
  },
};

function expandHome(value: string | undefined): string | undefined {
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
    return `${homedir()}${trimmed.slice(1)}`;
  }
  return trimmed;
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_REGEX, "");
}

function nonEmptyTrimmed(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function runCommand(
  binaryPath: string,
  args: ReadonlyArray<string>,
  options: { readonly cwd: string; readonly env?: NodeJS.ProcessEnv },
): CommandResult {
  const result = spawnSync(binaryPath, [...args], {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: 1024 * 1024 * 8,
  });

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    code: result.status,
    ...(result.error ? { error: result.error } : {}),
    timedOut: Boolean(result.signal === "SIGTERM" && result.error?.name === "Error"),
  };
}

function commandFailed(result: CommandResult): boolean {
  return result.error !== undefined || result.code !== 0;
}

function detailFromCommandResult(result: CommandResult): string | undefined {
  if (result.timedOut) {
    return "Timed out while running command.";
  }
  const stderr = nonEmptyTrimmed(stripAnsi(result.stderr));
  if (stderr) {
    return stderr;
  }
  const stdout = nonEmptyTrimmed(stripAnsi(result.stdout));
  if (stdout) {
    return stdout;
  }
  if (result.error) {
    return result.error.message;
  }
  if (result.code !== null && result.code !== 0) {
    return `Command exited with code ${result.code}.`;
  }
  return undefined;
}

function resolveEffectiveProviderConfig(
  provider: ProviderKind,
  providerOptions: ProviderStartOptions | undefined,
): EffectiveProviderConfig {
  const env = { ...process.env };

  switch (provider) {
    case "codex": {
      const options = providerOptions?.codex;
      const homePath = expandHome(options?.homePath);
      if (homePath) {
        env.CODEX_HOME = homePath;
      }
      return {
        provider,
        binaryPath: expandHome(options?.binaryPath) ?? DEFAULT_BINARY_BY_PROVIDER.codex,
        env,
      };
    }
    case "cursor": {
      const options = providerOptions?.cursor;
      const configDir = expandHome(options?.configDir);
      if (configDir) {
        env.CURSOR_CONFIG_DIR = configDir;
      }
      return {
        provider,
        binaryPath: expandHome(options?.binaryPath) ?? DEFAULT_BINARY_BY_PROVIDER.cursor,
        env,
        ...(configDir ? { configPath: configDir } : {}),
      };
    }
    case "opencode": {
      const options = providerOptions?.opencode;
      const homePath = expandHome(options?.homePath);
      if (homePath) {
        env.OPENCODE_HOME = homePath;
      }
      return {
        provider,
        binaryPath: expandHome(options?.binaryPath) ?? DEFAULT_BINARY_BY_PROVIDER.opencode,
        env,
        ...(homePath ? { configPath: homePath } : {}),
      };
    }
    case "claude": {
      const options = providerOptions?.claude;
      const settingsPath = expandHome(options?.settingsPath);
      return {
        provider,
        binaryPath: expandHome(options?.binaryPath) ?? DEFAULT_BINARY_BY_PROVIDER.claude,
        env,
        ...(settingsPath ? { configPath: settingsPath } : {}),
      };
    }
    case "gemini": {
      const options = providerOptions?.gemini;
      const homePath = expandHome(options?.homePath);
      if (homePath) {
        env.GEMINI_CLI_HOME = homePath;
      }
      return {
        provider,
        binaryPath: expandHome(options?.binaryPath) ?? DEFAULT_BINARY_BY_PROVIDER.gemini,
        env,
        ...(homePath ? { configPath: homePath } : {}),
      };
    }
  }
}

function parseCursorModels(result: CommandResult) {
  const models = stripAnsi(result.stdout)
    .split("\n")
    .map((line) => line.trim())
    .flatMap((line) => {
      const match = line.match(/^([^\s].*?)\s+-\s+(.+)$/);
      if (!match) {
        return [];
      }
      const slug = nonEmptyTrimmed(match[1]);
      const name = nonEmptyTrimmed(match[2]);
      return slug && name ? [{ slug, name }] : [];
    });
  return models;
}

function titleCaseFromSlug(slug: string): string {
  return slug
    .split(/[/-]/g)
    .filter((part) => part.length > 0)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function parseOpenCodeModels(result: CommandResult) {
  return stripAnsi(result.stdout)
    .split("\n")
    .map((line) => nonEmptyTrimmed(line))
    .filter((line): line is string => line !== undefined)
    .map((slug) => ({
      slug,
      name: titleCaseFromSlug(slug),
    }));
}

function inferCodexAuthStatus(result: CommandResult): {
  readonly status: ServerProviderCatalog["status"];
  readonly authStatus: ServerProviderAuthStatus;
  readonly message?: string;
} {
  const output = `${stripAnsi(result.stdout)}\n${stripAnsi(result.stderr)}`.toLowerCase();
  if (
    output.includes("not logged in") ||
    output.includes("login required") ||
    output.includes("authentication required")
  ) {
    return {
      status: "error",
      authStatus: "unauthenticated",
      message: "Codex CLI is not authenticated. Run `codex login` and try again.",
    };
  }

  if (commandFailed(result)) {
    return {
      status: "warning",
      authStatus: "unknown",
      message: detailFromCommandResult(result)
        ? `Could not verify Codex authentication status. ${detailFromCommandResult(result)}`
        : "Could not verify Codex authentication status.",
    };
  }

  return { status: "ready", authStatus: "authenticated" };
}

function inspectProvider(input: {
  readonly cwd: string;
  readonly provider: ProviderKind;
  readonly providerOptions?: ProviderStartOptions;
  readonly includeModels: boolean;
}): ServerProviderCatalog {
  const checkedAt = new Date().toISOString();
  const effective = resolveEffectiveProviderConfig(input.provider, input.providerOptions);
  const installProbeArgs =
    input.provider === "opencode"
      ? ["--help"]
      : input.provider === "codex"
        ? ["--version"]
        : ["--version"];
  const installProbe = runCommand(effective.binaryPath, installProbeArgs, {
    cwd: input.cwd,
    env: effective.env,
  });

  if (commandFailed(installProbe)) {
    return {
      provider: input.provider,
      status: "error",
      available: false,
      authStatus: "unknown",
      checkedAt,
      ...(detailFromCommandResult(installProbe)
        ? { message: detailFromCommandResult(installProbe) }
        : {}),
      binaryPath: effective.binaryPath,
      models: [],
      modelSource:
        input.provider === "codex"
          ? "static"
          : input.provider === "cursor" || input.provider === "opencode"
            ? "cli"
            : "custom-only",
      capabilities: PROVIDER_CAPABILITIES[input.provider],
    };
  }

  let status: ServerProviderCatalog["status"] = "ready";
  let authStatus: ServerProviderAuthStatus = "unknown";
  let message: string | undefined;

  if (input.provider === "codex") {
    const authProbe = runCommand(effective.binaryPath, ["login", "status"], {
      cwd: input.cwd,
      env: effective.env,
    });
    const auth = inferCodexAuthStatus(authProbe);
    status = auth.status;
    authStatus = auth.authStatus;
    message = auth.message;
  }

  const models =
    input.includeModels === false
      ? []
      : input.provider === "codex"
        ? [...MODEL_OPTIONS_BY_PROVIDER.codex]
        : input.provider === "cursor"
          ? parseCursorModels(
              runCommand(effective.binaryPath, ["--list-models"], {
                cwd: input.cwd,
                env: effective.env,
              }),
            )
          : input.provider === "opencode"
            ? parseOpenCodeModels(
                runCommand(effective.binaryPath, ["models"], {
                  cwd: input.cwd,
                  env: effective.env,
                }),
              )
            : [];

  return {
    provider: input.provider,
    status,
    available: true,
    authStatus,
    checkedAt,
    ...(message ? { message } : {}),
    binaryPath: effective.binaryPath,
    models,
    modelSource:
      input.provider === "codex"
        ? "static"
        : input.provider === "cursor" || input.provider === "opencode"
          ? "cli"
          : "custom-only",
    capabilities: PROVIDER_CAPABILITIES[input.provider],
  };
}

export const ProviderInspectorLive = Layer.effect(
  ProviderInspector,
  Effect.gen(function* () {
    const { cwd } = yield* ServerConfig;
    const cache = yield* Ref.make(
      new Map<
        string,
        { readonly expiresAt: number; readonly value: ReadonlyArray<ServerProviderCatalog> }
      >(),
    );

    const inspect: ProviderInspectorShape["inspect"] = (rawInput) =>
      Effect.gen(function* () {
        const input: ServerInspectProvidersInput = {
          includeModels: rawInput?.includeModels ?? true,
          ...(rawInput?.providerOptions !== undefined
            ? { providerOptions: rawInput.providerOptions }
            : {}),
        };
        const cacheKey = JSON.stringify(input);
        const cached = yield* Ref.get(cache).pipe(Effect.map((entries) => entries.get(cacheKey)));
        const now = Date.now();
        if (cached && cached.expiresAt > now) {
          return cached.value;
        }

        const providers: ProviderKind[] = ["codex", "cursor", "opencode", "claude", "gemini"];
        const value = providers.map((provider) =>
          inspectProvider({
            cwd,
            provider,
            ...(input.providerOptions !== undefined
              ? { providerOptions: input.providerOptions }
              : {}),
            includeModels: input.includeModels !== false,
          }),
        );

        yield* Ref.update(cache, (entries) => {
          const next = new Map(entries);
          next.set(cacheKey, {
            expiresAt: now + CACHE_TTL_MS,
            value,
          });
          return next;
        });

        return value;
      });

    return {
      inspect,
    } satisfies ProviderInspectorShape;
  }),
);
