import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { computeEstimateV3Breakdown, projectEstimateV3Snapshot } from "@/lib/estimates/engine-v3";
import { fixtureLineId, ORACLE_LINES, oracleInput } from "@/lib/estimates/engine-v3/oracle.fixtures";
import * as sealModule from "@/lib/estimates/estimate-seal";
import {
  buildCanonicalEstimateSealPayload,
  computeEstimateSealHash,
  CURRENT_ESTIMATE_SEAL_PAYLOAD_VERSION,
  type EstimateSealVersionFields,
} from "@/lib/estimates/estimate-seal";
import { computeOfferSealHash } from "@/lib/estimates/offer-contract";
import type { Database, Json } from "@/types/database";
import {
  FROZEN_CORPUS_COLUMNS,
  FROZEN_CORPUS_PATH,
  type FrozenCorpusCase,
  type FrozenCorpusFile,
} from "../../../scripts/engine-v3/frozen-corpus";

// Lot 2, sous-lot 2.7 (docs/testing/estimate-engine-v3-2.7.md §11, F27-S01 à F27-S08).
// Isolation justifiée (intégrité du sceau, D14, F1, F2) : un champ v3 oublié par la charge 6 rend
// un devis émis modifiable sans que son sceau change, et un octet changé dans les charges 1 à 4
// rend invérifiables des documents déjà émis. Aucun parcours E2E ne peut énumérer chaque champ
// ni rejouer 3 600 charges historiques ; seul le constructeur pur le peut.
// Les charges 1 à 4 et le marqueur 5 du contrat 1 sont figés ici sur `c14b243d` (pointe de 2.5,
// avant toute modification de 2.7) : ces cas sont verts par construction et doivent le rester.

type ItemRow = Database["public"]["Tables"]["estimate_items"]["Row"];
type V3VersionColumns = {
  sale_coefficient_fo: number | null;
  sale_coefficient_mo: number | null;
  gross_ht_cents: number | null;
  discount_applied_cents: number | null;
  commercial_rounding_cents: number | null;
};
type SealVersion = EstimateSealVersionFields & V3VersionColumns;
type JsonObject = Record<string, unknown>;

const ID = {
  version: "44444444-4444-4444-8444-444444444444",
  tenant: "22222222-2222-4222-8222-222222222222",
  project: "33333333-3333-4333-8333-333333333333",
  actor: "11111111-1111-4111-8111-111111111111",
  other: "99999999-9999-4999-8999-999999999999",
  document: "55555555-5555-4555-8555-555555555555",
  claim: "66666666-6666-4666-8666-666666666666",
  dispatch: "77777777-7777-4777-8777-777777777777",
  section: "a0000000-0000-4000-8000-00000000000a",
  role: "88888888-8888-4888-8888-888888888888",
};
const PDF_HASH = "a".repeat(64);
const CALCULATION_HASH = "c".repeat(64);
const UNIT_CODES = ["ml", "u", "m2", "ml", "u", "ml", "ml"];
const UNIT_LABELS: Record<string, string> = { ml: "ml", u: "u", m2: "m²" };

const copy = <T,>(value: T): T => structuredClone(value);
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
function setAt(value: unknown, dottedPath: string, replacement: unknown): void {
  const segments = dottedPath.split(".");
  let target = value as JsonObject;
  for (const segment of segments.slice(0, -1)) target = target[segment] as JsonObject;
  target[segments.at(-1)!] = replacement;
}
function getAt(value: unknown, dottedPath: string): unknown {
  return dottedPath.split(".").reduce<unknown>((target, segment) => (target as JsonObject)[segment], value);
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}
function thrown(run: () => unknown): unknown {
  try { run(); } catch (error) { return error; }
  return undefined;
}

/* ---------- v3 figée : S2 du moteur pur (O1–O7, 1,30 / 1,20, remise 1,01 €) ---------- */

function baseItem(overrides: Partial<ItemRow>): ItemRow {
  return {
    id: fixtureLineId(1), created_at: "2026-10-17T08:00:00.000Z", updated_at: "2026-10-17T08:00:00.000Z",
    tenant_id: ID.tenant, version_id: ID.version, parent_id: null, item_type: "line", line_nature: "supply_and_labor",
    position: 0, title: "Ligne", aid: null, description: null, quantity: null, unit_price_ht_cents: null, tax_rate_bp: 2000,
    k_fo: null, fo_provision: 1, h_mo: null, h_mo_majoration: 1, k_mo: null, h_mo_atelier: null, k_mo_atelier: null,
    labor_role_atelier_id: null, h_mo_chantier: null, k_mo_chantier: null, labor_role_chantier_id: null,
    pu_ht_cents: null, labor_role_id: null, category_id: null, supply_type_id: null, product_id: null,
    selected_supplier_price_id: null, source_provider: null, source_job_id: null, source_file_name: null,
    source_page: null, source_metadata: {}, snapshot_pu_ht_cents: null, snapshot_fo_ht_cents: null,
    snapshot_mo_ht_cents: null, snapshot_mo_atelier_ht_cents: null, snapshot_mo_chantier_ht_cents: null,
    line_total_ht_cents: null, line_tax_cents: null, line_total_ttc_cents: null, unit_code: null,
    pricing_status: "priced", h_mo_per_unit: null, h_mo_atelier_per_unit: null, h_mo_chantier_per_unit: null,
    snapshot_gross_ht_cents: null, snapshot_gross_fo_ht_cents: null,
    ...overrides,
  };
}

