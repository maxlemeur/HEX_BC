import { z } from "zod";
import { SUPPORTED_ESTIMATE_CURRENCIES } from "@/lib/money";
import {
  DEFAULT_MAX_SECTION_DEPTH,
  MAX_SECTION_DEPTH,
  MIN_SECTION_DEPTH,
} from "@/lib/estimates/hierarchy";

const UUID_ERROR_MESSAGE = "Identifiant invalide.";
const AID_TOO_LONG_ERROR_MESSAGE = "AID trop long.";

export const DEFAULT_ESTIMATE_ITEM_AID_REGEX_PATTERN =
  "^[A-Z]{2,4}\\.[A-Z]{2,4}\\.\\d{2,4}$";
export const ESTIMATE_ITEM_AID_REGEX_FEATURE_FLAG_KEY = "ESTIMATE_ITEM_AID_REGEX";
const DEFAULT_ESTIMATE_ITEM_AID_REGEX = new RegExp(
  DEFAULT_ESTIMATE_ITEM_AID_REGEX_PATTERN
);

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

export function normalizeEstimateItemAid(
  value: string | null | undefined
): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

export function parseEstimateItemAidRegexPattern(pattern: string | null | undefined) {
  const normalized = pattern?.trim();
  if (!normalized) {
    return DEFAULT_ESTIMATE_ITEM_AID_REGEX;
  }

  try {
    const parsed = new RegExp(normalized);
    const flags = parsed.flags.replaceAll("g", "");
    return new RegExp(parsed.source, flags);
  } catch {
    return DEFAULT_ESTIMATE_ITEM_AID_REGEX;
  }
}

const optionalNullableTextSchema = z
  .union([z.string(), z.null()])
  .transform((value) => {
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  });

const optionalAidSchema = z
  .union([z.string().max(64, AID_TOO_LONG_ERROR_MESSAGE), z.null()])
  .transform((value) => normalizeEstimateItemAid(value));

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
const sectionDepthSchema = z
  .number()
  .int("Entier attendu.")
  .min(MIN_SECTION_DEPTH, `Doit etre >= ${MIN_SECTION_DEPTH}.`)
  .max(MAX_SECTION_DEPTH, `Doit etre <= ${MAX_SECTION_DEPTH}.`);

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
const discountStepBpSchema = basisPointsSchema.max(10000, "Doit etre <= 10000.");
const discountStepsSchema = z.array(discountStepBpSchema);
const globalCoefficientSchema = z
  .number()
  .finite("Nombre invalide.")
  .min(0, "Doit etre >= 0.");

const updatedAtTokenSchema = z
  .string()
  .trim()
  .min(1, "updated_at invalide.");

const templateNameSchema = z
  .string()
  .trim()
  .min(1, "Nom du template obligatoire.")
  .max(160, "Nom du template trop long.");
const assemblyNameSchema = z
  .string()
  .trim()
  .min(1, "Nom de l'assemblage obligatoire.")
  .max(160, "Nom de l'assemblage trop long.");

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
export const estimateDiscountModeSchema = z.enum(["simple", "cascade"]);
export const estimateCurrencySchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toUpperCase() : value),
  z.enum(SUPPORTED_ESTIMATE_CURRENCIES)
);

export const estimateItemTypeSchema = z.enum(["section", "line"]);

const createEstimateVersionSchema = z
  .object({
    title: optionalNullableTextSchema.optional(),
    date_devis: dateOnlySchema.optional(),
    validite_jours: positiveIntegerSchema.optional(),
    margin_multiplier: nonNegativeNumberSchema.optional(),
    margin_mode: estimateMarginModeSchema.optional(),
    currency: estimateCurrencySchema.optional(),
    margin_bp: basisPointsSchema.optional(),
    discount_bp: basisPointsSchema.optional(),
    discount_mode: estimateDiscountModeSchema.optional(),
    discount_steps: discountStepsSchema.optional(),
    global_coefficient: globalCoefficientSchema.optional(),
    tax_rate_bp: taxRateBpSchema.optional(),
    rounding_mode: estimateRoundingModeSchema.optional(),
    rounding_step_cents: positiveIntegerSchema.optional(),
    max_section_depth: sectionDepthSchema.optional().default(DEFAULT_MAX_SECTION_DEPTH),
  })
  .superRefine((payload, ctx) => {
    const mode = payload.discount_mode ?? "simple";
    const steps = payload.discount_steps ?? [];

    if (mode === "simple" && steps.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "discount_steps doit etre vide en mode simple.",
        path: ["discount_steps"],
      });
    }
  });

