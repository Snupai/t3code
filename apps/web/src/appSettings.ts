import { useCallback } from "react";
import { Option, Schema } from "effect";
import { type ProviderKind, type ProviderStartOptions } from "@t3tools/contracts";
import { getDefaultModel, getModelOptions, normalizeModelSlug } from "@t3tools/shared/model";
import {
  dispatchLocalStorageChange,
  getLocalStorageItem,
  setLocalStorageItem,
  useLocalStorage,
} from "./hooks/useLocalStorage";
import {
  ServerConnectionProfile as ServerConnectionProfileSchema,
  getDefaultServerProfileId,
  normalizeServerConnectionProfiles,
  resolveLastRemoteServerConnectionProfile,
} from "./serverConnection";

export const APP_SETTINGS_STORAGE_KEY = "t3code:app-settings:v2";
const MAX_CUSTOM_MODEL_COUNT = 32;
export const MAX_CUSTOM_MODEL_LENGTH = 256;
export const TIMESTAMP_FORMAT_OPTIONS = ["locale", "12-hour", "24-hour"] as const;
export type TimestampFormat = (typeof TIMESTAMP_FORMAT_OPTIONS)[number];
export const DEFAULT_TIMESTAMP_FORMAT: TimestampFormat = "locale";
const BUILT_IN_MODEL_SLUGS_BY_PROVIDER: Record<ProviderKind, ReadonlySet<string>> = {
  codex: new Set(getModelOptions("codex").map((option) => option.slug)),
  cursor: new Set(getModelOptions("cursor").map((option) => option.slug)),
  opencode: new Set(getModelOptions("opencode").map((option) => option.slug)),
  claude: new Set(getModelOptions("claude").map((option) => option.slug)),
  gemini: new Set(getModelOptions("gemini").map((option) => option.slug)),
};

const AppSettingsSchema = Schema.Struct({
  codexBinaryPath: Schema.String.check(Schema.isMaxLength(4096)).pipe(
    Schema.withConstructorDefault(() => Option.some("")),
  ),
  codexHomePath: Schema.String.check(Schema.isMaxLength(4096)).pipe(
    Schema.withConstructorDefault(() => Option.some("")),
  ),
  cursorBinaryPath: Schema.String.check(Schema.isMaxLength(4096)).pipe(
    Schema.withConstructorDefault(() => Option.some("")),
  ),
  cursorConfigDir: Schema.String.check(Schema.isMaxLength(4096)).pipe(
    Schema.withConstructorDefault(() => Option.some("")),
  ),
  opencodeBinaryPath: Schema.String.check(Schema.isMaxLength(4096)).pipe(
    Schema.withConstructorDefault(() => Option.some("")),
  ),
  opencodeHomePath: Schema.String.check(Schema.isMaxLength(4096)).pipe(
    Schema.withConstructorDefault(() => Option.some("")),
  ),
  claudeBinaryPath: Schema.String.check(Schema.isMaxLength(4096)).pipe(
    Schema.withConstructorDefault(() => Option.some("")),
  ),
  claudeSettingsPath: Schema.String.check(Schema.isMaxLength(4096)).pipe(
    Schema.withConstructorDefault(() => Option.some("")),
  ),
  geminiBinaryPath: Schema.String.check(Schema.isMaxLength(4096)).pipe(
    Schema.withConstructorDefault(() => Option.some("")),
  ),
  geminiHomePath: Schema.String.check(Schema.isMaxLength(4096)).pipe(
    Schema.withConstructorDefault(() => Option.some("")),
  ),
  defaultThreadEnvMode: Schema.Literals(["local", "worktree"]).pipe(
    Schema.withConstructorDefault(() => Option.some("local")),
  ),
  confirmThreadDelete: Schema.Boolean.pipe(Schema.withConstructorDefault(() => Option.some(true))),
  enableAssistantStreaming: Schema.Boolean.pipe(
    Schema.withConstructorDefault(() => Option.some(false)),
  ),
  timestampFormat: Schema.Literals(["locale", "12-hour", "24-hour"]).pipe(
    Schema.withConstructorDefault(() => Option.some(DEFAULT_TIMESTAMP_FORMAT)),
  ),
  customCodexModels: Schema.Array(Schema.String).pipe(
    Schema.withConstructorDefault(() => Option.some([])),
  ),
  customCursorModels: Schema.Array(Schema.String).pipe(
    Schema.withConstructorDefault(() => Option.some([])),
  ),
  customOpenCodeModels: Schema.Array(Schema.String).pipe(
    Schema.withConstructorDefault(() => Option.some([])),
  ),
  customClaudeModels: Schema.Array(Schema.String).pipe(
    Schema.withConstructorDefault(() => Option.some([])),
  ),
  customGeminiModels: Schema.Array(Schema.String).pipe(
    Schema.withConstructorDefault(() => Option.some([])),
  ),
  serverProfiles: Schema.Array(ServerConnectionProfileSchema).pipe(
    Schema.withConstructorDefault(() => Option.some([])),
  ),
  activeServerProfileId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)).pipe(
    Schema.withConstructorDefault(() => Option.some(getDefaultServerProfileId())),
  ),
  lastRemoteServerProfileId: Schema.String.check(Schema.isMaxLength(128)).pipe(
    Schema.withConstructorDefault(() => Option.some("")),
  ),
});
export type AppSettings = typeof AppSettingsSchema.Type;
export interface AppModelOption {
  slug: string;
  name: string;
  isCustom: boolean;
}

