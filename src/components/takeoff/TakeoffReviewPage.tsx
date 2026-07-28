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
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useUserContext } from "@/components/UserContext";
import { ConfidenceHeader } from "@/components/takeoff/ConfidenceHeader";
import { EvidencePanel } from "@/components/takeoff/EvidencePanel";
import {
  TakeoffReviewModeSwitch,
  type ReviewMode,
} from "@/components/takeoff/review/TakeoffReviewModeSwitch";
import { AssistedReviewPanel } from "@/components/takeoff/review/AssistedReviewPanel";
import { useUiMode } from "@/hooks/useUiMode";
import {
  hasBlockingAnomaly,
} from "@/components/takeoff/TakeoffReviewTable";
import {
  getBusinessLevelLabel,
  getStatusCss,
  getStatusLabel,
} from "@/components/takeoff/takeoff-job-list-shared";
import {
  TakeoffApplyWizard,
  type TakeoffApplyWizardSubmitPayload,
} from "@/components/takeoff/TakeoffApplyWizard";
import { releaseEstimateDraftLock } from "@/lib/estimates/client";
import { ensureTakeoffApplyDraftLock } from "@/lib/takeoff/apply-draft-lock";

const LazyTakeoffReviewExpert = dynamic(
  () =>
    import("@/components/takeoff/TakeoffReviewExpert").then((mod) => ({
      default: mod.TakeoffReviewExpert,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="dashboard-card p-8 text-center text-sm text-[var(--slate-500)]">
        Chargement de la vue avancee...
      </div>
    ),
  }
);

const LazyValidationReviewPanel = dynamic(
  () =>
    import("@/components/takeoff/review/ValidationReviewPanel").then((mod) => ({
      default: mod.ValidationReviewPanel,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="dashboard-card p-8 text-center text-sm text-[var(--slate-500)]">
        Chargement de la vue validation...
      </div>
    ),
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
// Exclusion reason modal
// ---------------------------------------------------------------------------

function ExclusionReasonModal({
  open,
  onOpenChange,
  count,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const canConfirm = reason.trim().length > 0;
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setReason("");
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange]
  );

  return (
    <Modal.Root open={open} onOpenChange={handleOpenChange}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>
            Exclure {count} item{count > 1 ? "s" : ""}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <label className="block text-sm font-medium text-[var(--slate-700)]">
            Motif d&apos;exclusion (obligatoire)
          </label>
          <textarea
            className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm focus:border-[var(--ring)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Indiquer le motif d'exclusion..."
            maxLength={500}
          />
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>Annuler</Modal.Close>
          <Button
            variant="danger"
            size="sm"
            disabled={!canConfirm}
            onClick={() => {
              onConfirm(reason.trim());
              handleOpenChange(false);
            }}
          >
            Exclure
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
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

  // ---- Review mode from URL (V3-012: Assiste / Production / Validation)
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
          return { ...item, [field]: value, _dirty: true, _error: null };
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
          title: `${failedCount} item(s) non sauvegarde(s)`,
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
                _error: "Echec de sauvegarde.",
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
        description: `${itemIds.length} item(s) synchronise(s) dans la vue Items.`,
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
          title: "Aucun changement a appliquer",
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
            `${failedCount} item(s) n'ont pas pu etre mis a jour pendant le cherry-pick.`
          );
          toast.warning({
            title: "Cherry-pick partiel",
            description: "Certains items n'ont pas pu etre synchronises.",
          });
        } else {
          toast.success({
            title: "Cherry-pick applique",
            description: `${selectedBaseItemIds.length} item(s) gardes pour l'apply.`,
          });
        }
      } catch (error) {
        const message = isTakeoffApiError(error)
          ? error.message
          : "Impossible d'appliquer la selection cherry-pick.";
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
      return "Aucun item retenu. Reintegrez au moins une ligne avant l'apply.";
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
      return "Des rapprochements DPGF restent a trancher. Ouvrez la revue detaillee pour finaliser les liens manuels.";
    }

    if (hasGuardBlocks) {
      return `${guardResult?.blocked_items.length ?? 0} item(s) a faible confiance doivent etre verifies avant l'apply.`;
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
              "Impossible d'acquerir le verrou de brouillon de la version cible."
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
        });
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
          description: `${response.summary.created_count} cree(s), ${response.summary.updated_count} mis a jour, ${response.summary.ignored_count} ignore(s).`,
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

  // ---- Batch verify handler for guard panel
  const handleWizardVerifyItems = useCallback(
    async (itemIds: string[]) => {
      const entries: TakeoffItemPatchEntry[] = itemIds.reduce<TakeoffItemPatchEntry[]>(
        (acc, id) => {
          const item = items.find((i) => i.id === id);
          if (!item) return acc;
          acc.push({
            item_id: id,
            updated_at: item.updated_at,
            fields: { is_verified: true },
          });
          return acc;
        },
        []
      );

      if (entries.length === 0) return;

      const responses: TakeoffItemBatchPatchResponse[] = [];
      for (
        let index = 0;
        index < entries.length;
        index += TAKEOFF_ITEM_PATCH_BATCH_MAX
      ) {
        const chunk = entries.slice(index, index + TAKEOFF_ITEM_PATCH_BATCH_MAX);
        const response = await patchTakeoffItems(jobId, { items: chunk });
        responses.push(response);
      }

      const resultByItemId = new Map<
        string,
        TakeoffItemBatchPatchResponse["results"][number]
      >();
      for (const response of responses) {
        for (const result of response.results) {
          resultByItemId.set(result.item_id, result);
        }
      }

      setItems((prev) =>
        prev.map((item) => {
          const result = resultByItemId.get(item.id);
          if (!result || !result.success || !result.item) return item;
          return { ...result.item, _dirty: false, _saving: false, _error: null };
        })
      );
    },
    [jobId, items]
  );

  // ---- Loading state
  if (loading) {
    return (
      <div className="animate-fade-in">
        <div className="page-header flex items-start gap-3">
          <div>
            <h1 className="page-title">Revue d&apos;extraction</h1>
            <p className="page-description">Chargement...</p>
          </div>
        </div>
        <div className="dashboard-card p-6">
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-4 animate-pulse rounded bg-[var(--slate-200)]"
                style={{ width: `${60 + (i % 3) * 15}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ---- Error state
  if (loadError) {
    return (
      <div className="animate-fade-in">
        <div className="page-header flex items-start gap-3">
          <div>
            <h1 className="page-title">Revue d&apos;extraction</h1>
            <p className="page-description">{loadError}</p>
          </div>
        </div>
        <div className="mt-4 flex gap-3">
          <Link
            href={`/dashboard/estimates/${versionId}/takeoff/${jobId}`}
            className="btn btn-secondary btn-sm"
          >
            Retour à l&apos;extraction
          </Link>
        </div>
      </div>
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
                  { label: "Mes affaires", href: "/dashboard/affaires" },
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
          title={
            isAffaireContext
              ? "Revue des exceptions & preuves"
              : "Revue d'extraction"
          }
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
                href={
                  isAffaireContext
                    ? `/dashboard/affaires/${projectId}/takeoff`
                    : `/dashboard/estimates/${versionId}/takeoff/${jobId}`
                }
                className="btn btn-secondary btn-sm"
              >
                {isAffaireContext
                  ? "Centre d'activité métrés"
                  : "Retour à l'extraction"}
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
        <section className="rounded-2xl border border-[var(--success)]/20 bg-[var(--success)]/5 p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--success)]">
                Apply controle confirme
              </p>
              <h2 className="mt-1 text-lg font-semibold text-[var(--slate-900)]">
                Le devis a ete enrichi depuis le metre source
              </h2>
              <p className="mt-2 text-sm text-[var(--slate-700)]">
                Source: {jobFileName ?? "job takeoff"} · Section: {applySuccess.targetSectionLabel}
              </p>
              <p className="mt-1 text-sm text-[var(--slate-700)]">
                Strategie: {applySuccess.strategy} · crees {applySuccess.createdCount} · mis a jour {applySuccess.updatedCount} · ignores {applySuccess.ignoredCount}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/dashboard/estimates/${versionId}`} className="btn btn-primary btn-sm">
                Ouvrir le chiffrage
              </Link>
              <Link
                href={`/dashboard/affaires/${projectId}/takeoff`}
                className="btn btn-secondary btn-sm"
              >
                Centre d&apos;activite metres
              </Link>
            </div>
          </div>
        </section>
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
      {currentReviewMode === "production" && <div className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          {isApplyReady ? (
            <span className="flex items-center gap-2 text-[var(--success)]">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.06l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
              </svg>
              Pret a appliquer ({includedItems.length} items)
            </span>
          ) : (
            <span className="flex items-center gap-2 text-[var(--slate-500)]">
              {applyReadinessMessage}
            </span>
          )}
        </div>
        <Button
          variant="primary"
          size="sm"
          className="w-full justify-center sm:w-auto"
          disabled={!isApplyReady}
          onClick={handleOpenApplyWizard}
          title={
            hasGuardBlocks
              ? "Vérifiez les items à faible confiance avant d'appliquer"
              : !canOpenApplyWizard
                ? "Resolves les problemes avant d'appliquer"
                : "Appliquer les items au chiffrage"
          }
        >
          Appliquer au chiffrage
        </Button>
      </div>}
      </div>

      {/* ---- Exclusion modal ---- */}
      <ExclusionReasonModal
        open={exclusionModalOpen}
        onOpenChange={setExclusionModalOpen}
        count={exclusionTargetIds.length}
        onConfirm={handleExclusionConfirm}
      />

      {/* ---- Apply wizard ---- */}
      <TakeoffApplyWizard
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
        onVerifyItems={handleWizardVerifyItems}
        onReturnToReview={() => setApplyWizardOpen(false)}
      />

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
            onMarkVerified={handleMarkVerified}
          />
        );
      })()}
    </div>
  );
}
