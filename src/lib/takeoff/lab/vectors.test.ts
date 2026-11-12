import { describe, expect, it, vi } from "vitest";

import type { OpenAiDecisionAnswer, OpenAiDecisionsResult } from "@/lib/ai/decisions";
import { LAB_VECTOR_TASK_ID } from "@/lib/takeoff/lab/contracts";
import type { LabDocument } from "@/lib/takeoff/lab/dataset";
import { findLabTask } from "@/lib/takeoff/lab/tasks";
import { runVectorGroupsConfig } from "@/lib/takeoff/lab/vectors";
import type { VectorGroupKey, VectorPageExtraction, VectorPath } from "@/lib/takeoff/vectors/extraction";
import type { GroupDecisionsDecide, GroupDecisionsRender } from "@/lib/takeoff/vectors/group-decisions-server";
import type { GroupImage } from "@/lib/takeoff/vectors/group-sheet-server";

// Ways the lab's « classe de calque » configuration (vectors.ts
// runVectorGroupsConfig) could lose what Decisions already answered, written
// before the fix. A browser cannot force a dedicated render to fail or a
// dedicated call to fail after a batch answer (the army fixture always
// answers, canvas always draws), so these stops are mapped here, with a
// Decisions fake and fake renders (no network, no child process) on a
// fictional hand-built page:
// - a dedicated render that fails (timeout, too_large, render_failed) after
//   paid batch answers turns the configuration « failed » and drops its
//   elements: nothing applied in the run's reading, no element to judge;
// - a dedicated call that fails (HTTP 429: status failed, its answers missing)
//   erases the probabilities of the batch answer the group keeps (« EU 40 % »
//   shown without bars);
// - with the calls in parallel (TI-704), a dedicated call sent before an
//   earlier one failed lends its probabilities to the batch answer the group
//   keeps (« EU 40 % » shown with the bars of « EF 90 % »); the latency given
//   to the statistics adds up calls that ran together.
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