const DEFAULT_APP_SETTINGS = AppSettingsSchema.makeUnsafe({});

function normalizeAppSettings(settings: AppSettings): AppSettings {
  const serverProfiles = normalizeServerConnectionProfiles(settings.serverProfiles);
  const activeServerProfileId =
    settings.activeServerProfileId.trim().length > 0
      ? settings.activeServerProfileId.trim()
      : getDefaultServerProfileId();
  const lastRemoteServerProfileId =
    resolveLastRemoteServerConnectionProfile(serverProfiles, [
      activeServerProfileId,
      settings.lastRemoteServerProfileId,
    ])?.id ?? "";
  return {
    ...settings,
    serverProfiles,
    activeServerProfileId,
    lastRemoteServerProfileId,
  };
}

export function readStoredAppSettings(): AppSettings {
  try {
    const storedSettings = getLocalStorageItem(APP_SETTINGS_STORAGE_KEY, AppSettingsSchema);
    return normalizeAppSettings(storedSettings ?? DEFAULT_APP_SETTINGS);
  } catch {
    return normalizeAppSettings(DEFAULT_APP_SETTINGS);
  }
}

export function setStoredAppSettings(settings: AppSettings): AppSettings {
  const normalized = normalizeAppSettings(settings);
  setLocalStorageItem(APP_SETTINGS_STORAGE_KEY, normalized, AppSettingsSchema);
  dispatchLocalStorageChange(APP_SETTINGS_STORAGE_KEY);
  return normalized;
}

export function patchStoredAppSettings(
  updater: (current: AppSettings) => AppSettings,
): AppSettings {
  const current = readStoredAppSettings();
  return setStoredAppSettings(updater(current));
}

export function normalizeCustomModelSlugs(
  models: Iterable<string | null | undefined>,
  provider: ProviderKind = "codex",
): string[] {
  const normalizedModels: string[] = [];
  const seen = new Set<string>();
  const builtInModelSlugs = BUILT_IN_MODEL_SLUGS_BY_PROVIDER[provider];

  for (const candidate of models) {
    const normalized = normalizeModelSlug(candidate, provider);
    if (
      !normalized ||
      normalized.length > MAX_CUSTOM_MODEL_LENGTH ||
      builtInModelSlugs.has(normalized) ||
      seen.has(normalized)
    ) {
      continue;
    }

    seen.add(normalized);
    normalizedModels.push(normalized);
    if (normalizedModels.length >= MAX_CUSTOM_MODEL_COUNT) {
      break;
    }
  }

  return normalizedModels;
}

export function getAppModelOptions(
  provider: ProviderKind,
  customModels: readonly string[],
  selectedModel?: string | null,
): AppModelOption[] {
  const options: AppModelOption[] = getModelOptions(provider).map(({ slug, name }) => ({
    slug,
    name,
    isCustom: false,
  }));
  const seen = new Set(options.map((option) => option.slug));

  for (const slug of normalizeCustomModelSlugs(customModels, provider)) {
    if (seen.has(slug)) {
      continue;
    }

    seen.add(slug);
    options.push({
      slug,
      name: slug,
      isCustom: true,
    });
  }

  const normalizedSelectedModel = normalizeModelSlug(selectedModel, provider);
  if (normalizedSelectedModel && !seen.has(normalizedSelectedModel)) {
    options.push({
      slug: normalizedSelectedModel,
      name: normalizedSelectedModel,
      isCustom: true,
    });
  }

  return options;
}

export function getCustomModelsForProvider(
  settings: Pick<
    AppSettings,
    | "customCodexModels"
    | "customCursorModels"
    | "customOpenCodeModels"
    | "customClaudeModels"
    | "customGeminiModels"
  >,
  provider: ProviderKind,
): readonly string[] {
  switch (provider) {
    case "codex":
      return settings.customCodexModels;
    case "cursor":
      return settings.customCursorModels;
    case "opencode":
      return settings.customOpenCodeModels;
    case "claude":
      return settings.customClaudeModels;
    case "gemini":
      return settings.customGeminiModels;
  }
}

