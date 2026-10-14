import {
  computeEstimateLineValues,
  MAX_CENTS,
} from "@/lib/estimate-calculations";
import { bankersRound } from "@/lib/money";

export type GeneratedOuvrageCostProjectionInput = {
  components: readonly {
    componentId: string;
    costType: "material" | "labor" | "equipment" | "subcontract";
    quantity: number;
    unitCostHtCents: number;
    lossCoeffBp: number;
    reviewedDsCents: number;
    derivedHours: number;
  }[];
  parent: {
    quantity: number;
    unitPriceHtCents: number;
    hMo: number;
    kFo: number;
    kMo: number;
    laborRateCents: number | null;
  };
};

export type GeneratedOuvrageCostProjectionReason =
  | "unrepresentable_decimal"
  | "invalid_cents"
  | "invalid_loss"
  | "unexpected_nonlabor_hours"
  | "missing_labor_basis"
  | "missing_labor_rate"
  | "amount_overflow"
  | "component_cost_mismatch"
  | "parent_hours_mismatch"
  | "parent_fo_mismatch"
  | "parent_mo_mismatch"
  | "parent_cost_mismatch"
  | "canonical_cost_mismatch"
  | "canonical_split_mismatch";

export type GeneratedOuvrageCostProjectionError = {
  scope: "component" | "parent";
  componentId?: string;
  reason: GeneratedOuvrageCostProjectionReason;
  field?: string;
  expected?: number;
  actual?: number;
};

export type GeneratedOuvrageProjectedComponent = {
  componentId: string;
  defaultQuantity: number;
  unitPriceHtCents: number;
  hMo: number;
  kFo: number;
  kMo: number;
  dsCents: number;
};

export type GeneratedOuvrageCostProjectionResult =
  | {
      ok: true;
      components: GeneratedOuvrageProjectedComponent[];
      parent: {
        quantity: number;
        unitPriceHtCents: number;
        hMo: number;
        kFo: number;
        kMo: number;
        dsCents: number;
        foCents: number;
        moCents: number;
      };
      totals: {
        dsCents: number;
        foCents: number;
        moCents: number;
        laborHours: number;
      };
    }
  | { ok: false; error: GeneratedOuvrageCostProjectionError };

const ZERO = BigInt(0);
const MILLION = BigInt(1000000);
const MAX_DECIMAL = 999_999_999.999;
const MAX_SCALED_DECIMAL = BigInt(999999999999);

type StoredDecimal = { value: number; scaled: bigint };

function storedDecimal(
  value: number,
  roundCoefficient = false
): StoredDecimal | null {
  if (!Number.isFinite(value) || value < 0 || value > MAX_DECIMAL) return null;
  const stored = roundCoefficient ? Math.round(value * 1000) / 1000 : value;
  const fixed = stored.toFixed(3);
  // Quantities and hours must survive storage unchanged, including at small scales.
  if (Number(fixed) !== stored || stored > MAX_DECIMAL) return null;
  return { value: stored, scaled: BigInt(fixed.replace(".", "")) };
}

function validCents(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_CENTS;
}

function roundedQuotient(numerator: bigint, denominator: bigint): bigint {
  // PostgreSQL numeric round, for the nonnegative amounts admitted here.
  return (numerator + denominator / BigInt(2)) / denominator;
}

function roundedCost(numerator: bigint): number {
  return Number(roundedQuotient(numerator, MILLION));
}

function failure(
  error: GeneratedOuvrageCostProjectionError
): GeneratedOuvrageCostProjectionResult {
  return { ok: false, error };
}

/**
 * Project a reviewed composition into the existing numeric(12,3)/integer columns.
 * A successful result preserves each component and both parent cost categories;
 * it does not promise that every reviewed composition fits this storage model.
 */
