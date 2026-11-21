import "server-only";

import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { mapSupabaseError } from "@/lib/http/api-response";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { AffaireTakeoffZoneData, AffaireTakeoffZoneJob, AffaireTakeoffZoneRequest } from "@/lib/takeoff/affaire-takeoff-zone";
import { toTakeoffAnalysisOutcome } from "@/lib/takeoff/completion-outcome";
import type { TakeoffLaunchManifest } from "@/lib/takeoff/launch-request";
import { readAffaireTakeoffLaunchState } from "@/lib/takeoff/launch-request-server";
import { assertPreparationProjectAccess } from "@/lib/takeoff/preparation-repository";
import { isTakeoffSourceVisible, type TakeoffVisibleSources } from "@/lib/takeoff/request-activity";
import { takeoffReviewHref } from "@/lib/takeoff/review-href";
import { readTakeoffVisibleSources } from "@/lib/takeoff/source-visibility-server";
import {
  describeTakeoffJobFailure, resolveTakeoffVisibleJobStatus, takeoffCompletionFailureReason,
} from "@/lib/takeoff/visible-status";

const JOB_SELECT = "id, status, estimate_version_id, plan_set_id, source_file_name, source_file_path, processing_strategy, provider_batch_state, error_code, created_at, completed_at, analysis_finished_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type JobRow = {
  id: string; status: string; estimate_version_id: string | null; plan_set_id: string | null;
  source_file_name: string | null; source_file_path: string | null;
  processing_strategy: string | null; provider_batch_state: string | null; error_code: string | null;
  created_at: string; completed_at: string | null; analysis_finished_at: string | null;
};

function readError(error: { code?: string; message: string }): never {
  throw mapSupabaseError({ ...error, code: error.code ?? "UNKNOWN" }, "Impossible de lire le métré de l’affaire.");
}

/**
 * The plan file an analysis is named after: the first plan of its set, whose copy's path is
 * `<tenant>/<plan set>/<plan file>/<name>` (read here, never answered). None for any other source (an upload).
 */
function namedPlanFileOf(row: JobRow) {
  const [, planSetId, planFileId] = (row.source_file_path ?? "").split("/");
  return planSetId && planSetId === row.plan_set_id && planFileId && UUID.test(planFileId) ? planFileId : null;
}

function toZoneJob(projectId: string, row: JobRow, sources: TakeoffVisibleSources): AffaireTakeoffZoneJob {
  const visible = resolveTakeoffVisibleJobStatus({ status: row.status,
    processingStrategy: row.processing_strategy === "batch" ? "batch" : row.processing_strategy === "sync" ? "sync" : null,
    providerBatchState: row.provider_batch_state as Parameters<typeof resolveTakeoffVisibleJobStatus>[0]["providerBatchState"] });
  const readable = row.status === "completed" || row.status === "applied";
  return {
    // Named after its plan only for a member who may read that plan's copy; anyone else reads no name.
    id: row.id, name: isTakeoffSourceVisible(sources, namedPlanFileOf(row)) ? row.source_file_name : null,
    status: visible.status, statusLabel: visible.label,
    failure: row.status === "canceled" ? "Analyse annulée." : row.status === "failed" ? describeTakeoffJobFailure(row.error_code) : null,
    // A job read without a version opens its review without one: never « ?versionId=null ».
    reviewHref: readable ? takeoffReviewHref({ projectId, jobId: row.id, versionId: row.estimate_version_id }) : null,
    createdAt: row.created_at, finishedAt: row.analysis_finished_at ?? row.completed_at,
  };
}

type OmittedEntry<T extends string> = { id: string; name: string; reason: T };

function omittedEntries<T extends string>(entries: unknown, reasons: readonly T[]): OmittedEntry<T>[] {
  return (Array.isArray(entries) ? entries : []).flatMap((entry) => {
    const piece = entry as { id?: unknown; name?: unknown; reason?: unknown };
    return typeof piece.id === "string" && typeof piece.name === "string" && reasons.includes(piece.reason as T)
      ? [{ id: piece.id, name: piece.name, reason: piece.reason as T }] : [];
  });
}

const PLAN_REASONS = ["alternate", "identical_copy", "unsupported_format"] as const;
const REFERENCE_REASONS = ["unreadable", "unsupported_format", "limit"] as const;

/** The plans and pieces a request's coverage names, whose read rights decide what the member sees of them. */
function coverageSourceIds(manifest: unknown) {
  const coverage = (manifest as Partial<TakeoffLaunchManifest> | null)?.coverage;
  return [...omittedEntries(coverage?.plans_omitted, PLAN_REASONS), ...omittedEntries(coverage?.references_omitted, REFERENCE_REASONS)]
    .map((entry) => entry.id);
}

/**
 * What the request sealed, by name only: the manifest itself (digests, files, budget) never reaches a member, nor the ids
 * of its pieces. A piece is named only to a member who may read its plan file or its dossier piece (`visible`); anyone
 * else reads « Plan N » or « Pièce N », its rank in its list.
 */
export function toAffaireTakeoffCoverage(manifest: unknown, visible: TakeoffVisibleSources): AffaireTakeoffZoneRequest["coverage"] {
  const coverage = (manifest as Partial<TakeoffLaunchManifest> | null)?.coverage;
  if (!coverage || typeof coverage.plans_retained !== "number") return null;
  const named = <T extends string>(entries: OmittedEntry<T>[], neutral: string) => entries.map((entry, index) => ({
    name: isTakeoffSourceVisible(visible, entry.id) ? entry.name : `${neutral} ${index + 1}`, reason: entry.reason }));
  return {
    plansRetained: coverage.plans_retained,
    plansOmitted: named(omittedEntries(coverage.plans_omitted, PLAN_REASONS), "Plan"),
    referencesOmitted: named(omittedEntries(coverage.references_omitted, REFERENCE_REASONS), "Pièce"),
  };
}

