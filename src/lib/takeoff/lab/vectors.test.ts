import { describe, expect, it, vi } from "vitest";

import type { OpenAiDecisionsResult } from "@/lib/ai/decisions";
import { LAB_VECTOR_TASK_ID, type LabRun } from "@/lib/takeoff/lab/contracts";
import type { LabDocument } from "@/lib/takeoff/lab/dataset";
import { findLabTask } from "@/lib/takeoff/lab/tasks";
import { decisionsOfLabRun, runVectorGroupsConfig } from "@/lib/takeoff/lab/vectors";
import type { VectorGroupKey, VectorPageExtraction, VectorPath } from "@/lib/takeoff/vectors/extraction";
import type { GroupDecisionsDecide, GroupDecisionsRender } from "@/lib/takeoff/vectors/group-decisions-server";
import type { GroupImage } from "@/lib/takeoff/vectors/group-evidence-render-server";

// Ways the lab's « classe de calque » configuration (vectors.ts
// runVectorGroupsConfig) could lose what the classification gave, written
// before the code. A browser cannot force a drawing or a call to fail after
// the rules answered, so these stops are mapped here, with a Decisions fake
// and a fake drawing (no network, no child process) on a fictional page:
// - a call that fails (HTTP 429: status failed) or a drawing that fails turns
//   the configuration « failed » and drops the rules' classes it already has;
// - the run stores a rule's class or a « hors_liste » proposal so that the
//   reading of the run applies it as a Decisions class (at its missing
//   confidence) or loses it (TI-704);
// - the latency given to the statistics adds up calls that ran together.
// The real Decisions client is never reached: it is mocked to throw.

vi.mock("@/lib/ai/decisions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/decisions")>()),
  callOpenAiDecisions: () => { throw new Error("The lab's vector test never calls Decisions."); },
}));

const A3 = { width: 1190.55, height: 841.89 };
const IMAGE: GroupImage = { mimeType: "image/jpeg", data: "AAAA", width: 10, height: 10, bytes: 3 };
const ACCESS = { owner: { userId: "user-fixture", tenantId: "tenant-fixture" }, email: null };
const DOCUMENT: LabDocument = {
  summary: { id: "fixture-vector-test", source: "fixture", label: "Plan fictif", pages: 1, truth: null },
  bytes: Buffer.from("%PDF-fictional"), sha256: "a".repeat(64),
};
const hex = (value: number) => value.toString(16).padStart(2, "0");

/**
 * `count` groups of distinct colours without a layer (candidates), the first the longest; with `sameColour`, a layer
 * FICTIF_EF and a stroke of its colour outside it (the rules class it EF).
 */
function page(count: number, sameColour = false): VectorPageExtraction {
  const groups: VectorGroupKey[] = [];
  const paths: VectorPath[] = [];
  const coordinates: number[] = [];
  for (let index = 0; index < count; index += 1) {
    groups.push({ layer: null, color: `#${hex(30 + index)}00ff`, width: 0.01 * (index + 1), dash: null });
    paths.push({ group: index, start: coordinates.length / 2, count: 2, closed: false });
    coordinates.push(100, 10 + 1.5 * index, 1100 - index, 10 + 1.5 * index);
  }
  if (sameColour) {
    for (const [layer, y] of [["ef-layer", 700], [null, 740]] as const) {
      paths.push({ group: groups.length, start: coordinates.length / 2, count: 2, closed: false });
      groups.push({ layer, color: "#00a0a0", width: layer ? 0.3 : 0.6, dash: null });
      coordinates.push(100, y, 900, y);
    }
  }
  return {
    page: 1, pages: 1, width: A3.width, height: A3.height, userUnit: 1, rotate: 0,
    layers: sameColour ? [{ id: "ef-layer", name: "FICTIF_EF", visible: true }] : [], groups, texts: [], paths,
    points: Float32Array.from(coordinates),
    counts: { operators: 0, strokePaths: paths.length, fillPaths: 0, clipPaths: 0, images: 0, imageCoverage: 0 },
    timings: { operators_ms: 0, walk_ms: 0, text_ms: 0, total_ms: 0 }, memory: { max_rss_kb: 0, heap_used_mb: 0 },
  };
}

function render(issue: "timeout" | null = null): GroupDecisionsRender {
  return () => ({
    draw: async (plan) => ({ legends: plan.legends.map(() => (issue ? null : IMAGE)), groups: plan.groups.map(() => (issue ? null : IMAGE)), issue,
      dropped_images: 0, render_ms: { page: 1, legends: [], groups: plan.groups.map(() => 1) }, duration_ms: 1 }),
    cancel: () => {},
  });
}

