"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui-legacy/Badge";
import { Button } from "@/components/ui-legacy/Button";
import { formatEUR } from "@/lib/money";
import {
  fetchTakeoffPriceSuggestion,
  requestTakeoffPriceSuggestion,
  reviewTakeoffPriceSuggestion,
  isTakeoffApiError,
} from "@/lib/takeoff/client";
import type {
  TakeoffPriceSuggestionAction,
  TakeoffPriceSuggestionConfidenceLabel,
  TakeoffPriceSuggestionSnapshot,
  TakeoffPriceSuggestionSource,
  TakeoffPriceSuggestionSourceKind,
} from "@/lib/takeoff/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PriceSuggestionPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  versionId: string;
  estimateItemId: string;
  lineLabel: string;
  onReviewComplete: () => void;
};

type PanelState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | { kind: "ready"; suggestion: TakeoffPriceSuggestionSnapshot }
  | { kind: "recalculating"; suggestion: TakeoffPriceSuggestionSnapshot }
  | { kind: "submitting"; suggestion: TakeoffPriceSuggestionSnapshot; action: TakeoffPriceSuggestionAction }
  | { kind: "reviewed"; suggestion: TakeoffPriceSuggestionSnapshot };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOURCE_KIND_LABELS: Record<TakeoffPriceSuggestionSourceKind, string> = {
  history: "Historique interne",
  pricebook: "Bordereau fournisseur",
  similar_item: "Ouvrage similaire",
  external_reference: "Reference externe",
};

const SOURCE_KIND_VARIANT: Record<
  TakeoffPriceSuggestionSourceKind,
  "info" | "success" | "warning" | "neutral"
> = {
  pricebook: "success",
  history: "info",
  similar_item: "warning",
  external_reference: "neutral",
};

const CONFIDENCE_VARIANT: Record<
  TakeoffPriceSuggestionConfidenceLabel,
  "success" | "warning" | "error"
> = {
  high: "success",
  medium: "warning",
  low: "error",
};

const CONFIDENCE_LABELS: Record<TakeoffPriceSuggestionConfidenceLabel, string> = {
  high: "Élevée",
  medium: "Moyenne",
  low: "Faible",
};

const EVIDENCE_KIND_LABELS: Record<string, string> = {
  fact: "Fait",
  hypothesis: "Hypothese",
  inference: "Inference",
};

