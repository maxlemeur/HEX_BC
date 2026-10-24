/**
 * Lot 2, sous-lot 2.5 - passage des lignes stockées au moteur v3 et retour (conception D4 à D9,
 * D12, §6.2). Module pur : tout calcul passe par `@/lib/estimates/engine-v3` (jamais réécrit ici)
 * et la lecture des taux et drapeaux reste dans `version-totals.ts`.
 *
 * Contrats tenus ici :
 * - une ligne v3 n'envoie jamais `h_mo*` : le déclencheur M4 les dérive de Q × h/u (D4) ;
 * - une ligne v1/v2 ne porte ni unité, ni statut autre que `priced`, ni heures par unité (D9) ;
 * - une ligne v3 non chiffrée n'a pas de PU (`pu_ht_cents` nul, décision 3 du sous-lot) ;
 * - la forme de version v3 est celle du CHECK `estimate_versions_engine_v3_shape_check`.
 */
import {
  EstimateV3Error,
  type EstimateV3Breakdown,
  type EstimateV3Input,
  type EstimateV3ItemInput,
  type EstimateV3PricingStatus,
  type EstimateV3SnapshotProjection,
} from "@/lib/estimates/engine-v3";
import { badRequest } from "@/lib/estimates/errors";
import { ESTIMATE_LINE_PRICING_STATUSES, normalizeMeasurementUnit } from "@/lib/units/normalize";

type Numeric = number | string | null | undefined;

/** Réglages de version lus par le moteur v3 (colonnes stockées ou version prospective). */
export type EstimateV3VersionConfig = {
  sale_coefficient_fo?: Numeric;
  sale_coefficient_mo?: Numeric;
  discount_amount_cents?: number | null;
  discount_bp?: number | null;
  rounding_mode?: string | null;
  rounding_step_cents?: number | null;
  contractor_role?: string | null;
  tax_rate_bp: number;
};

/** Ligne stockée ou prospective, telle que le moteur v3 la lit (colonnes v3 comprises). */
export type EstimateV3LineRecord = {
  id: string;
  parent_id?: string | null;
  item_type: string;
  quantity: Numeric;
  unit_price_ht_cents: Numeric;
  tax_rate_bp: number | null;
  k_fo: Numeric;
  /** TI-534 : provision FO stockée, ou dérivée du type FO pour une ligne prospective (`fo-provision.ts`). */
  fo_provision?: Numeric;
  h_mo_majoration?: Numeric;
  k_mo: Numeric;
  k_mo_atelier?: Numeric;
  k_mo_chantier?: Numeric;
  labor_role_id: string | null;
  labor_role_atelier_id?: string | null;
  labor_role_chantier_id?: string | null;
  unit_code?: string | null;
  pricing_status?: string | null;
  h_mo_per_unit?: Numeric;
  h_mo_atelier_per_unit?: Numeric;
  h_mo_chantier_per_unit?: Numeric;
};

export type EstimateV3LineProjection = {
  id: string;
  pu_ht_cents: number | null;
  line_total_ht_cents: number;
  line_tax_cents: number;
  line_total_ttc_cents: number;
};

export type EstimateV3VersionTotals = {
  total_ht_cents: number;
  total_tax_cents: number;
  total_ttc_cents: number;
  gross_ht_cents: number;
  discount_applied_cents: number;
  commercial_rounding_cents: number;
};

/** Colonnes de ligne propres à la v3 (saisie). `h_mo*` reste un total dérivé. */
export const V3_ITEM_INPUT_KEYS = [
  "unit_code",
  "pricing_status",
  "h_mo_per_unit",
  "h_mo_atelier_per_unit",
  "h_mo_chantier_per_unit",
] as const;

/** Totaux d'heures de ligne : dérivés en v3, jamais écrits par un client (D4). */
const DERIVED_HOURS_KEYS = ["h_mo", "h_mo_atelier", "h_mo_chantier"] as const;

const PRICING_STATUSES: ReadonlySet<string> = new Set(ESTIMATE_LINE_PRICING_STATUSES);

