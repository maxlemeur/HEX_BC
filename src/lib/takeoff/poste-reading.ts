import type { StructuredCall, TokenUsage } from "@/lib/ai/structured-call";
import {
  buildPdfChunks,
  createChunkPromptSourceHint,
  createPdfChunkBytes,
  getPdfPageCount,
  ownedChunkPages,
} from "@/lib/takeoff/chunking";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import {
  cloneLevelCChunkMetrics,
  mapToLevelCNormalizedError,
  type LevelCChunkMetric,
  type LevelCProcessingError,
} from "@/lib/takeoff/level-c-chunk-metrics";
import {
  planPosteExchangeCalls,
  PosteExchangeOutputSchema,
  PosteExchangeRefusal,
  POSTE_EXCHANGE_PROMPT_VERSION,
  validatePosteExchangeOutput,
} from "@/lib/takeoff/poste-exchange";
import {
  mergePosteReadings,
  remapPosteFragmentReading,
  type PosteFragmentReading,
  type PostePlanReading,
  type PosteVectorReading,
} from "@/lib/takeoff/poste-exchange-merge";
import type { Poste } from "@/lib/takeoff/poste-list";
import type { TakeoffPreparationSnapshot } from "@/lib/takeoff/preparation";
import { TAKEOFF_LEVEL_C } from "@/lib/takeoff/processing-context";
import { getTakeoffItemReadingPrompt } from "@/lib/takeoff/prompts";
import { rejectedTakeoffAnswerMetrics } from "@/lib/takeoff/rejected-provider-answer";
import type { VectorPageOutcome } from "@/lib/takeoff/vectors/worker-server";

/**
 * The local reader of the second measuring order (lot 4): one plan's PDF read against a sealed list of items, through
 * the job's local provider (the creator's ChatGPT plan, or the controlled provider of the tests and journeys). Each call
 * attaches one fragment of the plan and asks one batch of items (`poste-exchange.ts`); its answer is checked against the
 * call before anything else reads it, and the first refusal stops the plan's analysis, its calls' metrics kept. The
 * reading's answers are merged per item only once every call answered (`finishPlanReading`), with the vector reading of
 * the plan's own pages, and checked again as a whole. Nothing is written here: the processor publishes the result.
 */

/** A reference of the preparation, read for the job: its kind, name and indice, and its bytes as the provider sends them. */
export type PosteReadingReference = { kind: "dpgf" | "cctp" | "other"; name: string; revision: string | null; data: string; mimeType: string };

export type PosteUnitReading = {
  fragments: PosteFragmentReading[];
  /** The plan's original pages, in the order of its PDF. */
  planPages: number[];
  calls: number;
  pageCount: number;
  chunksCount: number;
  tokenUsage: TokenUsage;
  costCents: number;
  durationMs: number;
  metrics: LevelCChunkMetric[];
};

/**
 * The references the second order attaches: the written technical pieces (CCTP) only. A DPGF's rows are the list itself,
 * read without their quantities and prices; any other piece (a price schedule, a mail) may carry prices.
 */
export function posteReadingReferences(references: readonly PosteReadingReference[]) {
  return references.filter((reference) => reference.kind === "cctp");
}

function emptyMetric(index: number, chunk: { startPage: number; endPage: number }, model: string): LevelCChunkMetric {
  return { provider: "chatgpt", index, start: chunk.startPage, end: chunk.endPage, input_tokens: 0, reasoning_tokens: 0, output_tokens: 0,
    token_count: 0, cost_cents: 0, duration_ms: 0, model, timed_out: false, budget_exceeded: false, status: "failed" };
}

/** A refusal of the exchange, as the plan's analysis records it: the public reason « Extraction incomplète sur ce document. ». */
function refusalError(refusal: PosteExchangeRefusal, jobId: string) {
  return new TakeoffError({ status: 422, code: TakeoffErrorCode.TAKEOFF_LEVEL_C_INVALID_SCHEMA, message: refusal.message, retryable: false,
    jobId, level: TAKEOFF_LEVEL_C, details: { reason: refusal.code, chunk_id: refusal.details.chunkId,
      ...(refusal.details.keys ? { keys: refusal.details.keys.slice(0, 20), key_count: refusal.details.keys.length } : {}),
      ...(refusal.details.pages ? { pages: refusal.details.pages.slice(0, 50) } : {}) } });
}

