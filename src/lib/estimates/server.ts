import { createHash, randomUUID } from "node:crypto";
import {
  createClient,
  type PostgrestError,
  type SupabaseClient,
} from "@supabase/supabase-js";

import {
  normalizeMappedRowsForEstimateCreation,
  type ValidImportFlowLine,
} from "@/lib/affaires/import-flow";
import {
  computeEstimateLineValues,
  computeEstimateTotals,
  hasActiveLaborSplitPayload,
  computeInitialDiscountCents,
} from "@/lib/estimate-calculations";
import {
  DEFAULT_MAX_SECTION_DEPTH,
  clampMaxSectionDepth,
  buildHierarchyIndex,
  collectSubtreeMetrics,
  getDefaultSectionTitleForLevel,
  isAncestorOrSelf,
  resolveSectionLevel,
} from "@/lib/estimates/hierarchy";
import { isPriceStale } from "@/lib/catalogue/stale-prices";
import {
  getFeatureFlagValueForTenant,
  getStalePriceDaysForTenant,
} from "@/lib/feature-flags";
import {
  getTakeoffLinkedSourceVersionByJobId,
  linkTakeoffJobsFromSourceVersionToTargetVersion,
} from "@/lib/takeoff/version-links";
import type {
  EstimateSupplierPreselectionException,
  EstimateSupplierPreselectionExceptionReason,
  EstimateSupplierPreselectionPatch,
  EstimateSupplierPreselectionProposal,
  EstimateSupplierPreselectionReview,
  EstimateSupplierPreselectionSummary,
} from "@/lib/estimates/supplier-preselection";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database";

import {
  badRequest,
  conflict,
  forbidden,
  internalError,
  mapSupabaseError,
  notFound,
  unauthorized,
} from "./errors";
import { evaluateEstimateSendGating } from "./gating";
import { generateEstimatePdfNow } from "./pdf-generator";
import {
  DEFAULT_ESTIMATE_ITEM_AID_REGEX_PATTERN,
  ESTIMATE_ITEM_AID_REGEX_FEATURE_FLAG_KEY,
  normalizeEstimateItemAid,
  parseEstimateItemAidRegexPattern,
} from "./schemas";
import { enrichEstimateItemsWithGeneratedOuvrageProvenance } from "./generated-ouvrages";
import { enrichEstimateItemsWithAiStructureProvenance } from "./structure-drafts";
import {
  enrichEstimateItemsWithVersionZeroProvenance,
  fetchVersionZeroDraftSummary,
} from "./version-zero-drafts";
import {
  resolveEstimateLineTruth,
  type EstimateLineTruth,
} from "./line-truth";
import { assertCanWriteEstimateWorkflows } from "./write-access";
import type {
  BulkUpdateEstimateItemsInput,
  BulkUpdateEstimateVersionPatchInput,
  CreateEstimateItemInput,
  CreateEstimateAssemblyInput,
  CreateEstimateInput,
  CreateEstimateCategoryInput,
  CreateEstimateTemplateFromVersionInput,
  CreateLaborRoleInput,
  CreateMarginTierInput,
  DuplicateEstimateTemplateInput,
  InstantiateEstimateFromTemplateInput,
  ListEstimateAssembliesQueryInput,
  ListEstimateTemplatesQueryInput,
  CreateSuggestionRuleInput,
  DeleteEstimateItemInput,
  DuplicateEstimateSectionInput,
  ImportEstimateSectionsInput,
  ImportLinkedDpgfSourceInput,
  ListEstimateImportSourcesQueryInput,
  PatchEstimateStatusInput,
  PatchEstimateVersionInput,
  ReorderEstimateItemsInput,
  MoveEstimateItemInput,
  SuggestionRuleFeedbackInput,
  UpdateEstimateAssemblyInput,
  UpdateEstimateTemplateInput,
  UpdateLaborRoleInput,
  UpdateMarginTierInput,
  UpdateEstimateItemInput,
  UpdateSuggestionRuleInput,
} from "./schemas";

type Supabase = SupabaseClient<Database>;

type EstimateProjectRow = Database["public"]["Tables"]["estimate_projects"]["Row"];
type EstimateVersionRow = Database["public"]["Tables"]["estimate_versions"]["Row"];
type EstimateVersionInsert = Database["public"]["Tables"]["estimate_versions"]["Insert"];
type EstimateVersionUpdate = Database["public"]["Tables"]["estimate_versions"]["Update"];
type AuditLogInsert = Database["public"]["Tables"]["audit_logs"]["Insert"];
type DpgfImportRow = Database["public"]["Tables"]["dpgf_imports"]["Row"];
type DpgfMappingRow = Database["public"]["Tables"]["dpgf_mappings"]["Row"];
type EstimateCategoryInsert = Database["public"]["Tables"]["estimate_categories"]["Insert"];
type EstimateCategoryRow = Database["public"]["Tables"]["estimate_categories"]["Row"];
type SupplyTypeRow = Database["public"]["Tables"]["supply_types"]["Row"];
type EstimateItemRow = Database["public"]["Tables"]["estimate_items"]["Row"] & {
  h_mo_majoration?: number | null;
  h_mo_atelier?: number | null;
  k_mo_atelier?: number | null;
  labor_role_atelier_id?: string | null;
  h_mo_chantier?: number | null;
  k_mo_chantier?: number | null;
  labor_role_chantier_id?: string | null;
  supply_type_id?: string | null;
  selected_supplier_price_id?: string | null;
  source_provider?: string | null;
  source_job_id?: string | null;
  source_file_name?: string | null;
  source_page?: number | null;
};
type EstimateItemProvenanceFields = {
  source_level?: string | null;
  source_extracted_at?: string | null;
  source_version_number?: number | null;
  source_metadata?: Json | null;
};
type EstimateItemWithProvenanceRow = EstimateItemRow & EstimateItemProvenanceFields;
type EstimateItemWithTruthRow = EstimateItemWithProvenanceRow & {
  line_truth?: EstimateLineTruth | null;
};
type TakeoffJobProvenanceRow = {
  id: string;
  level: string | null;
  completed_at: string | null;
  created_at: string | null;
};
type EstimateItemInsert = Database["public"]["Tables"]["estimate_items"]["Insert"] & {
  h_mo_majoration?: number | null;
  h_mo_atelier?: number | null;
  k_mo_atelier?: number | null;
  labor_role_atelier_id?: string | null;
  h_mo_chantier?: number | null;
  k_mo_chantier?: number | null;
  labor_role_chantier_id?: string | null;
  supply_type_id?: string | null;
  selected_supplier_price_id?: string | null;
  source_provider?: string | null;
  source_job_id?: string | null;
  source_file_name?: string | null;
  source_page?: number | null;
};
type EstimateItemUpdate = Database["public"]["Tables"]["estimate_items"]["Update"] & {
  h_mo_majoration?: number | null;
  h_mo_atelier?: number | null;
  k_mo_atelier?: number | null;
  labor_role_atelier_id?: string | null;
  h_mo_chantier?: number | null;
  k_mo_chantier?: number | null;
  labor_role_chantier_id?: string | null;
  supply_type_id?: string | null;
  selected_supplier_price_id?: string | null;
  source_provider?: string | null;
  source_job_id?: string | null;
  source_file_name?: string | null;
  source_page?: number | null;
};
type LaborRoleInsert = Database["public"]["Tables"]["labor_roles"]["Insert"];
type LaborRoleUpdate = Database["public"]["Tables"]["labor_roles"]["Update"];
type LaborRoleRow = Database["public"]["Tables"]["labor_roles"]["Row"];
type MarginTierRow = Database["public"]["Tables"]["margin_tiers"]["Row"];
type MarginTierInsert = Database["public"]["Tables"]["margin_tiers"]["Insert"];
type MarginTierUpdate = Database["public"]["Tables"]["margin_tiers"]["Update"];
type SuggestionRuleInsert =
  Database["public"]["Tables"]["estimate_suggestion_rules"]["Insert"];
type SuggestionRuleUpdate =
  Database["public"]["Tables"]["estimate_suggestion_rules"]["Update"];
type SuggestionRuleRow =
  Database["public"]["Tables"]["estimate_suggestion_rules"]["Row"];
type EstimateStatus = Database["public"]["Enums"]["estimate_status"];
type EstimateVersionEventType =
  | "sent"
  | "accepted"
  | "archived"
  | "rejected"
  | "seal_verified";
type EstimateVersionStatusEventType = Extract<
  EstimateVersionEventType,
  "sent" | "accepted" | "archived"
>;
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type TenantRole = Database["public"]["Enums"]["tenant_role"];
type TenantMembershipRow = Pick<
  Database["public"]["Tables"]["tenant_memberships"]["Row"],
  "tenant_id" | "role" | "is_default" | "created_at"
>;
type EmbeddedProjectAccess = Pick<
  EstimateProjectRow,
  | "id"
  | "tenant_id"
  | "user_id"
  | "name"
  | "reference"
  | "estimate_reference"
  | "client_name"
  | "notes"
  | "is_archived"
>;

type VersionAccessRow = Pick<
  EstimateVersionRow,
  | "id"
  | "project_id"
  | "status"
  | "margin_mode"
  | "margin_multiplier"
  | "max_section_depth"
  | "tax_rate_bp"
  | "updated_at"
  | "total_ht_cents"
  | "total_tax_cents"
  | "total_ttc_cents"
> & {
  parent_version_id?: string | null;
  variant_label?: string | null;
  estimate_projects: EmbeddedProjectAccess | EmbeddedProjectAccess[] | null;
};

type EstimateListProject = Pick<
  EstimateProjectRow,
  "id" | "name" | "reference" | "client_name" | "is_archived"
>;

type EstimateListRow = Pick<
  EstimateVersionRow,
  | "id"
  | "project_id"
  | "version_number"
  | "status"
  | "title"
  | "updated_at"
  | "total_ht_cents"
  | "date_devis"
  | "currency"
  | "validite_jours"
> & {
  estimate_projects: EstimateListProject | EstimateListProject[] | null;
};

type EstimateProjectOwnerRow = Pick<
  EstimateProjectRow,
  "id" | "tenant_id" | "user_id"
>;

type CreateEstimateLatestVersionDefaultsRow = Pick<
  EstimateVersionRow,
  | "id"
  | "version_number"
  | "date_devis"
  | "validite_jours"
  | "margin_multiplier"
  | "margin_mode"
  | "currency"
  | "margin_bp"
  | "discount_bp"
  | "discount_mode"
  | "discount_steps"
  | "global_coefficient"
  | "tax_rate_bp"
  | "rounding_mode"
  | "rounding_step_cents"
  | "max_section_depth"
>;

type EstimateProjectVersionTimelineRow = Pick<
  EstimateVersionRow,
  | "id"
  | "project_id"
  | "version_number"
  | "status"
  | "title"
  | "updated_at"
  | "created_at"
  | "total_ttc_cents"
  | "total_ht_cents"
> & {
  parent_version_id?: string | null;
  variant_label?: string | null;
};

type EstimateVersionAuditActorRow = Pick<
  Database["public"]["Tables"]["audit_logs"]["Row"],
  "record_id" | "user_id" | "created_at"
>;

type ProfileNameRow = Pick<ProfileRow, "id" | "full_name">;

export type EstimateProjectVersionTimelineItem = {
  id: string;
  project_id: string;
  version_number: number;
  status: EstimateStatus;
  title: string | null;
  updated_at: string;
  created_at: string;
  total_ttc_cents: number;
  total_ht_cents: number;
  parent_version_id: string | null;
  variant_label: string | null;
  author_name: string | null;
};

type EstimateVariantComparisonRow = Pick<
  EstimateVersionRow,
  | "id"
  | "project_id"
  | "version_number"
  | "status"
  | "title"
  | "total_ht_cents"
  | "total_tax_cents"
  | "total_ttc_cents"
  | "updated_at"
> & {
  parent_version_id?: string | null;
  variant_label?: string | null;
};

export type EstimateVariantComparisonItem = {
  id: string;
  project_id: string;
  version_number: number;
  status: EstimateStatus;
  title: string | null;
  total_ht_cents: number;
  total_tax_cents: number;
  total_ttc_cents: number;
  line_count: number;
  updated_at: string;
  parent_version_id: string | null;
  variant_label: string | null;
};

export type ListEstimateVersionVariantsResult = {
  base_version_id: string;
  items: EstimateVariantComparisonItem[];
};

export type ListEstimateProjectVersionsResult = {
  items: EstimateProjectVersionTimelineItem[];
  pagination: {
    page: number;
    page_size: number;
    total_count: number;
    total_pages: number;
    has_prev: boolean;
    has_next: boolean;
  };
};

type EstimateProjectDraftVersionRow = Pick<
  EstimateVersionRow,
  "id" | "project_id" | "version_number" | "status" | "title" | "updated_at"
>;

export type EstimateProjectDraftVersionItem = {
  id: string;
  project_id: string;
  version_number: number;
  status: EstimateStatus;
  title: string | null;
  updated_at: string;
};

export type ListEstimateProjectDraftVersionsResult = {
  items: EstimateProjectDraftVersionItem[];
};

type EstimateImportSourceProject = Pick<
  EstimateProjectRow,
  "id" | "tenant_id" | "user_id" | "name" | "is_archived"
>;

type EstimateImportSourceVersionRow = Pick<
  EstimateVersionRow,
  | "id"
  | "project_id"
  | "version_number"
  | "status"
  | "title"
  | "updated_at"
  | "total_ht_cents"
> & {
  estimate_projects: EstimateImportSourceProject | EstimateImportSourceProject[] | null;
};

export type EstimateImportSourceVersionItem = {
  id: string;
  project_id: string;
  project_name: string;
  version_number: number;
  status: EstimateStatus;
  title: string | null;
  updated_at: string;
  total_ht_cents: number;
};

export type ListEstimateImportSourcesResult = {
  items: EstimateImportSourceVersionItem[];
};

export type EstimateImportSectionPreviewItem = {
  id: string;
  title: string;
  line_count: number;
  total_ht_cents: number;
  position: number;
};

export type ListEstimateImportSectionsResult = {
  source_version_id: string;
  items: EstimateImportSectionPreviewItem[];
};

export type ImportEstimateSectionsResult = {
  source_version_id: string;
  target_version_id: string;
  mode: ImportEstimateSectionsInput["mode"];
  imported_sections_count: number;
  imported_lines_count: number;
  created_section_ids: string[];
  created_line_ids: string[];
  totals: {
    total_ht_cents: number;
    total_tax_cents: number;
    total_ttc_cents: number;
  };
  version: {
    id: string;
    updated_at: string;
  };
};

type AffaireDpgfImportRow = Pick<
  DpgfImportRow,
  | "id"
  | "filename"
  | "source_format"
  | "status"
  | "created_at"
  | "parse_mode"
  | "row_count"
>;

type AffaireDpgfMappingRow = Pick<
  DpgfMappingRow,
  "id" | "status" | "updated_at" | "created_at"
>;

type DpgfMappedRowForEstimateImport = Pick<
  Database["public"]["Tables"]["dpgf_rows_mapped"]["Row"],
  "id" | "payload" | "created_at"
>;

export type AffaireLinkedDpgfSourceResult = {
  import_id: string;
  filename: string;
  source_format: string;
  import_status: string;
  mapping_status: string | null;
  imported_at: string;
  mapping_updated_at: string | null;
  parse_mode: string;
  row_count: number;
  mapped_row_count: number;
} | null;

export type ImportLinkedDpgfSourceResult = {
  source_import_id: string;
  target_version_id: string;
  created_section_id: string;
  created_line_ids: string[];
  imported_lines_count: number;
  skipped_lines_count: number;
  totals: {
    total_ht_cents: number;
    total_tax_cents: number;
    total_ttc_cents: number;
  };
  version: {
    id: string;
    updated_at: string;
  };
};

type EstimateVersionDetailsRow = EstimateVersionRow & {
  estimate_projects: EmbeddedProjectAccess | EmbeddedProjectAccess[] | null;
};
type EstimateVersionEventAuthor = Pick<ProfileRow, "full_name">;
type EstimateVersionEventRow = {
  id: string;
  estimate_version_id: string;
  event_type: string;
  metadata: Json;
  created_by: string | null;
  occurred_at: string;
  created_at: string;
  profiles: EstimateVersionEventAuthor | EstimateVersionEventAuthor[] | null;
};

export type EstimateVersionEvent = {
  id: string;
  estimate_version_id: string;
  event_type: string;
  metadata: Json;
  created_by: string | null;
  actor_name: string | null;
  occurred_at: string;
  created_at: string;
};

type EstimateTemplateRow = {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  source_version_id: string | null;
  created_by: string;
  margin_multiplier: number;
  margin_mode: EstimateVersionRow["margin_mode"];
  currency: string;
  margin_bp: number;
  discount_bp: number;
  discount_mode: Database["public"]["Enums"]["estimate_discount_mode"];
  discount_steps: number[];
  global_coefficient: number;
  tax_rate_bp: number;
  rounding_mode: EstimateVersionRow["rounding_mode"];
  rounding_step_cents: number;
  validite_jours: number;
  created_at: string;
  updated_at: string;
};

type EstimateTemplateItemRow = {
  id: string;
  tenant_id: string;
  template_id: string;
  parent_id: string | null;
  item_type: Database["public"]["Enums"]["estimate_item_type"];
  position: number;
  title: string;
  description: string | null;
  quantity: number | null;
  unit_price_ht_cents: number | null;
  tax_rate_bp: number | null;
  k_fo: number | null;
  h_mo: number | null;
  h_mo_majoration: number | null;
  k_mo: number | null;
  h_mo_atelier: number | null;
  k_mo_atelier: number | null;
  labor_role_atelier_id: string | null;
  h_mo_chantier: number | null;
  k_mo_chantier: number | null;
  labor_role_chantier_id: string | null;
  pu_ht_cents: number | null;
  labor_role_id: string | null;
  category_id: string | null;
  supply_type_id: string | null;
  line_total_ht_cents: number | null;
  line_tax_cents: number | null;
  line_total_ttc_cents: number | null;
};

type EstimateAssemblyRow =
  Database["public"]["Tables"]["estimate_assemblies"]["Row"];
type EstimateAssemblyInsert =
  Database["public"]["Tables"]["estimate_assemblies"]["Insert"];
type EstimateAssemblyUpdate =
  Database["public"]["Tables"]["estimate_assemblies"]["Update"];
type EstimateAssemblyItemRow =
  Database["public"]["Tables"]["estimate_assembly_items"]["Row"];
type EstimateAssemblyItemInsert =
  Database["public"]["Tables"]["estimate_assembly_items"]["Insert"];
type EstimateAssemblyMemberRow =
  Database["public"]["Tables"]["estimate_assembly_members"]["Row"];
type EstimateAssemblyMemberInsert =
  Database["public"]["Tables"]["estimate_assembly_members"]["Insert"];

const DEFAULT_VALIDITE_JOURS = 30;
const DEFAULT_MARGIN_MULTIPLIER = 1;
const DEFAULT_TAX_RATE_BP = 2000;
const MAX_SUPPLIER_COMPARISON_ITEMS = 200;
const DEFAULT_ROUNDING_MODE: EstimateVersionRow["rounding_mode"] = "none";
const DEFAULT_ROUNDING_STEP_CENTS = 1;
const DEFAULT_MARGIN_MODE: EstimateVersionRow["margin_mode"] = "fixed";
const DEFAULT_DISCOUNT_MODE: EstimateVersionRow["discount_mode"] = "simple";
const DEFAULT_GLOBAL_COEFFICIENT = 1;
const DEFAULT_CURRENCY = "EUR";
const SUPPORTED_ESTIMATE_CURRENCIES = ["EUR", "USD", "GBP"] as const;
const TENANT_ADMIN_ROLE: TenantRole = "admin";
const DEFAULT_VERSION_TIMELINE_PAGE_SIZE = 20;
const MAX_VERSION_TIMELINE_PAGE_SIZE = 100;
const STALE_BULK_UPDATE_ERROR_MESSAGE = "STALE_BULK_UPDATE_ITEMS";
const VERSION_CONFLICT_ERROR_MESSAGE = "Version modifiee par un autre utilisateur";
const ESTIMATE_SEAL_PAYLOAD_VERSION = 1;
const ESTIMATE_STATUS_TRANSITIONS: Readonly<
  Record<EstimateStatus, readonly EstimateStatus[]>
> = {
  draft: ["sent"],
  sent: ["accepted", "archived"],
  accepted: ["archived"],
  archived: [],
};
const ESTIMATE_VERSION_STATUS_EVENT_TYPES: Readonly<
  Record<EstimateStatus, EstimateVersionStatusEventType | null>
> = {
  draft: null,
  sent: "sent",
  accepted: "accepted",
  archived: "archived",
};

let serviceRoleSupabaseClient: Supabase | null = null;

type EstimateSealVersionFields = Pick<
  EstimateVersionRow,
  | "id"
  | "tenant_id"
  | "project_id"
  | "version_number"
  | "date_devis"
  | "total_ht_cents"
  | "total_tax_cents"
  | "total_ttc_cents"
  | "margin_multiplier"
  | "discount_bp"
  | "tax_rate_bp"
  | "rounding_mode"
  | "rounding_step_cents"
  | "seal_hash"
>;

type EstimateSealCanonicalItem = Pick<
  EstimateItemRow,
  | "id"
  | "position"
  | "item_type"
  | "title"
  | "quantity"
  | "unit_price_ht_cents"
  | "tax_rate_bp"
  | "k_fo"
  | "h_mo"
  | "h_mo_majoration"
  | "k_mo"
  | "h_mo_atelier"
  | "k_mo_atelier"
  | "labor_role_atelier_id"
  | "h_mo_chantier"
  | "k_mo_chantier"
  | "labor_role_chantier_id"
  | "supply_type_id"
  | "pu_ht_cents"
  | "line_total_ht_cents"
  | "line_tax_cents"
  | "line_total_ttc_cents"
>;

type EstimateSealPayload = {
  meta: {
    payload_version: number;
    version_id: string;
    tenant_id: string;
    project_id: string;
  };
  version: {
    version_number: number;
    date_devis: string;
    total_ht_cents: number;
    total_tax_cents: number;
    total_ttc_cents: number;
    margin_multiplier: number;
    discount_bp: number;
    tax_rate_bp: number;
    rounding_mode: EstimateVersionRow["rounding_mode"];
    rounding_step_cents: number;
  };
  items: EstimateSealCanonicalItem[];
};

type AuthenticatedContext = {
  supabase: Supabase;
  userId: string;
  tenantId: string;
  tenantRole: TenantRole;
};

type EstimateTotals = {
  total_ht_cents: number | null;
  total_tax_cents: number | null;
  total_ttc_cents: number | null;
};

type EstimateTotalsInvariantRule =
  | "total_ttc_gte_total_ht"
  | "total_tax_non_negative"
  | "total_ttc_equals_total_ht_plus_total_tax";

type EstimateTotalsInvariantViolation = {
  rule: EstimateTotalsInvariantRule;
  message: string;
};

type SupplierAlternativeKind = "best_price" | "most_recent" | "preferred_supplier";
export type SupplierComparisonAlternativeKind =
  | SupplierAlternativeKind
  | "selected_current";

type SuggestedSupplierAlternative = {
  kind: SupplierAlternativeKind;
  supplier_price_id: string;
  supplier_id: string;
  supplier_name: string;
  unit_price_cents: number;
  adjusted_unit_price_cents: number;
  currency: string | null;
  supplier_reference: string | null;
  unit: string | null;
  updated_at: string | null;
  is_stale: boolean;
  catalogue_url: string | null;
};

type SuggestedCataloguePrice = {
  supplier_price_id: string;
  product_id: string;
  product_designation: string;
  product_reference: string | null;
  product_category: string | null;
  product_type: string | null;
  product_material: string | null;
  product_grade: string | null;
  product_dimensions: string | null;
  product_standard: string | null;
  supplier_id: string;
  supplier_name: string;
  supplier_reference: string | null;
  unit: string | null;
  unit_price_cents: number;
  adjusted_unit_price_cents: number;
  currency: string | null;
  updated_at: string | null;
  is_stale: boolean;
  stale_days: number;
  relevance_score: number;
  has_material_index_adjustment: boolean;
  material_index_code: string | null;
  material_index_value: number | null;
  catalogue_url: string | null;
  supplier_offer_count: number;
  alternatives: SuggestedSupplierAlternative[];
};

type SupplierPricebookRow = {
  id: string;
  supplier_id: string;
  product_id: string;
  supplier_sku: string | null;
  unit: string;
  unit_price_cents: number;
  currency: string;
  updated_at: string;
  created_at: string;
  notes: string | null;
  is_active: boolean;
  product_url?: string | null;
  supplier_catalog_items?:
    | {
        supplier_sku: string | null;
        product_url: string | null;
      }
    | Array<{
        supplier_sku: string | null;
        product_url: string | null;
      }>
    | null;
};


function normalizeSupplierPricebookRow(row: SupplierPricebookRow): SupplierPricebookRow {
  const joinedItem = Array.isArray(row.supplier_catalog_items)
    ? row.supplier_catalog_items[0] ?? null
    : row.supplier_catalog_items ?? null;

  return {
    ...row,
    supplier_sku:
      joinedItem && Object.prototype.hasOwnProperty.call(joinedItem, "supplier_sku")
        ? joinedItem.supplier_sku
        : row.supplier_sku,
    product_url:
      joinedItem && Object.prototype.hasOwnProperty.call(joinedItem, "product_url")
        ? joinedItem.product_url
        : row.product_url ?? null,
  };
}
type HydratedSuggestedCatalogueCandidate = Omit<
  SuggestedCataloguePrice,
  "alternatives" | "supplier_offer_count"
>;

type CatalogueProductSuggestionRecord = {
  id: string;
  designation: string;
  reference: string | null;
  category: string | null;
  product_type: string | null;
  material: string | null;
  grade: string | null;
  dimensions: string | null;
  standard: string | null;
};

type EstimateSupplierComparisonSourceAlternative = {
  supplier_price_id: string;
  supplier_id: string;
  supplier_name: string;
  adjusted_unit_price_cents: number;
  supplier_reference: string | null;
  catalogue_url: string | null;
  updated_at: string | null;
  is_stale: boolean;
  product_designation: string;
};

export type EstimateSupplierComparisonAlternative = {
  kind: SupplierComparisonAlternativeKind;
  supplier_price_id: string;
  supplier_id: string;
  supplier_name: string;
  adjusted_unit_price_cents: number;
  supplier_reference: string | null;
  catalogue_url: string | null;
  updated_at: string | null;
  is_stale: boolean;
  product_designation: string;
  is_selected: boolean;
};

export type EstimateSupplierComparisonCoverageStatus =
  | "covered"
  | "ambiguous"
  | "no_price"
  | "stale";

export type EstimateSupplierComparisonRiskFlag =
  | "multiple_alternatives"
  | "selection_missing"
  | "selected_stale"
  | "selected_not_best_price";

type EstimateSupplierComparison = {
  item_id: string;
  selected_supplier_price_id: string | null;
  best_supplier_price_id: string | null;
  coverage_status: EstimateSupplierComparisonCoverageStatus;
  risk_flags: EstimateSupplierComparisonRiskFlag[];
  selected_alternative: EstimateSupplierComparisonAlternative | null;
  alternatives: EstimateSupplierComparisonAlternative[];
};

export type EstimateSupplierComparisonCoverageSummary = {
  total_items: number;
  covered_items: number;
  ambiguous_items: number;
  no_price_items: number;
  stale_items: number;
};

export type EstimateSupplierComparisonCandidate = {
  supplier_price_id: string;
  supplier_id: string;
  supplier_name: string;
  adjusted_unit_price_cents: number;
  supplier_reference: string | null;
  catalogue_url: string | null;
  updated_at: string | null;
  is_stale: boolean;
  product_designation: string;
  alternatives: SuggestedSupplierAlternative[];
};

const SUPPLIER_COMPARISON_ALTERNATIVE_KIND_ORDER: SupplierComparisonAlternativeKind[] = [
  "best_price",
  "most_recent",
  "selected_current",
  "preferred_supplier",
];

