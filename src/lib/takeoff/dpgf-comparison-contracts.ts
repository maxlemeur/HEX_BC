import { z } from "zod";

import {
  TAKEOFF_COMPARE_MAX_THRESHOLD,
  TAKEOFF_COMPARE_MIN_THRESHOLD,
  TAKEOFF_DPGF_COMPARE_MAX_PAGE_SIZE,
} from "@/lib/takeoff/limits";

const uuid = z.string().uuid();
const count = z.number().int().nonnegative().refine(Number.isSafeInteger);
const finite = z.number().finite();
const quantity = finite.nonnegative();
const score = finite.min(0).max(1);
const page = z.number().int().positive().nullable();
const timestamp = z.string().refine((value) => Number.isFinite(Date.parse(value)));
const nonempty = z.string().refine((value) => value.trim().length > 0);
const sameUuid = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
const unique = (ids: string[]) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length;

export const takeoffDpgfComparisonViewSchema = z.enum(["all", "exceptions_only"]);
export const takeoffDpgfComparisonEvidenceKindSchema = z.enum(["fact", "hypothesis", "inference"]);
export const takeoffDpgfComparisonEvidenceTypeSchema = z.enum(["dpgf", "takeoff", "plan_zone", "formula", "price_source", "comment"]);
export const takeoffDpgfReviewStatusSchema = z.enum(["reliable_match", "to_confirm", "significant_gap", "unlinked", "forced_manual"]);
export const takeoffDpgfReviewDecisionSchema = z.enum(["keep_dpgf", "keep_takeoff", "manual_fix", "out_of_scope"]);

export const takeoffDpgfComparisonDpgfLineSchema = z.object({
  estimate_item_id: uuid, title: z.string(), description: z.string().nullable(), quantity,
  unit: z.string().nullable(), source_page: page, source_file_name: z.string().nullable(), position: count,
});

export const takeoffDpgfComparisonTakeoffLineSchema = z.object({
  item_id: uuid, designation: z.string(), quantity, unit: z.string(), source_page: page,
  source_file_name: z.string().nullable(), confidence: score.nullable(), evidence: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
});

export const takeoffDpgfComparisonProofSchema = z.object({
  // Before evidence persistence, the comparison engine emits stable compound IDs.
  proof_id: nonempty, type: takeoffDpgfComparisonEvidenceTypeSchema, kind: takeoffDpgfComparisonEvidenceKindSchema,
  label: z.string(), source: z.string(), confidence_score: score.nullable(), note: z.string().nullable(),
});

export const takeoffDpgfReviewDecisionRecordSchema = z.object({
  id: uuid, tenant_id: uuid, version_id: uuid, takeoff_job_id: uuid, estimate_item_id: uuid,
  decision: takeoffDpgfReviewDecisionSchema, reason: z.string().nullable(), review_reference: nonempty,
  line_label: z.string(), line_position: count, source_file_name: z.string().nullable(), source_page: page,
  decided_at: timestamp, updated_at: timestamp, decided_by: uuid.nullable(),
  source: z.enum(["current_version", "carried_over"]), carried_over_from_version_id: uuid.nullable(),
  carried_over_from_version_number: z.number().int().positive().nullable(),
}).superRefine((decision, context) => {
  if (decision.source === "current_version"
    ? decision.carried_over_from_version_id !== null || decision.carried_over_from_version_number !== null
    : decision.carried_over_from_version_id === null) {
    context.addIssue({ code: "custom", path: ["source"], message: "Provenance de décision incohérente." });
  }
});

export const takeoffDpgfComparisonUnusedTakeoffItemSchema = z.object({
  item_id: uuid, designation: z.string(), quantity, unit: z.string(), source_file_name: z.string().nullable(),
  source_page: page, confidence_score: score.nullable(), evidence: z.string().nullable(),
});

export const takeoffDpgfLineRiskSummarySchema = z.object({
  score: finite.min(0).max(100), severity: z.enum(["info", "warning", "critical"]),
  causes: z.array(z.string()), status: z.enum(["to_process", "assumed", "false_positive"]).nullable(),
});

