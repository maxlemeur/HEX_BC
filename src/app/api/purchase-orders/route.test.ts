import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/tenant-context", () => ({
  getAuthenticatedTenantContext: vi.fn(),
}));

import { POST } from "@/app/api/purchase-orders/route";
import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SUPPLIER_ID = "22222222-2222-4222-8222-222222222222";
const DELIVERY_SITE_ID = "33333333-3333-4333-8333-333333333333";
const TENANT_ID = "44444444-4444-4444-8444-444444444444";

function mockTenantContext(
  supabase: unknown,
  role: AuthenticatedTenantContext["tenantRole"] = "engineer"
) {
  vi.mocked(getAuthenticatedTenantContext).mockResolvedValue({
    supabase,
    userId: USER_ID,
    tenantId: TENANT_ID,
    tenantRole: role,
    isTenantAdmin: role === "admin",
    membership: {
      id: "membership-1",
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      role,
      is_default: true,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  } as AuthenticatedTenantContext);
}

function createPostSupabaseMock(role: "engineer" | "viewer" = "engineer") {
  const rpc = vi.fn().mockResolvedValue({
    data: { id: "66666666-6666-4666-8666-666666666666", reference: "C-2610-42", edit_revision: 1 },
    error: null,
  });
  const supabase = {
    rpc,
    from: vi.fn((table: string) => {
      if (table === "tenant_memberships") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue({
                  data: [{ tenant_id: TENANT_ID, role }], error: null,
                }),
              })),
            })),
          })),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
  return { supabase, rpc };
}

describe("purchase orders POST regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves the TBD sentinel when creating draft orders", async () => {
    const { supabase, rpc } = createPostSupabaseMock();
    mockTenantContext(supabase);

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
            unit: "u",
            quantity: 1,
            unitPriceCents: 1500,
            taxRateBp: 2000,
          },
        ],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("create_purchase_order_draft", expect.objectContaining({
      p_header: expect.objectContaining({ expected_delivery_date: "TBD" }),
    }));
  });

  it("rejette une quantité dépassant trois décimales au lieu de l'arrondir silencieusement", async () => {
    const { supabase, rpc } = createPostSupabaseMock();
    mockTenantContext(supabase);

    const response = await POST(
      new Request("http://localhost/api/purchase-orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          supplierId: SUPPLIER_ID,
          deliverySiteId: DELIVERY_SITE_ID,
          items: [
            {
              designation: "Acier",
              unit: "t",
              quantity: 0.0001,
              unitPriceCents: 80000,
              taxRateBp: 2000,
            },
          ],
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a viewer before creating a manual purchase order", async () => {
    const { supabase, rpc } = createPostSupabaseMock("viewer");
    mockTenantContext(supabase, "viewer");

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
            unit: "u",
              quantity: 1,
              unitPriceCents: 1500,
              taxRateBp: 2000,
            },
          ],
        }),
      })
    );

    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});
