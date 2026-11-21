import type { ComputeAllSectionTotalsInput } from "@/lib/estimate-calculations";

export type SuggestionLearningRuleBoost = {
  rule_id: string;
  learning_boost: number;
  overrides: {
    description?: string | null;
    category_id?: string | null;
    k_fo?: number | null;
    k_mo?: number | null;
    labor_role_id?: string | null;
    supply_type_id?: string | null;
  };
};

export type SuggestionLearningState = {
  enabled: boolean;
  by_rule_id: Record<string, SuggestionLearningRuleBoost>;
};

export type SuggestionCorrectionPayload = {
  rule_id: string;
  field_name: string;
  original_value: string | null;
  corrected_value: string | null;
  item_title: string;
};

export type SuggestionRuleCreatePayload = {
  name: string;
  match_value: string;
  unit: string | null;
  category_id: string | null;
  k_fo: number | null;
  k_mo: number | null;
  labor_role_id: string | null;
  position: number | null;
  is_active: boolean;
};

export const TRACKED_SUGGESTION_CORRECTION_FIELDS = [
  "description",
  "category_id",
  "k_fo",
  "k_mo",
  "labor_role_id",
  "supply_type_id",
] as const;

export type SuggestionCorrectionFieldName =
  (typeof TRACKED_SUGGESTION_CORRECTION_FIELDS)[number];
export type SuggestionCorrectionValue = string | number | null;
export type SuggestionAppliedValues = Partial<
  Record<SuggestionCorrectionFieldName, SuggestionCorrectionValue>
>;

export type AppliedSuggestionContext = {
  ruleId: string;
  suggestedValues: SuggestionAppliedValues;
  trackedFieldDivergences: Partial<Record<SuggestionCorrectionFieldName, true>>;
};

export type EstimateVirtualizationConfig = {
  enabled?: boolean;
  rowEstimate?: number;
  overscan?: number;
  maxHeight?: number;
  containerHeight?: number;
};

export type EstimateSectionCalculation = Pick<
  ComputeAllSectionTotalsInput,
  | "marginMode"
  | "marginTiers"
  | "globalCoefficient"
  | "discountMode"
  | "discountStepsBp"
  | "calcEngineVersion"
  | "preserveStoredSnapshot"
>;

export type LaborSplitItemFields = {
  h_mo_atelier?: number | null;
  k_mo_atelier?: number | null;
  labor_role_atelier_id?: string | null;
  h_mo_chantier?: number | null;
  k_mo_chantier?: number | null;
  labor_role_chantier_id?: string | null;
};

export type EstimateEditorItemMeta = {
  _pendingCreate?: boolean;
};

type EstimateItemPatchKeys =
  | "title"
  | "aid"
  | "description"
  | "quantity"
  | "unit_price_ht_cents"
  | "tax_rate_bp"
  | "k_fo"
  | "k_fo_manual"
  | "h_mo"
  | "h_mo_majoration"
  | "k_mo"
  | "pu_ht_cents"
  | "labor_role_id"
  | "category_id"
  | "supply_type_id"
  | "product_id"
  | "selected_supplier_price_id"
    | "fo_price_origin"
  // Lot 2, sous-lot 2.6b (A15) : unité du référentiel d'une ligne v3, écrite par une suggestion de ligne.
  | "unit_code";

export type EstimateEditorItemPatch = Partial<
  Pick<
    import("@/types/database").Database["public"]["Tables"]["estimate_items"]["Row"],
    EstimateItemPatchKeys
  >
> &
  LaborSplitItemFields;
