"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { EstimateSettingsState } from "@/components/estimates/EstimateSettingsPanel";
import type { AutoSaveResult } from "@/hooks/useAutoSave";
import {
  deferEffectStateUpdate,
  useEstimateEditorAutoSave,
} from "@/hooks/useEstimateEditorAutoSave";
import { useAutoSaveNavigationGuard } from "@/hooks/useAutoSaveNavigationGuard";
import { useDraftLock } from "@/hooks/useDraftLock";
import { useEstimateBatchRecovery } from "@/hooks/useEstimateBatchRecovery";
import { EstimateEditorDocument } from "@/lib/estimates/editor-document-state";
import { EstimateEditorSaveSession } from "@/lib/estimates/editor-save-session";
import { saveEstimateEditorLines, type EstimateLineSaveReceipt } from "@/lib/estimates/editor-line-save";
import {
  serializeBufferedUpdates,
  shouldFlushBufferedUpdates,
  upsertBufferedUpdate,
} from "@/lib/estimates/bulk-buffer";
import {
  isEstimateApiError,
} from "@/lib/estimates/client";
import {
  clearDocumentAutoSaveDraft,
  clearDocumentConflictDraft,
  readDocumentAutoSaveDraft,
  readDocumentConflictDraft,
  writeDocumentAutoSaveDraft,
  writeDocumentConflictDraft,
  hasUnownedDocumentDraft,
  UNOWNED_DOCUMENT_DRAFT_MESSAGE,
} from "@/lib/estimates/editor-document-drafts";
import {
  hasEstimateEditorMutations,
  registerEstimateEditorMutations,
  recoverEstimateEditorRead,
  waitForEstimateEditorMutations,
} from "@/lib/estimates/editor-mutations";
import {
  buildEstimateItemUpdatePayload,
  buildVersionTotalsPatch,
  type EditorEstimateItem,
  type EstimateItem,
  type EstimateItemUpdatePayload,
} from "@/lib/estimates/editor-items";
import { isOlderEstimateVersionToken } from "@/lib/estimates/version-token";
import { reconcilesEditorTotals, toEngineItemWrite, writesEditorTotals } from "@/lib/estimates/editor-engine";
import { isDraftLockRequiredError, isVersionConflictError } from "@/lib/estimates/editor-sync-errors";

import {
  AUTOSAVE_IMMEDIATE_FLUSH_UPDATES,
  type EstimateEditorConflictDraft,
  type EstimateEditorConflictState,
  type EstimateEditorSyncController,
  type EstimateEditorSyncControllerInput,
} from "@/hooks/useEstimateEditorSyncController.types";

export type {
  EstimateEditorConflictDraft,
  EstimateEditorConflictState,
  EstimateEditorSyncController,
};

