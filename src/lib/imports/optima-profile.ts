import { normalizeHeaderValue } from "@/lib/imports/tabular-normalization";
import type { MappingTargetField, SourceToTargetMapping } from "@/lib/mappings/schemas";
import { SUPPORTED_ESTIMATE_CURRENCIES } from "@/lib/money";

/**
 * Declared import profiles (D11, sub-lot 2.3). A profile is recognised from the header row the
 * upload stored, then declares the meaning of each of its columns instead of letting the generic
 * heuristic guess them. It never reinterprets a stored amount: the conversion of hours per unit
 * into v1/v2 line hours, the majoration convention and the controls live in the import flow.
 *
 * - OPTIMA (Feuil1!A1:O1 of the workbooks in docs/prd_file): "Prix Unitaire" and the other
 *   computed columns are controls, "Coeff FO", "Coeff MO" and "Taux horaire" are parameters
 *   read on the parameter row, "Majoration MO" is additive (coefficient = 1 + N).
 * - Editor export (src/lib/estimates/editor-export.ts): its "Prix unitaire HT (EUR)" is the supply
 *   cost (PR FO) and its sale columns are controls, so a re-import keeps the stored values.
 * - DPGF export (src/lib/estimates/dpgf-export.ts, 2.3 review): "Prix unitaire HT EUR" is the supply
 *   cost, "Majoration MO (%)" follows P-11 and the bare "Majoration MO" of its earlier files is the
 *   raw coefficient it wrote then.
 * - DPGF export of an engine 3 estimate (src/lib/estimates/v3-export.ts, sub-lot 2.7, review of
 *   8dd28c91): the same re-importable inputs, but "h MO / unité" is hours PER UNIT, never line hours,
 *   and its "PU vente HT" and "Total HT brut" are published sale amounts, so controls: read as the
 *   line total, they would price the labour twice. Its amount headers end with the version currency.
 */
export type ImportProfileId = "optima" | "editor_export" | "dpgf_export" | "dpgf_export_v3";

export type ImportProfileMatch = {
  id: ImportProfileId;
  label: string;
  mapping: SourceToTargetMapping;
  // Declared columns that carry no imported value (row number, TTC, line coefficients…).
  ignoredColumns: string[];
};

type DeclaredColumn = { header: string; target: MappingTargetField | null };

type DeclaredProfile = {
  id: ImportProfileId;
  label: string;
  columns: DeclaredColumn[];
  // Every signature header must be present for the profile to apply.
  signature: string[];
};

const OPTIMA_PROFILE: DeclaredProfile = {
  id: "optima",
  label: "Classeur OPTIMA",
  columns: [
    { header: "N°", target: null },
    { header: "Désignation", target: "designation" },
    { header: "Uté", target: "unit" },
    { header: "Qté", target: "quantity" },
    { header: "Prix Unitaire", target: "control_unit_price" },
    { header: "Prix Total", target: "control_total_price" },
    { header: "PR Fourniture unitaire", target: "unit_price_ht" },
    { header: "PR Total fourniture", target: "control_supply_total" },
    { header: "Tps pose unitaire", target: "labor_hours_per_unit" },
    { header: "Tps pose unitaire majoré", target: "control_marked_up_hours_per_unit" },
    { header: "Tps pose total", target: "control_total_hours" },
    { header: "Coeff FO", target: "param_coeff_fo" },
    { header: "Coeff MO", target: "param_coeff_mo" },
    { header: "Majoration MO", target: "h_mo_majoration_additive" },
    { header: "Taux horaire", target: "param_hourly_rate" },
  ],
  signature: ["PR Fourniture unitaire", "Tps pose unitaire", "Majoration MO", "Coeff MO"],
};

