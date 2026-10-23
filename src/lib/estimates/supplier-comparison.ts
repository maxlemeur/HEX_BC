import {
  type CataloguePriceSuggestion,
  type SupplierAlternative,
  type SupplierAlternativeKind,
} from "@/lib/estimates/catalogue-suggestions";

import { isSupplierAlternativeCurrencyCompatible } from "@/lib/estimates/supplier-preselection";

import { type SupplierOfferConditions } from "@/lib/estimates/supplier-offer-conditions";

import { supplierOfferIneligibility } from "@/lib/estimates/supplier-offer-eligibility";

import { isSupplierOfferPriceEligible } from "@/lib/estimates/supplier-offer-price";

import { alternativePriceForLineUnit } from "@/lib/estimates/supplier-offer-purchase-unit";

import type {
  EstimateSupplierPreselectionException,
  EstimateSupplierPreselectionExceptionReason,
  EstimateSupplierPreselectionPatch,
  EstimateSupplierPreselectionProposal,
  EstimateSupplierPreselectionReview,
  EstimateSupplierPreselectionSummary,
} from "@/lib/estimates/supplier-preselection";

export type SupplierComparisonAlternativeKind =
  | SupplierAlternativeKind
  | "selected_current";

type SuggestedSupplierAlternative = SupplierAlternative;

export type SuggestedCataloguePrice = CataloguePriceSuggestion;

export type SupplierPricebookRow = {
  id: string;
  supplier_id: string;
  product_id: string;
  supplier_sku: string | null;
  unit: string;
  unit_price_cents: number;
  zero_price_kind?: string | null;
  estimate_unit_code?: string | null;
  estimate_units_per_purchase_unit?: number | string | null;
  purchase_rounding?: string | null;
  currency: string;
  updated_at: string;
  created_at: string;
  notes: string | null;
  is_active: boolean;
  product_url?: string | null;
  supplier_catalog_items?:
    | {
        supplier_sku: string | null;
        product_url: string | null;
      }
    | Array<{
        supplier_sku: string | null;
        product_url: string | null;
      }>
    | null;
};

export type HydratedSuggestedCatalogueCandidate = Omit<
  SuggestedCataloguePrice,
  "alternatives" | "supplier_offer_count"
> & {
  price_source: "supplier";
  supplier_price_id: string;
  supplier_id: string;
  supplier_name: string;
};

type EstimateSupplierComparisonSourceAlternative = {
  supplier_price_id: string;
  supplier_id: string;
  supplier_name: string;
  adjusted_unit_price_cents: number;
  /** 2.9: price per purchase unit, for a line written in it. */
  adjusted_purchase_unit_price_cents?: number | null;
  /** Devise du prix fournisseur ; null = déjà dans la devise du devis. */
  currency: string | null;
  supplier_reference: string | null;
  catalogue_url: string | null;
  updated_at: string | null;
  is_stale: boolean;
  product_designation: string;
};

export type EstimateSupplierComparisonAlternative = SupplierOfferConditions & {
  kind: SupplierComparisonAlternativeKind;
  supplier_price_id: string;
  supplier_id: string;
  supplier_name: string;
  adjusted_unit_price_cents: number;
  /** 2.9: price per purchase unit, for a line written in it. */
  adjusted_purchase_unit_price_cents?: number | null;
  /** Devise du prix fournisseur ; null = déjà dans la devise du devis. */
  currency: string | null;
  supplier_reference: string | null;
  catalogue_url: string | null;
  updated_at: string | null;
  is_stale: boolean;
  product_designation: string;
  is_selected: boolean;
};

export type EstimateSupplierComparisonCoverageStatus =
  | "covered"
  | "ambiguous"
  | "no_price"
  | "stale";

export type EstimateSupplierComparisonRiskFlag =
  | "multiple_alternatives"
  | "selection_missing"
  | "selected_stale"
  | "selected_not_best_price";

export type EstimateSupplierComparison = {
  item_id: string;
  quantity?: number;
  unit?: string | null;
  selected_supplier_price_id: string | null;
  best_supplier_price_id: string | null;
  coverage_status: EstimateSupplierComparisonCoverageStatus;
  risk_flags: EstimateSupplierComparisonRiskFlag[];
  selected_alternative: EstimateSupplierComparisonAlternative | null;
  alternatives: EstimateSupplierComparisonAlternative[];
};

