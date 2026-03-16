import {
  ORCHESTRATION_WS_CHANNELS,
  ORCHESTRATION_WS_METHODS,
  type OrchestrationReadModel,
  type ServerConfig,
  type WsPushMessage,
  WS_CHANNELS,
  WS_METHODS,
  type ClientOrchestrationCommand,
} from "@t3tools/contracts";
import {
  advanceProjectionSequence,
  applyReplayedSequence,
  createProjectionState,
  hydrateProjectionFromSnapshot,
  resolveIncomingSequence,
} from "@t3tools/shared/client/orchestrationProjection";
import { type TransportStateSnapshot, WsTransport } from "@t3tools/shared/client/wsTransport";
import {
  getServerConnectionHttpOrigin,
  buildServerConnectionWebSocketUrl,
} from "@t3tools/shared/connectionProfile";

import type { GitStatusInfo, MobileServerProfile } from "./mobileTypes";

const CONNECTION_TIMEOUT_MS = 8_000;
const SYNC_THROTTLE_MS = 100;
const noop = () => {};

export interface MobileServerRuntimeCallbacks {
  readonly onConnectionState?: (snapshot: TransportStateSnapshot) => void;
  readonly onReady?: (payload: {
    readonly snapshot: OrchestrationReadModel;
    readonly serverConfig: ServerConfig;
  }) => void;
  readonly onFailure?: (message: string) => void;
  readonly onDomainEvent?: (
    event: WsPushMessage<typeof ORCHESTRATION_WS_CHANNELS.domainEvent>["data"],
  ) => void;
}

export class MobileServerRuntime {
  private readonly transport: WsTransport;
  private readonly callbacks: MobileServerRuntimeCallbacks;
  private readonly profile: MobileServerProfile;
  private projectionState = createProjectionState();
  private disposed = false;
  private welcomeReceived = false;
  private serverConfig: ServerConfig | null = null;
  private syncing = false;
  private pendingSync = false;
  private replaying = false;
  private syncThrottleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(profile: MobileServerProfile, callbacks: MobileServerRuntimeCallbacks = {}) {
    this.profile = profile;
    this.callbacks = callbacks;
    this.transport = new WsTransport(buildServerConnectionWebSocketUrl(profile));
  }

  static async validate(profile: MobileServerProfile): Promise<void> {
    const runtime = new MobileServerRuntime(profile);
    try {
      await runtime.start();
    } finally {
      runtime.dispose();
    }
  }

  async start(): Promise<void> {
    this.unsubscribers.push(
      this.transport.subscribeState(
        (snapshot) => {
          this.callbacks.onConnectionState?.(snapshot);
        },
        { replayLatest: true },
      ),
    );

    const welcomePromise = new Promise<WsPushMessage<typeof WS_CHANNELS.serverWelcome>>(
      (resolve, reject) => {
        const timeout = setTimeout(async () => {
          reject(new Error(await this.resolveConnectionTimeoutMessage()));
        }, CONNECTION_TIMEOUT_MS);

        let unsubscribe = noop;
        unsubscribe = this.transport.subscribe(
          WS_CHANNELS.serverWelcome,
          (message) => {
            clearTimeout(timeout);
            this.welcomeReceived = true;
            unsubscribe();
            resolve(message);
          },
          { replayLatest: true },
        );
        this.unsubscribers.push(() => {
          clearTimeout(timeout);
          unsubscribe();
        });
      },
    );

    const domainEventUnsubscribe = this.transport.subscribe(
      ORCHESTRATION_WS_CHANNELS.domainEvent,
      (message) => {
        void this.handleDomainEvent(message.data);
      },
    );
    this.unsubscribers.push(domainEventUnsubscribe);

    try {
      await welcomePromise;
      const serverConfig = await this.transport.request<ServerConfig>(WS_METHODS.serverGetConfig);
      this.serverConfig = serverConfig;
      const snapshot = await this.transport.request<OrchestrationReadModel>(
        ORCHESTRATION_WS_METHODS.getSnapshot,
      );
      this.projectionState = hydrateProjectionFromSnapshot(snapshot);
      this.callbacks.onReady?.({ snapshot, serverConfig });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to connect to the selected server.";
      this.callbacks.onFailure?.(message);
      throw error;
    }
  }

  async dispatchCommand(command: ClientOrchestrationCommand): Promise<void> {
    await this.transport.request(ORCHESTRATION_WS_METHODS.dispatchCommand, { command });
  }

  async refreshSnapshot(): Promise<OrchestrationReadModel | null> {
    try {
      const snapshot = await this.transport.request<OrchestrationReadModel>(
        ORCHESTRATION_WS_METHODS.getSnapshot,
      );
      this.projectionState = hydrateProjectionFromSnapshot(snapshot);
      if (this.serverConfig) {
        this.callbacks.onReady?.({ snapshot, serverConfig: this.serverConfig });
      }
      return snapshot;
    } catch {
      return null;
    }
  }

