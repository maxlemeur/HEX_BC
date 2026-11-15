import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  parseJsonBody,
  parseJsonBodyOrEmptyObject,
  parsePositiveIntParam,
  rejectEmptyUpdatePayload,
  resolveConcurrencyToken,
} from "@/lib/http/request";

class DomainBadRequest extends Error {}

const badRequest = (message: string) => new DomainBadRequest(message);

function jsonRequest(body: string, headers: Record<string, string> = {}) {
  return new Request("https://example.test/api", { method: "POST", body, headers });
}

describe("parseJsonBody", () => {
  it("returns the parsed body", async () => {
    await expect(parseJsonBody(jsonRequest('{"a":1}'), badRequest)).resolves.toEqual({ a: 1 });
  });

  it("throws the caller's domain error for malformed or empty JSON", async () => {
    for (const body of ["{", ""]) {
      const error = (await parseJsonBody(jsonRequest(body), badRequest).catch((caught: unknown) => caught)) as Error;
      expect(error).toBeInstanceOf(DomainBadRequest);
      expect(error.message).toBe("Payload JSON invalide.");
    }
  });
});

describe("parseJsonBodyOrEmptyObject", () => {
  it("reads an empty or blank body as an empty object", async () => {
    await expect(parseJsonBodyOrEmptyObject(jsonRequest(""), badRequest)).resolves.toEqual({});
    await expect(parseJsonBodyOrEmptyObject(jsonRequest("  \n"), badRequest)).resolves.toEqual({});
  });

  it("parses a non-empty body and rejects malformed JSON with the domain error", async () => {
    await expect(parseJsonBodyOrEmptyObject(jsonRequest('{"a":1}'), badRequest)).resolves.toEqual({ a: 1 });
    const error = (await parseJsonBodyOrEmptyObject(jsonRequest("{"), badRequest).catch((caught: unknown) => caught)) as Error;
    expect(error).toBeInstanceOf(DomainBadRequest);
    expect(error.message).toBe("Payload JSON invalide.");
  });
});

describe("parsePositiveIntParam", () => {
  it("returns null when the parameter is absent or empty", () => {
    expect(parsePositiveIntParam(null, badRequest)).toBeNull();
    expect(parsePositiveIntParam("", badRequest)).toBeNull();
  });

  it("keeps parseInt semantics for positive values", () => {
    expect(parsePositiveIntParam("25", badRequest)).toBe(25);
    expect(parsePositiveIntParam("12abc", badRequest)).toBe(12);
    expect(parsePositiveIntParam("3.9", badRequest)).toBe(3);
  });

  it("rejects zero, negative and non-numeric values with the domain error", () => {
    for (const value of ["0", "-4", "abc", " "]) {
      expect(() => parsePositiveIntParam(value, badRequest)).toThrow(DomainBadRequest);
      expect(() => parsePositiveIntParam(value, badRequest)).toThrow("Paramètre limit invalide.");
    }
  });
});

describe("resolveConcurrencyToken", () => {
  it("prefers a non-blank If-Match header, trimmed", () => {
    const request = jsonRequest("{}", { "If-Match": "  2026-11-16T10:00:00Z " });
    expect(resolveConcurrencyToken(request, "body-token")).toBe("2026-11-16T10:00:00Z");
  });

  it("falls back to the trimmed body token, then undefined", () => {
    expect(resolveConcurrencyToken(jsonRequest("{}", { "If-Match": "   " }), " body-token ")).toBe("body-token");
    expect(resolveConcurrencyToken(jsonRequest("{}"), "   ")).toBeUndefined();
    expect(resolveConcurrencyToken(jsonRequest("{}"))).toBeUndefined();
  });
});

describe("rejectEmptyUpdatePayload", () => {
  const schema = z.object({ name: z.string().optional() }).superRefine(rejectEmptyUpdatePayload);

  it("accepts a payload with at least one field", () => {
    expect(schema.parse({ name: "Lot 1" })).toEqual({ name: "Lot 1" });
  });

  it("rejects an empty payload with a root-level custom issue", () => {
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ code: "custom", message: "Aucun champ de mise à jour fourni.", path: [] }),
    ]);
  });
});
