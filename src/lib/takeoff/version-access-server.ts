import "server-only";

import { type AuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import { mapSupabaseError } from "@/lib/estimates/errors";
import {
  TakeoffError,
  TakeoffErrorCode,
  toTakeoffError,
} from "@/lib/takeoff/errors";
import { listAccessibleTakeoffJobsForVersion } from "@/lib/takeoff/version-links";

export async function getEstimateVersionProjectIdOrThrow(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  versionId: string;
}): Promise<string> {
  const { data, error } = await input.supabase
    .from("estimate_versions" as never)
    .select("id, project_id" as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("id" as never, input.versionId as never)
    .maybeSingle();

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de charger la version cible."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
      }
    );
  }

  const versionRow = (data ?? null) as { id: string; project_id: string } | null;

  if (!versionRow || typeof versionRow.project_id !== "string") {
    throw new TakeoffError({
      status: 404,
      code: TakeoffErrorCode.NOT_FOUND,
      message: "Version cible introuvable.",
      details: {
        version_id: input.versionId,
      },
      retryable: false,
    });
  }

  return versionRow.project_id;
}

export async function assertTakeoffJobAccessibleForVersion(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  versionId: string;
  jobId: string;
}) {
  const jobs = await listAccessibleTakeoffJobsForVersion({
    supabase: input.supabase,
    tenantId: input.tenantId,
    versionId: input.versionId,
  });

  const match = jobs.find((job) => job.id === input.jobId) ?? null;
  if (match) {
    return match;
  }

  throw new TakeoffError({
    status: 409,
    code: TakeoffErrorCode.CONFLICT,
    message: "Ce job takeoff n'est pas accessible pour cette version.",
    details: {
      version_id: input.versionId,
      job_id: input.jobId,
    },
    retryable: false,
    jobId: input.jobId,
  });
}
