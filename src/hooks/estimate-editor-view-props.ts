import type { EstimateTotals } from "@/lib/estimate-calculations";
import type { EstimateQualityFlagCounts, EstimateQualityFlagsByItemId } from "@/lib/estimate-quality";
import type { BulkSuggestPreviewItem } from "@/lib/estimates/bulk-suggest";
import type { EstimateChecklistCriterion, EstimateChecklistResult } from "@/lib/estimates/checklist";
import type { ClipboardPreviewValues } from "@/lib/estimates/clipboard";
import type { ExistingSection } from "@/lib/estimates/editor-item-tree";
import type { EstimateQualityFilter } from "@/lib/estimates/editor-quality-filter";
import type {
  EstimateEditorData,
  VersionZeroDraftSummary,
} from "@/lib/estimates/editor-read-contracts";
import type { EstimateSettingsState, SettingsSection } from "@/lib/estimates/editor-settings-state";
import type {
  EstimateEditorItemPatch,
  EstimateSectionCalculation,
  EstimateVirtualizationConfig,
  SuggestionCorrectionPayload,
  SuggestionLearningState,
  SuggestionRuleCreatePayload,
} from "@/lib/estimates/editor-table-types";
import type { ExistingSectionOption } from "@/lib/estimates/estimate-structure-draft";
import type { EstimateExportMode } from "@/lib/estimates/export-client";
import type {
  EstimateOutlierFlagKey,
  EstimateOutlierFlagsByItemId,
  EstimateOutlierMethod,
} from "@/lib/estimates/outlier-detection";
import type { PriceReuseApplyInput } from "@/lib/estimates/price-reuse-contracts";
import type { EstimateSendGatingLine, EstimateSendGatingReserveLine } from "@/lib/estimates/offer-choice-lines";
import type { EstimateVersionEvent } from "@/lib/estimates/schemas";
import type { ImportEstimateSectionsPayload } from "@/lib/estimates/section-copy-client";
import type { EstimateStatusReason } from "@/lib/estimates/status-reason";
import type {
  ApplyEstimateStructureDraftPayload,
  ApplyEstimateStructureDraftResult,
} from "@/lib/estimates/structure-drafts-client";
import type { EstimateSupplierPreselectionReview } from "@/lib/estimates/supplier-preselection";
import type { EstimateV3SummaryView } from "@/lib/estimates/v3-editor";
import type { EstimateSendGatingFlag } from "@/lib/estimates/version-lifecycle-client";
import type { SupportedEstimateCurrency } from "@/lib/money";
import type { AutoSaveStatus } from "@/hooks/useAutoSave";
import type { EstimateV3SettingsController } from "@/hooks/useEstimateV3Settings";
import type { Database } from "@/types/database";

/**
 * What the estimate editor gives each region of its page: the editor's hooks build these props and the
 * page hands them to its components, whose props are these types. A component that needs another prop
 * changes its contract here.
 */

type EstimateStatus = Database["public"]["Enums"]["estimate_status"];
type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];
type EstimateCategory = Database["public"]["Tables"]["estimate_categories"]["Row"];
type SupplyType = Database["public"]["Tables"]["supply_types"]["Row"];
type LaborRole = Database["public"]["Tables"]["labor_roles"]["Row"];
type SuggestionRule =
  Database["public"]["Tables"]["estimate_suggestion_rules"]["Row"];
type ItemPatch = EstimateEditorItemPatch;

