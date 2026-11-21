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

const JOB_SELECT = "id, status, estimate_version_id, source_file_name, processing_strategy, provider_batch_state, error_code, created_at, completed_at, analysis_finished_at";

type JobRow = {
  id: string; status: string; estimate_version_id: string | null; source_file_name: string | null;
  processing_strategy: string | null; provider_batch_state: string | null; error_code: string | null;
  created_at: string; completed_at: string | null; analysis_finished_at: string | null;
};

function readError(error: { code?: string; message: string }): never {
  throw mapSupabaseError({ ...error, code: error.code ?? "UNKNOWN" }, "Impossible de lire le métré de l’affaire.");
}

function toZoneJob(projectId: string, row: JobRow): AffaireTakeoffZoneJob {
  const visible = resolveTakeoffVisibleJobStatus({ status: row.status,
    processingStrategy: row.processing_strategy === "batch" ? "batch" : row.processing_strategy === "sync" ? "sync" : null,
    providerBatchState: row.provider_batch_state as Parameters<typeof resolveTakeoffVisibleJobStatus>[0]["providerBatchState"] });
  const readable = row.status === "completed" || row.status === "applied";
  return {
    id: row.id, name: row.source_file_name, status: visible.status, statusLabel: visible.label,
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
  const unrequested = () => context.supabase.from("takeoff_jobs").select("id")
    .eq("tenant_id", context.tenantId).eq("project_id", projectId).is("launch_request_id", null);
  const [canOperate, requestRow, sealed, requestJobs, latest, latestReadable, ends, waitingOrRead, retryDue] = await Promise.all([
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
    // An analysis outside any request that has not ended, as the database counts it before admitting a launch.
    unrequested().in("status", ["pending", "processing"]).limit(1),
    unrequested().eq("status", "failed").not("next_retry_at", "is", null).is("analysis_outcome", null).limit(1),
  ]);
  for (const result of [requestRow, sealed, requestJobs, latest, latestReadable, ends, waitingOrRead, retryDue]) {
    if (result.error) readError(result.error);
  }

  const completionEventId = (requestRow.data as { completion_event_id?: string | null } | null)?.completion_event_id ?? null;
  const events = ((ends.data ?? []) as Array<{ event_id: string; outcome: string; finished_at: string; reason_code: string | null }>)
    .flatMap((event) => {
      const outcome = toTakeoffAnalysisOutcome(event.outcome);
      return outcome ? [{ eventId: event.event_id, outcome, finishedAt: event.finished_at,
        reason: outcome === "failure" ? takeoffCompletionFailureReason(event.reason_code) : null }] : [];
    });
  const toJob = (row: unknown) => toZoneJob(projectId, row as JobRow);
  const { request } = launch;
  const manifest = (sealed.data as { manifest?: unknown } | null)?.manifest ?? null;
  // The member's own read rights on the pieces its coverage names (no read when it names none).
  const visible = await readTakeoffVisibleSources({ supabase: context.supabase, tenantId: context.tenantId, projectId,
    ids: coverageSourceIds(manifest) });
  return {
    active: launch.active,
    canOperate,
    confirmedBeforeActivation: launch.confirmedBeforeActivation,
    request: request ? {
      id: request.id, origin: request.origin, state: request.state, mandateRevision: request.mandateRevision,
      reason: request.reason, pieces: request.pieces, hasPayer: request.hasPayer, payerIsViewer: request.payerIsViewer,
      createdAt: request.createdAt, admittedAt: request.admittedAt, closedAt: request.closedAt, outcome: request.outcome,
      units: request.units, action: request.action,
      jobs: ((requestJobs.data ?? []) as unknown[]).map(toJob),
      coverage: toAffaireTakeoffCoverage(manifest, visible),
      completionEventId,
    } : null,
    dossierChangedSinceAnalysis: launch.dossierChangedSinceAnalysis,
    latestJob: latest.data?.[0] ? toJob(latest.data[0]) : null,
    latestReview: latestReadable.data?.[0] ? toJob(latestReadable.data[0]) : null,
    // The request's own end when it has one, else the affaire's latest.
    latestEnd: events.find((event) => event.eventId === completionEventId) ?? events[0] ?? null,
    unrequestedRunning: Boolean(waitingOrRead.data?.length || retryDue.data?.length),
    viewer: { tenantId: context.tenantId, userId: context.userId },
  };
}