async function resolvePreferredSupplierIdForCandidates(input: {
  supabase: Supabase;
  tenantId: string;
  supplierPrices: SupplierPricebookRow[];
}) {
  const preferredSupplierValue = await getFeatureFlagValueForTenant(
    input.tenantId,
    "PREFERRED_SUPPLIER_ID",
    { supabase: input.supabase }
  );

  if (preferredSupplierValue && /^[0-9a-fA-F-]{36}$/.test(preferredSupplierValue)) {
    return preferredSupplierValue;
  }

  const supplierFrequency = new Map<string, number>();
  input.supplierPrices.forEach((row) => {
    supplierFrequency.set(
      row.supplier_id,
      (supplierFrequency.get(row.supplier_id) ?? 0) + 1
    );
  });

  return (
    [...supplierFrequency.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ??
    null
  );
}

async function hydrateSuggestedCatalogueCandidates(input: {
  supabase: Supabase;
  tenantId: string;
  supplierPrices: SupplierPricebookRow[];
  stalePriceDays: number;
  query: string;
  filterByRelevance: boolean;
}) {
  if (input.supplierPrices.length === 0) {
    return [] as HydratedSuggestedCatalogueCandidate[];
  }

  const productById = new Map<string, CatalogueProductSuggestionRecord>();
  const supplierById = new Map<string, { id: string; name: string }>();

  const productIds = Array.from(new Set(input.supplierPrices.map((row) => row.product_id)));
  if (productIds.length > 0) {
    const { data: productsData, error: productsError } = await input.supabase
      .from("products")
      .select("id, designation, reference, category, product_type, material, grade, dimensions, standard")
      .eq("tenant_id", input.tenantId)
      .in("id", productIds);

    if (productsError) {
      throw mapSupabaseError(
        productsError,
        "Impossible de charger les produits des suggestions."
      );
    }

    ((productsData ?? []) as unknown as CatalogueProductSuggestionRecord[]).forEach((product) => {
      productById.set(product.id, product);
    });
  }

  const supplierIds = Array.from(new Set(input.supplierPrices.map((row) => row.supplier_id)));
  if (supplierIds.length > 0) {
    const { data: suppliersData, error: suppliersError } = await input.supabase
      .from("suppliers")
      .select("id, name")
      .eq("tenant_id", input.tenantId)
      .in("id", supplierIds);

    if (suppliersError) {
      throw mapSupabaseError(
        suppliersError,
        "Impossible de charger les fournisseurs des suggestions."
      );
    }

    ((suppliersData ?? []) as Array<{ id: string; name: string }>).forEach((supplier) => {
      supplierById.set(supplier.id, supplier);
    });
  }

  const supplierPriceIds = input.supplierPrices.map((row) => row.id);
  const materialIndexBySupplierPriceId = new Map<
    string,
    {
      index_code: string;
      index_value: number;
      updated_at: string;
      index_date: string;
    }
  >();

  if (supplierPriceIds.length > 0) {
    const { data: linksData, error: linksError } = await input.supabase
      .from("dpgf_catalogue_links")
      .select("supplier_price_id, material_index_id")
      .eq("tenant_id", input.tenantId)
      .in("supplier_price_id", supplierPriceIds);

    if (linksError) {
      throw mapSupabaseError(
        linksError,
        "Impossible de charger les liaisons catalogue des suggestions."
      );
    }

    const links = (linksData ?? []) as Array<{
      supplier_price_id: string | null;
      material_index_id: string | null;
    }>;
    const materialIndexIds = Array.from(
      new Set(
        links
          .map((link) => link.material_index_id)
          .filter((value): value is string => typeof value === "string")
      )
    );

    if (materialIndexIds.length > 0) {
      const { data: indicesData, error: indicesError } = await input.supabase
        .from("material_indices")
        .select("id, index_code, index_value, updated_at, index_date")
        .eq("tenant_id", input.tenantId)
        .in("id", materialIndexIds);

      if (indicesError) {
        throw mapSupabaseError(
          indicesError,
          "Impossible de charger les indices materiaux des suggestions."
        );
      }

      const indexById = new Map(
        ((indicesData ?? []) as Array<{
          id: string;
          index_code: string;
          index_value: number;
          updated_at: string;
          index_date: string;
        }>).map((index) => [index.id, index])
      );

      links.forEach((link) => {
        if (!link.supplier_price_id || !link.material_index_id) return;
        const index = indexById.get(link.material_index_id);
        if (!index) return;
        materialIndexBySupplierPriceId.set(link.supplier_price_id, index);
      });
    }
  }

  const now = new Date();

  return input.supplierPrices
    .map((row) => {
      const product = productById.get(row.product_id);
      const supplier = supplierById.get(row.supplier_id);
      const materialIndex = materialIndexBySupplierPriceId.get(row.id);
      const hasMaterialIndexAdjustment =
        typeof materialIndex?.index_value === "number" && materialIndex.index_value > 0;
      const adjustedUnitPriceCents = hasMaterialIndexAdjustment
        ? Math.round((row.unit_price_cents * materialIndex.index_value) / 100)
        : row.unit_price_cents;
      const updatedAt = row.updated_at ?? row.created_at ?? null;
      const relevanceScore = computeSearchRelevance({
        query: input.query,
        designation: product?.designation ?? "",
        supplierName: supplier?.name ?? "",
        supplierSku: row.supplier_sku ?? null,
        productReference: product?.reference ?? null,
        category: product?.category ?? null,
        productType: product?.product_type ?? null,
        material: product?.material ?? null,
        grade: product?.grade ?? null,
        dimensions: product?.dimensions ?? null,
        standard: product?.standard ?? null,
      });

      return {
        supplier_price_id: row.id,
        product_id: row.product_id,
        product_designation: product?.designation ?? "Produit",
        product_reference: product?.reference ?? null,
        product_category: product?.category ?? null,
        product_type: product?.product_type ?? null,
        product_material: product?.material ?? null,
        product_grade: product?.grade ?? null,
        product_dimensions: product?.dimensions ?? null,
        product_standard: product?.standard ?? null,
        supplier_id: row.supplier_id,
        supplier_name: supplier?.name ?? "Fournisseur",
        supplier_reference: row.supplier_sku ?? null,
        unit: row.unit ?? null,
        unit_price_cents: row.unit_price_cents,
        adjusted_unit_price_cents: adjustedUnitPriceCents,
        currency: row.currency ?? null,
        updated_at: updatedAt,
        is_stale: isPriceStale(
          { updatedAt, createdAt: row.created_at ?? null },
          input.stalePriceDays,
          now
        ),
        stale_days: input.stalePriceDays,
        relevance_score: relevanceScore,
        has_material_index_adjustment: hasMaterialIndexAdjustment,
        material_index_code: materialIndex?.index_code ?? null,
        material_index_value: materialIndex?.index_value ?? null,
        catalogue_url: row.product_url ?? extractCatalogueUrl(row.notes),
      } satisfies HydratedSuggestedCatalogueCandidate;
    })
    .filter((candidate) =>
      input.filterByRelevance ? candidate.relevance_score > 0 : true
    )
    .sort((left, right) => {
      if (right.relevance_score !== left.relevance_score) {
        return right.relevance_score - left.relevance_score;
      }
      return toTimestamp(right.updated_at) - toTimestamp(left.updated_at);
    });
}

function buildSuggestedCatalogueAlternatives(input: {
  productCandidates: HydratedSuggestedCatalogueCandidate[];
  preferredSupplierId: string | null;
}) {
  const alternatives: SuggestedSupplierAlternative[] = [];
  const pushAlternative = (
    kind: SupplierAlternativeKind,
    selected: HydratedSuggestedCatalogueCandidate | null
  ) => {
    if (!selected) return;
    if (alternatives.some((existing) => existing.supplier_price_id === selected.supplier_price_id)) {
      return;
    }
    alternatives.push({
      kind,
      supplier_price_id: selected.supplier_price_id,
      supplier_id: selected.supplier_id,
      supplier_name: selected.supplier_name,
      unit_price_cents: selected.unit_price_cents,
      adjusted_unit_price_cents: selected.adjusted_unit_price_cents,
      currency: selected.currency,
      supplier_reference: selected.supplier_reference,
      unit: selected.unit,
      updated_at: selected.updated_at,
      is_stale: selected.is_stale,
      catalogue_url: selected.catalogue_url,
    });
  };

  const bestPrice = [...input.productCandidates].sort((left, right) => {
    if (left.adjusted_unit_price_cents !== right.adjusted_unit_price_cents) {
      return left.adjusted_unit_price_cents - right.adjusted_unit_price_cents;
    }
    return toTimestamp(right.updated_at) - toTimestamp(left.updated_at);
  })[0] ?? null;
  const mostRecent = getMostRecentRecord(input.productCandidates);
  const preferredSupplier = input.preferredSupplierId
    ? getMostRecentRecord(
        input.productCandidates.filter(
          (entry) => entry.supplier_id === input.preferredSupplierId
        )
      )
    : null;

  pushAlternative("best_price", bestPrice);
  pushAlternative("most_recent", mostRecent);
  pushAlternative("preferred_supplier", preferredSupplier);

  return alternatives;
}

async function findSelectedSupplierComparisonCandidate(input: {
  supabase: Supabase;
  tenantId: string;
  selectedSupplierPriceId: string;
  stalePriceDays: number;
}) {
  const { data: selectedPriceData, error: selectedPriceError } = await input.supabase
    .from("supplier_pricebook")
    .select(
      "id, supplier_id, product_id, supplier_sku, unit, unit_price_cents, currency, updated_at, created_at, notes, is_active, supplier_catalog_items!supplier_pricebook_supplier_catalog_item_id_fkey(supplier_sku, product_url)"
    )
    .eq("tenant_id", input.tenantId)
    .eq("id", input.selectedSupplierPriceId)
    .maybeSingle();

  if (selectedPriceError) {
    throw mapSupabaseError(
      selectedPriceError,
      "Impossible de charger la selection fournisseur actuelle."
    );
  }

  const selectedPrice = selectedPriceData
    ? normalizeSupplierPricebookRow(selectedPriceData as unknown as SupplierPricebookRow)
    : null;
  if (!selectedPrice) {
    return null;
  }

  const { data: productPriceData, error: productPriceError } = await input.supabase
    .from("supplier_pricebook")
    .select(
      "id, supplier_id, product_id, supplier_sku, unit, unit_price_cents, currency, updated_at, created_at, notes, is_active, supplier_catalog_items!supplier_pricebook_supplier_catalog_item_id_fkey(supplier_sku, product_url)"
    )
    .eq("tenant_id", input.tenantId)
    .eq("product_id", selectedPrice.product_id)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(400);

  if (productPriceError) {
    throw mapSupabaseError(
      productPriceError,
      "Impossible de charger les alternatives de la selection fournisseur."
    );
  }

  const selectedAndPeerRows = Array.from(
    new Map(
      [
        selectedPrice,
        ...((productPriceData ?? []) as unknown as SupplierPricebookRow[]).map(
          normalizeSupplierPricebookRow
        ),
      ].map(
        (row) => [row.id, row] as const
      )
    ).values()
  );
  const selectedAndPeerRowsById = new Map(
    selectedAndPeerRows.map((row) => [row.id, row] as const)
  );
  const preferredSupplierId = await resolvePreferredSupplierIdForCandidates({
    supabase: input.supabase,
    tenantId: input.tenantId,
    supplierPrices: selectedAndPeerRows.filter((row) => row.is_active),
  });
  const candidates = await hydrateSuggestedCatalogueCandidates({
    supabase: input.supabase,
    tenantId: input.tenantId,
    supplierPrices: selectedAndPeerRows,
    stalePriceDays: input.stalePriceDays,
    query: "",
    filterByRelevance: false,
  });
  const selectedCandidate =
    candidates.find(
      (candidate) => candidate.supplier_price_id === input.selectedSupplierPriceId
    ) ?? null;

  if (!selectedCandidate) {
    return null;
  }

  const productCandidates = candidates.filter((candidate) => {
    const row = selectedAndPeerRowsById.get(candidate.supplier_price_id);
    return candidate.product_id === selectedCandidate.product_id && row?.is_active === true;
  });

  return {
    ...selectedCandidate,
    supplier_offer_count: productCandidates.length,
    alternatives: buildSuggestedCatalogueAlternatives({
      productCandidates,
      preferredSupplierId,
    }),
  } satisfies SuggestedCataloguePrice;
}

function toEstimateSupplierComparisonSourceAlternative(input: {
  supplier_price_id: string;
  supplier_id: string;
  supplier_name: string;
  adjusted_unit_price_cents: number;
  supplier_reference: string | null;
  catalogue_url: string | null;
  updated_at: string | null;
  is_stale: boolean;
  product_designation: string;
}): EstimateSupplierComparisonSourceAlternative {
  return {
    supplier_price_id: input.supplier_price_id,
    supplier_id: input.supplier_id,
    supplier_name: input.supplier_name,
    adjusted_unit_price_cents: input.adjusted_unit_price_cents,
    supplier_reference: input.supplier_reference,
    catalogue_url: input.catalogue_url,
    updated_at: input.updated_at,
    is_stale: input.is_stale,
    product_designation: input.product_designation,
  };
}

function toEstimateSupplierComparisonAlternative(input: {
  kind: SupplierComparisonAlternativeKind;
  alternative: EstimateSupplierComparisonSourceAlternative;
  selectedSupplierPriceId: string | null;
}): EstimateSupplierComparisonAlternative {
  return {
    kind: input.kind,
    supplier_price_id: input.alternative.supplier_price_id,
    supplier_id: input.alternative.supplier_id,
    supplier_name: input.alternative.supplier_name,
    adjusted_unit_price_cents: input.alternative.adjusted_unit_price_cents,
    supplier_reference: input.alternative.supplier_reference,
    catalogue_url: input.alternative.catalogue_url,
    updated_at: input.alternative.updated_at,
    is_stale: input.alternative.is_stale,
    product_designation: input.alternative.product_designation,
    is_selected:
      input.selectedSupplierPriceId !== null &&
      input.alternative.supplier_price_id === input.selectedSupplierPriceId,
  };
}

function findSuggestedAlternativeByKind(
  alternatives: SuggestedSupplierAlternative[],
  kind: SupplierAlternativeKind
) {
  return alternatives.find((alternative) => alternative.kind === kind) ?? null;
}

export function buildEstimateSupplierComparisonAlternatives(input: {
  candidate: EstimateSupplierComparisonCandidate;
  selectedSupplierPriceId: string | null;
}): EstimateSupplierComparisonAlternative[] {
  const alternativesByKind = new Map<
    SupplierComparisonAlternativeKind,
    EstimateSupplierComparisonAlternative
  >();

  const registerAlternative = (
    kind: SupplierComparisonAlternativeKind,
    alternative: EstimateSupplierComparisonSourceAlternative | null
  ) => {
    if (!alternative) {
      return;
    }

    const existingEntry = Array.from(alternativesByKind.values()).find(
      (entry) => entry.supplier_price_id === alternative.supplier_price_id
    );
    if (existingEntry) {
      if (
        input.selectedSupplierPriceId !== null &&
        existingEntry.supplier_price_id === input.selectedSupplierPriceId
      ) {
        existingEntry.is_selected = true;
      }
      return;
    }

    const normalized = toEstimateSupplierComparisonAlternative({
      kind,
      alternative,
      selectedSupplierPriceId: input.selectedSupplierPriceId,
    });

    alternativesByKind.set(kind, normalized);
  };

  const bestPrice = findSuggestedAlternativeByKind(input.candidate.alternatives, "best_price");
  const mostRecent = findSuggestedAlternativeByKind(input.candidate.alternatives, "most_recent");
  const preferredSupplier = findSuggestedAlternativeByKind(
    input.candidate.alternatives,
    "preferred_supplier"
  );

  registerAlternative(
    "best_price",
    bestPrice
      ? toEstimateSupplierComparisonSourceAlternative({
          supplier_price_id: bestPrice.supplier_price_id,
          supplier_id: bestPrice.supplier_id,
          supplier_name: bestPrice.supplier_name,
          adjusted_unit_price_cents: bestPrice.adjusted_unit_price_cents,
          supplier_reference: bestPrice.supplier_reference,
          catalogue_url: bestPrice.catalogue_url,
          updated_at: bestPrice.updated_at,
          is_stale: bestPrice.is_stale,
          product_designation: input.candidate.product_designation,
        })
      : null
  );
  registerAlternative(
    "most_recent",
    mostRecent
      ? toEstimateSupplierComparisonSourceAlternative({
          supplier_price_id: mostRecent.supplier_price_id,
          supplier_id: mostRecent.supplier_id,
          supplier_name: mostRecent.supplier_name,
          adjusted_unit_price_cents: mostRecent.adjusted_unit_price_cents,
          supplier_reference: mostRecent.supplier_reference,
          catalogue_url: mostRecent.catalogue_url,
          updated_at: mostRecent.updated_at,
          is_stale: mostRecent.is_stale,
          product_designation: input.candidate.product_designation,
        })
      : null
  );
  registerAlternative(
    "preferred_supplier",
    preferredSupplier
      ? toEstimateSupplierComparisonSourceAlternative({
          supplier_price_id: preferredSupplier.supplier_price_id,
          supplier_id: preferredSupplier.supplier_id,
          supplier_name: preferredSupplier.supplier_name,
          adjusted_unit_price_cents: preferredSupplier.adjusted_unit_price_cents,
          supplier_reference: preferredSupplier.supplier_reference,
          catalogue_url: preferredSupplier.catalogue_url,
          updated_at: preferredSupplier.updated_at,
          is_stale: preferredSupplier.is_stale,
          product_designation: input.candidate.product_designation,
        })
      : null
  );

  const selectedAlternative =
    input.selectedSupplierPriceId === null
      ? null
      : input.candidate.supplier_price_id === input.selectedSupplierPriceId
        ? toEstimateSupplierComparisonSourceAlternative({
            supplier_price_id: input.candidate.supplier_price_id,
            supplier_id: input.candidate.supplier_id,
            supplier_name: input.candidate.supplier_name,
            adjusted_unit_price_cents: input.candidate.adjusted_unit_price_cents,
            supplier_reference: input.candidate.supplier_reference,
            catalogue_url: input.candidate.catalogue_url,
            updated_at: input.candidate.updated_at,
            is_stale: input.candidate.is_stale,
            product_designation: input.candidate.product_designation,
          })
        : (() => {
            const selected = input.candidate.alternatives.find(
              (alternative) =>
                alternative.supplier_price_id === input.selectedSupplierPriceId
            );
            if (!selected) {
              return null;
            }

            return toEstimateSupplierComparisonSourceAlternative({
              supplier_price_id: selected.supplier_price_id,
              supplier_id: selected.supplier_id,
              supplier_name: selected.supplier_name,
              adjusted_unit_price_cents: selected.adjusted_unit_price_cents,
              supplier_reference: selected.supplier_reference,
              catalogue_url: selected.catalogue_url,
              updated_at: selected.updated_at,
              is_stale: selected.is_stale,
              product_designation: input.candidate.product_designation,
            });
          })();

  registerAlternative("selected_current", selectedAlternative);

  return SUPPLIER_COMPARISON_ALTERNATIVE_KIND_ORDER.map((kind) =>
    alternativesByKind.get(kind)
  ).filter((alternative): alternative is EstimateSupplierComparisonAlternative =>
    Boolean(alternative)
  );
}

function findSelectedSupplierComparisonAlternative(
  alternatives: EstimateSupplierComparisonAlternative[],
  selectedSupplierPriceId: string | null
) {
  if (!selectedSupplierPriceId) {
    return null;
  }

  return (
    alternatives.find(
      (alternative) => alternative.supplier_price_id === selectedSupplierPriceId
    ) ?? null
  );
}

function computeEstimateSupplierComparisonRiskFlags(input: {
  alternatives: EstimateSupplierComparisonAlternative[];
  selectedSupplierPriceId: string | null;
  bestSupplierPriceId: string | null;
  selectedAlternative: EstimateSupplierComparisonAlternative | null;
}) {
  const riskFlags: EstimateSupplierComparisonRiskFlag[] = [];

  if (input.alternatives.length > 1) {
    riskFlags.push("multiple_alternatives");
  }

  if (input.alternatives.length > 0 && input.selectedSupplierPriceId === null) {
    riskFlags.push("selection_missing");
  }

  if (input.selectedAlternative?.is_stale === true) {
    riskFlags.push("selected_stale");
  }

  if (
    input.selectedSupplierPriceId !== null &&
    input.bestSupplierPriceId !== null &&
    input.selectedSupplierPriceId !== input.bestSupplierPriceId
  ) {
    riskFlags.push("selected_not_best_price");
  }

  return riskFlags;
}

function computeEstimateSupplierComparisonCoverageStatus(input: {
  alternatives: EstimateSupplierComparisonAlternative[];
  selectedAlternative: EstimateSupplierComparisonAlternative | null;
  riskFlags: EstimateSupplierComparisonRiskFlag[];
}) {
  if (input.alternatives.length === 0) {
    return "no_price" satisfies EstimateSupplierComparisonCoverageStatus;
  }

  if (input.selectedAlternative?.is_stale === true) {
    return "stale" satisfies EstimateSupplierComparisonCoverageStatus;
  }

  if (input.riskFlags.includes("selection_missing")) {
    return "ambiguous" satisfies EstimateSupplierComparisonCoverageStatus;
  }

  return "covered" satisfies EstimateSupplierComparisonCoverageStatus;
}

function summarizeEstimateSupplierComparisonCoverage(
  comparisons: EstimateSupplierComparison[]
): EstimateSupplierComparisonCoverageSummary {
  const summary: EstimateSupplierComparisonCoverageSummary = {
    total_items: comparisons.length,
    covered_items: 0,
    ambiguous_items: 0,
    no_price_items: 0,
    stale_items: 0,
  };

  comparisons.forEach((comparison) => {
    if (comparison.coverage_status === "covered") {
      summary.covered_items += 1;
      return;
    }
    if (comparison.coverage_status === "ambiguous") {
      summary.ambiguous_items += 1;
      return;
    }
    if (comparison.coverage_status === "stale") {
      summary.stale_items += 1;
      return;
    }

    summary.no_price_items += 1;
  });

  return summary;
}

function createEmptyEstimateSupplierPreselectionSummary(): EstimateSupplierPreselectionSummary {
  return {
    total_items: 0,
    proposed_items: 0,
    exception_items: 0,
    already_selected_items: 0,
    divergence_items: 0,
    stale_items: 0,
    ambiguous_items: 0,
    no_price_items: 0,
  };
}

function findEstimateSupplierPreselectionProposalAlternative(
  comparison: EstimateSupplierComparison
) {
  if (comparison.selected_supplier_price_id !== null) {
    return null;
  }

  if (comparison.alternatives.length !== 1) {
    return null;
  }

  const [proposedAlternative] = comparison.alternatives;
  if (!proposedAlternative || proposedAlternative.is_stale) {
    return null;
  }

  return proposedAlternative;
}

function resolveEstimateSupplierPreselectionExceptionReason(
  comparison: EstimateSupplierComparison
): EstimateSupplierPreselectionExceptionReason | null {
  if (comparison.alternatives.length === 0) {
    return "no_price";
  }

  if (comparison.selected_alternative?.is_stale === true) {
    return "stale";
  }

  if (comparison.risk_flags.includes("selected_not_best_price")) {
    return "divergence";
  }

  if (comparison.coverage_status === "ambiguous") {
    return "ambiguous";
  }

  return null;
}

export function buildEstimateSupplierPreselectionReview(input: {
  comparisons: EstimateSupplierComparison[];
  itemTitleById: Map<string, string>;
}): EstimateSupplierPreselectionReview {
  const summary = createEmptyEstimateSupplierPreselectionSummary();
  const proposals: EstimateSupplierPreselectionProposal[] = [];
  const exceptions: EstimateSupplierPreselectionException[] = [];

  input.comparisons.forEach((comparison) => {
    summary.total_items += 1;

    const itemTitle = input.itemTitleById.get(comparison.item_id) ?? "Ligne";
    const proposedAlternative =
      findEstimateSupplierPreselectionProposalAlternative(comparison);

    if (proposedAlternative) {
      const patch: EstimateSupplierPreselectionPatch = {
        unit_price_ht_cents: proposedAlternative.adjusted_unit_price_cents,
        selected_supplier_price_id: proposedAlternative.supplier_price_id,
      };

      proposals.push({
        item_id: comparison.item_id,
        item_title: itemTitle,
        current_alternative: comparison.selected_alternative,
        proposed_alternative: proposedAlternative,
        patch,
        reason: "single_clear_option",
        explanation:
          "Une seule option fournisseur non obsolete couvre cette ligne. La preselection reste modifiable avant confirmation.",
        is_reversible: true,
      });
      summary.proposed_items += 1;
      return;
    }

    const exceptionReason =
      resolveEstimateSupplierPreselectionExceptionReason(comparison);

    if (exceptionReason) {
      exceptions.push({
        item_id: comparison.item_id,
        item_title: itemTitle,
        reason: exceptionReason,
        coverage_status: comparison.coverage_status,
        risk_flags: comparison.risk_flags,
        selected_alternative: comparison.selected_alternative,
        alternatives: comparison.alternatives,
      });
      summary.exception_items += 1;

      if (exceptionReason === "divergence") {
        summary.divergence_items += 1;
      } else if (exceptionReason === "stale") {
        summary.stale_items += 1;
      } else if (exceptionReason === "ambiguous") {
        summary.ambiguous_items += 1;
      } else if (exceptionReason === "no_price") {
        summary.no_price_items += 1;
      }
      return;
    }

    summary.already_selected_items += 1;
  });

  return {
    summary,
    proposals,
    exceptions,
  };
}

const DEFAULT_ESTIMATE_CATEGORIES = [
  { name: "Materiaux", position: 1 },
  { name: "Main d'oeuvre", position: 2 },
  { name: "Sous-traitance", position: 3 },
] as const;

const DEFAULT_LABOR_ROLES = [
  { name: "Maçon", hourly_rate_cents: 0, position: 1 },
  { name: "Électricien", hourly_rate_cents: 0, position: 2 },
  { name: "Plombier", hourly_rate_cents: 0, position: 3 },
  { name: "Chauffagiste", hourly_rate_cents: 0, position: 4 },
  { name: "Menuisier", hourly_rate_cents: 0, position: 5 },
  { name: "Plaquiste", hourly_rate_cents: 0, position: 6 },
  { name: "Carreleur", hourly_rate_cents: 0, position: 7 },
  { name: "Peintre", hourly_rate_cents: 0, position: 8 },
  { name: "Couvreur", hourly_rate_cents: 0, position: 9 },
] as const;

function parseBulkUpdateCountDetails(details: string | null | undefined) {
  const match = details?.match(
    /expected_count=(\d+),(updated_count|locked_count)=(\d+)/
  );
  if (!match) return null;

  const expectedCount = Number.parseInt(match[1], 10);
  const countValue = Number.parseInt(match[3], 10);

  if (!Number.isFinite(expectedCount) || !Number.isFinite(countValue)) {
    return null;
  }

  return {
    expected_count: expectedCount,
    updated_count: countValue,
  };
}

async function resolveEstimateItemAidRegex(input: {
  tenantId: string;
  supabase: Supabase;
}) {
  const configuredPattern = await getFeatureFlagValueForTenant(
    input.tenantId,
    ESTIMATE_ITEM_AID_REGEX_FEATURE_FLAG_KEY,
    { supabase: input.supabase }
  );

  return parseEstimateItemAidRegexPattern(configuredPattern);
}

function assertEstimateItemAidFormat(input: {
  aid: string | null;
  aidRegex: RegExp;
}) {
  if (!input.aid) return;
  const regex = new RegExp(input.aidRegex.source, input.aidRegex.flags);
  if (regex.test(input.aid)) return;

  throw badRequest(
    `AID invalide. Format attendu: ${DEFAULT_ESTIMATE_ITEM_AID_REGEX_PATTERN}.`
  );
}

function normalizeEstimateCurrencyOrThrow(
  value: string | null | undefined,
  options?: {
    fallback?: string;
    fallbackOnInvalid?: boolean;
  }
) {
  const normalized = value?.trim().toUpperCase() ?? "";

  if (!normalized) {
    if (options?.fallback) return options.fallback;
    throw badRequest("Devise invalide. Valeurs autorisees: EUR, USD, GBP.");
  }

  if (
    (SUPPORTED_ESTIMATE_CURRENCIES as readonly string[]).includes(normalized)
  ) {
    return normalized;
  }

  if (options?.fallback && options.fallbackOnInvalid === true) {
    return options.fallback;
  }

  throw badRequest("Devise invalide. Valeurs autorisees: EUR, USD, GBP.");
}

function normalizeConcurrencyToken(token: string | null | undefined) {
  const trimmed = token?.trim();
  if (!trimmed) return null;

  const [firstToken] = trimmed.split(",");
  const candidate = firstToken?.trim() ?? "";
  if (!candidate) return null;

  const weakMatch = candidate.match(/^W\/"(.*)"$/i);
  if (weakMatch?.[1]) {
    const weakValue = weakMatch[1].trim();
    return weakValue.length > 0 ? weakValue : null;
  }

  if (candidate.startsWith("\"") && candidate.endsWith("\"")) {
    const value = candidate.slice(1, -1).trim();
    return value.length > 0 ? value : null;
  }

  return candidate;
}

function assertVersionConcurrencyToken(
  versionUpdatedAt: string,
  concurrencyToken: string | undefined
) {
  const normalizedToken = normalizeConcurrencyToken(concurrencyToken);

  if (!normalizedToken) {
    throw badRequest("Jeton de concurrence manquant.");
  }

  const tokenTimestamp = new Date(normalizedToken).getTime();
  const versionTimestamp = new Date(versionUpdatedAt).getTime();

  if (!Number.isFinite(tokenTimestamp)) {
    throw badRequest("Jeton de concurrence invalide.");
  }

  if (!Number.isFinite(versionTimestamp) || tokenTimestamp !== versionTimestamp) {
    throw conflict(VERSION_CONFLICT_ERROR_MESSAGE, {
      updated_at: versionUpdatedAt,
    }, "VERSION_CONFLICT");
  }
}

function assertEstimateStatusTransition(
  currentStatus: EstimateStatus,
  nextStatus: EstimateStatus
) {
  const allowedTransitions = ESTIMATE_STATUS_TRANSITIONS[currentStatus] ?? [];

  if (allowedTransitions.includes(nextStatus)) return;

  throw badRequest(
    `Transition de statut invalide: ${currentStatus} -> ${nextStatus}.`
  );
}

function buildCanonicalEstimateSealPayload(input: {
  version: EstimateSealVersionFields;
  items: EstimateItemRow[];
}): EstimateSealPayload {
  const canonicalItems = [...input.items]
    .sort((left, right) => {
      if (left.position !== right.position) {
        return left.position - right.position;
      }

      return left.id.localeCompare(right.id);
    })
    .map(
      (item): EstimateSealCanonicalItem => ({
        id: item.id,
        position: item.position,
        item_type: item.item_type,
        title: item.title,
        quantity: item.quantity,
        unit_price_ht_cents: item.unit_price_ht_cents,
        tax_rate_bp: item.tax_rate_bp,
        k_fo: item.k_fo,
        h_mo: item.h_mo,
        h_mo_majoration: item.h_mo_majoration,
        k_mo: item.k_mo,
        h_mo_atelier: item.h_mo_atelier,
        k_mo_atelier: item.k_mo_atelier,
        labor_role_atelier_id: item.labor_role_atelier_id,
        h_mo_chantier: item.h_mo_chantier,
        k_mo_chantier: item.k_mo_chantier,
        labor_role_chantier_id: item.labor_role_chantier_id,
        supply_type_id: item.supply_type_id,
        pu_ht_cents: item.pu_ht_cents,
        line_total_ht_cents: item.line_total_ht_cents,
        line_tax_cents: item.line_tax_cents,
        line_total_ttc_cents: item.line_total_ttc_cents,
      })
    );

  return {
    meta: {
      payload_version: ESTIMATE_SEAL_PAYLOAD_VERSION,
      version_id: input.version.id,
      tenant_id: input.version.tenant_id,
      project_id: input.version.project_id,
    },
    version: {
      version_number: input.version.version_number,
      date_devis: input.version.date_devis,
      total_ht_cents: input.version.total_ht_cents,
      total_tax_cents: input.version.total_tax_cents,
      total_ttc_cents: input.version.total_ttc_cents,
      margin_multiplier: input.version.margin_multiplier,
      discount_bp: input.version.discount_bp,
      tax_rate_bp: input.version.tax_rate_bp,
      rounding_mode: input.version.rounding_mode,
      rounding_step_cents: input.version.rounding_step_cents,
    },
    items: canonicalItems,
  };
}

function computeEstimateSealHash(payload: EstimateSealPayload) {
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .toLowerCase();
}

async function loadEstimateSealSource(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
}): Promise<{ version: EstimateSealVersionFields; items: EstimateItemRow[] }> {
  const { data: versionData, error: versionError } = await input.supabase
    .from("estimate_versions")
    .select(
      "id, tenant_id, project_id, version_number, date_devis, total_ht_cents, total_tax_cents, total_ttc_cents, margin_multiplier, discount_bp, tax_rate_bp, rounding_mode, rounding_step_cents, seal_hash"
    )
    .eq("tenant_id", input.tenantId)
    .eq("id", input.versionId)
    .single();

  if (versionError || !versionData) {
    if (versionError) {
      throw mapSupabaseError(versionError, "Impossible de charger la version.");
    }

    throw notFound("Version de chiffrage introuvable.");
  }

  const { data: itemsData, error: itemsError } = await input.supabase
    .from("estimate_items")
    .select(
      "id, position, item_type, title, quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo, supply_type_id, pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents"
    )
    .eq("tenant_id", input.tenantId)
    .eq("version_id", input.versionId)
    .order("position", { ascending: true })
    .order("id", { ascending: true });

  if (itemsError) {
    throw mapSupabaseError(itemsError, "Impossible de charger les lignes.");
  }

  return {
    version: versionData as EstimateSealVersionFields,
    items: (itemsData ?? []) as EstimateItemRow[],
  };
}

function getServiceRoleSupabaseClient() {
  if (serviceRoleSupabaseClient) {
    return serviceRoleSupabaseClient;
  }

  let supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  let serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Allow mocked service-role logging in test runs even without env vars.
  if ((!supabaseUrl || !serviceRoleKey) && process.env.NODE_ENV === "test") {
    supabaseUrl = supabaseUrl ?? "http://localhost:54321";
    serviceRoleKey = serviceRoleKey ?? "test-service-role";
  }

  if (!supabaseUrl || !serviceRoleKey) {
    throw internalError(
      "Configuration Supabase service role manquante pour executer le workflow protege."
    );
  }

  serviceRoleSupabaseClient = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return serviceRoleSupabaseClient;
}

function resolveStatusEventType(
  status: EstimateStatus
): EstimateVersionStatusEventType | null {
  return ESTIMATE_VERSION_STATUS_EVENT_TYPES[status] ?? null;
}

function normalizeEstimateVersionEvent(
  row: EstimateVersionEventRow
): EstimateVersionEvent {
  const profile = resolveEmbeddedOne(row.profiles);
  const actorName = toNullableText(profile?.full_name) ?? null;
  const occurredAt = toNullableText(row.occurred_at) ?? row.created_at;

  return {
    id: row.id,
    estimate_version_id: row.estimate_version_id,
    event_type: row.event_type,
    metadata: row.metadata,
    created_by: row.created_by,
    actor_name: actorName,
    occurred_at: occurredAt,
    created_at: row.created_at,
  };
}

async function logEstimateVersionEvent(input: {
  versionId: string;
  eventType: EstimateVersionEventType;
  actorUserId: string | null;
  metadata?: Json;
  occurredAt?: string;
}) {
  const rpcClient = getServiceRoleSupabaseClient();

  const { error } = await rpcClient.rpc("log_estimate_version_event", {
    p_estimate_version_id: input.versionId,
    p_event_type: input.eventType,
    p_created_by: input.actorUserId,
    p_metadata: input.metadata ?? {},
    p_occurred_at: input.occurredAt ?? new Date().toISOString(),
  });

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible d'enregistrer l'evenement de statut."
    );
  }
}

async function transitionEstimateVersionStatusAtomically(input: {
  versionId: string;
  tenantId: string;
  expectedUpdatedAt: string;
  nextStatus: EstimateStatus;
  sealHash: string | null;
  actorUserId: string;
  eventMetadata?: Json;
  occurredAt: string;
}) {
  const rpcClient = getServiceRoleSupabaseClient();
  const { data, error } = await rpcClient.rpc(
    "transition_estimate_version_status" as never,
    {
      p_version_id: input.versionId,
      p_tenant_id: input.tenantId,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_next_status: input.nextStatus,
      p_seal_hash: input.sealHash,
      p_actor_user_id: input.actorUserId,
      p_event_metadata: input.eventMetadata ?? {},
      p_occurred_at: input.occurredAt,
    } as never
  );

  if (error) {
    if (
      error.code === "40001" ||
      error.message.includes("ESTIMATE_VERSION_CONFLICT")
    ) {
      throw conflict(VERSION_CONFLICT_ERROR_MESSAGE, {
        updated_at: input.expectedUpdatedAt,
      }, "VERSION_CONFLICT");
    }

    throw mapSupabaseError(error, "Impossible de changer le statut.");
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw conflict(VERSION_CONFLICT_ERROR_MESSAGE, {
      updated_at: input.expectedUpdatedAt,
    }, "VERSION_CONFLICT");
  }

  return row as unknown as EstimateVersionRow;
}

function extractPatchedEstimateTotals(input: PatchEstimateVersionInput) {
  const patchedTotals: Partial<EstimateTotals> = {};

  if ("total_ht_cents" in input) {
    patchedTotals.total_ht_cents = input.total_ht_cents ?? null;
  }
  if ("total_tax_cents" in input) {
    patchedTotals.total_tax_cents = input.total_tax_cents ?? null;
  }
  if ("total_ttc_cents" in input) {
    patchedTotals.total_ttc_cents = input.total_ttc_cents ?? null;
  }

  return patchedTotals;
}

function mergeEstimateTotalsForPatch(input: {
  persistedTotals: EstimateTotals;
  patch: PatchEstimateVersionInput;
}): EstimateTotals {
  const mergedTotals: EstimateTotals = {
    ...input.persistedTotals,
  };

  if ("total_ht_cents" in input.patch) {
    mergedTotals.total_ht_cents = input.patch.total_ht_cents ?? null;
  }
  if ("total_tax_cents" in input.patch) {
    mergedTotals.total_tax_cents = input.patch.total_tax_cents ?? null;
  }
  if ("total_ttc_cents" in input.patch) {
    mergedTotals.total_ttc_cents = input.patch.total_ttc_cents ?? null;
  }

  return mergedTotals;
}

function getEstimateTotalsInvariantViolation(
  totals: EstimateTotals
): EstimateTotalsInvariantViolation | null {
  if (
    totals.total_ttc_cents !== null &&
    totals.total_ht_cents !== null &&
    totals.total_ttc_cents < totals.total_ht_cents
  ) {
    return {
      rule: "total_ttc_gte_total_ht",
      message:
        "Incoherence des totaux: total_ttc_cents doit etre superieur ou egal a total_ht_cents.",
    };
  }

  if (totals.total_tax_cents !== null && totals.total_tax_cents < 0) {
    return {
      rule: "total_tax_non_negative",
      message:
        "Incoherence des totaux: total_tax_cents doit etre superieur ou egal a 0.",
    };
  }

  if (
    totals.total_ttc_cents !== null &&
    totals.total_ht_cents !== null &&
    totals.total_tax_cents !== null &&
    totals.total_ttc_cents !== totals.total_ht_cents + totals.total_tax_cents
  ) {
    return {
      rule: "total_ttc_equals_total_ht_plus_total_tax",
      message:
        "Incoherence des totaux: total_ttc_cents doit etre egal a total_ht_cents + total_tax_cents.",
    };
  }

  return null;
}