export type EstimateSupplierComparisonCoverageSummary = {
  total_items: number;
  covered_items: number;
  ambiguous_items: number;
  no_price_items: number;
  stale_items: number;
};

export type EstimateSupplierComparisonCandidate = {
  supplier_price_id: string;
  supplier_id: string;
  supplier_name: string;
  adjusted_unit_price_cents: number;
  adjusted_purchase_unit_price_cents?: number | null;
  /** Devise du prix fournisseur ; null = déjà dans la devise du devis. */
  currency: string | null;
  supplier_reference: string | null;
  catalogue_url: string | null;
  updated_at: string | null;
  is_stale: boolean;
  product_designation: string;
  alternatives: SuggestedSupplierAlternative[];
};

const SUPPLIER_COMPARISON_ALTERNATIVE_KIND_ORDER: SupplierComparisonAlternativeKind[] = [
  "best_price",
  "most_recent",
  "selected_current",
  "preferred_supplier",
];

export function buildSuggestedCatalogueAlternatives(input: {
  productCandidates: HydratedSuggestedCatalogueCandidate[];
  preferredSupplierId: string | null;
}) {
  const alternatives: SuggestedSupplierAlternative[] = [];
  const pushAlternative = (
    kind: SupplierAlternativeKind,
    selected: HydratedSuggestedCatalogueCandidate | null
  ) => {
    if (!selected) return;
    if (alternatives.some((existing) => existing.supplier_price_id === selected.supplier_price_id)) {
      return;
    }
    alternatives.push({
      kind,
      supplier_price_id: selected.supplier_price_id,
      supplier_id: selected.supplier_id,
      supplier_name: selected.supplier_name,
      unit_price_cents: selected.unit_price_cents,
      adjusted_unit_price_cents: selected.adjusted_unit_price_cents,
      currency: selected.currency,
      supplier_reference: selected.supplier_reference,
      unit: selected.unit,
      updated_at: selected.updated_at,
      is_stale: selected.is_stale,
      catalogue_url: selected.catalogue_url,
      zero_price_kind: selected.zero_price_kind ?? null,
      purchase_unit: selected.purchase_unit ?? null,
      adjusted_purchase_unit_price_cents: selected.adjusted_purchase_unit_price_cents ?? null,
      estimate_unit_code: selected.estimate_unit_code ?? null,
      estimate_units_per_purchase_unit: selected.estimate_units_per_purchase_unit ?? null,
      purchase_rounding: selected.purchase_rounding ?? null,
    });
  };

  const bestPrice = [...input.productCandidates].sort((left, right) => {
    if (left.adjusted_unit_price_cents !== right.adjusted_unit_price_cents) {
      return left.adjusted_unit_price_cents - right.adjusted_unit_price_cents;
    }
    return toTimestamp(right.updated_at) - toTimestamp(left.updated_at);
  })[0] ?? null;
  const mostRecent = getMostRecentRecord(input.productCandidates);
  const preferredSupplier = input.preferredSupplierId
    ? getMostRecentRecord(
        input.productCandidates.filter(
          (entry) => entry.supplier_id === input.preferredSupplierId
        )
      )
    : null;

  pushAlternative("best_price", bestPrice);
  pushAlternative("most_recent", mostRecent);
  pushAlternative("preferred_supplier", preferredSupplier);

  return alternatives;
}

function toEstimateSupplierComparisonSourceAlternative(input: {
  supplier_price_id: string;
  supplier_id: string;
  supplier_name: string;
  adjusted_unit_price_cents: number;
  adjusted_purchase_unit_price_cents?: number | null;
  currency?: string | null;
  supplier_reference: string | null;
  catalogue_url: string | null;
  updated_at: string | null;
  is_stale: boolean;
  product_designation: string;
}): EstimateSupplierComparisonSourceAlternative {
  return {
    supplier_price_id: input.supplier_price_id,
    supplier_id: input.supplier_id,
    supplier_name: input.supplier_name,
    adjusted_unit_price_cents: input.adjusted_unit_price_cents,
    adjusted_purchase_unit_price_cents: input.adjusted_purchase_unit_price_cents ?? null,
    currency: input.currency ?? null,
    supplier_reference: input.supplier_reference,
    catalogue_url: input.catalogue_url,
    updated_at: input.updated_at,
    is_stale: input.is_stale,
    product_designation: input.product_designation,
  };
}

