import { z } from "zod";

const UUID_ERROR_MESSAGE = "Identifiant invalide.";

function isValidDateOnly(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

const requiredTextSchema = z
  .string()
  .trim()
  .min(1, "Champ obligatoire.")
  .max(500, "Texte trop long.");

const optionalNullableTextSchema = z
  .union([z.string(), z.null()])
  .transform((value) => {
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  });

const nonNegativeNumberSchema = z
  .number()
  .finite("Nombre invalide.")
  .min(0, "Doit etre >= 0.");

const nonNegativeIntegerSchema = z
  .number()
  .int("Entier attendu.")
  .min(0, "Doit etre >= 0.");

const positiveIntegerSchema = z
  .number()
  .int("Entier attendu.")
  .min(1, "Doit etre >= 1.");

const uuidSchema = z.string().uuid(UUID_ERROR_MESSAGE);
const nullableUuidSchema = z.union([uuidSchema, z.null()]);

const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide (YYYY-MM-DD).")
  .refine(isValidDateOnly, "Date invalide.");

const taxRateBpSchema = z
  .number()
  .int("Entier attendu.")
  .min(0, "Doit etre >= 0.")
  .max(10000, "Doit etre <= 10000.");

const basisPointsSchema = z
  .number()
  .int("Entier attendu.")
  .min(0, "Doit etre >= 0.");

const updatedAtTokenSchema = z
  .string()
  .trim()
  .min(1, "updated_at invalide.");

export const estimateStatusSchema = z.enum([
  "draft",
  "sent",
  "accepted",
  "archived",
]);

export const estimateRoundingModeSchema = z.enum([
  "none",
  "nearest",
  "up",
  "down",
]);

export const estimateMarginModeSchema = z.enum(["fixed", "tiered"]);

export const estimateItemTypeSchema = z.enum(["section", "line"]);

export const createEstimateSchema = z.object({
  project: z.object({
    name: requiredTextSchema,
    reference: optionalNullableTextSchema.optional(),
    client_name: optionalNullableTextSchema.optional(),
    notes: optionalNullableTextSchema.optional(),
  }),
  version: z
    .object({
      title: optionalNullableTextSchema.optional(),
      date_devis: dateOnlySchema.optional(),
      validite_jours: positiveIntegerSchema.optional(),
      margin_multiplier: nonNegativeNumberSchema.optional(),
      margin_mode: estimateMarginModeSchema.optional(),
      currency: z.string().trim().min(1, "Champ obligatoire.").max(16).optional(),
      margin_bp: basisPointsSchema.optional(),
      discount_bp: basisPointsSchema.optional(),
      tax_rate_bp: taxRateBpSchema.optional(),
      rounding_mode: estimateRoundingModeSchema.optional(),
      rounding_step_cents: positiveIntegerSchema.optional(),
    })
    .optional(),
});

export const patchEstimateVersionSchema = z
  .object({
    title: optionalNullableTextSchema.optional(),
    date_devis: dateOnlySchema.optional(),
    validite_jours: positiveIntegerSchema.optional(),
    margin_multiplier: nonNegativeNumberSchema.optional(),
    margin_mode: estimateMarginModeSchema.optional(),
    currency: z.string().trim().min(1, "Champ obligatoire.").max(16).optional(),
    margin_bp: basisPointsSchema.optional(),
    discount_bp: basisPointsSchema.optional(),
    tax_rate_bp: taxRateBpSchema.optional(),
    rounding_mode: estimateRoundingModeSchema.optional(),
    rounding_step_cents: positiveIntegerSchema.optional(),
    total_ht_cents: nonNegativeIntegerSchema.optional(),
    total_tax_cents: nonNegativeIntegerSchema.optional(),
    total_ttc_cents: nonNegativeIntegerSchema.optional(),
    updated_at: updatedAtTokenSchema.optional(),
  })
  .superRefine((payload, ctx) => {
    const hasUpdatableField = Object.keys(payload).some(
      (key) => key !== "updated_at"
    );
    if (hasUpdatableField) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Aucun champ a mettre a jour.",
      path: [],
    });
  });

export const patchEstimateStatusSchema = z.object({
  status: estimateStatusSchema,
});

const createSectionItemSchema = z.object({
  item_type: z.literal("section"),
  parent_id: nullableUuidSchema.optional(),
  position: positiveIntegerSchema.optional(),
  title: requiredTextSchema.optional(),
});

const createLineItemSchema = z.object({
  item_type: z.literal("line"),
  parent_id: nullableUuidSchema.optional(),
  position: positiveIntegerSchema.optional(),
  title: requiredTextSchema.optional(),
  description: optionalNullableTextSchema.optional(),
  quantity: nonNegativeNumberSchema.optional(),
  unit_price_ht_cents: nonNegativeIntegerSchema.optional(),
  tax_rate_bp: taxRateBpSchema.optional(),
  k_fo: nonNegativeNumberSchema.optional(),
  h_mo: nonNegativeNumberSchema.optional(),
  k_mo: nonNegativeNumberSchema.optional(),
  labor_role_id: nullableUuidSchema.optional(),
  category_id: nullableUuidSchema.optional(),
});

export const createEstimateItemSchema = z.discriminatedUnion("item_type", [
  createSectionItemSchema,
  createLineItemSchema,
]);

