import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock service-role client
// ---------------------------------------------------------------------------

const mockSingle = vi.fn();
const mockEqChain = vi.fn();
const mockUpdate = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();

function setupFromMock() {
  // Fluent chain: from().select().eq().single() and from().update().eq().eq().select().single()
  mockFrom.mockImplementation((table: string) => {
    if (table === "portal_tokens") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: mockSingle,
          })),
        })),
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
      return {
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              error: null,
            })),
          })),
        })),
      };
    }
    return {};
  });
}

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: mockFrom,
    rpc: mockRpc,
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
  version_id: "version-id-1",
  status: "pending",
  expires_at: new Date(Date.now() + 86400000).toISOString(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/portal/[token]/reject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupFromMock();
    mockRpc.mockResolvedValue({ error: null });
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

  it("returns 409 for already-processed token", async () => {
    mockSingle.mockResolvedValueOnce({
      data: { ...PENDING_TOKEN, status: "accepted" },
      error: null,
    });

    const res = await POST(makeRequest({}), makeParams());
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/deja.*traite/i);
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
    expect(json.error).toMatch(/expire/i);
  });

  it("returns 200 and updates token on valid rejection", async () => {
    mockSingle.mockResolvedValueOnce({ data: PENDING_TOKEN, error: null });
    mockEqChain.mockResolvedValueOnce({ data: { id: "token-id-1" }, error: null });

    const res = await POST(makeRequest({ reason: "Trop cher" }), makeParams());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("rejected");

    // Verify token was updated with reject reason
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "rejected",
        reject_reason: "Trop cher",
      })
    );
  });

  it("returns 200 with no reason when body is empty", async () => {
    mockSingle.mockResolvedValueOnce({ data: PENDING_TOKEN, error: null });
    mockEqChain.mockResolvedValueOnce({ data: { id: "token-id-1" }, error: null });

    const res = await POST(makeRequest({}), makeParams());
    expect(res.status).toBe(200);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "rejected",
        reject_reason: null,
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

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ reject_reason: null })
    );
  });

  it("returns 409 on concurrent rejection (0 rows updated)", async () => {
    mockSingle.mockResolvedValueOnce({ data: PENDING_TOKEN, error: null });
    mockEqChain.mockResolvedValueOnce({ data: null, error: { code: "PGRST116" } });

    const res = await POST(makeRequest({}), makeParams());
    expect(res.status).toBe(409);
  });

  it("logs rejected event via RPC", async () => {
    mockSingle.mockResolvedValueOnce({ data: PENDING_TOKEN, error: null });
    mockEqChain.mockResolvedValueOnce({ data: { id: "token-id-1" }, error: null });

    await POST(makeRequest({ reason: "Delai" }), makeParams());

    expect(mockRpc).toHaveBeenCalledWith(
      "log_estimate_version_event",
      expect.objectContaining({
        p_estimate_version_id: "version-id-1",
        p_event_type: "rejected",
        p_created_by: null,
        p_metadata: expect.objectContaining({
          portal_token_id: "token-id-1",
          rejected_via: "portal",
          reason: "Delai",
        }),
      })
    );
  });

  it("returns 500 when version update fails", async () => {
    mockSingle.mockResolvedValueOnce({ data: PENDING_TOKEN, error: null });
    mockEqChain.mockResolvedValueOnce({ data: { id: "token-id-1" }, error: null });

    // Override estimate_versions to return error
    mockFrom.mockImplementation((table: string) => {
      if (table === "portal_tokens") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ single: mockSingle })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({ single: mockEqChain })),
              })),
            })),
          })),
        };
      }
      if (table === "estimate_versions") {
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                error: { message: "DB error", code: "50000" },
              })),
            })),
          })),
        };
      }
      return {};
    });

    const res = await POST(makeRequest({}), makeParams());
    expect(res.status).toBe(500);
  });
});
