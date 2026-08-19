import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/tenant-context", () => ({
  getAuthenticatedTenantContext: vi.fn(),
}));

vi.mock("@/lib/purchase-orders", () => ({
  canWritePurchaseOrders: vi.fn(),
  getAccessiblePurchaseOrderOrNull: vi.fn(),
}));

import { DELETE, PATCH } from "@/app/api/purchase-orders/[id]/devis/[devisId]/route";
import {
  DEVIS_ID,
  ORDER_ID,
  TENANT_ID,
  buildAuthenticatedTenantContext,
  buildDevisRecord,
  createDevisSupabaseMock,
} from "@/app/api/purchase-orders/[id]/devis/devis.test-utils";
import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import {
  canWritePurchaseOrders,
  getAccessiblePurchaseOrderOrNull,
} from "@/lib/purchase-orders";

const params = {
  params: Promise.resolve({ id: ORDER_ID, devisId: DEVIS_ID }),
};
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

function renameRequest(name: string) {
  return new Request(
    `http://localhost/api/purchase-orders/${ORDER_ID}/devis/${DEVIS_ID}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }
  );
}

function deleteRequest() {
  return new Request(
    `http://localhost/api/purchase-orders/${ORDER_ID}/devis/${DEVIS_ID}`,
    { method: "DELETE" }
  );
}

describe("purchase order devis item route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetOrder.mockResolvedValue({
      id: ORDER_ID,
      tenant_id: TENANT_ID,
      status: "draft",
    } as never);
    mockedCanWrite.mockResolvedValue(true);
  });

  it("renames only the devis scoped to the requested order", async () => {
    const updated = buildDevisRecord({ name: "Offre renommée" });
    const harness = installHarness({ updatedData: updated });

    const response = await PATCH(renameRequest("  Offre renommée  "), params);

    expect(response.status).toBe(200);
    expect(harness.update).toHaveBeenCalledWith({ name: "Offre renommée" });
    expect(harness.queries.update.eq.mock.calls).toEqual([
      ["id", DEVIS_ID],
      ["purchase_order_id", ORDER_ID],
    ]);
    expect(harness.createSignedUrl).toHaveBeenCalledWith(
      updated.storage_path,
      600
    );
    expect(await response.json()).toMatchObject({
      item: { id: DEVIS_ID, name: "Offre renommée" },
    });
  });

  it("does not delete the database row when Storage deletion fails", async () => {
    const storagePath = `purchase-orders/${ORDER_ID}/protected.pdf`;
    const harness = installHarness({
      lookupData: { id: DEVIS_ID, storage_path: storagePath },
      removeError: { message: "storage refused" },
    });

    const response = await DELETE(deleteRequest(), params);

    expect(response.status).toBe(400);
    expect(harness.queries.lookup.eq.mock.calls).toEqual([
      ["id", DEVIS_ID],
      ["purchase_order_id", ORDER_ID],
    ]);
    expect(harness.remove).toHaveBeenCalledWith([storagePath]);
    expect(harness.deleteRows).not.toHaveBeenCalled();
  });

  it("deletes the SQL row with the same order and devis scope", async () => {
    const harness = installHarness();

    const response = await DELETE(deleteRequest(), params);

    expect(response.status).toBe(200);
    expect(harness.deleteRows).toHaveBeenCalledOnce();
    expect(harness.queries.delete.eq.mock.calls).toEqual([
      ["id", DEVIS_ID],
      ["purchase_order_id", ORDER_ID],
    ]);
    expect(await response.json()).toEqual({ success: true });
  });
});