function toNumeric(value: Numeric): number | string | null {
  if (value === null || value === undefined) return null;
  return value;
}

function nullableRate(ratesById: ReadonlyMap<string, number>, roleId: string | null | undefined) {
  if (!roleId) return null;
  return ratesById.get(roleId) ?? null;
}

/** Statut de ligne stocké (`priced` par défaut de colonne). */
export function resolveV3PricingStatus(value: string | null | undefined): EstimateV3PricingStatus {
  const status = value ?? "priced";
  if (!PRICING_STATUSES.has(status)) {
    throw badRequest("Statut de chiffrage de ligne inconnu.", { pricing_status: status }, "ESTIMATE_V3_PRICING_STATUS_INVALID");
  }
  return status as EstimateV3PricingStatus;
}

/**
 * Unité saisie → code du référentiel (normaliseur partagé avec `private.normalize_unit`). Une
 * unité vide reste nulle (brouillon incomplet admis, D9) ; une saisie inconnue ou qui désigne un
 * statut (« PM », « HL ») est refusée : le statut a sa propre colonne.
 */
export function normalizeV3UnitCode(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw.trim().length === 0) return null;
  const resolution = normalizeMeasurementUnit(raw);
  if (!resolution.unitCode) {
    throw badRequest(`Unité inconnue du référentiel : « ${raw} ».`, { unit_code: raw }, "ESTIMATE_V3_UNIT_UNKNOWN");
  }
  return resolution.unitCode;
}

/** Erreur nommée du moteur pur → 400 (entrée invalide ou montant hors limite), jamais 500. */
export function toEstimateV3ApiError(error: unknown): unknown {
  if (error instanceof EstimateV3Error) {
    return badRequest(error.message, error.field ? { field: error.field } : undefined, error.code);
  }
  return error;
}

/** Forme imposée par le CHECK de version v3 (§6.2), vérifiée avant tout envoi. */
export function assertEstimateV3VersionShape(version: {
  margin_mode?: string | null;
  margin_multiplier?: number | null;
  global_coefficient?: number | null;
  discount_mode?: string | null;
  discount_steps?: readonly unknown[] | null;
  discount_bp?: number | null;
  discount_amount_cents?: number | null;
  rounding_mode?: string | null;
}) {
  const violations: string[] = [];
  if (version.margin_mode !== "fixed") violations.push("margin_mode");
  if (Number(version.margin_multiplier) !== 1) violations.push("margin_multiplier");
  if (Number(version.global_coefficient) !== 1) violations.push("global_coefficient");
  if (version.discount_mode !== "simple") violations.push("discount_mode");
  if ((version.discount_steps?.length ?? 0) > 0) violations.push("discount_steps");
  const discountBp = Number(version.discount_bp ?? 0);
  if (!Number.isInteger(discountBp) || discountBp < 0 || discountBp > 10000) violations.push("discount_bp");
  if (version.discount_amount_cents != null && discountBp !== 0) violations.push("discount_amount_cents");
  if (version.rounding_mode !== "none" && version.rounding_mode !== "down") violations.push("rounding_mode");
  if (violations.length > 0) {
    throw badRequest(
      "Réglage incompatible avec le moteur de calcul 3 : marge fixe à 1, coefficient global 1, remise simple d'une seule intention (montant ou pourcentage), arrondi « aucun » ou « inférieur ».",
      { fields: violations },
      "ESTIMATE_V3_VERSION_SETTINGS_INVALID"
    );
  }
}

/** Colonnes v3 sur une ligne v1/v2 : refus nommé (même code que le déclencheur M4). */
export function assertHistoricalItemHasNoV3Columns(data: Record<string, unknown>) {
  const offending = V3_ITEM_INPUT_KEYS.filter((key) => {
    const value = data[key];
    if (value === undefined || value === null) return false;
    return key !== "pricing_status" || value !== "priced";
  });
  if (offending.length > 0) {
    throw badRequest(
      "Ces colonnes sont réservées au moteur de calcul 3.",
      { fields: offending },
      "ESTIMATE_ENGINE_COLUMN_NOT_SUPPORTED"
    );
  }
}

