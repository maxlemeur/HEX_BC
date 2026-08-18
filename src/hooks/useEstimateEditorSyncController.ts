"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { EstimateSettingsState } from "@/components/estimates/EstimateSettingsPanel";
import {
  isSaveShortcutKey,
  resolveAutoSaveStatusLabel,
  useAutoSave,
  type AutoSaveResult,
  type AutoSaveStatus,
} from "@/hooks/useAutoSave";
import { useAutoSaveNavigationGuard } from "@/hooks/useAutoSaveNavigationGuard";
import { useDraftLock } from "@/hooks/useDraftLock";
import type { EstimateTotals } from "@/lib/estimate-calculations";
import {
  applyBufferedUpdatesToItems,
  rehydrateBufferedUpdates,
  serializeBufferedUpdates,
  shouldFlushBufferedUpdates,
  upsertBufferedUpdate,
} from "@/lib/estimates/bulk-buffer";
import {
  batchEstimateOperations,
  bulkUpdateEstimateItems,
  isEstimateApiError,
  type ReleaseEstimateDraftLockOptions,
} from "@/lib/estimates/client";
import {
  clearAutoSaveDraftFromLocal,
  clearConflictDraftFromSession,
  readAutoSaveEnabledPreferenceFromLocal,
  readAutoSaveDraftFromLocal,
  readConflictDraftFromSession,
  writeAutoSaveEnabledPreferenceToLocal,
  writeAutoSaveDraftToLocal,
  writeConflictDraftToSession,
  type EditorConflictDraft,
} from "@/lib/estimates/editor-drafts";
import {
  buildEstimateItemUpdatePayload,
  buildVersionTotalsPatch,
  type EditorEstimateItem,
  type EstimateItem,
  type EstimateItemUpdatePayload,
  type EstimateVersionRow,
  type EstimateVersionTotalsPatch,
} from "@/lib/estimates/editor-items";

const AUTOSAVE_DEBOUNCE_MS = 2000;
const AUTOSAVE_IMMEDIATE_FLUSH_UPDATES = 100;

export type EstimateEditorConflictState = {
  message: string;
  details: unknown;
};

export type EstimateEditorConflictDraft = EditorConflictDraft<
  EstimateSettingsState,
  EstimateItem
>;

type RestoredDraftApplication = {
  restoredItems: EstimateItem[];
  skippedItemCount: number;
};

type EstimateEditorSyncControllerInput = {
  routeVersionId: string;
  activeVersion: Pick<EstimateVersionRow, "id" | "status"> | null;
  currentUserId: string | null;
  isViewerReadOnly: boolean;
  hasPendingSettingsChanges: boolean;
  isSavingSettings: boolean;
  savePendingSettings: () => Promise<void>;
  items: EditorEstimateItem[];
  settings: EstimateSettingsState | null;
  getVersionSnapshot: () => EstimateVersionRow | null;
  getPersistedTotals: () => EstimateTotals | null;
  replaceItems: (items: EditorEstimateItem[]) => void;
  applyRestoredDraft: (
    draft: EstimateEditorConflictDraft
  ) => RestoredDraftApplication;
  applyVersionFlushResult: (input: {
    versionId: string;
    totalsPatch: EstimateVersionTotalsPatch | undefined;
    updatedAt: string;
  }) => void;
  setTotalsOutOfSync: (value: boolean) => void;
  clearHistory: () => void;
  reportError: (message: string | null) => void;
  reportNotice: (message: string | null) => void;
  resolveErrorMessage: (message: string) => string;
};

