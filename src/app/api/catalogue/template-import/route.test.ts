import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/catalogue/product-price-template-server", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/catalogue/product-price-template-server")
  >();
  return {
    ...actual,
    importProductPriceTemplate: vi.fn(),
  };
});

import { POST } from "@/app/api/catalogue/template-import/route";
import { importProductPriceTemplate } from "@/lib/catalogue/product-price-template-server";

const validProduct = {
  reference: "TUB-15",
  designation: "Tube DN15",
  category: "Tuyauterie",
  product_type: "Tube",
  material: "Inox",
  grade: "304L",
  dimensions: "DN15",
  standard: "EN 10217-7",
  unit: "ml",
  unit_price_cents: 350,
  is_active: true,
};

describe("POST /api/catalogue/template-import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("imports a validated template payload", async () => {
    vi.mocked(importProductPriceTemplate).mockResolvedValue({
      created_products: 1,
      updated_products: 0,
      created_prices: 0,
      skipped_prices: 0,
    });

    const response = await POST(
      new Request("http://localhost/api/catalogue/template-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ products: [validProduct], prices: [] }),
      })
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        created_products: 1,
        updated_products: 0,
        created_prices: 0,
        skipped_prices: 0,
      },
    });
    expect(importProductPriceTemplate).toHaveBeenCalledWith({
      products: [validProduct],
      prices: [],
    });
  });

  it("rejects an empty import", async () => {
    const response = await POST(
      new Request("http://localhost/api/catalogue/template-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ products: [], prices: [] }),
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" },
    });
    expect(importProductPriceTemplate).not.toHaveBeenCalled();
  });
});
