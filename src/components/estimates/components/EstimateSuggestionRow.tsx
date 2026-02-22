"use client";

import { memo } from "react";

import { type SuggestionMatchKind } from "@/lib/estimates/suggestion-scoring";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];
type SuggestionRule =
  Database["public"]["Tables"]["estimate_suggestion_rules"]["Row"];

const SUGGESTION_MATCH_LABELS: Record<SuggestionMatchKind, string> = {
  exact: "exact",
  partial: "partiel",
  fuzzy: "fuzzy",
};

export type SuggestionPreview = {
  rule: SuggestionRule;
  score: number;
  matchKind: SuggestionMatchKind;
  matchedKeyword: string;
  usageCount: number;
  learningBoost?: number;
  isLearned?: boolean;
  parts: string[];
};

export type EstimateSuggestionRowProps = {
  item: EstimateItem;
  suggestions: SuggestionPreview[];
  selectedSuggestionRuleId?: string;
  isReadOnly: boolean;
  isFeedbackPending: boolean;
  onSelectSuggestionRule: (itemId: string, ruleId: string) => void;
  onApplySuggestion: (item: EstimateItem, suggestion: SuggestionPreview) => void;
  onDismissSuggestion: (item: EstimateItem, suggestion: SuggestionPreview) => void;
};

export const EstimateSuggestionRow = memo(function EstimateSuggestionRow({
  item,
  suggestions,
  selectedSuggestionRuleId,
  isReadOnly,
  isFeedbackPending,
  onSelectSuggestionRule,
  onApplySuggestion,
  onDismissSuggestion,
}: EstimateSuggestionRowProps) {
  if (suggestions.length === 0) return null;

  const selectedSuggestion =
    suggestions.find((suggestion) => suggestion.rule.id === selectedSuggestionRuleId) ??
    suggestions[0];

  return (
    <div className="estimate-row estimate-row--suggestion">
      <div className="estimate-cell estimate-cell--suggestion">
        <div className="estimate-suggestion">
          <div className="estimate-suggestion__title">Suggestions de chiffrage (Top 5)</div>
          <select
            className="estimate-input estimate-select"
            value={selectedSuggestion.rule.id}
            style={{ width: "min(560px, 100%)" }}
            onChange={(event) =>
              onSelectSuggestionRule(item.id, event.target.value)
            }
            disabled={isReadOnly || isFeedbackPending}
          >
            {suggestions.map((suggestion) => (
              <option key={suggestion.rule.id} value={suggestion.rule.id}>
                {suggestion.rule.name} (score {suggestion.score.toFixed(2)})
                {suggestion.isLearned ? " - Appris" : ""}
              </option>
            ))}
          </select>
          <div className="estimate-suggestion__rule">
            {selectedSuggestion.rule.name}
            {selectedSuggestion.isLearned ? (
              <span className="status-badge status-confirmed ml-2">Appris</span>
            ) : null}
          </div>
          <div className="estimate-suggestion__list">
            <span className="estimate-suggestion__item">
              Score: {selectedSuggestion.score.toFixed(2)}
            </span>
            <span className="estimate-suggestion__item">
              Match: {SUGGESTION_MATCH_LABELS[selectedSuggestion.matchKind]}
            </span>
            <span className="estimate-suggestion__item">
              Mot-cle: {selectedSuggestion.matchedKeyword}
            </span>
            <span className="estimate-suggestion__item">
              Usage: {selectedSuggestion.usageCount}
            </span>
            {selectedSuggestion.parts.map((part) => (
              <span key={part} className="estimate-suggestion__item">
                {part}
              </span>
            ))}
          </div>
          <div className="estimate-suggestion__actions">
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={() => onApplySuggestion(item, selectedSuggestion)}
              disabled={isReadOnly || isFeedbackPending}
            >
              Appliquer
            </button>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => onDismissSuggestion(item, selectedSuggestion)}
              disabled={isReadOnly || isFeedbackPending}
            >
              Ignorer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

EstimateSuggestionRow.displayName = "EstimateSuggestionRow";
