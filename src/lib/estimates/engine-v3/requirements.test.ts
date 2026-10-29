import { describe, expect, it } from "vitest";

import {
  computeEstimateV3Breakdown,
  computeEstimateV3Canonical,
  computeEstimateV3NetMarginBp,
  EstimateV3Error,
  projectEstimateV3Snapshot,
  readStoredEstimateV3,
  type EstimateV3Input,
} from "@/lib/estimates/engine-v3";
import {
  fixtureLineId,
  oracleInput,
  supplyLineInput,
  tHmoInput,
  v3Input,
  v3Line,
} from "@/lib/estimates/engine-v3/oracle.fixtures";

// Lot 2, sous-lot 2.4 (docs/testing/estimate-engine-v3-2.4.md). Isolation justifiée : moteur
// inerte (aucune v3 ne peut être créée, aucun écran), attendus au centime (§5.3, tolérance 0 c),
// cas limites d'analyse des entrées (décimales en trop, valeurs non finies, négatifs) qu'aucun
// parcours E2E ne peut produire tant qu'aucun écrivain v3 n'existe.

function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

// Colonnes numériques du contrat canonique : le jumeau SQL n'y admet que des nombres JSON.
const CANONICAL_NUMERIC_KEYS = new Set([
  "sale_coefficient_fo",
  "sale_coefficient_mo",
  "discount_amount_cents",
  "discount_bp",
  "rounding_step_cents",
  "quantity",
  "unit_price_ht_cents",
  "fo_provision",
  "k_fo",
  "h_mo_per_unit",
  "h_mo_atelier_per_unit",
  "h_mo_chantier_per_unit",
  "h_mo_majoration",
  "k_mo",
  "k_mo_atelier",
  "k_mo_chantier",
  "labor_rate_cents",
  "labor_rate_atelier_cents",
  "labor_rate_chantier_cents",
  "tax_rate_bp",
]);

/** Texte JSON canonique : un décimal que la fixture écrit en chaîne devient le littéral numérique exact. */
function canonicalJson(input: unknown): string {
  return JSON.stringify(input).replace(/"([a-z_]+)":"(\d+(?:\.\d+)?)"/g, (match, key: string, digits: string) =>
    CANONICAL_NUMERIC_KEYS.has(key) ? `"${key}":${digits}` : match
  );
}

/** Texte canonique dont un champ (paramètre ou première ligne) porte le littéral JSON brut donné. */
function canonicalJsonWith(input: EstimateV3Input, target: "params" | "line", key: string, literal: string) {
  const marker = "__LITERAL__";
  const copy = structuredClone(input) as unknown as {
    params: Record<string, unknown>;
    items: Array<Record<string, unknown>>;
  };
  (target === "params" ? copy.params : copy.items[0])[key] = marker;
  return canonicalJson(copy).replace(`"${marker}"`, literal);
}

describe("§5.3 unit price at the cent (A4)", () => {
  it("T-PU: Q 3, PR 1 001 c, c_FO 1.6 -> PU 1 602, total 4 806", () => {
    const [line] = computeEstimateV3Breakdown(supplyLineInput(3, 1001, "1.6")).lines;
    expect(line.pu_ht_cents).toBe(1602);
    expect(line.gross_ht_cents).toBe(4806);
  });

  it("A-05: PR 999 c x 7, c_FO 1.6 -> PU 1 598, total 11 186", () => {
    const [line] = computeEstimateV3Breakdown(supplyLineInput(7, 999, "1.6")).lines;
    expect(line.pu_ht_cents).toBe(1598);
    expect(line.gross_ht_cents).toBe(11186);
  });

  it("T-CAP: an amount above 2 147 483 647 c raises ESTIMATE_AMOUNT_OVERFLOW, never clamps", () => {
    const error = thrown(() =>
      computeEstimateV3Breakdown(supplyLineInput(1, 2_000_000_000, "1.6"))
    );
    expect(error).toBeInstanceOf(EstimateV3Error);
    expect(error).toMatchObject({ code: "ESTIMATE_AMOUNT_OVERFLOW", sqlstate: "22003" });
  });
});

