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

