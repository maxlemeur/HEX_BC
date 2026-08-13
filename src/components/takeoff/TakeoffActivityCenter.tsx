"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";

import {
  fetchTakeoffActivityCenter,
  isTakeoffApiError,
  type TakeoffActivityCenterResponse,
} from "@/lib/takeoff/client";
import { resolveActivityCenterLotLabel } from "@/lib/takeoff/activity-center-shared";
import type { TakeoffDocumentRecommendation } from "@/lib/takeoff/document-classifier";
import { LaunchMetreDialog } from "@/components/affaires/LaunchMetreDialog";
import { ProductionRibbon } from "@/components/dashboard/ProductionRibbon";
import {
  BUSINESS_STATUS_FILTER_OPTIONS,
  BUSINESS_LEVEL_FILTER_OPTIONS,
  JobsTableSkeleton,
  PAGE_SIZE_OPTIONS,
  PERIOD_FILTER_OPTIONS,
  TAKEOFF_LIST_REFRESH_INTERVAL_MS,
  resolveErrorTitle,
} from "@/components/takeoff/takeoff-job-list-shared";

import TakeoffJobsTable from "./TakeoffJobsTable";
import TakeoffExceptionsTab from "./TakeoffExceptionsTab";
import TakeoffApplicationHistoryTab from "./TakeoffApplicationHistoryTab";

type LaunchContext = {
  currentVersion: {
    id: string;
    status: string;
    versionNumber: number;
  } | null;
  plansContext: {
    defaultPlanSetId: string | null;
    defaultPlanSetName?: string | null;
    defaultPlanSetSource?: string | null;
    defaultPlanSetFileCount?: number;
    launchRecommendation?: TakeoffDocumentRecommendation | null;
  } | null;
  availableVersions: Array<{
    id: string;
    versionNumber: number;
  }>;
};

type Props = {
  projectId: string;
  versions: Array<{ id: string; version_number: number }>;
  planSets: Array<{
    id: string;
    name: string;
    metadata?: Record<string, unknown> | null;
    fileCount?: number;
  }>;
  launchContext?: LaunchContext | null;
  ribbonHeader?: ReactNode;
  ribbonPreamble?: ReactNode;
};

