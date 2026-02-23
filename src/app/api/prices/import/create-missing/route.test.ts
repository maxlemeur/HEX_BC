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
  createMissingPriceImportEntities: vi.fn(),
  ok: vi.fn((data: unknown, status = 200) => Response.json({ ok: true, data }, { status })),
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

import { POST } from "@/app/api/prices/import/create-missing/route";
import { createMissingPriceImportEntities } from "@/lib/catalogue/server";

describe("POST /api/prices/import/create-missing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates missing suppliers and products", async () => {
    vi.mocked(createMissingPriceImportEntities).mockResolvedValue({
      createdSuppliers: [{ id: "supplier-1", name: "ARCUS" }],
      createdProducts: [
        {
          id: "product-1",
          reference: "Tub.I4S.15",
          designation: "Tub.I4S.15",
        },
      ],
    } as never);

    const response = await POST(
      new Request("http://localhost/api/prices/import/create-missing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          suppliersToCreate: ["ARCUS"],
          productsToCreate: ["Tub.I4S.15"],
        }),
      })
    );

    const body = (await response.json()) as {
      ok: boolean;
      data: {
        createdSuppliers: unknown[];
        createdProducts: unknown[];
      };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.createdSuppliers).toHaveLength(1);
    expect(body.data.createdProducts).toHaveLength(1);
    expect(vi.mocked(createMissingPriceImportEntities)).toHaveBeenCalledWith({
      suppliersToCreate: ["ARCUS"],
      productsToCreate: ["Tub.I4S.15"],
    });
  });

  it("returns validation error for invalid payload", async () => {
    const response = await POST(
      new Request("http://localhost/api/prices/import/create-missing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          suppliersToCreate: [""],
          productsToCreate: [],
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
    expect(vi.mocked(createMissingPriceImportEntities)).not.toHaveBeenCalled();
  });

  it("returns permission errors from server service", async () => {
    const permissionError = new Error("Acces refuse.");
    Object.assign(permissionError, {
      status: 403,
      code: "FORBIDDEN",
    });
    vi.mocked(createMissingPriceImportEntities).mockRejectedValue(permissionError);

    const response = await POST(
      new Request("http://localhost/api/prices/import/create-missing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          suppliersToCreate: ["ARCUS"],
          productsToCreate: [],
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
    vi.mocked(createMissingPriceImportEntities).mockRejectedValue(dbError);

    const response = await POST(
      new Request("http://localhost/api/prices/import/create-missing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          suppliersToCreate: ["ARCUS"],
          productsToCreate: ["TUBE-1"],
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