describe("§5.3 discount intent (A3)", () => {
  it("EU01: amount 101 on 1 995 450 c -> HT 1 995 349, VAT 399 070, TTC 2 394 419; discount_bp stays 0", () => {
    const input = supplyLineInput(1, 1_995_450, 1, { discount_amount_cents: 101 });
    const breakdown = computeEstimateV3Breakdown(input);
    expect(breakdown.totals).toMatchObject({
      discount_applied_cents: 101,
      total_ht_cents: 1_995_349,
      total_tax_cents: 399_070,
      total_ttc_cents: 2_394_419,
    });
    const projection = projectEstimateV3Snapshot(breakdown);
    expect(projection.version).toMatchObject({ discount_bp: 0, discount_amount_cents: 101 });
  });

  it("EU01: the frozen context is exactly the §6.5 example", () => {
    const input = supplyLineInput(1, 1_995_450, 1, { discount_amount_cents: 101 });
    const projection = projectEstimateV3Snapshot(computeEstimateV3Breakdown(input));
    expect(projection.context).toEqual({
      engine: 3,
      labor_split_enabled: false,
      labor_roles: [],
      sale_coefficients: { fo: 1, mo: 1 },
      discount: {
        kind: "amount",
        requested_cents: 101,
        rate_bp: null,
        base_cents: 1_995_450,
        applied_cents: 101,
      },
      commercial_rounding: { mode: "none", step_cents: 1, applied_cents: 0 },
      cost_subtotal_cents: 1_995_450,
      realized_sale_coefficient: 0.999949,
      tax_breakdown: [{ rate_bp: 2000, base_cents: 1_995_349, tax_cents: 399_070 }],
    });
  });

  it("refuses an amount intent and a rate intent together (exclusive intent)", () => {
    const error = thrown(() =>
      computeEstimateV3Breakdown(
        supplyLineInput(1, 1000, 1, { discount_amount_cents: 10, discount_bp: 500 })
      )
    );
    expect(error).toMatchObject({ code: "ESTIMATE_V3_INPUT_INVALID", sqlstate: "22023" });
  });
});

describe("§5.3 margin and statuses", () => {
  it("net mark is indeterminate (null), never 0, when the net HT is 0", () => {
    expect(computeEstimateV3NetMarginBp({ total_ht_cents: 0, cost_subtotal_cents: 0 })).toBeNull();
  });
});

describe("labour split atelier / chantier (same trigger as v2)", () => {
  it("prices MO_u = maj x (h_at x t_at x k_at + h_ch x t_ch x k_ch) and splits gross and net MO", () => {
    const input = v3Input(
      [
        v3Line(1, {
          quantity: 2,
          unit_price_ht_cents: 1000,
          h_mo_per_unit: "1.5",
          h_mo_atelier_per_unit: "1",
          h_mo_chantier_per_unit: "0.5",
          h_mo_majoration: "1.1",
          labor_rate_cents: 9999,
          labor_rate_atelier_cents: 4000,
          labor_rate_chantier_cents: 5000,
          k_mo_chantier: "1.2",
        }),
      ],
      { labor_split_enabled: true, discount_amount_cents: 7 }
    );
    const [line] = computeEstimateV3Breakdown(input).lines;
    // MO_u = 1,1 × (1 × 4 000 × 1 + 0,5 × 5 000 × 1,2) = 1,1 × 7 000 = 7 700 ; PU = 8 700.
    expect(line.pu_ht_cents).toBe(8700);
    expect(line.gross_ht_cents).toBe(17400);
    expect(line.gross_mo_ht_cents).toBe(15400);
    expect(line.gross_mo_atelier_ht_cents + line.gross_mo_chantier_ht_cents).toBe(15400);
    expect(line.gross_mo_atelier_ht_cents).toBe(8800);
    expect(line.snapshot_fo_ht_cents + line.snapshot_mo_ht_cents).toBe(line.line_total_ht_cents);
    expect(line.snapshot_mo_atelier_ht_cents + line.snapshot_mo_chantier_ht_cents).toBe(
      line.snapshot_mo_ht_cents
    );
    expect(line).toMatchObject({ h_mo: "3.000", h_mo_atelier: "2.000", h_mo_chantier: "1.000" });
  });

  it("ignores the split payload when the version flag is off", () => {
    const input = v3Input(
      [
        v3Line(1, {
          unit_price_ht_cents: 0,
          h_mo_per_unit: "1",
          h_mo_atelier_per_unit: "1",
          labor_rate_cents: 3000,
          labor_rate_atelier_cents: 4000,
        }),
      ],
      { labor_split_enabled: false }
    );
    const [line] = computeEstimateV3Breakdown(input).lines;
    expect(line.pu_ht_cents).toBe(3000);
    expect(line.gross_mo_atelier_ht_cents).toBe(0);
    // Intégration 2.4 (I-01) : sans ventilation, toute la MO est « chantier » (convention v2).
    expect(line.gross_mo_chantier_ht_cents).toBe(3000);
  });
});

