import { z, type ZodTypeAny } from "zod";

import {
  batchOperationsSchema,
  bulkUpdateEstimateItemsRequestSchema,
  createEstimateAssemblySchema,
  createEstimateCategorySchema,
  createEstimateItemSchema,
  createEstimateSchema,
  createEstimateTemplateFromVersionSchema,
  createEstimateVariantSchema,
  createLaborRoleSchema,
  createSuggestionRuleSchema,
  deleteEstimateItemSchema,
  duplicateEstimateTemplateSchema,
  estimateSupplierComparisonsRequestSchema,
  instantiateEstimateFromTemplateSchema,
  listEstimateAssembliesQuerySchema,
  listEstimateTemplatesQuerySchema,
  moveEstimateItemSchema,
  patchEstimateStatusSchema,
  patchEstimateVersionSchema,
  promoteEstimateVariantSchema,
  purgeSuggestionLearningSchema,
  reviewSuggestionLearningSchema,
  reorderEstimateItemsSchema,
  suggestionLearningFieldSchema,
  suggestionRuleFeedbackSchema,
  trackSuggestionCorrectionsSchema,
  updateEstimateAssemblySchema,
  updateEstimateItemSchema,
  updateEstimateTemplateSchema,
  updateLaborRoleSchema,
  updateSuggestionRuleSchema,
} from "@/lib/estimates/schemas";

export type OpenApiHttpMethod = "get" | "post" | "patch" | "delete";
export type OpenApiSchemaIO = "input" | "output";
export type OpenApiContentType =
  | "application/json"
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type OpenApiSchemaDefinition = {
  schemaName: string;
  schema: ZodTypeAny;
  io?: OpenApiSchemaIO;
};

export type OpenApiParameterDefinition = OpenApiSchemaDefinition & {
  in: "path" | "query" | "header";
  name: string;
  description: string;
  required?: boolean;
};

export type OpenApiRequestBodyDefinition = OpenApiSchemaDefinition & {
  required?: boolean;
  description?: string;
  contentType?: "application/json";
};

export type OpenApiResponseHeaderDefinition = OpenApiSchemaDefinition & {
  name: string;
  description: string;
  required?: boolean;
};

export type OpenApiResponseContentDefinition = {
  contentType: OpenApiContentType;
  schema?: OpenApiSchemaDefinition;
};

export type OpenApiResponseDefinition = {
  description: string;
  contents?: OpenApiResponseContentDefinition[];
  headers?: OpenApiResponseHeaderDefinition[];
};

export type OpenApiOperationDefinition = {
  method: OpenApiHttpMethod;
  path: string;
  summary: string;
  description: string;
  tags: string[];
  parameters?: OpenApiParameterDefinition[];
  requestBody?: OpenApiRequestBodyDefinition;
  responses: Record<string, OpenApiResponseDefinition>;
};

function schemaDefinition(
  name: string,
  schema: ZodTypeAny,
  io: OpenApiSchemaIO = "input"
): OpenApiSchemaDefinition {
  return {
    schemaName: name,
    schema,
    io,
  };
}

function pathParameter(input: {
  name: string;
  description: string;
  schemaName: string;
  schema: ZodTypeAny;
}): OpenApiParameterDefinition {
  return {
    in: "path",
    name: input.name,
    description: input.description,
    required: true,
    ...schemaDefinition(input.schemaName, input.schema, "input"),
  };
}

function queryParameter(input: {
  name: string;
  description: string;
  schemaName: string;
  schema: ZodTypeAny;
  required?: boolean;
}): OpenApiParameterDefinition {
  return {
    in: "query",
    name: input.name,
    description: input.description,
    required: input.required ?? false,
    ...schemaDefinition(input.schemaName, input.schema, "input"),
  };
}

function headerParameter(input: {
  name: string;
  description: string;
  schemaName: string;
  schema: ZodTypeAny;
  required?: boolean;
}): OpenApiParameterDefinition {
  return {
    in: "header",
    name: input.name,
    description: input.description,
    required: input.required ?? false,
    ...schemaDefinition(input.schemaName, input.schema, "input"),
  };
}

function responseHeader(input: {
  name: string;
  description: string;
  schemaName: string;
  schema: ZodTypeAny;
  required?: boolean;
}): OpenApiResponseHeaderDefinition {
  return {
    name: input.name,
    description: input.description,
    required: input.required ?? false,
    ...schemaDefinition(input.schemaName, input.schema, "output"),
  };
}

function jsonBody(input: {
  name: string;
  description: string;
  schema: ZodTypeAny;
  required?: boolean;
}): OpenApiRequestBodyDefinition {
  return {
    contentType: "application/json",
    required: input.required ?? true,
    description: input.description,
    ...schemaDefinition(input.name, input.schema, "input"),
  };
}

function successEnvelopeSchema(dataSchema: ZodTypeAny) {
  return z.object({
    ok: z.literal(true),
    data: dataSchema,
  });
}

function successResponseSchemaDefinition(
  schemaName: string,
  dataSchema: ZodTypeAny
): OpenApiSchemaDefinition {
  return schemaDefinition(
    schemaName,
    successEnvelopeSchema(dataSchema),
    "output"
  );
}

function jsonResponse(
  description: string,
  schema: OpenApiSchemaDefinition = successResponseSchemaDefinition(
    "ApiSuccessUnknown",
    z.unknown()
  )
): OpenApiResponseDefinition {
  return {
    description,
    contents: [
      {
        contentType: "application/json",
        schema,
      },
    ],
  };
}

const uuidSchema = z.string().uuid("Identifiant invalide.");
const ifMatchHeaderSchema = z.string().trim().min(1, "Jeton de concurrence invalide.");
const forceQuerySchema = z.enum(["0", "1", "true", "false"]);
const dryRunQuerySchema = z.enum(["0", "1", "true", "false"]);
const suggestPricesQuerySchema = z
  .string()
  .trim()
  .min(2, "Le parametre q doit contenir au moins 2 caracteres.");
const changelogFormatQuerySchema = z.enum(["json", "pdf"]);
const pdfFormatQuerySchema = z.enum(["json"]);
const exportFormatQuerySchema = z.enum(["xlsx"]);

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

export const apiFailureResponseSchema = z.object({
  ok: z.literal(false),
  error: apiErrorSchema,
});

export const apiSuccessUnknownSchema = successEnvelopeSchema(z.unknown());

const outlierFlagSchema = z.enum(["price_outlier", "quantity_outlier"]);

const outlierStateSchema = z.object({
  dismissed_by_item_id: z.record(z.string(), z.array(outlierFlagSchema)),
});

const toggleOutlierDismissSchema = z.object({
  item_id: uuidSchema,
  flag_key: outlierFlagSchema,
  dismissed: z.boolean(),
});

export const apiOutlierStateResponseSchema = z.object({
  ok: z.literal(true),
  data: outlierStateSchema,
});

const pdfStatusSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("missing"),
  }),
  z.object({
    status: z.literal("processing"),
    last_error: z.string().optional(),
  }),
  z.object({
    status: z.literal("failed"),
    last_error: z.string().optional(),
  }),
  z.object({
    status: z.literal("ready"),
    download_url: z.string().url(),
    file_path: z.string(),
    sha256_hash: z.string().optional(),
    generated_at: z.string().optional(),
    file_size_bytes: z.number().int().min(0).optional(),
  }),
]);

export const apiPdfStatusResponseSchema = z.object({
  ok: z.literal(true),
  data: pdfStatusSchema,
});

const insertAssemblyIntoVersionBodySchema = z.object({
  after_item_id: z.union([uuidSchema, z.null()]).optional(),
});

const estimateStatusSchema = z.enum(["draft", "sent", "accepted", "archived"]);
const estimateItemTypeSchema = z.enum(["section", "line"]);
const suggestionFeedbackSchema = z.enum(["accept", "reject"]);
const supplierAlternativeKindSchema = z.enum([
  "best_price",
  "most_recent",
  "preferred_supplier",
]);
const changelogCacheStatusSchema = z.enum(["hit", "miss", "stale"]);
const batchOperationTypeSchema = z.enum(["create", "update", "delete", "reorder"]);

const estimateProjectSchema = z
  .object({
    id: uuidSchema,
    tenant_id: uuidSchema.optional(),
    user_id: uuidSchema.optional(),
    name: z.string(),
    reference: z.string().nullable().optional(),
    client_name: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    is_archived: z.boolean().optional(),
  })
  .passthrough();

