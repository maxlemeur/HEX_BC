import "server-only";

import { getTakeoffExecutionOwner, parseTakeoffProvider } from "@/lib/ai/chatgpt-takeoff";
import { randomUUID } from "node:crypto";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { mapSupabaseError } from "@/lib/estimates/errors";
import { inspectSourceReferencePdf, SourceReferencePdfError } from "@/lib/estimates/source-reference-pdf";
import {
  TakeoffError,
  TakeoffErrorCode,
  toTakeoffError,
} from "@/lib/takeoff/errors";
import { logTakeoffAuditEvent, takeoffAuditMetadataBuilders } from "@/lib/takeoff/audit";
import { classifyTakeoffPlanSetSource, classifyTakeoffUploadSource } from "@/lib/takeoff/document-classifier";
import {
  assertTakeoffEnabled,
  getTakeoffChunkingConfigForTenant,
  getTakeoffGeminiDeliveryConfigForTenant,
  getTakeoffLevelCProcessingConfigForTenant,
} from "@/lib/takeoff/feature-flags";
import { resolveTakeoffProcessingStrategy } from "@/lib/takeoff/provider-batch";
import { getTakeoffPromptVersion } from "@/lib/takeoff/prompts";
import { type TakeoffLevel } from "@/lib/takeoff/types";
import {
  TAKEOFF_PLAN_SET_LEVEL,
  type TakeoffJobRow,
  type TakeoffJobCreateResponse,
  buildTakeoffUploadPath,
  prepareTakeoffUploadSource,
  normalizeIdempotencyKey,
  deriveDeterministicJobId,
  extractPayloadFingerprint,
  normalizeTakeoffJobRow,
  assertTakeoffFileIsValid,
  parseEstimateVersionId,
  parseTakeoffLevel,
} from "@/lib/takeoff/job-creation-input";
import {
  assertPlanSetAccessibleForCreation,
  insertTakeoffJob,
  uploadTakeoffSourceFile,
  resolvePlanSetSourceFile,
  getTakeoffJobById,
  assertEstimateVersionAccessibleAsDraft,
  assertEstimateVersionAccessibleForTakeoff,
  removeUploadedFileIfPresent,
  removeCreatedJobIfPresent,
} from "@/lib/takeoff/job-creation-repository";

export async function hasAccessibleTakeoffJobForIdempotencyKey(input: {
  context: Awaited<ReturnType<typeof getAuthenticatedContext>>;
  idempotencyKey: string | null;
}) {
  const key = normalizeIdempotencyKey(input.idempotencyKey);
  if (!key) return false;
  const { supabase, tenantId, userId, tenantRole } = input.context;
  const job = await getTakeoffJobById({
    supabase,
    tenantId,
    jobId: deriveDeterministicJobId(tenantId, key),
  });
  if (!job) return false;
  await assertEstimateVersionAccessibleForTakeoff({
    supabase,
    tenantId,
    userId,
    tenantRole,
    estimateVersionId: job.estimate_version_id,
  });
  return true;
}

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

function takeoffPdfInspectionError(error: unknown, level: TakeoffLevel): TakeoffError {
  if (error instanceof SourceReferencePdfError) {
    if (error.code === "PDF_ENCRYPTED") {
      return new TakeoffError({
        status: 422,
        code: TakeoffErrorCode.TAKEOFF_PDF_CORRUPTED,
        message: "Le PDF est protege et ne peut pas être analyse. Exportez une version non protegee puis relancez.",
        details: { reason: "encrypted_pdf" },
        retryable: false,
        level,
      });
    }
    if (error.code === "PDF_INVALID" || error.code === "PDF_EMPTY" || error.code === "PDF_PAGE_LIMIT") {
      return new TakeoffError({
        status: 422,
        code: TakeoffErrorCode.TAKEOFF_PDF_CORRUPTED,
        message: "Le PDF est invalide ou corrompu. Reexportez-le depuis la source puis relancez l'analyse.",
        details: { reason: "corrupted_pdf" },
        retryable: false,
        level,
      });
    }
    if (error.code === "PDF_TIMEOUT") {
      return new TakeoffError({
        status: 503,
        code: TakeoffErrorCode.TAKEOFF_PDF_INSPECTION_TIMEOUT,
        message: "La vérification du PDF a dépassé le délai autorisé. Réessayez avec un PDF plus simple.",
        retryable: true,
        level,
      });
    }
  }

  console.error("Takeoff PDF inspection worker failed", {
    code: error instanceof SourceReferencePdfError ? error.code : "unknown",
  });
  return new TakeoffError({
    status: 503,
    code: TakeoffErrorCode.INTERNAL_ERROR,
    message: "La vérification du PDF est temporairement indisponible.",
    retryable: true,
    level,
  });
}

