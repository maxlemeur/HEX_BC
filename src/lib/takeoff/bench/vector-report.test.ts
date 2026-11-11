import { describe, expect, it } from "vitest";

import { buildBenchReport, type BenchReport, type BenchReportMetadata, type PassReport } from "@/lib/takeoff/bench/report";
import { createFixtureDataset } from "@/lib/takeoff/bench/bench-dataset.test-utils";
import { loadBenchDataset } from "@/lib/takeoff/bench/dataset";
import { measuredLengthsByScope, type MeasuredLengths } from "@/lib/takeoff/bench/measured";
import { GroupTruthFileSchema, type MeasuredTruthFile } from "@/lib/takeoff/bench/schemas";
import { buildScoreScopes, scoreScopes, type KeyLabel, type KeyScore, type ScopeScore } from "@/lib/takeoff/bench/score";
import { compareVectorWithBaseline, renderVectorSections, scopeSlices, vectorDecisionsSummary, vectorDecisionsTotal, type KindMetrics } from "@/lib/takeoff/bench/vector-report";
import { runVectorBench, type VectorBenchPass, type VectorPageDecisions } from "@/lib/takeoff/bench/vector-run";
import type { VectorPageExtraction, VectorPath } from "@/lib/takeoff/vectors/extraction";

// Ways the comparison of the vector reading with the level C baseline (TI-662
// acceptance) could misstate a gain, written before the tests. Every document,
// label and quantity is fictional:
// - a missed key is left out of the median relative error (or counted 0 %),
//   so a reading that misses keys looks more accurate than one that reads them;
// - the share within tolerance is not ok / scored keys: an out-of-score key
//   counted, an out-of-tolerance or missed key left out of the denominator; a
//   count, or an insulation priced in m2, taken for a length or a surface;
// - the passes are pooled, averaged or reduced to one pass instead of the
//   median of the per-pass shares and errors;
// - lengths « gain » with an equal share or an equal error (the acceptance asks
//   strictly higher and strictly lower); surfaces called a regression when they
//   are equal (it asks >= and <=); a side without keys gets a verdict;
// - a baseline scope the vector run did not score (read failed, or not run)
//   enters the totals, so the comparison is not on the same keys; the reserve
//   mixed into the main totals;
// - report.md prints a quantity (expected, actual, measured length or area) or
//   a room label of the private plans, instead of shares and errors.
// Decisions of the groups (TI-662 L3c, written before the code):
// - the calls are not split into batch and dedicated, or the tokens of a call
//   without usage (failed) count as zero tokens of a counted call instead of
//   no usage; the latency percentiles mix calls and renders;
// - a document's stop, or the run's budget, is missing from report.md;
// - report.md prints a group id, a colour or a layer of the private plans.
// Codex review of the PR (written before the fix):
// - an « autre » answer at 0.8 or more is counted as classified, though
//   isClassified and the badge leave « autre » unclassified;
// - the candidates no call answered (images not drawn, budget refused, a
//   failed call, a stop) are missing from the « à revoir » count, so a page
//   whose campaign failed reports nothing to review.

const LENGTH: KeyLabel = { kind: "network", zone: "Z1", level: "R+1", network: "EF", material: "cuivre", organ: null, dn: "DN 22", room: null, unit: "ml" };
const LABELS: Record<"length" | "surface" | "count" | "insulation", KeyLabel> = {
  length: LENGTH,
  surface: { ...LENGTH, kind: "surface", zone: null, level: "RDC", network: null, material: null, dn: null, room: "Fictional hall", unit: "m2" },
  count: { ...LENGTH, kind: "count", network: null, material: null, organ: "vanne", dn: "DN 20", unit: "u" },
  insulation: { ...LENGTH, material: "calorifuge", unit: "m2" },
};
/** Quantities no share or error of the fixtures equals, so that report.md can be searched for them. */
const QUANTITIES = { length: [487.13, 512.77], surface: [63.41, 61.93] } as const;

type Kind = keyof typeof LABELS;
type Status = KeyScore["status"];

/** A key with its relative deviation; a missed key has the -1 the scorer gives it (actual 0 against expected). */
function key(kind: Kind, status: Status, deviation: number | null = null, index = 0): KeyScore {
  const [expected, actual] = kind === "surface" ? QUANTITIES.surface : QUANTITIES.length;
  const scored = status !== "out_of_score";
  return {
    key: { ...LABELS[kind], dn: kind === "surface" ? null : `DN ${22 + 6 * index}` }, status,
    reason: scored ? null : "not_observable", expected: scored ? expected : null,
    actual: status === "missed" || !scored ? null : actual, tolerance: scored ? 48.713 : null,
    relative_deviation: status === "missed" ? -1 : deviation, items: status === "missed" ? 0 : 1, lines: 1,
    sources: ["truth/fixture.json#lines[0]"], plan_causes: [], cause: null,
  };
}

/** Keys of one kind from their statuses and deviations: ["ok", 0.02], ["missed"], ["out_of_tolerance", 0.5]. */
function keys(kind: Kind, entries: ReadonlyArray<readonly [Status, number?]>) {
  return entries.map(([status, deviation], index) => key(kind, status, deviation ?? null, index));
}

function scope(id: string, scopeKeys: KeyScore[], overrides: Partial<ScopeScore> = {}): ScopeScore {
  return {
    id: `truth/${id}.json`, lot: id.startsWith("d-") ? "d" : "a", role: "truth", documents: [id], truth_files: [`truth/${id}.json`],
    status: "scored", warnings: [], unread_pages: [], keys: scopeKeys, false_positives: [], out_of_score_items: [],
    counts: {
      items: 0, attached: 0, unreadable: 0, out_of_score_items: 0, attachment_rate: null, keys_scored: 0, keys_ok: 0, keys_out_of_tolerance: 0,
      keys_missed: 0, keys_out_of_score: 0, false_positive_groups: 0, false_positive_items: 0, not_reviewed: 0, causes: {},
    },
    indicative: { expected_keys: 0, matched_keys: 0, ok_keys: 0, candidates: 0, items: 0, localized_items: 0, high_confidence_items: 0, high_confidence_errors: 0 },
    ...overrides,
  };
}

const metadata: BenchReportMetadata = {
  started_at: "2026-11-03T10:00:00.000Z", finished_at: "2026-11-03T10:01:00.000Z", command: ["npm", "run", "takeoff:bench"],
  cwd: "/fixture/checkout", env: {}, node: "v26.12.1", commit: "f".repeat(40), dirty: false,
  dataset: { sha256: "e".repeat(64), documents: [], skipped: [] }, profile: { model: null, reasoning_effort: null, unchanged: null },
};

/** The summary and indicative parts of an empty pass: the comparison reads the scopes only. */
const EMPTY_PASS: PassReport = buildBenchReport({
  metadata, noise: null, scopes: [],
  run: { status: "complete", stop: null, calls_planned: 0, calls_done: 0,
    couples: [{ model: "fixture", reasoning_effort: null, override: null, prompt_version: null, passes: [{ pass: 1, complete: true, documents: [] }] }] },
}).couples[0].passes[0];

function report(passes: ScopeScore[][], pipeline?: "vector"): BenchReport {
  return {
    schema_version: 1, ...(pipeline ? { pipeline } : {}), status: "complete", stop: null, calls_planned: 0, calls_done: 0, metadata,
    production_gaps: [], rules: {}, noise: null,
    couples: [{ model: pipeline ?? "fixture-model", reasoning_effort: null, override: null, prompt_version: null, passes_done: passes.length,
      passes: passes.map((scopes, index) => ({ ...EMPTY_PASS, pass: index + 1, scopes })) }],
  };
}

