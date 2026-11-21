import { readAllRows } from "@/lib/supabase/read-all";

import { requireAffaireAccess, type AffaireAccessProject } from "@/lib/affaires/access-server";
import { mapSupabaseError } from "@/lib/http/api-response";
import {
  type AuthenticatedRegisterContext,
  type AffaireRegisterEntryWithProfilesRow,
  REGISTER_ACCESS,
  ENTRY_SELECT,
  normalizeAffaireRegisterEntryRow,
  toAffaireRegisterEntry,
  applyVersionScopeFilter,
} from "@/lib/affaires/register-store-server";
import { fetchAffaireRegisterGateSummary } from "@/lib/affaires/register-gate-server";
import { fetchAffaireRegisterTimelineWithContext } from "@/lib/affaires/register-timeline-server";

import {
  buildAffaireRegisterReviewExport,
  encodeAffaireRegisterCursor,
  type AffaireRegisterEntryKind,
  type AffaireRegisterEntrySeverity,
  type AffaireRegisterEntryStatus,
  type AffaireRegisterPageResult,
  type AffaireRegisterReviewExport,
  type AffaireRegisterSummary,
  type AffaireRegisterTimelineEvent,
} from "./register";

type ListAffaireRegisterPageInput = {
  projectId: string;
  versionId?: string | null;
  status?: AffaireRegisterEntryStatus | null;
  severity?: AffaireRegisterEntrySeverity | null;
  kind?: AffaireRegisterEntryKind | null;
  revalidationRequired?: boolean;
  blockingOnly?: boolean;
  cursor?: {
    id: string;
    updatedAt: string;
  } | null;
  focusEntryId?: string | null;
  size?: number;
};

const PAGE_SIZE_DEFAULT = 8;
const PAGE_SIZE_MAX = 25;

function applyCursorFilter<T extends {
  or: (filters: string) => unknown;
}>(query: T, cursor: { updatedAt: string; id: string } | null | undefined): T {
  if (!cursor) {
    return query;
  }

  query.or(
    `updated_at.lt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.lt.${cursor.id})`
  );
  return query;
}

export async function fetchAffaireRegisterSummary(input: {
  projectId: string;
  versionId?: string | null;
}): Promise<AffaireRegisterSummary> {
  const { context, project } = await requireAffaireAccess(input.projectId, "read", REGISTER_ACCESS);
  return fetchAffaireRegisterSummaryWithContext({ context, project, versionId: input.versionId });
}

async function fetchAffaireRegisterSummaryWithContext(input: {
  context: AuthenticatedRegisterContext;
  project: AffaireAccessProject;
  versionId?: string | null;
}): Promise<AffaireRegisterSummary> {
  const { context, project } = input;
  const gateSummary = await fetchAffaireRegisterGateSummary({
    supabase: context.supabase,
    projectId: project.id,
    versionId: input.versionId ?? null,
  });
  const focusClarificationEntry =
    gateSummary.criticalClarifyWithClientEntries?.[0] ??
    gateSummary.clarifyWithClientEntries[0] ??
    null;
  const focusOpenQuestionEntry =
    gateSummary.criticalOpenEntries[0] ??
    gateSummary.nonCriticalOpenEntries[0] ??
    null;
  const focusRevalidationEntry =
    gateSummary.criticalRevalidationRequiredEntries?.[0] ??
    gateSummary.revalidationRequiredEntries?.[0] ??
    null;

  return {
    openQuestionsCount: gateSummary.openQuestionsCount,
    criticalOpenCount: gateSummary.criticalOpenEntries.length,
    nonCriticalOpenCount: gateSummary.nonCriticalOpenEntries.length,
    openQuestionsFocusEntryId: focusOpenQuestionEntry?.id ?? null,
    clarifyWithClientCount: gateSummary.clarifyWithClientEntries.length,
    criticalClarifyWithClientCount:
      gateSummary.criticalClarifyWithClientEntries?.length ?? 0,
    clarifyWithClientFocusEntryId: focusClarificationEntry?.id ?? null,
    openAssumptionCount: gateSummary.openAssumptionEntries.length,
    openMissingPieceCount: gateSummary.openMissingPieceEntries.length,
    continuedWithHypothesisCount:
      gateSummary.continuedWithHypothesisEntries?.length ?? 0,
    continuedCriticalMissingPieceCount:
      gateSummary.continuedCriticalMissingPieceEntries?.length ?? 0,
    revalidationRequired:
      (gateSummary.revalidationRequiredEntries?.length ?? 0) > 0,
    revalidationRequiredCount:
      gateSummary.revalidationRequiredEntries?.length ?? 0,
    criticalRevalidationRequiredCount:
      gateSummary.criticalRevalidationRequiredEntries?.length ?? 0,
    revalidationFocusEntryId: focusRevalidationEntry?.id ?? null,
    revalidationBlocksSubmission:
      (gateSummary.revalidationRequiredEntries?.length ?? 0) > 0,
    revalidationBlocksEstimation: false,
    revalidationImpactedStages: gateSummary.revalidationImpactedStages ?? [],
  };
}

