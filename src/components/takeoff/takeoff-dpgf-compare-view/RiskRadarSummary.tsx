"use client";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { TakeoffApiError } from "@/lib/takeoff/client";
import { isTakeoffApiError } from "@/lib/takeoff/client";
import type { TakeoffRiskAlert, TakeoffRiskRadarResponse } from "@/lib/takeoff/types";

import {
  RISK_SEVERITY_LABELS,
  RISK_SEVERITY_VARIANT,
  RISK_STATUS_LABELS,
  RISK_STATUS_VARIANT,
} from "@/components/takeoff/takeoff-dpgf-compare-view/constants";

type RiskActionTarget = {
  alertId: string;
  status: "assumed" | "false_positive";
  causeLabel: string;
  scopeLabel: string;
};

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-white/90 p-4 shadow-sm">
      <p className="text-xs uppercase tracking-[0.14em] text-[var(--slate-500)]">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${accent}`}>{value}</p>
    </div>
  );
}

type RiskRadarSummaryProps = {
  riskRadar: TakeoffRiskRadarResponse | undefined;
  riskRadarError: TakeoffApiError | Error | undefined;
  riskRadarLoading: boolean;
  openRiskItems: TakeoffRiskAlert[];
  onOpenLine: (lineId: string) => void;
  onRiskAction: (target: RiskActionTarget) => void;
};

export function RiskRadarSummary({
  riskRadar,
  riskRadarError,
  riskRadarLoading,
  openRiskItems,
  onOpenLine,
  onRiskAction,
}: Readonly<RiskRadarSummaryProps>) {
  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
      <div className="rounded-[28px] border border-[var(--border)] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--slate-500)]">
              Radar affaire
            </p>
            <h3 className="mt-2 text-xl font-semibold text-[var(--slate-950)]">
              Risque explicable sur la version
            </h3>
          </div>
          {riskRadar?.project ? (
            <Badge variant={RISK_SEVERITY_VARIANT[riskRadar.project.severity]}>
              {RISK_SEVERITY_LABELS[riskRadar.project.severity]} · {riskRadar.project.score}/100
            </Badge>
          ) : null}
        </div>

        {riskRadarLoading ? (
          <p className="mt-3 text-sm text-[var(--slate-600)]">Chargement du radar de risque…</p>
        ) : riskRadarError ? (
          <p className="mt-3 text-sm text-[var(--danger)]">
            {isTakeoffApiError(riskRadarError)
              ? riskRadarError.message
              : "Impossible de charger le radar de risque."}
          </p>
        ) : riskRadar ? (
          <>
            <p className="mt-3 text-sm leading-6 text-[var(--slate-600)]">
              Causes dominantes :{" "}
              {riskRadar.summary.top_causes.length > 0
                ? riskRadar.summary.top_causes.join(" · ")
                : "Aucun signal ouvert."}
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard
                label="Projet"
                value={riskRadar.summary.project_score}
                accent="text-[var(--slate-950)]"
              />
              <SummaryCard
                label="A traiter"
                value={riskRadar.summary.to_process_count}
                accent="text-amber-700"
              />
              <SummaryCard
                label="Assumes"
                value={riskRadar.summary.assumed_count}
                accent="text-emerald-700"
              />
              <SummaryCard
                label="Critiques"
                value={riskRadar.summary.critical_count}
                accent="text-rose-700"
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {riskRadar.lots.length > 0 ? (
                riskRadar.lots.slice(0, 4).map((lot) => (
                  <Badge
                    key={`${lot.scope_id ?? lot.scope_label}`}
                    variant={RISK_SEVERITY_VARIANT[lot.severity]}
                  >
                    {lot.scope_label} · {lot.score}/100
                  </Badge>
                ))
              ) : (
                <Badge variant="neutral">Aucun lot en tension</Badge>
              )}
            </div>
          </>
        ) : null}
      </div>

      <div className="rounded-[28px] border border-[var(--border)] bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--slate-500)]">
              A traiter
            </p>
            <h3 className="mt-2 text-xl font-semibold text-[var(--slate-950)]">
              Signaux prioritaires
            </h3>
          </div>
          <Badge variant="warning">{openRiskItems.length} ouverts</Badge>
        </div>

        <div className="mt-4 space-y-3">
          {openRiskItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--slate-50)] p-4 text-sm text-[var(--slate-600)]">
              Aucun signal ouvert a traiter.
            </div>
          ) : (
            openRiskItems.slice(0, 6).map((item) => (
              <article
                key={item.alert_id}
                className="rounded-2xl border border-[var(--border)] bg-[var(--slate-50)] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={RISK_SEVERITY_VARIANT[item.severity]} size="sm">
                        {RISK_SEVERITY_LABELS[item.severity]}
                      </Badge>
                      <Badge variant={RISK_STATUS_VARIANT[item.status]} size="sm">
                        {RISK_STATUS_LABELS[item.status]}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-[var(--slate-950)]">
                      {item.scope_label}
                    </p>
                    <p className="mt-1 text-xs text-[var(--slate-600)]">
                      {item.cause_label} · {item.risk_score}/100
                    </p>
                    {item.reason_labels[0] ? (
                      <p className="mt-2 text-sm text-[var(--slate-700)]">{item.reason_labels[0]}</p>
                    ) : null}
                  </div>
                  {item.line_id ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => onOpenLine(item.line_id as string)}
                    >
                      Ouvrir
                    </Button>
                  ) : null}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      onRiskAction({
                        alertId: item.alert_id,
                        status: "assumed",
                        causeLabel: item.cause_label,
                        scopeLabel: item.scope_label,
                      })
                    }
                  >
                    Assumer
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      onRiskAction({
                        alertId: item.alert_id,
                        status: "false_positive",
                        causeLabel: item.cause_label,
                        scopeLabel: item.scope_label,
                      })
                    }
                  >
                    Faux positif
                  </Button>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
