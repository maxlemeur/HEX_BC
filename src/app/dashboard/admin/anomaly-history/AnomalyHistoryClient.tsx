"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import useSWR from "swr";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CurrentAnomalyRow = {
  versionId: string;
  versionLabel: string;
  projectName: string;
  ownerUserId: string;
  ownerName: string;
  flagKey: string;
  flagLabel: string;
  severity: "blocking" | "warning";
  itemCount: number;
};

type TrendPeriod = {
  period: string;
  opened: number;
  resolved: number;
};

type AvgResolutionByType = {
  flagKey: string;
  flagLabel: string;
  avgDays: number;
};

type AnomalyHistoryData = {
  summary: {
    totalAnomalies: number;
    blockingCount: number;
    warningCount: number;
    estimatesAffected: number;
    estimatesTotal: number;
  };
  currentAnomalies: CurrentAnomalyRow[];
  trend: TrendPeriod[];
  avgResolution: AvgResolutionByType[];
};

type ApiEnvelope<T> = {
  ok?: boolean;
  data?: T;
  error?: { message?: string };
};

// ---------------------------------------------------------------------------
// Flag type options
// ---------------------------------------------------------------------------

const FLAG_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "missing_price", label: "Prix manquant" },
  { value: "missing_quantity", label: "Quantite manquante" },
  { value: "missing_labor_time", label: "Temps MO manquant" },
  { value: "missing_labor_role", label: "Role MO manquant" },
  { value: "supplier_price_outdated", label: "Prix fournisseur obsolete" },
  { value: "labor_split_incomplete", label: "Split MO incomplet" },
  { value: "price_outlier", label: "Prix atypique" },
  { value: "quantity_outlier", label: "Quantite atypique" },
];

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
// SVG Trend Chart
// ---------------------------------------------------------------------------

