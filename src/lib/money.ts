export function formatEUR(cents: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

export function parseEuroToCents(input: string) {
  const normalized = input.replace(/\s/g, "").replace(",", ".");
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

export function computeTaxCents(amountCents: number, taxRateBp: number) {
  return Math.round((amountCents * taxRateBp) / 10000);
}

/**
 * Banker's rounding (round half to nearest even).
 * Recommended by DGFIP to avoid systematic upward bias from Math.round.
 */
export function bankersRound(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const truncated = Math.trunc(value);
  const remainder = Math.abs(value - truncated);
  if (Math.abs(remainder - 0.5) < 1e-9) {
    const even = truncated % 2 === 0 ? truncated : truncated + Math.sign(value);
    return even === 0 ? 0 : even; // coerce -0 to +0
  }
  return Math.round(value);
}

