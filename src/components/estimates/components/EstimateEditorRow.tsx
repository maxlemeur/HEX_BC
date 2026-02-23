"use client";
/* eslint-disable react-hooks/refs */

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
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
import { formatEUR, parseEuroToCents } from "@/lib/money";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];
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

const QUALITY_FLAG_CELL_TARGET: Partial<Record<EstimateQualityFlagKey, string>> = {
  missing_price: SPREADSHEET_COLUMN_KEYS.unitPrice,
  missing_quantity: SPREADSHEET_COLUMN_KEYS.quantity,
  missing_labor_time: SPREADSHEET_COLUMN_KEYS.hMo,
  missing_labor_role: SPREADSHEET_COLUMN_KEYS.laborRole,
};

const QUALITY_BADGE_CLASSNAMES: Record<EstimateQualityFlagKey, string> = {
  missing_price: "border-rose-200 bg-rose-50 text-rose-700",
  missing_quantity: "border-amber-200 bg-amber-50 text-amber-700",
  missing_labor_time: "border-orange-200 bg-orange-50 text-orange-700",
  missing_labor_role: "border-red-200 bg-red-50 text-red-700",
  price_outlier: "border-orange-200 bg-orange-50 text-orange-700",
  quantity_outlier: "border-orange-200 bg-orange-50 text-orange-700",
  supplier_price_outdated: "border-amber-200 bg-amber-50 text-amber-700",
  labor_split_incomplete: "border-orange-200 bg-orange-50 text-orange-700",
};

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
  item: EstimateItem;
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
  onAddSection: (parentId: string | null) => void;
  onAddLine: (parentId: string | null) => void;
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
  onLineSelectionInteraction: (interaction: MultiSelectItemInteraction) => void;
  sectionTotals: SectionTotals | null;
  isDragDisabled: boolean;
  isOutlierActionPending: boolean;
  isReadOnly: boolean;
  isLaborSplitEnabled: boolean;
};

export const EstimateEditorRow = memo(function EstimateEditorRow({
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
  hasSupplierComparisonMismatch,
  onAddSection,
  onAddLine,
  onDeleteItem,
  onOpenSupplierComparisonPanel,
  onOpenSupplierComparisonContextMenu,
  onOpenSectionContextMenu,
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
  visibleColumns,
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

  const indentStyle = {
    paddingLeft: `${depth * 36}px`,
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
        data-estimate-item-id={item.id}
        data-depth={depth}
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
                const isUnassigned = supplyTypeId === UNASSIGNED_SUPPLY_TYPE_KEY;
                const label = isUnassigned
                  ? "Sans categorie FO"
                  : (supplyTypeById.get(supplyTypeId)?.name ?? "Type inconnu");
                return (
                  <span
                    key={`${item.id}:supply_type:${supplyTypeId}`}
                    className={`estimate-section-total-chip${isUnassigned ? " estimate-section-total-chip--unassigned" : ""}`}
                    title={
                      isUnassigned
                        ? "Ces lignes n'ont pas de type de fourniture assigne. Cliquez pour filtrer."
                        : undefined
                    }
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
            {depth === 0 ? (
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={() => onAddSection(item.id)}
                disabled={isReadOnly}
              >
                + Sous-chapitre
              </button>
            ) : null}
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                onOpenSectionContextMenu(item.id, {
                  x: rect.left,
                  y: rect.bottom + 4,
                });
              }}
              disabled={isReadOnly}
            >
              Actions
            </button>
            <button
              className="btn btn-danger btn-sm"
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    "Êtes-vous sûr de vouloir supprimer ce chapitre et toutes ses lignes ?"
                  )
                ) {
                  onDeleteItem(item.id);
                }
              }}
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`estimate-row${isLineSelected ? " estimate-row--selected" : ""}`}
      data-estimate-item-id={item.id}
      data-depth={depth}
      role="row"
      onMouseDown={handleRowModifierSelection}
      onContextMenu={handleLineContextMenu}
    >
      <div className="estimate-cell estimate-cell--selection">
        <input
          type="checkbox"
          className="estimate-line-checkbox"
          checked={isLineSelected}
          onClick={handleLineSelectionCheckboxClick}
          readOnly
          disabled={isReadOnly}
          aria-label={`Sélectionner la ligne ${item.title || "sans titre"}`}
        />
      </div>
      <div
        {...titleCellProps}
        onKeyDown={toCellKeyDownHandler(titleCellProps.onKeyDown)}
        className={toCellClassName(
          navigation,
          titleCell,
          `estimate-cell estimate-cell--designation${!item.title.trim() && !isTitleFocused ? " estimate-cell--required-empty" : ""}`
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
          {hasSupplierComparisonMismatch ? (
            <div className="flex flex-wrap items-center gap-1">
              <span className="estimate-supplier-comparison-row-badge">
                Meilleur prix fournisseur disponible
              </span>
            </div>
          ) : null}
          {qualityFlags.length > 0 || dismissedOutlierBadges.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              {qualityFlags.map((flag) => {
                const targetColumn = QUALITY_FLAG_CELL_TARGET[flag];
                const isClickable = Boolean(targetColumn);
                return (
                  <span
                    key={flag}
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${QUALITY_BADGE_CLASSNAMES[flag]}${isClickable ? " cursor-pointer hover:opacity-80" : ""}`}
                    title={
                      ESTIMATE_QUALITY_FLAG_META[flag].description +
                      (isClickable ? " — Cliquer pour aller au champ" : "")
                    }
                    role={isClickable ? "button" : undefined}
                    onClick={
                      isClickable
                        ? () => {
                            const cellId = `${item.id}::${targetColumn!}`;
                            const el = document.querySelector<HTMLElement>(
                              `[data-cell-id="${cellId}"]`
                            );
                            el?.focus();
                          }
                        : undefined
                    }
                  >
                    {ESTIMATE_QUALITY_FLAG_META[flag].label}
                  </span>
                );
              })}
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
          `estimate-cell estimate-editable-cell${
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
      {(!visibleColumns || visibleColumns.has("supply_type") || isLaborSplitEnabled) ? (
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
      ) : null}
      {(!visibleColumns || visibleColumns.has("k_fo") || isLaborSplitEnabled) ? (
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
      ) : null}
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
          {(!visibleColumns || visibleColumns.has("h_mo_majoration")) ? (
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
          ) : null}
          {(!visibleColumns || visibleColumns.has("labor_role")) ? (
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
          ) : null}
          {(!visibleColumns || visibleColumns.has("k_mo")) ? (
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
          ) : null}
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
          className="btn btn-ghost btn-sm"
          type="button"
          onClick={() => onOpenSupplierComparisonPanel(item.id)}
        >
          Comparer
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
  );
});

DragHandle.displayName = "DragHandle";
EstimateEditorRow.displayName = "EstimateEditorRow";