async function logEstimateInvariantViolation(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
  userId: string;
  persistedTotals: EstimateTotals;
  patch: PatchEstimateVersionInput;
  attemptedTotals: EstimateTotals;
  violation: EstimateTotalsInvariantViolation;
}) {
  const auditPayload: AuditLogInsert = {
    tenant_id: input.tenantId,
    user_id: input.userId,
    table_name: "estimate_versions",
    record_id: input.versionId,
    estimate_version_id: input.versionId,
    action: "invariant_violation",
    before_data: {
      persisted_totals: input.persistedTotals,
    },
    after_data: {
      attempted_totals: input.attemptedTotals,
      patched_totals: extractPatchedEstimateTotals(input.patch),
      violated_rule: input.violation.rule,
      message: input.violation.message,
    },
  };

  const { error } = await input.supabase.from("audit_logs").insert(auditPayload);

  if (error) {
    console.error("Failed to log estimate invariant violation", {
      versionId: input.versionId,
      tenantId: input.tenantId,
      rule: input.violation.rule,
      error,
    });
  }
}

async function assertEstimateTotalsInvariantForPatch(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
  userId: string;
  persistedTotals: EstimateTotals;
  patch: PatchEstimateVersionInput;
}) {
  const attemptedTotals = mergeEstimateTotalsForPatch({
    persistedTotals: input.persistedTotals,
    patch: input.patch,
  });
  const violation = getEstimateTotalsInvariantViolation(attemptedTotals);

  if (!violation) return;

  await logEstimateInvariantViolation({
    supabase: input.supabase,
    tenantId: input.tenantId,
    versionId: input.versionId,
    userId: input.userId,
    persistedTotals: input.persistedTotals,
    patch: input.patch,
    attemptedTotals,
    violation,
  });

  throw badRequest(violation.message);
}

async function fetchEstimateVersionToken(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
}) {
  const { data, error } = await input.supabase
    .from("estimate_versions")
    .select("id, updated_at")
    .eq("id", input.versionId)
    .eq("tenant_id", input.tenantId)
    .single();

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(
        error,
        "Impossible de recuperer le jeton de version."
      );
    }

    throw badRequest("Impossible de recuperer le jeton de version.");
  }

  return data;
}

function collectSectionSubtreeItems(
  sourceSectionId: string,
  sourceItems: EstimateItemRow[]
) {
  const sourceItemsById = new Map(
    sourceItems.map((item) => [item.id, item] as const)
  );
  const rootSection = sourceItemsById.get(sourceSectionId);
  if (!rootSection) {
    return null;
  }

  const childrenByParentId = new Map<string, EstimateItemRow[]>();
  for (const item of sourceItems) {
    const parentId = item.parent_id ?? null;
    if (!parentId) continue;

    const siblings = childrenByParentId.get(parentId);
    if (siblings) {
      siblings.push(item);
      continue;
    }

    childrenByParentId.set(parentId, [item]);
  }

  const orderedSubtreeItems: EstimateItemRow[] = [];
  const stack: string[] = [sourceSectionId];

  while (stack.length > 0) {
    const currentItemId = stack.pop();
    if (!currentItemId) continue;

    const currentItem = sourceItemsById.get(currentItemId);
    if (!currentItem) continue;

    orderedSubtreeItems.push(currentItem);

    const directChildren = childrenByParentId.get(currentItemId) ?? [];
    for (let index = directChildren.length - 1; index >= 0; index -= 1) {
      stack.push(directChildren[index].id);
    }
  }

  return {
    rootSection,
    orderedSubtreeItems,
  };
}

function normalizeSectionTitleKey(value: string | null | undefined) {
  const normalized = toNullableText(value);
  if (!normalized) return "section";
  return normalized.toLowerCase();
}

function resolveImportedSectionTitle(input: {
  sourceTitle: string | null | undefined;
  usedTitleKeys: Set<string>;
}) {
  const fallbackTitle = "Section importee";
  const baseTitle = toNullableText(input.sourceTitle) ?? fallbackTitle;
  const baseKey = normalizeSectionTitleKey(baseTitle);

  if (!input.usedTitleKeys.has(baseKey)) {
    input.usedTitleKeys.add(baseKey);
    return baseTitle;
  }

  const firstImportedCandidate = `${baseTitle} (import)`;
  const firstImportedKey = normalizeSectionTitleKey(firstImportedCandidate);
  if (!input.usedTitleKeys.has(firstImportedKey)) {
    input.usedTitleKeys.add(firstImportedKey);
    return firstImportedCandidate;
  }

  let suffix = 2;
  while (suffix < 10_000) {
    const candidate = `${baseTitle} (import ${suffix})`;
    const candidateKey = normalizeSectionTitleKey(candidate);
    if (!input.usedTitleKeys.has(candidateKey)) {
      input.usedTitleKeys.add(candidateKey);
      return candidate;
    }
    suffix += 1;
  }

  return firstImportedCandidate;
}

function buildImportedEstimateItemInsert(input: {
  sourceItem: EstimateItemRow;
  itemId: string;
  tenantId: string;
  targetVersionId: string;
  parentId: string | null;
  position: number;
  title?: string;
}): EstimateItemInsert {
  return {
    id: input.itemId,
    tenant_id: input.tenantId,
    version_id: input.targetVersionId,
    parent_id: input.parentId,
    item_type: input.sourceItem.item_type,
    position: input.position,
    title: input.title ?? input.sourceItem.title,
    description: input.sourceItem.description,
    quantity: input.sourceItem.quantity,
    unit_price_ht_cents: input.sourceItem.unit_price_ht_cents,
    tax_rate_bp: input.sourceItem.tax_rate_bp,
    k_fo: input.sourceItem.k_fo,
    h_mo: input.sourceItem.h_mo,
    h_mo_majoration: input.sourceItem.h_mo_majoration ?? null,
    k_mo: input.sourceItem.k_mo,
    h_mo_atelier: input.sourceItem.h_mo_atelier ?? null,
    k_mo_atelier: input.sourceItem.k_mo_atelier ?? null,
    labor_role_atelier_id: input.sourceItem.labor_role_atelier_id ?? null,
    h_mo_chantier: input.sourceItem.h_mo_chantier ?? null,
    k_mo_chantier: input.sourceItem.k_mo_chantier ?? null,
    labor_role_chantier_id: input.sourceItem.labor_role_chantier_id ?? null,
    pu_ht_cents: input.sourceItem.pu_ht_cents,
    labor_role_id: input.sourceItem.labor_role_id,
    category_id: input.sourceItem.category_id,
    supply_type_id: input.sourceItem.supply_type_id ?? null,
    selected_supplier_price_id: input.sourceItem.selected_supplier_price_id ?? null,
    source_provider: input.sourceItem.source_provider ?? null,
    source_job_id: input.sourceItem.source_job_id ?? null,
    source_file_name: input.sourceItem.source_file_name ?? null,
    source_page: input.sourceItem.source_page ?? null,
    line_total_ht_cents: input.sourceItem.line_total_ht_cents,
    line_tax_cents: input.sourceItem.line_tax_cents,
    line_total_ttc_cents: input.sourceItem.line_total_ttc_cents,
  } satisfies EstimateItemInsert;
}

function buildImportedSubtreePayload(input: {
  subtree: {
    rootSection: EstimateItemRow;
    orderedSubtreeItems: EstimateItemRow[];
  };
  tenantId: string;
  targetVersionId: string;
  rootPosition: number;
  rootTitle: string;
}) {
  const newIdBySourceId = new Map<string, string>();
  const createdSectionIds: string[] = [];
  const createdLineIds: string[] = [];

  input.subtree.orderedSubtreeItems.forEach((item) => {
    newIdBySourceId.set(item.id, randomUUID());
  });

  const items = input.subtree.orderedSubtreeItems.map((sourceItem) => {
    const newItemId = newIdBySourceId.get(sourceItem.id);
    if (!newItemId) {
      throw internalError("Impossible d'importer la section.");
    }

    const isRoot = sourceItem.id === input.subtree.rootSection.id;
    const sourceParentId = sourceItem.parent_id ?? null;
    const newParentId = isRoot
      ? null
      : sourceParentId
        ? (newIdBySourceId.get(sourceParentId) ?? null)
        : null;

    if (!isRoot && sourceParentId && !newParentId) {
      throw internalError("Impossible d'importer la section.");
    }

    const inserted = buildImportedEstimateItemInsert({
      sourceItem,
      itemId: newItemId,
      tenantId: input.tenantId,
      targetVersionId: input.targetVersionId,
      parentId: newParentId,
      position: isRoot ? input.rootPosition : sourceItem.position,
      title: isRoot ? input.rootTitle : undefined,
    });

    if (sourceItem.item_type === "section") {
      createdSectionIds.push(newItemId);
    } else {
      createdLineIds.push(newItemId);
    }

    return inserted;
  });

  return {
    items,
    created_section_ids: createdSectionIds,
    created_line_ids: createdLineIds,
    line_count: createdLineIds.length,
  };
}

function sortValidImportFlowLines(lines: ValidImportFlowLine[]) {
  return [...lines].sort((left, right) => {
    if (left.rowIndex !== right.rowIndex) {
      return left.rowIndex - right.rowIndex;
    }

    return left.mappedRowId.localeCompare(right.mappedRowId);
  });
}

async function loadLatestLinkedDpgfImportForProject(input: {
  supabase: Supabase;
  tenantId: string;
  projectId: string;
}) {
  const { data, error } = await input.supabase
    .from("dpgf_imports")
    .select(
      "id, filename, source_format, status, created_at, parse_mode, row_count"
    )
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger la source DPGF liee.");
  }

  return (data ?? null) as AffaireDpgfImportRow | null;
}

async function loadLatestDpgfMappingForImport(input: {
  supabase: Supabase;
  tenantId: string;
  importId: string;
}) {
  const { data, error } = await input.supabase
    .from("dpgf_mappings")
    .select("id, status, updated_at, created_at")
    .eq("tenant_id", input.tenantId)
    .eq("import_id", input.importId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de charger le statut de mapping DPGF."
    );
  }

  return (data ?? null) as AffaireDpgfMappingRow | null;
}

async function countMappedRowsForImport(input: {
  supabase: Supabase;
  tenantId: string;
  importId: string;
}) {
  const { count, error } = await input.supabase
    .from("dpgf_rows_mapped")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", input.tenantId)
    .eq("import_id", input.importId);

  if (error) {
    throw mapSupabaseError(error, "Impossible de compter les lignes DPGF mappees.");
  }

  return count ?? 0;
}

async function loadMappedRowsForImport(input: {
  supabase: Supabase;
  tenantId: string;
  importId: string;
}) {
  const { data, error } = await input.supabase
    .from("dpgf_rows_mapped")
    .select("id, payload, created_at")
    .eq("tenant_id", input.tenantId)
    .eq("import_id", input.importId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les lignes DPGF mappees.");
  }

  return (data ?? []) as DpgfMappedRowForEstimateImport[];
}

function sleep(delayMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function loadMappedRowsForImportWithRetry(input: {
  supabase: Supabase;
  tenantId: string;
  importId: string;
  maxAttempts?: number;
  retryDelayMs?: number;
}) {
  const maxAttempts = Math.max(1, input.maxAttempts ?? 8);
  const retryDelayMs = Math.max(0, input.retryDelayMs ?? 300);
  let lastRows: DpgfMappedRowForEstimateImport[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    lastRows = await loadMappedRowsForImport({
      supabase: input.supabase,
      tenantId: input.tenantId,
      importId: input.importId,
    });

    if (lastRows.length > 0) {
      return lastRows;
    }

    if (attempt < maxAttempts) {
      await sleep(retryDelayMs * attempt);
    }
  }

  return lastRows;
}

async function resolveLinkedDpgfImportSectionTitle(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
  requestedTitle: string | null;
}) {
  const { data, error } = await input.supabase
    .from("estimate_items")
    .select("title")
    .eq("tenant_id", input.tenantId)
    .eq("version_id", input.versionId)
    .eq("item_type", "section")
    .is("parent_id", null);

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de verifier les chapitres existants."
    );
  }

  const usedRootTitleKeys = new Set<string>();
  for (const row of (data ?? []) as Array<{ title: string }>) {
    usedRootTitleKeys.add(normalizeSectionTitleKey(row.title));
  }

  return resolveImportedSectionTitle({
    sourceTitle: input.requestedTitle ?? "Import DPGF",
    usedTitleKeys: usedRootTitleKeys,
  });
}

async function importLinkedDpgfSourceIntoVersionInternal(input: {
  supabase: Supabase;
  tenantId: string;
  projectId: string;
  versionId: string;
  marginMultiplier: number;
  defaultTaxRateBp: number;
  sectionTitle?: string | null;
}): Promise<ImportLinkedDpgfSourceResult> {
  const latestImport = await loadLatestLinkedDpgfImportForProject({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
  });

  if (!latestImport) {
    throw badRequest("Aucune source DPGF liee a cette affaire.");
  }

  const mappedRows = await loadMappedRowsForImportWithRetry({
    supabase: input.supabase,
    tenantId: input.tenantId,
    importId: latestImport.id,
    maxAttempts: 10,
    retryDelayMs: 300,
  });

  if (mappedRows.length === 0) {
    throw badRequest(
      "La source DPGF liee ne contient aucune ligne mappee exploitable."
    );
  }

  const normalized = normalizeMappedRowsForEstimateCreation(mappedRows, {
    marginMultiplier: input.marginMultiplier,
    defaultTaxRateBp: input.defaultTaxRateBp,
  });
  const validLines = sortValidImportFlowLines(normalized.validLines);

  if (validLines.length === 0) {
    throw badRequest(
      "Aucune ligne DPGF valide a importer depuis la source liee."
    );
  }

  const defaultTitle = toNullableText(latestImport.filename)
    ? `Import DPGF - ${latestImport.filename}`
    : "Import DPGF";
  const resolvedSectionTitle = await resolveLinkedDpgfImportSectionTitle({
    supabase: input.supabase,
    tenantId: input.tenantId,
    versionId: input.versionId,
    requestedTitle: toNullableText(input.sectionTitle) ?? defaultTitle,
  });
  const createdSectionId = randomUUID();
  const rootPosition = await getNextItemPosition(input.supabase, input.versionId, null);

  const sectionItemPayload: EstimateItemInsert = {
    id: createdSectionId,
    tenant_id: input.tenantId,
    version_id: input.versionId,
    parent_id: null,
    item_type: "section",
    position: rootPosition,
    title: resolvedSectionTitle,
    source_provider: "dpgf",
    // source_job_id is reserved for takeoff_jobs FK; DPGF imports are tracked via source_file_name.
    source_job_id: null,
    source_file_name: latestImport.filename,
    source_page: null,
    // Keep section payload explicit for strict DB payload checks/default-to-null behavior.
    h_mo_majoration: 1,
    k_mo_atelier: 1,
    k_mo_chantier: 1,
    selected_supplier_price_id: null,
  };

  const lineItemsPayload = validLines.map((line, index) => {
    const lineId = randomUUID();
    return {
      id: lineId,
      tenant_id: input.tenantId,
      version_id: input.versionId,
      parent_id: createdSectionId,
      item_type: "line",
      position: index + 1,
      title: line.title,
      description: line.description,
      quantity: line.quantity,
      unit_price_ht_cents: line.unitPriceHtCents,
      tax_rate_bp: line.taxRateBp,
      k_fo: line.kFo,
      h_mo: line.hMo,
      h_mo_majoration: line.hMoMajoration ?? 1,
      k_mo: line.kMo,
      h_mo_atelier: null,
      k_mo_atelier: 1,
      labor_role_atelier_id: null,
      h_mo_chantier: null,
      k_mo_chantier: 1,
      labor_role_chantier_id: null,
      pu_ht_cents: line.puHtCents,
      labor_role_id: null,
      category_id: null,
      supply_type_id: null,
      selected_supplier_price_id: null,
      source_provider: "dpgf",
      // source_job_id is reserved for takeoff_jobs FK; DPGF imports are tracked via source_file_name.
      source_job_id: null,
      source_file_name: latestImport.filename,
      source_page: line.rowIndex > 0 ? line.rowIndex : null,
      line_total_ht_cents: line.lineTotalHtCents,
      line_tax_cents: line.lineTaxCents,
      line_total_ttc_cents: line.lineTotalTtcCents,
    } satisfies EstimateItemInsert;
  });

  const { error: insertError } = await input.supabase
    .from("estimate_items")
    .insert([sectionItemPayload, ...lineItemsPayload], {
      defaultToNull: false,
    });

  if (insertError) {
    throw mapSupabaseError(insertError, "Impossible d'importer la source DPGF liee.");
  }

  const recalculateResult = await recalculateEstimateVersionTotals({
    supabase: input.supabase,
    tenantId: input.tenantId,
    versionId: input.versionId,
  });

  return {
    source_import_id: latestImport.id,
    target_version_id: input.versionId,
    created_section_id: createdSectionId,
    created_line_ids: lineItemsPayload.map((item) => item.id as string),
    imported_lines_count: lineItemsPayload.length,
    skipped_lines_count: Math.max(
      normalized.totalRows - lineItemsPayload.length,
      0
    ),
    totals: recalculateResult.totals,
    version: recalculateResult.version,
  };
}

function toArrayNumberOrNull(value: unknown): Array<number | null> | null {
  if (!Array.isArray(value)) return null;
  return value.map((entry) => {
    if (typeof entry === "number" && Number.isFinite(entry)) {
      return entry;
    }
    if (entry === null) {
      return null;
    }
    return null;
  });
}

async function loadMarginTiersForTotals(input: {
  supabase: Supabase;
  tenantId: string;
}) {
  const { data, error } = await input.supabase
    .from("margin_tiers")
    .select("threshold_cents, multiplier")
    .eq("tenant_id", input.tenantId)
    .order("threshold_cents", { ascending: true })
    .order("position", { ascending: true });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les tranches de marge.");
  }

  return (data ?? []).map((tier) => ({
    threshold_cents: tier.threshold_cents,
    multiplier: tier.multiplier,
  }));
}

async function recalculateEstimateVersionTotals(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
}) {
  const { data: versionData, error: versionError } = await input.supabase
    .from("estimate_versions")
    .select(
      "id, margin_multiplier, margin_mode, tax_rate_bp, discount_bp, discount_mode, discount_steps, global_coefficient, rounding_mode, rounding_step_cents, estimate_projects!inner(user_id)"
    )
    .eq("tenant_id", input.tenantId)
    .eq("id", input.versionId)
    .single();

  if (versionError || !versionData) {
    if (versionError) {
      throw mapSupabaseError(
        versionError,
        "Impossible de recalculer les totaux de la version cible."
      );
    }

    throw badRequest("Impossible de recalculer les totaux de la version cible.");
  }

  const versionRecord = versionData as Pick<
    EstimateVersionRow,
    | "margin_multiplier"
    | "margin_mode"
    | "tax_rate_bp"
    | "discount_bp"
    | "discount_mode"
    | "discount_steps"
    | "global_coefficient"
    | "rounding_mode"
    | "rounding_step_cents"
  > & {
    estimate_projects: { user_id: string } | { user_id: string }[] | null;
  };

  const project = resolveEmbeddedOne(versionRecord.estimate_projects);
  if (!project) {
    throw badRequest("Impossible de recalculer les totaux de la version cible.");
  }

  const { data: lineItemsData, error: lineItemsError } = await input.supabase
    .from("estimate_items")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .eq("version_id", input.versionId)
    .eq("item_type", "line");

  if (lineItemsError) {
    throw mapSupabaseError(
      lineItemsError,
      "Impossible de recalculer les totaux de la version cible."
    );
  }

  const lineItems = (lineItemsData ?? []) as EstimateItemRow[];
  const laborRoleIds = new Set<string>();
  lineItems.forEach((item) => {
    if (item.labor_role_id) laborRoleIds.add(item.labor_role_id);
    if (item.labor_role_atelier_id) laborRoleIds.add(item.labor_role_atelier_id);
    if (item.labor_role_chantier_id) laborRoleIds.add(item.labor_role_chantier_id);
  });

  const laborRatesById = new Map<string, number>();
  const uniqueRoleIds = Array.from(laborRoleIds);
  if (uniqueRoleIds.length > 0) {
    const { data: laborRolesData, error: laborRolesError } = await input.supabase
      .from("labor_roles")
      .select("id, hourly_rate_cents")
      .eq("tenant_id", input.tenantId)
      .eq("user_id", project.user_id)
      .in("id", uniqueRoleIds);

    if (laborRolesError) {
      throw mapSupabaseError(
        laborRolesError,
        "Impossible de recalculer les totaux de la version cible."
      );
    }

    (laborRolesData ?? []).forEach((role) => {
      laborRatesById.set(role.id, role.hourly_rate_cents);
    });
  }

  const marginTiers =
    versionRecord.margin_mode === "tiered"
      ? await loadMarginTiersForTotals({
          supabase: input.supabase,
          tenantId: input.tenantId,
        })
      : [];

  const discountSteps = toArrayNumberOrNull(versionRecord.discount_steps);
  const discountCents = computeInitialDiscountCents(
    {
      margin_multiplier: versionRecord.margin_multiplier ?? 1,
      margin_mode: versionRecord.margin_mode ?? "fixed",
      tax_rate_bp: versionRecord.tax_rate_bp ?? DEFAULT_TAX_RATE_BP,
      discount_bp: versionRecord.discount_bp ?? 0,
      discount_mode: versionRecord.discount_mode ?? "simple",
      discount_steps: discountSteps,
      global_coefficient: versionRecord.global_coefficient ?? 1,
    },
    lineItems,
    laborRatesById
  );

  const totalsResult = computeEstimateTotals({
    lineItems: lineItems.map((item) => ({
      quantity: item.quantity ?? 0,
      unit_price_ht_cents: item.unit_price_ht_cents ?? 0,
      tax_rate_bp: item.tax_rate_bp ?? (versionRecord.tax_rate_bp ?? DEFAULT_TAX_RATE_BP),
      k_fo: item.k_fo ?? 1,
      h_mo: item.h_mo ?? 0,
      h_mo_majoration: item.h_mo_majoration ?? 1,
      k_mo: item.k_mo ?? 1,
      h_mo_atelier: item.h_mo_atelier ?? null,
      k_mo_atelier: item.k_mo_atelier ?? null,
      labor_role_atelier_id: item.labor_role_atelier_id ?? null,
      h_mo_chantier: item.h_mo_chantier ?? null,
      k_mo_chantier: item.k_mo_chantier ?? null,
      labor_role_chantier_id: item.labor_role_chantier_id ?? null,
      pu_ht_cents: item.pu_ht_cents ?? 0,
      labor_role_hourly_rate_cents: item.labor_role_id
        ? (laborRatesById.get(item.labor_role_id) ?? 0)
        : 0,
      labor_role_atelier_hourly_rate_cents: item.labor_role_atelier_id
        ? (laborRatesById.get(item.labor_role_atelier_id) ?? 0)
        : 0,
      labor_role_chantier_hourly_rate_cents: item.labor_role_chantier_id
        ? (laborRatesById.get(item.labor_role_chantier_id) ?? 0)
        : 0,
    })),
    marginMultiplier: versionRecord.margin_multiplier ?? 1,
    marginMode: versionRecord.margin_mode ?? "fixed",
    marginTiers,
    discountCents,
    discountMode: versionRecord.discount_mode ?? "simple",
    discountStepsBp: discountSteps,
    globalCoefficient: versionRecord.global_coefficient ?? 1,
    taxRateBp: versionRecord.tax_rate_bp ?? DEFAULT_TAX_RATE_BP,
    roundingMode: versionRecord.rounding_mode ?? DEFAULT_ROUNDING_MODE,
    roundingStepCents:
      versionRecord.rounding_step_cents ?? DEFAULT_ROUNDING_STEP_CENTS,
  });

  const totals = {
    total_ht_cents: totalsResult.saleTotalCents,
    total_tax_cents: totalsResult.adjustedTaxCents,
    total_ttc_cents: totalsResult.roundedTtcCents,
  };

  const { data: versionToken, error: updateVersionError } = await input.supabase
    .from("estimate_versions")
    .update({
      total_ht_cents: totals.total_ht_cents,
      total_tax_cents: totals.total_tax_cents,
      total_ttc_cents: totals.total_ttc_cents,
    })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.versionId)
    .select("id, updated_at")
    .single();

  if (updateVersionError || !versionToken) {
    if (updateVersionError) {
      throw mapSupabaseError(
        updateVersionError,
        "Impossible de recalculer les totaux de la version cible."
      );
    }

    throw badRequest("Impossible de recalculer les totaux de la version cible.");
  }

  return {
    totals,
    version: versionToken,
  };
}

function resolveEmbeddedOne<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function toNullableText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNullablePositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return null;
  }

  return value > 0 ? value : null;
}

function normalizeTakeoffJobProvenanceRows(value: unknown): TakeoffJobProvenanceRow[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const id = toNullableText(
        typeof record.id === "string" ? record.id : null
      );

      if (!id) {
        return null;
      }

      return {
        id,
        level: toNullableText(
          typeof record.level === "string" ? record.level : null
        ),
        completed_at: toNullableText(
          typeof record.completed_at === "string"
            ? record.completed_at
            : null
        ),
        created_at: toNullableText(
          typeof record.created_at === "string" ? record.created_at : null
        ),
      } satisfies TakeoffJobProvenanceRow;
    })
    .filter((entry): entry is TakeoffJobProvenanceRow => entry !== null);
}

async function enrichEstimateItemsWithTakeoffProvenance(input: {
  supabase: Supabase;
  tenantId: string;
  targetVersionId: string;
  items: EstimateItemRow[];
}): Promise<EstimateItemWithProvenanceRow[]> {
  if (input.items.length === 0) {
    return input.items;
  }

  const sourceJobIds = [...new Set(
    input.items
      .map((item) => toNullableText(item.source_job_id))
      .filter((jobId): jobId is string => jobId !== null)
  )];

  if (sourceJobIds.length === 0) {
    return input.items;
  }

  const { data, error } = await input.supabase
    .from("takeoff_jobs" as never)
    .select("id, level, completed_at, created_at" as never)
    .eq("tenant_id", input.tenantId)
    .in("id", sourceJobIds as never);

  if (error) {
    return input.items;
  }

  const takeoffJobs = normalizeTakeoffJobProvenanceRows(data);
  if (takeoffJobs.length === 0) {
    return input.items;
  }

  const takeoffJobById = new Map(
    takeoffJobs.map((job) => [job.id, job] as const)
  );

  let linkedSourceVersionByJobId = new Map<
    string,
    {
      source_version_id: string;
      source_version_number: number | null;
    }
  >();

  try {
    linkedSourceVersionByJobId = await getTakeoffLinkedSourceVersionByJobId({
      supabase: input.supabase,
      tenantId: input.tenantId,
      targetVersionId: input.targetVersionId,
      jobIds: sourceJobIds,
    });
  } catch {
    linkedSourceVersionByJobId = new Map();
  }

  return input.items.map((item) => {
    const sourceJobId = toNullableText(item.source_job_id);
    if (!sourceJobId) {
      return item;
    }

    const takeoffJob = takeoffJobById.get(sourceJobId);
    if (!takeoffJob) {
      return item;
    }

    const withProvenance = item as EstimateItemWithProvenanceRow;
    const sourceLevel =
      toNullableText(withProvenance.source_level) ??
      toNullableText(takeoffJob.level);
    const sourceExtractedAt =
      toNullableText(withProvenance.source_extracted_at) ??
      toNullableText(takeoffJob.completed_at) ??
      toNullableText(takeoffJob.created_at);
    const sourceVersionNumber =
      toNullablePositiveInteger(withProvenance.source_version_number) ??
      toNullablePositiveInteger(
        linkedSourceVersionByJobId.get(sourceJobId)?.source_version_number
      );

    return {
      ...item,
      source_level: sourceLevel,
      source_extracted_at: sourceExtractedAt,
      source_version_number: sourceVersionNumber,
    };
  });
}

async function enrichEstimateItemsWithSourceMetadata(input: {
  supabase: Supabase;
  tenantId: string;
  targetVersionId: string;
  items: EstimateItemRow[];
}): Promise<EstimateItemWithTruthRow[]> {
  const withTakeoff = await enrichEstimateItemsWithTakeoffProvenance(input);
  const withAiStructure = await enrichEstimateItemsWithAiStructureProvenance({
    supabase: input.supabase,
    tenantId: input.tenantId,
    items: withTakeoff,
  });
  const withGeneratedOuvrage = await enrichEstimateItemsWithGeneratedOuvrageProvenance({
    supabase: input.supabase,
    tenantId: input.tenantId,
    items: withAiStructure,
  });
  const withVersionZero = await enrichEstimateItemsWithVersionZeroProvenance({
    supabase: input.supabase,
    tenantId: input.tenantId,
    items: withGeneratedOuvrage,
  });

  return (withVersionZero as EstimateItemWithProvenanceRow[]).map((item) => ({
    ...item,
    line_truth: resolveEstimateLineTruth(item),
  }));
}

function escapeIlikeToken(value: string) {
  return value.replace(/[%_,()']/g, "");
}

function normalizeSupplierComparisonQuery(value: string | null | undefined) {
  if (!value) return "";
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function toTimestamp(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function variantLabelToSequenceIndex(label: string | null | undefined) {
  const normalized = toNullableText(label)?.toUpperCase();
  if (!normalized) return null;

  let index = 0;

  for (const character of normalized) {
    const code = character.charCodeAt(0);
    if (code < 65 || code > 90) {
      return null;
    }

    index = index * 26 + (code - 64);
  }

  return index > 0 ? index : null;
}

function extractCatalogueUrl(value: string | null | undefined) {
  if (!value) return null;
  const match = value.match(/https?:\/\/[^\s]+/i);
  if (!match?.[0]) return null;
  return match[0];
}

function getMostRecentRecord<T extends { updated_at: string | null }>(rows: T[]) {
  if (rows.length === 0) return null;
  return [...rows].sort((left, right) => {
    return toTimestamp(right.updated_at) - toTimestamp(left.updated_at);
  })[0];
}

function computeSearchRelevance(input: {
  query: string;
  designation: string;
  supplierName: string;
  supplierSku: string | null;
  productReference: string | null;
  category?: string | null;
  productType?: string | null;
  material?: string | null;
  grade?: string | null;
  dimensions?: string | null;
  standard?: string | null;
}) {
  const query = input.query.toLowerCase();
  const designation = input.designation.toLowerCase();
  const supplierName = input.supplierName.toLowerCase();
  const supplierSku = (input.supplierSku ?? "").toLowerCase();
  const productReference = (input.productReference ?? "").toLowerCase();
  const technicalDetails = [
    input.category,
    input.productType,
    input.material,
    input.grade,
    input.dimensions,
    input.standard,
  ]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toLowerCase());

  let score = 0;

  if (designation === query) {
    score += 100;
  } else if (designation.startsWith(query)) {
    score += 80;
  } else if (designation.includes(query)) {
    score += 60;
  }

  if (productReference === query) {
    score += 50;
  } else if (productReference.includes(query)) {
    score += 30;
  }

  if (supplierName === query) {
    score += 35;
  } else if (supplierName.includes(query)) {
    score += 20;
  }

  if (supplierSku === query) {
    score += 25;
  } else if (supplierSku.includes(query)) {
    score += 12;
  }
  technicalDetails.forEach((detail) => {
    if (detail === query) {
      score += 28;
    } else if (detail.includes(query)) {
      score += 14;
    }
  });

  return score;
}

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function normalizePositiveInteger(input: {
  value: number | undefined;
  fallback: number;
  min?: number;
  max?: number;
}) {
  const min = input.min ?? 1;
  const max = input.max ?? Number.MAX_SAFE_INTEGER;

  if (input.value === undefined || !Number.isFinite(input.value)) {
    return input.fallback;
  }

  const normalized = Math.trunc(input.value);
  if (normalized < min) return min;
  if (normalized > max) return max;
  return normalized;
}

function isTenantAdmin(tenantRole: TenantRole) {
  return tenantRole === TENANT_ADMIN_ROLE;
}

function canAccessOwnerResource(input: {
  context: Pick<AuthenticatedContext, "userId" | "tenantRole">;
  resourceUserId: string;
}) {
  return (
    input.resourceUserId === input.context.userId ||
    isTenantAdmin(input.context.tenantRole)
  );
}

function canAccessEstimateReadResource(input: {
  context: Pick<AuthenticatedContext, "userId" | "tenantRole">;
  resourceUserId: string;
}) {
  return (
    canAccessOwnerResource(input) ||
    input.context.tenantRole === "director"
  );
}

export async function getAuthenticatedContext(): Promise<AuthenticatedContext> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw unauthorized();
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, role, is_default, created_at")
    .eq("user_id", user.id)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);

  if (membershipError) {
    throw mapSupabaseError(membershipError, "Impossible de charger le tenant courant.");
  }

  const membership = memberships?.[0] as TenantMembershipRow | undefined;

  if (!membership?.tenant_id || !membership.role) {
    throw forbidden("Aucun tenant actif pour cet utilisateur.");
  }

  return {
    supabase,
    userId: user.id,
    tenantId: membership.tenant_id,
    tenantRole: membership.role,
  };
}

function throwTemplateNameConflictIfNeeded(error: PostgrestError): never | void {
  if (error.code !== "23505") return;
  throw conflict(
    "Un template avec ce nom existe deja.",
    error,
    "ESTIMATE_TEMPLATE_NAME_CONFLICT"
  );
}

function throwAssemblyNameConflictIfNeeded(error: PostgrestError): never | void {
  if (error.code !== "23505") return;
  throw conflict(
    "Un ouvrage avec ce nom existe deja.",
    error,
    "ESTIMATE_ASSEMBLY_NAME_CONFLICT"
  );
}

function errorMessageContains(
  error: PostgrestError,
  expectedMessageFragment: string
): boolean {
  return (error.message ?? "")
    .toLowerCase()
    .includes(expectedMessageFragment.toLowerCase());
}

function throwAssemblyCompositionErrorIfNeeded(
  error: PostgrestError
): never | void {
  if (errorMessageContains(error, "would create a cycle")) {
    throw conflict(
      "Cette composition creerait une boucle entre ouvrages.",
      error,
      "ESTIMATE_ASSEMBLY_CYCLE"
    );
  }
  if (errorMessageContains(error, "limited to two nested levels")) {
    throw badRequest(
      "Un ouvrage est limite a deux niveaux de sous-ouvrages.",
      error,
      "ESTIMATE_ASSEMBLY_DEPTH_EXCEEDED"
    );
  }
  if (errorMessageContains(error, "cannot contain itself")) {
    throw badRequest(
      "Un ouvrage ne peut pas se contenir lui-meme.",
      error,
      "ESTIMATE_ASSEMBLY_SELF_REFERENCE"
    );
  }
}


function throwTemplateSourceVersionNotFoundIfNeeded(
  error: PostgrestError
): never | void {
  if (!errorMessageContains(error, "template source version not found")) return;
  throw notFound(
    "Version source introuvable.",
    error,
    "ESTIMATE_TEMPLATE_SOURCE_VERSION_NOT_FOUND"
  );
}

function throwTemplateNotFoundIfNeeded(error: PostgrestError): never | void {
  if (!errorMessageContains(error, "template not found")) return;
  throw notFound("Template introuvable.", error, "ESTIMATE_TEMPLATE_NOT_FOUND");
}

function throwTemplateTargetProjectNotFoundIfNeeded(
  error: PostgrestError
): never | void {
  if (!errorMessageContains(error, "target project not found")) return;
  throw notFound(
    "Projet cible introuvable.",
    error,
    "ESTIMATE_TEMPLATE_TARGET_PROJECT_NOT_FOUND"
  );
}

function toRpcUuid(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function toTemplateSummary(row: EstimateTemplateRow, itemCount: number) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    source_version_id: row.source_version_id,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    item_count: itemCount,
  };
}

