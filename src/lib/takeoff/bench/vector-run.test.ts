import { describe, expect, it } from "vitest";

import { buildBenchReport, renderBenchReportMarkdown, VECTOR_PRODUCTION_GAPS, type BenchReportMetadata } from "@/lib/takeoff/bench/report";
import { GroupTruthFileSchema, ManifestDocumentSchema, TruthFileSchema, type GroupTruthFile, type ManifestDocument } from "@/lib/takeoff/bench/schemas";
import { buildScoreScopes } from "@/lib/takeoff/bench/score";
import { runVectorBench, type VectorBenchDocument } from "@/lib/takeoff/bench/vector-run";
import {
  VectorExtractionError,
  type VectorGroupKey,
  type VectorPageExtraction,
  type VectorPath,
  type VectorText,
} from "@/lib/takeoff/vectors/extraction";
import type { TakeoffItem } from "@/lib/takeoff/types";

// Ways the vector pipeline of the takeoff bench (TI-662 §6) could misreport a
// run, written before the tests. Every document, label and quantity is
// fictional; pages are hand-built extractions, no child process runs:
// - a page whose extraction times out (or fails otherwise) is counted as read:
//   its scope is scored, every key of the page blamed on the reading, instead of
//   a « timeout » call (a failed call for other extraction errors) and a
//   read_failed scope listing the unread page;
// - an error of the bench itself (not of the extraction) is swallowed as a
//   failed page, so a broken reader produces a « complete » run;
// - a timeout is counted in the latency at the 180 s floor of the ChatGPT
//   pipeline, or at its own short duration, instead of at least 15 s;
// - the report does not say it is a vector run (pipeline, rules, production
//   gaps), so a reader takes it for a level C run;
// - a raster page (images over 90 % of it) is measured from its vectors, or
//   takes the baseline items of another pass or of another page;
// - the truth/groups of the document are ignored: the correspondence that sets
//   a colour group to EF is not applied, or applied on a page it was not given
//   for; the page calibration is ignored (the cartouche scale stands instead),
//   or applied to another page.
// Not testable here: the modulo of the script's rasterFallback (pass 4 of a
// 3-pass baseline takes pass 1) lives in scripts/run-takeoff-provider-benchmark.ts,
// an unexported closure; runVectorBench only asks for the pass it runs.

/** An A3 sheet in points (420 × 297 mm). */
const SHEET = { width: 1190.55, height: 841.89 };
const RED: VectorGroupKey = { layer: null, color: "#ff0000", width: 1, dash: null };
const BLUE: VectorGroupKey = { layer: null, color: "#0000ff", width: 1, dash: null };
const RED_ID = "c:#ff0000|w:1|d:";
const BLUE_ID = "c:#0000ff|w:1|d:";

function text(str: string, x: number, y: number, width: number, height = 6): VectorText {
  return { str, x, y, width, height, angle: 0 };
}

type Stroke = { group: number; points: Array<[number, number]> };

function page(number: number, pages: number, options: { strokes?: Stroke[]; texts?: VectorText[]; imageCoverage?: number } = {}): VectorPageExtraction {
  const coordinates: number[] = [];
  const paths: VectorPath[] = [];
  for (const stroke of options.strokes ?? []) {
    paths.push({ group: stroke.group, start: coordinates.length / 2, count: stroke.points.length, closed: false });
    for (const [x, y] of stroke.points) coordinates.push(x, y);
  }
  const imageCoverage = options.imageCoverage ?? 0;
  return {
    page: number, pages, width: SHEET.width, height: SHEET.height, userUnit: 1, rotate: 0, layers: [], groups: [RED, BLUE],
    texts: options.texts ?? [], paths, points: Float32Array.from(coordinates),
    counts: { operators: 10, strokePaths: paths.length, fillPaths: 0, clipPaths: 0, images: imageCoverage > 0 ? 1 : 0, imageCoverage },
    timings: { operators_ms: 1, walk_ms: 1, text_ms: 1, total_ms: 3 }, memory: { max_rss_kb: 50_000, heap_used_mb: 20 },
  };
}

/**
 * A red pipe of 720 pt (25.4 m at 1/100, 12.7 m at 1/50) labelled inline « EF cuivre DN 22 », a blue pipe without
 * label, and a cartouche « Échelle 1/50 » on an A3 « Format A3 »: without calibration the page reads at 1/50.
 */
function plan(number: number, pages: number, imageCoverage = 0) {
  return page(number, pages, {
    imageCoverage,
    strokes: [{ group: 0, points: [[100, 400], [820, 400]] }, { group: 1, points: [[100, 600], [500, 600]] }],
    texts: [text("EF cuivre DN 22", 400, 396, 60), text("Échelle 1/50", 1000, 780, 50, 5), text("Format A3", 1000, 800, 40, 5)],
  });
}

