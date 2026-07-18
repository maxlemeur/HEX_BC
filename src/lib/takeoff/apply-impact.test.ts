import { describe, expect, it } from "vitest";

import { computeTakeoffApplyImpact } from "@/lib/takeoff/apply-impact";
import type {
  TakeoffApplyImpactEstimateItem,
  TakeoffApplyImpactVersion,
} from "@/lib/takeoff/apply-impact";
import type { TakeoffMappingPreviewItem } from "@/lib/takeoff/types";

const VERSION: TakeoffApplyImpactVersion = {
  margin_multiplier: 1,
  global_coefficient: 1,
  discount_bp: 0,
  discount_mode: "simple",
  discount_steps: [],
  tax_rate_bp: 2_000,
  rounding_mode: "none",
  rounding_step_cents: 1,
  total_ht_cents: 15_000,
  total_tax_cents: 3_000,
  total_ttc_cents: 18_000,
};

function estimateItem(
  input: Partial<TakeoffApplyImpactEstimateItem> &
    Pick<TakeoffApplyImpactEstimateItem, "id" | "item_type" | "title">
): TakeoffApplyImpactEstimateItem {
  return {
    parent_id: null,
    position: 1,
    description: null,
    quantity: null,
    unit_price_ht_cents: null,
    pu_ht_cents: null,
    tax_rate_bp: 2_000,
    category_id: null,
    line_total_ht_cents: null,
    line_tax_cents: null,
    line_total_ttc_cents: null,
    ...input,
  };
}

function previewItem(
  input: Partial<TakeoffMappingPreviewItem> & Pick<TakeoffMappingPreviewItem, "item_id">
): TakeoffMappingPreviewItem {
  return {
    source_order: 0,
    rule_id: null,
    rule_name: null,
    action: "none",
    action_params: {},
    applied_by: "none",
    original: {
      designation: "Nouveau tube",
      quantity: 2,
      unit: "ml",
      is_excluded: false,
      category_id: null,
      unit_price_cents: null,
      assembly_id: null,
    },
    transformed: {
      designation: "Nouveau tube",
      quantity: 2,
      unit: "ml",
      is_excluded: false,
      category_id: null,
      unit_price_cents: 5_000,
      assembly_id: null,
    },
    ...input,
  };
}

describe("computeTakeoffApplyImpact", () => {
  it("lists every kept, deleted and created row for a section replacement", () => {
    const root = estimateItem({
      id: "10000000-0000-4000-8000-000000000001",
      item_type: "section",
      title: "Lot plomberie",
    });
    const nestedSection = estimateItem({
      id: "10000000-0000-4000-8000-000000000002",
      parent_id: root.id,
      item_type: "section",
      title: "Evacuations",
    });
    const nestedLine = estimateItem({
      id: "10000000-0000-4000-8000-000000000003",
      parent_id: nestedSection.id,
      item_type: "line",
      title: "Tube existant",
      description: "ml",
      quantity: 3,
      line_total_ht_cents: 15_000,
      line_tax_cents: 3_000,
      line_total_ttc_cents: 18_000,
    });
    const outside = estimateItem({
      id: "10000000-0000-4000-8000-000000000004",
      item_type: "section",
      title: "Lot electricite",
      position: 2,
    });

    const impact = computeTakeoffApplyImpact({
      strategy: "replace",
      targetSectionId: root.id,
      existingItems: [root, nestedSection, nestedLine, outside],
      previewItems: [
        previewItem({ item_id: "20000000-0000-4000-8000-000000000001" }),
      ],
      version: VERSION,
    });

    expect(impact.counts).toEqual({
      kept: 2,
      modified: 0,
      created: 1,
      deleted: 2,
    });
    expect(impact.items.map((item) => item.change)).toEqual([
      "kept",
      "deleted",
      "deleted",
      "kept",
      "created",
    ]);
    expect(impact.amounts).toEqual({
      before: { ht_cents: 15_000, tax_cents: 3_000, ttc_cents: 18_000 },
      after: { ht_cents: 10_000, tax_cents: 2_000, ttc_cents: 12_000 },
      delta: { ht_cents: -5_000, tax_cents: -1_000, ttc_cents: -6_000 },
    });
  });

  it("marks matching merge rows as modified and leaves unrelated rows kept", () => {
    const targetSectionId = "30000000-0000-4000-8000-000000000001";
    const matching = estimateItem({
      id: "30000000-0000-4000-8000-000000000002",
      parent_id: targetSectionId,
      item_type: "line",
      title: "Tube PVC",
      description: "ml",
      quantity: 1,
      pu_ht_cents: 4_000,
      line_total_ht_cents: 4_000,
      line_tax_cents: 800,
      line_total_ttc_cents: 4_800,
    });
    const unrelated = estimateItem({
      id: "30000000-0000-4000-8000-000000000003",
      parent_id: targetSectionId,
      item_type: "line",
      title: "Coude PVC",
      description: "u",
      quantity: 1,
      line_total_ht_cents: 11_000,
      line_tax_cents: 2_200,
      line_total_ttc_cents: 13_200,
    });

    const source = previewItem({
      item_id: "40000000-0000-4000-8000-000000000001",
      original: {
        designation: "Tube PVC",
        quantity: 2,
        unit: "ml",
        is_excluded: false,
        category_id: null,
        unit_price_cents: null,
        assembly_id: null,
      },
      transformed: {
        designation: "Tube PVC",
        quantity: 2,
        unit: "ml",
        is_excluded: false,
        category_id: null,
        unit_price_cents: null,
        assembly_id: null,
      },
    });

    const impact = computeTakeoffApplyImpact({
      strategy: "merge",
      targetSectionId,
      existingItems: [matching, unrelated],
      previewItems: [source],
      version: VERSION,
    });

    expect(impact.counts).toEqual({
      kept: 1,
      modified: 1,
      created: 0,
      deleted: 0,
    });
    expect(impact.items.find((item) => item.change === "modified")).toMatchObject({
      existing_item_id: matching.id,
      source_item_id: source.item_id,
      before: { amount_ht_cents: 4_000 },
      after: { amount_ht_cents: 8_000 },
    });
  });

  it("reports a whole-version replace without silently keeping old rows", () => {
    const oldSection = estimateItem({
      id: "50000000-0000-4000-8000-000000000001",
      item_type: "section",
      title: "Ancien lot",
    });
    const oldLine = estimateItem({
      id: "50000000-0000-4000-8000-000000000002",
      parent_id: oldSection.id,
      item_type: "line",
      title: "Ancienne ligne",
      line_total_ht_cents: 15_000,
      line_tax_cents: 3_000,
      line_total_ttc_cents: 18_000,
    });

    const impact = computeTakeoffApplyImpact({
      strategy: "replace",
      targetSectionId: null,
      existingItems: [oldSection, oldLine],
      previewItems: [
        previewItem({ item_id: "60000000-0000-4000-8000-000000000001" }),
      ],
      version: VERSION,
    });

    expect(impact.counts).toEqual({
      kept: 0,
      modified: 0,
      created: 1,
      deleted: 2,
    });
    expect(impact.items.filter((item) => item.change === "deleted")).toHaveLength(2);
  });
});
