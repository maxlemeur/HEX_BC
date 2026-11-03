import { PDFDocument } from "pdf-lib";

import type { BenchRunResult } from "@/lib/takeoff/bench/run";
import type { ManifestDocument } from "@/lib/takeoff/bench/schemas";

// Pages an extraction reads (TI-663 before/after). As the worker does for the
// confirmed pages of a preparation (loadPreparedPlanSource), the selected pages
// are copied, in order, into one PDF; all pages keep the original bytes. A page
// beyond a document is refused; a document whose triage kept no page is left
// out and listed as excluded. A triage report must name the same document SHA,
// and its kept pages must rise strictly within the document: a call is put back
// by its first and last page, which only holds for pages in order.
// Pages of a subset are put back in original numbers before scoring and report.

export type BenchTriageRetained = { id: string; sha256: string | null; page_count: number; retained_pages: number[] };
export type BenchPageSelection = {
  mode: "all" | "list" | "triage";
  triage_report: { path: string; sha256: string } | null;
  documents: Array<{ id: string; pages_total: number; pages_read: number[]; excluded: boolean }>;
};

export async function subsetPdfPages(bytes: Uint8Array, pages: readonly number[]): Promise<Buffer> {
  const source = await PDFDocument.load(bytes, { updateMetadata: false });
  const target = await PDFDocument.create({ updateMetadata: false });
  for (const page of await target.copyPages(source, pages.map((page) => page - 1))) target.addPage(page);
  return Buffer.from(await target.save());
}

export async function selectBenchPages<T extends { document: ManifestDocument; bytes: Buffer }>(selected: readonly T[], input: {
  pages: number[] | null;
  triage: { path: string; sha256: string; retained: BenchTriageRetained[] } | null;
}): Promise<{ documents: T[]; selection: BenchPageSelection; pageMaps: Map<string, number[]> }> {
  const selection: BenchPageSelection = {
    mode: input.triage ? "triage" : input.pages ? "list" : "all",
    triage_report: input.triage ? { path: input.triage.path, sha256: input.triage.sha256 } : null,
    documents: [],
  };
  const documents: T[] = [];
  const pageMaps = new Map<string, number[]>();
  for (const entry of selected) {
    const total = entry.document.pages ?? (await PDFDocument.load(entry.bytes, { updateMetadata: false })).getPageCount();
    let pages = Array.from({ length: total }, (_, index) => index + 1);
    if (input.triage) {
      const retained = input.triage.retained.find((candidate) => candidate.id === entry.document.id);
      if (!retained) throw new Error(`${entry.document.id} is not in the triage report ${input.triage.path}.`);
      if (retained.sha256 !== entry.document.sha256 || retained.page_count !== total) {
        throw new Error(`${entry.document.id}: the triage report read another version of the document.`);
      }
      if (retained.retained_pages.some((page, index, list) => page < 1 || page > total || (index > 0 && page <= list[index - 1]))) {
        throw new Error(`${entry.document.id}: the triage report keeps pages out of order, twice or beyond its ${total} pages.`);
      }
      pages = retained.retained_pages;
    } else if (input.pages) {
      const beyond = input.pages.find((page) => page > total);
      if (beyond !== undefined) throw new Error(`${entry.document.id}: page ${beyond} is beyond its ${total} pages.`);
      pages = input.pages;
    }
    selection.documents.push({ id: entry.document.id, pages_total: total, pages_read: pages, excluded: pages.length === 0 });
    if (!pages.length) continue;
    if (pages.length === total) {
      documents.push(entry);
      continue;
    }
    pageMaps.set(entry.document.id, [...pages]);
    documents.push({ ...entry, bytes: await subsetPdfPages(entry.bytes, pages) });
  }
  return { documents, selection, pageMaps };
}

/** Subset page numbers of calls and items back to the original document, as the worker does. */
export function remapBenchRunPages(run: BenchRunResult, pageMaps: ReadonlyMap<string, readonly number[]>): BenchRunResult {
  if (!pageMaps.size) return run;
  const original = (map: readonly number[], page: number | null | undefined) => (page == null ? page : map[page - 1] ?? page);
  return {
    ...run,
    couples: run.couples.map((couple) => ({
      ...couple,
      passes: couple.passes.map((pass) => ({
        ...pass,
        documents: pass.documents.map((document) => {
          const map = pageMaps.get(document.id);
          if (!map) return document;
          return {
            ...document,
            calls: document.calls.map((call) => ({ ...call, start_page: original(map, call.start_page) as number, end_page: original(map, call.end_page) as number })),
            items: document.items.map((item) => ({ ...item, source_page: original(map, item.source_page) as typeof item.source_page })),
          };
        }),
      })),
    })),
  };
}
