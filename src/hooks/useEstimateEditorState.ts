"use client";

import { useRouter } from "next/navigation";
import { saveEstimateEditorSettings } from "@/hooks/estimate-editor-settings-save";
import { useEstimateEditorDocument } from "@/hooks/useEstimateEditorDocument";
import { useEstimateEditorReadController, useEstimateEditorReadState } from "@/hooks/useEstimateEditorReadController";
import { normalizeEstimateEditorIdentity } from "@/lib/estimates/editor-document-state";
import { prepareEstimateEditorRead } from "@/lib/estimates/editor-read-snapshot";
import {
  haveEstimateSettingsChanged,
  type EstimateSettingsState,
  type SettingsSection,
} from "@/lib/estimates/editor-settings-state";
import { isOlderEstimateVersionToken } from "@/lib/estimates/editor-mutations";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  BulkSuggestDialogProps,
  EstimateChecklistProps,
  EstimateEditorAlertsProps,
  EstimateEditorDrawerProps,
  EstimateEditorTableProps,
  EstimateEditorToolbarProps,
  EstimateSendGatingDialogProps,
  EstimateSettingsSummaryBarProps,
  EstimateStructureDraftDialogProps,
  GeneratedOuvrageDialogProps,
  ImportFromEstimateDialogProps,
  PriceReuseDialogProps,
  SupplierPreselectionDialogProps,
  VersionZeroDraftDialogProps,
} from "@/hooks/estimate-editor-view-props";
import { useUserContext } from "@/lib/auth/user-context";
import { useEstimateEditorExportController } from "@/hooks/useEstimateEditorExportController";
import { estimateEditorAutoSaveStatusClassName } from "@/hooks/estimate-editor-autosave-status";
import { buildEstimateEditorTableVirtualization } from "@/hooks/estimate-editor-virtualization-runtime";
import { type EstimateEditorActivityController } from "@/hooks/useEstimateEditorActivityController";
import { useEstimateEditorAiDialogsController } from "@/hooks/useEstimateEditorAiDialogsController";
import {
  resolveEstimateEditorAutoOpenDialogs,
  useEstimateEditorAiImportCoordinator,
} from "@/hooks/useEstimateEditorAiImportCoordinator";
import { useEstimateEditorBulkController } from "@/hooks/useEstimateEditorBulkController";
import type { EstimateEditorHistoryController } from "@/hooks/useEstimateEditorHistoryController";
import { useEstimateEditorImportController } from "@/hooks/useEstimateEditorImportController";
import { useEstimateEditorItemsController } from "@/hooks/useEstimateEditorItemsController";
import {
  useEstimateEditorCalculation,
} from "@/hooks/useEstimateEditorCalculation";
import { useEstimateEditorOrderingController } from "@/hooks/useEstimateEditorOrderingController";
import { useEstimateEditorPasteController } from "@/hooks/useEstimateEditorPasteController";
import { useEstimateEditorQualityController } from "@/hooks/useEstimateEditorQualityController";
import { useEstimateEditorStructureController } from "@/hooks/useEstimateEditorStructureController";
import { useEstimateEditorLaborRolesController } from "@/hooks/useEstimateEditorLaborRolesController";
import { useEstimateEditorLineNormalization } from "@/hooks/useEstimateEditorLineNormalization";
import { useEstimateEditorMarginTiersController } from "@/hooks/useEstimateEditorMarginTiersController";
import { useEstimateEditorOfferChoices } from "@/hooks/useEstimateEditorOfferChoices";
import {
  useEstimateEditorSectionCopyToVersion,
  useEstimateEditorSectionDuplicateTargets,
} from "@/hooks/useEstimateEditorSectionCopy";
import { useEstimateEditorSettingsDrawer } from "@/hooks/useEstimateEditorSettingsDrawer";
import { useEstimateEditorSupplierController } from "@/hooks/useEstimateEditorSupplierController";
import { useEstimateEditorStatusController } from "@/hooks/useEstimateEditorStatusController";
import { useEstimateEditorSuggestionsController } from "@/hooks/useEstimateEditorSuggestionsController";
import {
  useEstimateEditorSyncController,
  type EstimateEditorConflictDraft,
} from "@/hooks/useEstimateEditorSyncController";
import { useUiMode } from "@/hooks/useUiMode";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { LABOR_SPLIT_FEATURE_FLAG_KEY } from "@/lib/feature-flag-keys";
import { useEstimateV3Settings } from "@/hooks/useEstimateV3Settings";
import type { EstimateTotals } from "@/lib/estimate-calculations";
import {
  reconcilesEditorTotals, resolveEditorEngineContext, resolveEditorStoredMarginMultiplier,
  resolveEditorQualityItems,
} from "@/lib/estimates/editor-engine";
import {
  convertEstimateV3Items, ESTIMATE_V3_EDITOR_WRITER,
} from "@/lib/estimates/v3-editor-writer";
import {
  buildEstimateV3ItemUpdatePayload, buildEstimateV3SummaryView, indexEstimateV3Lines,
  type EstimateV3GridModel,
} from "@/lib/estimates/v3-editor";
import {
  DEFAULT_TAX_RATE_BP,
  ESTIMATE_VERSION_CONFLICT_MESSAGE,
} from "@/lib/estimates/constants";
import {
  DEFAULT_ESTIMATE_CURRENCY,
  resolveEstimateCurrency,
} from "@/lib/estimates/editor-export";
import {
  buildEstimateItemUpdatePayload,
  buildVersionTotalsPatch,
  resolveLaborRoleHourlyRate,
  type EditorEstimateItem,
  type EstimateVersionRow,
  type EstimateVersionView,
  type EstimateVersionTotalsPatch,
  type LaborRole,
} from "@/lib/estimates/editor-items";
import {
  foProvisionsBySupplyType,
  withBufferedFoProvision,
  withServerFoProvisions,
  type FoProvisionBySupplyTypeId,
} from "@/lib/estimates/fo-provision";
import {
  ESTIMATE_EDITOR_VIRTUALIZATION_AUTO_THRESHOLD_FLAG_KEY,
  ESTIMATE_EDITOR_VIRTUALIZATION_MODE_FLAG_KEY,
} from "@/lib/estimate-editor-virtualization";
import { fetchEstimateEditorData } from "@/lib/estimates/editor-read-client";
import type { EstimateBatchOperationResult } from "@/lib/estimates/batch-contracts";
import type {
  EstimateEditorData,
  VersionZeroDraftSummary,
} from "@/lib/estimates/editor-read-contracts";
import type {
  SuggestionLearningState as SuggestionLearningClientState,
} from "@/lib/estimates/suggestion-learning-client";
import type { Database } from "@/types/database";
import { deferEffectStateUpdate } from "@/hooks/useEstimateEditorAutoSave";
import { useFocusItemHighlight } from "@/hooks/useFocusItemHighlight";
import { formatEstimateEditorAuditTimestamp } from "@/lib/estimates/audit-timestamp";
import {
  getProjectName,
  resolveEstimateActionError,
  resolveLatestSavedAt,
} from "@/lib/estimates/editor-presentation";

type SupplyType = EstimateEditorData["supplyTypes"][number];
type SuggestionRule =
  Database["public"]["Tables"]["estimate_suggestion_rules"]["Row"];

export type EstimateEditorStateModel = {
  state: {
    versionId: string;
    resolvedVersionId: string;
    isLoading: boolean;
    loadError: string | null;
    version: EstimateVersionView | null;
    settings: EstimateSettingsState | null;
    isSettingsDrawerOpen: boolean;
    isBulkSuggestDialogOpen: boolean;
    isSupplierPreselectionDialogOpen: boolean;
    isImportFromEstimateDialogOpen: boolean;
    isEstimateStructureDraftDialogOpen: boolean;
    isGeneratedOuvrageDialogOpen: boolean;
    isVersionZeroDialogOpen: boolean;
    isSendGatingDialogOpen: boolean;
  };
  actions: {
    openSettingsDrawer: (section?: SettingsSection) => void;
    closeSettingsDrawer: () => void;
  };
  meta:
    | {
        kind: "missing-version";
      }
    | {
        kind: "loading";
      }
    | {
        kind: "error";
        message: string;
      }
    | {
        kind: "ready";
        projectId: string | null;
        canRetryHistoryRecovery: boolean;
        /** Lot 2, sous-lot 2.6 : lignes du moteur v3 pour la grille, nul en v1/v2. */
        v3Grid: EstimateV3GridModel | null;
        toolbarProps: EstimateEditorToolbarProps;
        alertsProps: EstimateEditorAlertsProps;
        summaryBarProps: EstimateSettingsSummaryBarProps;
        editorTableProps: EstimateEditorTableProps;
        /** The finalization checklist the page shows at the head of the table, while its panel is open. */
        checklistProps: EstimateChecklistProps | null;
        drawerProps: EstimateEditorDrawerProps;
        bulkSuggestDialogProps: BulkSuggestDialogProps;
        supplierPreselectionDialogProps: SupplierPreselectionDialogProps;
        importFromEstimateDialogProps: ImportFromEstimateDialogProps | null;
        priceReuseDialogProps: PriceReuseDialogProps | null;
        estimateStructureDraftDialogProps: EstimateStructureDraftDialogProps | null;
        generatedOuvrageDialogProps: GeneratedOuvrageDialogProps | null;
        versionZeroDraftDialogProps: VersionZeroDraftDialogProps | null;
        sendGatingDialogProps: EstimateSendGatingDialogProps;
      };
};

