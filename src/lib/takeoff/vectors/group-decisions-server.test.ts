import { describe, expect, it, vi } from "vitest";

import type { OpenAiDecisionsResult } from "@/lib/ai/decisions";
import { createDecisionsTokenBudget, type DecisionsTokenBudget } from "@/lib/ai/decisions-budget";
import { isMeasuredNetwork } from "@/lib/takeoff/vectors/classify";
import type { VectorGroupKey, VectorPageExtraction, VectorPath, VectorText } from "@/lib/takeoff/vectors/extraction";
import { GROUP_DECISIONS_DEVELOPER, GROUP_DECISIONS_LIMITS } from "@/lib/takeoff/vectors/group-decisions";
import {
  callBatches,
  classifyVectorGroups,
  decisionsOfOutcome,
  GROUP_DECISIONS_CALL_IMAGE_BYTES,
  GROUP_DECISIONS_CONCURRENCY,
  type GroupDecisionsCallLimits,
  type GroupDecisionsDecide,
  type GroupDecisionsOutcome,
  type GroupDecisionsRender,
} from "@/lib/takeoff/vectors/group-decisions-server";
import type { EvidenceImagePlan } from "@/lib/takeoff/vectors/group-evidence-images";
import type { GroupEvidenceImages, GroupImage } from "@/lib/takeoff/vectors/group-evidence-render-server";
import { readVectorPage } from "@/lib/takeoff/vectors/pipeline";

// Ways the classification of a page's vector groups (TI-662 L3c, TI-704 v2,
// group-decisions-server.ts) could spend, retry or misapply, written before
// the code. Decisions and the render are fakes (no network, no child
// process); pages are fictional hand-built extractions.
// v2 (TI-704):
// - a group the rules class (same colour as a network) is asked anyway, or
//   its class is lost when a call fails or no image can be drawn;
// - more than 20 questions per call or 10 calls per page; a question without
//   its own image, an image not sent at « low », the legend not shared, the
//   developer message missing;
// - the page's images drawn per call or per group (the PDF analysed again),
//   or drawn for groups that are not asked;
// - an answer at a margin of 0.5 not measured, or one at 0.49 measured; a
//   « hors_liste » answer given a class instead of its proposal;
// - the propagation of a colour not run after the calls, or not when they
//   stop;
// - the call log keeps the evidence or images (the call record must stay
//   small and hold nothing but counts, statuses, usage and timings);
// - the calls a document has left (worker, TI-662 L3d) are passed over, or
//   larger ones lift the page caps.
// In bounded parallel (TI-704), races a browser cannot force, with a fake
// Decisions whose calls end when the test says, in the order it chooses:
// - more than GROUP_DECISIONS_CONCURRENCY calls in flight, or the slots left
//   empty (the calls still one after the other);
// - calls started together past the token ceiling (one check for several
//   starts, or calls reserved at the estimate before the page's first call has
//   answered), or a refusal while calls in flight would have made room;
// - the summed latencies of calls in parallel (or the render before them)
//   given for the time they took;
// - a slow call that fails letting the rest leave meanwhile, all of it spent
//   for nothing (more than GROUP_DECISIONS_CONCURRENCY - 1 calls after a stop);
// - a new call after a failed one or a failed job check is known, the answers
//   of a call after the failed one applied, or the job check's error lost or
//   thrown while calls are still in flight;
// - answers, their order, their provenance or the stop that depend on the
//   order the calls end in.

const A3 = { width: 1190.55, height: 841.89 };
const OWNER = { userId: "user-fixture", tenantId: "tenant-fixture" };
const CONTEXT = { tenantId: "tenant-fixture", projectId: "bench:a-plan-01", preparationFingerprint: "f".repeat(64) };
const IMAGE: GroupImage = { mimeType: "image/jpeg", data: "AAAA", width: 10, height: 10, bytes: 3 };
const hex = (value: number) => value.toString(16).padStart(2, "0");

