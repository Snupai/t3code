import {
  type WsPush,
  type WsPushChannel,
  type WsPushMessage,
  WebSocketResponse,
  type WsResponse as WsResponseMessage,
  WsResponse as WsResponseSchema,
} from "@t3tools/contracts";
import { Result, Schema } from "effect";

import { getReconnectDelayMs } from "./reconnectController";
import { decodeUnknownJsonResult, formatSchemaError } from "../schemaJson";

type PushListener<C extends WsPushChannel> = (message: WsPushMessage<C>) => void;
type StateListener = (snapshot: TransportStateSnapshot) => void;

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface SubscribeOptions {
  readonly replayLatest?: boolean;
}

interface StateSubscribeOptions {
  readonly replayLatest?: boolean;
}

export interface WsTransportOptions {
  readonly reconnectDelaysMs?: readonly number[];
  readonly requestTimeoutMs?: number;
  readonly WebSocketImpl?: typeof WebSocket;
}

export type TransportState = "connecting" | "open" | "reconnecting" | "closed" | "disposed";

export interface TransportStateSnapshot {
  readonly state: TransportState;
  readonly url: string;
  readonly reconnectAttempt: number;
  readonly lastErrorMessage: string | null;
  readonly reconnectEnabled: boolean;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const decodeWsResponse = decodeUnknownJsonResult(WsResponseSchema);
const isWebSocketResponseEnvelope = Schema.is(WebSocketResponse);
const isWsPushMessage = (value: WsResponseMessage): value is WsPush =>
  "type" in value && value.type === "push";

interface WsRequestEnvelope {
  id: string;
  body: {
    _tag: string;
    [key: string]: unknown;
  };
}

function asError(value: unknown, fallback: string): Error {
  if (value instanceof Error) {
    return value;
  }
  return new Error(fallback);
}

function resolveWebSocketImpl(WebSocketImpl?: typeof WebSocket): typeof WebSocket {
  if (WebSocketImpl) {
    return WebSocketImpl;
  }
  if (typeof WebSocket === "undefined") {
    throw new Error("WebSocket is unavailable in this runtime.");
  }
  return WebSocket;
}

export class WsTransport {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Map<string, Set<(message: WsPush) => void>>();
  private readonly latestPushByChannel = new Map<string, WsPush>();
  private readonly outboundQueue: string[] = [];
  private readonly stateListeners = new Set<StateListener>();
  private readonly reconnectDelaysMs: readonly number[];
  private readonly requestTimeoutMs: number;
  private readonly WebSocketImpl: typeof WebSocket;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectEnabled = true;
  private disposed = false;
  private state: TransportState = "connecting";
  private lastErrorMessage: string | null = null;
  private readonly url: string;

  constructor(url: string, options: WsTransportOptions = {}) {
    this.url = url;
    this.reconnectDelaysMs = options.reconnectDelaysMs ?? [];
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.WebSocketImpl = resolveWebSocketImpl(options.WebSocketImpl);
    this.connect();
  }

  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (typeof method !== "string" || method.length === 0) {
      throw new Error("Request method is required");
    }

