"use client";

import dynamic from "next/dynamic";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import type { SectionTotals } from "@/lib/estimate-calculations";
import type { SupportedEstimateCurrency } from "@/lib/money";
import {
  EstimateEditorRow,
  getSpreadsheetColumnKeys,
} from "@/components/estimates/components/EstimateEditorRow";
import {
  EstimateSuggestionRow,
  type SuggestionPreview,
} from "@/components/estimates/components/EstimateSuggestionRow";
import { EstimateEditorTableChrome } from "@/components/estimates/components/estimate-editor-table/EstimateEditorTableChrome";
import {
  MobileEstimateList,
  type MobileEstimateListRow,
} from "@/components/estimates/components/estimate-editor-table/MobileEstimateList";
import { EstimateEditorToolbar } from "@/components/estimates/components/EstimateEditorToolbar";
import { ConfirmModal } from "@/components/ui-legacy/ConfirmModal";
import type { SupplierComparisonAlternative } from "@/components/estimates/SupplierComparisonPanel";
import type { CataloguePriceSuggestion } from "@/lib/estimates/catalogue-suggestions";
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
  type EstimateSectionCalculation,
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
  type EstimateColumnId,
  type EstimateColumnWidths,
  useEstimateColumnWidths,
} from "@/hooks/useEstimateColumnWidths";
import { useIsMobileViewport } from "@/hooks/useIsTablet";
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
import { getEstimateEditorItemClientKey } from "@/lib/estimates/editor-items";
import {
  type SuggestionCorrectionPayload,
  type SuggestionLearningState,
} from "@/components/estimates/estimate-editor-table-types";
import type { Database } from "@/types/database";

const PastePreviewDialog = dynamic(() =>
  import("@/components/estimates/PastePreviewDialog").then(
    (module) => module.PastePreviewDialog
  )
);
const MobileEstimateLineEditor = dynamic(() =>
  import(
    "@/components/estimates/components/estimate-editor-row/MobileEstimateLineEditor"
  ).then((module) => module.MobileEstimateLineEditor)
);
const EstimateEditorTableSectionDialogs = dynamic(() =>
  import(
    "@/components/estimates/components/estimate-editor-table/EstimateEditorTableSectionDialogs"
  ).then((module) => module.EstimateEditorTableSectionDialogs)
);
const EstimateEditorTableLineContextMenu = dynamic(() =>
  import(
    "@/components/estimates/components/estimate-editor-table/EstimateEditorTableLineContextMenu"
  ).then((module) => module.EstimateEditorTableLineContextMenu)
);
const AssemblyPicker = dynamic(() =>
  import("@/components/estimates/AssemblyPicker").then(
    (module) => module.AssemblyPicker
  )
);
const QuickTemplatePicker = dynamic(() =>
  import("@/components/estimates/editor/QuickTemplatePicker").then(
    (module) => module.QuickTemplatePicker
  )
);
const SupplierComparisonPanel = dynamic(() =>
  import("@/components/estimates/SupplierComparisonPanel").then(
    (module) => module.SupplierComparisonPanel
  )
);
const EstimateArticleSheet = dynamic(() =>
  import("@/components/estimates/EstimateArticleSheet").then(
    (module) => module.EstimateArticleSheet
  )
);

export type {
  SuggestionCorrectionPayload,
  SuggestionLearningRuleBoost,
  SuggestionLearningState,
} from "@/components/estimates/estimate-editor-table-types";
import {
  TRACKED_SUGGESTION_CORRECTION_FIELDS,
  type AppliedSuggestionContext,
  type EstimateQualityFilter,
  type EstimateVirtualizationConfig,
  type EstimateEditorItemMeta,
  type EstimateEditorItemPatch,
  type SuggestionAppliedValues,
  type SuggestionCorrectionFieldName,
  type SuggestionCorrectionValue,
} from "@/components/estimates/estimate-editor-table-types";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];

type DeleteConfirmationState =
  | {
      kind: "item";
      itemId: string;
      message: string;
    }
  | {
      kind: "bulk";
      message: string;
    };
