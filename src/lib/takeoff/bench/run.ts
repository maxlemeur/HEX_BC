import { z } from "zod";

import type { ChatGptReasoningEffort } from "@/lib/ai/chatgpt-model-preferences";
import { StructuredAiError } from "@/lib/ai/structured-ai-diagnostic";
import {
  buildItemKey,
  buildPdfChunks,
  createChunkPromptSourceHint,
  createPdfChunkBytes,
  getPdfPageCount,
  mergeTakeoffChunkExchanges,
  remapChunkLocalPagesToAbsolute,
  type TakeoffChunkExchange,
  type TakeoffPdfChunk,
} from "@/lib/takeoff/chunking";
import {
  TAKEOFF_C_CHUNK_OVERLAP_PAGES_DEFAULT,
  TAKEOFF_C_CHUNK_SIZE_PAGES_DEFAULT,
  TAKEOFF_C_CHUNK_THRESHOLD_PAGES_DEFAULT,
  TAKEOFF_C_TIMEOUT_MS_DEFAULT,
} from "@/lib/takeoff/constants";
import type { CallGeminiStructuredOptions, CallGeminiStructuredResult } from "@/lib/takeoff/gemini-client";
import { getTakeoffPrompt, getTakeoffPromptVersion } from "@/lib/takeoff/prompts";
import { TakeoffExchangeSchema } from "@/lib/takeoff/schemas";
import type { TakeoffExchange, TakeoffItem } from "@/lib/takeoff/types";

// One run of the takeoff bench (TI-660): the production level C reading of each
// plan, without persistence. Per document, as processor.ts does: chunks of the
// production defaults (buildPdfChunks 15/10/2, createPdfChunkBytes, one call
// up to 15 pages), the level C prompt with the anonymous id as source, the
// TakeoffExchangeSchema, the production timeout (callLocalChatGptStructured caps
// it), pages put back in absolute numbers, then mergeTakeoffChunkExchanges; the
// chunks that read each merged item are kept beside it (item_chunks), so that
// the score tells two blocks apart on the pages they overlap.
// Each call is timed by the bench clock, credential read included. Stops:
// - at once, with no further call: quota, rate limit, authorisation, missing
//   account or model, a changed profile, and any other provider error (no retry);
// - counted, the run goes on: a schema failure of the answer (ZodError,
//   SyntaxError, carrying the usage callLocalChatGptStructured attaches, or the
//   bench's own parse of the answer), a TimeoutError, a rejected request
//   (AI_REQUEST_REJECTED), a provider failure (AI_PROVIDER_FAILED, and a
//   ZodError or SyntaxError without usage: a broken provider stream, not an
//   answer);
// - an error of the bench itself stops the run as a bench error.

/** callLocalChatGptStructured caps every timeout at 180 s (unchanged); a timeout is counted at least that long. */
export const LOCAL_CHATGPT_TIMEOUT_CAP_MS = 180_000;

export const BENCH_CHUNKING = {
  thresholdPages: TAKEOFF_C_CHUNK_THRESHOLD_PAGES_DEFAULT,
  chunkSizePages: TAKEOFF_C_CHUNK_SIZE_PAGES_DEFAULT,
  overlapPages: TAKEOFF_C_CHUNK_OVERLAP_PAGES_DEFAULT,
} as const;

export type BenchCouple = { model: string; reasoningEffort: ChatGptReasoningEffort | null; override: boolean };
/** A requested couple; `override` is null until the profile is read (a run stopped before it claims no send mode). */
export type RequestedCouple = Omit<BenchCouple, "override"> & { override: boolean | null };
export type BenchCallResult = CallGeminiStructuredResult<TakeoffExchange> & { reasoningEffort: ChatGptReasoningEffort | null };
export type BenchCall = (options: CallGeminiStructuredOptions<TakeoffExchange>, couple: BenchCouple) => Promise<BenchCallResult>;

export type BenchRunDocument = { id: string; lot: string; role: "truth" | "reserve"; bytes: Uint8Array; sha256: string };
export type PlannedDocument = BenchRunDocument & { pages: number; chunks: TakeoffPdfChunk[] };

export type TokenUsage = { input: number; output: number; reasoning: number; total: number };
export type CallStatus = "ok" | "schema_failure" | "timeout" | "rejected" | "provider_failed" | "stopped";
export type CallError = { name: string; code: string | null; message: string };

