import { describe, expect, it } from "vitest";

import {
  blockingAlertCodes,
  buildClarificationMessage,
  effectiveLineMaterial,
  materialRequestLineAlerts,
  type AlertContext,
} from "./alerts";
import type { MaterialRequestLine } from "./contracts";

/**
 * Failure modes, written before the code (TI-690). Every example is invented, in the shape of what
 * technicians write:
 *  1. a line with an overwritten figure, no quantity, no unit or no type is validated;
 *  2. a missing size goes unnoticed ("200 rondelles"), or an article that has no size can never be validated;
 *  3. the material presumed for the whole sheet is taken for granted without the operator confirming it,
 *     or a line with no material at all is validated;
 *  4. a line that names another material than the sheet's is silently aligned on it, or blocked for good;
 *  5. the same piece written twice in the same zone is validated twice without anyone looking, while the
 *     same piece in two zones (a legitimate case) is flagged;
 *  6. overhead lines (PPE) are held back by the sheet's material;
 *  7. the message to the technician asks about what the office can settle alone, hides a question, is long,
 *     or asks "combien ?" about a greeting or a note that the pre-reading of a pasted message turned into a line.
 */

function line(partial: Partial<MaterialRequestLine> = {}): MaterialRequestLine {
  return {
    id: partial.id ?? "line-1",
    request_id: "request-1",
    position: 1,
    original_text: null,
    quantity: 10,
    quantity_doubtful: false,
    unit: "u",
    dimension: "DN20",
    no_dimension: false,
    product_type: "Coude 45°",
    material: "Inox 304L serti",
    material_precision: null,
    reference: null,
    supplier_id: null,
    zone: null,
    imputation: "project",
    overhead_category: null,
    duplicate_acknowledged: false,
    status: "draft",
    validated_at: null,
    product_id: null,
    product_match: null,
    unit_price_ht_cents: null,
    price_per: 1,
    price_quote_id: null,
    ...partial,
  };
}

function context(lines: MaterialRequestLine[], request: Partial<AlertContext["request"]> = {}): AlertContext {
  return { request: { presumed_material: null, material_confirmed: false, ...request }, lines };
}

const codes = (target: MaterialRequestLine, ctx: AlertContext) =>
  materialRequestLineAlerts(target, ctx).map((alert) => alert.code);

describe("materialRequestLineAlerts", () => {
  it("raises nothing on a complete line", () => {
    const complete = line();
    expect(materialRequestLineAlerts(complete, context([complete]))).toEqual([]);
  });

  it.each([
    ["no quantity", { quantity: null }, "quantity_missing"],
    ["an overwritten figure", { quantity_doubtful: true }, "quantity_doubtful"],
    ["no unit", { unit: null }, "unit_missing"],
    ["a blank unit", { unit: "  " }, "unit_missing"],
    ["no type", { product_type: null }, "type_missing"],
    ["no size", { dimension: null }, "dimension_missing"],
  ] as const)("blocks a line with %s", (_label, partial, code) => {
    const target = line(partial);
    expect(blockingAlertCodes(target, context([target]))).toEqual([code]);
  });

  it("accepts an article without a size once the operator says so", () => {
    const target = line({ product_type: "Lunettes de meulage", dimension: null, no_dimension: true });
    expect(codes(target, context([target]))).toEqual([]);
  });

  describe("material", () => {
    it("blocks a line with no material when the sheet presumes none", () => {
      const target = line({ material: null });
      expect(blockingAlertCodes(target, context([target]))).toEqual(["material_missing"]);
    });

    it("holds a presumed material back until it is confirmed, and names it", () => {
      const target = line({ material: null });
      const alerts = materialRequestLineAlerts(
        target,
        context([target], { presumed_material: "Inox 304L serti" }),
      );
      expect(alerts).toEqual([
        {
          code: "material_unconfirmed",
          field: "material",
          blocking: true,
          message: "Matière présumée « Inox 304L serti » à confirmer.",
        },
      ]);
    });

    it("applies a confirmed presumed material to the lines that name none", () => {
      const target = line({ material: null });
      const ctx = context([target], { presumed_material: "Inox 304L serti", material_confirmed: true });
      expect(codes(target, ctx)).toEqual([]);
      expect(effectiveLineMaterial(target, ctx.request)).toEqual({
        material: "Inox 304L serti",
        source: "presumed",
      });
    });

    it("flags, without blocking, a line that names another material than the sheet", () => {
      const target = line({ material: "Laiton" });
      const ctx = context([target], { presumed_material: "Inox 304L serti", material_confirmed: true });
      const alerts = materialRequestLineAlerts(target, ctx);
      expect(alerts.map((alert) => [alert.code, alert.blocking])).toEqual([["material_conflict", false]]);
      expect(effectiveLineMaterial(target, ctx.request)).toEqual({ material: "Laiton", source: "line" });
    });

    it("does not flag the same material written with another case or accent", () => {
      const target = line({ material: "inox 304l SERTI" });
      expect(
        codes(target, context([target], { presumed_material: "Inox 304L serti", material_confirmed: true })),
      ).toEqual([]);
    });

    it("never asks an overhead line for a material", () => {
      const target = line({
        imputation: "overhead",
        product_type: "Gants de manutention",
        material: null,
        dimension: null,
        no_dimension: true,
      });
      expect(codes(target, context([target], { presumed_material: "Inox 304L serti" }))).toEqual([]);
    });
  });

  describe("possible duplicate", () => {
    const first = line({ id: "a", product_type: "Té 40 piquage fileté", dimension: "DN15", zone: "Trémie" });

    it("flags both lines of a pair written twice in the same zone", () => {
      const second = line({ ...first, id: "b", quantity: 8 });
      const ctx = context([first, second]);
      expect(blockingAlertCodes(first, ctx)).toEqual(["possible_duplicate"]);
      expect(blockingAlertCodes(second, ctx)).toEqual(["possible_duplicate"]);
    });

    it("ignores case, accents and spacing when comparing", () => {
      const second = line({ ...first, id: "b", product_type: "  te 40  PIQUAGE filete ", dimension: "dn 15" });
      expect(blockingAlertCodes(second, context([first, second]))).toEqual(["possible_duplicate"]);
    });

    it("lets the operator keep a line after looking at it, one line at a time", () => {
      const second = line({ ...first, id: "b", duplicate_acknowledged: true });
      const ctx = context([first, second]);
      expect(codes(second, ctx)).toEqual([]);
      expect(blockingAlertCodes(first, ctx)).toEqual(["possible_duplicate"]);
    });

    it.each([
      ["another zone", { zone: "R+3" }],
      ["another size", { dimension: "DN20" }],
      ["another material", { material: "Inox 316L serti" }],
      ["another imputation", { imputation: "overhead" as const }],
    ])("does not flag the same piece in %s", (_label, partial) => {
      const second = line({ ...first, id: "b", ...partial });
      expect(codes(second, context([first, second]))).not.toContain("possible_duplicate");
    });

    it("does not compare lines that have no type yet", () => {
      const blankA = line({ id: "a", product_type: null });
      const blankB = line({ id: "b", product_type: null });
      expect(codes(blankA, context([blankA, blankB]))).toEqual(["type_missing"]);
    });
  });

  it("reports every problem of a line, in a fixed order", () => {
    const target = line({ quantity: null, quantity_doubtful: true, unit: null, dimension: null, material: null });
    expect(codes(target, context([target]))).toEqual([
      "quantity_missing",
      "unit_missing",
      "dimension_missing",
      "material_missing",
    ]);
  });
});

