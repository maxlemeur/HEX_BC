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

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return {
    supabase,
    headerUpdates,
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
});
