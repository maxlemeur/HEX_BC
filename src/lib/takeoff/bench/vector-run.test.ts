import { describe, expect, it } from "vitest";

import { buildBenchReport, renderBenchReportMarkdown, VECTOR_PRODUCTION_GAPS, type BenchReportMetadata } from "@/lib/takeoff/bench/report";
import { GroupTruthFileSchema, ManifestDocumentSchema, TruthFileSchema, type GroupTruthFile, type ManifestDocument } from "@/lib/takeoff/bench/schemas";
import { buildScoreScopes } from "@/lib/takeoff/bench/score";
import type { BenchPageSelection } from "@/lib/takeoff/bench/pages";
import type { BenchPass, CallStatus, DocumentRun } from "@/lib/takeoff/bench/run";
import { baselineRasterFallback, runVectorBench, stoppedVectorBench, type VectorBenchDocument } from "@/lib/takeoff/bench/vector-run";
import type { GroupDecisionsOutcome } from "@/lib/takeoff/vectors/group-decisions-server";
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
// Fourth Codex round of PR #145 (written before the fix), the baseline's raster
// fallback (baselineRasterFallback, formerly a closure of the script):
// - a baseline run on a subset (--pages, --pages-from) has no call on a page it
//   left out, yet that page is taken as read with no item, and its keys are
//   blamed on the vector reading; a noncontiguous subset (pages 1 and 3 in one
//   chunk, put back as « pages 1-3 ») passes page 2 as read; a document the
//   triage excluded is read;
// - a page under a failed chunk is read, or a page under a successful one is not;
// - pass 4 of a 3-pass baseline does not take pass 1.
// Review of that fix (written before its own fix): a selection whose pages are
// out of order (pages 1, 4, 3, 2 read in two chunks, put back as « 1-4 » and
// « 3-2 ») passes the pages of a failed chunk as read.
// Post-merge Codex review of PR #145 (written before the fix): a baseline item
// without source_page (TakeoffItemSchema makes it optional, and the chunk
// remap keeps it absent) is copied onto every raster page of its document (one
// 10 ml item read twice on a two-page plan) instead of the one page its chunk
// read; when that chunk read several pages, it is put on one of them instead of
// leaving them « unread ».
// Decisions classes of the groups (TI-662 L3c, written before the code):
// - the page is not read again with the hook's answers, so a group Decisions
//   classes EF at 0.9 gives no item; or a proposal at 0.62 is measured;
// - the per-group answers (alias, id, class, confidence, status, via) or the
//   calls are not recorded per page, or a group's confidence is lost;
// - a Decisions stop (failed call, budget, unavailable) lets the run go on to
//   later pages, reports it complete, or scores the document it stopped in; a
//   page whose images could not be drawn (no canvas) ends the run instead of
//   staying « à revoir »;
// - a run Decisions is unavailable for reads pages, or claims calls done.
// Candidates per page (TI-704, written before the code): without a Decisions
// hook, the run does not say which groups it would have sent, so a keywords-
// only run cannot show what the candidate filter keeps; or a filtered group is
// not listed with its reason; or a raster or failed page claims candidates.

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
    const asked: Array<[string, number, number]> = [];
    const extract = async (_bytes: Uint8Array, pageNumber: number) => (pageNumber === 1 ? plan(1, 2, 0.95) : page(2, 2));
    const result = await runVectorBench({
      documents: [benchDocument("a-plan-01", 2)], groups, repeat: 2, extract,
      rasterFallback: (document, pass, pageNumber) => {
        asked.push([document, pass, pageNumber]);
        return baseline[pass].filter((item) => item.source_page === pageNumber);
      },
    });
    const passes = result.run.couples[0].passes;
    // Page 1 is raster: none of its 25.4 m of EF is measured; page 2 is vector and keeps its own (empty) reading.
    expect(passes.map((pass) => pass.documents[0].items)).toEqual([[baseline[1][0]], [baseline[2][0]]]);
    expect(passes.map((pass) => pass.documents[0].item_chunks)).toEqual([[[1]], [[1]]]);
    expect(asked).toEqual([["a-plan-01", 1, 1], ["a-plan-01", 2, 1]]);
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

  it("fails a raster page the baseline did not read, so that its scope is not scored", async () => {
    // Review of 3/11/2026: a raster page whose level C chunk timed out was taken as read with no item, its keys blamed on the vector reading.
    const extract = async (_bytes: Uint8Array, pageNumber: number) => plan(pageNumber, 1, 0.95);
    const result = await runVectorBench({
      documents: [benchDocument("a-plan-01", 1)], groups: new Map(), repeat: 1, extract, rasterFallback: () => "unread",
    });
    const document = result.run.couples[0].passes[0].documents[0];
    expect(document.calls.map((call) => [call.status, call.error?.name])).toEqual([["provider_failed", "VectorExtractionError"]]);
    const report = buildBenchReport({ metadata, run: result.run, scopes: buildScoreScopes([truthOf("a-plan-01", [{ quantity: 30 }])],
      [manifestDocument("a-plan-01", 1)]), noise: null, pipeline: "vector" });
    expect(report.couples[0].passes[0].scopes[0]).toMatchObject({ status: "read_failed", keys: [] });
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

describe("the baseline's raster fallback (fourth Codex round of PR #145)", () => {
  /** A level C run of a 3-page document: its calls as [start, end, status], in original page numbers. */
  function levelCRun(id: string, calls: Array<[number, number, CallStatus]>, items: TakeoffItem[]): DocumentRun {
    return {
      id, lot: "a", role: "truth", sha256: "1".repeat(64), bytes: 4, pages: 3, chunks_planned: calls.length, complete: true,
      calls: calls.map(([start, end, status], index) => ({
        chunk: index + 1, chunks: calls.length, start_page: start, end_page: end, pages: end - start + 1, bytes: 4, status,
        duration_ms: 1000, duration_per_page_ms: 1000, model: "fictional-model", reasoning_effort: null, prompt_version: "v1", usage: null,
        items: status === "ok" ? items.length : null, warnings: status === "ok" ? 0 : null, error: null,
      })),
      failed_chunks: calls.filter(([, , status]) => status !== "ok").length, items, item_chunks: items.map(() => [1]),
      duplicate_items: 0, deduplicated_items: 0,
    };
  }
  const passOf = (pass: number, documents: DocumentRun[]): BenchPass => ({ pass, complete: true, documents });
  const listed = (pagesRead: number[], mode: BenchPageSelection["mode"] = "list"): BenchPageSelection => ({
    mode, triage_report: null, documents: [{ id: "a-plan-01", pages_total: 3, pages_read: pagesRead, excluded: pagesRead.length === 0 }],
  });
  const items = [baselineItem("EF cuivre DN 22", 30, 1), baselineItem("ECS cuivre DN 22", 5, 3)];

  it("reads a page only when a successful call of the baseline covers it and no failed one does", () => {
    const whole = baselineRasterFallback([passOf(1, [levelCRun("a-plan-01", [[1, 3, "ok"]], items)])]);
    expect([1, 2, 3].map((page) => whole("a-plan-01", 1, page))).toEqual([[items[0]], [], [items[1]]]);
    expect(whole("b-plan-01", 1, 1)).toBe("unread");
    const failed = baselineRasterFallback([passOf(1, [levelCRun("a-plan-01", [[1, 2, "ok"], [3, 3, "timeout"]], items)])]);
    expect([1, 2, 3].map((page) => failed("a-plan-01", 1, page))).toEqual([[items[0]], [], "unread"]);
  });

  it("puts an item without source_page on the one page its chunk read, never on every raster page (post-merge review)", async () => {
    const unpaged: TakeoffItem = { designation: "EF cuivre DN 22", quantity: 10, unit: "ml", confidence: 0.9, evidence: "Fictional level C evidence" };
    // One chunk per page; the unpaged item was read by chunk 2 (page 2).
    const perPage = { ...levelCRun("a-plan-01", [[1, 1, "ok"], [2, 2, "ok"], [3, 3, "ok"]], [items[0], unpaged]), item_chunks: [[1], [2]] };
    const placed = baselineRasterFallback([passOf(1, [perPage])]);
    expect([1, 2, 3].map((page) => placed("a-plan-01", 1, page))).toEqual([[items[0]], [unpaged], []]);
    // Read by one chunk over pages 1-3: it belongs to one of them, which one is unknown; those pages stay unread.
    const spanning = { ...levelCRun("a-plan-01", [[1, 3, "ok"]], [items[0], unpaged]), item_chunks: [[1], [1]] };
    const unresolved = baselineRasterFallback([passOf(1, [spanning])]);
    expect([1, 2, 3].map((page) => unresolved("a-plan-01", 1, page))).toEqual(["unread", "unread", "unread"]);
    // Through the bench: a two-page raster plan read one page per chunk keeps the 10 ml once.
    const twoPages = { ...levelCRun("a-plan-01", [[1, 1, "ok"], [2, 2, "ok"]], [unpaged]), pages: 2, item_chunks: [[1]] };
    const extract = async (_bytes: Uint8Array, pageNumber: number) => plan(pageNumber, 2, 0.95);
    const result = await runVectorBench({
      documents: [benchDocument("a-plan-01", 2)], groups: new Map(), repeat: 1, extract, rasterFallback: baselineRasterFallback([passOf(1, [twoPages])]),
    });
    const document = result.run.couples[0].passes[0].documents[0];
    expect(document.calls.map((call) => call.status)).toEqual(["ok", "ok"]);
    expect(document.items).toEqual([unpaged]);
    expect(document.item_chunks).toEqual([[1]]);
  });

  it("never reads a page a subset baseline left out, contiguous or not, nor a document its triage excluded", () => {
    // --pages 1: one call on page 1, even without its page selection.
    const first = [passOf(1, [levelCRun("a-plan-01", [[1, 1, "ok"]], [items[0]])])];
    for (const fallback of [baselineRasterFallback(first, listed([1])), baselineRasterFallback(first)]) {
      expect([1, 2, 3].map((page) => fallback("a-plan-01", 1, page))).toEqual([[items[0]], "unread", "unread"]);
    }
    // --pages 1,3 read in one chunk, put back as pages 1-3: page 2 was never sent.
    const spread = baselineRasterFallback([passOf(1, [levelCRun("a-plan-01", [[1, 3, "ok"]], items)])], listed([1, 3]));
    expect([1, 2, 3].map((page) => spread("a-plan-01", 1, page))).toEqual([[items[0]], "unread", [items[1]]]);
    // A document the triage kept no page of is not in the run.
    expect(baselineRasterFallback([passOf(1, [])], listed([], "triage"))("a-plan-01", 1, 1)).toBe("unread");
    expect(baselineRasterFallback([])("a-plan-01", 1, 1)).toBe("unread");
  });

  it("reads no page of a selection whose pages are out of order", () => {
    // Pages 1, 4, 3, 2 in two chunks: [1, 4] put back as 1-4 (ok), [3, 2] as 3-2 (timed out).
    const run = levelCRun("a-plan-01", [[1, 4, "ok"], [3, 2, "timeout"]], items);
    const fallback = baselineRasterFallback([passOf(1, [run])], listed([1, 4, 3, 2], "triage"));
    expect([1, 2, 3, 4].map((page) => fallback("a-plan-01", 1, page))).toEqual(["unread", "unread", "unread", "unread"]);
  });

  it("takes pass 1 of a 3-pass baseline for pass 4", () => {
    const passes = [1, 2, 3].map((pass) => passOf(pass, [levelCRun("a-plan-01", [[1, 3, "ok"]], [baselineItem("EF cuivre DN 22", 30 + pass, 1)])]));
    const fallback = baselineRasterFallback(passes);
    expect([1, 2, 3, 4].map((pass) => (fallback("a-plan-01", pass, 1) as TakeoffItem[])[0].quantity)).toEqual([31, 32, 33, 31]);
  });

  it("fails the raster page a --pages 1 baseline never read, so that its scope is not scored", async () => {
    const extract = async (_bytes: Uint8Array, pageNumber: number) => plan(pageNumber, 2, 0.95);
    const result = await runVectorBench({
      documents: [benchDocument("a-plan-01", 2)], groups: new Map(), repeat: 1, extract,
      rasterFallback: baselineRasterFallback([passOf(1, [levelCRun("a-plan-01", [[1, 1, "ok"]], [items[0]])])], listed([1])),
    });
    const document = result.run.couples[0].passes[0].documents[0];
    expect(document.calls.map((call) => call.status)).toEqual(["ok", "provider_failed"]);
    const report = buildBenchReport({ metadata, run: result.run, scopes: buildScoreScopes([truthOf("a-plan-01", [{ quantity: 30 }])],
      [manifestDocument("a-plan-01", 2)]), noise: null, pipeline: "vector" });
    expect(report.couples[0].passes[0].scopes[0]).toMatchObject({ status: "read_failed", keys: [] });
  });
});

describe("Decisions classes in the vector bench (TI-662 L3c)", () => {
  function outcome(answers: Array<[string, string, string | null, number | null, "batch" | "dedicated"]>,
    stop: GroupDecisionsOutcome["stop"] = null): GroupDecisionsOutcome {
    return {
      answers: new Map(answers.map(([id, alias, value, confidence, via]) => [id, {
        alias, class: value as never, confidence, status: value === null ? "missing" as const : "answered" as const, via,
      }])),
      calls: [{ kind: "batch", questions: answers.length, status: stop?.reason === "call_failed" ? "failed" : "available",
        usage: { input_tokens: 900, output_tokens: 100, total_tokens: 1000 }, latency_ms: 1200, render_ms: 80 }],
      stop, candidates: answers.length, eligible: answers.length, left_out: 0, dedicated_left_out: 0, render: { legend_ms: 300, sheets_ms: [80] }, calls_ms: null,
    };
  }

  it("reads the page again with the hook's answers, measures 0.8 and more only, and records each group's answer", async () => {
    const seen: Array<[string, number, string | null]> = [];
    const result = await runVectorBench({
      documents: [benchDocument("a-plan-01", 1)], groups: new Map(), repeat: 1, extract: async () => plan(1, 1),
      decisions: {
        promptVersion: "fixture-groups-v1",
        classify: async (document, pageNumber, _extraction, reading) => {
          seen.push([document.id, pageNumber, reading.groups.find((group) => group.id === RED_ID)?.class ?? null]);
          return outcome([[RED_ID, "groupe_01", "EF", 0.9, "batch"], [BLUE_ID, "groupe_02", "EU", 0.62, "dedicated"]]);
        },
      },
    });
    // The hook gets the keyword reading (red unclassed); the run reads again with its answers.
    expect(seen).toEqual([["a-plan-01", 1, null]]);
    const run = result.run.couples[0].passes[0].documents[0];
    expect(run.items.map((item) => [item.designation, item.quantity])).toEqual([["EF cuivre DN 22", 12.7]]);
    expect(result.run.couples[0].prompt_version).toMatch(/^vector-v\d+\+fixture-groups-v1$/);
    const summary = result.vector.passes[0].documents[0].pages[0];
    expect(summary.reading?.groups.find((group) => group.id === BLUE_ID)).toMatchObject({ class: "EU", source: "decisions", confidence: 0.62 });
    // The proposal at 0.62 is neither « classé » nor a measured network group in the page summary (review of the PR).
    expect(summary.reading).toMatchObject({ groups_classified: 1, groups_network: 1 });
    expect(summary.decisions).toMatchObject({
      candidates: 2, left_out: 0, stop: null, calls: [{ kind: "batch", status: "available", usage: { total_tokens: 1000 } }],
      answers: [
        { alias: "groupe_01", group: RED_ID, class: "EF", confidence: 0.9, status: "answered", via: "batch" },
        { alias: "groupe_02", group: BLUE_ID, class: "EU", confidence: 0.62, status: "answered", via: "dedicated" },
      ],
    });
    expect(result.run.status).toBe("complete");
  });

  it("ends the run at a Decisions stop: incomplete, later pages and documents not run, the document not scored", async () => {
    const asked: string[] = [];
    const result = await runVectorBench({
      documents: [benchDocument("a-plan-01", 2), benchDocument("a-plan-02", 1)], groups: new Map(), repeat: 2,
      extract: async (_bytes, pageNumber) => plan(pageNumber, 2),
      decisions: {
        promptVersion: "fixture-groups-v1",
        classify: async (document, pageNumber) => {
          asked.push(`${document.id}:${pageNumber}`);
          return outcome([[RED_ID, "groupe_01", "EF", 0.9, "batch"]], { reason: "call_failed", message: "Fictional failure." });
        },
      },
    });
    expect(asked).toEqual(["a-plan-01:1"]);
    expect(result.run).toMatchObject({
      status: "incomplete", calls_planned: 6, calls_done: 1,
      stop: { kind: "provider", reason: "other", error: { name: "DecisionsStop", code: "call_failed", message: "Fictional failure." },
        calls_done: 1, calls_remaining: 5, at: { model: "vector", pass: 1, document: "a-plan-01", chunk: 1 } },
    });
    const passes = result.run.couples[0].passes;
    expect(passes).toHaveLength(1);
    expect(passes[0]).toMatchObject({ complete: false });
    expect(passes[0].documents.map((document) => [document.id, document.complete, document.calls.length])).toEqual([["a-plan-01", false, 1]]);
    const report = buildBenchReport({ metadata, run: result.run, scopes: buildScoreScopes([truthOf("a-plan-01", [{ quantity: 12.7 }])],
      [manifestDocument("a-plan-01", 2), manifestDocument("a-plan-02", 1)]), noise: null, pipeline: "vector" });
    expect(report.couples[0].passes[0].scopes[0].status).not.toBe("scored");
    expect(result.vector.passes[0].documents[0].pages[0].decisions?.stop).toEqual({ reason: "call_failed", message: "Fictional failure." });
  });

  it("keeps the rules of the documents read before a Decisions stop (TI-664 Codex)", async () => {
    const result = await runVectorBench({
      documents: [benchDocument("a-plan-01", 1), benchDocument("a-plan-02", 1)], groups: new Map(), repeat: 1,
      extract: async (_bytes, pageNumber) => plan(pageNumber, 1),
      decisions: {
        promptVersion: "fixture-groups-v1",
        classify: async (document) => outcome([[RED_ID, "groupe_01", "EF", 0.9, "batch"]],
          document.id === "a-plan-02" ? { reason: "call_failed", message: "Fictional failure." } : null),
      },
    });
    expect(result.run.status).toBe("incomplete");
    const [read, stopped] = result.run.couples[0].passes[0].documents;
    expect([read.id, read.complete, stopped.id, stopped.complete]).toEqual(["a-plan-01", true, "a-plan-02", false]);
    // The document read in full keeps its geometry rules, one list per line; the one the stop cut has none.
    expect(read.items.length).toBeGreaterThan(0);
    expect(read.item_rules?.length).toBe(read.items.length);
    expect(read.item_rules?.[0]?.map((entry) => entry.rule)).toContain("dn_network");
    expect(stopped.item_rules).toBeUndefined();
  });

  it("goes on after a page whose images could not be drawn, its groups « à revoir »", async () => {
    const result = await runVectorBench({
      documents: [benchDocument("a-plan-01", 2)], groups: new Map(), repeat: 1, extract: async (_bytes, pageNumber) => plan(pageNumber, 2),
      decisions: { promptVersion: "fixture-groups-v1",
        classify: async () => ({ ...outcome([]), calls: [], stop: { reason: "canvas_unavailable", message: "Fictional: no canvas." } }) },
    });
    expect(result.run).toMatchObject({ status: "complete", calls_done: 2, stop: null });
    expect(result.vector.passes[0].documents[0].pages.map((entry) => entry.decisions?.stop?.reason)).toEqual(["canvas_unavailable", "canvas_unavailable"]);
    expect(result.run.couples[0].passes[0].documents[0].items).toEqual([]);
  });

  it("records a run Decisions is unavailable for as stopped before its first page", () => {
    const result = stoppedVectorBench([benchDocument("a-plan-01", 2), benchDocument("a-plan-02", 1)], 2, "fixture-groups-v1",
      { reason: "decisions_unavailable", message: "Fictional: disabled." });
    expect(result.run).toMatchObject({
      status: "incomplete", calls_planned: 6, calls_done: 0,
      stop: { kind: "provider", error: { code: "decisions_unavailable" }, calls_done: 0, calls_remaining: 6, at: null },
    });
    expect(result.vector.passes).toEqual([]);
    const report = buildBenchReport({ metadata, run: result.run, scopes: [], noise: null, pipeline: "vector" });
    expect(renderBenchReportMarkdown(report)).toContain("decisions_unavailable");
  });
});

describe("Decisions candidates recorded per page (TI-704)", () => {
  const GREY: VectorGroupKey = { layer: null, color: "#808080", width: 1, dash: null };
  const GREY_ID = "c:#808080|w:1|d:";

  it("lists the groups a keyword reading would send, and those filtered with their reason, without any hook", async () => {
    const withGrey = (number: number, imageCoverage = 0): VectorPageExtraction => {
      const base = plan(number, 2, imageCoverage);
      const start = base.points.length / 2;
      return { ...base, groups: [RED, BLUE, GREY], paths: [...base.paths, { group: 2, start, count: 2, closed: false }],
        points: Float32Array.from([...base.points, 100, 700, 700, 700]) };
    };
    const result = await runVectorBench({
      documents: [benchDocument("a-plan-01", 2)], groups: new Map(), repeat: 1,
      extract: async (_bytes, pageNumber) => (pageNumber === 1 ? withGrey(1) : withGrey(2, 0.95)),
    });
    const [vector, raster] = result.vector.passes[0].documents[0].pages;
    expect(vector.candidates).toEqual({ selected: [RED_ID, BLUE_ID], eligible: 2, left_out: 0, filtered: [{ group: GREY_ID, reason: "grey" }] });
    expect(vector.decisions).toBeUndefined();
    expect(raster.candidates).toEqual({ selected: [], eligible: 0, left_out: 0, filtered: [] });
    const failed = await runVectorBench({
      documents: [benchDocument("a-plan-01", 1)], groups: new Map(), repeat: 1,
      extract: async () => { throw new VectorExtractionError("timeout", "Fictional timeout."); },
    });
    expect(failed.vector.passes[0].documents[0].pages[0].candidates).toBeUndefined();
  });
});
