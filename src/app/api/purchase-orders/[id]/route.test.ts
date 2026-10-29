import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDrainProcurementStorageCleanupOutbox } = vi.hoisted(() => ({
  mockDrainProcurementStorageCleanupOutbox: vi.fn(),
}));

vi.mock("@/lib/auth/tenant-context", () => ({
  getAuthenticatedTenantContext: vi.fn(),
}));

vi.mock("@/lib/procurement/storage-cleanup-outbox", () => ({
  drainProcurementStorageCleanupOutbox:
    mockDrainProcurementStorageCleanupOutbox,
}));

import { DELETE, PUT } from "@/app/api/purchase-orders/[id]/route";
import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { getAccessiblePurchaseOrderOrNull } from "@/lib/purchase-orders";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "44444444-4444-4444-8444-444444444444";
const TENANT_ID = "55555555-5555-4555-8555-555555555555";

function mockTenantContext(supabase: unknown) {
  vi.mocked(getAuthenticatedTenantContext).mockResolvedValue({
    supabase,
    userId: USER_ID,
    tenantId: TENANT_ID,
    tenantRole: "engineer",
    isTenantAdmin: false,
    membership: {
      id: "membership-1",
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      role: "engineer",
      is_default: true,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  } as AuthenticatedTenantContext);
}

function createPutSupabaseMock(
  { orderTenantId = TENANT_ID }: { orderTenantId?: string } = {}
) {
  const rpc = vi.fn().mockResolvedValue({ data: { id: ORDER_ID, edit_revision: 1 }, error: null });

  const selectSingle = vi.fn().mockResolvedValue({
    data: {
      id: ORDER_ID,
      tenant_id: orderTenantId,
      status: "draft",
    },
    error: null,
  });

  const selectEq = vi.fn<
    (column: string, value: string) => {
      single: typeof selectSingle;
    }
  >((column: string, value: string) => {
    void column;
    void value;
    return {
      single: selectSingle,
    };
  });

  const purchaseOrdersSelect = vi.fn(() => ({
    eq: selectEq,
  }));

  const supabase = {
    rpc,
    from: vi.fn((table: string) => {
      if (table === "tenant_memberships") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue({
                  data: [{ tenant_id: TENANT_ID, role: "engineer" }],
                  error: null,
                }),
              })),
            })),
          })),
        };
      }

      if (table === "purchase_orders") {
        return {
          select: purchaseOrdersSelect,
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return {
    supabase,
    rpc,
    selectEq,
  };
}

describe("purchase orders [id] route regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shared lookup uses id filter only (no owner-only user_id filter)", async () => {
    const selectSingle = vi.fn().mockResolvedValue({
      data: { id: ORDER_ID },
      error: null,
    });
    const selectEq = vi.fn<
      (column: string, value: string) => {
        single: typeof selectSingle;
      }
    >((column: string, value: string) => {
      void column;
      void value;
      return { single: selectSingle };
    });
    const purchaseOrdersSelect = vi.fn(() => ({ eq: selectEq }));

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "purchase_orders") {
          return {
            select: purchaseOrdersSelect,
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const order = await getAccessiblePurchaseOrderOrNull<{ id: string }>(
      supabase as never,
      ORDER_ID,
      "id"
    );

    expect(order).toEqual({ id: ORDER_ID });
    expect(selectEq).toHaveBeenCalledWith("id", ORDER_ID);
    expect(selectEq).toHaveBeenCalledTimes(1);
    expect(
      selectEq.mock.calls.some(([column]) => column === "user_id")
    ).toBe(false);
  });

  it("hides an order of another tenant from PUT and DELETE (404, no RPC)", async () => {
    const otherTenantId = "99999999-9999-4999-8999-999999999999";

    const put = createPutSupabaseMock({ orderTenantId: otherTenantId });
    mockTenantContext(put.supabase);
    const putResponse = await PUT(
      new Request(`http://localhost/api/purchase-orders/${ORDER_ID}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedDeliveryDate: "TBD" }),
      }),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );
    expect(putResponse.status).toBe(404);
    expect(put.rpc).not.toHaveBeenCalled();

    const del = createPutSupabaseMock({ orderTenantId: otherTenantId });
    mockTenantContext(del.supabase);
    const deleteResponse = await DELETE(
      new Request(`http://localhost/api/purchase-orders/${ORDER_ID}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );
    expect(deleteResponse.status).toBe(404);
    expect(del.rpc).not.toHaveBeenCalled();
    expect(mockDrainProcurementStorageCleanupOutbox).not.toHaveBeenCalled();
  });

  it("preserves the TBD sentinel when updating draft orders", async () => {
    const { supabase, rpc } = createPutSupabaseMock();
    mockTenantContext(supabase);

    const request = new Request(`http://localhost/api/purchase-orders/${ORDER_ID}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        expectedRevision: 0,
        expectedDeliveryDate: "TBD",
      }),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: ORDER_ID }) });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("replace_purchase_order_draft", {
      p_order_id: ORDER_ID,
      p_expected_revision: 0,
      p_header_patch: { expected_delivery_date: "TBD" },
      p_items: null,
    });
  });
});