type EstimateCategory = Database["public"]["Tables"]["estimate_categories"]["Row"];
type SupplyType = Database["public"]["Tables"]["supply_types"]["Row"];
type LaborRole = Database["public"]["Tables"]["labor_roles"]["Row"];
type SuggestionRule =
  Database["public"]["Tables"]["estimate_suggestion_rules"]["Row"];

type ItemPatch = EstimateEditorItemPatch;

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
  ribbonHeaderNode?: React.ReactNode;
  ribbonAlertsNode?: React.ReactNode;
  isFinalizationPanelOpen?: boolean;
  onToggleFinalizationPanel?: () => void;
  onOpenSettings?: () => void;
};

const DEFAULT_UNITS = ["u", "ml", "m2", "ens"];
const EMPTY_QUALITY_FLAGS: EstimateQualityFlagKey[] = [];
const EMPTY_SECTION_DUPLICATE_TARGETS: EstimateSectionDuplicateTarget[] = [];
const EMPTY_HIGHLIGHTED_ITEM_IDS = new Set<string>();

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
    throw new Error("Impossible de convertir l'élément.");
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
      resolveApiErrorMessage(payload, "Impossible de convertir l'élément.")
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
  isLaborSplitEnabled: boolean,
  customWidths: Readonly<EstimateColumnWidths> = {},
): CSSProperties | undefined {
  const desktopColumns: string[] = [];
  const tabletColumns: string[] = [];
  let desktopMinWidth = 0;
  let tabletMinWidth = 0;

  const pushColumn = (
    columnId: EstimateColumnId,
    desktopWidth: number,
    tabletWidth: number,
    desktopTrack = `${desktopWidth}px`,
    tabletTrack = `${tabletWidth}px`,
  ) => {
    const customWidth = customWidths[columnId];
    desktopColumns.push(customWidth ? `${customWidth}px` : desktopTrack);
    tabletColumns.push(customWidth ? `${customWidth}px` : tabletTrack);
    desktopMinWidth += customWidth ?? desktopWidth;
    tabletMinWidth += customWidth ?? tabletWidth;
  };

  // Designation, Qte, U, PR. FO — toujours presentes.
  pushColumn("designation", 300, 260, "minmax(300px, 3fr)", "minmax(260px, 3fr)");
  pushColumn("quantity", 64, 58);
  pushColumn("unit", 54, 50);
  pushColumn("supply_price", 88, 80);

  const addOptionalColumn = (
    column: ColumnKey,
    desktopWidth: number,
    tabletWidth: number,
  ) => {
    if (!visibleColumns.has(column)) {
      return;
    }

    pushColumn(column, desktopWidth, tabletWidth);
  };

  const pushFixed = (
    columnId: EstimateColumnId,
    desktopWidth: number,
    tabletWidth: number,
  ) => {
    pushColumn(columnId, desktopWidth, tabletWidth);
  };

  if (isLaborSplitEnabled) {
    // En mode MO eclatee, les colonnes de cout sont FORCEES visibles (cf.
    // `|| isLaborSplitEnabled` dans LineRow), d'ou des largeurs fixes. Ces
    // valeurs reprennent a l'identique celles de `.estimate-table--labor-split`
    // dans globals.css, qui servait jusqu'ici de second regime de mise en page :
    // la fonction retournait `undefined` et laissait le CSS statique decider.
    // Ce second regime empechait toute colonne optionnelle en mode split.
    pushFixed("supply_type", 112, 100); // Type FO
    pushFixed("k_fo", 60, 56); // K FO
    pushFixed("h_mo_majoration", 96, 88); // Majoration MO
    pushFixed("labor_hours_workshop", 72, 68); // h MO atelier
    pushFixed("labor_role_workshop", 104, 96); // Type MO atelier
    pushFixed("k_mo_workshop", 60, 56); // K MO atelier
    pushFixed("labor_hours_site", 72, 68); // h MO chantier
    pushFixed("labor_role_site", 104, 96); // Type MO chantier
    pushFixed("k_mo_site", 60, 56); // K MO chantier
  } else {
    addOptionalColumn("supply_type", 112, 100);
    addOptionalColumn("k_fo", 56, 56);
    pushFixed("labor_hours", 56, 56); // h MO
    addOptionalColumn("h_mo_majoration", 104, 96);
    addOptionalColumn("labor_role", 112, 100);
    addOptionalColumn("k_mo", 56, 56);
  }

  // EST-E15 : sous-detail de prix, place entre la main-d'oeuvre et la vente.
  addOptionalColumn("ds", 100, 94);
  addOptionalColumn("marge", 100, 94);
  addOptionalColumn("marque", 78, 72);

  pushFixed("unit_price", 88, 82); // P.U.
  pushFixed("total_price", 100, 94); // Prix total

  desktopColumns.push("42px");
  tabletColumns.push("40px");
  desktopMinWidth += 42;
  tabletMinWidth += 40;

  return {
    "--estimate-grid-desktop": desktopColumns.join(" "),
    "--estimate-grid-tablet": tabletColumns.join(" "),
    "--estimate-desktop-min-width": `${desktopMinWidth}px`,
    "--estimate-tablet-min-width": `${Math.max(tabletMinWidth, 900)}px`,
  } as CSSProperties;
}

