import { describe, expect, it } from "vitest";
import { computeEstimateV3Breakdown } from "@/lib/estimates/engine-v3";
import { v3Input, v3Line } from "@/lib/estimates/engine-v3/oracle.fixtures";
import { foCostDetail } from "./fo-cost-detail";

// TI-541. Isolated: the detail shown on a line is arithmetic that must equal the engine to the cent on values
// no journey can enumerate (half cents, three factors). Expected amounts are written by hand from the ticket:
// reference 10 EUR/m, volume 0.90, provision 1.01 (fitting) gives 9.09 EUR/m, provision 1.03 (tube) gives 9.27 EUR/m.
describe("TI-541 supply cost detail of a line", () => {
  const siteOrigin = { selection_id: "54100000-0000-4000-8000-000000000001", kind: "site",
    source_id: "54100000-0000-4000-8000-000000000001", transport_mode: null,
    site: { supplier: "Négoce Fictif", offer_reference: "OF-2611-07", offer_date: "2026-11-03", document: null } };

  it("writes the ticket's two examples to the cent", () => {
    const fitting = foCostDetail({ unit_price_ht_cents: 1000, k_fo: 0.9, fo_provision: 1.01 }, { saleCoefficientFo: "1.3" });
    expect(fitting).toMatchObject({ baseLabel: "Saisie manuelle", baseCents: 1000, costUnitCents: 909, saleUnitCents: 1182 });
    expect(fitting.text).toBe("Saisie manuelle 10,00 € × provision FO 1,01 × K FO 0,9 = 9,09 € de coût FO ; × coef. de vente FO 1,3 = 11,82 €");
    const tube = foCostDetail({ unit_price_ht_cents: 1000, k_fo: 0.9, fo_provision: 1.03 }, { saleCoefficientFo: 1 });
    expect(tube).toMatchObject({ costUnitCents: 927, saleUnitCents: 927 });
  });
  it("names a site cost with its source and never the catalogue", () => {
    const detail = foCostDetail({ unit_price_ht_cents: 900, k_fo: 1, fo_provision: 1.01, product_id: "product", fo_price_origin: siteOrigin },
      { saleCoefficientFo: 1 });
    expect(detail.baseLabel).toBe("Coût chantier");
    expect(detail.source).toBe("Négoce Fictif · offre OF-2611-07 · 03/11/2026");
    expect(detail.text).toBe("Coût chantier 9,00 € × provision FO 1,01 × K FO 1 = 9,09 € de coût FO ; × coef. de vente FO 1 = 9,09 €");
  });
  it("equals the engine on a supply-only line, half cents included", () => {
    for (const [price, kFo, provision, sale] of [[14243, "1", "1.01", "1"], [17550, "1", "1.01", "1"], [1000, "0.9", "1.03", "1.3"],
      [333, "1.115", "1.005", "1.27"], [1, "9.999", "1.03", "9.9"]] as const) {
      const [line] = computeEstimateV3Breakdown(v3Input([v3Line(1, { unit_price_ht_cents: price, k_fo: kFo, fo_provision: provision })],
        { sale_coefficient_fo: sale })).lines;
      expect(foCostDetail({ unit_price_ht_cents: price, k_fo: kFo, fo_provision: provision }, { saleCoefficientFo: sale }).saleUnitCents)
        .toBe(line.pu_ht_cents);
    }
  });
  it("stops at the supply cost when the sale coefficient of the quote is not known, instead of inventing 1", () => {
    const detail = foCostDetail({ unit_price_ht_cents: 900, k_fo: 1, fo_provision: 1.01 }, { saleCoefficientFo: null });
    expect(detail).toMatchObject({ costUnitCents: 909, saleUnitCents: null });
    expect(detail.text).toBe("Saisie manuelle 9,00 € × provision FO 1,01 × K FO 1 = 9,09 € de coût FO");
    expect(foCostDetail({ unit_price_ht_cents: 900 }, {}).saleUnitCents).toBeNull();
  });
  it("reads an absent K FO or provision as 1 like the engine, an absent cost as 0, and leaves a provision of 1 out of the sentence", () => {
    expect(foCostDetail({}, { saleCoefficientFo: 1 })).toMatchObject({ baseCents: 0, costUnitCents: 0, saleUnitCents: 0 });
    expect(foCostDetail({ unit_price_ht_cents: 1754970, k_fo: "1.13", fo_provision: 1 }, { saleCoefficientFo: 1 }).text)
      .toBe("Saisie manuelle 17 549,70 € × K FO 1,13 = 19 831,16 € de coût FO ; × coef. de vente FO 1 = 19 831,16 €");
  });
});
