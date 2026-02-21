import { bankersRound, computeTaxCents } from "@/lib/money";

/* ---------- constants ---------- */

/** Maximum allowed margin multiplier (A6 overflow guard). */
export const MAX_MARGIN_MULTIPLIER = 100;

/** Maximum PostgreSQL integer value – caps computed cents to avoid DB overflow. */
export const MAX_CENTS = 2_147_483_647;

/* ---------- shared types ---------- */

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

/* ---------- helpers ---------- */

function toSafeNumber(value: number | null | undefined, fallback: number) {
  return Number.isFinite(value ?? NaN) ? (value ?? fallback) : fallback;
}

function clampNonNegative(value: number) {
  return value < 0 ? 0 : value;
}

/** Cap a cents value to the PostgreSQL integer range. */
function capCents(value: number): number {
  return Math.min(value, MAX_CENTS);
}

function applyRounding(value: number, mode: RoundingMode, step: number) {
  if (mode === "none") return value;
  const safeStep = step > 0 ? step : 1;
  const ratio = value / safeStep;
  if (mode === "up") return Math.ceil(ratio) * safeStep;
  if (mode === "down") return Math.floor(ratio) * safeStep;
  return Math.round(ratio) * safeStep;
}

/* ---------- line-level computation ---------- */

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
  // A6: cap margin to prevent integer overflow
  const safeMargin = Math.min(
    Math.max(toSafeNumber(marginMultiplier, 1), 0),
    MAX_MARGIN_MULTIPLIER
  );
  const safeTaxRate = Math.max(toSafeNumber(taxRateBp, 0), 0);

  // A1: single round after summation (was rounding FO and MO independently)
  const costLineCents = clampNonNegative(
    capCents(Math.round(quantity * unitPrice * kFo + hMo * hourlyRate * kMo))
  );
  // A6: cap sale line to avoid DB overflow
  const saleLineCents = clampNonNegative(
    capCents(Math.round(costLineCents * safeMargin))
  );
  // A2: banker's rounding for PU to avoid systematic upward bias
  const puHtCents =
    quantity > 0 ? bankersRound(saleLineCents / quantity) : 0;
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

/* ---------- totals computation ---------- */

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
  // A6: cap margin
  const safeMargin = Math.min(
    Math.max(toSafeNumber(marginMultiplier, 1), 0),
    MAX_MARGIN_MULTIPLIER
  );
  const safeDiscount = Math.max(toSafeNumber(discountCents, 0), 0);
  const safeTaxRate = Math.max(toSafeNumber(taxRateBp, 0), 0);

  // A5: accumulate per-line tax so that sum(line TVA) == total TVA (Attic+ method)
  const totals = lineItems.reduce(
    (acc, item) => {
      const line = computeEstimateLineValues(item, {
        marginMultiplier: safeMargin,
        taxRateBp: safeTaxRate,
      });
      acc.costSubtotalCents += line.costLineCents;
      acc.saleSubtotalCents += line.saleLineCents;
      acc.lineTaxTotalCents += line.taxLineCents;
      return acc;
    },
    { costSubtotalCents: 0, saleSubtotalCents: 0, lineTaxTotalCents: 0 }
  );

  const saleTotalCents = Math.max(totals.saleSubtotalCents - safeDiscount, 0);
  // A5: tax = sum of per-line taxes minus tax on the discount amount
  const discountTaxCents = computeTaxCents(safeDiscount, safeTaxRate);
  const taxCents = Math.max(totals.lineTaxTotalCents - discountTaxCents, 0);
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

/* ---------- B5: extracted business helpers ---------- */

/**
 * Lightweight item shape used by normalization / discount functions.
 * Satisfies Database["public"]["Tables"]["estimate_items"]["Row"].
 */
export type EstimateItemRecord = EstimateLineLike & {
  id: string;
  item_type: string;
  parent_id: string | null;
  title: string;
  description: string | null;
  position: number;
  labor_role_id: string | null;
  category_id: string | null;
  line_total_ht_cents: number | null;
  line_tax_cents: number | null;
  line_total_ttc_cents: number | null;
};

export type EstimateVersionForCalc = {
  margin_multiplier: number;
  tax_rate_bp: number;
  discount_bp: number;
  status?: string;
  total_ht_cents?: number | null;
  total_tax_cents?: number | null;
  total_ttc_cents?: number | null;
};

/**
 * Compute the initial discount in cents from `discount_bp` for a draft version.
 * Used on load to convert the stored basis-point discount to an absolute cents amount.
 */
export function computeInitialDiscountCents(
  version: EstimateVersionForCalc,
  items: EstimateItemRecord[],
  laborRateById: Map<string, number>
): number {
  const saleSubtotal = items.reduce((sum, item) => {
    if (item.item_type !== "line") return sum;
    const hourlyRate = item.labor_role_id
      ? laborRateById.get(item.labor_role_id) ?? 0
      : 0;
    const lineValues = computeEstimateLineValues(
      {
        ...item,
        labor_role_hourly_rate_cents: hourlyRate,
      },
      {
        marginMultiplier: version.margin_multiplier,
        taxRateBp: version.tax_rate_bp,
      }
    );
    return sum + lineValues.saleLineCents;
  }, 0);

  if (!saleSubtotal) return 0;
  return Math.round((saleSubtotal * version.discount_bp) / 10000);
}

