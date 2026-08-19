import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/tenant-context", () => ({
  getAuthenticatedTenantContext: vi.fn(),
}));

vi.mock("@/lib/purchase-orders", () => ({
  canWritePurchaseOrders: vi.fn(),
  getAccessiblePurchaseOrderOrNull: vi.fn(),
}));

import { PATCH } from "@/app/api/purchase-orders/[id]/devis/reorder/route";
import {
  DEVIS_ID,
  ORDER_ID,
  SECOND_DEVIS_ID,
  TENANT_ID,
  buildAuthenticatedTenantContext,
  createDevisSupabaseMock,
} from "@/app/api/purchase-orders/[id]/devis/devis.test-utils";
import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import {
  canWritePurchaseOrders,
  getAccessiblePurchaseOrderOrNull,
} from "@/lib/purchase-orders";

const params = { params: Promise.resolve({ id: ORDER_ID }) };
const mockedGetOrder = vi.mocked(getAccessiblePurchaseOrderOrNull);
const mockedCanWrite = vi.mocked(canWritePurchaseOrders);

function installHarness(
  options: Parameters<typeof createDevisSupabaseMock>[0] = {}
) {
  const harness = createDevisSupabaseMock(options);
  vi.mocked(getAuthenticatedTenantContext).mockResolvedValue(
    buildAuthenticatedTenantContext(harness.supabase)
  );
  return harness;
}

function reorderRequest(orderedIds: string[]) {
  return new Request(
    `http://localhost/api/purchase-orders/${ORDER_ID}/devis/reorder`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderedIds }),
    }
  );
}

describe("purchase order devis reorder route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetOrder.mockResolvedValue({
      id: ORDER_ID,
      tenant_id: TENANT_ID,
      status: "draft",
    } as never);
    mockedCanWrite.mockResolvedValue(true);
  });

  it("rejects duplicate identifiers before resolving order access", async () => {
    const harness = installHarness();

    const response = await PATCH(
      reorderRequest([DEVIS_ID, DEVIS_ID]),
      params
    );

    expect(response.status).toBe(400);
    expect(mockedGetOrder).not.toHaveBeenCalled();
    expect(harness.from).not.toHaveBeenCalled();
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "an incomplete list",
      orderedIds: [DEVIS_ID],
      expectedError: "La liste de reordonnancement est incomplete.",
    },
    {
      label: "an identifier from another order",
      orderedIds: [DEVIS_ID, "66666666-6666-4666-8666-666666666666"],
      expectedError:
        "Devis 66666666-6666-4666-8666-666666666666 non trouve dans cette commande.",
    },
  ])("rejects $label without calling the RPC", async ({ orderedIds, expectedError }) => {
    const harness = installHarness({
      reorderData: [{ id: DEVIS_ID }, { id: SECOND_DEVIS_ID }],
    });

    const response = await PATCH(reorderRequest(orderedIds), params);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expectedError });
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it("reports an inconsistent RPC update count", async () => {
    const orderedIds = [SECOND_DEVIS_ID, DEVIS_ID];
    const harness = installHarness({ rpcUpdatedCount: 1 });

    const response = await PATCH(reorderRequest(orderedIds), params);

    expect(response.status).toBe(409);
    expect(harness.rpc).toHaveBeenCalledWith("reorder_purchase_order_devis", {
      target_purchase_order_id: ORDER_ID,
      ordered_devis_ids: orderedIds,
    });
    expect(await response.json()).toEqual({
      error: "La liste de reordonnancement est desynchronisee.",
    });
  });

  it("delegates a complete order-scoped permutation to the atomic RPC", async () => {
    const orderedIds = [SECOND_DEVIS_ID, DEVIS_ID];
    const harness = installHarness();

    const response = await PATCH(reorderRequest(orderedIds), params);

    expect(response.status).toBe(200);
    expect(harness.queries.reorder.eq).toHaveBeenCalledWith(
      "purchase_order_id",
      ORDER_ID
    );
    expect(harness.rpc).toHaveBeenCalledOnce();
    expect(harness.rpc).toHaveBeenCalledWith("reorder_purchase_order_devis", {
      target_purchase_order_id: ORDER_ID,
      ordered_devis_ids: orderedIds,
    });
    expect(await response.json()).toEqual({ success: true });
  });
});
