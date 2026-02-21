export type MarginTier = {
  id?: string;
  tenant_id?: string;
  threshold_cents: number;
  multiplier: number;
  position?: number;
};

const DEFAULT_MARGIN_TIERS: MarginTier[] = [
  { threshold_cents: 0, multiplier: 1.6, position: 0 },
  { threshold_cents: 10_000_000, multiplier: 1.45, position: 1 },
  { threshold_cents: 100_000_000, multiplier: 1.4, position: 2 },
];

function toSafeNumber(value: number | null | undefined, fallback: number): number {
  return Number.isFinite(value ?? NaN) ? (value ?? fallback) : fallback;
}

function normalizeMarginTiers(tiers: MarginTier[]): MarginTier[] {
  return tiers
    .map((tier, index) => ({
      ...tier,
      threshold_cents: Math.max(
        Math.round(toSafeNumber(tier.threshold_cents, 0)),
        0
      ),
      multiplier: Math.max(toSafeNumber(tier.multiplier, 1), 0),
      position: Math.round(toSafeNumber(tier.position, index)),
    }))
    .sort((left, right) => {
      if (left.threshold_cents !== right.threshold_cents) {
        return left.threshold_cents - right.threshold_cents;
      }
      return (left.position ?? 0) - (right.position ?? 0);
    });
}

export function getMarginTiers(): MarginTier[] {
  return DEFAULT_MARGIN_TIERS.map((tier) => ({ ...tier }));
}

export function resolveMarginMultiplier(
  totalCostCents: number,
  tiers: MarginTier[]
): number {
  const sourceTiers = tiers.length > 0 ? tiers : getMarginTiers();
  const normalizedTiers = normalizeMarginTiers(sourceTiers);
  if (normalizedTiers.length === 0) return 1;

  const safeTotalCostCents = Math.max(
    Math.round(toSafeNumber(totalCostCents, 0)),
    0
  );
  let selectedTier = normalizedTiers[0];

  for (const tier of normalizedTiers) {
    if (safeTotalCostCents < tier.threshold_cents) break;
    selectedTier = tier;
  }

  return selectedTier.multiplier;
}
