import type { BenchPageSelection } from "@/lib/takeoff/bench/pages";
import type { BenchPass, BenchRunResult, ChunkCall, DocumentRun } from "@/lib/takeoff/bench/run";
import { describeError } from "@/lib/takeoff/bench/run";
import type { GroupTruthFile } from "@/lib/takeoff/bench/schemas";
import { extractVectorPage, VectorExtractionError, type VectorPageExtraction } from "@/lib/takeoff/vectors/extraction";
import { isNetworkClass, isVectorClass } from "@/lib/takeoff/vectors/classify";
import { vectorItems } from "@/lib/takeoff/vectors/items";
import type { NetworkMeasure } from "@/lib/takeoff/vectors/measure";
import { readVectorPage, VECTOR_READING_VERSION, type VectorPageReading } from "@/lib/takeoff/vectors/pipeline";
import type { VectorClass } from "@/lib/takeoff/vectors/vocabulary";
import type { TakeoffItem } from "@/lib/takeoff/types";

// The vector pipeline of the takeoff bench (TI-662 §6), next to the level C
// baseline: per pass and document, each page is extracted (child process, 15 s,
// killed at the deadline), read with keywords and the document's truth/groups
// (correspondences and page calibrations), and turned into items scored like a
// level C answer. No provider call. A page whose extraction fails (timeout, too
// large, invalid output) is a failed « call »: its document's scope is not
// scored; any other error is the bench's own and stops the run. A
// raster page (images over 90 % of it) gives no vector item: the level C
// reading of the baseline stands for it when the run is given one (pipeline
// step 5) — a raster page the baseline did not read fails, it is never scored
// as read with no item — otherwise it has none.

export const VECTOR_PIPELINE_LABEL = "vector";

export type VectorBenchDocument = { id: string; lot: string; role: "truth" | "reserve"; bytes: Uint8Array; sha256: string; pages: number };

export type VectorReadingSummary = Omit<VectorPageReading, "networks" | "groups" | "surfaces"> & {
  groups: Array<Pick<VectorPageReading["groups"][number], "id" | "layerName" | "colors" | "length_pt" | "nearWhite" | "grey" | "class" | "source" | "candidates">>;
  /** Rooms without their outline points: the report keeps areas, not geometry. */
  surfaces: Array<Omit<VectorPageReading["surfaces"][number], "outline">>;
  groups_classified: number;
  groups_network: number;
  /** Near-white groups classified as a network: must stay 0 (TI-658 pitfall). */
  near_white_network_groups: number;
  networks: (Omit<NetworkMeasure, "runs"> & { runs: number }) | null;
};

export type VectorPageSummary = {
  page: number;
  status: "ok" | "failed";
  error: { name: string; code: string | null; message: string } | null;
  reading: VectorReadingSummary | null;
  /** Items the level C baseline gave a raster page (null: the page is vector, or no baseline). */
  raster_items_from_baseline: number | null;
};

export type VectorDocumentSummary = { id: string; pages: VectorPageSummary[] };
export type VectorBenchPass = { pass: number; documents: VectorDocumentSummary[] };

export type VectorBenchResult = { run: BenchRunResult; vector: { version: number; passes: VectorBenchPass[] } };

function correspondencesOf(groups: GroupTruthFile | undefined, page: number) {
  const map = new Map<string, VectorClass>();
  for (const entry of groups?.groups ?? []) {
    if (entry.page === page && isVectorClass(entry.class)) map.set(entry.group, entry.class);
  }
  return map;
}

function summarize(reading: VectorPageReading): VectorReadingSummary {
  const { networks, groups, surfaces, ...rest } = reading;
  const isNetwork = (group: VectorPageReading["groups"][number]) => isNetworkClass(group.class);
  return {
    ...rest,
    groups: groups.map((group) => ({ id: group.id, layerName: group.layerName, colors: group.colors, length_pt: group.length_pt,
      nearWhite: group.nearWhite, grey: group.grey, class: group.class, source: group.source, candidates: group.candidates })),
    surfaces: surfaces.map((surface) => ({ room: surface.room, printed_m2: surface.printed_m2, anchor: surface.anchor, polygon_m2: surface.polygon_m2,
      polygon_points: surface.polygon_points, deviation: surface.deviation, method: surface.method, fill_rejected: surface.fill_rejected })),
    groups_classified: groups.filter((group) => group.class !== null && group.class !== "autre").length,
    groups_network: groups.filter(isNetwork).length,
    near_white_network_groups: groups.filter((group) => group.nearWhite && isNetwork(group)).length,
    networks: networks === null ? null : { ...networks, runs: networks.runs.length },
  };
}

