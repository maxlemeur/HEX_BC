import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPortalLegacyOfferFixture } from "@/test/fixtures/portal-legacy-offer";

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
const mockStorageDownload = vi.fn();
const mockRpc = vi.fn();
const mockEmailInsert = vi.fn();
const mockVersionDataSingle = vi.fn();
const mockDocumentSingle = vi.fn();
const mockResendSend = vi.fn();
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
      const builder = {
        eq: vi.fn(),
        abortSignal: vi.fn(),
        single: mockVersionDataSingle,
      };
      builder.eq.mockReturnValue(builder);
      builder.abortSignal.mockReturnValue(builder);
      return {
        select: vi.fn(() => builder),
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
        single: mockDocumentSingle,
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
    // The offer's items come from buildItemsRead; mockRpc receives every other function call.
    rpc: (functionName: string, ...args: unknown[]) => functionName === "read_estimate_version_items"
      ? buildItemsRead()
      : mockRpc(functionName, ...args),
    storage: {
      from: vi.fn(() => ({
        upload: mockStorageUpload,
        download: mockStorageDownload,
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

describe("POST /api/portal/[token]/accept", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ error: null });
    mockStorageUpload.mockResolvedValue({ error: null });
    mockStorageDownload.mockResolvedValue({ data: offerFixture.blob, error: null });
    mockEmailInsert.mockResolvedValue({ error: null });
    mockResendSend.mockResolvedValue({ data: { id: "email-1" }, error: null });
    mockVersionDataSingle.mockResolvedValue({ data: offerFixture.version, error: null });
    mockDocumentSingle.mockResolvedValue({
      data: offerFixture.document,
      error: null,
    });
    // No email env vars by default (skip email sending)
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it("fails closed when the contractual document lookup fails", async () => {
    mockTokenLookupSingle.mockResolvedValueOnce({
      data: PENDING_TOKEN,
      error: null,
    });
    mockDocumentSingle.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "permission denied" },
    });

    const res = await POST(
      makeRequest({ accepted_terms: true }),
      makeParams()
    );

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/copie.*vérifiée/i);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockStorageUpload).not.toHaveBeenCalled();
  });

  it("fails closed when the stored layout expects CGV without a usable snapshot", async () => {
    mockTokenLookupSingle.mockResolvedValueOnce({
      data: PENDING_TOKEN,
      error: null,
    });
    mockDocumentSingle.mockResolvedValueOnce({
      data: {
        ...offerFixture.document,
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

  it("does not claim a sent timestamp for a failed legacy confirmation", async () => {
    process.env.RESEND_API_KEY = "test-key";
    process.env.EMAIL_FROM = "noreply@example.com";
    mockTokenLookupSingle.mockResolvedValueOnce({
      data: PENDING_TOKEN,
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
