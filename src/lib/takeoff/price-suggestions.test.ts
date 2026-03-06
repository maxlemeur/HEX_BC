import { describe, expect, it } from "vitest";

import { buildTakeoffPriceSuggestion } from "@/lib/takeoff/price-suggestions";

describe("buildTakeoffPriceSuggestion", () => {
  it("builds a weighted range and keeps outliers visible", () => {
    const result = buildTakeoffPriceSuggestion({
      currentPriceCents: 1200,
      currentUnit: "m2",
      quantity: 25,
      sources: [
        {
          sourceKind: "pricebook",
          kind: "fact",
          label: "Fournisseur A",
          sourceRef: "Pricebook A",
          priceCents: 1180,
          freshnessLabel: "fraiche",
          confidenceScore: 0.82,
          sourceRecordTable: "supplier_pricebook",
          sourceRecordId: "a",
          weight: 1.1,
          metadata: {
            unit: "m2",
            unit_match: true,
          },
        },
        {
          sourceKind: "history",
          kind: "fact",
          label: "Version precedente",
          sourceRef: "Historique projet v2",
          priceCents: 1210,
          freshnessLabel: "recente",
          confidenceScore: 0.9,
          sourceRecordTable: "estimate_items",
          sourceRecordId: "b",
          weight: 1.3,
          metadata: {
            same_project: true,
            unit: "m2",
            unit_match: true,
            category_match: true,
          },
        },
        {
          sourceKind: "similar_item",
          kind: "inference",
          label: "Ouvrage proche",
          sourceRef: "Ouvrage proche v5",
          priceCents: 1240,
          freshnessLabel: "historique",
          confidenceScore: 0.64,
          sourceRecordTable: "estimate_items",
          sourceRecordId: "c",
          weight: 0.8,
          metadata: {
            unit: "m2",
            unit_match: true,
          },
        },
        {
          sourceKind: "history",
          kind: "fact",
          label: "Historique complementaire",
          sourceRef: "Historique projet v4",
          priceCents: 1260,
          freshnessLabel: "recente",
          confidenceScore: 0.79,
          sourceRecordTable: "estimate_items",
          sourceRecordId: "e",
          weight: 1,
          metadata: {
            same_project: true,
            unit: "m2",
            unit_match: true,
          },
        },
        {
          sourceKind: "pricebook",
          kind: "fact",
          label: "Fournisseur B",
          sourceRef: "Pricebook B",
          priceCents: 1270,
          freshnessLabel: "fraiche",
          confidenceScore: 0.77,
          sourceRecordTable: "supplier_pricebook",
          sourceRecordId: "f",
          weight: 0.95,
          metadata: {
            unit: "m2",
            unit_match: true,
          },
        },
        {
          sourceKind: "similar_item",
          kind: "inference",
          label: "Valeur atypique",
          sourceRef: "Ouvrage proche v1",
          priceCents: 9000,
          freshnessLabel: "historique",
          confidenceScore: 0.32,
          sourceRecordTable: "estimate_items",
          sourceRecordId: "d",
          weight: 0.2,
          metadata: {
            unit: "m2",
            unit_match: true,
          },
        },
      ],
    });

    expect(result.lowCents).toBeGreaterThanOrEqual(1180);
    expect(result.targetCents).toBeGreaterThanOrEqual(result.lowCents);
    expect(result.highCents).toBeGreaterThanOrEqual(result.targetCents);
    expect(result.outlierCount).toBe(1);
    expect(result.sources.some((source) => source.is_outlier)).toBe(true);
    expect(result.justification).toContain("prix atypique");
  });

  it("derives explicit factors for quantity, freshness, history, category and unit", () => {
    const result = buildTakeoffPriceSuggestion({
      currentPriceCents: 950,
      currentUnit: "u",
      quantity: 1,
      sources: [
        {
          sourceKind: "history",
          kind: "fact",
          label: "Historique direct",
          sourceRef: "Historique projet",
          priceCents: 940,
          freshnessLabel: "fraiche",
          confidenceScore: 0.88,
          sourceRecordTable: "estimate_items",
          sourceRecordId: "h1",
          weight: 1.2,
          metadata: {
            same_project: true,
            category_match: true,
            unit: "u",
          },
        },
        {
          sourceKind: "pricebook",
          kind: "fact",
          label: "Catalogue",
          sourceRef: "Pricebook",
          priceCents: 960,
          freshnessLabel: "recente",
          confidenceScore: 0.74,
          sourceRecordTable: "supplier_pricebook",
          sourceRecordId: "p1",
          weight: 1,
          metadata: {
            unit: "u",
            category_match: true,
          },
        },
      ],
    });

    expect(result.factors.map((factor) => factor.key)).toEqual(
      expect.arrayContaining([
        "quantity_bucket",
        "date_freshness",
        "same_project_history",
        "category_match",
        "unit_match",
      ])
    );
    expect(result.summary.same_project_history_count).toBe(1);
    expect(result.confidenceLabel === "medium" || result.confidenceLabel === "high").toBe(
      true
    );
  });
});
