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

const call = (status: "ok" | "stopped" | "schema_failure", latency: number, total: number | null) =>
  ({ lines: 2, status, latency_ms: latency, usage: total === null ? null : { input_tokens: total - 100, output_tokens: 100, total_tokens: total } });

function vectorPass(pass: number, vision: VisionPassSummary): Pick<VectorBenchPass, "pass" | "vision"> {
  return { pass, vision };
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
    // L1 on the same documents and pages only (b-plan-11 is not in this run).
    expect(report.baseline_page_ms).toEqual({ p50: 50_000, p95: 60_000, raw: [60_000, 50_000] });
    expect(report.regression).toBe(false);
  });

  it("states a regression when slower than L1 at p50 or p95, and none when L1 has no such page", () => {
    const slow = visionReport({ vector: [vectorPass(1, vision)], passes: [runPass(1, [["a-plan-01", 1, 70_000]])],
      baseline: [runPass(1, [["a-plan-01", 1, 60_000]])] });
    expect(slow.regression).toBe(true);
    const none = visionReport({ vector: [vectorPass(1, vision)], passes: [runPass(1, [["a-plan-01", 1, 2000]])], baseline: [] });
    expect([none.baseline_page_ms, none.regression]).toEqual([{ p50: null, p95: null, raw: [] }, null]);
    expect(renderVisionSection(none).join("\n")).toContain("sans baseline L1");
  });
});
