import { describe, expect, it, vi } from "vitest";

import type { OpenAiDecisionsResult } from "@/lib/ai/decisions";
import { createDecisionsTokenBudget, type DecisionsTokenBudget } from "@/lib/ai/decisions-budget";
import type { VectorGroupKey, VectorPageExtraction, VectorPath } from "@/lib/takeoff/vectors/extraction";
import { GROUP_DECISIONS_LIMITS } from "@/lib/takeoff/vectors/group-decisions";
import {
  classifyVectorGroups,
  decisionsOfOutcome,
  GROUP_DECISIONS_CONCURRENCY,
  GROUP_DECISIONS_DEDICATED_RENDER_CHUNK,
  type GroupDecisionsCallLimits,
  type GroupDecisionsDecide,
  type GroupDecisionsOutcome,
  type GroupDecisionsRender,
} from "@/lib/takeoff/vectors/group-decisions-server";
import type { GroupImage } from "@/lib/takeoff/vectors/group-sheet-server";
import { readVectorPage } from "@/lib/takeoff/vectors/pipeline";

// Ways the Decisions call loop of vector groups (TI-662 L3c,
// group-decisions-server.ts) could spend, retry or misapply, written before
// the code. Decisions and the renders are fakes (no network, no child
// process); pages are fictional hand-built extractions.
// - more than 10 batch calls or 36 questions per call; a batch call without its
//   two images (legend extract, contact sheet);
// - a group answered at 0.5 or more is asked again alone, or one under 0.5,
//   missing, refused or invalid is not; more than 50 dedicated calls; the
//   dedicated answer does not replace the batch one;
// - the token budget is not asked before each call (a call past the ceiling
//   starts), or not given each call's usage after it (calls stay in flight);
//   a refusal of the budget does not stop the loop;
// - after a failed or unavailable result the loop goes on (a retry by another
//   name), or an exception thrown before sending escapes and drops the page;
// - without canvas, or when a render fails, a call is sent anyway (without its
//   images), or the page throws instead of keeping its groups « à revoir »;
// - a page without candidates still renders or calls;
// - the call log keeps the evidence or images (the call record must stay
//   small and hold nothing but counts, statuses, usage and timings);
// - an answer is keyed by its alias instead of its group id, or the reading
//   options get an unanswered group;
// - the calls a document has left (worker, TI-662 L3d) are passed over, or
//   larger ones lift the page caps.
// In bounded parallel (TI-704), races a browser cannot force, with a fake
// Decisions whose calls end when the test says, in the order it chooses:
// - more than GROUP_DECISIONS_CONCURRENCY calls in flight, or the slots left
//   empty (the calls still one after the other);
// - a dedicated call before every batch call has answered; dedicated renders
//   that overlap, run more than one chunk ahead, or go on past a stop;
// - calls started together past the token ceiling (one check for several
//   starts, or batch calls reserved at the estimate or at a smaller call before
//   the page's first batch has answered), or a refusal while calls in flight
//   would have made room (an earlier stop than in a row);
// - a chunk drawn ahead after a stop is known, or the summed latencies of
//   calls in parallel (or the renders between them) given for the time they
//   took;
// - a slow call that fails letting the rest of the phase leave meanwhile, all
//   of it spent for nothing (more than GROUP_DECISIONS_CONCURRENCY - 1 calls
//   after a stop);
// - a new call after a failed one or a failed job check is known, the answers
//   of a call after the failed one applied, or the job check's error lost or
//   thrown while calls are still in flight;
// - answers, their order, their provenance or the stop that depend on the
//   order the calls end in.

const A3 = { width: 1190.55, height: 841.89 };
const OWNER = { userId: "user-fixture", tenantId: "tenant-fixture" };
const CONTEXT = { tenantId: "tenant-fixture", projectId: "bench:a-plan-01", preparationFingerprint: "f".repeat(64) };
const IMAGE: GroupImage = { mimeType: "image/jpeg", data: "AAAA", width: 10, height: 10, bytes: 3 };

/** `count` magenta groups told apart by their width, the first the longest; `grey` more grey ones after them. */
function page(count: number, grey = 0): VectorPageExtraction {
  const groups: VectorGroupKey[] = [];
  const paths: VectorPath[] = [];
  const coordinates: number[] = [];
  for (let index = 0; index < count + grey; index += 1) {
    groups.push({ layer: null, color: index < count ? "#ff00ff" : "#808080", width: 0.01 * (index + 1), dash: null });
    paths.push({ group: index, start: coordinates.length / 2, count: 2, closed: false });
    coordinates.push(100, 10 + 1.5 * index, 1100 - index, 10 + 1.5 * index);
  }
  return {
    page: 1, pages: 1, width: A3.width, height: A3.height, userUnit: 1, rotate: 0, layers: [], groups, texts: [], paths,
    points: Float32Array.from(coordinates),
    counts: { operators: 0, strokePaths: paths.length, fillPaths: 0, clipPaths: 0, images: 0, imageCoverage: 0 },
    timings: { operators_ms: 0, walk_ms: 0, text_ms: 0, total_ms: 0 }, memory: { max_rss_kb: 0, heap_used_mb: 0 },
  };
}

