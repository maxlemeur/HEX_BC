import { cache } from "react";

import {
  computeAllSectionTotals,
  computeStoredDiscountCents,
  type EstimateItemRecord,
} from "@/lib/estimate-calculations";
import { badRequest, mapSupabaseError, notFound } from "@/lib/estimates/errors";
import {
  getAuthenticatedContext,
  listEstimateProjectVersions,
  type ListEstimateProjectVersionsResult,
} from "@/lib/estimates/server";
import type { Database } from "@/types/database";

import {
  affaireCursorPayloadSchema,
  normalizeAffaireListQuery,
  type AffaireCursorPayload,
  type AffaireListQuery,
  type AffairePageSize,
  type AffaireStatus,
  type NormalizedAffaireListQuery,
} from "./schemas";

type AffaireContext = Awaited<ReturnType<typeof getAuthenticatedContext>>;

type ListAffairesPageRow =
  Database["public"]["Functions"]["list_affaires_page"]["Returns"][number];
type AffaireCountersRow =
  Database["public"]["Functions"]["get_affaires_counters"]["Returns"][number];
type EstimateProjectRow = Database["public"]["Tables"]["estimate_projects"]["Row"];
type EstimateVersionRow = Database["public"]["Tables"]["estimate_versions"]["Row"];
type DpgfImportRow = Database["public"]["Tables"]["dpgf_imports"]["Row"];
type DpgfMappingRow = Database["public"]["Tables"]["dpgf_mappings"]["Row"];

export type AffaireListItem = {
  projectId: string;
  projectName: string;
  projectReference: string | null;
  projectClient: string | null;
  versionCount: number;
  hasCurrentVersion: boolean;
  currentVersionId: string | null;
  currentVersionNumber: number | null;
  currentStatus: AffaireStatus | null;
  currentTotalHtCents: number | null;
  currentUpdatedAt: string;
  acceptedVersionId: string | null;
  acceptedVersionNumber: number | null;
  hasDpgf: boolean;
};

export type AffaireListPageResult = {
  items: AffaireListItem[];
  pageSize: AffairePageSize;
  nextCursor: string | null;
  hasNextPage: boolean;
};

export type AffaireCountersResult = {
  totalCount: number;
  filteredCount: number;
  statusCounts: Record<AffaireStatus, number>;
};

export type AffairePageDataResult = {
  list: AffaireListPageResult;
  counters: AffaireCountersResult;
};

type AffaireHubProjectRow = Pick<
  EstimateProjectRow,
  "id" | "tenant_id" | "user_id" | "name" | "reference" | "client_name" | "is_archived"
>;

type AffaireHubVersionRow = Pick<
  EstimateVersionRow,
  | "id"
  | "project_id"
  | "version_number"
  | "status"
  | "total_ht_cents"
  | "margin_multiplier"
  | "updated_at"
>;

type AffaireHubDpgfImportRow = Pick<
  DpgfImportRow,
  | "id"
  | "filename"
  | "source_format"
  | "status"
  | "created_at"
  | "parse_mode"
  | "row_count"
  | "tenant_id"
  | "project_id"
>;

type AffaireHubDpgfMappingRow = Pick<
  DpgfMappingRow,
  "id" | "status" | "created_at" | "updated_at" | "tenant_id" | "import_id"
>;

export type AffaireHubProject = {
  id: string;
  name: string;
  reference: string | null;
  clientName: string | null;
};

export type AffaireHubVersionSummary = {
  id: string;
  projectId: string;
  versionNumber: number;
  status: AffaireStatus;
  totalHtCents: number;
  marginMultiplier: number;
  marginPercent: number;
  updatedAt: string;
};

export type AffaireHubSummaryResult = {
  project: AffaireHubProject;
  currentVersion: AffaireHubVersionSummary | null;
  acceptedVersion: AffaireHubVersionSummary | null;
  versionsCount: number;
  lineCount: number;
};

