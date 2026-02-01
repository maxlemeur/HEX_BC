import { computeTaxCents } from "@/lib/money";

export type EstimateLineLike = {
  quantity: number | null;
  unit_price_ht_cents: number | null;
  tax_rate_bp: number | null;
  k_fo: number | null;
  h_mo: number | null;
  k_mo: number | null;
  pu_ht_cents: number | null;
  labor_role_hourly_rate_cents?: number | null;
};

export type EstimateLineValues = {
  costLineCents: number;
  saleLineCents: number;
  puHtCents: number;
  taxLineCents: number;
  ttcLineCents: number;
};

export type EstimateTotals = {
  costSubtotalCents: number;
  saleSubtotalCents: number;
  discountCents: number;
  saleTotalCents: number;
  taxCents: number;
  ttcCents: number;
  roundedTtcCents: number;
  roundingAdjustmentCents: number;
  adjustedTaxCents: number;
};

export type RoundingMode = "none" | "nearest" | "up" | "down";

function toSafeNumber(value: number | null | undefined, fallback: number) {
  return Number.isFinite(value ?? NaN) ? (value ?? fallback) : fallback;
}

function clampNonNegative(value: number) {
  return value < 0 ? 0 : value;
}

function applyRounding(value: number, mode: RoundingMode, step: number) {
  if (mode === "none") return value;
  const safeStep = step > 0 ? step : 1;
  const ratio = value / safeStep;
  if (mode === "up") return Math.ceil(ratio) * safeStep;
  if (mode === "down") return Math.floor(ratio) * safeStep;
  return Math.round(ratio) * safeStep;
}

export function computeEstimateLineValues(
  item: EstimateLineLike,
  {
    marginMultiplier,
    taxRateBp,
  }: { marginMultiplier: number; taxRateBp: number }
): EstimateLineValues {
  const quantity = Math.max(toSafeNumber(item.quantity, 0), 0);
  const unitPrice = Math.max(toSafeNumber(item.unit_price_ht_cents, 0), 0);
  const kFo = Math.max(toSafeNumber(item.k_fo, 1), 0);
  const hMo = Math.max(toSafeNumber(item.h_mo, 0), 0);
  const kMo = Math.max(toSafeNumber(item.k_mo, 1), 0);
  const hourlyRate = Math.max(
    toSafeNumber(item.labor_role_hourly_rate_cents ?? 0, 0),
    0
  );
  const safeMargin = Math.max(toSafeNumber(marginMultiplier, 1), 0);
  const safeTaxRate = Math.max(toSafeNumber(taxRateBp, 0), 0);

  const foCostCents = Math.round(quantity * unitPrice * kFo);
  const moCostCents = Math.round(hMo * hourlyRate * kMo);
  const costLineCents = clampNonNegative(foCostCents + moCostCents);
  const saleLineCents = clampNonNegative(
    Math.round(costLineCents * safeMargin)
  );
  const puHtCents =
    quantity > 0 ? Math.round(saleLineCents / quantity) : 0;
  const taxLineCents = computeTaxCents(saleLineCents, safeTaxRate);
  const ttcLineCents = saleLineCents + taxLineCents;

  return {
    costLineCents,
    saleLineCents,
    puHtCents,
    taxLineCents,
    ttcLineCents,
  };
}

export function computeEstimateTotals({
  lineItems,
  marginMultiplier,
  discountCents,
  taxRateBp,
  roundingMode,
  roundingStepCents,
}: {
  lineItems: EstimateLineLike[];
  marginMultiplier: number;
  discountCents: number;
  taxRateBp: number;
  roundingMode: RoundingMode;
  roundingStepCents: number;
}): EstimateTotals {
  const safeMargin = Math.max(toSafeNumber(marginMultiplier, 1), 0);
  const safeDiscount = Math.max(toSafeNumber(discountCents, 0), 0);
  const safeTaxRate = Math.max(toSafeNumber(taxRateBp, 0), 0);

  const totals = lineItems.reduce(
    (acc, item) => {
      const line = computeEstimateLineValues(item, {
        marginMultiplier: safeMargin,
        taxRateBp: safeTaxRate,
      });
      acc.costSubtotalCents += line.costLineCents;
      acc.saleSubtotalCents += line.saleLineCents;
      return acc;
    },
    { costSubtotalCents: 0, saleSubtotalCents: 0 }
  );

  const saleTotalCents = Math.max(totals.saleSubtotalCents - safeDiscount, 0);
  const taxCents = computeTaxCents(saleTotalCents, safeTaxRate);
  const ttcCents = saleTotalCents + taxCents;
  const roundedCandidate = applyRounding(
    ttcCents,
    roundingMode,
    roundingStepCents
  );
  const roundedTtcCents = Math.max(roundedCandidate, saleTotalCents);
  const roundingAdjustmentCents = roundedTtcCents - ttcCents;
  const adjustedTaxCents = roundedTtcCents - saleTotalCents;

  return {
    costSubtotalCents: totals.costSubtotalCents,
    saleSubtotalCents: totals.saleSubtotalCents,
    discountCents: safeDiscount,
    saleTotalCents,
    taxCents,
    ttcCents,
    roundedTtcCents,
    roundingAdjustmentCents,
    adjustedTaxCents,
  };
}
