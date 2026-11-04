import type { BenchPageSelection } from "@/lib/takeoff/bench/pages";
import type { BenchPass, BenchRunResult, BenchStop, ChunkCall, DocumentRun, StopReason } from "@/lib/takeoff/bench/run";
import { describeError } from "@/lib/takeoff/bench/run";
import type { GroupTruthFile } from "@/lib/takeoff/bench/schemas";
import { extractVectorPage, VectorExtractionError, type VectorPageExtraction } from "@/lib/takeoff/vectors/extraction";
import { isClassified, isMeasuredNetwork, isNetworkClass, isVectorClass } from "@/lib/takeoff/vectors/classify";
import {
  decisionsOfOutcome,
  isDecisionsRunStop,
  type GroupDecisionsCall,
  type GroupDecisionsOutcome,
  type GroupDecisionsStop,
} from "@/lib/takeoff/vectors/group-decisions-server";
import { vectorItems } from "@/lib/takeoff/vectors/items";
import type { NetworkMeasure } from "@/lib/takeoff/vectors/measure";
import { readVectorPage, VECTOR_READING_VERSION, type VectorPageReading } from "@/lib/takeoff/vectors/pipeline";
import type { VectorClass } from "@/lib/takeoff/vectors/vocabulary";
import type { TakeoffItem } from "@/lib/takeoff/types";
import {
  assertRuleDataAligned,
  benchPageAnchors,
  benchRulePass,
  vectorItemRuleData,
  type BenchRuleData,
  type BenchRuleDocument,
  type BenchRulePage,
} from "@/lib/takeoff/bench/vector-rules";
import type { LevelRegistration } from "@/lib/takeoff/rules/evaluate";
import {
  applyVisionAnswers,
  visionCandidates,
  type VisionAnswer,
  type VisionLine,
  type VisionPageOutcome,
  type VisionPageSummary,
  type VisionPassSummary,
} from "@/lib/takeoff/bench/vision-review";

// The vector pipeline of the takeoff bench (TI-662 §6), next to the level C
// baseline: per pass and document, each page is extracted (child process, 15 s,
// killed at the deadline), read with keywords and the document's truth/groups
// (correspondences and page calibrations), and turned into items scored like a
// level C answer. No provider call without a Decisions hook. A page whose
// extraction fails (timeout, too large, invalid output) is a failed « call »:
// its document's scope is not scored; any other error is the bench's own and
// stops the run. A
// raster page (images over 90 % of it) gives no vector item: the level C
// reading of the baseline stands for it when the run is given one (pipeline
// step 5) — a raster page the baseline did not read fails, it is never scored
// as read with no item — otherwise it has none.
// With a Decisions hook (--max-decisions-tokens, TI-662 L3c), each page read by
// keywords is given to it (group-decisions-server.ts classifyVectorGroups) and
// read again with its answers. A stop of the provider or the ceiling ends the
// run there: the page keeps the answers it got, the document is not scored
// (incomplete), later pages and passes are not run. A page whose images could
// not be drawn keeps its groups « à revoir » and the run goes on.
// With a vision hook (--vision-review, TI-664 L5c), once a pass is read and its rules computed, the lines the DN ×
// network rule rejects are reviewed page by page (vision-review.ts); the corrected lines and their rules computed
// again are the pass « after vision » (result.vision), the pass itself is left as read. A stop of the hook (quota,
// rate limit, authorisation) ends the run there: that pass has no « after vision » state.

export const VECTOR_PIPELINE_LABEL = "vector";

export type VectorBenchDocument = {
  id: string;
  lot: string;
  role: "truth" | "reserve";
  bytes: Uint8Array;
  sha256: string;
  pages: number;
  /** Level and zone of the manifest (TI-664 rules: plans of one level are compared for duplicates). */
  level?: string | null;
  zone?: string | null;
  /** The manifest's page ranges, whose level and zone win over the document's (as the scorer reads them). */
  page_ranges?: ReadonlyArray<{ from: number; to: number; level?: string | null; zone?: string | null }>;
};

/** Level and zone of a page: its range's, else the document's (score.ts locate). */
function pageLocation(document: VectorBenchDocument, page: number) {
  const range = document.page_ranges?.find((entry) => entry.from <= page && page <= entry.to);
  return { level: range?.level ?? document.level ?? null, zone: range?.zone ?? document.zone ?? null };
}

