import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { revokeTakeoffDpgfApplyAuthorization } from "@/lib/takeoff/apply-repository";
import { hashTakeoffApplyAuthorizationToken } from "@/lib/takeoff/apply-preparation";

const JOB_ID = "33333333-3333-4333-8333-333333333333";
const AUTHORIZATION = "55555555-5555-4555-8555-555555555555";

beforeEach(() => { vi.resetAllMocks(); });

describe("takeoff atomic apply repository", () => {
  it.each(["result", "throw"])("scopes cleanup to job and hash, preserving the original failure if cleanup fails (%s)", async (failureMode) => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const secondEq = vi.fn().mockImplementation(async () => {
      if (failureMode === "throw") throw new Error("Network unavailable");
      return { error: { code: "42501" } };
    });
    const firstEq = vi.fn().mockReturnValue({ eq: secondEq });
    const remove = vi.fn().mockReturnValue({ eq: firstEq });
    const from = vi.fn().mockReturnValue({ delete: remove });
    vi.mocked(createServiceRoleClient).mockReturnValue({ from } as never);
    try {
      await expect(revokeTakeoffDpgfApplyAuthorization({ jobId: JOB_ID, authorizationToken: AUTHORIZATION })).resolves.toBeUndefined();
      expect(from).toHaveBeenCalledWith("takeoff_apply_authorizations");
      expect(firstEq).toHaveBeenCalledExactlyOnceWith("job_id", JOB_ID);
      expect(secondEq).toHaveBeenCalledExactlyOnceWith("authorization_token_hash", hashTakeoffApplyAuthorizationToken(AUTHORIZATION));
      expect(warn).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(warn.mock.calls)).not.toContain(AUTHORIZATION);
    } finally { warn.mockRestore(); }
  });
});
