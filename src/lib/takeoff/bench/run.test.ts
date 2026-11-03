import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { StructuredAiError } from "@/lib/ai/structured-ai-diagnostic";
import {
  planBenchDocuments,
  runTakeoffBench,
  type BenchCall,
  type BenchCallResult,
  type BenchCouple,
  type PlannedDocument,
} from "@/lib/takeoff/bench/run";
import { TakeoffExchangeSchema } from "@/lib/takeoff/schemas";
import type { TakeoffExchange, TakeoffItem } from "@/lib/takeoff/types";

// Ways the takeoff bench run (TI-660) could measure something other than the
// production level C reading, or keep going when it must stop, written before
// the code. Every document is a fictional blank PDF:
// - a plan of up to 15 pages is not sent whole in one call, or a longer one is
//   not cut in 10-page chunks overlapping 2 pages (the production defaults);
// - the prompt names the original title instead of the anonymous id, or has no
//   chunk and page range; the call carries Gemini options (thinkingLevel,
//   maxRetries, deliveryMode, context.model), or not the level C prompt version,
//   TakeoffExchangeSchema and the production timeout;
// - chunk pages stay local, so an item of chunk 2 is scored on the wrong page;
//   the duplicates of overlapping pages are not published (duplicate_items);
// - a quota, a rate limit, an authorisation error, a missing account or model or
//   a changed profile is followed by another call, or loses the calls done and
//   remaining in the partial result;
// - a schema failure, a timeout, a rejected request or a provider failure stops
//   the run or is not counted; a schema failure loses the tokens it consumed; a
//   timeout loses its pages, size, model, effort and duration;
// - an error of the bench itself (a chunk it cannot cut) is reported as a
//   provider stop, which would hide a bench bug behind an exit code 2;
// - durations come from the provider instead of the bench clock, or are not
//   divided by the pages of the chunk;
// - passes are not complete, couples are interleaved, or the model and effort
//   reported are not the ones sent.
// Found in review, written before its fix:
// - a broken provider stream (a SyntaxError or ZodError of the protocol, which
//   carries no usage) is counted as a schema failure of the answer, so the
//   schema-failure count mixes provider failures with bad answers.

async function blankPdf(pages: number) {
  const document = await PDFDocument.create();
  document.setTitle("Fictional original title");
  for (let index = 0; index < pages; index += 1) document.addPage([420, 297]);
  return document.save();
}

async function plan(id: string, pages: number, role: "truth" | "reserve" = "truth") {
  const [lot] = id.split("-");
  const [planned] = await planBenchDocuments([{ id, lot, role, bytes: await blankPdf(pages), sha256: "f".repeat(64) }]);
  return planned;
}

function exchange(items: TakeoffItem[] = []): TakeoffExchange {
  return {
    items, warnings: [], confidence: 0.8,
    metadata: { level: "C", prompt_version: "takeoff-c-v1", file_type: "application/pdf", schema_version: "v1" },
  };
}

function answer(couple: BenchCouple, items: TakeoffItem[] = [], durationMs = 1): BenchCallResult {
  return {
    data: exchange(items), tokenCount: 30, costCents: 0, durationMs, model: couple.model, reasoningEffort: couple.reasoningEffort,
    tokenUsage: { inputTokens: 20, outputTokens: 6, reasoningTokens: 4, totalTokens: 30 },
    promptVersion: "takeoff-c-v1", providerBatchId: null, providerBatchStateRaw: null,
  };
}

function item(designation: string, page: number): TakeoffItem {
  return { designation, quantity: 5, unit: "ml", source_page: page, confidence: 0.9, evidence: "Fictional evidence" };
}

const profile: BenchCouple = { model: "fixture-model", reasoningEffort: "medium", override: false };

function recorder(respond: (options: Parameters<BenchCall>[0], couple: BenchCouple, index: number) => Promise<BenchCallResult>) {
  const calls: Array<{ options: Parameters<BenchCall>[0]; couple: BenchCouple }> = [];
  const call: BenchCall = async (options, couple) => {
    calls.push({ options, couple });
    return respond(options, couple, calls.length - 1);
  };
  return { calls, call };
}

async function pagesOf(base64: string) {
  return (await PDFDocument.load(Buffer.from(base64, "base64"))).getPageCount();
}

function usage(error: Error) {
  return Object.assign(error, { usage: { inputTokens: 11, outputTokens: 3, reasoningTokens: 2, totalTokens: 16 } });
}

