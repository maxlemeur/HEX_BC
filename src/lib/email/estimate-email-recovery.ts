import "server-only";

import { randomUUID } from "node:crypto";

import type { EstimateEmailDispatch } from "@/lib/email/estimate-email-dispatch-contracts";
import {
  claimEstimateEmailDispatch,
  failEstimateEmailDispatch,
  listDueEstimateEmailDispatches,
} from "@/lib/email/estimate-email-dispatch-repository";
import {
  deliverEstimateEmailDispatch,
  downloadFrozenEstimatePdf,
} from "@/lib/email/estimate-email-delivery";

export const MAX_ESTIMATE_EMAIL_OUTBOX_ATTEMPTS = 5;

export type EmailOutboxDrainResult = {
  claimed: number;
  sent: number;
  failed: number;
  dead: number;
  blocked: number;
  skipped: boolean;
  errors: string[];
};

const TERMINAL_ESTIMATE_EMAIL_STATUSES = new Set([
  "sent",
  "delivered",
  "bounced",
  "unknown",
  "failed",
]);

/**
 * Replays due dispatches. The DB contract (`assert_estimate_email_dispatch_actor`)
 * requires a real admin/engineer actor of the tenant, so each row is replayed
 * under its own `created_by` unless an explicit actor is provided. A system
 * actor is not accepted by the RPCs; rows without a creator are reported, not
 * retried silently.
 */
export async function drainEstimateEmailOutbox(
  dependencies: {
    listDue?: () => Promise<EstimateEmailDispatch[]>;
    deliver?: typeof deliverEstimateEmailDispatch;
    claim?: typeof claimEstimateEmailDispatch;
    fail?: typeof failEstimateEmailDispatch;
    loadPdfBuffer?: (dispatch: EstimateEmailDispatch) => Promise<Buffer>;
    apiKey?: string | null;
    maxAttempts?: number;
    actorUserId?: string;
    now?: Date;
  } = {}
): Promise<EmailOutboxDrainResult> {
  const maxAttempts = Math.max(
    1,
    dependencies.maxAttempts ?? MAX_ESTIMATE_EMAIL_OUTBOX_ATTEMPTS
  );
  const deliver = dependencies.deliver ?? deliverEstimateEmailDispatch;
  const claim = dependencies.claim ?? claimEstimateEmailDispatch;
  const fail = dependencies.fail ?? failEstimateEmailDispatch;
  const apiKey = dependencies.apiKey ?? process.env.RESEND_API_KEY ?? "";

  const due = dependencies.listDue
    ? await dependencies.listDue()
    : await listDueEstimateEmailDispatches(dependencies.now ?? new Date());
  const dispatches = Array.isArray(due) ? due : due.dispatches;

  const result: EmailOutboxDrainResult = {
    claimed: 0,
    sent: 0,
    failed: 0,
    dead: 0,
    blocked: Array.isArray(due) ? 0 : due.blocked,
    skipped: dispatches.length === 0,
    errors: [],
  };

  for (const dispatch of dispatches) {
    const actorUserId = dependencies.actorUserId ?? dispatch.created_by;
    if (!actorUserId) {
      result.failed += 1;
      result.errors.push(
        `Dispatch ${dispatch.id}: aucun acteur (created_by) pour rejouer l'envoi.`
      );
      continue;
    }

    result.claimed += 1;
    if (dispatch.attempt_count >= maxAttempts) {
      // `fail_estimate_email_dispatch` only accepts a lease-less failure for
      // `preparing`; a queued/processing row must be closed under a lease we hold.
      try {
        const leaseToken = randomUUID();
        const claimed = await claim({
          dispatchId: dispatch.id,
          tenantId: dispatch.tenant_id,
          actorUserId,
          leaseToken,
        });
        if (TERMINAL_ESTIMATE_EMAIL_STATUSES.has(claimed.status)) {
          continue;
        }
        await fail({
          dispatchId: dispatch.id,
          tenantId: dispatch.tenant_id,
          actorUserId,
          leaseToken,
          errorCode: "ESTIMATE_EMAIL_RETRY_CAP",
          errorMessage: `Plafond de ${maxAttempts} tentatives atteint.`,
        });
        result.dead += 1;
        result.failed += 1;
      } catch (error) {
        result.errors.push(
          error instanceof Error ? error.message : "Échec de cloture outbox."
        );
      }
      continue;
    }

    if (!apiKey && !dependencies.deliver) {
      result.errors.push("RESEND_API_KEY manquant pour drainer l'outbox.");
      result.failed += 1;
      continue;
    }

    try {
      await deliver({
        dispatch,
        actorUserId,
        apiKey,
        loadPdfBuffer: async () => {
          if (dependencies.loadPdfBuffer) {
            return dependencies.loadPdfBuffer(dispatch);
          }
          return downloadFrozenEstimatePdf(dispatch);
        },
        retryDelaysMs: [],
      });
      result.sent += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push(
        error instanceof Error ? error.message : "Échec de replay outbox."
      );
    }
  }

  return result;
}