export const takeoffDpgfComparisonRowSchema = z.object({
  line_id: uuid, line_label: z.string(), dpgf: takeoffDpgfComparisonDpgfLineSchema,
  linked_takeoff_items: z.array(takeoffDpgfComparisonTakeoffLineSchema), dpgf_quantity: quantity.nullable(),
  takeoff_quantity: quantity.nullable(), quantity_unit: z.string().nullable(), matching_score: score, confidence_score: score,
  review_status: takeoffDpgfReviewStatusSchema, proofs: z.array(takeoffDpgfComparisonProofSchema),
  suggested_decision: takeoffDpgfReviewDecisionSchema.nullable(), applied_decision: takeoffDpgfReviewDecisionRecordSchema.nullable(),
  delta_absolute: quantity.nullable(), delta_percent: quantity.nullable(), is_exception: z.boolean(), manual_link_count: count,
  matched_by: z.enum(["auto", "manual"]).nullable(), risk: takeoffDpgfLineRiskSummarySchema.nullable(),
}).superRefine((row, context) => {
  if (!sameUuid(row.line_id, row.dpgf.estimate_item_id)) {
    context.addIssue({ code: "custom", path: ["dpgf", "estimate_item_id"], message: "Identité de ligne incohérente." });
  }
  if (!unique(row.linked_takeoff_items.map((item) => item.item_id)) || !unique(row.proofs.map((proof) => proof.proof_id))) {
    context.addIssue({ code: "custom", message: "Identifiants de liens ou preuves dupliqués." });
  }
  if (row.manual_link_count > 0
    ? row.matched_by !== "manual" || row.linked_takeoff_items.length === 0 || row.manual_link_count < row.linked_takeoff_items.length
    : row.matched_by !== (row.linked_takeoff_items.length > 0 ? "auto" : null)) {
    context.addIssue({ code: "custom", path: ["manual_link_count"], message: "Compteur de liens incohérent." });
  }
});

export const takeoffDpgfComparisonSummarySchema = z.object({
  reliable_matches: count, to_confirm: count, significant_gaps: count, forced_manual: count,
  lines_without_proof: count, unused_takeoff_items: count, total_lines: count,
}).superRefine((summary, context) => {
  if (summary.reliable_matches + summary.to_confirm + summary.significant_gaps + summary.forced_manual > summary.total_lines
    || summary.lines_without_proof > summary.total_lines) {
    context.addIssue({ code: "custom", message: "Compteurs de comparaison incohérents." });
  }
});

export const takeoffDpgfComparisonResponseSchema = z.object({
  version_id: uuid, job_id: uuid, view: takeoffDpgfComparisonViewSchema,
  threshold: finite.min(TAKEOFF_COMPARE_MIN_THRESHOLD).max(TAKEOFF_COMPARE_MAX_THRESHOLD),
  summary: takeoffDpgfComparisonSummarySchema, rows: z.array(takeoffDpgfComparisonRowSchema),
  manual_link_candidates: z.array(takeoffDpgfComparisonUnusedTakeoffItemSchema),
  unused_takeoff_items: z.array(takeoffDpgfComparisonUnusedTakeoffItemSchema),
  pagination: z.object({
    page_size: z.number().int().min(1).max(TAKEOFF_DPGF_COMPARE_MAX_PAGE_SIZE),
    // Cursor contents belong to the producer; clients only preserve and compare them.
    next_cursor: nonempty.nullable(), total: count,
  }),
}).superRefine((response, context) => {
  const { rows, summary, pagination } = response;
  const candidateIds = new Set(response.manual_link_candidates.map((item) => item.item_id.toLowerCase()));
  const unusedIds = new Set(response.unused_takeoff_items.map((item) => item.item_id.toLowerCase()));
  if (!unique(rows.map((row) => row.line_id)) || candidateIds.size !== response.manual_link_candidates.length
    || unusedIds.size !== response.unused_takeoff_items.length) {
    context.addIssue({ code: "custom", message: "Identifiants de comparaison dupliqués." });
  }
  if (summary.unused_takeoff_items !== response.unused_takeoff_items.length
    || response.unused_takeoff_items.some((item) => !candidateIds.has(item.item_id.toLowerCase()))) {
    context.addIssue({ code: "custom", path: ["unused_takeoff_items"], message: "Candidats inutilisés incohérents." });
  }
  if (rows.length > pagination.page_size || rows.length > pagination.total || pagination.total > summary.total_lines
    || (response.view === "all" && pagination.total !== summary.total_lines)
    || (pagination.next_cursor !== null && (rows.length === 0 || rows.length >= pagination.total))) {
    context.addIssue({ code: "custom", path: ["pagination"], message: "Pagination de comparaison incohérente." });
  }
  rows.forEach((row, index) => {
    const decision = row.applied_decision;
    if (row.linked_takeoff_items.some((item) => !candidateIds.has(item.item_id.toLowerCase()) || unusedIds.has(item.item_id.toLowerCase()))) {
      context.addIssue({ code: "custom", path: ["rows", index, "linked_takeoff_items"], message: "Candidat lié incohérent." });
    }
    if (response.view === "exceptions_only" && !row.is_exception) {
      context.addIssue({ code: "custom", path: ["rows", index, "is_exception"], message: "Ligne hors de la vue demandée." });
    }
    // A carried decision may still identify its original version and original line,
    // or have been persisted on the new version while retaining that provenance.
    if (decision && (!sameUuid(decision.takeoff_job_id, response.job_id)
      || (decision.source === "current_version" && !sameUuid(decision.version_id, response.version_id))
      || (sameUuid(decision.version_id, response.version_id) && !sameUuid(decision.estimate_item_id, row.line_id)))) {
      context.addIssue({ code: "custom", path: ["rows", index, "applied_decision"], message: "Identité de décision incohérente." });
    }
  });
});

