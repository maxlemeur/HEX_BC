import { describe, expect, it } from "vitest";

import type { OpenAiDecisionsResult } from "@/lib/ai/decisions";
import { createDecisionsTokenBudget } from "@/lib/ai/decisions-budget";
import type { VectorGroupKey, VectorPageExtraction, VectorPath } from "@/lib/takeoff/vectors/extraction";
import { GROUP_DECISIONS_LIMITS } from "@/lib/takeoff/vectors/group-decisions";
import {
  classifyVectorGroups,
  decisionsOfOutcome,
  type GroupDecisionsCallLimits,
  type GroupDecisionsDecide,
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

/** A Decisions fake: `answer(alias, kind)` per question; every call recorded with its question names and image count. */
function fakeDecide(answer: (alias: string, kind: "batch" | "dedicated") => Answer, status: (call: number) => OpenAiDecisionsResult["status"] | "throw" = () => "available") {
  const seen: Array<{ names: string[]; images: number; evidence: Record<string, unknown>; context: unknown }> = [];
  const decide: GroupDecisionsDecide = async (input) => {
    const call = seen.length;
    seen.push({ names: input.questions.map((question) => question.name), images: input.images?.length ?? 0, evidence: input.evidence, context: input.context });
    const kind = input.evidence.call as "batch" | "dedicated";
    const outcome = status(call);
    if (outcome === "throw") throw new Error("Le contexte Decisions est trop volumineux.");
    const answers = input.questions.map((question) => {
      const given = outcome === "available" || outcome === "partial" ? answer(question.name, kind) : "missing";
      if (given === "refused" || given === "missing") return { name: question.name, type: "choice" as const, status: given, value: null, confidence: null };
      return { name: question.name, type: "choice" as const, status: "answered" as const, value: given.value, confidence: given.confidence };
    });
    return {
      status: outcome, capability: { status: "available", model: "gpt-6-luna", billing: "separate_api", message: "" }, message: `Fictional ${outcome}.`,
      answers,
      provenance: { tenant_id: OWNER.tenantId, project_id: CONTEXT.projectId, preparation_fingerprint: CONTEXT.preparationFingerprint,
        request_fingerprint: "r", model: "gpt-6-luna", requested_at: "2026-11-03T10:00:00.000Z",
        usage: outcome === "failed" || outcome === "unavailable" ? null : { input_tokens: 900, output_tokens: 100, total_tokens: 1000 } },
    };
  };
  return { decide, seen };
}

function run(extraction: VectorPageExtraction, options: {
  decide: GroupDecisionsDecide; render?: GroupDecisionsRender; maxTokens?: number; limits?: GroupDecisionsCallLimits;
}) {
  const budget = createDecisionsTokenBudget(options.maxTokens ?? 10_000_000, 1_000);
  const reading = readVectorPage(extraction, { clock: () => 0 });
  return { budget, outcome: classifyVectorGroups({
    bytes: new Uint8Array([37, 80, 68, 70]), extraction, reading, owner: OWNER, context: CONTEXT, budget,
    decide: options.decide, render: options.render ?? fakeRender().render, limits: options.limits, clock: () => 0,
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
      expect(seen).toHaveLength(2);
      expect(outcome.stop).toMatchObject({ reason });
      expect(outcome.calls.map((call) => call.status)).toEqual(["available", status === "throw" ? "exception" : status]);
      expect([...outcome.answers.values()].filter((answer) => answer.class !== null)).toHaveLength(36);
      expect(budget.snapshot().calls).toBe(2);
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
