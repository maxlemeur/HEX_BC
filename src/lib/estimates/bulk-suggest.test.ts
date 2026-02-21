import { describe, expect, it } from "vitest";

import {
  applyBulkSuggestions,
  buildBulkSuggestPreview,
  computeBulkSuggestions,
  findSuggestibleLines,
} from "@/lib/estimates/bulk-suggest";
import type { Database } from "@/types/database";

type EstimateLine = Database["public"]["Tables"]["estimate_items"]["Row"];
type SuggestionRule =
  Database["public"]["Tables"]["estimate_suggestion_rules"]["Row"];
type EstimateCategory =
  Database["public"]["Tables"]["estimate_categories"]["Row"];

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const NOW_ISO = "2026-02-21T12:00:00.000Z";

function createLine(
  input: {
    id: string;
    title: string;
    item_type?: EstimateLine["item_type"];
  } & Partial<EstimateLine>
): EstimateLine {
  const { id, title, item_type, ...overrides } = input;

  return {
    id,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    tenant_id: TENANT_ID,
    version_id: VERSION_ID,
    parent_id: null,
    item_type: item_type ?? "line",
    position: 1,
    title,
    description: null,
    quantity: 1,
    unit_price_ht_cents: 0,
    tax_rate_bp: 2000,
    k_fo: 1,
    h_mo: 0,
    h_mo_majoration: 1,
    k_mo: 1,
    h_mo_atelier: null,
    k_mo_atelier: null,
    labor_role_atelier_id: null,
    h_mo_chantier: null,
    k_mo_chantier: null,
    labor_role_chantier_id: null,
    pu_ht_cents: 0,
    labor_role_id: null,
    category_id: null,
    supply_type_id: null,
    selected_supplier_price_id: null,
    line_total_ht_cents: 0,
    line_tax_cents: 0,
    line_total_ttc_cents: 0,
    ...overrides,
  };
}

function createRule(
  input: {
    id: string;
    match_value: string;
  } & Partial<SuggestionRule>
): SuggestionRule {
  const { id, match_value, ...overrides } = input;

  return {
    id,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    tenant_id: TENANT_ID,
    user_id: USER_ID,
    name: input.name ?? id,
    match_type: "keyword",
    match_value,
    unit: input.unit ?? null,
    category_id: input.category_id ?? null,
    k_fo: input.k_fo ?? null,
    k_mo: input.k_mo ?? null,
    labor_role_id: input.labor_role_id ?? null,
    usage_count: input.usage_count ?? 0,
    last_used_at: input.last_used_at ?? null,
    position: input.position ?? 0,
    is_active: input.is_active ?? true,
    ...overrides,
  };
}

function createCategory(input: {
  id: string;
  name: string;
}): EstimateCategory {
  return {
    id: input.id,
    tenant_id: TENANT_ID,
    user_id: USER_ID,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    name: input.name,
    color: null,
    position: 1,
  };
}

