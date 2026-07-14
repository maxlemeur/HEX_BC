import { bankersRound, computeTaxCents } from "@/lib/money";
import {
  getMarginTiers,
  resolveMarginMultiplier,
  type MarginTier,
} from "@/lib/estimates/margin-tiers";

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
  h_mo_majoration?: number | null;
  k_mo: number | null;
  h_mo_atelier?: number | null;
  k_mo_atelier?: number | null;
  labor_role_atelier_id?: string | null;
  h_mo_chantier?: number | null;
  k_mo_chantier?: number | null;
  labor_role_chantier_id?: string | null;
  labor_role_atelier_hourly_rate_cents?: number | null;
  labor_role_chantier_hourly_rate_cents?: number | null;
  pu_ht_cents: number | null;
  labor_role_hourly_rate_cents?: number | null;
};

export type ComputeEstimateLineValuesOptions = {
  marginMultiplier: number;
  taxRateBp: number;
  isLaborSplitEnabled?: boolean;
  laborRateAtelierCents?: number | null;
  laborRateChantierCents?: number | null;
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
  saleSubtotalBeforeCoefficientCents: number;
  saleSubtotalCents: number;
  discountCents: number;
  appliedMarginMultiplier: number;
  globalCoefficient: number;
  discountMode: DiscountMode;
  discountStepTotals: DiscountStepTotal[];
  saleTotalCents: number;
  taxCents: number;
  ttcCents: number;
  roundedTtcCents: number;
  roundingAdjustmentCents: number;
  adjustedTaxCents: number;
};

export type RoundingMode = "none" | "nearest" | "up" | "down";
export type MarginMode = "fixed" | "tiered";
export type DiscountMode = "simple" | "cascade";
export type DiscountStepTotal = {
  stepNumber: number;
  stepBp: number | null;
  subtotalBeforeCents: number;
  discountCents: number;
  subtotalAfterCents: number;
  cumulativeDiscountCents: number;
};
export type CascadeDiscountComputation = {
  discountCents: number;
  subtotalAfterDiscountCents: number;
  steps: DiscountStepTotal[];
};
export const UNASSIGNED_SUPPLY_TYPE_KEY = "__unassigned__";

/* ---------- helpers ---------- */

function toSafeNumber(value: number | null | undefined, fallback: number) {
  return Number.isFinite(value ?? NaN) ? (value ?? fallback) : fallback;
}

function clampNonNegative(value: number) {
  return value < 0 ? 0 : value;
}

function clampMarginMultiplier(value: number | null | undefined): number {
  return Math.min(Math.max(toSafeNumber(value, 1), 0), MAX_MARGIN_MULTIPLIER);
}

function clampGlobalCoefficient(value: number | null | undefined): number {
  return Math.max(toSafeNumber(value, 1), 0);
}

function normalizeDiscountStepsBp(
  steps: Array<number | null | undefined> | null | undefined
): number[] {
  if (!Array.isArray(steps)) return [];
  return steps.map((step) => {
    const safeStep = bankersRound(toSafeNumber(step, 0));
    return Math.min(Math.max(safeStep, 0), 10000);
  });
}

