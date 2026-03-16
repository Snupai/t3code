import {
  ORCHESTRATION_WS_CHANNELS,
  ORCHESTRATION_WS_METHODS,
  type ContextMenuItem,
  type NativeApi,
  type OrchestrationEvent,
  ServerConfigUpdatedPayload,
  type TerminalEvent,
  WS_CHANNELS,
  WS_METHODS,
  type WsPushChannel,
  type WsPushMessage,
  type WsWelcomePayload,
} from "@t3tools/contracts";

import { patchStoredAppSettings, readStoredAppSettings, setStoredAppSettings } from "./appSettings";
import {
  flushComposerDraftStorage,
  rehydrateComposerDraftStoreForCurrentServerScope,
} from "./composerDraftStore";
import { showContextMenuFallback } from "./contextMenuFallback";
import { clearThreadSelection } from "./threadSelectionStore";
import {
  buildServerConnectionWebSocketUrl,
  getDefaultServerProfileId,
  getServerConnectionEndpointDisplay,
  getServerConnectionScopeKey,
  getSystemConnectionProfiles,
  isLocalServerProfile,
  resolveServerConnectionProfileById,
  type ServerConnectionProfile,
} from "./serverConnection";
import { setCurrentServerScopeKey } from "./serverScope";
import { flushScopedStoreState, rehydrateStoreForCurrentServerScope } from "./store";
import { rehydrateTerminalStateStoreForCurrentServerScope } from "./terminalStateStore";
import { type TransportState, type TransportStateSnapshot, WsTransport } from "./wsTransport";

interface ServerConnectionStateSnapshot {
  readonly phase: "connecting" | "ready" | "failed";
  readonly transportState: TransportState;
  readonly activeProfile: ServerConnectionProfile | null;
  readonly activeProfileId: string | null;
  readonly endpointDisplay: string | null;
  readonly errorMessage: string | null;
  readonly primarySystemProfile: ServerConnectionProfile | null;
}

let instance: { api: NativeApi } | null = null;
let transport: WsTransport | null = null;
let transportUnsubscribers: Array<() => void> = [];
let connectionTimeout: ReturnType<typeof setTimeout> | null = null;
let connectionGeneration = 0;
let welcomeReceived = false;
let latestPushByChannel = new Map<WsPushChannel, WsPushMessage<WsPushChannel>>();

const CONNECTION_FAILURE_TIMEOUT_MS = 8_000;
const welcomeListeners = new Set<(payload: WsWelcomePayload) => void>();
const serverConfigUpdatedListeners = new Set<(payload: ServerConfigUpdatedPayload) => void>();
const terminalEventListeners = new Set<(event: TerminalEvent) => void>();
const orchestrationEventListeners = new Set<(event: OrchestrationEvent) => void>();
const connectionStateListeners = new Set<(snapshot: ServerConnectionStateSnapshot) => void>();

let connectionState: ServerConnectionStateSnapshot = {
  phase: "connecting",
  transportState: "connecting",
  activeProfile: null,
  activeProfileId: null,
  endpointDisplay: null,
  errorMessage: null,
  primarySystemProfile: getSystemConnectionProfiles()[0] ?? null,
};

function emitConnectionState() {
  for (const listener of connectionStateListeners) {
    try {
      listener(connectionState);
    } catch {
      // Swallow listener errors.
    }
  }
}

function setConnectionState(nextState: Partial<ServerConnectionStateSnapshot>) {
  connectionState = {
    ...connectionState,
    ...nextState,
    primarySystemProfile: getSystemConnectionProfiles()[0] ?? null,
  };
  emitConnectionState();
}

function clearConnectionTimeout() {
  if (connectionTimeout !== null) {
    clearTimeout(connectionTimeout);
    connectionTimeout = null;
  }
}

function scheduleConnectionFailure(generation: number) {
  clearConnectionTimeout();
  connectionTimeout = setTimeout(() => {
    if (generation !== connectionGeneration || welcomeReceived) {
      return;
    }
    setConnectionState({
      phase: "failed",
      errorMessage: "Server unavailable or authentication failed.",
    });
  }, CONNECTION_FAILURE_TIMEOUT_MS);
}

