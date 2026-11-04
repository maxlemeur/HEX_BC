import { describe, expect, it } from "vitest";

import { GroupTruthFileSchema, type GroupTruthFile } from "@/lib/takeoff/bench/schemas";
import { runVectorBench, type VectorBenchDocument } from "@/lib/takeoff/bench/vector-run";
import {
  applyVisionAnswers,
  VISION_CORRECTED_CONFIDENCE,
  VISION_REVIEW_LIMITS,
  visionAnswerSchema,
  visionCandidates,
  visionPageTimings,
  type VisionAnswer,
  type VisionPageOutcome,
} from "@/lib/takeoff/bench/vision-review";
import type { BenchRuleData } from "@/lib/takeoff/bench/vector-rules";
import { ruleInputsFromVector } from "@/lib/takeoff/rules/inputs";
import type { TakeoffRuleResult } from "@/lib/takeoff/rules/types";
import type { TakeoffItem } from "@/lib/takeoff/types";
import type { VectorGroupKey, VectorPageExtraction, VectorPath, VectorText } from "@/lib/takeoff/vectors/extraction";

// The targeted vision pass of the takeoff bench (TI-664 step 3): ChatGPT reviews the rejected lines only, on a crop of
// their plan, and its corrections are scored apart. Ways it fails, written before the code (fictional plans only):
// - V1: a line the rules did not reject, or rejected for a geometric reason (duplicate, area, scale), goes to the model;
// - V2: a line without geometry (a raster page's level C line) is cropped from nothing or ends the pass;
// - V3: a correction makes a line « high confidence »: a model's reading counted as sure; it stays uncertain at most;
// - V4: an answer for an unknown alias, a verdict other than « corrige », or codes outside the vocabulary change a line;
// - V5: lines beyond the per-page cap are skipped silently instead of counted « left out »;
// - V6: « Limite du forfait ChatGPT » (quota) does not end the run at once, or later pages are still sent;
// - V8: the pass's corrections leak into the « after the rules » reading instead of a separate « after vision » one;
// - V9: a page's duration leaves out its vision time (render and calls), so the L1 comparison flatters the pass.
// Review of the pass (written before the fix):
// - V10: an answer with a wrapping material (« calorifuge ») turns a pipe into a line the DN rule no longer reads: it
//   leaves « rejected » with no check (false accept);
// - V11: a network total spread over the sheet (hundreds of runs) is cropped as nearly the whole page, unreadable,
//   and one answer rewrites all of it: such a line is not sent, it is counted « too spread »;
// - V12: a line that also fails a geometric rule is sent, though no correction can clear its rejection;
// - V13: a correction leaves the pipe's insulation line (same total) on the old network or size at high confidence;
// - V14: a « corrige » that repeats the reading changes the line (confidence lowered) and counts as corrected.

const SHEET = { width: 1190.55, height: 841.89 };
const RED: VectorGroupKey = { layer: null, color: "#ff0000", width: 1, dash: null };
const RED_ID = "c:#ff0000|w:1|d:";

function text(str: string, x: number, y: number, width: number, height = 6): VectorText {
  return { str, x, y, width, height, angle: 0 };
}

/** A red EF pipe of 720 pt (12.7 m at 1/50) labelled « EF DN 22 »: its material is not printed, the DN rule fails it. */
function plan(number: number, pages: number, label = "EF DN 22"): VectorPageExtraction {
  const coordinates = [100, 400, 820, 400];
  const paths: VectorPath[] = [{ group: 0, start: 0, count: 2, closed: false }];
  return {
    page: number, pages, width: SHEET.width, height: SHEET.height, userUnit: 1, rotate: 0, layers: [], groups: [RED],
    texts: [text(label, 400, 396, 50), text("Échelle 1/50", 1000, 780, 50, 5), text("Format A3", 1000, 800, 40, 5)],
    paths, points: Float32Array.from(coordinates),
    counts: { operators: 10, strokePaths: 1, fillPaths: 0, clipPaths: 0, images: 0, imageCoverage: 0 },
    timings: { operators_ms: 1, walk_ms: 1, text_ms: 1, total_ms: 3 }, memory: { max_rss_kb: 50_000, heap_used_mb: 20 },
  };
}

function benchDocument(id: string, pages: number): VectorBenchDocument {
  return { id, lot: "a", role: "truth", bytes: new Uint8Array([37, 80, 68, 70]), sha256: "1".repeat(64), pages, level: "R+1", zone: "Z1" };
}

