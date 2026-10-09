import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  TakeoffExchangeSchema,
  takeoffApplyRequestSchema,
  zodToGeminiJsonSchema,
} from "@/lib/takeoff/schemas";

const GEMINI_RESPONSE_SCHEMA_KEYS = new Set([
  "type",
  "format",
  "title",
  "description",
  "nullable",
  "enum",
  "maxItems",
  "minItems",
  "properties",
  "required",
  "minProperties",
  "maxProperties",
  "minLength",
  "maxLength",
  "pattern",
  "example",
  "anyOf",
  "propertyOrdering",
  "default",
  "items",
  "minimum",
  "maximum",
]);

function collectUnsupportedGeminiSchemaKeys(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectUnsupportedGeminiSchemaKeys(item));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const result: string[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (!GEMINI_RESPONSE_SCHEMA_KEYS.has(key)) {
      result.push(key);
      continue;
    }

    if (
      (key === "default" || key === "example") ||
      (key === "properties" && item && typeof item === "object" && !Array.isArray(item))
    ) {
      if (key === "properties") {
        result.push(
          ...Object.values(item as Record<string, unknown>).flatMap((propertySchema) =>
            collectUnsupportedGeminiSchemaKeys(propertySchema)
          )
        );
      }
      continue;
    }

    result.push(...collectUnsupportedGeminiSchemaKeys(item));
  }

  return result;
}

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
        message: "Quantité deduite d'un libelle ambigu.",
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
          confidence: 0.74,
          source_page: 3,
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
          confidence: 0.74,
          source_page: 3,
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

  it("rejects level C payloads without item confidence", () => {
    const payload = {
      ...createBasePayload("C"),
      confidence: 0.62,
      items: [
        {
          designation: "Fenetre aluminium",
          quantity: 12,
          unit: "u",
          source_page: 3,
          evidence: "Comptage visuel sur plan RDC et R+1.",
        },
      ],
    };
    const parsed = TakeoffExchangeSchema.safeParse(payload);

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) => issue.path.join(".") === "items.0.confidence")
    ).toBe(true);
  });

  it("rejects level C payloads without item source_page", () => {
    const payload = {
      ...createBasePayload("C"),
      confidence: 0.62,
      items: [
        {
          designation: "Fenetre aluminium",
          quantity: 12,
          unit: "u",
          confidence: 0.74,
          evidence: "Comptage visuel sur plan RDC et R+1.",
        },
      ],
    };
    const parsed = TakeoffExchangeSchema.safeParse(payload);

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) => issue.path.join(".") === "items.0.source_page")
    ).toBe(true);
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
          confidence: 0.74,
          source_page: 3,
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
    expect(jsonSchema).not.toHaveProperty("additionalProperties");
    expect(
      JSON.stringify(jsonSchema).includes("\"additionalProperties\"")
    ).toBe(false);
    expect(collectUnsupportedGeminiSchemaKeys(jsonSchema)).toEqual([]);
  });

  it("converts strict numeric bounds to Gemini-compatible inclusive bounds", () => {
    const jsonSchema = zodToGeminiJsonSchema(
      z.object({
        quantity: z.number().gt(0),
        floor: z.number().int().gt(2),
        ratio: z.number().lt(1),
      })
    );
    const properties = jsonSchema.properties as Record<
      string,
      Record<string, unknown>
    >;

    expect(properties.quantity).toMatchObject({ type: "number", minimum: 0 });
    expect(properties.floor).toMatchObject({ type: "integer", minimum: 3 });
    expect(properties.ratio).toMatchObject({ type: "number", maximum: 1 });
    expect(JSON.stringify(jsonSchema)).not.toContain("exclusiveMinimum");
    expect(JSON.stringify(jsonSchema)).not.toContain("exclusiveMaximum");
    expect(collectUnsupportedGeminiSchemaKeys(jsonSchema)).toEqual([]);
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

  it("rejects override_justification without override=true", () => {
    const parsed = takeoffApplyRequestSchema.safeParse({
      strategy: "append",
      override_justification: "Validation manuelle",
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(
      parsed.error.issues.some((issue) =>
        issue.message.includes("override_justification ne peut être fourni")
      )
    ).toBe(true);
  });
});
