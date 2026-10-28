"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MutableRefObject,
} from "react";

import {
  applyEstimateStructureDraft,
  fetchEstimateEditorData,
  fetchAffaireLinkedDpgfSource,
  importEstimateSections,
  importLinkedDpgfSource as importLinkedDpgfSourceClient,
  type AffaireLinkedDpgfSource,
  type ApplyEstimateStructureDraftPayload,
  type ApplyEstimateStructureDraftResult,
  type EstimateVersionToken,
  type ImportEstimateSectionsPayload,
  type ImportEstimateSectionsResult,
  type ImportLinkedDpgfSourceResult,
} from "@/lib/estimates/client";
import type { EstimateEditorDocument } from "@/lib/estimates/editor-document-state";
import type { EstimateVersionRow } from "@/lib/estimates/editor-items";
import { describeV3ConvertedLines } from "@/lib/estimates/v3-converted-lines";

const LINKED_DPGF_LOAD_ERROR =
  "Impossible de charger la source DPGF de l'affaire.";
const STALE_OPERATION_MESSAGE =
  "La version active a changé pendant l'opération.";
const BARRIER_BLOCKED_MESSAGE =
  "Les modifications locales doivent être synchronisées avant cette opération.";

export type EstimateEditorImportMutation =
  | "estimate-sections"
  | "structure-draft"
  | "linked-dpgf";

type LinkedDpgfSourceLoader = (
  projectId: string,
  signal: AbortSignal
) => Promise<AffaireLinkedDpgfSource>;

export type EstimateEditorImportControllerInput = {
  document?: EstimateEditorDocument;
  routeVersionId: string;
  activeVersion: Pick<
    EstimateVersionRow,
    "id" | "project_id" | "status"
  > | null;
  autoOpenStructureDraft?: boolean;
  isMutationBlocked: boolean;
  mutationBlockedMessage: string;
  getVersionSnapshot: () => EstimateVersionRow | null;
  ensureGroupedActionCanProceed: (actionLabel: string) => Promise<boolean>;
  applyVersionToken: (updatedAt: string) => void;
  handleVersionConflict: (
    error: unknown,
    options?: { persistDraft?: boolean }
  ) => boolean;
  reloadItems: () => Promise<void>;
  setTotalsOutOfSync: (value: boolean) => void;
  reportError: (message: string | null) => void;
  resolveErrorMessage: (message: string) => string;
  loadLinkedDpgfSource?: LinkedDpgfSourceLoader;
};

export type EstimateEditorImportController = {
  state: {
    linkedDpgfSource: AffaireLinkedDpgfSource;
    linkedDpgfSourceError: string | null;
    isLoadingLinkedDpgfSource: boolean;
    isImportingDpgfSource: boolean;
    isImportFromEstimateDialogOpen: boolean;
    isEstimateStructureDraftDialogOpen: boolean;
    importSummaryMessage: string | null;
    activeMutation: EstimateEditorImportMutation | null;
  };
  actions: {
    refreshLinkedDpgfSource: () => Promise<void>;
    importLinkedDpgfSource: () => Promise<void>;
    openImportFromEstimateDialog: () => boolean;
    closeImportFromEstimateDialog: () => void;
    confirmImportFromEstimate: (
      input: ImportEstimateSectionsPayload
    ) => Promise<void>;
    openEstimateStructureDraftDialog: () => boolean;
    closeEstimateStructureDraftDialog: () => void;
    applyEstimateStructureDraft: (
      draftId: string,
      input: ApplyEstimateStructureDraftPayload
    ) => Promise<ApplyEstimateStructureDraftResult>;
    clearImportSummary: () => void;
  };
  meta: {
    hasLinkedDpgfSource: boolean;
    isImportDpgfSourceDisabled: boolean;
    isMutationInProgress: boolean;
  };
};

type SourceRequestSlot = {
  controller: AbortController | null;
  generation: number;
};

type LinkedDpgfSourceState = {
  scopeKey: string;
  source: AffaireLinkedDpgfSource;
  error: string | null;
  isLoading: boolean;
};