function hasLaborSplitPayload(
  item: Pick<
    EstimateLineLike,
    | "h_mo_atelier"
    | "k_mo_atelier"
    | "labor_role_atelier_id"
    | "h_mo_chantier"
    | "k_mo_chantier"
    | "labor_role_chantier_id"
  >
) {
  return (
    (item.h_mo_atelier !== null && item.h_mo_atelier !== undefined) ||
    (item.labor_role_atelier_id !== null &&
      item.labor_role_atelier_id !== undefined) ||
    (item.h_mo_chantier !== null && item.h_mo_chantier !== undefined) ||
    (item.labor_role_chantier_id !== null &&
      item.labor_role_chantier_id !== undefined) ||
    ((item.k_mo_atelier ?? 1) !== 1) ||
    ((item.k_mo_chantier ?? 1) !== 1)
  );
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
    isLaborSplitEnabled,
    laborRateAtelierCents,
    laborRateChantierCents,
  }: ComputeEstimateLineValuesOptions
): EstimateLineValues {
  const quantity = Math.max(toSafeNumber(item.quantity, 0), 0);
  const unitPrice = Math.max(toSafeNumber(item.unit_price_ht_cents, 0), 0);
  const kFo = Math.max(toSafeNumber(item.k_fo, 1), 0);
  const hMoMajoration = Math.max(toSafeNumber(item.h_mo_majoration, 1), 0);
  const hourlyRateLegacy = Math.max(
    toSafeNumber(item.labor_role_hourly_rate_cents ?? 0, 0),
    0
  );
  const hourlyRateAtelier = Math.max(
    toSafeNumber(
      laborRateAtelierCents ?? item.labor_role_atelier_hourly_rate_cents,
      0
    ),
    0
  );
  const hourlyRateChantier = Math.max(
    toSafeNumber(
      laborRateChantierCents ?? item.labor_role_chantier_hourly_rate_cents,
      0
    ),
    0
  );
  const hMo = Math.max(toSafeNumber(item.h_mo, 0), 0);
  const kMo = Math.max(toSafeNumber(item.k_mo, 1), 0);
  const hMoAtelier = Math.max(toSafeNumber(item.h_mo_atelier, 0), 0);
  const kMoAtelier = Math.max(toSafeNumber(item.k_mo_atelier, 1), 0);
  const hMoChantier = Math.max(toSafeNumber(item.h_mo_chantier, 0), 0);
  const kMoChantier = Math.max(toSafeNumber(item.k_mo_chantier, 1), 0);
  const hasSplitPayload = hasLaborSplitPayload(item);
  const shouldUseLaborSplit = isLaborSplitEnabled ?? hasSplitPayload;
  const moCostCents = shouldUseLaborSplit
    ? hMoMajoration *
      (hMoAtelier * hourlyRateAtelier * kMoAtelier +
        hMoChantier * hourlyRateChantier * kMoChantier)
    : hMoMajoration * hMo * hourlyRateLegacy * kMo;
  // A6: cap margin to prevent integer overflow
  const safeMargin = clampMarginMultiplier(marginMultiplier);
  const safeTaxRate = Math.max(toSafeNumber(taxRateBp, 0), 0);

  // A1: single round after summation (was rounding FO and MO independently)
  const costLineCents = clampNonNegative(
    capCents(Math.round(quantity * unitPrice * kFo + moCostCents))
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

export function computeCascadeDiscountCents(
  baseSubtotalCents: number,
  discountStepsBp: Array<number | null | undefined> | null | undefined
): CascadeDiscountComputation {
  const safeBaseSubtotal = clampNonNegative(
    capCents(bankersRound(toSafeNumber(baseSubtotalCents, 0)))
  );
  const normalizedSteps = normalizeDiscountStepsBp(discountStepsBp);

  if (safeBaseSubtotal <= 0 || normalizedSteps.length === 0) {
    return {
      discountCents: 0,
      subtotalAfterDiscountCents: safeBaseSubtotal,
      steps: [],
    };
  }

  let runningSubtotalCents = safeBaseSubtotal;
  let cumulativeDiscountCents = 0;
  const steps: DiscountStepTotal[] = normalizedSteps.map((stepBp, index) => {
    const subtotalBeforeCents = runningSubtotalCents;
    const computedDiscount = bankersRound((subtotalBeforeCents * stepBp) / 10000);
    const discountCents = Math.min(
      Math.max(computedDiscount, 0),
      subtotalBeforeCents
    );
    const subtotalAfterCents = subtotalBeforeCents - discountCents;
    cumulativeDiscountCents += discountCents;
    runningSubtotalCents = subtotalAfterCents;

    return {
      stepNumber: index + 1,
      stepBp,
      subtotalBeforeCents,
      discountCents,
      subtotalAfterCents,
      cumulativeDiscountCents,
    };
  });

  return {
    discountCents: cumulativeDiscountCents,
    subtotalAfterDiscountCents: runningSubtotalCents,
    steps,
  };
}

/* ---------- totals computation ---------- */

export function computeEstimateTotals({
  lineItems,
  marginMultiplier,
  marginMode,
  marginTiers,
  discountCents,
  discountMode,
  discount_mode,
  discountStepsBp,
  discount_steps,
  globalCoefficient,
  global_coefficient,
  taxRateBp,
  roundingMode,
  roundingStepCents,
}: {
  lineItems: EstimateLineLike[];
  marginMultiplier: number;
  marginMode?: MarginMode;
  marginTiers?: MarginTier[];
  discountCents: number;
  discountMode?: DiscountMode;
  discount_mode?: DiscountMode;
  discountStepsBp?: Array<number | null | undefined> | null;
  discount_steps?: Array<number | null | undefined> | null;
  globalCoefficient?: number | null;
  global_coefficient?: number | null;
  taxRateBp: number;
  roundingMode: RoundingMode;
  roundingStepCents: number;
}): EstimateTotals {
  // A6: cap margin
  const safeMargin = clampMarginMultiplier(marginMultiplier);
  const safeMarginMode: MarginMode = marginMode === "tiered" ? "tiered" : "fixed";
  const safeMarginTiers = marginTiers ?? getMarginTiers();
  const safeDiscountMode: DiscountMode =
    (discountMode ?? discount_mode) === "cascade" ? "cascade" : "simple";
  const safeDiscountStepsBp = normalizeDiscountStepsBp(
    discountStepsBp ?? discount_steps
  );
  const safeGlobalCoefficient = clampGlobalCoefficient(
    globalCoefficient ?? global_coefficient
  );
  const safeTaxRate = Math.max(toSafeNumber(taxRateBp, 0), 0);

  // EST-028 pass 1: compute raw costs to resolve the applicable margin tier.
  const firstPassTotals = lineItems.reduce(
    (acc, item) => {
      const line = computeEstimateLineValues(item, {
        marginMultiplier: 1,
        taxRateBp: 0,
      });
      acc.costSubtotalCents += line.costLineCents;
      return acc;
    },
    { costSubtotalCents: 0 }
  );

  const appliedMarginMultiplier =
    safeMarginMode === "tiered"
      ? clampMarginMultiplier(
          resolveMarginMultiplier(firstPassTotals.costSubtotalCents, safeMarginTiers)
        )
      : safeMargin;

  // EST-028 pass 2 + A5: compute sale/tax with selected margin and sum per-line taxes.
  const secondPassTotals = lineItems.reduce(
    (acc, item) => {
      const line = computeEstimateLineValues(item, {
        marginMultiplier: appliedMarginMultiplier,
        taxRateBp: safeTaxRate,
      });
      acc.saleSubtotalBeforeCoefficientCents += line.saleLineCents;
      acc.lineTaxTotalCents += line.taxLineCents;
      return acc;
    },
    {
      saleSubtotalBeforeCoefficientCents: 0,
      lineTaxTotalCents: 0,
    }
  );
  const saleSubtotalCents = clampNonNegative(
    capCents(
      bankersRound(
        secondPassTotals.saleSubtotalBeforeCoefficientCents * safeGlobalCoefficient
      )
    )
  );

  let safeDiscount = 0;
  let discountStepTotals: DiscountStepTotal[] = [];

  if (safeDiscountMode === "cascade") {
    const cascadeDiscount = computeCascadeDiscountCents(
      saleSubtotalCents,
      safeDiscountStepsBp
    );
    safeDiscount = cascadeDiscount.discountCents;
    discountStepTotals = cascadeDiscount.steps;
  } else if (safeDiscountStepsBp.length > 0) {
    const simpleDiscount = computeCascadeDiscountCents(
      saleSubtotalCents,
      [safeDiscountStepsBp[0]]
    );
    safeDiscount = simpleDiscount.discountCents;
    discountStepTotals = simpleDiscount.steps;
  } else {
    safeDiscount = Math.min(
      Math.max(toSafeNumber(discountCents, 0), 0),
      saleSubtotalCents
    );
    if (safeDiscount > 0) {
      const subtotalAfterCents = saleSubtotalCents - safeDiscount;
      discountStepTotals = [
        {
          stepNumber: 1,
          stepBp: null,
          subtotalBeforeCents: saleSubtotalCents,
          discountCents: safeDiscount,
          subtotalAfterCents,
          cumulativeDiscountCents: safeDiscount,
        },
      ];
    }
  }

  const saleTotalCents = Math.max(saleSubtotalCents - safeDiscount, 0);
  const taxBeforeDiscountCents =
    safeGlobalCoefficient === 1
      ? secondPassTotals.lineTaxTotalCents
      : computeTaxCents(saleSubtotalCents, safeTaxRate);
  // A5: tax = sum of per-line taxes minus tax on the discount amount
  const discountTaxCents = computeTaxCents(safeDiscount, safeTaxRate);
  const taxCents = Math.max(taxBeforeDiscountCents - discountTaxCents, 0);
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
    costSubtotalCents: firstPassTotals.costSubtotalCents,
    saleSubtotalBeforeCoefficientCents:
      secondPassTotals.saleSubtotalBeforeCoefficientCents,
    saleSubtotalCents,
    discountCents: safeDiscount,
    appliedMarginMultiplier,
    globalCoefficient: safeGlobalCoefficient,
    discountMode: safeDiscountMode,
    discountStepTotals,
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
  labor_role_atelier_id?: string | null;
  labor_role_chantier_id?: string | null;
  category_id: string | null;
  supply_type_id?: string | null;
  line_total_ht_cents: number | null;
  line_tax_cents: number | null;
  line_total_ttc_cents: number | null;
};

export type EstimateVersionForCalc = {
  margin_multiplier: number;
  margin_mode?: MarginMode;
  tax_rate_bp: number;
  discount_bp: number;
  discount_mode?: DiscountMode;
  discount_steps?: Array<number | null> | null;
  global_coefficient?: number | null;
  status?: string;
  total_ht_cents?: number | null;
  total_tax_cents?: number | null;
  total_ttc_cents?: number | null;
};

export type SectionTotals = {
  foTotalCents: number;
  moTotalCents: number;
  moAtelierTotalCents: number;
  moChantierTotalCents: number;
  totalHtCents: number;
  totalTtcCents: number;
  supplyTypeFoTotalsCents?: Record<string, number>;
};

export type ComputeSectionTotalsInput = {
  items: EstimateItemRecord[];
  sectionId: string;
  marginMultiplier: number;
  taxRateBp: number;
  discountCents: number;
  laborRateById: Map<string, number>;
  isLaborSplitEnabled?: boolean;
  laborRateAtelierById?: Map<string, number>;
  laborRateChantierById?: Map<string, number>;
};

export type ComputeAllSectionTotalsInput = {
  items: EstimateItemRecord[];
  marginMultiplier: number;
  taxRateBp: number;
  discountCents: number;
  laborRateById: Map<string, number>;
  isLaborSplitEnabled?: boolean;
  laborRateAtelierById?: Map<string, number>;
  laborRateChantierById?: Map<string, number>;
  sectionIds?: Iterable<string>;
};

type SectionLineSplit = {
  foSaleLineCents: number;
  moSaleLineCents: number;
  moAtelierSaleLineCents: number;
  moChantierSaleLineCents: number;
  saleLineCents: number;
  taxLineCents: number;
};

type SectionSubtotalAccumulator = {
  foSaleSubtotalCents: number;
  moSaleSubtotalCents: number;
  moAtelierSaleSubtotalCents: number;
  moChantierSaleSubtotalCents: number;
  htSubtotalCents: number;
  taxSubtotalCents: number;
  foSaleSubtotalBySupplyType: Map<string, number>;
};

const ZERO_SECTION_TOTALS: SectionTotals = {
  foTotalCents: 0,
  moTotalCents: 0,
  moAtelierTotalCents: 0,
  moChantierTotalCents: 0,
  totalHtCents: 0,
  totalTtcCents: 0,
  supplyTypeFoTotalsCents: {},
};

function createSectionSubtotalAccumulator(): SectionSubtotalAccumulator {
  return {
    foSaleSubtotalCents: 0,
    moSaleSubtotalCents: 0,
    moAtelierSaleSubtotalCents: 0,
    moChantierSaleSubtotalCents: 0,
    htSubtotalCents: 0,
    taxSubtotalCents: 0,
    foSaleSubtotalBySupplyType: new Map<string, number>(),
  };
}

function mergeSectionSubtotalAccumulators(
  target: SectionSubtotalAccumulator,
  source: SectionSubtotalAccumulator
) {
  target.foSaleSubtotalCents += source.foSaleSubtotalCents;
  target.moSaleSubtotalCents += source.moSaleSubtotalCents;
  target.moAtelierSaleSubtotalCents += source.moAtelierSaleSubtotalCents;
  target.moChantierSaleSubtotalCents += source.moChantierSaleSubtotalCents;
  target.htSubtotalCents += source.htSubtotalCents;
  target.taxSubtotalCents += source.taxSubtotalCents;

  source.foSaleSubtotalBySupplyType.forEach((value, key) => {
    target.foSaleSubtotalBySupplyType.set(
      key,
      (target.foSaleSubtotalBySupplyType.get(key) ?? 0) + value
    );
  });
}

function convertSectionSubtotalToTotals(input: {
  subtotal: SectionSubtotalAccumulator;
  estimateSaleSubtotalCents: number;
  safeDiscount: number;
  safeTaxRate: number;
}): SectionTotals {
  const sectionBeforeDiscount = input.subtotal;
  if (sectionBeforeDiscount.htSubtotalCents <= 0) {
    return { ...ZERO_SECTION_TOTALS, supplyTypeFoTotalsCents: {} };
  }

  const sectionDiscountCents =
    input.safeDiscount > 0 && input.estimateSaleSubtotalCents > 0
      ? Math.min(
          sectionBeforeDiscount.htSubtotalCents,
          Math.round(
            (input.safeDiscount * sectionBeforeDiscount.htSubtotalCents) /
              input.estimateSaleSubtotalCents
          )
        )
      : 0;

  const totalHtCents = Math.max(
    sectionBeforeDiscount.htSubtotalCents - sectionDiscountCents,
    0
  );

  const foDiscountCents =
    sectionDiscountCents > 0 && sectionBeforeDiscount.htSubtotalCents > 0
      ? Math.min(
          sectionBeforeDiscount.foSaleSubtotalCents,
          Math.round(
            (sectionDiscountCents * sectionBeforeDiscount.foSaleSubtotalCents) /
              sectionBeforeDiscount.htSubtotalCents
          )
        )
      : 0;

  const foTotalCents = Math.min(
    Math.max(sectionBeforeDiscount.foSaleSubtotalCents - foDiscountCents, 0),
    totalHtCents
  );
  const moTotalCents = totalHtCents - foTotalCents;
  const moDiscountCents = Math.max(sectionDiscountCents - foDiscountCents, 0);
  const moAtelierDiscountCents =
    moDiscountCents > 0 && sectionBeforeDiscount.moSaleSubtotalCents > 0
      ? Math.min(
          sectionBeforeDiscount.moAtelierSaleSubtotalCents,
          Math.round(
            (moDiscountCents * sectionBeforeDiscount.moAtelierSaleSubtotalCents) /
              sectionBeforeDiscount.moSaleSubtotalCents
          )
        )
      : 0;

  const moAtelierTotalCents = Math.min(
    Math.max(
      sectionBeforeDiscount.moAtelierSaleSubtotalCents - moAtelierDiscountCents,
      0
    ),
    moTotalCents
  );
  const moChantierTotalCents = moTotalCents - moAtelierTotalCents;
  const discountTaxCents = computeTaxCents(sectionDiscountCents, input.safeTaxRate);
  const taxAfterDiscountCents = Math.max(
    sectionBeforeDiscount.taxSubtotalCents - discountTaxCents,
    0
  );
  const totalTtcCents = totalHtCents + taxAfterDiscountCents;

  const supplyTypeFoTotalsCents: Record<string, number> = {};
  const groupedEntries = Array.from(
    sectionBeforeDiscount.foSaleSubtotalBySupplyType.entries()
  );

  if (groupedEntries.length > 0 && sectionBeforeDiscount.foSaleSubtotalCents > 0) {
    let allocatedDiscount = 0;
    let allocatedTotals = 0;

    groupedEntries.forEach(([key, subtotal], index) => {
      const isLast = index === groupedEntries.length - 1;
      const discountShare = isLast
        ? Math.max(foDiscountCents - allocatedDiscount, 0)
        : Math.min(
            subtotal,
            Math.round(
              (foDiscountCents * subtotal) / sectionBeforeDiscount.foSaleSubtotalCents
            )
          );
      allocatedDiscount += discountShare;

      const netTotal = isLast
        ? Math.max(foTotalCents - allocatedTotals, 0)
        : Math.max(subtotal - discountShare, 0);
      allocatedTotals += netTotal;
      supplyTypeFoTotalsCents[key] = netTotal;
    });
  }

  return {
    foTotalCents,
    moTotalCents,
    moAtelierTotalCents,
    moChantierTotalCents,
    totalHtCents,
    totalTtcCents,
    supplyTypeFoTotalsCents,
  };
}

function computeSectionLineSplit(
  item: EstimateItemRecord,
  {
    marginMultiplier,
    taxRateBp,
    laborRateById,
    isLaborSplitEnabled,
    laborRateAtelierById,
    laborRateChantierById,
  }: {
    marginMultiplier: number;
    taxRateBp: number;
    laborRateById: Map<string, number>;
    isLaborSplitEnabled: boolean;
    laborRateAtelierById: Map<string, number>;
    laborRateChantierById: Map<string, number>;
  }
): SectionLineSplit {
  const quantity = Math.max(toSafeNumber(item.quantity, 0), 0);
  const unitPrice = Math.max(toSafeNumber(item.unit_price_ht_cents, 0), 0);
  const kFo = Math.max(toSafeNumber(item.k_fo, 1), 0);
  const hMoMajoration = Math.max(toSafeNumber(item.h_mo_majoration, 1), 0);
  const hMo = Math.max(toSafeNumber(item.h_mo, 0), 0);
  const kMo = Math.max(toSafeNumber(item.k_mo, 1), 0);
  const legacyHourlyRate = item.labor_role_id
    ? Math.max(toSafeNumber(laborRateById.get(item.labor_role_id), 0), 0)
    : 0;
  const atelierHourlyRate = item.labor_role_atelier_id
    ? Math.max(
        toSafeNumber(
          laborRateAtelierById.get(item.labor_role_atelier_id) ??
            laborRateById.get(item.labor_role_atelier_id),
          0
        ),
        0
      )
    : 0;
  const chantierHourlyRate = item.labor_role_chantier_id
    ? Math.max(
        toSafeNumber(
          laborRateChantierById.get(item.labor_role_chantier_id) ??
            laborRateById.get(item.labor_role_chantier_id),
          0
        ),
        0
      )
    : 0;
  const hMoAtelier = Math.max(toSafeNumber(item.h_mo_atelier, 0), 0);
  const kMoAtelier = Math.max(toSafeNumber(item.k_mo_atelier, 1), 0);
  const hMoChantier = Math.max(toSafeNumber(item.h_mo_chantier, 0), 0);
  const kMoChantier = Math.max(toSafeNumber(item.k_mo_chantier, 1), 0);
  const shouldUseLaborSplit = isLaborSplitEnabled && hasLaborSplitPayload(item);

  const foCostRaw = quantity * unitPrice * kFo;
  const moAtelierCostRaw = shouldUseLaborSplit
    ? hMoMajoration * hMoAtelier * atelierHourlyRate * kMoAtelier
    : 0;
  const moChantierCostRaw = shouldUseLaborSplit
    ? hMoMajoration * hMoChantier * chantierHourlyRate * kMoChantier
    : hMoMajoration * hMo * legacyHourlyRate * kMo;
  const moCostRaw = moAtelierCostRaw + moChantierCostRaw;
  const costRawTotal = foCostRaw + moCostRaw;

  const lineValues = computeEstimateLineValues(
    {
      ...item,
      labor_role_hourly_rate_cents: legacyHourlyRate,
    },
    {
      marginMultiplier,
      taxRateBp,
      isLaborSplitEnabled: shouldUseLaborSplit,
      laborRateAtelierCents: atelierHourlyRate,
      laborRateChantierCents: chantierHourlyRate,
    }
  );

  if (costRawTotal <= 0 || lineValues.saleLineCents <= 0) {
    return {
      foSaleLineCents: 0,
      moSaleLineCents: lineValues.saleLineCents,
      moAtelierSaleLineCents: 0,
      moChantierSaleLineCents: lineValues.saleLineCents,
      saleLineCents: lineValues.saleLineCents,
      taxLineCents: lineValues.taxLineCents,
    };
  }

  // Keep the MO component independent from FO inputs. Any cent-level rounding
  // residual from the canonical line total is assigned to FO, never to MO.
  const moSaleLineCents = Math.min(
    Math.max(bankersRound(moCostRaw * marginMultiplier), 0),
    lineValues.saleLineCents
  );
  const foSaleLineCents = lineValues.saleLineCents - moSaleLineCents;
  const moAtelierSaleLineCents = Math.min(
    Math.max(bankersRound(moAtelierCostRaw * marginMultiplier), 0),
    moSaleLineCents
  );
  const moChantierSaleLineCents = moSaleLineCents - moAtelierSaleLineCents;

  return {
    foSaleLineCents,
    moSaleLineCents,
    moAtelierSaleLineCents,
    moChantierSaleLineCents,
    saleLineCents: lineValues.saleLineCents,
    taxLineCents: lineValues.taxLineCents,
  };
}

/**
 * Compute the HT/TTC subtotal of a section and all of its descendants.
 * Applies global discount proportionally to the section subtotal.
 */
export function computeSectionTotals({
  items,
  sectionId,
  marginMultiplier,
  taxRateBp,
  discountCents,
  laborRateById,
  isLaborSplitEnabled = false,
  laborRateAtelierById = laborRateById,
  laborRateChantierById = laborRateById,
}: ComputeSectionTotalsInput): SectionTotals {
  const totalsBySectionId = computeAllSectionTotals({
    items,
    marginMultiplier,
    taxRateBp,
    discountCents,
    laborRateById,
    isLaborSplitEnabled,
    laborRateAtelierById,
    laborRateChantierById,
    sectionIds: [sectionId],
  });

  return totalsBySectionId.get(sectionId) ?? {
    ...ZERO_SECTION_TOTALS,
    supplyTypeFoTotalsCents: {},
  };
}

/**
 * Compute HT/TTC totals for multiple sections in a single pass.
 * This is optimized for editor rendering paths where many section totals are needed.
 */
export function computeAllSectionTotals({
  items,
  marginMultiplier,
  taxRateBp,
  discountCents,
  laborRateById,
  isLaborSplitEnabled = false,
  laborRateAtelierById = laborRateById,
  laborRateChantierById = laborRateById,
  sectionIds,
}: ComputeAllSectionTotalsInput): Map<string, SectionTotals> {
  const result = new Map<string, SectionTotals>();
  if (items.length === 0) {
    return result;
  }

  const sectionIdFilter = sectionIds ? new Set(sectionIds) : null;
  const sectionSet = new Set<string>();
  const sectionIdsInSource: string[] = [];
  const childrenByParent = new Map<string, EstimateItemRecord[]>();
  const allLines: EstimateItemRecord[] = [];

  items.forEach((item) => {
    if (item.item_type === "section") {
      sectionSet.add(item.id);
      sectionIdsInSource.push(item.id);
    } else if (item.item_type === "line") {
      allLines.push(item);
    }

    if (!item.parent_id) return;
    const siblings = childrenByParent.get(item.parent_id) ?? [];
    siblings.push(item);
    childrenByParent.set(item.parent_id, siblings);
  });

  if (sectionSet.size === 0) {
    return result;
  }

  const safeMargin = clampMarginMultiplier(marginMultiplier);
  const safeTaxRate = Math.max(toSafeNumber(taxRateBp, 0), 0);
  const safeDiscount = Math.max(toSafeNumber(discountCents, 0), 0);

  const lineSplitById = new Map<string, SectionLineSplit>();
  const estimateSaleSubtotalCents = allLines.reduce((sum, item) => {
    const split = computeSectionLineSplit(item, {
      marginMultiplier: safeMargin,
      taxRateBp: safeTaxRate,
      laborRateById,
      isLaborSplitEnabled,
      laborRateAtelierById,
      laborRateChantierById,
    });
    lineSplitById.set(item.id, split);
    return sum + split.saleLineCents;
  }, 0);

  const sectionTotalsBeforeDiscountById = new Map<
    string,
    SectionSubtotalAccumulator
  >();
  const rootSectionIds = sectionIdsInSource.filter((id) => {
    const section = items.find((item) => item.id === id);
    if (!section || section.item_type !== "section") return false;
    if (!section.parent_id) return true;
    return !sectionSet.has(section.parent_id);
  });

  const visited = new Set<string>();
  const traversalRoots = [...rootSectionIds];
  sectionIdsInSource.forEach((sectionId) => {
    if (!visited.has(sectionId)) {
      traversalRoots.push(sectionId);
    }
  });

  traversalRoots.forEach((rootSectionId) => {
    if (visited.has(rootSectionId)) return;

    const stack: Array<{ sectionId: string; visitedChildren: boolean }> = [
      { sectionId: rootSectionId, visitedChildren: false },
    ];

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;

      if (!current.visitedChildren) {
        if (visited.has(current.sectionId)) continue;
        stack.push({
          sectionId: current.sectionId,
          visitedChildren: true,
        });
        const children = childrenByParent.get(current.sectionId) ?? [];
        for (let index = children.length - 1; index >= 0; index -= 1) {
          const child = children[index];
          if (child.item_type === "section") {
            stack.push({
              sectionId: child.id,
              visitedChildren: false,
            });
          }
        }
        continue;
      }

      const subtotal = createSectionSubtotalAccumulator();
      const children = childrenByParent.get(current.sectionId) ?? [];

      children.forEach((child) => {
        if (child.item_type === "line") {
          const split = lineSplitById.get(child.id);
          if (!split) return;

          subtotal.foSaleSubtotalCents += split.foSaleLineCents;
          subtotal.moSaleSubtotalCents += split.moSaleLineCents;
          subtotal.moAtelierSaleSubtotalCents += split.moAtelierSaleLineCents;
          subtotal.moChantierSaleSubtotalCents += split.moChantierSaleLineCents;
          subtotal.htSubtotalCents += split.saleLineCents;
          subtotal.taxSubtotalCents += split.taxLineCents;

          if (split.foSaleLineCents > 0) {
            const key = child.supply_type_id ?? UNASSIGNED_SUPPLY_TYPE_KEY;
            subtotal.foSaleSubtotalBySupplyType.set(
              key,
              (subtotal.foSaleSubtotalBySupplyType.get(key) ?? 0) +
                split.foSaleLineCents
            );
          }
          return;
        }

        const childTotalsBeforeDiscount =
          sectionTotalsBeforeDiscountById.get(child.id);
        if (!childTotalsBeforeDiscount) return;
        mergeSectionSubtotalAccumulators(subtotal, childTotalsBeforeDiscount);
      });

      sectionTotalsBeforeDiscountById.set(current.sectionId, subtotal);
      visited.add(current.sectionId);
    }
  });

  sectionIdsInSource.forEach((sectionId) => {
    if (sectionIdFilter && !sectionIdFilter.has(sectionId)) {
      return;
    }

    const subtotal =
      sectionTotalsBeforeDiscountById.get(sectionId) ??
      createSectionSubtotalAccumulator();
    result.set(
      sectionId,
      convertSectionSubtotalToTotals({
        subtotal,
        estimateSaleSubtotalCents,
        safeDiscount,
        safeTaxRate,
      })
    );
  });

  if (sectionIdFilter) {
    sectionIdFilter.forEach((sectionId) => {
      if (!result.has(sectionId)) {
        result.set(sectionId, {
          ...ZERO_SECTION_TOTALS,
          supplyTypeFoTotalsCents: {},
        });
      }
    });
  }

  return result;
}

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

  const saleSubtotalAfterCoefficientCents = clampNonNegative(
    capCents(
      bankersRound(
        saleSubtotal * clampGlobalCoefficient(version.global_coefficient)
      )
    )
  );
  const safeMode: DiscountMode =
    version.discount_mode === "cascade" ? "cascade" : "simple";
  const safeSteps = normalizeDiscountStepsBp(version.discount_steps);

  if (safeMode === "cascade") {
    return computeCascadeDiscountCents(
      saleSubtotalAfterCoefficientCents,
      safeSteps
    ).discountCents;
  }
  if (safeSteps.length > 0) {
    return computeCascadeDiscountCents(saleSubtotalAfterCoefficientCents, [
      safeSteps[0],
    ]).discountCents;
  }
  return Math.round(
    (saleSubtotalAfterCoefficientCents * version.discount_bp) / 10000
  );
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

  if (!saleSubtotal) return 0;
  const saleSubtotalAfterCoefficientCents = clampNonNegative(
    capCents(
      bankersRound(
        saleSubtotal * clampGlobalCoefficient(version.global_coefficient)
      )
    )
  );
  const safeMode: DiscountMode =
    version.discount_mode === "cascade" ? "cascade" : "simple";
  const safeSteps = normalizeDiscountStepsBp(version.discount_steps);

  if (safeMode === "cascade") {
    return computeCascadeDiscountCents(
      saleSubtotalAfterCoefficientCents,
      safeSteps
    ).discountCents;
  }
  if (safeSteps.length > 0) {
    return computeCascadeDiscountCents(saleSubtotalAfterCoefficientCents, [
      safeSteps[0],
    ]).discountCents;
  }

  if (Number.isFinite(version.total_ht_cents ?? NaN)) {
    return Math.max(
      saleSubtotalAfterCoefficientCents - (version.total_ht_cents ?? 0),
      0
    );
  }

  return Math.round(
    (saleSubtotalAfterCoefficientCents * version.discount_bp) / 10000
  );
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
    const hMoMajoration = item.h_mo_majoration ?? 1;
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
        h_mo_majoration: hMoMajoration,
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
      h_mo_majoration: hMoMajoration,
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

  const safeGlobalCoefficient = clampGlobalCoefficient(version.global_coefficient);
  const saleSubtotalAfterCoefficientCents = clampNonNegative(
    capCents(bankersRound(saleSubtotalCents * safeGlobalCoefficient))
  );
  const safeDiscountMode: DiscountMode =
    version.discount_mode === "cascade" ? "cascade" : "simple";
  const safeDiscountSteps = normalizeDiscountStepsBp(version.discount_steps);
  let discountStepTotals: DiscountStepTotal[] = [];

  if (safeDiscountMode === "cascade") {
    discountStepTotals = computeCascadeDiscountCents(
      saleSubtotalAfterCoefficientCents,
      safeDiscountSteps
    ).steps;
  } else if (safeDiscountSteps.length > 0) {
    discountStepTotals = computeCascadeDiscountCents(
      saleSubtotalAfterCoefficientCents,
      [safeDiscountSteps[0]]
    ).steps;
  } else if (discountCents > 0) {
    const safeDiscount = Math.min(discountCents, saleSubtotalAfterCoefficientCents);
    discountStepTotals = [
      {
        stepNumber: 1,
        stepBp: null,
        subtotalBeforeCents: saleSubtotalAfterCoefficientCents,
        discountCents: safeDiscount,
        subtotalAfterCents: Math.max(
          saleSubtotalAfterCoefficientCents - safeDiscount,
          0
        ),
        cumulativeDiscountCents: safeDiscount,
      },
    ];
  }

  const saleTotalFallback = Math.max(
    saleSubtotalAfterCoefficientCents - discountCents,
    0
  );
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
    saleSubtotalBeforeCoefficientCents: saleSubtotalCents,
    saleSubtotalCents: saleSubtotalAfterCoefficientCents,
    discountCents,
    appliedMarginMultiplier: clampMarginMultiplier(version.margin_multiplier),
    globalCoefficient: safeGlobalCoefficient,
    discountMode: safeDiscountMode,
    discountStepTotals,
    saleTotalCents,
    taxCents,
    ttcCents,
    roundedTtcCents,
    roundingAdjustmentCents,
    adjustedTaxCents,
  };
}
