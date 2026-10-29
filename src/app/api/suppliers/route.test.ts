import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { POST } from "@/app/api/suppliers/route";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SUPPLIER_ID = "22222222-2222-4222-8222-222222222222";

const VALID_SUPPLIER = {
  name: "Arcus",
  address: "1 rue Test",
  city: "Rambouillet",
  postal_code: "78120",
  country: "France",
  email: "contact@arcus.test",
  phone: "0102030405",
  contact_name: "Nadia",
  siret: "12345678900011",
  vat_number: "FR12345678901",
  payment_terms: "30 jours",
  is_active: true,
};

type QueryResult = {
  data?: unknown;
  error?: { message: string; code?: string } | null;
  count?: number | null;
};

const TENANT_ID = "33333333-3333-4333-8333-333333333333";

function membershipBuilder(role: "admin" | "engineer" | "viewer") {
  const result = {
    data: [
      {
        id: "membership-1",
        tenant_id: TENANT_ID,
        user_id: USER_ID,
        role,
        is_default: true,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        tenants: { is_active: true },
      },
    ],
    error: null,
  };
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.then = (
    resolve: (value: typeof result) => unknown,
    reject: (reason: unknown) => unknown
  ) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

function createSuppliersSupabase(options: {
  authenticated?: boolean;
  role?: "admin" | "engineer" | "viewer";
  listResult?: QueryResult;
  insertResult?: QueryResult;
  updateResult?: QueryResult;
  deleteResult?: QueryResult;
  archiveRows?: Array<{ id: string }>;
  deleteRows?: Array<{ id: string }>;
  usageCount?: number;
} = {}) {
  const inserted: unknown[] = [];
  const updated: Array<{ id: string; payload: unknown }> = [];
  const deleted: string[] = [];

  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: options.authenticated === false ? null : { id: USER_ID },
        },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === "tenant_memberships") {
        return membershipBuilder(options.role ?? "admin");
      }

      if (table === "purchase_orders") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(async () => ({
              data: null,
              error: null,
              count: options.usageCount ?? 0,
            })),
          })),
        };
      }

      if (table !== "suppliers") {
        throw new Error(`Unexpected table: ${table}`);
      }

      const listBuilder = {
        eq: vi.fn(() => listBuilder),
        order: vi.fn(async () => options.listResult ?? {
          data: [{ id: SUPPLIER_ID, ...VALID_SUPPLIER }],
          error: null,
        }),
      };

      return {
        select: vi.fn(() => listBuilder),
        insert: vi.fn((payload: unknown) => {
          inserted.push(payload);
          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => options.insertResult ?? {
                data: { id: SUPPLIER_ID, ...VALID_SUPPLIER },
                error: null,
              }),
            })),
          };
        }),
        update: vi.fn((payload: unknown) => ({
          eq: vi.fn((_column: string, id: string) => {
            updated.push({ id, payload });
            const result = options.updateResult ?? {
              data: { id, ...VALID_SUPPLIER, ...(payload as object) },
              error: null,
            };
            const rows = {
              data: result.error ? null : options.archiveRows ?? [{ id }],
              error: result.error ?? null,
            };
            const selected = {
              maybeSingle: vi.fn(async () => result),
              then: (
                resolve: (value: typeof rows) => unknown,
                reject: (reason: unknown) => unknown
              ) => Promise.resolve(rows).then(resolve, reject),
            };
            return {
              select: vi.fn(() => selected),
              then: (
                resolve: (value: typeof result) => unknown,
                reject: (reason: unknown) => unknown
              ) => Promise.resolve(result).then(resolve, reject),
            };
          }),
        })),
        delete: vi.fn(() => ({
          eq: vi.fn((_column: string, id: string) => {
            deleted.push(id);
            const result = options.deleteResult ?? {
              data: options.deleteRows ?? [{ id }],
              error: null,
            };
            return {
              select: vi.fn(async () => result),
              then: (
                resolve: (value: typeof result) => unknown,
                reject: (reason: unknown) => unknown
              ) => Promise.resolve(result).then(resolve, reject),
            };
          }),
        })),
      };
    }),
  };

  return { supabase, inserted, updated, deleted };
}

function postRequest(body: unknown) {
  return new Request("http://localhost/api/suppliers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/suppliers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POST does not report success when an archive affects no row", async () => {
    const { supabase } = createSuppliersSupabase({
      usageCount: 3,
      archiveRows: [],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(
      postRequest({ action: "delete", id: SUPPLIER_ID })
    );

    expect(response.status).toBe(404);
  });

  it("POST archives when delete hits a foreign-key constraint", async () => {
    const { supabase, updated } = createSuppliersSupabase({
      usageCount: 0,
      deleteResult: {
        error: { message: "foreign key", code: "23503" },
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(
      postRequest({ action: "delete", id: SUPPLIER_ID })
    );

    expect(response.status).toBe(200);
    expect(updated).toEqual([
      { id: SUPPLIER_ID, payload: { is_active: false } },
    ]);
  });
});