const estimateVersionSchema = z
  .object({
    id: uuidSchema,
    tenant_id: uuidSchema.optional(),
    project_id: uuidSchema,
    version_number: z.number().int(),
    status: estimateStatusSchema,
    title: z.string().nullable().optional(),
    date_devis: z.string().optional(),
    validite_jours: z.number().int().optional(),
    margin_multiplier: z.number().optional(),
    margin_mode: z.string().optional(),
    currency: z.string().optional(),
    margin_bp: z.number().int().optional(),
    discount_bp: z.number().int().optional(),
    discount_mode: z.string().optional(),
    discount_steps: z.array(z.number()).optional(),
    global_coefficient: z.number().optional(),
    tax_rate_bp: z.number().int().optional(),
    rounding_mode: z.string().optional(),
    rounding_step_cents: z.number().int().optional(),
    total_ht_cents: z.number().int().nullable().optional(),
    total_tax_cents: z.number().int().nullable().optional(),
    total_ttc_cents: z.number().int().nullable().optional(),
    parent_version_id: uuidSchema.nullable().optional(),
    variant_label: z.string().nullable().optional(),
    seal_hash: z.string().nullable().optional(),
    updated_at: z.string().optional(),
    created_at: z.string().optional(),
    estimate_projects: z
      .union([estimateProjectSchema, z.array(estimateProjectSchema)])
      .nullable()
      .optional(),
  })
  .passthrough();

const estimateItemSchema = z
  .object({
    id: uuidSchema,
    version_id: uuidSchema,
    parent_id: uuidSchema.nullable().optional(),
    item_type: estimateItemTypeSchema,
    position: z.number().int(),
    title: z.string(),
    description: z.string().nullable().optional(),
    quantity: z.number().nullable().optional(),
    unit_price_ht_cents: z.number().nullable().optional(),
    tax_rate_bp: z.number().int().nullable().optional(),
    k_fo: z.number().nullable().optional(),
    h_mo: z.number().nullable().optional(),
    h_mo_majoration: z.number().nullable().optional(),
    k_mo: z.number().nullable().optional(),
    h_mo_atelier: z.number().nullable().optional(),
    k_mo_atelier: z.number().nullable().optional(),
    labor_role_atelier_id: uuidSchema.nullable().optional(),
    h_mo_chantier: z.number().nullable().optional(),
    k_mo_chantier: z.number().nullable().optional(),
    labor_role_chantier_id: uuidSchema.nullable().optional(),
    pu_ht_cents: z.number().nullable().optional(),
    labor_role_id: uuidSchema.nullable().optional(),
    category_id: uuidSchema.nullable().optional(),
    supply_type_id: uuidSchema.nullable().optional(),
    selected_supplier_price_id: uuidSchema.nullable().optional(),
    line_total_ht_cents: z.number().nullable().optional(),
    line_tax_cents: z.number().nullable().optional(),
    line_total_ttc_cents: z.number().nullable().optional(),
  })
  .passthrough();

const estimateCategorySchema = z
  .object({
    id: uuidSchema,
    name: z.string(),
    color: z.string().nullable().optional(),
    position: z.number().int(),
  })
  .passthrough();

const supplyTypeSchema = z
  .object({
    id: uuidSchema,
    name: z.string(),
  })
  .passthrough();

const laborRoleSchema = z
  .object({
    id: uuidSchema,
    name: z.string(),
    hourly_rate_cents: z.number().int().optional(),
    is_active: z.boolean().optional(),
    position: z.number().int().optional(),
  })
  .passthrough();

const suggestionRuleSchema = z
  .object({
    id: uuidSchema,
    name: z.string(),
    match_type: z.string(),
    match_value: z.string(),
    unit: z.string().nullable().optional(),
    category_id: uuidSchema.nullable().optional(),
    k_fo: z.number().nullable().optional(),
    k_mo: z.number().nullable().optional(),
    labor_role_id: uuidSchema.nullable().optional(),
    position: z.number().int().optional(),
    is_active: z.boolean().optional(),
    usage_count: z.number().int().optional(),
    last_used_at: z.string().nullable().optional(),
  })
  .passthrough();

const suggestionLearningReviewStatusSchema = z.enum(["approved", "rejected"]);

const suggestionLearningProposalSchema = z.object({
  rule_id: uuidSchema,
  field_name: suggestionLearningFieldSchema,
  corrected_value: z.string().nullable(),
  correction_count: z.number().int(),
  first_seen_at: z.string(),
  last_seen_at: z.string(),
  review_status: suggestionLearningReviewStatusSchema.nullable(),
  decided_by: uuidSchema.nullable(),
  decided_at: z.string().nullable(),
  is_active: z.boolean(),
  sample_original_value: z.string().nullable(),
  sample_item_title: z.string().nullable(),
});

const suggestionLearningRuleBoostSchema = z.object({
  rule_id: uuidSchema,
  learning_boost: z.number(),
  overrides: z.object({
    description: z.string().nullable().optional(),
    category_id: uuidSchema.nullable().optional(),
    k_fo: z.number().nullable().optional(),
    k_mo: z.number().nullable().optional(),
    labor_role_id: uuidSchema.nullable().optional(),
    supply_type_id: uuidSchema.nullable().optional(),
  }),
  fields: z.array(suggestionLearningProposalSchema),
});

const suggestionLearningConfigSchema = z.object({
  enabled: z.boolean(),
  threshold: z.number().int(),
  retention_months: z.number().int(),
});

const suggestionLearningStateSchema = z.object({
  config: suggestionLearningConfigSchema,
  proposals: z.array(suggestionLearningProposalSchema),
  by_rule_id: z.record(z.string(), suggestionLearningRuleBoostSchema),
});

const suggestionLearningTrackResultSchema = suggestionLearningStateSchema.extend({
  tracked_count: z.number().int(),
});

const suggestionLearningPurgeResultSchema = suggestionLearningStateSchema.extend({
  deleted_count: z.number().int(),
  retention_months: z.number().int(),
});

const marginTierSchema = z
  .object({
    id: uuidSchema,
    threshold_cents: z.number().int(),
    multiplier: z.number(),
    position: z.number().int(),
  })
  .passthrough();

const estimateVersionEventSchema = z
  .object({
    id: uuidSchema,
    estimate_version_id: uuidSchema,
    event_type: z.string(),
    metadata: z.unknown(),
    created_by: uuidSchema.nullable(),
    actor_name: z.string().nullable(),
    occurred_at: z.string(),
    created_at: z.string(),
  })
  .passthrough();

const estimateListItemSchema = z.object({
  project_id: uuidSchema,
  project_name: z.string(),
  project_reference: z.string().nullable(),
  project_client_name: z.string().nullable(),
  version_id: uuidSchema,
  version_number: z.number().int(),
  status: estimateStatusSchema,
  title: z.string().nullable(),
  updated_at: z.string(),
  total_ht_cents: z.number().int(),
});

const estimateVersionTokenSchema = z.object({
  id: uuidSchema,
  updated_at: z.string(),
});

const suggestedSupplierAlternativeSchema = z.object({
  kind: supplierAlternativeKindSchema,
  supplier_price_id: uuidSchema,
  supplier_id: uuidSchema,
  supplier_name: z.string(),
  unit_price_cents: z.number().int(),
  adjusted_unit_price_cents: z.number().int(),
  currency: z.string().nullable(),
  supplier_reference: z.string().nullable(),
  unit: z.string().nullable(),
  updated_at: z.string().nullable(),
  is_stale: z.boolean(),
  catalogue_url: z.string().nullable(),
});

const suggestedCataloguePriceSchema = z.object({
  supplier_price_id: uuidSchema,
  product_id: uuidSchema,
  product_designation: z.string(),
  product_reference: z.string().nullable(),
  supplier_id: uuidSchema,
  supplier_name: z.string(),
  supplier_reference: z.string().nullable(),
  unit: z.string().nullable(),
  unit_price_cents: z.number().int(),
  adjusted_unit_price_cents: z.number().int(),
  currency: z.string().nullable(),
  updated_at: z.string().nullable(),
  is_stale: z.boolean(),
  stale_days: z.number().int(),
  relevance_score: z.number(),
  has_material_index_adjustment: z.boolean(),
  material_index_code: z.string().nullable(),
  material_index_value: z.number().nullable(),
  catalogue_url: z.string().nullable(),
  alternatives: z.array(suggestedSupplierAlternativeSchema),
});

const estimateSupplierComparisonAlternativeSchema = z.object({
  supplier_price_id: uuidSchema,
  supplier_name: z.string(),
  adjusted_unit_price_cents: z.number().int(),
  supplier_reference: z.string().nullable(),
  catalogue_url: z.string().nullable(),
  updated_at: z.string().nullable(),
  is_stale: z.boolean(),
  product_designation: z.string(),
});

const estimateSupplierComparisonSchema = z.object({
  item_id: uuidSchema,
  selected_supplier_price_id: uuidSchema.nullable(),
  best_supplier_price_id: uuidSchema.nullable(),
  alternatives: z.array(estimateSupplierComparisonAlternativeSchema),
});

const estimateBatchResultSchema = z.object({
  committed: z.boolean(),
  results: z.array(
    z.union([
      z.object({
        index: z.number().int(),
        op: batchOperationTypeSchema,
        status: z.literal("ok"),
        data: z.unknown(),
      }),
      z.object({
        index: z.number().int(),
        op: batchOperationTypeSchema,
        status: z.literal("error"),
        code: z.string(),
        message: z.string(),
        details: z.unknown().optional(),
      }),
    ])
  ),
});