/**
 * The raster fallback of a vector run (pipeline step 5): the level C items of a baseline page for a pass (pass n of
 * the run takes pass ((n - 1) mod passes) + 1 of the baseline), or « unread » when the baseline did not read that
 * page. A page is read when a successful call of its document's complete run covers it and no failed call does.
 * A baseline run on a subset (--pages, --pages-from) also lists the pages it read: one left out is unread, even
 * inside a call's range (pages 1 and 3 read in one chunk are put back as « pages 1-3 »). Ranges only hold for pages
 * in order: a selection whose pages do not rise strictly reads none.
 * An item belongs to its source_page. One without it (the field is optional) belongs to the page its chunks read
 * (item_chunks, then those calls' pages among the pages read): it is never copied onto every page. When its chunks
 * read several pages, which one it came from is unknown, and each of those pages is « unread » rather than given it.
 */
export function baselineRasterFallback(passes: ReadonlyArray<Pick<BenchPass, "documents">>, selection?: BenchPageSelection | null) {
  return (document: string, pass: number, page: number): TakeoffItem[] | "unread" => {
    if (passes.length === 0) return "unread";
    const run = passes[(pass - 1) % passes.length].documents.find((entry) => entry.id === document && entry.complete);
    if (!run) return "unread";
    let pagesRead: readonly number[] | null = null;
    if (selection && selection.mode !== "all") {
      const read = selection.documents.find((entry) => entry.id === document);
      if (!read || read.excluded || !read.pages_read.includes(page)) return "unread";
      if (read.pages_read.some((value, index, list) => index > 0 && value <= list[index - 1])) return "unread";
      pagesRead = read.pages_read;
    }
    const covering = run.calls.filter((call) => call.start_page <= page && page <= call.end_page);
    if (!covering.some((call) => call.status === "ok") || covering.some((call) => call.status !== "ok")) return "unread";
    const items: TakeoffItem[] = [];
    for (const [index, item] of run.items.entries()) {
      if (item.source_page !== undefined && item.source_page !== null) {
        if (item.source_page === page) items.push(item);
        continue;
      }
      const chunks = run.item_chunks[index] ?? [];
      const calls = run.calls.filter((call) => chunks.includes(call.chunk));
      const pages = new Set<number>();
      // Without its chunks, an item may come from any page of the document.
      const ranges = chunks.length > 0 && calls.length === chunks.length ? calls : [{ start_page: 1, end_page: run.pages }];
      for (const range of ranges) for (let value = range.start_page; value <= range.end_page; value += 1) pages.add(value);
      if (pagesRead) for (const value of [...pages]) if (!pagesRead.includes(value)) pages.delete(value);
      if (!pages.has(page)) continue;
      if (pages.size > 1) return "unread";
      items.push(item);
    }
    return items;
  };
}