function groups(document: string, pages: number): Map<string, GroupTruthFile> {
  return new Map([[document, GroupTruthFileSchema.parse({ schema_version: 1, document,
    groups: Array.from({ length: pages }, (_, index) => ({ page: index + 1, group: RED_ID, class: "EF" })) })]]);
}

const usage = { input_tokens: 1500, output_tokens: 120, total_tokens: 1620 };
function answered(lines: VisionAnswer[], latency = 2000): VisionPageOutcome {
  return { calls: [{ lines: lines.length, status: "ok", latency_ms: latency, usage }], render_ms: [400], answers: lines, stop: null };
}

describe("visionCandidates", () => {
  const fail = (rule: TakeoffRuleResult["rule"], code: string, acceptable = true): TakeoffRuleResult =>
    ({ rule, status: "fail", code, version: 1, acceptable, reason: `${code}.` }) as TakeoffRuleResult;
  const pass: TakeoffRuleResult = { rule: "dn_network", status: "pass", code: "DN_NETWORK_COMPATIBLE", version: 1, acceptable: true, reason: "OK." };
  const item = (designation: string, page: number): TakeoffItem =>
    ({ designation, quantity: 5, unit: "ml", source_page: page, confidence: 0.5, evidence: "Fictional" });
  const datum = (segments: Array<[number, number, number, number]>, material: string | null = null): BenchRuleData => ({
    inputs: ruleInputsFromVector({ kind: "network", network: "EF", material: material as never, dn: 22, quantity: 5 }),
    geometry: { segments_m: segments, polygon_m: null, length_m: 5, area_m2: null },
  });

  it("sends only the lines the DN rule rejects that have a geometry, framed around their run (V1, V2)", () => {
    const items = [item("EF DN 22", 1), item("EF cuivre DN 22", 1), item("EF DN 22", 1), item("EF DN 22", 1)];
    const data = [datum([[1, 2, 6, 2]]), datum([[1, 3, 6, 3]], "cuivre"), datum([[1, 4, 6, 4]]), null];
    const results = [
      [fail("dn_network", "DN_NETWORK_MATERIAL_MISSING")],
      [pass],
      [pass, fail("zone_overlap", "ZONE_OVERLAP_DUPLICATE")],
      [fail("dn_network", "DN_NETWORK_MATERIAL_MISSING")],
    ];
    const pages = visionCandidates({ items, data, results, denominators: new Map([[1, 50]]) });
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ page: 1, left_out: 0 });
    expect(pages[0].lines.map((line) => [line.alias, line.index, line.read, line.failures.map((entry) => entry.code)])).toEqual([
      ["L1", 0, { network: "EF", material: null, dn: "DN 22" }, ["DN_NETWORK_MATERIAL_MISSING"]],
    ]);
    // 1 m at 1/50 is 20 mm on the sheet: 56.69 pt; the run from 1 m to 6 m at 2 m, framed with the margin.
    const box = pages[0].lines[0].box_pt;
    const metre = 1000 / 50 / (25.4 / 72);
    expect(box.x0).toBeCloseTo(1 * metre - VISION_REVIEW_LIMITS.marginPt, 3);
    expect(box.x1).toBeCloseTo(6 * metre + VISION_REVIEW_LIMITS.marginPt, 3);
    expect(box.y0).toBeCloseTo(2 * metre - VISION_REVIEW_LIMITS.marginPt, 3);
  });

  it("never sends a line rejected for a geometric reason too, nor a total spread over the sheet (V11, V12)", () => {
    const items = [item("EF DN 22", 1), item("EF DN 28", 1), item("EF DN 32", 1)];
    const data = [datum([[1, 2, 6, 2]]), datum([[1, 3, 3, 3], [40, 20, 44, 20]]), datum([[1, 4, 6, 4]])];
    const results = [
      [fail("dn_network", "DN_NETWORK_MATERIAL_MISSING"), fail("zone_overlap", "ZONE_OVERLAP_DUPLICATE")],
      [fail("dn_network", "DN_NETWORK_MATERIAL_MISSING")],
      [fail("dn_network", "DN_NETWORK_MATERIAL_MISSING")],
    ];
    const [page] = visionCandidates({ items, data, results, denominators: new Map([[1, 50]]) });
    expect(page.lines.map((line) => line.index)).toEqual([2]);
    expect(page).toMatchObject({ too_spread: 1, left_out: 0 });
  });

  it("counts the lines beyond the per-page cap as left out (V5)", () => {
    const count = VISION_REVIEW_LIMITS.linesPerPage + 3;
    const items = Array.from({ length: count }, () => item("EF DN 22", 2));
    const data = Array.from({ length: count }, (_, index) => datum([[1, index, 6, index]]));
    const results = Array.from({ length: count }, () => [fail("dn_network", "DN_NETWORK_MATERIAL_MISSING")]);
    const [page] = visionCandidates({ items, data, results, denominators: new Map([[2, 50]]) });
    expect([page.page, page.lines.length, page.left_out]).toEqual([2, VISION_REVIEW_LIMITS.linesPerPage, 3]);
  });
});

