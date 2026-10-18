/**
 * Lot 2, sous-lot 2.8, règle 2 (D16) — collage vers une v3. Chaque ligne collée écrit ses saisies v3 : unité du
 * référentiel ou statut de ligne, heures par unité ; jamais une unité en texte libre (`description`) ni des heures de
 * ligne. L'aperçu du collage montre ces valeurs interprétées. Le rôle MO suit la règle de l'import OPTIMA (E17) : celui
 * choisi, sinon l'unique rôle actif au « Taux horaire » de la feuille, sinon un choix explicite.
 * Contrat : docs/testing/estimate-engine-v3-2.8.md, règle 2.
 */
import {
  resolveImportLaborRole,
  type ImportLaborRoleCandidate,
  type ImportLaborRoleResolution,
} from "@/lib/affaires/import-flow";
import {
  DEFAULT_CLIPBOARD_FIELD_ORDER,
  type ClipboardPreviewValues,
  type ClipboardTargetField,
} from "@/lib/estimates/clipboard";
import { ESTIMATE_V3_PRICING_STATUS_OPTIONS } from "@/lib/estimates/v3-editor";
import {
  ESTIMATE_LINE_PRICING_STATUS_LABELS,
  normalizeMeasurementUnit,
  type EstimateLinePricingStatus,
} from "@/lib/units/normalize";

/** Saisies v3 d'une ligne collée, en plus des saisies communes (désignation, quantité, prix, coefficients). */
export type V3PasteLineWrite = {
  unit_code: string | null;
  pricing_status: EstimateLinePricingStatus;
  h_mo_per_unit: number | null;
};

export type V3PasteRowInterpretation =
  | { ok: true; write: V3PasteLineWrite; notes: string[] }
  | { ok: false; reasons: string[]; notes: string[] };

export const V3_PASTE_LINE_HOURS_REASON =
  "Heures de ligne : sur un devis au moteur de calcul 3, associez cette colonne à « Heures MO par unité (h/u) ».";

const HOURS_PER_UNIT_FORMAT = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 4 });
const MONEY_FORMAT = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Copie de la grille d'une v3 : les heures par unité saisies, jamais les heures de ligne dérivées. */
export const V3_CLIPBOARD_FIELD_ORDER: ClipboardTargetField[] = DEFAULT_CLIPBOARD_FIELD_ORDER
  .map((field) => (field === "h_mo" ? "h_mo_per_unit" : field));

/**
 * Unité d'une ligne v3 dans la copie de la grille : son code, ou pour une ligne non chiffrée la mention de son statut
 * (« Hors lot », « Pour mémoire »…), que le référentiel relit comme ce statut au collage.
 */
export function v3ClipboardUnit(line: { unit_code: string | null; pricing_status: EstimateLinePricingStatus | null }): string | null {
  if (line.pricing_status && line.pricing_status !== "priced") return ESTIMATE_LINE_PRICING_STATUS_LABELS[line.pricing_status];
  return line.unit_code;
}

/**
 * Ligne de paramètres d'une feuille OPTIMA (ligne 2 : coefficients, majoration, « Taux horaire ») : sans
 * désignation, elle porte le taux ; jamais collée. L'import la reconnaît à l'un de ses paramètres
 * (`isWorkbookParameterRow`) ; le collage, qui n'associe que le taux, à ce taux.
 */
export function isClipboardSheetParameterRow(values: ClipboardPreviewValues): boolean {
  return !values.designation?.trim() && values.hourly_rate !== null;
}

/** Taux horaires des lignes de paramètres de la feuille collée. */
export function readClipboardSheetRates(rows: readonly ClipboardPreviewValues[]): number[] {
  return rows.filter(isClipboardSheetParameterRow).map((row) => row.hourly_rate as number);
}

/**
 * Majoration MO de la ligne de paramètres (N2), appliquée comme à l'import aux lignes qui n'en portent pas ; aucune
 * si la feuille n'en déclare pas ou en déclare plusieurs.
 */