function frozenV3() {
  const breakdown = computeEstimateV3Breakdown(oracleInput({ discount_amount_cents: 101 }));
  const projection = projectEstimateV3Snapshot(breakdown);
  const lines = projection.items.map((snapshot, index) => baseItem({
    id: snapshot.id, parent_id: ID.section, position: index, title: `ARMY ${ORACLE_LINES[index].ref}`,
    quantity: Number(ORACLE_LINES[index].quantity), unit_price_ht_cents: ORACLE_LINES[index].unitPriceCents,
    k_fo: 1, k_mo: 1, h_mo: snapshot.h_mo === null ? null : Number(snapshot.h_mo), labor_role_id: ID.role,
    h_mo_per_unit: Number(ORACLE_LINES[index].hoursPerUnit), unit_code: UNIT_CODES[index],
    pu_ht_cents: snapshot.pu_ht_cents, snapshot_pu_ht_cents: snapshot.snapshot_pu_ht_cents,
    snapshot_gross_ht_cents: snapshot.snapshot_gross_ht_cents, snapshot_gross_fo_ht_cents: snapshot.snapshot_gross_fo_ht_cents,
    line_total_ht_cents: snapshot.line_total_ht_cents, line_tax_cents: snapshot.line_tax_cents,
    line_total_ttc_cents: snapshot.line_total_ttc_cents, snapshot_fo_ht_cents: snapshot.snapshot_fo_ht_cents,
    snapshot_mo_ht_cents: snapshot.snapshot_mo_ht_cents, snapshot_mo_atelier_ht_cents: snapshot.snapshot_mo_atelier_ht_cents,
    snapshot_mo_chantier_ht_cents: snapshot.snapshot_mo_chantier_ht_cents,
  }));
  const section = baseItem({ id: ID.section, item_type: "section", line_nature: null, title: "ARMY réseaux", tax_rate_bp: null, h_mo_majoration: 1 });
  const version: SealVersion = {
    id: ID.version, tenant_id: ID.tenant, project_id: ID.project, version_number: 3, title: "Offre v3",
    exclusions: "Hors peinture", date_devis: "2026-10-17", validite_jours: 30, currency: "EUR",
    total_ht_cents: projection.version.total_ht_cents, total_tax_cents: projection.version.total_tax_cents,
    total_ttc_cents: projection.version.total_ttc_cents, rounding_adjustment_cents: 0, margin_multiplier: 1,
    margin_mode: "fixed", discount_bp: 0, discount_amount_cents: 101, discount_mode: "simple", discount_steps: [],
    global_coefficient: 1, max_section_depth: 3, tax_rate_bp: 2000, rounding_mode: "none", rounding_step_cents: 1,
    calc_engine_version: 3, calc_snapshot_content_revision: 9, calc_snapshot_context: projection.context as unknown as Json,
    contractor_role: "principal", seal_hash: null, sale_coefficient_fo: 1.3, sale_coefficient_mo: 1.2,
    gross_ht_cents: projection.version.gross_ht_cents, discount_applied_cents: projection.version.discount_applied_cents,
    commercial_rounding_cents: projection.version.commercial_rounding_cents,
  };
  return { version, items: [section, ...lines], projection };
}

function seal6(version: SealVersion, items: ItemRow[], options?: Parameters<typeof buildCanonicalEstimateSealPayload>[1]) {
  return computeEstimateSealHash(buildCanonicalEstimateSealPayload({ version, items }, options));
}