const estimateGatingFlagSchema = z.object({
  key: z.string(),
  severity: z.enum(["blocking", "warning"]),
  count: z.number().int(),
  item_ids: z.array(uuidSchema),
  label: z.string(),
  description: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

const estimateGatingSchema = z.object({
  canSend: z.boolean(),
  blockingFlags: z.array(estimateGatingFlagSchema),
  warningFlags: z.array(estimateGatingFlagSchema),
  stalePriceDays: z.number().int(),
  checkedAt: z.string(),
});

const estimateChangelogFieldSchema = z.object({
  field: z.string(),
  label: z.string(),
  kind: z.string(),
  beforeValue: z.union([z.string(), z.number(), z.null()]),
  afterValue: z.union([z.string(), z.number(), z.null()]),
});

const estimateChangelogChangeSchema = z.object({
  key: z.string(),
  changeType: z.string(),
  entityType: z.string(),
  designation: z.string(),
  fields: z.array(estimateChangelogFieldSchema),
  deltaHtCents: z.number(),
  deltaTtcCents: z.number(),
});

const estimateChangelogSchema = z.object({
  sections: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      path: z.array(z.string()),
      changes: z.array(estimateChangelogChangeSchema),
      deltaHtCents: z.number(),
      deltaTtcCents: z.number(),
    })
  ),
  summary: z.object({
    addedCount: z.number().int(),
    removedCount: z.number().int(),
    modifiedCount: z.number().int(),
    totalChangeCount: z.number().int(),
    deltaHtCents: z.number(),
    deltaTtcCents: z.number(),
  }),
});

const estimateDraftLockOwnerSchema = z.object({
  id: uuidSchema,
  full_name: z.string().nullable(),
  work_email: z.string().nullable(),
});

const estimateDraftLockSchema = z.object({
  id: uuidSchema,
  version_id: uuidSchema,
  tenant_id: uuidSchema,
  user_id: uuidSchema,
  locked_at: z.string(),
  expires_at: z.string(),
  is_current_user: z.boolean(),
  is_expired: z.boolean(),
  owner: estimateDraftLockOwnerSchema.nullable(),
});

const estimateTemplateSummarySchema = z
  .object({
    id: uuidSchema,
    name: z.string(),
    description: z.string().nullable(),
    source_version_id: uuidSchema.nullable(),
    created_by: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    item_count: z.number().int(),
  })
  .passthrough();

const estimateTemplateItemSchema = z
  .object({
    id: uuidSchema,
    template_id: uuidSchema,
    parent_id: uuidSchema.nullable(),
    item_type: estimateItemTypeSchema,
    position: z.number().int(),
    title: z.string(),
    description: z.string().nullable(),
    quantity: z.number().nullable(),
    unit_price_ht_cents: z.number().nullable(),
    tax_rate_bp: z.number().nullable(),
    k_fo: z.number().nullable(),
    h_mo: z.number().nullable(),
    h_mo_majoration: z.number().nullable(),
    k_mo: z.number().nullable(),
    h_mo_atelier: z.number().nullable(),
    k_mo_atelier: z.number().nullable(),
    labor_role_atelier_id: uuidSchema.nullable(),
    h_mo_chantier: z.number().nullable(),
    k_mo_chantier: z.number().nullable(),
    labor_role_chantier_id: uuidSchema.nullable(),
    pu_ht_cents: z.number().nullable(),
    labor_role_id: uuidSchema.nullable(),
    category_id: uuidSchema.nullable(),
    supply_type_id: uuidSchema.nullable(),
    line_total_ht_cents: z.number().nullable(),
    line_tax_cents: z.number().nullable(),
    line_total_ttc_cents: z.number().nullable(),
  })
  .passthrough();

const estimateTemplateDetailSchema = estimateTemplateSummarySchema.extend({
  items: z.array(estimateTemplateItemSchema),
});

const estimateAssemblySummarySchema = z
  .object({
    id: uuidSchema,
    name: z.string(),
    description: z.string().nullable(),
    created_by: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    item_count: z.number().int(),
  })
  .passthrough();

const estimateAssemblyItemSchema = z
  .object({
    id: uuidSchema,
    assembly_id: uuidSchema,
    title: z.string(),
    unit: z.string().nullable(),
    k_fo: z.number().nullable(),
    k_mo: z.number().nullable(),
    labor_role_id: uuidSchema.nullable(),
    default_quantity: z.number().nullable(),
    position: z.number().int(),
  })
  .passthrough();

const estimateAssemblyDetailSchema = estimateAssemblySummarySchema.extend({
  items: z.array(estimateAssemblyItemSchema),
});

const estimateListDataSchema = z.object({
  items: z.array(estimateListItemSchema),
});

const estimateCreatedDataSchema = z.object({
  project: estimateProjectSchema,
  version: estimateVersionSchema,
});

const estimateVersionDataSchema = z.object({
  version: estimateVersionSchema,
});

const estimateVersionDetailsDataSchema = z.object({
  version: estimateVersionSchema,
  items: z.array(estimateItemSchema),
  categories: z.array(estimateCategorySchema),
  supply_types: z.array(supplyTypeSchema),
  labor_roles: z.array(laborRoleSchema),
  suggestion_rules: z.array(suggestionRuleSchema),
  margin_tiers: z.array(marginTierSchema),
});

const estimateVersionIdDataSchema = z.object({
  version_id: uuidSchema,
});

const deletedIdDataSchema = z.object({
  deleted_id: uuidSchema,
});

const estimateVerifySealDataSchema = z.object({
  valid: z.boolean(),
  computed_hash: z.string(),
  stored_hash: z.string().nullable(),
});

const estimateItemsDataSchema = z.object({
  items: z.array(estimateItemSchema),
});

const estimateItemDataSchema = z.object({
  item: estimateItemSchema,
});

const estimateItemsReorderDataSchema = z.object({
  parent_id: uuidSchema.nullable(),
  ordered_ids: z.array(uuidSchema),
  updated_count: z.number().int(),
});

const estimateItemsMoveDataSchema = z.object({
  item_id: uuidSchema,
  from_parent_id: uuidSchema.nullable(),
  to_parent_id: uuidSchema.nullable(),
  ordered_source_ids: z.array(uuidSchema),
  ordered_target_ids: z.array(uuidSchema),
  updated_count: z.number().int(),
});

const estimateItemsBulkDataSchema = z.object({
  updated_count: z.number().int(),
  version: estimateVersionTokenSchema,
});

const estimateSupplierComparisonsDataSchema = z.object({
  stale_price_days: z.number().int(),
  comparisons: z.array(estimateSupplierComparisonSchema),
});

const estimateSuggestPricesDataSchema = z.object({
  query: z.string(),
  stale_price_days: z.number().int(),
  suggestions: z.array(suggestedCataloguePriceSchema),
});

const estimateCategoryDataSchema = z.object({
  category: estimateCategorySchema,
});

const estimateLaborRoleDataSchema = z.object({
  labor_role: laborRoleSchema,
});

const estimateSuggestionRuleDataSchema = z.object({
  suggestion_rule: suggestionRuleSchema,
});

const estimateSuggestionRuleFeedbackDataSchema = z.object({
  suggestion_rule: suggestionRuleSchema,
  feedback: suggestionFeedbackSchema,
});

const estimateSuggestionLearningStateDataSchema = suggestionLearningStateSchema;

const estimateSuggestionLearningTrackDataSchema = suggestionLearningTrackResultSchema;

const adminSuggestionLearningStateDataSchema = suggestionLearningStateSchema;

const adminSuggestionLearningPurgeDataSchema = suggestionLearningPurgeResultSchema;

const estimateEventsDataSchema = z.object({
  events: z.array(estimateVersionEventSchema),
});

const estimateGatingDataSchema = z.object({
  gating: estimateGatingSchema,
});

const estimateChangelogDataSchema = z.object({
  previousVersionId: uuidSchema,
  currentVersionId: uuidSchema,
  previousVersionLabel: z.string(),
  currentVersionLabel: z.string(),
  cacheStatus: changelogCacheStatusSchema,
  computedAt: z.string(),
  changelog: estimateChangelogSchema,
});

const estimateDraftLockDataSchema = z.object({
  lock: estimateDraftLockSchema,
});

const estimateDraftLockReleaseDataSchema = z.object({
  released: z.boolean(),
  lock: estimateDraftLockSchema.nullable(),
});

const estimateTemplatesDataSchema = z.object({
  templates: z.array(estimateTemplateSummarySchema),
});

const estimateTemplateDataSchema = z.object({
  template: estimateTemplateSummarySchema,
});

const estimateTemplateDetailDataSchema = z.object({
  template: estimateTemplateDetailSchema,
});

const estimateInstantiateTemplateDataSchema = z.object({
  projectId: uuidSchema,
  versionId: uuidSchema,
  redirectTo: z.string(),
});

const estimateAssembliesDataSchema = z.object({
  assemblies: z.array(estimateAssemblySummarySchema),
});

const estimateAssemblyDataSchema = z.object({
  assembly: estimateAssemblyDetailSchema,
});

const estimateBatchDataSchema = estimateBatchResultSchema;

