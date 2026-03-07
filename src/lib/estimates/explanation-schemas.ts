import { z } from "zod";

export const estimateExplanationKindSchema = z.enum(["price", "delta"]);
export type EstimateExplanationKind = z.infer<
  typeof estimateExplanationKindSchema
>;

export const estimateExplanationConfidenceLabelSchema = z.enum([
  "low",
  "medium",
  "high",
]);
export type EstimateExplanationConfidenceLabel = z.infer<
  typeof estimateExplanationConfidenceLabelSchema
>;

export const estimateExplanationStatementSchema = z.object({
  label: z.string().trim().min(1),
  source_label: z.string().trim().min(1).nullable().optional(),
  confidence_score: z.number().min(0).max(1).nullable().optional(),
});
export type EstimateExplanationStatement = z.infer<
  typeof estimateExplanationStatementSchema
>;

export const estimateExplanationProvenanceSchema = z.object({
  source_kind: z.string().trim().min(1),
  label: z.string().trim().min(1),
  source_ref: z.string().trim().min(1).nullable().optional(),
  confidence_score: z.number().min(0).max(1).nullable().optional(),
});
export type EstimateExplanationProvenance = z.infer<
  typeof estimateExplanationProvenanceSchema
>;

export const estimateExplanationRiskSignalSchema = z.object({
  label: z.string().trim().min(1),
  severity: z.enum(["low", "medium", "high"]),
  basis: z.enum(["fact", "hypothesis", "inference"]),
  source_label: z.string().trim().min(1).nullable().optional(),
});
export type EstimateExplanationRiskSignal = z.infer<
  typeof estimateExplanationRiskSignalSchema
>;

export const estimateExplanationImpactSummarySchema = z.object({
  current_amount_ht_cents: z.number().int().nullable().optional(),
  current_amount_ttc_cents: z.number().int().nullable().optional(),
  delta_ht_cents: z.number().int().nullable().optional(),
  delta_ttc_cents: z.number().int().nullable().optional(),
  current_margin_bp: z.number().int().nullable().optional(),
  compare_margin_bp: z.number().int().nullable().optional(),
  margin_bp_delta: z.number().int().nullable().optional(),
  current_margin_multiplier: z.number().nullable().optional(),
  compare_margin_multiplier: z.number().nullable().optional(),
  top_drivers: z.array(z.string().trim().min(1)).max(5).default([]),
});
export type EstimateExplanationImpactSummary = z.infer<
  typeof estimateExplanationImpactSummarySchema
>;

export const estimateExplanationSnapshotSchema = z.object({
  explanation_id: z.string().uuid(),
  kind: estimateExplanationKindSchema,
  version_id: z.string().uuid(),
  line_id: z.string().uuid().nullable().optional(),
  compare_version_id: z.string().uuid().nullable().optional(),
  summary_short: z.string().trim().min(1),
  summary_detail: z.string().trim().min(1).nullable().optional(),
  confidence_label: estimateExplanationConfidenceLabelSchema,
  confidence_score: z.number().min(0).max(1).nullable().optional(),
  used_fallback: z.boolean(),
  provider: z.string().trim().min(1),
  model: z.string().trim().min(1).nullable().optional(),
  generated_at: z.string().trim().min(1),
  facts: z.array(estimateExplanationStatementSchema),
  hypotheses: z.array(estimateExplanationStatementSchema),
  inferences: z.array(estimateExplanationStatementSchema),
  provenance: z.array(estimateExplanationProvenanceSchema),
  risk_signals: z.array(estimateExplanationRiskSignalSchema),
  impact_summary: estimateExplanationImpactSummarySchema,
});
export type EstimateExplanationSnapshot = z.infer<
  typeof estimateExplanationSnapshotSchema
>;

export const estimateExplanationResponseSchema = z.object({
  explanation: estimateExplanationSnapshotSchema,
});

export const estimateExplanationDetailQueryParamSchema = z
  .enum(["0", "1"])
  .optional();

export const estimateExplanationDetailQuerySchema = z.object({
  detail: estimateExplanationDetailQueryParamSchema.transform(
    (value) => value === "1"
  ),
});

export const estimateDeltaExplanationQuerySchema = z.object({
  compare_version_id: z.string().uuid("compare_version_id invalide."),
  detail: estimateExplanationDetailQueryParamSchema.transform(
    (value) => value === "1"
  ),
});
