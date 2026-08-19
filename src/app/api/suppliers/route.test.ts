import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { GET, POST } from "@/app/api/suppliers/route";
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

  it("GET rejects unauthenticated access", async () => {
    const { supabase } = createSuppliersSupabase({ authenticated: false });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await GET(new Request("http://localhost/api/suppliers"));
    expect(response.status).toBe(401);
  });

  it("GET lists active suppliers", async () => {
    const { supabase } = createSuppliersSupabase();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await GET(new Request("http://localhost/api/suppliers"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { items: [{ id: SUPPLIER_ID, name: "Arcus" }] },
    });
  });

  it("GET returns linked purchase-order usage", async () => {
    const { supabase } = createSuppliersSupabase({ usageCount: 2 });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await GET(
      new Request(
        `http://localhost/api/suppliers?view=usage&id=${SUPPLIER_ID}`
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { linked_orders_count: 2 },
    });
  });

  it("POST refuses supplier writes to non-admin members (403, nothing written)", async () => {
    const { supabase, inserted, updated, deleted } = createSuppliersSupabase({
      role: "engineer",
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    for (const body of [
      { action: "create", item: VALID_SUPPLIER },
      { action: "update", id: SUPPLIER_ID, item: { name: "X" } },
      { action: "delete", id: SUPPLIER_ID },
    ]) {
      const response = await POST(postRequest(body));
      expect(response.status).toBe(403);
    }
    expect(inserted).toEqual([]);
    expect(updated).toEqual([]);
    expect(deleted).toEqual([]);
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

  it("POST does not leak raw database messages to the client", async () => {
    const { supabase } = createSuppliersSupabase({
      insertResult: {
        data: null,
        error: {
          message: 'duplicate key value violates unique constraint "suppliers_name_key"',
          code: "23505",
        },
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(
      postRequest({ action: "create", item: VALID_SUPPLIER })
    );

    expect(response.status).toBe(409);
    const text = await response.text();
    expect(text).not.toContain("suppliers_name_key");
  });

  it("POST rejects a supplier without a name", async () => {
    const { supabase, inserted } = createSuppliersSupabase();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(
      postRequest({ action: "create", item: { ...VALID_SUPPLIER, name: "" } })
    );

    expect(response.status).toBe(400);
    expect(inserted).toEqual([]);
  });

  it("POST creates a supplier", async () => {
    const { supabase, inserted } = createSuppliersSupabase();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(
      postRequest({ action: "create", item: VALID_SUPPLIER })
    );

    expect(response.status).toBe(201);
    expect(inserted).toEqual([VALID_SUPPLIER]);
  });

  it("POST updates a supplier", async () => {
    const { supabase, updated } = createSuppliersSupabase();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(
      postRequest({
        action: "update",
        id: SUPPLIER_ID,
        item: { name: "Arcus MAJ" },
      })
    );

    expect(response.status).toBe(200);
    expect(updated).toEqual([{ id: SUPPLIER_ID, payload: { name: "Arcus MAJ" } }]);
  });

  it("POST deletes a supplier without linked orders", async () => {
    const { supabase, deleted, updated } = createSuppliersSupabase({
      usageCount: 0,
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(
      postRequest({ action: "delete", id: SUPPLIER_ID })
    );

    expect(response.status).toBe(200);
    expect(deleted).toEqual([SUPPLIER_ID]);
    expect(updated).toEqual([]);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { id: SUPPLIER_ID, mode: "deleted" },
    });
  });

  it("POST archives a supplier linked to purchase orders", async () => {
    const { supabase, deleted, updated } = createSuppliersSupabase({
      usageCount: 3,
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(
      postRequest({ action: "delete", id: SUPPLIER_ID })
    );

    expect(response.status).toBe(200);
    expect(deleted).toEqual([]);
    expect(updated).toEqual([
      { id: SUPPLIER_ID, payload: { is_active: false } },
    ]);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { id: SUPPLIER_ID, mode: "archived" },
    });
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
