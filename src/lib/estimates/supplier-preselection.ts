export type EstimateSupplierComparisonAlternativeKind =
  | "best_price"
  | "most_recent"
  | "preferred_supplier"
  | "selected_current";

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

export type EstimateSupplierComparisonAlternativeContract = {
  kind: EstimateSupplierComparisonAlternativeKind;
  supplier_price_id: string;
  supplier_id: string;
  supplier_name: string;
  adjusted_unit_price_cents: number;
  supplier_reference: string | null;
  catalogue_url: string | null;
  updated_at: string | null;
  is_stale: boolean;
  product_designation: string;
  is_selected: boolean;
};

export type EstimateSupplierPreselectionPatch = {
  unit_price_ht_cents: number;
  selected_supplier_price_id: string;
};

export type EstimateSupplierPreselectionProposalReason =
  | "single_clear_option";

export type EstimateSupplierPreselectionExceptionReason =
  | "divergence"
  | "stale"
  | "ambiguous"
  | "no_price";

export type EstimateSupplierPreselectionProposal = {
  item_id: string;
  item_title: string;
  current_alternative: EstimateSupplierComparisonAlternativeContract | null;
  proposed_alternative: EstimateSupplierComparisonAlternativeContract;
  patch: EstimateSupplierPreselectionPatch;
  reason: EstimateSupplierPreselectionProposalReason;
  explanation: string;
  is_reversible: true;
};

export type EstimateSupplierPreselectionException = {
  item_id: string;
  item_title: string;
  reason: EstimateSupplierPreselectionExceptionReason;
  coverage_status: EstimateSupplierComparisonCoverageStatus;
  risk_flags: EstimateSupplierComparisonRiskFlag[];
  selected_alternative: EstimateSupplierComparisonAlternativeContract | null;
  alternatives: EstimateSupplierComparisonAlternativeContract[];
};

export type EstimateSupplierPreselectionSummary = {
  total_items: number;
  proposed_items: number;
  exception_items: number;
  already_selected_items: number;
  divergence_items: number;
  stale_items: number;
  ambiguous_items: number;
  no_price_items: number;
};

export type EstimateSupplierPreselectionReview = {
  summary: EstimateSupplierPreselectionSummary;
  proposals: EstimateSupplierPreselectionProposal[];
  exceptions: EstimateSupplierPreselectionException[];
};