const createEstimateProjectSchema = z.object({
  name: requiredTextSchema,
  reference: optionalNullableTextSchema.optional(),
  client_name: optionalNullableTextSchema.optional(),
  notes: optionalNullableTextSchema.optional(),
});

const createEstimateSelectorSchema = z.union([
  z.object({
    project_id: uuidSchema,
  }),
  z.object({
    project: createEstimateProjectSchema,
  }),
]);

const createEstimatePayloadSchema = z
  .object({
    project_id: uuidSchema.optional(),
    project: createEstimateProjectSchema.optional(),
    version: createEstimateVersionSchema.optional(),
  })
  .superRefine((payload, ctx) => {
    if (payload.project_id || payload.project) {
      return;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "project ou project_id est requis.",
      path: ["project"],
    });
  });

export const createEstimateSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }

    const record = value as Record<string, unknown>;
    return {
      project_id: record.project_id ?? record.projectId,
      project: record.project,
      version: record.version,
    };
  },
  createEstimatePayloadSchema.and(createEstimateSelectorSchema)
);

export const patchEstimateVersionSchema = z
  .object({
    title: optionalNullableTextSchema.optional(),
    date_devis: dateOnlySchema.optional(),
    validite_jours: positiveIntegerSchema.optional(),
    margin_multiplier: nonNegativeNumberSchema.optional(),
    margin_mode: estimateMarginModeSchema.optional(),
    currency: estimateCurrencySchema.optional(),
    margin_bp: basisPointsSchema.optional(),
    discount_bp: basisPointsSchema.optional(),
    discount_mode: estimateDiscountModeSchema.optional(),
    discount_steps: discountStepsSchema.optional(),
    global_coefficient: globalCoefficientSchema.optional(),
    tax_rate_bp: taxRateBpSchema.optional(),
    rounding_mode: estimateRoundingModeSchema.optional(),
    rounding_step_cents: positiveIntegerSchema.optional(),
    max_section_depth: sectionDepthSchema.optional(),
    total_ht_cents: nonNegativeIntegerSchema.optional(),
    total_tax_cents: nonNegativeIntegerSchema.optional(),
    total_ttc_cents: nonNegativeIntegerSchema.optional(),
    updated_at: updatedAtTokenSchema.optional(),
  })
  .superRefine((payload, ctx) => {
    const hasUpdatableField = Object.keys(payload).some(
      (key) => key !== "updated_at"
    );
    if (!hasUpdatableField) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Aucun champ a mettre a jour.",
        path: [],
      });
      return;
    }

    if (
      payload.discount_mode === "simple" &&
      Array.isArray(payload.discount_steps) &&
      payload.discount_steps.length > 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "discount_steps doit etre vide en mode simple.",
        path: ["discount_steps"],
      });
    }
  });

export const patchEstimateStatusSchema = z.object({
  status: estimateStatusSchema,
  updated_at: updatedAtTokenSchema.optional(),
  force: z.boolean().optional(),
});

const emptyPayloadSchema = z.object({}).strict();

function normalizeOptionalEmptyPayload(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return {};
  }

  return value;
}

export const createEstimateVariantSchema = z.preprocess(
  normalizeOptionalEmptyPayload,
  emptyPayloadSchema
);

export const promoteEstimateVariantSchema = z.preprocess(
  normalizeOptionalEmptyPayload,
  emptyPayloadSchema
);

const createSectionItemSchema = z.object({
  item_type: z.literal("section"),
  parent_id: nullableUuidSchema.optional(),
  position: positiveIntegerSchema.optional(),
  title: requiredTextSchema.optional(),
  aid: optionalAidSchema.optional(),
  source_provider: optionalNullableTextSchema.optional(),
  source_job_id: nullableUuidSchema.optional(),
  source_file_name: optionalNullableTextSchema.optional(),
  source_page: z.union([positiveIntegerSchema, z.null()]).optional(),
});

