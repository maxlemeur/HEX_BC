import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { COMPANY_INFO } from "@/lib/company-info";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  send: vi.fn(),
  download: vi.fn(),
  // A direct update of the service client: (table, values, equality filters) -> { data, error }.
  update: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) => ({
      update: (values: Record<string, unknown>) => {
        const filters: Record<string, unknown> = {};
        const chain = {
          eq: (column: string, value: unknown) => {
            filters[column] = value;
            return chain;
          },
          select: async () => mocks.update(table, values, filters),
        };
        return chain;
      },
    }),
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
    request_contract_version: 2,
    portal_url: "http://localhost:3176/portal/66666666-6666-4666-8666-666666666666",
    offer_identity_snapshot: null,
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
    // The cases below assert the provider request as frozen: delivery as written.
    process.env.EMAIL_DELIVERY_MODE = "live";
    delete process.env.EMAIL_REDIRECT_TO;
    mocks.update.mockResolvedValue({ data: [{ id: "11111111-1111-4111-8111-111111111111" }], error: null });
  });

  // TI-691: a redirected send was recorded as sent to the client. The attempt holding the dispatch writes its routing
  // before the provider call, so no send reaches the provider without it.
  it("records the attempt's routing on the dispatch it holds before the provider call", async () => {
    process.env.EMAIL_DELIVERY_MODE = "redirect";
    process.env.EMAIL_REDIRECT_TO = "boite-de-test@example.test";
    let leaseToken: unknown = null;
    mocks.rpc.mockImplementation(async (functionName: string, args: Record<string, unknown>) => {
      if (functionName === "claim_estimate_email_dispatch") {
        leaseToken = args.p_lease_token;
        return { data: { ...createDispatch("processing"), lease_token: args.p_lease_token,
          lease_expires_at: "2026-08-12T00:02:00.000Z" }, error: null };
      }
      if (functionName === "complete_estimate_email_dispatch") return { data: createDispatch("sent"), error: null };
      throw new Error(`Unexpected RPC ${functionName}`);
    });
    mocks.send.mockResolvedValue({ data: { id: "email-1" }, error: null });

    await expect(deliverEstimateEmailDispatch({
      dispatch: createDispatch("queued"), actorUserId: "55555555-5555-4555-8555-555555555555",
      apiKey: "test-key", loadPdfBuffer: async () => PDF_BUFFER, retryDelaysMs: [0],
    })).resolves.toEqual({ providerId: "email-1", redirected: true });

    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith("estimate_emails", { redirected: true }, {
      id: "11111111-1111-4111-8111-111111111111", tenant_id: "22222222-2222-4222-8222-222222222222",
      lease_token: leaseToken, status: "processing",
    });
    expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(mocks.send.mock.invocationCallOrder[0]);
    expect(mocks.send.mock.calls[0][0]).toMatchObject({ to: "boite-de-test@example.test", cc: undefined });
  });

  it("sends nothing and frees the request when the routing cannot be recorded", async () => {
    mocks.update.mockResolvedValue({ data: null, error: { code: "XX000", message: "write refused", details: null } });
    mocks.rpc.mockImplementation(async (functionName: string, args: Record<string, unknown>) => {
      if (functionName === "claim_estimate_email_dispatch") {
        return { data: { ...createDispatch("processing"), lease_token: args.p_lease_token,
          lease_expires_at: "2026-08-12T00:02:00.000Z" }, error: null };
      }
      if (functionName === "fail_estimate_email_dispatch") {
        return { data: { ...createDispatch("processing"), status: "failed", lease_token: null }, error: null };
      }
      throw new Error(`Unexpected RPC ${functionName}`);
    });

    await expect(deliverEstimateEmailDispatch({
      dispatch: createDispatch("queued"), actorUserId: "55555555-5555-4555-8555-555555555555",
      apiKey: "test-key", loadPdfBuffer: async () => PDF_BUFFER, retryDelaysMs: [0],
    })).rejects.toMatchObject({ code: "ESTIMATE_EMAIL_ROUTING_NOT_RECORDED" });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_estimate_email_dispatch", "fail_estimate_email_dispatch",
    ]);
    expect(mocks.update).toHaveBeenCalledWith("estimate_emails", { redirected: false }, expect.anything());
  });

  // Review of the routing record: an earlier attempt may have reached the provider under the routing it recorded.
  it("never sends under another routing than the one an earlier attempt recorded", async () => {
    mocks.rpc.mockImplementation(async (functionName: string, args: Record<string, unknown>) => {
      if (functionName === "claim_estimate_email_dispatch") {
        return { data: { ...createDispatch("processing"), attempt_count: 2, redirected: true, lease_token: args.p_lease_token,
          lease_expires_at: "2026-08-12T00:02:00.000Z" }, error: null };
      }
      if (functionName === "mark_estimate_email_dispatch_unknown") {
        return { data: { ...createDispatch("processing"), status: "unknown", lease_token: null }, error: null };
      }
      throw new Error(`Unexpected RPC ${functionName}`);
    });

    await expect(deliverEstimateEmailDispatch({
      dispatch: createDispatch("queued"), actorUserId: "55555555-5555-4555-8555-555555555555",
      apiKey: "test-key", loadPdfBuffer: async () => PDF_BUFFER, retryDelaysMs: [0],
    })).rejects.toMatchObject({ code: "ESTIMATE_EMAIL_DELIVERY_UNKNOWN" });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_estimate_email_dispatch", "mark_estimate_email_dispatch_unknown",
    ]);
  });

  it("sends a later attempt under the routing already recorded without writing it again", async () => {
    mocks.rpc.mockImplementation(async (functionName: string, args: Record<string, unknown>) => {
      if (functionName === "claim_estimate_email_dispatch") {
        return { data: { ...createDispatch("processing"), attempt_count: 2, redirected: false, lease_token: args.p_lease_token,
          lease_expires_at: "2026-08-12T00:02:00.000Z" }, error: null };
      }
      if (functionName === "complete_estimate_email_dispatch") return { data: createDispatch("sent"), error: null };
      throw new Error(`Unexpected RPC ${functionName}`);
    });
    mocks.send.mockResolvedValue({ data: { id: "email-1" }, error: null });

    await expect(deliverEstimateEmailDispatch({
      dispatch: createDispatch("queued"), actorUserId: "55555555-5555-4555-8555-555555555555",
      apiKey: "test-key", loadPdfBuffer: async () => PDF_BUFFER, retryDelaysMs: [0],
    })).resolves.toEqual({ providerId: "email-1", redirected: false });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("settles nothing when its lease was lost before the routing was written", async () => {
    mocks.update.mockResolvedValue({ data: [], error: null });
    mocks.rpc.mockImplementation(async (functionName: string, args: Record<string, unknown>) => {
      if (functionName === "claim_estimate_email_dispatch") {
        return { data: { ...createDispatch("processing"), lease_token: args.p_lease_token,
          lease_expires_at: "2026-08-12T00:02:00.000Z" }, error: null };
      }
      throw new Error(`Unexpected RPC ${functionName}`);
    });

    await expect(deliverEstimateEmailDispatch({
      dispatch: createDispatch("queued"), actorUserId: "55555555-5555-4555-8555-555555555555",
      apiKey: "test-key", loadPdfBuffer: async () => PDF_BUFFER, retryDelaysMs: [0],
    })).rejects.toMatchObject({ code: "ESTIMATE_EMAIL_ROUTING_LEASE_LOST" });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["claim_estimate_email_dispatch"]);
  });

  it("replays the identical provider request when provider success precedes a DB failure", async () => {
    let completionCount = 0;
    mocks.rpc.mockImplementation(async (functionName: string, args: Record<string, unknown>) => {
      if (functionName === "claim_estimate_email_dispatch") {
        return { data: { ...createDispatch("processing"), lease_token: args.p_lease_token, lease_expires_at: "2026-08-12T00:02:00.000Z" }, error: null };
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

  it("does not resend or compensate after a malformed completion receipt", async () => {
    mocks.rpc.mockImplementation(async (functionName: string, args: Record<string, unknown>) => {
      if (functionName === "claim_estimate_email_dispatch") {
        return { data: { ...createDispatch("processing"), lease_token: args.p_lease_token,
          lease_expires_at: "2026-08-12T00:02:00.000Z" }, error: null };
      }
      if (functionName === "complete_estimate_email_dispatch") {
        return { data: { ...createDispatch("sent"), provider_id: "unrelated-provider-id" }, error: null };
      }
      throw new Error(`Unexpected compensating RPC ${functionName}`);
    });
    mocks.send.mockResolvedValue({ data: { id: "email-1" }, error: null });
    await expect(deliverEstimateEmailDispatch({
      dispatch: createDispatch("queued"), actorUserId: "55555555-5555-4555-8555-555555555555",
      apiKey: "test-key", loadPdfBuffer: async () => PDF_BUFFER, retryDelaysMs: [0],
    })).rejects.toMatchObject({ code: "ESTIMATE_EMAIL_DISPATCH_INVALID_RESPONSE" });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_estimate_email_dispatch", "complete_estimate_email_dispatch",
    ]);
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
        portalOrigin: "http://localhost:3176",
        companySnapshot: COMPANY_INFO,
      })
    ).rejects.toMatchObject({
      code: "ESTIMATE_EMAIL_RETRY_REQUIRES_NEW_REQUEST",
      status: 409,
    });
  });
});