function toAssemblySummary(
  row: EstimateAssemblyRow,
  itemCount: number,
  memberCount = 0
) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    reference_code: row.reference_code,
    unit: row.unit,
    pricing_source: row.pricing_source,
    ds_cents: row.ds_cents,
    indicative_target_price_cents: row.indicative_target_price_cents,
    avg_output_rate: row.avg_output_rate,
    avg_time_hours: row.avg_time_hours,
    source_metadata: row.source_metadata,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    item_count: itemCount,
    member_count: memberCount,
  };
}

async function loadEstimateTemplateOrThrow(input: {
  supabase: Supabase;
  tenantId: string;
  templateId: string;
}): Promise<EstimateTemplateRow> {
  const { data, error } = await input.supabase
    .from("estimate_templates")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .eq("id", input.templateId)
    .single();

  if (error || !data) {
    if (error && error.code !== "PGRST116") {
      throw mapSupabaseError(error, "Impossible de charger le template.");
    }

    throw notFound(
      "Template introuvable.",
      undefined,
      "ESTIMATE_TEMPLATE_NOT_FOUND"
    );
  }

  return data as unknown as EstimateTemplateRow;
}

async function loadEstimateTemplateItems(input: {
  supabase: Supabase;
  tenantId: string;
  templateId: string;
}) {
  const { data, error } = await input.supabase
    .from("estimate_template_items")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .eq("template_id", input.templateId)
    .order("position", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les lignes du template.");
  }

  return (data ?? []) as EstimateTemplateItemRow[];
}

async function loadTemplateLineCountByTemplateId(input: {
  supabase: Supabase;
  tenantId: string;
  templateIds: string[];
}) {
  const counts = new Map<string, number>();

  if (input.templateIds.length === 0) {
    return counts;
  }

  const { data, error } = await input.supabase
    .from("estimate_template_items")
    .select("template_id")
    .eq("tenant_id", input.tenantId)
    .eq("item_type", "line")
    .in("template_id", input.templateIds);

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger le comptage des templates.");
  }

  for (const row of (data ?? []) as Array<{ template_id: string }>) {
    counts.set(row.template_id, (counts.get(row.template_id) ?? 0) + 1);
  }

  return counts;
}

async function loadEstimateAssemblyOrThrow(input: {
  supabase: Supabase;
  tenantId: string;
  assemblyId: string;
}) {
  const { data, error } = await input.supabase
    .from("estimate_assemblies")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .eq("id", input.assemblyId)
    .single();

  if (error || !data) {
    if (error && error.code !== "PGRST116") {
      throw mapSupabaseError(error, "Impossible de charger l'ouvrage.");
    }

    throw notFound(
      "Ouvrage introuvable.",
      undefined,
      "ESTIMATE_ASSEMBLY_NOT_FOUND"
    );
  }

  return data as EstimateAssemblyRow;
}

async function loadEstimateAssemblyItems(input: {
  supabase: Supabase;
  tenantId: string;
  assemblyId: string;
}) {
  const { data, error } = await input.supabase
    .from("estimate_assembly_items")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .eq("assembly_id", input.assemblyId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les lignes de l'ouvrage.");
  }

  return (data ?? []) as EstimateAssemblyItemRow[];
}

async function loadEstimateAssemblyMembers(input: {
  supabase: Supabase;
  tenantId: string;
  assemblyId: string;
}) {
  const { data, error } = await input.supabase
    .from("estimate_assembly_members")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .eq("parent_assembly_id", input.assemblyId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de charger les sous-ouvrages."
    );
  }

  const members = (data ?? []) as EstimateAssemblyMemberRow[];
  const childIds = members.map((member) => member.child_assembly_id);
  if (childIds.length === 0) return [];

  const { data: childAssemblies, error: childError } = await input.supabase
    .from("estimate_assemblies")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .in("id", childIds);

  if (childError) {
    throw mapSupabaseError(
      childError,
      "Impossible de charger les sous-ouvrages."
    );
  }

  const childrenById = new Map(
    ((childAssemblies ?? []) as EstimateAssemblyRow[]).map((assembly) => [
      assembly.id,
      assembly,
    ])
  );

  return members.map((member) => ({
    ...member,
    child_assembly: childrenById.get(member.child_assembly_id) ?? null,
  }));
}


async function loadAssemblyItemCountByAssemblyId(input: {
  supabase: Supabase;
  tenantId: string;
  assemblyIds: string[];
}) {
  const counts = new Map<string, number>();

  if (input.assemblyIds.length === 0) {
    return counts;
  }

  const { data, error } = await input.supabase
    .from("estimate_assembly_items")
    .select("assembly_id")
    .eq("tenant_id", input.tenantId)
    .in("assembly_id", input.assemblyIds);

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger le comptage des ouvrages.");
  }

  for (const row of (data ?? []) as Array<{ assembly_id: string }>) {
    counts.set(row.assembly_id, (counts.get(row.assembly_id) ?? 0) + 1);
  }

  return counts;
}

async function loadAssemblyMemberCountByAssemblyId(input: {
  supabase: Supabase;
  tenantId: string;
  assemblyIds: string[];
}) {
  const counts = new Map<string, number>();

  if (input.assemblyIds.length === 0) {
    return counts;
  }

  const { data, error } = await input.supabase
    .from("estimate_assembly_members")
    .select("parent_assembly_id")
    .eq("tenant_id", input.tenantId)
    .in("parent_assembly_id", input.assemblyIds);

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de charger le comptage des sous-ouvrages."
    );
  }

  for (const row of (data ?? []) as Array<{ parent_assembly_id: string }>) {
    counts.set(
      row.parent_assembly_id,
      (counts.get(row.parent_assembly_id) ?? 0) + 1
    );
  }

  return counts;
}


async function loadValidLaborRoleIdsForOwner(input: {
  supabase: Supabase;
  tenantId: string;
  ownerUserId: string;
  laborRoleIds: string[];
}) {
  if (input.laborRoleIds.length === 0) {
    return new Set<string>();
  }

  const uniqueRoleIds = [...new Set(input.laborRoleIds)];
  const { data, error } = await input.supabase
    .from("labor_roles")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.ownerUserId)
    .in("id", uniqueRoleIds);

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les roles MO.");
  }

  return new Set((data ?? []).map((row) => row.id));
}

async function getVersionAccessOrThrow(
  supabase: Supabase,
  versionId: string,
  context: Pick<AuthenticatedContext, "tenantId" | "tenantRole" | "userId">
): Promise<{ version: VersionAccessRow; project: EmbeddedProjectAccess }> {
  const { data, error } = await supabase
    .from("estimate_versions")
    .select(
      "id, project_id, status, margin_mode, margin_multiplier, max_section_depth, tax_rate_bp, updated_at, total_ht_cents, total_tax_cents, total_ttc_cents, parent_version_id, variant_label, estimate_projects!inner(id, tenant_id, user_id, name, reference, estimate_reference, client_name, notes, is_archived)"
    )
    .eq("id", versionId)
    .eq("tenant_id", context.tenantId)
    .single();

  if (error || !data) {
    throw notFound("Version de chiffrage introuvable.");
  }

  const row = data as unknown as VersionAccessRow;
  const project = resolveEmbeddedOne(row.estimate_projects);

  if (
    !project ||
    project.tenant_id !== context.tenantId ||
    !canAccessOwnerResource({
      context,
      resourceUserId: project.user_id,
    })
  ) {
    throw notFound("Version de chiffrage introuvable.");
  }

  return {
    version: row,
    project,
  };
}

export function assertDraftStatus(status: EstimateStatus) {
  if (status === "draft") return;
  throw forbidden("Cette version est en lecture seule.", undefined, "READ_ONLY");
}

async function getActiveDraftLockForVersion(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
}) {
  const { data, error } = await input.supabase
    .from("draft_locks")
    .select("id, version_id, user_id, locked_at, expires_at")
    .eq("tenant_id", input.tenantId)
    .eq("version_id", input.versionId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de verifier le verrou de brouillon."
    );
  }

  return (data ?? null) as
    | {
        id: string;
        version_id: string;
        user_id: string;
        locked_at: string;
        expires_at: string;
      }
    | null;
}

async function resolveDraftLockOwnerName(supabase: Supabase, userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const fullName =
    typeof data.full_name === "string" ? data.full_name.trim() : "";
  return fullName.length > 0 ? fullName : null;
}

async function assertDraftLockOwnedByCurrentUser(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
  userId: string;
}) {
  const lock = await getActiveDraftLockForVersion({
    supabase: input.supabase,
    tenantId: input.tenantId,
    versionId: input.versionId,
  });

  if (!lock) {
    throw conflict(
      "Un verrou actif est requis pour modifier cette version brouillon.",
      {
        lock: null,
      },
      "LOCK_REQUIRED"
    );
  }

  if (lock.user_id === input.userId) {
    return;
  }

  const holderName = await resolveDraftLockOwnerName(input.supabase, lock.user_id);

  throw conflict("Cette version est deja verrouillee par un autre utilisateur.", {
    lock: {
      version_id: lock.version_id,
      user_id: lock.user_id,
      holder_name: holderName,
      locked_at: lock.locked_at,
      expires_at: lock.expires_at,
      is_owner: false,
    },
  });
}

async function getNextItemPosition(
  supabase: Supabase,
  versionId: string,
  parentId: string | null
) {
  let query = supabase
    .from("estimate_items")
    .select("position")
    .eq("version_id", versionId)
    .order("position", { ascending: false })
    .limit(1);

  query = parentId === null ? query.is("parent_id", null) : query.eq("parent_id", parentId);

  const { data, error } = await query;

  if (error) {
    throw mapSupabaseError(error, "Impossible de determiner la prochaine position.");
  }

  return (data?.[0]?.position ?? 0) + 1;
}

async function ensureParentIsValid({
  supabase,
  tenantId,
  versionId,
  parentId,
  itemId,
}: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
  parentId: string | null;
  itemId?: string;
}) {
  if (parentId === null) return null;

  const { data, error } = await supabase
    .from("estimate_items")
    .select("id, version_id, item_type, parent_id")
    .eq("tenant_id", tenantId)
    .eq("id", parentId)
    .single();

  if (error || !data) {
    throw badRequest("parent_id invalide.");
  }

  if (data.version_id !== versionId) {
    throw badRequest("parent_id doit appartenir a la meme version.");
  }

  if (data.item_type !== "section") {
    throw badRequest("Le parent doit etre de type section.");
  }

  if (itemId && data.id === itemId) {
    throw badRequest("Un element ne peut pas etre son propre parent.");
  }

  return data as Pick<EstimateItemRow, "id" | "parent_id" | "item_type">;
}

async function loadHierarchyItems(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
}) {
  const { data, error } = await input.supabase
    .from("estimate_items")
    .select("id, parent_id, item_type")
    .eq("tenant_id", input.tenantId)
    .eq("version_id", input.versionId);

  if (error) {
    throw mapSupabaseError(error, "Impossible de verifier la hierarchie.");
  }

  return (
    (data ?? []) as Array<
      Pick<EstimateItemRow, "id" | "parent_id" | "item_type">
    >
  );
}

async function resolveSectionLevelFromParent(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
  parent:
    | Pick<EstimateItemRow, "id" | "parent_id" | "item_type">
    | null;
}) {
  if (!input.parent) return null;

  const hierarchyItems = await loadHierarchyItems({
    supabase: input.supabase,
    tenantId: input.tenantId,
    versionId: input.versionId,
  });
  const hierarchy = buildHierarchyIndex(hierarchyItems);
  return resolveSectionLevel(hierarchy, input.parent.id);
}

function assertSectionPlacementAllowed(input: {
  maxSectionDepth: number;
  nextSectionLevel: number;
}) {
  if (input.nextSectionLevel <= input.maxSectionDepth) {
    return;
  }

  throw badRequest(
    `Impossible de creer ce niveau: profondeur max ${input.maxSectionDepth}.`
  );
}

function assertLinePlacementAllowed(input: {
  maxSectionDepth: number;
  parentSectionLevel: number | null;
}) {
  if (input.parentSectionLevel === null) {
    throw badRequest("Une ligne doit etre ajoutee sous une section.");
  }

  if (input.parentSectionLevel > input.maxSectionDepth) {
    throw badRequest(
      `Une ligne ne peut pas etre rattachee au-dela du niveau ${input.maxSectionDepth}.`
    );
  }
}

function assertSectionSubtreePlacementAllowed(input: {
  hierarchyIndex: ReturnType<typeof buildHierarchyIndex>;
  sectionId: string;
  nextSectionLevel: number;
  maxSectionDepth: number;
}) {
  const metrics = collectSubtreeMetrics(input.hierarchyIndex, input.sectionId);

  if (
    input.nextSectionLevel + metrics.maxSectionRelativeDepth >
    input.maxSectionDepth
  ) {
    throw badRequest(
      `Ce deplacement depasse la profondeur max ${input.maxSectionDepth}.`
    );
  }
}

async function ensureCategoryIsValid(
  supabase: Supabase,
  categoryId: string | null,
  context: Pick<AuthenticatedContext, "tenantId" | "tenantRole" | "userId">,
  ownerUserId: string = context.userId
) {
  if (categoryId === null) return;
  if (
    !canAccessOwnerResource({
      context,
      resourceUserId: ownerUserId,
    })
  ) {
    throw badRequest("category_id invalide.");
  }

  const { data, error } = await supabase
    .from("estimate_categories")
    .select("id, tenant_id, user_id")
    .eq("id", categoryId)
    .eq("tenant_id", context.tenantId)
    .eq("user_id", ownerUserId)
    .single();

  if (
    error ||
    !data ||
    !canAccessOwnerResource({
      context,
      resourceUserId: data.user_id,
    })
  ) {
    throw badRequest("category_id invalide.");
  }
}

async function ensureSupplyTypeIsValid(
  supabase: Supabase,
  supplyTypeId: string | null,
  context: Pick<AuthenticatedContext, "tenantId">
) {
  if (supplyTypeId === null) return;

  const { data, error } = await supabase
    .from("supply_types")
    .select("id, tenant_id")
    .eq("id", supplyTypeId)
    .eq("tenant_id", context.tenantId)
    .single();

  if (error || !data) {
    throw badRequest("supply_type_id invalide.");
  }
}

async function ensureSupplierPriceIsValid(
  supabase: Supabase,
  supplierPriceId: string | null,
  context: Pick<AuthenticatedContext, "tenantId">
) {
  if (supplierPriceId === null) return;

  const { data, error } = await supabase
    .from("supplier_pricebook")
    .select("id, tenant_id")
    .eq("id", supplierPriceId)
    .eq("tenant_id", context.tenantId)
    .single();

  if (error || !data) {
    throw badRequest("selected_supplier_price_id invalide.");
  }
}

function isLaborSplitEnabledForItem(
  item: Partial<
    Pick<
      EstimateItemRow,
      | "h_mo_atelier"
      | "k_mo_atelier"
      | "labor_role_atelier_id"
      | "h_mo_chantier"
      | "k_mo_chantier"
      | "labor_role_chantier_id"
    >
  >
) {
  return hasActiveLaborSplitPayload(item);
}

async function resolveLaborRateCents(
  supabase: Supabase,
  laborRoleId: string | null,
  context: Pick<AuthenticatedContext, "tenantId" | "tenantRole" | "userId">,
  ownerUserId: string = context.userId
) {
  if (laborRoleId === null) return 0;
  if (
    !canAccessOwnerResource({
      context,
      resourceUserId: ownerUserId,
    })
  ) {
    throw badRequest("labor_role_id invalide.");
  }

  const { data, error } = await supabase
    .from("labor_roles")
    .select("id, tenant_id, user_id, hourly_rate_cents")
    .eq("id", laborRoleId)
    .eq("tenant_id", context.tenantId)
    .eq("user_id", ownerUserId)
    .single();

  if (
    error ||
    !data ||
    !canAccessOwnerResource({
      context,
      resourceUserId: data.user_id,
    })
  ) {
    throw badRequest("labor_role_id invalide.");
  }

  return data.hourly_rate_cents;
}

async function ensureLaborRoleIsValid(
  supabase: Supabase,
  laborRoleId: string | null,
  context: Pick<AuthenticatedContext, "tenantId" | "tenantRole" | "userId">,
  ownerUserId: string = context.userId
) {
  if (laborRoleId === null) return;
  if (
    !canAccessOwnerResource({
      context,
      resourceUserId: ownerUserId,
    })
  ) {
    throw badRequest("labor_role_id invalide.");
  }

  const { data, error } = await supabase
    .from("labor_roles")
    .select("id, tenant_id, user_id")
    .eq("id", laborRoleId)
    .eq("tenant_id", context.tenantId)
    .eq("user_id", ownerUserId)
    .single();

  if (
    error ||
    !data ||
    !canAccessOwnerResource({
      context,
      resourceUserId: data.user_id,
    })
  ) {
    throw badRequest("labor_role_id invalide.");
  }
}

async function getNextCategoryPosition(
  supabase: Supabase,
  context: Pick<AuthenticatedContext, "tenantId" | "tenantRole" | "userId">,
  ownerUserId: string = context.userId
) {
  if (
    !canAccessOwnerResource({
      context,
      resourceUserId: ownerUserId,
    })
  ) {
    throw forbidden("Acces interdit aux ressources de cet utilisateur.");
  }

  const { data, error } = await supabase
    .from("estimate_categories")
    .select("position")
    .eq("tenant_id", context.tenantId)
    .eq("user_id", ownerUserId)
    .order("position", { ascending: false })
    .limit(1);

  if (error) {
    throw mapSupabaseError(error, "Impossible de determiner la prochaine position.");
  }

  return (data?.[0]?.position ?? 0) + 1;
}

async function getNextLaborRolePosition(
  supabase: Supabase,
  context: Pick<AuthenticatedContext, "tenantId" | "tenantRole" | "userId">,
  ownerUserId: string = context.userId
) {
  if (
    !canAccessOwnerResource({
      context,
      resourceUserId: ownerUserId,
    })
  ) {
    throw forbidden("Acces interdit aux ressources de cet utilisateur.");
  }

  const { data, error } = await supabase
    .from("labor_roles")
    .select("position")
    .eq("tenant_id", context.tenantId)
    .eq("user_id", ownerUserId)
    .order("position", { ascending: false })
    .limit(1);

  if (error) {
    throw mapSupabaseError(error, "Impossible de determiner la prochaine position.");
  }

  return (data?.[0]?.position ?? 0) + 1;
}

async function getNextSuggestionRulePosition(
  supabase: Supabase,
  context: Pick<AuthenticatedContext, "tenantId" | "tenantRole" | "userId">,
  ownerUserId: string = context.userId
) {
  if (
    !canAccessOwnerResource({
      context,
      resourceUserId: ownerUserId,
    })
  ) {
    throw forbidden("Acces interdit aux ressources de cet utilisateur.");
  }

  const { data, error } = await supabase
    .from("estimate_suggestion_rules")
    .select("position")
    .eq("tenant_id", context.tenantId)
    .eq("user_id", ownerUserId)
    .order("position", { ascending: false })
    .limit(1);

  if (error) {
    throw mapSupabaseError(error, "Impossible de determiner la prochaine position.");
  }

  return (data?.[0]?.position ?? 0) + 1;
}

export async function listEstimateProjectVersions(input: {
  projectId: string;
  page?: number;
  pageSize?: number;
  anchorVersionId?: string;
}): Promise<ListEstimateProjectVersionsResult> {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;
  const pageSize = normalizePositiveInteger({
    value: input.pageSize,
    fallback: DEFAULT_VERSION_TIMELINE_PAGE_SIZE,
    min: 1,
    max: MAX_VERSION_TIMELINE_PAGE_SIZE,
  });

  const { data: projectData, error: projectError } = await supabase
    .from("estimate_projects")
    .select("id, tenant_id, user_id")
    .eq("id", input.projectId)
    .eq("tenant_id", tenantId)
    .single();

  if (projectError || !projectData) {
    throw notFound("Projet de chiffrage introuvable.");
  }

  const project = projectData as EstimateProjectOwnerRow;
  if (
    project.tenant_id !== tenantId ||
    !canAccessEstimateReadResource({
      context,
      resourceUserId: project.user_id,
    })
  ) {
    throw notFound("Projet de chiffrage introuvable.");
  }

  let page = normalizePositiveInteger({
    value: input.page,
    fallback: 1,
    min: 1,
  });

  if (input.page === undefined && input.anchorVersionId) {
    const { data: anchorData, error: anchorError } = await supabase
      .from("estimate_versions")
      .select("version_number")
      .eq("tenant_id", tenantId)
      .eq("project_id", input.projectId)
      .eq("id", input.anchorVersionId)
      .maybeSingle();

    if (anchorError) {
      throw mapSupabaseError(
        anchorError,
        "Impossible de determiner la position de la version courante."
      );
    }

    if (anchorData?.version_number !== undefined) {
      const { count: newerCount, error: newerCountError } = await supabase
        .from("estimate_versions")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("project_id", input.projectId)
        .gt("version_number", anchorData.version_number);

      if (newerCountError) {
        throw mapSupabaseError(
          newerCountError,
          "Impossible de determiner la pagination des versions."
        );
      }

      page = Math.floor((newerCount ?? 0) / pageSize) + 1;
    }
  }

  const { count: totalCountRaw, error: totalCountError } = await supabase
    .from("estimate_versions")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("project_id", input.projectId);

  if (totalCountError) {
    throw mapSupabaseError(
      totalCountError,
      "Impossible de charger le total des versions."
    );
  }

  const totalCount = totalCountRaw ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(page, totalPages);
  const rangeStart = (safePage - 1) * pageSize;
  const rangeEnd = rangeStart + pageSize - 1;

  const { data: versionsData, error: versionsError } = await supabase
    .from("estimate_versions")
    .select(
      "id, project_id, version_number, status, title, updated_at, created_at, total_ttc_cents, total_ht_cents, parent_version_id, variant_label"
    )
    .eq("tenant_id", tenantId)
    .eq("project_id", input.projectId)
    .order("version_number", { ascending: false })
    .order("updated_at", { ascending: false })
    .range(rangeStart, rangeEnd);

  if (versionsError) {
    throw mapSupabaseError(versionsError, "Impossible de charger les versions.");
  }

  const rows = (versionsData ?? []) as EstimateProjectVersionTimelineRow[];
  const versionIds = rows.map((row) => row.id);
  const latestAuditUserByVersionId = new Map<string, string>();

  if (versionIds.length > 0) {
    const { data: auditData, error: auditError } = await supabase
      .from("audit_logs")
      .select("record_id, user_id, created_at")
      .eq("tenant_id", tenantId)
      .eq("table_name", "estimate_versions")
      .in("record_id", versionIds)
      .order("created_at", { ascending: false });

    if (auditError) {
      throw mapSupabaseError(auditError, "Impossible de charger les auteurs.");
    }

    for (const row of (auditData ?? []) as EstimateVersionAuditActorRow[]) {
      if (!row.user_id) continue;
      if (latestAuditUserByVersionId.has(row.record_id)) continue;
      latestAuditUserByVersionId.set(row.record_id, row.user_id);
    }
  }

  const authorIds = new Set<string>();
  authorIds.add(project.user_id);
  latestAuditUserByVersionId.forEach((authorId) => {
    authorIds.add(authorId);
  });

  const authorNameById = new Map<string, string>();
  const uniqueAuthorIds = Array.from(authorIds);

  if (uniqueAuthorIds.length > 0) {
    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", uniqueAuthorIds);

    if (profileError) {
      throw mapSupabaseError(profileError, "Impossible de charger les profils.");
    }

    for (const row of (profileData ?? []) as ProfileNameRow[]) {
      const fullName = row.full_name.trim();
      if (fullName.length > 0) {
        authorNameById.set(row.id, fullName);
      }
    }
  }

  const items: EstimateProjectVersionTimelineItem[] = rows.map((row) => {
    const authorId = latestAuditUserByVersionId.get(row.id) ?? project.user_id;

    return {
      id: row.id,
      project_id: row.project_id,
      version_number: row.version_number,
      status: row.status,
      title: row.title,
      updated_at: row.updated_at,
      created_at: row.created_at,
      total_ttc_cents: row.total_ttc_cents,
      total_ht_cents: row.total_ht_cents,
      parent_version_id: row.parent_version_id ?? null,
      variant_label: toNullableText(row.variant_label) ?? null,
      author_name: authorNameById.get(authorId) ?? null,
    };
  });

  return {
    items,
    pagination: {
      page: safePage,
      page_size: pageSize,
      total_count: totalCount,
      total_pages: totalPages,
      has_prev: safePage > 1,
      has_next: safePage < totalPages,
    },
  };
}

export async function listEstimateProjectDraftVersions(
  versionId: string
): Promise<ListEstimateProjectDraftVersionsResult> {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;
  const { version } = await getVersionAccessOrThrow(supabase, versionId, context);

  const { data: draftVersionsData, error: draftVersionsError } = await supabase
    .from("estimate_versions")
    .select("id, project_id, version_number, status, title, updated_at")
    .eq("tenant_id", tenantId)
    .eq("project_id", version.project_id)
    .eq("status", "draft")
    .order("version_number", { ascending: false })
    .order("updated_at", { ascending: false });

  if (draftVersionsError) {
    throw mapSupabaseError(
      draftVersionsError,
      "Impossible de charger les versions brouillon."
    );
  }

  const items = ((draftVersionsData ?? []) as EstimateProjectDraftVersionRow[]).map(
    (row): EstimateProjectDraftVersionItem => ({
      id: row.id,
      project_id: row.project_id,
      version_number: row.version_number,
      status: row.status,
      title: row.title,
      updated_at: row.updated_at,
    })
  );

  return { items };
}

export async function listEstimateImportSources(
  query?: ListEstimateImportSourcesQueryInput
): Promise<ListEstimateImportSourcesResult> {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;

  let request = supabase
    .from("estimate_versions")
    .select(
      "id, project_id, version_number, status, title, updated_at, total_ht_cents, estimate_projects!inner(id, tenant_id, user_id, name, is_archived)"
    )
    .eq("tenant_id", tenantId)
    .eq("estimate_projects.tenant_id", tenantId)
    .eq("estimate_projects.is_archived", false);

  if (query?.exclude_version_id) {
    request = request.neq("id", query.exclude_version_id);
  }

  if (!isTenantAdmin(context.tenantRole)) {
    request = request.eq("estimate_projects.user_id", context.userId);
  }

  const { data, error } = await request
    .order("updated_at", { ascending: false })
    .order("version_number", { ascending: false });

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de charger les devis sources pour l'import."
    );
  }

  const rows = (data ?? []) as EstimateImportSourceVersionRow[];
  const items = rows
    .map((row): EstimateImportSourceVersionItem | null => {
      const project = resolveEmbeddedOne(row.estimate_projects);
      if (!project) return null;

      const hasAccess = canAccessOwnerResource({
        context,
        resourceUserId: project.user_id,
      });
      if (!hasAccess) return null;

      return {
        id: row.id,
        project_id: row.project_id,
        project_name: project.name,
        version_number: row.version_number,
        status: row.status,
        title: row.title,
        updated_at: row.updated_at,
        total_ht_cents: row.total_ht_cents ?? 0,
      };
    })
    .filter((row): row is EstimateImportSourceVersionItem => row !== null);

  return {
    items,
  };
}

