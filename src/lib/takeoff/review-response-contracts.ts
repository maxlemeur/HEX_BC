import { z } from "zod";

import { takeoffDpgfReviewDecisionRecordSchema } from "@/lib/takeoff/dpgf-comparison-contracts";
import {
  assertTakeoffResponseIdentity, parseTakeoffResponse, sameTakeoffResponseId, uniqueTakeoffResponseIds,
  takeoffResponseTimestampSchema as timestamp, takeoffResponseUuidSchema as uuid,
} from "@/lib/takeoff/response-contracts";

export const takeoffDpgfManualLinkRecordSchema = z.object({
  id: uuid, tenant_id: uuid, version_id: uuid, takeoff_job_id: uuid, estimate_item_id: uuid, takeoff_item_id: uuid,
  created_at: timestamp, updated_at: timestamp, linked_by: uuid.nullable(),
});
export const saveTakeoffDpgfManualLinkResponseSchema = z.object({
  links: z.array(takeoffDpgfManualLinkRecordSchema).max(50),
}).superRefine(({ links }, context) => {
  if (!uniqueTakeoffResponseIds(links.map((link) => link.id)) || !uniqueTakeoffResponseIds(links.map((link) => link.takeoff_item_id))
    || links.some((link) => !sameTakeoffResponseId(link.tenant_id, links[0].tenant_id))) {
    context.addIssue({ code: "custom", path: ["links"], message: "Les liens manuels sont dupliqués ou étrangers au tenant." });
  }
});
export const saveTakeoffReviewDecisionResponseSchema = z.object({ decision: takeoffDpgfReviewDecisionRecordSchema });
export type TakeoffDpgfManualLinkRecord = z.infer<typeof takeoffDpgfManualLinkRecordSchema>;
export type SaveTakeoffDpgfManualLinkResponse = z.infer<typeof saveTakeoffDpgfManualLinkResponseSchema>;
export type SaveTakeoffReviewDecisionResponse = z.infer<typeof saveTakeoffReviewDecisionResponseSchema>;

type ReviewIdentity = { jobId: string; versionId: string; lineId: string };

export function parseSaveTakeoffDpgfManualLinkResponse(payload: unknown, identity: ReviewIdentity & { itemIds: string[] }) {
  const response = parseTakeoffResponse(saveTakeoffDpgfManualLinkResponseSchema, payload);
  const expectedIds = new Set(identity.itemIds.map((id) => id.toLowerCase()));
  assertTakeoffResponseIdentity(response.links.length === expectedIds.size && response.links.every((link) =>
    sameTakeoffResponseId(link.version_id, identity.versionId) && sameTakeoffResponseId(link.takeoff_job_id, identity.jobId)
    && sameTakeoffResponseId(link.estimate_item_id, identity.lineId) && expectedIds.has(link.takeoff_item_id.toLowerCase())));
  return response;
}

export function parseSaveTakeoffReviewDecisionResponse(payload: unknown, identity: ReviewIdentity & {
  decision: z.infer<typeof takeoffDpgfReviewDecisionRecordSchema>["decision"]; reason?: string | null;
}) {
  const response = parseTakeoffResponse(saveTakeoffReviewDecisionResponseSchema, payload);
  const decision = response.decision;
  // Saving a carried decision writes the current line, while preserving its origin.
  assertTakeoffResponseIdentity(sameTakeoffResponseId(decision.takeoff_job_id, identity.jobId)
    && sameTakeoffResponseId(decision.version_id, identity.versionId) && sameTakeoffResponseId(decision.estimate_item_id, identity.lineId)
    && decision.decision === identity.decision && decision.reason === (identity.reason?.trim() || null));
  return response;
}
