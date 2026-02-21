import { describe, expect, it } from "vitest";

import {
  detectEstimateOutliers,
  withOutlierFlagDismissals,
  type EstimateOutlierFlagKey,
  type EstimateOutlierFlagsByItemId,
} from "@/lib/estimates/outlier-detection";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];
type EstimateCategory = Database["public"]["Tables"]["estimate_categories"]["Row"];

function createLine(input: {
  id: string;
  categoryId: string | null;
  quantity: number;
  unitPriceHtCents: number;
}): EstimateItem {
  return {
    id: input.id,
    item_type: "line",
    category_id: input.categoryId,
    quantity: input.quantity,
    unit_price_ht_cents: input.unitPriceHtCents,
  } as EstimateItem;
}

function sortedFlags(
  map: EstimateOutlierFlagsByItemId,
  itemId: string
): EstimateOutlierFlagKey[] {
  return [...(map[itemId] ?? [])].sort();
}

describe("outlier detection", () => {
  it("detects quantity and price outliers with IQR by category", () => {
    const categories = [{ id: "cat-a" }, { id: "cat-b" }] as EstimateCategory[];

    const items = [
      createLine({ id: "a-1", categoryId: "cat-a", quantity: 1, unitPriceHtCents: 10000 }),
      createLine({ id: "a-2", categoryId: "cat-a", quantity: 1.1, unitPriceHtCents: 10100 }),
      createLine({ id: "a-3", categoryId: "cat-a", quantity: 1.2, unitPriceHtCents: 9800 }),
      createLine({ id: "a-4", categoryId: "cat-a", quantity: 1.3, unitPriceHtCents: 9900 }),
      createLine({ id: "a-5", categoryId: "cat-a", quantity: 8, unitPriceHtCents: 42000 }),
      createLine({ id: "b-1", categoryId: "cat-b", quantity: 8, unitPriceHtCents: 42000 }),
      createLine({ id: "b-2", categoryId: "cat-b", quantity: 8.1, unitPriceHtCents: 42100 }),
      createLine({ id: "b-3", categoryId: "cat-b", quantity: 7.9, unitPriceHtCents: 41900 }),
      createLine({ id: "b-4", categoryId: "cat-b", quantity: 8.2, unitPriceHtCents: 42300 }),
    ];

    const result = detectEstimateOutliers({
      items,
      categories,
      config: {
        method: "iqr",
        threshold: 1.5,
        groupByCategory: true,
      },
    });

    expect(sortedFlags(result, "a-5")).toEqual([
      "price_outlier",
      "quantity_outlier",
    ]);
    expect(result["b-1"]).toBeUndefined();
  });

  it("supports zscore threshold configuration", () => {
    const items = [
      createLine({ id: "l-1", categoryId: null, quantity: 1, unitPriceHtCents: 1000 }),
      createLine({ id: "l-2", categoryId: null, quantity: 1.1, unitPriceHtCents: 1000 }),
      createLine({ id: "l-3", categoryId: null, quantity: 1.2, unitPriceHtCents: 1000 }),
      createLine({ id: "l-4", categoryId: null, quantity: 1.25, unitPriceHtCents: 1000 }),
      createLine({ id: "l-5", categoryId: null, quantity: 2.5, unitPriceHtCents: 1000 }),
    ];

    const strictResult = detectEstimateOutliers({
      items,
      config: {
        method: "zscore",
        threshold: 1.6,
        groupByCategory: false,
      },
    });

    const relaxedResult = detectEstimateOutliers({
      items,
      config: {
        method: "zscore",
        threshold: 3,
        groupByCategory: false,
      },
    });

    expect(strictResult["l-5"]).toContain("quantity_outlier");
    expect(relaxedResult["l-5"]).toBeUndefined();
  });

  it("excludes dismissed flags from active outliers", () => {
    const active = withOutlierFlagDismissals({
      detectedOutliersByItemId: {
        "line-1": ["price_outlier", "quantity_outlier"],
      },
      dismissedOutliersByItemId: {
        "line-1": ["price_outlier"],
      },
    });

    expect(active).toEqual({
      "line-1": ["quantity_outlier"],
    });
  });
});
