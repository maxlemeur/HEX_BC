import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { bulkUpsertMaterialIndices, linkMappedRowsToCatalogue } from "@/lib/catalogue/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const IMPORT_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "55555555-5555-4555-8555-555555555555";
const PRODUCT_ID = "66666666-6666-4666-8666-666666666666";

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
});
