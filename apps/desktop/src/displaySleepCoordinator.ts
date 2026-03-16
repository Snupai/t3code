import { powerSaveBlocker } from "electron";

export interface PowerSaveBlockerLike {
  isStarted: (id: number) => boolean;
  start: (type: "prevent-display-sleep") => number;
  stop: (id: number) => void;
}

export interface DisplaySleepCoordinator {
  clearAll: () => void;
  clearRequester: (requesterId: number) => void;
  setRequesterBlocked: (requesterId: number, blocked: boolean) => void;
}

export function createDisplaySleepCoordinator(
  blocker: PowerSaveBlockerLike = powerSaveBlocker,
): DisplaySleepCoordinator {
  let activeBlockerId: number | null = null;
  const blockedRequesterIds = new Set<number>();

  const stopBlocker = (): void => {
    if (activeBlockerId !== null && blocker.isStarted(activeBlockerId)) {
      blocker.stop(activeBlockerId);
    }
    activeBlockerId = null;
  };

  const ensureBlockerStarted = (): void => {
    if (activeBlockerId !== null && blocker.isStarted(activeBlockerId)) {
      return;
    }
    activeBlockerId = blocker.start("prevent-display-sleep");
  };

  const syncBlockerState = (): void => {
    if (blockedRequesterIds.size === 0) {
      stopBlocker();
      return;
    }

    ensureBlockerStarted();
  };

  return {
    clearAll: () => {
      blockedRequesterIds.clear();
      stopBlocker();
    },
    clearRequester: (requesterId) => {
      blockedRequesterIds.delete(requesterId);
      syncBlockerState();
    },
    setRequesterBlocked: (requesterId, blocked) => {
      if (blocked) {
        blockedRequesterIds.add(requesterId);
      } else {
        blockedRequesterIds.delete(requesterId);
      }
      syncBlockerState();
    },
  };
}