function toEstimateSupplierComparisonAlternative(input: {
  kind: SupplierComparisonAlternativeKind;
  alternative: EstimateSupplierComparisonSourceAlternative;
  selectedSupplierPriceId: string | null;
}): EstimateSupplierComparisonAlternative {
  return {
    kind: input.kind,
    supplier_price_id: input.alternative.supplier_price_id,
    supplier_id: input.alternative.supplier_id,
    supplier_name: input.alternative.supplier_name,
    adjusted_unit_price_cents: input.alternative.adjusted_unit_price_cents,
    adjusted_purchase_unit_price_cents: input.alternative.adjusted_purchase_unit_price_cents,
    currency: input.alternative.currency,
    supplier_reference: input.alternative.supplier_reference,
    catalogue_url: input.alternative.catalogue_url,
    updated_at: input.alternative.updated_at,
    is_stale: input.alternative.is_stale,
    product_designation: input.alternative.product_designation,
    is_selected:
      input.selectedSupplierPriceId !== null &&
      input.alternative.supplier_price_id === input.selectedSupplierPriceId,
  };
}

function findSuggestedAlternativeByKind(
  alternatives: SuggestedSupplierAlternative[],
  kind: SupplierAlternativeKind
) {
  return alternatives.find((alternative) => alternative.kind === kind) ?? null;
}

