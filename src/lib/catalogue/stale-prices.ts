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

export type PriceFreshnessLevel = "fresh" | "aging" | "stale";

export function priceFreshnessLevel(
  input: { updatedAt?: string | null; createdAt?: string | null },
  now = new Date()
): { level: PriceFreshnessLevel; ageDays: number } {
  const rawDate = input.updatedAt ?? input.createdAt ?? null;
  if (!rawDate) return { level: "fresh", ageDays: 0 };

  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) return { level: "fresh", ageDays: 0 };

  const ageDays = Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));

  if (ageDays <= 30) return { level: "fresh", ageDays };
  if (ageDays <= 90) return { level: "aging", ageDays };
  return { level: "stale", ageDays };
}
