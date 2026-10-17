// Lot 2, sub-lot 2.4: seeded cases of the TS/SQL parity of engine 3 (design D12, §5.5, §14 "2.4").
// Pure module: no I/O. The cases are canonical JSON inputs `{ params, items }` with JSON numbers
// only (the contract shared by computeEstimateV3Canonical and private.estimate_v3_compute_items).
//
// - 10 000 random lines, each priced alone (one single-line estimate per line);
// - 300 random multi-line estimates: half-cents, quantities with 3 decimals, hours per unit with
//   4 decimals, the six pricing statuses, several VAT rates, reverse charge, labour split, discount
//   by amount or rate (capped or not), commercial rounding down, sections, clone lines that tie in
//   the allocations, upper-case ids;
// - named edge cases where both engines must refuse with the same code (input or overflow),
//   some written as raw JSON text (number literals beyond a double, decimal strings, exponents).
// Both sides read the same canonical JSON text: the TS adapter parses it at the source of each
// number literal, the SQL twin reads it as jsonb.

import { computeEstimateV3Canonical, EstimateV3Error } from "../../src/lib/estimates/engine-v3";

export type ParityCase = {
  id: number;
  family: "line" | "estimate" | "edge";
  label: string;
  /** Parsed view of the case (coverage counts); for a raw case, an approximation of the text. */
  input: { params: Record<string, unknown>; items: Array<Record<string, unknown>> };
  /** The canonical JSON text both engines read. */
  text: { params: string; items: string };
};

type RawText = { params: string; items: string };

export type ParityOutcome =
  | { ok: unknown }
  | { error: { code: string; sqlstate: string } };

export const DEFAULT_PARITY_SEED = 20261017;
export const PARITY_LINE_COUNT = 10_000;
export const PARITY_ESTIMATE_COUNT = 300;

type Random = () => number;

