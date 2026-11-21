import "server-only";

import type { resolveLocalTakeoffProvider } from "@/lib/ai/chatgpt-takeoff";
import type { ServerSupabaseClient } from "@/lib/auth/tenant-context";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { takeoffModuleDefault } from "@/lib/takeoff/feature-flags";
import type { TakeoffJobProcessingRow } from "@/lib/takeoff/job-lifecycle";

/**
 * Before each paid call of any job, in one database answer: the takeoff module is on for its tenant, its creator may
 * still launch on its affaire (the one payer rule, private.takeoff_launch_payer_eligible) and a launch request's job has
 * budget left. A service-role read never authorizes spending the creator's local plan by itself. The automatic start's
 * cut-off is not checked: removing it stops new admissions, an admitted analysis finishes.
 */
async function assertTakeoffJobMayPay(job: TakeoffJobProcessingRow) {
  const { data, error } = await createServiceRoleClient().rpc("takeoff_job_may_pay", {
    p_job_id: job.id, p_module_default: takeoffModuleDefault() });
  const reason = error ? "UNKNOWN" : (data?.[0]?.reason ?? (data?.length ? null : "UNKNOWN"));
  if (!reason) return;
  if (reason === "BUDGET_EXHAUSTED") {
    throw new TakeoffError({ status: 422, code: TakeoffErrorCode.TAKEOFF_REQUEST_BUDGET_EXHAUSTED, retryable: false, jobId: job.id,
      message: "Le budget de cette analyse est épuisé par ses tentatives précédentes. Relancez l’analyse depuis les options du métré." });
  }
  throw new TakeoffError({ status: 403, code: TakeoffErrorCode.FORBIDDEN, retryable: false, jobId: job.id,
    message: reason === "TAKEOFF_DISABLED" ? "Le module Takeoff est désactivé pour ce tenant."
      : "Le créateur n’est plus autorisé à lancer un métré sur cette affaire." });
}

/**
 * The provider of a job's attempt: checked once before it is resolved, then by every paid call (a chunk, a vector group)
 * once its credential is in hand, immediately before the request is sent, so a module turned off or a right withdrawn
 * while the credential's lock or refresh waited stops it.
 */
export async function resolveTakeoffExecutionProvider(
  supabase: ServerSupabaseClient,
  job: TakeoffJobProcessingRow,
  resolveProvider: typeof resolveLocalTakeoffProvider,
  lease?: () => string | null,
): ReturnType<typeof resolveLocalTakeoffProvider> {
  const beforePaidCall = () => assertTakeoffJobMayPay(job);
  await beforePaidCall();
  return resolveProvider(supabase, job, { lease, beforePaidCall });
}
