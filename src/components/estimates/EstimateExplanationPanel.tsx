"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { EstimateApiError, isEstimateApiError } from "@/lib/estimates/client";
import {
  fetchEstimateDeltaExplanation,
  fetchEstimateLineExplanation,
} from "@/lib/estimates/explanations-client";
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
  low: "error",
} as const;

const CONFIDENCE_LABELS = {
  high: "Confiance elevee",
  medium: "Confiance moyenne",
  low: "Confiance faible",
} as const;

const RISK_VARIANTS: Record<
  EstimateExplanationRiskSignal["severity"],
  "neutral" | "warning" | "error"
> = {
  low: "neutral",
  medium: "warning",
  high: "error",
};

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

function formatConfidenceScore(score: number | null | undefined) {
  if (typeof score !== "number") {
    return "Score non renseigne";
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
      parts.push(`HT ${input.deltaHt >= 0 ? "+" : ""}${formatCurrency(input.deltaHt)}`);
    }
    if (typeof input.deltaTtc === "number") {
      parts.push(
        `TTC ${input.deltaTtc >= 0 ? "+" : ""}${formatCurrency(input.deltaTtc)}`
      );
    }
    return parts.join(" · ");
  }

  const parts = [];
  if (typeof input.currentAmountHt === "number") {
    parts.push(`HT ${formatCurrency(input.currentAmountHt)}`);
  }
  if (typeof input.currentAmountTtc === "number") {
    parts.push(`TTC ${formatCurrency(input.currentAmountTtc)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "Impact montant non renseigne";
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
      parts.push(`comparee ${formatMarginPercent(input.compareMarginBp)}%`);
    }
    return parts.join(" · ");
  }

  if (typeof input.currentMarginBp === "number") {
    return `${formatMarginPercent(input.currentMarginBp)}%`;
  }

  if (typeof input.compareMarginBp === "number") {
    return `${formatMarginPercent(input.compareMarginBp)}%`;
  }

  return "Impact marge non renseigne";
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
    ? "Impossible de charger le detail de l'explication."
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
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--slate-50)] p-4">
      <p className="text-xs uppercase tracking-[0.12em] text-[var(--slate-500)]">
        {label}
      </p>
      <p className="mt-2 text-sm font-semibold text-[var(--slate-950)]">{value}</p>
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
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--slate-500)]">
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
              className="rounded-2xl border border-[var(--border)] bg-white p-3"
            >
              <p className="text-sm font-medium text-[var(--slate-950)]">{entry.label}</p>
              <p className="mt-1 text-xs text-[var(--slate-500)]">
                {entry.source_label ?? "Source non renseignee"}
                {typeof entry.confidence_score === "number"
                  ? ` · ${Math.round(entry.confidence_score * 100)}%`
                  : ""}
              </p>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white p-4 text-sm text-[var(--slate-600)]">
          Aucun element pour cette section.
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
      : `${currentVersionLabel?.trim() || "Version courante"} vs ${compareVersionLabel?.trim() || "Version comparee"}`;

  return (
    <Modal.Root open={open} onOpenChange={onOpenChange}>
      <Modal.Content
        className="ml-auto flex h-full max-h-[calc(100vh-2rem)] max-w-3xl flex-col overflow-hidden rounded-[28px] p-0 sm:rounded-l-[28px] sm:rounded-r-none"
        data-testid="estimate-explanation-panel"
      >
        <div className="border-b border-[var(--border)] bg-[linear-gradient(135deg,rgba(241,245,249,0.9),rgba(255,255,255,0.98))] px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-[var(--slate-500)]">
                {surfaceLabel}
              </p>
              <Modal.Title className="mt-2 text-xl text-[var(--slate-950)]">
                {title}
              </Modal.Title>
              <p className="mt-1 text-sm text-[var(--slate-600)]">
                {kind === "price"
                  ? "Lecture seule. Aucun prix ne sera applique automatiquement."
                  : "Lecture seule. Le delta reste purement explicatif."}
              </p>
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
              <Modal.Close />
            </div>
          </div>

          {explanation ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/80 bg-white/80 p-3">
                <p className="text-xs text-[var(--slate-500)]">Confiance</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Badge
                    variant={CONFIDENCE_VARIANTS[explanation.confidence_label]}
                    size="sm"
                  >
                    {CONFIDENCE_LABELS[explanation.confidence_label]}
                  </Badge>
                  <span className="text-sm font-semibold text-[var(--slate-950)]">
                    {formatConfidenceScore(explanation.confidence_score)}
                  </span>
                </div>
              </div>
              <div className="rounded-2xl border border-white/80 bg-white/80 p-3">
                <p className="text-xs text-[var(--slate-500)]">Provenance</p>
                <p className="mt-1 text-sm font-semibold text-[var(--slate-950)]">
                  {explanation.provenance.length} source(s)
                </p>
              </div>
              <div className="rounded-2xl border border-white/80 bg-white/80 p-3">
                <p className="text-xs text-[var(--slate-500)]">Moteur</p>
                <p className="mt-1 text-sm font-semibold text-[var(--slate-950)]">
                  {explanation.used_fallback ? "Fallback" : explanation.provider}
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <Modal.Body className="flex-1 space-y-5 overflow-y-auto bg-[var(--slate-50)] px-5 py-5 sm:px-6">
          {currentState.kind === "loading" ? (
            <div className="rounded-3xl border border-dashed border-[var(--border)] bg-white p-5 text-sm text-[var(--slate-600)]">
              Chargement de l&apos;explication...
            </div>
          ) : null}

          {currentState.kind === "error" ? (
            <div className="rounded-3xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {currentState.message}
            </div>
          ) : null}

          {explanation ? (
            <>
              <section className="rounded-3xl border border-[var(--border)] bg-white p-5">
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-[var(--slate-950)]">
                        Resume court
                      </h3>
                      <p className="mt-1 text-sm leading-6 text-[var(--slate-700)]">
                        {explanation.summary_short}
                      </p>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--slate-500)]">
                      Synthese impact
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
                      : "Charger le detail"}
                  </Button>
                  {detailState.status === "error" ? (
                    <p className="mt-2 text-sm text-rose-700">{detailState.message}</p>
                  ) : null}
                  {explanation.summary_detail ? (
                    <p className="mt-3 text-sm leading-7 text-[var(--slate-700)]">
                      {explanation.summary_detail}
                    </p>
                  ) : null}
                </div>
              </section>

              {explanation.risk_signals.length > 0 ? (
                <section className="rounded-3xl border border-[var(--border)] bg-white p-5">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-base font-semibold text-[var(--slate-950)]">
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
              <StatementSection title="Hypotheses" entries={explanation.hypotheses} />
              <StatementSection title="Inferences" entries={explanation.inferences} />

              <section className="rounded-3xl border border-[var(--border)] bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-base font-semibold text-[var(--slate-950)]">
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
                      className="rounded-2xl border border-[var(--border)] bg-[var(--slate-50)] p-3"
                    >
                      <p className="text-sm font-medium text-[var(--slate-950)]">
                        {source.label}
                      </p>
                      <p className="mt-1 text-xs text-[var(--slate-500)]">
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
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}
