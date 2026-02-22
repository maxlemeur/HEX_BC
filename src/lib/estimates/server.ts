import { createHash } from "node:crypto";
import {
  createClient,
  type PostgrestError,
  type SupabaseClient,
} from "@supabase/supabase-js";

import { computeEstimateLineValues } from "@/lib/estimate-calculations";
import { isPriceStale } from "@/lib/catalogue/stale-prices";
import {
  getFeatureFlagValueForTenant,
  getStalePriceDaysForTenant,
} from "@/lib/feature-flags";
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
import type {
  BulkUpdateEstimateItemsInput,
  BulkUpdateEstimateVersionPatchInput,
  CreateEstimateAssemblyInput,
  CreateEstimateInput,
  CreateEstimateCategoryInput,
  CreateEstimateTemplateFromVersionInput,
  CreateEstimateItemInput,
  CreateLaborRoleInput,
  DuplicateEstimateTemplateInput,
  InstantiateEstimateFromTemplateInput,
  ListEstimateAssembliesQueryInput,
  ListEstimateTemplatesQueryInput,
  CreateSuggestionRuleInput,
  DeleteEstimateItemInput,
  PatchEstimateStatusInput,
  PatchEstimateVersionInput,
  ReorderEstimateItemsInput,
  SuggestionRuleFeedbackInput,
  UpdateEstimateAssemblyInput,
  UpdateEstimateTemplateInput,
  UpdateLaborRoleInput,
  UpdateEstimateItemInput,
  UpdateSuggestionRuleInput,
} from "./schemas";

type Supabase = SupabaseClient<Database>;

type EstimateProjectRow = Database["public"]["Tables"]["estimate_projects"]["Row"];
type EstimateVersionRow = Database["public"]["Tables"]["estimate_versions"]["Row"];
type EstimateVersionInsert = Database["public"]["Tables"]["estimate_versions"]["Insert"];
type EstimateVersionUpdate = Database["public"]["Tables"]["estimate_versions"]["Update"];
type AuditLogInsert = Database["public"]["Tables"]["audit_logs"]["Insert"];
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
};
type LaborRoleInsert = Database["public"]["Tables"]["labor_roles"]["Insert"];
type LaborRoleUpdate = Database["public"]["Tables"]["labor_roles"]["Update"];
type LaborRoleRow = Database["public"]["Tables"]["labor_roles"]["Row"];
type MarginTierRow = Database["public"]["Tables"]["margin_tiers"]["Row"];
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
> & {
  estimate_projects: EstimateListProject | EstimateListProject[] | null;
};

type EstimateProjectOwnerRow = Pick<
  EstimateProjectRow,
  "id" | "tenant_id" | "user_id"
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

const DEFAULT_VALIDITE_JOURS = 30;
const DEFAULT_MARGIN_MULTIPLIER = 1;
const DEFAULT_TAX_RATE_BP = 2000;
const DEFAULT_ROUNDING_MODE: EstimateVersionRow["rounding_mode"] = "none";
const DEFAULT_ROUNDING_STEP_CENTS = 1;
const DEFAULT_MARGIN_MODE: EstimateVersionRow["margin_mode"] = "fixed";
const DEFAULT_CURRENCY = "EUR";
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
  alternatives: SuggestedSupplierAlternative[];
};

type EstimateSupplierComparisonAlternative = {
  supplier_price_id: string;
  supplier_name: string;
  adjusted_unit_price_cents: number;
  supplier_reference: string | null;
  catalogue_url: string | null;
  updated_at: string | null;
  is_stale: boolean;
  product_designation: string;
};

type EstimateSupplierComparison = {
  item_id: string;
  selected_supplier_price_id: string | null;
  best_supplier_price_id: string | null;
  alternatives: EstimateSupplierComparisonAlternative[];
};

