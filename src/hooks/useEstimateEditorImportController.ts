"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

import {
  applyEstimateStructureDraft,
  fetchEstimateEditorData,
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
import type { EstimateVersionRow } from "@/lib/estimates/editor-items";

const LINKED_DPGF_LOAD_ERROR =
  "Impossible de charger la source DPGF de l'affaire.";
const STALE_OPERATION_MESSAGE =
  "La version active a change pendant l'operation.";
const BARRIER_BLOCKED_MESSAGE =
  "Les modifications locales doivent etre synchronisees avant cette operation.";

export type EstimateEditorImportMutation =
  | "estimate-sections"
  | "structure-draft"
  | "linked-dpgf";

type LinkedDpgfSourceLoader = (
  projectId: string,
  signal: AbortSignal
) => Promise<AffaireLinkedDpgfSource>;

export type EstimateEditorImportControllerInput = {
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
  versionId: string;
  isImportFromEstimateDialogOpen: boolean;
  isEstimateStructureDraftDialogOpen: boolean;
  isStructureDraftAutoOpenConsumed: boolean;
  importSummaryMessage: string | null;
  activeMutation: EstimateEditorImportMutation | null;
};

type MutationScope = {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNonEmptyString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toFiniteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function unwrapData(payload: unknown) {
  return isRecord(payload) && "data" in payload ? payload.data : payload;
}

function resolveResponseError(payload: unknown, fallback: string) {
  if (!isRecord(payload)) return fallback;
  const nestedError = isRecord(payload.error) ? payload.error : null;
  return (
    toNonEmptyString(payload.error) ??
    toNonEmptyString(nestedError?.message) ??
    toNonEmptyString(payload.message) ??
    fallback
  );
}

function parseLinkedDpgfSource(payload: unknown): AffaireLinkedDpgfSource {
  const root = unwrapData(payload);
  if (root === null || !isRecord(root)) return null;

  const importId =
    toNonEmptyString(root.importId) ?? toNonEmptyString(root.import_id);
  const filename = toNonEmptyString(root.filename);
  const sourceFormat =
    toNonEmptyString(root.sourceFormat) ??
    toNonEmptyString(root.source_format);
  const importStatus =
    toNonEmptyString(root.importStatus) ??
    toNonEmptyString(root.import_status);
  const importedAt =
    toNonEmptyString(root.importedAt) ?? toNonEmptyString(root.imported_at);
  const parseMode =
    toNonEmptyString(root.parseMode) ?? toNonEmptyString(root.parse_mode);
  const rowCount =
    toFiniteNumber(root.rowCount) ?? toFiniteNumber(root.row_count);
  const mappedRowCount =
    toFiniteNumber(root.mappedRowCount) ??
    toFiniteNumber(root.mapped_row_count);

  if (
    !importId ||
    !filename ||
    !sourceFormat ||
    !importStatus ||
    !importedAt ||
    !parseMode ||
    rowCount === null ||
    mappedRowCount === null
  ) {
    return null;
  }

  return {
    importId,
    filename,
    sourceFormat,
    importStatus,
    mappingStatus:
      toNonEmptyString(root.mappingStatus) ??
      toNonEmptyString(root.mapping_status) ??
      null,
    importedAt,
    mappingUpdatedAt:
      toNonEmptyString(root.mappingUpdatedAt) ??
      toNonEmptyString(root.mapping_updated_at) ??
      null,
    parseMode,
    rowCount: Math.max(0, Math.trunc(rowCount)),
    mappedRowCount: Math.max(0, Math.trunc(mappedRowCount)),
  };
}

async function defaultLoadLinkedDpgfSource(
  projectId: string,
  signal: AbortSignal
) {
  const response = await fetch(
    `/api/affaires/${encodeURIComponent(projectId)}/dpgf-source`,
    {
      credentials: "same-origin",
      signal,
    }
  );
  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(resolveResponseError(payload, LINKED_DPGF_LOAD_ERROR));
  }

  return parseLinkedDpgfSource(payload);
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

function createEmptyImportUiState(versionId: string): ScopedImportUiState {
  return {
    versionId,
    isImportFromEstimateDialogOpen: false,
    isEstimateStructureDraftDialogOpen: false,
    isStructureDraftAutoOpenConsumed: false,
    importSummaryMessage: null,
    activeMutation: null,
  };
}

export function useEstimateEditorImportController({
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
  const activeVersionId = activeVersion?.id ?? null;
  const activeProjectId =
    activeVersionId === routeVersionId
      ? (activeVersion?.project_id ?? null)
      : null;
  const linkedSourceScopeKey = activeProjectId
    ? `${routeVersionId}:${activeVersionId}:${activeProjectId}`
    : null;
  const [linkedSourceState, setLinkedSourceState] =
    useState<LinkedDpgfSourceState | null>(null);
  const [scopedImportUiState, setScopedImportUiState] =
    useState<ScopedImportUiState>(() =>
      createEmptyImportUiState(routeVersionId)
    );
  if (scopedImportUiState.versionId !== routeVersionId) {
    setScopedImportUiState(createEmptyImportUiState(routeVersionId));
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
    scopedImportUiState.versionId === routeVersionId;
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
    routeVersionIdRef.current = routeVersionId;
    routeGenerationRef.current += 1;
    operationGenerationRef.current += 1;
    activeMutationRef.current = null;
    cancelLinkedSourceRequest();
  }, [cancelLinkedSourceRequest, routeVersionId]);

  const isSameMutationScope = useCallback((scope: MutationScope) => {
    const active = activeMutationRef.current;
    return Boolean(
      active &&
        active.versionId === scope.versionId &&
        active.routeGeneration === scope.routeGeneration &&
        active.operationGeneration === scope.operationGeneration
    );
  }, []);

  const isMutationScopeActive = useCallback(
    (scope: MutationScope) =>
      isSameMutationScope(scope) &&
      routeVersionIdRef.current === scope.versionId &&
      routeGenerationRef.current === scope.routeGeneration &&
      getVersionSnapshot()?.id === scope.versionId,
    [getVersionSnapshot, isSameMutationScope]
  );

  const finishMutation = useCallback(
    (scope: MutationScope) => {
      if (!isSameMutationScope(scope)) return;
      activeMutationRef.current = null;
      setScopedImportUiState((previous) =>
        previous.versionId === scope.versionId &&
        previous.activeMutation === scope.kind
          ? { ...previous, activeMutation: null }
          : previous
      );
    },
    [isSameMutationScope]
  );

  const refreshLinkedDpgfSource = useCallback(async () => {
    if (
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
      !controller.signal.aborted &&
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
    routeVersionId,
  ]);

  useEffect(() => {
    if (
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
      !controller.signal.aborted &&
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
      if (routeVersionIdRef.current !== routeVersionId) {
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
        const message = "Une operation structurelle est deja en cours.";
        reportError(message);
        throw new Error(message);
      }

      const scope: MutationScope = {
        kind: options.kind,
        versionId: versionSnapshot.id,
        routeGeneration: routeGenerationRef.current,
        operationGeneration: operationGenerationRef.current + 1,
      };
      operationGenerationRef.current = scope.operationGeneration;
      activeMutationRef.current = scope;
      setScopedImportUiState((previous) => ({
        ...(previous.versionId === scope.versionId
          ? previous
          : createEmptyImportUiState(scope.versionId)),
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
          previous.versionId === scope.versionId
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
    if (routeVersionIdRef.current !== routeVersionId) return false;
    if (isMutationBlocked) {
      reportError(mutationBlockedMessage);
      return false;
    }
    if (activeMutationRef.current) {
      reportError("Une operation structurelle est deja en cours.");
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
    routeVersionId,
  ]);

  const openImportFromEstimateDialog = useCallback(() => {
    if (!canOpenDialog()) return false;
    setScopedImportUiState({
      ...createEmptyImportUiState(routeVersionId),
      isImportFromEstimateDialogOpen: true,
      isStructureDraftAutoOpenConsumed: true,
    });
    return true;
  }, [canOpenDialog, routeVersionId]);

  const closeImportFromEstimateDialog = useCallback(() => {
    if (routeVersionIdRef.current !== routeVersionId) return;
    setScopedImportUiState((previous) =>
      previous.versionId === routeVersionId
        ? { ...previous, isImportFromEstimateDialogOpen: false }
        : previous
    );
  }, [routeVersionId]);

  const confirmImportFromEstimate = useCallback(
    async (input: ImportEstimateSectionsPayload) => {
      await runStructuralMutation<ImportEstimateSectionsResult>({
        kind: "estimate-sections",
        actionLabel: "importer les sections du devis",
        failureMessage: "Impossible d'importer les sections.",
        tokenRefreshFailureMessage:
          "Impossible de rafraichir le jeton de version apres import de sections.",
        execute: (versionId) => importEstimateSections(versionId, input),
        getResultVersionId: (result) => result.targetVersionId,
        getVersionToken: (result) => result.versionToken,
        buildSummary: (result) =>
          `${result.importedSectionsCount} section(s) et ${result.importedLinesCount} ligne(s) importees.`,
      });
    },
    [runStructuralMutation]
  );

  const openEstimateStructureDraftDialog = useCallback(() => {
    if (!canOpenDialog()) return false;
    setScopedImportUiState({
      ...createEmptyImportUiState(routeVersionId),
      isEstimateStructureDraftDialogOpen: true,
    });
    return true;
  }, [canOpenDialog, routeVersionId]);

  const closeEstimateStructureDraftDialog = useCallback(() => {
    if (routeVersionIdRef.current !== routeVersionId) return;
    setScopedImportUiState((previous) => ({
      ...(previous.versionId === routeVersionId
        ? previous
        : createEmptyImportUiState(routeVersionId)),
      isEstimateStructureDraftDialogOpen: false,
      isStructureDraftAutoOpenConsumed: true,
    }));
  }, [routeVersionId]);

  const applyStructureDraft = useCallback(
    async (draftId: string, input: ApplyEstimateStructureDraftPayload) =>
      runStructuralMutation<ApplyEstimateStructureDraftResult>({
        kind: "structure-draft",
        actionLabel: "appliquer le brouillon de structure",
        failureMessage: "Impossible d'appliquer la preview de structure.",
        tokenRefreshFailureMessage:
          "Impossible de rafraichir le jeton de version apres application de structure IA.",
        execute: (versionId) =>
          applyEstimateStructureDraft(versionId, draftId, input),
        getResultVersionId: (result) => result.versionId,
        getVersionToken: (result) => result.versionToken,
        buildSummary: (result) =>
          `${result.createdCount} section(s) creee(s), ${result.mergedCount} fusion(s), ${result.skippedCount} ignoree(s).`,
      }),
    [runStructuralMutation]
  );

  const hasLinkedDpgfSource =
    isImportableLinkedDpgfSource(linkedDpgfSource);

  const importLinkedDpgfSource = useCallback(async () => {
    if (!hasLinkedDpgfSource) {
      reportError("Aucune source DPGF importable n'est liee a cette affaire.");
      return;
    }

    try {
      await runStructuralMutation<ImportLinkedDpgfSourceResult>({
        kind: "linked-dpgf",
        actionLabel: "importer la source DPGF liee",
        failureMessage: "Impossible d'importer le DPGF source lie.",
        tokenRefreshFailureMessage:
          "Impossible de rafraichir le jeton de version apres import du DPGF source.",
        execute: (versionId) => importLinkedDpgfSourceClient(versionId),
        getResultVersionId: (result) => result.targetVersionId,
        getVersionToken: (result) => result.versionToken,
        buildSummary: (result) => {
          const suffix = result.importedLinesCount > 1 ? "s" : "";
          return `${result.importedLinesCount} ligne${suffix} importee${suffix} depuis le DPGF source.`;
        },
      });
    } catch {
      // The shared mutation runner already handled user-visible errors.
    }
  }, [hasLinkedDpgfSource, reportError, runStructuralMutation]);

  const clearImportSummary = useCallback(() => {
    if (routeVersionIdRef.current !== routeVersionId) return;
    setScopedImportUiState((previous) =>
      previous.versionId === routeVersionId
        ? { ...previous, importSummaryMessage: null }
        : previous
    );
  }, [routeVersionId]);

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
