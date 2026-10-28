import { z } from "zod";

import { TAKEOFF_COMPARE_DEFAULT_THRESHOLD } from "@/lib/takeoff/diff";
import { TAKEOFF_COMPARE_MAX_THRESHOLD, TAKEOFF_COMPARE_MIN_THRESHOLD } from "@/lib/takeoff/limits";
import { takeoffJobItemResponseSchema } from "@/lib/takeoff/item-response-contracts";
import {
  assertTakeoffResponseIdentity, parseTakeoffResponse, sameTakeoffResponseId, uniqueTakeoffResponseIds,
  takeoffResponseConfidenceSchema as score, takeoffResponseCountSchema as count, takeoffResponseUuidSchema as uuid,
} from "@/lib/takeoff/response-contracts";

export const takeoffDiffFieldSchema = z.object({
  field: z.enum(["designation", "quantity", "unit", "source_page", "confidence", "evidence"]), label: z.string(),
  kind: z.enum(["text", "number"]), before_value: z.union([z.string(), z.number().finite(), z.null()]),
  after_value: z.union([z.string(), z.number().finite(), z.null()]),
}).superRefine((delta, context) => {
  const numeric = ["quantity", "source_page", "confidence"].includes(delta.field);
  if (delta.kind !== (numeric ? "number" : "text") || [delta.before_value, delta.after_value]
    .some((value) => value !== null && typeof value !== (numeric ? "number" : "string"))) {
    context.addIssue({ code: "custom", message: "Type de différence incohérent." });
  }
});
const matched = {
  key: z.string().min(1), base_item: takeoffJobItemResponseSchema, other_item: takeoffJobItemResponseSchema,
  match_score: score, match_strategy: z.enum(["designation_fuzzy", "designation_plus_page_fuzzy"]),
};
export const takeoffDiffAddedEntrySchema = z.object({ key: z.string().min(1), change_type: z.literal("added"), other_item: takeoffJobItemResponseSchema });
export const takeoffDiffRemovedEntrySchema = z.object({ key: z.string().min(1), change_type: z.literal("removed"), base_item: takeoffJobItemResponseSchema });
export const takeoffDiffChangedEntrySchema = z.object({ ...matched, change_type: z.literal("changed"), delta: z.array(takeoffDiffFieldSchema).min(1) })
  .refine((entry) => new Set(entry.delta.map((delta) => delta.field)).size === entry.delta.length, "Champ de différence dupliqué.");
export const takeoffDiffUnchangedEntrySchema = z.object({ ...matched, change_type: z.literal("unchanged") });
export const takeoffJobCompareSummarySchema = z.object({ added: count, removed: count, changed: count, unchanged: count, total_base: count, total_other: count });
export const takeoffJobCompareResponseSchema = z.object({
  base_job_id: uuid, other_job_id: uuid, threshold: z.number().finite().min(TAKEOFF_COMPARE_MIN_THRESHOLD).max(TAKEOFF_COMPARE_MAX_THRESHOLD),
  summary: takeoffJobCompareSummarySchema, added: z.array(takeoffDiffAddedEntrySchema), removed: z.array(takeoffDiffRemovedEntrySchema),
  changed: z.array(takeoffDiffChangedEntrySchema), unchanged: z.array(takeoffDiffUnchangedEntrySchema),
}).superRefine((response, context) => {
  const { summary, added, removed, changed, unchanged } = response;
  const baseIds = [...removed, ...changed, ...unchanged].map((entry) => entry.base_item.id);
  const otherIds = [...added, ...changed, ...unchanged].map((entry) => entry.other_item.id);
  if (sameTakeoffResponseId(response.base_job_id, response.other_job_id)
    || summary.added !== added.length || summary.removed !== removed.length || summary.changed !== changed.length
    || summary.unchanged !== unchanged.length || summary.total_base !== baseIds.length || summary.total_other !== otherIds.length
    || !uniqueTakeoffResponseIds(baseIds) || !uniqueTakeoffResponseIds(otherIds)
    || new Set([...added, ...removed, ...changed, ...unchanged].map((entry) => entry.key)).size !== added.length + removed.length + changed.length + unchanged.length) {
    context.addIssue({ code: "custom", message: "Identités ou compteurs de comparaison incohérents." });
  }
});
export type TakeoffJobCompareResponse = z.infer<typeof takeoffJobCompareResponseSchema>;
export type TakeoffJobCompareSummary = z.infer<typeof takeoffJobCompareSummarySchema>;
export type TakeoffDiffField = z.infer<typeof takeoffDiffFieldSchema>;
export type TakeoffDiffAddedEntry = z.infer<typeof takeoffDiffAddedEntrySchema>;
export type TakeoffDiffRemovedEntry = z.infer<typeof takeoffDiffRemovedEntrySchema>;
export type TakeoffDiffChangedEntry = z.infer<typeof takeoffDiffChangedEntrySchema>;
export type TakeoffDiffUnchangedEntry = z.infer<typeof takeoffDiffUnchangedEntrySchema>;

export function parseTakeoffJobCompareResponse(payload: unknown, identity: { jobId: string; withJobId: string; threshold?: number }) {
  const response = parseTakeoffResponse(takeoffJobCompareResponseSchema, payload);
  const threshold = Number.isFinite(identity.threshold)
    ? Number(Math.min(TAKEOFF_COMPARE_MAX_THRESHOLD, Math.max(TAKEOFF_COMPARE_MIN_THRESHOLD, identity.threshold!)).toFixed(2))
    : TAKEOFF_COMPARE_DEFAULT_THRESHOLD;
  assertTakeoffResponseIdentity(sameTakeoffResponseId(response.base_job_id, identity.jobId)
    && sameTakeoffResponseId(response.other_job_id, identity.withJobId) && response.threshold === threshold);
  return response;
}
