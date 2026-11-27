import "server-only";

import { startRecoveryPoll } from "@/lib/workflows/recovery-poll";
import { isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { createOptionalServiceRoleClient } from "@/lib/supabase/service-role";

const POLL_INTERVAL_MS = 15_000;
const IDLE_INTERVAL_MS = 60_000;

/**
 * The automatic start on the authorised Mac: the requests whose mandate this Mac prepared and that wait for an evaluation
 * (a dossier changed, a passing cause) are evaluated and, when ready, admitted and run here. It needs no member's
 * session: the request carries its payer and the selection of the mandate, checked again on this Mac. The database is
 * its gate: before both cut-offs, with the module off or for another Mac, a claim hands it nothing. Every 15 seconds while
 * claims return work, every minute while they come back empty (a gesture wakes it at once, wakeTakeoffLaunchConsumer).
 */
export function startLocalTakeoffLaunchConsumer() {
  if (!isLocalChatGptEnabled() || !createOptionalServiceRoleClient()) return;
  startRecoveryPoll({
    intervalMs: IDLE_INTERVAL_MS,
    initialDelayMs: POLL_INTERVAL_MS,
    run: async () => {
      const { evaluateTakeoffLaunchRequests } = await import("@/lib/takeoff/launch-request-server");
      const requests = await evaluateTakeoffLaunchRequests();
      return requests.length ? POLL_INTERVAL_MS : IDLE_INTERVAL_MS;
    },
    onError: () => console.error("takeoff.launch_request.pass_deferred"),
  });
}
