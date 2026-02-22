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

type EstimateQualityFilter = "all_lines" | "with_anomalies" | EstimateQualityFlagKey;
type EstimateVirtualizationConfig = {
  enabled?: boolean;
  rowEstimate?: number;
  overscan?: number;
  maxHeight?: number;
  containerHeight?: number;
};

type EstimateEditorTableProps = {
  versionId: string;
  items: EstimateItem[];
  categories: EstimateCategory[];
  supplyTypes: SupplyType[];
  laborRoles: LaborRole[];
  suggestionRules: SuggestionRule[];
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
  onPatchItem: (
    itemId: string,
    patch: ItemPatch,
    options?: { persist?: boolean }
  ) => void;
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
  scrollToItemId?: string | null;
  onScrollToItemHandled?: () => void;
  virtualization?: EstimateVirtualizationConfig;
};

const DEFAULT_UNITS = ["u", "ml", "m2", "ens"];
const EMPTY_QUALITY_FLAGS: EstimateQualityFlagKey[] = [];
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

export function EstimateEditorTable({
  versionId,
  items,
  categories,
  supplyTypes,
  laborRoles,
  suggestionRules,
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
  onPatchItem,
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
  scrollToItemId,
  onScrollToItemHandled,
  virtualization,
}: EstimateEditorTableProps) {
  const [unitDrafts, setUnitDrafts] = useState<Record<string, string>>({});
  const [supplyTypeDrafts, setSupplyTypeDrafts] = useState<Record<string, string>>({});
  const [isAssemblyPickerOpen, setIsAssemblyPickerOpen] = useState(false);
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
  const canReorder = !isReadOnly && qualityFilter === "all_lines";

  const orderedRules = useMemo(
    () => [...suggestionRules].sort((a, b) => a.position - b.position),
    [suggestionRules]
  );

  const scoringRules = useMemo(() => {
    return orderedRules.map((rule) => {
      const enrichedRule: SuggestionRule & Record<string, unknown> = { ...rule };
      const usageCountOverride = usageCountOverrideByRuleId[rule.id];
      const lastUsedAtOverride = lastUsedAtOverrideByRuleId[rule.id];

      if (usageCountOverride !== undefined) {
        enrichedRule.usage_count = usageCountOverride;
      }
      if (lastUsedAtOverride !== undefined) {
        enrichedRule.last_used_at = lastUsedAtOverride;
      }

      return enrichedRule;
    });
  }, [lastUsedAtOverrideByRuleId, orderedRules, usageCountOverrideByRuleId]);

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

  const handleSupplyTypeCommit = useCallback(
    (itemId: string) => {
      if (isReadOnly) return;
      const value = (mergedSupplyTypeDrafts[itemId] ?? "").trim();
      if (!value) {
        onPatchItem(itemId, { supply_type_id: null }, { persist: true });
        return;
      }

      const existing = supplyTypeByLowerName.get(value.toLowerCase());
      if (existing) {
        onPatchItem(itemId, { supply_type_id: existing.id }, { persist: true });
        return;
      }

      onPatchItem(itemId, { supply_type_id: null }, { persist: true });
    },
    [isReadOnly, mergedSupplyTypeDrafts, onPatchItem, supplyTypeByLowerName]
  );

  const handleUnitCommit = useCallback(
    (itemId: string) => {
      if (isReadOnly) return;
      const value = (mergedUnitDrafts[itemId] ?? "").trim();
      onPatchItem(itemId, { description: value || null }, { persist: true });
    },
    [isReadOnly, mergedUnitDrafts, onPatchItem]
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

      onPatchItem(activeSupplierComparisonItem.id, patch, { persist: true });
      setSupplierComparisonPanelItemId(null);
    },
    [activeSupplierComparisonItem, isReadOnly, onPatchItem]
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
    if (!supplierComparisonPanelItemId) return;
    const item = itemById.get(supplierComparisonPanelItemId);
    if (!item || item.item_type !== "line") {
      setSupplierComparisonPanelItemId(null);
    }
  }, [itemById, supplierComparisonPanelItemId]);

  useEstimateKeyboardShortcuts({
    tableCardRef,
    hasSelectedLines,
    visibleLineIdList,
    isReadOnly,
    isUndoRedoBusy,
    canUndo,
    canRedo,
    isSupplierComparisonMenuOpen: supplierComparisonMenu !== null,
    onResolveShortcutScope: resolveEstimateTableShortcutScope,
    selectAllVisibleLines,
    clearLineSelection,
    onBulkDeleteSelection: handleBulkDeleteSelection,
    onCopySelectedRowsToClipboard: copySelectedRowsToClipboard,
    onUndo,
    onRedo,
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
      if (suggestion.rule.category_id) {
        patch.category_id = suggestion.rule.category_id;
        const category = categoryById.get(suggestion.rule.category_id);
        if (category) {
          const matchedSupplyType = supplyTypeByLowerName.get(category.name.toLowerCase());
          if (matchedSupplyType) {
            patch.supply_type_id = matchedSupplyType.id;
          }
          setSupplyTypeDrafts((prev) => ({
            ...prev,
            [item.id]: category.name,
          }));
        }
      }
      if (suggestion.rule.k_fo !== null) patch.k_fo = suggestion.rule.k_fo;
      if (suggestion.rule.k_mo !== null) patch.k_mo = suggestion.rule.k_mo;
      if (suggestion.rule.labor_role_id) {
        patch.labor_role_id = suggestion.rule.labor_role_id;
      }

      if (Object.keys(patch).length === 0) return;

      onPatchItem(item.id, patch, { persist: true });
      setDismissedSuggestionsByItemId((prev) =>
        addDismissedSuggestion(prev, item.id, suggestion.rule.id)
      );
      void sendSuggestionFeedback(item, suggestion, "accept");
    },
    [categoryById, isReadOnly, onPatchItem, sendSuggestionFeedback, supplyTypeByLowerName]
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
        parts.push(`Type FO: ${category?.name ?? "Categorie inconnue"}`);
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
    [categoryById, roleById]
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
          const rule = suggestion.rule as SuggestionRule;
          const parts = buildSuggestionParts(rule);
          return {
            rule,
            score: suggestion.score,
            matchKind: suggestion.matchKind,
            matchedKeyword: suggestion.matchedKeyword,
            usageCount: suggestion.usageCount,
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

  const spreadsheetNavigationRows = useMemo(() => {
    if (!hasVisibleRows) return [] as SpreadsheetNavigationRow[];

    return visibleItemsInOrder.map((item) => ({
      rowId: item.id,
      columnKeys: getSpreadsheetColumnKeys(item.item_type, isLaborSplitEnabled),
    }));
  }, [hasVisibleRows, isLaborSplitEnabled, visibleItemsInOrder]);

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
          onPatchItem={onPatchItem}
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
        />
      );
    },
    [
      bestSupplierPriceIdByItemId,
      canReorder,
      detectedOutlierFlagsByItemId,
      dismissedOutlierFlagsByItemId,
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
      onPatchItem,
      onToggleOutlierDismiss,
      outlierActionPendingByItemId,
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

      <div
        className={`estimate-table mt-6${isLaborSplitEnabled ? " estimate-table--labor-split" : ""}`}
      >
        <div className="estimate-table__head">
          <div>
            <input
              type="checkbox"
              className="estimate-line-checkbox"
              checked={allVisibleSelected}
              onChange={(event) => toggleAllVisibleLines(event.target.checked)}
              disabled={isReadOnly || visibleLineIdList.length === 0}
              aria-label="Selectionner toutes les lignes visibles"
            />
          </div>
          <div>Designation</div>
          <div>Qte</div>
          <div>U</div>
          <div>PR. FO</div>
          <div>Type FO</div>
          <div>K FO</div>
          {isLaborSplitEnabled ? (
            <>
              <div>Majoration MO (%)</div>
              <div>h MO atelier</div>
              <div>Type MO atelier</div>
              <div>K MO atelier</div>
              <div>h MO chantier</div>
              <div>Type MO chantier</div>
              <div>K MO chantier</div>
            </>
          ) : (
            <>
              <div>h MO</div>
              <div>Majoration MO (%)</div>
              <div>Type MO</div>
              <div>K MO</div>
            </>
          )}
          <div>P.U.</div>
          <div>Prix total</div>
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
      </div>

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
