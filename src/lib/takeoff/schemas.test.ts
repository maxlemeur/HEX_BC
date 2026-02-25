import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  TakeoffExchangeSchema,
  takeoffApplyRequestSchema,
  takeoffPreviewConversionResponseSchema,
  zodToGeminiJsonSchema,
} from "@/lib/takeoff/schemas";

function createBasePayload(level: "A" | "B" | "C") {
  return {
    items: [
      {
        designation: "Porte coupe-feu",
        quantity: 5,
        unit: "u",
      },
    ],
    warnings: [
      {
        code: "  qty_inferred  ",
        message: "Quantite deduite d'un libelle ambigu.",
        severity: "warning" as const,
      },
    ],
    metadata: {
      level,
      prompt_version: "takeoff-a-v1",
      file_type: "csv",
      schema_version: "v1",
    },
  };
}

describe("TakeoffExchangeSchema", () => {
  it("accepts a valid level A payload with optional tables", () => {
    const payload = createBasePayload("A");

    const parsed = TakeoffExchangeSchema.parse(payload);

    expect(parsed.metadata.level).toBe("A");
    expect(parsed.tables).toBeUndefined();
    expect(parsed.warnings[0]?.code).toBe("QTY_INFERRED");
  });

  it("accepts a valid level B payload with required tables", () => {
    const payload = {
      ...createBasePayload("B"),
      tables: [
        {
          page: 2,
          title: "Tableau menuiseries",
          headers: ["Designation", "Quantite", "Unite"],
          rows: [
            {
              row_index: 0,
              cells: ["Porte coupe-feu", "5", "u"],
            },
          ],
        },
      ],
    };

    const parsed = TakeoffExchangeSchema.parse(payload);

    expect(parsed.metadata.level).toBe("B");
    expect(parsed.tables).toHaveLength(1);
  });

  it("accepts a valid level C payload with global confidence and item evidence", () => {
    const payload = {
      ...createBasePayload("C"),
      confidence: 0.82,
      items: [
        {
          designation: "Fenetre aluminium",
          quantity: 12,
          unit: "u",
          evidence: "Comptage visuel sur plan RDC et R+1.",
        },
      ],
    };

    const parsed = TakeoffExchangeSchema.parse(payload);

    expect(parsed.metadata.level).toBe("C");
    expect(parsed.confidence).toBe(0.82);
    expect(parsed.items[0]?.evidence).toBeTruthy();
  });

  it("rejects level B payloads when tables is missing", () => {
    const parsed = TakeoffExchangeSchema.safeParse(createBasePayload("B"));

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.some((issue) => issue.path.join(".") === "tables")).toBe(true);
  });

  it("rejects level C payloads without global confidence", () => {
    const payload = {
      ...createBasePayload("C"),
      items: [
        {
          designation: "Fenetre aluminium",
          quantity: 12,
          unit: "u",
          evidence: "Comptage visuel sur plan RDC et R+1.",
        },
      ],
    };
    const parsed = TakeoffExchangeSchema.safeParse(payload);

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.some((issue) => issue.path.join(".") === "confidence")).toBe(true);
  });

  it("rejects level C payloads without evidence on each item", () => {
    const payload = {
      ...createBasePayload("C"),
      confidence: 0.62,
      items: [
        {
          designation: "Fenetre aluminium",
          quantity: 12,
          unit: "u",
        },
      ],
    };
    const parsed = TakeoffExchangeSchema.safeParse(payload);

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.some((issue) => issue.path.join(".") === "items.0.evidence")).toBe(
      true
    );
  });

  it("rejects quantity <= 0", () => {
    const payload = {
      ...createBasePayload("A"),
      items: [
        {
          designation: "Porte coupe-feu",
          quantity: 0,
          unit: "u",
        },
      ],
    };
    const parsed = TakeoffExchangeSchema.safeParse(payload);

    expect(parsed.success).toBe(false);
  });

  it("rejects empty units", () => {
    const payload = {
      ...createBasePayload("A"),
      items: [
        {
          designation: "Porte coupe-feu",
          quantity: 1,
          unit: "   ",
        },
      ],
    };
    const parsed = TakeoffExchangeSchema.safeParse(payload);

    expect(parsed.success).toBe(false);
  });

  it("rejects confidence outside [0, 1]", () => {
    const payload = {
      ...createBasePayload("C"),
      confidence: 1.2,
      items: [
        {
          designation: "Fenetre aluminium",
          quantity: 12,
          unit: "u",
          evidence: "Comptage visuel sur plan RDC et R+1.",
        },
      ],
    };
    const parsed = TakeoffExchangeSchema.safeParse(payload);

    expect(parsed.success).toBe(false);
  });

  it("rejects unknown root fields in strict mode", () => {
    const payload = {
      ...createBasePayload("A"),
      unexpected_field: true,
    };
    const parsed = TakeoffExchangeSchema.safeParse(payload);

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.some((issue) => issue.code === "unrecognized_keys")).toBe(true);
  });

  it("rejects unknown item fields in strict mode", () => {
    const payload = {
      ...createBasePayload("A"),
      items: [
        {
          designation: "Porte coupe-feu",
          quantity: 5,
          unit: "u",
          unexpected_item_field: "x",
        },
      ],
    };
    const parsed = TakeoffExchangeSchema.safeParse(payload);

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.some((issue) => issue.code === "unrecognized_keys")).toBe(true);
  });
});