export type AffaireHubDpgfSourceResult = {
  importId: string;
  filename: string;
  sourceFormat: string;
  importStatus: string;
  mappingStatus: string | null;
  importedAt: string;
  mappingUpdatedAt: string | null;
  parseMode: string;
  rowCount: number;
} | null;

export type AffaireHubPlansSummaryResult = {
  planSetCount: number;
  planFileCount: number;
  totalSizeBytes: number;
  latestJob: {
    id: string;
    status: string;
    level: string;
    source_file_name: string | null;
    items_count: number;
    created_at: string;
  } | null;
};

export type AffaireHubTimelineResult = ListEstimateProjectVersionsResult;

export type AffaireHubPageDataResult = {
  summary: AffaireHubSummaryResult;
  timeline: AffaireHubTimelineResult;
  dpgfSource: AffaireHubDpgfSourceResult;
};

export type MarginSectionBreakdown = {
  sectionId: string;
  sectionTitle: string;
  sectionPosition: number;
  costCents: number;
  saleCents: number;
  marginPercent: number;
  marginEurCents: number;
};

export type MarginVersionPoint = {
  versionNumber: number;
  versionId: string;
  status: string;
  marginMultiplier: number;
  marginPercent: number;
  totalHtCents: number;
};

export type AffaireHubMarginAnalysisResult = {
  global: {
    costCents: number;
    saleCents: number;
    marginPercent: number;
    marginEurCents: number;
    marginMultiplier: number;
  };
  sections: MarginSectionBreakdown[];
  versionEvolution: MarginVersionPoint[];
  currentVersionId: string;
} | null;

