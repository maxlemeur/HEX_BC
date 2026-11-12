import { describe, expect, it } from "vitest";

import { buildEstimateReading, type EstimateReadingSource } from "@/lib/assistant/estimate-reading-build";

type Version = EstimateReadingSource["version"];
type Item = EstimateReadingSource["items"][number];
type V3Calculation = Extract<EstimateReadingSource["calculation"], { kind: "v3" }>;
type V2Calculation = Extract<EstimateReadingSource["calculation"], { kind: "v2" }>;

const version = (overrides: Partial<Version> = {}) => ({
  id: "v-1", version_number: 2, variant_label: null, title: "Chaufferie", status: "draft", calc_engine_version: 3,
  total_ht_cents: 0, total_tax_cents: 0, total_ttc_cents: 0, gross_ht_cents: null, discount_applied_cents: null,
  commercial_rounding_cents: null, sale_coefficient_fo: 1.25, sale_coefficient_mo: 1.4, global_coefficient: null,
  margin_multiplier: null, ...overrides,
}) as Version;

const item = (overrides: Partial<Item>) => ({
  id: "l-1", item_type: "line", parent_id: null, title: "Radiateur", description: null, position: 1, quantity: 10,
  unit_code: "u", pricing_status: "priced", unit_price_ht_cents: 8_000, k_fo: 1, fo_provision: null, h_mo_per_unit: 0.5,
  h_mo: null, k_mo: 1, tax_rate_bp: 2000, pu_ht_cents: null, line_total_ht_cents: null, snapshot_gross_ht_cents: null,
  snapshot_gross_fo_ht_cents: null, snapshot_fo_ht_cents: null, snapshot_mo_ht_cents: null, source_provider: null,
  source_file_name: null, source_page: null, fo_price_origin: null, product_id: null, ...overrides,
}) as Item;

const v3Line = (overrides: Partial<V3Calculation["breakdown"]["lines"][number]>) => ({
  id: "l-1", pu_ht_cents: 10_000, gross_ht_cents: 100_000, gross_fo_ht_cents: 60_000, gross_mo_ht_cents: 40_000,
  cost_ht_cents: 70_000, line_total_ht_cents: 95_000, h_mo: "5.000", pricing_status: "priced", ...overrides,
}) as V3Calculation["breakdown"]["lines"][number];

const v3 = (lines: V3Calculation["breakdown"]["lines"], warnings: V3Calculation["breakdown"]["warnings"] = []): V3Calculation => ({
  kind: "v3",
  breakdown: {
    lines, warnings,
    params: { sale_coefficient_fo: "1.2500", sale_coefficient_mo: "1.4000", reverse_charge: false },
    totals: {
      gross_ht_cents: 100_000, discount_applied_cents: 5_000, commercial_rounding_cents: 0, total_ht_cents: 95_000,
      total_tax_cents: 19_000, total_ttc_cents: 114_000, cost_subtotal_cents: 70_000, realized_sale_coefficient: "1.357143",
    },
    commercial_rounding: { mode: "none" },
  } as V3Calculation["breakdown"],
});

