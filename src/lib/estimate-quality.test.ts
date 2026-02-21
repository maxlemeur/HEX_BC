import { describe, expect, it } from "vitest";

import {
  countEstimateQualityFlags,
  computeEstimateQualityFlagsByItemId,
  computeEstimateQualityFlagsForItem,
} from "@/lib/estimate-quality";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];

function createLine(input: {
  id: string;
  quantity: number;
  unitPriceHtCents: number;
  laborHours?: number;
  laborRoleId?: string | null;
}): EstimateItem {
  return {
    id: input.id,
    item_type: "line",
    quantity: input.quantity,
    unit_price_ht_cents: input.unitPriceHtCents,
    h_mo: input.laborHours ?? 1,
    labor_role_id: input.laborRoleId ?? "role-1",
  } as EstimateItem;
}

describe("estimate quality flags", () => {
  it("adds outlier flags and excludes dismissed outliers", () => {
    const item = createLine({
      id: "line-1",
      quantity: 2,
      unitPriceHtCents: 2500,
    });

    const flags = computeEstimateQualityFlagsForItem(item, {
      outlierFlagsByItemId: {
        "line-1": ["price_outlier", "quantity_outlier"],
      },
      dismissedOutlierFlagsByItemId: {
        "line-1": ["price_outlier"],
      },
    });

    expect(flags).toContain("quantity_outlier");
    expect(flags).not.toContain("price_outlier");
  });

  it("counts the new outlier flags in quality aggregates", () => {
    const items = [
      createLine({
        id: "line-1",
        quantity: 0,
        unitPriceHtCents: 0,
        laborHours: 0,
        laborRoleId: null,
      }),
      createLine({
        id: "line-2",
        quantity: 3,
        unitPriceHtCents: 4500,
      }),
    ];

    const byItemId = computeEstimateQualityFlagsByItemId(items, {
      outlierFlagsByItemId: {
        "line-2": ["price_outlier", "quantity_outlier"],
      },
      dismissedOutlierFlagsByItemId: {
        "line-2": ["quantity_outlier"],
      },
    });

    const counts = countEstimateQualityFlags(byItemId);

    expect(counts.linesCount).toBe(2);
    expect(counts.linesWithAnomaliesCount).toBe(2);
    expect(counts.byFlag.price_outlier).toBe(1);
    expect(counts.byFlag.quantity_outlier).toBe(0);
    expect(counts.totalFlagsCount).toBe(4);
  });
});
