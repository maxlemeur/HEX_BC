"use client";

import {
  useCallback,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import { type SuggestionPreview } from "@/components/estimates/components/EstimateSuggestionRow";
import { type SuggestionLearningState } from "@/components/estimates/estimate-editor-table-types";
import { sendEstimateSuggestionRuleFeedback } from "@/lib/estimates/client";
import { rankSuggestions } from "@/lib/estimates/suggestion-scoring";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];
type EstimateCategory = Database["public"]["Tables"]["estimate_categories"]["Row"];
type SupplyType = Database["public"]["Tables"]["supply_types"]["Row"];
type LaborRole = Database["public"]["Tables"]["labor_roles"]["Row"];
type SuggestionRule =
  Database["public"]["Tables"]["estimate_suggestion_rules"]["Row"];

const SUGGESTION_SCORE_MAX = 5;

function toSuggestionUsageCount(rule: SuggestionRule | Record<string, unknown>) {
  const raw = rule["usage_count"];
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function toSuggestionLastUsedAt(rule: SuggestionRule | Record<string, unknown>) {
  const raw = rule["last_used_at"];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function addDismissedSuggestion(
  previous: Record<string, Record<string, boolean>>,
  itemId: string,
  ruleId: string
) {
  const current = previous[itemId];
  if (current?.[ruleId]) return previous;
  return {
    ...previous,
    [itemId]: {
      ...(current ?? {}),
      [ruleId]: true,
    },
  };
}

function toFiniteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toSuggestionLearningBoost(rule: SuggestionRule | Record<string, unknown>) {
  const record = rule as Record<string, unknown>;
  return toFiniteNumber(record.learning_boost, 0);
}

function toSuggestionSupplyTypeId(rule: SuggestionRule | Record<string, unknown>) {
  const record = rule as Record<string, unknown>;
  const value = record.supply_type_id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function hasSuggestionLearningEnrichment(
  rule: SuggestionRule | Record<string, unknown>
) {
  if (toSuggestionLearningBoost(rule) > 0) return true;
  const record = rule as Record<string, unknown>;
  return record.learning_overrides_applied === true;
}

type UseEstimateEditorSuggestionsParams = {
  items: EstimateItem[];
  visibleLineIds: Set<string>;
  isReadOnly: boolean;
  suggestionRules: SuggestionRule[];
  learningState?: SuggestionLearningState;
  categoryById: Map<string, EstimateCategory>;
  supplyTypeById: Map<string, SupplyType>;
  supplyTypeByLowerName: Map<string, SupplyType>;
  roleById: Map<string, LaborRole>;
  setUnitDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  setSupplyTypeDrafts: Dispatch<SetStateAction<Record<string, string>>>;
};

export function useEstimateEditorSuggestions({
  items,
  visibleLineIds,
  isReadOnly,
  suggestionRules,
  learningState,
  categoryById,
  supplyTypeById,
  supplyTypeByLowerName,
  roleById,
  setUnitDrafts,
  setSupplyTypeDrafts,
}: UseEstimateEditorSuggestionsParams) {
  const [dismissedSuggestionsByItemId, setDismissedSuggestionsByItemId] =
    useState<Record<string, Record<string, boolean>>>({});
  const [selectedSuggestionByItemId, setSelectedSuggestionByItemId] = useState<
    Record<string, string>
  >({});
  const [feedbackPendingByItemId, setFeedbackPendingByItemId] = useState<
    Record<string, boolean>
  >({});
  const [usageCountOverrideByRuleId, setUsageCountOverrideByRuleId] = useState<
    Record<string, number>
  >({});
  const [lastUsedAtOverrideByRuleId, setLastUsedAtOverrideByRuleId] = useState<
    Record<string, string>
  >({});

  const isSuggestionLearningEnabled = learningState?.enabled === true;
  const learningByRuleId = useMemo(
    () => (isSuggestionLearningEnabled ? learningState.by_rule_id : {}),
    [isSuggestionLearningEnabled, learningState]
  );

  const orderedRules = useMemo(
    () => [...suggestionRules].sort((a, b) => a.position - b.position),
    [suggestionRules]
  );

  const scoringRules = useMemo(() => {
    return orderedRules.map((rule) => {
      const enrichedRule: SuggestionRule & Record<string, unknown> = { ...rule };
      const learningBoost = learningByRuleId[rule.id];
      const usageCountOverride = usageCountOverrideByRuleId[rule.id];
      const lastUsedAtOverride = lastUsedAtOverrideByRuleId[rule.id];

      if (learningBoost) {
        enrichedRule.learning_boost = Math.max(learningBoost.learning_boost, 0);
        enrichedRule.learning_overrides_applied = true;

        const overrides = learningBoost.overrides;
        if (overrides.description !== undefined) {
          enrichedRule.unit = overrides.description;
        }
        if (overrides.category_id !== undefined) {
          enrichedRule.category_id = overrides.category_id;
        }
        if (overrides.k_fo !== undefined) {
          enrichedRule.k_fo = overrides.k_fo;
        }
        if (overrides.k_mo !== undefined) {
          enrichedRule.k_mo = overrides.k_mo;
        }
        if (overrides.labor_role_id !== undefined) {
          enrichedRule.labor_role_id = overrides.labor_role_id;
        }
        if (overrides.supply_type_id !== undefined) {
          enrichedRule.supply_type_id = overrides.supply_type_id;
        }
      }

      if (usageCountOverride !== undefined) {
        enrichedRule.usage_count = usageCountOverride;
      }
      if (lastUsedAtOverride !== undefined) {
        enrichedRule.last_used_at = lastUsedAtOverride;
      }

      return enrichedRule;
    });
  }, [
    lastUsedAtOverrideByRuleId,
    learningByRuleId,
    orderedRules,
    usageCountOverrideByRuleId,
  ]);

  const buildSuggestionParts = useCallback(
    (rule: SuggestionRule) => {
      const parts: string[] = [];
      if (rule.category_id) {
        const category = categoryById.get(rule.category_id);
        parts.push(`Type FO: ${category?.name ?? "Catégorie inconnue"}`);
      }
      const supplyTypeId = toSuggestionSupplyTypeId(rule);
      if (supplyTypeId) {
        const supplyType = supplyTypeById.get(supplyTypeId);
        parts.push(`Materiau: ${supplyType?.name ?? "Type inconnu"}`);
      }
      if (rule.unit) parts.push(`Unite: ${rule.unit}`);
      if (rule.k_fo !== null) parts.push(`K FO: ${rule.k_fo}`);
      if (rule.k_mo !== null) parts.push(`K MO: ${rule.k_mo}`);
      if (rule.labor_role_id) {
        const role = roleById.get(rule.labor_role_id);
        parts.push(`Role MO: ${role?.name ?? "Role inconnu"}`);
      }
      return parts;
    },
    [categoryById, roleById, supplyTypeById]
  );

  const suggestionsByItemId = useMemo(() => {
    const map = new Map<string, SuggestionPreview[]>();
    if (isReadOnly) return map;

    items.forEach((item) => {
      if (item.item_type !== "line") return;
      if (!visibleLineIds.has(item.id)) return;

      const dismissedRuleIds = dismissedSuggestionsByItemId[item.id] ?? {};
      const rankedSuggestions = rankSuggestions({
        title: item.title,
        rules: scoringRules,
        limit: SUGGESTION_SCORE_MAX,
      });

      const visibleSuggestions = rankedSuggestions
        .filter((suggestion) => !dismissedRuleIds[suggestion.rule.id])
        .map((suggestion) => {
          const rule = suggestion.rule as SuggestionRule & Record<string, unknown>;
          const learningBoost = toSuggestionLearningBoost(rule);
          const parts = buildSuggestionParts(rule);
          return {
            rule,
            score: suggestion.score,
            matchKind: suggestion.matchKind,
            matchedKeyword: suggestion.matchedKeyword,
            usageCount: suggestion.usageCount,
            learningBoost,
            isLearned: hasSuggestionLearningEnrichment(rule),
            parts,
          } satisfies SuggestionPreview;
        })
        .filter((suggestion) => suggestion.parts.length > 0);

      if (visibleSuggestions.length > 0) {
        map.set(item.id, visibleSuggestions);
      }
    });

    return map;
  }, [
    buildSuggestionParts,
    dismissedSuggestionsByItemId,
    isReadOnly,
    items,
    scoringRules,
    visibleLineIds,
  ]);

  const sendSuggestionFeedback = useCallback(
    async (
      item: EstimateItem,
      suggestion: SuggestionPreview,
      feedback: "accept" | "reject"
    ) => {
      if (item.item_type !== "line") return;

      setFeedbackPendingByItemId((prev) => ({ ...prev, [item.id]: true }));

      const optimisticUsageCount =
        feedback === "accept" ? suggestion.usageCount + 1 : suggestion.usageCount;
      const optimisticLastUsedAt =
        feedback === "accept" ? new Date().toISOString() : null;

      if (feedback === "accept") {
        setUsageCountOverrideByRuleId((prev) => ({
          ...prev,
          [suggestion.rule.id]: optimisticUsageCount,
        }));
        if (optimisticLastUsedAt) {
          setLastUsedAtOverrideByRuleId((prev) => ({
            ...prev,
            [suggestion.rule.id]: optimisticLastUsedAt,
          }));
        }
      }

      try {
        const updatedRule = await sendEstimateSuggestionRuleFeedback(
          item.version_id,
          suggestion.rule.id,
          feedback
        );

        if (!updatedRule || feedback !== "accept") {
          return;
        }

        setUsageCountOverrideByRuleId((prev) => ({
          ...prev,
          [suggestion.rule.id]: toSuggestionUsageCount(updatedRule),
        }));

        const lastUsedAt = toSuggestionLastUsedAt(updatedRule);
        if (lastUsedAt) {
          setLastUsedAtOverrideByRuleId((prev) => ({
            ...prev,
            [suggestion.rule.id]: lastUsedAt,
          }));
        }
      } catch (error) {
        console.error(
          "Impossible d'enregistrer le feedback de suggestion.",
          error
        );

        if (feedback === "accept") {
          setUsageCountOverrideByRuleId((prev) => ({
            ...prev,
            [suggestion.rule.id]: suggestion.usageCount,
          }));
          const previousLastUsedAt = toSuggestionLastUsedAt(suggestion.rule);
          setLastUsedAtOverrideByRuleId((prev) => {
            const next = { ...prev };
            if (previousLastUsedAt) {
              next[suggestion.rule.id] = previousLastUsedAt;
            } else {
              delete next[suggestion.rule.id];
            }
            return next;
          });
        }
      } finally {
        setFeedbackPendingByItemId((prev) => {
          if (!prev[item.id]) return prev;
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
      }
    },
    []
  );

  const dismissSuggestion = useCallback(
    (item: EstimateItem, suggestion: SuggestionPreview) => {
      if (item.item_type !== "line") return;
      setDismissedSuggestionsByItemId((prev) =>
        addDismissedSuggestion(prev, item.id, suggestion.rule.id)
      );
      void sendSuggestionFeedback(item, suggestion, "reject");
    },
    [sendSuggestionFeedback]
  );

  const markSuggestionDismissed = useCallback((itemId: string, ruleId: string) => {
    setDismissedSuggestionsByItemId((prev) =>
      addDismissedSuggestion(prev, itemId, ruleId)
    );
  }, []);

  const applySuggestionDrafts = useCallback(
    (itemId: string, suggestion: SuggestionPreview) => {
      const unitValue = suggestion.rule.unit?.trim();
      if (unitValue) {
        setUnitDrafts((prev) => ({ ...prev, [itemId]: unitValue }));
      }

      const explicitSupplyTypeId = toSuggestionSupplyTypeId(suggestion.rule);
      if (explicitSupplyTypeId) {
        setSupplyTypeDrafts((prev) => ({
          ...prev,
          [itemId]: supplyTypeById.get(explicitSupplyTypeId)?.name ?? "",
        }));
      }

      if (suggestion.rule.category_id) {
        const category = categoryById.get(suggestion.rule.category_id);
        if (category) {
          const fallbackSupplyTypeName =
            explicitSupplyTypeId
              ? (supplyTypeById.get(explicitSupplyTypeId)?.name ?? category.name)
              : category.name;

          if (!explicitSupplyTypeId) {
            const matchedSupplyType = supplyTypeByLowerName.get(
              category.name.toLowerCase()
            );
            if (matchedSupplyType) {
              setSupplyTypeDrafts((prev) => ({
                ...prev,
                [itemId]: matchedSupplyType.name,
              }));
              return;
            }
          }

          setSupplyTypeDrafts((prev) => ({
            ...prev,
            [itemId]: fallbackSupplyTypeName,
          }));
        }
      }
    },
    [
      categoryById,
      setSupplyTypeDrafts,
      setUnitDrafts,
      supplyTypeById,
      supplyTypeByLowerName,
    ]
  );

  return {
    feedbackPendingByItemId,
    selectedSuggestionByItemId,
    setSelectedSuggestionByItemId,
    suggestionsByItemId,
    sendSuggestionFeedback,
    dismissSuggestion,
    markSuggestionDismissed,
    applySuggestionDrafts,
  };
}
