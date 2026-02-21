export const DEFAULT_STALE_PRICE_DAYS = 90;
const MAX_STALE_PRICE_DAYS = 3650;

export function parseStalePriceDays(
  value: string | number | null | undefined,
  fallback = DEFAULT_STALE_PRICE_DAYS
) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = Math.floor(value);
    if (normalized > 0 && normalized <= MAX_STALE_PRICE_DAYS) {
      return normalized;
    }
    return fallback;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= MAX_STALE_PRICE_DAYS) {
      return parsed;
    }
  }

  return fallback;
}

export function isPriceStale(
  input: { updatedAt?: string | null; createdAt?: string | null },
  staleDays = DEFAULT_STALE_PRICE_DAYS,
  now = new Date()
) {
  const thresholdDays = parseStalePriceDays(staleDays);
  const rawDate = input.updatedAt ?? input.createdAt ?? null;
  if (!rawDate) return false;

  const updatedAt = new Date(rawDate);
  if (Number.isNaN(updatedAt.getTime())) return false;

  const ageMs = now.getTime() - updatedAt.getTime();
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
  return ageMs > thresholdMs;
}
