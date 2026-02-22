"use client";
/* eslint-disable react-hooks/refs */

import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import {
  computeSectionTotals,
  UNASSIGNED_SUPPLY_TYPE_KEY,
  type EstimateItemRecord,
  type SectionTotals,
} from "@/lib/estimate-calculations";
import {
  sendEstimateSuggestionRuleFeedback,
} from "@/lib/estimates/client";
import { AssemblyPicker } from "@/components/estimates/AssemblyPicker";
import { EditableCell } from "@/components/estimates/EditableCell";
import {
  useSpreadsheetNavigation,
  type SpreadsheetCell,
  type SpreadsheetNavigationRow,
} from "@/hooks/useSpreadsheetNavigation";
import {
  useMultiSelect,
  type MultiSelectItemInteraction,
} from "@/hooks/useMultiSelect";
import { useVirtualList } from "@/hooks/useVirtualList";
import {
  ESTIMATE_QUALITY_FLAG_KEYS,
  ESTIMATE_QUALITY_FLAG_META,
  type EstimateQualityFlagCounts,
  type EstimateQualityFlagKey,
  type EstimateQualityFlagsByItemId,
} from "@/lib/estimate-quality";
import {
  ESTIMATE_OUTLIER_FLAG_KEYS,
  type EstimateOutlierFlagKey,
  type EstimateOutlierFlagsByItemId,
  type EstimateOutlierMethod,
} from "@/lib/estimates/outlier-detection";
import {
  rankSuggestions,
  type SuggestionMatchKind,
} from "@/lib/estimates/suggestion-scoring";
import { formatEUR, parseEuroToCents } from "@/lib/money";
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
  bulkSuggestionEligibleCount: number;
  onOpenBulkSuggestDialog: () => void;
  onReorder: (parentId: string | null, orderedIds: string[]) => void;
  virtualization?: EstimateVirtualizationConfig;
};

const ROOT_KEY = "root";
const DEFAULT_UNITS = ["u", "ml", "m2", "ens"];
const DEFAULT_VIRTUAL_ROW_ESTIMATE = 56;
const DEFAULT_VIRTUAL_OVERSCAN = 8;
const DEFAULT_VIRTUAL_MAX_HEIGHT = 640;
const EMPTY_ITEMS: EstimateItem[] = [];
const EMPTY_QUALITY_FLAGS: EstimateQualityFlagKey[] = [];
const TEXT_LIKE_INPUT_TYPES = new Set([
  "",
  "text",
  "search",
  "url",
  "tel",
  "email",
  "password",
  "number",
  "date",
  "datetime-local",
  "month",
  "time",
  "week",
]);
const SUGGESTION_SCORE_MAX = 5;
const CATALOGUE_SUGGESTIONS_DEBOUNCE_MS = 300;
const SPREADSHEET_COLUMN_KEYS = {
  title: "title",
  quantity: "quantity",
  unit: "unit",
  unitPrice: "unit_price",
  supplyType: "supply_type",
  kFo: "k_fo",
  hMo: "h_mo",
  hMoAtelier: "h_mo_atelier",
  laborRoleAtelier: "labor_role_atelier",
  kMoAtelier: "k_mo_atelier",
  hMoChantier: "h_mo_chantier",
  laborRoleChantier: "labor_role_chantier",
  kMoChantier: "k_mo_chantier",
  hMoMajoration: "h_mo_majoration",
  laborRole: "labor_role",
  kMo: "k_mo",
  pu: "pu_ht",
  total: "line_total_ht",
};
const SECTION_SPREADSHEET_COLUMN_KEYS = [SPREADSHEET_COLUMN_KEYS.title];
const LINE_SPREADSHEET_COLUMN_KEYS = [
  SPREADSHEET_COLUMN_KEYS.title,
  SPREADSHEET_COLUMN_KEYS.quantity,
  SPREADSHEET_COLUMN_KEYS.unit,
  SPREADSHEET_COLUMN_KEYS.unitPrice,
  SPREADSHEET_COLUMN_KEYS.supplyType,
  SPREADSHEET_COLUMN_KEYS.kFo,
  SPREADSHEET_COLUMN_KEYS.hMo,
  SPREADSHEET_COLUMN_KEYS.hMoMajoration,
  SPREADSHEET_COLUMN_KEYS.laborRole,
  SPREADSHEET_COLUMN_KEYS.kMo,
  SPREADSHEET_COLUMN_KEYS.pu,
  SPREADSHEET_COLUMN_KEYS.total,
];
const LINE_SPREADSHEET_COLUMN_KEYS_LABOR_SPLIT = [
  SPREADSHEET_COLUMN_KEYS.title,
  SPREADSHEET_COLUMN_KEYS.quantity,
  SPREADSHEET_COLUMN_KEYS.unit,
  SPREADSHEET_COLUMN_KEYS.unitPrice,
  SPREADSHEET_COLUMN_KEYS.supplyType,
  SPREADSHEET_COLUMN_KEYS.kFo,
  SPREADSHEET_COLUMN_KEYS.hMoMajoration,
  SPREADSHEET_COLUMN_KEYS.hMoAtelier,
  SPREADSHEET_COLUMN_KEYS.laborRoleAtelier,
  SPREADSHEET_COLUMN_KEYS.kMoAtelier,
  SPREADSHEET_COLUMN_KEYS.hMoChantier,
  SPREADSHEET_COLUMN_KEYS.laborRoleChantier,
  SPREADSHEET_COLUMN_KEYS.kMoChantier,
  SPREADSHEET_COLUMN_KEYS.pu,
  SPREADSHEET_COLUMN_KEYS.total,
];
const SUGGESTION_MATCH_LABELS: Record<SuggestionMatchKind, string> = {
  exact: "exact",
  partial: "partiel",
  fuzzy: "fuzzy",
};
const QUALITY_BADGE_CLASSNAMES: Record<EstimateQualityFlagKey, string> = {
  missing_price: "border-rose-200 bg-rose-50 text-rose-700",
  missing_quantity: "border-amber-200 bg-amber-50 text-amber-700",
  missing_labor_time: "border-orange-200 bg-orange-50 text-orange-700",
  missing_labor_role: "border-red-200 bg-red-50 text-red-700",
  price_outlier: "border-orange-200 bg-orange-50 text-orange-700",
  quantity_outlier: "border-orange-200 bg-orange-50 text-orange-700",
};

type SupplierAlternativeKind =
  | "best_price"
  | "most_recent"
  | "preferred_supplier";

type SupplierAlternative = {
  kind: SupplierAlternativeKind;
  supplier_price_id: string;
  supplier_id: string;
  supplier_name: string;
  unit_price_cents: number;
  adjusted_unit_price_cents: number;
  currency: string | null;
  supplier_reference: string | null;
  unit: string | null;
  updated_at: string | null;
  is_stale: boolean;
  catalogue_url: string | null;
};

type CataloguePriceSuggestion = {
  supplier_price_id: string;
  product_id: string;
  product_designation: string;
  product_reference: string | null;
  supplier_id: string;
  supplier_name: string;
  supplier_reference: string | null;
  unit: string | null;
  unit_price_cents: number;
  adjusted_unit_price_cents: number;
  currency: string | null;
  updated_at: string | null;
  is_stale: boolean;
  stale_days: number;
  relevance_score: number;
  has_material_index_adjustment: boolean;
  material_index_code: string | null;
  material_index_value: number | null;
  catalogue_url: string | null;
  alternatives: SupplierAlternative[];
};

type SuggestPricesResponse = {
  query: string;
  stale_price_days: number;
  suggestions: CataloguePriceSuggestion[];
};

function parseEstimateQualityFilter(value: string): EstimateQualityFilter {
  if (value === "all_lines" || value === "with_anomalies") {
    return value;
  }
  if (ESTIMATE_QUALITY_FLAG_KEYS.includes(value as EstimateQualityFlagKey)) {
    return value as EstimateQualityFlagKey;
  }
  return "all_lines";
}

function parseOutlierMethod(value: string): EstimateOutlierMethod {
  return value === "zscore" ? "zscore" : "iqr";
}

function matchesQualityFilter(
  qualityFlags: EstimateQualityFlagKey[],
  filter: EstimateQualityFilter
) {
  if (filter === "all_lines") return true;
  if (filter === "with_anomalies") return qualityFlags.length > 0;
  return qualityFlags.includes(filter);
}

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

function getParentKey(id: string | null) {
  return id ?? ROOT_KEY;
}

function formatCentsInput(cents: number | null) {
  if (!Number.isFinite(cents ?? NaN)) return "";
  return ((cents ?? 0) / 100).toFixed(2);
}

function parseNumberInput(value: string) {
  const normalized = value.replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMajorationPercentInput(value: number | null | undefined) {
  if (!Number.isFinite(value ?? NaN)) return "100";
  const percent = (value ?? 1) * 100;
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(2);
}

function parseMajorationPercentToCoefficient(value: string) {
  return Math.max(parseNumberInput(value) / 100, 0);
}

function formatNumberDisplay(
  value: number,
  options?: { minDecimals?: number; maxDecimals?: number }
) {
  const minDecimals = options?.minDecimals ?? 0;
  const maxDecimals = options?.maxDecimals ?? minDecimals;
  const formatter = new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: minDecimals,
    maximumFractionDigits: maxDecimals,
  });
  return formatter.format(value);
}

function formatCompactDate(value: string | null | undefined) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }

  return date.toLocaleDateString("fr-FR");
}

