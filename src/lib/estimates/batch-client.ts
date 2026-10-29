import { parseEstimateBatchResponse } from "@/lib/estimates/batch-contracts";
import type { BatchOperationInput } from "@/lib/estimates/schemas";
import type { EstimateBatchResult, EstimateVersionToken } from "@/lib/estimates/client";
import { canonicalizeEstimateBatchOperations } from "@/lib/estimates/batch-request";
import {
  assertNoPendingEstimateBatch, clearEstimateBatchIntention, createEstimateBatchAttempt,
  EstimateBatchOutcomeUnknownError, EstimateBatchPendingError,
  readEstimateBatchIntention, retainEstimateBatchIntention, setEstimateBatchSending,
  type EstimateBatchAttempt, type EstimateBatchIdentity, type EstimateBatchIntention,
} from "@/lib/estimates/batch-intentions";
import {
  getEstimateEditorMutationIdentity, runEstimateEditorMutation,
} from "@/lib/estimates/editor-mutations";

type Transport = (path: string, init: RequestInit, message: string) => Promise<unknown>;
type RequestBody = { operation_key?: string; concurrency_token: string; dry_run?: boolean; operations: BatchOperationInput[] };
const UNKNOWN_MESSAGE = "Le résultat de l'opération n'a pas pu être confirmé. Vérifiez son résultat avant de reprendre.";
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function unknownOutcome(): never { throw new EstimateBatchOutcomeUnknownError(UNKNOWN_MESSAGE); }

function parseResponse(payload: unknown, body: RequestBody, versionId: string, identity?: EstimateBatchIdentity): EstimateBatchResult {
  try {
    const result = parseEstimateBatchResponse(payload, {
      versionId, actorId: identity?.actorId, operationKey: body.operation_key,
      expectedUpdatedAt: body.concurrency_token, operations: body.operations, dryRun: body.dry_run,
    });
    if (!result.committed) return { committed: false, results: result.results, versionToken: result.version };
    const current = result.current_version;
    return {
      committed: true, results: result.results, versionToken: result.version,
      currentVersionToken: { id: current.id, updated_at: current.updated_at,
        ...(current.content_revision === undefined ? {} : { content_revision: current.content_revision }) },
      totals: result.totals, replayed: result.replayed,
      receipt: {
        operationKey: result.receipt.operation_key, actorId: result.receipt.actor_id, versionId,
        expectedUpdatedAt: result.receipt.expected_updated_at, committedAt: result.receipt.committed_at,
      },
    };
  } catch {
    return unknownOutcome();
  }
}

function isConfirmedRefusal(error: unknown) {
  // Only an explicit application error can establish that the SQL call refused.
  return record(error) && typeof error.status === "number" && [400, 401, 403, 404, 409, 413, 422].includes(error.status) &&
    typeof error.code === "string" && error.code !== "BATCH_OUTCOME_UNKNOWN";
}
function requireIdentity(versionId: string) {
  const identity = getEstimateEditorMutationIdentity(versionId);
  if (!identity) throw new EstimateBatchPendingError("Le compte de l'éditeur n'est pas prêt. Rechargez le devis avant d'enregistrer.");
  return identity;
}
function sameIdentity(left: EstimateBatchIdentity, right: EstimateBatchIdentity) {
  return left.actorId === right.actorId && left.tenantId === right.tenantId && left.versionId === right.versionId;
}

async function submit(transport: Transport, intention: EstimateBatchIntention, recovering = false): Promise<EstimateBatchResult> {
  if (intention.workflow) throw new EstimateBatchPendingError("Une autre opération attend une vérification.");
  if (!sameIdentity(requireIdentity(intention.versionId), intention)) {
    throw new EstimateBatchPendingError("Le compte ou l'affaire a changé. La demande précédente n'a pas été renvoyée.");
  }
  retainEstimateBatchIntention(intention);
  setEstimateBatchSending(intention, true);
  try {
    let payload: unknown;
    try {
      payload = await transport(`/api/estimates/${intention.versionId}/batch`, {
        method: "POST", headers: { "Content-Type": "application/json", "If-Match": intention.expectedUpdatedAt }, body: intention.body,
      }, UNKNOWN_MESSAGE);
    } catch (error) {
      if (isConfirmedRefusal(error)) {
        // Refusing today's replay does not disprove yesterday's unknown commit
        // (for example, write access may have been revoked in between).
        if (!recovering) clearEstimateBatchIntention(intention, intention.operationKey);
        throw error;
      }
      return unknownOutcome();
    }
    const result = parseResponse(payload, JSON.parse(intention.body) as RequestBody, intention.versionId, intention);
    // A replay remains pending until the current server version has been reloaded.
    if (!recovering && !result.replayed) clearEstimateBatchIntention(intention, intention.operationKey);
    return result;
  } finally { setEstimateBatchSending(intention, false); }
}