type Extra = { strokes?: Array<{ key: VectorGroupKey; points: number[] }>; texts?: VectorText[]; layers?: Array<{ id: string; name: string }> };

/**
 * `count` groups of distinct colours (no colour shared, so nothing propagates), the first the longest; `grey` more grey
 * ones after them, which the filter keeps out; `extra` strokes, texts and layers.
 */
function page(count: number, grey = 0, extra: Extra = {}): VectorPageExtraction {
  const groups: VectorGroupKey[] = [];
  const paths: VectorPath[] = [];
  const coordinates: number[] = [];
  for (let index = 0; index < count + grey; index += 1) {
    const color = index < count ? `#${hex(30 + (index % 200))}${hex(40 * Math.floor(index / 200))}ff` : "#808080";
    groups.push({ layer: null, color, width: 0.01 * (index + 1), dash: null });
    paths.push({ group: index, start: coordinates.length / 2, count: 2, closed: false });
    coordinates.push(100, 10 + 1.5 * index, 1100 - index, 10 + 1.5 * index);
  }
  for (const stroke of extra.strokes ?? []) {
    let group = groups.findIndex((key) => JSON.stringify(key) === JSON.stringify(stroke.key));
    if (group < 0) group = groups.push(stroke.key) - 1;
    paths.push({ group, start: coordinates.length / 2, count: stroke.points.length / 2, closed: false });
    coordinates.push(...stroke.points);
  }
  return {
    page: 1, pages: 1, width: A3.width, height: A3.height, userUnit: 1, rotate: 0,
    layers: (extra.layers ?? []).map((layer) => ({ ...layer, visible: true })), groups, texts: extra.texts ?? [], paths,
    points: Float32Array.from(coordinates),
    counts: { operators: 0, strokePaths: paths.length, fillPaths: 0, clipPaths: 0, images: 0, imageCoverage: 0 },
    timings: { operators_ms: 0, walk_ms: 0, text_ms: 0, total_ms: 0 }, memory: { max_rss_kb: 0, heap_used_mb: 0 },
  };
}

type Draw = (plan: Omit<EvidenceImagePlan, "page">) => Promise<GroupEvidenceImages>;

/** A drawing session fake: counts the sessions started and cancelled, records each plan, draws every image unless `override`. */
function fakeRender(override?: Draw) {
  const plans: Array<{ legends: number; groups: string[] }> = [];
  const sessions = { started: 0, cancelled: 0 };
  const render: GroupDecisionsRender = () => {
    sessions.started += 1;
    return {
      draw: async (plan) => {
        plans.push({ legends: plan.legends.length, groups: plan.groups.map((group) => group.alias) });
        if (override) return override(plan);
        return { legends: plan.legends.map(() => IMAGE), groups: plan.groups.map(() => IMAGE), issue: null, dropped_images: 0,
          render_ms: { page: 30, legends: plan.legends.map(() => 5), groups: plan.groups.map(() => 7) }, duration_ms: 40 };
      },
      cancel: () => {
        sessions.cancelled += 1;
      },
    };
  };
  return { render, plans, sessions };
}

/** A group's answer: a value at a margin (its probability (1 + margin) / 2, the rest on another value), or none. */
type Answer = { value: string; margin: number } | "refused" | "missing";
type AnswerOf = (alias: string) => Answer;
type Status = OpenAiDecisionsResult["status"] | "throw";
const weak: AnswerOf = () => ({ value: "EU", margin: 0.3 });