/**
 * Compute the discount in cents from stored line totals (for non-draft versions).
 */
export function computeStoredDiscountCents(
  version: EstimateVersionForCalc,
  items: EstimateItemRecord[]
): number {
  const saleSubtotal = items.reduce((sum, item) => {
    if (item.item_type !== "line") return sum;
    return sum + (item.line_total_ht_cents ?? 0);
  }, 0);

  if (Number.isFinite(version.total_ht_cents ?? NaN)) {
    return Math.max(saleSubtotal - (version.total_ht_cents ?? 0), 0);
  }

  if (!saleSubtotal) return 0;
  return Math.round((saleSubtotal * version.discount_bp) / 10000);
}

/**
 * Recalculate all draft lines with the current version settings.
 * Ensures values stored in items match the version margin / tax rate.
 */
export function normalizeDraftItems<
  T extends EstimateItemRecord
>({
  items,
  version,
  rateById,
}: {
  items: T[];
  version: EstimateVersionForCalc;
  rateById: Map<string, number>;
}): T[] {
  return items.map((item) => {
    if (item.item_type !== "line") return item;
    const kFo = item.k_fo ?? 1;
    const hMo = item.h_mo ?? 0;
    const kMo = item.k_mo ?? 1;
    const hourlyRate = item.labor_role_id
      ? rateById.get(item.labor_role_id) ?? 0
      : 0;
    const taxRate = version.tax_rate_bp ?? item.tax_rate_bp ?? 0;
    const lineValues = computeEstimateLineValues(
      {
        ...item,
        k_fo: kFo,
        h_mo: hMo,
        k_mo: kMo,
        tax_rate_bp: taxRate,
        labor_role_hourly_rate_cents: hourlyRate,
      },
      {
        marginMultiplier: version.margin_multiplier,
        taxRateBp: taxRate,
      }
    );
    return {
      ...item,
      tax_rate_bp: taxRate,
      k_fo: kFo,
      h_mo: hMo,
      k_mo: kMo,
      pu_ht_cents: lineValues.puHtCents,
      line_total_ht_cents: lineValues.saleLineCents,
      line_tax_cents: lineValues.taxLineCents,
      line_total_ttc_cents: lineValues.ttcLineCents,
    };
  });
}

/**
 * Build totals for a read-only (non-draft) version using stored values.
 */
export function computeReadOnlyTotals({
  items,
  version,
  discountCents,
  laborRateById,
}: {
  items: EstimateItemRecord[];
  version: EstimateVersionForCalc;
  discountCents: number;
  laborRateById: Map<string, number>;
}): EstimateTotals {
  const costSubtotalCents = items.reduce((sum, item) => {
    if (item.item_type !== "line") return sum;
    const hourlyRate = item.labor_role_id
      ? laborRateById.get(item.labor_role_id) ?? 0
      : 0;
    const lineValues = computeEstimateLineValues(
      {
        ...item,
        labor_role_hourly_rate_cents: hourlyRate,
      },
      {
        marginMultiplier: 1,
        taxRateBp: 0,
      }
    );
    return sum + lineValues.costLineCents;
  }, 0);

  const saleSubtotalCents = items.reduce((sum, item) => {
    if (item.item_type !== "line") return sum;
    return sum + (item.line_total_ht_cents ?? 0);
  }, 0);

  const saleTotalFallback = Math.max(saleSubtotalCents - discountCents, 0);
  const saleTotalCents = Number.isFinite(version.total_ht_cents ?? NaN)
    ? (version.total_ht_cents ?? saleTotalFallback)
    : saleTotalFallback;

  const taxStored = Number.isFinite(version.total_tax_cents ?? NaN)
    ? (version.total_tax_cents ?? 0)
    : null;

  const roundedTtcFallback = saleTotalCents + (taxStored ?? 0);
  const roundedTtcCents = Number.isFinite(version.total_ttc_cents ?? NaN)
    ? (version.total_ttc_cents ?? roundedTtcFallback)
    : roundedTtcFallback;

  const adjustedTaxCents = roundedTtcCents - saleTotalCents;
  const taxCents = taxStored ?? Math.max(adjustedTaxCents, 0);

  const ttcCents = saleTotalCents + taxCents;
  const roundingAdjustmentCents = roundedTtcCents - ttcCents;

  return {
    costSubtotalCents,
    saleSubtotalCents,
    discountCents,
    saleTotalCents,
    taxCents,
    ttcCents,
    roundedTtcCents,
    roundingAdjustmentCents,
    adjustedTaxCents,
  };
}
