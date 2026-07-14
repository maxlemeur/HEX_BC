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
  estimatePurchaseOrderDraftsCreateSchema,
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
  sendEstimateSchema,
  suggestionLearningFieldSchema,
  suggestionRuleFeedbackSchema,
  trackSuggestionCorrectionsSchema,
  updateEstimateAssemblySchema,
  updateEstimateItemSchema,
  updateEstimateTemplateSchema,
  updateLaborRoleSchema,
  updateSuggestionRuleSchema,
} from "@/lib/estimates/schemas";
import {
  estimateDeltaExplanationQuerySchema,
  estimateExplanationDetailQueryParamSchema,
  estimateExplanationResponseSchema,
} from "@/lib/estimates/explanation-schemas";
import { TakeoffErrorCode } from "@/lib/takeoff/errors";

export type OpenApiHttpMethod = "get" | "post" | "patch" | "delete";
export type OpenApiSchemaIO = "input" | "output";
export type OpenApiContentType =
  | "application/json"
  | "multipart/form-data"
  | "text/csv"
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
  contentType?: "application/json" | "multipart/form-data";
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

function multipartBody(input: {
  name: string;
  description: string;
  schema: ZodTypeAny;
  required?: boolean;
}): OpenApiRequestBodyDefinition {
  return {
    contentType: "multipart/form-data",
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
const takeoffPlanSetsLimitQuerySchema = z.number().int().min(1).max(100);
const takeoffJobsLimitQuerySchema = z.number().int().min(1).max(100);
const takeoffJobsOffsetQuerySchema = z.number().int().min(0).max(10000);
const takeoffJobsPeriodQuerySchema = z.enum(["7d", "30d", "90d"]);
const takeoffJobItemsLimitQuerySchema = z.number().int().min(1).max(200);
const takeoffJobItemsOffsetQuerySchema = z.number().int().min(0).max(10000);
const takeoffCompareThresholdQuerySchema = z.number().min(0.5).max(0.99);
const takeoffPlanFilesIncludeDownloadUrlQuerySchema = z.enum([
  "0",
  "1",
  "true",
  "false",
]);
const takeoffPlanFileContentTypeSchema = z.literal("application/pdf");
const maxTakeoffPlanFileSizeBytes = 50 * 1024 * 1024;
const idempotencyKeyHeaderSchema = z
  .string()
  .trim()
  .min(1, "Idempotency-Key invalide.")
  .max(255, "Idempotency-Key invalide.");
const takeoffLevelSchema = z.enum(["A", "B", "C"]);
const takeoffJobStatusSchema = z.enum([
  "pending",
  "processing",
  "completed",
  "failed",
  "canceled",
  "applied",
]);
const takeoffErrorCodeSchema = z.nativeEnum(TakeoffErrorCode);

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

export const apiFailureResponseSchema = z.object({
  ok: z.literal(false),
  error: apiErrorSchema,
});

export const takeoffApiErrorSchema = z.object({
  code: takeoffErrorCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),
  retryable: z.boolean().optional(),
  jobId: z.string().optional(),
  level: takeoffLevelSchema.optional(),
});

export const apiTakeoffFailureResponseSchema = z.object({
  ok: z.literal(false),
  error: takeoffApiErrorSchema,
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
  kind: z.enum([
    "best_price",
    "most_recent",
    "preferred_supplier",
    "selected_current",
  ]),
  supplier_price_id: uuidSchema,
  supplier_id: uuidSchema,
  supplier_name: z.string(),
  adjusted_unit_price_cents: z.number().int(),
  supplier_reference: z.string().nullable(),
  catalogue_url: z.string().nullable(),
  updated_at: z.string().nullable(),
  is_stale: z.boolean(),
  product_designation: z.string(),
  is_selected: z.boolean(),
});

const estimateSupplierComparisonSchema = z.object({
  item_id: uuidSchema,
  selected_supplier_price_id: uuidSchema.nullable(),
  best_supplier_price_id: uuidSchema.nullable(),
  coverage_status: z.enum(["covered", "ambiguous", "no_price", "stale"]),
  risk_flags: z.array(
    z.enum([
      "multiple_alternatives",
      "selection_missing",
      "selected_stale",
      "selected_not_best_price",
    ])
  ),
  selected_alternative: estimateSupplierComparisonAlternativeSchema.nullable(),
  alternatives: z.array(estimateSupplierComparisonAlternativeSchema),
});

const estimateSupplierComparisonCoverageSummarySchema = z.object({
  total_items: z.number().int(),
  covered_items: z.number().int(),
  ambiguous_items: z.number().int(),
  no_price_items: z.number().int(),
  stale_items: z.number().int(),
});

const estimateSupplierPreselectionPatchSchema = z.object({
  unit_price_ht_cents: z.number().int(),
  selected_supplier_price_id: uuidSchema,
});

const estimateSupplierPreselectionProposalSchema = z.object({
  item_id: uuidSchema,
  item_title: z.string(),
  current_alternative: estimateSupplierComparisonAlternativeSchema.nullable(),
  proposed_alternative: estimateSupplierComparisonAlternativeSchema,
  patch: estimateSupplierPreselectionPatchSchema,
  reason: z.enum(["single_clear_option"]),
  explanation: z.string(),
  is_reversible: z.literal(true),
});

const estimateSupplierPreselectionExceptionSchema = z.object({
  item_id: uuidSchema,
  item_title: z.string(),
  reason: z.enum(["divergence", "stale", "ambiguous", "no_price"]),
  coverage_status: z.enum(["covered", "ambiguous", "no_price", "stale"]),
  risk_flags: z.array(
    z.enum([
      "multiple_alternatives",
      "selection_missing",
      "selected_stale",
      "selected_not_best_price",
    ])
  ),
  selected_alternative: estimateSupplierComparisonAlternativeSchema.nullable(),
  alternatives: z.array(estimateSupplierComparisonAlternativeSchema),
});

const estimateSupplierPreselectionSummarySchema = z.object({
  total_items: z.number().int(),
  proposed_items: z.number().int(),
  exception_items: z.number().int(),
  already_selected_items: z.number().int(),
  divergence_items: z.number().int(),
  stale_items: z.number().int(),
  ambiguous_items: z.number().int(),
  no_price_items: z.number().int(),
});

const estimateSupplierPreselectionReviewSchema = z.object({
  summary: estimateSupplierPreselectionSummarySchema,
  proposals: z.array(estimateSupplierPreselectionProposalSchema),
  exceptions: z.array(estimateSupplierPreselectionExceptionSchema),
});

const estimatePurchaseOrderDraftBlockedReasonSchema = z.enum([
  "selection_missing",
  "stale",
  "ambiguous",
  "no_price",
  "missing_quantity",
  "non_integer_quantity",
  "missing_unit_price",
]);

const estimatePurchaseOrderDraftLineSchema = z.object({
  item_id: uuidSchema,
  item_title: z.string(),
  quantity: z.number(),
  unit_price_ht_cents: z.number().int(),
  tax_rate_bp: z.number().int(),
  line_total_ht_cents: z.number().int(),
  line_tax_cents: z.number().int(),
  line_total_ttc_cents: z.number().int(),
  selected_supplier_price_id: uuidSchema,
  supplier_reference: z.string().nullable(),
  product_designation: z.string(),
});

const estimatePurchaseOrderDraftGroupSchema = z.object({
  group_key: z.string(),
  supplier_id: uuidSchema,
  supplier_name: z.string(),
  line_count: z.number().int(),
  total_ht_cents: z.number().int(),
  total_tax_cents: z.number().int(),
  total_ttc_cents: z.number().int(),
  lines: z.array(estimatePurchaseOrderDraftLineSchema),
});

const estimatePurchaseOrderDraftBlockedLineSchema = z.object({
  item_id: uuidSchema,
  item_title: z.string(),
  quantity: z.number().nullable(),
  unit_price_ht_cents: z.number().int().nullable(),
  tax_rate_bp: z.number().int().nullable(),
  selected_supplier_price_id: uuidSchema.nullable(),
  reason: estimatePurchaseOrderDraftBlockedReasonSchema,
  coverage_status: z.enum(["covered", "ambiguous", "no_price", "stale"]).nullable(),
  risk_flags: z.array(
    z.enum([
      "multiple_alternatives",
      "selection_missing",
      "selected_stale",
      "selected_not_best_price",
    ])
  ),
  selected_alternative: estimateSupplierComparisonAlternativeSchema.nullable(),
  alternatives: z.array(estimateSupplierComparisonAlternativeSchema),
});

const estimatePurchaseOrderDraftPreparationSummarySchema = z.object({
  total_supplier_lines: z.number().int(),
  draftable_lines: z.number().int(),
  blocked_lines: z.number().int(),
  supplier_groups: z.number().int(),
  selection_missing_lines: z.number().int(),
  stale_lines: z.number().int(),
  ambiguous_lines: z.number().int(),
  no_price_lines: z.number().int(),
  missing_quantity_lines: z.number().int(),
  non_integer_quantity_lines: z.number().int(),
  missing_unit_price_lines: z.number().int(),
});

const estimatePurchaseOrderDraftCreationOrderSchema = z.object({
  purchase_order_id: uuidSchema,
  reference: z.string(),
  supplier_id: uuidSchema,
  supplier_name: z.string(),
  delivery_site_id: z.string(),
  item_count: z.number().int(),
  total_ht_cents: z.number().int(),
  total_tax_cents: z.number().int(),
  total_ttc_cents: z.number().int(),
  ordered_source_item_ids: z.array(uuidSchema),
});

const estimateBatchResultSchema = z.object({
  committed: z.boolean(),
  version: estimateVersionTokenSchema,
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
    reference_code: z.string().nullable(),
    unit: z.string().nullable(),
    pricing_source: z.string().nullable(),
    ds_cents: z.number().int(),
    indicative_target_price_cents: z.number().int(),
    avg_output_rate: z.number().nullable(),
    avg_time_hours: z.number().nullable(),
    source_metadata: z.record(z.string(), z.unknown()).nullable(),
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
    h_mo: z.number().nonnegative(),
    position: z.number().int(),
    cost_type: z.enum(["material", "labor", "equipment", "subcontract"]),
    unit_cost_ht_cents: z.number().int(),
    loss_coeff_bp: z.number().int(),
    yield_value: z.number().nullable(),
    yield_unit: z.string().nullable(),
    source_metadata: z.record(z.string(), z.unknown()),
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

const estimateSendDataSchema = z.object({
  message_id: z.string().nullable(),
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
  coverage_summary: estimateSupplierComparisonCoverageSummarySchema,
  comparisons: z.array(estimateSupplierComparisonSchema),
  bulk_preselection: estimateSupplierPreselectionReviewSchema,
});

const estimatePurchaseOrderDraftPreparationDataSchema = z.object({
  version_id: uuidSchema,
  stale_price_days: z.number().int(),
  summary: estimatePurchaseOrderDraftPreparationSummarySchema,
  groups: z.array(estimatePurchaseOrderDraftGroupSchema),
  blocked_lines: z.array(estimatePurchaseOrderDraftBlockedLineSchema),
});

const estimatePurchaseOrderDraftCreationDataSchema = z.object({
  source_version_id: uuidSchema,
  summary: z.object({
    draft_orders_created: z.number().int(),
    draft_lines_created: z.number().int(),
  }),
  orders: z.array(estimatePurchaseOrderDraftCreationOrderSchema),
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

const anomalyHistoryCurrentRowSchema = z.object({
  versionId: uuidSchema,
  versionLabel: z.string(),
  projectName: z.string(),
  ownerUserId: uuidSchema,
  ownerName: z.string(),
  flagKey: z.string(),
  flagLabel: z.string(),
  severity: z.enum(["blocking", "warning"]),
  itemCount: z.number(),
});
const anomalyHistoryTrendSchema = z.object({
  period: z.string(),
  opened: z.number(),
  resolved: z.number(),
});
const anomalyHistoryAvgResolutionSchema = z.object({
  flagKey: z.string(),
  flagLabel: z.string(),
  avgDays: z.number(),
});
const anomalyHistorySummarySchema = z.object({
  totalAnomalies: z.number(),
  blockingCount: z.number(),
  warningCount: z.number(),
  estimatesAffected: z.number(),
  estimatesTotal: z.number(),
});
const anomalyHistoryLegacyDataSchema = z.object({
  summary: anomalyHistorySummarySchema,
  currentAnomalies: z.array(anomalyHistoryCurrentRowSchema),
  trend: z.array(anomalyHistoryTrendSchema),
  avgResolution: z.array(anomalyHistoryAvgResolutionSchema),
});
const anomalyHistoryCurrentDataSchema = z.object({
  summary: anomalyHistorySummarySchema,
  currentAnomalies: z.array(anomalyHistoryCurrentRowSchema),
  ownerOptions: z.array(
    z.object({
      id: uuidSchema,
      name: z.string(),
    })
  ),
  pagination: z.object({
    page: z.number().int().positive(),
    size: z.union([z.literal(25), z.literal(50), z.literal(100)]),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().positive(),
  }),
});
const anomalyHistoryTrendDataSchema = z.object({
  trend: z.array(anomalyHistoryTrendSchema),
  avgResolution: z.array(anomalyHistoryAvgResolutionSchema),
});
const anomalyHistoryDataSchema = z.union([
  anomalyHistoryLegacyDataSchema,
  anomalyHistoryCurrentDataSchema,
  anomalyHistoryTrendDataSchema,
]);

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

const estimateExplanationDataSchema = estimateExplanationResponseSchema;

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
  labor_roles: z.array(laborRoleSchema),
});

const estimateAssemblyDataSchema = z.object({
  assembly: estimateAssemblyDetailSchema,
});

const estimateBatchDataSchema = estimateBatchResultSchema;
const takeoffJobCreateDataSchema = z.object({
  id: uuidSchema,
  status: z.string(),
  level: z.literal("A"),
  source_file_name: z.string().nullable(),
  estimate_version_id: uuidSchema,
  created_at: z.string(),
});
const takeoffJobCreateFormDataSchema = z.object({
  file: z.any(),
  estimate_version_id: uuidSchema,
  level: z.literal("A"),
});
const takeoffJobMetricsSchema = z.object({
  token_count: z.number().int().nullable(),
  cost_cents: z.number().int().nullable(),
  duration_ms: z.number().int().nullable(),
});
const takeoffJobSummarySchema = z.object({
  id: uuidSchema,
  estimate_version_id: uuidSchema,
  status: takeoffJobStatusSchema,
  level: takeoffLevelSchema,
  source_file_name: z.string().nullable(),
  source_file_type: z.string().nullable(),
  source_file_size_bytes: z.number().int().nullable(),
  prompt_version: z.string().nullable(),
  schema_version: z.string().nullable(),
  model: z.string().nullable(),
  thinking_level: z.string().nullable(),
  media_resolution: z.string().nullable(),
  retry_count: z.number().int().min(0),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  items_count: z.number().int().min(0).nullable().optional(),
  metrics: takeoffJobMetricsSchema,
});
const takeoffJobPaginationSchema = z.object({
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
  total: z.number().int().min(0),
});
const takeoffJobStatusCountersSchema = z.object({
  total: z.number().int().min(0),
  processing: z.number().int().min(0),
  completed: z.number().int().min(0),
  failed: z.number().int().min(0),
  canceled: z.number().int().min(0),
});
const takeoffJobListDataSchema = z.object({
  jobs: z.array(takeoffJobSummarySchema),
  counters: takeoffJobStatusCountersSchema,
  pagination: takeoffJobPaginationSchema,
});
const takeoffJobResultSchema = z.object({
  id: uuidSchema,
  extracted_json: z.unknown(),
  warnings: z.array(z.unknown()),
  tables: z.array(z.unknown()),
  provider_meta: z.record(z.string(), z.unknown()),
  raw_response: z.unknown().nullable(),
  confidence: z.number().nullable(),
  token_count: z.number().int().nullable(),
  cost_cents: z.number().int().nullable(),
  duration_ms: z.number().int().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
const takeoffJobItemSchema = z.object({
  id: uuidSchema,
  designation: z.string(),
  quantity: z.number(),
  unit: z.string(),
  confidence: z.number().nullable(),
  evidence: z.string().nullable(),
  source_file_name: z.string().nullable(),
  source_page: z.number().int().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  is_excluded: z.boolean(),
  is_verified: z.boolean(),
  verified_at: z.string().nullable(),
  verified_by: uuidSchema.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
const takeoffJobDetailDataSchema = z.object({
  job: takeoffJobSummarySchema,
  result: takeoffJobResultSchema.nullable(),
  items: z.object({
    data: z.array(takeoffJobItemSchema),
    pagination: takeoffJobPaginationSchema,
  }),
});
const takeoffJobActionDataSchema = z.object({
  job: takeoffJobSummarySchema,
});
const takeoffApplyStrategySchema = z.enum(["append", "replace", "merge"]);
const takeoffApplyOverrideActionSchema = z.enum([
  "rename",
  "set_price",
  "set_category",
  "apply_assembly",
  "skip",
  "none",
]);
const takeoffApplyOverrideRenameParamsSchema = z.object({
  designation: z.string().trim().min(1, "La designation est requise."),
});
const takeoffApplyOverrideSetPriceParamsSchema = z.object({
  unit_price_cents: z
    .number()
    .int("Le prix doit etre un entier.")
    .min(0, "Le prix doit etre positif."),
});
const takeoffApplyOverrideSetCategoryParamsSchema = z.object({
  category_id: uuidSchema,
});
const takeoffApplyOverrideApplyAssemblyParamsSchema = z.object({
  assembly_id: uuidSchema,
});
const takeoffApplyOverrideNoopParamsSchema = z.object({});
const takeoffApplyOverrideSchema = z.discriminatedUnion("action", [
  z.object({
    item_id: uuidSchema,
    action: z.literal("rename"),
    action_params: takeoffApplyOverrideRenameParamsSchema,
  }),
  z.object({
    item_id: uuidSchema,
    action: z.literal("set_price"),
    action_params: takeoffApplyOverrideSetPriceParamsSchema,
  }),
  z.object({
    item_id: uuidSchema,
    action: z.literal("set_category"),
    action_params: takeoffApplyOverrideSetCategoryParamsSchema,
  }),
  z.object({
    item_id: uuidSchema,
    action: z.literal("apply_assembly"),
    action_params: takeoffApplyOverrideApplyAssemblyParamsSchema,
  }),
  z.object({
    item_id: uuidSchema,
    action: z.literal("skip"),
    action_params: takeoffApplyOverrideNoopParamsSchema.optional(),
  }),
  z.object({
    item_id: uuidSchema,
    action: z.literal("none"),
    action_params: takeoffApplyOverrideNoopParamsSchema.optional(),
  }),
]);
const takeoffJobApplyRequestSchema = z
  .object({
    strategy: takeoffApplyStrategySchema,
    target_section_id: uuidSchema.nullable().optional(),
    overrides: z.array(takeoffApplyOverrideSchema).optional(),
  })
  .strict();
const takeoffApplyScopeSchema = z.enum(["section", "version"]);
const takeoffJobApplySummarySchema = z.object({
  scope: takeoffApplyScopeSchema,
  created_count: z.number().int().min(0),
  updated_count: z.number().int().min(0),
  ignored_count: z.number().int().min(0),
  created_ids: z.array(uuidSchema),
});
const takeoffJobApplyDataSchema = z.object({
  job: takeoffJobSummarySchema,
  summary: takeoffJobApplySummarySchema,
});
const takeoffPreviewConversionStateSchema = z.object({
  designation: z.string(),
  quantity: z.number(),
  unit: z.string(),
  is_excluded: z.boolean(),
  category_id: uuidSchema.nullable(),
  unit_price_cents: z.number().int().min(0).nullable(),
  assembly_id: uuidSchema.nullable(),
});
const takeoffPreviewConversionSummarySchema = z.object({
  total_count: z.number().int().min(0),
  included_count: z.number().int().min(0),
  transformed_count: z.number().int().min(0),
  overridden_count: z.number().int().min(0),
  excluded_by_mapping_count: z.number().int().min(0),
  assembly_insertions_count: z.number().int().min(0),
});
const takeoffPreviewConversionItemSchema = z.object({
  item_id: uuidSchema,
  source_order: z.number().int().min(0),
  rule_id: uuidSchema.nullable(),
  rule_name: z.string().nullable(),
  action: takeoffApplyOverrideActionSchema,
  action_params: z.record(z.string(), z.unknown()),
  applied_by: z.enum(["none", "rule", "override"]),
  original: takeoffPreviewConversionStateSchema,
  transformed: takeoffPreviewConversionStateSchema,
});
const takeoffPreviewConversionDataSchema = z.object({
  job_id: uuidSchema,
  strategy: takeoffApplyStrategySchema,
  target_section_id: uuidSchema.nullable(),
  summary: takeoffPreviewConversionSummarySchema,
  items: z.array(takeoffPreviewConversionItemSchema),
});
const takeoffDiffMatchStrategySchema = z.enum([
  "designation_fuzzy",
  "designation_plus_page_fuzzy",
]);
const takeoffDiffFieldSchema = z.object({
  field: z.enum([
    "designation",
    "quantity",
    "unit",
    "source_page",
    "confidence",
    "evidence",
  ]),
  label: z.string(),
  kind: z.enum(["text", "number"]),
  before_value: z.union([z.string(), z.number(), z.null()]),
  after_value: z.union([z.string(), z.number(), z.null()]),
});
const takeoffDiffAddedEntrySchema = z.object({
  key: z.string(),
  change_type: z.literal("added"),
  other_item: takeoffJobItemSchema,
});
const takeoffDiffRemovedEntrySchema = z.object({
  key: z.string(),
  change_type: z.literal("removed"),
  base_item: takeoffJobItemSchema,
});
const takeoffDiffChangedEntrySchema = z.object({
  key: z.string(),
  change_type: z.literal("changed"),
  base_item: takeoffJobItemSchema,
  other_item: takeoffJobItemSchema,
  match_score: z.number(),
  match_strategy: takeoffDiffMatchStrategySchema,
  delta: z.array(takeoffDiffFieldSchema),
});
const takeoffDiffUnchangedEntrySchema = z.object({
  key: z.string(),
  change_type: z.literal("unchanged"),
  base_item: takeoffJobItemSchema,
  other_item: takeoffJobItemSchema,
  match_score: z.number(),
  match_strategy: takeoffDiffMatchStrategySchema,
});
const takeoffJobCompareSummarySchema = z.object({
  added: z.number().int().min(0),
  removed: z.number().int().min(0),
  changed: z.number().int().min(0),
  unchanged: z.number().int().min(0),
  total_base: z.number().int().min(0),
  total_other: z.number().int().min(0),
});
const takeoffJobCompareDataSchema = z.object({
  base_job_id: uuidSchema,
  other_job_id: uuidSchema,
  threshold: z.number().min(0).max(1),
  summary: takeoffJobCompareSummarySchema,
  added: z.array(takeoffDiffAddedEntrySchema),
  removed: z.array(takeoffDiffRemovedEntrySchema),
  changed: z.array(takeoffDiffChangedEntrySchema),
  unchanged: z.array(takeoffDiffUnchangedEntrySchema),
});
const takeoffDpgfComparisonViewSchema = z.enum(["all", "exceptions_only"]);
const takeoffDpgfComparisonEvidenceKindSchema = z.enum([
  "fact",
  "hypothesis",
  "inference",
]);
const takeoffDpgfComparisonEvidenceTypeSchema = z.enum([
  "dpgf",
  "takeoff",
  "plan_zone",
  "formula",
  "price_source",
  "comment",
]);
const takeoffDpgfReviewStatusSchema = z.enum([
  "reliable_match",
  "to_confirm",
  "significant_gap",
  "unlinked",
  "forced_manual",
]);
const takeoffDpgfReviewDecisionSchema = z.enum([
  "keep_dpgf",
  "keep_takeoff",
  "manual_fix",
  "out_of_scope",
]);
const takeoffDpgfComparisonDpgfLineSchema = z.object({
  estimate_item_id: uuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  quantity: z.number().positive(),
  unit: z.string().nullable(),
  source_page: z.number().int().nullable(),
  source_file_name: z.string().nullable(),
  position: z.number().int().min(0),
});
const takeoffDpgfComparisonTakeoffLineSchema = z.object({
  item_id: uuidSchema,
  designation: z.string(),
  quantity: z.number().positive(),
  unit: z.string(),
  source_page: z.number().int().nullable(),
  source_file_name: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  evidence: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
});
const takeoffDpgfComparisonProofSchema = z.object({
  proof_id: z.string(),
  type: takeoffDpgfComparisonEvidenceTypeSchema,
  kind: takeoffDpgfComparisonEvidenceKindSchema,
  label: z.string(),
  source: z.string(),
  confidence_score: z.number().min(0).max(1).nullable(),
  note: z.string().nullable(),
});
const takeoffDpgfReviewDecisionRecordSchema = z.object({
  id: uuidSchema,
  tenant_id: uuidSchema,
  version_id: uuidSchema,
  takeoff_job_id: uuidSchema,
  estimate_item_id: uuidSchema,
  decision: takeoffDpgfReviewDecisionSchema,
  reason: z.string().nullable(),
  review_reference: z.string(),
  line_label: z.string(),
  line_position: z.number().int().min(0),
  source_file_name: z.string().nullable(),
  source_page: z.number().int().nullable(),
  decided_at: z.string(),
  updated_at: z.string(),
  decided_by: uuidSchema.nullable(),
  source: z.enum(["current_version", "carried_over"]),
  carried_over_from_version_id: uuidSchema.nullable(),
  carried_over_from_version_number: z.number().int().positive().nullable(),
});
const takeoffDpgfUnusedTakeoffItemSchema = z.object({
  item_id: uuidSchema,
  designation: z.string(),
  quantity: z.number().positive(),
  unit: z.string(),
  source_file_name: z.string().nullable(),
  source_page: z.number().int().nullable(),
  confidence_score: z.number().min(0).max(1).nullable(),
  evidence: z.string().nullable(),
});
const takeoffPriceSuggestionStatusSchema = z.enum([
  "pending",
  "applied",
  "kept_current",
  "rejected",
]);
const takeoffPriceSuggestionActionSchema = z.enum([
  "apply_low",
  "apply_target",
  "apply_high",
  "keep_current",
  "reject",
]);
const takeoffPriceSuggestionSourceKindSchema = z.enum([
  "history",
  "pricebook",
  "similar_item",
  "external_reference",
]);
const takeoffPriceSuggestionConfidenceLabelSchema = z.enum([
  "low",
  "medium",
  "high",
]);
const takeoffPriceSuggestionFactorSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.string(),
  kind: takeoffDpgfComparisonEvidenceKindSchema,
});
const takeoffPriceSuggestionSourceSchema = z.object({
  source_id: z.string().min(1),
  source_kind: takeoffPriceSuggestionSourceKindSchema,
  kind: takeoffDpgfComparisonEvidenceKindSchema,
  label: z.string(),
  source_ref: z.string(),
  price_cents: z.number().int().min(0),
  freshness_label: z.string().nullable(),
  confidence_score: z.number().min(0).max(1).nullable(),
  rank: z.number().int().min(1),
  is_outlier: z.boolean(),
  source_record_table: z.string().nullable(),
  source_record_id: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
});
const takeoffPriceSuggestionSnapshotSchema = z.object({
  suggestion_id: uuidSchema,
  line_id: uuidSchema,
  version_id: uuidSchema,
  job_id: uuidSchema,
  current_price_cents: z.number().int().min(0).nullable(),
  low_cents: z.number().int().min(0),
  target_cents: z.number().int().min(0),
  high_cents: z.number().int().min(0),
  confidence_score: z.number().min(0).max(1).nullable(),
  confidence_label: takeoffPriceSuggestionConfidenceLabelSchema,
  candidate_count: z.number().int().min(0),
  outlier_count: z.number().int().min(0),
  justification: z.string(),
  factors: z.array(takeoffPriceSuggestionFactorSchema),
  summary: z.record(z.string(), z.unknown()),
  status: takeoffPriceSuggestionStatusSchema,
  selected_action: takeoffPriceSuggestionActionSchema.nullable(),
  selected_price_cents: z.number().int().min(0).nullable(),
  review_note: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  reviewed_by: uuidSchema.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  sources: z.array(takeoffPriceSuggestionSourceSchema),
});
const takeoffRiskSeveritySchema = z.enum(["info", "warning", "critical"]);
const takeoffRiskStatusSchema = z.enum([
  "to_process",
  "assumed",
  "false_positive",
]);
const takeoffRiskScopeTypeSchema = z.enum(["project", "lot", "line"]);
const takeoffRiskMarginBucketSchema = z.enum([
  "negative",
  "thin",
  "healthy",
  "unknown",
]);
const takeoffRiskCauseCodeSchema = z.enum([
  "missing_proof",
  "dpgf_takeoff_gap",
  "atypical_price",
  "insufficient_margin",
  "vat_inconsistency",
  "missing_piece",
]);
const takeoffRiskProvenanceEntrySchema = z.object({
  kind: takeoffDpgfComparisonEvidenceKindSchema,
  label: z.string(),
  source: z.string(),
  confidence_score: z.number().min(0).max(1).nullable(),
  note: z.string().nullable(),
});
const takeoffDpgfLineRiskSummarySchema = z.object({
  score: z.number().int().min(0).max(100),
  severity: takeoffRiskSeveritySchema,
  causes: z.array(z.string()),
  status: takeoffRiskStatusSchema.nullable(),
});
const takeoffRiskAlertSchema = z.object({
  alert_id: uuidSchema,
  scope_type: takeoffRiskScopeTypeSchema,
  scope_id: uuidSchema.nullable(),
  scope_label: z.string(),
  line_id: uuidSchema.nullable(),
  lot_id: uuidSchema.nullable(),
  cause_code: takeoffRiskCauseCodeSchema,
  cause_label: z.string(),
  severity: takeoffRiskSeveritySchema,
  risk_score: z.number().int().min(0).max(100),
  status: takeoffRiskStatusSchema,
  margin_bucket: takeoffRiskMarginBucketSchema,
  reason_labels: z.array(z.string()),
  provenance: z.array(takeoffRiskProvenanceEntrySchema),
  review_note: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  reviewed_by: uuidSchema.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  metadata: z.record(z.string(), z.unknown()),
});
const takeoffRiskRadarScopeSummarySchema = z.object({
  scope_type: z.enum(["project", "lot"]),
  scope_id: uuidSchema.nullable(),
  scope_label: z.string(),
  score: z.number().int().min(0).max(100),
  severity: takeoffRiskSeveritySchema,
  open_alerts_count: z.number().int().min(0),
  critical_alerts_count: z.number().int().min(0),
  top_causes: z.array(z.string()),
});
const takeoffRiskRadarSummarySchema = z.object({
  to_process_count: z.number().int().min(0),
  assumed_count: z.number().int().min(0),
  false_positive_count: z.number().int().min(0),
  critical_count: z.number().int().min(0),
  warning_count: z.number().int().min(0),
  info_count: z.number().int().min(0),
  top_causes: z.array(z.string()),
  project_score: z.number().int().min(0).max(100),
  project_severity: takeoffRiskSeveritySchema,
});
const takeoffDpgfComparisonRowSchema = z.object({
  line_id: uuidSchema,
  line_label: z.string(),
  dpgf: takeoffDpgfComparisonDpgfLineSchema,
  linked_takeoff_items: z.array(takeoffDpgfComparisonTakeoffLineSchema),
  dpgf_quantity: z.number().nullable(),
  takeoff_quantity: z.number().nullable(),
  quantity_unit: z.string().nullable(),
  matching_score: z.number().min(0).max(1),
  confidence_score: z.number().min(0).max(1),
  review_status: takeoffDpgfReviewStatusSchema,
  proofs: z.array(takeoffDpgfComparisonProofSchema),
  suggested_decision: takeoffDpgfReviewDecisionSchema.nullable(),
  applied_decision: takeoffDpgfReviewDecisionRecordSchema.nullable(),
  delta_absolute: z.number().nullable(),
  delta_percent: z.number().nullable(),
  is_exception: z.boolean(),
  manual_link_count: z.number().int().min(0),
  matched_by: z.enum(["auto", "manual"]).nullable(),
  risk: takeoffDpgfLineRiskSummarySchema.nullable(),
});
const takeoffDpgfComparisonSummarySchema = z.object({
  reliable_matches: z.number().int().min(0),
  to_confirm: z.number().int().min(0),
  significant_gaps: z.number().int().min(0),
  forced_manual: z.number().int().min(0),
  lines_without_proof: z.number().int().min(0),
  unused_takeoff_items: z.number().int().min(0),
  total_lines: z.number().int().min(0),
});
const takeoffDpgfComparisonDataSchema = z.object({
  version_id: uuidSchema,
  job_id: uuidSchema,
  view: takeoffDpgfComparisonViewSchema,
  threshold: z.number().min(0).max(1),
  summary: takeoffDpgfComparisonSummarySchema,
  rows: z.array(takeoffDpgfComparisonRowSchema),
  manual_link_candidates: z.array(takeoffDpgfUnusedTakeoffItemSchema),
  unused_takeoff_items: z.array(takeoffDpgfUnusedTakeoffItemSchema),
  pagination: z.object({
    page_size: z.number().int().min(1),
    next_cursor: z.string().nullable(),
    total: z.number().int().min(0),
  }),
});
const takeoffRiskRadarDataSchema = z.object({
  version_id: uuidSchema,
  job_id: uuidSchema,
  summary: takeoffRiskRadarSummarySchema,
  project: takeoffRiskRadarScopeSummarySchema,
  lots: z.array(takeoffRiskRadarScopeSummarySchema),
  items: z.array(takeoffRiskAlertSchema),
});
const takeoffLineEvidenceStatusSchema = z.enum([
  "active",
  "invalidated",
  "replaced",
]);
const takeoffLineEvidenceEntrySchema = z.object({
  evidence_id: uuidSchema,
  type: takeoffDpgfComparisonEvidenceTypeSchema,
  kind: takeoffDpgfComparisonEvidenceKindSchema,
  label: z.string(),
  source: z.string(),
  source_file_name: z.string().nullable(),
  source_page: z.number().int().nullable(),
  confidence_score: z.number().min(0).max(1).nullable(),
  note: z.string().nullable(),
  created_at: z.string(),
  author_name: z.string().nullable(),
  status: takeoffLineEvidenceStatusSchema,
  supersedes_evidence_id: uuidSchema.nullable(),
  replaced_by_evidence_id: uuidSchema.nullable(),
});
const takeoffLineEvidencePanelDataSchema = z.object({
  line_id: uuidSchema,
  version_id: uuidSchema,
  job_id: uuidSchema,
  evidences: z.array(takeoffLineEvidenceEntrySchema),
  history: z.array(takeoffLineEvidenceEntrySchema),
});
const takeoffPriceSuggestionRequestSchema = z.object({
  version_id: uuidSchema,
  estimate_item_id: uuidSchema,
  force_refresh: z.boolean().optional(),
});
const takeoffPriceSuggestionResponseDataSchema = z.object({
  suggestion: takeoffPriceSuggestionSnapshotSchema,
});
const takeoffPriceSuggestionReviewRequestSchema = z.object({
  version_id: uuidSchema,
  action: takeoffPriceSuggestionActionSchema,
  review_note: z.string().min(1).max(2000),
});
const takeoffPriceSuggestionReviewResponseDataSchema = z.object({
  suggestion: takeoffPriceSuggestionSnapshotSchema,
  applied_item: z
    .object({
      id: uuidSchema,
      unit_price_ht_cents: z.number().int().min(0).nullable(),
      updated_at: z.string(),
    })
    .nullable(),
});
const takeoffDpgfManualLinkSchema = z.object({
  id: uuidSchema,
  tenant_id: uuidSchema,
  version_id: uuidSchema,
  takeoff_job_id: uuidSchema,
  estimate_item_id: uuidSchema,
  takeoff_item_id: uuidSchema,
  created_at: z.string(),
  updated_at: z.string(),
  linked_by: uuidSchema.nullable(),
});
const takeoffDpgfManualLinkRequestSchema = z.object({
  version_id: uuidSchema,
  estimate_item_id: uuidSchema,
  takeoff_item_ids: z.array(uuidSchema),
});
const takeoffDpgfManualLinkResponseDataSchema = z.object({
  links: z.array(takeoffDpgfManualLinkSchema),
});
const takeoffDpgfReviewDecisionRequestSchema = z.object({
  version_id: uuidSchema,
  estimate_item_id: uuidSchema,
  decision: takeoffDpgfReviewDecisionSchema,
  reason: z.string().max(2000).nullable().optional(),
});
const takeoffDpgfReviewDecisionResponseDataSchema = z.object({
  decision: takeoffDpgfReviewDecisionRecordSchema,
});
const takeoffRiskAlertStatusRequestSchema = z.object({
  version_id: uuidSchema,
  status: takeoffRiskStatusSchema,
  review_note: z.string().max(2000).nullable().optional(),
});
const takeoffRiskAlertStatusResponseDataSchema = z.object({
  alert: takeoffRiskAlertSchema,
});
const takeoffMetricsKpisSchema = z.object({
  totalJobs: z.number().int().min(0),
  completedJobs: z.number().int().min(0),
  failedJobs: z.number().int().min(0),
  canceledJobs: z.number().int().min(0),
  appliedJobs: z.number().int().min(0),
  successRate: z.number().min(0),
  avgDurationMs: z.number().int().min(0),
  totalCostCents: z.number().int().min(0),
  avgCostCentsPerJob: z.number().int().min(0),
  avgConfidence: z.number().min(0).max(1),
  avgItemsPerJob: z.number().min(0),
});
const takeoffMetricsTrendPointSchema = z.object({
  key: z.string(),
  label: z.string(),
  createdCount: z.number().int().min(0),
  failedCount: z.number().int().min(0),
});
const takeoffMetricsCostByLevelSchema = z.object({
  level: z.string().min(1),
  totalCostCents: z.number().int().min(0),
  totalTokens: z.number().int().min(0),
  jobCount: z.number().int().min(0),
  failedCount: z.number().int().min(0),
  avgDurationMs: z.number().int().min(0),
  failureRate: z.number().min(0),
  avgItemsPerJob: z.number().min(0),
});
const takeoffMetricsTokenBreakdownSchema = z.object({
  inputTokens: z.number().int().min(0),
  reasoningTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
});
const takeoffMetricsErrorEntrySchema = z.object({
  errorCode: z.string(),
  count: z.number().int().min(0),
  lastOccurrence: z.string(),
});
const takeoffMetricsReliabilitySchema = z.object({
  timedOutCount: z.number().int().min(0),
  budgetExceededCount: z.number().int().min(0),
  totalRunMetrics: z.number().int().min(0),
  retriedJobs: z.number().int().min(0),
  retriedThenCompleted: z.number().int().min(0),
  retrySuccessRate: z.number().min(0),
});
const takeoffMetricsRecentJobSchema = z.object({
  id: uuidSchema,
  status: takeoffJobStatusSchema,
  level: takeoffLevelSchema,
  model: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  costCents: z.number().int().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  errorCode: z.string().nullable(),
  createdAt: z.string(),
});
const takeoffMetricsDataSchema = z.object({
  generatedAt: z.string(),
  period: takeoffJobsPeriodQuerySchema,
  kpis: takeoffMetricsKpisSchema,
  trend: z.array(takeoffMetricsTrendPointSchema),
  costByLevel: z.array(takeoffMetricsCostByLevelSchema),
  tokenBreakdown: takeoffMetricsTokenBreakdownSchema,
  topErrors: z.array(takeoffMetricsErrorEntrySchema),
  reliability: takeoffMetricsReliabilitySchema,
  recentJobs: z.array(takeoffMetricsRecentJobSchema),
});
const takeoffMappingRuleMatchTypeSchema = z.enum(["exact", "contains", "regex"]);
const takeoffMappingRuleRenameActionParamsSchema = z.object({
  designation: z.string().trim().min(1, "La designation est requise."),
});
const takeoffMappingRuleSetPriceActionParamsSchema = z.object({
  unit_price_cents: z
    .number()
    .int("Le prix doit etre un entier.")
    .min(0, "Le prix doit etre positif."),
});
const takeoffMappingRuleSetCategoryActionParamsSchema = z.object({
  category_id: uuidSchema,
});
const takeoffMappingRuleApplyAssemblyActionParamsSchema = z.object({
  assembly_id: uuidSchema,
});
const takeoffMappingRuleSkipActionParamsSchema = z.object({});
function validateTakeoffRegexPattern(
  input: { match_type: "exact" | "contains" | "regex"; match_pattern: string },
  ctx: z.RefinementCtx
) {
  if (input.match_type !== "regex") return;

  try {
    new RegExp(input.match_pattern);
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "match_pattern doit etre une regex valide quand match_type=regex.",
      path: ["match_pattern"],
    });
  }
}

const takeoffMappingRuleSchema = z
  .discriminatedUnion("action", [
    z.object({
      id: uuidSchema,
      tenant_id: uuidSchema,
      created_at: z.string(),
      updated_at: z.string(),
      created_by: uuidSchema.nullable(),
      name: z.string().trim().min(1),
      match_pattern: z.string().trim().min(1),
      match_type: takeoffMappingRuleMatchTypeSchema,
      action: z.literal("rename"),
      action_params: takeoffMappingRuleRenameActionParamsSchema,
      priority: z.number().int().min(0),
      is_active: z.boolean(),
    }),
    z.object({
      id: uuidSchema,
      tenant_id: uuidSchema,
      created_at: z.string(),
      updated_at: z.string(),
      created_by: uuidSchema.nullable(),
      name: z.string().trim().min(1),
      match_pattern: z.string().trim().min(1),
      match_type: takeoffMappingRuleMatchTypeSchema,
      action: z.literal("set_price"),
      action_params: takeoffMappingRuleSetPriceActionParamsSchema,
      priority: z.number().int().min(0),
      is_active: z.boolean(),
    }),
    z.object({
      id: uuidSchema,
      tenant_id: uuidSchema,
      created_at: z.string(),
      updated_at: z.string(),
      created_by: uuidSchema.nullable(),
      name: z.string().trim().min(1),
      match_pattern: z.string().trim().min(1),
      match_type: takeoffMappingRuleMatchTypeSchema,
      action: z.literal("set_category"),
      action_params: takeoffMappingRuleSetCategoryActionParamsSchema,
      priority: z.number().int().min(0),
      is_active: z.boolean(),
    }),
    z.object({
      id: uuidSchema,
      tenant_id: uuidSchema,
      created_at: z.string(),
      updated_at: z.string(),
      created_by: uuidSchema.nullable(),
      name: z.string().trim().min(1),
      match_pattern: z.string().trim().min(1),
      match_type: takeoffMappingRuleMatchTypeSchema,
      action: z.literal("apply_assembly"),
      action_params: takeoffMappingRuleApplyAssemblyActionParamsSchema,
      priority: z.number().int().min(0),
      is_active: z.boolean(),
    }),
    z.object({
      id: uuidSchema,
      tenant_id: uuidSchema,
      created_at: z.string(),
      updated_at: z.string(),
      created_by: uuidSchema.nullable(),
      name: z.string().trim().min(1),
      match_pattern: z.string().trim().min(1),
      match_type: takeoffMappingRuleMatchTypeSchema,
      action: z.literal("skip"),
      action_params: takeoffMappingRuleSkipActionParamsSchema,
      priority: z.number().int().min(0),
      is_active: z.boolean(),
    }),
  ])
  .superRefine((payload, ctx) => validateTakeoffRegexPattern(payload, ctx));
const takeoffMappingRulesDataSchema = z.object({
  mapping_rules: z.array(takeoffMappingRuleSchema),
});
const takeoffMappingRuleDataSchema = z.object({
  mapping_rule: takeoffMappingRuleSchema,
});
const takeoffMappingRuleCreateCommonShape = {
  name: z.string().trim().min(1, "Le nom est requis."),
  match_pattern: z.string().trim().min(1, "Le pattern est requis."),
  match_type: takeoffMappingRuleMatchTypeSchema,
  priority: z
    .number()
    .int("La priorite doit etre un entier.")
    .min(0, "La priorite doit etre positive.")
    .optional(),
  is_active: z.boolean().optional(),
};

const takeoffMappingRuleCreateSchema = z
  .discriminatedUnion("action", [
    z.object({
      ...takeoffMappingRuleCreateCommonShape,
      action: z.literal("rename"),
      action_params: takeoffMappingRuleRenameActionParamsSchema,
    }),
    z.object({
      ...takeoffMappingRuleCreateCommonShape,
      action: z.literal("set_price"),
      action_params: takeoffMappingRuleSetPriceActionParamsSchema,
    }),
    z.object({
      ...takeoffMappingRuleCreateCommonShape,
      action: z.literal("set_category"),
      action_params: takeoffMappingRuleSetCategoryActionParamsSchema,
    }),
    z.object({
      ...takeoffMappingRuleCreateCommonShape,
      action: z.literal("apply_assembly"),
      action_params: takeoffMappingRuleApplyAssemblyActionParamsSchema,
    }),
    z.object({
      ...takeoffMappingRuleCreateCommonShape,
      action: z.literal("skip"),
      action_params: takeoffMappingRuleSkipActionParamsSchema.optional(),
    }),
  ])
  .superRefine((payload, ctx) => validateTakeoffRegexPattern(payload, ctx));

const takeoffMappingRulePatchCommonShape = {
  name: z.string().trim().min(1, "Le nom est requis.").optional(),
  match_pattern: z.string().trim().min(1, "Le pattern est requis.").optional(),
  match_type: takeoffMappingRuleMatchTypeSchema.optional(),
  priority: z
    .number()
    .int("La priorite doit etre un entier.")
    .min(0, "La priorite doit etre positive.")
    .optional(),
  is_active: z.boolean().optional(),
};

const takeoffMappingRulePatchWithoutActionSchema = z
  .object({
    ...takeoffMappingRulePatchCommonShape,
  })
  .superRefine((payload, ctx) => {
    if (Object.keys(payload).length > 0) return;

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Aucun champ de mise a jour fourni.",
      path: [],
    });
  });

const takeoffMappingRulePatchSchema = z
  .union([
    takeoffMappingRulePatchWithoutActionSchema,
    z.object({
      ...takeoffMappingRulePatchCommonShape,
      action: z.literal("rename"),
      action_params: takeoffMappingRuleRenameActionParamsSchema,
    }),
    z.object({
      ...takeoffMappingRulePatchCommonShape,
      action: z.literal("set_price"),
      action_params: takeoffMappingRuleSetPriceActionParamsSchema,
    }),
    z.object({
      ...takeoffMappingRulePatchCommonShape,
      action: z.literal("set_category"),
      action_params: takeoffMappingRuleSetCategoryActionParamsSchema,
    }),
    z.object({
      ...takeoffMappingRulePatchCommonShape,
      action: z.literal("apply_assembly"),
      action_params: takeoffMappingRuleApplyAssemblyActionParamsSchema,
    }),
    z.object({
      ...takeoffMappingRulePatchCommonShape,
      action: z.literal("skip"),
      action_params: takeoffMappingRuleSkipActionParamsSchema.optional(),
    }),
  ])
  .superRefine((payload, ctx) => {
    if (payload.match_type === "regex" && payload.match_pattern !== undefined) {
      validateTakeoffRegexPattern(
        {
          match_type: payload.match_type,
          match_pattern: payload.match_pattern,
        },
        ctx
      );
    }
  });
const takeoffMappingRuleDeleteDataSchema = z.object({
  deleted: z.literal(true),
  rule_id: uuidSchema,
});
const takeoffPlanSetSchema = z
  .object({
    id: uuidSchema,
    tenant_id: uuidSchema,
    estimate_version_id: uuidSchema,
    name: z.string(),
    description: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    created_by: uuidSchema.nullable().optional(),
    created_at: z.string(),
    updated_at: z.string(),
    file_count: z.number().int().min(0).optional(),
  })
  .passthrough();
const takeoffSignedUploadSchema = z
  .object({
    url: z.string().url(),
    method: z.literal("PUT"),
    path: z.string().trim().min(1),
    token: z.string().trim().min(1).optional(),
    expires_at: z.string().optional(),
    expires_in_seconds: z.number().int().positive().optional(),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();
const takeoffPlanFileSchema = z
  .object({
    id: uuidSchema,
    tenant_id: uuidSchema,
    plan_set_id: uuidSchema,
    file_path: z.string(),
    file_name: z.string(),
    file_type: z.string(),
    file_size_bytes: z.number().int().min(0),
    page_count: z.number().int().positive().nullable().optional(),
    file_hash: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    created_by: uuidSchema.nullable().optional(),
    created_at: z.string(),
    updated_at: z.string(),
    download_url: z.string().url().nullable().optional(),
    download_url_expires_at: z.string().nullable().optional(),
  })
  .passthrough();
const takeoffCleanupIssueSchema = z.object({
  resource: z.enum(["metadata", "storage"]),
  file_id: uuidSchema.optional(),
  path: z.string().nullable().optional(),
  message: z.string(),
});
const takeoffCleanupStatusSchema = z.object({
  metadata_deleted: z.boolean(),
  storage_cleanup_attempted: z.boolean(),
  storage_deleted_count: z.number().int().min(0),
  storage_failed_count: z.number().int().min(0),
  errors: z.array(takeoffCleanupIssueSchema).optional(),
});
const takeoffPlanSetCreateSchema = z.object({
  estimate_version_id: uuidSchema,
  name: z.string().trim().min(1, "Le nom du set est requis.").max(255),
  description: z.string().trim().max(2000).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
const takeoffPlanFileCreateSchema = z.object({
  file_name: z.string().trim().min(1, "Le nom du fichier est requis.").max(255),
  file_type: takeoffPlanFileContentTypeSchema,
  file_size_bytes: z
    .number()
    .int("La taille du fichier doit etre un entier.")
    .positive("La taille du fichier doit etre positive.")
    .max(maxTakeoffPlanFileSizeBytes, "Le fichier depasse 50 Mo."),
  page_count: z.number().int().positive().optional(),
  file_hash: z.string().trim().min(1).max(255).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
const takeoffPlanSetsDataSchema = z.object({
  plan_sets: z.array(takeoffPlanSetSchema),
});
const takeoffPlanSetDataSchema = z.object({
  plan_set: takeoffPlanSetSchema,
});
const takeoffPlanSetDeleteDataSchema = z.object({
  deleted: z.literal(true),
  plan_set_id: uuidSchema,
  cleanup: takeoffCleanupStatusSchema,
});
const takeoffPlanFilesDataSchema = z.object({
  plan_files: z.array(takeoffPlanFileSchema),
});
const takeoffPlanFileDataSchema = z.object({
  plan_file: takeoffPlanFileSchema,
});
const takeoffPlanFileSignedUploadDataSchema = z.object({
  plan_file: takeoffPlanFileSchema,
  signed_upload: takeoffSignedUploadSchema,
});
const takeoffPlanFileDeleteDataSchema = z.object({
  deleted: z.literal(true),
  plan_set_id: uuidSchema,
  file_id: uuidSchema,
  cleanup: takeoffCleanupStatusSchema,
});

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
const apiEstimateSendSchemaDefinition = successResponseSchemaDefinition(
  "ApiEstimateSendResponse",
  estimateSendDataSchema
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
const apiEstimatePurchaseOrderDraftPreparationSchemaDefinition = successResponseSchemaDefinition(
  "ApiEstimatePurchaseOrderDraftPreparationResponse",
  estimatePurchaseOrderDraftPreparationDataSchema
);
const apiEstimatePurchaseOrderDraftCreationSchemaDefinition = successResponseSchemaDefinition(
  "ApiEstimatePurchaseOrderDraftCreationResponse",
  estimatePurchaseOrderDraftCreationDataSchema
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
const apiAdminAnomalyHistorySchemaDefinition =
  successResponseSchemaDefinition(
    "ApiAdminAnomalyHistoryResponse",
    anomalyHistoryDataSchema
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
const apiEstimateExplanationSchemaDefinition = successResponseSchemaDefinition(
  "ApiEstimateExplanationResponse",
  estimateExplanationDataSchema
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
const apiTakeoffJobCreateSchemaDefinition = successResponseSchemaDefinition(
  "ApiTakeoffJobCreateResponse",
  takeoffJobCreateDataSchema
);
const apiTakeoffJobListSchemaDefinition = successResponseSchemaDefinition(
  "ApiTakeoffJobListResponse",
  takeoffJobListDataSchema
);
const apiTakeoffJobDetailSchemaDefinition = successResponseSchemaDefinition(
  "ApiTakeoffJobDetailResponse",
  takeoffJobDetailDataSchema
);
const apiTakeoffJobActionSchemaDefinition = successResponseSchemaDefinition(
  "ApiTakeoffJobActionResponse",
  takeoffJobActionDataSchema
);
const apiTakeoffJobApplySchemaDefinition = successResponseSchemaDefinition(
  "ApiTakeoffJobApplyResponse",
  takeoffJobApplyDataSchema
);
const apiTakeoffPreviewConversionSchemaDefinition = successResponseSchemaDefinition(
  "ApiTakeoffPreviewConversionResponse",
  takeoffPreviewConversionDataSchema
);
const apiTakeoffJobCompareSchemaDefinition = successResponseSchemaDefinition(
  "ApiTakeoffJobCompareResponse",
  takeoffJobCompareDataSchema
);
const apiTakeoffDpgfComparisonSchemaDefinition = successResponseSchemaDefinition(
  "ApiTakeoffDpgfComparisonResponse",
  takeoffDpgfComparisonDataSchema
);
const apiTakeoffLineEvidencePanelSchemaDefinition = successResponseSchemaDefinition(
  "ApiTakeoffLineEvidencePanelResponse",
  takeoffLineEvidencePanelDataSchema
);
const apiTakeoffPriceSuggestionSchemaDefinition = successResponseSchemaDefinition(
  "ApiTakeoffPriceSuggestionResponse",
  takeoffPriceSuggestionResponseDataSchema
);
const apiTakeoffDpgfManualLinkSchemaDefinition = successResponseSchemaDefinition(
  "ApiTakeoffDpgfManualLinkResponse",
  takeoffDpgfManualLinkResponseDataSchema
);
const apiTakeoffReviewDecisionSchemaDefinition = successResponseSchemaDefinition(
  "ApiTakeoffReviewDecisionResponse",
  takeoffDpgfReviewDecisionResponseDataSchema
);
const apiTakeoffRiskRadarSchemaDefinition = successResponseSchemaDefinition(
  "ApiTakeoffRiskRadarResponse",
  takeoffRiskRadarDataSchema
);
const apiTakeoffRiskAlertStatusSchemaDefinition = successResponseSchemaDefinition(
  "ApiTakeoffRiskAlertStatusResponse",
  takeoffRiskAlertStatusResponseDataSchema
);
const apiTakeoffPriceSuggestionReviewSchemaDefinition =
  successResponseSchemaDefinition(
    "ApiTakeoffPriceSuggestionReviewResponse",
    takeoffPriceSuggestionReviewResponseDataSchema
  );
const apiTakeoffMetricsStatsSchemaDefinition = successResponseSchemaDefinition(
  "ApiTakeoffMetricsStatsResponse",
  takeoffMetricsDataSchema
);
const apiTakeoffMappingRulesSchemaDefinition = successResponseSchemaDefinition(
  "ApiTakeoffMappingRulesResponse",
  takeoffMappingRulesDataSchema
);
const apiTakeoffMappingRuleSchemaDefinition = successResponseSchemaDefinition(
  "ApiTakeoffMappingRuleResponse",
  takeoffMappingRuleDataSchema
);
const apiTakeoffMappingRuleDeleteSchemaDefinition = successResponseSchemaDefinition(
  "ApiTakeoffMappingRuleDeleteResponse",
  takeoffMappingRuleDeleteDataSchema
);
const apiTakeoffPlanSetsSchemaDefinition = successResponseSchemaDefinition(
  "ApiTakeoffPlanSetsResponse",
  takeoffPlanSetsDataSchema
);
const apiTakeoffPlanSetSchemaDefinition = successResponseSchemaDefinition(
  "ApiTakeoffPlanSetResponse",
  takeoffPlanSetDataSchema
);
const apiTakeoffPlanSetDeleteSchemaDefinition = successResponseSchemaDefinition(
  "ApiTakeoffPlanSetDeleteResponse",
  takeoffPlanSetDeleteDataSchema
);
const apiTakeoffPlanFilesSchemaDefinition = successResponseSchemaDefinition(
  "ApiTakeoffPlanFilesResponse",
  takeoffPlanFilesDataSchema
);
const apiTakeoffPlanFileSchemaDefinition = successResponseSchemaDefinition(
  "ApiTakeoffPlanFileResponse",
  takeoffPlanFileDataSchema
);
const apiTakeoffPlanFileSignedUploadSchemaDefinition =
  successResponseSchemaDefinition(
    "ApiTakeoffPlanFileSignedUploadResponse",
    takeoffPlanFileSignedUploadDataSchema
  );
const apiTakeoffPlanFileDeleteSchemaDefinition = successResponseSchemaDefinition(
  "ApiTakeoffPlanFileDeleteResponse",
  takeoffPlanFileDeleteDataSchema
);
const takeoffApiErrorSchemaDefinition = schemaDefinition(
  "TakeoffApiError",
  takeoffApiErrorSchema,
  "output"
);
const apiTakeoffFailureResponseSchemaDefinition = schemaDefinition(
  "ApiTakeoffFailureResponse",
  apiTakeoffFailureResponseSchema,
  "output"
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
  takeoffApiError: takeoffApiErrorSchemaDefinition,
  apiTakeoffFailureResponse: apiTakeoffFailureResponseSchemaDefinition,
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
const estimateLineIdPathParameter = pathParameter({
  name: "lineId",
  description: "Identifiant UUID de la ligne du devis.",
  schemaName: "EstimateLineIdPathParameter",
  schema: uuidSchema,
});
const takeoffRuleIdPathParameter = pathParameter({
  name: "ruleId",
  description: "Identifiant UUID de la regle de mapping Takeoff.",
  schemaName: "TakeoffRuleIdPathParameter",
  schema: uuidSchema,
});
const takeoffPlanSetIdPathParameter = pathParameter({
  name: "setId",
  description: "Identifiant UUID du set de plans.",
  schemaName: "TakeoffPlanSetIdPathParameter",
  schema: uuidSchema,
});
const takeoffPlanFileIdPathParameter = pathParameter({
  name: "fileId",
  description: "Identifiant UUID du plan dans le set.",
  schemaName: "TakeoffPlanFileIdPathParameter",
  schema: uuidSchema,
});
const takeoffJobIdPathParameter = pathParameter({
  name: "jobId",
  description: "Identifiant UUID du job takeoff.",
  schemaName: "TakeoffJobIdPathParameter",
  schema: uuidSchema,
});
const takeoffLineIdPathParameter = pathParameter({
  name: "lineId",
  description: "Identifiant UUID de la ligne DPGF cible.",
  schemaName: "TakeoffLineIdPathParameter",
  schema: uuidSchema,
});
const takeoffPriceSuggestionIdPathParameter = pathParameter({
  name: "suggestionId",
  description: "Identifiant UUID du snapshot de suggestion de prix.",
  schemaName: "TakeoffPriceSuggestionIdPathParameter",
  schema: uuidSchema,
});
const takeoffRiskAlertIdPathParameter = pathParameter({
  name: "alertId",
  description: "Identifiant UUID de l'alerte de risque.",
  schemaName: "TakeoffRiskAlertIdPathParameter",
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
const idempotencyKeyHeaderParameter = headerParameter({
  name: "Idempotency-Key",
  description:
    "Cle optionnelle d'idempotence pour dedupliquer les creations de jobs Takeoff.",
  schemaName: "IdempotencyKeyHeaderParameter",
  schema: idempotencyKeyHeaderSchema,
  required: false,
});
const takeoffPlanSetEstimateVersionIdQueryParameter = queryParameter({
  name: "estimate_version_id",
  description: "Filtrer les sets de plans par version de chiffrage.",
  schemaName: "TakeoffPlanSetEstimateVersionIdQueryParameter",
  schema: uuidSchema,
  required: false,
});
const takeoffPlanSetLimitQueryParameter = queryParameter({
  name: "limit",
  description: "Nombre maximal de sets retournes (<= 100).",
  schemaName: "TakeoffPlanSetLimitQueryParameter",
  schema: takeoffPlanSetsLimitQuerySchema,
  required: false,
});
const takeoffPlanFileIncludeDownloadUrlQueryParameter = queryParameter({
  name: "include_download_url",
  description: "Quand true, ajoute une URL signee de consultation.",
  schemaName: "TakeoffPlanFileIncludeDownloadUrlQueryParameter",
  schema: takeoffPlanFilesIncludeDownloadUrlQuerySchema,
  required: false,
});
const takeoffJobEstimateVersionIdQueryParameter = queryParameter({
  name: "estimate_version_id",
  description: "Filtrer les jobs takeoff par version de chiffrage.",
  schemaName: "TakeoffJobEstimateVersionIdQueryParameter",
  schema: uuidSchema,
  required: false,
});
const takeoffJobStatusQueryParameter = queryParameter({
  name: "status",
  description: "Filtrer les jobs takeoff par statut.",
  schemaName: "TakeoffJobStatusQueryParameter",
  schema: takeoffJobStatusSchema,
  required: false,
});
const takeoffJobLevelQueryParameter = queryParameter({
  name: "level",
  description: "Filtrer les jobs takeoff par niveau A/B/C.",
  schemaName: "TakeoffJobLevelQueryParameter",
  schema: takeoffLevelSchema,
  required: false,
});
const takeoffJobsPeriodQueryParameter = queryParameter({
  name: "period",
  description: "Filtrer les jobs takeoff sur une periode relative (7d, 30d, 90d).",
  schemaName: "TakeoffJobsPeriodQueryParameter",
  schema: takeoffJobsPeriodQuerySchema,
  required: false,
});
const takeoffJobsLimitQueryParameter = queryParameter({
  name: "limit",
  description: "Nombre maximal de jobs retournes (<= 100).",
  schemaName: "TakeoffJobsLimitQueryParameter",
  schema: takeoffJobsLimitQuerySchema,
  required: false,
});
const takeoffJobsOffsetQueryParameter = queryParameter({
  name: "offset",
  description: "Position de depart pour la pagination des jobs.",
  schemaName: "TakeoffJobsOffsetQueryParameter",
  schema: takeoffJobsOffsetQuerySchema,
  required: false,
});
const takeoffJobItemsLimitQueryParameter = queryParameter({
  name: "items_limit",
  description: "Nombre maximal d'items du job retournes (<= 200).",
  schemaName: "TakeoffJobItemsLimitQueryParameter",
  schema: takeoffJobItemsLimitQuerySchema,
  required: false,
});
const takeoffJobItemsOffsetQueryParameter = queryParameter({
  name: "items_offset",
  description: "Position de depart pour la pagination des items d'un job.",
  schemaName: "TakeoffJobItemsOffsetQueryParameter",
  schema: takeoffJobItemsOffsetQuerySchema,
  required: false,
});
const takeoffCompareWithQueryParameter = queryParameter({
  name: "with",
  description: "Identifiant UUID de l'autre job takeoff a comparer.",
  schemaName: "TakeoffCompareWithQueryParameter",
  schema: uuidSchema,
  required: true,
});
const takeoffCompareThresholdQueryParameter = queryParameter({
  name: "threshold",
  description: "Seuil fuzzy de matching (entre 0.5 et 0.99, defaut 0.8).",
  schemaName: "TakeoffCompareThresholdQueryParameter",
  schema: takeoffCompareThresholdQuerySchema,
  required: false,
});
const takeoffDpgfCompareVersionIdQueryParameter = queryParameter({
  name: "version_id",
  description: "Version de chiffrage cible pour comparer les lignes DPGF au job takeoff.",
  schemaName: "TakeoffDpgfCompareVersionIdQueryParameter",
  schema: uuidSchema,
  required: true,
});
const takeoffPriceSuggestionEstimateItemIdQueryParameter = queryParameter({
  name: "estimate_item_id",
  description: "Identifiant UUID de la ligne DPGF cible pour la suggestion de prix.",
  schemaName: "TakeoffPriceSuggestionEstimateItemIdQueryParameter",
  schema: uuidSchema,
  required: true,
});
const takeoffDpgfCompareCursorQueryParameter = queryParameter({
  name: "cursor",
  description: "Curseur opaque de pagination pour la comparaison DPGF.",
  schemaName: "TakeoffDpgfCompareCursorQueryParameter",
  schema: z.string().max(512),
  required: false,
});
const takeoffDpgfComparePageSizeQueryParameter = queryParameter({
  name: "page_size",
  description: "Nombre maximal de lignes de comparaison retournees (<= 200).",
  schemaName: "TakeoffDpgfComparePageSizeQueryParameter",
  schema: z.number().int().min(1).max(200),
  required: false,
});
const takeoffDpgfCompareViewQueryParameter = queryParameter({
  name: "view",
  description:
    "Filtre serveur de vue DPGF: toutes les lignes ou uniquement les exceptions.",
  schemaName: "TakeoffDpgfCompareViewQueryParameter",
  schema: takeoffDpgfComparisonViewSchema,
  required: false,
});
const takeoffRiskSeverityQueryParameter = queryParameter({
  name: "severity",
  description: "Filtre optionnel sur la severite du signal de risque.",
  schemaName: "TakeoffRiskSeverityQueryParameter",
  schema: takeoffRiskSeveritySchema,
  required: false,
});
const takeoffRiskStatusQueryParameter = queryParameter({
  name: "status",
  description: "Filtre optionnel sur le statut de revue du signal de risque.",
  schemaName: "TakeoffRiskStatusQueryParameter",
  schema: takeoffRiskStatusSchema,
  required: false,
});
const takeoffRiskScopeQueryParameter = queryParameter({
  name: "scope",
  description: "Filtre optionnel sur le scope du signal de risque.",
  schemaName: "TakeoffRiskScopeQueryParameter",
  schema: takeoffRiskScopeTypeSchema,
  required: false,
});
const takeoffRiskLotIdQueryParameter = queryParameter({
  name: "lot_id",
  description: "Filtre optionnel sur le lot associe a l'alerte.",
  schemaName: "TakeoffRiskLotIdQueryParameter",
  schema: uuidSchema,
  required: false,
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
const estimateExplanationDetailQueryParameter = queryParameter({
  name: "detail",
  description: "Quand 1, retourne aussi le detail narratif complet.",
  schemaName: "EstimateExplanationDetailQueryParameter",
  schema: estimateExplanationDetailQueryParamSchema,
  required: false,
});
const estimateExplanationCompareVersionQueryParameter = queryParameter({
  name: "compare_version_id",
  description: "UUID de la version de comparaison pour expliquer le delta.",
  schemaName: "EstimateExplanationCompareVersionQueryParameter",
  schema: estimateDeltaExplanationQuerySchema.shape.compare_version_id,
  required: true,
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
const anomalyHistoryViewQueryParameter = queryParameter({
  name: "view",
  description:
    "Vue retournee : etat courant pagine, tendance, ou reponse historique complete.",
  schemaName: "AnomalyHistoryViewQueryParameter",
  schema: z.enum(["all", "current", "trend"]),
});
const anomalyHistoryFormatQueryParameter = queryParameter({
  name: "format",
  description: "Format JSON ou export CSV complet des anomalies filtrees.",
  schemaName: "AnomalyHistoryFormatQueryParameter",
  schema: z.enum(["json", "csv"]),
});
const anomalyHistoryPageQueryParameter = queryParameter({
  name: "page",
  description: "Page de la vue courante, a partir de 1.",
  schemaName: "AnomalyHistoryPageQueryParameter",
  schema: z.string().regex(/^[1-9]\d*$/u),
});
const anomalyHistorySizeQueryParameter = queryParameter({
  name: "size",
  description: "Nombre d'anomalies par page (25, 50 ou 100).",
  schemaName: "AnomalyHistorySizeQueryParameter",
  schema: z.enum(["25", "50", "100"]),
});
const anomalyHistorySearchQueryParameter = queryParameter({
  name: "search",
  description: "Recherche par projet ou version.",
  schemaName: "AnomalyHistorySearchQueryParameter",
  schema: z.string().trim().max(200),
});
const anomalyHistoryOwnerQueryParameter = queryParameter({
  name: "owner_user_id",
  description: "Identifiant du chiffreur.",
  schemaName: "AnomalyHistoryOwnerQueryParameter",
  schema: uuidSchema,
});
const anomalyHistoryFlagTypesQueryParameter = queryParameter({
  name: "flag_types",
  description: "Types d'anomalies separes par des virgules.",
  schemaName: "AnomalyHistoryFlagTypesQueryParameter",
  schema: z.string().trim().max(1000),
});
const anomalyHistoryDateFromQueryParameter = queryParameter({
  name: "date_from",
  description: "Debut de la periode de tendance (AAAA-MM-JJ).",
  schemaName: "AnomalyHistoryDateFromQueryParameter",
  schema: z.string().date(),
});
const anomalyHistoryDateToQueryParameter = queryParameter({
  name: "date_to",
  description: "Fin de la periode de tendance (AAAA-MM-JJ).",
  schemaName: "AnomalyHistoryDateToQueryParameter",
  schema: z.string().date(),
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

const sendEstimateBody = jsonBody({
  name: "SendEstimateRequest",
  description: "Payload d'envoi d'email de devis (to/cc/subject/message).",
  schema: sendEstimateSchema,
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

const createEstimatePurchaseOrderDraftsBody = jsonBody({
  name: "EstimatePurchaseOrderDraftsRequest",
  description:
    "Creation explicite de brouillons de commandes depuis les choix fournisseur deja retenus.",
  schema: estimatePurchaseOrderDraftsCreateSchema,
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
const createTakeoffJobBody = multipartBody({
  name: "CreateTakeoffJobFormDataRequest",
  description:
    "FormData d'import Takeoff avec fichier source (`file`), `estimate_version_id` et `level=A`.",
  schema: takeoffJobCreateFormDataSchema,
});
const applyTakeoffJobBody = jsonBody({
  name: "ApplyTakeoffJobRequest",
  description:
    "Payload d'application Takeoff (strategie et section cible optionnelle).",
  schema: takeoffJobApplyRequestSchema,
});
const previewTakeoffConversionBody = jsonBody({
  name: "PreviewTakeoffConversionRequest",
  description:
    "Payload de simulation de conversion mapping (meme contrat que l'apply final).",
  schema: takeoffJobApplyRequestSchema,
});
const createTakeoffMappingRuleBody = jsonBody({
  name: "CreateTakeoffMappingRuleRequest",
  description: "Creation d'une regle de mapping Takeoff.",
  schema: takeoffMappingRuleCreateSchema,
});
const patchTakeoffMappingRuleBody = jsonBody({
  name: "PatchTakeoffMappingRuleRequest",
  description: "Mise a jour partielle d'une regle de mapping Takeoff.",
  schema: takeoffMappingRulePatchSchema,
});
const createTakeoffPlanSetBody = jsonBody({
  name: "CreateTakeoffPlanSetRequest",
  description: "Creation d'un set de plans rattache a une version de chiffrage.",
  schema: takeoffPlanSetCreateSchema,
});
const createTakeoffPlanFileBody = jsonBody({
  name: "CreateTakeoffPlanFileRequest",
  description:
    "Creation des metadonnees d'un PDF et generation d'un upload signe court terme.",
  schema: takeoffPlanFileCreateSchema,
});
const putTakeoffDpgfManualLinkBody = jsonBody({
  name: "PutTakeoffDpgfManualLinkRequest",
  description:
    "Creation, remplacement ou suppression de liens manuels entre une ligne DPGF et un ou plusieurs items takeoff.",
  schema: takeoffDpgfManualLinkRequestSchema,
});
const patchTakeoffReviewDecisionBody = jsonBody({
  name: "PatchTakeoffReviewDecisionRequest",
  description:
    "Decision humaine explicite appliquee a une ligne DPGF avec justification optionnelle.",
  schema: takeoffDpgfReviewDecisionRequestSchema,
});
const postTakeoffPriceSuggestionBody = jsonBody({
  name: "PostTakeoffPriceSuggestionRequest",
  description:
    "Demande ou recalcule un snapshot serveur de suggestion de prix explicable pour une ligne DPGF.",
  schema: takeoffPriceSuggestionRequestSchema,
});
const patchTakeoffPriceSuggestionReviewBody = jsonBody({
  name: "PatchTakeoffPriceSuggestionReviewRequest",
  description:
    "Validation humaine explicite d'une suggestion de prix, avec action choisie et note obligatoire.",
  schema: takeoffPriceSuggestionReviewRequestSchema,
});
const patchTakeoffRiskAlertStatusBody = jsonBody({
  name: "PatchTakeoffRiskAlertStatusRequest",
  description:
    "Changement explicite du statut d'une alerte de risque, avec note humaine obligatoire pour assumed / false_positive.",
  schema: takeoffRiskAlertStatusRequestSchema,
});

const mappingRulesErrorResponses: Record<string, OpenApiResponseDefinition> = {
  "400": jsonResponse(
    "Requete invalide ou payload non conforme.",
    openApiSharedSchemaDefinitions.apiFailureResponse
  ),
  "401": jsonResponse(
    "Authentification requise.",
    openApiSharedSchemaDefinitions.apiFailureResponse
  ),
  "403": jsonResponse(
    "Acces interdit.",
    openApiSharedSchemaDefinitions.apiFailureResponse
  ),
  "404": jsonResponse(
    "Ressource introuvable.",
    openApiSharedSchemaDefinitions.apiFailureResponse
  ),
  "409": jsonResponse(
    "Conflit metier ou de concurrence.",
    openApiSharedSchemaDefinitions.apiFailureResponse
  ),
  "422": jsonResponse(
    "Validation metier echouee.",
    openApiSharedSchemaDefinitions.apiFailureResponse
  ),
  "500": jsonResponse(
    "Erreur interne serveur.",
    openApiSharedSchemaDefinitions.apiFailureResponse
  ),
};
const takeoffPlanErrorResponses: Record<string, OpenApiResponseDefinition> = {
  "400": jsonResponse(
    "Requete invalide ou payload non conforme.",
    apiTakeoffFailureResponseSchemaDefinition
  ),
  "401": jsonResponse(
    "Authentification requise.",
    apiTakeoffFailureResponseSchemaDefinition
  ),
  "403": jsonResponse(
    "Acces interdit.",
    apiTakeoffFailureResponseSchemaDefinition
  ),
  "404": jsonResponse(
    "Set de plans ou fichier introuvable.",
    apiTakeoffFailureResponseSchemaDefinition
  ),
  "409": jsonResponse(
    "Conflit metier ou de concurrence.",
    apiTakeoffFailureResponseSchemaDefinition
  ),
  "422": jsonResponse(
    "Validation metier echouee.",
    apiTakeoffFailureResponseSchemaDefinition
  ),
  "500": jsonResponse(
    "Erreur interne serveur.",
    apiTakeoffFailureResponseSchemaDefinition
  ),
};
const takeoffPlanUploadErrorResponses: Record<string, OpenApiResponseDefinition> = {
  ...takeoffPlanErrorResponses,
  "413": jsonResponse(
    "Fichier trop volumineux (maximum 50 Mo).",
    apiTakeoffFailureResponseSchemaDefinition
  ),
};
const takeoffJobsErrorResponses: Record<string, OpenApiResponseDefinition> = {
  "400": jsonResponse(
    "Requete invalide ou payload non conforme.",
    apiTakeoffFailureResponseSchemaDefinition
  ),
  "401": jsonResponse(
    "Authentification requise.",
    apiTakeoffFailureResponseSchemaDefinition
  ),
  "403": jsonResponse(
    "Acces interdit.",
    apiTakeoffFailureResponseSchemaDefinition
  ),
  "404": jsonResponse(
    "Job takeoff introuvable.",
    apiTakeoffFailureResponseSchemaDefinition
  ),
  "409": jsonResponse(
    "Conflit metier ou de concurrence.",
    apiTakeoffFailureResponseSchemaDefinition
  ),
  "422": jsonResponse(
    "Validation metier echouee.",
    apiTakeoffFailureResponseSchemaDefinition
  ),
  "500": jsonResponse(
    "Erreur interne serveur.",
    apiTakeoffFailureResponseSchemaDefinition
  ),
};

const apiOutlierStateSchemaDefinition =
  openApiSharedSchemaDefinitions.apiOutlierStateResponse;
const apiPdfStatusSchemaDefinition = openApiSharedSchemaDefinitions.apiPdfStatusResponse;

export const openApiOperationsRegistry: OpenApiOperationDefinition[] = [
  {
    method: "post",
    path: "/api/takeoff/jobs",
    summary: "Creer un job Takeoff",
    description:
      "Cree un job Takeoff niveau A a partir d'un upload CSV/XLS/XLSX et retourne le job pending.",
    tags: ["Takeoff"],
    parameters: [idempotencyKeyHeaderParameter],
    requestBody: createTakeoffJobBody,
    responses: {
      "201": jsonResponse(
        "Job Takeoff cree avec succes.",
        apiTakeoffJobCreateSchemaDefinition
      ),
      "400": {
        description: "Requete invalide ou payload non conforme.",
        contents: [
          {
            contentType: "application/json",
            schema: apiTakeoffFailureResponseSchemaDefinition,
          },
        ],
      },
      "401": {
        description: "Authentification requise.",
        contents: [
          {
            contentType: "application/json",
            schema: apiTakeoffFailureResponseSchemaDefinition,
          },
        ],
      },
      "403": {
        description: "Acces interdit.",
        contents: [
          {
            contentType: "application/json",
            schema: apiTakeoffFailureResponseSchemaDefinition,
          },
        ],
      },
      "404": {
        description: "Ressource introuvable.",
        contents: [
          {
            contentType: "application/json",
            schema: apiTakeoffFailureResponseSchemaDefinition,
          },
        ],
      },
      "409": {
        description: "Conflit metier ou de concurrence.",
        contents: [
          {
            contentType: "application/json",
            schema: apiTakeoffFailureResponseSchemaDefinition,
          },
        ],
      },
      "413": {
        description: "Fichier trop volumineux (maximum 10 Mo).",
        contents: [
          {
            contentType: "application/json",
            schema: apiTakeoffFailureResponseSchemaDefinition,
          },
        ],
      },
      "422": {
        description:
          "Validation metier echouee (niveau non supporte, format fichier ou UUID invalides).",
        contents: [
          {
            contentType: "application/json",
            schema: apiTakeoffFailureResponseSchemaDefinition,
          },
        ],
      },
      "500": {
        description: "Erreur interne serveur.",
        contents: [
          {
            contentType: "application/json",
            schema: apiTakeoffFailureResponseSchemaDefinition,
          },
        ],
      },
    },
  },
  {
    method: "get",
    path: "/api/takeoff/jobs",
    summary: "Lister les jobs Takeoff",
    description:
      "Retourne les jobs takeoff du tenant courant avec filtres (version, statut, niveau, periode), compteurs par statut et pagination.",
    tags: ["Takeoff"],
    parameters: [
      takeoffJobEstimateVersionIdQueryParameter,
      takeoffJobStatusQueryParameter,
      takeoffJobLevelQueryParameter,
      takeoffJobsPeriodQueryParameter,
      takeoffJobsLimitQueryParameter,
      takeoffJobsOffsetQueryParameter,
    ],
    responses: {
      "200": jsonResponse(
        "Jobs takeoff retournes.",
        apiTakeoffJobListSchemaDefinition
      ),
      ...takeoffJobsErrorResponses,
    },
  },
  {
    method: "get",
    path: "/api/takeoff/stats",
    summary: "Consulter les metriques agregees des jobs Takeoff",
    description:
      "Retourne les KPI admin de consommation et fiabilite des jobs Takeoff avec filtres de periode et niveau.",
    tags: ["Takeoff"],
    parameters: [takeoffJobsPeriodQueryParameter, takeoffJobLevelQueryParameter],
    responses: {
      "200": jsonResponse(
        "Metriques takeoff retournees.",
        apiTakeoffMetricsStatsSchemaDefinition
      ),
      ...takeoffJobsErrorResponses,
    },
  },
  {
    method: "get",
    path: "/api/takeoff/jobs/{jobId}",
    summary: "Recuperer le detail d'un job Takeoff",
    description:
      "Retourne le job, son resultat d'extraction et ses items avec pagination explicite.",
    tags: ["Takeoff"],
    parameters: [
      takeoffJobIdPathParameter,
      takeoffJobItemsLimitQueryParameter,
      takeoffJobItemsOffsetQueryParameter,
    ],
    responses: {
      "200": jsonResponse(
        "Detail du job takeoff retourne.",
        apiTakeoffJobDetailSchemaDefinition
      ),
      ...takeoffJobsErrorResponses,
    },
  },
  {
    method: "get",
    path: "/api/takeoff/jobs/{jobId}/compare",
    summary: "Comparer deux jobs Takeoff",
    description:
      "Compare le job courant avec un autre job du meme document et retourne les deltas (ajoutes, supprimes, modifies, inchanges).",
    tags: ["Takeoff"],
    parameters: [
      takeoffJobIdPathParameter,
      takeoffCompareWithQueryParameter,
      takeoffCompareThresholdQueryParameter,
    ],
    responses: {
      "200": jsonResponse(
        "Comparaison des jobs takeoff retournee.",
        apiTakeoffJobCompareSchemaDefinition
      ),
      ...takeoffJobsErrorResponses,
    },
  },
  {
    method: "get",
    path: "/api/takeoff/jobs/{jobId}/dpgf-compare",
    summary: "Comparer un job Takeoff au DPGF de la version",
    description:
      "Retourne la comparaison entre les lignes DPGF d'une version et les items extraits du job takeoff, avec preuves, confiance, decisions humaines et pagination cursor.",
    tags: ["Takeoff"],
    parameters: [
      takeoffJobIdPathParameter,
      takeoffDpgfCompareVersionIdQueryParameter,
      takeoffDpgfCompareCursorQueryParameter,
      takeoffDpgfComparePageSizeQueryParameter,
      takeoffDpgfCompareViewQueryParameter,
      takeoffCompareThresholdQueryParameter,
    ],
    responses: {
      "200": jsonResponse(
        "Comparaison DPGF vs takeoff retournee.",
        apiTakeoffDpgfComparisonSchemaDefinition
      ),
      ...takeoffJobsErrorResponses,
    },
  },
  {
    method: "get",
    path: "/api/takeoff/jobs/{jobId}/lines/{lineId}/evidence",
    summary: "Charger le panneau preuves d'une ligne DPGF",
    description:
      "Retourne les preuves actives et l'historique remplace/invalide d'une ligne DPGF pour une version et un job takeoff donnes.",
    tags: ["Takeoff"],
    parameters: [
      takeoffJobIdPathParameter,
      takeoffLineIdPathParameter,
      takeoffDpgfCompareVersionIdQueryParameter,
    ],
    responses: {
      "200": jsonResponse(
        "Panneau preuves de la ligne retourne.",
        apiTakeoffLineEvidencePanelSchemaDefinition
      ),
      ...takeoffJobsErrorResponses,
    },
  },
  {
    method: "get",
    path: "/api/takeoff/jobs/{jobId}/price-suggestions",
    summary: "Charger le snapshot actif de suggestion de prix d'une ligne",
    description:
      "Retourne le snapshot actif de fourchette de prix, ses sources, sa confiance et son statut de revue pour une ligne DPGF donnee.",
    tags: ["Takeoff"],
    parameters: [
      takeoffJobIdPathParameter,
      takeoffDpgfCompareVersionIdQueryParameter,
      takeoffPriceSuggestionEstimateItemIdQueryParameter,
    ],
    responses: {
      "200": jsonResponse(
        "Suggestion de prix active retournee.",
        apiTakeoffPriceSuggestionSchemaDefinition
      ),
      ...takeoffJobsErrorResponses,
    },
  },
  {
    method: "post",
    path: "/api/takeoff/jobs/{jobId}/price-suggestions",
    summary: "Calculer et persister un snapshot de suggestion de prix",
    description:
      "Calcule cote serveur une fourchette de prix explicable a partir des sources disponibles, persiste le snapshot courant et ne modifie jamais la ligne de devis.",
    tags: ["Takeoff"],
    parameters: [takeoffJobIdPathParameter],
    requestBody: postTakeoffPriceSuggestionBody,
    responses: {
      "200": jsonResponse(
        "Suggestion de prix calculee et persistee.",
        apiTakeoffPriceSuggestionSchemaDefinition
      ),
      ...takeoffJobsErrorResponses,
    },
  },
  {
    method: "patch",
    path: "/api/takeoff/jobs/{jobId}/price-suggestions/{suggestionId}",
    summary: "Enregistrer la revue humaine d'une suggestion de prix",
    description:
      "Applique explicitement une borne, conserve le prix courant ou rejette la suggestion. Une note humaine explicite est obligatoire et aucune application n'est silencieuse.",
    tags: ["Takeoff"],
    parameters: [takeoffJobIdPathParameter, takeoffPriceSuggestionIdPathParameter],
    requestBody: patchTakeoffPriceSuggestionReviewBody,
    responses: {
      "200": jsonResponse(
        "Revue de suggestion de prix enregistree.",
        apiTakeoffPriceSuggestionReviewSchemaDefinition
      ),
      ...takeoffJobsErrorResponses,
    },
  },
  {
    method: "patch",
    path: "/api/takeoff/jobs/{jobId}/dpgf-link",
    summary: "Enregistrer un lien manuel DPGF",
    description:
      "Cree, remplace ou supprime un ensemble de liens manuels entre une ligne DPGF de la version et des items takeoff du job.",
    tags: ["Takeoff"],
    parameters: [takeoffJobIdPathParameter],
    requestBody: putTakeoffDpgfManualLinkBody,
    responses: {
      "200": jsonResponse(
        "Lien manuel DPGF enregistre.",
        apiTakeoffDpgfManualLinkSchemaDefinition
      ),
      ...takeoffJobsErrorResponses,
    },
  },
  {
    method: "patch",
    path: "/api/takeoff/jobs/{jobId}/review-decision",
    summary: "Enregistrer une decision humaine de revue DPGF",
    description:
      "Persiste une decision humaine explicite sur une ligne DPGF, avec provenance et justification optionnelle.",
    tags: ["Takeoff"],
    parameters: [takeoffJobIdPathParameter],
    requestBody: patchTakeoffReviewDecisionBody,
    responses: {
      "200": jsonResponse(
        "Decision de revue DPGF enregistree.",
        apiTakeoffReviewDecisionSchemaDefinition
      ),
      ...takeoffJobsErrorResponses,
    },
  },
  {
    method: "get",
    path: "/api/takeoff/jobs/{jobId}/risk-radar",
    summary: "Charger le radar canonique de risque takeoff",
    description:
      "Retourne les scores affaire / lots et la file priorisee des signaux de risque explicables pour une version et un job takeoff donnes.",
    tags: ["Takeoff"],
    parameters: [
      takeoffJobIdPathParameter,
      takeoffDpgfCompareVersionIdQueryParameter,
      takeoffRiskSeverityQueryParameter,
      takeoffRiskStatusQueryParameter,
      takeoffRiskScopeQueryParameter,
      takeoffRiskLotIdQueryParameter,
    ],
    responses: {
      "200": jsonResponse(
        "Radar de risque retourne.",
        apiTakeoffRiskRadarSchemaDefinition
      ),
      ...takeoffJobsErrorResponses,
    },
  },
  {
    method: "patch",
    path: "/api/takeoff/jobs/{jobId}/risk-alerts/{alertId}",
    summary: "Mettre a jour le statut explicite d'une alerte de risque",
    description:
      "Passe une alerte de risque en to_process, assumed ou false_positive. assumed / false_positive exigent une note humaine explicite.",
    tags: ["Takeoff"],
    parameters: [takeoffJobIdPathParameter, takeoffRiskAlertIdPathParameter],
    requestBody: patchTakeoffRiskAlertStatusBody,
    responses: {
      "200": jsonResponse(
        "Statut de l'alerte de risque mis a jour.",
        apiTakeoffRiskAlertStatusSchemaDefinition
      ),
      ...takeoffJobsErrorResponses,
    },
  },
  {
    method: "post",
    path: "/api/takeoff/jobs/{jobId}/retry",
    summary: "Relancer un job Takeoff echoue",
    description:
      "Relance un job en echec si la limite de retry n'est pas atteinte et si le delai de backoff est ecoule.",
    tags: ["Takeoff"],
    parameters: [takeoffJobIdPathParameter],
    responses: {
      "200": jsonResponse(
        "Job takeoff relance.",
        apiTakeoffJobActionSchemaDefinition
      ),
      ...takeoffJobsErrorResponses,
    },
  },
  {
    method: "post",
    path: "/api/takeoff/jobs/{jobId}/cancel",
    summary: "Annuler un job Takeoff",
    description:
      "Annule un job en cours (pending ou processing) et le bascule en statut canceled.",
    tags: ["Takeoff"],
    parameters: [takeoffJobIdPathParameter],
    responses: {
      "200": jsonResponse(
        "Job takeoff annule.",
        apiTakeoffJobActionSchemaDefinition
      ),
      ...takeoffJobsErrorResponses,
    },
  },
  {
    method: "post",
    path: "/api/takeoff/jobs/{jobId}/apply",
    summary: "Appliquer un job Takeoff",
    description:
      "Applique les items d'un job completed vers le chiffrage cible avec une strategie et une section optionnelle.",
    tags: ["Takeoff"],
    parameters: [takeoffJobIdPathParameter],
    requestBody: applyTakeoffJobBody,
    responses: {
      "200": jsonResponse(
        "Job takeoff applique.",
        apiTakeoffJobApplySchemaDefinition
      ),
      ...takeoffJobsErrorResponses,
    },
  },
  {
    method: "post",
    path: "/api/takeoff/jobs/{jobId}/preview-conversion",
    summary: "Simuler la conversion mapping d'un job Takeoff",
    description:
      "Calcule les transformations mapping (avant/apres) sans persister, avec support des overrides par item.",
    tags: ["Takeoff"],
    parameters: [takeoffJobIdPathParameter],
    requestBody: previewTakeoffConversionBody,
    responses: {
      "200": jsonResponse(
        "Preview de conversion retournee.",
        apiTakeoffPreviewConversionSchemaDefinition
      ),
      ...takeoffJobsErrorResponses,
    },
  },
  {
    method: "get",
    path: "/api/takeoff/mapping-rules",
    summary: "Lister les regles de mapping Takeoff",
    description:
      "Retourne les regles de mapping du tenant courant, triees par priorite puis date de creation.",
    tags: ["Takeoff"],
    responses: {
      "200": jsonResponse(
        "Regles de mapping retournees.",
        apiTakeoffMappingRulesSchemaDefinition
      ),
      ...mappingRulesErrorResponses,
    },
  },
  {
    method: "post",
    path: "/api/takeoff/mapping-rules",
    summary: "Creer une regle de mapping Takeoff",
    description:
      "Cree une regle de mapping pour enrichir automatiquement les items extraits.",
    tags: ["Takeoff"],
    requestBody: createTakeoffMappingRuleBody,
    responses: {
      "201": jsonResponse(
        "Regle de mapping creee.",
        apiTakeoffMappingRuleSchemaDefinition
      ),
      ...mappingRulesErrorResponses,
    },
  },
  {
    method: "patch",
    path: "/api/takeoff/mapping-rules/{ruleId}",
    summary: "Modifier une regle de mapping Takeoff",
    description: "Met a jour une regle de mapping existante.",
    tags: ["Takeoff"],
    parameters: [takeoffRuleIdPathParameter],
    requestBody: patchTakeoffMappingRuleBody,
    responses: {
      "200": jsonResponse(
        "Regle de mapping mise a jour.",
        apiTakeoffMappingRuleSchemaDefinition
      ),
      ...mappingRulesErrorResponses,
    },
  },
  {
    method: "delete",
    path: "/api/takeoff/mapping-rules/{ruleId}",
    summary: "Supprimer une regle de mapping Takeoff",
    description: "Supprime une regle de mapping existante.",
    tags: ["Takeoff"],
    parameters: [takeoffRuleIdPathParameter],
    responses: {
      "200": jsonResponse(
        "Regle de mapping supprimee.",
        apiTakeoffMappingRuleDeleteSchemaDefinition
      ),
      ...mappingRulesErrorResponses,
    },
  },
  {
    method: "get",
    path: "/api/takeoff/plan-sets",
    summary: "Lister les sets de plans Takeoff",
    description:
      "Retourne les sets de plans du tenant courant, avec filtres optionnels par version.",
    tags: ["Takeoff"],
    parameters: [
      takeoffPlanSetEstimateVersionIdQueryParameter,
      takeoffPlanSetLimitQueryParameter,
    ],
    responses: {
      "200": jsonResponse(
        "Sets de plans retournes.",
        apiTakeoffPlanSetsSchemaDefinition
      ),
      ...takeoffPlanErrorResponses,
    },
  },
  {
    method: "post",
    path: "/api/takeoff/plan-sets",
    summary: "Creer un set de plans Takeoff",
    description:
      "Cree un set de plans pour une version de chiffrage accessible au tenant courant.",
    tags: ["Takeoff"],
    requestBody: createTakeoffPlanSetBody,
    responses: {
      "201": jsonResponse(
        "Set de plans cree avec succes.",
        apiTakeoffPlanSetSchemaDefinition
      ),
      ...takeoffPlanErrorResponses,
    },
  },
  {
    method: "get",
    path: "/api/takeoff/plan-sets/{setId}",
    summary: "Recuperer un set de plans Takeoff",
    description: "Retourne le detail d'un set de plans et ses metadonnees.",
    tags: ["Takeoff"],
    parameters: [takeoffPlanSetIdPathParameter],
    responses: {
      "200": jsonResponse(
        "Set de plans retourne.",
        apiTakeoffPlanSetSchemaDefinition
      ),
      ...takeoffPlanErrorResponses,
    },
  },
  {
    method: "delete",
    path: "/api/takeoff/plan-sets/{setId}",
    summary: "Supprimer un set de plans Takeoff",
    description:
      "Supprime le set de plans, ses metadonnees et declenche le cleanup storage associe.",
    tags: ["Takeoff"],
    parameters: [takeoffPlanSetIdPathParameter],
    responses: {
      "200": jsonResponse(
        "Set de plans supprime.",
        apiTakeoffPlanSetDeleteSchemaDefinition
      ),
      ...takeoffPlanErrorResponses,
    },
  },
  {
    method: "get",
    path: "/api/takeoff/plan-sets/{setId}/files",
    summary: "Lister les plans d'un set",
    description:
      "Retourne les fichiers PDF attaches au set, avec URL signee optionnelle de consultation.",
    tags: ["Takeoff"],
    parameters: [
      takeoffPlanSetIdPathParameter,
      takeoffPlanFileIncludeDownloadUrlQueryParameter,
    ],
    responses: {
      "200": jsonResponse(
        "Fichiers du set retournes.",
        apiTakeoffPlanFilesSchemaDefinition
      ),
      ...takeoffPlanErrorResponses,
    },
  },
  {
    method: "post",
    path: "/api/takeoff/plan-sets/{setId}/files",
    summary: "Creer un plan dans un set",
    description:
      "Cree les metadonnees d'un PDF et retourne les informations d'upload signe (path `{tenant_id}/{set_id}/{file_id}/{filename}`).",
    tags: ["Takeoff"],
    parameters: [takeoffPlanSetIdPathParameter],
    requestBody: createTakeoffPlanFileBody,
    responses: {
      "201": jsonResponse(
        "Plan cree avec upload signe.",
        apiTakeoffPlanFileSignedUploadSchemaDefinition
      ),
      ...takeoffPlanUploadErrorResponses,
    },
  },
  {
    method: "get",
    path: "/api/takeoff/plan-sets/{setId}/files/{fileId}",
    summary: "Recuperer un plan d'un set",
    description:
      "Retourne les metadonnees d'un fichier PDF et, optionnellement, son URL signee de consultation.",
    tags: ["Takeoff"],
    parameters: [
      takeoffPlanSetIdPathParameter,
      takeoffPlanFileIdPathParameter,
      takeoffPlanFileIncludeDownloadUrlQueryParameter,
    ],
    responses: {
      "200": jsonResponse(
        "Plan retourne.",
        apiTakeoffPlanFileSchemaDefinition
      ),
      ...takeoffPlanErrorResponses,
    },
  },
  {
    method: "delete",
    path: "/api/takeoff/plan-sets/{setId}/files/{fileId}",
    summary: "Supprimer un plan d'un set",
    description:
      "Supprime les metadonnees du plan et execute le cleanup storage associe.",
    tags: ["Takeoff"],
    parameters: [takeoffPlanSetIdPathParameter, takeoffPlanFileIdPathParameter],
    responses: {
      "200": jsonResponse(
        "Plan supprime.",
        apiTakeoffPlanFileDeleteSchemaDefinition
      ),
      ...takeoffPlanErrorResponses,
    },
  },
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
    path: "/api/estimates/{versionId}/send",
    summary: "Envoyer une version par email",
    description:
      "Envoie le devis par email (avec piece jointe PDF et message personnalise).",
    tags: ["Estimate Versions"],
    parameters: [versionIdPathParameter],
    requestBody: sendEstimateBody,
    responses: {
      "200": jsonResponse(
        "Email du devis envoye avec succes.",
        apiEstimateSendSchemaDefinition
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
    path: "/api/estimates/{versionId}/purchase-order-drafts",
    summary: "Preparer des brouillons de commandes",
    description:
      "Retourne les groupes fournisseur draftables et les lignes non commandables depuis une version de devis.",
    tags: ["Estimate Output"],
    parameters: [versionIdPathParameter],
    responses: {
      "200": jsonResponse(
        "Preparation des brouillons de commandes retournee.",
        apiEstimatePurchaseOrderDraftPreparationSchemaDefinition
      ),
    },
  },
  {
    method: "post",
    path: "/api/estimates/{versionId}/purchase-order-drafts",
    summary: "Creer des brouillons de commandes",
    description:
      "Cree explicitement des brouillons de commandes par fournisseur a partir des lignes draftables de la version.",
    tags: ["Estimate Output"],
    parameters: [versionIdPathParameter],
    requestBody: createEstimatePurchaseOrderDraftsBody,
    responses: {
      "201": jsonResponse(
        "Brouillons de commandes crees.",
        apiEstimatePurchaseOrderDraftCreationSchemaDefinition
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
    method: "get",
    path: "/api/estimates/{versionId}/lines/{lineId}/explanation",
    summary: "Expliquer le prix d'une ligne",
    description:
      "Retourne un snapshot explicable en lecture seule pour une ligne du devis, avec faits, hypotheses, inferences, provenance et confiance.",
    tags: ["Estimate Diagnostics"],
    parameters: [
      versionIdPathParameter,
      estimateLineIdPathParameter,
      estimateExplanationDetailQueryParameter,
    ],
    responses: {
      "200": jsonResponse(
        "Explication de prix calculee avec succes.",
        apiEstimateExplanationSchemaDefinition
      ),
    },
  },
  {
    method: "get",
    path: "/api/estimates/{versionId}/delta-explanation",
    summary: "Expliquer le delta entre deux versions",
    description:
      "Retourne un snapshot explicable en lecture seule pour le delta entre la version courante et une version de comparaison.",
    tags: ["Estimate Diagnostics"],
    parameters: [
      versionIdPathParameter,
      estimateExplanationCompareVersionQueryParameter,
      estimateExplanationDetailQueryParameter,
    ],
    responses: {
      "200": jsonResponse(
        "Explication de delta calculee avec succes.",
        apiEstimateExplanationSchemaDefinition
      ),
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
  {
    method: "get",
    path: "/api/admin/anomaly-history",
    summary: "Historique des anomalies qualite",
    description:
      "Retourne l'etat courant pagine, les tendances ou la reponse historique complete. L'export CSV contient toujours toutes les anomalies filtrees.",
    tags: ["Administration"],
    parameters: [
      anomalyHistoryViewQueryParameter,
      anomalyHistoryFormatQueryParameter,
      anomalyHistoryPageQueryParameter,
      anomalyHistorySizeQueryParameter,
      anomalyHistorySearchQueryParameter,
      anomalyHistoryOwnerQueryParameter,
      anomalyHistoryFlagTypesQueryParameter,
      anomalyHistoryDateFromQueryParameter,
      anomalyHistoryDateToQueryParameter,
    ],
    responses: {
      "200": {
        description: "Historique anomalies retourne ou exporte.",
        contents: [
          {
            contentType: "application/json",
            schema: apiAdminAnomalyHistorySchemaDefinition,
          },
          {
            contentType: "text/csv",
          },
        ],
      },
    },
  },
];