/** Charge 4 (clés exactes du constructeur actuel) puis ajouts de D14. */
const PAYLOAD_6_VERSION_KEYS = [
  "calc_engine_version", "calc_snapshot_content_revision", "calc_snapshot_context", "commercial_rounding_cents",
  "contractor_role", "currency", "date_devis", "discount_amount_cents", "discount_applied_cents", "discount_bp",
  "discount_mode", "discount_steps", "exclusions", "global_coefficient", "gross_ht_cents", "margin_mode",
  "margin_multiplier", "max_section_depth", "rounding_adjustment_cents", "rounding_mode", "rounding_step_cents",
  "sale_coefficient_fo", "sale_coefficient_mo", "tax_breakdown", "tax_rate_bp", "title", "total_ht_cents",
  "total_tax_cents", "total_ttc_cents", "validite_jours", "version_number",
];
const PAYLOAD_6_ITEM_KEYS = [
  "category_id", "description", "h_mo", "h_mo_atelier", "h_mo_atelier_per_unit", "h_mo_chantier",
  "h_mo_chantier_per_unit", "h_mo_majoration", "h_mo_per_unit", "id", "item_type", "k_fo", "k_mo", "k_mo_atelier",
  "k_mo_chantier", "labor_role_atelier_id", "labor_role_chantier_id", "labor_role_id", "line_nature",
  "line_tax_cents", "line_total_ht_cents", "line_total_ttc_cents", "parent_id", "position", "pricing_status",
  "pu_ht_cents", "quantity", "snapshot_fo_ht_cents", "snapshot_gross_fo_ht_cents", "snapshot_gross_ht_cents",
  "snapshot_mo_atelier_ht_cents", "snapshot_mo_chantier_ht_cents", "snapshot_mo_ht_cents", "snapshot_pu_ht_cents",
  "supply_type_id", "tax_rate_bp", "title", "unit_code", "unit_price_ht_cents",
];

