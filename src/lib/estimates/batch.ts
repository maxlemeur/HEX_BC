import { z } from "zod";

import {
  EstimateBatchPreparationError, prepareEstimateBatch, sameEstimateBatchTimestamp, type EstimateBatchCreatedId,
} from "@/lib/estimates/batch-preparation";
import { canonicalizeEstimateBatchOperations } from "@/lib/estimates/batch-request";
import { ApiError, badRequest, conflict, type SupabaseErrorLike } from "@/lib/estimates/errors";
import { batchOperationSchema, type BatchOperationInput } from "@/lib/estimates/schemas";
import {
  assertDraftLockOwnedByCurrentUser, assertDraftStatus, getAuthenticatedContext,
  getVersionAccessOrThrow, type AuthenticatedContext,
} from "@/lib/estimates/server-context";
import { assertCanWriteEstimateWorkflows } from "@/lib/estimates/write-access";
import type { Json } from "@/types/database";

export const ESTIMATE_BATCH_MAX_OPERATIONS = 1000;
export const ESTIMATE_BATCH_MAX_BODY_BYTES = 1024 * 1024;
export const ESTIMATE_BATCH_MAX_RECEIPT_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_BATCH_OPERATIONS = 100;
const uuid = z.string().uuid();
const timestamp = z.string().refine((value) => Number.isFinite(Date.parse(value)));
const tokenSchema = z.object({ id: uuid, updated_at: timestamp }).strict();
const operationNameSchema = z.enum(["create", "update", "delete", "reorder"]);
const operationResultSchema = z.discriminatedUnion("status", [
  z.object({ index: z.number().int().nonnegative(), op: operationNameSchema,
    status: z.literal("ok"), data: z.unknown() }).strict(),
  z.object({ index: z.number().int().nonnegative(), op: operationNameSchema,
    status: z.literal("error"), code: z.string().regex(/^[A-Z][A-Z0-9_]+$/), message: z.string().max(1000) }).strict(),
]);
const cents = z.number().int().nonnegative().refine(Number.isSafeInteger);
const totalsSchema = z.object({ total_ht_cents: cents, total_tax_cents: cents, total_ttc_cents: cents })
  .strict().refine((value) => value.total_ht_cents + value.total_tax_cents === value.total_ttc_cents);
export const estimateBatchCommittedResultSchema = z.object({
  committed: z.literal(true), results: z.array(operationResultSchema).min(1).max(ESTIMATE_BATCH_MAX_OPERATIONS),
  version: tokenSchema, totals: totalsSchema,
  receipt: z.object({ operation_key: uuid, actor_id: uuid, version_id: uuid,
    expected_updated_at: timestamp, operations: z.array(batchOperationSchema).min(1).max(ESTIMATE_BATCH_MAX_OPERATIONS),
    committed_at: timestamp }).strict(),
  replayed: z.boolean(),
  current_version: tokenSchema.extend({ status: z.enum(["draft", "sending", "sent", "accepted", "archived"]) }).strict(),
}).strict();
const refusedResultSchema = z.object({ committed: z.literal(false),
  results: z.array(operationResultSchema).min(1).max(ESTIMATE_BATCH_MAX_OPERATIONS), version: tokenSchema }).strict();
export type EstimateBatchOperationResult = z.infer<typeof operationResultSchema>;
export type EstimateBatchCommittedResult = z.infer<typeof estimateBatchCommittedResultSchema>;
export type ExecuteEstimateBatchResult = EstimateBatchCommittedResult | z.infer<typeof refusedResultSchema>;
export type ExecuteEstimateBatchOptions = {
  concurrencyToken?: string;
  operationKey?: string;
  dryRun?: boolean;
  maxOperations?: number;
  /** Server-side copies only (2.8b): identities of the created items, so that a child names a section created earlier in the batch, and the source_metadata of the copied item. Never set by the HTTP batch API. */
  createdIds?: EstimateBatchCreatedId[];
};

export function resolveEstimateBatchMaxOperations(override?: number) {
  const configured = override ?? Number.parseInt(process.env.ESTIMATE_BATCH_MAX_OPERATIONS ?? "", 10);
  if (Number.isFinite(configured) && configured > ESTIMATE_BATCH_MAX_OPERATIONS) {
    throw badRequest("La limite de batch ne peut pas dépasser 1000 opérations.", undefined, "BATCH_LIMIT_EXCEEDED");
  }
  return Number.isFinite(configured) && configured >= 1 ? Math.floor(configured) : DEFAULT_MAX_BATCH_OPERATIONS;
}