function manifestDocument(id: string, pages: number, overrides: Record<string, unknown> = {}): ManifestDocument {
  const [lot, kind] = id.split("-");
  return ManifestDocumentSchema.parse({
    id, lot, kind, drive_id: `fixture-${id}`, original_title: `Fictional ${id}`, project: null, file_type: "pdf",
    file_size: 100, modified_time: "2026-01-06T10:00:00.000Z", raw_status: "binary", raw_path: `raw/${id}.pdf`,
    sha256: "0".repeat(64), structure_check: { status: "passed", method: "fixture", detail: null }, pages,
    format: "A3", scale: "1/50", index: "A", vector: true, ocg_count: 0, level: "R+1", zone: "Z1", role: "truth",
    duplicate_of: null, notes: null, ...overrides,
  });
}

function truthOf(id: string, lines: Array<Record<string, unknown>>) {
  return {
    file: `truth/${id}.json`,
    truth: TruthFileSchema.parse({
      schema_version: 1, lot: "a", scope: "document", documents: [id], source_document: "a-devis-01", rules: "Fictional rule.",
      lines: lines.map((overrides, row) => ({
        kind: "network", zone: "Z1", level: "R+1", network: "EF", material: "cuivre", dn: "DN 22", organ: null, room: null,
        unit: "ml", quantity: 10, observable_on_plan: true,
        source: { document: "a-devis-01", sheet: "Lot", row: row + 1, row_basis: "workbook", text: "Fictional row" }, ...overrides,
      })),
    }),
  };
}

function benchDocument(id: string, pages: number): VectorBenchDocument {
  return { id, lot: id.split("-")[0], role: "truth", bytes: new Uint8Array([37, 80, 68, 70]), sha256: "1".repeat(64), pages };
}

function groupsOf(document: string, value: Record<string, unknown>): Map<string, GroupTruthFile> {
  return new Map([[document, GroupTruthFileSchema.parse({ schema_version: 1, document, groups: [], ...value })]]);
}

const metadata: BenchReportMetadata = {
  started_at: "2026-11-03T10:00:00.000Z", finished_at: "2026-11-03T10:01:00.000Z", command: ["npm", "run", "takeoff:bench", "--", "--pipeline", "vector"],
  cwd: "/fixture/checkout", env: {}, node: "v26.12.1", commit: "f".repeat(40), dirty: false,
  dataset: { sha256: "e".repeat(64), documents: [], skipped: [] }, profile: { model: null, reasoning_effort: null, unchanged: null },
};

function baselineItem(designation: string, quantity: number, sourcePage: number): TakeoffItem {
  return { designation, quantity, unit: "ml", source_page: sourcePage, confidence: 0.9, evidence: "Fictional level C evidence" };
}