const createLineItemSchema = z.object({
  item_type: z.literal("line"),
  parent_id: nullableUuidSchema.optional(),
  position: positiveIntegerSchema.optional(),
  title: requiredTextSchema.optional(),
  aid: optionalAidSchema.optional(),
  description: optionalNullableTextSchema.optional(),
  quantity: nonNegativeNumberSchema.optional(),
  unit_price_ht_cents: nonNegativeIntegerSchema.optional(),
  tax_rate_bp: taxRateBpSchema.optional(),
  k_fo: nonNegativeNumberSchema.optional(),
  h_mo: nonNegativeNumberSchema.optional(),
  h_mo_majoration: nonNegativeNumberSchema.optional(),
  k_mo: nonNegativeNumberSchema.optional(),
  h_mo_atelier: nonNegativeNumberSchema.optional(),
  k_mo_atelier: nonNegativeNumberSchema.optional(),
  labor_role_atelier_id: nullableUuidSchema.optional(),
  h_mo_chantier: nonNegativeNumberSchema.optional(),
  k_mo_chantier: nonNegativeNumberSchema.optional(),
  labor_role_chantier_id: nullableUuidSchema.optional(),
  labor_role_id: nullableUuidSchema.optional(),
  category_id: nullableUuidSchema.optional(),
  supply_type_id: nullableUuidSchema.optional(),
  selected_supplier_price_id: nullableUuidSchema.optional(),
  source_provider: optionalNullableTextSchema.optional(),
  source_job_id: nullableUuidSchema.optional(),
  source_file_name: optionalNullableTextSchema.optional(),
  source_page: z.union([positiveIntegerSchema, z.null()]).optional(),
});

export const createEstimateItemSchema = z.discriminatedUnion("item_type", [
  createSectionItemSchema,
  createLineItemSchema,
]);

const updateEstimateItemFields = {
  parent_id: nullableUuidSchema.optional(),
  position: positiveIntegerSchema.optional(),
  title: requiredTextSchema.optional(),
  aid: optionalAidSchema.optional(),
  description: optionalNullableTextSchema.optional(),
  quantity: nonNegativeNumberSchema.optional(),
  unit_price_ht_cents: nonNegativeIntegerSchema.optional(),
  tax_rate_bp: taxRateBpSchema.optional(),
  k_fo: nonNegativeNumberSchema.optional(),
  h_mo: nonNegativeNumberSchema.optional(),
  h_mo_majoration: nonNegativeNumberSchema.optional(),
  k_mo: nonNegativeNumberSchema.optional(),
  h_mo_atelier: nonNegativeNumberSchema.optional(),
  k_mo_atelier: nonNegativeNumberSchema.optional(),
  labor_role_atelier_id: nullableUuidSchema.optional(),
  h_mo_chantier: nonNegativeNumberSchema.optional(),
  k_mo_chantier: nonNegativeNumberSchema.optional(),
  labor_role_chantier_id: nullableUuidSchema.optional(),
  pu_ht_cents: nonNegativeIntegerSchema.optional(),
  line_total_ht_cents: nonNegativeIntegerSchema.optional(),
  line_tax_cents: nonNegativeIntegerSchema.optional(),
  line_total_ttc_cents: nonNegativeIntegerSchema.optional(),
  labor_role_id: nullableUuidSchema.optional(),
  category_id: nullableUuidSchema.optional(),
  supply_type_id: nullableUuidSchema.optional(),
  selected_supplier_price_id: nullableUuidSchema.optional(),
} as const;

const updateEstimateItemDataSchema = z
  .object(updateEstimateItemFields)
  .superRefine((payload, ctx) => {
    if (Object.keys(payload).length > 0) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Aucun champ de mise a jour fourni.",
      path: [],
    });
  });

export const updateEstimateItemSchema = z
  .object({
    id: uuidSchema,
    ...updateEstimateItemFields,
    item_type: estimateItemTypeSchema.optional(),
  })
  .superRefine((payload, ctx) => {
    if (Object.keys(payload).length > 1) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Aucun champ de mise a jour fourni.",
      path: [],
    });
  });