export async function executeClientEstimateBatch(input: {
  transport: Transport; versionId: string; updatedAtToken: string; operations: BatchOperationInput[];
  dryRun?: boolean; attempt?: EstimateBatchAttempt;
}): Promise<{ value: EstimateBatchResult; version: EstimateVersionToken; structural: boolean; deletedIds: string[]; totals?: EstimateBatchResult["totals"] }> {
  const operations = canonicalizeEstimateBatchOperations(input.operations);
  const attempt = input.attempt ?? createEstimateBatchAttempt();
  const queuedToken = input.updatedAtToken;
  const identity = input.dryRun ? undefined : requireIdentity(input.versionId);
  let result: EstimateBatchResult;
  if (input.dryRun) {
    const body: RequestBody = { concurrency_token: queuedToken ?? input.updatedAtToken, dry_run: true, operations };
    result = parseResponse(await input.transport(`/api/estimates/${input.versionId}/batch?dry_run=true`, {
      method: "POST", headers: { "Content-Type": "application/json", "If-Match": body.concurrency_token }, body: JSON.stringify(body),
    }, "Impossible de vérifier les opérations groupées."), body, input.versionId);
  } else {
    if (!attempt.intention) {
      assertNoPendingEstimateBatch(identity!);
      const body: RequestBody = { operation_key: attempt.operationKey, concurrency_token: queuedToken ?? input.updatedAtToken, operations };
      const serialized = JSON.stringify(body);
      if (new TextEncoder().encode(serialized).length > 1024 * 1024) {
        throw new Error("La demande groupée dépasse 1 Mio. Réduisez le nombre de lignes avant de réessayer.");
      }
      attempt.intention = { ...identity!, schemaVersion: 1, operationKey: attempt.operationKey,
        expectedUpdatedAt: body.concurrency_token, body: serialized, createdAt: new Date().toISOString() };
    } else if (JSON.stringify((JSON.parse(attempt.intention.body) as RequestBody).operations) !== JSON.stringify(operations)) {
      throw new EstimateBatchPendingError("La demande de reprise a changé. Vérifiez d'abord l'opération précédente.");
    }
    result = await submit(input.transport, attempt.intention);
  }
  return {
    value: result, version: result.currentVersionToken ?? result.versionToken,
    structural: result.committed && operations.some((operation) => operation.op !== "update"),
    totals: result.committed && !result.replayed ? result.totals : undefined,
    deletedIds: result.committed ? result.results.flatMap((entry) => entry.status === "ok" &&
      record(entry.data) && Array.isArray(entry.data.deleted_ids) ? entry.data.deleted_ids as string[] : []) : [],
  };
}

export async function inspectClientEstimateBatch(transport: Transport, identity: EstimateBatchIdentity): Promise<EstimateBatchResult | null> {
  if (!sameIdentity(requireIdentity(identity.versionId), identity)) throw new EstimateBatchPendingError("Le compte de l'éditeur a changé.");
  const intention = readEstimateBatchIntention(identity);
  if (!intention) return null;
  if (intention.workflow) throw new EstimateBatchPendingError("Une autre opération attend une vérification.");
  const payload = await transport(`/api/estimates/${identity.versionId}/batch/receipts/${intention.operationKey}`,
    { method: "GET", cache: "no-store" }, "Impossible de vérifier le résultat. La demande reste conservée.");
  return payload === null ? null : parseResponse(payload, JSON.parse(intention.body) as RequestBody, identity.versionId, identity);
}

export async function resumeClientEstimateBatch(transport: Transport, identity: EstimateBatchIdentity) {
  const intention = readEstimateBatchIntention(identity);
  if (!intention) throw new EstimateBatchPendingError("Aucune opération à reprendre.");
  return runEstimateEditorMutation(identity.versionId, intention.expectedUpdatedAt, async () => {
    // Ignore the queue's current token: this is the original intention.
    const result = await submit(transport, intention, true);
    return { value: result, version: result.currentVersionToken ?? result.versionToken, structural: result.committed };
  });
}
