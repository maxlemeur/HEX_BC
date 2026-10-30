import "server-only";
import { parseEstimateEditorResponse } from "@/lib/estimates/editor-read-contracts";
import { type SupabaseClient } from "@supabase/supabase-js";
import { isEstimateAiDraftEnabled } from "@/lib/estimates/ai-draft-availability";
import { isFeatureEnabled } from "@/lib/feature-flags";
import {
  resolveEstimateEngineVersion,
  shouldPreserveStoredEstimateV2Snapshot,
} from "@/lib/estimates/calc-engine-version";
import { usesSaleCoefficients } from "@/lib/estimates/engine/capabilities";
import { getTakeoffLinkedSourceVersionByJobId } from "@/lib/takeoff/version-links";
import {
  readSelectedSupplierDetails,
  type SelectedSupplierDetails,
} from "@/lib/estimates/supplier-offer-conditions";
import {
  assertEstimateVersionUnchanged,
  readAllEstimateItems,
} from "@/lib/estimates/read-all-items-server";
import type { Database, Json } from "@/types/database";
import { mapSupabaseError, notFound } from "./errors";
import {
  enrichEstimateItemsWithGeneratedOuvrageProvenance,
} from "./generated-ouvrage-provenance";
import { enrichEstimateItemsWithAiStructureProvenance } from "./structure-drafts";
import {
  enrichEstimateItemsWithVersionZeroProvenance,
  fetchVersionZeroDraftSummary,
} from "./version-zero-drafts";
import { resolveEstimateLineTruth, type EstimateLineTruth } from "./line-truth";
import {
  canAccessOwnerResource,
  getAuthenticatedContext,
  getVersionAccessOrThrow,
  resolveEmbeddedOne,
  toNullableText,
} from "./server-context";
import type { EmbeddedProjectAccess } from "./server-context";
import {
  type EstimateCategoryRow,
  type SupplyTypeRow,
  type LaborRoleRow,
  type SuggestionRuleRow,
  type MarginTierRow,
  type EstimateVersionRow,
  type EstimateVersionEventAuthor,
} from "./version-list-server";

type Supabase = SupabaseClient<Database>;