const bulkUpdateEstimateItemSchema = z
  .object({
    id: uuidSchema,
    ...updateEstimateItemFields,
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
  .array(bulkUpdateEstimateItemSchema)
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

export const bulkUpdateEstimateVersionPatchSchema = z
  .object({
    total_ht_cents: nonNegativeIntegerSchema.optional(),
    total_tax_cents: nonNegativeIntegerSchema.optional(),
    total_ttc_cents: nonNegativeIntegerSchema.optional(),
  })
  .superRefine((payload, ctx) => {
    if (Object.keys(payload).length > 0) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "version_patch ne peut pas etre vide.",
      path: [],
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
  z
    .object({
      updated_at: updatedAtTokenSchema.optional(),
      updates: bulkUpdateEstimateItemsSchema,
      version_patch: bulkUpdateEstimateVersionPatchSchema.optional(),
    })
    .superRefine((payload, ctx) => {
      if (payload.updates.length > 0 || payload.version_patch) return;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "updates ne peut pas etre vide.",
        path: ["updates"],
      });
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

export const moveEstimateItemSchema = z
  .object({
    item_id: uuidSchema,
    from_parent_id: nullableUuidSchema,
    to_parent_id: nullableUuidSchema,
    ordered_source_ids: z.array(uuidSchema),
    ordered_target_ids: z
      .array(uuidSchema)
      .min(1, "ordered_target_ids ne peut pas etre vide."),
  })
  .superRefine((payload, ctx) => {
    const sourceSet = new Set(payload.ordered_source_ids);
    if (sourceSet.size !== payload.ordered_source_ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ordered_source_ids doit contenir des identifiants uniques.",
        path: ["ordered_source_ids"],
      });
    }

    const targetSet = new Set(payload.ordered_target_ids);
    if (targetSet.size !== payload.ordered_target_ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ordered_target_ids doit contenir des identifiants uniques.",
        path: ["ordered_target_ids"],
      });
    }

    if (payload.ordered_source_ids.includes(payload.item_id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ordered_source_ids ne doit pas contenir item_id.",
        path: ["ordered_source_ids"],
      });
    }

    if (!payload.ordered_target_ids.includes(payload.item_id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ordered_target_ids doit contenir item_id.",
        path: ["ordered_target_ids"],
      });
    }

    if (payload.from_parent_id === payload.to_parent_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "from_parent_id et to_parent_id doivent etre differents pour un move inter-parent.",
        path: ["to_parent_id"],
      });
    }

    if (payload.ordered_source_ids.some((id) => targetSet.has(id))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "ordered_source_ids et ordered_target_ids ne doivent pas se chevaucher.",
        path: ["ordered_target_ids"],
      });
    }
  });

export const batchCreateEstimateOperationSchema = z.object({
  op: z.literal("create"),
  data: createEstimateItemSchema,
});

export const batchUpdateEstimateOperationSchema = z.object({
  op: z.literal("update"),
  id: uuidSchema,
  data: updateEstimateItemDataSchema,
});

export const batchDeleteEstimateOperationSchema = z.object({
  op: z.literal("delete"),
  id: uuidSchema,
});

export const batchReorderEstimateOperationSchema = z.object({
  op: z.literal("reorder"),
  data: reorderEstimateItemsSchema,
});

export const batchOperationSchema = z.discriminatedUnion("op", [
  batchCreateEstimateOperationSchema,
  batchUpdateEstimateOperationSchema,
  batchDeleteEstimateOperationSchema,
  batchReorderEstimateOperationSchema,
]);

export const batchOperationsSchema = z.object({
  concurrency_token: updatedAtTokenSchema.optional(),
  dry_run: z.boolean().optional(),
  operations: z
    .array(batchOperationSchema)
    .min(1, "operations ne peut pas etre vide."),
});

