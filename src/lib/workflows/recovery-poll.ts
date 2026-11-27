import "server-only";

// Bound the delay after a failed pass so a Mac discovers a recovering database.
const MAX_RECOVERY_DELAY_MS = 120_000;

export function startRecoveryPoll({
  intervalMs, initialDelayMs = intervalMs, run, onError,
}: {
  intervalMs: number;
  initialDelayMs?: number;
  /** A successful pass may choose its next delay for a busy or idle queue. */
  run: () => Promise<number | void>;
  onError: () => void;
}) {
  let failureDelayMs = intervalMs;
  async function poll() {
    let nextDelayMs: number;
    const startedAt = performance.now();
    try {
      const requestedDelay = await run();
      // Fixed-interval workers skip ticks while busy and resume at the next tick.
      // A queue with a variable cadence supplies its delay from the end of its pass.
      nextDelayMs = requestedDelay ?? (intervalMs - ((performance.now() - startedAt) % intervalMs));
      failureDelayMs = intervalMs;
    } catch {
      failureDelayMs = Math.min(failureDelayMs * 2, MAX_RECOVERY_DELAY_MS);
      nextDelayMs = failureDelayMs;
      onError();
    }
    setTimeout(() => void poll(), nextDelayMs).unref();
  }

  setTimeout(() => void poll(), initialDelayMs).unref();
}
