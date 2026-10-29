import { beforeEach, describe, expect, it, vi } from "vitest";

const outboxMocks = vi.hoisted(() => ({
  findByRequest: vi.fn(),
  findActive: vi.fn(),
  reserve: vi.fn(),
  prepare: vi.fn(),
  deliver: vi.fn(),
  fail: vi.fn(),
}));
const serverMocks = vi.hoisted(() => ({
  freeze: vi.fn(),
  getGating: vi.fn(),
  verifySeal: vi.fn(),
  loadSealSource: vi.fn(),
  buildSealPayload: vi.fn(),
  computeSealHash: vi.fn(),
}));
const renderMocks = vi.hoisted(() => ({
  render: vi.fn(),
}));
const offerMocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/estimates/offer-document", () => ({
  loadVerifiedOfferDocument: offerMocks.load,
}));

vi.mock("@react-email/components", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@react-email/components")>()),
  render: renderMocks.render,
}));
vi.mock("@/lib/auth/tenant-context", () => ({
  getAuthenticatedTenantContext: vi.fn(),
}));
vi.mock("@/lib/email/estimate-email-dispatch-repository", () => ({
  findEstimateEmailDispatchByRequest: outboxMocks.findByRequest,
  findActiveEstimateEmailDispatch: outboxMocks.findActive,
  reserveEstimateEmailDispatch: outboxMocks.reserve,
  prepareEstimateEmailDispatch: outboxMocks.prepare,
  failEstimateEmailDispatch: outboxMocks.fail,
}));
vi.mock("@/lib/email/estimate-email-hash", () => ({
  canonicalJsonHash: vi.fn(() => "a".repeat(64)),
}));
vi.mock("@/lib/email/estimate-email-delivery", () => ({
  deliverEstimateEmailDispatch: outboxMocks.deliver,
}));
vi.mock("@/lib/estimates/pdf-generator", () => ({
  generateEstimatePdfNow: vi.fn(),
  getEstimatePdfStatus: vi.fn(),
}));
vi.mock("@/lib/estimates/version-lifecycle-server", () => ({
  freezeEstimateV2SnapshotForSend: serverMocks.freeze,
  getEstimateSendGating: serverMocks.getGating,
}));

import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { sendEstimateEmail } from "@/lib/email/send-estimate";
import { badRequest, internalError } from "@/lib/estimates/errors";
import {
  generateEstimatePdfNow,
  getEstimatePdfStatus,
} from "@/lib/estimates/pdf-generator";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const REQUEST_ID = "44444444-4444-4444-8444-444444444444";
const UPDATED_AT = "2026-07-13T12:00:00.000Z";
const FROZEN_UPDATED_AT = "2026-07-13T12:00:01.000Z";
const PDF_HASH = "b".repeat(64);
const SEAL_HASH = "c".repeat(64);

function createContext(
  status: string,
  versionOverrides: Record<string, unknown> = {}
) {
  return {
    userId: USER_ID,
    tenantId: TENANT_ID,
    tenantRole: "engineer",
    isTenantAdmin: false,
    membership: { role: "engineer" },
    supabase: {
      from: vi.fn((table: string) => {
        if (table !== "estimate_versions") {
          throw new Error(`Unexpected table ${table}`);
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: VERSION_ID,
                    tenant_id: TENANT_ID,
                    version_number: 2,
                    total_ttc_cents: 12_000,
                    currency: "EUR",
                    status,
                    updated_at: UPDATED_AT,
                    content_revision: 1,
                    calc_engine_version: 1,
                    ...versionOverrides,
                    estimate_projects: {
                      name: "Projet test",
                      estimate_reference: "HEX_D26001MM",
                    },
                  },
                  error: null,
                }),
              })),
            })),
          })),
        };
      }),
      storage: {
        from: vi.fn(() => ({
          download: vi.fn().mockResolvedValue({
            data: new Blob(["pdf"]),
            error: null,
          }),
        })),
      },
    },
  };
}

function createDispatch(status: string) {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    tenant_id: TENANT_ID,
    version_id: VERSION_ID,
    recipient: "client@example.com",
    cc: null,
    subject: "Devis",
    body: "Bonjour",
    status,
    provider_id: status === "sent" ? "email-existing" : null,
    sent_at: null,
    request_id: REQUEST_ID,
    payload_hash: "a".repeat(64),
    provider_payload_hash: status === "preparing" ? null : "d".repeat(64),
    idempotency_key: "estimate-email/55555555-5555-4555-8555-555555555555",
    created_by: USER_ID,
    version_content_revision: 1,
    from_address: "noreply@example.com",
    request_contract_version: 2,
    portal_url: "https://app.example.test/portal/99999999-9999-4999-8999-999999999999",
    offer_identity_snapshot: {},
    html_body: status === "preparing" ? null : "<p>Bonjour</p>",
    text_body: status === "preparing" ? null : "Bonjour",
    document_path: status === "preparing" ? null : `${TENANT_ID}/${VERSION_ID}.pdf`,
    document_sha256: status === "preparing" ? null : PDF_HASH,
    attachment_filename: status === "preparing" ? null : "HEX_D26001MM_V2.pdf",
    attempt_count: 0,
    first_attempt_at: null,
    lease_token: null,
    lease_expires_at: null,
    last_error_code: null,
    last_error_message: null,
  };
}

