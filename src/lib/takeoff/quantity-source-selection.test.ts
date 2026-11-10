import { describe, expect, it } from "vitest";
import { selectQuantitySources, type QuantitySourceItem } from "@/lib/takeoff/quantity-source-selection";

function item(id: string, quantity: number, vector = false): QuantitySourceItem {
  return { id, designation: "EF cuivre DN 22", quantity, unit: "ml", source_file_name: "Plan RDC Z1.pdf", source_page: 1,
    is_excluded: vector, metadata: vector ? { vector: { kind: "network" }, quantity_source: { exploitable: true } } : {} };
}

describe("TI-681 alternative quantity sources", () => {
  it("prioritizes a comparable vector total, retaining the alternative and the gap", () => {
    const result = selectQuantitySources([item("model", 60), item("vector", 58, true)]);
    expect(result.find(entry => entry.id === "model")).toMatchObject({ excluded: true });
    expect(result.find(entry => entry.id === "vector")).toMatchObject({ excluded: false,
      comparison: { vector_quantity: 58, model_quantity: 60, delta: -2 } });
  });
  it("never substitutes an unusable vector measure or a different page, unit or diameter", () => {
    for (const vector of [
      { ...item("vector", 58, true), metadata: { vector: {}, quantity_source: { exploitable: false } } },
      { ...item("vector", 58, true), source_page: 2 },
      { ...item("vector", 58, true), unit: "m2" },
      { ...item("vector", 58, true), designation: "EF cuivre DN 40" },
    ]) {
      expect(selectQuantitySources([item("model", 60), vector]).find(entry => entry.id === "model")?.excluded).not.toBe(true);
    }
  });
  it("compares complete reading totals instead of choosing just one vector geometry part", () => {
    const result = selectQuantitySources([item("model", 60), item("v1", 28, true), item("v2", 30, true)]);
    expect(result.filter(entry => !entry.excluded).map(entry => entry.id)).toEqual(["v1", "v2"]);
    expect(result.find(entry => entry.id === "v1")?.comparison.vector_quantity).toBe(58);
  });
  it("never replaces another zone's model quantity on the same page", () => {
    const modelZ2 = { ...item("model-z2", 100), designation: "EF cuivre DN 22 Z2" };
    const result = selectQuantitySources([{ ...item("model-z1", 60), designation: "EF cuivre DN 22 Z1" }, modelZ2,
      { ...item("vector", 58, true), designation: "EF cuivre DN 22 Z1" }]);
    expect(result.some(entry => entry.id === modelZ2.id && entry.excluded)).toBe(false);
    expect(result.find(entry => entry.id === "vector")).toMatchObject({ excluded: false, comparison: { model_quantity: 60 } });
  });
  it("keeps the vector excluded when a model reading on the page has an unknown or wider location", () => {
    for (const metadata of [{}, { rule_inputs: { level: "R+1" } }]) {
      const model = { ...item("model", 60), source_file_name: "plan.pdf", metadata };
      const vector = { ...item("vector", 58, true), source_file_name: "plan.pdf", metadata: {
        vector: { kind: "network" }, quantity_source: { exploitable: true,
          location: { source: "page_triage", level: "R+1", zone: "Z1" } } } };
      expect(selectQuantitySources([model, vector])).toEqual([]);
    }
  });
});
