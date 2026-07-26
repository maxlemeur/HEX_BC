"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";

import { BulkSuggestDialog } from "@/components/estimates/BulkSuggestDialog";
import { EstimateChecklist } from "@/components/estimates/EstimateChecklist";
import { GeneratedOuvrageDialog } from "@/components/estimates/GeneratedOuvrageDialog";
import { EstimateStructureDraftDialog } from "@/components/estimates/EstimateStructureDraftDialog";
import { SupplierPreselectionDialog } from "@/components/estimates/SupplierPreselectionDialog";
import { VersionZeroDraftDialog } from "@/components/estimates/VersionZeroDraftDialog";
import { EstimateEditorAlerts } from "@/components/estimates/editor/EstimateEditorAlerts";
import { EstimateEditorDrawer } from "@/components/estimates/editor/EstimateEditorDrawer";
import { EstimateEditorToolbar } from "@/components/estimates/editor/EstimateEditorToolbar";
import {
  EstimateEditorTable,
  type EstimateSectionDuplicateTarget,
} from "@/components/estimates/EstimateEditorTable";
import { ImportFromEstimateDialog } from "@/components/estimates/ImportFromEstimateDialog";
import { EstimateSendGatingDialog } from "@/components/estimates/EstimateSendGatingDialog";
import type { DiscountMode, EstimateSettingsState } from "@/components/estimates/EstimateSettingsPanel";
import {
  EstimateSettingsSummaryBar,
  type SettingsSection,
} from "@/components/estimates/EstimateSettingsSummaryBar";
import { useUserContext } from "@/components/UserContext";
import { useEstimateEditorExportController } from "@/hooks/useEstimateEditorExportController";
import { isEstimateEditorOperationScopeCurrent } from "@/hooks/estimate-editor-operation-scope";
import {
  formatEstimateEditorAuditTimestamp,
  useEstimateEditorActivityController,
} from "@/hooks/useEstimateEditorActivityController";
import { useEstimateEditorAiDialogsController } from "@/hooks/useEstimateEditorAiDialogsController";
import {
  resolveEstimateEditorAutoOpenDialogs,
  useEstimateEditorAiImportCoordinator,
} from "@/hooks/useEstimateEditorAiImportCoordinator";
import { useEstimateEditorBulkController } from "@/hooks/useEstimateEditorBulkController";
import { useEstimateEditorHistoryController } from "@/hooks/useEstimateEditorHistoryController";
import { useEstimateEditorImportController } from "@/hooks/useEstimateEditorImportController";
import { useEstimateEditorItemsController } from "@/hooks/useEstimateEditorItemsController";
import { useEstimateEditorOrderingController } from "@/hooks/useEstimateEditorOrderingController";
import { useEstimateEditorPasteController } from "@/hooks/useEstimateEditorPasteController";
import { useEstimateEditorQualityController } from "@/hooks/useEstimateEditorQualityController";
import { useEstimateEditorStructureController } from "@/hooks/useEstimateEditorStructureController";
import { useEstimateEditorSupplierController } from "@/hooks/useEstimateEditorSupplierController";
import { useEstimateEditorStatusController } from "@/hooks/useEstimateEditorStatusController";
import { useEstimateEditorSuggestionsController } from "@/hooks/useEstimateEditorSuggestionsController";
import {
  useEstimateEditorSyncController,
  type EstimateEditorConflictDraft,
} from "@/hooks/useEstimateEditorSyncController";
import { useUiMode } from "@/hooks/useUiMode";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import {
  computeEstimateLineValues,
  computeEstimateTotals,
  computeInitialDiscountCents,
  computeStoredDiscountCents,
  normalizeDraftItems,
  computeReadOnlyTotals,
  type EstimateTotals,
} from "@/lib/estimate-calculations";
import { EDITOR_CALC_ENGINE_VERSION } from "@/lib/estimates/calc-engine-version";
import {
  DEFAULT_ESTIMATE_CURRENCY,
  resolveEstimateCurrency,
} from "@/lib/estimates/editor-export";
import {
  LABOR_SPLIT_FIELD_KEYS,
  buildEstimateItemUpdatePayload,
  buildVersionDiscountPatch,
  readLaborSplitFields,
  resolveLaborRoleHourlyRate,
  type EditorEstimateItem,
  type EstimateItem,
  type EstimateVersionRow,
  type EstimateVersionTotalsPatch,
  type LaborRole,
} from "@/lib/estimates/editor-items";
import {
  toFiniteNumber,
} from "@/lib/estimates/editor-values";
import {
  ESTIMATE_EDITOR_VIRTUALIZATION_AUTO_THRESHOLD_FLAG_KEY,
  ESTIMATE_EDITOR_VIRTUALIZATION_MODE_FLAG_KEY,
  isEstimateEditorVirtualizationEnabled,
  resolveEstimateEditorVirtualizationConfig,
  resolveEstimateEditorVirtualizationRuntimeConfig,
  type EstimateEditorVirtualizationRuntimeConfig,
} from "@/lib/estimate-editor-virtualization";
import {
  acquireEstimateDraftLock,
  isEstimateApiError,
  bulkUpdateEstimateItems,
  createEstimateLaborRole,
  createMarginTier as createMarginTierClient,
  updateMarginTier as updateMarginTierClient,
  deleteMarginTier as deleteMarginTierClient,
  duplicateEstimateSection,
  fetchEstimateDraftVersions,
  fetchEstimateEditorData,
  fetchEstimateItemsForVersion,
  fetchEstimateSuggestionLearnings,
  releaseEstimateDraftLock,
  saveEstimateVersion,
  updateEstimateLaborRole,
  type VersionZeroDraftSummary,
  type SuggestionLearningState as SuggestionLearningClientState,
} from "@/lib/estimates/client";
import type { Database } from "@/types/database";

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
type EstimateCategory =
  Database["public"]["Tables"]["estimate_categories"]["Row"];
type SupplyType = Database["public"]["Tables"]["supply_types"]["Row"];
type MarginTierRow = Database["public"]["Tables"]["margin_tiers"]["Row"];
type SuggestionRule =
  Database["public"]["Tables"]["estimate_suggestion_rules"]["Row"];
type EstimateVersionView = EstimateVersionRow & {
  estimate_projects: { name: string } | { name: string }[] | null;
};

type EstimateEditorTableProps = ComponentProps<typeof EstimateEditorTable>;
type EstimateEditorVirtualizationConfig = NonNullable<
  EstimateEditorTableProps["virtualization"]
>;


const MAX_CASCADE_DISCOUNT_STEPS = 4;
const ESTIMATE_EDITOR_VIRTUALIZATION_ENV_CONFIG: EstimateEditorVirtualizationRuntimeConfig =
  resolveEstimateEditorVirtualizationConfig({
    enabled: process.env.NEXT_PUBLIC_ESTIMATE_EDITOR_VIRTUALIZATION_ENABLED,
    mode: process.env.NEXT_PUBLIC_ESTIMATE_EDITOR_VIRTUALIZATION_MODE,
    autoThreshold: process.env.NEXT_PUBLIC_ESTIMATE_EDITOR_VIRTUALIZATION_AUTO_THRESHOLD,
    rowEstimate: process.env.NEXT_PUBLIC_ESTIMATE_EDITOR_VIRTUALIZATION_ROW_ESTIMATE,
    overscan: process.env.NEXT_PUBLIC_ESTIMATE_EDITOR_VIRTUALIZATION_OVERSCAN,
    maxHeight: process.env.NEXT_PUBLIC_ESTIMATE_EDITOR_VIRTUALIZATION_CONTAINER_HEIGHT,
  });

function getProjectName(
  value: EstimateVersionView["estimate_projects"]
) {
  if (!value) return "";
  if (Array.isArray(value)) return value[0]?.name ?? "";
  return value.name ?? "";
}

function clampCascadeDiscountStepBp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.round(value), 0), 10000);
}

function normalizeCascadeDiscountSteps(steps: number[] | undefined): number[] {
  return (steps ?? [])
    .map((step) => clampCascadeDiscountStepBp(step))
    .slice(0, MAX_CASCADE_DISCOUNT_STEPS);
}

function formatSectionDuplicateTargetLabel(input: {
  versionNumber: number;
  title: string | null;
}) {
  const title = input.title?.trim();
  if (title && title.length > 0) {
    return `V${input.versionNumber} - ${title}`;
  }
  return `V${input.versionNumber} - Sans titre`;
}

function resolveEstimateActionError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("row-level security") || normalized.includes("read-only")) {
    return "Cette version est en lecture seule.";
  }
  return message;
}