const EDITOR_EXPORT_PROFILE: DeclaredProfile = {
  id: "editor_export",
  label: "Export de l'éditeur de chiffrage",
  columns: [
    { header: "Chemin chapitre", target: null },
    { header: "Désignation", target: "designation" },
    { header: "Flags qualité", target: null },
    { header: "Unité", target: "unit" },
    { header: "Quantité", target: "quantity" },
    { header: "Prix unitaire HT (EUR)", target: "unit_price_ht" },
    { header: "Type FO", target: "supply_type" },
    { header: "K FO", target: null },
    { header: "h MO", target: "labor_hours" },
    { header: "Majoration MO (%)", target: "h_mo_majoration_percent" },
    { header: "Rôle MO", target: null },
    { header: "K MO", target: null },
    { header: "PU HT (EUR)", target: "control_unit_price" },
    { header: "Total HT (EUR)", target: "control_total_price" },
    { header: "TVA (%)", target: null },
    { header: "Total TTC (EUR)", target: null },
    { header: "h MO atelier", target: null },
    { header: "Rôle MO atelier", target: null },
    { header: "K MO atelier", target: null },
    { header: "h MO chantier", target: null },
    { header: "Rôle MO chantier", target: null },
    { header: "K MO chantier", target: null },
  ],
  signature: ["Prix unitaire HT (EUR)", "PU HT (EUR)", "Total HT (EUR)"],
};

const DPGF_EXPORT_PROFILE: DeclaredProfile = {
  id: "dpgf_export",
  label: "Export DPGF du chiffrage",
  columns: [
    { header: "Type", target: null },
    { header: "AID", target: null },
    { header: "Désignation", target: "designation" },
    { header: "Quantité", target: "quantity" },
    { header: "Unité", target: "unit" },
    { header: "Prix unitaire HT EUR", target: "unit_price_ht" },
    { header: "Type FO", target: "supply_type" },
    { header: "K FO", target: null },
    { header: "h MO", target: "labor_hours" },
    { header: "K MO", target: null },
    { header: "Majoration MO (%)", target: "h_mo_majoration_percent" },
    { header: "Majoration MO", target: "h_mo_majoration_coefficient" },
    { header: "Rôle MO", target: null },
    { header: "Catégorie", target: "category" },
    { header: "h MO Atelier", target: null },
    { header: "K MO Atelier", target: null },
    { header: "Rôle MO Atelier", target: null },
    { header: "h MO Chantier", target: null },
    { header: "K MO Chantier", target: null },
    { header: "Rôle MO Chantier", target: null },
  ],
  signature: ["AID", "Prix unitaire HT EUR", "h MO", "Rôle MO"],
};

/** One declared column per estimate currency: the v3 DPGF names its amount columns in the version currency. */
function perCurrency(header: string, target: MappingTargetField): DeclaredColumn[] {
  return SUPPORTED_ESTIMATE_CURRENCIES.map((currency) => ({ header: `${header} ${currency}`, target }));
}

const DPGF_V3_EXPORT_PROFILE: DeclaredProfile = {
  id: "dpgf_export_v3",
  label: "Export DPGF d'un devis au moteur de calcul 3",
  columns: [
    { header: "Type", target: null },
    { header: "AID", target: null },
    { header: "Désignation", target: "designation" },
    { header: "Quantité", target: "quantity" },
    { header: "Unité", target: "unit" },
    { header: "Statut", target: null },
    { header: "TVA (%)", target: null },
    ...perCurrency("Prix unitaire HT", "unit_price_ht"),
    { header: "Type FO", target: "supply_type" },
    { header: "K FO", target: null },
    { header: "h MO / unité", target: "labor_hours_per_unit" },
    { header: "K MO", target: null },
    { header: "Majoration MO (%)", target: "h_mo_majoration_percent" },
    { header: "Rôle MO", target: null },
    { header: "Catégorie", target: "category" },
    { header: "h MO Atelier / unité", target: null },
    { header: "K MO Atelier", target: null },
    { header: "Rôle MO Atelier", target: null },
    { header: "h MO Chantier / unité", target: null },
    { header: "K MO Chantier", target: null },
    { header: "Rôle MO Chantier", target: null },
    ...perCurrency("PU vente HT", "control_unit_price"),
    ...perCurrency("Total HT brut", "control_total_price"),
  ],
  // "Statut" and "h MO / unité" are absent from the v1/v2 DPGF export, whose "h MO" this file lacks.
  signature: ["AID", "Statut", "h MO / unité", "Rôle MO"],
};

const DECLARED_PROFILES = [OPTIMA_PROFILE, EDITOR_EXPORT_PROFILE, DPGF_EXPORT_PROFILE, DPGF_V3_EXPORT_PROFILE];

