"use client";

import {
  type EstimateQualityFlagKey,
} from "@/lib/estimate-quality";
import { type SpreadsheetCellProps, type SpreadsheetEditorProps } from "@/hooks/useSpreadsheetNavigation";
import { DecimalDraftInput } from "@/components/estimates/components/estimate-editor-row/DecimalDraftInput";
import {
  type ColumnVisibilitySet,
  type EstimateItem,
  type ItemPatch,
  type LaborRole,
  type SpreadsheetCell,
  type SpreadsheetNavigationResult,
  formatLaborRoleOptionLabel,
  getMissingLaborRateMessage,
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
  laborRoleEditorProps: SpreadsheetEditorProps<HTMLSelectElement>;
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

  return (
    <>
      <div
        {...hMoCellProps}
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
        <DecimalDraftInput
          className="estimate-input estimate-input--compact-number"
          ref={hMoEditorProps.ref}
          tabIndex={hMoEditorProps.tabIndex}
          value={hMoValue}
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
        />
      </div>
      {(!visibleColumns || visibleColumns.has("h_mo_majoration")) ? (
        <div
          {...hMoMajorationCellProps}
          role="gridcell"
          onKeyDown={toCellKeyDownHandler(hMoMajorationCellProps.onKeyDown)}
          className={toCellClassName(
            navigation,
            hMoMajorationCell,
            "estimate-cell estimate-col--mo"
          )}
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
                {
                  h_mo_majoration: parseMajorationPercentToCoefficient(
                    event.target.value
                  ),
                },
                { persist: false }
              )
            }
            onBlur={(event) => {
              hMoMajorationEditorProps.onBlur(event);
              onPatchItem(
                item.id,
                {
                  h_mo_majoration: parseMajorationPercentToCoefficient(
                    event.target.value
                  ),
                },
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
          <select
            className="estimate-input estimate-select"
            ref={laborRoleEditorProps.ref}
            tabIndex={laborRoleEditorProps.tabIndex}
            value={item.labor_role_id ?? ""}
            aria-label={`Rôle de main-d'œuvre pour ${item.title || "sans titre"}`}
            aria-invalid={missingLaborRateMessage ? true : undefined}
            title={missingLaborRateMessage ?? undefined}
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
              <option
                key={role.id}
                value={role.id}
                disabled={!role.is_active}
              >
                {formatLaborRoleOptionLabel(role)}
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
    </>
  );
}