/** The plan's pages: the original page of each page of its PDF, once each. */
export function planPagesOf(pageCount: number, originalPageNumbers: readonly number[] | undefined) {
  const pages = Array.from({ length: pageCount }, (_, index) => originalPageNumbers?.[index] ?? index + 1);
  if (new Set(pages).size !== pages.length || pages.some((value) => !Number.isInteger(value) || value < 1)) {
    throw new Error("Each page of the plan's PDF needs its own original page.");
  }
  return pages;
}

export async function readPlanAgainstItemList(input: {
  call: StructuredCall;
  job: { id: string; tenant_id: string };
  /** The requested items, in the sealed list's order. */
  items: readonly Poste[];
  listRevision: number;
  model: string;
  /** The detailed reading's configuration, bounded by what the request has left (`boundTakeoffAttemptByRequest`). */
  config: { thresholdPages: number; chunkSizePages: number; overlapPages: number; timeoutMs: number; maxTotalTokens: number;
    maxCostCents: number };
  /** The plan's PDF as the job reads it (its retained pages), and the original page of each of its pages. */
  pdf: { fileName: string; bytes: ArrayBuffer; originalPageNumbers?: number[] };
  references?: readonly PosteReadingReference[];
  preparation?: TakeoffPreparationSnapshot | null;
  /** Before each call: the processor's own checks (the lease renewed, the tenant still active). */
  beforeCall?: () => Promise<void>;
}): Promise<PosteUnitReading> {
  const pageCount = await getPdfPageCount(input.pdf.bytes);
  const planPages = planPagesOf(pageCount, input.pdf.originalPageNumbers);
  const chunks = buildPdfChunks(pageCount, input.config);
  const calls = planPosteExchangeCalls({ listRevision: input.listRevision, items: input.items, fragments: chunks,
    ownedPages: ownedChunkPages(chunks) });
  const references = posteReadingReferences(input.references ?? []);
  const contextSourceHints = references.map((reference, index) =>
    `Pièce de référence jointe ${index + 1} : « ${reference.name} » (${reference.kind}${reference.revision ? `, indice ${reference.revision}` : ""})`);
  const fragments: PosteFragmentReading[] = [];
  const metrics: LevelCChunkMetric[] = [];
  const tokenUsage: TokenUsage = { inputTokens: 0, reasoningTokens: 0, outputTokens: 0, totalTokens: 0 };
  let costCents = 0;
  let durationMs = 0;
  // The fragment's bytes, made once for the batches that attach it.
  let fragmentBytes = null as { index: number; data: string } | null;

  for (const call of calls) {
    const index = call.ordinal - 1;
    try {
      if (fragmentBytes?.index !== call.fragment.index) {
        fragmentBytes = { index: call.fragment.index,
          data: Buffer.from(await createPdfChunkBytes({ bytes: input.pdf.bytes, chunk: call.fragment })).toString("base64") };
      }
      await input.beforeCall?.();
      const result = await input.call({
        prompt: getTakeoffItemReadingPrompt({ manifest: call.manifest, preparation: input.preparation, contextSourceHints,
          sourceHint: createChunkPromptSourceHint({ fileName: input.pdf.fileName, chunk: call.fragment, totalChunks: chunks.length }) }),
        schema: PosteExchangeOutputSchema,
        files: [...references.map((reference) => ({ data: reference.data, mimeType: reference.mimeType })),
          { data: fragmentBytes.data, mimeType: "application/pdf" }],
        timeoutMs: input.config.timeoutMs,
        context: { jobId: input.job.id, tenantId: input.job.tenant_id, level: TAKEOFF_LEVEL_C, promptVersion: POSTE_EXCHANGE_PROMPT_VERSION,
          model: input.model },
      });
      tokenUsage.inputTokens += result.tokenUsage.inputTokens;
      tokenUsage.reasoningTokens += result.tokenUsage.reasoningTokens;
      tokenUsage.outputTokens += result.tokenUsage.outputTokens;
      tokenUsage.totalTokens += result.tokenUsage.totalTokens;
      costCents += result.costCents;
      durationMs += result.durationMs;
      const exceeded = tokenUsage.totalTokens > input.config.maxTotalTokens || costCents > input.config.maxCostCents;
      metrics.push({ ...emptyMetric(index, call.fragment, result.model), input_tokens: result.tokenUsage.inputTokens,
        reasoning_tokens: result.tokenUsage.reasoningTokens, output_tokens: result.tokenUsage.outputTokens,
        token_count: result.tokenUsage.totalTokens, cost_cents: result.costCents, duration_ms: result.durationMs,
        budget_exceeded: exceeded, status: exceeded ? "failed" : "success",
        ...(exceeded ? { error_code: TakeoffErrorCode.TAKEOFF_LEVEL_C_BUDGET_EXCEEDED, error_message: "Le budget Level C configure est depasse." } : {}) });
      if (exceeded) {
        throw new TakeoffError({ status: 422, code: TakeoffErrorCode.TAKEOFF_LEVEL_C_BUDGET_EXCEEDED, retryable: false, jobId: input.job.id,
          level: TAKEOFF_LEVEL_C, message: "Le budget Level C configure est depasse.",
          details: { chunk_id: call.manifest.chunk_id, consumed: { total_tokens: tokenUsage.totalTokens, cost_cents: costCents },
            budget: { max_total_tokens: input.config.maxTotalTokens, max_cost_cents: input.config.maxCostCents } } });
      }
      // The provider read its answer through the schema; the answer is checked again here against the call itself.
      const output = PosteExchangeOutputSchema.parse(result.data);
      validatePosteExchangeOutput(call, output);
      fragments.push(remapPosteFragmentReading(call, output, (pdfPage) => planPages[pdfPage - 1]));
    } catch (error) {
      const raised = error instanceof PosteExchangeRefusal ? refusalError(error, input.job.id) : error;
      const normalized = mapToLevelCNormalizedError({ error: raised, jobId: input.job.id, chunkMetrics: metrics });
      const tracked = metrics.find((metric) => metric.index === index);
      if (tracked) {
        Object.assign(tracked, { status: "failed", error_code: normalized.code, error_message: normalized.message });
      } else {
        // A rejected answer still consumed its reported usage.
        const usage = (error as { usage?: Partial<TokenUsage> } | null)?.usage;
        const metricsFromAnswer = rejectedTakeoffAnswerMetrics(normalized.details) ?? {
          input_tokens: usage?.inputTokens ?? 0, reasoning_tokens: usage?.reasoningTokens ?? 0,
          output_tokens: usage?.outputTokens ?? 0, token_count: usage?.totalTokens ?? 0,
        };
        metrics.push({ ...emptyMetric(index, call.fragment, input.model), timed_out: normalized.code === TakeoffErrorCode.TAKEOFF_LEVEL_C_TIMEOUT,
          ...metricsFromAnswer, error_code: normalized.code, error_message: normalized.message });
      }
      (normalized as LevelCProcessingError).levelCChunkMetrics = cloneLevelCChunkMetrics(metrics);
      throw normalized;
    }
  }
  return { fragments, planPages, calls: calls.length, pageCount, chunksCount: chunks.length, tokenUsage, costCents, durationMs, metrics };
}