function TrendChart({ data }: { data: TrendPeriod[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-slate-400">
        Aucune donnee de tendance disponible.
      </div>
    );
  }

  const maxValue = Math.max(
    ...data.flatMap((d) => [d.opened, d.resolved]),
    1
  );
  const chartWidth = 600;
  const chartHeight = 200;
  const barGroupWidth = chartWidth / data.length;
  const barWidth = Math.max(barGroupWidth * 0.35, 4);
  const gap = 2;

  return (
    <svg
      viewBox={`0 0 ${chartWidth} ${chartHeight + 30}`}
      className="w-full"
      role="img"
      aria-label="Tendance anomalies par mois"
    >
      {data.map((d, i) => {
        const x = i * barGroupWidth + barGroupWidth * 0.15;
        const openedHeight = (d.opened / maxValue) * chartHeight;
        const resolvedHeight = (d.resolved / maxValue) * chartHeight;

        return (
          <g key={d.period}>
            <rect
              x={x}
              y={chartHeight - openedHeight}
              width={barWidth}
              height={openedHeight}
              fill="#ef4444"
              rx={2}
            />
            <rect
              x={x + barWidth + gap}
              y={chartHeight - resolvedHeight}
              width={barWidth}
              height={resolvedHeight}
              fill="#22c55e"
              rx={2}
            />
            <text
              x={x + barWidth}
              y={chartHeight + 16}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize={10}
            >
              {d.period.slice(5)}
            </text>
          </g>
        );
      })}
      <line
        x1={0}
        y1={chartHeight}
        x2={chartWidth}
        y2={chartHeight}
        stroke="#e5e7eb"
        strokeWidth={1}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AnomalyHistoryClient({
  tenantId,
}: {
  tenantId: string;
}) {
  const router = useRouter();

  // Filters
  const [selectedFlagTypes, setSelectedFlagTypes] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedFlagTypes.length > 0) {
      params.set("flag_types", selectedFlagTypes.join(","));
    }
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    if (search.trim()) params.set("search", search.trim());
    if (ownerUserId.trim()) params.set("owner_user_id", ownerUserId.trim());
    return params.toString();
  }, [selectedFlagTypes, dateFrom, dateTo, search, ownerUserId]);

  const apiUrl = `/api/admin/anomaly-history${queryParams ? `?${queryParams}` : ""}`;
  const swrKey = `${tenantId}::${apiUrl}`;
  const { data, error, isLoading } = useSWR<AnomalyHistoryData>(
    swrKey,
    () => fetcher<AnomalyHistoryData>(apiUrl),
    { revalidateOnFocus: false }
  );

  function handleFlagTypeToggle(flagValue: string) {
    setSelectedFlagTypes((prev) =>
      prev.includes(flagValue)
        ? prev.filter((v) => v !== flagValue)
        : [...prev, flagValue]
    );
  }

  async function handleExportCsv() {
    setIsExporting(true);
    try {
      const csvParams = new URLSearchParams(queryParams);
      csvParams.set("format", "csv");
      const response = await fetch(
        `/api/admin/anomaly-history?${csvParams.toString()}`
      );
      if (!response.ok) {
        throw new Error("Export echoue.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "anomaly-history.csv";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      // Silently fail — user sees no download
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Historique des anomalies
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Suivi qualite des chiffrages pour le tenant.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExportCsv}
          disabled={isExporting || isLoading}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
        >
          {isExporting ? "Export en cours..." : "Exporter CSV"}
        </button>
      </div>

      {/* KPI Cards */}
      {data && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard
            label="Total anomalies"
            value={data.summary.totalAnomalies}
          />
          <KpiCard
            label="Bloquantes"
            value={data.summary.blockingCount}
            color="text-danger"
          />
          <KpiCard
            label="Avertissements"
            value={data.summary.warningCount}
            color="text-warning"
          />
          <KpiCard
            label="Devis concernes"
            value={`${data.summary.estimatesAffected} / ${data.summary.estimatesTotal}`}
          />
        </div>
      )}

      {/* Filter Bar */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-0 flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Recherche
            </label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Projet ou version..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Chiffreur (user ID)
            </label>
            <input
              type="text"
              value={ownerUserId}
              onChange={(e) => setOwnerUserId(e.target.value)}
              placeholder="UUID..."
              className="w-48 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Du
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Au
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {FLAG_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleFlagTypeToggle(opt.value)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                selectedFlagTypes.includes(opt.value)
                  ? "border-blue-500 bg-info-light text-info"
                  : "border-slate-300 bg-surface text-slate-600 hover:bg-surface-subtle"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading / Error */}
      {isLoading && (
        <div className="flex h-32 items-center justify-center text-sm text-slate-400">
          Chargement...
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-danger/30 bg-error-light p-4 text-sm text-danger">
          {(error as Error).message ?? "Erreur lors du chargement."}
        </div>
      )}

      {data && (
        <>
          {/* Current Anomalies Table */}
          <div className="rounded-xl border border-border bg-surface">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">
                Anomalies courantes
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-surface-subtle">
                  <tr>
                    <th className="px-4 py-2 font-medium text-slate-600">
                      Devis
                    </th>
                    <th className="px-4 py-2 font-medium text-slate-600">
                      Projet
                    </th>
                    <th className="px-4 py-2 font-medium text-slate-600">
                      Chiffreur
                    </th>
                    <th className="px-4 py-2 font-medium text-slate-600">
                      Anomalie
                    </th>
                    <th className="px-4 py-2 font-medium text-slate-600">
                      Severite
                    </th>
                    <th className="px-4 py-2 text-right font-medium text-slate-600">
                      Nb lignes
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.currentAnomalies.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-8 text-center text-slate-400"
                      >
                        Aucune anomalie detectee.
                      </td>
                    </tr>
                  ) : (
                    data.currentAnomalies.map((row) => (
                      <tr
                        key={`${row.versionId}-${row.flagKey}`}
                        className="cursor-pointer border-b border-border transition hover:bg-surface-subtle"
                        onClick={() =>
                          router.push(
                            `/dashboard/estimates/${row.versionId}`
                          )
                        }
                      >
                        <td className="px-4 py-2 font-mono text-xs text-slate-600">
                          {row.versionLabel}
                        </td>
                        <td className="px-4 py-2 text-foreground">
                          {row.projectName}
                        </td>
                        <td className="px-4 py-2 text-secondary-foreground">
                          {row.ownerName}
                        </td>
                        <td className="px-4 py-2 text-secondary-foreground">
                          {row.flagLabel}
                        </td>
                        <td className="px-4 py-2">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                              row.severity === "blocking"
                                ? "bg-error-light text-danger"
                                : "bg-warning-light text-warning"
                            }`}
                          >
                            {row.severity === "blocking"
                              ? "Bloquant"
                              : "Avertissement"}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-foreground">
                          {row.itemCount}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Trend Chart */}
          <div className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold text-foreground">
              Tendance mensuelle
            </h2>
            <div className="flex items-center gap-4 mb-3">
              <div className="flex items-center gap-1.5 text-xs text-slate-600">
                <span className="inline-block h-3 w-3 rounded-sm bg-red-500" />
                Apparues
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-600">
                <span className="inline-block h-3 w-3 rounded-sm bg-green-500" />
                Resolues
              </div>
            </div>
            <TrendChart data={data.trend} />
          </div>

          {/* Average Resolution Stats */}
          {data.avgResolution.length > 0 && (
            <div className="rounded-xl border border-border bg-surface">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-sm font-semibold text-foreground">
                  Temps moyen de resolution
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border bg-surface-subtle">
                    <tr>
                      <th className="px-4 py-2 font-medium text-slate-600">
                        Type d&apos;anomalie
                      </th>
                      <th className="px-4 py-2 text-right font-medium text-slate-600">
                        Delai moyen (jours)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.avgResolution.map((row) => (
                      <tr
                        key={row.flagKey}
                        className="border-b border-border"
                      >
                        <td className="px-4 py-2 text-secondary-foreground">
                          {row.flagLabel}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-foreground">
                          {row.avgDays}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------

function KpiCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${color ?? "text-foreground"}`}>
        {value}
      </div>
    </div>
  );
}
