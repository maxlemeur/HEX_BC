import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/tenant-context", () => ({
  getAuthenticatedTenantContext: vi.fn(),
}));

vi.mock("@/lib/purchase-orders", () => ({
  canWritePurchaseOrders: vi.fn(),
  getAccessiblePurchaseOrderOrNull: vi.fn(),
}));

import { DELETE, PATCH as renameDevis } from "@/app/api/purchase-orders/[id]/devis/[devisId]/route";
import { PATCH as reorderDevis } from "@/app/api/purchase-orders/[id]/devis/reorder/route";
import { POST } from "@/app/api/purchase-orders/[id]/devis/route";
import {
  DEVIS_ID,
  ORDER_ID,
  SECOND_DEVIS_ID,
  TENANT_ID,
  USER_ID,
  buildAuthenticatedTenantContext,
  createDevisSupabaseMock,
} from "@/app/api/purchase-orders/[id]/devis/devis.test-utils";
import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { unauthorized } from "@/lib/estimates/errors";
import {
  canWritePurchaseOrders,
  getAccessiblePurchaseOrderOrNull,
} from "@/lib/purchase-orders";

const orderParams = { params: Promise.resolve({ id: ORDER_ID }) };
const devisParams = {
  params: Promise.resolve({ id: ORDER_ID, devisId: DEVIS_ID }),
};

function uploadRequest() {
  const formData = new FormData();
  formData.set(
    "file",
    new File(["offre"], "offre.pdf", { type: "application/pdf" })
  );
  return new Request(`http://localhost/api/purchase-orders/${ORDER_ID}/devis`, {
    method: "POST",
    body: formData,
  });
}

function jsonRequest(path: string, body: unknown, method = "PATCH") {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const mutations = [
  {
    label: "upload",
    call: () => POST(uploadRequest(), orderParams),
  },
  {
    label: "rename",
    call: () =>
      renameDevis(
        jsonRequest(`/api/purchase-orders/${ORDER_ID}/devis/${DEVIS_ID}`, {
          name: "Offre finale",
        }),
        devisParams
      ),
  },
  {
    label: "delete",
    call: () =>
      DELETE(
        new Request(
          `http://localhost/api/purchase-orders/${ORDER_ID}/devis/${DEVIS_ID}`,
          { method: "DELETE" }
        ),
        devisParams
      ),
  },
  {
    label: "reorder",
    call: () =>
      reorderDevis(
        jsonRequest(`/api/purchase-orders/${ORDER_ID}/devis/reorder`, {
          orderedIds: [SECOND_DEVIS_ID, DEVIS_ID],
        }),
        orderParams
      ),
  },
] as const;

const mockedGetOrder = vi.mocked(getAccessiblePurchaseOrderOrNull);
const mockedCanWrite = vi.mocked(canWritePurchaseOrders);

describe("purchase order devis mutation authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(mutations)("requires authentication for $label", async ({ call }) => {
    const harness = createDevisSupabaseMock();
    vi.mocked(getAuthenticatedTenantContext).mockRejectedValue(unauthorized());

    const response = await call();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockedGetOrder).not.toHaveBeenCalled();
    expect(harness.from).not.toHaveBeenCalled();
    expect(harness.storageFrom).not.toHaveBeenCalled();
  });

  it.each(mutations)("rejects a read-only member for $label", async ({ call }) => {
    const harness = createDevisSupabaseMock();
    vi.mocked(getAuthenticatedTenantContext).mockResolvedValue(
      buildAuthenticatedTenantContext(harness.supabase)
    );
    mockedGetOrder.mockResolvedValue({
      id: ORDER_ID,
      tenant_id: TENANT_ID,
      status: "draft",
    } as never);
    mockedCanWrite.mockResolvedValue(false);

    const response = await call();

    expect(response.status).toBe(403);
    expect(mockedCanWrite).toHaveBeenCalledWith(
      harness.supabase,
      USER_ID,
      TENANT_ID
    );
    expect(harness.from).not.toHaveBeenCalled();
    expect(harness.storageFrom).not.toHaveBeenCalled();
  });

  it.each(mutations)("blocks a canceled order for $label", async ({ call }) => {
    const harness = createDevisSupabaseMock();
    vi.mocked(getAuthenticatedTenantContext).mockResolvedValue(
      buildAuthenticatedTenantContext(harness.supabase)
    );
    mockedGetOrder.mockResolvedValue({
      id: ORDER_ID,
      tenant_id: TENANT_ID,
      status: "canceled",
    } as never);
    mockedCanWrite.mockResolvedValue(true);

    const response = await call();

    expect(response.status).toBe(403);
    expect(harness.from).not.toHaveBeenCalled();
    expect(harness.storageFrom).not.toHaveBeenCalled();
  });
});