describe("zodToGeminiJsonSchema", () => {
  it("returns a Gemini-compatible object schema", () => {
    const jsonSchema = zodToGeminiJsonSchema();

    expect(jsonSchema.type).toBe("object");
    expect(jsonSchema.properties).toMatchObject({
      items: expect.any(Object),
      warnings: expect.any(Object),
      metadata: expect.any(Object),
    });
    expect(jsonSchema.required).toEqual(
      expect.arrayContaining(["items", "warnings", "metadata"])
    );
    expect(jsonSchema).not.toHaveProperty("$schema");
  });

  it("preserves representable nullable-string constraints from transformed fields", () => {
    const jsonSchema = zodToGeminiJsonSchema();
    const properties = jsonSchema.properties as Record<string, unknown>;
    const itemsSchema = properties.items as Record<string, unknown>;
    const itemProperties = (itemsSchema.items as Record<string, unknown>)
      .properties as Record<string, unknown>;
    const tablesSchema = properties.tables as Record<string, unknown>;
    const tableProperties = (tablesSchema.items as Record<string, unknown>)
      .properties as Record<string, unknown>;

    expect(itemProperties.category).toEqual({
      anyOf: [{ type: "string" }, { type: "null" }],
    });
    expect(tableProperties.title).toEqual({
      anyOf: [{ type: "string" }, { type: "null" }],
    });
  });

  it("throws when a schema cannot be represented in JSON Schema", () => {
    const nonRepresentableSchema = z.object({
      issued_at: z.date(),
    });

    expect(() => zodToGeminiJsonSchema(nonRepresentableSchema)).toThrow(
      /cannot be represented/i
    );
  });
});

describe("takeoff apply mapping schemas", () => {
  it("accepts apply payload with mapping overrides", () => {
    const parsed = takeoffApplyRequestSchema.parse({
      strategy: "merge",
      target_section_id: "11111111-1111-4111-8111-111111111111",
      overrides: [
        {
          item_id: "22222222-2222-4222-8222-222222222222",
          action: "set_price",
          action_params: {
            unit_price_cents: 990,
          },
        },
      ],
    });

    expect(parsed.strategy).toBe("merge");
    expect(parsed.overrides).toHaveLength(1);
  });

  it("rejects duplicate override item_id values", () => {
    const parsed = takeoffApplyRequestSchema.safeParse({
      strategy: "append",
      overrides: [
        {
          item_id: "33333333-3333-4333-8333-333333333333",
          action: "skip",
        },
        {
          item_id: "33333333-3333-4333-8333-333333333333",
          action: "none",
        },
      ],
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("item_id uniques")
      )
    ).toBe(true);
  });

  it("accepts preview conversion response payload", () => {
    const parsed = takeoffPreviewConversionResponseSchema.parse({
      job_id: "44444444-4444-4444-8444-444444444444",
      strategy: "replace",
      target_section_id: null,
      summary: {
        total_count: 1,
        included_count: 1,
        transformed_count: 1,
        overridden_count: 0,
        excluded_by_mapping_count: 0,
        assembly_insertions_count: 0,
      },
      items: [
        {
          item_id: "55555555-5555-4555-8555-555555555555",
          source_order: 0,
          rule_id: null,
          rule_name: null,
          action: "rename",
          action_params: {
            designation: "Nouveau nom",
          },
          applied_by: "rule",
          original: {
            designation: "Ancien nom",
            quantity: 2,
            unit: "u",
            is_excluded: false,
            category_id: null,
            unit_price_cents: null,
            assembly_id: null,
          },
          transformed: {
            designation: "Nouveau nom",
            quantity: 2,
            unit: "u",
            is_excluded: false,
            category_id: null,
            unit_price_cents: null,
            assembly_id: null,
          },
        },
      ],
    });

    expect(parsed.items[0]?.action).toBe("rename");
  });
});
