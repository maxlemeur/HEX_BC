import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  send: vi.fn(),
  download: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    rpc: mocks.rpc,
    storage: {
      from: (bucket: string) => ({
        download: (path: string) => mocks.download(bucket, path),
      }),
    },
  }),
}));
vi.mock("resend", () => ({
  Resend: class MockResend {
    emails = { send: mocks.send };
  },
}));

import {
  classifyResendFailure,
  deliverEstimateEmailDispatch,
  drainEstimateEmailOutbox,
  MAX_ESTIMATE_EMAIL_OUTBOX_ATTEMPTS,
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

describe("drainEstimateEmailOutbox", () => {
  it("replays due rows with the same deliver path and marks dead after N attempts", async () => {
    const replayable = createDispatch("queued");
    const exhausted = {
      ...createDispatch("processing"),
      id: "66666666-6666-4666-8666-666666666666",
      attempt_count: MAX_ESTIMATE_EMAIL_OUTBOX_ATTEMPTS,
    };
    const deliver = vi.fn().mockResolvedValue({ providerId: "email-1" });
    const claim = vi.fn().mockResolvedValue(exhausted);
    const fail = vi.fn().mockResolvedValue({ ...exhausted, status: "failed" });

    const result = await drainEstimateEmailOutbox({
      listDue: async () => [replayable, exhausted],
      deliver,
      claim,
      fail,
      apiKey: "test-key",
      loadPdfBuffer: async () => PDF_BUFFER,
    });

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatch: replayable,
        // Replays run under the dispatch creator, never a synthetic system actor.
        actorUserId: replayable.created_by,
        apiKey: "test-key",
      })
    );
    // A capped row is closed under a lease the drain holds: claim first, then fail.
    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatchId: exhausted.id,
        actorUserId: exhausted.created_by,
        leaseToken: expect.any(String),
      })
    );
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatchId: exhausted.id,
        leaseToken: claim.mock.calls[0]?.[0]?.leaseToken,
        errorCode: "ESTIMATE_EMAIL_RETRY_CAP",
      })
    );
    expect(result).toMatchObject({
      claimed: 2,
      sent: 1,
      dead: 1,
      failed: 1,
      skipped: false,
    });
  });

  it("reports rows without a creator instead of replaying them under a fake actor", async () => {
    const orphan = { ...createDispatch("queued"), created_by: null };
    const deliver = vi.fn();

    const result = await drainEstimateEmailOutbox({
      listDue: async () => [orphan],
      deliver,
      apiKey: "test-key",
    });

    expect(deliver).not.toHaveBeenCalled();
    expect(result).toMatchObject({ claimed: 0, sent: 0, failed: 1, dead: 0 });
    expect(result.errors[0]).toContain(orphan.id);
  });

  it("does not mark a capped row dead when the claim reveals it already reached a terminal state", async () => {
    const exhausted = {
      ...createDispatch("processing"),
      attempt_count: MAX_ESTIMATE_EMAIL_OUTBOX_ATTEMPTS,
    };
    const claim = vi.fn().mockResolvedValue({ ...exhausted, status: "sent" });
    const fail = vi.fn();

    const result = await drainEstimateEmailOutbox({
      listDue: async () => [exhausted],
      claim,
      fail,
      apiKey: "test-key",
    });

    expect(fail).not.toHaveBeenCalled();
    expect(result).toMatchObject({ claimed: 1, dead: 0, failed: 0 });
  });

  it("downloads the frozen PDF from estimate-documents on the shipped deliver path", async () => {
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
    mocks.download.mockResolvedValue({
      data: {
        arrayBuffer: async () => Uint8Array.from(PDF_BUFFER),
      },
      error: null,
    });

    const result = await drainEstimateEmailOutbox({
      listDue: async () => [createDispatch("queued")],
      apiKey: "test-key",
    });

    expect(mocks.download).toHaveBeenCalledWith(
      "estimate-documents",
      "tenant/version.pdf"
    );
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0]?.[0]?.attachments?.[0]?.content).toEqual(
      PDF_BUFFER
    );
    expect(result).toMatchObject({
      claimed: 1,
      sent: 1,
      failed: 0,
      skipped: false,
    });
  });
});
