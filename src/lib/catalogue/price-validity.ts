import { isValidDateOnly } from "@/lib/date-only";

export const PRICE_VALIDITY_ERROR =
  "La date de fin doit être comprise entre la date de début et six mois après celle-ci.";

export function maxPriceValidTo(validFrom: string): string {
  if (!isValidDateOnly(validFrom)) throw new Error("Date de début invalide.");
  const date = new Date(`${validFrom}T00:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 6);
  const lastDay = new Date(date.getTime());
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
  date.setUTCDate(Math.min(day, lastDay.getUTCDate()));
  return date.toISOString().slice(0, 10);
}

export function resolvePriceValidity(
  validFrom?: string | null,
  validTo?: string | null,
): { valid_from: string; valid_to: string } {
  const start = validFrom || new Date().toISOString().slice(0, 10);
  const maximum = maxPriceValidTo(start);
  const end = validTo || maximum;
  if (!isValidDateOnly(end) || end < start || end > maximum) {
    throw new Error(PRICE_VALIDITY_ERROR);
  }
  return { valid_from: start, valid_to: end };
}
