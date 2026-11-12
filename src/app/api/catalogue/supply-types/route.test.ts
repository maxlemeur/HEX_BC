import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { GET, POST } from "@/app/api/catalogue/supply-types/route";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Failure modes (TI-690):
 *  1. RLS lets any member write supply types: without the application check, an engineer or a viewer
 *     grows the referential shared by every estimate of the tenant;
 *  2. the list reads every tenant the user belongs to, not the active one;
 *  3. the creation is a lookup followed by an insert, so two administrators creating "Tube" and "Tubes"
 *     at the same moment both succeed: it must be ONE database call (the function checks and inserts
 *     under a lock; its rules are tested in pgTAP, product-catalogue-status.test.sql);
 *  4. the database's refusal reaches the operator as a raw code instead of naming the existing type.
 */

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "33333333-3333-4333-8333-333333333333";

type Role = "admin" | "engineer" | "viewer";
type ExistingType = { id: string; code: string; name: string };
type RpcResult = { data: ExistingType | null; error: { message: string; details?: string; code?: string } | null };

function thenable<T>(result: T, methods: string[], calls: Array<[string, unknown[]]>) {
  const builder: Record<string, unknown> = {};
  for (const method of methods) {
    builder[method] = vi.fn((...args: unknown[]) => {
      calls.push([method, args]);
      return builder;
    });
  }
  builder.then = (resolve: (value: T) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function createSupabase(options: { role?: Role; existing?: ExistingType[]; rpcResult?: RpcResult } = {}) {
  const readCalls: Array<[string, unknown[]]> = [];
  const tableCalls: string[] = [];
  const rpcCalls: Array<[string, unknown]> = [];
  const membership = {
    data: [
      {
        id: "membership-1",
        tenant_id: TENANT_ID,
        user_id: USER_ID,
        role: options.role ?? "admin",
        is_default: true,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        tenants: { is_active: true },
      },
    ],
    error: null,
  };

  const supabase = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }) },
    from: vi.fn((table: string) => {
      if (table === "tenant_memberships") {
        return thenable(membership, ["select", "eq", "order", "limit"], []);
      }
      if (table !== "supply_types") throw new Error(`Unexpected table: ${table}`);
      tableCalls.push(table);
      return thenable({ data: options.existing ?? [], error: null }, ["select", "eq", "order"], readCalls);
    }),
    rpc: vi.fn((name: string, args: { p_name: string }) => {
      rpcCalls.push([name, args]);
      return {
        single: vi.fn(async () =>
          options.rpcResult ?? {
            data: { id: "99999999-9999-4999-8999-999999999999", code: "tube_inox", name: args.p_name },
            error: null,
          },
        ),
      };
    }),
  };
  return { supabase, readCalls, rpcCalls, tableCalls };
}

function post(body: unknown) {
  return new Request("http://localhost/api/catalogue/supply-types", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const tenantFilters = (calls: Array<[string, unknown[]]>) =>
  calls.filter(([method]) => method === "eq").map(([, args]) => args);

describe("/api/catalogue/supply-types", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a supply type through one database call, and nothing else", async () => {
    const { supabase, rpcCalls, tableCalls } = createSupabase();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(post({ name: "  Tube inox " }));

    expect(response.status).toBe(201);
    expect((await response.json()).data).toEqual({
      item: { id: "99999999-9999-4999-8999-999999999999", code: "tube_inox", name: "Tube inox" },
    });
    expect(rpcCalls).toEqual([["create_supply_type", { p_name: "Tube inox" }]]);
    expect(tableCalls).toEqual([]);
  });

  it.each([["engineer"], ["viewer"]] as const)("refuses a %s before reaching the database function", async (role) => {
    const { supabase, rpcCalls } = createSupabase({ role });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(post({ name: "Tube inox" }));

    expect(response.status).toBe(403);
    expect(rpcCalls).toEqual([]);
  });

  it("names the existing type when the database refuses a name already taken", async () => {
    const { supabase } = createSupabase({
      rpcResult: {
        data: null,
        error: { code: "23505", message: "SUPPLY_TYPE_NAME_TAKEN", details: "Supportage" },
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(post({ name: "supportages" }));

    expect(response.status).toBe(409);
    expect((await response.json()).error.message).toBe(
      "Ce type de fourniture existe déjà : « Supportage ».",
    );
  });

  it("turns the database's own role refusal into a 403", async () => {
    const { supabase } = createSupabase({
      rpcResult: { data: null, error: { code: "42501", message: "SUPPLY_TYPE_ADMIN_REQUIRED" } },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    expect((await POST(post({ name: "Tube inox" }))).status).toBe(403);
  });

  it("refuses a blank name without calling the database function", async () => {
    const { supabase, rpcCalls } = createSupabase();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(post({ name: "   " }));

    expect(response.status).toBe(400);
    expect(rpcCalls).toEqual([]);
  });

  it("lists the supply types of the active tenant only", async () => {
    const existing = [{ id: "88888888-8888-4888-8888-888888888888", code: "tube", name: "Tube" }];
    const { supabase, readCalls } = createSupabase({ existing });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await GET();

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ items: existing });
    expect(tenantFilters(readCalls)).toEqual([["tenant_id", TENANT_ID]]);
  });
});
