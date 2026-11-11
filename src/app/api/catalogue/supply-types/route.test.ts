import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { GET, POST } from "@/app/api/catalogue/supply-types/route";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Failure modes, written with the route (TI-690):
 *  1. RLS lets any member write supply types: without the application check, an engineer or a viewer
 *     grows the referential shared by every estimate of the tenant;
 *  2. the list or the duplicate check reads every tenant the user belongs to, not the active one;
 *  3. a name already taken is created again because the stored code of a historical type (cat_<md5>)
 *     is unrelated to its name, or because it only differs by a plural;
 *  4. the type is created in another tenant than the active one.
 */

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "33333333-3333-4333-8333-333333333333";

type Role = "admin" | "engineer" | "viewer";
type ExistingType = { id: string; code: string; name: string };

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

function createSupabase(options: { role?: Role; existing?: ExistingType[] } = {}) {
  const readCalls: Array<[string, unknown[]]> = [];
  const inserted: unknown[] = [];
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
      return {
        ...thenable({ data: options.existing ?? [], error: null }, ["select", "eq", "order"], readCalls),
        insert: vi.fn((payload: { code: string; name: string }) => {
          inserted.push(payload);
          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => ({
                data: { id: "99999999-9999-4999-8999-999999999999", code: payload.code, name: payload.name },
                error: null,
              })),
            })),
          };
        }),
      };
    }),
  };
  return { supabase, inserted, readCalls };
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

  it("creates a supply type in the active tenant, with a code derived from its name", async () => {
    const { supabase, inserted, readCalls } = createSupabase();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(post({ name: "  Tube inox " }));

    expect(response.status).toBe(201);
    expect(inserted).toEqual([{ tenant_id: TENANT_ID, code: "tube_inox", name: "Tube inox" }]);
    expect(tenantFilters(readCalls)).toEqual([["tenant_id", TENANT_ID]]);
  });

  it.each([["engineer"], ["viewer"]] as const)("refuses a %s", async (role) => {
    const { supabase, inserted } = createSupabase({ role });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(post({ name: "Tube inox" }));

    expect(response.status).toBe(403);
    expect(inserted).toEqual([]);
  });

  it.each([
    ["a historical type whose code is unrelated to its name", { code: "cat_5d41402abc4b", name: "Supportage" }, "supportage"],
    ["a plural", { code: "tube", name: "Tube" }, "Tubes"],
    ["case, accents and punctuation", { code: "tube_inox", name: "Tube inox" }, "TUBÉ-INOX."],
  ])("refuses a name already taken by %s", async (_label, existing, name) => {
    const { supabase, inserted } = createSupabase({
      existing: [{ id: "88888888-8888-4888-8888-888888888888", ...existing }],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(post({ name }));

    expect(response.status).toBe(409);
    expect((await response.json()).error.message).toBe(
      `Ce type de fourniture existe déjà : « ${existing.name} ».`,
    );
    expect(inserted).toEqual([]);
  });

  it("refuses a blank name without reading or writing", async () => {
    const { supabase, inserted } = createSupabase();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(post({ name: "   " }));

    expect(response.status).toBe(400);
    expect(inserted).toEqual([]);
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