/**
 * Header identity shared by raw headers and the keys both upload parsers store: a raw header is
 * first reduced to its upload key (idempotent on keys), then compared word by word.
 */
export function normalizeProfileHeader(header: string): string {
  return normalizeHeaderValue(header, 0).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function detectImportProfile(sourceColumns: string[]): ImportProfileMatch | null {
  const columnsByHeader = new Map<string, string>();
  for (const column of sourceColumns) {
    const key = normalizeProfileHeader(column);
    if (!columnsByHeader.has(key)) columnsByHeader.set(key, column);
  }

  for (const profile of DECLARED_PROFILES) {
    const matches = profile.signature.every((header) =>
      columnsByHeader.has(normalizeProfileHeader(header))
    );
    if (!matches) continue;

    const mapping: SourceToTargetMapping = {};
    const ignoredColumns: string[] = [];
    for (const declared of profile.columns) {
      const source = columnsByHeader.get(normalizeProfileHeader(declared.header));
      if (!source) continue;
      if (declared.target) mapping[source] = declared.target;
      else ignoredColumns.push(source);
    }
    return { id: profile.id, label: profile.label, mapping, ignoredColumns };
  }

  return null;
}

export type WorkbookParameterValues = {
  coeffFo: unknown;
  coeffMo: unknown;
  hourlyRate: unknown;
  // Raw majoration cells of the parameter row, by declared target.
  majoration: Partial<Record<MajorationTarget, unknown>>;
};

export const MAJORATION_TARGETS = [
  "h_mo_majoration_percent",
  "h_mo_majoration_coefficient",
  "h_mo_majoration_additive",
  "h_mo_majoration",
] as const;
export type MajorationTarget = (typeof MAJORATION_TARGETS)[number];

const PARAMETER_TARGETS = ["param_coeff_fo", "param_coeff_mo", "param_hourly_rate"] as const;

function isProvided(value: unknown) {
  if (value === null || value === undefined) return false;
  return typeof value !== "string" || value.trim().length > 0;
}

/**
 * OPTIMA keeps its parameters on one row without designation (row 2: L2 Coeff FO, M2 Coeff MO,
 * N2 additive majoration, O2 Taux horaire). Such a row is a parameter row, never an estimate line.
 */
export function isWorkbookParameterRow(mappedRow: Record<string, unknown>, title: string) {
  return title.length === 0 && PARAMETER_TARGETS.some((target) => isProvided(mappedRow[target]));
}

export function readWorkbookParameterValues(
  mappedRow: Record<string, unknown>
): WorkbookParameterValues {
  const majoration: WorkbookParameterValues["majoration"] = {};
  for (const target of MAJORATION_TARGETS) {
    if (isProvided(mappedRow[target])) majoration[target] = mappedRow[target];
  }
  return {
    coeffFo: isProvided(mappedRow.param_coeff_fo) ? mappedRow.param_coeff_fo : null,
    coeffMo: isProvided(mappedRow.param_coeff_mo) ? mappedRow.param_coeff_mo : null,
    hourlyRate: isProvided(mappedRow.param_hourly_rate) ? mappedRow.param_hourly_rate : null,
    majoration,
  };
}

export type ImportUnitPriceCheck = {
  rowIndex: number;
  title: string;
  expectedUnitPriceCents: number;
  computedUnitPriceCents: number;
  deltaCents: number;
};

// D11: a recomputed unit price farther than half a cent from the workbook control is listed.
export const IMPORT_CONTROL_TOLERANCE_CENTS = 0.5;

/** Compares the recomputed sale unit price (line total / Q, unrounded) to the control column. */
export function checkUnitPriceAgainstControl(input: {
  rowIndex: number;
  title: string;
  quantity: number;
  lineTotalHtCents: number;
  controlUnitPriceCents: number | null;
}): ImportUnitPriceCheck | null {
  if (input.controlUnitPriceCents === null || !(input.quantity > 0)) return null;
  const computedUnitPriceCents = input.lineTotalHtCents / input.quantity;
  return {
    rowIndex: input.rowIndex,
    title: input.title,
    expectedUnitPriceCents: input.controlUnitPriceCents,
    computedUnitPriceCents,
    deltaCents: computedUnitPriceCents - input.controlUnitPriceCents,
  };
}
