import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("resend", () => ({
  Resend: class MockResend {
    emails = { send: mocks.send };
  },
}));

import {
  classifyResendFailure,
  deliverEstimateEmailDispatch,
  reserveEstimateEmailDispatch,
  type EstimateEmailDispatch,
} from "@/lib/email/estimate-email-outbox";

const PDF_BUFFER = Buffer.from("frozen-pdf");
const PDF_HASH = createHash("sha256").update(PDF_BUFFER).digest("hex");

function createDispatch(
  status: EstimateEmailDispatch["status"] = "processing"
): EstimateEmailDispatch {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    tenant_id: "22222222-2222-4222-8222-222222222222",
    version_id: "33333333-3333-4333-8333-333333333333",
    recipient: "client@example.com",
    cc: ["copy@example.com"],
    subject: "Devis fige",
    body: "Bonjour",
    status,
    provider_id: status === "sent" ? "email-1" : null,
    sent_at: status === "sent" ? "2026-08-12T00:00:00.000Z" : null,
    request_id: "44444444-4444-4444-8444-444444444444",
    payload_hash: "a".repeat(64),
    provider_payload_hash: "b".repeat(64),
    idempotency_key: "estimate-email/11111111-1111-4111-8111-111111111111",
    created_by: "55555555-5555-4555-8555-555555555555",
    version_content_revision: 1,
    from_address: "noreply@example.com",
    html_body: "<p>Bonjour</p>",
    text_body: "Bonjour",
    document_path: "tenant/version.pdf",
    document_sha256: PDF_HASH,
    attachment_filename: "HEX_D26001MM_V2.pdf",
    attempt_count: 1,
    first_attempt_at: "2026-08-12T00:00:00.000Z",
    lease_token: null,
    lease_expires_at: null,
    last_error_code: null,
    last_error_message: null,
  };
}

describe("estimate email outbox provider boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends the frozen payload with the database-owned idempotency key", async () => {
    mocks.rpc.mockImplementation(async (functionName: string) => {
      if (functionName === "claim_estimate_email_dispatch") {
        return { data: createDispatch("processing"), error: null };
      }
      if (functionName === "complete_estimate_email_dispatch") {
        return { data: createDispatch("sent"), error: null };
      }
      throw new Error(`Unexpected RPC ${functionName}`);
    });
    mocks.send.mockResolvedValue({ data: { id: "email-1" }, error: null });

    await expect(
      deliverEstimateEmailDispatch({
        dispatch: createDispatch("queued"),
        actorUserId: "55555555-5555-4555-8555-555555555555",
        apiKey: "test-key",
        loadPdfBuffer: async () => PDF_BUFFER,
        retryDelaysMs: [],
      })
    ).resolves.toEqual({ providerId: "email-1" });

    expect(mocks.send).toHaveBeenCalledWith(
      {
        from: "noreply@example.com",
        to: "client@example.com",
        cc: ["copy@example.com"],
        subject: "Devis fige",
        html: "<p>Bonjour</p>",
        text: "Bonjour",
        attachments: [
          {
            filename: "HEX_D26001MM_V2.pdf",
            content: PDF_BUFFER,
          },
        ],
      },
      {
        idempotencyKey:
          "estimate-email/11111111-1111-4111-8111-111111111111",
      }
    );
  });

  it("replays the identical provider request when provider success precedes a DB failure", async () => {
    let completionCount = 0;
    mocks.rpc.mockImplementation(async (functionName: string) => {
      if (functionName === "claim_estimate_email_dispatch") {
        return { data: createDispatch("processing"), error: null };
      }
      if (functionName === "complete_estimate_email_dispatch") {
        completionCount += 1;
        if (completionCount === 1) {
          return {
            data: null,
            error: { code: "08006", message: "connection lost", details: null },
          };
        }
        return { data: createDispatch("sent"), error: null };
      }
      throw new Error(`Unexpected RPC ${functionName}`);
    });
    mocks.send.mockResolvedValue({ data: { id: "email-1" }, error: null });

    await deliverEstimateEmailDispatch({
      dispatch: createDispatch("queued"),
      actorUserId: "55555555-5555-4555-8555-555555555555",
      apiKey: "test-key",
      loadPdfBuffer: async () => PDF_BUFFER,
      retryDelaysMs: [0],
    });

    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.send.mock.calls[1]).toEqual(mocks.send.mock.calls[0]);
  });

  it("classifies provider errors conservatively", () => {
    expect(
      classifyResendFailure({
        name: "invalid_idempotent_request",
        message: "payload mismatch",
        statusCode: 409,
      })
    ).toBe("unknown");
    expect(
      classifyResendFailure({
        name: "rate_limit_exceeded",
        message: "slow down",
        statusCode: 429,
      })
    ).toBe("retry");
    expect(
      classifyResendFailure({
        name: "invalid_idempotency_key",
        message: "invalid key",
        statusCode: 400,
      })
    ).toBe("failed");
    expect(
      classifyResendFailure({
        name: "validation_error",
        message: "invalid recipient",
        statusCode: 422,
      })
    ).toBe("failed");
  });

  it("preserves the frozen-retry conflict as a stable public error code", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message: "ESTIMATE_EMAIL_RETRY_REQUIRES_NEW_REQUEST",
        details: null,
      },
    });

    await expect(
      reserveEstimateEmailDispatch({
        tenantId: "22222222-2222-4222-8222-222222222222",
        versionId: "33333333-3333-4333-8333-333333333333",
        actorUserId: "55555555-5555-4555-8555-555555555555",
        requestId: "44444444-4444-4444-8444-444444444444",
        recipient: "client@example.com",
        cc: ["copy@example.com"],
        subject: "Devis fige",
        body: "Bonjour",
        payloadHash: "a".repeat(64),
        expectedUpdatedAt: "2026-08-12T00:00:00.000Z",
        fromAddress: "noreply@example.com",
      })
    ).rejects.toMatchObject({
      code: "ESTIMATE_EMAIL_RETRY_REQUIRES_NEW_REQUEST",
      status: 409,
    });
  });
});
