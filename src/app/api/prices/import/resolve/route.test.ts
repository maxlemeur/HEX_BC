import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/catalogue/server", () => ({
  badRequest: (message: string) => {
    const error = new Error(message);
    Object.assign(error, {
      name: "CatalogueApiError",
      status: 400,
      code: "BAD_REQUEST",
      details: undefined,
    });
    return error;
  },
  ok: vi.fn((data: unknown, status = 200) => Response.json({ ok: true, data }, { status })),
  resolvePriceImportSuggestions: vi.fn(),
  toErrorResponse: vi.fn((error: unknown) => {
    const isZodLike =
      typeof error === "object" &&
      error !== null &&
      Array.isArray((error as { issues?: unknown }).issues);
    const status = typeof (error as { status?: unknown })?.status === "number"
      ? ((error as { status: number }).status as number)
      : isZodLike
        ? 400
        : 500;
    const code = typeof (error as { code?: unknown })?.code === "string"
      ? ((error as { code: string }).code as string)
      : isZodLike
        ? "VALIDATION_ERROR"
        : "INTERNAL_ERROR";
    const message =
      error instanceof Error ? error.message : "Une erreur interne est survenue.";
    return Response.json(
      {
        ok: false,
        error: {
          code,
          message,
        },
      },
      { status }
    );
  }),
}));

import { POST } from "@/app/api/prices/import/resolve/route";
import { resolvePriceImportSuggestions } from "@/lib/catalogue/server";

describe("POST /api/prices/import/resolve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns suggestions", async () => {
    vi.mocked(resolvePriceImportSuggestions).mockResolvedValue({
      suggestions: [
        {
          type: "supplier",
          input: "ARQUS",
          matches: [{ id: "supplier-1", value: "ARCUS", confidence: 0.9 }],
        },
      ],
    } as never);

    const response = await POST(
      new Request("http://localhost/api/prices/import/resolve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          unknownSuppliers: ["ARQUS"],
          unknownProducts: [],
        }),
      })
    );

    const body = (await response.json()) as {
      ok: boolean;
      data: {
        suggestions: Array<{ input: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.suggestions).toHaveLength(1);
    expect(vi.mocked(resolvePriceImportSuggestions)).toHaveBeenCalledWith({
      unknownSuppliers: ["ARQUS"],
      unknownProducts: [],
    });
  });

  it("returns validation error for invalid payload", async () => {
    const response = await POST(
      new Request("http://localhost/api/prices/import/resolve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          unknownSuppliers: [""],
          unknownProducts: [],
        }),
      })
    );

    const body = (await response.json()) as {
      ok: boolean;
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(vi.mocked(resolvePriceImportSuggestions)).not.toHaveBeenCalled();
  });

  it("returns permission errors from server service", async () => {
    const permissionError = new Error("Acces refuse.");
    Object.assign(permissionError, {
      status: 403,
      code: "FORBIDDEN",
    });
    vi.mocked(resolvePriceImportSuggestions).mockRejectedValue(permissionError);

    const response = await POST(
      new Request("http://localhost/api/prices/import/resolve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          unknownSuppliers: ["ARCUS"],
          unknownProducts: [],
        }),
      })
    );

    const body = (await response.json()) as {
      ok: boolean;
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns server errors from server service", async () => {
    const dbError = new Error("Erreur DB.");
    Object.assign(dbError, {
      status: 500,
      code: "DB_ERROR",
    });
    vi.mocked(resolvePriceImportSuggestions).mockRejectedValue(dbError);

    const response = await POST(
      new Request("http://localhost/api/prices/import/resolve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          unknownSuppliers: ["ARCUS"],
          unknownProducts: ["TUBE-1"],
        }),
      })
    );

    const body = (await response.json()) as {
      ok: boolean;
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("DB_ERROR");
  });
});
