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

type QueryResult = { data: unknown; error: { message: string; details?: string; code?: string } | null };

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

  // TI-690. Failure modes: the database refusal of an incomplete draft reaches the operator as a raw code or a
  // generic 500; the status or the supply type is dropped on the way to the database; a creation that sets no
  // status sends one anyway and so overrides the database default.
  it("turns the refusal of an incomplete draft into a 422 naming the missing fields", async () => {
    const { supabase, updated } = createProductsSupabase({
      updateResult: {
        data: null,
        error: { code: "23514", message: "PRODUCT_VALIDATION_INCOMPLETE", details: "product_type,supply_type_id" },
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(
      postRequest({ action: "update", id: PRODUCT_ID, item: { catalogue_status: "validated" } })
    );

    expect(updated).toEqual([{ id: PRODUCT_ID, payload: { catalogue_status: "validated" } }]);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: "PRODUCT_VALIDATION_INCOMPLETE",
        message: "Pour valider cet article, renseignez : le type d’article, le type de fourniture.",
        details: { missing: ["product_type", "supply_type_id"] },
      },
    });
  });

  it("refuses a supply type that is not in the tenant's referential", async () => {
    const { supabase } = createProductsSupabase({
      updateResult: { data: null, error: { code: "23514", message: "PRODUCT_SUPPLY_TYPE_INVALID" } },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(
      postRequest({
        action: "update",
        id: PRODUCT_ID,
        item: { supply_type_id: "44444444-4444-4444-8444-444444444444" },
      })
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe(
      "Ce type de fourniture n’existe pas dans votre référentiel."
    );
  });

  it("creates a draft with its supply type, and sends no status when none is given", async () => {
    const { supabase, inserted } = createProductsSupabase();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    const supplyTypeId = "44444444-4444-4444-8444-444444444444";

    await POST(
      postRequest({
        action: "create",
        item: { ...VALID_PRODUCT, catalogue_status: "draft", supply_type_id: supplyTypeId },
      })
    );
    await POST(postRequest({ action: "create", item: VALID_PRODUCT }));

    expect(inserted).toEqual([
      { ...VALID_PRODUCT, catalogue_status: "draft", supply_type_id: supplyTypeId },
      VALID_PRODUCT,
    ]);
  });

  it("refuses an unknown catalogue status", async () => {
    const { supabase, updated } = createProductsSupabase();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(
      postRequest({ action: "update", id: PRODUCT_ID, item: { catalogue_status: "approved" } })
    );

    expect(response.status).toBe(400);
    expect(updated).toEqual([]);
  });
});
