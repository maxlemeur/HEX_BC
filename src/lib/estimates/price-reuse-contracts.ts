import { z } from "zod";

import { AI_BILLING_SOURCES } from "@/lib/ai/access/contracts";
import { chatGptPreferencesSchema, chatGptReasoningEffortSchema } from "@/lib/ai/chatgpt-model-preferences";
import { PRICE_REUSE_MAX_SELECTIONS } from "@/lib/estimates/price-reuse-plan";

// Reprise des prix d'un devis de référence (docs/metier/reprise-des-prix.md) : contrats partagés par les routes,
// le client de l'éditeur et l'OpenAPI.

const uuid = z.string().uuid();
const timestamp = z.string().refine((value) => Number.isFinite(Date.parse(value)), "Horodatage invalide.");
const cents = z.number().int().nonnegative().refine(Number.isSafeInteger);
const count = z.number().int().nonnegative();

/** Taille d'une requête de l'éditeur sur le forfait ou l'API Decisions. */
export const PRICE_REUSE_ARBITRATION_MAX_LINES = 100;
/** La commande sur clé ne fait qu'une requête, découpée côté serveur sous un plafond commun. */
export const PRICE_REUSE_KEY_MAX_LINES = PRICE_REUSE_MAX_SELECTIONS;
export const PRICE_REUSE_PROVIDERS = ["decisions", "chatgpt", "personal_api_key"] as const;

export const priceReusePreviewInputSchema = z.object({ reference_version_id: uuid }).strict();

const arbitrationReference = {
  reference_version_id: uuid,
  reference_updated_at: timestamp,
};
const arbitrationLines = (max: number) => z.array(uuid).min(1).max(max)
  .refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, "Lignes en double.");
const arbitrationSelection = {
  model: chatGptPreferencesSchema.shape.model.optional(),
  reasoning_effort: chatGptReasoningEffortSchema.nullable().optional(),
};

export const priceReuseArbitrationInputSchema = z.discriminatedUnion("provider", [
  z.object({ ...arbitrationReference, provider: z.literal("decisions"), line_ids: arbitrationLines(PRICE_REUSE_ARBITRATION_MAX_LINES) }).strict(),
  z.object({ ...arbitrationReference, provider: z.literal("chatgpt"), line_ids: arbitrationLines(PRICE_REUSE_ARBITRATION_MAX_LINES), ...arbitrationSelection }).strict(),
  z.object({ ...arbitrationReference, provider: z.literal("personal_api_key"), line_ids: arbitrationLines(PRICE_REUSE_KEY_MAX_LINES), ...arbitrationSelection }).strict(),
]);

export const priceReuseApplyInputSchema = z.object({
  reference_version_id: uuid,
  reference_updated_at: timestamp,
  /** Jeton du brouillon lu par la comparaison : une écriture intervenue depuis (sauvegarde) la rend caduque. */
  target_updated_at: timestamp,
  operation_key: uuid,
  selections: z.array(z.object({ line_id: uuid, reference_line_id: uuid }).strict()).min(1).max(PRICE_REUSE_MAX_SELECTIONS),
}).strict();

const arbiterSchema = z.object({ available: z.boolean(), message: z.string() });
const personalArbiterSchema = arbiterSchema.extend({
  models: z.array(z.object({
    id: z.string(), name: z.string(), reasoningEfforts: z.array(chatGptReasoningEffortSchema),
    defaultReasoningEffort: chatGptReasoningEffortSchema.nullable(),
  })),
  preferences: chatGptPreferencesSchema.nullable(),
});

export const priceReusePreviewSchema = z.object({
  target: z.object({ version_id: uuid, updated_at: timestamp }),
  reference: z.object({
    version_id: uuid, updated_at: timestamp, project_name: z.string(), version_number: count, title: z.string().nullable(),
  }),
  summary: z.object({ identical: count, to_review: count, new: count }),
  lines: z.array(z.object({
    line_id: uuid, title: z.string(), unit_code: z.string().nullable(), section_path: z.array(z.string()),
    status: z.enum(["identical", "to_review", "new"]),
    proposed_reference_line_id: uuid.nullable(),
    /** Identique, sans prix saisi : retenue d'office. Une ligne déjà chiffrée n'est jamais retenue d'office. */
    preselected: z.boolean(),
    current_unit_price_ht_cents: cents.nullable(),
    current_h_mo_per_unit: z.number().nullable(),
    notes: z.array(z.string()),
    candidates: z.array(z.object({
      reference_line_id: uuid, exact: z.boolean(), score: z.number().min(0).max(1), differences: z.array(z.string()),
    })),
  })),
  references: z.array(z.object({
    reference_line_id: uuid, title: z.string(), unit_code: z.string().nullable(), section_path: z.array(z.string()),
    unit_price_ht_cents: cents.nullable(), h_mo_per_unit: z.number().nullable(), pu_ht_cents: cents.nullable(),
    labor_role_name: z.string().nullable(), supply_type_name: z.string().nullable(),
  })),
  arbiters: z.object({ decisions: arbiterSchema, chatgpt: personalArbiterSchema, personal_api_key: personalArbiterSchema }),
  default_billing_source: z.enum(AI_BILLING_SOURCES).nullable(),
});

export const priceReuseArbitrationSchema = z.object({
  provider: z.enum(PRICE_REUSE_PROVIDERS),
  model: z.string().nullable(),
  status: z.enum(["available", "partial", "unavailable", "failed"]),
  message: z.string(),
  answers: z.array(z.object({
    line_id: uuid, reference_line_id: uuid.nullable(), confidence: z.number().min(0).max(1).nullable(),
    no_match: z.literal(true).optional(),
  })),
});

export const priceReuseApplySchema = z.object({
  applied_count: count,
  unchanged_count: count,
  lines: z.array(z.object({
    line_id: uuid, reference_line_id: uuid, title: z.string(),
    reference_pu_ht_cents: cents.nullable(), pu_ht_cents: cents.nullable(),
  })),
  version: z.object({ id: uuid, updated_at: timestamp }),
});

export type PriceReuseProvider = (typeof PRICE_REUSE_PROVIDERS)[number];
export type PriceReusePreviewInput = z.infer<typeof priceReusePreviewInputSchema>;
export type PriceReuseArbitrationInput = z.infer<typeof priceReuseArbitrationInputSchema>;
export type PriceReuseApplyInput = z.infer<typeof priceReuseApplyInputSchema>;
export type PriceReusePreview = z.infer<typeof priceReusePreviewSchema>;
export type PriceReusePreviewLine = PriceReusePreview["lines"][number];
export type PriceReuseReferenceView = PriceReusePreview["references"][number];
export type PriceReuseArbitration = z.infer<typeof priceReuseArbitrationSchema>;
export type PriceReuseApplyResult = z.infer<typeof priceReuseApplySchema>;
