import { z } from "zod";

import {
  requestTakeoffPriceSuggestionSchema,
  reviewTakeoffPriceSuggestionSchema,
  takeoffPriceSuggestionQuerySchema,
} from "@/lib/takeoff/schemas";

const uuid = z.string().uuid();
const cents = z.number().int().nonnegative().refine(Number.isSafeInteger);
const timestamp = z.string().refine((value) => Number.isFinite(Date.parse(value)));
const metadata = z.record(z.string(), z.unknown());
const evidenceKind = z.enum(["fact", "hypothesis", "inference"]);
const sameUuid = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

export const takeoffPriceSuggestionStatusSchema = z.enum(["pending", "applied", "kept_current", "rejected"]);
export const takeoffPriceSuggestionActionSchema = reviewTakeoffPriceSuggestionSchema.shape.action;
export const takeoffPriceSuggestionSourceKindSchema = z.enum(["history", "pricebook", "similar_item", "external_reference"]);
export const takeoffPriceSuggestionConfidenceLabelSchema = z.enum(["low", "medium", "high"]);

export const takeoffPriceSuggestionFactorSchema = z.object({
  key: z.string().min(1), label: z.string().min(1), value: z.string().min(1), kind: evidenceKind,
});

export const takeoffPriceSuggestionSourceSchema = z.object({
  source_id: z.string().min(1), source_kind: takeoffPriceSuggestionSourceKindSchema, kind: evidenceKind,
  label: z.string().min(1), source_ref: z.string().min(1), price_cents: cents,
  freshness_label: z.string().nullable(), confidence_score: z.number().min(0).max(1).nullable(),
  rank: z.number().int().positive(), is_outlier: z.boolean(),
  source_record_table: z.string().nullable(), source_record_id: z.string().nullable(), metadata,
});

export const takeoffPriceSuggestionSnapshotSchema = z.object({
  suggestion_id: uuid, line_id: uuid, version_id: uuid, job_id: uuid,
  current_price_cents: cents.nullable(), low_cents: cents, target_cents: cents, high_cents: cents,
  confidence_score: z.number().min(0).max(1).nullable(),
  confidence_label: takeoffPriceSuggestionConfidenceLabelSchema,
  candidate_count: z.number().int().nonnegative(), outlier_count: z.number().int().nonnegative(),
  justification: z.string().min(1), factors: z.array(takeoffPriceSuggestionFactorSchema), summary: metadata,
  status: takeoffPriceSuggestionStatusSchema, selected_action: takeoffPriceSuggestionActionSchema.nullable(),
  selected_price_cents: cents.nullable(), review_note: z.string().nullable(),
  reviewed_at: timestamp.nullable(), reviewed_by: uuid.nullable(), created_at: timestamp, updated_at: timestamp,
  sources: z.array(takeoffPriceSuggestionSourceSchema),
}).superRefine((suggestion, context) => {
  if (suggestion.low_cents > suggestion.target_cents || suggestion.target_cents > suggestion.high_cents) {
    context.addIssue({ code: "custom", path: ["target_cents"], message: "Fourchette de prix incohérente." });
  }
  if (suggestion.outlier_count > suggestion.candidate_count) {
    context.addIssue({ code: "custom", path: ["outlier_count"], message: "Nombre de valeurs aberrantes incohérent." });
  }
  const action = suggestion.selected_action;
  if (suggestion.status === "pending") {
    if (action !== null || suggestion.selected_price_cents !== null || suggestion.review_note !== null
      || suggestion.reviewed_at !== null || suggestion.reviewed_by !== null) {
      context.addIssue({ code: "custom", path: ["status"], message: "Une suggestion en attente ne peut pas être confirmée." });
    }
    return;
  }

  const expectedStatus = action === "reject" ? "rejected" : action === "keep_current" ? "kept_current" : "applied";
  const expectedPrice = action === "apply_low" ? suggestion.low_cents
    : action === "apply_target" ? suggestion.target_cents
    : action === "apply_high" ? suggestion.high_cents
    : action === "keep_current" ? suggestion.current_price_cents : null;
  if (action === null || suggestion.status !== expectedStatus || suggestion.selected_price_cents !== expectedPrice
    || suggestion.reviewed_at === null || suggestion.reviewed_by === null || !suggestion.review_note?.trim()) {
    context.addIssue({ code: "custom", path: ["selected_action"], message: "Décision et prix de revue incohérents." });
  }
});

