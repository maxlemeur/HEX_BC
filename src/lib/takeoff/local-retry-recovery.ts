import "server-only";

import { randomUUID } from "node:crypto";

import { isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { getChatGptHostId } from "@/lib/ai/chatgpt-local-store";
import { createOptionalServiceRoleClient } from "@/lib/supabase/service-role";
import { TAKEOFF_RETRY_MAX } from "@/lib/takeoff/constants";

const POLL_INTERVAL_MS = 15_000;
const BATCH_SIZE = 5;

type ServiceRoleClient = NonNullable<ReturnType<typeof createOptionalServiceRoleClient>>;

/** A timestamp in microseconds, the precision of both rows' default `now()`; NaN when unreadable. */
function timestampMicros(value: string | null) {
  const parts = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(value ?? "");
  if (!parts) return Number.NaN;
  const zone = parts[3];
  const offset = zone === "Z" || zone.includes(":") ? zone : `${zone.slice(0, 3)}:${zone.slice(3) || "00"}`;
  return Date.parse(`${parts[1].replace(" ", "T")}${offset}`) * 1_000 + Number((parts[2] ?? "").padEnd(6, "0"));
}

/**
 * The pending jobs whose admission has finished: this creation's record is written. It commits after the row in the
 * application's creation, or with it once the admission is one transaction: either way it is dated by `now()` at or
 * after the row's own `created_at`. A creation whose record fails withdraws its pending row; a retry of the same
 * preparation inserts the same identifier again, later than the record an earlier attempt may have left, so that
 * record does not admit it. A relaunched job keeps its row and the record of its creation.
 */
async function readAdmittedJobIds(client: ServiceRoleClient,
  pending: Array<{ id: string; tenant_id: string; created_at: string }>) {
  if (pending.length === 0) return new Set<string>();
  const { data, error } = await client.from("audit_logs")
    .select("tenant_id, record_id, created_at")
    .eq("table_name", "takeoff_jobs")
    .eq("action", "takeoff.job.created")
    .in("tenant_id", [...new Set(pending.map((job) => job.tenant_id))])
    .in("record_id", pending.map((job) => job.id));
  if (error) throw error;
  return new Set(data.filter((receipt) => pending.some((job) => job.id === receipt.record_id
    && job.tenant_id === receipt.tenant_id
    && timestampMicros(receipt.created_at) >= timestampMicros(job.created_at))).map((receipt) => receipt.record_id));
}

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
        .select("id, tenant_id, status, created_at, tenants!inner(is_active)")
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
      const admitted = await readAdmittedJobIds(client, data.filter((job) => job.status === "pending"));
      const { processTakeoffJobAttempt } = await import("@/lib/takeoff/async-worker");
      for (const job of data) {
        // A pending row whose creation has not finished may still be withdrawn: the member is told it did not start.
        if (job.status === "pending" && !admitted.has(job.id)) continue;
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
