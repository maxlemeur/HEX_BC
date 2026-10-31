"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { ArrowRight, SlidersHorizontalIcon } from "lucide-react";

import {
  fetchTakeoffActivityCenter,
  isTakeoffApiError,
  type TakeoffActivityCenterResponse,
} from "@/lib/takeoff/client";
import { resolveActivityCenterLotLabel } from "@/lib/takeoff/activity-center-shared";
import { LaunchMetreDialog } from "@/components/affaires/LaunchMetreDialog";
import {
  JourneyFacts,
  JourneyNext,
  JourneyPanel,
  JourneyTextLink,
} from "@/components/journey/JourneyPage";
import { useDelayedLoadingIndicator } from "@/hooks/useDelayedLoadingIndicator";
import type { TakeoffLaunchContext } from "@/lib/takeoff/launch-context";
import {
  BUSINESS_STATUS_FILTER_OPTIONS,
  BUSINESS_LEVEL_FILTER_OPTIONS,
  JobsTableSkeleton,
  PAGE_SIZE_OPTIONS,
  PERIOD_FILTER_OPTIONS,
  TAKEOFF_LIST_REFRESH_INTERVAL_MS,
  formatCount,
  resolveErrorTitle,
} from "@/components/takeoff/takeoff-job-list-shared";

import TakeoffJobsTable from "./TakeoffJobsTable";
import TakeoffExceptionsTab from "./TakeoffExceptionsTab";
import TakeoffApplicationHistoryTab from "./TakeoffApplicationHistoryTab";
import {
  resolveTakeoffNextStep,
  type TakeoffLatestJobContext,
  type TakeoffNextStepAction,
} from "./TakeoffActivityNextStep";
import { Button, buttonVariants } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";

type Props = {
  projectId: string;
  versions: Array<{ id: string; version_number: number }>;
  planSets: Array<{
    id: string;
    name: string;
    metadata?: Record<string, unknown> | null;
    fileCount?: number;
  }>;
  launchContext?: TakeoffLaunchContext | null;
  /** The server's view of the latest analysis (review version, failure reason), as on the hub. */
  latestJobContext?: TakeoffLatestJobContext | null;
  /** The affaire already has an analysis: the tracking panel is laid out before the list loads. */
  initialHasAnalyses?: boolean;
  /** The page heading, above the next step. */
  header?: ReactNode;
  /** Folded explanations, at the foot of the « Repères ». */
  help?: ReactNode;
};

