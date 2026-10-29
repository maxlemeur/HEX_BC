import { z } from "zod";

import { ESTIMATE_STATUS_VALUES } from "@/lib/estimates/status";
import { ESTIMATE_LINE_PRICING_STATUSES } from "@/lib/units/normalize";
import type { Database } from "@/types/database";

const uuid = z.string().uuid();
const timestamp = z.string().refine((value) => Number.isFinite(Date.parse(value)));
const integer = z.number().int().refine(Number.isSafeInteger);
const number = z.number().finite();
// Opaque metadata may contain any JSON value. Validate with Zod's recursive
// parser while documenting an unconstrained JSON field: the OpenAPI component
// must not embed recursive $refs that point at the document root.
const jsonValue = z.json();
const json = z.custom<z.infer<typeof jsonValue>>((value) => jsonValue.safeParse(value).success);
const rowIdentity = { id: uuid, tenant_id: uuid, created_at: timestamp, updated_at: timestamp };
const invalidReadMessage = "Les données du chiffrage sont invalides. Rechargez le devis.";

// Read schemas describe persisted values, including historical engines. They do
// not apply today's creation defaults or recalculate an issued document.
export const estimateEditorProjectSchema = z.object({
  name: z.string(),
  id: uuid.optional(), tenant_id: uuid.optional(), user_id: uuid.optional(),
  reference: z.string().nullable().optional(),
  estimate_reference: z.string().nullable().optional(),
  client_name: z.string().nullable().optional(),
  site_address: z.string().nullable().optional(),
  notes: z.string().nullable().optional(), is_archived: z.boolean().optional(),
}).passthrough();

export const estimateEditorVersionSchema = z.object({
  ...rowIdentity,
  project_id: uuid, version_number: integer, status: z.enum(ESTIMATE_STATUS_VALUES),
  title: z.string().nullable(), exclusions: z.string().nullable(),
  date_devis: z.string(), validite_jours: integer, currency: z.string(),
  calc_engine_version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  content_revision: integer.nonnegative(),
  calc_snapshot_content_revision: integer.nullable(), calc_snapshot_context: json.nullable(),
  margin_mode: z.enum(["fixed", "tiered"]), margin_multiplier: number, margin_bp: integer,
  discount_mode: z.enum(["simple", "cascade"]), discount_bp: integer,
  discount_steps: z.array(number), discount_amount_cents: integer.nullable(),
  discount_applied_cents: integer.nullable(), global_coefficient: number,
  rounding_mode: z.enum(["none", "nearest", "up", "down"]), rounding_step_cents: integer,
  rounding_adjustment_cents: integer, commercial_rounding_cents: integer.nullable(),
  tax_rate_bp: integer, total_ht_cents: integer, total_tax_cents: integer, total_ttc_cents: integer,
  gross_ht_cents: integer.nullable(),
  sale_coefficient_fo: number.nullable(), sale_coefficient_mo: number.nullable(),
  max_section_depth: integer, contractor_role: z.string(),
  approval_status: z.enum(["not_required", "required", "in_review", "approved", "changes_requested"]),
  approval_summary: json, approval_evaluated_at: timestamp.nullable(),
  parent_version_id: uuid.nullable(), variant_label: z.string().nullable(),
  seal_hash: z.string().nullable(), seal_payload_version: integer.nullable(),
  estimate_projects: z.union([
    estimateEditorProjectSchema, z.array(estimateEditorProjectSchema),
  ]).nullable(),
}).passthrough() satisfies z.ZodType<Database["public"]["Tables"]["estimate_versions"]["Row"]>;

const lineTruthSchema = z.object({
  source: z.object({
    kind: z.enum(["manual", "dpgf", "plan", "brief", "cctp", "assembly", "mixed", "unknown"]),
    label: z.string(), detail: z.string().nullable(),
  }),
  qtyStatus: z.object({
    code: z.enum(["imported_unverified", "measured", "assumed", "provisional", "to_confirm", "missing"]),
    label: z.string(), detail: z.string().nullable(),
  }),
  confidence: z.object({
    label: z.enum(["faible", "moyenne", "forte"]), score: number.nullable(), detail: z.string().nullable(),
  }),
  needsReview: z.boolean(),
});