/** What a fake Decisions returns for `input`: `answer(alias)` per question when the call answers, `tokens` used. */
function resultOf(input: Parameters<GroupDecisionsDecide>[0], outcome: OpenAiDecisionsResult["status"], answer: AnswerOf, tokens = 1000): OpenAiDecisionsResult {
  const answers = input.questions.map((question) => {
    const given = outcome === "available" || outcome === "partial" ? answer(question.name) : "missing";
    if (given === "refused" || given === "missing") return { name: question.name, type: "choice" as const, status: given, value: null, confidence: null };
    const other = given.value === "fond" ? "symbole" : "fond";
    return { name: question.name, type: "choice" as const, status: "answered" as const, value: given.value, confidence: given.margin,
      probabilities: [{ value: given.value, probability: (1 + given.margin) / 2 }, { value: other, probability: (1 - given.margin) / 2 }] };
  });
  return {
    status: outcome, capability: { status: "available", model: "gpt-6-luna", billing: "separate_api", message: "" }, message: `Fictional ${outcome}.`,
    answers,
    provenance: { tenant_id: OWNER.tenantId, project_id: CONTEXT.projectId, preparation_fingerprint: CONTEXT.preparationFingerprint,
      request_fingerprint: "r", model: "gpt-6-luna", requested_at: "2026-11-03T10:00:00.000Z",
      usage: outcome === "failed" || outcome === "unavailable" ? null : { input_tokens: tokens - 100, output_tokens: 100, total_tokens: tokens } },
  };
}

/** A Decisions fake: `answer(alias)` per question; every call recorded with what it was sent. */
function fakeDecide(answer: AnswerOf, status: (call: number) => Status = () => "available") {
  const seen: Array<Parameters<GroupDecisionsDecide>[0]> = [];
  const decide: GroupDecisionsDecide = async (input) => {
    const call = seen.length;
    seen.push(input);
    const outcome = status(call);
    if (outcome === "throw") throw new Error("Le contexte Decisions est trop volumineux.");
    return resultOf(input, outcome, answer);
  };
  return { decide, seen };
}

type GatedCall = { index: number; names: string[]; settled: boolean; settle: (status?: Status) => void };

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
      index, names: input.questions.map((question) => question.name), settled: false,
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
/** Lets every promise that can move move (the loop, the fake render), before the test settles the next call. */
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
  return { budget, reading, outcome: classifyVectorGroups({
    bytes: new Uint8Array([37, 80, 68, 70]), extraction, reading, owner: OWNER, context: CONTEXT, budget,
    decide: options.decide, render: options.render ?? fakeRender().render, limits: options.limits, beforeCall: options.beforeCall,
    clock: options.clock ?? (() => 0),
  }) };
}

const aliasNumber = (alias: string) => Number(alias.slice("groupe_".length));

/** What a page's classification gives the reading and the record, in its order, nothing of how long its calls took. */
function result(outcome: GroupDecisionsOutcome) {
  return {
    answers: [...outcome.answers.entries()], stop: outcome.stop, ruled: outcome.ruled,
    calls: outcome.calls.filter((call) => !call.after_stop).map((call) => [call.kind, call.questions, call.status, call.usage?.total_tokens ?? null]),
  };
}

/** A layer named as a network (EF, blue), and a blue stroke outside it at another width: the same colour as that network. */
const SAME_COLOUR: Extra = {
  layers: [{ id: "L1", name: "RES_EF" }],
  strokes: [{ key: { layer: "L1", color: "#0000ff", width: 0.5, dash: null }, points: [100, 700, 1000, 700] },
    { key: { layer: null, color: "#0000ff", width: 1.2, dash: null }, points: [100, 760, 1000, 760] }],
};