describe("buildClarificationMessage", () => {
  it("asks only what the technician can answer, one short line each", () => {
    const rods = line({ id: "a", position: 5, product_type: "Goujon", dimension: "M12", quantity: 30, no_dimension: false, original_text: "goujon M12 x 30" });
    const glass = line({ id: "b", position: 9, product_type: "Lunettes de meulage", quantity: null, dimension: null, no_dimension: true, imputation: "overhead", material: null });
    const washers = line({ id: "c", position: 7, product_type: "Rondelle", dimension: null, quantity: 200, quantity_doubtful: true });
    const complete = line({ id: "d", position: 2 });
    const ctx = context([rods, glass, washers, complete]);

    expect(buildClarificationMessage({ technicianName: "Karim", lines: [rods, glass, washers, complete], context: ctx })).toBe(
      [
        "Bonjour Karim, il me manque quelques précisions pour ta demande :",
        "- Rondelle : c’est bien 200 ? Et quelle dimension ?",
        "- Lunettes de meulage : combien ?",
        "Merci !",
      ].join("\n"),
    );
  });

  it("returns nothing when there is nothing to ask", () => {
    const complete = line();
    expect(
      buildClarificationMessage({ technicianName: null, lines: [complete], context: context([complete]) }),
    ).toBeNull();
  });

  it("does not ask the technician to confirm what the office decides: unit, duplicate kept, sheet material", () => {
    const noUnit = line({ id: "a", unit: null });
    const presumed = line({ id: "b", material: null, dimension: "DN25" });
    const ctx = context([noUnit, presumed], { presumed_material: "Inox 304L serti" });
    expect(buildClarificationMessage({ technicianName: null, lines: [noUnit, presumed], context: ctx })).toBeNull();
  });

  it("asks which material when none is known, and greets without a name", () => {
    const target = line({ material: null, product_type: "Coude 90°", dimension: "DN65" });
    expect(
      buildClarificationMessage({ technicianName: "  ", lines: [target], context: context([target]) }),
    ).toBe(
      ["Bonjour, il me manque une précision pour ta demande :", "- Coude 90° DN65 : en quelle matière ?", "Merci !"].join("\n"),
    );
  });

  it("does not ask about a line the office has not named yet: a greeting or a note is not an article", () => {
    const greeting = line({ id: "a", position: 1, product_type: null, original_text: "Bonjour, pour le local technique :", quantity: null, unit: null, dimension: null });
    const note = line({ id: "b", position: 8, product_type: null, original_text: "Tous les tubes en cuivre", quantity: null, unit: null, dimension: null });
    const washers = line({ id: "c", position: 6, product_type: "Rondelle", dimension: null });
    const ctx = context([greeting, note, washers]);
    expect(buildClarificationMessage({ technicianName: null, lines: [greeting, note, washers], context: ctx })).toBe(
      ["Bonjour, il me manque une précision pour ta demande :", "- Rondelle : quelle dimension ?", "Merci !"].join("\n"),
    );
  });
});