const TABS = [
  { key: "jobs", label: "Analyses" },
  { key: "exceptions", label: "Exceptions" },
  { key: "history", label: "Historique" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const FILTER_KEYS = ["version", "lot", "planSet", "status", "level", "period"] as const;

type ActivityKey = readonly [
  scope: "activity-center",
  projectId: string,
  version: string,
  lot: string,
  planSet: string,
  status: string,
  level: string,
  period: string,
  offset: number,
  limit: number,
];

function fetchActivityPage([, projectId, version, lot, planSet, status, level, period, offset, limit]: ActivityKey) {
  const filter = (value: string) => (value !== "all" ? value : null);
  return fetchTakeoffActivityCenter(projectId, {
    versionId: filter(version),
    lot: filter(lot),
    planSetId: filter(planSet),
    status: filter(status),
    level: filter(level),
    period: filter(period),
    limit,
    offset,
  });
}

export default function TakeoffActivityCenter({
  projectId,
  versions,
  planSets,
  launchContext = null,
  latestJobContext = null,
  initialHasAnalyses = false,
  header,
  help,
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
  // Filters stay folded unless the page opens with some already applied.
  const [filtersExpanded, setFiltersExpanded] = useState(() =>
    FILTER_KEYS.some((key) => (searchParams.get(key) ?? "all") !== "all"),
  );
  const rawOffset = Number(searchParams.get("offset") ?? "0");
  const pageOffset =
    Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

  const tabListRef = useRef<HTMLDivElement>(null);
  const filtersToggleRef = useRef<HTMLButtonElement>(null);

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

  // The next step and the « Repères » read the affaire's newest analyses on every view,
  // whatever the filters; the unfiltered first page of the list is this same request.
  const summaryKey: ActivityKey = ["activity-center", projectId, "all", "all", "all", "all", "all", "all", 0, PAGE_SIZE_OPTIONS[0]];
  const {
    data: summaryData,
    error: summaryError,
    isLoading: isSummaryLoading,
    mutate: mutateSummary,
  } = useSWR(summaryKey, fetchActivityPage, {
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    refreshInterval: computeRefreshInterval,
    shouldRetryOnError: false,
  });
  const { data: listData, error: listError, mutate: mutateList } = useSWR(
    activeTab === "jobs"
      ? ([
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
        ] satisfies ActivityKey)
      : null,
    fetchActivityPage,
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      refreshInterval: computeRefreshInterval,
      keepPreviousData: true,
      shouldRetryOnError: false,
    }
  );
  const isSlowLoading = useDelayedLoadingIndicator(isSummaryLoading);

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
  const activeJobFilterCount = [
    selectedVersion,
    selectedLot,
    selectedPlanSet,
    selectedStatus,
    selectedLevel,
    selectedPeriod,
  ].filter((value) => value !== "all").length;
  const hasActiveJobFilters = activeJobFilterCount > 0;
  const hasAnalyses = summaryData
    ? summaryData.pagination.total > 0
    : initialHasAnalyses;
  const shouldShowFilters =
    activeTab === "jobs" && (hasActiveJobFilters || hasAnalyses);
  const firstUsablePlanSet = planSets.find(
    (planSet) => (planSet.fileCount ?? 0) > 0,
  );
  // Nothing to follow yet: the next step alone says how to start. The panel does not depend
  // on the view, so switching views never removes the control that has the focus.
  const showTracking = !summaryError && (hasAnalyses || hasActiveJobFilters);

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
    // The reset button folds away with the filters: the focus stays on their toggle.
    filtersToggleRef.current?.focus();
    // Setters are listed: the React Compiler lint does not infer them as stable in this component.
  }, [updateParams, setFiltersExpanded]);

  const handleLaunchDialogOpenChange = useCallback(
    (open: boolean) => {
      setIsLaunchDialogOpen(open);
      if (!open && searchParams.get("launch") === "1") {
        updateParams({ launch: null, launchPlanSet: null });
      }
    },
    [searchParams, updateParams, setIsLaunchDialogOpen],
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

  const errorStatus = isTakeoffApiError(summaryError) ? summaryError.status : null;
  const errorMessage =
    isTakeoffApiError(summaryError) && summaryError.message
      ? summaryError.message
      : "Impossible de charger les analyses.";

  const nextStep = summaryData
    ? resolveTakeoffNextStep({
        projectId,
        latestJob: summaryData.jobs[0] ?? null,
        latestJobContext,
        canLaunch: launchContext !== null,
        firstUsablePlanSetName: firstUsablePlanSet?.name ?? null,
        planSetCount: planSets.length,
      })
    : null;
  // Always mounted, so a step that changes by itself (an analysis that ends) is announced.
  const announcement = summaryError
    ? resolveErrorTitle(errorStatus)
    : nextStep?.title ?? (isSlowLoading ? "Le chargement prend plus de temps que prévu…" : "");

  function renderNextAction(action: TakeoffNextStepAction | null) {
    if (!action) return null;
    const content = <>{action.label}<ArrowRight size={14} aria-hidden="true" /></>;
    return action.kind === "href" ? (
      <Link href={action.href} className={buttonVariants({ variant: "primary" })}>{content}</Link>
    ) : (
      <Button variant="primary" onClick={() => setIsLaunchDialogOpen(true)}>
        {content}
      </Button>
    );
  }

  const counters = summaryData?.counters;
  const countFact = (value: number | undefined) =>
    summaryError ? "Indisponible" : value === undefined ? "…" : formatCount(value);

  return (
    <div className="journey-page">
      {header}

      <div className="journey-grid">
        <JourneyPanel headingId="takeoff-next-heading" title="Métré de l’affaire">
          <p className="sr-only" role="status">{announcement}</p>
          {summaryError ? (
            <JourneyNext
              title={resolveErrorTitle(errorStatus)}
              description={errorMessage}
              action={
                <Button variant="outline" onClick={() => void mutateSummary()}>
                  Réessayer
                </Button>
              }
            />
          ) : nextStep ? (
            <JourneyNext
              title={nextStep.title}
              description={nextStep.description}
              action={renderNextAction(nextStep.action)}
            />
          ) : (
            <div className="journey-panel-body">
              <p className="text-sm text-muted-foreground">
                {isSlowLoading
                  ? "Le chargement prend plus de temps que prévu…"
                  : "Chargement des analyses…"}
              </p>
            </div>
          )}
        </JourneyPanel>

        <JourneyFacts
          label="Repères des métrés"
          facts={[
            { label: "Analyses en cours", value: countFact(counters?.technicalJobs) },
            { label: "Analyses exploitables", value: countFact(counters?.usableJobs) },
            { label: "Jeux de plans", value: formatCount(planSets.length) },
          ]}
        >
          <div className="journey-facts-actions">
            <JourneyTextLink href={`/dashboard/affaires/${projectId}/plans`}>
              Gérer les plans
            </JourneyTextLink>
          </div>
          {help}
        </JourneyFacts>
      </div>

      {showTracking ? (
        <section className="journey-panel" aria-labelledby="takeoff-tracking-heading">
          <header className="journey-panel-heading">
            <h2 id="takeoff-tracking-heading">Suivi des analyses</h2>
            <div className="flex flex-wrap items-center gap-2">
              <div
                ref={tabListRef}
                role="tablist"
                aria-label="Vues du suivi des analyses"
                className="journey-view-switch"
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
                      onClick={() => updateParams({ tab: tab.key })}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
              {shouldShowFilters ? (
                <Button
                  ref={filtersToggleRef}
                  variant="ghost"
                  size="sm"
                  aria-expanded={filtersExpanded}
                  aria-controls="takeoff-analysis-filters"
                  onClick={() => setFiltersExpanded((expanded) => !expanded)}
                >
                  <SlidersHorizontalIcon aria-hidden="true" />
                  Filtres
                  {activeJobFilterCount > 0 ? ` (${activeJobFilterCount})` : ""}
                </Button>
              ) : null}
            </div>
          </header>

          {shouldShowFilters ? (
            <div
              id="takeoff-analysis-filters"
              data-testid="takeoff-analysis-filters"
              className="journey-filters"
              role="group"
              aria-label="Filtres des analyses"
              hidden={!filtersExpanded}
            >
              <div className="flex min-w-0 flex-col gap-1.5">
                <label
                  htmlFor="filter-version"
                  className="text-xs font-semibold text-muted-foreground"
                >
                  Version
                </label>
                <NativeSelect
                  id="filter-version"
                  size="sm" className="h-11 w-full min-w-0 sm:h-9"
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
                </NativeSelect>
              </div>

              <div className="flex min-w-0 flex-col gap-1.5">
                <label
                  htmlFor="filter-lot"
                  className="text-xs font-semibold text-muted-foreground"
                >
                  Lot
                </label>
                <NativeSelect
                  id="filter-lot"
                  size="sm" className="h-11 w-full min-w-0 sm:h-9"
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
                </NativeSelect>
              </div>

              <div className="flex min-w-0 flex-col gap-1.5">
                <label
                  htmlFor="filter-planSet"
                  className="text-xs font-semibold text-muted-foreground"
                >
                  Jeu de plans
                </label>
                <NativeSelect
                  id="filter-planSet"
                  size="sm" className="h-11 w-full min-w-0 sm:h-9"
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
                </NativeSelect>
              </div>

              <div className="flex min-w-0 flex-col gap-1.5">
                <label
                  htmlFor="filter-status"
                  className="text-xs font-semibold text-muted-foreground"
                >
                  Statut
                </label>
                <NativeSelect
                  id="filter-status"
                  size="sm" className="h-11 w-full min-w-0 sm:h-9"
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
                </NativeSelect>
              </div>

              <div className="flex min-w-0 flex-col gap-1.5">
                <label
                  htmlFor="filter-level"
                  className="text-xs font-semibold text-muted-foreground"
                >
                  Niveau
                </label>
                <NativeSelect
                  id="filter-level"
                  size="sm" className="h-11 w-full min-w-0 sm:h-9"
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
                </NativeSelect>
              </div>

              <div className="flex min-w-0 flex-col gap-1.5">
                <label
                  htmlFor="filter-period"
                  className="text-xs font-semibold text-muted-foreground"
                >
                  Période
                </label>
                <NativeSelect
                  id="filter-period"
                  size="sm" className="h-11 w-full min-w-0 sm:h-9"
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
                </NativeSelect>
              </div>

              {hasActiveJobFilters ? (
                <div className="flex items-end">
                  <button type="button" className="journey-text-action min-h-11 sm:min-h-9" onClick={resetJobFilters}>
                    Réinitialiser les filtres
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Tab panels */}
          <div
            role="tabpanel"
            id={`tabpanel-${activeTab}`}
            aria-labelledby={`tab-${activeTab}`}
          >
            {activeTab === "jobs" &&
              (listData ? (
                listData.jobs.length === 0 && hasActiveJobFilters ? (
                  <p className="px-4 py-5 text-sm text-muted-foreground sm:px-6">
                    Aucune analyse ne correspond à ces filtres.
                  </p>
                ) : (
                  <TakeoffJobsTable
                    projectId={projectId}
                    data={listData}
                    onPageChange={(offset) =>
                      updateParams({ offset: offset > 0 ? String(offset) : null })
                    }
                    onPageSizeChange={(size) => {
                      setPageSize(size);
                      updateParams({ offset: null });
                    }}
                    pageSize={pageSize}
                  />
                )
              ) : listError ? (
                <div className="journey-panel-body">
                  <p className="text-sm text-muted-foreground">
                    {isTakeoffApiError(listError) && listError.message
                      ? listError.message
                      : "Impossible de charger la liste des analyses."}
                  </p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => void mutateList()}>
                    Réessayer
                  </Button>
                </div>
              ) : (
                <div className="journey-panel-body" aria-hidden="true">
                  <JobsTableSkeleton />
                </div>
              ))}
            {activeTab === "exceptions" && (
              <div className="journey-panel-body">
                <TakeoffExceptionsTab
                  projectId={projectId}
                  versionId={selectedVersion !== "all" ? selectedVersion : null}
                />
              </div>
            )}
            {activeTab === "history" && (
              <div className="journey-panel-body">
                <TakeoffApplicationHistoryTab
                  projectId={projectId}
                  versionId={selectedVersion !== "all" ? selectedVersion : null}
                />
              </div>
            )}
          </div>
        </section>
      ) : null}

      {launchContext ? (
        <LaunchMetreDialog
          open={isLaunchDialogOpen}
          onOpenChange={handleLaunchDialogOpenChange}
          onLaunched={() => {
            void mutateSummary();
            void mutateList();
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
