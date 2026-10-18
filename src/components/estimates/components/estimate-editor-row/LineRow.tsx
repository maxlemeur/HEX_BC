"use client";

import { formatDecimalInput } from "@/lib/numeric-input/parsers";

import dynamic from "next/dynamic";

import { EstimateOrderedCells } from "@/components/estimates/context/EstimateColumnOrderContext";
import type { SupplierComparisonResult } from "@/components/estimates/hooks/useEstimateSupplierComparison";

import { EstimateTypeCombobox } from "@/components/estimates/EstimateTypeCombobox";
import type { EstimateTypeOption } from "@/lib/estimates/type-search";

import {
  useMemo,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import { EditableCell } from "@/components/estimates/EditableCell";
import { computeEstimateLineMargin, formatMarkupRatio } from "@/lib/estimates/line-margin";
import { DecimalDraftInput } from "@/components/estimates/components/estimate-editor-row/DecimalDraftInput";
import { hasTakeoffSourceBadge } from "@/lib/takeoff/source-badge";
import { Popover } from "@/components/ui-legacy/Popover";
import { EstimateLineTruthBadges } from "@/components/estimates/components/estimate-editor-row/EstimateLineTruthBadges";
import {
  ESTIMATE_QUALITY_FLAG_META,
  type EstimateQualityFlagKey,
} from "@/lib/estimate-quality";
import { ESTIMATE_OUTLIER_FLAG_KEYS, type EstimateOutlierFlagKey } from "@/lib/estimates/outlier-detection";
import {
  buildTreeConnectorSegments,
  type TreeConnectorMeta,
} from "@/lib/estimates/tree-connectors";
import {
  formatCurrency,
  parseCurrencyToCents,
  type SupportedEstimateCurrency,
} from "@/lib/money";
import {
  type SpreadsheetCell,
  type SpreadsheetCellProps,
  type SpreadsheetEditorProps,
  type SpreadsheetNavigationResult,
} from "@/hooks/useSpreadsheetNavigation";
import { CatalogueSuggestionsPopover } from "@/components/estimates/components/estimate-editor-row/CatalogueSuggestionsPopover";
import { LaborSplitCells } from "@/components/estimates/components/estimate-editor-row/LaborSplitCells";
import { StandardMoCells } from "@/components/estimates/components/estimate-editor-row/StandardMoCells";
import { EstimateLineNatureSelect } from "@/components/estimates/components/estimate-editor-row/EstimateLineNatureSelect";
import { readEstimateV3GridLineMargin, useEstimateV3Grid, V3LineStateControls, V3UnitCell } from "@/components/estimates/v3/V3LineCells";
import { ESTIMATE_V3_ITEM_CONVERSION_REASON } from "@/lib/estimates/v3-editor";
import {
  type CataloguePriceSuggestion,
  type ColumnVisibilitySet,
  type EstimateItem,
  type ItemPatch,
  type LaborRole,
  type SupplierAlternative,
  formatCentsInput,
  formatNumberDisplay,
  getQualityFlagCellTarget,
  parseCoefficientDraft,
  parseQuantityInput,
  readLaborSplitFields,
  toCellClassName,
  toCellKeyDownHandler,
} from "@/components/estimates/components/estimate-editor-row/shared";
import { EllipsisVerticalIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const TakeoffSourceBadge = dynamic(
  () => import("@/components/takeoff/TakeoffSourceBadge").then((module) => module.TakeoffSourceBadge),
  {
    ssr: false,
    loading: () => <span role="status">Chargement de la provenance…</span>,
  }
);

type LineRowProps = {
  versionId: string;
  item: EstimateItem;
  depth: number;
  estimateCurrency: SupportedEstimateCurrency;
  navigation: SpreadsheetNavigationResult;
  indentStyle: CSSProperties & { "--row-depth": string };
  style: CSSProperties;
  setNodeRef: (element: HTMLElement | null) => void;
  treeConnectorMeta: TreeConnectorMeta;
  titleCell: SpreadsheetCell;
  titleCellProps: SpreadsheetCellProps;
  titleEditorProps: SpreadsheetEditorProps<HTMLInputElement>;
  quantityCell: SpreadsheetCell;
  unitCell: SpreadsheetCell;
  unitCellProps: SpreadsheetCellProps;
  unitEditorProps: SpreadsheetEditorProps<HTMLInputElement>;
  unitPriceCell: SpreadsheetCell;
  supplyTypeCell: SpreadsheetCell;
  supplyTypeCellProps: SpreadsheetCellProps;
  supplyTypeEditorProps: SpreadsheetEditorProps<HTMLInputElement>;
  supplierCell: SpreadsheetCell;
  supplierCellProps: SpreadsheetCellProps;
  kFoCell: SpreadsheetCell;
  kFoCellProps: SpreadsheetCellProps;
  kFoEditorProps: SpreadsheetEditorProps<HTMLInputElement>;
  hMoCell: SpreadsheetCell;
  hMoCellProps: SpreadsheetCellProps;
  hMoEditorProps: SpreadsheetEditorProps<HTMLInputElement>;
  hMoMajorationCell: SpreadsheetCell;
  hMoMajorationCellProps: SpreadsheetCellProps;
  hMoMajorationEditorProps: SpreadsheetEditorProps<HTMLInputElement>;
  laborRoleCell: SpreadsheetCell;
  laborRoleCellProps: SpreadsheetCellProps;
  laborRoleEditorProps: SpreadsheetEditorProps<HTMLInputElement>;
  kMoCell: SpreadsheetCell;
  kMoCellProps: SpreadsheetCellProps;
  kMoEditorProps: SpreadsheetEditorProps<HTMLInputElement>;
  hMoAtelierCell: SpreadsheetCell;
  hMoAtelierCellProps: SpreadsheetCellProps;
  hMoAtelierEditorProps: SpreadsheetEditorProps<HTMLInputElement>;
  laborRoleAtelierCell: SpreadsheetCell;
  laborRoleAtelierCellProps: SpreadsheetCellProps;
  laborRoleAtelierEditorProps: SpreadsheetEditorProps<HTMLInputElement>;
  kMoAtelierCell: SpreadsheetCell;
  kMoAtelierCellProps: SpreadsheetCellProps;
  kMoAtelierEditorProps: SpreadsheetEditorProps<HTMLInputElement>;
  hMoChantierCell: SpreadsheetCell;
  hMoChantierCellProps: SpreadsheetCellProps;
  hMoChantierEditorProps: SpreadsheetEditorProps<HTMLInputElement>;
  laborRoleChantierCell: SpreadsheetCell;
  laborRoleChantierCellProps: SpreadsheetCellProps;
  laborRoleChantierEditorProps: SpreadsheetEditorProps<HTMLInputElement>;
  kMoChantierCell: SpreadsheetCell;
  kMoChantierCellProps: SpreadsheetCellProps;
  kMoChantierEditorProps: SpreadsheetEditorProps<HTMLInputElement>;
  puCell: SpreadsheetCell;
  puCellProps: SpreadsheetCellProps;
  totalCell: SpreadsheetCell;
  totalCellProps: SpreadsheetCellProps;
  unitValue: string;
  supplyTypeOptions: readonly EstimateTypeOption[];
  qualityFlags: EstimateQualityFlagKey[];
  detectedOutlierFlags: EstimateOutlierFlagKey[];
  dismissedOutlierFlags: EstimateOutlierFlagKey[];
  laborRoles: LaborRole[];
  visibleColumns?: ColumnVisibilitySet;
  isLineSelected: boolean;
  hasSupplierComparisonMismatch: boolean;
  supplierComparison?: SupplierComparisonResult;
  isOutlierActionPending: boolean;
  isReadOnly: boolean;
  hideEditingActions: boolean;
  isLaborSplitEnabled: boolean;
  isPendingCreate: boolean;
  isHighlighted?: boolean;
  isSearchMatch?: boolean;
  lineTotal: number;
  kFoValue: number;
  hMoValue: number;
  hMoMajorationPercent: string;
  kMoValue: number;
  sourceLevel: string | null;
  sourceExtractedAt: string | null;
  sourceMetadata: unknown;
  showCatalogueSuggestions: boolean;
  catalogueListboxId: string;
  catalogueSuggestions: CataloguePriceSuggestion[];
  isCatalogueLoading: boolean;
  catalogueError: string | null;
  activeCatalogueSuggestionIndex: number;
  onApplyCatalogueSuggestion: (
    suggestion: CataloguePriceSuggestion,
    alternative?: SupplierAlternative,
  ) => void;
  handleLineTitleFocus: (event: FocusEvent<HTMLInputElement>) => void;
  handleLineTitleBlur: (event: FocusEvent<HTMLInputElement>) => void;
  handleLineTitleKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  dragHandle: ReactNode;
  onPatchItem: (
    itemId: string,
    patch: ItemPatch,
    options?: { persist?: boolean },
  ) => void;
  onUnitChange: (itemId: string, value: string) => void;
  onUnitCommit: (itemId: string) => void;
  onDeleteItem: (itemId: string) => void;
  onOpenArticle?: (itemId: string) => void;
  onAssociateArticle?: (itemId: string) => void;
  onOpenSupplierComparisonPanel: (itemId: string) => void;
  onOpenSupplierComparisonContextMenu: (
    itemId: string,
    position: { x: number; y: number },
  ) => void;
  onConvertLineToSection: (lineId: string) => void;
  onToggleOutlierDismiss: (
    itemId: string,
    flagKey: EstimateOutlierFlagKey,
    dismissed: boolean,
  ) => void;
  onLineSelectionInteraction: (interaction: {
    id: string;
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
  }) => void;
  onOpenMobileEditor?: (itemId: string) => void;
};

export function LineRow({
  versionId,
  item,
  depth,
  estimateCurrency,
  navigation,
  indentStyle,
  style,
  setNodeRef,
  treeConnectorMeta,
  titleCell,
  titleCellProps,
  titleEditorProps,
  quantityCell,
  unitCell,
  unitCellProps,
  unitEditorProps,
  unitPriceCell,
  supplyTypeCell,
  supplyTypeCellProps,
  supplyTypeEditorProps,
  supplierCell,
  supplierCellProps,
  kFoCell,
  kFoCellProps,
  kFoEditorProps,
  hMoCell,
  hMoCellProps,
  hMoEditorProps,
  hMoMajorationCell,
  hMoMajorationCellProps,
  hMoMajorationEditorProps,
  laborRoleCell,
  laborRoleCellProps,
  laborRoleEditorProps,
  kMoCell,
  kMoCellProps,
  kMoEditorProps,
  hMoAtelierCell,
  hMoAtelierCellProps,
  hMoAtelierEditorProps,
  laborRoleAtelierCell,
  laborRoleAtelierCellProps,
  laborRoleAtelierEditorProps,
  kMoAtelierCell,
  kMoAtelierCellProps,
  kMoAtelierEditorProps,
  hMoChantierCell,
  hMoChantierCellProps,
  hMoChantierEditorProps,
  laborRoleChantierCell,
  laborRoleChantierCellProps,
  laborRoleChantierEditorProps,
  kMoChantierCell,
  kMoChantierCellProps,
  kMoChantierEditorProps,
  puCell,
  puCellProps,
  totalCell,
  totalCellProps,
  unitValue,
  supplyTypeOptions,
  qualityFlags,
  detectedOutlierFlags,
  dismissedOutlierFlags,
  laborRoles,
  visibleColumns,
  isLineSelected,
  hasSupplierComparisonMismatch,
  supplierComparison,
  isOutlierActionPending,
  isReadOnly,
  hideEditingActions,
  isLaborSplitEnabled,
  isPendingCreate,
  isHighlighted = false,
  isSearchMatch,
  lineTotal,
  kFoValue,
  hMoValue,
  hMoMajorationPercent,
  kMoValue,
  sourceLevel,
  sourceExtractedAt,
  sourceMetadata,
  showCatalogueSuggestions,
  catalogueListboxId,
  catalogueSuggestions,
  isCatalogueLoading,
  catalogueError,
  activeCatalogueSuggestionIndex,
  onApplyCatalogueSuggestion,
  handleLineTitleFocus,
  handleLineTitleBlur,
  handleLineTitleKeyDown,
  dragHandle,
  onPatchItem,
  onUnitChange,
  onUnitCommit,
  onDeleteItem,
  onOpenArticle = () => undefined,
  onAssociateArticle = () => undefined,
  onOpenSupplierComparisonPanel,
  onOpenSupplierComparisonContextMenu,
  onConvertLineToSection,
  onToggleOutlierDismiss,
  onLineSelectionInteraction,
  onOpenMobileEditor,
}: LineRowProps) {
  const [catalogueSuggestionsAnchor, setCatalogueSuggestionsAnchor] =
    useState<HTMLDivElement | null>(null);
  const v3Grid = useEstimateV3Grid(); // Lot 2, sous-lot 2.6 : cellules v3 déléguées (V3LineCells).

  const treeConnectorSegments = buildTreeConnectorSegments(treeConnectorMeta);
  const hasTreeConnectors =
    treeConnectorSegments.verticalSegments.length > 0 ||
    treeConnectorSegments.horizontalSegment !== null;
  const splitFields = readLaborSplitFields(item);
  const isSupplierColumnVisible = visibleColumns?.has("supplier") === true;
  const selectedSupplierOffer = item.selected_supplier_price_id
    ? supplierComparison?.alternatives.find(
        (offer) => offer.supplier_price_id === item.selected_supplier_price_id,
      )
    : undefined;
  const savedSupplierDetails = item.selected_supplier_details?.price_id === item.selected_supplier_price_id
    ? item.selected_supplier_details : null;
  const selectedSupplierName = selectedSupplierOffer?.supplier_name.trim() || savedSupplierDetails?.name?.trim();
  const selectedSupplierReference = selectedSupplierOffer?.supplier_reference?.trim() || savedSupplierDetails?.reference?.trim();
  const selectedSupplierLabel = selectedSupplierName
    ? `Offre retenue : ${selectedSupplierName}${selectedSupplierReference ? ` · ${selectedSupplierReference}` : ""}`
    : "Offre fournisseur retenue";
  const selectedSupplierText = isSupplierColumnVisible && selectedSupplierName
    ? `${selectedSupplierName}${selectedSupplierReference ? ` · ${selectedSupplierReference}` : ""}`
    : selectedSupplierLabel;
  const supplierOfferContent = (
    <div className="flex min-w-0 items-center gap-2 text-xs" data-testid={item.selected_supplier_price_id ? "estimate-line-selected-supplier" : "estimate-line-supplier-empty"}>
      <span className="min-w-0 flex-1 truncate text-[var(--slate-600)]" aria-label={item.selected_supplier_price_id ? selectedSupplierLabel : "Aucune offre retenue"} title={item.selected_supplier_price_id ? selectedSupplierLabel : "Aucune offre retenue"}>
        {item.selected_supplier_price_id ? selectedSupplierText : "Aucune offre retenue"}
      </span>
      {!hideEditingActions ? (
        <button
          type="button"
          className="shrink-0 font-medium text-[var(--brand-blue)] underline underline-offset-2"
          aria-label={`${item.selected_supplier_price_id ? "Changer d’offre" : "Choisir une offre"} pour ${item.title || "sans titre"}`}
          disabled={isReadOnly || isPendingCreate}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onFocus={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onOpenSupplierComparisonPanel(item.id);
          }}
        >
          {item.selected_supplier_price_id ? "Changer d’offre" : "Choisir une offre"}
        </button>
      ) : null}
    </div>
  );
  // EST-E15 increment 1 : les trois colonnes de sous-detail sont optionnelles et
  // masquees par defaut ; on ne calcule que si l'une d'elles est affichee.
  const isPriceBreakdownVisible = (column: "ds" | "marge" | "marque") =>
    visibleColumns?.has(column) === true;
  const lineMargin = useMemo(
    () =>
      isPriceBreakdownVisible("ds") ||
      isPriceBreakdownVisible("marge") ||
      isPriceBreakdownVisible("marque")
        ? v3Grid ? readEstimateV3GridLineMargin(v3Grid, item.id) : computeEstimateLineMargin({
            item,
            laborRoles,
            isLaborSplitEnabled,
          })
        : { costCents: 0, saleCents: 0, marginCents: 0, markupRatio: null },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item, laborRoles, isLaborSplitEnabled, visibleColumns, v3Grid]
  );
  const dismissedOutlierSet = new Set(dismissedOutlierFlags);
  const quantityOutlierActive =
    detectedOutlierFlags.includes("quantity_outlier") &&
    !dismissedOutlierSet.has("quantity_outlier");
  const priceOutlierActive =
    detectedOutlierFlags.includes("price_outlier") &&
    !dismissedOutlierSet.has("price_outlier");
  const dismissedOutlierBadges = detectedOutlierFlags.filter(
    (flag, index, flags) => {
      return dismissedOutlierSet.has(flag) && flags.indexOf(flag) === index;
    },
  );
  const actionableOutlierFlags = detectedOutlierFlags.filter(
    (flag, index, flags) => {
      return (
        ESTIMATE_OUTLIER_FLAG_KEYS.includes(flag) &&
        flags.indexOf(flag) === index
      );
    },
  );
  const isLaborRoleVisible =
    isLaborSplitEnabled || !visibleColumns || visibleColumns.has("labor_role");

  const dispatchLineSelection = (
    modifiers: Pick<
      ReactMouseEvent<HTMLInputElement>,
      "shiftKey" | "ctrlKey" | "metaKey"
    >,
  ) => {
    if (isReadOnly) {
      return;
    }

    onLineSelectionInteraction({
      id: item.id,
      shiftKey: modifiers.shiftKey,
      ctrlKey:
        modifiers.ctrlKey || modifiers.metaKey || !modifiers.shiftKey,
      metaKey: modifiers.metaKey,
    });
  };

  const handleLineSelectionCheckboxChange = (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const nativeEvent = event.nativeEvent as MouseEvent;
    dispatchLineSelection({
      shiftKey: nativeEvent.shiftKey ?? false,
      ctrlKey: nativeEvent.ctrlKey ?? false,
      metaKey: nativeEvent.metaKey ?? false,
    });
  };

  // La barre d'espace suit le comportement natif de la case. Entrée reste un
  // raccourci explicite pour préserver le contrat clavier historique.
  const handleLineSelectionCheckboxKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
  ) => {
    if (isReadOnly) {
      return;
    }
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    dispatchLineSelection({
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    });
  };

  const handleRowModifierSelection = (
    event: ReactMouseEvent<HTMLDivElement>,
  ) => {
    if (isReadOnly) {
      return;
    }
    if (!event.shiftKey && !event.ctrlKey && !event.metaKey) {
      return;
    }

    const target = event.target as HTMLElement;
    if (
      target.closest(
        "input,select,textarea,button,a,[contenteditable=''],[contenteditable='true'],[contenteditable='plaintext-only']",
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
    event.preventDefault();
    onOpenSupplierComparisonContextMenu(item.id, {
      x: event.clientX,
      y: event.clientY,
    });
  };

  // Pastilles courtes montrees a cote du titre : leur largeur est bornee, elles
  // ne peuvent donc pas pousser la ligne sur un second rang.
  const lineStateNodes = (
    <>
      <EstimateLineNatureSelect
        item={item}
        navigationRowId={titleCell.rowId}
        isReadOnly={isReadOnly}
        onPatchItem={onPatchItem}
      />
      <EstimateLineTruthBadges item={item} />
      {qualityFlags.length > 0 || dismissedOutlierBadges.length > 0 ? (
        <div className="estimate-quality-dots">
          {qualityFlags.slice(0, 3).map((flag) => {
            const targetColumn = getQualityFlagCellTarget(flag, {
              isLaborSplitEnabled,
              isLaborRoleVisible,
            });
            const isClickable = Boolean(targetColumn);
            const focusTargetCell = () => {
              if (!targetColumn) {
                return;
              }

              const cellId = `${titleCell.rowId}::${targetColumn}`;
              const el = document.querySelector<HTMLElement>(
                `[data-cell-id="${cellId}"]`,
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
                .map((flag) => ESTIMATE_QUALITY_FLAG_META[flag].label)
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
    </>
  );

  // Contenus longs ou rares : ils vivent dans le menu « … » de la ligne au lieu
  // d'ajouter un rang de badges et de messages sous le titre.
  const hasLineDetails =
    hasTakeoffSourceBadge(item.source_provider) ||
    hasSupplierComparisonMismatch ||
    actionableOutlierFlags.length > 0;
  const lineDetailNodes = (
    <>
      {hasTakeoffSourceBadge(item.source_provider) ? <TakeoffSourceBadge
        versionId={versionId}
        estimateItemId={item.id}
        lineLabel={item.title}
        sourceProvider={item.source_provider}
        sourceJobId={item.source_job_id}
        sourceFileName={item.source_file_name}
        sourcePage={item.source_page}
        sourceLevel={sourceLevel}
        extractedAt={sourceExtractedAt}
        sourceVersionNumber={item.source_version_number}
        sourceMetadata={sourceMetadata}
        cacheToken={item.updated_at}
      /> : null}
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
    </>
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`estimate-row${
        isLineSelected ? " estimate-row--selected" : ""
      }${isHighlighted ? " animate-pulse ring-2 ring-emerald-400 rounded" : ""}${isSearchMatch ? " ring-2 ring-yellow-300 rounded" : ""}`}
      data-estimate-item-id={item.id}
      data-testid="estimate-line-row"
      data-highlighted={isHighlighted ? "true" : undefined}
      data-depth={depth}
      role="row"
      onMouseDown={handleRowModifierSelection}
      onContextMenu={handleLineContextMenu}
    >
      <EstimateOrderedCells>
      <div
        {...titleCellProps}
        data-estimate-column="designation"
        role="gridcell"
        onKeyDown={toCellKeyDownHandler(titleCellProps.onKeyDown)}
        className={toCellClassName(
          navigation,
          titleCell,
          `estimate-cell estimate-cell--designation${
            !item.title.trim() && !showCatalogueSuggestions
              ? " estimate-cell--required-empty"
              : ""
          }`,
        )}
        style={indentStyle}
      >
        {hasTreeConnectors ? (
          <span className="estimate-tree-connectors" aria-hidden="true">
            {treeConnectorSegments.verticalSegments.map((segment) => (
              <span
                key={`line-v-${segment.column}-${segment.from}-${segment.to}`}
                className={`estimate-tree-segment estimate-tree-segment--v estimate-tree-segment--${segment.tone}`}
                style={{
                  left: `calc(${segment.column} * var(--tree-indent) + var(--tree-offset))`,
                  top: segment.from === "top" ? "0" : "50%",
                  bottom: segment.to === "bottom" ? "0" : "50%",
                }}
              />
            ))}
            {treeConnectorSegments.horizontalSegment ? (
              <span
                className={`estimate-tree-segment estimate-tree-segment--h estimate-tree-segment--${treeConnectorSegments.horizontalSegment.tone}`}
                style={{
                  left: `calc(${treeConnectorSegments.horizontalSegment.column} * var(--tree-indent) + var(--tree-offset))`,
                }}
              />
            ) : null}
          </span>
        ) : null}
        <div className="estimate-cell__content">
          <input
            type="checkbox"
            className="estimate-line-checkbox"
            checked={isLineSelected}
            onChange={handleLineSelectionCheckboxChange}
            onKeyDown={handleLineSelectionCheckboxKeyDown}
            disabled={isReadOnly}
            aria-label={`Sélectionner la ligne ${item.title || "sans titre"}`}
            data-testid="estimate-line-checkbox"
          />
          {!hideEditingActions ? dragHandle : null}
          <div className="estimate-line-designation">
            <div
              ref={setCatalogueSuggestionsAnchor}
              className="estimate-line-designation__primary"
              style={item.selected_supplier_price_id && !isSupplierColumnVisible ? { flexDirection: "column", alignItems: "stretch" } : undefined}
            >
              <input
                className="estimate-input estimate-input--title"
                ref={titleEditorProps.ref}
                tabIndex={titleEditorProps.tabIndex}
                value={item.title}
                title={item.title}
                disabled={isReadOnly}
                data-testid="estimate-line-title-input"
                placeholder="Obligatoire"
                onFocus={(event) => {
                  handleLineTitleFocus(event);
                  if (item.title === "Nouvelle ligne") {
                    event.currentTarget.select();
                  }
                }}
                onClick={(event) => {
                  if (item.title === "Nouvelle ligne") {
                    event.currentTarget.select();
                  }
                }}
                onKeyDown={handleLineTitleKeyDown}
                onChange={(event) =>
                  onPatchItem(
                    item.id,
                    { title: event.target.value },
                    { persist: false },
                  )
                }
                onBlur={handleLineTitleBlur}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={showCatalogueSuggestions}
                aria-controls={
                  showCatalogueSuggestions ? catalogueListboxId : undefined
                }
                aria-activedescendant={
                  showCatalogueSuggestions &&
                  catalogueSuggestions[activeCatalogueSuggestionIndex]
                    ? `${catalogueListboxId}-option-${activeCatalogueSuggestionIndex}`
                    : undefined
                }
              />
              {v3Grid ? <V3LineStateControls item={item} isReadOnly={isReadOnly} onPatchItem={onPatchItem} /> : null}
              {item.selected_supplier_price_id && !isSupplierColumnVisible ? supplierOfferContent : null}
              {showCatalogueSuggestions && catalogueSuggestionsAnchor ? (
                <CatalogueSuggestionsPopover
                  anchor={catalogueSuggestionsAnchor}
                  itemId={item.id}
                  query={item.title}
                  lineUnit={v3Grid ? item.unit_code : item.description}
                  estimateCurrency={estimateCurrency}
                  catalogueListboxId={catalogueListboxId}
                  isCatalogueLoading={isCatalogueLoading}
                  catalogueError={catalogueError}
                  catalogueSuggestions={catalogueSuggestions}
                  activeCatalogueSuggestionIndex={
                    activeCatalogueSuggestionIndex
                  }
                  isReadOnly={isReadOnly}
                  onApplySuggestion={onApplyCatalogueSuggestion}
                />
              ) : null}
              {onOpenMobileEditor ? (
                <button
                  className="btn btn-secondary min-h-11 shrink-0 px-3 text-sm"
                  type="button"
                  data-testid="estimate-mobile-line-editor-trigger"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onOpenMobileEditor(item.id);
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenMobileEditor(item.id);
                  }}
                >
                  Modifier
                </button>
              ) : null}
            </div>
            <div className="estimate-line-designation__support">
              {lineStateNodes}
            </div>
            <Popover
              placement="bottom"
              portal
              className={`estimate-line-more${
                hasLineDetails ? " estimate-line-more--available" : ""
              }`}
              contentClassName="estimate-line-more__menu"
              trigger={
                <button
                  className="estimate-line-more__trigger"
                  type="button"
                  aria-label={`Details de la ligne ${item.title || "sans titre"}`}
                  title="Details de la ligne"
                  data-testid="estimate-line-more-trigger"
                >
                  …
                </button>
              }
            >
              <div className="estimate-line-more__items">
                <div className="estimate-line-more__state">{lineStateNodes}</div>
                {lineDetailNodes}
              </div>
            </Popover>
          </div>
        </div>
      </div>
      <EditableCell
        cell={quantityCell}
        navigation={navigation}
        value={formatDecimalInput(item.quantity ?? 0)}
        readOnly={isReadOnly}
        className={toCellClassName(
          navigation,
          quantityCell,
          `estimate-cell estimate-editable-cell${
            quantityOutlierActive
              ? " bg-orange-50 ring-1 ring-inset ring-orange-300"
              : ""
          }${!item.quantity ? " estimate-cell--required-empty" : ""}`,
        )}
        inputClassName="estimate-input"
        // type=text + inputMode=decimal (comme la cellule Prix) pour accepter
        // la virgule décimale FR ; un input number la rejette au pavé numérique.
        type="text"
        inputMode="decimal"
        placeholder="Obligatoire"
        ariaLabel={`Quantité pour ${item.title || "sans titre"}`}
        formatDisplayValue={(value) =>
          formatNumberDisplay(Number(String(value ?? "0").replace(",", ".")), {
            minDecimals: 0,
            maxDecimals: 3,
          })
        }
        // 2.3 review : même lecture qu'à l'import et au collage, trois décimales au plus.
        isValidInput={(value) => parseQuantityInput(value) !== null}
        onChange={() => undefined}
        onCommit={(value) => {
          const quantity = parseQuantityInput(value);
          if (quantity === null) return;
          onPatchItem(item.id, { quantity }, { persist: true });
        }}
      />
      {v3Grid ? <V3UnitCell cell={unitCell} cellProps={unitCellProps} editorProps={unitEditorProps} navigation={navigation}
        item={item} isReadOnly={isReadOnly} onPatchItem={onPatchItem} /> : <div
        {...unitCellProps}
        data-estimate-column="unit"
        role="gridcell"
        onKeyDown={toCellKeyDownHandler(unitCellProps.onKeyDown)}
        className={toCellClassName(
          navigation,
          unitCell,
          `estimate-cell${!unitValue.trim() ? " estimate-cell--required-empty" : ""}`,
        )}
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
          placeholder="Obligatoire" aria-label={`Unité pour ${item.title || "sans titre"}`}
          disabled={isReadOnly}
        />
      </div>}
      <EditableCell
        cell={unitPriceCell}
        navigation={navigation}
        value={formatCentsInput(item.unit_price_ht_cents)}
        readOnly={isReadOnly}
        className={toCellClassName(
          navigation,
          unitPriceCell,
          `estimate-cell estimate-editable-cell estimate-col--fo${
            priceOutlierActive
              ? " bg-orange-50 ring-1 ring-inset ring-orange-300"
              : ""
          }${!item.unit_price_ht_cents ? " estimate-cell--required-empty" : ""}`,
        )}
        inputClassName="estimate-input"
        type="text"
        inputMode="decimal"
        placeholder="Obligatoire"
        ariaLabel={`Prix d’achat unitaire HT pour ${item.title || "sans titre"}`}
        isValidInput={(value) => parseCurrencyToCents(value, estimateCurrency) !== null}
        formatDisplayValue={(value) =>
          formatNumberDisplay(Number(String(value ?? "0").replace(",", ".")), {
            minDecimals: 2,
            maxDecimals: 2,
          })
        }
        onChange={(value) => {
          const unitPriceCents = parseCurrencyToCents(
            value,
            estimateCurrency,
          );
          if (unitPriceCents === null) return;
          onPatchItem(
            item.id,
            { unit_price_ht_cents: unitPriceCents },
            { persist: false },
          );
        }}
        onCommit={(value) => {
          const unitPriceCents = parseCurrencyToCents(
            value,
            estimateCurrency,
          );
          if (unitPriceCents === null) return;
          onPatchItem(
            item.id,
            { unit_price_ht_cents: unitPriceCents },
            { persist: true },
          );
        }}
      />
      {!visibleColumns ||
      visibleColumns.has("supply_type") ||
      isLaborSplitEnabled ? (
        <div
          {...supplyTypeCellProps}
        data-estimate-column="supply_type"
          role="gridcell"
          onKeyDown={toCellKeyDownHandler(supplyTypeCellProps.onKeyDown)}
          className={toCellClassName(
            navigation,
            supplyTypeCell,
            "estimate-cell estimate-col--fo",
          )}
        >
          <EstimateTypeCombobox
            value={item.supply_type_id}
            options={supplyTypeOptions}
            label={`Type de fourniture pour ${item.title || "sans titre"}`}
            emptyLabel="Aucun type"
            editorProps={supplyTypeEditorProps}
            onCommit={(id) => onPatchItem(item.id, { supply_type_id: id }, { persist: true })}
            disabled={isReadOnly}
          />
        </div>
      ) : null}
      {!visibleColumns || visibleColumns.has("k_fo") || isLaborSplitEnabled ? (
        <div
          {...kFoCellProps}
        data-estimate-column="k_fo"
          role="gridcell"
          onKeyDown={toCellKeyDownHandler(kFoCellProps.onKeyDown)}
          className={toCellClassName(
            navigation,
            kFoCell,
            "estimate-cell estimate-col--fo",
          )}
        >
          <DecimalDraftInput
            className="estimate-input estimate-input--compact-number"
            ref={kFoEditorProps.ref}
            tabIndex={kFoEditorProps.tabIndex}
            value={kFoValue}
            emptyValue={1}
            parseValue={parseCoefficientDraft}
            aria-label={`Coefficient fourniture K FO pour ${item.title || "sans titre"}`}
            title="K FO agit uniquement sur le prix de revient fourniture et ne modifie jamais le prix de revient MO."
            onFocus={kFoEditorProps.onFocus}
            onKeyDown={kFoEditorProps.onKeyDown}
            onValueChange={(value) =>
              onPatchItem(
                item.id,
                { k_fo: value },
                { persist: false },
              )
            }
            onBlur={kFoEditorProps.onBlur}
            onValueCommit={(value) =>
              onPatchItem(
                item.id,
                { k_fo: value },
                { persist: true },
              )
            }
            placeholder="1.00"
            disabled={isReadOnly}
          />
        </div>
      ) : null}
      {isSupplierColumnVisible ? (
        <div
          {...supplierCellProps}
          data-estimate-column="supplier"
          role="gridcell"
          aria-readonly="true"
          className={toCellClassName(navigation, supplierCell, "estimate-cell estimate-col--fo")}
          onKeyDown={(event) => {
            if (event.target === event.currentTarget && event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              if (!isReadOnly && !isPendingCreate && !hideEditingActions) onOpenSupplierComparisonPanel(item.id);
              return;
            }
            toCellKeyDownHandler(supplierCellProps.onKeyDown)(event);
          }}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!isReadOnly && !isPendingCreate && !hideEditingActions) onOpenSupplierComparisonPanel(item.id);
          }}
        >
          {supplierOfferContent}
        </div>
      ) : null}
      {isLaborSplitEnabled ? (
        <LaborSplitCells
          navigation={navigation}
          item={item}
          splitFields={splitFields}
          qualityFlags={qualityFlags}
          laborRoles={laborRoles}
          isReadOnly={isReadOnly}
          hMoMajorationPercent={hMoMajorationPercent}
          hMoMajorationCell={hMoMajorationCell}
          hMoMajorationCellProps={hMoMajorationCellProps}
          hMoMajorationEditorProps={hMoMajorationEditorProps}
          hMoAtelierCell={hMoAtelierCell}
          hMoAtelierCellProps={hMoAtelierCellProps}
          hMoAtelierEditorProps={hMoAtelierEditorProps}
          laborRoleAtelierCell={laborRoleAtelierCell}
          laborRoleAtelierCellProps={laborRoleAtelierCellProps}
          laborRoleAtelierEditorProps={laborRoleAtelierEditorProps}
          kMoAtelierCell={kMoAtelierCell}
          kMoAtelierCellProps={kMoAtelierCellProps}
          kMoAtelierEditorProps={kMoAtelierEditorProps}
          hMoChantierCell={hMoChantierCell}
          hMoChantierCellProps={hMoChantierCellProps}
          hMoChantierEditorProps={hMoChantierEditorProps}
          laborRoleChantierCell={laborRoleChantierCell}
          laborRoleChantierCellProps={laborRoleChantierCellProps}
          laborRoleChantierEditorProps={laborRoleChantierEditorProps}
          kMoChantierCell={kMoChantierCell}
          kMoChantierCellProps={kMoChantierCellProps}
          kMoChantierEditorProps={kMoChantierEditorProps}
          onPatchItem={onPatchItem}
        />
      ) : (
        <StandardMoCells
          navigation={navigation}
          item={item}
          qualityFlags={qualityFlags}
          laborRoles={laborRoles}
          visibleColumns={visibleColumns}
          isReadOnly={isReadOnly}
          hMoValue={hMoValue}
          hMoMajorationPercent={hMoMajorationPercent}
          kMoValue={kMoValue}
          hMoCell={hMoCell}
          hMoCellProps={hMoCellProps}
          hMoEditorProps={hMoEditorProps}
          hMoMajorationCell={hMoMajorationCell}
          hMoMajorationCellProps={hMoMajorationCellProps}
          hMoMajorationEditorProps={hMoMajorationEditorProps}
          laborRoleCell={laborRoleCell}
          laborRoleCellProps={laborRoleCellProps}
          laborRoleEditorProps={laborRoleEditorProps}
          kMoCell={kMoCell}
          kMoCellProps={kMoCellProps}
          kMoEditorProps={kMoEditorProps}
          onPatchItem={onPatchItem}
        />
      )}
      {/*
        EST-E15 increment 1 — le sous-detail de prix, en lecture seule.
        Le deboursé sec etait deja calcule par le moteur a chaque mutation puis
        jete : sans lui le chiffreur ne voyait jamais sa marge ligne a ligne.
        La marge affichee est BRUTE (avant remise et coefficient de version, qui
        sont des grandeurs du pied) ; la marge nette par ligne arrivera avec le
        breakdown en phase D de T6.
      */}
      {isPriceBreakdownVisible("ds") ? (
        <div
          data-estimate-column="ds"
          role="gridcell"
          className="estimate-cell estimate-cell--readonly estimate-col--margin"
        >
          <span>{formatCurrency(lineMargin.costCents, estimateCurrency)}</span>
        </div>
      ) : null}
      {isPriceBreakdownVisible("marge") ? (
        <div
          data-estimate-column="marge"
          role="gridcell"
          className={`estimate-cell estimate-cell--readonly estimate-col--margin${
            lineMargin.marginCents < 0 ? " estimate-cell--margin-negative" : ""
          }`}
          title={
            lineMargin.marginCents < 0
              ? "Ligne vendue en dessous de son deboursé sec."
              : undefined
          }
        >
          <span>{formatCurrency(lineMargin.marginCents, estimateCurrency)}</span>
        </div>
      ) : null}
      {isPriceBreakdownVisible("marque") ? (
        <div
          data-estimate-column="marque"
          role="gridcell"
          className={`estimate-cell estimate-cell--readonly estimate-col--margin${
            lineMargin.marginCents < 0 ? " estimate-cell--margin-negative" : ""
          }`}
          title="Taux de marque : marge / prix de vente."
        >
          <span>{formatMarkupRatio(lineMargin.markupRatio)}</span>
        </div>
      ) : null}
      <div
        {...puCellProps}
        data-estimate-column="unit_price"
        role="gridcell"
        onKeyDown={toCellKeyDownHandler(puCellProps.onKeyDown)}
        className={toCellClassName(
          navigation,
          puCell,
          "estimate-cell estimate-cell--readonly estimate-cell--pu-separator estimate-col--sale",
        )}
      >
        <input
          className="estimate-input"
          type="text"
          value={v3Grid && item.pu_ht_cents === null ? "" : formatNumberDisplay((item.pu_ht_cents ?? 0) / 100, {
            minDecimals: 2,
            maxDecimals: 2,
          })}
          placeholder="0.00"
          readOnly tabIndex={-1} aria-readonly aria-label={`Prix de vente unitaire HT pour ${item.title || "sans titre"}`}
        />
      </div>
      <div
        {...totalCellProps}
        data-estimate-column="total_price"
        role="gridcell"
        onKeyDown={toCellKeyDownHandler(totalCellProps.onKeyDown)}
        className={toCellClassName(
          navigation,
          totalCell,
          "estimate-cell estimate-cell--total estimate-cell--readonly estimate-col--sale",
        )}
      >
        <span>{formatCurrency(lineTotal, estimateCurrency)}</span>
      </div>
      <div className="estimate-cell estimate-cell--actions">
          <DropdownMenu>
            <DropdownMenuTrigger
              className="btn btn-ghost btn-sm"
              aria-label={`Plus d'actions pour ${item.title || "la ligne"}`}
            >
              <EllipsisVerticalIcon aria-hidden="true" className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[230px] p-1.5">
              <DropdownMenuItem className="px-2.5 py-2" disabled={!item.product_id} onClick={() => onOpenArticle(item.id)}>
                Fiche article
              </DropdownMenuItem>
              {!hideEditingActions ? (
                <DropdownMenuItem
                  className="px-2.5 py-2"
                  disabled={isReadOnly || isPendingCreate}
                  onClick={() => onAssociateArticle(item.id)}
                >
                  Associer ou remplacer l’article
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem className="px-2.5 py-2" onClick={() => onOpenSupplierComparisonPanel(item.id)}>
                Comparer les fournisseurs
              </DropdownMenuItem>
              {!hideEditingActions ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className={v3Grid ? "max-w-72 flex-col items-start px-2.5 py-2" : "px-2.5 py-2"}
                    disabled={isReadOnly || isPendingCreate || Boolean(v3Grid)}
                    title={v3Grid ? ESTIMATE_V3_ITEM_CONVERSION_REASON : undefined}
                    onClick={() => onConvertLineToSection(item.id)}
                  >
                    Convertir en section
                    {v3Grid ? <span className="text-xs font-normal text-muted-foreground">{ESTIMATE_V3_ITEM_CONVERSION_REASON}</span> : null}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="px-2.5 py-2"
                    variant="destructive"
                    disabled={isReadOnly}
                    onClick={() => onDeleteItem(item.id)}
                  >
                    Supprimer
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
      </div>
      </EstimateOrderedCells>
    </div>
  );
}
