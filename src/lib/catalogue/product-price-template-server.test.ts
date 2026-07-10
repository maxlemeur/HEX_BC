import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { importProductPriceTemplate } from "@/lib/catalogue/product-price-template-server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";
const SUPPLIER_ID = "33333333-3333-4333-8333-333333333333";

const productRow = {
  reference: "TUB-I4L-SOUDE-15",
  designation: "Tube inox 304L soude DN15",
  category: "Tuyauterie",
  product_type: "Tube",
  material: "Inox",
  grade: "304L",
  dimensions: "DN15 - 21,3x1,6",
  standard: "EN 10217-7",
  unit: "ml",
  unit_price_cents: 337,
  tax_rate_bp: 2000,
  is_active: true as const,
};

const priceRow = {
  product_reference: "tub-i4l-soude-15",
  supplier_name: "arcus",
  supplier_sku: "TS304L 21.3X1.6",
  unit_price_cents: 338,
  unit: "ml",
  currency: "eur",
  valid_from: "2026-07-10",
  min_quantity: 1,
  source_url: "https://example.com/tube",
  comment: "Tarif catalogue",
};

function authenticatedClient() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: USER_ID } },
        error: null,
      }),
    },
  };
}

describe("product price template server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts products with their existing reference casing and imports resolved prices", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const insert = vi.fn().mockResolvedValue({ error: null });
    const rpc = vi.fn().mockResolvedValue({ data: 1, error: null });
    let productSelectCount = 0;

    const supabase = {
      ...authenticatedClient(),
      from: vi.fn((table: string) => {
        if (table === "products") {
          return {
            select: vi.fn(() => {
              productSelectCount += 1;
              return Promise.resolve({
                data: [
                  {
                    id: PRODUCT_ID,
                    reference: "TUB-I4L-SOUDE-15",
                  },
                ],
                error: null,
              });
            }),
            upsert,
            insert,
          };
        }

        if (table === "suppliers") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({
                data: [{ id: SUPPLIER_ID, name: "Arcus" }],
                error: null,
              }),
            })),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
      rpc,
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await importProductPriceTemplate({
      products: [{ ...productRow, reference: "tub-i4l-soude-15" }],
      prices: [priceRow],
    });

    expect(productSelectCount).toBe(2);
    expect(upsert).toHaveBeenCalledWith(
      [expect.objectContaining({ id: PRODUCT_ID, reference: "TUB-I4L-SOUDE-15" })],
      { onConflict: "id" }
    );
    expect(insert).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("bulk_create_supplier_prices", {
      price_rows: [
        expect.objectContaining({
          product_id: PRODUCT_ID,
          supplier_id: SUPPLIER_ID,
          supplier_sku: "TS304L 21.3X1.6",
          currency: "EUR",
          valid_from: "2026-07-10",
          notes: "Source: https://example.com/tube\nTarif catalogue",
        }),
      ],
    });
    expect(result).toEqual({
      created_products: 0,
      updated_products: 1,
      created_prices: 1,
      skipped_prices: 0,
    });
  });

  it("inserts new products without relying on the partial reference index", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const upsert = vi.fn();
    let productSelectCount = 0;
    const supabase = {
      ...authenticatedClient(),
      from: vi.fn((table: string) => {
        if (table === "products") {
          return {
            select: vi.fn(() => {
              productSelectCount += 1;
              return Promise.resolve({
                data:
                  productSelectCount === 1
                    ? []
                    : [{ id: PRODUCT_ID, reference: productRow.reference }],
                error: null,
              });
            }),
            insert,
            upsert,
          };
        }

        if (table === "suppliers") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            })),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
      rpc: vi.fn(),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await importProductPriceTemplate({ products: [productRow], prices: [] });

    expect(insert).toHaveBeenCalledWith([
      expect.objectContaining({
        reference: productRow.reference,
        designation: productRow.designation,
      }),
    ]);
    expect(upsert).not.toHaveBeenCalled();
    expect(result).toEqual({
      created_products: 1,
      updated_products: 0,
      created_prices: 0,
      skipped_prices: 0,
    });
  });

  it("blocks unknown suppliers before writing products", async () => {
    const upsert = vi.fn();
    const rpc = vi.fn();
    const supabase = {
      ...authenticatedClient(),
      from: vi.fn((table: string) => {
        if (table === "products") {
          return {
            select: vi.fn().mockResolvedValue({ data: [], error: null }),
            upsert,
          };
        }

        if (table === "suppliers") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            })),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
      rpc,
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      importProductPriceTemplate({ products: [productRow], prices: [priceRow] })
    ).rejects.toMatchObject({
      code: "TEMPLATE_REFERENCES_UNRESOLVED",
      status: 400,
      message: expect.stringContaining("Fournisseurs inconnus: arcus"),
    });

    expect(upsert).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("blocks case-insensitive product collisions even without prices", async () => {
    const upsert = vi.fn();
    const supabase = {
      ...authenticatedClient(),
      from: vi.fn((table: string) => {
        if (table === "products") {
          return {
            select: vi.fn().mockResolvedValue({ data: [], error: null }),
            upsert,
          };
        }

        if (table === "suppliers") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            })),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      importProductPriceTemplate({
        products: [productRow, { ...productRow, reference: "tub-i4l-soude-15" }],
        prices: [],
      })
    ).rejects.toMatchObject({
      code: "TEMPLATE_REFERENCES_UNRESOLVED",
      status: 400,
      message: expect.stringContaining("Produits ambigus"),
    });

    expect(upsert).not.toHaveBeenCalled();
  });

  it("requires an authenticated user", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: null,
        }),
      },
    } as never);

    await expect(
      importProductPriceTemplate({ products: [productRow], prices: [] })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
  });
});