function metrics(keysCount: number, within: number | null, share: number | null, medianError: number | null): KindMetrics {
  return { keys: keysCount, within, share, median_error: medianError };
}

const NONE = metrics(0, null, null, null);

describe("takeoff bench vector comparison", () => {
  it("counts a missed key 100 % in the median relative error", () => {
    const vector = report([[scope("a-plan-01", keys("length", [["ok", 0.02], ["out_of_tolerance", 0.5], ["missed"], ["missed"]]))]], "vector");
    const baseline = report([[scope("a-plan-01", keys("length", [["ok", 0.03], ["ok", -0.05], ["out_of_tolerance", -0.4], ["ok", 0.01]]))]]);
    const [comparison] = compareVectorWithBaseline(vector, baseline).scopes;
    // Errors 0.02, 0.5, 1, 1: median 0.75 (0.26 without the missed keys, 0.01 with them at 0 %).
    expect(comparison.vector.lengths).toEqual(metrics(4, 1, 0.25, 0.75));
    expect(comparison.baseline.lengths).toEqual(metrics(4, 3, 0.75, 0.04));
    expect(comparison.lengths_gain).toBe(false);
  });

  it("takes the share as ok keys over scored keys, lengths and surfaces apart", () => {
    const vectorKeys = [
      ...keys("length", [["ok", 0.01], ["ok", -0.03], ["out_of_tolerance", 0.2], ["missed"], ["out_of_score"], ["out_of_score"]]),
      ...keys("count", [["ok", 0], ["missed"]]), ...keys("insulation", [["ok", 0.01], ["missed"]]),
      ...keys("surface", [["ok", 0.01], ["out_of_tolerance", 0.05], ["out_of_score"]]),
    ];
    const comparison = compareVectorWithBaseline(report([[scope("a-plan-01", vectorKeys)]], "vector"), report([[scope("a-plan-01", vectorKeys)]]));
    expect(comparison.scopes[0].vector).toEqual({ lengths: metrics(4, 2, 0.5, 0.115), surfaces: metrics(2, 1, 0.5, 0.03) });
    // Identical sides: no length gain (not strictly better), no surface regression (equal).
    expect([comparison.scopes[0].lengths_gain, comparison.scopes[0].surfaces_no_regression]).toEqual([false, true]);
  });

  it("takes the median over the passes of each side, never their pooled keys nor their mean", () => {
    const vector = report([
      [scope("a-plan-01", keys("length", [["out_of_tolerance", 0.2], ["missed"], ["missed"]]))],
      [scope("a-plan-01", keys("length", [["ok", 0.04], ["out_of_tolerance", 0.3], ["out_of_tolerance", -0.4]]))],
      [scope("a-plan-01", keys("length", [["ok", 0.06], ["ok", -0.07], ["ok", 0.08]]))],
    ], "vector");
    const baseline = report([
      [scope("a-plan-01", keys("length", [["ok", 0.05], ["missed"], ["out_of_tolerance", 0.15]]))],
      [scope("a-plan-01", keys("length", [["ok", 0.05], ["ok", 0.09], ["missed"]]))],
    ]);
    const comparison = compareVectorWithBaseline(vector, baseline);
    expect(comparison.passes).toEqual({ vector: 3, baseline: 2 });
    // Shares 0, 1/3, 1 and errors 1, 0.3, 0.07 (pooled: 4/9 and 0.2; means: 0.4444 and 0.4567).
    expect(comparison.scopes[0].vector.lengths).toEqual(metrics(3, 1, 0.3333, 0.3));
    // Two passes: the mean of the two middle values.
    expect(comparison.scopes[0].baseline.lengths).toEqual(metrics(3, 1.5, 0.5, 0.12));
  });

  it("calls lengths a gain only with a strictly higher share and a strictly lower error", () => {
    const vector = report([[
      scope("a-plan-01", keys("length", [["ok", 0.01], ["ok", 0.02]])),
      scope("a-plan-02", keys("length", [["ok", 0.01], ["missed"]])),
      scope("a-plan-03", keys("length", [["ok", 0.02], ["ok", 0.08], ["ok", 0.05]])),
      scope("a-plan-04", keys("length", [["ok", 0.09], ["ok", -0.09]])),
      scope("a-plan-05", keys("surface", [["ok", 0.01]])),
      scope("a-plan-06", keys("length", [["ok", 0.01]])),
    ]], "vector");
    const baseline = report([[
      scope("a-plan-01", keys("length", [["ok", 0.05], ["missed"]])),
      scope("a-plan-02", keys("length", [["ok", 0.05], ["missed"]])),
      scope("a-plan-03", keys("length", [["ok", 0.05], ["out_of_tolerance", 0.2], ["ok", 0.01]])),
      scope("a-plan-04", keys("length", [["ok", 0.01], ["out_of_tolerance", 0.15], ["ok", 0.02]])),
      scope("a-plan-05", keys("length", [["missed"]])),
      scope("a-plan-06", keys("surface", [["ok", 0.01]])),
    ]]);
    const comparison = compareVectorWithBaseline(vector, baseline);
    expect(comparison.scopes.map((entry) => [entry.documents[0], entry.vector.lengths.share, entry.vector.lengths.median_error,
      entry.baseline.lengths.share, entry.baseline.lengths.median_error, entry.lengths_gain])).toEqual([
      ["a-plan-01", 1, 0.015, 0.5, 0.525, true],
      ["a-plan-02", 0.5, 0.505, 0.5, 0.525, false],
      ["a-plan-03", 1, 0.05, 0.6667, 0.05, false],
      ["a-plan-04", 1, 0.09, 0.6667, 0.02, false],
      ["a-plan-05", null, null, 0, 1, null],
      ["a-plan-06", 1, 0.01, null, null, null],
    ]);
  });

  it("calls surfaces without regression when the share is not lower and the error not higher", () => {
    const base = keys("surface", [["ok", 0.01], ["out_of_tolerance", 0.05]]);
    const vector = report([[
      scope("d-plan-01", keys("surface", [["ok", 0.01], ["out_of_tolerance", 0.05]])),
      scope("d-plan-02", keys("surface", [["out_of_tolerance", 0.03], ["out_of_tolerance", -0.03]])),
      scope("d-plan-03", keys("surface", [["ok", 0.015], ["out_of_tolerance", 0.065]])),
      scope("d-plan-04", keys("surface", [["ok", 0.01], ["ok", -0.01]])),
    ]], "vector");
    const baseline = report([["d-plan-01", "d-plan-02", "d-plan-03", "d-plan-04"].map((id) => scope(id, base))]);
    const comparison = compareVectorWithBaseline(vector, baseline);
    expect(comparison.scopes.map((entry) => [entry.documents[0], entry.vector.surfaces.share, entry.vector.surfaces.median_error,
      entry.baseline.surfaces.share, entry.baseline.surfaces.median_error, entry.surfaces_no_regression])).toEqual([
      ["d-plan-01", 0.5, 0.03, 0.5, 0.03, true],
      ["d-plan-02", 0, 0.03, 0.5, 0.03, false],
      ["d-plan-03", 0.5, 0.04, 0.5, 0.03, false],
      ["d-plan-04", 1, 0.01, 0.5, 0.03, true],
    ]);
    expect(comparison.scopes.every((entry) => entry.lengths_gain === null)).toBe(true);
  });

  it("totals only the scopes the vector run scored, the reserve apart", () => {
    const reserve = { role: "reserve" as const };
    const vector = report([[
      scope("a-plan-01", keys("length", [["ok", 0.01], ["ok", 0.02]])),
      scope("a-plan-02", [], { status: "read_failed", unread_pages: [{ document: "a-plan-02", start_page: 1, end_page: 1, status: "timeout" }] }),
      scope("a-plan-09", keys("length", [["missed"]]), reserve),
    ]], "vector");
    const baseline = report([[
      scope("a-plan-01", keys("length", [["ok", 0.05], ["missed"]])),
      scope("a-plan-02", keys("length", [["missed"], ["missed"], ["missed"], ["missed"]])),
      scope("a-plan-03", keys("length", [["missed"], ["missed"], ["missed"]])),
      scope("a-plan-09", keys("length", [["ok", 0.01]]), reserve),
    ]]);
    const comparison = compareVectorWithBaseline(vector, baseline);
    expect(comparison.scopes.map((entry) => [entry.documents[0], entry.role])).toEqual([["a-plan-01", "truth"], ["a-plan-09", "reserve"]]);
    expect(comparison.totals.truth).toEqual({
      vector: { lengths: metrics(2, 2, 1, 0.015), surfaces: NONE }, baseline: { lengths: metrics(2, 1, 0.5, 0.525), surfaces: NONE },
      lengths_gain: true, surfaces_no_regression: null,
    });
    expect(comparison.totals.reserve).toMatchObject({
      vector: { lengths: metrics(1, 0, 0, 1) }, baseline: { lengths: metrics(1, 1, 1, 0.01) }, lengths_gain: false,
    });
    expect(comparison.totals.all).toMatchObject({
      vector: { lengths: metrics(3, 2, 0.6667, 0.02) }, baseline: { lengths: metrics(3, 2, 0.6667, 0.05) }, lengths_gain: false,
    });
  });

  it("leaves out of the totals a scope the baseline lost, and lists it", () => {
    // Review of 3/11/2026: a scope the baseline lost to a timeout counted on the vector side only.
    const vector = report([[
      scope("a-plan-01", keys("length", [["ok", 0.01]])),
      scope("a-plan-02", keys("length", [["missed"], ["missed"]])),
    ]], "vector");
    const baseline = report([[
      scope("a-plan-01", keys("length", [["ok", 0.05]])),
      scope("a-plan-02", [], { status: "read_failed", unread_pages: [{ document: "a-plan-02", start_page: 1, end_page: 1, status: "timeout" }] }),
    ]]);
    const comparison = compareVectorWithBaseline(vector, baseline);
    expect(comparison.left_out_of_totals).toEqual([comparison.scopes.find((entry) => entry.documents[0] === "a-plan-02")?.scope]);
    expect(comparison.totals.all).toMatchObject({ vector: { lengths: metrics(1, 1, 1, 0.01) }, baseline: { lengths: metrics(1, 1, 1, 0.05) } });
  });

  it("prints shares and errors in report.md, never a quantity nor a room label", async () => {
    // A measured page: a pipe of 720 pt set to EF and calibrated at 1/100 (25.4 m), and a room « Fictional hall »
    // printed 12.34 m² inside a closed square.
    const coordinates = [100, 400, 820, 400, 600, 100, 700, 100, 700, 200, 600, 200, 600, 100];
    const paths: VectorPath[] = [{ group: 0, start: 0, count: 2, closed: false }, { group: 1, start: 2, count: 5, closed: true }];
    const extraction: VectorPageExtraction = {
      page: 1, pages: 1, width: 1190.55, height: 841.89, userUnit: 1, rotate: 0, layers: [],
      groups: [{ layer: null, color: "#ff0000", width: 1, dash: null }, { layer: null, color: "#808080", width: 0.5, dash: null }],
      texts: [{ str: "EF cuivre DN 22", x: 400, y: 396, width: 60, height: 6, angle: 0 },
        { str: "Fictional hall 12.34 m²", x: 610, y: 150, width: 70, height: 5, angle: 0 }],
      paths, points: Float32Array.from(coordinates),
      counts: { operators: 10, strokePaths: 2, fillPaths: 0, clipPaths: 0, images: 0, imageCoverage: 0 },
      timings: { operators_ms: 1, walk_ms: 1, text_ms: 1, total_ms: 3 }, memory: { max_rss_kb: 50_000, heap_used_mb: 20 },
    };
    const groups = new Map([["a-plan-01", GroupTruthFileSchema.parse({
      schema_version: 1, document: "a-plan-01", groups: [{ page: 1, group: "c:#ff0000|w:1|d:", class: "EF" }],
      calibrations: [{ page: 1, denominator: 100, source: "Fictional" }],
    })]]);
    const result = await runVectorBench({
      documents: [{ id: "a-plan-01", lot: "a", role: "truth", bytes: new Uint8Array([37, 80, 68, 70]), sha256: "1".repeat(64), pages: 1 }],
      groups, repeat: 1, extract: async () => extraction,
    });
    const reading = result.vector.passes[0].documents[0].pages[0].reading;
    expect(reading?.networks?.totals).toMatchObject([{ network: "EF", dn: 22, length_m: 25.4 }]);
    const area = reading?.surfaces[0]?.polygon_m2;
    expect(area).toBeGreaterThan(12);

    const vector = report([[scope("a-plan-01", [...keys("length", [["ok", 0.02], ["ok", 0.03], ["missed"]]), ...keys("surface", [["ok", 0.01]])])]], "vector");
    const baseline = report([[scope("a-plan-01", [...keys("length", [["ok", 0.05], ["missed"], ["missed"]]), ...keys("surface", [["out_of_tolerance", 0.04]])])]]);
    const markdown = renderVectorSections(result.vector.passes, compareVectorWithBaseline(vector, baseline)).join("\n");
    expect(markdown).toContain("67 % (2 / 3), erreur médiane 3 %");
    expect(markdown).toContain("33 % (1 / 3), erreur médiane 100 %");
    expect(markdown).toContain("100 % (1 / 1), erreur médiane 1 %");
    expect(markdown).toContain("| gain |");
    expect(markdown).toContain("sans régression");
    expect(markdown).toContain("calibrated 1/100");
    for (const quantity of [...QUANTITIES.length, ...QUANTITIES.surface, 25.4, 12.34, area as number]) {
      expect(markdown).not.toContain(String(quantity));
      expect(markdown).not.toContain(String(quantity).replace(".", ","));
    }
    expect(markdown).not.toContain("Fictional hall");
    expect(markdown).not.toContain("EF cuivre DN 22");
  });
});