describe("F27-S01 à S05 charge de calcul 6 d'une v3 (D14)", () => {
  it("F27-S01 une v3 est scellée par la charge 6 ; la v2 garde la charge 4", () => {
    const { version, items } = frozenV3();
    expect((sealModule as Record<string, unknown>).ENGINE_V3_ESTIMATE_SEAL_PAYLOAD_VERSION).toBe(6);
    expect(CURRENT_ESTIMATE_SEAL_PAYLOAD_VERSION).toBe(4);
    const payload = buildCanonicalEstimateSealPayload({ version, items });
    expect(payload.meta).toEqual({ payload_version: 6, version_id: ID.version, tenant_id: ID.tenant, project_id: ID.project });
    expect(seal6(version, items, { payloadVersion: 6 })).toBe(computeEstimateSealHash(payload));
  });

  it("F27-S02 clés exactes : charge 4, plus coefficients, intention, montants, brut, récapitulatif et colonnes de ligne v3", () => {
    const { version, items, projection } = frozenV3();
    const payload = buildCanonicalEstimateSealPayload({ version, items });
    expect(Object.keys(payload.version).sort()).toEqual(PAYLOAD_6_VERSION_KEYS);
    for (const item of payload.items) expect(Object.keys(item).sort()).toEqual(PAYLOAD_6_ITEM_KEYS);
    expect(payload.version).toMatchObject({
      calc_engine_version: 3, sale_coefficient_fo: 1.3, sale_coefficient_mo: 1.2, discount_amount_cents: 101,
      discount_bp: 0, gross_ht_cents: 6_905_456, discount_applied_cents: 101, commercial_rounding_cents: 0,
      total_ht_cents: 6_905_355, total_tax_cents: 1_381_071, total_ttc_cents: 8_286_426, rounding_adjustment_cents: 0,
      contractor_role: "principal", tax_breakdown: projection.context.tax_breakdown,
    });
    const o1 = payload.items.find((item) => item.id === fixtureLineId(1)) as JsonObject;
    expect(o1).toMatchObject({
      unit_code: "ml", pricing_status: "priced", h_mo_per_unit: 1.991, h_mo_atelier_per_unit: null,
      h_mo_chantier_per_unit: null, snapshot_gross_ht_cents: 333_260, snapshot_gross_fo_ht_cents: 142_119,
      pu_ht_cents: 16_663, line_total_ht_cents: 333_255, tax_rate_bp: 2000,
    });
  });

  const versionMutations: Array<[string, (value: number) => unknown]> = [
    ["id", () => ID.other], ["tenant_id", () => ID.other], ["project_id", () => ID.other], ["version_number", (v) => v + 1],
    ["title", () => "Offre v3 bis"], ["exclusions", () => null], ["date_devis", () => "2026-10-18"],
    ["validite_jours", (v) => v + 1], ["currency", () => "USD"], ["total_ht_cents", (v) => v + 1],
    ["total_tax_cents", (v) => v + 1], ["total_ttc_cents", (v) => v + 1], ["rounding_adjustment_cents", () => 1],
    ["margin_multiplier", () => 1.01], ["margin_mode", () => "tiered"], ["discount_bp", () => 1],
    ["discount_amount_cents", (v) => v + 1], ["discount_mode", () => "cascade"], ["discount_steps", () => [100]],
    ["global_coefficient", () => 1.01], ["max_section_depth", (v) => v + 1], ["tax_rate_bp", () => 1000],
    ["rounding_mode", () => "down"], ["rounding_step_cents", () => 100], ["calc_snapshot_content_revision", (v) => v + 1],
    ["contractor_role", () => "subcontractor"], ["sale_coefficient_fo", () => 1.31], ["sale_coefficient_mo", () => 1.21],
    ["gross_ht_cents", (v) => v + 1], ["discount_applied_cents", (v) => v + 1], ["commercial_rounding_cents", () => 1],
    ["calc_snapshot_context.tax_breakdown.0.tax_cents", (v) => v + 1],
    ["calc_snapshot_context.tax_breakdown.0.base_cents", (v) => v + 1],
    ["calc_snapshot_context.tax_breakdown.0.rate_bp", () => 1000], ["calc_snapshot_context.discount.kind", () => "rate"],
    ["calc_snapshot_context.discount.applied_cents", (v) => v + 1],
    ["calc_snapshot_context.discount.requested_cents", (v) => v + 1],
    ["calc_snapshot_context.commercial_rounding.mode", () => "down"],
    ["calc_snapshot_context.commercial_rounding.step_cents", () => 100],
    ["calc_snapshot_context.cost_subtotal_cents", (v) => v + 1],
    ["calc_snapshot_context.realized_sale_coefficient", () => 1.25],
    ["calc_snapshot_context.sale_coefficients.fo", () => 1.31], ["calc_snapshot_context.labor_split_enabled", () => true],
    ["calc_snapshot_context.labor_roles", () => [{ id: ID.role, hourly_rate_cents: 4000 }]],
  ];
  it.each(versionMutations)("F27-S03 changer la version (%s) change l'empreinte de la charge 6", (field, next) => {
    const { version, items } = frozenV3();
    const original = seal6(version, items);
    const changed = copy(version);
    const before = getAt(changed, field);
    setAt(changed, field, next(before as number));
    expect(getAt(changed, field)).not.toEqual(before);
    expect(seal6(changed, items)).not.toBe(original);
  });

  const itemMutations: Array<[string, (value: number) => unknown]> = [
    ["id", () => fixtureLineId(99)], ["position", (v) => v + 10], ["item_type", () => "section"], ["title", () => "ARMY O1 bis"],
    ["quantity", (v) => v + 1], ["unit_price_ht_cents", (v) => v + 1], ["tax_rate_bp", () => 1000], ["k_fo", () => 1.01],
    ["h_mo", (v) => v + 1], ["h_mo_majoration", () => 1.1], ["k_mo", () => 1.1], ["supply_type_id", () => "supply-type-2"],
    ["pu_ht_cents", (v) => v + 1], ["line_total_ht_cents", (v) => v + 1], ["line_tax_cents", (v) => v + 1],
    ["line_total_ttc_cents", (v) => v + 1], ["line_nature", () => "supply_only"], ["parent_id", () => null],
    ["description", () => "DN20"], ["labor_role_id", () => ID.other], ["category_id", () => "category-2"],
    ["h_mo_atelier", () => 1], ["k_mo_atelier", () => 1], ["labor_role_atelier_id", () => ID.other],
    ["h_mo_chantier", () => 1], ["k_mo_chantier", () => 1], ["labor_role_chantier_id", () => ID.other],
    ["snapshot_pu_ht_cents", (v) => v + 1], ["snapshot_fo_ht_cents", (v) => v + 1], ["snapshot_mo_ht_cents", (v) => v + 1],
    ["snapshot_mo_atelier_ht_cents", (v) => v + 1], ["snapshot_mo_chantier_ht_cents", (v) => v + 1],
    ["unit_code", () => "u"], ["pricing_status", () => "included"], ["h_mo_per_unit", () => 2],
    ["h_mo_atelier_per_unit", () => 0.5], ["h_mo_chantier_per_unit", () => 0.5],
    ["snapshot_gross_ht_cents", (v) => v + 1], ["snapshot_gross_fo_ht_cents", (v) => v + 1],
  ];
  it.each(itemMutations)("F27-S03 changer une ligne (%s) change l'empreinte de la charge 6", (field, next) => {
    const { version, items } = frozenV3();
    const original = seal6(version, items);
    const changed = copy(items);
    const target = changed.find((item) => item.id === fixtureLineId(1)) as unknown as JsonObject;
    const before = target[field];
    target[field] = next(before as number);
    expect(target[field]).not.toEqual(before);
    expect(seal6(version, changed)).not.toBe(original);
  });

  it("F27-S03 changer une section (titre, position, parent) change l'empreinte", () => {
    const { version, items } = frozenV3();
    const original = seal6(version, items);
    for (const [field, value] of [["title", "ARMY sanitaires"], ["position", 5], ["parent_id", ID.other]] as const) {
      const changed = copy(items);
      (changed[0] as unknown as JsonObject)[field] = value;
      expect(seal6(version, changed)).not.toBe(original);
    }
  });

  it("F27-S04 ni l'ordre des lignes ni l'ordre des clés ni les horodatages ne changent l'empreinte", () => {
    const { version, items } = frozenV3();
    const original = seal6(version, items);
    expect(seal6(version, items)).toBe(original);
    expect(seal6(version, [...items].reverse())).toBe(original);
    const reversedKeys = (value: object) => Object.fromEntries(Object.entries(value).reverse());
    expect(seal6(reversedKeys(version) as SealVersion, items.map((item) => reversedKeys(item) as ItemRow))).toBe(original);
    const touched = copy(items).map((item) => ({ ...item, updated_at: "2026-10-18T09:00:00.000Z", created_at: "2026-10-18T09:00:00.000Z" }));
    expect(seal6({ ...version, seal_hash: "f".repeat(64) }, touched)).toBe(original);
  });

  it("F27-S05 une v3 n'est jamais scellée par une charge historique 1 à 4 (refus de 2.1 conservé)", () => {
    const { version, items } = frozenV3();
    for (const payloadVersion of [1, 2, 3, 4]) {
      expect(thrown(() => buildCanonicalEstimateSealPayload({ version, items }, { payloadVersion })))
        .toMatchObject({ code: "ESTIMATE_ENGINE_UNAVAILABLE", engineVersion: 3 });
    }
  });

  it("F27-S05 une v3 n'est scellée ni par le marqueur 5 ni par une charge inconnue", () => {
    const { version, items } = frozenV3();
    for (const payloadVersion of [5, 7]) {
      expect(thrown(() => buildCanonicalEstimateSealPayload({ version, items }, { payloadVersion })))
        .toMatchObject({ code: "ESTIMATE_SEAL_PAYLOAD_UNSUPPORTED" });
    }
  });

  it("F27-S05 une v1/v2 n'est jamais scellée par la charge 6", () => {
    const { version, items } = frozenV3();
    for (const calcEngineVersion of [1, 2]) {
      const historical = { ...version, calc_engine_version: calcEngineVersion, sale_coefficient_fo: null, sale_coefficient_mo: null,
        gross_ht_cents: null, discount_applied_cents: null, commercial_rounding_cents: null };
      expect(thrown(() => buildCanonicalEstimateSealPayload({ version: historical, items }, { payloadVersion: 6 })))
        .toMatchObject({ code: "ESTIMATE_SEAL_PAYLOAD_UNSUPPORTED" });
    }
  });
});

