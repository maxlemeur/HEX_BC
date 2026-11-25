import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("leaves takeoff evaluations for the intake server while forwarding profile reads", () => {
  const competingPoll = `
    import assert from "node:assert/strict";

    const backend = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const claimUrl = backend + "/rest/v1/rpc/claim_takeoff_launch_evaluations";
    const profileUrl = backend + "/rest/v1/profiles";
    const request = { request_id: "intake-request" };
    const pending = [request];
    const backendFetch = async (input) => {
      const url = input instanceof Request ? input.url : input;
      if (url === claimUrl) return Response.json(pending.splice(0));
      assert.equal(url, profileUrl);
      return Response.json([{ id: "profile-owner" }]);
    };

    globalThis.fetch = backendFetch;
    await import("./e2e/army/local/profile-provider-fixture.mjs");
    const claim = new Request(claimUrl, { method: "POST" });
    const profileClaim = await (await fetch(claim)).json();
    const intakeClaim = await (await backendFetch(claim)).json();
    const profileRead = await (await fetch(profileUrl)).json();

    assert.deepEqual({ profileClaim, intakeClaim, profileRead }, {
      profileClaim: [], intakeClaim: [request], profileRead: [{ id: "profile-owner" }],
    });
  `;
  expect(() => execFileSync(process.execPath, ["--input-type=module", "-e", competingPoll], {
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:65430" },
    stdio: "pipe",
  })).not.toThrow();
});
