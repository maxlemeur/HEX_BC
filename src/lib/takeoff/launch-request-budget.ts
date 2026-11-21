import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";

/**
 * The budget of a launch request (migration 20261121111238_takeoff_launch_requests.sql), sealed at its admission (lot
 * 2: the tenant's per-job budget of the detailed reading), and what every attempt of its jobs consumed, counted from
 * their run metrics, failed attempts included.
 */
export type TakeoffRequestBudget = { tokenBudget: number; costBudgetCents: number; tokensObserved: number; costCentsObserved: number };

/**
 * The bounds of one paid attempt of the detailed reading: its per-job budget, within what its request has left. A
 * request whose budget is spent stops the attempt before any call; the job ends on it and its request closes with
 * that reason.
 */
export function boundTakeoffAttemptByRequest<T extends { maxTotalTokens: number; maxCostCents: number }>(
  config: T, budget: TakeoffRequestBudget | null, jobId: string,
): T {
  if (!budget) return config;
  const tokensLeft = budget.tokenBudget - budget.tokensObserved;
  const costLeft = budget.costBudgetCents - budget.costCentsObserved;
  if (tokensLeft <= 0 || costLeft <= 0) {
    throw new TakeoffError({
      status: 422, code: TakeoffErrorCode.TAKEOFF_REQUEST_BUDGET_EXHAUSTED, retryable: false, jobId,
      message: "Le budget de cette analyse est épuisé par ses tentatives précédentes. Relancez l’analyse depuis les options du métré.",
      details: { token_budget: budget.tokenBudget, tokens_observed: budget.tokensObserved,
        cost_budget_cents: budget.costBudgetCents, cost_cents_observed: budget.costCentsObserved },
    });
  }
  return { ...config, maxTotalTokens: Math.min(config.maxTotalTokens, tokensLeft), maxCostCents: Math.min(config.maxCostCents, costLeft) };
}

/** The budget of the request a job belongs to, read by the worker before a paid attempt; none for a job without one. */
export async function readTakeoffRequestBudget(jobId: string): Promise<TakeoffRequestBudget | null> {
  const service = createServiceRoleClient();
  const { data: job, error } = await service.from("takeoff_jobs").select("launch_request_id").eq("id", jobId).maybeSingle();
  if (error) throw new TakeoffError({ code: TakeoffErrorCode.INTERNAL_ERROR, retryable: true, jobId,
    message: "Impossible de lire le budget de cette analyse." });
  if (!job?.launch_request_id) return null;
  const { data: request, error: requestError } = await service.from("takeoff_launch_requests")
    .select("token_budget, cost_budget_cents, tokens_observed, cost_cents_observed").eq("id", job.launch_request_id).maybeSingle();
  if (requestError || !request || request.token_budget === null || request.cost_budget_cents === null) {
    throw new TakeoffError({ code: TakeoffErrorCode.INTERNAL_ERROR, retryable: true, jobId,
      message: "Impossible de lire le budget de cette analyse." });
  }
  return { tokenBudget: Number(request.token_budget), costBudgetCents: Number(request.cost_budget_cents),
    tokensObserved: Number(request.tokens_observed), costCentsObserved: Number(request.cost_cents_observed) };
}