function toSafeInteger(value: number | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function toNullableSafeInteger(
  value: number | string | null | undefined
): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function toBase64Url(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = `${normalized}${"=".repeat((4 - (normalized.length % 4)) % 4)}`;
  return Buffer.from(padded, "base64").toString("utf8");
}

function encodeAffaireCursor(payload: AffaireCursorPayload): string {
  return toBase64Url(JSON.stringify(payload));
}

function decodeAffaireCursor(cursor: string): AffaireCursorPayload {
  let decoded: unknown;

  try {
    decoded = JSON.parse(fromBase64Url(cursor));
  } catch {
    throw badRequest("Curseur de pagination invalide.", undefined, "BAD_REQUEST");
  }

  const parsed = affaireCursorPayloadSchema.safeParse(decoded);
  if (!parsed.success) {
    throw badRequest("Curseur de pagination invalide.", parsed.error, "BAD_REQUEST");
  }

  return parsed.data;
}

function getOwnerScopeUserId(context: AffaireContext): string | null {
  return context.tenantRole === "admin" ? null : context.userId;
}

function toAffaireListItem(row: ListAffairesPageRow): AffaireListItem {
  const hasCurrentVersion = row.has_current_version ?? false;

  return {
    projectId: row.project_id,
    projectName: row.project_name,
    projectReference: row.project_reference,
    projectClient: row.project_client,
    versionCount: toSafeInteger(row.version_count),
    hasCurrentVersion,
    currentVersionId: row.current_version_id ?? null,
    currentVersionNumber: toNullableSafeInteger(row.current_version_number),
    currentStatus: row.current_status ?? null,
    currentTotalHtCents: toNullableSafeInteger(row.current_total_ht_cents),
    currentUpdatedAt: row.current_updated_at,
    acceptedVersionId: row.accepted_version_id,
    acceptedVersionNumber:
      row.accepted_version_number === null
        ? null
        : toSafeInteger(row.accepted_version_number),
    hasDpgf: row.has_dpgf ?? false,
  };
}

function normalizeHubTimelinePage(page: number | undefined): number {
  if (page === undefined) return 1;
  if (!Number.isFinite(page) || page < 1) {
    throw badRequest("Le parametre page est invalide.", undefined, "BAD_REQUEST");
  }

  return Math.trunc(page);
}

function toAffaireHubVersionSummary(row: AffaireHubVersionRow): AffaireHubVersionSummary {
  const marginMultiplier = Number.isFinite(row.margin_multiplier)
    ? row.margin_multiplier
    : 1;

  return {
    id: row.id,
    projectId: row.project_id,
    versionNumber: toSafeInteger(row.version_number),
    status: row.status,
    totalHtCents: toSafeInteger(row.total_ht_cents),
    marginMultiplier,
    marginPercent: (marginMultiplier - 1) * 100,
    updatedAt: row.updated_at,
  };
}

const PLAN_FILE_SUM_BATCH_SIZE = 500;
const AFFAIRE_PROJECT_VERSIONS_BATCH_SIZE = 1000;

async function fetchAffaireHubProjectOrThrow(
  context: AffaireContext,
  projectId: string
): Promise<AffaireHubProjectRow> {
  let query = context.supabase
    .from("estimate_projects")
    .select("id, tenant_id, user_id, name, reference, client_name, is_archived")
    .eq("id", projectId)
    .eq("tenant_id", context.tenantId)
    .eq("is_archived", false);

  const ownerScopeUserId = getOwnerScopeUserId(context);
  if (ownerScopeUserId) {
    query = query.eq("user_id", ownerScopeUserId);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw mapSupabaseError(error, "Impossible de charger le projet affaire.");
  }

  const project = (data ?? null) as AffaireHubProjectRow | null;
  if (!project) {
    throw notFound("Affaire introuvable.");
  }

  return project;
}

async function fetchAffaireHubSummaryWithContext(
  context: AffaireContext,
  project: AffaireHubProjectRow
): Promise<AffaireHubSummaryResult> {
  const [versionsCountResult, currentVersionResult, acceptedVersionResult] = await Promise.all([
    context.supabase
      .from("estimate_versions")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", context.tenantId)
      .eq("project_id", project.id)
      .limit(1),
    context.supabase
      .from("estimate_versions")
      .select(
        "id, project_id, version_number, status, total_ht_cents, margin_multiplier, updated_at"
      )
      .eq("tenant_id", context.tenantId)
      .eq("project_id", project.id)
      .order("version_number", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    context.supabase
      .from("estimate_versions")
      .select(
        "id, project_id, version_number, status, total_ht_cents, margin_multiplier, updated_at"
      )
      .eq("tenant_id", context.tenantId)
      .eq("project_id", project.id)
      .eq("status", "accepted")
      .order("version_number", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (versionsCountResult.error) {
    throw mapSupabaseError(
      versionsCountResult.error,
      "Impossible de compter les versions affaire."
    );
  }

  if (currentVersionResult.error) {
    throw mapSupabaseError(
      currentVersionResult.error,
      "Impossible de charger la version courante."
    );
  }

  if (acceptedVersionResult.error) {
    throw mapSupabaseError(
      acceptedVersionResult.error,
      "Impossible de charger la derniere version acceptee."
    );
  }

  const currentVersion = (currentVersionResult.data ?? null) as AffaireHubVersionRow | null;
  const acceptedVersion = (acceptedVersionResult.data ?? null) as AffaireHubVersionRow | null;

  let lineCount = 0;
  if (currentVersion) {
    const { count, error } = await context.supabase
      .from("estimate_items")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", context.tenantId)
      .eq("version_id", currentVersion.id)
      .eq("item_type", "line")
      .limit(1);

    if (error) {
      throw mapSupabaseError(error, "Impossible de compter les lignes de la version.");
    }

    lineCount = count ?? 0;
  }

  return {
    project: {
      id: project.id,
      name: project.name,
      reference: project.reference,
      clientName: project.client_name,
    },
    currentVersion: currentVersion ? toAffaireHubVersionSummary(currentVersion) : null,
    acceptedVersion: acceptedVersion ? toAffaireHubVersionSummary(acceptedVersion) : null,
    versionsCount: versionsCountResult.count ?? 0,
    lineCount,
  };
}

async function fetchAffaireHubDpgfSourceWithContext(
  context: AffaireContext,
  project: AffaireHubProjectRow
): Promise<AffaireHubDpgfSourceResult> {
  const { data: importData, error: importError } = await context.supabase
    .from("dpgf_imports")
    .select(
      "id, filename, source_format, status, created_at, parse_mode, row_count, tenant_id, project_id"
    )
    .eq("tenant_id", context.tenantId)
    .eq("project_id", project.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (importError) {
    throw mapSupabaseError(importError, "Impossible de charger la source DPGF.");
  }

  const latestImport = (importData ?? null) as AffaireHubDpgfImportRow | null;
  if (!latestImport) {
    return null;
  }

  const { data: mappingData, error: mappingError } = await context.supabase
    .from("dpgf_mappings")
    .select("id, status, created_at, updated_at, tenant_id, import_id")
    .eq("tenant_id", context.tenantId)
    .eq("import_id", latestImport.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (mappingError) {
    throw mapSupabaseError(mappingError, "Impossible de charger le statut de mapping DPGF.");
  }

  const latestMapping = (mappingData ?? null) as AffaireHubDpgfMappingRow | null;

  return {
    importId: latestImport.id,
    filename: latestImport.filename,
    sourceFormat: latestImport.source_format,
    importStatus: latestImport.status,
    mappingStatus: latestMapping?.status ?? null,
    importedAt: latestImport.created_at,
    mappingUpdatedAt: latestMapping?.updated_at ?? null,
    parseMode: latestImport.parse_mode,
    rowCount: toSafeInteger(latestImport.row_count),
  };
}

async function fetchAffaireHubPlansSummaryWithContext(
  context: AffaireContext,
  project: AffaireHubProjectRow
): Promise<AffaireHubPlansSummaryResult> {
  const [planSetsCountResult, latestJobResult] = await Promise.all([
    context.supabase
      .from("plan_sets" as never)
      .select("id" as never, { count: "exact", head: true })
      .eq("tenant_id" as never, context.tenantId as never)
      .eq("project_id" as never, project.id as never)
      .limit(1),
    context.supabase
      .from("takeoff_jobs" as never)
      .select(
        "id, status, level, source_file_name, created_at, estimate_versions!inner(project_id)" as never
      )
      .eq("tenant_id" as never, context.tenantId as never)
      .eq("estimate_versions.project_id" as never, project.id as never)
      .order("created_at" as never, { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (planSetsCountResult.error) {
    throw mapSupabaseError(
      planSetsCountResult.error,
      "Impossible de compter les jeux de plans."
    );
  }

  if (latestJobResult.error) {
    throw mapSupabaseError(latestJobResult.error, "Impossible de charger le dernier job takeoff.");
  }

  const planSetCount = planSetsCountResult.count ?? 0;

  let planFileCount = 0;
  let totalSizeBytes = 0;

  if (planSetCount > 0) {
    const { count: planFilesCount, error: planFilesCountError } = await context.supabase
      .from("plan_files" as never)
      .select("id, plan_sets!inner(project_id)" as never, { count: "exact", head: true })
      .eq("tenant_id" as never, context.tenantId as never)
      .eq("plan_sets.project_id" as never, project.id as never)
      .limit(1);

    if (planFilesCountError) {
      throw mapSupabaseError(
        planFilesCountError,
        "Impossible de compter les fichiers de plans."
      );
    }

    planFileCount = planFilesCount ?? 0;

    let offset = 0;
    while (offset < planFileCount) {
      const end = offset + PLAN_FILE_SUM_BATCH_SIZE - 1;
      const { data: planFilesData, error: planFilesError } = await context.supabase
        .from("plan_files" as never)
        .select("file_size_bytes, plan_sets!inner(project_id)" as never)
        .eq("tenant_id" as never, context.tenantId as never)
        .eq("plan_sets.project_id" as never, project.id as never)
        .order("id" as never, { ascending: true })
        .range(offset, end);

      if (planFilesError) {
        throw mapSupabaseError(planFilesError, "Impossible de charger les fichiers de plans.");
      }

      const rows = (planFilesData ?? []) as Array<{
        file_size_bytes: number | string | null;
      }>;

      if (rows.length === 0) {
        break;
      }

      totalSizeBytes += rows.reduce(
        (total, row) => total + toSafeInteger(row.file_size_bytes),
        0
      );
      offset += rows.length;
    }
  }

  const latestJobRow = (latestJobResult.data ?? null) as {
    id: string;
    status: string;
    level: string;
    source_file_name: string | null;
    created_at: string;
  } | null;

  let latestJob: AffaireHubPlansSummaryResult["latestJob"] = null;
  if (latestJobRow) {
    const { count: itemCount, error: itemCountError } = await context.supabase
      .from("takeoff_items" as never)
      .select("id" as never, { count: "exact", head: true })
      .eq("tenant_id" as never, context.tenantId as never)
      .eq("job_id" as never, latestJobRow.id as never);

    if (itemCountError) {
      throw mapSupabaseError(itemCountError, "Impossible de compter les items du dernier job.");
    }

    latestJob = {
      id: latestJobRow.id,
      status: latestJobRow.status,
      level: latestJobRow.level,
      source_file_name: latestJobRow.source_file_name,
      items_count: itemCount ?? 0,
      created_at: latestJobRow.created_at,
    };
  }

  return {
    planSetCount,
    planFileCount,
    totalSizeBytes,
    latestJob,
  };
}

async function fetchAffaireListWithContext(
  context: AffaireContext,
  query: NormalizedAffaireListQuery
): Promise<AffaireListPageResult> {
  const decodedCursor = query.cursor ? decodeAffaireCursor(query.cursor) : null;
  const fetchLimit = query.size + 1;

  const { data, error } = await context.supabase.rpc("list_affaires_page", {
    p_tenant_id: context.tenantId,
    p_owner_user_id: getOwnerScopeUserId(context),
    p_limit: fetchLimit,
    p_search: query.q,
    p_statuses: query.status,
    p_cursor_updated_at: decodedCursor?.updatedAt ?? null,
    p_cursor_project_id: decodedCursor?.projectId ?? null,
    p_sort_dir: query.dir,
  });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger la liste des affaires.");
  }

  const rows = (data ?? []) as ListAffairesPageRow[];
  const hasNextPage = rows.length > query.size;
  const pageRows = hasNextPage ? rows.slice(0, query.size) : rows;
  const items = pageRows.map(toAffaireListItem);

  const lastItem = items[items.length - 1] ?? null;
  const nextCursor = hasNextPage && lastItem
    ? encodeAffaireCursor({
        updatedAt: lastItem.currentUpdatedAt,
        projectId: lastItem.projectId,
      })
    : null;

  return {
    items,
    pageSize: query.size,
    nextCursor,
    hasNextPage,
  };
}

async function fetchAffaireCountersWithContext(
  context: AffaireContext,
  query: Pick<NormalizedAffaireListQuery, "q" | "status">
): Promise<AffaireCountersResult> {
  const { data, error } = await context.supabase.rpc("get_affaires_counters", {
    p_tenant_id: context.tenantId,
    p_owner_user_id: getOwnerScopeUserId(context),
    p_search: query.q,
    p_statuses: query.status,
  });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les compteurs affaires.");
  }

  const row = ((data ?? [])[0] as AffaireCountersRow | undefined) ?? {
    total_count: 0,
    filtered_count: 0,
    draft_count: 0,
    sent_count: 0,
    accepted_count: 0,
    archived_count: 0,
  };

  return {
    totalCount: toSafeInteger(row.total_count),
    filteredCount: toSafeInteger(row.filtered_count),
    statusCounts: {
      draft: toSafeInteger(row.draft_count),
      sent: toSafeInteger(row.sent_count),
      accepted: toSafeInteger(row.accepted_count),
      archived: toSafeInteger(row.archived_count),
    },
  };
}

export async function fetchAffaireList(
  input: AffaireListQuery = {}
): Promise<AffaireListPageResult> {
  const context = await getAuthenticatedContext();
  const query = normalizeAffaireListQuery(input);
  return fetchAffaireListWithContext(context, query);
}

export async function fetchAffaireCounters(
  input: Pick<AffaireListQuery, "q" | "status"> = {}
): Promise<AffaireCountersResult> {
  const context = await getAuthenticatedContext();
  const query = normalizeAffaireListQuery(input);
  return fetchAffaireCountersWithContext(context, query);
}

export async function fetchAffairePageData(
  input: AffaireListQuery = {}
): Promise<AffairePageDataResult> {
  const context = await getAuthenticatedContext();
  const query = normalizeAffaireListQuery(input);

  const [list, counters] = await Promise.all([
    fetchAffaireListWithContext(context, query),
    fetchAffaireCountersWithContext(context, query),
  ]);

  return {
    list,
    counters,
  };
}

export const fetchAffaireProjectBasic = cache(
  async (projectId: string): Promise<AffaireHubProject> => {
    const context = await getAuthenticatedContext();
    const row = await fetchAffaireHubProjectOrThrow(context, projectId);
    return {
      id: row.id,
      name: row.name,
      reference: row.reference,
      clientName: row.client_name,
    };
  }
);

export async function fetchAffaireHubSummary(
  projectId: string
): Promise<AffaireHubSummaryResult> {
  const context = await getAuthenticatedContext();
  const project = await fetchAffaireHubProjectOrThrow(context, projectId);
  return fetchAffaireHubSummaryWithContext(context, project);
}

export async function fetchAffaireHubTimeline(
  projectId: string,
  page?: number
): Promise<AffaireHubTimelineResult> {
  const context = await getAuthenticatedContext();
  const safePage = normalizeHubTimelinePage(page);
  const project = await fetchAffaireHubProjectOrThrow(context, projectId);

  return listEstimateProjectVersions({
    projectId: project.id,
    page: safePage,
  });
}

export async function fetchAffaireHubDpgfSource(
  projectId: string
): Promise<AffaireHubDpgfSourceResult> {
  const context = await getAuthenticatedContext();
  const project = await fetchAffaireHubProjectOrThrow(context, projectId);
  return fetchAffaireHubDpgfSourceWithContext(context, project);
}

export const fetchAffaireHubPlansSummary = cache(
  async (projectId: string): Promise<AffaireHubPlansSummaryResult> => {
    const context = await getAuthenticatedContext();
    const project = await fetchAffaireHubProjectOrThrow(context, projectId);
    return fetchAffaireHubPlansSummaryWithContext(context, project);
  }
);

export async function fetchAffaireHubPageData(
  projectId: string,
  page?: number
): Promise<AffaireHubPageDataResult> {
  const context = await getAuthenticatedContext();
  const safePage = normalizeHubTimelinePage(page);
  const project = await fetchAffaireHubProjectOrThrow(context, projectId);

  const [summary, timeline, dpgfSource] = await Promise.all([
    fetchAffaireHubSummaryWithContext(context, project),
    listEstimateProjectVersions({
      projectId: project.id,
      page: safePage,
    }),
    fetchAffaireHubDpgfSourceWithContext(context, project),
  ]);

  return {
    summary,
    timeline,
    dpgfSource,
  };
}

/* ------------------------------------------------------------------ */
/*  Margin Analysis                                                     */
/* ------------------------------------------------------------------ */

type MarginAnalysisVersionRow = Pick<
  EstimateVersionRow,
  | "id"
  | "project_id"
  | "version_number"
  | "status"
  | "total_ht_cents"
  | "margin_multiplier"
  | "margin_mode"
  | "tax_rate_bp"
  | "discount_bp"
  | "discount_mode"
  | "discount_steps"
  | "global_coefficient"
  | "updated_at"
>;

function hasLaborSplitPayload(
  item: Pick<
    EstimateItemRecord,
    | "h_mo_atelier"
    | "k_mo_atelier"
    | "labor_role_atelier_id"
    | "h_mo_chantier"
    | "k_mo_chantier"
    | "labor_role_chantier_id"
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

async function fetchAffaireHubMarginAnalysisWithContext(
  context: AffaireContext,
  project: AffaireHubProjectRow
): Promise<AffaireHubMarginAnalysisResult> {
  // 1. Fetch all versions
  const { data: versionsData, error: versionsError } = await context.supabase
    .from("estimate_versions")
    .select(
      "id, project_id, version_number, status, total_ht_cents, margin_multiplier, margin_mode, tax_rate_bp, discount_bp, discount_mode, discount_steps, global_coefficient, updated_at"
    )
    .eq("tenant_id", context.tenantId)
    .eq("project_id", project.id)
    .order("version_number", { ascending: true });

  if (versionsError) {
    throw mapSupabaseError(versionsError, "Impossible de charger les versions pour l'analyse de marge.");
  }

  const versions = (versionsData ?? []) as MarginAnalysisVersionRow[];
  if (versions.length === 0) return null;

  // 2. Current version = highest version_number
  const currentVersion = versions[versions.length - 1];

  // 3. Fetch all items for current version
  const { data: itemsData, error: itemsError } = await context.supabase
    .from("estimate_items")
    .select(
      "id, parent_id, item_type, position, title, description, quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo, h_mo_atelier, k_mo_atelier, labor_role_atelier_id, h_mo_chantier, k_mo_chantier, labor_role_chantier_id, pu_ht_cents, labor_role_id, category_id, supply_type_id, line_total_ht_cents, line_tax_cents, line_total_ttc_cents"
    )
    .eq("tenant_id", context.tenantId)
    .eq("version_id", currentVersion.id);

  if (itemsError) {
    throw mapSupabaseError(itemsError, "Impossible de charger les lignes pour l'analyse de marge.");
  }

  const items = (itemsData ?? []) as EstimateItemRecord[];
  if (items.length === 0) return null;

  // 4. Fetch labor roles for rate lookup
  const laborRoleIds = new Set<string>();
  for (const item of items) {
    if (item.labor_role_id) laborRoleIds.add(item.labor_role_id);
    if (item.labor_role_atelier_id) laborRoleIds.add(item.labor_role_atelier_id);
    if (item.labor_role_chantier_id) laborRoleIds.add(item.labor_role_chantier_id);
  }

  const laborRateById = new Map<string, number>();
  if (laborRoleIds.size > 0) {
    const { data: rolesData, error: rolesError } = await context.supabase
      .from("labor_roles")
      .select("id, hourly_rate_cents")
      .eq("tenant_id", context.tenantId)
      .in("id", [...laborRoleIds]);

    if (rolesError) {
      throw mapSupabaseError(rolesError, "Impossible de charger les roles main d'oeuvre.");
    }

    for (const role of rolesData ?? []) {
      laborRateById.set(role.id, role.hourly_rate_cents ?? 0);
    }
  }

  // 5. Identify root sections
  const rootSections = items.filter(
    (item) => item.item_type === "section" && item.parent_id === null
  );
  const rootSectionIds = rootSections.map((s) => s.id);

  if (rootSectionIds.length === 0) return null;

  const marginMultiplier = Number.isFinite(currentVersion.margin_multiplier)
    ? currentVersion.margin_multiplier
    : 1;
  const taxRateBp = currentVersion.tax_rate_bp ?? 0;
  const globalCoefficient = currentVersion.global_coefficient ?? 1;
  const discountCents = computeStoredDiscountCents(
    {
      margin_multiplier: marginMultiplier,
      tax_rate_bp: taxRateBp,
      discount_bp: currentVersion.discount_bp ?? 0,
      discount_mode: currentVersion.discount_mode ?? "simple",
      discount_steps: currentVersion.discount_steps ?? [],
      global_coefficient: globalCoefficient,
      total_ht_cents: currentVersion.total_ht_cents,
    },
    items
  );
  const isLaborSplitEnabled = items.some((item) =>
    item.item_type === "line" ? hasLaborSplitPayload(item) : false
  );

  // 6. Dual-pass calculation
  // Pass 1 — Costs (margin=1, no discount)
  const costTotals = computeAllSectionTotals({
    items,
    marginMultiplier: 1,
    taxRateBp: 0,
    discountCents: 0,
    laborRateById,
    isLaborSplitEnabled,
    sectionIds: rootSectionIds,
  });

  // Pass 2 — Sales (real margin, real discount)
  const saleTotals = computeAllSectionTotals({
    items,
    marginMultiplier: marginMultiplier * globalCoefficient,
    taxRateBp,
    discountCents,
    laborRateById,
    isLaborSplitEnabled,
    sectionIds: rootSectionIds,
  });

  // 7. Global totals
  let globalCostCents = 0;
  let globalSaleCents = 0;
  for (const sectionId of rootSectionIds) {
    const cost = costTotals.get(sectionId);
    const sale = saleTotals.get(sectionId);
    globalCostCents += cost?.totalHtCents ?? 0;
    globalSaleCents += sale?.totalHtCents ?? 0;
  }

  const globalMarginEurCents = globalSaleCents - globalCostCents;
  const globalMarginPercent =
    globalCostCents > 0 ? ((globalSaleCents - globalCostCents) / globalCostCents) * 100 : 0;

  // 8. Build sections array
  const sections: MarginSectionBreakdown[] = rootSections
    .sort((a, b) => a.position - b.position)
    .map((section) => {
      const cost = costTotals.get(section.id);
      const sale = saleTotals.get(section.id);
      const costCents = cost?.totalHtCents ?? 0;
      const saleCents = sale?.totalHtCents ?? 0;
      const marginEurCents = saleCents - costCents;
      const marginPercent =
        costCents > 0 ? ((saleCents - costCents) / costCents) * 100 : 0;

      return {
        sectionId: section.id,
        sectionTitle: section.title,
        sectionPosition: section.position,
        costCents,
        saleCents,
        marginPercent,
        marginEurCents,
      };
    });

  // 9. Build version evolution
  const versionEvolution: MarginVersionPoint[] = versions.map((v) => {
    const mm = Number.isFinite(v.margin_multiplier) ? v.margin_multiplier : 1;
    return {
      versionNumber: toSafeInteger(v.version_number),
      versionId: v.id,
      status: v.status,
      marginMultiplier: mm,
      marginPercent: (mm - 1) * 100,
      totalHtCents: toSafeInteger(v.total_ht_cents),
    };
  });

  return {
    global: {
      costCents: globalCostCents,
      saleCents: globalSaleCents,
      marginPercent: globalMarginPercent,
      marginEurCents: globalMarginEurCents,
      marginMultiplier,
    },
    sections,
    versionEvolution,
    currentVersionId: currentVersion.id,
  };
}

export const fetchProjectVersionList = cache(
  async (
    projectId: string
  ): Promise<Array<{ id: string; version_number: number }>> => {
    const context = await getAuthenticatedContext();
    const project = await fetchAffaireHubProjectOrThrow(context, projectId);
    const versions: Array<{ id: string; version_number: number }> = [];
    let offset = 0;

    while (true) {
      const end = offset + AFFAIRE_PROJECT_VERSIONS_BATCH_SIZE - 1;
      const { data, error } = await context.supabase
        .from("estimate_versions")
        .select("id, version_number")
        .eq("project_id", project.id)
        .eq("tenant_id", context.tenantId)
        .order("version_number", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, end);

      if (error) {
        throw mapSupabaseError(
          error,
          "Impossible de charger la liste des versions."
        );
      }

      const rows = (data ?? []) as Array<{ id: string; version_number: number }>;
      if (rows.length === 0) {
        break;
      }

      versions.push(...rows);
      offset += rows.length;
    }

    return versions;
  }
);

export async function fetchAffaireHubMarginAnalysis(
  projectId: string
): Promise<AffaireHubMarginAnalysisResult> {
  const context = await getAuthenticatedContext();
  const project = await fetchAffaireHubProjectOrThrow(context, projectId);
  return fetchAffaireHubMarginAnalysisWithContext(context, project);
}
