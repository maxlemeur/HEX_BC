import "server-only";
import { readAllRows, readAllRowsInChunks } from "@/lib/supabase/read-all";
import type { Database } from "@/types/database";
import { badRequest, mapSupabaseError, notFound } from "./errors";
import {
  canAccessOwnerResource,
  getAuthenticatedContext,
  getVersionAccessOrThrow,
  isTenantAdmin,
  resolveEmbeddedOne,
  toNullableText,
} from "./server-context";
import type { AuthenticatedContext, VersionAccessRow } from "./server-context";

export type EstimateProjectRow = Database["public"]["Tables"]["estimate_projects"]["Row"];

export type EstimateVersionRow = Database["public"]["Tables"]["estimate_versions"]["Row"];

export type EstimateCategoryRow = Database["public"]["Tables"]["estimate_categories"]["Row"];

export type SupplyTypeRow = Database["public"]["Tables"]["supply_types"]["Row"];

export type LaborRoleRow = Database["public"]["Tables"]["labor_roles"]["Row"];

export type MarginTierRow = Database["public"]["Tables"]["margin_tiers"]["Row"];

export type SuggestionRuleRow =
  Database["public"]["Tables"]["estimate_suggestion_rules"]["Row"];

export type EstimateStatus = Database["public"]["Enums"]["estimate_status"];

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

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
  | "currency"
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
  /** Devise stockée de la version (code ISO) : ses totaux sont dans cette devise. */
  currency: string;
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

export type EstimateVersionEventAuthor = Pick<ProfileRow, "full_name">;

export const DEFAULT_CURRENCY = "EUR";

const SUPPORTED_ESTIMATE_CURRENCIES = ["EUR", "USD", "GBP"] as const;

const DEFAULT_VERSION_TIMELINE_PAGE_SIZE = 20;

const MAX_VERSION_TIMELINE_PAGE_SIZE = 100;

export function normalizeEstimateCurrencyOrThrow(
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

function canAccessEstimateReadResource(input: {
  context: Pick<AuthenticatedContext, "userId" | "tenantRole">;
  resourceUserId: string;
}) {
  return (
    canAccessOwnerResource(input) ||
    input.context.tenantRole === "director"
  );
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
        "Impossible de déterminer la position de la version courante."
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
          "Impossible de déterminer la pagination des versions."
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
      "id, project_id, version_number, status, title, updated_at, created_at, total_ttc_cents, total_ht_cents, currency, parent_version_id, variant_label"
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
      currency: row.currency,
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

export async function listEstimateVersionVariants(
  versionId: string
): Promise<ListEstimateVersionVariantsResult> {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;
  const { data, error } = await supabase
    .from("estimate_versions")
    .select(
      "id, project_id, status, margin_mode, margin_multiplier, max_section_depth, tax_rate_bp, updated_at, total_ht_cents, total_tax_cents, total_ttc_cents, calc_engine_version, sale_coefficient_fo, sale_coefficient_mo, gross_ht_cents, discount_applied_cents, commercial_rounding_cents, parent_version_id, variant_label, estimate_projects!inner(id, tenant_id, user_id, name, reference, estimate_reference, site_address, client_name, notes, is_archived)"
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
    const { data: lineItemsData, error: lineItemsError } = await readAllRowsInChunks(versionIds, (pageIds) => supabase
      .from("estimate_items")
      .select("version_id, id", { count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("item_type", "line")
      .in("version_id", pageIds));

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
      "id, project_id, version_number, status, title, updated_at, total_ht_cents, date_devis, currency, validite_jours, estimate_projects!inner(id, name, reference, client_name, is_archived)",
      { count: "exact" }
    )
    .eq("tenant_id", tenantId)
    .eq("estimate_projects.tenant_id", tenantId)
    .eq("estimate_projects.is_archived", false);

  if (!isTenantAdmin(tenantRole)) {
    query = query.eq("estimate_projects.user_id", userId);
  }

  const { data, error } = await readAllRows(() => query
    .order("version_number", { ascending: false })
    .order("updated_at", { ascending: false }));

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
