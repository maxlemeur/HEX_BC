"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";

import { XIcon } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { EstimateApiError, isEstimateApiError } from "@/lib/estimates/client";
import {
  fetchEstimateDeltaExplanation,
  fetchEstimateLineExplanation,
} from "@/lib/estimates/explanations-client";
import { formatEUR } from "@/lib/money";
import type {
  EstimateExplanationKind,
  EstimateExplanationRiskSignal,
  EstimateExplanationSnapshot,
  EstimateExplanationStatement,
} from "@/lib/estimates/explanation-schemas";

type EstimateExplanationPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: EstimateExplanationKind;
  versionId: string;
  lineId?: string | null;
  compareVersionId?: string | null;
  lineLabel?: string | null;
  currentVersionLabel?: string | null;
  compareVersionLabel?: string | null;
  surfaceLabel: string;
  cacheToken?: string | null;
};

type PanelState =
  | { requestKey: string; kind: "loading" }
  | { requestKey: string; kind: "error"; message: string }
  | {
      requestKey: string;
      kind: "ready";
      explanation: EstimateExplanationSnapshot;
    };

type DetailState = {
  requestKey: string;
  status: "idle" | "loading" | "error" | "ready";
  message?: string;
};

const CONFIDENCE_VARIANTS = {
  high: "success",
  medium: "warning",
  low: "danger",
} as const;

const CONFIDENCE_LABELS = {
  high: "Confiance élevée",
  medium: "Confiance moyenne",
  low: "Confiance faible",
} as const;

const RISK_VARIANTS: Record<
  EstimateExplanationRiskSignal["severity"],
  "neutral" | "warning" | "danger"
> = {
  low: "neutral",
  medium: "warning",
  high: "danger",
};

function formatConfidenceScore(score: number | null | undefined) {
  if (typeof score !== "number") {
    return "Score non renseigné";
  }
  return `${Math.round(score * 100)}%`;
}

