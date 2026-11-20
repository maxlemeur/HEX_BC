import "server-only";

import { randomUUID } from "node:crypto";

import { isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { getChatGptHostId } from "@/lib/ai/chatgpt-local-store";
import { createOptionalServiceRoleClient } from "@/lib/supabase/service-role";
import { TAKEOFF_RETRY_MAX } from "@/lib/takeoff/constants";

const POLL_INTERVAL_MS = 15_000;

export function startLocalTakeoffRetryRecovery() {
  if (!isLocalChatGptEnabled() || process.env.E2E_ARMY_BLOCK_WORKERS === "1") return;
  const client = createOptionalServiceRoleClient();
  if (!client) return;

  let running = false;
  const recover = async () => {
    if (running) return;
    running = true;
    try {
      const { data, error } = await client.from("takeoff_jobs")
        .select("id, tenants!inner(is_active)")
        .eq("tenants.is_active", true)
        .eq("execution_provider", "chatgpt_local")
        .eq("execution_host_id", await getChatGptHostId())
        .eq("status", "failed")
        .is("analysis_outcome", null)
        .lt("retry_count", TAKEOFF_RETRY_MAX)
        .lte("next_retry_at", new Date().toISOString())
        .order("next_retry_at")
        .limit(5);
      if (error) throw error;
      for (const job of data) {
        try {
          const { processTakeoffJobAttempt } = await import("@/lib/takeoff/async-worker");
          await processTakeoffJobAttempt(job.id, { trigger: "retry", correlationId: randomUUID() });
        } catch {
          console.error("takeoff.local_retry_recovery.attempt_failed", { jobId: job.id });
        }
      }
    } catch {
      console.error("takeoff.local_retry_recovery.deferred");
    } finally {
      running = false;
    }
  };
  setInterval(() => void recover(), POLL_INTERVAL_MS).unref();
}
