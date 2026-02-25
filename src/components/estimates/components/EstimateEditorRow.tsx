"use client";
/* eslint-disable react-hooks/refs */

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import {
  UNASSIGNED_SUPPLY_TYPE_KEY,
  type SectionTotals,
} from "@/lib/estimate-calculations";
import { EditableCell } from "@/components/estimates/EditableCell";
import { TakeoffSourceBadge } from "@/components/takeoff/TakeoffSourceBadge";
import { type MultiSelectItemInteraction } from "@/hooks/useMultiSelect";
import {
  type SpreadsheetCell,
  type SpreadsheetNavigationResult,
} from "@/hooks/useSpreadsheetNavigation";
import {
  ESTIMATE_QUALITY_FLAG_META,
  type EstimateQualityFlagKey,
} from "@/lib/estimate-quality";
import {
  ESTIMATE_OUTLIER_FLAG_KEYS,
  type EstimateOutlierFlagKey,
} from "@/lib/estimates/outlier-detection";
import {
  formatCurrency,
  normalizeEstimateCurrency,
  parseCurrencyToCents,
  type SupportedEstimateCurrency,
} from "@/lib/money";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"] & {
  source_provider?: string | null;
  source_job_id?: string | null;
  source_file_name?: string | null;
  source_page?: number | null;
  source_level?: string | null;
  takeoff_level?: string | null;
  source_extracted_at?: string | null;
  source_extraction_date?: string | null;
  extraction_date?: string | null;
  extracted_at?: string | null;
  source_metadata?: unknown;
};
type SupplyType = Database["public"]["Tables"]["supply_types"]["Row"];
type LaborRole = Database["public"]["Tables"]["labor_roles"]["Row"];
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

const CATALOGUE_SUGGESTIONS_DEBOUNCE_MS = 300;