const DEFAULT_ESTIMATE_CATEGORIES = [
  { name: "Materiaux", position: 1 },
  { name: "Main d'oeuvre", position: 2 },
  { name: "Sous-traitance", position: 3 },
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
    });
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
      "Configuration Supabase service role manquante pour journaliser les evenements."
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
}) {
  const query = input.query.toLowerCase();
  const designation = input.designation.toLowerCase();
  const supplierName = input.supplierName.toLowerCase();
  const supplierSku = (input.supplierSku ?? "").toLowerCase();
  const productReference = (input.productReference ?? "").toLowerCase();

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

async function getAuthenticatedContext(): Promise<AuthenticatedContext> {
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
    "Un assemblage avec ce nom existe deja.",
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

function toAssemblySummary(row: EstimateAssemblyRow, itemCount: number) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    item_count: itemCount,
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
      throw mapSupabaseError(error, "Impossible de charger l'assemblage.");
    }

    throw notFound(
      "Assemblage introuvable.",
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
    throw mapSupabaseError(error, "Impossible de charger les lignes de l'assemblage.");
  }

  return (data ?? []) as EstimateAssemblyItemRow[];
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
    throw mapSupabaseError(error, "Impossible de charger le comptage des assemblages.");
  }

  for (const row of (data ?? []) as Array<{ assembly_id: string }>) {
    counts.set(row.assembly_id, (counts.get(row.assembly_id) ?? 0) + 1);
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
      "id, project_id, status, margin_mode, margin_multiplier, tax_rate_bp, updated_at, total_ht_cents, total_tax_cents, total_ttc_cents, parent_version_id, variant_label, estimate_projects!inner(id, tenant_id, user_id, name, reference, client_name, notes, is_archived)"
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

function assertDraftStatus(status: EstimateStatus) {
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
  versionId,
  parentId,
  itemId,
}: {
  supabase: Supabase;
  versionId: string;
  parentId: string | null;
  itemId?: string;
}) {
  if (parentId === null) return;

  const { data, error } = await supabase
    .from("estimate_items")
    .select("id, version_id, item_type")
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
  return (
    (item.h_mo_atelier !== null && item.h_mo_atelier !== undefined) ||
    (item.labor_role_atelier_id !== null &&
      item.labor_role_atelier_id !== undefined) ||
    (item.h_mo_chantier !== null && item.h_mo_chantier !== undefined) ||
    (item.labor_role_chantier_id !== null &&
      item.labor_role_chantier_id !== undefined) ||
    ((item.k_mo_atelier ?? 1) !== 1) ||
    ((item.k_mo_chantier ?? 1) !== 1)
  );
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
    !canAccessOwnerResource({
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
      "id, project_id, version_number, status, title, updated_at, created_at, total_ttc_cents, parent_version_id, variant_label"
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

export async function listEstimateVersionVariants(
  versionId: string
): Promise<ListEstimateVersionVariantsResult> {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;
  const { version } = await getVersionAccessOrThrow(supabase, versionId, context);
  const baseVersionId = version.parent_version_id ?? version.id;

  const { data: versionsData, error: versionsError } = await supabase
    .from("estimate_versions")
    .select(
      "id, project_id, version_number, status, title, total_ht_cents, total_tax_cents, total_ttc_cents, updated_at, parent_version_id, variant_label"
    )
    .eq("tenant_id", tenantId)
    .eq("project_id", version.project_id)
    .or(`id.eq.${baseVersionId},parent_version_id.eq.${baseVersionId}`);

  if (versionsError) {
    throw mapSupabaseError(
      versionsError,
      "Impossible de charger les variantes de cette version."
    );
  }

  const rows = (versionsData ?? []) as EstimateVariantComparisonRow[];
  if (rows.length === 0) {
    throw notFound("Version de chiffrage introuvable.");
  }

  const rowById = new Map(rows.map((row) => [row.id, row]));
  if (!rowById.has(baseVersionId)) {
    throw notFound("Version de chiffrage introuvable.");
  }

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
        return leftLabel.localeCompare(rightLabel, "fr", {
          sensitivity: "base",
        });
      }

      if (leftLabel) return -1;
      if (rightLabel) return 1;

      if (left.version_number !== right.version_number) {
        return left.version_number - right.version_number;
      }

      return new Date(left.updated_at).getTime() - new Date(right.updated_at).getTime();
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
      "id, project_id, version_number, status, title, updated_at, total_ht_cents, estimate_projects!inner(id, name, reference, client_name, is_archived)"
    )
    .eq("tenant_id", tenantId)
    .eq("estimate_projects.tenant_id", tenantId)
    .eq("estimate_projects.is_archived", false)
    .neq("status", "archived");

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

export async function instantiateEstimateFromTemplate(
  templateId: string,
  input: InstantiateEstimateFromTemplateInput
) {
  const { supabase } = await getAuthenticatedContext();

  const { data, error } = await supabase.rpc("instantiate_estimate_from_template", {
    p_template_id: templateId,
    p_project_name: input.project_name.trim(),
    p_version_title: toNullableText(input.version_title),
    p_date_devis: input.date_devis ?? null,
    p_validite_jours: input.validite_jours ?? null,
  });

  if (error) {
    throwTemplateNotFoundIfNeeded(error);
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

  return {
    projectId,
    versionId,
    redirectTo: `/dashboard/estimates/${versionId}/edit`,
  };
}

export async function listEstimateAssemblies(
  query: ListEstimateAssembliesQueryInput
) {
  const { supabase, tenantId } = await getAuthenticatedContext();

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
    throw mapSupabaseError(error, "Impossible de charger les assemblages.");
  }

  const assemblies = (data ?? []) as EstimateAssemblyRow[];
  const itemCountByAssemblyId = await loadAssemblyItemCountByAssemblyId({
    supabase,
    tenantId,
    assemblyIds: assemblies.map((assembly) => assembly.id),
  });

  return {
    assemblies: assemblies.map((assembly) =>
      toAssemblySummary(assembly, itemCountByAssemblyId.get(assembly.id) ?? 0)
    ),
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

  return {
    assembly: {
      ...toAssemblySummary(assembly, items.length),
      items,
    },
  };
}

export async function createEstimateAssembly(input: CreateEstimateAssemblyInput) {
  const { supabase, tenantId, userId } = await getAuthenticatedContext();

  const { data: assemblyData, error: assemblyError } = await supabase
    .from("estimate_assemblies")
    .insert({
      tenant_id: tenantId,
      created_by: userId,
      name: input.name.trim(),
      description: toNullableText(input.description),
    } as EstimateAssemblyInsert)
    .select("*")
    .single();

  if (assemblyError || !assemblyData) {
    if (assemblyError) {
      throwAssemblyNameConflictIfNeeded(assemblyError);
      throw mapSupabaseError(assemblyError, "Impossible de creer l'assemblage.");
    }
    throw badRequest("Impossible de creer l'assemblage.");
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
    default_quantity: item.default_quantity ?? null,
    position: item.position,
  }));

  const { data: insertedItems, error: itemsError } = await supabase
    .from("estimate_assembly_items")
    .insert(itemsPayload)
    .select("*")
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (itemsError || !insertedItems) {
    await supabase
      .from("estimate_assemblies")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("id", assembly.id);

    if (itemsError) {
      throw mapSupabaseError(itemsError, "Impossible de creer l'assemblage.");
    }
    throw badRequest("Impossible de creer l'assemblage.");
  }

  return {
    assembly: {
      ...toAssemblySummary(assembly, insertedItems.length),
      items: insertedItems as EstimateAssemblyItemRow[],
    },
  };
}

export async function updateEstimateAssembly(
  assemblyId: string,
  input: UpdateEstimateAssemblyInput
) {
  const { supabase, tenantId } = await getAuthenticatedContext();

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
        throw mapSupabaseError(error, "Impossible de mettre a jour l'assemblage.");
      }
      throw badRequest("Impossible de mettre a jour l'assemblage.");
    }
    updatedAssembly = data as EstimateAssemblyRow;
  } else {
    updatedAssembly = await loadEstimateAssemblyOrThrow({
      supabase,
      tenantId,
      assemblyId,
    });
  }

  if ("items" in input && input.items) {
    const itemsPayload = input.items.map((item) => ({
      title: item.title.trim(),
      unit: toNullableText(item.unit),
      k_fo: item.k_fo ?? 1,
      k_mo: item.k_mo ?? 1,
      labor_role_id: item.labor_role_id ?? null,
      default_quantity: item.default_quantity ?? null,
      position: item.position,
    }));

    const { error: replaceItemsError } = await supabase.rpc(
      "replace_estimate_assembly_items",
      {
        p_assembly_id: assemblyId,
        p_items: itemsPayload,
      }
    );

    if (replaceItemsError) {
      throw mapSupabaseError(
        replaceItemsError,
        "Impossible de mettre a jour l'assemblage."
      );
    }
  }

  const items = await loadEstimateAssemblyItems({
    supabase,
    tenantId,
    assemblyId,
  });

  return {
    assembly: {
      ...toAssemblySummary(updatedAssembly, items.length),
      items,
    },
  };
}

