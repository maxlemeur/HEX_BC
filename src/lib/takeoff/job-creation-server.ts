import "server-only";

import { assertLocalTakeoffResumeReady, assertTakeoffJobStarter, getConfirmedTakeoffExecutionOwner, requireDetailedTakeoffProcessing } from "@/lib/ai/chatgpt-takeoff";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { mapSupabaseError } from "@/lib/http/api-response";
import {
  TakeoffError,
  TakeoffErrorCode,
  toTakeoffError,
} from "@/lib/takeoff/errors";
import { logTakeoffAuditEvent, takeoffAuditMetadataBuilders } from "@/lib/takeoff/audit";
import { classifyTakeoffPlanSetSource } from "@/lib/takeoff/document-classifier";
import {
  assertTakeoffEnabled,
  getTakeoffLevelCProcessingConfigForTenant,
} from "@/lib/takeoff/feature-flags";
import { getTakeoffPromptVersion } from "@/lib/takeoff/prompts";
import { type TakeoffLevel } from "@/lib/takeoff/types";
import { assertConfirmedTakeoffPreparation } from "@/lib/takeoff/preparation-server";
import type { Json } from "@/types/database";
import { assertReplayedTakeoffProcessing } from "@/lib/takeoff/preparation-processing-server";
import {
  LEGACY_PLAN_SET_PROCESSING,
  type TakeoffJobRow,
  type TakeoffJobCreateResponse,
  derivePlanSetTakeoffJobId,
  normalizeTakeoffJobRow,
} from "@/lib/takeoff/job-creation-input";
import {
  assertPlanSetAccessibleForCreation,
  insertTakeoffJob,
  resolvePlanSetSourceFile,
  getTakeoffJobById,
  getTakeoffPlanSetJobByPreparation,
  assertEstimateVersionAccessibleAsDraft,
  assertEstimateVersionAccessibleForTakeoff,
  removeCreatedJobIfPresent,
} from "@/lib/takeoff/job-creation-repository";

function takeoffJobInsertError(error: { code: string; message: string }, jobId: string, level?: TakeoffLevel) {
  if (error.code === "23514" && error.message === "TAKEOFF_JOB_ADMISSION_LIMIT") {
    return new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.TAKEOFF_JOB_ADMISSION_LIMIT,
      message: "Trop d'analyses takeoff en cours ou créées récemment. Réessayez plus tard.",
      retryable: true,
      jobId,
      level,
    });
  }
  return toTakeoffError(
    mapSupabaseError(error, "Impossible de créer le job takeoff."),
    { fallbackCode: TakeoffErrorCode.INTERNAL_ERROR, retryable: false, jobId, level },
  );
}

export type CreatePreparedPlanSetJobInput = {
  projectId: string;
  planSetId: string;
  estimateVersionId: string;
  level?: TakeoffLevel;
  provider?: import("@/lib/takeoff/types").TakeoffProvider;
  preparationRevision?: number | null;
  sourceVersionId?: string;
};

export async function findTakeoffJobForPlanSetLaunch(input: CreatePreparedPlanSetJobInput, executionProvider?: "chatgpt_local") {
  const context = await getAuthenticatedContext();
  const level = input.level ?? LEGACY_PLAN_SET_PROCESSING.level;
  const provider = input.provider ?? LEGACY_PLAN_SET_PROCESSING.provider;
  const deterministic = await getTakeoffJobById({
    supabase: context.supabase, tenantId: context.tenantId,
    jobId: derivePlanSetTakeoffJobId({ ...input, tenantId: context.tenantId }),
  });
  const existing = deterministic ?? await getTakeoffPlanSetJobByPreparation({
    ...input, supabase: context.supabase, tenantId: context.tenantId,
    preparationRevision: input.preparationRevision ?? null, level,
    executionProvider,
  });
  if (!existing) return null;
  await assertEstimateVersionAccessibleForTakeoff({
    ...context, estimateVersionId: existing.estimate_version_id,
  });
  assertReplayedTakeoffProcessing(existing, { level, provider });
  if (existing.status === "pending") {
    assertTakeoffJobStarter(existing, context.userId);
    await assertLocalTakeoffResumeReady(context.supabase, context.tenantId, existing);
  }
  return normalizeTakeoffJobRow(existing);
}