function outcomeUnknown() {
  return new ApiError({ status: 503, code: "BATCH_OUTCOME_UNKNOWN",
    message: "Le résultat de cette opération doit être vérifié. Conservez la même demande avant de réessayer." });
}

function readUnavailable() {
  return new ApiError({ status: 503, code: "ESTIMATE_BATCH_READ_UNAVAILABLE",
    message: "Impossible de vérifier le résultat du batch. Réessayez la même demande." });
}

const RPC_ERRORS: Record<string, [ApiError["status"], string]> = {
  ESTIMATE_BATCH_INVALID_INPUT: [400, "Demande de batch invalide."],
  ESTIMATE_BATCH_OPERATION_KEY_REQUIRED: [400, "Rechargez l’application avant d’enregistrer ce batch : sa clé d’opération est absente."],
  ESTIMATE_BATCH_FORBIDDEN: [403, "Cette modification du devis n’est pas autorisée."],
  ESTIMATE_BATCH_NOT_FOUND: [404, "Version de chiffrage introuvable."],
  ESTIMATE_BATCH_STALE: [409, "Le devis a changé. Rechargez avant de préparer une nouvelle demande."],
  ESTIMATE_BATCH_CONTEXT_CHANGED: [409, "Les paramètres de calcul ont changé. Rechargez le devis."],
  ESTIMATE_BATCH_LOCK_REQUIRED: [409, "Un verrou actif de cette page est requis."],
  ESTIMATE_BATCH_IDEMPOTENCY_CONFLICT: [409, "Cette clé correspond à une autre demande."],
  ESTIMATE_BATCH_PROJECTION_MISMATCH: [400, "La projection du batch ne correspond pas à ses lignes."],
  // 2.8b, revue Codex de la PR #59 (G2) : provenance (import, mapping, ligne mappée, document) d'une autre entreprise.
  ESTIMATE_BATCH_SOURCE_METADATA_FOREIGN: [400, "La provenance d’un élément désigne un import ou un document d’une autre entreprise. Rien n’a été écrit."],
  // 2.8b : reçu au-delà de 2 Mio, refusé par son nom dans la transaction (rien n’est écrit), plus en 400 générique.
  ESTIMATE_BATCH_RECEIPT_TOO_LARGE: [413, "Le reçu de ce lot dépasserait 2 Mio. Rien n’a été écrit : découpez-le en lots plus petits."],
};

function rpcError(error: SupabaseErrorLike, mutation: boolean) {
  const known = RPC_ERRORS[error.message];
  if (known && ["22023", "42501", "40001", "55000", "P0001", "P0002"].includes(error.code)) {
    return new ApiError({ status: known[0], code: error.message, message: known[1] });
  }
  if (["40001", "40P01", "55P03"].includes(error.code)) {
    return conflict("Le devis est en cours de modification. Réessayez la même demande.", undefined, "ESTIMATE_BATCH_STALE");
  }
  return mutation ? outcomeUnknown() : readUnavailable();
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCommitted(value: unknown, input: {
  versionId: string; operationKey: string; actorId: string;
}): EstimateBatchCommittedResult {
  const parsed = estimateBatchCommittedResultSchema.safeParse(value);
  if (!parsed.success) throw outcomeUnknown();
  const result = parsed.data;
  const operations = result.receipt.operations;
  if (result.version.id !== input.versionId || result.current_version.id !== input.versionId ||
    result.receipt.version_id !== input.versionId || result.receipt.actor_id !== input.actorId ||
    result.receipt.operation_key !== input.operationKey || result.results.length !== operations.length) throw outcomeUnknown();
  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    const entry = result.results[index];
    if (entry.index !== index || entry.op !== operation.op || entry.status !== "ok" || !record(entry.data)) throw outcomeUnknown();
    if (operation.op === "create" || operation.op === "update") {
      const item = entry.data.item;
      if (item === null && entry.data.deleted_in_batch === true) {
        const deletedId = entry.data.deleted_item_id;
        const deletedLater = result.results.some((later, laterIndex) =>
          laterIndex > index && operations[laterIndex].op === "delete" &&
          later.op === "delete" && later.status === "ok" && record(later.data) &&
          Array.isArray(later.data.deleted_ids) && later.data.deleted_ids.includes(deletedId));
        if (!uuid.safeParse(deletedId).success || !deletedLater ||
          (operation.op === "update" && deletedId !== operation.id)) throw outcomeUnknown();
        continue;
      }
      if (!record(item) || !uuid.safeParse(item.id).success || item.version_id !== input.versionId ||
        (operation.op === "update" && item.id !== operation.id) ||
        (operation.op === "create" && item.item_type !== operation.data.item_type)) throw outcomeUnknown();
    } else if (operation.op === "delete") {
      const ids = z.array(uuid).min(1).safeParse(entry.data.deleted_ids);
      if (entry.data.deleted_id !== operation.id || !ids.success || !ids.data.includes(operation.id) ||
        new Set(ids.data).size !== ids.data.length) throw outcomeUnknown();
    } else if (entry.data.parent_id !== (operation.data.parent_id ?? null) ||
      entry.data.updated_count !== operation.data.ordered_ids.length ||
      JSON.stringify(entry.data.ordered_ids) !== JSON.stringify(operation.data.ordered_ids)) throw outcomeUnknown();
  }
  return result;
}

