import { describe, expect, it } from "vitest";

import { buildBenchReport, type BenchReport, type BenchReportMetadata, type PassReport } from "@/lib/takeoff/bench/report";
import { GroupTruthFileSchema } from "@/lib/takeoff/bench/schemas";
import type { KeyLabel, KeyScore, ScopeScore } from "@/lib/takeoff/bench/score";
import { compareVectorWithBaseline, renderVectorSections, vectorDecisionsSummary, type KindMetrics } from "@/lib/takeoff/bench/vector-report";
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
      answers: { classified: 2, proposals: 2, review: 2 }, stops: [{ pass: 1, page: 2, reason: "call_failed" }],
    });
    // Renders: the legend and the sheets of each page, never the calls.
    expect(document.render_ms.raw).toEqual([400, 100, 300, 400, 100, 300]);
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