describe("drainEstimateEmailOutbox", () => {
  it("advances the eligible dispatch after 25 blocked actors and reports the blocked count", async () => {
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "list_due_estimate_email_dispatches") {
        return { data: { dispatches: [createDispatch("queued")], blocked: 25 }, error: null };
      }
      if (name === "claim_estimate_email_dispatch") return { data: { ...createDispatch("processing"), lease_token: args.p_lease_token, lease_expires_at: "2026-08-12T00:02:00.000Z" }, error: null };
      if (name === "complete_estimate_email_dispatch") return { data: createDispatch("sent"), error: null };
      throw new Error(`Unexpected RPC ${name}`);
    });
    mocks.send.mockClear().mockResolvedValue({ data: { id: "email-1" }, error: null });
    const result = await drainEstimateEmailOutbox({ apiKey: "test-key", loadPdfBuffer: async () => PDF_BUFFER });
    expect(result).toMatchObject({ blocked: 25, claimed: 1, sent: 1, failed: 0, dead: 0, skipped: false });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("list_due_estimate_email_dispatches", expect.objectContaining({ p_limit: 25 }));
  });

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
    mocks.rpc.mockImplementation(async (functionName: string, args: Record<string, unknown>) => {
      if (functionName === "claim_estimate_email_dispatch") {
        return { data: { ...createDispatch("processing"), lease_token: args.p_lease_token, lease_expires_at: "2026-08-12T00:02:00.000Z" }, error: null };
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
      PDF_BUFFER.toString("base64")
    );
    expect(result).toMatchObject({
      claimed: 1,
      sent: 1,
      failed: 0,
      skipped: false,
    });
  });

  it("hands the provider the test mailbox, not the frozen recipients, when delivery is redirected", async () => {
    delete process.env.EMAIL_DELIVERY_MODE;
    process.env.EMAIL_REDIRECT_TO = "recette@test.invalid";
    mocks.rpc.mockImplementation(async (functionName: string, args: Record<string, unknown>) => {
      if (functionName === "claim_estimate_email_dispatch") {
        return { data: { ...createDispatch("processing"), lease_token: args.p_lease_token, lease_expires_at: "2026-08-12T00:02:00.000Z" }, error: null };
      }
      if (functionName === "complete_estimate_email_dispatch") {
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
      retryDelaysMs: [],
    });

    expect(mocks.send).toHaveBeenCalledTimes(1);
    const [request, options] = mocks.send.mock.calls[0]!;
    expect(request).toMatchObject({
      from: "noreply@example.com",
      to: "recette@test.invalid",
      subject: "[TEST → client@example.com, cc copy@example.com] Devis fige",
    });
    expect(request.cc).toBeUndefined();
    expect(JSON.stringify(request.to)).not.toContain("client@example.com");
    // The frozen envelope is still what is sent: same key, same attachment.
    expect(options).toEqual({ idempotencyKey: "estimate-email/11111111-1111-4111-8111-111111111111" });
    expect(request.attachments[0].content).toEqual(PDF_BUFFER.toString("base64"));
  });

  it("neither claims the dispatch nor calls the provider when redirecting has no mailbox", async () => {
    delete process.env.EMAIL_DELIVERY_MODE;
    delete process.env.EMAIL_REDIRECT_TO;

    await expect(deliverEstimateEmailDispatch({
      dispatch: createDispatch("queued"),
      actorUserId: "55555555-5555-4555-8555-555555555555",
      apiKey: "test-key",
      loadPdfBuffer: async () => PDF_BUFFER,
      retryDelaysMs: [],
    })).rejects.toMatchObject({ code: "EMAIL_REDIRECT_NOT_CONFIGURED" });

    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
