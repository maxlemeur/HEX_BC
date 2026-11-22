import "server-only";

import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { mapSupabaseError } from "@/lib/http/api-response";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import {
  isTakeoffUnitState, summarizeTakeoffCoverage, type TakeoffLaunchRequestUnits, type TakeoffRequestUnitView,
} from "@/lib/takeoff/launch-request-coverage";
import { assertPreparationProjectAccess } from "@/lib/takeoff/preparation-repository";

type Row = {
  key: string | null; ordinal: number; plan_file_id: string | null; logical_id: string | null; name: string | null; pages: unknown;
  job_id: string; state: string; reason_code: string | null; retry_at: string | null; updated_at: string;
};
type Answer = { request_id: string; format: "grouped" | "per_plan"; plans: number; units: Row[];
  usage: { tokens_observed: number; cost_cents_observed: number; unknown_calls: number } };

/**
 * The units of one launch request of an affaire, for its activity (lot 3 PR 4 reads this contract): after the reader's
 * access to the affaire is checked, one database answer gives each unit in its recorded order with its state, decided
 * once by the database (private.takeoff_unit_state), its public reason, its plan as the dossier names it and its job;
 * and what the request consumed, the calls whose consumption is unknown included. Never the Mac, the account, the lease
 * or a provider's text. A request of another affaire, or of another tenant, is not found.
 */
export async function readTakeoffLaunchRequestUnits(context: AuthenticatedTenantContext, projectId: string, requestId: string): Promise<TakeoffLaunchRequestUnits> {
  await assertPreparationProjectAccess(context, projectId);
  const { data, error } = await createServiceRoleClient().rpc("read_takeoff_launch_request_units", {
    p_tenant_id: context.tenantId, p_project_id: projectId, p_request_id: requestId });
  if (error) throw mapSupabaseError({ ...error, code: error.code ?? "UNKNOWN" }, "Impossible de lire les plans de ce métré.");
  const answer = data as unknown as Answer | null;
  if (!answer) {
    throw new TakeoffError({ status: 404, code: TakeoffErrorCode.NOT_FOUND, retryable: false, message: "Ce métré est introuvable sur cette affaire." });
  }
  return toTakeoffLaunchRequestUnits(answer);
}

/** The database's answer as the contract words it: a grouped analysis is one unit named after its plans. */
export function toTakeoffLaunchRequestUnits(answer: Answer): TakeoffLaunchRequestUnits {
  const units: TakeoffRequestUnitView[] = answer.units.flatMap((row) => {
    if (!isTakeoffUnitState(row.state)) return [];
    const pages = Array.isArray(row.pages) ? row.pages.filter((page): page is number => Number.isInteger(page)) : [];
    return [{
      key: row.key ?? "grouped", ordinal: row.ordinal, planFileId: row.plan_file_id, logicalId: row.logical_id,
      name: row.name ?? (answer.plans > 1 ? `Analyse groupée de ${answer.plans} plans` : "Analyse groupée"),
      pages, jobId: row.job_id, state: row.state, reasonCode: row.reason_code, retryAt: row.retry_at, updatedAt: row.updated_at,
      reviewable: row.state === "succeeded",
    }];
  });
  return {
    requestId: answer.request_id, format: answer.format, units, coverage: summarizeTakeoffCoverage(units),
    usage: { tokensObserved: Number(answer.usage.tokens_observed), costCentsObserved: Number(answer.usage.cost_cents_observed),
      unknownCalls: Number(answer.usage.unknown_calls) },
  };
}
