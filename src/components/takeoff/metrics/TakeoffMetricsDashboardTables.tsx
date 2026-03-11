"use client";

import type {
  TakeoffCorrectionMetricsByLevel,
  TakeoffCorrectionMetricsEventCount,
  TakeoffMetricsCostByLevel,
  TakeoffMetricsErrorEntry,
  TakeoffMetricsRecentJob,
} from "@/lib/takeoff/types";
import type { TakeoffPilotWeeklySnapshot } from "@/lib/takeoff/pilot-metrics";

import {
  formatConfidence,
  formatCostCents,
  formatDate,
  formatDecimal,
  formatDurationMs,
  formatNumber,
  formatPercent,
} from "./takeoff-metrics-formatters";

const STATUS_BADGE_CLASSES: Record<string, string> = {
  completed: "bg-emerald-100 text-emerald-700",
  applied: "bg-info-light text-info",
  failed: "bg-error-light text-danger",
  canceled: "bg-secondary text-muted-foreground",
  processing: "bg-amber-100 text-warning",
  pending: "bg-secondary text-slate-600",
};

function StatusBadge({ status }: { status: string }) {
  const classes = STATUS_BADGE_CLASSES[status] ?? "bg-secondary text-muted-foreground";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${classes}`}>
      {status}
    </span>
  );
}

function ConfidenceCell({ value }: { value: number | null }) {
  if (value == null) {
    return <span className="text-[var(--slate-400)]">-</span>;
  }

  const pct = value * 100;
  let colorClass = "text-[var(--success)]";
  if (pct < 60) {
    colorClass = "text-[var(--danger)]";
  } else if (pct < 80) {
    colorClass = "text-[var(--warning)]";
  }

  return <span className={`font-semibold ${colorClass}`}>{formatConfidence(value)}</span>;
}

export function ErrorsTable({ errors }: { errors: TakeoffMetricsErrorEntry[] }) {
  if (errors.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center text-sm text-[var(--slate-500)]">
        Aucune erreur sur la période.
      </div>
    );
  }

  return (
    <div className="table-scroll">
      <table className="w-full min-w-[400px] text-sm">
        <thead className="bg-[var(--slate-50)] text-left text-xs uppercase tracking-wide text-[var(--slate-500)]">
          <tr>
            <th className="px-4 py-3">Code</th>
            <th className="px-4 py-3 text-right">Occurrences</th>
            <th className="px-4 py-3 text-right">Derniere occurrence</th>
          </tr>
        </thead>
        <tbody>
          {errors.map((entry) => (
            <tr key={entry.errorCode} className="border-t border-[var(--slate-100)]">
              <td className="px-4 py-3 font-mono text-xs">{entry.errorCode}</td>
              <td className="px-4 py-3 text-right font-semibold">{entry.count}</td>
              <td className="px-4 py-3 text-right text-[var(--slate-500)]">
                {formatDate(entry.lastOccurrence)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RecentJobsTable({ jobs }: { jobs: TakeoffMetricsRecentJob[] }) {
  if (jobs.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center text-sm text-[var(--slate-500)]">
        Aucune extraction sur la période.
      </div>
    );
  }

  return (
    <div className="table-scroll">
      <table className="w-full min-w-[700px] text-sm">
        <thead className="bg-[var(--slate-50)] text-left text-xs uppercase tracking-wide text-[var(--slate-500)]">
          <tr>
            <th className="px-4 py-3">Statut</th>
            <th className="px-4 py-3">Niveau</th>
            <th className="px-4 py-3">Modele</th>
            <th className="px-4 py-3 text-right">Duree</th>
            <th className="px-4 py-3 text-right">Cout</th>
            <th className="px-4 py-3 text-right">Confiance</th>
            <th className="px-4 py-3 text-right">Date</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id} className="border-t border-[var(--slate-100)]">
              <td className="px-4 py-3">
                <StatusBadge status={job.status} />
              </td>
              <td className="px-4 py-3 font-semibold">{job.level}</td>
              <td className="px-4 py-3 text-[var(--slate-600)]">{job.model ?? "-"}</td>
              <td className="px-4 py-3 text-right">{formatDurationMs(job.durationMs)}</td>
              <td className="px-4 py-3 text-right">{formatCostCents(job.costCents)}</td>
              <td className="px-4 py-3 text-right">
                <ConfidenceCell value={job.confidence} />
              </td>
              <td className="px-4 py-3 text-right text-[var(--slate-500)]">
                {formatDate(job.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CostByLevelTable({ data }: { data: TakeoffMetricsCostByLevel[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center text-sm text-[var(--slate-500)]">
        Aucune donnee de cout.
      </div>
    );
  }

  return (
    <table className="w-full min-w-[720px] text-sm">
      <thead className="bg-[var(--slate-50)] text-left text-xs uppercase tracking-wide text-[var(--slate-500)]">
        <tr>
          <th className="px-4 py-3">Niveau</th>
          <th className="px-4 py-3 text-right">Cout</th>
          <th className="px-4 py-3 text-right">Extractions</th>
          <th className="px-4 py-3 text-right">Duree moy.</th>
          <th className="px-4 py-3 text-right">Taux echec</th>
          <th className="px-4 py-3 text-right">Items/extraction</th>
        </tr>
      </thead>
      <tbody>
        {data.map((entry) => (
          <tr key={entry.level} className="border-t border-[var(--slate-100)]">
            <td className="px-4 py-3 font-semibold">{entry.level}</td>
            <td className="px-4 py-3 text-right">{formatCostCents(entry.totalCostCents)}</td>
            <td className="px-4 py-3 text-right font-semibold">{entry.jobCount}</td>
            <td className="px-4 py-3 text-right">{formatDurationMs(entry.avgDurationMs)}</td>
            <td className="px-4 py-3 text-right">{formatPercent(entry.failureRate)} %</td>
            <td className="px-4 py-3 text-right">{formatDecimal(entry.avgItemsPerJob)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CorrectionEventsTable({
  events,
}: {
  events: TakeoffCorrectionMetricsEventCount[];
}) {
  if (events.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center text-sm text-[var(--slate-500)]">
        Aucune correction explicite captee sur la periode.
      </div>
    );
  }

  return (
    <table className="w-full min-w-[420px] text-sm">
      <thead className="bg-[var(--slate-50)] text-left text-xs uppercase tracking-wide text-[var(--slate-500)]">
        <tr>
          <th className="px-4 py-3">Signal</th>
          <th className="px-4 py-3 text-right">Occurrences</th>
        </tr>
      </thead>
      <tbody>
        {events.map((event) => (
          <tr key={event.type} className="border-t border-[var(--slate-100)]">
            <td className="px-4 py-3">{event.label}</td>
            <td className="px-4 py-3 text-right font-semibold">{formatNumber(event.count)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CorrectionByLevelTable({
  rows,
}: {
  rows: TakeoffCorrectionMetricsByLevel[];
}) {
  if (rows.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center text-sm text-[var(--slate-500)]">
        Aucun job exploitable pour la lecture metier.
      </div>
    );
  }

  return (
    <table className="w-full min-w-[720px] text-sm">
      <thead className="bg-[var(--slate-50)] text-left text-xs uppercase tracking-wide text-[var(--slate-500)]">
        <tr>
          <th className="px-4 py-3">Niveau</th>
          <th className="px-4 py-3 text-right">Sorties corrigees</th>
          <th className="px-4 py-3 text-right">Validation rapide</th>
          <th className="px-4 py-3 text-right">Sans retouche</th>
          <th className="px-4 py-3 text-right">Taux correction</th>
          <th className="px-4 py-3 text-right">Taux validation rapide</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.level} className="border-t border-[var(--slate-100)]">
            <td className="px-4 py-3 font-semibold">{row.level}</td>
            <td className="px-4 py-3 text-right">{formatNumber(row.correctedJobs)}</td>
            <td className="px-4 py-3 text-right">{formatNumber(row.quicklyValidatedJobs)}</td>
            <td className="px-4 py-3 text-right">{formatNumber(row.untouchedSuccessfulJobs)}</td>
            <td className="px-4 py-3 text-right">{formatPercent(row.correctionRate)} %</td>
            <td className="px-4 py-3 text-right">
              {formatPercent(row.quickValidationRate)} %
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function PilotWeeklyTable({
  rows,
}: {
  rows: TakeoffPilotWeeklySnapshot[];
}) {
  if (rows.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center text-sm text-[var(--slate-500)]">
        Aucune semaine pilote disponible.
      </div>
    );
  }

  return (
    <table className="w-full min-w-[760px] text-sm">
      <thead className="bg-[var(--slate-50)] text-left text-xs uppercase tracking-wide text-[var(--slate-500)]">
        <tr>
          <th className="px-4 py-3">Semaine</th>
          <th className="px-4 py-3 text-right">Volume</th>
          <th className="px-4 py-3 text-right">Cout moyen</th>
          <th className="px-4 py-3 text-right">Temps moyen</th>
          <th className="px-4 py-3 text-right">Taux correction</th>
          <th className="px-4 py-3 text-right">Satisfaction</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-t border-[var(--slate-100)]">
            <td className="px-4 py-3 font-semibold">{row.label}</td>
            <td className="px-4 py-3 text-right">{formatNumber(row.totalJobs)}</td>
            <td className="px-4 py-3 text-right">
              {formatCostCents(row.avgCostCentsPerJob)}
            </td>
            <td className="px-4 py-3 text-right">
              {formatDurationMs(row.avgDurationMs)}
            </td>
            <td className="px-4 py-3 text-right">
              {formatPercent(row.correctionRate)} %
            </td>
            <td className="px-4 py-3 text-right">
              {formatPercent(row.satisfactionRate)} %
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
