/**
 * Lot 2, sous-lot 2.6 - éditeur v3 côté client (conception D4, D5, D7 à D9, D11, §4 ;
 * docs/testing/estimate-engine-v3-2.6.md §1.4 et §9.4).
 *
 * Module pur, sans React ni Supabase, chargeable par le navigateur. Aucun montant n'est calculé
 * ici : la grille et le pied lisent l'aperçu du moteur pur de 2.4 que `useEstimateV3Settings`
 * calcule avec les mêmes entrées que le serveur (`buildEstimateV3PreviewInput`). L'aperçu ne part
 * jamais comme total : le serveur recalcule chaque écriture (2.5). Les charges de ligne v3 ne
 * portent que des saisies (D4, D12).
 */
import type { EstimateV3Breakdown, EstimateV3LineResult } from "@/lib/estimates/engine-v3";
import {
  buildEstimateItemUpdatePayload,
  type EditorEstimateItem,
  type EstimateItem,
  type EstimateItemUpdatePayload,
  type EstimateVersionRow,
} from "@/lib/estimates/editor-items";
import {
  ESTIMATE_LINE_PRICING_STATUSES,
  MEASUREMENT_UNITS,
  normalizeMeasurementUnit,
  type EstimateLinePricingStatus,
} from "@/lib/units/normalize";

/** Lignes du moteur v3 par identifiant (minuscules, comme le départage D13). */
export type EstimateV3LineIndex = ReadonlyMap<string, EstimateV3LineResult>;

const EMPTY_LINES: EstimateV3LineIndex = new Map();

/** Totaux d'heures et projections : dérivés en v3, jamais écrits par l'éditeur (D4, D12). */
const V3_DERIVED_ITEM_KEYS = [
  "h_mo",
  "h_mo_atelier",
  "h_mo_chantier",
  "pu_ht_cents",
  "line_total_ht_cents",
  "line_tax_cents",
  "line_total_ttc_cents",
] as const;

/** Colonnes de saisie d'une ligne v3 (même liste que `V3_ITEM_INPUT_KEYS`, 2.5). */
const V3_INPUT_ITEM_KEYS = [
  "unit_code",
  "pricing_status",
  "h_mo_per_unit",
  "h_mo_atelier_per_unit",
  "h_mo_chantier_per_unit",
] as const;

/** Taux de la proposition validée pour le développement (D8, P-07) : défaut de la politique. */
export const ESTIMATE_V3_EDITOR_TAX_RATES_BP: readonly number[] = [2000, 1000, 550, 210];

/** Libellés de la grille (contrat d'écran §4.2) ; le référentiel garde ses libellés d'import. */
export const ESTIMATE_V3_PRICING_STATUS_OPTIONS: ReadonlyArray<{ value: EstimateLinePricingStatus; label: string }> = [
  { value: "priced", label: "Chiffrée" },
  { value: "included", label: "Inclus" },
  { value: "for_memory", label: "Pour mémoire" },
  { value: "not_priced", label: "Non chiffrée" },
  { value: "out_of_scope", label: "Hors lot" },
  { value: "not_applicable", label: "Sans objet" },
];

function readRecord(source: object, key: string): unknown {
  return (source as Record<string, unknown>)[key];
}

/** Statut de ligne de la grille : une valeur hors domaine n'est jamais proposée comme choix. */
export function isEstimateV3PricingStatus(value: unknown): value is EstimateLinePricingStatus {
  return typeof value === "string" && (ESTIMATE_LINE_PRICING_STATUSES as readonly string[]).includes(value);
}

/** Index des lignes calculées par le moteur pur (aperçu de `useEstimateV3Settings`). */
export function indexEstimateV3Lines(breakdown: EstimateV3Breakdown | null | undefined): EstimateV3LineIndex {
  return breakdown ? new Map(breakdown.lines.map((line) => [line.id, line])) : EMPTY_LINES;
}

/** Ligne calculée d'un élément de la grille, ou nulle (section, ligne en cours de création). */
export function findEstimateV3Line(index: EstimateV3LineIndex, itemId: string): EstimateV3LineResult | null {
  return index.get(itemId.toLowerCase()) ?? null;
}

function toHours(value: string | null): number | null {
  if (value === null) return null;
  const hours = Number(value);
  return Number.isFinite(hours) ? hours : null;
}

/**
 * Lignes affichées : PU publié (nul pour une ligne non chiffrée), net, TVA et TTC de ligne, parts
 * FO/MO nettes et heures dérivées, tels que le moteur les rend. Les colonnes gardent leur sens
 * historique (D7) : le net de ligne reste dans `line_total_ht_cents` (les sections et le pied de la
 * grille somment des nets, Σ = HT) ; le brut affiché au PT vient de l'aperçu. Ces lignes ne sont
 * qu'affichées : l'état de l'éditeur et les écritures gardent les saisies.
 */
