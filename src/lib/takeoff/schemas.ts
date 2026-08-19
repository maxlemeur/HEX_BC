import { z } from "zod";

import {
  TAKEOFF_JOB_LIST_PERIODS,
  TAKEOFF_JOB_STATUSES,
  TAKEOFF_LEVELS,
} from "@/lib/takeoff/enums";
import {
  TAKEOFF_COMPARE_MAX_THRESHOLD,
  TAKEOFF_COMPARE_MIN_THRESHOLD,
  TAKEOFF_DPGF_COMPARE_MAX_PAGE_SIZE,
} from "@/lib/takeoff/limits";

const requiredTextSchema = z
  .string()
  .trim()
  .min(1, "Champ obligatoire.");

const optionalNullableTextSchema = z
  .union([z.string(), z.null()])
  .transform((value) => {
    if (value === null) return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  });

const positiveQuantitySchema = z
  .number()
  .finite("Nombre invalide.")
  .gt(0, "Doit etre > 0.");

const positiveIntegerSchema = z
  .number()
  .int("Entier attendu.")
  .min(1, "Doit etre >= 1.");

const nonNegativeIntegerSchema = z
  .number()
  .int("Entier attendu.")
  .min(0, "Doit etre >= 0.");

export const takeoffLevelSchema = z.enum(TAKEOFF_LEVELS);

export const takeoffWarningSeveritySchema = z.enum(["info", "warning", "error"]);

const confidenceSchema = z
  .number()
  .finite("Nombre invalide.")
  .min(0, "Doit etre >= 0.")
  .max(1, "Doit etre <= 1.");

const warningCodeSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toUpperCase() : value),
  z
    .string()
    .min(1, "Champ obligatoire.")
    .max(64, "Code trop long.")
);

const takeoffTableRowSchema = z
  .object({
    row_index: nonNegativeIntegerSchema,
    cells: z.array(requiredTextSchema).min(1, "Au moins une cellule est requise."),
  })
  .strict();

export const TakeoffWarningSchema = z
  .object({
    code: warningCodeSchema,
    message: requiredTextSchema.max(500, "Message trop long."),
    severity: takeoffWarningSeveritySchema,
    item_index: nonNegativeIntegerSchema.optional(),
    table_index: nonNegativeIntegerSchema.optional(),
  })
  .strict();

export const TakeoffTableSchema = z
  .object({
    page: positiveIntegerSchema,
    title: optionalNullableTextSchema.optional(),
    headers: z.array(requiredTextSchema).min(1, "Au moins un en-tete est requis."),
    rows: z.array(takeoffTableRowSchema).min(1, "Au moins une ligne est requise."),
  })
  .strict();

export const TakeoffItemSchema = z
  .object({
    designation: requiredTextSchema.max(500, "Designation trop longue."),
    quantity: positiveQuantitySchema,
    unit: requiredTextSchema.max(64, "Unite trop longue."),
    category: optionalNullableTextSchema.optional(),
    source_page: positiveIntegerSchema.optional(),
    source_file: requiredTextSchema.max(255, "Nom de fichier trop long.").optional(),
    confidence: confidenceSchema.optional(),
    evidence: requiredTextSchema.max(2000, "Evidence trop longue.").optional(),
  })
  .strict();

export const TakeoffMetadataSchema = z
  .object({
    level: takeoffLevelSchema,
    prompt_version: requiredTextSchema.max(64, "prompt_version trop long."),
    file_type: requiredTextSchema.max(64, "file_type trop long."),
    schema_version: requiredTextSchema.max(32, "schema_version trop long."),
  })
  .strict();

const takeoffExchangeBaseSchema = z
  .object({
    items: z.array(TakeoffItemSchema),
    warnings: z.array(TakeoffWarningSchema),
    tables: z.array(TakeoffTableSchema).optional(),
    metadata: TakeoffMetadataSchema,
    confidence: confidenceSchema.optional(),
  })
  .strict();

type TakeoffExchangeBasePayload = z.infer<typeof takeoffExchangeBaseSchema>;