function fakeRender(overrides: Partial<GroupDecisionsRender> = {}) {
  const calls = { legend: 0, sheets: [] as number[] };
  const render: GroupDecisionsRender = {
    legend: async () => {
      calls.legend += 1;
      return { image: IMAGE, issue: null, dropped_images: 0, duration_ms: 4 };
    },
    sheets: async (plans) => {
      calls.sheets.push(plans.length);
      return { images: plans.map(() => IMAGE), issue: null, render_ms: plans.map(() => 7), duration_ms: 9 };
    },
    ...overrides,
  };
  return { render, calls };
}

type Answer = { value: string; confidence: number } | "refused" | "missing";
type AnswerOf = (alias: string, kind: "batch" | "dedicated") => Answer;
type Status = OpenAiDecisionsResult["status"] | "throw";

/** What a fake Decisions returns for `input`: `answer(alias, kind)` per question when the call answers, `tokens` used. */
function resultOf(input: Parameters<GroupDecisionsDecide>[0], outcome: OpenAiDecisionsResult["status"], answer: AnswerOf, tokens = 1000): OpenAiDecisionsResult {
  const kind = input.evidence.call as "batch" | "dedicated";
  const answers = input.questions.map((question) => {
    const given = outcome === "available" || outcome === "partial" ? answer(question.name, kind) : "missing";
    if (given === "refused" || given === "missing") return { name: question.name, type: "choice" as const, status: given, value: null, confidence: null };
    return { name: question.name, type: "choice" as const, status: "answered" as const, value: given.value, confidence: given.confidence,
      probabilities: [{ value: given.value, probability: given.confidence }] };
  });
  return {
    status: outcome, capability: { status: "available", model: "gpt-6-luna", billing: "separate_api", message: "" }, message: `Fictional ${outcome}.`,
    answers,
    provenance: { tenant_id: OWNER.tenantId, project_id: CONTEXT.projectId, preparation_fingerprint: CONTEXT.preparationFingerprint,
      request_fingerprint: "r", model: "gpt-6-luna", requested_at: "2026-11-03T10:00:00.000Z",
      usage: outcome === "failed" || outcome === "unavailable" ? null : { input_tokens: tokens - 100, output_tokens: 100, total_tokens: tokens } },
  };
}

/** A Decisions fake: `answer(alias, kind)` per question; every call recorded with its question names and image count. */
function fakeDecide(answer: AnswerOf, status: (call: number) => Status = () => "available") {
  const seen: Array<{ names: string[]; images: number; evidence: Record<string, unknown>; context: unknown }> = [];
  const decide: GroupDecisionsDecide = async (input) => {
    const call = seen.length;
    seen.push({ names: input.questions.map((question) => question.name), images: input.images?.length ?? 0, evidence: input.evidence, context: input.context });
    const outcome = status(call);
    if (outcome === "throw") throw new Error("Le contexte Decisions est trop volumineux.");
    return resultOf(input, outcome, answer);
  };
  return { decide, seen };
}

type GatedCall = { index: number; kind: "batch" | "dedicated"; names: string[]; settled: boolean; settle: (status?: Status) => void };

/**
 * A Decisions fake whose calls wait until the test settles them, in the order it chooses; `status` gives a call's
 * result when the test does not, `tokens` its usage, `onStart` runs as it starts (before it is listed).
 */
function gatedDecide(answer: AnswerOf, options: { status?: (call: number) => Status; tokens?: (call: number) => number; onStart?: (call: number) => void } = {}) {
  const calls: GatedCall[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const decide: GroupDecisionsDecide = (input) => new Promise((resolve, reject) => {
    const index = calls.length;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    options.onStart?.(index);
    const call: GatedCall = {
      index, kind: input.evidence.call as "batch" | "dedicated", names: input.questions.map((question) => question.name), settled: false,
      settle: (status = options.status?.(index) ?? "available") => {
        if (call.settled) throw new Error("A fake call settled twice.");
        call.settled = true;
        inFlight -= 1;
        if (status === "throw") reject(new Error("Le contexte Decisions est trop volumineux."));
        else resolve(resultOf(input, status, answer, options.tokens?.(index)));
      },
    };
    calls.push(call);
  });
  return { decide, calls, open: () => calls.filter((call) => !call.settled), inFlight: () => inFlight, maxInFlight: () => maxInFlight };
}

type Gated = ReturnType<typeof gatedDecide>;
/** Lets every promise that can move move (the loop, the fake renders), before the test settles the next call. */
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const first = (open: GatedCall[]) => open[0];
const last = (open: GatedCall[]) => open[open.length - 1];
/** A seeded choice among the open calls: the same order on every run of the test. */
function shuffled(seed: number) {
  let state = seed;
  return (open: GatedCall[]) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return open[Math.floor((state / 2147483648) * open.length)];
  };
}

/** Settles the gated calls one at a time, `pick` choosing among the open ones, until the classification ends. */
async function drive<T>(pending: Promise<T>, gated: Gated, pick: (open: GatedCall[]) => GatedCall = first): Promise<T> {
  let ended = false;
  pending.then(() => { ended = true; }, () => { ended = true; });
  for (let idle = 0; !ended;) {
    await tick();
    if (ended) break;
    const open = gated.open();
    if (open.length === 0) {
      idle += 1;
      if (idle > 20) throw new Error("The classification waits, but for no call of the fake.");
      continue;
    }
    idle = 0;
    pick(open).settle();
  }
  return pending;
}