// TI-534 : provision FO de ligne (pertes, chutes, petites fournitures), distincte de K FO. Attendus calculés à la main.
describe("TI-534 FO provision (FO_u = P x provision FO x k_fo)", () => {
  it("multiplies with k_fo: P 1 000 x 1.010 x 1.5 = 1 515", () => {
    const [line] = computeEstimateV3Breakdown(
      v3Input([v3Line(1, { unit_price_ht_cents: 1000, fo_provision: "1.01", k_fo: "1.5" })])
    ).lines;
    expect(line.pu_ht_cents).toBe(1515);
  });

  it("rounds once, on the unit sale price: P 100 x 1.005 x c_FO 1.3 = 130.65 -> PU 131", () => {
    const [line] = computeEstimateV3Breakdown(
      v3Input([v3Line(1, { unit_price_ht_cents: 100, fo_provision: "1.005" })], { sale_coefficient_fo: "1.3" })
    ).lines;
    expect(line.pu_ht_cents).toBe(131);
  });

  it("reads an absent or null provision as 1, the provision of every line that predates it", () => {
    const pu = (fo_provision?: EstimateV3Input["items"][number]["fo_provision"]) =>
      computeEstimateV3Breakdown(
        v3Input([v3Line(1, { unit_price_ht_cents: 1000, ...(fo_provision === undefined ? {} : { fo_provision }) })])
      ).lines[0].pu_ht_cents;
    expect([pu(), pu(null), pu(1)]).toEqual([1000, 1000, 1000]);
  });

  it("goes through the canonical adapter like the SQL twin (a JSON number, never a string)", () => {
    const input = v3Input([v3Line(1, { unit_price_ht_cents: 1000, fo_provision: 1.03 })]);
    expect(computeEstimateV3Canonical(JSON.stringify(input)).lines[0].pu_ht_cents).toBe(1030);
    expect(thrown(() => computeEstimateV3Canonical(canonicalJsonWith(input, "line", "fo_provision", '"1.03"')))).toMatchObject({
      code: "ESTIMATE_V3_INPUT_INVALID",
    });
  });
});

describe("input parsing edge cases (named refusal, never 0, never float drift)", () => {
  const invalid: Array<[string, EstimateV3Input]> = [
    ["a quantity with 4 decimals", supplyLineInput("1.0005", 100)],
    ["a non-finite quantity", supplyLineInput(Number.POSITIVE_INFINITY, 100)],
    ["a NaN unit price", supplyLineInput(1, Number.NaN)],
    ["a negative quantity", supplyLineInput(-1, 100)],
    ["a negative unit price", supplyLineInput(1, -100)],
    ["a fractional unit price", supplyLineInput(1, 100.5)],
    ["an exponent string", supplyLineInput("1e3", 100)],
    ["a sale coefficient of 0", supplyLineInput(1, 100, 0)],
    ["a sale coefficient above 10", supplyLineInput(1, 100, "10.0001")],
    ["a sale coefficient with 5 decimals", supplyLineInput(1, 100, "1.00001")],
    ["a discount rate above 10 000 bp", supplyLineInput(1, 100, 1, { discount_bp: 10001 })],
    ["an unknown rounding mode", supplyLineInput(1, 100, 1, { rounding_mode: "up" as never })],
    ["a rounding step of 0", supplyLineInput(1, 100, 1, { rounding_mode: "down", rounding_step_cents: 0 })],
    ["a line without tax rate", v3Input([v3Line(1, { tax_rate_bp: null })])],
    ["an unknown pricing status", v3Input([v3Line(1, { pricing_status: "free" as never })])],
    ["hours per unit with 5 decimals", v3Input([v3Line(1, { h_mo_per_unit: "0.00001" })])],
    ["an FO provision with 4 decimals", v3Input([v3Line(1, { fo_provision: "1.0001" })])],
    ["a negative FO provision", v3Input([v3Line(1, { fo_provision: -1 })])],
    ["an FO provision beyond numeric(4,3)", v3Input([v3Line(1, { fo_provision: 10 })])],
    ["a line id that is not a uuid", v3Input([v3Line(1, { id: "line-1" })])],
    ["a duplicated line id", v3Input([v3Line(1), v3Line(1)])],
  ];

  it.each(invalid)("refuses %s with ESTIMATE_V3_INPUT_INVALID", (_label, input) => {
    const error = thrown(() => computeEstimateV3Breakdown(input));
    expect(error).toBeInstanceOf(EstimateV3Error);
    expect(error).toMatchObject({ code: "ESTIMATE_V3_INPUT_INVALID", sqlstate: "22023" });
  });

  it("reads JS numbers through their shortest round-trip string (0.1 + 0.2 is refused, 1.3 is exact)", () => {
    expect(thrown(() => computeEstimateV3Breakdown(supplyLineInput(0.1 + 0.2, 100)))).toMatchObject({
      code: "ESTIMATE_V3_INPUT_INVALID",
    });
    const [line] = computeEstimateV3Breakdown(supplyLineInput(3, 1001, 1.3)).lines;
    expect(line.pu_ht_cents).toBe(1301);
  });

  it("treats upper-case uuids as their lower-case key", () => {
    const upper = fixtureLineId(10).toUpperCase();
    const breakdown = computeEstimateV3Breakdown(v3Input([v3Line(1, { id: upper })]));
    expect(breakdown.lines[0].id).toBe(fixtureLineId(10));
  });
});

