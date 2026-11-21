import type { StructuredCall, TokenUsage } from "@/lib/ai/structured-call";
import {
  buildPdfChunks,
  createChunkPromptSourceHint,
  createPdfChunkBytes,
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
import { getTakeoffChunkingConfigForTenant } from "@/lib/takeoff/feature-flags";
import type { TakeoffJobProcessingRow } from "@/lib/takeoff/job-lifecycle";
import { isPdfMimeType } from "@/lib/takeoff/pdf-reading-guards";
import { inspectTakeoffPdfBytes } from "@/lib/takeoff/pdf-validation";
import { persistDetectedPlanFilePageCounts } from "@/lib/takeoff/plan-file-page-counts";
import { TAKEOFF_LEVEL_B, type Supabase } from "@/lib/takeoff/processing-context";
import { getTakeoffPrompt } from "@/lib/takeoff/prompts";
import {
  TakeoffChunkExchangeSchema,
  TakeoffExchangeSchema,
} from "@/lib/takeoff/schemas";
import type { DownloadedTakeoffFile } from "@/lib/takeoff/source-loader";
import type { TakeoffExchange } from "@/lib/takeoff/types";

function normalizeTableTextToken(value: string | null | undefined) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function buildLevelBTableSignature(table: NonNullable<TakeoffExchange["tables"]>[number]) {
  const headersSignature = table.headers
    .map((header) => normalizeTableTextToken(header))
    .join("||");
  const rowsSignature = table.rows
    .map((row) => {
      const cellsSignature = row.cells
        .map((cell) => normalizeTableTextToken(cell))
        .join("|");
      return `${row.row_index}:${cellsSignature}`;
    })
    .join("##");

  return `${table.page}::${normalizeTableTextToken(table.title)}::${headersSignature}::${rowsSignature}`;
}

function dedupeLevelBTables(tables: TakeoffExchange["tables"]) {
  if (!tables || tables.length === 0) {
    return tables;
  }

  const seen = new Set<string>();
  const deduped: NonNullable<TakeoffExchange["tables"]> = [];

  tables.forEach((table) => {
    const signature = buildLevelBTableSignature(table);
    if (seen.has(signature)) {
      return;
    }
    seen.add(signature);
    deduped.push(table);
  });

  return deduped.length > 0 ? deduped : undefined;
}

type ProcessLevelBAggregate = {
  normalizedExchange: TakeoffExchange;
  itemsForInsert: NormalizedTakeoffItemForInsert[];
  tokenCount: number;
  tokenUsage: TokenUsage;
  costCents: number;
  durationMs: number;
  tablesCount: number;
  pageCount: number | null;
  chunksCount: number;
  model: string;
  promptVersion: string;
  providerMeta: Record<string, unknown>;
};

export async function processLevelBChunks(input: {
  supabase: Supabase;
  job: TakeoffJobProcessingRow;
  sourceFile: DownloadedTakeoffFile;
  call: StructuredCall;
  schemaVersion: string;
  model: string;
  promptVersion: string;
}): Promise<ProcessLevelBAggregate> {
  if (!isPdfMimeType(input.sourceFile.mimeType)) {
    throw new TakeoffError({
      code: TakeoffErrorCode.TAKEOFF_FILE_TYPE_INVALID,
      message: "Le processor Level B requiert un fichier PDF source.",
      retryable: false,
      jobId: input.job.id,
      level: TAKEOFF_LEVEL_B,
      details: {
        file_type: input.sourceFile.mimeType,
        source_file_name: input.sourceFile.fileName,
      },
    });
  }

  const chunkingConfig = await getTakeoffChunkingConfigForTenant(input.job.tenant_id, {
    supabase: input.supabase,
  });

  let pageCount: number | null = null;
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
      level: TAKEOFF_LEVEL_B,
      details: pdfInspection.valid
        ? {
            reason: "invalid_pdf_page_count",
            source_file_name: input.sourceFile.fileName,
          }
        : pdfInspection.details,
    });
  }

  if (pageCount !== null && pageCount > chunkingConfig.maxPdfPages) {
    throw new TakeoffError({
      status: 413,
      code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE,
      message: `Le PDF contient ${pageCount} pages et depasse la limite de ${chunkingConfig.maxPdfPages} pages.`,
      retryable: false,
      jobId: input.job.id,
      level: TAKEOFF_LEVEL_B,
      details: {
        page_count: pageCount,
        max_pdf_pages: chunkingConfig.maxPdfPages,
      },
    });
  }

  if (pageCount !== null) {
    await persistDetectedPlanFilePageCounts({
      supabase: input.supabase,
      tenantId: input.job.tenant_id,
      sourceFile: input.sourceFile,
      fallbackSourceFilePath: input.job.source_file_path,
      fallbackPageCount: pageCount,
    });
  }

  const chunks: TakeoffPdfChunk[] =
    pageCount !== null
      ? buildPdfChunks(pageCount, {
          thresholdPages: chunkingConfig.thresholdPages,
          chunkSizePages: chunkingConfig.chunkSizePages,
          overlapPages: chunkingConfig.overlapPages,
        })
      : [{ index: 0, startPage: 1, endPage: 1 }];

  const chunkExchanges: Array<{
    chunk: TakeoffPdfChunk;
    exchange: TakeoffExchange;
  }> = [];
  const tokenUsage: TokenUsage = {
    inputTokens: 0,
    reasoningTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
  let costCents = 0;
  let durationMs = 0;

  for (const chunk of chunks) {
    const sourceHint =
      pageCount !== null
        ? createChunkPromptSourceHint({
            fileName: input.sourceFile.fileName,
            chunk,
            totalChunks: chunks.length,
          })
        : input.sourceFile.fileName;
    const prompt = getTakeoffPrompt(TAKEOFF_LEVEL_B, {
      preparation: input.sourceFile.preparationSnapshot,
      contextSourceHints: input.sourceFile.contextSourceHints,
      fileType: input.sourceFile.mimeType,
      schemaVersion: input.schemaVersion,
      sourceHint,
    });
    const bytesForChunk =
      pageCount !== null
        ? await createPdfChunkBytes({
            bytes: input.sourceFile.bytes,
            chunk,
          })
        : new Uint8Array(input.sourceFile.bytes);

    const result = await input.call<TakeoffExchange>({
      prompt,
      schema: TakeoffChunkExchangeSchema,
      files: [...(input.sourceFile.contextFiles ?? []),
        {
          data: Buffer.from(bytesForChunk).toString("base64"),
          mimeType: "application/pdf",
        },
      ],
      context: {
        jobId: input.job.id,
        tenantId: input.job.tenant_id,
        level: TAKEOFF_LEVEL_B,
        promptVersion: input.promptVersion,
        model: input.model,
      },
    });

    const parsedExchange = TakeoffChunkExchangeSchema.parse(result.data);
    chunkExchanges.push({
      chunk,
      exchange:
        pageCount !== null
          ? remapChunkLocalPagesToAbsolute({
              chunk,
              exchange: parsedExchange,
            })
          : parsedExchange,
    });

    tokenUsage.inputTokens += result.tokenUsage.inputTokens;
    tokenUsage.reasoningTokens += result.tokenUsage.reasoningTokens;
    tokenUsage.outputTokens += result.tokenUsage.outputTokens;
    tokenUsage.totalTokens += result.tokenUsage.totalTokens;
    costCents += result.costCents;
    durationMs += result.durationMs;
  }

  const merged =
    chunkExchanges.length > 1
      ? mergeTakeoffChunkExchanges(chunkExchanges)
      : {
          exchange: chunkExchanges[0].exchange,
          deduplicatedItems: chunkExchanges[0].exchange.items.length,
          duplicateItems: 0,
        };
  const strictMergedExchange = TakeoffExchangeSchema.parse({
    ...merged.exchange,
    tables: dedupeLevelBTables(merged.exchange.tables),
  });
  const normalized = normalizeTakeoffExchange({
    exchange: strictMergedExchange,
    ...takeoffSourceProvenance(input.job, input.sourceFile),
    parseWarnings: [],
  });
  const tablesCount = normalized.exchange.tables?.length ?? 0;

  const providerMeta: Record<string, unknown> = {
    file_type: input.sourceFile.mimeType,
    source_file_name: input.sourceFile.fileName,
    processing_mode: chunkExchanges.length > 1 ? "pdf_vision_chunked" : "pdf_vision",
    chunks_count: chunkExchanges.length,
    deduplicated_items: merged.deduplicatedItems,
    duplicate_items: merged.duplicateItems,
  };

  if (pageCount !== null) {
    providerMeta.page_count = pageCount;
    providerMeta.chunking_config = {
      threshold_pages: chunkingConfig.thresholdPages,
      chunk_size_pages: chunkingConfig.chunkSizePages,
      chunk_overlap_pages: chunkingConfig.overlapPages,
      max_pdf_pages: chunkingConfig.maxPdfPages,
    };
  }

  return {
    normalizedExchange: normalized.exchange,
    itemsForInsert: normalized.itemsForInsert,
    tokenCount: tokenUsage.totalTokens,
    tokenUsage,
    costCents,
    durationMs,
    tablesCount,
    pageCount,
    chunksCount: chunkExchanges.length,
    model: input.model,
    promptVersion: input.promptVersion,
    providerMeta,
  };
}