export const estimateSupplierComparisonsRequestSchema = z
  .preprocess(
    (value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return value;
      }

      const record = value as Record<string, unknown>;
      return {
        item_ids: record.item_ids ?? record.itemIds,
      };
    },
    z.object({
      item_ids: z
        .array(uuidSchema)
        .min(1, "item_ids ne peut pas etre vide."),
    })
  )
  .transform((payload) => ({
    item_ids: Array.from(new Set(payload.item_ids)),
  }))
  .superRefine((payload, ctx) => {
    if (payload.item_ids.length <= 200) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "item_ids ne peut pas contenir plus de 200 identifiants.",
      path: ["item_ids"],
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

const marginTierMultiplierSchema = z
  .number()
  .finite("Nombre invalide.")
  .min(0, "Doit etre >= 0.")
  .max(100, "Doit etre <= 100.");

export const createMarginTierSchema = z.object({
  threshold_cents: nonNegativeIntegerSchema,
  multiplier: marginTierMultiplierSchema,
  position: nonNegativeIntegerSchema.optional(),
});

export const updateMarginTierSchema = z
  .object({
    threshold_cents: nonNegativeIntegerSchema.optional(),
    multiplier: marginTierMultiplierSchema.optional(),
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

export const suggestionRuleFeedbackValueSchema = z.enum(["accept", "reject"]);

export const suggestionRuleFeedbackSchema = z.object({
  feedback: suggestionRuleFeedbackValueSchema,
  count: positiveIntegerSchema.optional(),
});

export const suggestionLearningFieldSchema = z.enum([
  "description",
  "category_id",
  "k_fo",
  "k_mo",
  "labor_role_id",
  "supply_type_id",
]);

export const trackSuggestionCorrectionsSchema = z.object({
  corrections: z
    .array(
      z.object({
        rule_id: uuidSchema,
        field_name: suggestionLearningFieldSchema,
        original_value: optionalNullableTextSchema.optional(),
        corrected_value: optionalNullableTextSchema.optional(),
        item_title: optionalNullableTextSchema
          .default("")
          .transform((value) => value ?? ""),
      })
    )
    .min(1, "Au moins une correction est requise.")
    .max(50, "Trop de corrections dans une seule requete."),
});

export const reviewSuggestionLearningSchema = z.object({
  rule_id: uuidSchema,
  field_name: suggestionLearningFieldSchema,
  corrected_value: optionalNullableTextSchema.optional(),
  action: z.enum(["approve", "reject", "reset"]),
});

export const purgeSuggestionLearningSchema = z.object({
  retention_months: positiveIntegerSchema.max(120, "Doit etre <= 120.").optional(),
});

export const createEstimateTemplateFromVersionSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }

    const record = value as Record<string, unknown>;
    return {
      source_version_id: record.source_version_id ?? record.sourceVersionId,
      name: record.name,
      description: record.description,
    };
  },
  z.object({
    source_version_id: uuidSchema,
    name: templateNameSchema,
    description: optionalNullableTextSchema.optional(),
  })
);
export const createEstimateTemplateSchema =
  createEstimateTemplateFromVersionSchema;

export const updateEstimateTemplateSchema = z
  .object({
    name: templateNameSchema.optional(),
    description: optionalNullableTextSchema.optional(),
  })
  .superRefine((payload, ctx) => {
    if (Object.keys(payload).length > 0) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Aucun champ de mise a jour fourni.",
      path: [],
    });
  });

export const listEstimateTemplatesQuerySchema = z.object({
  search: optionalNullableTextSchema.optional(),
  limit: positiveIntegerSchema.max(100, "Doit etre <= 100.").optional().default(10),
  order: z.enum(["recent", "oldest"]).optional().default("recent"),
});

export const instantiateEstimateFromTemplateSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }

    const record = value as Record<string, unknown>;
    return {
      project_id: record.project_id ?? record.projectId,
      project_name: record.project_name ?? record.projectName,
      version_title: record.version_title ?? record.versionTitle,
      date_devis: record.date_devis ?? record.dateDevis,
      validite_jours: record.validite_jours ?? record.validiteJours,
      project_notes: record.project_notes ?? record.projectNotes,
    };
  },
  z
    .object({
      project_id: uuidSchema.optional(),
      project_name: optionalNullableTextSchema.optional(),
      version_title: optionalNullableTextSchema.optional(),
      date_devis: dateOnlySchema.optional(),
      validite_jours: positiveIntegerSchema.optional(),
      project_notes: optionalNullableTextSchema.optional(),
    })
    .superRefine((payload, ctx) => {
      if (payload.project_id || payload.project_name) {
        return;
      }

      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "project_name ou project_id est requis.",
        path: ["project_name"],
      });
    })
    .and(
      z.union([
        z.object({
          project_id: uuidSchema,
        }),
        z.object({
          project_name: z.string().trim().min(1, "Champ obligatoire."),
        }),
      ])
    )
);
export const instantiateEstimateTemplateSchema =
  instantiateEstimateFromTemplateSchema;

