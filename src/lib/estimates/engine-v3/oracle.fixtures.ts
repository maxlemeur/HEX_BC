/**
 * Lot 2, sous-lot 2.4 - fixtures d'acceptation du moteur v3 pur.
 *
 * Source des attendus : conception du lot 2, §5.1 (lignes-oracle), §5.2 (scénarios S1 à S5) et
 * §5.3 (cas d'exigence). Les sept lignes-oracle ne gardent que des nombres de
 * `docs/audit-independant-2026-10-14/reproductions/d4/D4-extraits.json` (quantité, PR FO au
 * centime, heures par unité) : aucune désignation, aucune unité, aucune donnée client (§5.6).
 * Les attendus sont recopiés de la conception, jamais recalculés par le moteur testé.
 */
import type {
  EstimateV3Input,
  EstimateV3ItemInput,
  EstimateV3Params,
} from "@/lib/estimates/engine-v3";

/** Identifiant de ligne déterministe : l'ordre lexical suit `n` (départage des ex aequo). */
export function fixtureLineId(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

export const ORACLE_LABOR_RATE_CENTS = 4000;

export function v3Params(overrides: Partial<EstimateV3Params> = {}): EstimateV3Params {
  return {
    sale_coefficient_fo: 1,
    sale_coefficient_mo: 1,
    discount_amount_cents: null,
    discount_bp: 0,
    rounding_mode: "none",
    rounding_step_cents: 1,
    reverse_charge: false,
    labor_split_enabled: false,
    ...overrides,
  };
}

export function v3Line(
  n: number,
  overrides: Partial<EstimateV3ItemInput> = {}
): EstimateV3ItemInput {
  return {
    id: fixtureLineId(n),
    item_type: "line",
    parent_id: null,
    quantity: 1,
    unit_price_ht_cents: 0,
    k_fo: 1,
    h_mo_per_unit: null,
    h_mo_atelier_per_unit: null,
    h_mo_chantier_per_unit: null,
    h_mo_majoration: 1,
    k_mo: 1,
    k_mo_atelier: null,
    k_mo_chantier: null,
    labor_rate_cents: null,
    labor_rate_atelier_cents: null,
    labor_rate_chantier_cents: null,
    pricing_status: "priced",
    tax_rate_bp: 2000,
    unit_code: null,
    ...overrides,
  };
}

export function v3Input(
  items: EstimateV3ItemInput[],
  params: Partial<EstimateV3Params> = {}
): EstimateV3Input {
  return { params: v3Params(params), items };
}

/* ---------- §5.1 lignes-oracle (D4 §2.4) ---------- */

export type OracleLine = {
  ref: "O1" | "O2" | "O3" | "O4" | "O5" | "O6" | "O7";
  quantity: string;
  unitPriceCents: number;
  hoursPerUnit: string;
  /** PU v3 à c_FO 1,30 / c_MO 1,20 (§5.1, colonne « PU v3 »). */
  pu130120: number;
  /** Total v3 à 1,30 / 1,20 (§5.1, colonne « Total v3 »). */
  gross130120: number;
  /** Déboursé (§5.1, colonne « Déboursé »). */
  cost: number;
  /** PU à 1,3 / 1,3 (§5.1, PU affichés par le classeur). */
  pu130130: number;
};

export const ORACLE_LINES: readonly OracleLine[] = [
  { ref: "O1", quantity: "20", unitPriceCents: 5466, hoursPerUnit: "1.991", pu130120: 16663, gross130120: 333260, cost: 268600, pu130130: 17459 },
  { ref: "O2", quantity: "3", unitPriceCents: 9563, hoursPerUnit: "1.75", pu130120: 20832, gross130120: 62496, cost: 49689, pu130130: 21532 },
  { ref: "O3", quantity: "21", unitPriceCents: 5850, hoursPerUnit: "0", pu130120: 7605, gross130120: 159705, cost: 122850, pu130130: 7605 },
  { ref: "O4", quantity: "1139", unitPriceCents: 302, hoursPerUnit: "0.2", pu130120: 1353, gross130120: 1541067, cost: 1255178, pu130130: 1433 },
  { ref: "O5", quantity: "1", unitPriceCents: 2000, hoursPerUnit: "6", pu130120: 31400, gross130120: 31400, cost: 26000, pu130130: 33800 },
  { ref: "O6", quantity: "282", unitPriceCents: 9186, hoursPerUnit: "0.998", pu130120: 16732, gross130120: 4718424, cost: 3716196, pu130130: 17131 },
  { ref: "O7", quantity: "8", unitPriceCents: 883, hoursPerUnit: "1.30", pu130120: 7388, gross130120: 59104, cost: 48664, pu130130: 7908 },
];

export function oracleItems(taxRateBpByRef: Partial<Record<OracleLine["ref"], number>> = {}) {
  return ORACLE_LINES.map((line, index) =>
    v3Line(index + 1, {
      quantity: line.quantity,
      unit_price_ht_cents: line.unitPriceCents,
      h_mo_per_unit: line.hoursPerUnit,
      labor_rate_cents: ORACLE_LABOR_RATE_CENTS,
      tax_rate_bp: taxRateBpByRef[line.ref] ?? 2000,
    })
  );
}

export function oracleInput(params: Partial<EstimateV3Params> = {}, taxRateBpByRef = {}) {
  return v3Input(oracleItems(taxRateBpByRef), {
    sale_coefficient_fo: "1.30",
    sale_coefficient_mo: "1.20",
    ...params,
  });
}

/* ---------- §5.3 cas d'exigence (entrées ; attendus dans requirements.test.ts) ---------- */

/** T-HMO : Q 10, PR 1 000 c, 0,5 h/u, 4 500 c/h, coefficients 1. */
export function tHmoInput(quantity: number | string = 10) {
  return v3Input([
    v3Line(1, {
      quantity,
      unit_price_ht_cents: 1000,
      h_mo_per_unit: "0.5",
      labor_rate_cents: 4500,
    }),
  ]);
}

/** Une ligne de fourniture seule : Q × PR, coefficient de vente FO donné. */
export function supplyLineInput(
  quantity: number | string,
  unitPriceCents: number,
  saleCoefficientFo: number | string = 1,
  params: Partial<EstimateV3Params> = {}
) {
  return v3Input([v3Line(1, { quantity, unit_price_ht_cents: unitPriceCents })], {
    sale_coefficient_fo: saleCoefficientFo,
    ...params,
  });
}
