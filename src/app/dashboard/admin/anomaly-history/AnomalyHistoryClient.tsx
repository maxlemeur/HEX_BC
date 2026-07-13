"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";

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

type AnomalySummary = {
  totalAnomalies: number;
  blockingCount: number;
  warningCount: number;
  estimatesAffected: number;
  estimatesTotal: number;
};

type CurrentAnomalyData = {
  summary: AnomalySummary;
  currentAnomalies: CurrentAnomalyRow[];
  ownerOptions: { id: string; name: string }[];
  pagination: {
    page: number;
    size: 25 | 50 | 100;
    totalItems: number;
    totalPages: number;
  };
};

type TrendPeriod = {
  period: string;
  opened: number;
  resolved: number;
};

type TrendData = {
  trend: TrendPeriod[];
  avgResolution: {
    flagKey: string;
    flagLabel: string;
    avgDays: number;
  }[];
};

type ApiEnvelope<T> = {
  ok?: boolean;
  data?: T;
  error?: { message?: string };
};

const PAGE_SIZES = [25, 50, 100] as const;
const FLAG_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "missing_price", label: "Prix manquant" },
  { value: "missing_quantity", label: "Quantité manquante" },
  { value: "missing_labor_time", label: "Temps MO manquant" },
  { value: "missing_labor_role", label: "Rôle MO manquant" },
  { value: "supplier_price_outdated", label: "Prix fournisseur obsolète" },
  { value: "labor_split_incomplete", label: "Répartition MO incomplète" },
  { value: "price_outlier", label: "Prix atypique" },
  { value: "quantity_outlier", label: "Quantité atypique" },
];

type FetchKey = readonly [string, string, string];

async function fetcher<T>([, , url]: FetchKey): Promise<T> {
  const response = await fetch(url);
  const json = (await response.json().catch(() => null)) as ApiEnvelope<unknown> | null;
  if (!response.ok || !json?.ok) {
    throw new Error(json?.error?.message ?? "Erreur lors du chargement.");
  }
  return json.data as T;
}

function useDebouncedValue(value: string, delay: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedValue(value), delay);
    return () => window.clearTimeout(timeoutId);
  }, [delay, value]);

  return debouncedValue;
}