export type ChunkCall = {
  chunk: number;
  chunks: number;
  start_page: number;
  end_page: number;
  pages: number;
  bytes: number;
  status: CallStatus;
  duration_ms: number;
  duration_per_page_ms: number;
  model: string;
  reasoning_effort: ChatGptReasoningEffort | null;
  prompt_version: string | null;
  usage: TokenUsage | null;
  items: number | null;
  warnings: number | null;
  error: CallError | null;
};

export type DocumentRun = {
  id: string;
  lot: string;
  role: "truth" | "reserve";
  sha256: string;
  bytes: number;
  pages: number;
  chunks_planned: number;
  complete: boolean;
  calls: ChunkCall[];
  failed_chunks: number;
  items: TakeoffItem[];
  /** The chunks (1-based) that read each item, in the order of `items`. */
  item_chunks: number[][];
  duplicate_items: number;
  deduplicated_items: number;
};

export type BenchPass = { pass: number; complete: boolean; documents: DocumentRun[] };
export type CoupleRun = {
  model: string;
  reasoning_effort: ChatGptReasoningEffort | null;
  override: boolean | null;
  prompt_version: string | null;
  passes: BenchPass[];
};

export type StopReason =
  | "quota" | "rate_limit" | "auth_required" | "account_missing" | "model_missing" | "selection_changed" | "other" | "bench_error";

export type BenchStop = {
  kind: "provider" | "bench";
  reason: StopReason;
  error: CallError;
  calls_done: number;
  calls_remaining: number;
  at: { model: string; reasoning_effort: ChatGptReasoningEffort | null; pass: number; document: string; chunk: number | null } | null;
};

export type BenchRunResult = {
  status: "complete" | "incomplete";
  stop: BenchStop | null;
  calls_planned: number;
  calls_done: number;
  couples: CoupleRun[];
};

export function describeError(error: unknown): CallError {
  if (error instanceof Error) {
    const code = error instanceof StructuredAiError ? error.code : null;
    return { name: error.name, code, message: error.message.slice(0, 300) };
  }
  return { name: typeof error, code: null, message: String(error).slice(0, 300) };
}

export type CallOutcome = { outcome: "counted"; status: Exclude<CallStatus, "ok" | "stopped"> } | { outcome: "stop"; reason: StopReason };

/** How the bench treats an error of a provider call (or of the ChatGPT pre-flight). */
export function classifyCallError(error: unknown): CallOutcome {
  if (error instanceof z.ZodError || error instanceof SyntaxError || (error instanceof Error && error.name === "ZodError")) {
    // Only the parse of an answer carries the tokens it consumed; any other parse is the provider protocol's.
    return { outcome: "counted", status: attachedUsage(error) === null ? "provider_failed" : "schema_failure" };
  }
  if (typeof error === "object" && error !== null && (error as { name?: unknown }).name === "TimeoutError") {
    return { outcome: "counted", status: "timeout" };
  }
  if (error instanceof StructuredAiError) {
    switch (error.code) {
      case "AI_REQUEST_REJECTED": return { outcome: "counted", status: "rejected" };
      case "AI_PROVIDER_FAILED": return { outcome: "counted", status: "provider_failed" };
      case "AI_QUOTA": return { outcome: "stop", reason: "quota" };
      case "AI_RATE_LIMIT": return { outcome: "stop", reason: "rate_limit" };
      case "AI_AUTH_REQUIRED": return { outcome: "stop", reason: "auth_required" };
      default: return { outcome: "stop", reason: "other" };
    }
  }
  const message = error instanceof Error ? error.message : "";
  // The fixed messages of callLocalChatGptStructured (chatgpt-local-inference.ts).
  if (/a changé/.test(message)) return { outcome: "stop", reason: "selection_changed" };
  if (/^Connectez (?:d’abord )?votre compte ChatGPT/.test(message)) return { outcome: "stop", reason: "account_missing" };
  if (/^Choisissez un modèle ChatGPT|n’est pas disponible pour ce compte/.test(message)) return { outcome: "stop", reason: "model_missing" };
  return { outcome: "stop", reason: "other" };
}

function attachedUsage(error: unknown): TokenUsage | null {
  const usage = (error as { usage?: Record<string, unknown> } | null)?.usage;
  if (!usage || typeof usage !== "object") return null;
  const value = (field: string) => (typeof usage[field] === "number" ? usage[field] as number : 0);
  return { input: value("inputTokens"), output: value("outputTokens"), reasoning: value("reasoningTokens"), total: value("totalTokens") };
}

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Page count and production chunks of each document, before any call. */
export async function planBenchDocuments(documents: readonly BenchRunDocument[]): Promise<PlannedDocument[]> {
  const plans: PlannedDocument[] = [];
  for (const document of documents) {
    const pages = await getPdfPageCount(arrayBufferOf(document.bytes));
    plans.push({ ...document, pages, chunks: buildPdfChunks(pages, BENCH_CHUNKING) });
  }
  return plans;
}

