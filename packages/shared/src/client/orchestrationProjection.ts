import type { OrchestrationEvent, OrchestrationReadModel } from "@t3tools/contracts";

export interface OrchestrationProjectionState {
  readonly readModel: OrchestrationReadModel | null;
  readonly lastSequence: number;
}

export type OrchestrationSequenceResolution =
  | { readonly kind: "duplicate"; readonly expectedSequence: number }
  | { readonly kind: "in-order"; readonly expectedSequence: number }
  | { readonly kind: "gap"; readonly expectedSequence: number };

export function createProjectionState(
  readModel: OrchestrationReadModel | null = null,
): OrchestrationProjectionState {
  return {
    readModel,
    lastSequence: readModel?.snapshotSequence ?? 0,
  };
}

export function hydrateProjectionFromSnapshot(
  snapshot: OrchestrationReadModel,
): OrchestrationProjectionState {
  return {
    readModel: snapshot,
    lastSequence: snapshot.snapshotSequence,
  };
}

export function resolveIncomingSequence(
  state: OrchestrationProjectionState,
  event: Pick<OrchestrationEvent, "sequence">,
): OrchestrationSequenceResolution {
  const expectedSequence = state.lastSequence + 1;
  if (event.sequence <= state.lastSequence) {
    return { kind: "duplicate", expectedSequence };
  }
  if (event.sequence !== expectedSequence) {
    return { kind: "gap", expectedSequence };
  }
  return { kind: "in-order", expectedSequence };
}

export function advanceProjectionSequence(
  state: OrchestrationProjectionState,
  event: Pick<OrchestrationEvent, "sequence">,
): OrchestrationProjectionState {
  return {
    ...state,
    lastSequence: Math.max(state.lastSequence, event.sequence),
  };
}

export function applyReplayedSequence(
  state: OrchestrationProjectionState,
  events: ReadonlyArray<Pick<OrchestrationEvent, "sequence">>,
): OrchestrationProjectionState {
  let lastSequence = state.lastSequence;
  for (const event of events) {
    if (event.sequence > lastSequence) {
      lastSequence = event.sequence;
    }
  }
  return { ...state, lastSequence };
}
