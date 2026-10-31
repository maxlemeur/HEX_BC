import { describe, expect, it } from "vitest";

import { planPriceReuseOperations, PriceReusePlanError, type PriceReuseItem } from "@/lib/estimates/price-reuse-plan";

/*
 * Ways the plan that turns confirmed matches into writer updates can fail, written before the plan (AGENTS.md):
 * 1. It copies more than the price: quantity (the métré), title, unit, VAT or category of the reference overwrite the line.
 * 2. It copies less than the price: a missing input (supply type, K FO, hours per unit of one split, majoration,
 *    labour role, line nature) gives another sale price than the reference.
 * 3. A reference labour role of another owner is written as is: the writer refuses it (`labor_role_id invalide`), or
 *    a role of the wrong trade is picked. It must be mapped by name to the target owner's role, or refused by name.
 * 4. A price per m² is written on a line in ml (units changed since the comparison).
 * 5. An unpriced reference line, a section, or a line of another version becomes a source; a section becomes a target.
 * 6. Two selections for the same line write twice, or the last one wins silently.
 * 7. A line that already carries exactly the reference price produces a needless write.
 * 8. A reference line left « priced » at 0 € without hours (an unfilled line) becomes a price source.
 * 9. A supplier offer retained on the line stays attached while its FO price becomes the reference's.
 * 10. Two target roles of the same name: one is picked silently.
 */

const ROLE_REF = "11111111-1111-4111-8111-111111111111";
const ROLE_REF_CAL = "22222222-2222-4222-8222-222222222222";
const ROLE_TARGET = "33333333-3333-4333-8333-333333333333";
const ROLE_TARGET_CAL = "44444444-4444-4444-8444-444444444444";
const SUPPLY_TUBE = "55555555-5555-4555-8555-555555555555";

const line = (id: string, patch: Partial<PriceReuseItem> = {}): PriceReuseItem => ({
  id, item_type: "line", title: id, unit_code: "u", pricing_status: "priced", line_nature: "supply_only",
  unit_price_ht_cents: 0, supply_type_id: null, k_fo: 1, h_mo_per_unit: null, h_mo_atelier_per_unit: null,
  h_mo_chantier_per_unit: null, h_mo_majoration: 1, k_mo: 1, k_mo_atelier: null, k_mo_chantier: null,
  labor_role_id: null, labor_role_atelier_id: null, labor_role_chantier_id: null, selected_supplier_price_id: null, ...patch,
});
const referenceLine = line("ref", {
  title: "Tube cuivre Ø22x1", unit_code: "ml", line_nature: "supply_and_labor", unit_price_ht_cents: 1250,
  supply_type_id: SUPPLY_TUBE, k_fo: 1.1, h_mo_per_unit: 0.35, h_mo_atelier_per_unit: 0.1, h_mo_chantier_per_unit: 0.25,
  h_mo_majoration: 1.05, k_mo: 1.2, k_mo_atelier: 1.3, k_mo_chantier: 1.4, labor_role_id: ROLE_REF,
  labor_role_atelier_id: ROLE_REF_CAL, labor_role_chantier_id: ROLE_REF,
});
const targetLine = line("target", { title: "Tube cuivre diam. 22 x 1", unit_code: "ml", pricing_status: "not_priced" });
const roles = {
  referenceRoles: [{ id: ROLE_REF, name: "Tuyauteur" }, { id: ROLE_REF_CAL, name: "Calorifugeur" }],
  targetRoles: [{ id: ROLE_TARGET, name: "tuyauteur " }, { id: ROLE_TARGET_CAL, name: "CALORIFUGEUR" }],
};
const plan = (input: Partial<Parameters<typeof planPriceReuseOperations>[0]> = {}) => planPriceReuseOperations({
  targets: [targetLine], references: [referenceLine], selections: [{ line_id: "target", reference_line_id: "ref" }],
  ...roles, ...input,
});
const refusal = (run: () => unknown) => {
  try { run(); } catch (error) {
    if (error instanceof PriceReusePlanError) return { code: error.code, message: error.message };
    throw error;
  }
  throw new Error("The plan was expected to refuse.");
};

