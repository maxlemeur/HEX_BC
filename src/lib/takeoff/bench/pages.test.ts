// Ways the page selection of an extraction (TI-663 « après ») could measure the
// wrong pages, written before the code:
// - a subset keeps another page, reorders pages, or sends the whole document;
// - a page beyond the document is silently dropped instead of refused;
// - a triage report of another document version (SHA) or without the document is used;
// - a document whose pages are all excluded is still read (or read in full).
// Found in review, written before its fix: pages of a subset are reported (and
// scored against page_ranges) in subset numbers instead of the original ones.
// Review of the fourth Codex round of PR #145 (written before the fix): a triage
// report whose kept pages are out of order, repeated or beyond the document is
// read as given, so a subset call, put back by its first and last page, claims
// pages it never held (and the raster fallback of a vector run reads them).
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { remapBenchRunPages, selectBenchPages, subsetPdfPages } from "@/lib/takeoff/bench/pages";
import type { BenchRunResult } from "@/lib/takeoff/bench/run";
import type { ManifestDocument } from "@/lib/takeoff/bench/schemas";

async function labelledPdf(count: number) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let page = 1; page <= count; page += 1) pdf.addPage([200, 200 + page]).drawText(`page ${page}`, { x: 10, y: 10, size: 12, font });
  return Buffer.from(await pdf.save());
}

const doc = (id: string, pages: number, sha = "a".repeat(64)) => ({ id, pages, sha256: sha } as ManifestDocument);

describe("bench page selection", () => {
  it("copies only the requested pages, in their order", async () => {
    const subset = await PDFDocument.load(await subsetPdfPages(await labelledPdf(4), [2, 4]));
    expect(subset.getPages().map((page) => page.getHeight())).toEqual([202, 204]);
  });

  it("applies a page list to every document and refuses a page beyond one", async () => {
    const selected = [{ document: doc("e-plan-01", 4), bytes: await labelledPdf(4) }];
    const result = await selectBenchPages(selected, { pages: [1, 3], triage: null });
    expect(result.documents.map((entry) => entry.document.id)).toEqual(["e-plan-01"]);
    expect((await PDFDocument.load(result.documents[0].bytes)).getPageCount()).toBe(2);
    expect(result.selection).toEqual({ mode: "list", triage_report: null, documents: [{ id: "e-plan-01", pages_total: 4, pages_read: [1, 3], excluded: false }] });
    await expect(selectBenchPages(selected, { pages: [5], triage: null })).rejects.toThrow(/page 5.*4 pages/);
  });

  it("reads the kept pages of a triage report and leaves out a fully excluded document", async () => {
    const selected = [
      { document: doc("e-plan-20", 1), bytes: await labelledPdf(1) },
      { document: doc("e-plan-01", 2), bytes: await labelledPdf(2) },
    ];
    const triage = { path: "/fixture/triage/report.json", sha256: "b".repeat(64), retained: [
      { id: "e-plan-20", sha256: "a".repeat(64), page_count: 1, retained_pages: [] },
      { id: "e-plan-01", sha256: "a".repeat(64), page_count: 2, retained_pages: [1, 2] },
    ] };
    const result = await selectBenchPages(selected, { pages: null, triage });
    expect(result.documents.map((entry) => entry.document.id)).toEqual(["e-plan-01"]);
    expect(result.documents[0].bytes).toBe(selected[1].bytes);
    expect(result.selection.documents).toEqual([
      { id: "e-plan-20", pages_total: 1, pages_read: [], excluded: true },
      { id: "e-plan-01", pages_total: 2, pages_read: [1, 2], excluded: false },
    ]);
    await expect(selectBenchPages([{ document: doc("e-plan-02", 1), bytes: await labelledPdf(1) }], { pages: null, triage })).rejects.toThrow(/e-plan-02 is not in the triage report/);
    await expect(selectBenchPages([{ document: doc("e-plan-01", 2, "c".repeat(64)), bytes: await labelledPdf(2) }], { pages: null, triage })).rejects.toThrow(/another version/);
  });

  it("refuses a triage report whose kept pages are out of order, repeated or beyond the document", async () => {
    const selected = [{ document: doc("e-plan-01", 3), bytes: await labelledPdf(3) }];
    const triageOf = (retained: number[]) => ({ path: "/fixture/triage/report.json", sha256: "b".repeat(64), retained: [
      { id: "e-plan-01", sha256: "a".repeat(64), page_count: 3, retained_pages: retained },
    ] });
    for (const retained of [[3, 1], [1, 1], [4], [0]]) {
      await expect(selectBenchPages(selected, { pages: null, triage: triageOf(retained) })).rejects.toThrow(/e-plan-01: the triage report/);
    }
    expect((await selectBenchPages(selected, { pages: null, triage: triageOf([1, 3]) })).selection.documents[0].pages_read).toEqual([1, 3]);
  });

  it("puts back the original page numbers of a subset in calls and items", () => {
    const result = {
      status: "complete", stop: null, calls_planned: 1, calls_done: 1,
      couples: [{ model: "m", reasoning_effort: null, override: false, prompt_version: "p", passes: [{ pass: 1, complete: true, documents: [{
        id: "e-plan-01", calls: [{ start_page: 1, end_page: 2 }], items: [{ source_page: 1 }, { source_page: 2 }, { source_page: null }],
      }] }] }],
    } as unknown as BenchRunResult;
    const remapped = remapBenchRunPages(result, new Map([["e-plan-01", [2, 4]]]));
    const document = remapped.couples[0].passes[0].documents[0];
    expect(document.calls.map((entry) => [entry.start_page, entry.end_page])).toEqual([[2, 4]]);
    expect(document.items.map((entry) => entry.source_page)).toEqual([2, 4, null]);
  });
});
