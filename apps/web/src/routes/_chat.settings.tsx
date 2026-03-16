import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { type DesktopServerConnectionDetails, type ProviderKind } from "@t3tools/contracts";
import { buildMobilePairingLink } from "@t3tools/shared/mobilePairing";
import { getModelOptions, normalizeModelSlug } from "@t3tools/shared/model";
import QRCode from "qrcode";
import {
  getCustomModelsForProvider,
  MAX_CUSTOM_MODEL_LENGTH,
  patchCustomModelsForProvider,
  patchStoredAppSettings,
  useAppSettings,
} from "../appSettings";
import { resolveAndPersistPreferredEditor } from "../editorPreferences";
import { isElectron } from "../env";
import { useTheme } from "../hooks/useTheme";
import {
  serverConfigQueryOptions,
  serverInspectProvidersQueryOptions,
} from "../lib/serverReactQuery";
import { ensureNativeApi } from "../nativeApi";
import {
  getServerConnectionStateSnapshot,
  retryActiveConnection,
  subscribeServerConnectionState,
  switchConnectionProfile,
} from "../wsNativeApi";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { APP_VERSION } from "../branding";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import {
  getDefaultServerProfileId,
  isLocalServerProfile,
  normalizeServerConnectionUrl,
  resolveServerConnectionProfiles,
  SYSTEM_DESKTOP_LOCAL_PROFILE_ID,
  type ServerConnectionProfile,
} from "../serverConnection";
import { SidebarInset } from "~/components/ui/sidebar";

const THEME_OPTIONS = [
  {
    value: "system",
    label: "System",
    description: "Match your OS appearance setting.",
  },
  {
    value: "light",
    label: "Light",
    description: "Always use the light theme.",
  },
  {
    value: "dark",
    label: "Dark",
    description: "Always use the dark theme.",
  },
] as const;

const MODEL_PROVIDER_SETTINGS: Array<{
  provider: ProviderKind;
  title: string;
  description: string;
  placeholder: string;
  example: string;
}> = [
  {
    provider: "codex",
    title: "Codex",
    description: "Save additional Codex model slugs for the picker and `/model` command.",
    placeholder: "your-codex-model-slug",
    example: "gpt-6.7-codex-ultra-preview",
  },
  {
    provider: "cursor",
    title: "Cursor Agent",
    description: "Save additional Cursor model slugs for the picker and `/model` command.",
    placeholder: "your-cursor-model-slug",
    example: "anthropic/claude-sonnet-4",
  },
  {
    provider: "opencode",
    title: "OpenCode",
    description: "Save additional OpenCode model slugs for the picker and `/model` command.",
    placeholder: "your-opencode-model-slug",
    example: "anthropic/claude-sonnet-4-6",
  },
  {
    provider: "claude",
    title: "Claude",
    description: "Save Claude model slugs for the picker and `/model` command.",
    placeholder: "your-claude-model-slug",
    example: "claude-sonnet-4-5",
  },
  {
    provider: "gemini",
    title: "Gemini",
    description: "Save Gemini model slugs for the picker and `/model` command.",
    placeholder: "your-gemini-model-slug",
    example: "gemini-2.5-pro",
  },
] as const;

const PROVIDER_OVERRIDE_SETTINGS: Array<{
  provider: ProviderKind;
  title: string;
  description: string;
  binaryLabel: string;
  binaryPlaceholder: string;
  configLabel: string;
  configPlaceholder: string;
  configHelp: string;
}> = [
  {
    provider: "codex",
    title: "Codex App Server",
    description:
      "These overrides apply to new sessions and let you use a non-default Codex install.",
    binaryLabel: "Codex binary path",
    binaryPlaceholder: "codex",
    configLabel: "CODEX_HOME path",
    configPlaceholder: "/Users/you/.codex",
    configHelp: "Optional custom Codex home/config directory.",
  },
  {
    provider: "cursor",
    title: "Cursor Agent",
    description:
      "These overrides apply to new sessions and let you use a non-default Cursor Agent install.",
    binaryLabel: "Cursor Agent binary path",
    binaryPlaceholder: "cursor-agent",
    configLabel: "CURSOR_CONFIG_DIR path",
    configPlaceholder: "/Users/you/.cursor",
    configHelp: "Optional custom Cursor config directory.",
  },
  {
    provider: "opencode",
    title: "OpenCode",
    description:
      "These overrides apply to new sessions and let you use a non-default OpenCode install.",
    binaryLabel: "OpenCode binary path",
    binaryPlaceholder: "opencode",
    configLabel: "OPENCODE_HOME path",
    configPlaceholder: "/Users/you/.opencode",
    configHelp: "Optional custom OpenCode home/config directory.",
  },
  {
    provider: "claude",
    title: "Claude",
    description:
      "These overrides apply to new sessions and let you use a non-default Claude CLI install.",
    binaryLabel: "Claude binary path",
    binaryPlaceholder: "claude",
    configLabel: "Claude settings path",
    configPlaceholder: "/Users/you/.claude/settings.json",
    configHelp: "Optional Claude settings file path passed with --settings.",
  },
  {
    provider: "gemini",
    title: "Gemini",
    description:
      "These overrides apply to new sessions and let you use a non-default Gemini CLI install.",
    binaryLabel: "Gemini binary path",
    binaryPlaceholder: "gemini",
    configLabel: "GEMINI_CLI_HOME path",
    configPlaceholder: "/Users/you/.gemini",
    configHelp: "Optional custom Gemini CLI home/config directory.",
  },
] as const;

const TIMESTAMP_FORMAT_LABELS = {
  locale: "System default",
  "12-hour": "12-hour",
  "24-hour": "24-hour",
} as const;

interface ServerConnectionFormState {
  label: string;
  serverUrl: string;
  authToken: string;
}

function toServerConnectionFormState(
  profile?: ServerConnectionProfile | null,
): ServerConnectionFormState {
  return {
    label: profile?.label ?? "",
    serverUrl: profile?.serverUrl ?? "",
    authToken: profile?.authToken ?? "",
  };
}

