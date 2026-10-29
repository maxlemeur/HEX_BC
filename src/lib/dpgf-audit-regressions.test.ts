import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// K-01: Error response sanitization across all 3 server modules
// ---------------------------------------------------------------------------

describe("K-01: error response sanitization", () => {
  describe("imports/server", () => {
    it("does not expose details in the client response body", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { toErrorResponse, badRequest } = await import("@/lib/imports/server");

      const err = badRequest("Payload invalide", { table: "dpgf_imports", column: "user_id" });
      const response = toErrorResponse(err);
      const body = (await response.json()) as Record<string, unknown>;

      // client body must NOT contain details
      const error = body.error as Record<string, unknown>;
      expect(error).not.toHaveProperty("details");
      expect(error.code).toBeDefined();
      expect(error.message).toBeDefined();

      // server-side log must contain the details
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("[imports] API error details"),
        expect.objectContaining({ table: "dpgf_imports" })
      );

      errorSpy.mockRestore();
    });
  });

  describe("catalogue/server", () => {
    it("does not expose details in the client response body", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { toErrorResponse, badRequest } = await import("@/lib/catalogue/server");

      const err = badRequest("Payload invalide", { table: "catalogue_items" });
      const response = toErrorResponse(err);
      const body = (await response.json()) as Record<string, unknown>;

      const error = body.error as Record<string, unknown>;
      expect(error).not.toHaveProperty("details");

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("[catalogue] API error details"),
        expect.objectContaining({ table: "catalogue_items" })
      );

      errorSpy.mockRestore();
    });
  });

  describe("mappings/server", () => {
    it("does not expose details in the client response body", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { toErrorResponse, badRequest } = await import("@/lib/mappings/server");

      const err = badRequest("Payload invalide", { field: "mapping" }, "BAD_PAYLOAD");
      const response = toErrorResponse(err);
      const body = (await response.json()) as Record<string, unknown>;

      const error = body.error as Record<string, unknown>;
      expect(error).not.toHaveProperty("details");

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("[mappings] API error details"),
        expect.objectContaining({ field: "mapping" })
      );

      errorSpy.mockRestore();
    });
  });
});

// ---------------------------------------------------------------------------
// JSON rows retained by the canonical import pipeline
// ---------------------------------------------------------------------------

describe("canonical JSON row normalization", () => {
  it("normalizeRowsFromJson filters out all-null rows", async () => {
    const { normalizeRowsFromJson } = await import("@/lib/imports/parser");

    const result = normalizeRowsFromJson([
      { code: "A", name: "Test" },
      { code: null, name: null },
      { code: "B", name: "Other" },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toHaveProperty("code", "A");
    expect(result[1]).toHaveProperty("code", "B");
  });
});