export async function listEstimateImportSections(
  sourceVersionId: string
): Promise<ListEstimateImportSectionsResult> {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;
  await getVersionAccessOrThrow(supabase, sourceVersionId, context);

  const { data: sourceItemsData, error: sourceItemsError } = await supabase
    .from("estimate_items")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("version_id", sourceVersionId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (sourceItemsError) {
    throw mapSupabaseError(
      sourceItemsError,
      "Impossible de charger les sections source."
    );
  }

  const sourceItems = (sourceItemsData ?? []) as EstimateItemRow[];
  const rootSections = sourceItems.filter(
    (item) => item.item_type === "section" && item.parent_id === null
  );

  const items = rootSections
    .map((section): EstimateImportSectionPreviewItem | null => {
      const subtree = collectSectionSubtreeItems(section.id, sourceItems);
      if (!subtree) return null;

      const lineItems = subtree.orderedSubtreeItems.filter(
        (item) => item.item_type === "line"
      );

      return {
        id: section.id,
        title: toNullableText(section.title) ?? "Section sans titre",
        line_count: lineItems.length,
        total_ht_cents: lineItems.reduce(
          (sum, item) => sum + (item.line_total_ht_cents ?? 0),
          0
        ),
        position: section.position,
      };
    })
    .filter((section): section is EstimateImportSectionPreviewItem => section !== null)
    .sort((left, right) => left.position - right.position);

  return {
    source_version_id: sourceVersionId,
    items,
  };
}

export async function getAffaireLinkedDpgfSource(
  projectId: string
): Promise<AffaireLinkedDpgfSourceResult> {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;

  const { data: projectData, error: projectError } = await supabase
    .from("estimate_projects")
    .select("id, tenant_id, user_id, is_archived")
    .eq("id", projectId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (projectError) {
    throw mapSupabaseError(projectError, "Impossible de charger l'affaire.");
  }

  const project = (projectData ??
    null) as Pick<
    EstimateProjectRow,
    "id" | "tenant_id" | "user_id" | "is_archived"
  > | null;

  if (
    !project ||
    project.is_archived ||
    !canAccessOwnerResource({
      context,
      resourceUserId: project.user_id,
    })
  ) {
    throw notFound("Affaire introuvable.");
  }

  const latestImport = await loadLatestLinkedDpgfImportForProject({
    supabase,
    tenantId,
    projectId: project.id,
  });

  if (!latestImport) {
    return null;
  }

  const [latestMapping, mappedRowCount] = await Promise.all([
    loadLatestDpgfMappingForImport({
      supabase,
      tenantId,
      importId: latestImport.id,
    }),
    countMappedRowsForImport({
      supabase,
      tenantId,
      importId: latestImport.id,
    }),
  ]);

  return {
    import_id: latestImport.id,
    filename: latestImport.filename,
    source_format: latestImport.source_format,
    import_status: latestImport.status,
    mapping_status: latestMapping?.status ?? null,
    imported_at: latestImport.created_at,
    mapping_updated_at: latestMapping?.updated_at ?? null,
    parse_mode: latestImport.parse_mode,
    row_count: latestImport.row_count ?? 0,
    mapped_row_count: mappedRowCount,
  };
}

export async function listEstimateVersionVariants(
  versionId: string
): Promise<ListEstimateVersionVariantsResult> {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;
  const { data, error } = await supabase
    .from("estimate_versions")
    .select(
      "id, project_id, status, margin_mode, margin_multiplier, max_section_depth, tax_rate_bp, updated_at, total_ht_cents, total_tax_cents, total_ttc_cents, parent_version_id, variant_label, estimate_projects!inner(id, tenant_id, user_id, name, reference, estimate_reference, client_name, notes, is_archived)"
    )
    .eq("id", versionId)
    .eq("tenant_id", tenantId)
    .single();

  if (error || !data) {
    throw notFound("Version de chiffrage introuvable.");
  }

  const version = data as unknown as VersionAccessRow;
  const project = resolveEmbeddedOne(version.estimate_projects);

  if (
    !project ||
    project.tenant_id !== tenantId ||
    !canAccessEstimateReadResource({
      context,
      resourceUserId: project.user_id,
    })
  ) {
    throw notFound("Version de chiffrage introuvable.");
  }

  const baseVersionId = version.parent_version_id ?? version.id;

  const { data: versionsData, error: versionsError } = await supabase
    .from("estimate_versions")
    .select(
      "id, project_id, version_number, status, title, total_ht_cents, total_tax_cents, total_ttc_cents, updated_at, parent_version_id, variant_label"
    )
    .eq("tenant_id", tenantId)
    .eq("project_id", version.project_id);

  if (versionsError) {
    throw mapSupabaseError(
      versionsError,
      "Impossible de charger les variantes de cette version."
    );
  }

  const allRows = (versionsData ?? []) as EstimateVariantComparisonRow[];
  if (allRows.length === 0) {
    throw notFound("Version de chiffrage introuvable.");
  }

  const allRowsById = new Map(allRows.map((row) => [row.id, row]));
  const baseRow = allRowsById.get(baseVersionId);

  if (!baseRow) {
    throw notFound("Version de chiffrage introuvable.");
  }

  const childrenByParentId = new Map<string, EstimateVariantComparisonRow[]>();
  for (const row of allRows) {
    const parentVersionId = row.parent_version_id ?? null;
    if (!parentVersionId) continue;

    const existingChildren = childrenByParentId.get(parentVersionId);
    if (existingChildren) {
      existingChildren.push(row);
      continue;
    }

    childrenByParentId.set(parentVersionId, [row]);
  }

  const descendantRows: EstimateVariantComparisonRow[] = [];
  const visitedVersionIds = new Set<string>([baseVersionId]);
  const pendingParentIds: string[] = [baseVersionId];

  while (pendingParentIds.length > 0) {
    const currentParentId = pendingParentIds.pop();
    if (!currentParentId) continue;

    const directChildren = childrenByParentId.get(currentParentId) ?? [];
    for (const child of directChildren) {
      if (visitedVersionIds.has(child.id)) continue;

      visitedVersionIds.add(child.id);
      descendantRows.push(child);
      pendingParentIds.push(child.id);
    }
  }

  const rows = [baseRow, ...descendantRows];

  const lineCountByVersionId = new Map<string, number>();
  const versionIds = rows.map((row) => row.id);

  if (versionIds.length > 0) {
    const { data: lineItemsData, error: lineItemsError } = await supabase
      .from("estimate_items")
      .select("version_id")
      .eq("tenant_id", tenantId)
      .eq("item_type", "line")
      .in("version_id", versionIds);

    if (lineItemsError) {
      throw mapSupabaseError(
        lineItemsError,
        "Impossible de charger le nombre de lignes des variantes."
      );
    }

    for (const row of (lineItemsData ?? []) as Array<{ version_id: string }>) {
      lineCountByVersionId.set(
        row.version_id,
        (lineCountByVersionId.get(row.version_id) ?? 0) + 1
      );
    }
  }

  const items = rows
    .map((row): EstimateVariantComparisonItem => ({
      id: row.id,
      project_id: row.project_id,
      version_number: row.version_number,
      status: row.status,
      title: row.title,
      total_ht_cents: row.total_ht_cents ?? 0,
      total_tax_cents: row.total_tax_cents ?? 0,
      total_ttc_cents: row.total_ttc_cents ?? 0,
      line_count: lineCountByVersionId.get(row.id) ?? 0,
      updated_at: row.updated_at,
      parent_version_id: row.parent_version_id ?? null,
      variant_label: toNullableText(row.variant_label) ?? null,
    }))
    .sort((left, right) => {
      if (left.id === baseVersionId) return -1;
      if (right.id === baseVersionId) return 1;

      const leftLabel = left.variant_label ?? "";
      const rightLabel = right.variant_label ?? "";

      if (leftLabel && rightLabel) {
        const leftLabelIndex = variantLabelToSequenceIndex(leftLabel);
        const rightLabelIndex = variantLabelToSequenceIndex(rightLabel);

        if (leftLabelIndex !== null && rightLabelIndex !== null) {
          if (leftLabelIndex !== rightLabelIndex) {
            return leftLabelIndex - rightLabelIndex;
          }
        } else if (leftLabelIndex !== null) {
          return -1;
        } else if (rightLabelIndex !== null) {
          return 1;
        }

        const labelCompare = leftLabel.localeCompare(rightLabel, "fr", {
          sensitivity: "base",
        });
        if (labelCompare !== 0) {
          return labelCompare;
        }
      }

      if (leftLabel) return -1;
      if (rightLabel) return 1;

      if (left.version_number !== right.version_number) {
        return left.version_number - right.version_number;
      }

      const updatedAtDelta =
        new Date(left.updated_at).getTime() - new Date(right.updated_at).getTime();
      if (updatedAtDelta !== 0) {
        return updatedAtDelta;
      }

      return left.id.localeCompare(right.id);
    });

  return {
    base_version_id: baseVersionId,
    items,
  };
}

export async function listLatestEstimates() {
  const { supabase, userId, tenantId, tenantRole } = await getAuthenticatedContext();

  let query = supabase
    .from("estimate_versions")
    .select(
      "id, project_id, version_number, status, title, updated_at, total_ht_cents, date_devis, currency, validite_jours, estimate_projects!inner(id, name, reference, client_name, is_archived)"
    )
    .eq("tenant_id", tenantId)
    .eq("estimate_projects.tenant_id", tenantId)
    .eq("estimate_projects.is_archived", false);

  if (!isTenantAdmin(tenantRole)) {
    query = query.eq("estimate_projects.user_id", userId);
  }

  const { data, error } = await query
    .order("version_number", { ascending: false })
    .order("updated_at", { ascending: false });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger la liste des chiffrages.");
  }

  const rows = (data ?? []) as unknown as EstimateListRow[];
  const latestByProject = new Map<
    string,
    {
      project_id: string;
      project_name: string;
      project_reference: string | null;
      project_client_name: string | null;
      version_id: string;
      version_number: number;
      status: EstimateStatus;
      title: string | null;
      updated_at: string;
      total_ht_cents: number;
      date_devis: string | null;
      currency: string;
      validite_jours: number | null;
    }
  >();

  rows.forEach((row) => {
    const project = resolveEmbeddedOne(row.estimate_projects);
    if (!project) return;
    if (latestByProject.has(row.project_id)) return;

    latestByProject.set(row.project_id, {
      project_id: row.project_id,
      project_name: project.name,
      project_reference: project.reference,
      project_client_name: project.client_name,
      version_id: row.id,
      version_number: row.version_number,
      status: row.status,
      title: row.title,
      updated_at: row.updated_at,
      total_ht_cents: row.total_ht_cents,
      date_devis: row.date_devis ?? null,
      currency: normalizeEstimateCurrencyOrThrow(row.currency, {
        fallback: DEFAULT_CURRENCY,
        fallbackOnInvalid: true,
      }),
      validite_jours: row.validite_jours ?? null,
    });
  });

  const items = Array.from(latestByProject.values()).sort((left, right) => {
    return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
  });

  return {
    items,
  };
}

export async function listEstimateTemplates(query: ListEstimateTemplatesQueryInput) {
  const { supabase, tenantId } = await getAuthenticatedContext();

  let templatesQuery = supabase
    .from("estimate_templates")
    .select("*")
    .eq("tenant_id", tenantId);

  const search = toNullableText(query.search);
  if (search) {
    templatesQuery = templatesQuery.or(
      `name.ilike.%${search}%,description.ilike.%${search}%`
    );
  }

  const { data, error } = await templatesQuery
    .order("updated_at", { ascending: query.order === "oldest" })
    .limit(query.limit);

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les templates.");
  }

  const templates = (data ?? []) as unknown as EstimateTemplateRow[];
  const lineCountByTemplateId = await loadTemplateLineCountByTemplateId({
    supabase,
    tenantId,
    templateIds: templates.map((template) => template.id),
  });

  return {
    templates: templates.map((template) =>
      toTemplateSummary(template, lineCountByTemplateId.get(template.id) ?? 0)
    ),
  };
}

export async function getEstimateTemplate(templateId: string) {
  const { supabase, tenantId } = await getAuthenticatedContext();

  const template = await loadEstimateTemplateOrThrow({
    supabase,
    tenantId,
    templateId,
  });
  const items = await loadEstimateTemplateItems({
    supabase,
    tenantId,
    templateId,
  });
  const lineCount = items.filter((item) => item.item_type === "line").length;

  return {
    template: {
      ...toTemplateSummary(template, lineCount),
      items,
    },
  };
}

export async function createEstimateTemplateFromVersion(
  input: CreateEstimateTemplateFromVersionInput
) {
  const { supabase, tenantId } = await getAuthenticatedContext();

  const { data, error } = await supabase.rpc(
    "create_estimate_template_from_version",
    {
      p_source_version_id: input.source_version_id,
      p_name: input.name.trim(),
      p_description: toNullableText(input.description),
    }
  );

  if (error) {
    throwTemplateNameConflictIfNeeded(error);
    throwTemplateSourceVersionNotFoundIfNeeded(error);
    throw mapSupabaseError(error, "Impossible de creer le template.");
  }

  const templateId = toRpcUuid(data);
  if (!templateId) {
    throw badRequest("Impossible de creer le template.");
  }

  const template = await loadEstimateTemplateOrThrow({
    supabase,
    tenantId,
    templateId,
  });
  const lineCountByTemplateId = await loadTemplateLineCountByTemplateId({
    supabase,
    tenantId,
    templateIds: [template.id],
  });

  return {
    template: toTemplateSummary(
      template,
      lineCountByTemplateId.get(template.id) ?? 0
    ),
  };
}

export async function updateEstimateTemplate(
  templateId: string,
  input: UpdateEstimateTemplateInput
) {
  const { supabase, tenantId } = await getAuthenticatedContext();

  await loadEstimateTemplateOrThrow({
    supabase,
    tenantId,
    templateId,
  });

  const payload: Record<string, unknown> = {};

  if ("name" in input) {
    payload.name = (input.name ?? "").trim();
  }
  if ("description" in input) {
    payload.description = toNullableText(input.description);
  }

  const { data, error } = await supabase
    .from("estimate_templates")
    .update(payload)
    .eq("tenant_id", tenantId)
    .eq("id", templateId)
    .select("*")
    .single();

  if (error || !data) {
    if (error) {
      throwTemplateNameConflictIfNeeded(error);
      throw mapSupabaseError(error, "Impossible de mettre a jour le template.");
    }
    throw badRequest("Impossible de mettre a jour le template.");
  }

  const updatedTemplate = data as unknown as EstimateTemplateRow;
  const lineCountByTemplateId = await loadTemplateLineCountByTemplateId({
    supabase,
    tenantId,
    templateIds: [updatedTemplate.id],
  });

  return {
    template: toTemplateSummary(
      updatedTemplate,
      lineCountByTemplateId.get(updatedTemplate.id) ?? 0
    ),
  };
}

export async function deleteEstimateTemplate(templateId: string) {
  const { supabase, tenantId } = await getAuthenticatedContext();

  await loadEstimateTemplateOrThrow({
    supabase,
    tenantId,
    templateId,
  });

  const { error: deleteItemsError } = await supabase
    .from("estimate_template_items")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("template_id", templateId);

  if (deleteItemsError) {
    throw mapSupabaseError(deleteItemsError, "Impossible de supprimer le template.");
  }

  const { error: deleteTemplateError } = await supabase
    .from("estimate_templates")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", templateId);

  if (deleteTemplateError) {
    throw mapSupabaseError(deleteTemplateError, "Impossible de supprimer le template.");
  }

  return {
    deleted_id: templateId,
  };
}

export async function duplicateEstimateTemplate(
  templateId: string,
  input: DuplicateEstimateTemplateInput
) {
  const { supabase, tenantId } = await getAuthenticatedContext();

  const { data, error } = await supabase.rpc("duplicate_estimate_template", {
    p_template_id: templateId,
    p_name: toNullableText(input.name) ?? "",
  });

  if (error) {
    throwTemplateNameConflictIfNeeded(error);
    throwTemplateNotFoundIfNeeded(error);
    throw mapSupabaseError(error, "Impossible de dupliquer le template.");
  }

  const duplicatedTemplateId = toRpcUuid(data);
  if (!duplicatedTemplateId) {
    throw badRequest("Impossible de dupliquer le template.");
  }

  const duplicatedTemplate = await loadEstimateTemplateOrThrow({
    supabase,
    tenantId,
    templateId: duplicatedTemplateId,
  });
  const lineCountByTemplateId = await loadTemplateLineCountByTemplateId({
    supabase,
    tenantId,
    templateIds: [duplicatedTemplate.id],
  });

  return {
    template: toTemplateSummary(
      duplicatedTemplate,
      lineCountByTemplateId.get(duplicatedTemplate.id) ?? 0
    ),
  };
}

async function tryCarryOverTakeoffJobsToNewVersion(input: {
  supabase: Supabase;
  tenantId: string;
  userId: string;
  sourceVersionId: string | null;
  targetVersionId: string;
}) {
  if (!input.sourceVersionId) {
    return;
  }

  try {
    await linkTakeoffJobsFromSourceVersionToTargetVersion({
      supabase: input.supabase,
      tenantId: input.tenantId,
      userId: input.userId,
      sourceVersionId: input.sourceVersionId,
      targetVersionId: input.targetVersionId,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Unexpected table:")
    ) {
      return;
    }

    console.warn("takeoff carry-over skipped", {
      sourceVersionId: input.sourceVersionId,
      targetVersionId: input.targetVersionId,
      error,
    });
  }
}

async function resolveLatestProjectVersionId(input: {
  supabase: Supabase;
  tenantId: string;
  projectId: string;
}): Promise<string | null> {
  const { data, error } = await input.supabase
    .from("estimate_versions")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .order("version_number", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger la version courante du projet.");
  }

  return data?.id ?? null;
}

export async function instantiateEstimateFromTemplate(
  templateId: string,
  input: InstantiateEstimateFromTemplateInput
) {
  const { supabase, tenantId, userId } = await getAuthenticatedContext();
  const targetProjectId = input.project_id ?? null;
  const projectName = toNullableText(input.project_name);

  if (!targetProjectId && !projectName) {
    throw badRequest(
      "project_name ou project_id est requis.",
      undefined,
      "ESTIMATE_TEMPLATE_PROJECT_REQUIRED"
    );
  }

  const rpcName = targetProjectId
    ? "instantiate_estimate_template_into_project"
    : "instantiate_estimate_from_template";
  const sourceVersionIdForCarryOver = targetProjectId
    ? await resolveLatestProjectVersionId({
        supabase,
        tenantId,
        projectId: targetProjectId,
      })
    : null;

  const rpcPayload = targetProjectId
    ? {
        p_template_id: templateId,
        p_project_id: targetProjectId,
        p_version_title: toNullableText(input.version_title),
        p_date_devis: input.date_devis ?? null,
        p_validite_jours: input.validite_jours ?? null,
      }
    : {
        p_template_id: templateId,
        p_project_name: projectName!,
        p_version_title: toNullableText(input.version_title),
        p_date_devis: input.date_devis ?? null,
        p_validite_jours: input.validite_jours ?? null,
      };

  const { data, error } = await supabase.rpc(rpcName, rpcPayload);

  if (error) {
    throwTemplateNotFoundIfNeeded(error);
    throwTemplateTargetProjectNotFoundIfNeeded(error);
    throw internalError(
      "Impossible d'instancier le template.",
      error,
      "ESTIMATE_TEMPLATE_INSTANTIATE_FAILED"
    );
  }

  const row = Array.isArray(data) ? data[0] : data;
  const projectId =
    row && typeof row === "object" && "project_id" in row
      ? toRpcUuid((row as { project_id?: unknown }).project_id)
      : null;
  const versionId =
    row && typeof row === "object" && "version_id" in row
      ? toRpcUuid((row as { version_id?: unknown }).version_id)
      : null;

  if (!projectId || !versionId) {
    throw internalError(
      "Impossible d'instancier le template.",
      { data },
      "ESTIMATE_TEMPLATE_INSTANTIATE_FAILED"
    );
  }

  const projectNotes = toNullableText(input.project_notes);
  if (projectNotes && !targetProjectId) {
    const { error: projectUpdateError } = await supabase
      .from("estimate_projects")
      .update({
        notes: projectNotes,
      })
      .eq("id", projectId)
      .eq("tenant_id", tenantId);

    if (projectUpdateError) {
      throw mapSupabaseError(projectUpdateError, "Impossible d'instancier le template.");
    }
  }

  await tryCarryOverTakeoffJobsToNewVersion({
    supabase,
    tenantId,
    userId,
    sourceVersionId: sourceVersionIdForCarryOver,
    targetVersionId: versionId,
  });

  return {
    projectId,
    versionId,
    redirectTo: `/dashboard/estimates/${versionId}/edit`,
  };
}

export async function listEstimateAssemblies(
  query: ListEstimateAssembliesQueryInput
) {
  const { supabase, tenantId, userId } = await getAuthenticatedContext();

  let assembliesQuery = supabase
    .from("estimate_assemblies")
    .select("*")
    .eq("tenant_id", tenantId);

  const search = toNullableText(query.search);
  if (search) {
    assembliesQuery = assembliesQuery.or(
      `name.ilike.%${search}%,description.ilike.%${search}%`
    );
  }

  const { data, error } = await assembliesQuery
    .order("updated_at", { ascending: query.order === "oldest" })
    .limit(query.limit);

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les ouvrages.");
  }

  const assemblies = (data ?? []) as EstimateAssemblyRow[];
  const itemCountByAssemblyId = await loadAssemblyItemCountByAssemblyId({
    supabase,
    tenantId,
    assemblyIds: assemblies.map((assembly) => assembly.id),
  });
  const memberCountByAssemblyId = await loadAssemblyMemberCountByAssemblyId({
    supabase,
    tenantId,
    assemblyIds: assemblies.map((assembly) => assembly.id),
  });
  const { data: laborRoles, error: laborRolesError } = await supabase
    .from("labor_roles")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("position", { ascending: true });

  if (laborRolesError) {
    throw mapSupabaseError(laborRolesError, "Impossible de charger les rôles de main-d’œuvre.");
  }

  const { data: supplyTypes, error: supplyTypesError } = await supabase
    .from("supply_types")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });

  if (supplyTypesError) {
    throw mapSupabaseError(
      supplyTypesError,
      "Impossible de charger les types de fourniture."
    );
  }
  return {
    assemblies: assemblies.map((assembly) =>
      toAssemblySummary(
        assembly,
        itemCountByAssemblyId.get(assembly.id) ?? 0,
        memberCountByAssemblyId.get(assembly.id) ?? 0
      )
    ),
    labor_roles: (laborRoles ?? []) as LaborRoleRow[],
    supply_types: (supplyTypes ?? []) as SupplyTypeRow[],
  };
}

export async function getEstimateAssembly(assemblyId: string) {
  const { supabase, tenantId } = await getAuthenticatedContext();

  const assembly = await loadEstimateAssemblyOrThrow({
    supabase,
    tenantId,
    assemblyId,
  });
  const items = await loadEstimateAssemblyItems({
    supabase,
    tenantId,
    assemblyId,
  });
  const members = await loadEstimateAssemblyMembers({
    supabase,
    tenantId,
    assemblyId,
  });

  return {
    assembly: {
      ...toAssemblySummary(assembly, items.length, members.length),
      items,
      members,
    },
  };
}

export function computeAssemblyMetrics(
  items: CreateEstimateAssemblyInput["items"],
  laborRatesById: ReadonlyMap<string, number> = new Map()
) {
  let directCostCents = 0;
  let laborHours = 0;

  items.forEach((item) => {
    const quantity = Math.max(item.default_quantity ?? 0, 0);
    const unitCostCents = Math.max(item.unit_cost_ht_cents ?? 0, 0);
    const isLabor = (item.cost_type ?? "material") === "labor";
    const itemLaborHours = Math.max(
      item.h_mo ?? (isLabor ? quantity : 0),
      0
    );
    const supplyCostCents = isLabor
      ? 0
      : quantity * unitCostCents * Math.max(item.k_fo ?? 1, 0);
    const selectedLaborRate = item.labor_role_id
      ? laborRatesById.get(item.labor_role_id)
      : undefined;
    const laborRateCents =
      selectedLaborRate !== undefined
        ? selectedLaborRate
        : isLabor
          ? unitCostCents
          : 0;
    const laborCostCents =
      itemLaborHours * laborRateCents * Math.max(item.k_mo ?? 1, 0);

    directCostCents += Math.round(supplyCostCents + laborCostCents);
    laborHours += itemLaborHours;
  });

  return {
    directCostCents,
    laborHours: laborHours > 0 ? laborHours : null,
  };
}
export async function createEstimateAssembly(input: CreateEstimateAssemblyInput) {
  const { supabase, tenantId, userId, tenantRole } = await getAuthenticatedContext();
  assertCanWriteEstimateWorkflows(tenantRole);

  const laborRoleIds = Array.from(
    new Set(
      input.items
        .map((item) => item.labor_role_id)
        .filter((roleId): roleId is string => Boolean(roleId))
    )
  );
  const laborRatesById = new Map<string, number>();
  if (laborRoleIds.length > 0) {
    const { data: laborRoles, error: laborRolesError } = await supabase
      .from("labor_roles")
      .select("id, hourly_rate_cents")
      .eq("tenant_id", tenantId)
      .in("id", laborRoleIds);

    if (laborRolesError) {
      throw mapSupabaseError(
        laborRolesError,
        "Impossible de charger les taux de main-d’œuvre."
      );
    }
    (laborRoles ?? []).forEach((role) => {
      laborRatesById.set(role.id, role.hourly_rate_cents);
    });
  }

  const supplyTypeIds = Array.from(
    new Set(
      input.items
        .map((item) => item.supply_type_id)
        .filter((typeId): typeId is string => Boolean(typeId))
    )
  );
  if (supplyTypeIds.length > 0) {
    const { data: supplyTypes, error: supplyTypesError } = await supabase
      .from("supply_types")
      .select("id")
      .eq("tenant_id", tenantId)
      .in("id", supplyTypeIds);

    if (supplyTypesError) {
      throw mapSupabaseError(
        supplyTypesError,
        "Impossible de vérifier les types de fourniture."
      );
    }
    if ((supplyTypes ?? []).length !== supplyTypeIds.length) {
      throw badRequest("supply_type_id invalide.");
    }
  }
  const metrics = computeAssemblyMetrics(input.items, laborRatesById);
  const { data: assemblyData, error: assemblyError } = await supabase
    .from("estimate_assemblies")
    .insert({
      tenant_id: tenantId,
      created_by: userId,
      name: input.name.trim(),
      description: toNullableText(input.description),
      reference_code: toNullableText(input.reference_code),
      unit: toNullableText(input.unit),
      pricing_source: "manual",
      ds_cents: metrics.directCostCents,
      indicative_target_price_cents: 0,
      avg_time_hours: metrics.laborHours,
    } as EstimateAssemblyInsert)
    .select("*")
    .single();

  if (assemblyError || !assemblyData) {
    if (assemblyError) {
      throwAssemblyNameConflictIfNeeded(assemblyError);
      throw mapSupabaseError(assemblyError, "Impossible de creer l'ouvrage.");
    }
    throw badRequest("Impossible de creer l'ouvrage.");
  }

  const assembly = assemblyData as EstimateAssemblyRow;
  const itemsPayload: EstimateAssemblyItemInsert[] = input.items.map((item) => ({
    tenant_id: tenantId,
    assembly_id: assembly.id,
    title: item.title.trim(),
    unit: toNullableText(item.unit),
    k_fo: item.k_fo ?? 1,
    k_mo: item.k_mo ?? 1,
    labor_role_id: item.labor_role_id ?? null,
    supply_type_id: item.supply_type_id ?? null,
    default_quantity: item.default_quantity ?? null,
    h_mo:
      item.h_mo ??
      ((item.cost_type ?? "material") === "labor"
        ? Math.max(item.default_quantity ?? 0, 0)
        : 0),
    position: item.position,
    cost_type: item.cost_type ?? "material",
    unit_cost_ht_cents: item.unit_cost_ht_cents ?? 0,
    loss_coeff_bp: item.loss_coeff_bp ?? 0,
    yield_value: item.yield_value ?? null,
    yield_unit: toNullableText(item.yield_unit),
    source_metadata: (item.source_metadata ?? {}) as Json,
  }));

  const membersPayload: EstimateAssemblyMemberInsert[] = input.members.map(
    (member) => ({
      tenant_id: tenantId,
      parent_assembly_id: assembly.id,
      child_assembly_id: member.child_assembly_id,
      quantity: member.quantity,
      position: member.position,
    })
  );

  const { error: contentsError } = await supabase.rpc(
    "replace_estimate_assembly_contents",
    {
      p_assembly_id: assembly.id,
      p_items: itemsPayload as unknown as Json,
      p_members: membersPayload as unknown as Json,
    }
  );

  if (contentsError) {
    await supabase
      .from("estimate_assemblies")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("id", assembly.id);

    throwAssemblyCompositionErrorIfNeeded(contentsError);
    throw mapSupabaseError(contentsError, "Impossible de creer l'ouvrage.");
  }

  const [savedAssembly, insertedItems, insertedMembers] = await Promise.all([
    loadEstimateAssemblyOrThrow({
      supabase,
      tenantId,
      assemblyId: assembly.id,
    }),
    loadEstimateAssemblyItems({
      supabase,
      tenantId,
      assemblyId: assembly.id,
    }),
    loadEstimateAssemblyMembers({
      supabase,
      tenantId,
      assemblyId: assembly.id,
    }),
  ]);

  return {
    assembly: {
      ...toAssemblySummary(
        savedAssembly,
        insertedItems.length,
        insertedMembers.length
      ),
      items: insertedItems,
      members: insertedMembers,
    },
  };
}

export async function updateEstimateAssembly(
  assemblyId: string,
  input: UpdateEstimateAssemblyInput
) {
  const { supabase, tenantId, tenantRole } = await getAuthenticatedContext();
  assertCanWriteEstimateWorkflows(tenantRole);

  await loadEstimateAssemblyOrThrow({
    supabase,
    tenantId,
    assemblyId,
  });

  const assemblyPayload: EstimateAssemblyUpdate = {};
  if ("name" in input) {
    assemblyPayload.name = (input.name ?? "").trim();
  }
  if ("description" in input) {
    assemblyPayload.description = toNullableText(input.description);
  }
  if ("reference_code" in input) {
    assemblyPayload.reference_code = toNullableText(input.reference_code);
  }
  if ("unit" in input) {
    assemblyPayload.unit = toNullableText(input.unit);
  }
  let updatedAssembly: EstimateAssemblyRow;
  if (Object.keys(assemblyPayload).length > 0) {
    const { data, error } = await supabase
      .from("estimate_assemblies")
      .update(assemblyPayload)
      .eq("tenant_id", tenantId)
      .eq("id", assemblyId)
      .select("*")
      .single();

    if (error || !data) {
      if (error) {
        throwAssemblyNameConflictIfNeeded(error);
        throw mapSupabaseError(error, "Impossible de mettre a jour l'ouvrage.");
      }
      throw badRequest("Impossible de mettre a jour l'ouvrage.");
    }
    updatedAssembly = data as EstimateAssemblyRow;
  } else {
    updatedAssembly = await loadEstimateAssemblyOrThrow({
      supabase,
      tenantId,
      assemblyId,
    });
  }

  if (
    ("items" in input && input.items) ||
    ("members" in input && input.members)
  ) {
    const requestedItems =
      input.items ??
      (await loadEstimateAssemblyItems({ supabase, tenantId, assemblyId }));
    const itemsPayload = requestedItems.map((item) => ({
      title: item.title.trim(),
      unit: toNullableText(item.unit),
      k_fo: item.k_fo ?? 1,
      k_mo: item.k_mo ?? 1,
      labor_role_id: item.labor_role_id ?? null,
      supply_type_id: item.supply_type_id ?? null,
      default_quantity: item.default_quantity ?? null,
      h_mo:
        item.h_mo ??
        ((item.cost_type ?? "material") === "labor"
          ? Math.max(item.default_quantity ?? 0, 0)
          : 0),
      position: item.position,
      cost_type: item.cost_type ?? "material",
      unit_cost_ht_cents: item.unit_cost_ht_cents ?? 0,
      loss_coeff_bp: item.loss_coeff_bp ?? 0,
      yield_value: item.yield_value ?? null,
      yield_unit: toNullableText(item.yield_unit),
      source_metadata: (item.source_metadata ?? {}) as Json,
    }));

    const requestedMembers =
      input.members ??
      (await loadEstimateAssemblyMembers({
        supabase,
        tenantId,
        assemblyId,
      }));
    const membersPayload = requestedMembers.map((member) => ({
      child_assembly_id: member.child_assembly_id,
      quantity: member.quantity,
      position: member.position,
    }));

    const { error: replaceContentsError } = await supabase.rpc(
      "replace_estimate_assembly_contents",
      {
        p_assembly_id: assemblyId,
        p_items: itemsPayload as unknown as Json,
        p_members: membersPayload as unknown as Json,
      }
    );

    if (replaceContentsError) {
      throwAssemblyCompositionErrorIfNeeded(replaceContentsError);
      throw mapSupabaseError(
        replaceContentsError,
        "Impossible de mettre a jour l'ouvrage."
      );
    }

    updatedAssembly = await loadEstimateAssemblyOrThrow({
      supabase,
      tenantId,
      assemblyId,
    });
  }

  const items = await loadEstimateAssemblyItems({
    supabase,
    tenantId,
    assemblyId,
  });
  const members = await loadEstimateAssemblyMembers({
    supabase,
    tenantId,
    assemblyId,
  });

  return {
    assembly: {
      ...toAssemblySummary(updatedAssembly, items.length, members.length),
      items,
      members,
    },
  };
}

export async function deleteEstimateAssembly(assemblyId: string) {
  const { supabase, tenantId, tenantRole } = await getAuthenticatedContext();
  assertCanWriteEstimateWorkflows(tenantRole);

  await loadEstimateAssemblyOrThrow({
    supabase,
    tenantId,
    assemblyId,
  });

  const { error } = await supabase
    .from("estimate_assemblies")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", assemblyId);

  if (error) {
    if (error.code === "23503") {
      throw conflict(
        "Cet ouvrage est utilise comme sous-ouvrage. Retirez d'abord ses references.",
        error
      );
    }
    throw mapSupabaseError(error, "Impossible de supprimer l'ouvrage.");
  }

  return {
    deleted_id: assemblyId,
  };
}

export async function insertAssemblyIntoVersion(input: {
  assemblyId: string;
  versionId: string;
  afterItemId?: string | null;
}) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version, project } = await getVersionAccessOrThrow(
    supabase,
    input.versionId,
    context
  );

  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId: input.versionId,
    userId,
  });

  const assembly = await loadEstimateAssemblyOrThrow({
    supabase,
    tenantId,
    assemblyId: input.assemblyId,
  });
  const assemblyItems = await loadEstimateAssemblyItems({
    supabase,
    tenantId,
    assemblyId: assembly.id,
  });
  const assemblyMembers = await loadEstimateAssemblyMembers({
    supabase,
    tenantId,
    assemblyId: assembly.id,
  });

  if (assemblyItems.length === 0 && assemblyMembers.length === 0) {
    throw badRequest("Cet ouvrage ne contient aucun contenu.");
  }


  const { data, error } = await supabase.rpc(
    "insert_estimate_assembly_into_version",
    {
      p_version_id: input.versionId,
      p_assembly_id: input.assemblyId,
      p_after_item_id: input.afterItemId ?? null,
    }
  );

  if (error) {
    if (errorMessageContains(error, "estimate assembly not found")) {
      throw notFound(
        "Ouvrage introuvable.",
        error,
        "ESTIMATE_ASSEMBLY_NOT_FOUND"
      );
    }
    if (errorMessageContains(error, "estimate version not found")) {
      throw notFound("Version de chiffrage introuvable.", error);
    }
    if (errorMessageContains(error, "after_item_id invalide")) {
      throw badRequest("afterItemId invalide.", error);
    }
    throw mapSupabaseError(error, "Impossible d'inserer l'ouvrage.");
  }

  const insertedItems = Array.isArray(data) ? (data as EstimateItemRow[]) : [];
  const insertedItemIds = insertedItems.map((item) => item.id);

  if (insertedItemIds.length === 0) {
    throw internalError(
      "Impossible d'inserer l'ouvrage.",
      { data },
      "ESTIMATE_ASSEMBLY_INSERT_FAILED"
    );
  }

  const laborRoleIds = insertedItems
    .map((item) => item.labor_role_id)
    .filter((value): value is string => Boolean(value));
  const validLaborRoleIds = await loadValidLaborRoleIdsForOwner({
    supabase,
    tenantId,
    ownerUserId: project.user_id,
    laborRoleIds,
  });
  const invalidLaborRoleIds = new Set(
    laborRoleIds.filter(
      (laborRoleId) => !validLaborRoleIds.has(laborRoleId)
    )
  );


  const lineIdsWithInvalidLaborRole = insertedItems
    .filter(
      (item) =>
        item.item_type === "line" &&
        item.labor_role_id &&
        invalidLaborRoleIds.has(item.labor_role_id)
    )
    .map((item) => item.id);

  if (lineIdsWithInvalidLaborRole.length > 0) {
    const { error: clearRoleError } = await supabase
      .from("estimate_items")
      .update({ labor_role_id: null })
      .eq("tenant_id", tenantId)
      .eq("version_id", input.versionId)
      .in("id", lineIdsWithInvalidLaborRole);

    if (clearRoleError) {
      throw mapSupabaseError(
        clearRoleError,
        "Impossible d'inserer l'ouvrage."
      );
    }
  }

  const { data: reloadedItems, error: reloadError } = await supabase
    .from("estimate_items")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("version_id", input.versionId)
    .in("id", insertedItemIds);

  if (reloadError) {
    throw mapSupabaseError(reloadError, "Impossible d'inserer l'ouvrage.");
  }

  const reloadedItemsById = new Map(
    ((reloadedItems ?? []) as EstimateItemRow[]).map((item) => [item.id, item])
  );
  const orderedItems = insertedItemIds
    .map((id) => reloadedItemsById.get(id))
    .filter((item): item is EstimateItemRow => Boolean(item));

  return {
    items: orderedItems,
  };
}

