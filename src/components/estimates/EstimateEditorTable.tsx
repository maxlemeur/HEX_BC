"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import {
  type SectionTotals,
} from "@/lib/estimate-calculations";
import {
  type SupportedEstimateCurrency,
} from "@/lib/money";
import { PastePreviewDialog } from "@/components/estimates/PastePreviewDialog";
import {
  EstimateEditorRow,
  getSpreadsheetColumnKeys,
} from "@/components/estimates/components/EstimateEditorRow";
import {
  EstimateSuggestionRow,
  type SuggestionPreview,
} from "@/components/estimates/components/EstimateSuggestionRow";
import { EstimateEditorTableChrome } from "@/components/estimates/components/estimate-editor-table/EstimateEditorTableChrome";
import { EstimateEditorTableSectionDialogs } from "@/components/estimates/components/estimate-editor-table/EstimateEditorTableSectionDialogs";
import { EstimateEditorToolbar } from "@/components/estimates/components/EstimateEditorToolbar";
import { AssemblyPicker } from "@/components/estimates/AssemblyPicker";
import { QuickTemplatePicker } from "@/components/estimates/editor/QuickTemplatePicker";
import { QuickAssemblyPicker } from "@/components/estimates/editor/QuickAssemblyPicker";
import {
  SupplierComparisonPanel,
  type SupplierComparisonAlternative,
} from "@/components/estimates/SupplierComparisonPanel";
import { EstimateEditorProvider } from "@/components/estimates/context/EstimateEditorContext";
import {
  EstimateEditorRowActionsProvider,
  type EstimateEditorRowActionsContextValue,
} from "@/components/estimates/context/EstimateEditorRowActionsContext";
import { EstimateSpreadsheetProvider } from "@/components/estimates/context/EstimateSpreadsheetContext";
import {
  useEstimateClipboard,
} from "@/components/estimates/hooks/useEstimateClipboard";
import {
  useEstimateEditorSuggestions,
} from "@/components/estimates/hooks/useEstimateEditorSuggestions";
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
  useEstimateSectionDialogs,
} from "@/components/estimates/hooks/useEstimateSectionDialogs";
import {
  useEstimateSupplierComparison,
  type SupplierComparisonResult,
} from "@/components/estimates/hooks/useEstimateSupplierComparison";
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
import { useUiMode } from "@/hooks/useUiMode";
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
import { computeEstimateItemNumbering } from "@/lib/estimates/numbering";
import {
  DEFAULT_MAX_SECTION_DEPTH,
  clampMaxSectionDepth,
  formatAddLineLabelForSectionLevel,
  formatAddSectionLabelForLevel,
} from "@/lib/estimates/hierarchy";
import {
  type ClipboardPreviewValues,
} from "@/lib/estimates/clipboard";
import {
  type TreeConnectorMeta,
} from "@/lib/estimates/tree-connectors";
import {
  type SuggestionCorrectionPayload,
  type SuggestionLearningState,
} from "@/components/estimates/estimate-editor-table-types";
import type { Database } from "@/types/database";

export type {
  SuggestionCorrectionPayload,
  SuggestionLearningRuleBoost,
  SuggestionLearningState,
} from "@/components/estimates/estimate-editor-table-types";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];
type EstimateEditorItemMeta = {
  _pendingCreate?: boolean;
};
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
    | "aid"
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
  actionError: string | null;
  marginMultiplier: number;
  discountCents: number;
  taxRateBp: number;
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
  onInsertTemplate: (
    templateId: string,
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
  supplierPreselectionEligibleCount: number;
  onOpenBulkSuggestDialog: () => void;
  onOpenSupplierPreselectionDialog: () => void;
  onOpenImportFromEstimateDialog?: () => void;
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
  onScrollToItemHandled?: () => void;
  virtualization?: EstimateVirtualizationConfig;
  highlightedItemIds?: Set<string>;
  headerRight?: React.ReactNode;
  isFinalizationPanelOpen?: boolean;
  onToggleFinalizationPanel?: () => void;
  onOpenSettings?: () => void;
};

const DEFAULT_UNITS = ["u", "ml", "m2", "ens"];
const EMPTY_QUALITY_FLAGS: EstimateQualityFlagKey[] = [];
const EMPTY_SECTION_DUPLICATE_TARGETS: EstimateSectionDuplicateTarget[] = [];

type ConversionReassignedChild = {
  id: string;
  parent_id: string | null;
  position: number;
};

type ConvertEstimateItemResult = {
  item: EstimateItem;
  reassigned_children: ConversionReassignedChild[];
};

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

function toSupplierComparisonAlternativeKind(value: unknown) {
  switch (value) {
    case "best_price":
    case "most_recent":
    case "preferred_supplier":
    case "selected_current":
      return value;
    default:
      return null;
  }
}

function toSupplierComparisonAlternative(
  source: unknown
): SupplierComparisonAlternative | null {
  const record = toObjectRecord(source);
  if (!record) return null;

  const kind =
    toSupplierComparisonAlternativeKind(record.kind) ??
    toSupplierComparisonAlternativeKind(record.alternative_kind) ??
    "best_price";
  const supplierPriceId =
    toNonEmptyString(record.supplier_price_id) ?? toNonEmptyString(record.supplierPriceId);
  const supplierName =
    toNonEmptyString(record.supplier_name) ?? toNonEmptyString(record.supplierName);
  if (!supplierPriceId || !supplierName) return null;
  const supplierId =
    toNonEmptyString(record.supplier_id) ??
    toNonEmptyString(record.supplierId) ??
    supplierPriceId;

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
  const isSelected = record.is_selected === true || record.isSelected === true;

  return {
    kind,
    supplier_price_id: supplierPriceId,
    supplier_id: supplierId,
    supplier_name: supplierName,
    adjusted_unit_price_cents: adjustedUnitPriceCents,
    currency,
    supplier_reference: supplierReference,
    updated_at: updatedAt,
    is_stale: isStale,
    catalogue_url: catalogueUrl,
    product_designation: productDesignation,
    is_selected: isSelected,
  };
}