export async function createTakeoffJobFromFormData(
  formData: FormData,
  input?: { idempotencyKey?: string | null }
): Promise<TakeoffJobCreateResponse> {
  let level: TakeoffLevel | undefined;
  let jobId: string | undefined;

  try {
    const { supabase, tenantId, userId, tenantRole } =
      await getAuthenticatedContext();
    const idempotencyKey = normalizeIdempotencyKey(input?.idempotencyKey);
    const fileEntry = formData.get("file");

    if (!(fileEntry instanceof File)) {
      throw new TakeoffError({
        status: 400,
        code: TakeoffErrorCode.TAKEOFF_FILE_REQUIRED,
        message: "Le champ file est requis.",
        retryable: false,
      });
    }

    const file = fileEntry;
    const estimateVersionId = parseEstimateVersionId(formData);
    level = parseTakeoffLevel(formData);
    const provider = parseTakeoffProvider(formData.get("provider"));

    assertTakeoffFileIsValid(file, level);
    const fileBytes = await file.arrayBuffer();

    const { sourceFileType: normalizedSourceFileType, payloadFingerprint } =
      prepareTakeoffUploadSource({
        file,
        content: Buffer.from(fileBytes),
        estimateVersionId,
        level,
        provider,
      });

    jobId = idempotencyKey
      ? deriveDeterministicJobId(tenantId, idempotencyKey)
      : randomUUID();

    if (idempotencyKey) {
      const existingJob = await getTakeoffJobById({
        supabase,
        tenantId,
        jobId,
      });

      if (existingJob) {
        const existingFingerprint = extractPayloadFingerprint(
          existingJob.source_file_path
        );

        if (existingFingerprint === payloadFingerprint) {
          return normalizeTakeoffJobRow(existingJob);
        }

        throw new TakeoffError({
          status: 409,
          code: TakeoffErrorCode.IDEMPOTENCY_KEY_REUSED,
          message:
            "La clé d'idempotence est déjà utilisee avec un payload différent.",
          details: {
            job_id: existingJob.id,
          },
          retryable: false,
          jobId: existingJob.id,
          level,
        });
      }
    }

    await assertTakeoffEnabled(tenantId, { supabase });
    await assertEstimateVersionAccessibleAsDraft({
      supabase,
      tenantId,
      userId,
      tenantRole,
      estimateVersionId,
    });
    if (level !== "A") {
      try {
        // The worker owns the buffer after transfer; Storage receives the File.
        await inspectSourceReferencePdf(fileBytes, {
          maxPages: Number.MAX_SAFE_INTEGER,
          strictObjectValidation: false,
        });
      } catch (error) {
        throw takeoffPdfInspectionError(error, level);
      }
    }
    const geminiDeliveryConfig = await getTakeoffGeminiDeliveryConfigForTenant(
      tenantId,
      level,
      { supabase }
    );
    const processingStrategy = resolveTakeoffProcessingStrategy(
      geminiDeliveryConfig.useBatchApi
    );

    const sourceFileName = file.name.trim().length > 0 ? file.name : "upload";
    const uploadClassification = classifyTakeoffUploadSource({
      fileName: sourceFileName,
      mimeType: normalizedSourceFileType,
      sizeBytes: file.size,
    });
    // Each contender owns its upload; the job primary key arbitrates idempotency.
    // A replacement cannot pass Storage RLS before the job references its file.
    const sourceFilePath = buildTakeoffUploadPath({
      tenantId,
      jobId,
      payloadFingerprint,
      attemptId: randomUUID(),
      sourceFileName,
    });

    const executionOwner = await getTakeoffExecutionOwner(supabase, { userId, tenantId }, provider);
    const { error: uploadError } = await uploadTakeoffSourceFile({
      supabase,
      storagePath: sourceFilePath,
      file,
      contentType: normalizedSourceFileType,
    });

    if (uploadError) {
      throw new TakeoffError({
        status: 400,
        code: TakeoffErrorCode.BAD_REQUEST,
        message: "Impossible de téléverser le fichier takeoff.",
        details: uploadError,
        retryable: false,
        jobId,
        level,
      });
    }

    const { data: insertedJob, error: insertError } = await insertTakeoffJob({
      supabase,
      row: {
        id: jobId,
        tenant_id: tenantId,
        estimate_version_id: estimateVersionId,
        level,
        status: "pending",
        processing_strategy: processingStrategy,
        source_file_name: sourceFileName,
        source_file_path: sourceFilePath,
        source_file_type: normalizedSourceFileType,
        source_file_size_bytes: file.size,
        prompt_version: getTakeoffPromptVersion(level),
        created_by: userId,
        ...executionOwner,
        ...(executionOwner.execution_provider ? { processing_strategy: "sync" } : {}),
      },
    });

    if (insertError || !insertedJob) {
      if (idempotencyKey && insertError?.code === "23505") {
        const existingJob = await getTakeoffJobById({
          supabase,
          tenantId,
          jobId,
        });

        if (existingJob) {
          const existingFingerprint = extractPayloadFingerprint(
            existingJob.source_file_path
          );

          if (existingFingerprint === payloadFingerprint) {
            await removeUploadedFileIfPresent({
              storagePath: sourceFilePath,
            });
            return normalizeTakeoffJobRow(existingJob);
          }

          await removeUploadedFileIfPresent({
            storagePath: sourceFilePath,
          });

          throw new TakeoffError({
            status: 409,
            code: TakeoffErrorCode.IDEMPOTENCY_KEY_REUSED,
            message:
              "La clé d'idempotence est déjà utilisee avec un payload différent.",
            details: {
              job_id: existingJob.id,
            },
            retryable: false,
            jobId: existingJob.id,
            level,
          });
        }

        await removeUploadedFileIfPresent({
          storagePath: sourceFilePath,
        });

        throw new TakeoffError({
          status: 404,
          code: TakeoffErrorCode.TAKEOFF_JOB_NOT_FOUND,
          message:
            "L'analyse associée à la clé d'idempotence est introuvable.",
          details: {
            reason: "IDEMPOTENCY_KEY_CONFLICT_WITHOUT_JOB",
          },
          retryable: false,
          jobId,
          level,
        });
      }

      await removeUploadedFileIfPresent({
        storagePath: sourceFilePath,
      });

      if (insertError) {
        throw takeoffJobInsertError(insertError, jobId, level);
      }

      throw new TakeoffError({
        status: 400,
        code: TakeoffErrorCode.BAD_REQUEST,
        message: "Impossible de créer le job takeoff.",
        retryable: false,
        jobId,
        level,
      });
    }

    const createdJob = insertedJob as TakeoffJobRow;

    try {
      const createdAuditMetadata =
        takeoffAuditMetadataBuilders["takeoff.job.created"]({
          level,
          estimate_version_id: createdJob.estimate_version_id,
          source_file_name: createdJob.source_file_name,
          idempotency_key: idempotencyKey,
          classification: uploadClassification,
          selection: {
            selected_level: level,
            override_applied:
              uploadClassification.recommendedLevel === null ||
              uploadClassification.recommendedLevel !== level,
            source_kind: "upload",
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
      await removeUploadedFileIfPresent({
        storagePath: sourceFilePath,
      });
      await removeCreatedJobIfPresent({
        supabase,
        tenantId,
        jobId: createdJob.id,
      });
      throw error;
    }

    return normalizeTakeoffJobRow(createdJob);
  } catch (error) {
    throw toTakeoffError(error, {
      fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
      fallbackMessage: "Impossible de créer le job takeoff.",
      retryable: error instanceof TakeoffError ? error.retryable : false,
      jobId,
      level,
    });
  }
}

export async function createTakeoffJobFromPlanSet(input: {
  projectId: string;
  planSetId: string;
  estimateVersionId: string;
  level?: TakeoffLevel;
  provider?: import("@/lib/takeoff/types").TakeoffProvider;
}): Promise<TakeoffJobCreateResponse> {
  const { supabase, tenantId, userId, tenantRole } =
    await getAuthenticatedContext();
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

  await assertTakeoffEnabled(tenantId, { supabase });
  await assertEstimateVersionAccessibleAsDraft({
    supabase,
    tenantId,
    userId,
    tenantRole,
    estimateVersionId: input.estimateVersionId,
  });
  const executionOwner = await getTakeoffExecutionOwner(supabase, { userId, tenantId }, input.provider);
  const [geminiDeliveryConfig, planSetPageConfig] = await Promise.all([
    getTakeoffGeminiDeliveryConfigForTenant(tenantId, level, { supabase }),
    level === "C"
      ? getTakeoffLevelCProcessingConfigForTenant(tenantId, { supabase })
      : getTakeoffChunkingConfigForTenant(tenantId, { supabase }),
  ]);
  const processingStrategy = resolveTakeoffProcessingStrategy(
    geminiDeliveryConfig.useBatchApi
  );

  await assertPlanSetAccessibleForCreation({
    supabase,
    tenantId,
    projectId: input.projectId,
    planSetId: input.planSetId,
  });

  const jobId = randomUUID();
  const sourceFile = await resolvePlanSetSourceFile({
    supabase,
    tenantId,
    planSetId: input.planSetId,
    jobId,
    maxPages: planSetPageConfig.maxPdfPages,
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
      processing_strategy: processingStrategy,
      source_file_name: sourceFile.sourceFileName,
      source_file_path: sourceFile.sourceFilePath,
      source_file_type: sourceFile.sourceFileType,
      source_file_size_bytes: sourceFile.sourceFileSizeBytes,
      prompt_version: getTakeoffPromptVersion(level),
      created_by: userId,
      ...executionOwner,
      ...(executionOwner.execution_provider ? { processing_strategy: "sync" } : {}),
    },
  });

  if (insertError || !insertedJob) {
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
