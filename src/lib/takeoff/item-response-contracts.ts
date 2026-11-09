import { verificationJustificationReadSchema } from "@/lib/takeoff/rules/verification";
import { z } from "zod";

import {
  assertTakeoffResponseIdentity, parseTakeoffResponse, sameTakeoffResponseId,
  takeoffResponseConfidenceSchema as confidence, takeoffResponseCountSchema as count,
  takeoffResponseMetadataSchema as metadata, takeoffResponseTimestampSchema as timestamp,
  takeoffResponseUuidSchema as uuid,
} from "@/lib/takeoff/response-contracts";
import { TakeoffRuleResultsSchema } from "@/lib/takeoff/rules/contracts";

export const takeoffJobItemResponseSchema = z.object({
  id: uuid, designation: z.string(), quantity: z.number().finite().positive(), unit: z.string(),
  confidence: confidence.nullable(), evidence: z.string().nullable(), source_file_name: z.string().nullable(),
  source_page: z.number().int().positive().nullable(), metadata,
  is_excluded: z.boolean(), exclusion_reason: z.string().nullable(), is_verified: z.boolean(),
  verified_at: timestamp.nullable(), verified_by: uuid.nullable(), created_at: timestamp, updated_at: timestamp,
  // Fixed rules (TI-664): their results, when they ran, whether a later edit left them to compute again, and who
  // typed the current quantity. Absent from an older answer: no rule read the line.
  // Read as stored, never with the write bounds (TI-686 D9): a note the Data API wrote does not make the job unreadable.
  verification_justification: verificationJustificationReadSchema.nullable().optional(),
  rule_results: TakeoffRuleResultsSchema.optional(),
  rules_evaluated_at: timestamp.nullable().optional(),
  rules_stale: z.boolean().optional(),
  quantity_entered_at: timestamp.nullable().optional(),
  quantity_entered_by: uuid.nullable().optional(),
});

export const takeoffItemPatchResultSchema = z.discriminatedUnion("success", [
  z.object({ item_id: uuid, success: z.literal(true), item: takeoffJobItemResponseSchema, error: z.never().optional() }),
  z.object({ item_id: uuid, success: z.literal(false), error: z.string().min(1), item: z.never().optional() }),
]).superRefine((result, context) => {
  if (result.success && !sameTakeoffResponseId(result.item_id, result.item.id)) {
    context.addIssue({ code: "custom", path: ["item", "id"], message: "La ligne confirmée ne correspond pas au résultat." });
  }
});

/** Rule states a PATCH answer carries at most; a job with more rule lines answers without them (TI-664 L5c). */
export const TAKEOFF_ITEM_RULE_STATES_MAX = 5000;

/**
 * The fixed rules' state of one line of the job, read after the PATCH's computation (or its failure): the results of
 * the job's other lines move with the saved one (two rooms of one page, a run on two zone pages of the same job, a
 * group's lines), so the review reads them again without reloading the job (TI-664 L5c). With the line's state and
 * its save as stored (TI-677 PR D: a partner the computation reopened, or whose failures grew, moved). The lines of the
 * version's other jobs are not sent: each review reads its own job.
 */
export const takeoffItemRuleStateSchema = takeoffJobItemResponseSchema.pick({
  designation: true, quantity: true, unit: true, source_page: true, is_excluded: true, exclusion_reason: true, is_verified: true,
  verified_at: true, verified_by: true, verification_justification: true, evidence: true, updated_at: true, quantity_entered_at: true, quantity_entered_by: true,
}).partial().extend({
  item_id: uuid, rule_results: TakeoffRuleResultsSchema, rules_evaluated_at: timestamp.nullable(), rules_stale: z.boolean(),
}).strict();

export const takeoffItemBatchPatchResponseSchema = z.object({
  results: z.array(takeoffItemPatchResultSchema).min(1).max(100), succeeded: count, failed: count,
  // Every line of the job the rules read (evaluated or stale), after the computation; absent when no rule reads the
  // version, or beyond TAKEOFF_ITEM_RULE_STATES_MAX lines.
  rule_states: z.array(takeoffItemRuleStateSchema).max(TAKEOFF_ITEM_RULE_STATES_MAX).optional(),
  rule_states_refresh_required: z.boolean().optional(),
}).superRefine((response, context) => {
  if (response.succeeded !== response.results.filter((result) => result.success).length
    || response.failed !== response.results.filter((result) => !result.success).length) {
    context.addIssue({ code: "custom", message: "Les compteurs de modifications partielles sont incohérents." });
  }
});

export type TakeoffItemPatchResult = z.infer<typeof takeoffItemPatchResultSchema>;
export type TakeoffJobItem = z.infer<typeof takeoffJobItemResponseSchema>;
export type TakeoffItemBatchPatchResponse = z.infer<typeof takeoffItemBatchPatchResponseSchema>;
export type TakeoffItemRuleState = z.infer<typeof takeoffItemRuleStateSchema>;

export function parseTakeoffItemBatchPatchResponse(payload: unknown, itemIds: string[]): TakeoffItemBatchPatchResponse {
  const response = parseTakeoffResponse(takeoffItemBatchPatchResponseSchema, payload);
  // Repeated IDs are legitimate: the producer processes each request entry in order.
  assertTakeoffResponseIdentity(response.results.length === itemIds.length
    && response.results.every((result, index) => sameTakeoffResponseId(result.item_id, itemIds[index])));
  return response;
}