export function parseSupplierComparisonResult(payload: unknown, fallbackItemId: string) {
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
    .filter((entry): entry is SupplierComparisonAlternative => entry !== null);

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

function parseConvertEstimateItemResult(payload: unknown) {
  const envelopeRecord = toObjectRecord(payload);
  const dataRecord = toObjectRecord(envelopeRecord?.data) ?? envelopeRecord;
  const itemRecord = toObjectRecord(dataRecord?.item);
  if (!itemRecord) {
    throw new Error("Impossible de convertir l'element.");
  }

  const reassignedChildrenSource = Array.isArray(dataRecord?.reassigned_children)
    ? dataRecord.reassigned_children
    : [];
  const reassignedChildren = reassignedChildrenSource
    .map((entry) => toObjectRecord(entry))
    .map((entry) => {
      const id = toNonEmptyString(entry?.id);
      const parentIdRaw =
        entry?.parent_id === null ? null : toNonEmptyString(entry?.parent_id);
      const position = toFiniteNumber(entry?.position, Number.NaN);
      if (!id || !Number.isFinite(position) || position < 1) return null;
      return {
        id,
        parent_id: parentIdRaw,
        position: Math.floor(position),
      } satisfies ConversionReassignedChild;
    })
    .filter(
      (entry): entry is ConversionReassignedChild => entry !== null
    );

  return {
    item: itemRecord as unknown as EstimateItem,
    reassigned_children: reassignedChildren,
  } satisfies ConvertEstimateItemResult;
}

async function convertEstimateItemType(
  versionId: string,
  itemId: string,
  itemType: "section" | "line"
): Promise<ConvertEstimateItemResult> {
  const response = await fetch(`/api/estimates/${versionId}/items`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify({
      id: itemId,
      item_type: itemType,
    }),
  });

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(
      resolveApiErrorMessage(payload, "Impossible de convertir l'element.")
    );
  }

  return parseConvertEstimateItemResult(payload);
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

function normalizeQuickFilterTerm(value: string) {
  return value.trim().toLowerCase();
}

function getEstimateItemAid(item: EstimateItem) {
  const raw = (item as EstimateItem & { aid?: string | null }).aid;
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : "";
}

function isPendingCreateItem(item: EstimateItem) {
  return (item as EstimateItem & EstimateEditorItemMeta)._pendingCreate === true;
}

function matchesQuickFilter(item: EstimateItem, normalizedTerm: string) {
  if (!normalizedTerm) return true;
  const title = item.title.toLowerCase();
  const aid = getEstimateItemAid(item).toLowerCase();
  return title.includes(normalizedTerm) || aid.includes(normalizedTerm);
}

