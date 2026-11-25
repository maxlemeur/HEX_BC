import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";

import { resolveChatGptIntakeOwner } from "@/lib/ai/chatgpt-workflow-owner";
import type { ServerSupabaseClient } from "@/lib/auth/tenant-context";

const claim = { tenantId: "tenant", projectId: "project", uploadId: "upload", leaseToken: "lease", attemptCount: 2 };

it.each([
  ["legacy upload", undefined, true, "depositor"],
  ["reserved launch", "launcher", true, "launcher"],
  ["deleted payer", null, true, null],
  ["withdrawn membership", "launcher", false, null],
] as const)("resolves the %s on recovery", async (_label, payerId, member, expected) => {
  const visited: string[] = [];
  const client = createClient("http://127.0.0.1:54321", "fixture", {
    global: { fetch: async (input) => {
      const url = new URL(String(input));
      const table = url.pathname.split("/").at(-1)!;
      visited.push(table);
      const row = table === "affaire_intake_uploads" ? { created_by: "depositor" } :
        member && url.searchParams.get("user_id") === `eq.${expected}` &&
          url.searchParams.get("tenant_id") === "eq.tenant" && url.searchParams.get("tenants.is_active") === "eq.true"
          ? { user_id: expected } : null;
      return new Response(JSON.stringify(row ? [row] : []), { headers: { "content-type": "application/json" } });
    } },
  });
  const launch = payerId === undefined ? undefined : { payerId, readScans: true };
  expect(await resolveChatGptIntakeOwner(client as ServerSupabaseClient, { ...claim, launch }))
    .toEqual(expected === null ? null : { userId: expected, tenantId: claim.tenantId });
  if (launch) expect(visited).not.toContain("affaire_intake_uploads");
});
