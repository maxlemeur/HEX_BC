import { describe, expect, it } from "vitest";

import type { CataloguePriceSuggestion } from "@/lib/estimates/catalogue-suggestions";
import {
  prepareTakeoffPriceSuggestionSources,
  type EstimateItemPriceSuggestionRow,
} from "@/lib/takeoff/price-suggestion-preparation";

const NOW = Date.parse("2026-10-28T12:00:00.000Z");
const line: EstimateItemPriceSuggestionRow = {
  id: "line", version_id: "version", position: 1, title: "Tube cuivre 22", description: null,
  quantity: 10, selected_supplier_price_id: null, source_file_name: "dpgf.csv", source_page: null,
  source_provider: "dpgf", item_type: "line", unit: "ml", category_id: "plomberie",
  unit_price_ht_cents: 9000, updated_at: new Date(NOW).toISOString(),
};

function offer(patch: Partial<CataloguePriceSuggestion> = {}): CataloguePriceSuggestion {
  return {
    price_source: "supplier", supplier_price_id: "price", product_id: "product",
    product_designation: "Tube cuivre 22", product_reference: null,
    supplier_id: "supplier", supplier_name: "Fournisseur fictif", supplier_reference: "T22",
    unit: "ml", unit_price_cents: 26245, adjusted_unit_price_cents: 8748,
    purchase_unit: "barre", estimate_unit_code: "ml", estimate_units_per_purchase_unit: 3,
    adjusted_purchase_unit_price_cents: 26245, purchase_rounding: "ceil",
    currency: "EUR", updated_at: new Date(NOW).toISOString(), is_stale: false,
    stale_days: 90, relevance_score: 1, has_material_index_adjustment: false,
    material_index_code: null, material_index_value: null, catalogue_url: null,
    supplier_offer_count: 1, alternatives: [], ...patch,
  };
}

function prepare(input: {
  unit?: string;
  offers?: CataloguePriceSuggestion[];
  candidates?: EstimateItemPriceSuggestionRow[];
}) {
  return prepareTakeoffPriceSuggestionSources({
    line: { ...line, unit: input.unit ?? line.unit }, versionId: line.version_id, projectId: "project",
    catalogueSuggestions: input.offers ?? [offer()], candidateRows: input.candidates ?? [],
    candidateVersionById: new Map([["history-version", { project_id: "project", version_number: 2 }]]),
    now: NOW,
  });
}

describe("takeoff price source preparation", () => {
  it.each([["ml", 8748], ["barre", 26245]] as const)(
    "keeps the offer price in the selected line unit %s",
    (unit, priceCents) => {
      const sources = prepare({ unit });
      expect(sources).toHaveLength(1);
      expect(sources[0]).toMatchObject({
        sourceKind: "pricebook", kind: "fact", priceCents,
        sourceRecordId: "price", metadata: { unit, unit_match: true },
      });
    }
  );

  it("excludes the current line and unrelated history before limiting eligible historical evidence", () => {
    const sources = prepare({ offers: [], candidates: [
      line,
      { ...line, id: "unrelated", version_id: "history-version", title: "Porte blindée", unit: "u", category_id: "menuiserie" },
      ...Array.from({ length: 8 }, (_, index) => ({
        ...line, id: `history-${index}`, version_id: "history-version", unit_price_ht_cents: 8000 + index,
      })),
    ] });
    expect(sources).toHaveLength(6);
    expect(sources.map((source) => source.sourceRecordId))
      .toEqual(["history-0", "history-1", "history-2", "history-3", "history-4", "history-5"]);
    expect(sources.every((source) => source.sourceKind === "history" && source.kind === "fact")).toBe(true);
  });
});