const apiEstimateListSchemaDefinition = successResponseSchemaDefinition(
  "ApiEstimateListResponse",
  estimateListDataSchema
);
const apiEstimateCreatedSchemaDefinition = successResponseSchemaDefinition(
  "ApiEstimateCreatedResponse",
  estimateCreatedDataSchema
);
const apiEstimateVersionSchemaDefinition = successResponseSchemaDefinition(
  "ApiEstimateVersionResponse",
  estimateVersionDataSchema
);
const apiEstimateVersionDetailsSchemaDefinition = successResponseSchemaDefinition(
  "ApiEstimateVersionDetailsResponse",
  estimateVersionDetailsDataSchema
);
const apiEstimateVersionIdSchemaDefinition = successResponseSchemaDefinition(
  "ApiEstimateVersionIdResponse",
  estimateVersionIdDataSchema
);
const apiDeletedIdSchemaDefinition = successResponseSchemaDefinition(
  "ApiDeletedIdResponse",
  deletedIdDataSchema
);
const apiEstimateVerifySealSchemaDefinition = successResponseSchemaDefinition(
  "ApiEstimateVerifySealResponse",
  estimateVerifySealDataSchema
);
const apiEstimateItemsSchemaDefinition = successResponseSchemaDefinition(
  "ApiEstimateItemsResponse",
  estimateItemsDataSchema
);
const apiEstimateItemSchemaDefinition = successResponseSchemaDefinition(
  "ApiEstimateItemResponse",
  estimateItemDataSchema
);
const apiEstimateItemsReorderSchemaDefinition = successResponseSchemaDefinition(
  "ApiEstimateItemsReorderResponse",
  estimateItemsReorderDataSchema
);
const apiEstimateItemsMoveSchemaDefinition = successResponseSchemaDefinition(
  "ApiEstimateItemsMoveResponse",
  estimateItemsMoveDataSchema
);
const apiEstimateItemsBulkSchemaDefinition = successResponseSchemaDefinition(
  "ApiEstimateItemsBulkResponse",
  estimateItemsBulkDataSchema
);
const apiEstimateBatchSchemaDefinition = successResponseSchemaDefinition(
  "ApiEstimateBatchResponse",
  estimateBatchDataSchema
);
const apiEstimateSupplierComparisonsSchemaDefinition = successResponseSchemaDefinition(
  "ApiEstimateSupplierComparisonsResponse",
  estimateSupplierComparisonsDataSchema
);
const apiEstimateSuggestPricesSchemaDefinition = successResponseSchemaDefinition(
  "ApiEstimateSuggestPricesResponse",
  estimateSuggestPricesDataSchema
);
const apiEstimateCategorySchemaDefinition = successResponseSchemaDefinition(
  "ApiEstimateCategoryResponse",
  estimateCategoryDataSchema
);
const apiEstimateLaborRoleSchemaDefinition = successResponseSchemaDefinition(
  "ApiEstimateLaborRoleResponse",
  estimateLaborRoleDataSchema
);
const apiEstimateSuggestionRuleSchemaDefinition = successResponseSchemaDefinition(
  "ApiEstimateSuggestionRuleResponse",
  estimateSuggestionRuleDataSchema
);
const apiEstimateSuggestionRuleFeedbackSchemaDefinition =
  successResponseSchemaDefinition(
    "ApiEstimateSuggestionRuleFeedbackResponse",
    estimateSuggestionRuleFeedbackDataSchema
  );
const apiEstimateSuggestionLearningStateSchemaDefinition =
  successResponseSchemaDefinition(
    "ApiEstimateSuggestionLearningStateResponse",
    estimateSuggestionLearningStateDataSchema
  );
const apiEstimateSuggestionLearningTrackSchemaDefinition =
  successResponseSchemaDefinition(
    "ApiEstimateSuggestionLearningTrackResponse",
    estimateSuggestionLearningTrackDataSchema
  );
const apiAdminSuggestionLearningStateSchemaDefinition =
  successResponseSchemaDefinition(
    "ApiAdminSuggestionLearningStateResponse",
    adminSuggestionLearningStateDataSchema
  );
const apiAdminSuggestionLearningPurgeSchemaDefinition =
  successResponseSchemaDefinition(
    "ApiAdminSuggestionLearningPurgeResponse",
    adminSuggestionLearningPurgeDataSchema
  );
const apiEstimateEventsSchemaDefinition = successResponseSchemaDefinition(
  "ApiEstimateEventsResponse",
  estimateEventsDataSchema
);
const apiEstimateGatingSchemaDefinition = successResponseSchemaDefinition(
  "ApiEstimateGatingResponse",
  estimateGatingDataSchema
);
const apiEstimateChangelogSchemaDefinition = successResponseSchemaDefinition(
  "ApiEstimateChangelogResponse",
  estimateChangelogDataSchema
);
const apiEstimateDraftLockSchemaDefinition = successResponseSchemaDefinition(
  "ApiEstimateDraftLockResponse",
  estimateDraftLockDataSchema
);
const apiEstimateDraftLockReleaseSchemaDefinition = successResponseSchemaDefinition(
  "ApiEstimateDraftLockReleaseResponse",
  estimateDraftLockReleaseDataSchema
);
const apiEstimateTemplatesSchemaDefinition = successResponseSchemaDefinition(
  "ApiEstimateTemplatesResponse",
  estimateTemplatesDataSchema
);
const apiEstimateTemplateSchemaDefinition = successResponseSchemaDefinition(
  "ApiEstimateTemplateResponse",
  estimateTemplateDataSchema
);
const apiEstimateTemplateDetailSchemaDefinition = successResponseSchemaDefinition(
  "ApiEstimateTemplateDetailResponse",
  estimateTemplateDetailDataSchema
);
const apiEstimateInstantiateTemplateSchemaDefinition = successResponseSchemaDefinition(
  "ApiEstimateInstantiateTemplateResponse",
  estimateInstantiateTemplateDataSchema
);
const apiEstimateAssembliesSchemaDefinition = successResponseSchemaDefinition(
  "ApiEstimateAssembliesResponse",
  estimateAssembliesDataSchema
);
const apiEstimateAssemblySchemaDefinition = successResponseSchemaDefinition(
  "ApiEstimateAssemblyResponse",
  estimateAssemblyDataSchema
);

export const openApiSharedSchemaDefinitions = {
  apiError: schemaDefinition("ApiError", apiErrorSchema, "output"),
  apiFailureResponse: schemaDefinition(
    "ApiFailureResponse",
    apiFailureResponseSchema,
    "output"
  ),
  apiSuccessUnknown: schemaDefinition(
    "ApiSuccessUnknown",
    apiSuccessUnknownSchema,
    "output"
  ),
  apiOutlierStateResponse: schemaDefinition(
    "ApiOutlierStateResponse",
    apiOutlierStateResponseSchema,
    "output"
  ),
  apiPdfStatusResponse: schemaDefinition(
    "ApiPdfStatusResponse",
    apiPdfStatusResponseSchema,
    "output"
  ),
};

const versionIdPathParameter = pathParameter({
  name: "versionId",
  description: "Identifiant UUID de la version de chiffrage.",
  schemaName: "VersionIdPathParameter",
  schema: uuidSchema,
});

const roleIdPathParameter = pathParameter({
  name: "roleId",
  description: "Identifiant UUID du role de main d'oeuvre.",
  schemaName: "RoleIdPathParameter",
  schema: uuidSchema,
});

const ruleIdPathParameter = pathParameter({
  name: "ruleId",
  description: "Identifiant UUID de la regle de suggestion.",
  schemaName: "RuleIdPathParameter",
  schema: uuidSchema,
});

const templateIdPathParameter = pathParameter({
  name: "templateId",
  description: "Identifiant UUID du template de chiffrage.",
  schemaName: "TemplateIdPathParameter",
  schema: uuidSchema,
});

const assemblyIdPathParameter = pathParameter({
  name: "assemblyId",
  description: "Identifiant UUID de l'assemblage.",
  schemaName: "AssemblyIdPathParameter",
  schema: uuidSchema,
});

const ifMatchHeaderOptionalParameter = headerParameter({
  name: "if-match",
  description:
    "Jeton de concurrence optimistic lock (updated_at), prioritaire sur le body.",
  schemaName: "IfMatchHeaderParameter",
  schema: ifMatchHeaderSchema,
  required: false,
});

const ifMatchHeaderRequiredParameter = headerParameter({
  name: "if-match",
  description: "Jeton de concurrence obligatoire (updated_at).",
  schemaName: "IfMatchRequiredHeaderParameter",
  schema: ifMatchHeaderSchema,
  required: true,
});

const templatesSearchQueryParameter = queryParameter({
  name: "search",
  description: "Recherche textuelle sur le nom du template.",
  schemaName: "TemplatesSearchQueryParameter",
  schema: listEstimateTemplatesQuerySchema.shape.search,
  required: false,
});

const templatesLimitQueryParameter = queryParameter({
  name: "limit",
  description: "Nombre maximal de resultats (<= 100).",
  schemaName: "TemplatesLimitQueryParameter",
  schema: listEstimateTemplatesQuerySchema.shape.limit,
  required: false,
});

