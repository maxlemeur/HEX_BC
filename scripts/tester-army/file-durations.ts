// Seconds of selected tests, excluding runner setup. Keep the checked ceiling separate
// from schema validation: a slow journey must still be planned with neverTogether.
export const WARNING_SECONDS = 400;
const HARD_SECONDS = 600;
const exceptions = new Map<string, number>();

export function durationCeiling(file: string) {
  return exceptions.get(file) ?? HARD_SECONDS;
}

export function durationWarnings(seconds: Record<string, number>): string[] {
  return Object.entries(seconds).filter(([, value]) => value > WARNING_SECONDS)
    .sort((a, b) => b[1] - a[1])
    .map(([file, value]) => `⚠ ${file} — ${value} s de tests (seuil d’alerte ${WARNING_SECONDS} s).`);
}

/** A complete measurement requires a single passing attempt for every selected test of the file. */
export function measuredSeconds(results: Record<string, unknown>[]): Record<string, number> {
  const milliseconds = new Map<string, number>();
  const incomplete = new Set<string>();
  for (const result of results) {
    if (result.selected !== true || typeof result.file !== "string") continue;
    const attempts = result.attempts;
    const attempt = Array.isArray(attempts) && attempts.length === 1 ? attempts[0] : undefined;
    if (result.expectedFailure != null || result.status !== "passed" || attempt?.status !== "passed" ||
        attempt.expectedFailure != null || !Number.isSafeInteger(attempt.durationMs) || attempt.durationMs < 0) {
      incomplete.add(result.file);
      continue;
    }
    milliseconds.set(result.file, (milliseconds.get(result.file) ?? 0) + attempt.durationMs);
  }
  return Object.fromEntries([...milliseconds].filter(([file]) => !incomplete.has(file))
    .map(([file, ms]) => [file, Math.max(1, Math.ceil(ms / 1000))]));
}