describe("applyVisionAnswers", () => {
  const items: TakeoffItem[] = [{ designation: "EF DN 22", quantity: 5, unit: "ml", source_page: 1, confidence: 0.9, evidence: "Fictional" }];
  const data: BenchRuleData[] = [{ inputs: ruleInputsFromVector({ kind: "network", network: "EF", material: null, dn: 22, quantity: 5 }),
    geometry: { segments_m: [[1, 2, 6, 2]], polygon_m: null, length_m: 5, area_m2: null } }];
  const answer = (overrides: Partial<VisionAnswer>): VisionAnswer =>
    ({ alias: "L1", verdict: "corrige", network: "EF", material: "cuivre", dn: "22", label: "EF cuivre 20/22", ...overrides });

  it("takes a correction into the line's inputs and designation, never above uncertain (V3)", () => {
    const corrected = applyVisionAnswers({ items, data, answers: new Map([[0, answer({})]]) });
    expect(corrected.corrected).toEqual([0]);
    expect(corrected.items[0]).toMatchObject({ designation: "EF cuivre DN 22", quantity: 5, confidence: VISION_CORRECTED_CONFIDENCE });
    expect(VISION_CORRECTED_CONFIDENCE).toBeLessThan(0.8);
    expect(corrected.data[0]?.inputs).toMatchObject({ network: "EF", material: "cuivre", dn: "DN 22", model_quantity: 5 });
    // The run's own reading stays as it was: a separate state (V8).
    expect([items[0].designation, data[0].inputs.material]).toEqual(["EF DN 22", null]);
  });

  it("changes nothing for a confirmation, an unreadable label or an answer for another line (V4)", () => {
    for (const entry of [answer({ verdict: "confirme" }), answer({ verdict: "illisible" })]) {
      const result = applyVisionAnswers({ items, data, answers: new Map([[0, entry]]) });
      expect([result.corrected, result.items[0], result.data[0]]).toEqual([[], items[0], data[0]]);
    }
    expect(applyVisionAnswers({ items, data, answers: new Map([[3, answer({})]]) }).corrected).toEqual([]);
  });

  it("never takes a wrapping material for a pipe (V10)", () => {
    expect(visionAnswerSchema.safeParse({ lines: [answer({ material: "calorifuge" as never })] }).success).toBe(false);
    expect(visionAnswerSchema.safeParse({ lines: [answer({ material: "cordon-chauffant" as never })] }).success).toBe(false);
  });

  it("changes nothing for a « corrige » that repeats the reading (V14)", () => {
    const repeat = applyVisionAnswers({ items, data, answers: new Map([[0, answer({ material: null })]]) });
    expect([repeat.corrected, repeat.items[0], repeat.data[0]]).toEqual([[], items[0], data[0]]);
  });

  it("carries the correction to the pipe's insulation line, capped too (V13)", () => {
    const withInsulation: TakeoffItem[] = [items[0], { designation: "EF calorifuge DN 22", quantity: 3, unit: "ml", source_page: 1, confidence: 0.9, evidence: "Fictional" }];
    const insulation: BenchRuleData = { inputs: ruleInputsFromVector({ kind: "insulation", network: "EF", material: "calorifuge", dn: 22, quantity: 3 }),
      geometry: { segments_m: [[1, 2, 4, 2]], polygon_m: null, length_m: 3, area_m2: null } };
    const result = applyVisionAnswers({ items: withInsulation, data: [data[0], insulation],
      answers: new Map([[0, answer({ network: "ECS", material: "cuivre", dn: "28" })]]) });
    expect(result.items.map((entry) => [entry.designation, entry.confidence])).toEqual([["ECS cuivre DN 28", VISION_CORRECTED_CONFIDENCE],
      ["ECS calorifuge DN 28", VISION_CORRECTED_CONFIDENCE]]);
    expect(result.data[1]?.inputs).toMatchObject({ kind: "insulation", network: "ECS", material: "calorifuge", dn: "DN 28" });
  });

  it("refuses codes outside the vocabulary and a DN that is not a size (V4)", () => {
    expect(visionAnswerSchema.safeParse({ lines: [answer({ material: "laiton" as never })] }).success).toBe(false);
    expect(visionAnswerSchema.safeParse({ lines: [answer({ network: "XYZ" as never })] }).success).toBe(false);
    expect(visionAnswerSchema.safeParse({ lines: [answer({ dn: "ép. 2" })] }).success).toBe(false);
    expect(visionAnswerSchema.safeParse({ lines: [answer({})] }).success).toBe(true);
  });
});