export function applyEstimateV3PreviewToItems(
  items: EditorEstimateItem[],
  index: EstimateV3LineIndex
): EditorEstimateItem[] {
  if (index.size === 0) return items;
  return items.map((item) => {
    const line = findEstimateV3Line(index, item.id);
    if (!line) return item;
    return {
      ...item,
      pu_ht_cents: line.pu_ht_cents,
      line_total_ht_cents: line.line_total_ht_cents,
      line_tax_cents: line.line_tax_cents,
      line_total_ttc_cents: line.line_total_ttc_cents,
      snapshot_fo_ht_cents: line.snapshot_fo_ht_cents,
      snapshot_mo_ht_cents: line.snapshot_mo_ht_cents,
      snapshot_mo_atelier_ht_cents: line.snapshot_mo_atelier_ht_cents,
      snapshot_mo_chantier_ht_cents: line.snapshot_mo_chantier_ht_cents,
      h_mo: toHours(line.h_mo),
      h_mo_atelier: toHours(line.h_mo_atelier),
      h_mo_chantier: toHours(line.h_mo_chantier),
    } as EditorEstimateItem;
  });
}

function withoutDerivedKeys(payload: EstimateItemUpdatePayload): EstimateItemUpdatePayload {
  const next: Record<string, unknown> = { ...payload };
  for (const key of V3_DERIVED_ITEM_KEYS) delete next[key];
  return next as EstimateItemUpdatePayload;
}

function pickV3InputFields(item: EstimateItem): Partial<EstimateItemUpdatePayload> {
  const picked: Record<string, unknown> = {};
  for (const key of V3_INPUT_ITEM_KEYS) {
    if (key in item) picked[key] = readRecord(item, key) ?? null;
  }
  if (picked.pricing_status === null) delete picked.pricing_status;
  return picked as Partial<EstimateItemUpdatePayload>;
}

/**
 * Charge d'une ligne v3 pour l'écrivain de lot (2.5) : saisies seulement (unité du référentiel,
 * statut, heures par unité), jamais `h_mo` ni une projection (D4, D12). Une section garde la
 * charge historique (titre, AID).
 */
export function buildEstimateV3ItemUpdatePayload(item: EstimateItem): EstimateItemUpdatePayload {
  const payload = buildEstimateItemUpdatePayload(item);
  if (item.item_type !== "line") return payload;
  return { ...withoutDerivedKeys(payload), ...pickV3InputFields(item) };
}

/**
 * Référence de synchronisation d'une ligne relue : charge historique plus les saisies v3 que la
 * ligne porte. Ces clés de plus ne changent rien en v1/v2 (une charge v1/v2 n'en porte aucune, la
 * comparaison ne lit que les clés de la charge) ; en v3 elles évitent qu'une saisie inchangée
 * repasse pour une modification.
 */
export function buildEditorItemSyncBaseline(item: EstimateItem): EstimateItemUpdatePayload {
  const payload = buildEstimateItemUpdatePayload(item);
  return item.item_type === "line" ? { ...payload, ...pickV3InputFields(item) } : payload;
}

/** Charge mise en file vers l'écriture de lot : une v3 n'envoie aucune valeur dérivée. */
export function toEstimateV3ItemWrite(payload: EstimateItemUpdatePayload): EstimateItemUpdatePayload {
  return withoutDerivedKeys(payload);
}

/* ---------- Unités (référentiel, D9) ---------- */

const UNIT_BY_CODE = new Map(MEASUREMENT_UNITS.filter((unit) => unit.active).map((unit) => [unit.code, unit]));

/** « ml — mètre linéaire » (contrat d'écran §4.2) ; vide sans unité. */
export function formatEstimateV3UnitLabel(unitCode: string | null | undefined): string {
  if (!unitCode) return "";
  const unit = UNIT_BY_CODE.get(unitCode);
  return unit ? `${unit.code} — ${unit.label.toLocaleLowerCase("fr-FR")}` : unitCode;
}

export type EstimateV3UnitInputResolution =
  | { kind: "unchanged" }
  | { kind: "unit"; unitCode: string | null }
  | { kind: "invalid"; message: string };

/**
 * Saisie de la cellule « U » : un alias unique du référentiel (« ML » → ml), le libellé affiché
 * (inchangé) ou vide (unité retirée, brouillon admis). Une saisie inconnue, ou qui désigne un
 * statut (« HL », « PM »), est refusée par un message : jamais d'unité devinée ni de texte libre.
 */
