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
import type { EstimateVersionRow } from "@/lib/estimates/editor-items";

export type EstimateEditorSendWorkflowPhase =
  | "verification"
  | "pdf"
  | "sealing"
  | null;

type RouteScope = {
  versionId: string;
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
    sendWorkflowPhaseLabel: string | null;
  };
};

const STATUS_TRANSITIONS: Readonly<
  Record<EstimateStatus, readonly EstimateStatus[]>
> = {
  draft: ["sent"],
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
  routeVersionId,
  activeVersion = null,
  gatingReloadToken = 0,
  getVersionSnapshot,
  applyUpdatedVersion,
  isAdmin,
  isViewerReadOnly,
  isConflictLocked,
  conflictMessage,
  isDraftLockPending,
  draftLockPendingMessage = "Acquisition du verrou de brouillon en cours.",
  isDraftLockedByOther,
  draftLockedByOtherMessage = "Verrouille par un autre utilisateur.",
  isDraftLockAcquiring,
  draftLockAcquiringMessage = "Acquisition du verrou de brouillon en cours.",
  isForcingDraftUnlock,
  forceUnlockMessage = "Deverrouillage force en cours.",
  viewerReadOnlyMessage = "Mode consultation active.",
  isFlushInProgress,
  flushBufferedItemUpdates,
  hasPendingUpdatesNow,
  releaseDraftLock,
  handleVersionConflict,
  resolveErrorMessage,
  refreshTimeline,
}: EstimateEditorStatusControllerInput): EstimateEditorStatusController {
  const [scopedState, setScopedState] = useState<ScopedStatusState>(() =>
    createEmptyStatusState(routeVersionId)
  );
  const projectedState =
    scopedState.scopeKey === routeVersionId
      ? scopedState
      : createEmptyStatusState(routeVersionId);
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
      ? `${activeVersionId}:${activeVersionUpdatedAt ?? ""}:${gatingReloadToken}`
      : null;
  const preloadedSendGating =
    preloadRequestKey &&
    preloadedGatingSnapshot?.requestKey === preloadRequestKey
      ? preloadedGatingSnapshot.value
      : null;
  const sendGating = workflowSendGating ?? preloadedSendGating;

  const activeRouteVersionIdRef = useRef(routeVersionId);
  const previousRouteVersionIdRef = useRef(routeVersionId);
  const routeGenerationRef = useRef(0);
  const operationGenerationRef = useRef(0);
  const isOperationInProgressRef = useRef(false);
  const gatingScopeRef = useRef<GatingScope | null>(null);
  const preloadGenerationRef = useRef(0);

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
    if (previousRouteVersionIdRef.current === routeVersionId) return;

    previousRouteVersionIdRef.current = routeVersionId;
    activeRouteVersionIdRef.current = routeVersionId;
    routeGenerationRef.current += 1;
    operationGenerationRef.current += 1;
    preloadGenerationRef.current += 1;
    isOperationInProgressRef.current = false;
    gatingScopeRef.current = null;
  }, [routeVersionId]);

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
    (scope: Pick<RouteScope, "versionId" | "routeGeneration">) =>
      activeRouteVersionIdRef.current === scope.versionId &&
      routeGenerationRef.current === scope.routeGeneration,
    []
  );

  const isOperationScopeCurrent = useCallback(
    (scope: RouteScope) =>
      isRouteScopeCurrent(scope) &&
      operationGenerationRef.current === scope.operationGeneration,
    [isRouteScopeCurrent]
  );

  const beginOperation = useCallback((): RouteScope | null => {
    if (
      !routeVersionId ||
      activeRouteVersionIdRef.current !== routeVersionId ||
      isOperationInProgressRef.current
    ) {
      return null;
    }

    operationGenerationRef.current += 1;
    preloadGenerationRef.current += 1;
    isOperationInProgressRef.current = true;
    const scope = {
      versionId: routeVersionId,
      routeGeneration: routeGenerationRef.current,
      operationGeneration: operationGenerationRef.current,
    };
    updateStateForScope(scope.versionId, (current) => ({
      ...current,
      error: null,
      isUpdatingStatus: true,
    }));
    return scope;
  }, [routeVersionId, updateStateForScope]);

  useEffect(() => {
    const generation = ++preloadGenerationRef.current;
    if (!activeVersionId || !preloadRequestKey) return;

    let active = true;
    void fetchEstimateSendGating(activeVersionId)
      .then((result) => {
        const currentVersion = getVersionSnapshot();
        if (
          !active ||
          preloadGenerationRef.current !== generation ||
          activeRouteVersionIdRef.current !== activeVersionId ||
          currentVersion?.id !== activeVersionId ||
          currentVersion.status !== "draft" ||
          currentVersion.updated_at !== activeVersionUpdatedAt
        ) {
          return;
        }
        updateStateForScope(activeVersionId, (current) => ({
          ...current,
          preloadedGatingSnapshot: {
            requestKey: preloadRequestKey,
            value: result,
          },
        }));
      })
      .catch(() => {
        if (
          active &&
          preloadGenerationRef.current === generation &&
          activeRouteVersionIdRef.current === activeVersionId
        ) {
          updateStateForScope(activeVersionId, (current) => ({
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
    getVersionSnapshot,
    preloadRequestKey,
    updateStateForScope,
  ]);

  const finishOperation = useCallback(
    (scope: RouteScope) => {
      if (!isOperationScopeCurrent(scope)) return;
      isOperationInProgressRef.current = false;
      updateStateForScope(scope.versionId, (current) => ({
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
        updateStateForScope(scope.versionId, (current) => ({
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
        updateStateForScope(scope.versionId, (current) => ({
          ...current,
          workflowSendGating: null,
          isSendGatingDialogOpen: false,
        }));
        return;
      }
      updateStateForScope(scope.versionId, (current) => ({
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
          conflictMessage ?? "Version modifiee par un autre utilisateur."
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
          "Synchronisation des modifications en cours. Reessayez dans quelques secondes."
        );
        return null;
      }

      const flushResult = await flushBufferedItemUpdates();
      if (!isOperationScopeCurrent(scope)) return null;
      if (flushResult === "blocked" || flushResult === "error") {
        reportScopedError(
          scope,
          flushResult === "blocked"
            ? "Impossible de changer le statut tant que les modifications locales ne sont pas synchronisees."
            : "Impossible de synchroniser les modifications avant changement de statut."
        );
        return null;
      }
      if (flushResult === "noop" && hasPendingUpdatesNow()) {
        reportScopedError(
          scope,
          "Synchronisation des modifications en cours. Reessayez dans quelques secondes."
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
        if (isOperationScopeCurrent(scope) && nextStatus === "sent") {
          updateStateForScope(scope.versionId, (current) => ({
            ...current,
            sendWorkflowPhase: "pdf",
          }));
          sealingTimer = setTimeout(() => {
            if (isOperationScopeCurrent(scope)) {
              updateStateForScope(scope.versionId, (current) => ({
                ...current,
                sendWorkflowPhase: "sealing",
              }));
            }
          }, 250);
        }

        const updatedVersion = await updateEstimateStatus(
          sourceVersion.id,
          nextStatus,
          sourceVersion.updated_at,
          force === undefined ? undefined : { force }
        );
        if (!isOperationScopeCurrent(scope)) return false;
        if (
          updatedVersion.id !== scope.versionId ||
          updatedVersion.status !== nextStatus
        ) {
          reportScopedError(scope, "Reponse de statut incoherente.");
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
          "Impossible de mettre a jour le statut."
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
      updateStateForScope,
    ]
  );

  const requestSend = useCallback(async () => {
    const scope = beginOperation();
    if (!scope) return;
    updateStateForScope(scope.versionId, (current) => ({
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
          routeGeneration: scope.routeGeneration,
        };
        updateStateForScope(scope.versionId, (current) => ({
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
      const gatingScope = gatingScopeRef.current;
      if (
        !gatingScope ||
        !isRouteScopeCurrent(gatingScope) ||
        gatingScope.versionId !== routeVersionId
      ) {
        if (activeRouteVersionIdRef.current === routeVersionId) {
          updateStateForScope(routeVersionId, (current) => ({
            ...current,
            error: "Veuillez vérifier les préconditions d'envoi.",
          }));
        }
        return;
      }
      if (force && !isAdmin) {
        updateStateForScope(routeVersionId, (current) => ({
          ...current,
          error: "Seul un administrateur peut forcer l'envoi.",
        }));
        return;
      }

      const scope = beginOperation();
      if (!scope) return;
      updateStateForScope(scope.versionId, (current) => ({
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
        updateStateForScope(scope.versionId, (current) => ({
          ...current,
          workflowSendGating: latestGating,
        }));

        if (!latestGating.canSend && !(force && isAdmin)) {
          reportScopedError(
            scope,
            "Les preconditions d'envoi ne sont plus remplies."
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
        updateStateForScope(scope.versionId, (current) => ({
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
      getVersionSnapshot,
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
      isOperationInProgressRef.current ||
      activeRouteVersionIdRef.current !== routeVersionId
    ) {
      return;
    }
    updateStateForScope(routeVersionId, (current) => ({
      ...current,
      isSendGatingDialogOpen: false,
    }));
  }, [routeVersionId, updateStateForScope]);

  const clearError = useCallback(() => {
    if (activeRouteVersionIdRef.current !== routeVersionId) return;
    updateStateForScope(routeVersionId, (current) => ({
      ...current,
      error: null,
    }));
  }, [routeVersionId, updateStateForScope]);

  const currentVersion = getVersionSnapshot();
  const currentStatus =
    currentVersion?.id === routeVersionId ? currentVersion.status : null;
  const allowedTransitions = getAllowedTransitions(currentStatus);
  const hasKnownBlockingSendFlags =
    (sendGating?.blockingFlags.length ?? 0) > 0;
  const isStatusActionsDisabled =
    isUpdatingStatus ||
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
        sendGating !== null &&
        !sendGating.canSend &&
        hasKnownBlockingSendFlags &&
        !isAdmin,
      sendWorkflowPhaseLabel: resolveWorkflowPhaseLabel(sendWorkflowPhase),
    }),
    [
      allowedTransitions,
      currentStatus,
      hasKnownBlockingSendFlags,
      isAdmin,
      isStatusActionsDisabled,
      sendGating,
      sendWorkflowPhase,
    ]
  );

  return { state, actions, meta };
}