  async getGitStatus(projectId: string): Promise<GitStatusInfo | null> {
    try {
      const result = await this.transport.request<{
        branch?: string;
        isDirty?: boolean;
        ahead?: number;
        behind?: number;
      }>(WS_METHODS.gitStatus, { projectId });
      return {
        branch: result.branch ?? null,
        isDirty: result.isDirty ?? false,
        ahead: result.ahead ?? 0,
        behind: result.behind ?? 0,
      };
    } catch {
      return null;
    }
  }

  async getGitBranches(projectId: string): Promise<string[]> {
    try {
      const result = await this.transport.request<{ branches: string[] }>(
        WS_METHODS.gitListBranches,
        { projectId },
      );
      return result.branches ?? [];
    } catch {
      return [];
    }
  }

  async inspectProviders(): Promise<unknown> {
    try {
      return await this.transport.request(WS_METHODS.serverInspectProviders, {});
    } catch {
      return null;
    }
  }

  async getTurnDiff(
    threadId: string,
    turnId: string,
  ): Promise<Array<{ path: string; additions: number; deletions: number; patch?: string }> | null> {
    try {
      const result = await this.transport.request<{
        files?: Array<{ path: string; additions: number; deletions: number; patch?: string }>;
      }>(ORCHESTRATION_WS_METHODS.getTurnDiff, { threadId, turnId });
      return result.files ?? [];
    } catch {
      return null;
    }
  }

  setForegroundActive(active: boolean): void {
    this.transport.setReconnectEnabled(active);
    if (active) {
      this.transport.reconnectNow();
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.syncThrottleTimer) {
      clearTimeout(this.syncThrottleTimer);
      this.syncThrottleTimer = null;
    }
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe();
    }
    this.transport.dispose();
  }

  private async handleDomainEvent(
    event: WsPushMessage<typeof ORCHESTRATION_WS_CHANNELS.domainEvent>["data"],
  ): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.callbacks.onDomainEvent?.(event);

    const resolution = resolveIncomingSequence(this.projectionState, event);
    if (resolution.kind === "duplicate") {
      return;
    }
    if (resolution.kind === "gap") {
      await this.repairSequenceGap();
      return;
    }
    this.projectionState = advanceProjectionSequence(this.projectionState, event);
    this.throttledSync();
  }

  private throttledSync(): void {
    if (this.syncThrottleTimer) {
      return;
    }
    this.syncThrottleTimer = setTimeout(() => {
      this.syncThrottleTimer = null;
      void this.syncSnapshot();
    }, SYNC_THROTTLE_MS);
  }

  private async repairSequenceGap(): Promise<void> {
    if (this.replaying || this.disposed) {
      return;
    }
    this.replaying = true;
    try {
      const replayed = await this.transport.request<
        WsPushMessage<typeof ORCHESTRATION_WS_CHANNELS.domainEvent>["data"][]
      >(ORCHESTRATION_WS_METHODS.replayEvents, {
        fromSequenceExclusive: this.projectionState.lastSequence,
      });
      this.projectionState = applyReplayedSequence(this.projectionState, replayed);
      await this.syncSnapshot();
    } catch {
      await this.syncSnapshot();
    } finally {
      this.replaying = false;
    }
  }

  private async syncSnapshot(): Promise<void> {
    if (this.syncing) {
      this.pendingSync = true;
      return;
    }
    this.syncing = true;
    this.pendingSync = false;

    try {
      const snapshot = await this.transport.request<OrchestrationReadModel>(
        ORCHESTRATION_WS_METHODS.getSnapshot,
      );
      this.projectionState = hydrateProjectionFromSnapshot(snapshot);
      if (this.serverConfig) {
        this.callbacks.onReady?.({ snapshot, serverConfig: this.serverConfig });
      }
    } finally {
      this.syncing = false;
      if (this.pendingSync && !this.disposed) {
        this.pendingSync = false;
        await this.syncSnapshot();
      }
    }
  }

  private async resolveConnectionTimeoutMessage(): Promise<string> {
    const snapshot = this.transport.getStateSnapshot();
    if (snapshot.state === "open" || this.welcomeReceived) {
      return "Connected transport, but server did not complete startup.";
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3_000);
      const response = await fetch(`${getServerConnectionHttpOrigin(this.profile)}/api/healthz`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.ok) {
        return "Authentication failed or token rejected.";
      }
    } catch {
      // Ignore fetch failures and fall through to the generic reachability message.
    }

    return "Server unreachable. Check Tailscale/LAN reachability.";
  }
}