describe("Decisions of the groups in the vector report (TI-662 L3c)", () => {
  const call = (kind: "batch" | "dedicated", latency: number, total: number | null, status: "available" | "failed" = "available") => ({
    kind, questions: kind === "batch" ? 36 : 1, status, latency_ms: latency, render_ms: 50,
    usage: total === null ? null : { input_tokens: total - 100, output_tokens: 100, total_tokens: total },
  });
  const decisions = (calls: VectorPageDecisions["calls"], stop: VectorPageDecisions["stop"] = null): VectorPageDecisions => ({
    candidates: 40, eligible: 45, left_out: 5, calls, stop, render: { legend_ms: 400, sheets_ms: [100, 300] },
    answers: [
      { alias: "groupe_01", group: "oc:FICTIF_SECRET_LAYER", class: "EF", confidence: 0.9, status: "answered", via: "batch" },
      { alias: "groupe_02", group: "c:#123456|w:0.5|d:", class: "EU", confidence: 0.6, status: "answered", via: "dedicated" },
      { alias: "groupe_03", group: "c:#654321|w:0.5|d:", class: null, confidence: null, status: "refused", via: "batch" },
    ],
  });
  const passes: VectorBenchPass[] = [{ pass: 1, documents: [
    { id: "a-plan-01", pages: [
      { page: 1, status: "ok", error: null, reading: null, raster_items_from_baseline: null,
        decisions: decisions([call("batch", 1000, 5000), call("dedicated", 2000, 1500), call("dedicated", 4000, 1500)]) },
      { page: 2, status: "ok", error: null, reading: null, raster_items_from_baseline: null,
        decisions: decisions([call("batch", 3000, null, "failed")], { reason: "call_failed", message: "Fictional failure." }) },
    ] },
  ] }];

  it("sums calls by kind, tokens of the calls with usage, latency of calls and renders apart, and the stops", () => {
    const [document] = vectorDecisionsSummary(passes);
    expect(document).toMatchObject({
      document: "a-plan-01", calls: { batch: 2, dedicated: 2, without_usage: 1 }, tokens: { input: 7700, output: 300, total: 8000 },
      latency_ms: { p50: 2000, p95: 4000 }, candidates: 80, left_out: 10,
      answers: { classified: 2, proposals: 2, review: 76 }, stops: [{ pass: 1, page: 2, reason: "call_failed" }],
    });
    // Renders: the legend and the sheets of each page, never the calls.
    expect(document.render_ms.raw).toEqual([400, 100, 300, 400, 100, 300]);
  });

  it("counts « autre » and every candidate left unanswered as to review (Codex review of the PR)", () => {
    const page = (decisions: VectorPageDecisions) => [{ pass: 1, documents: [{ id: "a-plan-01", pages: [
      { page: 1, status: "ok" as const, error: null, reading: null, raster_items_from_baseline: null, decisions }] }] }];
    const autre = { alias: "groupe_01", group: "c:#123456|w:0.5|d:", class: "autre" as const, confidence: 0.95, status: "answered" as const, via: "batch" as const };
    // Four candidates: one answered « autre » at 0.95, three never asked (the budget refused the next call).
    const [stopped] = vectorDecisionsSummary(page({ ...decisions([call("batch", 1000, 5000)], { reason: "budget_reached", message: "Fictional." }),
      candidates: 4, answers: [autre] }));
    expect(stopped.answers).toEqual({ classified: 0, proposals: 0, review: 4 });
    // No call at all (the images could not be drawn): every candidate stays to review.
    const [undrawn] = vectorDecisionsSummary(page({ ...decisions([]), candidates: 3, answers: [] }));
    expect(undrawn.answers).toEqual({ classified: 0, proposals: 0, review: 3 });
  });

  it("totals the Decisions of the whole run across documents, calls and renders of every page (review of the PR)", () => {
    const two = [{ pass: 1, documents: [...passes[0].documents, { ...passes[0].documents[0], id: "b-plan-11" }] }];
    expect(vectorDecisionsSummary(two)).toHaveLength(2);
    const total = vectorDecisionsTotal(two);
    expect(total).toMatchObject({
      document: null, pages: 4, calls: { batch: 4, dedicated: 4, without_usage: 2 }, tokens: { input: 15400, output: 600, total: 16000 },
      candidates: 160, left_out: 20, answers: { classified: 4, proposals: 4, review: 152 },
    });
    expect(total?.latency_ms.raw).toHaveLength(8);
    expect(total?.render_ms.raw).toHaveLength(12);
    expect(vectorDecisionsTotal([{ pass: 1, documents: [{ id: "a-plan-01", pages: [] }] }])).toBeNull();
    expect(renderVectorSections(two, null).join("\n")).toMatch(/\| Total \| 4 \| 4 \/ 4 \|/);
  });

  it("prints the Decisions section with the budget, never a group id, colour or layer", () => {
    const budget = { max_tokens: 100_000, spent_tokens: 8000, calls: 4, calls_without_usage: 1, refused_starts: 0, largest_call_tokens: 5000 };
    const markdown = renderVectorSections(passes, null, { budget }).join("\n");
    expect(markdown).toContain("## Decisions");
    expect(markdown).toContain("2 / 2");
    expect(markdown).toContain("8000 jetons sur 100000");
    expect(markdown).toContain("call_failed");
    for (const secret of ["FICTIF_SECRET_LAYER", "#123456", "#654321", "oc:"]) expect(markdown).not.toContain(secret);
    expect(renderVectorSections([{ pass: 1, documents: [{ id: "a-plan-01", pages: [] }] }], null).join("\n")).not.toContain("## Decisions");
  });
});