export type TakeoffDpgfComparisonView = z.infer<typeof takeoffDpgfComparisonViewSchema>;
export type TakeoffDpgfComparisonEvidenceKind = z.infer<typeof takeoffDpgfComparisonEvidenceKindSchema>;
export type TakeoffDpgfComparisonEvidenceType = z.infer<typeof takeoffDpgfComparisonEvidenceTypeSchema>;
export type TakeoffDpgfReviewStatus = z.infer<typeof takeoffDpgfReviewStatusSchema>;
export type TakeoffDpgfReviewDecision = z.infer<typeof takeoffDpgfReviewDecisionSchema>;
export type TakeoffDpgfComparisonDpgfLine = z.infer<typeof takeoffDpgfComparisonDpgfLineSchema>;
export type TakeoffDpgfComparisonTakeoffLine = z.infer<typeof takeoffDpgfComparisonTakeoffLineSchema>;
export type TakeoffDpgfComparisonProof = z.infer<typeof takeoffDpgfComparisonProofSchema>;
export type TakeoffDpgfReviewDecisionRecord = z.infer<typeof takeoffDpgfReviewDecisionRecordSchema>;
export type TakeoffDpgfComparisonUnusedTakeoffItem = z.infer<typeof takeoffDpgfComparisonUnusedTakeoffItemSchema>;
export type TakeoffDpgfLineRiskSummary = z.infer<typeof takeoffDpgfLineRiskSummarySchema>;
export type TakeoffDpgfComparisonRow = z.infer<typeof takeoffDpgfComparisonRowSchema>;
export type TakeoffDpgfComparisonSummary = z.infer<typeof takeoffDpgfComparisonSummarySchema>;
export type TakeoffDpgfComparisonResponse = z.infer<typeof takeoffDpgfComparisonResponseSchema>;

export function parseTakeoffDpgfComparisonResponse(payload: unknown, identity: {
  jobId: string; versionId: string; view?: TakeoffDpgfComparisonView; cursor?: string | null;
}): TakeoffDpgfComparisonResponse {
  const result = takeoffDpgfComparisonResponseSchema.safeParse(payload);
  if (!result.success || !sameUuid(result.data.job_id, identity.jobId) || !sameUuid(result.data.version_id, identity.versionId)
    || result.data.view !== (identity.view ?? "all")
    || (identity.cursor != null && result.data.pagination.next_cursor === identity.cursor)) {
    // Do not leak a ZodError to the HTTP request-error handler (which maps it to 400).
    throw new Error("La réponse de comparaison DPGF est invalide. Rechargez la comparaison avant toute nouvelle action.");
  }
  return result.data;
}