describe("classification of a page (group-decisions-server.ts classifyVectorGroups, TI-704 v2)", () => {
  it("classes by the rules first, asks the others 20 per call with their own image and the developer message, and draws them once", async () => {
    const { decide, seen } = fakeDecide(() => ({ value: "EU", margin: 0.9 }));
    const { render, plans, sessions } = fakeRender();
    const outcome = await run(page(25, 3, SAME_COLOUR), { decide, render }).outcome;
    const sameColour = [...outcome.answers].find(([id]) => id === "c:#0000ff|w:1.2|d:")?.[1];
    expect(sameColour).toMatchObject({ class: "EF", confidence: null, status: "answered", via: "rule", rule: "same_colour" });
    expect(outcome.ruled).toEqual({ same_colour: 1, band: 0, propagated: 0 });
    expect(outcome.filtered).toEqual({ grey: 3 });
    // One drawing session for the page, started before its evidence, of the 25 groups asked only (never the one the rules class).
    expect(sessions).toEqual({ started: 1, cancelled: 0 });
    expect(plans).toEqual([{ legends: 0, groups: Array.from({ length: 25 }, (_, rank) => `groupe_${String(rank + 1).padStart(2, "0")}`) }]);
    expect(seen.map((call) => call.questions.length)).toEqual([20, 5]);
    for (const call of seen) {
      expect(call.developer).toBe(GROUP_DECISIONS_DEVELOPER);
      expect(call.images).toEqual([]);
      for (const question of call.questions) {
        if (typeof question.instructions === "string") throw new Error("parts expected");
        expect(question.instructions.map((part) => part.type)).toEqual(["text", "json", "image"]);
        expect(question.instructions[2]).toEqual({ type: "image", image: { mimeType: "image/jpeg", data: "AAAA", detail: "low" } });
      }
    }
    expect(outcome.calls.map((call) => ({ ...call, latency_ms: 0 }))).toEqual([
      { kind: "batch", questions: 20, status: "available", usage: { input_tokens: 900, output_tokens: 100, total_tokens: 1000 }, latency_ms: 0, render_ms: null },
      { kind: "batch", questions: 5, status: "available", usage: { input_tokens: 900, output_tokens: 100, total_tokens: 1000 }, latency_ms: 0, render_ms: null },
    ]);
    // The call log holds counts, statuses, usage and timings only.
    expect(JSON.stringify(outcome.calls)).not.toContain("AAAA");
    expect(outcome.render).toEqual({ page_ms: 30, legends_ms: [], groups_ms: Array.from({ length: 25 }, () => 7), dropped_images: 0 });
  });

  it("shares the legend blocks' images at « low » with every call of the page", async () => {
    const legend = ["AIR NEUF", "AIR EXTRAIT"].map((str, row) => ({ str, x: 40, y: 560 + 24 * row, width: 40, height: 8, angle: 0 }));
    const samples = legend.map((entry, row) => ({ key: { layer: null, color: row === 0 ? "#ff8000" : "#00aa00", width: 0.5, dash: null },
      points: [entry.x + entry.width + 10, entry.y - 4, entry.x + entry.width + 50, entry.y - 4] }));
    const { decide, seen } = fakeDecide(() => ({ value: "EU", margin: 0.9 }));
    const { render, plans } = fakeRender();
    await run(page(25, 0, { texts: [{ str: "LEGENDE", x: 40, y: 540, width: 40, height: 8, angle: 0 }, ...legend], strokes: samples }), { decide, render }).outcome;
    expect(plans[0].legends).toBe(1);
    expect(seen.every((call) => JSON.stringify(call.images) === JSON.stringify([{ mimeType: "image/jpeg", data: "AAAA", detail: "low" }]))).toBe(true);
    expect(seen[0].evidence).toMatchObject({ images_de_la_demande: "Les images jointes à la demande sont les blocs de légende du plan, rendus avec leurs textes." });
  });

  it("measures a class from a margin of 0.5, keeps one at 0.49 « à revoir », and a « hors_liste » without class with its proposal", async () => {
    const answers: Record<string, Answer> = { groupe_01: { value: "EU", margin: 0.5 }, groupe_02: { value: "EU", margin: 0.49 }, groupe_03: { value: "hors_liste", margin: 0.8 } };
    const extraction = page(3, 0, { texts: [{ str: "E-M. DN 20", x: 300, y: 5, width: 50, height: 6, angle: 0 }] });
    const { decide } = fakeDecide((alias) => answers[alias]);
    const { outcome: pending, reading: keywords } = run(extraction, { decide });
    const outcome = await pending;
    const reading = readVectorPage(extraction, { decisions: decisionsOfOutcome(outcome), clock: () => 0 });
    const byAlias = (alias: string) => reading.groups.find((group) => group.id === [...outcome.answers].find(([, answer]) => answer.alias === alias)?.[0])!;
    expect([isMeasuredNetwork(byAlias("groupe_01")), isMeasuredNetwork(byAlias("groupe_02"))]).toEqual([true, false]);
    expect(byAlias("groupe_02")).toMatchObject({ class: "EU", source: "decisions", confidence: 0.49 });
    expect(byAlias("groupe_03")).toMatchObject({ class: null, source: null, proposal: expect.stringMatching(/^canalisation hors nomenclature/) });
    expect(reading.counts.to_review).toBe(keywords.counts.to_review - 1);
  });

  it("propagates an accepted network to an open group of its colour after the calls, and the rules' class when a call fails", async () => {
    // Two widths of one red: the model accepts the first, the second is open (« inconnu ») until the propagation.
    const red = (width: number, y: number) => ({ key: { layer: null, color: "#cc0000", width, dash: null }, points: [100, y, 1000, y] });
    const extraction = page(0, 0, { strokes: [red(0.5, 300), red(0.7, 340)] });
    const { decide } = fakeDecide((alias) => (alias === "groupe_01" ? { value: "EU", margin: 0.8 } : { value: "inconnu", margin: 0.9 }));
    const outcome = await run(extraction, { decide }).outcome;
    expect([...outcome.answers.values()].map((answer) => [answer.alias, answer.class, answer.via, answer.rule ?? null]))
      .toEqual([["groupe_01", "EU", "batch", null], ["groupe_02", "EU", "rule", "propagated"]]);
    expect(outcome.ruled.propagated).toBe(1);
    // A failed call: the rules' class stays and still propagates to the same colour at a third width.
    const failing = fakeDecide(weak, () => "failed");
    const ruled = await run(page(2, 0, { ...SAME_COLOUR, strokes: [...SAME_COLOUR.strokes!,
      { key: { layer: null, color: "#0000ff", width: 2, dash: null }, points: [100, 800, 1000, 800] }] }), { decide: failing.decide }).outcome;
    expect(ruled.stop).toMatchObject({ reason: "call_failed" });
    expect(decisionsOfOutcome(ruled)).toEqual(new Map([["c:#0000ff|w:1.2|d:", { class: "EF", confidence: null, source: "rule" }],
      ["c:#0000ff|w:2|d:", { class: "EF", confidence: null, source: "rule" }]]));
  });

  it("sends no call without canvas or when a drawing fails, keeps the rules' classes and the reason", async () => {
    for (const [issue, reason] of [["canvas_unavailable", "canvas_unavailable"], ["render_failed", "render_failed"], ["timeout", "render_failed"]] as const) {
      const { decide, seen } = fakeDecide(weak);
      const { render } = fakeRender(async (plan) => ({ legends: plan.legends.map(() => null), groups: plan.groups.map(() => null), issue,
        dropped_images: 0, render_ms: { page: null, legends: [], groups: [] }, duration_ms: 1 }));
      const outcome = await run(page(3, 0, SAME_COLOUR), { decide, render }).outcome;
      expect(seen).toHaveLength(0);
      expect(outcome.stop).toMatchObject({ reason });
      expect(decisionsOfOutcome(outcome)).toEqual(new Map([["c:#0000ff|w:1.2|d:", { class: "EF", confidence: null, source: "rule" }]]));
    }
    // A drawing that throws, or misses one image, stops the page the same way.
    const crashing: GroupDecisionsRender = () => { throw new Error("child crashed"); };
    for (const render of [crashing, fakeRender(async () => { throw new Error("child crashed"); }).render,
      fakeRender(async (plan) => ({ legends: [], groups: plan.groups.map((_, index) => (index === 1 ? null : IMAGE)),
        issue: null, dropped_images: 0, render_ms: { page: 1, legends: [], groups: [] }, duration_ms: 1 })).render]) {
      const { decide, seen } = fakeDecide(weak);
      expect((await run(page(3), { decide, render }).outcome).stop).toMatchObject({ reason: "render_failed" });
      expect(seen).toHaveLength(0);
    }
  });

  it("sends no more calls than it is given, never more than 10 per page, and counts the groups past them", async () => {
    expect(GROUP_DECISIONS_LIMITS).toMatchObject({ batchSize: 20, maxBatchCalls: 10 });
    const all = fakeDecide(weak);
    const capped = await run(page(230), { decide: all.decide, limits: { maxBatchCalls: 50 } }).outcome;
    expect(all.seen).toHaveLength(10);
    expect(capped).toMatchObject({ candidates: 230, left_out: 30 });
    const given = fakeDecide(weak);
    const few = await run(page(50), { decide: given.decide, limits: { maxBatchCalls: 1 } }).outcome;
    expect(given.seen).toHaveLength(1);
    expect(few.left_out).toBe(30);
    const none = fakeDecide(weak);
    const { render, plans, sessions } = fakeRender();
    expect((await run(page(5, 0, SAME_COLOUR), { decide: none.decide, render, limits: { maxBatchCalls: 0 } }).outcome))
      .toMatchObject({ left_out: 5, ruled: { same_colour: 1 }, calls: [] });
    expect([none.seen.length, plans.length, sessions.started]).toEqual([0, 0, 0]);
  });

  it("neither draws nor calls for a page without candidates, and cancels the page's drawing once the rules class them all", async () => {
    for (const [extraction, started] of [[page(0, 4), 0], [{ ...page(3), counts: { ...page(3).counts, imageCoverage: 0.95 } }, 0], [page(0, 0, SAME_COLOUR), 1]] as const) {
      const { decide, seen } = fakeDecide(weak);
      const { render, plans, sessions } = fakeRender();
      const outcome = await run(extraction, { decide, render }).outcome;
      expect([seen.length, plans.length, outcome.calls_ms]).toEqual([0, 0, null]);
      expect(sessions).toEqual({ started, cancelled: started });
    }
  });

  it("stops at the first failed or unavailable call, or an exception, without retry; the rest stays « à revoir »", async () => {
    for (const [status, reason] of [["failed", "call_failed"], ["unavailable", "decisions_unavailable"], ["throw", "exception"]] as const) {
      const { decide, seen } = fakeDecide(weak, () => status);
      const outcome = await run(page(50), { decide }).outcome;
      expect(seen).toHaveLength(1);
      expect(outcome.stop).toMatchObject({ reason });
      expect(outcome.answers.size).toBe(0);
    }
  });

  it("splits a call whose images pass 10 MB with the legend's, never a call past the adapter's bound (review of the PR)", async () => {
    expect(GROUP_DECISIONS_CALL_IMAGE_BYTES).toBe(10 * 1024 * 1024);
    const mb = 1024 * 1024;
    // 25 groups of 1 MB of base64, 3 MB of legend: 7 per call, the last 4.
    expect(callBatches(Array.from({ length: 25 }, (_, index) => index), () => mb, 3 * mb).map((batch) => batch.length)).toEqual([7, 7, 7, 4]);
    // Small images: 20 per call at most; one image past the bound alone still makes its call.
    expect(callBatches(Array.from({ length: 45 }, (_, index) => index), () => 1000, 0).map((batch) => batch.length)).toEqual([20, 20, 5]);
    expect(callBatches([1, 2], () => 11 * mb, 0)).toEqual([[1], [2]]);
    // In the classification: 30 groups of 1 MB images, 3 calls of 10 instead of 2 of 20 and 10.
    const { decide, seen } = fakeDecide(() => ({ value: "EU", margin: 0.9 }));
    const big = { ...IMAGE, data: "A".repeat(mb) };
    const { render } = fakeRender(async (plan) => ({ legends: plan.legends.map(() => big), groups: plan.groups.map(() => big), issue: null, dropped_images: 0,
      render_ms: { page: 1, legends: [], groups: plan.groups.map(() => 1) }, duration_ms: 1 }));
    await run(page(30), { decide, render }).outcome;
    expect(seen.map((call) => call.questions.length)).toEqual([10, 10, 10]);
  });

  it("asks the budget before each call and stops when it refuses one", async () => {
    const { decide, seen } = fakeDecide(weak);
    const budget = createDecisionsTokenBudget(2_500, 1_000);
    const outcome = await run(page(100), { decide, budget }).outcome;
    expect(seen).toHaveLength(2);
    expect(outcome.stop).toMatchObject({ reason: "budget_reached" });
    expect(budget.snapshot()).toMatchObject({ calls: 2, spent_tokens: 2_000, refused_starts: 1 });
  });
});