async function lookupReceipt(context: AuthenticatedContext, versionId: string, operationKey: string) {
  let response;
  try {
    response = await context.supabase.rpc("get_estimate_batch_receipt", {
      p_version_id: versionId, p_operation_key: operationKey,
    });
  } catch { throw readUnavailable(); }
  if (response.error) throw rpcError(response.error, false);
  if (response.data === null) return null;
  if (Buffer.byteLength(JSON.stringify(response.data), "utf8") > ESTIMATE_BATCH_MAX_RECEIPT_BYTES) throw readUnavailable();
  return parseCommitted(response.data, { versionId, operationKey, actorId: context.userId });
}

export async function getEstimateBatchReceipt(versionId: string, operationKey: string) {
  const context = await getAuthenticatedContext();
  return lookupReceipt(context, uuid.parse(versionId).toLowerCase(), uuid.parse(operationKey).toLowerCase());
}

export async function executeEstimateBatch(
  versionId: string, incomingOperations: BatchOperationInput[], options: ExecuteEstimateBatchOptions
): Promise<ExecuteEstimateBatchResult> {
  if (incomingOperations.length === 0) throw badRequest("operations ne peut pas être vide.");
  const limit = resolveEstimateBatchMaxOperations(options.maxOperations);
  if (incomingOperations.length > limit) throw badRequest(`operations ne peut pas contenir plus de ${limit} opérations.`,
    { max_operations: limit, received_operations: incomingOperations.length }, "BATCH_LIMIT_EXCEEDED");
  const concurrencyToken = options.concurrencyToken?.trim();
  if (!concurrencyToken) throw badRequest("Jeton de concurrence manquant.");
  if (!Number.isFinite(Date.parse(concurrencyToken))) throw badRequest("Jeton de concurrence invalide.");
  const operationKey = options.operationKey ? uuid.parse(options.operationKey).toLowerCase() : undefined;
  if (!options.dryRun && !operationKey) {
    const [status, message] = RPC_ERRORS.ESTIMATE_BATCH_OPERATION_KEY_REQUIRED;
    throw new ApiError({ status, code: "ESTIMATE_BATCH_OPERATION_KEY_REQUIRED", message });
  }
  const operations = canonicalizeEstimateBatchOperations(z.array(batchOperationSchema).parse(incomingOperations));
  if (Buffer.byteLength(JSON.stringify({ operations, operation_key: operationKey, concurrency_token: concurrencyToken }), "utf8") > ESTIMATE_BATCH_MAX_BODY_BYTES) {
    throw new ApiError({ status: 413, code: "ESTIMATE_BATCH_PAYLOAD_TOO_LARGE", message: "Le batch dépasse la limite de 1 Mio." });
  }
  versionId = uuid.parse(versionId).toLowerCase();
  const context = await getAuthenticatedContext();
  assertCanWriteEstimateWorkflows(context.tenantRole);
  if (!options.dryRun && operationKey) {
    const saved = await lookupReceipt(context, versionId, operationKey);
    if (saved) {
      if (!sameEstimateBatchTimestamp(saved.receipt.expected_updated_at, concurrencyToken) ||
        JSON.stringify(canonicalizeEstimateBatchOperations(saved.receipt.operations)) !== JSON.stringify(operations)) {
        throw conflict("Cette clé correspond à une autre demande.", undefined, "ESTIMATE_BATCH_IDEMPOTENCY_CONFLICT");
      }
      // GET has read permissions; POST must recheck writer permissions under the
      // SQL actor gate even when membership changed after our initial TS check.
      let replay;
      try {
        replay = await context.supabase.rpc("commit_estimate_batch", {
          p_version_id: versionId, p_operation_key: operationKey, p_expected_updated_at: concurrencyToken,
          p_draft_lock_session_id: null, p_operations: operations as Json,
          p_created_ids: [], p_item_updates: [], p_version_patch: {},
          p_calculation_context: {}, p_expected_aid_policy: null,
        });
      } catch { throw outcomeUnknown(); }
      if (replay.error) throw rpcError(replay.error, true);
      if (Buffer.byteLength(JSON.stringify(replay.data), "utf8") > ESTIMATE_BATCH_MAX_RECEIPT_BYTES) throw outcomeUnknown();
      const confirmed = parseCommitted(replay.data, { versionId, operationKey, actorId: context.userId });
      if (!confirmed.replayed || JSON.stringify(confirmed.receipt) !== JSON.stringify(saved.receipt) ||
        JSON.stringify(confirmed.results) !== JSON.stringify(saved.results) ||
        JSON.stringify(confirmed.totals) !== JSON.stringify(saved.totals) ||
        !sameEstimateBatchTimestamp(confirmed.version.updated_at, saved.version.updated_at)) throw outcomeUnknown();
      return confirmed;
    }
  }
  const { version, project } = await getVersionAccessOrThrow(context.supabase, versionId, context);
  assertDraftStatus(version.status);
  if (project.is_archived) throw conflict("Cette affaire est archivée.");
  if (!sameEstimateBatchTimestamp(version.updated_at, concurrencyToken)) {
    throw conflict("Le devis a changé. Rechargez avant de réessayer.", undefined, "VERSION_CONFLICT");
  }
  const lock = await assertDraftLockOwnedByCurrentUser({ supabase: context.supabase,
    tenantId: context.tenantId, versionId, userId: context.userId });
  if (!lock.session_id) throw conflict("Un verrou actif de cette page est requis.", undefined, "LOCK_REQUIRED");
  const initialVersion = { id: versionId, updated_at: version.updated_at };
  let prepared;
  try {
    prepared = await prepareEstimateBatch({ context, versionId, projectUserId: project.user_id,
      expectedUpdatedAt: version.updated_at, operations, createdIds: options.createdIds });
  } catch (error) {
    if (!(error instanceof EstimateBatchPreparationError)) throw error;
    return { committed: false, version: initialVersion, results: [
      ...operations.slice(0, error.index).map((operation, index) => ({
        index, op: operation.op, status: "ok" as const, data: { rolled_back: true },
      })),
      { index: error.index, op: error.operation, status: "error", code: error.failure.code, message: error.failure.message },
    ] };
  }
  if (options.dryRun) return { committed: false, version: initialVersion,
    results: operations.map((operation, index) => ({ index, op: operation.op, status: "ok", data: { dry_run: true } })) };
  let response;
  try {
    response = await context.supabase.rpc("commit_estimate_batch", {
      p_version_id: versionId, p_operation_key: operationKey!, p_expected_updated_at: concurrencyToken,
      p_draft_lock_session_id: lock.session_id, p_operations: operations as Json,
      p_created_ids: prepared.createdIds as Json, p_item_updates: prepared.itemUpdates,
      p_version_patch: prepared.versionPatch, p_calculation_context: prepared.calculationContext as Json,
      p_expected_aid_policy: prepared.expectedAidPolicy,
    });
  } catch { throw outcomeUnknown(); }
  if (response.error) throw rpcError(response.error, true);
  if (Buffer.byteLength(JSON.stringify(response.data), "utf8") > ESTIMATE_BATCH_MAX_RECEIPT_BYTES) throw outcomeUnknown();
  if (record(response.data) && response.data.committed === false) {
    const parsed = refusedResultSchema.safeParse(response.data);
    if (!parsed.success || parsed.data.version.id !== versionId || parsed.data.results.length > operations.length) throw outcomeUnknown();
    const results = parsed.data.results;
    if (results.some((entry, index) => entry.index !== index || entry.op !== operations[index].op ||
      (index === results.length - 1 ? entry.status !== "error" : entry.status !== "ok" ||
        !record(entry.data) || entry.data.rolled_back !== true))) throw outcomeUnknown();
    return parsed.data;
  }
  const saved = parseCommitted(response.data, { versionId, operationKey: operationKey!, actorId: context.userId });
  if (!sameEstimateBatchTimestamp(saved.receipt.expected_updated_at, concurrencyToken) ||
    JSON.stringify(canonicalizeEstimateBatchOperations(saved.receipt.operations)) !== JSON.stringify(operations)) throw outcomeUnknown();
  return saved;
}
