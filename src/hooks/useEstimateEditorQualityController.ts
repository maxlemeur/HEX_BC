"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  computeEstimateChecklist,
  type EstimateChecklistCriterion,
  type EstimateChecklistResult,
  type EstimateChecklistSettingsInput,
} from "@/lib/estimates/checklist";
import {
  countEstimateQualityFlags,
  computeEstimateQualityFlagsByItemId,
  type EstimateQualityFlagCounts,
  type EstimateQualityFlagKey,
  type EstimateQualityFlagsByItemId,
} from "@/lib/estimate-quality";
import {
  fetchEstimateOutlierDismissedFlags,
  toggleEstimateOutlierDismissedFlag,
} from "@/lib/estimates/client";
import type { EstimateItem } from "@/lib/estimates/editor-items";
import {
  DEFAULT_ESTIMATE_OUTLIER_CONFIG,
  detectEstimateOutliers,
  type EstimateOutlierDetectionConfig,
  type EstimateOutlierFlagKey,
  type EstimateOutlierFlagsByItemId,
  type EstimateOutlierMethod,
} from "@/lib/estimates/outlier-detection";
import type { Database } from "@/types/database";

type EstimateCategory =
  Database["public"]["Tables"]["estimate_categories"]["Row"];

export type EstimateQualityFilter =
  | "all_lines"
  | "with_anomalies"
  | EstimateQualityFlagKey;

type EstimateEditorQualityControllerInput = {
  routeVersionId: string;
  activeVersionId: string | null;
  reloadToken: number;
  items: EstimateItem[];
  deferredItems: EstimateItem[];
  categories: EstimateCategory[];
  settings: EstimateChecklistSettingsInput | null;
  isReadOnly: boolean;
  readOnlyErrorMessage: string;
  isConflictLocked: boolean;
  conflictMessage: string | null;
  reportError: (message: string | null) => void;
  resolveErrorMessage: (message: string) => string;
  onVersionConflict: (error: unknown) => boolean;
  openSettings: () => void;
};

export type EstimateEditorQualityController = {
  state: {
    qualityFilter: EstimateQualityFilter;
    outlierConfig: EstimateOutlierDetectionConfig;
    dismissedOutlierFlagsByItemId: EstimateOutlierFlagsByItemId;
    outlierActionPendingByItemId: Record<string, boolean>;
    isFinalizationPanelOpen: boolean;
    isChecklistCollapsed: boolean;
    scrollTargetItemId: string | null;
  };
  actions: {
    changeQualityFilter: (nextFilter: EstimateQualityFilter) => void;
    changeOutlierMethod: (nextMethod: EstimateOutlierMethod) => void;
    changeOutlierThreshold: (nextThreshold: number) => void;
    toggleOutlierDismiss: (
      itemId: string,
      flagKey: EstimateOutlierFlagKey,
      dismissed: boolean
    ) => Promise<void>;
    toggleFinalizationPanel: () => void;
    toggleChecklistCollapsed: () => void;
    selectChecklistCriterion: (criterion: EstimateChecklistCriterion) => void;
    showChecklistAnomalies: () => void;
    focusItem: (itemId: string) => void;
    markScrollHandled: () => void;
  };
  meta: {
    detectedOutlierFlagsByItemId: EstimateOutlierFlagsByItemId;
    qualityFlagsByItemId: EstimateQualityFlagsByItemId;
    qualityCounts: EstimateQualityFlagCounts;
    checklist: EstimateChecklistResult;
  };
};

function deferEffectStateUpdate(
  update: () => void | (() => void)
): () => void {
  let isActive = true;
  let cleanup: void | (() => void);

  queueMicrotask(() => {
    if (!isActive) return;
    cleanup = update();
  });

  return () => {
    isActive = false;
    if (cleanup) cleanup();
  };
}

