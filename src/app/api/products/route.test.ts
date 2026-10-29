import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { POST } from "@/app/api/products/route";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";

const VALID_PRODUCT = {
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

type QueryResult = { data: unknown; error: { message: string } | null };

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

function createProductsSupabase(options: {
  authenticated?: boolean;
  role?: "admin" | "engineer" | "viewer";
  insertResult?: QueryResult;
  updateResult?: QueryResult;
} = {}) {
  const inserted: unknown[] = [];
  const updated: Array<{ id: string; payload: unknown }> = [];
  const insertSingle = vi.fn(async () => options.insertResult ?? {
    data: { id: PRODUCT_ID, ...VALID_PRODUCT },
    error: null,
  });
  const updateMaybeSingle = vi.fn(async () => options.updateResult ?? {
    data: { id: PRODUCT_ID, ...VALID_PRODUCT, is_active: false },
    error: null,
  });

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

      if (table !== "products") {
        throw new Error(`Unexpected table: ${table}`);
      }

      return {
        insert: vi.fn((payload: unknown) => {
          inserted.push(payload);
          return {
            select: vi.fn(() => ({
              single: insertSingle,
            })),
          };
        }),
        update: vi.fn((payload: unknown) => ({
          eq: vi.fn((_column: string, id: string) => {
            updated.push({ id, payload });
            return {
              select: vi.fn(() => ({
                maybeSingle: updateMaybeSingle,
              })),
            };
          }),
        })),
      };
    }),
  };

  return { supabase, inserted, updated };
}

function postRequest(body: unknown) {
  return new Request("http://localhost/api/products", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/products", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("archives a product with a partial update", async () => {
    const { supabase, updated } = createProductsSupabase();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(
      postRequest({
        action: "update",
        id: PRODUCT_ID,
        item: { is_active: false },
      })
    );

    expect(response.status).toBe(200);
    expect(updated).toEqual([
      { id: PRODUCT_ID, payload: { is_active: false } },
    ]);
  });
});