export type EstimateEditorToolbarProps = {
  onBeforeGeneratePdf?: () => Promise<boolean>;
  onPdfPrepared?: (data: EstimateEditorData) => void;
  /** A PDF is ready: the send gating is read again (TI-691, « PDF absent »). */
  onPdfReady?: () => void;
  projectId?: string | null;
  projectName: string;
  versionNumber: number;
  status: EstimateStatus;
  autoSaveStatus: AutoSaveStatus;
  autoSaveStatusLabel: string;
  autoSaveStatusClassName: string;
  showAutoSaveStatus: boolean;
  isAutoSaveEnabled: boolean;
  hasPendingChanges: boolean;
  lastSavedAt: string | null;
  isSaveNowDisabled: boolean;
  onAutoSaveEnabledChange: (enabled: boolean) => void;
  onSaveNow: () => void;
  canSend: boolean;
  canAccept: boolean;
  canArchive: boolean;
  isStatusActionsDisabled: boolean;
  isUpdatingStatus: boolean;
  isDraftLockedByOther: boolean;
  isDraftLockAcquiring: boolean;
  isForcingDraftUnlock: boolean;
  onSend: () => void;
  onAccept: () => void;
  onOpenExclusions: () => void;
  onArchive: () => void;
  onExportExcel: () => void;
  onExportCSV: () => void;
  onExportDpgf: () => void;
  onExportBdc: () => void;
  onImportDpgfSource: () => void;
  showImportDpgfSource: boolean;
  onOpenVersionZeroDialog?: () => void;
  versionZeroActionLabel?: string;
  isVersionZeroActionDisabled?: boolean;
  isExcelExportDisabled: boolean;
  isCsvExportDisabled: boolean;
  isDpgfExportDisabled: boolean;
  isBdcExportDisabled: boolean;
  isExporting: boolean;
  exportLoadingLabel: string;
  activeExportMode: EstimateExportMode | "csv" | null;
  isImportingDpgfSource: boolean;
  isImportDpgfSourceDisabled: boolean;
  versionId: string;
};

export type EstimateEditorAlertsProps = {
  statusError: string | null;
  isViewerReadOnly: boolean;
  canSend: boolean;
  isSendBlockedForCurrentUser: boolean;
  /** The blockers the send gating names, listed with what lifts each (TI-691). */
  sendBlockingFlags?: readonly EstimateSendGatingFlag[];
  versionId?: string | null;
  projectId?: string | null;
  onBeforeGeneratePdf?: () => Promise<boolean>;
  onPdfPrepared?: (data: EstimateEditorData) => void;
  /** The PDF is ready: the gating is read again. */
  onPdfReady?: () => void;
  isDraftLockedByOther: boolean;
  lockHolderLabel: string;
  isAdmin: boolean;
  isForcingDraftUnlock: boolean;
  onForceUnlockDraftLock: () => void;
  draftLockError: string | null;
  conflictMessage: string | null;
  isReloadingVersion: boolean;
  onReloadAfterConflict: () => void;
  hasRestorableDraft: boolean;
  onRestoreConflictDraft: () => void;
  totalsOutOfSync: boolean;
  /** Total écrêté au plafond de stockage : le montant affiché est minoré. */
  isTotalCapped?: boolean;
  isSaveBlocked: boolean;
  onRetryTotalsSave: () => void;
  isStatusReadOnly: boolean;
  bulkSuggestAppliedCount: number | null;
  onUndoBulkSuggest: () => void;
  isUndoingBulkSuggest: boolean;
  isUndoBulkSuggestDisabled: boolean;
  importSummaryMessage: string | null;
  actionNotice: string | null;
  actionError: string | null;
  batchRecovery?: EstimateMutationRecovery;
};

export type EstimateMutationRecovery = {
  message: string | null; canResume: boolean; isBusy: boolean;
  verify: () => Promise<void>; resume?: () => Promise<void>;
  canAbandon?: boolean; abandon?: () => Promise<void>;
};

export type EstimateSectionDuplicateTarget = {
  versionId: string;
  label: string;
};

