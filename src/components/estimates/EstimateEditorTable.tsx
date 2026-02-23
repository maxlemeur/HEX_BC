"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import {
  type SectionTotals,
} from "@/lib/estimate-calculations";
import { formatEUR } from "@/lib/money";
import { PastePreviewDialog } from "@/components/estimates/PastePreviewDialog";
import { EstimateEditorBody } from "@/components/estimates/components/EstimateEditorBody";
import {
  EstimateEditorRow,
  getSpreadsheetColumnKeys,
} from "@/components/estimates/components/EstimateEditorRow";
import {
  EstimateSuggestionRow,
  type SuggestionPreview,
} from "@/components/estimates/components/EstimateSuggestionRow";
import { EstimateEditorToolbar } from "@/components/estimates/components/EstimateEditorToolbar";
import { ColumnHeaderHelp, COLUMN_HEADER_TOOLTIPS } from "@/components/estimates/components/ColumnHeaderHelp";
import {
  sendEstimateSuggestionRuleFeedback,
} from "@/lib/estimates/client";
import { AssemblyPicker } from "@/components/estimates/AssemblyPicker";
import {
  SupplierComparisonPanel,
  type SupplierComparisonAlternative,
} from "@/components/estimates/SupplierComparisonPanel";
import { EstimateEditorProvider } from "@/components/estimates/context/EstimateEditorContext";
import {
  useEstimateClipboard,
} from "@/components/estimates/hooks/useEstimateClipboard";
import {
  useEstimateKeyboardShortcuts,
} from "@/components/estimates/hooks/useEstimateKeyboardShortcuts";
import {
  useEstimateSelection,
} from "@/components/estimates/hooks/useEstimateSelection";
import {
  useEstimateDndVirtualization,
  type VirtualizedRow,
} from "@/components/estimates/hooks/useEstimateDndVirtualization";
import {
  useEstimateVisibility,
} from "@/components/estimates/hooks/useEstimateVisibility";
import {
  useSpreadsheetNavigation,
  type SpreadsheetNavigationRow,
} from "@/hooks/useSpreadsheetNavigation";
import {
  useColumnVisibility,
  type ColumnKey,
} from "@/hooks/useColumnVisibility";
import {
  type EstimateQualityFlagCounts,
  type EstimateQualityFlagKey,
  type EstimateQualityFlagsByItemId,
} from "@/lib/estimate-quality";
import {
  type EstimateOutlierFlagKey,
  type EstimateOutlierFlagsByItemId,
  type EstimateOutlierMethod,
} from "@/lib/estimates/outlier-detection";
import {
  rankSuggestions,
} from "@/lib/estimates/suggestion-scoring";
import {
  type ClipboardPreviewValues,
} from "@/lib/estimates/clipboard";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];
type EstimateCategory = Database["public"]["Tables"]["estimate_categories"]["Row"];
type SupplyType = Database["public"]["Tables"]["supply_types"]["Row"];
type LaborRole = Database["public"]["Tables"]["labor_roles"]["Row"];
type SuggestionRule =
  Database["public"]["Tables"]["estimate_suggestion_rules"]["Row"];
type LaborSplitItemFields = {
  h_mo_atelier?: number | null;
  k_mo_atelier?: number | null;
  labor_role_atelier_id?: string | null;
  h_mo_chantier?: number | null;
  k_mo_chantier?: number | null;
  labor_role_chantier_id?: string | null;
};

type ItemPatch = Partial<
  Pick<
    EstimateItem,
    | "title"
    | "description"
    | "quantity"
    | "unit_price_ht_cents"
    | "tax_rate_bp"
    | "k_fo"
    | "h_mo"
    | "h_mo_majoration"
    | "k_mo"
    | "pu_ht_cents"
    | "labor_role_id"
    | "category_id"
    | "supply_type_id"
    | "selected_supplier_price_id"
  >
> &
  LaborSplitItemFields;

const TRACKED_SUGGESTION_CORRECTION_FIELDS = [
  "description",
  "category_id",
  "k_fo",
  "k_mo",
  "labor_role_id",
  "supply_type_id",
] as const;

type SuggestionCorrectionFieldName =
  (typeof TRACKED_SUGGESTION_CORRECTION_FIELDS)[number];
type SuggestionCorrectionValue = string | number | null;
type SuggestionAppliedValues = Partial<
  Record<SuggestionCorrectionFieldName, SuggestionCorrectionValue>
>;

export type SuggestionLearningRuleBoost = {
  rule_id: string;
  learning_boost: number;
  overrides: {
    description?: string | null;
    category_id?: string | null;
    k_fo?: number | null;
    k_mo?: number | null;
    labor_role_id?: string | null;
    supply_type_id?: string | null;
  };
};

export type SuggestionLearningState = {
  enabled: boolean;
  by_rule_id: Record<string, SuggestionLearningRuleBoost>;
};

export type SuggestionCorrectionPayload = {
  rule_id: string;
  field_name: SuggestionCorrectionFieldName;
  original_value: string | null;
  corrected_value: string | null;
  item_title: string;
};

type AppliedSuggestionContext = {
  ruleId: string;
  suggestedValues: SuggestionAppliedValues;
  trackedFieldDivergences: Partial<Record<SuggestionCorrectionFieldName, true>>;
};

type EstimateQualityFilter = "all_lines" | "with_anomalies" | EstimateQualityFlagKey;
type EstimateVirtualizationConfig = {
  enabled?: boolean;
  rowEstimate?: number;
  overscan?: number;
  maxHeight?: number;
  containerHeight?: number;
};

export type EstimateSectionDuplicateTarget = {
  versionId: string;
  label: string;
};

type EstimateEditorTableProps = {
  versionId: string;
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
  actionError: string | null;
  marginMultiplier: number;
  discountCents: number;
  taxRateBp: number;
  laborRateById: Map<string, number>;
  isLaborSplitEnabled?: boolean;
  isReadOnly: boolean;
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
  onPatchItem: (
    itemId: string,
    patch: ItemPatch,
    options?: { persist?: boolean }
  ) => void;
  onTrackSuggestionCorrections?: (
    corrections: SuggestionCorrectionPayload[]
  ) => Promise<void>;
  onApplyBulkMajoration: (itemIds: string[], coefficient: number) => Promise<void>;
  onBulkDeleteLines: (itemIds: string[]) => Promise<void>;
  onBulkMoveLines: (
    itemIds: string[],
    targetParentId: string | null
  ) => Promise<void>;
  onBulkSetCategory: (itemIds: string[], categoryId: string | null) => Promise<void>;
  onBulkSetLaborRole: (itemIds: string[], laborRoleId: string | null) => Promise<void>;
  onInsertAssembly: (
    assemblyId: string,
    afterItemId: string | null
  ) => Promise<void>;
  onPasteRows: (input: {
    anchorRowId: string | null;
    rows: ClipboardPreviewValues[];
  }) => Promise<void>;
  onUndo: () => Promise<void>;
  onRedo: () => Promise<void>;
  canUndo: boolean;
  canRedo: boolean;
  isUndoRedoBusy: boolean;
  bulkSuggestionEligibleCount: number;
  onOpenBulkSuggestDialog: () => void;
  onReorder: (parentId: string | null, orderedIds: string[]) => void;
  onMoveItem: (
    itemId: string,
    fromParentId: string | null,
    toParentId: string | null,
    orderedSourceIds: string[],
    orderedTargetIds: string[]
  ) => void;
  scrollToItemId?: string | null;
  onScrollToItemHandled?: () => void;
  virtualization?: EstimateVirtualizationConfig;
};

const DEFAULT_UNITS = ["u", "ml", "m2", "ens"];
const EMPTY_QUALITY_FLAGS: EstimateQualityFlagKey[] = [];
const EMPTY_SECTION_DUPLICATE_TARGETS: EstimateSectionDuplicateTarget[] = [];
const SUGGESTION_SCORE_MAX = 5;

type SupplierComparisonResult = {
  item_id: string;
  best_supplier_price_id: string | null;
  selected_supplier_price_id: string | null;
  alternatives: SupplierComparisonAlternative[];
};

function toSuggestionUsageCount(rule: SuggestionRule | Record<string, unknown>) {
  const usageValue = (rule as Record<string, unknown>).usage_count;
  if (typeof usageValue === "number" && Number.isFinite(usageValue) && usageValue >= 0) {
    return Math.floor(usageValue);
  }
  if (typeof usageValue === "string") {
    const parsed = Number.parseInt(usageValue, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return 0;
}

function toSuggestionLastUsedAt(rule: SuggestionRule | Record<string, unknown>) {
  const lastUsedAt = (rule as Record<string, unknown>).last_used_at;
  return typeof lastUsedAt === "string" ? lastUsedAt : undefined;
}

function addDismissedSuggestion(
  previous: Record<string, Record<string, boolean>>,
  itemId: string,
  ruleId: string
) {
  const itemDismissed = previous[itemId];
  if (itemDismissed?.[ruleId]) return previous;
  return {
    ...previous,
    [itemId]: {
      ...(itemDismissed ?? {}),
      [ruleId]: true,
    },
  };
}

function resolveApiErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return fallback;
  }

  const record = payload as Record<string, unknown>;
  const nestedError =
    typeof record.error === "object" && record.error !== null && !Array.isArray(record.error)
      ? (record.error as Record<string, unknown>)
      : null;

  if (typeof nestedError?.message === "string" && nestedError.message.trim().length > 0) {
    return nestedError.message;
  }

  if (typeof record.message === "string" && record.message.trim().length > 0) {
    return record.message;
  }

  return fallback;
}

function toObjectRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toSupplierComparisonAlternative(
  source: unknown
): SupplierComparisonAlternative | null {
  const record = toObjectRecord(source);
  if (!record) return null;

  const supplierPriceId =
    toNonEmptyString(record.supplier_price_id) ?? toNonEmptyString(record.supplierPriceId);
  const supplierName =
    toNonEmptyString(record.supplier_name) ?? toNonEmptyString(record.supplierName);
  if (!supplierPriceId || !supplierName) return null;

  const adjustedUnitPriceCents = toFiniteNumber(
    record.adjusted_unit_price_cents,
    toFiniteNumber(record.unit_price_cents, 0)
  );
  const currency = toNonEmptyString(record.currency);
  const supplierReference =
    toNonEmptyString(record.supplier_reference) ?? toNonEmptyString(record.supplierReference);
  const updatedAt = toNonEmptyString(record.updated_at) ?? toNonEmptyString(record.updatedAt);
  const catalogueUrl =
    toNonEmptyString(record.catalogue_url) ?? toNonEmptyString(record.catalogueUrl);
  const productDesignation =
    toNonEmptyString(record.product_designation) ??
    toNonEmptyString(record.productDesignation) ??
    toNonEmptyString(record.designation) ??
    null;
  const isStale = record.is_stale === true || record.isStale === true;

  return {
    supplier_price_id: supplierPriceId,
    supplier_name: supplierName,
    adjusted_unit_price_cents: adjustedUnitPriceCents,
    currency,
    supplier_reference: supplierReference,
    updated_at: updatedAt,
    is_stale: isStale,
    catalogue_url: catalogueUrl,
    product_designation: productDesignation,
  };
}

function parseSupplierComparisonResult(payload: unknown, fallbackItemId: string) {
  const envelopeRecord = toObjectRecord(payload);
  const dataRecord = toObjectRecord(envelopeRecord?.data);
  const directComparisonRecord =
    toObjectRecord(dataRecord?.comparison) ?? toObjectRecord(envelopeRecord?.comparison);
  const comparisonsArray =
    (Array.isArray(dataRecord?.comparisons) ? dataRecord.comparisons : null) ??
    (Array.isArray(envelopeRecord?.comparisons) ? envelopeRecord.comparisons : null);
  const selectedFromArray =
    comparisonsArray
      ?.map((entry) => toObjectRecord(entry))
      .find((entry) => {
        if (!entry) return false;
        const itemId =
          toNonEmptyString(entry.item_id) ?? toNonEmptyString(entry.itemId);
        return itemId === fallbackItemId;
      }) ??
    comparisonsArray?.map((entry) => toObjectRecord(entry)).find(Boolean) ??
    null;
  const comparisonRecord =
    directComparisonRecord ?? selectedFromArray ?? dataRecord ?? envelopeRecord ?? {};
  const alternativesSource = Array.isArray(comparisonRecord.alternatives)
    ? comparisonRecord.alternatives
    : Array.isArray(dataRecord?.alternatives)
      ? dataRecord.alternatives
      : [];

  const alternatives = alternativesSource
    .map((entry) => toSupplierComparisonAlternative(entry))
    .filter((entry): entry is SupplierComparisonAlternative => entry !== null)
    .slice(0, 3);

  return {
    item_id:
      toNonEmptyString(comparisonRecord.item_id) ??
      toNonEmptyString(comparisonRecord.itemId) ??
      fallbackItemId,
    best_supplier_price_id:
      toNonEmptyString(comparisonRecord.best_supplier_price_id) ??
      toNonEmptyString(comparisonRecord.bestSupplierPriceId),
    selected_supplier_price_id:
      toNonEmptyString(comparisonRecord.selected_supplier_price_id) ??
      toNonEmptyString(comparisonRecord.selectedSupplierPriceId),
    alternatives,
  } satisfies SupplierComparisonResult;
}

async function fetchSupplierComparisons(
  versionId: string,
  itemId: string,
  signal: AbortSignal
): Promise<SupplierComparisonResult> {
  const response = await fetch(`/api/estimates/${versionId}/supplier-comparisons`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    cache: "no-store",
    signal,
    body: JSON.stringify({
      item_ids: [itemId],
    }),
  });

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(
      resolveApiErrorMessage(payload, "Impossible de charger la comparaison fournisseurs.")
    );
  }

  return parseSupplierComparisonResult(payload, itemId);
}

function toFiniteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toNonEmptyString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toSuggestionLearningBoost(rule: SuggestionRule | Record<string, unknown>) {
  const rawBoost = (rule as Record<string, unknown>).learning_boost;
  if (typeof rawBoost === "number" && Number.isFinite(rawBoost)) {
    return Math.max(rawBoost, 0);
  }
  if (typeof rawBoost === "string") {
    const parsed = Number.parseFloat(rawBoost);
    if (Number.isFinite(parsed)) {
      return Math.max(parsed, 0);
    }
  }
  return 0;
}

function toSuggestionSupplyTypeId(rule: SuggestionRule | Record<string, unknown>) {
  const supplyTypeId = (rule as Record<string, unknown>).supply_type_id;
  return toNonEmptyString(supplyTypeId);
}

function hasSuggestionLearningEnrichment(rule: SuggestionRule | Record<string, unknown>) {
  if (toSuggestionLearningBoost(rule) > 0) return true;
  return (rule as Record<string, unknown>).learning_overrides_applied === true;
}

function normalizeSuggestionCorrectionValue(
  fieldName: SuggestionCorrectionFieldName,
  value: unknown
): SuggestionCorrectionValue {
  if (fieldName === "k_fo" || fieldName === "k_mo") {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value.replace(",", "."));
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  }

  return toNonEmptyString(value);
}

function readTrackedFieldValueFromPatch(
  patch: ItemPatch,
  fieldName: SuggestionCorrectionFieldName
): SuggestionCorrectionValue | undefined {
  if (!(fieldName in patch)) return undefined;
  const rawValue = patch[fieldName];
  if (rawValue === undefined) return undefined;
  return normalizeSuggestionCorrectionValue(fieldName, rawValue);
}

