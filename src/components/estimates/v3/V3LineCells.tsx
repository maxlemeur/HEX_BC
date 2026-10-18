"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

import { DecimalDraftInput } from "@/components/estimates/components/estimate-editor-row/DecimalDraftInput";
import {
  type EstimateItem,
  type ItemPatch,
  type SpreadsheetCell,
  type SpreadsheetNavigationResult,
  formatNumberDisplay,
  toCellClassName,
  toCellKeyDownHandler,
} from "@/components/estimates/components/estimate-editor-row/shared";
import type { SpreadsheetCellProps, SpreadsheetEditorProps } from "@/hooks/useSpreadsheetNavigation";
import type { EstimateV3LineResult } from "@/lib/estimates/engine-v3";
import {
  ESTIMATE_V3_PRICING_STATUS_OPTIONS,
  findEstimateV3Line,
  formatEstimateV3TaxRate,
  formatEstimateV3UnitLabel,
  isEstimateV3PricingStatus,
  resolveEstimateV3TaxRateOptions,
  resolveEstimateV3UnitInput,
  type EstimateV3LineIndex,
} from "@/lib/estimates/v3-editor";
import { parseHoursPerUnit } from "@/lib/numeric-input/parsers";
import { MEASUREMENT_UNITS } from "@/lib/units/normalize";

/**
 * Lot 2, sous-lot 2.6 - cellules v3 de la grille (conception D4, D8, D9 ; contrat d'écran §9.4.2 de
 * docs/testing/estimate-engine-v3-2.6.md). `LineRow`, `StandardMoCells` et `EstimateEditorRow`
 * délèguent ici quand l'éditeur est ouvert sur une v3 (contexte fourni par `EstimateEditorPage`) ;
 * sans contexte (v1/v2), rien ne change. Aucun montant n'est calculé : PU, PT et heures totales
 * viennent de l'aperçu du moteur pur ; les cellules n'écrivent que des saisies (`unit_code`,
 * `pricing_status`, `h_mo_per_unit`, `tax_rate_bp`), jamais `h_mo` ni une projection.
 */

export type EstimateV3GridModel = {
  /** Lignes calculées par le moteur pur pour l'aperçu courant (vide si l'aperçu est refusé). */
  lines: EstimateV3LineIndex;
};

const EstimateV3GridContext = createContext<EstimateV3GridModel | null>(null);
const UNIT_OPTIONS_ID = "estimate-v3-unit-options";

export function EstimateV3GridProvider({ value, children }: { value: EstimateV3GridModel | null; children: ReactNode }) {
  return (
    <EstimateV3GridContext.Provider value={value}>
      {children}
      {value ? (
        <datalist id={UNIT_OPTIONS_ID}>
          {MEASUREMENT_UNITS.filter((unit) => unit.active).map((unit) => (
            <option key={unit.code} value={formatEstimateV3UnitLabel(unit.code)} />
          ))}
        </datalist>
      ) : null}
    </EstimateV3GridContext.Provider>
  );
}

/** Modèle v3 de la grille, ou nul pour une v1/v2 (cellules historiques). */
export function useEstimateV3Grid(): EstimateV3GridModel | null {
  return useContext(EstimateV3GridContext);
}

/** Ligne calculée par le moteur pour un élément de la grille, ou nulle. */
export function useEstimateV3Line(itemId: string): EstimateV3LineResult | null {
  const grid = useEstimateV3Grid();
  return grid ? findEstimateV3Line(grid.lines, itemId) : null;
}

type PatchItem = (itemId: string, patch: ItemPatch, options?: { persist?: boolean }) => void;

function lineLabel(item: Pick<EstimateItem, "title">) {
  return item.title || "sans titre";
}

/**
 * Cellule « U » (référentiel, D9) : un alias unique validé à la sortie du champ (« ML » → ml),
 * affiché « ml — mètre linéaire ». Une saisie inconnue reste visible, refusée par son message
 * (cellule signalée, `aria-invalid`, message dans l'infobulle et pour les lecteurs d'écran), sans
 * écriture ; la cellule se quitte (revue de 2.6, F26-10 : `reportValidity()` y ramenait le focus et
 * Tab ne sortait plus de la cellule). Vider le champ retire l'unité (brouillon incomplet admis).
 */
export function V3UnitCell({
  cell,
  cellProps,
  editorProps,
  navigation,
  item,
  isReadOnly,
  onPatchItem,
}: {
  cell: SpreadsheetCell;
  cellProps: SpreadsheetCellProps;
  editorProps: SpreadsheetEditorProps<HTMLInputElement>;
  navigation: SpreadsheetNavigationResult;
  item: EstimateItem;
  isReadOnly: boolean;
  onPatchItem: PatchItem;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const displayed = formatEstimateV3UnitLabel(item.unit_code);
  const value = draft ?? displayed;
  const errorId = `${cell.rowId}-v3-unit-error`;

  return (
    <div
      {...cellProps}
      data-estimate-column="unit"
      role="gridcell"
      onKeyDown={toCellKeyDownHandler(cellProps.onKeyDown)}
      className={toCellClassName(
        navigation,
        cell,
        `estimate-cell${!value.trim() || error ? " estimate-cell--required-empty" : ""}`,
      )}
    >
      <input
        className="estimate-input"
        ref={editorProps.ref}
        tabIndex={editorProps.tabIndex}
        list={UNIT_OPTIONS_ID}
        value={value}
        title={error ?? (displayed || undefined)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onFocus={editorProps.onFocus}
        onKeyDown={editorProps.onKeyDown}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
          event.currentTarget.setCustomValidity("");
        }}
        onBlur={(event) => {
          editorProps.onBlur(event);
          if (draft === null) return;
          const resolution = resolveEstimateV3UnitInput(draft, item.unit_code);
          if (resolution.kind === "invalid") {
            setError(resolution.message);
            event.currentTarget.setCustomValidity(resolution.message);
            return;
          }
          setDraft(null);
          if (resolution.kind === "unit" && resolution.unitCode !== (item.unit_code ?? null)) {
            onPatchItem(item.id, { unit_code: resolution.unitCode }, { persist: true });
          }
        }}
        placeholder="Obligatoire"
        aria-label={`Unité pour ${lineLabel(item)}`}
        disabled={isReadOnly}
      />
      {error ? <span id={errorId} className="sr-only">{error}</span> : null}
    </div>
  );
}