/** Colonnes de saisie v3 effectivement fournies (pour les écrivains qui reconstruisent la ligne). */
type V3ItemInputKey = (typeof V3_ITEM_INPUT_KEYS)[number];

export function pickV3ItemInputFields<T extends Partial<Record<V3ItemInputKey, unknown>>>(
  data: T
): Partial<Pick<T, V3ItemInputKey>> {
  const picked: Partial<Pick<T, V3ItemInputKey>> = {};
  for (const key of V3_ITEM_INPUT_KEYS) {
    if (data[key] !== undefined) picked[key] = data[key];
  }
  return picked;
}

/**
 * Écriture v3 d'une ligne : heures par unité seulement (D4), unité normalisée. Une section ne
 * porte aucune colonne v3 (CHECK de M4). Rend la charge prête pour l'écrivain SQL.
 */
export function normalizeV3ItemWrite<T extends Record<string, unknown>>(
  data: T,
  itemType: "section" | "line"
): T {
  const derived = DERIVED_HOURS_KEYS.filter((key) => {
    const value = data[key];
    return value !== undefined && value !== null && Number(value) !== 0;
  });
  if (derived.length > 0) {
    throw badRequest(
      "En moteur de calcul 3, les heures se saisissent par unité (h_mo_per_unit) ; le total d'heures de la ligne est dérivé.",
      { fields: derived },
      "ESTIMATE_V3_LABOR_HOURS_PER_UNIT_REQUIRED"
    );
  }
  if (itemType === "section") {
    assertHistoricalItemHasNoV3Columns(data);
    const section: Record<string, unknown> = { ...data };
    for (const key of DERIVED_HOURS_KEYS) delete section[key];
    return section as T;
  }
  const next: Record<string, unknown> = { ...data };
  // Un total nul (défaut des écrivains historiques) n'est pas une saisie : le déclencheur dérive.
  for (const key of DERIVED_HOURS_KEYS) delete next[key];
  if ("unit_code" in data) next.unit_code = normalizeV3UnitCode(data.unit_code as string | null | undefined);
  if ("pricing_status" in data && data.pricing_status !== undefined) {
    next.pricing_status = resolveV3PricingStatus(data.pricing_status as string | null);
  }
  return next as T;
}

/** Entrée canonique du moteur v3 depuis des lignes stockées ou prospectives. */
export function buildEstimateV3Input(input: {
  version: EstimateV3VersionConfig;
  lines: readonly EstimateV3LineRecord[];
  laborRatesById: ReadonlyMap<string, number>;
  laborSplitEnabled: boolean;
}): EstimateV3Input {
  const { version } = input;
  const roundingMode = version.rounding_mode === "down" ? "down" : version.rounding_mode === "none" ? "none" : null;
  if (roundingMode === null) {
    throw badRequest("Mode d'arrondi incompatible avec le moteur de calcul 3.", undefined, "ESTIMATE_V3_VERSION_SETTINGS_INVALID");
  }
  const items: EstimateV3ItemInput[] = input.lines
    .filter((line) => line.item_type === "line")
    .map((line) => ({
      id: line.id,
      item_type: "line",
      parent_id: line.parent_id ?? null,
      quantity: toNumeric(line.quantity),
      unit_price_ht_cents: toNumeric(line.unit_price_ht_cents),
      k_fo: toNumeric(line.k_fo),
      fo_provision: toNumeric(line.fo_provision),
      h_mo_per_unit: toNumeric(line.h_mo_per_unit),
      h_mo_atelier_per_unit: toNumeric(line.h_mo_atelier_per_unit),
      h_mo_chantier_per_unit: toNumeric(line.h_mo_chantier_per_unit),
      h_mo_majoration: toNumeric(line.h_mo_majoration),
      k_mo: toNumeric(line.k_mo),
      k_mo_atelier: toNumeric(line.k_mo_atelier),
      k_mo_chantier: toNumeric(line.k_mo_chantier),
      labor_rate_cents: nullableRate(input.laborRatesById, line.labor_role_id),
      labor_rate_atelier_cents: nullableRate(input.laborRatesById, line.labor_role_atelier_id),
      labor_rate_chantier_cents: nullableRate(input.laborRatesById, line.labor_role_chantier_id),
      pricing_status: resolveV3PricingStatus(line.pricing_status),
      // Taux omis : celui de la version, comme le déclencheur M4 (D8).
      tax_rate_bp: line.tax_rate_bp ?? version.tax_rate_bp,
      unit_code: line.unit_code ?? null,
    }));
  return {
    params: {
      sale_coefficient_fo: toNumeric(version.sale_coefficient_fo) ?? Number.NaN,
      sale_coefficient_mo: toNumeric(version.sale_coefficient_mo) ?? Number.NaN,
      discount_amount_cents: version.discount_amount_cents ?? null,
      discount_bp: version.discount_bp ?? 0,
      rounding_mode: roundingMode,
      rounding_step_cents: version.rounding_step_cents ?? 1,
      // Autoliquidation = rôle sous-traitant, comme en v2 (décision 2 du sous-lot).
      reverse_charge: version.contractor_role === "subcontractor",
      labor_split_enabled: input.laborSplitEnabled,
    },
    items,
  };
}