function refineTakeoffExchangePayload(
  payload: TakeoffExchangeBasePayload,
  ctx: z.RefinementCtx,
  options: {
    requireLevelBTables: boolean;
  }
) {
  if (
    options.requireLevelBTables &&
    payload.metadata.level === "B" &&
    (!payload.tables || payload.tables.length === 0)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "tables est requis pour le niveau B.",
      path: ["tables"],
    });
  }

  if (payload.metadata.level === "C") {
    if (payload.confidence === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "confidence global est requis pour le niveau C.",
        path: ["confidence"],
      });
    }

    payload.items.forEach((item, index) => {
      if (item.confidence === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "confidence est requis pour chaque item au niveau C.",
          path: ["items", index, "confidence"],
        });
      }

      if (item.source_page === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "source_page est requis pour chaque item au niveau C.",
          path: ["items", index, "source_page"],
        });
      }

      if (!item.evidence || item.evidence.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "evidence est requis pour chaque item au niveau C.",
          path: ["items", index, "evidence"],
        });
      }
    });
  }
}

export const TakeoffChunkExchangeSchema = takeoffExchangeBaseSchema.superRefine(
  (payload, ctx) => {
    refineTakeoffExchangePayload(payload, ctx, {
      requireLevelBTables: false,
    });
  }
);

export const TakeoffExchangeSchema = takeoffExchangeBaseSchema.superRefine(
  (payload, ctx) => {
    refineTakeoffExchangePayload(payload, ctx, {
      requireLevelBTables: true,
    });
  }
);

const takeoffMappingRuleNameSchema = requiredTextSchema.max(160, "Nom trop long.");

const takeoffMappingRulePatternSchema = requiredTextSchema.max(500, "Pattern trop long.");

const takeoffMappingRulePrioritySchema = nonNegativeIntegerSchema.max(
  100000,
  "Priorite trop elevee."
);

export const takeoffMappingRuleIdSchema = z.string().uuid("ruleId invalide.");

export const takeoffMappingRuleMatchTypeSchema = z.enum([
  "exact",
  "contains",
  "regex",
]);

export const takeoffMappingRuleActionSchema = z.enum([
  "rename",
  "set_price",
  "set_category",
  "apply_assembly",
  "skip",
]);

const takeoffRenameActionParamsSchema = z
  .object({
    designation: requiredTextSchema.max(500, "Designation trop longue."),
  })
  .strict();

const takeoffSetPriceActionParamsSchema = z
  .object({
    unit_price_cents: nonNegativeIntegerSchema,
  })
  .strict();

const takeoffSetCategoryActionParamsSchema = z
  .object({
    category_id: z.string().uuid("category_id invalide."),
  })
  .strict();

const takeoffApplyAssemblyActionParamsSchema = z
  .object({
    assembly_id: z.string().uuid("assembly_id invalide."),
  })
  .strict();

const takeoffSkipActionParamsSchema = z.object({}).strict();

function validateRegexMatchPattern(
  input: { match_type: "exact" | "contains" | "regex"; match_pattern: string },
  ctx: z.RefinementCtx
) {
  if (input.match_type !== "regex") return;

  try {
    // Validate user regex early to avoid runtime crashes in mapping engine.
    new RegExp(input.match_pattern);
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "match_pattern doit etre une regex valide quand match_type=regex.",
      path: ["match_pattern"],
    });
  }
}

export const takeoffMappingRuleActionConfigSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("rename"),
      action_params: takeoffRenameActionParamsSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("set_price"),
      action_params: takeoffSetPriceActionParamsSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("set_category"),
      action_params: takeoffSetCategoryActionParamsSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("apply_assembly"),
      action_params: takeoffApplyAssemblyActionParamsSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("skip"),
      action_params: takeoffSkipActionParamsSchema.optional().default({}),
    })
    .strict(),
]);

const takeoffMappingRuleCreateCommonShape = {
  name: takeoffMappingRuleNameSchema,
  match_pattern: takeoffMappingRulePatternSchema,
  match_type: takeoffMappingRuleMatchTypeSchema,
  priority: takeoffMappingRulePrioritySchema.optional(),
  is_active: z.boolean().optional(),
};

