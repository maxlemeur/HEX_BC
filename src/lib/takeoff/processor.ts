import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { assertLocalTakeoffExecutionHost, resolveLocalTakeoffProvider, type LocalTakeoffProvider } from "@/lib/ai/chatgpt-takeoff";
import type { StructuredCall, StructuredCallOptions } from "@/lib/ai/structured-call";
import {
  TakeoffError,
  TakeoffErrorCode,
  toTakeoffError,
} from "@/lib/takeoff/errors";
import {
  runWithTakeoffLeaseRenewal,
  type TakeoffJobProcessingRow,
  type TakeoffLeaseRenewal,
} from "@/lib/takeoff/job-lifecycle";
import { readTakeoffLaunchUnit } from "@/lib/takeoff/launch-request";
import { executeStructuredTakeoffRun, type StructuredTakeoffRunResult } from "@/lib/takeoff/level-a-reading";
import { processLevelBChunks } from "@/lib/takeoff/level-b-reading";
import {
  buildLevelCRunMetricRows,
  cloneLevelCChunkMetrics,
  extractLevelCChunkMetricsFromError,
  type LevelCChunkMetric,
} from "@/lib/takeoff/level-c-chunk-metrics";
import { processLevelCChunks, type ProcessLevelCMetricsSummary } from "@/lib/takeoff/level-c-reading";
import { POSTE_EXCHANGE_PROMPT_VERSION } from "@/lib/takeoff/poste-exchange";
import { processItemListLevelC, readTakeoffItemListOrder, type TakeoffItemListOrder } from "@/lib/takeoff/poste-reading-job-server";
import { assertPdfResultIsInterpretable } from "@/lib/takeoff/pdf-reading-guards";
import { logCompletedAuditEvent, logFailedAuditEvent, logProcessingAuditEvent } from "@/lib/takeoff/processing-audit";
import {
  TAKEOFF_LEVEL_A,
  TAKEOFF_LEVEL_B,
  TAKEOFF_LEVEL_C,
  type ProcessableTakeoffLevel,
  type Supabase,
} from "@/lib/takeoff/processing-context";
import {
  buildFailureDiagnostic,
  getTakeoffJobForProcessing,
  hasAtomicPersistenceRollbackError,
  isCanceledDuringProcessingConflict,
  markJobAsProcessing,
  recordLocalTakeoffFailure,
  releaseTakeoffHostSlot,
  type TakeoffClaimObservation,
} from "@/lib/takeoff/processing-job-state";
import { getTakeoffPromptVersion } from "@/lib/takeoff/prompts";
import { finalizeTakeoffResult } from "@/lib/takeoff/result-finalization";
import { loadTakeoffSource } from "@/lib/takeoff/source-loader";
import { resolveTakeoffExecutionProvider } from "@/lib/takeoff/execution-scope-server";
import {
  isTakeoffVectorReadingEnabled, readTakeoffVectorPages, takeoffVectorLocalGroupsHook,
} from "@/lib/takeoff/vectors/worker-server";
import { toNonEmptyString } from "@/lib/value-guards";

// The claim needs a model; when the creator's plan cannot be read, only the provider is known.
const UNRESOLVED_LOCAL_MODEL = "chatgpt";

type ProcessLevelContext = {
  supabase: Supabase;
  tenantId: string | null;
  userId: string | null;
};

export type ProcessLevelAOptions = {
  supabase?: Supabase;
  tenantId?: string;
  userId?: string;
  now?: () => Date;
  /** Resolves the job's local provider; the owned-worker journeys pass a controlled one. */
  resolveProvider?: typeof resolveLocalTakeoffProvider;
  assertTenantActive?: (tenantId: string) => Promise<void>;
  renewLease?: TakeoffLeaseRenewal;
  /** The status and attempt the caller decided on; the claim refuses any other (defaults to the processor's read). */
  claimObservation?: TakeoffClaimObservation;
};

