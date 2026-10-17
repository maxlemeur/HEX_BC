import type { Dispatch, SetStateAction } from "react";

import type { EstimateSettingsState } from "@/components/estimates/EstimateSettingsPanel";
import type { EditorConflictDraft } from "@/lib/estimates/editor-drafts";
import type { AutoSaveResult, AutoSaveStatus } from "@/hooks/useAutoSave";
import type { EstimateTotals } from "@/lib/estimate-calculations";
import type { ReleaseEstimateDraftLockOptions } from "@/lib/estimates/client";
import type {
  EditorEstimateItem,
  EstimateItem,
  EstimateItemUpdatePayload,
  EstimateVersionRow,
  EstimateVersionTotalsPatch,
} from "@/lib/estimates/editor-items";

/**
 * Cadence de la sauvegarde automatique de l'editeur de devis : une modification
 * est envoyee au plus tard une minute apres avoir ete saisie, jamais a chaque
 * frappe. `AUTOSAVE_MAX_WAIT_MS` garantit ce plafond meme si l'utilisateur
 * enchaine les modifications sans pause.
 */
export const AUTOSAVE_DEBOUNCE_MS = 60_000;
export const AUTOSAVE_MAX_WAIT_MS = 60_000;
export const AUTOSAVE_IMMEDIATE_FLUSH_UPDATES = 100;

export type EstimateEditorConflictState = {
  message: string;
  details: unknown;
};

export type EstimateEditorConflictDraft = EditorConflictDraft<
  EstimateSettingsState,
  EstimateItem
>;

export type RestoredDraftApplication = {
  restoredItems: EstimateItem[];
  skippedItemCount: number;
};

export type EstimateEditorSyncControllerInput = {
  routeVersionId: string;
  activeVersion: (Pick<EstimateVersionRow, "id" | "status"> & Partial<Pick<EstimateVersionRow, "tenant_id">>) | null;
  currentUserId: string | null;
  currentTenantId: string | null;
  isViewerReadOnly: boolean;
  hasPendingSettingsChanges: boolean;
  isSavingSettings: boolean;
  allowManualTotalsReconciliation?: boolean;
  savePendingSettings: () => Promise<boolean | void>;
  navigate?: (href: string) => void;
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
    contentRevision?: number;
  }) => void;
  setTotalsOutOfSync: (value: boolean) => void;
  clearHistory: () => void;
  reportError: Dispatch<SetStateAction<string | null>>;
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
    batchRecovery: {
      blocked: boolean; message: string | null; canResume: boolean; isBusy: boolean;
      verify: () => Promise<void>; resume?: () => Promise<void>;
    };
  };
  actions: {
    overlayPendingUpdates: (
      sourceItems: EditorEstimateItem[]
    ) => EditorEstimateItem[];
    enqueueItemUpdate: (
      itemId: string,
      payload: EstimateItemUpdatePayload
    ) => void;
    markItemsSynced: (
      entries: ReadonlyArray<{ id: string; updates: EstimateItemUpdatePayload }>
    ) => void;
    setAutoSaveEnabled: (enabled: boolean) => void;
    saveNow: () => Promise<void>;
    flushBeforeExternalAction: () => Promise<boolean>;
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
    clearConflictDraft: (options?: { onlyIfRestored?: boolean }) => void;
    triggerVersionReload: () => void;
    markVersionReloadFinished: (succeeded?: boolean) => void;
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
    isReadRecoveryRequired: boolean;
    readOnlyActionErrorMessage: string;
    lockHolderLabel: string;
  };
};
