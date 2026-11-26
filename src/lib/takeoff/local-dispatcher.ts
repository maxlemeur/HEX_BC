import "server-only";

import { randomUUID } from "node:crypto";

import { takeoffPaymentHostId } from "@/lib/takeoff/payment-mandate-server";
import { getChatGptHostId } from "@/lib/ai/chatgpt-local-store";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { takeoffModuleDefault } from "@/lib/takeoff/feature-flags";
import type { TakeoffJobAttemptOutcome, TakeoffJobAttemptTrigger } from "@/lib/takeoff/types";

/**
 * The dispatcher of this Mac, once the owner activated one analysis per plan (migration
 * 20261121231238_takeoff_plan_dispatcher.sql): the database hands the next job this Mac reads, once its slot is free
 * (the oldest eligible request first, its units in their recorded order; a unit waiting for a later retry never holds
 * the others back), and the job's claim takes the slot in the same transaction. One attempt at a time, then the next:
 * a gesture (a confirmation, a relaunch, « Soumettre à nouveau ») and the Mac's poller both start a pass, never a lane
 * of their own; two processes of this Mac are kept apart by the slot. Withdrawn, the database still hands the plans of
 * one analysis per plan already admitted (one at a time); with none, it answers nothing.
 */
export type TakeoffDispatchAttempt = (jobId: string, trigger: TakeoffJobAttemptTrigger) => Promise<TakeoffJobAttemptOutcome>;

type Service = ReturnType<typeof createServiceRoleClient>;

/** Whether one analysis per plan is active, on the database's clock (and both cut-offs of the automatic start). */
export async function isTakeoffPlanDispatchActive(service: Service = createServiceRoleClient()) {
  const { data, error } = await service.rpc("takeoff_plan_dispatch_is_active");
  if (error) throw error;
  return data === true;
}

/** The attempts of one pass at most: the queue of a Mac is bounded by its admitted requests (20 plans each). */
const MAX_ATTEMPTS_PER_PASS = 50;
/** A retry due later than this is woken by the Mac's poller rather than a timer of this process. */
const MAX_TIMER_MS = 60 * 60 * 1000;

const defaultAttempt: TakeoffDispatchAttempt = async (jobId, trigger) => {
  const { processTakeoffJobAttempt } = await import("@/lib/takeoff/async-worker");
  return processTakeoffJobAttempt(jobId, { trigger, correlationId: randomUUID() });
};

export type TakeoffDispatchPass = { ran: string[]; closed: string[]; nextDueAt: string | null };

async function dispatchOnce(service: Service, hostId: string, attempt: TakeoffDispatchAttempt, explicitPayment: boolean): Promise<TakeoffDispatchPass> {
  const ran: string[] = [];
  const closed: string[] = [];
  let nextDueAt: string | null = null;
  let previous: string | null = null;
  for (let index = 0; index < MAX_ATTEMPTS_PER_PASS; index += 1) {
    const { data, error } = await service.rpc(explicitPayment ? "dispatch_next_takeoff_payment_job" : "dispatch_next_takeoff_host_job", { p_host_id: hostId, p_module_default: takeoffModuleDefault() });
    if (explicitPayment && error?.code === "PGRST202") break;
    if (error) throw error;
    const next = data?.[0];
    closed.push(...(next?.closed_jobs ?? []));
    nextDueAt = next?.next_due_at ?? null;
    if (!next?.job_id) break;
    const trigger = next.trigger_kind === "retry" ? "retry" : "create";
    const outcome = await attempt(next.job_id, trigger);
    ran.push(next.job_id);
    // A job handed again right after an attempt that could not claim it (another process took the Mac): wait for it.
    if (next.job_id === previous && (outcome.status === "in_progress" || outcome.status === "noop_terminal")) break;
    previous = next.job_id;
  }
  return { ran, closed, nextDueAt };
}

let running: Promise<TakeoffDispatchPass> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let timerAt = Number.POSITIVE_INFINITY;

function scheduleRetry(dueAt: string | null) {
  const at = dueAt ? Date.parse(dueAt) : Number.NaN;
  if (!Number.isFinite(at) || at >= timerAt) return;
  const delay = Math.max(0, at - Date.now());
  if (delay > MAX_TIMER_MS) return;
  if (timer) clearTimeout(timer);
  timerAt = at;
  timer = setTimeout(() => {
    timer = null;
    timerAt = Number.POSITIVE_INFINITY;
    void runLocalTakeoffDispatcherPass().catch(() => console.error("takeoff.local_dispatcher.pass_failed"));
  }, delay + 250);
  timer.unref?.();
}

/**
 * One pass of this Mac's dispatcher: the jobs the database hands, one attempt each, until the Mac is busy or nothing is
 * due; then a timer for the next retry due. A pass asked while one runs makes that one go round once more. `attempt` is
 * the attempt of one job (the worker's by default; the owned-worker journeys pass a controlled provider's).
 */
export async function runLocalTakeoffDispatcherPass(options: { attempt?: TakeoffDispatchAttempt; hostId?: string; service?: Service } = {}): Promise<TakeoffDispatchPass> {
  if (running) {
    again = true;
    return running;
  }
  const service = options.service ?? createServiceRoleClient();
  running = (async () => {
    const hostId = options.hostId ?? await getChatGptHostId();
    const hosts = options.hostId ? [hostId] : [hostId, takeoffPaymentHostId(hostId)];
    const total: TakeoffDispatchPass = { ran: [], closed: [], nextDueAt: null };
    do {
      again = false;
      total.nextDueAt = null;
      for (const queueHost of hosts) {
        const pass = await dispatchOnce(service, queueHost, options.attempt ?? defaultAttempt, queueHost !== hostId);
        total.ran.push(...pass.ran);
        total.closed.push(...pass.closed);
        if (pass.nextDueAt && (!total.nextDueAt || pass.nextDueAt < total.nextDueAt)) total.nextDueAt = pass.nextDueAt;
      }
    } while (again);
    return total;
  })();
  try {
    const pass = await running;
    scheduleRetry(pass.nextDueAt);
    return pass;
  } finally {
    running = null;
  }
}
