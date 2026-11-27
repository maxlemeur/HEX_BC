import "server-only";

import { startRecoveryPoll } from "@/lib/workflows/recovery-poll";
import { isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { readIntakeAiBatch } from "@/lib/affaires/intake-ai-server";
import { hostCanReadIntakeScans, stopIntakeAnalysisLaunch } from "@/lib/affaires/intake-payer-server";
import { createOptionalServiceRoleClient } from "@/lib/supabase/service-role";

// A Mac may share the database with other Macs. Advance through bounded pages even
// when every due launch on the current page belongs to a different member's machine.
const cursors: Record<"paid" | "other", string | null> = { paid: null, other: null };
const PAGE_SIZE = 20;

async function recoverDueLaunch(paid: boolean) {
  const service = createOptionalServiceRoleClient();
  if (!service) return null;
  const now = new Date().toISOString();
  const lane = paid ? "paid" : "other";
  let query = service.from("affaire_intake_uploads")
    .select("id,project_id,tenant_id,created_by")
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
    const owner = paid && batch.created_by ? { userId: batch.created_by, tenantId: batch.tenant_id } : null;
    const right = batch.created_by ? await service.rpc("intake_payer_can_write", {
      p_user_id: batch.created_by, p_project_id: batch.project_id, p_tenant_id: batch.tenant_id,
    }) : { data: false, error: null };
    if (right.error) throw new Error("Impossible de vérifier le droit du payeur.", { cause: right.error });
    const scope = batch.created_by ? { payerId: batch.created_by, tenantId: batch.tenant_id, projectId: batch.project_id } : undefined;
    const recorded = scope ? await readIntakeAiBatch(service, batch.id, scope) : null;
    // The recorded path checks its connection and catalogue before claiming.
    const available = recorded || !paid || (owner && await hostCanReadIntakeScans(owner));
    if (!right.data || !available) {
      // SQL keeps a live lease and gives another Mac 30 minutes from the last due time.
      if (recorded || !scope) {
        const stopped = await stopIntakeAnalysisLaunch(service, batch.id, null, true);
        if (stopped || recorded) continue;
      }
      await stopIntakeAnalysisLaunch(service, batch.id, null, false);
      continue;
    }
    // SQL rechecks due time and attempts under the lease. An empty claim may have retired
    // an exhausted launch; continue to the next candidate.
    const { processAffaireIntakeAnalysisLaunch } = await import("@/lib/affaires/intake-analysis-server");
    if (await processAffaireIntakeAnalysisLaunch(batch.id, owner, scope)) return batch.id;
  }
  if (data.length < PAGE_SIZE) cursors[lane] = null;
  return null;
}

export async function recoverIntakeAnalysisLaunch() {
  const launchId = await recoverDueLaunch(true);
  if (launchId) return launchId;
  return recoverDueLaunch(false);
}

export function startLocalIntakeRecovery() {
  if (!isLocalChatGptEnabled() || process.env.E2E_ARMY_BLOCK_WORKERS === "1") return;
  startRecoveryPoll({
    intervalMs: 60_000,
    run: async () => { await recoverDueLaunch(true); },
    onError: () => console.error("intake.local_recovery.deferred"),
  });
}