export const duplicateEstimateTemplateSchema = z.object({
  name: templateNameSchema.optional(),
});

export const duplicateEstimateSectionSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null || value === "") {
      return {};
    }

    if (typeof value !== "object" || Array.isArray(value)) {
      return value;
    }

    const record = value as Record<string, unknown>;
    return {
      target_version_id:
        record.target_version_id ?? record.targetVersionId ?? null,
    };
  },
  z.object({
    target_version_id: nullableUuidSchema.optional(),
  })
);

export const importEstimateSectionsModeSchema = z.enum(["merge", "append"]);

const importEstimateSectionIdsSchema = z
  .array(uuidSchema)
  .min(1, "section_ids ne peut pas etre vide.")
  .max(100, "section_ids ne peut pas contenir plus de 100 sections.")
  .superRefine((sectionIds, ctx) => {
    const uniqueIds = new Set<string>();

    sectionIds.forEach((sectionId, index) => {
      if (!uniqueIds.has(sectionId)) {
        uniqueIds.add(sectionId);
        return;
      }

      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "section_ids doit contenir des identifiants uniques.",
        path: [index],
      });
    });
  });

export const importEstimateSectionsSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }

    const record = value as Record<string, unknown>;
    return {
      source_version_id:
        record.source_version_id ?? record.sourceVersionId,
      section_ids: record.section_ids ?? record.sectionIds,
      mode: record.mode,
    };
  },
  z.object({
    source_version_id: uuidSchema,
    section_ids: importEstimateSectionIdsSchema,
    mode: importEstimateSectionsModeSchema.optional().default("append"),
  })
);

export const listEstimateImportSourcesQuerySchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }

    const record = value as Record<string, unknown>;
    return {
      exclude_version_id:
        record.exclude_version_id ?? record.excludeVersionId ?? null,
    };
  },
  z.object({
    exclude_version_id: nullableUuidSchema.optional(),
  })
);

const estimateAssemblyItemSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }

    const record = value as Record<string, unknown>;
    return {
      title: record.title,
      unit: record.unit,
      k_fo: record.k_fo ?? record.kFo,
      k_mo: record.k_mo ?? record.kMo,
      labor_role_id: record.labor_role_id ?? record.laborRoleId,
      default_quantity: record.default_quantity ?? record.defaultQuantity,
      position: record.position,
    };
  },
  z.object({
    title: requiredTextSchema,
    unit: optionalNullableTextSchema.optional(),
    k_fo: nonNegativeNumberSchema.optional(),
    k_mo: nonNegativeNumberSchema.optional(),
    labor_role_id: nullableUuidSchema.optional(),
    default_quantity: nullableNonNegativeNumberSchema.optional(),
    position: positiveIntegerSchema,
  })
);

const estimateAssemblyItemsSchema = z
  .array(estimateAssemblyItemSchema)
  .min(1, "Un assemblage doit contenir au moins 1 ligne.")
  .max(50, "Un assemblage ne peut pas contenir plus de 50 lignes.")
  .superRefine((items, ctx) => {
    const positions = new Set<number>();

    items.forEach((item, index) => {
      if (!positions.has(item.position)) {
        positions.add(item.position);
        return;
      }

      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Les positions des lignes doivent etre uniques.",
        path: [index, "position"],
      });
    });
  });

export const createEstimateAssemblySchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }

    const record = value as Record<string, unknown>;
    return {
      name: record.name,
      description: record.description,
      items: record.items,
    };
  },
  z.object({
    name: assemblyNameSchema,
    description: optionalNullableTextSchema.optional(),
    items: estimateAssemblyItemsSchema,
  })
);