export type EstimateEditorTableProps = {
  projectId?: string;
  versionId: string;
  currency?: SupportedEstimateCurrency;
  items: EstimateItem[];
  categories: EstimateCategory[];
  supplyTypes: SupplyType[];
  laborRoles: LaborRole[];
  suggestionRules: SuggestionRule[];
  learningState?: SuggestionLearningState;
  detectedOutlierFlagsByItemId: EstimateOutlierFlagsByItemId;
  dismissedOutlierFlagsByItemId: EstimateOutlierFlagsByItemId;
  outlierActionPendingByItemId: Record<string, boolean>;
  outlierDetectionMethod: EstimateOutlierMethod;
  outlierThreshold: number;
  qualityFlagsByItemId: EstimateQualityFlagsByItemId;
  qualityCounts: EstimateQualityFlagCounts;
  qualityFilter: EstimateQualityFilter;
  /** @deprecated Les erreurs globales sont rendues par EstimateEditorAlerts. */
  actionError?: string | null;
  marginMultiplier: number;
  discountCents: number;
  taxRateBp: number;
  sectionCalculation: EstimateSectionCalculation;
  laborRateById: Map<string, number>;
  isLaborSplitEnabled?: boolean;
  isReadOnly: boolean;
  isViewerMode?: boolean;
  maxSectionDepth?: number;
  onQualityFilterChange: (value: EstimateQualityFilter) => void;
  onOutlierDetectionMethodChange: (value: EstimateOutlierMethod) => void;
  onOutlierThresholdChange: (value: number) => void;
  onToggleOutlierDismiss: (
    itemId: string,
    flagKey: EstimateOutlierFlagKey,
    dismissed: boolean
  ) => void;
  onAddSection: (parentId: string | null) => void;
  onAddLine: (parentId: string | null) => void;
  onDeleteItem: (itemId: string) => void;
  sectionDuplicateTargets?: EstimateSectionDuplicateTarget[];
  onDuplicateSection?: (sectionId: string) => Promise<void>;
  onDuplicateSectionToVersion?: (input: {
    sectionId: string;
    targetVersionId: string;
  }) => Promise<void>;
  /** Lot 3.2, entrée 1 (D-b) : v3, conversion ligne ↔ section par un lot de l'écrivain v3 ; `true` une fois validée. */
  onConvertItems?: (itemIds: readonly string[], target: "section" | "line") => Promise<boolean>;
  onPatchItem: (
    itemId: string,
    patch: ItemPatch,
    options?: { persist?: boolean }
  ) => void;
  onTrackSuggestionCorrections?: (
    corrections: SuggestionCorrectionPayload[]
  ) => Promise<void>;
  /** Cellules de plusieurs lignes écrites ensemble (coller, recopier, effacer) : une seule annulation. */
  onApplyCellPatches?: (
    entries: ReadonlyArray<{ itemId: string; patch: ItemPatch }>
  ) => Promise<boolean | void>;
  onApplyBulkMajoration: (itemIds: string[], coefficient: number) => Promise<void>;
  onBulkDeleteLines: (itemIds: string[]) => Promise<void>;
  onBulkMoveLines: (
    itemIds: string[],
    targetParentId: string | null
  ) => Promise<void>;
  onBulkSetCategory: (itemIds: string[], categoryId: string | null) => Promise<void>;
  onBulkSetLaborRole: (itemIds: string[], laborRoleId: string | null) => Promise<void>;
  onResizeOuvrage?: (itemId: string, quantity: number) => Promise<void>;
  onInsertAssembly: (
    assemblyId: string,
    afterItemId: string | null
  ) => Promise<void>;
  onInsertTemplate: (
    templateId: string,
    afterItemId: string | null
  ) => Promise<void>;
  onPasteRows: (input: {
    anchorRowId: string | null;
    rows: ClipboardPreviewValues[];
    laborRoleId?: string | null;
  }) => Promise<void>;
  /** Keyboard shortcuts: each resolves to the created ids, or null when nothing was created. */
  onInsertLineBelow?: (anchorRowId: string | null) => Promise<string[] | null>;
  onDuplicateLineBelow?: (anchorRowId: string | null) => Promise<string[] | null>;
  onInsertSectionBelow?: (anchorRowId: string | null) => Promise<string[] | null>;
  onUndo: () => Promise<void>;
  onRedo: () => Promise<void>;
  canUndo: boolean;
  canRedo: boolean;
  isUndoRedoBusy: boolean;
  bulkSuggestionEligibleCount: number;
  supplierPreselectionEligibleCount: number;
  onOpenBulkSuggestDialog: () => void;
  onOpenSupplierPreselectionDialog: () => void;
  onOpenImportFromEstimateDialog?: () => void;
  onOpenPriceReuseDialog?: () => void;
  onOpenEstimateStructureDraftDialog?: () => void;
  onOpenGeneratedOuvrageDialog?: () => void;
  onReorder: (parentId: string | null, orderedIds: string[]) => void;
  onMoveItem: (
    itemId: string,
    fromParentId: string | null,
    toParentId: string | null,
    orderedSourceIds: string[],
    orderedTargetIds: string[]
  ) => void;
  scrollToItemId?: string | null;
  revealScrollTarget?: boolean;
  onScrollToItemHandled?: () => void;
  virtualization?: EstimateVirtualizationConfig;
  highlightedItemIds?: Set<string>;
  headerRight?: React.ReactNode;
  ribbonHeaderNode?: React.ReactNode;
  ribbonAlertsNode?: React.ReactNode;
  /** Totals of the version, pinned under the table. */
  totalsFooterNode?: React.ReactNode;
  isFinalizationPanelOpen?: boolean;
  onToggleFinalizationPanel?: () => void;
  onOpenSettings?: () => void;
};