function getDefaultCustomModelsForProvider(
  defaults: ReturnType<typeof useAppSettings>["defaults"],
  provider: ProviderKind,
) {
  return getCustomModelsForProvider(defaults, provider);
}

function getProviderBinaryPath(
  settings: ReturnType<typeof useAppSettings>["settings"],
  provider: ProviderKind,
) {
  switch (provider) {
    case "codex":
      return settings.codexBinaryPath;
    case "cursor":
      return settings.cursorBinaryPath;
    case "opencode":
      return settings.opencodeBinaryPath;
    case "claude":
      return settings.claudeBinaryPath;
    case "gemini":
      return settings.geminiBinaryPath;
  }
}

function getProviderConfigPath(
  settings: ReturnType<typeof useAppSettings>["settings"],
  provider: ProviderKind,
) {
  switch (provider) {
    case "codex":
      return settings.codexHomePath;
    case "cursor":
      return settings.cursorConfigDir;
    case "opencode":
      return settings.opencodeHomePath;
    case "claude":
      return settings.claudeSettingsPath;
    case "gemini":
      return settings.geminiHomePath;
  }
}

function patchProviderOverride(
  provider: ProviderKind,
  patch: { readonly binaryPath?: string; readonly configPath?: string },
) {
  switch (provider) {
    case "codex":
      return {
        ...(patch.binaryPath !== undefined ? { codexBinaryPath: patch.binaryPath } : {}),
        ...(patch.configPath !== undefined ? { codexHomePath: patch.configPath } : {}),
      };
    case "cursor":
      return {
        ...(patch.binaryPath !== undefined ? { cursorBinaryPath: patch.binaryPath } : {}),
        ...(patch.configPath !== undefined ? { cursorConfigDir: patch.configPath } : {}),
      };
    case "opencode":
      return {
        ...(patch.binaryPath !== undefined ? { opencodeBinaryPath: patch.binaryPath } : {}),
        ...(patch.configPath !== undefined ? { opencodeHomePath: patch.configPath } : {}),
      };
    case "claude":
      return {
        ...(patch.binaryPath !== undefined ? { claudeBinaryPath: patch.binaryPath } : {}),
        ...(patch.configPath !== undefined ? { claudeSettingsPath: patch.configPath } : {}),
      };
    case "gemini":
      return {
        ...(patch.binaryPath !== undefined ? { geminiBinaryPath: patch.binaryPath } : {}),
        ...(patch.configPath !== undefined ? { geminiHomePath: patch.configPath } : {}),
      };
  }
}

function resetProviderOverride(
  defaults: ReturnType<typeof useAppSettings>["defaults"],
  provider: ProviderKind,
) {
  return patchProviderOverride(provider, {
    binaryPath: getProviderBinaryPath(defaults, provider),
    configPath: getProviderConfigPath(defaults, provider),
  });
}