export async function fetchAffaireRegisterPage(
  input: ListAffaireRegisterPageInput
): Promise<AffaireRegisterPageResult> {
  const { context, project } = await requireAffaireAccess(input.projectId, "read", REGISTER_ACCESS);

  const pageSize = Math.max(1, Math.min(input.size ?? PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX));
  let query = context.supabase
    .from("affaire_register_entries")
    .select(ENTRY_SELECT as never)
    .eq("project_id", project.id as never)
    .eq("is_active", true as never);
  let focusedQuery: typeof query | null = input.focusEntryId
    ? context.supabase
        .from("affaire_register_entries")
        .select(ENTRY_SELECT as never)
        .eq("project_id", project.id as never)
        .eq("is_active", true as never)
        .eq("id", input.focusEntryId as never)
    : null;

  query = applyVersionScopeFilter(query, input.versionId ?? null);
  query = applyCursorFilter(query, input.cursor ?? null);
  if (focusedQuery) {
    focusedQuery = applyVersionScopeFilter(focusedQuery, input.versionId ?? null);
  }

  if (input.status) {
    query = query.eq("status", input.status as never);
    if (focusedQuery) {
      focusedQuery = focusedQuery.eq("status", input.status as never);
    }
  }
  if (input.severity) {
    query = query.eq("severity", input.severity as never);
    if (focusedQuery) {
      focusedQuery = focusedQuery.eq("severity", input.severity as never);
    }
  }
  if (input.kind) {
    query = query.eq("kind", input.kind as never);
    if (focusedQuery) {
      focusedQuery = focusedQuery.eq("kind", input.kind as never);
    }
  }
  if (input.revalidationRequired) {
    query = query.eq("metadata->revalidationRequest->>status", "required");
    if (focusedQuery) {
      focusedQuery = focusedQuery.eq(
        "metadata->revalidationRequest->>status",
        "required"
      );
    }
  }

  if (input.blockingOnly) {
    // Filter before the page limit: a blocker must remain reachable even when
    // the newest page contains only nonblocking or already resolved entries.
    const blockingFilter = "severity.eq.critical,status.eq.clarify_with_client,metadata->revalidationRequest->>status.eq.required";
    query = query.in("status", ["open", "clarify_with_client"]).or(blockingFilter);
    if (focusedQuery) {
      focusedQuery = focusedQuery.in("status", ["open", "clarify_with_client"]).or(blockingFilter);
    }
  }

  const [
    { data, error },
    focusedResult,
    [summaryResult, timelineResult],
  ] = await Promise.all([
    query
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(pageSize + 1),
    focusedQuery
      ? focusedQuery
          .order("updated_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(1)
      : Promise.resolve({ data: null, error: null }),
    Promise.allSettled([
      fetchAffaireRegisterSummaryWithContext({ context, project, versionId: input.versionId }),
      fetchAffaireRegisterTimelineWithContext({ context, project, versionId: input.versionId, size: 12 }),
    ]),
  ]);

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger le registre affaire.");
  }
  if (focusedResult.error) {
    throw mapSupabaseError(
      focusedResult.error,
      "Impossible de charger le point cible du registre affaire."
    );
  }

  const rows = ((data ?? []) as unknown[])
    .map((row) => normalizeAffaireRegisterEntryRow(row))
    .filter((row): row is AffaireRegisterEntryWithProfilesRow => row !== null);
  const focusedRow =
    ((focusedResult.data ?? []) as unknown[])
      .map((row) => normalizeAffaireRegisterEntryRow(row))
      .find((row): row is AffaireRegisterEntryWithProfilesRow => row !== null) ?? null;
  const shouldInjectFocusedRow =
    focusedRow !== null && !rows.some((row) => row.id === focusedRow.id);
  const pagedRows = rows.slice(0, shouldInjectFocusedRow ? pageSize - 1 : pageSize);
  const pageRows = shouldInjectFocusedRow ? [focusedRow, ...pagedRows] : pagedRows;
  const lastRow = pagedRows[pagedRows.length - 1] ?? null;
  if (summaryResult.status === "rejected") {
    throw summaryResult.reason;
  }
  if (timelineResult.status === "rejected") {
    throw timelineResult.reason;
  }
  const summary = summaryResult.value;
  const timeline = timelineResult.value;
  const timelineByEntryId = new Map<string, AffaireRegisterTimelineEvent[]>();

  timeline.forEach((event) => {
    const current = timelineByEntryId.get(event.entryId) ?? [];
    current.push(event);
    timelineByEntryId.set(event.entryId, current);
  });

  return {
    items: pageRows.map((row) => ({
      ...toAffaireRegisterEntry(row),
      history: timelineByEntryId.get(row.id) ?? [],
    })),
    nextCursor:
      rows.length > pagedRows.length && lastRow
        ? encodeAffaireRegisterCursor({
            id: lastRow.id,
            updatedAt: lastRow.updated_at,
          })
        : null,
    summary,
    timeline,
    filters: {
      status: input.status ?? null,
      severity: input.severity ?? null,
      kind: input.kind ?? null,
      revalidationRequired: input.revalidationRequired ?? false,
      blockingOnly: input.blockingOnly ?? false,
      cursor: input.cursor ? encodeAffaireRegisterCursor(input.cursor) : null,
      focusEntryId: input.focusEntryId ?? null,
    },
  };
}

export async function fetchAffaireRegisterReviewExport(input: {
  projectId: string;
  versionId?: string | null;
}): Promise<AffaireRegisterReviewExport> {
  const { context, project } = await requireAffaireAccess(input.projectId, "read", REGISTER_ACCESS);

  let query = context.supabase
    .from("affaire_register_entries")
    .select(ENTRY_SELECT as never, { count: "exact" })
    .eq("project_id", project.id as never)
    .eq("is_active", true as never);

  query = applyVersionScopeFilter(query as never, input.versionId ?? null) as never;

  const { data, error } = await readAllRows(() => query
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false }));

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de charger l'export de revue du registre."
    );
  }

  const entries = ((data ?? []) as unknown[])
    .map((row) => normalizeAffaireRegisterEntryRow(row))
    .filter((row): row is AffaireRegisterEntryWithProfilesRow => row !== null)
    .map(toAffaireRegisterEntry);

  return buildAffaireRegisterReviewExport({
    generatedAt: new Date().toISOString(),
    projectId: project.id,
    projectLabel: project.name,
    projectReference: project.reference ?? null,
    clientName: project.client_name ?? null,
    versionId: input.versionId ?? null,
    entries,
  });
}