export const SPREADSHEET_COLUMN_KEYS = {
  aid: "aid",
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

const SECTION_SPREADSHEET_COLUMN_KEYS = [
  SPREADSHEET_COLUMN_KEYS.aid,
  SPREADSHEET_COLUMN_KEYS.title,
];
const LINE_SPREADSHEET_COLUMN_KEYS = [
  SPREADSHEET_COLUMN_KEYS.aid,
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
  SPREADSHEET_COLUMN_KEYS.aid,
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

function getQualityFlagCellTarget(
  flag: EstimateQualityFlagKey,
  options: {
    isLaborSplitEnabled: boolean;
    isLaborRoleVisible: boolean;
  }
) {
  switch (flag) {
    case "missing_price":
      return SPREADSHEET_COLUMN_KEYS.unitPrice;
    case "missing_quantity":
      return SPREADSHEET_COLUMN_KEYS.quantity;
    case "missing_labor_time":
      return options.isLaborSplitEnabled
        ? SPREADSHEET_COLUMN_KEYS.hMoAtelier
        : SPREADSHEET_COLUMN_KEYS.hMo;
    case "missing_labor_role":
      if (options.isLaborSplitEnabled) {
        return SPREADSHEET_COLUMN_KEYS.laborRoleAtelier;
      }
      return options.isLaborRoleVisible
        ? SPREADSHEET_COLUMN_KEYS.laborRole
        : null;
    case "labor_split_incomplete":
      return options.isLaborSplitEnabled
        ? SPREADSHEET_COLUMN_KEYS.hMoAtelier
        : null;
    default:
      return null;
  }
}

type SortableReturn = ReturnType<typeof useSortable>;
type DragHandleProps = {
  listeners?: SortableReturn["listeners"];
  attributes?: SortableReturn["attributes"];
  disabled?: boolean;
};

function toCellClassName(
  navigation: SpreadsheetNavigationResult,
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
      aria-label="Glisser pour réordonner"
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

function normalizeAidInput(value: string) {
  const normalized = value.trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
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

function resolveDisplayCurrency(
  value: string | null | undefined,
  fallback: SupportedEstimateCurrency
) {
  return normalizeEstimateCurrency(value) ?? fallback;
}

function toFiniteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toNonEmptyString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readSourceMetadataText(
  item: EstimateItem,
  keys: string[]
) {
  const itemRecord = item as Record<string, unknown>;

  for (const key of keys) {
    const directValue = toNonEmptyString(itemRecord[key]);
    if (directValue) {
      return directValue;
    }
  }

  const sourceMetadata = itemRecord.source_metadata;
  if (
    typeof sourceMetadata === "object" &&
    sourceMetadata !== null &&
    !Array.isArray(sourceMetadata)
  ) {
    const metadataRecord = sourceMetadata as Record<string, unknown>;
    for (const key of keys) {
      const metadataValue = toNonEmptyString(metadataRecord[key]);
      if (metadataValue) {
        return metadataValue;
      }
    }
  }

  return null;
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

export function getSpreadsheetColumnKeys(
  itemType: EstimateItem["item_type"],
  isLaborSplitEnabled: boolean
) {
  return itemType === "section"
    ? SECTION_SPREADSHEET_COLUMN_KEYS
    : isLaborSplitEnabled
      ? LINE_SPREADSHEET_COLUMN_KEYS_LABOR_SPLIT
      : LINE_SPREADSHEET_COLUMN_KEYS;
}

export type ColumnVisibilitySet = Set<"supply_type" | "k_fo" | "h_mo_majoration" | "labor_role" | "k_mo">;

export type EstimateEditorRowProps = {
  versionId: string;
  estimateCurrency: SupportedEstimateCurrency;
  item: EstimateItem;
  itemNumber?: string | null;
  depth: number;
  unitValue: string;
  supplyTypeValue: string;
  qualityFlags: EstimateQualityFlagKey[];
  detectedOutlierFlags: EstimateOutlierFlagKey[];
  dismissedOutlierFlags: EstimateOutlierFlagKey[];
  supplyTypeById: Map<string, SupplyType>;
  laborRoles: LaborRole[];
  navigation: SpreadsheetNavigationResult;
  isLineSelected: boolean;
  hasSupplierComparisonMismatch: boolean;
  visibleColumns?: ColumnVisibilitySet;
  onDeleteItem: (itemId: string) => void;
  onOpenSupplierComparisonPanel: (itemId: string) => void;
  onOpenSupplierComparisonContextMenu: (
    itemId: string,
    position: { x: number; y: number }
  ) => void;
  onOpenSectionContextMenu: (
    sectionId: string,
    position: { x: number; y: number }
  ) => void;
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
  onAddLine: (parentId: string | null) => void;
  onAddSection: (parentId: string | null) => void;
  onConvertLineToSection: (lineId: string) => void;
  onLineSelectionInteraction: (interaction: MultiSelectItemInteraction) => void;
  sectionTotals: SectionTotals | null;
  isDragDisabled: boolean;
  isOutlierActionPending: boolean;
  isReadOnly: boolean;
  isLaborSplitEnabled: boolean;
  isSearchMatch?: boolean;
  isLastChild?: boolean;
  parentIsLastChild?: boolean;
};

export const EstimateEditorRow = memo(function EstimateEditorRow({
  versionId,
  estimateCurrency,
  item,
  itemNumber,
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
  hasSupplierComparisonMismatch,
  onDeleteItem,
  onOpenSupplierComparisonPanel,
  onOpenSupplierComparisonContextMenu,
  onOpenSectionContextMenu,
  onPatchItem,
  onUnitChange,
  onUnitCommit,
  onSupplyTypeChange,
  onSupplyTypeCommit,
  onAddLine,
  onAddSection,
  onConvertLineToSection,
  onToggleOutlierDismiss,
  onLineSelectionInteraction,
  sectionTotals,
  isDragDisabled,
  isOutlierActionPending,
  isReadOnly,
  isLaborSplitEnabled,
  visibleColumns,
  isSearchMatch,
  isLastChild,
  parentIsLastChild,
}: EstimateEditorRowProps) {
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

  const indentStyle: CSSProperties & { "--row-depth": string } = {
    "--row-depth": String(depth),
    paddingLeft: "calc(var(--tree-indent) * var(--row-depth))",
  };

  const aidCell: SpreadsheetCell = {
    rowId: item.id,
    columnKey: SPREADSHEET_COLUMN_KEYS.aid,
  };
  const aidCellProps = navigation.getCellProps(aidCell);
  const aidEditorProps = navigation.getEditorProps<HTMLInputElement>(aidCell);
  const aidValue = typeof item.aid === "string" ? item.aid : "";
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
        data-estimate-item-id={item.id}
        data-depth={depth}
        data-is-last-child={isLastChild || undefined}
        data-parent-is-last-child={parentIsLastChild || undefined}
        role="row"
        onContextMenu={(event) => {
          const target = event.target as HTMLElement;
          if (
            target.closest(
              "input,select,textarea,button,a,[contenteditable=''],[contenteditable='true'],[contenteditable='plaintext-only']"
            )
          ) {
            return;
          }

          event.preventDefault();
          onOpenSectionContextMenu(item.id, {
            x: event.clientX,
            y: event.clientY,
          });
        }}
      >
        <div
          {...aidCellProps}
          role="gridcell"
          onKeyDown={toCellKeyDownHandler(aidCellProps.onKeyDown)}
          className={toCellClassName(
            navigation,
            aidCell,
            "estimate-cell estimate-cell--aid"
          )}
        >
          <input
            className="estimate-input estimate-input--aid"
            ref={aidEditorProps.ref}
            tabIndex={aidEditorProps.tabIndex}
            value={aidValue}
            title={aidValue}
            disabled={isReadOnly}
            placeholder="MT.TY.0001"
            onFocus={aidEditorProps.onFocus}
            onKeyDown={aidEditorProps.onKeyDown}
            onChange={(event) =>
              onPatchItem(item.id, { aid: event.target.value }, { persist: false })
            }
            onBlur={(event) => {
              aidEditorProps.onBlur(event);
              onPatchItem(
                item.id,
                { aid: normalizeAidInput(event.target.value) },
                { persist: true }
              );
            }}
          />
        </div>
        <div
          {...titleCellProps}
          role="gridcell"
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
          <div className="estimate-section-hover-actions">
            <button
              className="estimate-section-hover-btn"
              type="button"
              onClick={() => onAddLine(item.id)}
              disabled={isReadOnly}
            >
              + Ligne
            </button>
            {depth === 0 && (
              <button
                className="estimate-section-hover-btn"
                type="button"
                onClick={() => onAddSection(item.id)}
                disabled={isReadOnly}
              >
                + Sous-chap
              </button>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {itemNumber ? (
              <span className="font-mono text-[11px] font-semibold text-[var(--slate-500)]">
                {itemNumber}
              </span>
            ) : null}
            <input
              className="estimate-input estimate-input--title"
              ref={titleEditorProps.ref}
              tabIndex={titleEditorProps.tabIndex}
              value={item.title}
              title={item.title}
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
          </div>
        </div>
        {/* qty */}
        <div />
        {/* unit */}
        <div />
        {/* PR.FO total */}
        <div
          className="estimate-section-total-cell estimate-section-total-cell--fo"
          title={supplyTypeEntries.length > 0
            ? supplyTypeEntries.map(([id, cents]) => {
                const isUnassigned = id === UNASSIGNED_SUPPLY_TYPE_KEY;
                const label = isUnassigned
                  ? "Sans catégorie FO"
                  : (supplyTypeById.get(id)?.name ?? "Type inconnu");
                return `${label} : ${formatCurrency(cents, estimateCurrency)}`;
              }).join("\n")
            : undefined}
        >
          FO {formatCurrency(sectionTotals?.foTotalCents ?? 0, estimateCurrency)}
        </div>
        {isLaborSplitEnabled ? (
          <>
            <div />{/* supply_type */}
            <div />{/* k_fo */}
            <div />{/* h_mo_majoration */}
            <div className="estimate-section-total-cell estimate-section-total-cell--mo">
              MO at.{" "}
              {formatCurrency(sectionTotals?.moAtelierTotalCents ?? 0, estimateCurrency)}
            </div>
            <div />{/* labor_role_atelier */}
            <div />{/* k_mo_atelier */}
            <div className="estimate-section-total-cell estimate-section-total-cell--mo">
              MO ch.{" "}
              {formatCurrency(sectionTotals?.moChantierTotalCents ?? 0, estimateCurrency)}
            </div>
            <div />{/* labor_role_chantier */}
            <div />{/* k_mo_chantier */}
          </>
        ) : (
          <>
            {(!visibleColumns || visibleColumns.has("supply_type")) ? <div /> : null}
            {(!visibleColumns || visibleColumns.has("k_fo")) ? <div /> : null}
            <div className="estimate-section-total-cell estimate-section-total-cell--mo">
              MO {formatCurrency(sectionTotals?.moTotalCents ?? 0, estimateCurrency)}
            </div>
            {(!visibleColumns || visibleColumns.has("h_mo_majoration")) ? <div /> : null}
            {(!visibleColumns || visibleColumns.has("labor_role")) ? <div /> : null}
            {(!visibleColumns || visibleColumns.has("k_mo")) ? <div /> : null}
          </>
        )}
        {/* PU */}
        <div />
        {/* total HT */}
        <div
          className="estimate-section-total-cell estimate-section-total-cell--ht"
          title={`TTC ${formatCurrency(sectionTotals?.totalTtcCents ?? 0, estimateCurrency)}`}
        >
          HT {formatCurrency(sectionTotals?.totalHtCents ?? 0, estimateCurrency)}
        </div>
        {/* actions */}
        <div className="estimate-cell estimate-cell--actions">
          <button
            className="estimate-section-more-btn"
            type="button"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              onOpenSectionContextMenu(item.id, {
                x: rect.left,
                y: rect.bottom + 4,
              });
            }}
            disabled={isReadOnly}
            aria-label="Actions"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="3" cy="8" r="1.5" />
              <circle cx="8" cy="8" r="1.5" />
              <circle cx="13" cy="8" r="1.5" />
            </svg>
          </button>
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

  const handleLineContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (item.item_type !== "line") return;

    const target = event.target as HTMLElement;
    if (
      target.closest(
        "input,select,textarea,button,a,[contenteditable=''],[contenteditable='true'],[contenteditable='plaintext-only']"
      )
    ) {
      return;
    }

    event.preventDefault();
    onOpenSupplierComparisonContextMenu(item.id, {
      x: event.clientX,
      y: event.clientY,
    });
  };
  const isLaborRoleVisible =
    isLaborSplitEnabled || !visibleColumns || visibleColumns.has("labor_role");
  const sourceLevel = readSourceMetadataText(item, [
    "source_level",
    "takeoff_level",
    "level",
  ]);
  const sourceExtractedAt = readSourceMetadataText(item, [
    "source_extracted_at",
    "source_extraction_date",
    "takeoff_extracted_at",
    "extracted_at",
    "extraction_date",
  ]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`estimate-row${isLineSelected ? " estimate-row--selected" : ""}${isSearchMatch ? " ring-2 ring-yellow-300 rounded" : ""}`}
      data-estimate-item-id={item.id}
      data-depth={depth}
      data-is-last-child={isLastChild || undefined}
      data-parent-is-last-child={parentIsLastChild || undefined}
      role="row"
      onMouseDown={handleRowModifierSelection}
      onContextMenu={handleLineContextMenu}
    >
      <div
        {...aidCellProps}
        role="gridcell"
        onKeyDown={toCellKeyDownHandler(aidCellProps.onKeyDown)}
        className={toCellClassName(
          navigation,
          aidCell,
          "estimate-cell estimate-cell--aid"
        )}
      >
        <input
          className="estimate-input estimate-input--aid"
          ref={aidEditorProps.ref}
          tabIndex={aidEditorProps.tabIndex}
          value={aidValue}
          title={aidValue}
          disabled={isReadOnly}
          placeholder="MT.TY.0001"
          onFocus={aidEditorProps.onFocus}
          onKeyDown={aidEditorProps.onKeyDown}
          onChange={(event) =>
            onPatchItem(item.id, { aid: event.target.value }, { persist: false })
          }
          onBlur={(event) => {
            aidEditorProps.onBlur(event);
            onPatchItem(
              item.id,
              { aid: normalizeAidInput(event.target.value) },
              { persist: true }
            );
          }}
        />
      </div>
      <div
        {...titleCellProps}
        role="gridcell"
        onKeyDown={toCellKeyDownHandler(titleCellProps.onKeyDown)}
        className={toCellClassName(
          navigation,
          titleCell,
          `estimate-cell estimate-cell--designation${!item.title.trim() && !isTitleFocused ? " estimate-cell--required-empty" : ""}`
        )}
        style={indentStyle}
      >
        <input
          type="checkbox"
          className="estimate-line-checkbox"
          checked={isLineSelected}
          onClick={handleLineSelectionCheckboxClick}
          readOnly
          disabled={isReadOnly}
          aria-label={`Sélectionner la ligne ${item.title || "sans titre"}`}
        />
        <DragHandle
          listeners={listeners}
          attributes={attributes}
          disabled={isReadOnly || isDragDisabled}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {itemNumber ? (
            <span className="font-mono text-[11px] font-semibold text-[var(--slate-500)]">
              {itemNumber}
            </span>
          ) : null}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <input
              className="estimate-input estimate-input--title"
              ref={titleEditorProps.ref}
              tabIndex={titleEditorProps.tabIndex}
              value={item.title}
              title={item.title}
              disabled={isReadOnly}
              placeholder="Obligatoire"
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
            <TakeoffSourceBadge
              versionId={versionId}
              sourceProvider={item.source_provider}
              sourceJobId={item.source_job_id}
              sourceFileName={item.source_file_name}
              sourcePage={item.source_page}
              sourceLevel={sourceLevel}
              extractedAt={sourceExtractedAt}
            />
            {qualityFlags.length > 0 || dismissedOutlierBadges.length > 0 ? (
              <div className="estimate-quality-dots">
                {qualityFlags.slice(0, 3).map((flag) => {
                  const targetColumn = getQualityFlagCellTarget(flag, {
                    isLaborSplitEnabled,
                    isLaborRoleVisible,
                  });
                  const isClickable = Boolean(targetColumn);
                  const focusTargetCell = () => {
                    if (!targetColumn) return;
                    const cellId = `${item.id}::${targetColumn}`;
                    const el = document.querySelector<HTMLElement>(
                      `[data-cell-id="${cellId}"]`
                    );
                    el?.focus();
                  };

                  if (isClickable) {
                    return (
                      <span
                        key={flag}
                        className={`estimate-quality-dot estimate-quality-dot--${flag.replace(/_/g, "-")}`}
                        title={`${ESTIMATE_QUALITY_FLAG_META[flag].label} — Cliquer pour aller au champ`}
                        role="button"
                        tabIndex={0}
                        onClick={focusTargetCell}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            focusTargetCell();
                          }
                        }}
                      />
                    );
                  }

                  return (
                    <span
                      key={flag}
                      className={`estimate-quality-dot estimate-quality-dot--${flag.replace(/_/g, "-")}`}
                      title={ESTIMATE_QUALITY_FLAG_META[flag].label}
                    />
                  );
                })}
                {qualityFlags.length > 3 ? (
                  <span
                    className="estimate-quality-overflow"
                    title={qualityFlags
                      .slice(3)
                      .map((f) => ESTIMATE_QUALITY_FLAG_META[f].label)
                      .join(", ")}
                  >
                    +{qualityFlags.length - 3}
                  </span>
                ) : null}
                {dismissedOutlierBadges.map((flag) => (
                  <span
                    key={`dismissed:${flag}`}
                    className="estimate-quality-dot estimate-quality-dot--dismissed"
                    title={`${ESTIMATE_QUALITY_FLAG_META[flag].label} (accepté)`}
                  />
                ))}
              </div>
            ) : null}
          </div>
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
                        {formatCurrency(
                          suggestion.adjusted_unit_price_cents,
                          resolveDisplayCurrency(
                            suggestion.currency,
                            estimateCurrency
                          )
                        )}
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
                          {formatCurrency(
                            alternative.adjusted_unit_price_cents,
                            resolveDisplayCurrency(
                              alternative.currency,
                              estimateCurrency
                            )
                          )} |
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
          {hasSupplierComparisonMismatch ? (
            <div className="flex flex-wrap items-center gap-1">
              <span className="estimate-supplier-comparison-row-badge">
                Meilleur prix fournisseur disponible
              </span>
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
                      ? `Réactiver ${ESTIMATE_QUALITY_FLAG_META[flag].label}`
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
          }${!item.quantity ? " estimate-cell--required-empty" : ""}`
        )}
        inputClassName="estimate-input"
        type="number"
        step="0.001"
        min={0}
        placeholder="Obligatoire"
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
        role="gridcell"
        onKeyDown={toCellKeyDownHandler(unitCellProps.onKeyDown)}
        className={toCellClassName(navigation, unitCell, `estimate-cell${!unitValue.trim() ? " estimate-cell--required-empty" : ""}`)}
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
          placeholder="Obligatoire"
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
          `estimate-cell estimate-editable-cell estimate-col--fo${
            priceOutlierActive ? " bg-orange-50 ring-1 ring-inset ring-orange-300" : ""
          }${!item.unit_price_ht_cents ? " estimate-cell--required-empty" : ""}`
        )}
        inputClassName="estimate-input"
        type="number"
        step="0.01"
        min={0}
        placeholder="Obligatoire"
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
            {
              unit_price_ht_cents:
                parseCurrencyToCents(value, estimateCurrency) ?? 0,
            },
            { persist: false }
          )
        }
        onCommit={(value) =>
          onPatchItem(
            item.id,
            {
              unit_price_ht_cents:
                parseCurrencyToCents(value, estimateCurrency) ?? 0,
            },
            { persist: true }
          )
        }
      />
      {(!visibleColumns || visibleColumns.has("supply_type") || isLaborSplitEnabled) ? (
        <div
          {...supplyTypeCellProps}
          role="gridcell"
          onKeyDown={toCellKeyDownHandler(supplyTypeCellProps.onKeyDown)}
          className={toCellClassName(navigation, supplyTypeCell, "estimate-cell estimate-col--fo")}
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
      ) : null}
      {(!visibleColumns || visibleColumns.has("k_fo") || isLaborSplitEnabled) ? (
        <div
          {...kFoCellProps}
          role="gridcell"
          onKeyDown={toCellKeyDownHandler(kFoCellProps.onKeyDown)}
          className={toCellClassName(navigation, kFoCell, "estimate-cell estimate-col--fo")}
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
      ) : null}
      {isLaborSplitEnabled ? (
        <>
          <div
            {...hMoMajorationCellProps}
            role="gridcell"
            onKeyDown={toCellKeyDownHandler(hMoMajorationCellProps.onKeyDown)}
            className={toCellClassName(navigation, hMoMajorationCell, "estimate-cell estimate-col--mo")}
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
            role="gridcell"
            onKeyDown={toCellKeyDownHandler(hMoAtelierCellProps.onKeyDown)}
            className={toCellClassName(navigation, hMoAtelierCell, `estimate-cell estimate-col--mo${qualityFlags.includes("labor_split_incomplete") ? " estimate-cell--warning-empty" : ""}`)}
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
            role="gridcell"
            onKeyDown={toCellKeyDownHandler(laborRoleAtelierCellProps.onKeyDown)}
            className={toCellClassName(
              navigation,
              laborRoleAtelierCell,
              "estimate-cell estimate-col--mo"
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
            role="gridcell"
            onKeyDown={toCellKeyDownHandler(kMoAtelierCellProps.onKeyDown)}
            className={toCellClassName(navigation, kMoAtelierCell, "estimate-cell estimate-col--mo")}
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
            role="gridcell"
            onKeyDown={toCellKeyDownHandler(hMoChantierCellProps.onKeyDown)}
            className={toCellClassName(navigation, hMoChantierCell, `estimate-cell estimate-col--mo${qualityFlags.includes("labor_split_incomplete") ? " estimate-cell--warning-empty" : ""}`)}
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
            role="gridcell"
            onKeyDown={toCellKeyDownHandler(laborRoleChantierCellProps.onKeyDown)}
            className={toCellClassName(
              navigation,
              laborRoleChantierCell,
              "estimate-cell estimate-col--mo"
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
            role="gridcell"
            onKeyDown={toCellKeyDownHandler(kMoChantierCellProps.onKeyDown)}
            className={toCellClassName(navigation, kMoChantierCell, "estimate-cell estimate-col--mo")}
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
            role="gridcell"
            onKeyDown={toCellKeyDownHandler(hMoCellProps.onKeyDown)}
            className={toCellClassName(navigation, hMoCell, `estimate-cell estimate-col--mo${qualityFlags.includes("missing_labor_time") ? " estimate-cell--warning-empty" : ""}`)}
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
          {(!visibleColumns || visibleColumns.has("h_mo_majoration")) ? (
            <div
              {...hMoMajorationCellProps}
              role="gridcell"
              onKeyDown={toCellKeyDownHandler(hMoMajorationCellProps.onKeyDown)}
              className={toCellClassName(navigation, hMoMajorationCell, "estimate-cell estimate-col--mo")}
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
          ) : null}
          {(!visibleColumns || visibleColumns.has("labor_role")) ? (
            <div
              {...laborRoleCellProps}
              role="gridcell"
              onKeyDown={toCellKeyDownHandler(laborRoleCellProps.onKeyDown)}
              className={toCellClassName(navigation, laborRoleCell, `estimate-cell estimate-col--mo${qualityFlags.includes("missing_labor_role") ? " estimate-cell--warning-empty" : ""}`)}
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
          ) : null}
          {(!visibleColumns || visibleColumns.has("k_mo")) ? (
            <div
              {...kMoCellProps}
              role="gridcell"
              onKeyDown={toCellKeyDownHandler(kMoCellProps.onKeyDown)}
              className={toCellClassName(navigation, kMoCell, "estimate-cell estimate-col--mo")}
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
          ) : null}
        </>
      )}
      <div
        {...puCellProps}
        role="gridcell"
        onKeyDown={toCellKeyDownHandler(puCellProps.onKeyDown)}
        className={toCellClassName(
          navigation,
          puCell,
          "estimate-cell estimate-cell--readonly estimate-cell--pu-separator"
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
        role="gridcell"
        onKeyDown={toCellKeyDownHandler(totalCellProps.onKeyDown)}
        className={toCellClassName(
          navigation,
          totalCell,
          "estimate-cell estimate-cell--total estimate-cell--readonly"
        )}
      >
        <span>{formatCurrency(lineTotal, estimateCurrency)}</span>
      </div>
      <div className="estimate-cell estimate-cell--actions">
        <details className="relative">
          <summary
            className="btn btn-ghost btn-sm cursor-pointer list-none select-none"
            title="Plus d'actions"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="5" r="1" />
              <circle cx="12" cy="12" r="1" />
              <circle cx="12" cy="19" r="1" />
            </svg>
          </summary>
          <div className="absolute right-0 top-full z-20 mt-1 flex flex-col gap-1 rounded-xl border border-[var(--slate-200)] bg-white p-2 shadow-xl" style={{ minWidth: "140px" }}>
            <button
              className="btn btn-ghost btn-sm w-full justify-start"
              type="button"
              onClick={() => onOpenSupplierComparisonPanel(item.id)}
            >
              Comparer
            </button>
            <button
              className="btn btn-ghost btn-sm w-full justify-start"
              type="button"
              onClick={() => onConvertLineToSection(item.id)}
              disabled={isReadOnly}
            >
              Convertir en section
            </button>
            <button
              className="btn btn-danger btn-sm w-full justify-start"
              type="button"
              onClick={() => onDeleteItem(item.id)}
              disabled={isReadOnly}
            >
              Supprimer
            </button>
          </div>
        </details>
      </div>
    </div>
  );
});

DragHandle.displayName = "DragHandle";
EstimateEditorRow.displayName = "EstimateEditorRow";