export const createTakeoffMappingRuleSchema = z
  .discriminatedUnion("action", [
    z
      .object({
        ...takeoffMappingRuleCreateCommonShape,
        action: z.literal("rename"),
        action_params: takeoffRenameActionParamsSchema,
      })
      .strict(),
    z
      .object({
        ...takeoffMappingRuleCreateCommonShape,
        action: z.literal("set_price"),
        action_params: takeoffSetPriceActionParamsSchema,
      })
      .strict(),
    z
      .object({
        ...takeoffMappingRuleCreateCommonShape,
        action: z.literal("set_category"),
        action_params: takeoffSetCategoryActionParamsSchema,
      })
      .strict(),
    z
      .object({
        ...takeoffMappingRuleCreateCommonShape,
        action: z.literal("apply_assembly"),
        action_params: takeoffApplyAssemblyActionParamsSchema,
      })
      .strict(),
    z
      .object({
        ...takeoffMappingRuleCreateCommonShape,
        action: z.literal("skip"),
        action_params: takeoffSkipActionParamsSchema.optional().default({}),
      })
      .strict(),
  ])
  .superRefine((payload, ctx) => {
    validateRegexMatchPattern(payload, ctx);
  });

const takeoffMappingRuleStoredCommonShape = {
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
  created_by: z.string().uuid().nullable(),
  name: takeoffMappingRuleNameSchema,
  match_pattern: takeoffMappingRulePatternSchema,
  match_type: takeoffMappingRuleMatchTypeSchema,
  priority: takeoffMappingRulePrioritySchema,
  is_active: z.boolean(),
};

export const TakeoffMappingRuleSchema = z
  .discriminatedUnion("action", [
    z
      .object({
        ...takeoffMappingRuleStoredCommonShape,
        action: z.literal("rename"),
        action_params: takeoffRenameActionParamsSchema,
      })
      .strict(),
    z
      .object({
        ...takeoffMappingRuleStoredCommonShape,
        action: z.literal("set_price"),
        action_params: takeoffSetPriceActionParamsSchema,
      })
      .strict(),
    z
      .object({
        ...takeoffMappingRuleStoredCommonShape,
        action: z.literal("set_category"),
        action_params: takeoffSetCategoryActionParamsSchema,
      })
      .strict(),
    z
      .object({
        ...takeoffMappingRuleStoredCommonShape,
        action: z.literal("apply_assembly"),
        action_params: takeoffApplyAssemblyActionParamsSchema,
      })
      .strict(),
    z
      .object({
        ...takeoffMappingRuleStoredCommonShape,
        action: z.literal("skip"),
        action_params: takeoffSkipActionParamsSchema,
      })
      .strict(),
  ])
  .superRefine((payload, ctx) => {
    validateRegexMatchPattern(payload, ctx);
  });

const takeoffMappingRuleUpdateCommonShape = {
  name: takeoffMappingRuleNameSchema.optional(),
  match_pattern: takeoffMappingRulePatternSchema.optional(),
  match_type: takeoffMappingRuleMatchTypeSchema.optional(),
  priority: takeoffMappingRulePrioritySchema.optional(),
  is_active: z.boolean().optional(),
};

const updateTakeoffMappingRuleWithoutActionSchema = z
  .object({
    ...takeoffMappingRuleUpdateCommonShape,
  })
  .strict()
  .superRefine((payload, ctx) => {
    if (Object.keys(payload).length > 0) return;

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Aucun champ de mise a jour fourni.",
      path: [],
    });
  });

