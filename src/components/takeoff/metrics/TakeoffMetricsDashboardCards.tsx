"use client";

import type { TakeoffMetricsReliability } from "@/lib/takeoff/types";
import type {
  TakeoffPilotGoNoGo,
  TakeoffPilotGoNoGoCriterion,
} from "@/lib/takeoff/pilot-metrics";

import { Badge } from "@/components/ui/badge";

import { formatPercent } from "./takeoff-metrics-formatters";

type MetricCardVariant = "default" | "success" | "danger" | "warning";

const VARIANT_CLASSES: Record<MetricCardVariant, string> = {
  default: "text-foreground",
  success: "text-success",
  danger: "text-danger",
  warning: "text-warning",
};

export function MetricCard({
  label,
  value,
  hint,
  variant = "default",
}: {
  label: string;
  value: string;
  hint: string;
  variant?: MetricCardVariant;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={`mt-2 text-2xl font-black ${VARIANT_CLASSES[variant]}`}>{value}</p>
      <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

export function ReliabilityCards({ data }: { data: TakeoffMetricsReliability }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <MetricCard
        label="Timeouts"
        value={String(data.timedOutCount)}
        hint={`sur ${data.totalRunMetrics} runs`}
        variant={data.timedOutCount > 0 ? "danger" : "default"}
      />
      <MetricCard
        label="Budget dépassé"
        value={String(data.budgetExceededCount)}
        hint={`sur ${data.totalRunMetrics} runs`}
        variant={data.budgetExceededCount > 0 ? "warning" : "default"}
      />
      <MetricCard
        label="Relances réussies"
        value={data.retriedJobs > 0 ? `${formatPercent(data.retrySuccessRate)} %` : "-"}
        hint={`${data.retriedThenCompleted}/${data.retriedJobs} relances`}
        variant={
          data.retrySuccessRate >= 50
            ? "success"
            : data.retriedJobs > 0
              ? "warning"
              : "default"
        }
      />
    </div>
  );
}

export function PilotStatusBadge({
  killSwitchEnabled,
}: {
  killSwitchEnabled: boolean;
}) {
  return (
    <Badge variant={killSwitchEnabled ? "success" : "danger"} dot>
      {killSwitchEnabled ? "Pilote actif" : "Pilote coupé"}
    </Badge>
  );
}

function PilotCriterionStatusBadge({
  status,
}: {
  status: TakeoffPilotGoNoGoCriterion["status"];
}) {
  return (
    <Badge
      size="sm"
      variant={status === "pass" ? "success" : status === "inconclusive" ? "warning" : "danger"}
    >
      {status === "pass"
        ? "OK"
        : status === "inconclusive"
          ? "Inconclusif"
          : "Hors cible"}
    </Badge>
  );
}

export function PilotDecisionCard({
  data,
}: {
  data: TakeoffPilotGoNoGo;
}) {
  const variantClass =
    data.status === "go"
      ? "border-success-border bg-success-subtle"
      : data.status === "watch" || data.status === "inconclusive"
        ? "border-warning-border bg-warning-subtle"
        : "border-danger-border bg-danger-subtle";
  const labelClass =
    data.status === "go"
      ? "text-success"
      : data.status === "watch" || data.status === "inconclusive"
        ? "text-warning"
        : "text-danger";

  return (
    <div className={`min-w-0 rounded-xl border p-4 ${variantClass}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Décision go/no-go
          </p>
          <p className={`mt-2 text-2xl font-black ${labelClass}`}>{data.label}</p>
          <p className="mt-2 text-sm text-muted-foreground">{data.summary}</p>
        </div>
      </div>
      <ul className="mt-4 space-y-2 sm:hidden">
        {data.criteria.map((criterion) => (
          <li
            key={criterion.key}
            className="rounded-lg border border-border-subtle bg-surface p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium text-foreground">
                {criterion.label}
              </p>
              <PilotCriterionStatusBadge status={criterion.status} />
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
              <div>
                <dt className="font-semibold uppercase tracking-wide text-muted-foreground">
                  Cible
                </dt>
                <dd className="mt-1 text-foreground-secondary">
                  {criterion.targetLabel}
                </dd>
              </div>
              <div>
                <dt className="font-semibold uppercase tracking-wide text-muted-foreground">
                  Observé
                </dt>
                <dd className="mt-1 text-foreground-secondary">
                  {criterion.actualLabel}
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
      <div
        className="relative mt-4 hidden overflow-x-auto sm:block"
        role="region"
        aria-label="Critères go/no-go"
        tabIndex={0}
      >
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-surface/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Critère</th>
              <th className="px-3 py-2">Cible</th>
              <th className="px-3 py-2">Observé</th>
              <th className="px-3 py-2">Statut</th>
            </tr>
          </thead>
          <tbody>
            {data.criteria.map((criterion) => (
              <tr key={criterion.key} className="border-t border-border-subtle">
                <td className="px-3 py-2 font-medium text-foreground">
                  {criterion.label}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {criterion.targetLabel}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {criterion.actualLabel}
                </td>
                <td className="px-3 py-2">
                  <PilotCriterionStatusBadge status={criterion.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
