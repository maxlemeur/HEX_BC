import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { takeoffModuleDefault } from "@/lib/takeoff/feature-flags";

/**
 * The ledger of a job's paid calls (migration 20261121181031_takeoff_plan_dispatcher.sql): every call of an attempt, a
 * reading of the PDF or a question on its vector groups, is reserved before it is sent, with its credential in hand,
 * and settled once with the usage its answer carried; a call that ends without a known usage stays held as unknown in
 * the request's balance, never credited back. The database decides, under the job's lock then the request's: the job's
 * right to pay (its module, the one payer rule), and for a launch request's job a positive balance of its unit and of
 * its request, counting what is held. A job without a request reserves nothing (its own per-job budget applies).
 */
export type TakeoffPaidCallBranch = "pdf" | "vector_group" | "other";

/** A call that may be sent: its key in the ledger, or none for a job without a request. */
export type TakeoffPaidCall = { readonly key: string } | null;

export type TakeoffPaidCallLedger = {
  /** Before a paid call is sent: its right and its reservation; throws the refusal, and nothing is sent. */
  beforePaidCall(branch: TakeoffPaidCallBranch): Promise<TakeoffPaidCall>;
  /** The usage the call's answer carried: settles its reservation once; a failure to record stops the job. */
  recordPaidUsage(call: TakeoffPaidCall, usage: { totalTokens: number; costCents: number }): Promise<void>;
  /** The call ended without a known usage (no answer, or one without its usage): it stays held as unknown. */
  recordUnknownUsage(call: TakeoffPaidCall): Promise<void>;
};

/**
 * The bound a call reserves before its first answer of its branch (the largest observed afterwards): the estimate the
 * vector groups' budget starts from (GROUP_DECISIONS_CALL_ESTIMATE_TOKENS), a starting value to measure on real dossiers.
 */
export const TAKEOFF_PAID_CALL_ESTIMATE_TOKENS = 30_000;
/** The waits of a call for the calls of its attempt still in flight, before its reservation is refused. */
const MAX_WAITS = 40;

const forbidden = (jobId: string, message: string) =>
  new TakeoffError({ status: 403, code: TakeoffErrorCode.FORBIDDEN, retryable: false, jobId, message });

/** The refusal of a paid call in French, the same for the check before an attempt and the reservation of each call. */
export function takeoffPaymentRefusal(jobId: string, reason: string | null): TakeoffError {
  switch (reason) {
    case "BUDGET_EXHAUSTED":
      return new TakeoffError({ status: 422, code: TakeoffErrorCode.TAKEOFF_REQUEST_BUDGET_EXHAUSTED, retryable: false, jobId,
        message: "Le budget de cette analyse est épuisé par ses tentatives précédentes. Relancez l’analyse depuis les options du métré." });
    case "TAKEOFF_DISABLED":
      return forbidden(jobId, "Le module Takeoff est désactivé pour ce tenant.");
    default:
      return forbidden(jobId, "Le créateur n’est plus autorisé à lancer un métré sur cette affaire.");
  }
}

type Row = { outcome: string; reason: string | null };

export function createTakeoffCallLedger(job: { id: string; launch_request_id?: string | null }, lease: () => string | null): TakeoffPaidCallLedger {
  const service = () => createServiceRoleClient();
  let calls = 0;
  // The calls of this attempt in flight: a call that waits for the balance they hold waits for one of them to end.
  const inFlight = new Map<string, { done: Promise<void>; end: () => void }>();
  const end = (call: TakeoffPaidCall) => {
    if (!call) return;
    inFlight.get(call.key)?.end();
    inFlight.delete(call.key);
  };

  return {
    async beforePaidCall(branch) {
      const key = `call:${++calls}`;
      for (let waits = 0; ; waits += 1) {
        const token = lease();
        const { data, error } = await service().rpc("reserve_takeoff_launch_call", {
          p_job_id: job.id, p_lease_token: token ?? "", p_call_key: key, p_branch: branch,
          p_estimate_tokens: TAKEOFF_PAID_CALL_ESTIMATE_TOKENS, p_module_default: takeoffModuleDefault(),
        });
        if (error) {
          if (error.code === "42501") {
            throw new TakeoffError({ code: TakeoffErrorCode.CONFLICT, retryable: false, jobId: job.id,
              message: "Le lease takeoff n'est plus disponible." });
          }
          throw new TakeoffError({ code: TakeoffErrorCode.INTERNAL_ERROR, retryable: false, jobId: job.id,
            message: "Impossible de vérifier le droit de payer cet appel : rien n’a été envoyé." });
        }
        const row = (data as Row[] | null)?.[0];
        if (row?.outcome === "unbudgeted") return null;
        if (row?.outcome === "reserved") {
          let resolve = () => {};
          const done = new Promise<void>((settle) => { resolve = settle; });
          inFlight.set(key, { done, end: resolve });
          return { key };
        }
        if (row?.outcome === "wait" && inFlight.size > 0 && waits < MAX_WAITS) {
          await Promise.race([...inFlight.values()].map((entry) => entry.done));
          continue;
        }
        throw takeoffPaymentRefusal(job.id, row?.outcome === "wait" ? "BUDGET_EXHAUSTED" : row?.reason ?? null);
      }
    },

    async recordPaidUsage(call, usage) {
      if (!call) return;
      try {
        const { error } = await service().rpc("record_takeoff_launch_usage", {
          p_job_id: job.id, p_lease_token: lease() ?? "", p_call_key: call.key, p_tokens: usage.totalTokens, p_cost_cents: usage.costCents,
        });
        if (error) {
          throw new TakeoffError({ code: TakeoffErrorCode.TAKEOFF_USAGE_UNRECORDED, retryable: false, jobId: job.id,
            message: "La consommation d’un appel ChatGPT n’a pas pu être enregistrée : l’analyse s’arrête avant tout autre appel." });
        }
      } finally {
        end(call);
      }
    },

    async recordUnknownUsage(call) {
      if (!call) return;
      try {
        // Best effort: a reservation still open when its attempt ends is held as unknown by the database anyway.
        const { error } = await service().rpc("record_takeoff_launch_call_unknown", {
          p_job_id: job.id, p_lease_token: lease() ?? "", p_call_key: call.key });
        if (error) console.error("takeoff.paid_call.unknown_unrecorded", { jobId: job.id, call: call.key });
      } finally {
        end(call);
      }
    },
  };
}