function run(extraction: VectorPageExtraction, options: {
  decide: GroupDecisionsDecide; render?: GroupDecisionsRender; maxTokens?: number; limits?: GroupDecisionsCallLimits;
  budget?: DecisionsTokenBudget; beforeCall?: () => Promise<void>; clock?: () => number;
}) {
  const budget = options.budget ?? createDecisionsTokenBudget(options.maxTokens ?? 10_000_000, 1_000);
  const reading = readVectorPage(extraction, { clock: () => 0 });
  return { budget, outcome: classifyVectorGroups({
    bytes: new Uint8Array([37, 80, 68, 70]), extraction, reading, owner: OWNER, context: CONTEXT, budget,
    decide: options.decide, render: options.render ?? fakeRender().render, limits: options.limits, beforeCall: options.beforeCall,
    clock: options.clock ?? (() => 0),
  }) };
}

const aliasNumber = (alias: string) => Number(alias.slice("groupe_".length));

describe("Decisions call loop (group-decisions-server.ts classifyVectorGroups)", () => {
  it("asks 36 groups per batch with the legend and the sheet, then alone those under 0.5 or unanswered; the dedicated answer wins", async () => {
    const { decide, seen } = fakeDecide((alias, kind) => {
      const rank = aliasNumber(alias);
      if (kind === "dedicated") return { value: "EF", confidence: 0.85 };
      if (rank === 2) return { value: "EU", confidence: 0.49 };
      if (rank === 3) return "refused";
      if (rank === 4) return { value: "EU", confidence: 0.5 };
      if (rank === 40) return "missing";
      return { value: "EU", confidence: 0.9 };
    });
    const { render, calls } = fakeRender();
    const { budget, outcome: pending } = run(page(40), { decide, render });
    const outcome = await pending;
    expect(seen.map((call) => [call.names.length, call.images])).toEqual([[36, 2], [4, 2], [1, 2], [1, 2], [1, 2]]);
    expect(seen.slice(2).map((call) => call.names)).toEqual([["groupe_02"], ["groupe_03"], ["groupe_40"]]);
    expect(seen.every((call) => call.context === CONTEXT)).toBe(true);
    expect(outcome.calls.map((call) => [call.kind, call.questions, call.status])).toEqual([
      ["batch", 36, "available"], ["batch", 4, "available"], ["dedicated", 1, "available"], ["dedicated", 1, "available"], ["dedicated", 1, "available"],
    ]);
    expect(outcome.calls[0]).toMatchObject({ usage: { total_tokens: 1000 }, latency_ms: 0, render_ms: 7 });
    expect(JSON.stringify(outcome.calls)).not.toContain("AAAA");
    expect(outcome).toMatchObject({ stop: null, candidates: 40, left_out: 0 });
    const byAlias = new Map([...outcome.answers.values()].map((answer) => [answer.alias, answer]));
    expect(byAlias.get("groupe_01")).toMatchObject({ class: "EU", confidence: 0.9, status: "answered", via: "batch" });
    expect(byAlias.get("groupe_02")).toMatchObject({ class: "EF", confidence: 0.85, via: "dedicated" });
    expect(byAlias.get("groupe_04")).toMatchObject({ class: "EU", confidence: 0.5, via: "batch" });
    expect(outcome.answers.get("c:#ff00ff|w:0.01|d:")).toMatchObject({ alias: "groupe_01" });
    expect(budget.snapshot()).toMatchObject({ calls: 5, spent_tokens: 5000 });
    expect(calls.legend).toBe(1);
    // Decisions answers for the reading: answered classes only, by group id.
    const decisions = decisionsOfOutcome(outcome);
    expect(decisions.get("c:#ff00ff|w:0.01|d:")).toEqual({ class: "EU", confidence: 0.9 });
    expect(decisions.size).toBe(40);
  });

  it("caps the dedicated calls at 50 and never offers a grey group a network", async () => {
    const { decide, seen } = fakeDecide((alias, kind) => (kind === "batch" ? { value: "autre", confidence: 0.2 } : { value: "mur", confidence: 0.7 }));
    const outcome = await run(page(60, 2), { decide }).outcome;
    expect(seen.filter((call) => call.evidence.call === "dedicated")).toHaveLength(GROUP_DECISIONS_LIMITS.maxDedicatedCalls);
    expect(seen.filter((call) => call.evidence.call === "batch").map((call) => call.names.length)).toEqual([36, 26]);
    expect(outcome.calls.filter((call) => call.kind === "dedicated")).toHaveLength(50);
    const greyAnswers = [...outcome.answers.values()].filter((answer) => answer.alias === "groupe_61" || answer.alias === "groupe_62");
    expect(greyAnswers.every((answer) => answer.via === "batch" && answer.class === "autre")).toBe(true);
  });

  it("stops at the first failed or unavailable call, or an exception, without retry; the rest stays « à revoir »", async () => {
    for (const [status, reason] of [["failed", "call_failed"], ["unavailable", "decisions_unavailable"], ["throw", "exception"]] as const) {
      const { decide, seen } = fakeDecide(() => ({ value: "EU", confidence: 0.9 }), (call) => (call === 0 ? "available" : status));
      const { budget, outcome: pending } = run(page(80), { decide });
      const outcome = await pending;
      // No call is sent again; the third batch may have left with the second, never after its failure was known.
      expect(seen.length).toBeLessThanOrEqual(3);
      expect(outcome.stop).toMatchObject({ reason });
      expect(outcome.calls.slice(0, 2).map((call) => call.status)).toEqual(["available", status === "throw" ? "exception" : status]);
      expect([...outcome.answers.values()].filter((answer) => answer.class !== null)).toHaveLength(36);
      expect(budget.snapshot().calls).toBe(seen.length);
      // Every started call was finished: a new one may start.
      expect(budget.tryStart()).toBe(true);
    }
  });

  it("asks the budget before each call and stops when it refuses one", async () => {
    const { decide, seen } = fakeDecide(() => ({ value: "EU", confidence: 0.9 }));
    // 1 000 tokens per call: the third would pass 2 500.
    const { budget, outcome: pending } = run(page(100), { decide, maxTokens: 2_500 });
    const outcome = await pending;
    expect(seen).toHaveLength(2);
    expect(outcome.stop).toMatchObject({ reason: "budget_reached" });
    expect(budget.snapshot()).toMatchObject({ calls: 2, refused_starts: 1, spent_tokens: 2000 });
  });

  it("sends no call without canvas or when a render fails, and keeps the reason", async () => {
    const { decide, seen } = fakeDecide(() => ({ value: "EU", confidence: 0.9 }));
    const noCanvas = fakeRender({ sheets: async (plans) => ({ images: plans.map(() => null), issue: "canvas_unavailable", render_ms: plans.map(() => null), duration_ms: 1 }) });
    await expect(run(page(5), { decide, render: noCanvas.render }).outcome).resolves.toMatchObject({ calls: [], stop: { reason: "canvas_unavailable" }, candidates: 5 });
    const brokenLegend = fakeRender({ legend: async () => ({ image: null, issue: "render_failed", dropped_images: 0, duration_ms: 1 }) });
    await expect(run(page(5), { decide, render: brokenLegend.render }).outcome).resolves.toMatchObject({ calls: [], stop: { reason: "render_failed" } });
    const throwing = fakeRender({ sheets: async () => {
      throw new Error("Fictional render crash.");
    } });
    await expect(run(page(5), { decide, render: throwing.render }).outcome).resolves.toMatchObject({ calls: [], stop: { reason: "render_failed" } });
    expect(seen).toHaveLength(0);
  });

  it("sends no more calls than it is given, never more than the page caps, and counts the groups past them", async () => {
    const answers = (_alias: string, kind: "batch" | "dedicated"): Answer => (kind === "batch" ? { value: "autre", confidence: 0.2 } : { value: "mur", confidence: 0.7 });
    const fewer = fakeDecide(answers);
    const outcome = await run(page(100), { decide: fewer.decide, limits: { maxBatchCalls: 1, maxDedicatedCalls: 3 } }).outcome;
    expect(fewer.seen.map((call) => [call.evidence.call, call.names.length])).toEqual([["batch", 36], ["dedicated", 1], ["dedicated", 1], ["dedicated", 1]]);
    expect(outcome).toMatchObject({ candidates: 36, eligible: 100, left_out: 64 });
    const none = fakeDecide(answers);
    await expect(run(page(5), { decide: none.decide, limits: { maxBatchCalls: 0, maxDedicatedCalls: 50 } }).outcome)
      .resolves.toMatchObject({ calls: [], candidates: 0, eligible: 5, left_out: 5 });
    const more = fakeDecide(answers);
    await run(page(400), { decide: more.decide, limits: { maxBatchCalls: 99, maxDedicatedCalls: 999 } }).outcome;
    expect(more.seen.filter((call) => call.evidence.call === "batch")).toHaveLength(GROUP_DECISIONS_LIMITS.maxBatchCalls);
    expect(more.seen.filter((call) => call.evidence.call === "dedicated")).toHaveLength(GROUP_DECISIONS_LIMITS.maxDedicatedCalls);
  });

  it("neither renders nor calls for a page without candidates", async () => {
    const { decide, seen } = fakeDecide(() => ({ value: "EU", confidence: 0.9 }));
    const { render, calls } = fakeRender();
    const outcome = await run(page(0, 0), { decide, render }).outcome;
    expect(outcome).toMatchObject({ calls: [], stop: null, candidates: 0 });
    expect(seen).toHaveLength(0);
    expect(calls).toEqual({ legend: 0, sheets: [] });
  });
});

