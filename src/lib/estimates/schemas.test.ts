import { describe, expect, it } from "vitest";

import {
  batchOperationsSchema,
  bulkUpdateEstimateItemsRequestSchema,
  createEstimateSchema,
  createEstimateVariantSchema,
  createEstimateAssemblySchema,
  duplicateEstimateSectionSchema,
  importEstimateSectionsSchema,
  listEstimateImportSourcesQuerySchema,
  createMarginTierSchema,
  insertAssemblyIntoVersionSchema,
  listEstimateAssembliesQuerySchema,
  moveEstimateItemSchema,
  patchEstimateVersionSchema,
  purgeSuggestionLearningSchema,
  promoteEstimateVariantSchema,
  reviewSuggestionLearningSchema,
  suggestionRuleFeedbackSchema,
  trackSuggestionCorrectionsSchema,
  updateEstimateAssemblySchema,
  updateMarginTierSchema,
} from "@/lib/estimates/schemas";

const ITEM_ID_1 = "11111111-1111-4111-8111-111111111111";
const ITEM_ID_2 = "22222222-2222-4222-8222-222222222222";
const ITEM_ID_3 = "33333333-3333-4333-8333-333333333333";
const PARENT_ID_1 = "44444444-4444-4444-8444-444444444444";
const PARENT_ID_2 = "55555555-5555-4555-8555-555555555555";
const UPDATED_AT = "2026-02-21T10:00:00.000Z";

describe("createEstimateSchema", () => {
  it("accepts cascade discount fields when creating an estimate", () => {
    const parsed = createEstimateSchema.parse({
      project: {
        name: "Projet A",
      },
      version: {
        discount_mode: "cascade",
        discount_steps: [300, 150],
        global_coefficient: 1.05,
      },
    });

    expect(parsed.version).toMatchObject({
      discount_mode: "cascade",
      discount_steps: [300, 150],
      global_coefficient: 1.05,
    });
  });

  it("accepts an empty cascade steps array", () => {
    const parsed = createEstimateSchema.parse({
      project: {
        name: "Projet A",
      },
      version: {
        discount_mode: "cascade",
        discount_steps: [],
      },
    });

    expect(parsed.version).toMatchObject({
      discount_mode: "cascade",
      discount_steps: [],
    });
  });

  it("rejects discount steps without cascade mode", () => {
    const parsed = createEstimateSchema.safeParse({
      project: {
        name: "Projet A",
      },
      version: {
        discount_steps: [200],
      },
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("discount_steps doit etre vide en mode simple")
      )
    ).toBe(true);
  });
});

describe("patchEstimateVersionSchema", () => {
  it("rejects payloads that only carry updated_at", () => {
    const parsed = patchEstimateVersionSchema.safeParse({
      updated_at: UPDATED_AT,
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("Aucun champ a mettre a jour")
      )
    ).toBe(true);
  });

  it("normalizes trimmed values for patch payloads", () => {
    const parsed = patchEstimateVersionSchema.parse({
      title: "  Version revisee  ",
      currency: "  EUR  ",
      updated_at: `  ${UPDATED_AT}  `,
    });

    expect(parsed.title).toBe("Version revisee");
    expect(parsed.currency).toBe("EUR");
    expect(parsed.updated_at).toBe(UPDATED_AT);
  });

  it("keeps nullable text fields as null when blanks are sent", () => {
    const parsed = patchEstimateVersionSchema.parse({
      title: "   ",
      updated_at: UPDATED_AT,
    });

    expect(parsed.title).toBeNull();
  });

  it("rejects negative integer totals", () => {
    const parsed = patchEstimateVersionSchema.safeParse({
      total_ht_cents: -1,
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("Doit etre >= 0")
      )
    ).toBe(true);
  });

  it("accepts cascade discount fields", () => {
    const parsed = patchEstimateVersionSchema.parse({
      discount_mode: "cascade",
      discount_steps: [250, 100],
      global_coefficient: 1.12,
      updated_at: UPDATED_AT,
    });

    expect(parsed).toMatchObject({
      discount_mode: "cascade",
      discount_steps: [250, 100],
      global_coefficient: 1.12,
      updated_at: UPDATED_AT,
    });
  });

  it("rejects simple mode with non-empty discount steps", () => {
    const parsed = patchEstimateVersionSchema.safeParse({
      discount_mode: "simple",
      discount_steps: [150],
      updated_at: UPDATED_AT,
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("discount_steps doit etre vide en mode simple")
      )
    ).toBe(true);
  });
});

