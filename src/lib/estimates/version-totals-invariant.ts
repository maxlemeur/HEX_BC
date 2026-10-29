import type { PatchEstimateVersionInput } from "@/lib/estimates/schemas";

export type EstimateTotals = {
  total_ht_cents: number | null;
  total_tax_cents: number | null;
  total_ttc_cents: number | null;
};

export type EstimateTotalsInvariantRule =
  | "total_ttc_gte_total_ht"
  | "total_tax_non_negative"
  | "total_ttc_equals_total_ht_plus_total_tax";

export type EstimateTotalsInvariantViolation = {
  rule: EstimateTotalsInvariantRule;
  message: string;
};

export function extractPatchedEstimateTotals(input: Pick<PatchEstimateVersionInput, "total_ht_cents" | "total_tax_cents" | "total_ttc_cents">) {
  const patchedTotals: Partial<EstimateTotals> = {};

  if ("total_ht_cents" in input) {
    patchedTotals.total_ht_cents = input.total_ht_cents ?? null;
  }
  if ("total_tax_cents" in input) {
    patchedTotals.total_tax_cents = input.total_tax_cents ?? null;
  }
  if ("total_ttc_cents" in input) {
    patchedTotals.total_ttc_cents = input.total_ttc_cents ?? null;
  }

  return patchedTotals;
}

export function mergeEstimateTotalsForPatch(input: {
  persistedTotals: EstimateTotals;
  patch: Pick<PatchEstimateVersionInput, "total_ht_cents" | "total_tax_cents" | "total_ttc_cents">;
}): EstimateTotals {
  const mergedTotals: EstimateTotals = {
    ...input.persistedTotals,
  };

  if ("total_ht_cents" in input.patch) {
    mergedTotals.total_ht_cents = input.patch.total_ht_cents ?? null;
  }
  if ("total_tax_cents" in input.patch) {
    mergedTotals.total_tax_cents = input.patch.total_tax_cents ?? null;
  }
  if ("total_ttc_cents" in input.patch) {
    mergedTotals.total_ttc_cents = input.patch.total_ttc_cents ?? null;
  }

  return mergedTotals;
}

export function getEstimateTotalsInvariantViolation(
  totals: EstimateTotals
): EstimateTotalsInvariantViolation | null {
  if (
    totals.total_ttc_cents !== null &&
    totals.total_ht_cents !== null &&
    totals.total_ttc_cents < totals.total_ht_cents
  ) {
    return {
      rule: "total_ttc_gte_total_ht",
      message:
        "Incoherence des totaux: total_ttc_cents doit être supérieur ou egal a total_ht_cents.",
    };
  }

  if (totals.total_tax_cents !== null && totals.total_tax_cents < 0) {
    return {
      rule: "total_tax_non_negative",
      message:
        "Incoherence des totaux: total_tax_cents doit être supérieur ou egal a 0.",
    };
  }

  if (
    totals.total_ttc_cents !== null &&
    totals.total_ht_cents !== null &&
    totals.total_tax_cents !== null &&
    totals.total_ttc_cents !== totals.total_ht_cents + totals.total_tax_cents
  ) {
    return {
      rule: "total_ttc_equals_total_ht_plus_total_tax",
      message:
        "Incoherence des totaux: total_ttc_cents doit être egal a total_ht_cents + total_tax_cents.",
    };
  }

  return null;
}
