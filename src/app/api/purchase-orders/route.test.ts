import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { POST } from "@/app/api/purchase-orders/route";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SUPPLIER_ID = "22222222-2222-4222-8222-222222222222";
const DELIVERY_SITE_ID = "33333333-3333-4333-8333-333333333333";
const TENANT_ID = "44444444-4444-4444-8444-444444444444";

function createPostSupabaseMock(role: "engineer" | "viewer" = "engineer") {
  const insertedOrderHeaders: Record<string, unknown>[] = [];

  const purchaseOrdersInsertSingle = vi.fn().mockResolvedValue({
    data: {
      id: "order-1",
      order_number: 42,
    },
    error: null,
  });

  const purchaseOrdersInsert = vi.fn((payload: Record<string, unknown>) => {
    insertedOrderHeaders.push(payload);
    return {
      select: vi.fn(() => ({
        single: purchaseOrdersInsertSingle,
      })),
    };
  });

  const purchaseOrdersUpdateEq = vi.fn().mockResolvedValue({ error: null });
  const purchaseOrdersUpdate = vi.fn(() => ({
    eq: purchaseOrdersUpdateEq,
  }));

  const purchaseOrdersDeleteEq = vi.fn().mockResolvedValue({ error: null });
  const purchaseOrdersDelete = vi.fn(() => ({
    eq: purchaseOrdersDeleteEq,
  }));

  const purchaseOrderItemsInsert = vi.fn().mockResolvedValue({ error: null });

  const supabase = {
    rpc: vi.fn().mockResolvedValue({ data: TENANT_ID, error: null }),
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
    from: vi.fn((table: string) => {
      if (table === "tenant_memberships") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue({
                  data: [{ tenant_id: TENANT_ID, role }],
                  error: null,
                }),
              })),
            })),
          })),
        };
      }

      if (table === "purchase_orders") {
        return {
          insert: purchaseOrdersInsert,
          update: purchaseOrdersUpdate,
          delete: purchaseOrdersDelete,
        };
      }

      if (table === "purchase_order_items") {
        return {
          insert: purchaseOrderItemsInsert,
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return {
    supabase,
    insertedOrderHeaders,
  };
}

describe("purchase orders POST regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves the TBD sentinel when creating draft orders", async () => {
    const { supabase, insertedOrderHeaders } = createPostSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const request = new Request("http://localhost/api/purchase-orders", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        supplierId: SUPPLIER_ID,
        deliverySiteId: DELIVERY_SITE_ID,
        expectedDeliveryDate: "TBD",
        notes: "Test",
        items: [
          {
            designation: "Ligne 1",
            quantity: 1,
            unitPriceCents: 1500,
            taxRateBp: 2000,
          },
        ],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(insertedOrderHeaders).toHaveLength(1);
    expect(insertedOrderHeaders[0]?.["expected_delivery_date"]).toBe("TBD");
  });

  it("rejects a viewer before creating a manual purchase order", async () => {
    const { supabase, insertedOrderHeaders } = createPostSupabaseMock("viewer");
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(
      new Request("http://localhost/api/purchase-orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          supplierId: SUPPLIER_ID,
          deliverySiteId: DELIVERY_SITE_ID,
          items: [
            {
              designation: "Ligne 1",
              quantity: 1,
              unitPriceCents: 1500,
              taxRateBp: 2000,
            },
          ],
        }),
      })
    );

    expect(response.status).toBe(403);
    expect(insertedOrderHeaders).toEqual([]);
  });
});