function formatImpactLabel(input: {
  currentAmountHt?: number | null;
  currentAmountTtc?: number | null;
  deltaHt?: number | null;
  deltaTtc?: number | null;
}) {
  if (typeof input.deltaHt === "number" || typeof input.deltaTtc === "number") {
    const parts = [];
    if (typeof input.deltaHt === "number") {
      parts.push(`HT ${input.deltaHt >= 0 ? "+" : ""}${formatEUR(input.deltaHt)}`);
    }
    if (typeof input.deltaTtc === "number") {
      parts.push(
        `TTC ${input.deltaTtc >= 0 ? "+" : ""}${formatEUR(input.deltaTtc)}`
      );
    }
    return parts.join(" · ");
  }

  const parts = [];
  if (typeof input.currentAmountHt === "number") {
    parts.push(`HT ${formatEUR(input.currentAmountHt)}`);
  }
  if (typeof input.currentAmountTtc === "number") {
    parts.push(`TTC ${formatEUR(input.currentAmountTtc)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "Impact montant non renseigné";
}

function formatMarginPercent(bp: number) {
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(bp / 100);
}

function formatMarginLabel(input: {
  currentMarginBp?: number | null;
  compareMarginBp?: number | null;
  marginBpDelta?: number | null;
}) {
  if (typeof input.marginBpDelta === "number") {
    const parts = [
      `${input.marginBpDelta >= 0 ? "+" : ""}${formatMarginPercent(input.marginBpDelta)} pts`,
    ];
    if (typeof input.currentMarginBp === "number") {
      parts.push(`actuelle ${formatMarginPercent(input.currentMarginBp)}%`);
    }
    if (typeof input.compareMarginBp === "number") {
      parts.push(`comparée ${formatMarginPercent(input.compareMarginBp)}%`);
    }
    return parts.join(" · ");
  }

  if (typeof input.currentMarginBp === "number") {
    return `${formatMarginPercent(input.currentMarginBp)}%`;
  }

  if (typeof input.compareMarginBp === "number") {
    return `${formatMarginPercent(input.compareMarginBp)}%`;
  }

  return "Impact marge non renseigné";
}

function hasMarginImpact(input: {
  currentMarginBp?: number | null;
  compareMarginBp?: number | null;
  marginBpDelta?: number | null;
}) {
  return (
    typeof input.currentMarginBp === "number" ||
    typeof input.compareMarginBp === "number" ||
    typeof input.marginBpDelta === "number"
  );
}

function formatExplanationError(error: unknown, detail: boolean) {
  if (isEstimateApiError(error) || error instanceof EstimateApiError) {
    return error.message;
  }
  return detail
    ? "Impossible de charger le détail de l'explication."
    : "Impossible de charger l'explication.";
}

function SummaryMetricCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-subtle p-4">
      <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function StatementSection({
  title,
  entries,
}: {
  title: string;
  entries: EstimateExplanationStatement[];
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {title}
        </h3>
        <Badge variant="neutral" size="sm">
          {entries.length}
        </Badge>
      </div>
      {entries.length > 0 ? (
        <div className="space-y-2">
          {entries.map((entry) => (
            <article
              key={`${title}-${entry.label}`}
              className="rounded-lg border border-border bg-surface p-3"
            >
              <p className="text-sm font-medium text-foreground">{entry.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {entry.source_label ?? "Source non renseignée"}
                {typeof entry.confidence_score === "number"
                  ? ` · ${Math.round(entry.confidence_score * 100)}%`
                  : ""}
              </p>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-surface p-4 text-sm text-muted-foreground">
          Aucun élément pour cette section.
        </div>
      )}
    </section>
  );
}

export function EstimateExplanationPanel({
  open,
  onOpenChange,
  kind,
  versionId,
  lineId,
  compareVersionId,
  lineLabel,
  currentVersionLabel,
  compareVersionLabel,
  surfaceLabel,
  cacheToken,
}: EstimateExplanationPanelProps) {
  const requestKey =
    kind === "price"
      ? `${kind}:${versionId}:${lineId ?? "missing"}:${cacheToken ?? "default"}`
      : `${kind}:${versionId}:${compareVersionId ?? "missing"}:${cacheToken ?? "default"}`;
  const [state, setState] = useState<PanelState>(() => ({
    requestKey,
    kind: "loading",
  }));
  const [storedDetailState, setDetailState] = useState<DetailState>(() => ({
    requestKey,
    status: "idle",
  }));
  const cacheRef = useRef<Record<string, EstimateExplanationSnapshot>>({});
  const currentState: PanelState =
    state.requestKey === requestKey
      ? state
      : { requestKey, kind: "loading" };
  const detailState: DetailState =
    storedDetailState.requestKey === requestKey
      ? storedDetailState
      : { requestKey, status: "idle" };

  const requestExplanation = useCallback(
    async (detail: boolean, options?: { force?: boolean }) => {
      const cacheKey = `${requestKey}:${detail ? "detail" : "summary"}`;
      if (options?.force) {
        delete cacheRef.current[`${requestKey}:summary`];
        delete cacheRef.current[`${requestKey}:detail`];
      }

      const cached = options?.force ? null : cacheRef.current[cacheKey];
      if (cached) {
        return cached;
      }

      const explanation =
        kind === "price"
          ? await fetchEstimateLineExplanation(versionId, lineId ?? "", { detail })
          : await fetchEstimateDeltaExplanation(versionId, compareVersionId ?? "", {
              detail,
            });
      cacheRef.current[cacheKey] = explanation;
      return explanation;
    },
    [compareVersionId, kind, lineId, requestKey, versionId]
  );

  const loadExplanation = useCallback(
    async (detail: boolean, options?: { force?: boolean }) => {
      if (!open) {
        return;
      }

      if (detail) {
        setDetailState({ requestKey, status: "loading" });
      } else {
        setDetailState({ requestKey, status: "idle" });
        setState({ requestKey, kind: "loading" });
      }

      try {
        const explanation = await requestExplanation(detail, options);
        startTransition(() => {
          setState({ requestKey, kind: "ready", explanation });
          if (detail) {
            setDetailState({ requestKey, status: "ready" });
          }
        });
      } catch (error) {
        const message = formatExplanationError(error, detail);

        if (detail) {
          setDetailState({ requestKey, status: "error", message });
        } else {
          setState({ requestKey, kind: "error", message });
        }
      }
    },
    [open, requestExplanation, requestKey]
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    let active = true;
    void requestExplanation(false).then(
      (explanation) => {
        if (!active) return;
        startTransition(() => {
          setState({ requestKey, kind: "ready", explanation });
        });
      },
      (error: unknown) => {
        if (!active) return;
        setState({
          requestKey,
          kind: "error",
          message: formatExplanationError(error, false),
        });
      }
    );

    return () => {
      active = false;
    };
  }, [open, requestExplanation, requestKey]);

  const explanation =
    currentState.kind === "ready" ? currentState.explanation : null;
  const title =
    kind === "price"
      ? lineLabel?.trim() || "Explication de prix"
      : `${currentVersionLabel?.trim() || "Version courante"} vs ${compareVersionLabel?.trim() || "Version comparée"}`;

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => onOpenChange(nextOpen)}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="gap-0 bg-surface p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl"
        data-testid="estimate-explanation-panel"
      >
        <div className="shrink-0 border-b border-border bg-surface-subtle px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                {surfaceLabel}
              </p>
              <SheetTitle className="mt-2 text-xl font-semibold text-foreground">
                {title}
              </SheetTitle>
              <SheetDescription className="mt-1 text-foreground-secondary">
                {kind === "price"
                  ? "Lecture seule. Aucun prix ne sera appliqué automatiquement."
                  : "Lecture seule. Le delta reste purement explicatif."}
              </SheetDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void loadExplanation(false, { force: true })}
              >
                Actualiser
              </Button>
              <SheetClose
                render={<Button type="button" variant="ghost" size="icon-sm" />}
              >
                <XIcon aria-hidden="true" />
                <span className="sr-only">Fermer</span>
              </SheetClose>
            </div>
          </div>

          {explanation ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-surface p-3">
                <p className="text-xs text-muted-foreground">Confiance</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Badge
                    variant={CONFIDENCE_VARIANTS[explanation.confidence_label]}
                    size="sm"
                  >
                    {CONFIDENCE_LABELS[explanation.confidence_label]}
                  </Badge>
                  <span className="text-sm font-semibold text-foreground">
                    {formatConfidenceScore(explanation.confidence_score)}
                  </span>
                </div>
              </div>
              <div className="rounded-lg border border-border bg-surface p-3">
                <p className="text-xs text-muted-foreground">Provenance</p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {explanation.provenance.length} source(s)
                </p>
              </div>
              <div className="rounded-lg border border-border bg-surface p-3">
                <p className="text-xs text-muted-foreground">Moteur</p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {explanation.used_fallback ? "Repli automatique" : explanation.provider}
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-surface-subtle px-5 py-5 sm:px-6">
          {currentState.kind === "loading" ? (
            <div
              className="rounded-lg border border-dashed border-border bg-surface p-5 text-sm text-muted-foreground"
              role="status"
            >
              Chargement de l’explication…
            </div>
          ) : null}

          {currentState.kind === "error" ? (
            <Alert variant="danger">{currentState.message}</Alert>
          ) : null}

          {explanation ? (
            <>
              <section className="rounded-lg border border-border bg-surface p-5">
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-foreground">
                        Résumé court
                      </h3>
                      <p className="mt-1 text-sm leading-6 text-foreground-secondary">
                        {explanation.summary_short}
                      </p>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Synthèse de l’impact
                    </p>
                    <div
                      className={`mt-3 grid gap-3 ${
                        kind === "delta" &&
                        hasMarginImpact({
                          currentMarginBp: explanation.impact_summary.current_margin_bp,
                          compareMarginBp: explanation.impact_summary.compare_margin_bp,
                          marginBpDelta: explanation.impact_summary.margin_bp_delta,
                        })
                          ? "sm:grid-cols-2"
                          : "sm:grid-cols-1"
                      }`}
                    >
                      <SummaryMetricCard
                        label="Impact montant"
                        value={formatImpactLabel({
                          currentAmountHt: explanation.impact_summary.current_amount_ht_cents,
                          currentAmountTtc: explanation.impact_summary.current_amount_ttc_cents,
                          deltaHt: explanation.impact_summary.delta_ht_cents,
                          deltaTtc: explanation.impact_summary.delta_ttc_cents,
                        })}
                      />
                      {kind === "delta" &&
                      hasMarginImpact({
                        currentMarginBp: explanation.impact_summary.current_margin_bp,
                        compareMarginBp: explanation.impact_summary.compare_margin_bp,
                        marginBpDelta: explanation.impact_summary.margin_bp_delta,
                      }) ? (
                        <SummaryMetricCard
                          label="Impact marge"
                          value={formatMarginLabel({
                            currentMarginBp: explanation.impact_summary.current_margin_bp,
                            compareMarginBp: explanation.impact_summary.compare_margin_bp,
                            marginBpDelta: explanation.impact_summary.margin_bp_delta,
                          })}
                        />
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => void loadExplanation(true)}
                    loading={detailState.status === "loading"}
                  >
                    {explanation.summary_detail
                      ? "Détail chargé"
                      : "Charger le détail"}
                  </Button>
                  {detailState.status === "error" ? (
                    <p className="mt-2 text-sm text-danger" role="alert">
                      {detailState.message}
                    </p>
                  ) : null}
                  {explanation.summary_detail ? (
                    <p className="mt-3 text-sm leading-7 text-foreground-secondary">
                      {explanation.summary_detail}
                    </p>
                  ) : null}
                </div>
              </section>

              {explanation.risk_signals.length > 0 ? (
                <section className="rounded-lg border border-border bg-surface p-5">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-base font-semibold text-foreground">
                      Signaux de risque
                    </h3>
                    <Badge variant="neutral" size="sm">
                      {explanation.risk_signals.length}
                    </Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {explanation.risk_signals.map((signal) => (
                      <Badge
                        key={`${signal.label}-${signal.severity}`}
                        variant={RISK_VARIANTS[signal.severity]}
                        size="sm"
                      >
                        {signal.label}
                      </Badge>
                    ))}
                  </div>
                </section>
              ) : null}

              <StatementSection title="Faits" entries={explanation.facts} />
              <StatementSection title="Hypothèses" entries={explanation.hypotheses} />
              <StatementSection title="Inférences" entries={explanation.inferences} />

              <section className="rounded-lg border border-border bg-surface p-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-base font-semibold text-foreground">
                    Provenance
                  </h3>
                  <Badge variant="neutral" size="sm">
                    {explanation.provenance.length}
                  </Badge>
                </div>
                <div className="mt-3 space-y-2">
                  {explanation.provenance.map((source) => (
                    <article
                      key={`${source.source_kind}-${source.label}-${source.source_ref ?? "none"}`}
                      className="rounded-lg border border-border bg-surface-subtle p-3"
                    >
                      <p className="text-sm font-medium text-foreground">
                        {source.label}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {source.source_kind}
                        {source.source_ref ? ` · ${source.source_ref}` : ""}
                        {typeof source.confidence_score === "number"
                          ? ` · ${Math.round(source.confidence_score * 100)}%`
                          : ""}
                      </p>
                    </article>
                  ))}
                </div>
              </section>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
