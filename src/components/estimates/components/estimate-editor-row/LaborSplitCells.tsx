"use client";

import { DecimalDraftInput } from "@/components/estimates/components/estimate-editor-row/DecimalDraftInput";

import { EstimateOrderedCells } from "@/components/estimates/context/EstimateColumnOrderContext";

import { EstimateTypeCombobox } from "@/components/estimates/EstimateTypeCombobox";
import { formatCurrency } from "@/lib/money";
import { resolveLaborRoleHourlyRate } from "@/lib/estimates/editor-items";

import {
  type EstimateQualityFlagKey,
} from "@/lib/estimate-quality";
import {
  type SpreadsheetCellProps,
  type SpreadsheetEditorProps,
} from "@/hooks/useSpreadsheetNavigation";
import {
  type EstimateItem,
  type ItemPatch,
  type LaborRole,
  type SpreadsheetCell,
  type SpreadsheetNavigationResult,
  toCellClassName,
  toCellKeyDownHandler,
} from "@/components/estimates/components/estimate-editor-row/shared";

type LaborSplitFields = Required<
  Pick<
    EstimateItem,
    | "h_mo_atelier"
    | "k_mo_atelier"
    | "labor_role_atelier_id"
    | "h_mo_chantier"
    | "k_mo_chantier"
    | "labor_role_chantier_id"
  >
>;

type LaborSplitCellsProps = {
  navigation: SpreadsheetNavigationResult;
  item: EstimateItem;
  splitFields: LaborSplitFields;
  qualityFlags: EstimateQualityFlagKey[];
  laborRoles: LaborRole[];
  isReadOnly: boolean;
  hMoMajorationPercent: string;
  hMoMajorationCell: SpreadsheetCell;
  hMoMajorationCellProps: SpreadsheetCellProps;
  hMoMajorationEditorProps: SpreadsheetEditorProps<HTMLInputElement>;
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
  onPatchItem: (
    itemId: string,
    patch: ItemPatch,
    options?: { persist?: boolean }
  ) => void;
};

