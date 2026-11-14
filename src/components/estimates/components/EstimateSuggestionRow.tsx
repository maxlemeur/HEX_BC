"use client";

import { memo, useId, useState } from "react";

import { type SuggestionMatchKind } from "@/lib/estimates/suggestion-scoring";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];
type SuggestionRule =
  Database["public"]["Tables"]["estimate_suggestion_rules"]["Row"];

const SUGGESTION_MATCH_LABELS: Record<SuggestionMatchKind, string> = {
  exact: "exacte",
  partial: "partielle",
  fuzzy: "approchée",
};

const formatScore = (score: number) =>
  score.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const detailsId = useId();
  if (suggestions.length === 0) return null;

  const selectedSuggestion =
    suggestions.find((suggestion) => suggestion.rule.id === selectedSuggestionRuleId) ??
    suggestions[0];
  const otherRuleCount = suggestions.length - 1;

  return (
    <div className="estimate-row estimate-row--suggestion">
      <div className="estimate-cell estimate-cell--suggestion">
        <div className="estimate-suggestion">
          <div className="estimate-suggestion__title">Suggestion</div>
          <div className="estimate-suggestion__rule">
            {selectedSuggestion.rule.name}
            {selectedSuggestion.isLearned ? (
              <span className="status-badge status-confirmed ml-2">Appris</span>
            ) : null}
          </div>
          {/* Ce que « Appliquer » renseigne sur la ligne, dans les mots de la grille. */}
          <div className="estimate-suggestion__list">
            {selectedSuggestion.parts.map((part) => (
              <span key={part} className="estimate-suggestion__item">
                {part}
              </span>
            ))}
          </div>
          <button
            type="button"
            className="estimate-suggestion__details-toggle"
            aria-expanded={isDetailsOpen}
            aria-controls={detailsId}
            onClick={() => setIsDetailsOpen((open) => !open)}
          >
            {otherRuleCount > 0
              ? `Détails et ${otherRuleCount} autre${otherRuleCount > 1 ? "s" : ""} règle${otherRuleCount > 1 ? "s" : ""}`
              : "Détails"}
          </button>
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
          {/* Le choix d'une autre règle et les critères du classement restent à un clic, hors de la lecture courante.
              Le bloc reste dans le flux de la ligne : un panneau flottant serait rogné par le défilement du tableau. */}
          <div
            id={detailsId}
            className="estimate-suggestion__details-body"
            hidden={!isDetailsOpen}
          >
            <label className="estimate-suggestion__choice">
              <span>Règle proposée</span>
              <select
                className="estimate-input estimate-select"
                value={selectedSuggestion.rule.id}
                onChange={(event) =>
                  onSelectSuggestionRule(item.id, event.target.value)
                }
                disabled={isReadOnly || isFeedbackPending}
              >
                {suggestions.map((suggestion) => (
                  <option key={suggestion.rule.id} value={suggestion.rule.id}>
                    {suggestion.rule.name} (score {formatScore(suggestion.score)})
                    {suggestion.isLearned ? " - Appris" : ""}
                  </option>
                ))}
              </select>
            </label>
            <p className="estimate-suggestion__reason">
              {`Correspondance ${SUGGESTION_MATCH_LABELS[selectedSuggestion.matchKind]} sur le mot-clé «\u00a0${selectedSuggestion.matchedKeyword}\u00a0», ${
                selectedSuggestion.usageCount > 0
                  ? `règle déjà appliquée ${selectedSuggestion.usageCount}\u00a0fois`
                  : "règle jamais appliquée"
              } (score ${formatScore(selectedSuggestion.score)}).`}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
});

EstimateSuggestionRow.displayName = "EstimateSuggestionRow";
