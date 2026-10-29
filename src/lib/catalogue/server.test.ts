import { beforeEach, describe, expect, it, vi } from "vitest";

// The HTTP pagination contract is exercised with the real SDK in read-all.test.ts.
// These retained domain tests supply complete query results at the reader boundary.
vi.mock("@/lib/supabase/read-all", () => import("@/test/complete-reads-fixture"));


vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import {
  bulkCreateSupplierPricesAtomic,
  createMissingPriceImportEntities,
  linkMappedRowsToCatalogue,
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

  it("matches an existing product whose reference differs only by case", async () => {
    const referenceFilters: Array<{ column: string; values: unknown }> = [];
    const insertedPayloads: unknown[] = [];

    const supabase = {
      ...createAuthenticatedSupabaseBase(),
      from: vi.fn((table: string) => {
        if (table === "dpgf_rows_mapped") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue({
                    data: [
                      {
                        id: "row-1",
                        payload: {
                          reference: "  BOU.M8.40 ",
                          designation: " Boulon M8x40 ",
                        },
                      },
                    ],
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
              in: vi.fn((column: string, values: unknown) => {
                referenceFilters.push({ column, values });
                return Promise.resolve({
                  data:
                    column === "reference_normalized"
                      ? [
                          {
                            id: PRODUCT_ID,
                            reference: "bou.M8.40",
                            designation: "Boulon M8x40 inox",
                          },
                        ]
                      : [],
                  error: null,
                });
              }),
            })),
            insert: vi.fn((rows: unknown) => {
              insertedPayloads.push(rows);
              return {
                select: vi.fn().mockResolvedValue({ data: [], error: null }),
              };
            }),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
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

    expect(referenceFilters).toContainEqual({
      column: "reference_normalized",
      values: ["bou.m8.40"],
    });
    expect(referenceFilters).toContainEqual({
      column: "designation_normalized",
      values: ["boulon m8x40"],
    });
    expect(insertedPayloads).toEqual([]);
    expect(result.created_catalogue_count).toBe(0);
    expect(result.linked_count).toBe(1);
  });

  it("sends an atomic price import in one transactional RPC", async () => {
    const atomicItemTemplate = {
      supplier_id: SUPPLIER_ID,
      product_id: PRODUCT_ID,
      catalogue_item_id: undefined,
      supplier_sku: null,
      unit: null,
      min_quantity: null,
      currency: "EUR",
      valid_from: "2026-08-31",
      valid_to: null,
      source_import_id: null,
      source_mapped_row_id: null,
      source: null,
      notes: null,
      external_ref: null,
    };

    const supabase = {
      ...createAuthenticatedSupabaseBase(),
      rpc: vi.fn().mockResolvedValue({ data: 2, error: null }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await bulkCreateSupplierPricesAtomic({
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
    });

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith("bulk_create_supplier_prices", {
      price_rows: [
        expect.objectContaining({ unit_price_cents: 100, valid_to: "2027-02-28" }),
        expect.objectContaining({ unit_price_cents: 200, valid_to: "2027-02-28" }),
      ],
    });
    expect(result).toEqual({
      created_count: 2,
      mode: "atomic-rpc",
    });
  });
});