export type EstimateItemRow = Database["public"]["Tables"]["estimate_items"]["Row"] & {
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

type EstimateVersionDetailsRow = EstimateVersionRow & {
  estimate_projects: EmbeddedProjectAccess | EmbeddedProjectAccess[] | null;
};

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
    .from("takeoff_jobs")
    .select("id, level, completed_at, created_at")
    .eq("tenant_id", input.tenantId)
    .in("id", sourceJobIds);

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
    versionId: input.targetVersionId,
    items: withTakeoff,
  });
  const withGeneratedOuvrage = await enrichEstimateItemsWithGeneratedOuvrageProvenance({
    supabase: input.supabase,
    tenantId: input.tenantId,
    versionId: input.targetVersionId,
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

export async function getEstimateVersionDetails(
  versionId: string,
  options?: { includeExportCalculationContext?: boolean; includeItems?: boolean }
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;

  const { data: versionData, error: versionError } = await supabase
    .from("estimate_versions")
    .select(
      "*, estimate_projects!inner(id, tenant_id, user_id, name, reference, estimate_reference, site_address, client_name, notes, is_archived)"
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

  // Lot 2, sous-lot 2.7 : une v3 n'a ni instantané v2 ni barème ; son export relit le gel v3
  // (v3-export.ts) et ce contexte reste celui d'un brouillon (rôles, ventilation).
  const preserveStoredSnapshot =
    options?.includeExportCalculationContext === true &&
    !usesSaleCoefficients(resolveEstimateEngineVersion(version)) &&
    shouldPreserveStoredEstimateV2Snapshot(version);
  const exportLaborSplitEnabled =
    options?.includeExportCalculationContext === true && !preserveStoredSnapshot
      ? await isFeatureEnabled(tenantId, "EST_031_LABOR_SPLIT", { supabase })
      : null;

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
  const laborRolesQuery = preserveStoredSnapshot
    ? Promise.resolve({ data: [], error: null })
    : supabase
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
  const marginTiersQuery = preserveStoredSnapshot
    ? Promise.resolve({ data: [], error: null })
    : supabase
        .from("margin_tiers")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("threshold_cents", { ascending: true })
        .order("position", { ascending: true });

  const [
    rawItems,
    categoriesResult,
    supplyTypesResult,
    laborRolesResult,
    rulesResult,
    marginTiersResult,
    versionZeroSummary,
  ] =
    await Promise.all([
      options?.includeItems === false ? Promise.resolve([]) : readAllEstimateItems({ supabase, tenantId, versionId }),
      categoriesQuery,
      supplyTypesQuery,
      laborRolesQuery,
      rulesQuery,
      marginTiersQuery,
      isEstimateAiDraftEnabled()
        ? fetchVersionZeroDraftSummary({ versionId }).catch(() => null)
        : Promise.resolve(null),
    ]);

  if (categoriesResult.error) {
    throw mapSupabaseError(
      categoriesResult.error,
      "Impossible de charger les catégories."
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
      "Impossible de charger les rôles de main d'oeuvre."
    );
  }

  if (rulesResult.error) {
    throw mapSupabaseError(
      rulesResult.error,
      "Impossible de charger les règles de suggestion."
    );
  }

  if (marginTiersResult.error) {
    throw mapSupabaseError(
      marginTiersResult.error,
      "Impossible de charger les tranches de marge."
    );
  }

  // A CSV v3 already loads the version's complete document under the same
  // authorization boundary. Its metadata read needs no duplicate item pages
  // or provenance enrichment; ordinary editor/export callers keep both.
  const items = options?.includeItems === false ? [] : await enrichEstimateItemsWithSourceMetadata({
    supabase,
    tenantId,
    targetVersionId: versionId,
    items: rawItems,
  });

  const selectedSuppliers = options?.includeExportCalculationContext
    ? new Map<string, SelectedSupplierDetails>()
    : await readSelectedSupplierDetails(supabase, tenantId,
        items.flatMap((item) => item.selected_supplier_price_id ? [item.selected_supplier_price_id] : []));
  const itemsWithSelectedSuppliers = items.map((item) => ({
    ...item,
    selected_supplier_details: item.selected_supplier_price_id
      ? selectedSuppliers.get(item.selected_supplier_price_id) ?? null
      : null,
  }));

  await assertEstimateVersionUnchanged({ supabase, version });

  const result = {
    version: {
      ...version,
      estimate_projects: project,
    },
    items: itemsWithSelectedSuppliers,
    categories: (categoriesResult.data ?? []) as EstimateCategoryRow[],
    supply_types: (supplyTypesResult.data ?? []) as SupplyTypeRow[],
    labor_roles: (laborRolesResult.data ?? []) as LaborRoleRow[],
    suggestion_rules: (rulesResult.data ?? []) as SuggestionRuleRow[],
    margin_tiers: (marginTiersResult.data ?? []) as MarginTierRow[],
    is_labor_split_enabled: exportLaborSplitEnabled,
    version_zero_summary: versionZeroSummary,
  };

  parseEstimateEditorResponse(result, versionId);
  return result;
}

/**
 * The version's item rows without the source provenance (four more sequential reads), for a
 * caller that never reads it: the purchase preparation and its hub counts.
 */
export async function listEstimateItemRows(versionId: string) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;
  const { version } = await getVersionAccessOrThrow(supabase, versionId, context);
  const items = await readAllEstimateItems({ supabase, tenantId, versionId });

  await assertEstimateVersionUnchanged({
    supabase,
    version: { ...version, tenant_id: tenantId },
  });

  return {
    items,
  };
}

export async function listEstimateItems(versionId: string) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;
  const { version } = await getVersionAccessOrThrow(supabase, versionId, context);
  const rawItems = await readAllEstimateItems({ supabase, tenantId, versionId });

  const items = await enrichEstimateItemsWithSourceMetadata({
    supabase,
    tenantId,
    targetVersionId: versionId,
    items: rawItems,
  });

  await assertEstimateVersionUnchanged({
    supabase,
    version: { ...version, tenant_id: tenantId },
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
    throw mapSupabaseError(error, "Impossible de charger les événements.");
  }

  return {
    events: ((data ?? []) as unknown as EstimateVersionEventRow[]).map((row) =>
      normalizeEstimateVersionEvent(row)
    ),
  };
}