describe("canonical JSON adapter (TS/SQL parity contract)", () => {
  it("returns exactly the contract keys, in order, with fixed-scale decimal strings", () => {
    const output = computeEstimateV3Canonical(canonicalJson(oracleInput()));
    expect(Object.keys(output)).toEqual(["lines", "totals"]);
    expect(Object.keys(output.lines[0])).toEqual([
      "id",
      "pu_ht_cents",
      "gross_ht_cents",
      "gross_fo_ht_cents",
      "gross_mo_ht_cents",
      "gross_mo_atelier_ht_cents",
      "gross_mo_chantier_ht_cents",
      "cost_ht_cents",
      "reduction_cents",
      "line_total_ht_cents",
      "snapshot_fo_ht_cents",
      "snapshot_mo_ht_cents",
      "snapshot_mo_atelier_ht_cents",
      "snapshot_mo_chantier_ht_cents",
      "line_tax_cents",
      "line_total_ttc_cents",
      "h_mo",
      "h_mo_atelier",
      "h_mo_chantier",
    ]);
    expect(Object.keys(output.totals)).toEqual([
      "gross_ht_cents",
      "discount_applied_cents",
      "commercial_rounding_cents",
      "total_ht_cents",
      "total_tax_cents",
      "total_ttc_cents",
      "rounding_adjustment_cents",
      "cost_subtotal_cents",
      "realized_sale_coefficient",
      "tax_breakdown",
    ]);
    expect(output.lines[0]).toMatchObject({ pu_ht_cents: 16663, h_mo: "39.820", h_mo_atelier: null });
    expect(output.totals.realized_sale_coefficient).toBe("1.258472");
    expect(computeEstimateV3Canonical(JSON.parse(canonicalJson(oracleInput())))).toEqual(output);
  });

  it("refuses decimal strings on the canonical path, text or object, like the SQL twin (JSON numbers only)", () => {
    for (const input of [JSON.stringify(oracleInput()), oracleInput()]) {
      expect(thrown(() => computeEstimateV3Canonical(input))).toMatchObject({
        code: "ESTIMATE_V3_INPUT_INVALID",
        sqlstate: "22023",
      });
    }
    expect(
      thrown(() => computeEstimateV3Canonical(canonicalJsonWith(supplyLineInput(1, 100), "params", "sale_coefficient_fo", '"1.30"')))
    ).toMatchObject({ code: "ESTIMATE_V3_INPUT_INVALID" });
    // L'éditeur (entrée typée) garde les chaînes décimales exactes.
    expect(computeEstimateV3Breakdown(oracleInput()).lines[0].pu_ht_cents).toBe(16663);
  });

  it("reads JSON number literals at their source, never through a double", () => {
    const base = supplyLineInput(1, 100);
    for (const [key, literal] of [
      ["quantity", "1.00000000000000000001"],
      ["unit_price_ht_cents", "100.00000000000000001"],
      ["quantity", "0.0000000000000000000001"],
    ] as const) {
      expect(thrown(() => computeEstimateV3Canonical(canonicalJsonWith(base, "line", key, literal)))).toMatchObject({
        code: "ESTIMATE_V3_INPUT_INVALID",
        sqlstate: "22023",
      });
    }
    for (const [key, literal, gross] of [
      ["quantity", "15e-1", 150],
      ["quantity", "-0", 0],
      ["quantity", "2.00000000000000000000", 200],
      ["unit_price_ht_cents", "1E2", 100],
    ] as const) {
      const output = computeEstimateV3Canonical(canonicalJsonWith(base, "line", key, literal));
      expect(output.lines[0].gross_ht_cents).toBe(gross);
    }
  });

  it("refuses malformed JSON with ESTIMATE_V3_INPUT_INVALID", () => {
    expect(thrown(() => computeEstimateV3Canonical("{"))).toMatchObject({
      code: "ESTIMATE_V3_INPUT_INVALID",
    });
    expect(thrown(() => computeEstimateV3Canonical({ params: null, items: [] }))).toMatchObject({
      code: "ESTIMATE_V3_INPUT_INVALID",
    });
  });

  it("omits sections from the line output and keeps lines in input order", () => {
    const input = v3Input([
      v3Line(3),
      { ...v3Line(9), item_type: "section", tax_rate_bp: null },
      v3Line(1),
    ]);
    const output = computeEstimateV3Canonical(input);
    expect(output.lines.map((line) => line.id)).toEqual([fixtureLineId(3), fixtureLineId(1)]);
  });
});

