"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
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
import { XIcon } from "lucide-react";

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
  external_reference: "Référence externe",
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
  "success" | "warning" | "danger"
> = {
  high: "success",
  medium: "warning",
  low: "danger",
};

const CONFIDENCE_LABELS: Record<TakeoffPriceSuggestionConfidenceLabel, string> = {
  high: "Élevée",
  medium: "Moyenne",
  low: "Faible",
};

const EVIDENCE_KIND_LABELS: Record<string, string> = {
  fact: "Fait",
  hypothesis: "Hypothèse",
  inference: "Inférence",
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

function getConfidenceBarClass(label: TakeoffPriceSuggestionConfidenceLabel): string {
  switch (label) {
    case "high":
      return "bg-success";
    case "medium":
      return "bg-warning";
    case "low":
      return "bg-danger";
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
      accent: "text-info",
      selectedAccent: "border-info bg-info-subtle",
    },
    {
      action: "apply_target",
      label: "Prix cible",
      cents: suggestion.target_cents,
      accent: "text-success",
      selectedAccent: "border-success bg-success-subtle",
    },
    {
      action: "apply_high",
      label: "Borne haute",
      cents: suggestion.high_cents,
      accent: "text-warning",
      selectedAccent: "border-warning bg-warning-subtle",
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
            aria-pressed={isSelected}
            className={`min-w-0 rounded-2xl border p-3 text-center transition hover:-translate-y-0.5 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:hover:translate-y-0 ${
              isSelected
                ? selectedAccent
                : "border-border bg-surface"
            }`}
          >
            <p className="text-micro uppercase tracking-[0.14em] text-muted-foreground">
              {label}
            </p>
            <p className={`mt-1 break-words text-sm font-semibold ${accent}`}>
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
    <article className="rounded-xl border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={SOURCE_KIND_VARIANT[source.source_kind]} size="sm">
          {SOURCE_KIND_LABELS[source.source_kind]}
        </Badge>
        <Badge variant="neutral" size="sm">
          {EVIDENCE_KIND_LABELS[source.kind] ?? source.kind}
        </Badge>
        {source.is_outlier ? (
          <Badge variant="danger" size="sm">
            Valeur aberrante
          </Badge>
        ) : null}
        {source.freshness_label ? (
          <Badge variant="neutral" size="sm">
            {source.freshness_label}
          </Badge>
        ) : null}
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <p className="min-w-0 break-words text-sm font-medium text-foreground">
          {source.label}
        </p>
        <p className={`shrink-0 text-sm font-semibold tabular-nums ${source.is_outlier ? "text-muted-foreground line-through" : "text-foreground"}`}>
          {formatEUR(source.price_cents)}
        </p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
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

  // Escape, overlay click and the close buttons all go through the Sheet.
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
    <Sheet open onOpenChange={(nextOpen) => !nextOpen && handleClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="min-w-0 gap-0 bg-surface p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
      >
        {/* ---- Header ---- */}
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <SheetTitle className="text-sm font-semibold">Suggestion de prix</SheetTitle>
            <SheetDescription className="mt-0.5 line-clamp-1 text-xs">
              {lineLabel}
            </SheetDescription>
          </div>
          <IconButton
            label="Fermer le panneau (Échap)"
            icon={<XIcon aria-hidden="true" />}
            onClick={handleClose}
          />
        </div>

        {/* ---- Scrollable body ---- */}
        <div className="min-w-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {/* Loading */}
          {state.kind === "loading" ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12" role="status">
              <span
                aria-hidden="true"
                className="size-6 animate-spin rounded-full border-2 border-border-strong border-t-foreground-secondary motion-reduce:animate-none"
              />
              <p className="text-sm text-muted-foreground">
                Calcul de la suggestion en cours…
              </p>
            </div>
          ) : null}

          {/* Error */}
          {state.kind === "error" ? (
            <Alert variant="danger">
              <AlertTitle>Erreur</AlertTitle>
              <AlertDescription>{state.message}</AlertDescription>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void handleRecalculate()}
              >
                Réessayer
              </Button>
            </Alert>
          ) : null}

          {/* Empty */}
          {state.kind === "empty" ? (
            <div className="rounded-2xl border border-dashed border-border bg-surface-subtle p-6 text-center">
              <p className="text-sm font-medium text-foreground">
                Aucune suggestion calculable pour cette ligne.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
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
                  className="flex items-center gap-2 rounded-xl border border-info-border bg-info-subtle px-3 py-2"
                  role="status"
                >
                  <span
                    aria-hidden="true"
                    className="size-4 animate-spin rounded-full border-2 border-info-border border-t-info motion-reduce:animate-none"
                  />
                  <p className="text-xs text-info">Recalcul en cours…</p>
                </div>
              ) : null}

              {/* Reviewed banner */}
              {isReviewed ? (
                <div className="rounded-xl border border-success-border bg-success-subtle px-3 py-2">
                  <p className="text-xs font-medium text-success">
                    Décision enregistrée : {ACTION_LABELS[suggestion.selected_action!]}
                  </p>
                  {suggestion.selected_price_cents !== null ? (
                    <p className="mt-1 text-xs text-success">
                      Prix appliqué : {formatEUR(suggestion.selected_price_cents)}
                    </p>
                  ) : null}
                  {suggestion.review_note ? (
                    <p className="mt-1 text-xs text-success">
                      Note : {suggestion.review_note}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {/* Current price */}
              <div className="rounded-2xl border border-border bg-surface-subtle p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  Prix actuel
                </p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {suggestion.current_price_cents !== null
                    ? formatEUR(suggestion.current_price_cents)
                    : "Non renseigné"}
                </p>
              </div>

              {/* Bounds */}
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
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
                  <div className="relative h-3 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="absolute inset-y-0 rounded-full bg-gradient-to-r from-info via-success to-warning opacity-80"
                      style={{
                        left: "0%",
                        right: "0%",
                      }}
                    />
                    {suggestion.current_price_cents !== null &&
                      suggestion.high_cents > suggestion.low_cents ? (
                      <div
                        className="absolute top-0 h-full w-0.5 bg-foreground"
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
                  <div className="flex justify-between text-micro text-muted-foreground">
                    <span>{formatEUR(suggestion.low_cents)}</span>
                    <span>{formatEUR(suggestion.high_cents)}</span>
                  </div>
                </div>
              </div>

              {/* Confidence */}
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Confiance
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${getConfidenceBarClass(suggestion.confidence_label)}`}
                      style={{ width: getConfidenceBarWidth(suggestion.confidence_label) }}
                    />
                  </div>
                  <Badge variant={CONFIDENCE_VARIANT[suggestion.confidence_label]} size="sm">
                    {CONFIDENCE_LABELS[suggestion.confidence_label]}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {suggestion.candidate_count} source{suggestion.candidate_count > 1 ? "s" : ""}
                  {suggestion.outlier_count > 0
                    ? ` · ${suggestion.outlier_count} valeur${suggestion.outlier_count > 1 ? "s" : ""} aberrante${suggestion.outlier_count > 1 ? "s" : ""} signalée${suggestion.outlier_count > 1 ? "s" : ""}`
                    : ""}
                </p>
              </div>

              {/* Justification */}
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Justification
                </p>
                <div className="mt-2 rounded-xl border border-border bg-surface-subtle px-3 py-2.5 text-sm leading-relaxed text-foreground-secondary whitespace-pre-wrap">
                  {suggestion.justification}
                </div>
              </div>

              {/* Factors */}
              {suggestion.factors.length > 0 ? (
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Facteurs
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {suggestion.factors.map((factor) => (
                      <div
                        key={factor.key}
                        className="rounded-xl border border-border bg-surface px-3 py-2"
                      >
                        <div className="flex items-center gap-1.5">
                          <Badge variant="neutral" size="sm">
                            {EVIDENCE_KIND_LABELS[factor.kind] ?? factor.kind}
                          </Badge>
                          <span className="text-xs font-medium text-foreground">
                            {factor.label}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {factor.value}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Sources */}
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Sources ({suggestion.sources.length})
                </p>
                <div className="mt-2 space-y-2">
                  {suggestion.sources.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
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
                      className="text-xs font-medium uppercase text-muted-foreground"
                      htmlFor="price-suggestion-review-note"
                    >
                      Note de revue (obligatoire)
                    </label>
                    <Textarea
                      id="price-suggestion-review-note"
                      className="mt-1 min-h-20 text-sm"
                      rows={3}
                      value={reviewNote}
                      onChange={(e) => setReviewNote(e.target.value)}
                      maxLength={2000}
                      placeholder="Justifiez votre choix…"
                      aria-invalid={selectedAction && reviewNote.trim().length === 0 ? true : undefined}
                      aria-describedby="price-suggestion-review-note-hint"
                      disabled={isRecalculating || isSubmitting}
                    />
                    <div
                      id="price-suggestion-review-note-hint"
                      className="mt-1 flex flex-wrap items-center justify-between gap-2"
                    >
                      <span className="text-micro text-muted-foreground">
                        {reviewNote.length}/2000
                      </span>
                      {selectedAction && reviewNote.trim().length === 0 ? (
                        <span className="text-micro text-danger">
                          Une note est requise avant validation.
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {submitError ? (
                    <Alert variant="danger">
                      <AlertDescription className="text-xs">{submitError}</AlertDescription>
                    </Alert>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        {/* ---- Footer ---- */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
          <span className="text-micro text-muted-foreground">
            Échap fermer
          </span>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="outline"
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
                Décision enregistrée
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
                  : "Sélectionner une action"}
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
