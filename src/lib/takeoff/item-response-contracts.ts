import { z } from "zod";

import {
  assertTakeoffResponseIdentity, parseTakeoffResponse, sameTakeoffResponseId,
  takeoffResponseConfidenceSchema as confidence, takeoffResponseCountSchema as count,
  takeoffResponseMetadataSchema as metadata, takeoffResponseTimestampSchema as timestamp,
  takeoffResponseUuidSchema as uuid,
} from "@/lib/takeoff/response-contracts";

export const takeoffJobItemResponseSchema = z.object({
  id: uuid, designation: z.string(), quantity: z.number().finite().positive(), unit: z.string(),
  confidence: confidence.nullable(), evidence: z.string().nullable(), source_file_name: z.string().nullable(),
  source_page: z.number().int().positive().nullable(), metadata,
  is_excluded: z.boolean(), exclusion_reason: z.string().nullable(), is_verified: z.boolean(),
  verified_at: timestamp.nullable(), verified_by: uuid.nullable(), created_at: timestamp, updated_at: timestamp,
});

export const takeoffItemPatchResultSchema = z.discriminatedUnion("success", [
  z.object({ item_id: uuid, success: z.literal(true), item: takeoffJobItemResponseSchema, error: z.never().optional() }),
  z.object({ item_id: uuid, success: z.literal(false), error: z.string().min(1), item: z.never().optional() }),
]).superRefine((result, context) => {
  if (result.success && !sameTakeoffResponseId(result.item_id, result.item.id)) {
    context.addIssue({ code: "custom", path: ["item", "id"], message: "La ligne confirmée ne correspond pas au résultat." });
  }
});

export const takeoffItemBatchPatchResponseSchema = z.object({
  results: z.array(takeoffItemPatchResultSchema).min(1).max(100), succeeded: count, failed: count,
}).superRefine((response, context) => {
  if (response.succeeded !== response.results.filter((result) => result.success).length
    || response.failed !== response.results.filter((result) => !result.success).length) {
    context.addIssue({ code: "custom", message: "Les compteurs de modifications partielles sont incohérents." });
  }
});

export type TakeoffItemPatchResult = z.infer<typeof takeoffItemPatchResultSchema>;
export type TakeoffJobItem = z.infer<typeof takeoffJobItemResponseSchema>;
export type TakeoffItemBatchPatchResponse = z.infer<typeof takeoffItemBatchPatchResponseSchema>;

export function parseTakeoffItemBatchPatchResponse(payload: unknown, itemIds: string[]): TakeoffItemBatchPatchResponse {
  const response = parseTakeoffResponse(takeoffItemBatchPatchResponseSchema, payload);
  // Repeated IDs are legitimate: the producer processes each request entry in order.
  assertTakeoffResponseIdentity(response.results.length === itemIds.length
    && response.results.every((result, index) => sameTakeoffResponseId(result.item_id, itemIds[index])));
  return response;
}