describe("stored v3 reader (frozen columns, no recomputation)", () => {
  function storedS5() {
    const breakdown = computeEstimateV3Breakdown(
      oracleInput({ discount_amount_cents: 101 }, { O1: 1000, O2: 1000, O3: 1000 })
    );
    const projection = projectEstimateV3Snapshot(breakdown);
    return {
      version: { ...projection.version, contractor_role: "principal", calc_snapshot_context: projection.context },
      items: projection.items.map((item, index) => ({
        ...item,
        item_type: "line" as const,
        pricing_status: breakdown.lines[index].pricing_status,
        tax_rate_bp: breakdown.lines[index].tax_rate_bp,
      })),
    };
  }

  it("reads back a frozen v3 with the frozen totals and tax summary", () => {
    const view = readStoredEstimateV3(storedS5());
    expect(view.totals).toMatchObject({
      gross_ht_cents: 6_905_456,
      discount_applied_cents: 101,
      total_ht_cents: 6_905_355,
      total_tax_cents: 1_325_525,
      total_ttc_cents: 8_230_880,
    });
    expect(view.tax_breakdown).toEqual([
      { rate_bp: 1000, base_cents: 555_453, tax_cents: 55_545 },
      { rate_bp: 2000, base_cents: 6_349_902, tax_cents: 1_269_980 },
    ]);
  });

  it("refuses a frozen v3 whose line nets no longer sum to the HT total", () => {
    const stored = storedS5();
    stored.items[0] = { ...stored.items[0], line_total_ht_cents: stored.items[0].line_total_ht_cents + 1 };
    expect(thrown(() => readStoredEstimateV3(stored))).toMatchObject({
      code: "ESTIMATE_V3_STORED_INCOHERENT",
    });
  });

  it("refuses a frozen v3 carrying a rounding adjustment", () => {
    const stored = storedS5();
    expect(
      thrown(() =>
        readStoredEstimateV3({
          ...stored,
          version: { ...stored.version, rounding_adjustment_cents: 1 },
        })
      )
    ).toMatchObject({ code: "ESTIMATE_V3_STORED_INCOHERENT" });
  });

  /** Une ligne de fourniture de 10 000 c à 20 %, figée pour le rôle d'entreprise donné. */
  function storedSupplyLine(contractorRole: string | null) {
    const breakdown = computeEstimateV3Breakdown(
      supplyLineInput(1, 10_000, 1, { reverse_charge: contractorRole === "subcontractor" })
    );
    const projection = projectEstimateV3Snapshot(breakdown);
    return {
      version: { ...projection.version, contractor_role: contractorRole, calc_snapshot_context: projection.context },
      items: projection.items.map((item, index) => ({
        ...item,
        item_type: "line" as const,
        pricing_status: breakdown.lines[index].pricing_status,
        tax_rate_bp: breakdown.lines[index].tax_rate_bp,
      })),
    };
  }

  it("reads reverse charge from the frozen contractor role, like v2 (D8: T_r = 0 only under reverse charge)", () => {
    expect(readStoredEstimateV3(storedSupplyLine("subcontractor")).totals).toMatchObject({
      total_tax_cents: 0,
      total_ttc_cents: 10_000,
    });
    expect(readStoredEstimateV3(storedSupplyLine("principal")).totals).toMatchObject({
      total_tax_cents: 2000,
      total_ttc_cents: 12_000,
    });
  });

  it("refuses zeroed VAT without reverse charge, VAT under reverse charge and an unknown contractor role", () => {
    const stored = storedSupplyLine("principal");
    const zeroed = {
      version: {
        ...stored.version,
        total_tax_cents: 0,
        total_ttc_cents: 10_000,
        calc_snapshot_context: {
          ...stored.version.calc_snapshot_context,
          tax_breakdown: [{ rate_bp: 2000, base_cents: 10_000, tax_cents: 0 }],
        },
      },
      items: [{ ...stored.items[0], line_tax_cents: 0, line_total_ttc_cents: 10_000 }],
    };
    expect(thrown(() => readStoredEstimateV3(zeroed))).toMatchObject({ code: "ESTIMATE_V3_STORED_INCOHERENT" });
    for (const contractorRole of ["subcontractor", null, "other"]) {
      expect(
        thrown(() => readStoredEstimateV3({ ...stored, version: { ...stored.version, contractor_role: contractorRole } }))
      ).toMatchObject({ code: "ESTIMATE_V3_STORED_INCOHERENT" });
    }
  });

  it("refuses a frozen realized sale coefficient other than ⌈HT / déboursé⌋ at 6 decimals (§4.11)", () => {
    const stored = storedS5();
    const frozen = stored.version.calc_snapshot_context.realized_sale_coefficient;
    expect(frozen).not.toBeNull();
    expect(readStoredEstimateV3(stored).totals.realized_sale_coefficient).toBe(frozen);
    for (const coefficient of [-1, 999, 0, null, (frozen ?? 0) + 0.000001]) {
      const tampered = {
        ...stored,
        version: {
          ...stored.version,
          calc_snapshot_context: { ...stored.version.calc_snapshot_context, realized_sale_coefficient: coefficient },
        },
      };
      expect(thrown(() => readStoredEstimateV3(tampered))).toMatchObject({ code: "ESTIMATE_V3_STORED_INCOHERENT" });
    }
  });
});

