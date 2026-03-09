"use client";

import { useState } from "react";
import useSWR from "swr";

import type {
  TakeoffCorrectionMetricsByLevel,
  TakeoffCorrectionMetricsEventCount,
  TakeoffLevel,
  TakeoffMetricsCostByLevel,
  TakeoffMetricsErrorEntry,
  TakeoffMetricsPeriod,
  TakeoffMetricsRecentJob,
  TakeoffMetricsReliability,
  TakeoffMetricsStatsPayload,
  TakeoffMetricsTokenBreakdown,
  TakeoffMetricsTrendPoint,
} from "@/lib/takeoff/types";
import { TAKEOFF_METRICS_PERIODS } from "@/lib/takeoff/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ApiEnvelope<T> = {
  ok?: boolean;
  data?: T;
  error?: { message?: string };
};

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

async function fetcher<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const json = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || !json.ok) {
    throw new Error(json.error?.message ?? "Erreur lors du chargement.");
  }
  return json.data as T;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatDurationMs(ms: number | null): string {
  if (ms == null || ms <= 0) return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatCostCents(cents: number | null): string {
  if (cents == null) return "-";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value);
}

function formatConfidence(value: number | null): string {
  if (value == null) return "-";
  return `${Math.round(value * 100)}%`;
}

function formatGeneratedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("fr-FR").format(value);
}

function formatDecimal(value: number, maxFractionDigits = 2): string {
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
}

// ---------------------------------------------------------------------------
// Period labels
// ---------------------------------------------------------------------------

const PERIOD_LABELS: Record<TakeoffMetricsPeriod, string> = {
  "7d": "7j",
  "30d": "30j",
  "90d": "90j",
};

const LEVEL_FILTER_OPTIONS: Array<{ value: "all" | TakeoffLevel; label: string }> = [
  { value: "all", label: "Tous niveaux" },
  { value: "A", label: "Niveau A" },
  { value: "B", label: "Niveau B" },
  { value: "C", label: "Niveau C" },
];

// ---------------------------------------------------------------------------
// PeriodSelector
// ---------------------------------------------------------------------------