describe("takeoff bench vector pipeline", () => {
  it("counts a page whose extraction times out as a timeout call, its scope read_failed, at the 15 s floor", async () => {
    let now = 0;
    let extracting = "";
    const extract = async (pageNumber: number) => {
      if (extracting === "a-plan-01" && pageNumber === 1) {
        now += 2_000;
        throw new VectorExtractionError("timeout", "Fictional timeout after the deadline.");
      }
      if (extracting === "a-plan-02") throw new VectorExtractionError("too_large", "Fictional page over the point budget.");
      now += 500;
      return plan(pageNumber, 2);
    };
    const documents = [benchDocument("a-plan-01", 2), benchDocument("a-plan-02", 1)];
    const result = await runVectorBench({
      documents, repeat: 1, clock: () => now,
      groups: groupsOf("a-plan-01", { groups: [{ page: 2, group: RED_ID, class: "EF" }], calibrations: [{ page: 2, denominator: 100, source: "Fictional" }] }),
      extract: (bytes, pageNumber) => {
        extracting = documents.find((document) => document.bytes === bytes)?.id ?? "";
        return extract(pageNumber);
      },
    });
    const runs = result.run.couples[0].passes[0].documents;
    expect(runs.map((run) => run.calls.map((call) => call.status))).toEqual([["timeout", "ok"], ["provider_failed"]]);
    expect(runs.map((run) => run.failed_chunks)).toEqual([1, 1]);
    expect(runs[0].calls[0]).toMatchObject({ start_page: 1, end_page: 1, duration_ms: 2_000, items: null,
      error: { name: "VectorExtractionError", message: "Fictional timeout after the deadline." } });
    // The page read after the timeout still gives its item, but the scope is not scored.
    expect(runs[0].items).toMatchObject([{ designation: "EF cuivre DN 22", quantity: 25.4, source_page: 2 }]);
    expect(result.run).toMatchObject({ status: "complete", calls_planned: 3, calls_done: 3 });
    expect(result.vector.passes[0].documents[0].pages.map((entry) => entry.status)).toEqual(["failed", "ok"]);

    const scopes = buildScoreScopes([truthOf("a-plan-01", [{ quantity: 25.4 }])],
      [manifestDocument("a-plan-01", 2), manifestDocument("a-plan-02", 1)]);
    const report = buildBenchReport({ metadata, run: result.run, scopes, noise: null, pipeline: "vector", vectorRules: { fixture_rule: 1 } });
    const pass = report.couples[0].passes[0];
    expect(pass.scopes).toMatchObject([{
      documents: ["a-plan-01"], status: "read_failed", keys: [],
      unread_pages: [{ document: "a-plan-01", start_page: 1, end_page: 1, status: "timeout" }],
    }]);
    expect(pass.summary.main.all.score).toMatchObject({ scopes: 1, scopes_read_failed: 1, keys_scored: 0, keys_missed: 0 });
    // The timeout of 2 s counts at least 15 s; the ok page counts its own 0.5 s; a failed page counts in neither.
    expect(pass.summary.main.all.latency_per_page).toEqual({ n: 2, p50_ms: 500, p95_ms: 15_000, timeouts_counted_at_ms: 15_000 });
    expect(pass.summary.main.all.timeouts).toMatchObject([{ document: "a-plan-01", start_page: 1, duration_ms: 2_000, model: "vector" }]);
    expect(pass.summary.main.all.statuses).toMatchObject({ ok: 1, timeout: 1, provider_failed: 1 });
  });

  it("stops on an error of the bench itself instead of counting it as a failed page", async () => {
    const crash = new Error("Fictional crash of the reader.");
    await expect(runVectorBench({
      documents: [benchDocument("a-plan-01", 1)], groups: new Map(), repeat: 1,
      extract: async () => {
        throw crash;
      },
    })).rejects.toBe(crash);
  });

  it("records the vector pipeline, its rules and the 15 s timeout floor in the report", async () => {
    const result = await runVectorBench({ documents: [benchDocument("a-plan-01", 1)], groups: new Map(), repeat: 1, extract: async () => plan(1, 1) });
    const report = buildBenchReport({
      metadata, run: result.run, scopes: buildScoreScopes([truthOf("a-plan-01", [{}])], [manifestDocument("a-plan-01", 1)]), noise: null,
      pipeline: "vector", vectorRules: { extraction: { timeout_ms_per_page: 15_000 } },
    });
    expect(report.pipeline).toBe("vector");
    expect(report.production_gaps).toEqual(VECTOR_PRODUCTION_GAPS);
    expect(report.rules).toMatchObject({ vector: { extraction: { timeout_ms_per_page: 15_000 } }, latency: expect.stringMatching(/max\(duration, 15 s\)/) });
    expect(report.rules).not.toHaveProperty("prompt");
    expect(report.couples).toMatchObject([{ model: "vector", reasoning_effort: null, prompt_version: expect.stringMatching(/^vector-v\d+$/) }]);
    expect(report.couples[0].passes[0].summary.main.all.latency_per_page.timeouts_counted_at_ms).toBe(15_000);
    const markdown = renderBenchReportMarkdown(report);
    expect(markdown).toContain("lecture vectorielle (TI-662)");
    expect(markdown).toContain("timeouts ≥ 15 s");
    expect(markdown).not.toContain("Profil ChatGPT");

    const level = buildBenchReport({ metadata, run: result.run, scopes: [], noise: null });
    expect(level.pipeline).toBeUndefined();
    expect(level.couples[0].passes[0].summary.main.all.latency_per_page.timeouts_counted_at_ms).toBe(180_000);
  });

  it("gives a raster page no vector item and the baseline items of its page in the same pass", async () => {
    const groups = groupsOf("a-plan-01", {
      groups: [{ page: 1, group: RED_ID, class: "EF" }], calibrations: [{ page: 1, denominator: 100, source: "Fictional" }],
    });
    const baseline: Record<number, TakeoffItem[]> = {
      1: [baselineItem("EF cuivre DN 22", 30, 1), baselineItem("ECS cuivre DN 22", 5, 2)],
      2: [baselineItem("EF cuivre DN 22", 31, 1), baselineItem("ECS cuivre DN 22", 6, 2)],
    };
    const asked: Array<[string, number]> = [];
    const extract = async (_bytes: Uint8Array, pageNumber: number) => (pageNumber === 1 ? plan(1, 2, 0.95) : page(2, 2));
    const result = await runVectorBench({
      documents: [benchDocument("a-plan-01", 2)], groups, repeat: 2, extract,
      rasterFallback: (document, pass) => {
        asked.push([document, pass]);
        return baseline[pass];
      },
    });
    const passes = result.run.couples[0].passes;
    // Page 1 is raster: none of its 25.4 m of EF is measured; page 2 is vector and keeps its own (empty) reading.
    expect(passes.map((pass) => pass.documents[0].items)).toEqual([[baseline[1][0]], [baseline[2][0]]]);
    expect(passes.map((pass) => pass.documents[0].item_chunks)).toEqual([[[1]], [[1]]]);
    expect(asked).toEqual([["a-plan-01", 1], ["a-plan-01", 2]]);
    const pages = result.vector.passes[0].documents[0].pages;
    expect(pages.map((entry) => [entry.reading?.mode, entry.raster_items_from_baseline])).toEqual([["raster", 1], ["colours", null]]);
    expect(pages[0].reading?.networks).toBeNull();

    const report = buildBenchReport({ metadata, run: result.run, scopes: buildScoreScopes([truthOf("a-plan-01", [{ quantity: 30 }])],
      [manifestDocument("a-plan-01", 2)]), noise: null, pipeline: "vector" });
    expect(report.couples[0].passes.map((pass) => pass.scopes[0].keys[0])).toMatchObject([
      { status: "ok", expected: 30, actual: 30 }, { status: "ok", expected: 30, actual: 31 },
    ]);

    const alone = await runVectorBench({ documents: [benchDocument("a-plan-01", 2)], groups, repeat: 1, extract });
    expect(alone.run.couples[0].passes[0].documents[0].items).toEqual([]);
    expect(alone.vector.passes[0].documents[0].pages.map((entry) => entry.raster_items_from_baseline)).toEqual([null, null]);
  });

  it("applies the correspondences and the calibration of truth/groups to their own page only", async () => {
    // Page 1: red is EF, calibrated at 1/100. Page 2: red is EF, no calibration (cartouche 1/50 on an A3 format);
    // blue is ECS on page 2 only, where no blue is drawn.
    const groups = groupsOf("a-plan-01", {
      groups: [{ page: 1, group: RED_ID, class: "EF" }, { page: 2, group: RED_ID, class: "EF" }, { page: 2, group: BLUE_ID, class: "ECS" }],
      calibrations: [{ page: 1, denominator: 100, source: "Fictional cote checked by hand" }],
    });
    const extract = async (_bytes: Uint8Array, pageNumber: number) => (pageNumber === 1 ? plan(1, 2)
      : page(2, 2, { strokes: [{ group: 0, points: [[100, 400], [820, 400]] }],
        texts: [text("EF cuivre DN 22", 400, 396, 60), text("Échelle 1/50", 1000, 780, 50, 5), text("Format A3", 1000, 800, 40, 5)] }));
    const result = await runVectorBench({ documents: [benchDocument("a-plan-01", 2)], groups, repeat: 1, extract });

    const run = result.run.couples[0].passes[0].documents[0];
    expect(run.items.map((entry) => [entry.designation, entry.quantity, entry.unit, entry.source_page])).toEqual([
      ["EF cuivre DN 22", 25.4, "ml", 1], ["EF cuivre DN 22", 12.7, "ml", 2],
    ]);
    const [first, second] = result.vector.passes[0].documents[0].pages.map((entry) => entry.reading);
    expect(first?.scale).toMatchObject({ status: "calibrated", denominator: 100, calibration: { denominator: 100, source: "Fictional cote checked by hand" } });
    expect(second?.scale).toMatchObject({ status: "format", denominator: 50, calibration: null });
    expect(first?.groups.map((group) => [group.id, group.class, group.source])).toEqual([[RED_ID, "EF", "document"], [BLUE_ID, null, null]]);
    expect(second?.groups.find((group) => group.id === BLUE_ID)).toMatchObject({ class: "ECS", source: "document" });

    const report = buildBenchReport({ metadata, run: result.run, scopes: buildScoreScopes([truthOf("a-plan-01", [{ quantity: 38.1 }])],
      [manifestDocument("a-plan-01", 2)]), noise: null, pipeline: "vector" });
    const scope = report.couples[0].passes[0].scopes[0];
    expect(scope.keys).toMatchObject([{ key: { network: "EF", material: "cuivre", dn: "DN 22" }, status: "ok", expected: 38.1, actual: 38.1, items: 2 }]);
    expect(scope.false_positives).toEqual([]);
  });
});
