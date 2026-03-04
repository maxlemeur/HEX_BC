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

export type AffaireHubTimelineResult = ListEstimateProjectVersionsResult;

export type AffaireHubPageDataResult = {
  summary: AffaireHubSummaryResult;
  timeline: AffaireHubTimelineResult;
  dpgfSource: AffaireHubDpgfSourceResult;
};

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