const TABS = [
  { key: "jobs", label: "Analyses" },
  { key: "exceptions", label: "Exceptions" },
  { key: "history", label: "Historique" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function TakeoffActivityCenter({
  projectId,
  versions,
  planSets,
  launchContext = null,
  ribbonHeader,
  ribbonPreamble,
}: Props) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const VALID_TABS = new Set<TabKey>(TABS.map((t) => t.key));
  const rawTab = searchParams.get("tab") ?? "jobs";
  const activeTab: TabKey = VALID_TABS.has(rawTab as TabKey)
    ? (rawTab as TabKey)
    : "jobs";
  const selectedVersion = searchParams.get("version") ?? "all";
  const selectedLot = searchParams.get("lot") ?? "all";
  const selectedPlanSet = searchParams.get("planSet") ?? "all";
  const selectedStatus = searchParams.get("status") ?? "all";
  const selectedLevel = searchParams.get("level") ?? "all";
  const selectedPeriod = searchParams.get("period") ?? "all";
  const requestedPlanSetId = searchParams.get("launchPlanSet");

  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);
  const [isLaunchDialogOpen, setIsLaunchDialogOpen] = useState(
    searchParams.get("launch") === "1",
  );
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const rawOffset = Number(searchParams.get("offset") ?? "0");
  const pageOffset =
    Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

  const tabListRef = useRef<HTMLDivElement>(null);

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "all") {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      const nextSearch = params.toString();
      router.push(nextSearch ? `${pathname}?${nextSearch}` : pathname, {
        scroll: false,
      });
    },
    [searchParams, router, pathname]
  );

  const computeRefreshInterval = useCallback(
    (latestData?: TakeoffActivityCenterResponse) => {
      if (!latestData) return 0;
      const hasProcessing = latestData.counters.technicalJobs > 0;
      const hasPending = latestData.jobs?.some(
        (job) => job.statusRaw === "queued"
      );
      return hasProcessing || hasPending ? TAKEOFF_LIST_REFRESH_INTERVAL_MS : 0;
    },
    []
  );

  const { data, error, isLoading, mutate } = useSWR(
    activeTab === "jobs"
      ? [
          "activity-center",
          projectId,
          selectedVersion,
          selectedLot,
          selectedPlanSet,
          selectedStatus,
          selectedLevel,
          selectedPeriod,
          pageOffset,
          pageSize,
        ]
      : null,
    () =>
      fetchTakeoffActivityCenter(projectId, {
        versionId: selectedVersion !== "all" ? selectedVersion : null,
        lot: selectedLot !== "all" ? selectedLot : null,
        planSetId: selectedPlanSet !== "all" ? selectedPlanSet : null,
        status: selectedStatus !== "all" ? selectedStatus : null,
        level: selectedLevel !== "all" ? selectedLevel : null,
        period: selectedPeriod !== "all" ? selectedPeriod : null,
        limit: pageSize,
        offset: pageOffset,
      }),
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      refreshInterval: computeRefreshInterval,
      keepPreviousData: true,
    }
  );

  // Derive lot options from project-scoped plan-set metadata so filtering is stable across pages.
  const lotOptions = (() => {
    const lots = new Set<string>();

    for (const planSet of planSets) {
      const lotLabel = resolveActivityCenterLotLabel(planSet);
      if (lotLabel) {
        lots.add(lotLabel);
      }
    }

    if (selectedLot !== "all") {
      lots.add(selectedLot);
    }

    return [
      { value: "all", label: "Tous les lots" },
      ...[...lots].sort().map((lot) => ({ value: lot, label: lot })),
    ];
  })();

  const statusOptions = BUSINESS_STATUS_FILTER_OPTIONS;
  const hasActiveJobFilters =
    selectedVersion !== "all" ||
    selectedLot !== "all" ||
    selectedPlanSet !== "all" ||
    selectedStatus !== "all" ||
    selectedLevel !== "all" ||
    selectedPeriod !== "all";
  const activeJobFilterCount = [
    selectedVersion,
    selectedLot,
    selectedPlanSet,
    selectedStatus,
    selectedLevel,
    selectedPeriod,
  ].filter((value) => value !== "all").length;
  const hasVisibleAnalyses = Boolean(
    data && (data.jobs.length > 0 || data.pagination.total > 0)
  );
  const shouldShowFilters =
    activeTab === "jobs" && (hasActiveJobFilters || hasVisibleAnalyses);
  const firstUsablePlanSet = planSets.find(
    (planSet) => (planSet.fileCount ?? 0) > 0,
  );

  const resetJobFilters = useCallback(() => {
    setFiltersExpanded(false);
    updateParams({
      version: null,
      lot: null,
      planSet: null,
      status: null,
      level: null,
      period: null,
      offset: null,
    });
  }, [updateParams]);

  const handleLaunchDialogOpenChange = useCallback(
    (open: boolean) => {
      setIsLaunchDialogOpen(open);
      if (!open && searchParams.get("launch") === "1") {
        updateParams({ launch: null, launchPlanSet: null });
      }
    },
    [searchParams, updateParams],
  );

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const tabKeys = TABS.map((t) => t.key);
      const currentIndex = tabKeys.indexOf(activeTab);
      let nextIndex = currentIndex;

      if (e.key === "ArrowRight") {
        nextIndex = (currentIndex + 1) % tabKeys.length;
      } else if (e.key === "ArrowLeft") {
        nextIndex = (currentIndex - 1 + tabKeys.length) % tabKeys.length;
      } else {
        return;
      }

      e.preventDefault();
      updateParams({ tab: tabKeys[nextIndex] });

      const nextButton = tabListRef.current?.querySelector<HTMLButtonElement>(
        `#tab-${tabKeys[nextIndex]}`
      );
      nextButton?.focus();
    },
    [activeTab, updateParams]
  );

  // Focus active tab on mount
  useEffect(() => {
    const activeButton = tabListRef.current?.querySelector<HTMLButtonElement>(
      `#tab-${activeTab}`
    );
    if (activeButton && document.activeElement === tabListRef.current) {
      activeButton.focus();
    }
  }, [activeTab]);

  const errorStatus = isTakeoffApiError(error) ? error.status : null;
  const errorMessage =
    isTakeoffApiError(error) && error.message
      ? error.message
      : "Impossible de charger le centre d'activité.";

  return (
    <div>
      <ProductionRibbon
        ariaLabel="Ruban métier des métrés"
        testId="takeoff-activity-production-ribbon"
      >
        {ribbonHeader}
        <div
          ref={tabListRef}
          role="tablist"
          aria-label="Onglets du centre d'activité"
          className="production-ribbon__tabs"
          onKeyDown={handleTabKeyDown}
        >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              id={`tab-${tab.key}`}
              role="tab"
              type="button"
              aria-selected={isActive}
              aria-controls={`tabpanel-${tab.key}`}
              tabIndex={isActive ? 0 : -1}
              className="production-ribbon__tab min-h-11 sm:min-h-[38px]"
              data-active={isActive ? "true" : undefined}
              onClick={() => updateParams({ tab: tab.key })}
            >
              {tab.label}
            </button>
          );
          })}
        </div>
      </ProductionRibbon>

      {ribbonPreamble ? <div className="mt-4">{ribbonPreamble}</div> : null}

      {/* Filter bar */}
      {shouldShowFilters ? (
        <div className="mb-4">
          <div className="sm:hidden">
            <button
              type="button"
              className="btn btn-secondary min-h-11 w-full justify-between px-4"
              aria-expanded={filtersExpanded}
              aria-controls="takeoff-analysis-filters"
              onClick={() => setFiltersExpanded((expanded) => !expanded)}
            >
              <span>
                Filtres
                {activeJobFilterCount > 0 ? ` (${activeJobFilterCount})` : ""}
              </span>
              <span aria-hidden="true">{filtersExpanded ? "−" : "+"}</span>
            </button>
          </div>

          <div
            id="takeoff-analysis-filters"
            data-testid="takeoff-analysis-filters"
            className={`${filtersExpanded ? "grid" : "hidden"} mt-3 min-w-0 grid-cols-1 gap-3 sm:mt-0 sm:grid sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end`}
            aria-label="Filtres des analyses"
          >
          <div className="flex min-w-0 flex-col gap-1.5">
            <label
              htmlFor="filter-version"
              className="text-xs font-semibold text-[var(--slate-500)]"
            >
              Version
            </label>
            <select
              id="filter-version"
              className="form-input form-select form-input--sm h-11 w-full min-w-0 sm:h-9 lg:min-w-[120px]"
              value={selectedVersion}
              onChange={(e) =>
                updateParams({ version: e.target.value, offset: null })
              }
            >
              <option value="all">Toutes versions</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  V{v.version_number}
                </option>
              ))}
            </select>
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <label
              htmlFor="filter-lot"
              className="text-xs font-semibold text-[var(--slate-500)]"
            >
              Lot
            </label>
            <select
              id="filter-lot"
              className="form-input form-select form-input--sm h-11 w-full min-w-0 sm:h-9 lg:min-w-[120px]"
              value={selectedLot}
              onChange={(e) =>
                updateParams({ lot: e.target.value, offset: null })
              }
            >
              {lotOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <label
              htmlFor="filter-planSet"
              className="text-xs font-semibold text-[var(--slate-500)]"
            >
              Jeu de plans
            </label>
            <select
              id="filter-planSet"
              className="form-input form-select form-input--sm h-11 w-full min-w-0 sm:h-9 lg:min-w-[120px]"
              value={selectedPlanSet}
              onChange={(e) =>
                updateParams({ planSet: e.target.value, offset: null })
              }
            >
              <option value="all">Tous les jeux</option>
              {planSets.map((ps) => (
                <option key={ps.id} value={ps.id}>
                  {ps.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <label
              htmlFor="filter-status"
              className="text-xs font-semibold text-[var(--slate-500)]"
            >
              Statut
            </label>
            <select
              id="filter-status"
              className="form-input form-select form-input--sm h-11 w-full min-w-0 sm:h-9 lg:min-w-[120px]"
              value={selectedStatus}
              onChange={(e) =>
                updateParams({ status: e.target.value, offset: null })
              }
            >
              {statusOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <label
              htmlFor="filter-level"
              className="text-xs font-semibold text-[var(--slate-500)]"
            >
              Niveau
            </label>
            <select
              id="filter-level"
              className="form-input form-select form-input--sm h-11 w-full min-w-0 sm:h-9 lg:min-w-[120px]"
              value={selectedLevel}
              onChange={(e) =>
                updateParams({ level: e.target.value, offset: null })
              }
            >
              {BUSINESS_LEVEL_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <label
              htmlFor="filter-period"
              className="text-xs font-semibold text-[var(--slate-500)]"
            >
              Période
            </label>
            <select
              id="filter-period"
              className="form-input form-select form-input--sm h-11 w-full min-w-0 sm:h-9 lg:min-w-[120px]"
              value={selectedPeriod}
              onChange={(e) =>
                updateParams({ period: e.target.value, offset: null })
              }
            >
              {PERIOD_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        </div>
      ) : null}

      {/* Tab panels */}
      <div
        role="tabpanel"
        id={`tabpanel-${activeTab}`}
        aria-labelledby={`tab-${activeTab}`}
      >
        {activeTab === "jobs" &&
          (isLoading ? (
            <JobsTableSkeleton />
          ) : error ? (
            <section className="dashboard-card mt-4 p-6">
              <h2 className="text-xl font-black text-[var(--slate-800)]">
                {resolveErrorTitle(errorStatus)}
              </h2>
              <p className="mt-2 text-sm text-[var(--slate-600)]">
                {errorMessage}
              </p>
              <button
                type="button"
                className="btn btn-secondary btn-sm mt-4"
                onClick={() => void mutate()}
              >
                Réessayer
              </button>
            </section>
          ) : data ? (
            <TakeoffJobsTable
              projectId={projectId}
              data={data}
              emptyState={
                hasActiveJobFilters
                  ? {
                      title: "Aucune analyse ne correspond",
                      description:
                        "Modifiez ou réinitialisez vos filtres pour retrouver vos analyses.",
                      actionLabel: "Réinitialiser les filtres",
                      onAction: resetJobFilters,
                    }
                  : launchContext && firstUsablePlanSet
                    ? {
                        title: "Prêt pour votre premier métré",
                        description:
                          `Le jeu « ${firstUsablePlanSet.name} » est prêt. Lancez l’analyse pour obtenir vos premières quantités.`,
                        actionLabel: "Lancer le premier métré",
                        onAction: () => setIsLaunchDialogOpen(true),
                      }
                    : planSets.length > 0
                      ? {
                          title: "Ajoutez un PDF pour lancer le métré",
                          description:
                            "Les jeux de plans existent, mais ils ne contiennent encore aucun fichier à analyser.",
                          actionLabel: "Ajouter des plans",
                          actionHref: `/dashboard/affaires/${projectId}/plans`,
                        }
                    : {
                        title: "Ajoutez vos plans pour commencer",
                        description:
                          "Créez un jeu de plans, ajoutez vos fichiers PDF, puis lancez votre premier métré.",
                        actionLabel: "Ajouter un jeu de plans",
                        actionHref: `/dashboard/affaires/${projectId}/plans`,
                      }
              }
              onPageChange={(offset) =>
                updateParams({ offset: offset > 0 ? String(offset) : null })
              }
              onPageSizeChange={(size) => {
                setPageSize(size);
                updateParams({ offset: null });
              }}
              pageSize={pageSize}
            />
          ) : null)}
        {activeTab === "exceptions" && (
          <TakeoffExceptionsTab
            projectId={projectId}
            versionId={selectedVersion !== "all" ? selectedVersion : null}
          />
        )}
        {activeTab === "history" && (
          <TakeoffApplicationHistoryTab
            projectId={projectId}
            versionId={selectedVersion !== "all" ? selectedVersion : null}
          />
        )}
      </div>

      {launchContext ? (
        <LaunchMetreDialog
          open={isLaunchDialogOpen}
          onOpenChange={handleLaunchDialogOpenChange}
          onLaunched={() => {
            void mutate();
          }}
          projectId={projectId}
          currentVersion={launchContext.currentVersion}
          plansContext={launchContext.plansContext}
          availableVersions={launchContext.availableVersions}
          availablePlanSets={planSets.map((planSet) => ({
            id: planSet.id,
            name: planSet.name,
            fileCount: planSet.fileCount ?? 0,
            source:
              typeof planSet.metadata?.source === "string"
                ? planSet.metadata.source
                : null,
          }))}
          initialPlanSetId={requestedPlanSetId}
        />
      ) : null}
    </div>
  );
}