function resolveActiveProfile(): ServerConnectionProfile {
  const settings = readStoredAppSettings();
  const resolvedProfile =
    resolveServerConnectionProfileById(settings.serverProfiles, settings.activeServerProfileId) ??
    resolveServerConnectionProfileById(settings.serverProfiles, getDefaultServerProfileId());
  if (!resolvedProfile) {
    throw new Error("No server connection profile is available.");
  }
  if (settings.activeServerProfileId !== resolvedProfile.id) {
    setStoredAppSettings({
      ...settings,
      activeServerProfileId: resolvedProfile.id,
    });
  }
  return resolvedProfile;
}

function applyServerScope(profile: ServerConnectionProfile) {
  flushScopedStoreState();
  flushComposerDraftStorage();
  setCurrentServerScopeKey(getServerConnectionScopeKey(profile));
  rehydrateStoreForCurrentServerScope();
  rehydrateComposerDraftStoreForCurrentServerScope();
  rehydrateTerminalStateStoreForCurrentServerScope();
  clearThreadSelection();
}

function disposeTransport() {
  clearConnectionTimeout();
  for (const unsubscribe of transportUnsubscribers) {
    unsubscribe();
  }
  transportUnsubscribers = [];
  transport?.dispose();
  transport = null;
}

function updateTransportState(snapshot: TransportStateSnapshot, generation: number) {
  if (generation !== connectionGeneration) {
    return;
  }
  if (snapshot.state === "open") {
    setConnectionState({
      transportState: snapshot.state,
      phase: welcomeReceived ? "ready" : "connecting",
      errorMessage: null,
    });
    if (!welcomeReceived) {
      scheduleConnectionFailure(generation);
    }
    return;
  }

  if (snapshot.state === "disposed") {
    return;
  }

  if (welcomeReceived) {
    setConnectionState({
      transportState: snapshot.state,
      errorMessage: snapshot.lastErrorMessage,
    });
    scheduleConnectionFailure(generation);
    return;
  }

  setConnectionState({
    transportState: snapshot.state,
    phase: "connecting",
    errorMessage: snapshot.lastErrorMessage,
  });
  scheduleConnectionFailure(generation);
}

function setLatestPush<C extends WsPushChannel>(channel: C, message: WsPushMessage<C>) {
  latestPushByChannel.set(channel, message as WsPushMessage<WsPushChannel>);
}

function attachTransport(
  nextTransport: WsTransport,
  profile: ServerConnectionProfile,
  generation: number,
) {
  transportUnsubscribers.push(
    nextTransport.subscribeState((snapshot) => updateTransportState(snapshot, generation), {
      replayLatest: true,
    }),
  );
  transportUnsubscribers.push(
    nextTransport.subscribe(
      WS_CHANNELS.serverWelcome,
      (message) => {
        if (generation !== connectionGeneration) {
          return;
        }
        welcomeReceived = true;
        clearConnectionTimeout();
        setLatestPush(WS_CHANNELS.serverWelcome, message);
        setConnectionState({
          phase: "ready",
          transportState: "open",
          errorMessage: null,
          activeProfile: profile,
          activeProfileId: profile.id,
          endpointDisplay: getServerConnectionEndpointDisplay(profile),
        });
        for (const listener of welcomeListeners) {
          try {
            listener(message.data);
          } catch {
            // Swallow listener errors.
          }
        }
      },
      { replayLatest: false },
    ),
  );
  transportUnsubscribers.push(
    nextTransport.subscribe(WS_CHANNELS.serverConfigUpdated, (message) => {
      if (generation !== connectionGeneration) {
        return;
      }
      setLatestPush(WS_CHANNELS.serverConfigUpdated, message);
      for (const listener of serverConfigUpdatedListeners) {
        try {
          listener(message.data);
        } catch {
          // Swallow listener errors.
        }
      }
    }),
  );
  transportUnsubscribers.push(
    nextTransport.subscribe(WS_CHANNELS.terminalEvent, (message) => {
      if (generation !== connectionGeneration) {
        return;
      }
      for (const listener of terminalEventListeners) {
        try {
          listener(message.data);
        } catch {
          // Swallow listener errors.
        }
      }
    }),
  );
  transportUnsubscribers.push(
    nextTransport.subscribe(ORCHESTRATION_WS_CHANNELS.domainEvent, (message) => {
      if (generation !== connectionGeneration) {
        return;
      }
      for (const listener of orchestrationEventListeners) {
        try {
          listener(message.data);
        } catch {
          // Swallow listener errors.
        }
      }
    }),
  );
}