export type EstimateChecklistProps = {
  checklist: EstimateChecklistResult;
  isCollapsed: boolean;
  anomalyCount: number;
  affectedLineCount: number;
  onToggleCollapsed: () => void;
  onCriterionClick: (criterion: EstimateChecklistCriterion) => void;
  onShowAnomalies: () => void;
};

export type EstimateSettingsSummaryBarProps = {
  totals: EstimateTotals | null;
  currency: SupportedEstimateCurrency;
  taxRateBp: number;
  isExpert: boolean;
  onOpenSettings: (section?: SettingsSection) => void;
  /**
   * Lot 2, sous-lot 2.6 : pied d'une v3 (aperçu du moteur pur, D7, D8), présent seulement sur une
   * v3 ; nul tant que l'aperçu est indisponible. Aucune marge v2 (multiplicateur ×1) n'y figure.
   */
  v3Summary?: EstimateV3SummaryView | null;
  /**
   * TI-539 : nombre de lignes dont la fourniture attendue n'a pas de coût. Un coût manquant n'est pas un
   * coût nul voulu : tant qu'il en reste, le total affiché est annoncé provisoire et incomplet.
   */
  missingSupplyCostCount?: number;
};

type AuditLogEntry = {
  id: string;
  action: string;
  table_name: string;
  record_id: string;
  created_at: string;
};

export type EstimateEditorDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  hasUnsavedSettings: boolean;
  onDiscardSettings: () => void;
  onSaveBeforeClose: () => Promise<boolean>;
  projectName: string;
  versionNumber: number;
  settings: EstimateSettingsState;
  totals: EstimateTotals | null;
  isSavingSettings: boolean;
  isSaveBlocked: boolean;
  recovery?: EstimateMutationRecovery;
  isFrozen?: boolean;
  storedMarginMultiplier?: number;
  /** TI-682, lot C, PR 4 : titres des lignes réservées dans l'offre (insertion dans les précisions). */
  reservedLineTitles?: readonly string[];
  /** TI-682, lot C, PR 5 : phrases des quantités provisionnelles, d'après les lignes actuelles. */
  provisionalQuantityMentions?: readonly string[];
  onChangeSettings: (patch: Partial<EstimateSettingsState>) => void;
  onSaveSettings: () => void;
  /** Lot 2, sous-lot 2.6 : réglages d'une v3 (`useEstimateV3Settings`), nuls en v1/v2. */
  v3Settings?: EstimateV3SettingsController | null;
  /**
   * Lot 2, sous-lot 2.6 : faux pour une v3, dont le moteur n'applique aucun barème (repère seulement,
   * F26-12) ; le gestionnaire v1/v2 décrit l'application du barème et son barème par défaut.
   */
  showMarginTiers?: boolean;
  laborRoles: LaborRole[];
  onCreateRole: (payload: { name: string; hourly_rate_cents: number }) => Promise<void>;
  onUpdateRole: (id: string, updates: Partial<LaborRole>) => Promise<void>;
  isSavingMarginTiers: boolean;
  marginTiersError: string | null;
  canEditMarginTiers: boolean;
  onCreateTier: (payload: { threshold_cents: number; multiplier: number }) => Promise<void>;
  onUpdateTier: (id: string, updates: { threshold_cents?: number; multiplier?: number }) => Promise<void>;
  onDeleteTier: (id: string) => Promise<void>;
  suggestionRules: SuggestionRule[];
  categories: EstimateCategory[];
  isSavingRules: boolean;
  rulesError: string | null;
  onCreateSuggestionRule: (payload: SuggestionRuleCreatePayload) => Promise<void>;
  onUpdateSuggestionRule: (id: string, updates: Partial<SuggestionRule>) => Promise<void>;
  isAdmin: boolean;
  timelineEvents: EstimateVersionEvent[];
  isTimelineLoading: boolean;
  timelineError: string | null;
  onRefreshTimeline: () => void;
  isAuditLoading: boolean;
  auditError: string | null;
  auditLogs: AuditLogEntry[];
  onRefreshAuditLogs: () => void;
  formatAuditTimestamp: (value: string) => string;
};