export function buildEstimateSupplierComparisonAlternatives(input: {
  candidate: EstimateSupplierComparisonCandidate;
  selectedSupplierPriceId: string | null;
}): EstimateSupplierComparisonAlternative[] {
  const alternativesByKind = new Map<
    SupplierComparisonAlternativeKind,
    EstimateSupplierComparisonAlternative
  >();

  const registerAlternative = (
    kind: SupplierComparisonAlternativeKind,
    alternative: EstimateSupplierComparisonSourceAlternative | null
  ) => {
    if (!alternative) {
      return;
    }

    const existingEntry = Array.from(alternativesByKind.values()).find(
      (entry) => entry.supplier_price_id === alternative.supplier_price_id
    );
    if (existingEntry) {
      if (
        input.selectedSupplierPriceId !== null &&
        existingEntry.supplier_price_id === input.selectedSupplierPriceId
      ) {
        existingEntry.is_selected = true;
      }
      return;
    }

    const normalized = toEstimateSupplierComparisonAlternative({
      kind,
      alternative,
      selectedSupplierPriceId: input.selectedSupplierPriceId,
    });

    alternativesByKind.set(kind, normalized);
  };

  const bestPrice = findSuggestedAlternativeByKind(input.candidate.alternatives, "best_price");
  const mostRecent = findSuggestedAlternativeByKind(input.candidate.alternatives, "most_recent");
  const preferredSupplier = findSuggestedAlternativeByKind(
    input.candidate.alternatives,
    "preferred_supplier"
  );

  registerAlternative(
    "best_price",
    bestPrice
      ? toEstimateSupplierComparisonSourceAlternative({
          supplier_price_id: bestPrice.supplier_price_id,
          supplier_id: bestPrice.supplier_id,
          supplier_name: bestPrice.supplier_name,
          adjusted_unit_price_cents: bestPrice.adjusted_unit_price_cents,
          adjusted_purchase_unit_price_cents: bestPrice.adjusted_purchase_unit_price_cents ?? null,
          currency: bestPrice.currency ?? null,
          supplier_reference: bestPrice.supplier_reference,
          catalogue_url: bestPrice.catalogue_url,
          updated_at: bestPrice.updated_at,
          is_stale: bestPrice.is_stale,
          product_designation: input.candidate.product_designation,
        })
      : null
  );
  registerAlternative(
    "most_recent",
    mostRecent
      ? toEstimateSupplierComparisonSourceAlternative({
          supplier_price_id: mostRecent.supplier_price_id,
          supplier_id: mostRecent.supplier_id,
          supplier_name: mostRecent.supplier_name,
          adjusted_unit_price_cents: mostRecent.adjusted_unit_price_cents,
          adjusted_purchase_unit_price_cents: mostRecent.adjusted_purchase_unit_price_cents ?? null,
          currency: mostRecent.currency ?? null,
          supplier_reference: mostRecent.supplier_reference,
          catalogue_url: mostRecent.catalogue_url,
          updated_at: mostRecent.updated_at,
          is_stale: mostRecent.is_stale,
          product_designation: input.candidate.product_designation,
        })
      : null
  );
  registerAlternative(
    "preferred_supplier",
    preferredSupplier
      ? toEstimateSupplierComparisonSourceAlternative({
          supplier_price_id: preferredSupplier.supplier_price_id,
          supplier_id: preferredSupplier.supplier_id,
          supplier_name: preferredSupplier.supplier_name,
          adjusted_unit_price_cents: preferredSupplier.adjusted_unit_price_cents,
          adjusted_purchase_unit_price_cents: preferredSupplier.adjusted_purchase_unit_price_cents ?? null,
          currency: preferredSupplier.currency ?? null,
          supplier_reference: preferredSupplier.supplier_reference,
          catalogue_url: preferredSupplier.catalogue_url,
          updated_at: preferredSupplier.updated_at,
          is_stale: preferredSupplier.is_stale,
          product_designation: input.candidate.product_designation,
        })
      : null
  );

  const selectedAlternative =
    input.selectedSupplierPriceId === null
      ? null
      : input.candidate.supplier_price_id === input.selectedSupplierPriceId
        ? toEstimateSupplierComparisonSourceAlternative({
            supplier_price_id: input.candidate.supplier_price_id,
            supplier_id: input.candidate.supplier_id,
            supplier_name: input.candidate.supplier_name,
            adjusted_unit_price_cents: input.candidate.adjusted_unit_price_cents,
            adjusted_purchase_unit_price_cents: input.candidate.adjusted_purchase_unit_price_cents ?? null,
            currency: input.candidate.currency ?? null,
            supplier_reference: input.candidate.supplier_reference,
            catalogue_url: input.candidate.catalogue_url,
            updated_at: input.candidate.updated_at,
            is_stale: input.candidate.is_stale,
            product_designation: input.candidate.product_designation,
          })
        : (() => {
            const selected = input.candidate.alternatives.find(
              (alternative) =>
                alternative.supplier_price_id === input.selectedSupplierPriceId
            );
            if (!selected) {
              return null;
            }

            return toEstimateSupplierComparisonSourceAlternative({
              supplier_price_id: selected.supplier_price_id,
              supplier_id: selected.supplier_id,
              supplier_name: selected.supplier_name,
              adjusted_unit_price_cents: selected.adjusted_unit_price_cents,
              adjusted_purchase_unit_price_cents: selected.adjusted_purchase_unit_price_cents ?? null,
              currency: selected.currency ?? null,
              supplier_reference: selected.supplier_reference,
              catalogue_url: selected.catalogue_url,
              updated_at: selected.updated_at,
              is_stale: selected.is_stale,
              product_designation: input.candidate.product_designation,
            });
          })();

  registerAlternative("selected_current", selectedAlternative);

  return SUPPLIER_COMPARISON_ALTERNATIVE_KIND_ORDER.map((kind) =>
    alternativesByKind.get(kind)
  ).filter((alternative): alternative is EstimateSupplierComparisonAlternative =>
    Boolean(alternative)
  );
}

export function findSelectedSupplierComparisonAlternative(
  alternatives: EstimateSupplierComparisonAlternative[],
  selectedSupplierPriceId: string | null
) {
  if (!selectedSupplierPriceId) {
    return null;
  }

  return (
    alternatives.find(
      (alternative) => alternative.supplier_price_id === selectedSupplierPriceId
    ) ?? null
  );
}