function filterItemsByQuickFilter(items: EstimateItem[], searchTerm: string) {
  const normalizedTerm = normalizeQuickFilterTerm(searchTerm);
  if (!normalizedTerm) return items;

  const itemById = new Map(items.map((item) => [item.id, item]));
  const childrenByParent = new Map<string, EstimateItem[]>();

  items.forEach((item) => {
    const parentKey = item.parent_id ?? "root";
    const siblings = childrenByParent.get(parentKey) ?? [];
    siblings.push(item);
    childrenByParent.set(parentKey, siblings);
  });

  const includeIds = new Set<string>();

  const includeAncestors = (itemId: string) => {
    let current = itemById.get(itemId);
    while (current?.parent_id) {
      const parent = itemById.get(current.parent_id);
      if (!parent) return;
      includeIds.add(parent.id);
      current = parent;
    }
  };

  const includeDescendants = (sectionId: string) => {
    const stack = [...(childrenByParent.get(sectionId) ?? [])];
    while (stack.length > 0) {
      const child = stack.pop();
      if (!child) continue;
      if (includeIds.has(child.id)) continue;
      includeIds.add(child.id);
      if (child.item_type === "section") {
        stack.push(...(childrenByParent.get(child.id) ?? []));
      }
    }
  };

  items.forEach((item) => {
    if (!matchesQuickFilter(item, normalizedTerm)) return;
    includeIds.add(item.id);
    includeAncestors(item.id);
    if (item.item_type === "section") {
      includeDescendants(item.id);
    }
  });

  return items.filter((item) => includeIds.has(item.id));
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

export function resolveEstimateEditorGridStyle(
  visibleColumns: ReadonlySet<ColumnKey>,
  isLaborSplitEnabled: boolean
): CSSProperties | undefined {
  if (isLaborSplitEnabled) {
    return undefined;
  }

  const desktopColumns = ["minmax(320px, 3fr)", "80px", "80px", "110px"];
  const tabletColumns = ["minmax(240px, 3fr)", "70px", "70px", "90px"];
  let desktopMinWidth = 320 + 80 + 80 + 110;
  let tabletMinWidth = 240 + 70 + 70 + 90;

  const addOptionalColumn = (
    column: ColumnKey,
    desktopWidth: number,
    tabletWidth: number
  ) => {
    if (!visibleColumns.has(column)) {
      return;
    }

    desktopColumns.push(`${desktopWidth}px`);
    tabletColumns.push(`${tabletWidth}px`);
    desktopMinWidth += desktopWidth;
    tabletMinWidth += tabletWidth;
  };

  addOptionalColumn("supply_type", 140, 120);
  addOptionalColumn("k_fo", 88, 76);

  desktopColumns.push("80px");
  tabletColumns.push("70px");
  desktopMinWidth += 80;
  tabletMinWidth += 70;

  addOptionalColumn("h_mo_majoration", 130, 110);
  addOptionalColumn("labor_role", 130, 110);
  addOptionalColumn("k_mo", 92, 80);

  desktopColumns.push("110px", "120px", "50px");
  tabletColumns.push("90px", "100px", "44px");
  desktopMinWidth += 110 + 120 + 50;
  tabletMinWidth += 90 + 100 + 44;

  return {
    "--estimate-grid-desktop": desktopColumns.join(" "),
    "--estimate-grid-tablet": tabletColumns.join(" "),
    "--estimate-desktop-min-width": `${desktopMinWidth}px`,
    "--estimate-tablet-min-width": `${Math.max(tabletMinWidth, 900)}px`,
  } as CSSProperties;
}

export function EstimateEditorTable({
  versionId,
  currency = "EUR",
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
  isViewerMode = false,
  maxSectionDepth,
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
  onInsertTemplate,
  onPasteRows,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  isUndoRedoBusy,
  bulkSuggestionEligibleCount,
  supplierPreselectionEligibleCount,
  onOpenBulkSuggestDialog,
  onOpenSupplierPreselectionDialog,
  onOpenImportFromEstimateDialog,
  onOpenEstimateStructureDraftDialog,
  onOpenGeneratedOuvrageDialog,
  onReorder,
  onMoveItem,
  scrollToItemId,
  onScrollToItemHandled,
  virtualization,
  headerRight,
  isFinalizationPanelOpen = false,
  onToggleFinalizationPanel,
  onOpenSettings,
}: EstimateEditorTableProps) {
  const columnVisibility = useColumnVisibility();
  const columnPreset = columnVisibility.preset;
  const setColumnPresetAuto = columnVisibility.setPresetAuto;
  const { mode: uiMode, isSimplified } = useUiMode();
  const [unitDrafts, setUnitDrafts] = useState<Record<string, string>>({});
  const [supplyTypeDrafts, setSupplyTypeDrafts] = useState<Record<string, string>>({});
  const [isAssemblyPickerOpen, setIsAssemblyPickerOpen] = useState(false);
  const [isQuickTemplatePickerOpen, setIsQuickTemplatePickerOpen] = useState(false);
  const [isQuickAssemblyPickerOpen, setIsQuickAssemblyPickerOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [isItemConversionPending, setIsItemConversionPending] = useState(false);
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Set<string>>(
    () => new Set()
  );
  const tableCardRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const insertionAnchorItemIdRef = useRef<string | null>(null);
  const appliedSuggestionContextByItemIdRef = useRef<
    Record<string, AppliedSuggestionContext>
  >({});
  const normalizedSearchTerm = useMemo(
    () => normalizeQuickFilterTerm(searchTerm),
    [searchTerm]
  );
  const resolvedMaxSectionDepth = useMemo(
    () => clampMaxSectionDepth(maxSectionDepth, DEFAULT_MAX_SECTION_DEPTH),
    [maxSectionDepth]
  );
  const quickFilteredItems = useMemo(
    () => filterItemsByQuickFilter(items, searchTerm),
    [items, searchTerm]
  );

  const {
    itemsByParent,
    depthMap,
    itemById,
    bulkMoveDestinations,
    visibleLineIds,
    getSectionTotals,
    getVisibleItems,
    visibleLineIdList,
  } = useEstimateVisibility({
    items: quickFilteredItems,
    reorderItems: items,
    qualityFilter,
    qualityFlagsByItemId,
    marginMultiplier,
    discountCents,
    taxRateBp,
    laborRateById,
    isLaborSplitEnabled,
  });
  const sectionLevelById = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((item) => {
      if (item.item_type !== "section") return;
      const depth = depthMap.get(item.id) ?? 0;
      map.set(item.id, depth + 1);
    });
    return map;
  }, [depthMap, items]);

  const getVisibleItemsForRender = useCallback(
    (parentId: string | null) => {
      if (parentId !== null && collapsedSectionIds.has(parentId)) {
        return [] as EstimateItem[];
      }
      return getVisibleItems(parentId);
    },
    [collapsedSectionIds, getVisibleItems]
  );
  const hasVisibleRowsForRender = getVisibleItemsForRender(null).length > 0;
  const dynamicGridStyle = useMemo(
    () =>
      resolveEstimateEditorGridStyle(
        columnVisibility.visibleColumns,
        isLaborSplitEnabled
      ),
    [columnVisibility.visibleColumns, isLaborSplitEnabled]
  );

  const hasInitializedPresetRef = useRef(false);
  const previousSimplifiedRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (columnVisibility.hasManualOverride) {
      previousSimplifiedRef.current = isSimplified;
      hasInitializedPresetRef.current = true;
      return;
    }

    const hasPreviousValue = previousSimplifiedRef.current !== null;
    const hasModeChanged = previousSimplifiedRef.current !== isSimplified;

    if (!hasInitializedPresetRef.current) {
      hasInitializedPresetRef.current = true;

      if (isSimplified && columnPreset !== "essential") {
        setColumnPresetAuto("essential");
      }
      if (!isSimplified && columnPreset === "essential") {
        setColumnPresetAuto("standard");
      }
    } else if (hasPreviousValue && hasModeChanged) {
      if (isSimplified && columnPreset !== "essential") {
        setColumnPresetAuto("essential");
      }
      if (!isSimplified && columnPreset === "essential") {
        setColumnPresetAuto("standard");
      }
    }

    previousSimplifiedRef.current = isSimplified;
  }, [columnPreset, columnVisibility.hasManualOverride, isSimplified, setColumnPresetAuto]);

  // Compute super-header FO/MO group spans for the grid
  const superHeaderSpans = useMemo(() => {
    const foStart = 4; // PR.FO is always column 4 (after designation, qty, unit)
    if (isLaborSplitEnabled) {
      return { foStart, foSpan: 3, moStart: 7, moSpan: 7, puStart: 14 };
    }
    const foSpan =
      1 +
      (columnVisibility.visibleColumns.has("supply_type") ? 1 : 0) +
      (columnVisibility.visibleColumns.has("k_fo") ? 1 : 0);
    const moStart = foStart + foSpan;
    const moSpan =
      1 +
      (columnVisibility.visibleColumns.has("h_mo_majoration") ? 1 : 0) +
      (columnVisibility.visibleColumns.has("labor_role") ? 1 : 0) +
      (columnVisibility.visibleColumns.has("k_mo") ? 1 : 0);
    const puStart = moStart + moSpan;
    return { foStart, foSpan, moStart, moSpan, puStart };
  }, [columnVisibility.visibleColumns, isLaborSplitEnabled]);

  const hasPendingCreateItems = useMemo(
    () => items.some((item) => isPendingCreateItem(item)),
    [items]
  );
  const canReorder =
    !isReadOnly && qualityFilter === "all_lines" && !hasPendingCreateItems;
  const itemNumberById = useMemo(
    () => computeEstimateItemNumbering(items),
    [items]
  );
  const availableSectionDuplicateTargets = useMemo(
    () =>
      sectionDuplicateTargets.filter((target) => target.versionId !== versionId),
    [sectionDuplicateTargets, versionId]
  );
  const isSuggestionLearningEnabled = learningState?.enabled === true;

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

  useEffect(() => {
    const sectionIdSet = new Set(
      items.filter((item) => item.item_type === "section").map((item) => item.id)
    );
    setCollapsedSectionIds((previous) => {
      if (previous.size === 0) return previous;
      const next = new Set<string>();
      previous.forEach((sectionId) => {
        if (sectionIdSet.has(sectionId)) {
          next.add(sectionId);
        }
      });
      return next.size === previous.size ? previous : next;
    });
  }, [items]);

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

  const {
    feedbackPendingByItemId,
    selectedSuggestionByItemId,
    setSelectedSuggestionByItemId,
    suggestionsByItemId,
    sendSuggestionFeedback,
    dismissSuggestion,
    markSuggestionDismissed,
    applySuggestionDrafts,
  } = useEstimateEditorSuggestions({
    items,
    visibleLineIds,
    isReadOnly,
    suggestionRules,
    learningState,
    categoryById,
    supplyTypeById,
    supplyTypeByLowerName,
    roleById,
    setUnitDrafts,
    setSupplyTypeDrafts,
  });

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

  const {
    supplierComparisonMenu,
    closeSupplierComparisonContextMenu,
    handleOpenSupplierComparisonContextMenu,
    openSupplierComparisonPanel,
    handleCloseSupplierComparisonPanel,
    activeSupplierComparisonItem,
    activeSupplierComparison,
    bestSupplierPriceIdByItemId,
    isSupplierComparisonLoading,
    supplierComparisonError,
    handleSelectSupplierComparisonAlternative,
  } = useEstimateSupplierComparison({
    versionId,
    itemById,
    isReadOnly,
    fetchSupplierComparison: fetchSupplierComparisons,
    onPatchItemWithSuggestionTracking: patchItemWithSuggestionTracking,
  });

  const {
    sectionContextMenu,
    closeSectionContextMenu,
    handleOpenSectionContextMenu,
    handleDuplicateSectionInPlace,
    handleOpenDuplicateSectionDialog,
    closeDuplicateSectionDialog,
    handleConfirmDuplicateSectionToVersion,
    duplicateSectionDialogSectionId,
    duplicateSectionTargetVersionId,
    setDuplicateSectionTargetVersionId,
    isDuplicateSectionPending,
    handleOpenSaveAsAssemblyDialog,
    closeSaveAsAssemblyDialog,
    handleConfirmSaveAsAssembly,
    saveAsAssemblyDialogSectionId,
    saveAsAssemblyName,
    setSaveAsAssemblyName,
    saveAsAssemblyNameInputRef,
    isSaveAsAssemblyPending,
  } = useEstimateSectionDialogs({
    isReadOnly,
    itemById,
    itemsByParent,
    availableSectionDuplicateTargets,
    onDuplicateSection,
    onDuplicateSectionToVersion,
  });

  const applyItemConversionResultLocally = useCallback(
    (result: ConvertEstimateItemResult) => {
      onPatchItem(result.item.id, result.item as unknown as ItemPatch, {
        persist: false,
      });
      result.reassigned_children.forEach((child) => {
        onPatchItem(
          child.id,
          {
            parent_id: child.parent_id,
            position: child.position,
          } as unknown as ItemPatch,
          { persist: false }
        );
      });
    },
    [onPatchItem]
  );

  const handleConvertLineToSection = useCallback(
    async (lineId: string) => {
      if (isReadOnly || isItemConversionPending) return;

      const item = itemById.get(lineId);
      if (!item || item.item_type !== "line") return;

      const targetLineIds =
        selectedLineIdList.length > 1 && selectedLineIdList.includes(lineId)
          ? selectedLineIdList.filter((candidateId) => {
              const candidate = itemById.get(candidateId);
              return candidate?.item_type === "line";
            })
          : [lineId];
      if (targetLineIds.length === 0) return;

      const confirmed = window.confirm(
        targetLineIds.length > 1
          ? `Convertir ${targetLineIds.length} lignes selectionnees en sections ?`
          : "Convertir cette ligne en section ?"
      );
      if (!confirmed) return;

      closeSupplierComparisonContextMenu();
      setIsItemConversionPending(true);
      try {
        for (const targetLineId of targetLineIds) {
          const result = await convertEstimateItemType(
            versionId,
            targetLineId,
            "section"
          );
          applyItemConversionResultLocally(result);
        }
        if (targetLineIds.length > 1) {
          clearLineSelection();
        }
      } catch (error) {
        window.alert(
          error instanceof Error
            ? error.message
            : "Impossible de convertir la ligne."
        );
      } finally {
        setIsItemConversionPending(false);
      }
    },
    [
      applyItemConversionResultLocally,
      clearLineSelection,
      closeSupplierComparisonContextMenu,
      isItemConversionPending,
      isReadOnly,
      itemById,
      selectedLineIdList,
      versionId,
    ]
  );

  const handleConvertSectionToLine = useCallback(
    async (sectionId: string) => {
      if (isReadOnly || isItemConversionPending) return;

      const item = itemById.get(sectionId);
      if (!item || item.item_type !== "section") return;

      const directChildrenCount = (itemsByParent.get(sectionId) ?? []).length;
      if (directChildrenCount > 0) {
        window.alert(
          "Conversion impossible: la section contient des enfants."
        );
        return;
      }
      const confirmed = window.confirm(
        "Convertir cette section en ligne ?"
      );
      if (!confirmed) return;

      closeSectionContextMenu();
      setIsItemConversionPending(true);
      try {
        const result = await convertEstimateItemType(versionId, sectionId, "line");
        applyItemConversionResultLocally(result);
      } catch (error) {
        window.alert(
          error instanceof Error
            ? error.message
            : "Impossible de convertir la section."
        );
      } finally {
        setIsItemConversionPending(false);
      }
    },
    [
      applyItemConversionResultLocally,
      closeSectionContextMenu,
      isItemConversionPending,
      isReadOnly,
      itemById,
      itemsByParent,
      versionId,
    ]
  );

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

  const applySuggestion = useCallback(
    (item: EstimateItem, suggestion: SuggestionPreview) => {
      if (isReadOnly || item.item_type !== "line") return;

      const patch: ItemPatch = {};
      const unitValue = suggestion.rule.unit?.trim();
      if (unitValue) {
        patch.description = unitValue;
      }
      const explicitSupplyTypeId = toNonEmptyString(
        (suggestion.rule as SuggestionRule & Record<string, unknown>)
          .supply_type_id
      );
      if (explicitSupplyTypeId) {
        patch.supply_type_id = explicitSupplyTypeId;
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

      applySuggestionDrafts(item.id, suggestion);
      patchItemWithSuggestionTracking(item.id, patch, { persist: true });
      markSuggestionDismissed(item.id, suggestion.rule.id);
      void sendSuggestionFeedback(item, suggestion, "accept");
    },
    [
      applySuggestionDrafts,
      categoryById,
      isReadOnly,
      markSuggestionDismissed,
      patchItemWithSuggestionTracking,
      sendSuggestionFeedback,
      supplyTypeByLowerName,
    ]
  );

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
      setSelectedSuggestionByItemId,
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
    maxSectionDepth: resolvedMaxSectionDepth,
    itemsByParent,
    onReorder,
    onMoveItem,
    hasVisibleRows: hasVisibleRowsForRender,
    getVisibleItems: getVisibleItemsForRender,
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

  const visibleItemsInOrderForRender = useMemo(() => {
    const ordered: EstimateItem[] = [];
    const walk = (parentId: string | null) => {
      const list = getVisibleItemsForRender(parentId);
      list.forEach((item) => {
        ordered.push(item);
        if (item.item_type === "section") {
          walk(item.id);
        }
      });
    };
    walk(null);
    return ordered;
  }, [getVisibleItemsForRender]);

  const spreadsheetNavigationRows = useMemo(() => {
    if (!hasVisibleRowsForRender) return [] as SpreadsheetNavigationRow[];

    return visibleItemsInOrderForRender.map((item) => {
      const allKeys = getSpreadsheetColumnKeys(item.item_type, isLaborSplitEnabled);
      if (hiddenSpreadsheetColumnKeys.size === 0) {
        return { rowId: item.id, columnKeys: allKeys };
      }
      return {
        rowId: item.id,
        columnKeys: allKeys.filter((key) => !hiddenSpreadsheetColumnKeys.has(key)),
      };
    });
  }, [
    hasVisibleRowsForRender,
    hiddenSpreadsheetColumnKeys,
    isLaborSplitEnabled,
    visibleItemsInOrderForRender,
  ]);

  const spreadsheetNavigation = useSpreadsheetNavigation({
    rows: spreadsheetNavigationRows,
    disabled: !hasVisibleRowsForRender || isReadOnly,
    onActiveCellNotMounted: isVirtualized
      ? handleNavigationCellNotMounted
      : undefined,
  });
  const insertionAnchorItemId = spreadsheetNavigation.activeCell?.rowId ?? null;

  useEffect(() => {
    insertionAnchorItemIdRef.current = insertionAnchorItemId;
  }, [insertionAnchorItemId]);

  const toggleSectionCollapsed = useCallback((sectionId: string) => {
    setCollapsedSectionIds((previous) => {
      const next = new Set(previous);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  }, []);

  const handleExpandAllSections = useCallback(() => {
    setCollapsedSectionIds(new Set());
  }, []);

  const handleCollapseAllSections = useCallback(() => {
    setCollapsedSectionIds(
      new Set(
        items.filter((item) => item.item_type === "section").map((item) => item.id)
      )
    );
  }, [items]);

  const activeLineBreadcrumb = useMemo(() => {
    const activeRowId = spreadsheetNavigation.activeCell?.rowId;
    if (!activeRowId) return null;

    const activeItem = itemById.get(activeRowId);
    if (!activeItem || activeItem.item_type !== "line") {
      return null;
    }

    const labels: string[] = [];
    let cursorParentId = activeItem.parent_id;
    let guard = 0;

    while (cursorParentId && guard < 100) {
      guard += 1;
      const parent = itemById.get(cursorParentId);
      if (!parent || parent.item_type !== "section") {
        break;
      }
      labels.push(parent.title || "Sans titre");
      cursorParentId = parent.parent_id;
    }

    if (labels.length === 0) {
      return null;
    }

    return labels.reverse().join(" > ");
  }, [itemById, spreadsheetNavigation.activeCell?.rowId]);

  const openSectionContextMenuForRow = useCallback(
    (sectionId: string, position: { x: number; y: number }) => {
      if (isViewerMode) return;
      handleOpenSectionContextMenu(sectionId, position);
    },
    [handleOpenSectionContextMenu, isViewerMode]
  );

  const rowActionsContextValue = useMemo<EstimateEditorRowActionsContextValue>(
    () => ({
      onDeleteItem,
      onOpenSupplierComparisonPanel: openSupplierComparisonPanel,
      onOpenSupplierComparisonContextMenu: handleOpenSupplierComparisonContextMenu,
      onOpenSectionContextMenu: openSectionContextMenuForRow,
      onPatchItem: patchItemWithSuggestionTracking,
      onUnitChange: handleUnitDraftChange,
      onUnitCommit: handleUnitCommit,
      onSupplyTypeChange: handleSupplyTypeDraftChange,
      onSupplyTypeCommit: handleSupplyTypeCommit,
      onAddLine,
      onAddSection,
      onConvertLineToSection: handleConvertLineToSection,
      onToggleOutlierDismiss,
      onLineSelectionInteraction: handleLineSelectionInteraction,
    }),
    [
      handleConvertLineToSection,
      handleLineSelectionInteraction,
      handleOpenSupplierComparisonContextMenu,
      handleSupplyTypeCommit,
      handleSupplyTypeDraftChange,
      handleUnitCommit,
      handleUnitDraftChange,
      onAddLine,
      onAddSection,
      onDeleteItem,
      onToggleOutlierDismiss,
      openSectionContextMenuForRow,
      openSupplierComparisonPanel,
      patchItemWithSuggestionTracking,
    ]
  );

  const renderSortableRow = useCallback(
    (
      item: EstimateItem,
      depth: number,
      unitValue: string,
      supplyTypeValue: string,
      qualityFlags: EstimateQualityFlagKey[],
      sectionTotals: SectionTotals | null,
      treeConnectorMeta?: TreeConnectorMeta
    ) => {
      const bestSupplierPriceId = bestSupplierPriceIdByItemId[item.id] ?? null;
      const hasSupplierComparisonMismatch =
        bestSupplierPriceId !== null &&
        (item.selected_supplier_price_id ?? null) !== bestSupplierPriceId;
      const sectionLevel =
        item.item_type === "section"
          ? (sectionLevelById.get(item.id) ?? depth + 1)
          : null;
      const canAddSection =
        item.item_type === "section" &&
        sectionLevel !== null &&
        sectionLevel < resolvedMaxSectionDepth;
      const canAddLine =
        item.item_type === "section" &&
        sectionLevel !== null &&
        sectionLevel <= resolvedMaxSectionDepth;
      const addSectionLabel =
        item.item_type === "section" && sectionLevel !== null
          ? formatAddSectionLabelForLevel(sectionLevel + 1)
          : "+ Section";
      const addLineLabel =
        item.item_type === "section" && sectionLevel !== null
          ? formatAddLineLabelForSectionLevel(sectionLevel)
          : "+ Ligne";

      return (
        <EstimateEditorRow
          versionId={versionId}
          estimateCurrency={currency}
          item={item}
          itemNumber={itemNumberById[item.id] ?? null}
          depth={depth}
          unitValue={unitValue}
          supplyTypeValue={supplyTypeValue}
          qualityFlags={qualityFlags}
          detectedOutlierFlags={detectedOutlierFlagsByItemId[item.id] ?? []}
          dismissedOutlierFlags={dismissedOutlierFlagsByItemId[item.id] ?? []}
          supplyTypeById={supplyTypeById}
          laborRoles={laborRoles}
          isLineSelected={item.item_type === "line" && isLineSelected(item.id)}
          hasSupplierComparisonMismatch={hasSupplierComparisonMismatch}
          sectionTotals={sectionTotals}
          isDragDisabled={!canReorder || isPendingCreateItem(item)}
          isOutlierActionPending={Boolean(outlierActionPendingByItemId[item.id])}
          isReadOnly={isReadOnly}
          hideEditingActions={isViewerMode}
          isLaborSplitEnabled={isLaborSplitEnabled}
          isPendingCreate={isPendingCreateItem(item)}
          visibleColumns={isLaborSplitEnabled ? undefined : columnVisibility.visibleColumns}
          isSearchMatch={
            normalizedSearchTerm.length > 0 &&
            item.item_type === "line" &&
            matchesQuickFilter(item, normalizedSearchTerm)
          }
          treeConnectorMeta={treeConnectorMeta}
          sectionLevel={sectionLevel}
          canAddLine={canAddLine}
          canAddSection={canAddSection}
          addLineLabel={addLineLabel}
          addSectionLabel={addSectionLabel}
          isSectionCollapsed={collapsedSectionIds.has(item.id)}
          onToggleSectionCollapsed={toggleSectionCollapsed}
        />
      );
    },
    [
      bestSupplierPriceIdByItemId,
      canReorder,
      columnVisibility.visibleColumns,
      detectedOutlierFlagsByItemId,
      dismissedOutlierFlagsByItemId,
      itemNumberById,
      isLaborSplitEnabled,
      isViewerMode,
      isLineSelected,
      isReadOnly,
      laborRoles,
      outlierActionPendingByItemId,
      normalizedSearchTerm,
      supplyTypeById,
      currency,
      versionId,
      sectionLevelById,
      resolvedMaxSectionDepth,
      collapsedSectionIds,
      toggleSectionCollapsed,
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
        row.item.item_type === "section" ? getSectionTotals(row.item.id) : null,
        row.treeConnectorMeta
      );
    },
    [getSectionTotals, renderSortableRow, renderSuggestionRow]
  );

  function renderList(
    parentId: string | null,
    ancestorLastChildFlags: boolean[] = []
  ) {
    const list = getVisibleItemsForRender(parentId);
    if (list.length === 0) return null;

    return (
      <div className="estimate-group">
        <SortableContext
          items={list.map((item) => item.id)}
          strategy={verticalListSortingStrategy}
        >
          {list.map((item, index) => {
            const isLast = index === list.length - 1;
            const suggestions = suggestionsByItemId.get(item.id);
            const rowDepth = depthMap.get(item.id) ?? ancestorLastChildFlags.length;
            const hasVisibleChildren =
              item.item_type === "section" &&
              getVisibleItemsForRender(item.id).length > 0;
            const treeConnectorMeta: TreeConnectorMeta = {
              depth: rowDepth,
              isLastChild: isLast,
              ancestorLastChildFlags,
              hasVisibleChildren,
            };
            return (
              <Fragment key={item.id}>
                {renderSortableRow(
                  item,
                  rowDepth,
                  mergedUnitDrafts[item.id] ?? "",
                  mergedSupplyTypeDrafts[item.id] ?? "",
                  qualityFlagsByItemId[item.id] ?? EMPTY_QUALITY_FLAGS,
                  item.item_type === "section"
                    ? getSectionTotals(item.id)
                    : null,
                  treeConnectorMeta
                )}
                {suggestions ? renderSuggestionRow(item, suggestions) : null}
                {item.item_type === "section"
                  ? renderList(item.id, [...ancestorLastChildFlags, isLast])
                  : null}
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
        hasVisibleRows: hasVisibleRowsForRender,
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
      hasVisibleRowsForRender,
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

  const sectionContextMeta = useMemo(() => {
    if (!sectionContextMenu) return null;
    const section = itemById.get(sectionContextMenu.sectionId);
    if (!section || section.item_type !== "section") {
      return null;
    }
    const sectionLevel = sectionLevelById.get(section.id) ?? 1;
    const hasChildren = (itemsByParent.get(section.id) ?? []).length > 0;
    const canAddSection = sectionLevel < resolvedMaxSectionDepth;
    const canAddLine = sectionLevel <= resolvedMaxSectionDepth;
    return {
      sectionLevel,
      hasChildren,
      canAddSection,
      canAddLine,
      addSectionLabel: formatAddSectionLabelForLevel(sectionLevel + 1),
      addLineLabel: formatAddLineLabelForSectionLevel(sectionLevel),
    };
  }, [
    itemById,
    itemsByParent,
    resolvedMaxSectionDepth,
    sectionContextMenu,
    sectionLevelById,
  ]);

  // Scroll shadow detection for horizontal overflow indicator
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const updateShadow = () => {
      const hasOverflow = el.scrollWidth > el.clientWidth;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
      el.classList.toggle("estimate-table-scroll--has-overflow", hasOverflow && !atEnd);
      el.classList.toggle("estimate-table-scroll--scrolled-end", hasOverflow && atEnd);
    };

    updateShadow();
    el.addEventListener("scroll", updateShadow, { passive: true });
    window.addEventListener("resize", updateShadow, { passive: true } as AddEventListenerOptions);

    return () => {
      el.removeEventListener("scroll", updateShadow);
      window.removeEventListener("resize", updateShadow);
    };
  }, []);

  return (
    <EstimateEditorProvider value={estimateEditorContextValue}>
      <EstimateEditorRowActionsProvider value={rowActionsContextValue}>
        <EstimateSpreadsheetProvider navigation={spreadsheetNavigation}>
          <EstimateEditorTableChrome
            tableCardRef={tableCardRef}
            headerRight={headerRight}
            toolbarNode={
              <EstimateEditorToolbar
                uiMode={uiMode}
                isViewerMode={isViewerMode}
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
                supplierPreselectionEligibleCount={
                  supplierPreselectionEligibleCount
                }
                onQualityFilterChange={onQualityFilterChange}
                onOutlierDetectionMethodChange={
                  onOutlierDetectionMethodChange
                }
                onOutlierThresholdChange={onOutlierThresholdChange}
                onUndo={onUndo}
                onRedo={onRedo}
                onApplyBulkMajoration={handleApplyBulkMajoration}
                onBulkDeleteSelection={handleBulkDeleteSelection}
                onApplyBulkMove={handleApplyBulkMove}
                onApplyBulkCategory={handleApplyBulkCategory}
                onApplyBulkLaborRole={handleApplyBulkLaborRole}
                onOpenBulkSuggestDialog={onOpenBulkSuggestDialog}
                onOpenSupplierPreselectionDialog={
                  onOpenSupplierPreselectionDialog
                }
                onOpenAssemblyPicker={() => setIsAssemblyPickerOpen(true)}
                onOpenImportFromEstimateDialog={onOpenImportFromEstimateDialog}
                onOpenEstimateStructureDraftDialog={
                  onOpenEstimateStructureDraftDialog
                }
                onOpenGeneratedOuvrageDialog={onOpenGeneratedOuvrageDialog}
                onExpandAllSections={handleExpandAllSections}
                onCollapseAllSections={handleCollapseAllSections}
                columnPreset={columnVisibility.preset}
                columnPresetLabels={columnVisibility.presetLabels}
                onColumnPresetChange={columnVisibility.setPreset}
                searchTerm={searchTerm}
                onSearchChange={setSearchTerm}
                columnVisibleColumns={columnVisibility.visibleColumns}
                allAdvancedColumns={columnVisibility.allAdvancedColumns}
                columnLabels={columnVisibility.columnLabels}
                onToggleColumn={columnVisibility.toggleColumn}
                hiddenAdvancedCount={columnVisibility.hiddenAdvancedCount}
                onToggleAdvancedColumns={columnVisibility.toggleAdvancedColumns}
                isFinalizationPanelOpen={isFinalizationPanelOpen}
                onToggleFinalizationPanel={onToggleFinalizationPanel}
                isLaborSplitEnabled={isLaborSplitEnabled}
                onOpenSettings={onOpenSettings}
                isQuickTemplatePickerOpen={isQuickTemplatePickerOpen}
                onToggleQuickTemplatePicker={() => {
                  setIsQuickTemplatePickerOpen((prev) => !prev);
                  setIsQuickAssemblyPickerOpen(false);
                }}
                isQuickAssemblyPickerOpen={isQuickAssemblyPickerOpen}
                onToggleQuickAssemblyPicker={() => {
                  setIsQuickAssemblyPickerOpen((prev) => !prev);
                  setIsQuickTemplatePickerOpen(false);
                }}
                quickTemplatePickerNode={
                  <QuickTemplatePicker
                    isOpen={isQuickTemplatePickerOpen}
                    isReadOnly={isReadOnly}
                    onInsert={(templateId) =>
                      onInsertTemplate(templateId, insertionAnchorItemId)
                    }
                    onClose={() => setIsQuickTemplatePickerOpen(false)}
                  />
                }
                quickAssemblyPickerNode={
                  <QuickAssemblyPicker
                    isOpen={isQuickAssemblyPickerOpen}
                    isReadOnly={isReadOnly}
                    onInsert={(assemblyId) =>
                      onInsertAssembly(assemblyId, insertionAnchorItemId)
                    }
                    onClose={() => setIsQuickAssemblyPickerOpen(false)}
                  />
                }
              />
            }
            activeLineBreadcrumb={activeLineBreadcrumb}
            actionError={actionError}
            scrollContainerRef={scrollContainerRef}
            isLaborSplitEnabled={isLaborSplitEnabled}
            dynamicGridStyle={dynamicGridStyle}
            superHeaderSpans={superHeaderSpans}
            visibleColumns={columnVisibility.visibleColumns}
            allVisibleSelected={allVisibleSelected}
            onToggleAllVisibleLines={toggleAllVisibleLines}
            visibleLineIdCount={visibleLineIdList.length}
            items={items}
            hasVisibleRowsForRender={hasVisibleRowsForRender}
            isReadOnly={isReadOnly}
            isViewerMode={isViewerMode}
            onAddRootSection={() => onAddSection(null)}
            rootAddSectionLabel={formatAddSectionLabelForLevel(1)}
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
            grandTotals={grandTotals}
            currency={currency}
          />

          <EstimateEditorTableSectionDialogs
            isViewerMode={isViewerMode}
            isReadOnly={isReadOnly}
            isItemConversionPending={isItemConversionPending}
            sectionContextMenu={sectionContextMenu}
            sectionContextMeta={sectionContextMeta}
            onCloseSectionContextMenu={closeSectionContextMenu}
            onAddLine={onAddLine}
            onAddSection={onAddSection}
            onConvertSectionToLine={handleConvertSectionToLine}
            onDuplicateSectionInPlace={handleDuplicateSectionInPlace}
            onOpenDuplicateSectionDialog={handleOpenDuplicateSectionDialog}
            onOpenSaveAsAssemblyDialog={handleOpenSaveAsAssemblyDialog}
            onDeleteSection={onDeleteItem}
            onDuplicateSection={onDuplicateSection}
            onDuplicateSectionToVersion={onDuplicateSectionToVersion}
            availableSectionDuplicateTargets={availableSectionDuplicateTargets}
            duplicateSectionDialogSectionId={duplicateSectionDialogSectionId}
            duplicateSectionTargetVersionId={duplicateSectionTargetVersionId}
            onDuplicateSectionTargetVersionIdChange={
              setDuplicateSectionTargetVersionId
            }
            isDuplicateSectionPending={isDuplicateSectionPending}
            onCloseDuplicateSectionDialog={closeDuplicateSectionDialog}
            onConfirmDuplicateSectionToVersion={
              handleConfirmDuplicateSectionToVersion
            }
            saveAsAssemblyDialogSectionId={saveAsAssemblyDialogSectionId}
            saveAsAssemblyName={saveAsAssemblyName}
            onSaveAsAssemblyNameChange={setSaveAsAssemblyName}
            saveAsAssemblyNameInputRef={saveAsAssemblyNameInputRef}
            isSaveAsAssemblyPending={isSaveAsAssemblyPending}
            onCloseSaveAsAssemblyDialog={closeSaveAsAssemblyDialog}
            onConfirmSaveAsAssembly={handleConfirmSaveAsAssembly}
          />

      {supplierComparisonMenu ? (
        <div
          className="estimate-supplier-comparison-context-menu"
          role="menu"
          aria-label="Actions de comparaison fournisseurs"
          data-testid="estimate-supplier-comparison-context-menu"
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
            disabled={isItemConversionPending}
          >
            Comparer fournisseurs
          </button>
          {!isViewerMode ? (
            <button
              type="button"
              className="estimate-supplier-comparison-context-menu__action"
              role="menuitem"
              onClick={() => void handleConvertLineToSection(supplierComparisonMenu.itemId)}
              disabled={isReadOnly || isItemConversionPending}
            >
              Convertir en section
            </button>
          ) : null}
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

      {/* Spacer so table content isn't hidden behind the fixed bulk-selection bar */}
      {hasSelectedLines && <div className="h-16" />}
        </EstimateSpreadsheetProvider>
      </EstimateEditorRowActionsProvider>
    </EstimateEditorProvider>
  );
}
