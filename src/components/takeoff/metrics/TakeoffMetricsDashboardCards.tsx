"use client";

import type { TakeoffMetricsReliability } from "@/lib/takeoff/types";
import type { TakeoffPilotGoNoGo } from "@/lib/takeoff/pilot-metrics";

import { formatPercent } from "./takeoff-metrics-formatters";

type MetricCardVariant = "default" | "success" | "danger" | "warning";

const VARIANT_CLASSES: Record<MetricCardVariant, string> = {
  default: "text-[var(--slate-800)]",
  success: "text-[var(--success)]",
  danger: "text-[var(--danger)]",
  warning: "text-[var(--warning)]",
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
    <div className="rounded-xl border border-[var(--slate-200)] bg-surface p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--slate-500)]">
        {label}
      </p>
      <p className={`mt-2 text-2xl font-black ${VARIANT_CLASSES[variant]}`}>{value}</p>
      <p className="mt-2 text-xs text-[var(--slate-500)]">{hint}</p>
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
        label="Budget depasse"
        value={String(data.budgetExceededCount)}
        hint={`sur ${data.totalRunMetrics} runs`}
        variant={data.budgetExceededCount > 0 ? "warning" : "default"}
      />
      <MetricCard
        label="Retry reussi"
        value={data.retriedJobs > 0 ? `${formatPercent(data.retrySuccessRate)} %` : "-"}
        hint={`${data.retriedThenCompleted}/${data.retriedJobs} retries`}
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
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
        killSwitchEnabled
          ? "bg-[var(--success)]/12 text-[var(--success)]"
          : "bg-[var(--danger)]/12 text-[var(--danger)]"
      }`}
    >
      {killSwitchEnabled ? "Pilote actif" : "Pilote coupe"}
    </span>
  );
}

export function PilotDecisionCard({
  data,
}: {
  data: TakeoffPilotGoNoGo;
}) {
  const variantClass =
    data.status === "go"
      ? "border-[var(--success)]/20 bg-[var(--success)]/5"
      : data.status === "watch" || data.status === "inconclusive"
        ? "border-[var(--warning)]/20 bg-[var(--warning)]/5"
        : "border-[var(--danger)]/20 bg-[var(--danger)]/5";
  const labelClass =
    data.status === "go"
      ? "text-[var(--success)]"
      : data.status === "watch" || data.status === "inconclusive"
        ? "text-[var(--warning)]"
        : "text-[var(--danger)]";

  return (
    <div className={`rounded-xl border p-4 ${variantClass}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--slate-500)]">
            Decision go/no-go
          </p>
          <p className={`mt-2 text-2xl font-black ${labelClass}`}>{data.label}</p>
          <p className="mt-2 text-sm text-[var(--slate-600)]">{data.summary}</p>
        </div>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-white/60 text-left text-xs uppercase tracking-wide text-[var(--slate-500)]">
            <tr>
              <th className="px-3 py-2">Critere</th>
              <th className="px-3 py-2">Cible</th>
              <th className="px-3 py-2">Observe</th>
              <th className="px-3 py-2">Statut</th>
            </tr>
          </thead>
          <tbody>
            {data.criteria.map((criterion) => (
              <tr key={criterion.key} className="border-t border-white/70">
                <td className="px-3 py-2 font-medium text-[var(--slate-800)]">
                  {criterion.label}
                </td>
                <td className="px-3 py-2 text-[var(--slate-600)]">
                  {criterion.targetLabel}
                </td>
                <td className="px-3 py-2 text-[var(--slate-600)]">
                  {criterion.actualLabel}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                      criterion.status === "pass"
                        ? "bg-[var(--success)]/12 text-[var(--success)]"
                        : criterion.status === "inconclusive"
                          ? "bg-[var(--warning)]/12 text-[var(--warning)]"
                          : "bg-[var(--danger)]/12 text-[var(--danger)]"
                    }`}
                  >
                    {criterion.status === "pass"
                      ? "OK"
                      : criterion.status === "inconclusive"
                        ? "Inconclusif"
                        : "Hors cible"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