export const updateTakeoffMappingRuleSchema = z
  .union([
    updateTakeoffMappingRuleWithoutActionSchema,
    z
      .object({
        ...takeoffMappingRuleUpdateCommonShape,
        action: z.literal("rename"),
        action_params: takeoffRenameActionParamsSchema,
      })
      .strict(),
    z
      .object({
        ...takeoffMappingRuleUpdateCommonShape,
        action: z.literal("set_price"),
        action_params: takeoffSetPriceActionParamsSchema,
      })
      .strict(),
    z
      .object({
        ...takeoffMappingRuleUpdateCommonShape,
        action: z.literal("set_category"),
        action_params: takeoffSetCategoryActionParamsSchema,
      })
      .strict(),
    z
      .object({
        ...takeoffMappingRuleUpdateCommonShape,
        action: z.literal("apply_assembly"),
        action_params: takeoffApplyAssemblyActionParamsSchema,
      })
      .strict(),
    z
      .object({
        ...takeoffMappingRuleUpdateCommonShape,
        action: z.literal("skip"),
        action_params: takeoffSkipActionParamsSchema.optional().default({}),
      })
      .strict(),
  ])
  .superRefine((payload, ctx) => {
    if (payload.match_type === "regex" && payload.match_pattern !== undefined) {
      validateRegexMatchPattern(
        {
          match_type: payload.match_type,
          match_pattern: payload.match_pattern,
        },
        ctx
      );
    }
  });

export const takeoffMappingOverrideActionSchema = z.enum([
  "rename",
  "set_price",
  "set_category",
  "apply_assembly",
  "skip",
  "none",
]);

const takeoffMappingOverrideBaseShape = {
  item_id: z.string().uuid("item_id invalide."),
};

export const takeoffMappingOverrideSchema = z.discriminatedUnion("action", [
  z
    .object({
      ...takeoffMappingOverrideBaseShape,
      action: z.literal("rename"),
      action_params: takeoffRenameActionParamsSchema,
    })
    .strict(),
  z
    .object({
      ...takeoffMappingOverrideBaseShape,
      action: z.literal("set_price"),
      action_params: takeoffSetPriceActionParamsSchema,
    })
    .strict(),
  z
    .object({
      ...takeoffMappingOverrideBaseShape,
      action: z.literal("set_category"),
      action_params: takeoffSetCategoryActionParamsSchema,
    })
    .strict(),
  z
    .object({
      ...takeoffMappingOverrideBaseShape,
      action: z.literal("apply_assembly"),
      action_params: takeoffApplyAssemblyActionParamsSchema,
    })
    .strict(),
  z
    .object({
      ...takeoffMappingOverrideBaseShape,
      action: z.literal("skip"),
      action_params: takeoffSkipActionParamsSchema.optional().default({}),
    })
    .strict(),
  z
    .object({
      ...takeoffMappingOverrideBaseShape,
      action: z.literal("none"),
      action_params: takeoffSkipActionParamsSchema.optional().default({}),
    })
    .strict(),
]);

const takeoffApplyStrategySchema = z.enum(["append", "replace", "merge"]);

export const takeoffApplyRequestSchema = z
  .object({
    strategy: takeoffApplyStrategySchema,
    target_section_id: z.string().uuid("target_section_id invalide.").nullable().optional(),
    overrides: z.array(takeoffMappingOverrideSchema).optional(),
    override: z.boolean().optional(),
    override_justification: z
      .string()
      .trim()
      .min(10, "Justification trop courte (min 10 caracteres).")
      .max(500, "Justification trop longue.")
      .optional(),
  })
  .strict()
  .superRefine((payload, ctx) => {
    if (payload.override === true && !payload.override_justification) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "override_justification est obligatoire quand override=true.",
        path: ["override_justification"],
      });
    }

    if (payload.override !== true && payload.override_justification) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "override_justification ne peut etre fourni que si override=true.",
        path: ["override_justification"],
      });
    }

    if (!payload.overrides || payload.overrides.length === 0) {
      return;
    }

    const seenIds = new Set<string>();
    payload.overrides.forEach((override, index) => {
      if (!seenIds.has(override.item_id)) {
        seenIds.add(override.item_id);
        return;
      }

      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "overrides doit contenir des item_id uniques.",
        path: ["overrides", index, "item_id"],
      });
    });
  });

const takeoffMappingPreviewStateSchema = z
  .object({
    designation: requiredTextSchema.max(500, "Designation trop longue."),
    quantity: positiveQuantitySchema,
    unit: requiredTextSchema.max(64, "Unite trop longue."),
    is_excluded: z.boolean(),
    category_id: z.string().uuid("category_id invalide.").nullable(),
    unit_price_cents: nonNegativeIntegerSchema.nullable(),
    assembly_id: z.string().uuid("assembly_id invalide.").nullable(),
  })
  .strict();

