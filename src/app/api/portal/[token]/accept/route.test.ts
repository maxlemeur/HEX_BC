import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock service-role client
// ---------------------------------------------------------------------------

const mockTokenLookupSingle = vi.fn();
const mockTokenLookupSelect = vi.fn();
const mockTokenLookupEq = vi.fn();
const mockTokenUpdateSingle = vi.fn();
const mockTokenPatchUpdate = vi.fn();
const mockVersionUpdate = vi.fn();
const mockStorageUpload = vi.fn();
const mockRpc = vi.fn();
const mockEmailInsert = vi.fn();
const mockVersionDataSingle = vi.fn();
const mockDocumentMaybeSingle = vi.fn();
const mockResendSend = vi.fn();

function buildMockFrom() {
  return (table: string) => {
    if (table === "portal_tokens") {
      return {
        select: vi.fn((columns: string) => {
          mockTokenLookupSelect(columns);
          const builder = {
            eq: mockTokenLookupEq,
            single: mockTokenLookupSingle,
          };
          mockTokenLookupEq.mockReturnValue(builder);
          return builder;
        }),
        update: vi.fn((data: unknown) => {
          mockTokenPatchUpdate(data);
          return {
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: mockTokenUpdateSingle,
                })),
              })),
              // For signature_url patch (no second eq)
              select: undefined,
            })),
          };
        }),
      };
    }
    if (table === "estimate_versions") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: mockVersionDataSingle,
          })),
        })),
        update: vi.fn(() => {
          mockVersionUpdate();
          return {
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                error: null,
              })),
            })),
          };
        }),
      };
    }
    if (table === "estimate_documents") {
      const builder = {
        eq: vi.fn(),
        maybeSingle: mockDocumentMaybeSingle,
      };
      builder.eq.mockReturnValue(builder);
      return {
        select: vi.fn(() => builder),
      };
    }
    if (table === "estimate_emails") {
      return {
        insert: mockEmailInsert,
      };
    }
    return {};
  };
}

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: vi.fn(buildMockFrom()),
    rpc: mockRpc,
    storage: {
      from: vi.fn(() => ({
        upload: mockStorageUpload,
      })),
    },
  }),
}));

vi.mock("resend", () => ({
  Resend: class MockResend {
    emails = {
      send: mockResendSend,
    };
  },
}));

