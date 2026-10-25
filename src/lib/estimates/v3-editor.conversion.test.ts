/**
 * Lot 3.2, entrée 1 (D-b) : conversion ligne ↔ section d'une v3 en un seul lot de l'écrivain v3. Le parcours IO12
 * prouve l'écriture en base ; ici, les règles transposées de la v1/v2 que le lot doit tenir avant tout envoi.
 */
import { describe, expect, it } from "vitest";

import type { EstimateItem } from "@/lib/estimates/editor-items";
import { planEstimateV3ItemConversion } from "@/lib/estimates/v3-editor";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";

function item(id: string, overrides: Partial<EstimateItem>): EstimateItem {
  return { id, version_id: VERSION_ID, parent_id: null, position: 1, title: id, aid: null, ...overrides } as EstimateItem;
}

const lot = item("lot", { item_type: "section", position: 1, title: "Lot 1", aid: "LOT.CH.01" });
const tube = item("tube", {
  item_type: "line", parent_id: "lot", position: 1, title: "Tube cuivre", aid: "LOT.CH.02", quantity: 12,
  unit_price_ht_cents: 1250, unit_code: "ml", pricing_status: "priced", h_mo_per_unit: 0.25,
  source_provider: "dpgf", source_file_name: "DPGF lot 1.xlsx", source_page: null,
  source_metadata: { import_id: "22222222-2222-4222-8222-222222222222" },
});
const titleLine = item("title-line", { item_type: "line", parent_id: "lot", position: 2, title: "CHAUFFAGE", quantity: 1 });
const empty = item("empty", { item_type: "section", parent_id: "lot", position: 3, title: "Sous-lot vide", aid: "LOT.CH.03" });
const items = [lot, tube, titleLine, empty];

describe("planEstimateV3ItemConversion", () => {
  it("turns each line into an empty section at its place, keeping its source, in one batch for the whole selection", () => {
    expect(planEstimateV3ItemConversion(VERSION_ID, items, ["tube", "title-line"], "section")).toEqual({
      ok: true,
      operations: [
        { op: "delete", id: "tube" },
        { op: "create", data: { version_id: VERSION_ID, parent_id: "lot", position: 1, title: "Tube cuivre", aid: "LOT.CH.02",
          source_provider: "dpgf", source_file_name: "DPGF lot 1.xlsx", source_page: null, item_type: "section" } },
        { op: "delete", id: "title-line" },
        { op: "create", data: { version_id: VERSION_ID, parent_id: "lot", position: 2, title: "CHAUFFAGE", aid: null,
          item_type: "section" } },
      ],
    });
  });

  it("turns an empty section into a supply-only line at Q 1 and PR FO 0, without a unit", () => {
    expect(planEstimateV3ItemConversion(VERSION_ID, items, ["empty"], "line")).toEqual({
      ok: true,
      operations: [
        { op: "delete", id: "empty" },
        { op: "create", data: { version_id: VERSION_ID, parent_id: "lot", position: 3, title: "Sous-lot vide", aid: "LOT.CH.03",
          item_type: "line", quantity: 1, unit_price_ht_cents: 0, unit_code: null } },
      ],
    });
  });

  it("refuses by name what the v1/v2 conversion refuses, before anything is sent", () => {
    expect(planEstimateV3ItemConversion(VERSION_ID, items, ["lot"], "line"))
      .toEqual({ ok: false, message: "La section contient des lignes ou des sous-sections." });
    expect(planEstimateV3ItemConversion(VERSION_ID, [...items, item("root-empty", { item_type: "section", position: 2 })],
      ["root-empty"], "line"))
      .toEqual({ ok: false, message: "Une ligne doit être ajoutée sous une section." });
    expect(planEstimateV3ItemConversion(VERSION_ID, items, ["tube", "empty"], "section"))
      .toEqual({ ok: false, message: "L’élément est déjà une section." });
    expect(planEstimateV3ItemConversion(VERSION_ID, items, ["tube"], "line"))
      .toEqual({ ok: false, message: "L’élément est déjà une ligne." });
    expect(planEstimateV3ItemConversion(VERSION_ID, [...items, item("tmp:new", { item_type: "line", position: 4 })],
      ["tmp:new"], "section"))
      .toEqual({ ok: false, message: "L’élément est en cours d’enregistrement : réessayez dans un instant." });
    expect(planEstimateV3ItemConversion(VERSION_ID, items, ["missing"], "section"))
      .toEqual({ ok: false, message: "Élément introuvable." });
    expect(planEstimateV3ItemConversion(VERSION_ID, items, [], "section"))
      .toEqual({ ok: false, message: "Aucun élément à convertir." });
  });

  it("keeps a conversion within one batch of 1 000 operations", () => {
    const lines = Array.from({ length: 501 }, (_, index) =>
      item(`line-${index}`, { item_type: "line", parent_id: "lot", position: index + 1 }));
    expect(planEstimateV3ItemConversion(VERSION_ID, [lot, ...lines], lines.slice(0, 500).map((line) => line.id), "section"))
      .toMatchObject({ ok: true, operations: { length: 1000 } });
    expect(planEstimateV3ItemConversion(VERSION_ID, [lot, ...lines], lines.map((line) => line.id), "section"))
      .toEqual({ ok: false, message: "Convertissez au plus 500 éléments à la fois." });
  });
});