/* ---------- charges 1 à 4 figées sur le corpus figé (I1, I3) ---------- */

const corpus = JSON.parse(readFileSync(path.resolve(process.cwd(), FROZEN_CORPUS_PATH), "utf8")) as FrozenCorpusFile;

function tabulated(rows: unknown[][], columns: readonly string[]): Map<string, JsonObject> {
  return new Map(rows.map(([id, ...values]) => [id as string, Object.fromEntries(columns.map((column, index) => [column, values[index]]))]));
}

/** Une version scellable par ligne de corpus : entrées du corpus, sorties figées du corpus. */
function corpusSealSource(entry: FrozenCorpusCase, index: number): { version: EstimateSealVersionFields; items: ItemRow[] } {
  const normalized = tabulated(entry.output.normalizedLines, FROZEN_CORPUS_COLUMNS.normalizedLine);
  const projected = entry.output.projection && "items" in entry.output.projection
    ? tabulated(entry.output.projection.items.map((values) => values), FROZEN_CORPUS_COLUMNS.projectionLine.slice(1))
    : null;
  const items = entry.input.items.map((cells) => {
    const input = Object.fromEntries(FROZEN_CORPUS_COLUMNS.item.map((column, position) => [column, cells[position]]));
    const id = input.id as string;
    const line = input.item_type === "line";
    const stored = { ...(normalized.get(id) ?? {}), ...(projected?.get(id) ?? {}) };
    return baseItem({
      ...(input as Partial<ItemRow>), ...(line ? (stored as Partial<ItemRow>) : {}),
      version_id: `version-${entry.id}`, tenant_id: "tenant-frozen-corpus", title: `Corpus ${id}`,
      description: line ? "u" : null, line_nature: line ? (Number(input.h_mo) > 0 ? "supply_and_labor" : "supply_only") : null,
      pricing_status: "priced",
    });
  });
  const projection = entry.output.projection && "totals" in entry.output.projection ? entry.output.projection.totals : null;
  const readOnly = entry.output.readOnlyTotals;
  const settings = entry.input.version;
  return {
    version: {
      id: `version-${entry.id}`, tenant_id: "tenant-frozen-corpus", project_id: "project-frozen-corpus",
      version_number: (index % 7) + 1, title: `Corpus ${entry.id}`, exclusions: index % 3 === 0 ? null : "Hors peinture",
      date_devis: "2026-10-16", validite_jours: 30, currency: "EUR",
      total_ht_cents: projection?.total_ht_cents ?? readOnly?.saleTotalCents ?? 0,
      total_tax_cents: projection?.total_tax_cents ?? readOnly?.adjustedTaxCents ?? 0,
      total_ttc_cents: projection?.total_ttc_cents ?? readOnly?.roundedTtcCents ?? 0,
      rounding_adjustment_cents: projection?.rounding_adjustment_cents ?? readOnly?.roundingAdjustmentCents ?? 0,
      margin_multiplier: settings.margin_multiplier, margin_mode: settings.margin_mode, discount_bp: settings.discount_bp,
      discount_amount_cents: settings.discount_amount_cents, discount_mode: settings.discount_mode,
      discount_steps: (settings.discount_steps ?? []) as number[], global_coefficient: settings.global_coefficient,
      max_section_depth: 4, tax_rate_bp: settings.tax_rate_bp, rounding_mode: settings.rounding_mode,
      rounding_step_cents: settings.rounding_step_cents, calc_engine_version: entry.engine,
      calc_snapshot_content_revision: entry.engine === 2 ? 1 : null,
      calc_snapshot_context: entry.engine === 2 ? { labor_split_enabled: entry.input.isLaborSplitEnabled } : null,
      contractor_role: entry.input.vatReverseCharge ? "subcontractor" : "principal", seal_hash: null,
    },
    items,
  };
}