function connectActiveProfile(options?: { applyScope?: boolean }) {
  const profile = resolveActiveProfile();
  if (options?.applyScope !== false) {
    applyServerScope(profile);
  }
  disposeTransport();
  latestPushByChannel = new Map();
  welcomeReceived = false;
  connectionGeneration += 1;
  const generation = connectionGeneration;
  const nextTransport = new WsTransport(buildServerConnectionWebSocketUrl(profile));
  transport = nextTransport;
  setConnectionState({
    phase: "connecting",
    transportState: "connecting",
    activeProfile: profile,
    activeProfileId: profile.id,
    endpointDisplay: getServerConnectionEndpointDisplay(profile),
    errorMessage: null,
  });
  scheduleConnectionFailure(generation);
  attachTransport(nextTransport, profile, generation);
}

function ensureTransport(): WsTransport {
  if (!transport) {
    connectActiveProfile({ applyScope: true });
  }
  if (!transport) {
    throw new Error("Server transport unavailable.");
  }
  return transport;
}

export function getServerConnectionStateSnapshot(): ServerConnectionStateSnapshot {
  return connectionState;
}

export function subscribeServerConnectionState(
  listener: (snapshot: ServerConnectionStateSnapshot) => void,
): () => void {
  connectionStateListeners.add(listener);
  return () => {
    connectionStateListeners.delete(listener);
  };
}

export function retryActiveConnection(): void {
  connectActiveProfile({ applyScope: false });
}

function resolveRememberedRemoteProfileId(
  serverProfiles: readonly ServerConnectionProfile[],
  profileId: string,
  currentLastRemoteProfileId: string,
): string {
  const nextProfile = resolveServerConnectionProfileById(serverProfiles, profileId);
  const shouldRememberRemoteProfile =
    nextProfile !== null &&
    serverProfiles.some((profile) => profile.id === nextProfile.id) &&
    !isLocalServerProfile(nextProfile);
  return shouldRememberRemoteProfile ? nextProfile.id : currentLastRemoteProfileId;
}

export function switchConnectionProfile(profileId: string): void {
  patchStoredAppSettings((current) => ({
    ...current,
    activeServerProfileId: profileId,
    lastRemoteServerProfileId: resolveRememberedRemoteProfileId(
      current.serverProfiles,
      profileId,
      current.lastRemoteServerProfileId,
    ),
  }));
  connectActiveProfile({ applyScope: true });
}

/**
 * Subscribe to the server welcome message. If a welcome was already received
 * before this call, the listener fires synchronously with the cached payload.
 */
export function onServerWelcome(listener: (payload: WsWelcomePayload) => void): () => void {
  welcomeListeners.add(listener);
  const latestWelcome = latestPushByChannel.get(WS_CHANNELS.serverWelcome)?.data ?? null;
  if (latestWelcome) {
    try {
      listener(latestWelcome as WsWelcomePayload);
    } catch {
      // Swallow listener errors.
    }
  }
  return () => {
    welcomeListeners.delete(listener);
  };
}

/**
 * Subscribe to server config update events. Replays the latest update for
 * late subscribers to avoid missing config validation feedback.
 */
export function onServerConfigUpdated(
  listener: (payload: ServerConfigUpdatedPayload) => void,
): () => void {
  serverConfigUpdatedListeners.add(listener);
  const latestConfig = latestPushByChannel.get(WS_CHANNELS.serverConfigUpdated)?.data ?? null;
  if (latestConfig) {
    try {
      listener(latestConfig as ServerConfigUpdatedPayload);
    } catch {
      // Swallow listener errors.
    }
  }
  return () => {
    serverConfigUpdatedListeners.delete(listener);
  };
}

