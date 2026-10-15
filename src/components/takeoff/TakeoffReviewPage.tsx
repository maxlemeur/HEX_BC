"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ProductionRibbon, ProductionRibbonHeader } from "@/components/dashboard/ProductionRibbon";
import { LoadingState } from "@/components/layout/loading-state";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { useToast } from "@/components/ui-legacy/Toast";
import { useUserContext } from "@/components/UserContext";
import { ConfidenceHeader } from "@/components/takeoff/ConfidenceHeader";
import { EvidencePanel } from "@/components/takeoff/EvidencePanel";
import {
  TakeoffReviewModeSwitch,
  type ReviewMode,
} from "@/components/takeoff/review/TakeoffReviewModeSwitch";
import { AssistedReviewPanel } from "@/components/takeoff/review/AssistedReviewPanel";
import { ExclusionReasonDialog } from "@/components/takeoff/review/ExclusionReasonDialog";
import {
  TakeoffApplyReadinessBar,
  TakeoffApplySuccessBanner,
  TakeoffReviewErrorState,
  TakeoffReviewLoadingState,
} from "@/components/takeoff/review/TakeoffReviewChrome";
import { useUiMode } from "@/hooks/useUiMode";
import {
  hasBlockingAnomaly,
} from "@/components/takeoff/TakeoffReviewTable";
import {
  getBusinessLevelLabel,
  getStatusCss,
  getStatusLabel,
} from "@/components/takeoff/takeoff-job-list-shared";
import type { TakeoffApplyWizardSubmitPayload } from "@/components/takeoff/TakeoffApplyWizard";
import { releaseEstimateDraftLock } from "@/lib/estimates/client";
import { ensureTakeoffApplyDraftLock } from "@/lib/takeoff/apply-draft-lock";

const TakeoffApplyWizard = dynamic(
  () => import("@/components/takeoff/TakeoffApplyWizard").then((module) => module.TakeoffApplyWizard),
  {
    ssr: false,
    loading: () => <LoadingState label="Chargement des options d’application…" />,
  }
);

const LazyTakeoffReviewExpert = dynamic(
  () =>
    import("@/components/takeoff/TakeoffReviewExpert").then((mod) => ({
      default: mod.TakeoffReviewExpert,
    })),
  {
    ssr: false,
    loading: () => <LoadingState label="Chargement de la vue avancée…" />,
  }
);

