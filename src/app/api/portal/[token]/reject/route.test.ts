import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPortalLegacyOfferFixture } from "@/test/fixtures/portal-legacy-offer";

// ---------------------------------------------------------------------------
// Mock service-role client
// ---------------------------------------------------------------------------

const mockSingle = vi.fn();
const mockTokenSelect = vi.fn();
const mockTokenEq = vi.fn();
const mockEqChain = vi.fn();
const mockUpdate = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockStorageDownload = vi.fn();
const offerFixture = createPortalLegacyOfferFixture();

function setupFromMock() {
  // Fluent chain: from().select().eq().single() and from().update().eq().eq().select().single()
  mockFrom.mockImplementation((table: string) => {
    if (table === "portal_tokens") {
      return {
        select: vi.fn((columns: string) => {
          mockTokenSelect(columns);
          const builder = {
            eq: mockTokenEq,
            single: mockSingle,
          };
          mockTokenEq.mockReturnValue(builder);
          return builder;
        }),
        update: vi.fn((data: unknown) => {
          mockUpdate(data);
          return {
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: mockEqChain,
                })),
              })),
            })),
          };
        }),
      };
    }
    if (table === "estimate_versions") {
      const builder = {
        eq: vi.fn(),
        abortSignal: vi.fn(),
        single: vi.fn().mockResolvedValue({ data: offerFixture.version, error: null }),
      };
      builder.eq.mockReturnValue(builder);
      builder.abortSignal.mockReturnValue(builder);
      return {
        select: vi.fn(() => builder),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              error: null,
            })),
          })),
        })),
      };
    }
    if (table === "estimate_documents") {
      const builder = {
        eq: vi.fn(),
        single: vi.fn().mockResolvedValue({ data: offerFixture.document, error: null }),
      };
      builder.eq.mockReturnValue(builder);
      return { select: vi.fn(() => builder) };
    }
    if (table === "estimate_items") {
      const builder = {
        eq: vi.fn(),
        order: vi.fn(),
        range: vi.fn((from: number, to: number) => Promise.resolve({
          data: offerFixture.items.slice(from, to + 1),
          count: offerFixture.items.length,
          error: null,
        })),
      };
      builder.eq.mockReturnValue(builder);
      builder.order.mockReturnValue(builder);
      return { select: vi.fn(() => builder) };
    }
    return {};
  });
}

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: mockFrom,
    rpc: mockRpc,
    storage: { from: vi.fn(() => ({ download: mockStorageDownload })) },
  }),
}));