export const updateEstimateAssemblySchema = z
  .preprocess(
    (value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return value;
      }

      const record = value as Record<string, unknown>;
      const payload: Record<string, unknown> = {};

      if (Object.prototype.hasOwnProperty.call(record, "name")) {
        payload.name = record.name;
      }
      if (Object.prototype.hasOwnProperty.call(record, "description")) {
        payload.description = record.description;
      }
      if (Object.prototype.hasOwnProperty.call(record, "items")) {
        payload.items = record.items;
      }

      return payload;
    },
    z.object({
      name: assemblyNameSchema.optional(),
      description: optionalNullableTextSchema.optional(),
      items: estimateAssemblyItemsSchema.optional(),
    })
  )
  .superRefine((payload, ctx) => {
    if (Object.keys(payload).length > 0) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Aucun champ de mise a jour fourni.",
      path: [],
    });
  });

export const listEstimateAssembliesQuerySchema = z.object({
  search: optionalNullableTextSchema.optional(),
  limit: positiveIntegerSchema.max(100, "Doit etre <= 100.").optional().default(20),
  order: z.enum(["recent", "oldest"]).optional().default("recent"),
});

export const insertAssemblyIntoVersionSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }

    const record = value as Record<string, unknown>;
    return {
      version_id: record.version_id ?? record.versionId,
      after_item_id: record.after_item_id ?? record.afterItemId ?? null,
    };
  },
  z.object({
    version_id: uuidSchema,
    after_item_id: nullableUuidSchema.optional(),
  })
);

export const insertTemplateIntoVersionSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }

    const record = value as Record<string, unknown>;
    return {
      version_id: record.version_id ?? record.versionId,
      after_item_id: record.after_item_id ?? record.afterItemId ?? null,
    };
  },
  z.object({
    version_id: uuidSchema,
    after_item_id: nullableUuidSchema.optional(),
  })
);

export type CreateEstimateInput = z.infer<typeof createEstimateSchema>;
export type PatchEstimateVersionInput = z.infer<typeof patchEstimateVersionSchema>;
export type PatchEstimateStatusInput = z.infer<typeof patchEstimateStatusSchema>;
export type CreateEstimateVariantInput = z.infer<
  typeof createEstimateVariantSchema
>;
export type PromoteEstimateVariantInput = z.infer<
  typeof promoteEstimateVariantSchema
>;
export type CreateEstimateItemInput = z.infer<typeof createEstimateItemSchema>;
export type UpdateEstimateItemInput = z.infer<typeof updateEstimateItemSchema>;
export type BulkUpdateEstimateItemsInput = z.infer<
  typeof bulkUpdateEstimateItemsSchema
>;
export type BulkUpdateEstimateVersionPatchInput = z.infer<
  typeof bulkUpdateEstimateVersionPatchSchema
>;
export type BulkUpdateEstimateItemsRequestInput = z.infer<
  typeof bulkUpdateEstimateItemsRequestSchema
>;
export type DeleteEstimateItemInput = z.infer<typeof deleteEstimateItemSchema>;
export type ReorderEstimateItemsInput = z.infer<typeof reorderEstimateItemsSchema>;
export type MoveEstimateItemInput = z.infer<typeof moveEstimateItemSchema>;
export type BatchCreateEstimateOperationInput = z.infer<
  typeof batchCreateEstimateOperationSchema
>;
export type BatchUpdateEstimateOperationInput = z.infer<
  typeof batchUpdateEstimateOperationSchema
>;
export type BatchDeleteEstimateOperationInput = z.infer<
  typeof batchDeleteEstimateOperationSchema
>;
export type BatchReorderEstimateOperationInput = z.infer<
  typeof batchReorderEstimateOperationSchema
>;
export type BatchOperationInput = z.infer<typeof batchOperationSchema>;
export type BatchOperationsInput = z.infer<typeof batchOperationsSchema>;
export type EstimateSupplierComparisonsRequestInput = z.infer<
  typeof estimateSupplierComparisonsRequestSchema
>;
export type CreateEstimateCategoryInput = z.infer<
  typeof createEstimateCategorySchema
>;
export type CreateLaborRoleInput = z.infer<typeof createLaborRoleSchema>;
export type UpdateLaborRoleInput = z.infer<typeof updateLaborRoleSchema>;
export type CreateMarginTierInput = z.infer<typeof createMarginTierSchema>;
export type UpdateMarginTierInput = z.infer<typeof updateMarginTierSchema>;
export type CreateSuggestionRuleInput = z.infer<
  typeof createSuggestionRuleSchema