export function LaborSplitCells({
  navigation,
  item,
  splitFields,
  qualityFlags,
  laborRoles,
  isReadOnly,
  hMoMajorationPercent,
  hMoMajorationCell,
  hMoMajorationCellProps,
  hMoMajorationEditorProps,
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
  onPatchItem,
}: LaborSplitCellsProps) {
  const hasIncompleteSplit = qualityFlags.includes("labor_split_incomplete");

  return (
    <EstimateOrderedCells>
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
          aria-label={`Majoration de main-d’œuvre en pourcentage pour ${item.title || "sans titre"}`}
          onFocus={hMoMajorationEditorProps.onFocus}
          onKeyDown={hMoMajorationEditorProps.onKeyDown}
          onValueChange={(value) => onPatchItem(item.id, { h_mo_majoration: Math.max(value / 100, 0) }, { persist: false })}
          onValueCommit={(value) => onPatchItem(item.id, { h_mo_majoration: Math.max(value / 100, 0) }, { persist: true })}
          onBlur={hMoMajorationEditorProps.onBlur}
          placeholder="100"
          disabled={isReadOnly}
        />
      </div>
      <div
        {...hMoAtelierCellProps}
        data-estimate-column="labor_hours_workshop"
        role="gridcell"
        onKeyDown={toCellKeyDownHandler(hMoAtelierCellProps.onKeyDown)}
        className={toCellClassName(
          navigation,
          hMoAtelierCell,
          `estimate-cell estimate-col--mo${
            hasIncompleteSplit ? " estimate-cell--warning-empty" : ""
          }`
        )}
      >
        <DecimalDraftInput
          className="estimate-input"
          ref={hMoAtelierEditorProps.ref}
          tabIndex={hMoAtelierEditorProps.tabIndex}
          step="0.1"
          min={0}
          value={splitFields.h_mo_atelier}
          aria-label={`Heures de main-d’œuvre en atelier pour ${item.title || "sans titre"}`}
          onFocus={hMoAtelierEditorProps.onFocus}
          onKeyDown={hMoAtelierEditorProps.onKeyDown}
          onValueChange={(value) => onPatchItem(item.id, { h_mo_atelier: value }, { persist: false })}
          onValueCommit={(value) => onPatchItem(item.id, { h_mo_atelier: value }, { persist: true })}
          onBlur={hMoAtelierEditorProps.onBlur}
          placeholder="0.0"
          disabled={isReadOnly}
        />
      </div>
      <div
        {...laborRoleAtelierCellProps}
        data-estimate-column="labor_role_workshop"
        role="gridcell"
        onKeyDown={toCellKeyDownHandler(laborRoleAtelierCellProps.onKeyDown)}
        className={toCellClassName(
          navigation,
          laborRoleAtelierCell,
          "estimate-cell estimate-col--mo"
        )}
      >
        <EstimateTypeCombobox
          value={splitFields.labor_role_atelier_id ?? null}
          options={laborRoles.map((role) => ({ id: role.id, label: role.name, detail: `${formatCurrency(resolveLaborRoleHourlyRate(role, "atelier"), "EUR")} / h`, disabled: !role.is_active }))}
          label={`Rôle de main-d’œuvre en atelier pour ${item.title || "sans titre"}`}
          emptyLabel="Aucun rôle"
          editorProps={laborRoleAtelierEditorProps}
          onCommit={(id) => onPatchItem(item.id, { labor_role_atelier_id: id }, { persist: true })}
          disabled={isReadOnly}
        />
      </div>
      <div
        {...kMoAtelierCellProps}
        data-estimate-column="k_mo_workshop"
        role="gridcell"
        onKeyDown={toCellKeyDownHandler(kMoAtelierCellProps.onKeyDown)}
        className={toCellClassName(
          navigation,
          kMoAtelierCell,
          "estimate-cell estimate-col--mo"
        )}
      >
        <DecimalDraftInput
          className="estimate-input"
          ref={kMoAtelierEditorProps.ref}
          tabIndex={kMoAtelierEditorProps.tabIndex}
          step="0.01"
          min={0}
          value={splitFields.k_mo_atelier}
          aria-label={`Coefficient de main-d’œuvre en atelier pour ${item.title || "sans titre"}`}
          onFocus={kMoAtelierEditorProps.onFocus}
          onKeyDown={kMoAtelierEditorProps.onKeyDown}
          onValueChange={(value) => onPatchItem(item.id, { k_mo_atelier: value }, { persist: false })}
          onValueCommit={(value) => onPatchItem(item.id, { k_mo_atelier: value }, { persist: true })}
          onBlur={kMoAtelierEditorProps.onBlur}
          placeholder="1.00"
          disabled={isReadOnly}
        />
      </div>
      <div
        {...hMoChantierCellProps}
        data-estimate-column="labor_hours_site"
        role="gridcell"
        onKeyDown={toCellKeyDownHandler(hMoChantierCellProps.onKeyDown)}
        className={toCellClassName(
          navigation,
          hMoChantierCell,
          `estimate-cell estimate-col--mo${
            hasIncompleteSplit ? " estimate-cell--warning-empty" : ""
          }`
        )}
      >
        <DecimalDraftInput
          className="estimate-input"
          ref={hMoChantierEditorProps.ref}
          tabIndex={hMoChantierEditorProps.tabIndex}
          step="0.1"
          min={0}
          value={splitFields.h_mo_chantier}
          aria-label={`Heures de main-d’œuvre sur chantier pour ${item.title || "sans titre"}`}
          onFocus={hMoChantierEditorProps.onFocus}
          onKeyDown={hMoChantierEditorProps.onKeyDown}
          onValueChange={(value) => onPatchItem(item.id, { h_mo_chantier: value }, { persist: false })}
          onValueCommit={(value) => onPatchItem(item.id, { h_mo_chantier: value }, { persist: true })}
          onBlur={hMoChantierEditorProps.onBlur}
          placeholder="0.0"
          disabled={isReadOnly}
        />
      </div>
      <div
        {...laborRoleChantierCellProps}
        data-estimate-column="labor_role_site"
        role="gridcell"
        onKeyDown={toCellKeyDownHandler(laborRoleChantierCellProps.onKeyDown)}
        className={toCellClassName(
          navigation,
          laborRoleChantierCell,
          "estimate-cell estimate-col--mo"
        )}
      >
        <EstimateTypeCombobox
          value={splitFields.labor_role_chantier_id ?? null}
          options={laborRoles.map((role) => ({ id: role.id, label: role.name, detail: `${formatCurrency(resolveLaborRoleHourlyRate(role, "chantier"), "EUR")} / h`, disabled: !role.is_active }))}
          label={`Rôle de main-d’œuvre sur chantier pour ${item.title || "sans titre"}`}
          emptyLabel="Aucun rôle"
          editorProps={laborRoleChantierEditorProps}
          onCommit={(id) => onPatchItem(item.id, { labor_role_chantier_id: id }, { persist: true })}
          disabled={isReadOnly}
        />
      </div>
      <div
        {...kMoChantierCellProps}
        data-estimate-column="k_mo_site"
        role="gridcell"
        onKeyDown={toCellKeyDownHandler(kMoChantierCellProps.onKeyDown)}
        className={toCellClassName(
          navigation,
          kMoChantierCell,
          "estimate-cell estimate-col--mo"
        )}
      >
        <DecimalDraftInput
          className="estimate-input"
          ref={kMoChantierEditorProps.ref}
          tabIndex={kMoChantierEditorProps.tabIndex}
          step="0.01"
          min={0}
          value={splitFields.k_mo_chantier}
          aria-label={`Coefficient de main-d’œuvre sur chantier pour ${item.title || "sans titre"}`}
          onFocus={kMoChantierEditorProps.onFocus}
          onKeyDown={kMoChantierEditorProps.onKeyDown}
          onValueChange={(value) => onPatchItem(item.id, { k_mo_chantier: value }, { persist: false })}
          onValueCommit={(value) => onPatchItem(item.id, { k_mo_chantier: value }, { persist: true })}
          onBlur={kMoChantierEditorProps.onBlur}
          placeholder="1.00"
          disabled={isReadOnly}
        />
      </div>
    </EstimateOrderedCells>
  );
}