export type VectorReadingSummary = Omit<VectorPageReading, "networks" | "groups" | "surfaces"> & {
  groups: Array<Pick<VectorPageReading["groups"][number], "id" | "layerName" | "colors" | "length_pt" | "nearWhite" | "grey" | "class" | "source"
    | "confidence" | "candidates">>;
  /** Rooms without their outline points: the report keeps areas, not geometry. */
  surfaces: Array<Omit<VectorPageReading["surfaces"][number], "outline">>;
  groups_classified: number;
  groups_network: number;
  /** Near-white groups classified as a network: must stay 0 (TI-658 pitfall). */
  near_white_network_groups: number;
  networks: (Omit<NetworkMeasure, "runs"> & { runs: number }) | null;
};

/** The Decisions classification of one page: its calls and each candidate's answer (never evidence nor images). */
export type VectorPageDecisions = {
  candidates: number;
  eligible: number;
  left_out: number;
  calls: GroupDecisionsCall[];
  stop: GroupDecisionsStop | null;
  render: GroupDecisionsOutcome["render"];
  answers: Array<{ alias: string; group: string; class: string | null; confidence: number | null; status: string; via: "batch" | "dedicated" }>;
};

export type VectorPageSummary = {
  page: number;
  status: "ok" | "failed";
  error: { name: string; code: string | null; message: string } | null;
  reading: VectorReadingSummary | null;
  /** Items the level C baseline gave a raster page (null: the page is vector, or no baseline). */
  raster_items_from_baseline: number | null;
  /** Null without a Decisions hook (keywords only). */
  decisions?: VectorPageDecisions | null;
};

export type VectorDecisionsHook = {
  /** Recorded with the reading's version as the run's prompt version. */
  promptVersion: string;
  classify: (document: VectorBenchDocument, page: number, extraction: VectorPageExtraction, reading: VectorPageReading) => Promise<GroupDecisionsOutcome>;
};

export type VectorDocumentSummary = { id: string; pages: VectorPageSummary[] };
export type VectorBenchPass = {
  pass: number;
  documents: VectorDocumentSummary[];
  /** Registration of the pages of each level of a lot (TI-664), the first page of a level being its frame. */
  registrations?: Array<LevelRegistration & { lot: string }>;
  /** The vision pass on the rejected lines (TI-664 L5c), absent without a vision hook. */
  vision?: VisionPassSummary;
};

/** Reviews the rejected lines of one page (renders their crops, asks ChatGPT); `stop` ends the run. */
export type VectorVisionHook = {
  promptVersion: string;
  review: (document: VectorBenchDocument, page: number, lines: VisionLine[]) => Promise<VisionPageOutcome>;
};

export type VectorBenchResult = {
  run: BenchRunResult;
  vector: { version: number; passes: VectorBenchPass[] };
  /** Each pass after the vision pass: the corrected lines and their rules, scored apart (absent without a hook). */
  vision?: { prompt_version: string; passes: BenchPass[] };
};

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
      nearWhite: group.nearWhite, grey: group.grey, class: group.class, source: group.source, confidence: group.confidence, candidates: group.candidates })),
    surfaces: surfaces.map((surface) => ({ room: surface.room, printed_m2: surface.printed_m2, anchor: surface.anchor, polygon_m2: surface.polygon_m2,
      polygon_points: surface.polygon_points, deviation: surface.deviation, method: surface.method, fill_rejected: surface.fill_rejected })),
    // As the detection badge and the measure count them: a Decisions proposal under 0.8 is neither.
    groups_classified: groups.filter((group) => isClassified(group)).length,
    groups_network: groups.filter((group) => isMeasuredNetwork(group)).length,
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

function pageDecisions(outcome: GroupDecisionsOutcome): VectorPageDecisions {
  return {
    candidates: outcome.candidates, eligible: outcome.eligible, left_out: outcome.left_out, calls: outcome.calls, stop: outcome.stop, render: outcome.render,
    answers: [...outcome.answers].map(([group, answer]) => ({ alias: answer.alias, group, class: answer.class, confidence: answer.confidence,
      status: answer.status, via: answer.via })).sort((left, right) => (left.alias < right.alias ? -1 : left.alias > right.alias ? 1 : 0)),
  };
}