export function useEstimateEditorQualityController({
  routeVersionId,
  activeVersionId,
  reloadToken,
  items,
  deferredItems,
  categories,
  settings,
  isReadOnly,
  readOnlyErrorMessage,
  isConflictLocked,
  conflictMessage,
  reportError,
  resolveErrorMessage,
  onVersionConflict,
  openSettings,
}: EstimateEditorQualityControllerInput): EstimateEditorQualityController {
  const [dismissedOutlierFlagsByItemId, setDismissedOutlierFlagsByItemId] =
    useState<EstimateOutlierFlagsByItemId>({});
  const [outlierActionPendingByItemId, setOutlierActionPendingByItemId] =
    useState<Record<string, boolean>>({});
  const [outlierConfig, setOutlierConfig] =
    useState<EstimateOutlierDetectionConfig>(DEFAULT_ESTIMATE_OUTLIER_CONFIG);
  const [qualityFilter, setQualityFilter] =
    useState<EstimateQualityFilter>("all_lines");
  const [isFinalizationPanelOpen, setIsFinalizationPanelOpen] = useState(false);
  const [isChecklistCollapsed, setIsChecklistCollapsed] = useState(true);
  const [scrollTargetItemId, setScrollTargetItemId] = useState<string | null>(
    null
  );
  const activeRouteVersionIdRef = useRef(routeVersionId);
  const activeVersionIdRef = useRef(activeVersionId);
  const previousRouteVersionIdRef = useRef(routeVersionId);
  const routeGenerationRef = useRef(0);
  const outlierMutationGenerationByItemRef = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    activeRouteVersionIdRef.current = routeVersionId;
    activeVersionIdRef.current = activeVersionId;
    if (previousRouteVersionIdRef.current === routeVersionId) return;

    previousRouteVersionIdRef.current = routeVersionId;
    routeGenerationRef.current += 1;
    outlierMutationGenerationByItemRef.current.clear();
    setDismissedOutlierFlagsByItemId({});
    setOutlierActionPendingByItemId({});
  }, [activeVersionId, routeVersionId]);

  useEffect(() => {
    const lineIds = new Set(
      items.filter((item) => item.item_type === "line").map((item) => item.id)
    );

    return deferEffectStateUpdate(() => {
      setDismissedOutlierFlagsByItemId((previous) => {
        let changed = false;
        const next: EstimateOutlierFlagsByItemId = {};

        Object.entries(previous).forEach(([itemId, flags]) => {
          if (!lineIds.has(itemId)) {
            changed = true;
            return;
          }

          const deduped = flags.filter(
            (flag, index) => flags.indexOf(flag) === index
          );
          if (deduped.length !== flags.length) {
            changed = true;
          }
          if (deduped.length === 0) {
            changed = true;
            return;
          }
          next[itemId] = deduped;
        });

        return changed ? next : previous;
      });

      setOutlierActionPendingByItemId((previous) => {
        let changed = false;
        const next: Record<string, boolean> = {};

        Object.entries(previous).forEach(([itemId, isPending]) => {
          if (!isPending) return;
          if (!lineIds.has(itemId)) {
            changed = true;
            return;
          }
          next[itemId] = true;
        });

        return changed ? next : previous;
      });
    });
  }, [items]);

  useEffect(() => {
    if (!routeVersionId) {
      return deferEffectStateUpdate(() => {
        setDismissedOutlierFlagsByItemId({});
        setOutlierActionPendingByItemId({});
      });
    }

    let active = true;

    async function loadDismissedOutliers() {
      try {
        const dismissed =
          await fetchEstimateOutlierDismissedFlags(routeVersionId);
        if (!active) return;
        setDismissedOutlierFlagsByItemId(dismissed);
      } catch {
        if (!active) return;
        setDismissedOutlierFlagsByItemId({});
      }
    }

    void loadDismissedOutliers();

    return () => {
      active = false;
    };
  }, [reloadToken, routeVersionId]);

  const detectedOutlierFlagsByItemId = useMemo(
    () =>
      detectEstimateOutliers({
        items: deferredItems,
        categories,
        config: outlierConfig,
      }),
    [categories, deferredItems, outlierConfig]
  );

  const qualityFlagsByItemId = useMemo(
    () =>
      computeEstimateQualityFlagsByItemId(deferredItems, {
        outlierFlagsByItemId: detectedOutlierFlagsByItemId,
        dismissedOutlierFlagsByItemId,
      }),
    [
      deferredItems,
      detectedOutlierFlagsByItemId,
      dismissedOutlierFlagsByItemId,
    ]
  );

  const qualityCounts = useMemo(
    () => countEstimateQualityFlags(qualityFlagsByItemId),
    [qualityFlagsByItemId]
  );

  const checklist = useMemo(
    () =>
      computeEstimateChecklist({
        items: deferredItems,
        qualityFlagsByItemId,
        settings,
      }),
    [deferredItems, qualityFlagsByItemId, settings]
  );

  const changeQualityFilter = useCallback(
    (nextFilter: EstimateQualityFilter) => {
      startTransition(() => {
        setQualityFilter(nextFilter);
      });
    },
    []
  );

  const changeOutlierMethod = useCallback(
    (nextMethod: EstimateOutlierMethod) => {
      startTransition(() => {
        setOutlierConfig((previous) => ({
          ...previous,
          method: nextMethod,
        }));
      });
    },
    []
  );

  const changeOutlierThreshold = useCallback((nextThreshold: number) => {
    if (!Number.isFinite(nextThreshold) || nextThreshold <= 0) return;
    startTransition(() => {
      setOutlierConfig((previous) => ({
        ...previous,
        threshold: nextThreshold,
      }));
    });
  }, []);

  const toggleOutlierDismiss = useCallback(
    async (
      itemId: string,
      flagKey: EstimateOutlierFlagKey,
      dismissed: boolean
    ) => {
      if (isReadOnly) {
        reportError(readOnlyErrorMessage);
        return;
      }
      if (isConflictLocked) {
        reportError(
          conflictMessage ?? "Version modifiee par un autre utilisateur"
        );
        return;
      }
      if (!activeVersionId || activeVersionId !== routeVersionId) {
        reportError("Version introuvable.");
        return;
      }

      const targetVersionId = activeVersionId;
      const routeGeneration = routeGenerationRef.current;
      const operationGeneration =
        (outlierMutationGenerationByItemRef.current.get(itemId) ?? 0) + 1;
      outlierMutationGenerationByItemRef.current.set(
        itemId,
        operationGeneration
      );
      const isCurrentOperation = () =>
        activeRouteVersionIdRef.current === targetVersionId &&
        activeVersionIdRef.current === targetVersionId &&
        routeGenerationRef.current === routeGeneration &&
        outlierMutationGenerationByItemRef.current.get(itemId) ===
          operationGeneration;

      reportError(null);
      setOutlierActionPendingByItemId((previous) => ({
        ...previous,
        [itemId]: true,
      }));

      try {
        const nextDismissed = await toggleEstimateOutlierDismissedFlag(
          targetVersionId,
          {
            itemId,
            flagKey,
            dismissed,
          }
        );
        if (!isCurrentOperation()) return;
        setDismissedOutlierFlagsByItemId(nextDismissed);
      } catch (error) {
        if (!isCurrentOperation()) return;
        if (!onVersionConflict(error)) {
          reportError(
            resolveErrorMessage(
              error instanceof Error
                ? error.message
                : "Impossible de mettre a jour l'acceptation de l'outlier."
            )
          );
        }
      } finally {
        if (!isCurrentOperation()) return;
        outlierMutationGenerationByItemRef.current.delete(itemId);
        setOutlierActionPendingByItemId((previous) => {
          if (!previous[itemId]) return previous;
          const next = { ...previous };
          delete next[itemId];
          return next;
        });
      }
    },
    [
      activeVersionId,
      conflictMessage,
      isConflictLocked,
      isReadOnly,
      onVersionConflict,
      readOnlyErrorMessage,
      reportError,
      resolveErrorMessage,
      routeVersionId,
    ]
  );

  const toggleFinalizationPanel = useCallback(() => {
    setIsFinalizationPanelOpen((previous) => !previous);
  }, []);

  const toggleChecklistCollapsed = useCallback(() => {
    setIsChecklistCollapsed((previous) => !previous);
  }, []);

  const selectChecklistCriterion = useCallback(
    (criterion: EstimateChecklistCriterion) => {
      if (!criterion.targetItemId) {
        openSettings();
        return;
      }

      if (criterion.qualityFlag) {
        setQualityFilter(criterion.qualityFlag);
      }
      setScrollTargetItemId(criterion.targetItemId);
    },
    [openSettings]
  );

  const showChecklistAnomalies = useCallback(() => {
    setQualityFilter("with_anomalies");
    const firstAffectedLine = deferredItems.find(
      (item) =>
        item.item_type === "line" &&
        (qualityFlagsByItemId[item.id]?.length ?? 0) > 0
    );
    if (firstAffectedLine) {
      setScrollTargetItemId(firstAffectedLine.id);
    }
  }, [deferredItems, qualityFlagsByItemId]);

  const focusItem = useCallback((itemId: string) => {
    setScrollTargetItemId(itemId);
  }, []);

  const markScrollHandled = useCallback(() => {
    setScrollTargetItemId(null);
  }, []);

  const state = useMemo(
    () => ({
      qualityFilter,
      outlierConfig,
      dismissedOutlierFlagsByItemId,
      outlierActionPendingByItemId,
      isFinalizationPanelOpen,
      isChecklistCollapsed,
      scrollTargetItemId,
    }),
    [
      dismissedOutlierFlagsByItemId,
      isChecklistCollapsed,
      isFinalizationPanelOpen,
      outlierActionPendingByItemId,
      outlierConfig,
      qualityFilter,
      scrollTargetItemId,
    ]
  );

  const actions = useMemo(
    () => ({
      changeQualityFilter,
      changeOutlierMethod,
      changeOutlierThreshold,
      toggleOutlierDismiss,
      toggleFinalizationPanel,
      toggleChecklistCollapsed,
      selectChecklistCriterion,
      showChecklistAnomalies,
      focusItem,
      markScrollHandled,
    }),
    [
      changeOutlierMethod,
      changeOutlierThreshold,
      changeQualityFilter,
      focusItem,
      markScrollHandled,
      selectChecklistCriterion,
      showChecklistAnomalies,
      toggleChecklistCollapsed,
      toggleFinalizationPanel,
      toggleOutlierDismiss,
    ]
  );

  const meta = useMemo(
    () => ({
      detectedOutlierFlagsByItemId,
      qualityFlagsByItemId,
      qualityCounts,
      checklist,
    }),
    [
      checklist,
      detectedOutlierFlagsByItemId,
      qualityCounts,
      qualityFlagsByItemId,
    ]
  );

  return { state, actions, meta };
}
