export const DEFAULT_RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000] as const;

export function getReconnectDelayMs(
  attempt: number,
  delaysMs: readonly number[] = DEFAULT_RECONNECT_DELAYS_MS,
): number {
  return delaysMs[Math.min(attempt, delaysMs.length - 1)] ?? DEFAULT_RECONNECT_DELAYS_MS[0];
}

export class ReconnectController {
  private readonly delaysMs: readonly number[];
  private attempt = 0;
  private enabled = true;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(delaysMs: readonly number[] = DEFAULT_RECONNECT_DELAYS_MS) {
    this.delaysMs = delaysMs;
  }

  reset(): void {
    this.attempt = 0;
    this.clear();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.clear();
    }
  }

  schedule(run: () => void): void {
    if (!this.enabled || this.timer !== null) {
      return;
    }
    const delay = getReconnectDelayMs(this.attempt, this.delaysMs);
    this.attempt += 1;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.enabled) {
        return;
      }
      run();
    }, delay);
  }

  dispose(): void {
    this.enabled = false;
    this.clear();
  }

  private clear(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
