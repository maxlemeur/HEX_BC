import { z } from "zod";

import { TAKEOFF_JOB_STATUSES, TAKEOFF_LEVELS } from "@/lib/takeoff/enums";
import { takeoffPreviewConversionResponseSchema } from "@/lib/takeoff/schemas";
import {
  assertTakeoffResponseIdentity, parseTakeoffResponse, sameTakeoffResponseId, uniqueTakeoffResponseIds,
  takeoffResponseCountSchema as count, takeoffResponseTimestampSchema as timestamp, takeoffResponseUuidSchema as uuid,
} from "@/lib/takeoff/response-contracts";

export const takeoffJobSummaryResponseSchema = z.object({
  id: uuid, estimate_version_id: uuid, status: z.enum(TAKEOFF_JOB_STATUSES), level: z.enum(TAKEOFF_LEVELS),
  processing_strategy: z.enum(["sync", "batch"]).nullable(), provider_batch_id: z.string().nullable(),
  provider_batch_state: z.enum(["submitted", "pending", "running", "succeeded", "failed", "cancelled", "expired", "unknown"]).nullable(),
  provider_batch_updated_at: timestamp.nullable(), source_file_name: z.string().nullable(), source_file_type: z.string().nullable(),
  source_file_size_bytes: count.nullable(), plan_set_id: uuid.nullable().optional(),
  prompt_version: z.string().nullable(), schema_version: z.string().nullable(), model: z.string().nullable(),
  thinking_level: z.string().nullable(), media_resolution: z.string().nullable(), retry_count: count,
  error_code: z.string().nullable(), error_message: z.string().nullable(), next_retry_at: timestamp.nullable(), last_error_at: timestamp.nullable(),
  dispatch_status: z.enum(["started", "queued", "trigger_failed"]).nullable().optional(),
  dispatch_outcome: z.enum(["accepted", "configuration_missing", "http_error", "timeout", "network_error"]).nullable().optional(),
  dispatch_trigger: z.enum(["create", "retry", "manual", "reconcile"]).nullable().optional(),
  dispatch_correlation_id: uuid.nullable().optional(), dispatch_status_code: z.number().int().min(100).max(599).nullable().optional(),
  dispatch_updated_at: timestamp.nullable().optional(), provider_reconcile_due_at: timestamp.nullable().optional(),
  provider_reconcile_attempt_count: count.optional(), provider_reconcile_lease_expires_at: timestamp.nullable().optional(),
  operator_state: z.enum(["none", "submitted_to_provider", "awaiting_provider_result", "provider_failed", "orphan_to_reconcile"]).nullable().optional(),
  operator_state_label: z.string().nullable().optional(), can_reconcile: z.boolean().optional(), can_cancel: z.boolean().optional(), can_resubmit: z.boolean().optional(),
  started_at: timestamp.nullable(), completed_at: timestamp.nullable(), created_at: timestamp, updated_at: timestamp,
  items_count: count.nullable().optional(), version_number: z.number().int().positive().nullable().optional(),
  metrics: z.object({ token_count: count.nullable(), cost_cents: count.nullable(), duration_ms: count.nullable() }),
});

export const takeoffApplySummarySchema = z.object({
  scope: z.enum(["section", "version"]), created_count: count, updated_count: count, ignored_count: count,
  created_ids: z.array(uuid), item_links: z.array(z.object({ takeoff_item_id: uuid, estimate_item_id: uuid })),
}).superRefine((summary, context) => {
  // Older RPCs may omit detailed IDs/links; the normalizer returns empty arrays.
  // Counts may also include generated assembly rows, beyond source-item links.
  if (summary.created_ids.length > summary.created_count || summary.item_links.length > summary.created_count + summary.updated_count
    || !uniqueTakeoffResponseIds(summary.created_ids) || !uniqueTakeoffResponseIds(summary.item_links.map((link) => link.takeoff_item_id))
    || !uniqueTakeoffResponseIds(summary.item_links.map((link) => link.estimate_item_id))) {
    context.addIssue({ code: "custom", message: "Compteurs ou identifiants d'application incohérents." });
  }
});
export const takeoffApplyResponseSchema = z.object({ job: takeoffJobSummaryResponseSchema, summary: takeoffApplySummarySchema })
  .refine((response) => response.job.status === "applied", "L'application doit confirmer le statut applied.");

export const takeoffPreviewConversionResultSchema = takeoffPreviewConversionResponseSchema.superRefine((response, context) => {
  const { items, summary } = response;
  const expected = {
    total_count: items.length,
    included_count: items.filter((item) => !item.original.is_excluded).length,
    transformed_count: items.filter((item) => item.action !== "none" && !item.original.is_excluded).length,
    overridden_count: items.filter((item) => item.applied_by === "override" && !item.original.is_excluded).length,
    excluded_by_mapping_count: items.filter((item) => !item.original.is_excluded && item.transformed.is_excluded
      && (item.action === "skip" || item.action === "apply_assembly")).length,
    assembly_insertions_count: items.filter((item) => !item.original.is_excluded && item.action === "apply_assembly").length,
  };
  if (!uniqueTakeoffResponseIds(items.map((item) => item.item_id)) || items.some((item, index) => item.source_order !== index)
    || (Object.keys(expected) as Array<keyof typeof expected>).some((key) => summary[key] !== expected[key])) {
    context.addIssue({ code: "custom", message: "Ordre, identifiants ou compteurs de prévisualisation incohérents." });
  }
});

export type TakeoffApplySummary = z.infer<typeof takeoffApplySummarySchema>;
export type TakeoffApplyResponse = z.infer<typeof takeoffApplyResponseSchema>;
export type TakeoffJobSummary = z.infer<typeof takeoffJobSummaryResponseSchema>;
export type TakeoffJobMetrics = TakeoffJobSummary["metrics"];

export function parseTakeoffApplyResponse(payload: unknown, identity: { jobId: string; versionId?: string; targetSectionId?: string | null }) {
  const response = parseTakeoffResponse(takeoffApplyResponseSchema, payload);
  assertTakeoffResponseIdentity(sameTakeoffResponseId(response.job.id, identity.jobId)
    && (!identity.versionId || sameTakeoffResponseId(response.job.estimate_version_id, identity.versionId))
    && response.summary.scope === (identity.targetSectionId ? "section" : "version"));
  return response;
}

export function parseTakeoffPreviewConversionResponse(payload: unknown, identity: {
  jobId: string; strategy: "append" | "replace" | "merge"; targetSectionId?: string | null;
}) {
  const response = parseTakeoffResponse(takeoffPreviewConversionResultSchema, payload);
  const target = identity.targetSectionId ?? null;
  assertTakeoffResponseIdentity(sameTakeoffResponseId(response.job_id, identity.jobId) && response.strategy === identity.strategy
    && (target === null ? response.target_section_id === null
      : response.target_section_id !== null && sameTakeoffResponseId(response.target_section_id, target)));
  return response;
}