/**
 * The takeoff's zone on the affaire's page, for the member who reads it: the latest launch request with every analysis of
 * it and its coverage, the affaire's latest analysis and latest readable one (whatever their request or version), and its
 * latest end of analysis, the event the members' notifications show. Reading never spends and never writes.
 */
export async function readAffaireTakeoffZone(context: AuthenticatedTenantContext, projectId: string): Promise<AffaireTakeoffZoneData> {
  // Checks the member's access to the affaire first.
  const launch = await readAffaireTakeoffLaunchState(context, projectId);
  const requestId = launch.request?.id ?? null;
  const jobs = () => context.supabase.from("takeoff_jobs").select(JOB_SELECT)
    .eq("tenant_id", context.tenantId).eq("project_id", projectId);
  const [canOperate, requestRow, sealed, requestJobs, latest, latestReadable, ends, unrequested] = await Promise.all([
    // The preparation's write rule (an administrator, or an engineer who may write the affaire): who sees its options.
    assertPreparationProjectAccess(context, projectId, true).then(() => true, () => false),
    requestId ? context.supabase.from("takeoff_launch_requests").select("completion_event_id")
      .eq("tenant_id", context.tenantId).eq("id", requestId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    // The manifest is not a member's column: read by the server after the access check, projected by name.
    requestId ? createServiceRoleClient().from("takeoff_launch_requests").select("manifest")
      .eq("tenant_id", context.tenantId).eq("project_id", projectId).eq("id", requestId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    requestId ? jobs().eq("launch_request_id", requestId).order("launch_unit_key").order("id")
      : Promise.resolve({ data: [] as JobRow[], error: null }),
    jobs().order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1),
    jobs().in("status", ["completed", "applied"]).order("completed_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false }).limit(1),
    context.supabase.rpc("list_affaire_takeoff_completions", { p_project_id: projectId, p_limit: 5, p_offset: 0 }),
    // An analysis outside any request that something will still move: the database's own rule, the one it applies before
    // admitting a launch (read by the server after the access check; only whether one runs reaches the member).
    createServiceRoleClient().rpc("takeoff_running_analysis_outside_request", { p_tenant_id: context.tenantId, p_project_id: projectId }),
  ]);
  for (const result of [requestRow, sealed, requestJobs, latest, latestReadable, ends, unrequested]) {
    if (result.error) readError(result.error);
  }

  const completionEventId = (requestRow.data as { completion_event_id?: string | null } | null)?.completion_event_id ?? null;
  const events = ((ends.data ?? []) as Array<{ event_id: string; outcome: string; finished_at: string; reason_code: string | null }>)
    .flatMap((event) => {
      const outcome = toTakeoffAnalysisOutcome(event.outcome);
      return outcome ? [{ eventId: event.event_id, outcome, finishedAt: event.finished_at,
        reason: outcome === "failure" ? takeoffCompletionFailureReason(event.reason_code) : null }] : [];
    });
  const { request } = launch;
  const manifest = (sealed.data as { manifest?: unknown } | null)?.manifest ?? null;
  const listedJobs = [...((requestJobs.data ?? []) as JobRow[]), ...((latest.data ?? []) as JobRow[]),
    ...((latestReadable.data ?? []) as JobRow[])];
  // The member's own read rights on every plan and piece the answer would name: its coverage's, and the plan each listed
  // analysis is named after (no read when there is none). Whether the automatic start can still begin, for this member.
  const [visible, canStart] = await Promise.all([
    readTakeoffVisibleSources({ supabase: context.supabase, tenantId: context.tenantId, projectId,
      ids: [...coverageSourceIds(manifest), ...listedJobs.map(namedPlanFileOf)] }),
    request?.origin === "automatic" && ["evaluating", "not_eligible", "blocked"].includes(request.state)
      ? createServiceRoleClient().rpc("takeoff_launch_request_can_start", { p_request_id: request.id, p_actor: context.userId })
      : Promise.resolve({ data: false, error: null }),
  ]);
  if (canStart.error) readError(canStart.error);
  const toJob = (row: unknown) => toZoneJob(projectId, row as JobRow, visible);
  return {
    active: launch.active,
    canOperate,
    confirmedBeforeActivation: launch.confirmedBeforeActivation,
    request: request ? {
      id: request.id, origin: request.origin, state: request.state, mandateRevision: request.mandateRevision,
      reason: request.reason, pieces: request.pieces, hasPayer: request.hasPayer, payerIsViewer: request.payerIsViewer,
      createdAt: request.createdAt, admittedAt: request.admittedAt, closedAt: request.closedAt, outcome: request.outcome,
      units: request.units, action: request.action, canStart: canStart.data === true,
      jobs: ((requestJobs.data ?? []) as unknown[]).map(toJob),
      coverage: toAffaireTakeoffCoverage(manifest, visible),
      completionEventId,
    } : null,
    dossierChangedSinceAnalysis: launch.dossierChangedSinceAnalysis,
    latestJob: latest.data?.[0] ? toJob(latest.data[0]) : null,
    latestReview: latestReadable.data?.[0] ? toJob(latestReadable.data[0]) : null,
    // The request's own end when it has one, else the affaire's latest.
    latestEnd: events.find((event) => event.eventId === completionEventId) ?? events[0] ?? null,
    unrequestedRunning: Boolean(unrequested.data),
    viewer: { tenantId: context.tenantId, userId: context.userId },
  };
}
