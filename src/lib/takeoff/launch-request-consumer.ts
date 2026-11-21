import "server-only";

import { isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { createOptionalServiceRoleClient } from "@/lib/supabase/service-role";

const POLL_INTERVAL_MS = 15_000;
const IDLE_INTERVAL_MS = 120_000;

/**
 * The automatic start on the authorised Mac: the requests whose mandate this Mac prepared and that wait for an evaluation
 * (a dossier changed, a passing cause) are evaluated and, when ready, admitted and run here. It needs no member's
 * session: the request carries its payer and the selection of the mandate, checked again on this Mac. The database is
 * its gate: before both cut-offs, with the module off or for another Mac, a claim hands it nothing. Every 15 seconds while
 * claims return work, every 2 minutes while they come back empty (a gesture wakes it at once, wakeTakeoffLaunchConsumer).
 */
export function startLocalTakeoffLaunchConsumer() {
  if (!isLocalChatGptEnabled() || !createOptionalServiceRoleClient()) return;
  const pass = async () => {
    let claimed = 0;
    try {
      const { evaluateTakeoffLaunchRequests } = await import("@/lib/takeoff/launch-request-server");
      claimed = (await evaluateTakeoffLaunchRequests()).length;
    } catch {
      console.error("takeoff.launch_request.pass_deferred");
    }
    setTimeout(() => void pass(), claimed > 0 ? POLL_INTERVAL_MS : IDLE_INTERVAL_MS).unref();
  };
  setTimeout(() => void pass(), POLL_INTERVAL_MS).unref();
}
