import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc }) }));

import { claimEstimateEmailDispatch } from "@/lib/email/estimate-email-outbox";

import { dispatch, dispatchId, tenantId, actorUserId, leaseToken } from "@/lib/email/estimate-email.test-utils";

const input = { dispatchId, tenantId, actorUserId, leaseToken };

describe("email dispatch repository confirmation", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    { status: "unexpected" },
    { attempt_count: -1 },
    { recipient: null },
    { tenant_id: "77777777-7777-4777-8777-777777777777" },
    { id: "77777777-7777-4777-8777-777777777777" },
    { lease_token: "77777777-7777-4777-8777-777777777777" },
  ])("rejects a malformed or foreign claim before it reaches delivery: %j", async (patch) => {
    rpc.mockResolvedValue({ data: { ...dispatch(), ...patch }, error: null });
    await expect(claimEstimateEmailDispatch(input)).rejects.toMatchObject({
      code: "ESTIMATE_EMAIL_DISPATCH_INVALID_RESPONSE",
    });
  });

  it("accepts a completed concurrent claim without a live lease or provider identifier", async () => {
    const terminal = { ...dispatch(), status: "sent", lease_token: null, lease_expires_at: null, provider_id: null };
    rpc.mockResolvedValue({ data: terminal, error: null });
    await expect(claimEstimateEmailDispatch(input)).resolves.toEqual(terminal);
  });
});
