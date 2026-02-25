import { describe, expect, it } from "vitest";

import { computeTakeoffMappingPreview } from "@/lib/takeoff/mapping-engine";
import type {
  TakeoffJobItem,
  TakeoffMappingOverride,
  TakeoffMappingRule,
} from "@/lib/takeoff/types";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

function makeItem(overrides: Partial<TakeoffJobItem> = {}): TakeoffJobItem {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    designation: "Tube PVC 100",
    quantity: 12,
    unit: "ml",
    confidence: 0.9,
    evidence: null,
    source_file_name: "niveau-a.csv",
    source_page: 1,
    metadata: {},
    is_excluded: false,
    exclusion_reason: null,
    is_verified: false,
    verified_at: null,
    verified_by: null,
    created_at: "2026-02-25T10:00:00.000Z",
    updated_at: "2026-02-25T10:00:00.000Z",
    ...overrides,
  };
}

function makeRule(
  overrides: Partial<TakeoffMappingRule>
): TakeoffMappingRule {
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    tenant_id: TENANT_ID,
    created_at: "2026-02-25T09:00:00.000Z",
    updated_at: "2026-02-25T09:00:00.000Z",
    created_by: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    name: "Rule",
    match_pattern: "tube",
    match_type: "contains",
    action: "rename",
    action_params: {
      designation: "Tube normalise",
    },
    priority: 10,
    is_active: true,
    ...overrides,
  } as TakeoffMappingRule;
}

describe("computeTakeoffMappingPreview", () => {
  it("applique la premiere regle matchante selon priorite puis created_at", () => {
    const item = makeItem();
    const highPriorityRule = makeRule({
      id: "11111111-1111-4111-8111-111111111111",
      name: "High priority",
      priority: 1,
      action: "rename",
      action_params: { designation: "PVC norme" },
    });
    const lowerPriorityRule = makeRule({
      id: "22222222-2222-4222-8222-222222222222",
      name: "Low priority",
      priority: 20,
      action: "rename",
      action_params: { designation: "Ne doit pas gagner" },
    });

    const result = computeTakeoffMappingPreview({
      items: [item],
      rules: [lowerPriorityRule, highPriorityRule],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      rule_id: highPriorityRule.id,
      rule_name: "High priority",
      action: "rename",
      transformed: {
        designation: "PVC norme",
      },
    });
  });

  it("supporte les actions rename, set_price, set_category, apply_assembly et skip", () => {
    const items = [
      makeItem({
        id: "10000000-0000-4000-8000-000000000001",
        designation: "Tube cuivre",
      }),
      makeItem({
        id: "10000000-0000-4000-8000-000000000002",
        designation: "Cable elec",
      }),
      makeItem({
        id: "10000000-0000-4000-8000-000000000003",
        designation: "Peinture blanc",
      }),
      makeItem({
        id: "10000000-0000-4000-8000-000000000004",
        designation: "Mur type A",
      }),
      makeItem({
        id: "10000000-0000-4000-8000-000000000005",
        designation: "Dechet chantier",
      }),
    ];

    const rules: TakeoffMappingRule[] = [
      makeRule({
        id: "20000000-0000-4000-8000-000000000001",
        match_pattern: "cuivre",
        action: "rename",
        action_params: { designation: "Tube cuivre normalise" },
      }),
      makeRule({
        id: "20000000-0000-4000-8000-000000000002",
        match_pattern: "cable",
        action: "set_price",
        action_params: { unit_price_cents: 1250 },
      }),
      makeRule({
        id: "20000000-0000-4000-8000-000000000003",
        match_pattern: "peinture",
        action: "set_category",
        action_params: {
          category_id: "30000000-0000-4000-8000-000000000003",
        },
      }),
      makeRule({
        id: "20000000-0000-4000-8000-000000000004",
        match_pattern: "mur",
        action: "apply_assembly",
        action_params: {
          assembly_id: "40000000-0000-4000-8000-000000000004",
        },
      }),
      makeRule({
        id: "20000000-0000-4000-8000-000000000005",
        match_pattern: "dechet",
        action: "skip",
        action_params: {},
      }),
    ];

    const result = computeTakeoffMappingPreview({ items, rules });

    expect(result.summary.total_count).toBe(5);
    expect(result.summary.transformed_count).toBe(5);
    expect(result.summary.excluded_by_mapping_count).toBe(2);
    expect(result.summary.assembly_insertions_count).toBe(1);

    expect(result.items[0]?.transformed.designation).toBe("Tube cuivre normalise");
    expect(result.items[1]?.transformed.unit_price_cents).toBe(1250);
    expect(result.items[2]?.transformed.category_id).toBe(
      "30000000-0000-4000-8000-000000000003"
    );
    expect(result.items[3]?.transformed).toMatchObject({
      is_excluded: true,
      assembly_id: "40000000-0000-4000-8000-000000000004",
    });
    expect(result.items[4]?.transformed.is_excluded).toBe(true);
  });

  it("applique les overrides par item avant le calcul final", () => {
    const item = makeItem({
      id: "90000000-0000-4000-8000-000000000001",
      designation: "Tube PVC 100",
    });

    const rules: TakeoffMappingRule[] = [
      makeRule({
        id: "90000000-0000-4000-8000-000000000010",
        action: "rename",
        action_params: { designation: "Nom normalise" },
      }),
    ];

    const overrides: TakeoffMappingOverride[] = [
      {
        item_id: item.id,
        action: "set_price",
        action_params: {
          unit_price_cents: 777,
        },
      },
    ];

    const result = computeTakeoffMappingPreview({
      items: [item],
      rules,
      overrides,
    });

    expect(result.items[0]).toMatchObject({
      action: "set_price",
      applied_by: "override",
      transformed: {
        unit_price_cents: 777,
        designation: "Tube PVC 100",
      },
    });
    expect(result.summary.overridden_count).toBe(1);
  });

  it("laisse intacts les items deja exclus", () => {
    const item = makeItem({
      id: "91000000-0000-4000-8000-000000000001",
      designation: "Tube PVC 100",
      is_excluded: true,
      exclusion_reason: "manuel",
    });

    const rules: TakeoffMappingRule[] = [
      makeRule({
        id: "91000000-0000-4000-8000-000000000010",
        action: "set_price",
        action_params: { unit_price_cents: 420 },
      }),
    ];

    const result = computeTakeoffMappingPreview({
      items: [item],
      rules,
    });

    expect(result.items[0]).toMatchObject({
      action: "none",
      transformed: {
        is_excluded: true,
        unit_price_cents: null,
      },
    });
    expect(result.summary.included_count).toBe(0);
  });
});