function MobilePairingQrCode({ value }: { value: string }) {
  const [svgMarkup, setSvgMarkup] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void QRCode.toString(value, {
      type: "svg",
      margin: 1,
      width: 192,
      errorCorrectionLevel: "M",
      color: {
        dark: "#111827",
        light: "#ffffff",
      },
    })
      .then((svg: string) => {
        if (!cancelled) {
          setSvgMarkup(svg);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSvgMarkup(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [value]);

  if (!svgMarkup) {
    return (
      <div className="flex h-48 w-48 items-center justify-center rounded-lg border border-border bg-background text-xs text-muted-foreground">
        Generating QR...
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-lg border border-border bg-white p-2"
      dangerouslySetInnerHTML={{ __html: svgMarkup }}
    />
  );
}

function SettingsRouteView() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { settings, defaults, updateSettings } = useAppSettings();
  const connectionState = useSyncExternalStore(
    subscribeServerConnectionState,
    getServerConnectionStateSnapshot,
  );
  const connectionReady = connectionState.phase === "ready";
  const connectionProfiles = resolveServerConnectionProfiles(settings.serverProfiles);
  const serverConfigQuery = useQuery(serverConfigQueryOptions({ enabled: connectionReady }));
  const providerInspectionQuery = useQuery(
    serverInspectProvidersQueryOptions(
      {
        providerOptions: {
          codex: {
            ...(settings.codexBinaryPath ? { binaryPath: settings.codexBinaryPath } : {}),
            ...(settings.codexHomePath ? { homePath: settings.codexHomePath } : {}),
          },
          cursor: {
            ...(settings.cursorBinaryPath ? { binaryPath: settings.cursorBinaryPath } : {}),
            ...(settings.cursorConfigDir ? { configDir: settings.cursorConfigDir } : {}),
          },
          opencode: {
            ...(settings.opencodeBinaryPath ? { binaryPath: settings.opencodeBinaryPath } : {}),
            ...(settings.opencodeHomePath ? { homePath: settings.opencodeHomePath } : {}),
          },
          claude: {
            ...(settings.claudeBinaryPath ? { binaryPath: settings.claudeBinaryPath } : {}),
            ...(settings.claudeSettingsPath ? { settingsPath: settings.claudeSettingsPath } : {}),
          },
          gemini: {
            ...(settings.geminiBinaryPath ? { binaryPath: settings.geminiBinaryPath } : {}),
            ...(settings.geminiHomePath ? { homePath: settings.geminiHomePath } : {}),
          },
        },
        includeModels: false,
      },
      { enabled: connectionReady },
    ),
  );
  const [isOpeningKeybindings, setIsOpeningKeybindings] = useState(false);
  const [openKeybindingsError, setOpenKeybindingsError] = useState<string | null>(null);
  const [customModelInputByProvider, setCustomModelInputByProvider] = useState<
    Record<ProviderKind, string>
  >({
    codex: "",
    cursor: "",
    opencode: "",
    claude: "",
    gemini: "",
  });
  const [customModelErrorByProvider, setCustomModelErrorByProvider] = useState<
    Partial<Record<ProviderKind, string | null>>
  >({});
  const [editingConnectionProfileId, setEditingConnectionProfileId] = useState<string | null>(null);
  const [connectionForm, setConnectionForm] = useState<ServerConnectionFormState>(
    toServerConnectionFormState(),
  );
  const [connectionFormError, setConnectionFormError] = useState<string | null>(null);
  const [desktopServerConnectionDetails, setDesktopServerConnectionDetails] =
    useState<DesktopServerConnectionDetails | null>(null);
  const [desktopAuthTokenInput, setDesktopAuthTokenInput] = useState("");
  const [desktopAuthTokenDirty, setDesktopAuthTokenDirty] = useState(false);
  const [desktopAuthTokenError, setDesktopAuthTokenError] = useState<string | null>(null);
  const [desktopAuthTokenPending, setDesktopAuthTokenPending] = useState(false);
  const [desktopRemoteAccessError, setDesktopRemoteAccessError] = useState<string | null>(null);
  const [desktopRemoteAccessPending, setDesktopRemoteAccessPending] = useState(false);
  const keybindingsConfigPath = serverConfigQuery.data?.keybindingsConfigPath ?? null;
  const availableEditors = serverConfigQuery.data?.availableEditors;
  const { copyToClipboard, isCopied } = useCopyToClipboard<{ label: string }>();
  const desktopRemoteCopyText =
    desktopServerConnectionDetails?.remoteAccessStatus === "reachable"
      ? (desktopServerConnectionDetails.selectedEndpoint?.copyText ?? null)
      : null;
  const desktopMobilePairingLink =
    desktopServerConnectionDetails?.remoteAccessStatus === "reachable" &&
    desktopServerConnectionDetails.selectedEndpoint
      ? buildMobilePairingLink({
          version: 1,
          label: `T3 Code (${desktopServerConnectionDetails.selectedEndpoint.label})`,
          serverUrl: desktopServerConnectionDetails.selectedEndpoint.serverUrl,
          authToken: desktopServerConnectionDetails.authToken,
        })
      : null;
  const desktopRemoteStatusLabel =
    desktopServerConnectionDetails?.remoteAccessStatus === "reachable"
      ? "Reachable"
      : desktopServerConnectionDetails?.remoteAccessStatus === "failed"
        ? "Failed"
        : desktopServerConnectionDetails?.remoteAccessStatus === "no-interface"
          ? "No interface"
          : desktopServerConnectionDetails?.remoteAccessStatus === "starting"
            ? "Checking"
            : "Disabled";
  const desktopAuthTokenChanged =
    desktopServerConnectionDetails !== null &&
    desktopAuthTokenInput.trim() !== desktopServerConnectionDetails.authToken;
  const desktopLocalEndpointDisplay = desktopServerConnectionDetails?.localWsUrl
    ? (() => {
        const url = new URL(desktopServerConnectionDetails.localWsUrl);
        url.search = "";
        return url.toString();
      })()
    : null;

  const refreshDesktopServerDetails = useCallback(async () => {
    if (!isElectron || typeof window.desktopBridge?.getServerConnectionDetails !== "function") {
      setDesktopServerConnectionDetails(null);
      return null;
    }
    try {
      const details = await window.desktopBridge.getServerConnectionDetails();
      setDesktopServerConnectionDetails(details);
      return details;
    } catch {
      setDesktopServerConnectionDetails(null);
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshDesktopServerDetails();
  }, [refreshDesktopServerDetails]);

  useEffect(() => {
    const savedToken = desktopServerConnectionDetails?.authToken ?? "";
    if (!desktopAuthTokenDirty || savedToken === desktopAuthTokenInput) {
      setDesktopAuthTokenInput(savedToken);
      setDesktopAuthTokenDirty(false);
    }
  }, [desktopAuthTokenDirty, desktopAuthTokenInput, desktopServerConnectionDetails?.authToken]);

  useEffect(() => {
    if (desktopServerConnectionDetails?.remoteAccessStatus !== "starting") {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      void refreshDesktopServerDetails();
    }, 1000);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [desktopServerConnectionDetails?.remoteAccessStatus, refreshDesktopServerDetails]);

  const setDesktopRemoteAccessEnabled = useCallback(async (enabled: boolean) => {
    if (!isElectron || typeof window.desktopBridge?.setRemoteAccessEnabled !== "function") {
      return;
    }
    setDesktopRemoteAccessError(null);
    setDesktopRemoteAccessPending(true);
    setDesktopServerConnectionDetails((current) =>
      current
        ? {
            ...current,
            remoteAccessEnabled: enabled,
            remoteAccessStatus: enabled
              ? current.selectedEndpoint
                ? "starting"
                : "no-interface"
              : "disabled",
            diagnosticMessage: enabled ? "Checking remote listener availability..." : null,
          }
        : current,
    );
    try {
      const details = await window.desktopBridge.setRemoteAccessEnabled(enabled);
      setDesktopServerConnectionDetails(details);
    } catch (error) {
      setDesktopRemoteAccessError(
        error instanceof Error ? error.message : "Unable to update remote access.",
      );
    } finally {
      setDesktopRemoteAccessPending(false);
    }
  }, []);

  const retryDesktopRemoteAccessProbe = useCallback(async () => {
    if (!isElectron || typeof window.desktopBridge?.retryRemoteAccessProbe !== "function") {
      return;
    }
    setDesktopRemoteAccessError(null);
    setDesktopRemoteAccessPending(true);
    setDesktopServerConnectionDetails((current) =>
      current
        ? {
            ...current,
            remoteAccessStatus: current.selectedEndpoint ? "starting" : current.remoteAccessStatus,
            diagnosticMessage: current.selectedEndpoint
              ? "Checking remote listener availability..."
              : current.diagnosticMessage,
          }
        : current,
    );
    try {
      const details = await window.desktopBridge.retryRemoteAccessProbe();
      setDesktopServerConnectionDetails(details);
    } catch (error) {
      setDesktopRemoteAccessError(
        error instanceof Error ? error.message : "Unable to retry remote access.",
      );
    } finally {
      setDesktopRemoteAccessPending(false);
    }
  }, []);

  const reconnectDesktopLocalProfile = useCallback(() => {
    if (connectionState.activeProfileId === SYSTEM_DESKTOP_LOCAL_PROFILE_ID) {
      retryActiveConnection();
    }
  }, [connectionState.activeProfileId]);

  const saveDesktopAuthToken = useCallback(async () => {
    if (!isElectron || typeof window.desktopBridge?.setServerAuthToken !== "function") {
      return;
    }
    const normalizedToken = desktopAuthTokenInput.trim();
    if (normalizedToken.length === 0) {
      setDesktopAuthTokenError("Auth token cannot be empty.");
      return;
    }

    setDesktopAuthTokenError(null);
    setDesktopAuthTokenPending(true);
    try {
      const details = await window.desktopBridge.setServerAuthToken(normalizedToken);
      setDesktopServerConnectionDetails(details);
      setDesktopAuthTokenInput(details.authToken);
      setDesktopAuthTokenDirty(false);
      reconnectDesktopLocalProfile();
    } catch (error) {
      setDesktopAuthTokenError(
        error instanceof Error ? error.message : "Unable to update the auth token.",
      );
    } finally {
      setDesktopAuthTokenPending(false);
    }
  }, [desktopAuthTokenInput, reconnectDesktopLocalProfile]);

  const regenerateDesktopAuthToken = useCallback(async () => {
    if (!isElectron || typeof window.desktopBridge?.regenerateServerAuthToken !== "function") {
      return;
    }

    setDesktopAuthTokenError(null);
    setDesktopAuthTokenPending(true);
    try {
      const details = await window.desktopBridge.regenerateServerAuthToken();
      setDesktopServerConnectionDetails(details);
      setDesktopAuthTokenInput(details.authToken);
      setDesktopAuthTokenDirty(false);
      reconnectDesktopLocalProfile();
    } catch (error) {
      setDesktopAuthTokenError(
        error instanceof Error ? error.message : "Unable to generate a new auth token.",
      );
    } finally {
      setDesktopAuthTokenPending(false);
    }
  }, [reconnectDesktopLocalProfile]);

  const openKeybindingsFile = useCallback(() => {
    if (!keybindingsConfigPath) return;
    setOpenKeybindingsError(null);
    setIsOpeningKeybindings(true);
    const api = ensureNativeApi();
    const editor = resolveAndPersistPreferredEditor(availableEditors ?? []);
    if (!editor) {
      setOpenKeybindingsError("No available editors found.");
      setIsOpeningKeybindings(false);
      return;
    }
    void api.shell
      .openInEditor(keybindingsConfigPath, editor)
      .catch((error) => {
        setOpenKeybindingsError(
          error instanceof Error ? error.message : "Unable to open keybindings file.",
        );
      })
      .finally(() => {
        setIsOpeningKeybindings(false);
      });
  }, [availableEditors, keybindingsConfigPath]);

  const resetConnectionForm = useCallback((profile?: ServerConnectionProfile | null) => {
    setEditingConnectionProfileId(profile?.id ?? null);
    setConnectionForm(toServerConnectionFormState(profile));
    setConnectionFormError(null);
  }, []);

  const saveConnectionProfile = useCallback(() => {
    const parsedUrl = normalizeServerConnectionUrl(connectionForm.serverUrl);
    if (!parsedUrl.ok || !parsedUrl.normalizedUrl) {
      setConnectionFormError(parsedUrl.error);
      return;
    }
    const normalizedServerUrl = parsedUrl.normalizedUrl;

    const now = new Date().toISOString();
    const profileId = editingConnectionProfileId ?? crypto.randomUUID();
    const label =
      connectionForm.label.trim().length > 0
        ? connectionForm.label.trim()
        : new URL(normalizedServerUrl).host;
    if (
      settings.serverProfiles.some(
        (profile) => profile.id !== profileId && profile.serverUrl === normalizedServerUrl,
      )
    ) {
      setConnectionFormError("A profile for that server already exists.");
      return;
    }

    patchStoredAppSettings((current) => {
      const existingProfile = current.serverProfiles.find((profile) => profile.id === profileId);
      return {
        ...current,
        serverProfiles: [
          ...current.serverProfiles.filter((profile) => profile.id !== profileId),
          {
            id: profileId,
            label,
            serverUrl: normalizedServerUrl,
            authToken: connectionForm.authToken.trim(),
            createdAt: existingProfile?.createdAt ?? now,
            updatedAt: now,
          },
        ],
      };
    });

    setEditingConnectionProfileId(profileId);
    setConnectionFormError(null);
    if (connectionState.activeProfileId === profileId) {
      switchConnectionProfile(profileId);
    }
  }, [
    connectionForm.authToken,
    connectionForm.label,
    connectionForm.serverUrl,
    connectionState.activeProfileId,
    editingConnectionProfileId,
    settings.serverProfiles,
  ]);

  const deleteConnectionProfile = useCallback(
    (profileId: string) => {
      const fallbackProfileId =
        connectionState.primarySystemProfile?.id ?? getDefaultServerProfileId();
      patchStoredAppSettings((current) => ({
        ...current,
        serverProfiles: current.serverProfiles.filter((profile) => profile.id !== profileId),
        activeServerProfileId:
          current.activeServerProfileId === profileId
            ? fallbackProfileId
            : current.activeServerProfileId,
      }));
      if (editingConnectionProfileId === profileId) {
        resetConnectionForm();
      }
      if (connectionState.activeProfileId === profileId) {
        switchConnectionProfile(fallbackProfileId);
      }
    },
    [
      connectionState.activeProfileId,
      connectionState.primarySystemProfile?.id,
      editingConnectionProfileId,
      resetConnectionForm,
    ],
  );

  const addCustomModel = useCallback(
    (provider: ProviderKind) => {
      const customModelInput = customModelInputByProvider[provider];
      const customModels = getCustomModelsForProvider(settings, provider);
      const normalized = normalizeModelSlug(customModelInput, provider);
      if (!normalized) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: "Enter a model slug.",
        }));
        return;
      }
      if (getModelOptions(provider).some((option) => option.slug === normalized)) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: "That model is already built in.",
        }));
        return;
      }
      if (normalized.length > MAX_CUSTOM_MODEL_LENGTH) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: `Model slugs must be ${MAX_CUSTOM_MODEL_LENGTH} characters or less.`,
        }));
        return;
      }
      if (customModels.includes(normalized)) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: "That custom model is already saved.",
        }));
        return;
      }

      updateSettings(patchCustomModelsForProvider(provider, [...customModels, normalized]));
      setCustomModelInputByProvider((existing) => ({
        ...existing,
        [provider]: "",
      }));
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: null,
      }));
    },
    [customModelInputByProvider, settings, updateSettings],
  );

  const removeCustomModel = useCallback(
    (provider: ProviderKind, slug: string) => {
      const customModels = getCustomModelsForProvider(settings, provider);
      updateSettings(
        patchCustomModelsForProvider(
          provider,
          customModels.filter((model) => model !== slug),
        ),
      );
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: null,
      }));
    },
    [settings, updateSettings],
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {isElectron && (
          <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground/70">
              Settings
            </span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
            <header className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
              <p className="text-sm text-muted-foreground">
                Configure app-level preferences for this device.
              </p>
            </header>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-sm font-medium text-foreground">Server Connections</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Connect this client to the bundled local server or a remote LAN/Tailscale host.
                  </p>
                </div>
                <div className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground">
                  {connectionState.phase === "ready"
                    ? "Connected"
                    : connectionState.phase === "failed"
                      ? "Unavailable"
                      : "Connecting"}
                </div>
              </div>

              <div className="space-y-3">
                <div className="rounded-lg border border-border bg-background px-3 py-2">
                  <p className="text-sm font-medium text-foreground">
                    Active: {connectionState.activeProfile?.label ?? "Unavailable"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {connectionState.endpointDisplay ?? "No endpoint selected"}
                  </p>
                </div>

                {isElectron && desktopServerConnectionDetails ? (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-border bg-background px-3 py-3">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground">
                          Local server auth token
                        </p>
                        <p className="text-xs text-muted-foreground">
                          The desktop app generates this token on first launch and reuses it across
                          restarts and app updates until you change or regenerate it.
                        </p>
                      </div>

                      <div className="mt-3 grid gap-3">
                        <Input
                          value={desktopAuthTokenInput}
                          onChange={(event) => {
                            setDesktopAuthTokenInput(event.target.value);
                            setDesktopAuthTokenDirty(true);
                            setDesktopAuthTokenError(null);
                          }}
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          className="font-mono text-xs"
                          placeholder="Desktop auth token"
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="xs"
                            disabled={!desktopAuthTokenChanged || desktopAuthTokenPending}
                            onClick={() => void saveDesktopAuthToken()}
                          >
                            Save token
                          </Button>
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={desktopAuthTokenPending}
                            onClick={() => void regenerateDesktopAuthToken()}
                          >
                            Generate new token
                          </Button>
                        </div>
                        {desktopLocalEndpointDisplay ? (
                          <div>
                            <p className="text-xs font-medium text-foreground">Local endpoint</p>
                            <p className="break-all text-xs text-muted-foreground">
                              {desktopLocalEndpointDisplay}
                            </p>
                          </div>
                        ) : null}
                        {desktopAuthTokenError ? (
                          <p className="text-xs text-red-600">{desktopAuthTokenError}</p>
                        ) : null}
                      </div>
                    </div>

                    <div className="rounded-lg border border-border bg-background px-3 py-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-foreground">Remote access</p>
                          <p className="text-xs text-muted-foreground">
                            Keep the bundled desktop server local-only by default, then explicitly
                            expose one Tailscale or LAN endpoint when you need another T3 Code app
                            to connect.
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground">
                            {desktopRemoteStatusLabel}
                          </span>
                          <Switch
                            checked={desktopServerConnectionDetails.remoteAccessEnabled}
                            disabled={desktopRemoteAccessPending}
                            onCheckedChange={(checked) =>
                              void setDesktopRemoteAccessEnabled(Boolean(checked))
                            }
                          />
                        </div>
                      </div>

                      <div className="mt-3 rounded-md border border-border/70 px-3 py-3">
                        {desktopServerConnectionDetails.remoteAccessStatus === "disabled" ? (
                          <div className="space-y-2">
                            <p className="text-sm font-medium text-foreground">
                              Remote access is off
                            </p>
                            <p className="text-xs text-muted-foreground">
                              This desktop app is only listening on loopback. Enable remote access
                              to bind one shareable Tailscale-first endpoint.
                            </p>
                          </div>
                        ) : desktopServerConnectionDetails.remoteAccessStatus === "no-interface" ? (
                          <div className="space-y-2">
                            <p className="text-sm font-medium text-foreground">
                              No usable remote interface
                            </p>
                            <p className="text-xs text-muted-foreground">
                              No Tailscale or private LAN IPv4 address was detected on this machine.
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div>
                              <p className="text-sm font-medium text-foreground">
                                {desktopServerConnectionDetails.selectedEndpoint?.label ??
                                  "Remote endpoint"}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {desktopServerConnectionDetails.selectedEndpoint?.serverUrl ??
                                  "No endpoint selected"}
                              </p>
                            </div>

                            {desktopServerConnectionDetails.healthcheckUrl ? (
                              <div>
                                <p className="text-xs font-medium text-foreground">Healthcheck</p>
                                <p className="break-all text-xs text-muted-foreground">
                                  {desktopServerConnectionDetails.healthcheckUrl}
                                </p>
                              </div>
                            ) : null}

                            {desktopServerConnectionDetails.remoteAccessStatus === "reachable" ? (
                              <div className="flex flex-wrap gap-2">
                                {desktopRemoteCopyText ? (
                                  <Button
                                    size="xs"
                                    variant="outline"
                                    onClick={() =>
                                      copyToClipboard(desktopRemoteCopyText, {
                                        label: "remote-access",
                                      })
                                    }
                                  >
                                    {isCopied ? "Copied" : "Copy details"}
                                  </Button>
                                ) : null}
                              </div>
                            ) : null}

                            {desktopServerConnectionDetails.remoteAccessStatus === "starting" ? (
                              <p className="text-xs text-muted-foreground">
                                {desktopServerConnectionDetails.diagnosticMessage ??
                                  "Checking whether the selected remote endpoint is reachable."}
                              </p>
                            ) : null}

                            {desktopServerConnectionDetails.remoteAccessStatus === "failed" ? (
                              <div className="space-y-2">
                                <p className="text-xs text-red-600">
                                  {desktopServerConnectionDetails.diagnosticMessage ??
                                    "Remote access probe failed."}
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  <Button
                                    size="xs"
                                    variant="outline"
                                    disabled={desktopRemoteAccessPending}
                                    onClick={() => void retryDesktopRemoteAccessProbe()}
                                  >
                                    Retry
                                  </Button>
                                </div>
                                <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                                  <li>
                                    Allow incoming connections for T3 Code in the macOS firewall.
                                  </li>
                                  <li>Verify that Tailscale is connected on both devices.</li>
                                  <li>
                                    Try opening the healthcheck URL from the other machine to
                                    confirm basic reachability.
                                  </li>
                                </ul>
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>

                      {desktopRemoteAccessError ? (
                        <p className="mt-3 text-xs text-red-600">{desktopRemoteAccessError}</p>
                      ) : null}

                      {desktopServerConnectionDetails.endpoints.length > 0 ? (
                        <div className="mt-3 space-y-2">
                          <p className="text-xs font-medium text-foreground">Detected interfaces</p>
                          {desktopServerConnectionDetails.endpoints.map((endpoint) => (
                            <div
                              key={`${endpoint.interfaceName}:${endpoint.address}`}
                              className={`rounded-md border px-3 py-2 ${
                                desktopServerConnectionDetails.selectedEndpoint?.address ===
                                endpoint.address
                                  ? "border-primary/40 bg-primary/5"
                                  : "border-border/70"
                              }`}
                            >
                              <p className="text-sm font-medium text-foreground">
                                {endpoint.label}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {endpoint.serverUrl}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {desktopMobilePairingLink ? (
                        <div className="mt-3 rounded-lg border border-border bg-background px-3 py-3">
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="space-y-2">
                              <div className="space-y-1">
                                <p className="text-sm font-medium text-foreground">
                                  Mobile Companion
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Scan this QR code from the mobile companion or copy the pairing
                                  link directly.
                                </p>
                              </div>
                              <p className="break-all rounded-md border border-border/70 bg-secondary px-2 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                                {desktopMobilePairingLink}
                              </p>
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  size="xs"
                                  variant="outline"
                                  onClick={() =>
                                    copyToClipboard(desktopMobilePairingLink, {
                                      label: "mobile-pairing",
                                    })
                                  }
                                >
                                  {isCopied ? "Copied" : "Copy pairing link"}
                                </Button>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                Treat this QR code and link like credentials. Regenerating the
                                desktop auth token invalidates saved mobile access.
                              </p>
                            </div>
                            <MobilePairingQrCode value={desktopMobilePairingLink} />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div className="space-y-2">
                  {connectionProfiles.map((profile) => {
                    const isActive = connectionState.activeProfileId === profile.id;
                    const missingTokenWarning =
                      !isLocalServerProfile(profile) && profile.authToken.trim().length === 0;
                    const isSystemProfile = settings.serverProfiles.every(
                      (savedProfile) => savedProfile.id !== profile.id,
                    );
                    return (
                      <div
                        key={profile.id}
                        className={`rounded-lg border px-3 py-3 ${
                          isActive
                            ? "border-primary/50 bg-primary/5"
                            : "border-border bg-background"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground">{profile.label}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {profile.serverUrl}
                            </p>
                            {missingTokenWarning ? (
                              <p className="mt-1 text-xs text-amber-600">
                                Remote connections are safer with an auth token.
                              </p>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 flex-wrap justify-end gap-2">
                            <Button
                              size="xs"
                              variant={isActive ? "secondary" : "outline"}
                              onClick={() => switchConnectionProfile(profile.id)}
                            >
                              {isActive ? "Connected" : "Connect"}
                            </Button>
                            {isSystemProfile ? null : (
                              <>
                                <Button
                                  size="xs"
                                  variant="outline"
                                  onClick={() => resetConnectionForm(profile)}
                                >
                                  Edit
                                </Button>
                                <Button
                                  size="xs"
                                  variant="outline"
                                  onClick={() => deleteConnectionProfile(profile.id)}
                                >
                                  Delete
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="rounded-lg border border-dashed border-border bg-background px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {editingConnectionProfileId ? "Edit remote profile" : "Add remote profile"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Accepted formats: <code>192.168.1.42:3773</code>,{" "}
                        <code>ws://host:3773</code>, <code>https://tailnet-host</code>
                      </p>
                    </div>
                    {editingConnectionProfileId ? (
                      <Button size="xs" variant="outline" onClick={() => resetConnectionForm()}>
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                  <div className="mt-3 grid gap-3">
                    <Input
                      value={connectionForm.label}
                      onChange={(event) =>
                        setConnectionForm((current) => ({ ...current, label: event.target.value }))
                      }
                      placeholder="Profile label"
                    />
                    <Input
                      value={connectionForm.serverUrl}
                      onChange={(event) =>
                        setConnectionForm((current) => ({
                          ...current,
                          serverUrl: event.target.value,
                        }))
                      }
                      placeholder="ws://192.168.1.42:3773"
                    />
                    <Input
                      value={connectionForm.authToken}
                      onChange={(event) =>
                        setConnectionForm((current) => ({
                          ...current,
                          authToken: event.target.value,
                        }))
                      }
                      placeholder="Optional auth token"
                    />
                    {connectionFormError ? (
                      <p className="text-xs text-red-600">{connectionFormError}</p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={saveConnectionProfile}>
                        Save profile
                      </Button>
                      {connectionState.primarySystemProfile ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (!connectionState.primarySystemProfile) {
                              return;
                            }
                            switchConnectionProfile(connectionState.primarySystemProfile.id);
                          }}
                        >
                          {connectionState.primarySystemProfile.id === "system:desktop-local"
                            ? "Use local server"
                            : "Use current origin"}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Appearance</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Choose how T3 Code looks across the app.
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2" role="radiogroup" aria-label="Theme preference">
                  {THEME_OPTIONS.map((option) => {
                    const selected = theme === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={`flex w-full items-start justify-between rounded-lg border px-3 py-2 text-left transition-colors ${
                          selected
                            ? "border-primary/60 bg-primary/8 text-foreground"
                            : "border-border bg-background text-muted-foreground hover:bg-accent"
                        }`}
                        onClick={() => setTheme(option.value)}
                      >
                        <span className="flex flex-col">
                          <span className="text-sm font-medium">{option.label}</span>
                          <span className="text-xs">{option.description}</span>
                        </span>
                        {selected ? (
                          <span className="rounded bg-primary/14 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                            Selected
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>

                <p className="text-xs text-muted-foreground">
                  Active theme: <span className="font-medium text-foreground">{resolvedTheme}</span>
                </p>

                <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">Timestamp format</p>
                    <p className="text-xs text-muted-foreground">
                      System default follows your browser or OS time format. <code>12-hour</code>{" "}
                      and <code>24-hour</code> force the hour cycle.
                    </p>
                  </div>
                  <Select
                    value={settings.timestampFormat}
                    onValueChange={(value) => {
                      if (value !== "locale" && value !== "12-hour" && value !== "24-hour") return;
                      updateSettings({
                        timestampFormat: value,
                      });
                    }}
                  >
                    <SelectTrigger className="w-40" aria-label="Timestamp format">
                      <SelectValue>{TIMESTAMP_FORMAT_LABELS[settings.timestampFormat]}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end">
                      <SelectItem value="locale">{TIMESTAMP_FORMAT_LABELS.locale}</SelectItem>
                      <SelectItem value="12-hour">{TIMESTAMP_FORMAT_LABELS["12-hour"]}</SelectItem>
                      <SelectItem value="24-hour">{TIMESTAMP_FORMAT_LABELS["24-hour"]}</SelectItem>
                    </SelectPopup>
                  </Select>
                </div>

                {settings.timestampFormat !== defaults.timestampFormat ? (
                  <div className="flex justify-end">
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        updateSettings({
                          timestampFormat: defaults.timestampFormat,
                        })
                      }
                    >
                      Restore default
                    </Button>
                  </div>
                ) : null}
              </div>
            </section>

            {PROVIDER_OVERRIDE_SETTINGS.map((providerSettings) => {
              const binaryPath = getProviderBinaryPath(settings, providerSettings.provider);
              const configPath = getProviderConfigPath(settings, providerSettings.provider);
              const providerStatus = providerInspectionQuery.data?.providers.find(
                (provider) => provider.provider === providerSettings.provider,
              );
              return (
                <section
                  key={providerSettings.provider}
                  className="rounded-2xl border border-border bg-card p-5"
                >
                  <div className="mb-4">
                    <h2 className="text-sm font-medium text-foreground">
                      {providerSettings.title}
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {providerSettings.description}
                    </p>
                  </div>

                  <div className="space-y-4">
                    <label
                      htmlFor={`${providerSettings.provider}-binary-path`}
                      className="block space-y-1"
                    >
                      <span className="text-xs font-medium text-foreground">
                        {providerSettings.binaryLabel}
                      </span>
                      <Input
                        id={`${providerSettings.provider}-binary-path`}
                        value={binaryPath}
                        onChange={(event) =>
                          updateSettings(
                            patchProviderOverride(providerSettings.provider, {
                              binaryPath: event.target.value,
                            }),
                          )
                        }
                        placeholder={providerSettings.binaryPlaceholder}
                        spellCheck={false}
                      />
                      <span className="text-xs text-muted-foreground">
                        Leave blank to use <code>{providerSettings.binaryPlaceholder}</code> from
                        your PATH.
                      </span>
                    </label>

                    <label
                      htmlFor={`${providerSettings.provider}-config-path`}
                      className="block space-y-1"
                    >
                      <span className="text-xs font-medium text-foreground">
                        {providerSettings.configLabel}
                      </span>
                      <Input
                        id={`${providerSettings.provider}-config-path`}
                        value={configPath}
                        onChange={(event) =>
                          updateSettings(
                            patchProviderOverride(providerSettings.provider, {
                              configPath: event.target.value,
                            }),
                          )
                        }
                        placeholder={providerSettings.configPlaceholder}
                        spellCheck={false}
                      />
                      <span className="text-xs text-muted-foreground">
                        {providerSettings.configHelp}
                      </span>
                    </label>

                    <div className="flex flex-col gap-3 text-xs text-muted-foreground sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1 space-y-2">
                        <div>
                          <p>Binary source</p>
                          <p className="mt-1 break-all font-mono text-[11px] text-foreground">
                            {binaryPath || "PATH"}
                          </p>
                        </div>
                        <div>
                          <p>Detection</p>
                          <p className="mt-1 text-foreground">
                            {providerStatus?.available ? "Found" : "Not found"}
                          </p>
                        </div>
                      </div>
                      <Button
                        size="xs"
                        variant="outline"
                        className="self-start"
                        onClick={() =>
                          updateSettings(resetProviderOverride(defaults, providerSettings.provider))
                        }
                      >
                        Reset {providerSettings.provider} overrides
                      </Button>
                    </div>
                  </div>
                </section>
              );
            })}

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Models</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Save additional provider model slugs so they appear in the chat model picker and
                  `/model` command suggestions.
                </p>
              </div>

              <div className="space-y-5">
                {MODEL_PROVIDER_SETTINGS.map((providerSettings) => {
                  const provider = providerSettings.provider;
                  const customModels = getCustomModelsForProvider(settings, provider);
                  const customModelInput = customModelInputByProvider[provider];
                  const customModelError = customModelErrorByProvider[provider] ?? null;
                  return (
                    <div
                      key={provider}
                      className="rounded-xl border border-border bg-background/50 p-4"
                    >
                      <div className="mb-4">
                        <h3 className="text-sm font-medium text-foreground">
                          {providerSettings.title}
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {providerSettings.description}
                        </p>
                      </div>

                      <div className="space-y-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                          <label
                            htmlFor={`custom-model-slug-${provider}`}
                            className="block flex-1 space-y-1"
                          >
                            <span className="text-xs font-medium text-foreground">
                              Custom model slug
                            </span>
                            <Input
                              id={`custom-model-slug-${provider}`}
                              value={customModelInput}
                              onChange={(event) => {
                                const value = event.target.value;
                                setCustomModelInputByProvider((existing) => ({
                                  ...existing,
                                  [provider]: value,
                                }));
                                if (customModelError) {
                                  setCustomModelErrorByProvider((existing) => ({
                                    ...existing,
                                    [provider]: null,
                                  }));
                                }
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter") return;
                                event.preventDefault();
                                addCustomModel(provider);
                              }}
                              placeholder={providerSettings.placeholder}
                              spellCheck={false}
                            />
                            <span className="text-xs text-muted-foreground">
                              Example: <code>{providerSettings.example}</code>
                            </span>
                          </label>

                          <Button
                            className="sm:mt-6"
                            type="button"
                            onClick={() => addCustomModel(provider)}
                          >
                            Add model
                          </Button>
                        </div>

                        {customModelError ? (
                          <p className="text-xs text-destructive">{customModelError}</p>
                        ) : null}

                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <p>Saved custom models: {customModels.length}</p>
                            {customModels.length > 0 ? (
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() =>
                                  updateSettings(
                                    patchCustomModelsForProvider(provider, [
                                      ...getDefaultCustomModelsForProvider(defaults, provider),
                                    ]),
                                  )
                                }
                              >
                                Reset custom models
                              </Button>
                            ) : null}
                          </div>

                          {customModels.length > 0 ? (
                            <div className="space-y-2">
                              {customModels.map((slug) => (
                                <div
                                  key={`${provider}:${slug}`}
                                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2"
                                >
                                  <code className="min-w-0 flex-1 truncate text-xs text-foreground">
                                    {slug}
                                  </code>
                                  <Button
                                    size="xs"
                                    variant="ghost"
                                    onClick={() => removeCustomModel(provider, slug)}
                                  >
                                    Remove
                                  </Button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="rounded-lg border border-dashed border-border bg-background px-3 py-4 text-xs text-muted-foreground">
                              No custom models saved yet.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Threads</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Choose the default workspace mode for newly created draft threads.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Default to New worktree</p>
                  <p className="text-xs text-muted-foreground">
                    New threads start in New worktree mode instead of Local.
                  </p>
                </div>
                <Switch
                  checked={settings.defaultThreadEnvMode === "worktree"}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      defaultThreadEnvMode: checked ? "worktree" : "local",
                    })
                  }
                  aria-label="Default new threads to New worktree mode"
                />
              </div>

              {settings.defaultThreadEnvMode !== defaults.defaultThreadEnvMode ? (
                <div className="mt-3 flex justify-end">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      updateSettings({
                        defaultThreadEnvMode: defaults.defaultThreadEnvMode,
                      })
                    }
                  >
                    Restore default
                  </Button>
                </div>
              ) : null}
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Responses</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Control how assistant output is rendered during a turn.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Stream assistant messages</p>
                  <p className="text-xs text-muted-foreground">
                    Show token-by-token output while a response is in progress.
                  </p>
                </div>
                <Switch
                  checked={settings.enableAssistantStreaming}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      enableAssistantStreaming: Boolean(checked),
                    })
                  }
                  aria-label="Stream assistant messages"
                />
              </div>

              {settings.enableAssistantStreaming !== defaults.enableAssistantStreaming ? (
                <div className="mt-3 flex justify-end">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      updateSettings({
                        enableAssistantStreaming: defaults.enableAssistantStreaming,
                      })
                    }
                  >
                    Restore default
                  </Button>
                </div>
              ) : null}
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Keybindings</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Open the persisted <code>keybindings.json</code> file to edit advanced bindings
                  directly.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground">Config file path</p>
                    <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                      {keybindingsConfigPath ?? "Resolving keybindings path..."}
                    </p>
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={!keybindingsConfigPath || isOpeningKeybindings}
                    onClick={openKeybindingsFile}
                  >
                    {isOpeningKeybindings ? "Opening..." : "Open keybindings.json"}
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  Opens in your preferred editor selection.
                </p>
                {openKeybindingsError ? (
                  <p className="text-xs text-destructive">{openKeybindingsError}</p>
                ) : null}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">Safety</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Additional guardrails for destructive local actions.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Confirm thread deletion</p>
                  <p className="text-xs text-muted-foreground">
                    Ask for confirmation before deleting a thread and its chat history.
                  </p>
                </div>
                <Switch
                  checked={settings.confirmThreadDelete}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      confirmThreadDelete: Boolean(checked),
                    })
                  }
                  aria-label="Confirm thread deletion"
                />
              </div>

              {settings.confirmThreadDelete !== defaults.confirmThreadDelete ? (
                <div className="mt-3 flex justify-end">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      updateSettings({
                        confirmThreadDelete: defaults.confirmThreadDelete,
                      })
                    }
                  >
                    Restore default
                  </Button>
                </div>
              ) : null}
            </section>
            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-4">
                <h2 className="text-sm font-medium text-foreground">About</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Application version and environment information.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Version</p>
                  <p className="text-xs text-muted-foreground">
                    Current version of the application.
                  </p>
                </div>
                <code className="text-xs font-medium text-muted-foreground">{APP_VERSION}</code>
              </div>
            </section>
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/settings")({
  component: SettingsRouteView,
});