export function readClipboardSheetMajoration(rows: readonly ClipboardPreviewValues[]): number | null {
  const majorations = new Set(rows.filter(isClipboardSheetParameterRow)
    .map((row) => row.h_mo_majoration).filter((value): value is number => value !== null));
  return majorations.size === 1 ? [...majorations][0]! : null;
}

function statusLabel(status: EstimateLinePricingStatus): string {
  return ESTIMATE_V3_PRICING_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

/** Une ligne de l'aperçu, lue pour une v3 : ce qui sera écrit, ou pourquoi elle est refusée. */
export function interpretClipboardRowForV3(values: ClipboardPreviewValues): V3PasteRowInterpretation {
  if (isClipboardSheetParameterRow(values)) {
    const majoration = values.h_mo_majoration !== null && values.h_mo_majoration !== 1
      ? `, majoration MO ×${HOURS_PER_UNIT_FORMAT.format(values.h_mo_majoration)} des lignes sans majoration` : "";
    return {
      ok: false, reasons: [],
      notes: [`Paramètres du classeur : taux horaire ${MONEY_FORMAT.format(values.hourly_rate as number)} €/h${majoration}, non collés`],
    };
  }
  const reasons: string[] = [];
  const notes: string[] = [];
  let unitCode: string | null = null;
  let pricingStatus: EstimateLinePricingStatus = "priced";

  const unitText = values.unit?.trim() ?? "";
  if (unitText.length === 0) {
    notes.push("Unité à choisir dans la grille");
  } else {
    const resolution = normalizeMeasurementUnit(unitText);
    if (resolution.unitCode) {
      unitCode = resolution.unitCode;
      notes.push(`Unité ${resolution.unitCode}`);
    } else if (resolution.pricingStatus) {
      pricingStatus = resolution.pricingStatus;
      notes.push(`Statut ${statusLabel(resolution.pricingStatus)} (0 €)`);
    } else {
      reasons.push(`Unité inconnue du référentiel : « ${unitText} ».`);
    }
  }

  if (values.h_mo_per_unit !== null) {
    notes.push(`h/u ${HOURS_PER_UNIT_FORMAT.format(values.h_mo_per_unit)}`);
  } else if (values.h_mo !== null && values.h_mo > 0) {
    reasons.push(V3_PASTE_LINE_HOURS_REASON);
  }

  if (values.control_unit_price !== null) {
    notes.push(`Prix Unitaire ${MONEY_FORMAT.format(values.control_unit_price)} : contrôle`);
  }

  if (reasons.length > 0) return { ok: false, reasons, notes: [] };
  return {
    ok: true,
    write: { unit_code: unitCode, pricing_status: pricingStatus, h_mo_per_unit: values.h_mo_per_unit },
    notes,
  };
}

/**
 * Rôle MO des lignes collées (règle de l'import OPTIMA, E17), au taux des lignes à heures ou de la ligne de
 * paramètres de la feuille (`sheetRates`). Des taux différents ne désignent aucun rôle : un choix explicite est
 * demandé. `requestedRoleId` : `undefined` sans choix, `null` pour « aucun rôle ».
 */
export function resolveV3PasteLaborRole(input: {
  rows: readonly ClipboardPreviewValues[];
  roles: readonly ImportLaborRoleCandidate[];
  requestedRoleId?: string | null;
  sheetRates?: readonly number[];
}): ImportLaborRoleResolution {
  const rowsWithHours = input.rows.filter((row) => (row.h_mo_per_unit ?? 0) > 0);
  const rates = new Set(
    [...rowsWithHours.map((row) => row.hourly_rate), ...(input.sheetRates ?? [])]
      .filter((rate): rate is number => rate !== null)
      .map((rate) => Math.round(rate * 100))
  );
  if (rowsWithHours.length > 0 && rates.size > 1 && input.requestedRoleId === undefined) {
    return { status: "choice_required", role: null, matchingRoleIds: [] };
  }
  return resolveImportLaborRole({
    hasLaborHours: rowsWithHours.length > 0,
    workbookHourlyRateCents: rates.size === 1 ? [...rates][0]! : null,
    roles: [...input.roles],
    requestedRoleId: input.requestedRoleId,
  });
}
