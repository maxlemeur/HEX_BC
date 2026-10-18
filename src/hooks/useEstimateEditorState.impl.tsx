"use client";

import { useRouter } from "next/navigation";
import { isOlderEstimateVersionToken } from "@/lib/estimates/editor-mutations";
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

import type { BulkSuggestDialog } from "@/components/estimates/BulkSuggestDialog";
import { EstimateChecklist } from "@/components/estimates/EstimateChecklist";
import type { GeneratedOuvrageDialog } from "@/components/estimates/GeneratedOuvrageDialog";
import type { EstimateStructureDraftDialog } from "@/components/estimates/EstimateStructureDraftDialog";
import type { SupplierPreselectionDialog } from "@/components/estimates/SupplierPreselectionDialog";
import type { VersionZeroDraftDialog } from "@/components/estimates/VersionZeroDraftDialog";
import { EstimateEditorAlerts } from "@/components/estimates/editor/EstimateEditorAlerts";
import type { EstimateEditorDrawer } from "@/components/estimates/editor/EstimateEditorDrawer";
import { EstimateEditorToolbar } from "@/components/estimates/editor/EstimateEditorToolbar";
import {
  EstimateEditorTable,
  type EstimateSectionDuplicateTarget,
} from "@/components/estimates/EstimateEditorTable";
import type { ImportFromEstimateDialog } from "@/components/estimates/ImportFromEstimateDialog";
import type { EstimateSendGatingDialog } from "@/components/estimates/EstimateSendGatingDialog";
import type { DiscountMode, EstimateSettingsState } from "@/components/estimates/EstimateSettingsPanel";
import type { EstimateV3GridModel } from "@/components/estimates/v3/V3LineCells";
import {
  EstimateSettingsSummaryBar,
  type SettingsSection,
} from "@/components/estimates/EstimateSettingsSummaryBar";
import { useUserContext } from "@/components/UserContext";
import { useEstimateEditorExportController } from "@/hooks/useEstimateEditorExportController";
import { isEstimateEditorOperationScopeCurrent } from "@/hooks/estimate-editor-operation-scope";
import { estimateEditorAutoSaveStatusClassName } from "@/hooks/estimate-editor-autosave-status";
import { buildEstimateEditorTableVirtualization } from "@/hooks/estimate-editor-virtualization-runtime";
import {
  formatEstimateEditorAuditTimestamp,
  type EstimateEditorActivityController,
} from "@/hooks/useEstimateEditorActivityController";
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
  computeDraftBreakdown,
  computeLineValuesWithLaborContext as computeLineValuesWithLaborContextFromMaps,
  useEstimateEditorCalculation,
} from "@/hooks/useEstimateEditorCalculation";
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
import { useEstimateV3Settings } from "@/hooks/useEstimateV3Settings";
import type { EstimateTotals } from "@/lib/estimate-calculations";
import { hasFreshEstimateV2Snapshot } from "@/lib/estimates/calc-engine-version";
import { isLegacyEngine, isUnifiedEngine } from "@/lib/estimates/engine/capabilities";
import {
  normalizeEditorDraftItems, reconcilesEditorTotals, resolveEditorEngineContext, resolveEditorInitialDiscountCents,
  resolveEditorQualityItems,
} from "@/lib/estimates/editor-engine";
import {
  ESTIMATE_V3_EDITOR_WRITER, ESTIMATE_V3_PASTE_UNAVAILABLE_MESSAGE, recomputeEstimateV3AfterLaborRate,
} from "@/lib/estimates/v3-editor-writer";
import {
  buildEditorItemSyncBaseline, buildEstimateV3ItemUpdatePayload, buildEstimateV3SummaryView, indexEstimateV3Lines,
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
  LABOR_SPLIT_FIELD_KEYS,
  buildEstimateItemUpdatePayload,
  buildVersionDiscountPatch,
  buildVersionTotalsPatch,
  resolveLaborRoleHourlyRate,
  type EditorEstimateItem,
  type EstimateItem,
  type EstimateVersionRow,
  type EstimateVersionTotalsPatch,
  type LaborRole,
} from "@/lib/estimates/editor-items";
import {
  ESTIMATE_EDITOR_VIRTUALIZATION_AUTO_THRESHOLD_FLAG_KEY,
  ESTIMATE_EDITOR_VIRTUALIZATION_MODE_FLAG_KEY,
} from "@/lib/estimate-editor-virtualization";
import {
  acquireEstimateDraftLock,
  isEstimateApiError,
  createEstimateLaborRole,
  createMarginTier as createMarginTierClient,
  updateMarginTier as updateMarginTierClient,
  deleteMarginTier as deleteMarginTierClient,
  duplicateEstimateSection,
  fetchEstimateDraftVersions,
  fetchEstimateEditorData,
  type EstimateEditorData,
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

const MAX_CASCADE_DISCOUNT_STEPS = 4;

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

function buildSettingsComparisonSnapshot(
  settings: EstimateSettingsState | null
) {
  if (!settings) return null;

  return {
    title: settings.title,
    date_devis: settings.date_devis,
    exclusions: settings.exclusions,
    validite_jours: settings.validite_jours,
    currency: settings.currency,
    margin_multiplier: settings.margin_multiplier,
    margin_mode: settings.margin_mode ?? "fixed",
    discount_cents: settings.discount_cents,
    discount_amount_cents: settings.discount_amount_cents ?? null,
    discount_bp: settings.discount_bp ?? null,
    discount_mode: settings.discount_mode ?? "simple",
    discount_steps: normalizeCascadeDiscountSteps(settings.discount_steps),
    global_coefficient: settings.global_coefficient ?? 1,
    tax_rate_bp: settings.tax_rate_bp,
    contractor_role: settings.contractor_role ?? "principal",
    rounding_mode: settings.rounding_mode,
    rounding_step_cents: settings.rounding_step_cents,
  };
}

/** Réglages de l'éditeur relus d'une version (chargement ; relecture d'une sauvegarde v3). */
function buildEditorSettingsFromVersion(
  versionRow: EstimateVersionRow,
  context: { marginTiers: NonNullable<EstimateSettingsState["margin_tiers"]>; discountCents: number }
) {
  const discountMode: DiscountMode = versionRow.discount_mode === "cascade" ? "cascade" : "simple";
  return {
    title: versionRow.title ?? "",
    exclusions: versionRow.exclusions ?? "",
    date_devis: versionRow.date_devis,
    validite_jours: versionRow.validite_jours,
    currency: resolveEstimateCurrency(versionRow.currency),
    margin_multiplier: versionRow.margin_multiplier,
    margin_mode: versionRow.margin_mode ?? "fixed",
    margin_tiers: context.marginTiers,
    discount_cents: versionRow.discount_amount_cents ?? context.discountCents,
    discount_amount_cents: versionRow.discount_amount_cents ?? null,
    discount_bp: versionRow.discount_bp,
    discount_mode: discountMode,
    discount_steps: discountMode === "cascade" ? normalizeCascadeDiscountSteps(versionRow.discount_steps) : [],
    global_coefficient: Number.isFinite(versionRow.global_coefficient ?? NaN) ? Math.max(versionRow.global_coefficient ?? 1, 0) : 1,
    tax_rate_bp: versionRow.tax_rate_bp,
    contractor_role: versionRow.contractor_role ?? "principal",
    rounding_mode: versionRow.rounding_mode,
    rounding_step_cents: versionRow.rounding_step_cents,
  };
}

type EstimateVersionUpdate = Database["public"]["Tables"]["estimate_versions"]["Update"];

/** Charge v1/v2 des réglages, inchangée (le moteur 3 a la sienne, `buildEstimateV3SettingsPayload`). */
function buildHistoricalSettingsPayload(
  settingsSnapshot: EstimateSettingsState,
  versionSnapshot: EstimateVersionRow,
  totalsSnapshot: EstimateTotals
) {
  const discountBase = totalsSnapshot.saleSubtotalCents;
  const discountBp =
    settingsSnapshot.discount_amount_cents == null
      ? (settingsSnapshot.discount_bp ?? versionSnapshot.discount_bp)
      : discountBase > 0
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
  const payload: EstimateVersionUpdate = {
    title: settingsSnapshot.title.trim() || null,
    exclusions: settingsSnapshot.exclusions.trim() || null,
    date_devis: settingsSnapshot.date_devis,
    validite_jours: settingsSnapshot.validite_jours,
    currency: settingsSnapshot.currency,
    margin_multiplier: totalsSnapshot.appliedMarginMultiplier,
    margin_mode: settingsSnapshot.margin_mode ?? "fixed",
    discount_bp: discountBp,
    discount_amount_cents: settingsSnapshot.discount_amount_cents ?? null,
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
  return { payload, discountPatch };
}

function haveEstimateSettingsChanged(
  settings: EstimateSettingsState | null,
  savedSettings: EstimateSettingsState | null
) {
  return (
    JSON.stringify(buildSettingsComparisonSnapshot(settings)) !==
    JSON.stringify(buildSettingsComparisonSnapshot(savedSettings))
  );
}

function resolveLatestSavedAt(
  first: string | null | undefined,
  second: string | null | undefined
) {
  if (!first) return second ?? null;
  if (!second) return first;
  return Date.parse(first) >= Date.parse(second) ? first : second;
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
        /** Lot 2, sous-lot 2.6 : lignes du moteur v3 pour la grille, nul en v1/v2. */
        v3Grid: EstimateV3GridModel | null;
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
  const resolvedVersionId = versionId;
  const {
    autoOpenVersionZero: shouldAutoOpenVersionZero,
    autoOpenStructureDraft: shouldAutoOpenStructureDraft,
  } = resolveEstimateEditorAutoOpenDialogs({
    autoOpenVersionZero,
    autoOpenStructureDraft,
  });
  const { profile } = useUserContext();
  const readActorId = profile?.id ?? null;
  const readTenantId = profile?.tenant_id ?? null;
  const isAdmin = profile?.role === "admin";
  const isViewerReadOnly = profile?.tenant_role === "viewer";
  const { isExpert } = useUiMode();
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
  const savedSettingsRef = useRef(savedSettings);
  useLayoutEffect(() => {
    savedSettingsRef.current = savedSettings;
  }, [savedSettings]);
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
  const settingsSavePromiseRef = useRef<{
    versionId: string;
    promise: Promise<boolean | undefined>;
  } | null>(null);
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
  const [isSavingMarginTiers, setIsSavingMarginTiers] = useState(false);
  const [marginTiersError, setMarginTiersError] = useState<string | null>(null);
  const [totalsOutOfSync, setTotalsOutOfSync] = useState(false);
  const [sectionDuplicateTargets, setSectionDuplicateTargets] = useState<
    EstimateSectionDuplicateTarget[]
  >([]);
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
  const loadedReadIdentityRef = useRef<{
    actorId: string;
    tenantId: string;
    versionId: string;
  } | null>(null);
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
  const highlightAiMutationItemsRef = useRef<
    (itemIds: readonly string[]) => void
  >(() => undefined);

  useLayoutEffect(() => {
    activeRouteVersionIdRef.current = resolvedVersionId;
    activeReadTenantRef.current = readTenantId;
    if (settingsSaveRouteRef.current !== resolvedVersionId) {
      settingsSaveRouteRef.current = resolvedVersionId;
      settingsSaveGenerationRef.current += 1;
    }
  }, [readTenantId, resolvedVersionId]);

  const getItemsSnapshot = useCallback(() => itemsRef.current, []);
  const getVersionSnapshot = useCallback(() => {
    const snapshot = versionRef.current;
    return snapshot?.id === activeRouteVersionIdRef.current &&
      snapshot.tenant_id === activeReadTenantRef.current ? snapshot : null;
  }, []);
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

      itemsRef.current = nextItems;
      setItems(nextItems);

      return {
        restoredItems,
        skippedItemCount:
          draft.items.length - restoredItems.length + serverOnlyItems.length,
      };
    },
    []
  );
  const applyVersionFlushResult = useCallback(
    ({
      versionId,
      totalsPatch,
      updatedAt,
      contentRevision,
    }: {
      versionId: string;
      totalsPatch: EstimateVersionTotalsPatch | undefined;
      updatedAt: string;
      contentRevision?: number;
    }) => {
      setVersion((previous) =>
        previous?.id === versionId &&
        !isOlderEstimateVersionToken(updatedAt, previous.updated_at)
          ? {
              ...previous,
              ...(totalsPatch ?? {}),
              updated_at: updatedAt,
              ...(contentRevision !== undefined ? { content_revision: contentRevision } : {}),
            }
          : previous
      );
      if (versionRef.current?.id === versionId &&
          !isOlderEstimateVersionToken(updatedAt, versionRef.current.updated_at)) {
        versionRef.current = {
          ...versionRef.current,
          ...(totalsPatch ?? {}),
          updated_at: updatedAt,
          ...(contentRevision !== undefined ? { content_revision: contentRevision } : {}),
        };
      }
    },
    []
  );

  // Lot 2, sous-lot 2.6 : moteur de la version ouverte ; une v3 délègue ses réglages et son aperçu.
  const { isV3, historical: calcEngineVersion } = resolveEditorEngineContext(version);
  const v3Settings = useEstimateV3Settings({
    version, items, laborRoles, laborSplitEnabled: isLaborSplitEnabled, marginTiers: settings?.margin_tiers,
  });
  const v3Breakdown = isV3 ? (v3Settings?.preview?.breakdown ?? null) : undefined;
  const hasUnsavedSettings = useMemo(
    () => haveEstimateSettingsChanged(settings, savedSettings) || Boolean(v3Settings?.isDirty),
    [savedSettings, settings, v3Settings?.isDirty]
  );

  const syncController = useEstimateEditorSyncController({
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
    applyRestoredDraft,
    applyVersionFlushResult,
    setTotalsOutOfSync,
    clearHistory: clearUndoRedoHistory,
    reportError: setActionError,
    reportNotice: setActionNotice,
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
    overlayPendingUpdates: applyPendingBufferedUpdatesToItems,
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
    isReadOnly,
    isConflictLocked,
    isSaveBlocked,
    isReadRecoveryRequired,
    readOnlyActionErrorMessage,
    lockHolderLabel,
  } = syncController.meta;
  const settingsSaveGuardRef = useRef({
    isBlocked: isSaveBlocked,
    message: isConflictLocked
      ? (conflictState?.message ?? ESTIMATE_VERSION_CONFLICT_MESSAGE)
      : (batchRecovery.message ?? readOnlyActionErrorMessage),
  });

  useLayoutEffect(() => {
    settingsSaveGuardRef.current = {
      isBlocked: isSaveBlocked,
      message: isConflictLocked
        ? (conflictState?.message ?? ESTIMATE_VERSION_CONFLICT_MESSAGE)
        : (batchRecovery.message ?? readOnlyActionErrorMessage),
    };
  }, [
    conflictState?.message,
    batchRecovery.message,
    isConflictLocked,
    isSaveBlocked,
    readOnlyActionErrorMessage,
  ]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const initialLoadHandlersRef = useRef({
    applyPendingBufferedUpdatesToItems, clearConflictState, enqueueBufferedItemUpdate,
    markVersionReloadFinished, isReadRecoveryRequired,
  });
  useLayoutEffect(() => {
    initialLoadHandlersRef.current = {
      applyPendingBufferedUpdatesToItems, clearConflictState, enqueueBufferedItemUpdate,
      markVersionReloadFinished, isReadRecoveryRequired,
    };
  }, [applyPendingBufferedUpdatesToItems, clearConflictState, enqueueBufferedItemUpdate,
    markVersionReloadFinished, isReadRecoveryRequired]);

  useEffect(() => {
    if (!resolvedVersionId) {
      return deferEffectStateUpdate(() => {
        setSuggestionsHydration(null);
      });
    }

    const loadedIdentity = loadedReadIdentityRef.current;
    const hasLoadedVersion = versionRef.current?.id === resolvedVersionId &&
      loadedIdentity?.versionId === resolvedVersionId &&
      loadedIdentity.actorId === readActorId && loadedIdentity.tenantId === readTenantId;
    // A known read failure has one recovery owner. Only its explicit verification
    // may reread and release the mutation barrier, retaining the current editor.
    if (hasLoadedVersion && initialLoadHandlersRef.current.isReadRecoveryRequired) return;
    let active = true;
    let hasReadEditorData = false;

    async function load() {
      if (!hasLoadedVersion) setIsLoading(true);
      setLoadError(null);
      if (!hasLoadedVersion) setSuggestionsHydration(null);

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
        hasReadEditorData = true;

        const versionRow = data.version as EstimateVersionView;
        if (versionRow.id !== resolvedVersionId ||
            (readTenantId && versionRow.tenant_id !== readTenantId)) {
          throw new Error("Les données reçues appartiennent à un autre devis ou une autre organisation.");
        }
        if (versionRef.current?.id === versionRow.id &&
            isOlderEstimateVersionToken(versionRow.updated_at, versionRef.current.updated_at)) {
          initialLoadHandlersRef.current.markVersionReloadFinished(false);
          return;
        }
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

        const normalizedItems = normalizeEditorDraftItems({
          items: itemsRows, version: versionRow, rateById, rateAtelierById, rateChantierById, isLaborSplitEnabled,
        });

        const discountCents = resolveEditorInitialDiscountCents({
          version: versionRow, items: itemsRows, rateById, rateAtelierById, rateChantierById, isLaborSplitEnabled,
          marginTiers: data.marginTiers ?? [],
        });
        const initialSettings = buildEditorSettingsFromVersion(versionRow, { marginTiers: data.marginTiers ?? [], discountCents });

        versionRef.current = versionRow;
        loadedReadIdentityRef.current = readActorId && readTenantId
          ? { actorId: readActorId, tenantId: readTenantId, versionId: versionRow.id }
          : null;
        setVersion(versionRow);
        hydrateAiVersionZeroSummaryRef.current(
          versionRow.id,
          data.versionZeroSummary ?? null,
          { autoOpen: shouldAutoOpenVersionZero }
        );
        setItems(initialLoadHandlersRef.current.applyPendingBufferedUpdatesToItems(normalizedItems));
        setCategories(data.categories ?? []);
        setSupplyTypes(data.supplyTypes ?? []);
        setLaborRoles(rolesData);
        setSuggestionsHydration({
          versionId: versionRow.id,
          rules: data.suggestionRules ?? [],
          learning,
        });
        const previousSavedSettings = hasLoadedVersion ? savedSettingsRef.current : null;
        setSettings((current) => {
          if (!current || !previousSavedSettings) return initialSettings;
          const currentFields = buildSettingsComparisonSnapshot(current);
          const savedFields = buildSettingsComparisonSnapshot(previousSavedSettings);
          if (!currentFields || !savedFields) return initialSettings;
          const localChanges = Object.fromEntries(Object.keys(currentFields).filter((key) =>
            JSON.stringify(currentFields[key as keyof typeof currentFields]) !==
            JSON.stringify(savedFields[key as keyof typeof savedFields])
          ).map((key) => [key, current[key as keyof EstimateSettingsState]]));
          return { ...initialSettings, ...localChanges };
        });
        savedSettingsRef.current = initialSettings;
        setSavedSettings(initialSettings);
        initialLoadHandlersRef.current.clearConflictState();
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
            initialLoadHandlersRef.current.enqueueBufferedItemUpdate(item.id, {
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
        initialLoadHandlersRef.current.markVersionReloadFinished(true);
      } catch (error) {
        if (!active) return;
        const message =
          error instanceof Error
            ? resolveEstimateActionError(error.message)
            : "Impossible de charger le chiffrage.";
        const isTransientReadFailure = !hasReadEditorData && (
          error instanceof TypeError ||
          (error instanceof Error && error.name === "AbortError") ||
          (isEstimateApiError(error) && error.status >= 500 && error.status < 600)
        );
        if (hasLoadedVersion && isTransientReadFailure) {
          setActionError(initialLoadHandlersRef.current.isReadRecoveryRequired
            ? "La lecture du devis reste interrompue. Vérifiez le résultat ; vos saisies sont conservées."
            : "Impossible de relire le chiffrage. Vos saisies sont conservées.");
        } else {
          setLoadError(message);
        }
        initialLoadHandlersRef.current.markVersionReloadFinished(false);
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [
    isLaborSplitEnabled,
    readActorId,
    readTenantId,
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
  const handleOpenSettingsDrawer = useCallback((section?: SettingsSection) => {
    setIsSettingsDrawerOpen(true);
    setDrawerScrollTarget(section ?? null);
  }, []);
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
      highlightAiMutationItemsRef.current([focusItemId]);
    });
  }, [focusItemId, handleChecklistFocusItem]);

  const laborRateMaps = useMemo(
    () => ({
      laborRateById,
      laborRateAtelierById,
      laborRateChantierById,
    }),
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
        vatReverseCharge?: boolean;
      }
    ) =>
      computeLineValuesWithLaborContextFromMaps(item, laborRateMaps, {
        ...options,
        isLaborSplitEnabled,
      }),
    [isLaborSplitEnabled, laborRateMaps]
  );

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
      if (settingsSavePromiseRef.current?.versionId === activeRouteVersionIdRef.current) return;
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

      const normalizedItems = normalizeEditorDraftItems({
        items: itemsRows, version: activeVersion, rateById: laborRateById, rateAtelierById: laborRateAtelierById,
        rateChantierById: laborRateChantierById, isLaborSplitEnabled,
      });

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

  const reconcileEditorData = useCallback((refreshed: EstimateEditorData) => {
    if (!resolvedVersionId) return;
    const targetVersionId = resolvedVersionId;
    if (activeRouteVersionIdRef.current !== targetVersionId) return;
    const versionRow = refreshed.version as EstimateVersionView;
    if (versionRow.id !== targetVersionId || (versionRef.current?.id === targetVersionId &&
      isOlderEstimateVersionToken(versionRow.updated_at, versionRef.current.updated_at))) {
      throw new Error("Le devis relu a changé. Actualisez avant de poursuivre.");
    }
    const itemsRows = refreshed.items as EstimateItem[];
    const rates = new Map(refreshed.laborRoles.map((role) => [role.id, role.hourly_rate_cents]));
    const atelierRates = new Map(refreshed.laborRoles.map((role) => [role.id, resolveLaborRoleHourlyRate(role, "atelier")]));
    const chantierRates = new Map(refreshed.laborRoles.map((role) => [role.id, resolveLaborRoleHourlyRate(role, "chantier")]));
    const normalized = normalizeEditorDraftItems({
      items: itemsRows, version: versionRow, rateById: rates, rateAtelierById: atelierRates,
      rateChantierById: chantierRates, isLaborSplitEnabled,
    });
    const discountCents = resolveEditorInitialDiscountCents({
      version: versionRow, items: itemsRows, rateById: rates, rateAtelierById: atelierRates, rateChantierById: chantierRates,
      isLaborSplitEnabled, marginTiers: refreshed.marginTiers ?? [],
    });
    const previousSaved = savedSettingsRef.current;
    const overlaidItems = applyPendingBufferedUpdatesToItems(normalized);
    versionRef.current = versionRow;
    setVersion(versionRow);
    itemsRef.current = overlaidItems;
    setItems(overlaidItems);
    setLaborRoles(refreshed.laborRoles);
    if (previousSaved && settingsSavePromiseRef.current?.versionId !== targetVersionId) {
      const nextSaved = { ...previousSaved,
        discount_cents: versionRow.discount_amount_cents ?? discountCents,
        discount_amount_cents: versionRow.discount_amount_cents ?? null,
        discount_bp: versionRow.discount_bp };
      savedSettingsRef.current = nextSaved;
      setSavedSettings(nextSaved);
      setSettings((current) => current &&
        current.discount_cents === previousSaved.discount_cents &&
        (current.discount_amount_cents ?? null) === (previousSaved.discount_amount_cents ?? null) &&
        current.discount_bp === previousSaved.discount_bp &&
        (current.discount_mode ?? "simple") === (previousSaved.discount_mode ?? "simple") &&
        JSON.stringify(normalizeCascadeDiscountSteps(current.discount_steps)) === JSON.stringify(normalizeCascadeDiscountSteps(previousSaved.discount_steps))
        ? { ...current, discount_cents: nextSaved.discount_cents,
            discount_amount_cents: nextSaved.discount_amount_cents,
            discount_bp: nextSaved.discount_bp } : current);
    }
  }, [applyPendingBufferedUpdatesToItems, isLaborSplitEnabled, resolvedVersionId]);

  const reloadItemsForStructuralMutation = useCallback(async () => {
    if (!resolvedVersionId) return;
    const refreshed = await fetchEstimateEditorData(resolvedVersionId);
    reconcileEditorData(refreshed);
  }, [reconcileEditorData, resolvedVersionId]);

  function handleSaveSettings(): Promise<boolean | undefined> {
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

  async function performSaveSettings() {
    if (!settings || !version || (!totals && !isV3)) return;
    if (version.id !== resolvedVersionId) return;
    if (isReadOnly) {
      setActionError(readOnlyActionErrorMessage);
      return;
    }
    if (isConflictLocked) {
      setActionError(
        conflictState?.message ?? ESTIMATE_VERSION_CONFLICT_MESSAGE
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
      if (
        !(await ensureGroupedActionCanProceed(
          "sauvegarder les paramètres",
          { allowPendingSettings: true }
        ))
      ) {
        return;
      }
      if (!isCurrentSettingsSave()) return;

      const currentGuard = settingsSaveGuardRef.current;
      if (currentGuard.isBlocked) {
        setActionError(currentGuard.message);
        return;
      }

      // Revue de 2.6 (F26-27) : Ctrl+S, la fermeture du tiroir et la navigation posent aussi la question de propagation
      // de la TVA (tiroir rendu visible), et rien ne part avant la réponse ; Échap n'enregistre rien.
      if (isV3 && v3Settings && !(await v3Settings.askTaxPropagation(() => handleOpenSettingsDrawer("tax")))) return;
      if (!isCurrentSettingsSave()) return;
      const versionSnapshot = getVersionSnapshot();
      if (!versionSnapshot || versionSnapshot.id !== targetVersionId) return;
      // Lot 2, sous-lot 2.6 : charge v3 du module pur (D5, D6, D8), jamais de taux dérivé ni de total client.
      const v3Save = isV3 ? (v3Settings?.buildSavePayload() ?? null) : null;
      if (isV3 && !v3Save?.ok) {
        setActionError(v3Save?.ok === false ? v3Save.message : "Réglages du moteur de calcul 3 indisponibles.");
        return;
      }
      const settingsPayload = v3Save?.ok ? { payload: v3Save.payload as EstimateVersionUpdate, discountPatch: {} }
        : totalsSnapshot ? buildHistoricalSettingsPayload(settingsSnapshot, versionSnapshot, totalsSnapshot) : null;
      if (!settingsPayload) return;
      const { payload, discountPatch } = settingsPayload;

      const persistSettings = () =>
        saveEstimateVersion(
          targetVersionId,
          payload,
          versionSnapshot.updated_at,
          versionSnapshot.content_revision
        );

      let saved: Awaited<ReturnType<typeof saveEstimateVersion>>;
      try {
        try {
          saved = await persistSettings();
        } catch (error) {
          if (!isDraftLockRequiredError(error)) throw error;
          const reacquired = await recoverDraftLock();
          if (!reacquired) throw error;
          saved = await persistSettings();
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
      // The server repriced every line at these settings, on every engine, and a v3 « Oui » also
      // rewrote each line's VAT rate: an undo captured before would write back the lines of the
      // previous ones, with their totals on v1 and their VAT rate on v3.
      clearUndoRedoHistory();
      discardBulkSuggestUndo();

      const updatedVersion = saved.version;
      const mergedVersion = {
        ...versionSnapshot,
        ...payload,
        ...updatedVersion,
      } as EstimateVersionView;
      if (versionRef.current?.id === targetVersionId &&
          isOlderEstimateVersionToken(mergedVersion.updated_at, versionRef.current.updated_at)) {
        setActionError("Le devis a changé après l'enregistrement. Rechargez pour vérifier les paramètres.");
        return;
      }
      versionRef.current = mergedVersion;
      setVersion((previous) =>
        previous?.id === targetVersionId ? mergedVersion : previous
      );

      const nextSavedSettings = (isV3 || !totalsSnapshot
        ? buildEditorSettingsFromVersion(mergedVersion, { marginTiers: settingsSnapshot.margin_tiers ?? [], discountCents: 0 })
        : {
            ...settingsSnapshot,
            margin_multiplier: mergedVersion.margin_multiplier,
            margin_mode: settingsSnapshot.margin_mode ?? "fixed",
            discount_cents: mergedVersion.discount_amount_cents ?? totalsSnapshot.discountCents,
            discount_amount_cents: mergedVersion.discount_amount_cents ?? null,
            discount_bp: mergedVersion.discount_bp,
            ...discountPatch,
          }) as EstimateSettingsState;
      setSavedSettings(nextSavedSettings);
      setSettings(nextSavedSettings);

      const currentItemsById = new Map(itemsRef.current.map((item) => [item.id, item]));
      const confirmedItems = saved.items.map((item) => ({ ...currentItemsById.get(item.id), ...item }));
      itemsRef.current = confirmedItems;
      setItems(confirmedItems);
      // v3 : « Oui » réécrit le taux des lignes au serveur (D8) ; leur état relu devient la référence.
      if (isV3) markItemsSynced(saved.items.map((item) => ({ id: item.id, updates: buildEditorItemSyncBaseline(item) })));
      if (isCurrentSettingsSave()) {
        clearConflictDraft({ onlyIfRestored: true });
        return true;
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
      if (settingsSaveGuardRef.current.isBlocked) {
        setActionError(settingsSaveGuardRef.current.message);
        return;
      }
      if (isReadOnly) {
        setActionError(readOnlyActionErrorMessage);
        return;
      }
      if (isConflictLocked) {
        setActionError(
          conflictState?.message ?? ESTIMATE_VERSION_CONFLICT_MESSAGE
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
      if (settingsSaveGuardRef.current.isBlocked) {
        setActionError(settingsSaveGuardRef.current.message);
        return;
      }
      if (isReadOnly) {
        setActionError(readOnlyActionErrorMessage);
        return;
      }
      if (isConflictLocked) {
        setActionError(
          conflictState?.message ?? ESTIMATE_VERSION_CONFLICT_MESSAGE
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
        setActionError(error instanceof Error ? error.message : "Impossible de mettre à jour le rôle.");
        return;
      }

      setLaborRoles((prev) =>
        prev.map((role) => (role.id === id ? { ...role, ...updates } : role))
      );

      // v3 (revue, F26-23) : un lot v3 recalcule et stocke lignes et totaux au nouveau taux (l'aperçu le suit déjà).
      if (isV3 && updates.hourly_rate_cents !== undefined && !isReadOnly && !isConflictLocked) {
        const snapshot = getVersionSnapshot() ?? version;
        await recomputeEstimateV3AfterLaborRate(snapshot.id, snapshot.updated_at, itemsRef.current, id)?.catch((error: unknown) =>
          setActionError(`Le taux horaire est enregistré, mais les montants du devis n'ont pas été recalculés : ${error instanceof Error ? error.message : "erreur inconnue"}`));
      }
      if (updates.hourly_rate_cents === undefined || !settings || isV3) return;

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
          vatReverseCharge: settings.contractor_role === "subcontractor",
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

      if (isReadOnly || isConflictLocked) return;

      updatedLines.forEach((item) => {
        enqueueBufferedItemUpdate(item.id, buildEstimateItemUpdatePayload(item));
      });
    },
    [
      enqueueBufferedItemUpdate,
      conflictState?.message,
      getVersionSnapshot,
      isConflictLocked,
      isReadOnly,
      isV3,
      readOnlyActionErrorMessage,
      settings,
      version,
      computeLineValuesWithLaborContext,
    ]
  );

  const canEditMarginTiers = profile?.tenant_role === "admin" && !isSaveBlocked;

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
          error instanceof Error ? error.message : "Erreur création tranche."
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
            : "Erreur mise à jour tranche."
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
      // v3 : la ligne garde ses saisies ; PU, nets et heures totales viennent du moteur v3.
      if (item.item_type !== "line" || isV3) return item;
      const taxRate =
        item.tax_rate_bp ?? settings?.tax_rate_bp ?? 0;
      let marginMultiplier = settings?.margin_multiplier ?? 1;
      if (isUnifiedEngine(calcEngineVersion) && settings?.margin_mode === "tiered") {
        const currentItems = getItemsSnapshot();
        const postPatchItems = currentItems.some((current) => current.id === item.id)
          ? currentItems.map((current) => current.id === item.id ? item : current)
          : [...currentItems, item];
        marginMultiplier = computeDraftBreakdown({
            items: postPatchItems,
            settings,
            calcEngineVersion,
            isLaborSplitEnabled,
            ...laborRateMaps,
        }).totals.appliedMarginMultiplier;
      }
      const { lineInput, lineValues } = computeLineValuesWithLaborContext(item, {
        marginMultiplier,
        taxRateBp: taxRate,
        vatReverseCharge: settings?.contractor_role === "subcontractor",
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
      calcEngineVersion,
      computeLineValuesWithLaborContext,
      getItemsSnapshot,
      isLaborSplitEnabled,
      isV3,
      laborRateMaps,
      settings,
    ]
  );

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
        throw new Error("Résumé V0 incohérent avec la version active.");
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
      const normalizedItems = normalizeEditorDraftItems({
        items: refreshedItems, version: refreshedVersion, rateById: laborRateById,
        rateAtelierById: laborRateAtelierById, rateChantierById: laborRateChantierById, isLaborSplitEnabled,
      });

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
    sendWorkflowPhaseLabel,
  } = statusController.meta;
  // Lot 2, sous-lot 2.6 : l'émission d'une v3 reste fermée jusqu'au contrat client 2 (2.7).
  const canSend = canSendForStatus && !isViewerReadOnly && !isV3;

  const supplierController = useEstimateEditorSupplierController({
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
    unavailableMessage: isV3 ? ESTIMATE_V3_PASTE_UNAVAILABLE_MESSAGE : null,
  });
  const { pasteRows: handlePasteRows } = pasteController.actions;

  const structureController = useEstimateEditorStructureController({
    routeVersionId: resolvedVersionId,
    isMutationBlocked: isReadOnly || isConflictLocked,
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
          conflictState?.message ?? ESTIMATE_VERSION_CONFLICT_MESSAGE
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

      if (hasUnsavedSettings) {
        setActionError(
          "Enregistrez le paramétrage avant de dupliquer cette section vers une autre version."
        );
        return;
      }

      if (
        !(await ensureGroupedActionCanProceed(
          "dupliquer cette section vers une autre version"
        ))
      ) {
        return;
      }

      const synchronizedVersionSnapshot = versionRef.current;
      if (!synchronizedVersionSnapshot) {
        setActionError("Version introuvable.");
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
          setActionError(`La version cible est verrouillée par ${holder}.`);
          return;
        }

        targetLockAcquired = true;
        await duplicateEstimateSection(synchronizedVersionSnapshot.id, sectionId, {
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
      ensureGroupedActionCanProceed,
      handleDuplicateSection,
      hasUnsavedSettings,
      isConflictLocked,
      isReadOnly,
      readOnlyActionErrorMessage,
      router,
    ]
  );

  const editorTableProps = useMemo<EstimateEditorTableProps>(
    () => ({
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
      sectionCalculation: {
        marginMode: settings?.margin_mode ?? "fixed",
        marginTiers: settings?.margin_tiers ?? [],
        globalCoefficient: settings?.global_coefficient ?? 1,
        discountMode: settings?.discount_mode ?? "simple",
        discountStepsBp: settings?.discount_steps ?? [],
        calcEngineVersion,
        // v3 : les sections somment les nets de l'aperçu, sans calcul v2.
        preserveStoredSnapshot: isReadOnly || isV3,
      },
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
      categories,
      calcEngineVersion,
      detectedOutlierFlagsByItemId,
      dismissedOutlierFlagsByItemId,
      editorTableBaseConfig,
      editorTableVirtualization,
      editorDisplayItems,
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
      isLaborSplitEnabled,
      isReadOnly,
      isV3,
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
      settings?.discount_mode,
      settings?.discount_steps,
      settings?.global_coefficient,
      settings?.margin_mode,
      settings?.margin_tiers,
      totals?.appliedMarginMultiplier,
      totals?.discountCents,
      version?.id,
      version?.max_section_depth,
      resolvedVersionId,
    ]
  );

  const v3Grid = useMemo<EstimateV3GridModel | null>(
    () => (v3Breakdown === undefined ? null : { lines: indexEstimateV3Lines(v3Breakdown) }),
    [v3Breakdown]
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
        // Exports v3 (unité, h/u, PU et PT bruts, TVA par taux) : sous-lot 2.7.
        isExportDisabled: isExportDisabled || isV3,
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
            taxRateBp: settings.tax_rate_bp ?? DEFAULT_TAX_RATE_BP,
            isExpert,
            onOpenSettings: handleOpenSettingsDrawer,
            v3Summary: v3Breakdown === undefined ? undefined : buildEstimateV3SummaryView(v3Breakdown),
          }
        : null,
    [handleOpenSettingsDrawer, isExpert, settings, totals, v3Breakdown]
  );

  const snapshotContext = version?.calc_snapshot_context;
  const snapshotMultiplier = snapshotContext && typeof snapshotContext === "object" && !Array.isArray(snapshotContext)
    ? snapshotContext.effective_margin_multiplier
    : undefined;
  // Lot 2, sous-lot 2.6 : une v3 n'a pas de multiplicateur de marge (marque nette, D5) ; jamais
  // `effective_margin_multiplier`, que la v2 affiche comme multiplicateur.
  const storedMarginMultiplier = isV3 ? undefined : hasFreshEstimateV2Snapshot(version) &&
    typeof snapshotMultiplier === "number" && Number.isFinite(snapshotMultiplier) &&
    snapshotMultiplier >= 0 && snapshotMultiplier <= 100
    ? snapshotMultiplier
    : isLegacyEngine(calcEngineVersion) || settings?.margin_mode !== "tiered"
      ? settings?.margin_multiplier
      : undefined;

  const drawerProps: ComponentProps<typeof EstimateEditorDrawer> | null =
    version && settings
      ? {
          isOpen: isSettingsDrawerOpen,
          onClose: closeSettingsDrawer,
          hasUnsavedSettings,
          onDiscardSettings: () => {
            setSettings(savedSettings);
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
      v3Grid,
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