const templatesOrderQueryParameter = queryParameter({
  name: "order",
  description: "Ordre de tri des templates.",
  schemaName: "TemplatesOrderQueryParameter",
  schema: listEstimateTemplatesQuerySchema.shape.order,
  required: false,
});

const assembliesSearchQueryParameter = queryParameter({
  name: "search",
  description: "Recherche textuelle sur le nom de l'assemblage.",
  schemaName: "AssembliesSearchQueryParameter",
  schema: listEstimateAssembliesQuerySchema.shape.search,
  required: false,
});

const assembliesLimitQueryParameter = queryParameter({
  name: "limit",
  description: "Nombre maximal de resultats (<= 100).",
  schemaName: "AssembliesLimitQueryParameter",
  schema: listEstimateAssembliesQuerySchema.shape.limit,
  required: false,
});

const assembliesOrderQueryParameter = queryParameter({
  name: "order",
  description: "Ordre de tri des assemblages.",
  schemaName: "AssembliesOrderQueryParameter",
  schema: listEstimateAssembliesQuerySchema.shape.order,
  required: false,
});

const suggestPricesQueryParameter = queryParameter({
  name: "q",
  description: "Texte de recherche pour la suggestion de prix catalogue.",
  schemaName: "SuggestPricesQueryParameter",
  schema: suggestPricesQuerySchema,
  required: true,
});

const changelogCompareQueryParameter = queryParameter({
  name: "compare",
  description: "UUID de la version a comparer.",
  schemaName: "ChangelogCompareQueryParameter",
  schema: uuidSchema,
  required: true,
});

const changelogFormatQueryParameter = queryParameter({
  name: "format",
  description: "Format de rendu du changelog (json ou pdf).",
  schemaName: "ChangelogFormatQueryParameter",
  schema: changelogFormatQuerySchema,
  required: false,
});

const lockForceQueryParameter = queryParameter({
  name: "force",
  description: "Forcer l'operation de verrouillage/deverrouillage.",
  schemaName: "LockForceQueryParameter",
  schema: forceQuerySchema,
  required: false,
});

const batchDryRunQueryParameter = queryParameter({
  name: "dry_run",
  description: "Quand true, valide les operations sans ecriture.",
  schemaName: "BatchDryRunQueryParameter",
  schema: dryRunQuerySchema,
  required: false,
});

const pdfForceQueryParameter = queryParameter({
  name: "force",
  description: "Forcer une regeneration du PDF.",
  schemaName: "PdfForceQueryParameter",
  schema: forceQuerySchema,
  required: false,
});

const pdfFormatQueryParameter = queryParameter({
  name: "format",
  description: "Quand `json`, retourne le statut JSON au lieu d'une redirection.",
  schemaName: "PdfFormatQueryParameter",
  schema: pdfFormatQuerySchema,
  required: false,
});

const exportFormatQueryParameter = queryParameter({
  name: "format",
  description: "Format d'export (xlsx uniquement en v1).",
  schemaName: "ExportFormatQueryParameter",
  schema: exportFormatQuerySchema,
  required: false,
});

const insertAssemblyVersionIdQueryParameter = queryParameter({
  name: "versionId",
  description: "UUID de la version recevant l'insertion de l'assemblage.",
  schemaName: "InsertAssemblyVersionIdQueryParameter",
  schema: uuidSchema,
  required: true,
});

const pdfRedirectLocationHeader = responseHeader({
  name: "Location",
  description: "URL signee de telechargement du PDF genere.",
  schemaName: "PdfRedirectLocationHeader",
  schema: z.string().url(),
  required: true,
});

const exportContentDispositionHeader = responseHeader({
  name: "Content-Disposition",
  description: "Nom du fichier exporte.",
  schemaName: "ExportContentDispositionHeader",
  schema: z.string().min(1),
  required: true,
});

const exportProgressHeader = responseHeader({
  name: "X-Export-Progress",
  description: "Progression de l'export (0-100).",
  schemaName: "ExportProgressHeader",
  schema: z.string().regex(/^[0-9]{1,3}$/),
  required: false,
});

const createEstimateBody = jsonBody({
  name: "CreateEstimateRequest",
  description: "Payload de creation d'un chiffrage.",
  schema: createEstimateSchema,
});

const patchEstimateVersionBody = jsonBody({
  name: "PatchEstimateVersionRequest",
  description: "Champs de mise a jour de la version de chiffrage.",
  schema: patchEstimateVersionSchema,
});

const patchEstimateStatusBody = jsonBody({
  name: "PatchEstimateStatusRequest",
  description: "Nouveau statut cible pour la version.",
  schema: patchEstimateStatusSchema,
});

const createVariantBody = jsonBody({
  name: "CreateEstimateVariantRequest",
  description: "Payload optionnel de creation de variante.",
  schema: createEstimateVariantSchema,
  required: false,
});

const promoteVariantBody = jsonBody({
  name: "PromoteEstimateVariantRequest",
  description: "Payload optionnel de promotion d'une variante.",
  schema: promoteEstimateVariantSchema,
  required: false,
});

const createEstimateItemBody = jsonBody({
  name: "CreateEstimateItemRequest",
  description: "Creation d'un item (section ou ligne).",
  schema: createEstimateItemSchema,
});

const updateEstimateItemBody = jsonBody({
  name: "UpdateEstimateItemRequest",
  description: "Mise a jour partielle d'un item.",
  schema: updateEstimateItemSchema,
});

const deleteEstimateItemBody = jsonBody({
  name: "DeleteEstimateItemRequest",
  description: "Suppression d'un item via son UUID.",
  schema: deleteEstimateItemSchema,
});

const reorderEstimateItemsBody = jsonBody({
  name: "ReorderEstimateItemsRequest",
  description: "Nouvel ordre des items sous un parent.",
  schema: reorderEstimateItemsSchema,
});

const moveEstimateItemBody = jsonBody({
  name: "MoveEstimateItemRequest",
  description:
    "Deplace un item vers un autre parent avec nouvel ordre source/cible.",
  schema: moveEstimateItemSchema,
});

const bulkUpdateEstimateItemsBody = jsonBody({
  name: "BulkUpdateEstimateItemsRequest",
  description: "Mise a jour en lot des items.",
  schema: bulkUpdateEstimateItemsRequestSchema,
});

const batchOperationsBody = jsonBody({
  name: "BatchEstimateOperationsRequest",
  description:
    "Execution groupee d'operations create/update/delete/reorder avec token de concurrence.",
  schema: batchOperationsSchema,
});

const supplierComparisonsBody = jsonBody({
  name: "EstimateSupplierComparisonsRequest",
  description: "Liste des lignes a comparer par fournisseur.",
  schema: estimateSupplierComparisonsRequestSchema,
});

const createCategoryBody = jsonBody({
  name: "CreateEstimateCategoryRequest",
  description: "Creation d'une categorie de ligne.",
  schema: createEstimateCategorySchema,
});

const createLaborRoleBody = jsonBody({
  name: "CreateLaborRoleRequest",
  description: "Creation d'un role de main d'oeuvre.",
  schema: createLaborRoleSchema,
});

const updateLaborRoleBody = jsonBody({
  name: "UpdateLaborRoleRequest",
  description: "Mise a jour d'un role de main d'oeuvre.",
  schema: updateLaborRoleSchema,
});

const createSuggestionRuleBody = jsonBody({
  name: "CreateSuggestionRuleRequest",
  description: "Creation d'une regle de suggestion.",
  schema: createSuggestionRuleSchema,
});

const updateSuggestionRuleBody = jsonBody({
  name: "UpdateSuggestionRuleRequest",
  description: "Mise a jour d'une regle de suggestion.",
  schema: updateSuggestionRuleSchema,
});

const suggestionRuleFeedbackBody = jsonBody({
  name: "SuggestionRuleFeedbackRequest",
  description: "Feedback utilisateur sur une suggestion appliquee.",
  schema: suggestionRuleFeedbackSchema,
});

const trackSuggestionCorrectionsBody = jsonBody({
  name: "TrackSuggestionCorrectionsRequest",
  description: "Corrections appliquees pour alimenter le learning de suggestion.",
  schema: trackSuggestionCorrectionsSchema,
});

const reviewSuggestionLearningBody = jsonBody({
  name: "ReviewSuggestionLearningRequest",
  description: "Action admin de validation, rejet ou reset d'une correction apprise.",
  schema: reviewSuggestionLearningSchema,
});

const purgeSuggestionLearningBody = jsonBody({
  name: "PurgeSuggestionLearningRequest",
  description: "Purge de l'historique de corrections selon la retention cible.",
  schema: purgeSuggestionLearningSchema,
});

const outlierToggleBody = jsonBody({
  name: "ToggleOutlierDismissRequest",
  description: "Activation/desactivation du dismissal d'un outlier.",
  schema: toggleOutlierDismissSchema,
});

const createTemplateFromVersionBody = jsonBody({
  name: "CreateEstimateTemplateFromVersionRequest",
  description: "Creation d'un template a partir d'une version existante.",
  schema: createEstimateTemplateFromVersionSchema,
});