const HISTORICAL_PAYLOADS: Array<[string, Parameters<typeof buildCanonicalEstimateSealPayload>[1]]> = [
  ["charge 1 sans moteur", { payloadVersion: 1, includeCalcEngineVersion: false }],
  ["charge 1 sans moteur ni ventilation", { payloadVersion: 1, includeCalcEngineVersion: false, includeLaborSplit: false }],
  ["charge 1 avec moteur", { payloadVersion: 1 }],
  ["charge 2", { payloadVersion: 2 }],
  ["charge 3", { payloadVersion: 3 }],
  ["charge 4", { payloadVersion: 4 }],
  ["charge par défaut (v1 → 2, v2 → 4)", undefined],
];
/** SHA-256 des 600 lignes `<cas>:<sha de la charge>`, relevés sur `c14b243d` avant toute modification. */
const FROZEN_HISTORICAL_SEALS: Record<string, string> = {
  "charge 1 sans moteur": "82c18e5dfcdf71a1d01320973a649c8e94a74036109084b4edae0e6f9ed624b3",
  "charge 1 sans moteur ni ventilation": "3fd2804dc41b3be8e9d5f344494938421dc74ff057cfed89f52275ec0f590695",
  "charge 1 avec moteur": "ccb1056c3719bf849f3495d3e37cad674d48ceff52912061b969558c9f7e0495",
  "charge 2": "6c2384d83daa5230d9280b72f9062225ed18d0c54a99d4848ffeb1c35cab1d16",
  "charge 3": "bd8339b1da8a0ab96acc23de05f4079aafacf977739b8b91c5e71f511835491e",
  "charge 4": "60d36fb8eceb95983050fef5e4de62fcea7857d7b84c9c00e7bc1414224c037b",
  "charge par défaut (v1 → 2, v2 → 4)": "d8a3de5c8c998e4d773e8e3065f2833ce5f89df07940da10d710f7ae91bbfa88",
};

describe("F27-S06 charges 1 à 4 identiques à l'octet sur le corpus figé (600 devis v1/v2)", () => {
  it("le corpus porte 300 v1 et 300 v2", () => {
    expect(corpus.cases.filter((entry) => entry.engine === 1)).toHaveLength(300);
    expect(corpus.cases.filter((entry) => entry.engine === 2)).toHaveLength(300);
  });
  it.each(HISTORICAL_PAYLOADS)("%s", (label, options) => {
    const lines = corpus.cases.map((entry, index) => {
      const payload = buildCanonicalEstimateSealPayload(corpusSealSource(entry, index), options);
      return `${entry.id}:${computeEstimateSealHash(payload)}`;
    });
    expect(lines).toHaveLength(600);
    expect(new Set(lines.map((line) => line.split(":")[1])).size, "600 charges distinctes, harnais non dégénéré").toBe(600);
    expect(sha(lines.join("\n"))).toBe(FROZEN_HISTORICAL_SEALS[label]);
  });
});

/* ---------- marqueur 5 : enveloppe d'offre inchangée (contrat 1) et contrat 2 sous charge 6 ---------- */