describe("takeoff bench run", () => {
  it("sends a plan of up to 15 pages in one call and a longer one in production chunks, under its anonymous id", async () => {
    const plans: PlannedDocument[] = [await plan("a-plan-01", 15), await plan("c-plan-01", 16)];
    expect(plans.map((entry) => entry.chunks.map((chunk) => `${chunk.startPage}-${chunk.endPage}`))).toEqual([["1-15"], ["1-10", "9-16"]]);
    const { calls, call } = recorder(async (_options, couple) => answer(couple));
    const run = await runTakeoffBench({ plans, couples: [profile], repeat: 1, call });
    expect(run).toMatchObject({ status: "complete", calls_planned: 3, calls_done: 3, stop: null });
    const [whole, , second] = calls.map(({ options }) => options);
    expect(whole.prompt).toContain("- source: a-plan-01 | chunk 1/1 | pages 1-15");
    expect(second.prompt).toContain("- source: c-plan-01 | chunk 2/2 | pages 9-16");
    expect(second.prompt).toContain("- level: C");
    for (const { options } of calls) {
      expect(options.prompt).not.toContain("Fictional original title");
      expect(options.schema).toBe(TakeoffExchangeSchema);
      expect(options.timeoutMs).toBe(300_000);
      expect(options.context).toEqual({ level: "C", promptVersion: "takeoff-c-v1" });
      expect(options).not.toHaveProperty("thinkingLevel");
      expect(options).not.toHaveProperty("maxRetries");
      expect(options).not.toHaveProperty("deliveryMode");
      expect(options.files).toHaveLength(1);
      expect(options.files?.[0].mimeType).toBe("application/pdf");
    }
    expect(await pagesOf(whole.files?.[0].data as string)).toBe(15);
    expect(await pagesOf(second.files?.[0].data as string)).toBe(8);
  });

  it("puts chunk pages back in absolute numbers and publishes the duplicates of overlapping pages", async () => {
    const { call } = recorder(async (_options, couple, index) => answer(couple, index === 0
      ? [item("EF cuivre DN 22", 9)]
      : [item("EF cuivre DN 22", 1), item("ECS cuivre DN 18", 3)]));
    const run = await runTakeoffBench({ plans: [await plan("c-plan-01", 16)], couples: [profile], repeat: 1, call });
    const [document] = run.couples[0].passes[0].documents;
    expect(document.items.map((entry) => [entry.designation, entry.source_page])).toEqual([["EF cuivre DN 22", 9], ["ECS cuivre DN 18", 11]]);
    expect(document).toMatchObject({ duplicate_items: 1, deduplicated_items: 2, complete: true, failed_chunks: 0 });
  });

  it.each([
    ["quota", new StructuredAiError("AI_QUOTA", "Limite du forfait ChatGPT atteinte.", 429)],
    ["rate_limit", new StructuredAiError("AI_RATE_LIMIT", "ChatGPT limite les demandes.", 429)],
    ["auth_required", new StructuredAiError("AI_AUTH_REQUIRED", "L’accès ChatGPT a été refusé.", 401)],
    ["selection_changed", new Error("Le compte, le modèle ou le niveau d’effort ChatGPT a changé. Relancez le métré.")],
    ["model_missing", new Error("Choisissez un modèle ChatGPT dans Mon profil.")],
    ["account_missing", new Error("Connectez votre compte ChatGPT.")],
  ])("stops at once on %s, without another call, and keeps the calls done and remaining", async (reason, error) => {
    const { calls, call } = recorder(async (_options, couple, index) => {
      if (index === 1) throw error;
      return answer(couple);
    });
    const plans = [await plan("a-plan-01", 1), await plan("a-plan-02", 1, "reserve"), await plan("d-plan-01", 1)];
    const run = await runTakeoffBench({ plans, couples: [profile], repeat: 2, call });
    expect(calls).toHaveLength(2);
    expect(run).toMatchObject({
      status: "incomplete", calls_planned: 6, calls_done: 2,
      stop: { kind: "provider", reason, calls_done: 2, calls_remaining: 4, at: { pass: 1, document: "a-plan-02", chunk: 1 } },
    });
    expect(run.couples[0].passes[0]).toMatchObject({ complete: false });
    expect(run.couples[0].passes[0].documents.map((document) => [document.id, document.complete])).toEqual([["a-plan-01", true], ["a-plan-02", false]]);
  });

  it("counts schema failures with their tokens, timeouts, rejections and provider failures, and goes on", async () => {
    const failures: unknown[] = [
      usage(new z.ZodError([])),
      usage(new SyntaxError("Unexpected token")),
      new DOMException("The operation was aborted due to timeout", "TimeoutError"),
      new StructuredAiError("AI_REQUEST_REJECTED", "ChatGPT a refusé le document.", 413),
      new StructuredAiError("AI_PROVIDER_FAILED", "ChatGPT n’a pas terminé la demande."),
    ];
    const { call } = recorder(async (_options, couple, index) => {
      if (index < failures.length) throw failures[index];
      return answer(couple, [item("EF cuivre DN 22", 1)]);
    });
    const plans = await Promise.all(["a-plan-01", "a-plan-02", "c-plan-01", "c-plan-02", "d-plan-01", "d-plan-02"].map((id) => plan(id, 2)));
    let now = 0;
    const run = await runTakeoffBench({ plans, couples: [{ model: "other-model", reasoningEffort: null, override: true }], repeat: 1, call, clock: () => (now += 90_000) });
    expect(run).toMatchObject({ status: "complete", calls_done: 6, stop: null });
    const calls = run.couples[0].passes[0].documents.map((document) => document.calls[0]);
    expect(calls.map((entry) => entry.status)).toEqual(["schema_failure", "schema_failure", "timeout", "rejected", "provider_failed", "ok"]);
    expect(calls[0].usage).toEqual({ input: 11, output: 3, reasoning: 2, total: 16 });
    expect(calls[1].usage).toEqual({ input: 11, output: 3, reasoning: 2, total: 16 });
    expect(calls[2]).toMatchObject({
      start_page: 1, end_page: 2, pages: 2, bytes: expect.any(Number), model: "other-model", reasoning_effort: null,
      duration_ms: 90_000, usage: null, error: { name: "TimeoutError" },
    });
    expect(calls[2].bytes).toBeGreaterThan(0);
    expect(calls[3].error).toMatchObject({ code: "AI_REQUEST_REJECTED" });
    expect(run.couples[0].passes[0].documents.map((document) => document.failed_chunks)).toEqual([1, 1, 1, 1, 1, 0]);
  });

  it("counts as a schema failure only an answer that fails its schema, not a broken provider stream", async () => {
    const { call } = recorder(async (_options, couple, index) => {
      if (index === 0) throw new SyntaxError("Unexpected token in a stream event");
      if (index === 1) throw new z.ZodError([]);
      return { ...answer(couple), data: { items: "not a list" } as unknown as TakeoffExchange };
    });
    const plans = await Promise.all(["a-plan-01", "a-plan-02", "c-plan-01"].map((id) => plan(id, 1)));
    const run = await runTakeoffBench({ plans, couples: [profile], repeat: 1, call });
    expect(run).toMatchObject({ status: "complete", calls_done: 3, stop: null });
    const calls = run.couples[0].passes[0].documents.map((document) => document.calls[0]);
    expect(calls.map((entry) => [entry.status, entry.usage])).toEqual([
      ["provider_failed", null], ["provider_failed", null], ["schema_failure", { input: 20, output: 6, reasoning: 4, total: 30 }],
    ]);
  });

  it("measures each call with the bench clock and divides it by the pages of its chunk", async () => {
    const ticks = [0, 20_000, 20_000, 23_000];
    const { call } = recorder(async (_options, couple) => answer(couple, [], 1));
    const run = await runTakeoffBench({ plans: [await plan("c-plan-01", 16)], couples: [profile], repeat: 1, call, clock: () => ticks.shift() as number });
    expect(run.couples[0].passes[0].documents[0].calls.map((entry) => [entry.pages, entry.duration_ms, entry.duration_per_page_ms]))
      .toEqual([[10, 20_000, 2_000], [8, 3_000, 375]]);
  });

  it("runs complete passes one couple at a time and reports the model and effort sent", async () => {
    const couples: BenchCouple[] = [profile, { model: "other-model", reasoningEffort: "high", override: true }];
    const { calls, call } = recorder(async (_options, couple) => answer(couple));
    const run = await runTakeoffBench({ plans: [await plan("a-plan-01", 1), await plan("d-plan-01", 1)], couples, repeat: 2, call });
    expect(calls.map(({ couple }) => couple.model)).toEqual(Array(4).fill("fixture-model").concat(Array(4).fill("other-model")));
    expect(run.couples.map((entry) => [entry.model, entry.reasoning_effort, entry.override, entry.prompt_version, entry.passes.map((pass) => pass.complete)]))
      .toEqual([["fixture-model", "medium", false, "takeoff-c-v1", [true, true]], ["other-model", "high", true, "takeoff-c-v1", [true, true]]]);
    expect(run.couples[1].passes[1].documents[1].calls[0]).toMatchObject({ model: "other-model", reasoning_effort: "high" });
  });

  it("stops as a bench error, not a provider stop, when the bench cannot cut a chunk", async () => {
    const valid = await plan("a-plan-01", 1);
    const broken = { ...(await plan("a-plan-02", 3)), chunks: [{ index: 0, startPage: 1, endPage: 5 }] };
    const { calls, call } = recorder(async (_options, couple) => answer(couple));
    const run = await runTakeoffBench({ plans: [valid, broken], couples: [profile], repeat: 1, call });
    expect(calls).toHaveLength(1);
    expect(run).toMatchObject({ status: "incomplete", stop: { kind: "bench", reason: "bench_error", calls_done: 1, at: { document: "a-plan-02" } } });
    await expect(planBenchDocuments([{ id: "a-plan-03", lot: "a", role: "truth", bytes: new Uint8Array([1, 2, 3]), sha256: "0".repeat(64) }]))
      .rejects.toThrow();
  });
});
