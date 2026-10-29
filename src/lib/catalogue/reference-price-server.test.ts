import { beforeEach, describe, expect, it, vi } from "vitest";
const { contextMock } = vi.hoisted(() => ({ contextMock: vi.fn() }));
vi.mock("@/lib/auth/tenant-context", () => ({ getAuthenticatedTenantContext: contextMock }));
import { actOnReferencePrice } from "./reference-price-server";
const product = "00000000-0000-4000-8000-000000000006";
const tenant = "00000000-0000-4000-8000-000000000001";
describe("reference price server boundaries", () => {
  const rpc = vi.fn();
  const from = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    contextMock.mockResolvedValue({ supabase: { rpc, from }, tenantId: tenant, isTenantAdmin: true });
  });
  it("scopes transport updates to tenant, product and the observed version", async () => {
    const query = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: product }, error: null }) };
    from.mockReturnValue(query);
    await actOnReferencePrice({ action: "set-transport", product_id: product, offer_id: product, transport_mode: "included", expected_updated_at: "2026-09-06T12:00:00Z" });
    expect(query.eq.mock.calls).toEqual([["id", product], ["tenant_id", tenant], ["product_id", product], ["updated_at", "2026-09-06T12:00:00Z"]]);
  });
});
