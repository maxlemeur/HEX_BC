import { usesTakeoffApiKey } from "@/lib/takeoff/payment-mandate-server";
import "server-only";

import type { resolveLocalTakeoffProvider } from "@/lib/ai/chatgpt-takeoff";
import type { ServerSupabaseClient } from "@/lib/auth/tenant-context";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { takeoffModuleDefault } from "@/lib/takeoff/feature-flags";
import type { TakeoffJobProcessingRow } from "@/lib/takeoff/job-lifecycle";
import { resolveTakeoffApiProvider } from "@/lib/takeoff/payment-worker";
import { createTakeoffCallLedger, takeoffPaymentRefusal } from "@/lib/takeoff/launch-call-ledger";

/**
 * Before an attempt of any job, in one database answer: the takeoff module is on for its tenant, its creator may still
 * launch on its affaire (the one payer rule, private.takeoff_launch_payer_eligible) and a launch request's job has budget
 * left (its unit's, for one analysis per plan). Each paid call is then reserved under the same rule. A service-role read
 * never authorizes spending the creator's local plan by itself. The automatic start's cut-off is not checked: removing it
 * stops new admissions, an admitted analysis finishes.
 */
async function assertTakeoffJobMayPay(job: TakeoffJobProcessingRow) {
  const { data, error } = await createServiceRoleClient().rpc("takeoff_job_may_pay", {
    p_job_id: job.id, p_module_default: takeoffModuleDefault() });
  const reason = error ? "UNKNOWN" : (data?.[0]?.reason ?? (data?.length ? null : "UNKNOWN"));
  if (reason) throw takeoffPaymentRefusal(job.id, reason);
}

/**
 * The provider of a job's attempt: checked once before it is resolved, then by every paid call (a chunk, a vector group)
 * once its credential is in hand, immediately before the request is sent, so a module turned off, a right withdrawn or a
 * spent budget while the credential's lock or refresh waited stops it: the ledger of its paid calls
 * (launch-call-ledger.ts) reserves each call of a launch request's job there, and settles it after its answer.
 */
export async function resolveTakeoffExecutionProvider(
  supabase: ServerSupabaseClient,
  job: TakeoffJobProcessingRow,
  resolveProvider: typeof resolveLocalTakeoffProvider,
  lease?: () => string | null,
): ReturnType<typeof resolveLocalTakeoffProvider> {
  if (usesTakeoffApiKey(job.preparation_snapshot)) {
    return resolveTakeoffApiProvider(job, lease ?? (() => job.processing_lease_token ?? null));
  }
  await assertTakeoffJobMayPay(job);
  const ledger = createTakeoffCallLedger(job, lease ?? (() => job.processing_lease_token ?? null));
  return resolveProvider(supabase, job, { lease, ledger });
}