    const id = String(this.nextId++);
    const body = params != null ? { ...params, _tag: method } : { _tag: method };
    const message: WsRequestEnvelope = { id, body };
    const encoded = JSON.stringify(message);

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timed out: ${method}`));
      }, this.requestTimeoutMs);

      this.pending.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timeout,
      });

      this.send(encoded);
    });
  }

  subscribe<C extends WsPushChannel>(
    channel: C,
    listener: PushListener<C>,
    options?: SubscribeOptions,
  ): () => void {
    let channelListeners = this.listeners.get(channel);
    if (!channelListeners) {
      channelListeners = new Set<(message: WsPush) => void>();
      this.listeners.set(channel, channelListeners);
    }

    const wrappedListener = (message: WsPush) => {
      listener(message as WsPushMessage<C>);
    };
    channelListeners.add(wrappedListener);

    if (options?.replayLatest) {
      const latest = this.latestPushByChannel.get(channel);
      if (latest) {
        wrappedListener(latest);
      }
    }

    return () => {
      channelListeners?.delete(wrappedListener);
      if (channelListeners?.size === 0) {
        this.listeners.delete(channel);
      }
    };
  }

  subscribeState(listener: StateListener, options?: StateSubscribeOptions): () => void {
    this.stateListeners.add(listener);
    if (options?.replayLatest) {
      listener(this.getStateSnapshot());
    }
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  getLatestPush<C extends WsPushChannel>(channel: C): WsPushMessage<C> | null {
    const latest = this.latestPushByChannel.get(channel);
    return latest ? (latest as WsPushMessage<C>) : null;
  }

  getStateSnapshot(): TransportStateSnapshot {
    return {
      state: this.state,
      url: this.url,
      reconnectAttempt: this.reconnectAttempt,
      lastErrorMessage: this.lastErrorMessage,
      reconnectEnabled: this.reconnectEnabled,
    };
  }

  setReconnectEnabled(enabled: boolean): void {
    this.reconnectEnabled = enabled;
    if (!enabled && this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (
      enabled &&
      !this.disposed &&
      this.reconnectTimer === null &&
      this.ws === null &&
      this.state !== "open"
    ) {
      this.scheduleReconnect();
    }
    this.emitState();
  }

  reconnectNow(): void {
    if (this.disposed) {
      return;
    }
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws !== null && this.ws.readyState === this.WebSocketImpl.OPEN) {
      this.ws.close();
      return;
    }
    this.connect();
  }

  dispose(): void {
    this.disposed = true;
    this.setState("disposed");
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Transport disposed"));
    }
    this.pending.clear();
    this.outboundQueue.length = 0;
    this.ws?.close();
    this.ws = null;
  }

  private connect(): void {
    if (this.disposed) {
      return;
    }

    this.setState(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");
    const ws = new this.WebSocketImpl(this.url);

    ws.addEventListener("open", () => {
      this.ws = ws;
      this.reconnectAttempt = 0;
      this.lastErrorMessage = null;
      this.setState("open");
      this.flushQueue();
    });

    ws.addEventListener("message", (event) => {
      this.handleMessage(event.data);
    });

    ws.addEventListener("close", () => {
      if (this.ws === ws) {
        this.ws = null;
      }
      if (this.disposed) {
        this.setState("disposed");
        return;
      }
      this.setState("closed");
      this.scheduleReconnect();
    });

    ws.addEventListener("error", (event) => {
      this.lastErrorMessage = "Server unavailable or authentication failed.";
      console.warn("WebSocket connection error", { type: event.type, url: this.url });
      this.emitState();
    });
  }

  private setState(state: TransportState): void {
    this.state = state;
    this.emitState();
  }

  private emitState(): void {
    const snapshot = this.getStateSnapshot();
    for (const listener of this.stateListeners) {
      listener(snapshot);
    }
  }

  private handleMessage(raw: unknown): void {
    const result = decodeWsResponse(raw);
    if (Result.isFailure(result)) {
      console.warn("Dropped inbound WebSocket envelope", formatSchemaError(result.failure));
      return;
    }

    const message = result.success;
    if (isWsPushMessage(message)) {
      this.latestPushByChannel.set(message.channel, message);
      const channelListeners = this.listeners.get(message.channel);
      if (channelListeners) {
        for (const listener of channelListeners) {
          try {
            listener(message);
          } catch {
            // Swallow listener errors.
          }
        }
      }
      return;
    }

    if (!isWebSocketResponseEnvelope(message)) {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(message.id);

    if (message.error) {
      pending.reject(new Error(message.error.message));
      return;
    }

    pending.resolve(message.result);
  }

  private send(encodedMessage: string): void {
    if (this.disposed) {
      return;
    }

    this.outboundQueue.push(encodedMessage);
    try {
      this.flushQueue();
    } catch {
      // flushQueue already retained the outbound message for retry.
    }
  }

  private flushQueue(): void {
    if (this.ws?.readyState !== this.WebSocketImpl.OPEN) {
      return;
    }

    while (this.outboundQueue.length > 0) {
      const message = this.outboundQueue.shift();
      if (!message) {
        continue;
      }
      try {
        this.ws.send(message);
      } catch (error) {
        this.outboundQueue.unshift(message);
        throw asError(error, "Failed to send WebSocket request.");
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || !this.reconnectEnabled || this.reconnectTimer !== null) {
      return;
    }

    const delay = getReconnectDelayMs(this.reconnectAttempt, this.reconnectDelaysMs);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