function isDraftLockRequiredError(error: unknown) {
  return isEstimateApiError(error) && error.code === "LOCK_REQUIRED";
}
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
        toolbarProps: ComponentProps<typeof EstimateEditorToolbar>;
        alertsProps: ComponentProps<typeof EstimateEditorAlerts>;
        summaryBarProps: ComponentProps<typeof EstimateSettingsSummaryBar>;
        editorTableProps: EstimateEditorTableProps;
        drawerProps: ComponentProps<typeof EstimateEditorDrawer>;
        bulkSuggestDialogProps: ComponentProps<typeof BulkSuggestDialog>;
        supplierPreselectionDialogProps: ComponentProps<
          typeof SupplierPreselectionDialog
        >;
        importFromEstimateDialogProps:
          | ComponentProps<typeof ImportFromEstimateDialog>
          | null;
        estimateStructureDraftDialogProps:
          | ComponentProps<typeof EstimateStructureDraftDialog>
          | null;
        generatedOuvrageDialogProps:
          | ComponentProps<typeof GeneratedOuvrageDialog>
          | null;
        versionZeroDraftDialogProps:
          | ComponentProps<typeof VersionZeroDraftDialog>
          | null;
        sendGatingDialogProps: ComponentProps<typeof EstimateSendGatingDialog>;
      };
};

