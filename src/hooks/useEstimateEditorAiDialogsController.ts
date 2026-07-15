"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { GeneratedOuvrageDialogProps } from "@/components/estimates/GeneratedOuvrageDialog";
import type { ExistingSection } from "@/components/estimates/generated-ouvrage-types";
import type { VersionZeroDraftDialogProps } from "@/components/estimates/VersionZeroDraftDialog";
import type { VersionZeroDraftSummary } from "@/lib/estimates/client";
import type {
  EditorEstimateItem,
  EstimateVersionRow,
} from "@/lib/estimates/editor-items";

export type EstimateEditorAiMutationSource =
  | "generated-ouvrage"
  | "version-zero";

type RouteScope = {
  scopeKey: string;
  versionId: string;
  routeGeneration: number;
};

type PostMutationScope = RouteScope & {
  mutationGeneration: number;
};

type ScopedAiDialogsState = {
  scopeKey: string;
  isGeneratedOuvrageDialogOpen: boolean;
  isVersionZeroDialogOpen: boolean;
  versionZeroSummary: VersionZeroDraftSummary | null;
  highlightedItemIds: Set<string>;
};

export type EstimateEditorAiDialogsControllerInput = {
  routeVersionId: string;
  activeVersion: Pick<EstimateVersionRow, "id" | "project_id"> | null;
  items: EditorEstimateItem[];
  isMutationBlocked: boolean;
  mutationBlockedMessage: string;
  ensureMutationCanProceed?: (actionLabel: string) => Promise<boolean>;
  reportError: (message: string | null) => void;
  resolveErrorMessage: (message: string) => string;
  refreshVersionZeroSummary: (
    versionId: string
  ) => Promise<VersionZeroDraftSummary | null>;
  invalidateAfterMutation: (input: {
    versionId: string;
    source: EstimateEditorAiMutationSource;
  }) => void | Promise<void>;
  highlightDurationMs?: number;
};

export type EstimateEditorAiDialogsController = {
  state: {
    isGeneratedOuvrageDialogOpen: boolean;
    isVersionZeroDialogOpen: boolean;
    versionZeroSummary: VersionZeroDraftSummary | null;
    highlightedItemIds: Set<string>;
  };
  actions: {
    openGeneratedOuvrageDialog: () => boolean;
    closeGeneratedOuvrageDialog: (result?: {
      insertedCount?: number;
    }) => Promise<void>;
    openVersionZeroDialog: () => boolean;
    closeVersionZeroDialog: (result?: {
      materialized?: boolean;
    }) => Promise<void>;
    dismissDialogs: () => void;
    hydrateVersionZeroSummary: (
      versionId: string,
      summary: VersionZeroDraftSummary | null,
      options?: { autoOpen?: boolean }
    ) => void;
    highlightItems: (itemIds: readonly string[]) => void;
    clearHighlightedItems: () => void;
  };
  meta: {
    existingSections: ExistingSection[];
    generatedOuvrageDialogProps: GeneratedOuvrageDialogProps | null;
    versionZeroDraftDialogProps: VersionZeroDraftDialogProps | null;
    versionZeroActionLabel: string;
    isVersionZeroActionDisabled: boolean;
  };
};

const DEFAULT_HIGHLIGHT_DURATION_MS = 5_000;
const allowMutationByDefault = () => Promise.resolve(true);

function createAiDialogsScopeKey(
  routeVersionId: string,
  activeVersionId: string | null
) {
  return `${routeVersionId}\u0000${activeVersionId ?? ""}`;
}

function createEmptyAiDialogsState(scopeKey: string): ScopedAiDialogsState {
  return {
    scopeKey,
    isGeneratedOuvrageDialogOpen: false,
    isVersionZeroDialogOpen: false,
    versionZeroSummary: null,
    highlightedItemIds: new Set(),
  };
}