describe("bulkUpdateEstimateItemsRequestSchema", () => {
  it("accepts bare updates arrays and wraps them in updates", () => {
    const parsed = bulkUpdateEstimateItemsRequestSchema.parse([
      {
        id: ITEM_ID_1,
        title: "Ligne 1",
      },
    ]);

    expect(parsed).toEqual({
      updates: [
        {
          id: ITEM_ID_1,
          title: "Ligne 1",
        },
      ],
    });
  });

  it("normalizes updated_at when provided in object payloads", () => {
    const parsed = bulkUpdateEstimateItemsRequestSchema.parse({
      updated_at: ` ${UPDATED_AT} `,
      updates: [
        {
          id: ITEM_ID_1,
          title: "Ligne 1",
        },
      ],
    });

    expect(parsed.updated_at).toBe(UPDATED_AT);
  });

  it("accepts empty updates when version_patch is provided", () => {
    const parsed = bulkUpdateEstimateItemsRequestSchema.parse({
      updates: [],
      version_patch: {
        total_ht_cents: 12500,
        total_tax_cents: 2500,
        total_ttc_cents: 15000,
      },
    });

    expect(parsed.updates).toEqual([]);
    expect(parsed.version_patch).toEqual({
      total_ht_cents: 12500,
      total_tax_cents: 2500,
      total_ttc_cents: 15000,
    });
  });

  it("rejects an empty version_patch object", () => {
    const parsed = bulkUpdateEstimateItemsRequestSchema.safeParse({
      updates: [],
      version_patch: {},
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("version_patch ne peut pas etre vide")
      )
    ).toBe(true);
  });

  it("rejects fully empty bulk payloads", () => {
    const parsed = bulkUpdateEstimateItemsRequestSchema.safeParse({
      updates: [],
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("updates ne peut pas etre vide")
      )
    ).toBe(true);
  });

  it("rejects duplicated update ids", () => {
    const parsed = bulkUpdateEstimateItemsRequestSchema.safeParse({
      updates: [
        {
          id: ITEM_ID_1,
          title: "Ligne 1",
        },
        {
          id: ITEM_ID_1,
          title: "Ligne 2",
        },
      ],
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some(
        (issue) =>
          issue.path.join(".") === "updates.1.id" &&
          issue.message.includes("identifiants uniques")
      )
    ).toBe(true);
  });

  it("rejects updates that only contain id", () => {
    const parsed = bulkUpdateEstimateItemsRequestSchema.safeParse({
      updates: [
        {
          id: ITEM_ID_2,
        },
      ],
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("Aucun champ de mise a jour fourni")
      )
    ).toBe(true);
  });
});

describe("batchOperationsSchema", () => {
  it("accepts mixed create/update/delete/reorder operations", () => {
    const parsed = batchOperationsSchema.parse({
      concurrency_token: ` ${UPDATED_AT} `,
      dry_run: true,
      operations: [
        {
          op: "create",
          data: {
            item_type: "line",
            title: "Nouvelle ligne",
            quantity: 2,
          },
        },
        {
          op: "update",
          id: ITEM_ID_1,
          data: {
            title: "Ligne mise a jour",
          },
        },
        {
          op: "delete",
          id: ITEM_ID_2,
        },
        {
          op: "reorder",
          data: {
            parent_id: null,
            ordered_ids: [ITEM_ID_1, ITEM_ID_3],
          },
        },
      ],
    });

    expect(parsed.concurrency_token).toBe(UPDATED_AT);
    expect(parsed.dry_run).toBe(true);
    expect(parsed.operations).toHaveLength(4);
    expect(parsed.operations[1]).toEqual({
      op: "update",
      id: ITEM_ID_1,
      data: {
        title: "Ligne mise a jour",
      },
    });
  });

  it("rejects empty operations arrays", () => {
    const parsed = batchOperationsSchema.safeParse({
      operations: [],
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("operations ne peut pas etre vide")
      )
    ).toBe(true);
  });

  it("rejects update operations with empty data payload", () => {
    const parsed = batchOperationsSchema.safeParse({
      operations: [
        {
          op: "update",
          id: ITEM_ID_1,
          data: {},
        },
      ],
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("Aucun champ de mise a jour fourni")
      )
    ).toBe(true);
  });
});

describe("moveEstimateItemSchema", () => {
  it("accepts a valid inter-parent move payload", () => {
    const parsed = moveEstimateItemSchema.parse({
      item_id: ITEM_ID_1,
      from_parent_id: PARENT_ID_1,
      to_parent_id: PARENT_ID_2,
      ordered_source_ids: [ITEM_ID_2],
      ordered_target_ids: [ITEM_ID_3, ITEM_ID_1],
    });

    expect(parsed).toEqual({
      item_id: ITEM_ID_1,
      from_parent_id: PARENT_ID_1,
      to_parent_id: PARENT_ID_2,
      ordered_source_ids: [ITEM_ID_2],
      ordered_target_ids: [ITEM_ID_3, ITEM_ID_1],
    });
  });

  it("rejects invalid source/target ordering constraints", () => {
    const parsed = moveEstimateItemSchema.safeParse({
      item_id: ITEM_ID_1,
      from_parent_id: null,
      to_parent_id: null,
      ordered_source_ids: [ITEM_ID_1],
      ordered_target_ids: [ITEM_ID_2],
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("ordered_source_ids ne doit pas contenir item_id")
      )
    ).toBe(true);
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("ordered_target_ids doit contenir item_id")
      )
    ).toBe(true);
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("doivent etre differents")
      )
    ).toBe(true);
  });
});