function PeriodSelector({
  value,
  onChange,
}: {
  value: TakeoffMetricsPeriod;
  onChange: (p: TakeoffMetricsPeriod) => void;
}) {
  return (
    <div className="inline-flex gap-1 rounded-full bg-[var(--slate-100)] p-1">
      {TAKEOFF_METRICS_PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
            value === p
              ? "bg-surface text-[var(--slate-800)] shadow-sm"
              : "text-[var(--slate-500)] hover:text-[var(--slate-700)]"
          }`}
        >
          {PERIOD_LABELS[p]}
        </button>
      ))}
    </div>
  );
}

function LevelSelector({
  value,
  onChange,
}: {
  value: "all" | TakeoffLevel;
  onChange: (value: "all" | TakeoffLevel) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-xs text-[var(--slate-600)]">
      Niveau
      <select
        className="rounded-md border border-[var(--slate-300)] bg-surface px-2 py-1 text-xs font-medium text-[var(--slate-700)]"
        value={value}
        onChange={(event) => onChange(event.target.value as "all" | TakeoffLevel)}
      >
        {LEVEL_FILTER_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// ---------------------------------------------------------------------------
// MetricCard
// ---------------------------------------------------------------------------

type MetricCardVariant = "default" | "success" | "danger" | "warning";

const VARIANT_CLASSES: Record<MetricCardVariant, string> = {
  default: "text-[var(--slate-800)]",
  success: "text-[var(--success)]",
  danger: "text-[var(--danger)]",
  warning: "text-[var(--warning)]",
};

function MetricCard({
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

// ---------------------------------------------------------------------------
// JobTrendChart
// ---------------------------------------------------------------------------

type TrendLinePoint = {
  x: number;
  yCreated: number;
  yFailed: number;
  label: string;
};

function buildTrendPoints(
  trend: TakeoffMetricsTrendPoint[],
  chartWidth: number,
  chartHeight: number
): { points: TrendLinePoint[]; maxValue: number } {
  const maxValue = Math.max(
    ...trend.flatMap((item) => [item.createdCount, item.failedCount]),
    1
  );

  if (trend.length === 0) {
    return { points: [], maxValue };
  }

  const paddingLeft = 36;
  const paddingRight = 24;
  const usableWidth = Math.max(chartWidth - paddingLeft - paddingRight, 1);
  const stepX = trend.length > 1 ? usableWidth / (trend.length - 1) : 0;

  const toY = (value: number) => {
    const normalized = value / maxValue;
    return 16 + (chartHeight - 24) * (1 - normalized);
  };

  const points = trend.map((item, index) => ({
    x: paddingLeft + stepX * index,
    yCreated: toY(item.createdCount),
    yFailed: toY(item.failedCount),
    label: item.label,
  }));

  return { points, maxValue };
}

function toPolyline(points: { x: number; y: number }[]) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function JobTrendChart({ trend }: { trend: TakeoffMetricsTrendPoint[] }) {
  if (trend.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-[var(--slate-500)]">
        Aucune donnée de tendance disponible.
      </div>
    );
  }

  const chartWidth = 720;
  const chartHeight = 220;
  const { points, maxValue } = buildTrendPoints(trend, chartWidth, chartHeight);

  const createdPoints = toPolyline(
    points.map((point) => ({ x: point.x, y: point.yCreated }))
  );
  const failedPoints = toPolyline(
    points.map((point) => ({ x: point.x, y: point.yFailed }))
  );

  const horizontalGuides = 4;

  return (
    <svg
      viewBox={`0 0 ${chartWidth} ${chartHeight + 24}`}
      className="w-full"
      role="img"
      aria-label="Tendance des extractions créées et échouées"
    >
      {Array.from({ length: horizontalGuides + 1 }, (_, index) => {
        const y = 16 + ((chartHeight - 24) / horizontalGuides) * index;
        return (
          <line
            key={`guide-${index}`}
            x1={24}
            y1={y}
            x2={chartWidth - 16}
            y2={y}
            stroke="rgba(148, 163, 184, 0.25)"
            strokeWidth="1"
          />
        );
      })}

      <polyline
        points={createdPoints}
        fill="none"
        stroke="var(--brand-blue)"
        strokeWidth="3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <polyline
        points={failedPoints}
        fill="none"
        stroke="var(--danger)"
        strokeWidth="3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {points.map((point, index) => (
        <g key={`${point.label}-${index}`}>
          <circle cx={point.x} cy={point.yCreated} r={3.5} fill="var(--brand-blue)" />
          <circle cx={point.x} cy={point.yFailed} r={3.5} fill="var(--danger)" />
          <text
            x={point.x}
            y={chartHeight + 12}
            textAnchor="middle"
            className="fill-[var(--slate-500)]"
            fontSize="10"
          >
            {point.label}
          </text>
        </g>
      ))}

      <text x={8} y={20} className="fill-[var(--slate-500)]" fontSize="10">
        {maxValue}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// TokenBreakdownBar
// ---------------------------------------------------------------------------

function TokenBreakdownBar({ data }: { data: TakeoffMetricsTokenBreakdown }) {
  const total = data.inputTokens + data.reasoningTokens + data.outputTokens;
  if (total === 0) {
    return (
      <div className="flex h-20 items-center justify-center text-sm text-[var(--slate-500)]">
        Aucun token enregistre.
      </div>
    );
  }

  const barWidth = 400;
  const barHeight = 28;
  const inputW = (data.inputTokens / total) * barWidth;
  const reasoningW = (data.reasoningTokens / total) * barWidth;
  const outputW = (data.outputTokens / total) * barWidth;

  return (
    <div className="space-y-3">
      <svg viewBox={`0 0 ${barWidth} ${barHeight}`} className="w-full" role="img" aria-label="Repartition des tokens">
        <rect x={0} y={0} width={inputW} height={barHeight} rx={4} fill="var(--brand-blue)" />
        <rect x={inputW} y={0} width={reasoningW} height={barHeight} fill="var(--warning)" />
        <rect x={inputW + reasoningW} y={0} width={outputW} height={barHeight} rx={4} fill="var(--success)" />
      </svg>
      <div className="flex flex-wrap gap-4 text-xs text-[var(--slate-600)]">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-[var(--brand-blue)]" />
          Input: {formatNumber(data.inputTokens)}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-[var(--warning)]" />
          Reasoning: {formatNumber(data.reasoningTokens)}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-[var(--success)]" />
          Output: {formatNumber(data.outputTokens)}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReliabilityCards
// ---------------------------------------------------------------------------

function ReliabilityCards({ data }: { data: TakeoffMetricsReliability }) {
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
        variant={data.retrySuccessRate >= 50 ? "success" : data.retriedJobs > 0 ? "warning" : "default"}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ErrorsTable
// ---------------------------------------------------------------------------

function ErrorsTable({ errors }: { errors: TakeoffMetricsErrorEntry[] }) {
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

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Confidence color
// ---------------------------------------------------------------------------

function ConfidenceCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-[var(--slate-400)]">-</span>;
  const pct = value * 100;
  let colorClass = "text-[var(--success)]";
  if (pct < 60) colorClass = "text-[var(--danger)]";
  else if (pct < 80) colorClass = "text-[var(--warning)]";
  return <span className={`font-semibold ${colorClass}`}>{formatConfidence(value)}</span>;
}

// ---------------------------------------------------------------------------
// RecentJobsTable
// ---------------------------------------------------------------------------

function RecentJobsTable({ jobs }: { jobs: TakeoffMetricsRecentJob[] }) {
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

// ---------------------------------------------------------------------------
// CostByLevelTable
// ---------------------------------------------------------------------------

function CostByLevelTable({ data }: { data: TakeoffMetricsCostByLevel[] }) {
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

function CorrectionEventsTable({
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

function CorrectionByLevelTable({
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

// ---------------------------------------------------------------------------
// Main Dashboard Component
// ---------------------------------------------------------------------------

export function TakeoffMetricsDashboard({ tenantId }: { tenantId: string }) {
  const [period, setPeriod] = useState<TakeoffMetricsPeriod>("30d");
  const [level, setLevel] = useState<"all" | TakeoffLevel>("all");
  const levelFilterSuffix = level === "all" ? "" : `&level=${level}`;

  const { data, error, isLoading } = useSWR<TakeoffMetricsStatsPayload>(
    `/api/takeoff/stats?period=${period}${levelFilterSuffix}&t=${tenantId}`,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 120_000 }
  );

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--slate-200)] border-t-[var(--brand-blue)]" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <div className="dashboard-card p-6 text-center text-sm text-[var(--danger)]">
          {error?.message ?? "Impossible de charger les metriques."}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <section className="dashboard-card p-6 animate-slide-in stagger-1">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-[var(--slate-800)]">
              Métriques takeoff
            </h1>
            <p className="mt-1 text-sm text-[var(--slate-500)]">
              Observabilité des extractions, des coûts et des corrections humaines.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <PeriodSelector value={period} onChange={setPeriod} />
            <LevelSelector value={level} onChange={setLevel} />
            <p className="text-xs text-[var(--slate-500)]">
              {formatGeneratedAt(data.generatedAt)}
            </p>
          </div>
        </div>
      </section>

      {/* Section 1: KPI Strip */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6 animate-slide-in stagger-2">
        <MetricCard
          label="Total extractions"
          value={String(data.kpis.totalJobs)}
          hint={`${data.kpis.completedJobs} complètes, ${data.kpis.failedJobs} échouées`}
        />
        <MetricCard
          label="Taux de succes"
          value={`${formatPercent(data.kpis.successRate)} %`}
          hint={`${data.kpis.completedJobs} / ${data.kpis.completedJobs + data.kpis.failedJobs + data.kpis.canceledJobs} terminaux`}
          variant={data.kpis.successRate >= 90 ? "success" : data.kpis.successRate >= 70 ? "warning" : "danger"}
        />
        <MetricCard
          label="Duree moyenne"
          value={formatDurationMs(data.kpis.avgDurationMs)}
          hint="Extractions complètes uniquement"
        />
        <MetricCard
          label="Cout total"
          value={formatCostCents(data.kpis.totalCostCents)}
          hint={`Moy. ${formatCostCents(data.kpis.avgCostCentsPerJob)} / extraction`}
        />
        <MetricCard
          label="Confiance moy."
          value={formatConfidence(data.kpis.avgConfidence)}
          hint="Moyenne sur les resultats"
          variant={
            data.kpis.avgConfidence >= 0.8
              ? "success"
              : data.kpis.avgConfidence >= 0.6
                ? "warning"
                : data.kpis.avgConfidence > 0
                  ? "danger"
                  : "default"
          }
        />
        <MetricCard
          label="Items / extraction"
          value={formatDecimal(data.kpis.avgItemsPerJob)}
          hint="Moyenne sur la periode"
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 animate-slide-in stagger-2">
        <MetricCard
          label="Sorties corrigees"
          value={formatNumber(data.corrections.kpis.correctedJobs)}
          hint={`${formatPercent(data.corrections.kpis.correctionRate)} % des jobs exploitables`}
          variant={data.corrections.kpis.correctedJobs > 0 ? "warning" : "default"}
        />
        <MetricCard
          label="Validation rapide"
          value={formatNumber(data.corrections.kpis.quicklyValidatedJobs)}
          hint={`${formatPercent(data.corrections.kpis.quickValidationRate)} % valides apres revue`}
          variant={data.corrections.kpis.quicklyValidatedJobs > 0 ? "success" : "default"}
        />
        <MetricCard
          label="Sans retouche"
          value={formatNumber(data.corrections.kpis.untouchedSuccessfulJobs)}
          hint="Jobs completes/appliques sans action explicite"
        />
        <MetricCard
          label="Evenements correction"
          value={formatNumber(data.corrections.kpis.totalEvents)}
          hint="Historique consolide des corrections humaines"
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_1.25fr] animate-slide-in stagger-3">
        <div className="dashboard-card overflow-hidden">
          <div className="border-b border-[var(--slate-200)] px-4 py-3">
            <h2 className="text-sm font-semibold text-[var(--slate-700)]">
              Corrections capturees
            </h2>
          </div>
          <CorrectionEventsTable events={data.corrections.eventCounts} />
        </div>

        <div className="dashboard-card overflow-hidden">
          <div className="border-b border-[var(--slate-200)] px-4 py-3">
            <h2 className="text-sm font-semibold text-[var(--slate-700)]">
              Lecture metier par niveau
            </h2>
          </div>
          <CorrectionByLevelTable rows={data.corrections.byLevel} />
        </div>
      </section>

      {/* Section 2: Trend + Cost by Level */}
      <section className="grid gap-6 xl:grid-cols-[1.6fr_1fr] animate-slide-in stagger-3">
        <div className="dashboard-card p-5">
          <div className="mb-3 flex items-center gap-4 text-xs font-semibold text-[var(--slate-600)]">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-[var(--brand-blue)]" />
              Crees
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-[var(--danger)]" />
              Echoues
            </span>
          </div>
          <JobTrendChart trend={data.trend} />
        </div>

        <div className="dashboard-card overflow-hidden">
          <div className="border-b border-[var(--slate-200)] px-4 py-3">
            <h2 className="text-sm font-semibold text-[var(--slate-700)]">
              Cout par niveau
            </h2>
          </div>
          <CostByLevelTable data={data.costByLevel} />
        </div>
      </section>

      {/* Section 3: Tokens + Reliability */}
      <section className="grid gap-6 xl:grid-cols-2 animate-fade-in stagger-3">
        <div className="dashboard-card p-5">
          <h2 className="mb-4 text-sm font-semibold text-[var(--slate-700)]">
            Repartition tokens
          </h2>
          <TokenBreakdownBar data={data.tokenBreakdown} />
        </div>

        <div className="dashboard-card p-5">
          <h2 className="mb-4 text-sm font-semibold text-[var(--slate-700)]">
            Fiabilite
          </h2>
          <ReliabilityCards data={data.reliability} />
        </div>
      </section>

      {/* Section 4: Top Error Codes */}
      <section className="dashboard-card overflow-hidden animate-fade-in stagger-4">
        <div className="border-b border-[var(--slate-200)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--slate-700)]">
            Top codes erreur
          </h2>
        </div>
        <ErrorsTable errors={data.topErrors} />
      </section>

      {/* Section 5: Recent Jobs */}
      <section className="dashboard-card overflow-hidden animate-fade-in stagger-4">
        <div className="border-b border-[var(--slate-200)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--slate-700)]">
            Extractions récentes
          </h2>
        </div>
        <RecentJobsTable jobs={data.recentJobs} />
      </section>
    </div>
  );
}
