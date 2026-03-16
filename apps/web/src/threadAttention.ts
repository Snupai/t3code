import type { Thread } from "./types";
import {
  derivePendingApprovals,
  derivePendingUserInputs,
  findLatestProposedPlan,
  isLatestTurnSettled,
} from "./session-logic";

export type ThreadAttentionState =
  | "pending-approval"
  | "pending-user-input"
  | "working"
  | "connecting"
  | "plan-ready"
  | "completed"
  | "idle";

type ThreadAttentionInput = Pick<
  Thread,
  "activities" | "interactionMode" | "latestTurn" | "lastVisitedAt" | "proposedPlans" | "session"
>;

interface ThreadAttentionOverrides {
  hasPendingApprovals?: boolean;
  hasPendingUserInput?: boolean;
}

export function hasUnseenCompletion(thread: ThreadAttentionInput): boolean {
  if (!thread.latestTurn?.completedAt) return false;
  const completedAt = Date.parse(thread.latestTurn.completedAt);
  if (Number.isNaN(completedAt)) return false;
  if (!thread.lastVisitedAt) return true;

  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  if (Number.isNaN(lastVisitedAt)) return true;
  return completedAt > lastVisitedAt;
}

export function resolveThreadAttentionState(
  thread: ThreadAttentionInput,
  overrides?: ThreadAttentionOverrides,
): ThreadAttentionState {
  const hasPendingApprovals =
    overrides?.hasPendingApprovals ?? derivePendingApprovals(thread.activities).length > 0;
  if (hasPendingApprovals) {
    return "pending-approval";
  }

  const hasPendingUserInput =
    overrides?.hasPendingUserInput ?? derivePendingUserInputs(thread.activities).length > 0;
  if (hasPendingUserInput) {
    return "pending-user-input";
  }

  if (thread.session?.status === "running") {
    return "working";
  }

  if (thread.session?.status === "connecting") {
    return "connecting";
  }

  const hasPlanReadyPrompt =
    thread.interactionMode === "plan" &&
    isLatestTurnSettled(thread.latestTurn, thread.session) &&
    findLatestProposedPlan(thread.proposedPlans, thread.latestTurn?.turnId ?? null) !== null;
  if (hasPlanReadyPrompt) {
    return "plan-ready";
  }

  if (hasUnseenCompletion(thread)) {
    return "completed";
  }

  return "idle";
}

export function threadBlocksDisplaySleep(thread: ThreadAttentionInput): boolean {
  const state = resolveThreadAttentionState(thread);
  return state === "pending-approval" || state === "pending-user-input" || state === "working";
}

export function anyThreadBlocksDisplaySleep(threads: ReadonlyArray<ThreadAttentionInput>): boolean {
  return threads.some((thread) => threadBlocksDisplaySleep(thread));
}