describe("suggestionRuleFeedbackSchema", () => {
  it("accepts feedback values accept and reject", () => {
    expect(suggestionRuleFeedbackSchema.parse({ feedback: "accept" })).toEqual({
      feedback: "accept",
    });
    expect(suggestionRuleFeedbackSchema.parse({ feedback: "reject" })).toEqual({
      feedback: "reject",
    });
  });

  it("accepts an optional positive count", () => {
    expect(
      suggestionRuleFeedbackSchema.parse({ feedback: "accept", count: 3 })
    ).toEqual({
      feedback: "accept",
      count: 3,
    });
  });

  it("rejects unsupported feedback values", () => {
    const parsed = suggestionRuleFeedbackSchema.safeParse({
      feedback: "maybe",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects non-positive or non-integer count values", () => {
    expect(
      suggestionRuleFeedbackSchema.safeParse({
        feedback: "accept",
        count: 0,
      }).success
    ).toBe(false);

    expect(
      suggestionRuleFeedbackSchema.safeParse({
        feedback: "accept",
        count: -2,
      }).success
    ).toBe(false);

    expect(
      suggestionRuleFeedbackSchema.safeParse({
        feedback: "accept",
        count: 1.5,
      }).success
    ).toBe(false);
  });
});

describe("suggestion learning schemas", () => {
  it("accepts tracked correction payloads", () => {
    const parsed = trackSuggestionCorrectionsSchema.parse({
      corrections: [
        {
          rule_id: ITEM_ID_1,
          field_name: "k_fo",
          original_value: "1.15",
          corrected_value: "1.20",
          item_title: "Pose gaine",
        },
      ],
    });

    expect(parsed.corrections).toHaveLength(1);
    expect(parsed.corrections[0]).toEqual({
      rule_id: ITEM_ID_1,
      field_name: "k_fo",
      original_value: "1.15",
      corrected_value: "1.20",
      item_title: "Pose gaine",
    });
  });

  it("rejects unknown tracked fields", () => {
    expect(
      trackSuggestionCorrectionsSchema.safeParse({
        corrections: [
          {
            rule_id: ITEM_ID_1,
            field_name: "quantity",
            original_value: "1",
            corrected_value: "2",
            item_title: "x",
          },
        ],
      }).success
    ).toBe(false);
  });

  it("accepts review and purge payloads", () => {
    expect(
      reviewSuggestionLearningSchema.parse({
        rule_id: ITEM_ID_1,
        field_name: "description",
        corrected_value: "ml",
        action: "approve",
      })
    ).toEqual({
      rule_id: ITEM_ID_1,
      field_name: "description",
      corrected_value: "ml",
      action: "approve",
    });

    expect(purgeSuggestionLearningSchema.parse({ retention_months: 6 })).toEqual({
      retention_months: 6,
    });
  });
});

describe("estimate assembly schemas", () => {
  const roleId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  it("accepts a valid assembly payload with one line", () => {
    const parsed = createEstimateAssemblySchema.parse({
      name: "Mur exterieur",
      description: "Standard",
      items: [
        {
          title: "Parpaing 20",
          unit: "m2",
          kFo: 1.1,
          kMo: 1.2,
          laborRoleId: roleId,
          defaultQuantity: 2,
          position: 1,
        },
      ],
    });

    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]).toEqual(
      expect.objectContaining({
        title: "Parpaing 20",
        unit: "m2",
        k_fo: 1.1,
        k_mo: 1.2,
        labor_role_id: roleId,
        default_quantity: 2,
        position: 1,
      })
    );
  });

  it("rejects assemblies with no lines or more than 50 lines", () => {
    expect(
      createEstimateAssemblySchema.safeParse({
        name: "Vide",
        items: [],
      }).success
    ).toBe(false);

    expect(
      createEstimateAssemblySchema.safeParse({
        name: "Trop long",
        items: Array.from({ length: 51 }, (_, index) => ({
          title: `Ligne ${index + 1}`,
          position: index + 1,
        })),
      }).success
    ).toBe(false);
  });

  it("rejects duplicated positions", () => {
    const parsed = createEstimateAssemblySchema.safeParse({
      name: "Doublons",
      items: [
        { title: "Ligne A", position: 1 },
        { title: "Ligne B", position: 1 },
      ],
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("positions des lignes")
      )
    ).toBe(true);
  });

  it("accepts update with reordered items", () => {
    const parsed = updateEstimateAssemblySchema.parse({
      items: [
        {
          title: "Ligne B",
          position: 2,
        },
        {
          title: "Ligne A",
          position: 1,
        },
      ],
    });

    expect(parsed.items).toHaveLength(2);
    expect(parsed.items?.map((item) => item.position)).toEqual([2, 1]);
  });

  it("preserves omitted fields on partial update payloads", () => {
    const parsed = updateEstimateAssemblySchema.parse({
      name: "Mur v2",
    });

    expect(parsed).toEqual({
      name: "Mur v2",
    });
    expect("description" in parsed).toBe(false);
    expect("items" in parsed).toBe(false);
  });

  it("normalizes list query defaults", () => {
    const parsed = listEstimateAssembliesQuerySchema.parse({});
    expect(parsed.limit).toBe(20);
    expect(parsed.order).toBe("recent");
  });

  it("parses insert assembly payload with query/body aliases", () => {
    const parsed = insertAssemblyIntoVersionSchema.parse({
      versionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      afterItemId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });

    expect(parsed).toEqual({
      version_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      after_item_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
  });

  it("parses duplicate section payload with camelCase alias", () => {
    const parsed = duplicateEstimateSectionSchema.parse({
      targetVersionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });

    expect(parsed).toEqual({
      target_version_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
  });

  it("accepts an empty duplicate section payload", () => {
    expect(duplicateEstimateSectionSchema.parse(undefined)).toEqual({});
  });
});

describe("estimate import schemas", () => {
  it("parses import payload using camelCase aliases", () => {
    const parsed = importEstimateSectionsSchema.parse({
      sourceVersionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sectionIds: [
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      ],
      mode: "merge",
    });

    expect(parsed).toEqual({
      source_version_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      section_ids: [
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      ],
      mode: "merge",
    });
  });

  it("defaults mode to append when omitted", () => {
    const parsed = importEstimateSectionsSchema.parse({
      sourceVersionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sectionIds: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
    });

    expect(parsed.mode).toBe("append");
  });

  it("rejects duplicate section ids", () => {
    const parsed = importEstimateSectionsSchema.safeParse({
      sourceVersionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sectionIds: [
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ],
      mode: "append",
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("identifiants uniques")
      )
    ).toBe(true);
  });

  it("parses import source query with camelCase alias", () => {
    const parsed = listEstimateImportSourcesQuerySchema.parse({
      excludeVersionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    });

    expect(parsed).toEqual({
      exclude_version_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    });
  });
});

describe("estimate variant schemas", () => {
  it("accepts empty payloads for create/promote variant actions", () => {
    expect(createEstimateVariantSchema.parse({})).toEqual({});
    expect(promoteEstimateVariantSchema.parse({})).toEqual({});
  });

  it("normalizes nullish payloads to empty object", () => {
    expect(createEstimateVariantSchema.parse(undefined)).toEqual({});
    expect(promoteEstimateVariantSchema.parse(null)).toEqual({});
  });

  it("rejects unexpected fields", () => {
    expect(
      createEstimateVariantSchema.safeParse({ force: true }).success
    ).toBe(false);
    expect(
      promoteEstimateVariantSchema.safeParse({ foo: "bar" }).success
    ).toBe(false);
  });
});

describe("createMarginTierSchema", () => {
  it("accepts valid input", () => {
    const result = createMarginTierSchema.safeParse({
      threshold_cents: 10_000_00,
      multiplier: 1.5,
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional position", () => {
    const result = createMarginTierSchema.safeParse({
      threshold_cents: 0,
      multiplier: 1.6,
      position: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative threshold", () => {
    const result = createMarginTierSchema.safeParse({
      threshold_cents: -1,
      multiplier: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer threshold", () => {
    const result = createMarginTierSchema.safeParse({
      threshold_cents: 1000.5,
      multiplier: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects multiplier > 100", () => {
    const result = createMarginTierSchema.safeParse({
      threshold_cents: 0,
      multiplier: 101,
    });
    expect(result.success).toBe(false);
  });

  it("rejects multiplier < 0", () => {
    const result = createMarginTierSchema.safeParse({
      threshold_cents: 0,
      multiplier: -0.1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects NaN multiplier", () => {
    const result = createMarginTierSchema.safeParse({
      threshold_cents: 0,
      multiplier: NaN,
    });
    expect(result.success).toBe(false);
  });

  it("rejects Infinity multiplier", () => {
    const result = createMarginTierSchema.safeParse({
      threshold_cents: 0,
      multiplier: Infinity,
    });
    expect(result.success).toBe(false);
  });

  it("accepts boundary 0 for multiplier", () => {
    const result = createMarginTierSchema.safeParse({
      threshold_cents: 0,
      multiplier: 0,
    });
    expect(result.success).toBe(true);
  });

  it("accepts boundary 100 for multiplier", () => {
    const result = createMarginTierSchema.safeParse({
      threshold_cents: 0,
      multiplier: 100,
    });
    expect(result.success).toBe(true);
  });
});

describe("updateMarginTierSchema", () => {
  it("rejects empty payload", () => {
    const result = updateMarginTierSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("accepts partial with multiplier only", () => {
    const result = updateMarginTierSchema.safeParse({ multiplier: 1.4 });
    expect(result.success).toBe(true);
  });

  it("accepts partial with threshold only", () => {
    const result = updateMarginTierSchema.safeParse({
      threshold_cents: 5000,
    });
    expect(result.success).toBe(true);
  });

  it("accepts partial with position only", () => {
    const result = updateMarginTierSchema.safeParse({ position: 2 });
    expect(result.success).toBe(true);
  });

  it("rejects multiplier > 100", () => {
    const result = updateMarginTierSchema.safeParse({ multiplier: 100.1 });
    expect(result.success).toBe(false);
  });
});