// Vector and raster slices of the comparison (TI-678, decision Q8 of 5 Nov: added after the v1 results were read,
// the global v1 figure stays the headline). Ways they could misstate the reading, written before the code:
// - the keys of a raster plan, whose lines the vector run copies from the baseline, count as read or within
//   tolerance for the vector reading: a page handed to a human is an abstention, never a success;
// - the coverage counts a missed key as read, or a key out of score in its denominator; the median error on the
//   keys read includes the missed keys (100 %), or is 0 % instead of nothing when no key was read;
// - the slices move the global totals of v1, or the reserve is mixed with the other plans;
// - a plan with vector and raster pages, or with a page that failed, is put in a slice; a page read in raster
//   mode without baseline items to copy is taken for a vector page;
// - the verdict of a slice is taken from its coverage and its error on the keys read, instead of the acceptance
//   rule (share within tolerance, a missed key 100 %); a plan one run lost counts in a slice on the other side;
// - silent errors (keys at high confidence in error) are summed as 0 for a run that never classed its lines, or
//   pooled over the passes instead of their median;
// - the interval is computed over pooled keys instead of per plan, or printed for a single plan;
// - report.md does not say the slices were added after the v1 results, or prints a quantity.

/** A pass of the vector run: each document's pages, a number for a raster page standing on that many baseline items, « raster » for one read in raster mode without any. */
function vectorPass(pages: Record<string, ReadonlyArray<"vector" | "failed" | "raster" | number>>, pass = 1): VectorBenchPass {
  return { pass, documents: Object.entries(pages).map(([id, modes]) => ({ id, pages: modes.map((mode, index) => ({
    page: index + 1, status: mode === "failed" ? "failed" as const : "ok" as const,
    error: mode === "failed" ? { name: "Fictional", code: null, message: "Fictional failure." } : null,
    // Only the mode of a reading is read here.
    reading: mode === "raster" ? { mode: "raster" } as NonNullable<VectorBenchPass["documents"][number]["pages"][number]["reading"]> : null,
    raster_items_from_baseline: typeof mode === "number" ? mode : null })) })) };
}

/** Confidence counts of a scope: keys at high confidence, and those in error (the silent errors). */
function confidence(high: number, errors: number): NonNullable<ScopeScore["confidence"]> {
  return { lines: { rejected: 0, uncertain: 0, high }, keys_high_confidence: high, keys_high_confidence_error: errors, high_confidence_errors: [] };
}