type ScopedImportUiState = {
  scopeKey: string;
  isImportFromEstimateDialogOpen: boolean;
  isEstimateStructureDraftDialogOpen: boolean;
  isStructureDraftAutoOpenConsumed: boolean;
  importSummaryMessage: string | null;
  activeMutation: EstimateEditorImportMutation | null;
};

type MutationScope = {
  scopeKey: string;
  kind: EstimateEditorImportMutation;
  versionId: string;
  routeGeneration: number;
  operationGeneration: number;
};

type StructuralMutationOptions<T> = {
  kind: EstimateEditorImportMutation;
  actionLabel: string;
  failureMessage: string;
  tokenRefreshFailureMessage: string;
  execute: (versionId: string) => Promise<T>;
  getResultVersionId: (result: T) => string;
  getVersionToken: (result: T) => EstimateVersionToken | null;
  buildSummary: (result: T) => string;
};

class ExpectedImportOperationError extends Error {}

function defaultLoadLinkedDpgfSource(projectId: string, signal: AbortSignal) {
  return fetchAffaireLinkedDpgfSource(projectId, { signal });
}

function cancelSourceRequest(slot: MutableRefObject<SourceRequestSlot>) {
  slot.current.controller?.abort();
  slot.current = {
    controller: null,
    generation: slot.current.generation + 1,
  };
}

function isImportableLinkedDpgfSource(
  source: AffaireLinkedDpgfSource
): source is NonNullable<AffaireLinkedDpgfSource> {
  return Boolean(
    source && source.importStatus === "completed" && source.mappedRowCount > 0
  );
}

function createEmptyImportUiState(scopeKey: string): ScopedImportUiState {
  return {
    scopeKey,
    isImportFromEstimateDialogOpen: false,
    isEstimateStructureDraftDialogOpen: false,
    isStructureDraftAutoOpenConsumed: false,
    importSummaryMessage: null,
    activeMutation: null,
  };
}