/** Answers under 0.5 to every batch question: every group is asked again alone, within the dedicated caps. */
const weak: AnswerOf = (_alias, kind) => (kind === "batch" ? { value: "autre", confidence: 0.2 } : { value: "mur", confidence: 0.7 });

/** What a page's classification gives the reading and the record, nothing of how long its calls took. */
function result(outcome: GroupDecisionsOutcome) {
  return {
    answers: [...outcome.answers.entries()], stop: outcome.stop, dedicated_left_out: outcome.dedicated_left_out,
    calls: outcome.calls.filter((call) => !call.after_stop).map((call) => [call.kind, call.questions, call.status, call.usage?.total_tokens ?? null]),
    sheets: outcome.render.sheets_ms.length,
  };
}

describe("Decisions calls of a page in bounded parallel (TI-704)", () => {
  it("keeps up to GROUP_DECISIONS_CONCURRENCY calls in flight, never more, in whatever order they end", async () => {
    expect(GROUP_DECISIONS_CONCURRENCY).toBeGreaterThan(1);
    expect(GROUP_DECISIONS_CONCURRENCY).toBeLessThanOrEqual(GROUP_DECISIONS_DEDICATED_RENDER_CHUNK);
    for (const pick of [first, last, shuffled(1), shuffled(2)]) {
      // 56 candidates: 2 batch calls, then 50 dedicated ones (6 weak answers past the dedicated caps).
      const gated = gatedDecide(weak);
      const outcome = await drive(run(page(56), { decide: gated.decide }).outcome, gated, pick);
      expect(gated.maxInFlight()).toBe(GROUP_DECISIONS_CONCURRENCY);
      expect(outcome.calls.map((call) => call.kind)).toEqual([...Array<string>(2).fill("batch"), ...Array<string>(50).fill("dedicated")]);
      expect(outcome).toMatchObject({ stop: null, dedicated_left_out: 6 });
    }
  });

  it("starts the dedicated calls only once every batch call has answered", async () => {
    const gated = gatedDecide(weak);
    const { render, calls } = fakeRender();
    // 100 candidates: 3 batch calls; the first alone, the 2 others together once it has answered.
    const pending = run(page(100), { decide: gated.decide, render }).outcome;
    await tick();
    expect(gated.calls.map((call) => call.kind)).toEqual(["batch"]);
    gated.calls[0].settle();
    await tick();
    expect(gated.calls.map((call) => call.kind)).toEqual(["batch", "batch", "batch"]);
    gated.calls[2].settle();
    await tick();
    expect(gated.calls).toHaveLength(3);
    expect(calls.sheets).toEqual([3]);
    // Held back until now: the second batch call.
    expect(gated.open().map((call) => call.index)).toEqual([1]);
    gated.calls[1].settle();
    await tick();
    expect(calls.sheets).toEqual([3, GROUP_DECISIONS_DEDICATED_RENDER_CHUNK, GROUP_DECISIONS_DEDICATED_RENDER_CHUNK]);
    expect(gated.calls.slice(3).map((call) => call.kind)).toEqual(Array<string>(GROUP_DECISIONS_CONCURRENCY).fill("dedicated"));
    await drive(pending, gated, shuffled(3));
  });

  it("renders the dedicated calls by chunks, one render at a time and one chunk ahead at most, none after a stop", async () => {
    for (const failing of [null, 2 + 3]) {
      const gated = gatedDecide(weak, { status: (call) => (call === failing ? "failed" : "available") });
      let rendering = 0;
      let overlapping = 0;
      /** Per dedicated render: the dedicated calls already started when it began. */
      const startedBefore: number[] = [];
      const { render, calls } = fakeRender({ sheets: async (plans) => {
        rendering += 1;
        overlapping = Math.max(overlapping, rendering);
        if (calls.sheets.length > 0) startedBefore.push(gated.calls.filter((call) => call.kind === "dedicated").length);
        calls.sheets.push(plans.length);
        await tick();
        rendering -= 1;
        return { images: plans.map(() => IMAGE), issue: null, render_ms: plans.map(() => 7), duration_ms: 9 };
      } });
      // The failing call, when there is one, ends first: the loop knows of it as soon as it can.
      const pick = (open: GatedCall[]) => open.find((call) => call.index === failing) ?? first(open);
      const outcome = await drive(run(page(56), { decide: gated.decide, render }).outcome, gated, pick);
      expect(overlapping).toBe(1);
      expect(calls.sheets.slice(1).every((size) => size <= GROUP_DECISIONS_DEDICATED_RENDER_CHUNK)).toBe(true);
      // The render of chunk n + 1 starts once the first call of chunk n has: at most one chunk drawn ahead.
      startedBefore.forEach((started, chunk) => expect(started).toBeGreaterThanOrEqual(chunk === 0 ? 0 : (chunk - 1) * GROUP_DECISIONS_DEDICATED_RENDER_CHUNK + 1));
      if (failing === null) {
        expect(calls.sheets).toEqual([2, 10, 10, 10, 10, 10]);
        expect(outcome.render.sheets_ms).toHaveLength(52);
      } else {
        // The fourth dedicated call fails within the first chunk: the second was drawn ahead, no other; the record
        // keeps the renders the calls used, as in a row.
        expect(calls.sheets).toEqual([2, 10, 10]);
        expect(outcome.render.sheets_ms).toHaveLength(12);
        expect(outcome.stop).toMatchObject({ reason: "call_failed" });
      }
    }
  });

  it("draws no chunk ahead once a stop is known, even while it waits for the render of the next one", async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gated = gatedDecide(weak);
    const { render, calls } = fakeRender({ sheets: async (plans) => {
      calls.sheets.push(plans.length);
      // The second dedicated chunk, drawn ahead, ends when the test says.
      if (calls.sheets.length === 3) await held;
      return { images: plans.map(() => IMAGE), issue: null, render_ms: plans.map(() => 7), duration_ms: 9 };
    } });
    const pending = run(page(56), { decide: gated.decide, render }).outcome;
    for (let turn = 0; gated.calls.every((call) => call.kind === "batch") && turn < 10; turn += 1) {
      await tick();
      for (const call of gated.open().filter((open) => open.kind === "batch")) call.settle();
    }
    await tick();
    const dedicated = () => gated.calls.filter((call) => call.kind === "dedicated");
    expect(dedicated()).toHaveLength(GROUP_DECISIONS_CONCURRENCY);
    expect(calls.sheets).toEqual([2, 10, 10]);
    // The last two calls of the first chunk start; the next one waits for the second chunk's render.
    dedicated()[0].settle();
    dedicated()[1].settle();
    dedicated()[2].settle();
    await tick();
    expect(dedicated()).toHaveLength(GROUP_DECISIONS_DEDICATED_RENDER_CHUNK);
    dedicated()[3].settle("failed");
    await tick();
    release();
    await tick();
    expect(calls.sheets).toEqual([2, 10, 10]);
    expect(dedicated()).toHaveLength(GROUP_DECISIONS_DEDICATED_RENDER_CHUNK);
    for (const call of gated.open()) call.settle();
    const outcome = await pending;
    expect(outcome.stop).toMatchObject({ reason: "call_failed" });
    expect(outcome.render.sheets_ms).toHaveLength(12);
  });

  it("reserves each call before it starts, waits for the calls in flight rather than refusing early, and refuses as in a row", async () => {
    const reserve = (budget: DecisionsTokenBudget, inFlight: number) => {
      const state = budget.snapshot();
      return state.spent_tokens + inFlight * Math.max(state.largest_call_tokens, 1_000);
    };
    // 1 000 tokens a call and 5 500 allowed: the 2 batch calls in a row (see below), then three dedicated reserves at
    // once; five calls in all, as in a row, the sixth refused.
    const tight = createDecisionsTokenBudget(5_500, 1_000);
    const reserved: number[] = [];
    const gated: Gated = gatedDecide(weak, { onStart: () => reserved.push(reserve(tight, gated.inFlight())) });
    const outcome = await drive(run(page(56), { decide: gated.decide, budget: tight }).outcome, gated, shuffled(5));
    expect(gated.maxInFlight()).toBe(3);
    expect(reserved.every((tokens) => tokens <= 5_500)).toBe(true);
    expect(outcome.stop).toMatchObject({ reason: "budget_reached" });
    expect(tight.snapshot()).toMatchObject({ calls: 5, spent_tokens: 5_000, refused_starts: 1 });

    // A first call larger than the estimate raises the reserve of the next starts.
    const roomy = createDecisionsTokenBudget(12_000, 1_000);
    const reservedRoomy: number[] = [];
    const varying: Gated = gatedDecide(weak, { tokens: (call) => (call === 0 ? 2_500 : 600), onStart: () => reservedRoomy.push(reserve(roomy, varying.inFlight())) });
    const spent = await drive(run(page(56), { decide: varying.decide, budget: roomy }).outcome, varying, shuffled(6));
    expect(reservedRoomy.every((tokens) => tokens <= 12_000)).toBe(true);
    expect(varying.maxInFlight()).toBe(3);
    expect(spent.stop).toMatchObject({ reason: "budget_reached" });
    // Refused with no call in flight, once: 2 500 + 12 × 600 spent, as 13 calls in a row.
    expect(roomy.snapshot()).toMatchObject({ calls: 13, spent_tokens: 9_700, refused_starts: 1, largest_call_tokens: 2_500 });
    expect(roomy.tryStart()).toBe(false);
  });

  it("sends the page's first batch call alone, then batch calls beside others only as the ceiling holds them, as in a row", async () => {
    // 360 candidates: 10 batch calls of 60 000 tokens under the worker's ceiling, the reserve still the 20 000
    // estimate: started all at once, 8 would spend 480 000. In a row: 6 calls (360 000), the seventh refused.
    const shapes: unknown[] = [];
    for (const pick of [first, last, shuffled(8), shuffled(9)]) {
      const budget = createDecisionsTokenBudget(400_000, 20_000);
      const gated = gatedDecide(() => ({ value: "EU", confidence: 0.9 }), { tokens: () => 60_000 });
      const pending = run(page(360), { decide: gated.decide, budget }).outcome;
      await tick();
      expect(gated.calls).toHaveLength(1);
      const outcome = await drive(pending, gated, pick);
      expect(gated.maxInFlight()).toBeGreaterThan(1);
      expect(outcome.stop).toMatchObject({ reason: "budget_reached" });
      expect(budget.snapshot()).toMatchObject({ calls: 6, spent_tokens: 360_000, refused_starts: 1 });
      shapes.push(result(outcome));
    }
    for (const other of shapes.slice(1)) expect(other).toEqual(shapes[0]);
  });

  it("keeps a margin over the first batch call for the next ones started together, which may cost a little more", async () => {
    // The first batch call 50 000 tokens, the next ones 60 000 (20 % more): reserved at the first one's size, 8 would
    // leave together and spend 470 000. In a row: 6 calls (350 000), the seventh refused.
    for (const pick of [first, shuffled(10)]) {
      const budget = createDecisionsTokenBudget(400_000, 20_000);
      const gated = gatedDecide(() => ({ value: "EU", confidence: 0.9 }), { tokens: (call) => (call === 0 ? 50_000 : 60_000) });
      const outcome = await drive(run(page(360), { decide: gated.decide, budget }).outcome, gated, pick);
      expect(gated.maxInFlight()).toBeGreaterThan(1);
      expect(outcome.stop).toMatchObject({ reason: "budget_reached" });
      expect(budget.snapshot()).toMatchObject({ calls: 6, spent_tokens: 350_000, refused_starts: 1 });
    }
  });

  it("starts no call more than GROUP_DECISIONS_CONCURRENCY - 1 places after the oldest in flight: a slow failing call wastes few", async () => {
    // 360 candidates, 10 batch calls: the second hangs while the others answer, then fails.
    const gated = gatedDecide(() => ({ value: "EU", confidence: 0.9 }));
    const pending = run(page(360), { decide: gated.decide }).outcome;
    await tick();
    gated.calls[0].settle();
    await tick();
    for (let turn = 0; turn < 20; turn += 1) {
      const answering = gated.open().filter((call) => call.index !== 1);
      if (answering.length === 0) break;
      for (const call of answering) call.settle();
      await tick();
    }
    expect(gated.calls.map((call) => call.index)).toEqual(Array.from({ length: GROUP_DECISIONS_CONCURRENCY + 1 }, (_, index) => index));
    gated.calls[1].settle("failed");
    const outcome = await pending;
    expect(outcome.stop).toMatchObject({ reason: "call_failed" });
    expect(outcome.calls.filter((call) => call.after_stop)).toHaveLength(GROUP_DECISIONS_CONCURRENCY - 1);
  });

  it("gives the time spent with calls in flight, not the renders between them", async () => {
    vi.useFakeTimers();
    try {
      // 5 candidates: a batch call of 1 s, a dedicated render of 5 s, then 5 dedicated calls together of 1 s.
      const decide: GroupDecisionsDecide = async (input) => {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        return resultOf(input, "available", weak);
      };
      let drawings = 0;
      const { render } = fakeRender({ sheets: async (plans) => {
        // The second drawing: the dedicated renders.
        drawings += 1;
        if (drawings === 2) await new Promise((resolve) => setTimeout(resolve, 5_000));
        return { images: plans.map(() => IMAGE), issue: null, render_ms: plans.map(() => 7), duration_ms: 9 };
      } });
      const started = Date.now();
      const pending = run(page(5), { decide, render, clock: () => Date.now() }).outcome;
      await vi.runAllTimersAsync();
      const outcome = await pending;
      expect(Date.now() - started).toBe(7_000);
      expect(outcome.calls).toHaveLength(6);
      expect(outcome.calls_ms).toBe(2_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts no call once one has failed; the calls in flight finish, their answers unused, whichever ends first", async () => {
    for (const [status, reason] of [["failed", "call_failed"], ["unavailable", "decisions_unavailable"], ["throw", "exception"]] as const) {
      for (const failingFirst of [true, false]) {
        const gated = gatedDecide(weak);
        const budget = createDecisionsTokenBudget(10_000_000, 1_000);
        // 80 candidates: 3 batch calls, the first alone, then 2 in flight, then dedicated ones if nothing stops.
        const pending = run(page(80), { decide: gated.decide, budget }).outcome;
        await tick();
        gated.calls[0].settle();
        await tick();
        const [, failing, after] = gated.calls;
        expect(gated.calls).toHaveLength(3);
        if (failingFirst) {
          failing.settle(status);
          await tick();
          after.settle();
        } else {
          after.settle();
          await tick();
          failing.settle(status);
        }
        const outcome = await pending;
        expect(gated.calls).toHaveLength(3);
        expect(outcome.stop).toMatchObject({ reason });
        expect(outcome.calls.map((call) => [call.status, call.after_stop ?? false]))
          .toEqual([["available", false], [status === "throw" ? "exception" : status, false], ["available", true]]);
        // The first batch's answers only, as when the calls went one after the other.
        expect([...outcome.answers.values()].map((answer) => answer.alias)).toEqual(Array.from({ length: 36 }, (_, rank) => `groupe_${String(rank + 1).padStart(2, "0")}`));
        expect(budget.snapshot()).toMatchObject({ calls: 3 });
        expect(budget.tryStart()).toBe(true);
      }
    }
    // In the dedicated calls: the third fails first, none starts after it, the others finish unused.
    const gated = gatedDecide(weak);
    const pending = run(page(56), { decide: gated.decide }).outcome;
    await tick();
    gated.calls[0].settle();
    await tick();
    gated.calls[1].settle();
    await tick();
    expect(gated.calls).toHaveLength(2 + GROUP_DECISIONS_CONCURRENCY);
    gated.calls[2 + 2].settle("failed");
    await tick();
    expect(gated.calls).toHaveLength(2 + GROUP_DECISIONS_CONCURRENCY);
    for (const call of gated.open().reverse()) call.settle();
    const outcome = await pending;
    expect(outcome.stop).toMatchObject({ reason: "call_failed" });
    expect([...outcome.answers.values()].filter((answer) => answer.via === "dedicated").map((answer) => answer.alias)).toEqual(["groupe_01", "groupe_02"]);
    expect(outcome.calls.filter((call) => call.after_stop)).toHaveLength(GROUP_DECISIONS_CONCURRENCY - 3);
  });

  it("waits for the calls in flight when the job's check fails, starts none after it, and leaves with its error", async () => {
    // The second call in flight fails too: the job's check still decides.
    const gated = gatedDecide(weak, { status: (call) => (call === 1 ? "failed" : "available") });
    const budget = createDecisionsTokenBudget(10_000_000, 1_000);
    const lost = new Error("Bail de traitement perdu.");
    let checks = 0;
    // 200 candidates: 6 batch calls, the first alone; the fourth check fails with the second and third in flight.
    const pending = run(page(200), { decide: gated.decide, budget, beforeCall: async () => {
      checks += 1;
      if (checks === 4) throw lost;
    } }).outcome;
    let ended = false;
    pending.then(() => { ended = true; }, () => { ended = true; });
    await tick();
    expect(gated.calls).toHaveLength(1);
    gated.calls[0].settle();
    await tick();
    expect(gated.calls).toHaveLength(3);
    expect(ended).toBe(false);
    gated.calls[1].settle();
    await tick();
    expect(ended).toBe(false);
    gated.calls[2].settle();
    await expect(pending).rejects.toBe(lost);
    expect(gated.calls).toHaveLength(3);
    expect(checks).toBe(4);
    expect(budget.snapshot()).toMatchObject({ calls: 3 });
    expect(budget.tryStart()).toBe(true);
  });

  it("gives the same answers, order, provenance and stop whatever order the calls end in", async () => {
    const answer: AnswerOf = (alias, kind) => {
      const rank = aliasNumber(alias);
      if (kind === "dedicated") return rank % 5 === 0 ? "refused" : { value: rank % 2 ? "EF" : "mur", confidence: 0.6 + (rank % 3) / 10 };
      return rank % 4 === 0 ? "refused" : { value: "EU", confidence: rank % 3 === 0 ? 0.3 : 0.9 };
    };
    // 100 candidates: 3 batch calls; 50 groups refused or under 0.5, asked again alone; the sixth dedicated one fails.
    for (const failing of [null, 3 + 5]) {
      const results: ReturnType<typeof result>[] = [];
      for (const pick of [first, last, shuffled(7), shuffled(11), shuffled(13)]) {
        const gated = gatedDecide(answer, { status: (call) => (call === failing ? "failed" : "available") });
        const outcome = await drive(run(page(100), { decide: gated.decide }).outcome, gated, pick);
        results.push(result(outcome));
        // Every call sent after the failed one is logged after it, its answers unused.
        const stopAt = outcome.calls.findIndex((call) => call.status === "failed");
        expect(outcome.calls.every((call, index) => (call.after_stop ?? false) === (stopAt >= 0 && index > stopAt))).toBe(true);
      }
      for (const other of results.slice(1)) expect(other).toEqual(results[0]);
      const dedicated = results[0].answers.filter(([, entry]) => entry.via === "dedicated");
      expect(dedicated).toHaveLength(failing === null ? 50 : 5);
      expect(results[0].calls).toHaveLength(failing === null ? 53 : 9);
      expect(results[0].stop).toEqual(failing === null ? null : expect.objectContaining({ reason: "call_failed" }));
    }
  });

  it("sends the calls of the 5/11 page with the most calls in a fifth of their time in a row", async () => {
    // Real latencies (ms) of its 2 batch then 50 dedicated calls on the 5/11 bench run, in the order they were sent.
    const latencies = [1881, 1258, 745, 845, 806, 678, 671, 784, 692, 775, 726, 826, 846, 769, 673, 719, 761, 698, 794, 564, 836,
      703, 834, 546, 593, 688, 586, 720, 700, 693, 676, 923, 664, 625, 668, 530, 659, 673, 520, 666, 685, 676, 641, 585, 820, 665, 571,
      870, 759, 745, 792, 750];
    vi.useFakeTimers();
    try {
      let sent = 0;
      const decide: GroupDecisionsDecide = async (input) => {
        const latency = latencies[sent];
        sent += 1;
        await new Promise((resolve) => setTimeout(resolve, latency));
        return resultOf(input, "available", weak);
      };
      const started = Date.now();
      const pending = run(page(56), { decide, clock: () => Date.now() }).outcome;
      await vi.runAllTimersAsync();
      const outcome = await pending;
      const elapsed = Date.now() - started;
      expect(outcome.calls.map((call) => call.latency_ms)).toEqual(latencies);
      expect(latencies.reduce((total, latency) => total + latency, 0)).toBe(38_573);
      // 8.1 s at 8 in flight, with the latencies of calls sent alone: the 2 batch calls one after the other, then the
      // dedicated ones 8 at a time, none further than 7 places from the oldest in flight.
      expect(elapsed).toBeLessThanOrEqual(8_200);
      // The time the page spent in its calls, not their sum.
      expect(outcome.calls_ms).toBe(elapsed);
    } finally {
      vi.useRealTimers();
    }
  });
});
