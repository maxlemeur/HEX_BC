import { z } from "zod";

import { takeoffDpgfComparisonProofSchema, takeoffDpgfLineRiskSummarySchema } from "@/lib/takeoff/dpgf-comparison-contracts";
import {
  assertTakeoffResponseIdentity, parseTakeoffResponse, sameTakeoffResponseId, uniqueTakeoffResponseIds,
  takeoffResponseCountSchema as count, takeoffResponseMetadataSchema as metadata,
  takeoffResponseTimestampSchema as timestamp, takeoffResponseUuidSchema as uuid,
} from "@/lib/takeoff/response-contracts";

export const takeoffRiskSeveritySchema = takeoffDpgfLineRiskSummarySchema.shape.severity;
export const takeoffRiskStatusSchema = takeoffDpgfLineRiskSummarySchema.shape.status.unwrap();
export const takeoffRiskScopeTypeSchema = z.enum(["project", "lot", "line"]);
export const takeoffRiskMarginBucketSchema = z.enum(["negative", "thin", "healthy", "unknown"]);
export const takeoffRiskCauseCodeSchema = z.enum(["missing_proof", "dpgf_takeoff_gap", "atypical_price", "insufficient_margin", "vat_inconsistency", "missing_piece"]);
export const takeoffRiskProvenanceEntrySchema = takeoffDpgfComparisonProofSchema.omit({ proof_id: true, type: true });
export const takeoffRiskAlertSchema = z.object({
  alert_id: uuid, takeoff_job_id: uuid.nullable().optional(), scope_type: takeoffRiskScopeTypeSchema,
  scope_id: uuid.nullable(), scope_label: z.string(), line_id: uuid.nullable(), lot_id: uuid.nullable(),
  cause_code: takeoffRiskCauseCodeSchema, cause_label: z.string(), severity: takeoffRiskSeveritySchema,
  risk_score: takeoffDpgfLineRiskSummarySchema.shape.score, status: takeoffRiskStatusSchema,
  margin_bucket: takeoffRiskMarginBucketSchema, reason_labels: z.array(z.string()),
  provenance: z.array(takeoffRiskProvenanceEntrySchema), review_note: z.string().nullable(),
  reviewed_at: timestamp.nullable(), reviewed_by: uuid.nullable(), created_at: timestamp, updated_at: timestamp, metadata,
});
export const takeoffRiskRadarScopeSummarySchema = z.object({
  scope_type: z.enum(["project", "lot"]), scope_id: uuid.nullable(), scope_label: z.string(),
  score: takeoffDpgfLineRiskSummarySchema.shape.score, severity: takeoffRiskSeveritySchema,
  open_alerts_count: count, critical_alerts_count: count, top_causes: z.array(z.string()),
}).refine((scope) => scope.critical_alerts_count <= scope.open_alerts_count, "Compteurs de risque incohérents.");
export const takeoffRiskRadarSummarySchema = z.object({
  to_process_count: count, assumed_count: count, false_positive_count: count,
  critical_count: count, warning_count: count, info_count: count, top_causes: z.array(z.string()),
  project_score: takeoffDpgfLineRiskSummarySchema.shape.score, project_severity: takeoffRiskSeveritySchema,
});
export const takeoffRiskRadarResponseSchema = z.object({
  version_id: uuid, job_id: uuid, summary: takeoffRiskRadarSummarySchema,
  project: takeoffRiskRadarScopeSummarySchema, lots: z.array(takeoffRiskRadarScopeSummarySchema), items: z.array(takeoffRiskAlertSchema),
}).superRefine((response, context) => {
  const { summary, project, lots, items } = response;
  const total = summary.to_process_count + summary.assumed_count + summary.false_positive_count;
  if (total !== summary.critical_count + summary.warning_count + summary.info_count || items.length > total
    || project.scope_type !== "project" || project.score !== summary.project_score || project.severity !== summary.project_severity
    || project.open_alerts_count !== summary.to_process_count || lots.some((lot) => lot.scope_type !== "lot" || lot.scope_id === null)) {
    context.addIssue({ code: "custom", message: "Résumé du radar incohérent." });
  }
  if (!uniqueTakeoffResponseIds(items.map((item) => item.alert_id))
    || !uniqueTakeoffResponseIds(lots.flatMap((lot) => lot.scope_id ? [lot.scope_id] : []))) {
    context.addIssue({ code: "custom", message: "Alertes ou lots dupliqués." });
  }
  for (const status of takeoffRiskStatusSchema.options) {
    if (items.filter((item) => item.status === status).length > summary[`${status}_count`]) {
      context.addIssue({ code: "custom", path: ["summary"], message: "Compteur de statut incohérent." });
    }
  }
  for (const severity of takeoffRiskSeveritySchema.options) {
    if (items.filter((item) => item.severity === severity).length > summary[`${severity}_count`]) {
      context.addIssue({ code: "custom", path: ["summary"], message: "Compteur de gravité incohérent." });
    }
  }
});
export const updateTakeoffRiskAlertStatusResponseSchema = z.object({ alert: takeoffRiskAlertSchema });
export type TakeoffRiskAlert = z.infer<typeof takeoffRiskAlertSchema>;
export type TakeoffRiskSeverity = z.infer<typeof takeoffRiskSeveritySchema>;
export type TakeoffRiskStatus = z.infer<typeof takeoffRiskStatusSchema>;
export type TakeoffRiskScopeType = z.infer<typeof takeoffRiskScopeTypeSchema>;
export type TakeoffRiskMarginBucket = z.infer<typeof takeoffRiskMarginBucketSchema>;
export type TakeoffRiskCauseCode = z.infer<typeof takeoffRiskCauseCodeSchema>;
export type TakeoffRiskProvenanceEntry = z.infer<typeof takeoffRiskProvenanceEntrySchema>;
export type TakeoffRiskRadarScopeSummary = z.infer<typeof takeoffRiskRadarScopeSummarySchema>;
export type TakeoffRiskRadarSummary = z.infer<typeof takeoffRiskRadarSummarySchema>;
export type TakeoffRiskRadarResponse = z.infer<typeof takeoffRiskRadarResponseSchema>;
export type UpdateTakeoffRiskAlertStatusResponse = z.infer<typeof updateTakeoffRiskAlertStatusResponseSchema>;

