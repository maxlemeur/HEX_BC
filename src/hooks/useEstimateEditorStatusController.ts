"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { AutoSaveResult } from "@/hooks/useAutoSave";
import {
  fetchEstimateSendGating,
  updateEstimateStatus,
  type EstimateSendGatingResponse,
  type EstimateStatus,
  type ReleaseEstimateDraftLockOptions,
} from "@/lib/estimates/client";
import { ESTIMATE_VERSION_CONFLICT_MESSAGE } from "@/lib/estimates/constants";
import type { EstimateEditorDocument, EstimateEditorDocumentScopeToken } from "@/lib/estimates/editor-document-state";
import type { EstimateVersionRow } from "@/lib/estimates/editor-items";

export type EstimateEditorSendWorkflowPhase =
  | "verification"
  | "pdf"
  | "sealing"
  | null;

type RouteScope = {
  versionId: string;
  scopeKey: string;
  documentScope?: EstimateEditorDocumentScopeToken;
  routeGeneration: number;
  operationGeneration: number;
};

type GatingScope = Omit<RouteScope, "operationGeneration">;

type PreloadedGatingSnapshot = {
  requestKey: string;
  value: EstimateSendGatingResponse | null;
};

type ScopedStatusState = {
  scopeKey: string;
  error: string | null;
  isUpdatingStatus: boolean;
  workflowSendGating: EstimateSendGatingResponse | null;
  preloadedGatingSnapshot: PreloadedGatingSnapshot | null;
  isSendGatingDialogOpen: boolean;
  sendWorkflowPhase: EstimateEditorSendWorkflowPhase;
};

export type EstimateEditorStatusControllerInput = {
  document?: EstimateEditorDocument;
  routeVersionId: string;
  activeVersion?: Pick<
    EstimateVersionRow,
    "id" | "status" | "updated_at"
  > | null;
  gatingReloadToken?: number;
  getVersionSnapshot: () => EstimateVersionRow | null;
  applyUpdatedVersion: (updatedVersion: EstimateVersionRow) => void;
  isAdmin: boolean;
  isViewerReadOnly: boolean;
  isConflictLocked: boolean;
  conflictMessage?: string | null;
  /** History writes and incomplete recoveries must finish before a status transition. */
  isHistoryBlocked?: boolean;
  /** Restored settings may be dirty while the settings drawer is closed. */
  hasPendingSettingsChanges?: boolean;
  openSettings?: () => void;
  isDraftLockPending: boolean;
  draftLockPendingMessage?: string;
  isDraftLockedByOther: boolean;
  draftLockedByOtherMessage?: string;
  isDraftLockAcquiring: boolean;
  draftLockAcquiringMessage?: string;
  isForcingDraftUnlock: boolean;
  forceUnlockMessage?: string;
  viewerReadOnlyMessage?: string;
  isFlushInProgress: () => boolean;
  flushBufferedItemUpdates: () => Promise<AutoSaveResult>;
  hasPendingUpdatesNow: () => boolean;
  releaseDraftLock: (
    options?: ReleaseEstimateDraftLockOptions
  ) => Promise<boolean>;
  handleVersionConflict: (
    error: unknown,
    options?: { persistDraft?: boolean }
  ) => boolean;
  resolveErrorMessage: (message: string) => string;
  refreshTimeline: () => void | Promise<void>;
};

export type EstimateEditorStatusController = {
  state: {
    error: string | null;
    isUpdatingStatus: boolean;
    sendGating: EstimateSendGatingResponse | null;
    isSendGatingDialogOpen: boolean;
    sendWorkflowPhase: EstimateEditorSendWorkflowPhase;
  };
  actions: {
    requestSend: () => Promise<void>;
    confirmSend: (force?: boolean) => Promise<void>;
    changeStatus: (nextStatus: EstimateStatus) => Promise<void>;
    closeSendGatingDialog: () => void;
    clearError: () => void;
  };
  meta: {
    allowedTransitions: EstimateStatus[];
    canSend: boolean;
    canAccept: boolean;
    canArchive: boolean;
    isStatusActionsDisabled: boolean;
    isSendBlockedForCurrentUser: boolean;
    /** The draft's gating is read again after a write: the send-blocked alert may still change. */
    isSendGatingRefreshing: boolean;
    sendWorkflowPhaseLabel: string | null;
  };
};

