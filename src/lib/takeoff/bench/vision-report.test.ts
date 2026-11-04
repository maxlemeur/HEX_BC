import { describe, expect, it } from "vitest";

import type { BenchPass } from "@/lib/takeoff/bench/run";
import type { VectorBenchPass } from "@/lib/takeoff/bench/vector-run";
import { renderVisionSection, visionReport } from "@/lib/takeoff/bench/vision-report";
import type { VisionPassSummary } from "@/lib/takeoff/bench/vision-review";

// The report of the bench's vision pass (TI-664 acceptance « jetons et durée p50/p95 par page publiés, durée sans
// régression face à L1 (mêmes pages, même machine) »). Ways it misreports, written before the code:
// - tokens of a call without usage counted as 0 silently (no count of such calls), or a stopped call's tokens summed;
// - a page's duration taken from the vector reading alone, or the L1 durations of other documents compared;
// - « sans régression » stated when the vision pass is slower than L1 at p50 or p95, or when L1 has no such pages.
// Review of the pass (written before the fix):
// - the run's side holds pages L1 never timed alone (fast pages a triage left out, a multi-page chunk), and raster pages
//   whose items come from L1 at the vector reading's time: both sides must be the same pages, counted;
// - nothing says whether the keys at high confidence in error grew after vision (the acceptance counter).

const call = (status: "ok" | "stopped" | "schema_failure", latency: number, total: number | null) =>
  ({ lines: 2, status, latency_ms: latency, usage: total === null ? null : { input_tokens: total - 100, output_tokens: 100, total_tokens: total } });

function vectorPass(pass: number, vision: VisionPassSummary, raster: Array<[string, number]> = []): Pick<VectorBenchPass, "pass" | "vision" | "documents"> {
  const ids = [...new Set(raster.map(([id]) => id))];
  return { pass, vision, documents: ids.map((id) => ({ id, pages: raster.filter(([document]) => document === id)
    .map(([, page]) => ({ page, status: "ok", error: null, reading: null, raster_items_from_baseline: 2 })) })) };
}

function runPass(pass: number, pages: Array<[string, number, number]>): Pick<BenchPass, "pass" | "documents"> {
  const ids = [...new Set(pages.map(([id]) => id))];
  return { pass, documents: ids.map((id) => ({ id, calls: pages.filter(([document]) => document === id)
    .map(([, page, ms]) => ({ status: "ok", start_page: page, end_page: page, duration_ms: ms, duration_per_page_ms: ms })) })) as never };
}

describe("visionReport", () => {
  const vision: VisionPassSummary = { stop: null, documents: [{ id: "a-plan-01", pages: [
    { page: 1, lines: 4, left_out: 0, corrected: 2, calls: [call("ok", 3000, 2100), call("schema_failure", 1000, null)], render_ms: [500, 500, 500, 500],
      answers: [{ alias: "L1", verdict: "corrige", network: "EF", material: "cuivre", dn: "22", label: "EF cu 22", index: 0, designation: "EF DN 22" },
        { alias: "L2", verdict: "illisible", network: null, material: null, dn: null, label: null, index: 1, designation: "EF DN 28" }] },
  ] }] };

  it("sums tokens of the calls with usage, counts those without, and times each page with its vector reading", () => {
    const report = visionReport({ vector: [vectorPass(1, vision)], passes: [runPass(1, [["a-plan-01", 1, 2000], ["a-plan-01", 2, 1000]])],
      baseline: [runPass(1, [["a-plan-01", 1, 60_000], ["a-plan-01", 2, 50_000], ["b-plan-11", 1, 1000]])] });
    expect(report.calls).toEqual({ total: 2, ok: 1, without_usage: 1, by_status: { ok: 1, schema_failure: 1 } });
    expect(report.tokens).toEqual({ input: 2000, output: 100, total: 2100 });
    expect(report.lines).toEqual({ asked: 4, left_out: 0, corrected: 2, verdicts: { corrige: 1, illisible: 1 } });
    // Page 1: 2 s of vectors + 2 s of renders + 4 s of calls; page 2 read without review.
    expect(report.page_ms).toEqual({ p50: 1000, p95: 8000, raw: [8000, 1000] });
    expect(report.reviewed_page_ms).toEqual({ p50: 8000, p95: 8000, raw: [8000] });
    // L1 on the same documents and pages only, both sides (b-plan-11 is not in this run).
    expect(report.l1).toEqual({ pages: 2, raster_pages_left_out: 0, multi_page_calls_left_out: 0,
      run_ms: { p50: 1000, p95: 8000, raw: [8000, 1000] }, baseline_ms: { p50: 50_000, p95: 60_000, raw: [60_000, 50_000] }, regression: false });
  });

  it("compares only the pages both sides timed alone, never a raster page read by L1", () => {
    const report = visionReport({ vector: [vectorPass(1, vision, [["a-plan-01", 3]])],
      passes: [runPass(1, [["a-plan-01", 1, 2000], ["a-plan-01", 2, 500], ["a-plan-01", 3, 300]])],
      baseline: [{ pass: 1, documents: [{ id: "a-plan-01", calls: [
        { status: "ok", start_page: 1, end_page: 1, duration_ms: 60_000, duration_per_page_ms: 60_000 },
        { status: "ok", start_page: 2, end_page: 3, duration_ms: 80_000, duration_per_page_ms: 40_000 },
      ] }] } as never] });
    expect(report.l1).toMatchObject({ pages: 1, raster_pages_left_out: 1, multi_page_calls_left_out: 1,
      run_ms: { raw: [8000] }, baseline_ms: { raw: [60_000] }, regression: false });
  });

  it("flags keys at high confidence in error that grew after vision", () => {
    const rules = (main: number, reserve: number) => ({ version: 1, threshold: 0.5, documents: [], confidence: {
      main: { before: {} as never, after: { keys_high_confidence: 10, keys_high_confidence_error: main } as never },
      reserve: { before: {} as never, after: { keys_high_confidence: 5, keys_high_confidence_error: reserve } as never } } });
    const report = visionReport({ vector: [vectorPass(1, vision)], passes: [], baseline: [],
      scores: [{ pass: 1, after_rules: rules(2, 0), after_vision: rules(2, 1) }] });
    expect(report.keys).toEqual([{ pass: 1, role: "main", after_rules: { high: 10, errors: 2 }, after_vision: { high: 10, errors: 2 } },
      { pass: 1, role: "reserve", after_rules: { high: 5, errors: 0 }, after_vision: { high: 5, errors: 1 } }]);
    expect(report.high_confidence_errors_increased).toBe(true);
    expect(renderVisionSection(report).join("\n")).toContain("hausse des clés à haute confiance en erreur");
  });

  it("states a regression when slower than L1 at p50 or p95, and none when L1 has no such page", () => {
    const slow = visionReport({ vector: [vectorPass(1, vision)], passes: [runPass(1, [["a-plan-01", 1, 70_000]])],
      baseline: [runPass(1, [["a-plan-01", 1, 60_000]])] });
    expect(slow.l1.regression).toBe(true);
    const none = visionReport({ vector: [vectorPass(1, vision)], passes: [runPass(1, [["a-plan-01", 1, 2000]])], baseline: [] });
    expect([none.l1.pages, none.l1.regression]).toEqual([0, null]);
    expect(renderVisionSection(none).join("\n")).toContain("sans baseline L1");
  });
});