export function createWsNativeApi(): NativeApi {
  if (instance) {
    return instance.api;
  }

  connectActiveProfile({ applyScope: true });

  const api: NativeApi = {
    dialogs: {
      pickFolder: async () => {
        if (!window.desktopBridge) return null;
        return window.desktopBridge.pickFolder();
      },
      confirm: async (message) => {
        if (window.desktopBridge) {
          return window.desktopBridge.confirm(message);
        }
        return window.confirm(message);
      },
    },
    terminal: {
      open: (input) => ensureTransport().request(WS_METHODS.terminalOpen, input),
      write: (input) => ensureTransport().request(WS_METHODS.terminalWrite, input),
      resize: (input) => ensureTransport().request(WS_METHODS.terminalResize, input),
      clear: (input) => ensureTransport().request(WS_METHODS.terminalClear, input),
      restart: (input) => ensureTransport().request(WS_METHODS.terminalRestart, input),
      close: (input) => ensureTransport().request(WS_METHODS.terminalClose, input),
      onEvent: (callback) => {
        terminalEventListeners.add(callback);
        return () => {
          terminalEventListeners.delete(callback);
        };
      },
    },
    projects: {
      searchEntries: (input) => ensureTransport().request(WS_METHODS.projectsSearchEntries, input),
      writeFile: (input) => ensureTransport().request(WS_METHODS.projectsWriteFile, input),
    },
    shell: {
      openInEditor: (cwd, editor) =>
        ensureTransport().request(WS_METHODS.shellOpenInEditor, { cwd, editor }),
      openExternal: async (url) => {
        if (window.desktopBridge) {
          const opened = await window.desktopBridge.openExternal(url);
          if (!opened) {
            throw new Error("Unable to open link.");
          }
          return;
        }
        window.open(url, "_blank", "noopener,noreferrer");
      },
    },
    git: {
      pull: (input) => ensureTransport().request(WS_METHODS.gitPull, input),
      status: (input) => ensureTransport().request(WS_METHODS.gitStatus, input),
      runStackedAction: (input) => ensureTransport().request(WS_METHODS.gitRunStackedAction, input),
      listBranches: (input) => ensureTransport().request(WS_METHODS.gitListBranches, input),
      createWorktree: (input) => ensureTransport().request(WS_METHODS.gitCreateWorktree, input),
      removeWorktree: (input) => ensureTransport().request(WS_METHODS.gitRemoveWorktree, input),
      createBranch: (input) => ensureTransport().request(WS_METHODS.gitCreateBranch, input),
      checkout: (input) => ensureTransport().request(WS_METHODS.gitCheckout, input),
      init: (input) => ensureTransport().request(WS_METHODS.gitInit, input),
      resolvePullRequest: (input) =>
        ensureTransport().request(WS_METHODS.gitResolvePullRequest, input),
      preparePullRequestThread: (input) =>
        ensureTransport().request(WS_METHODS.gitPreparePullRequestThread, input),
    },
    contextMenu: {
      show: async <T extends string>(
        items: readonly ContextMenuItem<T>[],
        position?: { x: number; y: number },
      ): Promise<T | null> => {
        if (window.desktopBridge) {
          return window.desktopBridge.showContextMenu(items, position) as Promise<T | null>;
        }
        return showContextMenuFallback(items, position);
      },
    },
    server: {
      getConfig: () => ensureTransport().request(WS_METHODS.serverGetConfig),
      inspectProviders: (input) =>
        ensureTransport().request(WS_METHODS.serverInspectProviders, input),
      upsertKeybinding: (input) =>
        ensureTransport().request(WS_METHODS.serverUpsertKeybinding, input),
    },
    orchestration: {
      getSnapshot: () => ensureTransport().request(ORCHESTRATION_WS_METHODS.getSnapshot),
      dispatchCommand: (command) =>
        ensureTransport().request(ORCHESTRATION_WS_METHODS.dispatchCommand, { command }),
      getTurnDiff: (input) =>
        ensureTransport().request(ORCHESTRATION_WS_METHODS.getTurnDiff, input),
      getFullThreadDiff: (input) =>
        ensureTransport().request(ORCHESTRATION_WS_METHODS.getFullThreadDiff, input),
      replayEvents: (fromSequenceExclusive) =>
        ensureTransport().request(ORCHESTRATION_WS_METHODS.replayEvents, {
          fromSequenceExclusive,
        }),
      onDomainEvent: (callback) => {
        orchestrationEventListeners.add(callback);
        return () => {
          orchestrationEventListeners.delete(callback);
        };
      },
    },
  };

  instance = { api };
  return api;
}
