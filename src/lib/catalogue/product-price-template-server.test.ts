import { beforeEach, describe, expect, it, vi } from "vitest";

// The HTTP pagination contract is exercised with the real SDK in read-all.test.ts.
// These retained domain tests supply complete query results at the reader boundary.
vi.mock("@/lib/supabase/read-all", () => import("@/test/complete-reads-fixture"));


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

    const supabase = {
      ...authenticatedClient(),
      from: vi.fn((table: string) => {
        if (table === "products") {
          return {
            select: vi.fn().mockResolvedValue({
              data: [
                {
                  id: PRODUCT_ID,
                  reference: "TUB-I4L-SOUDE-15",
                  unit: "ml",
                },
              ],
              error: null,
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

    expect(upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: PRODUCT_ID,
          reference: "TUB-I4L-SOUDE-15",
        }),
      ],
      { onConflict: "id" },
    );
    expect(insert).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("bulk_create_supplier_prices", {
      price_rows: [
        expect.objectContaining({
          product_id: PRODUCT_ID,
          supplier_id: SUPPLIER_ID,
          supplier_sku: "TS304L 21.3X1.6",
          product_url: "https://example.com/tube",
          currency: "EUR",
          valid_from: "2026-07-10",
          valid_to: "2027-01-10",
          notes: "Tarif catalogue",
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

  // Sale packagings carry their article's unit (foreign key ON UPDATE RESTRICT). Failure mode: a packaging added
  // between the check below and the write makes the file fail with « Impossible d'actualiser les produits du
  // fichier. » and no reason.
  it("says which rule refused a file whose unit change met a packaging added meanwhile", async () => {
    const upsert = vi.fn().mockResolvedValue({
      error: {
        code: "23503",
        message: 'update or delete on table "products" violates foreign key constraint "product_packagings_article_unit_fkey" on table "product_packagings"',
        details: null,
        hint: null,
      },
    });
    const insert = vi.fn().mockResolvedValue({ error: null });
    const supabase = {
      ...authenticatedClient(),
      from: vi.fn((table: string) => {
        if (table === "products") {
          return {
            select: vi.fn().mockResolvedValue({ data: [{ id: PRODUCT_ID, reference: "TUB-I4L-SOUDE-15", unit: "ml" }], error: null }),
            upsert,
            insert,
          };
        }
        if (table === "suppliers") {
          return { select: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) })) };
        }
        if (table === "product_packagings") {
          return { select: vi.fn(() => ({ in: vi.fn().mockResolvedValue({ data: [], error: null }) })) };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
      rpc: vi.fn(),
    };
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(importProductPriceTemplate({ products: [{ ...productRow, unit: "kg" }], prices: [] })).rejects.toMatchObject({
      status: 409,
      code: "PRODUCT_UNIT_HAS_PACKAGINGS",
      message:
        "Un article du fichier a des conditionnements de vente : retirez-les avant de changer son unité, leurs quantités sont exprimées dans l’unité actuelle.",
    });
    expect(insert).not.toHaveBeenCalled();
  });

  // Failure mode: a file that changes the unit of articles with packagings is refused without naming them, or after
  // some products of the file were written.
  it("refuses, before any write, a file that changes the unit of articles with packagings, and names them", async () => {
    const references = ["TUB-A", "TUB-B", "TUB-C", "TUB-D", "TUB-E", "TUB-F", "TUB-G"];
    const stored = references.map((reference, index) => ({
      id: `22222222-2222-4222-8222-22222222220${index}`, reference, unit: "ml",
    }));
    const packagingsIn = vi.fn().mockResolvedValue({
      data: stored.slice(0, 6).map((product) => ({ id: `p-${product.id}`, product_id: product.id })),
      error: null,
    });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const insert = vi.fn().mockResolvedValue({ error: null });
    const supabase = {
      ...authenticatedClient(),
      from: vi.fn((table: string) => {
        if (table === "products") return { select: vi.fn().mockResolvedValue({ data: stored, error: null }), upsert, insert };
        if (table === "suppliers") {
          return { select: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) })) };
        }
        if (table === "product_packagings") return { select: vi.fn(() => ({ in: packagingsIn })) };
        throw new Error(`Unexpected table: ${table}`);
      }),
      rpc: vi.fn(),
    };
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(importProductPriceTemplate({
      // TUB-G changes unit without packagings; a product whose unit stays is not checked.
      products: [...references.map((reference) => ({ ...productRow, reference, unit: "kg" })), { ...productRow, reference: "NEW-1" }],
      prices: [],
    })).rejects.toMatchObject({
      status: 409,
      code: "PRODUCT_UNIT_HAS_PACKAGINGS",
      message:
        "Retirez les conditionnements de vente avant de changer l’unité de ces articles : TUB-A, TUB-B, TUB-C, TUB-D, TUB-E et 1 autre.",
    });
    expect(packagingsIn).toHaveBeenCalledWith("product_id", stored.map((product) => product.id));
    expect(upsert).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
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

    const result = await importProductPriceTemplate({
      products: [productRow],
      prices: [],
    });

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
      importProductPriceTemplate({
        products: [productRow],
        prices: [priceRow],
      }),
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
        products: [
          productRow,
          { ...productRow, reference: "tub-i4l-soude-15" },
        ],
        prices: [],
      }),
    ).rejects.toMatchObject({
      code: "TEMPLATE_REFERENCES_UNRESOLVED",
      status: 400,
      message: expect.stringContaining("Produits ambigus"),
    });

    expect(upsert).not.toHaveBeenCalled();
  });
});
