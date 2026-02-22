import { describe, expect, it } from "vitest";

import {
  bulkUpdateEstimateItemsRequestSchema,
  createEstimateAssemblySchema,
  insertAssemblyIntoVersionSchema,
  listEstimateAssembliesQuerySchema,
  patchEstimateVersionSchema,
  suggestionRuleFeedbackSchema,
  updateEstimateAssemblySchema,
} from "@/lib/estimates/schemas";

const ITEM_ID_1 = "11111111-1111-4111-8111-111111111111";
const ITEM_ID_2 = "22222222-2222-4222-8222-222222222222";
const UPDATED_AT = "2026-02-21T10:00:00.000Z";

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
});