export async function insertTemplateIntoVersion(input: {
  templateId: string;
  versionId: string;
  afterItemId?: string | null;
}) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version } = await getVersionAccessOrThrow(
    supabase,
    input.versionId,
    context
  );

  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId: input.versionId,
    userId,
  });

  await loadEstimateTemplateOrThrow({
    supabase,
    tenantId,
    templateId: input.templateId,
  });
  const templateItems = await loadEstimateTemplateItems({
    supabase,
    tenantId,
    templateId: input.templateId,
  });

  if (templateItems.length === 0) {
    throw badRequest("Ce template ne contient aucun element.");
  }

  let targetParentId: string | null = null;
  if (input.afterItemId) {
    const { data: anchorItem, error: anchorError } = await supabase
      .from("estimate_items")
      .select("id, parent_id")
      .eq("tenant_id", tenantId)
      .eq("version_id", input.versionId)
      .eq("id", input.afterItemId)
      .maybeSingle();

    if (anchorError) {
      throw mapSupabaseError(
        anchorError,
        "Impossible de verifier la position d'insertion du template."
      );
    }
    if (!anchorItem) {
      throw badRequest("afterItemId invalide.");
    }

    targetParentId = anchorItem.parent_id ?? null;
  }

  const targetParent = await ensureParentIsValid({
    supabase,
    tenantId,
    versionId: input.versionId,
    parentId: targetParentId,
  });
  const maxSectionDepth = clampMaxSectionDepth(
    version.max_section_depth,
    DEFAULT_MAX_SECTION_DEPTH
  );
  const targetParentSectionLevel = await resolveSectionLevelFromParent({
    supabase,
    tenantId,
    versionId: input.versionId,
    parent: targetParent,
  });
  const templateHierarchyIndex = buildHierarchyIndex(
    templateItems.map((item) => ({
      id: item.id,
      parent_id: item.parent_id,
      item_type: item.item_type,
    }))
  );
  const templateRootItems = templateItems.filter((item) => item.parent_id === null);

  if (templateRootItems.length === 0) {
    throw badRequest("Le template est invalide: aucun element racine.");
  }

  const rootSectionLevel =
    targetParentSectionLevel === null ? 1 : targetParentSectionLevel + 1;
  for (const rootItem of templateRootItems) {
    if (rootItem.item_type === "section") {
      assertSectionPlacementAllowed({
        maxSectionDepth,
        nextSectionLevel: rootSectionLevel,
      });
      assertSectionSubtreePlacementAllowed({
        hierarchyIndex: templateHierarchyIndex,
        sectionId: rootItem.id,
        nextSectionLevel: rootSectionLevel,
        maxSectionDepth,
      });
      continue;
    }

    assertLinePlacementAllowed({
      maxSectionDepth,
      parentSectionLevel: targetParentSectionLevel,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC added in migration, types not yet regenerated
  const { data, error } = await (supabase.rpc as any)(
    "insert_estimate_template_into_version",
    {
      p_version_id: input.versionId,
      p_template_id: input.templateId,
      p_after_item_id: input.afterItemId ?? null,
    }
  );

  if (error) {
    if (errorMessageContains(error, "template not found")) {
      throw notFound(
        "Template introuvable.",
        error,
        "ESTIMATE_TEMPLATE_NOT_FOUND"
      );
    }
    if (errorMessageContains(error, "estimate version not found")) {
      throw notFound("Version de chiffrage introuvable.", error);
    }
    if (errorMessageContains(error, "after_item_id invalide")) {
      throw badRequest("afterItemId invalide.", error);
    }
    throw mapSupabaseError(error, "Impossible d'inserer le template.");
  }

  const insertedItems = Array.isArray(data) ? (data as EstimateItemRow[]) : [];
  const insertedItemIds = insertedItems.map((item) => item.id);

  if (insertedItemIds.length === 0) {
    throw internalError(
      "Impossible d'inserer le template.",
      { data },
      "ESTIMATE_TEMPLATE_INSERT_FAILED"
    );
  }

  const { data: reloadedItems, error: reloadError } = await supabase
    .from("estimate_items")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("version_id", input.versionId)
    .in("id", insertedItemIds);

  if (reloadError) {
    throw mapSupabaseError(reloadError, "Impossible d'inserer le template.");
  }

  const reloadedItemsById = new Map(
    ((reloadedItems ?? []) as EstimateItemRow[]).map((item) => [item.id, item])
  );
  const orderedItems = insertedItemIds
    .map((id) => reloadedItemsById.get(id))
    .filter((item): item is EstimateItemRow => Boolean(item));

  return {
    items: orderedItems,
  };
}

export async function duplicateEstimateVersion(
  versionId: string,
  options?: { as_variant?: boolean }
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  await getVersionAccessOrThrow(supabase, versionId, context);

  const { data: sourceVersion, error: sourceVersionError } = await supabase
    .from("estimate_versions")
    .select("exclusions")
    .eq("id", versionId)
    .eq("tenant_id", tenantId)
    .single();

  if (sourceVersionError || !sourceVersion) {
    if (sourceVersionError) {
      throw mapSupabaseError(
        sourceVersionError,
        "Impossible de charger les exclusions du chiffrage."
      );
    }
    throw notFound("Version de chiffrage introuvable.");
  }

  const { data, error } = await supabase.rpc("duplicate_estimate_version", {
    source_version_id: versionId,
    as_variant: options?.as_variant === true,
  });

  if (error) {
    throw mapSupabaseError(error, "Impossible de dupliquer le chiffrage.");
  }

  const duplicatedVersionId = toRpcUuid(data);
  if (!duplicatedVersionId) {
    throw badRequest("Impossible de dupliquer le chiffrage.");
  }

  if (sourceVersion.exclusions) {
    const { error: exclusionsError } = await supabase
      .from("estimate_versions")
      .update({ exclusions: sourceVersion.exclusions })
      .eq("id", duplicatedVersionId)
      .eq("tenant_id", tenantId);

    if (exclusionsError) {
      throw mapSupabaseError(exclusionsError, "Impossible de dupliquer les exclusions.");
    }
  }

  await tryCarryOverTakeoffJobsToNewVersion({
    supabase,
    tenantId,
    userId,
    sourceVersionId: versionId,
    targetVersionId: duplicatedVersionId,
  });

  return {
    version_id: duplicatedVersionId,
  };
}

async function duplicateSectionInternal(input: {
  sectionId: string;
  targetVersionId?: string;
  expectedSourceVersionId?: string;
}) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;

  const { data: sourceSectionData, error: sourceSectionError } = await supabase
    .from("estimate_items")
    .select("id, version_id, item_type, title")
    .eq("tenant_id", tenantId)
    .eq("id", input.sectionId)
    .single();

  if (sourceSectionError || !sourceSectionData) {
    throw notFound("Section introuvable.");
  }

  if (input.expectedSourceVersionId) {
    const belongsToExpectedVersion =
      sourceSectionData.version_id === input.expectedSourceVersionId;
    if (!belongsToExpectedVersion) {
      throw notFound("Section introuvable.");
    }
  }

  if (sourceSectionData.item_type !== "section") {
    throw badRequest("Seules les sections peuvent etre dupliquees.");
  }

  const sourceVersionId = sourceSectionData.version_id;
  const { version: sourceVersion } = await getVersionAccessOrThrow(
    supabase,
    sourceVersionId,
    context
  );

  const resolvedTargetVersionId = input.targetVersionId ?? sourceVersion.id;
  const { version: targetVersion } = await getVersionAccessOrThrow(
    supabase,
    resolvedTargetVersionId,
    context
  );

  assertDraftStatus(targetVersion.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId: targetVersion.id,
    userId,
  });

  const { data: sourceItemsData, error: sourceItemsError } = await supabase
    .from("estimate_items")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("version_id", sourceVersion.id)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (sourceItemsError) {
    throw mapSupabaseError(
      sourceItemsError,
      "Impossible de charger la section source."
    );
  }

  const sourceItems = (sourceItemsData ?? []) as EstimateItemRow[];
  const subtree = collectSectionSubtreeItems(input.sectionId, sourceItems);

  if (!subtree) {
    throw notFound("Section introuvable.");
  }

  const rootPosition = await getNextItemPosition(supabase, targetVersion.id, null);
  const duplicatedRootTitle = `${subtree.rootSection.title} (copie)`;
  const newIdBySourceId = new Map<string, string>();

  subtree.orderedSubtreeItems.forEach((item) => {
    newIdBySourceId.set(item.id, randomUUID());
  });

  const duplicatedItemsPayload: EstimateItemInsert[] = subtree.orderedSubtreeItems.map(
    (item) => {
      const newItemId = newIdBySourceId.get(item.id);
      if (!newItemId) {
        throw internalError("Impossible de dupliquer la section.");
      }

      const isRootSection = item.id === input.sectionId;
      const sourceParentId = item.parent_id ?? null;
      const newParentId = isRootSection
        ? null
        : sourceParentId
          ? (newIdBySourceId.get(sourceParentId) ?? null)
          : null;

      if (!isRootSection && sourceParentId && !newParentId) {
        throw internalError("Impossible de dupliquer la section.");
      }

      return {
        id: newItemId,
        tenant_id: tenantId,
        version_id: targetVersion.id,
        parent_id: newParentId,
        item_type: item.item_type,
        position: isRootSection ? rootPosition : item.position,
        title: isRootSection ? duplicatedRootTitle : item.title,
        description: item.description,
        quantity: item.quantity,
        unit_price_ht_cents: item.unit_price_ht_cents,
        tax_rate_bp: item.tax_rate_bp,
        k_fo: item.k_fo,
        h_mo: item.h_mo,
        h_mo_majoration: item.h_mo_majoration ?? null,
        k_mo: item.k_mo,
        h_mo_atelier: item.h_mo_atelier ?? null,
        k_mo_atelier: item.k_mo_atelier ?? null,
        labor_role_atelier_id: item.labor_role_atelier_id ?? null,
        h_mo_chantier: item.h_mo_chantier ?? null,
        k_mo_chantier: item.k_mo_chantier ?? null,
        labor_role_chantier_id: item.labor_role_chantier_id ?? null,
        pu_ht_cents: item.pu_ht_cents,
        labor_role_id: item.labor_role_id,
        category_id: item.category_id,
        supply_type_id: item.supply_type_id ?? null,
        selected_supplier_price_id: item.selected_supplier_price_id ?? null,
        source_provider: item.source_provider ?? null,
        source_job_id: item.source_job_id ?? null,
        source_file_name: item.source_file_name ?? null,
        source_page: item.source_page ?? null,
        line_total_ht_cents: item.line_total_ht_cents,
        line_tax_cents: item.line_tax_cents,
        line_total_ttc_cents: item.line_total_ttc_cents,
      } satisfies EstimateItemInsert;
    }
  );

  const { error: insertError } = await supabase
    .from("estimate_items")
    .insert(duplicatedItemsPayload);

  if (insertError) {
    throw mapSupabaseError(insertError, "Impossible de dupliquer la section.");
  }

  const duplicatedSectionId = newIdBySourceId.get(input.sectionId);
  if (!duplicatedSectionId) {
    throw internalError("Impossible de dupliquer la section.");
  }

  const recalculateResult = await recalculateEstimateVersionTotals({
    supabase,
    tenantId,
    versionId: targetVersion.id,
  });

  return {
    duplicated_section_id: duplicatedSectionId,
    source_version_id: sourceVersion.id,
    target_version_id: targetVersion.id,
    copied_item_count: duplicatedItemsPayload.length,
    totals: recalculateResult.totals,
    version: recalculateResult.version,
  };
}

export async function duplicateSection(
  sectionId: string,
  targetVersionId?: string
) {
  return duplicateSectionInternal({
    sectionId,
    targetVersionId,
  });
}

export async function duplicateSectionFromVersion(
  sourceVersionId: string,
  sectionId: string,
  input?: DuplicateEstimateSectionInput
) {
  return duplicateSectionInternal({
    sectionId,
    targetVersionId: input?.target_version_id ?? undefined,
    expectedSourceVersionId: sourceVersionId,
  });
}

export async function importSectionsFromVersion(
  targetVersionId: string,
  input: ImportEstimateSectionsInput
): Promise<ImportEstimateSectionsResult> {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;

  const { version: targetVersion } = await getVersionAccessOrThrow(
    supabase,
    targetVersionId,
    context
  );
  assertDraftStatus(targetVersion.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId: targetVersion.id,
    userId,
  });

  const { version: sourceVersion } = await getVersionAccessOrThrow(
    supabase,
    input.source_version_id,
    context
  );

  const [{ data: sourceItemsData, error: sourceItemsError }, { data: targetItemsData, error: targetItemsError }] =
    await Promise.all([
      supabase
        .from("estimate_items")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("version_id", sourceVersion.id)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("estimate_items")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("version_id", targetVersion.id)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);

  if (sourceItemsError) {
    throw mapSupabaseError(
      sourceItemsError,
      "Impossible de charger les sections source."
    );
  }
  if (targetItemsError) {
    throw mapSupabaseError(
      targetItemsError,
      "Impossible de charger les sections cibles."
    );
  }

  const sourceItems = (sourceItemsData ?? []) as EstimateItemRow[];
  const targetItems = (targetItemsData ?? []) as EstimateItemRow[];
  const sourceItemById = new Map(sourceItems.map((item) => [item.id, item]));

  const selectedSectionIds = input.section_ids;
  selectedSectionIds.forEach((sectionId) => {
    const sectionItem = sourceItemById.get(sectionId);
    if (!sectionItem || sectionItem.item_type !== "section") {
      throw badRequest(
        "section_ids contient un identifiant de section invalide."
      );
    }
  });

  const selectedSectionIdSet = new Set(selectedSectionIds);
  const rootSelectedSectionIds = selectedSectionIds.filter((sectionId) => {
    let parentId = sourceItemById.get(sectionId)?.parent_id ?? null;

    while (parentId) {
      if (selectedSectionIdSet.has(parentId)) {
        return false;
      }
      parentId = sourceItemById.get(parentId)?.parent_id ?? null;
    }

    return true;
  });

  const targetRootSectionIdByTitleKey = new Map<string, string>();
  const usedRootTitleKeys = new Set<string>();
  targetItems.forEach((item) => {
    if (item.item_type !== "section" || item.parent_id !== null) return;
    const titleKey = normalizeSectionTitleKey(item.title);
    usedRootTitleKeys.add(titleKey);
    if (!targetRootSectionIdByTitleKey.has(titleKey)) {
      targetRootSectionIdByTitleKey.set(titleKey, item.id);
    }
  });

  const rootParentPositionKey = "__root__";
  const highestPositionByParentKey = new Map<string, number>();
  targetItems.forEach((item) => {
    const parentKey = item.parent_id ?? rootParentPositionKey;
    const current = highestPositionByParentKey.get(parentKey) ?? 0;
    if (item.position > current) {
      highestPositionByParentKey.set(parentKey, item.position);
    }
  });

  const allocateNextPosition = (parentId: string | null) => {
    const parentKey = parentId ?? rootParentPositionKey;
    const nextPosition = (highestPositionByParentKey.get(parentKey) ?? 0) + 1;
    highestPositionByParentKey.set(parentKey, nextPosition);
    return nextPosition;
  };

  const importedItemsPayload: EstimateItemInsert[] = [];
  const createdSectionIds: string[] = [];
  const createdLineIds: string[] = [];
  let importedLinesCount = 0;

  for (const sourceSectionId of rootSelectedSectionIds) {
    const subtree = collectSectionSubtreeItems(sourceSectionId, sourceItems);
    if (!subtree) {
      throw notFound("Section source introuvable.");
    }

    const sourceRootTitle =
      toNullableText(subtree.rootSection.title) ?? "Section importee";
    const sourceRootTitleKey = normalizeSectionTitleKey(sourceRootTitle);

    if (input.mode === "merge") {
      const existingTargetSectionId =
        targetRootSectionIdByTitleKey.get(sourceRootTitleKey);

      if (existingTargetSectionId) {
        const sourceLines = subtree.orderedSubtreeItems.filter(
          (item) => item.item_type === "line"
        );

        sourceLines.forEach((sourceLine) => {
          const lineId = randomUUID();
          importedItemsPayload.push(
            buildImportedEstimateItemInsert({
              sourceItem: sourceLine,
              itemId: lineId,
              tenantId,
              targetVersionId: targetVersion.id,
              parentId: existingTargetSectionId,
              position: allocateNextPosition(existingTargetSectionId),
            })
          );
          createdLineIds.push(lineId);
        });

        importedLinesCount += sourceLines.length;
        continue;
      }
    }

    const rootTitle =
      input.mode === "append"
        ? resolveImportedSectionTitle({
            sourceTitle: sourceRootTitle,
            usedTitleKeys: usedRootTitleKeys,
          })
        : sourceRootTitle;

    const importedSubtree = buildImportedSubtreePayload({
      subtree,
      tenantId,
      targetVersionId: targetVersion.id,
      rootPosition: allocateNextPosition(null),
      rootTitle,
    });

    importedItemsPayload.push(...importedSubtree.items);
    createdSectionIds.push(...importedSubtree.created_section_ids);
    createdLineIds.push(...importedSubtree.created_line_ids);
    importedLinesCount += importedSubtree.line_count;

    const createdRootSectionId = importedSubtree.created_section_ids[0];
    if (createdRootSectionId) {
      const rootTitleKey = normalizeSectionTitleKey(rootTitle);
      usedRootTitleKeys.add(rootTitleKey);
      if (!targetRootSectionIdByTitleKey.has(rootTitleKey)) {
        targetRootSectionIdByTitleKey.set(rootTitleKey, createdRootSectionId);
      }
    }
  }

  if (importedItemsPayload.length > 0) {
    const { error: insertError } = await supabase
      .from("estimate_items")
      .insert(importedItemsPayload);

    if (insertError) {
      throw mapSupabaseError(insertError, "Impossible d'importer les sections.");
    }
  }

  const recalculateResult =
    importedItemsPayload.length > 0
      ? await recalculateEstimateVersionTotals({
          supabase,
          tenantId,
          versionId: targetVersion.id,
        })
      : {
          totals: {
            total_ht_cents: targetVersion.total_ht_cents ?? 0,
            total_tax_cents: targetVersion.total_tax_cents ?? 0,
            total_ttc_cents: targetVersion.total_ttc_cents ?? 0,
          },
          version: await fetchEstimateVersionToken({
            supabase,
            tenantId,
            versionId: targetVersion.id,
          }),
        };

  return {
    source_version_id: sourceVersion.id,
    target_version_id: targetVersion.id,
    mode: input.mode,
    imported_sections_count: rootSelectedSectionIds.length,
    imported_lines_count: importedLinesCount,
    created_section_ids: createdSectionIds,
    created_line_ids: createdLineIds,
    totals: recalculateResult.totals,
    version: recalculateResult.version,
  };
}

export async function importLinkedDpgfSourceIntoVersion(
  versionId: string,
  input: ImportLinkedDpgfSourceInput
): Promise<ImportLinkedDpgfSourceResult> {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;

  const { version } = await getVersionAccessOrThrow(supabase, versionId, context);
  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId,
    userId,
  });

  const marginMultiplier =
    typeof version.margin_multiplier === "number"
      ? version.margin_multiplier
      : DEFAULT_MARGIN_MULTIPLIER;
  const taxRateBp =
    typeof version.tax_rate_bp === "number"
      ? version.tax_rate_bp
      : DEFAULT_TAX_RATE_BP;

  return importLinkedDpgfSourceIntoVersionInternal({
    supabase,
    tenantId,
    projectId: version.project_id,
    versionId,
    marginMultiplier,
    defaultTaxRateBp: taxRateBp,
    sectionTitle: input.section_title ?? null,
  });
}

export async function createEstimateVariant(versionId: string) {
  return duplicateEstimateVersion(versionId, { as_variant: true });
}

export async function promoteEstimateVariant(versionId: string) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;
  const { version } = await getVersionAccessOrThrow(supabase, versionId, context);
  const variantLabel = toNullableText(version.variant_label);
  const parentVersionId = version.parent_version_id ?? null;

  if (!variantLabel || !parentVersionId) {
    throw badRequest(
      "Cette version n'est pas une variante.",
      undefined,
      "ESTIMATE_VARIANT_REQUIRED"
    );
  }

  assertDraftStatus(version.status);

  const promotionPayload = {
    parent_version_id: null,
    variant_label: null,
  } as EstimateVersionUpdate;

  const { data, error } = await supabase
    .from("estimate_versions")
    .update(promotionPayload)
    .eq("id", versionId)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(error, "Impossible de promouvoir la variante.");
    }
    throw badRequest("Impossible de promouvoir la variante.");
  }

  return {
    version: data,
  };
}

export async function createEstimate(input: CreateEstimateInput) {
  const context = await getAuthenticatedContext();
  const { supabase, userId, tenantId } = context;
  const targetProjectId = input.project_id ?? null;
  const creationMode = input.creation_mode ?? "blank";
  const requestedCurrency = input.version?.currency;

  if (creationMode === "linked_dpgf_source" && !targetProjectId) {
    throw badRequest(
      "creation_mode=linked_dpgf_source requiert project_id."
    );
  }

  if (requestedCurrency !== undefined) {
    normalizeEstimateCurrencyOrThrow(requestedCurrency, {
      fallback: DEFAULT_CURRENCY,
    });
  }

  let project: EstimateProjectRow | null = null;
  let createdProjectId: string | null = null;
  let latestProjectVersionDefaults: CreateEstimateLatestVersionDefaultsRow | null = null;

  if (targetProjectId) {
    const { data: existingProject, error: existingProjectError } = await supabase
      .from("estimate_projects")
      .select("*")
      .eq("id", targetProjectId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (existingProjectError) {
      throw mapSupabaseError(
        existingProjectError,
        "Impossible de charger le projet de chiffrage."
      );
    }

    if (
      !existingProject ||
      existingProject.is_archived ||
      !canAccessOwnerResource({
        context,
        resourceUserId: existingProject.user_id,
      })
    ) {
      throw notFound("Projet de chiffrage introuvable.");
    }

    project = existingProject as EstimateProjectRow;

    const { data: latestVersionData, error: latestVersionError } = await supabase
      .from("estimate_versions")
      .select(
        "id, version_number, date_devis, validite_jours, margin_multiplier, margin_mode, currency, margin_bp, discount_bp, discount_mode, discount_steps, global_coefficient, tax_rate_bp, rounding_mode, rounding_step_cents, max_section_depth"
      )
      .eq("tenant_id", tenantId)
      .eq("project_id", project.id)
      .order("version_number", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestVersionError) {
      throw mapSupabaseError(
        latestVersionError,
        "Impossible de charger la version courante du projet."
      );
    }

    latestProjectVersionDefaults = (latestVersionData ??
      null) as CreateEstimateLatestVersionDefaultsRow | null;
  } else {
    if (!input.project) {
      throw badRequest("project ou project_id est requis.");
    }

    const { data: createdProject, error: projectError } = await supabase
      .from("estimate_projects")
      .insert({
        tenant_id: tenantId,
        user_id: userId,
        name: input.project.name,
        reference: toNullableText(input.project.reference),
        client_name: toNullableText(input.project.client_name),
        notes: toNullableText(input.project.notes),
        is_archived: false,
      })
      .select("*")
      .single();

    if (projectError || !createdProject) {
      if (projectError) {
        throw mapSupabaseError(projectError, "Impossible de creer le projet de chiffrage.");
      }
      throw badRequest("Impossible de creer le projet de chiffrage.");
    }

    project = createdProject as EstimateProjectRow;
    createdProjectId = createdProject.id;
  }

  if (!project) {
    throw badRequest("Projet de chiffrage introuvable.");
  }

  const normalizedCurrency = normalizeEstimateCurrencyOrThrow(
    requestedCurrency ?? latestProjectVersionDefaults?.currency,
    {
      fallback: DEFAULT_CURRENCY,
    }
  );

  const versionPayload: EstimateVersionInsert = {
    tenant_id: tenantId,
    project_id: project.id,
    version_number: targetProjectId
      ? (latestProjectVersionDefaults?.version_number ?? 0) + 1
      : 1,
    status: "draft",
    title: toNullableText(input.version?.title),
    date_devis:
      input.version?.date_devis ??
      latestProjectVersionDefaults?.date_devis ??
      todayDateOnly(),
    validite_jours:
      input.version?.validite_jours ??
      latestProjectVersionDefaults?.validite_jours ??
      DEFAULT_VALIDITE_JOURS,
    margin_multiplier:
      input.version?.margin_multiplier ??
      latestProjectVersionDefaults?.margin_multiplier ??
      DEFAULT_MARGIN_MULTIPLIER,
    margin_mode:
      input.version?.margin_mode ??
      latestProjectVersionDefaults?.margin_mode ??
      DEFAULT_MARGIN_MODE,
    currency: normalizedCurrency,
    margin_bp:
      input.version?.margin_bp ?? latestProjectVersionDefaults?.margin_bp ?? 0,
    discount_bp:
      input.version?.discount_bp ?? latestProjectVersionDefaults?.discount_bp ?? 0,
    discount_mode:
      input.version?.discount_mode ??
      latestProjectVersionDefaults?.discount_mode ??
      DEFAULT_DISCOUNT_MODE,
    discount_steps:
      input.version?.discount_steps ??
      latestProjectVersionDefaults?.discount_steps ??
      [],
    global_coefficient:
      input.version?.global_coefficient ??
      latestProjectVersionDefaults?.global_coefficient ??
      DEFAULT_GLOBAL_COEFFICIENT,
    tax_rate_bp:
      input.version?.tax_rate_bp ??
      latestProjectVersionDefaults?.tax_rate_bp ??
      DEFAULT_TAX_RATE_BP,
    rounding_mode:
      input.version?.rounding_mode ??
      latestProjectVersionDefaults?.rounding_mode ??
      DEFAULT_ROUNDING_MODE,
    rounding_step_cents:
      input.version?.rounding_step_cents ??
      latestProjectVersionDefaults?.rounding_step_cents ??
      DEFAULT_ROUNDING_STEP_CENTS,
    max_section_depth: clampMaxSectionDepth(
      input.version?.max_section_depth ??
        latestProjectVersionDefaults?.max_section_depth,
      DEFAULT_MAX_SECTION_DEPTH
    ),
    total_ht_cents: 0,
    total_tax_cents: 0,
    total_ttc_cents: 0,
  };

  const { data: insertedVersion, error: versionError } = await supabase
    .from("estimate_versions")
    .insert(versionPayload)
    .select("*")
    .single();

  if (versionError || !insertedVersion) {
    if (createdProjectId) {
      await supabase.from("estimate_projects").delete().eq("id", createdProjectId);
    }

    if (versionError) {
      throw mapSupabaseError(versionError, "Impossible de creer la version initiale.");
    }

    throw badRequest("Impossible de creer la version initiale.");
  }
  let version = insertedVersion as EstimateVersionRow;

  const categoriesPayload: EstimateCategoryInsert[] = DEFAULT_ESTIMATE_CATEGORIES.map(
    (category) => ({
      tenant_id: tenantId,
      user_id: userId,
      name: category.name,
      position: category.position,
      color: null,
    })
  );

  const { error: categoriesError } = await supabase
    .from("estimate_categories")
    .upsert(categoriesPayload, {
      onConflict: "tenant_id,user_id,name",
      ignoreDuplicates: true,
    });

  if (categoriesError) {
    if (createdProjectId) {
      await supabase.from("estimate_projects").delete().eq("id", createdProjectId);
    } else {
      await supabase
        .from("estimate_versions")
        .delete()
        .eq("id", version.id)
        .eq("tenant_id", tenantId);
    }
    throw mapSupabaseError(categoriesError, "Impossible de preparer les categories par defaut.");
  }

  const laborRolesPayload: LaborRoleInsert[] = DEFAULT_LABOR_ROLES.map((role) => ({
    tenant_id: tenantId,
    user_id: project.user_id,
    name: role.name,
    hourly_rate_cents: role.hourly_rate_cents,
    is_active: true,
    position: role.position,
  }));

  const { error: laborRolesError } = await supabase
    .from("labor_roles")
    .upsert(laborRolesPayload, {
      onConflict: "tenant_id,user_id,name",
      ignoreDuplicates: true,
    });

  if (laborRolesError) {
    if (createdProjectId) {
      await supabase.from("estimate_projects").delete().eq("id", createdProjectId);
    } else {
      await supabase
        .from("estimate_versions")
        .delete()
        .eq("id", version.id)
        .eq("tenant_id", tenantId);
    }
    throw mapSupabaseError(
      laborRolesError,
      "Impossible de preparer les roles MO par defaut."
    );
  }

  if (creationMode === "linked_dpgf_source") {
    try {
      const importResult = await importLinkedDpgfSourceIntoVersionInternal({
        supabase,
        tenantId,
        projectId: project.id,
        versionId: version.id,
        marginMultiplier:
          typeof version.margin_multiplier === "number"
            ? version.margin_multiplier
            : versionPayload.margin_multiplier ?? DEFAULT_MARGIN_MULTIPLIER,
        defaultTaxRateBp:
          typeof version.tax_rate_bp === "number"
            ? version.tax_rate_bp
            : versionPayload.tax_rate_bp ?? DEFAULT_TAX_RATE_BP,
      });

      version = {
        ...version,
        total_ht_cents: importResult.totals.total_ht_cents,
        total_tax_cents: importResult.totals.total_tax_cents,
        total_ttc_cents: importResult.totals.total_ttc_cents,
        updated_at: importResult.version.updated_at,
      };
    } catch (error) {
      if (createdProjectId) {
        await supabase.from("estimate_projects").delete().eq("id", createdProjectId);
      } else {
        await supabase
          .from("estimate_versions")
          .delete()
          .eq("id", version.id)
          .eq("tenant_id", tenantId);
      }

      throw error;
    }
  }

  await tryCarryOverTakeoffJobsToNewVersion({
    supabase,
    tenantId,
    userId,
    sourceVersionId: latestProjectVersionDefaults?.id ?? null,
    targetVersionId: version.id,
  });

  return {
    project,
    version,
  };
}

export async function getEstimateVersionDetails(versionId: string) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;

  const { data: versionData, error: versionError } = await supabase
    .from("estimate_versions")
    .select(
      "*, estimate_projects!inner(id, tenant_id, user_id, name, reference, estimate_reference, client_name, notes, is_archived)"
    )
    .eq("id", versionId)
    .eq("tenant_id", tenantId)
    .single();

  if (versionError || !versionData) {
    throw notFound("Version de chiffrage introuvable.");
  }

  const version = versionData as unknown as EstimateVersionDetailsRow;
  const project = resolveEmbeddedOne(version.estimate_projects);

  if (
    !project ||
    project.tenant_id !== tenantId ||
    !canAccessOwnerResource({
      context,
      resourceUserId: project.user_id,
    })
  ) {
    throw notFound("Version de chiffrage introuvable.");
  }

  const categoriesQuery = supabase
    .from("estimate_categories")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("user_id", project.user_id)
    .order("position", { ascending: true });
  const supplyTypesQuery = supabase
    .from("supply_types")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });
  const laborRolesQuery = supabase
    .from("labor_roles")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("user_id", project.user_id)
    .order("position", { ascending: true });
  const rulesQuery = supabase
    .from("estimate_suggestion_rules")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("user_id", project.user_id)
    .order("position", { ascending: true });
  const marginTiersQuery = supabase
    .from("margin_tiers")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("threshold_cents", { ascending: true })
    .order("position", { ascending: true });

  const [
    itemsResult,
    categoriesResult,
    supplyTypesResult,
    laborRolesResult,
    rulesResult,
    marginTiersResult,
    versionZeroSummary,
  ] =
    await Promise.all([
      supabase
        .from("estimate_items")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("version_id", versionId)
        .order("position", { ascending: true }),
      categoriesQuery,
      supplyTypesQuery,
      laborRolesQuery,
      rulesQuery,
      marginTiersQuery,
      fetchVersionZeroDraftSummary({ versionId }).catch(() => null),
    ]);

  if (itemsResult.error) {
    throw mapSupabaseError(itemsResult.error, "Impossible de charger les lignes.");
  }

  if (categoriesResult.error) {
    throw mapSupabaseError(
      categoriesResult.error,
      "Impossible de charger les categories."
    );
  }

  if (supplyTypesResult.error) {
    throw mapSupabaseError(
      supplyTypesResult.error,
      "Impossible de charger les types de fourniture."
    );
  }

  if (laborRolesResult.error) {
    throw mapSupabaseError(
      laborRolesResult.error,
      "Impossible de charger les roles de main d'oeuvre."
    );
  }

  if (rulesResult.error) {
    throw mapSupabaseError(
      rulesResult.error,
      "Impossible de charger les regles de suggestion."
    );
  }

  if (marginTiersResult.error) {
    throw mapSupabaseError(
      marginTiersResult.error,
      "Impossible de charger les tranches de marge."
    );
  }

  const items = await enrichEstimateItemsWithSourceMetadata({
    supabase,
    tenantId,
    targetVersionId: versionId,
    items: (itemsResult.data ?? []) as EstimateItemRow[],
  });

  return {
    version: {
      ...version,
      estimate_projects: project,
    },
    items,
    categories: (categoriesResult.data ?? []) as EstimateCategoryRow[],
    supply_types: (supplyTypesResult.data ?? []) as SupplyTypeRow[],
    labor_roles: (laborRolesResult.data ?? []) as LaborRoleRow[],
    suggestion_rules: (rulesResult.data ?? []) as SuggestionRuleRow[],
    margin_tiers: (marginTiersResult.data ?? []) as MarginTierRow[],
    version_zero_summary: versionZeroSummary,
  };
}

export async function listEstimateItems(versionId: string) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;
  await getVersionAccessOrThrow(supabase, versionId, context);

  const { data, error } = await supabase
    .from("estimate_items")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("version_id", versionId)
    .order("position", { ascending: true });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les lignes.");
  }

  const items = await enrichEstimateItemsWithSourceMetadata({
    supabase,
    tenantId,
    targetVersionId: versionId,
    items: (data ?? []) as EstimateItemRow[],
  });

  return {
    items,
  };
}

export async function listEstimateVersionEvents(versionId: string) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;

  await getVersionAccessOrThrow(supabase, versionId, context);

  const { data, error } = await supabase
    .from("estimate_version_events")
    .select(
      "id, estimate_version_id, event_type, metadata, created_by, occurred_at, created_at, profiles:created_by(full_name)"
    )
    .eq("tenant_id", tenantId)
    .eq("estimate_version_id", versionId)
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les evenements.");
  }

  return {
    events: ((data ?? []) as unknown as EstimateVersionEventRow[]).map((row) =>
      normalizeEstimateVersionEvent(row)
    ),
  };
}

