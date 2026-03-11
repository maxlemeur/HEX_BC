import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { PUT } from "@/app/api/purchase-orders/[id]/route";
import { getAccessiblePurchaseOrderOrNull } from "@/lib/purchase-orders";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "44444444-4444-4444-8444-444444444444";

function createPutSupabaseMock() {
  const headerUpdates: Record<string, unknown>[] = [];
  const insertedItems: Record<string, unknown>[] = [];
  const existingItems = [
    {
      product_id: "prod-1",
      reference: "REF-001",
      designation: 'Coffret "A"',
      quantity: 2,
      unit_price_ht_cents: 1250,
      tax_rate_bp: 2000,
      source_estimate_item_id: "estimate-item-1",
      source_selected_supplier_price_id: "supplier-price-1",
    },
  ];

  const selectSingle = vi.fn().mockResolvedValue({
    data: {
      id: ORDER_ID,
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

  const updateEq = vi.fn().mockResolvedValue({ error: null });
  const purchaseOrdersUpdate = vi.fn((payload: Record<string, unknown>) => {
    headerUpdates.push(payload);
    return {
      eq: updateEq,
    };
  });

  const purchaseOrderItemsSelectEq = vi.fn().mockResolvedValue({
    data: existingItems,
    error: null,
  });
  const purchaseOrderItemsSelect = vi.fn(() => ({
    eq: purchaseOrderItemsSelectEq,
  }));
  const purchaseOrderItemsDeleteEq = vi.fn().mockResolvedValue({ error: null });
  const purchaseOrderItemsDelete = vi.fn(() => ({
    eq: purchaseOrderItemsDeleteEq,
  }));
  const purchaseOrderItemsInsert = vi.fn((payload: Record<string, unknown>[]) => {
    insertedItems.push(...payload);
    return Promise.resolve({ error: null });
  });

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
    from: vi.fn((table: string) => {
      if (table === "purchase_orders") {
        return {
          select: purchaseOrdersSelect,
          update: purchaseOrdersUpdate,
        };
      }
      if (table === "purchase_order_items") {
        return {
          select: purchaseOrderItemsSelect,
          delete: purchaseOrderItemsDelete,
          insert: purchaseOrderItemsInsert,
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return {
    supabase,
    headerUpdates,
    selectEq,
    insertedItems,
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

  it("preserves the TBD sentinel when updating draft orders", async () => {
    const { supabase, headerUpdates } = createPutSupabaseMock();
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
    expect(headerUpdates).toHaveLength(1);
    expect(headerUpdates[0]?.["expected_delivery_date"]).toBe("TBD");
  });

  it("preserves source traceability when an unchanged draft line is re-saved", async () => {
    const { supabase, insertedItems } = createPutSupabaseMock();
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
    expect(insertedItems).toHaveLength(1);
    expect(insertedItems[0]?.["source_estimate_item_id"]).toBe("estimate-item-1");
    expect(insertedItems[0]?.["source_selected_supplier_price_id"]).toBe("supplier-price-1");
  });

  it("clears source traceability when product identity changes", async () => {
    const { supabase, insertedItems } = createPutSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const request = new Request(`http://localhost/api/purchase-orders/${ORDER_ID}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        items: [
          {
            productId: "prod-2",
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
    expect(insertedItems).toHaveLength(1);
    expect(insertedItems[0]?.["source_estimate_item_id"]).toBeNull();
    expect(insertedItems[0]?.["source_selected_supplier_price_id"]).toBeNull();
  });

  it("clears source traceability when supplier reference changes", async () => {
    const { supabase, insertedItems } = createPutSupabaseMock();
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
            reference: "REF-002",
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
    expect(insertedItems).toHaveLength(1);
    expect(insertedItems[0]?.["source_estimate_item_id"]).toBeNull();
    expect(insertedItems[0]?.["source_selected_supplier_price_id"]).toBeNull();
  });
});