export function parseTakeoffRiskRadarResponse(payload: unknown, identity: {
  jobId: string; versionId: string; severity?: z.infer<typeof takeoffRiskSeveritySchema> | null;
  status?: z.infer<typeof takeoffRiskStatusSchema> | null; scope?: z.infer<typeof takeoffRiskScopeTypeSchema> | null; lotId?: string | null;
}) {
  const response = parseTakeoffResponse(takeoffRiskRadarResponseSchema, payload);
  const filtered = Boolean(identity.severity || identity.status || identity.scope || identity.lotId);
  assertTakeoffResponseIdentity(sameTakeoffResponseId(response.job_id, identity.jobId) && sameTakeoffResponseId(response.version_id, identity.versionId)
    && (filtered || response.items.length === response.summary.to_process_count + response.summary.assumed_count + response.summary.false_positive_count)
    && response.items.every((item) => (!item.takeoff_job_id || sameTakeoffResponseId(item.takeoff_job_id, identity.jobId))
      && (!identity.severity || item.severity === identity.severity) && (!identity.status || item.status === identity.status)
      && (!identity.scope || item.scope_type === identity.scope)
      && (!identity.lotId || (item.lot_id !== null && sameTakeoffResponseId(item.lot_id, identity.lotId)))));
  return response;
}

export function parseUpdateTakeoffRiskAlertStatusResponse(payload: unknown, identity: {
  jobId: string; alertId: string; status: z.infer<typeof takeoffRiskStatusSchema>; reviewNote?: string | null;
}) {
  const response = parseTakeoffResponse(updateTakeoffRiskAlertStatusResponseSchema, payload);
  const alert = response.alert;
  assertTakeoffResponseIdentity(sameTakeoffResponseId(alert.alert_id, identity.alertId)
    && (!alert.takeoff_job_id || sameTakeoffResponseId(alert.takeoff_job_id, identity.jobId)) && alert.status === identity.status
    && (identity.status === "to_process"
      ? alert.review_note === null && alert.reviewed_at === null && alert.reviewed_by === null
      : alert.review_note === (identity.reviewNote?.trim() || null) && alert.review_note !== null
        && alert.reviewed_at !== null && alert.reviewed_by !== null));
  return response;
}