export const takeoffPriceSuggestionResponseSchema = z.object({
  suggestion: takeoffPriceSuggestionSnapshotSchema,
});

export const takeoffPriceSuggestionReviewResponseSchema = z.object({
  suggestion: takeoffPriceSuggestionSnapshotSchema,
  applied_item: z.object({ id: uuid, unit_price_ht_cents: cents.nullable(), updated_at: timestamp }).nullable(),
}).superRefine(({ suggestion, applied_item }, context) => {
  if (suggestion.status === "applied") {
    if (!applied_item || !sameUuid(applied_item.id, suggestion.line_id) || applied_item.unit_price_ht_cents !== suggestion.selected_price_cents) {
      context.addIssue({ code: "custom", path: ["applied_item"], message: "La ligne appliquée ne correspond pas à la revue." });
    }
  } else if (suggestion.status === "pending" || applied_item !== null) {
    context.addIssue({ code: "custom", path: ["applied_item"], message: "Résultat de revue incohérent." });
  }
});

export type TakeoffPriceSuggestionStatus = z.infer<typeof takeoffPriceSuggestionStatusSchema>;
export type TakeoffPriceSuggestionAction = z.infer<typeof takeoffPriceSuggestionActionSchema>;
export type TakeoffPriceSuggestionSourceKind = z.infer<typeof takeoffPriceSuggestionSourceKindSchema>;
export type TakeoffPriceSuggestionConfidenceLabel = z.infer<typeof takeoffPriceSuggestionConfidenceLabelSchema>;
export type TakeoffPriceSuggestionFactor = z.infer<typeof takeoffPriceSuggestionFactorSchema>;
export type TakeoffPriceSuggestionSource = z.infer<typeof takeoffPriceSuggestionSourceSchema>;
export type TakeoffPriceSuggestionSnapshot = z.infer<typeof takeoffPriceSuggestionSnapshotSchema>;
export type TakeoffPriceSuggestionResponse = z.infer<typeof takeoffPriceSuggestionResponseSchema>;
export type ReviewTakeoffPriceSuggestionResponse = z.infer<typeof takeoffPriceSuggestionReviewResponseSchema>;
export type GetTakeoffPriceSuggestionQuery = z.infer<typeof takeoffPriceSuggestionQuerySchema>;
export type RequestTakeoffPriceSuggestionInput = z.infer<typeof requestTakeoffPriceSuggestionSchema>;
export type ReviewTakeoffPriceSuggestionInput = z.infer<typeof reviewTakeoffPriceSuggestionSchema>;

type SuggestionIdentity = { jobId: string; versionId: string };
const invalidResponseMessage = "La réponse de suggestion de prix est invalide. Rechargez la suggestion avant toute nouvelle action.";

export function parseTakeoffPriceSuggestionResponse(payload: unknown,
  identity: SuggestionIdentity & { lineId: string }): TakeoffPriceSuggestionResponse {
  const result = takeoffPriceSuggestionResponseSchema.safeParse(payload);
  if (!result.success || !sameUuid(result.data.suggestion.job_id, identity.jobId)
    || !sameUuid(result.data.suggestion.version_id, identity.versionId) || !sameUuid(result.data.suggestion.line_id, identity.lineId)) {
    throw new Error(invalidResponseMessage);
  }
  return result.data;
}

export function parseTakeoffPriceSuggestionReviewResponse(payload: unknown,
  identity: SuggestionIdentity & { suggestionId: string; lineId: string; action: TakeoffPriceSuggestionAction }): ReviewTakeoffPriceSuggestionResponse {
  const result = takeoffPriceSuggestionReviewResponseSchema.safeParse(payload);
  if (!result.success || !sameUuid(result.data.suggestion.job_id, identity.jobId)
    || !sameUuid(result.data.suggestion.version_id, identity.versionId) || !sameUuid(result.data.suggestion.suggestion_id, identity.suggestionId)
    || !sameUuid(result.data.suggestion.line_id, identity.lineId)
    || result.data.suggestion.selected_action !== identity.action) {
    throw new Error(invalidResponseMessage);
  }
  return result.data;
}