>;
export type UpdateSuggestionRuleInput = z.infer<
  typeof updateSuggestionRuleSchema
>;
export type SuggestionRuleFeedbackValue = z.infer<
  typeof suggestionRuleFeedbackValueSchema
>;
export type SuggestionRuleFeedbackInput = z.infer<
  typeof suggestionRuleFeedbackSchema
>;
export type SuggestionLearningFieldInput = z.infer<
  typeof suggestionLearningFieldSchema
>;
export type TrackSuggestionCorrectionsInput = z.infer<
  typeof trackSuggestionCorrectionsSchema
>;
export type ReviewSuggestionLearningInput = z.infer<
  typeof reviewSuggestionLearningSchema
>;
export type PurgeSuggestionLearningInput = z.infer<
  typeof purgeSuggestionLearningSchema
>;
export type CreateEstimateTemplateFromVersionInput = z.infer<
  typeof createEstimateTemplateFromVersionSchema
>;
export type CreateEstimateTemplateInput = z.infer<
  typeof createEstimateTemplateSchema
>;
export type UpdateEstimateTemplateInput = z.infer<
  typeof updateEstimateTemplateSchema
>;
export type ListEstimateTemplatesQueryInput = z.infer<
  typeof listEstimateTemplatesQuerySchema
>;
export type InstantiateEstimateFromTemplateInput = z.infer<
  typeof instantiateEstimateFromTemplateSchema
>;
export type InstantiateEstimateTemplateInput = z.infer<
  typeof instantiateEstimateTemplateSchema
>;
export type DuplicateEstimateTemplateInput = z.infer<
  typeof duplicateEstimateTemplateSchema
>;
export type DuplicateEstimateSectionInput = z.infer<
  typeof duplicateEstimateSectionSchema
>;
export type ImportEstimateSectionsModeInput = z.infer<
  typeof importEstimateSectionsModeSchema
>;
export type ImportEstimateSectionsInput = z.infer<
  typeof importEstimateSectionsSchema
>;
export type ListEstimateImportSourcesQueryInput = z.infer<
  typeof listEstimateImportSourcesQuerySchema
>;
export type EstimateAssemblyItemInput = z.infer<typeof estimateAssemblyItemSchema>;
export type CreateEstimateAssemblyInput = z.infer<
  typeof createEstimateAssemblySchema
>;
export type UpdateEstimateAssemblyInput = z.infer<
  typeof updateEstimateAssemblySchema
>;
export type ListEstimateAssembliesQueryInput = z.infer<
  typeof listEstimateAssembliesQuerySchema
>;
export type InsertAssemblyIntoVersionInput = z.infer<
  typeof insertAssemblyIntoVersionSchema
>;

// ---------------------------------------------------------------------------
// Wizard step schemas (EST-082)
// ---------------------------------------------------------------------------

export const wizardStep1Schema = z.object({
  projectName: requiredTextSchema,
  clientName: optionalNullableTextSchema.optional(),
  reference: optionalNullableTextSchema.optional(),
  title: optionalNullableTextSchema.optional(),
});

export const wizardStep2Schema = z.object({
  dateDevis: dateOnlySchema,
  validiteJours: positiveIntegerSchema,
  marginMode: estimateMarginModeSchema,
  marginBp: basisPointsSchema.optional(),
  taxRateBp: taxRateBpSchema,
  roundingMode: estimateRoundingModeSchema,
  roundingStepCents: positiveIntegerSchema.optional(),
  currency: estimateCurrencySchema.optional(),
});

export const wizardStep3Schema = z.object({
  creationMode: z.enum(["blank", "template"]),
  selectedTemplateId: z.string().uuid(UUID_ERROR_MESSAGE).optional(),
}).superRefine((data, ctx) => {
  if (data.creationMode === "template" && !data.selectedTemplateId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Veuillez selectionner un template.",
      path: ["selectedTemplateId"],
    });
  }
});

export type WizardStep1Input = z.infer<typeof wizardStep1Schema>;
export type WizardStep2Input = z.infer<typeof wizardStep2Schema>;
export type WizardStep3Input = z.infer<typeof wizardStep3Schema>;