import { POST } from "./route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_TOKEN = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function makeRequest(body?: unknown) {
  return new Request("http://localhost/api/portal/test-token/reject", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function makeParams(token = VALID_TOKEN) {
  return { params: Promise.resolve({ token }) };
}

const PENDING_TOKEN = {
  id: "token-id-1",
  tenant_id: offerFixture.version.tenant_id,
  version_id: offerFixture.version.id,
  status: "pending",
  expires_at: new Date(Date.now() + 86400000).toISOString(),
  email: "client@test.com",
  capability_contract_version: 1,
  estimate_email_dispatch_id: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/portal/[token]/reject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupFromMock();
    mockRpc.mockResolvedValue({ error: null });
    mockStorageDownload.mockResolvedValue({ data: offerFixture.blob, error: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 404 for unknown token", async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: { code: "PGRST116" } });

    const res = await POST(makeRequest({ reason: "too expensive" }), makeParams());
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/invalide/i);
  });

  it("treats a token from an inactive tenant as invalid", async () => {
    mockSingle.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST116" },
    });

    const res = await POST(makeRequest({}), makeParams());

    expect(res.status).toBe(404);
    expect(mockTokenSelect).toHaveBeenCalledWith(
      expect.stringContaining("tenants!inner(is_active)")
    );
    expect(mockTokenEq).toHaveBeenCalledWith("tenants.is_active", true);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("returns 409 for already-processed token", async () => {
    mockSingle.mockResolvedValueOnce({
      data: { ...PENDING_TOKEN, status: "accepted" },
      error: null,
    });

    const res = await POST(makeRequest({}), makeParams());
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/déjà.*traité/i);
  });

  it("returns 404 for expired token", async () => {
    mockSingle.mockResolvedValueOnce({
      data: {
        ...PENDING_TOKEN,
        expires_at: new Date(Date.now() - 86400000).toISOString(),
      },
      error: null,
    });

    const res = await POST(makeRequest({}), makeParams());
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Ce lien a expiré.");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("returns 200 and updates token on valid rejection", async () => {
    mockSingle.mockResolvedValueOnce({ data: PENDING_TOKEN, error: null });
    mockEqChain.mockResolvedValueOnce({ data: { id: "token-id-1" }, error: null });

    const res = await POST(makeRequest({ reason: "Trop cher" }), makeParams());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("rejected");

    expect(mockRpc).toHaveBeenCalledWith(
      "claim_portal_estimate_decision",
      expect.objectContaining({
        p_portal_token_id: "token-id-1",
        p_decision: "rejected",
        p_reject_reason: "Trop cher",
        p_expected_seal_hash: offerFixture.version.seal_hash,
        p_expected_document_contract: expect.objectContaining({
          documentId: offerFixture.document.id,
          sha256Hash: offerFixture.document.sha256_hash,
          publishedContentRevision: offerFixture.version.content_revision,
        }),
      })
    );
  });

  it("returns 200 with no reason when body is empty", async () => {
    mockSingle.mockResolvedValueOnce({ data: PENDING_TOKEN, error: null });
    mockEqChain.mockResolvedValueOnce({ data: { id: "token-id-1" }, error: null });

    const res = await POST(makeRequest({}), makeParams());
    expect(res.status).toBe(200);

    expect(mockRpc).toHaveBeenCalledWith(
      "claim_portal_estimate_decision",
      expect.objectContaining({
        p_decision: "rejected",
        p_reject_reason: null,
      })
    );
  });

  it("returns 200 when body is not valid JSON (body optional)", async () => {
    mockSingle.mockResolvedValueOnce({ data: PENDING_TOKEN, error: null });
    mockEqChain.mockResolvedValueOnce({ data: { id: "token-id-1" }, error: null });

    const req = new Request("http://localhost/api/portal/test/reject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });

    const res = await POST(req, makeParams());
    expect(res.status).toBe(200);
  });

  it("handles null JSON body gracefully", async () => {
    mockSingle.mockResolvedValueOnce({ data: PENDING_TOKEN, error: null });
    mockEqChain.mockResolvedValueOnce({ data: { id: "token-id-1" }, error: null });

    const res = await POST(makeRequest(null), makeParams());
    expect(res.status).toBe(200);

    expect(mockRpc).toHaveBeenCalledWith(
      "claim_portal_estimate_decision",
      expect.objectContaining({ p_reject_reason: null })
    );
  });

  it("returns 409 on concurrent rejection (0 rows updated)", async () => {
    mockSingle.mockResolvedValueOnce({ data: PENDING_TOKEN, error: null });
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001" },
    });

    const res = await POST(makeRequest({}), makeParams());
    expect(res.status).toBe(409);
  });

  it("delegates rejected audit creation to the atomic decision RPC", async () => {
    mockSingle.mockResolvedValueOnce({ data: PENDING_TOKEN, error: null });
    mockEqChain.mockResolvedValueOnce({ data: { id: "token-id-1" }, error: null });

    await POST(makeRequest({ reason: "Delai" }), makeParams());

    expect(mockRpc).toHaveBeenCalledWith(
      "claim_portal_estimate_decision",
      expect.objectContaining({
        p_portal_token_id: "token-id-1",
        p_decision: "rejected",
        p_reject_reason: "Delai",
      })
    );
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when the atomic decision claim fails unexpectedly", async () => {
    mockSingle.mockResolvedValueOnce({ data: PENDING_TOKEN, error: null });
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "DB error", code: "50000" },
    });

    const res = await POST(makeRequest({}), makeParams());
    expect(res.status).toBe(500);
  });
});