export function computeEstimateSupplierComparisonRiskFlags(input: {
  alternatives: EstimateSupplierComparisonAlternative[];
  selectedSupplierPriceId: string | null;
  bestSupplierPriceId: string | null;
  selectedAlternative: EstimateSupplierComparisonAlternative | null;
}) {
  const riskFlags: EstimateSupplierComparisonRiskFlag[] = [];

  if (input.alternatives.length > 1) {
    riskFlags.push("multiple_alternatives");
  }

  if (input.alternatives.length > 0 && input.selectedSupplierPriceId === null) {
    riskFlags.push("selection_missing");
  }

  if (input.selectedAlternative?.is_stale === true) {
    riskFlags.push("selected_stale");
  }

  if (
    input.selectedSupplierPriceId !== null &&
    input.bestSupplierPriceId !== null &&
    input.selectedSupplierPriceId !== input.bestSupplierPriceId
  ) {
    riskFlags.push("selected_not_best_price");
  }

  return riskFlags;
}

export function computeEstimateSupplierComparisonCoverageStatus(input: {
  alternatives: EstimateSupplierComparisonAlternative[];
  selectedAlternative: EstimateSupplierComparisonAlternative | null;
  riskFlags: EstimateSupplierComparisonRiskFlag[];
}) {
  if (input.alternatives.length === 0) {
    return "no_price" satisfies EstimateSupplierComparisonCoverageStatus;
  }

  if (input.selectedAlternative?.is_stale === true) {
    return "stale" satisfies EstimateSupplierComparisonCoverageStatus;
  }

  // A7: a retained offer that prices nothing (unmarked 0 €, or price unknown) covers nothing.
  // Needs the offer price and marking merged by readSupplierOfferConditions.
  if (
    input.riskFlags.includes("selection_missing") ||
    (input.selectedAlternative !== null && !isSupplierOfferPriceEligible(input.selectedAlternative))
  ) {
    return "ambiguous" satisfies EstimateSupplierComparisonCoverageStatus;
  }

  return "covered" satisfies EstimateSupplierComparisonCoverageStatus;
}

export function summarizeEstimateSupplierComparisonCoverage(
  comparisons: EstimateSupplierComparison[]
): EstimateSupplierComparisonCoverageSummary {
  const summary: EstimateSupplierComparisonCoverageSummary = {
    total_items: comparisons.length,
    covered_items: 0,
    ambiguous_items: 0,
    no_price_items: 0,
    stale_items: 0,
  };

  comparisons.forEach((comparison) => {
    if (comparison.coverage_status === "covered") {
      summary.covered_items += 1;
      return;
    }
    if (comparison.coverage_status === "ambiguous") {
      summary.ambiguous_items += 1;
      return;
    }
    if (comparison.coverage_status === "stale") {
      summary.stale_items += 1;
      return;
    }

    summary.no_price_items += 1;
  });

  return summary;
}

function createEmptyEstimateSupplierPreselectionSummary(): EstimateSupplierPreselectionSummary {
  return {
    total_items: 0,
    proposed_items: 0,
    exception_items: 0,
    already_selected_items: 0,
    divergence_items: 0,
    stale_items: 0,
    ambiguous_items: 0,
    no_price_items: 0,
    currency_mismatch_items: 0,
  };
}

/**
 * Un prix fournisseur n'est comparable/injectable que s'il est libellé dans la
 * devise du devis. Une devise absente correspond aux données historiques,
 * réputées déjà dans la devise du devis.
 */
function findEstimateSupplierPreselectionProposalAlternative(
  comparison: EstimateSupplierComparison,
  estimateCurrency: string
) {
  if (comparison.selected_supplier_price_id !== null) {
    return null;
  }

  if (comparison.alternatives.length !== 1) {
    return null;
  }

  const [proposedAlternative] = comparison.alternatives;
  if (!proposedAlternative || proposedAlternative.is_stale) {
    return null;
  }

  // Ne jamais préselectionner un prix dans une autre devise : son montant
  // serait écrit tel quel dans unit_price_ht_cents, donc interprété comme un
  // montant dans la devise du devis.
  if (
    supplierOfferIneligibility(proposedAlternative, {
      currency: estimateCurrency, quantity: comparison.quantity, unit: comparison.unit,
    })
  ) {
    return null;
  }

  return proposedAlternative;
}

