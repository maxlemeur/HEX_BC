"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, ShieldCheckIcon } from "lucide-react";
import useSWR from "swr";

import { EmptyState } from "@/components/layout/empty-state";
import { LoadingState } from "@/components/layout/loading-state";
import { PageHeader } from "@/components/layout/page-header";
import { PageSection } from "@/components/layout/page-section";
import { StatCard, StatGrid } from "@/components/layout/stat-card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

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

function SeverityBadge({ severity }: { severity: CurrentAnomalyRow["severity"] }) {
  return (
    <Badge variant={severity === "blocking" ? "danger" : "warning"} dot>
      {severity === "blocking" ? "Bloquant" : "Avertissement"}
    </Badge>
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
      className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      role="region"
      aria-label="Graphique de la tendance mensuelle"
      tabIndex={0}
    >
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight + 30}`}
        className="mx-auto block max-h-72 w-full min-w-[36rem]"
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
                className="fill-danger"
                rx={2}
              />
              <rect
                x={x + barWidth + 2}
                y={chartHeight - resolvedHeight}
                width={barWidth}
                height={resolvedHeight}
                className="fill-success"
                rx={2}
              />
              <text
                x={index * groupWidth + groupWidth / 2}
                y={chartHeight + 20}
                textAnchor="middle"
                className="fill-muted-foreground text-micro"
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
    <Alert variant="danger">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span>{message}</span>
        <Button variant="outline" size="lg" className="min-h-11" onClick={onRetry}>
          Réessayer
        </Button>
      </div>
    </Alert>
  );
}

export function AnomalyHistoryClient({ tenantId }: { tenantId: string }) {
  const fieldId = useId();
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
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={[
          { label: "Administration", href: "/dashboard/admin" },
          { label: "Historique des anomalies" },
        ]}
        title="Historique des anomalies"
        description="Suivi qualité des chiffrages pour l'organisation."
        actions={
          <Button
            variant="primary"
            size="lg"
            onClick={() => void handleExportCsv()}
            disabled={isExporting || (isCurrentLoading && !currentData)}
            className="min-h-11 w-full sm:w-auto"
            leftIcon={<DownloadIcon aria-hidden="true" />}
          >
            {isExporting ? "Export en cours…" : "Exporter CSV"}
          </Button>
        }
      />

      <div className="flex flex-col gap-6">
        {exportError ? <Alert variant="danger">{exportError}</Alert> : null}

        {currentData ? (
          <StatGrid label="Synthèse des anomalies">
            <StatCard label="Anomalies" value={currentData.summary.totalAnomalies} />
            <StatCard label="Bloquantes" value={currentData.summary.blockingCount} tone="danger" />
            <StatCard label="Avertissements" value={currentData.summary.warningCount} tone="warning" />
            <StatCard
              label="Devis concernés"
              value={`${currentData.summary.estimatesAffected} / ${currentData.summary.estimatesTotal}`}
            />
          </StatGrid>
        ) : null}

        <PageSection
          id="current-anomaly-filters"
          title="Filtrer les anomalies courantes"
          actions={
            hasCurrentFilters ? (
              <Button variant="link" className="min-h-11" onClick={resetCurrentFilters}>
                Réinitialiser
              </Button>
            ) : null
          }
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="anomaly-search">Recherche</FieldLabel>
              <Input
                id="anomaly-search"
                type="search"
                value={search}
                onChange={(event) => updateCurrentFilters(() => setSearch(event.target.value))}
                placeholder="Projet ou version…"
                className="min-h-11"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="anomaly-owner">Chiffreur</FieldLabel>
              <NativeSelect
                id="anomaly-owner"
                value={ownerUserId}
                onChange={(event) => updateCurrentFilters(() => setOwnerUserId(event.target.value))}
                className="min-h-11"
              >
                <option value="">Tous les chiffreurs</option>
                {(currentData?.ownerOptions ?? []).map((owner) => (
                  <option key={owner.id} value={owner.id}>{owner.name}</option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <fieldset className="mt-4">
            <legend className="text-sm font-medium text-foreground">Types d&apos;anomalies</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {FLAG_TYPE_OPTIONS.map((option) => {
                const selected = selectedFlagTypes.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => handleFlagTypeToggle(option.value)}
                    className={cn(
                      "min-h-11 rounded-full border px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      selected
                        ? "border-info-border bg-info-subtle text-info"
                        : "border-border-strong bg-surface text-muted-foreground hover:bg-surface-subtle"
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </PageSection>

        {currentError && !currentData ? (
          <LoadError
            message={(currentError as Error).message ?? "Impossible de charger les anomalies."}
            onRetry={() => void mutateCurrent()}
          />
        ) : null}

        <PageSection
          id="current-anomalies-title"
          title="Anomalies courantes"
          flush
          className={cn("transition-opacity", isCurrentValidating && currentData && "opacity-60")}
          actions={
            pagination ? (
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {pagination.totalItems} résultat{pagination.totalItems > 1 ? "s" : ""}
              </p>
            ) : null
          }
        >
          <div aria-busy={isCurrentValidating}>
            {isCurrentLoading && !currentData ? (
              <LoadingState label="Chargement des anomalies…" className="min-h-40" />
            ) : currentRows.length === 0 ? (
              <EmptyState
                variant="plain"
                icon={<ShieldCheckIcon />}
                title="Aucune anomalie détectée"
                description="Modifiez les filtres ou actualisez les données."
              />
            ) : (
              <>
                <div className="space-y-3 p-3 md:hidden">
                  {currentRows.map((row) => (
                    <article key={`${row.versionId}-${row.flagKey}`} className="rounded-lg border border-border p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link href={`/dashboard/estimates/${row.versionId}`} className="font-semibold text-primary hover:underline">
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

                <div
                  role="region"
                  aria-label="Liste des anomalies courantes"
                  tabIndex={0}
                  className="hidden overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring md:block"
                >
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-border bg-surface-subtle">
                      <tr>
                        {[
                          ["Devis", ""],
                          ["Projet", ""],
                          ["Chiffreur", ""],
                          ["Anomalie", ""],
                          ["Sévérité", ""],
                          ["Lignes", "text-right"],
                        ].map(([label, className]) => (
                          <th key={label} scope="col" className={cn("px-4 py-2 font-medium text-muted-foreground", className)}>
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {currentRows.map((row) => (
                        <tr key={`${row.versionId}-${row.flagKey}`} className="border-b border-border last:border-b-0 hover:bg-surface-subtle">
                          <td className="px-4 py-3 font-mono text-xs">
                            <Link href={`/dashboard/estimates/${row.versionId}`} className="font-semibold text-primary hover:underline">
                              {row.versionLabel}
                            </Link>
                          </td>
                          <td className="max-w-64 px-4 py-3 [overflow-wrap:anywhere] text-foreground">{row.projectName}</td>
                          <td className="px-4 py-3 text-foreground-secondary">{row.ownerName}</td>
                          <td className="px-4 py-3 text-foreground-secondary">{row.flagLabel}</td>
                          <td className="px-4 py-3"><SeverityBadge severity={row.severity} /></td>
                          <td className="px-4 py-3 text-right tabular-nums text-foreground">{row.itemCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          {pagination ? (
            <div className="flex flex-col gap-3 border-t border-border-subtle p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <label htmlFor={`${fieldId}-page-size`} className="text-sm text-muted-foreground">
                  Par page
                </label>
                <NativeSelect
                  id={`${fieldId}-page-size`}
                  size="sm"
                  wrapperClassName="w-24"
                  className="min-h-11 sm:min-h-0"
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value) as 25 | 50 | 100);
                    setPage(1);
                  }}
                >
                  {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
                </NativeSelect>
              </div>
              <nav aria-label="Pagination des anomalies" className="flex items-center justify-between gap-3 sm:justify-end">
                <Button
                  variant="outline"
                  size="md"
                  className="min-h-11 sm:min-h-0"
                  leftIcon={<ChevronLeftIcon aria-hidden="true" />}
                  disabled={pagination.page <= 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  Précédent
                </Button>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {pagination.page} / {pagination.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="md"
                  className="min-h-11 sm:min-h-0"
                  rightIcon={<ChevronRightIcon aria-hidden="true" />}
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => setPage((value) => Math.min(pagination.totalPages, value + 1))}
                >
                  Suivant
                </Button>
              </nav>
            </div>
          ) : null}
        </PageSection>

        <PageSection
          id="trend-title"
          title="Tendance mensuelle"
          actions={
            <div className="grid w-full grid-cols-2 gap-3 sm:w-auto">
              <Field className="gap-1">
                <FieldLabel htmlFor={`${fieldId}-date-from`} className="text-xs">Du</FieldLabel>
                <Input
                  id={`${fieldId}-date-from`}
                  type="date"
                  size="sm"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                  className="min-h-11 sm:min-h-0"
                />
              </Field>
              <Field className="gap-1">
                <FieldLabel htmlFor={`${fieldId}-date-to`} className="text-xs">Au</FieldLabel>
                <Input
                  id={`${fieldId}-date-to`}
                  type="date"
                  size="sm"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  className="min-h-11 sm:min-h-0"
                />
              </Field>
            </div>
          }
        >
          <div aria-busy={isTrendValidating}>
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-3 rounded-sm bg-danger" />Ouvertes</span>
              <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-3 rounded-sm bg-success" />Résolues</span>
            </div>

            {trendError && !trendData ? (
              <div className="mt-4">
                <LoadError message={(trendError as Error).message ?? "Impossible de charger la tendance."} onRetry={() => void mutateTrend()} />
              </div>
            ) : isTrendLoading && !trendData ? (
              <LoadingState label="Chargement de la tendance…" className="h-48" />
            ) : (
              <div className={cn("mt-4 transition-opacity", isTrendValidating && "opacity-60")}>
                <TrendChart data={trendData?.trend ?? []} />
              </div>
            )}
          </div>
        </PageSection>

        {trendData?.avgResolution.length ? (
          <PageSection id="resolution-title" title="Temps moyen de résolution" flush>
            <div
              className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
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
          </PageSection>
        ) : null}
      </div>
    </div>
  );
}