export function useEstimateEditorState({
  versionId,
  focusItemId = null,
  autoOpenVersionZero = false,
  autoOpenStructureDraft = false,
  autoOpenSettingsSection = null,
}: {
  versionId: string;
  focusItemId?: string | null;
  autoOpenVersionZero?: boolean;
  autoOpenStructureDraft?: boolean;
  autoOpenSettingsSection?: SettingsSection | null;
}): EstimateEditorStateModel {
  const router = useRouter();
  const resolvedVersionId = versionId;
  const {
    autoOpenVersionZero: shouldAutoOpenVersionZero,
    autoOpenStructureDraft: shouldAutoOpenStructureDraft,
  } = resolveEstimateEditorAutoOpenDialogs({
    autoOpenVersionZero,
    autoOpenStructureDraft,
  });
  const { profile } = useUserContext();
  const isAdmin = profile?.role === "admin";
  const isViewerReadOnly = profile?.tenant_role === "viewer";
  const { isExpert } = useUiMode();
  // EST-E26 (T6, étape 5) : l'éditeur lit le flag tenant réel au lieu du
  // `false` codé en dur, pour être cohérent avec le document et le PDF.
  const { enabled: isLaborSplitEnabled } = useFeatureFlag("EST_031_LABOR_SPLIT");
  const {
    enabled: isVirtualizationModeFlagEnabled,
    value: virtualizationModeFlagValue,
  } = useFeatureFlag(ESTIMATE_EDITOR_VIRTUALIZATION_MODE_FLAG_KEY);
  const { value: virtualizationAutoThresholdFlagValue } = useFeatureFlag(
    ESTIMATE_EDITOR_VIRTUALIZATION_AUTO_THRESHOLD_FLAG_KEY
  );

  const [version, setVersion] = useState<EstimateVersionView | null>(null);
  const [settings, setSettings] = useState<EstimateSettingsState | null>(null);
  const [savedSettings, setSavedSettings] =
    useState<EstimateSettingsState | null>(null);
  const [items, setItems] = useState<EditorEstimateItem[]>([]);
  const [categories, setCategories] = useState<EstimateCategory[]>([]);
  const [supplyTypes, setSupplyTypes] = useState<SupplyType[]>([]);
  const [laborRoles, setLaborRoles] = useState<LaborRole[]>([]);
  const [suggestionsHydration, setSuggestionsHydration] = useState<{
    versionId: string;
    rules: SuggestionRule[];
    learning: SuggestionLearningClientState | null;
  } | null>(null);
  const [isSettingsDrawerOpen, setIsSettingsDrawerOpen] = useState(false);
  const [drawerScrollTarget, setDrawerScrollTarget] = useState<SettingsSection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const settingsSaveGenerationRef = useRef(0);
  const settingsSaveRouteRef = useRef(resolvedVersionId);
  const [activeSettingsSave, setActiveSettingsSave] = useState<{
    routeVersionId: string;
    operationId: number;
  } | null>(null);
  const isSavingSettings =
    activeSettingsSave?.routeVersionId === resolvedVersionId &&
    activeSettingsSave.operationId === settingsSaveGenerationRef.current;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSavingMarginTiers, setIsSavingMarginTiers] = useState(false);
  const [marginTiersError, setMarginTiersError] = useState<string | null>(null);
  const [totalsOutOfSync, setTotalsOutOfSync] = useState(false);
  const [sectionDuplicateTargets, setSectionDuplicateTargets] = useState<
    EstimateSectionDuplicateTarget[]
  >([]);
  const historyController = useEstimateEditorHistoryController({
    scopeKey: resolvedVersionId,
    reportError: setActionError,
  });
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

  const itemsRef = useRef<EditorEstimateItem[]>([]);
  const versionRef = useRef<EstimateVersionView | null>(null);
  const activeRouteVersionIdRef = useRef(resolvedVersionId);
  const persistedTotalsRef = useRef<EstimateTotals | null>(null);
  const hydrateAiVersionZeroSummaryRef = useRef<
    (
      targetVersionId: string,
      summary: VersionZeroDraftSummary | null,
      options?: { autoOpen?: boolean }
    ) => void
  >(() => undefined);
  const highlightAiMutationItemsRef = useRef<
    (itemIds: readonly string[]) => void
  >(() => undefined);

  useLayoutEffect(() => {
    activeRouteVersionIdRef.current = resolvedVersionId;
    if (settingsSaveRouteRef.current !== resolvedVersionId) {
      settingsSaveRouteRef.current = resolvedVersionId;
      settingsSaveGenerationRef.current += 1;
    }
  }, [resolvedVersionId]);

  const getItemsSnapshot = useCallback(() => itemsRef.current, []);
  const getVersionSnapshot = useCallback(() => versionRef.current, []);
  const getPersistedTotals = useCallback(() => persistedTotalsRef.current, []);
  const applyRestoredDraft = useCallback(
    (draft: EstimateEditorConflictDraft) => {
      if (draft.settings) {
        setSettings({
          ...draft.settings,
          currency: resolveEstimateCurrency(
            (draft.settings as { currency?: string | null }).currency
          ),
        });
      }
      setItems(draft.items);
    },
    []
  );
  const applyVersionFlushResult = useCallback(
    ({
      versionId,
      totalsPatch,
      updatedAt,
    }: {
      versionId: string;
      totalsPatch: EstimateVersionTotalsPatch | undefined;
      updatedAt: string;
    }) => {
      setVersion((previous) =>
        previous?.id === versionId
          ? {
              ...previous,
              ...(totalsPatch ?? {}),
              updated_at: updatedAt,
            }
          : previous
      );
      if (versionRef.current?.id === versionId) {
        versionRef.current = {
          ...versionRef.current,
          ...(totalsPatch ?? {}),
          updated_at: updatedAt,
        };
      }
    },
    []
  );

  const syncController = useEstimateEditorSyncController({
    routeVersionId: resolvedVersionId,
    activeVersion: version
      ? {
          id: version.id,
          status: version.status,
        }
      : null,
    currentUserId: profile?.id ?? null,
    isViewerReadOnly,
    items,
    settings,
    getVersionSnapshot,
    getPersistedTotals,
    replaceItems: setItems,
    applyRestoredDraft,
    applyVersionFlushResult,
    setTotalsOutOfSync,
    clearHistory: clearUndoRedoHistory,
    reportError: setActionError,
    resolveErrorMessage: resolveEstimateActionError,
  });
  const {
    autoSaveStatus,
    autoSaveStatusLabel,
    conflict: conflictState,
    isReloadingVersion,
    hasRestorableDraft,
    isDraftLockedByOther,
    isDraftLockAcquiring,
    isForcingDraftUnlock,
    draftLockError,
  } = syncController.state;
  const {
    overlayPendingUpdates: applyPendingBufferedUpdatesToItems,
    enqueueItemUpdate: enqueueBufferedItemUpdate,
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
    isReadOnly,
    isConflictLocked,
    isSaveBlocked,
    readOnlyActionErrorMessage,
    lockHolderLabel,
  } = syncController.meta;
  const settingsSaveGuardRef = useRef({
    isBlocked: isReadOnly || isConflictLocked,
    message: isConflictLocked
      ? (conflictState?.message ?? "Version modifiee par un autre utilisateur")
      : readOnlyActionErrorMessage,
  });

  useLayoutEffect(() => {
    settingsSaveGuardRef.current = {
      isBlocked: isReadOnly || isConflictLocked,
      message: isConflictLocked
        ? (conflictState?.message ?? "Version modifiee par un autre utilisateur")
        : readOnlyActionErrorMessage,
    };
  }, [
    conflictState?.message,
    isConflictLocked,
    isReadOnly,
    readOnlyActionErrorMessage,
  ]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    if (!resolvedVersionId) {
      return deferEffectStateUpdate(() => {
        setSuggestionsHydration(null);
      });
    }

    let active = true;

    async function load() {
      setIsLoading(true);
      setLoadError(null);
      setSuggestionsHydration(null);

      try {
        const [data, learning] = await Promise.all([
          fetchEstimateEditorData(resolvedVersionId),
          fetchEstimateSuggestionLearnings(resolvedVersionId).catch((error) => {
            console.error(
              "Impossible de charger les apprentissages de suggestions.",
              error
            );
            return null;
          }),
        ]);
        if (!active) return;

        const versionRow = data.version as EstimateVersionView;
        const itemsRows = data.items ?? [];
        const rolesData = data.laborRoles ?? [];

        const rateById = new Map<string, number>();
        const rateAtelierById = new Map<string, number>();
        const rateChantierById = new Map<string, number>();
        rolesData.forEach((role) => {
          rateById.set(role.id, role.hourly_rate_cents);
          rateAtelierById.set(
            role.id,
            resolveLaborRoleHourlyRate(role, "atelier")
          );
          rateChantierById.set(
            role.id,
            resolveLaborRoleHourlyRate(role, "chantier")
          );
        });

        const normalizedItems =
          versionRow.status === "draft"
            ? normalizeDraftItems({
                items: itemsRows,
                version: versionRow,
                rateById,
                rateAtelierById,
                rateChantierById,
                isLaborSplitEnabled,
              })
            : itemsRows;

        const discountMode: DiscountMode =
          versionRow.discount_mode === "cascade" ? "cascade" : "simple";
        const cascadeDiscountSteps =
          discountMode === "cascade"
            ? normalizeCascadeDiscountSteps(versionRow.discount_steps)
            : [];
        const globalCoefficient = Number.isFinite(
          versionRow.global_coefficient ?? NaN
        )
          ? Math.max(versionRow.global_coefficient ?? 1, 0)
          : 1;
        const discountCents =
          versionRow.status === "draft"
            ? computeInitialDiscountCents(
                versionRow,
                itemsRows,
                rateById,
                isLaborSplitEnabled,
                rateAtelierById,
                rateChantierById
              )
            : computeStoredDiscountCents(versionRow, itemsRows);

        const initialSettings = {
          title: versionRow.title ?? "",
          exclusions: versionRow.exclusions ?? "",
          date_devis: versionRow.date_devis,
          validite_jours: versionRow.validite_jours,
          currency: resolveEstimateCurrency(versionRow.currency),
          margin_multiplier: versionRow.margin_multiplier,
          margin_mode: versionRow.margin_mode ?? "fixed",
          margin_tiers: data.marginTiers ?? [],
          discount_cents: discountCents,
          discount_mode: discountMode,
          discount_steps: cascadeDiscountSteps,
          global_coefficient: globalCoefficient,
          tax_rate_bp: versionRow.tax_rate_bp,
          contractor_role: versionRow.contractor_role ?? "principal",
          rounding_mode: versionRow.rounding_mode,
          rounding_step_cents: versionRow.rounding_step_cents,
        };

        setVersion(versionRow);
        hydrateAiVersionZeroSummaryRef.current(
          versionRow.id,
          data.versionZeroSummary ?? null,
          { autoOpen: shouldAutoOpenVersionZero }
        );
        setItems(applyPendingBufferedUpdatesToItems(normalizedItems));
        setCategories(data.categories ?? []);
        setSupplyTypes(data.supplyTypes ?? []);
        setLaborRoles(rolesData);
        setSuggestionsHydration({
          versionId: versionRow.id,
          rules: data.suggestionRules ?? [],
          learning,
        });
        setSettings(initialSettings);
        setSavedSettings(initialSettings);
        clearConflictState();
        if (versionRow.status === "draft") {
          const originalById = new Map(
            itemsRows.map((item) => [item.id, item])
          );
          const updates = normalizedItems.filter((item) => {
            if (item.item_type !== "line") return false;
            const original = originalById.get(item.id);
            if (!original) return false;
            return (
              original.tax_rate_bp !== item.tax_rate_bp ||
              original.k_fo !== item.k_fo ||
              original.h_mo !== item.h_mo ||
              original.h_mo_majoration !== item.h_mo_majoration ||
              original.k_mo !== item.k_mo ||
              original.supply_type_id !== item.supply_type_id ||
              LABOR_SPLIT_FIELD_KEYS.some(
                (key) =>
                  (original as unknown as Record<string, unknown>)[key] !==
                  (item as unknown as Record<string, unknown>)[key]
              ) ||
              original.pu_ht_cents !== item.pu_ht_cents ||
              original.line_total_ht_cents !== item.line_total_ht_cents ||
              original.line_tax_cents !== item.line_tax_cents ||
              original.line_total_ttc_cents !== item.line_total_ttc_cents
            );
          });

          updates.forEach((item) => {
            enqueueBufferedItemUpdate(item.id, {
              tax_rate_bp: item.tax_rate_bp,
              k_fo: item.k_fo,
              h_mo: item.h_mo,
              h_mo_majoration: item.h_mo_majoration,
              k_mo: item.k_mo,
              supply_type_id: item.supply_type_id,
              pu_ht_cents: item.pu_ht_cents,
              line_total_ht_cents: item.line_total_ht_cents,
              line_tax_cents: item.line_tax_cents,
              line_total_ttc_cents: item.line_total_ttc_cents,
            });
          });
        }
      } catch (error) {
        if (!active) return;
        const message =
          error instanceof Error
            ? resolveEstimateActionError(error.message)
            : "Impossible de charger le chiffrage.";
        setLoadError(message);
      } finally {
        if (active) {
          setIsLoading(false);
          markVersionReloadFinished();
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [
    applyPendingBufferedUpdatesToItems,
    clearConflictState,
    enqueueBufferedItemUpdate,
    isLaborSplitEnabled,
    markVersionReloadFinished,
    reloadNonce,
    resolvedVersionId,
    shouldAutoOpenVersionZero,
  ]);

  useEffect(() => {
    if (!resolvedVersionId) {
      return deferEffectStateUpdate(() => {
        setSectionDuplicateTargets([]);
      });
    }

    let active = true;

    async function loadSectionDuplicateTargets() {
      try {
        const targets = await fetchEstimateDraftVersions(resolvedVersionId);
        if (!active) return;

        setSectionDuplicateTargets(
          targets.map((target) => ({
            versionId: target.id,
            label: formatSectionDuplicateTargetLabel({
              versionNumber: target.versionNumber,
              title: target.title,
            }),
          }))
        );
      } catch {
        if (!active) return;
        setSectionDuplicateTargets([]);
      }
    }

    void loadSectionDuplicateTargets();

    return () => {
      active = false;
    };
  }, [reloadNonce, resolvedVersionId]);

  const projectName = getProjectName(version?.estimate_projects ?? null);

  useLayoutEffect(() => {
    versionRef.current = version;
  }, [version]);
  const editorTableBaseConfig = useMemo(
    () => ({
      marginMultiplier: settings?.margin_multiplier ?? 1,
      discountCents: settings?.discount_cents ?? 0,
      taxRateBp: settings?.tax_rate_bp ?? 0,
      isReadOnly: isReadOnly || isConflictLocked,
    }),
    [
      isConflictLocked,
      isReadOnly,
      settings?.discount_cents,
      settings?.margin_multiplier,
      settings?.tax_rate_bp,
    ]
  );
  const editorTableVirtualization = useMemo<EstimateEditorVirtualizationConfig>(() => {
    const runtimeConfig = resolveEstimateEditorVirtualizationRuntimeConfig({
      baseConfig: ESTIMATE_EDITOR_VIRTUALIZATION_ENV_CONFIG,
      modeFlag: {
        enabled: isVirtualizationModeFlagEnabled,
        value: virtualizationModeFlagValue,
      },
      autoThresholdFlag: {
        value: virtualizationAutoThresholdFlagValue,
      },
    });
    const enabled = isEstimateEditorVirtualizationEnabled(runtimeConfig, items.length);

    return {
      enabled,
      rowEstimate: runtimeConfig.rowEstimate,
      overscan: runtimeConfig.overscan,
      ...(runtimeConfig.maxHeight !== undefined
        ? { maxHeight: runtimeConfig.maxHeight }
        : {}),
    };
  }, [
    isVirtualizationModeFlagEnabled,
    items.length,
    virtualizationAutoThresholdFlagValue,
    virtualizationModeFlagValue,
  ]);
  const handleOpenSettingsDrawer = useCallback((section?: SettingsSection) => {
    setIsSettingsDrawerOpen(true);
    setDrawerScrollTarget(section ?? null);
  }, []);
  const activityController = useEstimateEditorActivityController({
    routeVersionId: resolvedVersionId,
    isAdmin,
  });
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

  const autoOpenedSettingsRef = useRef(false);
  useEffect(() => {
    if (
      !autoOpenSettingsSection ||
      autoOpenedSettingsRef.current ||
      isLoading ||
      !settings
    ) {
      return;
    }

    autoOpenedSettingsRef.current = true;
    handleOpenSettingsDrawer(autoOpenSettingsSection);
  }, [
    autoOpenSettingsSection,
    handleOpenSettingsDrawer,
    isLoading,
    settings,
  ]);
  const drawerScrollTargetRef = useRef<SettingsSection | null>(null);
  useEffect(() => {
    drawerScrollTargetRef.current = drawerScrollTarget;
  }, [drawerScrollTarget]);
  useEffect(() => {
    if (!isSettingsDrawerOpen) return;
    const target = drawerScrollTargetRef.current;
    if (!target) return;
    drawerScrollTargetRef.current = null;
    setDrawerScrollTarget(null);
    const sectionIdMap: Record<SettingsSection, string> = {
      margin: "estimate-margin",
      discount: "estimate-discount",
      tax: "estimate-tax",
      rounding: "estimate-rounding",
      exclusions: "estimate-exclusions",
      general: "estimate-project-name",
    };
    const targetId = sectionIdMap[target];
    const scrollToTarget = () => {
      const el = document.getElementById(targetId);
      if (!el) return;
      let scrollable: HTMLElement | null = el.parentElement;
      while (scrollable) {
        const ov = getComputedStyle(scrollable).overflowY;
        if (ov === "auto" || ov === "scroll") break;
        scrollable = scrollable.parentElement;
      }
      if (scrollable) {
        const containerRect = scrollable.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const offset = elRect.top - containerRect.top + scrollable.scrollTop - containerRect.height / 2;
        scrollable.scrollTo({ top: Math.max(0, offset), behavior: "smooth" });
      }
    };
    // Retry at increasing delays to handle drawer animation and async renders
    const delays = [50, 150, 350];
    const timers = delays.map((delay) => setTimeout(scrollToTarget, delay));
    return () => timers.forEach(clearTimeout);
  }, [isSettingsDrawerOpen]);
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
    deferredItems,
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
      highlightAiMutationItemsRef.current([focusItemId]);
    });
  }, [focusItemId, handleChecklistFocusItem]);

  const buildLineCalculationInput = useCallback(
    (
      item: EstimateItem,
      options?: {
        taxRateBp?: number;
        rateOverrideByRoleId?: string;
        hourlyRateCents?: number;
        hourlyRateAtelierCents?: number;
        hourlyRateChantierCents?: number;
      }
    ) => {
      const splitFields = readLaborSplitFields(item);
      const taxRate = options?.taxRateBp ?? item.tax_rate_bp ?? 0;
      const kFo = item.k_fo ?? 1;
      const hMo = item.h_mo ?? 0;
      const hMoMajoration = item.h_mo_majoration ?? 1;
      const kMo = item.k_mo ?? 1;
      const overrideRoleId = options?.rateOverrideByRoleId;

      const resolveRate = (
        roleId: string | null | undefined,
        map: Map<string, number>,
        overrideRate: number | undefined
      ) => {
        if (!roleId) return 0;
        if (overrideRoleId && roleId === overrideRoleId) {
          return Math.max(toFiniteNumber(overrideRate, 0), 0);
        }
        return map.get(roleId) ?? 0;
      };

      const hourlyRate = resolveRate(
        item.labor_role_id,
        laborRateById,
        options?.hourlyRateCents
      );
      const hourlyRateAtelier = resolveRate(
        splitFields.labor_role_atelier_id,
        laborRateAtelierById,
        options?.hourlyRateAtelierCents ?? options?.hourlyRateCents
      );
      const hourlyRateChantier = resolveRate(
        splitFields.labor_role_chantier_id,
        laborRateChantierById,
        options?.hourlyRateChantierCents ?? options?.hourlyRateCents
      );

      return {
        ...item,
        tax_rate_bp: taxRate,
        k_fo: kFo,
        h_mo: hMo,
        h_mo_majoration: hMoMajoration,
        k_mo: kMo,
        ...splitFields,
        labor_role_hourly_rate_cents: hourlyRate,
        labor_role_atelier_hourly_rate_cents: hourlyRateAtelier,
        labor_role_chantier_hourly_rate_cents: hourlyRateChantier,
      };
    },
    [laborRateAtelierById, laborRateById, laborRateChantierById]
  );

  const computeLineValuesWithLaborContext = useCallback(
    (
      item: EstimateItem,
      options: {
        marginMultiplier: number;
        taxRateBp: number;
        rateOverrideByRoleId?: string;
        hourlyRateCents?: number;
        hourlyRateAtelierCents?: number;
        hourlyRateChantierCents?: number;
      }
    ) => {
      const lineInput = buildLineCalculationInput(item, {
        taxRateBp: options.taxRateBp,
        rateOverrideByRoleId: options.rateOverrideByRoleId,
        hourlyRateCents: options.hourlyRateCents,
        hourlyRateAtelierCents: options.hourlyRateAtelierCents,
        hourlyRateChantierCents: options.hourlyRateChantierCents,
      });
      const lineComputationOptions = {
        marginMultiplier: options.marginMultiplier,
        taxRateBp: options.taxRateBp,
        isLaborSplitEnabled,
      };
      return {
        lineInput,
        lineValues: computeEstimateLineValues(lineInput, lineComputationOptions),
      };
    },
    [buildLineCalculationInput, isLaborSplitEnabled]
  );

  const totals: EstimateTotals | null = useMemo(() => {
    if (!settings) return null;
    if (isReadOnly && version) {
      const readOnlyVersion = {
        ...version,
        discount_mode: settings.discount_mode ?? version.discount_mode,
        discount_steps: settings.discount_steps ?? version.discount_steps,
        global_coefficient:
          settings.global_coefficient ?? version.global_coefficient,
      };
      const readOnlyTotalsInput = {
        items,
        version: readOnlyVersion,
        discountCents: settings.discount_cents,
        laborRateById,
        isLaborSplitEnabled,
        laborRateAtelierById,
        laborRateChantierById,
        // EST-E26 (T6, étape 9) : grandeurs de version requises par le moteur
        // unifié. Ignorées tant que la version reste en moteur 1.
        marginTiers: settings.margin_tiers ?? [],
        roundingMode: settings.rounding_mode,
        roundingStepCents: settings.rounding_step_cents,
        calcEngineVersion: EDITOR_CALC_ENGINE_VERSION,
      };
      return computeReadOnlyTotals(readOnlyTotalsInput);
    }
    const lineItems = items
      .filter((item) => item.item_type === "line")
      .map((item) => buildLineCalculationInput(item));
    const totalsInput = {
      lineItems,
      marginMultiplier: settings.margin_multiplier,
      marginMode: settings.margin_mode ?? "fixed",
      marginTiers: settings.margin_tiers ?? [],
      discountCents: settings.discount_cents,
      discountMode: settings.discount_mode,
      discountStepsBp: settings.discount_steps,
      globalCoefficient: settings.global_coefficient,
      taxRateBp: settings.tax_rate_bp,
      roundingMode: settings.rounding_mode,
      roundingStepCents: settings.rounding_step_cents,
      isLaborSplitEnabled,
      // EST-E27 : l editeur applique le MEME regime que le document. Sans cela
      // le chiffreur verrait un TTC que le devis remis au client n affiche pas.
      vatReverseCharge: settings.contractor_role === "subcontractor",
    };
    return computeEstimateTotals(totalsInput);
  }, [
    buildLineCalculationInput,
    isLaborSplitEnabled,
    isReadOnly,
    items,
    laborRateAtelierById,
    laborRateById,
    laborRateChantierById,
    settings,
    version,
  ]);

  const exportController = useEstimateEditorExportController({
    versionId: resolvedVersionId,
    projectName,
    version,
    settings,
    totals,
    items,
    supplyTypeById,
    laborRoleById,
    qualityFlagsByItemId,
    qualityCounts,
    isLaborSplitEnabled,
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
    isDisabled: isExportDisabled,
    loadingLabel: exportLoadingLabel,
  } = exportController.meta;

  const persistedTotals: EstimateTotals | null = useMemo(() => {
    if (!savedSettings) return null;
    const lineItems = items
      .filter((item) => item.item_type === "line")
      .map((item) => buildLineCalculationInput(item));
    const totalsInput = {
      lineItems,
      marginMultiplier: savedSettings.margin_multiplier,
      marginMode: savedSettings.margin_mode ?? "fixed",
      marginTiers: savedSettings.margin_tiers ?? [],
      discountCents: savedSettings.discount_cents,
      discountMode: savedSettings.discount_mode,
      discountStepsBp: savedSettings.discount_steps,
      globalCoefficient: savedSettings.global_coefficient,
      taxRateBp: savedSettings.tax_rate_bp,
      roundingMode: savedSettings.rounding_mode,
      roundingStepCents: savedSettings.rounding_step_cents,
      isLaborSplitEnabled,
    };
    return computeEstimateTotals(totalsInput);
  }, [buildLineCalculationInput, isLaborSplitEnabled, items, savedSettings]);

  useEffect(() => {
    persistedTotalsRef.current = persistedTotals;
  }, [persistedTotals]);

  const autoSaveStatusClassName = useMemo(() => {
    if (autoSaveStatus === "saving") return "status-badge status-sent";
    if (autoSaveStatus === "error") return "status-badge status-canceled";
    if (autoSaveStatus === "saved") return "status-badge status-accepted";
    return "status-badge status-draft";
  }, [autoSaveStatus]);

  const updateSettings = useCallback(
    (patch: Partial<EstimateSettingsState>) => {
      setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    },
    []
  );

  const normalizeReloadedItems = useCallback(
    (targetVersionId: string, itemsRows: EstimateItem[]) => {
      const activeVersion =
        versionRef.current?.id === targetVersionId
          ? versionRef.current
          : null;
      if (!activeVersion) {
        return applyPendingBufferedUpdatesToItems(itemsRows);
      }

      const normalizedItems =
        activeVersion.status === "draft"
          ? normalizeDraftItems({
              items: itemsRows,
              version: activeVersion,
              rateById: laborRateById,
              rateAtelierById: laborRateAtelierById,
              rateChantierById: laborRateChantierById,
              isLaborSplitEnabled,
            })
          : itemsRows;

      return applyPendingBufferedUpdatesToItems(normalizedItems);
    },
    [
      applyPendingBufferedUpdatesToItems,
      laborRateById,
      laborRateAtelierById,
      laborRateChantierById,
      isLaborSplitEnabled,
    ]
  );

  const reloadItems = useCallback(async () => {
    if (!resolvedVersionId) return;
    const targetVersionId = resolvedVersionId;
    try {
      const itemsRows = await fetchEstimateItemsForVersion(targetVersionId);
      if (activeRouteVersionIdRef.current !== targetVersionId) return;
      setItems(normalizeReloadedItems(targetVersionId, itemsRows));
    } catch (error) {
      if (activeRouteVersionIdRef.current !== targetVersionId) return;
      const message =
        error instanceof Error
          ? resolveEstimateActionError(error.message)
          : "Impossible de charger les lignes.";
      setActionError(message);
    }
  }, [normalizeReloadedItems, resolvedVersionId]);

  const reloadItemsForStructuralMutation = useCallback(async () => {
    if (!resolvedVersionId) return;
    const targetVersionId = resolvedVersionId;
    const itemsRows = await fetchEstimateItemsForVersion(targetVersionId);
    if (activeRouteVersionIdRef.current !== targetVersionId) return;
    setItems(normalizeReloadedItems(targetVersionId, itemsRows));
  }, [normalizeReloadedItems, resolvedVersionId]);

  async function handleSaveSettings() {
    if (!settings || !version || !totals) return;
    if (version.id !== resolvedVersionId) return;
    if (isReadOnly) {
      setActionError(readOnlyActionErrorMessage);
      return;
    }
    if (isConflictLocked) {
      setActionError(
        conflictState?.message ?? "Version modifiee par un autre utilisateur"
      );
      return;
    }

    const targetRouteVersionId = resolvedVersionId;
    const targetVersionId = version.id;
    const settingsSnapshot = settings;
    const totalsSnapshot = totals;
    const operationId = settingsSaveGenerationRef.current + 1;
    settingsSaveGenerationRef.current = operationId;
    const settingsSaveScope = {
      routeVersionId: targetRouteVersionId,
      versionId: targetVersionId,
      generation: operationId,
    };
    setActiveSettingsSave({
      routeVersionId: targetRouteVersionId,
      operationId,
    });
    setActionError(null);

    const isCurrentSettingsSave = () =>
      isEstimateEditorOperationScopeCurrent(settingsSaveScope, {
        routeVersionId: activeRouteVersionIdRef.current,
        versionId: versionRef.current?.id ?? null,
        generation: settingsSaveGenerationRef.current,
      });

    try {
      if (!(await ensureGroupedActionCanProceed("sauvegarder les parametres"))) {
        return;
      }
      if (!isCurrentSettingsSave()) return;

      const currentGuard = settingsSaveGuardRef.current;
      if (currentGuard.isBlocked) {
        setActionError(currentGuard.message);
        return;
      }

      const versionSnapshot = getVersionSnapshot();
      if (!versionSnapshot || versionSnapshot.id !== targetVersionId) return;
      const lineItemsSnapshot = itemsRef.current.filter(
        (item): item is EstimateItem =>
          item.item_type === "line" && item.version_id === targetVersionId
      );
      const discountBase = totalsSnapshot.saleSubtotalCents;
      const discountBp =
        discountBase > 0
          ? Math.round(
              (totalsSnapshot.discountCents / discountBase) * 10000
            )
          : 0;
      const discountMode: DiscountMode =
        settingsSnapshot.discount_mode === "cascade" ? "cascade" : "simple";
      const normalizedCascadeDiscountSteps = normalizeCascadeDiscountSteps(
        settingsSnapshot.discount_steps
      );
      // EST-E26 etape 16 : le coefficient est une grandeur INDEPENDANTE du mode
      // de remise, il est persiste tel qu'il est affiche (cf.
      // buildVersionDiscountPatch). L'ecrire a 1 hors cascade rendait la version
      // auto-contradictoire, `total_ht_cents` l'incluant toujours.
      const discountPatch = buildVersionDiscountPatch({
        discountMode,
        globalCoefficient: settingsSnapshot.global_coefficient,
        cascadeDiscountSteps: normalizedCascadeDiscountSteps,
      });
      const payload: Database["public"]["Tables"]["estimate_versions"]["Update"] = {
        title: settingsSnapshot.title.trim() || null,
        exclusions: settingsSnapshot.exclusions.trim() || null,
        date_devis: settingsSnapshot.date_devis,
        validite_jours: settingsSnapshot.validite_jours,
        currency: settingsSnapshot.currency,
        margin_multiplier: totalsSnapshot.appliedMarginMultiplier,
        margin_mode: settingsSnapshot.margin_mode ?? "fixed",
        discount_bp: discountBp,
        ...discountPatch,
        tax_rate_bp: settingsSnapshot.tax_rate_bp,
        // EST-E27 : le regime de TVA est une grandeur de version, persistee
        // telle qu elle est choisie.
        contractor_role: settingsSnapshot.contractor_role ?? "principal",
        rounding_mode: settingsSnapshot.rounding_mode,
        rounding_step_cents: settingsSnapshot.rounding_step_cents,
        total_ht_cents: totalsSnapshot.saleTotalCents,
        total_tax_cents: totalsSnapshot.adjustedTaxCents,
        total_ttc_cents: totalsSnapshot.roundedTtcCents,
      };

      const persistSettings = () =>
        saveEstimateVersion(
          targetVersionId,
          payload,
          versionSnapshot.updated_at
        );

      let updatedVersion: EstimateVersionRow;
      try {
        try {
          updatedVersion = await persistSettings();
        } catch (error) {
          if (!isDraftLockRequiredError(error)) throw error;
          const reacquired = await recoverDraftLock();
          if (!reacquired) throw error;
          updatedVersion = await persistSettings();
        }
      } catch (error) {
        if (!isCurrentSettingsSave()) return;
        if (!handleVersionConflict(error, { persistDraft: true })) {
          setActionError(
            resolveEstimateActionError(
              error instanceof Error
                ? error.message
                : "Impossible de sauvegarder le chiffrage."
            )
          );
        }
        return;
      }
      if (!isCurrentSettingsSave()) return;

      const mergedVersion = {
        ...versionSnapshot,
        ...payload,
        ...updatedVersion,
      } as EstimateVersionView;
      versionRef.current = mergedVersion;
      setVersion((previous) =>
        previous?.id === targetVersionId ? mergedVersion : previous
      );

      const nextSavedSettings = {
        ...settingsSnapshot,
        margin_multiplier: totalsSnapshot.appliedMarginMultiplier,
        margin_mode: settingsSnapshot.margin_mode ?? "fixed",
        discount_cents: totalsSnapshot.discountCents,
        ...discountPatch,
      } as EstimateSettingsState;
      setSavedSettings(nextSavedSettings);
      setSettings(nextSavedSettings);

      const shouldUpdateLines =
        settingsSnapshot.tax_rate_bp !== versionSnapshot.tax_rate_bp ||
        totalsSnapshot.appliedMarginMultiplier !==
          versionSnapshot.margin_multiplier;
      if (shouldUpdateLines) {
        const updatedLines = lineItemsSnapshot.map((item) => {
          const { lineInput, lineValues } =
            computeLineValuesWithLaborContext(item, {
              marginMultiplier: totalsSnapshot.appliedMarginMultiplier,
              taxRateBp: settingsSnapshot.tax_rate_bp,
            });
          return {
            ...item,
            tax_rate_bp: lineInput.tax_rate_bp,
            k_fo: lineInput.k_fo,
            h_mo: lineInput.h_mo,
            k_mo: lineInput.k_mo,
            pu_ht_cents: lineValues.puHtCents,
            line_total_ht_cents: lineValues.saleLineCents,
            line_tax_cents: lineValues.taxLineCents,
            line_total_ttc_cents: lineValues.ttcLineCents,
          };
        });

        setItems((previous) => {
          if (!isCurrentSettingsSave()) return previous;
          const updatedLineById = new Map(
            updatedLines.map((line) => [line.id, line])
          );
          return previous.map((item) => updatedLineById.get(item.id) ?? item);
        });

        try {
          const bulkResult = await bulkUpdateEstimateItems(
            targetVersionId,
            updatedVersion.updated_at,
            updatedLines.map((item) => ({
              id: item.id,
              updates: buildEstimateItemUpdatePayload(item),
            }))
          );
          if (!isCurrentSettingsSave()) return;

          const latestVersionToken = bulkResult.versionToken.updated_at;
          if (versionRef.current?.id === targetVersionId) {
            versionRef.current = {
              ...versionRef.current,
              updated_at: latestVersionToken,
            };
          }
          setVersion((previous) =>
            previous?.id === targetVersionId
              ? { ...previous, updated_at: latestVersionToken }
              : previous
          );
        } catch (error) {
          if (!isCurrentSettingsSave()) return;
          if (!handleVersionConflict(error, { persistDraft: true })) {
            setActionError("Impossible de mettre a jour les lignes.");
          }
          return;
        }
      }

      if (isCurrentSettingsSave()) {
        clearConflictDraft();
      }
    } finally {
      if (isCurrentSettingsSave()) {
        setActiveSettingsSave((previous) =>
          previous?.operationId === operationId ? null : previous
        );
      }
    }
  }

  const handleCreateRole = useCallback(
    async (payload: { name: string; hourly_rate_cents: number }) => {
      setActionError(null);
      if (isReadOnly) {
        setActionError(readOnlyActionErrorMessage);
        return;
      }
      if (isConflictLocked) {
        setActionError(
          conflictState?.message ?? "Version modifiee par un autre utilisateur"
        );
        return;
      }
      if (!profile?.id) {
        setActionError("Impossible de charger votre profil.");
        return;
      }

      const nextPosition =
        laborRoles.reduce((max, role) => Math.max(max, role.position), 0) + 1;

      if (!version?.id) {
        setActionError("Version introuvable.");
        return;
      }

      let data: LaborRole;
      try {
        data = await createEstimateLaborRole(version.id, {
          name: payload.name,
          hourly_rate_cents: payload.hourly_rate_cents,
          is_active: true,
          position: nextPosition,
        });
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Impossible de créer le rôle."
        );
        return;
      }

      setLaborRoles((prev) =>
        [...prev, data].sort((a, b) => a.position - b.position)
      );
    },
    [
      conflictState?.message,
      isConflictLocked,
      isReadOnly,
      laborRoles,
      profile,
      readOnlyActionErrorMessage,
      version?.id,
    ]
  );

  const handleUpdateRole = useCallback(
    async (id: string, updates: Partial<LaborRole>) => {
      setActionError(null);
      if (isReadOnly) {
        setActionError(readOnlyActionErrorMessage);
        return;
      }
      if (isConflictLocked) {
        setActionError(
          conflictState?.message ?? "Version modifiee par un autre utilisateur"
        );
        return;
      }
      if (!version?.id) {
        setActionError("Version introuvable.");
        return;
      }

      try {
        await updateEstimateLaborRole(version.id, id, updates);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : "Impossible de mettre a jour le role.");
        return;
      }

      setLaborRoles((prev) =>
        prev.map((role) => (role.id === id ? { ...role, ...updates } : role))
      );

      if (updates.hourly_rate_cents === undefined || !settings) return;

      const nextHourlyRate = updates.hourly_rate_cents ?? 0;
      const snapshot = itemsRef.current;
      const affectedLines = snapshot.filter(
        (item) => item.item_type === "line" && item.labor_role_id === id
      );

      if (affectedLines.length === 0) return;

      const updatedLines = affectedLines.map((item) => {
        const taxRate = settings.tax_rate_bp ?? item.tax_rate_bp ?? 0;
        const { lineInput, lineValues } = computeLineValuesWithLaborContext(item, {
          marginMultiplier: settings.margin_multiplier,
          taxRateBp: taxRate,
          rateOverrideByRoleId: id,
          hourlyRateCents: nextHourlyRate,
        });
        return {
          ...item,
          tax_rate_bp: lineInput.tax_rate_bp,
          k_fo: lineInput.k_fo,
          h_mo: lineInput.h_mo,
          k_mo: lineInput.k_mo,
          pu_ht_cents: lineValues.puHtCents,
          line_total_ht_cents: lineValues.saleLineCents,
          line_tax_cents: lineValues.taxLineCents,
          line_total_ttc_cents: lineValues.ttcLineCents,
        };
      });

      setItems((prev) =>
        prev.map((item) => {
          if (item.item_type !== "line") return item;
          const updated = updatedLines.find((line) => line.id === item.id);
          return updated ?? item;
        })
      );

      if (isSaveBlocked) return;

      updatedLines.forEach((item) => {
        enqueueBufferedItemUpdate(item.id, buildEstimateItemUpdatePayload(item));
      });
    },
    [
      enqueueBufferedItemUpdate,
      isSaveBlocked,
      conflictState?.message,
      isConflictLocked,
      isReadOnly,
      readOnlyActionErrorMessage,
      settings,
      version,
      computeLineValuesWithLaborContext,
    ]
  );

  const canEditMarginTiers = isAdmin && !isSaveBlocked;

  const handleCreateTier = useCallback(
    async (payload: { threshold_cents: number; multiplier: number }) => {
      setMarginTiersError(null);
      setIsSavingMarginTiers(true);
      try {
        const data = await createMarginTierClient(payload);
        setSettings((prev) =>
          prev
            ? {
                ...prev,
                margin_tiers: [...(prev.margin_tiers ?? []), data].sort(
                  (a, b) =>
                    (a as MarginTierRow).threshold_cents -
                    (b as MarginTierRow).threshold_cents
                ),
              }
            : prev
        );
      } catch (error) {
        setMarginTiersError(
          error instanceof Error ? error.message : "Erreur creation tranche."
        );
      } finally {
        setIsSavingMarginTiers(false);
      }
    },
    []
  );

  const handleUpdateTier = useCallback(
    async (
      id: string,
      updates: { threshold_cents?: number; multiplier?: number }
    ) => {
      setMarginTiersError(null);
      setIsSavingMarginTiers(true);
      try {
        const data = await updateMarginTierClient(id, updates);
        setSettings((prev) =>
          prev
            ? {
                ...prev,
                margin_tiers: (prev.margin_tiers ?? [])
                  .map((t) => ((t as MarginTierRow).id === id ? data : t))
                  .sort(
                    (a, b) =>
                      (a as MarginTierRow).threshold_cents -
                      (b as MarginTierRow).threshold_cents
                  ),
              }
            : prev
        );
      } catch (error) {
        setMarginTiersError(
          error instanceof Error
            ? error.message
            : "Erreur mise a jour tranche."
        );
      } finally {
        setIsSavingMarginTiers(false);
      }
    },
    []
  );

  const handleDeleteTier = useCallback(async (id: string) => {
    setMarginTiersError(null);
    setIsSavingMarginTiers(true);
    try {
      await deleteMarginTierClient(id);
      setSettings((prev) =>
        prev
          ? {
              ...prev,
              margin_tiers: (prev.margin_tiers ?? []).filter(
                (t) => (t as MarginTierRow).id !== id
              ),
            }
          : prev
      );
    } catch (error) {
      setMarginTiersError(
        error instanceof Error
          ? error.message
          : "Erreur suppression tranche."
      );
    } finally {
      setIsSavingMarginTiers(false);
    }
  }, []);

  const normalizePatchedItem = useCallback(
    (item: EditorEstimateItem) => {
      if (item.item_type !== "line") return item;
      const taxRate =
        item.tax_rate_bp ?? settings?.tax_rate_bp ?? 0;
      const { lineInput, lineValues } = computeLineValuesWithLaborContext(item, {
        marginMultiplier: settings?.margin_multiplier ?? 1,
        taxRateBp: taxRate,
      });
      return {
        ...item,
        tax_rate_bp: lineInput.tax_rate_bp,
        k_fo: lineInput.k_fo,
        h_mo: lineInput.h_mo,
        k_mo: lineInput.k_mo,
        pu_ht_cents: lineValues.puHtCents,
        line_total_ht_cents: lineValues.saleLineCents,
        line_tax_cents: lineValues.taxLineCents,
        line_total_ttc_cents: lineValues.ttcLineCents,
      };
    },
    [
      computeLineValuesWithLaborContext,
      settings?.margin_multiplier,
      settings?.tax_rate_bp,
    ]
  );

  const itemsController = useEstimateEditorItemsController({
    version,
    settings,
    isLaborSplitEnabled,
    isMutationBlocked: isReadOnly || isConflictLocked,
    mutationBlockedMessage: isConflictLocked
      ? (conflictState?.message ?? "Version modifiee par un autre utilisateur")
      : readOnlyActionErrorMessage,
    getItemsSnapshot,
    getVersionSnapshot,
    setItems,
    setTotalsOutOfSync,
    reportError: setActionError,
    resolveErrorMessage: resolveEstimateActionError,
    normalizePatchedItem,
    enqueueItemUpdate: enqueueBufferedItemUpdate,
    pushHistoryCommand,
    reloadItems,
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
    isMutationBlocked: isReadOnly || isConflictLocked,
    mutationBlockedMessage: isConflictLocked
      ? (conflictState?.message ?? "Version modifiee par un autre utilisateur")
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

  const applyVersionToken = useCallback((updatedAt: string) => {
    setVersion((previous) =>
      previous
        ? {
            ...previous,
            updated_at: updatedAt,
          }
        : previous
    );
    if (versionRef.current) {
      versionRef.current = {
        ...versionRef.current,
        updated_at: updatedAt,
      };
    }
  }, []);

  const importController = useEstimateEditorImportController({
    routeVersionId: resolvedVersionId,
    activeVersion: version,
    autoOpenStructureDraft: shouldAutoOpenStructureDraft,
    isMutationBlocked: isReadOnly || isConflictLocked,
    mutationBlockedMessage: isConflictLocked
      ? (conflictState?.message ?? "Version modifiee par un autre utilisateur")
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
    clearImportSummary,
  } = importController.actions;
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
        throw new Error("Resume V0 incoherent avec la version active.");
      }
      return refreshed.versionZeroSummary ?? null;
    },
    []
  );

  const refreshAfterAiMutation = useCallback(
    async (targetVersionId: string) => {
      const refreshed = await fetchEstimateEditorData(targetVersionId);
      if (refreshed.version.id !== targetVersionId) {
        throw new Error("Version rafraichie incoherente.");
      }

      const refreshedVersion = refreshed.version as EstimateVersionView;
      const refreshedItems = refreshed.items ?? [];
      const normalizedItems =
        refreshedVersion.status === "draft"
          ? normalizeDraftItems({
              items: refreshedItems,
              version: refreshedVersion,
              rateById: laborRateById,
              rateAtelierById: laborRateAtelierById,
              rateChantierById: laborRateChantierById,
              isLaborSplitEnabled,
            })
          : refreshedItems;

      return {
        items: applyPendingBufferedUpdatesToItems(normalizedItems),
        updatedAt: refreshedVersion.updated_at,
      };
    },
    [
      applyPendingBufferedUpdatesToItems,
      laborRateById,
      laborRateAtelierById,
      laborRateChantierById,
      isLaborSplitEnabled,
    ]
  );

  const applyAiMutationRefresh = useCallback(
    ({
      items: refreshedItems,
      updatedAt,
    }: {
      items: EditorEstimateItem[];
      updatedAt: string;
    }) => {
      setItems(refreshedItems);
      applyVersionToken(updatedAt);
    },
    [applyVersionToken]
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
    routeVersionId: resolvedVersionId,
    activeVersion: version,
    items,
    isMutationBlocked: isReadOnly || isConflictLocked,
    mutationBlockedMessage: isConflictLocked
      ? (conflictState?.message ?? "Version modifiee par un autre utilisateur")
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

  useLayoutEffect(() => {
    aiDialogActionsRef.current = {
      openGeneratedOuvrageDialog,
      openVersionZeroDialog,
      dismissDialogs: dismissAiDialogs,
    };
    hydrateAiVersionZeroSummaryRef.current = hydrateAiVersionZeroSummary;
    highlightAiMutationItemsRef.current = highlightAiMutationItems;
    return () => {
      aiDialogActionsRef.current = {
        openGeneratedOuvrageDialog: () => false,
        openVersionZeroDialog: () => false,
        dismissDialogs: () => undefined,
      };
      hydrateAiVersionZeroSummaryRef.current = () => undefined;
      highlightAiMutationItemsRef.current = () => undefined;
    };
  }, [
    dismissAiDialogs,
    highlightAiMutationItems,
    hydrateAiVersionZeroSummary,
    openGeneratedOuvrageDialog,
    openVersionZeroDialog,
  ]);

  const suggestionsController = useEstimateEditorSuggestionsController({
    routeVersionId: resolvedVersionId,
    currentUserId: profile?.id ?? null,
    previewItems: deferredItems,
    categories,
    isMutationBlocked: isReadOnly || isConflictLocked,
    mutationBlockedMessage: isConflictLocked
      ? (conflictState?.message ?? "Version modifiee par un autre utilisateur")
      : readOnlyActionErrorMessage,
    getItemsSnapshot,
    getVersionSnapshot,
    setItems,
    normalizeLine: normalizePatchedItem,
    setTotalsOutOfSync,
    reportError: setActionError,
    resolveErrorMessage: resolveEstimateActionError,
    ensureGroupedActionCanProceed,
    applyVersionToken,
    handleVersionConflict,
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
    if (versionRef.current?.id === updatedVersion.id) {
      versionRef.current = {
        ...versionRef.current,
        status: updatedVersion.status,
        updated_at: updatedVersion.updated_at,
        seal_hash: updatedVersion.seal_hash ?? versionRef.current.seal_hash,
      };
    }
  }, []);

  const statusController = useEstimateEditorStatusController({
    routeVersionId: resolvedVersionId,
    activeVersion: version
      ? {
          id: version.id,
          status: version.status,
          updated_at: version.updated_at,
        }
      : null,
    gatingReloadToken: reloadNonce,
    getVersionSnapshot,
    applyUpdatedVersion: applyStatusVersion,
    isAdmin,
    isViewerReadOnly,
    isConflictLocked,
    conflictMessage: conflictState?.message ?? null,
    isDraftLockPending,
    isDraftLockedByOther,
    draftLockedByOtherMessage: `Verrouille par ${lockHolderLabel}.`,
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
    sendWorkflowPhaseLabel,
  } = statusController.meta;
  const canSend = canSendForStatus && !isViewerReadOnly;

  const supplierController = useEstimateEditorSupplierController({
    routeVersionId: resolvedVersionId,
    items,
    isMutationBlocked: isReadOnly || isConflictLocked,
    mutationBlockedMessage: isConflictLocked
      ? (conflictState?.message ?? "Version modifiee par un autre utilisateur")
      : readOnlyActionErrorMessage,
    getItemsSnapshot,
    getVersionSnapshot,
    normalizeLine: normalizePatchedItem,
    setItems,
    setTotalsOutOfSync,
    reportError: setActionError,
    resolveErrorMessage: resolveEstimateActionError,
    applyVersionToken,
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
    isMutationBlocked: isReadOnly || isConflictLocked,
    mutationBlockedMessage: isConflictLocked
      ? (conflictState?.message ?? "Version modifiee par un autre utilisateur")
      : readOnlyActionErrorMessage,
    isLaborSplitEnabled,
    getItemsSnapshot,
    getVersionSnapshot,
    setItems,
    setTotalsOutOfSync,
    reportError: setActionError,
    resolveErrorMessage: resolveEstimateActionError,
    normalizeLine: normalizePatchedItem,
    applyVersionToken,
    ensureGroupedActionCanProceed,
    handleVersionConflict,
    triggerVersionReload,
    pushHistoryCommand,
    recreateItemsFromSnapshots,
    applySiblingOrder,
    reloadItems,
  });
  const {
    applyBulkMajoration: handleApplyBulkMajoration,
    bulkDeleteLines: handleBulkDeleteLines,
    bulkMoveLines: handleBulkMoveLines,
    bulkSetCategory: handleBulkSetCategory,
    bulkSetLaborRole: handleBulkSetLaborRole,
  } = bulkController.actions;

  const pasteController = useEstimateEditorPasteController({
    settings,
    isLaborSplitEnabled,
    isMutationBlocked: isReadOnly || isConflictLocked,
    mutationBlockedMessage: isConflictLocked
      ? (conflictState?.message ?? "Version modifiee par un autre utilisateur")
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
  });
  const { pasteRows: handlePasteRows } = pasteController.actions;

  const structureController = useEstimateEditorStructureController({
    routeVersionId: resolvedVersionId,
    isMutationBlocked: isReadOnly || isConflictLocked,
    mutationBlockedMessage: isConflictLocked
      ? (conflictState?.message ?? "Version modifiee par un autre utilisateur")
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
    reloadItems,
  });
  const {
    insertAssembly: handleInsertAssembly,
    insertTemplate: handleInsertTemplate,
    duplicateSection: handleDuplicateSection,
  } = structureController.actions;

  const handleDuplicateSectionToVersion = useCallback<
    NonNullable<EstimateEditorTableProps["onDuplicateSectionToVersion"]>
  >(
    async ({ sectionId, targetVersionId }) => {
      if (isReadOnly) {
        setActionError(readOnlyActionErrorMessage);
        return;
      }
      if (isConflictLocked) {
        setActionError(
          conflictState?.message ?? "Version modifiee par un autre utilisateur"
        );
        return;
      }

      const versionSnapshot = versionRef.current;
      if (!versionSnapshot) {
        setActionError("Version introuvable.");
        return;
      }

      if (targetVersionId === versionSnapshot.id) {
        await handleDuplicateSection(sectionId);
        return;
      }

      setActionError(null);
      let targetLockAcquired = false;
      let redirected = false;

      try {
        const lockResult = await acquireEstimateDraftLock(targetVersionId);
        const isOwnedByCurrentUser =
          lockResult.lock?.isOwnedByCurrentUser !== false;

        if (!lockResult.acquired || !isOwnedByCurrentUser) {
          const holderName = lockResult.lock?.holderName?.trim() ?? "";
          const holder = holderName.length > 0 ? holderName : "un autre utilisateur";
          setActionError(`La version cible est verrouillee par ${holder}.`);
          return;
        }

        targetLockAcquired = true;
        await duplicateEstimateSection(versionSnapshot.id, sectionId, {
          targetVersionId,
        });

        redirected = true;
        router.push(`/dashboard/estimates/${targetVersionId}/edit`);
      } catch (error) {
        setActionError(
          resolveEstimateActionError(
            error instanceof Error
              ? error.message
              : "Impossible de dupliquer la section vers cette version."
          )
        );
      } finally {
        if (targetLockAcquired && !redirected) {
          try {
            await releaseEstimateDraftLock(targetVersionId);
          } catch {
            // Best-effort cleanup of a lock acquired for a failed cross-version duplication.
          }
        }
      }
    },
    [
      conflictState?.message,
      handleDuplicateSection,
      isConflictLocked,
      isReadOnly,
      readOnlyActionErrorMessage,
      router,
    ]
  );

  const editorTableProps = useMemo<EstimateEditorTableProps>(
    () => ({
      versionId: version?.id ?? resolvedVersionId,
      items,
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
      actionError,
      marginMultiplier:
        totals?.appliedMarginMultiplier ?? editorTableBaseConfig.marginMultiplier,
      discountCents: editorTableBaseConfig.discountCents,
      taxRateBp: editorTableBaseConfig.taxRateBp,
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
      onInsertAssembly: handleInsertAssembly,
      onInsertTemplate: handleInsertTemplate,
      sectionDuplicateTargets,
      onDuplicateSection: handleDuplicateSection,
      onDuplicateSectionToVersion: handleDuplicateSectionToVersion,
      onOpenImportFromEstimateDialog: handleOpenImportFromEstimateDialog,
      onOpenEstimateStructureDraftDialog: handleOpenEstimateStructureDraftDialog,
      onOpenGeneratedOuvrageDialog: handleOpenGeneratedOuvrageDialog,
      onDeleteItem: handleDeleteItem,
      onPatchItem: handlePatchItem,
      onTrackSuggestionCorrections: handleTrackSuggestionCorrections,
      onApplyBulkMajoration: handleApplyBulkMajoration,
      onBulkDeleteLines: handleBulkDeleteLines,
      onBulkMoveLines: handleBulkMoveLines,
      onBulkSetCategory: handleBulkSetCategory,
      onBulkSetLaborRole: handleBulkSetLaborRole,
      onPasteRows: handlePasteRows,
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
      headerRight: isFinalizationPanelOpen ? (
        <EstimateChecklist
          checklist={checklist}
          isCollapsed={isChecklistCollapsed}
          anomalyCount={qualityCounts.totalFlagsCount}
          affectedLineCount={qualityCounts.linesWithAnomaliesCount}
          onToggleCollapsed={handleToggleChecklistCollapsed}
          onCriterionClick={handleChecklistCriterionClick}
          onShowAnomalies={handleShowChecklistAnomalies}
        />
      ) : null,
    }),
    [
      actionError,
      categories,
      detectedOutlierFlagsByItemId,
      dismissedOutlierFlagsByItemId,
      editorTableBaseConfig,
      editorTableVirtualization,
      highlightedItemIds,
      handleAddLine,
      handleAddSection,
      handleInsertAssembly,
      handleInsertTemplate,
      handleDuplicateSection,
      handleDuplicateSectionToVersion,
      handleOpenImportFromEstimateDialog,
      handleOpenEstimateStructureDraftDialog,
      handleOpenGeneratedOuvrageDialog,
      handleApplyBulkMajoration,
      handleBulkDeleteLines,
      handleBulkMoveLines,
      handleBulkSetCategory,
      handleBulkSetLaborRole,
      handlePasteRows,
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
      items,
      isLaborSplitEnabled,
      isViewerReadOnly,
      laborRateById,
      laborRoles,
      outlierActionPendingByItemId,
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
      checklist,
      isFinalizationPanelOpen,
      isChecklistCollapsed,
      handleChecklistCriterionClick,
      handleToggleChecklistCollapsed,
      handleToggleFinalizationPanel,
      handleShowChecklistAnomalies,
      settings?.currency,
      totals?.appliedMarginMultiplier,
      version?.id,
      version?.max_section_depth,
      resolvedVersionId,
    ]
  );

  const closeSettingsDrawer = useCallback(() => {
    setIsSettingsDrawerOpen(false);
  }, []);
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
  const toolbarProps: ComponentProps<typeof EstimateEditorToolbar> | null = version
    ? {
        projectName,
        versionNumber: version.version_number,
        status: version.status,
        autoSaveStatus,
        autoSaveStatusLabel,
        autoSaveStatusClassName,
        showAutoSaveStatus: version.status === "draft",
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
        isExportDisabled,
        isExporting,
        exportLoadingLabel,
        activeExportMode,
        isImportingDpgfSource,
        isImportDpgfSourceDisabled,
        versionId,
      }
    : null;

  const alertsProps = useMemo<ComponentProps<typeof EstimateEditorAlerts>>(
    () => ({
      statusError,
      isViewerReadOnly,
      canSend,
      isSendBlockedForCurrentUser,
      isDraftLockedByOther,
      lockHolderLabel,
      isAdmin,
      isForcingDraftUnlock,
      isDraftLockAcquiring,
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
      isUndoBulkSuggestDisabled: isSaveBlocked,
      importSummaryMessage,
      actionError,
    }),
    [
      actionError,
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
      isDraftLockAcquiring,
      isDraftLockedByOther,
      isForcingDraftUnlock,
      hasRestorableDraft,
      isReloadingVersion,
      isSaveBlocked,
      isSendBlockedForCurrentUser,
      isStatusReadOnly,
      isUndoingBulkSuggest,
      isViewerReadOnly,
      lockHolderLabel,
      retryTotalsSave,
      statusError,
      totalsOutOfSync,
      totals,
    ]
  );

  const summaryBarProps = useMemo<
    ComponentProps<typeof EstimateSettingsSummaryBar> | null
  >(
    () =>
      settings
        ? {
            totals,
            currency: settings.currency ?? DEFAULT_ESTIMATE_CURRENCY,
            taxRateBp: settings.tax_rate_bp ?? 2000,
            isExpert,
            onOpenSettings: handleOpenSettingsDrawer,
          }
        : null,
    [handleOpenSettingsDrawer, isExpert, settings, totals]
  );

  const drawerProps: ComponentProps<typeof EstimateEditorDrawer> | null =
    version && settings
      ? {
          isOpen: isSettingsDrawerOpen,
          onClose: closeSettingsDrawer,
          actionError,
          projectName,
          versionNumber: version.version_number,
          settings,
          totals,
          isSavingSettings,
          isSaveBlocked,
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

  const bulkSuggestDialogProps = useMemo<ComponentProps<typeof BulkSuggestDialog>>(
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

  const supplierPreselectionDialogProps: ComponentProps<
    typeof SupplierPreselectionDialog
  > = {
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

  const importFromEstimateDialogProps = useMemo<
    ComponentProps<typeof ImportFromEstimateDialog> | null
  >(
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

  const estimateStructureDraftDialogProps = useMemo<
    ComponentProps<typeof EstimateStructureDraftDialog> | null
  >(
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

  const sendGatingDialogProps: ComponentProps<typeof EstimateSendGatingDialog> = {
    isOpen: isSendGatingDialogOpen,
    isSubmitting: isUpdatingStatus,
    phaseLabel: sendWorkflowPhaseLabel,
    blockingFlags: sendGating?.blockingFlags ?? [],
    warningFlags: sendGating?.warningFlags ?? [],
    canForce: isAdmin,
    projectId: version?.project_id ?? null,
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
      toolbarProps: toolbarProps!,
      alertsProps,
      summaryBarProps: summaryBarProps!,
      editorTableProps,
      drawerProps: drawerProps!,
      bulkSuggestDialogProps,
      supplierPreselectionDialogProps,
      importFromEstimateDialogProps,
      estimateStructureDraftDialogProps,
      generatedOuvrageDialogProps,
      versionZeroDraftDialogProps,
      sendGatingDialogProps,
    },
  };
}
