"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { EstimateSettingsState } from "@/components/estimates/EstimateSettingsPanel";
import type { AutoSaveResult } from "@/hooks/useAutoSave";
import {
  deferEffectStateUpdate,
  useEstimateEditorAutoSave,
} from "@/hooks/useEstimateEditorAutoSave";
import { useAutoSaveNavigationGuard } from "@/hooks/useAutoSaveNavigationGuard";
import { useDraftLock } from "@/hooks/useDraftLock";
import { useEstimateBatchRecovery } from "@/hooks/useEstimateBatchRecovery";
import { createEstimateBatchAttempt } from "@/lib/estimates/batch-intentions";
import {
  applyBufferedUpdatesToItems,
  rehydrateBufferedUpdates,
  matchesSyncedItemPayload,
  serializeBufferedUpdates,
  shouldFlushBufferedUpdates,
  upsertBufferedUpdate,
} from "@/lib/estimates/bulk-buffer";
import {
  batchEstimateOperations,
  bulkUpdateEstimateItems,
  isEstimateApiError,
} from "@/lib/estimates/client";
import {
  clearAutoSaveDraftFromLocal,
  clearConflictDraftFromSession,
  readAutoSaveDraftFromLocal,
  readConflictDraftFromSession,
  writeAutoSaveDraftToLocal,
  writeConflictDraftToSession,
} from "@/lib/estimates/editor-drafts";
import {
  hasEstimateEditorMutations,
  registerEstimateEditorMutations,
  recoverEstimateEditorRead,
  waitForEstimateEditorMutations,
  type EditorMutationToken,
} from "@/lib/estimates/editor-mutations";
import {
  buildEstimateItemUpdatePayload,
  buildVersionTotalsPatch,
  withStableEditorClientKeys,
  type EditorEstimateItem,
  type EstimateItem,
  type EstimateItemUpdatePayload,
} from "@/lib/estimates/editor-items";
import { resolveCalcEngineVersion } from "@/lib/estimates/calc-engine-version";
import { isDraftLockRequiredError, isVersionConflictError } from "@/lib/estimates/editor-sync-errors";
import { isUnifiedEngine } from "@/lib/estimates/engine/capabilities";

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
  routeVersionId,
  activeVersion,
  currentUserId,
  currentTenantId,
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
  applyRestoredDraft,
  applyVersionFlushResult,
  setTotalsOutOfSync,
  clearHistory,
  reportError,
  reportNotice,
  resolveErrorMessage,
}: EstimateEditorSyncControllerInput): EstimateEditorSyncController {
  const [hasPendingBufferedUpdates, setHasPendingBufferedUpdates] =
    useState(false);
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

  const pendingItemUpdatesRef = useRef<
    Map<string, EstimateItemUpdatePayload>
  >(new Map());
  const pendingBufferedUpdateCountRef = useRef(0);
  const hasPendingTotalsSaveRef = useRef(false);
  const savePendingSettingsRef = useRef(savePendingSettings);
  const isFlushingBufferedUpdatesRef = useRef(false);
  const flushCompletionRef = useRef<Promise<void> | null>(null);
  const activeFlushIdRef = useRef(0);
  const routeVersionIdRef = useRef(routeVersionId);
  const routeGenerationRef = useRef(0);
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
  /** Dernier etat connu du serveur pour chaque ligne, par identifiant. */
  const syncedItemPayloadsRef = useRef(
    new Map<string, EstimateItemUpdatePayload>()
  );
  const draftSnapshotsByVersionRef = useRef(
    new Map<
      string,
      Pick<EstimateEditorConflictDraft, "items" | "settings">
    >()
  );

  useLayoutEffect(() => {
    itemsRef.current = items;
    if (activeVersion?.id === routeVersionId) {
      draftSnapshotsByVersionRef.current.set(routeVersionId, {
        items,
        settings,
      });
    }
  }, [activeVersion?.id, items, routeVersionId, settings]);

  useLayoutEffect(() => {
    routeVersionIdRef.current = routeVersionId;
    routeGenerationRef.current += 1;
    activeFlushIdRef.current += 1;
    isFlushingBufferedUpdatesRef.current = false;
    hadDraftLockOwnershipRef.current = false;

    return () => {
      routeGenerationRef.current += 1;
      activeFlushIdRef.current += 1;
      isFlushingBufferedUpdatesRef.current = false;
    };
  }, [currentTenantId, currentUserId, routeVersionId]);

  useLayoutEffect(() => {
    savePendingSettingsRef.current = savePendingSettings;
  }, [savePendingSettings]);

  const updateHasPendingTotalsSave = useCallback((value: boolean) => {
    hasPendingTotalsSaveRef.current = value;
    setHasPendingTotalsSave(value);
  }, []);

  const persistBufferedItemUpdatesToLocal = useCallback(() => {
    if (!routeVersionId) return;

    const bufferedEntries = serializeBufferedUpdates(
      pendingItemUpdatesRef.current
    );
    writeAutoSaveDraftToLocal(
      routeVersionId,
      bufferedEntries.map((entry) => ({
        id: entry.id,
        updates: entry.updates,
      }))
    );
  }, [routeVersionId]);

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
    syncedItemPayloadsRef.current.clear();
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
      if (!currentUserId || !currentTenantId ||
          observer.currentUserId !== currentUserId ||
          observer.currentTenantId !== currentTenantId ||
          routeVersionIdRef.current !== routeVersionId) return null;
      const snapshot = observer.getVersionSnapshot();
      return snapshot?.id === routeVersionId && snapshot.tenant_id === currentTenantId
        ? snapshot : null;
    };
    const unregister = registerEstimateEditorMutations(routeVersionId, {
      getIdentity: () => {
        const version = getCurrentVersionSnapshot();
        return currentUserId && version?.id === routeVersionId && version.tenant_id
          ? { actorId: currentUserId, tenantId: version.tenant_id, versionId: routeVersionId } : null;
      },
      getToken: () => {
        const version = getCurrentVersionSnapshot();
        return version?.id === routeVersionId ? version.updated_at : null;
      },
      getRevision: () => getCurrentVersionSnapshot()?.content_revision,
      onPendingChange: setHasPendingMutations,
      onReadRequiredChange: (message) => {
        if (!getCurrentVersionSnapshot()) return;
        readRequiredMessageRef.current = message;
        if (message !== null) isSaveBlockedRef.current = true;
        setReadRequiredMessage(message);
      },
      onCommit: ({ version, deletedIds, structural, needsReload, totals }) => {
        if (!getCurrentVersionSnapshot() || version.id !== routeVersionId) return;
        if (needsReload) {
          const message = "Le résultat est confirmé. Relisez le devis avant de poursuivre ; vos saisies locales sont conservées.";
          recoveryReloadMessageRef.current = message;
          isSaveBlockedRef.current = true;
          setRecoveryReloadMessage(message);
        }
        mutationObserverRef.current.applyVersionFlushResult({
          versionId: version.id, updatedAt: version.updated_at, totalsPatch: totals,
          ...(version.content_revision === undefined ? {} : { contentRevision: version.content_revision }),
        });
        if (deletedIds?.length) {
          deletedIds.forEach((id) => {
            pendingItemUpdatesRef.current.delete(id);
            syncedItemPayloadsRef.current.delete(id);
          });
          pendingBufferedUpdateCountRef.current = pendingItemUpdatesRef.current.size;
          setHasPendingBufferedUpdates(pendingItemUpdatesRef.current.size > 0);
          mutationObserverRef.current.persistBufferedItemUpdatesToLocal();
        }
        if (structural) {
          structuralGenerationRef.current += 1;
          const needsTotalsSave = !totals || pendingItemUpdatesRef.current.size > 0 || pendingSettingsRef.current;
          updateHasPendingTotalsSave(needsTotalsSave);
          mutationObserverRef.current.setTotalsOutOfSync(needsTotalsSave);
        }
      },
    });
    return () => {
      mutationLifetimeRef.current += 1;
      unregister();
    };
  }, [currentTenantId, currentUserId, routeVersionId, updateHasPendingTotalsSave]);

  const clearBufferedItemUpdates = useCallback(
    (options?: { clearPersisted?: boolean }) => {
      pendingItemUpdatesRef.current.clear();
      syncedItemPayloadsRef.current.clear();
      pendingBufferedUpdateCountRef.current = 0;
      setHasPendingBufferedUpdates(false);
      updateHasPendingTotalsSave(false);
      if (options?.clearPersisted && routeVersionId) {
        clearAutoSaveDraftFromLocal(routeVersionId);
      }
    },
    [routeVersionId, updateHasPendingTotalsSave]
  );

  const mergeSyncedItemPayload = useCallback(
    (itemId: string, payload: EstimateItemUpdatePayload) => {
      const syncedPayload = syncedItemPayloadsRef.current.get(itemId);
      syncedItemPayloadsRef.current.set(
        itemId,
        syncedPayload ? { ...syncedPayload, ...payload } : { ...payload }
      );
    },
    []
  );

  const pruneSyncedBufferedUpdates = useCallback(() => {
    let changed = false;
    for (const [itemId, payload] of pendingItemUpdatesRef.current) {
      if (!matchesSyncedItemPayload(syncedItemPayloadsRef.current.get(itemId), payload)) continue;
      pendingItemUpdatesRef.current.delete(itemId);
      changed = true;
    }
    if (!changed) return;
    pendingBufferedUpdateCountRef.current = pendingItemUpdatesRef.current.size;
    setHasPendingBufferedUpdates(pendingItemUpdatesRef.current.size > 0);
    persistBufferedItemUpdatesToLocal();
  }, [persistBufferedItemUpdatesToLocal]);

  /**
   * Lignes qu'une ecriture hors file d'attente (action en lot, son annulation
   * ou son retablissement) vient de faire accepter par le serveur. Sans cette
   * reference, une saisie qui revient a l'etat precedent serait jugee deja
   * synchronisee et ignoree.
   */
  const markItemsSynced = useCallback(
    (entries: ReadonlyArray<{ id: string; updates: EstimateItemUpdatePayload }>) => {
      entries.forEach((entry) => {
        mergeSyncedItemPayload(entry.id, entry.updates);
      });
      pruneSyncedBufferedUpdates();
    },
    [mergeSyncedItemPayload, pruneSyncedBufferedUpdates]
  );

  /**
   * Les lignes recues ici sortent du serveur : elles constituent la reference
   * a partir de laquelle une modification locale est reconnue comme telle.
   */
  const overlayPendingUpdates = useCallback((sourceItems: EditorEstimateItem[]) => {
    const sourceItemsWithStableClientKeys = withStableEditorClientKeys(sourceItems, itemsRef.current);

    syncedItemPayloadsRef.current = new Map(
      sourceItemsWithStableClientKeys.map((item) => [
        item.id,
        buildEstimateItemUpdatePayload(item),
      ])
    );
    pruneSyncedBufferedUpdates();

    return applyBufferedUpdatesToItems(
      sourceItemsWithStableClientKeys,
      serializeBufferedUpdates(pendingItemUpdatesRef.current)
    );
  }, [pruneSyncedBufferedUpdates]);

  useEffect(() => {
    if (!routeVersionId) return;

    return deferEffectStateUpdate(() => {
      const draft =
        readAutoSaveDraftFromLocal<EstimateItemUpdatePayload>(routeVersionId);
      if (!draft) return;

      const rehydration = rehydrateBufferedUpdates(
        itemsRef.current,
        draft.buffered_updates,
        pendingItemUpdatesRef.current
      );
      pendingBufferedUpdateCountRef.current = rehydration.pendingUpdateCount;
      setHasPendingBufferedUpdates(rehydration.hasPendingUpdates);
      replaceItems(rehydration.mergedItems);

      if (rehydration.hasPendingUpdates) {
        setTotalsOutOfSync(true);
        reportError(
          "Des modifications locales ont été récupérées. Elles restent en attente de synchronisation."
        );
      }
    });
  }, [replaceItems, reportError, routeVersionId, setTotalsOutOfSync]);

  const registerVersionConflict = useCallback(
    (error: unknown) => {
      if (!isVersionConflictError(error) || !isEstimateApiError(error)) {
        return false;
      }
      if (routeVersionIdRef.current !== routeVersionId) {
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
    [reportError, resolveErrorMessage, routeVersionId]
  );

  useEffect(() => {
    return deferEffectStateUpdate(() => {
      reportNotice(null);
      setRestorableDraft(
        routeVersionId
          ? readConflictDraftFromSession<EstimateSettingsState, EstimateItem>(
              routeVersionId
            )
          : null
      );
    });
  }, [reportNotice, routeVersionId]);

  const persistConflictDraft = useCallback(() => {
    if (!routeVersionId) return;
    const storedSnapshot = draftSnapshotsByVersionRef.current.get(routeVersionId);
    if (!storedSnapshot) return;

    const draft: EstimateEditorConflictDraft = {
      settings: storedSnapshot.settings,
      items: storedSnapshot.items,
      saved_at: new Date().toISOString(),
    };

    writeConflictDraftToSession(routeVersionId, draft);
    restoredConflictDraftRef.current = false;
    setRestorableDraft(draft);
  }, [routeVersionId]);

  const triggerVersionReload = useCallback(() => {
    if (!routeVersionId || routeVersionIdRef.current !== routeVersionId) return;
    setIsReloadingVersion(true);
    setReloadToken((previous) => previous + 1);
  }, [routeVersionId]);

  const batchRecovery = useEstimateBatchRecovery({
    versionId: routeVersionId, actorId: currentUserId, tenantId: activeVersion?.tenant_id ?? null,
    pendingUpdates: pendingItemUpdatesRef, triggerReload: triggerVersionReload, reportError, reportNotice,
    onBufferedChanges: () => {
      pendingBufferedUpdateCountRef.current = pendingItemUpdatesRef.current.size;
      setHasPendingBufferedUpdates(pendingItemUpdatesRef.current.size > 0);
      updateHasPendingTotalsSave(pendingItemUpdatesRef.current.size > 0);
      persistBufferedItemUpdatesToLocal();
      clearHistory();
    },
  });
  const { finishReload: finishBatchReload } = batchRecovery;
  const verifyRequiredRead = useCallback(async () => {
    const lifetime = mutationLifetimeRef.current;
    const isCurrentLifetime = () => lifetime === mutationLifetimeRef.current &&
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
  }, [currentTenantId, currentUserId, reportError, reportNotice, routeVersionId, triggerVersionReload]);
  const visibleRecovery = useMemo(() => readRequiredMessage || recoveryReloadMessage ? {
    blocked: true, message: readRequiredMessage ?? recoveryReloadMessage, canResume: false,
    isBusy: isRecoveringRead || Boolean(recoveryReloadMessage && isReloadingVersion), verify: verifyRequiredRead,
  } : batchRecovery, [batchRecovery, isRecoveringRead, isReloadingVersion, readRequiredMessage, recoveryReloadMessage, verifyRequiredRead]);
  const markVersionReloadFinished = useCallback((succeeded = true) => {
    if (routeVersionIdRef.current !== routeVersionId ||
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
  }, [currentTenantId, currentUserId, finishBatchReload, reportNotice, routeVersionId]);

  const handleVersionConflict = useCallback(
    (error: unknown, options?: { persistDraft?: boolean }) => {
      if (!registerVersionConflict(error)) return false;
      if (options?.persistDraft) {
        persistConflictDraft();
      }
      if (routeVersionIdRef.current !== routeVersionId) {
        return true;
      }
      clearBufferedItemUpdates({ clearPersisted: true });
      triggerVersionReload();
      return true;
    },
    [
      clearBufferedItemUpdates,
      persistConflictDraft,
      registerVersionConflict,
      routeVersionId,
      triggerVersionReload,
    ]
  );

  const clearConflictState = useCallback(() => {
    const message = conflictMessageRef.current;
    conflictMessageRef.current = null;
    setConflict(null);
    if (message !== null) reportError((current) => current === message ? null : current);
  }, [reportError]);

  const clearConflictDraft = useCallback((options?: { onlyIfRestored?: boolean }) => {
    // Saving unrelated work must not discard an unrestored recovery draft.
    if (options?.onlyIfRestored &&
        (!restoredConflictDraftRef.current || pendingItemUpdatesRef.current.size > 0)) return;
    clearConflictDraftFromSession(routeVersionId);
    restoredConflictDraftRef.current = false;
    setRestorableDraft(null);
    reportNotice(null);
  }, [reportNotice, routeVersionId]);

  const reloadAfterConflict = useCallback(() => {
    if (!routeVersionId) return;

    persistConflictDraft();
    setConflict(null);
    reportError(null);
    triggerVersionReload();
  }, [persistConflictDraft, reportError, routeVersionId, triggerVersionReload]);


  const hasMatchingActiveVersion = activeVersion?.id === routeVersionId;
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
        if (!isDraftLockRequiredError(error)) throw error;
        const acquired = await reacquireDraftLock();
        if (!acquired) throw error;
        return operation();
      }
    },
    [reacquireDraftLock]
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
    reportError(null);
    if (!isDraftVersion) {
      reportError("Version de brouillon introuvable.");
      return;
    }

    const acquired = await forceUnlockAndAcquireDraftLock();
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
    draftLockError,
    forceUnlockAndAcquireDraftLock,
    isDraftVersion,
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
    if (forceTotals && restorableDraft && !restoredConflictDraftRef.current) {
      return "blocked";
    }
    if (isFlushingBufferedUpdatesRef.current) {
      const generation = routeGenerationRef.current;
      await flushCompletionRef.current;
      if (generation !== routeGenerationRef.current) return "blocked";
      return flushBufferedItemUpdates(forceTotals);
    }
    if (hasEstimateEditorMutations(routeVersionId)) {
      const generation = routeGenerationRef.current;
      await waitForEstimateEditorMutations(routeVersionId);
      if (generation !== routeGenerationRef.current) return "blocked";
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
    if (!versionSnapshot || versionSnapshot.id !== routeVersionId) {
      return hasPendingAutoSaveWork ? "blocked" : "noop";
    }

    const bufferedEntries = serializeBufferedUpdates(
      pendingItemUpdatesRef.current
    );
    const versionTotalsPatch = buildVersionTotalsPatch(getPersistedTotals());
    const forceV2Totals = forceTotals && isUnifiedEngine(resolveCalcEngineVersion(versionSnapshot));
    if (forceV2Totals && !versionTotalsPatch) return "blocked";
    const reconcileTotals = forceV2Totals && versionTotalsPatch && (
      versionTotalsPatch.total_ht_cents !== versionSnapshot.total_ht_cents ||
      versionTotalsPatch.total_tax_cents !== versionSnapshot.total_tax_cents ||
      versionTotalsPatch.total_ttc_cents !== versionSnapshot.total_ttc_cents
    );
    if (bufferedEntries.length === 0 && !hasPendingTotalsSaveRef.current && !reconcileTotals) {
      setHasPendingBufferedUpdates(false);
      return "noop";
    }

    pendingItemUpdatesRef.current.clear();
    pendingBufferedUpdateCountRef.current = 0;

    const flushId = activeFlushIdRef.current + 1;
    activeFlushIdRef.current = flushId;
    const flushGeneration = routeGenerationRef.current;
    const flushVersionId = versionSnapshot.id;
    isFlushingBufferedUpdatesRef.current = true;
    let finishFlush!: () => void;
    const completion = new Promise<void>((resolve) => { finishFlush = resolve; });
    flushCompletionRef.current = completion;

    let savedVersionTotalsPatch = versionTotalsPatch;
    const structuralGeneration = structuralGenerationRef.current;
    const batchOperations = bufferedEntries.map((entry) => ({
      op: "update" as const,
      id: entry.id,
      data: entry.updates,
    }));
    let lineBatchCommitted = false;
    let committedLineVersionToken: string | null = null;
    let committedLineContentRevision: number | undefined;

    const isCurrentFlush = () =>
      activeFlushIdRef.current === flushId &&
      routeGenerationRef.current === flushGeneration &&
      routeVersionIdRef.current === flushVersionId;

    try {
      let nextVersionToken = versionSnapshot.updated_at;
      let nextContentRevision: number | undefined = versionSnapshot.content_revision;

      if (batchOperations.length > 0) {
        const attempt = createEstimateBatchAttempt();
        const batchResult = await runWithDraftLockRecovery(() =>
          batchEstimateOperations(
            flushVersionId,
            nextVersionToken,
            batchOperations,
            { attempt }
          )
        );

        if (!batchResult.committed) {
          const failedResult = batchResult.results.find(
            (result) => result.status === "error"
          );
          throw new Error(
            failedResult?.message ??
              "Une opération de sauvegarde groupée a échoué."
          );
        }

        lineBatchCommitted = true;
        nextVersionToken = batchResult.versionToken.updated_at;
        const acknowledgedVersion: EditorMutationToken =
          batchResult.currentVersionToken?.updated_at === nextVersionToken
            ? batchResult.currentVersionToken : batchResult.versionToken;
        nextContentRevision = acknowledgedVersion.content_revision;
        committedLineVersionToken = nextVersionToken;
        committedLineContentRevision = nextContentRevision;
        savedVersionTotalsPatch = batchResult.totals;
      }

      if (versionTotalsPatch && !lineBatchCommitted) {
        const bulkResult = await runWithDraftLockRecovery(() =>
          bulkUpdateEstimateItems(
            flushVersionId,
            nextVersionToken,
            [],
            versionTotalsPatch
          )
        );
        nextVersionToken = bulkResult.versionToken.updated_at;
        const acknowledgedVersion: EditorMutationToken = bulkResult.versionToken;
        nextContentRevision = acknowledgedVersion.content_revision;
        savedVersionTotalsPatch = bulkResult.totals ?? versionTotalsPatch;
      }

      if (!isCurrentFlush()) {
        return "saved";
      }

      const structureChanged = structuralGeneration !== structuralGenerationRef.current;
      updateHasPendingTotalsSave(structureChanged);
      setTotalsOutOfSync(structureChanged);
      bufferedEntries.forEach((entry) => {
        mergeSyncedItemPayload(entry.id, entry.updates);
      });
      pruneSyncedBufferedUpdates();
      applyVersionFlushResult({
        versionId: flushVersionId,
        totalsPatch: savedVersionTotalsPatch,
        updatedAt: nextVersionToken,
        ...(nextContentRevision === undefined ? {} : { contentRevision: nextContentRevision }),
      });
      // Une sauvegarde réussie invalide les anciens messages de navigation ou
      // de synchronisation. Sans ce reset, le ruban peut afficher « Sauvegardé »
      // tout en conservant une alerte rouge devenue fausse.
      reportError(null);
      persistBufferedItemUpdatesToLocal();
      setHasPendingBufferedUpdates(pendingItemUpdatesRef.current.size > 0);
      if (
        pendingItemUpdatesRef.current.size === 0 &&
        !pendingSettingsRef.current &&
        restoredConflictDraftRef.current
      ) {
        clearConflictDraftFromSession(flushVersionId);
        restoredConflictDraftRef.current = false;
        setRestorableDraft(null);
        reportNotice(null);
      }
      if (lineBatchCommitted) clearHistory();
      return "saved";
    } catch (error) {
      if (!isCurrentFlush()) {
        if (!lineBatchCommitted) {
          const persistedDraft =
            readAutoSaveDraftFromLocal<EstimateItemUpdatePayload>(flushVersionId);
          const restoredEntries = new Map<string, EstimateItemUpdatePayload>();
          bufferedEntries.forEach((entry) => {
            upsertBufferedUpdate(restoredEntries, entry.id, entry.updates);
          });
          persistedDraft?.buffered_updates.forEach((entry) => {
            upsertBufferedUpdate(restoredEntries, entry.id, entry.updates);
          });
          writeAutoSaveDraftToLocal(
            flushVersionId,
            serializeBufferedUpdates(restoredEntries)
          );
        }
        return "blocked";
      }

      if (lineBatchCommitted && committedLineVersionToken) {
        bufferedEntries.forEach((entry) => {
          mergeSyncedItemPayload(entry.id, entry.updates);
        });
        pruneSyncedBufferedUpdates();
        applyVersionFlushResult({
          versionId: flushVersionId,
          totalsPatch: undefined,
          updatedAt: committedLineVersionToken,
          ...(committedLineContentRevision === undefined ? {} : { contentRevision: committedLineContentRevision }),
        });
        updateHasPendingTotalsSave(Boolean(versionTotalsPatch));
        clearHistory();
      } else {
        bufferedEntries.forEach((entry) => {
          const existing = pendingItemUpdatesRef.current.get(entry.id) ?? {};
          pendingItemUpdatesRef.current.set(entry.id, {
            ...entry.updates,
            ...existing,
          });
        });
        pendingBufferedUpdateCountRef.current += bufferedEntries.length;
        if (bufferedEntries.length === 0 && versionTotalsPatch) {
          updateHasPendingTotalsSave(true);
        }
      }

      setHasPendingBufferedUpdates(pendingItemUpdatesRef.current.size > 0);
      persistBufferedItemUpdatesToLocal();

      if (handleVersionConflict(error, { persistDraft: true })) {
        setHasPendingBufferedUpdates(pendingItemUpdatesRef.current.size > 0);
        return "blocked";
      }

      setTotalsOutOfSync(true);
      reportError(
        lineBatchCommitted
          ? "Les lignes sont enregistrées, mais les totaux n’ont pas pu être synchronisés. Une nouvelle tentative va être effectuée."
          : resolveErrorMessage(
              error instanceof Error
                ? error.message
                : "Impossible de mettre à jour les lignes."
            )
      );
      return "error";
    } finally {
      finishFlush();
      if (flushCompletionRef.current === completion) flushCompletionRef.current = null;
      if (activeFlushIdRef.current === flushId) {
        isFlushingBufferedUpdatesRef.current = false;
      }
    }
  }, [
    applyVersionFlushResult,
    clearHistory,
    getPersistedTotals,
    getVersionSnapshot,
    handleVersionConflict,
    mergeSyncedItemPayload,
    pruneSyncedBufferedUpdates,
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
    hasPendingBufferedUpdates || hasPendingTotalsSave;
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
    const generation = routeGenerationRef.current;
    if (!isOnline || isSaveBlockedRef.current || restorableDraft) return false;
    await waitForEstimateEditorMutations(routeVersionId);
    if (generation !== routeGenerationRef.current) return false;
    const result = await flushBufferedItemUpdates();
    if (result === "error" || result === "blocked") return false;
    if (pendingSettingsRef.current || savingSettingsRef.current) {
      const saved = await savePendingSettingsRef.current();
      if (saved !== true) return false;
      // Settings inputs are disabled for this operation. Its completed promise
      // is authoritative even before React commits the matching clean state.
      pendingSettingsRef.current = false;
      savingSettingsRef.current = false;
    }
    // New edits may arrive while the first request is in flight.
    const finalResult = await flushBufferedItemUpdates();
    return generation === routeGenerationRef.current &&
      finalResult !== "error" && finalResult !== "blocked" &&
      pendingItemUpdatesRef.current.size === 0 &&
      !hasPendingTotalsSaveRef.current && !pendingSettingsRef.current &&
      !savingSettingsRef.current && !hasEstimateEditorMutations(routeVersionId);
  }, [flushBufferedItemUpdates, isOnline, restorableDraft, routeVersionId]);

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
      if (
        matchesSyncedItemPayload(
          syncedItemPayloadsRef.current.get(itemId),
          payload
        )
      ) {
        return;
      }

      upsertBufferedUpdate(pendingItemUpdatesRef.current, itemId, payload);
      setHasPendingBufferedUpdates(true);
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
    [flushAutoSaveNow, isAutoSaveEnabledRef, persistBufferedItemUpdatesToLocal, scheduleAutoSave]
  );

  const restoreConflictDraft = useCallback(() => {
    if (!restorableDraft) return;
    restoredConflictDraftRef.current = true;

    const { restoredItems, skippedItemCount } =
      applyRestoredDraft(restorableDraft);
    restoredItems.forEach((item) => {
      enqueueItemUpdate(item.id, {
        ...buildEstimateItemUpdatePayload(item),
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
        : "Modifications locales restaurées. Les lignes restent en attente de synchronisation ; enregistrez le paramétrage pour confirmer les réglages."
    );
  }, [
    applyRestoredDraft,
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
      if (hasPendingSettingsChanges && !options?.allowPendingSettings) {
        reportError(
          `Le paramétrage comporte des modifications non enregistrées. Enregistrez-le avant l’action « ${actionLabel} ».`
        );
        return false;
      }

      if (isFlushingBufferedUpdatesRef.current) {
        reportError(
          "Synchronisation des modifications en cours. Réessayez dans quelques secondes."
        );
        return false;
      }

      const flushResult = await flushBufferedItemUpdates();

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
    [flushBufferedItemUpdates, hasPendingSettingsChanges, reportError]
  );

  const saveNow = useCallback(async () => {
    await flushAutoSaveNow();
  }, [flushAutoSaveNow]);
  const retryTotalsSave = saveNow;

  const isFlushInProgress = useCallback(
    () => isFlushingBufferedUpdatesRef.current,
    []
  );

  const hasPendingUpdatesNow = useCallback(
    () =>
      pendingItemUpdatesRef.current.size > 0 ||
      hasPendingTotalsSaveRef.current,
    []
  );

  useEffect(() => {
    const pendingItemUpdates = pendingItemUpdatesRef.current;
    return () => {
      activeFlushIdRef.current += 1;
      routeGenerationRef.current += 1;
      isFlushingBufferedUpdatesRef.current = false;
      persistBufferedItemUpdatesToLocal();
      pendingItemUpdates.clear();
      pendingBufferedUpdateCountRef.current = 0;
      hasPendingTotalsSaveRef.current = false;
      setHasPendingBufferedUpdates(false);
      setHasPendingTotalsSave(false);
    };
  }, [persistBufferedItemUpdatesToLocal]);

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