function mulberry32(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (random: Random, max: number) => Math.floor(random() * (max + 1));
const pick = <T>(random: Random, values: readonly T[]) => values[int(random, values.length - 1)];
/** A JSON number with at most `scale` decimals, read exactly through its shortest string. */
const scaled = (units: number, scale: number) => Number((units / 10 ** scale).toFixed(scale));
const maybe = <T>(random: Random, probability: number, value: () => T): T | null =>
  random() < probability ? value() : null;

const NON_PRICED = ["included", "for_memory", "not_priced", "out_of_scope", "not_applicable"] as const;
const TAX_RATES = [2000, 2000, 2000, 1000, 550, 210, 850, 0] as const;
// Coefficients that put sale amounts on half-cents, plus random 4-decimal ones.
const SALE_COEFFICIENTS = [1, 1.05, 1.2, 1.25, 1.3, 1.5, 1.6, 2.5] as const;
const ROUNDING_STEPS = [1, 10, 100, 1000, 10_000, 100_000] as const;
const UNITS = ["u", "ml", "m2", "ens", "fft", null] as const;

function uuid(random: Random) {
  const hex = (length: number) =>
    Array.from({ length }, () => "0123456789abcdef"[int(random, 15)]).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${"89ab"[int(random, 3)]}${hex(3)}-${hex(12)}`;
}

function saleCoefficient(random: Random) {
  return random() < 0.6 ? pick(random, SALE_COEFFICIENTS) : scaled(5_000 + int(random, 25_000), 4);
}

function randomParams(random: Random, scale: "line" | "estimate") {
  const discountKind = random();
  const roundingDown = scale === "estimate" && random() < 0.35;
  return {
    sale_coefficient_fo: saleCoefficient(random),
    sale_coefficient_mo: saleCoefficient(random),
    discount_amount_cents:
      scale === "estimate" && discountKind < 0.3
        ? random() < 0.15
          ? 2_000_000_000 // capped at G
          : pick(random, [0, 1, 99, 101, int(random, 500_000)])
        : null,
    discount_bp:
      scale === "estimate" && discountKind >= 0.3 && discountKind < 0.6
        ? pick(random, [1, 5, 250, 1000, 1250, 3333, 9999, 10_000, int(random, 10_000)])
        : 0,
    rounding_mode: roundingDown ? "down" : "none",
    rounding_step_cents: roundingDown ? pick(random, ROUNDING_STEPS) : pick(random, [1, 1, 100]),
    reverse_charge: random() < 0.1,
    labor_split_enabled: random() < 0.35,
  };
}

function randomLine(random: Random, id: string, parentId: string | null, family: "line" | "estimate") {
  const priced = random() < 0.85;
  // Large lines are priced alone; inside an estimate they would mostly overflow its total.
  const big = family === "line" && random() < 0.03;
  const quantityThousandths = family === "line" ? 250_000 : 60_000;
  return {
    id,
    item_type: "line",
    parent_id: parentId,
    quantity: random() < 0.04 ? 0 : scaled(big ? int(random, 5_000_000) : int(random, quantityThousandths), 3),
    unit_price_ht_cents: maybe(random, 0.95, () => (random() < 0.2 ? int(random, 999) : int(random, 120_000))),
    k_fo: maybe(random, 0.6, () => (random() < 0.3 ? 1 : scaled(500 + int(random, 1500), 3))),
    h_mo_per_unit: maybe(random, 0.7, () => scaled(int(random, 150_000), 4)),
    h_mo_atelier_per_unit: maybe(random, 0.4, () => scaled(int(random, 80_000), 4)),
    h_mo_chantier_per_unit: maybe(random, 0.4, () => scaled(int(random, 80_000), 4)),
    h_mo_majoration: maybe(random, 0.6, () => (random() < 0.4 ? 1 : scaled(10_000 + int(random, 5_000), 4))),
    k_mo: maybe(random, 0.5, () => (random() < 0.3 ? 1 : scaled(500 + int(random, 1500), 3))),
    k_mo_atelier: maybe(random, 0.3, () => (random() < 0.3 ? 1 : scaled(500 + int(random, 1500), 3))),
    k_mo_chantier: maybe(random, 0.3, () => (random() < 0.3 ? 1 : scaled(500 + int(random, 1500), 3))),
    labor_rate_cents: maybe(random, 0.85, () => 2_000 + int(random, 6_000)),
    labor_rate_atelier_cents: maybe(random, 0.35, () => 2_000 + int(random, 6_000)),
    labor_rate_chantier_cents: maybe(random, 0.35, () => 2_000 + int(random, 6_000)),
    pricing_status: priced ? "priced" : pick(random, NON_PRICED),
    tax_rate_bp: pick(random, TAX_RATES),
    unit_code: pick(random, UNITS),
  };
}

function randomEstimate(random: Random) {
  const lineCount = 1 + int(random, random() < 0.1 ? 199 : 60);
  const items: Array<Record<string, unknown>> = [];
  let section: string | null = null;
  const lines: Array<Record<string, unknown>> = [];
  for (let n = 0; n < lineCount; n += 1) {
    if (random() < 0.08) {
      section = uuid(random);
      items.push({ id: section, item_type: "section", parent_id: null });
    }
    // Clone lines (same amounts, other ids) force ties in every allocation.
    const clone = lines.length > 0 && random() < 0.12;
    const line = clone
      ? { ...pick(random, lines), id: uuid(random), parent_id: section }
      : randomLine(random, uuid(random), section, "estimate");
    if (random() < 0.03) line.id = String(line.id).toUpperCase();
    lines.push(line);
    items.push(line);
  }
  return { params: randomParams(random, "estimate"), items };
}

const EDGE_LINE = {
  id: "00000000-0000-4000-8000-000000000001",
  item_type: "line",
  parent_id: null,
  quantity: 1,
  unit_price_ht_cents: 100,
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
  unit_code: "u",
};
const EDGE_PARAMS = {
  sale_coefficient_fo: 1,
  sale_coefficient_mo: 1,
  discount_amount_cents: null,
  discount_bp: 0,
  rounding_mode: "none",
  rounding_step_cents: 1,
  reverse_charge: false,
  labor_split_enabled: false,
};

/** Edge cases written as raw JSON text: one field of the edge line or params carries a literal. */
function rawEdgeCases(): Array<[string, RawText]> {
  const marker = "__LITERAL__";
  const lineWith = (key: string, literal: string): RawText => ({
    params: JSON.stringify(EDGE_PARAMS),
    items: JSON.stringify([{ ...EDGE_LINE, [key]: marker }]).replace(`"${marker}"`, literal),
  });
  const paramWith = (key: string, literal: string): RawText => ({
    params: JSON.stringify({ ...EDGE_PARAMS, [key]: marker }).replace(`"${marker}"`, literal),
    items: JSON.stringify([EDGE_LINE]),
  });
  return [
    ["quantity literal more precise than a double", lineWith("quantity", "1.00000000000000000001")],
    ["unit price literal more precise than a double", lineWith("unit_price_ht_cents", "100.00000000000000001")],
    ["sale coefficient written as a decimal string", paramWith("sale_coefficient_fo", '"1.30"')],
    ["quantity written as a decimal string", lineWith("quantity", '"2"')],
    ["quantity literal with an exponent", lineWith("quantity", "15e-1")],
    ["unit price literal with an upper-case exponent", lineWith("unit_price_ht_cents", "1E2")],
    ["negative-zero quantity literal", lineWith("quantity", "-0")],
    ["trailing zeros beyond the scale", lineWith("quantity", "2.00000000000000000000")],
    ["tiny literal beyond the scale", lineWith("quantity", "1e-30")],
  ];
}

function edgeCases(): Array<[string, ParityCase["input"]]> {
  const line = (overrides: Record<string, unknown>) => ({ ...EDGE_LINE, ...overrides });
  const one = (overrides: Record<string, unknown>, params: Record<string, unknown> = {}) => ({
    params: { ...EDGE_PARAMS, ...params },
    items: [line(overrides)],
  });
  const withoutParam = (key: string) => {
    const params: Record<string, unknown> = { ...EDGE_PARAMS };
    delete params[key];
    return { params, items: [line({})] };
  };
  return [
    ["empty estimate", { params: EDGE_PARAMS, items: [] }],
    ["sections only", { params: EDGE_PARAMS, items: [{ id: EDGE_LINE.id, item_type: "section", parent_id: null }] }],
    ["quantity with 4 decimals", one({ quantity: 1.0005 })],
    ["negative quantity", one({ quantity: -1 })],
    ["quantity beyond numeric(12,3)", one({ quantity: 1_000_000_000 })],
    ["fractional unit price", one({ unit_price_ht_cents: 10.5 })],
    ["unit price beyond integer", one({ unit_price_ht_cents: 2_147_483_648 })],
    ["k_fo with 4 decimals", one({ k_fo: 1.0001 })],
    ["hours per unit with 5 decimals", one({ h_mo_per_unit: 0.12345 })],
    ["majoration with 5 decimals", one({ h_mo_majoration: 1.00001 })],
    ["negative labour rate", one({ h_mo_per_unit: 1, labor_rate_cents: -1 })],
    ["tax rate missing", one({ tax_rate_bp: null })],
    ["tax rate above 10000", one({ tax_rate_bp: 10_001 })],
    ["unknown pricing status", one({ pricing_status: "free" })],
    ["unknown item type", one({ item_type: "group" })],
    ["id that is not a uuid", one({ id: "line-1" })],
    ["parent that is not a uuid", one({ parent_id: "parent-1" })],
    ["unit code that is not text", one({ unit_code: 3 })],
    ["duplicate line ids", { params: EDGE_PARAMS, items: [line({}), line({})] }],
    [
      "section and line sharing an id",
      { params: EDGE_PARAMS, items: [{ id: EDGE_LINE.id, item_type: "section", parent_id: null }, line({})] },
    ],
    ["section with a bad id", { params: EDGE_PARAMS, items: [{ id: "s", item_type: "section", parent_id: null }, line({})] }],
    ["sale coefficient 0", one({}, { sale_coefficient_fo: 0 })],
    ["sale coefficient above 10", one({}, { sale_coefficient_mo: 10.0001 })],
    ["sale coefficient with 5 decimals", one({}, { sale_coefficient_fo: 1.23456 })],
    ["two discount intents", one({}, { discount_amount_cents: 100, discount_bp: 500 })],
    ["amount intent 0 with a rate", one({}, { discount_amount_cents: 0, discount_bp: 1 })],
    ["discount rate above 10000", one({}, { discount_bp: 10_001 })],
    ["v2 rounding mode", one({}, { rounding_mode: "nearest", rounding_step_cents: 100 })],
    ["rounding down with a step of 0", one({}, { rounding_mode: "down", rounding_step_cents: 0 })],
    ["rounding none with a step of 0", one({}, { rounding_step_cents: 0 })],
    ["reverse charge not a boolean", one({}, { reverse_charge: "false" })],
    ["missing discount_amount_cents key", withoutParam("discount_amount_cents")],
    ["missing labor_split_enabled key", withoutParam("labor_split_enabled")],
    ["PU overflow (T-CAP)", one({ unit_price_ht_cents: 2_000_000_000 }, { sale_coefficient_fo: 1.6 })],
    [
      "gross total overflow",
      { params: EDGE_PARAMS, items: [line({ unit_price_ht_cents: 1_500_000_000 }), line({ id: "00000000-0000-4000-8000-000000000002", unit_price_ht_cents: 1_500_000_000 })] },
    ],
    ["TTC overflow", one({ unit_price_ht_cents: 2_000_000_000 })],
    ["cost overflow at a low sale coefficient", one({ unit_price_ht_cents: 2_000_000_000, k_fo: 1.5 }, { sale_coefficient_fo: 0.5 })],
    ["line gross overflow from the quantity", one({ quantity: 100_000, unit_price_ht_cents: 100_000 })],
    ["derived hours overflow at no cost", one({ quantity: 999_999_999.999, h_mo_per_unit: 2, labor_rate_cents: 0 })],
    ["non-priced line with overflowing inputs", one({ quantity: 999_999_999.999, unit_price_ht_cents: 2_000_000_000, pricing_status: "for_memory" })],
    ["amount discount capped at the gross", one({}, { discount_amount_cents: 2_147_483_647 })],
    ["rate discount of 100 %", one({}, { discount_bp: 10_000 })],
    ["rounding step larger than the net", one({}, { rounding_mode: "down", rounding_step_cents: 1_000 })],
    ["reverse charge keeps the VAT groups", one({}, { reverse_charge: true })],
    ["zero-quantity priced line", one({ quantity: 0, h_mo_per_unit: 1, labor_rate_cents: 4000 })],
    ["only non-priced lines", one({ pricing_status: "out_of_scope", h_mo_per_unit: 1.5 })],
    [
      "labour split with roles only",
      one({ h_mo_per_unit: 1, labor_rate_cents: 3000, labor_rate_atelier_cents: 4000 }, { labor_split_enabled: true }),
    ],
    [
      "labour split with atelier hours and no rate",
      one({ h_mo_atelier_per_unit: 1.5, h_mo_chantier_per_unit: 0.25, labor_rate_chantier_cents: 5000 }, { labor_split_enabled: true }),
    ],
  ];
}

/** Every case, in a stable order, with consecutive ids from 1. */
export function generateParityCases(seed = DEFAULT_PARITY_SEED): ParityCase[] {
  const random = mulberry32(seed);
  const cases: ParityCase[] = [];
  const push = (family: ParityCase["family"], label: string, input: ParityCase["input"], raw?: RawText) =>
    cases.push({
      id: cases.length + 1,
      family,
      label,
      input,
      text: raw ?? { params: JSON.stringify(input.params), items: JSON.stringify(input.items) },
    });
  for (let n = 0; n < PARITY_LINE_COUNT; n += 1) {
    push("line", `line ${n + 1}`, {
      params: randomParams(random, "line"),
      items: [randomLine(random, uuid(random), null, "line")],
    });
  }
  for (let n = 0; n < PARITY_ESTIMATE_COUNT; n += 1) {
    push("estimate", `estimate ${n + 1}`, randomEstimate(random));
  }
  for (const [label, input] of edgeCases()) push("edge", label, input);
  for (const [label, raw] of rawEdgeCases()) {
    push("edge", label, { params: JSON.parse(raw.params), items: JSON.parse(raw.items) }, raw);
  }
  return cases;
}

const decimalUnits = (value: unknown, scale: number) => {
  const [whole, fraction = ""] = String(value ?? 0).split(".");
  return BigInt(whole + fraction.padEnd(scale, "0"));
};

const pow10 = (scale: number) => BigInt(`1${"0".repeat(scale)}`);

/** True when FO_u × c_FO + MO_u × c_MO (without the split) ends exactly on a half-cent. */
function endsOnHalfCent(item: Record<string, unknown>, params: Record<string, unknown>) {
  // FO term at scale 0 + 3 + 4 = 7, MO term at scale 4 + 4 + 0 + 3 + 4 = 15; both brought to 18.
  const fo =
    decimalUnits(item.unit_price_ht_cents, 0) * decimalUnits(item.k_fo ?? 1, 3) * decimalUnits(params.sale_coefficient_fo, 4);
  const mo =
    decimalUnits(item.h_mo_majoration ?? 1, 4) *
    decimalUnits(item.h_mo_per_unit, 4) *
    decimalUnits(item.labor_rate_cents, 0) *
    decimalUnits(item.k_mo ?? 1, 3) *
    decimalUnits(params.sale_coefficient_mo, 4);
  const value = fo * pow10(11) + mo * pow10(3);
  return (value % pow10(18)) * BigInt(2) === pow10(18);
}

/** What the cases exercise (inputs and TS outcomes), for the report. */
export function describeParityCoverage(cases: ParityCase[], outcomes: ParityOutcome[]) {
  const coverage: Record<string, number> = {};
  const add = (key: string, amount = 1) => (coverage[key] = (coverage[key] ?? 0) + amount);
  cases.forEach((entry, index) => {
    const { params, items } = entry.input;
    const lines = items.filter((item) => item.item_type === "line");
    add(`${entry.family} cases`);
    add("sections", items.length - lines.length);
    for (const line of lines) {
      add(`status ${String(line.pricing_status)}`);
      if (String(line.quantity).split(".")[1]?.length === 3) add("quantities with 3 decimals");
      if (String(line.h_mo_per_unit).split(".")[1]?.length === 4) add("hours per unit with 4 decimals");
      if (line.pricing_status === "priced" && !params.labor_split_enabled && endsOnHalfCent(line, params)) {
        add("priced lines whose exact unit sale amount ends on a half-cent");
      }
      if (String(line.id) !== String(line.id).toLowerCase()) add("upper-case ids");
    }
    if (params.reverse_charge) add("reverse charge");
    if (params.rounding_mode === "down") add("commercial rounding down");
    if (params.discount_amount_cents !== null && params.discount_amount_cents !== undefined) add("discount by amount");
    if (Number(params.discount_bp) > 0) add("discount by rate");
    const outcome = outcomes[index];
    if (!("ok" in outcome)) return;
    const result = outcome.ok as {
      lines: Array<Record<string, number>>;
      totals: { tax_breakdown: unknown[]; commercial_rounding_cents: number; discount_applied_cents: number; gross_ht_cents: number };
    };
    if (result.totals.tax_breakdown.length > 1) add("multi-rate estimates");
    if (result.totals.commercial_rounding_cents > 0) add("estimates with a commercial rounding applied");
    if (result.totals.discount_applied_cents > 0 && result.totals.discount_applied_cents === result.totals.gross_ht_cents) {
      add("discounts capped at the gross");
    }
    add("lines with the labour split active", result.lines.filter((line) => line.gross_mo_atelier_ht_cents > 0).length);
    const grossValues = result.lines.map((line) => line.gross_ht_cents).filter((value) => value > 0);
    if (new Set(grossValues).size < grossValues.length) add("estimates with equal gross lines (allocation ties)");
  });
  return coverage;
}

/** The TS side of the parity: the canonical adapter on the case text, or the named error it raises. */
export function computeTsOutcome(entry: Pick<ParityCase, "text">): ParityOutcome {
  try {
    const text = `{"params":${entry.text.params},"items":${entry.text.items}}`;
    return { ok: JSON.parse(JSON.stringify(computeEstimateV3Canonical(text))) as unknown };
  } catch (error) {
    if (error instanceof EstimateV3Error) return { error: { code: error.code, sqlstate: error.sqlstate } };
    throw error;
  }
}