export async function createTakeoffJobFromPlanSet(input: CreatePreparedPlanSetJobInput): Promise<TakeoffJobCreateResponse> {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId, tenantRole } = context;
  const existing = await findTakeoffJobForPlanSetLaunch(input);
  if (existing) return existing;

  const { level, provider } = requireDetailedTakeoffProcessing(input);

  await assertTakeoffEnabled(tenantId, { supabase });
  await assertEstimateVersionAccessibleAsDraft({
    supabase,
    tenantId,
    userId,
    tenantRole,
    estimateVersionId: input.estimateVersionId,
  });
  const preparationSnapshot = await assertConfirmedTakeoffPreparation({
    context, projectId: input.projectId, estimateVersionId: input.estimateVersionId,
    preparationRevision: input.preparationRevision ?? null, planSetId: input.planSetId,
    sourceVersionId: input.sourceVersionId,
    level, provider,
  });
  const executionOwner = await getConfirmedTakeoffExecutionOwner(supabase, { userId, tenantId }, preparationSnapshot);
  const planSetPageConfig = await getTakeoffLevelCProcessingConfigForTenant(tenantId, { supabase });

  await assertPlanSetAccessibleForCreation({
    supabase,
    tenantId,
    projectId: input.projectId,
    planSetId: input.planSetId,
  });

  const jobId = derivePlanSetTakeoffJobId({ ...input, tenantId, level });
  const sourceFile = await resolvePlanSetSourceFile({
    supabase,
    tenantId,
    planSetId: input.planSetId,
    jobId,
    maxPages: planSetPageConfig.maxPdfPages,
    selectedFileIds: preparationSnapshot.preparation.sources.filter((source) => source.active && source.kind === "plan").map((source) => source.document_id),
  });
  const planSetClassification = classifyTakeoffPlanSetSource({
    files: sourceFile.planFiles.map((planFile) => ({
      file_name: planFile.source_label ?? `plan-set-${input.planSetId}.pdf`,
      file_type: planFile.file_type ?? "application/pdf",
      page_count:
        typeof planFile.page_count === "number" ? planFile.page_count : null,
    })),
  });

  const { data: insertedJob, error: insertError } = await insertTakeoffJob({
    supabase,
    row: {
      id: jobId,
      tenant_id: tenantId,
      estimate_version_id: input.estimateVersionId,
      plan_set_id: input.planSetId,
      level,
      status: "pending",
      processing_strategy: "sync",
      source_file_name: sourceFile.sourceFileName,
      source_file_path: sourceFile.sourceFilePath,
      source_file_type: sourceFile.sourceFileType,
      source_file_size_bytes: sourceFile.sourceFileSizeBytes,
      prompt_version: getTakeoffPromptVersion(level),
      created_by: userId,
      preparation_snapshot: preparationSnapshot as unknown as Json,
      ...executionOwner,
    },
  });

  if (insertError || !insertedJob) {
    if (insertError?.code === "23505") {
      const winner = await findTakeoffJobForPlanSetLaunch(input, executionOwner.execution_provider);
      if (winner) return winner;
    }
    if (insertError) throw takeoffJobInsertError(insertError, jobId, level);
    throw toTakeoffError(new Error("Impossible de créer le job takeoff."), {
      fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
      retryable: false,
      jobId,
    });
  }

  const createdJob = insertedJob as TakeoffJobRow;

  try {
    const createdAuditMetadata =
      takeoffAuditMetadataBuilders["takeoff.job.created"]({
        level,
        estimate_version_id: createdJob.estimate_version_id,
        source_file_name: createdJob.source_file_name,
        plan_set_id: input.planSetId,
        classification: planSetClassification,
        selection: {
          selected_level: level,
          override_applied:
            planSetClassification.recommendedLevel === null ||
            planSetClassification.recommendedLevel !== level,
          source_kind: "plan_set",
        },
      });

    await logTakeoffAuditEvent({
      supabase,
      tenantId,
      userId,
      jobId: createdJob.id,
      estimateVersionId: createdJob.estimate_version_id,
      action: "takeoff.job.created",
      metadata: createdAuditMetadata,
      mode: "fail-hard",
    });
  } catch (error) {
    await removeCreatedJobIfPresent({ supabase, tenantId, jobId: createdJob.id });
    throw error;
  }

  return normalizeTakeoffJobRow(createdJob);
}