/** One answer per question, `value` at a margin (its probability (1 + margin) / 2, the rest « fond »), or a failed call (HTTP 429). */
function answered(input: Parameters<GroupDecisionsDecide>[0], value: string, margin: number, failed = false): OpenAiDecisionsResult {
  return {
    status: failed ? "failed" : "available", capability: { status: "available", model: "gpt-6-luna", billing: "separate_api", message: "" },
    message: failed ? "Decisions limite les demandes (HTTP 429)." : "Fictional answer.",
    answers: input.questions.map((question) => (failed ? { name: question.name, type: "choice", status: "missing", value: null, confidence: null }
      : { name: question.name, type: "choice", status: "answered", value, confidence: margin,
        probabilities: [{ value, probability: (1 + margin) / 2 }, { value: "fond", probability: (1 - margin) / 2 }] })),
    provenance: { tenant_id: ACCESS.owner.tenantId, project_id: "takeoff-lab", preparation_fingerprint: "f".repeat(64), request_fingerprint: "r",
      model: "gpt-6-luna", requested_at: "2026-11-03T10:00:00.000Z", usage: failed ? null : { input_tokens: 90, output_tokens: 10, total_tokens: 100 } },
  };
}

function configure(options: { render: GroupDecisionsRender; decide: GroupDecisionsDecide; extraction?: VectorPageExtraction }) {
  const task = findLabTask(LAB_VECTOR_TASK_ID)!;
  const extraction = options.extraction ?? page(2);
  return runVectorGroupsConfig({
    access: ACCESS, runId: "20261103-100000-abcdef", configId: "A", task, document: DOCUMENT, page: 1, promptVersion: "takeoff-vector-groups-v2+test",
    remainingTokens: 1_000_000, extract: async () => extraction, render: options.render, decide: options.decide,
  });
}

describe("lab « classe de calque » configuration (vectors.ts runVectorGroupsConfig)", () => {
  it("gives the time its calls took, not the sum of calls that ran together (TI-704)", async () => {
    vi.useFakeTimers();
    try {
      // 60 groups: 3 calls of 1 s, the first alone, the 2 others together: 2 s, not 3.
      const slow: GroupDecisionsDecide = async (input) => {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        return answered(input, "EU", 0.9);
      };
      const pending = configure({ render: render(), decide: slow, extraction: page(60) });
      await vi.runAllTimersAsync();
      const config = await pending;
      expect(JSON.parse(config.raw ?? "{}").calls).toHaveLength(3);
      expect(config.latency_ms).toBe(2_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the rules' class as a partial configuration when the call fails or the drawing does, and says why", async () => {
    for (const [options, reason] of [[{ render: render(), decide: async (input: Parameters<GroupDecisionsDecide>[0]) => answered(input, "EU", 0.9, true) }, "call_failed"],
      [{ render: render("timeout"), decide: async (input: Parameters<GroupDecisionsDecide>[0]) => answered(input, "EU", 0.9) }, "render_failed"]] as const) {
      const config = await configure({ ...options, extraction: page(1, true) });
      expect(config.stop?.reason).toBe(reason);
      expect(config.status).toBe("partial");
      expect(config.message).toBe(config.stop?.message);
      expect(config.elements.map((element) => [element.detail, (element.json as { answer: unknown }).answer])).toEqual([
        ["EF (règles)", { class: "EF", confidence: null, status: "answered", via: "rule", rule: "same_colour" }],
      ]);
    }
  });

  it("stores an answer with its probabilities, a « hors_liste » proposal, and reads them back as the reading applies them", async () => {
    const config = await configure({ render: render(), decide: async (input) => answered(input, input.questions.length === 1 ? "hors_liste" : "EU", 0.8),
      extraction: page(1, true) });
    expect(config).toMatchObject({ status: "ok", stop: null });
    const [hors] = config.answers ?? [];
    expect(hors).toMatchObject({ status: "answered", value: null, confidence: 0.8 });
    expect(hors?.probabilities?.map((option) => [option.value, Math.round(option.probability * 100) / 100])).toEqual([["hors_liste", 0.9], ["fond", 0.1]]);
    expect(config.elements.map((element) => element.detail)).toEqual(["canalisation hors nomenclature", "EF (règles)"]);
    const run = { configs: [{ provider: "decisions", elements: config.elements }] } as unknown as LabRun;
    expect(decisionsOfLabRun(run)).toEqual(new Map([
      ["c:#1e00ff|w:0.01|d:", { class: null, confidence: null, source: "decisions", proposal: "canalisation hors nomenclature" }],
      ["c:#00a0a0|w:0.6|d:", { class: "EF", confidence: null, source: "rule" }],
    ]));
    // A run of before TI-704 v2 (no `via` « rule »): its classes stay Decisions' at their confidence.
    const older = { configs: [{ provider: "decisions", elements: [{ json: { group: "g", answer: { class: "EU", confidence: 0.6, status: "answered", via: "batch" } } }] }] } as unknown as LabRun;
    expect(decisionsOfLabRun(older)).toEqual(new Map([["g", { class: "EU", confidence: 0.6, source: "decisions" }]]));
  });
});