export const estimateEditorItemSchema = z.object({
  ...rowIdentity,
  version_id: uuid, parent_id: uuid.nullable(), item_type: z.enum(["section", "line"]),
  position: integer, title: z.string(), description: z.string().nullable(),
  quantity: number.nullable(), unit_price_ht_cents: integer.nullable(), pu_ht_cents: integer.nullable(),
  tax_rate_bp: integer.nullable(), k_fo: number.nullable(), k_mo: number.nullable(),
  h_mo: number.nullable(), h_mo_majoration: number,
  h_mo_atelier: number.nullable(), h_mo_chantier: number.nullable(),
  k_mo_atelier: number.nullable(), k_mo_chantier: number.nullable(),
  h_mo_per_unit: number.nullable(), h_mo_atelier_per_unit: number.nullable(), h_mo_chantier_per_unit: number.nullable(),
  labor_role_id: uuid.nullable(), labor_role_atelier_id: uuid.nullable(), labor_role_chantier_id: uuid.nullable(),
  category_id: uuid.nullable(), supply_type_id: uuid.nullable(), product_id: uuid.nullable(),
  selected_supplier_price_id: uuid.nullable(),
  selected_supplier_details: z.object({
    price_id: uuid, name: z.string().nullable(), reference: z.string().nullable(),
  }).nullable().optional(),
  line_nature: z.enum(["supply_only", "supply_and_labor", "labor_only"]).nullable(),
  fo_provision: number.nullable(), aid: z.string().nullable(),
  unit_code: z.string().nullable(), pricing_status: z.enum(ESTIMATE_LINE_PRICING_STATUSES),
  line_total_ht_cents: integer.nullable(), line_tax_cents: integer.nullable(), line_total_ttc_cents: integer.nullable(),
  snapshot_pu_ht_cents: integer.nullable(), snapshot_gross_ht_cents: integer.nullable(),
  snapshot_gross_fo_ht_cents: integer.nullable(), snapshot_fo_ht_cents: integer.nullable(),
  snapshot_mo_ht_cents: integer.nullable(), snapshot_mo_atelier_ht_cents: integer.nullable(),
  snapshot_mo_chantier_ht_cents: integer.nullable(),
  source_provider: z.string().nullable(), source_job_id: uuid.nullable(),
  source_file_name: z.string().nullable(), source_page: integer.nullable(), source_metadata: json,
  source_level: z.string().nullable().optional(), source_version_number: integer.nullable().optional(),
  source_extracted_at: timestamp.nullable().optional(), line_truth: lineTruthSchema.nullable().optional(),
}).passthrough() satisfies z.ZodType<Database["public"]["Tables"]["estimate_items"]["Row"]>;

export const estimateEditorCategorySchema = z.object({
  ...rowIdentity, user_id: uuid, name: z.string(), color: z.string().nullable(), position: integer,
}).passthrough() satisfies z.ZodType<Database["public"]["Tables"]["estimate_categories"]["Row"]>;

export const estimateEditorSupplyTypeSchema = z.object({
  ...rowIdentity, code: z.string(), name: z.string(), default_fo_provision: number,
}).passthrough() satisfies z.ZodType<Database["public"]["Tables"]["supply_types"]["Row"]>;

export const estimateEditorLaborRoleSchema = z.object({
  ...rowIdentity, user_id: uuid, name: z.string(), hourly_rate_cents: integer,
  is_active: z.boolean(), position: integer,
}).passthrough() satisfies z.ZodType<Database["public"]["Tables"]["labor_roles"]["Row"]>;

export const estimateEditorMarginTierSchema = z.object({
  ...rowIdentity, threshold_cents: integer, multiplier: number, position: integer,
}).passthrough() satisfies z.ZodType<Database["public"]["Tables"]["margin_tiers"]["Row"]>;

export const estimateEditorSuggestionRuleSchema = z.object({
  ...rowIdentity, user_id: uuid, name: z.string(), match_type: z.literal("keyword"), match_value: z.string(),
  unit: z.string().nullable(), category_id: uuid.nullable(), labor_role_id: uuid.nullable(),
  k_fo: number.nullable(), k_mo: number.nullable(), position: integer,
  is_active: z.boolean(), usage_count: integer, last_used_at: timestamp.nullable(),
}).passthrough() satisfies z.ZodType<Database["public"]["Tables"]["estimate_suggestion_rules"]["Row"]>;

export const estimateVersionZeroSummarySchema = z.object({
  versionId: uuid, projectId: uuid, hasConfirmedBrief: z.boolean(), confirmedBriefId: uuid.nullable(),
  isVersionEmpty: z.boolean(), canGenerate: z.boolean(), availableLots: z.array(z.string()),
  activeDraft: z.object({
    id: uuid, status: z.enum(["ia_a_revoir", "ready_for_version", "materialized", "discarded", "superseded"]),
    createdAt: timestamp, materializedAt: timestamp.nullable(), selectedLots: z.array(z.string()),
    counts: z.object({
      lots: integer, lines: integer, pending: integer, accepted: integer, edited: integer,
      rejected: integer, missingLots: integer, partialLots: integer, lowConfidenceLines: integer,
    }),
    summaryText: z.string().nullable(), state: z.enum(["active", "terminal"]),
  }).nullable(),
});