import { POST } from "./route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_TOKEN = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const VALID_SIGNATURE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function makeRequest(body?: unknown, headers?: Record<string, string>) {
  return new Request("http://localhost/api/portal/test-token/accept", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(headers ?? {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function makeParams(token = VALID_TOKEN) {
  return { params: Promise.resolve({ token }) };
}

const PENDING_TOKEN = {
  id: "token-id-1",
  tenant_id: "tenant-id-1",
  version_id: "version-id-1",
  status: "pending",
  expires_at: new Date(Date.now() + 86400000).toISOString(),
  email: "client@test.com",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/portal/[token]/accept", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ error: null });
    mockStorageUpload.mockResolvedValue({ error: null });
    mockEmailInsert.mockResolvedValue({ error: null });
    mockResendSend.mockResolvedValue({ data: { id: "email-1" }, error: null });
    mockVersionDataSingle.mockResolvedValue({ data: null, error: null });
    mockDocumentMaybeSingle.mockResolvedValue({
      data: {
        status: "ready",
        generated_by: "issuer-id-1",
        layout_options: { includeTerms: false },
        terms_snapshot: null,
      },
      error: null,
    });
    // No email env vars by default (skip email sending)
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 400 on null JSON body", async () => {
    const res = await POST(makeRequest(null), makeParams());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/invalide/i);
  });

  it("returns 400 when accepted_terms is false", async () => {
    const res = await POST(
      makeRequest({ accepted_terms: false }),
      makeParams()
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/conditions/i);
  });

  it("returns 400 when accepted_terms is missing", async () => {
    const res = await POST(makeRequest({}), makeParams());
    expect(res.status).toBe(400);
  });

  it("returns 400 on invalid signature format", async () => {
    const res = await POST(
      makeRequest({
        accepted_terms: true,
        signature_base64: "not-a-data-uri",
      }),
      makeParams()
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/signature/i);
  });

  it("returns 400 on oversized signature", async () => {
    const hugeSignature = `data:image/png;base64,${"A".repeat(800_000)}`;
    const res = await POST(
      makeRequest({
        accepted_terms: true,
        signature_base64: hugeSignature,
      }),
      makeParams()
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/volumineuse/i);
  });

  it("returns 404 for unknown token", async () => {
    mockTokenLookupSingle.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST116" },
    });

    const res = await POST(
      makeRequest({ accepted_terms: true }),
      makeParams()
    );
    expect(res.status).toBe(404);
  });

  it("treats a token from an inactive tenant as invalid", async () => {
    mockTokenLookupSingle.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST116" },
    });

    const res = await POST(
      makeRequest({ accepted_terms: true }),
      makeParams()
    );

    expect(res.status).toBe(404);
    expect(mockTokenLookupSelect).toHaveBeenCalledWith(
      expect.stringContaining("tenants!inner(is_active)")
    );
    expect(mockTokenLookupEq).toHaveBeenCalledWith("tenants.is_active", true);
    expect(mockDocumentMaybeSingle).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockStorageUpload).not.toHaveBeenCalled();
  });

  it("returns 409 for already-accepted token", async () => {
    mockTokenLookupSingle.mockResolvedValueOnce({
      data: { ...PENDING_TOKEN, status: "accepted" },
      error: null,
    });

    const res = await POST(
      makeRequest({ accepted_terms: true }),
      makeParams()
    );
    expect(res.status).toBe(409);
  });

  it("returns 404 for expired token", async () => {
    mockTokenLookupSingle.mockResolvedValueOnce({
      data: {
        ...PENDING_TOKEN,
        expires_at: new Date(Date.now() - 86400000).toISOString(),
      },
      error: null,
    });

    const res = await POST(
      makeRequest({ accepted_terms: true }),
      makeParams()
    );
    expect(res.status).toBe(404);
  });

  it("returns 200 on valid accept without signature", async () => {
    mockTokenLookupSingle.mockResolvedValueOnce({
      data: PENDING_TOKEN,
      error: null,
    });
    mockTokenUpdateSingle.mockResolvedValueOnce({
      data: { id: "token-id-1" },
      error: null,
    });

    const res = await POST(
      makeRequest({ accepted_terms: true }),
      makeParams()
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.status).toBe("accepted");
    expect(json.accepted_at).toBeTruthy();

    expect(mockRpc).toHaveBeenCalledWith(
      "claim_portal_estimate_decision",
      expect.objectContaining({
        p_portal_token_id: "token-id-1",
        p_decision: "accepted",
        p_client_ip: null,
      })
    );
  });

  it("fails closed when the contractual document lookup fails", async () => {
    mockTokenLookupSingle.mockResolvedValueOnce({
      data: PENDING_TOKEN,
      error: null,
    });
    mockDocumentMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "permission denied" },
    });

    const res = await POST(
      makeRequest({ accepted_terms: true }),
      makeParams()
    );

    expect(res.status).toBe(503);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("fails closed when the stored layout expects CGV without a usable snapshot", async () => {
    mockTokenLookupSingle.mockResolvedValueOnce({
      data: PENDING_TOKEN,
      error: null,
    });
    mockDocumentMaybeSingle.mockResolvedValueOnce({
      data: {
        status: "ready",
        generated_by: "issuer-id-1",
        layout_options: { includeTerms: true },
        terms_snapshot: null,
      },
      error: null,
    });

    const res = await POST(
      makeRequest({ accepted_terms: true }),
      makeParams()
    );

    expect(res.status).toBe(409);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("accepts when the required stored CGV snapshot is valid", async () => {
    mockTokenLookupSingle.mockResolvedValueOnce({
      data: PENDING_TOKEN,
      error: null,
    });
    mockDocumentMaybeSingle.mockResolvedValueOnce({
      data: {
        status: "ready",
        generated_by: "issuer-id-1",
        layout_options: { includeTerms: true },
        terms_snapshot: {
          templateId: "11111111-1111-4111-8111-111111111111",
          title: "CGV",
          body: "Conditions contractuelles",
          version: 3,
          legalReviewedAt: "2026-07-01T00:00:00.000Z",
          capturedAt: "2026-07-20T00:00:00.000Z",
        },
      },
      error: null,
    });

    const res = await POST(
      makeRequest({ accepted_terms: true }),
      makeParams()
    );

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      "claim_portal_estimate_decision",
      expect.objectContaining({ p_decision: "accepted" })
    );
  });

  it("returns 200 on valid accept with signature and uploads to storage", async () => {
    mockTokenLookupSingle.mockResolvedValueOnce({
      data: PENDING_TOKEN,
      error: null,
    });
    mockTokenUpdateSingle.mockResolvedValueOnce({
      data: { id: "token-id-1" },
      error: null,
    });

    const res = await POST(
      makeRequest({
        accepted_terms: true,
        signature_base64: VALID_SIGNATURE,
      }),
      makeParams()
    );
    expect(res.status).toBe(200);

    // Verify storage upload was called
    expect(mockStorageUpload).toHaveBeenCalledWith(
      "signatures/token-id-1.png",
      expect.any(Buffer),
      expect.objectContaining({ contentType: "image/png" })
    );
  });

  it("returns 409 on concurrent acceptance (concurrency guard)", async () => {
    mockTokenLookupSingle.mockResolvedValueOnce({
      data: PENDING_TOKEN,
      error: null,
    });
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001" },
    });

    const res = await POST(
      makeRequest({ accepted_terms: true }),
      makeParams()
    );
    expect(res.status).toBe(409);

    // Signature should NOT have been uploaded (guard before upload)
    expect(mockStorageUpload).not.toHaveBeenCalled();
  });

  it("still succeeds when signature upload fails (non-blocking)", async () => {
    mockTokenLookupSingle.mockResolvedValueOnce({
      data: PENDING_TOKEN,
      error: null,
    });
    mockTokenUpdateSingle.mockResolvedValueOnce({
      data: { id: "token-id-1" },
      error: null,
    });
    mockStorageUpload.mockResolvedValueOnce({
      error: { message: "Storage full" },
    });

    const res = await POST(
      makeRequest({
        accepted_terms: true,
        signature_base64: VALID_SIGNATURE,
      }),
      makeParams()
    );
    expect(res.status).toBe(200);
  });

  it("captures client IP from x-forwarded-for header", async () => {
    mockTokenLookupSingle.mockResolvedValueOnce({
      data: PENDING_TOKEN,
      error: null,
    });
    mockTokenUpdateSingle.mockResolvedValueOnce({
      data: { id: "token-id-1" },
      error: null,
    });

    await POST(
      makeRequest({ accepted_terms: true }, { "x-forwarded-for": "1.2.3.4, 5.6.7.8" }),
      makeParams()
    );

    expect(mockRpc).toHaveBeenCalledWith(
      "claim_portal_estimate_decision",
      expect.objectContaining({
        p_client_ip: "1.2.3.4",
      })
    );
  });

  it("delegates accepted audit creation to the atomic decision RPC", async () => {
    mockTokenLookupSingle.mockResolvedValueOnce({
      data: PENDING_TOKEN,
      error: null,
    });
    mockTokenUpdateSingle.mockResolvedValueOnce({
      data: { id: "token-id-1" },
      error: null,
    });

    await POST(makeRequest({ accepted_terms: true }), makeParams());

    expect(mockRpc).toHaveBeenCalledWith(
      "claim_portal_estimate_decision",
      expect.objectContaining({
        p_portal_token_id: "token-id-1",
        p_decision: "accepted",
      })
    );
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it("timestamps a successful legacy acceptance confirmation", async () => {
    process.env.RESEND_API_KEY = "test-key";
    process.env.EMAIL_FROM = "noreply@example.com";
    mockTokenLookupSingle.mockResolvedValueOnce({
      data: PENDING_TOKEN,
      error: null,
    });
    mockVersionDataSingle.mockResolvedValueOnce({
      data: {
        version_number: 1,
        total_ttc_cents: 12_000,
        currency: "EUR",
        estimate_projects: { name: "Projet test" },
      },
      error: null,
    });

    const response = await POST(
      makeRequest({ accepted_terms: true }),
      makeParams()
    );
    const payload = await response.json();

    expect(mockEmailInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "acceptance_confirmation",
        status: "sent",
        sent_at: payload.accepted_at,
      })
    );
  });

  it("does not claim a sent timestamp for a failed legacy confirmation", async () => {
    process.env.RESEND_API_KEY = "test-key";
    process.env.EMAIL_FROM = "noreply@example.com";
    mockTokenLookupSingle.mockResolvedValueOnce({
      data: PENDING_TOKEN,
      error: null,
    });
    mockVersionDataSingle.mockResolvedValueOnce({
      data: {
        version_number: 1,
        total_ttc_cents: 12_000,
        currency: "EUR",
        estimate_projects: { name: "Projet test" },
      },
      error: null,
    });
    mockResendSend.mockResolvedValueOnce({
      data: null,
      error: { name: "validation_error", message: "invalid", statusCode: 422 },
    });

    await POST(makeRequest({ accepted_terms: true }), makeParams());

    expect(mockEmailInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "acceptance_confirmation",
        status: "failed",
        sent_at: null,
      })
    );
  });
});
