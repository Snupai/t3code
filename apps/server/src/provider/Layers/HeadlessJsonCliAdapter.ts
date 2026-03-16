import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import readline from "node:readline";

import {
  EventId,
  type ProviderKind,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSession,
  type ProviderSessionStartInput,
  type ProviderTurnStartResult,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { Effect, Queue, Schema, Stream } from "effect";

import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import type {
  ProviderAdapterCapabilities,
  ProviderAdapterShape,
  ProviderThreadSnapshot,
} from "../Services/ProviderAdapter.ts";
import { type EventNdjsonLogger } from "./EventNdjsonLogger.ts";

type ResumeCursor = {
  readonly sessionId: string;
};

type ParsedCompletion = {
  readonly state: "completed" | "failed";
  readonly errorMessage?: string;
};

type HeadlessSessionState = {
  session: ProviderSession;
  cwd: string;
  model?: string;
  sessionId?: string;
  env: NodeJS.ProcessEnv;
  providerOptions?: ProviderSessionStartInput["providerOptions"];
  child: ChildProcessWithoutNullStreams | null;
  interrupted: boolean;
  turnItems: Array<{ id: TurnId; items: ReadonlyArray<unknown> }>;
};

type SpawnConfig = {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env: NodeJS.ProcessEnv;
};

type ParseContext = {
  readonly provider: ProviderKind;
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly eventId: () => EventId;
  readonly createdAt: () => string;
};

type ParsedLine = {
  readonly sessionId?: string;
  readonly events?: ReadonlyArray<ProviderRuntimeEvent>;
  readonly completed?: {
    readonly state: "completed" | "failed";
    readonly errorMessage?: string;
  };
};

type HeadlessJsonCliAdapterOptions = {
  readonly provider: ProviderKind;
  readonly displayName: string;
  readonly binaryName: string;
  readonly capabilities: ProviderAdapterCapabilities;
  readonly getEnv: (input: ProviderSessionStartInput) => NodeJS.ProcessEnv;
  readonly buildSpawnConfig: (input: {
    readonly session: HeadlessSessionState;
    readonly turnId: TurnId;
    readonly input: ProviderSendTurnInput;
  }) => SpawnConfig;
  readonly parseLine: (line: string, context: ParseContext) => ParsedLine;
  readonly nativeEventLogger?: EventNdjsonLogger;
};

function nowIso() {
  return new Date().toISOString();
}

function makeEventId(): EventId {
  return EventId.makeUnsafe(randomUUID());
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function readResumeCursor(cursor: unknown): string | undefined {
  const record = asRecord(cursor);
  const sessionId = asString(record?.sessionId);
  return sessionId?.trim() ? sessionId : undefined;
}

function makeResumeCursor(sessionId: string | undefined): ResumeCursor | undefined {
  const normalized = sessionId?.trim();
  return normalized ? { sessionId: normalized } : undefined;
}

function mergeSessionEnv(env: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...env,
  };
}

function completedResult(state: "completed" | "failed", errorMessage?: string): ParsedCompletion {
  return errorMessage ? { state, errorMessage } : { state };
}

function unsupportedProviderModeError(input: {
  readonly provider: ProviderKind;
  readonly displayName: string;
}) {
  return new ProviderAdapterValidationError({
    provider: input.provider,
    operation: "startSession",
    issue: `${input.displayName} currently supports full-access only in T3 Code.`,
  });
}

function unsupportedOperationError(input: {
  readonly provider: ProviderKind;
  readonly method: string;
  readonly detail: string;
}) {
  return new ProviderAdapterRequestError(input);
}

async function writeNativeLog(
  nativeEventLogger: EventNdjsonLogger | undefined,
  threadId: ThreadId,
  event: unknown,
) {
  if (!nativeEventLogger) {
    return;
  }
  await Effect.runPromise(nativeEventLogger.write(event, threadId));
}

export function makeHeadlessJsonCliAdapter(
  options: HeadlessJsonCliAdapterOptions,
): Effect.Effect<ProviderAdapterShape<ProviderAdapterError>> {
  return Effect.gen(function* () {
    const runtimeEvents = yield* Queue.unbounded<ProviderRuntimeEvent>();
    const sessions = new Map<ThreadId, HeadlessSessionState>();

    const emit = async (event: ProviderRuntimeEvent) => {
      await writeNativeLog(options.nativeEventLogger, event.threadId, event);
      await Effect.runPromise(Queue.offer(runtimeEvents, event));
    };

    const startSession: ProviderAdapterShape<ProviderAdapterError>["startSession"] = (input) =>
      Effect.try({
        try: () => {
          if (input.runtimeMode === "approval-required") {
            throw unsupportedProviderModeError({
              provider: options.provider,
              displayName: options.displayName,
            });
          }

          const createdAt = nowIso();
          const resumeSessionId = readResumeCursor(input.resumeCursor);
          const session: ProviderSession = {
            provider: options.provider,
            status: "ready",
            runtimeMode: input.runtimeMode,
            ...(input.cwd ? { cwd: input.cwd } : {}),
            ...(input.model ? { model: input.model } : {}),
            threadId: input.threadId,
            ...(resumeSessionId ? { resumeCursor: makeResumeCursor(resumeSessionId) } : {}),
            createdAt,
            updatedAt: createdAt,
          };

          sessions.set(input.threadId, {
            session,
            cwd: input.cwd ?? process.cwd(),
            ...(input.model ? { model: input.model } : {}),
            ...(resumeSessionId ? { sessionId: resumeSessionId } : {}),
            env: mergeSessionEnv(options.getEnv(input)),
            ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
            child: null,
            interrupted: false,
            turnItems: [],
          });

          return session;
        },
        catch: (cause) =>
          Schema.is(ProviderAdapterValidationError)(cause)
            ? cause
            : new ProviderAdapterProcessError({
                provider: options.provider,
                threadId: input.threadId,
                detail: cause instanceof Error ? cause.message : String(cause),
                cause,
              }),
      });

    const sendTurn: ProviderAdapterShape<ProviderAdapterError>["sendTurn"] = (input) =>
      Effect.tryPromise({
        try: async () => {
          const session = sessions.get(input.threadId);
          if (!session) {
            throw new ProviderAdapterRequestError({
              provider: options.provider,
              method: "sendTurn",
              detail: "Unknown provider session.",
            });
          }
          if (session.child) {
            throw new ProviderAdapterRequestError({
              provider: options.provider,
              method: "sendTurn",
              detail: "Provider turn already running.",
            });
          }
          if (input.attachments && input.attachments.length > 0) {
            throw new ProviderAdapterRequestError({
              provider: options.provider,
              method: "sendTurn",
              detail: `${options.displayName} attachments are not supported yet.`,
            });
          }

          const turnId = TurnId.makeUnsafe(randomUUID());
          const createdAt = nowIso();
          const spawnConfig = options.buildSpawnConfig({
            session,
            turnId,
            input,
          });
          const child = spawn(spawnConfig.command, [...spawnConfig.args], {
            cwd: session.cwd,
            env: spawnConfig.env,
            shell: process.platform === "win32",
          });

          session.child = child;
          session.interrupted = false;
          if (input.model) {
            session.model = input.model;
          }
          session.session = {
            ...session.session,
            status: "running",
            activeTurnId: turnId,
            ...(session.model ? { model: session.model } : {}),
            updatedAt: createdAt,
          };

          await emit({
            eventId: makeEventId(),
            provider: options.provider,
            threadId: input.threadId,
            createdAt,
            type: "session.state.changed",
            payload: { state: "running" },
          });
          await emit({
            eventId: makeEventId(),
            provider: options.provider,
            threadId: input.threadId,
            createdAt,
            turnId,
            type: "turn.started",
            payload: session.model ? { model: session.model } : {},
          });

          const sessionStartResult = await new Promise<ProviderTurnStartResult>(
            (resolve, reject) => {
              let resolved = false;
              let completed = false;

              const finalizeStart = () => {
                if (resolved) {
                  return;
                }
                resolved = true;
                resolve({
                  threadId: input.threadId,
                  turnId,
                  ...(session.sessionId
                    ? { resumeCursor: makeResumeCursor(session.sessionId) }
                    : {}),
                });
              };

              const finalizeCompletion = async (
                state: "completed" | "failed" | "interrupted",
                errorMessage?: string,
              ) => {
                if (completed) {
                  return;
                }
                completed = true;
                session.turnItems.push({ id: turnId, items: [] });
                session.child = null;
                session.session = {
                  ...session.session,
                  status: state === "failed" ? "error" : "ready",
                  activeTurnId: undefined,
                  ...(session.sessionId
                    ? { resumeCursor: makeResumeCursor(session.sessionId) }
                    : {}),
                  ...(errorMessage ? { lastError: errorMessage } : {}),
                  updatedAt: nowIso(),
                };

                await emit({
                  eventId: makeEventId(),
                  provider: options.provider,
                  threadId: input.threadId,
                  createdAt: nowIso(),
                  turnId,
                  type: "turn.completed",
                  payload: {
                    state,
                    ...(errorMessage ? { errorMessage } : {}),
                  },
                });
                await emit({
                  eventId: makeEventId(),
                  provider: options.provider,
                  threadId: input.threadId,
                  createdAt: nowIso(),
                  type: "session.state.changed",
                  payload: {
                    state: state === "failed" ? "error" : "ready",
                    ...(errorMessage ? { reason: errorMessage } : {}),
                  },
                });
              };

              const stdout = readline.createInterface({ input: child.stdout });
              stdout.on("line", (line) => {
                void (async () => {
                  const parsed = options.parseLine(line, {
                    provider: options.provider,
                    threadId: input.threadId,
                    turnId,
                    eventId: makeEventId,
                    createdAt: nowIso,
                  });
                  if (parsed.sessionId) {
                    session.sessionId = parsed.sessionId;
                    session.session = {
                      ...session.session,
                      resumeCursor: makeResumeCursor(parsed.sessionId),
                      updatedAt: nowIso(),
                    };
                  }
                  for (const event of parsed.events ?? []) {
                    await emit(event);
                  }
                  if (parsed.completed) {
                    await finalizeCompletion(parsed.completed.state, parsed.completed.errorMessage);
                  }
                  finalizeStart();
                })().catch((error) => reject(error));
              });

              let stderrBuffer = "";
              child.stderr.on("data", (chunk: Buffer | string) => {
                stderrBuffer += chunk.toString();
                const lines = stderrBuffer.split(/\r?\n/);
                stderrBuffer = lines.pop() ?? "";
                for (const line of lines) {
                  const trimmed = line.trim();
                  if (!trimmed) {
                    continue;
                  }
                  void emit({
                    eventId: makeEventId(),
                    provider: options.provider,
                    threadId: input.threadId,
                    createdAt: nowIso(),
                    turnId,
                    type: "runtime.warning",
                    payload: { message: trimmed },
                  });
                }
              });

              child.on("error", (error) => {
                void emit({
                  eventId: makeEventId(),
                  provider: options.provider,
                  threadId: input.threadId,
                  createdAt: nowIso(),
                  turnId,
                  type: "runtime.error",
                  payload: {
                    message: error.message,
                    class: "provider_error",
                  },
                });
                reject(
                  new ProviderAdapterProcessError({
                    provider: options.provider,
                    threadId: input.threadId,
                    detail: error.message,
                    cause: error,
                  }),
                );
              });

              child.on("exit", (code, signal) => {
                void (async () => {
                  if (stderrBuffer.trim()) {
                    await emit({
                      eventId: makeEventId(),
                      provider: options.provider,
                      threadId: input.threadId,
                      createdAt: nowIso(),
                      turnId,
                      type: "runtime.warning",
                      payload: { message: stderrBuffer.trim() },
                    });
                  }

                  if (!completed) {
                    const interrupted = session.interrupted;
                    const state = interrupted ? "interrupted" : code === 0 ? "completed" : "failed";
                    const errorMessage =
                      state === "failed"
                        ? `Process exited with code ${code ?? "null"}${signal ? ` (${signal})` : ""}.`
                        : undefined;
                    await finalizeCompletion(state, errorMessage);
                  }
                  finalizeStart();
                })().catch((error) => reject(error));
              });
            },
          );

          return sessionStartResult;
        },
        catch: (cause) =>
          Schema.is(ProviderAdapterRequestError)(cause) ||
          Schema.is(ProviderAdapterProcessError)(cause)
            ? cause
            : new ProviderAdapterProcessError({
                provider: options.provider,
                threadId: input.threadId,
                detail: cause instanceof Error ? cause.message : String(cause),
                cause,
              }),
      });

    const interruptTurn: ProviderAdapterShape<ProviderAdapterError>["interruptTurn"] = (threadId) =>
      Effect.try({
        try: () => {
          const session = sessions.get(threadId);
          if (!session?.child) {
            return;
          }
          session.interrupted = true;
          session.child.kill("SIGTERM");
        },
        catch: (cause) =>
          new ProviderAdapterProcessError({
            provider: options.provider,
            threadId,
            detail: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });

    const stopSession: ProviderAdapterShape<ProviderAdapterError>["stopSession"] = (threadId) =>
      Effect.try({
        try: () => {
          const session = sessions.get(threadId);
          if (!session) {
            return;
          }
          if (session.child) {
            session.interrupted = true;
            session.child.kill("SIGTERM");
          }
          session.child = null;
          session.session = {
            ...session.session,
            status: "closed",
            activeTurnId: undefined,
            updatedAt: nowIso(),
          };
        },
        catch: (cause) =>
          new ProviderAdapterProcessError({
            provider: options.provider,
            threadId,
            detail: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });

    const listSessions: ProviderAdapterShape<ProviderAdapterError>["listSessions"] = () =>
      Effect.succeed(Array.from(sessions.values(), (session) => session.session));

    const hasSession: ProviderAdapterShape<ProviderAdapterError>["hasSession"] = (threadId) =>
      Effect.succeed(sessions.has(threadId));

    const readThread: ProviderAdapterShape<ProviderAdapterError>["readThread"] = (threadId) =>
      Effect.try({
        try: () => {
          const session = sessions.get(threadId);
          return {
            threadId,
            turns: session?.turnItems ?? [],
          } satisfies ProviderThreadSnapshot;
        },
        catch: (cause) =>
          new ProviderAdapterRequestError({
            provider: options.provider,
            method: "readThread",
            detail: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });

    const rollbackThread: ProviderAdapterShape<ProviderAdapterError>["rollbackThread"] = (
      _threadId,
      _numTurns,
    ) =>
      Effect.fail(
        unsupportedOperationError({
          provider: options.provider,
          method: "rollbackThread",
          detail: `${options.displayName} conversation rollback is not supported.`,
        }),
      );

    const respondToRequest: ProviderAdapterShape<ProviderAdapterError>["respondToRequest"] = (
      _threadId,
      _requestId,
      _decision,
    ) =>
      Effect.fail(
        unsupportedOperationError({
          provider: options.provider,
          method: "respondToRequest",
          detail: `${options.displayName} interactive approvals are not supported.`,
        }),
      );

    const respondToUserInput: ProviderAdapterShape<ProviderAdapterError>["respondToUserInput"] = (
      _threadId,
      _requestId,
      _answers,
    ) =>
      Effect.fail(
        unsupportedOperationError({
          provider: options.provider,
          method: "respondToUserInput",
          detail: `${options.displayName} structured user input is not supported.`,
        }),
      );

    const stopAll: ProviderAdapterShape<ProviderAdapterError>["stopAll"] = () =>
      Effect.forEach(Array.from(sessions.keys()), (threadId) => stopSession(threadId), {
        concurrency: "unbounded",
      }).pipe(Effect.asVoid);

    return {
      provider: options.provider,
      capabilities: options.capabilities,
      startSession,
      sendTurn,
      interruptTurn,
      respondToRequest,
      respondToUserInput,
      stopSession,
      listSessions,
      hasSession,
      readThread,
      rollbackThread,
      stopAll,
      streamEvents: Stream.fromQueue(runtimeEvents),
    } satisfies ProviderAdapterShape<ProviderAdapterError>;
  });
}

export function parseCursorAgentLine(line: string, context: ParseContext): ParsedLine {
  const record = asRecord(JSON.parse(line));
  if (!record) {
    return {};
  }
  const events: ProviderRuntimeEvent[] = [];
  const sessionId = asString(record.session_id);
  if (record.type === "assistant") {
    const message = asRecord(record.message);
    const content = Array.isArray(message?.content) ? message.content : [];
    for (const entry of content) {
      const part = asRecord(entry);
      const text = asString(part?.text);
      if (!text) {
        continue;
      }
      events.push({
        eventId: context.eventId(),
        provider: context.provider,
        threadId: context.threadId,
        createdAt: context.createdAt(),
        turnId: context.turnId,
        type: "content.delta",
        payload: { streamKind: "assistant_text", delta: text },
      });
    }
  }
  if (record.type === "result") {
    return {
      ...(sessionId ? { sessionId } : {}),
      events,
      completed: {
        ...completedResult(
          record.subtype === "success" ? "completed" : "failed",
          record.subtype === "success" ? undefined : asString(record.result),
        ),
      },
    };
  }
  return { ...(sessionId ? { sessionId } : {}), ...(events.length > 0 ? { events } : {}) };
}

export function parseClaudeLine(line: string, context: ParseContext): ParsedLine {
  const record = asRecord(JSON.parse(line));
  if (!record) {
    return {};
  }
  const events: ProviderRuntimeEvent[] = [];
  const sessionId = asString(record.session_id);
  if (record.type === "assistant") {
    const message = asRecord(record.message);
    const content = Array.isArray(message?.content) ? message.content : [];
    for (const entry of content) {
      const part = asRecord(entry);
      const text = asString(part?.text);
      if (!text) {
        continue;
      }
      events.push({
        eventId: context.eventId(),
        provider: context.provider,
        threadId: context.threadId,
        createdAt: context.createdAt(),
        turnId: context.turnId,
        type: "content.delta",
        payload: { streamKind: "assistant_text", delta: text },
      });
    }
  }
  if (record.type === "result") {
    return {
      ...(sessionId ? { sessionId } : {}),
      events,
      completed: {
        ...completedResult(
          record.subtype === "success" ? "completed" : "failed",
          record.subtype === "success" ? undefined : asString(record.result),
        ),
      },
    };
  }
  return { ...(sessionId ? { sessionId } : {}), ...(events.length > 0 ? { events } : {}) };
}

export function parseGeminiLine(line: string, context: ParseContext): ParsedLine {
  const record = asRecord(JSON.parse(line));
  if (!record) {
    return {};
  }
  const events: ProviderRuntimeEvent[] = [];
  const sessionId = asString(record.session_id);
  if (record.type === "message" && record.role === "assistant") {
    const text = asString(record.content);
    if (text) {
      events.push({
        eventId: context.eventId(),
        provider: context.provider,
        threadId: context.threadId,
        createdAt: context.createdAt(),
        turnId: context.turnId,
        type: "content.delta",
        payload: { streamKind: "assistant_text", delta: text },
      });
    }
  }
  if (record.type === "result") {
    return {
      ...(sessionId ? { sessionId } : {}),
      events,
      completed: {
        ...completedResult(
          record.status === "success" ? "completed" : "failed",
          record.status === "success" ? undefined : asString(record.error),
        ),
      },
    };
  }
  return { ...(sessionId ? { sessionId } : {}), ...(events.length > 0 ? { events } : {}) };
}

export function parseOpenCodeLine(line: string, context: ParseContext): ParsedLine {
  const record = asRecord(JSON.parse(line));
  if (!record) {
    return {};
  }
  const events: ProviderRuntimeEvent[] = [];
  const sessionId = asString(record.sessionID);
  if (record.type === "text") {
    const part = asRecord(record.part);
    const text = asString(part?.text);
    if (text) {
      events.push({
        eventId: context.eventId(),
        provider: context.provider,
        threadId: context.threadId,
        createdAt: context.createdAt(),
        turnId: context.turnId,
        type: "content.delta",
        payload: { streamKind: "assistant_text", delta: text },
      });
    }
  }
  if (record.type === "step_finish") {
    const part = asRecord(record.part);
    return {
      ...(sessionId ? { sessionId } : {}),
      events,
      completed: {
        state: part?.reason === "stop" ? "completed" : "failed",
      },
    };
  }
  return { ...(sessionId ? { sessionId } : {}), ...(events.length > 0 ? { events } : {}) };
}