export function patchCustomModelsForProvider(
  provider: ProviderKind,
  models: string[],
): Partial<AppSettings> {
  switch (provider) {
    case "codex":
      return { customCodexModels: models };
    case "cursor":
      return { customCursorModels: models };
    case "opencode":
      return { customOpenCodeModels: models };
    case "claude":
      return { customClaudeModels: models };
    case "gemini":
      return { customGeminiModels: models };
  }
}

export function getProviderStartOptionsFromSettings(
  settings: Pick<
    AppSettings,
    | "codexBinaryPath"
    | "codexHomePath"
    | "cursorBinaryPath"
    | "cursorConfigDir"
    | "opencodeBinaryPath"
    | "opencodeHomePath"
    | "claudeBinaryPath"
    | "claudeSettingsPath"
    | "geminiBinaryPath"
    | "geminiHomePath"
  >,
  provider: ProviderKind,
): ProviderStartOptions | undefined {
  switch (provider) {
    case "codex":
      return settings.codexBinaryPath || settings.codexHomePath
        ? {
            codex: {
              ...(settings.codexBinaryPath ? { binaryPath: settings.codexBinaryPath } : {}),
              ...(settings.codexHomePath ? { homePath: settings.codexHomePath } : {}),
            },
          }
        : undefined;
    case "cursor":
      return settings.cursorBinaryPath || settings.cursorConfigDir
        ? {
            cursor: {
              ...(settings.cursorBinaryPath ? { binaryPath: settings.cursorBinaryPath } : {}),
              ...(settings.cursorConfigDir ? { configDir: settings.cursorConfigDir } : {}),
            },
          }
        : undefined;
    case "opencode":
      return settings.opencodeBinaryPath || settings.opencodeHomePath
        ? {
            opencode: {
              ...(settings.opencodeBinaryPath ? { binaryPath: settings.opencodeBinaryPath } : {}),
              ...(settings.opencodeHomePath ? { homePath: settings.opencodeHomePath } : {}),
            },
          }
        : undefined;
    case "claude":
      return settings.claudeBinaryPath || settings.claudeSettingsPath
        ? {
            claude: {
              ...(settings.claudeBinaryPath ? { binaryPath: settings.claudeBinaryPath } : {}),
              ...(settings.claudeSettingsPath ? { settingsPath: settings.claudeSettingsPath } : {}),
            },
          }
        : undefined;
    case "gemini":
      return settings.geminiBinaryPath || settings.geminiHomePath
        ? {
            gemini: {
              ...(settings.geminiBinaryPath ? { binaryPath: settings.geminiBinaryPath } : {}),
              ...(settings.geminiHomePath ? { homePath: settings.geminiHomePath } : {}),
            },
          }
        : undefined;
  }
}

export function resolveAppModelSelection(
  provider: ProviderKind,
  customModels: readonly string[],
  selectedModel: string | null | undefined,
): string {
  const options = getAppModelOptions(provider, customModels, selectedModel);
  const trimmedSelectedModel = selectedModel?.trim();
  if (trimmedSelectedModel) {
    const direct = options.find((option) => option.slug === trimmedSelectedModel);
    if (direct) {
      return direct.slug;
    }

    const byName = options.find(
      (option) => option.name.toLowerCase() === trimmedSelectedModel.toLowerCase(),
    );
    if (byName) {
      return byName.slug;
    }
  }

  const normalizedSelectedModel = normalizeModelSlug(selectedModel, provider);
  if (!normalizedSelectedModel) {
    return getDefaultModel(provider);
  }

  return (
    options.find((option) => option.slug === normalizedSelectedModel)?.slug ??
    getDefaultModel(provider)
  );
}

export function useAppSettings() {
  const [settings, setSettings] = useLocalStorage(
    APP_SETTINGS_STORAGE_KEY,
    DEFAULT_APP_SETTINGS,
    AppSettingsSchema,
  );

  const updateSettings = useCallback(
    (patch: Partial<AppSettings>) => {
      setSettings((prev) => normalizeAppSettings({ ...prev, ...patch }));
    },
    [setSettings],
  );

  const resetSettings = useCallback(() => {
    setSettings(normalizeAppSettings(DEFAULT_APP_SETTINGS));
  }, [setSettings]);

  return {
    settings: normalizeAppSettings(settings),
    updateSettings,
    resetSettings,
    defaults: DEFAULT_APP_SETTINGS,
  } as const;
}
