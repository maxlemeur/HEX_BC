import { describe, expect, it } from "vitest";

import {
  missingProductValidationFields,
  productValidationFieldsFromDetail,
  productValidationMessage,
} from "./product-validation";

/**
 * Failure modes, written before the code (TI-690):
 *  1. a draft with a blank or whitespace-only type, material or unit is reported as complete;
 *  2. a draft without a supply type is reported as complete;
 *  3. the dimension, reference or price is demanded although an article can be validated without them;
 *  4. the database refusal (detail "product_type,supply_type_id") reaches the operator as a raw code,
 *     or an unknown field name in that detail is shown as-is;
 *  5. the message does not say which fields to fill in.
 */

const COMPLETE = {
  product_type: "Té réduit",
  material: "Inox 304L serti",
  unit: "u",
  supply_type_id: "9d9d9d9d-9d9d-4d9d-8d9d-9d9d9d9d9d9d",
};

describe("missingProductValidationFields", () => {
  it("accepts an article with a type, a material, a unit and a supply type", () => {
    expect(missingProductValidationFields(COMPLETE)).toEqual([]);
  });

  it.each([
    ["no type", { ...COMPLETE, product_type: null }, ["product_type"]],
    ["a whitespace-only type", { ...COMPLETE, product_type: "   " }, ["product_type"]],
    ["no material", { ...COMPLETE, material: "" }, ["material"]],
    ["no unit", { ...COMPLETE, unit: undefined }, ["unit"]],
    ["no supply type", { ...COMPLETE, supply_type_id: null }, ["supply_type_id"]],
    [
      "nothing at all",
      {},
      ["product_type", "material", "unit", "supply_type_id"],
    ],
  ] as const)("reports %s", (_label, product, expected) => {
    expect(missingProductValidationFields(product)).toEqual(expected);
  });

  it("never demands a dimension, a reference or a price", () => {
    expect(
      missingProductValidationFields({
        ...COMPLETE,
        dimensions: null,
        reference: null,
        unit_price_cents: 0,
      } as typeof COMPLETE),
    ).toEqual([]);
  });
});

describe("productValidationFieldsFromDetail", () => {
  it("reads the fields named by the database refusal, in the fixed order", () => {
    expect(productValidationFieldsFromDetail("supply_type_id,product_type")).toEqual([
      "product_type",
      "supply_type_id",
    ]);
  });

  it("ignores names it does not know and tolerates an absent detail", () => {
    expect(productValidationFieldsFromDetail("material, tax_rate_bp ,")).toEqual(["material"]);
    expect(productValidationFieldsFromDetail(null)).toEqual([]);
    expect(productValidationFieldsFromDetail(undefined)).toEqual([]);
  });
});

describe("productValidationMessage", () => {
  it("names every missing field in French", () => {
    expect(productValidationMessage(["product_type", "supply_type_id"])).toBe(
      "Pour valider cet article, renseignez : le type d’article, le type de fourniture.",
    );
  });

  it("stays explicit when the database names no field", () => {
    expect(productValidationMessage([])).toBe(
      "Cet article est incomplet : renseignez le type d’article, la matière, l’unité et le type de fourniture avant de le valider.",
    );
  });
});