describe("takeoff bench vector and raster slices (TI-678)", () => {
  const reserve = { role: "reserve" as const };

  it("puts a plan in the slice of its pages in the vector run, and leaves out a mixed or failed one", () => {
    const scopes = [scope("a-plan-02", []), scope("c-plan-02", []), scope("c-plan-03", []), scope("d-plan-02", []), scope("e-plan-01", [])];
    const slices = scopeSlices([vectorPass({ "a-plan-02": ["vector", "vector"], "c-plan-02": [4], "c-plan-03": ["vector", 2], "d-plan-02": ["vector", "failed"] })], scopes);
    expect(Object.fromEntries(slices)).toEqual({ "truth/a-plan-02.json": "vector", "truth/c-plan-02.json": "raster", "truth/c-plan-03.json": "mixed",
      "truth/d-plan-02.json": "mixed" });
    // A page read in raster mode is raster, with or without baseline items to copy.
    expect(Object.fromEntries(scopeSlices([vectorPass({ "a-plan-02": ["raster"], "c-plan-03": ["vector", "raster"] })], scopes))).toEqual({
      "truth/a-plan-02.json": "raster", "truth/c-plan-03.json": "mixed" });
    // A raster page in any pass makes the plan raster in that pass: two passes that disagree are mixed.
    expect(scopeSlices([vectorPass({ "a-plan-02": ["vector"] }, 1), vectorPass({ "a-plan-02": [3] }, 2)], scopes).get("truth/a-plan-02.json")).toBe("mixed");
  });

  it("publishes coverage, median error on the keys read and silent errors per slice, the raster slice as an abstention", () => {
    const vector = report([[
      scope("a-plan-02", keys("length", [["ok", 0.04], ["out_of_tolerance", 0.3], ["missed"]]), { ...reserve, confidence: confidence(2, 1) }),
      // The vector run copies the baseline's lines on a raster plan: its keys here are the baseline's reading.
      scope("c-plan-02", keys("length", [["ok", 0.02], ["out_of_tolerance", -0.6], ["missed"], ["missed"]]), { ...reserve, confidence: confidence(2, 1) }),
    ]], "vector");
    const baseline = report([[
      scope("a-plan-02", keys("length", [["out_of_tolerance", 0.5], ["missed"], ["missed"]]), { ...reserve, confidence: confidence(1, 1) }),
      scope("c-plan-02", keys("length", [["ok", 0.02], ["out_of_tolerance", -0.6], ["missed"], ["missed"]]), { ...reserve, confidence: confidence(2, 1) }),
    ]]);
    const slices = scopeSlices([vectorPass({ "a-plan-02": ["vector"], "c-plan-02": [4] })], vector.couples[0].passes[0].scopes);
    const comparison = compareVectorWithBaseline(vector, baseline, { slices });
    const withoutSlices = compareVectorWithBaseline(vector, baseline);
    // The v1 figure is untouched: same totals with and without the slices, the raster plan's copied keys included.
    expect(comparison.totals).toEqual(withoutSlices.totals);
    expect(comparison.totals.reserve.vector.lengths).toEqual(metrics(7, 2, 0.2857, 0.6));
    expect(withoutSlices.slices).toBeNull();
    const { vector: vectorSlice, raster } = comparison.slices!.totals.reserve;
    // Vector slice: 2 keys read of 3 (missed key not read), errors 0.04 and 0.3 on the keys read (0.3 with the missed one).
    expect(vectorSlice.vector).toEqual({ abstained: false, silent_errors: 1,
      lengths: { keys: 3, read: 2, coverage: 0.6667, within: 1, median_error_read: 0.17, by_plan: null },
      surfaces: { keys: 0, read: null, coverage: null, within: null, median_error_read: null, by_plan: null } });
    expect(vectorSlice.baseline.lengths).toEqual({ keys: 3, read: 1, coverage: 0.3333, within: 0, median_error_read: 0.5, by_plan: null });
    expect(vectorSlice).toMatchObject({ plans: ["truth/a-plan-02.json"], lengths_gain: true });
    // Raster slice: the vector reading abstains on its 4 keys, whatever the copied lines scored; the baseline is shown.
    expect(raster.vector).toEqual({ abstained: true, silent_errors: null,
      lengths: { keys: 4, read: null, coverage: null, within: null, median_error_read: null, by_plan: null },
      surfaces: { keys: 0, read: null, coverage: null, within: null, median_error_read: null, by_plan: null } });
    expect(raster.baseline).toMatchObject({ abstained: false, silent_errors: 1, lengths: { keys: 4, read: 2, coverage: 0.5, within: 1, median_error_read: 0.31 } });
    expect(raster.lengths_gain).toBeNull();
    // The other plans are not in the reserve's slices.
    expect(comparison.slices!.totals.truth.vector.plans).toEqual([]);
    expect(comparison.slices!.left_out).toEqual([]);
  });

  it("reads no error on the keys read when none was read, and no silent error from a run that never classed its lines", () => {
    const vector = report([[scope("a-plan-02", [...keys("length", [["missed"], ["missed"], ["out_of_score"]]), ...keys("surface", [["ok", 0.01]])], reserve)]], "vector");
    const comparison = compareVectorWithBaseline(vector, vector, { slices: scopeSlices([vectorPass({ "a-plan-02": ["vector"] })], vector.couples[0].passes[0].scopes) });
    const side = comparison.slices!.totals.reserve.vector.vector;
    expect(side.lengths).toEqual({ keys: 2, read: 0, coverage: 0, within: 0, median_error_read: null, by_plan: null });
    expect(side.surfaces).toMatchObject({ keys: 1, read: 1, coverage: 1, median_error_read: 0.01 });
    expect(side.silent_errors).toBeNull();
    // Equal sides: never a gain.
    expect(comparison.slices!.totals.reserve.vector.lengths_gain).toBe(false);
  });

  it("takes the median over the passes and the interval over the plans, never over pooled keys", () => {
    const first = [
      scope("a-plan-01", keys("length", [["ok", 0.02], ["ok", 0.04], ["missed"], ["missed"]]), { confidence: confidence(2, 0) }),
      scope("b-plan-11", keys("length", [["out_of_tolerance", 0.5], ["out_of_tolerance", 0.3]]), { confidence: confidence(2, 2) }),
      scope("b-plan-12", keys("length", [["ok", 0.06]]), { confidence: confidence(1, 0) }),
    ];
    const second = [
      scope("a-plan-01", keys("length", [["ok", 0.02], ["missed"], ["missed"], ["missed"]]), { confidence: confidence(1, 0) }),
      scope("b-plan-11", keys("length", [["out_of_tolerance", 0.5], ["out_of_tolerance", 0.3]]), { confidence: confidence(2, 2) }),
      scope("b-plan-12", keys("length", [["ok", 0.06]]), { confidence: confidence(1, 1) }),
    ];
    const third = [
      scope("a-plan-01", keys("length", [["ok", 0.02], ["ok", 0.04], ["ok", 0.08], ["missed"]]), { confidence: confidence(3, 0) }),
      scope("b-plan-11", keys("length", [["out_of_tolerance", 0.5], ["out_of_tolerance", 0.3]]), { confidence: confidence(2, 1) }),
      scope("b-plan-12", keys("length", [["ok", 0.06]]), { confidence: confidence(1, 1) }),
    ];
    const vector = report([first, second, third], "vector");
    const passes = [1, 2, 3].map((pass) => vectorPass({ "a-plan-01": ["vector"], "b-plan-11": ["vector"], "b-plan-12": ["vector"] }, pass));
    const side = compareVectorWithBaseline(vector, vector, { slices: scopeSlices(passes, first) }).slices!.totals.truth.vector.vector;
    // Keys read per pass 5, 4, 6 of 7; errors on the keys read per pass: medians 0.06, 0.18, 0.07; silent errors 2, 3, 2.
    expect(side.lengths).toMatchObject({ keys: 7, read: 5, coverage: 0.7143, median_error_read: 0.07 });
    expect(side.silent_errors).toBe(2);
    // Per plan (each the median of its passes): coverage 0.5, 1, 1 and error 0.03, 0.4, 0.06.
    expect(side.lengths.by_plan).toEqual({ plans: 3, coverage: [0.5, 1], median_error_read: [0.03, 0.4] });
  });

  it("applies the acceptance rule to a slice: the share within tolerance, a missed key at 100 %", () => {
    const gain = (vectorKeys: KeyScore[], baselineKeys: KeyScore[]) => {
      const vector = report([[scope("a-plan-02", vectorKeys, reserve)]], "vector");
      const slices = scopeSlices([vectorPass({ "a-plan-02": ["vector"] })], vector.couples[0].passes[0].scopes);
      return compareVectorWithBaseline(vector, report([[scope("a-plan-02", baselineKeys, reserve)]]), { slices }).slices!.totals.reserve.vector.lengths_gain;
    };
    // One key read well and two missed: the median error is 100 % on both sides, though 0 % against 30 % on the keys read.
    expect(gain(keys("length", [["ok", 0], ["missed"], ["missed"]]), keys("length", [["out_of_tolerance", 0.3], ["missed"], ["missed"]]))).toBe(false);
    // Every key read on both sides, so the coverage is equal: one within tolerance against none, 16 % against 45 %.
    expect(gain(keys("length", [["ok", 0.02], ["out_of_tolerance", 0.3]]), keys("length", [["out_of_tolerance", 0.5], ["out_of_tolerance", 0.4]]))).toBe(true);
  });

  it("keeps a plan one run lost out of the slices, as out of the totals", () => {
    const scopes = [scope("a-plan-02", keys("length", [["ok", 0.02]]), reserve), scope("b-plan-12", keys("length", [["ok", 0.02]]), reserve)];
    const vector = report([scopes], "vector");
    const baseline = report([[scopes[0], { ...scopes[1], status: "read_failed" as const }]]);
    const comparison = compareVectorWithBaseline(vector, baseline, { slices: scopeSlices([vectorPass({ "a-plan-02": ["vector"], "b-plan-12": ["vector"] })], scopes) });
    expect(comparison.left_out_of_totals).toEqual(["truth/b-plan-12.json"]);
    expect(comparison.slices!.totals.reserve.vector.plans).toEqual(["truth/a-plan-02.json"]);
    expect(comparison.slices!.totals.reserve.vector.vector.lengths.keys).toBe(1);
    expect(comparison.slices!.left_out).toEqual([]);
  });

  it("leaves a mixed plan out of both slices and names it", () => {
    const scopes = [scope("a-plan-02", keys("length", [["ok", 0.02]]), reserve), scope("c-plan-03", keys("length", [["ok", 0.02]]), reserve)];
    const vector = report([scopes], "vector");
    const comparison = compareVectorWithBaseline(vector, vector, { slices: scopeSlices([vectorPass({ "a-plan-02": ["vector"], "c-plan-03": ["vector", 5] })], scopes) });
    expect(comparison.slices!.totals.reserve.vector.plans).toEqual(["truth/a-plan-02.json"]);
    expect(comparison.slices!.totals.reserve.raster.plans).toEqual([]);
    expect(comparison.slices!.left_out).toEqual(["truth/c-plan-03.json"]);
  });

  it("prints the slices as added after the v1 results, with shares and counts and never a quantity", () => {
    const vector = report([[
      scope("a-plan-02", keys("length", [["ok", 0.04], ["out_of_tolerance", 0.3], ["missed"]]), { ...reserve, confidence: confidence(2, 1) }),
      scope("c-plan-02", keys("length", [["ok", 0.02], ["missed"]]), { ...reserve, confidence: confidence(1, 0) }),
    ]], "vector");
    const passes = [vectorPass({ "a-plan-02": ["vector"], "c-plan-02": [4] })];
    const comparison = compareVectorWithBaseline(vector, vector, { slices: scopeSlices(passes, vector.couples[0].passes[0].scopes) });
    const markdown = renderVectorSections(passes, comparison).join("\n");
    expect(markdown).toContain("ajoutées après lecture des résultats v1");
    expect(markdown).toContain("67 % (2 / 3)");
    expect(markdown).toContain("abstention (2 clés)");
    expect(markdown).toMatch(/erreurs silencieuses/i);
    for (const quantity of [...QUANTITIES.length, ...QUANTITIES.surface]) expect(markdown).not.toContain(String(quantity));
    // Without the slices the section is absent.
    expect(renderVectorSections(passes, compareVectorWithBaseline(vector, vector)).join("\n")).not.toContain("résultats v1");
  });
});