describe("Decisions calls of a page in bounded parallel (TI-704)", () => {
  it("keeps up to GROUP_DECISIONS_CONCURRENCY calls in flight, never more, in whatever order they end", async () => {
    expect(GROUP_DECISIONS_CONCURRENCY).toBeGreaterThan(1);
    for (const pick of [first, last, shuffled(1), shuffled(2)]) {
      // 200 candidates: 10 calls, the first alone.
      const gated = gatedDecide(weak);
      const outcome = await drive(run(page(200), { decide: gated.decide }).outcome, gated, pick);
      expect(gated.maxInFlight()).toBe(GROUP_DECISIONS_CONCURRENCY);
      expect(outcome.calls).toHaveLength(10);
      expect(outcome.stop).toBeNull();
    }
  });

  it("reserves each call before it starts, waits for the calls in flight rather than refusing early, and refuses as in a row", async () => {
    const reserve = (budget: DecisionsTokenBudget, inFlight: number) => {
      const state = budget.snapshot();
      return state.spent_tokens + inFlight * Math.max(state.largest_call_tokens, 1_000);
    };
    // 1 000 tokens a call and 5 500 allowed: the first alone, then reserves at the margin; five calls in all, the sixth refused.
    const tight = createDecisionsTokenBudget(5_500, 1_000);
    const reserved: number[] = [];
    const gated: Gated = gatedDecide(weak, { onStart: () => reserved.push(reserve(tight, gated.inFlight())) });
    const outcome = await drive(run(page(200), { decide: gated.decide, budget: tight }).outcome, gated, shuffled(5));
    expect(gated.maxInFlight()).toBeGreaterThan(1);
    expect(reserved.every((tokens) => tokens <= 5_500)).toBe(true);
    expect(outcome.stop).toMatchObject({ reason: "budget_reached" });
    expect(tight.snapshot()).toMatchObject({ calls: 5, spent_tokens: 5_000, refused_starts: 1 });
  });

  it("sends the page's first call alone, then calls beside others only as the ceiling holds them, as in a row", async () => {
    // 200 candidates: 10 calls of 60 000 tokens under the worker's ceiling, the reserve still the 20 000 estimate:
    // started all at once, 8 would spend 480 000. In a row: 6 calls (360 000), the seventh refused.
    const shapes: unknown[] = [];
    for (const pick of [first, last, shuffled(8), shuffled(9)]) {
      const budget = createDecisionsTokenBudget(400_000, 20_000);
      const gated = gatedDecide(() => ({ value: "EU", margin: 0.9 }), { tokens: () => 60_000 });
      const pending = run(page(200), { decide: gated.decide, budget }).outcome;
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

  it("starts no call more than GROUP_DECISIONS_CONCURRENCY - 1 places after the oldest in flight: a slow failing call wastes few", async () => {
    // 200 candidates, 10 calls: the second hangs while the others answer, then fails.
    const gated = gatedDecide(() => ({ value: "EU", margin: 0.9 }));
    const pending = run(page(200), { decide: gated.decide }).outcome;
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

  it("gives the time spent with calls in flight, not the drawing before them", async () => {
    vi.useFakeTimers();
    try {
      // 60 candidates: a drawing of 5 s, then 3 calls of 1 s, the first alone and the two others together.
      const decide: GroupDecisionsDecide = async (input) => {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        return resultOf(input, "available", weak);
      };
      const { render } = fakeRender(async (plan) => {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        return { legends: plan.legends.map(() => IMAGE), groups: plan.groups.map(() => IMAGE), issue: null, dropped_images: 0,
          render_ms: { page: 5_000, legends: [], groups: plan.groups.map(() => 1) }, duration_ms: 5_000 };
      });
      const started = Date.now();
      const pending = run(page(60), { decide, render, clock: () => Date.now() }).outcome;
      await vi.runAllTimersAsync();
      const outcome = await pending;
      expect(Date.now() - started).toBe(7_000);
      expect(outcome.calls).toHaveLength(3);
      expect(outcome.calls_ms).toBe(2_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts no call once one has failed; the calls in flight finish, their answers unused, whichever ends first", async () => {
    for (const [status, reason] of [["failed", "call_failed"], ["unavailable", "decisions_unavailable"], ["throw", "exception"]] as const) {
      for (const failingFirst of [true, false]) {
        const gated = gatedDecide(() => ({ value: "EU", margin: 0.9 }));
        const budget = createDecisionsTokenBudget(10_000_000, 1_000);
        // 60 candidates: 3 calls, the first alone, then 2 in flight.
        const pending = run(page(60), { decide: gated.decide, budget }).outcome;
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
        // The first call's answers only, as when the calls went one after the other.
        expect([...outcome.answers.values()].map((answer) => answer.alias)).toEqual(Array.from({ length: 20 }, (_, rank) => `groupe_${String(rank + 1).padStart(2, "0")}`));
        expect(budget.snapshot()).toMatchObject({ calls: 3 });
        expect(budget.tryStart()).toBe(true);
      }
    }
  });

  it("waits for the calls in flight when the job's check fails, starts none after it, and leaves with its error", async () => {
    // The second call in flight fails too: the job's check still decides.
    const gated = gatedDecide(weak, { status: (call) => (call === 1 ? "failed" : "available") });
    const budget = createDecisionsTokenBudget(10_000_000, 1_000);
    const lost = new Error("Bail de traitement perdu.");
    let checks = 0;
    // 120 candidates: 6 calls, the first alone; the fourth check fails with the second and third in flight.
    const pending = run(page(120), { decide: gated.decide, budget, beforeCall: async () => {
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
    const answer: AnswerOf = (alias) => {
      const rank = aliasNumber(alias);
      return rank % 4 === 0 ? "refused" : { value: rank % 2 ? "EF" : "EU", margin: rank % 3 === 0 ? 0.3 : 0.9 };
    };
    // 200 candidates: 10 calls; the sixth fails, or none.
    for (const failing of [null, 5]) {
      const results: ReturnType<typeof result>[] = [];
      for (const pick of [first, last, shuffled(7), shuffled(11), shuffled(13)]) {
        const gated = gatedDecide(answer, { status: (call) => (call === failing ? "failed" : "available") });
        const outcome = await drive(run(page(200), { decide: gated.decide }).outcome, gated, pick);
        results.push(result(outcome));
        // Every call sent after the failed one is logged after it, its answers unused.
        const stopAt = outcome.calls.findIndex((call) => call.status === "failed");
        expect(outcome.calls.every((call, index) => (call.after_stop ?? false) === (stopAt >= 0 && index > stopAt))).toBe(true);
      }
      for (const other of results.slice(1)) expect(other).toEqual(results[0]);
      expect(results[0].answers).toHaveLength(failing === null ? 200 : 100);
      expect(results[0].stop).toEqual(failing === null ? null : expect.objectContaining({ reason: "call_failed" }));
    }
  });
});