export async function deleteEstimateAssembly(assemblyId: string) {
  const { supabase, tenantId } = await getAuthenticatedContext();

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
    throw mapSupabaseError(error, "Impossible de supprimer l'assemblage.");
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

  if (assemblyItems.length === 0) {
    throw badRequest("Cet assemblage ne contient aucune ligne.");
  }

  const laborRoleIds = assemblyItems
    .map((item) => item.labor_role_id)
    .filter((value): value is string => Boolean(value));

  const validLaborRoleIds = await loadValidLaborRoleIdsForOwner({
    supabase,
    tenantId,
    ownerUserId: project.user_id,
    laborRoleIds,
  });
  const invalidLaborRoleIds = new Set(
    laborRoleIds.filter((laborRoleId) => !validLaborRoleIds.has(laborRoleId))
  );

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
        "Assemblage introuvable.",
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
    throw mapSupabaseError(error, "Impossible d'inserer l'assemblage.");
  }

  const insertedItems = Array.isArray(data) ? (data as EstimateItemRow[]) : [];
  const insertedItemIds = insertedItems.map((item) => item.id);

  if (insertedItemIds.length === 0) {
    throw internalError(
      "Impossible d'inserer l'assemblage.",
      { data },
      "ESTIMATE_ASSEMBLY_INSERT_FAILED"
    );
  }

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
        "Impossible d'inserer l'assemblage."
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
    throw mapSupabaseError(reloadError, "Impossible d'inserer l'assemblage.");
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
  const { supabase } = context;
  await getVersionAccessOrThrow(supabase, versionId, context);

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

  return {
    version_id: duplicatedVersionId,
  };
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
  const { supabase, userId, tenantId } = await getAuthenticatedContext();

  const { data: project, error: projectError } = await supabase
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

  if (projectError || !project) {
    if (projectError) {
      throw mapSupabaseError(projectError, "Impossible de creer le projet de chiffrage.");
    }
    throw badRequest("Impossible de creer le projet de chiffrage.");
  }

  const versionPayload: EstimateVersionInsert = {
    tenant_id: tenantId,
    project_id: project.id,
    version_number: 1,
    status: "draft",
    title: toNullableText(input.version?.title),
    date_devis: input.version?.date_devis ?? todayDateOnly(),
    validite_jours: input.version?.validite_jours ?? DEFAULT_VALIDITE_JOURS,
    margin_multiplier: input.version?.margin_multiplier ?? DEFAULT_MARGIN_MULTIPLIER,
    margin_mode: input.version?.margin_mode ?? DEFAULT_MARGIN_MODE,
    currency: input.version?.currency?.trim() || DEFAULT_CURRENCY,
    margin_bp: input.version?.margin_bp ?? 0,
    discount_bp: input.version?.discount_bp ?? 0,
    tax_rate_bp: input.version?.tax_rate_bp ?? DEFAULT_TAX_RATE_BP,
    rounding_mode: input.version?.rounding_mode ?? DEFAULT_ROUNDING_MODE,
    rounding_step_cents:
      input.version?.rounding_step_cents ?? DEFAULT_ROUNDING_STEP_CENTS,
    total_ht_cents: 0,
    total_tax_cents: 0,
    total_ttc_cents: 0,
  };

  const { data: version, error: versionError } = await supabase
    .from("estimate_versions")
    .insert(versionPayload)
    .select("*")
    .single();

  if (versionError || !version) {
    await supabase.from("estimate_projects").delete().eq("id", project.id);

    if (versionError) {
      throw mapSupabaseError(versionError, "Impossible de creer la version initiale.");
    }

    throw badRequest("Impossible de creer la version initiale.");
  }

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
    await supabase.from("estimate_projects").delete().eq("id", project.id);
    throw mapSupabaseError(categoriesError, "Impossible de preparer les categories par defaut.");
  }

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
      "*, estimate_projects!inner(id, tenant_id, user_id, name, reference, client_name, notes, is_archived)"
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

  return {
    version: {
      ...version,
      estimate_projects: project,
    },
    items: (itemsResult.data ?? []) as EstimateItemRow[],
    categories: (categoriesResult.data ?? []) as EstimateCategoryRow[],
    supply_types: (supplyTypesResult.data ?? []) as SupplyTypeRow[],
    labor_roles: (laborRolesResult.data ?? []) as LaborRoleRow[],
    suggestion_rules: (rulesResult.data ?? []) as SuggestionRuleRow[],
    margin_tiers: (marginTiersResult.data ?? []) as MarginTierRow[],
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

  return {
    items: (data ?? []) as EstimateItemRow[],
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

  const [productResult, supplierResult, preferredSupplierValue] = await Promise.all([
    supabase
      .from("products")
      .select("id, designation, reference")
      .eq("tenant_id", tenantId)
      .or(`designation.ilike.%${safeSearch}%,reference.ilike.%${safeSearch}%`)
      .limit(40),
    supabase
      .from("suppliers")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .ilike("name", `%${safeSearch}%`)
      .limit(40),
    getFeatureFlagValueForTenant(tenantId, "PREFERRED_SUPPLIER_ID", { supabase }),
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

  const productById = new Map(products.map((product) => [product.id, product]));
  const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));

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
      "id, supplier_id, product_id, supplier_sku, unit, unit_price_cents, currency, updated_at, created_at, notes, is_active"
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

  const supplierPrices = (supplierPricesData ?? []) as Array<{
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
  }>;

  if (supplierPrices.length === 0) {
    return {
      query: normalizedQuery,
      stale_price_days: stalePriceDays,
      suggestions: [] as SuggestedCataloguePrice[],
    };
  }

  const missingProductIds = Array.from(
    new Set(
      supplierPrices
        .map((row) => row.product_id)
        .filter((id) => !productById.has(id))
    )
  );
  const missingSupplierIds = Array.from(
    new Set(
      supplierPrices
        .map((row) => row.supplier_id)
        .filter((id) => !supplierById.has(id))
    )
  );

  if (missingProductIds.length > 0) {
    const { data: missingProducts, error: missingProductsError } = await supabase
      .from("products")
      .select("id, designation, reference")
      .eq("tenant_id", tenantId)
      .in("id", missingProductIds);

    if (missingProductsError) {
      throw mapSupabaseError(
        missingProductsError,
        "Impossible de charger les produits des suggestions."
      );
    }

    (missingProducts ?? []).forEach((product) => {
      productById.set(product.id, product);
    });
  }

  if (missingSupplierIds.length > 0) {
    const { data: missingSuppliers, error: missingSuppliersError } = await supabase
      .from("suppliers")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .in("id", missingSupplierIds);

    if (missingSuppliersError) {
      throw mapSupabaseError(
        missingSuppliersError,
        "Impossible de charger les fournisseurs des suggestions."
      );
    }

    (missingSuppliers ?? []).forEach((supplier) => {
      supplierById.set(supplier.id, supplier);
    });
  }

  const supplierPriceIds = supplierPrices.map((row) => row.id);
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
    const { data: linksData, error: linksError } = await supabase
      .from("dpgf_catalogue_links")
      .select("supplier_price_id, material_index_id")
      .eq("tenant_id", tenantId)
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
      const { data: indicesData, error: indicesError } = await supabase
        .from("material_indices")
        .select("id, index_code, index_value, updated_at, index_date")
        .eq("tenant_id", tenantId)
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

  let preferredSupplierId: string | null = null;
  if (preferredSupplierValue && /^[0-9a-fA-F-]{36}$/.test(preferredSupplierValue)) {
    preferredSupplierId = preferredSupplierValue;
  } else {
    const supplierFrequency = new Map<string, number>();
    supplierPrices.forEach((row) => {
      supplierFrequency.set(
        row.supplier_id,
        (supplierFrequency.get(row.supplier_id) ?? 0) + 1
      );
    });
    preferredSupplierId =
      [...supplierFrequency.entries()]
        .sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
  }

  const now = new Date();

  const candidates = supplierPrices
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
        query: normalizedQuery,
        designation: product?.designation ?? "",
        supplierName: supplier?.name ?? "",
        supplierSku: row.supplier_sku ?? null,
        productReference: product?.reference ?? null,
      });

      return {
        supplier_price_id: row.id,
        product_id: row.product_id,
        product_designation: product?.designation ?? "Produit",
        product_reference: product?.reference ?? null,
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
          stalePriceDays,
          now
        ),
        stale_days: stalePriceDays,
        relevance_score: relevanceScore,
        has_material_index_adjustment: hasMaterialIndexAdjustment,
        material_index_code: materialIndex?.index_code ?? null,
        material_index_value: materialIndex?.index_value ?? null,
        catalogue_url: extractCatalogueUrl(row.notes),
      };
    })
    .filter((candidate) => candidate.relevance_score > 0)
    .sort((left, right) => {
      if (right.relevance_score !== left.relevance_score) {
        return right.relevance_score - left.relevance_score;
      }
      return toTimestamp(right.updated_at) - toTimestamp(left.updated_at);
    });

  const candidatesByProductId = new Map<string, typeof candidates>();
  candidates.forEach((candidate) => {
    const productCandidates = candidatesByProductId.get(candidate.product_id) ?? [];
    productCandidates.push(candidate);
    candidatesByProductId.set(candidate.product_id, productCandidates);
  });

  const suggestions = candidates.slice(0, 10).map((candidate) => {
    const productCandidates = candidatesByProductId.get(candidate.product_id) ?? [candidate];
    const alternatives: SuggestedSupplierAlternative[] = [];
    const pushAlternative = (
      kind: SupplierAlternativeKind,
      selected: (typeof productCandidates)[number] | null
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

    const bestPrice = [...productCandidates].sort((left, right) => {
      if (left.adjusted_unit_price_cents !== right.adjusted_unit_price_cents) {
        return left.adjusted_unit_price_cents - right.adjusted_unit_price_cents;
      }
      return toTimestamp(right.updated_at) - toTimestamp(left.updated_at);
    })[0] ?? null;
    const mostRecent = getMostRecentRecord(productCandidates);
    const preferredSupplier = preferredSupplierId
      ? getMostRecentRecord(
          productCandidates.filter((entry) => entry.supplier_id === preferredSupplierId)
        )
      : null;

    pushAlternative("best_price", bestPrice);
    pushAlternative("most_recent", mostRecent);
    pushAlternative("preferred_supplier", preferredSupplier);

    return {
      ...candidate,
      alternatives,
    } satisfies SuggestedCataloguePrice;
  });

  return {
    query: normalizedQuery,
    stale_price_days: stalePriceDays,
    suggestions,
  };
}

