"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";

import {
  fetchTakeoffActivityCenter,
  isTakeoffApiError,
  type TakeoffActivityCenterResponse,
} from "@/lib/takeoff/client";
import { resolveActivityCenterLotLabel } from "@/lib/takeoff/activity-center-shared";
import {
  BUSINESS_STATUS_LABEL_MAP,
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

type Props = {
  projectId: string;
  versions: Array<{ id: string; version_number: number }>;
  planSets: Array<{ id: string; name: string; metadata?: Record<string, unknown> | null }>;
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

  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);
  const rawOffset = Number(searchParams.get("offset") ?? "0");
  const pageOffset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

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
        (job) => job.statusRaw === "pending"
      );
      return hasProcessing || hasPending
        ? TAKEOFF_LIST_REFRESH_INTERVAL_MS
        : 0;
    },
    []
  );

  const { data, error, isLoading } = useSWR(
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

  const statusOptions = [
    { value: "all", label: "Tous les statuts" },
    ...Object.entries(BUSINESS_STATUS_LABEL_MAP).map(([value, label]) => ({
      value,
      label,
    })),
  ];

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
      : "Impossible de charger le centre d'activite.";

  return (
    <div>
      {/* Tab bar */}
      <div
        ref={tabListRef}
        role="tablist"
        aria-label="Onglets du centre d'activite"
        className="flex border-b border-[var(--slate-200)] mb-4"
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
              className={`px-4 py-2 text-sm transition-colors ${
                isActive
                  ? "border-b-2 border-[var(--brand-blue)] text-[var(--brand-blue)] font-semibold"
                  : "text-[var(--slate-500)] hover:text-[var(--slate-700)]"
              }`}
              onClick={() => updateParams({ tab: tab.key })}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-1.5">
          <label
            htmlFor="filter-version"
            className="text-xs font-semibold text-[var(--slate-500)]"
          >
            Version
          </label>
          <select
            id="filter-version"
            className="form-input form-select form-input--sm h-9 min-w-[120px]"
            value={selectedVersion}
            onChange={(e) => updateParams({ version: e.target.value, offset: null })}
          >
            <option value="all">Toutes versions</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                V{v.version_number}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <label
            htmlFor="filter-lot"
            className="text-xs font-semibold text-[var(--slate-500)]"
          >
            Lot
          </label>
          <select
            id="filter-lot"
            className="form-input form-select form-input--sm h-9 min-w-[120px]"
            value={selectedLot}
            onChange={(e) => updateParams({ lot: e.target.value, offset: null })}
          >
            {lotOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <label
            htmlFor="filter-planSet"
            className="text-xs font-semibold text-[var(--slate-500)]"
          >
            Jeu de plans
          </label>
          <select
            id="filter-planSet"
            className="form-input form-select form-input--sm h-9 min-w-[120px]"
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

        <div className="flex items-center gap-1.5">
          <label
            htmlFor="filter-status"
            className="text-xs font-semibold text-[var(--slate-500)]"
          >
            Statut
          </label>
          <select
            id="filter-status"
            className="form-input form-select form-input--sm h-9 min-w-[120px]"
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

        <div className="flex items-center gap-1.5">
          <label
            htmlFor="filter-level"
            className="text-xs font-semibold text-[var(--slate-500)]"
          >
            Niveau
          </label>
          <select
            id="filter-level"
            className="form-input form-select form-input--sm h-9 min-w-[120px]"
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

        <div className="flex items-center gap-1.5">
          <label
            htmlFor="filter-period"
            className="text-xs font-semibold text-[var(--slate-500)]"
          >
            Periode
          </label>
          <select
            id="filter-period"
            className="form-input form-select form-input--sm h-9 min-w-[120px]"
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
            </section>
          ) : data ? (
            <TakeoffJobsTable
              projectId={projectId}
              data={data}
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
    </div>
  );
}
