import { describe, expect, it } from "vitest";

import { TakeoffExchangeSchema } from "@/lib/takeoff/schemas";

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
});
