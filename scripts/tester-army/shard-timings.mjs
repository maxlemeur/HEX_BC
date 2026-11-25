function milliseconds(seconds) {
  if (typeof seconds !== "number" || seconds <= 0) return null;
  const value = Math.round(seconds * 1_000);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Build the e2e CLI's timings-1 history for one explicit desktop shard.
 * Give new files the planning default: the scheduler starts unknown files before known ones.
 * @param {readonly string[]} files Project-relative POSIX paths accepted by the Army CLI.
 * @param {{ schemaVersion: number, defaultSeconds: number, seconds?: Record<string, number> } | null} durations
 */
export function shardTimingHistory(files, durations) {
  if (durations?.schemaVersion !== 1) return null;
  const fallback = milliseconds(durations.defaultSeconds);
  if (fallback === null) return null;
  return {
    schemaVersion: "timings-1",
    files: Object.fromEntries(files.toSorted().map((file) => [
      `chromium-desktop::${file}`, milliseconds(durations.seconds?.[file]) ?? fallback,
    ])),
  };
}
