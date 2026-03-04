import { badRequest, mapSupabaseError } from "@/lib/estimates/errors";
import { getAuthenticatedContext } from "@/lib/estimates/server";
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

export type AffaireListItem = {
  projectId: string;
  projectName: string;
  projectReference: string | null;
  projectClient: string | null;
  versionCount: number;
  currentVersionId: string;
  currentVersionNumber: number;
  currentStatus: AffaireStatus;
  currentTotalHtCents: number;
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
  return {
    projectId: row.project_id,
    projectName: row.project_name,
    projectReference: row.project_reference,
    projectClient: row.project_client,
    versionCount: toSafeInteger(row.version_count),
    currentVersionId: row.current_version_id,
    currentVersionNumber: toSafeInteger(row.current_version_number),
    currentStatus: row.current_status,
    currentTotalHtCents: toSafeInteger(row.current_total_ht_cents),
    currentUpdatedAt: row.current_updated_at,
    acceptedVersionId: row.accepted_version_id,
    acceptedVersionNumber:
      row.accepted_version_number === null
        ? null
        : toSafeInteger(row.accepted_version_number),
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