function toAlternativeKindLabel(kind: SupplierAlternativeKind) {
  switch (kind) {
    case "best_price":
      return "Meilleur prix";
    case "most_recent":
      return "Plus recent";
    case "preferred_supplier":
      return "Fournisseur prefere";
    default:
      return kind;
  }
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

async function fetchCatalogueSuggestions(
  versionId: string,
  query: string,
  signal: AbortSignal
): Promise<CataloguePriceSuggestion[]> {
  const response = await fetch(
    `/api/estimates/${versionId}/suggest-prices?q=${encodeURIComponent(query)}`,
    {
      method: "GET",
      cache: "no-store",
      signal,
    }
  );

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(
      resolveApiErrorMessage(payload, "Impossible de charger les suggestions catalogue.")
    );
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  const envelope = payload as {
    ok?: boolean;
    data?: SuggestPricesResponse;
  };
  const suggestions =
    envelope.ok && Array.isArray(envelope.data?.suggestions)
      ? envelope.data.suggestions
      : [];

  return suggestions.slice(0, 10);
}

function toFiniteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toNonEmptyString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readLaborSplitFields(
  source: EstimateItem | Record<string, unknown>
): Required<LaborSplitItemFields> {
  const record = source as Record<string, unknown>;
  return {
    h_mo_atelier: toFiniteNumber(record.h_mo_atelier, 0),
    k_mo_atelier: toFiniteNumber(record.k_mo_atelier, 1),
    labor_role_atelier_id: toNonEmptyString(record.labor_role_atelier_id),
    h_mo_chantier: toFiniteNumber(record.h_mo_chantier, 0),
    k_mo_chantier: toFiniteNumber(record.k_mo_chantier, 1),
    labor_role_chantier_id: toNonEmptyString(record.labor_role_chantier_id),
  };
}

function getSpreadsheetColumnKeys(
  itemType: EstimateItem["item_type"],
  isLaborSplitEnabled: boolean
) {
  return itemType === "section"
    ? SECTION_SPREADSHEET_COLUMN_KEYS
    : isLaborSplitEnabled
      ? LINE_SPREADSHEET_COLUMN_KEYS_LABOR_SPLIT
      : LINE_SPREADSHEET_COLUMN_KEYS;
}

function isTextEditingTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }

  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }

  if (target instanceof HTMLInputElement) {
    return TEXT_LIKE_INPUT_TYPES.has(target.type);
  }

  if (target instanceof HTMLElement && target.isContentEditable) {
    return true;
  }

  return Boolean(
    target.closest(
      "[contenteditable=''],[contenteditable='true'],[contenteditable='plaintext-only']"
    )
  );
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

type SortableReturn = ReturnType<typeof useSortable>;
type SpreadsheetNavigationState = ReturnType<typeof useSpreadsheetNavigation>;
type DragHandleProps = {
  listeners?: SortableReturn["listeners"];
  attributes?: SortableReturn["attributes"];
  disabled?: boolean;
};

function toCellClassName(
  navigation: SpreadsheetNavigationState,
  cell: SpreadsheetCell,
  baseClassName: string
) {
  const classNames = [baseClassName, "estimate-cell--focusable"];

  if (navigation.isCellActive(cell)) {
    classNames.push("estimate-cell--active");
  }

  if (navigation.isCellEditing(cell)) {
    classNames.push("estimate-cell--editing");
  }

  return classNames.join(" ");
}

function toCellKeyDownHandler(
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
) {
  return (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }

    onKeyDown(event);
  };
}

const DragHandle = memo(function DragHandle({
  listeners,
  attributes,
  disabled,
}: DragHandleProps) {
  return (
    <button
      type="button"
      className="estimate-drag-handle"
      {...attributes}
      {...listeners}
      disabled={disabled}
      aria-label="Glisser pour reordonner"
    >
      <svg viewBox="0 0 16 16" fill="currentColor">
        <circle cx="5" cy="4" r="1.2" />
        <circle cx="11" cy="4" r="1.2" />
        <circle cx="5" cy="8" r="1.2" />
        <circle cx="11" cy="8" r="1.2" />
        <circle cx="5" cy="12" r="1.2" />
        <circle cx="11" cy="12" r="1.2" />
      </svg>
    </button>
  );
});

type SortableRowProps = {
  versionId: string;
  item: EstimateItem;
  depth: number;
  unitValue: string;
  supplyTypeValue: string;
  qualityFlags: EstimateQualityFlagKey[];
  detectedOutlierFlags: EstimateOutlierFlagKey[];
  dismissedOutlierFlags: EstimateOutlierFlagKey[];
  supplyTypeById: Map<string, SupplyType>;
  laborRoles: LaborRole[];
  navigation: SpreadsheetNavigationState;
  isLineSelected: boolean;
  onAddSection: (parentId: string | null) => void;
  onAddLine: (parentId: string | null) => void;
  onDeleteItem: (itemId: string) => void;
  onPatchItem: (
    itemId: string,
    patch: ItemPatch,
    options?: { persist?: boolean }
  ) => void;
  onUnitChange: (itemId: string, value: string) => void;
  onUnitCommit: (itemId: string) => void;
  onSupplyTypeChange: (itemId: string, value: string) => void;
  onSupplyTypeCommit: (itemId: string) => void;
  onToggleOutlierDismiss: (
    itemId: string,
    flagKey: EstimateOutlierFlagKey,
    dismissed: boolean
  ) => void;
  onLineSelectionInteraction: (interaction: MultiSelectItemInteraction) => void;
  sectionTotals: SectionTotals | null;
  isDragDisabled: boolean;
  isOutlierActionPending: boolean;
  isReadOnly: boolean;
  isLaborSplitEnabled: boolean;
};