const LazyValidationReviewPanel = dynamic(
  () =>
    import("@/components/takeoff/review/ValidationReviewPanel").then((mod) => ({
      default: mod.ValidationReviewPanel,
    })),
  {
    ssr: false,
    loading: () => <LoadingState label="Chargement de la vue validation…" />,
  }
);
import {
  applyTakeoffJob,
  fetchTakeoffDpgfComparison,
  fetchAllTakeoffDpgfComparison,
  fetchTakeoffJobCompare,
  fetchTakeoffJob,
  isTakeoffApiError,
  listTakeoffJobs,
  patchTakeoffItems,
} from "@/lib/takeoff/client";
import { TAKEOFF_LOW_CONFIDENCE_THRESHOLD_FLAG_KEY } from "@/lib/takeoff/constants";
import { hasBlockingTakeoffDpgfExceptions } from "@/lib/takeoff/dpgf-compare";
import {
  checkApplyGuard,
  DEFAULT_LOW_CONFIDENCE_THRESHOLD,
} from "@/lib/takeoff/guards";
import type {
  TakeoffDpgfComparisonResponse,
  TakeoffDpgfComparisonView,
  TakeoffItemBatchPatchResponse,
  TakeoffItemPatchEntry,
  TakeoffJobCompareResponse,
  TakeoffJobItem,
  TakeoffJobSummary,
  TakeoffTable,
} from "@/lib/takeoff/types";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type ReviewItem = TakeoffJobItem & {
  _dirty: boolean;
  _saving: boolean;
  _error: string | null;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TakeoffReviewPageProps = {
  jobId: string;
  versionId: string;
  projectId?: string;
};

type ViewTab = "tables" | "items" | "compare" | "dpgf";
type DpgfFetchMode = "summary" | "detail";
type ApplySuccessSummary = {
  appliedAt: string;
  targetSectionLabel: string;
  strategy: TakeoffApplyWizardSubmitPayload["strategy"];
  createdCount: number;
  updatedCount: number;
  ignoredCount: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTO_SAVE_DEBOUNCE_MS = 500;
const REVIEW_ITEMS_PAGE_SIZE = 200;
const DPGF_COMPARE_PAGE_SIZE = 200;
const DEFAULT_COMPARE_THRESHOLD = 0.8;
const CHERRY_PICK_EXCLUSION_REASON = "Cherry-pick diff TKF-032";
const TAKEOFF_ITEM_PATCH_BATCH_MAX = 100;
const TAKEOFF_JOBS_LIST_PAGE_MAX = 100;

function parseLowConfidenceThreshold(value: string | null): number {
  if (!value) return DEFAULT_LOW_CONFIDENCE_THRESHOLD;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LOW_CONFIDENCE_THRESHOLD;
  if (parsed < 0 || parsed > 1) return DEFAULT_LOW_CONFIDENCE_THRESHOLD;
  return parsed;
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export default function TakeoffReviewPage({
  jobId,
  versionId,
  projectId,
}: TakeoffReviewPageProps) {
  const toast = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile } = useUserContext();
  const isAdmin = profile?.tenant_role === "admin";
  const { isSimplified } = useUiMode();
  const {
    enabled: isLowConfidenceThresholdEnabled,
    value: lowConfidenceThresholdRaw,
  } = useFeatureFlag(
    TAKEOFF_LOW_CONFIDENCE_THRESHOLD_FLAG_KEY
  );
  const lowConfidenceThreshold = useMemo(
    () =>
      parseLowConfidenceThreshold(
        isLowConfidenceThresholdEnabled ? lowConfidenceThresholdRaw : null
      ),
    [isLowConfidenceThresholdEnabled, lowConfidenceThresholdRaw]
  );

  // ---- Review mode from URL (V3-012: Assisté / Production / Validation)
  const reviewModeParam = searchParams.get("reviewMode");
  const fromParam = searchParams.get("from");
  const isAffaireContext = typeof projectId === "string" && projectId.length > 0;

  const defaultReviewMode: ReviewMode = useMemo(() => {
    if (fromParam === "approval") return "validation";
    if (isAffaireContext) return "validation";
    return isSimplified ? "assisted" : "production";
  }, [fromParam, isAffaireContext, isSimplified]);

  const currentReviewMode: ReviewMode = useMemo(() => {
    if (
      reviewModeParam === "assisted" ||
      reviewModeParam === "production" ||
      reviewModeParam === "validation"
    ) {
      return reviewModeParam;
    }
    return defaultReviewMode;
  }, [reviewModeParam, defaultReviewMode]);

  const isShowingSimplified = currentReviewMode === "assisted";

  const setReviewMode = useCallback(
    (mode: ReviewMode) => {
      const params = new URLSearchParams(searchParams.toString());
      if (mode === defaultReviewMode) {
        params.delete("reviewMode");
      } else {
        params.set("reviewMode", mode);
      }
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [defaultReviewMode, router, searchParams]
  );

  const openProductionReview = useCallback(
    (tab: ViewTab) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("reviewMode", "production");
      params.set("view", tab);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const openDpgfExceptions = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("reviewMode", "production");
    params.set("view", "dpgf");
    params.set("dpgfView", "exceptions_only");
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  // ---- Tab state from URL
  const viewParam = searchParams.get("view");
  const compareWithParam = searchParams.get("compareWith");
  const thresholdParam = searchParams.get("threshold");
  const dpgfViewParam = searchParams.get("dpgfView");
  const requestedTab: ViewTab =
    viewParam === "tables" || viewParam === "items" || viewParam === "compare" || viewParam === "dpgf"
      ? viewParam
      : "items";
  const dpgfCompareView: TakeoffDpgfComparisonView =
    dpgfViewParam === "exceptions_only" ? "exceptions_only" : "all";
  const activeTab: ViewTab = isShowingSimplified ? "items" : requestedTab;

  const compareWithJobId = useMemo(() => {
    if (!compareWithParam) return null;
    const trimmed = compareWithParam.trim();
    return trimmed.length > 0 ? trimmed : null;
  }, [compareWithParam]);

  const compareThreshold = useMemo(() => {
    if (!thresholdParam) return DEFAULT_COMPARE_THRESHOLD;
    const parsed = Number(thresholdParam);
    if (!Number.isFinite(parsed)) return DEFAULT_COMPARE_THRESHOLD;
    if (parsed < 0.5) return 0.5;
    if (parsed > 0.99) return 0.99;
    return Number(parsed.toFixed(2));
  }, [thresholdParam]);

  const setActiveTab = useCallback(
    (tab: ViewTab) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("view", tab);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const setCompareWithJobId = useCallback(
    (otherJobId: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (otherJobId) {
        params.set("compareWith", otherJobId);
      } else {
        params.delete("compareWith");
      }
      if (!params.get("view")) {
        params.set("view", "compare");
      }
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const setCompareThreshold = useCallback(
    (nextThreshold: number) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("threshold", String(Number(nextThreshold.toFixed(2))));
      if (!params.get("view")) {
        params.set("view", "compare");
      }
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  const setDpgfCompareView = useCallback(
    (nextView: TakeoffDpgfComparisonView) => {
      const params = new URLSearchParams(searchParams.toString());
      if (nextView === "all") {
        params.delete("dpgfView");
      } else {
        params.set("dpgfView", nextView);
      }
      if (!params.get("view")) {
        params.set("view", "dpgf");
      }
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  // ---- Data state
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [tables, setTables] = useState<TakeoffTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [jobFileName, setJobFileName] = useState<string | null>(null);
  const [jobLevel, setJobLevel] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [jobVersionNumber, setJobVersionNumber] = useState<number | null>(null);
  const [globalConfidence, setGlobalConfidence] = useState<number | null>(null);
  const [evidencePanelItemId, setEvidencePanelItemId] = useState<string | null>(null);
  const [compareCandidates, setCompareCandidates] = useState<TakeoffJobSummary[]>([]);
  const [compareData, setCompareData] = useState<TakeoffJobCompareResponse | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [applySelectionSubmitting, setApplySelectionSubmitting] = useState(false);
  const [applySelectionError, setApplySelectionError] = useState<string | null>(null);

  // ---- DPGF comparison state
  const [dpgfCompareData, setDpgfCompareData] = useState<TakeoffDpgfComparisonResponse | null>(null);
  const [dpgfCompareLoading, setDpgfCompareLoading] = useState(false);
  const [dpgfCompareError, setDpgfCompareError] = useState<string | null>(null);
  const dpgfCompareFetchedRef = useRef<{
    mode: DpgfFetchMode;
    view: TakeoffDpgfComparisonView;
  } | null>(null);

  // ---- Assisted review state
  const [assistedReviewedIds, setAssistedReviewedIds] = useState<Set<string>>(
    () => new Set()
  );
  const [assistedMarkedForReviewIds, setAssistedMarkedForReviewIds] = useState<
    Set<string>
  >(() => new Set());
  const assistedPreviousExcludedStateRef = useRef<Map<string, boolean> | null>(
    null
  );

  // ---- Exclusion modal state
  const [exclusionModalOpen, setExclusionModalOpen] = useState(false);
  const [exclusionTargetIds, setExclusionTargetIds] = useState<string[]>([]);

  // ---- Apply wizard state
  const [applyWizardOpen, setApplyWizardOpen] = useState(false);
  const [applySubmitting, setApplySubmitting] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applySuccess, setApplySuccess] = useState<ApplySuccessSummary | null>(null);

  // ---- Auto-save
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);

  // ---- Fetch data
  useEffect(() => {
    let canceled = false;
    const abortController = new AbortController();
    async function load() {
      try {
        setLoading(true);
        setLoadError(null);

        const firstPage = await fetchTakeoffJob(jobId, {
          signal: abortController.signal,
          itemsLimit: REVIEW_ITEMS_PAGE_SIZE,
          itemsOffset: 0,
        });
        if (canceled) return;

        const allItems: TakeoffJobItem[] = [...firstPage.items.data];
        const totalItems = firstPage.items.pagination.total;
        let nextOffset =
          firstPage.items.pagination.offset + firstPage.items.data.length;

        while (allItems.length < totalItems) {
          const page = await fetchTakeoffJob(jobId, {
            signal: abortController.signal,
            itemsLimit: REVIEW_ITEMS_PAGE_SIZE,
            itemsOffset: nextOffset,
          });
          if (canceled) return;
          if (page.items.data.length === 0) {
            break;
          }
          allItems.push(...page.items.data);
          nextOffset += page.items.data.length;
        }

        setJobFileName(firstPage.job.source_file_name);
        setJobLevel(firstPage.job.level);
        setJobStatus(firstPage.job.status);
        setJobVersionNumber(firstPage.job.version_number ?? null);
        setGlobalConfidence(firstPage.result?.confidence ?? null);

        // Extract tables from result if available
        const resultTables = firstPage.result?.tables;
        if (Array.isArray(resultTables)) {
          setTables(resultTables as TakeoffTable[]);
        }

        setItems(
          allItems.map((item) => ({
            ...item,
            _dirty: false,
            _saving: false,
            _error: null,
          }))
        );

        // If Level B and tables exist, default to tables view
        if (
          firstPage.job.level === "B" &&
          Array.isArray(resultTables) &&
          resultTables.length > 0 &&
          !viewParam
        ) {
          setActiveTab("tables");
        }
      } catch (err) {
        if (canceled || abortController.signal.aborted) return;
        setLoadError(
          isTakeoffApiError(err) ? err.message : "Impossible de charger les items."
        );
      } finally {
        if (!canceled) setLoading(false);
      }
    }
    load();
    return () => {
      canceled = true;
      abortController.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // ---- Compare candidates (same estimate version + same source file)
  useEffect(() => {
    let canceled = false;
    const abortController = new AbortController();

    async function loadCompareCandidates() {
      if (!jobFileName) {
        setCompareCandidates([]);
        return;
      }

      try {
        const jobs: TakeoffJobSummary[] = [];
        let nextOffset = 0;
        let total = Number.POSITIVE_INFINITY;

        while (nextOffset < total) {
          const response = await listTakeoffJobs(
            {
              estimate_version_id: versionId,
              limit: TAKEOFF_JOBS_LIST_PAGE_MAX,
              offset: nextOffset,
            },
            { signal: abortController.signal }
          );
          if (canceled) return;

          jobs.push(...response.jobs);
          total = response.pagination.total;

          if (response.jobs.length === 0) {
            break;
          }
          nextOffset += response.jobs.length;
        }

        const normalizedSourceFileName = jobFileName.trim().toLowerCase();
        const filteredCandidates = jobs.filter((job) => {
          if (job.id === jobId) return false;
          if (job.status !== "completed" && job.status !== "applied") return false;
          const candidateSourceFileName =
            job.source_file_name?.trim().toLowerCase() ?? "";
          return (
            candidateSourceFileName.length > 0 &&
            candidateSourceFileName === normalizedSourceFileName
          );
        });

        setCompareCandidates(filteredCandidates);
      } catch {
        if (!canceled && !abortController.signal.aborted) {
          setCompareCandidates([]);
        }
      }
    }

    loadCompareCandidates();

    return () => {
      canceled = true;
      abortController.abort();
    };
  }, [jobFileName, jobId, versionId]);

  // ---- Compare loading
  useEffect(() => {
    if (!compareWithJobId) {
      setCompareLoading(false);
      setCompareError(null);
      setCompareData(null);
      return;
    }

    let canceled = false;
    const abortController = new AbortController();

    async function loadCompare() {
      try {
        setCompareLoading(true);
        setCompareError(null);

        const response = await fetchTakeoffJobCompare(jobId, {
          withJobId: compareWithJobId!,
          threshold: compareThreshold,
          signal: abortController.signal,
        });

        if (canceled) return;
        setCompareData(response);
      } catch (error) {
        if (canceled || abortController.signal.aborted) return;
        setCompareData(null);
        setCompareError(
          isTakeoffApiError(error)
            ? error.message
            : "Impossible de comparer les deux extractions."
        );
      } finally {
        if (!canceled) {
          setCompareLoading(false);
        }
      }
    }

    loadCompare();

    return () => {
      canceled = true;
      abortController.abort();
    };
  }, [compareThreshold, compareWithJobId, jobId]);

  // ---- DPGF comparison lazy loading
  const loadDpgfComparison = useCallback(
    async (mode: DpgfFetchMode, signal?: AbortSignal) => {
      try {
        setDpgfCompareLoading(true);
        setDpgfCompareError(null);
        const response =
          mode === "detail"
            ? await fetchAllTakeoffDpgfComparison(
                jobId,
                {
                  version_id: versionId,
                  page_size: DPGF_COMPARE_PAGE_SIZE,
                  view: dpgfCompareView,
                },
                { signal }
              )
            : await fetchTakeoffDpgfComparison(
                jobId,
                {
                  version_id: versionId,
                  page_size: 1,
                  view: dpgfCompareView,
                },
                { signal }
              );
        setDpgfCompareData(response);
        dpgfCompareFetchedRef.current = {
          mode,
          view: dpgfCompareView,
        };
      } catch (error) {
        if (signal?.aborted) return;
        setDpgfCompareData(null);
        dpgfCompareFetchedRef.current = null;
        setDpgfCompareError(
          isTakeoffApiError(error)
            ? error.message
            : "Impossible de charger la comparaison DPGF."
        );
      } finally {
        setDpgfCompareLoading(false);
      }
    },
    [dpgfCompareView, jobId, versionId]
  );

  useEffect(() => {
    dpgfCompareFetchedRef.current = null;
    setDpgfCompareData((current) =>
      current?.view === dpgfCompareView ? current : null
    );
  }, [dpgfCompareView]);

  useEffect(() => {
    const nextMode: DpgfFetchMode | null =
      activeTab === "dpgf"
        ? "detail"
        : "summary";

    if (!nextMode) return;

    const hasMatchingPayload = dpgfCompareData?.view === dpgfCompareView;
    const fetchedState = dpgfCompareFetchedRef.current;
    const hasRequiredData =
      hasMatchingPayload &&
      fetchedState?.view === dpgfCompareView &&
      (fetchedState.mode === "detail" || fetchedState.mode === nextMode);

    if (hasRequiredData) {
      return;
    }

    const abortController = new AbortController();
    void loadDpgfComparison(nextMode, abortController.signal);

    return () => {
      abortController.abort();
    };
  }, [activeTab, currentReviewMode, dpgfCompareData, dpgfCompareView, loadDpgfComparison]);

  const refreshDpgfCompare = useCallback(() => {
    dpgfCompareFetchedRef.current = null;
    setDpgfCompareData(null);
    void loadDpgfComparison("detail");
  }, [loadDpgfComparison]);

  // ---- Item update helpers
  const updateItemField = useCallback(
    (itemId: string, field: string, value: unknown) => {
      setItems((prev) =>
        prev.map((item) => {
          if (item.id !== itemId) return item;
          const invalidatesVerification =
            item.is_verified &&
            [
              "designation",
              "quantity",
              "unit",
              "source_page",
              "is_excluded",
              "exclusion_reason",
              "evidence",
            ].includes(field) &&
            item[field as keyof ReviewItem] !== value;

          return {
            ...item,
            [field]: value,
            ...(invalidatesVerification
              ? {
                  is_verified: false,
                  verified_at: null,
                  verified_by: null,
                }
              : {}),
            _dirty: true,
            _error: null,
          };
        })
      );
    },
    []
  );

  const applyPatchResults = useCallback(
    (response: TakeoffItemBatchPatchResponse) => {
      const resultByItemId = new Map(
        response.results.map((entry) => [entry.item_id, entry] as const)
      );
      setItems((prev) =>
        prev.map((item) => {
          const result = resultByItemId.get(item.id);
          if (!result) return item;

          if (result.success && result.item) {
            return {
              ...result.item,
              _dirty: false,
              _saving: false,
              _error: null,
            };
          }

          return {
            ...item,
            _dirty: false,
            _saving: false,
            _error: result.error ?? "Erreur inconnue.",
          };
        })
      );
    },
    []
  );

  // ---- Auto-save logic
  const performSave = useCallback(async () => {
    if (savingRef.current) return;

    const dirtyItems = items.filter((i) => i._dirty && !i._saving);
    if (dirtyItems.length === 0) return;

    savingRef.current = true;

    // Mark saving
    setItems((prev) =>
      prev.map((item) =>
        item._dirty ? { ...item, _saving: true } : item
      )
    );

    const patchEntries: TakeoffItemPatchEntry[] = dirtyItems.map((item) => {
      const fields: TakeoffItemPatchEntry["fields"] = {};
      fields.designation = item.designation;
      fields.quantity = item.quantity;
      fields.unit = item.unit;
      fields.source_page = item.source_page;
      fields.is_excluded = item.is_excluded;
      if (item.is_excluded) {
        fields.exclusion_reason = item.exclusion_reason;
      }
      fields.is_verified = item.is_verified;
      fields.evidence = item.evidence;

      return {
        item_id: item.id,
        updated_at: item.updated_at,
        fields,
      };
    });

    try {
      let failedCount = 0;
      let savedCount = 0;
      for (
        let index = 0;
        index < patchEntries.length;
        index += TAKEOFF_ITEM_PATCH_BATCH_MAX
      ) {
        const chunk = patchEntries.slice(index, index + TAKEOFF_ITEM_PATCH_BATCH_MAX);
        const response = await patchTakeoffItems(jobId, { items: chunk });
        failedCount += response.failed;
        savedCount += response.succeeded;
        applyPatchResults(response);
      }

      if (failedCount > 0) {
        toast.warning({
          title: `${failedCount} item(s) non sauvegardé(s)`,
          description: "Vérifiez les items en erreur.",
        });
      } else if (savedCount > 0) {
        toast.success({
          title: "Sauvegarde automatique",
          durationMs: 2000,
        });
      }
    } catch (err) {
      setItems((prev) =>
        prev.map((item) =>
          item._saving
            ? {
                ...item,
                _dirty: true,
                _saving: false,
                _error: "Échec de sauvegarde.",
              }
            : item
        )
      );
      toast.error({
        title: "Erreur de sauvegarde",
        description: isTakeoffApiError(err) ? err.message : "Erreur inconnue.",
      });
    } finally {
      savingRef.current = false;
    }
  }, [applyPatchResults, items, jobId, toast]);

  // Trigger auto-save debounce when items change
  const hasDirty = items.some((i) => i._dirty);
  useEffect(() => {
    if (!hasDirty) return;
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = setTimeout(() => {
      performSave();
    }, AUTO_SAVE_DEBOUNCE_MS);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [hasDirty, performSave]);

  useEffect(() => {
    const validItemIds = new Set(items.map((item) => item.id));

    setAssistedReviewedIds((previousReviewedIds) => {
      const nextReviewedIds = new Set(
        Array.from(previousReviewedIds).filter((itemId) => validItemIds.has(itemId))
      );
      let changed = nextReviewedIds.size !== previousReviewedIds.size;

      if (assistedPreviousExcludedStateRef.current !== null) {
        for (const item of items) {
          if (
            !assistedPreviousExcludedStateRef.current.get(item.id) &&
            item.is_excluded &&
            !nextReviewedIds.has(item.id)
          ) {
            nextReviewedIds.add(item.id);
            changed = true;
          }
        }
      }

      assistedPreviousExcludedStateRef.current = new Map(
        items.map((item) => [item.id, item.is_excluded] as const)
      );

      return changed ? nextReviewedIds : previousReviewedIds;
    });

    setAssistedMarkedForReviewIds((previousMarkedIds) => {
      const nextMarkedIds = new Set(
        Array.from(previousMarkedIds).filter((itemId) => {
          if (!validItemIds.has(itemId)) return false;
          const item = items.find((candidate) => candidate.id === itemId);
          return item ? !item.is_excluded : false;
        })
      );

      return nextMarkedIds.size === previousMarkedIds.size
        ? previousMarkedIds
        : nextMarkedIds;
    });
  }, [items]);

  // ---- Exclusion actions (shared between views)
  const handleExcludeItems = useCallback(
    (itemIds: string[]) => {
      const includedIds = itemIds.filter((id) => {
        const item = items.find((i) => i.id === id);
        return item && !item.is_excluded;
      });
      if (includedIds.length === 0) return;
      setExclusionTargetIds(includedIds);
      setExclusionModalOpen(true);
    },
    [items]
  );

  const handleIncludeItems = useCallback(
    (itemIds: string[]) => {
      setItems((prev) =>
        prev.map((item) => {
          if (!itemIds.includes(item.id) || !item.is_excluded) return item;
          return {
            ...item,
            is_excluded: false,
            exclusion_reason: null,
            _dirty: true,
            _error: null,
          };
        })
      );
    },
    []
  );

  const handleSyncToItems = useCallback(
    (itemIds: string[]) => {
      setActiveTab("items");
      toast.info({
        title: "Synchronisation vers items",
        description: `${itemIds.length} item(s) synchronisé(s) dans la vue Items.`,
        durationMs: 2500,
      });
    },
    [setActiveTab, toast]
  );

  // ---- Evidence panel handlers
  const handleOpenEvidencePanel = useCallback((itemId: string) => {
    setEvidencePanelItemId(itemId);
  }, []);

  const handleCloseEvidencePanel = useCallback(() => {
    setEvidencePanelItemId(null);
  }, []);

  const handleEvidenceNavigate = useCallback(
    (direction: "prev" | "next") => {
      if (!evidencePanelItemId) return;
      const currentIndex = items.findIndex((i) => i.id === evidencePanelItemId);
      if (currentIndex === -1) return;
      const nextIndex = direction === "prev" ? currentIndex - 1 : currentIndex + 1;
      if (nextIndex >= 0 && nextIndex < items.length) {
        setEvidencePanelItemId(items[nextIndex].id);
      }
    },
    [evidencePanelItemId, items]
  );

  const handleUpdateEvidence = useCallback(
    (itemId: string, evidence: string | null) => {
      updateItemField(itemId, "evidence", evidence);
    },
    [updateItemField]
  );

  const handleUpdateSourcePage = useCallback(
    (itemId: string, sourcePage: number | null) => {
      updateItemField(itemId, "source_page", sourcePage);
    },
    [updateItemField]
  );

  const handleMarkVerified = useCallback(
    (itemId: string) => {
      updateItemField(itemId, "is_verified", true);
    },
    [updateItemField]
  );

  const handleApplyDiffSelection = useCallback(
    async (selectedBaseItemIds: string[]) => {
      setApplySelectionError(null);

      const hasPendingSave = items.some((item) => item._dirty || item._saving);
      if (hasPendingSave) {
        setApplySelectionError(
          "Finalisez d'abord les modifications en cours avant d'appliquer un cherry-pick."
        );
        return;
      }

      const selectedIdSet = new Set(selectedBaseItemIds);
      const patchEntries: TakeoffItemPatchEntry[] = [];

      for (const item of items) {
        const shouldBeIncluded = selectedIdSet.has(item.id);
        const nextIsExcluded = !shouldBeIncluded;
        const nextExclusionReason = nextIsExcluded
          ? CHERRY_PICK_EXCLUSION_REASON
          : null;

        const exclusionChanged =
          item.is_excluded !== nextIsExcluded ||
          item.exclusion_reason !== nextExclusionReason;

        if (!exclusionChanged) {
          continue;
        }

        patchEntries.push({
          item_id: item.id,
          updated_at: item.updated_at,
          fields: {
            is_excluded: nextIsExcluded,
            exclusion_reason: nextExclusionReason,
          },
        });
      }

      if (patchEntries.length === 0) {
        toast.info({
          title: "Aucun changement à appliquer",
          description: "La sélection correspond déjà à l'état actuel de l'extraction.",
        });
        return;
      }

      setApplySelectionSubmitting(true);
      try {
        let failedCount = 0;
        for (let index = 0; index < patchEntries.length; index += TAKEOFF_ITEM_PATCH_BATCH_MAX) {
          const chunk = patchEntries.slice(index, index + TAKEOFF_ITEM_PATCH_BATCH_MAX);
          const response = await patchTakeoffItems(jobId, { items: chunk });
          applyPatchResults(response);
          failedCount += response.failed;
        }

        if (failedCount > 0) {
          setApplySelectionError(
            `${failedCount} item(s) n'ont pas pu être mis à jour pendant le cherry-pick.`
          );
          toast.warning({
            title: "Cherry-pick partiel",
            description: "Certains items n'ont pas pu être synchronisés.",
          });
        } else {
          toast.success({
            title: "Cherry-pick appliqué",
            description: `${selectedBaseItemIds.length} item(s) gardé(s) pour l'apply.`,
          });
        }
      } catch (error) {
        const message = isTakeoffApiError(error)
          ? error.message
          : "Impossible d'appliquer la sélection cherry-pick.";
        setApplySelectionError(message);
        toast.error({
          title: "Erreur cherry-pick",
          description: message,
        });
      } finally {
        setApplySelectionSubmitting(false);
      }
    },
    [applyPatchResults, items, jobId, toast]
  );

  const handleExclusionConfirm = useCallback(
    (reason: string) => {
      setItems((prev) =>
        prev.map((item) => {
          if (!exclusionTargetIds.includes(item.id)) return item;
          return {
            ...item,
            is_excluded: true,
            exclusion_reason: reason,
            _dirty: true,
            _error: null,
          };
        })
      );
      setExclusionTargetIds([]);
    },
    [exclusionTargetIds]
  );

  // ---- Apply readiness
  const includedItems = items.filter((i) => !i.is_excluded);
  const hasIncluded = includedItems.length > 0;
  const hasDirtyOrSaving = items.some((i) => i._dirty || i._saving);
  const hasSaveErrors = items.some((i) => i._error !== null);
  const hasBlockingAnomalies = includedItems.some(hasBlockingAnomaly);
  const guardResult = useMemo(() => {
    if (jobLevel !== "C") return null;
    return checkApplyGuard(includedItems, lowConfidenceThreshold);
  }, [includedItems, jobLevel, lowConfidenceThreshold]);
  const hasGuardBlocks = guardResult !== null && !guardResult.passed;
  const hasDpgfBlocks = hasBlockingTakeoffDpgfExceptions(
    dpgfCompareData?.summary ?? null
  );
  const isDpgfValidationPending =
    dpgfCompareLoading || dpgfCompareData === null;
  const hasDpgfValidationError = dpgfCompareError !== null;
  const hasAlreadyBeenApplied = jobStatus === "applied" || applySuccess !== null;
  const canOpenApplyWizard =
    !hasAlreadyBeenApplied &&
    jobStatus === "completed" &&
    hasIncluded &&
    !hasDirtyOrSaving &&
    !hasSaveErrors &&
    !hasBlockingAnomalies &&
    !isDpgfValidationPending &&
    !hasDpgfValidationError &&
    !hasDpgfBlocks;
  const isApplyReady = canOpenApplyWizard && !hasGuardBlocks;
  const applyReadinessMessage = useMemo(() => {
    if (hasAlreadyBeenApplied) {
      return "Ce métré a déjà été appliqué au chiffrage.";
    }

    if (!hasIncluded) {
      return "Aucun item retenu. Réintégrez au moins une ligne avant l'apply.";
    }

    if (hasDirtyOrSaving) {
      return "Attendez la fin des sauvegardes avant d'ouvrir l'apply contrôlé.";
    }

    if (hasSaveErrors) {
      return "Corrigez les lignes en erreur avant l'apply.";
    }

    if (hasBlockingAnomalies) {
      return "Corrigez les anomalies bloquantes avant l'apply.";
    }

    if (isDpgfValidationPending) {
      return "Attendez le chargement du rapprochement DPGF avant d'ouvrir l'apply contrôlé.";
    }

    if (hasDpgfValidationError) {
      return "Impossible de valider le rapprochement DPGF. Rechargez cette revue avant l'apply.";
    }

    if (hasDpgfBlocks) {
      return "Des rapprochements DPGF restent à trancher. Ouvrez la revue détaillée pour finaliser les liens manuels.";
    }

    if (hasGuardBlocks) {
      return `Le contrôle de ${guardResult?.blocked_items.length ?? 0} item(s) reste incomplet : complétez les preuves localisées ou la validation humaine avant l'application.`;
    }

    return "L'apply contrôlé est prêt. Choisissez une stratégie et vérifiez l'impact avant confirmation.";
  }, [
    guardResult,
    hasBlockingAnomalies,
    hasDpgfBlocks,
    hasDpgfValidationError,
    hasDirtyOrSaving,
    hasGuardBlocks,
    hasIncluded,
    hasAlreadyBeenApplied,
    hasSaveErrors,
    isDpgfValidationPending,
  ]);
  const handleOpenApplyWizard = useCallback(() => {
    if (!isApplyReady) return;
    setApplyWizardOpen(true);
    setApplyError(null);
  }, [isApplyReady]);

  // ---- Apply handler
  const handleApplyConfirm = useCallback(
    async (payload: TakeoffApplyWizardSubmitPayload) => {
      setApplySubmitting(true);
      setApplyError(null);
      let shouldReleaseDraftLock = false;

      try {
        const lockResult = await ensureTakeoffApplyDraftLock(versionId);
        if (!lockResult.acquired) {
          setApplyError(
            lockResult.errorMessage ??
              "Impossible d'acquérir le verrou de brouillon de la version cible."
          );
          return;
        }

        shouldReleaseDraftLock = lockResult.shouldRelease;

        const response = await applyTakeoffJob(jobId, {
          strategy: payload.strategy,
          target_section_id: payload.targetSectionId,
          overrides: payload.overrides.length > 0 ? payload.overrides : undefined,
          override: payload.override,
          override_justification: payload.overrideJustification,
        }, versionId);
        setApplyWizardOpen(false);
        setApplySuccess({
          appliedAt: new Date().toISOString(),
          targetSectionLabel: payload.targetSectionLabel,
          strategy: payload.strategy,
          createdCount: response.summary.created_count,
          updatedCount: response.summary.updated_count,
          ignoredCount: response.summary.ignored_count,
        });
        setJobStatus("applied");
        toast.success({
          title: "Apply contrôlé terminé",
          description: `${response.summary.created_count} créé(s), ${response.summary.updated_count} mis à jour, ${response.summary.ignored_count} ignoré(s).`,
        });
        if (!isAffaireContext) {
          router.push(`/dashboard/estimates/${versionId}/takeoff/${jobId}`);
        }
      } catch (err) {
        setApplyError(
          isTakeoffApiError(err) ? err.message : "Erreur lors de l'application."
        );
      } finally {
        if (shouldReleaseDraftLock) {
          void releaseEstimateDraftLock(versionId).catch(() => false);
        }
        setApplySubmitting(false);
      }
    },
    [jobId, isAffaireContext, router, toast, versionId]
  );

  const reviewTitle = isAffaireContext
    ? "Revue des exceptions & preuves"
    : "Revue d’extraction";
  const backHref = isAffaireContext
    ? `/dashboard/affaires/${projectId}/takeoff`
    : `/dashboard/estimates/${versionId}/takeoff/${jobId}`;
  const backLabel = isAffaireContext
    ? "Centre d'activité métrés"
    : "Retour à l'extraction";

  if (loading) {
    return <TakeoffReviewLoadingState title={reviewTitle} />;
  }

  if (loadError) {
    return (
      <TakeoffReviewErrorState
        title={reviewTitle}
        message={loadError}
        backHref={backHref}
        backLabel={backLabel}
      />
    );
  }

  return (
    <div className="animate-fade-in space-y-4">
      <ProductionRibbon
        ariaLabel="Ruban métier de la revue de métrés"
        testId="takeoff-review-production-ribbon"
      >
        <ProductionRibbonHeader
          breadcrumbs={
            isAffaireContext
              ? [
                  { label: "Affaires", href: "/dashboard/affaires" },
                  {
                    label: "Métrés",
                    href: `/dashboard/affaires/${projectId}/takeoff`,
                  },
                  {
                    label:
                      jobVersionNumber !== null
                        ? `V${jobVersionNumber} · Revue`
                        : "Revue",
                  },
                ]
              : [
                  { label: "Chiffrages", href: "/dashboard/estimates" },
                  {
                    label: "Métrés",
                    href: `/dashboard/estimates/${versionId}/takeoff`,
                  },
                  { label: "Revue" },
                ]
          }
          title={reviewTitle}
          description={
            <>
              {jobFileName ?? "Extraction"} · {tables.length} table
              {tables.length > 1 ? "s" : ""} · {items.length} item
              {items.length > 1 ? "s" : ""}
            </>
          }
          actions={
            <>
              {jobStatus ? (
                <span className={`status-badge ${getStatusCss(jobStatus)}`}>
                  {getStatusLabel(jobStatus)}
                </span>
              ) : null}
              {jobLevel ? (
                <Badge variant="neutral" size="sm">
                  {getBusinessLevelLabel(jobLevel)}
                </Badge>
              ) : null}
              <Link
                href={backHref}
                className={buttonVariants({ variant: "outline" })}
              >
                {backLabel}
              </Link>
            </>
          }
        />
        <TakeoffReviewModeSwitch
          mode={currentReviewMode}
          onModeChange={setReviewMode}
        />
      </ProductionRibbon>

      <div
        id="takeoff-review-mode-panel"
        role="tabpanel"
        aria-labelledby={`takeoff-review-mode-${currentReviewMode}-tab`}
        className="space-y-4"
      >
      {/* ---- Confidence header (Level C only) ---- */}
      {jobLevel === "C" && (
        <ConfidenceHeader globalConfidence={globalConfidence} items={items} />
      )}

      {applySuccess && isAffaireContext ? (
        <TakeoffApplySuccessBanner
          sourceFileName={jobFileName}
          targetSectionLabel={applySuccess.targetSectionLabel}
          strategy={applySuccess.strategy}
          createdCount={applySuccess.createdCount}
          updatedCount={applySuccess.updatedCount}
          ignoredCount={applySuccess.ignoredCount}
          estimateHref={`/dashboard/estimates/${versionId}`}
          activityHref={`/dashboard/affaires/${projectId}/takeoff`}
        />
      ) : null}

      {/* ---- Mode-conditional content ---- */}
      {currentReviewMode === "assisted" ? (
        <AssistedReviewPanel
          items={items}
          reviewedIds={assistedReviewedIds}
          markedForReviewIds={assistedMarkedForReviewIds}
          onReviewedIdsChange={setAssistedReviewedIds}
          onMarkedForReviewIdsChange={setAssistedMarkedForReviewIds}
          onExcludeItems={handleExcludeItems}
          onIncludeItems={handleIncludeItems}
          onApplyClick={handleOpenApplyWizard}
          isApplyReady={isApplyReady}
        />
      ) : currentReviewMode === "validation" ? (
        <LazyValidationReviewPanel
          items={items}
          dpgfSummary={dpgfCompareData?.summary ?? null}
          dpgfLoading={dpgfCompareLoading}
          dpgfError={dpgfCompareError}
          hasDirtyOrSaving={hasDirtyOrSaving}
          hasSaveErrors={hasSaveErrors}
          requiresLocalizedProof={jobLevel === "C"}
          onOpenEvidencePanel={handleOpenEvidencePanel}
          onVerifyItem={handleMarkVerified}
          onExcludeItem={(itemId) => handleExcludeItems([itemId])}
          onIncludeItem={(itemId) => handleIncludeItems([itemId])}
          onOpenDpgfExceptions={openDpgfExceptions}
          onOpenDetailedReview={() => openProductionReview("items")}
          canOpenApplyWizard={isApplyReady}
          applyReadinessMessage={applyReadinessMessage}
          onOpenApplyWizard={handleOpenApplyWizard}
        />
      ) : (
        <LazyTakeoffReviewExpert
          items={items}
          tables={tables}
          jobLevel={jobLevel}
          activeTab={activeTab}
          onSetActiveTab={setActiveTab}
          compareCandidates={compareCandidates}
          compareWithJobId={compareWithJobId}
          compareThreshold={compareThreshold}
          compareData={compareData}
          compareLoading={compareLoading}
          compareError={compareError}
          onSetCompareWithJobId={setCompareWithJobId}
          onSetCompareThreshold={setCompareThreshold}
          onApplyDiffSelection={handleApplyDiffSelection}
          applySelectionSubmitting={applySelectionSubmitting}
          applySelectionError={applySelectionError}
          dpgfCompareData={dpgfCompareData}
          dpgfCompareView={dpgfCompareView}
          dpgfCompareLoading={dpgfCompareLoading}
          dpgfCompareError={dpgfCompareError}
          onSetDpgfCompareView={setDpgfCompareView}
          onRefreshDpgfCompare={refreshDpgfCompare}
          onUpdateItem={updateItemField}
          onExcludeItems={handleExcludeItems}
          onIncludeItems={handleIncludeItems}
          onSyncToItems={handleSyncToItems}
          onOpenEvidencePanel={handleOpenEvidencePanel}
        />
      )}

      {/* ---- Apply readiness bar (production mode only, others have built-in bars) ---- */}
      {currentReviewMode === "production" ? (
        <TakeoffApplyReadinessBar
          isApplyReady={isApplyReady}
          includedCount={includedItems.length}
          readinessMessage={applyReadinessMessage}
          onOpenApplyWizard={handleOpenApplyWizard}
        />
      ) : null}
      </div>

      {/* ---- Exclusion modal ---- */}
      <ExclusionReasonDialog
        open={exclusionModalOpen}
        onOpenChange={setExclusionModalOpen}
        count={exclusionTargetIds.length}
        onConfirm={handleExclusionConfirm}
      />

      {/* ---- Apply wizard ---- */}
      {applyWizardOpen ? <TakeoffApplyWizard
        open={applyWizardOpen}
        jobId={jobId}
        versionId={versionId}
        targetVersionLabel={
          jobVersionNumber !== null ? `V${jobVersionNumber}` : null
        }
        includedCount={includedItems.length}
        excludedCount={items.length - includedItems.length}
        isSubmitting={applySubmitting}
        submitError={applyError}
        onOpenChange={setApplyWizardOpen}
        onConfirm={handleApplyConfirm}
        items={items}
        sourceFileName={jobFileName}
        jobLevel={jobLevel}
        confidenceThreshold={lowConfidenceThreshold}
        isAdmin={isAdmin}
        onReturnToReview={() => setApplyWizardOpen(false)}
      /> : null}

      {/* ---- Evidence panel ---- */}
      {evidencePanelItemId != null && (() => {
        const panelItem = items.find((i) => i.id === evidencePanelItemId);
        if (!panelItem) return null;
        const panelIndex = items.findIndex((i) => i.id === evidencePanelItemId);
        return (
          <EvidencePanel
            key={panelItem.id}
            item={panelItem}
            itemIndex={panelIndex}
            totalItems={items.length}
            onClose={handleCloseEvidencePanel}
            onNavigate={handleEvidenceNavigate}
            onUpdateEvidence={handleUpdateEvidence}
            onUpdateSourcePage={handleUpdateSourcePage}
            onMarkVerified={handleMarkVerified}
            requiresLocalizedProof={jobLevel === "C"}
          />
        );
      })()}
    </div>
  );
}