function resolveEstimateSupplierPreselectionExceptionReason(
  comparison: EstimateSupplierComparison,
  estimateCurrency: string
): EstimateSupplierPreselectionExceptionReason | null {
  if (comparison.alternatives.length === 0) {
    return "no_price";
  }

  // Des prix existent mais aucun dans la devise du devis : arbitrage humain
  // requis. Sans ce cas, la ligne retomberait à tort dans already_selected.
  if (
    comparison.selected_supplier_price_id === null &&
    !comparison.alternatives.some((alternative) =>
      isSupplierAlternativeCurrencyCompatible(alternative, estimateCurrency)
    )
  ) {
    return "currency_mismatch";
  }

  if (comparison.selected_alternative?.is_stale === true) {
    return "stale";
  }

  if (!comparison.alternatives.some((alternative) => !supplierOfferIneligibility(alternative, {
    currency: estimateCurrency, quantity: comparison.quantity, unit: comparison.unit,
  }))) return "ambiguous";

  if (comparison.risk_flags.includes("selected_not_best_price")) {
    return "divergence";
  }

  if (comparison.coverage_status === "ambiguous") {
    return "ambiguous";
  }

  return null;
}

export function buildEstimateSupplierPreselectionReview(input: {
  comparisons: EstimateSupplierComparison[];
  itemTitleById: Map<string, string>;
  /** Devise du devis : un prix dans une autre devise n'est jamais préselectionné. */
  estimateCurrency?: string | null;
}): EstimateSupplierPreselectionReview {
  const estimateCurrency = input.estimateCurrency?.trim() || "EUR";
  const summary = createEmptyEstimateSupplierPreselectionSummary();
  const proposals: EstimateSupplierPreselectionProposal[] = [];
  const exceptions: EstimateSupplierPreselectionException[] = [];

  input.comparisons.forEach((comparison) => {
    summary.total_items += 1;

    const itemTitle = input.itemTitleById.get(comparison.item_id) ?? "Ligne";
    const proposedAlternative =
      findEstimateSupplierPreselectionProposalAlternative(
        comparison,
        estimateCurrency
      );

    if (proposedAlternative) {
      // 2.9: a converted offer gives a line written in bars the bar price, any other line the converted price.
      const patch: EstimateSupplierPreselectionPatch = {
        unit_price_ht_cents: alternativePriceForLineUnit(proposedAlternative, comparison.unit).priceCents,
        selected_supplier_price_id: proposedAlternative.supplier_price_id,
      };

      proposals.push({
        item_id: comparison.item_id,
        item_title: itemTitle,
        item_unit: comparison.unit ?? null,
        current_alternative: comparison.selected_alternative,
        proposed_alternative: proposedAlternative,
        patch,
        reason: "single_clear_option",
        explanation:
          "Une seule option fournisseur non obsolete couvre cette ligne. La preselection reste modifiable avant confirmation.",
        is_reversible: true,
      });
      summary.proposed_items += 1;
      return;
    }

    const exceptionReason =
      resolveEstimateSupplierPreselectionExceptionReason(
        comparison,
        estimateCurrency
      );

    if (exceptionReason) {
      exceptions.push({
        item_id: comparison.item_id,
        item_title: itemTitle,
        item_unit: comparison.unit ?? null,
        reason: exceptionReason,
        coverage_status: comparison.coverage_status,
        risk_flags: comparison.risk_flags,
        selected_alternative: comparison.selected_alternative,
        alternatives: comparison.alternatives,
      });
      summary.exception_items += 1;

      if (exceptionReason === "divergence") {
        summary.divergence_items += 1;
      } else if (exceptionReason === "stale") {
        summary.stale_items += 1;
      } else if (exceptionReason === "ambiguous") {
        summary.ambiguous_items += 1;
      } else if (exceptionReason === "no_price") {
        summary.no_price_items += 1;
      } else if (exceptionReason === "currency_mismatch") {
        summary.currency_mismatch_items += 1;
      }
      return;
    }

    summary.already_selected_items += 1;
  });

  return {
    summary,
    proposals,
    exceptions,
  };
}

export function toTimestamp(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function getMostRecentRecord<T extends { updated_at: string | null }>(rows: T[]) {
  if (rows.length === 0) return null;
  return [...rows].sort((left, right) => {
    return toTimestamp(right.updated_at) - toTimestamp(left.updated_at);
  })[0];
}
