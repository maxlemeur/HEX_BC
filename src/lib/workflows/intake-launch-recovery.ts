import "server-only";

import { isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { hasLocalChatGptStore } from "@/lib/ai/chatgpt-local-store";
import { createOptionalServiceRoleClient } from "@/lib/supabase/service-role";

// A Mac may share the database with other Macs. Advance through bounded pages even
// when every due launch on the current page belongs to a different member's machine.
const cursors: Record<"paid" | "other", string | null> = { paid: null, other: null };
const PAGE_SIZE = 20;

async function recoverDueLaunch(paid: boolean) {
  const service = createOptionalServiceRoleClient();
  if (!service || (paid && !isLocalChatGptEnabled())) return null;
  const now = new Date().toISOString();
  const lane = paid ? "paid" : "other";
  let query = service.from("affaire_intake_uploads")
    .select("id,tenant_id,created_by,tenants!inner(is_active)").eq("tenants.is_active", true)
    .in("status", ["launch_queued", "launch_processing"])
    .or(`and(status.eq.launch_queued,or(next_retry_at.is.null,next_retry_at.lte.${now})),and(status.eq.launch_processing,processing_lease_expires_at.lte.${now})`)
    .order("id").limit(PAGE_SIZE);
  query = paid ? query.eq("launch_read_scans", true).not("created_by", "is", null)
    : query.or("launch_read_scans.eq.false,created_by.is.null");
  const cursor = cursors[lane];
  if (cursor) query = query.gt("id", cursor);
  const { data, error } = await query;
  if (error) throw new Error("Impossible de lire les lancements à reprendre.", { cause: error });
  for (const batch of data) {
    cursors[lane] = batch.id;
    if (paid && batch.created_by && !await hasLocalChatGptStore({ userId: batch.created_by, tenantId: batch.tenant_id })) continue;
    // SQL rechecks due time and attempts under the lease. An empty claim may have retired
    // an exhausted launch; continue to the next candidate.
    const { processAffaireIntakeAnalysisLaunch } = await import("@/lib/affaires/intake-analysis-server");
    if (await processAffaireIntakeAnalysisLaunch(batch.id)) return batch.id;
  }
  if (data.length < PAGE_SIZE) cursors[lane] = null;
  return null;
}

export async function recoverIntakeAnalysisLaunch() {
  if (isLocalChatGptEnabled()) {
    const launchId = await recoverDueLaunch(true);
    if (launchId) return launchId;
  }
  return recoverDueLaunch(false);
}

export function startLocalIntakeRecovery() {
  if (!isLocalChatGptEnabled() || process.env.E2E_ARMY_BLOCK_WORKERS === "1") return;
  let running = false;
  const recover = async () => {
    if (running) return;
    running = true;
    try { await recoverDueLaunch(true); }
    catch { console.error("intake.local_recovery.deferred"); }
    finally { running = false; }
  };
  setInterval(() => void recover(), 60_000).unref();
}