const SortableRow = memo(function SortableRow({
  versionId,
  item,
  depth,
  unitValue,
  supplyTypeValue,
  qualityFlags,
  detectedOutlierFlags,
  dismissedOutlierFlags,
  supplyTypeById,
  laborRoles,
  navigation,
  isLineSelected,
  onAddSection,
  onAddLine,
  onDeleteItem,
  onPatchItem,
  onUnitChange,
  onUnitCommit,
  onSupplyTypeChange,
  onSupplyTypeCommit,
  onToggleOutlierDismiss,
  onLineSelectionInteraction,
  sectionTotals,
  isDragDisabled,
  isOutlierActionPending,
  isReadOnly,
  isLaborSplitEnabled,
}: SortableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    data: { parentId: item.parent_id ?? null },
    disabled: isReadOnly || isDragDisabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.65 : 1,
  };

  const indentStyle = {
    paddingLeft: `${depth * 20}px`,
  };

  const titleCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.title,
  };
  const titleCellProps = navigation.getCellProps(titleCell);
  const titleEditorProps = navigation.getEditorProps<HTMLInputElement>(titleCell);
  const [isTitleFocused, setIsTitleFocused] = useState(false);
  const [catalogueSuggestions, setCatalogueSuggestions] = useState<
    CataloguePriceSuggestion[]
  >([]);
  const [isCatalogueLoading, setIsCatalogueLoading] = useState(false);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [activeCatalogueSuggestionIndex, setActiveCatalogueSuggestionIndex] =
    useState(0);
  const catalogueBlurTimeoutRef = useRef<number | null>(null);
  const catalogueAbortRef = useRef<AbortController | null>(null);
  const catalogueListboxId = `estimate-catalogue-suggestions-${item.id}`;

  const clearCatalogueBlurTimeout = useCallback(() => {
    if (catalogueBlurTimeoutRef.current === null) return;
    window.clearTimeout(catalogueBlurTimeoutRef.current);
    catalogueBlurTimeoutRef.current = null;
  }, []);

  useEffect(() => {
    if (item.item_type !== "line") {
      setCatalogueSuggestions([]);
      setCatalogueError(null);
      setIsCatalogueLoading(false);
      return;
    }

    if (!versionId || !isTitleFocused || isReadOnly) {
      setIsCatalogueLoading(false);
      setCatalogueError(null);
      if (!isTitleFocused) {
        setCatalogueSuggestions([]);
      }
      return;
    }

    const normalizedQuery = item.title.trim();
    if (normalizedQuery.length < 2) {
      setCatalogueSuggestions([]);
      setCatalogueError(null);
      setIsCatalogueLoading(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (catalogueAbortRef.current) {
        catalogueAbortRef.current.abort();
      }

      const abortController = new AbortController();
      catalogueAbortRef.current = abortController;
      setIsCatalogueLoading(true);
      setCatalogueError(null);

      void fetchCatalogueSuggestions(
        versionId,
        normalizedQuery,
        abortController.signal
      )
        .then((suggestions) => {
          setCatalogueSuggestions(suggestions);
          setActiveCatalogueSuggestionIndex(0);
        })
        .catch((error: unknown) => {
          if (abortController.signal.aborted) return;
          setCatalogueSuggestions([]);
          setCatalogueError(
            error instanceof Error
              ? error.message
              : "Impossible de charger les suggestions catalogue."
          );
        })
        .finally(() => {
          if (!abortController.signal.aborted) {
            setIsCatalogueLoading(false);
          }
        });
    }, CATALOGUE_SUGGESTIONS_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
      if (catalogueAbortRef.current) {
        catalogueAbortRef.current.abort();
      }
    };
  }, [isReadOnly, isTitleFocused, item.item_type, item.title, versionId]);

  useEffect(() => {
    setActiveCatalogueSuggestionIndex((previous) => {
      if (catalogueSuggestions.length === 0) return 0;
      return Math.min(previous, catalogueSuggestions.length - 1);
    });
  }, [catalogueSuggestions.length]);

  useEffect(() => {
    return () => {
      clearCatalogueBlurTimeout();
      if (catalogueAbortRef.current) {
        catalogueAbortRef.current.abort();
      }
    };
  }, [clearCatalogueBlurTimeout]);

  const showCatalogueSuggestions =
    item.item_type === "line" &&
    isTitleFocused &&
    (catalogueSuggestions.length > 0 || isCatalogueLoading || Boolean(catalogueError));

  const applyCatalogueSuggestion = useCallback(
    (suggestion: CataloguePriceSuggestion, alternative?: SupplierAlternative) => {
      if (isReadOnly || item.item_type !== "line") return;

      const selectedSupplierPriceId =
        alternative?.supplier_price_id ?? suggestion.supplier_price_id;
      const selectedDescription = suggestion.product_designation.trim();
      const selectedAdjustedUnitPrice =
        alternative?.adjusted_unit_price_cents ?? suggestion.adjusted_unit_price_cents;

      const patch: ItemPatch = {
        description: selectedDescription.length > 0 ? selectedDescription : null,
        unit_price_ht_cents: selectedAdjustedUnitPrice,
        selected_supplier_price_id: selectedSupplierPriceId,
      };

      onPatchItem(item.id, patch, { persist: true });
      setIsTitleFocused(false);
    },
    [isReadOnly, item.id, item.item_type, onPatchItem]
  );

  const handleLineTitleFocus = useCallback(
    (event: FocusEvent<HTMLInputElement>) => {
      clearCatalogueBlurTimeout();
      setIsTitleFocused(true);
      titleEditorProps.onFocus(event);
    },
    [clearCatalogueBlurTimeout, titleEditorProps]
  );

  const handleLineTitleBlur = useCallback(
    (event: FocusEvent<HTMLInputElement>) => {
      titleEditorProps.onBlur(event);
      clearCatalogueBlurTimeout();
      catalogueBlurTimeoutRef.current = window.setTimeout(() => {
        setIsTitleFocused(false);
      }, 120);

      const nextTitle = event.target.value.trim() || "Nouvelle ligne";
      onPatchItem(item.id, { title: nextTitle }, { persist: true });
    },
    [clearCatalogueBlurTimeout, item.id, onPatchItem, titleEditorProps]
  );

  const handleLineTitleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (showCatalogueSuggestions && catalogueSuggestions.length > 0) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActiveCatalogueSuggestionIndex((previous) =>
            Math.min(previous + 1, catalogueSuggestions.length - 1)
          );
          return;
        }

        if (event.key === "ArrowUp") {
          event.preventDefault();
          setActiveCatalogueSuggestionIndex((previous) => Math.max(previous - 1, 0));
          return;
        }

        if (event.key === "Enter") {
          const activeSuggestion = catalogueSuggestions[activeCatalogueSuggestionIndex];
          if (activeSuggestion) {
            event.preventDefault();
            void applyCatalogueSuggestion(activeSuggestion);
            return;
          }
        }
      }

      if (event.key === "Escape" && showCatalogueSuggestions) {
        event.preventDefault();
        setIsTitleFocused(false);
        return;
      }

      titleEditorProps.onKeyDown(event);
    },
    [
      activeCatalogueSuggestionIndex,
      applyCatalogueSuggestion,
      catalogueSuggestions,
      showCatalogueSuggestions,
      titleEditorProps,
    ]
  );

  if (item.item_type === "section") {
    const supplyTypeTotals = sectionTotals?.supplyTypeFoTotalsCents ?? {};
    const supplyTypeEntries = Object.entries(supplyTypeTotals).sort(
      ([, leftValue], [, rightValue]) => rightValue - leftValue
    );

    return (
      <div
        ref={setNodeRef}
        style={style}
        className="estimate-row estimate-row--section"
        role="row"
      >
        <div className="estimate-cell estimate-cell--selection" />
        <div
          {...titleCellProps}
          onKeyDown={toCellKeyDownHandler(titleCellProps.onKeyDown)}
          className={toCellClassName(
            navigation,
            titleCell,
            "estimate-cell estimate-cell--designation"
          )}
          style={indentStyle}
        >
          <DragHandle
            listeners={listeners}
            attributes={attributes}
            disabled={isReadOnly || isDragDisabled}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <input
              className="estimate-input estimate-input--title"
              ref={titleEditorProps.ref}
              tabIndex={titleEditorProps.tabIndex}
              value={item.title}
              disabled={isReadOnly}
              onFocus={titleEditorProps.onFocus}
              onKeyDown={titleEditorProps.onKeyDown}
              onChange={(event) =>
                onPatchItem(item.id, { title: event.target.value }, { persist: false })
              }
              onBlur={(event) => {
                titleEditorProps.onBlur(event);
                const nextTitle = event.target.value.trim() || "Sans titre";
                onPatchItem(item.id, { title: nextTitle }, { persist: true });
              }}
            />
            <div className="estimate-section-totals">
              <span className="estimate-section-total-chip">
                FO {formatEUR(sectionTotals?.foTotalCents ?? 0)}
              </span>
              {isLaborSplitEnabled ? (
                <>
                  <span className="estimate-section-total-chip">
                    MO atelier {formatEUR(sectionTotals?.moAtelierTotalCents ?? 0)}
                  </span>
                  <span className="estimate-section-total-chip">
                    MO chantier {formatEUR(sectionTotals?.moChantierTotalCents ?? 0)}
                  </span>
                </>
              ) : (
                <span className="estimate-section-total-chip">
                  MO {formatEUR(sectionTotals?.moTotalCents ?? 0)}
                </span>
              )}
              <span className="estimate-section-total-chip">
                HT {formatEUR(sectionTotals?.totalHtCents ?? 0)}
              </span>
              <span className="estimate-section-total-chip">
                TTC {formatEUR(sectionTotals?.totalTtcCents ?? 0)}
              </span>
              {supplyTypeEntries.map(([supplyTypeId, cents]) => {
                const label =
                  supplyTypeId === UNASSIGNED_SUPPLY_TYPE_KEY
                    ? "Non classe"
                    : (supplyTypeById.get(supplyTypeId)?.name ?? "Type inconnu");
                return (
                  <span
                    key={`${item.id}:supply_type:${supplyTypeId}`}
                    className="estimate-section-total-chip"
                  >
                    {label} {formatEUR(cents)}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
        <div className="estimate-cell estimate-cell--section-actions">
          <div className="estimate-row-actions">
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => onAddLine(item.id)}
              disabled={isReadOnly}
            >
              + Ligne
            </button>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => onAddSection(item.id)}
              disabled={isReadOnly}
            >
              + Sous-chapitre
            </button>
            <button
              className="btn btn-danger btn-sm"
              type="button"
              onClick={() => onDeleteItem(item.id)}
              disabled={isReadOnly}
            >
              Supprimer
            </button>
          </div>
        </div>
      </div>
    );
  }

  const lineTotal = item.line_total_ht_cents ?? 0;
  const kFoValue = item.k_fo ?? 1;
  const hMoValue = item.h_mo ?? 0;
  const splitFields = readLaborSplitFields(item);
  const hMoAtelierValue = splitFields.h_mo_atelier ?? "";
  const kMoAtelierValue = splitFields.k_mo_atelier ?? "";
  const hMoChantierValue = splitFields.h_mo_chantier ?? "";
  const kMoChantierValue = splitFields.k_mo_chantier ?? "";
  const hMoMajorationPercent = formatMajorationPercentInput(item.h_mo_majoration);
  const kMoValue = item.k_mo ?? 1;
  const quantityCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.quantity,
  };
  const unitCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.unit,
  };
  const unitCellProps = navigation.getCellProps(unitCell);
  const unitEditorProps = navigation.getEditorProps<HTMLInputElement>(unitCell);
  const unitPriceCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.unitPrice,
  };
  const supplyTypeCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.supplyType,
  };
  const supplyTypeCellProps = navigation.getCellProps(supplyTypeCell);
  const supplyTypeEditorProps = navigation.getEditorProps<HTMLInputElement>(supplyTypeCell);
  const kFoCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.kFo,
  };
  const kFoCellProps = navigation.getCellProps(kFoCell);
  const kFoEditorProps = navigation.getEditorProps<HTMLInputElement>(kFoCell);
  const hMoCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.hMo,
  };
  const hMoCellProps = navigation.getCellProps(hMoCell);
  const hMoEditorProps = navigation.getEditorProps<HTMLInputElement>(hMoCell);
  const hMoMajorationCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.hMoMajoration,
  };
  const hMoMajorationCellProps = navigation.getCellProps(hMoMajorationCell);
  const hMoMajorationEditorProps = navigation.getEditorProps<HTMLInputElement>(
    hMoMajorationCell
  );
  const laborRoleCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.laborRole,
  };
  const laborRoleCellProps = navigation.getCellProps(laborRoleCell);
  const laborRoleEditorProps = navigation.getEditorProps<HTMLSelectElement>(
    laborRoleCell
  );
  const kMoCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.kMo,
  };
  const kMoCellProps = navigation.getCellProps(kMoCell);
  const kMoEditorProps = navigation.getEditorProps<HTMLInputElement>(kMoCell);
  const hMoAtelierCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.hMoAtelier,
  };
  const hMoAtelierCellProps = navigation.getCellProps(hMoAtelierCell);
  const hMoAtelierEditorProps = navigation.getEditorProps<HTMLInputElement>(
    hMoAtelierCell
  );
  const laborRoleAtelierCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.laborRoleAtelier,
  };
  const laborRoleAtelierCellProps = navigation.getCellProps(laborRoleAtelierCell);
  const laborRoleAtelierEditorProps = navigation.getEditorProps<HTMLSelectElement>(
    laborRoleAtelierCell
  );
  const kMoAtelierCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.kMoAtelier,
  };
  const kMoAtelierCellProps = navigation.getCellProps(kMoAtelierCell);
  const kMoAtelierEditorProps = navigation.getEditorProps<HTMLInputElement>(
    kMoAtelierCell
  );
  const hMoChantierCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.hMoChantier,
  };
  const hMoChantierCellProps = navigation.getCellProps(hMoChantierCell);
  const hMoChantierEditorProps = navigation.getEditorProps<HTMLInputElement>(
    hMoChantierCell
  );
  const laborRoleChantierCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.laborRoleChantier,
  };
  const laborRoleChantierCellProps = navigation.getCellProps(laborRoleChantierCell);
  const laborRoleChantierEditorProps = navigation.getEditorProps<HTMLSelectElement>(
    laborRoleChantierCell
  );
  const kMoChantierCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.kMoChantier,
  };
  const kMoChantierCellProps = navigation.getCellProps(kMoChantierCell);
  const kMoChantierEditorProps = navigation.getEditorProps<HTMLInputElement>(
    kMoChantierCell
  );
  const puCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.pu,
  };
  const puCellProps = navigation.getCellProps(puCell, { editable: false });
  const totalCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.total,
  };
  const totalCellProps = navigation.getCellProps(totalCell, { editable: false });
  const dismissedOutlierSet = new Set(dismissedOutlierFlags);
  const quantityOutlierActive =
    detectedOutlierFlags.includes("quantity_outlier") &&
    !dismissedOutlierSet.has("quantity_outlier");
  const priceOutlierActive =
    detectedOutlierFlags.includes("price_outlier") &&
    !dismissedOutlierSet.has("price_outlier");
  const dismissedOutlierBadges = detectedOutlierFlags.filter((flag, index, flags) => {
    return dismissedOutlierSet.has(flag) && flags.indexOf(flag) === index;
  });
  const actionableOutlierFlags = detectedOutlierFlags.filter((flag, index, flags) => {
    return ESTIMATE_OUTLIER_FLAG_KEYS.includes(flag) && flags.indexOf(flag) === index;
  });
  const handleLineSelectionCheckboxClick = (event: ReactMouseEvent<HTMLInputElement>) => {
    if (isReadOnly) return;
    event.preventDefault();
    onLineSelectionInteraction({
      id: item.id,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey || event.metaKey || !event.shiftKey,
      metaKey: event.metaKey,
    });
  };

  const handleRowModifierSelection = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (isReadOnly) return;
    if (!event.shiftKey && !event.ctrlKey && !event.metaKey) return;

    const target = event.target as HTMLElement;
    if (
      target.closest(
        "input,select,textarea,button,a,[contenteditable=''],[contenteditable='true'],[contenteditable='plaintext-only']"
      )
    ) {
      return;
    }

    event.preventDefault();
    onLineSelectionInteraction({
      id: item.id,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    });
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`estimate-row${isLineSelected ? " estimate-row--selected" : ""}`}
      role="row"
      onMouseDown={handleRowModifierSelection}
    >
      <div className="estimate-cell estimate-cell--selection">
        <input
          type="checkbox"
          className="estimate-line-checkbox"
          checked={isLineSelected}
          onClick={handleLineSelectionCheckboxClick}
          readOnly
          disabled={isReadOnly}
          aria-label={`Selectionner la ligne ${item.title || "sans titre"}`}
        />
      </div>
      <div
        {...titleCellProps}
        onKeyDown={toCellKeyDownHandler(titleCellProps.onKeyDown)}
        className={toCellClassName(
          navigation,
          titleCell,
          "estimate-cell estimate-cell--designation"
        )}
        style={indentStyle}
      >
        <DragHandle
          listeners={listeners}
          attributes={attributes}
          disabled={isReadOnly || isDragDisabled}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <input
            className="estimate-input estimate-input--title"
            ref={titleEditorProps.ref}
            tabIndex={titleEditorProps.tabIndex}
            value={item.title}
            disabled={isReadOnly}
            onFocus={handleLineTitleFocus}
            onKeyDown={handleLineTitleKeyDown}
            onChange={(event) =>
              onPatchItem(item.id, { title: event.target.value }, { persist: false })
            }
            onBlur={handleLineTitleBlur}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showCatalogueSuggestions}
            aria-controls={showCatalogueSuggestions ? catalogueListboxId : undefined}
            aria-activedescendant={
              showCatalogueSuggestions && catalogueSuggestions[activeCatalogueSuggestionIndex]
                ? `${catalogueListboxId}-option-${activeCatalogueSuggestionIndex}`
                : undefined
            }
          />
          {showCatalogueSuggestions ? (
            <div
              id={catalogueListboxId}
              className="estimate-catalogue-suggestions"
              role="listbox"
              onMouseDown={(event) => event.preventDefault()}
            >
              {isCatalogueLoading ? (
                <div className="estimate-catalogue-suggestions__status">Recherche catalogue...</div>
              ) : null}
              {catalogueError ? (
                <div className="estimate-catalogue-suggestions__status estimate-catalogue-suggestions__status--error">
                  {catalogueError}
                </div>
              ) : null}
              {catalogueSuggestions.map((suggestion, suggestionIndex) => (
                <div
                  key={`${item.id}:${suggestion.supplier_price_id}`}
                  id={`${catalogueListboxId}-option-${suggestionIndex}`}
                  role="option"
                  aria-selected={suggestionIndex === activeCatalogueSuggestionIndex}
                  className={`estimate-catalogue-suggestion${
                    suggestionIndex === activeCatalogueSuggestionIndex
                      ? " estimate-catalogue-suggestion--active"
                      : ""
                  }`}
                >
                  <button
                    type="button"
                    className="estimate-catalogue-suggestion__primary"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void applyCatalogueSuggestion(suggestion)}
                    disabled={isReadOnly}
                  >
                    <div className="estimate-catalogue-suggestion__head">
                      <span className="estimate-catalogue-suggestion__supplier">
                        {suggestion.supplier_name}
                      </span>
                      <span className="estimate-catalogue-suggestion__price">
                        {formatEUR(suggestion.adjusted_unit_price_cents)}
                        {suggestion.currency ? ` ${suggestion.currency}` : ""}
                      </span>
                    </div>
                    <div className="estimate-catalogue-suggestion__meta">
                      <span>{suggestion.product_designation}</span>
                      <span>{formatCompactDate(suggestion.updated_at)}</span>
                      <span>{suggestion.supplier_reference ?? "-"}</span>
                      {suggestion.is_stale ? (
                        <span className="estimate-catalogue-suggestion__stale">
                          Prix ancien
                        </span>
                      ) : null}
                    </div>
                  </button>
                  {suggestion.alternatives.length > 0 ? (
                    <div className="estimate-catalogue-suggestion__alternatives">
                      {suggestion.alternatives.map((alternative) => (
                        <button
                          key={`${suggestion.supplier_price_id}:alt:${alternative.kind}:${alternative.supplier_price_id}`}
                          type="button"
                          className="estimate-catalogue-suggestion__alternative"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={(event) => {
                            event.stopPropagation();
                            void applyCatalogueSuggestion(suggestion, alternative);
                          }}
                          disabled={isReadOnly}
                        >
                          {toAlternativeKindLabel(alternative.kind)}: {alternative.supplier_name} |
                          {" "}
                          {formatEUR(alternative.adjusted_unit_price_cents)} |
                          {" "}
                          {formatCompactDate(alternative.updated_at)} |
                          {" "}
                          {alternative.supplier_reference ?? "-"}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          {qualityFlags.length > 0 || dismissedOutlierBadges.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              {qualityFlags.map((flag) => (
                <span
                  key={flag}
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${QUALITY_BADGE_CLASSNAMES[flag]}`}
                  title={ESTIMATE_QUALITY_FLAG_META[flag].description}
                >
                  {ESTIMATE_QUALITY_FLAG_META[flag].label}
                </span>
              ))}
              {dismissedOutlierBadges.map((flag) => (
                <span
                  key={`dismissed:${flag}`}
                  className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600"
                  title={`${ESTIMATE_QUALITY_FLAG_META[flag].description} (accepte)`}
                >
                  {ESTIMATE_QUALITY_FLAG_META[flag].label} accepte
                </span>
              ))}
            </div>
          ) : null}
          {actionableOutlierFlags.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              {actionableOutlierFlags.map((flag) => {
                const isDismissed = dismissedOutlierSet.has(flag);
                return (
                  <button
                    key={`toggle:${flag}`}
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      onToggleOutlierDismiss(item.id, flag, !isDismissed)
                    }
                    disabled={isReadOnly || isOutlierActionPending}
                    title={ESTIMATE_QUALITY_FLAG_META[flag].description}
                  >
                    {isDismissed
                      ? `Reactiver ${ESTIMATE_QUALITY_FLAG_META[flag].label}`
                      : `Accepter ${ESTIMATE_QUALITY_FLAG_META[flag].label}`}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
      <EditableCell
        cell={quantityCell}
        navigation={navigation}
        value={item.quantity ?? 0}
        readOnly={isReadOnly}
        className={toCellClassName(
          navigation,
          quantityCell,
          `estimate-cell estimate-editable-cell${
            quantityOutlierActive ? " bg-orange-50 ring-1 ring-inset ring-orange-300" : ""
          }`
        )}
        inputClassName="estimate-input"
        type="number"
        step="0.001"
        min={0}
        ariaLabel={`Quantite pour ${item.title || "sans titre"}`}
        formatDisplayValue={(value) =>
          formatNumberDisplay(parseNumberInput(String(value ?? "0")), {
            minDecimals: 0,
            maxDecimals: 3,
          })
        }
        onChange={(value) =>
          onPatchItem(item.id, { quantity: parseNumberInput(value) }, { persist: false })
        }
        onCommit={(value) =>
          onPatchItem(item.id, { quantity: parseNumberInput(value) }, { persist: true })
        }
      />
      <div
        {...unitCellProps}
        onKeyDown={toCellKeyDownHandler(unitCellProps.onKeyDown)}
        className={toCellClassName(navigation, unitCell, "estimate-cell")}
      >
        <input
          className="estimate-input"
          ref={unitEditorProps.ref}
          tabIndex={unitEditorProps.tabIndex}
          list="estimate-unit-options"
          value={unitValue}
          onFocus={unitEditorProps.onFocus}
          onKeyDown={unitEditorProps.onKeyDown}
          onChange={(event) => onUnitChange(item.id, event.target.value)}
          onBlur={(event) => {
            unitEditorProps.onBlur(event);
            onUnitCommit(item.id);
          }}
          placeholder="u"
          disabled={isReadOnly}
        />
      </div>
      <EditableCell
        cell={unitPriceCell}
        navigation={navigation}
        value={formatCentsInput(item.unit_price_ht_cents)}
        readOnly={isReadOnly}
        className={toCellClassName(
          navigation,
          unitPriceCell,
          `estimate-cell estimate-editable-cell${
            priceOutlierActive ? " bg-orange-50 ring-1 ring-inset ring-orange-300" : ""
          }`
        )}
        inputClassName="estimate-input"
        type="number"
        step="0.01"
        min={0}
        ariaLabel={`Prix unitaire pour ${item.title || "sans titre"}`}
        formatDisplayValue={(value) =>
          formatNumberDisplay(parseNumberInput(String(value ?? "0")), {
            minDecimals: 2,
            maxDecimals: 2,
          })
        }
        onChange={(value) =>
          onPatchItem(
            item.id,
            { unit_price_ht_cents: parseEuroToCents(value) ?? 0 },
            { persist: false }
          )
        }
        onCommit={(value) =>
          onPatchItem(
            item.id,
            { unit_price_ht_cents: parseEuroToCents(value) ?? 0 },
            { persist: true }
          )
        }
      />
      <div
        {...supplyTypeCellProps}
        onKeyDown={toCellKeyDownHandler(supplyTypeCellProps.onKeyDown)}
        className={toCellClassName(navigation, supplyTypeCell, "estimate-cell")}
      >
        <input
          className="estimate-input"
          ref={supplyTypeEditorProps.ref}
          tabIndex={supplyTypeEditorProps.tabIndex}
          list="estimate-fo-type-options"
          value={supplyTypeValue}
          onFocus={supplyTypeEditorProps.onFocus}
          onKeyDown={supplyTypeEditorProps.onKeyDown}
          onChange={(event) => onSupplyTypeChange(item.id, event.target.value)}
          onBlur={(event) => {
            supplyTypeEditorProps.onBlur(event);
            onSupplyTypeCommit(item.id);
          }}
          placeholder="Tube"
          disabled={isReadOnly}
        />
      </div>
      <div
        {...kFoCellProps}
        onKeyDown={toCellKeyDownHandler(kFoCellProps.onKeyDown)}
        className={toCellClassName(navigation, kFoCell, "estimate-cell")}
      >
        <input
          className="estimate-input"
          ref={kFoEditorProps.ref}
          tabIndex={kFoEditorProps.tabIndex}
          type="number"
          step="0.01"
          min={0}
          value={kFoValue}
          onFocus={kFoEditorProps.onFocus}
          onKeyDown={kFoEditorProps.onKeyDown}
          onChange={(event) =>
            onPatchItem(
              item.id,
              { k_fo: parseNumberInput(event.target.value) },
              { persist: false }
            )
          }
          onBlur={(event) => {
            kFoEditorProps.onBlur(event);
            onPatchItem(
              item.id,
              { k_fo: parseNumberInput(event.target.value) },
              { persist: true }
            );
          }}
          placeholder="1.00"
          disabled={isReadOnly}
        />
      </div>
      {isLaborSplitEnabled ? (
        <>
          <div
            {...hMoMajorationCellProps}
            onKeyDown={toCellKeyDownHandler(hMoMajorationCellProps.onKeyDown)}
            className={toCellClassName(navigation, hMoMajorationCell, "estimate-cell")}
          >
            <input
              className="estimate-input"
              ref={hMoMajorationEditorProps.ref}
              tabIndex={hMoMajorationEditorProps.tabIndex}
              type="number"
              step="0.1"
              min={0}
              value={hMoMajorationPercent}
              onFocus={hMoMajorationEditorProps.onFocus}
              onKeyDown={hMoMajorationEditorProps.onKeyDown}
              onChange={(event) =>
                onPatchItem(
                  item.id,
                  { h_mo_majoration: parseMajorationPercentToCoefficient(event.target.value) },
                  { persist: false }
                )
              }
              onBlur={(event) => {
                hMoMajorationEditorProps.onBlur(event);
                onPatchItem(
                  item.id,
                  { h_mo_majoration: parseMajorationPercentToCoefficient(event.target.value) },
                  { persist: true }
                );
              }}
              placeholder="100"
              disabled={isReadOnly}
            />
          </div>
          <div
            {...hMoAtelierCellProps}
            onKeyDown={toCellKeyDownHandler(hMoAtelierCellProps.onKeyDown)}
            className={toCellClassName(navigation, hMoAtelierCell, "estimate-cell")}
          >
            <input
              className="estimate-input"
              ref={hMoAtelierEditorProps.ref}
              tabIndex={hMoAtelierEditorProps.tabIndex}
              type="number"
              step="0.1"
              min={0}
              value={hMoAtelierValue}
              onFocus={hMoAtelierEditorProps.onFocus}
              onKeyDown={hMoAtelierEditorProps.onKeyDown}
              onChange={(event) =>
                onPatchItem(
                  item.id,
                  { h_mo_atelier: parseNumberInput(event.target.value) },
                  { persist: false }
                )
              }
              onBlur={(event) => {
                hMoAtelierEditorProps.onBlur(event);
                onPatchItem(
                  item.id,
                  { h_mo_atelier: parseNumberInput(event.target.value) },
                  { persist: true }
                );
              }}
              placeholder="0.0"
              disabled={isReadOnly}
            />
          </div>
          <div
            {...laborRoleAtelierCellProps}
            onKeyDown={toCellKeyDownHandler(laborRoleAtelierCellProps.onKeyDown)}
            className={toCellClassName(
              navigation,
              laborRoleAtelierCell,
              "estimate-cell"
            )}
          >
            <select
              className="estimate-input estimate-select"
              ref={laborRoleAtelierEditorProps.ref}
              tabIndex={laborRoleAtelierEditorProps.tabIndex}
              value={splitFields.labor_role_atelier_id ?? ""}
              onFocus={laborRoleAtelierEditorProps.onFocus}
              onBlur={laborRoleAtelierEditorProps.onBlur}
              onKeyDown={laborRoleAtelierEditorProps.onKeyDown}
              onChange={(event) =>
                onPatchItem(
                  item.id,
                  { labor_role_atelier_id: event.target.value || null },
                  { persist: true }
                )
              }
              disabled={isReadOnly}
            >
              <option value="">-</option>
              {laborRoles.map((role) => (
                <option key={role.id} value={role.id} disabled={!role.is_active}>
                  {role.name}
                  {!role.is_active ? " (inactif)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div
            {...kMoAtelierCellProps}
            onKeyDown={toCellKeyDownHandler(kMoAtelierCellProps.onKeyDown)}
            className={toCellClassName(navigation, kMoAtelierCell, "estimate-cell")}
          >
            <input
              className="estimate-input"
              ref={kMoAtelierEditorProps.ref}
              tabIndex={kMoAtelierEditorProps.tabIndex}
              type="number"
              step="0.01"
              min={0}
              value={kMoAtelierValue}
              onFocus={kMoAtelierEditorProps.onFocus}
              onKeyDown={kMoAtelierEditorProps.onKeyDown}
              onChange={(event) =>
                onPatchItem(
                  item.id,
                  { k_mo_atelier: parseNumberInput(event.target.value) },
                  { persist: false }
                )
              }
              onBlur={(event) => {
                kMoAtelierEditorProps.onBlur(event);
                onPatchItem(
                  item.id,
                  { k_mo_atelier: parseNumberInput(event.target.value) },
                  { persist: true }
                );
              }}
              placeholder="1.00"
              disabled={isReadOnly}
            />
          </div>
          <div
            {...hMoChantierCellProps}
            onKeyDown={toCellKeyDownHandler(hMoChantierCellProps.onKeyDown)}
            className={toCellClassName(navigation, hMoChantierCell, "estimate-cell")}
          >
            <input
              className="estimate-input"
              ref={hMoChantierEditorProps.ref}
              tabIndex={hMoChantierEditorProps.tabIndex}
              type="number"
              step="0.1"
              min={0}
              value={hMoChantierValue}
              onFocus={hMoChantierEditorProps.onFocus}
              onKeyDown={hMoChantierEditorProps.onKeyDown}
              onChange={(event) =>
                onPatchItem(
                  item.id,
                  { h_mo_chantier: parseNumberInput(event.target.value) },
                  { persist: false }
                )
              }
              onBlur={(event) => {
                hMoChantierEditorProps.onBlur(event);
                onPatchItem(
                  item.id,
                  { h_mo_chantier: parseNumberInput(event.target.value) },
                  { persist: true }
                );
              }}
              placeholder="0.0"
              disabled={isReadOnly}
            />
          </div>
          <div
            {...laborRoleChantierCellProps}
            onKeyDown={toCellKeyDownHandler(laborRoleChantierCellProps.onKeyDown)}
            className={toCellClassName(
              navigation,
              laborRoleChantierCell,
              "estimate-cell"
            )}
          >
            <select
              className="estimate-input estimate-select"
              ref={laborRoleChantierEditorProps.ref}
              tabIndex={laborRoleChantierEditorProps.tabIndex}
              value={splitFields.labor_role_chantier_id ?? ""}
              onFocus={laborRoleChantierEditorProps.onFocus}
              onBlur={laborRoleChantierEditorProps.onBlur}
              onKeyDown={laborRoleChantierEditorProps.onKeyDown}
              onChange={(event) =>
                onPatchItem(
                  item.id,
                  { labor_role_chantier_id: event.target.value || null },
                  { persist: true }
                )
              }
              disabled={isReadOnly}
            >
              <option value="">-</option>
              {laborRoles.map((role) => (
                <option key={role.id} value={role.id} disabled={!role.is_active}>
                  {role.name}
                  {!role.is_active ? " (inactif)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div
            {...kMoChantierCellProps}
            onKeyDown={toCellKeyDownHandler(kMoChantierCellProps.onKeyDown)}
            className={toCellClassName(navigation, kMoChantierCell, "estimate-cell")}
          >
            <input
              className="estimate-input"
              ref={kMoChantierEditorProps.ref}
              tabIndex={kMoChantierEditorProps.tabIndex}
              type="number"
              step="0.01"
              min={0}
              value={kMoChantierValue}
              onFocus={kMoChantierEditorProps.onFocus}
              onKeyDown={kMoChantierEditorProps.onKeyDown}
              onChange={(event) =>
                onPatchItem(
                  item.id,
                  { k_mo_chantier: parseNumberInput(event.target.value) },
                  { persist: false }
                )
              }
              onBlur={(event) => {
                kMoChantierEditorProps.onBlur(event);
                onPatchItem(
                  item.id,
                  { k_mo_chantier: parseNumberInput(event.target.value) },
                  { persist: true }
                );
              }}
              placeholder="1.00"
              disabled={isReadOnly}
            />
          </div>
        </>
      ) : (
        <>
          <div
            {...hMoCellProps}
            onKeyDown={toCellKeyDownHandler(hMoCellProps.onKeyDown)}
            className={toCellClassName(navigation, hMoCell, "estimate-cell")}
          >
            <input
              className="estimate-input"
              ref={hMoEditorProps.ref}
              tabIndex={hMoEditorProps.tabIndex}
              type="number"
              step="0.1"
              min={0}
              value={hMoValue}
              onFocus={hMoEditorProps.onFocus}
              onKeyDown={hMoEditorProps.onKeyDown}
              onChange={(event) =>
                onPatchItem(
                  item.id,
                  { h_mo: parseNumberInput(event.target.value) },
                  { persist: false }
                )
              }
              onBlur={(event) => {
                hMoEditorProps.onBlur(event);
                onPatchItem(
                  item.id,
                  { h_mo: parseNumberInput(event.target.value) },
                  { persist: true }
                );
              }}
              placeholder="0.0"
              disabled={isReadOnly}
            />
          </div>
          <div
            {...hMoMajorationCellProps}
            onKeyDown={toCellKeyDownHandler(hMoMajorationCellProps.onKeyDown)}
            className={toCellClassName(navigation, hMoMajorationCell, "estimate-cell")}
          >
            <input
              className="estimate-input"
              ref={hMoMajorationEditorProps.ref}
              tabIndex={hMoMajorationEditorProps.tabIndex}
              type="number"
              step="0.1"
              min={0}
              value={hMoMajorationPercent}
              onFocus={hMoMajorationEditorProps.onFocus}
              onKeyDown={hMoMajorationEditorProps.onKeyDown}
              onChange={(event) =>
                onPatchItem(
                  item.id,
                  { h_mo_majoration: parseMajorationPercentToCoefficient(event.target.value) },
                  { persist: false }
                )
              }
              onBlur={(event) => {
                hMoMajorationEditorProps.onBlur(event);
                onPatchItem(
                  item.id,
                  { h_mo_majoration: parseMajorationPercentToCoefficient(event.target.value) },
                  { persist: true }
                );
              }}
              placeholder="100"
              disabled={isReadOnly}
            />
          </div>
          <div
            {...laborRoleCellProps}
            onKeyDown={toCellKeyDownHandler(laborRoleCellProps.onKeyDown)}
            className={toCellClassName(navigation, laborRoleCell, "estimate-cell")}
          >
            <select
              className="estimate-input estimate-select"
              ref={laborRoleEditorProps.ref}
              tabIndex={laborRoleEditorProps.tabIndex}
              value={item.labor_role_id ?? ""}
              onFocus={laborRoleEditorProps.onFocus}
              onBlur={laborRoleEditorProps.onBlur}
              onKeyDown={laborRoleEditorProps.onKeyDown}
              onChange={(event) =>
                onPatchItem(
                  item.id,
                  { labor_role_id: event.target.value || null },
                  { persist: true }
                )
              }
              disabled={isReadOnly}
            >
              <option value="">-</option>
              {laborRoles.map((role) => (
                <option key={role.id} value={role.id} disabled={!role.is_active}>
                  {role.name}
                  {!role.is_active ? " (inactif)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div
            {...kMoCellProps}
            onKeyDown={toCellKeyDownHandler(kMoCellProps.onKeyDown)}
            className={toCellClassName(navigation, kMoCell, "estimate-cell")}
          >
            <input
              className="estimate-input"
              ref={kMoEditorProps.ref}
              tabIndex={kMoEditorProps.tabIndex}
              type="number"
              step="0.01"
              min={0}
              value={kMoValue}
              onFocus={kMoEditorProps.onFocus}
              onKeyDown={kMoEditorProps.onKeyDown}
              onChange={(event) =>
                onPatchItem(
                  item.id,
                  { k_mo: parseNumberInput(event.target.value) },
                  { persist: false }
                )
              }
              onBlur={(event) => {
                kMoEditorProps.onBlur(event);
                onPatchItem(
                  item.id,
                  { k_mo: parseNumberInput(event.target.value) },
                  { persist: true }
                );
              }}
              placeholder="1.00"
              disabled={isReadOnly}
            />
          </div>
        </>
      )}
      <div
        {...puCellProps}
        onKeyDown={toCellKeyDownHandler(puCellProps.onKeyDown)}
        className={toCellClassName(
          navigation,
          puCell,
          "estimate-cell estimate-cell--readonly"
        )}
      >
        <input
          className="estimate-input"
          type="text"
          value={formatNumberDisplay((item.pu_ht_cents ?? 0) / 100, {
            minDecimals: 2,
            maxDecimals: 2,
          })}
          placeholder="0.00"
          readOnly
          tabIndex={-1}
          aria-readonly
        />
      </div>
      <div
        {...totalCellProps}
        onKeyDown={toCellKeyDownHandler(totalCellProps.onKeyDown)}
        className={toCellClassName(
          navigation,
          totalCell,
          "estimate-cell estimate-cell--total estimate-cell--readonly"
        )}
      >
        <span>{formatEUR(lineTotal)}</span>
      </div>
      <div className="estimate-cell estimate-cell--actions">
        <button
          className="btn btn-danger btn-sm"
          type="button"
          onClick={() => onDeleteItem(item.id)}
          disabled={isReadOnly}
        >
          Supprimer
        </button>
      </div>
    </div>
  );
});

DragHandle.displayName = "DragHandle";
SortableRow.displayName = "SortableRow";

type SuggestionPreview = {
  rule: SuggestionRule;
  score: number;
  matchKind: SuggestionMatchKind;
  matchedKeyword: string;
  usageCount: number;
  parts: string[];
};

type VirtualizedItemRow = {
  key: string;
  kind: "item";
  item: EstimateItem;
  depth: number;
  unitValue: string;
  supplyTypeValue: string;
  qualityFlags: EstimateQualityFlagKey[];
};

type VirtualizedSuggestionRow = {
  key: string;
  kind: "suggestion";
  item: EstimateItem;
  suggestions: SuggestionPreview[];
};

type VirtualizedRow = VirtualizedItemRow | VirtualizedSuggestionRow;

type BulkMoveDestination = {
  id: string | null;
  label: string;
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
  bulkSuggestionEligibleCount,
  onOpenBulkSuggestDialog,
  onReorder,
  virtualization,
}: EstimateEditorTableProps) {
  const [unitDrafts, setUnitDrafts] = useState<Record<string, string>>({});
  const [supplyTypeDrafts, setSupplyTypeDrafts] = useState<Record<string, string>>({});
  const [bulkMajorationPercent, setBulkMajorationPercent] = useState("100");
  const [isAssemblyPickerOpen, setIsAssemblyPickerOpen] = useState(false);
  const [bulkMoveParentId, setBulkMoveParentId] = useState("");
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [bulkLaborRoleId, setBulkLaborRoleId] = useState("");
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
  const tableCardRef = useRef<HTMLDivElement | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const itemsByParent = useMemo(() => {
    const map = new Map<string, EstimateItem[]>();
    items.forEach((item) => {
      const key = getParentKey(item.parent_id);
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    });
    map.forEach((list) => list.sort((a, b) => a.position - b.position));
    return map;
  }, [items]);

  const depthMap = useMemo(() => {
    const depth = new Map<string, number>();
    function walk(parentId: string | null, level: number) {
      const list = itemsByParent.get(getParentKey(parentId)) ?? [];
      list.forEach((item) => {
        depth.set(item.id, level);
        if (item.item_type === "section") {
          walk(item.id, level + 1);
        }
      });
    }
    walk(null, 0);
    return depth;
  }, [itemsByParent]);

  const bulkMoveDestinations = useMemo(() => {
    const destinations: BulkMoveDestination[] = [{ id: null, label: "Racine" }];

    function walk(parentId: string | null, depth: number) {
      const children = itemsByParent.get(getParentKey(parentId)) ?? [];
      children.forEach((child) => {
        if (child.item_type !== "section") return;
        const prefix = depth > 0 ? `${"  ".repeat(depth)}- ` : "";
        destinations.push({
          id: child.id,
          label: `${prefix}${child.title || "Sans titre"}`,
        });
        walk(child.id, depth + 1);
      });
    }

    walk(null, 0);
    return destinations;
  }, [itemsByParent]);

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

  const visibleLineIds = useMemo(() => {
    const visible = new Set<string>();
    items.forEach((item) => {
      if (item.item_type !== "line") return;
      const qualityFlags = qualityFlagsByItemId[item.id] ?? [];
      if (matchesQualityFilter(qualityFlags, qualityFilter)) {
        visible.add(item.id);
      }
    });
    return visible;
  }, [items, qualityFilter, qualityFlagsByItemId]);

  const visibleSectionIds = useMemo(() => {
    const visible = new Set<string>();

    function walk(parentId: string | null): boolean {
      const list = itemsByParent.get(getParentKey(parentId)) ?? [];
      let hasVisibleLine = false;

      list.forEach((item) => {
        if (item.item_type === "line") {
          if (visibleLineIds.has(item.id)) {
            hasVisibleLine = true;
          }
          return;
        }

        const hasVisibleChild = walk(item.id);
        if (qualityFilter === "all_lines" || hasVisibleChild) {
          visible.add(item.id);
        }
        if (hasVisibleChild) {
          hasVisibleLine = true;
        }
      });

      return hasVisibleLine;
    }

    walk(null);
    return visible;
  }, [itemsByParent, qualityFilter, visibleLineIds]);

  const sectionTotalsById = useMemo(() => {
    const map = new Map<string, SectionTotals>();
    const calcItems = items as EstimateItemRecord[];
    visibleSectionIds.forEach((sectionId) => {
      const sectionTotalsInput = {
        items: calcItems,
        sectionId,
        marginMultiplier,
        discountCents,
        taxRateBp,
        laborRateById,
        isLaborSplitEnabled,
      };
      map.set(
        sectionId,
        computeSectionTotals(sectionTotalsInput)
      );
    });
    return map;
  }, [
    discountCents,
    isLaborSplitEnabled,
    items,
    laborRateById,
    marginMultiplier,
    taxRateBp,
    visibleSectionIds,
  ]);

  const getSectionTotals = useCallback(
    (sectionId: string) => sectionTotalsById.get(sectionId) ?? null,
    [sectionTotalsById]
  );

  const visibleItemsByParent = useMemo(() => {
    const map = new Map<string, EstimateItem[]>();
    itemsByParent.forEach((list, parentKey) => {
      const visibleList = list.filter((item) => {
        if (item.item_type === "line") {
          return visibleLineIds.has(item.id);
        }
        return visibleSectionIds.has(item.id);
      });
      if (visibleList.length > 0) {
        map.set(parentKey, visibleList);
      }
    });
    return map;
  }, [itemsByParent, visibleLineIds, visibleSectionIds]);

  const getVisibleItems = useCallback(
    (parentId: string | null) => {
      return visibleItemsByParent.get(getParentKey(parentId)) ?? EMPTY_ITEMS;
    },
    [visibleItemsByParent]
  );

  const hasVisibleRows = getVisibleItems(null).length > 0;
  const canReorder = !isReadOnly && qualityFilter === "all_lines";

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

  const visibleLineIdList = useMemo(() => {
    return items
      .filter((item) => item.item_type === "line" && visibleLineIds.has(item.id))
      .map((item) => item.id);
  }, [items, visibleLineIds]);

  const {
    selectedIds: selectedLineIdList,
    isSelected: isLineSelected,
    handleItemSelection,
    selectAll: selectAllVisibleLines,
    clear: clearLineSelection,
  } = useMultiSelect({
    visibleIds: visibleLineIdList,
  });

  const selectedLineCount = selectedLineIdList.length;
  const hasSelectedLines = selectedLineCount > 0;

  const allVisibleSelected =
    visibleLineIdList.length > 0 && selectedLineCount === visibleLineIdList.length;

  const toggleAllVisibleLines = useCallback(
    (checked: boolean) => {
      if (checked) {
        selectAllVisibleLines(visibleLineIdList);
        return;
      }
      clearLineSelection();
    },
    [clearLineSelection, selectAllVisibleLines, visibleLineIdList]
  );

  const handleLineSelectionInteraction = useCallback(
    (interaction: MultiSelectItemInteraction) => {
      if (isReadOnly) return;
      handleItemSelection(interaction);
    },
    [handleItemSelection, isReadOnly]
  );

  const handleApplyBulkMajoration = useCallback(async () => {
    if (isReadOnly || !hasSelectedLines) return;
    const coefficient = parseMajorationPercentToCoefficient(bulkMajorationPercent);
    await onApplyBulkMajoration(selectedLineIdList, coefficient);
  }, [
    bulkMajorationPercent,
    hasSelectedLines,
    isReadOnly,
    onApplyBulkMajoration,
    selectedLineIdList,
  ]);

  const handleBulkDeleteSelection = useCallback(async () => {
    if (isReadOnly || !hasSelectedLines) return;

    const lineLabel =
      selectedLineCount > 1 ? "lignes selectionnees" : "ligne selectionnee";
    const confirmed = window.confirm(
      `Supprimer ${selectedLineCount} ${lineLabel} ?`
    );
    if (!confirmed) return;

    await onBulkDeleteLines(selectedLineIdList);
    clearLineSelection();
  }, [
    clearLineSelection,
    hasSelectedLines,
    isReadOnly,
    onBulkDeleteLines,
    selectedLineCount,
    selectedLineIdList,
  ]);

  const handleApplyBulkMove = useCallback(async () => {
    if (isReadOnly || !hasSelectedLines) return;
    await onBulkMoveLines(selectedLineIdList, bulkMoveParentId || null);
  }, [
    bulkMoveParentId,
    hasSelectedLines,
    isReadOnly,
    onBulkMoveLines,
    selectedLineIdList,
  ]);

  const handleApplyBulkCategory = useCallback(async () => {
    if (isReadOnly || !hasSelectedLines) return;
    await onBulkSetCategory(selectedLineIdList, bulkCategoryId || null);
  }, [
    bulkCategoryId,
    hasSelectedLines,
    isReadOnly,
    onBulkSetCategory,
    selectedLineIdList,
  ]);

  const handleApplyBulkLaborRole = useCallback(async () => {
    if (isReadOnly || !hasSelectedLines) return;
    await onBulkSetLaborRole(selectedLineIdList, bulkLaborRoleId || null);
  }, [
    bulkLaborRoleId,
    hasSelectedLines,
    isReadOnly,
    onBulkSetLaborRole,
    selectedLineIdList,
  ]);

  const handleTableBodyMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!hasSelectedLines) return;
      const target = event.target as HTMLElement;
      if (target.closest(".estimate-row")) return;
      clearLineSelection();
    },
    [clearLineSelection, hasSelectedLines]
  );

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target;
      const withinTable =
        tableCardRef.current && target instanceof Node
          ? tableCardRef.current.contains(target)
          : false;
      const isPageLevelTarget =
        target === document.body || target === document.documentElement;
      const shortcutScope = resolveEstimateTableShortcutScope({
        withinTable,
        hasSelectedLines,
        isPageLevelTarget,
      });

      if (!shortcutScope.canHandleAnyShortcut) {
        return;
      }

      if (
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "a"
      ) {
        if (
          !shortcutScope.canHandleSelectAllShortcut ||
          isTextEditingTarget(target) ||
          visibleLineIdList.length === 0 ||
          isReadOnly
        ) {
          return;
        }
        event.preventDefault();
        selectAllVisibleLines(visibleLineIdList);
        return;
      }

      if (event.key === "Escape") {
        if (
          isTextEditingTarget(target) ||
          !shortcutScope.canHandleBulkSelectionShortcut
        ) {
          return;
        }
        event.preventDefault();
        clearLineSelection();
        return;
      }

      if (event.key === "Delete") {
        if (
          event.repeat ||
          isReadOnly ||
          !shortcutScope.canHandleBulkSelectionShortcut ||
          isTextEditingTarget(target)
        ) {
          return;
        }
        event.preventDefault();
        void handleBulkDeleteSelection();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    clearLineSelection,
    handleBulkDeleteSelection,
    hasSelectedLines,
    isReadOnly,
    selectAllVisibleLines,
    visibleLineIdList,
  ]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!canReorder) return;
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const activeParent = active.data.current?.parentId ?? null;
      const overParent = over.data.current?.parentId ?? null;
      if (activeParent !== overParent) return;

      const siblings = itemsByParent.get(getParentKey(activeParent)) ?? EMPTY_ITEMS;
      const oldIndex = siblings.findIndex((item) => item.id === active.id);
      const newIndex = siblings.findIndex((item) => item.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const ordered = arrayMove(siblings, oldIndex, newIndex).map((item) => item.id);
      onReorder(activeParent, ordered);
    },
    [canReorder, itemsByParent, onReorder]
  );

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

  const getSelectedSuggestion = useCallback(
    (itemId: string, suggestions: SuggestionPreview[]) => {
      if (suggestions.length === 0) return null;
      const selectedRuleId = selectedSuggestionByItemId[itemId];
      return (
        suggestions.find((suggestion) => suggestion.rule.id === selectedRuleId) ??
        suggestions[0]
      );
    },
    [selectedSuggestionByItemId]
  );

  const renderSuggestionRow = useCallback(
    (item: EstimateItem, suggestions: SuggestionPreview[]) => {
      const selectedSuggestion = getSelectedSuggestion(item.id, suggestions);
      if (!selectedSuggestion) return null;

      const isFeedbackPending = feedbackPendingByItemId[item.id] ?? false;
      return (
        <div className="estimate-row estimate-row--suggestion">
          <div className="estimate-cell estimate-cell--suggestion">
            <div className="estimate-suggestion">
              <div className="estimate-suggestion__title">
                Suggestions de chiffrage (Top 5)
              </div>
              <select
                className="estimate-input estimate-select"
                value={selectedSuggestion.rule.id}
                style={{ width: "min(560px, 100%)" }}
                onChange={(event) =>
                  setSelectedSuggestionByItemId((prev) => ({
                    ...prev,
                    [item.id]: event.target.value,
                  }))
                }
                disabled={isReadOnly || isFeedbackPending}
              >
                {suggestions.map((suggestion) => (
                  <option key={suggestion.rule.id} value={suggestion.rule.id}>
                    {suggestion.rule.name} (score {suggestion.score.toFixed(2)})
                  </option>
                ))}
              </select>
              <div className="estimate-suggestion__rule">{selectedSuggestion.rule.name}</div>
              <div className="estimate-suggestion__list">
                <span className="estimate-suggestion__item">
                  Score: {selectedSuggestion.score.toFixed(2)}
                </span>
                <span className="estimate-suggestion__item">
                  Match: {SUGGESTION_MATCH_LABELS[selectedSuggestion.matchKind]}
                </span>
                <span className="estimate-suggestion__item">
                  Mot-cle: {selectedSuggestion.matchedKeyword}
                </span>
                <span className="estimate-suggestion__item">
                  Usage: {selectedSuggestion.usageCount}
                </span>
                {selectedSuggestion.parts.map((part) => (
                  <span key={part} className="estimate-suggestion__item">
                    {part}
                  </span>
                ))}
              </div>
              <div className="estimate-suggestion__actions">
                <button
                  className="btn btn-primary btn-sm"
                  type="button"
                  onClick={() => applySuggestion(item, selectedSuggestion)}
                  disabled={isReadOnly || isFeedbackPending}
                >
                  Appliquer
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => dismissSuggestion(item, selectedSuggestion)}
                  disabled={isReadOnly || isFeedbackPending}
                >
                  Ignorer
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    },
    [
      applySuggestion,
      dismissSuggestion,
      feedbackPendingByItemId,
      getSelectedSuggestion,
      isReadOnly,
    ]
  );

  const shouldVirtualize = Boolean(virtualization?.enabled);
  const flattenedRows = useMemo(() => {
    if (!shouldVirtualize) return [] as VirtualizedRow[];

    const rows: VirtualizedRow[] = [];
    const walk = (parentId: string | null) => {
      const list = getVisibleItems(parentId);
      list.forEach((item) => {
        rows.push({
          key: `item:${item.id}`,
          kind: "item",
          item,
          depth: depthMap.get(item.id) ?? 0,
          unitValue: mergedUnitDrafts[item.id] ?? "",
          supplyTypeValue: mergedSupplyTypeDrafts[item.id] ?? "",
          qualityFlags: qualityFlagsByItemId[item.id] ?? EMPTY_QUALITY_FLAGS,
        });

        const suggestions = suggestionsByItemId.get(item.id);
        if (suggestions && suggestions.length > 0) {
          rows.push({
            key: `suggestion:${item.id}`,
            kind: "suggestion",
            item,
            suggestions,
          });
        }

        if (item.item_type === "section") {
          walk(item.id);
        }
      });
    };

    walk(null);
    return rows;
  }, [
    depthMap,
    getVisibleItems,
    mergedSupplyTypeDrafts,
    mergedUnitDrafts,
    qualityFlagsByItemId,
    shouldVirtualize,
    suggestionsByItemId,
  ]);

  const {
    scrollRef: virtualScrollRef,
    virtualItems,
    totalSize: virtualTotalSize,
    measureElement,
    scrollToIndex,
    isVirtualized,
  } = useVirtualList({
    count: flattenedRows.length,
    enabled: shouldVirtualize && hasVisibleRows,
    estimateSize: virtualization?.rowEstimate ?? DEFAULT_VIRTUAL_ROW_ESTIMATE,
    overscan: virtualization?.overscan ?? DEFAULT_VIRTUAL_OVERSCAN,
  });

  const virtualizedSortableIds = useMemo(() => {
    if (!canReorder || !isVirtualized) return [] as string[];

    const ids: string[] = [];
    virtualItems.forEach((virtualRow) => {
      const row = flattenedRows[virtualRow.index];
      if (row?.kind === "item") {
        ids.push(row.item.id);
      }
    });
    return ids;
  }, [canReorder, flattenedRows, isVirtualized, virtualItems]);

  const virtualRowIndexByItemId = useMemo(() => {
    const map = new Map<string, number>();
    if (!isVirtualized) return map;

    flattenedRows.forEach((row, index) => {
      if (row.kind === "item") {
        map.set(row.item.id, index);
      }
    });
    return map;
  }, [flattenedRows, isVirtualized]);

  const visibleItemsInOrder = useMemo(() => {
    const ordered: EstimateItem[] = [];
    const walk = (parentId: string | null) => {
      const list = getVisibleItems(parentId);
      list.forEach((item) => {
        ordered.push(item);
        if (item.item_type === "section") {
          walk(item.id);
        }
      });
    };
    walk(null);
    return ordered;
  }, [getVisibleItems]);

  const spreadsheetNavigationRows = useMemo(() => {
    if (!hasVisibleRows) return [] as SpreadsheetNavigationRow[];

    return visibleItemsInOrder.map((item) => ({
      rowId: item.id,
      columnKeys: getSpreadsheetColumnKeys(item.item_type, isLaborSplitEnabled),
    }));
  }, [hasVisibleRows, isLaborSplitEnabled, visibleItemsInOrder]);

  const handleNavigationCellNotMounted = useCallback(
    (cell: SpreadsheetCell) => {
      if (!isVirtualized) return;
      const rowIndex = virtualRowIndexByItemId.get(cell.rowId);
      if (rowIndex === undefined) return;
      scrollToIndex(rowIndex);
    },
    [isVirtualized, scrollToIndex, virtualRowIndexByItemId]
  );

  const spreadsheetNavigation = useSpreadsheetNavigation({
    rows: spreadsheetNavigationRows,
    disabled: !hasVisibleRows || isReadOnly,
    onActiveCellNotMounted: isVirtualized
      ? handleNavigationCellNotMounted
      : undefined,
  });
  const insertionAnchorItemId = spreadsheetNavigation.activeCell?.rowId ?? null;

  const renderSortableRow = useCallback(
    (
      item: EstimateItem,
      depth: number,
      unitValue: string,
      supplyTypeValue: string,
      qualityFlags: EstimateQualityFlagKey[],
      sectionTotals: SectionTotals | null
    ) => {
      return (
        <SortableRow
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
          onAddSection={onAddSection}
          onAddLine={onAddLine}
          onDeleteItem={onDeleteItem}
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
      canReorder,
      detectedOutlierFlagsByItemId,
      dismissedOutlierFlagsByItemId,
      handleSupplyTypeCommit,
      handleSupplyTypeDraftChange,
      handleLineSelectionInteraction,
      handleUnitCommit,
      handleUnitDraftChange,
      isLaborSplitEnabled,
      isLineSelected,
      isReadOnly,
      laborRoles,
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

  const virtualBodyStyle = useMemo(() => {
    if (!isVirtualized) return undefined;
    const maxHeight =
      virtualization?.maxHeight ??
      virtualization?.containerHeight ??
      DEFAULT_VIRTUAL_MAX_HEIGHT;
    return {
      maxHeight: `${maxHeight}px`,
      overflowY: "auto" as const,
    };
  }, [isVirtualized, virtualization?.containerHeight, virtualization?.maxHeight]);

  return (
    <div ref={tableCardRef} className="dashboard-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--slate-800)]">
            Editeur du devis
          </h2>
          <p className="mt-1 text-sm text-[var(--slate-500)]">
            Organisez chapitres, sous-chapitres et lignes FO/MO.
          </p>
          <p className="mt-2 text-xs text-[var(--slate-500)]">
            {qualityCounts.linesWithAnomaliesCount} ligne(s) avec anomalies sur{" "}
            {qualityCounts.linesCount} ligne(s) ({qualityCounts.totalFlagsCount} flag(s))
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label
            className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--slate-500)]"
            htmlFor="estimate-quality-filter"
          >
            Filtre qualite
          </label>
          <select
            id="estimate-quality-filter"
            className="estimate-input estimate-select"
            style={{ width: "auto", minWidth: "260px" }}
            value={qualityFilter}
            onChange={(event) =>
              onQualityFilterChange(parseEstimateQualityFilter(event.target.value))
            }
          >
            <option value="all_lines">
              Toutes les lignes ({qualityCounts.linesCount})
            </option>
            <option value="with_anomalies">
              Lignes avec anomalies ({qualityCounts.linesWithAnomaliesCount})
            </option>
            {ESTIMATE_QUALITY_FLAG_KEYS.map((flag) => (
              <option key={flag} value={flag}>
                {ESTIMATE_QUALITY_FLAG_META[flag].label} ({qualityCounts.byFlag[flag]})
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-2 py-1">
            <label
              className="text-xs font-semibold uppercase tracking-[0.08em] text-orange-700"
              htmlFor="estimate-outlier-method"
            >
              Outliers
            </label>
            <select
              id="estimate-outlier-method"
              className="estimate-input estimate-select"
              style={{ width: "auto", minWidth: "104px" }}
              value={outlierDetectionMethod}
              disabled={isReadOnly}
              onChange={(event) =>
                onOutlierDetectionMethodChange(parseOutlierMethod(event.target.value))
              }
            >
              <option value="iqr">IQR</option>
              <option value="zscore">Z-score</option>
            </select>
            <input
              className="estimate-input"
              style={{ width: "92px" }}
              type="number"
              step="0.1"
              min={0.1}
              value={outlierThreshold}
              disabled={isReadOnly}
              onChange={(event) =>
                onOutlierThresholdChange(parseNumberInput(event.target.value))
              }
              aria-label="Seuil de detection des outliers"
            />
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-[var(--slate-200)] bg-[var(--slate-50)] px-2 py-1">
            <span className="text-xs text-[var(--slate-600)]">
              {selectedLineCount} selection(s)
            </span>
            <input
              className="estimate-input"
              style={{ width: "92px" }}
              type="number"
              step="0.1"
              min={0}
              value={bulkMajorationPercent}
              onChange={(event) => setBulkMajorationPercent(event.target.value)}
              placeholder="100"
              disabled={isReadOnly}
              aria-label="Majoration MO en pourcentage"
            />
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={() => void handleApplyBulkMajoration()}
              disabled={isReadOnly || !hasSelectedLines}
            >
              Appliquer majoration
            </button>
            <button
              className="btn btn-danger btn-sm"
              type="button"
              onClick={() => void handleBulkDeleteSelection()}
              disabled={isReadOnly || !hasSelectedLines}
            >
              Supprimer selection
            </button>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-[var(--slate-200)] bg-white px-2 py-1">
            <label
              className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--slate-500)]"
              htmlFor="estimate-bulk-move-target"
            >
              Deplacer
            </label>
            <select
              id="estimate-bulk-move-target"
              className="estimate-input estimate-select"
              style={{ width: "auto", minWidth: "180px" }}
              value={bulkMoveParentId}
              onChange={(event) => setBulkMoveParentId(event.target.value)}
              disabled={isReadOnly}
            >
              {bulkMoveDestinations.map((destination) => (
                <option
                  key={destination.id ?? ROOT_KEY}
                  value={destination.id ?? ""}
                >
                  {destination.label}
                </option>
              ))}
            </select>
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={() => void handleApplyBulkMove()}
              disabled={isReadOnly || !hasSelectedLines}
            >
              Appliquer
            </button>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-[var(--slate-200)] bg-white px-2 py-1">
            <label
              className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--slate-500)]"
              htmlFor="estimate-bulk-category"
            >
              Categorie
            </label>
            <select
              id="estimate-bulk-category"
              className="estimate-input estimate-select"
              style={{ width: "auto", minWidth: "180px" }}
              value={bulkCategoryId}
              onChange={(event) => setBulkCategoryId(event.target.value)}
              disabled={isReadOnly}
            >
              <option value="">Aucune</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={() => void handleApplyBulkCategory()}
              disabled={isReadOnly || !hasSelectedLines}
            >
              Appliquer
            </button>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-[var(--slate-200)] bg-white px-2 py-1">
            <label
              className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--slate-500)]"
              htmlFor="estimate-bulk-labor-role"
            >
              Role MO
            </label>
            <select
              id="estimate-bulk-labor-role"
              className="estimate-input estimate-select"
              style={{ width: "auto", minWidth: "180px" }}
              value={bulkLaborRoleId}
              onChange={(event) => setBulkLaborRoleId(event.target.value)}
              disabled={isReadOnly}
            >
              <option value="">Aucun</option>
              {laborRoles.map((role) => (
                <option key={role.id} value={role.id} disabled={!role.is_active}>
                  {role.name}
                  {!role.is_active ? " (inactif)" : ""}
                </option>
              ))}
            </select>
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={() => void handleApplyBulkLaborRole()}
              disabled={isReadOnly || !hasSelectedLines}
            >
              Appliquer
            </button>
          </div>
          {bulkSuggestionEligibleCount > 0 ? (
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={onOpenBulkSuggestDialog}
              disabled={isReadOnly}
            >
              Appliquer les suggestions ({bulkSuggestionEligibleCount})
            </button>
          ) : null}
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={() => setIsAssemblyPickerOpen(true)}
            disabled={isReadOnly}
          >
            Assemblages
          </button>
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={() => onAddSection(null)}
            disabled={isReadOnly}
          >
            + Chapitre
          </button>
        </div>
      </div>

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
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <div
            ref={isVirtualized ? virtualScrollRef : undefined}
            className="estimate-table__body"
            style={virtualBodyStyle}
            onMouseDown={handleTableBodyMouseDown}
            role="grid"
            aria-readonly={isReadOnly}
            aria-rowcount={spreadsheetNavigationRows.length}
            aria-label="Lignes de devis"
          >
            {items.length === 0 ? (
              <div className="estimate-empty">
                <p>Aucune ligne pour le moment.</p>
                <button
                  className="btn btn-primary btn-sm"
                  type="button"
                  onClick={() => onAddSection(null)}
                  disabled={isReadOnly}
                >
                  Creer un chapitre
                </button>
              </div>
            ) : !hasVisibleRows ? (
              <div className="estimate-empty">
                <p>Aucune ligne ne correspond au filtre qualite actif.</p>
                <button
                  className="btn btn-secondary btn-sm"
                  type="button"
                  onClick={() => onQualityFilterChange("all_lines")}
                >
                  Afficher toutes les lignes
                </button>
              </div>
            ) : isVirtualized ? (
              <SortableContext
                items={virtualizedSortableIds}
                strategy={verticalListSortingStrategy}
              >
                <div
                  style={{
                    height: `${virtualTotalSize}px`,
                    position: "relative",
                    width: "100%",
                  }}
                >
                  {virtualItems.map((virtualRow) => {
                    const row = flattenedRows[virtualRow.index];
                    if (!row) return null;
                    return (
                      <div
                        key={row.key}
                        ref={measureElement}
                        data-index={virtualRow.index}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        {renderVirtualRow(row)}
                      </div>
                    );
                  })}
                </div>
              </SortableContext>
            ) : (
              renderList(null)
            )}
          </div>
        </DndContext>
      </div>

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
    </div>
  );
}
