"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { ArrowRight, SlidersHorizontalIcon } from "lucide-react";

import {
  fetchTakeoffActivityCenter,
  isTakeoffApiError,
  type TakeoffActivityCenterResponse,
} from "@/lib/takeoff/client";
import { resolveActivityCenterLotLabel } from "@/lib/takeoff/activity-center-shared";
import { formatTakeoffCompletionDate, TAKEOFF_COMPLETION_LABELS } from "@/lib/takeoff/completion-outcome";
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
  formatActivityPlan,
  formatCount,
  resolveErrorTitle,
} from "@/components/takeoff/takeoff-job-list-shared";

import TakeoffJobsTable from "./TakeoffJobsTable";
import { TakeoffRequestActivity } from "./TakeoffRequestActivity";
import { ItemDetailOpenerFocus } from "./item-detail/ItemDetailOpenerFocus";
import { TakeoffItemTable } from "./item-table/TakeoffItemTable";
import { isTakeoffReadRefusal, isTakeoffRequestActivityKey, useTakeoffRequestActivity } from "./useTakeoffRequestActivity";
import TakeoffExceptionsTab from "./TakeoffExceptionsTab";
import TakeoffApplicationHistoryTab from "./TakeoffApplicationHistoryTab";
import {
  resolveTakeoffNextStep,
  resolveTakeoffRequestStep,
  type TakeoffLatestJobContext,
  type TakeoffNextStepAction,
} from "./TakeoffActivityNextStep";
import { Button, buttonVariants } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";

type Props = {
  projectId: string;
  /** The member and their tenant: the page's cached reads belong to them alone. */
  viewerKey?: string;
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
  /** Beside the table of items: the affaire's analyses not read against its list (« Analyse antérieure »). */
  earlier?: ReactNode;
};