export const updateEstimateItemSchema = z
  .object({
    id: uuidSchema,
    parent_id: nullableUuidSchema.optional(),
    position: positiveIntegerSchema.optional(),
    title: requiredTextSchema.optional(),
    description: optionalNullableTextSchema.optional(),
    quantity: nonNegativeNumberSchema.optional(),
    unit_price_ht_cents: nonNegativeIntegerSchema.optional(),
    tax_rate_bp: taxRateBpSchema.optional(),
    k_fo: nonNegativeNumberSchema.optional(),
    h_mo: nonNegativeNumberSchema.optional(),
    k_mo: nonNegativeNumberSchema.optional(),
    labor_role_id: nullableUuidSchema.optional(),
    category_id: nullableUuidSchema.optional(),
  })
  .superRefine((payload, ctx) => {
    if (Object.keys(payload).length > 1) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Aucun champ de mise a jour fourni.",
      path: [],
    });
  });

export const bulkUpdateEstimateItemsSchema = z
  .array(updateEstimateItemSchema)
  .min(1, "updates ne peut pas etre vide.")
  .superRefine((payload, ctx) => {
    const ids = new Set<string>();

    payload.forEach((entry, index) => {
      if (!ids.has(entry.id)) {
        ids.add(entry.id);
        return;
      }

      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "updates doit contenir des identifiants uniques.",
        path: [index, "id"],
      });
    });
  });

export const bulkUpdateEstimateItemsRequestSchema = z.preprocess(
  (value) => {
    if (Array.isArray(value)) {
      return {
        updates: value,
      };
    }

    return value;
  },
  z.object({
    updated_at: updatedAtTokenSchema.optional(),
    updates: bulkUpdateEstimateItemsSchema,
  })
);

export const deleteEstimateItemSchema = z.object({
  id: uuidSchema,
});

export const reorderEstimateItemsSchema = z
  .object({
    parent_id: nullableUuidSchema.optional(),
    ordered_ids: z.array(uuidSchema).min(1, "ordered_ids ne peut pas etre vide."),
  })
  .superRefine((payload, ctx) => {
    const set = new Set(payload.ordered_ids);
    if (set.size === payload.ordered_ids.length) return;

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "ordered_ids doit contenir des identifiants uniques.",
      path: ["ordered_ids"],
    });
  });

const nullableNonNegativeNumberSchema = z.union([nonNegativeNumberSchema, z.null()]);

export const createEstimateCategorySchema = z.object({
  name: requiredTextSchema,
  color: optionalNullableTextSchema.optional(),
  position: nonNegativeIntegerSchema.optional(),
});

export const createLaborRoleSchema = z.object({
  name: requiredTextSchema,
  hourly_rate_cents: nonNegativeIntegerSchema.optional(),
  is_active: z.boolean().optional(),
  position: nonNegativeIntegerSchema.optional(),
});

export const updateLaborRoleSchema = z
  .object({
    name: requiredTextSchema.optional(),
    hourly_rate_cents: nonNegativeIntegerSchema.optional(),
    is_active: z.boolean().optional(),
    position: nonNegativeIntegerSchema.optional(),
  })
  .superRefine((payload, ctx) => {
    if (Object.keys(payload).length > 0) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Aucun champ de mise a jour fourni.",
      path: [],
    });
  });

export const createSuggestionRuleSchema = z.object({
  name: requiredTextSchema,
  match_type: z.literal("keyword").optional(),
  match_value: requiredTextSchema,
  unit: optionalNullableTextSchema.optional(),
  category_id: nullableUuidSchema.optional(),
  k_fo: nullableNonNegativeNumberSchema.optional(),
  k_mo: nullableNonNegativeNumberSchema.optional(),
  labor_role_id: nullableUuidSchema.optional(),
  position: nonNegativeIntegerSchema.optional(),
  is_active: z.boolean().optional(),
});

export const updateSuggestionRuleSchema = z
  .object({
    name: requiredTextSchema.optional(),
    match_type: z.literal("keyword").optional(),
    match_value: requiredTextSchema.optional(),
    unit: optionalNullableTextSchema.optional(),
    category_id: nullableUuidSchema.optional(),
    k_fo: nullableNonNegativeNumberSchema.optional(),
    k_mo: nullableNonNegativeNumberSchema.optional(),
    labor_role_id: nullableUuidSchema.optional(),
    position: nonNegativeIntegerSchema.optional(),
    is_active: z.boolean().optional(),
  })
  .superRefine((payload, ctx) => {
    if (Object.keys(payload).length > 0) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Aucun champ de mise a jour fourni.",
      path: [],
    });
  });

export type CreateEstimateInput = z.infer<typeof createEstimateSchema>;
export type PatchEstimateVersionInput = z.infer<typeof patchEstimateVersionSchema>;
export type PatchEstimateStatusInput = z.infer<typeof patchEstimateStatusSchema>;
export type CreateEstimateItemInput = z.infer<typeof createEstimateItemSchema>;
export type UpdateEstimateItemInput = z.infer<typeof updateEstimateItemSchema>;
export type BulkUpdateEstimateItemsInput = z.infer<
  typeof bulkUpdateEstimateItemsSchema
>;
export type BulkUpdateEstimateItemsRequestInput = z.infer<
  typeof bulkUpdateEstimateItemsRequestSchema
>;
export type DeleteEstimateItemInput = z.infer<typeof deleteEstimateItemSchema>;
export type ReorderEstimateItemsInput = z.infer<typeof reorderEstimateItemsSchema>;
export type CreateEstimateCategoryInput = z.infer<
  typeof createEstimateCategorySchema
>;
export type CreateLaborRoleInput = z.infer<typeof createLaborRoleSchema>;
export type UpdateLaborRoleInput = z.infer<typeof updateLaborRoleSchema>;
export type CreateSuggestionRuleInput = z.infer<
  typeof createSuggestionRuleSchema
>;
export type UpdateSuggestionRuleInput = z.infer<
  typeof updateSuggestionRuleSchema
>;