describe("price reuse write plan", () => {
  it("copies every price input of the reference and nothing of the métré", () => {
    expect(plan()).toEqual({
      unchanged: [],
      operations: [{ op: "update", id: "target", data: {
        line_nature: "supply_and_labor", pricing_status: "priced", unit_price_ht_cents: 1250, supply_type_id: SUPPLY_TUBE,
        k_fo: 1.1, h_mo_per_unit: 0.35, h_mo_atelier_per_unit: 0.1, h_mo_chantier_per_unit: 0.25, h_mo_majoration: 1.05,
        k_mo: 1.2, k_mo_atelier: 1.3, k_mo_chantier: 1.4,
        labor_role_id: ROLE_TARGET, labor_role_atelier_id: ROLE_TARGET_CAL, labor_role_chantier_id: ROLE_TARGET,
      } }],
    });
  });

  it("keeps a role id the target owner already has", () => {
    const shared = plan({ targetRoles: [...roles.targetRoles, { id: ROLE_REF, name: "Tuyauteur" }, { id: ROLE_REF_CAL, name: "Calorifugeur" }] });
    expect(shared.operations[0].data).toMatchObject({ labor_role_id: ROLE_REF, labor_role_atelier_id: ROLE_REF_CAL });
  });

  it("refuses, naming the line and the role, when the target owner has no role of that name", () => {
    expect(refusal(() => plan({ targetRoles: [{ id: ROLE_TARGET, name: "Tuyauteur" }] }))).toEqual({
      code: "PRICE_REUSE_LABOR_ROLE_MISSING",
      message: expect.stringMatching(/« Tube cuivre diam\. 22 x 1 ».*« Calorifugeur »/),
    });
  });

  it("refuses a unit that no longer matches, or a line without unit", () => {
    expect(refusal(() => plan({ targets: [{ ...targetLine, unit_code: "m2" }] })).code).toBe("PRICE_REUSE_UNIT_MISMATCH");
    expect(refusal(() => plan({ targets: [{ ...targetLine, unit_code: null }] })).code).toBe("PRICE_REUSE_UNIT_MISMATCH");
  });

  it("refuses sources that do not carry a price and targets that are not lines of the version", () => {
    expect(refusal(() => plan({ references: [{ ...referenceLine, pricing_status: "included" }] })).code)
      .toBe("PRICE_REUSE_REFERENCE_NOT_PRICED");
    expect(refusal(() => plan({ references: [{ ...referenceLine, item_type: "section" }] })).code)
      .toBe("PRICE_REUSE_REFERENCE_NOT_PRICED");
    expect(refusal(() => plan({ selections: [{ line_id: "target", reference_line_id: "unknown" }] })).code)
      .toBe("PRICE_REUSE_REFERENCE_NOT_FOUND");
    expect(refusal(() => plan({ targets: [{ ...targetLine, item_type: "section" }] })).code).toBe("PRICE_REUSE_LINE_NOT_FOUND");
    expect(refusal(() => plan({ selections: [{ line_id: "other", reference_line_id: "ref" }] })).code)
      .toBe("PRICE_REUSE_LINE_NOT_FOUND");
  });

  it("refuses a reference line priced at 0 € without hours, an unfilled line", () => {
    expect(refusal(() => plan({ references: [{ ...referenceLine, unit_price_ht_cents: 0, h_mo_per_unit: 0,
      h_mo_atelier_per_unit: null, h_mo_chantier_per_unit: null }] })).code).toBe("PRICE_REUSE_REFERENCE_NOT_PRICED");
  });

  it("detaches a supplier offer retained on the line, whose price no longer applies", () => {
    const offer = "66666666-6666-4666-8666-666666666666";
    expect(plan({ targets: [{ ...targetLine, selected_supplier_price_id: offer }] }).operations[0].data)
      .toMatchObject({ unit_price_ht_cents: 1250, selected_supplier_price_id: null });
  });

  it("refuses an ambiguous role name instead of picking one", () => {
    expect(refusal(() => plan({ targetRoles: [...roles.targetRoles, { id: "77777777-7777-4777-8777-777777777777", name: "Tuyauteur" }] })))
      .toEqual({ code: "PRICE_REUSE_LABOR_ROLE_AMBIGUOUS", message: expect.stringContaining("« Tuyauteur »") });
  });

  it("refuses two selections for the same line", () => {
    expect(refusal(() => plan({ selections: [
      { line_id: "target", reference_line_id: "ref" }, { line_id: "target", reference_line_id: "ref" },
    ] })).code).toBe("PRICE_REUSE_DUPLICATE_LINE");
  });

  it("does not write a line that already carries the reference price", () => {
    const already = { ...targetLine, ...plan().operations[0].data, pricing_status: "priced" as const };
    expect(plan({ targets: [already] })).toEqual({ operations: [], unchanged: ["target"] });
  });
});
