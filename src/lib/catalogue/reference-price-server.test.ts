import { beforeEach, describe, expect, it, vi } from "vitest";
const { contextMock } = vi.hoisted(() => ({ contextMock: vi.fn() }));
vi.mock("@/lib/auth/tenant-context", () => ({ getAuthenticatedTenantContext: contextMock }));
import { actOnReferencePrice, getReferencePriceProposal } from "./reference-price-server";
const product = "00000000-0000-4000-8000-000000000006";
const tenant = "00000000-0000-4000-8000-000000000001";
const input = { action: "validate" as const, product_id: product, quantity: 100, transport_mode: "excluded" as const, fingerprint: "a".repeat(32) };
describe("reference price server boundaries", () => {
  const rpc = vi.fn();
  const from = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    contextMock.mockResolvedValue({ supabase: { rpc, from }, tenantId: tenant, isTenantAdmin: true });
    rpc.mockResolvedValue({ data: { unit_price_cents: 1050 }, error: null });
  });
  it("refuses an engineer before any mutation", async () => {
    contextMock.mockResolvedValue({ supabase: { rpc, from }, tenantId: tenant, isTenantAdmin: false });
    await expect(actOnReferencePrice(input)).rejects.toMatchObject({ status: 403 });
    expect(rpc).not.toHaveBeenCalled(); expect(from).not.toHaveBeenCalled();
  });
  it("lets the database recalculate from the fingerprint instead of accepting a client average", async () => {
    await actOnReferencePrice(input);
    expect(rpc).toHaveBeenCalledWith("validate_product_reference_price", {
      p_product_id: product, p_quantity: 100, p_transport_mode: "excluded", p_fingerprint: "a".repeat(32),
      p_manual_price_cents: undefined, p_justification: undefined,
    });
  });
  it("returns a conflict when offers changed", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "REFERENCE_PRICE_PROPOSAL_CHANGED" } });
    await expect(actOnReferencePrice(input)).rejects.toMatchObject({ status: 409 });
  });
  it("reports a missing migration explicitly", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "RPC absent" } });
    await expect(getReferencePriceProposal({ product_id: product })).rejects.toMatchObject({ status: 503, code: "REFERENCE_PRICE_NOT_READY" });
  });
  it("scopes transport updates to tenant, product and the observed version", async () => {
    const query = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: product }, error: null }) };
    from.mockReturnValue(query);
    await actOnReferencePrice({ action: "set-transport", product_id: product, offer_id: product, transport_mode: "included", expected_updated_at: "2026-09-06T12:00:00Z" });
    expect(query.eq.mock.calls).toEqual([["id", product], ["tenant_id", tenant], ["product_id", product], ["updated_at", "2026-09-06T12:00:00Z"]]);
  });
});