const HOURS_FORMAT = { minDecimals: 0, maxDecimals: 3 } as const;

/**
 * Contenu de la cellule « h MO » d'une v3 : heures **par unité** saisies (D4, 4 décimales,
 * `h_mo_per_unit`) et, en lecture seule, les heures totales de la ligne Q × h/u telles que le
 * moteur les dérive. La cellule n'écrit jamais `h_mo`.
 */
export function V3LaborHoursCellContent({
  item,
  editorProps,
  isReadOnly,
  onPatchItem,
}: {
  item: EstimateItem;
  editorProps: SpreadsheetEditorProps<HTMLInputElement>;
  isReadOnly: boolean;
  onPatchItem: PatchItem;
}) {
  const line = useEstimateV3Line(item.id);
  const totalHours = line ? (line.h_mo === null ? null : Number(line.h_mo)) : item.h_mo;
  return (
    <div className="flex min-w-0 flex-col items-stretch gap-0.5">
      <DecimalDraftInput
        className="estimate-input estimate-input--compact-number"
        ref={editorProps.ref}
        tabIndex={editorProps.tabIndex}
        value={item.h_mo_per_unit ?? null}
        emptyValue={0}
        parseValue={parseHoursPerUnit}
        aria-label={`Heures de main-d’œuvre par unité pour ${lineLabel(item)}`}
        title="Heures de main-d’œuvre par unité : la quantité les multiplie (h MO total = Qté × h MO / u)."
        onFocus={editorProps.onFocus}
        onKeyDown={editorProps.onKeyDown}
        onValueChange={(value) => onPatchItem(item.id, { h_mo_per_unit: value }, { persist: false })}
        onBlur={editorProps.onBlur}
        onValueCommit={(value) => onPatchItem(item.id, { h_mo_per_unit: value }, { persist: true })}
        placeholder="0"
        disabled={isReadOnly}
      />
      <span className="flex items-baseline justify-end gap-0.5 text-micro text-muted-foreground" title="Total d'heures de la ligne : Qté × h MO / u">
        <span aria-hidden="true">Σ</span>
        <output aria-label={`Heures de main-d’œuvre totales pour ${lineLabel(item)}`} className="tabular-nums">
          {formatNumberDisplay(totalHours ?? 0, HOURS_FORMAT)}
        </output>
      </span>
    </div>
  );
}

/**
 * Statut de chiffrage (D9) et taux de TVA de ligne (D8) d'une v3, sous la désignation. Une ligne
 * non chiffrée garde ses saisies (Q, PR, h/u) ; le moteur l'exclut du HT et de la TVA.
 */
export function V3LineStateControls({
  item,
  isReadOnly,
  onPatchItem,
}: {
  item: EstimateItem;
  isReadOnly: boolean;
  onPatchItem: PatchItem;
}) {
  const status = isEstimateV3PricingStatus(item.pricing_status) ? item.pricing_status : "priced";
  const taxRates = resolveEstimateV3TaxRateOptions(item.tax_rate_bp);
  return (
    <span className="inline-flex shrink-0 items-center gap-1" data-testid="estimate-v3-line-state">
      <select
        className="estimate-input h-6 w-auto py-0 text-xs"
        aria-label={`Statut de chiffrage pour ${lineLabel(item)}`}
        value={status}
        disabled={isReadOnly}
        onChange={(event) => {
          if (!isEstimateV3PricingStatus(event.target.value)) return;
          onPatchItem(item.id, { pricing_status: event.target.value }, { persist: true });
        }}
      >
        {ESTIMATE_V3_PRICING_STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <select
        className="estimate-input h-6 w-auto py-0 text-xs"
        aria-label={`Taux de TVA pour ${lineLabel(item)}`}
        value={item.tax_rate_bp === null ? "" : String(item.tax_rate_bp)}
        disabled={isReadOnly}
        onChange={(event) => {
          const rateBp = Number(event.target.value);
          if (!Number.isInteger(rateBp)) return;
          onPatchItem(item.id, { tax_rate_bp: rateBp }, { persist: true });
        }}
      >
        {item.tax_rate_bp === null ? <option value="">TVA</option> : null}
        {taxRates.map((rateBp) => (
          <option key={rateBp} value={String(rateBp)}>{`TVA ${formatEstimateV3TaxRate(rateBp)} %`}</option>
        ))}
      </select>
    </span>
  );
}