function decisionsStop(stop: GroupDecisionsStop, done: number, planned: number, at: BenchStop["at"]): BenchStop {
  return { kind: "provider", reason: "other", error: { name: "DecisionsStop", code: stop.reason, message: stop.message.slice(0, 300) },
    calls_done: done, calls_remaining: planned - done, at };
}

function promptVersionOf(decisions: Pick<VectorDecisionsHook, "promptVersion"> | null | undefined, vision?: Pick<VectorVisionHook, "promptVersion">) {
  return `vector-v${VECTOR_READING_VERSION}${decisions ? `+${decisions.promptVersion}` : ""}${vision ? `+${vision.promptVersion}` : ""}`;
}

const STOP_REASONS: readonly StopReason[] = ["quota", "rate_limit", "auth_required", "account_missing", "model_missing", "selection_changed", "other"];

/**
 * The vision pass of one read pass: per document, its pages with lines to review in order; the answers applied as a
 * new state, the rules computed again on it per lot. Stops at the hook's first stop (no state then).
 */
async function reviewPass(input: { hook: VectorVisionHook; documents: readonly VectorBenchDocument[]; runs: readonly DocumentRun[];
  ruleDocuments: readonly BenchRuleDocument[]; rulePages: readonly BenchRulePage[] }) {
  const summary: VisionPassSummary = { documents: [], stop: null };
  const reviewed: BenchRuleDocument[] = [];
  for (const ruleDocument of input.ruleDocuments) {
    const document = input.documents.find((entry) => entry.id === ruleDocument.id);
    const run = input.runs.find((entry) => entry.id === ruleDocument.id);
    if (!document || !run || ruleDocument.items.length !== ruleDocument.data.length) {
      reviewed.push(ruleDocument);
      continue;
    }
    const denominators = new Map(input.rulePages.filter((page) => page.document === document.id).map((page) => [page.page, page.denominator]));
    const results = run.item_rules ?? ruleDocument.items.map(() => []);
    const answers = new Map<number, VisionAnswer>();
    const pages: VisionPageSummary[] = [];
    for (const page of visionCandidates({ items: ruleDocument.items, data: ruleDocument.data, results, denominators })) {
      const outcome: VisionPageOutcome = page.lines.length > 0 ? await input.hook.review(document, page.page, page.lines)
        : { calls: [], render_ms: [], answers: [], stop: null };
      const byAlias = new Map(page.lines.map((line) => [line.alias, line]));
      const pageAnswers = outcome.answers.flatMap((answer) => {
        const line = byAlias.get(answer.alias);
        return line ? [{ ...answer, index: line.index, designation: line.designation }] : [];
      });
      // One answer per line, its first: a repeated alias never overwrites it.
      for (const answer of pageAnswers) if (!answers.has(answer.index)) answers.set(answer.index, answer);
      const notDrawn = outcome.not_drawn?.length ?? 0;
      pages.push({ page: page.page, lines: page.lines.length - notDrawn, not_drawn: notDrawn, too_spread: page.too_spread, left_out: page.left_out,
        corrected: 0, calls: outcome.calls, render_ms: outcome.render_ms, answers: pageAnswers });
      if (outcome.stop) {
        summary.stop = outcome.stop;
        break;
      }
    }
    const applied = applyVisionAnswers({ items: ruleDocument.items, data: ruleDocument.data, answers });
    for (const page of pages) page.corrected = applied.corrected.filter((index) => ruleDocument.items[index]?.source_page === page.page).length;
    summary.documents.push({ id: document.id, pages });
    if (summary.stop) return { summary, pass: null };
    reviewed.push({ ...ruleDocument, items: applied.items, data: applied.data });
  }
  const rules = benchRulePass(reviewed.filter((entry) => entry.items.length === entry.data.length), input.rulePages);
  const items = new Map(reviewed.map((entry) => [entry.id, entry.items]));
  const documents = input.runs.map((run) => ({ ...run, items: [...(items.get(run.id) ?? run.items)],
    ...(rules.results.has(run.id) ? { item_rules: rules.results.get(run.id) } : {}) }));
  return { summary, documents };
}