/** Two magenta groups without a layer (Decisions candidates), the first the longest. */
function page(): VectorPageExtraction {
  const groups: VectorGroupKey[] = [];
  const paths: VectorPath[] = [];
  const coordinates: number[] = [];
  for (let index = 0; index < 2; index += 1) {
    groups.push({ layer: null, color: "#ff00ff", width: 0.01 * (index + 1), dash: null });
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

/** Renders that draw the legend and the batch sheet; `dedicated` answers the second sheets call (the dedicated renders). */
function render(dedicated: "ok" | "timeout"): GroupDecisionsRender {
  let sheets = 0;
  return {
    legend: async () => ({ image: IMAGE, issue: null, duration_ms: 1 }),
    sheets: async (plans) => {
      sheets += 1;
      if (sheets > 1 && dedicated === "timeout") return { images: plans.map(() => null), issue: "timeout", render_ms: plans.map(() => null), duration_ms: 1 };
      return { images: plans.map(() => IMAGE), issue: null, render_ms: plans.map(() => 1), duration_ms: 1 };
    },
  };
}

/** Batch: groupe_01 EU 0.9, groupe_02 EU 0.4 (asked again alone); a dedicated call answers EF 0.9 or fails like an HTTP 429. */
function decide(dedicated: "ok" | "failed"): GroupDecisionsDecide {
  return async (input) => {
    const call = input.evidence.call as "batch" | "dedicated";
    const failed = call === "dedicated" && dedicated === "failed";
    const answers: OpenAiDecisionAnswer[] = input.questions.map((question) => {
      if (failed) return { name: question.name, type: "choice", status: "missing", value: null, confidence: null };
      const [value, confidence] = call === "dedicated" ? ["EF", 0.9] : question.name === "groupe_02" ? ["EU", 0.4] : ["EU", 0.9];
      return { name: question.name, type: "choice", status: "answered", value, confidence,
        probabilities: [{ value, probability: confidence }, { value: "autre", probability: Math.round((1 - confidence) * 10) / 10 }] };
    });
    const result: OpenAiDecisionsResult = {
      status: failed ? "failed" : "available", capability: { status: "available", model: "gpt-6-luna", billing: "separate_api", message: "" },
      message: failed ? "Decisions limite les demandes (HTTP 429)." : "Fictional answer.", answers,
      provenance: { tenant_id: ACCESS.owner.tenantId, project_id: "takeoff-lab", preparation_fingerprint: "f".repeat(64), request_fingerprint: "r",
        model: "gpt-6-luna", requested_at: "2026-11-03T10:00:00.000Z", usage: failed ? null : { input_tokens: 90, output_tokens: 10, total_tokens: 100 } },
    };
    return result;
  };
}

/** One answer per question, `value` at `confidence` for each, or a failed call (HTTP 429). */
function answered(input: Parameters<GroupDecisionsDecide>[0], value: string, confidence: number, failed = false): OpenAiDecisionsResult {
  return {
    status: failed ? "failed" : "available", capability: { status: "available", model: "gpt-6-luna", billing: "separate_api", message: "" },
    message: failed ? "Decisions limite les demandes (HTTP 429)." : "Fictional answer.",
    answers: input.questions.map((question) => (failed ? { name: question.name, type: "choice", status: "missing", value: null, confidence: null }
      : { name: question.name, type: "choice", status: "answered", value, confidence,
        probabilities: [{ value, probability: confidence }, { value: "autre", probability: Math.round((1 - confidence) * 10) / 10 }] })),
    provenance: { tenant_id: ACCESS.owner.tenantId, project_id: "takeoff-lab", preparation_fingerprint: "f".repeat(64), request_fingerprint: "r",
      model: "gpt-6-luna", requested_at: "2026-11-03T10:00:00.000Z", usage: failed ? null : { input_tokens: 90, output_tokens: 10, total_tokens: 100 } },
  };
}

function configure(options: { render: GroupDecisionsRender; decide: GroupDecisionsDecide }) {
  const task = findLabTask(LAB_VECTOR_TASK_ID)!;
  return runVectorGroupsConfig({
    access: ACCESS, runId: "20261103-100000-abcdef", configId: "A", task, document: DOCUMENT, page: 1, promptVersion: "takeoff-vector-groups-v1+test",
    remainingTokens: 1_000_000, extract: async () => page(), ...options,
  });
}

describe("lab « classe de calque » configuration (vectors.ts runVectorGroupsConfig)", () => {
  it("gives the time its calls took, not the sum of calls that ran together (TI-704)", async () => {
    vi.useFakeTimers();
    try {
      // A batch call, then the 2 groups' dedicated calls together, 1 s each: 2 s, not 3.
      const slow: GroupDecisionsDecide = async (input) => {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        return answered(input, "EU", 0.4);
      };
      const pending = configure({ render: render("ok"), decide: slow });
      await vi.runAllTimersAsync();
      const config = await pending;
      expect(JSON.parse(config.raw ?? "{}").calls).toHaveLength(3);
      expect(config.latency_ms).toBe(2_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the paid batch answers as a partial configuration when a dedicated render fails, and says why", async () => {
    const config = await configure({ render: render("timeout"), decide: decide("ok") });
    expect(config.stop?.reason).toBe("render_failed");
    expect(config.status).toBe("partial");
    expect(config.message).toBe(config.stop?.message);
    expect(config.message).toMatch(/pas été dessinées à temps/);
    expect(config.usage).toMatchObject({ total: 100 });
    expect(config.elements.map((element) => [element.label, element.detail, (element.json as { answer: unknown }).answer])).toEqual([
      [expect.any(String), "EU", { class: "EU", confidence: 0.9, status: "answered", via: "batch" }],
      [expect.any(String), "EU", { class: "EU", confidence: 0.4, status: "answered", via: "batch" }],
    ]);
  });

  it("keeps a batch answer's probabilities when its dedicated call fails without answers", async () => {
    const config = await configure({ render: render("ok"), decide: decide("failed") });
    expect(config.stop?.reason).toBe("call_failed");
    expect(config.status).toBe("partial");
    const second = config.answers?.find((answer) => answer.name === "groupe_02");
    expect(second).toMatchObject({ status: "answered", value: "EU", confidence: 0.4 });
    expect(second?.probabilities?.map((option) => [option.value, option.probability])).toEqual([["autre", 0.6], ["EU", 0.4]]);
  });

  it("takes a replaced answer's probabilities from the dedicated call that produced it", async () => {
    const config = await configure({ render: render("ok"), decide: decide("ok") });
    expect(config).toMatchObject({ status: "ok", stop: null });
    const second = config.answers?.find((answer) => answer.name === "groupe_02");
    expect(second).toMatchObject({ status: "answered", value: "EF", confidence: 0.9 });
    expect(second?.probabilities?.map((option) => [option.value, option.probability])).toEqual([["EF", 0.9], ["autre", 0.1]]);
  });

  it("keeps a batch answer's own probabilities when a dedicated call sent alongside a failed one answers (TI-704)", async () => {
    // Both groups EU 0.4 in batch, asked again alone together: groupe_02's dedicated call answers EF 0.9 first, then
    // groupe_01's, started before it, fails. groupe_02 keeps its batch answer, as when the calls went one at a time.
    let failFirst = () => {};
    const firstFails = new Promise<void>((resolve) => {
      failFirst = resolve;
    });
    const racing: GroupDecisionsDecide = async (input) => {
      if (input.evidence.call === "batch") return answered(input, "EU", 0.4);
      if (input.questions[0]?.name === "groupe_02") {
        failFirst();
        return answered(input, "EF", 0.9);
      }
      await firstFails;
      return answered(input, "EF", 0.9, true);
    };
    const config = await configure({ render: render("ok"), decide: racing });
    expect(config.stop?.reason).toBe("call_failed");
    const second = config.answers?.find((answer) => answer.name === "groupe_02");
    expect(second).toMatchObject({ status: "answered", value: "EU", confidence: 0.4 });
    expect(second?.probabilities?.map((option) => [option.value, option.probability])).toEqual([["autre", 0.6], ["EU", 0.4]]);
  });
});