function layout(priceMode = "unit_and_total") {
  return { preset: "client_detailed", detailLevel: "lines", priceMode, density: "standard",
    showNumbering: true, showSectionSubtotals: true, conditionsPlacement: "auto", includeTerms: false };
}
function proof(captured: unknown, clientContractVersion: number) {
  return {
    proofVersion: 1, documentId: ID.document, tenantId: ID.tenant, versionId: ID.version, projectId: ID.project,
    status: "ready", filePath: `${ID.tenant}/${ID.project}/${ID.version}/${PDF_HASH}.pdf`, sha256Hash: PDF_HASH,
    fileSizeBytes: 4321, generatedAt: "2026-10-17T12:00:00.123456Z", generatedBy: ID.actor,
    publishedGenerationToken: ID.claim, publishedPurpose: "email", publishedDispatchId: ID.dispatch,
    publishedContentRevision: 9, clientContractVersion, clientContractSnapshot: copy(captured),
    layoutOptions: layout(), termsSnapshot: null,
  };
}
const identity = {
  project: { name: "ARMY v3 project", reference: "ARMY-L2-27", estimateReference: "ARMY-L2-27_V3", clientName: "ARMY client", siteAddress: null },
  issuer: { userId: ID.actor, displayName: "ARMY actor", displayRole: null, phone: null, email: null },
  company: {
    name: "ARMY COMPANY", tagline: "Synthetic test company",
    address: { street: "ARMY street", postalCode: "75001", city: "Paris" },
    registeredOffice: { street: "ARMY office", postalCode: "75002", city: "Paris" },
    phone: { landline: "+33 1 00 00 00 02", mobile: "+33 6 00 00 00 03" }, legal: { siret: "ARMY-FIXTURE", vat: "ARMY-VAT" },
  },
};
const contractVersion = { id: ID.version, tenantId: ID.tenant, projectId: ID.project, number: 3, contentRevision: 9,
  dateDevis: "2026-10-17", validiteJours: 30, currency: "EUR", contractorRole: "principal", taxRateBp: 2000 };
function contract1() {
  return {
    schemaVersion: 1, version: { ...contractVersion, calcEngineVersion: 2 }, ...copy(identity),
    rows: [{ kind: "line", id: fixtureLineId(1), parentId: null, position: 0, depth: 0, title: "ARMY line", quantity: 2,
      unit: "u", unitSaleHtCents: 5000, saleHtCents: 10_000 }],
    totals: { saleHtCents: 10_000, taxCents: 2000, calculatedTtcCents: 12_000, payableTtcCents: 12_000, roundingAdjustmentCents: 0 },
    exclusions: null,
  };
}
/** Contrat 2 de la v3 figée : une section, sept lignes brutes, pied S2. */
function contract2() {
  const { projection } = frozenV3();
  const lines = projection.items.map((snapshot, index) => ({
    kind: "line", id: snapshot.id, parentId: ID.section, position: index, depth: 1, title: `ARMY ${ORACLE_LINES[index].ref}`,
    quantity: Number(ORACLE_LINES[index].quantity), unitCode: UNIT_CODES[index], unitLabel: UNIT_LABELS[UNIT_CODES[index]],
    pricingStatus: "priced", taxRateBp: 2000, unitSaleHtCents: snapshot.pu_ht_cents, saleHtCents: snapshot.snapshot_gross_ht_cents,
  }));
  const totals = projection.version;
  return {
    schemaVersion: 2, version: { ...contractVersion, calcEngineVersion: 3 }, ...copy(identity),
    rows: [{ kind: "section", id: ID.section, parentId: null, position: 0, depth: 0, number: "01", title: "ARMY réseaux",
      saleHtCents: totals.gross_ht_cents }, ...lines],
    totals: {
      grossHtCents: totals.gross_ht_cents, commercialDiscountCents: totals.discount_applied_cents,
      discountIntent: { kind: "amount" }, commercialRoundingCents: totals.commercial_rounding_cents, netHtCents: totals.total_ht_cents,
      taxByRate: projection.context.tax_breakdown.map((entry) => ({ rateBp: entry.rate_bp, baseHtCents: entry.base_cents, taxCents: entry.tax_cents })),
      taxCents: totals.total_tax_cents, payableTtcCents: totals.total_ttc_cents, reverseCharge: false,
    },
    exclusions: "Hors peinture",
  };
}
/** Relevé sur `c14b243d` : enveloppe 5 (calcul en charge 4) du contrat 1 ci-dessus. */
const FROZEN_CONTRACT1_SEAL5 = "2b4ae8ab17ef9cd78af29293e61bff0875109d2751998365b03980e23c8a107e";

describe("F27-S07 marqueur 5 du contrat 1 inchangé", () => {
  it("même empreinte d'offre qu'avant 2.7, enveloppe calculée en charge 4", () => {
    const captured = contract1();
    const published = proof(captured, 1);
    const envelope = {
      meta: { payloadVersion: 5, versionId: ID.version, tenantId: ID.tenant, projectId: ID.project, contentRevision: 9, calcEngineVersion: 2 },
      calculation: { payloadVersion: 4, sha256: CALCULATION_HASH },
      clientContract: captured,
      document: { sha256Hash: PDF_HASH, layoutOptions: published.layoutOptions, termsSnapshot: null },
    };
    const hash = computeOfferSealHash({ calculationHash: CALCULATION_HASH, snapshot: captured, documentProof: published });
    expect(hash).toBe(sha(JSON.stringify(canonical(envelope))));
    expect(hash).toBe(FROZEN_CONTRACT1_SEAL5);
  });
  it("l'enveloppe du contrat 1 refuse une copie de contrat 2", () => {
    const captured = contract2();
    expect(thrown(() => computeOfferSealHash({ calculationHash: CALCULATION_HASH, snapshot: captured, documentProof: proof(captured, 2) })))
      .toMatchObject({ code: "OFFER_SEAL_INPUT_INVALID" });
  });
});