describe("bulk-suggest", () => {
  it("finds only neutral lines that match at least one applicable rule", () => {
    const items = [
      createLine({
        id: "line-1",
        title: "Pose de fenetre PVC",
      }),
      createLine({
        id: "line-2",
        title: "Pose de fenetre aluminium",
        k_fo: 1.25,
      }),
      createLine({
        id: "line-3",
        title: "Escalier metal",
      }),
      createLine({
        id: "section-1",
        title: "Lot Menuiserie",
        item_type: "section",
      }),
      createLine({
        id: "line-4",
        title: "Brique creuse",
      }),
    ];
    const rules = [
      createRule({
        id: "rule-main",
        match_value: "fenetre",
        unit: "u",
        k_fo: 1.1,
      }),
      createRule({
        id: "rule-no-payload",
        match_value: "brique",
      }),
    ];

    const suggestible = findSuggestibleLines({
      items,
      rules,
    });

    expect(suggestible.map((entry) => entry.line.id)).toEqual(["line-1"]);
    expect(suggestible[0]?.rankedSuggestions.map((entry) => entry.rule.id)).toEqual([
      "rule-main",
    ]);
  });

  it("computes preview diffs with the best ranked rule", () => {
    const items = [
      createLine({
        id: "line-1",
        title: "Pose de fenetre",
      }),
    ];
    const rules = [
      createRule({
        id: "rule-low-usage",
        match_value: "fenetre",
        unit: "u",
        category_id: "44444444-4444-4444-8444-444444444444",
        k_fo: 1.2,
        k_mo: 1.1,
        usage_count: 2,
      }),
      createRule({
        id: "rule-high-usage",
        match_value: "fenetre",
        unit: "ml",
        category_id: "55555555-5555-4555-8555-555555555555",
        k_fo: 1.35,
        k_mo: 1.18,
        usage_count: 30,
      }),
    ];

    const result = computeBulkSuggestions({
      items,
      rules,
    });

    expect(result.scannedLineCount).toBe(1);
    expect(result.suggestibleLineCount).toBe(1);
    expect(result.suggestions).toHaveLength(1);

    const suggestion = result.suggestions[0];
    expect(suggestion?.rule.id).toBe("rule-high-usage");
    expect(suggestion?.updates).toEqual({
      description: "ml",
      k_fo: 1.35,
      k_mo: 1.18,
      category_id: "55555555-5555-4555-8555-555555555555",
    });
    expect(suggestion?.current).toEqual({
      description: null,
      k_fo: 1,
      k_mo: 1,
      category_id: null,
    });
    expect(suggestion?.proposed).toEqual({
      description: "ml",
      k_fo: 1.35,
      k_mo: 1.18,
      category_id: "55555555-5555-4555-8555-555555555555",
    });
    expect(suggestion?.diff.map((entry) => entry.field)).toEqual([
      "description",
      "k_fo",
      "k_mo",
      "category_id",
    ]);
  });

  it("applies selected suggestions and returns update, usage and undo snapshots", () => {
    const items = [
      createLine({
        id: "line-1",
        title: "Pose de fenetre",
      }),
      createLine({
        id: "line-2",
        title: "Remplacement fenetre",
      }),
    ];
    const rules = [
      createRule({
        id: "rule-window",
        match_value: "fenetre",
        unit: "u",
        k_fo: 1.2,
        usage_count: 7,
      }),
    ];
    const computation = computeBulkSuggestions({
      items,
      rules,
    });

    const result = applyBulkSuggestions({
      items,
      suggestions: computation.suggestions,
      selectedLineIds: ["line-1"],
    });

    expect(result.updates).toEqual([
      {
        id: "line-1",
        updates: {
          description: "u",
          k_fo: 1.2,
        },
      },
    ]);
    expect(result.appliedLineIds).toEqual(["line-1"]);
    expect(result.ruleUsageByRuleId).toEqual({
      "rule-window": 1,
    });
    expect(result.ruleUsageIncrements).toEqual([
      {
        ruleId: "rule-window",
        incrementBy: 1,
        previousUsageCount: 7,
        nextUsageCount: 8,
      },
    ]);
    expect(result.snapshot.previousLines).toHaveLength(1);
    expect(result.snapshot.previousLines[0]?.id).toBe("line-1");
    expect(result.snapshot.appliedLines).toHaveLength(1);
    expect(result.snapshot.appliedLines[0]?.ruleId).toBe("rule-window");

    const nextLine1 = result.snapshot.nextItems.find((item) => item.id === "line-1");
    const nextLine2 = result.snapshot.nextItems.find((item) => item.id === "line-2");
    expect(nextLine1?.description).toBe("u");
    expect(nextLine1?.k_fo).toBe(1.2);
    expect(nextLine2?.description).toBeNull();
    expect(nextLine2?.k_fo).toBe(1);

    expect(items[0]?.description).toBeNull();
    expect(items[0]?.k_fo).toBe(1);
  });

  it("keeps non-neutral fields untouched if the line changed after preview", () => {
    const initialItems = [
      createLine({
        id: "line-1",
        title: "Pose de fenetre",
      }),
    ];
    const rules = [
      createRule({
        id: "rule-window",
        match_value: "fenetre",
        unit: "u",
        k_fo: 1.2,
        k_mo: 1.25,
        usage_count: 3,
      }),
    ];
    const computation = computeBulkSuggestions({
      items: initialItems,
      rules,
    });
    const editedItems = [
      createLine({
        ...initialItems[0],
        k_fo: 1.8,
      }),
    ];

    const result = applyBulkSuggestions({
      items: editedItems,
      suggestions: computation.suggestions,
    });

    expect(result.updates).toEqual([
      {
        id: "line-1",
        updates: {
          description: "u",
          k_mo: 1.25,
        },
      },
    ]);

    const nextLine = result.snapshot.nextItems[0];
    expect(nextLine?.k_fo).toBe(1.8);
    expect(nextLine?.k_mo).toBe(1.25);
    expect(nextLine?.description).toBe("u");
  });

  it("builds preview rows only for neutral lines and formats current/proposed values", () => {
    const categoryId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const items = [
      createLine({
        id: "line-1",
        title: "Pose de fenetre",
      }),
      createLine({
        id: "line-2",
        title: "Pose de fenetre",
        description: "ml",
      }),
    ];
    const rules = [
      createRule({
        id: "rule-window",
        match_value: "fenetre",
        unit: "u",
        category_id: categoryId,
        k_fo: 1.15,
      }),
    ];

    const preview = buildBulkSuggestPreview({
      items,
      suggestionRules: rules,
      categories: [createCategory({ id: categoryId, name: "Menuiserie" })],
    });

    expect(preview).toHaveLength(1);
    expect(preview[0]).toMatchObject({
      itemId: "line-1",
      ruleId: "rule-window",
      patch: {
        description: "u",
        category_id: categoryId,
        k_fo: 1.15,
      },
    });
    expect(preview[0]?.changes).toEqual([
      {
        field: "description",
        label: "Unite",
        currentDisplay: "-",
        proposedDisplay: "u",
      },
      {
        field: "category_id",
        label: "Categorie",
        currentDisplay: "-",
        proposedDisplay: "Menuiserie",
      },
      {
        field: "k_fo",
        label: "K FO",
        currentDisplay: "1",
        proposedDisplay: "1.15",
      },
    ]);
  });
});
