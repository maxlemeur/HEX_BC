import type { BatchOperationInput } from "@/lib/estimates/schemas";
import type { EstimateBatchResult, EstimateBatchOperationResult, EstimateVersionToken } from "@/lib/estimates/client";
import { canonicalizeEstimateBatchOperations } from "@/lib/estimates/batch-request";
import {
  assertNoPendingEstimateBatch, clearEstimateBatchIntention, createEstimateBatchAttempt,
  EstimateBatchOutcomeUnknownError, EstimateBatchPendingError,
  readEstimateBatchIntention, retainEstimateBatchIntention, setEstimateBatchSending,
  type EstimateBatchAttempt, type EstimateBatchIdentity, type EstimateBatchIntention,
} from "@/lib/estimates/batch-intentions";
import {
  getEstimateEditorMutationIdentity, isOlderEstimateVersionToken, runEstimateEditorMutation,
} from "@/lib/estimates/editor-mutations";

type Transport = (path: string, init: RequestInit, message: string) => Promise<unknown>;
type RequestBody = { operation_key?: string; concurrency_token: string; dry_run?: boolean; operations: BatchOperationInput[] };
const UNKNOWN_MESSAGE = "Le résultat de l'opération n'a pas pu être confirmé. Vérifiez son résultat avant de reprendre.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function sameToken(left: string, right: string) {
  return !isOlderEstimateVersionToken(left, right) && !isOlderEstimateVersionToken(right, left);
}
function unknownOutcome(): never { throw new EstimateBatchOutcomeUnknownError(UNKNOWN_MESSAGE); }
function token(value: unknown, versionId: string): EstimateVersionToken {
  if (!record(value) || value.id !== versionId || !timestamp(value.updated_at)) return unknownOutcome();
  return { id: versionId, updated_at: value.updated_at,
    ...(typeof value.content_revision === "number" && Number.isSafeInteger(value.content_revision) && value.content_revision >= 0
      ? { content_revision: value.content_revision } : {}) };
}
function totals(value: unknown) {
  if (!record(value)) return unknownOutcome();
  const ht = value.total_ht_cents, tax = value.total_tax_cents, ttc = value.total_ttc_cents;
  if (![ht, tax, ttc].every((amount) => typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0) ||
    (ht as number) + (tax as number) !== ttc) return unknownOutcome();
  return { total_ht_cents: ht as number, total_tax_cents: tax as number, total_ttc_cents: ttc as number };
}
function validateItem(value: unknown, versionId: string, expectedId?: string) {
  if (!record(value) || typeof value.id !== "string" || !UUID.test(value.id) ||
    (expectedId !== undefined && value.id !== expectedId) || value.version_id !== versionId ||
    !["line", "section"].includes(String(value.item_type))) return unknownOutcome();
  if (value.item_type === "line") {
    if (typeof value.pu_ht_cents !== "number" || !Number.isSafeInteger(value.pu_ht_cents) || value.pu_ht_cents < 0) return unknownOutcome();
    totals({ total_ht_cents: value.line_total_ht_cents, total_tax_cents: value.line_tax_cents, total_ttc_cents: value.line_total_ttc_cents });
  }
}

