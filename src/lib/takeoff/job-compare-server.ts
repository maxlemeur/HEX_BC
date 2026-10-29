import "server-only";

import { takeoffCompareDocumentKey } from "@/lib/takeoff/compare-document";
import { TAKEOFF_COMPARE_DEFAULT_THRESHOLD, buildTakeoffDiff } from "@/lib/takeoff/diff";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import {
  getAuthenticatedTakeoffContext,
  getTakeoffJobDetailByIdOrThrow,
  listAllTakeoffItemsByJobId,
} from "@/lib/takeoff/job-read-server";
import {
  takeoffJobIdSchema,
  type CompareTakeoffJobsQuery,
} from "@/lib/takeoff/schemas";
import { parseWithSchema } from "@/lib/takeoff/server-helpers";
import type { TakeoffJobCompareResponse } from "@/lib/takeoff/types";

export async function compareTakeoffJobs(
  baseJobId: string,
  input: CompareTakeoffJobsQuery
): Promise<TakeoffJobCompareResponse> {
  const { supabase, tenantId } = await getAuthenticatedTakeoffContext();
  const normalizedBaseJobId = parseWithSchema(
    takeoffJobIdSchema,
    baseJobId,
    "Identifiant job invalide."
  );
  const normalizedOtherJobId = parseWithSchema(
    takeoffJobIdSchema,
    input.with,
    "Paramètre with invalide."
  );
  const threshold = input.threshold ?? TAKEOFF_COMPARE_DEFAULT_THRESHOLD;

  if (normalizedBaseJobId === normalizedOtherJobId) {
    throw new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "La comparaison doit cibler deux jobs différents.",
      details: {
        base_job_id: normalizedBaseJobId,
        other_job_id: normalizedOtherJobId,
      },
      retryable: false,
      jobId: normalizedBaseJobId,
    });
  }

  const [baseJob, otherJob] = await Promise.all([
    getTakeoffJobDetailByIdOrThrow({
      supabase,
      tenantId,
      jobId: normalizedBaseJobId,
    }),
    getTakeoffJobDetailByIdOrThrow({
      supabase,
      tenantId,
      jobId: normalizedOtherJobId,
    }),
  ]);

  const baseDocumentKey = takeoffCompareDocumentKey(baseJob);
  const otherDocumentKey = takeoffCompareDocumentKey(otherJob);

  if (
    baseJob.estimate_version_id !== otherJob.estimate_version_id ||
    !baseDocumentKey ||
    !otherDocumentKey ||
    baseDocumentKey !== otherDocumentKey
  ) {
    throw new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message:
        "Les jobs sélectionnés ne correspondent pas au même document (version + fichier source).",
      details: {
        base_job_id: normalizedBaseJobId,
        other_job_id: normalizedOtherJobId,
        base_estimate_version_id: baseJob.estimate_version_id,
        other_estimate_version_id: otherJob.estimate_version_id,
        base_source_file_name: baseJob.source_file_name,
        other_source_file_name: otherJob.source_file_name,
      },
      retryable: false,
      jobId: normalizedBaseJobId,
    });
  }

  const [baseItems, otherItems] = await Promise.all([
    listAllTakeoffItemsByJobId({
      supabase,
      tenantId,
      jobId: normalizedBaseJobId,
    }),
    listAllTakeoffItemsByJobId({
      supabase,
      tenantId,
      jobId: normalizedOtherJobId,
    }),
  ]);

  const diff = buildTakeoffDiff({
    baseItems,
    otherItems,
    threshold,
  });

  return {
    base_job_id: normalizedBaseJobId,
    other_job_id: normalizedOtherJobId,
    threshold: diff.threshold,
    summary: diff.summary,
    added: diff.added,
    removed: diff.removed,
    changed: diff.changed,
    unchanged: diff.unchanged,
  };
}
