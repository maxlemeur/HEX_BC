import "server-only";

import { assertLocalTakeoffResumeReady, assertTakeoffJobStarter, getConfirmedTakeoffExecutionOwner, requireDetailedTakeoffProcessing } from "@/lib/ai/chatgpt-takeoff";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { mapSupabaseError } from "@/lib/http/api-response";
import {
  TakeoffError,
  TakeoffErrorCode,
  toTakeoffError,
} from "@/lib/takeoff/errors";
import {
  assertTakeoffEnabled,
  getTakeoffLevelCProcessingConfigForTenant,
} from "@/lib/takeoff/feature-flags";
import { assertPreparationProjectAccess } from "@/lib/takeoff/preparation-repository";
import { takeoffJobIdSchema } from "@/lib/takeoff/schemas";
import { parseWithSchema } from "@/lib/takeoff/server-helpers";
import { getTakeoffPromptVersion } from "@/lib/takeoff/prompts";
import { type TakeoffLevel } from "@/lib/takeoff/types";
import { hasTakeoffPreparationCopyReceipt } from "@/lib/takeoff/preparation-copy-provenance-server";
import { assertConfirmedTakeoffPreparation } from "@/lib/takeoff/preparation-server";
import type { Json } from "@/types/database";
import { assertReplayedTakeoffProcessing } from "@/lib/takeoff/preparation-processing-server";
import {
  LEGACY_PLAN_SET_PROCESSING,
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

export function takeoffJobInsertError(error: { code: string; message: string }, jobId: string, level?: TakeoffLevel) {
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

  const conflict = () => new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT,
    message: "Ce lancement est déjà associé à une autre préparation ou version.", retryable: false, jobId: existing.id });
  const revision = input.preparationRevision ?? null;
  const snapshot = existing.preparation_snapshot as { preparation_revision?: number } | null | undefined;
  const sourceVersionId = input.sourceVersionId ?? input.estimateVersionId;
  const targetVersionId = existing.estimate_version_id;
  if (targetVersionId === null || existing.project_id !== input.projectId || existing.plan_set_id !== input.planSetId
    || (snapshot?.preparation_revision ?? null) !== revision
    || (targetVersionId !== input.estimateVersionId && sourceVersionId !== input.estimateVersionId)) throw conflict();

  await assertEstimateVersionAccessibleForTakeoff({
    ...context, estimateVersionId: targetVersionId,
  });
  if (targetVersionId !== sourceVersionId && (revision === null || !await hasTakeoffPreparationCopyReceipt({
    context, projectId: input.projectId, sourceVersionId, targetVersionId, preparationRevision: revision,
  }))) throw conflict();
  assertReplayedTakeoffProcessing(existing, { level, provider });
  await assertTakeoffJobCreationRecorded(context.tenantId, existing);
  if (existing.status === "pending") {
    assertTakeoffJobStarter(existing, context.userId);
    await assertLocalTakeoffResumeReady(context.supabase, context.tenantId, existing);
  }
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
  const { estimateVersionId, projectId } = input;
  // A version launch's ID follows its inputs (its processing is checked below, before anything is written).
  const jobId = input.estimateVersionId === null
    ? deriveDeterministicJobId(tenantId, `takeoff-affaire:${input.operationId}`)
    : derivePlanSetTakeoffJobId({ ...input, tenantId });
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
    await assertTakeoffJobCreationRecorded(tenantId, row);
    if (row.status === "pending") {
      assertTakeoffJobStarter(row, userId);
      await assertLocalTakeoffResumeReady(supabase, tenantId, row);
    }
    return affaireJobReceipt(row, projectId);
  }

  if (estimateVersionId === null) {
    await assertPreparationProjectAccess(context, projectId, true);
  }
  const existing = await findExisting();
  if (existing) return existing;

  const { level, provider } = requireDetailedTakeoffProcessing(input);

  await assertTakeoffEnabled(tenantId, { supabase });
  if (estimateVersionId !== null) await assertEstimateVersionAccessibleAsDraft({
    supabase, tenantId, userId, tenantRole, estimateVersionId,
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

  const sourceFile = await resolvePlanSetSourceFile({
    supabase,
    tenantId,
    planSetId: input.planSetId,
    jobId,
    maxPages: planSetPageConfig.maxPdfPages,
    selectedFileIds: preparationSnapshot.preparation.sources.filter((source) => source.active && source.kind === "plan").map((source) => source.document_id),
  });
  const { data: insertedJob, error: insertError } = await admitPreparedTakeoffJob({
    supabase,
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