type BulkSuggestProgress = {
  processed: number;
  total: number;
  percentage: number;
};

export type BulkSuggestDialogProps = {
  isOpen: boolean;
  rows: BulkSuggestPreviewItem[];
  selectedItemIds: string[];
  isApplying: boolean;
  progress: BulkSuggestProgress | null;
  showProgress: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
  onToggleItem: (itemId: string, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
};

export type SupplierPreselectionDialogProps = {
  isOpen: boolean;
  review: EstimateSupplierPreselectionReview | null;
  selectedItemIds: string[];
  isLoading: boolean;
  isApplying: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
  onToggleItem: (itemId: string, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
};

export type ImportFromEstimateDialogProps = {
  isOpen: boolean;
  targetVersionId: string;
  onClose: () => void;
  onConfirm: (input: ImportEstimateSectionsPayload) => Promise<void>;
};

export type PriceReuseDialogProps = {
  isOpen: boolean;
  targetVersionId: string;
  onClose: () => void;
  /** Saves the editor's pending edits first, so the comparison reads what the user sees. */
  prepareComparison: () => Promise<boolean>;
  onConfirm: (input: PriceReuseApplyInput) => Promise<void>;
};

export type EstimateStructureDraftDialogProps = {
  isOpen: boolean;
  targetVersionId: string;
  hasExistingItems: boolean;
  existingSections: ExistingSectionOption[];
  onClose: (result?: ApplyEstimateStructureDraftResult) => void;
  onConfirm: (
    draftId: string,
    input: ApplyEstimateStructureDraftPayload,
  ) => Promise<ApplyEstimateStructureDraftResult>;
};

export type GeneratedOuvrageDialogProps = {
  scopeKey: string;
  isOpen: boolean;
  targetVersionId: string;
  projectId: string;
  existingSections: ExistingSection[];
  isMutationBlocked: boolean;
  mutationBlockedMessage: string;
  ensureMutationCanProceed: (actionLabel: string) => Promise<boolean>;
  onClose: (result?: { insertedCount?: number }) => void;
};

export type VersionZeroDraftDialogProps = {
  isOpen: boolean;
  versionId: string;
  summary: VersionZeroDraftSummary | null;
  isMutationBlocked: boolean;
  mutationBlockedMessage: string;
  ensureMutationCanProceed: (actionLabel: string) => Promise<boolean>;
  onClose: (result?: { materialized?: boolean }) => void;
};

export type EstimateSendGatingDialogProps = {
  isOpen: boolean;
  isSubmitting: boolean;
  phaseLabel: string | null;
  blockingFlags: EstimateSendGatingFlag[];
  warningFlags: EstimateSendGatingFlag[];
  canForce: boolean;
  projectId?: string | null;
  /** The lines of `excluded_without_reason`, by title and status. */
  statusReasonLines?: readonly EstimateSendGatingLine[];
  /** Saves the internal reason of a line, then checks the send again; absent for a reader who cannot write the line. */
  onSaveStatusReason?: (itemId: string, reason: EstimateStatusReason) => Promise<unknown> | void;
  /**
   * The reserved lines of `offer_reserve_declared` and `offer_limits_required`, by title and reserve; PR 5: the lines of
   * `provisional_quantity_mention_missing`, by title and the sentence the limits must carry, and those of
   * `takeoff_hypothesis_without_mention`, by title.
   */
  reserveLines?: readonly EstimateSendGatingReserveLine[];
  /** Opens the limits text, where the reserves are inserted and reviewed; absent for who cannot write it. */
  onOpenLimits?: () => void;
  onClose: () => void;
  onConfirm: () => void;
  onForceConfirm: () => void;
};
