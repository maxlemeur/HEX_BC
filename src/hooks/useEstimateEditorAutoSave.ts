"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";

import { isSaveShortcutKey, resolveAutoSaveStatusLabel, useAutoSave, type AutoSaveReason, type AutoSaveResult, type AutoSaveStatus, type UseAutoSaveResult } from "@/hooks/useAutoSave";
import { AUTOSAVE_DEBOUNCE_MS, AUTOSAVE_MAX_WAIT_MS } from "@/hooks/useEstimateEditorSyncController.types";
import { readAutoSaveEnabledPreferenceFromLocal, writeAutoSaveEnabledPreferenceToLocal } from "@/lib/estimates/editor-drafts";

type Input = {
  routeVersionId: string;
  currentUserId: string | null;
  reportNotice: (message: string | null) => void;
  hasMatchingActiveVersion: boolean;
  isSaveBlocked: boolean;
  isSaveBlockedRef: RefObject<boolean>;
  hasPendingAutoSaveChanges: boolean;
  hasPendingChanges: boolean;
  hasPendingSettingsChanges: boolean;
  hasPendingMutations: boolean;
  isSavingSettings: boolean;
  allowManualTotalsReconciliation: boolean;
  isDraftVersion: boolean;
  restorableDraft: boolean;
  flushBufferedItemUpdates: (forceTotals?: boolean) => Promise<AutoSaveResult>;
  pendingItemUpdatesRef: RefObject<ReadonlyMap<string, unknown>>;
  hasPendingTotalsSaveRef: RefObject<boolean>;
  savePendingSettingsRef: RefObject<() => Promise<boolean | void>>;
  requiresReadVerification: boolean;
  isConflictLocked: boolean;
  isDraftLockedByOther: boolean;
  isDraftLockPending: boolean;
};

type Result = {
  autoSaveStatus: AutoSaveStatus;
  autoSaveStatusLabel: string;
  isAutoSaveSaving: boolean;
  isOnline: boolean;
  lastSavedAt: string | null;
  flushAutoSaveNow: UseAutoSaveResult["flushNow"];
  scheduleAutoSave: UseAutoSaveResult["scheduleSave"];
  isAutoSaveEnabled: boolean;
  isAutoSaveEnabledRef: RefObject<boolean>;
  setAutoSaveEnabled: (enabled: boolean) => void;
};

export function deferEffectStateUpdate(
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

/** Editor preference, save indicators and browser leave/shortcut events. */
export function useEstimateEditorAutoSave({
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
  restorableDraft,
  flushBufferedItemUpdates,
  pendingItemUpdatesRef,
  hasPendingTotalsSaveRef,
  savePendingSettingsRef,
  requiresReadVerification,
  isConflictLocked,
  isDraftLockedByOther,
  isDraftLockPending,
}: Input): Result {
  const [isAutoSaveEnabled, setIsAutoSaveEnabledState] = useState(() =>
    readAutoSaveEnabledPreferenceFromLocal(currentUserId)
  );
  const isAutoSaveEnabledRef = useRef(isAutoSaveEnabled);

  useLayoutEffect(() => {
    isAutoSaveEnabledRef.current = isAutoSaveEnabled;
  }, [isAutoSaveEnabled]);

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

  const saveAutoSaveChanges = useCallback(
    (reason: AutoSaveReason) => flushBufferedItemUpdates(
      reason === "manual" && allowManualTotalsReconciliation && !restorableDraft
    ),
    [allowManualTotalsReconciliation, flushBufferedItemUpdates, restorableDraft]
  );
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
    allowManualSaveWithoutChanges: allowManualTotalsReconciliation && isDraftVersion && !restorableDraft,
    debounceMs: AUTOSAVE_DEBOUNCE_MS,
    maxWaitMs: AUTOSAVE_MAX_WAIT_MS,
    enableShortcut: !hasPendingSettingsChanges,
    onSave: saveAutoSaveChanges,
  });

  // La cadence automatique est d'une minute : une modification en attente ne
  // doit pas suivre l'utilisateur qui quitte l'onglet ou la page.
  useEffect(() => {
    if (!routeVersionId) return;

    const flushBeforeLeaving = () => {
      if (isSaveBlockedRef.current) return;
      if (
        pendingItemUpdatesRef.current.size === 0 &&
        !hasPendingTotalsSaveRef.current
      ) {
        return;
      }
      void flushAutoSaveNow();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "hidden") return;
      flushBeforeLeaving();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", flushBeforeLeaving);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", flushBeforeLeaving);
    };
  }, [flushAutoSaveNow, hasPendingTotalsSaveRef, isSaveBlockedRef, pendingItemUpdatesRef, routeVersionId]);

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
  }, [hasPendingSettingsChanges, isSavingSettings, routeVersionId, savePendingSettingsRef]);

  const autoSaveStatus = useMemo<AutoSaveStatus>(() => {
    if (isSaveBlocked) return "blocked";
    if (!isOnline && hasPendingChanges) return "offline";
    if (isAutoSaveSaving || isSavingSettings || hasPendingMutations) return "saving";
    if (hasPendingSettingsChanges || restorableDraft) return "pending";
    return rawAutoSaveStatus;
  }, [
    hasPendingChanges,
    hasPendingSettingsChanges,
    hasPendingMutations,
    restorableDraft,
    isAutoSaveSaving,
    isOnline,
    isSaveBlocked,
    isSavingSettings,
    rawAutoSaveStatus,
  ]);
  const autoSaveStatusLabel = useMemo(() => {
    if (autoSaveStatus === "blocked") {
      if (requiresReadVerification) return "Résultat à vérifier";
      if (isConflictLocked) return "Conflit";
      if (isDraftLockedByOther) return "Verrouillé";
      if (isDraftLockPending) return "Connexion…";
      return "Lecture seule";
    }
    if (autoSaveStatus === "pending" && restorableDraft) return "Brouillon à restaurer";
    if (autoSaveStatus === "pending" && hasPendingSettingsChanges) {
      return "Non sauvegardé";
    }
    return autoSaveStatus === rawAutoSaveStatus
      ? rawAutoSaveStatusLabel
      : resolveAutoSaveStatusLabel(autoSaveStatus);
  }, [
    autoSaveStatus,
    requiresReadVerification,
    hasPendingSettingsChanges,
    restorableDraft,
    isConflictLocked,
    isDraftLockPending,
    isDraftLockedByOther,
    rawAutoSaveStatus,
    rawAutoSaveStatusLabel,
  ]);

  return {
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
  };
}
