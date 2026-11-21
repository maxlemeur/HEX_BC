import { boundTakeoffAttemptByRequest, readTakeoffRequestBudget } from "@/lib/takeoff/launch-request-budget";
import type { StructuredCall, TokenUsage } from "@/lib/ai/structured-call";
import {
  buildPdfChunks,
  createChunkPromptSourceHint,
  createPdfChunkBytes,
  countLocatedUnmeasuredQuantities,
  getPdfPageCount,
  mergeTakeoffChunkExchanges,
  remapChunkLocalPagesToAbsolute,
  type TakeoffPdfChunk,
} from "@/lib/takeoff/chunking";
import {
  TakeoffError,
  TakeoffErrorCode,
} from "@/lib/takeoff/errors";
import {
  normalizeTakeoffExchange,
  takeoffSourceProvenance,
  type NormalizedTakeoffItemForInsert,
} from "@/lib/takeoff/exchange-normalization";
import { getTakeoffLevelCProcessingConfigForTenant } from "@/lib/takeoff/feature-flags";
import type { TakeoffJobProcessingRow } from "@/lib/takeoff/job-lifecycle";
import {
  cloneLevelCChunkMetrics,
  logLevelCChunkMetric,
  mapToLevelCNormalizedError,
  type LevelCChunkMetric,
  type LevelCProcessingError,
} from "@/lib/takeoff/level-c-chunk-metrics";
import { isPdfMimeType } from "@/lib/takeoff/pdf-reading-guards";
import { inspectTakeoffPdfBytes } from "@/lib/takeoff/pdf-validation";
import { persistDetectedPlanFilePageCounts } from "@/lib/takeoff/plan-file-page-counts";
import { TAKEOFF_LEVEL_C, type Supabase } from "@/lib/takeoff/processing-context";
import { getTakeoffPrompt } from "@/lib/takeoff/prompts";
import { TakeoffExchangeSchema } from "@/lib/takeoff/schemas";
import type { DownloadedTakeoffFile } from "@/lib/takeoff/source-loader";
import type { TakeoffExchange } from "@/lib/takeoff/types";

export type ProcessLevelCMetricsSummary = {
  inputTokens: number;
  reasoningTokens: number;
  outputTokens: number;
  totalTokens: number;
};

type ProcessLevelCAggregate = {
  normalizedExchange: TakeoffExchange;
  itemsForInsert: NormalizedTakeoffItemForInsert[];
  /** Unmeasured quantities the model located on a page of their fragment, with an observation (chunking.ts). */
  locatedUnmeasuredQuantities: number;
  tokenCount: number;
  tokenUsage: ProcessLevelCMetricsSummary;
  costCents: number;
  durationMs: number;
  tablesCount: number;
  pageCount: number;
  chunksCount: number;
  chunkMetrics: LevelCChunkMetric[];
  providerMeta: Record<string, unknown>;
};

