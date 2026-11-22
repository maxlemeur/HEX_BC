import "server-only";

import { headers } from "next/headers";
import { after } from "next/server";

import { assertLocalChatGptHost } from "@/lib/ai/chatgpt-local-auth";
import type { TriggerTakeoffJobProcessingInput, TriggerTakeoffJobProcessingResult } from "@/lib/takeoff/edge-trigger";
import { isTakeoffPlanDispatchActive, runLocalTakeoffDispatcherPass } from "@/lib/takeoff/local-dispatcher";

/**
 * Runs a job's attempts on this Mac until the worker stops asking for another one. The member's request hands it to
 * `after`; the automatic start, which has no request, runs it from its own loop. The job's lease keeps two runs apart.
 * Once the owner activated one analysis per plan, the job is never run on a lane of its own: a pass of this Mac's
 * dispatcher reads it in its turn, one plan at a time (local-dispatcher.ts).
 */
export async function runLocalTakeoffAttempts(input: { jobId: string; correlationId: string; trigger?: TriggerTakeoffJobProcessingInput["trigger"] }) {
  try {
    // The activation unread (the database unreachable): the job's own claim still takes the Mac's slot once it is set.
    if (await isTakeoffPlanDispatchActive().catch(() => false)) {
      await runLocalTakeoffDispatcherPass();
      return;
    }
    const { processTakeoffJobAttempt } = await import("@/lib/takeoff/async-worker");
    let trigger = input.trigger ?? "create";
    for (;;) {
      const outcome = await processTakeoffJobAttempt(input.jobId, { trigger, correlationId: input.correlationId });
      if (!outcome.should_requeue) break;
      const delayMs = Math.max(0, outcome.next_run_in_seconds ?? 0) * 1000;
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      trigger = outcome.requeue_reason ?? "retry";
    }
  } catch {
    console.error("takeoff.local_dispatch.failed", { jobId: input.jobId, correlationId: input.correlationId });
  }
}

export async function dispatchLocalTakeoff(input: TriggerTakeoffJobProcessingInput & { correlationId: string }): Promise<TriggerTakeoffJobProcessingResult> {
  assertLocalChatGptHost((await headers()).get("host"));
  after(() => runLocalTakeoffAttempts(input));
  return { triggered: true, correlationId: input.correlationId, statusCode: 202, outcome: "accepted" };
}