// Intégration 2.4 : règles où les deux pistes divergeaient, tranchées pour que le moteur TS et le
// jumeau SQL rendent la même sortie canonique (docs/testing/estimate-engine-v3-2.4.md, I-01 à I-06).
describe("sub-lot 2.4 integration: one contract for the TS engine and the SQL twin", () => {
  it("I-01 puts the whole MO on chantier without the labour split, gross and net (v2 convention)", () => {
    const output = computeEstimateV3Canonical(canonicalJson(tHmoInput(10)));
    expect(output.lines[0]).toMatchObject({
      gross_mo_ht_cents: 22500,
      gross_mo_atelier_ht_cents: 0,
      gross_mo_chantier_ht_cents: 22500,
      snapshot_mo_ht_cents: 22500,
      snapshot_mo_atelier_ht_cents: 0,
      snapshot_mo_chantier_ht_cents: 22500,
    });
    const discounted = computeEstimateV3Canonical(
      canonicalJson({ ...tHmoInput(10), params: { ...tHmoInput(10).params, discount_amount_cents: 3250 } })
    );
    expect(discounted.lines[0].snapshot_mo_ht_cents).toBe(
      discounted.lines[0].snapshot_mo_atelier_ht_cents + discounted.lines[0].snapshot_mo_chantier_ht_cents
    );
    expect(discounted.lines[0].snapshot_mo_chantier_ht_cents).toBeGreaterThan(0);
  });

  it("I-01 refuses a frozen line whose atelier and chantier no longer carry its MO", () => {
    const breakdown = computeEstimateV3Breakdown(tHmoInput(10));
    const projection = projectEstimateV3Snapshot(breakdown);
    const items = projection.items.map((item, index) => ({
      ...item,
      item_type: "line" as const,
      pricing_status: breakdown.lines[index].pricing_status,
      tax_rate_bp: breakdown.lines[index].tax_rate_bp,
    }));
    const version = { ...projection.version, contractor_role: "principal", calc_snapshot_context: projection.context };
    expect(() => readStoredEstimateV3({ version, items })).not.toThrow();
    const tampered = [{ ...items[0], snapshot_mo_atelier_ht_cents: 0, snapshot_mo_chantier_ht_cents: 0 }];
    expect(thrown(() => readStoredEstimateV3({ version, items: tampered }))).toMatchObject({
      code: "ESTIMATE_V3_STORED_INCOHERENT",
    });
  });

  it("I-02 validates sections like the SQL twin: uuid id, null or uuid parent, ids unique across items", () => {
    const section = (overrides: Record<string, unknown>) =>
      ({ ...v3Line(9), item_type: "section", tax_rate_bp: null, ...overrides }) as never;
    for (const items of [
      [section({ id: "section-1" }), v3Line(1)],
      [section({ parent_id: "parent-1" }), v3Line(1)],
      [section({ id: fixtureLineId(1) }), v3Line(1)],
    ]) {
      expect(thrown(() => computeEstimateV3Canonical(v3Input(items)))).toMatchObject({
        code: "ESTIMATE_V3_INPUT_INVALID",
        sqlstate: "22023",
      });
    }
    const nested = v3Line(1, { parent_id: fixtureLineId(9) });
    expect(computeEstimateV3Canonical(v3Input([section({}), nested])).lines).toHaveLength(1);
  });

  it("I-03 requires the eight canonical parameter keys, discount_amount_cents included", () => {
    const input = v3Input([v3Line(1, { unit_price_ht_cents: 100 })]);
    const params: Partial<typeof input.params> = { ...input.params };
    delete params.discount_amount_cents;
    expect(thrown(() => computeEstimateV3Canonical({ ...input, params }))).toMatchObject({
      code: "ESTIMATE_V3_INPUT_INVALID",
    });
  });

  it("I-03 refuses an undefined discount_amount_cents like a missing key (JSON has no undefined)", () => {
    const input = v3Input([v3Line(1, { unit_price_ht_cents: 100 })]);
    const params = { ...input.params, discount_amount_cents: undefined };
    expect(thrown(() => computeEstimateV3Canonical({ ...input, params }))).toMatchObject({
      code: "ESTIMATE_V3_INPUT_INVALID",
      field: "params.discount_amount_cents",
    });
  });

  it("names the original item index in a computation error when sections precede the line", () => {
    const input = supplyLineInput(1, 2_000_000_000, "1.6");
    const section = { ...v3Line(9), item_type: "section", tax_rate_bp: null } as never;
    const error = thrown(() => computeEstimateV3Breakdown({ ...input, items: [section, ...input.items] }));
    expect(error).toMatchObject({ code: "ESTIMATE_AMOUNT_OVERFLOW" });
    expect((error as EstimateV3Error).field).toMatch(/^items\[1\]/);
  });

  it("I-04 derives null line hours from a null hours-per-unit column, 0.000 on a non-priced line", () => {
    const output = computeEstimateV3Canonical(
      canonicalJson(
        v3Input([
          v3Line(1, { unit_price_ht_cents: 100, quantity: 2, h_mo_per_unit: null }),
          v3Line(2, { pricing_status: "for_memory", quantity: 2, h_mo_per_unit: "1.5" }),
        ])
      )
    );
    expect(output.lines.map((line) => [line.h_mo, line.h_mo_atelier, line.h_mo_chantier])).toEqual([
      [null, null, null],
      ["0.000", null, null],
    ]);
  });

  it("I-05 refuses a rounding step below 1 cent whatever the mode (column CHECK rounding_step_cents >= 1)", () => {
    expect(
      thrown(() => computeEstimateV3Canonical(supplyLineInput(1, 100, 1, { rounding_mode: "none", rounding_step_cents: 0 })))
    ).toMatchObject({ code: "ESTIMATE_V3_INPUT_INVALID", sqlstate: "22023" });
  });

  it("I-06 raises ESTIMATE_AMOUNT_OVERFLOW for derived line hours beyond numeric(12,3), even at no cost", () => {
    const input = v3Input([v3Line(1, { quantity: "999999999.999", h_mo_per_unit: "2", labor_rate_cents: 0 })]);
    expect(thrown(() => computeEstimateV3Canonical(canonicalJson(input)))).toMatchObject({
      code: "ESTIMATE_AMOUNT_OVERFLOW",
      sqlstate: "22003",
    });
  });
});
