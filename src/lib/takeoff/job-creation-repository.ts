import "server-only";

import type { Database } from "@/types/database";
import { type AuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import { readAllRows } from "@/lib/supabase/read-all";
import { getPlanFileDisplayName } from "@/lib/takeoff/plan-file-display-name";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { assertDraftStatus } from "@/lib/estimates/server";
import { mapSupabaseError } from "@/lib/estimates/errors";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  TakeoffError,
  TakeoffErrorCode,
  toTakeoffError,
} from "@/lib/takeoff/errors";
import {
  inspectPlanSetResourceBudget,
  PLAN_SET_MAX_FILES,
  PLAN_SET_MAX_TOTAL_SIZE_BYTES,
} from "@/lib/takeoff/plans";
import { TAKEOFF_PLAN_SET_LEVEL, type TakeoffJobRow } from "@/lib/takeoff/job-creation-input";

const TAKEOFF_FILES_BUCKET = "takeoff-files";

type CreationSupabase = Awaited<ReturnType<typeof getAuthenticatedContext>>["supabase"];
type TakeoffJobInsert = Database["public"]["Tables"]["takeoff_jobs"]["Insert"];

/** Persistence never decides replay or compensation: the creating operation owns them. */
export async function insertTakeoffJob(input: {
  supabase: CreationSupabase;
  row: TakeoffJobInsert;
}) {
  return input.supabase
    .from("takeoff_jobs")
    .insert(input.row)
    .select("id, status, level, source_file_name, source_file_path, estimate_version_id, created_at")
    .single();
}

export async function uploadTakeoffSourceFile(input: {
  supabase: CreationSupabase;
  storagePath: string;
  file: File;
  contentType: string;
}) {
  return input.supabase.storage.from(TAKEOFF_FILES_BUCKET).upload(
    input.storagePath,
    input.file,
    { contentType: input.contentType, upsert: false }
  );
}

export async function assertPlanSetAccessibleForCreation(input: {
  supabase: CreationSupabase;
  tenantId: string;
  projectId: string;
  planSetId: string;
}) {
  const { data, error } = await input.supabase
    .from("plan_sets" as never)
    .select("id" as never)
    .eq("id" as never, input.planSetId as never)
    .eq("project_id" as never, input.projectId as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .single();

  if (error || !data) {
    throw new TakeoffError({
      status: 404,
      code: TakeoffErrorCode.NOT_FOUND,
      message: "Jeu de plans introuvable.",
      retryable: false,
    });
  }
}

export async function resolvePlanSetSourceFile(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  planSetId: string;
  jobId: string;
  maxPages: number;
}) {
  const { data, error } = await readAllRows(() => input.supabase
    .from("plan_files" as never)
    .select("file_path, file_name, file_type, file_size_bytes, page_count, id, metadata" as never, { count: "exact" })
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("plan_set_id" as never, input.planSetId as never)
    .order("created_at" as never, { ascending: true }));

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les fichiers du jeu de plans.");
  }

  const planFiles = ((data ?? []) as Array<{
    file_path?: string | null;
    file_name?: string | null;
    file_type?: string | null;
    file_size_bytes?: number | null;
    page_count?: number | null;
    metadata?: unknown;
  }>).map((planFile) => ({
    ...planFile,
    // M1b : le libellé d'origine (M1a), pas la clé Storage nettoyée, nomme le job et ses fichiers.
    source_label:
      typeof planFile.file_name === "string" && planFile.file_name.trim().length > 0
        ? getPlanFileDisplayName({
            file_name: planFile.file_name.trim(),
            metadata:
              planFile.metadata && typeof planFile.metadata === "object" && !Array.isArray(planFile.metadata)
                ? (planFile.metadata as Record<string, unknown>)
                : null,
          })
        : null,
  }));

  if (planFiles.length === 0) {
    throw new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.BAD_REQUEST,
      message: "Le jeu de plans ne contient aucun fichier.",
      retryable: false,
      jobId: input.jobId,
      level: TAKEOFF_PLAN_SET_LEVEL,
    });
  }

  const resourceBudget = inspectPlanSetResourceBudget(planFiles, {
    maxPages: input.maxPages,
  });
  if (resourceBudget.violation) {
    throw new TakeoffError({
      status: 413,
      code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE,
      message: "Le jeu de plans depasse les limites de traitement autorisees.",
      details: {
        violation: resourceBudget.violation,
        file_count: resourceBudget.fileCount,
        max_file_count: PLAN_SET_MAX_FILES,
        total_size_bytes: resourceBudget.totalSizeBytes,
        max_total_size_bytes: PLAN_SET_MAX_TOTAL_SIZE_BYTES,
        known_page_count: resourceBudget.knownPageCount,
        unknown_page_count: resourceBudget.unknownPageCount,
        max_pdf_pages: input.maxPages,
      },
      retryable: false,
      jobId: input.jobId,
      level: TAKEOFF_PLAN_SET_LEVEL,
    });
  }

  const firstPlanFile = planFiles[0];
  const sourceFilePath =
    typeof firstPlanFile?.file_path === "string" && firstPlanFile.file_path.trim().length > 0
      ? firstPlanFile.file_path.trim()
      : null;
  const sourceFileName = firstPlanFile?.source_label ?? `plan-set-${input.planSetId}.pdf`;
  const sourceFileType =
    typeof firstPlanFile?.file_type === "string" && firstPlanFile.file_type.trim().length > 0
      ? firstPlanFile.file_type.trim()
      : "application/pdf";
  const sourceFileSizeBytes =
    resourceBudget.totalSizeBytes;

  if (!sourceFilePath) {
    throw new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.NOT_FOUND,
      message: "Le jeu de plans ne référence aucun fichier stocke.",
      retryable: false,
      jobId: input.jobId,
      level: TAKEOFF_PLAN_SET_LEVEL,
    });
  }

  return {
    sourceFileName,
    sourceFilePath,
    sourceFileType,
    sourceFileSizeBytes,
    planFiles,
  };
}