/** A run whose vision pass could not start (no ChatGPT account, model or token): no page read, every page left. */
export function stoppedVisionBench(documents: readonly Pick<VectorBenchDocument, "pages">[], repeat: number, promptVersion: string,
  stop: { reason: StopReason; message: string }): VectorBenchResult {
  const planned = repeat * documents.reduce((total, document) => total + document.pages, 0);
  return {
    run: {
      status: "incomplete", calls_planned: planned, calls_done: 0,
      stop: { kind: "provider", reason: stop.reason, error: { name: "VisionStop", code: stop.reason, message: stop.message.slice(0, 300) },
        calls_done: 0, calls_remaining: planned, at: null },
      couples: [{ model: VECTOR_PIPELINE_LABEL, reasoning_effort: null, override: null, prompt_version: promptVersionOf(null, { promptVersion }), passes: [] }],
    },
    vector: { version: VECTOR_READING_VERSION, passes: [] },
    vision: { prompt_version: promptVersion, passes: [] },
  };
}

/** A run stopped before its first page (Decisions unavailable): no page read, every page left. */
export function stoppedVectorBench(documents: readonly Pick<VectorBenchDocument, "pages">[], repeat: number, promptVersion: string,
  stop: GroupDecisionsStop): VectorBenchResult {
  const planned = repeat * documents.reduce((total, document) => total + document.pages, 0);
  return {
    run: {
      status: "incomplete", stop: decisionsStop(stop, 0, planned, null), calls_planned: planned, calls_done: 0,
      couples: [{ model: VECTOR_PIPELINE_LABEL, reasoning_effort: null, override: null, prompt_version: promptVersionOf({ promptVersion }), passes: [] }],
    },
    vector: { version: VECTOR_READING_VERSION, passes: [] },
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
  /** Decisions classes of the groups the keywords leave (TI-662 L3c); absent: keywords only. */
  decisions?: VectorDecisionsHook;
  /** The vision pass on the lines the rules reject (TI-664 L5c); absent: none. */
  vision?: VectorVisionHook;
  clock?: () => number;
  log?: (line: string) => void;
}): Promise<VectorBenchResult> {
  const clock = input.clock ?? (() => performance.now());
  const extract = input.extract ?? ((bytes: Uint8Array, page: number) => extractVectorPage(bytes, page));
  const planned = input.repeat * input.documents.reduce((total, document) => total + document.pages, 0);
  const passes: BenchPass[] = [];
  const vectorPasses: VectorBenchPass[] = [];
  let done = 0;
  let stop: BenchStop | null = null;
  const promptVersion = promptVersionOf(input.decisions, input.vision);
  const visionPasses: BenchPass[] = [];
  bench: for (let pass = 1; pass <= input.repeat; pass += 1) {
    const benchPass: BenchPass = { pass, complete: false, documents: [] };
    const vectorPass: VectorBenchPass = { pass, documents: [] };
    passes.push(benchPass);
    vectorPasses.push(vectorPass);
    const ruleDocuments: BenchRuleDocument[] = [];
    const rulePages: BenchRulePage[] = [];
    // The rules of TI-664 per lot, with the geometry and the other documents of the lot read in this pass: at the end
    // of the pass, or at a Decisions stop for the documents read in full before it (the one it cut stays unscored).
    const finishRules = () => {
      const rules = benchRulePass(ruleDocuments.filter((entry) => entry.items.length === entry.data.length), rulePages);
      for (const run of benchPass.documents) {
        const results = rules.results.get(run.id);
        if (results) run.item_rules = results;
      }
      vectorPass.registrations = rules.registrations;
    };
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
      const ruleData: Array<BenchRuleData | null> = [];
      for (let page = 1; page <= document.pages; page += 1) {
        const base: Omit<ChunkCall, "status" | "duration_ms" | "duration_per_page_ms" | "items" | "warnings" | "error"> = {
          chunk: page, chunks: document.pages, start_page: page, end_page: page, pages: 1, bytes: document.bytes.byteLength,
          model: VECTOR_PIPELINE_LABEL, reasoning_effort: null, prompt_version: promptVersion, usage: null,
        };
        const startedAt = clock();
        try {
          const extraction = await extract(document.bytes, page);
          const calibration = groups?.calibrations?.find((entry) => entry.page === page) ?? null;
          const options = { calibration, correspondences: correspondencesOf(groups, page), correspondenceSource: "document" as const };
          let reading = readVectorPage(extraction, options);
          let decided: GroupDecisionsOutcome | null = null;
          if (input.decisions) {
            decided = await input.decisions.classify(document, page, extraction, reading);
            const answers = decisionsOfOutcome(decided);
            if (answers.size > 0) reading = readVectorPage(extraction, { ...options, decisions: answers });
          }
          let items = reading.mode === "raster" ? [] : vectorItems(reading, document.id);
          const data = reading.mode === "raster" ? [] : vectorItemRuleData(reading);
          // vectorItemRuleData follows vectorItems item for item; a mismatch is the bench's own bug.
          assertRuleDataAligned(items, data, `${document.id} p${page}`);
          rulePages.push({ document: document.id, lot: document.lot, page, ...pageLocation(document, page),
            scale: { status: reading.scale.status, reason: reading.scale.reason }, denominator: reading.scale.denominator,
            anchors: benchPageAnchors(extraction, reading) });
          let fallback: number | null = null;
          if (reading.mode === "raster" && input.rasterFallback) {
            const baseline = input.rasterFallback(document.id, pass, page);
            if (baseline === "unread") {
              throw new VectorExtractionError("failed", `La baseline niveau C n’a pas lu la page raster ${page} de ${document.id}.`);
            }
            items = baseline;
            fallback = items.length;
          }
          ruleData.push(...(reading.mode === "raster" ? items.map(() => null) : data));
          const duration = Math.max(0, clock() - startedAt);
          done += 1;
          run.items.push(...items);
          run.item_chunks.push(...items.map(() => [page]));
          run.calls.push({ ...base, status: "ok", duration_ms: Math.round(duration), duration_per_page_ms: Math.round(duration), items: items.length, warnings: 0, error: null });
          summary.pages.push({ page, status: "ok", error: null, reading: summarize(reading), raster_items_from_baseline: fallback,
            ...(decided ? { decisions: pageDecisions(decided) } : {}) });
          input.log?.(`[vector pass ${pass}/${input.repeat}] ${document.id} p${page}: ${reading.mode}, scale ${reading.scale.status}, ${items.length} items, ${(duration / 1000).toFixed(1)} s`
            + (decided ? `, Decisions ${decided.calls.length} calls${decided.stop ? ` (${decided.stop.reason})` : ""}` : ""));
          if (decided?.stop && isDecisionsRunStop(decided.stop.reason)) {
            stop = decisionsStop(decided.stop, done, planned, { model: VECTOR_PIPELINE_LABEL, reasoning_effort: null, pass, document: document.id, chunk: page });
            finishRules();
            break bench;
          }
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
      ruleDocuments.push({ id: document.id, lot: document.lot, order: ruleDocuments.length, items: run.items, data: ruleData });
    }
    finishRules();
    benchPass.complete = true;
    if (input.vision) {
      const vision = await reviewPass({ hook: input.vision, documents: input.documents, runs: benchPass.documents, ruleDocuments, rulePages });
      vectorPass.vision = vision.summary;
      if (vision.summary.stop) {
        const reason = STOP_REASONS.find((entry) => entry === vision.summary.stop?.reason) ?? "other";
        const last = vision.summary.documents.at(-1);
        stop = { kind: "provider", reason, error: { name: "VisionStop", code: vision.summary.stop.reason, message: vision.summary.stop.message.slice(0, 300) },
          calls_done: done, calls_remaining: planned - done,
          at: { model: VECTOR_PIPELINE_LABEL, reasoning_effort: null, pass, document: last?.id ?? "", chunk: last?.pages.at(-1)?.page ?? null } };
        break bench;
      }
      visionPasses.push({ pass, complete: true, documents: vision.documents ?? [] });
    }
  }
  return {
    run: {
      status: stop ? "incomplete" : "complete", stop, calls_planned: planned, calls_done: done,
      couples: [{ model: VECTOR_PIPELINE_LABEL, reasoning_effort: null, override: null, prompt_version: promptVersion, passes }],
    },
    vector: { version: VECTOR_READING_VERSION, passes: vectorPasses },
    ...(input.vision ? { vision: { prompt_version: input.vision.promptVersion, passes: visionPasses } } : {}),
  };
}