export const estimateEditorResponseSchema = z.object({
  version: estimateEditorVersionSchema,
  items: z.array(estimateEditorItemSchema),
  categories: z.array(estimateEditorCategorySchema),
  supply_types: z.array(estimateEditorSupplyTypeSchema),
  labor_roles: z.array(estimateEditorLaborRoleSchema),
  margin_tiers: z.array(estimateEditorMarginTierSchema),
  suggestion_rules: z.array(estimateEditorSuggestionRuleSchema),
  version_zero_summary: estimateVersionZeroSummarySchema.nullable().optional(),
  is_labor_split_enabled: z.boolean().nullable().optional(),
}).passthrough().superRefine((data, context) => {
  const { version } = data;
  const ids = new Set<string>();
  data.items.forEach((item, index) => {
    if (item.version_id !== version.id || item.tenant_id !== version.tenant_id || ids.has(item.id)) {
      context.addIssue({ code: "custom", path: ["items", index], message: "Ligne étrangère au devis ou dupliquée." });
    }
    ids.add(item.id);
  });
  for (const key of ["categories", "supply_types", "labor_roles", "margin_tiers", "suggestion_rules"] as const) {
    data[key].forEach((row, index) => {
      if (row.tenant_id !== version.tenant_id) {
        context.addIssue({ code: "custom", path: [key, index], message: "Référentiel étranger au devis." });
      }
    });
  }
  const projects = Array.isArray(version.estimate_projects) ? version.estimate_projects : [version.estimate_projects];
  if (projects.some((project) => project && (
    (project.id !== undefined && project.id !== version.project_id) ||
    (project.tenant_id !== undefined && project.tenant_id !== version.tenant_id)
  ))) {
    context.addIssue({ code: "custom", path: ["version", "estimate_projects"], message: "Affaire étrangère au devis." });
  }
  if (data.version_zero_summary && (
    data.version_zero_summary.versionId !== version.id || data.version_zero_summary.projectId !== version.project_id
  )) {
    context.addIssue({ code: "custom", path: ["version_zero_summary"], message: "Résumé V0 étranger au devis." });
  }
});

export type EstimateEditorResponse = z.infer<typeof estimateEditorResponseSchema>;
export type EstimateEditorData = ReturnType<typeof toEstimateEditorData>;
export type VersionZeroDraftSummary = z.infer<typeof estimateVersionZeroSummarySchema>;

function toEstimateEditorData(data: EstimateEditorResponse) {
  return {
    version: data.version, items: data.items, categories: data.categories,
    supplyTypes: data.supply_types, laborRoles: data.labor_roles,
    marginTiers: data.margin_tiers, suggestionRules: data.suggestion_rules,
    versionZeroSummary: data.version_zero_summary ?? null,
  };
}

export function parseEstimateEditorResponse(payload: unknown, versionId: string): EstimateEditorResponse {
  const result = estimateEditorResponseSchema.safeParse(payload);
  if (!result.success || result.data.version.id !== versionId) {
    throw new Error(invalidReadMessage);
  }
  return result.data;
}

// Compatibility is confined to names at the transport boundary. A missing or
// malformed collection must never masquerade as an empty, successfully read one.
export function parseEstimateEditorData(payload: unknown, versionId: string): EstimateEditorData {
  const record = z.record(z.string(), z.unknown());
  function readRecord(value: unknown) {
    const result = record.safeParse(value);
    if (!result.success) throw new Error(invalidReadMessage);
    return result.data;
  }
  const envelope = readRecord(payload);
  const root = readRecord(envelope.data === undefined ? envelope : envelope.data);
  const version = readRecord(root.version ?? root.estimateVersion ?? root.estimate);
  const projectName = root.projectName ?? root.project_name ?? version.projectName ?? version.project_name;
  const data = parseEstimateEditorResponse({
    ...root,
    version: {
      ...version,
      estimate_projects: version.estimate_projects ?? (typeof projectName === "string" ? { name: projectName } : null),
    },
    items: root.items ?? root.estimateItems ?? root.estimate_items,
    categories: root.categories ?? root.estimateCategories ?? root.estimate_categories,
    supply_types: root.supply_types ?? root.supplyTypes ?? root.supplyTypesList,
    labor_roles: root.labor_roles ?? root.laborRoles ?? root.roles,
    margin_tiers: root.margin_tiers ?? root.marginTiers,
    suggestion_rules: root.suggestion_rules ?? root.suggestionRules ?? root.rules,
    version_zero_summary: root.version_zero_summary ?? root.versionZeroSummary,
  }, versionId);
  return toEstimateEditorData(data);
}