/** The key of a vector reading: its plan's file, its page and its place among that page's quantities. */
export function posteVectorKey(planFileId: string, page: number, index: number) {
  return `${planFileId}:${page}:${index}`;
}

/**
 * The vector reading of one plan's file as the merge reads it: its network and insulation lengths and its surfaces, each
 * with its key (`posteVectorKey`). Another file's pages are left out, and a page without a reading (whose quantities the
 * vector persistence does not keep either).
 */
export function posteVectorReadings(outcomes: readonly VectorPageOutcome[], planFileId: string): PosteVectorReading[] {
  return outcomes.filter((outcome) => outcome.record && outcome.document.kind === "plan_file"
    && outcome.document.plan_file_id === planFileId)
    .flatMap((outcome) => outcome.items.map((record, index) => ({
      key: posteVectorKey(planFileId, outcome.page, index), page: outcome.page, kind: record.geometry.kind,
      room: record.room?.label ?? null,
      designation: record.item.designation, quantity: record.item.quantity, unit: record.item.unit, confidence: record.item.confidence,
      evidence: record.item.evidence,
    })));
}

/** The plan's answers, one per item, from its reading and its vector reading; a refusal of the merged plan is the plan's error. */
export function finishPlanReading(reading: PosteUnitReading, items: readonly Poste[], vectors: readonly PosteVectorReading[],
  jobId = ""): PostePlanReading {
  try {
    return mergePosteReadings({ items, planPages: reading.planPages, fragments: reading.fragments, vectorReadings: vectors });
  } catch (error) {
    if (error instanceof PosteExchangeRefusal) throw refusalError(error, jobId);
    throw error;
  }
}