type ProcessLevelCompletedResult = {
  jobId: string;
  resultId: string;
  status: "completed";
  itemsCount: number;
  warningsCount: number;
  tokenCount: number;
  costCents: number;
  durationMs: number;
};

export type ProcessLevelAResult = ProcessLevelCompletedResult;

export type ProcessLevelBOptions = ProcessLevelAOptions;
export type ProcessLevelCOptions = ProcessLevelAOptions;

export type ProcessLevelBResult = ProcessLevelCompletedResult & {
  tablesCount: number;
};

export type ProcessLevelCResult = ProcessLevelBResult & {
  chunksCount: number;
  pageCount: number;
  metricsSummary?: ProcessLevelCMetricsSummary;
};

type ProcessLevelInternalCompletedResult = ProcessLevelCompletedResult & {
  tablesCount?: number;
  chunksCount?: number;
  pageCount?: number;
  metricsSummary?: ProcessLevelCMetricsSummary;
};

async function resolveContext(
  options: ProcessLevelAOptions
): Promise<ProcessLevelContext> {
  if (options.supabase) {
    return {
      supabase: options.supabase,
      tenantId: options.tenantId ?? null,
      userId: options.userId ?? null,
    };
  }

  const authenticatedContext = await getAuthenticatedContext();
  return {
    supabase: authenticatedContext.supabase,
    tenantId: options.tenantId ?? authenticatedContext.tenantId,
    userId: options.userId ?? authenticatedContext.userId,
  };
}

function getProcessorLevelLabel(level: ProcessableTakeoffLevel) {
  return `Level ${level}`;
}

async function finalizeCompletedLevelAJob(input: {
  supabase: Supabase;
  userId: string | null;
  job: TakeoffJobProcessingRow;
  processingStartedAt: Date;
  now: () => Date;
  levelAResult: StructuredTakeoffRunResult;
}): Promise<ProcessLevelCompletedResult> {
  const completedAt = input.now();
  const totalDurationMs = Math.max(
    input.levelAResult.durationMs,
    completedAt.getTime() - input.processingStartedAt.getTime()
  );

  const persisted = await finalizeTakeoffResult({
    supabase: input.supabase,
    job: input.job,
    exchange: input.levelAResult.normalizedExchange,
    itemsForInsert: input.levelAResult.itemsForInsert,
    tokenCount: input.levelAResult.tokenCount,
    costCents: input.levelAResult.costCents,
    durationMs: input.levelAResult.durationMs,
    completedAt,
    totalDurationMs,
    model: input.levelAResult.model,
    promptVersion: input.levelAResult.promptVersion,
    providerMeta: {
      ...input.levelAResult.providerMeta,
      model: input.levelAResult.model,
      prompt_version: input.levelAResult.promptVersion,
      tables_count: input.levelAResult.tablesCount,
    },
    level: TAKEOFF_LEVEL_A,
  });

  await logCompletedAuditEvent({
    supabase: input.supabase,
    userId: input.userId,
    job: input.job,
    resultId: persisted.resultId,
    itemsCount: persisted.itemsCount,
    warningsCount: persisted.warningsCount,
    durationMs: totalDurationMs,
  });

  return {
    jobId: input.job.id,
    resultId: persisted.resultId,
    status: "completed",
    itemsCount: persisted.itemsCount,
    warningsCount: persisted.warningsCount,
    tokenCount: input.levelAResult.tokenCount,
    costCents: input.levelAResult.costCents,
    durationMs: totalDurationMs,
  };
}

