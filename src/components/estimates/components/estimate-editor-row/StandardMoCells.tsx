"use client";

import { EstimateOrderedCells } from "@/components/estimates/context/EstimateColumnOrderContext";

import { formatCurrency } from "@/lib/money";

import { EstimateTypeCombobox } from "@/components/estimates/EstimateTypeCombobox";

import {
  type EstimateQualityFlagKey,
} from "@/lib/estimate-quality";
import { type SpreadsheetCellProps, type SpreadsheetEditorProps } from "@/hooks/useSpreadsheetNavigation";
import { DecimalDraftInput } from "@/components/estimates/components/estimate-editor-row/DecimalDraftInput";
import { useEstimateV3Grid, V3LaborHoursCellContent } from "@/components/estimates/v3/V3LineCells";
import {
  type ColumnVisibilitySet,
  type EstimateItem,
  type ItemPatch,
  type LaborRole,
  type SpreadsheetCell,
  type SpreadsheetNavigationResult,
  getMissingLaborRateMessage,
  parseCoefficientDraft,
  parseLineHoursDraft,
  parseMajorationPercentToCoefficient,
  toCellClassName,
  toCellKeyDownHandler,
} from "@/components/estimates/components/estimate-editor-row/shared";

type StandardMoCellsProps = {
  navigation: SpreadsheetNavigationResult;
  item: EstimateItem;
  qualityFlags: EstimateQualityFlagKey[];
  laborRoles: LaborRole[];
  visibleColumns?: ColumnVisibilitySet;
  isReadOnly: boolean;
  hMoValue: number;
  hMoMajorationPercent: string;
  kMoValue: number;
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
  onPatchItem: (
    itemId: string,
    patch: ItemPatch,
    options?: { persist?: boolean }
  ) => void;
};