export function plannedCalls(plans: readonly PlannedDocument[], couples: number, repeat: number) {
  return couples * repeat * plans.reduce((total, plan) => total + plan.chunks.length, 0);
}

/** The result of a run stopped before its first call (ChatGPT pre-flight). */
export function stoppedBeforeRun(plans: readonly PlannedDocument[], couples: readonly RequestedCouple[], repeat: number,
  stop: Pick<BenchStop, "kind" | "reason" | "error">): BenchRunResult {
  const planned = plannedCalls(plans, couples.length, repeat);
  return {
    status: "incomplete", calls_planned: planned, calls_done: 0,
    stop: { ...stop, calls_done: 0, calls_remaining: planned, at: null },
    couples: couples.map((couple) => ({
      model: couple.model, reasoning_effort: couple.reasoningEffort, override: couple.override, prompt_version: null, passes: [],
    })),
  };
}

class StopRun extends Error {
  constructor(readonly stop: Omit<BenchStop, "calls_done" | "calls_remaining">) {
    super(stop.error.message);
  }
}

export async function runTakeoffBench(input: {
  plans: readonly PlannedDocument[];
  couples: readonly BenchCouple[];
  repeat: number;
  call: BenchCall;
  clock?: () => number;
  log?: (line: string) => void;
}): Promise<BenchRunResult> {
  const clock = input.clock ?? (() => performance.now());
  const promptVersion = getTakeoffPromptVersion("C");
  const result: BenchRunResult = {
    status: "complete", stop: null, calls_planned: plannedCalls(input.plans, input.couples.length, input.repeat), calls_done: 0, couples: [],
  };

  async function runDocument(plan: PlannedDocument, couple: BenchCouple, pass: number, document: DocumentRun) {
    const bytes = arrayBufferOf(plan.bytes);
    const exchanges: TakeoffChunkExchange[] = [];
    for (const chunk of plan.chunks) {
      const at = { model: couple.model, reasoning_effort: couple.reasoningEffort, pass, document: plan.id, chunk: chunk.index + 1 };
      let chunkBytes: Uint8Array;
      let prompt: string;
      try {
        prompt = getTakeoffPrompt("C", {
          fileType: "application/pdf", schemaVersion: "v1",
          sourceHint: createChunkPromptSourceHint({ fileName: plan.id, chunk, totalChunks: plan.chunks.length }),
        });
        chunkBytes = await createPdfChunkBytes({ bytes, chunk });
      } catch (error) {
        throw new StopRun({ kind: "bench", reason: "bench_error", error: describeError(error), at });
      }
      const pages = chunk.endPage - chunk.startPage + 1;
      const base = {
        chunk: chunk.index + 1, chunks: plan.chunks.length, start_page: chunk.startPage, end_page: chunk.endPage, pages,
        bytes: chunkBytes.byteLength, model: couple.model, reasoning_effort: couple.reasoningEffort,
      };
      const startedAt = clock();
      let endedAt: number | null = null;
      let outcome: { result: BenchCallResult; exchange: TakeoffExchange } | { error: unknown };
      try {
        const answer = await input.call({
          prompt,
          schema: TakeoffExchangeSchema,
          files: [{ data: Buffer.from(chunkBytes).toString("base64"), mimeType: "application/pdf" }],
          timeoutMs: TAKEOFF_C_TIMEOUT_MS_DEFAULT,
          context: { level: "C", promptVersion },
        }, couple);
        endedAt = clock();
        // As processor.ts does: the answer is parsed again before its pages are put back; a failure is the answer's.
        const parsed = TakeoffExchangeSchema.safeParse(answer.data);
        if (!parsed.success) throw Object.assign(parsed.error, { usage: answer.tokenUsage });
        outcome = { result: answer, exchange: parsed.data };
      } catch (error) {
        endedAt ??= clock();
        outcome = { error };
      }
      const duration = Math.max(0, endedAt - startedAt);
      result.calls_done += 1;
      const timing = { duration_ms: Math.round(duration), duration_per_page_ms: Math.round(duration / pages) };
      if ("result" in outcome) {
        const { exchange } = outcome;
        exchanges.push({ chunk, exchange: remapChunkLocalPagesToAbsolute({ chunk, exchange }) });
        const usage = outcome.result.tokenUsage;
        document.calls.push({
          ...base, ...timing, status: "ok", model: outcome.result.model, reasoning_effort: outcome.result.reasoningEffort,
          prompt_version: outcome.result.promptVersion,
          usage: { input: usage.inputTokens, output: usage.outputTokens, reasoning: usage.reasoningTokens, total: usage.totalTokens },
          items: exchange.items.length, warnings: exchange.warnings.length, error: null,
        });
        input.log?.(`${label(couple, pass, input.repeat)} ${plan.id} chunk ${chunk.index + 1}/${plan.chunks.length}: ok, `
          + `${exchange.items.length} items, ${(duration / 1000).toFixed(1)} s`);
        continue;
      }
      const classified = classifyCallError(outcome.error);
      const error = describeError(outcome.error);
      const status = classified.outcome === "counted" ? classified.status : "stopped";
      document.calls.push({
        ...base, ...timing, status, prompt_version: null,
        usage: status === "schema_failure" ? attachedUsage(outcome.error) : null, items: null, warnings: null, error,
      });
      input.log?.(`${label(couple, pass, input.repeat)} ${plan.id} chunk ${chunk.index + 1}/${plan.chunks.length}: ${status}`
        + ` (${error.code ?? error.name}), ${(duration / 1000).toFixed(1)} s`);
      if (classified.outcome === "stop") throw new StopRun({ kind: "provider", reason: classified.reason, error, at });
      document.failed_chunks += 1;
    }
    if (exchanges.length > 0) {
      const merged = mergeTakeoffChunkExchanges(exchanges);
      const chunksByKey = new Map<string, number[]>();
      for (const { chunk, exchange } of exchanges) {
        for (const item of exchange.items) {
          const key = buildItemKey(item);
          const chunks = chunksByKey.get(key) ?? [];
          if (!chunks.includes(chunk.index + 1)) chunksByKey.set(key, [...chunks, chunk.index + 1]);
        }
      }
      document.items = merged.exchange.items;
      document.item_chunks = document.items.map((item) => chunksByKey.get(buildItemKey(item)) ?? []);
      document.duplicate_items = merged.duplicateItems;
      document.deduplicated_items = merged.deduplicatedItems;
    }
    document.complete = true;
  }

  try {
    for (const couple of input.couples) {
      const coupleRun: CoupleRun = {
        model: couple.model, reasoning_effort: couple.reasoningEffort, override: couple.override, prompt_version: null, passes: [],
      };
      result.couples.push(coupleRun);
      for (let pass = 1; pass <= input.repeat; pass += 1) {
        const benchPass: BenchPass = { pass, complete: false, documents: [] };
        coupleRun.passes.push(benchPass);
        for (const plan of input.plans) {
          const document: DocumentRun = {
            id: plan.id, lot: plan.lot, role: plan.role, sha256: plan.sha256, bytes: plan.bytes.byteLength, pages: plan.pages,
            chunks_planned: plan.chunks.length, complete: false, calls: [], failed_chunks: 0, items: [], item_chunks: [],
            duplicate_items: 0, deduplicated_items: 0,
          };
          benchPass.documents.push(document);
          try {
            await runDocument(plan, couple, pass, document);
          } finally {
            coupleRun.prompt_version ??= document.calls.find((entry) => entry.prompt_version !== null)?.prompt_version ?? null;
          }
        }
        benchPass.complete = true;
      }
    }
  } catch (error) {
    const stop = error instanceof StopRun ? error.stop
      : { kind: "bench" as const, reason: "bench_error" as const, error: describeError(error), at: null };
    result.status = "incomplete";
    result.stop = { ...stop, calls_done: result.calls_done, calls_remaining: result.calls_planned - result.calls_done };
  }
  for (const couple of input.couples) {
    if (!result.couples.some((entry) => entry.model === couple.model && entry.reasoning_effort === couple.reasoningEffort)) {
      result.couples.push({ model: couple.model, reasoning_effort: couple.reasoningEffort, override: couple.override, prompt_version: null, passes: [] });
    }
  }
  return result;
}

function label(couple: BenchCouple, pass: number, repeat: number) {
  return `[${couple.model}/${couple.reasoningEffort ?? "auto"} pass ${pass}/${repeat}]`;
}
