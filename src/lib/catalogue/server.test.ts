import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import {
  bulkCreateSupplierPricesAtomic,
  bulkUpsertMaterialIndices,
  createMissingPriceImportEntities,
  linkMappedRowsToCatalogue,
  listCataloguePage,
  listPriceLookups,
  listSupplierPricesPage,
} from "@/lib/catalogue/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const IMPORT_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "55555555-5555-4555-8555-555555555555";
const PRODUCT_ID = "66666666-6666-4666-8666-666666666666";
const SUPPLIER_ID = "77777777-7777-4777-8777-777777777777";

function createAuthenticatedSupabaseBase() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            id: USER_ID,
          },
        },
        error: null,
      }),
    },
  };
}

describe("catalogue server regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("escapes ilike wildcard characters when checking missing suppliers/products", async () => {
    const supplierIlikeCalls: Array<{ column: string; pattern: string }> = [];
    const productIlikeCalls: Array<{ column: string; pattern: string }> = [];

    const supplierInsertMock = vi.fn();
    const productInsertMock = vi.fn();

    const supabase = {
      ...createAuthenticatedSupabaseBase(),
      from: vi.fn((table: string) => {
        if (table === "suppliers") {
          return {
            select: vi.fn(() => ({
              ilike: vi.fn((column: string, pattern: string) => {
                supplierIlikeCalls.push({ column, pattern });
                return {
                  limit: vi.fn().mockResolvedValue({
                    data: [{ id: "supplier-existing", name: "ACME_100%" }],
                    error: null,
                  }),
                };
              }),
            })),
            insert: supplierInsertMock,
          };
        }

        if (table === "products") {
          return {
            select: vi.fn(() => ({
              ilike: vi.fn((column: string, pattern: string) => {
                productIlikeCalls.push({ column, pattern });
                return {
                  limit: vi.fn().mockResolvedValue({
                    data: [{ id: "product-existing", reference: "ABC_123%" }],
                    error: null,
                  }),
                };
              }),
            })),
            insert: productInsertMock,
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await createMissingPriceImportEntities({
      suppliersToCreate: [" ACME_100% "],
      productsToCreate: [" ABC_123% "],
    });

    expect(supplierIlikeCalls).toEqual([
      {
        column: "name",
        pattern: "ACME\\_100\\%",
      },
    ]);
    expect(productIlikeCalls).toEqual([
      {
        column: "reference",
        pattern: "ABC\\_123\\%",
      },
    ]);
    expect(supplierInsertMock).not.toHaveBeenCalled();
    expect(productInsertMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      createdSuppliers: [],
      createdProducts: [],
    });
  });

  it("deduplicates created catalogue rows by reference during mapped-row linking", async () => {
    const insertedPayloads: unknown[] = [];

    const mappedRows = [
      {
        id: "row-1",
        payload: {
          reference: "REF-001",
          designation: "Designation A",
        },
      },
      {
        id: "row-2",
        payload: {
          reference: "REF-001",
          designation: "Designation B",
        },
      },
    ];

    const supabase = {
      ...createAuthenticatedSupabaseBase(),
      from: vi.fn((table: string) => {
        if (table === "dpgf_rows_mapped") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue({
                    data: mappedRows,
                    error: null,
                  }),
                })),
              })),
            })),
          };
        }

        if (table === "products") {
          return {
            select: vi.fn(() => ({
              in: vi.fn().mockResolvedValue({
                data: [],
                error: null,
              }),
            })),
            insert: vi.fn((rows: unknown) => {
              insertedPayloads.push(rows);
              return {
                select: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: PRODUCT_ID,
                      reference: "REF-001",
                      designation: "Designation A",
                    },
                  ],
                  error: null,
                }),
              };
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: null,
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await linkMappedRowsToCatalogue({
      action: "link-mapped-rows",
      import_id: IMPORT_ID,
      limit: 1000,
      create_missing: true,
      update_payload: false,
      dry_run: false,
    });

    expect(insertedPayloads).toHaveLength(1);

    const firstInsert = insertedPayloads[0];
    expect(Array.isArray(firstInsert)).toBe(true);
    if (!Array.isArray(firstInsert)) return;

    expect(firstInsert).toHaveLength(1);
    expect(result.created_catalogue_count).toBe(1);
    expect(result.linked_count).toBe(2);
  });

  it("uses tenant-scoped conflict target in fallback material index bulk upsert", async () => {
    const onConflictTargets: string[] = [];

    const supabase = {
      ...createAuthenticatedSupabaseBase(),
      from: vi.fn((table: string) => {
        if (table === "material_indices") {
          return {
            upsert: vi.fn((_rows: unknown, options: { onConflict: string }) => {
              onConflictTargets.push(options.onConflict);
              return {
                select: vi.fn().mockResolvedValue({
                  data: [{ id: "index-1" }],
                  error: null,
                }),
              };
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: "PGRST202",
          message: "Could not find the function",
          details: null,
        },
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await bulkUpsertMaterialIndices(
      [
        {
          index_code: "INDEX-01",
          label: "Index Label",
          index_value: 123.45,
          index_date: "2026-02-01",
        },
      ] as unknown as Parameters<typeof bulkUpsertMaterialIndices>[0]
    );

    expect(onConflictTargets).toEqual(["tenant_id,index_code,index_date"]);
    expect(result.mode).toBe("fallback-upsert");
    expect(result.upserted_count).toBe(1);
  });

  it("rolls back previously inserted atomic price batches when a later batch fails", async () => {
    const rollbackCalls: Array<{ column: string; marker: string }> = [];
    const cleanupCalls: Array<{ column: string; marker: string }> = [];
    const atomicItemTemplate = {
      supplier_id: SUPPLIER_ID,
      product_id: PRODUCT_ID,
      catalogue_item_id: undefined,
      supplier_sku: null,
      unit: null,
      min_quantity: null,
      currency: "EUR",
      valid_from: null,
      valid_to: null,
      source_import_id: null,
      source_mapped_row_id: null,
      source: null,
      notes: null,
      external_ref: null,
    };

    const supabase = {
      ...createAuthenticatedSupabaseBase(),
      rpc: vi
        .fn()
        .mockResolvedValueOnce({
          data: 1,
          error: null,
        })
        .mockResolvedValueOnce({
          data: null,
          error: {
            code: "23505",
            message: "duplicate key value violates unique constraint",
            details: null,
          },
        }),
      from: vi.fn((table: string) => {
        if (table !== "supplier_pricebook") {
          throw new Error(`Unexpected table: ${table}`);
        }

        return {
          delete: vi.fn(() => ({
            eq: vi.fn((column: string, marker: string) => {
              rollbackCalls.push({ column, marker });
              return Promise.resolve({
                error: null,
              });
            }),
          })),
          update: vi.fn(() => ({
            eq: vi.fn((column: string, marker: string) => {
              cleanupCalls.push({ column, marker });
              return Promise.resolve({
                error: null,
              });
            }),
          })),
        };
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      bulkCreateSupplierPricesAtomic({
        action: "bulk-create-atomic",
        batch_size: 1,
        items: [
          {
            ...atomicItemTemplate,
            unit_price_cents: 100,
          },
          {
            ...atomicItemTemplate,
            unit_price_cents: 200,
          },
        ],
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining("Import annule: Echec du lot 2/2"),
    });

    expect(supabase.rpc).toHaveBeenCalledTimes(2);
    expect(rollbackCalls).toHaveLength(1);
    expect(rollbackCalls[0]).toMatchObject({
      column: "notes",
    });
    expect(rollbackCalls[0]?.marker).toMatch(/^__hex_atomic_price_import__:/);
    expect(cleanupCalls).toHaveLength(0);
  });

  it("maps the paginated product RPC without changing the requested page", async () => {
    const rpc = vi.fn((name: string, args?: Record<string, unknown>) => {
      if (name === "catalogue_products_page") {
        return Promise.resolve({
          data: [
            {
              id: PRODUCT_ID,
              designation: "Tube acier",
              reference: "TUBE-01",
              unit_price_cents: 1200,
              tax_rate_bp: 2000,
              is_active: true,
              price_status: "fresh",
              supplier_price_count: "2",
              best_supplier_price_cents: 1100,
              best_supplier_name: "Arcus",
              total_count: "52",
            },
          ],
          error: null,
        });
      }
      if (name === "catalogue_products_summary") {
        return Promise.resolve({
          data: [
            {
              active_count: "50",
              covered_count: "42",
              without_supplier_price_count: "10",
              stale_count: "3",
              materials: ["Acier"],
              categories: ["Tube"],
              units: ["ml"],
            },
          ],
          error: null,
        });
      }
      throw new Error(`Unexpected RPC: ${name} ${JSON.stringify(args)}`);
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      ...createAuthenticatedSupabaseBase(),
      rpc,
    } as never);

    const result = await listCataloguePage({
      q: "tube",
      material: ["Acier"],
      category: [],
      unit: [],
      price_status: [],
      status: ["active"],
      sort: "designation",
      dir: "asc",
      page: 2,
      size: 25,
    });

    expect(rpc).toHaveBeenCalledWith(
      "catalogue_products_page",
      expect.objectContaining({ p_page: 2, p_size: 25, p_materials: ["Acier"] })
    );
    expect(result.pagination).toEqual({ page: 2, size: 25, totalItems: 52, totalPages: 3 });
    expect(result.items[0]).toMatchObject({
      id: PRODUCT_ID,
      _priceStatus: "fresh",
      _supplierPriceCount: 2,
      _bestSupplierName: "Arcus",
    });
  });

  it("maps paginated prices and keeps the freshness boundary supplied by SQL", async () => {
    const rpc = vi.fn((name: string) => {
      if (name === "supplier_prices_page") {
        return Promise.resolve({
          data: [
            {
              id: "88888888-8888-4888-8888-888888888888",
              supplier_id: SUPPLIER_ID,
              product_id: PRODUCT_ID,
              unit_price_cents: 980,
              supplier_name: "Arcus",
              product_name: "Tube acier",
              freshness: "aging",
              age_days: 31,
              total_count: 1,
            },
          ],
          error: null,
        });
      }
      if (name === "supplier_prices_summary") {
        return Promise.resolve({
          data: [
            {
              total_count: 1,
              fresh_count: 0,
              aging_count: 1,
              stale_count: 0,
              unique_suppliers_count: 1,
            },
          ],
          error: null,
        });
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      ...createAuthenticatedSupabaseBase(),
      rpc,
    } as never);

    const result = await listSupplierPricesPage({
      q: "",
      freshness: ["aging"],
      supplier_id: null,
      product_id: null,
      sort: "updated_at",
      dir: "desc",
      page: 1,
      size: 25,
    });

    expect(result.items[0]).toMatchObject({
      _supplierName: "Arcus",
      _productName: "Tube acier",
      _freshnessLevel: "aging",
      _ageDays: 31,
    });
    expect(result.counters).toMatchObject({ fresh: 0, aging: 1, stale: 0 });
  });

  it("returns selected remote lookup options with the bounded RPC limit", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ kind: "supplier", id: SUPPLIER_ID, label: "Arcus", reference: null }],
      error: null,
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      ...createAuthenticatedSupabaseBase(),
      rpc,
    } as never);

    const result = await listPriceLookups({
      kind: "supplier",
      q: "arc",
      selected_id: SUPPLIER_ID,
      limit: 50,
    });

    expect(rpc).toHaveBeenCalledWith("price_lookup_options", {
      p_kind: "supplier",
      p_q: "arc",
      p_selected_id: SUPPLIER_ID,
      p_limit: 50,
    });
    expect(result.suppliers).toEqual([{ id: SUPPLIER_ID, name: "Arcus" }]);
  });
});
