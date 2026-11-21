import "server-only";

import { isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { createOptionalServiceRoleClient } from "@/lib/supabase/service-role";

const POLL_INTERVAL_MS = 15_000;

/**
 * The automatic start on the authorised Mac: every 15 seconds, the requests whose mandate this Mac prepared and that wait
 * for an evaluation (a dossier changed, a passing cause) are evaluated and, when ready, admitted and run here. It needs
 * no member's session: the request carries its payer and the selection of the mandate, checked again on this Mac. Before
 * the owner's activation the database hands it nothing.
 */
export function startLocalTakeoffLaunchConsumer() {
  // A campaign blocks the background workers; one that tests this consumer runs it (E2E_ARMY_LAUNCH_CONSUMER): it acts
  // only on the requests of the automatic start, which exist only while a journey sets both cut-offs.
  const blocked = process.env.E2E_ARMY_BLOCK_WORKERS === "1" && process.env.E2E_ARMY_LAUNCH_CONSUMER !== "1";
  if (!isLocalChatGptEnabled() || blocked || !createOptionalServiceRoleClient()) return;
  let running = false;
  const pass = async () => {
    if (running) return;
    running = true;
    try {
      const { evaluateTakeoffLaunchRequests } = await import("@/lib/takeoff/launch-request-server");
      await evaluateTakeoffLaunchRequests();
    } catch {
      console.error("takeoff.launch_request.pass_deferred");
    } finally {
      running = false;
    }
  };
  setInterval(() => void pass(), POLL_INTERVAL_MS).unref();
}
