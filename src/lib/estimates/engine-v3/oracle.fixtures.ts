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

export const ORACLE_GROSS_SUM_CENTS = 6905456;
export const ORACLE_COST_SUM_CENTS = 5487177;

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

/* ---------- §5.2 scénarios chiffrés ---------- */

export type ScenarioExpectation = {
  id: "S1" | "S2" | "S3" | "S4" | "S5";
  params: Partial<EstimateV3Params>;
  taxRateBpByRef?: Partial<Record<OracleLine["ref"], number>>;
  gross: number;
  discount: number;
  rounding: number;
  net: number;
  tax: number;
  ttc: number;
};

const S5_RATES: Partial<Record<OracleLine["ref"], number>> = {
  O1: 1000,
  O2: 1000,
  O3: 1000,
  O4: 2000,
  O5: 2000,
  O6: 2000,
  O7: 2000,
};

export const SCENARIOS: readonly ScenarioExpectation[] = [
  { id: "S1", params: {}, gross: 6905456, discount: 0, rounding: 0, net: 6905456, tax: 1381091, ttc: 8286547 },
  { id: "S2", params: { discount_amount_cents: 101 }, gross: 6905456, discount: 101, rounding: 0, net: 6905355, tax: 1381071, ttc: 8286426 },
  { id: "S3", params: { discount_bp: 1000 }, gross: 6905456, discount: 690546, rounding: 0, net: 6214910, tax: 1242982, ttc: 7457892 },
  {
    id: "S4",
    params: { discount_amount_cents: 101, rounding_mode: "down", rounding_step_cents: 10000 },
    gross: 6905456,
    discount: 101,
    rounding: 5355,
    net: 6900000,
    tax: 1380000,
    ttc: 8280000,
  },
  {
    id: "S5",
    params: { discount_amount_cents: 101 },
    taxRateBpByRef: S5_RATES,
    gross: 6905456,
    discount: 101,
    rounding: 0,
    net: 6905355,
    tax: 1325525,
    ttc: 8230880,
  },
];

/** S5 : répartition des 101 c sur O1..O7 et récapitulatif par taux (§5.2). */
export const S5_REDUCTIONS = [5, 1, 2, 23, 0, 69, 1];
export const S5_TAX_BREAKDOWN = [
  { rate_bp: 1000, base_cents: 555453, tax_cents: 55545 },
  { rate_bp: 2000, base_cents: 6349902, tax_cents: 1269980 },
];
/** TVA ligne à ligne de S5 : l'écart que supprime A5 (§5.2). */
export const S5_LINE_BY_LINE_TAX = 1325527;

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

/** A-06 : 1 004 lignes de 99 c à 20 %. */
export function a06Input(discountAmountCents: number | null) {
  return v3Input(
    Array.from({ length: 1004 }, (_, index) => v3Line(index + 1, { unit_price_ht_cents: 99 })),
    { discount_amount_cents: discountAmountCents }
  );
}

/** T-TVA1 : 10 000 c à 20 % et 10 000 c à 5,5 %. */
export function tTva1Input() {
  return v3Input([
    v3Line(1, { unit_price_ht_cents: 10000, tax_rate_bp: 2000 }),
    v3Line(2, { unit_price_ht_cents: 10000, tax_rate_bp: 550 }),
  ]);
}

/** T-TVA-ARR : 3 lignes de 33 c à 20 %. */
export function tTvaArrInput() {
  return v3Input([1, 2, 3].map((n) => v3Line(n, { unit_price_ht_cents: 33 })));
}

/**
 * T-MARG : c 1,25 / 1,25, remise de 20 %. Ligne choisie (interprétation, la conception ne fixe
 * pas les entrées) : Q 4, PR 10 000 c, 0,5 h/u à 4 000 c/h.
 */
export function tMargInput() {
  return v3Input(
    [
      v3Line(1, {
        quantity: 4,
        unit_price_ht_cents: 10000,
        h_mo_per_unit: "0.5",
        labor_rate_cents: 4000,
      }),
    ],
    { sale_coefficient_fo: "1.25", sale_coefficient_mo: "1.25", discount_bp: 2000 }
  );
}

/** T-STAT : ligne « hors lot » chiffrable à 500 €, à côté d'une ligne chiffrée de 100 €. */
export function tStatInput() {
  return v3Input([
    v3Line(1, { unit_price_ht_cents: 10000 }),
    v3Line(2, { unit_price_ht_cents: 50000, pricing_status: "out_of_scope" }),
  ]);
}