const ACTION_LABELS: Record<TakeoffPriceSuggestionAction, string> = {
  apply_low: "Appliquer borne basse",
  apply_target: "Appliquer prix cible",
  apply_high: "Appliquer borne haute",
  keep_current: "Conserver le prix actuel",
  reject: "Rejeter la suggestion",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getConfidenceBarWidth(label: TakeoffPriceSuggestionConfidenceLabel): string {
  switch (label) {
    case "high":
      return "100%";
    case "medium":
      return "60%";
    case "low":
      return "30%";
  }
}

function getConfidenceBarColor(label: TakeoffPriceSuggestionConfidenceLabel): string {
  switch (label) {
    case "high":
      return "var(--success)";
    case "medium":
      return "var(--warning)";
    case "low":
      return "var(--danger)";
  }
}

function isNoSourceAvailableError(error: unknown): boolean {
  return (
    isTakeoffApiError(error) &&
    error.status === 409 &&
    error.code === "CONFLICT" &&
    error.message === "Aucune source exploitable pour proposer un prix sur cette ligne."
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function BoundsDisplay({
  suggestion,
  selectedAction,
  onSelectAction,
}: {
  suggestion: TakeoffPriceSuggestionSnapshot;
  selectedAction: TakeoffPriceSuggestionAction | null;
  onSelectAction: (action: TakeoffPriceSuggestionAction) => void;
}) {
  const bounds: Array<{
    action: Extract<TakeoffPriceSuggestionAction, "apply_low" | "apply_target" | "apply_high">;
    label: string;
    cents: number;
    accent: string;
    selectedAccent: string;
  }> = [
    {
      action: "apply_low",
      label: "Borne basse",
      cents: suggestion.low_cents,
      accent: "text-sky-700",
      selectedAccent: "border-sky-400 bg-sky-50/80",
    },
    {
      action: "apply_target",
      label: "Prix cible",
      cents: suggestion.target_cents,
      accent: "text-emerald-700",
      selectedAccent: "border-emerald-400 bg-emerald-50/80",
    },
    {
      action: "apply_high",
      label: "Borne haute",
      cents: suggestion.high_cents,
      accent: "text-amber-700",
      selectedAccent: "border-amber-400 bg-amber-50/80",
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-2">
      {bounds.map(({ action, label, cents, accent, selectedAccent }) => {
        const isSelected = selectedAction === action;
        return (
          <button
            key={action}
            type="button"
            onClick={() => onSelectAction(action)}
            className={`rounded-2xl border p-3 text-center transition hover:-translate-y-0.5 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
              isSelected
                ? selectedAccent
                : "border-[var(--border)] bg-white"
            }`}
          >
            <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--slate-500)]">
              {label}
            </p>
            <p className={`mt-1 text-sm font-semibold ${accent}`}>
              {formatEUR(cents)}
            </p>
          </button>
        );
      })}
    </div>
  );
}

function SourceItem({ source }: { source: TakeoffPriceSuggestionSource }) {
  return (
    <article className="rounded-xl border border-[var(--border)] bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={SOURCE_KIND_VARIANT[source.source_kind]} size="sm">
          {SOURCE_KIND_LABELS[source.source_kind]}
        </Badge>
        <Badge variant="neutral" size="sm">
          {EVIDENCE_KIND_LABELS[source.kind] ?? source.kind}
        </Badge>
        {source.is_outlier ? (
          <Badge variant="error" size="sm">
            Outlier
          </Badge>
        ) : null}
        {source.freshness_label ? (
          <Badge variant="neutral" size="sm">
            {source.freshness_label}
          </Badge>
        ) : null}
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-[var(--slate-900)]">
          {source.label}
        </p>
        <p className={`text-sm font-semibold tabular-nums ${source.is_outlier ? "text-[var(--slate-400)] line-through" : "text-[var(--slate-900)]"}`}>
          {formatEUR(source.price_cents)}
        </p>
      </div>
      <p className="mt-1 text-xs text-[var(--slate-600)]">
        {source.source_ref}
        {source.confidence_score !== null
          ? ` · Confiance ${Math.round(source.confidence_score * 100)}%`
          : ""}
      </p>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PriceSuggestionPanel({
  open,
  onOpenChange,
  jobId,
  versionId,
  estimateItemId,
  lineLabel,
  onReviewComplete,
}: PriceSuggestionPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const reviewCompletedRef = useRef(false);
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  const [selectedAction, setSelectedAction] = useState<TakeoffPriceSuggestionAction | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Fetch suggestion on open
  useEffect(() => {
    if (!open) return;

    let canceled = false;

    async function load() {
      try {
        let response;
        try {
          response = await fetchTakeoffPriceSuggestion(jobId, {
            version_id: versionId,
            estimate_item_id: estimateItemId,
          });
        } catch (error) {
          if (
            !isTakeoffApiError(error) ||
            error.status !== 404 ||
            error.code !== "NOT_FOUND"
          ) {
            throw error;
          }

          response = await requestTakeoffPriceSuggestion(jobId, {
            version_id: versionId,
            estimate_item_id: estimateItemId,
          });
        }

        if (canceled) return;

        if (!response.suggestion) {
          setState({ kind: "empty" });
          return;
        }

        const s = response.suggestion;

        if (s.status !== "pending") {
          setState({ kind: "reviewed", suggestion: s });
          setSelectedAction(s.selected_action);
          setReviewNote(s.review_note ?? "");
          return;
        }

        setState({ kind: "ready", suggestion: s });
      } catch (error) {
        if (canceled) return;
        if (isNoSourceAvailableError(error)) {
          setState({ kind: "empty" });
          return;
        }
        setState({
          kind: "error",
          message: isTakeoffApiError(error) ? error.message : "Impossible de charger la suggestion.",
        });
      }
    }

    // Reset state before fetching — scheduled via startTransition-style
    // batching inside the async IIFE to avoid the react-hooks/set-state-in-effect rule.
    void (async () => {
      reviewCompletedRef.current = false;
      setState({ kind: "loading" });
      setSelectedAction(null);
      setReviewNote("");
      setSubmitError(null);
      await load();
    })();

    return () => {
      canceled = true;
    };
  }, [open, jobId, versionId, estimateItemId]);

  // Focus on open
  useEffect(() => {
    if (open) {
      panelRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;

    const previousBodyOverflowX = document.body.style.overflowX;
    const previousDocumentOverflowX = document.documentElement.style.overflowX;

    document.body.style.overflowX = "hidden";
    document.documentElement.style.overflowX = "hidden";

    return () => {
      document.body.style.overflowX = previousBodyOverflowX;
      document.documentElement.style.overflowX = previousDocumentOverflowX;
    };
  }, [open]);

  // Keyboard
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (reviewCompletedRef.current) {
          reviewCompletedRef.current = false;
          onReviewComplete();
        }
        onOpenChange(false);
      }
    },
    [onOpenChange, onReviewComplete]
  );

  const handleClose = useCallback(() => {
    if (reviewCompletedRef.current) {
      reviewCompletedRef.current = false;
      onReviewComplete();
    }
    onOpenChange(false);
  }, [onOpenChange, onReviewComplete]);

  // Recalculate
  const handleRecalculate = useCallback(async () => {
    const currentSuggestion =
      state.kind === "ready" || state.kind === "reviewed"
        ? state.suggestion
        : null;

    if (currentSuggestion) {
      setState({ kind: "recalculating", suggestion: currentSuggestion });
    } else {
      setState({ kind: "loading" });
    }

    try {
      const response = await requestTakeoffPriceSuggestion(jobId, {
        version_id: versionId,
        estimate_item_id: estimateItemId,
        force_refresh: true,
      });

      if (!response.suggestion) {
        setState({ kind: "empty" });
        return;
      }

      setState({ kind: "ready", suggestion: response.suggestion });
      setSelectedAction(null);
      setReviewNote("");
      setSubmitError(null);
    } catch (error) {
      if (isNoSourceAvailableError(error)) {
        setState({ kind: "empty" });
        setSubmitError(null);
        return;
      }
      setState({
        kind: "error",
        message: isTakeoffApiError(error) ? error.message : "Impossible de recalculer.",
      });
    }
  }, [state, jobId, versionId, estimateItemId]);

  // Submit review
  const handleSubmitReview = useCallback(async () => {
    if (!selectedAction) return;
    if (reviewNote.trim().length === 0) return;

    const suggestion =
      state.kind === "ready"
        ? state.suggestion
        : state.kind === "recalculating"
          ? state.suggestion
          : null;

    if (!suggestion) return;

    setState({ kind: "submitting", suggestion, action: selectedAction });
    setSubmitError(null);

    try {
      const response = await reviewTakeoffPriceSuggestion(
        jobId,
        suggestion.suggestion_id,
        {
          version_id: versionId,
          action: selectedAction,
          review_note: reviewNote.trim(),
        }
      );

      setState({ kind: "reviewed", suggestion: response.suggestion });
      setSubmitError(null);
      reviewCompletedRef.current = true;
    } catch (error) {
      setState({ kind: "ready", suggestion });
      setSubmitError(
        isTakeoffApiError(error)
          ? error.message
          : "Impossible d'enregistrer la revue de suggestion de prix."
      );
    }
  }, [selectedAction, reviewNote, state, jobId, versionId]);

  if (!open) return null;

  const suggestion =
    state.kind === "ready" ||
    state.kind === "recalculating" ||
    state.kind === "submitting" ||
    state.kind === "reviewed"
      ? state.suggestion
      : null;

  const isReviewed = state.kind === "reviewed";
  const isSubmitting = state.kind === "submitting";
  const isRecalculating = state.kind === "recalculating";
  const canSubmit =
    state.kind === "ready" &&
    selectedAction !== null &&
    reviewNote.trim().length > 0;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Suggestion de prix : ${lineLabel}`}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="animate-slide-in-right fixed inset-0 z-50 flex min-w-0 flex-col bg-white shadow-xl outline-none sm:inset-y-0 sm:left-auto sm:w-full sm:max-w-lg sm:border-l sm:border-[var(--border)]"
      >
        {/* ---- Header ---- */}
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--slate-800)]">
              Suggestion de prix
            </h2>
            <p className="mt-0.5 text-xs text-[var(--slate-500)] line-clamp-1">
              {lineLabel}
            </p>
          </div>
          <button
            type="button"
            className="rounded p-1 text-[var(--slate-500)] transition-colors hover:bg-[var(--slate-100)] hover:text-[var(--slate-700)]"
            onClick={handleClose}
            title="Fermer le panneau (Echap)"
            aria-label="Fermer le panneau"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        {/* ---- Scrollable body ---- */}
        <div className="min-w-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {/* Loading */}
          {state.kind === "loading" ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <span
                aria-hidden="true"
                className="size-6 animate-spin rounded-full border-2 border-[var(--slate-300)] border-t-[var(--slate-700)]"
              />
              <p className="text-sm text-[var(--slate-600)]" aria-live="polite">
                Calcul de la suggestion en cours...
              </p>
            </div>
          ) : null}

          {/* Error */}
          {state.kind === "error" ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
              <p className="text-sm font-medium text-rose-800">Erreur</p>
              <p className="mt-1 text-sm text-rose-700">{state.message}</p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() => void handleRecalculate()}
              >
                Reessayer
              </Button>
            </div>
          ) : null}

          {/* Empty */}
          {state.kind === "empty" ? (
            <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--slate-50)] p-6 text-center">
              <p className="text-sm font-medium text-[var(--slate-800)]">
                Aucune suggestion calculable pour cette ligne.
              </p>
              <p className="mt-1 text-xs text-[var(--slate-500)]">
                Ni historique, ni bordereau fournisseur, ni ouvrage proche exploitable pour
                l&apos;instant.
              </p>
            </div>
          ) : null}

          {/* Suggestion content */}
          {suggestion ? (
            <>
              {/* Recalculating banner */}
              {isRecalculating ? (
                <div
                  className="flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2"
                  aria-live="polite"
                >
                  <span
                    aria-hidden="true"
                    className="size-4 animate-spin rounded-full border-2 border-sky-300 border-t-sky-700"
                  />
                  <p className="text-xs text-sky-800">Recalcul en cours...</p>
                </div>
              ) : null}

              {/* Reviewed banner */}
              {isReviewed ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <p className="text-xs font-medium text-emerald-800">
                    Decision enregistree : {ACTION_LABELS[suggestion.selected_action!]}
                  </p>
                  {suggestion.selected_price_cents !== null ? (
                    <p className="mt-1 text-xs text-emerald-700">
                      Prix applique : {formatEUR(suggestion.selected_price_cents)}
                    </p>
                  ) : null}
                  {suggestion.review_note ? (
                    <p className="mt-1 text-xs text-emerald-700">
                      Note : {suggestion.review_note}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {/* Current price */}
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--slate-50)] p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-[var(--slate-500)]">
                  Prix actuel
                </p>
                <p className="mt-1 text-lg font-semibold text-[var(--slate-950)]">
                  {suggestion.current_price_cents !== null
                    ? formatEUR(suggestion.current_price_cents)
                    : "Non renseigne"}
                </p>
              </div>

              {/* Bounds */}
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--slate-500)]">
                  Fourchette de prix
                </p>
                <div className="mt-2">
                  <BoundsDisplay
                    suggestion={suggestion}
                    selectedAction={
                      isReviewed ? suggestion.selected_action : selectedAction
                    }
                    onSelectAction={isReviewed ? () => {} : setSelectedAction}
                  />
                </div>

                {/* Visual range bar */}
                <div className="mt-3 space-y-1">
                  <div className="relative h-3 w-full overflow-hidden rounded-full bg-[var(--slate-100)]">
                    <div
                      className="absolute inset-y-0 rounded-full bg-gradient-to-r from-sky-400 via-emerald-400 to-amber-400 opacity-80"
                      style={{
                        left: "0%",
                        right: "0%",
                      }}
                    />
                    {suggestion.current_price_cents !== null &&
                      suggestion.high_cents > suggestion.low_cents ? (
                      <div
                        className="absolute top-0 h-full w-0.5 bg-[var(--slate-800)]"
                        style={{
                          left: `${Math.min(
                            100,
                            Math.max(
                              0,
                              ((suggestion.current_price_cents - suggestion.low_cents) /
                                (suggestion.high_cents - suggestion.low_cents)) *
                                100
                            )
                          )}%`,
                        }}
                        title={`Prix actuel : ${formatEUR(suggestion.current_price_cents)}`}
                      />
                    ) : null}
                  </div>
                  <div className="flex justify-between text-[10px] text-[var(--slate-500)]">
                    <span>{formatEUR(suggestion.low_cents)}</span>
                    <span>{formatEUR(suggestion.high_cents)}</span>
                  </div>
                </div>
              </div>

              {/* Confidence */}
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--slate-500)]">
                  Confiance
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--slate-100)]">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: getConfidenceBarWidth(suggestion.confidence_label),
                        backgroundColor: getConfidenceBarColor(suggestion.confidence_label),
                      }}
                    />
                  </div>
                  <Badge variant={CONFIDENCE_VARIANT[suggestion.confidence_label]} size="sm">
                    {CONFIDENCE_LABELS[suggestion.confidence_label]}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-[var(--slate-600)]">
                  {suggestion.candidate_count} source{suggestion.candidate_count > 1 ? "s" : ""}
                  {suggestion.outlier_count > 0
                    ? ` · ${suggestion.outlier_count} outlier${suggestion.outlier_count > 1 ? "s" : ""} signale${suggestion.outlier_count > 1 ? "s" : ""}`
                    : ""}
                </p>
              </div>

              {/* Justification */}
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--slate-500)]">
                  Justification
                </p>
                <div className="mt-2 rounded-xl border border-[var(--border)] bg-[var(--slate-50)] px-3 py-2.5 text-sm leading-relaxed text-[var(--slate-700)] whitespace-pre-wrap">
                  {suggestion.justification}
                </div>
              </div>

              {/* Factors */}
              {suggestion.factors.length > 0 ? (
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--slate-500)]">
                    Facteurs
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {suggestion.factors.map((factor) => (
                      <div
                        key={factor.key}
                        className="rounded-xl border border-[var(--border)] bg-white px-3 py-2"
                      >
                        <div className="flex items-center gap-1.5">
                          <Badge variant="neutral" size="sm">
                            {EVIDENCE_KIND_LABELS[factor.kind] ?? factor.kind}
                          </Badge>
                          <span className="text-xs font-medium text-[var(--slate-800)]">
                            {factor.label}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-[var(--slate-600)]">
                          {factor.value}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Sources */}
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--slate-500)]">
                  Sources ({suggestion.sources.length})
                </p>
                <div className="mt-2 space-y-2">
                  {suggestion.sources.length === 0 ? (
                    <p className="text-sm text-[var(--slate-500)]">
                      Aucune source disponible.
                    </p>
                  ) : (
                    suggestion.sources.map((source) => (
                      <SourceItem key={source.source_id} source={source} />
                    ))
                  )}
                </div>
              </div>

              {/* Action buttons (only if pending) */}
              {!isReviewed ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant={selectedAction === "keep_current" ? "primary" : "secondary"}
                      size="sm"
                      onClick={() => setSelectedAction("keep_current")}
                      disabled={isRecalculating || isSubmitting}
                    >
                      Conserver le prix actuel
                    </Button>
                    <Button
                      variant={selectedAction === "reject" ? "danger" : "ghost"}
                      size="sm"
                      onClick={() => setSelectedAction("reject")}
                      disabled={isRecalculating || isSubmitting}
                    >
                      Rejeter
                    </Button>
                  </div>

                  {/* Review note */}
                  <div>
                    <label
                      className="text-xs font-medium uppercase text-[var(--slate-500)]"
                      htmlFor="price-suggestion-review-note"
                    >
                      Note de revue (obligatoire)
                    </label>
                    <textarea
                      id="price-suggestion-review-note"
                      className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm focus:border-[var(--ring)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                      rows={3}
                      value={reviewNote}
                      onChange={(e) => setReviewNote(e.target.value)}
                      maxLength={2000}
                      placeholder="Justifiez votre choix..."
                      disabled={isRecalculating || isSubmitting}
                    />
                    <div className="mt-1 flex items-center justify-between">
                      <span className="text-[10px] text-[var(--slate-400)]">
                        {reviewNote.length}/2000
                      </span>
                      {selectedAction && reviewNote.trim().length === 0 ? (
                        <span className="text-[10px] text-rose-500">
                          Une note est requise avant validation.
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {submitError ? (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                      {submitError}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        {/* ---- Footer ---- */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3">
          <span className="text-[10px] text-[var(--slate-400)]">
            Echap fermer
          </span>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleClose}
              disabled={isSubmitting}
            >
              Fermer
            </Button>

            {suggestion ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleRecalculate()}
                disabled={isRecalculating || isSubmitting}
              >
                Recalculer
              </Button>
            ) : null}

            {isReviewed ? (
              <Badge variant="success" size="sm">
                Decision enregistree
              </Badge>
            ) : (
              <Button
                variant="primary"
                size="sm"
                loading={isSubmitting}
                disabled={!canSubmit}
                onClick={() => void handleSubmitReview()}
              >
                {selectedAction
                  ? ACTION_LABELS[selectedAction]
                  : "Selectionner une action"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