export async function getTakeoffJobById(input: {
  supabase: Awaited<ReturnType<typeof getAuthenticatedContext>>["supabase"];
  tenantId: string;
  jobId: string;
}) {
  const { data, error } = await input.supabase
    .from("takeoff_jobs" as never)
    .select(
      "id, status, level, source_file_name, source_file_path, estimate_version_id, created_at" as never
    )
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("id" as never, input.jobId as never)
    .maybeSingle();

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de vérifier l'idempotence du job."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.jobId,
      }
    );
  }

  return (data ?? null) as TakeoffJobRow | null;
}

type TakeoffTargetVersionAccess = {
  supabase: Awaited<ReturnType<typeof getAuthenticatedContext>>["supabase"];
  estimateVersionId: string;
  tenantId: string;
  userId: string;
  tenantRole: string;
};

export async function assertEstimateVersionAccessibleAsDraft(input: TakeoffTargetVersionAccess) {
  const version = await assertEstimateVersionAccessibleForTakeoff(input);
  assertDraftStatus(version.status);
}

export async function assertEstimateVersionAccessibleForTakeoff(input: TakeoffTargetVersionAccess) {
  const { data, error } = await input.supabase
    .from("estimate_versions")
    .select("id, status, estimate_projects!inner(tenant_id, user_id)")
    .eq("id", input.estimateVersionId)
    .eq("tenant_id", input.tenantId)
    .single();

  if (error || !data) {
    throw new TakeoffError({
      status: 404,
      code: TakeoffErrorCode.NOT_FOUND,
      message: "Version de chiffrage introuvable.",
      retryable: false,
    });
  }

  const estimateProjects = data.estimate_projects as
    | { tenant_id: string; user_id: string }
    | Array<{ tenant_id: string; user_id: string }>
    | null;
  const project = Array.isArray(estimateProjects)
    ? estimateProjects[0]
    : estimateProjects;

  if (!project || project.tenant_id !== input.tenantId) {
    throw new TakeoffError({
      status: 404,
      code: TakeoffErrorCode.NOT_FOUND,
      message: "Version de chiffrage introuvable.",
      retryable: false,
    });
  }

  const canAccess =
    project.user_id === input.userId || input.tenantRole === "admin";
  if (!canAccess) {
    throw new TakeoffError({
      status: 403,
      code: TakeoffErrorCode.TAKEOFF_TENANT_UNAUTHORIZED,
      message: "Accès interdit aux ressources de ce tenant.",
      retryable: false,
    });
  }

  return data;
}

export async function removeUploadedFileIfPresent(input: {
  storagePath: string;
}) {
  // The upload can exist before its takeoff_jobs row. The authenticated
  // Storage DELETE policy intentionally requires that row, so rollback uses
  // the server-only client for this server-generated exact path.
  const storageAdmin = createServiceRoleClient();
  const { error } = await storageAdmin.storage
    .from(TAKEOFF_FILES_BUCKET)
    .remove([input.storagePath]);

  if (error) {
    console.error("Failed to rollback takeoff storage upload", {
      storagePath: input.storagePath,
      error,
    });
  }
}

export async function removeCreatedJobIfPresent(input: {
  supabase: Awaited<ReturnType<typeof getAuthenticatedContext>>["supabase"];
  tenantId: string;
  jobId: string;
}) {
  const { error } = await input.supabase
    .from("takeoff_jobs" as never)
    .delete()
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("id" as never, input.jobId as never);

  if (error) {
    console.error("Failed to rollback takeoff job creation", {
      jobId: input.jobId,
      tenantId: input.tenantId,
      error,
    });
  }
}