const updateTemplateBody = jsonBody({
  name: "UpdateEstimateTemplateRequest",
  description: "Mise a jour d'un template existant.",
  schema: updateEstimateTemplateSchema,
});

const instantiateTemplateBody = jsonBody({
  name: "InstantiateEstimateFromTemplateRequest",
  description: "Creation d'un chiffrage depuis un template.",
  schema: instantiateEstimateFromTemplateSchema,
});

const duplicateTemplateBody = jsonBody({
  name: "DuplicateEstimateTemplateRequest",
  description: "Payload optionnel de duplication de template.",
  schema: duplicateEstimateTemplateSchema,
  required: false,
});

const createAssemblyBody = jsonBody({
  name: "CreateEstimateAssemblyRequest",
  description: "Creation d'un assemblage de lignes.",
  schema: createEstimateAssemblySchema,
});

const updateAssemblyBody = jsonBody({
  name: "UpdateEstimateAssemblyRequest",
  description: "Mise a jour d'un assemblage.",
  schema: updateEstimateAssemblySchema,
});

const insertAssemblyBody = jsonBody({
  name: "InsertAssemblyIntoVersionBodyRequest",
  description: "Position optionnelle d'insertion de l'assemblage.",
  schema: insertAssemblyIntoVersionBodySchema,
  required: false,
});

const apiOutlierStateSchemaDefinition =
  openApiSharedSchemaDefinitions.apiOutlierStateResponse;
const apiPdfStatusSchemaDefinition = openApiSharedSchemaDefinitions.apiPdfStatusResponse;