export async function runVectorBench(input: {
  documents: readonly VectorBenchDocument[];
  groups: ReadonlyMap<string, GroupTruthFile>;
  repeat: number;
  /**
   * Level C items of a raster page for this pass, from the baseline report (baselineRasterFallback); « unread »
   * when the baseline did not read that page: the page then fails, its scope is not scored.
   */
  rasterFallback?: (document: string, pass: number, page: number) => TakeoffItem[] | "unread";
  extract?: (bytes: Uint8Array, page: number) => Promise<VectorPageExtraction>;
  clock?: () => number;
  log?: (line: string) => void;
}): Promise<VectorBenchResult> {
  const clock = input.clock ?? (() => performance.now());
  const extract = input.extract ?? ((bytes: Uint8Array, page: number) => extractVectorPage(bytes, page));
  const planned = input.repeat * input.documents.reduce((total, document) => total + document.pages, 0);
  const passes: BenchPass[] = [];
  const vectorPasses: VectorBenchPass[] = [];
  let done = 0;
  for (let pass = 1; pass <= input.repeat; pass += 1) {
    const benchPass: BenchPass = { pass, complete: false, documents: [] };
    const vectorPass: VectorBenchPass = { pass, documents: [] };
    passes.push(benchPass);
    vectorPasses.push(vectorPass);
    for (const document of input.documents) {
      const run: DocumentRun = {
        id: document.id, lot: document.lot, role: document.role, sha256: document.sha256, bytes: document.bytes.byteLength,
        pages: document.pages, chunks_planned: document.pages, complete: false, calls: [], failed_chunks: 0, items: [], item_chunks: [],
        duplicate_items: 0, deduplicated_items: 0,
      };
      const summary: VectorDocumentSummary = { id: document.id, pages: [] };
      benchPass.documents.push(run);
      vectorPass.documents.push(summary);
      const groups = input.groups.get(document.id);
      for (let page = 1; page <= document.pages; page += 1) {
        const base: Omit<ChunkCall, "status" | "duration_ms" | "duration_per_page_ms" | "items" | "warnings" | "error"> = {
          chunk: page, chunks: document.pages, start_page: page, end_page: page, pages: 1, bytes: document.bytes.byteLength,
          model: VECTOR_PIPELINE_LABEL, reasoning_effort: null, prompt_version: `vector-v${VECTOR_READING_VERSION}`, usage: null,
        };
        const startedAt = clock();
        try {
          const extraction = await extract(document.bytes, page);
          const calibration = groups?.calibrations?.find((entry) => entry.page === page) ?? null;
          const reading = readVectorPage(extraction, { calibration, correspondences: correspondencesOf(groups, page), correspondenceSource: "document" });
          let items = reading.mode === "raster" ? [] : vectorItems(reading, document.id);
          let fallback: number | null = null;
          if (reading.mode === "raster" && input.rasterFallback) {
            const baseline = input.rasterFallback(document.id, pass, page);
            if (baseline === "unread") {
              throw new VectorExtractionError("failed", `La baseline niveau C n’a pas lu la page raster ${page} de ${document.id}.`);
            }
            items = baseline;
            fallback = items.length;
          }
          const duration = Math.max(0, clock() - startedAt);
          done += 1;
          run.items.push(...items);
          run.item_chunks.push(...items.map(() => [page]));
          run.calls.push({ ...base, status: "ok", duration_ms: Math.round(duration), duration_per_page_ms: Math.round(duration), items: items.length, warnings: 0, error: null });
          summary.pages.push({ page, status: "ok", error: null, reading: summarize(reading), raster_items_from_baseline: fallback });
          input.log?.(`[vector pass ${pass}/${input.repeat}] ${document.id} p${page}: ${reading.mode}, scale ${reading.scale.status}, ${items.length} items, ${(duration / 1000).toFixed(1)} s`);
        } catch (error) {
          // Only the extraction fails a page; any other error is the bench's own and stops the run.
          if (!(error instanceof VectorExtractionError)) throw error;
          const duration = Math.max(0, clock() - startedAt);
          done += 1;
          const status = error.reason === "timeout" ? "timeout" : "provider_failed";
          run.calls.push({ ...base, status, duration_ms: Math.round(duration), duration_per_page_ms: Math.round(duration), items: null, warnings: null,
            error: describeError(error) });
          run.failed_chunks += 1;
          summary.pages.push({ page, status: "failed", error: describeError(error), reading: null, raster_items_from_baseline: null });
          input.log?.(`[vector pass ${pass}/${input.repeat}] ${document.id} p${page}: ${status} (${describeError(error).message})`);
        }
      }
      run.complete = true;
    }
    benchPass.complete = true;
  }
  return {
    run: {
      status: "complete", stop: null, calls_planned: planned, calls_done: done,
      couples: [{ model: VECTOR_PIPELINE_LABEL, reasoning_effort: null, override: null, prompt_version: `vector-v${VECTOR_READING_VERSION}`, passes }],
    },
    vector: { version: VECTOR_READING_VERSION, passes: vectorPasses },
  };
}