export async function suggestEstimateCataloguePrices(
  versionId: string,
  query: string
) {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length < 2) {
    throw badRequest("Le parametre q doit contenir au moins 2 caracteres.");
  }

  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;
  await getVersionAccessOrThrow(supabase, versionId, context);

  const stalePriceDays = await getStalePriceDaysForTenant(tenantId, { supabase });
  const safeSearch = escapeIlikeToken(normalizedQuery);
  if (safeSearch.length < 2) {
    throw badRequest("Le parametre q contient uniquement des caracteres non supportes.");
  }

  const [productResult, supplierResult] = await Promise.all([
    supabase
      .from("products")
      .select("id, designation, reference")
      .eq("tenant_id", tenantId)
      .or(`designation.ilike.%${safeSearch}%,reference.ilike.%${safeSearch}%,category.ilike.%${safeSearch}%,product_type.ilike.%${safeSearch}%,material.ilike.%${safeSearch}%,grade.ilike.%${safeSearch}%,dimensions.ilike.%${safeSearch}%,standard.ilike.%${safeSearch}%`)
      .limit(40),
    supabase
      .from("suppliers")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .ilike("name", `%${safeSearch}%`)
      .limit(40),
  ]);

  if (productResult.error) {
    throw mapSupabaseError(productResult.error, "Impossible de charger les produits catalogue.");
  }
  if (supplierResult.error) {
    throw mapSupabaseError(
      supplierResult.error,
      "Impossible de charger les fournisseurs catalogue."
    );
  }

  const products = (productResult.data ?? []) as Array<{
    id: string;
    designation: string;
    reference: string | null;
  }>;
  const suppliers = (supplierResult.data ?? []) as Array<{
    id: string;
    name: string;
  }>;

  const productIds = products.map((product) => product.id);
  const supplierIds = suppliers.map((supplier) => supplier.id);

  const filterClauses: string[] = [];
  if (productIds.length > 0) {
    filterClauses.push(`product_id.in.(${productIds.join(",")})`);
  }
  if (supplierIds.length > 0) {
    filterClauses.push(`supplier_id.in.(${supplierIds.join(",")})`);
  }
  if (safeSearch.length > 0) {
    filterClauses.push(`supplier_sku.ilike.%${safeSearch}%`);
  }

  if (filterClauses.length === 0) {
    return {
      query: normalizedQuery,
      stale_price_days: stalePriceDays,
      suggestions: [] as SuggestedCataloguePrice[],
    };
  }

  let supplierPricesQuery = supabase
    .from("supplier_pricebook")
    .select(
      "id, supplier_id, product_id, supplier_sku, unit, unit_price_cents, currency, updated_at, created_at, notes, is_active, supplier_catalog_items!supplier_pricebook_supplier_catalog_item_id_fkey(supplier_sku, product_url)"
    )
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(400);

  supplierPricesQuery = supplierPricesQuery.or(filterClauses.join(","));

  const { data: supplierPricesData, error: supplierPricesError } = await supplierPricesQuery;

  if (supplierPricesError) {
    throw mapSupabaseError(
      supplierPricesError,
      "Impossible de charger les suggestions de prix catalogue."
    );
  }

  const supplierPrices = ((supplierPricesData ?? []) as unknown as SupplierPricebookRow[]).map(
    normalizeSupplierPricebookRow
  );

  if (supplierPrices.length === 0) {
    return {
      query: normalizedQuery,
      stale_price_days: stalePriceDays,
      suggestions: [] as SuggestedCataloguePrice[],
    };
  }

  const preferredSupplierId = await resolvePreferredSupplierIdForCandidates({
    supabase,
    tenantId,
    supplierPrices,
  });
  const candidates = await hydrateSuggestedCatalogueCandidates({
    supabase,
    tenantId,
    supplierPrices,
    stalePriceDays,
    query: normalizedQuery,
    filterByRelevance: true,
  });

  const candidatesByProductId = new Map<string, typeof candidates>();
  candidates.forEach((candidate) => {
    const productCandidates = candidatesByProductId.get(candidate.product_id) ?? [];
    productCandidates.push(candidate);
    candidatesByProductId.set(candidate.product_id, productCandidates);
  });

  const suggestions = Array.from(candidatesByProductId.values())
    .slice(0, 10)
    .map((productCandidates) => {
      const candidate = productCandidates[0]!;
      return {
        ...candidate,
        supplier_offer_count: productCandidates.length,
        alternatives: buildSuggestedCatalogueAlternatives({
          productCandidates,
          preferredSupplierId,
        }),
      };
    }) satisfies SuggestedCataloguePrice[];

  return {
    query: normalizedQuery,
    stale_price_days: stalePriceDays,
    suggestions,
  };
}

export async function getEstimateSupplierComparisons(
  versionId: string,
  itemIds: string[] | null
) {
  const normalizedItemIds =
    itemIds === null
      ? null
      : Array.from(
          new Set(itemIds.map((itemId) => itemId.trim()).filter((itemId) => itemId.length > 0))
        );

  if (normalizedItemIds !== null) {
    if (normalizedItemIds.length === 0) {
      throw badRequest("item_ids ne peut pas etre vide.");
    }
    if (normalizedItemIds.length > MAX_SUPPLIER_COMPARISON_ITEMS) {
      throw badRequest("item_ids ne peut pas contenir plus de 200 identifiants.");
    }
  }

  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;
  await getVersionAccessOrThrow(supabase, versionId, context);

  let itemsQuery = supabase
    .from("estimate_items")
    .select("id, item_type, title, selected_supplier_price_id")
    .eq("tenant_id", tenantId)
    .eq("version_id", versionId);

  if (normalizedItemIds === null) {
    itemsQuery = itemsQuery.eq("item_type", "line");
  } else {
    itemsQuery = itemsQuery.in("id", normalizedItemIds);
  }

  const { data: rows, error } = await itemsQuery;

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les lignes.");
  }

  const items = (rows ?? []) as Array<{
    id: string;
    item_type: Database["public"]["Enums"]["estimate_item_type"];
    title: string;
    selected_supplier_price_id: string | null;
  }>;
  const lineItems = items.filter((item) => item.item_type === "line");
  const itemById = new Map(lineItems.map((item) => [item.id, item]));
  const resolvedItemIds = normalizedItemIds ?? lineItems.map((item) => item.id);

  if (
    normalizedItemIds === null &&
    resolvedItemIds.length > MAX_SUPPLIER_COMPARISON_ITEMS
  ) {
    throw badRequest("all_items ne peut pas charger plus de 200 lignes.");
  }

  if (normalizedItemIds !== null) {
    normalizedItemIds.forEach((itemId) => {
      const item = itemById.get(itemId);
      if (!item) {
        throw badRequest("item_id doit correspondre a une ligne de devis.", {
          item_id: itemId,
        });
      }
    });
  }

  const stalePriceDays = await getStalePriceDaysForTenant(tenantId, { supabase });

  if (resolvedItemIds.length === 0) {
    return {
      stale_price_days: stalePriceDays,
      coverage_summary: summarizeEstimateSupplierComparisonCoverage([]),
      comparisons: [] as EstimateSupplierComparison[],
      bulk_preselection: buildEstimateSupplierPreselectionReview({
        comparisons: [],
        itemTitleById: new Map(),
      }),
    };
  }

  const queryByNormalizedKey = new Map<string, string>();
  const normalizedKeyByItemId = new Map<string, string>();

  resolvedItemIds.forEach((itemId) => {
    const item = itemById.get(itemId);
    if (!item) return;

    const normalizedQuery = normalizeSupplierComparisonQuery(item.title);
    normalizedKeyByItemId.set(itemId, normalizedQuery);

    if (normalizedQuery.length < 2) return;
    if (escapeIlikeToken(normalizedQuery).length < 2) return;
    if (!queryByNormalizedKey.has(normalizedQuery)) {
      queryByNormalizedKey.set(normalizedQuery, normalizedQuery);
    }
  });

  const suggestionsEntries = await Promise.all(
    Array.from(queryByNormalizedKey.entries()).map(async ([normalizedQuery, query]) => {
      const suggestion = await suggestEstimateCataloguePrices(versionId, query);
      return [normalizedQuery, suggestion] as const;
    })
  );
  const suggestionsByNormalizedQuery = new Map(suggestionsEntries);

  const comparisons = await Promise.all(resolvedItemIds.map(async (itemId) => {
    const item = itemById.get(itemId);
    if (!item) {
      return {
        item_id: itemId,
        selected_supplier_price_id: null,
        best_supplier_price_id: null,
        coverage_status: "no_price",
        risk_flags: [],
        selected_alternative: null,
        alternatives: [],
      } satisfies EstimateSupplierComparison;
    }

    const normalizedKey = normalizedKeyByItemId.get(itemId) ?? "";
    const suggestions = suggestionsByNormalizedQuery.get(normalizedKey)?.suggestions ?? [];

    const selectedSupplierPriceId = item.selected_supplier_price_id ?? null;
    const selectedSuggestion = selectedSupplierPriceId
      ? suggestions.find((suggestion) => {
          if (suggestion.supplier_price_id === selectedSupplierPriceId) return true;
          return suggestion.alternatives.some(
            (alternative) => alternative.supplier_price_id === selectedSupplierPriceId
          );
        }) ?? null
      : null;
    const candidate =
      selectedSuggestion ??
      (selectedSupplierPriceId
        ? await findSelectedSupplierComparisonCandidate({
            supabase,
            tenantId,
            selectedSupplierPriceId,
            stalePriceDays,
          })
        : null) ??
      suggestions[0] ??
      null;

    if (!candidate) {
      return {
        item_id: item.id,
        selected_supplier_price_id: selectedSupplierPriceId,
        best_supplier_price_id: null,
        coverage_status: "no_price",
        risk_flags: [],
        selected_alternative: null,
        alternatives: [],
      } satisfies EstimateSupplierComparison;
    }

    const bestAlternative =
      candidate.alternatives.find((alternative) => alternative.kind === "best_price") ?? null;
    const alternatives = buildEstimateSupplierComparisonAlternatives({
      candidate: {
        supplier_price_id: candidate.supplier_price_id,
        supplier_id: candidate.supplier_id,
        supplier_name: candidate.supplier_name,
        adjusted_unit_price_cents: candidate.adjusted_unit_price_cents,
        supplier_reference: candidate.supplier_reference,
        catalogue_url: candidate.catalogue_url,
        updated_at: candidate.updated_at,
        is_stale: candidate.is_stale,
        product_designation: candidate.product_designation,
        alternatives: candidate.alternatives,
      },
      selectedSupplierPriceId,
    });
    const selectedAlternative = findSelectedSupplierComparisonAlternative(
      alternatives,
      selectedSupplierPriceId
    );
    const riskFlags = computeEstimateSupplierComparisonRiskFlags({
      alternatives,
      selectedSupplierPriceId,
      bestSupplierPriceId: bestAlternative?.supplier_price_id ?? null,
      selectedAlternative,
    });
    const coverageStatus = computeEstimateSupplierComparisonCoverageStatus({
      alternatives,
      selectedAlternative,
      riskFlags,
    });

    return {
      item_id: item.id,
      selected_supplier_price_id: selectedSupplierPriceId,
      best_supplier_price_id: bestAlternative?.supplier_price_id ?? null,
      coverage_status: coverageStatus,
      risk_flags: riskFlags,
      selected_alternative: selectedAlternative,
      alternatives,
    } satisfies EstimateSupplierComparison;
  }));

  const itemTitleById = new Map(lineItems.map((item) => [item.id, item.title]));

  return {
    stale_price_days: stalePriceDays,
    coverage_summary: summarizeEstimateSupplierComparisonCoverage(comparisons),
    comparisons,
    bulk_preselection: buildEstimateSupplierPreselectionReview({
      comparisons,
      itemTitleById,
    }),
  };
}

function isMissingEstimateExclusionsColumnError(
  error: { code?: string | null; message?: string | null } | null
) {
  return (
    error?.code === "PGRST204" &&
    (error.message ?? "").includes("'exclusions'") &&
    (error.message ?? "").includes("'estimate_versions'")
  );
}


export async function patchEstimateVersion(
  versionId: string,
  input: PatchEstimateVersionInput,
  concurrencyToken?: string
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version } = await getVersionAccessOrThrow(supabase, versionId, context);

  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId,
    userId,
  });
  assertVersionConcurrencyToken(version.updated_at, concurrencyToken);

  const payload: EstimateVersionUpdate = {};

  if ("title" in input) {
    payload.title = toNullableText(input.title);
  }
  if ("exclusions" in input) {
    payload.exclusions = toNullableText(input.exclusions);
  }
  if ("date_devis" in input) {
    payload.date_devis = input.date_devis;
  }
  if ("validite_jours" in input) {
    payload.validite_jours = input.validite_jours;
  }
  if ("margin_multiplier" in input) {
    payload.margin_multiplier = input.margin_multiplier;
  }
  if ("margin_mode" in input) {
    payload.margin_mode = input.margin_mode;
  }
  if ("currency" in input && typeof input.currency === "string") {
    payload.currency = normalizeEstimateCurrencyOrThrow(input.currency);
  }
  if ("margin_bp" in input) {
    payload.margin_bp = input.margin_bp;
  }
  if ("discount_bp" in input) {
    payload.discount_bp = input.discount_bp;
  }
  if ("discount_mode" in input) {
    payload.discount_mode = input.discount_mode;
  }
  if ("discount_steps" in input) {
    payload.discount_steps = input.discount_steps;
  }
  if ("global_coefficient" in input) {
    payload.global_coefficient = input.global_coefficient;
  }
  if ("tax_rate_bp" in input) {
    payload.tax_rate_bp = input.tax_rate_bp;
  }
  if ("rounding_mode" in input) {
    payload.rounding_mode = input.rounding_mode;
  }
  if ("rounding_step_cents" in input) {
    payload.rounding_step_cents = input.rounding_step_cents;
  }
  if ("max_section_depth" in input) {
    payload.max_section_depth = clampMaxSectionDepth(
      input.max_section_depth,
      DEFAULT_MAX_SECTION_DEPTH
    );
  }
  if ("total_ht_cents" in input) {
    payload.total_ht_cents = input.total_ht_cents;
  }
  if ("total_tax_cents" in input) {
    payload.total_tax_cents = input.total_tax_cents;
  }
  if ("total_ttc_cents" in input) {
    payload.total_ttc_cents = input.total_ttc_cents;
  }

  const persistedTotals: EstimateTotals = {
    total_ht_cents: version.total_ht_cents ?? null,
    total_tax_cents: version.total_tax_cents ?? null,
    total_ttc_cents: version.total_ttc_cents ?? null,
  };

  await assertEstimateTotalsInvariantForPatch({
    supabase,
    tenantId,
    versionId,
    userId,
    persistedTotals,
    patch: input,
  });

  const updateVersion = (updatePayload: EstimateVersionUpdate) =>
    supabase
      .from("estimate_versions")
      .update(updatePayload)
      .eq("id", versionId)
      .eq("tenant_id", tenantId)
      .eq("updated_at", version.updated_at)
      .select("*")
      .single();

  let { data, error } = await updateVersion(payload);

  if (isMissingEstimateExclusionsColumnError(error)) {
    if (payload.exclusions !== null) {
      throw badRequest(
        "Les exclusions ne peuvent pas etre enregistrees tant que la migration de la base de donnees n'est pas appliquee.",
        error,
        "SCHEMA_MIGRATION_REQUIRED"
      );
    }

    const compatiblePayload = { ...payload };
    delete compatiblePayload.exclusions;
    ({ data, error } = await updateVersion(compatiblePayload));
  }

  if (error || !data) {
    if (error?.code === "PGRST116") {
      throw conflict(VERSION_CONFLICT_ERROR_MESSAGE, {
        updated_at: version.updated_at,
      }, "VERSION_CONFLICT");
    }

    if (error) {
      throw mapSupabaseError(error, "Impossible de mettre a jour la version.");
    }
    throw conflict(VERSION_CONFLICT_ERROR_MESSAGE, {
      updated_at: version.updated_at,
    }, "VERSION_CONFLICT");
  }

  return {
    version: data,
  };
}

export async function getEstimateSendGating(versionId: string) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;
  const { version, project } = await getVersionAccessOrThrow(
    supabase,
    versionId,
    context
  );

  const gating = await evaluateEstimateSendGating({
    supabase,
    tenantId,
    version,
    project,
  });

  return {
    gating,
  };
}

export async function patchEstimateStatus(
  versionId: string,
  input: PatchEstimateStatusInput,
  concurrencyToken: string | undefined
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version, project } = await getVersionAccessOrThrow(
    supabase,
    versionId,
    context
  );
  assertVersionConcurrencyToken(version.updated_at, concurrencyToken);
  if (version.status === "draft") {
    await assertDraftLockOwnedByCurrentUser({
      supabase,
      tenantId,
      versionId,
      userId,
    });
  }

  if (version.status === input.status) {
    const { data, error } = await supabase
      .from("estimate_versions")
      .select("*")
      .eq("id", versionId)
      .eq("tenant_id", tenantId)
      .single();

    if (error || !data) {
      if (error) {
        throw mapSupabaseError(error, "Impossible de charger la version.");
      }
      throw notFound("Version de chiffrage introuvable.");
    }

    return {
      version: data,
    };
  }

  assertEstimateStatusTransition(version.status, input.status);

  let sealHash: string | null = null;
  let forcedByAdmin = false;
  let forcedBlockingFlags: string[] = [];

  if (version.status === "draft" && input.status === "sent") {
    const gating = await evaluateEstimateSendGating({
      supabase,
      tenantId,
      version,
      project,
    });

    if (input.force === true && !isTenantAdmin(context.tenantRole)) {
      throw forbidden(
        "Le forcage d'envoi est reserve aux administrateurs.",
        undefined,
        "FORCE_SEND_FORBIDDEN"
      );
    }

    if (gating.blockingFlags.length > 0 && input.force !== true) {
      throw badRequest(
        "Envoi bloque: des anomalies bloquantes doivent etre corrigees avant validation.",
        {
          gating,
        },
        "ESTIMATE_GATING_BLOCKED"
      );
    }

    if (gating.blockingFlags.length > 0 && input.force === true) {
      forcedByAdmin = true;
      forcedBlockingFlags = gating.blockingFlags.map((flag) => flag.key);
    }

    await generateEstimatePdfNow(versionId, {
      force: true,
      triggeredBy: "send",
    });

    const sealSource = await loadEstimateSealSource({
      supabase,
      tenantId,
      versionId,
    });
    const sealPayload = buildCanonicalEstimateSealPayload(sealSource);
    sealHash = computeEstimateSealHash(sealPayload);
  }

  const statusEventType = resolveStatusEventType(input.status);
  if (!statusEventType) {
    throw badRequest(
      `Transition de statut invalide: ${version.status} -> ${input.status}.`
    );
  }

  const statusEventMetadata: Record<string, unknown> = {};
  if (forcedByAdmin) {
    statusEventMetadata.forced_by_admin = true;
    statusEventMetadata.forced_blocking_flags = forcedBlockingFlags;
  }

  const data = await transitionEstimateVersionStatusAtomically({
    versionId,
    tenantId,
    expectedUpdatedAt: version.updated_at,
    nextStatus: input.status,
    sealHash,
    actorUserId: userId,
    eventMetadata: statusEventMetadata as Json,
    occurredAt: new Date().toISOString(),
  });

  return {
    version: data,
  };
}

export async function verifyEstimateSeal(versionId: string) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;

  await getVersionAccessOrThrow(supabase, versionId, context);

  const sealSource = await loadEstimateSealSource({
    supabase,
    tenantId,
    versionId,
  });
  const sealPayload = buildCanonicalEstimateSealPayload(sealSource);
  const computedHash = computeEstimateSealHash(sealPayload);
  const storedHash = sealSource.version.seal_hash?.trim().toLowerCase() || null;
  const isValid = storedHash !== null && computedHash === storedHash;

  await logEstimateVersionEvent({
    versionId,
    eventType: "seal_verified",
    actorUserId: userId,
    metadata: {
      valid: isValid,
      computed_hash: computedHash,
      stored_hash: storedHash,
    },
    occurredAt: new Date().toISOString(),
  });

  return {
    valid: isValid,
    computed_hash: computedHash,
    stored_hash: storedHash,
  };
}

export async function createEstimateCategory(
  versionId: string,
  input: CreateEstimateCategoryInput
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version, project } = await getVersionAccessOrThrow(supabase, versionId, context);
  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId,
    userId,
  });

  const position =
    input.position ??
    (await getNextCategoryPosition(supabase, context, project.user_id));

  const { data, error } = await supabase
    .from("estimate_categories")
    .insert({
      tenant_id: tenantId,
      user_id: project.user_id,
      name: input.name.trim(),
      color: toNullableText(input.color),
      position,
    } as EstimateCategoryInsert)
    .select("*")
    .single();

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(error, "Impossible de creer la categorie.");
    }
    throw badRequest("Impossible de creer la categorie.");
  }

  return {
    category: data,
  };
}

export async function createLaborRole(
  versionId: string,
  input: CreateLaborRoleInput
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version, project } = await getVersionAccessOrThrow(supabase, versionId, context);
  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId,
    userId,
  });

  const position =
    input.position ??
    (await getNextLaborRolePosition(supabase, context, project.user_id));

  const { data, error } = await supabase
    .from("labor_roles")
    .insert({
      tenant_id: tenantId,
      user_id: project.user_id,
      name: input.name.trim(),
      hourly_rate_cents: input.hourly_rate_cents ?? 0,
      is_active: input.is_active ?? true,
      position,
    } as LaborRoleInsert)
    .select("*")
    .single();

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(error, "Impossible de creer le role.");
    }
    throw badRequest("Impossible de creer le role.");
  }

  return {
    labor_role: data,
  };
}

export async function updateLaborRole(
  versionId: string,
  roleId: string,
  input: UpdateLaborRoleInput
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version, project } = await getVersionAccessOrThrow(supabase, versionId, context);
  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId,
    userId,
  });

  const existingRoleQuery = supabase
    .from("labor_roles")
    .select("id")
    .eq("id", roleId)
    .eq("tenant_id", tenantId)
    .eq("user_id", project.user_id);

  const { data: existingRole, error: existingRoleError } = await existingRoleQuery.single();

  if (existingRoleError || !existingRole) {
    throw notFound("Role introuvable.");
  }

  const payload: LaborRoleUpdate = {};
  if ("name" in input) payload.name = input.name;
  if ("hourly_rate_cents" in input) {
    payload.hourly_rate_cents = input.hourly_rate_cents;
  }
  if ("is_active" in input) payload.is_active = input.is_active;
  if ("position" in input) payload.position = input.position;

  const updateRoleQuery = supabase
    .from("labor_roles")
    .update(payload)
    .eq("id", roleId)
    .eq("tenant_id", tenantId)
    .eq("user_id", project.user_id);

  const { data, error } = await updateRoleQuery.select("*").single();

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(error, "Impossible de mettre a jour le role.");
    }
    throw badRequest("Impossible de mettre a jour le role.");
  }

  return {
    labor_role: data,
  };
}

async function getNextMarginTierPosition(
  supabase: Supabase,
  tenantId: string
) {
  const { data, error } = await supabase
    .from("margin_tiers")
    .select("position")
    .eq("tenant_id", tenantId)
    .order("position", { ascending: false })
    .limit(1);

  if (error) {
    throw mapSupabaseError(error, "Impossible de determiner la prochaine position.");
  }

  return (data?.[0]?.position ?? 0) + 1;
}

export async function createMarginTier(input: CreateMarginTierInput) {
  const { supabase, tenantId, tenantRole } = await getAuthenticatedContext();

  if (!isTenantAdmin(tenantRole)) {
    throw forbidden("Seul un administrateur peut gerer les tranches de marge.");
  }

  const position =
    input.position ?? (await getNextMarginTierPosition(supabase, tenantId));

  const { data, error } = await supabase
    .from("margin_tiers")
    .insert({
      tenant_id: tenantId,
      threshold_cents: input.threshold_cents,
      multiplier: input.multiplier,
      position,
    } as MarginTierInsert)
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      if (error.message?.includes("threshold_cents")) {
        throw conflict("Une tranche avec ce seuil existe deja pour ce tenant.");
      }
      if (error.message?.includes("position")) {
        throw conflict("Une tranche avec cette position existe deja pour ce tenant.");
      }
      throw conflict("Conflit de donnees.", error);
    }
    throw mapSupabaseError(error, "Impossible de creer la tranche de marge.");
  }

  if (!data) {
    throw badRequest("Impossible de creer la tranche de marge.");
  }

  return { margin_tier: data };
}

export async function updateMarginTier(
  tierId: string,
  input: UpdateMarginTierInput
) {
  const { supabase, tenantId, tenantRole } = await getAuthenticatedContext();

  if (!isTenantAdmin(tenantRole)) {
    throw forbidden("Seul un administrateur peut gerer les tranches de marge.");
  }

  const { data: existing, error: existingError } = await supabase
    .from("margin_tiers")
    .select("id")
    .eq("id", tierId)
    .eq("tenant_id", tenantId)
    .single();

  if (existingError || !existing) {
    throw notFound("Tranche de marge introuvable.");
  }

  const payload: MarginTierUpdate = {};
  if ("threshold_cents" in input) payload.threshold_cents = input.threshold_cents;
  if ("multiplier" in input) payload.multiplier = input.multiplier;
  if ("position" in input) payload.position = input.position;

  const { data, error } = await supabase
    .from("margin_tiers")
    .update(payload)
    .eq("id", tierId)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      if (error.message?.includes("threshold_cents")) {
        throw conflict("Une tranche avec ce seuil existe deja pour ce tenant.");
      }
      if (error.message?.includes("position")) {
        throw conflict("Une tranche avec cette position existe deja pour ce tenant.");
      }
      throw conflict("Conflit de donnees.", error);
    }
    throw mapSupabaseError(error, "Impossible de mettre a jour la tranche de marge.");
  }

  if (!data) {
    throw badRequest("Impossible de mettre a jour la tranche de marge.");
  }

  return { margin_tier: data };
}

export async function deleteMarginTier(tierId: string) {
  const { supabase, tenantId, tenantRole } = await getAuthenticatedContext();

  if (!isTenantAdmin(tenantRole)) {
    throw forbidden("Seul un administrateur peut gerer les tranches de marge.");
  }

  const { data: existing, error: existingError } = await supabase
    .from("margin_tiers")
    .select("id")
    .eq("id", tierId)
    .eq("tenant_id", tenantId)
    .single();

  if (existingError || !existing) {
    throw notFound("Tranche de marge introuvable.");
  }

  const { error } = await supabase
    .from("margin_tiers")
    .delete()
    .eq("id", tierId)
    .eq("tenant_id", tenantId);

  if (error) {
    throw mapSupabaseError(error, "Impossible de supprimer la tranche de marge.");
  }

  return { deleted: true };
}

export async function createSuggestionRule(
  versionId: string,
  input: CreateSuggestionRuleInput
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version, project } = await getVersionAccessOrThrow(supabase, versionId, context);
  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId,
    userId,
  });

  const categoryId = input.category_id ?? null;
  const laborRoleId = input.labor_role_id ?? null;
  await ensureCategoryIsValid(supabase, categoryId, context, project.user_id);
  await ensureLaborRoleIsValid(supabase, laborRoleId, context, project.user_id);

  const position =
    input.position ??
    (await getNextSuggestionRulePosition(supabase, context, project.user_id));

  const { data, error } = await supabase
    .from("estimate_suggestion_rules")
    .insert({
      tenant_id: tenantId,
      user_id: project.user_id,
      name: input.name.trim(),
      match_type: input.match_type ?? "keyword",
      match_value: input.match_value.trim(),
      unit: toNullableText(input.unit),
      category_id: categoryId,
      k_fo: input.k_fo ?? null,
      k_mo: input.k_mo ?? null,
      labor_role_id: laborRoleId,
      position,
      is_active: input.is_active ?? true,
    } as SuggestionRuleInsert)
    .select("*")
    .single();

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(error, "Impossible de creer la regle.");
    }
    throw badRequest("Impossible de creer la regle.");
  }

  return {
    suggestion_rule: data,
  };
}

export async function updateSuggestionRule(
  versionId: string,
  ruleId: string,
  input: UpdateSuggestionRuleInput
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version, project } = await getVersionAccessOrThrow(supabase, versionId, context);
  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId,
    userId,
  });

  const existingRuleQuery = supabase
    .from("estimate_suggestion_rules")
    .select("id")
    .eq("id", ruleId)
    .eq("tenant_id", tenantId)
    .eq("user_id", project.user_id);

  const { data: existingRule, error: existingRuleError } = await existingRuleQuery.single();

  if (existingRuleError || !existingRule) {
    throw notFound("Regle introuvable.");
  }

  const categoryId =
    "category_id" in input ? (input.category_id ?? null) : undefined;
  const laborRoleId =
    "labor_role_id" in input ? (input.labor_role_id ?? null) : undefined;

  if (categoryId !== undefined) {
    await ensureCategoryIsValid(supabase, categoryId, context, project.user_id);
  }
  if (laborRoleId !== undefined) {
    await ensureLaborRoleIsValid(supabase, laborRoleId, context, project.user_id);
  }

  const payload: SuggestionRuleUpdate = {};
  if ("name" in input) payload.name = input.name;
  if ("match_type" in input) payload.match_type = input.match_type;
  if ("match_value" in input) payload.match_value = input.match_value;
  if ("unit" in input) payload.unit = toNullableText(input.unit);
  if ("category_id" in input) payload.category_id = input.category_id ?? null;
  if ("k_fo" in input) payload.k_fo = input.k_fo ?? null;
  if ("k_mo" in input) payload.k_mo = input.k_mo ?? null;
  if ("labor_role_id" in input) {
    payload.labor_role_id = input.labor_role_id ?? null;
  }
  if ("position" in input) payload.position = input.position;
  if ("is_active" in input) payload.is_active = input.is_active;

  const updateRuleQuery = supabase
    .from("estimate_suggestion_rules")
    .update(payload)
    .eq("id", ruleId)
    .eq("tenant_id", tenantId)
    .eq("user_id", project.user_id);

  const { data, error } = await updateRuleQuery.select("*").single();

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(error, "Impossible de mettre a jour la regle.");
    }
    throw badRequest("Impossible de mettre a jour la regle.");
  }

  return {
    suggestion_rule: data,
  };
}

function toSuggestionUsageCount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return 0;
}

function toSuggestionFeedbackIncrement(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
    return Math.floor(value);
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return parsed;
    }
  }

  return 1;
}

export async function saveSuggestionRuleFeedback(
  versionId: string,
  ruleId: string,
  input: SuggestionRuleFeedbackInput
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version, project } = await getVersionAccessOrThrow(supabase, versionId, context);
  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId,
    userId,
  });

  const existingRuleQuery = supabase
    .from("estimate_suggestion_rules")
    .select("*")
    .eq("id", ruleId)
    .eq("tenant_id", tenantId)
    .eq("user_id", project.user_id);

  const { data: existingRule, error: existingRuleError } =
    await existingRuleQuery.single();

  if (existingRuleError || !existingRule) {
    throw notFound("Regle introuvable.");
  }

  if (input.feedback === "reject") {
    return {
      suggestion_rule: existingRule,
      feedback: input.feedback,
    };
  }

  const existingRuleRecord = existingRule as unknown as Record<string, unknown>;
  let usageCount = toSuggestionUsageCount(existingRuleRecord.usage_count);
  const incrementBy = toSuggestionFeedbackIncrement(input.count);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const nowIso = new Date().toISOString();
    const payload: SuggestionRuleUpdate = {
      usage_count: usageCount + incrementBy,
      last_used_at: nowIso,
    };

    const updateRuleQuery = supabase
      .from("estimate_suggestion_rules")
      .update(payload)
      .eq("id", ruleId)
      .eq("tenant_id", tenantId)
      .eq("user_id", project.user_id)
      .eq("usage_count", usageCount);

    const { data, error } = await updateRuleQuery.select("*").maybeSingle();

    if (error) {
      throw mapSupabaseError(error, "Impossible d'enregistrer le feedback de la regle.");
    }

    if (data) {
      return {
        suggestion_rule: data,
        feedback: input.feedback,
      };
    }

    const { data: latestRule, error: latestRuleError } = await supabase
      .from("estimate_suggestion_rules")
      .select("usage_count")
      .eq("id", ruleId)
      .eq("tenant_id", tenantId)
      .eq("user_id", project.user_id)
      .maybeSingle();

    if (latestRuleError) {
      throw mapSupabaseError(
        latestRuleError,
        "Impossible d'enregistrer le feedback de la regle."
      );
    }

    if (!latestRule) {
      throw notFound("Regle introuvable.");
    }

    usageCount = toSuggestionUsageCount(
      (latestRule as unknown as Record<string, unknown>).usage_count
    );
  }

  throw conflict("La regle a ete modifiee simultanement. Veuillez reessayer.");
}

