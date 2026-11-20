import "server-only";

import { randomUUID } from "node:crypto";

import { isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { getChatGptHostId } from "@/lib/ai/chatgpt-local-store";
import { createOptionalServiceRoleClient } from "@/lib/supabase/service-role";
import { TAKEOFF_RETRY_MAX } from "@/lib/takeoff/constants";

const POLL_INTERVAL_MS = 15_000;
const BATCH_SIZE = 5;

export function startLocalTakeoffRetryRecovery() {
  if (!isLocalChatGptEnabled() || process.env.E2E_ARMY_BLOCK_WORKERS === "1") return;
  const client = createOptionalServiceRoleClient();
  if (!client) return;

  let running = false;
  let afterId: string | undefined;
  const recover = async () => {
    if (running) return;
    running = true;
    try {
      const due = new Date().toISOString();
      let query = client.from("takeoff_jobs")
        .select("id, status, tenants!inner(is_active)")
        .eq("tenants.is_active", true)
        .eq("execution_provider", "chatgpt_local")
        .eq("execution_host_id", await getChatGptHostId())
        .is("analysis_outcome", null)
        .or(`status.eq.pending,and(status.eq.failed,retry_count.lt.${TAKEOFF_RETRY_MAX},next_retry_at.lte.${due})`)
        .order("id")
        .limit(BATCH_SIZE);
      if (afterId) query = query.gt("id", afterId);
      const { data, error } = await query;
      if (error) throw error;
      // Advance even when an entire page cannot get a processing lease.
      afterId = data.length === BATCH_SIZE ? data.at(-1)?.id : undefined;
      if (data.length === 0) return;
      const { processTakeoffJobAttempt } = await import("@/lib/takeoff/async-worker");
      for (const job of data) {
        try {
          await processTakeoffJobAttempt(job.id, {
            trigger: job.status === "pending" ? "create" : "retry", correlationId: randomUUID(),
          });
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
