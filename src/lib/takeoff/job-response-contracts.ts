import { z } from "zod";

import { takeoffJobSummaryResponseSchema } from "@/lib/takeoff/apply-response-contracts";
import { TAKEOFF_JOB_STATUSES, TAKEOFF_LEVELS } from "@/lib/takeoff/enums";
import { takeoffJobItemResponseSchema } from "@/lib/takeoff/item-response-contracts";
import { MAX_TAKEOFF_JOB_ITEMS_LIMIT, MAX_TAKEOFF_JOBS_LIST_LIMIT } from "@/lib/takeoff/schemas";
import {
  assertTakeoffResponseIdentity, parseTakeoffResponse, sameTakeoffResponseId, uniqueTakeoffResponseIds,
  takeoffResponseConfidenceSchema as confidence, takeoffResponseCountSchema as count,
  takeoffResponseMetadataSchema as metadata, takeoffResponseTimestampSchema as timestamp, takeoffResponseUuidSchema as uuid,
} from "@/lib/takeoff/response-contracts";

const status = z.enum(TAKEOFF_JOB_STATUSES);
const level = z.enum(TAKEOFF_LEVELS);
export const takeoffJobDispatchResponseSchema = z.object({
  status: z.enum(["accepted", "queued_for_recovery", "persistence_unconfirmed"]), correlation_id: uuid, persisted: z.boolean(),
}).refine((dispatch) => dispatch.status === "accepted" || dispatch.persisted === (dispatch.status === "queued_for_recovery"),
  "La persistance du déclenchement est incohérente.");
export const takeoffJobCreateResponseSchema = z.object({
  id: uuid, status, level, source_file_name: z.string().nullable(), estimate_version_id: uuid, created_at: timestamp,
  dispatch: takeoffJobDispatchResponseSchema.optional(),
});
const requiredOpaqueValue = z.unknown().refine((value): boolean => value !== undefined, "Champ de résultat manquant.");
export const takeoffJobResultResponseSchema = z.object({
  id: uuid, extracted_json: requiredOpaqueValue, warnings: z.array(z.unknown()), tables: z.array(z.unknown()),
  provider_meta: metadata, raw_response: requiredOpaqueValue, confidence: confidence.nullable(),
  token_count: count.nullable(), cost_cents: count.nullable(), duration_ms: count.nullable(), created_at: timestamp, updated_at: timestamp,
});
function paginationSchema(maximum: number) {
  return z.object({ limit: z.number().int().min(1).max(maximum), offset: count, total: count });
}
function validPageLength(size: number, pagination: { limit: number; offset: number; total: number }) {
  return size <= pagination.limit && size <= Math.max(0, pagination.total - pagination.offset);
}
export const takeoffJobDetailResponseSchema = z.object({
  job: takeoffJobSummaryResponseSchema, result: takeoffJobResultResponseSchema.nullable(),
  items: z.object({ data: z.array(takeoffJobItemResponseSchema), pagination: paginationSchema(MAX_TAKEOFF_JOB_ITEMS_LIMIT) }),
}).superRefine((response, context) => {
  if (!validPageLength(response.items.data.length, response.items.pagination)
    || !uniqueTakeoffResponseIds(response.items.data.map((item) => item.id))) {
    context.addIssue({ code: "custom", path: ["items"], message: "Items ou pagination de job incohérents." });
  }
});
export const takeoffJobStatusCountersSchema = z.object({ total: count, processing: count, completed: count, failed: count, canceled: count })
  .refine((counters) => counters.processing + counters.completed + counters.failed + counters.canceled <= counters.total,
    "Les compteurs dépassent le nombre de jobs.");
