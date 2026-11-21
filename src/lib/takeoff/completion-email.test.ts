import { describe, expect, it, vi } from "vitest";

import { deliverTakeoffCompletionEmail, type CompletionEmailClaim } from "@/lib/takeoff/completion-email";

const sendingAt = new Date("2026-11-20T08:00:00Z");
const claim: CompletionEmailClaim = {
  id: "8f400000-0000-4000-8000-000000000021",
  project_id: "8f400000-0000-4000-8000-000000000010",
  recipient_email: "requester@example.test",
  outcome: "success",
  provider_key: "takeoff-completion/test",
  attempt_count: 1,
  first_send_at: null,
};
const env = {
  EMAIL_DELIVERY_MODE: "redirect",
  EMAIL_REDIRECT_TO: "collector@example.test",
  EMAIL_FROM: "Métrés <no-reply@example.test>",
  RESEND_API_KEY: "fictional-key",
  MERGEONE_TAKEOFF_EMAIL_ORIGIN: "https://estimates.example.test",
};

function fixture() {
  return {
    prepare: vi.fn().mockResolvedValue(true),
    settle: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue({ data: { id: "fixture-provider-id" }, error: null }),
  };
}

describe("takeoff completion email", () => {
  it("submits to the configured collector and records acceptance after freezing the route", async () => {
    const io = fixture();
    await deliverTakeoffCompletionEmail(claim, io, env, sendingAt);
    expect(io.prepare).toHaveBeenCalledWith("redirect", "collector@example.test", expect.any(String));
    expect(io.prepare.mock.invocationCallOrder[0]).toBeLessThan(io.send.mock.invocationCallOrder[0]);
    expect(io.send).toHaveBeenCalledWith(expect.objectContaining({
      to: "collector@example.test",
      subject: "[TEST → requester@example.test] Votre métré est terminé",
      text: expect.stringContaining(`https://estimates.example.test/dashboard/affaires/${claim.project_id}`),
    }), claim.provider_key);
    expect(io.settle).toHaveBeenCalledWith(expect.objectContaining({ delivery_state: "sent", provider_id: "fixture-provider-id" }));
  });

  it("retries a known refusal before acceptance without freezing the first attempt", async () => {
    const io = fixture();
    io.send.mockResolvedValue({ data: null, error: { name: "rate_limit_exceeded", statusCode: 429 } });
    await deliverTakeoffCompletionEmail(claim, io, env, sendingAt);
    expect(io.settle).toHaveBeenCalledWith(expect.objectContaining({
      delivery_state: "pending", first_send_at: null, effective_email: null,
    }));
  });

  it("reuses the same key and destination after an answer is lost", async () => {
    const io = fixture();
    io.send.mockRejectedValueOnce(new Error("connection interrupted after acceptance"));
    await deliverTakeoffCompletionEmail(claim, io, env, sendingAt);
    expect(io.settle).toHaveBeenLastCalledWith(expect.objectContaining({
      delivery_state: "pending", last_delivery_code: "PROVIDER_OUTCOME_UNKNOWN",
    }));
    await deliverTakeoffCompletionEmail({
      ...claim, attempt_count: 2, first_send_at: sendingAt.toISOString(),
    }, io, env, new Date(sendingAt.getTime() + 60_000));
    expect(io.prepare.mock.calls[0]).toEqual(io.prepare.mock.calls[1]);
    expect(io.send.mock.calls[0]).toEqual(io.send.mock.calls[1]);
    expect(io.settle).toHaveBeenLastCalledWith(expect.objectContaining({ delivery_state: "sent" }));
  });

  it("stops at preflight when routing changes or access is revoked", async () => {
    const io = fixture();
    io.prepare.mockResolvedValue(false);
    await deliverTakeoffCompletionEmail({
      ...claim, attempt_count: 2, first_send_at: sendingAt.toISOString(),
    }, io, { ...env, EMAIL_DELIVERY_MODE: "live" }, new Date(sendingAt.getTime() + 60_000));
    expect(io.prepare).toHaveBeenCalledWith("live", claim.recipient_email, expect.any(String));
    expect(io.send).not.toHaveBeenCalled();
  });

  it("records an unavailable mailbox without falling back to the collector", async () => {
    const io = fixture();
    await deliverTakeoffCompletionEmail({ ...claim, recipient_email: null }, io, env, sendingAt);
    expect(io.settle).toHaveBeenCalledWith({
      delivery_state: "unavailable", last_delivery_code: "RECIPIENT_UNAVAILABLE",
    });
    expect(io.send).not.toHaveBeenCalled();
  });

  it("preserves an unknown outcome after the provider's idempotency window", async () => {
    const io = fixture();
    await deliverTakeoffCompletionEmail({
      ...claim, attempt_count: 2, first_send_at: sendingAt.toISOString(),
    }, io, env, new Date(sendingAt.getTime() + 24 * 3_600_000));
    expect(io.settle).toHaveBeenCalledWith({
      delivery_state: "unknown", last_delivery_code: "IDEMPOTENCY_WINDOW_EXPIRED",
    });
    expect(io.send).not.toHaveBeenCalled();
  });
});