function parseResponse(payload: unknown, body: RequestBody, versionId: string, identity?: EstimateBatchIdentity): EstimateBatchResult {
  if (!record(payload) || typeof payload.committed !== "boolean" || !Array.isArray(payload.results) ||
    payload.results.length === 0 || payload.results.length > body.operations.length) return unknownOutcome();
  const versionToken = token(payload.version, versionId);
  const results: EstimateBatchOperationResult[] = payload.results.map((entry, index) => {
    const operation = body.operations[index];
    if (!record(entry) || entry.index !== index || entry.op !== operation.op) return unknownOutcome();
    if (entry.status === "error") {
      if (payload.committed || index !== (payload.results as unknown[]).length - 1 ||
        typeof entry.code !== "string" || !entry.code || typeof entry.message !== "string" || !entry.message) return unknownOutcome();
      return { index, op: operation.op, status: "error", code: entry.code, message: entry.message, details: entry.details };
    }
    if (entry.status !== "ok" || !record(entry.data)) return unknownOutcome();
    if (payload.committed) {
      if (operation.op === "create" || operation.op === "update") {
        if (entry.data.item === null) {
          const deletedId = entry.data.deleted_item_id;
          if (entry.data.deleted_in_batch !== true || typeof deletedId !== "string" || !UUID.test(deletedId) ||
            (operation.op === "update" && deletedId !== operation.id) ||
            !(payload.results as unknown[]).slice(index + 1).some((later) => record(later) && later.op === "delete" &&
              record(later.data) && Array.isArray(later.data.deleted_ids) && later.data.deleted_ids.includes(deletedId))) return unknownOutcome();
        } else {
          validateItem(entry.data.item, versionId, operation.op === "update" ? operation.id : undefined);
          if (operation.op === "create" && record(entry.data.item) && entry.data.item.item_type !== operation.data.item_type) return unknownOutcome();
        }
      }
      if (operation.op === "delete" && (entry.data.deleted_id !== operation.id ||
        !Array.isArray(entry.data.deleted_ids) || !entry.data.deleted_ids.includes(operation.id) ||
        !entry.data.deleted_ids.every((id) => typeof id === "string" && UUID.test(id)) ||
        new Set(entry.data.deleted_ids).size !== entry.data.deleted_ids.length)) return unknownOutcome();
      if (operation.op === "reorder" && (entry.data.parent_id !== (operation.data.parent_id ?? null) ||
        JSON.stringify(entry.data.ordered_ids) !== JSON.stringify(operation.data.ordered_ids) ||
        entry.data.updated_count !== operation.data.ordered_ids.length)) return unknownOutcome();
    } else if (entry.data.rolled_back !== true && !(body.dry_run && entry.data.dry_run === true)) return unknownOutcome();
    return { index, op: operation.op, status: "ok", data: entry.data };
  });
  if (!payload.committed) {
    const failed = results.some((result) => result.status === "error");
    if (!sameToken(versionToken.updated_at, body.concurrency_token) ||
      (!failed && (!body.dry_run || results.length !== body.operations.length))) return unknownOutcome();
    return { committed: false, results, versionToken };
  }
  if (body.dry_run || results.length !== body.operations.length || !identity || !record(payload.receipt) ||
    payload.receipt.operation_key !== body.operation_key || payload.receipt.actor_id !== identity.actorId ||
    payload.receipt.version_id !== versionId || !timestamp(payload.receipt.expected_updated_at) ||
    !sameToken(payload.receipt.expected_updated_at, body.concurrency_token) || !timestamp(payload.receipt.committed_at) ||
    !Array.isArray(payload.receipt.operations) || typeof payload.replayed !== "boolean") return unknownOutcome();
  try {
    if (JSON.stringify(canonicalizeEstimateBatchOperations(payload.receipt.operations as BatchOperationInput[])) !==
      JSON.stringify(body.operations)) return unknownOutcome();
  } catch { return unknownOutcome(); }
  const currentVersionToken = token(payload.current_version, versionId);
  if (isOlderEstimateVersionToken(currentVersionToken.updated_at, versionToken.updated_at)) return unknownOutcome();
  const createdIds = results.flatMap((entry) => entry.op === "create" && entry.status === "ok" && record(entry.data)
    ? [record(entry.data.item) ? entry.data.item.id : entry.data.deleted_item_id] : []);
  if (new Set(createdIds).size !== createdIds.length) return unknownOutcome();
  return {
    committed: true, results, versionToken, currentVersionToken, totals: totals(payload.totals),
    replayed: payload.replayed,
    receipt: {
      operationKey: body.operation_key!, actorId: identity.actorId, versionId,
      expectedUpdatedAt: body.concurrency_token, committedAt: payload.receipt.committed_at,
    },
  };
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
