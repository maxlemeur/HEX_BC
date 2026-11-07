import "server-only";

import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { getAuthenticatedTakeoffContext, getTakeoffJobDetailByIdOrThrow } from "@/lib/takeoff/job-read-server";
import { assertTakeoffOperatorActionRole, parseWithSchema } from "@/lib/takeoff/server-helpers";
import { takeoffJobIdSchema } from "@/lib/takeoff/schemas";
import { recomputeTakeoffRulesQuietly } from "@/lib/takeoff/rules/recompute-server";

/** A recovery action uses the existing tenant/job boundary before the privileged version computation. */
export async function recoverTakeoffRules(jobId: string) {
  const { supabase, tenantId, tenantRole } = await getAuthenticatedTakeoffContext();
  assertTakeoffOperatorActionRole(tenantRole);
  const id = parseWithSchema(takeoffJobIdSchema, jobId, "Identifiant job invalide.");
  const job = await getTakeoffJobDetailByIdOrThrow({ supabase, tenantId, jobId: id });
  if (job.status !== "completed") {
    throw new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT,
      message: "Le métré doit être terminé pour recalculer ses règles.", retryable: false });
  }
  const result = await recomputeTakeoffRulesQuietly({ tenantId, estimateVersionId: job.estimate_version_id, context: "manual" });
  // Read persisted pending state, not just the number of attempted writes (an unbounded/skipped line stays blocked).
  const { count, error } = await supabase.from("takeoff_items" as never).select("id" as never, { count: "exact", head: true })
    .eq("tenant_id" as never, tenantId as never).eq("job_id" as never, id as never).eq("rules_stale" as never, true as never);
  return { pending: result === null || error !== null || count === null || count > 0 };
}