describe("estimate reading built from the engines", () => {
  it("shows an engine 3 draft line at its total before the discount, and keeps the net apart", () => {
    const reading = buildEstimateReading({ version: version(), items: [item({})], calculation: v3([v3Line({})]) });
    expect(reading.nodes[0]?.line?.amounts).toEqual({
      puHtCents: 10_000, totalHtCents: 100_000, netHtCents: 95_000, costHtCents: 70_000, foHtCents: 60_000,
      moHtCents: 40_000, hours: "5.000",
    });
    expect(reading.totals).toEqual({
      grossHtCents: 100_000, discountCents: 5_000, roundingCents: 0, totalHtCents: 95_000, totalTaxCents: 19_000,
      totalTtcCents: 114_000, costHtCents: 70_000,
    });
    expect(reading.version).toMatchObject({ label: "V2", engine: 3, amountsBasis: "draft_calculation" });
  });

  it("gives no amount to a line that is not priced, and warns only about the ones left « Non chiffrée »", () => {
    const reading = buildEstimateReading({
      version: version(),
      items: [
        item({}), item({ id: "l-inclus", pricing_status: "included" }), item({ id: "l-non-chiffree", pricing_status: "not_priced" }),
      ],
      calculation: v3(
        [v3Line({}), v3Line({ id: "l-inclus", pricing_status: "included", gross_ht_cents: 0, line_total_ht_cents: 0 }),
          v3Line({ id: "l-non-chiffree", pricing_status: "not_priced", gross_ht_cents: 0, line_total_ht_cents: 0 })],
        [{ code: "ESTIMATE_V3_LINE_NOT_PRICED", line_id: "l-inclus", pricing_status: "included" },
          { code: "ESTIMATE_V3_LINE_NOT_PRICED", line_id: "l-non-chiffree", pricing_status: "not_priced" },
          { code: "ESTIMATE_V3_LABOR_RATE_MISSING", line_id: "l-1" }],
      ),
    });
    expect(reading.nodes.map((node) => node.line?.amounts === null)).toEqual([false, true, true]);
    expect(reading.warnings).toEqual([
      "1 ligne(s) « Non chiffrée » : elles ne comptent pas dans le total.",
      "1 ligne(s) portent des heures sans taux horaire de main-d’œuvre.",
    ]);
  });

  it("reads an issued engine 3 version on its frozen amounts, with the same meaning as a draft", () => {
    const reading = buildEstimateReading({
      version: version({
        status: "sent", total_ht_cents: 95_000, total_tax_cents: 19_000, total_ttc_cents: 114_000, gross_ht_cents: 100_000,
        discount_applied_cents: 5_000, commercial_rounding_cents: 0,
      }),
      items: [
        item({
          pu_ht_cents: 10_000, line_total_ht_cents: 95_000, snapshot_gross_ht_cents: 100_000, snapshot_gross_fo_ht_cents: 60_000,
          snapshot_fo_ht_cents: 57_000, snapshot_mo_ht_cents: 38_000, h_mo: 5,
        }),
        item({ id: "l-pm", pricing_status: "for_memory", line_total_ht_cents: 0, snapshot_gross_ht_cents: 0 }),
      ],
      calculation: { kind: "frozen" },
    });
    expect(reading.nodes[0]?.line?.amounts).toEqual({
      puHtCents: 10_000, totalHtCents: 100_000, netHtCents: 95_000, costHtCents: null, foHtCents: 60_000, moHtCents: 40_000,
      hours: "5",
    });
    // A line at zero because of its status is not a priced line worth 0,00 €.
    expect(reading.nodes[1]?.line?.amounts).toBeNull();
    expect(reading.totals).toMatchObject({ grossHtCents: 100_000, discountCents: 5_000, totalHtCents: 95_000, costHtCents: null });
    expect(reading.version.amountsBasis).toBe("frozen");
  });

  it("shows no amount at all, and says why, when the engine refuses the draft", () => {
    const reading = buildEstimateReading({
      version: version({ total_ht_cents: 123_456 }), items: [item({ pu_ht_cents: 9_999, line_total_ht_cents: 99_990 })],
      calculation: { kind: "refused", message: "Une unité est requise sur chaque ligne chiffrée." },
    });
    // Never the stored amounts of an earlier state of the draft.
    expect(reading.totals.totalHtCents).toBeNull();
    expect(reading.nodes[0]?.line?.amounts).toBeNull();
    expect(reading.warnings).toEqual(["Le brouillon ne peut pas être calculé en l’état : Une unité est requise sur chaque ligne chiffrée."]);
  });

  it("reads the older engines as they store a line: unit in the description, hours entered on the line", () => {
    const calculation: V2Calculation = {
      kind: "v2",
      breakdown: {
        lineById: new Map([["l-1", {
          costLineCents: 3_000, saleNetHtCents: 3_750, puNetHtCents: 1_250, foNetCents: 3_750, moNetCents: 0,
        }]]),
        totals: {
          saleTotalCents: 3_750, adjustedTaxCents: 750, roundedTtcCents: 4_500, costSubtotalCents: 3_000, discountCents: 0,
          globalCoefficient: 1, appliedMarginMultiplier: 1.25, discountMode: "simple",
        },
      } as unknown as V2Calculation["breakdown"],
    };
    const reading = buildEstimateReading({
      version: version({ calc_engine_version: 2 }),
      items: [item({ quantity: 3, unit_code: null, description: "ml", h_mo: 1.5 })], calculation,
    });
    const read = reading.nodes[0]?.line;
    expect(read).toMatchObject({ unit: "ml", description: null, foCostText: null, inputs: { hMo: 1.5 } });
    expect(read?.amounts).toMatchObject({ puHtCents: 1_250, totalHtCents: 3_750, netHtCents: 3_750, costHtCents: 3_000 });
    expect(reading.totals).toMatchObject({ totalHtCents: 3_750, totalTtcCents: 4_500, grossHtCents: null });
  });
});
