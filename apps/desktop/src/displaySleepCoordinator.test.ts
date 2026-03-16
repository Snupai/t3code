import { describe, expect, it, vi } from "vitest";

import {
  createDisplaySleepCoordinator,
  type PowerSaveBlockerLike,
} from "./displaySleepCoordinator";

function createMockBlocker() {
  const startedIds = new Set<number>();
  let nextId = 1;

  const blocker: PowerSaveBlockerLike = {
    isStarted: vi.fn((id: number) => startedIds.has(id)),
    start: vi.fn(() => {
      const id = nextId++;
      startedIds.add(id);
      return id;
    }),
    stop: vi.fn((id: number) => {
      startedIds.delete(id);
    }),
  };

  return { blocker, startedIds };
}

describe("displaySleepCoordinator", () => {
  it("starts one blocker when the first requester enables blocking", () => {
    const { blocker, startedIds } = createMockBlocker();
    const coordinator = createDisplaySleepCoordinator(blocker);

    coordinator.setRequesterBlocked(1, true);

    expect(blocker.start).toHaveBeenCalledTimes(1);
    expect(startedIds.size).toBe(1);
  });

  it("does not start another blocker when the same requester repeats enable", () => {
    const { blocker } = createMockBlocker();
    const coordinator = createDisplaySleepCoordinator(blocker);

    coordinator.setRequesterBlocked(1, true);
    coordinator.setRequesterBlocked(1, true);

    expect(blocker.start).toHaveBeenCalledTimes(1);
  });

  it("keeps the blocker alive until the last requester clears", () => {
    const { blocker, startedIds } = createMockBlocker();
    const coordinator = createDisplaySleepCoordinator(blocker);

    coordinator.setRequesterBlocked(1, true);
    coordinator.setRequesterBlocked(2, true);
    coordinator.clearRequester(1);

    expect(startedIds.size).toBe(1);
    expect(blocker.stop).not.toHaveBeenCalled();

    coordinator.clearRequester(2);

    expect(blocker.stop).toHaveBeenCalledTimes(1);
    expect(startedIds.size).toBe(0);
  });

  it("clears a destroyed requester without affecting remaining requesters", () => {
    const { blocker, startedIds } = createMockBlocker();
    const coordinator = createDisplaySleepCoordinator(blocker);

    coordinator.setRequesterBlocked(1, true);
    coordinator.setRequesterBlocked(2, true);
    coordinator.clearRequester(1);

    expect(startedIds.size).toBe(1);
    expect(blocker.stop).not.toHaveBeenCalled();
  });

  it("replaces a stale blocker id when Electron reports it as stopped", () => {
    const { blocker, startedIds } = createMockBlocker();
    const coordinator = createDisplaySleepCoordinator(blocker);

    coordinator.setRequesterBlocked(1, true);
    startedIds.clear();
    coordinator.setRequesterBlocked(1, true);

    expect(blocker.start).toHaveBeenCalledTimes(2);
  });

  it("treats redundant clears as a no-op after release", () => {
    const { blocker } = createMockBlocker();
    const coordinator = createDisplaySleepCoordinator(blocker);

    coordinator.setRequesterBlocked(1, true);
    coordinator.clearRequester(1);
    coordinator.clearRequester(1);
    coordinator.clearAll();

    expect(blocker.stop).toHaveBeenCalledTimes(1);
  });
});