export function useEstimateEditorImportController({
  document,
  routeVersionId,
  activeVersion,
  autoOpenStructureDraft = false,
  isMutationBlocked,
  mutationBlockedMessage,
  getVersionSnapshot,
  ensureGroupedActionCanProceed,
  applyVersionToken,
  handleVersionConflict,
  reloadItems,
  setTotalsOutOfSync,
  reportError,
  resolveErrorMessage,
  loadLinkedDpgfSource = defaultLoadLinkedDpgfSource,
}: EstimateEditorImportControllerInput): EstimateEditorImportController {
  const subscribeDocument = useCallback((notify: () => void) => document?.subscribe(notify) ?? (() => undefined), [document]);
  const getDocumentGeneration = useCallback(() => document?.getSnapshot().generation ?? 0, [document]);
  const documentGeneration = useSyncExternalStore(subscribeDocument, getDocumentGeneration, getDocumentGeneration);
  const documentScope = useMemo(() => document
    ? { ...document.captureScope(), generation: documentGeneration } : null, [document, documentGeneration]);
  const scopeKey = JSON.stringify([documentScope?.actorId ?? null, documentScope?.tenantId ?? null,
    routeVersionId, documentGeneration]);
  // A token object, not the repeated string A, distinguishes visits A → B → A.
  const controllerScope = useMemo(() => ({ scopeKey }), [scopeKey]);
  const controllerScopeRef = useRef(controllerScope);
  const isControllerScopeCurrent = useCallback(() => controllerScopeRef.current === controllerScope &&
    (!document || Boolean(documentScope && document.isCurrent(documentScope))), [controllerScope, document, documentScope]);
  const activeVersionId = activeVersion?.id ?? null;
  const activeProjectId =
    activeVersionId === routeVersionId
      ? (activeVersion?.project_id ?? null)
      : null;
  const linkedSourceScopeKey = activeProjectId
    ? `${scopeKey}:${activeVersionId}:${activeProjectId}`
    : null;
  const [linkedSourceState, setLinkedSourceState] =
    useState<LinkedDpgfSourceState | null>(null);
  const [scopedImportUiState, setScopedImportUiState] =
    useState<ScopedImportUiState>(() =>
      createEmptyImportUiState(scopeKey)
    );
  if (scopedImportUiState.scopeKey !== scopeKey) {
    setScopedImportUiState(createEmptyImportUiState(scopeKey));
  }

  const isLinkedSourceStateCurrent = Boolean(
    linkedSourceScopeKey && linkedSourceState?.scopeKey === linkedSourceScopeKey
  );
  const linkedDpgfSource = isLinkedSourceStateCurrent
    ? (linkedSourceState?.source ?? null)
    : null;
  const linkedDpgfSourceError = isLinkedSourceStateCurrent
    ? (linkedSourceState?.error ?? null)
    : null;
  const isLoadingLinkedDpgfSource = linkedSourceScopeKey
    ? isLinkedSourceStateCurrent
      ? (linkedSourceState?.isLoading ?? true)
      : true
    : false;

  const isImportUiStateCurrent =
    scopedImportUiState.scopeKey === scopeKey;
  const shouldAutoOpenStructureDraft = Boolean(
    autoOpenStructureDraft &&
      activeVersionId === routeVersionId &&
      activeVersion?.status === "draft" &&
      (!isImportUiStateCurrent ||
        !scopedImportUiState.isStructureDraftAutoOpenConsumed)
  );
  const isImportFromEstimateDialogOpen = isImportUiStateCurrent
    ? scopedImportUiState.isImportFromEstimateDialogOpen
    : false;
  const isEstimateStructureDraftDialogOpen = isImportUiStateCurrent
    ? scopedImportUiState.isEstimateStructureDraftDialogOpen ||
      shouldAutoOpenStructureDraft
    : shouldAutoOpenStructureDraft;
  const importSummaryMessage = isImportUiStateCurrent
    ? scopedImportUiState.importSummaryMessage
    : null;
  const activeMutation = isImportUiStateCurrent
    ? scopedImportUiState.activeMutation
    : null;

  const routeVersionIdRef = useRef(routeVersionId);
  const activeVersionIdRef = useRef(activeVersionId);
  const activeProjectIdRef = useRef(activeProjectId);
  const routeGenerationRef = useRef(0);
  const operationGenerationRef = useRef(0);
  const activeMutationRef = useRef<MutationScope | null>(null);
  const sourceRequestRef = useRef<SourceRequestSlot>({
    controller: null,
    generation: 0,
  });

  const cancelLinkedSourceRequest = useCallback(() => {
    cancelSourceRequest(sourceRequestRef);
  }, []);

  useLayoutEffect(() => {
    activeVersionIdRef.current = activeVersionId;
    activeProjectIdRef.current = activeProjectId;
  }, [activeProjectId, activeVersionId]);

  useLayoutEffect(() => {
    controllerScopeRef.current = controllerScope;
    routeVersionIdRef.current = routeVersionId;
    routeGenerationRef.current += 1;
    operationGenerationRef.current += 1;
    activeMutationRef.current = null;
    cancelLinkedSourceRequest();
  }, [cancelLinkedSourceRequest, controllerScope, routeVersionId]);

  const isSameMutationScope = useCallback((scope: MutationScope) => {
    const active = activeMutationRef.current;
    return Boolean(
      active &&
        active.scopeKey === scope.scopeKey &&
        active.versionId === scope.versionId &&
        active.routeGeneration === scope.routeGeneration &&
        active.operationGeneration === scope.operationGeneration
    );
  }, []);

  const isMutationScopeActive = useCallback(
    (scope: MutationScope) =>
      isControllerScopeCurrent() && isSameMutationScope(scope) &&
      scope.scopeKey === scopeKey &&
      routeVersionIdRef.current === scope.versionId &&
      routeGenerationRef.current === scope.routeGeneration &&
      getVersionSnapshot()?.id === scope.versionId,
    [getVersionSnapshot, isControllerScopeCurrent, isSameMutationScope, scopeKey]
  );

  const finishMutation = useCallback(
    (scope: MutationScope) => {
      if (!isControllerScopeCurrent() || !isSameMutationScope(scope)) return;
      activeMutationRef.current = null;
      setScopedImportUiState((previous) =>
        previous.scopeKey === scope.scopeKey &&
        previous.activeMutation === scope.kind
          ? { ...previous, activeMutation: null }
          : previous
      );
    },
    [isControllerScopeCurrent, isSameMutationScope]
  );

  const refreshLinkedDpgfSource = useCallback(async () => {
    if (
      !isControllerScopeCurrent() ||
      !activeProjectId ||
      !linkedSourceScopeKey ||
      activeVersionId !== routeVersionId ||
      routeVersionIdRef.current !== routeVersionId
    ) {
      return;
    }

    sourceRequestRef.current.controller?.abort();
    const controller = new AbortController();
    const requestGeneration = sourceRequestRef.current.generation + 1;
    const routeGeneration = routeGenerationRef.current;
    sourceRequestRef.current = {
      controller,
      generation: requestGeneration,
    };

    const isCurrentRequest = () =>
      isControllerScopeCurrent() && !controller.signal.aborted &&
      routeVersionIdRef.current === routeVersionId &&
      routeGenerationRef.current === routeGeneration &&
      activeVersionIdRef.current === routeVersionId &&
      activeProjectIdRef.current === activeProjectId &&
      sourceRequestRef.current.controller === controller &&
      sourceRequestRef.current.generation === requestGeneration;

    setLinkedSourceState({
      scopeKey: linkedSourceScopeKey,
      source: linkedDpgfSource,
      error: null,
      isLoading: true,
    });

    try {
      const source = await loadLinkedDpgfSource(
        activeProjectId,
        controller.signal
      );
      if (!isCurrentRequest()) return;
      setLinkedSourceState({
        scopeKey: linkedSourceScopeKey,
        source,
        error: null,
        isLoading: false,
      });
    } catch (error) {
      if (!isCurrentRequest()) return;
      setLinkedSourceState({
        scopeKey: linkedSourceScopeKey,
        source: null,
        error:
          error instanceof Error ? error.message : LINKED_DPGF_LOAD_ERROR,
        isLoading: false,
      });
    } finally {
      if (!isCurrentRequest()) return;
      sourceRequestRef.current = {
        controller: null,
        generation: requestGeneration,
      };
    }
  }, [
    activeProjectId,
    activeVersionId,
    linkedDpgfSource,
    linkedSourceScopeKey,
    loadLinkedDpgfSource,
    isControllerScopeCurrent,
    routeVersionId,
  ]);

  useEffect(() => {
    if (
      !isControllerScopeCurrent() ||
      !activeProjectId ||
      !linkedSourceScopeKey ||
      activeVersionId !== routeVersionId
    ) {
      return cancelLinkedSourceRequest;
    }
    const targetProjectId = activeProjectId;
    const targetScopeKey = linkedSourceScopeKey;

    sourceRequestRef.current.controller?.abort();
    const controller = new AbortController();
    const requestGeneration = sourceRequestRef.current.generation + 1;
    const routeGeneration = routeGenerationRef.current;
    sourceRequestRef.current = {
      controller,
      generation: requestGeneration,
    };

    const isCurrentRequest = () =>
      isControllerScopeCurrent() && !controller.signal.aborted &&
      routeVersionIdRef.current === routeVersionId &&
      routeGenerationRef.current === routeGeneration &&
      activeVersionIdRef.current === routeVersionId &&
      activeProjectIdRef.current === targetProjectId &&
      sourceRequestRef.current.controller === controller &&
      sourceRequestRef.current.generation === requestGeneration;

    async function loadSource() {
      try {
        const source = await loadLinkedDpgfSource(
          targetProjectId,
          controller.signal
        );
        if (!isCurrentRequest()) return;
        setLinkedSourceState({
          scopeKey: targetScopeKey,
          source,
          error: null,
          isLoading: false,
        });
      } catch (error) {
        if (!isCurrentRequest()) return;
        setLinkedSourceState({
          scopeKey: targetScopeKey,
          source: null,
          error:
            error instanceof Error ? error.message : LINKED_DPGF_LOAD_ERROR,
          isLoading: false,
        });
      } finally {
        if (!isCurrentRequest()) return;
        sourceRequestRef.current = {
          controller: null,
          generation: requestGeneration,
        };
      }
    }

    void loadSource();

    return () => {
      controller.abort();
      if (sourceRequestRef.current.controller === controller) {
        sourceRequestRef.current = {
          controller: null,
          generation: requestGeneration + 1,
        };
      }
    };
  }, [
    activeProjectId,
    activeVersionId,
    cancelLinkedSourceRequest,
    linkedSourceScopeKey,
    loadLinkedDpgfSource,
    isControllerScopeCurrent,
    routeVersionId,
  ]);

  const reconcileVersionToken = useCallback(
    async (
      scope: MutationScope,
      versionToken: EstimateVersionToken | null,
      failureMessage: string
    ) => {
      if (!isMutationScopeActive(scope)) return;
      if (versionToken?.id === scope.versionId) {
        applyVersionToken(versionToken.updated_at);
        return;
      }

      try {
        const refreshed = await fetchEstimateEditorData(scope.versionId);
        if (
          !isMutationScopeActive(scope) ||
          refreshed.version.id !== scope.versionId
        ) {
          return;
        }
        applyVersionToken(refreshed.version.updated_at);
      } catch (error) {
        if (isMutationScopeActive(scope)) {
          console.error(failureMessage, error);
        }
      }
    },
    [applyVersionToken, isMutationScopeActive]
  );

  const runStructuralMutation = useCallback(
    async <T,>(options: StructuralMutationOptions<T>): Promise<T> => {
      if (!isControllerScopeCurrent() || routeVersionIdRef.current !== routeVersionId) {
        throw new ExpectedImportOperationError(STALE_OPERATION_MESSAGE);
      }
      if (isMutationBlocked) {
        reportError(mutationBlockedMessage);
        throw new Error(mutationBlockedMessage);
      }

      const versionSnapshot = getVersionSnapshot();
      if (!versionSnapshot || versionSnapshot.id !== routeVersionId) {
        const message = "Version introuvable.";
        reportError(message);
        throw new Error(message);
      }
      if (activeMutationRef.current) {
        const message = "Une opération structurelle est déjà en cours.";
        reportError(message);
        throw new Error(message);
      }

      const scope: MutationScope = {
        scopeKey,
        kind: options.kind,
        versionId: versionSnapshot.id,
        routeGeneration: routeGenerationRef.current,
        operationGeneration: operationGenerationRef.current + 1,
      };
      operationGenerationRef.current = scope.operationGeneration;
      activeMutationRef.current = scope;
      setScopedImportUiState((previous) => ({
        ...(previous.scopeKey === scope.scopeKey
          ? previous
          : createEmptyImportUiState(scope.scopeKey)),
        activeMutation: scope.kind,
        importSummaryMessage: null,
      }));
      reportError(null);

      try {
        const canProceed = await ensureGroupedActionCanProceed(
          options.actionLabel
        );
        if (!isMutationScopeActive(scope)) {
          throw new ExpectedImportOperationError(STALE_OPERATION_MESSAGE);
        }
        if (!canProceed) {
          throw new ExpectedImportOperationError(BARRIER_BLOCKED_MESSAGE);
        }

        const result = await options.execute(scope.versionId);
        if (
          !isMutationScopeActive(scope) ||
          options.getResultVersionId(result) !== scope.versionId
        ) {
          throw new ExpectedImportOperationError(STALE_OPERATION_MESSAGE);
        }

        await reloadItems();
        if (!isMutationScopeActive(scope)) {
          throw new ExpectedImportOperationError(STALE_OPERATION_MESSAGE);
        }

        setTotalsOutOfSync(false);
        setScopedImportUiState((previous) =>
          previous.scopeKey === scope.scopeKey
            ? {
                ...previous,
                importSummaryMessage: options.buildSummary(result),
              }
            : previous
        );
        await reconcileVersionToken(
          scope,
          options.getVersionToken(result),
          options.tokenRefreshFailureMessage
        );
        return result;
      } catch (error) {
        if (error instanceof ExpectedImportOperationError) {
          throw error;
        }
        if (!isMutationScopeActive(scope)) {
          throw new ExpectedImportOperationError(STALE_OPERATION_MESSAGE);
        }
        if (!handleVersionConflict(error, { persistDraft: true })) {
          reportError(
            resolveErrorMessage(
              error instanceof Error ? error.message : options.failureMessage
            )
          );
        }
        throw error;
      } finally {
        finishMutation(scope);
      }
    },
    [
      ensureGroupedActionCanProceed,
      finishMutation,
      getVersionSnapshot,
      handleVersionConflict,
      isMutationBlocked,
      isMutationScopeActive,
      isControllerScopeCurrent,
      scopeKey,
      mutationBlockedMessage,
      reconcileVersionToken,
      reloadItems,
      reportError,
      resolveErrorMessage,
      routeVersionId,
      setTotalsOutOfSync,
    ]
  );

  const canOpenDialog = useCallback(() => {
    if (!isControllerScopeCurrent() || routeVersionIdRef.current !== routeVersionId) return false;
    if (isMutationBlocked) {
      reportError(mutationBlockedMessage);
      return false;
    }
    if (activeMutationRef.current) {
      reportError("Une opération structurelle est déjà en cours.");
      return false;
    }
    if (getVersionSnapshot()?.id !== routeVersionId) {
      reportError("Version introuvable.");
      return false;
    }
    reportError(null);
    return true;
  }, [
    getVersionSnapshot,
    isMutationBlocked,
    mutationBlockedMessage,
    reportError,
    isControllerScopeCurrent,
    routeVersionId,
  ]);

  const openImportFromEstimateDialog = useCallback(() => {
    if (!canOpenDialog()) return false;
    setScopedImportUiState({
      ...createEmptyImportUiState(scopeKey),
      isImportFromEstimateDialogOpen: true,
      isStructureDraftAutoOpenConsumed: true,
    });
    return true;
  }, [canOpenDialog, scopeKey]);

  const closeImportFromEstimateDialog = useCallback(() => {
    if (!isControllerScopeCurrent() || routeVersionIdRef.current !== routeVersionId) return;
    setScopedImportUiState((previous) =>
      previous.scopeKey === scopeKey
        ? { ...previous, isImportFromEstimateDialogOpen: false }
        : previous
    );
  }, [isControllerScopeCurrent, routeVersionId, scopeKey]);

  const confirmImportFromEstimate = useCallback(
    async (input: ImportEstimateSectionsPayload) => {
      await runStructuralMutation<ImportEstimateSectionsResult>({
        kind: "estimate-sections",
        actionLabel: "importer les sections du devis",
        failureMessage: "Impossible d'importer les sections.",
        tokenRefreshFailureMessage:
          "Impossible de rafraichir le jeton de version après import de sections.",
        execute: (versionId) => importEstimateSections(versionId, input),
        getResultVersionId: (result) => result.targetVersionId,
        getVersionToken: (result) => result.versionToken,
        buildSummary: (result) => {
          // Sous-lot 2.8b (A7, P-12) : sections v1/v2 entrées dans une v3, lignes dont les heures changent.
          const converted = describeV3ConvertedLines(result.convertedLines);
          return `${result.importedSectionsCount} section(s) et ${result.importedLinesCount} ligne(s) importées.` +
            (converted ? ` ${converted}` : "");
        },
      });
    },
    [runStructuralMutation]
  );

  const openEstimateStructureDraftDialog = useCallback(() => {
    if (!canOpenDialog()) return false;
    setScopedImportUiState({
      ...createEmptyImportUiState(scopeKey),
      isEstimateStructureDraftDialogOpen: true,
    });
    return true;
  }, [canOpenDialog, scopeKey]);

  const closeEstimateStructureDraftDialog = useCallback(() => {
    if (!isControllerScopeCurrent() || routeVersionIdRef.current !== routeVersionId) return;
    setScopedImportUiState((previous) => ({
      ...(previous.scopeKey === scopeKey
        ? previous
        : createEmptyImportUiState(scopeKey)),
      isEstimateStructureDraftDialogOpen: false,
      isStructureDraftAutoOpenConsumed: true,
    }));
  }, [isControllerScopeCurrent, routeVersionId, scopeKey]);

  const applyStructureDraft = useCallback(
    async (draftId: string, input: ApplyEstimateStructureDraftPayload) =>
      runStructuralMutation<ApplyEstimateStructureDraftResult>({
        kind: "structure-draft",
        actionLabel: "appliquer le brouillon de structure",
        failureMessage: "Impossible d'appliquer la preview de structure.",
        tokenRefreshFailureMessage:
          "Impossible de rafraichir le jeton de version après application de structure IA.",
        execute: (versionId) =>
          applyEstimateStructureDraft(versionId, draftId, input),
        getResultVersionId: (result) => result.versionId,
        getVersionToken: (result) => result.versionToken,
        buildSummary: (result) =>
          `${result.createdCount} section(s) créée(s), ${result.mergedCount} fusion(s), ${result.skippedCount} ignoree(s).`,
      }),
    [runStructuralMutation]
  );

  const hasLinkedDpgfSource =
    isImportableLinkedDpgfSource(linkedDpgfSource);

  const importLinkedDpgfSource = useCallback(async () => {
    if (!isControllerScopeCurrent()) return;
    if (!hasLinkedDpgfSource) {
      reportError("Aucune source DPGF importable n'est liée à cette affaire.");
      return;
    }

    try {
      await runStructuralMutation<ImportLinkedDpgfSourceResult>({
        kind: "linked-dpgf",
        actionLabel: "importer la source DPGF liée",
        failureMessage: "Impossible d'importer le DPGF source lié.",
        tokenRefreshFailureMessage:
          "Impossible de rafraichir le jeton de version après import du DPGF source.",
        execute: (versionId) => importLinkedDpgfSourceClient(versionId),
        getResultVersionId: (result) => result.targetVersionId,
        getVersionToken: (result) => result.versionToken,
        buildSummary: (result) => {
          const suffix = result.importedLinesCount > 1 ? "s" : "";
          return `${result.importedLinesCount} ligne${suffix} importée${suffix} depuis le DPGF source.`;
        },
      });
    } catch {
      // The shared mutation runner already handled user-visible errors.
    }
  }, [hasLinkedDpgfSource, isControllerScopeCurrent, reportError, runStructuralMutation]);

  const clearImportSummary = useCallback(() => {
    if (!isControllerScopeCurrent() || routeVersionIdRef.current !== routeVersionId) return;
    setScopedImportUiState((previous) =>
      previous.scopeKey === scopeKey
        ? { ...previous, importSummaryMessage: null }
        : previous
    );
  }, [isControllerScopeCurrent, routeVersionId, scopeKey]);

  const isMutationInProgress = activeMutation !== null;
  const isImportingDpgfSource = activeMutation === "linked-dpgf";

  const state = useMemo(
    () => ({
      linkedDpgfSource,
      linkedDpgfSourceError,
      isLoadingLinkedDpgfSource,
      isImportingDpgfSource,
      isImportFromEstimateDialogOpen,
      isEstimateStructureDraftDialogOpen,
      importSummaryMessage,
      activeMutation,
    }),
    [
      activeMutation,
      importSummaryMessage,
      isEstimateStructureDraftDialogOpen,
      isImportFromEstimateDialogOpen,
      isImportingDpgfSource,
      isLoadingLinkedDpgfSource,
      linkedDpgfSource,
      linkedDpgfSourceError,
    ]
  );

  const actions = useMemo(
    () => ({
      refreshLinkedDpgfSource,
      importLinkedDpgfSource,
      openImportFromEstimateDialog,
      closeImportFromEstimateDialog,
      confirmImportFromEstimate,
      openEstimateStructureDraftDialog,
      closeEstimateStructureDraftDialog,
      applyEstimateStructureDraft: applyStructureDraft,
      clearImportSummary,
    }),
    [
      applyStructureDraft,
      clearImportSummary,
      closeEstimateStructureDraftDialog,
      closeImportFromEstimateDialog,
      confirmImportFromEstimate,
      importLinkedDpgfSource,
      openEstimateStructureDraftDialog,
      openImportFromEstimateDialog,
      refreshLinkedDpgfSource,
    ]
  );

  const meta = useMemo(
    () => ({
      hasLinkedDpgfSource,
      isImportDpgfSourceDisabled:
        !hasLinkedDpgfSource ||
        isLoadingLinkedDpgfSource ||
        isMutationInProgress ||
        isMutationBlocked,
      isMutationInProgress,
    }),
    [
      hasLinkedDpgfSource,
      isLoadingLinkedDpgfSource,
      isMutationBlocked,
      isMutationInProgress,
    ]
  );

  return { state, actions, meta };
}
