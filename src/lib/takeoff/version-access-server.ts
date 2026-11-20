import "server-only";

import { getAuthenticatedTakeoffContext, getTakeoffJobDetailByIdOrThrow, type AuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import { mapSupabaseError } from "@/lib/http/api-response";
import {
  TakeoffError,
  TakeoffErrorCode,
  toTakeoffError,
} from "@/lib/takeoff/errors";
import { listAccessibleTakeoffJobsForVersion } from "@/lib/takeoff/version-links";
import { takeoffJobIdSchema } from "@/lib/takeoff/schemas";

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

/** Resolve an affaire review before rendering its client-side requests. */
export async function resolveTakeoffReviewScope(input: {
  projectId: string;
  jobId: string;
  versionId?: string;
}) {
  if (!takeoffJobIdSchema.safeParse(input.projectId).success
    || !takeoffJobIdSchema.safeParse(input.jobId).success
    || (input.versionId !== undefined && !takeoffJobIdSchema.safeParse(input.versionId).success)) return null;

  const projectId = input.projectId.toLowerCase();
  const jobId = input.jobId.toLowerCase();
  const versionId = input.versionId?.toLowerCase();
  const auth = await getAuthenticatedTakeoffContext();
  try {
    const job = await getTakeoffJobDetailByIdOrThrow({ ...auth, projectId, jobId });
    if (versionId !== undefined && versionId !== job.estimate_version_id) {
      if (job.estimate_version_id === null) return null;
      if (await getEstimateVersionProjectIdOrThrow({ ...auth, versionId }) !== projectId) return null;
      const { data: link, error } = await auth.supabase.from("takeoff_version_links").select("id")
        .eq("tenant_id", auth.tenantId).eq("takeoff_job_id", job.id)
        .eq("source_version_id", job.estimate_version_id).eq("target_version_id", versionId).maybeSingle();
      if (error) throw mapSupabaseError(error, "Impossible de vérifier le report du métré.");
      if (!link) return null;
    }
    return {
      versionId: versionId ?? job.estimate_version_id,
      canEdit: auth.tenantRole === "admin" || auth.tenantRole === "engineer",
    };
  } catch (error) {
    if (error instanceof TakeoffError && error.status === 404) return null;
    throw error;
  }
}