function KpiCard({
  label,
  value,
  color = "text-foreground",
}: {
  label: string;
  value: number | string;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: CurrentAnomalyRow["severity"] }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        severity === "blocking"
          ? "bg-error-light text-danger"
          : "bg-warning-light text-warning"
      }`}
    >
      {severity === "blocking" ? "Bloquant" : "Avertissement"}
    </span>
  );
}

function TrendChart({ data }: { data: TrendPeriod[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-center text-sm text-muted-foreground">
        Aucune donnée de tendance disponible pour cette période.
      </div>
    );
  }

  const maxValue = Math.max(...data.flatMap((item) => [item.opened, item.resolved]), 1);
  const chartWidth = 600;
  const chartHeight = 200;
  const groupWidth = chartWidth / data.length;
  const barWidth = Math.max(groupWidth * 0.35, 4);

  return (
    <div
      className="overflow-x-auto"
      role="region"
      aria-label="Graphique de la tendance mensuelle"
      tabIndex={0}
    >
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight + 30}`}
        className="min-w-[36rem]"
        role="img"
        aria-label="Tendance mensuelle des anomalies ouvertes et résolues"
      >
        {data.map((item, index) => {
          const x = index * groupWidth + groupWidth * 0.15;
          const openedHeight = (item.opened / maxValue) * chartHeight;
          const resolvedHeight = (item.resolved / maxValue) * chartHeight;
          return (
            <g key={item.period}>
              <rect
                x={x}
                y={chartHeight - openedHeight}
                width={barWidth}
                height={openedHeight}
                fill="#ef4444"
                rx={2}
              />
              <rect
                x={x + barWidth + 2}
                y={chartHeight - resolvedHeight}
                width={barWidth}
                height={resolvedHeight}
                fill="#22c55e"
                rx={2}
              />
              <text
                x={index * groupWidth + groupWidth / 2}
                y={chartHeight + 20}
                textAnchor="middle"
                className="fill-slate-500 text-[10px]"
              >
                {item.period.slice(5)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="alert alert-error flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" role="alert">
      <span>{message}</span>
      <button type="button" className="btn btn-secondary min-h-11" onClick={onRetry}>
        Réessayer
      </button>
    </div>
  );
}

export function AnomalyHistoryClient({ tenantId }: { tenantId: string }) {
  const [selectedFlagTypes, setSelectedFlagTypes] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<25 | 50 | 100>(25);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search, 300);

  const currentParams = useMemo(() => {
    const params = new URLSearchParams({
      view: "current",
      page: String(page),
      size: String(pageSize),
    });
    if (selectedFlagTypes.length > 0) {
      params.set("flag_types", selectedFlagTypes.join(","));
    }
    if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
    if (ownerUserId) params.set("owner_user_id", ownerUserId);
    return params;
  }, [debouncedSearch, ownerUserId, page, pageSize, selectedFlagTypes]);

  const trendParams = useMemo(() => {
    const params = new URLSearchParams({ view: "trend" });
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    return params;
  }, [dateFrom, dateTo]);

  const currentUrl = `/api/admin/anomaly-history?${currentParams.toString()}`;
  const trendUrl = `/api/admin/anomaly-history?${trendParams.toString()}`;
  const {
    data: currentData,
    error: currentError,
    isLoading: isCurrentLoading,
    isValidating: isCurrentValidating,
    mutate: mutateCurrent,
  } = useSWR<CurrentAnomalyData>(
    ["anomaly-history-current", tenantId, currentUrl] as const,
    fetcher,
    { keepPreviousData: true }
  );
  const {
    data: trendData,
    error: trendError,
    isLoading: isTrendLoading,
    isValidating: isTrendValidating,
    mutate: mutateTrend,
  } = useSWR<TrendData>(
    ["anomaly-history-trend", tenantId, trendUrl] as const,
    fetcher,
    { keepPreviousData: true }
  );

  function updateCurrentFilters(action: () => void) {
    setPage(1);
    action();
  }

  function handleFlagTypeToggle(flagType: string) {
    updateCurrentFilters(() => {
      setSelectedFlagTypes((current) =>
        current.includes(flagType)
          ? current.filter((value) => value !== flagType)
          : [...current, flagType]
      );
    });
  }

  function resetCurrentFilters() {
    setSearch("");
    setOwnerUserId("");
    setSelectedFlagTypes([]);
    setPage(1);
  }

  async function handleExportCsv() {
    setExportError(null);
    setIsExporting(true);
    try {
      const params = new URLSearchParams(currentParams);
      params.delete("view");
      params.delete("page");
      params.delete("size");
      params.set("format", "csv");
      const response = await fetch(`/api/admin/anomaly-history?${params.toString()}`);
      if (!response.ok) throw new Error("L'export CSV a échoué.");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "anomaly-history.csv";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(
        error instanceof Error ? error.message : "Impossible d'exporter le fichier CSV."
      );
    } finally {
      setIsExporting(false);
    }
  }

  const hasCurrentFilters =
    search.trim().length > 0 || ownerUserId.length > 0 || selectedFlagTypes.length > 0;
  const currentRows = currentData?.currentAnomalies ?? [];
  const pagination = currentData?.pagination;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Historique des anomalies</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Suivi qualité des chiffrages pour l&apos;organisation.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleExportCsv()}
          disabled={isExporting || (isCurrentLoading && !currentData)}
          className="btn btn-primary min-h-11 w-full sm:w-auto"
        >
          {isExporting ? "Export en cours…" : "Exporter CSV"}
        </button>
      </div>

      {exportError ? <div className="alert alert-error" role="alert">{exportError}</div> : null}

      {currentData ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Anomalies" value={currentData.summary.totalAnomalies} />
          <KpiCard label="Bloquantes" value={currentData.summary.blockingCount} color="text-danger" />
          <KpiCard label="Avertissements" value={currentData.summary.warningCount} color="text-warning" />
          <KpiCard
            label="Devis concernés"
            value={`${currentData.summary.estimatesAffected} / ${currentData.summary.estimatesTotal}`}
          />
        </div>
      ) : null}

      <section className="rounded-xl border border-border bg-surface p-4" aria-labelledby="current-anomaly-filters">
        <div className="flex items-center justify-between gap-3">
          <h2 id="current-anomaly-filters" className="text-sm font-semibold text-foreground">
            Filtrer les anomalies courantes
          </h2>
          {hasCurrentFilters ? (
            <button type="button" className="min-h-11 text-sm font-medium text-[var(--brand-blue)] hover:underline" onClick={resetCurrentFilters}>
              Réinitialiser
            </button>
          ) : null}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="anomaly-search" className="mb-1 block text-xs font-medium text-muted-foreground">
              Recherche
            </label>
            <input
              id="anomaly-search"
              type="search"
              value={search}
              onChange={(event) => updateCurrentFilters(() => setSearch(event.target.value))}
              placeholder="Projet ou version…"
              className="form-input min-h-11 w-full"
            />
          </div>
          <div>
            <label htmlFor="anomaly-owner" className="mb-1 block text-xs font-medium text-muted-foreground">
              Chiffreur
            </label>
            <select
              id="anomaly-owner"
              value={ownerUserId}
              onChange={(event) => updateCurrentFilters(() => setOwnerUserId(event.target.value))}
              className="form-input min-h-11 w-full"
            >
              <option value="">Tous les chiffreurs</option>
              {(currentData?.ownerOptions ?? []).map((owner) => (
                <option key={owner.id} value={owner.id}>{owner.name}</option>
              ))}
            </select>
          </div>
        </div>
        <fieldset className="mt-4">
          <legend className="text-xs font-medium text-muted-foreground">Types d&apos;anomalies</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {FLAG_TYPE_OPTIONS.map((option) => {
              const selected = selectedFlagTypes.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => handleFlagTypeToggle(option.value)}
                  className={`min-h-11 rounded-full border px-3 py-2 text-xs font-medium transition ${
                    selected
                      ? "border-blue-500 bg-info-light text-info"
                      : "border-slate-300 bg-surface text-muted-foreground hover:bg-surface-subtle"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </fieldset>
      </section>

      {currentError && !currentData ? (
        <LoadError
          message={(currentError as Error).message ?? "Impossible de charger les anomalies."}
          onRetry={() => void mutateCurrent()}
        />
      ) : null}

      <section
        className={`rounded-xl border border-border bg-surface transition-opacity ${isCurrentValidating && currentData ? "opacity-60" : ""}`}
        aria-labelledby="current-anomalies-title"
        aria-busy={isCurrentValidating}
      >
        <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="current-anomalies-title" className="text-sm font-semibold text-foreground">
            Anomalies courantes
          </h2>
          {pagination ? (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {pagination.totalItems} résultat{pagination.totalItems > 1 ? "s" : ""}
            </p>
          ) : null}
        </div>

        {isCurrentLoading && !currentData ? (
          <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground" role="status">
            Chargement des anomalies…
          </div>
        ) : currentRows.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="font-medium text-foreground">Aucune anomalie détectée</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Modifiez les filtres ou actualisez les données.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-3 p-3 md:hidden">
              {currentRows.map((row) => (
                <article key={`${row.versionId}-${row.flagKey}`} className="rounded-lg border border-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/dashboard/estimates/${row.versionId}`} className="font-semibold text-[var(--brand-blue)] hover:underline">
                        {row.versionLabel}
                      </Link>
                      <p className="mt-1 [overflow-wrap:anywhere] text-sm font-medium text-foreground">{row.projectName}</p>
                    </div>
                    <SeverityBadge severity={row.severity} />
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Anomalie</dt>
                      <dd className="mt-0.5 text-foreground">{row.flagLabel}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Lignes</dt>
                      <dd className="mt-0.5 font-semibold tabular-nums text-foreground">{row.itemCount}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-xs text-muted-foreground">Chiffreur</dt>
                      <dd className="mt-0.5 text-foreground">{row.ownerName}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-surface-subtle">
                  <tr>
                    {[
                      ["Devis", ""],
                      ["Projet", ""],
                      ["Chiffreur", ""],
                      ["Anomalie", ""],
                      ["Sévérité", ""],
                      ["Nb lignes", "text-right"],
                    ].map(([label, className]) => (
                      <th key={label} scope="col" className={`px-4 py-2 font-medium text-muted-foreground ${className}`}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {currentRows.map((row) => (
                    <tr key={`${row.versionId}-${row.flagKey}`} className="border-b border-border last:border-b-0 hover:bg-surface-subtle">
                      <td className="px-4 py-3 font-mono text-xs">
                        <Link href={`/dashboard/estimates/${row.versionId}`} className="font-semibold text-[var(--brand-blue)] hover:underline">
                          {row.versionLabel}
                        </Link>
                      </td>
                      <td className="max-w-64 px-4 py-3 [overflow-wrap:anywhere] text-foreground">{row.projectName}</td>
                      <td className="px-4 py-3 text-secondary-foreground">{row.ownerName}</td>
                      <td className="px-4 py-3 text-secondary-foreground">{row.flagLabel}</td>
                      <td className="px-4 py-3"><SeverityBadge severity={row.severity} /></td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground">{row.itemCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {pagination ? (
          <div className="flex flex-col gap-3 border-t border-border p-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Par page
              <select
                aria-label="Nombre d'anomalies par page"
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value) as 25 | 50 | 100);
                  setPage(1);
                }}
                className="form-input min-h-11 w-24"
              >
                {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
            <div className="flex items-center justify-between gap-3 sm:justify-end">
              <button type="button" className="btn btn-secondary min-h-11" disabled={pagination.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                Précédent
              </button>
              <span className="text-sm tabular-nums text-muted-foreground">
                {pagination.page} / {pagination.totalPages}
              </span>
              <button type="button" className="btn btn-secondary min-h-11" disabled={pagination.page >= pagination.totalPages} onClick={() => setPage((value) => Math.min(pagination.totalPages, value + 1))}>
                Suivant
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-border bg-surface p-4" aria-labelledby="trend-title" aria-busy={isTrendValidating}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 id="trend-title" className="text-sm font-semibold text-foreground">Tendance mensuelle</h2>
            <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-red-500" />Ouvertes</span>
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-green-500" />Résolues</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-medium text-muted-foreground">
              Du
              <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="form-input mt-1 min-h-11 w-full" />
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              Au
              <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="form-input mt-1 min-h-11 w-full" />
            </label>
          </div>
        </div>

        {trendError && !trendData ? (
          <div className="mt-4">
            <LoadError message={(trendError as Error).message ?? "Impossible de charger la tendance."} onRetry={() => void mutateTrend()} />
          </div>
        ) : isTrendLoading && !trendData ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground" role="status">Chargement de la tendance…</div>
        ) : (
          <div className={`mt-4 transition-opacity ${isTrendValidating ? "opacity-60" : ""}`}>
            <TrendChart data={trendData?.trend ?? []} />
          </div>
        )}
      </section>

      {trendData?.avgResolution.length ? (
        <section className="rounded-xl border border-border bg-surface" aria-labelledby="resolution-title">
          <div className="border-b border-border px-4 py-3">
            <h2 id="resolution-title" className="text-sm font-semibold text-foreground">Temps moyen de résolution</h2>
          </div>
          <div
            className="overflow-x-auto"
            role="region"
            aria-label="Temps moyen de résolution par type d'anomalie"
            tabIndex={0}
          >
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-surface-subtle">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium text-muted-foreground">Type d&apos;anomalie</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium text-muted-foreground">Délai moyen (jours)</th>
                </tr>
              </thead>
              <tbody>
                {trendData.avgResolution.map((row) => (
                  <tr key={row.flagKey} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-3 text-foreground">{row.flagLabel}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">{row.avgDays}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