type SealV2API = {
  computeOfferSealHashV2: (input: { calculationHash: string; snapshot: unknown; documentProof: unknown }, options?: { allowDevelopmentTerms?: boolean }) => string;
};
const MODULE = path.resolve(process.cwd(), "src/lib/estimates/offer-contract-v2.ts");
let v2: SealV2API;

describe("F27-S08 marqueur 5 d'une v3 : contrat 2 lié à la charge 6 (F1, F2)", () => {
  // Chaque cas échoue seul (et non « ignoré ») tant que le module manque.
  beforeAll(async () => {
    if (existsSync(MODULE)) v2 = await import(/* @vite-ignore */ MODULE) as SealV2API;
  });
  beforeEach(() => {
    if (!v2) throw new Error("MISSING_PRECONDITION: src/lib/estimates/offer-contract-v2.ts absent (contrat client 2 non livré).");
    expect(typeof v2.computeOfferSealHashV2).toBe("function");
  });

  it("enveloppe exacte : marqueur 5, moteur 3, calcul en charge 6, copie de contrat 2", () => {
    const captured = contract2();
    const published = proof(captured, 2);
    const envelope = {
      meta: { payloadVersion: 5, versionId: ID.version, tenantId: ID.tenant, projectId: ID.project, contentRevision: 9, calcEngineVersion: 3 },
      calculation: { payloadVersion: 6, sha256: CALCULATION_HASH },
      clientContract: captured,
      document: { sha256Hash: PDF_HASH, layoutOptions: published.layoutOptions, termsSnapshot: null },
    };
    const reversed = (value: unknown): unknown => Array.isArray(value) ? value.map(reversed)
      : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reversed(child)])) : value;
    const expected = sha(JSON.stringify(canonical(envelope)));
    expect(v2.computeOfferSealHashV2({ calculationHash: CALCULATION_HASH, snapshot: captured, documentProof: published })).toBe(expected);
    expect(v2.computeOfferSealHashV2({ calculationHash: CALCULATION_HASH, snapshot: reversed(captured), documentProof: reversed(published) })).toBe(expected);
  });

  it("le sceau d'offre suit la charge 6 : changer une colonne v3 de ligne change le sceau final", () => {
    const { version, items } = frozenV3();
    const captured = contract2();
    const sealOf = (rows: ItemRow[]) => v2.computeOfferSealHashV2({
      calculationHash: seal6(version, rows), snapshot: captured, documentProof: proof(captured, 2),
    });
    const changed = copy(items);
    changed[1].h_mo_per_unit = 1.992;
    expect(sealOf(changed)).not.toBe(sealOf(items));
  });

  it("lie la copie : titre, unité, TVA d'un taux ou PDF changés changent le sceau", () => {
    const captured = contract2();
    const original = v2.computeOfferSealHashV2({ calculationHash: CALCULATION_HASH, snapshot: captured, documentProof: proof(captured, 2) });
    const title = contract2(); setAt(title, "rows.1.title", "ARMY O1 bis");
    const unit = contract2(); setAt(unit, "rows.1.unitLabel", "mètre linéaire");
    for (const changed of [title, unit]) {
      expect(v2.computeOfferSealHashV2({ calculationHash: CALCULATION_HASH, snapshot: changed, documentProof: proof(changed, 2) })).not.toBe(original);
    }
    const pdf = proof(captured, 2); pdf.sha256Hash = "b".repeat(64);
    pdf.filePath = `${ID.tenant}/${ID.project}/${ID.version}/${pdf.sha256Hash}.pdf`;
    expect(v2.computeOfferSealHashV2({ calculationHash: CALCULATION_HASH, snapshot: captured, documentProof: pdf })).not.toBe(original);
  });

  it("refuse une copie différente de la preuve, un contrat 1, une preuve au marqueur 1 et un calcul mal formé", () => {
    const captured = contract2();
    const drift = contract2(); setAt(drift, "rows.1.title", "ARMY O1 bis");
    const cases: Array<{ calculationHash: string; snapshot: unknown; documentProof: unknown }> = [
      { calculationHash: CALCULATION_HASH, snapshot: drift, documentProof: proof(captured, 2) },
      { calculationHash: CALCULATION_HASH, snapshot: contract1(), documentProof: proof(contract1(), 1) },
      { calculationHash: CALCULATION_HASH, snapshot: captured, documentProof: proof(contract1(), 1) },
      { calculationHash: "C".repeat(64), snapshot: captured, documentProof: proof(captured, 2) },
      { calculationHash: "0".repeat(63), snapshot: captured, documentProof: proof(captured, 2) },
    ];
    for (const input of cases) {
      expect(thrown(() => v2.computeOfferSealHashV2(input))).toMatchObject({ code: "OFFER_SEAL_INPUT_INVALID" });
    }
  });
});
