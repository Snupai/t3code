import { type ProviderKind, type ThreadId } from "@t3tools/contracts";
import { Effect, Layer, Option } from "effect";

import { ProviderSessionRuntimeRepository } from "../../persistence/Services/ProviderSessionRuntime.ts";
import { ProviderSessionDirectoryPersistenceError, ProviderValidationError } from "../Errors.ts";
import {
  ProviderSessionDirectory,
  type ProviderRuntimeBinding,
  type ProviderSessionDirectoryShape,
} from "../Services/ProviderSessionDirectory.ts";

function toPersistenceError(operation: string) {
  return (cause: unknown) =>
    new ProviderSessionDirectoryPersistenceError({
      operation,
      detail: `Failed to execute ${operation}.`,
      cause,
    });
}

function isSupportedProviderKind(providerName: string): providerName is ProviderKind {
  return providerName === "codex";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeRuntimePayload(
  existing: unknown | null,
  next: unknown | null | undefined,
): unknown | null {
  if (next === undefined) {
    return existing ?? null;
  }
  if (isRecord(existing) && isRecord(next)) {
    return { ...existing, ...next };
  }
  return next;
}

const makeProviderSessionDirectory = Effect.gen(function* () {
  const repository = yield* ProviderSessionRuntimeRepository;

  const dropUnsupportedBinding = <A>(input: {
    readonly threadId: ThreadId;
    readonly providerName: string;
    readonly operation: string;
    readonly fallback: A;
  }) =>
    Effect.gen(function* () {
      yield* Effect.logWarning("dropping unsupported persisted provider binding", {
        threadId: input.threadId,
        providerName: input.providerName,
        operation: input.operation,
      });
      yield* repository.deleteByThreadId({ threadId: input.threadId }).pipe(
        Effect.mapError(toPersistenceError(`${input.operation}:deleteByThreadId`)),
        Effect.catch((cause) =>
          Effect.logWarning("failed to delete unsupported persisted provider binding", {
            threadId: input.threadId,
            providerName: input.providerName,
            operation: input.operation,
            cause,
          }),
        ),
      );
      return input.fallback;
    });

  const getBinding: ProviderSessionDirectoryShape["getBinding"] = (threadId) =>
    repository.getByThreadId({ threadId }).pipe(
      Effect.mapError(toPersistenceError("ProviderSessionDirectory.getBinding:getByThreadId")),
      Effect.flatMap((runtime) =>
        Option.match(runtime, {
          onNone: () => Effect.succeed(Option.none<ProviderRuntimeBinding>()),
          onSome: (value) =>
            isSupportedProviderKind(value.providerName)
              ? Effect.succeed(
                  Option.some({
                    threadId: value.threadId,
                    provider: value.providerName,
                    adapterKey: value.adapterKey,
                    runtimeMode: value.runtimeMode,
                    status: value.status,
                    resumeCursor: value.resumeCursor,
                    runtimePayload: value.runtimePayload,
                  }),
                )
              : dropUnsupportedBinding({
                  threadId: value.threadId,
                  providerName: value.providerName,
                  operation: "ProviderSessionDirectory.getBinding",
                  fallback: Option.none<ProviderRuntimeBinding>(),
                }),
        }),
      ),
    );

  const upsert: ProviderSessionDirectoryShape["upsert"] = Effect.fn(function* (binding) {
    const existing = yield* repository
      .getByThreadId({ threadId: binding.threadId })
      .pipe(Effect.mapError(toPersistenceError("ProviderSessionDirectory.upsert:getByThreadId")));

    const existingRuntime = Option.getOrUndefined(existing);
    const resolvedThreadId = binding.threadId ?? existingRuntime?.threadId;
    if (!resolvedThreadId) {
      return yield* new ProviderValidationError({
        operation: "ProviderSessionDirectory.upsert",
        issue: "threadId must be a non-empty string.",
      });
    }

    const now = new Date().toISOString();
    const providerChanged =
      existingRuntime !== undefined && existingRuntime.providerName !== binding.provider;
    yield* repository
      .upsert({
        threadId: resolvedThreadId,
        providerName: binding.provider,
        adapterKey:
          binding.adapterKey ??
          (providerChanged ? binding.provider : (existingRuntime?.adapterKey ?? binding.provider)),
        runtimeMode: binding.runtimeMode ?? existingRuntime?.runtimeMode ?? "full-access",
        status: binding.status ?? existingRuntime?.status ?? "running",
        lastSeenAt: now,
        resumeCursor:
          binding.resumeCursor !== undefined
            ? binding.resumeCursor
            : (existingRuntime?.resumeCursor ?? null),
        runtimePayload: mergeRuntimePayload(
          existingRuntime?.runtimePayload ?? null,
          binding.runtimePayload,
        ),
      })
      .pipe(Effect.mapError(toPersistenceError("ProviderSessionDirectory.upsert:upsert")));
  });

  const getProvider: ProviderSessionDirectoryShape["getProvider"] = (threadId) =>
    getBinding(threadId).pipe(
      Effect.flatMap((binding) =>
        Option.match(binding, {
          onSome: (value) => Effect.succeed(value.provider),
          onNone: () =>
            Effect.fail(
              new ProviderSessionDirectoryPersistenceError({
                operation: "ProviderSessionDirectory.getProvider",
                detail: `No persisted provider binding found for thread '${threadId}'.`,
              }),
            ),
        }),
      ),
    );

  const remove: ProviderSessionDirectoryShape["remove"] = (threadId) =>
    repository
      .deleteByThreadId({ threadId })
      .pipe(
        Effect.mapError(toPersistenceError("ProviderSessionDirectory.remove:deleteByThreadId")),
      );

  const listThreadIds: ProviderSessionDirectoryShape["listThreadIds"] = () =>
    repository.list().pipe(
      Effect.mapError(toPersistenceError("ProviderSessionDirectory.listThreadIds:list")),
      Effect.flatMap((rows) =>
        Effect.forEach(
          rows,
          (row) =>
            isSupportedProviderKind(row.providerName)
              ? Effect.succeed(Option.some(row.threadId))
              : dropUnsupportedBinding({
                  threadId: row.threadId,
                  providerName: row.providerName,
                  operation: "ProviderSessionDirectory.listThreadIds",
                  fallback: Option.none<ThreadId>(),
                }),
          { concurrency: "unbounded" },
        ),
      ),
      Effect.map((threadIdOptions): Array<ThreadId> => {
        const threadIds: Array<ThreadId> = [];
        for (const threadIdOption of threadIdOptions) {
          if (Option.isSome(threadIdOption)) {
            threadIds.push(threadIdOption.value);
          }
        }
        return threadIds;
      }),
    );

  return {
    upsert,
    getProvider,
    getBinding,
    remove,
    listThreadIds,
  } satisfies ProviderSessionDirectoryShape;
});

export const ProviderSessionDirectoryLive = Layer.effect(
  ProviderSessionDirectory,
  makeProviderSessionDirectory,
);

export function makeProviderSessionDirectoryLive() {
  return Layer.effect(ProviderSessionDirectory, makeProviderSessionDirectory);
}