/** Projections nettes de ligne (colonnes historiques, D7) pour les écrivains de brouillon. */
export function toEstimateV3LineProjections(breakdown: EstimateV3Breakdown): EstimateV3LineProjection[] {
  return breakdown.lines.map((line) => ({
    id: line.id,
    pu_ht_cents: line.pu_ht_cents,
    line_total_ht_cents: line.line_total_ht_cents,
    line_tax_cents: line.line_tax_cents,
    line_total_ttc_cents: line.line_total_ttc_cents,
  }));
}

/** Totaux de version v3 : les trois historiques et les trois montants v3 (§6.2). */
export function toEstimateV3VersionTotals(breakdown: EstimateV3Breakdown): EstimateV3VersionTotals {
  const { totals } = breakdown;
  return {
    total_ht_cents: totals.total_ht_cents,
    total_tax_cents: totals.total_tax_cents,
    total_ttc_cents: totals.total_ttc_cents,
    gross_ht_cents: totals.gross_ht_cents,
    discount_applied_cents: totals.discount_applied_cents,
    commercial_rounding_cents: totals.commercial_rounding_cents,
  };
}

/** Lignes figées du gel v3 : les onze clés du contrat `freeze_estimate_v3_snapshot`. */
export function toEstimateV3ItemSnapshots(projection: EstimateV3SnapshotProjection) {
  return projection.items.map((item) => ({
    id: item.id,
    snapshot_pu_ht_cents: item.snapshot_pu_ht_cents,
    snapshot_gross_ht_cents: item.snapshot_gross_ht_cents,
    snapshot_gross_fo_ht_cents: item.snapshot_gross_fo_ht_cents,
    snapshot_fo_ht_cents: item.snapshot_fo_ht_cents,
    snapshot_mo_ht_cents: item.snapshot_mo_ht_cents,
    snapshot_mo_atelier_ht_cents: item.snapshot_mo_atelier_ht_cents,
    snapshot_mo_chantier_ht_cents: item.snapshot_mo_chantier_ht_cents,
    line_total_ht_cents: item.line_total_ht_cents,
    line_tax_cents: item.line_tax_cents,
    line_total_ttc_cents: item.line_total_ttc_cents,
  }));
}

/** Totaux figés du gel v3 (ajustement d'arrondi nul, D7). */
export function toEstimateV3FrozenTotals(projection: EstimateV3SnapshotProjection) {
  const { version } = projection;
  return {
    total_ht_cents: version.total_ht_cents,
    total_tax_cents: version.total_tax_cents,
    total_ttc_cents: version.total_ttc_cents,
    rounding_adjustment_cents: 0,
    gross_ht_cents: version.gross_ht_cents,
    discount_applied_cents: version.discount_applied_cents,
    commercial_rounding_cents: version.commercial_rounding_cents,
  };
}