const request = {
  versionId: VERSION_ID,
  payload: {
    to: "client@example.com",
    subject: "Devis",
    message: "Bonjour",
  },
  requestUrl: "https://app.example.test/api/send",
  idempotencyKey: REQUEST_ID,
  concurrencyToken: UPDATED_AT,
  draftLockSessionId: "55555555-5555-4555-8555-555555555555",
};

describe("sendEstimateEmail transactional workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESEND_API_KEY = "test-key";
    process.env.EMAIL_FROM = "noreply@example.com";
    delete process.env.NEXT_PUBLIC_ESTIMATE_PORTAL_BASE_URL;
    serverMocks.getGating.mockResolvedValue({
      gating: { blockingFlags: [] },
    });
    serverMocks.freeze.mockResolvedValue({
      id: VERSION_ID,
      updated_at: FROZEN_UPDATED_AT,
      content_revision: 2,
    });
    serverMocks.verifySeal.mockResolvedValue({ valid: true });
    serverMocks.loadSealSource.mockResolvedValue({ version: {}, items: [] });
    serverMocks.buildSealPayload.mockReturnValue({});
    serverMocks.computeSealHash.mockReturnValue(SEAL_HASH);
    offerMocks.load.mockResolvedValue({
      buffer: Buffer.from("pdf"),
      sealHash: SEAL_HASH,
      sealPayloadVersion: 5,
      proof: {
        filePath: `${TENANT_ID}/${VERSION_ID}/contract.pdf`,
        sha256Hash: PDF_HASH,
        clientContractVersion: 1,
        clientContractSnapshot: {
          project: { name: "Chantier", estimateReference: "HEX_D26001MM_V2" },
          company: { name: "Entreprise émettrice" },
          version: { number: 2, currency: "EUR" },
          totals: { payableTtcCents: 1200 },
        },
      },
    });
    renderMocks.render
      .mockResolvedValueOnce("<p>Bonjour</p>")
      .mockResolvedValueOnce("Bonjour");
    outboxMocks.findByRequest.mockResolvedValue(null);
    outboxMocks.findActive.mockResolvedValue(null);
    vi.mocked(generateEstimatePdfNow).mockResolvedValue({
      file_path: `${TENANT_ID}/${VERSION_ID}.pdf`,
      sha256_hash: PDF_HASH,
    } as never);
    vi.mocked(getEstimatePdfStatus).mockResolvedValue({
      status: "ready",
      download_url: "https://storage.example.test/contract.pdf",
      file_path: `${TENANT_ID}/${VERSION_ID}/contract.pdf`,
      sha256_hash: PDF_HASH,
    });
    outboxMocks.reserve.mockResolvedValue(createDispatch("preparing"));
    outboxMocks.prepare.mockResolvedValue(createDispatch("queued"));
    outboxMocks.deliver.mockResolvedValue({ providerId: "email-1" });
    outboxMocks.fail.mockResolvedValue(createDispatch("failed"));
  });

  it("does not reserve, generate, or send when draft gating rejects", async () => {
    vi.mocked(getAuthenticatedTenantContext).mockResolvedValue(
      createContext("draft", { calc_engine_version: 2 }) as never
    );
    serverMocks.getGating.mockRejectedValue(
      badRequest("Envoi bloque.", undefined, "ESTIMATE_GATING_BLOCKED")
    );

    await expect(sendEstimateEmail(request)).rejects.toMatchObject({
      code: "ESTIMATE_GATING_BLOCKED",
    });
    expect(outboxMocks.reserve).not.toHaveBeenCalled();
    expect(generateEstimatePdfNow).not.toHaveBeenCalled();
    expect(outboxMocks.deliver).not.toHaveBeenCalled();
  });

  it("rejects a finalized estimate before reserving an outbox row", async () => {
    vi.mocked(getAuthenticatedTenantContext).mockResolvedValue(
      createContext("accepted") as never
    );

    await expect(sendEstimateEmail(request)).rejects.toMatchObject({
      code: "ESTIMATE_EMAIL_STATUS_FORBIDDEN",
    });
    expect(outboxMocks.reserve).not.toHaveBeenCalled();
    expect(generateEstimatePdfNow).not.toHaveBeenCalled();
  });

  it("rejects a sent estimate whose seal no longer verifies", async () => {
    vi.mocked(getAuthenticatedTenantContext).mockResolvedValue(
      createContext("sent") as never
    );
    offerMocks.load.mockRejectedValue(badRequest("Scellement invalide.", undefined, "ESTIMATE_SEAL_INVALID"));

    await expect(sendEstimateEmail(request)).rejects.toMatchObject({
      code: "ESTIMATE_SEAL_INVALID",
    });
    expect(outboxMocks.reserve).not.toHaveBeenCalled();
  });

  it("does not compensate or deliver when preparation may have committed but its receipt is invalid", async () => {
    vi.mocked(getAuthenticatedTenantContext).mockResolvedValue(createContext("draft") as never);
    outboxMocks.prepare.mockRejectedValue(internalError("Confirmation invalide.", undefined,
      "ESTIMATE_EMAIL_DISPATCH_INVALID_RESPONSE"));
    await expect(sendEstimateEmail(request)).rejects.toMatchObject({ code: "ESTIMATE_EMAIL_DISPATCH_INVALID_RESPONSE" });
    expect(outboxMocks.fail).not.toHaveBeenCalled();
    expect(outboxMocks.deliver).not.toHaveBeenCalled();
  });

  it("releases the draft when preparation fails before any provider call", async () => {
    vi.mocked(getAuthenticatedTenantContext).mockResolvedValue(
      createContext("draft") as never
    );
    vi.mocked(generateEstimatePdfNow).mockRejectedValue(new Error("PDF failed"));

    await expect(sendEstimateEmail(request)).rejects.toThrow("PDF failed");
    expect(outboxMocks.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "ESTIMATE_EMAIL_PREPARATION_FAILED",
      })
    );
    expect(outboxMocks.deliver).not.toHaveBeenCalled();
  });

  it.each(["accepted", "archived"])(
    "returns the stored provider id when the same request is replayed after the version became %s",
    async (status) => {
    process.env.NEXT_PUBLIC_ESTIMATE_PORTAL_BASE_URL = "not-an-absolute-url";
    vi.mocked(getAuthenticatedTenantContext).mockResolvedValue(
      createContext(status) as never
    );
    outboxMocks.findByRequest.mockResolvedValue(createDispatch("sent"));

    await expect(sendEstimateEmail(request)).resolves.toEqual({
      message_id: "email-existing", version_id: VERSION_ID, request_id: REQUEST_ID,
    });
    expect(outboxMocks.findActive).not.toHaveBeenCalled();
    expect(outboxMocks.reserve).not.toHaveBeenCalled();
    expect(generateEstimatePdfNow).not.toHaveBeenCalled();
    expect(outboxMocks.deliver).not.toHaveBeenCalled();
    }
  );

  it.each(["sending", "sent"])(
    "resumes the same frozen database payload with a fresh key on %s status",
    async (status) => {
      process.env.NEXT_PUBLIC_ESTIMATE_PORTAL_BASE_URL = "not-an-absolute-url";
      vi.mocked(getAuthenticatedTenantContext).mockResolvedValue(
        createContext(status) as never
      );
      const frozenDispatch = {
        ...createDispatch("queued"),
        request_id: "66666666-6666-4666-8666-666666666666",
      };
      outboxMocks.findActive.mockResolvedValue(frozenDispatch);

      await expect(
        sendEstimateEmail({
          ...request,
          idempotencyKey: "77777777-7777-4777-8777-777777777777",
        })
      ).resolves.toEqual({ message_id: "email-1", version_id: VERSION_ID, request_id: "77777777-7777-4777-8777-777777777777" });

      expect(outboxMocks.deliver).toHaveBeenCalledWith(
        expect.objectContaining({ dispatch: frozenDispatch })
      );
      expect(outboxMocks.reserve).not.toHaveBeenCalled();
      expect(serverMocks.getGating).not.toHaveBeenCalled();
      expect(serverMocks.verifySeal).not.toHaveBeenCalled();
      expect(generateEstimatePdfNow).not.toHaveBeenCalled();
      expect(getEstimatePdfStatus).not.toHaveBeenCalled();
    }
  );

  it("rejects a modified submission while another immutable envelope is active", async () => {
    vi.mocked(getAuthenticatedTenantContext).mockResolvedValue(
      createContext("sending") as never
    );
    outboxMocks.findActive.mockResolvedValue({
      ...createDispatch("queued"),
      payload_hash: "f".repeat(64),
    });

    await expect(sendEstimateEmail(request)).rejects.toMatchObject({
      status: 409,
      code: "ESTIMATE_EMAIL_DISPATCH_CONFLICT",
    });
    expect(outboxMocks.reserve).not.toHaveBeenCalled();
    expect(outboxMocks.deliver).not.toHaveBeenCalled();
  });

  it("reuses the frozen PDF when an active sent resend becomes accepted before preparation", async () => {
    vi.mocked(getAuthenticatedTenantContext).mockResolvedValue(
      createContext("accepted") as never
    );
    const activeDispatch = {
      ...createDispatch("preparing"),
      request_id: "88888888-8888-4888-8888-888888888888",
      body: request.payload.message,
    };
    outboxMocks.findActive.mockResolvedValue(activeDispatch);

    await expect(
      sendEstimateEmail(request)
    ).resolves.toEqual({ message_id: "email-1", version_id: VERSION_ID, request_id: REQUEST_ID });

    expect(offerMocks.load).toHaveBeenCalled();
    expect(generateEstimatePdfNow).not.toHaveBeenCalled();
    expect(outboxMocks.reserve).not.toHaveBeenCalled();
    expect(outboxMocks.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatchId: activeDispatch.id,
        documentPath: `${TENANT_ID}/${VERSION_ID}/contract.pdf`,
        documentSha256: PDF_HASH,
      })
    );
  });
});