function toSuggestionCorrectionTextValue(value: SuggestionCorrectionValue) {
  if (value === null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function areSuggestionCorrectionValuesEqual(
  left: SuggestionCorrectionValue,
  right: SuggestionCorrectionValue
) {
  if (typeof left === "number" || typeof right === "number") {
    return typeof left === "number" && typeof right === "number" && left === right;
  }
  return left === right;
}

function extractTrackedSuggestionValuesFromPatch(patch: ItemPatch) {
  const trackedValues: SuggestionAppliedValues = {};
  TRACKED_SUGGESTION_CORRECTION_FIELDS.forEach((fieldName) => {
    const fieldValue = readTrackedFieldValueFromPatch(patch, fieldName);
    if (fieldValue === undefined) return;
    trackedValues[fieldName] = fieldValue;
  });
  return trackedValues;
}

export type EstimateTableShortcutScope = {
  withinTable: boolean;
  hasSelectedLines: boolean;
  isPageLevelTarget: boolean;
};

export function resolveEstimateTableShortcutScope(scope: EstimateTableShortcutScope) {
  const canHandleBulkSelectionShortcut =
    scope.hasSelectedLines && (scope.withinTable || scope.isPageLevelTarget);

  return {
    canHandleAnyShortcut: scope.withinTable || canHandleBulkSelectionShortcut,
    canHandleSelectAllShortcut: scope.withinTable,
    canHandleBulkSelectionShortcut,
  };
}
type SupplierComparisonContextMenuState = {
  itemId: string;
  x: number;
  y: number;
};

type SectionContextMenuState = {
  sectionId: string;
  x: number;
  y: number;
};

export function EstimateEditorTable({
  versionId,
  items,
  categories,
  supplyTypes,
  laborRoles,
  suggestionRules,
  learningState,
  detectedOutlierFlagsByItemId,
  dismissedOutlierFlagsByItemId,
  outlierActionPendingByItemId,
  outlierDetectionMethod,
  outlierThreshold,
  qualityFlagsByItemId,
  qualityCounts,
  qualityFilter,
  actionError,
  marginMultiplier,
  discountCents,
  taxRateBp,
  laborRateById,
  isLaborSplitEnabled = false,
  isReadOnly,
  onQualityFilterChange,
  onOutlierDetectionMethodChange,
  onOutlierThresholdChange,
  onToggleOutlierDismiss,
  onAddSection,
  onAddLine,
  onDeleteItem,
  sectionDuplicateTargets = EMPTY_SECTION_DUPLICATE_TARGETS,
  onDuplicateSection,
  onDuplicateSectionToVersion,
  onPatchItem,
  onTrackSuggestionCorrections,
  onApplyBulkMajoration,
  onBulkDeleteLines,
  onBulkMoveLines,
  onBulkSetCategory,
  onBulkSetLaborRole,
  onInsertAssembly,
  onPasteRows,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  isUndoRedoBusy,
  bulkSuggestionEligibleCount,
  onOpenBulkSuggestDialog,
  onReorder,
  onMoveItem,
  scrollToItemId,
  onScrollToItemHandled,
  virtualization,
}: EstimateEditorTableProps) {
  const columnVisibility = useColumnVisibility();
  const [unitDrafts, setUnitDrafts] = useState<Record<string, string>>({});
  const [supplyTypeDrafts, setSupplyTypeDrafts] = useState<Record<string, string>>({});
  const [isAssemblyPickerOpen, setIsAssemblyPickerOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [dismissedSuggestionsByItemId, setDismissedSuggestionsByItemId] = useState<
    Record<string, Record<string, boolean>>
  >({});
  const [selectedSuggestionByItemId, setSelectedSuggestionByItemId] = useState<
    Record<string, string>
  >({});
  const [feedbackPendingByItemId, setFeedbackPendingByItemId] = useState<
    Record<string, boolean>
  >({});
  const [usageCountOverrideByRuleId, setUsageCountOverrideByRuleId] = useState<
    Record<string, number>
  >({});
  const [lastUsedAtOverrideByRuleId, setLastUsedAtOverrideByRuleId] = useState<
    Record<string, string>
  >({});
  const [supplierComparisonMenu, setSupplierComparisonMenu] =
    useState<SupplierComparisonContextMenuState | null>(null);
  const [sectionContextMenu, setSectionContextMenu] =
    useState<SectionContextMenuState | null>(null);
  const [duplicateSectionDialogSectionId, setDuplicateSectionDialogSectionId] =
    useState<string | null>(null);
  const [duplicateSectionTargetVersionId, setDuplicateSectionTargetVersionId] =
    useState("");
  const [isDuplicateSectionPending, setIsDuplicateSectionPending] = useState(false);
  const [saveAsAssemblyDialogSectionId, setSaveAsAssemblyDialogSectionId] =
    useState<string | null>(null);
  const [saveAsAssemblyName, setSaveAsAssemblyName] = useState("");
  const [isSaveAsAssemblyPending, setIsSaveAsAssemblyPending] = useState(false);
  const [supplierComparisonPanelItemId, setSupplierComparisonPanelItemId] =
    useState<string | null>(null);
  const [supplierComparisonByItemId, setSupplierComparisonByItemId] = useState<
    Record<string, SupplierComparisonResult>
  >({});
  const [bestSupplierPriceIdByItemId, setBestSupplierPriceIdByItemId] = useState<
    Record<string, string | null>
  >({});
  const [isSupplierComparisonLoading, setIsSupplierComparisonLoading] = useState(false);
  const [supplierComparisonError, setSupplierComparisonError] = useState<string | null>(
    null
  );
  const tableCardRef = useRef<HTMLDivElement | null>(null);
  const insertionAnchorItemIdRef = useRef<string | null>(null);
  const supplierComparisonAbortRef = useRef<AbortController | null>(null);
  const appliedSuggestionContextByItemIdRef = useRef<
    Record<string, AppliedSuggestionContext>
  >({});

  const {
    itemsByParent,
    depthMap,
    itemById,
    bulkMoveDestinations,
    visibleLineIds,
    getSectionTotals,
    getVisibleItems,
    hasVisibleRows,
    visibleLineIdList,
    visibleItemsInOrder,
  } = useEstimateVisibility({
    items,
    qualityFilter,
    qualityFlagsByItemId,
    marginMultiplier,
    discountCents,
    taxRateBp,
    laborRateById,
    isLaborSplitEnabled,
  });
  const dynamicGridStyle = useMemo(() => {
    if (isLaborSplitEnabled) return undefined; // labor split uses its own grid, not affected by column visibility
    const cols: string[] = ["52px", "minmax(260px, 3fr)", "80px", "80px", "110px"]; // checkbox, designation, qty, unit, PR.FO
    let minWidth = 52 + 260 + 80 + 80 + 110;
    if (columnVisibility.visibleColumns.has("supply_type")) { cols.push("140px"); minWidth += 140; }
    if (columnVisibility.visibleColumns.has("k_fo")) { cols.push("70px"); minWidth += 70; }
    cols.push("80px"); minWidth += 80; // h MO (always visible)
    if (columnVisibility.visibleColumns.has("h_mo_majoration")) { cols.push("130px"); minWidth += 130; }
    if (columnVisibility.visibleColumns.has("labor_role")) { cols.push("130px"); minWidth += 130; }
    if (columnVisibility.visibleColumns.has("k_mo")) { cols.push("80px"); minWidth += 80; }
    cols.push("110px", "120px", "110px"); minWidth += 110 + 120 + 110; // P.U., Prix total, actions
    return {
      "--estimate-grid": cols.join(" "),
      "--estimate-min-width": `${minWidth}px`,
    } as React.CSSProperties;
  }, [columnVisibility.visibleColumns, isLaborSplitEnabled]);

  const canReorder = !isReadOnly && qualityFilter === "all_lines";
  const availableSectionDuplicateTargets = useMemo(
    () =>
      sectionDuplicateTargets.filter((target) => target.versionId !== versionId),
    [sectionDuplicateTargets, versionId]
  );
  const isSuggestionLearningEnabled = learningState?.enabled === true;
  const learningByRuleId = useMemo(
    () => (isSuggestionLearningEnabled ? learningState.by_rule_id : {}),
    [isSuggestionLearningEnabled, learningState]
  );

  useEffect(() => {
    const lineIds = new Set(
      items.filter((item) => item.item_type === "line").map((item) => item.id)
    );
    const current = appliedSuggestionContextByItemIdRef.current;
    let changed = false;
    const next: Record<string, AppliedSuggestionContext> = {};

    Object.entries(current).forEach(([itemId, context]) => {
      if (!lineIds.has(itemId)) {
        changed = true;
        return;
      }
      next[itemId] = context;
    });

    if (changed) {
      appliedSuggestionContextByItemIdRef.current = next;
    }
  }, [items]);

  const orderedRules = useMemo(
    () => [...suggestionRules].sort((a, b) => a.position - b.position),
    [suggestionRules]
  );

  const scoringRules = useMemo(() => {
    return orderedRules.map((rule) => {
      const enrichedRule: SuggestionRule & Record<string, unknown> = { ...rule };
      const learningBoost = learningByRuleId[rule.id];
      const usageCountOverride = usageCountOverrideByRuleId[rule.id];
      const lastUsedAtOverride = lastUsedAtOverrideByRuleId[rule.id];

      if (learningBoost) {
        enrichedRule.learning_boost = Math.max(learningBoost.learning_boost, 0);
        enrichedRule.learning_overrides_applied = true;

        const overrides = learningBoost.overrides;
        if (overrides.description !== undefined) {
          enrichedRule.unit = overrides.description;
        }
        if (overrides.category_id !== undefined) {
          enrichedRule.category_id = overrides.category_id;
        }
        if (overrides.k_fo !== undefined) {
          enrichedRule.k_fo = overrides.k_fo;
        }
        if (overrides.k_mo !== undefined) {
          enrichedRule.k_mo = overrides.k_mo;
        }
        if (overrides.labor_role_id !== undefined) {
          enrichedRule.labor_role_id = overrides.labor_role_id;
        }
        if (overrides.supply_type_id !== undefined) {
          enrichedRule.supply_type_id = overrides.supply_type_id;
        }
      }

      if (usageCountOverride !== undefined) {
        enrichedRule.usage_count = usageCountOverride;
      }
      if (lastUsedAtOverride !== undefined) {
        enrichedRule.last_used_at = lastUsedAtOverride;
      }

      return enrichedRule;
    });
  }, [
    lastUsedAtOverrideByRuleId,
    learningByRuleId,
    orderedRules,
    usageCountOverrideByRuleId,
  ]);

  const categoryById = useMemo(() => {
    const map = new Map<string, EstimateCategory>();
    categories.forEach((category) => map.set(category.id, category));
    return map;
  }, [categories]);

  const supplyTypeById = useMemo(() => {
    const map = new Map<string, SupplyType>();
    supplyTypes.forEach((supplyType) => map.set(supplyType.id, supplyType));
    return map;
  }, [supplyTypes]);

  const supplyTypeByLowerName = useMemo(() => {
    const map = new Map<string, SupplyType>();
    supplyTypes.forEach((supplyType) => {
      map.set(supplyType.name.toLowerCase(), supplyType);
    });
    return map;
  }, [supplyTypes]);

  const roleById = useMemo(() => {
    const map = new Map<string, LaborRole>();
    laborRoles.forEach((role) => map.set(role.id, role));
    return map;
  }, [laborRoles]);

  const mergedUnitDrafts = useMemo(() => {
    const next = { ...unitDrafts };
    items.forEach((item) => {
      if (item.item_type !== "line") return;
      if (next[item.id] === undefined) {
        next[item.id] = item.description ?? "";
      }
    });
    return next;
  }, [items, unitDrafts]);

  const mergedSupplyTypeDrafts = useMemo(() => {
    const next = { ...supplyTypeDrafts };
    items.forEach((item) => {
      if (item.item_type !== "line") return;
      if (next[item.id] !== undefined) return;
      next[item.id] = item.supply_type_id
        ? (supplyTypeById.get(item.supply_type_id)?.name ?? "")
        : "";
    });
    return next;
  }, [items, supplyTypeById, supplyTypeDrafts]);

  const handleUnitDraftChange = useCallback((itemId: string, value: string) => {
    setUnitDrafts((prev) => {
      if (prev[itemId] === value) return prev;
      return { ...prev, [itemId]: value };
    });
  }, []);

  const handleSupplyTypeDraftChange = useCallback((itemId: string, value: string) => {
    setSupplyTypeDrafts((prev) => {
      if (prev[itemId] === value) return prev;
      return { ...prev, [itemId]: value };
    });
  }, []);

  const patchItemWithSuggestionTracking = useCallback(
    (itemId: string, patch: ItemPatch, options?: { persist?: boolean }) => {
      onPatchItem(itemId, patch, options);

      if (options?.persist !== true) return;
      if (!isSuggestionLearningEnabled) return;
      if (!onTrackSuggestionCorrections) return;

      const appliedContext = appliedSuggestionContextByItemIdRef.current[itemId];
      if (!appliedContext) return;

      const item = itemById.get(itemId);
      if (!item || item.item_type !== "line") return;

      const corrections: SuggestionCorrectionPayload[] = [];

      TRACKED_SUGGESTION_CORRECTION_FIELDS.forEach((fieldName) => {
        if (appliedContext.trackedFieldDivergences[fieldName]) {
          return;
        }

        const correctedValue = readTrackedFieldValueFromPatch(patch, fieldName);
        if (correctedValue === undefined) return;

        const suggestedValue = appliedContext.suggestedValues[fieldName];
        if (suggestedValue === undefined) return;

        if (areSuggestionCorrectionValuesEqual(suggestedValue, correctedValue)) {
          return;
        }

        appliedContext.trackedFieldDivergences[fieldName] = true;
        corrections.push({
          rule_id: appliedContext.ruleId,
          field_name: fieldName,
          original_value: toSuggestionCorrectionTextValue(suggestedValue),
          corrected_value: toSuggestionCorrectionTextValue(correctedValue),
          item_title: item.title ?? "",
        });
      });

      if (corrections.length === 0) return;

      void onTrackSuggestionCorrections(corrections).catch((error) => {
        console.error("Impossible d'envoyer les corrections de suggestion.", error);
      });
    },
    [
      isSuggestionLearningEnabled,
      itemById,
      onPatchItem,
      onTrackSuggestionCorrections,
    ]
  );

  const handleSupplyTypeCommit = useCallback(
    (itemId: string) => {
      if (isReadOnly) return;
      const value = (mergedSupplyTypeDrafts[itemId] ?? "").trim();
      if (!value) {
        patchItemWithSuggestionTracking(
          itemId,
          { supply_type_id: null },
          { persist: true }
        );
        return;
      }

      const existing = supplyTypeByLowerName.get(value.toLowerCase());
      if (existing) {
        patchItemWithSuggestionTracking(
          itemId,
          { supply_type_id: existing.id },
          { persist: true }
        );
        return;
      }

      patchItemWithSuggestionTracking(
        itemId,
        { supply_type_id: null },
        { persist: true }
      );
    },
    [
      isReadOnly,
      mergedSupplyTypeDrafts,
      patchItemWithSuggestionTracking,
      supplyTypeByLowerName,
    ]
  );

  const handleUnitCommit = useCallback(
    (itemId: string) => {
      if (isReadOnly) return;
      const value = (mergedUnitDrafts[itemId] ?? "").trim();
      patchItemWithSuggestionTracking(
        itemId,
        { description: value || null },
        { persist: true }
      );
    },
    [isReadOnly, mergedUnitDrafts, patchItemWithSuggestionTracking]
  );

  const {
    bulkMajorationPercent,
    setBulkMajorationPercent,
    bulkMoveParentId,
    setBulkMoveParentId,
    bulkCategoryId,
    setBulkCategoryId,
    bulkLaborRoleId,
    setBulkLaborRoleId,
    selectedLineIdList,
    selectedLineCount,
    hasSelectedLines,
    allVisibleSelected,
    isLineSelected,
    selectAllVisibleLines,
    clearLineSelection,
    toggleAllVisibleLines,
    handleLineSelectionInteraction,
    handleApplyBulkMajoration,
    handleBulkDeleteSelection,
    handleApplyBulkMove,
    handleApplyBulkCategory,
    handleApplyBulkLaborRole,
  } = useEstimateSelection({
    visibleLineIdList,
    isReadOnly,
    onApplyBulkMajoration,
    onBulkDeleteLines,
    onBulkMoveLines,
    onBulkSetCategory,
    onBulkSetLaborRole,
  });

  const {
    isPastePreviewOpen,
    detectedClipboardFormatForDialog,
    pasteMappingEntries,
    pasteDialogRows,
    pasteErrors,
    handlePasteMappingChange,
    handleTogglePasteRow,
    handleConfirmPastePreview,
    closePastePreview,
    copySelectedRowsToClipboard,
  } = useEstimateClipboard({
    isReadOnly,
    tableCardRef,
    insertionAnchorItemIdRef,
    items,
    selectedLineIdList,
    hasSelectedLines,
    mergedUnitDrafts,
    supplyTypeById,
    onPasteRows,
  });

  const handleTableBodyMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!hasSelectedLines) return;
      const target = event.target as HTMLElement;
      if (target.closest(".estimate-row")) return;
      clearLineSelection();
    },
    [clearLineSelection, hasSelectedLines]
  );

  const closeSupplierComparisonContextMenu = useCallback(() => {
    setSupplierComparisonMenu(null);
  }, []);

  const closeSectionContextMenu = useCallback(() => {
    setSectionContextMenu(null);
  }, []);

  const handleOpenSectionContextMenu = useCallback(
    (sectionId: string, position: { x: number; y: number }) => {
      if (isReadOnly) return;

      const item = itemById.get(sectionId);
      if (!item || item.item_type !== "section") return;

      const menuWidth = 300;
      const menuHeight = 88;
      const x = Math.max(8, Math.min(position.x, window.innerWidth - menuWidth - 8));
      const y = Math.max(8, Math.min(position.y, window.innerHeight - menuHeight - 8));

      setSectionContextMenu({
        sectionId,
        x,
        y,
      });
    },
    [isReadOnly, itemById]
  );

  const handleDuplicateSectionInPlace = useCallback(async () => {
    if (!sectionContextMenu || !onDuplicateSection) return;

    const targetSectionId = sectionContextMenu.sectionId;
    closeSectionContextMenu();
    await onDuplicateSection(targetSectionId);
  }, [closeSectionContextMenu, onDuplicateSection, sectionContextMenu]);

  const handleOpenDuplicateSectionDialog = useCallback(() => {
    if (!sectionContextMenu) return;

    const firstTargetVersionId = availableSectionDuplicateTargets[0]?.versionId ?? "";
    setDuplicateSectionDialogSectionId(sectionContextMenu.sectionId);
    setDuplicateSectionTargetVersionId(firstTargetVersionId);
    closeSectionContextMenu();
  }, [availableSectionDuplicateTargets, closeSectionContextMenu, sectionContextMenu]);

  const closeDuplicateSectionDialog = useCallback(() => {
    if (isDuplicateSectionPending) return;

    setDuplicateSectionDialogSectionId(null);
    setDuplicateSectionTargetVersionId("");
  }, [isDuplicateSectionPending]);

  const handleConfirmDuplicateSectionToVersion = useCallback(async () => {
    if (!duplicateSectionDialogSectionId) return;
    if (!duplicateSectionTargetVersionId) return;
    if (!onDuplicateSectionToVersion) return;

    setIsDuplicateSectionPending(true);
    try {
      await onDuplicateSectionToVersion({
        sectionId: duplicateSectionDialogSectionId,
        targetVersionId: duplicateSectionTargetVersionId,
      });
      setDuplicateSectionDialogSectionId(null);
      setDuplicateSectionTargetVersionId("");
    } finally {
      setIsDuplicateSectionPending(false);
    }
  }, [
    duplicateSectionDialogSectionId,
    duplicateSectionTargetVersionId,
    onDuplicateSectionToVersion,
  ]);

  const handleOpenSaveAsAssemblyDialog = useCallback(() => {
    if (!sectionContextMenu) return;
    const section = itemById.get(sectionContextMenu.sectionId);
    setSaveAsAssemblyName(section?.title ?? "");
    setSaveAsAssemblyDialogSectionId(sectionContextMenu.sectionId);
    closeSectionContextMenu();
  }, [closeSectionContextMenu, itemById, sectionContextMenu]);

  const closeSaveAsAssemblyDialog = useCallback(() => {
    if (isSaveAsAssemblyPending) return;
    setSaveAsAssemblyDialogSectionId(null);
    setSaveAsAssemblyName("");
  }, [isSaveAsAssemblyPending]);

  const handleConfirmSaveAsAssembly = useCallback(async () => {
    if (!saveAsAssemblyDialogSectionId || !saveAsAssemblyName.trim()) return;

    // Collect all line descendants of the section
    function collectLineDescendants(parentId: string): EstimateItem[] {
      const children = itemsByParent.get(parentId) ?? [];
      const lines: EstimateItem[] = [];
      children.forEach((child) => {
        if (child.item_type === "line") {
          lines.push(child);
        } else if (child.item_type === "section") {
          lines.push(...collectLineDescendants(child.id));
        }
      });
      return lines;
    }

    const lines = collectLineDescendants(saveAsAssemblyDialogSectionId);
    if (lines.length === 0) {
      setSaveAsAssemblyDialogSectionId(null);
      setSaveAsAssemblyName("");
      return;
    }

    setIsSaveAsAssemblyPending(true);
    try {
      const assemblyItems = lines.map((line, index) => ({
        title: line.title ?? "Ligne",
        unit: line.description ?? undefined,
        k_fo: line.k_fo ?? undefined,
        k_mo: line.k_mo ?? undefined,
        labor_role_id: line.labor_role_id ?? undefined,
        default_quantity: line.quantity ?? undefined,
        position: index + 1,
      }));

      const response = await fetch("/api/estimates/assemblies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: saveAsAssemblyName.trim(),
          items: assemblyItems,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        console.error(
          "Save as assembly failed:",
          data && typeof data === "object" ? data : "Unknown error"
        );
      }

      setSaveAsAssemblyDialogSectionId(null);
      setSaveAsAssemblyName("");
    } catch (error) {
      console.error("Save as assembly error:", error);
    } finally {
      setIsSaveAsAssemblyPending(false);
    }
  }, [itemsByParent, saveAsAssemblyDialogSectionId, saveAsAssemblyName]);

  const loadSupplierComparison = useCallback(
    async (itemId: string) => {
      if (!versionId) {
        setSupplierComparisonError("Version de devis invalide.");
        return;
      }

      if (supplierComparisonAbortRef.current) {
        supplierComparisonAbortRef.current.abort();
      }

      const abortController = new AbortController();
      supplierComparisonAbortRef.current = abortController;

      setIsSupplierComparisonLoading(true);
      setSupplierComparisonError(null);

      try {
        const comparison = await fetchSupplierComparisons(
          versionId,
          itemId,
          abortController.signal
        );

        if (abortController.signal.aborted) return;

        setSupplierComparisonByItemId((prev) => ({
          ...prev,
          [itemId]: comparison,
        }));
        setBestSupplierPriceIdByItemId((prev) => ({
          ...prev,
          [itemId]: comparison.best_supplier_price_id,
        }));
      } catch (error) {
        if (abortController.signal.aborted) return;

        setSupplierComparisonError(
          error instanceof Error
            ? error.message
            : "Impossible de charger la comparaison fournisseurs."
        );
      } finally {
        if (!abortController.signal.aborted) {
          setIsSupplierComparisonLoading(false);
        }
      }
    },
    [versionId]
  );

  const openSupplierComparisonPanel = useCallback(
    (itemId: string) => {
      const item = itemById.get(itemId);
      if (!item || item.item_type !== "line") return;

      setSupplierComparisonPanelItemId(itemId);
      setSupplierComparisonError(null);
      void loadSupplierComparison(itemId);
    },
    [itemById, loadSupplierComparison]
  );

  const handleOpenSupplierComparisonContextMenu = useCallback(
    (itemId: string, position: { x: number; y: number }) => {
      const item = itemById.get(itemId);
      if (!item || item.item_type !== "line") return;

      const menuWidth = 240;
      const menuHeight = 44;
      const x = Math.max(8, Math.min(position.x, window.innerWidth - menuWidth - 8));
      const y = Math.max(8, Math.min(position.y, window.innerHeight - menuHeight - 8));

      setSupplierComparisonMenu({
        itemId,
        x,
        y,
      });
    },
    [itemById]
  );

  const handleCloseSupplierComparisonPanel = useCallback(() => {
    setSupplierComparisonPanelItemId(null);
    setSupplierComparisonError(null);
    setIsSupplierComparisonLoading(false);
    if (supplierComparisonAbortRef.current) {
      supplierComparisonAbortRef.current.abort();
      supplierComparisonAbortRef.current = null;
    }
  }, []);

  const activeSupplierComparisonItem = useMemo(() => {
    if (!supplierComparisonPanelItemId) return null;
    const item = itemById.get(supplierComparisonPanelItemId);
    return item && item.item_type === "line" ? item : null;
  }, [itemById, supplierComparisonPanelItemId]);

  const activeSupplierComparison = useMemo(() => {
    if (!supplierComparisonPanelItemId) return null;
    return supplierComparisonByItemId[supplierComparisonPanelItemId] ?? null;
  }, [supplierComparisonByItemId, supplierComparisonPanelItemId]);

  const handleSelectSupplierComparisonAlternative = useCallback(
    (alternative: SupplierComparisonAlternative) => {
      if (isReadOnly || !activeSupplierComparisonItem) return;

      const selectedDescription = (alternative.product_designation ?? "").trim();
      const patch: ItemPatch = {
        description: selectedDescription.length > 0 ? selectedDescription : null,
        unit_price_ht_cents: alternative.adjusted_unit_price_cents,
        selected_supplier_price_id: alternative.supplier_price_id,
      };

      patchItemWithSuggestionTracking(
        activeSupplierComparisonItem.id,
        patch,
        { persist: true }
      );
      setSupplierComparisonPanelItemId(null);
    },
    [activeSupplierComparisonItem, isReadOnly, patchItemWithSuggestionTracking]
  );

  useEffect(() => {
    return () => {
      if (supplierComparisonAbortRef.current) {
        supplierComparisonAbortRef.current.abort();
      }
    };
  }, []);

  useEffect(() => {
    if (!supplierComparisonMenu) return;

    const closeMenu = () => setSupplierComparisonMenu(null);
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest(".estimate-supplier-comparison-context-menu")
      ) {
        return;
      }
      closeMenu();
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeMenu();
    };

    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [supplierComparisonMenu]);

  useEffect(() => {
    if (!sectionContextMenu) return;

    const closeMenu = () => setSectionContextMenu(null);
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest(".estimate-section-context-menu")
      ) {
        return;
      }
      closeMenu();
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeMenu();
    };

    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [sectionContextMenu]);

  useEffect(() => {
    if (!supplierComparisonPanelItemId) return;
    const item = itemById.get(supplierComparisonPanelItemId);
    if (!item || item.item_type !== "line") {
      setSupplierComparisonPanelItemId(null);
    }
  }, [itemById, supplierComparisonPanelItemId]);

  useEffect(() => {
    if (!sectionContextMenu) return;
    const item = itemById.get(sectionContextMenu.sectionId);
    if (!item || item.item_type !== "section") {
      setSectionContextMenu(null);
    }
  }, [itemById, sectionContextMenu]);

  useEffect(() => {
    if (!duplicateSectionDialogSectionId) return;
    const item = itemById.get(duplicateSectionDialogSectionId);
    if (!item || item.item_type !== "section") {
      setDuplicateSectionDialogSectionId(null);
      setDuplicateSectionTargetVersionId("");
    }
  }, [duplicateSectionDialogSectionId, itemById]);

  useEstimateKeyboardShortcuts({
    tableCardRef,
    hasSelectedLines,
    visibleLineIdList,
    isReadOnly,
    isUndoRedoBusy,
    canUndo,
    canRedo,
    isSupplierComparisonMenuOpen:
      supplierComparisonMenu !== null ||
      sectionContextMenu !== null ||
      duplicateSectionDialogSectionId !== null ||
      saveAsAssemblyDialogSectionId !== null,
    onResolveShortcutScope: resolveEstimateTableShortcutScope,
    selectAllVisibleLines,
    clearLineSelection,
    onBulkDeleteSelection: handleBulkDeleteSelection,
    onCopySelectedRowsToClipboard: copySelectedRowsToClipboard,
    onUndo,
    onRedo,
    onOpenAssemblyPicker: () => setIsAssemblyPickerOpen(true),
  });

  const sendSuggestionFeedback = useCallback(
    async (
      item: EstimateItem,
      suggestion: SuggestionPreview,
      feedback: "accept" | "reject"
    ) => {
      if (item.item_type !== "line") return;

      setFeedbackPendingByItemId((prev) => ({ ...prev, [item.id]: true }));

      const optimisticUsageCount =
        feedback === "accept" ? suggestion.usageCount + 1 : suggestion.usageCount;
      const optimisticLastUsedAt =
        feedback === "accept" ? new Date().toISOString() : null;

      if (feedback === "accept") {
        setUsageCountOverrideByRuleId((prev) => ({
          ...prev,
          [suggestion.rule.id]: optimisticUsageCount,
        }));
        if (optimisticLastUsedAt) {
          setLastUsedAtOverrideByRuleId((prev) => ({
            ...prev,
            [suggestion.rule.id]: optimisticLastUsedAt,
          }));
        }
      }

      try {
        const updatedRule = await sendEstimateSuggestionRuleFeedback(
          item.version_id,
          suggestion.rule.id,
          feedback
        );

        if (!updatedRule || feedback !== "accept") {
          return;
        }

        setUsageCountOverrideByRuleId((prev) => ({
          ...prev,
          [suggestion.rule.id]: toSuggestionUsageCount(updatedRule),
        }));

        const lastUsedAt = toSuggestionLastUsedAt(updatedRule);
        if (lastUsedAt) {
          setLastUsedAtOverrideByRuleId((prev) => ({
            ...prev,
            [suggestion.rule.id]: lastUsedAt,
          }));
        }
      } catch (error) {
        console.error("Impossible d'enregistrer le feedback de suggestion.", error);

        if (feedback === "accept") {
          setUsageCountOverrideByRuleId((prev) => ({
            ...prev,
            [suggestion.rule.id]: suggestion.usageCount,
          }));
          const previousLastUsedAt = toSuggestionLastUsedAt(suggestion.rule);
          setLastUsedAtOverrideByRuleId((prev) => {
            const next = { ...prev };
            if (previousLastUsedAt) {
              next[suggestion.rule.id] = previousLastUsedAt;
            } else {
              delete next[suggestion.rule.id];
            }
            return next;
          });
        }
      } finally {
        setFeedbackPendingByItemId((prev) => {
          if (!prev[item.id]) return prev;
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
      }
    },
    []
  );

  const applySuggestion = useCallback(
    (item: EstimateItem, suggestion: SuggestionPreview) => {
      if (isReadOnly || item.item_type !== "line") return;

      const patch: ItemPatch = {};
      const unitValue = suggestion.rule.unit?.trim();
      if (unitValue) {
        patch.description = unitValue;
        setUnitDrafts((prev) => ({ ...prev, [item.id]: unitValue }));
      }
      const explicitSupplyTypeId = toSuggestionSupplyTypeId(suggestion.rule);
      if (explicitSupplyTypeId) {
        patch.supply_type_id = explicitSupplyTypeId;
        setSupplyTypeDrafts((prev) => ({
          ...prev,
          [item.id]: supplyTypeById.get(explicitSupplyTypeId)?.name ?? "",
        }));
      }
      if (suggestion.rule.category_id) {
        patch.category_id = suggestion.rule.category_id;
        const category = categoryById.get(suggestion.rule.category_id);
        if (category) {
          if (!explicitSupplyTypeId) {
            const matchedSupplyType = supplyTypeByLowerName.get(
              category.name.toLowerCase()
            );
            if (matchedSupplyType) {
              patch.supply_type_id = matchedSupplyType.id;
            }
          }
          setSupplyTypeDrafts((prev) => ({
            ...prev,
            [item.id]:
              explicitSupplyTypeId
                ? (supplyTypeById.get(explicitSupplyTypeId)?.name ?? category.name)
                : category.name,
          }));
        }
      }
      if (suggestion.rule.k_fo !== null) patch.k_fo = suggestion.rule.k_fo;
      if (suggestion.rule.k_mo !== null) patch.k_mo = suggestion.rule.k_mo;
      if (suggestion.rule.labor_role_id) {
        patch.labor_role_id = suggestion.rule.labor_role_id;
      }

      if (Object.keys(patch).length === 0) return;

      const trackedSuggestionValues = extractTrackedSuggestionValuesFromPatch(patch);
      appliedSuggestionContextByItemIdRef.current[item.id] = {
        ruleId: suggestion.rule.id,
        suggestedValues: trackedSuggestionValues,
        trackedFieldDivergences: {},
      };

      patchItemWithSuggestionTracking(item.id, patch, { persist: true });
      setDismissedSuggestionsByItemId((prev) =>
        addDismissedSuggestion(prev, item.id, suggestion.rule.id)
      );
      void sendSuggestionFeedback(item, suggestion, "accept");
    },
    [
      categoryById,
      isReadOnly,
      patchItemWithSuggestionTracking,
      sendSuggestionFeedback,
      supplyTypeById,
      supplyTypeByLowerName,
    ]
  );

  const dismissSuggestion = useCallback(
    (item: EstimateItem, suggestion: SuggestionPreview) => {
      if (item.item_type !== "line") return;
      setDismissedSuggestionsByItemId((prev) =>
        addDismissedSuggestion(prev, item.id, suggestion.rule.id)
      );
      void sendSuggestionFeedback(item, suggestion, "reject");
    },
    [sendSuggestionFeedback]
  );

  const buildSuggestionParts = useCallback(
    (rule: SuggestionRule) => {
      const parts: string[] = [];
      if (rule.category_id) {
        const category = categoryById.get(rule.category_id);
        parts.push(`Type FO: ${category?.name ?? "Catégorie inconnue"}`);
      }
      const supplyTypeId = toSuggestionSupplyTypeId(rule);
      if (supplyTypeId) {
        const supplyType = supplyTypeById.get(supplyTypeId);
        parts.push(`Materiau: ${supplyType?.name ?? "Type inconnu"}`);
      }
      if (rule.unit) parts.push(`Unite: ${rule.unit}`);
      if (rule.k_fo !== null) parts.push(`K FO: ${rule.k_fo}`);
      if (rule.k_mo !== null) parts.push(`K MO: ${rule.k_mo}`);
      if (rule.labor_role_id) {
        const role = roleById.get(rule.labor_role_id);
        parts.push(`Role MO: ${role?.name ?? "Role inconnu"}`);
      }
      return parts;
    },
    [categoryById, roleById, supplyTypeById]
  );

  const suggestionsByItemId = useMemo(() => {
    const map = new Map<string, SuggestionPreview[]>();
    if (isReadOnly) return map;

    items.forEach((item) => {
      if (item.item_type !== "line") return;
      if (!visibleLineIds.has(item.id)) return;

      const dismissedRuleIds = dismissedSuggestionsByItemId[item.id] ?? {};
      const rankedSuggestions = rankSuggestions({
        title: item.title,
        rules: scoringRules,
        limit: SUGGESTION_SCORE_MAX,
      });

      const visibleSuggestions = rankedSuggestions
        .filter((suggestion) => !dismissedRuleIds[suggestion.rule.id])
        .map((suggestion) => {
          const rule = suggestion.rule as SuggestionRule & Record<string, unknown>;
          const learningBoost = toSuggestionLearningBoost(rule);
          const parts = buildSuggestionParts(rule);
          return {
            rule,
            score: suggestion.score,
            matchKind: suggestion.matchKind,
            matchedKeyword: suggestion.matchedKeyword,
            usageCount: suggestion.usageCount,
            learningBoost,
            isLearned: hasSuggestionLearningEnrichment(rule),
            parts,
          } satisfies SuggestionPreview;
        })
        .filter((suggestion) => suggestion.parts.length > 0);

      if (visibleSuggestions.length > 0) {
        map.set(item.id, visibleSuggestions);
      }
    });

    return map;
  }, [
    buildSuggestionParts,
    dismissedSuggestionsByItemId,
    isReadOnly,
    items,
    scoringRules,
    visibleLineIds,
  ]);

  const renderSuggestionRow = useCallback(
    (item: EstimateItem, suggestions: SuggestionPreview[]) => {
      const isFeedbackPending = feedbackPendingByItemId[item.id] ?? false;
      return (
        <EstimateSuggestionRow
          item={item}
          suggestions={suggestions}
          selectedSuggestionRuleId={selectedSuggestionByItemId[item.id]}
          isReadOnly={isReadOnly}
          isFeedbackPending={isFeedbackPending}
          onSelectSuggestionRule={(itemId, ruleId) =>
            setSelectedSuggestionByItemId((prev) => ({
              ...prev,
              [itemId]: ruleId,
            }))
          }
          onApplySuggestion={applySuggestion}
          onDismissSuggestion={dismissSuggestion}
        />
      );
    },
    [
      applySuggestion,
      dismissSuggestion,
      feedbackPendingByItemId,
      isReadOnly,
      selectedSuggestionByItemId,
    ]
  );

  const {
    sensors,
    handleDragEnd,
    flattenedRows,
    virtualScrollRef,
    virtualItems,
    virtualTotalSize,
    measureElement,
    isVirtualized,
    virtualizedSortableIds,
    virtualBodyStyle,
    handleNavigationCellNotMounted,
  } = useEstimateDndVirtualization({
    canReorder,
    itemsByParent,
    onReorder,
    onMoveItem,
    hasVisibleRows,
    getVisibleItems,
    depthMap,
    mergedUnitDrafts,
    mergedSupplyTypeDrafts,
    qualityFlagsByItemId,
    suggestionsByItemId,
    virtualization,
    tableCardRef,
    scrollToItemId,
    onScrollToItemHandled,
  });

  const hiddenSpreadsheetColumnKeys = useMemo(() => {
    if (isLaborSplitEnabled) return new Set<string>(); // labor split not affected
    const hidden = new Set<string>();
    const columnKeyToSpreadsheetKey: Record<ColumnKey, string> = {
      supply_type: "supply_type",
      k_fo: "k_fo",
      h_mo_majoration: "h_mo_majoration",
      labor_role: "labor_role",
      k_mo: "k_mo",
    };
    for (const [colKey, ssKey] of Object.entries(columnKeyToSpreadsheetKey)) {
      if (!columnVisibility.visibleColumns.has(colKey as ColumnKey)) {
        hidden.add(ssKey);
      }
    }
    return hidden;
  }, [columnVisibility.visibleColumns, isLaborSplitEnabled]);

  const spreadsheetNavigationRows = useMemo(() => {
    if (!hasVisibleRows) return [] as SpreadsheetNavigationRow[];

    return visibleItemsInOrder.map((item) => {
      const allKeys = getSpreadsheetColumnKeys(item.item_type, isLaborSplitEnabled);
      if (hiddenSpreadsheetColumnKeys.size === 0) {
        return { rowId: item.id, columnKeys: allKeys };
      }
      return {
        rowId: item.id,
        columnKeys: allKeys.filter((key) => !hiddenSpreadsheetColumnKeys.has(key)),
      };
    });
  }, [hasVisibleRows, hiddenSpreadsheetColumnKeys, isLaborSplitEnabled, visibleItemsInOrder]);

  const spreadsheetNavigation = useSpreadsheetNavigation({
    rows: spreadsheetNavigationRows,
    disabled: !hasVisibleRows || isReadOnly,
    onActiveCellNotMounted: isVirtualized
      ? handleNavigationCellNotMounted
      : undefined,
  });
  const insertionAnchorItemId = spreadsheetNavigation.activeCell?.rowId ?? null;

  useEffect(() => {
    insertionAnchorItemIdRef.current = insertionAnchorItemId;
  }, [insertionAnchorItemId]);

  const renderSortableRow = useCallback(
    (
      item: EstimateItem,
      depth: number,
      unitValue: string,
      supplyTypeValue: string,
      qualityFlags: EstimateQualityFlagKey[],
      sectionTotals: SectionTotals | null
    ) => {
      const bestSupplierPriceId = bestSupplierPriceIdByItemId[item.id] ?? null;
      const hasSupplierComparisonMismatch =
        bestSupplierPriceId !== null &&
        (item.selected_supplier_price_id ?? null) !== bestSupplierPriceId;

      return (
        <EstimateEditorRow
          versionId={versionId}
          item={item}
          depth={depth}
          unitValue={unitValue}
          supplyTypeValue={supplyTypeValue}
          qualityFlags={qualityFlags}
          detectedOutlierFlags={detectedOutlierFlagsByItemId[item.id] ?? []}
          dismissedOutlierFlags={dismissedOutlierFlagsByItemId[item.id] ?? []}
          supplyTypeById={supplyTypeById}
          laborRoles={laborRoles}
          navigation={spreadsheetNavigation}
          isLineSelected={item.item_type === "line" && isLineSelected(item.id)}
          hasSupplierComparisonMismatch={hasSupplierComparisonMismatch}
          onAddSection={onAddSection}
          onAddLine={onAddLine}
          onDeleteItem={onDeleteItem}
          onOpenSupplierComparisonPanel={openSupplierComparisonPanel}
          onOpenSupplierComparisonContextMenu={
            handleOpenSupplierComparisonContextMenu
          }
          onOpenSectionContextMenu={handleOpenSectionContextMenu}
          onPatchItem={patchItemWithSuggestionTracking}
          onUnitChange={handleUnitDraftChange}
          onUnitCommit={handleUnitCommit}
          onSupplyTypeChange={handleSupplyTypeDraftChange}
          onSupplyTypeCommit={handleSupplyTypeCommit}
          onToggleOutlierDismiss={onToggleOutlierDismiss}
          onLineSelectionInteraction={handleLineSelectionInteraction}
          sectionTotals={sectionTotals}
          isDragDisabled={!canReorder}
          isOutlierActionPending={Boolean(outlierActionPendingByItemId[item.id])}
          isReadOnly={isReadOnly}
          isLaborSplitEnabled={isLaborSplitEnabled}
          visibleColumns={isLaborSplitEnabled ? undefined : columnVisibility.visibleColumns}
          isSearchMatch={
            searchTerm.length > 0 &&
            item.item_type === "line" &&
            Boolean(item.title?.toLowerCase().includes(searchTerm.toLowerCase()))
          }
        />
      );
    },
    [
      bestSupplierPriceIdByItemId,
      canReorder,
      columnVisibility.visibleColumns,
      detectedOutlierFlagsByItemId,
      dismissedOutlierFlagsByItemId,
      handleOpenSectionContextMenu,
      handleOpenSupplierComparisonContextMenu,
      handleSupplyTypeCommit,
      handleSupplyTypeDraftChange,
      handleLineSelectionInteraction,
      handleUnitCommit,
      handleUnitDraftChange,
      isLaborSplitEnabled,
      isLineSelected,
      isReadOnly,
      laborRoles,
      openSupplierComparisonPanel,
      onAddLine,
      onAddSection,
      onDeleteItem,
      patchItemWithSuggestionTracking,
      onToggleOutlierDismiss,
      outlierActionPendingByItemId,
      searchTerm,
      spreadsheetNavigation,
      supplyTypeById,
      versionId,
    ]
  );

  const renderVirtualRow = useCallback(
    (row: VirtualizedRow) => {
      if (row.kind === "suggestion") {
        return renderSuggestionRow(row.item, row.suggestions);
      }
      return renderSortableRow(
        row.item,
        row.depth,
        row.unitValue,
        row.supplyTypeValue,
        row.qualityFlags,
        row.item.item_type === "section" ? getSectionTotals(row.item.id) : null
      );
    },
    [getSectionTotals, renderSortableRow, renderSuggestionRow]
  );

  function renderList(parentId: string | null) {
    const list = getVisibleItems(parentId);
    if (list.length === 0) return null;

    return (
      <div className="estimate-group">
        <SortableContext
          items={list.map((item) => item.id)}
          strategy={verticalListSortingStrategy}
        >
          {list.map((item) => {
            const suggestions = suggestionsByItemId.get(item.id);
            return (
              <Fragment key={item.id}>
                {renderSortableRow(
                  item,
                  depthMap.get(item.id) ?? 0,
                  mergedUnitDrafts[item.id] ?? "",
                  mergedSupplyTypeDrafts[item.id] ?? "",
                  qualityFlagsByItemId[item.id] ?? EMPTY_QUALITY_FLAGS,
                  item.item_type === "section"
                    ? getSectionTotals(item.id)
                    : null
                )}
                {suggestions ? renderSuggestionRow(item, suggestions) : null}
                {item.item_type === "section" ? renderList(item.id) : null}
              </Fragment>
            );
          })}
        </SortableContext>
      </div>
    );
  }

  const estimateEditorContextValue = useMemo(
    () => ({
      state: {
        visibleLineIdList,
        selectedLineIdList,
        selectedLineCount,
        hasSelectedLines,
        allVisibleSelected,
        bulkMajorationPercent,
        bulkMoveParentId,
        bulkCategoryId,
        bulkLaborRoleId,
      },
      actions: {
        setBulkMajorationPercent,
        setBulkMoveParentId,
        setBulkCategoryId,
        setBulkLaborRoleId,
        toggleAllVisibleLines,
        clearLineSelection,
      },
      meta: {
        hasVisibleRows,
        isReadOnly,
      },
    }),
    [
      allVisibleSelected,
      bulkCategoryId,
      bulkLaborRoleId,
      bulkMajorationPercent,
      bulkMoveParentId,
      clearLineSelection,
      hasSelectedLines,
      hasVisibleRows,
      isReadOnly,
      selectedLineCount,
      selectedLineIdList,
      setBulkCategoryId,
      setBulkLaborRoleId,
      setBulkMajorationPercent,
      setBulkMoveParentId,
      toggleAllVisibleLines,
      visibleLineIdList,
    ]
  );

  const grandTotals = useMemo(() => {
    const rootItems = itemsByParent.get("root") ?? [];
    let foTotal = 0;
    let moTotal = 0;
    let htTotal = 0;
    rootItems.forEach((item) => {
      if (item.item_type !== "section") return;
      const totals = getSectionTotals(item.id);
      if (!totals) return;
      foTotal += totals.foTotalCents;
      moTotal += totals.moTotalCents;
      htTotal += totals.totalHtCents;
    });
    return { foTotal, moTotal, htTotal };
  }, [itemsByParent, getSectionTotals]);

  return (
    <EstimateEditorProvider value={estimateEditorContextValue}>
      <div ref={tableCardRef} className="dashboard-card p-6">
        <EstimateEditorToolbar
          qualityCounts={qualityCounts}
          qualityFilter={qualityFilter}
          outlierDetectionMethod={outlierDetectionMethod}
          outlierThreshold={outlierThreshold}
          isUndoRedoBusy={isUndoRedoBusy}
          canUndo={canUndo}
          canRedo={canRedo}
          bulkMoveDestinations={bulkMoveDestinations}
          categories={categories}
          laborRoles={laborRoles}
          bulkSuggestionEligibleCount={bulkSuggestionEligibleCount}
          onQualityFilterChange={onQualityFilterChange}
          onOutlierDetectionMethodChange={onOutlierDetectionMethodChange}
          onOutlierThresholdChange={onOutlierThresholdChange}
          onUndo={onUndo}
          onRedo={onRedo}
          onApplyBulkMajoration={handleApplyBulkMajoration}
          onBulkDeleteSelection={handleBulkDeleteSelection}
          onApplyBulkMove={handleApplyBulkMove}
          onApplyBulkCategory={handleApplyBulkCategory}
          onApplyBulkLaborRole={handleApplyBulkLaborRole}
          onOpenBulkSuggestDialog={onOpenBulkSuggestDialog}
          onOpenAssemblyPicker={() => setIsAssemblyPickerOpen(true)}
          onAddRootSection={() => onAddSection(null)}
          columnPreset={columnVisibility.preset}
          columnPresetLabels={columnVisibility.presetLabels}
          onColumnPresetChange={columnVisibility.setPreset}
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          columnVisibleColumns={columnVisibility.visibleColumns}
          allAdvancedColumns={columnVisibility.allAdvancedColumns}
          columnLabels={columnVisibility.columnLabels}
          onToggleColumn={columnVisibility.toggleColumn}
        />

      {actionError && (
        <div className="alert alert-error mt-4">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="m15 9-6 6" />
            <path d="m9 9 6 6" />
          </svg>
          {actionError}
        </div>
      )}

      <div className="estimate-table-scroll mt-6 overflow-x-auto">
      <div
        className={`estimate-table${isLaborSplitEnabled ? " estimate-table--labor-split" : ""}`}
        style={dynamicGridStyle}
      >
        <div className="estimate-table__head">
          <div>
            <input
              type="checkbox"
              className="estimate-line-checkbox"
              checked={allVisibleSelected}
              onChange={(event) => toggleAllVisibleLines(event.target.checked)}
              disabled={isReadOnly || visibleLineIdList.length === 0}
              aria-label="Sélectionner toutes les lignes visibles"
            />
          </div>
          <div className="relative"><ColumnHeaderHelp label="Désignation" tooltip={COLUMN_HEADER_TOOLTIPS["Désignation"]} /></div>
          <div className="relative"><ColumnHeaderHelp label="Qté" tooltip={COLUMN_HEADER_TOOLTIPS["Qté"]} /></div>
          <div className="relative"><ColumnHeaderHelp label="U" tooltip={COLUMN_HEADER_TOOLTIPS["U"]} /></div>
          <div className="relative"><ColumnHeaderHelp label="PR. FO" tooltip={COLUMN_HEADER_TOOLTIPS["PR. FO"]} /></div>
          {isLaborSplitEnabled ? (
            <>
              <div className="relative"><ColumnHeaderHelp label="Type FO" tooltip={COLUMN_HEADER_TOOLTIPS["Type FO"]} /></div>
              <div className="relative"><ColumnHeaderHelp label="K FO" tooltip={COLUMN_HEADER_TOOLTIPS["K FO"]} /></div>
              <div className="relative"><ColumnHeaderHelp label="Majoration MO (%)" tooltip={COLUMN_HEADER_TOOLTIPS["Majoration MO (%)"]} /></div>
              <div className="relative"><ColumnHeaderHelp label="h MO atelier" tooltip={COLUMN_HEADER_TOOLTIPS["h MO atelier"]} /></div>
              <div className="relative"><ColumnHeaderHelp label="Type MO atelier" tooltip={COLUMN_HEADER_TOOLTIPS["Type MO atelier"]} /></div>
              <div className="relative"><ColumnHeaderHelp label="K MO atelier" tooltip={COLUMN_HEADER_TOOLTIPS["K MO atelier"]} /></div>
              <div className="relative"><ColumnHeaderHelp label="h MO chantier" tooltip={COLUMN_HEADER_TOOLTIPS["h MO chantier"]} /></div>
              <div className="relative"><ColumnHeaderHelp label="Type MO chantier" tooltip={COLUMN_HEADER_TOOLTIPS["Type MO chantier"]} /></div>
              <div className="relative"><ColumnHeaderHelp label="K MO chantier" tooltip={COLUMN_HEADER_TOOLTIPS["K MO chantier"]} /></div>
            </>
          ) : (
            <>
              {columnVisibility.visibleColumns.has("supply_type") ? (
                <div className="relative"><ColumnHeaderHelp label="Type FO" tooltip={COLUMN_HEADER_TOOLTIPS["Type FO"]} /></div>
              ) : null}
              {columnVisibility.visibleColumns.has("k_fo") ? (
                <div className="relative"><ColumnHeaderHelp label="K FO" tooltip={COLUMN_HEADER_TOOLTIPS["K FO"]} /></div>
              ) : null}
              <div className="relative"><ColumnHeaderHelp label="h MO" tooltip={COLUMN_HEADER_TOOLTIPS["h MO"]} /></div>
              {columnVisibility.visibleColumns.has("h_mo_majoration") ? (
                <div className="relative"><ColumnHeaderHelp label="Majoration MO (%)" tooltip={COLUMN_HEADER_TOOLTIPS["Majoration MO (%)"]} /></div>
              ) : null}
              {columnVisibility.visibleColumns.has("labor_role") ? (
                <div className="relative"><ColumnHeaderHelp label="Type MO" tooltip={COLUMN_HEADER_TOOLTIPS["Type MO"]} /></div>
              ) : null}
              {columnVisibility.visibleColumns.has("k_mo") ? (
                <div className="relative"><ColumnHeaderHelp label="K MO" tooltip={COLUMN_HEADER_TOOLTIPS["K MO"]} /></div>
              ) : null}
            </>
          )}
          <div className="relative"><ColumnHeaderHelp label="P.U." tooltip={COLUMN_HEADER_TOOLTIPS["P.U."]} /></div>
          <div className="relative"><ColumnHeaderHelp label="Prix total" tooltip={COLUMN_HEADER_TOOLTIPS["Prix total"]} /></div>
          <div></div>
        </div>
        <EstimateEditorBody
          items={items}
          hasVisibleRows={hasVisibleRows}
          isReadOnly={isReadOnly}
          onAddRootSection={() => onAddSection(null)}
          onResetQualityFilter={() => onQualityFilterChange("all_lines")}
          sensors={sensors}
          onDragEnd={handleDragEnd}
          isVirtualized={isVirtualized}
          virtualizedSortableIds={virtualizedSortableIds}
          virtualTotalSize={virtualTotalSize}
          virtualItems={virtualItems}
          flattenedRows={flattenedRows}
          measureElement={measureElement}
          virtualScrollRef={virtualScrollRef}
          virtualBodyStyle={virtualBodyStyle}
          onBodyMouseDown={handleTableBodyMouseDown}
          spreadsheetRowCount={spreadsheetNavigationRows.length}
          renderVirtualRow={renderVirtualRow}
          renderList={() => renderList(null)}
        />
        {hasVisibleRows ? (
          <div className="estimate-table__footer">
            <div></div>
            <div className="font-semibold text-[var(--slate-800)]">Total</div>
            <div></div>
            <div></div>
            <div className="text-right font-medium text-[var(--slate-700)]" title="Total Fournitures">
              {formatEUR(grandTotals.foTotal)}
            </div>
            {isLaborSplitEnabled ? (
              <>
                <div></div><div></div><div></div>
                <div></div><div></div><div></div>
                <div></div><div></div><div></div>
              </>
            ) : (
              <>
                {columnVisibility.visibleColumns.has("supply_type") ? <div></div> : null}
                {columnVisibility.visibleColumns.has("k_fo") ? <div></div> : null}
                <div className="text-right font-medium text-[var(--slate-700)]" title="Total Main d'œuvre">
                  {formatEUR(grandTotals.moTotal)}
                </div>
                {columnVisibility.visibleColumns.has("h_mo_majoration") ? <div></div> : null}
                {columnVisibility.visibleColumns.has("labor_role") ? <div></div> : null}
                {columnVisibility.visibleColumns.has("k_mo") ? <div></div> : null}
              </>
            )}
            <div></div>
            <div className="text-right font-semibold text-[var(--slate-900)]" title="Total HT">
              {formatEUR(grandTotals.htTotal)}
            </div>
            <div></div>
          </div>
        ) : null}
      </div>
      </div>

      {sectionContextMenu ? (
        <div
          className="estimate-supplier-comparison-context-menu estimate-section-context-menu"
          role="menu"
          aria-label="Actions de section"
          style={{
            left: `${sectionContextMenu.x}px`,
            top: `${sectionContextMenu.y}px`,
          }}
        >
          <button
            type="button"
            className="estimate-supplier-comparison-context-menu__action"
            role="menuitem"
            onClick={() => void handleDuplicateSectionInPlace()}
            disabled={!onDuplicateSection}
          >
            Dupliquer la section
          </button>
          <button
            type="button"
            className="estimate-supplier-comparison-context-menu__action"
            role="menuitem"
            onClick={handleOpenDuplicateSectionDialog}
            disabled={
              !onDuplicateSectionToVersion ||
              availableSectionDuplicateTargets.length === 0
            }
          >
            Dupliquer vers un autre devis
          </button>
          <button
            type="button"
            className="estimate-supplier-comparison-context-menu__action"
            role="menuitem"
            onClick={handleOpenSaveAsAssemblyDialog}
          >
            Enregistrer comme assemblage
          </button>
        </div>
      ) : null}

      {duplicateSectionDialogSectionId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(2,6,23,0.45)] p-4">
          <div
            className="dashboard-card w-full max-w-xl p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="duplicate-section-dialog-title"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2
                  id="duplicate-section-dialog-title"
                  className="text-lg font-semibold text-[var(--slate-800)]"
                >
                  Dupliquer vers un autre devis
                </h2>
                <p className="mt-1 text-sm text-[var(--slate-500)]">
                  Choisissez une version en brouillon.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={closeDuplicateSectionDialog}
                disabled={isDuplicateSectionPending}
              >
                Fermer
              </button>
            </div>

            {availableSectionDuplicateTargets.length === 0 ? (
              <div className="alert alert-info">
                Aucun devis brouillon disponible en cible.
              </div>
            ) : (
              <label className="form-label block">
                Devis cible
                <select
                  className="input mt-2 w-full"
                  value={duplicateSectionTargetVersionId}
                  onChange={(event) =>
                    setDuplicateSectionTargetVersionId(event.target.value)
                  }
                  disabled={isDuplicateSectionPending}
                >
                  {availableSectionDuplicateTargets.map((target) => (
                    <option key={target.versionId} value={target.versionId}>
                      {target.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={closeDuplicateSectionDialog}
                disabled={isDuplicateSectionPending}
              >
                Annuler
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleConfirmDuplicateSectionToVersion()}
                disabled={
                  isDuplicateSectionPending ||
                  !duplicateSectionTargetVersionId ||
                  availableSectionDuplicateTargets.length === 0
                }
              >
                {isDuplicateSectionPending ? "Duplication..." : "Dupliquer"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {saveAsAssemblyDialogSectionId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(2,6,23,0.45)] p-4">
          <div
            className="dashboard-card w-full max-w-xl p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-as-assembly-dialog-title"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2
                  id="save-as-assembly-dialog-title"
                  className="text-lg font-semibold text-[var(--slate-800)]"
                >
                  Enregistrer comme assemblage
                </h2>
                <p className="mt-1 text-sm text-[var(--slate-500)]">
                  Les lignes de cette section seront enregistrées comme assemblage réutilisable.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={closeSaveAsAssemblyDialog}
                disabled={isSaveAsAssemblyPending}
              >
                Fermer
              </button>
            </div>

            <label className="form-label block">
              Nom de l&apos;assemblage
              <input
                className="input mt-2 w-full"
                type="text"
                value={saveAsAssemblyName}
                onChange={(event) => setSaveAsAssemblyName(event.target.value)}
                disabled={isSaveAsAssemblyPending}
                autoFocus
              />
            </label>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={closeSaveAsAssemblyDialog}
                disabled={isSaveAsAssemblyPending}
              >
                Annuler
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleConfirmSaveAsAssembly()}
                disabled={isSaveAsAssemblyPending || !saveAsAssemblyName.trim()}
              >
                {isSaveAsAssemblyPending ? "Enregistrement..." : "Enregistrer"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {supplierComparisonMenu ? (
        <div
          className="estimate-supplier-comparison-context-menu"
          role="menu"
          aria-label="Actions de comparaison fournisseurs"
          style={{
            left: `${supplierComparisonMenu.x}px`,
            top: `${supplierComparisonMenu.y}px`,
          }}
        >
          <button
            type="button"
            className="estimate-supplier-comparison-context-menu__action"
            role="menuitem"
            onClick={() => {
              openSupplierComparisonPanel(supplierComparisonMenu.itemId);
              closeSupplierComparisonContextMenu();
            }}
          >
            Comparer fournisseurs
          </button>
        </div>
      ) : null}

      <SupplierComparisonPanel
        isOpen={Boolean(activeSupplierComparisonItem)}
        itemTitle={activeSupplierComparisonItem?.title ?? ""}
        alternatives={activeSupplierComparison?.alternatives ?? []}
        bestSupplierPriceId={
          activeSupplierComparison?.best_supplier_price_id ?? null
        }
        isLoading={isSupplierComparisonLoading}
        error={supplierComparisonError}
        isReadOnly={isReadOnly}
        onClose={handleCloseSupplierComparisonPanel}
        onSelectAlternative={handleSelectSupplierComparisonAlternative}
      />

      <datalist id="estimate-unit-options">
        {DEFAULT_UNITS.map((unit) => (
          <option key={unit} value={unit} />
        ))}
      </datalist>

      <datalist id="estimate-fo-type-options">
        {supplyTypes.map((supplyType) => (
          <option key={supplyType.id} value={supplyType.name} />
        ))}
      </datalist>

      <AssemblyPicker
        isOpen={isAssemblyPickerOpen}
        isReadOnly={isReadOnly}
        anchorItemId={insertionAnchorItemId}
        onClose={() => setIsAssemblyPickerOpen(false)}
        onInsert={(assemblyId) =>
          onInsertAssembly(assemblyId, insertionAnchorItemId)
        }
      />

      <PastePreviewDialog
        isOpen={isPastePreviewOpen}
        detectedFormat={detectedClipboardFormatForDialog}
        mapping={pasteMappingEntries}
        rows={pasteDialogRows}
        errors={pasteErrors}
        onMappingChange={handlePasteMappingChange}
        onToggleRow={handleTogglePasteRow}
        onConfirm={() => void handleConfirmPastePreview()}
        onClose={closePastePreview}
      />
      </div>
    </EstimateEditorProvider>
  );
}