export async function getEstimateSupplierComparisons(
  versionId: string,
  itemIds: string[]
) {
  const normalizedItemIds = Array.from(
    new Set(itemIds.map((itemId) => itemId.trim()).filter((itemId) => itemId.length > 0))
  );

  if (normalizedItemIds.length === 0) {
    throw badRequest("item_ids ne peut pas etre vide.");
  }
  if (normalizedItemIds.length > 200) {
    throw badRequest("item_ids ne peut pas contenir plus de 200 identifiants.");
  }

  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;
  await getVersionAccessOrThrow(supabase, versionId, context);

  const { data: rows, error } = await supabase
    .from("estimate_items")
    .select("id, item_type, title, selected_supplier_price_id")
    .eq("tenant_id", tenantId)
    .eq("version_id", versionId)
    .in("id", normalizedItemIds);

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les lignes.");
  }

  const items = (rows ?? []) as Array<{
    id: string;
    item_type: Database["public"]["Enums"]["estimate_item_type"];
    title: string;
    selected_supplier_price_id: string | null;
  }>;
  const itemById = new Map(items.map((item) => [item.id, item]));

  normalizedItemIds.forEach((itemId) => {
    const item = itemById.get(itemId);
    if (!item || item.item_type !== "line") {
      throw badRequest("item_id doit correspondre a une ligne de devis.", {
        item_id: itemId,
      });
    }
  });

  const queryByNormalizedKey = new Map<string, string>();
  const normalizedKeyByItemId = new Map<string, string>();

  normalizedItemIds.forEach((itemId) => {
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

  const stalePriceDays =
    suggestionsEntries[0]?.[1]?.stale_price_days ??
    (await getStalePriceDaysForTenant(tenantId, { supabase }));

  const alternativeKindOrder: SupplierAlternativeKind[] = [
    "best_price",
    "most_recent",
    "preferred_supplier",
  ];

  const comparisons = normalizedItemIds.map((itemId) => {
    const item = itemById.get(itemId);
    if (!item) {
      return {
        item_id: itemId,
        selected_supplier_price_id: null,
        best_supplier_price_id: null,
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
    const candidate = selectedSuggestion ?? suggestions[0] ?? null;

    if (!candidate) {
      return {
        item_id: item.id,
        selected_supplier_price_id: selectedSupplierPriceId,
        best_supplier_price_id: null,
        alternatives: [],
      } satisfies EstimateSupplierComparison;
    }

    const bestAlternative =
      candidate.alternatives.find((alternative) => alternative.kind === "best_price") ?? null;
    const alternatives = alternativeKindOrder
      .map((kind) => candidate.alternatives.find((alternative) => alternative.kind === kind))
      .filter((alternative): alternative is SuggestedSupplierAlternative => Boolean(alternative))
      .slice(0, 3)
      .map((alternative) => ({
        supplier_price_id: alternative.supplier_price_id,
        supplier_name: alternative.supplier_name,
        adjusted_unit_price_cents: alternative.adjusted_unit_price_cents,
        supplier_reference: alternative.supplier_reference,
        catalogue_url: alternative.catalogue_url,
        updated_at: alternative.updated_at,
        is_stale: alternative.is_stale,
        product_designation: candidate.product_designation,
      }));

    return {
      item_id: item.id,
      selected_supplier_price_id: selectedSupplierPriceId,
      best_supplier_price_id: bestAlternative?.supplier_price_id ?? null,
      alternatives,
    } satisfies EstimateSupplierComparison;
  });

  return {
    stale_price_days: stalePriceDays,
    comparisons,
  };
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
    payload.currency = input.currency.trim();
  }
  if ("margin_bp" in input) {
    payload.margin_bp = input.margin_bp;
  }
  if ("discount_bp" in input) {
    payload.discount_bp = input.discount_bp;
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

  const { data, error } = await supabase
    .from("estimate_versions")
    .update(payload)
    .eq("id", versionId)
    .eq("tenant_id", tenantId)
    .eq("updated_at", version.updated_at)
    .select("*")
    .single();

  if (error || !data) {
    if (error?.code === "PGRST116") {
      throw conflict(VERSION_CONFLICT_ERROR_MESSAGE, {
        updated_at: version.updated_at,
      });
    }

    if (error) {
      throw mapSupabaseError(error, "Impossible de mettre a jour la version.");
    }
    throw conflict(VERSION_CONFLICT_ERROR_MESSAGE, {
      updated_at: version.updated_at,
    });
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

  const updatePayload: EstimateVersionUpdate = {
    status: input.status,
  };

  if (sealHash !== null) {
    (updatePayload as EstimateVersionUpdate & { seal_hash: string | null }).seal_hash =
      sealHash;
  }

  const { data, error } = await supabase
    .from("estimate_versions")
    .update(updatePayload)
    .eq("id", versionId)
    .eq("tenant_id", tenantId)
    .eq("updated_at", version.updated_at)
    .select("*")
    .single();

  if (error || !data) {
    if (error?.code === "PGRST116") {
      throw conflict(VERSION_CONFLICT_ERROR_MESSAGE, {
        updated_at: version.updated_at,
      });
    }

    if (error) {
      throw mapSupabaseError(error, "Impossible de changer le statut.");
    }
    throw conflict(VERSION_CONFLICT_ERROR_MESSAGE, {
      updated_at: version.updated_at,
    });
  }

  const statusEventType = resolveStatusEventType(input.status);
  if (statusEventType) {
    const statusEventMetadata: Record<string, unknown> = {
      previous_status: version.status,
      next_status: input.status,
    };

    if (sealHash !== null) {
      statusEventMetadata.seal_hash = sealHash;
    }

    if (forcedByAdmin) {
      statusEventMetadata.forced_by_admin = true;
      statusEventMetadata.forced_blocking_flags = forcedBlockingFlags;
    }

    await logEstimateVersionEvent({
      versionId,
      eventType: statusEventType,
      actorUserId: userId,
      metadata: statusEventMetadata as Json,
      occurredAt: new Date().toISOString(),
    });
  }

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
  await ensureParentIsValid({
    supabase,
    versionId,
    parentId,
  });

  const position = input.position ?? (await getNextItemPosition(supabase, versionId, parentId));

  if (input.item_type === "section") {
    const title = input.title ?? (parentId ? "Nouveau sous-chapitre" : "Nouveau chapitre");

    const { data, error } = await supabase
      .from("estimate_items")
      .insert({
        tenant_id: tenantId,
        version_id: versionId,
        parent_id: parentId,
        item_type: "section",
        position,
        title,
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
  const isLaborSplitEnabled = isLaborSplitEnabledForItem({
    h_mo_atelier: hMoAtelier,
    k_mo_atelier: kMoAtelier,
    labor_role_atelier_id: laborRoleAtelierId,
    h_mo_chantier: hMoChantier,
    k_mo_chantier: kMoChantier,
    labor_role_chantier_id: laborRoleChantierId,
  });

  await ensureCategoryIsValid(supabase, categoryId, context, project.user_id);
  await ensureSupplyTypeIsValid(supabase, supplyTypeId, context);
  await ensureSupplierPriceIsValid(supabase, selectedSupplierPriceId, context);
  const laborRateLegacyCents = await resolveLaborRateCents(
    supabase,
    laborRoleId,
    context,
    project.user_id
  );
  const laborRateAtelierCents = await resolveLaborRateCents(
    supabase,
    laborRoleAtelierId,
    context,
    project.user_id
  );
  const laborRateChantierCents = await resolveLaborRateCents(
    supabase,
    laborRoleChantierId,
    context,
    project.user_id
  );

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

  await ensureParentIsValid({
    supabase,
    versionId,
    parentId: nextParentId,
    itemId: currentItem.id,
  });

  if (currentItem.item_type === "section") {
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
    };
  }

  const nextTitle =
    ("title" in input ? input.title : currentItem.title) ?? currentItem.title;
  const nextDescription =
    ("description" in input
      ? toNullableText(input.description)
      : currentItem.description) ?? null;
  const nextQuantity =
    ("quantity" in input ? input.quantity : currentItem.quantity) ?? 0;
  const nextUnitPriceHtCents =
    ("unit_price_ht_cents" in input
      ? input.unit_price_ht_cents
      : currentItem.unit_price_ht_cents) ?? 0;
  const nextTaxRateBp =
    ("tax_rate_bp" in input
      ? input.tax_rate_bp
      : currentItem.tax_rate_bp) ??
    version.tax_rate_bp ??
    DEFAULT_TAX_RATE_BP;
  const nextKFo = ("k_fo" in input ? input.k_fo : currentItem.k_fo) ?? 1;
  const nextHMo = ("h_mo" in input ? input.h_mo : currentItem.h_mo) ?? 0;
  const nextHMoMajoration =
    ("h_mo_majoration" in input
      ? input.h_mo_majoration
      : (currentItem as EstimateItemRow).h_mo_majoration) ?? 1;
  const nextKMo = ("k_mo" in input ? input.k_mo : currentItem.k_mo) ?? 1;
  const nextHMoAtelier =
    "h_mo_atelier" in input
      ? input.h_mo_atelier ?? null
      : ((currentItem as EstimateItemRow).h_mo_atelier ?? null);
  const nextKMoAtelier =
    "k_mo_atelier" in input
      ? input.k_mo_atelier ?? null
      : ((currentItem as EstimateItemRow).k_mo_atelier ?? null);
  const nextLaborRoleAtelierId =
    "labor_role_atelier_id" in input
      ? input.labor_role_atelier_id ?? null
      : ((currentItem as EstimateItemRow).labor_role_atelier_id ?? null);
  const nextHMoChantier =
    "h_mo_chantier" in input
      ? input.h_mo_chantier ?? null
      : ((currentItem as EstimateItemRow).h_mo_chantier ?? null);
  const nextKMoChantier =
    "k_mo_chantier" in input
      ? input.k_mo_chantier ?? null
      : ((currentItem as EstimateItemRow).k_mo_chantier ?? null);
  const nextLaborRoleChantierId =
    "labor_role_chantier_id" in input
      ? input.labor_role_chantier_id ?? null
      : ((currentItem as EstimateItemRow).labor_role_chantier_id ?? null);
  const nextLaborRoleId =
    "labor_role_id" in input ? (input.labor_role_id ?? null) : currentItem.labor_role_id;
  const nextCategoryId =
    "category_id" in input ? (input.category_id ?? null) : currentItem.category_id;
  const nextSupplyTypeId =
    "supply_type_id" in input
      ? (input.supply_type_id ?? null)
      : ((currentItem as EstimateItemRow).supply_type_id ?? null);
  const nextSelectedSupplierPriceId =
    "selected_supplier_price_id" in input
      ? (input.selected_supplier_price_id ?? null)
      : ((currentItem as EstimateItemRow).selected_supplier_price_id ?? null);
  const nextPosition =
    ("position" in input ? input.position : currentItem.position) ??
    currentItem.position;
  const isLaborSplitEnabled = isLaborSplitEnabledForItem({
    h_mo_atelier: nextHMoAtelier,
    k_mo_atelier: nextKMoAtelier,
    labor_role_atelier_id: nextLaborRoleAtelierId,
    h_mo_chantier: nextHMoChantier,
    k_mo_chantier: nextKMoChantier,
    labor_role_chantier_id: nextLaborRoleChantierId,
  });

  await ensureCategoryIsValid(supabase, nextCategoryId, context, project.user_id);
  await ensureSupplyTypeIsValid(supabase, nextSupplyTypeId, context);
  await ensureSupplierPriceIsValid(supabase, nextSelectedSupplierPriceId, context);
  const laborRateLegacyCents = await resolveLaborRateCents(
    supabase,
    nextLaborRoleId,
    context,
    project.user_id
  );
  const laborRateAtelierCents = await resolveLaborRateCents(
    supabase,
    nextLaborRoleAtelierId,
    context,
    project.user_id
  );
  const laborRateChantierCents = await resolveLaborRateCents(
    supabase,
    nextLaborRoleChantierId,
    context,
    project.user_id
  );

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
      pu_ht_cents: currentItem.pu_ht_cents,
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
    parent_id: nextParentId,
    position: nextPosition,
    title: nextTitle,
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
