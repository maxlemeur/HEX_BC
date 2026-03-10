import { describe, expect, it } from "vitest";

import {
  buildEstimateSupplierComparisonAlternatives,
  type EstimateSupplierComparisonCandidate,
} from "@/lib/estimates/server";

function buildCandidate(): EstimateSupplierComparisonCandidate {
  return {
    supplier_price_id: "00000000-0000-4000-8000-000000000010",
    supplier_id: "00000000-0000-4000-8000-000000000110",
    supplier_name: "Selection courante",
    adjusted_unit_price_cents: 1325,
    supplier_reference: "SEL-1",
    catalogue_url: "https://example.com/selected",
    updated_at: "2026-03-10T08:00:00.000Z",
    is_stale: false,
    product_designation: "Tube cuivre",
    alternatives: [
      {
        kind: "best_price",
        supplier_price_id: "00000000-0000-4000-8000-000000000011",
        supplier_id: "00000000-0000-4000-8000-000000000111",
        supplier_name: "Best price",
        unit_price_cents: 1200,
        adjusted_unit_price_cents: 1200,
        currency: "EUR",
        supplier_reference: "BEST-1",
        unit: "u",
        updated_at: "2026-03-01T08:00:00.000Z",
        is_stale: false,
        catalogue_url: "https://example.com/best",
      },
      {
        kind: "most_recent",
        supplier_price_id: "00000000-0000-4000-8000-000000000012",
        supplier_id: "00000000-0000-4000-8000-000000000112",
        supplier_name: "Most recent",
        unit_price_cents: 1280,
        adjusted_unit_price_cents: 1280,
        currency: "EUR",
        supplier_reference: "RECENT-1",
        unit: "u",
        updated_at: "2026-03-09T08:00:00.000Z",
        is_stale: false,
        catalogue_url: "https://example.com/recent",
      },
      {
        kind: "preferred_supplier",
        supplier_price_id: "00000000-0000-4000-8000-000000000013",
        supplier_id: "00000000-0000-4000-8000-000000000113",
        supplier_name: "Preferred supplier",
        unit_price_cents: 1290,
        adjusted_unit_price_cents: 1290,
        currency: "EUR",
        supplier_reference: "PREF-1",
        unit: "u",
        updated_at: "2026-03-05T08:00:00.000Z",
        is_stale: true,
        catalogue_url: "https://example.com/preferred",
      },
    ],
  };
}

describe("buildEstimateSupplierComparisonAlternatives", () => {
  it("keeps heuristic kinds visible and appends selected_current when needed", () => {
    const alternatives = buildEstimateSupplierComparisonAlternatives({
      candidate: buildCandidate(),
      selectedSupplierPriceId: "00000000-0000-4000-8000-000000000010",
    });

    expect(alternatives.map((alternative) => alternative.kind)).toEqual([
      "best_price",
      "most_recent",
      "preferred_supplier",
      "selected_current",
    ]);
    expect(alternatives.find((alternative) => alternative.kind === "selected_current")).toMatchObject(
      {
        supplier_price_id: "00000000-0000-4000-8000-000000000010",
        supplier_name: "Selection courante",
        is_selected: true,
      }
    );
  });

  it("marks an already visible heuristic alternative as selected without duplicating it", () => {
    const alternatives = buildEstimateSupplierComparisonAlternatives({
      candidate: buildCandidate(),
      selectedSupplierPriceId: "00000000-0000-4000-8000-000000000011",
    });

    expect(alternatives.map((alternative) => alternative.kind)).toEqual([
      "best_price",
      "most_recent",
      "preferred_supplier",
    ]);
    expect(alternatives.find((alternative) => alternative.kind === "best_price")).toMatchObject({
      supplier_price_id: "00000000-0000-4000-8000-000000000011",
      is_selected: true,
    });
  });
});