export async function processLevelCChunks(input: {
  supabase: Supabase;
  job: TakeoffJobProcessingRow;
  sourceFile: DownloadedTakeoffFile;
  call: StructuredCall;
  schemaVersion: string;
  model: string;
  promptVersion: string;
}): Promise<ProcessLevelCAggregate> {
  if (!isPdfMimeType(input.sourceFile.mimeType)) {
    throw new TakeoffError({
      code: TakeoffErrorCode.TAKEOFF_FILE_TYPE_INVALID,
      message: "Le processor Level C requiert un fichier PDF source.",
      retryable: false,
      jobId: input.job.id,
      level: TAKEOFF_LEVEL_C,
      details: {
        file_type: input.sourceFile.mimeType,
        source_file_name: input.sourceFile.fileName,
      },
    });
  }

  let pageCount: number;
  try {
    pageCount = await getPdfPageCount(input.sourceFile.bytes);
  } catch {
    const pdfInspection = await inspectTakeoffPdfBytes(input.sourceFile.bytes);
    throw new TakeoffError({
      code: TakeoffErrorCode.TAKEOFF_PDF_CORRUPTED,
      message: pdfInspection.valid
        ? "Le PDF est invalide ou incomplet. Reexportez-le avant de relancer l'analyse."
        : pdfInspection.message,
      retryable: false,
      jobId: input.job.id,
      level: TAKEOFF_LEVEL_C,
      details: pdfInspection.valid
        ? {
            reason: "invalid_pdf_page_count",
            source_file_name: input.sourceFile.fileName,
          }
        : pdfInspection.details,
    });
  }

  // The per-job budget of the detailed reading, within what the job's launch request has left over its attempts.
  const levelCProcessingConfig = boundTakeoffAttemptByRequest(await getTakeoffLevelCProcessingConfigForTenant(
    input.job.tenant_id,
    {
      supabase: input.supabase,
    }
  ), await readTakeoffRequestBudget(input.job), input.job.id);

  if (pageCount > levelCProcessingConfig.maxPdfPages) {
    throw new TakeoffError({
      status: 413,
      code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE,
      message: `Le PDF contient ${pageCount} pages et depasse la limite de ${levelCProcessingConfig.maxPdfPages} pages.`,
      retryable: false,
      jobId: input.job.id,
      level: TAKEOFF_LEVEL_C,
      details: {
        page_count: pageCount,
        max_pdf_pages: levelCProcessingConfig.maxPdfPages,
      },
    });
  }

  await persistDetectedPlanFilePageCounts({
    supabase: input.supabase,
    tenantId: input.job.tenant_id,
    sourceFile: input.sourceFile,
    fallbackSourceFilePath: input.job.source_file_path,
    fallbackPageCount: pageCount,
  });

  const chunks = buildPdfChunks(pageCount, {
    thresholdPages: levelCProcessingConfig.thresholdPages,
    chunkSizePages: levelCProcessingConfig.chunkSizePages,
    overlapPages: levelCProcessingConfig.overlapPages,
  });

  const chunkExchanges: Array<{
    chunk: TakeoffPdfChunk;
    exchange: TakeoffExchange;
  }> = [];
  const chunkMetrics: LevelCChunkMetric[] = [];
  const tokenUsage: ProcessLevelCMetricsSummary = {
    inputTokens: 0,
    reasoningTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
  let costCents = 0;
  let durationMs = 0;
  let locatedUnmeasuredQuantities = 0;

  for (const chunk of chunks) {
    const chunkPrompt = getTakeoffPrompt(TAKEOFF_LEVEL_C, {
      preparation: input.sourceFile.preparationSnapshot,
      contextSourceHints: input.sourceFile.contextSourceHints,
      fileType: input.sourceFile.mimeType,
      schemaVersion: input.schemaVersion,
      sourceHint: createChunkPromptSourceHint({
        fileName: input.sourceFile.fileName,
        chunk,
        totalChunks: chunks.length,
      }),
    });

    try {
      const chunkBytes = await createPdfChunkBytes({
        bytes: input.sourceFile.bytes,
        chunk,
      });

      const result = await input.call<TakeoffExchange>({
        prompt: chunkPrompt,
        schema: TakeoffExchangeSchema,
        files: [...(input.sourceFile.contextFiles ?? []),
          {
            data: Buffer.from(chunkBytes).toString("base64"),
            mimeType: "application/pdf",
          },
        ],
        timeoutMs: levelCProcessingConfig.timeoutMs,
        context: {
          jobId: input.job.id,
          tenantId: input.job.tenant_id,
          level: TAKEOFF_LEVEL_C,
          promptVersion: input.promptVersion,
          model: input.model,
        },
      });

      const parsedExchange = TakeoffExchangeSchema.parse(result.data);
      locatedUnmeasuredQuantities += countLocatedUnmeasuredQuantities({ chunk, exchange: parsedExchange });
      chunkExchanges.push({
        chunk,
        exchange: remapChunkLocalPagesToAbsolute({
          chunk,
          exchange: parsedExchange,
          source: input.sourceFile.preparationSnapshot?.preparation.objective === "measure_all" ? input.sourceFile : undefined,
        }),
      });

      const chunkTokenUsage: TokenUsage = result.tokenUsage;
      tokenUsage.inputTokens += chunkTokenUsage.inputTokens;
      tokenUsage.reasoningTokens += chunkTokenUsage.reasoningTokens;
      tokenUsage.outputTokens += chunkTokenUsage.outputTokens;
      tokenUsage.totalTokens += chunkTokenUsage.totalTokens;

      costCents += result.costCents;
      durationMs += result.durationMs;

      const tokenBudgetExceeded = tokenUsage.totalTokens > levelCProcessingConfig.maxTotalTokens;
      const costBudgetExceeded = costCents > levelCProcessingConfig.maxCostCents;
      const isBudgetExceeded = tokenBudgetExceeded || costBudgetExceeded;

      const metric: LevelCChunkMetric = {
        provider: "chatgpt",
        index: chunk.index,
        start: chunk.startPage,
        end: chunk.endPage,
        input_tokens: chunkTokenUsage.inputTokens,
        reasoning_tokens: chunkTokenUsage.reasoningTokens,
        output_tokens: chunkTokenUsage.outputTokens,
        token_count: chunkTokenUsage.totalTokens,
        cost_cents: result.costCents,
        duration_ms: result.durationMs,
        model: result.model,
        timed_out: false,
        budget_exceeded: isBudgetExceeded,
        status: isBudgetExceeded ? "failed" : "success",
        error_code: isBudgetExceeded
          ? TakeoffErrorCode.TAKEOFF_LEVEL_C_BUDGET_EXCEEDED
          : undefined,
        error_message: isBudgetExceeded
          ? "Le budget Level C configure est depasse."
          : undefined,
      };
      chunkMetrics.push(metric);
      logLevelCChunkMetric({
        job: input.job,
        metric,
      });

      if (isBudgetExceeded) {
        throw new TakeoffError({
          code: TakeoffErrorCode.TAKEOFF_LEVEL_C_BUDGET_EXCEEDED,
          status: 422,
          message: "Le budget Level C configure est depasse.",
          retryable: false,
          jobId: input.job.id,
          level: TAKEOFF_LEVEL_C,
          details: {
            chunk_index: chunk.index,
            chunk_start_page: chunk.startPage,
            chunk_end_page: chunk.endPage,
            consumed: {
              input_tokens: tokenUsage.inputTokens,
              reasoning_tokens: tokenUsage.reasoningTokens,
              output_tokens: tokenUsage.outputTokens,
              total_tokens: tokenUsage.totalTokens,
              cost_cents: costCents,
            },
            budget: {
              max_total_tokens: levelCProcessingConfig.maxTotalTokens,
              max_cost_cents: levelCProcessingConfig.maxCostCents,
            },
            exceeded: {
              total_tokens: tokenBudgetExceeded,
              cost_cents: costBudgetExceeded,
            },
          },
        });
      }
    } catch (error) {
      const normalized = mapToLevelCNormalizedError({
        error,
        jobId: input.job.id,
        chunkMetrics,
      });

      const alreadyTracked = chunkMetrics.some((metric) => metric.index === chunk.index);
      if (!alreadyTracked) {
        const fallbackMetric: LevelCChunkMetric = {
          provider: "chatgpt",
          index: chunk.index,
          start: chunk.startPage,
          end: chunk.endPage,
          input_tokens: 0,
          reasoning_tokens: 0,
          output_tokens: 0,
          token_count: 0,
          cost_cents: 0,
          duration_ms: 0,
          model: input.model,
          timed_out: normalized.code === TakeoffErrorCode.TAKEOFF_LEVEL_C_TIMEOUT,
          budget_exceeded:
            normalized.code === TakeoffErrorCode.TAKEOFF_LEVEL_C_BUDGET_EXCEEDED,
          status: "failed",
          error_code: normalized.code,
          error_message: normalized.message,
        };
        chunkMetrics.push(fallbackMetric);
        logLevelCChunkMetric({
          job: input.job,
          metric: fallbackMetric,
        });
      }

      (normalized as LevelCProcessingError).levelCChunkMetrics = cloneLevelCChunkMetrics(
        chunkMetrics
      );
      throw normalized;
    }
  }

  const merged = mergeTakeoffChunkExchanges(chunkExchanges);
  const normalized = normalizeTakeoffExchange({
    exchange: merged.exchange,
    ...takeoffSourceProvenance(input.job, input.sourceFile),
    parseWarnings: [],
  });
  const tablesCount = normalized.exchange.tables?.length ?? 0;

  return {
    normalizedExchange: normalized.exchange,
    itemsForInsert: normalized.itemsForInsert,
    locatedUnmeasuredQuantities,
    tokenCount: tokenUsage.totalTokens,
    tokenUsage,
    costCents,
    durationMs,
    tablesCount,
    pageCount,
    chunksCount: chunks.length,
    chunkMetrics,
    providerMeta: {
      file_type: input.sourceFile.mimeType,
      source_file_name: input.sourceFile.fileName,
      processing_mode: chunks.length > 1 ? "pdf_vision_chunked" : "pdf_vision",
      page_count: pageCount,
      chunks_count: chunks.length,
      deduplicated_items: merged.deduplicatedItems,
      duplicate_items: merged.duplicateItems,
      chunking_config: {
        threshold_pages: levelCProcessingConfig.thresholdPages,
        chunk_size_pages: levelCProcessingConfig.chunkSizePages,
        chunk_overlap_pages: levelCProcessingConfig.overlapPages,
        max_pdf_pages: levelCProcessingConfig.maxPdfPages,
      },
      runtime_config: {
        timeout_ms: levelCProcessingConfig.timeoutMs,
        max_total_tokens: levelCProcessingConfig.maxTotalTokens,
        max_cost_cents: levelCProcessingConfig.maxCostCents,
      },
      token_usage: {
        input_tokens: tokenUsage.inputTokens,
        reasoning_tokens: tokenUsage.reasoningTokens,
        output_tokens: tokenUsage.outputTokens,
        total_tokens: tokenUsage.totalTokens,
      },
      chunks: chunkMetrics,
    },
  };
}