export const takeoffMappingPreviewItemSchema = z
  .object({
    item_id: z.string().uuid("item_id invalide."),
    source_order: nonNegativeIntegerSchema,
    rule_id: z.string().uuid("rule_id invalide.").nullable(),
    rule_name: z.string().nullable(),
    action: takeoffMappingOverrideActionSchema,
    action_params: z.record(z.string(), z.unknown()),
    applied_by: z.enum(["none", "rule", "override"]),
    original: takeoffMappingPreviewStateSchema,
    transformed: takeoffMappingPreviewStateSchema,
  })
  .strict();

export const takeoffPreviewConversionResponseSchema = z
  .object({
    job_id: z.string().uuid("job_id invalide."),
    strategy: takeoffApplyStrategySchema,
    target_section_id: z.string().uuid("target_section_id invalide.").nullable(),
    summary: z
      .object({
        total_count: nonNegativeIntegerSchema,
        included_count: nonNegativeIntegerSchema,
        transformed_count: nonNegativeIntegerSchema,
        overridden_count: nonNegativeIntegerSchema,
        excluded_by_mapping_count: nonNegativeIntegerSchema,
        assembly_insertions_count: nonNegativeIntegerSchema,
      })
      .strict(),
    items: z.array(takeoffMappingPreviewItemSchema),
  })
  .strict();

const GEMINI_RESPONSE_SCHEMA_KEYS = new Set([
  "type",
  "format",
  "title",
  "description",
  "nullable",
  "enum",
  "maxItems",
  "minItems",
  "properties",
  "required",
  "minProperties",
  "maxProperties",
  "minLength",
  "maxLength",
  "pattern",
  "example",
  "anyOf",
  "propertyOrdering",
  "default",
  "items",
  "minimum",
  "maximum",
]);

function isSchemaRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeGeminiJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeGeminiJsonSchema(item));
  }

  if (!isSchemaRecord(value)) {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!GEMINI_RESPONSE_SCHEMA_KEYS.has(key)) {
      continue;
    }

    if (key === "properties" && isSchemaRecord(item)) {
      result.properties = Object.fromEntries(
        Object.entries(item).map(([propertyName, propertySchema]) => [
          propertyName,
          sanitizeGeminiJsonSchema(propertySchema),
        ])
      );
      continue;
    }

    if (key === "default" || key === "example") {
      result[key] = item;
      continue;
    }

    result[key] = sanitizeGeminiJsonSchema(item);
  }

  if (typeof value.exclusiveMinimum === "number") {
    const compatibleMinimum =
      value.type === "integer"
        ? Math.floor(value.exclusiveMinimum) + 1
        : value.exclusiveMinimum;
    result.minimum =
      typeof result.minimum === "number"
        ? Math.max(result.minimum, compatibleMinimum)
        : compatibleMinimum;
  }

  if (typeof value.exclusiveMaximum === "number") {
    const compatibleMaximum =
      value.type === "integer"
        ? Math.ceil(value.exclusiveMaximum) - 1
        : value.exclusiveMaximum;
    result.maximum =
      typeof result.maximum === "number"
        ? Math.min(result.maximum, compatibleMaximum)
        : compatibleMaximum;
  }

  return result;
}

export function zodToGeminiJsonSchema(
  schema: z.ZodType = TakeoffExchangeSchema
): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, {
    target: "draft-07",
    io: "input",
    unrepresentable: "throw",
  });

  return sanitizeGeminiJsonSchema(jsonSchema) as Record<string, unknown>;
}


export const MAX_TAKEOFF_JOBS_LIST_LIMIT = 100;
export const MAX_TAKEOFF_JOB_ITEMS_LIMIT = 200;
export const MAX_TAKEOFF_JOB_ITEMS_OFFSET = 10_000;

const optionalUuidSearchParamSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  },
  z.string().uuid("estimate_version_id invalide.").optional()
);

const optionalProjectIdSearchParamSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  },
  z.string().uuid("project_id invalide.").optional()
);

const optionalStatusSearchParamSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  },
  z.enum(TAKEOFF_JOB_STATUSES).optional()
);

const optionalLevelSearchParamSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  },
  z.enum(TAKEOFF_LEVELS).optional()
);

const optionalPeriodSearchParamSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  },
  z.enum(TAKEOFF_JOB_LIST_PERIODS).optional()
);

const optionalLimitSearchParamSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "number") return value;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : value;
  },
  z
    .number()
    .int("limit doit etre un entier.")
    .min(1, "limit doit etre >= 1.")
    .max(
      MAX_TAKEOFF_JOBS_LIST_LIMIT,
      `limit doit etre <= ${MAX_TAKEOFF_JOBS_LIST_LIMIT}.`
    )
    .optional()
);

const optionalItemsLimitSearchParamSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "number") return value;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : value;
  },
  z
    .number()
    .int("items_limit doit etre un entier.")
    .min(1, "items_limit doit etre >= 1.")
    .max(
      MAX_TAKEOFF_JOB_ITEMS_LIMIT,
      `items_limit doit etre <= ${MAX_TAKEOFF_JOB_ITEMS_LIMIT}.`
    )
    .optional()
);

const requiredUuidSearchParamSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  },
  z.string().uuid("Parametre UUID invalide.")
);

const optionalCompareThresholdSearchParamSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "number") return value;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : value;
  },
  z
    .number()
    .min(
      TAKEOFF_COMPARE_MIN_THRESHOLD,
      `threshold doit etre >= ${TAKEOFF_COMPARE_MIN_THRESHOLD}.`
    )
    .max(
      TAKEOFF_COMPARE_MAX_THRESHOLD,
      `threshold doit etre <= ${TAKEOFF_COMPARE_MAX_THRESHOLD}.`
    )
    .optional()
);

const optionalOffsetSearchParamSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "number") return value;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : value;
  },
  z
    .number()
    .int("offset doit etre un entier.")
    .min(0, "offset doit etre >= 0.")
    .max(
      MAX_TAKEOFF_JOB_ITEMS_OFFSET,
      `offset doit etre <= ${MAX_TAKEOFF_JOB_ITEMS_OFFSET}.`
    )
    .optional()
);

const optionalCursorSearchParamSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  },
  z.string().max(512, "cursor trop long.").optional()
);

const optionalDpgfComparePageSizeSearchParamSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "number") return value;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : value;
  },
  z
    .number()
    .int("page_size doit etre un entier.")
    .min(1, "page_size doit etre >= 1.")
    .max(
      TAKEOFF_DPGF_COMPARE_MAX_PAGE_SIZE,
      `page_size doit etre <= ${TAKEOFF_DPGF_COMPARE_MAX_PAGE_SIZE}.`
    )
    .optional()
);

export const takeoffJobIdSchema = z.string().uuid("jobId invalide.");

export const listTakeoffJobsQuerySchema = z
  .object({
    estimate_version_id: optionalUuidSearchParamSchema,
    project_id: optionalProjectIdSearchParamSchema,
    status: optionalStatusSearchParamSchema,
    level: optionalLevelSearchParamSchema,
    period: optionalPeriodSearchParamSchema,
    limit: optionalLimitSearchParamSchema,
    offset: optionalOffsetSearchParamSchema,
  })
  .strict()
  .refine(
    (data) => !(data.project_id && data.estimate_version_id),
    {
      message:
        "project_id et estimate_version_id sont mutuellement exclusifs.",
      path: ["project_id"],
    }
  );

export const getTakeoffJobDetailsQuerySchema = z
  .object({
    items_limit: optionalItemsLimitSearchParamSchema,
    items_offset: optionalOffsetSearchParamSchema,
  })
  .strict();

export const compareTakeoffJobsQuerySchema = z
  .object({
    with: requiredUuidSearchParamSchema,
    threshold: optionalCompareThresholdSearchParamSchema,
  })
  .strict();

export const takeoffDpgfComparisonQuerySchema = z
  .object({
    version_id: requiredUuidSearchParamSchema,
    cursor: optionalCursorSearchParamSchema,
    page_size: optionalDpgfComparePageSizeSearchParamSchema,
    threshold: optionalCompareThresholdSearchParamSchema,
    view: z.enum(["all", "exceptions_only"]).optional().default("all"),
  })
  .strict();

