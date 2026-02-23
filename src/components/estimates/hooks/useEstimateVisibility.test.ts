import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  useEstimateVisibility,
  type EstimateQualityFilter,
} from "@/components/estimates/hooks/useEstimateVisibility";
import type { EstimateQualityFlagsByItemId } from "@/lib/estimate-quality";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];

function createItem(partial: Partial<EstimateItem>): EstimateItem {
  return {
    id: "",
    version_id: "version-1",
    parent_id: null,
    item_type: "line",
    title: "",
    description: null,
    quantity: 1,
    unit_price_ht_cents: 0,
    tax_rate_bp: 2000,
    k_fo: 1,
    h_mo: 0,
    h_mo_majoration: 1,
    k_mo: 1,
    pu_ht_cents: 0,
    line_total_ht_cents: 0,
    position: 0,
    labor_role_id: null,
    category_id: null,
    supply_type_id: null,
    selected_supplier_price_id: null,
    h_mo_atelier: null,
    k_mo_atelier: null,
    labor_role_atelier_id: null,
    h_mo_chantier: null,
    k_mo_chantier: null,
    labor_role_chantier_id: null,
    created_at: new Date().toISOString(),
    ...partial,
  } as EstimateItem;
}

describe("useEstimateVisibility", () => {
  it("filters visible line ids by quality filter", () => {
    const items: EstimateItem[] = [
      createItem({
        id: "section-1",
        item_type: "section",
        title: "Section",
        position: 0,
      }),
      createItem({
        id: "line-1",
        parent_id: "section-1",
        item_type: "line",
        title: "Line ok",
        position: 1,
      }),
      createItem({
        id: "line-2",
        parent_id: "section-1",
        item_type: "line",
        title: "Line anomaly",
        position: 2,
      }),
    ];

    const qualityFlagsByItemId: EstimateQualityFlagsByItemId = {
      "line-1": [],
      "line-2": ["missing_price"],
    };

    const { result } = renderHook(() =>
      useEstimateVisibility({
        items,
        qualityFilter: "with_anomalies" satisfies EstimateQualityFilter,
        qualityFlagsByItemId,
        marginMultiplier: 1,
        discountCents: 0,
        taxRateBp: 2000,
        laborRateById: new Map(),
        isLaborSplitEnabled: false,
      })
    );

    expect(result.current.visibleLineIdList).toEqual(["line-2"]);
    expect(result.current.hasVisibleRows).toBe(true);
  });

  it("builds bulk move destinations including nested sections", () => {
    const items: EstimateItem[] = [
      createItem({ id: "section-1", item_type: "section", title: "Root", position: 0 }),
      createItem({
        id: "section-2",
        parent_id: "section-1",
        item_type: "section",
        title: "Child",
        position: 1,
      }),
      createItem({
        id: "line-1",
        parent_id: "section-2",
        item_type: "line",
        title: "Line",
        position: 2,
      }),
    ];

    const { result } = renderHook(() =>
      useEstimateVisibility({
        items,
        qualityFilter: "all_lines",
        qualityFlagsByItemId: {},
        marginMultiplier: 1,
        discountCents: 0,
        taxRateBp: 2000,
        laborRateById: new Map(),
        isLaborSplitEnabled: false,
      })
    );

    expect(result.current.bulkMoveDestinations).toEqual([
      { id: null, label: "Racine" },
      { id: "section-1", label: "Root" },
      { id: "section-2", label: "  - Child" },
    ]);
  });

  it("keeps reorder siblings unfiltered while showing quick-filtered rows", () => {
    const allItems: EstimateItem[] = [
      createItem({ id: "section-1", item_type: "section", title: "Section", position: 0 }),
      createItem({
        id: "line-1",
        parent_id: "section-1",
        item_type: "line",
        title: "Visible line 1",
        position: 1,
      }),
      createItem({
        id: "line-2",
        parent_id: "section-1",
        item_type: "line",
        title: "Hidden line",
        position: 2,
      }),
      createItem({
        id: "line-3",
        parent_id: "section-1",
        item_type: "line",
        title: "Visible line 3",
        position: 3,
      }),
    ];
    const quickFilteredItems = allItems.filter((item) => item.id !== "line-2");

    const { result } = renderHook(() =>
      useEstimateVisibility({
        items: quickFilteredItems,
        reorderItems: allItems,
        qualityFilter: "all_lines",
        qualityFlagsByItemId: {},
        marginMultiplier: 1,
        discountCents: 0,
        taxRateBp: 2000,
        laborRateById: new Map(),
        isLaborSplitEnabled: false,
      })
    );

    expect(result.current.getVisibleItems("section-1").map((item) => item.id)).toEqual([
      "line-1",
      "line-3",
    ]);
    expect(result.current.itemsByParent.get("section-1")?.map((item) => item.id)).toEqual([
      "line-1",
      "line-2",
      "line-3",
    ]);
    expect(result.current.itemById.has("line-2")).toBe(true);
  });
});