const MOBILE_ESSENTIAL_COLUMNS = new Set<ColumnKey>();

export function resolveEstimateViewportColumns(
  visibleColumns: ReadonlySet<ColumnKey>,
  isMobileViewport: boolean
): ReadonlySet<ColumnKey> {
  return isMobileViewport ? MOBILE_ESSENTIAL_COLUMNS : visibleColumns;
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
  actionError = null,
  marginMultiplier,
  discountCents,
  taxRateBp,
  sectionCalculation,
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
  highlightedItemIds = EMPTY_HIGHLIGHTED_ITEM_IDS,
  headerRight,
  ribbonHeaderNode,
  ribbonAlertsNode,
  isFinalizationPanelOpen = false,
  onToggleFinalizationPanel,
  onOpenSettings,
}: EstimateEditorTableProps) {
  const columnVisibility = useColumnVisibility();
  const {
    widths: customColumnWidths,
    setColumnWidth,
    resetColumnWidth,
  } = useEstimateColumnWidths();
  const columnPreset = columnVisibility.preset;
  const setColumnPresetAuto = columnVisibility.setPresetAuto;
  const { mode: uiMode, isSimplified } = useUiMode();
  const isMobileViewport = useIsMobileViewport();
  const [showFullTableOnMobile, setShowFullTableOnMobile] = useState(false);
  const viewportVisibleColumns = resolveEstimateViewportColumns(
    columnVisibility.visibleColumns,
    isMobileViewport && !showFullTableOnMobile
  );
  const [unitDrafts, setUnitDrafts] = useState<Record<string, string>>({});
  const [supplyTypeDrafts, setSupplyTypeDrafts] = useState<Record<string, string>>({});
  const [isAssemblyPickerOpen, setIsAssemblyPickerOpen] = useState(false);
  const [isQuickTemplatePickerOpen, setIsQuickTemplatePickerOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [mobileEditorItemId, setMobileEditorItemId] = useState<string | null>(null);
  const [isItemConversionPending, setIsItemConversionPending] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] =
    useState<DeleteConfirmationState | null>(null);
  const [isDeletePending, setIsDeletePending] = useState(false);
  const [articleSheet, setArticleSheet] = useState<{
    itemId: string;
    mode: "view" | "associate";
  } | null>(null);
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Set<string>>(
    () => new Set()
  );
  const tableCardRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const columnResizeCleanupRef = useRef<(() => void) | null>(null);
  const insertionAnchorItemIdRef = useRef<string | null>(null);
  const appliedSuggestionContextByItemIdRef = useRef<
    Record<string, AppliedSuggestionContext>
  >({});
  const normalizedSearchTerm = useMemo(
    () => normalizeQuickFilterTerm(searchTerm),
    [searchTerm]
  );
  const itemByClientKey = useMemo(
    () =>
      new Map(
        items.map((item) => [getEstimateEditorItemClientKey(item), item]),
      ),
    [items],
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
    sectionCalculation,
    laborRateById,
    isLaborSplitEnabled,
  });
  const mobileEditorItem = mobileEditorItemId
    ? items.find(
        (item) => item.id === mobileEditorItemId && item.item_type === "line",
      ) ?? null
    : null;
  const mobileEditorLineIndex = mobileEditorItemId
    ? visibleLineIdList.indexOf(mobileEditorItemId)
    : -1;
  const handleOpenMobileEditor = useCallback(
    (itemId: string) => {
      if (!isMobileViewport) return;
      setMobileEditorItemId(itemId);
    },
    [isMobileViewport],
  );
  const handleGoToPreviousMobileLine = useCallback(() => {
    const previousLineId = visibleLineIdList[mobileEditorLineIndex - 1];
    if (previousLineId) {
      setMobileEditorItemId(previousLineId);
    }
  }, [mobileEditorLineIndex, visibleLineIdList]);
  const handleGoToNextMobileLine = useCallback(() => {
    const nextLineId = visibleLineIdList[mobileEditorLineIndex + 1];
    if (nextLineId) {
      setMobileEditorItemId(nextLineId);
    }
  }, [mobileEditorLineIndex, visibleLineIdList]);

  useEffect(() => {
    if (
      mobileEditorItemId !== null &&
      (!isMobileViewport || mobileEditorItem === null)
    ) {
      setMobileEditorItemId(null);
    }
  }, [isMobileViewport, mobileEditorItem, mobileEditorItemId]);

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
        viewportVisibleColumns,
        isLaborSplitEnabled,
        customColumnWidths,
      ),
    [customColumnWidths, viewportVisibleColumns, isLaborSplitEnabled],
  );

  const handleColumnResizeStart = useCallback(
    (
      columnId: EstimateColumnId,
      event: ReactPointerEvent<HTMLButtonElement>,
    ) => {
      event.preventDefault();
      columnResizeCleanupRef.current?.();

      const startX = event.clientX;
      const startWidth =
        event.currentTarget.parentElement?.getBoundingClientRect().width ?? 0;

      const handlePointerMove = (pointerEvent: PointerEvent) => {
        setColumnWidth(
          columnId,
          startWidth + pointerEvent.clientX - startX,
        );
      };
      const cleanup = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", cleanup);
        window.removeEventListener("pointercancel", cleanup);
        columnResizeCleanupRef.current = null;
      };

      columnResizeCleanupRef.current = cleanup;
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", cleanup, { once: true });
      window.addEventListener("pointercancel", cleanup, { once: true });
    },
    [setColumnWidth],
  );

  const handleColumnResizeKeyDown = useCallback(
    (
      columnId: EstimateColumnId,
      event: ReactKeyboardEvent<HTMLButtonElement>,
    ) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const currentWidth =
        event.currentTarget.parentElement?.getBoundingClientRect().width ?? 0;
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const step = event.shiftKey ? 24 : 8;
      setColumnWidth(columnId, currentWidth + direction * step);
    },
    [setColumnWidth],
  );

  useEffect(() => () => columnResizeCleanupRef.current?.(), []);

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
    const priceBreakdownSpan =
      (viewportVisibleColumns.has("ds") ? 1 : 0) +
      (viewportVisibleColumns.has("marge") ? 1 : 0) +
      (viewportVisibleColumns.has("marque") ? 1 : 0);
    if (isLaborSplitEnabled) {
      return {
        foStart,
        foSpan: 3,
        moStart: 7,
        moSpan: 7,
        puStart: 14 + priceBreakdownSpan,
      };
    }
    const foSpan =
      1 +
      (viewportVisibleColumns.has("supply_type") ? 1 : 0) +
      (viewportVisibleColumns.has("k_fo") ? 1 : 0);
    const moStart = foStart + foSpan;
    const moSpan =
      1 +
      (viewportVisibleColumns.has("h_mo_majoration") ? 1 : 0) +
      (viewportVisibleColumns.has("labor_role") ? 1 : 0) +
      (viewportVisibleColumns.has("k_mo") ? 1 : 0);
    const puStart = moStart + moSpan + priceBreakdownSpan;
    return { foStart, foSpan, moStart, moSpan, puStart };
  }, [viewportVisibleColumns, isLaborSplitEnabled]);

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

  const requestBulkDeleteSelection = useCallback(async () => {
    if (selectedLineCount === 0) return;
    setDeleteConfirmation({
      kind: "bulk",
      message:
        selectedLineCount > 1
          ? `Supprimer les ${selectedLineCount} lignes sélectionnées ?`
          : "Supprimer la ligne sélectionnée ?",
    });
  }, [selectedLineCount]);

  const requestDeleteItem = useCallback(
    (itemId: string) => {
      const item = items.find((candidate) => candidate.id === itemId);
      if (!item) return;

      const childrenByParentId = new Map<string, EstimateItem[]>();
      items.forEach((candidate) => {
        if (!candidate.parent_id) return;
        const children = childrenByParentId.get(candidate.parent_id) ?? [];
        children.push(candidate);
        childrenByParentId.set(candidate.parent_id, children);
      });

      let impactedCount = 0;
      const pendingIds = [itemId];
      const visitedIds = new Set<string>();
      while (pendingIds.length > 0) {
        const currentId = pendingIds.pop();
        if (!currentId || visitedIds.has(currentId)) continue;
        visitedIds.add(currentId);
        impactedCount += 1;
        (childrenByParentId.get(currentId) ?? []).forEach((child) => {
          pendingIds.push(child.id);
        });
      }

      const title = item.title.trim() || (item.item_type === "section" ? "Sans titre" : "Nouvelle ligne");
      const message =
        item.item_type === "section"
          ? impactedCount > 1
            ? `Supprimer la section « ${title} » et ses ${impactedCount - 1} élément${impactedCount - 1 > 1 ? "s" : ""} ?`
            : `Supprimer la section « ${title} » ?`
          : `Supprimer la ligne « ${title} » ?`;

      setDeleteConfirmation({ kind: "item", itemId, message });
    },
    [items]
  );

  const confirmDelete = useCallback(async () => {
    if (!deleteConfirmation || isDeletePending) return;

    setIsDeletePending(true);
    try {
      if (deleteConfirmation.kind === "item") {
        await Promise.resolve(onDeleteItem(deleteConfirmation.itemId));
      } else {
        await handleBulkDeleteSelection();
      }
      setDeleteConfirmation(null);
    } finally {
      setIsDeletePending(false);
    }
  }, [deleteConfirmation, handleBulkDeleteSelection, isDeletePending, onDeleteItem]);

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
    estimateCurrency: currency,
    itemById,
    isReadOnly,
    fetchSupplierComparison: fetchSupplierComparisons,
    onPatchItemWithSuggestionTracking: patchItemWithSuggestionTracking,
  });

  const activeArticleItem = articleSheet
    ? itemById.get(articleSheet.itemId) ?? null
    : null;

  const openArticleSheet = useCallback(
    (itemId: string, mode: "view" | "associate") => {
      const item = itemById.get(itemId);
      if (!item || item.item_type !== "line") return;
      if (mode === "view" && !item.product_id) return;
      if (mode === "associate" && isReadOnly) return;
      setArticleSheet({ itemId, mode });
      closeSupplierComparisonContextMenu();
    },
    [closeSupplierComparisonContextMenu, isReadOnly, itemById]
  );

  const handleAssociateArticle = useCallback(
    (suggestion: CataloguePriceSuggestion) => {
      if (!articleSheet || isReadOnly) return;
      const designation = suggestion.product_designation.trim();
      patchItemWithSuggestionTracking(
        articleSheet.itemId,
        {
          product_id: suggestion.product_id,
          title: designation || "Nouvelle ligne",
          description: designation || null,
          unit_price_ht_cents: suggestion.adjusted_unit_price_cents,
          selected_supplier_price_id: suggestion.supplier_price_id,
        },
        { persist: true }
      );
      setArticleSheet(null);
    },
    [articleSheet, isReadOnly, patchItemWithSuggestionTracking]
  );

  const handleDetachArticle = useCallback(() => {
    if (!articleSheet || isReadOnly) return;
    patchItemWithSuggestionTracking(
      articleSheet.itemId,
      { product_id: null },
      { persist: true }
    );
    setArticleSheet(null);
  }, [articleSheet, isReadOnly, patchItemWithSuggestionTracking]);

  useEffect(() => {
    if (!articleSheet) return;
    const item = itemById.get(articleSheet.itemId);
    if (!item || item.item_type !== "line") setArticleSheet(null);
  }, [articleSheet, itemById]);

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
    onBulkDeleteSelection: requestBulkDeleteSelection,
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
    // Partiel a dessein : toutes les colonnes ne sont pas des cellules
    // navigables. Le sous-detail de prix (ds / marge / marque) est en lecture
    // seule et ne participe pas a la navigation clavier.
    const columnKeyToSpreadsheetKey: Partial<Record<ColumnKey, string>> = {
      supply_type: "supply_type",
      k_fo: "k_fo",
      h_mo_majoration: "h_mo_majoration",
      labor_role: "labor_role",
      k_mo: "k_mo",
    };
    for (const [colKey, ssKey] of Object.entries(columnKeyToSpreadsheetKey)) {
      if (!viewportVisibleColumns.has(colKey as ColumnKey)) {
        hidden.add(ssKey);
      }
    }
    return hidden;
  }, [viewportVisibleColumns, isLaborSplitEnabled]);

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
        return {
          rowId: getEstimateEditorItemClientKey(item),
          columnKeys: allKeys,
        };
      }
      return {
        rowId: getEstimateEditorItemClientKey(item),
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
  const activeClientKey = spreadsheetNavigation.activeCell?.rowId ?? null;
  const insertionAnchorItemId = activeClientKey
    ? (itemByClientKey.get(activeClientKey)?.id ?? null)
    : null;

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
    if (!activeClientKey) return null;

    const activeItem = itemByClientKey.get(activeClientKey);
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
  }, [activeClientKey, itemByClientKey, itemById]);

  const openSectionContextMenuForRow = useCallback(
    (sectionId: string, position: { x: number; y: number }) => {
      if (isViewerMode) return;
      handleOpenSectionContextMenu(sectionId, position);
    },
    [handleOpenSectionContextMenu, isViewerMode]
  );

  const rowActionsContextValue = useMemo<EstimateEditorRowActionsContextValue>(
    () => ({
      onDeleteItem: requestDeleteItem,
      onOpenArticle: (itemId) => openArticleSheet(itemId, "view"),
      onAssociateArticle: (itemId) => openArticleSheet(itemId, "associate"),
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
      requestDeleteItem,
      onToggleOutlierDismiss,
      openArticleSheet,
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
          visibleColumns={viewportVisibleColumns}
          isHighlighted={highlightedItemIds.has(item.id)}
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
          onOpenMobileEditor={
            isMobileViewport && item.item_type === "line"
              ? handleOpenMobileEditor
              : undefined
          }
        />
      );
    },
    [
      bestSupplierPriceIdByItemId,
      canReorder,
      viewportVisibleColumns,
      detectedOutlierFlagsByItemId,
      dismissedOutlierFlagsByItemId,
      highlightedItemIds,
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
      handleOpenMobileEditor,
      isMobileViewport,
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
              <Fragment key={getEstimateEditorItemClientKey(item)}>
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

  const mobileListRows = useMemo<MobileEstimateListRow[]>(
    () =>
      visibleItemsInOrderForRender.map((item) => {
        const depth = depthMap.get(item.id) ?? 0;
        const sectionLevel =
          item.item_type === "section"
            ? (sectionLevelById.get(item.id) ?? depth + 1)
            : null;

        return {
          item,
          depth,
          itemNumber: itemNumberById[item.id] ?? null,
          unitValue: mergedUnitDrafts[item.id] ?? "",
          qualityFlags: qualityFlagsByItemId[item.id] ?? EMPTY_QUALITY_FLAGS,
          sectionTotalCents:
            item.item_type === "section"
              ? (getSectionTotals(item.id)?.totalHtCents ?? 0)
              : null,
          isCollapsed: collapsedSectionIds.has(item.id),
          canAddLine:
            sectionLevel !== null && sectionLevel <= resolvedMaxSectionDepth,
          canAddSection:
            sectionLevel !== null && sectionLevel < resolvedMaxSectionDepth,
          addLineLabel:
            sectionLevel !== null
              ? formatAddLineLabelForSectionLevel(sectionLevel)
              : "+ Ligne",
          addSectionLabel:
            sectionLevel !== null
              ? formatAddSectionLabelForLevel(sectionLevel + 1)
              : "+ Section",
        };
      }),
    [
      collapsedSectionIds,
      depthMap,
      getSectionTotals,
      itemNumberById,
      mergedUnitDrafts,
      qualityFlagsByItemId,
      resolvedMaxSectionDepth,
      sectionLevelById,
      visibleItemsInOrderForRender,
    ],
  );

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
            ribbonHeaderNode={ribbonHeaderNode}
            ribbonAlertsNode={ribbonAlertsNode}
            mobileListNode={
              isMobileViewport ? (
                <MobileEstimateList
                  rows={mobileListRows}
                  currency={currency}
                  lineCount={visibleLineIdList.length}
                  grandTotalCents={grandTotals.htTotal}
                  isReadOnly={isReadOnly}
                  showFullTable={showFullTableOnMobile}
                  columnPreset={columnVisibility.preset}
                  columnPresetLabels={columnVisibility.presetLabels}
                  onShowFullTableChange={setShowFullTableOnMobile}
                  onColumnPresetChange={columnVisibility.setPreset}
                  onOpenLine={handleOpenMobileEditor}
                  onToggleSection={toggleSectionCollapsed}
                  onExpandAllSections={handleExpandAllSections}
                  onCollapseAllSections={handleCollapseAllSections}
                  onAddLine={onAddLine}
                  onAddSection={onAddSection}
                  rootAddSectionLabel={formatAddSectionLabelForLevel(1)}
                />
              ) : undefined
            }
            showFullTableOnMobile={showFullTableOnMobile}
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
                onBulkDeleteSelection={requestBulkDeleteSelection}
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
                }}
                quickTemplatePickerNode={
                  isQuickTemplatePickerOpen ? (
                    <QuickTemplatePicker
                      isOpen
                      isReadOnly={isReadOnly}
                      onInsert={(templateId) =>
                        onInsertTemplate(templateId, insertionAnchorItemId)
                      }
                      onClose={() => setIsQuickTemplatePickerOpen(false)}
                    />
                  ) : null
                }
              />
            }
            activeLineBreadcrumb={activeLineBreadcrumb}
            actionError={actionError ?? null}
            scrollContainerRef={scrollContainerRef}
            isLaborSplitEnabled={isLaborSplitEnabled}
            dynamicGridStyle={dynamicGridStyle}
            onColumnResizeStart={handleColumnResizeStart}
            onColumnResizeKeyDown={handleColumnResizeKeyDown}
            onColumnResizeReset={resetColumnWidth}
            superHeaderSpans={superHeaderSpans}
            visibleColumns={viewportVisibleColumns}
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

          {isMobileViewport && mobileEditorItem ? (
            <MobileEstimateLineEditor
              open
              item={mobileEditorItem}
              itemNumber={itemNumberById[mobileEditorItem.id] ?? null}
              estimateCurrency={currency}
              unitValue={mergedUnitDrafts[mobileEditorItem.id] ?? ""}
              supplyTypeValue={mergedSupplyTypeDrafts[mobileEditorItem.id] ?? ""}
              laborRoles={laborRoles}
              isReadOnly={isReadOnly}
              isLaborSplitEnabled={isLaborSplitEnabled}
              canGoPrevious={mobileEditorLineIndex > 0}
              canGoNext={
                mobileEditorLineIndex >= 0 &&
                mobileEditorLineIndex < visibleLineIdList.length - 1
              }
              onOpenChange={(open) => !open && setMobileEditorItemId(null)}
              onGoPrevious={handleGoToPreviousMobileLine}
              onGoNext={handleGoToNextMobileLine}
            />
          ) : null}

          {sectionContextMenu ||
          duplicateSectionDialogSectionId ||
          saveAsAssemblyDialogSectionId ? (
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
              onDeleteSection={requestDeleteItem}
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
          ) : null}

      {supplierComparisonMenu ? (
        <EstimateEditorTableLineContextMenu
          itemId={supplierComparisonMenu.itemId}
          aid={itemById.get(supplierComparisonMenu.itemId)?.aid ?? null}
          hasAssociatedProduct={Boolean(
            itemById.get(supplierComparisonMenu.itemId)?.product_id
          )}
          x={supplierComparisonMenu.x}
          y={supplierComparisonMenu.y}
          isReadOnly={isReadOnly}
          isViewerMode={isViewerMode}
          isItemConversionPending={isItemConversionPending}
          onPatchAid={(itemId, aid, options) =>
            onPatchItem(itemId, { aid }, options)
          }
          onCompareSuppliers={(itemId) => {
            openSupplierComparisonPanel(itemId);
            closeSupplierComparisonContextMenu();
          }}
          onOpenArticle={(itemId) => openArticleSheet(itemId, "view")}
          onAssociateArticle={(itemId) => openArticleSheet(itemId, "associate")}
          onConvertToSection={(itemId) => {
            closeSupplierComparisonContextMenu();
            void handleConvertLineToSection(itemId);
          }}
        />
      ) : null}

      {articleSheet && activeArticleItem?.item_type === "line" ? (
        <EstimateArticleSheet
          isOpen
          mode={articleSheet.mode}
          versionId={versionId}
          lineTitle={activeArticleItem.title}
          productId={activeArticleItem.product_id ?? null}
          currency={currency}
          isReadOnly={isReadOnly}
          onClose={() => setArticleSheet(null)}
          onAssociate={handleAssociateArticle}
          onDetach={handleDetachArticle}
        />
      ) : null}

      <ConfirmModal
        open={deleteConfirmation !== null}
        title="Confirmer la suppression"
        message={deleteConfirmation?.message ?? ""}
        confirmLabel={isDeletePending ? "Suppression..." : "Supprimer"}
        variant="danger"
        confirmDisabled={isDeletePending}
        cancelDisabled={isDeletePending}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteConfirmation(null)}
      />

      {activeSupplierComparisonItem ? (
        <SupplierComparisonPanel
          isOpen
          itemTitle={activeSupplierComparisonItem.title}
          alternatives={activeSupplierComparison?.alternatives ?? []}
          bestSupplierPriceId={
            activeSupplierComparison?.best_supplier_price_id ?? null
          }
          isLoading={isSupplierComparisonLoading}
          error={supplierComparisonError}
          isReadOnly={isReadOnly}
          estimateCurrency={currency}
          onClose={handleCloseSupplierComparisonPanel}
          onSelectAlternative={handleSelectSupplierComparisonAlternative}
        />
      ) : null}

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

      {isAssemblyPickerOpen ? (
        <AssemblyPicker
          isOpen
          isReadOnly={isReadOnly}
          anchorItemId={insertionAnchorItemId}
          anchorLabel={activeLineBreadcrumb}
          onClose={() => setIsAssemblyPickerOpen(false)}
          onInsert={(assemblyId) =>
            onInsertAssembly(assemblyId, insertionAnchorItemId)
          }
        />
      ) : null}

      {isPastePreviewOpen ? (
        <PastePreviewDialog
          isOpen
          detectedFormat={detectedClipboardFormatForDialog}
          mapping={pasteMappingEntries}
          rows={pasteDialogRows}
          errors={pasteErrors}
          onMappingChange={handlePasteMappingChange}
          onToggleRow={handleTogglePasteRow}
          onConfirm={() => void handleConfirmPastePreview()}
          onClose={closePastePreview}
        />
      ) : null}

      {/* Spacer so table content isn't hidden behind the fixed bulk-selection bar */}
      {hasSelectedLines && <div className="h-16" />}
        </EstimateSpreadsheetProvider>
      </EstimateEditorRowActionsProvider>
    </EstimateEditorProvider>
  );
}
