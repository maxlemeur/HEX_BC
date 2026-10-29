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

/** The offer's items, as public.read_estimate_version_items returns them. */
function buildItemsRead() {
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
  return builder;
}

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
    return {};
  });
}

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: mockFrom,
    // The offer's items come from buildItemsRead; mockRpc receives every other function call.
    rpc: (functionName: string, ...args: unknown[]) => functionName === "read_estimate_version_items"
      ? buildItemsRead()
      : mockRpc(functionName, ...args),
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