export async function createEstimateItem(
  versionId: string,
  input: CreateEstimateItemInput
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version, project } = await getVersionAccessOrThrow(
    supabase,
    versionId,
    context
  );

  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId,
    userId,
  });

  const parentId = input.parent_id ?? null;
  const parent = await ensureParentIsValid({
    supabase,
    tenantId,
    versionId,
    parentId,
  });
  const maxSectionDepth = clampMaxSectionDepth(
    version.max_section_depth,
    DEFAULT_MAX_SECTION_DEPTH
  );
  const parentSectionLevel = await resolveSectionLevelFromParent({
    supabase,
    tenantId,
    versionId,
    parent,
  });

  const position = input.position ?? (await getNextItemPosition(supabase, versionId, parentId));
  const aidRegex = await resolveEstimateItemAidRegex({ tenantId, supabase });
  const aid = normalizeEstimateItemAid(input.aid);

  assertEstimateItemAidFormat({
    aid,
    aidRegex,
  });
  const sourceProvider = toNullableText(input.source_provider) ?? "manual";
  const sourceJobId = input.source_job_id ?? null;
  const sourceFileName = toNullableText(input.source_file_name);
  const sourcePage = input.source_page ?? null;

  if (input.item_type === "section") {
    const nextSectionLevel =
      parentSectionLevel === null ? 1 : parentSectionLevel + 1;
    assertSectionPlacementAllowed({
      maxSectionDepth,
      nextSectionLevel,
    });
    const title =
      input.title ?? getDefaultSectionTitleForLevel(nextSectionLevel);

    const { data, error } = await supabase
      .from("estimate_items")
      .insert({
        tenant_id: tenantId,
        version_id: versionId,
        parent_id: parentId,
        item_type: "section",
        position,
        title,
        aid,
        source_provider: sourceProvider,
        source_job_id: sourceJobId,
        source_file_name: sourceFileName,
        source_page: sourcePage,
      } as EstimateItemInsert)
      .select("*")
      .single();

    if (error || !data) {
      if (error) {
        throw mapSupabaseError(error, "Impossible de creer le chapitre.");
      }
      throw badRequest("Impossible de creer le chapitre.");
    }

    return {
      item: data,
    };
  }

  const title = input.title ?? "Nouvelle ligne";
  const description = toNullableText(input.description);
  const quantity = input.quantity ?? 1;
  const unitPriceHtCents = input.unit_price_ht_cents ?? 0;
  const taxRateBp = input.tax_rate_bp ?? version.tax_rate_bp ?? DEFAULT_TAX_RATE_BP;
  const kFo = input.k_fo ?? 1;
  const hMo = input.h_mo ?? 0;
  const hMoMajoration = input.h_mo_majoration ?? 1;
  const kMo = input.k_mo ?? 1;
  const hMoAtelier = input.h_mo_atelier ?? null;
  const kMoAtelier = input.k_mo_atelier ?? null;
  const laborRoleAtelierId = input.labor_role_atelier_id ?? null;
  const hMoChantier = input.h_mo_chantier ?? null;
  const kMoChantier = input.k_mo_chantier ?? null;
  const laborRoleChantierId = input.labor_role_chantier_id ?? null;
  const laborRoleId = input.labor_role_id ?? null;
  const categoryId = input.category_id ?? null;
  const supplyTypeId = input.supply_type_id ?? null;
  const selectedSupplierPriceId = input.selected_supplier_price_id ?? null;
  assertLinePlacementAllowed({
    maxSectionDepth,
    parentSectionLevel,
  });
  const isLaborSplitEnabled = isLaborSplitEnabledForItem({
    h_mo_atelier: hMoAtelier,
    k_mo_atelier: kMoAtelier,
    labor_role_atelier_id: laborRoleAtelierId,
    h_mo_chantier: hMoChantier,
    k_mo_chantier: kMoChantier,
    labor_role_chantier_id: laborRoleChantierId,
  });

  const [
    laborRateLegacyCents,
    laborRateAtelierCents,
    laborRateChantierCents,
  ] = await Promise.all([
    (async () => {
      await Promise.all([
        ensureCategoryIsValid(supabase, categoryId, context, project.user_id),
        ensureSupplyTypeIsValid(supabase, supplyTypeId, context),
        ensureSupplierPriceIsValid(supabase, selectedSupplierPriceId, context),
      ]);

      return resolveLaborRateCents(supabase, laborRoleId, context, project.user_id);
    })(),
    resolveLaborRateCents(
      supabase,
      laborRoleAtelierId,
      context,
      project.user_id
    ),
    resolveLaborRateCents(
      supabase,
      laborRoleChantierId,
      context,
      project.user_id
    ),
  ]);

  const lineValues = computeEstimateLineValues(
    {
      quantity,
      unit_price_ht_cents: unitPriceHtCents,
      tax_rate_bp: taxRateBp,
      k_fo: kFo,
      h_mo: hMo,
      h_mo_majoration: hMoMajoration,
      k_mo: kMo,
      h_mo_atelier: hMoAtelier,
      k_mo_atelier: kMoAtelier,
      labor_role_atelier_id: laborRoleAtelierId,
      h_mo_chantier: hMoChantier,
      k_mo_chantier: kMoChantier,
      labor_role_chantier_id: laborRoleChantierId,
      pu_ht_cents: 0,
      labor_role_hourly_rate_cents: laborRateLegacyCents,
    },
    {
      marginMultiplier: version.margin_multiplier,
      taxRateBp,
      isLaborSplitEnabled,
      laborRateAtelierCents,
      laborRateChantierCents,
    }
  );

  const { data, error } = await supabase
    .from("estimate_items")
    .insert({
      tenant_id: tenantId,
      version_id: versionId,
      parent_id: parentId,
      item_type: "line",
      position,
      title,
      aid,
      description,
      quantity,
      unit_price_ht_cents: unitPriceHtCents,
      tax_rate_bp: taxRateBp,
      k_fo: kFo,
      h_mo: hMo,
      h_mo_majoration: hMoMajoration,
      k_mo: kMo,
      h_mo_atelier: hMoAtelier,
      k_mo_atelier: kMoAtelier,
      labor_role_atelier_id: laborRoleAtelierId,
      h_mo_chantier: hMoChantier,
      k_mo_chantier: kMoChantier,
      labor_role_chantier_id: laborRoleChantierId,
      pu_ht_cents: lineValues.puHtCents,
      labor_role_id: laborRoleId,
      category_id: categoryId,
      supply_type_id: supplyTypeId,
      selected_supplier_price_id: selectedSupplierPriceId,
      source_provider: sourceProvider,
      source_job_id: sourceJobId,
      source_file_name: sourceFileName,
      source_page: sourcePage,
      line_total_ht_cents: lineValues.saleLineCents,
      line_tax_cents: lineValues.taxLineCents,
      line_total_ttc_cents: lineValues.ttcLineCents,
    } as EstimateItemInsert)
    .select("*")
    .single();

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(error, "Impossible de creer la ligne.");
    }
    throw badRequest("Impossible de creer la ligne.");
  }

  return {
    item: data,
  };
}

const SECTION_ONLY_FORBIDDEN_FIELDS: (keyof UpdateEstimateItemInput)[] = [
  "description",
  "quantity",
  "unit_price_ht_cents",
  "tax_rate_bp",
  "k_fo",
  "h_mo",
  "h_mo_majoration",
  "k_mo",
  "h_mo_atelier",
  "k_mo_atelier",
  "labor_role_atelier_id",
  "h_mo_chantier",
  "k_mo_chantier",
  "labor_role_chantier_id",
  "pu_ht_cents",
  "line_total_ht_cents",
  "line_tax_cents",
  "line_total_ttc_cents",
  "labor_role_id",
  "category_id",
  "supply_type_id",
  "selected_supplier_price_id",
];

export async function updateEstimateItem(
  versionId: string,
  input: UpdateEstimateItemInput
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version, project } = await getVersionAccessOrThrow(
    supabase,
    versionId,
    context
  );

  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId,
    userId,
  });

  const { data: currentItem, error: currentItemError } = await supabase
    .from("estimate_items")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", input.id)
    .eq("version_id", versionId)
    .single();

  if (currentItemError || !currentItem) {
    throw notFound("Element de chiffrage introuvable.");
  }

  const nextParentId =
    "parent_id" in input ? (input.parent_id ?? null) : currentItem.parent_id;

  const nextParent = await ensureParentIsValid({
    supabase,
    tenantId,
    versionId,
    parentId: nextParentId,
    itemId: currentItem.id,
  });
  const maxSectionDepth = clampMaxSectionDepth(
    version.max_section_depth,
    DEFAULT_MAX_SECTION_DEPTH
  );
  const parentSectionLevel = await resolveSectionLevelFromParent({
    supabase,
    tenantId,
    versionId,
    parent: nextParent,
  });
  const aidRegex = await resolveEstimateItemAidRegex({ tenantId, supabase });

  const targetItemType =
    "item_type" in input ? input.item_type : currentItem.item_type;
  const isConvertingLineToSection =
    currentItem.item_type === "line" && targetItemType === "section";
  const isConvertingSectionToLine =
    currentItem.item_type === "section" && targetItemType === "line";

  let hierarchyIndexForStructureChecks:
    | ReturnType<typeof buildHierarchyIndex>
    | null = null;
  const resolveHierarchyIndexForStructureChecks = async () => {
    if (hierarchyIndexForStructureChecks) {
      return hierarchyIndexForStructureChecks;
    }

    const hierarchyItems = await loadHierarchyItems({
      supabase,
      tenantId,
      versionId,
    });
    hierarchyIndexForStructureChecks = buildHierarchyIndex(hierarchyItems);
    return hierarchyIndexForStructureChecks;
  };

  if (targetItemType === "section") {
    const nextSectionLevel = parentSectionLevel === null ? 1 : parentSectionLevel + 1;
    assertSectionPlacementAllowed({
      maxSectionDepth,
      nextSectionLevel,
    });

    if (currentItem.item_type === "section") {
      const hierarchyIndex = await resolveHierarchyIndexForStructureChecks();
      if (isAncestorOrSelf(hierarchyIndex, currentItem.id, nextParentId)) {
        throw badRequest(
          "Une section ne peut pas etre deplacee dans sa propre descendance."
        );
      }
      assertSectionSubtreePlacementAllowed({
        hierarchyIndex,
        sectionId: currentItem.id,
        nextSectionLevel,
        maxSectionDepth,
      });
    }

    const containsLineFields = SECTION_ONLY_FORBIDDEN_FIELDS.some((fieldName) => {
      return fieldName in input;
    });

    if (containsLineFields) {
      throw badRequest("Les champs de ligne ne sont pas autorises pour une section.");
    }

    const payload: EstimateItemUpdate = {};

    if ("title" in input) {
      payload.title = input.title;
    }

    if ("parent_id" in input) {
      payload.parent_id = input.parent_id ?? null;
    }

    if ("position" in input) {
      payload.position = input.position;
    }

    if ("aid" in input) {
      const nextAid = normalizeEstimateItemAid(input.aid);
      assertEstimateItemAidFormat({
        aid: nextAid,
        aidRegex,
      });
      payload.aid = nextAid;
    }

    if (isConvertingLineToSection) {
      Object.assign(
        payload,
        {
          item_type: "section",
          description: null,
          quantity: null,
          unit_price_ht_cents: null,
          tax_rate_bp: null,
          k_fo: null,
          h_mo: null,
          h_mo_majoration: null,
          k_mo: null,
          h_mo_atelier: null,
          k_mo_atelier: null,
          labor_role_atelier_id: null,
          h_mo_chantier: null,
          k_mo_chantier: null,
          labor_role_chantier_id: null,
          pu_ht_cents: null,
          labor_role_id: null,
          category_id: null,
          supply_type_id: null,
          selected_supplier_price_id: null,
          line_total_ht_cents: null,
          line_tax_cents: null,
          line_total_ttc_cents: null,
        } as unknown as EstimateItemUpdate
      );
    }

    const { data, error } = await supabase
      .from("estimate_items")
      .update(payload)
      .eq("tenant_id", tenantId)
      .eq("id", currentItem.id)
      .eq("version_id", versionId)
      .select("*")
      .single();

    if (error || !data) {
      if (error) {
        throw mapSupabaseError(error, "Impossible de mettre a jour la section.");
      }
      throw badRequest("Impossible de mettre a jour la section.");
    }

    return {
      item: data,
      ...(isConvertingLineToSection
        ? { converted_from_item_type: "line" as const }
        : {}),
    };
  }

  const nextAid =
    "aid" in input
      ? normalizeEstimateItemAid(input.aid)
      : (normalizeEstimateItemAid((currentItem as EstimateItemRow).aid) ?? null);
  if ("aid" in input) {
    assertEstimateItemAidFormat({
      aid: nextAid,
      aidRegex,
    });
  }

  const currentLineDefaults =
    currentItem.item_type === "line"
      ? currentItem
      : ({
          quantity: 1,
          unit_price_ht_cents: 0,
          tax_rate_bp: version.tax_rate_bp ?? DEFAULT_TAX_RATE_BP,
          k_fo: 1,
          h_mo: 0,
          h_mo_majoration: 1,
          k_mo: 1,
          h_mo_atelier: null,
          k_mo_atelier: null,
          labor_role_atelier_id: null,
          h_mo_chantier: null,
          k_mo_chantier: null,
          labor_role_chantier_id: null,
          labor_role_id: null,
          category_id: null,
          supply_type_id: null,
          selected_supplier_price_id: null,
          description: null,
          pu_ht_cents: 0,
        } satisfies Partial<EstimateItemRow>);

  const nextTitle =
    ("title" in input ? input.title : currentItem.title) ?? currentItem.title;
  const nextDescription =
    ("description" in input
      ? toNullableText(input.description)
      : (currentLineDefaults.description ?? null)) ?? null;
  const nextQuantity =
    ("quantity" in input
      ? input.quantity
      : (currentLineDefaults.quantity ?? 1)) ?? 1;
  const nextUnitPriceHtCents =
    ("unit_price_ht_cents" in input
      ? input.unit_price_ht_cents
      : (currentLineDefaults.unit_price_ht_cents ?? 0)) ?? 0;
  const nextTaxRateBp =
    ("tax_rate_bp" in input
      ? input.tax_rate_bp
      : (currentLineDefaults.tax_rate_bp ?? null)) ??
    version.tax_rate_bp ??
    DEFAULT_TAX_RATE_BP;
  const nextKFo = ("k_fo" in input ? input.k_fo : (currentLineDefaults.k_fo ?? 1)) ?? 1;
  const nextHMo = ("h_mo" in input ? input.h_mo : (currentLineDefaults.h_mo ?? 0)) ?? 0;
  const nextHMoMajoration =
    ("h_mo_majoration" in input
      ? input.h_mo_majoration
      : (currentLineDefaults.h_mo_majoration ?? 1)) ?? 1;
  const nextKMo = ("k_mo" in input ? input.k_mo : (currentLineDefaults.k_mo ?? 1)) ?? 1;
  const nextHMoAtelier =
    "h_mo_atelier" in input
      ? input.h_mo_atelier ?? null
      : (currentLineDefaults.h_mo_atelier ?? null);
  const nextKMoAtelier =
    "k_mo_atelier" in input
      ? input.k_mo_atelier ?? null
      : (currentLineDefaults.k_mo_atelier ?? null);
  const nextLaborRoleAtelierId =
    "labor_role_atelier_id" in input
      ? input.labor_role_atelier_id ?? null
      : (currentLineDefaults.labor_role_atelier_id ?? null);
  const nextHMoChantier =
    "h_mo_chantier" in input
      ? input.h_mo_chantier ?? null
      : (currentLineDefaults.h_mo_chantier ?? null);
  const nextKMoChantier =
    "k_mo_chantier" in input
      ? input.k_mo_chantier ?? null
      : (currentLineDefaults.k_mo_chantier ?? null);
  const nextLaborRoleChantierId =
    "labor_role_chantier_id" in input
      ? input.labor_role_chantier_id ?? null
      : (currentLineDefaults.labor_role_chantier_id ?? null);
  const nextLaborRoleId =
    "labor_role_id" in input
      ? (input.labor_role_id ?? null)
      : (currentLineDefaults.labor_role_id ?? null);
  const nextCategoryId =
    "category_id" in input
      ? (input.category_id ?? null)
      : (currentLineDefaults.category_id ?? null);
  const nextSupplyTypeId =
    "supply_type_id" in input
      ? (input.supply_type_id ?? null)
      : (currentLineDefaults.supply_type_id ?? null);
  const nextSelectedSupplierPriceId =
    "selected_supplier_price_id" in input
      ? (input.selected_supplier_price_id ?? null)
      : (currentLineDefaults.selected_supplier_price_id ?? null);
  const nextPosition =
    ("position" in input ? input.position : currentItem.position) ??
    currentItem.position;

  assertLinePlacementAllowed({
    maxSectionDepth,
    parentSectionLevel,
  });

  if (isConvertingSectionToLine) {
    const { data: sectionChildren, error: sectionChildrenError } = await supabase
      .from("estimate_items")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("version_id", versionId)
      .eq("parent_id", currentItem.id)
      .limit(1);

    if (sectionChildrenError) {
      throw mapSupabaseError(
        sectionChildrenError,
        "Impossible de verifier les enfants de la section."
      );
    }

    if ((sectionChildren ?? []).length > 0) {
      throw badRequest(
        "Une section avec enfants ne peut pas etre convertie en ligne."
      );
    }
  }

  const isLaborSplitEnabled = isLaborSplitEnabledForItem({
    h_mo_atelier: nextHMoAtelier,
    k_mo_atelier: nextKMoAtelier,
    labor_role_atelier_id: nextLaborRoleAtelierId,
    h_mo_chantier: nextHMoChantier,
    k_mo_chantier: nextKMoChantier,
    labor_role_chantier_id: nextLaborRoleChantierId,
  });

  const [
    laborRateLegacyCents,
    laborRateAtelierCents,
    laborRateChantierCents,
  ] = await Promise.all([
    (async () => {
      await Promise.all([
        ensureCategoryIsValid(supabase, nextCategoryId, context, project.user_id),
        ensureSupplyTypeIsValid(supabase, nextSupplyTypeId, context),
        ensureSupplierPriceIsValid(supabase, nextSelectedSupplierPriceId, context),
      ]);
      return resolveLaborRateCents(
        supabase,
        nextLaborRoleId,
        context,
        project.user_id
      );
    })(),
    resolveLaborRateCents(
      supabase,
      nextLaborRoleAtelierId,
      context,
      project.user_id
    ),
    resolveLaborRateCents(
      supabase,
      nextLaborRoleChantierId,
      context,
      project.user_id
    ),
  ]);

  const lineValues = computeEstimateLineValues(
    {
      quantity: nextQuantity,
      unit_price_ht_cents: nextUnitPriceHtCents,
      tax_rate_bp: nextTaxRateBp,
      k_fo: nextKFo,
      h_mo: nextHMo,
      h_mo_majoration: nextHMoMajoration,
      k_mo: nextKMo,
      h_mo_atelier: nextHMoAtelier,
      k_mo_atelier: nextKMoAtelier,
      labor_role_atelier_id: nextLaborRoleAtelierId,
      h_mo_chantier: nextHMoChantier,
      k_mo_chantier: nextKMoChantier,
      labor_role_chantier_id: nextLaborRoleChantierId,
      pu_ht_cents: currentLineDefaults.pu_ht_cents ?? 0,
      labor_role_hourly_rate_cents: laborRateLegacyCents,
    },
    {
      marginMultiplier: version.margin_multiplier,
      taxRateBp: nextTaxRateBp,
      isLaborSplitEnabled,
      laborRateAtelierCents,
      laborRateChantierCents,
    }
  );

  const payload: EstimateItemUpdate = {
    item_type: "line",
    parent_id: nextParentId,
    position: nextPosition,
    title: nextTitle,
    aid: nextAid,
    description: nextDescription,
    quantity: nextQuantity,
    unit_price_ht_cents: nextUnitPriceHtCents,
    tax_rate_bp: nextTaxRateBp,
    k_fo: nextKFo,
    h_mo: nextHMo,
    h_mo_majoration: nextHMoMajoration,
    k_mo: nextKMo,
    h_mo_atelier: nextHMoAtelier,
    k_mo_atelier: nextKMoAtelier,
    labor_role_atelier_id: nextLaborRoleAtelierId,
    h_mo_chantier: nextHMoChantier,
    k_mo_chantier: nextKMoChantier,
    labor_role_chantier_id: nextLaborRoleChantierId,
    pu_ht_cents: lineValues.puHtCents,
    labor_role_id: nextLaborRoleId,
    category_id: nextCategoryId,
    supply_type_id: nextSupplyTypeId,
    selected_supplier_price_id: nextSelectedSupplierPriceId,
    line_total_ht_cents: lineValues.saleLineCents,
    line_tax_cents: lineValues.taxLineCents,
    line_total_ttc_cents: lineValues.ttcLineCents,
  };
  const { data, error } = await supabase
    .from("estimate_items")
    .update(payload)
    .eq("tenant_id", tenantId)
    .eq("id", currentItem.id)
    .eq("version_id", versionId)
    .select("*")
    .single();

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(error, "Impossible de mettre a jour la ligne.");
    }
    throw badRequest("Impossible de mettre a jour la ligne.");
  }

  return {
    item: data,
    ...(isConvertingSectionToLine
      ? { converted_from_item_type: "section" as const }
      : {}),
  };
}

export async function bulkUpdateEstimateItems(
  versionId: string,
  input: BulkUpdateEstimateItemsInput,
  concurrencyToken?: string,
  versionPatch?: BulkUpdateEstimateVersionPatchInput
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version } = await getVersionAccessOrThrow(supabase, versionId, context);

  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId,
    userId,
  });
  assertVersionConcurrencyToken(version.updated_at, concurrencyToken);

  if (versionPatch) {
    const persistedTotals: EstimateTotals = {
      total_ht_cents: version.total_ht_cents ?? null,
      total_tax_cents: version.total_tax_cents ?? null,
      total_ttc_cents: version.total_ttc_cents ?? null,
    };

    await assertEstimateTotalsInvariantForPatch({
      supabase,
      tenantId,
      versionId,
      userId,
      persistedTotals,
      patch: versionPatch,
    });
  }

  const updatesPayload = input.map((item) => ({ ...item }));
  const aidRegex = await resolveEstimateItemAidRegex({ tenantId, supabase });

  updatesPayload.forEach((item) => {
    if (!Object.prototype.hasOwnProperty.call(item, "aid")) {
      return;
    }

    const nextAid = normalizeEstimateItemAid(
      (item as { aid?: string | null }).aid ?? null
    );
    assertEstimateItemAidFormat({
      aid: nextAid,
      aidRegex,
    });
    (item as { aid?: string | null }).aid = nextAid;
  });

  if (updatesPayload.length === 0 && !versionPatch) {
    return {
      updated_count: 0,
      version: {
        id: version.id,
        updated_at: version.updated_at,
      },
    };
  }

  const supplierPriceIdsToValidate = new Set<string | null>();
  updatesPayload.forEach((item) => {
    if (!Object.prototype.hasOwnProperty.call(item, "selected_supplier_price_id")) {
      return;
    }

    supplierPriceIdsToValidate.add(item.selected_supplier_price_id ?? null);
  });

  await Promise.all(
    Array.from(supplierPriceIdsToValidate).map((supplierPriceId) =>
      ensureSupplierPriceIsValid(supabase, supplierPriceId, context)
    )
  );

  const { data: rpcUpdatedCount, error: bulkUpdateError } = await supabase.rpc(
    "bulk_update_estimate_items",
    {
      target_version_id: versionId,
      item_updates: updatesPayload,
      version_patch: versionPatch ?? null,
      expected_version_updated_at: version.updated_at,
    }
  );

  if (bulkUpdateError) {
    if (
      bulkUpdateError.code === "P0001" &&
      bulkUpdateError.message === STALE_BULK_UPDATE_ERROR_MESSAGE
    ) {
      const parsedDetails = parseBulkUpdateCountDetails(bulkUpdateError.details);
      throw conflict(
        "La liste de mise a jour est obsolete.",
        parsedDetails ?? {
          expected_count: input.length,
        }
      );
    }

    throw mapSupabaseError(
      bulkUpdateError,
      "Impossible de mettre a jour les lignes."
    );
  }

  const updatedVersion = await fetchEstimateVersionToken({
    supabase,
    tenantId,
    versionId,
  });

  return {
    updated_count: rpcUpdatedCount ?? 0,
    version: updatedVersion,
  };
}

export async function claimEstimateBatchRevision(
  versionId: string,
  concurrencyToken: string | undefined
) {
  const normalizedToken = normalizeConcurrencyToken(concurrencyToken);
  if (!normalizedToken) {
    throw badRequest("Jeton de concurrence manquant.");
  }
  if (!Number.isFinite(new Date(normalizedToken).getTime())) {
    throw badRequest("Jeton de concurrence invalide.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(
    "claim_estimate_batch_revision" as never,
    {
      p_version_id: versionId,
      p_expected_updated_at: normalizedToken,
    } as never
  );

  if (error) {
    if (
      error.code === "40001" ||
      error.message.includes("ESTIMATE_BATCH_REVISION_CONFLICT")
    ) {
      throw conflict(VERSION_CONFLICT_ERROR_MESSAGE, {
        updated_at: normalizedToken,
      }, "VERSION_CONFLICT");
    }
    throw mapSupabaseError(
      error,
      "Impossible de réserver la révision du traitement par lot."
    );
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw conflict(VERSION_CONFLICT_ERROR_MESSAGE, {
      updated_at: normalizedToken,
    }, "VERSION_CONFLICT");
  }

  return row as unknown as { id: string; updated_at: string };
}

export async function deleteEstimateItem(
  versionId: string,
  input: DeleteEstimateItemInput
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version } = await getVersionAccessOrThrow(supabase, versionId, context);

  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId,
    userId,
  });

  const { data: currentItem, error: currentItemError } = await supabase
    .from("estimate_items")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", input.id)
    .eq("version_id", versionId)
    .single();

  if (currentItemError || !currentItem) {
    throw notFound("Element de chiffrage introuvable.");
  }

  const { error } = await supabase
    .from("estimate_items")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", input.id)
    .eq("version_id", versionId);

  if (error) {
    throw mapSupabaseError(error, "Impossible de supprimer l'element.");
  }

  return {
    deleted_id: input.id,
  };
}

export async function reorderEstimateItems(
  versionId: string,
  input: ReorderEstimateItemsInput
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version } = await getVersionAccessOrThrow(supabase, versionId, context);

  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId,
    userId,
  });

  const parentId = input.parent_id ?? null;

  await ensureParentIsValid({
    supabase,
    tenantId,
    versionId,
    parentId,
  });

  let siblingsQuery = supabase
    .from("estimate_items")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("version_id", versionId);

  siblingsQuery = parentId === null
    ? siblingsQuery.is("parent_id", null)
    : siblingsQuery.eq("parent_id", parentId);

  const { data: siblings, error: siblingsError } = await siblingsQuery;

  if (siblingsError) {
    throw mapSupabaseError(siblingsError, "Impossible de charger les lignes a reordonner.");
  }

  const siblingIds = (siblings ?? []).map((item) => item.id);

  if (siblingIds.length === 0) {
    throw notFound("Aucun element a reordonner pour ce parent.");
  }

  const receivedSet = new Set(input.ordered_ids);
  const expectedSet = new Set(siblingIds);

  const hasUnknownIds = input.ordered_ids.some((id) => !expectedSet.has(id));
  const hasMissingIds = siblingIds.some((id) => !receivedSet.has(id));

  if (
    input.ordered_ids.length !== siblingIds.length ||
    hasUnknownIds ||
    hasMissingIds
  ) {
    throw conflict("La liste de reordonnancement est obsolete.", {
      expected_ids: siblingIds,
      received_ids: input.ordered_ids,
    });
  }

  const { data: updatedCount, error: reorderError } = await supabase.rpc(
    "reorder_estimate_items",
    {
      target_version_id: versionId,
      target_parent_id: parentId,
      ordered_item_ids: input.ordered_ids,
    }
  );

  if (reorderError) {
    throw mapSupabaseError(reorderError, "Impossible de reordonner les lignes.");
  }

  const normalizedUpdatedCount = updatedCount ?? 0;

  if (normalizedUpdatedCount !== input.ordered_ids.length) {
    throw conflict("La liste de reordonnancement est obsolete.", {
      expected_ids: siblingIds,
      received_ids: input.ordered_ids,
      updated_count: normalizedUpdatedCount,
    });
  }

  return {
    parent_id: parentId,
    ordered_ids: input.ordered_ids,
    updated_count: normalizedUpdatedCount,
  };
}

export async function moveEstimateItem(
  versionId: string,
  input: MoveEstimateItemInput
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version } = await getVersionAccessOrThrow(supabase, versionId, context);

  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId,
    userId,
  });

  const fromParentId = input.from_parent_id ?? null;
  const toParentId = input.to_parent_id ?? null;

  if (fromParentId === toParentId) {
    throw badRequest(
      "from_parent_id et to_parent_id doivent etre differents pour un move inter-parent."
    );
  }

  const { data: item, error: itemError } = await supabase
    .from("estimate_items")
    .select("id, version_id, parent_id, item_type")
    .eq("tenant_id", tenantId)
    .eq("id", input.item_id)
    .eq("version_id", versionId)
    .single();

  if (itemError || !item) {
    throw notFound("Element de chiffrage introuvable.");
  }

  if ((item.parent_id ?? null) !== fromParentId) {
    throw conflict("Le parent source est obsolete.", {
      item_id: item.id,
      expected_from_parent_id: item.parent_id ?? null,
      received_from_parent_id: fromParentId,
    });
  }

  const targetParent = await ensureParentIsValid({
    supabase,
    tenantId,
    versionId,
    parentId: toParentId,
    itemId: item.id,
  });
  const maxSectionDepth = clampMaxSectionDepth(
    version.max_section_depth,
    DEFAULT_MAX_SECTION_DEPTH
  );
  const hierarchyItems = await loadHierarchyItems({
    supabase,
    tenantId,
    versionId,
  });
  const hierarchyIndex = buildHierarchyIndex(hierarchyItems);
  const targetParentSectionLevel =
    targetParent === null ? null : resolveSectionLevel(hierarchyIndex, targetParent.id);

  if (item.item_type === "section") {
    if (isAncestorOrSelf(hierarchyIndex, item.id, toParentId)) {
      throw badRequest(
        "Une section ne peut pas etre deplacee dans sa propre descendance."
      );
    }

    const nextSectionLevel =
      targetParentSectionLevel === null ? 1 : targetParentSectionLevel + 1;
    assertSectionPlacementAllowed({
      maxSectionDepth,
      nextSectionLevel,
    });
    assertSectionSubtreePlacementAllowed({
      hierarchyIndex,
      sectionId: item.id,
      nextSectionLevel,
      maxSectionDepth,
    });
  } else {
    assertLinePlacementAllowed({
      maxSectionDepth,
      parentSectionLevel: targetParentSectionLevel,
    });
  }

  const loadSiblingIds = async (parentId: string | null) => {
    let query = supabase
      .from("estimate_items")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("version_id", versionId)
      .order("position", { ascending: true })
      .order("id", { ascending: true });

    query = parentId === null
      ? query.is("parent_id", null)
      : query.eq("parent_id", parentId);

    const { data: siblings, error: siblingsError } = await query;

    if (siblingsError) {
      throw mapSupabaseError(
        siblingsError,
        "Impossible de charger les items de deplacement."
      );
    }

    return (siblings ?? []).map((sibling) => sibling.id);
  };

  const sourceSiblings = await loadSiblingIds(fromParentId);

  if (!sourceSiblings.includes(item.id)) {
    throw conflict("La liste de deplacement est obsolete.", {
      reason: "item_not_in_source_parent",
      item_id: item.id,
      from_parent_id: fromParentId,
      observed_source_ids: sourceSiblings,
    });
  }

  const expectedSourceIds = sourceSiblings.filter((siblingId) => siblingId !== item.id);
  const expectedTargetIds = [...(await loadSiblingIds(toParentId)), item.id];

  if (input.ordered_source_ids.includes(item.id)) {
    throw badRequest("ordered_source_ids ne doit pas contenir item_id.");
  }

  if (!input.ordered_target_ids.includes(item.id)) {
    throw badRequest("ordered_target_ids doit contenir item_id.");
  }

  const sourceReceivedSet = new Set(input.ordered_source_ids);
  const targetReceivedSet = new Set(input.ordered_target_ids);

  if (input.ordered_source_ids.some((id) => targetReceivedSet.has(id))) {
    throw badRequest(
      "ordered_source_ids et ordered_target_ids ne doivent pas se chevaucher."
    );
  }

  const sourceExpectedSet = new Set(expectedSourceIds);
  const targetExpectedSet = new Set(expectedTargetIds);

  const sourceHasUnknownIds = input.ordered_source_ids.some(
    (id) => !sourceExpectedSet.has(id)
  );
  const sourceHasMissingIds = expectedSourceIds.some(
    (id) => !sourceReceivedSet.has(id)
  );

  const targetHasUnknownIds = input.ordered_target_ids.some(
    (id) => !targetExpectedSet.has(id)
  );
  const targetHasMissingIds = expectedTargetIds.some(
    (id) => !targetReceivedSet.has(id)
  );

  if (
    input.ordered_source_ids.length !== expectedSourceIds.length ||
    sourceHasUnknownIds ||
    sourceHasMissingIds ||
    input.ordered_target_ids.length !== expectedTargetIds.length ||
    targetHasUnknownIds ||
    targetHasMissingIds
  ) {
    throw conflict("La liste de deplacement est obsolete.", {
      item_id: item.id,
      from_parent_id: fromParentId,
      to_parent_id: toParentId,
      expected_source_ids: expectedSourceIds,
      received_source_ids: input.ordered_source_ids,
      expected_target_ids: expectedTargetIds,
      received_target_ids: input.ordered_target_ids,
    });
  }

  const { data: updatedCount, error: moveError } = await supabase.rpc(
    "move_estimate_item",
    {
      target_version_id: versionId,
      target_item_id: item.id,
      source_parent_id: fromParentId,
      target_parent_id: toParentId,
      ordered_source_item_ids: input.ordered_source_ids,
      ordered_target_item_ids: input.ordered_target_ids,
    }
  );

  if (moveError) {
    throw mapSupabaseError(moveError, "Impossible de deplacer l'element.");
  }

  const normalizedUpdatedCount = updatedCount ?? 0;
  const expectedUpdatedCount =
    input.ordered_source_ids.length + input.ordered_target_ids.length;

  if (normalizedUpdatedCount !== expectedUpdatedCount) {
    throw conflict("La liste de deplacement est obsolete.", {
      item_id: item.id,
      from_parent_id: fromParentId,
      to_parent_id: toParentId,
      expected_source_ids: expectedSourceIds,
      received_source_ids: input.ordered_source_ids,
      expected_target_ids: expectedTargetIds,
      received_target_ids: input.ordered_target_ids,
      updated_count: normalizedUpdatedCount,
    });
  }

  return {
    item_id: item.id,
    from_parent_id: fromParentId,
    to_parent_id: toParentId,
    ordered_source_ids: input.ordered_source_ids,
    ordered_target_ids: input.ordered_target_ids,
    updated_count: normalizedUpdatedCount,
  };
}