function buildSectionHierarchy(
  items: EditorEstimateItem[],
  versionId: string
): ExistingSection[] {
  const sections = items.filter(
    (item) =>
      item.version_id === versionId && item.item_type === "section"
  );
  const sectionById = new Map(
    sections.map((section) => [section.id, section] as const)
  );

  return sections.map((section) => {
    const pathParts: string[] = [];
    const visitedIds = new Set<string>();
    let cursor: EditorEstimateItem | undefined = section;

    while (cursor && !visitedIds.has(cursor.id)) {
      visitedIds.add(cursor.id);
      pathParts.unshift(cursor.title ?? "Section");
      cursor = cursor.parent_id
        ? sectionById.get(cursor.parent_id)
        : undefined;
    }

    return {
      id: section.id,
      path: pathParts.join(" > "),
      hierarchyLevel: Math.max(1, pathParts.length),
      parentId: section.parent_id,
      title: section.title ?? "Section",
    };
  });
}

function canAutoOpenVersionZero(summary: VersionZeroDraftSummary | null) {
  return Boolean(summary?.activeDraft || summary?.canGenerate);
}

export function useEstimateEditorAiDialogsController({
  routeVersionId,
  activeVersion,
  items,
  isMutationBlocked,
  mutationBlockedMessage,
  ensureMutationCanProceed = allowMutationByDefault,
  reportError,
  resolveErrorMessage,
  refreshVersionZeroSummary,
  invalidateAfterMutation,
  highlightDurationMs = DEFAULT_HIGHLIGHT_DURATION_MS,
}: EstimateEditorAiDialogsControllerInput): EstimateEditorAiDialogsController {
  const activeVersionId = activeVersion?.id ?? null;
  const scopeKey = createAiDialogsScopeKey(routeVersionId, activeVersionId);
  const [scopedState, setScopedState] = useState<ScopedAiDialogsState>(() =>
    createEmptyAiDialogsState(scopeKey)
  );
  const projectedState =
    scopedState.scopeKey === scopeKey
      ? scopedState
      : createEmptyAiDialogsState(scopeKey);
  const {
    isGeneratedOuvrageDialogOpen,
    isVersionZeroDialogOpen,
    versionZeroSummary,
    highlightedItemIds,
  } = projectedState;

  const activeRouteVersionIdRef = useRef(routeVersionId);
  const activeVersionIdRef = useRef(activeVersionId);
  const activeScopeKeyRef = useRef(scopeKey);
  const previousScopeKeyRef = useRef(scopeKey);
  const routeGenerationRef = useRef(0);
  const mutationGenerationRef = useRef(0);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateStateForScope = useCallback(
    (
      targetScopeKey: string,
      update: (current: ScopedAiDialogsState) => ScopedAiDialogsState
    ) => {
      setScopedState((current) =>
        update(
          current.scopeKey === targetScopeKey
            ? current
            : createEmptyAiDialogsState(targetScopeKey)
        )
      );
    },
    []
  );

  const clearHighlightTimer = useCallback(() => {
    if (highlightTimerRef.current === null) return;
    clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = null;
  }, []);

  useLayoutEffect(() => {
    if (previousScopeKeyRef.current === scopeKey) return;

    previousScopeKeyRef.current = scopeKey;
    activeRouteVersionIdRef.current = routeVersionId;
    activeVersionIdRef.current = activeVersionId;
    activeScopeKeyRef.current = scopeKey;
    routeGenerationRef.current += 1;
    mutationGenerationRef.current += 1;
    clearHighlightTimer();
  }, [activeVersionId, clearHighlightTimer, routeVersionId, scopeKey]);

  useEffect(
    () => () => {
      routeGenerationRef.current += 1;
      mutationGenerationRef.current += 1;
      clearHighlightTimer();
    },
    [clearHighlightTimer]
  );

  const isRouteScopeCurrent = useCallback((scope: RouteScope) => {
    return (
      activeScopeKeyRef.current === scope.scopeKey &&
      activeRouteVersionIdRef.current === scope.versionId &&
      activeVersionIdRef.current === scope.versionId &&
      routeGenerationRef.current === scope.routeGeneration
    );
  }, []);

  const isPostMutationScopeCurrent = useCallback(
    (scope: PostMutationScope) =>
      isRouteScopeCurrent(scope) &&
      mutationGenerationRef.current === scope.mutationGeneration,
    [isRouteScopeCurrent]
  );

  const captureRouteScope = useCallback(
    (expectedScopeKey: string, expectedVersionId: string): RouteScope | null => {
      if (
        activeScopeKeyRef.current !== expectedScopeKey ||
        activeRouteVersionIdRef.current !== expectedVersionId ||
        activeVersionIdRef.current !== expectedVersionId
      ) {
        return null;
      }
      return {
        scopeKey: expectedScopeKey,
        versionId: expectedVersionId,
        routeGeneration: routeGenerationRef.current,
      };
    },
    []
  );

  const captureCurrentRouteScope = useCallback((): RouteScope | null => {
    if (activeVersionId !== routeVersionId) {
      return null;
    }
    return captureRouteScope(scopeKey, routeVersionId);
  }, [activeVersionId, captureRouteScope, routeVersionId, scopeKey]);

  const beginPostMutation = useCallback(
    (routeScope: RouteScope): PostMutationScope | null => {
      if (!isRouteScopeCurrent(routeScope)) return null;
      mutationGenerationRef.current += 1;
      return {
        ...routeScope,
        mutationGeneration: mutationGenerationRef.current,
      };
    },
    [isRouteScopeCurrent]
  );

  const reportScopedError = useCallback(
    (scope: PostMutationScope, error: unknown, fallback: string) => {
      if (!isPostMutationScopeCurrent(scope)) return;
      reportError(
        resolveErrorMessage(
          error instanceof Error ? error.message : fallback
        )
      );
    },
    [isPostMutationScopeCurrent, reportError, resolveErrorMessage]
  );

  const guardOpen = useCallback(() => {
    if (isMutationBlocked) {
      reportError(mutationBlockedMessage);
      return null;
    }
    const scope = captureCurrentRouteScope();
    if (!scope) {
      reportError("Version introuvable.");
      return null;
    }
    reportError(null);
    return scope;
  }, [
    captureCurrentRouteScope,
    isMutationBlocked,
    mutationBlockedMessage,
    reportError,
  ]);

  const openGeneratedOuvrageDialog = useCallback(() => {
    const routeScope = guardOpen();
    if (!routeScope) return false;
    updateStateForScope(routeScope.scopeKey, (current) => ({
      ...current,
      isVersionZeroDialogOpen: false,
      isGeneratedOuvrageDialogOpen: true,
    }));
    return true;
  }, [guardOpen, updateStateForScope]);

  const openVersionZeroDialog = useCallback(() => {
    const routeScope = guardOpen();
    if (!routeScope) return false;
    updateStateForScope(routeScope.scopeKey, (current) => ({
      ...current,
      isGeneratedOuvrageDialogOpen: false,
      isVersionZeroDialogOpen: true,
    }));
    return true;
  }, [guardOpen, updateStateForScope]);

  const dismissDialogs = useCallback(() => {
    const routeScope = captureCurrentRouteScope();
    if (!routeScope) return;
    updateStateForScope(routeScope.scopeKey, (current) => ({
      ...current,
      isGeneratedOuvrageDialogOpen: false,
      isVersionZeroDialogOpen: false,
    }));
  }, [captureCurrentRouteScope, updateStateForScope]);

  const closeGeneratedForScope = useCallback(
    async (
      routeScope: RouteScope,
      result?: { insertedCount?: number }
    ) => {
      if (!isRouteScopeCurrent(routeScope)) return;
      updateStateForScope(routeScope.scopeKey, (current) => ({
        ...current,
        isGeneratedOuvrageDialogOpen: false,
      }));
      if (!result?.insertedCount || result.insertedCount <= 0) return;

      const mutationScope = beginPostMutation(routeScope);
      if (!mutationScope) return;
      try {
        await invalidateAfterMutation({
          versionId: mutationScope.versionId,
          source: "generated-ouvrage",
        });
      } catch (error) {
        reportScopedError(
          mutationScope,
          error,
          "Impossible de rafraichir le devis apres insertion."
        );
      }
    },
    [
      beginPostMutation,
      invalidateAfterMutation,
      isRouteScopeCurrent,
      reportScopedError,
      updateStateForScope,
    ]
  );

  const closeGeneratedOuvrageDialog = useCallback(
    async (result?: { insertedCount?: number }) => {
      const routeScope = captureCurrentRouteScope();
      if (!routeScope) return;
      await closeGeneratedForScope(routeScope, result);
    },
    [captureCurrentRouteScope, closeGeneratedForScope]
  );

  const closeVersionZeroForScope = useCallback(
    async (
      routeScope: RouteScope,
      result?: { materialized?: boolean }
    ) => {
      if (!isRouteScopeCurrent(routeScope)) return;
      updateStateForScope(routeScope.scopeKey, (current) => ({
        ...current,
        isVersionZeroDialogOpen: false,
      }));
      const mutationScope = beginPostMutation(routeScope);
      if (!mutationScope) return;

      const summaryPromise = Promise.resolve().then(() =>
        refreshVersionZeroSummary(mutationScope.versionId)
      );
      const invalidationPromise = result?.materialized
        ? Promise.resolve()
            .then(() =>
              invalidateAfterMutation({
                versionId: mutationScope.versionId,
                source: "version-zero",
              })
            )
            .then(
              () => ({ error: null }),
              (error: unknown) => ({ error })
            )
        : null;

      try {
        const refreshedSummary = await summaryPromise;
        if (!isPostMutationScopeCurrent(mutationScope)) return;
        if (
          refreshedSummary &&
          refreshedSummary.versionId !== mutationScope.versionId
        ) {
          reportError("Resume V0 incoherent avec la version active.");
        } else {
          updateStateForScope(mutationScope.scopeKey, (current) => ({
            ...current,
            versionZeroSummary: refreshedSummary,
          }));
        }
      } catch (error) {
        reportScopedError(
          mutationScope,
          error,
          "Impossible de rafraichir le resume V0."
        );
      }

      if (invalidationPromise) {
        const invalidationResult = await invalidationPromise;
        if (invalidationResult.error) {
          reportScopedError(
            mutationScope,
            invalidationResult.error,
            "Impossible de rafraichir le devis apres materialisation."
          );
        }
      }
    },
    [
      beginPostMutation,
      invalidateAfterMutation,
      isPostMutationScopeCurrent,
      isRouteScopeCurrent,
      refreshVersionZeroSummary,
      reportError,
      reportScopedError,
      updateStateForScope,
    ]
  );

  const closeVersionZeroDialog = useCallback(
    async (result?: { materialized?: boolean }) => {
      const routeScope = captureCurrentRouteScope();
      if (!routeScope) return;
      await closeVersionZeroForScope(routeScope, result);
    },
    [captureCurrentRouteScope, closeVersionZeroForScope]
  );

  const hydrateVersionZeroSummary = useCallback(
    (
      versionId: string,
      summary: VersionZeroDraftSummary | null,
      options?: { autoOpen?: boolean }
    ) => {
      if (activeRouteVersionIdRef.current !== versionId) return;
      if (summary && summary.versionId !== versionId) return;

      const targetScopeKey = createAiDialogsScopeKey(versionId, versionId);
      const shouldAutoOpen =
        options?.autoOpen === true && canAutoOpenVersionZero(summary);
      updateStateForScope(targetScopeKey, (current) => ({
        ...current,
        versionZeroSummary: summary,
        ...(shouldAutoOpen
          ? {
              isGeneratedOuvrageDialogOpen: false,
              isVersionZeroDialogOpen: true,
            }
          : {}),
      }));
    },
    [updateStateForScope]
  );

  const clearHighlightedItems = useCallback(() => {
    const routeScope = captureCurrentRouteScope();
    if (!routeScope) return;
    clearHighlightTimer();
    updateStateForScope(routeScope.scopeKey, (current) => ({
      ...current,
      highlightedItemIds: new Set(),
    }));
  }, [captureCurrentRouteScope, clearHighlightTimer, updateStateForScope]);

  const highlightItems = useCallback(
    (itemIds: readonly string[]) => {
      const routeScope = captureCurrentRouteScope();
      if (!routeScope) return;
      const nextIds = new Set(itemIds.filter((itemId) => itemId.length > 0));
      clearHighlightTimer();
      updateStateForScope(routeScope.scopeKey, (current) => ({
        ...current,
        highlightedItemIds: nextIds,
      }));
      if (nextIds.size === 0 || highlightDurationMs <= 0) return;

      highlightTimerRef.current = setTimeout(() => {
        highlightTimerRef.current = null;
        if (isRouteScopeCurrent(routeScope)) {
          updateStateForScope(routeScope.scopeKey, (current) => ({
            ...current,
            highlightedItemIds: new Set(),
          }));
        }
      }, highlightDurationMs);
    },
    [
      captureCurrentRouteScope,
      clearHighlightTimer,
      highlightDurationMs,
      isRouteScopeCurrent,
      updateStateForScope,
    ]
  );

  const existingSections = useMemo(
    () =>
      activeVersionId === routeVersionId
        ? buildSectionHierarchy(items, routeVersionId)
        : [],
    [activeVersionId, items, routeVersionId]
  );

  const generatedOuvrageDialogProps =
    useMemo<GeneratedOuvrageDialogProps | null>(() => {
      if (
        activeVersionId !== routeVersionId ||
        !isGeneratedOuvrageDialogOpen ||
        !activeVersion
      ) {
        return null;
      }
      return {
        isOpen: true,
        targetVersionId: routeVersionId,
        projectId: activeVersion.project_id ?? "",
        existingSections,
        isMutationBlocked,
        mutationBlockedMessage,
        ensureMutationCanProceed,
        onClose: (result) => {
          const routeScope = captureRouteScope(scopeKey, routeVersionId);
          if (routeScope) {
            void closeGeneratedForScope(routeScope, result);
          }
        },
      };
    }, [
      activeVersion,
      activeVersionId,
      captureRouteScope,
      closeGeneratedForScope,
      ensureMutationCanProceed,
      existingSections,
      isGeneratedOuvrageDialogOpen,
      isMutationBlocked,
      mutationBlockedMessage,
      routeVersionId,
      scopeKey,
    ]);

  const versionZeroDraftDialogProps =
    useMemo<VersionZeroDraftDialogProps | null>(() => {
      if (
        activeVersionId !== routeVersionId ||
        !isVersionZeroDialogOpen
      ) {
        return null;
      }
      return {
        isOpen: true,
        versionId: routeVersionId,
        summary: versionZeroSummary,
        isMutationBlocked,
        mutationBlockedMessage,
        ensureMutationCanProceed,
        onClose: (result) => {
          const routeScope = captureRouteScope(scopeKey, routeVersionId);
          if (routeScope) {
            void closeVersionZeroForScope(routeScope, result);
          }
        },
      };
    }, [
      activeVersionId,
      captureRouteScope,
      closeVersionZeroForScope,
      ensureMutationCanProceed,
      isVersionZeroDialogOpen,
      isMutationBlocked,
      mutationBlockedMessage,
      routeVersionId,
      scopeKey,
      versionZeroSummary,
    ]);

  const state = useMemo(
    () => ({
      isGeneratedOuvrageDialogOpen,
      isVersionZeroDialogOpen,
      versionZeroSummary,
      highlightedItemIds,
    }),
    [
      highlightedItemIds,
      isGeneratedOuvrageDialogOpen,
      isVersionZeroDialogOpen,
      versionZeroSummary,
    ]
  );

  const actions = useMemo(
    () => ({
      openGeneratedOuvrageDialog,
      closeGeneratedOuvrageDialog,
      openVersionZeroDialog,
      closeVersionZeroDialog,
      dismissDialogs,
      hydrateVersionZeroSummary,
      highlightItems,
      clearHighlightedItems,
    }),
    [
      clearHighlightedItems,
      closeGeneratedOuvrageDialog,
      closeVersionZeroDialog,
      dismissDialogs,
      highlightItems,
      hydrateVersionZeroSummary,
      openGeneratedOuvrageDialog,
      openVersionZeroDialog,
    ]
  );

  const meta = useMemo(
    () => ({
      existingSections,
      generatedOuvrageDialogProps,
      versionZeroDraftDialogProps,
      versionZeroActionLabel: versionZeroSummary?.activeDraft
        ? "Revoir le brouillon IA"
        : "Préparer un brouillon IA",
      isVersionZeroActionDisabled:
        !versionZeroSummary?.activeDraft && !versionZeroSummary?.canGenerate,
    }),
    [
      existingSections,
      generatedOuvrageDialogProps,
      versionZeroDraftDialogProps,
      versionZeroSummary,
    ]
  );

  return { state, actions, meta };
}
