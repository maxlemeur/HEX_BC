import { beforeEach, describe, expect, it, vi } from "vitest";
import { forbidden } from "@/lib/estimates/errors";
const { getMock, actMock } = vi.hoisted(() => ({ getMock: vi.fn(), actMock: vi.fn() }));
vi.mock("@/lib/catalogue/reference-price-server", () => ({ getReferencePriceProposal: getMock, actOnReferencePrice: actMock }));
import { GET, POST } from "./route";
const id = "00000000-0000-4000-8000-000000000006";
const payload = { action: "validate", product_id: id, quantity: 100, transport_mode: "excluded", fingerprint: "a".repeat(32) };
const post = (body: unknown) => POST(new Request("http://localhost/api/catalogue/reference-price", { method: "POST", body: JSON.stringify(body) }));
describe("reference price API", () => {
  beforeEach(() => { vi.clearAllMocks(); getMock.mockResolvedValue({}); actMock.mockResolvedValue({}); });
  it("parses an explicit comparison basis", async () => {
    const response = await GET(new Request(`http://localhost/api/catalogue/reference-price?product_id=${id}&quantity=100&transport_mode=excluded`));
    expect(response.status).toBe(200);
    expect(getMock).toHaveBeenCalledWith({ product_id: id, quantity: 100, transport_mode: "excluded" });
  });
  it("rejects invalid or missing product identity before reading", async () => {
    expect((await GET(new Request("http://localhost/api/catalogue/reference-price?product_id=invalid"))).status).toBe(400);
    expect(getMock).not.toHaveBeenCalled();
  });
  it("requires a justification for a manual price, including zero", async () => {
    expect((await post({ ...payload, manual_price_cents: 0 })).status).toBe(400);
    expect(actMock).not.toHaveBeenCalled();
    expect((await post({ ...payload, manual_price_cents: 0, justification: "Offert par le fournisseur" })).status).toBe(200);
  });
  it("rejects quantities that cannot be stored without rounding", async () => {
    expect((await post({ ...payload, quantity: 1.2345 })).status).toBe(400);
    expect(actMock).not.toHaveBeenCalled();
  });
  it("preserves a server-side authorization denial", async () => {
    actMock.mockRejectedValue(forbidden("Responsable requis."));
    expect((await post(payload)).status).toBe(403);
  });
  it("rejects malformed JSON", async () => {
    expect((await POST(new Request("http://localhost/api/catalogue/reference-price", { method: "POST", body: "{" }))).status).toBe(400);
    expect(actMock).not.toHaveBeenCalled();
  });
});
