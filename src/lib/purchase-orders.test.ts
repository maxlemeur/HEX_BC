import { describe, expect, it, vi } from "vitest";

import { canWritePurchaseOrders } from "@/lib/purchase-orders";

const ACTIVE_TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

function createClient(role: "admin" | "engineer" | "viewer" | "director") {
  const tenantEq = vi.fn(() => ({
    limit: vi.fn().mockResolvedValue({
      data: [{ tenant_id: ACTIVE_TENANT_ID, role }],
      error: null,
    }),
  }));
  const userEq = vi.fn(() => ({ eq: tenantEq }));
  return {
    client: {
      rpc: vi.fn().mockResolvedValue({ data: ACTIVE_TENANT_ID, error: null }),
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: userEq })),
      })),
    },
    tenantEq,
  };
}

describe("purchase-order write role resolution", () => {
  it("uses the authoritative active tenant instead of an inactive default", async () => {
    const { client, tenantEq } = createClient("engineer");

    await expect(
      canWritePurchaseOrders(client as never, USER_ID)
    ).resolves.toBe(true);
    expect(client.rpc).toHaveBeenCalledWith("current_tenant_id");
    expect(tenantEq).toHaveBeenCalledWith("tenant_id", ACTIVE_TENANT_ID);
  });

  it.each(["viewer", "director"] as const)("rejects read-only role %s", async (role) => {
    const { client } = createClient(role);
    await expect(
      canWritePurchaseOrders(client as never, USER_ID, ACTIVE_TENANT_ID)
    ).resolves.toBe(false);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
