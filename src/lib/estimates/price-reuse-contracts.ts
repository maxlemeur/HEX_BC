import { z } from "zod";

import { PRICE_REUSE_MAX_SELECTIONS } from "@/lib/estimates/price-reuse-plan";

// Reprise des prix d'un devis de référence (docs/metier/reprise-des-prix.md) : contrats partagés par les routes,
// le client de l'éditeur et l'OpenAPI.

const uuid = z.string().uuid();
const timestamp = z.string().refine((value) => Number.isFinite(Date.parse(value)), "Horodatage invalide.");
const cents = z.number().int().nonnegative().refine(Number.isSafeInteger);
const count = z.number().int().nonnegative();

/** Lignes envoyées à un arbitre par demande ; l'éditeur découpe au-delà. */
export const PRICE_REUSE_ARBITRATION_MAX_LINES = 100;
export const PRICE_REUSE_PROVIDERS = ["decisions", "chatgpt"] as const;

export const priceReusePreviewInputSchema = z.object({ reference_version_id: uuid }).strict();

export const priceReuseArbitrationInputSchema = z.object({
  reference_version_id: uuid,
  reference_updated_at: timestamp,
  provider: z.enum(PRICE_REUSE_PROVIDERS),
  line_ids: z.array(uuid).min(1).max(PRICE_REUSE_ARBITRATION_MAX_LINES)
    .refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, "Lignes en double."),
}).strict();

export const priceReuseApplyInputSchema = z.object({
  reference_version_id: uuid,
  reference_updated_at: timestamp,
  /** Jeton du brouillon lu par la comparaison : une écriture intervenue depuis (sauvegarde) la rend caduque. */
  target_updated_at: timestamp,
  operation_key: uuid,
  selections: z.array(z.object({ line_id: uuid, reference_line_id: uuid }).strict()).min(1).max(PRICE_REUSE_MAX_SELECTIONS),
}).strict();

const arbiterSchema = z.object({ available: z.boolean(), message: z.string() });

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
  arbiters: z.object({ decisions: arbiterSchema, chatgpt: arbiterSchema }),
});

export const priceReuseArbitrationSchema = z.object({
  provider: z.enum(PRICE_REUSE_PROVIDERS),
  model: z.string().nullable(),
  status: z.enum(["available", "partial", "unavailable", "failed"]),
  message: z.string(),
  answers: z.array(z.object({
    line_id: uuid, reference_line_id: uuid.nullable(), confidence: z.number().min(0).max(1).nullable(),
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