export function resolveEstimateV3UnitInput(raw: string, currentUnitCode: string | null | undefined): EstimateV3UnitInputResolution {
  const text = raw.trim();
  if (text === formatEstimateV3UnitLabel(currentUnitCode).trim()) return { kind: "unchanged" };
  if (text.length === 0) return { kind: "unit", unitCode: null };
  const displayed = MEASUREMENT_UNITS.find((unit) => formatEstimateV3UnitLabel(unit.code) === text);
  if (displayed) return { kind: "unit", unitCode: displayed.code };
  const resolution = normalizeMeasurementUnit(text);
  if (resolution.unitCode) return { kind: "unit", unitCode: resolution.unitCode };
  if (resolution.pricingStatus) {
    return { kind: "invalid", message: `« ${text} » est un statut de ligne, pas une unité : choisissez-le dans la colonne Statut.` };
  }
  return { kind: "invalid", message: `Unité inconnue du référentiel : « ${text} ».` };
}

/* ---------- TVA (D8) ---------- */

/** « 20 », « 5,5 », « 2,1 » : taux de TVA en pourcentage fr-FR. */
export function formatEstimateV3TaxRate(rateBp: number): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(rateBp / 100);
}

/** Taux proposés par la cellule « TVA % » : la politique, plus le taux de la ligne s'il en sort. */
export function resolveEstimateV3TaxRateOptions(currentRateBp: number | null | undefined): number[] {
  const rates = [...ESTIMATE_V3_EDITOR_TAX_RATES_BP];
  if (typeof currentRateBp === "number" && Number.isInteger(currentRateBp) && !rates.includes(currentRateBp)) {
    rates.push(currentRateBp);
  }
  return rates;
}

/* ---------- Pied (D7, D8) ---------- */

export type EstimateV3SummaryView = {
  totalHtCents: number;
  totalTaxCents: number;
  payableTtcCents: number;
  grossHtCents: number;
  discountAppliedCents: number;
  commercialRoundingCents: number;
  taxByRate: ReadonlyArray<{ rateBp: number; baseCents: number; taxCents: number }>;
};

export function buildEstimateV3SummaryView(breakdown: EstimateV3Breakdown | null): EstimateV3SummaryView | null {
  if (!breakdown) return null;
  const { totals } = breakdown;
  return {
    totalHtCents: totals.total_ht_cents,
    totalTaxCents: totals.total_tax_cents,
    payableTtcCents: totals.total_ttc_cents,
    grossHtCents: totals.gross_ht_cents,
    discountAppliedCents: totals.discount_applied_cents,
    commercialRoundingCents: totals.commercial_rounding_cents,
    taxByRate: totals.tax_breakdown.map((row) => ({ rateBp: row.rate_bp, baseCents: row.base_cents, taxCents: row.tax_cents })),
  };
}

/**
 * Pied d'un brouillon v3 relu sans recalcul (fiche, impression) : totaux stockés de la version et,
 * par taux, la somme des nets et des TVA de ligne stockés des lignes chiffrées (contrôlés à chaque
 * sauvegarde par `estimate_v3_assert_draft`, D12).
 */
export function readStoredEstimateV3DraftSummary(
  version: Pick<EstimateVersionRow, "total_ht_cents" | "total_tax_cents" | "total_ttc_cents" | "gross_ht_cents" | "discount_applied_cents" | "commercial_rounding_cents">,
  items: ReadonlyArray<Pick<EstimateItem, "item_type" | "pricing_status" | "tax_rate_bp" | "line_total_ht_cents" | "line_tax_cents">>
): EstimateV3SummaryView {
  const byRate = new Map<number, { baseCents: number; taxCents: number }>();
  for (const item of items) {
    if (item.item_type !== "line" || (item.pricing_status ?? "priced") !== "priced" || item.tax_rate_bp === null) continue;
    const entry = byRate.get(item.tax_rate_bp) ?? { baseCents: 0, taxCents: 0 };
    entry.baseCents += item.line_total_ht_cents ?? 0;
    entry.taxCents += item.line_tax_cents ?? 0;
    byRate.set(item.tax_rate_bp, entry);
  }
  return {
    totalHtCents: version.total_ht_cents ?? 0,
    totalTaxCents: version.total_tax_cents ?? 0,
    payableTtcCents: version.total_ttc_cents ?? 0,
    grossHtCents: version.gross_ht_cents ?? 0,
    discountAppliedCents: version.discount_applied_cents ?? 0,
    commercialRoundingCents: version.commercial_rounding_cents ?? 0,
    taxByRate: [...byRate.entries()].sort(([left], [right]) => right - left)
      .map(([rateBp, entry]) => ({ rateBp, ...entry })),
  };
}