// Lengths judged on the hand measurement (TI-662, decision of 11 Nov): a devis may price more pipe than the plan
// draws, so the lengths of a measured plan are also compared with a measurement along the drawn line. Ways the
// second judgment could mislead:
// - the headline figure, judged on the devis, changed by the measurement;
// - a key without measurement, a key out of score, a surface or an insulation in m2 counted in the measured judgment;
// - a missed key forgiven because its measurement is short, or a key within tolerance of the devis kept « ok »
//   when it is far from the measurement; the tolerance taken on the devis instead of the measurement;
// - one side judged on the measurement and the other on the devis;
// - a plan the two runs did not both score counted on one side only;
// - a raster or mixed plan judged: the vector run copies there the lines of the baseline, so the baseline's own
//   reading would count as a reading of the vectors, and could turn « pas de gain » into « gain »;
// - the reserve mixed with the other plans; a devis below the measurement printed as above it;
// - a measured plan that is not judged (not vector, lost by a run, no key measured, a truth of several plans)
//   dropped without a word, or the keys nobody measured hidden: the judgment would look whole;
// - the judgment not auditable afterwards: report.json keeps, per key, the devis, the measurement and each reading;
// - the fields of a measured line no longer those of the key the scorer builds from the truth line;
// - a measured or priced quantity printed in report.md.
describe("lengths judged on the hand measurement (TI-662)", () => {
  /** A length key with its devis quantity and the quantity a run read (null: missed). The scorer's status and deviation are against the devis. */
  function length(index: number, devis: number, actual: number | null): KeyScore {
    const deviation = actual === null ? -1 : (actual - devis) / devis;
    const status = actual === null ? "missed" : Math.abs(deviation) <= 0.1 ? "ok" : "out_of_tolerance";
    return { ...key("length", status, deviation, index), expected: devis, actual, tolerance: devis * 0.1 };
  }
  /** The measurement files of some plans, each a scope of one plan: by key index, the length measured (null: no length). */
  function measuredOn(plans: Record<string, Record<number, number | null>>, severalPlans: string[] = []): MeasuredLengths {
    const files = Object.entries(plans).map(([document, lengths]): MeasuredTruthFile => ({
      schema_version: 1, document, method: "Fictional method", measured_by: "Fictional estimator", measured_on: "2026-11-12",
      lines: Object.entries(lengths).map(([index, length_m]) => ({ zone: "Z1", level: "R+1", network: "EF", material: "cuivre", dn: `DN ${22 + 6 * Number(index)}`, length_m })),
    }));
    return { ...measuredLengthsByScope(files, Object.keys(plans).map((plan) => ({ id: `truth/${plan}.json`, documents: [plan] }))), several_plans: severalPlans };
  }
  const vectorSlice = (...plans: string[]) => new Map(plans.map((plan) => [`truth/${plan}.json`, "vector" as const]));
  const reserve = { role: "reserve" as const };
  // Devis 40, 30, 10 and 15; measured 21, 20 and 8 on the first three keys, the fourth without length.
  const DEVIS = [40, 30, 10, 15];
  const vectorKeys = [length(0, DEVIS[0], 20), length(1, DEVIS[1], 12), length(2, DEVIS[2], null), length(3, DEVIS[3], 14)];
  const baselineKeys = [length(0, DEVIS[0], 39), length(1, DEVIS[1], null), length(2, DEVIS[2], null), length(3, DEVIS[3], 14)];
  const MEASURED = { 0: 21, 1: 20, 2: 8, 3: null };

  it("judges both runs on the measured keys only, and leaves the headline as it was", () => {
    const extra = [...keys("surface", [["ok", 0.01]]), { ...length(4, 50, 50), status: "out_of_score" as const, reason: "ambiguous" as const },
      // The insulation of the first pipe, priced in m2: same zone, level, network, material and diameter, never a length.
      { ...length(0, 99, 50), key: { ...vectorKeys[0].key, unit: "m2" } }];
    const vector = report([[scope("a-plan-02", [...vectorKeys, ...extra], reserve)]], "vector");
    const baseline = report([[scope("a-plan-02", [...baselineKeys, ...extra], reserve)]]);
    const comparison = compareVectorWithBaseline(vector, baseline, { slices: vectorSlice("a-plan-02"), measured: measuredOn({ "a-plan-02": { ...MEASURED, 4: 49 } }) });
    const without = compareVectorWithBaseline(vector, baseline, { slices: vectorSlice("a-plan-02") });
    expect(without.measured).toBeNull();
    expect(comparison.totals).toEqual(without.totals);
    expect(comparison.scopes).toEqual(without.scopes);
    // On the devis: 1 of 4 within tolerance for the vectors, 2 of 4 for the baseline, so no gain there.
    expect(comparison.totals.reserve.vector.lengths).toMatchObject({ keys: 4, within: 1 });
    expect(comparison.totals.reserve.baseline.lengths).toMatchObject({ keys: 4, within: 2 });
    expect(comparison.totals.reserve.lengths_gain).toBe(false);
    const judged = comparison.measured!.totals.reserve;
    expect(comparison.measured!.declared).toBe("added_after_v1_results");
    expect(judged.plans).toEqual(["truth/a-plan-02.json"]);
    // Three of the four scored lengths of the plan have a measurement.
    expect(judged.scored_keys).toBe(4);
    // Vectors against the measurement: 20 / 21 within, 12 / 20 at 40 %, the missed key at 100 %.
    expect(judged.vector).toEqual(metrics(3, 1, 0.3333, 0.4));
    // Baseline: 39 is within tolerance of the devis (40) and 86 % over the measurement (21); two missed keys.
    expect(judged.baseline).toEqual(metrics(3, 0, 0, 1));
    expect(judged.lengths_gain).toBe(true);
    // The devis prices 90 %, 50 % and 25 % more than is drawn: median 50 %.
    expect(judged.devis_gap).toBe(0.5);
    expect(comparison.measured!.totals.truth).toEqual({ plans: [], scored_keys: 0, vector: NONE, baseline: NONE, lengths_gain: null, devis_gap: null });
    expect(comparison.measured!.totals.all).toEqual(judged);
    expect(comparison.measured!.not_judged).toEqual([]);
    // report.json keeps what the judgment stands on: per key, the devis, the measurement and each run's reading per pass.
    const missed = { actual: null, status: "missed", relative_deviation: -1 };
    expect(comparison.measured!.scopes).toEqual([{ scope: "truth/a-plan-02.json", documents: ["a-plan-02"], role: "reserve", scored_keys: 4, keys: [
      { key: vectorKeys[0].key, devis: 40, measured: 21, vector: [{ actual: 20, status: "ok", relative_deviation: -0.0476 }],
        baseline: [{ actual: 39, status: "out_of_tolerance", relative_deviation: 0.8571 }] },
      { key: vectorKeys[1].key, devis: 30, measured: 20, vector: [{ actual: 12, status: "out_of_tolerance", relative_deviation: -0.4 }], baseline: [missed] },
      { key: vectorKeys[2].key, devis: 10, measured: 8, vector: [missed], baseline: [missed] },
    ] }]);
  });

  it("keeps a missed key at 100 %, and judges a reading on 10 % of the measurement, never of the devis", () => {
    // 38 against a devis of 40 (ok) and a measurement of 21 (81 % over); a missed key; 33.5 against a measurement of
    // 30 (3.5 over, more than its 3) under a devis of 40 whose tolerance (4) would let it pass; 22.5 against 21 (7 %).
    const vector = report([[scope("a-plan-01", [length(0, 40, 38), length(1, 30, null), length(2, 40, 33.5), length(3, 40, 22.5)])]], "vector");
    const judged = compareVectorWithBaseline(vector, vector, { slices: vectorSlice("a-plan-01"), measured: measuredOn({ "a-plan-01": { 0: 21, 1: 0.4, 2: 30, 3: 21 } }) })
      .measured!.totals.truth;
    // Errors 81 %, 100 %, 11.7 % and 7.1 %: one key within tolerance, median 46.3 %.
    expect(judged.vector).toEqual(metrics(4, 1, 0.25, 0.4631));
    // Equal sides: never a gain.
    expect(judged.lengths_gain).toBe(false);
  });

  it("takes the median over the passes, and judges only the plans both runs scored in every pass", () => {
    const passes = [[scope("a-plan-01", [length(0, 40, 20)])], [scope("a-plan-01", [length(0, 40, 26)])], [scope("a-plan-01", [length(0, 40, 22)])]];
    const vector = report(passes, "vector");
    const options = { slices: vectorSlice("a-plan-01"), measured: measuredOn({ "a-plan-01": { 0: 21 } }) };
    // Errors per pass against 21: 4.8 %, 23.8 %, 4.8 %; within 1, 0, 1.
    const whole = compareVectorWithBaseline(vector, vector, options).measured!;
    expect(whole.totals.truth.vector).toEqual(metrics(1, 1, 1, 0.0476));
    expect(whole.scopes[0].keys[0].vector.map((reading) => reading.status)).toEqual(["ok", "out_of_tolerance", "ok"]);
    const lost = report([passes[0], [{ ...passes[1][0], status: "read_failed" as const }], passes[2]]);
    const comparison = compareVectorWithBaseline(vector, lost, options);
    expect(comparison.left_out_of_totals).toEqual(["truth/a-plan-01.json"]);
    expect(comparison.measured!.totals.truth).toMatchObject({ plans: [], vector: NONE, baseline: NONE, lengths_gain: null });
    expect(comparison.measured!.scopes).toEqual([]);
    expect(comparison.measured!.not_judged).toEqual([{ scope: "truth/a-plan-01.json", reason: "not_in_totals" }]);
  });

  it("judges only the plans of the vector slice: on a raster or mixed plan the vector run holds the baseline's lines", () => {
    // Every key measured at 100. On the vector plan the vectors read 102, 150, 150 and the baseline 130, 150, 150;
    // on the raster and mixed plans both sides hold the same copied lines, read at 100.
    const copied = [length(0, 100, 100), length(1, 100, 100)];
    const vector = report([[scope("a-plan-02", [length(0, 100, 102), length(1, 100, 150), length(2, 100, 150)], reserve), scope("c-plan-02", copied, reserve),
      scope("c-plan-03", copied, reserve)]], "vector");
    const baseline = report([[scope("a-plan-02", [length(0, 100, 130), length(1, 100, 150), length(2, 100, 150)], reserve), scope("c-plan-02", copied, reserve),
      scope("c-plan-03", copied, reserve)]]);
    const measured = measuredOn({ "a-plan-02": { 0: 100, 1: 100, 2: 100 }, "c-plan-02": { 0: 100, 1: 100 }, "c-plan-03": { 0: 100, 1: 100 } });
    const slices = scopeSlices([vectorPass({ "a-plan-02": ["vector"], "c-plan-02": [2], "c-plan-03": ["vector", 2] })], vector.couples[0].passes[0].scopes);
    const comparison = compareVectorWithBaseline(vector, baseline, { slices, measured });
    const judged = comparison.measured!.totals.reserve;
    expect(judged.plans).toEqual(["truth/a-plan-02.json"]);
    // One key within tolerance against none, and the same median error (50 %): not a gain. With the copied lines
    // it would read 3 of 5 against 2 of 5, median 2 % against 30 %, and be called one.
    expect(judged.vector).toEqual(metrics(3, 1, 0.3333, 0.5));
    expect(judged.baseline).toEqual(metrics(3, 0, 0, 0.5));
    expect(judged.lengths_gain).toBe(false);
    expect(comparison.measured!.not_judged).toEqual([{ scope: "truth/c-plan-02.json", reason: "not_vector" }, { scope: "truth/c-plan-03.json", reason: "not_vector" }]);
    expect(comparison.measured!.scopes.map((entry) => entry.scope)).toEqual(["truth/a-plan-02.json"]);
    // Without the pages of the vector run no plan is known to be vector: none is judged.
    const blind = compareVectorWithBaseline(vector, baseline, { measured }).measured!;
    expect(blind.totals.all).toMatchObject({ plans: [], vector: NONE, baseline: NONE, lengths_gain: null });
    expect(blind.not_judged.map((entry) => entry.reason)).toEqual(["not_vector", "not_vector", "not_vector"]);
  });

  it("keeps the reserve apart from the other plans", () => {
    const vector = report([[scope("a-plan-01", [length(0, 40, 21)]), scope("a-plan-02", [length(0, 40, 30)], reserve)]], "vector");
    const { totals } = compareVectorWithBaseline(vector, vector, { slices: vectorSlice("a-plan-01", "a-plan-02"),
      measured: measuredOn({ "a-plan-01": { 0: 21 }, "a-plan-02": { 0: 21 } }) }).measured!;
    expect(totals.truth).toMatchObject({ plans: ["truth/a-plan-01.json"], scored_keys: 1, vector: metrics(1, 1, 1, 0) });
    expect(totals.reserve).toMatchObject({ plans: ["truth/a-plan-02.json"], scored_keys: 1, vector: metrics(1, 0, 0, 0.4286) });
    expect(totals.all).toMatchObject({ plans: ["truth/a-plan-01.json", "truth/a-plan-02.json"], scored_keys: 2, vector: metrics(2, 1, 0.5, 0.2143) });
  });

  it("names a measured plan none of whose scored lengths has a measurement, and the truths of several plans", () => {
    const vector = report([[scope("a-plan-01", [length(0, 40, 21), length(1, 30, 12)])]], "vector");
    const comparison = compareVectorWithBaseline(vector, vector, { slices: vectorSlice("a-plan-01"),
      measured: measuredOn({ "a-plan-01": { 0: null, 1: null } }, ["truth/a-level-01.json"]) });
    expect(comparison.measured!.totals.all).toEqual({ plans: [], scored_keys: 0, vector: NONE, baseline: NONE, lengths_gain: null, devis_gap: null });
    expect(comparison.measured!.not_judged).toEqual([{ scope: "truth/a-level-01.json", reason: "several_plans" }, { scope: "truth/a-plan-01.json", reason: "no_measured_key" }]);
  });

  it("signs the gap of the devis to the measurement", () => {
    const gapOf = (devis: number, measure: number) => {
      const vector = report([[scope("a-plan-01", [length(0, devis, measure)])]], "vector");
      const comparison = compareVectorWithBaseline(vector, vector, { slices: vectorSlice("a-plan-01"), measured: measuredOn({ "a-plan-01": { 0: measure } }) });
      return { gap: comparison.measured!.totals.truth.devis_gap, markdown: renderVectorSections([vectorPass({ "a-plan-01": ["vector"] })], comparison).join("\n") };
    };
    // A devis that prices less than is drawn.
    const below = gapOf(16, 20);
    expect(below.gap).toBe(-0.2);
    expect(below.markdown).toContain("| −20 % |");
    expect(gapOf(24, 20).markdown).toContain("| +20 % |");
    // A gap that rounds to nothing has no sign.
    const close = gapOf(19.92, 20);
    expect(close.gap).toBe(-0.004);
    expect(close.markdown).toContain("| 0 % |");
  });

  it("matches the key the scorer builds from a truth line with the measured line that names its fields", async () => {
    const dataset = await createFixtureDataset();
    try {
      await dataset.writeJson("truth/measured/a-plan-01.json", { schema_version: 1, document: "a-plan-01", method: "Fictional method", measured_by: "Fictional estimator",
        measured_on: "2026-11-12", lines: [{ zone: "Z1", level: "R+1", network: "EF", material: "cuivre", dn: "DN 22", length_m: 11.2 }] });
      const loaded = await loadBenchDataset(dataset.root, ["a-plan-01"]);
      const scopes = buildScoreScopes(loaded.truthFiles, loaded.manifest.documents).filter((entry) => entry.id === "truth/a-plan-01.json");
      // The plan ran and gave nothing: the copper pipe of the truth (12.5 m on the devis) is missed, its riser is out of score.
      const scored = scoreScopes(scopes, new Map([["a-plan-01", []]]));
      const vector = report([scored], "vector");
      const comparison = compareVectorWithBaseline(vector, vector, { slices: vectorSlice("a-plan-01"), measured: measuredLengthsByScope(loaded.measured, scored) });
      expect(comparison.measured!.totals.truth).toMatchObject({ plans: ["truth/a-plan-01.json"], scored_keys: 1, vector: metrics(1, 0, 0, 1), devis_gap: 0.1161 });
      expect(comparison.measured!.scopes[0].keys).toMatchObject([{ key: { network: "EF", material: "cuivre", dn: "DN 22", unit: "ml" }, devis: 12.5, measured: 11.2 }]);
    } finally {
      await dataset.cleanup();
    }
  });

  it("prints the judgment as added after the v1 results, the keys measured over the scored ones, the plans not judged, and never a quantity", () => {
    // Quantities no share or error equals: devis, vectors, baseline and measurement of three keys; a fourth has no length.
    const devis = [41.37, 29.71, 10.61, 17.33], read = [20.13, 12.07, null, 14.09], level = [35.19, null, null, 14.09], measure = { 0: 21.19, 1: 20.11, 2: 8.03, 3: null };
    const copied = scope("c-plan-02", [length(0, 31.57, 30.59)], reserve);
    const vector = report([[scope("a-plan-02", devis.map((quantity, index) => length(index, quantity, read[index])), reserve), copied]], "vector");
    const baseline = report([[scope("a-plan-02", devis.map((quantity, index) => length(index, quantity, level[index])), reserve), copied]]);
    const passes = [vectorPass({ "a-plan-02": ["vector"], "c-plan-02": [1] })];
    const comparison = compareVectorWithBaseline(vector, baseline, { slices: scopeSlices(passes, vector.couples[0].passes[0].scopes),
      measured: measuredOn({ "a-plan-02": measure, "c-plan-02": { 0: 30.83 } }, ["truth/a-level-01.json"]) });
    const markdown = renderVectorSections(passes, comparison).join("\n");
    expect(markdown).toContain("### Longueurs jugées à la mesure au trait (jugement ajouté après lecture des résultats v1)");
    expect(markdown).toContain("| **Réserve** | 1 | 3 / 4 | 33 % (1 / 3), erreur médiane 40 % | 0 % (0 / 3), erreur médiane 100 % | gain | +48 % |");
    expect(markdown).toMatch(/plan raster ou mixte[^\n]*truth\/c-plan-02\.json/);
    expect(markdown).toMatch(/vérité de plusieurs plans[^\n]*truth\/a-level-01\.json/);
    for (const quantity of [...devis, ...read, ...level, ...Object.values(measure), 31.57, 30.59, 30.83, ...QUANTITIES.length, ...QUANTITIES.surface]) {
      if (quantity === null) continue;
      expect(markdown).not.toContain(String(quantity));
      expect(markdown).not.toContain(String(quantity).replace(".", ","));
    }
    // Without a measurement the section is absent.
    expect(renderVectorSections(passes, compareVectorWithBaseline(vector, baseline)).join("\n")).not.toContain("mesure au trait");
  });
});