async function processTakeoffLevel(
  level: ProcessableTakeoffLevel,
  jobId: string,
  options: ProcessLevelAOptions = {}
): Promise<ProcessLevelInternalCompletedResult> {
  const normalizedJobId = jobId.trim();
  if (normalizedJobId.length === 0) {
    throw new TakeoffError({
      code: TakeoffErrorCode.BAD_REQUEST,
      message: "jobId est requis.",
      retryable: false,
      level,
    });
  }

  const context = await resolveContext(options);
  const resolveProvider = options.resolveProvider ?? resolveLocalTakeoffProvider;
  const now = options.now ?? (() => new Date());
  let promptVersion: string = getTakeoffPromptVersion(level);
  const processingStartedAt = now();
  let model = UNRESOLVED_LOCAL_MODEL;

  let job: TakeoffJobProcessingRow | null = null;
  let enteredProcessing = false;
  // The Mac's slot this attempt may hold (its claim's lease), given back however the attempt ends.
  let heldSlot: { hostId: string; leaseToken: string } | null = null;
  let levelCChunkMetrics: LevelCChunkMetric[] = [];
  let levelCSourceFileName: string | null = null;

  const assertProviderTenantActive = async () => {
    if (!job) {
      throw new TakeoffError({
        code: TakeoffErrorCode.INTERNAL_ERROR,
        message: "Le job takeoff n'est pas chargé avant l'appel fournisseur.",
        retryable: true,
        jobId: normalizedJobId,
        level,
      });
    }

    await options.assertTenantActive?.(job.tenant_id);
  };

  const renewProcessingLease = async () => {
    if (!options.renewLease) return;
    if (!job?.processing_lease_token) throw new TakeoffError({ code: TakeoffErrorCode.CONFLICT, message: "Le lease takeoff n'est plus disponible.", retryable: false, jobId: normalizedJobId, level });
    await options.renewLease({ jobId: job.id, tenantId: job.tenant_id, leaseToken: job.processing_lease_token });
  };

  try {
    job = await getTakeoffJobForProcessing({
      supabase: context.supabase,
      jobId: normalizedJobId,
      tenantId: context.tenantId,
      level,
    });

    if (job.level !== level) {
      throw new TakeoffError({
        code: TakeoffErrorCode.TAKEOFF_LEVEL_UNSUPPORTED,
        message: `Le processor ${getProcessorLevelLabel(
          level
        )} ne peut traiter que les jobs de niveau ${level}.`,
        retryable: false,
        jobId: normalizedJobId,
        level,
      });
    }

    const hostId = await assertLocalTakeoffExecutionHost(job);
    let resolved: { provider: LocalTakeoffProvider } | { error: unknown };
    // Resolved before the claim (its model is recorded by it); each paid call reads the lease the claim then took.
    try { resolved = { provider: await resolveTakeoffExecutionProvider(context.supabase, job, resolveProvider,
      () => job?.processing_lease_token ?? null) }; }
    catch (error) { resolved = { error }; }
    if ("provider" in resolved) model = resolved.provider.model;
    // Lot 4: the measuring order before the claim (no read for a job without a request), so that the claim records the
    // prompt the job reads with; a failed read ends the job once claimed, as a provider that cannot be resolved does.
    let itemList: { order: TakeoffItemListOrder | null } | { error: unknown } = { order: null };
    if (level === TAKEOFF_LEVEL_C) {
      try { itemList = { order: await readTakeoffItemListOrder(context.supabase, job) }; } catch (error) { itemList = { error }; }
    }
    if ("order" in itemList && itemList.order) promptVersion = POSTE_EXCHANGE_PROMPT_VERSION;

    job = await markJobAsProcessing({
      supabase: context.supabase,
      job,
      hostId,
      startedAtIso: processingStartedAt.toISOString(),
      model,
      promptVersion,
      level,
      observed: options.claimObservation ?? { status: job.status, retryCount: job.retry_count },
    });
    enteredProcessing = true;
    if (job.processing_lease_token) heldSlot = { hostId, leaseToken: job.processing_lease_token };
    // Even preflight failures must become visible, terminal job failures.
    if ("error" in resolved) throw resolved.error;
    if ("error" in itemList) throw itemList.error;
    const localProvider = resolved.provider;
    const call: StructuredCall = async <T>(providerOptions: StructuredCallOptions<T>) => {
      await assertProviderTenantActive();
      return runWithTakeoffLeaseRenewal(renewProcessingLease, () => localProvider.call<T>(providerOptions));
    };

    const actorUserId = context.userId ?? job.created_by;
    await logProcessingAuditEvent({
      supabase: context.supabase,
      userId: actorUserId,
      job,
    });

    const sourceFile = await loadTakeoffSource({
      supabase: context.supabase,
      job,
      level,
    });
    if (level === TAKEOFF_LEVEL_C) {
      levelCSourceFileName = sourceFile.fileName;
    }
    const schemaVersion = toNonEmptyString(job.schema_version) ?? "v1";

    if (level === TAKEOFF_LEVEL_C) {
      // TI-662: vector reading of the original pages accompanies level C by default. Groups are classified
      // with MERGEONE_TAKEOFF_DECISIONS=1 by the creator's plan (TI-704 option B); each call checked like a provider
      // call (active tenant, lease).
      // A plan's unit reads its share of the dossier's vector pages; any other job, the pages of a grouped analysis.
      const claimed = job;
      const unit = readTakeoffLaunchUnit(claimed.preparation_snapshot);
      const readVectors = async () => isTakeoffVectorReadingEnabled()
        ? await readTakeoffVectorPages(sourceFile, {
          onPage: renewProcessingLease, context: { jobId: claimed.id, tenantId: claimed.tenant_id },
          ...(unit ? { maxPages: unit.vectorPages } : {}),
          decisions: takeoffVectorLocalGroupsHook({ jobId: claimed.id, tenantId: claimed.tenant_id, userId: claimed.created_by ?? null,
            provider: localProvider, beforeCall: async () => {
              await assertProviderTenantActive();
              await renewProcessingLease();
            } }),
        })
        : [];
      // Lot 4: a plan read against the list of items its request sealed (poste-reading-job-server.ts); the free extraction as before.
      if (itemList.order) {
        return await processItemListLevelC({ supabase: context.supabase, job: claimed, sourceFile, call, model, order: itemList.order,
          userId: actorUserId, processingStartedAt, now, renewLease: renewProcessingLease, readVectors });
      }
      const levelCResult = await processLevelCChunks({
        supabase: context.supabase,
        job,
        sourceFile,
        call,
        schemaVersion,
        model,
        promptVersion,
      });
      levelCChunkMetrics = cloneLevelCChunkMetrics(levelCResult.chunkMetrics);

      assertPdfResultIsInterpretable({
        job,
        level: TAKEOFF_LEVEL_C,
        sourceFile,
        tablesCount: levelCResult.tablesCount,
        itemsCount: levelCResult.itemsForInsert.length,
        hasUnmeasuredQuantities: levelCResult.locatedUnmeasuredQuantities > 0,
        providerMeta: levelCResult.providerMeta,
      });

      const vectorOutcomes = await readVectors();
      await renewProcessingLease();
      const completedAt = now();
      const totalDurationMs = Math.max(
        levelCResult.durationMs,
        completedAt.getTime() - processingStartedAt.getTime()
      );

      const persisted = await finalizeTakeoffResult({
        supabase: context.supabase,
        job,
        exchange: levelCResult.normalizedExchange,
        itemsForInsert: levelCResult.itemsForInsert,
        vector: vectorOutcomes,
        tokenCount: levelCResult.tokenCount,
        costCents: levelCResult.costCents,
        durationMs: levelCResult.durationMs,
        completedAt,
        totalDurationMs,
        model,
        promptVersion,
        runMetrics: buildLevelCRunMetricRows({
          job, metrics: levelCResult.chunkMetrics, hint: { sourceFileName: sourceFile.fileName },
          supabase: context.supabase,
        }),
        providerMeta: {
          ...levelCResult.providerMeta,
          provider: "chatgpt",
          model,
          prompt_version: promptVersion,
          tables_count: levelCResult.tablesCount,
        },
        level,
      });

      await logCompletedAuditEvent({
        supabase: context.supabase,
        userId: actorUserId,
        job,
        resultId: persisted.resultId,
        itemsCount: persisted.itemsCount,
        warningsCount: persisted.warningsCount,
        durationMs: totalDurationMs,
      });

      return {
        jobId: job.id,
        resultId: persisted.resultId,
        status: "completed",
        itemsCount: persisted.itemsCount,
        warningsCount: persisted.warningsCount,
        tokenCount: levelCResult.tokenCount,
        costCents: levelCResult.costCents,
        durationMs: totalDurationMs,
        tablesCount: levelCResult.tablesCount,
        chunksCount: levelCResult.chunksCount,
        pageCount: levelCResult.pageCount,
        metricsSummary: levelCResult.tokenUsage,
      };
    }

    if (level === TAKEOFF_LEVEL_B) {
      const levelBResult = await processLevelBChunks({
        supabase: context.supabase,
        job,
        sourceFile,
        call,
        schemaVersion,
        model,
        promptVersion,
      });

      assertPdfResultIsInterpretable({
        job,
        level: TAKEOFF_LEVEL_B,
        sourceFile,
        tablesCount: levelBResult.tablesCount,
        itemsCount: levelBResult.itemsForInsert.length,
        providerMeta: levelBResult.providerMeta,
      });

      await renewProcessingLease();
      const completedAt = now();
      const totalDurationMs = Math.max(
        levelBResult.durationMs,
        completedAt.getTime() - processingStartedAt.getTime()
      );

      const persisted = await finalizeTakeoffResult({
        supabase: context.supabase,
        job,
        exchange: levelBResult.normalizedExchange,
        itemsForInsert: levelBResult.itemsForInsert,
        tokenCount: levelBResult.tokenCount,
        costCents: levelBResult.costCents,
        durationMs: levelBResult.durationMs,
        completedAt,
        totalDurationMs,
        model: levelBResult.model,
        promptVersion: levelBResult.promptVersion,
        providerMeta: {
          ...levelBResult.providerMeta,
          provider: "chatgpt",
          model: levelBResult.model,
          prompt_version: levelBResult.promptVersion,
          tables_count: levelBResult.tablesCount,
        },
        level,
      });

      await logCompletedAuditEvent({
        supabase: context.supabase,
        userId: actorUserId,
        job,
        resultId: persisted.resultId,
        itemsCount: persisted.itemsCount,
        warningsCount: persisted.warningsCount,
        durationMs: totalDurationMs,
      });

      return {
        jobId: job.id,
        resultId: persisted.resultId,
        status: "completed",
        itemsCount: persisted.itemsCount,
        warningsCount: persisted.warningsCount,
        tokenCount: levelBResult.tokenCount,
        costCents: levelBResult.costCents,
        durationMs: totalDurationMs,
        tablesCount: levelBResult.tablesCount,
      };
    }

    const levelAResult = await executeStructuredTakeoffRun({
      level: TAKEOFF_LEVEL_A,
      job,
      sourceFile,
      call,
      schemaVersion,
      model,
      promptVersion,
    });

    await renewProcessingLease();
    return await finalizeCompletedLevelAJob({
      supabase: context.supabase,
      userId: actorUserId,
      job,
      processingStartedAt,
      now,
      levelAResult,
    });
  } catch (error) {
    const levelCChunkMetricsFromError =
      level === TAKEOFF_LEVEL_C ? extractLevelCChunkMetricsFromError(error) : [];
    const chunkMetricsToPersist =
      levelCChunkMetricsFromError.length > 0
        ? levelCChunkMetricsFromError
        : cloneLevelCChunkMetrics(levelCChunkMetrics);

    const raised = toTakeoffError(error, {
      fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
      jobId: normalizedJobId,
      level,
    });
    // A plan of one analysis per plan whose source changed after its admission fails alone and definitively, recorded while
    // its worker still holds the lease: the Mac is free at once for the next plan. A grouped analysis keeps lot 2's way.
    const mappedError = enteredProcessing && job && isPlanUnitSourceChange(job, raised)
      ? new TakeoffError({ status: 409, code: TakeoffErrorCode.TAKEOFF_PREPARATION_SOURCE_CHANGED, message: raised.message,
        details: raised.details, retryable: false, jobId: normalizedJobId, level })
      : raised;

    if (enteredProcessing && job && !isCanceledDuringProcessingConflict(mappedError) && mappedError.code !== TakeoffErrorCode.CONFLICT) {
      const completedAt = now();
      const durationMs = Math.max(0, completedAt.getTime() - processingStartedAt.getTime());

      const skipFailureSnapshotPersist =
        level === TAKEOFF_LEVEL_A && hasAtomicPersistenceRollbackError(mappedError);

      await renewProcessingLease();
      const retainMetrics = level === TAKEOFF_LEVEL_C && chunkMetricsToPersist.length > 0;
      const recorded = await recordLocalTakeoffFailure({
        supabase: context.supabase,
        job,
        completedAtIso: completedAt.toISOString(),
        durationMs,
        error: mappedError,
        diagnostic: skipFailureSnapshotPersist
          ? null
          : buildFailureDiagnostic({ error: mappedError, durationMs, model, promptVersion, retainMetrics }),
        runMetrics: retainMetrics
          ? buildLevelCRunMetricRows({
              supabase: context.supabase,
              job,
              metrics: chunkMetricsToPersist,
              hint: {
                sourceFileName:
                  levelCSourceFileName ??
                  toNonEmptyString(job.source_file_name) ??
                  "unknown",
                errorDetails: mappedError.details,
              },
            })
          : [],
      });

      await logFailedAuditEvent({
        supabase: context.supabase,
        userId: context.userId ?? job.created_by,
        job,
        error: recorded,
      });
    }

    throw mappedError;
  } finally {
    if (heldSlot) await releaseTakeoffHostSlot(context.supabase, heldSlot);
  }
}

