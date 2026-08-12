import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDrainProcurementStorageCleanupOutbox } = vi.hoisted(() => ({
  mockDrainProcurementStorageCleanupOutbox: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/procurement/storage-cleanup-outbox", () => ({
  drainProcurementStorageCleanupOutbox:
    mockDrainProcurementStorageCleanupOutbox,
}));

import { DELETE, PUT } from "@/app/api/purchase-orders/[id]/route";
import { getAccessiblePurchaseOrderOrNull } from "@/lib/purchase-orders";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "44444444-4444-4444-8444-444444444444";
const TENANT_ID = "55555555-5555-4555-8555-555555555555";

function createPutSupabaseMock() {
  const rpc = vi.fn().mockResolvedValue({ data: ORDER_ID, error: null });

  const selectSingle = vi.fn().mockResolvedValue({
    data: {
      id: ORDER_ID,
      tenant_id: TENANT_ID,
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
    mockDrainProcurementStorageCleanupOutbox.mockResolvedValue({
      claimed: 0,
      removed: 0,
      failed: 0,
      skipped: false,
      errors: [],
    });
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

  it("preserves the TBD sentinel when updating draft orders", async () => {
    const { supabase, rpc } = createPutSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const request = new Request(`http://localhost/api/purchase-orders/${ORDER_ID}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        expectedDeliveryDate: "TBD",
      }),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: ORDER_ID }) });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("replace_purchase_order_draft", {
      p_order_id: ORDER_ID,
      p_header_patch: { expected_delivery_date: "TBD" },
      p_items: null,
    });
  });

  it("delegates one normalized line replacement to the atomic RPC", async () => {
    const { supabase, rpc } = createPutSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const request = new Request(`http://localhost/api/purchase-orders/${ORDER_ID}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        items: [
          {
            productId: "prod-1",
            reference: "REF-001",
            designation: 'Coffret "A"',
            quantity: 2,
            unitPriceCents: 1250,
            taxRateBp: 2000,
          },
        ],
      }),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: ORDER_ID }) });

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("replace_purchase_order_draft", {
      p_order_id: ORDER_ID,
      p_header_patch: {},
      p_items: [
        {
          product_id: "prod-1",
          reference: "REF-001",
          designation: 'Coffret "A"',
          quantity: 2,
          unit_price_ht_cents: 1250,
          tax_rate_bp: 2000,
        },
      ],
    });
  });

  it("rejects non-integer quantities before calling the RPC", async () => {
    const { supabase, rpc } = createPutSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const request = new Request(`http://localhost/api/purchase-orders/${ORDER_ID}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        items: [
          {
            productId: "prod-1",
            reference: "REF-001",
            designation: 'Coffret "A"',
            quantity: 0.5,
            unitPriceCents: 1250,
            taxRateBp: 2000,
          },
        ],
      }),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: ORDER_ID }) });

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a draft race rejected by PostgreSQL to the existing 403 contract", async () => {
    const { supabase, rpc } = createPutSupabaseMock();
    rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "42501",
        message: "PURCHASE_ORDER_DRAFT_NOT_EDITABLE",
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const request = new Request(`http://localhost/api/purchase-orders/${ORDER_ID}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        notes: "mise à jour concurrente",
      }),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: ORDER_ID }) });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Seuls les bons de commande en brouillon peuvent etre modifies.",
    });
  });

  it("returns 403 when the atomic draft delete loses the status race", async () => {
    const { supabase, rpc } = createPutSupabaseMock();
    rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "42501",
        message: "PURCHASE_ORDER_DRAFT_NOT_DELETABLE",
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await DELETE(
      new Request(`http://localhost/api/purchase-orders/${ORDER_ID}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );

    expect(response.status).toBe(403);
    expect(rpc).toHaveBeenCalledWith("delete_purchase_order_draft_atomic", {
      p_order_id: ORDER_ID,
    });
    expect(mockDrainProcurementStorageCleanupOutbox).not.toHaveBeenCalled();
  });

  it("deletes through the atomic RPC then drains durable Storage cleanup", async () => {
    const { supabase, rpc } = createPutSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await DELETE(
      new Request(`http://localhost/api/purchase-orders/${ORDER_ID}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(rpc).toHaveBeenCalledWith("delete_purchase_order_draft_atomic", {
      p_order_id: ORDER_ID,
    });
    expect(mockDrainProcurementStorageCleanupOutbox).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      limit: 25,
    });
  });
});