export const openApiOperationsRegistry: OpenApiOperationDefinition[] = [
  {
    method: "get",
    path: "/api/estimates",
    summary: "Lister les chiffrages",
    description: "Retourne les derniers chiffrages accessibles a l'utilisateur.",
    tags: ["Estimates"],
    responses: {
      "200": jsonResponse(
        "Liste des chiffrages retournee.",
        apiEstimateListSchemaDefinition
      ),
    },
  },
  {
    method: "post",
    path: "/api/estimates",
    summary: "Creer un chiffrage",
    description: "Cree un projet + une version initiale de chiffrage.",
    tags: ["Estimates"],
    requestBody: createEstimateBody,
    responses: {
      "201": jsonResponse(
        "Chiffrage cree avec succes.",
        apiEstimateCreatedSchemaDefinition
      ),
    },
  },
  {
    method: "get",
    path: "/api/estimates/{versionId}",
    summary: "Recuperer une version",
    description: "Retourne le detail complet d'une version de chiffrage.",
    tags: ["Estimate Versions"],
    parameters: [versionIdPathParameter],
    responses: {
      "200": jsonResponse(
        "Version de chiffrage retournee.",
        apiEstimateVersionDetailsSchemaDefinition
      ),
    },
  },
  {
    method: "patch",
    path: "/api/estimates/{versionId}",
    summary: "Modifier une version",
    description:
      "Met a jour les metadonnees et/ou les totaux de la version de chiffrage.",
    tags: ["Estimate Versions"],
    parameters: [versionIdPathParameter, ifMatchHeaderOptionalParameter],
    requestBody: patchEstimateVersionBody,
    responses: {
      "200": jsonResponse(
        "Version de chiffrage mise a jour.",
        apiEstimateVersionSchemaDefinition
      ),
    },
  },
  {
    method: "patch",
    path: "/api/estimates/{versionId}/status",
    summary: "Changer le statut d'une version",
    description: "Met a jour le statut metier de la version (draft/sent/...).",
    tags: ["Estimate Versions"],
    parameters: [versionIdPathParameter, ifMatchHeaderRequiredParameter],
    requestBody: patchEstimateStatusBody,
    responses: {
      "200": jsonResponse(
        "Statut de version mis a jour.",
        apiEstimateVersionSchemaDefinition
      ),
    },
  },
  {
    method: "post",
    path: "/api/estimates/{versionId}/duplicate",
    summary: "Dupliquer une version",
    description: "Cree une nouvelle version a partir d'une version existante.",
    tags: ["Estimate Versions"],
    parameters: [versionIdPathParameter],
    responses: {
      "201": jsonResponse(
        "Version dupliquee avec succes.",
        apiEstimateVersionIdSchemaDefinition
      ),
    },
  },
  {
    method: "get",
    path: "/api/estimates/{versionId}/verify",
    summary: "Verifier l'integrite",
    description: "Verifie le sceau d'integrite de la version.",
    tags: ["Estimate Versions"],
    parameters: [versionIdPathParameter],
    responses: {
      "200": jsonResponse(
        "Resultat de verification retourne.",
        apiEstimateVerifySealSchemaDefinition
      ),
    },
  },
  {
    method: "post",
    path: "/api/estimates/{versionId}/variants",
    summary: "Creer une variante",
    description: "Cree une variante de la version en cours.",
    tags: ["Estimate Versions"],
    parameters: [versionIdPathParameter],
    requestBody: createVariantBody,
    responses: {
      "201": jsonResponse(
        "Variante creee avec succes.",
        apiEstimateVersionIdSchemaDefinition
      ),
    },
  },
  {
    method: "patch",
    path: "/api/estimates/{versionId}/variants",
    summary: "Promouvoir une variante",
    description: "Promeut une variante comme version active.",
    tags: ["Estimate Versions"],
    parameters: [versionIdPathParameter],
    requestBody: promoteVariantBody,
    responses: {
      "200": jsonResponse(
        "Variante promue avec succes.",
        apiEstimateVersionSchemaDefinition
      ),
    },
  },
  {
    method: "get",
    path: "/api/estimates/{versionId}/items",
    summary: "Lister les items",
    description: "Retourne la structure des sections/lignes de la version.",
    tags: ["Estimate Items"],
    parameters: [versionIdPathParameter],
    responses: {
      "200": jsonResponse("Items retournes.", apiEstimateItemsSchemaDefinition),
    },
  },
  {
    method: "post",
    path: "/api/estimates/{versionId}/items",
    summary: "Ajouter un item",
    description: "Ajoute une section ou une ligne dans la version.",
    tags: ["Estimate Items"],
    parameters: [versionIdPathParameter],
    requestBody: createEstimateItemBody,
    responses: {
      "201": jsonResponse(
        "Item cree avec succes.",
        apiEstimateItemSchemaDefinition
      ),
    },
  },
  {
    method: "patch",
    path: "/api/estimates/{versionId}/items",
    summary: "Modifier un item",
    description: "Met a jour une ligne ou section existante.",
    tags: ["Estimate Items"],
    parameters: [versionIdPathParameter],
    requestBody: updateEstimateItemBody,
    responses: {
      "200": jsonResponse("Item mis a jour.", apiEstimateItemSchemaDefinition),
    },
  },
  {
    method: "delete",
    path: "/api/estimates/{versionId}/items",
    summary: "Supprimer un item",
    description: "Supprime une ligne ou section de la version.",
    tags: ["Estimate Items"],
    parameters: [versionIdPathParameter],
    requestBody: deleteEstimateItemBody,
    responses: {
      "200": jsonResponse("Item supprime.", apiDeletedIdSchemaDefinition),
    },
  },
  {
    method: "post",
    path: "/api/estimates/{versionId}/items/move",
    summary: "Deplacer un item",
    description:
      "Deplace un item d'un parent source vers un parent cible avec reordonnancement atomique.",
    tags: ["Estimate Items"],
    parameters: [versionIdPathParameter],
    requestBody: moveEstimateItemBody,
    responses: {
      "200": jsonResponse(
        "Item deplace avec succes.",
        apiEstimateItemsMoveSchemaDefinition
      ),
    },
  },
  {
    method: "post",
    path: "/api/estimates/{versionId}/items/reorder",
    summary: "Reordonner les items",
    description: "Reordonne les items d'un meme parent dans la version.",
    tags: ["Estimate Items"],
    parameters: [versionIdPathParameter],
    requestBody: reorderEstimateItemsBody,
    responses: {
      "200": jsonResponse(
        "Ordre des items mis a jour.",
        apiEstimateItemsReorderSchemaDefinition
      ),
    },
  },
  {
    method: "post",
    path: "/api/estimates/{versionId}/items/bulk",
    summary: "Mise a jour bulk d'items",
    description: "Applique un lot de modifications sur plusieurs lignes.",
    tags: ["Estimate Items"],
    parameters: [versionIdPathParameter, ifMatchHeaderOptionalParameter],
    requestBody: bulkUpdateEstimateItemsBody,
    responses: {
      "200": jsonResponse(
        "Mise a jour bulk appliquee.",
        apiEstimateItemsBulkSchemaDefinition
      ),
    },
  },
  {
    method: "post",
    path: "/api/estimates/{versionId}/batch",
    summary: "Executer un batch d'operations",
    description:
      "Execute en un appel un lot d'operations create/update/delete/reorder.",
    tags: ["Estimate Items"],
    parameters: [
      versionIdPathParameter,
      ifMatchHeaderOptionalParameter,
      batchDryRunQueryParameter,
    ],
    requestBody: batchOperationsBody,
    responses: {
      "200": jsonResponse(
        "Batch execute avec succes.",
        apiEstimateBatchSchemaDefinition
      ),
    },
  },
  {
    method: "get",
    path: "/api/estimates/{versionId}/export",
    summary: "Exporter un devis en streaming",
    description:
      "Genere un fichier XLSX en streaming pour telechargement direct.",
    tags: ["Estimate Output"],
    parameters: [versionIdPathParameter, exportFormatQueryParameter],
    responses: {
      "200": {
        description: "Flux binaire XLSX retourne.",
        headers: [exportContentDispositionHeader, exportProgressHeader],
        contents: [
          {
            contentType:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          },
        ],
      },
    },
  },
  {
    method: "post",
    path: "/api/estimates/{versionId}/supplier-comparisons",
    summary: "Comparer les fournisseurs",
    description: "Retourne des comparatifs de prix fournisseurs par item.",
    tags: ["Estimate Items"],
    parameters: [versionIdPathParameter],
    requestBody: supplierComparisonsBody,
    responses: {
      "200": jsonResponse(
        "Comparatifs fournisseurs retournes.",
        apiEstimateSupplierComparisonsSchemaDefinition
      ),
    },
  },
  {
    method: "get",
    path: "/api/estimates/{versionId}/suggest-prices",
    summary: "Suggérer des prix",
    description: "Interroge le catalogue pour suggerer des prix par recherche.",
    tags: ["Estimate Items"],
    parameters: [versionIdPathParameter, suggestPricesQueryParameter],
    responses: {
      "200": jsonResponse(
        "Suggestions de prix retournees.",
        apiEstimateSuggestPricesSchemaDefinition
      ),
    },
  },
  {
    method: "post",
    path: "/api/estimates/{versionId}/categories",
    summary: "Creer une categorie",
    description: "Ajoute une categorie de classement des lignes.",
    tags: ["Estimate Items"],
    parameters: [versionIdPathParameter],
    requestBody: createCategoryBody,
    responses: {
      "201": jsonResponse(
        "Categorie creee avec succes.",
        apiEstimateCategorySchemaDefinition
      ),
    },
  },
  {
    method: "post",
    path: "/api/estimates/{versionId}/labor-roles",
    summary: "Creer un role de MO",
    description: "Ajoute un role de main d'oeuvre sur la version.",
    tags: ["Estimate Rules"],
    parameters: [versionIdPathParameter],
    requestBody: createLaborRoleBody,
    responses: {
      "201": jsonResponse(
        "Role de main d'oeuvre cree.",
        apiEstimateLaborRoleSchemaDefinition
      ),
    },
  },
  {
    method: "patch",
    path: "/api/estimates/{versionId}/labor-roles/{roleId}",
    summary: "Modifier un role de MO",
    description: "Met a jour un role de main d'oeuvre existant.",
    tags: ["Estimate Rules"],
    parameters: [versionIdPathParameter, roleIdPathParameter],
    requestBody: updateLaborRoleBody,
    responses: {
      "200": jsonResponse(
        "Role de main d'oeuvre mis a jour.",
        apiEstimateLaborRoleSchemaDefinition
      ),
    },
  },
  {
    method: "post",
    path: "/api/estimates/{versionId}/suggestion-rules",
    summary: "Creer une regle de suggestion",
    description: "Ajoute une regle de suggestion pour les lignes du devis.",
    tags: ["Estimate Rules"],
    parameters: [versionIdPathParameter],
    requestBody: createSuggestionRuleBody,
    responses: {
      "201": jsonResponse(
        "Regle de suggestion creee.",
        apiEstimateSuggestionRuleSchemaDefinition
      ),
    },
  },
  {
    method: "patch",
    path: "/api/estimates/{versionId}/suggestion-rules/{ruleId}",
    summary: "Modifier une regle de suggestion",
    description: "Met a jour une regle de suggestion existante.",
    tags: ["Estimate Rules"],
    parameters: [versionIdPathParameter, ruleIdPathParameter],
    requestBody: updateSuggestionRuleBody,
    responses: {
      "200": jsonResponse(
        "Regle de suggestion mise a jour.",
        apiEstimateSuggestionRuleSchemaDefinition
      ),
    },
  },
  {
    method: "post",
    path: "/api/estimates/{versionId}/suggestion-rules/{ruleId}/feedback",
    summary: "Enregistrer un feedback",
    description: "Enregistre un feedback d'acceptation/rejet sur une suggestion.",
    tags: ["Estimate Rules"],
    parameters: [versionIdPathParameter, ruleIdPathParameter],
    requestBody: suggestionRuleFeedbackBody,
    responses: {
      "200": jsonResponse(
        "Feedback de suggestion enregistre.",
        apiEstimateSuggestionRuleFeedbackSchemaDefinition
      ),
    },
  },
  {
    method: "get",
    path: "/api/estimates/{versionId}/suggestion-learning",
    summary: "Lire l'etat du suggestion learning",
    description:
      "Retourne la configuration learning et les propositions apprises pour la version.",
    tags: ["Estimate Rules"],
    parameters: [versionIdPathParameter],
    responses: {
      "200": jsonResponse(
        "Etat du suggestion learning retourne.",
        apiEstimateSuggestionLearningStateSchemaDefinition
      ),
    },
  },
  {
    method: "post",
    path: "/api/estimates/{versionId}/suggestion-learning",
    summary: "Enregistrer des corrections learning",
    description:
      "Enregistre les corrections appliquees sur les suggestions d'une version brouillon.",
    tags: ["Estimate Rules"],
    parameters: [versionIdPathParameter],
    requestBody: trackSuggestionCorrectionsBody,
    responses: {
      "200": jsonResponse(
        "Corrections learning enregistrees.",
        apiEstimateSuggestionLearningTrackSchemaDefinition
      ),
    },
  },
  {
    method: "get",
    path: "/api/estimates/{versionId}/events",
    summary: "Lister les evenements",
    description: "Retourne l'historique des evenements de version.",
    tags: ["Estimate Diagnostics"],
    parameters: [versionIdPathParameter],
    responses: {
      "200": jsonResponse(
        "Evenements de version retournes.",
        apiEstimateEventsSchemaDefinition
      ),
    },
  },
  {
    method: "get",
    path: "/api/estimates/{versionId}/gating",
    summary: "Verifier le gating d'envoi",
    description:
      "Retourne l'etat des prerequis pour l'envoi (verrous, donnees requises, etc.).",
    tags: ["Estimate Diagnostics"],
    parameters: [versionIdPathParameter],
    responses: {
      "200": jsonResponse(
        "Etat de gating retourne.",
        apiEstimateGatingSchemaDefinition
      ),
    },
  },
  {
    method: "get",
    path: "/api/estimates/{versionId}/outliers",
    summary: "Lister les outliers dismiss",
    description:
      "Retourne les outliers marques comme dismiss par item de la version.",
    tags: ["Estimate Diagnostics"],
    parameters: [versionIdPathParameter],
    responses: {
      "200": jsonResponse(
        "Etat des outliers retourne.",
        apiOutlierStateSchemaDefinition
      ),
    },
  },
  {
    method: "post",
    path: "/api/estimates/{versionId}/outliers",
    summary: "Basculer un outlier dismiss",
    description: "Accepte ou reactive un outlier detecte sur un item.",
    tags: ["Estimate Diagnostics"],
    parameters: [versionIdPathParameter],
    requestBody: outlierToggleBody,
    responses: {
      "200": jsonResponse(
        "Etat des outliers mis a jour.",
        apiOutlierStateSchemaDefinition
      ),
    },
  },
  {
    method: "get",
    path: "/api/estimates/{versionId}/changelog",
    summary: "Comparer deux versions",
    description:
      "Retourne le changelog JSON ou un rendu PDF entre deux versions d'un meme projet.",
    tags: ["Estimate Diagnostics"],
    parameters: [
      versionIdPathParameter,
      changelogCompareQueryParameter,
      changelogFormatQueryParameter,
    ],
    responses: {
      "200": {
        description: "Changelog calcule avec succes (JSON ou PDF).",
        contents: [
          {
            contentType: "application/json",
            schema: apiEstimateChangelogSchemaDefinition,
          },
          {
            contentType: "application/pdf",
          },
        ],
      },
    },
  },
  {
    method: "post",
    path: "/api/estimates/{versionId}/lock",
    summary: "Acquerir un verrou",
    description: "Acquiert le verrou d'edition d'une version brouillon.",
    tags: ["Estimate Locks"],
    parameters: [versionIdPathParameter],
    responses: {
      "201": jsonResponse("Verrou acquis.", apiEstimateDraftLockSchemaDefinition),
    },
  },
  {
    method: "patch",
    path: "/api/estimates/{versionId}/lock",
    summary: "Renouveler un verrou",
    description: "Renouvelle le verrou d'edition sur la version brouillon.",
    tags: ["Estimate Locks"],
    parameters: [versionIdPathParameter, lockForceQueryParameter],
    responses: {
      "200": jsonResponse("Verrou renouvele.", apiEstimateDraftLockSchemaDefinition),
    },
  },
  {
    method: "delete",
    path: "/api/estimates/{versionId}/lock",
    summary: "Relacher un verrou",
    description: "Relache le verrou d'edition sur la version brouillon.",
    tags: ["Estimate Locks"],
    parameters: [versionIdPathParameter, lockForceQueryParameter],
    responses: {
      "200": jsonResponse(
        "Verrou relache.",
        apiEstimateDraftLockReleaseSchemaDefinition
      ),
    },
  },
  {
    method: "post",
    path: "/api/estimates/{versionId}/pdf",
    summary: "Declencher la generation PDF",
    description:
      "Declenche une generation PDF immediate. Retourne `ready` ou `processing`.",
    tags: ["Estimate PDF"],
    parameters: [versionIdPathParameter, pdfForceQueryParameter],
    responses: {
      "200": jsonResponse(
        "Statut PDF retourne (deja pret).",
        apiPdfStatusSchemaDefinition
      ),
      "202": jsonResponse(
        "Generation PDF en cours.",
        apiPdfStatusSchemaDefinition
      ),
    },
  },
  {
    method: "get",
    path: "/api/estimates/{versionId}/pdf",
    summary: "Recuperer un PDF ou son statut",
    description:
      "Retourne le statut JSON (`format=json`) ou redirige vers le PDF signe.",
    tags: ["Estimate PDF"],
    parameters: [versionIdPathParameter, pdfFormatQueryParameter],
    responses: {
      "200": jsonResponse(
        "Statut PDF JSON retourne.",
        apiPdfStatusSchemaDefinition
      ),
      "202": jsonResponse(
        "Generation PDF encore en cours.",
        apiPdfStatusSchemaDefinition
      ),
      "307": {
        description: "Redirection vers le fichier PDF signe.",
        headers: [pdfRedirectLocationHeader],
      },
    },
  },
  {
    method: "get",
    path: "/api/estimates/templates",
    summary: "Lister les templates",
    description: "Retourne la liste des templates de chiffrage.",
    tags: ["Estimate Templates"],
    parameters: [
      templatesSearchQueryParameter,
      templatesLimitQueryParameter,
      templatesOrderQueryParameter,
    ],
    responses: {
      "200": jsonResponse("Templates retournes.", apiEstimateTemplatesSchemaDefinition),
    },
  },
  {
    method: "post",
    path: "/api/estimates/templates",
    summary: "Creer un template depuis une version",
    description: "Cree un template de chiffrage a partir d'une version source.",
    tags: ["Estimate Templates"],
    requestBody: createTemplateFromVersionBody,
    responses: {
      "201": jsonResponse(
        "Template cree avec succes.",
        apiEstimateTemplateSchemaDefinition
      ),
    },
  },
  {
    method: "get",
    path: "/api/estimates/templates/{templateId}",
    summary: "Recuperer un template",
    description: "Retourne le detail d'un template.",
    tags: ["Estimate Templates"],
    parameters: [templateIdPathParameter],
    responses: {
      "200": jsonResponse(
        "Template retourne.",
        apiEstimateTemplateDetailSchemaDefinition
      ),
    },
  },
  {
    method: "patch",
    path: "/api/estimates/templates/{templateId}",
    summary: "Modifier un template",
    description: "Met a jour le nom et/ou la description d'un template.",
    tags: ["Estimate Templates"],
    parameters: [templateIdPathParameter],
    requestBody: updateTemplateBody,
    responses: {
      "200": jsonResponse(
        "Template mis a jour.",
        apiEstimateTemplateSchemaDefinition
      ),
    },
  },
  {
    method: "delete",
    path: "/api/estimates/templates/{templateId}",
    summary: "Supprimer un template",
    description: "Supprime un template existant.",
    tags: ["Estimate Templates"],
    parameters: [templateIdPathParameter],
    responses: {
      "200": jsonResponse(
        "Template supprime.",
        apiDeletedIdSchemaDefinition
      ),
    },
  },
  {
    method: "post",
    path: "/api/estimates/templates/{templateId}/instantiate",
    summary: "Instancier un template",
    description: "Cree un nouveau chiffrage depuis un template existant.",
    tags: ["Estimate Templates"],
    parameters: [templateIdPathParameter],
    requestBody: instantiateTemplateBody,
    responses: {
      "201": jsonResponse(
        "Chiffrage instancie depuis le template.",
        apiEstimateInstantiateTemplateSchemaDefinition
      ),
    },
  },
  {
    method: "post",
    path: "/api/estimates/templates/{templateId}/duplicate",
    summary: "Dupliquer un template",
    description: "Duplique un template en optionnellement renommant la copie.",
    tags: ["Estimate Templates"],
    parameters: [templateIdPathParameter],
    requestBody: duplicateTemplateBody,
    responses: {
      "201": jsonResponse(
        "Template duplique avec succes.",
        apiEstimateTemplateSchemaDefinition
      ),
    },
  },
  {
    method: "get",
    path: "/api/estimates/assemblies",
    summary: "Lister les assemblages",
    description: "Retourne la liste des assemblages reutilisables.",
    tags: ["Estimate Assemblies"],
    parameters: [
      assembliesSearchQueryParameter,
      assembliesLimitQueryParameter,
      assembliesOrderQueryParameter,
    ],
    responses: {
      "200": jsonResponse(
        "Assemblages retournes.",
        apiEstimateAssembliesSchemaDefinition
      ),
    },
  },
  {
    method: "post",
    path: "/api/estimates/assemblies",
    summary: "Creer un assemblage",
    description: "Cree un nouvel assemblage de lignes.",
    tags: ["Estimate Assemblies"],
    requestBody: createAssemblyBody,
    responses: {
      "201": jsonResponse(
        "Assemblage cree avec succes.",
        apiEstimateAssemblySchemaDefinition
      ),
    },
  },
  {
    method: "get",
    path: "/api/estimates/assemblies/{assemblyId}",
    summary: "Recuperer un assemblage",
    description: "Retourne le detail complet d'un assemblage.",
    tags: ["Estimate Assemblies"],
    parameters: [assemblyIdPathParameter],
    responses: {
      "200": jsonResponse(
        "Assemblage retourne.",
        apiEstimateAssemblySchemaDefinition
      ),
    },
  },
  {
    method: "patch",
    path: "/api/estimates/assemblies/{assemblyId}",
    summary: "Modifier un assemblage",
    description: "Met a jour le nom, la description et/ou les lignes d'un assemblage.",
    tags: ["Estimate Assemblies"],
    parameters: [assemblyIdPathParameter],
    requestBody: updateAssemblyBody,
    responses: {
      "200": jsonResponse(
        "Assemblage mis a jour.",
        apiEstimateAssemblySchemaDefinition
      ),
    },
  },
  {
    method: "delete",
    path: "/api/estimates/assemblies/{assemblyId}",
    summary: "Supprimer un assemblage",
    description: "Supprime un assemblage existant.",
    tags: ["Estimate Assemblies"],
    parameters: [assemblyIdPathParameter],
    responses: {
      "200": jsonResponse(
        "Assemblage supprime.",
        apiDeletedIdSchemaDefinition
      ),
    },
  },
  {
    method: "post",
    path: "/api/estimates/assemblies/{assemblyId}/insert",
    summary: "Inserer un assemblage dans une version",
    description:
      "Insere un assemblage dans une version cible, optionnellement apres un item.",
    tags: ["Estimate Assemblies"],
    parameters: [assemblyIdPathParameter, insertAssemblyVersionIdQueryParameter],
    requestBody: insertAssemblyBody,
    responses: {
      "200": jsonResponse(
        "Assemblage insere dans la version.",
        apiEstimateItemsSchemaDefinition
      ),
    },
  },
  {
    method: "get",
    path: "/api/admin/suggestion-learning",
    summary: "Lister suggestion learning tenant",
    description:
      "Retourne les suggestions apprises du tenant (incluant inactives) pour l'administration.",
    tags: ["Administration"],
    responses: {
      "200": jsonResponse(
        "Etat admin suggestion learning retourne.",
        apiAdminSuggestionLearningStateSchemaDefinition
      ),
    },
  },
  {
    method: "patch",
    path: "/api/admin/suggestion-learning",
    summary: "Revoir une suggestion apprise",
    description:
      "Valide, rejette ou reset une suggestion apprise sur une combinaison regle/champ/valeur.",
    tags: ["Administration"],
    requestBody: reviewSuggestionLearningBody,
    responses: {
      "200": jsonResponse(
        "Etat admin suggestion learning mis a jour.",
        apiAdminSuggestionLearningStateSchemaDefinition
      ),
    },
  },
  {
    method: "post",
    path: "/api/admin/suggestion-learning/purge",
    summary: "Purger l'historique learning",
    description:
      "Supprime les corrections historiques selon la retention puis retourne l'etat rafraichi.",
    tags: ["Administration"],
    requestBody: purgeSuggestionLearningBody,
    responses: {
      "200": jsonResponse(
        "Historique learning purge avec succes.",
        apiAdminSuggestionLearningPurgeSchemaDefinition
      ),
    },
  },
];