const TABS = [
  { key: "jobs", label: "Analyses" },
  { key: "exceptions", label: "Exceptions" },
  { key: "history", label: "Historique" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const FILTER_KEYS = ["version", "lot", "planSet", "status", "level", "period"] as const;
const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AnalysisCompletion = TakeoffActivityCenterResponse["analysisCompletions"][number];

/** The ends of the affaire's analyses, readable by every reader of the affaire, with the reason of a failure. */
function AnalysisCompletionList({ label, completions }: { label: string; completions: AnalysisCompletion[] }) {
  return (
    <ul className="journey-panel-body divide-y" aria-label={label}>
      {completions.map(({ eventId, outcome, finishedAt, failureReason, plans }) => (
        <li key={eventId} className="flex flex-wrap justify-between gap-2 py-2">
          <div className="min-w-0 wrap-anywhere">
            {plans && plans.length > 0 ? (
              <p className="font-semibold">{plans.map(formatActivityPlan).join(" · ")}</p>
            ) : null}
            <p className="text-sm">{TAKEOFF_COMPLETION_LABELS[outcome]}</p>
          </div>
          <time dateTime={finishedAt} className="text-sm text-muted-foreground">
            {formatTakeoffCompletionDate(finishedAt)}
          </time>
          {failureReason ? <p className="w-full text-sm text-muted-foreground">{failureReason}</p> : null}
        </li>
      ))}
    </ul>
  );
}

type ActivityKey = readonly [
  scope: "activity-center",
  /** The member and their tenant: another member's answer is never served. */
  viewerKey: string,
  projectId: string,
  version: string,
  lot: string,
  planSet: string,
  status: string,
  level: string,
  period: string,
  job: string,
  offset: number,
  completionsOffset: number,
  limit: number,
];

function fetchActivityPage([, , projectId, version, lot, planSet, status, level, period, job, offset, completionsOffset, limit]: ActivityKey) {
  const filter = (value: string) => (value !== "all" ? value : null);
  return fetchTakeoffActivityCenter(projectId, {
    view: "tracking",
    versionId: filter(version),
    lot: filter(lot),
    planSetId: filter(planSet),
    status: filter(status),
    level: filter(level),
    period: filter(period),
    jobId: filter(job),
    limit,
    offset,
    completionsOffset,
  });
}

/**
 * Another member (or another tenant of the same member) starts the page again: nothing of this member's answers is
 * shown while theirs load, not even the previous page of a list.
 */
export default function TakeoffActivityCenter(props: Props) {
  return <TakeoffActivityCenterView key={props.viewerKey ?? ""} {...props} />;
}

function TakeoffActivityCenterView({
  projectId,
  viewerKey = "",
  versions,
  planSets,
  launchContext = null,
  latestJobContext = null,
  initialHasAnalyses = false,
  header,
  help,
  earlier,
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
  // A failure link names its job: the list shows that job alone, or its shared end to a reader it is hidden from.
  const rawJob = searchParams.get("job");
  const selectedJob = rawJob && JOB_ID_PATTERN.test(rawJob) ? rawJob.toLowerCase() : null;
  // A link names a launch request (?request=) or an analysis (?job=, the end-of-analysis notice): the page opens that
  // request, the analysis's own when it has one.
  const rawRequest = searchParams.get("request");
  const linkedRequest = rawRequest && JOB_ID_PATTERN.test(rawRequest) ? rawRequest.toLowerCase() : null;
  const linked = linkedRequest ? { view: "request" as const, target: linkedRequest }
    : selectedJob ? { view: "job" as const, target: selectedJob } : null;

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
  // The affaire's shared ends have their own page.
  const rawEndsOffset = Number(searchParams.get("ends") ?? "0");
  const endsOffset = Number.isSafeInteger(rawEndsOffset) && rawEndsOffset >= 0 ? rawEndsOffset : 0;

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

  // The page's one poll: the affaire's latest launch request and its plans (or the request a link names), read again only
  // while something can change by itself. The analyses below are read again when it reports a transition, on focus and
  // after an action, never on their own interval.
  const { mutate: mutateAll } = useSWRConfig();
  const requestActivity = useTakeoffRequestActivity({
    viewerKey, projectId, view: linked?.view ?? "current", target: linked?.target ?? null, poll: true,
  });
  const refreshEverything = useCallback(() => {
    void mutateAll((key: unknown) => (Array.isArray(key) && key[0] === "activity-center") || isTakeoffRequestActivityKey(key));
  }, [mutateAll]);
  const activitySignature = requestActivity.data?.signature;
  const seenSignature = useRef(activitySignature);
  useEffect(() => {
    if (activitySignature === undefined || seenSignature.current === activitySignature) return;
    const first = seenSignature.current === undefined;
    seenSignature.current = activitySignature;
    if (!first) void mutateAll((key: unknown) => Array.isArray(key) && key[0] === "activity-center");
  }, [activitySignature, mutateAll]);

  // The next step and the « Repères » read the affaire's newest analyses on every view,
  // whatever the filters; the unfiltered first page of the list is this same request.
  const summaryKey: ActivityKey = ["activity-center", viewerKey, projectId, "all", "all", "all", "all", "all", "all", "all", 0, 0, PAGE_SIZE_OPTIONS[0]];
  const {
    data: summaryAnswer,
    error: summaryError,
    isLoading: isSummaryLoading,
    mutate: mutateSummary,
  } = useSWR(summaryKey, fetchActivityPage, {
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    shouldRetryOnError: false,
  });
  const { data: listAnswer, error: listError, mutate: mutateList } = useSWR(
    activeTab === "jobs"
      ? ([
          "activity-center",
          viewerKey,
          projectId,
          selectedVersion,
          selectedLot,
          selectedPlanSet,
          selectedStatus,
          selectedLevel,
          selectedPeriod,
          selectedJob ?? "all",
          selectedJob ? 0 : pageOffset,
          selectedJob ? 0 : endsOffset,
          pageSize,
        ] satisfies ActivityKey)
      : null,
    fetchActivityPage,
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      keepPreviousData: true,
      shouldRetryOnError: false,
    }
  );
  // A refusal of any of the centre's reads (no right on the affaire any more) withdraws the three views together and shows
  // the refusal, never an earlier state.
  const refusal = [requestActivity.error, summaryError, listError].find(isTakeoffReadRefusal);
  const refused = refusal !== undefined;
  const summaryData = refused ? undefined : summaryAnswer;
  const listData = refused ? undefined : listAnswer;
  const lightData = refused ? undefined : requestActivity.data;
  const pageError = summaryError ?? refusal;
  const isSlowLoading = useDelayedLoadingIndicator(isSummaryLoading);

  // The page's first light answer may be older or newer than the list read beside it: an analysis the list shows queued,
  // running or awaiting its retry that the light answer does not is a transition, and both are read again (once per
  // light answer and list, so that a lasting difference never loops). A waiting row is then followed by the poll.
  const lightAnswer = lightData;
  const comparedLists = useRef<string | null>(null);
  useEffect(() => {
    if (!lightAnswer) return;
    const inFlight = new Set(lightAnswer.inFlightJobIds);
    const listed = [...(summaryData?.jobs ?? []), ...(listData?.jobs ?? [])].filter((job) =>
      job.technicalStatusRaw === "pending" || job.technicalStatusRaw === "processing" || job.resume?.reason === "retry_scheduled");
    const moved = [...new Set(listed.filter((job) => !inFlight.has(job.jobId)).map((job) => job.jobId))].sort();
    if (moved.length === 0) return;
    const mark = `${lightAnswer.signature}|${moved.join(",")}`;
    if (comparedLists.current === mark) return;
    comparedLists.current = mark;
    void mutateAll((key: unknown) => (Array.isArray(key) && key[0] === "activity-center") || isTakeoffRequestActivityKey(key));
  }, [lightAnswer, summaryData, listData, mutateAll]);

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
  // Every end the reader may see, a page at a time, whatever the job list shows: a director who reads one job of the
  // affaire still sees the ends of the jobs hidden from them.
  const sharedCompletions = (listData ?? summaryData)?.analysisCompletions ?? [];
  const showTracking = !pageError && (hasAnalyses || hasActiveJobFilters || selectedJob !== null
    || (summaryData?.analysisCompletions.length ?? 0) > 0);

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

  useEffect(() => {
    const activeButton = tabListRef.current?.querySelector<HTMLButtonElement>(
      `#tab-${activeTab}`
    );
    if (activeButton && document.activeElement === tabListRef.current) {
      activeButton.focus();
    }
  }, [activeTab]);

  const errorStatus = isTakeoffApiError(pageError) ? pageError.status : null;
  const errorMessage =
    isTakeoffApiError(pageError) && pageError.message
      ? pageError.message
      : "Impossible de charger les analyses.";

  // The latest execution leads when it is a launch request newer than the latest analysis launched without one: its plans,
  // never the latest job by date, decide the step.
  const latestJob = summaryData?.jobs[0] ?? null;
  // A link to a request or an analysis of the latest execution keeps the step on that execution.
  const currentRequest = !linked || lightData?.currentIsLatest ? lightData?.current ?? null : null;
  const requestLeads = currentRequest !== null && (!latestJob || latestJob.launchRequestId != null
    || Date.parse(latestJob.createdAt) <= Date.parse(currentRequest.createdAt));
  const requestStep = requestLeads ? resolveTakeoffRequestStep({ projectId, request: currentRequest, canLaunch: launchContext !== null }) : null;
  const nextStep = requestStep ?? (summaryData
    ? resolveTakeoffNextStep({
        projectId,
        latestJob: summaryData.jobs[0] ?? null,
        latestJobContext,
        canLaunch: launchContext !== null,
        firstUsablePlanSetName: firstUsablePlanSet?.name ?? null,
        planSetCount: planSets.length,
      })
    : null);
  // Always mounted, so a step that changes by itself (an analysis that ends) is announced.
  const announcement = pageError
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
    pageError ? "Indisponible" : value === undefined ? "…" : formatCount(value);

  return (
    <div className="journey-page">
      {header}

      <div className="journey-grid">
        <JourneyPanel headingId="takeoff-next-heading" title="Métré de l’affaire">
          <p className="sr-only" role="status">{announcement}</p>
          {pageError ? (
            <JourneyNext
              title={resolveErrorTitle(errorStatus)}
              description={errorMessage}
              action={
                <Button variant="outline" onClick={() => (refused ? refreshEverything() : void mutateSummary())}>
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

      <TakeoffRequestActivity
        projectId={projectId}
        viewerKey={viewerKey}
        live={{
          data: lightData, error: refusal ?? requestActivity.error, isLoading: requestActivity.isLoading,
          refused, refreshMs: requestActivity.refreshMs, refresh: refreshEverything,
        }}
        linked={linked}
        onShowLatest={() => updateParams({ request: null, job: null, offset: null })}
        onChanged={refreshEverything}
      />

      {/* The affaire's items, read again when a plan's reading moves (the signature of the poll above); withdrawn with
          the rest of the centre when its read is refused (an access removed). */}
      {refused ? null : <TakeoffItemTable projectId={projectId} viewerKey={viewerKey} signature={activitySignature} />}
      {/* Back from an item's detail by the browser: the keyboard on the « Détail » it was opened from. */}
      {refused ? null : <ItemDetailOpenerFocus projectId={projectId} viewerKey={viewerKey} />}
      {refused ? null : earlier}

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

          <div
            role="tabpanel"
            id={`tabpanel-${activeTab}`}
            aria-labelledby={`tab-${activeTab}`}
          >
            {activeTab === "jobs" && selectedJob ? (
              <>
                {listData ? (
                  listData.jobs.length > 0 ? (
                    <TakeoffJobsTable
                      projectId={projectId}
                      data={listData}
                      onPageChange={() => undefined}
                      onPageSizeChange={(size) => setPageSize(size)}
                      pageSize={pageSize}
                    />
                  ) : listData.analysisCompletions.length > 0 ? (
                    <AnalysisCompletionList label="Analyse sélectionnée" completions={listData.analysisCompletions} />
                  ) : (
                    <p className="px-4 py-5 text-sm text-muted-foreground sm:px-6">
                      Cette analyse n’est pas visible avec votre profil, ou elle n’existe plus.
                    </p>
                  )
                ) : listError ? (
                  <div className="journey-panel-body">
                    <p className="text-sm text-muted-foreground">
                      {isTakeoffApiError(listError) && listError.message
                        ? listError.message
                        : "Impossible de charger cette analyse."}
                    </p>
                    <Button variant="outline" size="sm" className="mt-3" onClick={() => void mutateList()}>
                      Réessayer
                    </Button>
                  </div>
                ) : (
                  <div className="journey-panel-body" aria-hidden="true">
                    <JobsTableSkeleton />
                  </div>
                )}
                <div className="journey-panel-body">
                  <button
                    type="button"
                    className="journey-text-action min-h-11 sm:min-h-9"
                    onClick={() => updateParams({ job: null, offset: null })}
                  >
                    Voir toutes les analyses
                  </button>
                </div>
              </>
            ) : activeTab === "jobs" ? (
              <>
                {hasAnalyses || hasActiveJobFilters || sharedCompletions.length === 0 ? (
              listData ? (
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
              )
                ) : null}
                {/* The affaire's ends, whatever the job list's filters. */}
                {sharedCompletions.length > 0 ? (
                  <>
                    <AnalysisCompletionList label="Fins d’analyse de l’affaire" completions={sharedCompletions} />
                    {endsOffset > 0 || listData?.analysisCompletionsHasOlder ? (
                      <nav aria-label="Pages des fins d’analyse" className="journey-panel-body flex flex-wrap gap-4">
                        {endsOffset > 0 ? (
                          <button
                            type="button"
                            className="journey-text-action min-h-11 sm:min-h-9"
                            onClick={() => updateParams({
                              ends: endsOffset - pageSize > 0 ? String(endsOffset - pageSize) : null,
                            })}
                          >
                            Plus récentes
                          </button>
                        ) : null}
                        {listData?.analysisCompletionsHasOlder ? (
                          <button
                            type="button"
                            className="journey-text-action min-h-11 sm:min-h-9"
                            onClick={() => updateParams({ ends: String(endsOffset + pageSize) })}
                          >
                            Plus anciennes
                          </button>
                        ) : null}
                      </nav>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}
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
          onLaunched={refreshEverything}
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
          initialVersionId={searchParams.get("launch") === "1" ? searchParams.get("version") : null}
        />
      ) : null}
    </div>
  );
}