export const takeoffJobListResponseSchema = z.object({
  jobs: z.array(takeoffJobSummaryResponseSchema), counters: takeoffJobStatusCountersSchema,
  pagination: paginationSchema(MAX_TAKEOFF_JOBS_LIST_LIMIT),
}).superRefine((response, context) => {
  if (!validPageLength(response.jobs.length, response.pagination) || !uniqueTakeoffResponseIds(response.jobs.map((job) => job.id))
    || response.pagination.total > response.counters.total) {
    context.addIssue({ code: "custom", message: "Liste ou pagination de jobs incohérente." });
  }
});
export const takeoffJobActionResponseSchema = z.object({
  job: takeoffJobSummaryResponseSchema, command: z.enum(["retry", "cancel", "reconcile", "resubmit"]).optional(),
  outcome: z.enum(["applied", "noop"]).optional(), dispatch: takeoffJobDispatchResponseSchema.optional(),
}).refine((response) => response.outcome !== "noop" || response.dispatch === undefined,
  "Une action sans effet ne doit pas annoncer un déclenchement.");

export type TakeoffJobCreateResponse = z.infer<typeof takeoffJobCreateResponseSchema>;
export type TakeoffJobDispatch = z.infer<typeof takeoffJobDispatchResponseSchema>;
export type TakeoffJobResult = z.infer<typeof takeoffJobResultResponseSchema>;
export type TakeoffJobStatusCounters = z.infer<typeof takeoffJobStatusCountersSchema>;
export type TakeoffJobDetailResponse = z.infer<typeof takeoffJobDetailResponseSchema>;
export type TakeoffJobListResponse = z.infer<typeof takeoffJobListResponseSchema>;
export type TakeoffJobActionResponse = z.infer<typeof takeoffJobActionResponseSchema>;

export function parseTakeoffJobCreateResponse(payload: unknown, identity: { versionId: string; level: z.infer<typeof level> }) {
  const response = parseTakeoffResponse(takeoffJobCreateResponseSchema, payload);
  // An idempotent replay can return any already persisted job status.
  assertTakeoffResponseIdentity(sameTakeoffResponseId(response.estimate_version_id, identity.versionId) && response.level === identity.level);
  return response;
}

export function parseTakeoffJobDetailResponse(payload: unknown, identity: { jobId: string; itemsLimit?: number; itemsOffset?: number }) {
  const response = parseTakeoffResponse(takeoffJobDetailResponseSchema, payload);
  assertTakeoffResponseIdentity(sameTakeoffResponseId(response.job.id, identity.jobId)
    && response.items.pagination.limit === (identity.itemsLimit ?? 50) && response.items.pagination.offset === (identity.itemsOffset ?? 0));
  return response;
}

export function parseTakeoffJobListResponse(payload: unknown, query: {
  versionId?: string; status?: z.infer<typeof status>; level?: z.infer<typeof level>; limit?: number; offset?: number;
} = {}) {
  const response = parseTakeoffResponse(takeoffJobListResponseSchema, payload);
  // Status counters ignore the selected status and omit pending/applied buckets.
  // Project/period filters have no identifying receipt fields; do not invent them.
  assertTakeoffResponseIdentity(response.pagination.limit === (query.limit ?? 20) && response.pagination.offset === (query.offset ?? 0)
    && (query.status !== undefined || response.pagination.total === response.counters.total)
    && response.jobs.every((job) => (!query.versionId || sameTakeoffResponseId(job.estimate_version_id, query.versionId))
      && (!query.status || job.status === query.status) && (!query.level || job.level === query.level)));
  return response;
}

export function parseTakeoffJobActionResponse(payload: unknown, identity: {
  jobId: string; command: "retry" | "cancel" | "reconcile" | "resubmit";
}) {
  const response = parseTakeoffResponse(takeoffJobActionResponseSchema, payload);
  assertTakeoffResponseIdentity(sameTakeoffResponseId(response.job.id, identity.jobId)
    && (response.command === undefined || response.command === identity.command)
    && (identity.command === "reconcile" || response.outcome !== "noop")
    && (identity.command === "cancel" ? response.job.status === "canceled"
      : identity.command === "retry" || identity.command === "resubmit" ? response.job.status === "pending"
      : response.outcome !== "applied" || response.job.status === "processing"));
  return response;
}