/** The preparation's source refusal (PREPARATION_SOURCE_CHANGED, preparation-source-loader.ts) of a plan of a request of plans. */
function isPlanUnitSourceChange(job: TakeoffJobProcessingRow, error: TakeoffError) {
  return error.code === TakeoffErrorCode.CONFLICT && Boolean(readTakeoffLaunchUnit(job.preparation_snapshot)?.key.startsWith("plan:"))
    && (error.details as { reason?: unknown } | undefined)?.reason === "PREPARATION_SOURCE_CHANGED";
}

export async function processLevelA(
  jobId: string,
  options: ProcessLevelAOptions = {}
): Promise<ProcessLevelAResult> {
  const result = await processTakeoffLevel(TAKEOFF_LEVEL_A, jobId, options);

  return {
    jobId: result.jobId,
    resultId: result.resultId,
    status: result.status,
    itemsCount: result.itemsCount,
    warningsCount: result.warningsCount,
    tokenCount: result.tokenCount,
    costCents: result.costCents,
    durationMs: result.durationMs,
  };
}

export async function processLevelB(
  jobId: string,
  options: ProcessLevelBOptions = {}
): Promise<ProcessLevelBResult> {
  const result = await processTakeoffLevel(TAKEOFF_LEVEL_B, jobId, options);

  return {
    ...result,
    tablesCount: result.tablesCount ?? 0,
  };
}

export async function processLevelC(
  jobId: string,
  options: ProcessLevelCOptions = {}
): Promise<ProcessLevelCResult> {
  const result = await processTakeoffLevel(TAKEOFF_LEVEL_C, jobId, options);

  return {
    jobId: result.jobId,
    resultId: result.resultId,
    status: result.status,
    itemsCount: result.itemsCount,
    warningsCount: result.warningsCount,
    tokenCount: result.tokenCount,
    costCents: result.costCents,
    durationMs: result.durationMs,
    tablesCount: result.tablesCount ?? 0,
    chunksCount: result.chunksCount ?? 1,
    pageCount: result.pageCount ?? 0,
    metricsSummary: result.metricsSummary,
  };
}
