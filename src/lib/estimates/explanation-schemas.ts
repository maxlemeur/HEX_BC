import { z } from "zod";

import { AI_BILLING_SOURCES } from "@/lib/ai/access/contracts";
import { chatGptPreferencesSchema, chatGptReasoningEffortSchema } from "@/lib/ai/chatgpt-model-preferences";

const priceExplanationAiRequestSchema = chatGptPreferencesSchema.extend({
  source: z.enum(AI_BILLING_SOURCES),
});

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
export const priceExplanationSnapshotSchema = estimateExplanationSnapshotSchema.extend({
  ai_request: priceExplanationAiRequestSchema.optional(),
});
export type EstimateExplanationSnapshot = z.infer<typeof priceExplanationSnapshotSchema>;

export const estimateExplanationResponseSchema = z.object({
  explanation: estimateExplanationSnapshotSchema,
});

const priceExplanationRevisionSchema = z.string().min(1).max(110);

export const priceExplanationGenerationSchema = z.discriminatedUnion("source", [
  chatGptPreferencesSchema.extend({
    source: z.literal("chatgpt_plan"),
    revision: priceExplanationRevisionSchema,
  }),
  chatGptPreferencesSchema.extend({
    source: z.literal("personal_api_key"),
    revision: priceExplanationRevisionSchema,
    connectionId: z.uuid(),
  }),
]);
export type PriceExplanationGeneration = z.infer<typeof priceExplanationGenerationSchema>;

const priceExplanationModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  reasoningEfforts: z.array(chatGptReasoningEffortSchema),
  defaultReasoningEffort: chatGptReasoningEffortSchema.nullable(),
});
const priceExplanationSourceOptionSchema = z.discriminatedUnion("available", [
  z.object({
    available: z.literal(true),
    message: z.string(),
    models: z.array(priceExplanationModelSchema),
    preferences: chatGptPreferencesSchema,
  }),
  z.object({ available: z.literal(false), message: z.string() }),
]);
export const priceExplanationSettingsSchema = z.object({
  defaultSource: z.enum(AI_BILLING_SOURCES).nullable(),
  sources: z.object({
    chatgpt_plan: priceExplanationSourceOptionSchema,
    personal_api_key: priceExplanationSourceOptionSchema,
  }),
  connectionId: z.uuid().nullable(),
  canRefreshPlanModels: z.boolean(),
});
export type PriceExplanationSettings = z.infer<typeof priceExplanationSettingsSchema>;

export const priceExplanationReadResponseSchema = z.object({
  status: z.enum(["ready", "missing", "stale"]),
  explanation: priceExplanationSnapshotSchema.nullable(),
  revision: priceExplanationRevisionSchema,
  settings: priceExplanationSettingsSchema,
});
export const priceExplanationGeneratedResponseSchema = estimateExplanationResponseSchema.extend({
  explanation: priceExplanationSnapshotSchema,
  revision: priceExplanationRevisionSchema,
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
