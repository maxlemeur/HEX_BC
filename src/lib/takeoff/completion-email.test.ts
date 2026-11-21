import { describe, expect, it, vi } from "vitest";

import { deliverTakeoffCompletionEmail, type CompletionEmailClaim } from "@/lib/takeoff/completion-email";

const sendingAt = new Date("2026-11-20T08:00:00Z");
const claim: CompletionEmailClaim = {
  id: "8f400000-0000-4000-8000-000000000021",
  project_id: "8f400000-0000-4000-8000-000000000010",
  job_id: "8f400000-0000-4000-8000-000000000031",
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
    confirmDispatch: vi.fn().mockResolvedValue(100_000),
    settle: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue({ data: { id: "fixture-provider-id" }, error: null }),
  };
}

// One delivery row, as claim_takeoff_completion_email, prepare_takeoff_completion_email and
// confirm_takeoff_completion_email_dispatch keep it (supabase/tests/database/takeoff-completion-before-activation.test.sql).
function deliveryRow(clock: { now: number }) {
  const row = { leaseToken: null as string | null, leaseExpiresAt: 0, firstSendAt: null as number | null, state: "pending" };
  const providerKeys: string[] = [];
  return {
    row, providerKeys,
    claim(token: string) {
      row.leaseToken = token;
      row.leaseExpiresAt = clock.now + 120_000;
      row.state = "sending";
    },
    io(token: string, pauseAfterPrepare?: Promise<void>) {
      const owns = () => row.state === "sending" && row.leaseToken === token && row.leaseExpiresAt > clock.now;
      return {
        prepare: vi.fn(async () => {
          if (!owns()) return false;
          row.firstSendAt ??= clock.now;
          // The sender stops here, after its route is frozen and before it sends.
          await pauseAfterPrepare;
          return true;
        }),
        confirmDispatch: vi.fn(async () => {
          if (!owns() || row.firstSendAt === null) return null;
          if (row.firstSendAt <= clock.now - 23 * 3_600_000) return null;
          return Math.min(row.leaseExpiresAt, row.firstSendAt + 23 * 3_600_000) - clock.now;
        }),
        settle: vi.fn(async (result: { delivery_state?: string }) => {
          if (owns()) Object.assign(row, { state: result.delivery_state, leaseToken: null });
        }),
        send: vi.fn(async (_message: unknown, key: string) => {
          providerKeys.push(key);
          return { data: { id: `provider-${providerKeys.length}` }, error: null };
        }),
      };
    },
  };
}

describe("takeoff completion email", () => {
  it("submits to the configured collector and records acceptance after freezing the route", async () => {
    const io = fixture();
    await deliverTakeoffCompletionEmail(claim, io, env, sendingAt);
    expect(io.prepare).toHaveBeenCalledWith("redirect", "collector@example.test", expect.any(String));
    expect(io.prepare.mock.invocationCallOrder[0]).toBeLessThan(io.confirmDispatch.mock.invocationCallOrder[0]);
    expect(io.confirmDispatch.mock.invocationCallOrder[0]).toBeLessThan(io.send.mock.invocationCallOrder[0]);
    expect(io.send).toHaveBeenCalledWith(expect.objectContaining({
      to: "collector@example.test",
      subject: "[TEST → requester@example.test] Votre métré est terminé",
      text: expect.stringContaining(`https://estimates.example.test/dashboard/affaires/${claim.project_id}/takeoff?job=${claim.job_id}`),
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

  it("does not send again when it resumes after a pause longer than the provider keeps its key", async () => {
    const clock = { now: sendingAt.getTime() };
    const delivery = deliveryRow(clock);
    let resume!: () => void;
    const paused = new Promise<void>((resolve) => { resume = resolve; });
    delivery.claim("first-lease");
    const first = deliverTakeoffCompletionEmail(claim, delivery.io("first-lease", paused), env, sendingAt, () => clock.now);
    // The first sender has passed prepare and stopped. Its lease expires; a second sender reclaims and sends.
    await vi.waitFor(() => expect(delivery.row.firstSendAt).toBe(sendingAt.getTime()));
    clock.now += 180_000;
    delivery.claim("second-lease");
    await deliverTakeoffCompletionEmail({ ...claim, attempt_count: 2, first_send_at: sendingAt.toISOString() },
      delivery.io("second-lease"), env, new Date(clock.now), () => clock.now);
    expect(delivery.row.state).toBe("sent");
    // The first sender resumes after the provider has forgotten the key: a send now would be a second e-mail.
    clock.now += 25 * 3_600_000;
    resume();
    await first;
    expect(delivery.providerKeys).toEqual([claim.provider_key]);
    expect(delivery.row.state).toBe("sent");
  });

  it("starts no provider call once its lease is too short to finish it", async () => {
    const clock = { now: sendingAt.getTime() };
    const io = fixture();
    // The database confirms 60 s of lease; the sender then stops 50 s before it reaches the provider.
    io.confirmDispatch.mockImplementation(async () => {
      clock.now += 50_000;
      return 60_000;
    });
    await deliverTakeoffCompletionEmail(claim, io, env, sendingAt, () => clock.now);
    expect(io.send).not.toHaveBeenCalled();

    const ready = fixture();
    ready.confirmDispatch.mockResolvedValue(60_000);
    await deliverTakeoffCompletionEmail(claim, ready, env, sendingAt, () => clock.now);
    expect(ready.send).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when the dispatch check finds the lease or the window gone", async () => {
    const io = fixture();
    io.confirmDispatch.mockResolvedValue(null);
    await deliverTakeoffCompletionEmail(claim, io, env, sendingAt);
    expect(io.send).not.toHaveBeenCalled();
    expect(io.settle).not.toHaveBeenCalled();
  });

  it("links a failure to its own job on the affaire's activity, where its reason is shown", async () => {
    const io = fixture();
    await deliverTakeoffCompletionEmail({ ...claim, outcome: "failure" }, io, env, sendingAt);
    const [message] = io.send.mock.calls[0];
    expect(message.text).toContain(
      `https://estimates.example.test/dashboard/affaires/${claim.project_id}/takeoff?job=${claim.job_id}`,
    );
    expect(message.text).not.toContain("AI_PROVIDER");
  });
});
