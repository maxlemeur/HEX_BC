import { describe, expect, it } from "vitest";
import { ouvrageQuantity, resizeOuvrage } from "./ouvrage-quantity";

type TestNode = { id: string; parent_id: string | null; item_type: string; source_metadata: Record<string, unknown>; quantity?: number | null; h_mo?: number | null; h_mo_per_unit?: number };
const kit: TestNode = { id: "kit", parent_id: null, item_type: "section", source_metadata: { kit_metier: true, assembly_id: "library" } };
const line: TestNode = { id: "line", parent_id: "kit", item_type: "line", quantity: 0.333, h_mo: 2, source_metadata: { origin: "retained" } };
describe("ouvrage quantity", () => {
  it("scales components once and keeps per-unit V3 hours and provenance", () => {
    const items = resizeOuvrage([kit, { ...line, h_mo_per_unit: 2 }], "kit", 3, true);
    expect(items[1]).toMatchObject({ quantity: 0.999, h_mo_per_unit: 2, h_mo: 2, source_metadata: { origin: "retained" } });
    expect(ouvrageQuantity(items[0])).toBe(3);
  });
  it("retains composition across fractional quantities and zero", () => {
    let items = resizeOuvrage([kit, line], "kit", 0.5, false);
    expect(items[1].quantity).toBe(0.167);
    items = resizeOuvrage(items, "kit", 0, false);
    expect(items[1]).toMatchObject({ quantity: 0, h_mo: 0 });
    items = resizeOuvrage(items, "kit", 1, false);
    expect(items[1]).toMatchObject({ quantity: 0.333, h_mo: 2 });
  });
  it("uses edited components as the new composition and scales historical total hours", () => {
    let items = resizeOuvrage([kit, line], "kit", 3, false);
    items[1] = { ...items[1], quantity: 6, h_mo: 9 };
    items = resizeOuvrage(items, "kit", 2, false);
    expect(items[1]).toMatchObject({ quantity: 4, h_mo: 6 });
  });
  it("scales nested ouvrages and leaves unrelated lines untouched", () => {
    const nested = { ...kit, id: "nested", parent_id: "kit" };
    const outside = { ...line, id: "outside", parent_id: null };
    const items = resizeOuvrage([kit, nested, { ...line, parent_id: "nested" }, outside], "kit", 3, false);
    expect(ouvrageQuantity(items[1])).toBe(1);
    expect(items[2].quantity).toBe(0.999);
    expect(items[3]).toBe(outside);
    expect(resizeOuvrage(items, "nested", 2, false)[2].quantity).toBe(1.998);
  });
  it("preserves composition through a copy with new identities at zero", () => {
    const zero = resizeOuvrage([kit, line], "kit", 0, false);
    const copy = zero.map(item => ({ ...item, id: item.id + "-copy", parent_id: item.parent_id ? item.parent_id + "-copy" : null }));
    expect(resizeOuvrage(copy, "kit-copy", 1, false)[1]).toMatchObject({ quantity: 0.333, h_mo: 2 });
  });
  it("allows changing a nested composition at zero without losing it", () => {
    const nested = { ...kit, id: "nested", parent_id: "kit" };
    let items = resizeOuvrage([kit, nested, { ...line, parent_id: "nested" }], "nested", 3, false);
    items = resizeOuvrage(items, "kit", 0, false);
    items = resizeOuvrage(items, "nested", 1, false);
    expect(items[2].quantity).toBe(0);
    expect(resizeOuvrage(items, "kit", 1, false)[2]).toMatchObject({ quantity: 0.333, h_mo: 2 });
  });
  it("rebases a moved component against the destination ouvrage quantity", () => {
    const source = resizeOuvrage([kit, { ...line, quantity: 2 }], "kit", 3, false);
    const destination = { ...kit, id: "destination", source_metadata: { kit_metier: true, ouvrage_quantity: 2 } };
    const moved = [...source.slice(0, 1), destination, { ...source[1], parent_id: "destination" }];
    expect(resizeOuvrage(moved, "destination", 3, false)[2].quantity).toBe(9);
  });
  it("rejects ordinary chapters and invalid quantities", () => {
    expect(() => resizeOuvrage([{ ...kit, source_metadata: {} }, line], "kit", 2, false)).toThrow();
    for (const quantity of [-1, NaN, Infinity]) expect(() => resizeOuvrage([kit, line], "kit", quantity, false)).toThrow();
  });
});
