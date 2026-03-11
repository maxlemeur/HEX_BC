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
