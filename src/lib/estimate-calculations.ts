import { bankersRound, computeTaxCents } from "@/lib/money";
import {
  resolveMarginMultiplier,
  type MarginTier,
} from "@/lib/estimates/margin-tiers";
import type { CalcEngineVersion } from "@/lib/estimates/calc-engine-version";

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
  isLaborSplitEnabled: boolean;
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
  /**
   * Vrai quand le total a été écrêté au plafond de stockage (21 474 836,47 €).
   * Le montant annoncé est alors INFÉRIEUR au montant réel : à signaler à
   * l'utilisateur avant tout envoi.
   */
  isCapped?: boolean;
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

export function hasActiveLaborSplitPayload(
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
  const hMoAtelier = Math.max(toSafeNumber(item.h_mo_atelier, 0), 0);
  const hMoChantier = Math.max(toSafeNumber(item.h_mo_chantier, 0), 0);
  return (
    hMoAtelier > 0 ||
    (item.labor_role_atelier_id !== null &&
      item.labor_role_atelier_id !== undefined) ||
    hMoChantier > 0 ||
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

/**
 * Vrai quand un montant dépasse la capacité de stockage (integer PostgreSQL,
 * soit 21 474 836,47 €). capCents l'écrête alors SANS erreur : le total
 * affiché, le PDF et les exports annoncent un montant inférieur au vrai
 * montant. Sur des marchés d'infrastructure ou multi-lots, ce plafond est
 * franchissable — il doit donc être signalé à l'utilisateur, pas subi.
 */
export function exceedsMaxCents(value: number): boolean {
  return Number.isFinite(value) && value > MAX_CENTS;
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
  // EST-E26 (T6, étape 5) : sémantique unique du split main-d'œuvre. Le flag
  // tenant est désormais requis et ne déclenche le split que si la ligne porte
  // un vrai payload atelier/chantier. On supprime l'auto-détection implicite
  // `isLaborSplitEnabled ?? hasSplitPayload`, alignée sur computeEstimateLineSaleSplit.
  const shouldUseLaborSplit =
    isLaborSplitEnabled && hasActiveLaborSplitPayload(item);
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

/* ---------- allocation exacte (EST-E26, T6 phase C, étape 7) ---------- */

/**
 * Répartit `amount` (centimes, >= 0) sur `weights` (>= 0) en garantissant
 * `Σ parts === amount` AU CENTIME (méthode du plus grand reste / Hamilton).
 *
 * - aucune part négative, aucune part > `amount` ;
 * - le reliquat de division va aux plus grands restes fractionnaires ; à égalité,
 *   à l'index le plus petit (déterministe) ;
 * - somme des poids nulle => répartition uniforme ;
 * - garde-fou final : tout écart résiduel (arrondi flottant sur de très gros
 *   montants) est rebasé sur la part de plus gros poids (EST-E26 §2.4).
 *
 * C'est la brique qui rend l'invariant « Σ lignes === Σ sections === pied » vrai
 * au centime (§2.3), là où des `Math.round` indépendants dérivaient.
 */
export function allocateProRata(amount: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];

  const safeAmount = Math.max(Math.round(toSafeNumber(amount, 0)), 0);
  const safeWeights = weights.map((weight) => Math.max(toSafeNumber(weight, 0), 0));
  if (safeAmount === 0) return new Array<number>(n).fill(0);

  const totalWeight = safeWeights.reduce((sum, weight) => sum + weight, 0);
  // `safeAmount * (weight / total)` reste borné par safeAmount : pas de
  // dépassement de MAX_SAFE_INTEGER, contrairement au produit direct
  // `safeAmount * weight` sur de gros devis.
  const exact = safeWeights.map((weight) =>
    totalWeight > 0 ? safeAmount * (weight / totalWeight) : safeAmount / n
  );
  const parts = exact.map((value) => Math.floor(value));

  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((left, right) =>
      right.frac !== left.frac ? right.frac - left.frac : left.index - right.index
    );

  let remainder = safeAmount - parts.reduce((sum, part) => sum + part, 0);
  for (let k = 0; k < order.length && remainder > 0; k += 1) {
    parts[order[k].index] += 1;
    remainder -= 1;
  }

  // Rebase du reliquat éventuel (écart d'arrondi flottant) sur la plus grosse
  // part : garantit Σ parts === safeAmount exactement.
  const leftover = safeAmount - parts.reduce((sum, part) => sum + part, 0);
  if (leftover !== 0) {
    let target = 0;
    for (let index = 1; index < n; index += 1) {
      if (safeWeights[index] > safeWeights[target]) target = index;
    }
    parts[target] = Math.max(parts[target] + leftover, 0);
  }

  return parts;
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
  isLaborSplitEnabled,
}: {
  lineItems: EstimateLineLike[];
  marginMultiplier: number;
  marginMode: MarginMode;
  marginTiers: MarginTier[];
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
  isLaborSplitEnabled: boolean;
}): EstimateTotals {
  // A6: cap margin
  const safeMargin = clampMarginMultiplier(marginMultiplier);
  const safeMarginMode: MarginMode = marginMode === "tiered" ? "tiered" : "fixed";
  // EST-E26 (T6, étape 6) : marginTiers est requis. Plus de repli silencieux
  // sur getMarginTiers() ; un tableau vide reste géré par resolveMarginMultiplier
  // (margin-tiers.ts), seul et unique point de repli sur le barème par défaut.
  const safeMarginTiers = marginTiers;
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
        isLaborSplitEnabled,
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
        isLaborSplitEnabled,
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
  const saleSubtotalBeforeCapCents = bankersRound(
    secondPassTotals.saleSubtotalBeforeCoefficientCents * safeGlobalCoefficient
  );
  // Le plafond int32 écrête silencieusement : on mémorise le dépassement pour
  // pouvoir l'afficher, plutôt que d'annoncer un total minoré sans le dire.
  const isCapped = exceedsMaxCents(saleSubtotalBeforeCapCents);
  const saleSubtotalCents = clampNonNegative(
    capCents(saleSubtotalBeforeCapCents)
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
    isCapped,
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
  // Grandeurs de VERSION (EST-E26 étape 9) : ignorées en calcEngineVersion 1,
  // portées jusqu'au moteur unifié en version 2.
  marginMode: MarginMode;
  marginTiers: MarginTier[];
  globalCoefficient: number;
  discountMode: DiscountMode;
  discountStepsBp: number[];
  calcEngineVersion: CalcEngineVersion;
  laborRateById: Map<string, number>;
  isLaborSplitEnabled: boolean;
  laborRateAtelierById?: Map<string, number>;
  laborRateChantierById?: Map<string, number>;
};

export type ComputeAllSectionTotalsInput = {
  items: EstimateItemRecord[];
  marginMultiplier: number;
  taxRateBp: number;
  discountCents: number;
  // Grandeurs de VERSION (EST-E26 étape 9) : ignorées en calcEngineVersion 1,
  // portées jusqu'au moteur unifié en version 2.
  marginMode: MarginMode;
  marginTiers: MarginTier[];
  globalCoefficient: number;
  discountMode: DiscountMode;
  discountStepsBp: number[];
  calcEngineVersion: CalcEngineVersion;
  laborRateById: Map<string, number>;
  isLaborSplitEnabled: boolean;
  laborRateAtelierById?: Map<string, number>;
  laborRateChantierById?: Map<string, number>;
  sectionIds?: Iterable<string>;
};

export type EstimateLineSaleSplit = {
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

export function computeEstimateLineSaleSplit(
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
): EstimateLineSaleSplit {
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
  const shouldUseLaborSplit =
    isLaborSplitEnabled && hasActiveLaborSplitPayload(item);

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
  marginMode,
  marginTiers,
  globalCoefficient,
  discountMode,
  discountStepsBp,
  calcEngineVersion,
  laborRateById,
  isLaborSplitEnabled,
  laborRateAtelierById = laborRateById,
  laborRateChantierById = laborRateById,
}: ComputeSectionTotalsInput): SectionTotals {
  const totalsBySectionId = computeAllSectionTotals({
    items,
    marginMultiplier,
    taxRateBp,
    discountCents,
    marginMode,
    marginTiers,
    globalCoefficient,
    discountMode,
    discountStepsBp,
    calcEngineVersion,
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
  marginMode,
  marginTiers,
  globalCoefficient,
  discountMode,
  discountStepsBp,
  calcEngineVersion,
  laborRateById,
  isLaborSplitEnabled,
  laborRateAtelierById = laborRateById,
  laborRateChantierById = laborRateById,
  sectionIds,
}: ComputeAllSectionTotalsInput): Map<string, SectionTotals> {
  // EST-E26 (T6, étape 9) : en version 2, les sections DÉRIVENT du moteur unifié
  // (agrégation nette réconciliée, le coefficient global entre enfin dans les
  // sections). En version 1, chemin historique strictement inchangé ci-dessous.
  if (calcEngineVersion === 2) {
    const breakdown = computeEstimateBreakdown({
      items,
      marginMultiplier,
      marginMode,
      marginTiers,
      globalCoefficient,
      discountMode,
      discountCents,
      discountStepsBp,
      taxRateBp,
      roundingMode: "none",
      roundingStepCents: 0,
      isLaborSplitEnabled,
      laborRateById,
      laborRateAtelierById,
      laborRateChantierById,
      calcEngineVersion,
    });
    if (!sectionIds) return breakdown.sectionById;
    const filtered = new Map<string, SectionTotals>();
    for (const sectionId of sectionIds) {
      filtered.set(
        sectionId,
        breakdown.sectionById.get(sectionId) ?? {
          ...ZERO_SECTION_TOTALS,
          supplyTypeFoTotalsCents: {},
        }
      );
    }
    return filtered;
  }

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

  const lineSplitById = new Map<string, EstimateLineSaleSplit>();
  const estimateSaleSubtotalCents = allLines.reduce((sum, item) => {
    const split = computeEstimateLineSaleSplit(item, {
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

/* ---------- moteur unifié (EST-E26, T6 phase C, étape 8) ---------- */

export type EstimateLineBreakdown = {
  costLineCents: number;
  /** Vente ligne brute : avant coefficient global, avant remise. */
  saleGrossCents: number;
  /** Part de la ligne dans le sous-total APRÈS coefficient global. */
  coefficientShareCents: number;
  /** Part de la remise imputée à la ligne. */
  discountShareCents: number;
  /** Vente nette : `coefficientShareCents - discountShareCents`. Σ === pied. */
  saleNetHtCents: number;
  foNetCents: number;
  moNetCents: number;
  moAtelierNetCents: number;
  moChantierNetCents: number;
  puNetHtCents: number;
  taxCents: number;
};

export type EstimateBreakdown = {
  totals: EstimateTotals;
  lineById: Map<string, EstimateLineBreakdown>;
  sectionById: Map<string, SectionTotals>;
  /** Lignes hors de toute section (rattachées à la racine du devis). */
  rootLineIds: string[];
  invariants: { sumAllocatedHtCents: number; matchesFooter: boolean };
};

export type EstimateComputationInput = {
  items: EstimateItemRecord[];
  marginMultiplier: number;
  marginMode: MarginMode;
  marginTiers: MarginTier[];
  globalCoefficient: number;
  discountMode: DiscountMode;
  discountCents: number;
  discountStepsBp: number[];
  taxRateBp: number;
  roundingMode: RoundingMode;
  roundingStepCents: number;
  isLaborSplitEnabled: boolean;
  laborRateById: Map<string, number>;
  laborRateAtelierById: Map<string, number>;
  laborRateChantierById: Map<string, number>;
  calcEngineVersion: CalcEngineVersion;
};

type NetSectionAccumulator = {
  foNetCents: number;
  moNetCents: number;
  moAtelierNetCents: number;
  moChantierNetCents: number;
  htNetCents: number;
  taxCents: number;
  supplyTypeFoNetCents: Map<string, number>;
};

function createNetSectionAccumulator(): NetSectionAccumulator {
  return {
    foNetCents: 0,
    moNetCents: 0,
    moAtelierNetCents: 0,
    moChantierNetCents: 0,
    htNetCents: 0,
    taxCents: 0,
    supplyTypeFoNetCents: new Map<string, number>(),
  };
}

/**
 * Agrège les valeurs NETTES par ligne (déjà réconciliées) en sections
 * récursives, et collecte les lignes racine (hors section). Chaque section porte
 * la somme de ses lignes descendantes : Σ sections racine + Σ lignes racine ===
 * Σ lignes === pied.
 */
function aggregateNetSections(
  items: EstimateItemRecord[],
  lineById: Map<string, EstimateLineBreakdown>
): { sectionById: Map<string, SectionTotals>; rootLineIds: string[] } {
  const sectionSet = new Set<string>();
  const childrenByParent = new Map<string, EstimateItemRecord[]>();
  items.forEach((item) => {
    if (item.item_type === "section") sectionSet.add(item.id);
    if (!item.parent_id) return;
    const siblings = childrenByParent.get(item.parent_id) ?? [];
    siblings.push(item);
    childrenByParent.set(item.parent_id, siblings);
  });

  const rootLineIds = items
    .filter(
      (item) =>
        item.item_type === "line" &&
        (!item.parent_id || !sectionSet.has(item.parent_id))
    )
    .map((item) => item.id);

  const accById = new Map<string, NetSectionAccumulator>();
  const visited = new Set<string>();
  const sectionIds = items
    .filter((item) => item.item_type === "section")
    .map((item) => item.id);

  sectionIds.forEach((rootId) => {
    if (visited.has(rootId)) return;
    const stack: Array<{ id: string; visitedChildren: boolean }> = [
      { id: rootId, visitedChildren: false },
    ];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      if (!current.visitedChildren) {
        if (visited.has(current.id)) continue;
        stack.push({ id: current.id, visitedChildren: true });
        const children = childrenByParent.get(current.id) ?? [];
        for (let index = children.length - 1; index >= 0; index -= 1) {
          if (children[index].item_type === "section") {
            stack.push({ id: children[index].id, visitedChildren: false });
          }
        }
        continue;
      }

      const acc = createNetSectionAccumulator();
      (childrenByParent.get(current.id) ?? []).forEach((child) => {
        if (child.item_type === "line") {
          const line = lineById.get(child.id);
          if (!line) return;
          acc.foNetCents += line.foNetCents;
          acc.moNetCents += line.moNetCents;
          acc.moAtelierNetCents += line.moAtelierNetCents;
          acc.moChantierNetCents += line.moChantierNetCents;
          acc.htNetCents += line.saleNetHtCents;
          acc.taxCents += line.taxCents;
          if (line.foNetCents > 0) {
            const key = child.supply_type_id ?? UNASSIGNED_SUPPLY_TYPE_KEY;
            acc.supplyTypeFoNetCents.set(
              key,
              (acc.supplyTypeFoNetCents.get(key) ?? 0) + line.foNetCents
            );
          }
          return;
        }
        const childAcc = accById.get(child.id);
        if (!childAcc) return;
        acc.foNetCents += childAcc.foNetCents;
        acc.moNetCents += childAcc.moNetCents;
        acc.moAtelierNetCents += childAcc.moAtelierNetCents;
        acc.moChantierNetCents += childAcc.moChantierNetCents;
        acc.htNetCents += childAcc.htNetCents;
        acc.taxCents += childAcc.taxCents;
        childAcc.supplyTypeFoNetCents.forEach((value, key) => {
          acc.supplyTypeFoNetCents.set(
            key,
            (acc.supplyTypeFoNetCents.get(key) ?? 0) + value
          );
        });
      });
      accById.set(current.id, acc);
      visited.add(current.id);
    }
  });

  const sectionById = new Map<string, SectionTotals>();
  sectionIds.forEach((sectionId) => {
    const acc = accById.get(sectionId) ?? createNetSectionAccumulator();
    sectionById.set(sectionId, {
      foTotalCents: acc.foNetCents,
      moTotalCents: acc.moNetCents,
      moAtelierTotalCents: acc.moAtelierNetCents,
      moChantierTotalCents: acc.moChantierNetCents,
      totalHtCents: acc.htNetCents,
      totalTtcCents: acc.htNetCents + acc.taxCents,
      supplyTypeFoTotalsCents: Object.fromEntries(acc.supplyTypeFoNetCents),
    });
  });

  return { sectionById, rootLineIds };
}

/**
 * Fonction d'autorité du moteur de totaux (EST-E26 §2.1). Produit un breakdown
 * complet — pied, par ligne, par section, lignes racine — où l'invariant
 * « Σ lignes === Σ sections === pied » est vrai AU CENTIME en version 2.
 *
 * Garde-fou `calcEngineVersion` : en version 1 (tous les devis existants tant
 * que le rollout n'a pas eu lieu), on DÉLÈGUE au chemin historique
 * (computeEstimateTotals + computeAllSectionTotals), sans allocation
 * descendante, et on marque `invariants.matchesFooter = false` — comportement
 * strictement inchangé. Seule la version 2 (opt-in) applique l'allocation
 * réconciliée et la TVA par ligne sur le net (suppression de la double branche).
 */
export function computeEstimateBreakdown(
  input: EstimateComputationInput
): EstimateBreakdown {
  const {
    items,
    isLaborSplitEnabled,
    laborRateById,
    laborRateAtelierById,
    laborRateChantierById,
    taxRateBp,
    calcEngineVersion,
  } = input;

  const withRates = (item: EstimateItemRecord): EstimateItemRecord => ({
    ...item,
    labor_role_hourly_rate_cents: item.labor_role_id
      ? (laborRateById.get(item.labor_role_id) ?? 0)
      : 0,
    labor_role_atelier_hourly_rate_cents: item.labor_role_atelier_id
      ? (laborRateAtelierById.get(item.labor_role_atelier_id) ??
          laborRateById.get(item.labor_role_atelier_id) ??
          0)
      : 0,
    labor_role_chantier_hourly_rate_cents: item.labor_role_chantier_id
      ? (laborRateChantierById.get(item.labor_role_chantier_id) ??
          laborRateById.get(item.labor_role_chantier_id) ??
          0)
      : 0,
  });

  const lines = items.filter((item) => item.item_type === "line");

  // Le pied ne change pas : on réutilise la logique testée de computeEstimateTotals.
  const footer = computeEstimateTotals({
    lineItems: lines.map(withRates),
    marginMultiplier: input.marginMultiplier,
    marginMode: input.marginMode,
    marginTiers: input.marginTiers,
    discountCents: input.discountCents,
    discountMode: input.discountMode,
    discountStepsBp: input.discountStepsBp,
    globalCoefficient: input.globalCoefficient,
    taxRateBp,
    roundingMode: input.roundingMode,
    roundingStepCents: input.roundingStepCents,
    isLaborSplitEnabled,
  });

  const splits = lines.map((item) =>
    computeEstimateLineSaleSplit(item, {
      marginMultiplier: footer.appliedMarginMultiplier,
      taxRateBp,
      laborRateById,
      isLaborSplitEnabled,
      laborRateAtelierById,
      laborRateChantierById,
    })
  );
  const costLineCents = lines.map(
    (item) =>
      computeEstimateLineValues(withRates(item), {
        marginMultiplier: 1,
        taxRateBp: 0,
        isLaborSplitEnabled,
      }).costLineCents
  );
  const grossSale = splits.map((split) => split.saleLineCents);

  let coefficientShare: number[];
  let discountShare: number[];
  let saleNet: number[];
  let foNet: number[];
  let moNet: number[];
  let moAtelierNet: number[];
  let moChantierNet: number[];
  let taxNet: number[];

  if (calcEngineVersion === 2) {
    // Allocation descendante : coefficient puis remise redescendus par ligne
    // au plus grand reste, puis FO/MO rebasés sur le net.
    coefficientShare = allocateProRata(footer.saleSubtotalCents, grossSale);
    discountShare = allocateProRata(footer.discountCents, coefficientShare);
    saleNet = coefficientShare.map((share, index) => share - discountShare[index]);
    foNet = [];
    moNet = [];
    moAtelierNet = [];
    moChantierNet = [];
    taxNet = [];
    lines.forEach((item, index) => {
      const [fo, mo] = allocateProRata(saleNet[index], [
        splits[index].foSaleLineCents,
        splits[index].moSaleLineCents,
      ]);
      const [atelier, chantier] = allocateProRata(mo, [
        splits[index].moAtelierSaleLineCents,
        splits[index].moChantierSaleLineCents,
      ]);
      foNet.push(fo);
      moNet.push(mo);
      moAtelierNet.push(atelier);
      moChantierNet.push(chantier);
      taxNet.push(
        computeTaxCents(saleNet[index], item.tax_rate_bp ?? taxRateBp)
      );
    });
  } else {
    // Version 1 : chemin historique, aucune allocation (net = brut).
    coefficientShare = grossSale.slice();
    discountShare = grossSale.map(() => 0);
    saleNet = grossSale.slice();
    foNet = splits.map((split) => split.foSaleLineCents);
    moNet = splits.map((split) => split.moSaleLineCents);
    moAtelierNet = splits.map((split) => split.moAtelierSaleLineCents);
    moChantierNet = splits.map((split) => split.moChantierSaleLineCents);
    taxNet = splits.map((split) => split.taxLineCents);
  }

  const lineById = new Map<string, EstimateLineBreakdown>();
  lines.forEach((item, index) => {
    const quantity = Math.max(toSafeNumber(item.quantity, 0), 0);
    lineById.set(item.id, {
      costLineCents: costLineCents[index],
      saleGrossCents: grossSale[index],
      coefficientShareCents: coefficientShare[index],
      discountShareCents: discountShare[index],
      saleNetHtCents: saleNet[index],
      foNetCents: foNet[index],
      moNetCents: moNet[index],
      moAtelierNetCents: moAtelierNet[index],
      moChantierNetCents: moChantierNet[index],
      puNetHtCents: quantity > 0 ? bankersRound(saleNet[index] / quantity) : 0,
      taxCents: taxNet[index],
    });
  });

  const sumAllocatedHtCents = saleNet.reduce((sum, value) => sum + value, 0);

  let sectionById: Map<string, SectionTotals>;
  let rootLineIds: string[];
  let totals: EstimateTotals;

  if (calcEngineVersion === 2) {
    ({ sectionById, rootLineIds } = aggregateNetSections(items, lineById));
    // TVA par ligne sur le net : supprime la double branche coefficient===1.
    const taxCents = taxNet.reduce((sum, value) => sum + value, 0);
    const ttcCents = footer.saleTotalCents + taxCents;
    const roundedTtcCents = Math.max(
      applyRounding(ttcCents, input.roundingMode, input.roundingStepCents),
      footer.saleTotalCents
    );
    totals = {
      ...footer,
      taxCents,
      ttcCents,
      roundedTtcCents,
      roundingAdjustmentCents: roundedTtcCents - ttcCents,
      adjustedTaxCents: roundedTtcCents - footer.saleTotalCents,
    };
  } else {
    sectionById = computeAllSectionTotals({
      items,
      marginMultiplier: footer.appliedMarginMultiplier,
      taxRateBp,
      discountCents: footer.discountCents,
      // Grandeurs de version ignorées par le corps v1 ; `calcEngineVersion: 1`
      // force le chemin historique (pas de récursion vers le breakdown).
      marginMode: input.marginMode,
      marginTiers: input.marginTiers,
      globalCoefficient: input.globalCoefficient,
      discountMode: input.discountMode,
      discountStepsBp: input.discountStepsBp,
      calcEngineVersion: 1,
      laborRateById,
      isLaborSplitEnabled,
      laborRateAtelierById,
      laborRateChantierById,
    });
    const sectionSet = new Set(
      items.filter((item) => item.item_type === "section").map((item) => item.id)
    );
    rootLineIds = lines
      .filter((item) => !item.parent_id || !sectionSet.has(item.parent_id))
      .map((item) => item.id);
    totals = footer;
  }

  return {
    totals,
    lineById,
    sectionById,
    rootLineIds,
    invariants: {
      sumAllocatedHtCents,
      matchesFooter:
        calcEngineVersion === 2 && sumAllocatedHtCents === totals.saleTotalCents,
    },
  };
}

/**
 * Compute the initial discount in cents from `discount_bp` for a draft version.
 * Used on load to convert the stored basis-point discount to an absolute cents amount.
 */
export function computeInitialDiscountCents(
  version: EstimateVersionForCalc,
  items: EstimateItemRecord[],
  laborRateById: Map<string, number>,
  /**
   * Contexte tenant (EST-031). OBLIGATOIREMENT la meme valeur que celle passee
   * a `computeEstimateTotals` par l'appelant.
   *
   * Ce parametre valait `false` en dur : l'assiette de la remise etait donc
   * calculee split OFF, puis le montant obtenu etait soustrait d'un sous-total
   * calcule split ON — et le total faux etait PERSISTE. Sur une ligne dont la
   * MO est entierement ventilee, l'assiette tombait meme a 0, le garde
   * `if (!saleSubtotal) return 0` s'activait et la remise disparaissait
   * entierement.
   */
  isLaborSplitEnabled: boolean,
  laborRateAtelierById?: Map<string, number>,
  laborRateChantierById?: Map<string, number>
): number {
  const saleSubtotal = items.reduce((sum, item) => {
    if (item.item_type !== "line") return sum;
    const hourlyRate = item.labor_role_id
      ? laborRateById.get(item.labor_role_id) ?? 0
      : 0;
    // Meme cascade que `withRates` : taux dedie -> taux par defaut -> 0.
    const hourlyRateAtelier = item.labor_role_atelier_id
      ? (laborRateAtelierById?.get(item.labor_role_atelier_id) ??
          laborRateById.get(item.labor_role_atelier_id) ??
          0)
      : 0;
    const hourlyRateChantier = item.labor_role_chantier_id
      ? (laborRateChantierById?.get(item.labor_role_chantier_id) ??
          laborRateById.get(item.labor_role_chantier_id) ??
          0)
      : 0;
    const lineValues = computeEstimateLineValues(
      {
        ...item,
        labor_role_hourly_rate_cents: hourlyRate,
        labor_role_atelier_hourly_rate_cents: hourlyRateAtelier,
        labor_role_chantier_hourly_rate_cents: hourlyRateChantier,
      },
      {
        marginMultiplier: version.margin_multiplier,
        taxRateBp: version.tax_rate_bp,
        isLaborSplitEnabled,
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
  rateAtelierById,
  rateChantierById,
  isLaborSplitEnabled,
}: {
  items: T[];
  version: EstimateVersionForCalc;
  rateById: Map<string, number>;
  /**
   * Taux horaires atelier / chantier (EST-031). Optionnels : a defaut, on
   * retombe sur `rateById`, ce qui reste juste tant que les trois roles sont
   * alimentes par la meme colonne `hourly_rate_cents` (cf. calc-context).
   *
   * Sans eux, une ligne dont la MO est entierement ventilee en
   * atelier/chantier etait valorisee a 0 EUR — puis PERSISTEE a 0 EUR, la
   * renormalisation ecrivant `line_total_ht_cents`.
   */
  rateAtelierById?: Map<string, number>;
  rateChantierById?: Map<string, number>;
  isLaborSplitEnabled: boolean;
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
    // Meme cascade que `withRates` dans computeEstimateBreakdown :
    // taux dedie -> taux par defaut -> 0.
    const hourlyRateAtelier = item.labor_role_atelier_id
      ? (rateAtelierById?.get(item.labor_role_atelier_id) ??
          rateById.get(item.labor_role_atelier_id) ??
          0)
      : 0;
    const hourlyRateChantier = item.labor_role_chantier_id
      ? (rateChantierById?.get(item.labor_role_chantier_id) ??
          rateById.get(item.labor_role_chantier_id) ??
          0)
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
        labor_role_atelier_hourly_rate_cents: hourlyRateAtelier,
        labor_role_chantier_hourly_rate_cents: hourlyRateChantier,
      },
      {
        marginMultiplier: version.margin_multiplier,
        taxRateBp: taxRate,
        isLaborSplitEnabled,
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
  isLaborSplitEnabled,
  marginTiers,
  roundingMode,
  roundingStepCents,
  calcEngineVersion,
  laborRateAtelierById = laborRateById,
  laborRateChantierById = laborRateById,
}: {
  items: EstimateItemRecord[];
  version: EstimateVersionForCalc;
  discountCents: number;
  laborRateById: Map<string, number>;
  isLaborSplitEnabled: boolean;
  /**
   * Grandeurs de VERSION requises par le moteur unifie. Elles sont IGNOREES par
   * le corps v1 ci-dessous (qui derive le pied des colonnes stockees) : les
   * exiger malgre tout evite qu'un appelant se retrouve avec un chiffre faux
   * au moment de la bascule, sans que rien ne l'ait signale.
   */
  marginTiers: MarginTier[];
  roundingMode: RoundingMode;
  roundingStepCents: number;
  calcEngineVersion: CalcEngineVersion;
  laborRateAtelierById?: Map<string, number>;
  laborRateChantierById?: Map<string, number>;
}): EstimateTotals {
  // EST-E26 (T6, etape 9, dernier wrapper) : en version 2, le pied DERIVE du
  // moteur unifie et cesse donc de renvoyer les colonnes figees
  // (`total_ht_cents` / `total_tax_cents` / `total_ttc_cents`). En version 1,
  // corps historique strictement inchange ci-dessous.
  if (calcEngineVersion === 2) {
    return computeEstimateBreakdown({
      items,
      marginMultiplier: version.margin_multiplier,
      marginMode: version.margin_mode ?? "fixed",
      marginTiers,
      globalCoefficient: clampGlobalCoefficient(version.global_coefficient),
      discountMode: version.discount_mode === "cascade" ? "cascade" : "simple",
      discountCents,
      discountStepsBp: normalizeDiscountStepsBp(version.discount_steps),
      taxRateBp: version.tax_rate_bp,
      roundingMode,
      roundingStepCents,
      isLaborSplitEnabled,
      laborRateById,
      laborRateAtelierById,
      laborRateChantierById,
      calcEngineVersion,
    }).totals;
  }

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
        isLaborSplitEnabled,
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
