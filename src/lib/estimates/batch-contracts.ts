import { z } from "zod";

import { canonicalizeEstimateBatchOperations } from "@/lib/estimates/batch-request";
import { batchOperationSchema, type BatchOperationInput } from "@/lib/estimates/schemas";
import { ESTIMATE_STATUS_VALUES } from "@/lib/estimates/status";
import { isOlderEstimateVersionToken, sameEstimateVersionToken } from "@/lib/estimates/version-token";
import { ESTIMATE_LINE_PRICING_STATUSES } from "@/lib/units/normalize";

export const ESTIMATE_BATCH_MAX_OPERATIONS = 1000;
export const ESTIMATE_BATCH_MAX_BODY_BYTES = 1024 * 1024;
export const ESTIMATE_BATCH_MAX_RECEIPT_BYTES = 2 * 1024 * 1024;

const uuid = z.string().uuid();
const timestamp = z.string().refine((value) => Number.isFinite(Date.parse(value)));
const cents = z.number().int().nonnegative().refine(Number.isSafeInteger);

export const estimateBatchVersionTokenSchema = z.strictObject({
  id: uuid,
  updated_at: timestamp,
  content_revision: z.number().int().nonnegative().optional(),
});

export const estimateBatchTotalsSchema = z.strictObject({
  total_ht_cents: cents,
  total_tax_cents: cents,
  total_ttc_cents: cents,
}).refine((value) => value.total_ht_cents + value.total_tax_cents === value.total_ttc_cents);

const operationNameSchema = z.enum(["create", "update", "delete", "reorder"]);
export const estimateBatchOperationResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    index: z.number().int().nonnegative(),
    op: operationNameSchema,
    status: z.literal("ok"),
    data: z.unknown(),
  }),
  z.strictObject({
    index: z.number().int().nonnegative(),
    op: operationNameSchema,
    status: z.literal("error"),
    code: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
    message: z.string().min(1).max(1000),
    details: z.unknown().optional(),
  }),
]);

const resultsSchema = z.array(estimateBatchOperationResultSchema).min(1).max(ESTIMATE_BATCH_MAX_OPERATIONS);
export const estimateBatchCommittedResultSchema = z.strictObject({
  committed: z.literal(true),
  results: resultsSchema,
  version: estimateBatchVersionTokenSchema,
  totals: estimateBatchTotalsSchema,
  receipt: z.strictObject({
    operation_key: uuid,
    actor_id: uuid,
    version_id: uuid,
    expected_updated_at: timestamp,
    operations: z.array(batchOperationSchema).min(1).max(ESTIMATE_BATCH_MAX_OPERATIONS),
    committed_at: timestamp,
  }),
  replayed: z.boolean(),
  current_version: estimateBatchVersionTokenSchema.extend({ status: z.enum(ESTIMATE_STATUS_VALUES) }),
});

export const estimateBatchRefusedResultSchema = z.strictObject({
  committed: z.literal(false),
  results: resultsSchema,
  version: estimateBatchVersionTokenSchema,
});

export const estimateBatchResultSchema = z.discriminatedUnion("committed", [
  estimateBatchCommittedResultSchema,
  estimateBatchRefusedResultSchema,
]);

export type EstimateBatchOperationResult = z.infer<typeof estimateBatchOperationResultSchema>;
export type EstimateBatchCommittedResult = z.infer<typeof estimateBatchCommittedResultSchema>;
export type ExecuteEstimateBatchResult = z.infer<typeof estimateBatchResultSchema>;
export type EstimateBatchResponseContext = {
  versionId: string;
  actorId?: string;
  operationKey?: string;
  expectedUpdatedAt?: string;
  operations?: readonly BatchOperationInput[];
  dryRun?: boolean;
};

const itemIdentitySchema = z.object({
  id: uuid, version_id: uuid, item_type: z.enum(["line", "section"]),
});
// Validate stored inputs as well as the projection before acknowledging a line.
// Draft lines may have missing inputs; sections and historical engines retain their own semantics.
const savedLineSchema = z.object({
  quantity: z.number().nonnegative().nullable(),
  unit_price_ht_cents: cents.nullable(),
  pu_ht_cents: cents.nullable(),
  pricing_status: z.enum(ESTIMATE_LINE_PRICING_STATUSES).nullable().optional(),
  line_total_ht_cents: cents,
  line_tax_cents: cents,
  line_total_ttc_cents: cents,
}).refine((line) => line.line_total_ht_cents + line.line_tax_cents === line.line_total_ttc_cents)
  .refine((line) => line.pu_ht_cents !== null || (
    line.pricing_status != null && line.pricing_status !== "priced" &&
    line.line_total_ht_cents === 0 && line.line_tax_cents === 0 && line.line_total_ttc_cents === 0
  ));