export function StandardMoCells({
  navigation,
  item,
  qualityFlags,
  laborRoles,
  visibleColumns,
  isReadOnly,
  hMoValue,
  hMoMajorationPercent,
  kMoValue,
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
  onPatchItem,
}: StandardMoCellsProps) {
  const selectedLaborRole = laborRoles.find(
    (role) => role.id === item.labor_role_id
  );
  const missingLaborRateMessage = getMissingLaborRateMessage(
    selectedLaborRole,
    item.h_mo
  );
  // Lot 2, sous-lot 2.6 : sur une v3, heures par unité saisies et heures totales en lecture seule (D4).
  const v3Grid = useEstimateV3Grid();

  return (
    <EstimateOrderedCells>
      <div
        {...hMoCellProps}
        data-estimate-column="labor_hours"
        role="gridcell"
        onKeyDown={toCellKeyDownHandler(hMoCellProps.onKeyDown)}
        className={toCellClassName(
          navigation,
          hMoCell,
          `estimate-cell estimate-col--mo${
            qualityFlags.includes("missing_labor_time")
              ? " estimate-cell--warning-empty"
              : ""
          }`
        )}
      >
        {v3Grid ? (
          <V3LaborHoursCellContent item={item} editorProps={hMoEditorProps} isReadOnly={isReadOnly} onPatchItem={onPatchItem} />
        ) : <DecimalDraftInput
          className="estimate-input estimate-input--compact-number"
          ref={hMoEditorProps.ref}
          tabIndex={hMoEditorProps.tabIndex}
          value={hMoValue}
          parseValue={parseLineHoursDraft}
          aria-label={`Heures de main-d’œuvre pour ${item.title || "sans titre"}`}
          onFocus={hMoEditorProps.onFocus}
          onKeyDown={hMoEditorProps.onKeyDown}
          onValueChange={(value) =>
            onPatchItem(
              item.id,
              { h_mo: value },
              { persist: false }
            )
          }
          onBlur={hMoEditorProps.onBlur}
          onValueCommit={(value) =>
            onPatchItem(
              item.id,
              { h_mo: value },
              { persist: true }
            )
          }
          placeholder="0.0"
          disabled={isReadOnly}
        />}
      </div>
      {(!visibleColumns || visibleColumns.has("h_mo_majoration")) ? (
        <div
          {...hMoMajorationCellProps}
        data-estimate-column="h_mo_majoration"
          role="gridcell"
          onKeyDown={toCellKeyDownHandler(hMoMajorationCellProps.onKeyDown)}
          className={toCellClassName(
            navigation,
            hMoMajorationCell,
            "estimate-cell estimate-col--mo"
          )}
        >
          <DecimalDraftInput
            className="estimate-input"
            ref={hMoMajorationEditorProps.ref}
            tabIndex={hMoMajorationEditorProps.tabIndex}
            step="0.1"
            min={0}
            value={Number(hMoMajorationPercent)}
            // P-11 : « % » saisi (100 = neutre) → coefficient borné à [0 ; 10] ; vidé → ×1, jamais ×0.
            parseValue={parseMajorationPercentToCoefficient}
            emptyValue={1}
            aria-label={`Majoration de main-d’œuvre en pourcentage pour ${item.title || "sans titre"}`}
            onFocus={hMoMajorationEditorProps.onFocus}
            onKeyDown={hMoMajorationEditorProps.onKeyDown}
            onValueChange={(value) => onPatchItem(item.id, { h_mo_majoration: value }, { persist: false })}
          onValueCommit={(value) => onPatchItem(item.id, { h_mo_majoration: value }, { persist: true })}
          onBlur={hMoMajorationEditorProps.onBlur}
          placeholder="100"
            disabled={isReadOnly}
          />
        </div>
      ) : null}
      {(!visibleColumns || visibleColumns.has("labor_role")) ? (
        <div
          {...laborRoleCellProps}
        data-estimate-column="labor_role"
          role="gridcell"
          onKeyDown={toCellKeyDownHandler(laborRoleCellProps.onKeyDown)}
          className={toCellClassName(
            navigation,
            laborRoleCell,
            `estimate-cell estimate-col--mo${
              qualityFlags.includes("missing_labor_role") ||
              missingLaborRateMessage
                ? " estimate-cell--warning-empty"
                : ""
            }`
          )}
        >
          <EstimateTypeCombobox
            value={item.labor_role_id}
            options={laborRoles.map((role) => ({ id: role.id, label: role.name, detail: `${formatCurrency(role.hourly_rate_cents, "EUR")} / h`, disabled: !role.is_active }))}
            label={`Rôle de main-d'œuvre pour ${item.title || "sans titre"}`}
            emptyLabel="Aucun rôle"
            error={missingLaborRateMessage ?? undefined}
            editorProps={laborRoleEditorProps}
            onCommit={(id) => onPatchItem(item.id, { labor_role_id: id }, { persist: true })}
            disabled={isReadOnly}
          />
        </div>
      ) : null}
      {(!visibleColumns || visibleColumns.has("k_mo")) ? (
        <div
          {...kMoCellProps}
        data-estimate-column="k_mo"
          role="gridcell"
          onKeyDown={toCellKeyDownHandler(kMoCellProps.onKeyDown)}
          className={toCellClassName(
            navigation,
            kMoCell,
            "estimate-cell estimate-col--mo"
          )}
        >
          <DecimalDraftInput
            className="estimate-input estimate-input--compact-number"
            ref={kMoEditorProps.ref}
            tabIndex={kMoEditorProps.tabIndex}
            value={kMoValue}
            emptyValue={1}
            parseValue={parseCoefficientDraft}
            aria-label={`Coefficient main-d'œuvre K MO pour ${item.title || "sans titre"}`}
            aria-invalid={missingLaborRateMessage ? true : undefined}
            title={
              missingLaborRateMessage ??
              "K MO multiplie le taux horaire du rôle de main-d'œuvre."
            }
            onFocus={kMoEditorProps.onFocus}
            onKeyDown={kMoEditorProps.onKeyDown}
            onValueChange={(value) =>
              onPatchItem(
                item.id,
                { k_mo: value },
                { persist: false }
              )
            }
            onBlur={kMoEditorProps.onBlur}
            onValueCommit={(value) =>
              onPatchItem(
                item.id,
                { k_mo: value },
                { persist: true }
              )
            }
            placeholder="1.00"
            disabled={isReadOnly}
          />
        </div>
      ) : null}
    </EstimateOrderedCells>
  );
}