export function projectGeneratedOuvrageCosts(
  input: GeneratedOuvrageCostProjectionInput
): GeneratedOuvrageCostProjectionResult {
  const components: GeneratedOuvrageProjectedComponent[] = [];
  let foCents = 0;
  let moCents = 0;
  let hoursScaled = ZERO;

  for (const component of input.components) {
    const context = { scope: "component" as const, componentId: component.componentId };
    const quantity = storedDecimal(component.quantity);
    const hours = storedDecimal(component.derivedHours);
    if (!quantity || !hours) {
      return failure({ ...context, reason: "unrepresentable_decimal", field: !quantity ? "quantity" : "derivedHours" });
    }
    if (!validCents(component.unitCostHtCents) || !validCents(component.reviewedDsCents)) {
      return failure({ ...context, reason: "invalid_cents", field: !validCents(component.unitCostHtCents) ? "unitCostHtCents" : "reviewedDsCents" });
    }
    if (!Number.isInteger(component.lossCoeffBp) || component.lossCoeffBp < 0 || component.lossCoeffBp > 100000) {
      return failure({ ...context, reason: "invalid_loss", field: "lossCoeffBp" });
    }
    const isLabor = component.costType === "labor";
    const laborRateCents = isLabor ? input.parent.laborRateCents : 0;
    if (laborRateCents === null) {
      return failure({ ...context, reason: "missing_labor_rate" });
    }
    if (!validCents(laborRateCents)) {
      return failure({ ...context, reason: "invalid_cents", field: "laborRateCents" });
    }
    if (!isLabor && hours.scaled !== ZERO) {
      return failure({ ...context, reason: "unexpected_nonlabor_hours", expected: 0, actual: hours.value });
    }

    const unitCost = BigInt(component.unitCostHtCents);
    const projectedLaborRate = BigInt(laborRateCents);
    let kFoScaled = ZERO;
    let kMoScaled = ZERO;
    if (isLabor) {
      const basis = hours.scaled * projectedLaborRate;
      if (component.reviewedDsCents > 0 && basis === ZERO) {
        return failure({ ...context, reason: "missing_labor_basis" });
      }
      kMoScaled = basis === ZERO
        ? ZERO
        : roundedQuotient(BigInt(component.reviewedDsCents) * MILLION, basis);
    } else {
      kFoScaled = roundedQuotient(BigInt(10000 + component.lossCoeffBp), BigInt(10));
    }
    if (kMoScaled > MAX_SCALED_DECIMAL) {
      return failure({ ...context, reason: "unrepresentable_decimal", field: "kMo" });
    }
    const recomposed = roundedCost(
      isLabor
        ? hours.scaled * projectedLaborRate * kMoScaled
        : quantity.scaled * unitCost * kFoScaled
    );
    if (recomposed !== component.reviewedDsCents) {
      return failure({ ...context, reason: "component_cost_mismatch", expected: component.reviewedDsCents, actual: recomposed });
    }
    const canonicalComponent = computeEstimateLineValues({
      quantity: quantity.value,
      unit_price_ht_cents: isLabor ? 0 : component.unitCostHtCents,
      h_mo: hours.value,
      h_mo_majoration: 1,
      k_fo: Number(kFoScaled) / 1000,
      k_mo: Number(kMoScaled) / 1000,
      labor_role_hourly_rate_cents: isLabor ? laborRateCents : null,
      pu_ht_cents: null,
      tax_rate_bp: 0,
    }, { marginMultiplier: 1, taxRateBp: 0, isLaborSplitEnabled: false });
    if (canonicalComponent.costLineCents !== component.reviewedDsCents) {
      return failure({ ...context, reason: "component_cost_mismatch", expected: component.reviewedDsCents, actual: canonicalComponent.costLineCents });
    }
    if (isLabor) moCents += recomposed;
    else foCents += recomposed;
    hoursScaled += hours.scaled;
    if (foCents + moCents > MAX_CENTS) {
      return failure({ ...context, reason: "amount_overflow", actual: foCents + moCents });
    }
    if (hoursScaled > MAX_SCALED_DECIMAL) {
      return failure({ scope: "parent", reason: "unrepresentable_decimal", field: "hMo" });
    }
    components.push({
      componentId: component.componentId,
      defaultQuantity: quantity.value,
      unitPriceHtCents: component.unitCostHtCents,
      hMo: hours.value,
      kFo: Number(kFoScaled) / 1000,
      kMo: Number(kMoScaled) / 1000,
      dsCents: recomposed,
    });
  }

  const parent = input.parent;
  const quantity = storedDecimal(parent.quantity);
  const hours = storedDecimal(parent.hMo);
  const kFo = storedDecimal(parent.kFo, true);
  const kMo = storedDecimal(parent.kMo, true);
  if (!quantity || !hours || !kFo || !kMo) {
    return failure({
      scope: "parent",
      reason: "unrepresentable_decimal",
      field: !quantity ? "quantity" : !hours ? "hMo" : !kFo ? "kFo" : "kMo",
    });
  }
  if (!validCents(parent.unitPriceHtCents) || (parent.laborRateCents !== null && !validCents(parent.laborRateCents))) {
    return failure({ scope: "parent", reason: "invalid_cents", field: !validCents(parent.unitPriceHtCents) ? "unitPriceHtCents" : "laborRateCents" });
  }
  const laborHours = Number(hoursScaled) / 1000;
  if (hours.scaled !== hoursScaled) {
    return failure({ scope: "parent", reason: "parent_hours_mismatch", expected: laborHours, actual: hours.value });
  }
  // An hours-only fallback with no priced role must not move positive MO to FO.
  if (moCents > 0 && (parent.laborRateCents === null || parent.laborRateCents === 0)) {
    return failure({ scope: "parent", reason: "missing_labor_rate", expected: moCents, actual: 0 });
  }

  const foNumerator = quantity.scaled * BigInt(parent.unitPriceHtCents) * kFo.scaled;
  const moNumerator = hours.scaled * BigInt(parent.laborRateCents ?? 0) * kMo.scaled;
  const parentFo = roundedCost(foNumerator);
  const parentMo = roundedCost(moNumerator);
  const dsCents = foCents + moCents;
  if (parentFo !== foCents) {
    return failure({ scope: "parent", reason: "parent_fo_mismatch", expected: foCents, actual: parentFo });
  }
  if (parentMo !== moCents) {
    return failure({ scope: "parent", reason: "parent_mo_mismatch", expected: moCents, actual: parentMo });
  }
  const parentDs = roundedCost(foNumerator + moNumerator);
  if (parentDs !== dsCents) {
    return failure({ scope: "parent", reason: "parent_cost_mismatch", expected: dsCents, actual: parentDs });
  }

  const canonical = computeEstimateLineValues({
    quantity: quantity.value,
    unit_price_ht_cents: parent.unitPriceHtCents,
    h_mo: hours.value,
    h_mo_majoration: 1,
    k_fo: kFo.value,
    k_mo: kMo.value,
    labor_role_hourly_rate_cents: parent.laborRateCents,
    pu_ht_cents: null,
    tax_rate_bp: 0,
  }, { marginMultiplier: 1, taxRateBp: 0, isLaborSplitEnabled: false });
  if (canonical.costLineCents !== dsCents) {
    return failure({ scope: "parent", reason: "canonical_cost_mismatch", expected: dsCents, actual: canonical.costLineCents });
  }
  if (!validCents(canonical.puHtCents)) {
    return failure({ scope: "parent", reason: "amount_overflow", field: "puHtCents", actual: canonical.puHtCents });
  }
  // Match computeEstimateLineSaleSplit at margin 1: MO rounds independently,
  // then FO receives the canonical total's residual. No cross-category offset.
  const canonicalMo = Math.min(bankersRound(hours.value * (parent.laborRateCents ?? 0) * kMo.value), canonical.saleLineCents);
  if (canonicalMo !== moCents || canonical.saleLineCents - canonicalMo !== foCents) {
    return failure({ scope: "parent", reason: "canonical_split_mismatch", expected: moCents, actual: canonicalMo });
  }

  return {
    ok: true,
    components,
    parent: {
      quantity: quantity.value,
      unitPriceHtCents: parent.unitPriceHtCents,
      hMo: hours.value,
      kFo: kFo.value,
      kMo: kMo.value,
      dsCents,
      foCents,
      moCents,
    },
    totals: { dsCents, foCents, moCents, laborHours },
  };
}
