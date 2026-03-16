import {
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import type { Thread } from "./types";
import {
  anyThreadBlocksDisplaySleep,
  resolveThreadAttentionState,
  threadBlocksDisplaySleep,
} from "./threadAttention";

function makeThread(overrides?: Partial<Thread>): Thread {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    codexThreadId: null,
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread",
    provider: "codex",
    model: "gpt-5",
    runtimeMode: "full-access",
    interactionMode: "default",
    session: {
      provider: "codex",
      status: "ready",
      createdAt: "2026-03-10T10:00:00.000Z",
      updatedAt: "2026-03-10T10:00:00.000Z",
      orchestrationStatus: "ready",
    },
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-03-10T10:00:00.000Z",
    latestTurn: null,
    lastVisitedAt: "2026-03-10T10:00:00.000Z",
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
    ...overrides,
  };
}

function makeActivity(overrides: {
  kind: string;
  createdAt?: string;
  tone?: OrchestrationThreadActivity["tone"];
  payload?: Record<string, unknown>;
}): OrchestrationThreadActivity {
  return {
    id: EventId.makeUnsafe(`${overrides.kind}-${overrides.createdAt ?? "1"}`),
    createdAt: overrides.createdAt ?? "2026-03-10T10:00:01.000Z",
    kind: overrides.kind,
    summary: overrides.kind,
    tone: overrides.tone ?? "info",
    payload: overrides.payload ?? {},
    turnId: null,
  };
}

describe("resolveThreadAttentionState", () => {
  it("returns working for a running thread", () => {
    const thread = makeThread({
      session: {
        provider: "codex",
        status: "running",
        createdAt: "2026-03-10T10:00:00.000Z",
        updatedAt: "2026-03-10T10:00:00.000Z",
        orchestrationStatus: "running",
      },
    });

    expect(resolveThreadAttentionState(thread)).toBe("working");
    expect(threadBlocksDisplaySleep(thread)).toBe(true);
  });

  it("returns pending-approval ahead of running", () => {
    const thread = makeThread({
      session: {
        provider: "codex",
        status: "running",
        createdAt: "2026-03-10T10:00:00.000Z",
        updatedAt: "2026-03-10T10:00:00.000Z",
        orchestrationStatus: "running",
      },
      activities: [
        makeActivity({
          kind: "approval.requested",
          tone: "approval",
          payload: {
            requestId: "req-approval-1",
            requestKind: "command",
          },
        }),
      ],
    });

    expect(resolveThreadAttentionState(thread)).toBe("pending-approval");
    expect(threadBlocksDisplaySleep(thread)).toBe(true);
  });

  it("returns pending-user-input when waiting on user answers", () => {
    const thread = makeThread({
      activities: [
        makeActivity({
          kind: "user-input.requested",
          payload: {
            requestId: "req-user-input-1",
            questions: [
              {
                id: "runtime_mode",
                header: "Runtime",
                question: "Which mode should be used?",
                options: [{ label: "Full access", description: "Allow execution" }],
              },
            ],
          },
        }),
      ],
    });

    expect(resolveThreadAttentionState(thread)).toBe("pending-user-input");
    expect(threadBlocksDisplaySleep(thread)).toBe(true);
  });

  it("returns connecting without blocking display sleep", () => {
    const thread = makeThread({
      session: {
        provider: "codex",
        status: "connecting",
        createdAt: "2026-03-10T10:00:00.000Z",
        updatedAt: "2026-03-10T10:00:00.000Z",
        orchestrationStatus: "starting",
      },
    });

    expect(resolveThreadAttentionState(thread)).toBe("connecting");
    expect(threadBlocksDisplaySleep(thread)).toBe(false);
  });

  it("returns completed for unseen completed turns", () => {
    const thread = makeThread({
      latestTurn: {
        turnId: TurnId.makeUnsafe("turn-completed"),
        state: "completed",
        assistantMessageId: MessageId.makeUnsafe("msg-assistant-1"),
        requestedAt: "2026-03-10T10:00:00.000Z",
        startedAt: "2026-03-10T10:00:01.000Z",
        completedAt: "2026-03-10T10:00:05.000Z",
      },
      lastVisitedAt: "2026-03-10T10:00:03.000Z",
    });

    expect(resolveThreadAttentionState(thread)).toBe("completed");
    expect(threadBlocksDisplaySleep(thread)).toBe(false);
  });

  it("returns plan-ready for settled plan turns with a proposed plan", () => {
    const thread = makeThread({
      interactionMode: "plan",
      latestTurn: {
        turnId: TurnId.makeUnsafe("turn-plan-1"),
        state: "completed",
        assistantMessageId: null,
        requestedAt: "2026-03-10T10:00:00.000Z",
        startedAt: "2026-03-10T10:00:01.000Z",
        completedAt: "2026-03-10T10:00:05.000Z",
      },
      proposedPlans: [
        {
          id: "plan-1" as never,
          turnId: TurnId.makeUnsafe("turn-plan-1"),
          planMarkdown: "# Plan",
          createdAt: "2026-03-10T10:00:03.000Z",
          updatedAt: "2026-03-10T10:00:05.000Z",
        },
      ],
    });

    expect(resolveThreadAttentionState(thread)).toBe("plan-ready");
    expect(threadBlocksDisplaySleep(thread)).toBe(false);
  });
});

describe("anyThreadBlocksDisplaySleep", () => {
  it("returns true when any thread is active or waiting", () => {
    const idleThread = makeThread();
    const waitingThread = makeThread({
      id: ThreadId.makeUnsafe("thread-2"),
      activities: [
        makeActivity({
          kind: "approval.requested",
          tone: "approval",
          payload: {
            requestId: "req-approval-2",
            requestKind: "file-change",
          },
        }),
      ],
    });

    expect(anyThreadBlocksDisplaySleep([idleThread, waitingThread])).toBe(true);
  });
});