describe("the vision pass in the vector bench", () => {
  it("reviews the rejected lines after the rules and scores its corrections apart (V8, V9)", async () => {
    const seen: Array<[string, number, string[]]> = [];
    const result = await runVectorBench({
      documents: [benchDocument("a-plan-01", 1)], groups: groups("a-plan-01", 1), repeat: 1, extract: async () => plan(1, 1),
      vision: {
        promptVersion: "fixture-vision-v1",
        review: async (document, page, lines) => {
          seen.push([document.id, page, lines.map((line) => line.designation)]);
          return answered([{ alias: lines[0].alias, verdict: "corrige", network: "EF", material: "cuivre", dn: "22", label: "EF cuivre 20/22" }]);
        },
      },
    });
    expect(seen).toEqual([["a-plan-01", 1, ["EF DN 22"]]]);
    const read = result.run.couples[0].passes[0].documents[0];
    // After the rules: the reading as it was, still failed.
    expect(read.items.map((entry) => entry.designation)).toEqual(["EF DN 22"]);
    expect(read.item_rules?.[0]?.find((entry) => entry.rule === "dn_network")).toMatchObject({ status: "fail", code: "DN_NETWORK_MATERIAL_MISSING" });
    // After vision: the corrected line, its rules computed again.
    const reviewed = result.vision?.passes[0].documents[0];
    // Read without material (0.5, « à revoir »), corrected: still uncertain, never raised by the model's reading.
    expect(reviewed?.items.map((entry) => [entry.designation, entry.confidence])).toEqual([["EF cuivre DN 22", 0.5]]);
    expect(reviewed?.item_rules?.[0]?.find((entry) => entry.rule === "dn_network")).toMatchObject({ status: "pass" });
    const summary = result.vector.passes[0].vision;
    expect(summary).toMatchObject({ stop: null, documents: [{ id: "a-plan-01", pages: [{ page: 1, lines: 1, left_out: 0, corrected: 1,
      calls: [{ status: "ok", latency_ms: 2000, usage }], render_ms: [400] }] }] });
    // A page's time: its vector call plus its vision render and calls.
    const vectorMs = read.calls[0].duration_ms;
    expect(visionPageTimings(result.vector.passes, result.run.couples[0].passes)).toEqual([
      { document: "a-plan-01", page: 1, pass: 1, vector_ms: vectorMs, vision_ms: 2400, total_ms: vectorMs + 2400 },
    ]);
    expect(result.run.status).toBe("complete");
  });

  it("ends the run at the first quota stop, with no later page sent (V6)", async () => {
    const asked: string[] = [];
    const result = await runVectorBench({
      documents: [benchDocument("a-plan-01", 2)], groups: groups("a-plan-01", 2), repeat: 2, extract: async (_bytes, pageNumber) => plan(pageNumber, 2),
      vision: {
        promptVersion: "fixture-vision-v1",
        review: async (document, page) => {
          asked.push(`${document.id}:${page}`);
          return { calls: [{ lines: 1, status: "stopped", latency_ms: 300, usage: null }], render_ms: [400], answers: [],
            stop: { reason: "quota", message: "Limite du forfait ChatGPT atteinte." } };
        },
      },
    });
    expect(asked).toEqual(["a-plan-01:1"]);
    expect(result.run).toMatchObject({ status: "incomplete",
      stop: { kind: "provider", reason: "quota", error: { name: "VisionStop", message: "Limite du forfait ChatGPT atteinte." } } });
    expect(result.run.couples[0].passes).toHaveLength(1);
    expect(result.vector.passes[0].vision?.stop).toEqual({ reason: "quota", message: "Limite du forfait ChatGPT atteinte." });
  });
});