export const takeoffLineEvidencePanelQuerySchema = z
  .object({
    version_id: requiredUuidSearchParamSchema,
  })
  .strict();

export const takeoffPriceSuggestionQuerySchema = z
  .object({
    version_id: requiredUuidSearchParamSchema,
    estimate_item_id: requiredUuidSearchParamSchema,
  })
  .strict();

export const takeoffRiskRadarQuerySchema = z
  .object({
    version_id: requiredUuidSearchParamSchema,
    severity: z.enum(["info", "warning", "critical"]).optional(),
    status: z.enum(["to_process", "assumed", "false_positive"]).optional(),
    scope: z.enum(["project", "lot", "line"]).optional(),
    lot_id: z.string().uuid("lot_id invalide.").optional(),
  })
  .strict();

export const saveTakeoffDpgfManualLinkSchema = z
  .object({
    version_id: z.string().uuid("version_id invalide."),
    estimate_item_id: z.string().uuid("estimate_item_id invalide."),
    takeoff_item_ids: z
      .array(z.string().uuid("takeoff_item_id invalide."))
      .max(50, "Maximum 50 items takeoff relies par ligne.")
      .default([]),
  })
  .strict();

export const saveTakeoffReviewDecisionSchema = z
  .object({
    version_id: z.string().uuid("version_id invalide."),
    estimate_item_id: z.string().uuid("estimate_item_id invalide."),
    decision: z.enum(["keep_dpgf", "keep_takeoff", "manual_fix", "out_of_scope"]),
    reason: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export const requestTakeoffPriceSuggestionSchema = z
  .object({
    version_id: z.string().uuid("version_id invalide."),
    estimate_item_id: z.string().uuid("estimate_item_id invalide."),
    force_refresh: z.boolean().optional(),
  })
  .strict();

export const reviewTakeoffPriceSuggestionSchema = z
  .object({
    version_id: z.string().uuid("version_id invalide."),
    action: z.enum([
      "apply_low",
      "apply_target",
      "apply_high",
      "keep_current",
      "reject",
    ]),
    review_note: z
      .string()
      .trim()
      .min(1, "Une note humaine explicite est obligatoire.")
      .max(2000, "review_note trop longue."),
  })
  .strict();

export const updateTakeoffRiskAlertStatusSchema = z
  .object({
    version_id: z.string().uuid("version_id invalide."),
    status: z.enum(["to_process", "assumed", "false_positive"]),
    review_note: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.status === "assumed" || value.status === "false_positive") &&
      (!value.review_note || value.review_note.trim().length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["review_note"],
        message: "Une note humaine explicite est obligatoire pour ce statut.",
      });
    }
  });

export const takeoffApplyPayloadSchema = takeoffApplyRequestSchema;

export type ListTakeoffJobsQuery = z.infer<typeof listTakeoffJobsQuerySchema>;
export type GetTakeoffJobDetailsQuery = z.infer<
  typeof getTakeoffJobDetailsQuerySchema
>;
export type CompareTakeoffJobsQuery = z.infer<typeof compareTakeoffJobsQuerySchema>;
export type TakeoffDpgfComparisonQuery = z.infer<
  typeof takeoffDpgfComparisonQuerySchema
>;
export type TakeoffLineEvidencePanelQuery = z.infer<
  typeof takeoffLineEvidencePanelQuerySchema
>;
export type TakeoffPriceSuggestionQuery = z.infer<
  typeof takeoffPriceSuggestionQuerySchema
>;
export type TakeoffRiskRadarQuery = z.infer<typeof takeoffRiskRadarQuerySchema>;
export type SaveTakeoffReviewDecisionPayload = z.infer<
  typeof saveTakeoffReviewDecisionSchema
>;
export type RequestTakeoffPriceSuggestionPayload = z.infer<
  typeof requestTakeoffPriceSuggestionSchema
>;
export type ReviewTakeoffPriceSuggestionPayload = z.infer<
  typeof reviewTakeoffPriceSuggestionSchema
>;