export function useEstimateEditorSyncController({
  document: suppliedDocument,
  routeVersionId: routeVersionIdInput,
  activeVersion,
  currentUserId: currentUserIdInput,
  currentTenantId: currentTenantIdInput,
  isViewerReadOnly,
  hasPendingSettingsChanges,
  isSavingSettings,
  allowManualTotalsReconciliation = false,
  savePendingSettings,
  navigate,
  items,
  settings,
  getVersionSnapshot,
  getPersistedTotals,
  replaceItems,
  deriveBufferedItem,
  applyRestoredDraft,
  applyVersionFlushResult,
  setTotalsOutOfSync,
  clearHistory,
  reportError,
  reportNotice,
  resolveErrorMessage,
}: EstimateEditorSyncControllerInput): EstimateEditorSyncController {
  const routeVersionId = routeVersionIdInput.toLowerCase();
  const currentUserId = currentUserIdInput?.toLowerCase() ?? null;
  const currentTenantId = currentTenantIdInput?.toLowerCase() ?? null;
  // Production shares the document with the editor. Standalone controller users
  // retain the same contract through an owner local to this account/version.
  const document = useMemo(() => suppliedDocument ?? new EstimateEditorDocument({
    actorId: currentUserId, tenantId: currentTenantId, versionId: routeVersionId,
  }), [suppliedDocument, currentUserId, currentTenantId, routeVersionId]);
  const documentSnapshot = useSyncExternalStore(document.subscribe, document.getSnapshot, document.getSnapshot);
  const documentScope = useMemo(() => ({
    ...document.captureScope(), generation: documentSnapshot.generation,
  }), [document, documentSnapshot.generation]);
  const hasPendingBufferedUpdates = documentSnapshot.pendingCount > 0;
  const pendingItemUpdatesRef = useMemo(() => ({
    get current() { return document.getPendingUpdates(); },
  }), [document]);
  const [hasPendingTotalsSave, setHasPendingTotalsSave] = useState(false);
  const [hasPendingMutations, setHasPendingMutations] = useState(false);
  const [readRequiredMessage, setReadRequiredMessage] = useState<string | null>(null);
  const [recoveryReloadMessage, setRecoveryReloadMessage] = useState<string | null>(null);
  const [isRecoveringRead, setIsRecoveringRead] = useState(false);
  const [conflict, setConflict] =
    useState<EstimateEditorConflictState | null>(null);
  const conflictMessageRef = useRef<string | null>(null);
  const [restorableDraft, setRestorableDraft] =
    useState<EstimateEditorConflictDraft | null>(null);
  const [isReloadingVersion, setIsReloadingVersion] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const pendingBufferedUpdateCountRef = useRef(0);
  const hasPendingTotalsSaveRef = useRef(false);
  const savePendingSettingsRef = useRef(savePendingSettings);
  const deriveBufferedItemRef = useRef(deriveBufferedItem);
  const saveSessionRef = useRef(new EstimateEditorSaveSession());
  const routeVersionIdRef = useRef(routeVersionId);
  const structuralGenerationRef = useRef(0);
  const restoredConflictDraftRef = useRef(false);
  const pendingSettingsRef = useRef(hasPendingSettingsChanges);
  const savingSettingsRef = useRef(isSavingSettings);
  const itemsRef = useRef(items);
  const isSaveBlockedRef = useRef(false);
  const readRequiredMessageRef = useRef<string | null>(null);
  const recoveryReloadMessageRef = useRef<string | null>(null);
  const isRecoveringReadRef = useRef(false);
  const recoveryReloadInFlightRef = useRef(false);
  const mutationLifetimeRef = useRef(0);
  /** Vrai tant que cette page a detenu le verrou pour la version courante. */
  const hadDraftLockOwnershipRef = useRef(false);
  const fallbackSource = suppliedDocument ? null : { version: getVersionSnapshot(), items, settings, deriveBufferedItem };
  const fallbackKey = suppliedDocument ? "" : JSON.stringify([fallbackSource?.version, items, settings]);
  const fallbackSourceRef = useRef(fallbackSource);
  useLayoutEffect(() => {
    itemsRef.current = items;
    fallbackSourceRef.current = fallbackSource;
  });
  useLayoutEffect(() => {
    const source = fallbackSourceRef.current;
    if (!source) return;
    document.transaction(() => {
      document.setConfirmedVersion(source.version ? { ...source.version, estimate_projects: null } : null);
      if (document.getSnapshot().confirmedItems.length === 0) {
        document.acceptItems(source.items, source.deriveBufferedItem);
      } else {
        document.setDraftItems(source.items);
      }
      document.setDraftSettings(source.settings);
    });
  }, [document, fallbackKey]);

  useLayoutEffect(() => {
    const saveSession = saveSessionRef.current;
    routeVersionIdRef.current = routeVersionId;
    saveSession.reset();
    hadDraftLockOwnershipRef.current = false;

    return () => {
      saveSession.reset();
    };
  }, [currentTenantId, currentUserId, routeVersionId]);

  useLayoutEffect(() => {
    savePendingSettingsRef.current = savePendingSettings;
    deriveBufferedItemRef.current = deriveBufferedItem;
  }, [deriveBufferedItem, savePendingSettings]);

  const updateHasPendingTotalsSave = useCallback((value: boolean) => {
    hasPendingTotalsSaveRef.current = value;
    setHasPendingTotalsSave(value);
  }, []);

  const persistBufferedItemUpdatesToLocal = useCallback(() => {
    if (!routeVersionId) return;
    const scope = document.captureScope();
    if (scope.versionId.toLowerCase() !== routeVersionId.toLowerCase() ||
        scope.actorId?.toLowerCase() !== currentUserId?.toLowerCase() ||
        scope.tenantId?.toLowerCase() !== currentTenantId?.toLowerCase()) return;
    const bufferedEntries = serializeBufferedUpdates(new Map(document.getUnsavedUpdates()));
    writeDocumentAutoSaveDraft(
      scope,
      bufferedEntries.map((entry) => ({
        id: entry.id,
        updates: entry.updates,
      }))
    );
  }, [currentTenantId, currentUserId, document, routeVersionId]);

  const mutationObserverRef = useRef({
    getVersionSnapshot, applyVersionFlushResult,
    persistBufferedItemUpdatesToLocal, setTotalsOutOfSync, currentUserId, currentTenantId,
  });
  useLayoutEffect(() => {
    pendingSettingsRef.current = hasPendingSettingsChanges;
    savingSettingsRef.current = isSavingSettings;
    mutationObserverRef.current = {
      getVersionSnapshot, applyVersionFlushResult,
      persistBufferedItemUpdatesToLocal, setTotalsOutOfSync, currentUserId, currentTenantId,
    };
  });
  // Lazy recovery content can hide the editor with Suspense. Its layout-effect
  // cleanup is visibility work, not the end of this actor/tenant/version lifetime.
  useEffect(() => {
    mutationLifetimeRef.current += 1;
    restoredConflictDraftRef.current = false;
    readRequiredMessageRef.current = null;
    recoveryReloadMessageRef.current = null;
    isRecoveringReadRef.current = false;
    recoveryReloadInFlightRef.current = false;
    setHasPendingMutations(false);
    setReadRequiredMessage(null);
    setRecoveryReloadMessage(null);
    setIsRecoveringRead(false);
    setIsReloadingVersion(false);
    const getCurrentVersionSnapshot = () => {
      const observer = mutationObserverRef.current;
      if (!document.isCurrent(documentScope) || !currentUserId || !currentTenantId ||
          observer.currentUserId?.toLowerCase() !== currentUserId ||
          observer.currentTenantId?.toLowerCase() !== currentTenantId ||
          routeVersionIdRef.current !== routeVersionId) return null;
      const snapshot = observer.getVersionSnapshot();
      return snapshot?.id.toLowerCase() === routeVersionId && snapshot.tenant_id.toLowerCase() === currentTenantId
        ? snapshot : null;
    };
    const unregister = registerEstimateEditorMutations(routeVersionId, {
      getIdentity: () => {
        const version = getCurrentVersionSnapshot();
        return currentUserId && version?.id.toLowerCase() === routeVersionId && version.tenant_id
          ? { actorId: currentUserId, tenantId: version.tenant_id, versionId: routeVersionId } : null;
      },
      getToken: () => {
        const version = getCurrentVersionSnapshot();
        return version?.id.toLowerCase() === routeVersionId ? version.updated_at : null;
      },
      getRevision: () => getCurrentVersionSnapshot()?.content_revision,
      onPendingChange: setHasPendingMutations,
      onReadRequiredChange: (message) => {
        if (!getCurrentVersionSnapshot()) return;
        readRequiredMessageRef.current = message;
        if (message !== null) isSaveBlockedRef.current = true;
        setReadRequiredMessage(message);
      },
      onCommit: ({ version, deletedIds, structural, needsReload, totals, deferVersionPublication }) => {
        const snapshot = getCurrentVersionSnapshot();
        if (!snapshot || version.id.toLowerCase() !== routeVersionId ||
            isOlderEstimateVersionToken(version.updated_at, snapshot.updated_at)) return;
        if (needsReload) {
          const message = "Le résultat est confirmé. Relisez le devis avant de poursuivre ; vos saisies locales sont conservées.";
          recoveryReloadMessageRef.current = message;
          isSaveBlockedRef.current = true;
          setRecoveryReloadMessage(message);
        }
        document.transaction(() => {
          if (!deferVersionPublication) {
            mutationObserverRef.current.applyVersionFlushResult({
              versionId: version.id, updatedAt: version.updated_at, totalsPatch: totals,
              ...(version.content_revision === undefined ? {} : { contentRevision: version.content_revision }),
            });
          }
          if (deletedIds?.length) document.confirmDeletedItems(deletedIds, documentScope, version);
        });
        if (deletedIds?.length) {
          pendingBufferedUpdateCountRef.current = pendingItemUpdatesRef.current.size;
          mutationObserverRef.current.persistBufferedItemUpdatesToLocal();
        }
        if (structural) {
          structuralGenerationRef.current += 1;
          const needsTotalsSave = (!totals && writesEditorTotals(snapshot)) || pendingItemUpdatesRef.current.size > 0 || pendingSettingsRef.current;
          updateHasPendingTotalsSave(needsTotalsSave);
          mutationObserverRef.current.setTotalsOutOfSync(needsTotalsSave);
        }
      },
    });
    return () => {
      mutationLifetimeRef.current += 1;
      unregister();
    };
  }, [currentTenantId, currentUserId, document, documentScope, pendingItemUpdatesRef, routeVersionId, updateHasPendingTotalsSave]);

  const clearBufferedItemUpdates = useCallback(
    (options?: { clearPersisted?: boolean }) => {
      if (!document.isCurrent(documentScope)) return;
      if (options?.clearPersisted) document.discardItemDraft();
      else document.clearPending();
      pendingBufferedUpdateCountRef.current = 0;
      updateHasPendingTotalsSave(false);
      if (options?.clearPersisted && routeVersionId) {
        clearDocumentAutoSaveDraft(documentScope);
      }
    },
    [document, documentScope, routeVersionId, updateHasPendingTotalsSave]
  );

  const markItemsSynced = useCallback(
    (entries: ReadonlyArray<{ id: string; updates: EstimateItemUpdatePayload }>) => {
      if (!document.isCurrent(documentScope)) return;
      document.acknowledgeItems(entries);
      pendingBufferedUpdateCountRef.current = document.getPendingUpdates().size;
      persistBufferedItemUpdatesToLocal();
    },
    [document, documentScope, persistBufferedItemUpdatesToLocal]
  );

  /** The document owns both the accepted server baseline and its local overlay. */
  const overlayPendingUpdates = useCallback((sourceItems: EditorEstimateItem[]) => {
    if (!document.isCurrent(documentScope)) return document.getSnapshot().items;
    const next = document.acceptItems(sourceItems, deriveBufferedItemRef.current);
    pendingBufferedUpdateCountRef.current = document.getPendingUpdates().size;
    persistBufferedItemUpdatesToLocal();
    return next;
  }, [document, documentScope, persistBufferedItemUpdatesToLocal]);

  useEffect(() => {
    if (!routeVersionId) return;
    const scope = document.captureScope();
    return deferEffectStateUpdate(() => {
      if (!document.isCurrent(scope)) return;
      const draft = readDocumentAutoSaveDraft<EstimateItemUpdatePayload>(scope);
      if (!draft) return;
      // Legacy standalone consumers provide their rows directly. A shared owner
      // has already retained its confirmed document, previews and in-flight data.
      if (!suppliedDocument) document.setDraftItems(itemsRef.current);
      document.replacePending(draft.buffered_updates);
      pendingBufferedUpdateCountRef.current = document.getPendingUpdates().size;
      replaceItems(document.getSnapshot().items);
      if (document.getPendingUpdates().size > 0) {
        setTotalsOutOfSync(true);
        reportError("Des modifications locales ont été récupérées. Elles restent en attente de synchronisation.");
      }
    });
  }, [document, suppliedDocument, replaceItems, reportError, routeVersionId, setTotalsOutOfSync]);

  const registerVersionConflict = useCallback(
    (error: unknown) => {
      if (!isVersionConflictError(error) || !isEstimateApiError(error)) {
        return false;
      }
      if (!document.isCurrent(documentScope) || routeVersionIdRef.current !== routeVersionId) {
        return true;
      }

      const message = resolveErrorMessage(error.message);
      conflictMessageRef.current = message;
      setConflict({
        message,
        details: error.details,
      });
      reportError(message);
      return true;
    },
    [document, documentScope, reportError, resolveErrorMessage, routeVersionId]
  );

  useEffect(() => {
    return deferEffectStateUpdate(() => {
      if (!document.isCurrent(documentScope)) return;
      reportNotice(hasUnownedDocumentDraft(documentScope) ? UNOWNED_DOCUMENT_DRAFT_MESSAGE : null);
      setRestorableDraft(readDocumentConflictDraft<EstimateSettingsState, EstimateItem>(documentScope));
    });
  }, [document, documentScope, reportNotice]);

  const persistConflictDraft = useCallback(() => {
    if (!routeVersionId || !document.isCurrent(documentScope)) return;
    const storedSnapshot = document.getSnapshot();
    if (storedSnapshot.version?.id !== routeVersionId) return;

    const draft: EstimateEditorConflictDraft = {
      settings: storedSnapshot.settings,
      items: storedSnapshot.items,
      saved_at: new Date().toISOString(),
    };

    writeDocumentConflictDraft(documentScope, draft);
    restoredConflictDraftRef.current = false;
    setRestorableDraft(draft);
  }, [document, documentScope, routeVersionId]);

  const triggerVersionReload = useCallback(() => {
    if (!routeVersionId || !document.isCurrent(documentScope) || routeVersionIdRef.current !== routeVersionId) return;
    setIsReloadingVersion(true);
    setReloadToken((previous) => previous + 1);
  }, [document, documentScope, routeVersionId]);

  const batchRecovery = useEstimateBatchRecovery({
    versionId: routeVersionId, actorId: currentUserId, tenantId: activeVersion?.tenant_id ?? null,
    updatePending: (update) => {
      if (document.isCurrent(documentScope)) document.updatePending(update);
    },
    triggerReload: triggerVersionReload, reportError, reportNotice,
    onBufferedChanges: () => {
      pendingBufferedUpdateCountRef.current = pendingItemUpdatesRef.current.size;
      updateHasPendingTotalsSave(pendingItemUpdatesRef.current.size > 0);
      persistBufferedItemUpdatesToLocal();
      clearHistory();
    },
  });
  const { finishReload: finishBatchReload } = batchRecovery;
  const verifyRequiredRead = useCallback(async () => {
    const lifetime = mutationLifetimeRef.current;
    const isCurrentLifetime = () => document.isCurrent(documentScope) && lifetime === mutationLifetimeRef.current &&
      routeVersionIdRef.current === routeVersionId &&
      mutationObserverRef.current.currentUserId === currentUserId &&
      mutationObserverRef.current.currentTenantId === currentTenantId;
    if (!isCurrentLifetime() || isRecoveringReadRef.current || recoveryReloadInFlightRef.current) return;
    if (recoveryReloadMessageRef.current && !readRequiredMessageRef.current) {
      recoveryReloadInFlightRef.current = true;
      triggerVersionReload();
      return;
    }
    isRecoveringReadRef.current = true;
    setIsRecoveringRead(true);
    try {
      if (await recoverEstimateEditorRead(routeVersionId) && isCurrentLifetime()) {
        if (recoveryReloadMessageRef.current) {
          recoveryReloadInFlightRef.current = true;
          triggerVersionReload();
        } else {
          reportNotice("Le devis est relu. Vos saisies locales sont conservées.");
        }
      }
    } catch {
      if (isCurrentLifetime()) reportError("La lecture du devis reste interrompue. Réessayez la vérification ; vos saisies sont conservées.");
    } finally {
      if (isCurrentLifetime()) {
        isRecoveringReadRef.current = false;
        setIsRecoveringRead(false);
      }
    }
  }, [currentTenantId, currentUserId, document, documentScope, reportError, reportNotice, routeVersionId, triggerVersionReload]);
  const visibleRecovery = useMemo(() => readRequiredMessage || recoveryReloadMessage ? {
    blocked: true, message: readRequiredMessage ?? recoveryReloadMessage, canResume: false,
    isBusy: isRecoveringRead || Boolean(recoveryReloadMessage && isReloadingVersion), verify: verifyRequiredRead,
  } : batchRecovery, [batchRecovery, isRecoveringRead, isReloadingVersion, readRequiredMessage, recoveryReloadMessage, verifyRequiredRead]);
  const markVersionReloadFinished = useCallback((succeeded = true) => {
    if (!document.isCurrent(documentScope) || routeVersionIdRef.current !== routeVersionId ||
      mutationObserverRef.current.currentUserId !== currentUserId ||
      mutationObserverRef.current.currentTenantId !== currentTenantId) return;
    setIsReloadingVersion(false);
    finishBatchReload(succeeded);
    recoveryReloadInFlightRef.current = false;
    if (!recoveryReloadMessageRef.current) return;
    if (succeeded) {
      recoveryReloadMessageRef.current = null;
      setRecoveryReloadMessage(null);
      reportNotice("Le devis est relu. Vos saisies locales sont conservées.");
    } else {
      const message = "La lecture complète du devis reste interrompue. Réessayez la vérification ; vos saisies locales sont conservées.";
      recoveryReloadMessageRef.current = message;
      isSaveBlockedRef.current = true;
      setRecoveryReloadMessage(message);
    }
  }, [currentTenantId, currentUserId, document, documentScope, finishBatchReload, reportNotice, routeVersionId]);

  const handleVersionConflict = useCallback(
    (error: unknown, options?: { persistDraft?: boolean }) => {
      if (!document.isCurrent(documentScope)) return isVersionConflictError(error);
      if (!registerVersionConflict(error)) return false;
      if (options?.persistDraft) {
        persistConflictDraft();
      }
      if (!document.isCurrent(documentScope) || routeVersionIdRef.current !== routeVersionId) {
        return true;
      }
      clearBufferedItemUpdates({ clearPersisted: true });
      triggerVersionReload();
      return true;
    },
    [
      clearBufferedItemUpdates,
      document,
      documentScope,
      persistConflictDraft,
      registerVersionConflict,
      routeVersionId,
      triggerVersionReload,
    ]
  );

  const clearConflictState = useCallback(() => {
    if (!document.isCurrent(documentScope)) return;
    const message = conflictMessageRef.current;
    conflictMessageRef.current = null;
    setConflict(null);
    if (message !== null) reportError((current) => current === message ? null : current);
  }, [document, documentScope, reportError]);

  const clearConflictDraft = useCallback((options?: { onlyIfRestored?: boolean }) => {
    if (!document.isCurrent(documentScope)) return;
    // Saving unrelated work must not discard an unrestored recovery draft.
    if (options?.onlyIfRestored &&
        (!restoredConflictDraftRef.current || pendingItemUpdatesRef.current.size > 0)) return;
    clearDocumentConflictDraft(documentScope);
    restoredConflictDraftRef.current = false;
    setRestorableDraft(null);
    reportNotice(null);
  }, [document, documentScope, pendingItemUpdatesRef, reportNotice]);

  const reloadAfterConflict = useCallback(() => {
    if (!routeVersionId || !document.isCurrent(documentScope)) return;

    persistConflictDraft();
    setConflict(null);
    reportError(null);
    triggerVersionReload();
  }, [document, documentScope, persistConflictDraft, reportError, routeVersionId, triggerVersionReload]);


  const hasMatchingActiveVersion = activeVersion?.id.toLowerCase() === routeVersionId;
  const isDraftVersion =
    hasMatchingActiveVersion && activeVersion?.status === "draft";
  const {
    holderName: activeDraftLockHolderName,
    isOwnedByCurrentUser: isActiveDraftLockOwnedByCurrentUser,
    isLockedByOther: isActiveDraftLockedByOther,
    isAcquiring: isActiveDraftLockAcquiring,
    isForcingUnlock: isActivelyForcingDraftUnlock,
    error: activeDraftLockError,
    acquire: reacquireDraftLock,
    release: releaseDraftLock,
    forceUnlockAndAcquire: forceUnlockAndAcquireDraftLock,
  } = useDraftLock({
    versionId: routeVersionId,
    enabled: Boolean(routeVersionId && isDraftVersion),
    currentUserId,
  });

  const runWithDraftLockRecovery = useCallback(
    async <T>(operation: () => Promise<T>): Promise<T> => {
      try {
        return await operation();
      } catch (error) {
        if (!isDraftLockRequiredError(error) || !document.isCurrent(documentScope)) throw error;
        const acquired = await reacquireDraftLock();
        if (!acquired || !document.isCurrent(documentScope)) throw error;
        return operation();
      }
    },
    [document, documentScope, reacquireDraftLock]
  );
  const draftLockHolderName = isDraftVersion
    ? activeDraftLockHolderName
    : null;
  const isDraftLockOwnedByCurrentUser = Boolean(
    isDraftVersion && isActiveDraftLockOwnedByCurrentUser
  );
  const isDraftLockedByOther = Boolean(
    isDraftVersion && isActiveDraftLockedByOther
  );
  const isDraftLockAcquiring = Boolean(
    isDraftVersion && isActiveDraftLockAcquiring
  );
  const isForcingDraftUnlock = Boolean(
    isDraftVersion && isActivelyForcingDraftUnlock
  );
  const draftLockError = isDraftVersion ? activeDraftLockError : null;

  const lockHolderLabel = draftLockHolderName ?? "un autre utilisateur";
  const isStatusReadOnly = activeVersion
    ? !hasMatchingActiveVersion || activeVersion.status !== "draft"
    : false;
  const isDraftLockPending =
    isDraftVersion &&
    !isDraftLockedByOther &&
    !isDraftLockOwnedByCurrentUser;
  const isReadOnly =
    batchRecovery.blocked || batchRecovery.isBusy ||
    isStatusReadOnly ||
    isDraftLockedByOther ||
    isDraftLockPending ||
    isViewerReadOnly;
  const isConflictLocked = conflict !== null;
  const isSaveBlocked = isReadOnly || isConflictLocked || readRequiredMessage !== null ||
    recoveryReloadMessage !== null || isRecoveringRead;
  const readOnlyActionErrorMessage = batchRecovery.blocked
    ? "Vérifiez le résultat de l'opération précédente avant de modifier ce devis."
    : isViewerReadOnly
    ? "Mode consultation activé."
    : isDraftLockPending && !isDraftLockedByOther
      ? "Acquisition du verrou de brouillon en cours."
      : isDraftLockedByOther
        ? `Verrouillé par ${lockHolderLabel}.`
        : "Cette version est en lecture seule.";

  useEffect(() => {
    isSaveBlockedRef.current = isSaveBlocked || readRequiredMessageRef.current !== null ||
      recoveryReloadMessageRef.current !== null;
  }, [isSaveBlocked]);

  const forceUnlockDraftLock = useCallback(async () => {
    if (!document.isCurrent(documentScope)) return;
    reportError(null);
    if (!isDraftVersion) {
      reportError("Version de brouillon introuvable.");
      return;
    }

    const acquired = await forceUnlockAndAcquireDraftLock();
    if (!document.isCurrent(documentScope)) return;
    if (!acquired) {
      reportError(
        draftLockError ??
          "Impossible de forcer le déverrouillage de cette version."
      );
      return;
    }

    setConflict(null);
    reportError(null);
    reportNotice(null);
    if (
      pendingItemUpdatesRef.current.size === 0 &&
      !hasPendingTotalsSaveRef.current
    ) {
      setTotalsOutOfSync(false);
    }
    triggerVersionReload();
  }, [
    document,
    documentScope,
    draftLockError,
    forceUnlockAndAcquireDraftLock,
    isDraftVersion,
    pendingItemUpdatesRef,
    reportError,
    reportNotice,
    setTotalsOutOfSync,
    triggerVersionReload,
  ]);

  /**
   * Reprise du verrou par une autre page : la version a tres probablement change
   * sous nos pieds. On recharge immediatement depuis le serveur au lieu
   * d'attendre l'echec de la prochaine ecriture, qui afficherait un conflit de
   * version alors que l'utilisateur n'a rien fait de mal. Les modifications
   * locales non synchronisees restent dans le tampon et sont reappliquees par
   * `overlayPendingUpdates` apres le rechargement.
   */
  useEffect(() => {
    if (isDraftLockOwnedByCurrentUser) {
      hadDraftLockOwnershipRef.current = true;
      return;
    }

    if (!hadDraftLockOwnershipRef.current) return;
    hadDraftLockOwnershipRef.current = false;

    if (!isDraftVersion) return;

    setConflict(null);
    triggerVersionReload();
  }, [isDraftLockOwnedByCurrentUser, isDraftVersion, triggerVersionReload]);

  const flushBufferedItemUpdates = useCallback(async (forceTotals = false): Promise<AutoSaveResult> => {
    if (!document.isCurrent(documentScope)) return "blocked";
    if (forceTotals && restorableDraft && !restoredConflictDraftRef.current) {
      return "blocked";
    }
    if (saveSessionRef.current.isSaving) {
      const generation = saveSessionRef.current.generation;
      await saveSessionRef.current.completion;
      if (generation !== saveSessionRef.current.generation) return "blocked";
      return flushBufferedItemUpdates(forceTotals);
    }
    if (hasEstimateEditorMutations(routeVersionId)) {
      const generation = saveSessionRef.current.generation;
      await waitForEstimateEditorMutations(routeVersionId);
      if (generation !== saveSessionRef.current.generation) return "blocked";
      // Read the buffer only after successful deletions have removed their IDs.
      return flushBufferedItemUpdates(forceTotals);
    }

    const hasPendingAutoSaveWork =
      pendingItemUpdatesRef.current.size > 0 ||
      hasPendingTotalsSaveRef.current;
    if (isSaveBlockedRef.current) {
      return hasPendingAutoSaveWork ? "blocked" : "noop";
    }

    const versionSnapshot = getVersionSnapshot();
    if (!versionSnapshot || versionSnapshot.id.toLowerCase() !== routeVersionId) {
      return hasPendingAutoSaveWork ? "blocked" : "noop";
    }

    const bufferedEntries = serializeBufferedUpdates(new Map(document.getPendingUpdates()));
    const versionTotalsPatch = buildVersionTotalsPatch(getPersistedTotals());
    const forceV2Totals = forceTotals && reconcilesEditorTotals(versionSnapshot);
    if (forceV2Totals && !versionTotalsPatch) return "blocked";
    const reconcileTotals = forceV2Totals && versionTotalsPatch && (
      versionTotalsPatch.total_ht_cents !== versionSnapshot.total_ht_cents ||
      versionTotalsPatch.total_tax_cents !== versionSnapshot.total_tax_cents ||
      versionTotalsPatch.total_ttc_cents !== versionSnapshot.total_ttc_cents
    );
    if (bufferedEntries.length === 0 && !hasPendingTotalsSaveRef.current && !reconcileTotals) {
      return "noop";
    }

    const capture = document.captureSave();
    pendingBufferedUpdateCountRef.current = 0;

    const saveSession = saveSessionRef.current;
    const attempt = saveSession.start();
    const flushVersionId = versionSnapshot.id;
    const structuralGeneration = structuralGenerationRef.current;
    let receipt: EstimateLineSaveReceipt | null = null;
    const isCurrentFlush = () => saveSession.isCurrent(attempt) && document.isCurrent(capture.scope) &&
      routeVersionIdRef.current === flushVersionId.toLowerCase();

    try {
      receipt = await saveEstimateEditorLines({
        version: versionSnapshot,
        operations: bufferedEntries.map((entry) => ({
          op: "update", id: entry.id, data: toEngineItemWrite(entry.updates, versionSnapshot),
        })),
        totals: versionTotalsPatch,
        withDraftLockRecovery: runWithDraftLockRecovery,
      });

      if (!isCurrentFlush()) {
        return "saved";
      }

      const structureChanged = structuralGeneration !== structuralGenerationRef.current;
      updateHasPendingTotalsSave(structureChanged);
      setTotalsOutOfSync(structureChanged);
      const confirmedReceipt = receipt;
      document.transaction(() => {
        document.acceptSave(capture, confirmedReceipt.version.updated_at);
        applyVersionFlushResult({ versionId: flushVersionId, totalsPatch: confirmedReceipt.totals, updatedAt: confirmedReceipt.version.updated_at,
          results: confirmedReceipt.results, ...(confirmedReceipt.version.content_revision === undefined ? {} : { contentRevision: confirmedReceipt.version.content_revision }) });
      });
      // Une sauvegarde réussie invalide les anciens messages de navigation ou
      // de synchronisation. Sans ce reset, le ruban peut afficher « Sauvegardé »
      // tout en conservant une alerte rouge devenue fausse.
      reportError(null);
      persistBufferedItemUpdatesToLocal();
      if (
        pendingItemUpdatesRef.current.size === 0 &&
        !pendingSettingsRef.current &&
        restoredConflictDraftRef.current
      ) {
        clearDocumentConflictDraft(capture.scope);
        restoredConflictDraftRef.current = false;
        setRestorableDraft(null);
        reportNotice(null);
      }
      if (receipt.linesCommitted) clearHistory();
      return "saved";
    } catch (error) {
      if (!isCurrentFlush()) {
        if (!receipt?.linesCommitted) {
          const persistedDraft =
            readDocumentAutoSaveDraft<EstimateItemUpdatePayload>(capture.scope);
          const restoredEntries = new Map<string, EstimateItemUpdatePayload>();
          bufferedEntries.forEach((entry) => {
            upsertBufferedUpdate(restoredEntries, entry.id, entry.updates);
          });
          persistedDraft?.buffered_updates.forEach((entry) => {
            upsertBufferedUpdate(restoredEntries, entry.id, entry.updates);
          });
          writeDocumentAutoSaveDraft(
            capture.scope,
            serializeBufferedUpdates(restoredEntries)
          );
        }
        return "blocked";
      }

      if (receipt?.linesCommitted) {
        const confirmedReceipt = receipt;
        document.transaction(() => {
          document.acceptSave(capture, confirmedReceipt.version.updated_at);
          applyVersionFlushResult({ versionId: flushVersionId, totalsPatch: undefined, updatedAt: confirmedReceipt.version.updated_at,
            results: confirmedReceipt.results,
            ...(confirmedReceipt.version.content_revision === undefined ? {} : { contentRevision: confirmedReceipt.version.content_revision }) });
        });
        updateHasPendingTotalsSave(Boolean(versionTotalsPatch));
        clearHistory();
      } else {
        document.rejectSave(capture);
        pendingBufferedUpdateCountRef.current += bufferedEntries.length;
        if (bufferedEntries.length === 0 && versionTotalsPatch) {
          updateHasPendingTotalsSave(true);
        }
      }

      persistBufferedItemUpdatesToLocal();

      if (handleVersionConflict(error, { persistDraft: true })) {
        return "blocked";
      }

      setTotalsOutOfSync(true);
      reportError(
        receipt?.linesCommitted
          ? "Les lignes sont enregistrées, mais les totaux n’ont pas pu être synchronisés. Une nouvelle tentative va être effectuée."
          : resolveErrorMessage(
              error instanceof Error
                ? error.message
                : "Impossible de mettre à jour les lignes."
            )
      );
      return "error";
    } finally {
      saveSession.finish(attempt);
    }
  }, [
    applyVersionFlushResult,
    clearHistory,
    getPersistedTotals,
    getVersionSnapshot,
    handleVersionConflict,
    document,
    documentScope,
    pendingItemUpdatesRef,
    persistBufferedItemUpdatesToLocal,
    reportError,
    reportNotice,
    resolveErrorMessage,
    restorableDraft,
    runWithDraftLockRecovery,
    routeVersionId,
    setTotalsOutOfSync,
    updateHasPendingTotalsSave,
  ]);

  const hasPendingAutoSaveChanges =
    hasPendingBufferedUpdates || documentSnapshot.inFlightCount > 0 || hasPendingTotalsSave;
  const hasPendingChanges =
    hasPendingAutoSaveChanges || hasPendingSettingsChanges || hasPendingMutations;
  const {
    autoSaveStatus,
    autoSaveStatusLabel,
    isAutoSaveSaving,
    isOnline,
    lastSavedAt,
    flushAutoSaveNow,
    scheduleAutoSave,
    isAutoSaveEnabled,
    isAutoSaveEnabledRef,
    setAutoSaveEnabled,
  } = useEstimateEditorAutoSave({
    routeVersionId,
    currentUserId,
    reportNotice,
    hasMatchingActiveVersion,
    isSaveBlocked,
    isSaveBlockedRef,
    hasPendingAutoSaveChanges,
    hasPendingChanges,
    hasPendingSettingsChanges,
    hasPendingMutations,
    isSavingSettings,
    allowManualTotalsReconciliation,
    isDraftVersion,
    restorableDraft: Boolean(restorableDraft),
    flushBufferedItemUpdates,
    pendingItemUpdatesRef,
    hasPendingTotalsSaveRef,
    savePendingSettingsRef,
    requiresReadVerification: Boolean(readRequiredMessage || recoveryReloadMessage || batchRecovery.blocked),
    isConflictLocked,
    isDraftLockedByOther,
    isDraftLockPending,
  });

  const handleBlockedNavigation = useCallback(() => {
    reportError(
      "La sauvegarde n’a pas abouti. Vos modifications sont conservées sur cette page. Réessayez la sauvegarde avant de quitter."
    );
  }, [reportError]);

  const saveBeforeNavigation = useCallback(async () => {
    if (!document.isCurrent(documentScope)) return false;
    const generation = saveSessionRef.current.generation;
    const isCurrentNavigation = () => document.isCurrent(documentScope) && generation === saveSessionRef.current.generation;
    if (!isOnline || isSaveBlockedRef.current || restorableDraft) return false;
    await waitForEstimateEditorMutations(routeVersionId);
    if (!isCurrentNavigation()) return false;
    const result = await flushBufferedItemUpdates();
    if (!isCurrentNavigation() || result === "error" || result === "blocked") return false;
    if (pendingSettingsRef.current || savingSettingsRef.current) {
      const saved = await savePendingSettingsRef.current();
      if (!isCurrentNavigation() || saved !== true) return false;
      // Settings inputs are disabled for this operation. Its completed promise
      // is authoritative even before React commits the matching clean state.
      pendingSettingsRef.current = false;
      savingSettingsRef.current = false;
    }
    // New edits may arrive while the first request is in flight.
    const finalResult = await flushBufferedItemUpdates();
    return isCurrentNavigation() &&
      finalResult !== "error" && finalResult !== "blocked" &&
      pendingItemUpdatesRef.current.size === 0 &&
      !hasPendingTotalsSaveRef.current && !pendingSettingsRef.current &&
      !savingSettingsRef.current && !hasEstimateEditorMutations(routeVersionId);
  }, [document, documentScope, flushBufferedItemUpdates, isOnline, pendingItemUpdatesRef, restorableDraft, routeVersionId]);

  useAutoSaveNavigationGuard({
    enabled: Boolean(routeVersionId),
    hasPendingChanges,
    isSaving: isAutoSaveSaving || isSavingSettings,
    onBlockedNavigation: handleBlockedNavigation,
    onBeforeNavigation: saveBeforeNavigation,
    onNavigate: navigate,
  });

  const enqueueItemUpdate = useCallback(
    (itemId: string, payload: EstimateItemUpdatePayload) => {
      if (!document.isCurrent(documentScope)) return;
      if (!document.enqueueItem(itemId, payload)) return;
      persistBufferedItemUpdatesToLocal();

      pendingBufferedUpdateCountRef.current += 1;
      if (
        isAutoSaveEnabledRef.current &&
        shouldFlushBufferedUpdates(
          pendingBufferedUpdateCountRef.current,
          AUTOSAVE_IMMEDIATE_FLUSH_UPDATES
        )
      ) {
        void flushAutoSaveNow();
        return;
      }

      scheduleAutoSave();
    },
    [document, documentScope, flushAutoSaveNow, isAutoSaveEnabledRef, persistBufferedItemUpdatesToLocal, scheduleAutoSave]
  );

  const restoreConflictDraft = useCallback(() => {
    if (!restorableDraft || !document.isCurrent(documentScope)) return;
    restoredConflictDraftRef.current = true;

    const { restoredItems, skippedItemCount, buildItemPayload, settingsRestored } =
      applyRestoredDraft(restorableDraft);
    restoredItems.forEach((item) => {
      enqueueItemUpdate(item.id, {
        ...(buildItemPayload ?? buildEstimateItemUpdatePayload)(item), // 2.6b (A14) : charge v3 sur une v3
        parent_id: item.parent_id ?? null,
        position: item.position,
      });
    });
    if (restoredItems.length > 0) {
      setTotalsOutOfSync(true);
    }

    setRestorableDraft(null);
    reportError(null);
    reportNotice(
      skippedItemCount > 0
        ? "Les modifications des lignes encore présentes ont été restaurées. Certaines différences de structure n’ont pas été réappliquées afin de préserver les données serveur."
        : `Modifications locales restaurées. Les lignes restent en attente de synchronisation${settingsRestored === false ? "" : " ; enregistrez le paramétrage pour confirmer les réglages"}.`
    );
  }, [
    applyRestoredDraft,
    document,
    documentScope,
    enqueueItemUpdate,
    reportError,
    reportNotice,
    restorableDraft,
    setTotalsOutOfSync,
  ]);

  const ensureGroupedActionCanProceed = useCallback(
    async (
      actionLabel: string,
      options?: { allowPendingSettings?: boolean }
    ) => {
      if (!document.isCurrent(documentScope)) return false;
      if (hasPendingSettingsChanges && !options?.allowPendingSettings) {
        reportError(
          `Le paramétrage comporte des modifications non enregistrées. Enregistrez-le avant l’action « ${actionLabel} ».`
        );
        return false;
      }

      if (saveSessionRef.current.isSaving) {
        reportError(
          "Synchronisation des modifications en cours. Réessayez dans quelques secondes."
        );
        return false;
      }

      const flushResult = await flushBufferedItemUpdates();
      if (!document.isCurrent(documentScope)) return false;

      if (flushResult === "blocked") {
        reportError(
          `Impossible de ${actionLabel} tant que les modifications locales ne sont pas synchronisées. Rechargez la version puis réessayez.`
        );
        return false;
      }

      if (flushResult === "error") {
        reportError(
          `Impossible de synchroniser les modifications locales avant de ${actionLabel}. Corrigez les erreurs puis réessayez.`
        );
        return false;
      }

      if (
        flushResult === "noop" &&
        (pendingItemUpdatesRef.current.size > 0 ||
          hasPendingTotalsSaveRef.current)
      ) {
        reportError(
          "Synchronisation des modifications en cours. Réessayez dans quelques secondes."
        );
        return false;
      }

      return true;
    },
    [document, documentScope, flushBufferedItemUpdates, hasPendingSettingsChanges, pendingItemUpdatesRef, reportError]
  );

  const saveNow = useCallback(async () => {
    await flushAutoSaveNow();
  }, [flushAutoSaveNow]);
  const retryTotalsSave = saveNow;

  const isFlushInProgress = useCallback(
    () => saveSessionRef.current.isSaving,
    []
  );

  const hasPendingUpdatesNow = useCallback(
    () =>
      pendingItemUpdatesRef.current.size > 0 || document.getSnapshot().inFlightCount > 0 ||
      hasPendingTotalsSaveRef.current,
    [document, pendingItemUpdatesRef]
  );

  useEffect(() => {
    const scope = document.captureScope();
    const saveSession = saveSessionRef.current;
    return () => {
      saveSession.reset();
      if (document.isCurrent(scope)) {
        persistBufferedItemUpdatesToLocal();
        // A shared document owns its lifetime; only the standalone fallback is
        // discarded here. A stale cleanup cannot erase another actor's draft.
        if (!suppliedDocument) document.clearPending();
      }
      pendingBufferedUpdateCountRef.current = 0;
      hasPendingTotalsSaveRef.current = false;
      setHasPendingTotalsSave(false);
    };
  }, [document, suppliedDocument, persistBufferedItemUpdatesToLocal]);

  const state = useMemo(
    () => ({
      batchRecovery: visibleRecovery,
      autoSaveStatus,
      autoSaveStatusLabel,
      isAutoSaveSaving,
      isAutoSaveEnabled,
      lastSavedAt,
      hasPendingBufferedUpdates,
      hasPendingChanges,
      conflict,
      isReloadingVersion,
      hasRestorableDraft: Boolean(restorableDraft),
      draftLockHolderName,
      isDraftLockOwnedByCurrentUser,
      isDraftLockedByOther,
      isDraftLockAcquiring,
      isForcingDraftUnlock,
      draftLockError,
    }),
    [
      visibleRecovery,
      autoSaveStatus,
      autoSaveStatusLabel,
      conflict,
      draftLockError,
      draftLockHolderName,
      hasPendingBufferedUpdates,
      hasPendingChanges,
      isAutoSaveEnabled,
      isAutoSaveSaving,
      isDraftLockAcquiring,
      isDraftLockOwnedByCurrentUser,
      isDraftLockedByOther,
      isForcingDraftUnlock,
      isReloadingVersion,
      lastSavedAt,
      restorableDraft,
    ]
  );

  const actions = useMemo(
    () => ({
      overlayPendingUpdates,
      enqueueItemUpdate,
      markItemsSynced,
      setAutoSaveEnabled,
      saveNow,
      flushBeforeExternalAction: saveBeforeNavigation,
      flushBufferedItemUpdates,
      ensureGroupedActionCanProceed,
      retryTotalsSave,
      recoverDraftLock: reacquireDraftLock,
      isFlushInProgress,
      hasPendingUpdatesNow,
      clearBufferedItemUpdates,
      registerVersionConflict,
      handleVersionConflict,
      clearConflictState,
      clearConflictDraft,
      triggerVersionReload,
      markVersionReloadFinished,
      reloadAfterConflict,
      restoreConflictDraft,
      forceUnlockDraftLock,
      releaseDraftLock,
    }),
    [
      clearBufferedItemUpdates,
      clearConflictDraft,
      clearConflictState,
      enqueueItemUpdate,
      ensureGroupedActionCanProceed,
      flushBufferedItemUpdates,
      forceUnlockDraftLock,
      handleVersionConflict,
      hasPendingUpdatesNow,
      isFlushInProgress,
      markItemsSynced,
      markVersionReloadFinished,
      overlayPendingUpdates,
      registerVersionConflict,
      releaseDraftLock,
      reloadAfterConflict,
      restoreConflictDraft,
      reacquireDraftLock,
      retryTotalsSave,
      saveNow,
      saveBeforeNavigation,
      setAutoSaveEnabled,
      triggerVersionReload,
    ]
  );

  const meta = useMemo(
    () => ({
      reloadToken,
      isStatusReadOnly,
      isDraftLockPending,
      isReadOnly,
      isConflictLocked,
      isSaveBlocked,
      isReadRecoveryRequired: readRequiredMessage !== null,
      readOnlyActionErrorMessage,
      lockHolderLabel,
    }),
    [
      isConflictLocked,
      isDraftLockPending,
      isReadOnly,
      isSaveBlocked,
      readRequiredMessage,
      isStatusReadOnly,
      lockHolderLabel,
      readOnlyActionErrorMessage,
      reloadToken,
    ]
  );

  return { state, actions, meta };
}