export class EstimateBatchContractError extends Error {
  constructor() {
    super("Le reçu de sauvegarde ne correspond pas à la demande ou contient des données invalides.");
  }
}

function invalid(): never {
  throw new EstimateBatchContractError();
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateCommittedOperations(result: EstimateBatchCommittedResult) {
  const { operations } = result.receipt;
  if (result.results.length !== operations.length) invalid();
  const createdIds = new Set<string>();
  result.results.forEach((entry, index) => {
    const operation = operations[index];
    if (entry.index !== index || entry.op !== operation.op || entry.status !== "ok" || !record(entry.data)) invalid();
    if (operation.op === "create" || operation.op === "update") {
      let itemId: string;
      if (entry.data.item === null && entry.data.deleted_in_batch === true) {
        const deletedId = uuid.safeParse(entry.data.deleted_item_id);
        if (!deletedId.success) invalid();
        itemId = deletedId.data;
        const deletedLater = result.results.some((later, laterIndex) =>
          laterIndex > index && operations[laterIndex].op === "delete" &&
          later.op === "delete" && later.status === "ok" && record(later.data) &&
          Array.isArray(later.data.deleted_ids) && later.data.deleted_ids.includes(itemId));
        if (!deletedLater) invalid();
      } else {
        const parsed = itemIdentitySchema.safeParse(entry.data.item);
        if (!parsed.success || parsed.data.version_id !== result.version.id) invalid();
        const item = parsed.data;
        itemId = item.id;
        if (item.item_type === "line" && !savedLineSchema.safeParse(entry.data.item).success) invalid();
        if (operation.op === "create" && item.item_type !== operation.data.item_type) invalid();
      }
      if (operation.op === "update" && itemId !== operation.id) invalid();
      if (operation.op === "create") {
        if (createdIds.has(itemId)) invalid();
        createdIds.add(itemId);
      }
    } else if (operation.op === "delete") {
      const ids = z.array(uuid).min(1).safeParse(entry.data.deleted_ids);
      if (entry.data.deleted_id !== operation.id || !ids.success || !ids.data.includes(operation.id) ||
        new Set(ids.data).size !== ids.data.length) invalid();
    } else if (entry.data.parent_id !== (operation.data.parent_id ?? null) ||
      entry.data.updated_count !== operation.data.ordered_ids.length ||
      JSON.stringify(entry.data.ordered_ids) !== JSON.stringify(operation.data.ordered_ids)) invalid();
  });
}

/** Pure boundary shared by SQL responses, HTTP clients and receipt recovery. */
export function parseEstimateBatchResponse(value: unknown, context: EstimateBatchResponseContext): ExecuteEstimateBatchResult {
  const parsed = estimateBatchResultSchema.safeParse(value);
  if (!parsed.success) invalid();
  const result = parsed.data;
  if (result.version.id !== context.versionId) invalid();
  if (!result.committed) {
    const { operations, expectedUpdatedAt } = context;
    if (!operations || !expectedUpdatedAt || !sameEstimateVersionToken(result.version.updated_at, expectedUpdatedAt) ||
      result.results.length > operations.length) invalid();
    result.results.forEach((entry, index) => {
      if (entry.index !== index || entry.op !== operations[index].op) invalid();
      if (entry.status === "error") {
        if (index !== result.results.length - 1) invalid();
      } else if (!record(entry.data) || (entry.data.rolled_back !== true &&
        !(context.dryRun && entry.data.dry_run === true))) invalid();
    });
    if (!result.results.some((entry) => entry.status === "error") &&
      (!context.dryRun || result.results.length !== operations.length)) invalid();
    return result;
  }

  const receipt = result.receipt;
  if (context.dryRun || !context.actorId || !context.operationKey ||
    result.current_version.id !== context.versionId || receipt.version_id !== context.versionId ||
    receipt.actor_id !== context.actorId || receipt.operation_key !== context.operationKey ||
    isOlderEstimateVersionToken(result.current_version.updated_at, result.version.updated_at)) invalid();
  if (context.expectedUpdatedAt && !sameEstimateVersionToken(receipt.expected_updated_at, context.expectedUpdatedAt)) invalid();
  if (context.operations && JSON.stringify(canonicalizeEstimateBatchOperations(receipt.operations)) !==
    JSON.stringify(canonicalizeEstimateBatchOperations(context.operations))) invalid();
  validateCommittedOperations(result);
  return result;
}
