import "server-only";

import { assertLocalTakeoffResumeReady, assertTakeoffProviderAvailable, getTakeoffExecutionOwner, parseTakeoffProvider } from "@/lib/ai/chatgpt-takeoff";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { mapSupabaseError } from "@/lib/http/api-response";
import {
  TakeoffError,
  TakeoffErrorCode,
  toTakeoffError,
} from "@/lib/takeoff/errors";
import { takeoffAuditMetadataBuilders } from "@/lib/takeoff/audit";
import { classifyTakeoffPlanSetSource } from "@/lib/takeoff/document-classifier";
import {
  assertTakeoffEnabled,
  getTakeoffChunkingConfigForTenant,
  getTakeoffLevelCProcessingConfigForTenant,
} from "@/lib/takeoff/feature-flags";
import { assertPreparationProjectAccess } from "@/lib/takeoff/preparation-repository";
import { takeoffJobIdSchema } from "@/lib/takeoff/schemas";
import { parseWithSchema } from "@/lib/takeoff/server-helpers";
import { getTakeoffPromptVersion } from "@/lib/takeoff/prompts";
import { type TakeoffLevel } from "@/lib/takeoff/types";
import { assertConfirmedTakeoffPreparation } from "@/lib/takeoff/preparation-server";
import type { Json } from "@/types/database";
import { assertReplayedTakeoffProcessing } from "@/lib/takeoff/preparation-processing-server";
import {
  TAKEOFF_PLAN_SET_LEVEL,
  type TakeoffJobRow,
  type TakeoffJobCreateResponse,
  deriveDeterministicJobId,
  derivePlanSetTakeoffJobId,
  normalizeTakeoffJobRow,
} from "@/lib/takeoff/job-creation-input";
import {
  assertPlanSetAccessibleForCreation,
  admitPreparedTakeoffJob,
  assertTakeoffJobCreationRecorded,
  resolvePlanSetSourceFile,
  getTakeoffJobById,
  getTakeoffPlanSetJobByPreparation,
  assertEstimateVersionAccessibleAsDraft,
  assertEstimateVersionAccessibleForTakeoff,
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
  if (error.message === "TAKEOFF_JOB_CREATION_AUDIT_FAILED") {
    return new TakeoffError({ status: 500, code: TakeoffErrorCode.INTERNAL_ERROR,
      message: "Impossible d'enregistrer l'audit takeoff.", retryable: false, jobId, level });
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
  const deterministic = await getTakeoffJobById({
    supabase: context.supabase, tenantId: context.tenantId,
    jobId: derivePlanSetTakeoffJobId({ ...input, tenantId: context.tenantId }),
  });
  const existing = deterministic ?? await getTakeoffPlanSetJobByPreparation({
    ...input, supabase: context.supabase, tenantId: context.tenantId,
    preparationRevision: input.preparationRevision ?? null, level: input.level ?? TAKEOFF_PLAN_SET_LEVEL,
    executionProvider,
  });
  if (!existing) return null;
  await assertEstimateVersionAccessibleForTakeoff({
    ...context, estimateVersionId: existing.estimate_version_id,
  });
  assertReplayedTakeoffProcessing(existing, { level: input.level ?? TAKEOFF_PLAN_SET_LEVEL, provider: input.provider ?? "auto" });
  await assertTakeoffJobCreationRecorded(context.tenantId, existing.id);
  if (existing.status === "pending") await assertLocalTakeoffResumeReady(context.supabase, context.tenantId, existing);
  return normalizeTakeoffJobRow(existing);
}

type CreateAffaireTakeoffJobInput = {
  projectId: string;
  planSetId: string;
  preparationRevision: number;
  operationId: string;
};

export async function createTakeoffJobFromPlanSet(input: CreatePreparedPlanSetJobInput): Promise<TakeoffJobCreateResponse> {
  return createPreparedPlanSetTakeoffJob(input);
}

/** The server caller supplies one operation ID and keeps it on retries. */
export async function createAffaireTakeoffJob(input: CreateAffaireTakeoffJobInput) {
  const operationId = parseWithSchema(takeoffJobIdSchema, input.operationId, "Identifiant d’opération invalide.");
  return createPreparedPlanSetTakeoffJob({ ...input, operationId: operationId.toLowerCase(), estimateVersionId: null, level: "C", provider: "chatgpt" });
}

type AffaireJobReceipt = Omit<TakeoffJobCreateResponse, "estimate_version_id"> & {
  estimate_version_id: null;
  project_id: string;
};

function createPreparedPlanSetTakeoffJob(input: CreatePreparedPlanSetJobInput): Promise<TakeoffJobCreateResponse>;
function createPreparedPlanSetTakeoffJob(input: CreateAffaireTakeoffJobInput & {
  estimateVersionId: null; level: "C"; provider: "chatgpt"; sourceVersionId?: never;
}): Promise<AffaireJobReceipt>;
async function createPreparedPlanSetTakeoffJob(input: CreatePreparedPlanSetJobInput | (CreateAffaireTakeoffJobInput & {
  estimateVersionId: null; level: "C"; provider: "chatgpt"; sourceVersionId?: never;
})): Promise<TakeoffJobCreateResponse | AffaireJobReceipt> {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId, tenantRole } = context;
  const level = input.level ?? TAKEOFF_PLAN_SET_LEVEL;

  if (level === "A") {
    throw new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.BAD_REQUEST,
      message:
        "Le niveau Rapide n'est pas disponible pour les jeux de plans. Utilisez Standard ou Détaillé.",
      retryable: false,
      level,
    });
  }

  const { estimateVersionId, projectId } = input;
  const jobId = input.estimateVersionId === null
    ? deriveDeterministicJobId(tenantId, `takeoff-affaire:${input.operationId}`)
    : derivePlanSetTakeoffJobId({ ...input, tenantId, level });
  async function findExisting(executionProvider?: Parameters<typeof findTakeoffJobForPlanSetLaunch>[1]) {
    if (input.estimateVersionId !== null) return findTakeoffJobForPlanSetLaunch(input, executionProvider);
    const row = await getTakeoffJobById({ supabase, tenantId, projectId, jobId });
    if (!row || row.estimate_version_id !== null) return null;
    const snapshot = row.preparation_snapshot as { preparation_revision?: number } | null;
    if (row.plan_set_id !== input.planSetId || snapshot?.preparation_revision !== input.preparationRevision) {
      throw new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT,
        message: "Cette opération est déjà associée à une autre préparation.", retryable: false, jobId });
    }
    assertReplayedTakeoffProcessing(row, { level: "C", provider: "chatgpt" });
    await assertTakeoffJobCreationRecorded(tenantId, row.id);
    if (row.status === "pending") await assertLocalTakeoffResumeReady(supabase, tenantId, row);
    return affaireJobReceipt(row, projectId);
  }

  if (estimateVersionId === null) {
    await assertPreparationProjectAccess(context, projectId, true);
  }
  const existing = await findExisting();
  if (existing) return existing;

  assertTakeoffProviderAvailable(parseTakeoffProvider(input.provider));
  await assertTakeoffEnabled(tenantId, { supabase });
  if (estimateVersionId !== null) await assertEstimateVersionAccessibleAsDraft({
    supabase, tenantId, userId, tenantRole, estimateVersionId,
  });
  const preparationSnapshot = await assertConfirmedTakeoffPreparation({
    context, projectId: input.projectId, estimateVersionId: input.estimateVersionId,
    preparationRevision: input.preparationRevision ?? null, planSetId: input.planSetId,
    sourceVersionId: input.sourceVersionId,
    level, provider: input.provider ?? "auto",
  });
  const executionOwner = await getTakeoffExecutionOwner(supabase, { userId, tenantId }, input.provider);
  const planSetPageConfig = level === "C"
    ? await getTakeoffLevelCProcessingConfigForTenant(tenantId, { supabase })
    : await getTakeoffChunkingConfigForTenant(tenantId, { supabase });

  await assertPlanSetAccessibleForCreation({
    supabase,
    tenantId,
    projectId: input.projectId,
    planSetId: input.planSetId,
  });

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

  const guidance = takeoffAuditMetadataBuilders["takeoff.job.created"]({
    level,
    estimate_version_id: estimateVersionId,
    ...(estimateVersionId === null ? { project_id: projectId } : {}),
    source_file_name: sourceFile.sourceFileName,
    plan_set_id: input.planSetId,
    classification: planSetClassification,
    selection: {
      selected_level: level,
      override_applied: planSetClassification.recommendedLevel !== level,
      source_kind: "plan_set",
    },
  });
  const { data: insertedJob, error: insertError } = await admitPreparedTakeoffJob({
    supabase,
    guidance: { classification: guidance.classification, selection: guidance.selection },
    row: {
      id: jobId,
      tenant_id: tenantId,
      estimate_version_id: estimateVersionId,
      project_id: projectId,
      plan_set_id: input.planSetId,
      level,
      source_file_name: sourceFile.sourceFileName,
      source_file_path: estimateVersionId === null ? null : sourceFile.sourceFilePath,
      source_file_type: sourceFile.sourceFileType,
      source_file_size_bytes: sourceFile.sourceFileSizeBytes,
      prompt_version: getTakeoffPromptVersion(level),
      preparation_snapshot: preparationSnapshot as unknown as Json,
      ...executionOwner,
    },
  });

  if (insertError || !insertedJob) {
    if (insertError?.code === "23505") {
      const winner = await findExisting(executionOwner.execution_provider);
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

  return estimateVersionId === null ? affaireJobReceipt(createdJob, projectId) : normalizeTakeoffJobRow(createdJob);
}

function affaireJobReceipt(row: TakeoffJobRow, projectId: string): AffaireJobReceipt {
  return { id: row.id, project_id: projectId, estimate_version_id: null, status: row.status,
    level: row.level, source_file_name: row.source_file_name, created_at: row.created_at };
}