export function useEstimateEditorState({
  versionId,
  focusItemId = null,
  autoOpenVersionZero = false,
  autoOpenStructureDraft = false,
  autoOpenSettingsSection = null,
  historyController,
  activityController,
  externalActionError = null,
}: {
  versionId: string;
  focusItemId?: string | null;
  autoOpenVersionZero?: boolean;
  autoOpenStructureDraft?: boolean;
  autoOpenSettingsSection?: SettingsSection | null;
  historyController: EstimateEditorHistoryController;
  activityController: EstimateEditorActivityController;
  /**
   * Error reported by a controller owned by the page (undo/redo). It is folded
   * into the editor's own `actionError` so it follows the same lifecycle
   * (cleared by the next action) instead of sticking for the page's life.
   */
  externalActionError?: { message: string; key: number } | null;
}): EstimateEditorStateModel {
  const router = useRouter();
  const resolvedVersionId = normalizeEstimateEditorIdentity(versionId)!;
  const {
    autoOpenVersionZero: shouldAutoOpenVersionZero,
    autoOpenStructureDraft: shouldAutoOpenStructureDraft,
  } = resolveEstimateEditorAutoOpenDialogs({
    autoOpenVersionZero,
    autoOpenStructureDraft,
  });
  const { profile } = useUserContext();
  const readActorId = normalizeEstimateEditorIdentity(profile?.id ?? null);
  const readTenantId = normalizeEstimateEditorIdentity(profile?.tenant_id ?? null);
  const isAdmin = profile?.role === "admin";
  const isViewerReadOnly = profile?.tenant_role === "viewer";
  const { isExpert } = useUiMode();
  const { enabled: isLaborSplitEnabled } = useFeatureFlag(LABOR_SPLIT_FEATURE_FLAG_KEY);
  const {
    enabled: isVirtualizationModeFlagEnabled,
    value: virtualizationModeFlagValue,
  } = useFeatureFlag(ESTIMATE_EDITOR_VIRTUALIZATION_MODE_FLAG_KEY);
  const { value: virtualizationAutoThresholdFlagValue } = useFeatureFlag(
    ESTIMATE_EDITOR_VIRTUALIZATION_AUTO_THRESHOLD_FLAG_KEY
  );

  const readState = useEstimateEditorReadState();
  const { isLoading, loadError } = readState;
  const {
    document: editorDocument, scope: documentScope, version, settings, savedSettings, items,
    setVersion, setSettings, setItems,
    categories, supplyTypes, laborRoles, setLaborRoles, allowedTaxRatesBp,
    versionRef, itemsRef,
  } = useEstimateEditorDocument({ actorId: readActorId, tenantId: readTenantId, versionId: resolvedVersionId });
  const [suggestionsHydration, setSuggestionsHydration] = useState<{
    versionId: string;
    rules: SuggestionRule[];
    learning: SuggestionLearningClientState | null;
  } | null>(null);
  const settingsSaveGenerationRef = useRef(0);
  const settingsSavePromiseRef = useRef<{
    versionId: string;
    promise: Promise<boolean | undefined>;
  } | null>(null);
  const settingsSaveIdentity = `${readActorId ?? ""}:${readTenantId ?? ""}:${resolvedVersionId}`;
  const settingsSaveIdentityRef = useRef(settingsSaveIdentity);
  const [activeSettingsSave, setActiveSettingsSave] = useState<{
    routeVersionId: string;
    operationId: number;
  } | null>(null);
  const isSavingSettings =
    activeSettingsSave?.routeVersionId === resolvedVersionId &&
    activeSettingsSave.operationId === settingsSaveGenerationRef.current;
  const [actionError, setActionError] = useState<string | null>(null);
  const externalActionErrorKey = externalActionError?.key ?? null;
  const externalActionErrorMessage = externalActionError?.message ?? null;
  useEffect(() => {
    if (externalActionErrorKey === null || externalActionErrorMessage === null) {
      return;
    }
    setActionError(externalActionErrorMessage);
  }, [externalActionErrorKey, externalActionErrorMessage]);
  const displayedActionError = actionError;
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const historyRecoveryNoticeRef = useRef(historyController.state.recovery);
  useLayoutEffect(() => {
    historyRecoveryNoticeRef.current = historyController.state.recovery;
  }, [historyController.state.recovery]);
  const reportSyncNotice = useCallback((message: string | null) => {
    // History already owns the recovery feedback. An additional banner would
    // shift the grid while the user verifies and restores its exact positions.
    if (message === null || !historyRecoveryNoticeRef.current) setActionNotice(message);
  }, []);

  const {
    isSaving: isSavingMarginTiers,
    error: marginTiersError,
    reset: resetMarginTiers,
    createTier: handleCreateTier,
    updateTier: handleUpdateTier,
    deleteTier: handleDeleteTier,
  } = useEstimateEditorMarginTiersController({ editorDocument, documentScope });
  const [totalsOutOfSync, setTotalsOutOfSync] = useState(false);
  const {
    canUndo,
    canRedo,
    isExecuting: isUndoRedoBusy,
  } = historyController.state;
  const {
    push: pushHistoryCommand,
    clear: clearUndoRedoHistory,
    undo: handleUndo,
    redo: handleRedo,
  } = historyController.actions;

  const foProvisionsRef = useRef<FoProvisionBySupplyTypeId>(new Map());
  const activeRouteVersionIdRef = useRef(resolvedVersionId);
  const activeReadTenantRef = useRef(readTenantId);
  const persistedTotalsRef = useRef<EstimateTotals | null>(null);
  const hydrateAiVersionZeroSummaryRef = useRef<
    (
      targetVersionId: string,
      summary: VersionZeroDraftSummary | null,
      options?: { autoOpen?: boolean }
    ) => void
  >(() => undefined);

  useLayoutEffect(() => {
    activeRouteVersionIdRef.current = resolvedVersionId;
    activeReadTenantRef.current = readTenantId;
    if (settingsSaveIdentityRef.current !== settingsSaveIdentity) {
      settingsSaveIdentityRef.current = settingsSaveIdentity;
      settingsSaveGenerationRef.current += 1;
      settingsSavePromiseRef.current = null;
      setActiveSettingsSave(null);
      resetMarginTiers();
      setActionError(null);
      setActionNotice(null);
    }
  }, [readTenantId, resetMarginTiers, resolvedVersionId, settingsSaveIdentity]);

  const getItemsSnapshot = useCallback(() => itemsRef.current, [itemsRef]);
  const getVersionSnapshot = useCallback(() => {
    const snapshot = versionRef.current;
    return snapshot?.id === activeRouteVersionIdRef.current &&
      snapshot.tenant_id === activeReadTenantRef.current ? snapshot : null;
  }, [versionRef]);
  const getPersistedTotals = useCallback(() => persistedTotalsRef.current, []);
  const applyRestoredDraft = useCallback(
    (draft: EstimateEditorConflictDraft) => {
      // Lot 2, sous-lot 2.6b (A14) : les réglages d'un brouillon local ont la forme v2 (marge, mode, paliers) ; une v3
      // ne les reprend jamais (sa marge vient des coefficients de vente, réglés et enregistrés par le tiroir v3) ; ses
      // lignes restaurées partent par la charge v3 (saisies seulement).
      const isV3Draft = resolveEditorEngineContext(versionRef.current).isV3;
      if (draft.settings && !isV3Draft) {
        setSettings({
          ...draft.settings,
          currency: resolveEstimateCurrency(
            (draft.settings as { currency?: string | null }).currency
          ),
        });
      }

      const currentItems = itemsRef.current;
      const currentItemIds = new Set(currentItems.map((item) => item.id));
      const restoredItems = draft.items.filter((item) =>
        currentItemIds.has(item.id)
      );
      const restoredItemIds = new Set(restoredItems.map((item) => item.id));
      const serverOnlyItems = currentItems.filter(
        (item) => !restoredItemIds.has(item.id)
      );
      const nextItems: EditorEstimateItem[] = [
        ...restoredItems,
        ...serverOnlyItems,
      ];

      setItems(nextItems);

      return {
        restoredItems,
        skippedItemCount:
          draft.items.length - restoredItems.length + serverOnlyItems.length,
        buildItemPayload: isV3Draft ? buildEstimateV3ItemUpdatePayload : buildEstimateItemUpdatePayload,
        settingsRestored: Boolean(draft.settings) && !isV3Draft,
      };
    },
    [setSettings, setItems, itemsRef, versionRef]
  );
  const applyVersionFlushResult = useCallback(
    ({
      versionId,
      totalsPatch,
      updatedAt,
      contentRevision,
      results,
    }: {
      versionId: string;
      totalsPatch: EstimateVersionTotalsPatch | undefined;
      updatedAt: string;
      contentRevision?: number;
      results?: readonly EstimateBatchOperationResult[];
    }) => {
      if (!editorDocument.isCurrent(documentScope)) return;
      const current = editorDocument.getSnapshot().version;
      if (!current || current.id !== versionId || isOlderEstimateVersionToken(updatedAt, current.updated_at)) return;
      editorDocument.transaction(() => {
        editorDocument.setConfirmedVersion({ ...current, ...(totalsPatch ?? {}), updated_at: updatedAt,
          ...(contentRevision !== undefined ? { content_revision: contentRevision } : {}) }, documentScope);
        // The provision returned by the writer is confirmed server data. Its
        // acknowledgement must not become another local preview or intention.
        if (results?.length) {
          const before = editorDocument.getSnapshot().confirmedItems;
          const after = withServerFoProvisions(before, results, true);
          editorDocument.acknowledgeItems(after.flatMap((item, index) => item !== before[index]
            ? [{ id: item.id, updates: { fo_provision: item.fo_provision, fo_price_origin: item.fo_price_origin, supply_type_id: item.supply_type_id,
              ...(item.k_fo !== before[index].k_fo ? { k_fo: item.k_fo } : {}) } }] : []));
        }
      });
    },
    [editorDocument, documentScope]
  );

  // Lot 2, sous-lot 2.6 : moteur de la version ouverte ; une v3 délègue ses réglages et son aperçu.
  const { isV3, historical: calcEngineVersion } = resolveEditorEngineContext(version);
  const v3Settings = useEstimateV3Settings({
    document: editorDocument,
    version, items, laborRoles, laborSplitEnabled: isLaborSplitEnabled, marginTiers: settings?.margin_tiers,
  });
  const v3Breakdown = isV3 ? (v3Settings?.preview?.breakdown ?? null) : undefined;
  const hasUnsavedSettings = useMemo(
    () => haveEstimateSettingsChanged(settings, savedSettings) || Boolean(v3Settings?.isDirty),
    [savedSettings, settings, v3Settings?.isDirty]
  );

  // TI-534 : une ligne v3 recouverte d'un type FO en attente (brouillon local, rechargement) reprend la provision de
  // ce type, comme l'écriture la redérivera. Lu dans les références : le premier chargement recouvre ses lignes avant
  // que la version et les types FO ne soient dans l'état.
  const deriveBufferedItem = useCallback(
    (source: EditorEstimateItem, merged: EditorEstimateItem) => withBufferedFoProvision(source, merged,
      foProvisionsRef.current, resolveEditorEngineContext(versionRef.current).isV3),
    [versionRef]
  );

  const syncController = useEstimateEditorSyncController({
    document: editorDocument,
    routeVersionId: resolvedVersionId,
    activeVersion: version
      ? {
          id: version.id,
          status: version.status,
          tenant_id: version.tenant_id,
        }
      : null,
    currentUserId: profile?.id ?? null,
    currentTenantId: readTenantId,
    isViewerReadOnly,
    hasPendingSettingsChanges: hasUnsavedSettings,
    isSavingSettings,
    allowManualTotalsReconciliation:
      !isLoading && !loadError && Boolean(settings && savedSettings) &&
      version?.id === resolvedVersionId && reconcilesEditorTotals(version),
    savePendingSettings: async () => {
      return (await handleSaveSettings()) === true;
    },
    navigate: (href) => router.push(href),
    items,
    settings,
    getVersionSnapshot,
    getPersistedTotals,
    replaceItems: setItems,
    deriveBufferedItem,
    applyRestoredDraft,
    applyVersionFlushResult,
    setTotalsOutOfSync,
    clearHistory: clearUndoRedoHistory,
    reportError: setActionError,
    reportNotice: reportSyncNotice,
    resolveErrorMessage: resolveEstimateActionError,
  });
  const {
    autoSaveStatus: syncAutoSaveStatus,
    autoSaveStatusLabel: syncAutoSaveStatusLabel,
    isAutoSaveSaving,
    isAutoSaveEnabled,
    lastSavedAt,
    hasPendingChanges,
    conflict: conflictState,
    isReloadingVersion,
    hasRestorableDraft,
    isDraftLockedByOther,
    isDraftLockAcquiring,
    isForcingDraftUnlock,
    draftLockError,
    batchRecovery,
  } = syncController.state;
  const {
    enqueueItemUpdate: enqueueBufferedItemUpdate,
    markItemsSynced,
    setAutoSaveEnabled,
    saveNow,
    flushBeforeExternalAction,
    flushBufferedItemUpdates,
    ensureGroupedActionCanProceed,
    retryTotalsSave,
    recoverDraftLock,
    isFlushInProgress,
    hasPendingUpdatesNow,
    handleVersionConflict,
    clearConflictState,
    clearConflictDraft,
    triggerVersionReload,
    markVersionReloadFinished,
    reloadAfterConflict: handleReloadAfterConflict,
    restoreConflictDraft: handleRestoreConflictDraft,
    forceUnlockDraftLock: handleForceUnlockDraftLock,
    releaseDraftLock,
  } = syncController.actions;
  const {
    reloadToken: reloadNonce,
    isStatusReadOnly,
    isDraftLockPending,
    isReadOnly: isSyncReadOnly,
    isConflictLocked,
    isSaveBlocked,
    isReadRecoveryRequired,
    readOnlyActionErrorMessage,
    lockHolderLabel,
  } = syncController.meta;
  const isHistoryBlocked = isUndoRedoBusy || Boolean(historyController.state.recovery);
  const isReadOnly = isSyncReadOnly || isHistoryBlocked;
  const settingsSaveGuardRef = useRef({
    isBlocked: isSaveBlocked || isHistoryBlocked,
    message: isHistoryBlocked
      ? "Terminez l’annulation et la remise en ordre avant de modifier les paramètres."
      : isConflictLocked
      ? (conflictState?.message ?? ESTIMATE_VERSION_CONFLICT_MESSAGE)
      : (batchRecovery.message ?? readOnlyActionErrorMessage),
  });

  useLayoutEffect(() => {
    settingsSaveGuardRef.current = {
      isBlocked: isSaveBlocked || isHistoryBlocked,
      message: isHistoryBlocked
        ? "Terminez l’annulation et la remise en ordre avant de modifier les paramètres."
        : isConflictLocked
        ? (conflictState?.message ?? ESTIMATE_VERSION_CONFLICT_MESSAGE)
        : (batchRecovery.message ?? readOnlyActionErrorMessage),
    };
  }, [
    conflictState?.message,
    batchRecovery.message,
    isConflictLocked,
    isHistoryBlocked,
    isSaveBlocked,
    readOnlyActionErrorMessage,
  ]);

  useEstimateEditorReadController({
    readState,
    versionId: resolvedVersionId,
    actorId: readActorId,
    tenantId: readTenantId,
    reloadToken: reloadNonce,
    isLaborSplitEnabled,
    autoOpenVersionZero: shouldAutoOpenVersionZero,
    handlers: {
      getCurrentVersion: () => versionRef.current,
      isRecoveryRequired: isReadRecoveryRequired,
      clearSuggestions: () => setSuggestionsHydration(null),
      apply: (prepared, learning) => {
        const data = prepared.confirmed;
        const versionRow = data.version;
        foProvisionsRef.current = foProvisionsBySupplyType(data.supplyTypes);
        editorDocument.acceptRead(prepared, deriveBufferedItem);
        hydrateAiVersionZeroSummaryRef.current(versionRow.id, data.versionZeroSummary, {
          autoOpen: shouldAutoOpenVersionZero,
        });
        setSuggestionsHydration({ versionId: versionRow.id, rules: data.suggestionRules, learning });
        clearConflictState();
        prepared.normalizationUpdates.forEach(({ id, updates }) => enqueueBufferedItemUpdate(id, updates));
      },
      finish: markVersionReloadFinished,
      reportRefreshError: setActionError,
      resolveErrorMessage: resolveEstimateActionError,
    },
  });

  const sectionDuplicateTargets = useEstimateEditorSectionDuplicateTargets(resolvedVersionId, reloadNonce);

  const projectName = getProjectName(version?.estimate_projects ?? null);

  const editorTableBaseConfig = useMemo(
    () => ({
      marginMultiplier: settings?.margin_multiplier ?? 1,
      discountCents: settings?.discount_cents ?? 0,
      taxRateBp: settings?.tax_rate_bp ?? 0,
      isReadOnly: isReadOnly || isConflictLocked || isSavingSettings,
    }),
    [
      isConflictLocked,
      isReadOnly,
      isSavingSettings,
      settings?.discount_cents,
      settings?.margin_multiplier,
      settings?.tax_rate_bp,
    ]
  );
  const editorTableVirtualization = useMemo(
    () =>
      buildEstimateEditorTableVirtualization({
        isVirtualizationModeFlagEnabled,
        virtualizationModeFlagValue:
          typeof virtualizationModeFlagValue === "string"
            ? virtualizationModeFlagValue
            : null,
        virtualizationAutoThresholdFlagValue:
          typeof virtualizationAutoThresholdFlagValue === "string"
            ? virtualizationAutoThresholdFlagValue
            : null,
        itemCount: items.length,
      }),
    [
      isVirtualizationModeFlagEnabled,
      items.length,
      virtualizationAutoThresholdFlagValue,
      virtualizationModeFlagValue,
    ]
  );
  const {
    isOpen: isSettingsDrawerOpen,
    open: handleOpenSettingsDrawer,
    close: closeSettingsDrawer,
  } = useEstimateEditorSettingsDrawer({ autoOpenSettingsSection, isLoading, settings });
  const {
    audit: {
      entries: auditLogs,
      error: auditError,
      isLoading: isAuditLoading,
    },
    timeline: {
      events: timelineEvents,
      error: timelineError,
      isLoading: isTimelineLoading,
    },
  } = activityController.state;
  const {
    refreshAudit: loadAuditLogs,
    refreshTimeline: loadTimelineEvents,
  } = activityController.actions;
  const laborRateById = useMemo(() => {
    const map = new Map<string, number>();
    laborRoles.forEach((role) => {
      map.set(role.id, resolveLaborRoleHourlyRate(role, "default"));
    });
    return map;
  }, [laborRoles]);

  const laborRateAtelierById = useMemo(() => {
    const map = new Map<string, number>();
    laborRoles.forEach((role) => {
      map.set(role.id, resolveLaborRoleHourlyRate(role, "atelier"));
    });
    return map;
  }, [laborRoles]);

  const laborRateChantierById = useMemo(() => {
    const map = new Map<string, number>();
    laborRoles.forEach((role) => {
      map.set(role.id, resolveLaborRoleHourlyRate(role, "chantier"));
    });
    return map;
  }, [laborRoles]);

  const supplyTypeById = useMemo(() => {
    const map = new Map<string, SupplyType>();
    supplyTypes.forEach((supplyType) => {
      map.set(supplyType.id, supplyType);
    });
    return map;
  }, [supplyTypes]);

  // TI-534 : provision FO par type, pour redériver celle d'une ligne v3 dont le type FO change.
  const foProvisionBySupplyTypeId = useMemo(() => foProvisionsBySupplyType(supplyTypes), [supplyTypes]);

  const supplyTypeIdByLowerName = useMemo(() => {
    const map = new Map<string, string>();
    supplyTypes.forEach((supplyType) => {
      const normalizedName = supplyType.name.trim().toLowerCase();
      if (!normalizedName) return;
      if (!map.has(normalizedName)) {
        map.set(normalizedName, supplyType.id);
      }
    });
    return map;
  }, [supplyTypes]);

  const laborRoleById = useMemo(() => {
    const map = new Map<string, LaborRole>();
    laborRoles.forEach((role) => {
      map.set(role.id, role);
    });
    return map;
  }, [laborRoles]);

  const deferredItems = useDeferredValue(items);
  // Lot 2, sous-lot 2.6 (revue, F26-25) : contrôles qualité d'une v3 sur les heures du moteur, jamais un h_mo périmé.
  const qualityItems = useMemo(() => resolveEditorQualityItems(deferredItems, v3Breakdown), [deferredItems, v3Breakdown]);

  const handleQualityVersionConflict = useCallback(
    (error: unknown) =>
      handleVersionConflict(error, {
        persistDraft: true,
      }),
    [handleVersionConflict]
  );
  const qualityController = useEstimateEditorQualityController({
    routeVersionId: resolvedVersionId,
    activeVersionId: version?.id ?? null,
    reloadToken: reloadNonce,
    items,
    deferredItems: qualityItems,
    categories,
    settings,
    isReadOnly,
    readOnlyErrorMessage: readOnlyActionErrorMessage,
    isConflictLocked,
    conflictMessage: conflictState?.message ?? null,
    reportError: setActionError,
    resolveErrorMessage: resolveEstimateActionError,
    onVersionConflict: handleQualityVersionConflict,
    openSettings: handleOpenSettingsDrawer,
  });
  const {
    qualityFilter,
    outlierConfig,
    dismissedOutlierFlagsByItemId,
    outlierActionPendingByItemId,
    isFinalizationPanelOpen,
    isChecklistCollapsed,
    scrollTargetItemId: checklistScrollTargetItemId,
  } = qualityController.state;
  const {
    changeQualityFilter: handleQualityFilterChange,
    changeOutlierMethod: handleOutlierMethodChange,
    changeOutlierThreshold: handleOutlierThresholdChange,
    toggleOutlierDismiss: handleToggleOutlierDismiss,
    toggleFinalizationPanel: handleToggleFinalizationPanel,
    toggleChecklistCollapsed: handleToggleChecklistCollapsed,
    selectChecklistCriterion: handleChecklistCriterionClick,
    showChecklistAnomalies: handleShowChecklistAnomalies,
    focusItem: handleChecklistFocusItem,
    markScrollHandled: handleChecklistScrollHandled,
  } = qualityController.actions;
  const {
    detectedOutlierFlagsByItemId,
    qualityFlagsByItemId,
    qualityCounts,
    checklist,
  } = qualityController.meta;

  useEffect(() => {
    if (!focusItemId) {
      return;
    }

    return deferEffectStateUpdate(() => {
      handleChecklistFocusItem(focusItemId);
    });
  }, [focusItemId, handleChecklistFocusItem]);

  const {
    computeLineValuesWithLaborContext,
    normalizePatchedItem,
  } = useEstimateEditorLineNormalization({
    laborRateById,
    laborRateAtelierById,
    laborRateChantierById,
    isLaborSplitEnabled,
    isV3,
    calcEngineVersion,
    settings,
    editorDocument,
    getItemsSnapshot,
    foProvisionBySupplyTypeId,
  });

  const {
    totals,
    editorDisplayItems,
    persistedTotals,
    computePersistedTotals,
  } = useEstimateEditorCalculation({
    items,
    settings,
    savedSettings,
    version,
    calcEngineVersion,
    isReadOnly,
    isLaborSplitEnabled,
    laborRateById,
    laborRateAtelierById,
    laborRateChantierById,
    v3Breakdown,
  });

  const exportController = useEstimateEditorExportController({
    versionId: resolvedVersionId,
    projectName,
    version,
    settings,
    totals,
    items: editorDisplayItems,
    supplyTypeById,
    laborRoleById,
    qualityFlagsByItemId,
    qualityCounts,
    isLaborSplitEnabled,
    isV3,
    reportError: setActionError,
    resolveErrorMessage: resolveEstimateActionError,
  });
  const {
    isExporting,
    activeMode: activeExportMode,
  } = exportController.state;
  const {
    exportExcel: handleExportExcel,
    exportCsv: handleExportCSV,
    exportDpgf: handleExportDpgf,
    exportBdc: handleExportBdc,
  } = exportController.actions;
  const {
    isStreamingDisabled: isStreamingExportDisabled,
    isCsvDisabled: isCsvExportDisabled,
    loadingLabel: exportLoadingLabel,
  } = exportController.meta;

  useLayoutEffect(() => {
    persistedTotalsRef.current = persistedTotals;
  }, [persistedTotals]);

  // A reload can discover committed structural writes whose header has not
  // yet been reconciled. Show the discrepancy without scheduling a new write.
  const calculatedVersionTotals = buildVersionTotalsPatch(persistedTotals);
  const hasStoredTotalsMismatch = Boolean(
    !isLoading && !loadError && version?.id === resolvedVersionId &&
    version.status === "draft" && reconcilesEditorTotals(version) && calculatedVersionTotals &&
    (version.total_ht_cents !== calculatedVersionTotals.total_ht_cents ||
      version.total_tax_cents !== calculatedVersionTotals.total_tax_cents ||
      version.total_ttc_cents !== calculatedVersionTotals.total_ttc_cents)
  );
  const showTotalsReconciliation = hasStoredTotalsMismatch &&
    (syncAutoSaveStatus === "idle" || syncAutoSaveStatus === "saved" || syncAutoSaveStatus === "disabled");
  const autoSaveStatus = showTotalsReconciliation ? "pending" : syncAutoSaveStatus;
  const autoSaveStatusLabel = showTotalsReconciliation
    ? "Totaux à synchroniser"
    : syncAutoSaveStatusLabel;

  const autoSaveStatusClassName = useMemo(
    () => estimateEditorAutoSaveStatusClassName(autoSaveStatus),
    [autoSaveStatus]
  );

  const updateSettings = useCallback(
    (patch: Partial<EstimateSettingsState>) => {
      if (!editorDocument.isCurrent(documentScope)) return;
      if (settingsSavePromiseRef.current?.versionId === activeRouteVersionIdRef.current) return;
      setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    },
    [setSettings, editorDocument, documentScope]
  );

  const reconcileEditorData = useCallback((refreshed: EstimateEditorData) => {
    if (!editorDocument.isCurrent(documentScope)) return;
    if (refreshed.version.id !== resolvedVersionId || refreshed.version.tenant_id !== readTenantId ||
        (versionRef.current?.id === resolvedVersionId &&
          isOlderEstimateVersionToken(refreshed.version.updated_at, versionRef.current.updated_at))) {
      throw new Error("Le devis relu a changé. Actualisez avant de poursuivre.");
    }
    foProvisionsRef.current = foProvisionsBySupplyType(refreshed.supplyTypes);
    editorDocument.acceptRead(prepareEstimateEditorRead(refreshed, isLaborSplitEnabled), deriveBufferedItem, documentScope);
  }, [editorDocument, documentScope, deriveBufferedItem, isLaborSplitEnabled, readTenantId, resolvedVersionId, versionRef]);

  const reloadItemsForStructuralMutation = useCallback(async () => {
    if (!resolvedVersionId || !editorDocument.isCurrent(documentScope)) return;
    const refreshed = await fetchEstimateEditorData(resolvedVersionId);
    if (editorDocument.isCurrent(documentScope)) reconcileEditorData(refreshed);
  }, [editorDocument, documentScope, reconcileEditorData, resolvedVersionId]);

  const reloadItems = useCallback(async () => {
    try {
      await reloadItemsForStructuralMutation();
    } catch (error) {
      if (!editorDocument.isCurrent(documentScope)) return;
      setActionError(error instanceof Error ? resolveEstimateActionError(error.message) : "Impossible de charger les lignes.");
    }
  }, [editorDocument, documentScope, reloadItemsForStructuralMutation]);

  function handleSaveSettings(): Promise<boolean | undefined> {
    if (!editorDocument.isCurrent(documentScope)) return Promise.resolve(undefined);
    if (settingsSavePromiseRef.current?.versionId === resolvedVersionId) {
      return settingsSavePromiseRef.current.promise;
    }
    const promise = performSaveSettings().finally(() => {
      if (settingsSavePromiseRef.current?.promise === promise) {
        settingsSavePromiseRef.current = null;
      }
    });
    settingsSavePromiseRef.current = { versionId: resolvedVersionId, promise };
    return promise;
  }

  function performSaveSettings() {
    return saveEstimateEditorSettings({
      editorDocument,
      documentScope,
      settings,
      version,
      totals,
      isV3,
      v3Settings,
      resolvedVersionId,
      isReadOnly,
      readOnlyActionErrorMessage,
      isConflictLocked,
      conflictState,
      settingsSaveGenerationRef,
      activeRouteVersionIdRef,
      versionRef,
      settingsSaveGuardRef,
      setActiveSettingsSave,
      setActionError,
      ensureGroupedActionCanProceed,
      handleOpenSettingsDrawer,
      getVersionSnapshot,
      recoverDraftLock,
      handleVersionConflict,
      clearUndoRedoHistory,
      discardBulkSuggestUndo,
      deriveBufferedItem,
      markItemsSynced,
      clearConflictDraft,
    });
  }

  const {
    createRole: handleCreateRole,
    updateRole: handleUpdateRole,
  } = useEstimateEditorLaborRolesController({
    editorDocument,
    documentScope,
    settingsSaveGuardRef,
    isReadOnly,
    readOnlyActionErrorMessage,
    isConflictLocked,
    conflictState,
    profile,
    laborRoles,
    setLaborRoles,
    version,
    getVersionSnapshot,
    itemsRef,
    setItems,
    isV3,
    settings,
    computeLineValuesWithLaborContext,
    enqueueBufferedItemUpdate,
    setActionError,
  });

  const canEditMarginTiers = profile?.tenant_role === "admin" && !isSaveBlocked;

  const applyItemCreationVersionToken = useCallback(
    (updatedAt: string, contentRevision?: number) => {
      applyVersionFlushResult({
        versionId: resolvedVersionId,
        totalsPatch: undefined,
        updatedAt,
        ...(contentRevision === undefined ? {} : { contentRevision }),
      });
    },
    [applyVersionFlushResult, resolvedVersionId]
  );

  const computeVersionTotalsPatch = useCallback(
    (nextItems: EditorEstimateItem[]) =>
      buildVersionTotalsPatch(computePersistedTotals(nextItems)),
    [computePersistedTotals]
  );

  const applyVersionTokenAndTotals = useCallback(
    (updatedAt: string, totalsPatch?: EstimateVersionTotalsPatch, contentRevision?: number) => {
      applyVersionFlushResult({
        versionId: resolvedVersionId,
        totalsPatch,
        updatedAt,
        ...(contentRevision === undefined ? {} : { contentRevision }),
      });
    },
    [applyVersionFlushResult, resolvedVersionId]
  );

  const itemsController = useEstimateEditorItemsController({
    document: editorDocument,
    version,
    settings,
    isLaborSplitEnabled,
    isMutationBlocked: isReadOnly || isConflictLocked,
    mutationBlockedMessage: isConflictLocked
      ? (conflictState?.message ?? ESTIMATE_VERSION_CONFLICT_MESSAGE)
      : readOnlyActionErrorMessage,
    getItemsSnapshot,
    getVersionSnapshot,
    setItems,
    setTotalsOutOfSync,
    reportError: setActionError,
    resolveErrorMessage: resolveEstimateActionError,
    normalizePatchedItem,
    applyVersionToken: applyItemCreationVersionToken,
    enqueueItemUpdate: enqueueBufferedItemUpdate,
    pushHistoryCommand,
    reloadItems,
    buildItemUpdatePayload: isV3 ? buildEstimateV3ItemUpdatePayload : undefined,
    v3Writer: isV3 ? ESTIMATE_V3_EDITOR_WRITER : undefined,
  });
  const {
    addSection: handleAddSection,
    addLine: handleAddLine,
    deleteItem: handleDeleteItem,
    patchItem: handlePatchItem,
    recreateItemsFromSnapshots,
    applySiblingOrder,
  } = itemsController.actions;

  const orderingController = useEstimateEditorOrderingController({
    document: editorDocument,
    isMutationBlocked: isReadOnly || isConflictLocked,
    mutationBlockedMessage: isConflictLocked
      ? (conflictState?.message ?? ESTIMATE_VERSION_CONFLICT_MESSAGE)
      : readOnlyActionErrorMessage,
    getItemsSnapshot,
    getVersionSnapshot,
    setItems,
    setTotalsOutOfSync,
    reportError: setActionError,
    resolveErrorMessage: resolveEstimateActionError,
    pushHistoryCommand,
  });
  const {
    reorder: handleReorder,
    move: handleMoveItem,
  } = orderingController.actions;

  const applyVersionToken = applyItemCreationVersionToken;

  const importController = useEstimateEditorImportController({
    document: editorDocument,
    routeVersionId: resolvedVersionId,
    activeVersion: version,
    autoOpenStructureDraft: shouldAutoOpenStructureDraft,
    isMutationBlocked: isReadOnly || isConflictLocked,
    mutationBlockedMessage: isConflictLocked
      ? (conflictState?.message ?? ESTIMATE_VERSION_CONFLICT_MESSAGE)
      : readOnlyActionErrorMessage,
    getVersionSnapshot,
    ensureGroupedActionCanProceed,
    applyVersionToken,
    handleVersionConflict,
    reloadItems: reloadItemsForStructuralMutation,
    setTotalsOutOfSync,
    reportError: setActionError,
    resolveErrorMessage: resolveEstimateActionError,
  });
  const {
    isLoadingLinkedDpgfSource,
    isImportingDpgfSource,
    isImportFromEstimateDialogOpen,
    isEstimateStructureDraftDialogOpen,
    isPriceReuseDialogOpen,
    importSummaryMessage,
  } = importController.state;
  const {
    importLinkedDpgfSource: handleImportDpgfSource,
    openImportFromEstimateDialog: openImportFromEstimateDialogAction,
    closeImportFromEstimateDialog,
    confirmImportFromEstimate: handleConfirmImportFromEstimateDialog,
    openEstimateStructureDraftDialog:
      openEstimateStructureDraftDialogAction,
    closeEstimateStructureDraftDialog:
      closeEstimateStructureDraftDialogAction,
    applyEstimateStructureDraft: handleConfirmEstimateStructureDraftDialog,
    openPriceReuseDialog: openPriceReuseDialogAction,
    closePriceReuseDialog,
    confirmPriceReuse: handleConfirmPriceReuse,
    clearImportSummary,
  } = importController.actions;
  const handleOpenPriceReuseDialog = useCallback(() => {
    clearImportSummary();
    openPriceReuseDialogAction();
  }, [clearImportSummary, openPriceReuseDialogAction]);
  const {
    hasLinkedDpgfSource,
    isImportDpgfSourceDisabled: isImportControllerDpgfSourceDisabled,
  } = importController.meta;
  const isImportDpgfSourceDisabled =
    isImportControllerDpgfSourceDisabled || isSaveBlocked || isExporting;

  const refreshAiVersionZeroSummary = useCallback(
    async (targetVersionId: string) => {
      const refreshed = await fetchEstimateEditorData(targetVersionId);
      if (refreshed.version.id !== targetVersionId) {
        throw new Error("Résumé V0 incohérent avec la version active.");
      }
      return refreshed.versionZeroSummary ?? null;
    },
    []
  );

  const refreshAfterAiMutation = useCallback(
    async (targetVersionId: string) => {
      const scope = editorDocument.captureScope();
      const data = await fetchEstimateEditorData(targetVersionId);
      if (data.version.id !== targetVersionId) throw new Error("Version rafraichie incoherente.");
      return { scope, data };
    },
    [editorDocument]
  );

  const applyAiMutationRefresh = useCallback(
    ({ scope, data }: Awaited<ReturnType<typeof refreshAfterAiMutation>>) => {
      if (editorDocument.isCurrent(scope)) reconcileEditorData(data);
    },
    [editorDocument, reconcileEditorData]
  );

  const aiDialogActionsRef = useRef<{
    openGeneratedOuvrageDialog: () => boolean;
    openVersionZeroDialog: () => boolean;
    dismissDialogs: () => void;
  }>({
    openGeneratedOuvrageDialog: () => false,
    openVersionZeroDialog: () => false,
    dismissDialogs: () => undefined,
  });
  const openGeneratedOuvrageDialogFromRef = useCallback(
    () => aiDialogActionsRef.current.openGeneratedOuvrageDialog(),
    []
  );
  const openVersionZeroDialogFromRef = useCallback(
    () => aiDialogActionsRef.current.openVersionZeroDialog(),
    []
  );
  const dismissAiDialogsFromRef = useCallback(
    () => aiDialogActionsRef.current.dismissDialogs(),
    []
  );

  const aiImportCoordinator = useEstimateEditorAiImportCoordinator({
    routeVersionId: resolvedVersionId,
    autoOpenVersionZero: shouldAutoOpenVersionZero,
    autoOpenStructureDraft: shouldAutoOpenStructureDraft,
    ensureGroupedActionCanProceed,
    openGeneratedOuvrageDialog: openGeneratedOuvrageDialogFromRef,
    openVersionZeroDialog: openVersionZeroDialogFromRef,
    dismissAiDialogs: dismissAiDialogsFromRef,
    openImportFromEstimateDialog: openImportFromEstimateDialogAction,
    closeImportFromEstimateDialog,
    openEstimateStructureDraftDialog:
      openEstimateStructureDraftDialogAction,
    closeEstimateStructureDraftDialog:
      closeEstimateStructureDraftDialogAction,
    clearImportSummary,
    refreshAfterAiMutation,
    applyAiMutationRefresh,
  });
  const {
    invalidateAfterAiMutation,
    openGeneratedOuvrageDialog: handleOpenGeneratedOuvrageDialog,
    openVersionZeroDialog: handleOpenVersionZeroDialog,
    openImportFromEstimateDialog: handleOpenImportFromEstimateDialog,
    openEstimateStructureDraftDialog:
      handleOpenEstimateStructureDraftDialog,
  } = aiImportCoordinator.actions;

  const aiDialogsController = useEstimateEditorAiDialogsController({
    actorId: profile?.id ?? null,
    tenantId: version?.tenant_id ?? null,
    routeVersionId: resolvedVersionId,
    activeVersion: version,
    items,
    isMutationBlocked: isReadOnly || isConflictLocked,
    mutationBlockedMessage: isConflictLocked
      ? (conflictState?.message ?? ESTIMATE_VERSION_CONFLICT_MESSAGE)
      : readOnlyActionErrorMessage,
    ensureMutationCanProceed: ensureGroupedActionCanProceed,
    reportError: setActionError,
    resolveErrorMessage: resolveEstimateActionError,
    refreshVersionZeroSummary: refreshAiVersionZeroSummary,
    invalidateAfterMutation: invalidateAfterAiMutation,
  });
  const {
    isGeneratedOuvrageDialogOpen,
    isVersionZeroDialogOpen,
    highlightedItemIds,
  } = aiDialogsController.state;
  const {
    openGeneratedOuvrageDialog,
    openVersionZeroDialog,
    dismissDialogs: dismissAiDialogs,
    hydrateVersionZeroSummary: hydrateAiVersionZeroSummary,
    highlightItems: highlightAiMutationItems,
  } = aiDialogsController.actions;
  const {
    existingSections: existingAiSections,
    generatedOuvrageDialogProps,
    versionZeroDraftDialogProps,
    versionZeroActionLabel,
    isVersionZeroActionDisabled,
  } = aiDialogsController.meta;

  // The line the editor is opened on is highlighted once its version is shown (the scroll above waits for its row).
  useFocusItemHighlight(focusItemId, version?.id === resolvedVersionId, highlightAiMutationItems);

  useLayoutEffect(() => {
    aiDialogActionsRef.current = {
      openGeneratedOuvrageDialog,
      openVersionZeroDialog,
      dismissDialogs: dismissAiDialogs,
    };
    hydrateAiVersionZeroSummaryRef.current = hydrateAiVersionZeroSummary;
    return () => {
      aiDialogActionsRef.current = {
        openGeneratedOuvrageDialog: () => false,
        openVersionZeroDialog: () => false,
        dismissDialogs: () => undefined,
      };
      hydrateAiVersionZeroSummaryRef.current = () => undefined;
    };
  }, [
    dismissAiDialogs,
    hydrateAiVersionZeroSummary,
    openGeneratedOuvrageDialog,
    openVersionZeroDialog,
  ]);

  const suggestionsController = useEstimateEditorSuggestionsController({
    document: editorDocument,
    routeVersionId: resolvedVersionId,
    currentUserId: profile?.id ?? null,
    previewItems: deferredItems,
    categories,
    isMutationBlocked: isReadOnly || isConflictLocked,
    mutationBlockedMessage: isConflictLocked
      ? (conflictState?.message ?? ESTIMATE_VERSION_CONFLICT_MESSAGE)
      : readOnlyActionErrorMessage,
    getItemsSnapshot,
    getVersionSnapshot,
    setItems,
    normalizeLine: normalizePatchedItem,
    setTotalsOutOfSync,
    reportError: setActionError,
    resolveErrorMessage: resolveEstimateActionError,
    ensureGroupedActionCanProceed,
    computeVersionTotalsPatch,
    applyVersionToken: applyVersionTokenAndTotals,
    markItemsSynced,
    handleVersionConflict,
    v3Writer: isV3 ? ESTIMATE_V3_EDITOR_WRITER : undefined,
  });
  const {
    rules: suggestionRules,
    learningState: suggestionLearningState,
    isSavingRules,
    rulesError,
    isDialogOpen: isBulkSuggestDialogOpen,
    selectedItemIds: selectedBulkSuggestItemIds,
    dialogError: bulkSuggestDialogError,
    isApplying: isApplyingBulkSuggest,
    progress: bulkSuggestProgress,
    isUndoing: isUndoingBulkSuggest,
  } = suggestionsController.state;
  const {
    hydrate: hydrateSuggestions,
    createRule: handleCreateSuggestionRule,
    updateRule: handleUpdateSuggestionRule,
    trackCorrections: handleTrackSuggestionCorrections,
    openDialog: handleOpenBulkSuggestDialog,
    closeDialog: handleCloseBulkSuggestDialog,
    toggleItem: handleToggleBulkSuggestItem,
    toggleAll: handleToggleAllBulkSuggestItems,
    applySelected: handleApplyBulkSuggest,
    undoLastApply: handleUndoBulkSuggest,
    discardUndo: discardBulkSuggestUndo,
  } = suggestionsController.actions;
  const {
    preview: bulkSuggestPreview,
    eligibleCount: bulkSuggestionEligibleCount,
    showProgress: showBulkSuggestProgress,
    appliedCount: bulkSuggestAppliedCount,
  } = suggestionsController.meta;

  useEffect(() => {
    if (!suggestionsHydration) return;
    return deferEffectStateUpdate(() => {
      hydrateSuggestions(suggestionsHydration);
    });
  }, [hydrateSuggestions, suggestionsHydration]);

  const applyStatusVersion = useCallback((updatedVersion: EstimateVersionRow) => {
    setVersion((previous) =>
      previous?.id === updatedVersion.id
        ? {
            ...previous,
            status: updatedVersion.status,
            updated_at: updatedVersion.updated_at,
            seal_hash: updatedVersion.seal_hash ?? previous.seal_hash,
          }
        : previous
    );
  }, [setVersion]);

  // A PDF generated from the send-blocked alert lifts « PDF absent »: the gating is read again (TI-691).
  const [pdfGatingNonce, setPdfGatingNonce] = useState(0);
  const requestPdfGatingRead = useCallback(() => setPdfGatingNonce((value) => value + 1), []);

  const statusController = useEstimateEditorStatusController({
    document: editorDocument,
    routeVersionId: resolvedVersionId,
    activeVersion: version
      ? {
          id: version.id,
          status: version.status,
          updated_at: version.updated_at,
        }
      : null,
    gatingReloadToken: `${reloadNonce}:${pdfGatingNonce}`,
    getVersionSnapshot,
    applyUpdatedVersion: applyStatusVersion,
    isAdmin,
    isViewerReadOnly,
    isHistoryBlocked,
    hasPendingSettingsChanges: hasUnsavedSettings,
    openSettings: handleOpenSettingsDrawer,
    isConflictLocked,
    conflictMessage: conflictState?.message ?? null,
    isDraftLockPending,
    isDraftLockedByOther,
    draftLockedByOtherMessage: `Verrouillé par ${lockHolderLabel}.`,
    isDraftLockAcquiring,
    isForcingDraftUnlock,
    isFlushInProgress,
    flushBufferedItemUpdates,
    hasPendingUpdatesNow,
    releaseDraftLock,
    handleVersionConflict,
    resolveErrorMessage: resolveEstimateActionError,
    refreshTimeline: loadTimelineEvents,
  });
  const {
    error: statusError,
    isUpdatingStatus,
    sendGating,
    isSendGatingDialogOpen,
  } = statusController.state;
  const {
    confirmSend: handleConfirmSend,
    changeStatus: handleStatusChange,
    closeSendGatingDialog,
  } = statusController.actions;
  const {
    canSend: canSendForStatus,
    canAccept,
    canArchive,
    isStatusActionsDisabled,
    isSendBlockedForCurrentUser,
    sendBlockingFlags,
    isSendGatingRefreshing,
    sendWorkflowPhaseLabel,
  } = statusController.meta;
  // Lot 2 : fermée en 2.6, l'émission manuelle d'une v3 est ouverte par 2.7 (gel du document, contrat client 2).
  const canSend = canSendForStatus && !isViewerReadOnly;

  const supplierController = useEstimateEditorSupplierController({
    document: editorDocument,
    routeVersionId: resolvedVersionId,
    items,
    isMutationBlocked: isReadOnly || isConflictLocked,
    mutationBlockedMessage: isConflictLocked
      ? (conflictState?.message ?? ESTIMATE_VERSION_CONFLICT_MESSAGE)
      : readOnlyActionErrorMessage,
    getItemsSnapshot,
    getVersionSnapshot,
    normalizeLine: normalizePatchedItem,
    setItems,
    setTotalsOutOfSync,
    reportError: setActionError,
    resolveErrorMessage: resolveEstimateActionError,
    computeVersionTotalsPatch,
    applyVersionToken: applyVersionTokenAndTotals,
    markItemsSynced,
    ensureGroupedActionCanProceed,
    handleVersionConflict,
  });
  const {
    isOpen: isSupplierPreselectionDialogOpen,
    review: supplierPreselectionReview,
    selectedItemIds: selectedSupplierPreselectionItemIds,
    error: supplierPreselectionDialogError,
    isLoading: isLoadingSupplierPreselection,
    isApplying: isApplyingSupplierPreselection,
  } = supplierController.state;
  const {
    open: handleOpenSupplierPreselectionDialog,
    close: handleCloseSupplierPreselectionDialog,
    toggleItem: handleToggleSupplierPreselectionItem,
    toggleAll: handleToggleAllSupplierPreselectionItems,
    apply: handleApplySupplierPreselection,
  } = supplierController.actions;
  const { eligibleCount: supplierPreselectionEligibleCount } =
    supplierController.meta;
  const handleConfirmSupplierPreselection = handleApplySupplierPreselection;

  const bulkController = useEstimateEditorBulkController({
    document: editorDocument,
    isMutationBlocked: isReadOnly || isConflictLocked,
    mutationBlockedMessage: isConflictLocked
      ? (conflictState?.message ?? ESTIMATE_VERSION_CONFLICT_MESSAGE)
      : readOnlyActionErrorMessage,
    isLaborSplitEnabled,
    getItemsSnapshot,
    getVersionSnapshot,
    setItems,
    setTotalsOutOfSync,
    reportError: setActionError,
    resolveErrorMessage: resolveEstimateActionError,
    normalizeLine: normalizePatchedItem,
    computeVersionTotalsPatch,
    applyVersionToken: applyVersionTokenAndTotals,
    markItemsSynced,
    ensureGroupedActionCanProceed,
    handleVersionConflict,
    triggerVersionReload,
    pushHistoryCommand,
    recreateItemsFromSnapshots,
    applySiblingOrder,
    reloadItems,
    v3Writer: isV3 ? ESTIMATE_V3_EDITOR_WRITER : undefined,
  });
  const {
    applyBulkCellPatches: handleApplyCellPatches,
    applyBulkMajoration: handleApplyBulkMajoration,
    bulkDeleteLines: handleBulkDeleteLines,
    bulkMoveLines: handleBulkMoveLines,
    bulkSetCategory: handleBulkSetCategory,
    bulkSetLaborRole: handleBulkSetLaborRole,
  } = bulkController.actions;

  const pasteController = useEstimateEditorPasteController({
    document: editorDocument,
    settings,
    isLaborSplitEnabled,
    isMutationBlocked: isReadOnly || isConflictLocked,
    mutationBlockedMessage: isConflictLocked
      ? (conflictState?.message ?? ESTIMATE_VERSION_CONFLICT_MESSAGE)
      : readOnlyActionErrorMessage,
    supplyTypeIdByLowerName,
    getItemsSnapshot,
    getVersionSnapshot,
    setItems,
    setTotalsOutOfSync,
    reportError: setActionError,
    resolveErrorMessage: resolveEstimateActionError,
    applyVersionToken,
    ensureGroupedActionCanProceed,
    handleVersionConflict,
    triggerVersionReload,
    pushHistoryCommand,
    recreateItemsFromSnapshots,
    reloadItems,
    v3Writer: isV3 ? ESTIMATE_V3_EDITOR_WRITER : undefined,
  });
  const {
    pasteRows: handlePasteRows,
    insertLineBelow: handleInsertLineBelow,
    duplicateLineBelow: handleDuplicateLineBelow,
    insertSectionBelow: handleInsertSectionBelow,
  } = pasteController.actions;

  const structureController = useEstimateEditorStructureController({
    document: editorDocument,
    routeVersionId: resolvedVersionId,
    isMutationBlocked: isReadOnly || isConflictLocked,
    isHistoryMutationBlocked: isSyncReadOnly || isConflictLocked,
    mutationBlockedMessage: isConflictLocked
      ? (conflictState?.message ?? ESTIMATE_VERSION_CONFLICT_MESSAGE)
      : readOnlyActionErrorMessage,
    getItemsSnapshot,
    getVersionSnapshot,
    setItems,
    setTotalsOutOfSync,
    highlightItems: highlightAiMutationItems,
    reportError: setActionError,
    resolveErrorMessage: resolveEstimateActionError,
    applyVersionToken,
    handleVersionConflict,
    ensureGroupedActionCanProceed,
    pushHistoryCommand,
    reloadItems: reloadItemsForStructuralMutation,
    onResizeConfirmed: reconcileEditorData,
    convertV3Items: isV3 ? convertEstimateV3Items : undefined,
    clearHistory: clearUndoRedoHistory,
  });
  const {
    resizeAssembly: handleResizeOuvrage,
    insertAssembly: handleInsertAssembly,
    insertTemplate: handleInsertTemplate,
    duplicateSection: handleDuplicateSection,
    convertItems: handleConvertItems,
  } = structureController.actions;

  const handleDuplicateSectionToVersion = useEstimateEditorSectionCopyToVersion({
    isReadOnly,
    readOnlyActionErrorMessage,
    isConflictLocked,
    conflictState,
    versionRef,
    hasUnsavedSettings,
    ensureGroupedActionCanProceed,
    handleDuplicateSection,
    setActionError,
  });

  // The table recomputes every section total when this object changes: keep it across unrelated renders.
  const sectionCalculation = useMemo<EstimateEditorTableProps["sectionCalculation"]>(
    () => ({
      marginMode: settings?.margin_mode ?? "fixed",
      marginTiers: settings?.margin_tiers ?? [],
      globalCoefficient: settings?.global_coefficient ?? 1,
      discountMode: settings?.discount_mode ?? "simple",
      discountStepsBp: settings?.discount_steps ?? [],
      calcEngineVersion,
      // v3 : les sections somment les nets de l'aperçu, sans calcul v2.
      preserveStoredSnapshot: isReadOnly || isV3,
    }),
    [
      calcEngineVersion,
      isReadOnly,
      isV3,
      settings?.discount_mode,
      settings?.discount_steps,
      settings?.global_coefficient,
      settings?.margin_mode,
      settings?.margin_tiers,
    ]
  );

  const editorTableProps = useMemo<EstimateEditorTableProps>(
    () => ({
      projectId: version?.project_id,
      versionId: version?.id ?? resolvedVersionId,
      items: editorDisplayItems,
      categories,
      supplyTypes,
      laborRoles,
      suggestionRules,
      learningState: suggestionLearningState,
      detectedOutlierFlagsByItemId,
      dismissedOutlierFlagsByItemId,
      outlierActionPendingByItemId,
      outlierDetectionMethod: outlierConfig.method,
      outlierThreshold: outlierConfig.threshold,
      qualityFlagsByItemId,
      qualityCounts,
      qualityFilter,
      marginMultiplier:
        totals?.appliedMarginMultiplier ?? editorTableBaseConfig.marginMultiplier,
      discountCents: totals?.discountCents ?? editorTableBaseConfig.discountCents,
      taxRateBp: editorTableBaseConfig.taxRateBp,
      sectionCalculation,
      currency: settings?.currency ?? DEFAULT_ESTIMATE_CURRENCY,
      laborRateById,
      isLaborSplitEnabled,
      isReadOnly: editorTableBaseConfig.isReadOnly,
      isViewerMode: isViewerReadOnly,
      maxSectionDepth: version?.max_section_depth ?? undefined,
      onQualityFilterChange: handleQualityFilterChange,
      onOutlierDetectionMethodChange: handleOutlierMethodChange,
      onOutlierThresholdChange: handleOutlierThresholdChange,
      onToggleOutlierDismiss: handleToggleOutlierDismiss,
      onAddSection: handleAddSection,
      onAddLine: handleAddLine,
      onResizeOuvrage: handleResizeOuvrage,
      onInsertAssembly: handleInsertAssembly,
      onInsertTemplate: handleInsertTemplate,
      sectionDuplicateTargets,
      onDuplicateSection: handleDuplicateSection,
      onDuplicateSectionToVersion: handleDuplicateSectionToVersion,
      // Lot 3.2, entrée 1 (D-b) : v3, conversion ligne ↔ section par un lot de l'écrivain v3.
      onConvertItems: isV3 ? handleConvertItems : undefined,
      onOpenImportFromEstimateDialog: handleOpenImportFromEstimateDialog,
      // Reprise des prix d'un devis de référence : écrivain de lot v3 seulement (docs/metier/reprise-des-prix.md).
      onOpenPriceReuseDialog: isV3 ? handleOpenPriceReuseDialog : undefined,
      onOpenEstimateStructureDraftDialog: handleOpenEstimateStructureDraftDialog,
      onOpenGeneratedOuvrageDialog: handleOpenGeneratedOuvrageDialog,
      onDeleteItem: handleDeleteItem,
      onPatchItem: handlePatchItem,
      onTrackSuggestionCorrections: handleTrackSuggestionCorrections,
      onApplyCellPatches: handleApplyCellPatches,
      onApplyBulkMajoration: handleApplyBulkMajoration,
      onBulkDeleteLines: handleBulkDeleteLines,
      onBulkMoveLines: handleBulkMoveLines,
      onBulkSetCategory: handleBulkSetCategory,
      onBulkSetLaborRole: handleBulkSetLaborRole,
      onPasteRows: handlePasteRows,
      onInsertLineBelow: handleInsertLineBelow,
      onDuplicateLineBelow: handleDuplicateLineBelow,
      onInsertSectionBelow: handleInsertSectionBelow,
      onUndo: handleUndo,
      onRedo: handleRedo,
      canUndo,
      canRedo,
      isUndoRedoBusy,
      bulkSuggestionEligibleCount,
      supplierPreselectionEligibleCount,
      onOpenBulkSuggestDialog: handleOpenBulkSuggestDialog,
      onOpenSupplierPreselectionDialog: () => void handleOpenSupplierPreselectionDialog(),
      onReorder: handleReorder,
      onMoveItem: handleMoveItem,
      scrollToItemId: checklistScrollTargetItemId,
      onScrollToItemHandled: handleChecklistScrollHandled,
      virtualization: editorTableVirtualization,
      highlightedItemIds,
      onOpenSettings: () => handleOpenSettingsDrawer(),
      isFinalizationPanelOpen,
      onToggleFinalizationPanel: handleToggleFinalizationPanel,
    }),
    [
      categories,
      detectedOutlierFlagsByItemId,
      dismissedOutlierFlagsByItemId,
      editorTableBaseConfig,
      editorTableVirtualization,
      editorDisplayItems,
      highlightedItemIds,
      handleAddLine,
      handleAddSection,
      handleResizeOuvrage,
      handleInsertAssembly,
      handleInsertTemplate,
      handleDuplicateSection,
      handleDuplicateSectionToVersion,
      handleConvertItems,
      handleOpenImportFromEstimateDialog,
      handleOpenPriceReuseDialog,
      handleOpenEstimateStructureDraftDialog,
      handleOpenGeneratedOuvrageDialog,
      handleApplyCellPatches,
      handleApplyBulkMajoration,
      handleBulkDeleteLines,
      handleBulkMoveLines,
      handleBulkSetCategory,
      handleBulkSetLaborRole,
      handlePasteRows,
      handleInsertLineBelow,
      handleDuplicateLineBelow,
      handleInsertSectionBelow,
      handleUndo,
      handleRedo,
      handleDeleteItem,
      handleOutlierMethodChange,
      handlePatchItem,
      handleOutlierThresholdChange,
      handleQualityFilterChange,
      handleChecklistScrollHandled,
      handleOpenSettingsDrawer,
      handleReorder,
      handleMoveItem,
      handleOpenBulkSuggestDialog,
      handleOpenSupplierPreselectionDialog,
      handleToggleOutlierDismiss,
      canUndo,
      canRedo,
      isUndoRedoBusy,
      isLaborSplitEnabled,
      isV3,
      isViewerReadOnly,
      laborRateById,
      laborRoles,
      outlierActionPendingByItemId,
      sectionCalculation,
      sectionDuplicateTargets,
      outlierConfig.method,
      outlierConfig.threshold,
      qualityCounts,
      qualityFilter,
      qualityFlagsByItemId,
      handleTrackSuggestionCorrections,
      supplyTypes,
      suggestionRules,
      suggestionLearningState,
      bulkSuggestionEligibleCount,
      supplierPreselectionEligibleCount,
      checklistScrollTargetItemId,
      isFinalizationPanelOpen,
      handleToggleFinalizationPanel,
      settings?.currency,
      totals?.appliedMarginMultiplier,
      totals?.discountCents,
      version?.project_id,
      version?.id,
      version?.max_section_depth,
      resolvedVersionId,
    ]
  );
  const checklistProps = useMemo<EstimateChecklistProps | null>(
    () =>
      isFinalizationPanelOpen
        ? {
            checklist,
            isCollapsed: isChecklistCollapsed,
            anomalyCount: qualityCounts.totalFlagsCount,
            affectedLineCount: qualityCounts.linesWithAnomaliesCount,
            onToggleCollapsed: handleToggleChecklistCollapsed,
            onCriterionClick: handleChecklistCriterionClick,
            onShowAnomalies: handleShowChecklistAnomalies,
          }
        : null,
    [
      checklist,
      handleChecklistCriterionClick,
      handleShowChecklistAnomalies,
      handleToggleChecklistCollapsed,
      isChecklistCollapsed,
      isFinalizationPanelOpen,
      qualityCounts.linesWithAnomaliesCount,
      qualityCounts.totalFlagsCount,
    ]
  );

  const { requestSend: recheckSend } = statusController.actions;
  const {
    canDeclareOfferReserve,
    saveOfferChoice,
    suggestEstablishedOn,
    reservedLineTitles,
    provisionalQuantityMentions,
    statusReasonLines,
    saveStatusReasonFromSendDialog,
    reserveLines,
    openLimitsFromSendDialog,
  } = useEstimateEditorOfferChoices({
    profile,
    isReadOnly,
    isConflictLocked,
    isViewerReadOnly,
    editorDocument,
    documentScope,
    versionRef,
    resolvedVersionId,
    isV3,
    items,
    sendGating,
    flushBufferedItemUpdates,
    handlePatchItem,
    recheckSend,
    closeSendGatingDialog,
    handleOpenSettingsDrawer,
  });

  const v3Grid = useMemo<EstimateV3GridModel | null>(
    () => (v3Breakdown === undefined ? null : {
      lines: indexEstimateV3Lines(v3Breakdown), allowedTaxRatesBp,
      saleCoefficientFo: v3Breakdown?.params.sale_coefficient_fo ?? null,
      offerReserve: { canDeclare: canDeclareOfferReserve, save: saveOfferChoice, suggestEstablishedOn },
    }),
    [v3Breakdown, allowedTaxRatesBp, canDeclareOfferReserve, saveOfferChoice, suggestEstablishedOn]
  );
  const closeEstimateStructureDraftDialog = useCallback(
    (result?: { createdItemIds?: string[]; mergedItemIds?: string[] }) => {
      closeEstimateStructureDraftDialogAction();
      if (result) {
        const ids = [
          ...(result.createdItemIds ?? []),
          ...(result.mergedItemIds ?? []),
        ];
        if (ids.length > 0) {
          highlightAiMutationItems(ids);
        }
      }
    },
    [closeEstimateStructureDraftDialogAction, highlightAiMutationItems]
  );
  const toolbarProps: EstimateEditorToolbarProps | null = version
    ? {
        projectName,
        versionNumber: version.version_number,
        status: version.status,
        autoSaveStatus,
        autoSaveStatusLabel,
        autoSaveStatusClassName,
        showAutoSaveStatus: version.status === "draft",
        isAutoSaveEnabled,
        hasPendingChanges,
        lastSavedAt: resolveLatestSavedAt(lastSavedAt, version.updated_at),
        isSaveNowDisabled:
          (!hasPendingChanges && (!hasStoredTotalsMismatch || hasRestorableDraft)) ||
          isSaveBlocked ||
          isAutoSaveSaving ||
          isSavingSettings,
        onAutoSaveEnabledChange: setAutoSaveEnabled,
        onSaveNow: () => {
          if (hasUnsavedSettings) {
            void handleSaveSettings();
            return;
          }
          void saveNow();
        },
        onBeforeGeneratePdf: flushBeforeExternalAction,
        onPdfPrepared: reconcileEditorData,
        onPdfReady: requestPdfGatingRead,
        canSend,
        canAccept,
        canArchive,
        isStatusActionsDisabled,
        isUpdatingStatus,
        isDraftLockedByOther,
        isDraftLockAcquiring,
        isForcingDraftUnlock,
        onSend: () => void handleStatusChange("sent"),
        onAccept: () => void handleStatusChange("accepted"),
        onOpenExclusions: () => handleOpenSettingsDrawer("exclusions"),
        onArchive: () => void handleStatusChange("archived"),
        onExportExcel: () => void handleExportExcel(),
        onExportCSV: () => void handleExportCSV(),
        onExportDpgf: () => void handleExportDpgf(),
        onExportBdc: () => void handleExportBdc(),
        onImportDpgfSource: () => void handleImportDpgfSource(),
        showImportDpgfSource: hasLinkedDpgfSource || isLoadingLinkedDpgfSource,
        onOpenVersionZeroDialog: handleOpenVersionZeroDialog,
        versionZeroActionLabel,
        isVersionZeroActionDisabled,
        // Excel et DPGF : GET …/export, ouvert à une v3 par 2.7 (v3-export.ts). CSV et BDC V1.1 d'une v3 : même route,
        // ouverts par 2.7b (D-a ; v3-csv-export.ts, branche v3 de bdc-export.ts) ; le drapeau CSV suit alors le streaming.
        isExcelExportDisabled: isStreamingExportDisabled,
        isDpgfExportDisabled: isStreamingExportDisabled,
        isCsvExportDisabled,
        isBdcExportDisabled: isStreamingExportDisabled,
        isExporting,
        exportLoadingLabel,
        activeExportMode,
        isImportingDpgfSource,
        isImportDpgfSourceDisabled,
        versionId,
      }
    : null;

  const alertsProps = useMemo<EstimateEditorAlertsProps>(
    () => ({
      statusError,
      isViewerReadOnly,
      canSend,
      isSendBlockedForCurrentUser,
      sendBlockingFlags,
      versionId: version?.id ?? null,
      projectId: version?.project_id ?? null,
      onBeforeGeneratePdf: flushBeforeExternalAction,
      onPdfPrepared: reconcileEditorData,
      onPdfReady: requestPdfGatingRead,
      isDraftLockedByOther,
      lockHolderLabel,
      isAdmin,
      isForcingDraftUnlock,
      onForceUnlockDraftLock: handleForceUnlockDraftLock,
      draftLockError,
      conflictMessage: conflictState?.message ?? null,
      isReloadingVersion,
      onReloadAfterConflict: handleReloadAfterConflict,
      hasRestorableDraft,
      onRestoreConflictDraft: handleRestoreConflictDraft,
      totalsOutOfSync,
      isTotalCapped: totals?.isCapped === true,
      isSaveBlocked,
      onRetryTotalsSave: retryTotalsSave,
      isStatusReadOnly,
      bulkSuggestAppliedCount,
      onUndoBulkSuggest: handleUndoBulkSuggest,
      isUndoingBulkSuggest,
      // The undo is shown once the lines are written, while the apply still sends its rule feedback;
      // undoLastApply refuses to run during the apply, so the button waits for its end. It also waits
      // for the gating read of the new token: its answer may add or remove the send-blocked alert
      // above the button and move it under a press.
      isUndoBulkSuggestDisabled: isSaveBlocked || isApplyingBulkSuggest || isSendGatingRefreshing,
      importSummaryMessage,
      actionNotice,
      actionError: displayedActionError,
      batchRecovery,
    }),
    [
      batchRecovery,
      displayedActionError,
      actionNotice,
      bulkSuggestAppliedCount,
      canSend,
      conflictState?.message,
      draftLockError,
      handleForceUnlockDraftLock,
      handleReloadAfterConflict,
      handleRestoreConflictDraft,
      handleUndoBulkSuggest,
      importSummaryMessage,
      isAdmin,
      isApplyingBulkSuggest,
      isDraftLockedByOther,
      isForcingDraftUnlock,
      hasRestorableDraft,
      isReloadingVersion,
      isSaveBlocked,
      isSendBlockedForCurrentUser,
      isSendGatingRefreshing,
      isStatusReadOnly,
      sendBlockingFlags,
      version?.id,
      version?.project_id,
      flushBeforeExternalAction,
      reconcileEditorData,
      requestPdfGatingRead,
      isUndoingBulkSuggest,
      isViewerReadOnly,
      lockHolderLabel,
      retryTotalsSave,
      statusError,
      totalsOutOfSync,
      totals,
    ]
  );

  const summaryBarProps = useMemo<EstimateSettingsSummaryBarProps | null>(
    () =>
      settings
        ? {
            totals,
            currency: settings.currency ?? DEFAULT_ESTIMATE_CURRENCY,
            taxRateBp: settings.tax_rate_bp ?? DEFAULT_TAX_RATE_BP,
            isExpert,
            onOpenSettings: handleOpenSettingsDrawer,
            v3Summary: v3Breakdown === undefined ? undefined : buildEstimateV3SummaryView(v3Breakdown),
            missingSupplyCostCount: qualityCounts.byFlag.missing_price,
          }
        : null,
    [handleOpenSettingsDrawer, isExpert, qualityCounts.byFlag.missing_price, settings, totals, v3Breakdown]
  );

  const storedMarginMultiplier = resolveEditorStoredMarginMultiplier({ isV3, calcEngineVersion, version, settings });

  const drawerProps: EstimateEditorDrawerProps | null =
    version && settings
      ? {
          isOpen: isSettingsDrawerOpen,
          onClose: closeSettingsDrawer,
          hasUnsavedSettings,
          onDiscardSettings: () => {
            editorDocument.discardSettings();
            v3Settings?.reset();
          },
          v3Settings,
          showMarginTiers: !isV3,
          onSaveBeforeClose: async () => (await handleSaveSettings()) === true,
          projectName,
          versionNumber: version.version_number,
          settings,
          totals,
          isSavingSettings,
          isSaveBlocked,
          recovery: batchRecovery,
          isFrozen: version.status !== "draft",
          storedMarginMultiplier,
          reservedLineTitles,
          provisionalQuantityMentions,
          onChangeSettings: updateSettings,
          onSaveSettings: handleSaveSettings,
          laborRoles,
          onCreateRole: handleCreateRole,
          onUpdateRole: handleUpdateRole,
          isSavingMarginTiers,
          marginTiersError,
          canEditMarginTiers,
          onCreateTier: handleCreateTier,
          onUpdateTier: handleUpdateTier,
          onDeleteTier: handleDeleteTier,
          suggestionRules,
          categories,
          isSavingRules,
          rulesError,
          onCreateSuggestionRule: handleCreateSuggestionRule,
          onUpdateSuggestionRule: handleUpdateSuggestionRule,
          isAdmin,
          timelineEvents,
          isTimelineLoading,
          timelineError,
          onRefreshTimeline: () => {
            void loadTimelineEvents();
          },
          isAuditLoading,
          auditError,
          auditLogs,
          onRefreshAuditLogs: () => {
            void loadAuditLogs();
          },
          formatAuditTimestamp: formatEstimateEditorAuditTimestamp,
        }
      : null;

  const bulkSuggestDialogProps = useMemo<BulkSuggestDialogProps>(
    () => ({
      isOpen: isBulkSuggestDialogOpen,
      rows: bulkSuggestPreview,
      selectedItemIds: selectedBulkSuggestItemIds,
      isApplying: isApplyingBulkSuggest,
      progress: bulkSuggestProgress,
      showProgress: showBulkSuggestProgress,
      error: bulkSuggestDialogError,
      onClose: handleCloseBulkSuggestDialog,
      onConfirm: () => void handleApplyBulkSuggest(),
      onToggleItem: handleToggleBulkSuggestItem,
      onToggleAll: handleToggleAllBulkSuggestItems,
    }),
    [
      bulkSuggestDialogError,
      bulkSuggestPreview,
      bulkSuggestProgress,
      handleApplyBulkSuggest,
      handleCloseBulkSuggestDialog,
      handleToggleAllBulkSuggestItems,
      handleToggleBulkSuggestItem,
      isApplyingBulkSuggest,
      isBulkSuggestDialogOpen,
      selectedBulkSuggestItemIds,
      showBulkSuggestProgress,
    ]
  );

  const supplierPreselectionDialogProps: SupplierPreselectionDialogProps = {
    isOpen: isSupplierPreselectionDialogOpen,
    review: supplierPreselectionReview,
    selectedItemIds: selectedSupplierPreselectionItemIds,
    isLoading: isLoadingSupplierPreselection,
    isApplying: isApplyingSupplierPreselection,
    error: supplierPreselectionDialogError,
    onClose: handleCloseSupplierPreselectionDialog,
    onConfirm: handleConfirmSupplierPreselection,
    onToggleItem: handleToggleSupplierPreselectionItem,
    onToggleAll: handleToggleAllSupplierPreselectionItems,
  };

  const importFromEstimateDialogProps = useMemo<ImportFromEstimateDialogProps | null>(
    () =>
      isImportFromEstimateDialogOpen && version
        ? {
            isOpen: true,
            targetVersionId: version.id,
            onClose: closeImportFromEstimateDialog,
            onConfirm: handleConfirmImportFromEstimateDialog,
          }
        : null,
    [
      closeImportFromEstimateDialog,
      handleConfirmImportFromEstimateDialog,
      isImportFromEstimateDialogOpen,
      version,
    ]
  );

  const priceReuseDialogProps = useMemo<PriceReuseDialogProps | null>(
    () =>
      isPriceReuseDialogOpen && version
        ? { isOpen: true, targetVersionId: version.id, onClose: closePriceReuseDialog, onConfirm: handleConfirmPriceReuse,
            prepareComparison: () => ensureGroupedActionCanProceed("comparer avec le devis de référence") }
        : null,
    [closePriceReuseDialog, ensureGroupedActionCanProceed, handleConfirmPriceReuse, isPriceReuseDialogOpen, version]
  );

  const estimateStructureDraftDialogProps = useMemo<EstimateStructureDraftDialogProps | null>(
    () => {
      if (!isEstimateStructureDraftDialogOpen || !version) {
        return null;
      }

      return {
        isOpen: true,
        targetVersionId: version.id,
        hasExistingItems: items.length > 0,
        existingSections: existingAiSections,
        onClose: closeEstimateStructureDraftDialog,
        onConfirm: handleConfirmEstimateStructureDraftDialog,
      };
    },
    [
      closeEstimateStructureDraftDialog,
      existingAiSections,
      handleConfirmEstimateStructureDraftDialog,
      isEstimateStructureDraftDialogOpen,
      items,
      version,
    ]
  );

  const sendGatingDialogProps: EstimateSendGatingDialogProps = {
    isOpen: isSendGatingDialogOpen,
    isSubmitting: isUpdatingStatus,
    phaseLabel: sendWorkflowPhaseLabel,
    blockingFlags: sendGating?.blockingFlags ?? [],
    warningFlags: sendGating?.warningFlags ?? [],
    canForce: isAdmin,
    projectId: version?.project_id ?? null,
    statusReasonLines,
    onSaveStatusReason: isReadOnly || isConflictLocked || isViewerReadOnly ? undefined : saveStatusReasonFromSendDialog,
    reserveLines,
    onOpenLimits: isReadOnly || isConflictLocked || isViewerReadOnly ? undefined : openLimitsFromSendDialog,
    onClose: closeSendGatingDialog,
    onConfirm: () => void handleConfirmSend(false),
    onForceConfirm: () => void handleConfirmSend(true),
  };

  const stateModel: EstimateEditorStateModel["state"] = {
    versionId,
    resolvedVersionId,
    isLoading,
    loadError,
    version,
    settings,
    isSettingsDrawerOpen,
    isBulkSuggestDialogOpen,
    isSupplierPreselectionDialogOpen,
    isImportFromEstimateDialogOpen,
    isEstimateStructureDraftDialogOpen,
    isGeneratedOuvrageDialogOpen,
    isVersionZeroDialogOpen,
    isSendGatingDialogOpen,
  };

  const actionsModel: EstimateEditorStateModel["actions"] = {
    openSettingsDrawer: handleOpenSettingsDrawer,
    closeSettingsDrawer,
  };

  if (!versionId) {
    return {
      state: stateModel,
      actions: actionsModel,
      meta: {
        kind: "missing-version",
      },
    };
  }

  if (isLoading) {
    return {
      state: stateModel,
      actions: actionsModel,
      meta: {
        kind: "loading",
      },
    };
  }

  if (loadError || !version || !settings) {
    return {
      state: stateModel,
      actions: actionsModel,
      meta: {
        kind: "error",
        message: loadError ?? "Impossible de charger le chiffrage.",
      },
    };
  }

  return {
    state: stateModel,
    actions: actionsModel,
    meta: {
      kind: "ready",
      projectId: version.project_id ?? null,
      canRetryHistoryRecovery: !isSyncReadOnly && !isSaveBlocked && !isConflictLocked,
      v3Grid,
      toolbarProps: toolbarProps!,
      alertsProps,
      summaryBarProps: summaryBarProps!,
      editorTableProps,
      checklistProps,
      drawerProps: drawerProps!,
      bulkSuggestDialogProps,
      supplierPreselectionDialogProps,
      importFromEstimateDialogProps,
      priceReuseDialogProps,
      estimateStructureDraftDialogProps,
      generatedOuvrageDialogProps,
      versionZeroDraftDialogProps,
      sendGatingDialogProps,
    },
  };
}