const STATUS_TRANSITIONS: Readonly<
  Record<EstimateStatus, readonly EstimateStatus[]>
> = {
  draft: ["sent"],
  sending: [],
  sent: ["accepted", "archived"],
  accepted: ["archived"],
  archived: [],
};

function getAllowedTransitions(status: EstimateStatus | null) {
  return status ? [...STATUS_TRANSITIONS[status]] : [];
}

function isTransitionAllowed(
  currentStatus: EstimateStatus,
  nextStatus: EstimateStatus
) {
  return STATUS_TRANSITIONS[currentStatus].includes(nextStatus);
}

function resolveWorkflowPhaseLabel(phase: EstimateEditorSendWorkflowPhase) {
  switch (phase) {
    case "verification":
      return "Verification...";
    case "pdf":
      return "Generation PDF...";
    case "sealing":
      return "Scellement...";
    default:
      return null;
  }
}

function createEmptyStatusState(scopeKey: string): ScopedStatusState {
  return {
    scopeKey,
    error: null,
    isUpdatingStatus: false,
    workflowSendGating: null,
    preloadedGatingSnapshot: null,
    isSendGatingDialogOpen: false,
    sendWorkflowPhase: null,
  };
}

export function useEstimateEditorStatusController({
  document,
  routeVersionId,
  activeVersion = null,
  gatingReloadToken = 0,
  getVersionSnapshot,
  applyUpdatedVersion,
  isAdmin,
  isViewerReadOnly,
  isConflictLocked,
  conflictMessage,
  isHistoryBlocked = false,
  hasPendingSettingsChanges = false,
  openSettings,
  isDraftLockPending,
  draftLockPendingMessage = "Acquisition du verrou de brouillon en cours.",
  isDraftLockedByOther,
  draftLockedByOtherMessage = "Verrouillé par un autre utilisateur.",
  isDraftLockAcquiring,
  draftLockAcquiringMessage = "Acquisition du verrou de brouillon en cours.",
  isForcingDraftUnlock,
  forceUnlockMessage = "Déverrouillage forcé en cours.",
  viewerReadOnlyMessage = "Mode consultation activé.",
  isFlushInProgress,
  flushBufferedItemUpdates,
  hasPendingUpdatesNow,
  releaseDraftLock,
  handleVersionConflict,
  resolveErrorMessage,
  refreshTimeline,
}: EstimateEditorStatusControllerInput): EstimateEditorStatusController {
  const documentGeneration = document?.getSnapshot().generation;
  const documentScope = useMemo(() => document && documentGeneration !== undefined
    ? { ...document.captureScope(), generation: documentGeneration } : undefined, [document, documentGeneration]);
  const controllerScopeKey = documentScope
    ? JSON.stringify([routeVersionId, documentScope.actorId, documentScope.tenantId, documentScope.generation])
    : routeVersionId;
  const isDocumentScopeCurrent = useCallback(() => !documentScope || Boolean(document?.isCurrent(documentScope)), [document, documentScope]);
  const [scopedState, setScopedState] = useState<ScopedStatusState>(() =>
    createEmptyStatusState(controllerScopeKey)
  );
  const [previousHistoryBlocked, setPreviousHistoryBlocked] = useState(isHistoryBlocked);
  // Clear the previous confirmation before rendering children, including after recovery ends.
  if (previousHistoryBlocked !== isHistoryBlocked) {
    setPreviousHistoryBlocked(isHistoryBlocked);
    if (isHistoryBlocked) {
      setScopedState((current) => ({
        ...current,
        workflowSendGating: null,
        isSendGatingDialogOpen: false,
        isUpdatingStatus: false,
        sendWorkflowPhase: null,
      }));
    }
  }
  const projectedState =
    scopedState.scopeKey === controllerScopeKey
      ? scopedState
      : createEmptyStatusState(controllerScopeKey);
  const {
    error,
    isUpdatingStatus,
    workflowSendGating,
    preloadedGatingSnapshot,
    isSendGatingDialogOpen,
    sendWorkflowPhase,
  } = projectedState;
  const activeVersionId = activeVersion?.id ?? null;
  const activeVersionStatus = activeVersion?.status ?? null;
  const activeVersionUpdatedAt = activeVersion?.updated_at ?? null;
  const preloadRequestKey =
    activeVersionId === routeVersionId && activeVersionStatus === "draft"
      ? `${controllerScopeKey}:${activeVersionUpdatedAt ?? ""}:${gatingReloadToken}`
      : null;
  const preloadedSendGating =
    preloadRequestKey &&
    preloadedGatingSnapshot?.requestKey === preloadRequestKey
      ? preloadedGatingSnapshot.value
      : null;
  const sendGating = workflowSendGating ?? preloadedSendGating;
  // L'alerte « envoi bloqué » lit le dernier contrôle abouti de ce brouillon pendant qu'un jeton plus récent est
  // contrôlé : `sendGating` reste masqué (rien n'agit sur un contrôle périmé), mais l'alerte ne disparaît plus le temps
  // de chaque contrôle, ce qui déplaçait la grille après chaque écriture (V3E05, estimate-engine-v3-2.7.md §13.13).
  const displayedSendGating =
    sendGating ?? (preloadRequestKey ? preloadedGatingSnapshot?.value ?? null : null);
  // Until the current token's check answers, that alert may still appear or disappear and move the
  // controls below it (« Annuler les suggestions », docs/testing/bulk-edit-sync-baseline.md).
  const isSendGatingRefreshing =
    preloadRequestKey !== null &&
    workflowSendGating === null &&
    preloadedGatingSnapshot?.requestKey !== preloadRequestKey;

  const activeRouteVersionIdRef = useRef(routeVersionId);
  const previousControllerScopeKeyRef = useRef(controllerScopeKey);
  const routeGenerationRef = useRef(0);
  const operationGenerationRef = useRef(0);
  const isOperationInProgressRef = useRef(false);
  const gatingScopeRef = useRef<GatingScope | null>(null);
  const preloadGenerationRef = useRef(0);
  const historyBlockedRef = useRef(isHistoryBlocked);
  const pendingSettingsRef = useRef(hasPendingSettingsChanges);
  useLayoutEffect(() => {
    pendingSettingsRef.current = hasPendingSettingsChanges;
  }, [hasPendingSettingsChanges]);

  const updateStateForScope = useCallback(
    (
      targetScopeKey: string,
      update: (current: ScopedStatusState) => ScopedStatusState
    ) => {
      setScopedState((current) =>
        update(
          current.scopeKey === targetScopeKey
            ? current
            : createEmptyStatusState(targetScopeKey)
        )
      );
    },
    []
  );

  useLayoutEffect(() => {
    if (previousControllerScopeKeyRef.current === controllerScopeKey) return;

    previousControllerScopeKeyRef.current = controllerScopeKey;
    activeRouteVersionIdRef.current = routeVersionId;
    routeGenerationRef.current += 1;
    operationGenerationRef.current += 1;
    preloadGenerationRef.current += 1;
    isOperationInProgressRef.current = false;
    gatingScopeRef.current = null;
  }, [controllerScopeKey, routeVersionId]);

  useLayoutEffect(() => {
    historyBlockedRef.current = isHistoryBlocked;
    if (!isHistoryBlocked) return;

    // A confirmation obtained before an undo/recovery cannot authorize sending
    // the restored draft, even if its earlier gating read answers afterwards.
    operationGenerationRef.current += 1;
    isOperationInProgressRef.current = false;
    gatingScopeRef.current = null;
  }, [isHistoryBlocked, routeVersionId]);

  useEffect(
    () => () => {
      routeGenerationRef.current += 1;
      operationGenerationRef.current += 1;
      preloadGenerationRef.current += 1;
      isOperationInProgressRef.current = false;
      gatingScopeRef.current = null;
    },
    []
  );

  const isRouteScopeCurrent = useCallback(
    (scope: Pick<RouteScope, "versionId" | "routeGeneration" | "documentScope">) =>
      activeRouteVersionIdRef.current === scope.versionId &&
      routeGenerationRef.current === scope.routeGeneration &&
      (!scope.documentScope || Boolean(document?.isCurrent(scope.documentScope))),
    [document]
  );

  const isOperationScopeCurrent = useCallback(
    (scope: RouteScope) =>
      isRouteScopeCurrent(scope) &&
      operationGenerationRef.current === scope.operationGeneration &&
      !historyBlockedRef.current,
    [isRouteScopeCurrent]
  );

  const beginOperation = useCallback((): RouteScope | null => {
    if (
      !routeVersionId || !isDocumentScopeCurrent() ||
      activeRouteVersionIdRef.current !== routeVersionId ||
      historyBlockedRef.current ||
      isOperationInProgressRef.current
    ) {
      return null;
    }

    operationGenerationRef.current += 1;
    // The gating read in flight is kept: its answer is still checked against the version and its
    // token, and dropping it left the current token unchecked (gating masked, undo held) until the
    // next write.
    isOperationInProgressRef.current = true;
    const scope = {
      versionId: routeVersionId,
      scopeKey: controllerScopeKey,
      documentScope,
      routeGeneration: routeGenerationRef.current,
      operationGeneration: operationGenerationRef.current,
    };
    updateStateForScope(scope.scopeKey, (current) => ({
      ...current,
      error: null,
      isUpdatingStatus: true,
    }));
    return scope;
  }, [controllerScopeKey, documentScope, isDocumentScopeCurrent, routeVersionId, updateStateForScope]);

  useEffect(() => {
    const generation = ++preloadGenerationRef.current;
    if (!activeVersionId || !preloadRequestKey) return;

    let active = true;
    void fetchEstimateSendGating(activeVersionId)
      .then((result) => {
        const currentVersion = getVersionSnapshot();
        if (
          !active || !isDocumentScopeCurrent() ||
          preloadGenerationRef.current !== generation ||
          activeRouteVersionIdRef.current !== activeVersionId ||
          currentVersion?.id !== activeVersionId ||
          currentVersion.status !== "draft" ||
          currentVersion.updated_at !== activeVersionUpdatedAt
        ) {
          return;
        }
        updateStateForScope(controllerScopeKey, (current) => ({
          ...current,
          preloadedGatingSnapshot: {
            requestKey: preloadRequestKey,
            value: result,
          },
        }));
      })
      .catch(() => {
        if (
          active && isDocumentScopeCurrent() &&
          preloadGenerationRef.current === generation &&
          activeRouteVersionIdRef.current === activeVersionId
        ) {
          updateStateForScope(controllerScopeKey, (current) => ({
            ...current,
            preloadedGatingSnapshot: {
              requestKey: preloadRequestKey,
              value: null,
            },
          }));
        }
      });

    return () => {
      active = false;
    };
  }, [
    activeVersionId,
    activeVersionStatus,
    activeVersionUpdatedAt,
    controllerScopeKey,
    getVersionSnapshot,
    isDocumentScopeCurrent,
    preloadRequestKey,
    updateStateForScope,
  ]);

  const finishOperation = useCallback(
    (scope: RouteScope) => {
      if (!isOperationScopeCurrent(scope)) return;
      isOperationInProgressRef.current = false;
      updateStateForScope(scope.scopeKey, (current) => ({
        ...current,
        isUpdatingStatus: false,
        sendWorkflowPhase: null,
      }));
    },
    [isOperationScopeCurrent, updateStateForScope]
  );

  const reportScopedError = useCallback(
    (scope: RouteScope, message: string) => {
      if (isOperationScopeCurrent(scope)) {
        updateStateForScope(scope.scopeKey, (current) => ({
          ...current,
          error: message,
        }));
      }
    },
    [isOperationScopeCurrent, updateStateForScope]
  );

  const handleScopedError = useCallback(
    (scope: RouteScope, requestError: unknown, fallbackMessage: string) => {
      if (!isOperationScopeCurrent(scope)) return;
      if (handleVersionConflict(requestError, { persistDraft: true })) {
        gatingScopeRef.current = null;
        updateStateForScope(scope.scopeKey, (current) => ({
          ...current,
          workflowSendGating: null,
          isSendGatingDialogOpen: false,
        }));
        return;
      }
      updateStateForScope(scope.scopeKey, (current) => ({
        ...current,
        error: resolveErrorMessage(
          requestError instanceof Error
            ? requestError.message
            : fallbackMessage
        ),
      }));
    },
    [
      handleVersionConflict,
      isOperationScopeCurrent,
      resolveErrorMessage,
      updateStateForScope,
    ]
  );

  const requireSavedSettings = useCallback((scope: RouteScope, nextStatus: EstimateStatus) => {
    if (nextStatus !== "sent" || !pendingSettingsRef.current) return true;
    if (!isOperationScopeCurrent(scope)) return false;
    gatingScopeRef.current = null;
    updateStateForScope(scope.scopeKey, (current) => ({
      ...current,
      workflowSendGating: null,
      isSendGatingDialogOpen: false,
      error: "Le paramétrage contient des modifications non enregistrées. Enregistrez-les ou abandonnez-les avant d’envoyer le devis.",
    }));
    openSettings?.();
    return false;
  }, [isOperationScopeCurrent, openSettings, updateStateForScope]);

  const prepareTransition = useCallback(
    async (
      scope: RouteScope,
      nextStatus: EstimateStatus
    ): Promise<EstimateVersionRow | null> => {
      if (!isOperationScopeCurrent(scope)) return null;
      if (isViewerReadOnly) {
        reportScopedError(scope, viewerReadOnlyMessage);
        return null;
      }
      if (isConflictLocked) {
        reportScopedError(
          scope,
          conflictMessage ?? ESTIMATE_VERSION_CONFLICT_MESSAGE
        );
        return null;
      }
      if (isForcingDraftUnlock) {
        reportScopedError(scope, forceUnlockMessage);
        return null;
      }
      if (isDraftLockAcquiring) {
        reportScopedError(scope, draftLockAcquiringMessage);
        return null;
      }
      if (isDraftLockPending) {
        reportScopedError(scope, draftLockPendingMessage);
        return null;
      }
      if (isDraftLockedByOther) {
        reportScopedError(scope, draftLockedByOtherMessage);
        return null;
      }

      if (!requireSavedSettings(scope, nextStatus)) return null;
      const initialVersion = getVersionSnapshot();
      if (!initialVersion || initialVersion.id !== scope.versionId) {
        reportScopedError(scope, "Version introuvable.");
        return null;
      }
      if (!isTransitionAllowed(initialVersion.status, nextStatus)) {
        reportScopedError(scope, "Transition de statut non autorisee.");
        return null;
      }
      if (isFlushInProgress()) {
        reportScopedError(
          scope,
          "Synchronisation des modifications en cours. Réessayez dans quelques secondes."
        );
        return null;
      }

      const flushResult = await flushBufferedItemUpdates();
      if (!isOperationScopeCurrent(scope) || !requireSavedSettings(scope, nextStatus)) return null;
      if (flushResult === "blocked" || flushResult === "error") {
        reportScopedError(
          scope,
          flushResult === "blocked"
            ? "Impossible de changer le statut tant que les modifications locales ne sont pas synchronisées."
            : "Impossible de synchroniser les modifications avant changement de statut."
        );
        return null;
      }
      if (flushResult === "noop" && hasPendingUpdatesNow()) {
        reportScopedError(
          scope,
          "Synchronisation des modifications en cours. Réessayez dans quelques secondes."
        );
        return null;
      }

      const currentVersion = getVersionSnapshot();
      if (!currentVersion || currentVersion.id !== scope.versionId) {
        reportScopedError(scope, "Version introuvable.");
        return null;
      }
      if (!isTransitionAllowed(currentVersion.status, nextStatus)) {
        reportScopedError(scope, "Transition de statut non autorisee.");
        return null;
      }
      return currentVersion;
    },
    [
      conflictMessage,
      draftLockAcquiringMessage,
      draftLockPendingMessage,
      draftLockedByOtherMessage,
      flushBufferedItemUpdates,
      forceUnlockMessage,
      getVersionSnapshot,
      hasPendingUpdatesNow,
      isConflictLocked,
      isDraftLockAcquiring,
      isDraftLockPending,
      isDraftLockedByOther,
      isFlushInProgress,
      isForcingDraftUnlock,
      isOperationScopeCurrent,
      isViewerReadOnly,
      reportScopedError,
      requireSavedSettings,
      viewerReadOnlyMessage,
    ]
  );

  const applyStatusUpdate = useCallback(
    async (
      scope: RouteScope,
      sourceVersion: EstimateVersionRow,
      nextStatus: EstimateStatus,
      force?: boolean
    ) => {
      let sealingTimer: ReturnType<typeof setTimeout> | null = null;
      try {
        if (!isOperationScopeCurrent(scope) || !requireSavedSettings(scope, nextStatus)) return false;
        if (nextStatus === "sent") {
          updateStateForScope(scope.scopeKey, (current) => ({
            ...current,
            sendWorkflowPhase: "pdf",
          }));
          sealingTimer = setTimeout(() => {
            if (isOperationScopeCurrent(scope)) {
              updateStateForScope(scope.scopeKey, (current) => ({
                ...current,
                sendWorkflowPhase: "sealing",
              }));
            }
          }, 250);
        }

        if (!isOperationScopeCurrent(scope) || !requireSavedSettings(scope, nextStatus)) return false;
        const updatedVersion = await updateEstimateStatus(
          sourceVersion.id,
          nextStatus,
          sourceVersion.updated_at,
          force === undefined ? undefined : { force }
        );
        // The write has committed. Later local edits cannot turn its receipt
        // into an unperformed transition; publish the confirmed server status.
        if (!isOperationScopeCurrent(scope)) return false;
        if (
          updatedVersion.id !== scope.versionId ||
          updatedVersion.status !== nextStatus
        ) {
          reportScopedError(scope, "Réponse de statut incoherente.");
          return false;
        }
        const currentVersion = getVersionSnapshot();
        if (!currentVersion || currentVersion.id !== scope.versionId) {
          return false;
        }

        applyUpdatedVersion(updatedVersion);
        if (
          sourceVersion.status === "draft" &&
          updatedVersion.status !== "draft"
        ) {
          try {
            await releaseDraftLock({ keepalive: true });
          } catch {
            // Non bloquant: le verrou expirera naturellement.
          }
        }
        if (isOperationScopeCurrent(scope) && isAdmin) {
          void Promise.resolve(refreshTimeline()).catch(() => undefined);
        }
        return true;
      } catch (requestError) {
        handleScopedError(
          scope,
          requestError,
          "Impossible de mettre à jour le statut."
        );
        return false;
      } finally {
        if (sealingTimer !== null) {
          clearTimeout(sealingTimer);
        }
      }
    },
    [
      applyUpdatedVersion,
      getVersionSnapshot,
      handleScopedError,
      isAdmin,
      isOperationScopeCurrent,
      refreshTimeline,
      releaseDraftLock,
      reportScopedError,
      requireSavedSettings,
      updateStateForScope,
    ]
  );

  const requestSend = useCallback(async () => {
    const scope = beginOperation();
    if (!scope) return;
    updateStateForScope(scope.scopeKey, (current) => ({
      ...current,
      sendWorkflowPhase: "verification",
    }));

    try {
      const versionSnapshot = await prepareTransition(scope, "sent");
      if (!versionSnapshot || !isOperationScopeCurrent(scope)) return;

      try {
        const gatingResult = await fetchEstimateSendGating(versionSnapshot.id);
        if (!isOperationScopeCurrent(scope)) return;
        const latestVersion = getVersionSnapshot();
        if (!latestVersion || latestVersion.id !== scope.versionId) return;

        gatingScopeRef.current = {
          versionId: scope.versionId,
          scopeKey: scope.scopeKey,
          documentScope: scope.documentScope,
          routeGeneration: scope.routeGeneration,
        };
        updateStateForScope(scope.scopeKey, (current) => ({
          ...current,
          workflowSendGating: gatingResult,
          isSendGatingDialogOpen: true,
        }));
      } catch (requestError) {
        handleScopedError(
          scope,
          requestError,
          "Impossible de vérifier les préconditions d'envoi."
        );
      }
    } finally {
      finishOperation(scope);
    }
  }, [
    beginOperation,
    finishOperation,
    getVersionSnapshot,
    handleScopedError,
    isOperationScopeCurrent,
    prepareTransition,
    updateStateForScope,
  ]);

  const confirmSend = useCallback(
    async (force = false) => {
      if (historyBlockedRef.current || !isDocumentScopeCurrent()) return;
      const gatingScope = gatingScopeRef.current;
      if (
        !gatingScope ||
        !isRouteScopeCurrent(gatingScope) ||
        gatingScope.versionId !== routeVersionId
      ) {
        if (activeRouteVersionIdRef.current === routeVersionId) {
          updateStateForScope(controllerScopeKey, (current) => ({
            ...current,
            error: "Veuillez vérifier les préconditions d'envoi.",
          }));
        }
        return;
      }
      if (force && !isAdmin) {
        updateStateForScope(controllerScopeKey, (current) => ({
          ...current,
          error: "Seul un administrateur peut forcer l'envoi.",
        }));
        return;
      }

      const scope = beginOperation();
      if (!scope) return;
      updateStateForScope(scope.scopeKey, (current) => ({
        ...current,
        sendWorkflowPhase: "verification",
      }));

      try {
        const versionSnapshot = await prepareTransition(scope, "sent");
        if (!versionSnapshot || !isOperationScopeCurrent(scope)) return;
        if (
          gatingScope.versionId !== versionSnapshot.id ||
          gatingScope.routeGeneration !== scope.routeGeneration
        ) {
          reportScopedError(
            scope,
            "Veuillez vérifier les préconditions d'envoi."
          );
          return;
        }

        let latestGating: EstimateSendGatingResponse;
        try {
          latestGating = await fetchEstimateSendGating(versionSnapshot.id);
        } catch (requestError) {
          handleScopedError(
            scope,
            requestError,
            "Impossible de vérifier les préconditions d'envoi."
          );
          return;
        }
        if (!isOperationScopeCurrent(scope)) return;
        updateStateForScope(scope.scopeKey, (current) => ({
          ...current,
          workflowSendGating: latestGating,
        }));

        if (!latestGating.canSend && !(force && isAdmin)) {
          reportScopedError(
            scope,
            "Les préconditions d'envoi ne sont plus remplies."
          );
          return;
        }

        const latestVersion = getVersionSnapshot();
        if (
          !latestVersion ||
          latestVersion.id !== scope.versionId ||
          latestVersion.status !== "draft"
        ) {
          reportScopedError(scope, "Version introuvable.");
          return;
        }

        const didUpdate = await applyStatusUpdate(
          scope,
          latestVersion,
          "sent",
          force
        );
        if (!didUpdate || !isOperationScopeCurrent(scope)) return;
        gatingScopeRef.current = null;
        updateStateForScope(scope.scopeKey, (current) => ({
          ...current,
          workflowSendGating: null,
          isSendGatingDialogOpen: false,
        }));
      } finally {
        finishOperation(scope);
      }
    },
    [
      applyStatusUpdate,
      beginOperation,
      finishOperation,
      controllerScopeKey,
      getVersionSnapshot,
      isDocumentScopeCurrent,
      handleScopedError,
      isAdmin,
      isOperationScopeCurrent,
      isRouteScopeCurrent,
      prepareTransition,
      reportScopedError,
      routeVersionId,
      updateStateForScope,
    ]
  );

  const changeStatus = useCallback(
    async (nextStatus: EstimateStatus) => {
      if (nextStatus === "sent") {
        await requestSend();
        return;
      }

      const scope = beginOperation();
      if (!scope) return;
      try {
        const versionSnapshot = await prepareTransition(scope, nextStatus);
        if (!versionSnapshot || !isOperationScopeCurrent(scope)) return;
        await applyStatusUpdate(scope, versionSnapshot, nextStatus);
      } finally {
        finishOperation(scope);
      }
    },
    [
      applyStatusUpdate,
      beginOperation,
      finishOperation,
      isOperationScopeCurrent,
      prepareTransition,
      requestSend,
    ]
  );

  const closeSendGatingDialog = useCallback(() => {
    if (
      !isDocumentScopeCurrent() || isOperationInProgressRef.current ||
      activeRouteVersionIdRef.current !== routeVersionId
    ) {
      return;
    }
    updateStateForScope(controllerScopeKey, (current) => ({
      ...current,
      isSendGatingDialogOpen: false,
    }));
  }, [controllerScopeKey, isDocumentScopeCurrent, routeVersionId, updateStateForScope]);

  const clearError = useCallback(() => {
    if (!isDocumentScopeCurrent() || activeRouteVersionIdRef.current !== routeVersionId) return;
    updateStateForScope(controllerScopeKey, (current) => ({
      ...current,
      error: null,
    }));
  }, [controllerScopeKey, isDocumentScopeCurrent, routeVersionId, updateStateForScope]);

  const currentVersion = getVersionSnapshot();
  const currentStatus =
    currentVersion?.id === routeVersionId ? currentVersion.status : null;
  const allowedTransitions = getAllowedTransitions(currentStatus);
  const hasKnownBlockingSendFlags =
    (displayedSendGating?.blockingFlags.length ?? 0) > 0;
  const isStatusActionsDisabled =
    isUpdatingStatus ||
    isHistoryBlocked ||
    isViewerReadOnly ||
    isConflictLocked ||
    isDraftLockPending ||
    isDraftLockedByOther ||
    isDraftLockAcquiring ||
    isForcingDraftUnlock;

  const state = useMemo(
    () => ({
      error,
      isUpdatingStatus,
      sendGating,
      isSendGatingDialogOpen,
      sendWorkflowPhase,
    }),
    [
      error,
      isSendGatingDialogOpen,
      isUpdatingStatus,
      sendGating,
      sendWorkflowPhase,
    ]
  );

  const actions = useMemo(
    () => ({
      requestSend,
      confirmSend,
      changeStatus,
      closeSendGatingDialog,
      clearError,
    }),
    [
      changeStatus,
      clearError,
      closeSendGatingDialog,
      confirmSend,
      requestSend,
    ]
  );

  const meta = useMemo(
    () => ({
      allowedTransitions,
      canSend: currentStatus === "draft",
      canAccept: currentStatus === "sent",
      canArchive:
        currentStatus === "sent" || currentStatus === "accepted",
      isStatusActionsDisabled,
      isSendBlockedForCurrentUser:
        displayedSendGating !== null &&
        !displayedSendGating.canSend &&
        hasKnownBlockingSendFlags &&
        !isAdmin,
      isSendGatingRefreshing,
      sendWorkflowPhaseLabel: resolveWorkflowPhaseLabel(sendWorkflowPhase),
    }),
    [
      allowedTransitions,
      currentStatus,
      displayedSendGating,
      hasKnownBlockingSendFlags,
      isAdmin,
      isSendGatingRefreshing,
      isStatusActionsDisabled,
      sendWorkflowPhase,
    ]
  );

  return { state, actions, meta };
}
