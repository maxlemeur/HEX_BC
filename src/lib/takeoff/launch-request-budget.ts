import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { takeoffModuleDefault } from "@/lib/takeoff/feature-flags";

/**
 * The budget of a launch request (migration 20261121111238_takeoff_launch_requests.sql), sealed at its admission (lot
 * 2: the tenant's per-job budget of the detailed reading), and what every attempt of its jobs consumed, counted from
 * their run metrics, failed attempts included.
 */
export type TakeoffRequestBudget = { remainingTokens: number; remainingCostCents: number };

/**
 * The bounds of one paid attempt of the detailed reading: its per-job budget, within what its request has left. A
 * request whose budget is spent stops the attempt before any call; the job ends on it and its request closes with
 * that reason.
 */
export function boundTakeoffAttemptByRequest<T extends { maxTotalTokens: number; maxCostCents: number }>(
  config: T, budget: TakeoffRequestBudget | null, jobId: string,
): T {
  if (!budget) return config;
  const tokensLeft = budget.remainingTokens;
  const costLeft = budget.remainingCostCents;
  if (tokensLeft <= 0 || costLeft < 0) {
    throw new TakeoffError({
      status: 422, code: TakeoffErrorCode.TAKEOFF_REQUEST_BUDGET_EXHAUSTED, retryable: false, jobId,
      message: "Le budget de cette analyse est épuisé par ses tentatives précédentes. Relancez l’analyse depuis les options du métré.",
      details: { remaining_tokens: tokensLeft, remaining_cost_cents: costLeft },
    });
  }
  return { ...config, maxTotalTokens: Math.min(config.maxTotalTokens, tokensLeft), maxCostCents: Math.min(config.maxCostCents, costLeft) };
}

/**
 * What the request of a job has left, read by the worker before a paid attempt in the same answer as the checks of each
 * paid call (public.takeoff_job_may_pay); none for a job without a request, which is not read for it.
 */
export async function readTakeoffRequestBudget(job: { id: string; launch_request_id?: string | null }): Promise<TakeoffRequestBudget | null> {
  if (!job.launch_request_id) return null;
  const { data, error } = await createServiceRoleClient().rpc("takeoff_job_may_pay", {
    p_job_id: job.id, p_module_default: takeoffModuleDefault() });
  const row = data?.[0];
  if (error || !row || row.remaining_tokens === null || row.remaining_cost_cents === null) {
    throw new TakeoffError({ code: TakeoffErrorCode.INTERNAL_ERROR, retryable: true, jobId: job.id,
      message: "Impossible de lire le budget de cette analyse." });
  }
  return { remainingTokens: Number(row.remaining_tokens), remainingCostCents: Number(row.remaining_cost_cents) };
}