export type EstimateEditorSyncController = {
  state: {
    autoSaveStatus: AutoSaveStatus;
    autoSaveStatusLabel: string;
    isAutoSaveSaving: boolean;
    isAutoSaveEnabled: boolean;
    lastSavedAt: string | null;
    hasPendingBufferedUpdates: boolean;
    hasPendingChanges: boolean;
    conflict: EstimateEditorConflictState | null;
    isReloadingVersion: boolean;
    hasRestorableDraft: boolean;
    draftLockHolderName: string | null;
    isDraftLockOwnedByCurrentUser: boolean;
    isDraftLockedByOther: boolean;
    isDraftLockAcquiring: boolean;
    isForcingDraftUnlock: boolean;
    draftLockError: string | null;
  };
  actions: {
    overlayPendingUpdates: (
      sourceItems: EditorEstimateItem[]
    ) => EditorEstimateItem[];
    enqueueItemUpdate: (
      itemId: string,
      payload: EstimateItemUpdatePayload
    ) => void;
    setAutoSaveEnabled: (enabled: boolean) => void;
    saveNow: () => Promise<void>;
    flushBufferedItemUpdates: () => Promise<AutoSaveResult>;
    ensureGroupedActionCanProceed: (
      actionLabel: string,
      options?: { allowPendingSettings?: boolean }
    ) => Promise<boolean>;
    retryTotalsSave: () => Promise<void>;
    recoverDraftLock: () => Promise<boolean>;
    isFlushInProgress: () => boolean;
    hasPendingUpdatesNow: () => boolean;
    clearBufferedItemUpdates: (options?: {
      clearPersisted?: boolean;
    }) => void;
    registerVersionConflict: (error: unknown) => boolean;
    handleVersionConflict: (
      error: unknown,
      options?: { persistDraft?: boolean }
    ) => boolean;
    clearConflictState: () => void;
    clearConflictDraft: () => void;
    triggerVersionReload: () => void;
    markVersionReloadFinished: () => void;
    reloadAfterConflict: () => void;
    restoreConflictDraft: () => void;
    forceUnlockDraftLock: () => Promise<void>;
    releaseDraftLock: (
      options?: ReleaseEstimateDraftLockOptions
    ) => Promise<boolean>;
  };
  meta: {
    reloadToken: number;
    isStatusReadOnly: boolean;
    isDraftLockPending: boolean;
    isReadOnly: boolean;
    isConflictLocked: boolean;
    isSaveBlocked: boolean;
    readOnlyActionErrorMessage: string;
    lockHolderLabel: string;
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

function isVersionConflictError(error: unknown) {
  return (
    isEstimateApiError(error) &&
    error.status === 409 &&
    error.code === "VERSION_CONFLICT"
  );
}

function isDraftLockRequiredError(error: unknown) {
  return isEstimateApiError(error) && error.code === "LOCK_REQUIRED";
}
export function useEstimateEditorSyncController({
  routeVersionId,
  activeVersion,
  currentUserId,
  isViewerReadOnly,
  hasPendingSettingsChanges,
  isSavingSettings,
  savePendingSettings,
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
  const [isAutoSaveEnabled, setIsAutoSaveEnabledState] = useState(() =>
    readAutoSaveEnabledPreferenceFromLocal(currentUserId)
  );
  const [conflict, setConflict] =
    useState<EstimateEditorConflictState | null>(null);
  const [restorableDraft, setRestorableDraft] =
    useState<EstimateEditorConflictDraft | null>(null);
  const [isReloadingVersion, setIsReloadingVersion] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const pendingItemUpdatesRef = useRef<
    Map<string, EstimateItemUpdatePayload>
  >(new Map());
  const pendingBufferedUpdateCountRef = useRef(0);
  const hasPendingTotalsSaveRef = useRef(false);
  const isAutoSaveEnabledRef = useRef(isAutoSaveEnabled);
  const savePendingSettingsRef = useRef(savePendingSettings);
  const isFlushingBufferedUpdatesRef = useRef(false);
  const activeFlushIdRef = useRef(0);
  const routeVersionIdRef = useRef(routeVersionId);
  const routeGenerationRef = useRef(0);
  const itemsRef = useRef(items);
  const isSaveBlockedRef = useRef(false);
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

    return () => {
      routeGenerationRef.current += 1;
      activeFlushIdRef.current += 1;
      isFlushingBufferedUpdatesRef.current = false;
    };
  }, [routeVersionId]);

  useLayoutEffect(() => {
    isAutoSaveEnabledRef.current = isAutoSaveEnabled;
  }, [isAutoSaveEnabled]);

  useLayoutEffect(() => {
    savePendingSettingsRef.current = savePendingSettings;
  }, [savePendingSettings]);

  useEffect(() => {
    const storedPreference =
      readAutoSaveEnabledPreferenceFromLocal(currentUserId);
    isAutoSaveEnabledRef.current = storedPreference;
    setIsAutoSaveEnabledState(storedPreference);
  }, [currentUserId]);

  const setAutoSaveEnabled = useCallback(
    (enabled: boolean) => {
      isAutoSaveEnabledRef.current = enabled;
      setIsAutoSaveEnabledState(enabled);
      writeAutoSaveEnabledPreferenceToLocal(currentUserId, enabled);
      reportNotice(
        enabled
          ? "Sauvegarde automatique activée."
          : "Sauvegarde automatique désactivée. Utilisez « Sauvegarder maintenant » ou Ctrl+S pour synchroniser vos modifications."
      );
    },
    [currentUserId, reportNotice]
  );

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

  const clearBufferedItemUpdates = useCallback(
    (options?: { clearPersisted?: boolean }) => {
      pendingItemUpdatesRef.current.clear();
      pendingBufferedUpdateCountRef.current = 0;
      setHasPendingBufferedUpdates(false);
      updateHasPendingTotalsSave(false);
      if (options?.clearPersisted && routeVersionId) {
        clearAutoSaveDraftFromLocal(routeVersionId);
      }
    },
    [routeVersionId, updateHasPendingTotalsSave]
  );

  const overlayPendingUpdates = useCallback(
    (sourceItems: EditorEstimateItem[]) =>
      applyBufferedUpdatesToItems(
        sourceItems,
        serializeBufferedUpdates(pendingItemUpdatesRef.current)
      ),
    []
  );

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
    setRestorableDraft(draft);
  }, [routeVersionId]);

  const triggerVersionReload = useCallback(() => {
    if (!routeVersionId || routeVersionIdRef.current !== routeVersionId) return;
    setIsReloadingVersion(true);
    setReloadToken((previous) => previous + 1);
  }, [routeVersionId]);

  const markVersionReloadFinished = useCallback(() => {
    setIsReloadingVersion(false);
  }, []);

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
    setConflict(null);
  }, []);

  const clearConflictDraft = useCallback(() => {
    clearConflictDraftFromSession(routeVersionId);
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
    isStatusReadOnly ||
    isDraftLockedByOther ||
    isDraftLockPending ||
    isViewerReadOnly;
  const isConflictLocked = conflict !== null;
  const isSaveBlocked = isReadOnly || isConflictLocked;
  const readOnlyActionErrorMessage = isViewerReadOnly
    ? "Mode consultation active."
    : isDraftLockPending && !isDraftLockedByOther
      ? "Acquisition du verrou de brouillon en cours."
      : isDraftLockedByOther
        ? `Verrouille par ${lockHolderLabel}.`
        : "Cette version est en lecture seule.";

  useEffect(() => {
    isSaveBlockedRef.current = isSaveBlocked;
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
          "Impossible de forcer le deverrouillage de cette version."
      );
      return;
    }

    setConflict(null);
    triggerVersionReload();
  }, [
    draftLockError,
    forceUnlockAndAcquireDraftLock,
    isDraftVersion,
    reportError,
    triggerVersionReload,
  ]);

  useEffect(() => {
    if (!hasPendingSettingsChanges && !isSavingSettings) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [hasPendingSettingsChanges, isSavingSettings]);

  const flushBufferedItemUpdates = useCallback(async (): Promise<AutoSaveResult> => {
    if (isFlushingBufferedUpdatesRef.current) return "noop";

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
    if (bufferedEntries.length === 0 && !hasPendingTotalsSaveRef.current) {
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

    const versionTotalsPatch = buildVersionTotalsPatch(getPersistedTotals());
    const batchOperations = bufferedEntries.map((entry) => ({
      op: "update" as const,
      id: entry.id,
      data: entry.updates,
    }));
    let lineBatchCommitted = false;
    let committedLineVersionToken: string | null = null;

    const isCurrentFlush = () =>
      activeFlushIdRef.current === flushId &&
      routeGenerationRef.current === flushGeneration &&
      routeVersionIdRef.current === flushVersionId;

    try {
      let nextVersionToken = versionSnapshot.updated_at;

      if (batchOperations.length > 0) {
        const batchResult = await runWithDraftLockRecovery(() =>
          batchEstimateOperations(
            flushVersionId,
            nextVersionToken,
            batchOperations
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
        committedLineVersionToken = nextVersionToken;
      }

      if (versionTotalsPatch) {
        const bulkResult = await runWithDraftLockRecovery(() =>
          bulkUpdateEstimateItems(
            flushVersionId,
            nextVersionToken,
            [],
            versionTotalsPatch
          )
        );
        nextVersionToken = bulkResult.versionToken.updated_at;
      }

      if (!isCurrentFlush()) {
        return "saved";
      }

      updateHasPendingTotalsSave(false);
      setTotalsOutOfSync(false);
      applyVersionFlushResult({
        versionId: flushVersionId,
        totalsPatch: versionTotalsPatch,
        updatedAt: nextVersionToken,
      });
      persistBufferedItemUpdatesToLocal();
      setHasPendingBufferedUpdates(pendingItemUpdatesRef.current.size > 0);
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
        applyVersionFlushResult({
          versionId: flushVersionId,
          totalsPatch: undefined,
          updatedAt: committedLineVersionToken,
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
    persistBufferedItemUpdatesToLocal,
    reportError,
    resolveErrorMessage,
    runWithDraftLockRecovery,
    routeVersionId,
    setTotalsOutOfSync,
    updateHasPendingTotalsSave,
  ]);

  const hasPendingAutoSaveChanges =
    hasPendingBufferedUpdates || hasPendingTotalsSave;
  const {
    status: rawAutoSaveStatus,
    statusLabel: rawAutoSaveStatusLabel,
    isSaving: isAutoSaveSaving,
    isOnline,
    lastSavedAt,
    flushNow: flushAutoSaveNow,
    scheduleSave: scheduleAutoSave,
  } = useAutoSave({
    enabled: Boolean(
      routeVersionId && hasMatchingActiveVersion && !isSaveBlocked
    ),
    automaticEnabled: isAutoSaveEnabled,
    hasPendingChanges: hasPendingAutoSaveChanges,
    debounceMs: AUTOSAVE_DEBOUNCE_MS,
    enableShortcut: !hasPendingSettingsChanges,
    onSave: flushBufferedItemUpdates,
  });

  useEffect(() => {
    if (!routeVersionId || !hasPendingSettingsChanges) return;

    const handleSettingsSaveShortcut = (event: KeyboardEvent) => {
      if (!isSaveShortcutKey(event)) return;
      event.preventDefault();
      if (isSavingSettings) return;
      void savePendingSettingsRef.current();
    };

    window.addEventListener("keydown", handleSettingsSaveShortcut);
    return () => {
      window.removeEventListener("keydown", handleSettingsSaveShortcut);
    };
  }, [hasPendingSettingsChanges, isSavingSettings, routeVersionId]);

  const hasPendingChanges =
    hasPendingAutoSaveChanges || hasPendingSettingsChanges;
  const autoSaveStatus = useMemo<AutoSaveStatus>(() => {
    if (isSaveBlocked) return "blocked";
    if (!isOnline && hasPendingChanges) return "offline";
    if (isAutoSaveSaving || isSavingSettings) return "saving";
    if (hasPendingSettingsChanges) return "pending";
    return rawAutoSaveStatus;
  }, [
    hasPendingChanges,
    hasPendingSettingsChanges,
    isAutoSaveSaving,
    isOnline,
    isSaveBlocked,
    isSavingSettings,
    rawAutoSaveStatus,
  ]);
  const autoSaveStatusLabel = useMemo(() => {
    if (autoSaveStatus === "blocked") {
      if (isConflictLocked) return "Conflit";
      if (isDraftLockedByOther) return "Verrouillé";
      if (isDraftLockPending) return "Connexion…";
      return "Lecture seule";
    }
    if (autoSaveStatus === "pending" && hasPendingSettingsChanges) {
      return "Non sauvegardé";
    }
    return autoSaveStatus === rawAutoSaveStatus
      ? rawAutoSaveStatusLabel
      : resolveAutoSaveStatusLabel(autoSaveStatus);
  }, [
    autoSaveStatus,
    hasPendingSettingsChanges,
    isConflictLocked,
    isDraftLockPending,
    isDraftLockedByOther,
    rawAutoSaveStatus,
    rawAutoSaveStatusLabel,
  ]);

  const handleBlockedNavigation = useCallback(() => {
    reportError(
      "Des modifications ne sont pas encore synchronisées. Utilisez « Sauvegarder maintenant » ou Ctrl+S, puis réessayez."
    );
  }, [reportError]);

  useAutoSaveNavigationGuard({
    enabled: Boolean(routeVersionId),
    hasPendingChanges,
    isSaving: isAutoSaveSaving || isSavingSettings,
    onBlockedNavigation: handleBlockedNavigation,
  });

  const enqueueItemUpdate = useCallback(
    (itemId: string, payload: EstimateItemUpdatePayload) => {
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
    [flushAutoSaveNow, persistBufferedItemUpdatesToLocal, scheduleAutoSave]
  );

  const restoreConflictDraft = useCallback(() => {
    if (!restorableDraft) return;

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
          "Synchronisation des modifications en cours. Reessayez dans quelques secondes."
        );
        return false;
      }

      const flushResult = await flushBufferedItemUpdates();

      if (flushResult === "blocked") {
        reportError(
          `Impossible de ${actionLabel} tant que les modifications locales ne sont pas synchronisees. Rechargez la version puis reessayez.`
        );
        return false;
      }

      if (flushResult === "error") {
        reportError(
          `Impossible de synchroniser les modifications locales avant de ${actionLabel}. Corrigez les erreurs puis reessayez.`
        );
        return false;
      }

      if (
        flushResult === "noop" &&
        (pendingItemUpdatesRef.current.size > 0 ||
          hasPendingTotalsSaveRef.current)
      ) {
        reportError(
          "Synchronisation des modifications en cours. Reessayez dans quelques secondes."
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
      setAutoSaveEnabled,
      saveNow,
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
      markVersionReloadFinished,
      overlayPendingUpdates,
      registerVersionConflict,
      releaseDraftLock,
      reloadAfterConflict,
      restoreConflictDraft,
      reacquireDraftLock,
      retryTotalsSave,
      saveNow,
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
      readOnlyActionErrorMessage,
      lockHolderLabel,
    }),
    [
      isConflictLocked,
      isDraftLockPending,
      isReadOnly,
      isSaveBlocked,
      isStatusReadOnly,
      lockHolderLabel,
      readOnlyActionErrorMessage,
      reloadToken,
    ]
  );

  return { state, actions, meta };
}
