import { describe, expect, it } from "vitest";

import type { OpenAiDecisionsResult } from "@/lib/ai/decisions";
import type { DownloadedTakeoffFile } from "@/lib/takeoff/source-loader";
import type { VectorGroupKey, VectorPageExtraction, VectorPath, VectorText } from "@/lib/takeoff/vectors/extraction";
import type { GroupDecisionsDecide, GroupDecisionsRender } from "@/lib/takeoff/vectors/group-decisions-server";
import type { GroupImage } from "@/lib/takeoff/vectors/group-sheet-server";
import { VectorPageRecordSchema } from "@/lib/takeoff/vectors/persistence";
import {
  readTakeoffVectorPages,
  TAKEOFF_VECTOR_DECISIONS_LIMITS,
  type TakeoffVectorDecisionsHook,
} from "@/lib/takeoff/vectors/worker-server";

// Ways the Decisions classification of vector groups in the takeoff worker
// (TI-662, worker-server.ts) could overspend, retry or fail a job, written
// before the code. Decisions, the renders and the extraction are fakes (no
// network, no child process); pages are fictional hand-built extractions.
// - without the hook (MERGEONE_TAKEOFF_DECISIONS off), a call is sent, or the
//   page record changes;
// - the caps are per page instead of per document and run: more than 10 batch
//   or 50 dedicated calls for one document of several pages, or a second
//   document without its own caps;
// - after the first failed or unavailable result, a later page or document of
//   the job still calls (a retry by another name), or a page is dropped instead
//   of keeping its keyword reading with its groups « à revoir »;
// - the token ceiling is per page instead of per job;
// - an error of the Decisions step fails the page or the job, or the job's own
//   check before a call (lease, active tenant) is swallowed instead of stopping
//   the job;
// - a class answered under 0.8 is classified or measured, or one at 0.8 is not;
//   the page record loses the source or the confidence of a class; an item
//   names a proposal under 0.8 among the groups it measures;
// - without canvas, every later page renders again;
// - the page record holds the evidence or the images (only counts, tokens,
//   timings and the stop).

const A3 = { width: 1190.55, height: 841.89 };
const OWNER = { userId: "user-fixture", tenantId: "tenant-fixture" };
const IMAGE: GroupImage = { mimeType: "image/jpeg", data: "AAAA", width: 10, height: 10, bytes: 3 };
const H = 8;

function text(str: string, x: number, y: number): VectorText {
  return { str, x, y, width: str.length * 0.6 * H, height: H, angle: 0 };
}

/** « Echelle : 1/50 » and « Format A3 » in the cartouche: the page measures at 1/50 (status « format »). */
function cartouche(): VectorText[] {
  const x = A3.width - 370, y = A3.height - 80;
  const scaleLabel = text("Echelle :", x, y);
  const formatLabel = text("Format", x, y + 40);
  return [scaleLabel, text("1/50", x + scaleLabel.width + 4, y), formatLabel, text("A3", x + formatLabel.width + 4, y + 40)];
}

/** `count` magenta groups told apart by their width, the first the longest; a raster page when `raster`. */
function page(number: number, count: number, options: { raster?: boolean; scale?: boolean } = {}): VectorPageExtraction {
  const groups: VectorGroupKey[] = [];
  const paths: VectorPath[] = [];
  const coordinates: number[] = [];
  for (let index = 0; index < count; index += 1) {
    groups.push({ layer: null, color: "#ff00ff", width: 0.01 * (index + 1), dash: null });
    paths.push({ group: index, start: coordinates.length / 2, count: 2, closed: false });
    coordinates.push(100, 10 + 1.5 * index, 1000 - index, 10 + 1.5 * index);
  }
  return {
    page: number, pages: 3, width: A3.width, height: A3.height, userUnit: 1, rotate: 0, layers: [], groups,
    texts: options.scale ? cartouche() : [], paths, points: Float32Array.from(coordinates),
    counts: { operators: 0, strokePaths: paths.length, fillPaths: 0, clipPaths: 0, images: options.raster ? 1 : 0, imageCoverage: options.raster ? 0.95 : 0 },
    timings: { operators_ms: 0, walk_ms: 0, text_ms: 0, total_ms: 0 }, memory: { max_rss_kb: 0, heap_used_mb: 0 },
  };
}

type Answer = { value: string; confidence: number } | "missing";
type Status = OpenAiDecisionsResult["status"] | "throw";

/** A Decisions fake: `answer(alias, kind)` per question, `status(call)` per call; every call recorded. */
function fakeDecide(answer: (alias: string, kind: "batch" | "dedicated") => Answer, status: (call: number) => Status = () => "available") {
  const seen: Array<{ kind: "batch" | "dedicated"; names: string[]; images: number; context: unknown }> = [];
  const decide: GroupDecisionsDecide = async (input) => {
    const call = seen.length;
    const kind = input.evidence.call as "batch" | "dedicated";
    seen.push({ kind, names: input.questions.map((question) => question.name), images: input.images?.length ?? 0, context: input.context });
    const outcome = status(call);
    if (outcome === "throw") throw new Error("Fictional exception before sending.");
    const answers = input.questions.map((question) => {
      const given = outcome === "available" || outcome === "partial" ? answer(question.name, kind) : "missing";
      if (given === "missing") return { name: question.name, type: "choice" as const, status: "missing" as const, value: null, confidence: null };
      return { name: question.name, type: "choice" as const, status: "answered" as const, value: given.value, confidence: given.confidence };
    });
    return {
      status: outcome, capability: { status: "available", model: "gpt-6-luna", billing: "separate_api", message: "" }, message: `Fictional ${outcome}.`,
      answers,
      provenance: { tenant_id: OWNER.tenantId, project_id: "takeoff-job:job-fixture", preparation_fingerprint: "f", request_fingerprint: "r",
        model: "gpt-6-luna", requested_at: "2026-11-04T10:00:00.000Z",
        usage: outcome === "failed" || outcome === "unavailable" ? null : { input_tokens: 900, output_tokens: 100, total_tokens: 1000 } },
    };
  };
  return { decide, seen };
}

/** Renders that count their calls, the given ones in place of the default images. */
function fakeRender(overrides: Partial<GroupDecisionsRender> = {}) {
  const calls = { legend: 0, sheets: 0 };
  const render: GroupDecisionsRender = {
    legend: async (input) => {
      calls.legend += 1;
      return overrides.legend ? overrides.legend(input) : { image: IMAGE, issue: null, duration_ms: 4 };
    },
    sheets: async (plans) => {
      calls.sheets += 1;
      return overrides.sheets ? overrides.sheets(plans) : { images: plans.map(() => IMAGE), issue: null, render_ms: plans.map(() => 7), duration_ms: 9 };
    },
  };
  return { render, calls };
}

/** A job of fictional original PDFs, each a list of pages; the extraction returns the page built for (file, page). */
function job(files: Array<Array<VectorPageExtraction>>) {
  const source: DownloadedTakeoffFile = {
    fileName: "Fictif fusionné.pdf", mimeType: "application/pdf", bytes: new ArrayBuffer(4),
    originalPdfSources: files.map((pages, index) => ({
      document: { kind: "plan_file" as const, plan_file_id: `plan-fixture-${index + 1}` },
      fileName: `Plan fictif ${index + 1} R+1 Z1.pdf`,
      bytes: Uint8Array.from([37, 80, 68, 70, index]).buffer,
      pages: pages.map((_, page) => page + 1),
    })),
  };
  const extract = async (bytes: Uint8Array, page: number) => files[bytes[4]][page - 1];
  return { source, extract };
}

function hook(decide: GroupDecisionsDecide, overrides: Partial<TakeoffVectorDecisionsHook> = {}): TakeoffVectorDecisionsHook {
  return { owner: OWNER, projectId: "takeoff-job:job-fixture", decide, render: fakeRender().render, ...overrides };
}

const read = (files: Array<Array<VectorPageExtraction>>, decisions?: TakeoffVectorDecisionsHook) => {
  const { source, extract } = job(files);
  return readTakeoffVectorPages(source, { extract, ...(decisions ? { decisions } : {}) });
};

describe("Decisions in the takeoff worker (worker-server.ts readTakeoffVectorPages)", () => {
  it("sends no call without the hook: the groups stay « à revoir » and the page record has no Decisions summary", async () => {
    const outcomes = await read([[page(1, 3)]]);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].record?.decisions).toBeUndefined();
    expect(outcomes[0].record?.groups.every((group) => group.class === null && group.source === null)).toBe(true);
  });

  it("caps the batch calls per document across its pages; the next document has its own cap", async () => {
    // 300 candidates per page: 9 batch calls of 36, then only 1 is left for page 2.
    const { decide, seen } = fakeDecide(() => ({ value: "autre", confidence: 0.9 }));
    const outcomes = await read([[page(1, 300), page(2, 300)], [page(1, 300)]], hook(decide));
    const batches = (from: number, to: number) => seen.slice(from, to).filter((call) => call.kind === "batch").length;
    expect(seen.every((call) => call.kind === "batch" && call.images === 2)).toBe(true);
    expect(seen).toHaveLength(TAKEOFF_VECTOR_DECISIONS_LIMITS.batchCalls + 9);
    expect(batches(0, 10)).toBe(10);
    expect(outcomes.map((outcome) => outcome.record?.decisions?.calls.batch)).toEqual([9, 1, 9]);
    expect(outcomes[1].record?.decisions).toMatchObject({ candidates: 36, eligible: 300, left_out: 264, stop: { reason: "call_limit" } });
    expect(outcomes[2].record?.decisions).toMatchObject({ candidates: 300, left_out: 0, stop: null });
  });

  it("caps the dedicated calls per document across its pages", async () => {
    // 40 candidates per page, all answered under 0.5 in batch: 40 dedicated on page 1, the last 10 on page 2, none on page 3.
    const { decide, seen } = fakeDecide((_alias, kind) => (kind === "batch" ? { value: "autre", confidence: 0.2 } : { value: "mur", confidence: 0.7 }));
    const outcomes = await read([[page(1, 40), page(2, 40), page(3, 40)]], hook(decide));
    expect(seen.filter((call) => call.kind === "dedicated")).toHaveLength(TAKEOFF_VECTOR_DECISIONS_LIMITS.dedicatedCalls);
    expect(outcomes.map((outcome) => outcome.record?.decisions?.calls)).toEqual([
      { batch: 2, dedicated: 40, failed: 0 }, { batch: 2, dedicated: 10, failed: 0 }, { batch: 2, dedicated: 0, failed: 0 },
    ]);
  });

  it("stops every later call of the job at the first failed or unavailable result, without retry, and reads every page", async () => {
    for (const [status, reason] of [["failed", "call_failed"], ["unavailable", "decisions_unavailable"], ["throw", "exception"]] as const) {
      const { decide, seen } = fakeDecide(() => ({ value: "autre", confidence: 0.9 }), (call) => (call === 0 ? "available" : status));
      const outcomes = await read([[page(1, 80), page(2, 5)], [page(1, 5)]], hook(decide));
      expect(seen).toHaveLength(2);
      expect(outcomes.map((outcome) => outcome.error)).toEqual([null, null, null]);
      expect(outcomes[0].record?.decisions).toMatchObject({ calls: { batch: 2, dedicated: 0, failed: 1 }, total_tokens: 1000,
        stop: { reason, from_earlier_page: false } });
      for (const later of outcomes.slice(1)) {
        expect(later.record?.decisions).toMatchObject({ calls: { batch: 0, dedicated: 0, failed: 0 }, candidates: null,
          stop: { reason, from_earlier_page: true } });
        expect(later.record?.groups.every((group) => group.class === null)).toBe(true);
      }
    }
  });

  it("holds one token ceiling for the whole job", async () => {
    const { decide, seen } = fakeDecide(() => ({ value: "autre", confidence: 0.9 }));
    // A reserve of 20 000 tokens per call and 1 000 spent per call: the third call of the job would pass 21 500, on whichever document.
    const outcomes = await read([[page(1, 40)], [page(1, 40)]], hook(decide, { maxTokens: 21_500 }));
    expect(seen).toHaveLength(2);
    expect(outcomes[0].record?.decisions).toMatchObject({ calls: { batch: 2 }, total_tokens: 2000, stop: null });
    expect(outcomes[1].record?.decisions).toMatchObject({ calls: { batch: 0 }, stop: { reason: "budget_reached", from_earlier_page: false } });
  });

  it("never fails the page nor the job for an error of the Decisions step, and stops calling", async () => {
    const { decide, seen } = fakeDecide(() => ({ value: "autre", confidence: 0.9 }));
    // A malformed render result throws inside the classification.
    const broken = fakeRender({ sheets: async () => ({ issue: null }) as unknown as Awaited<ReturnType<GroupDecisionsRender["sheets"]>> });
    const outcomes = await read([[page(1, 5), page(2, 5)]], hook(decide, { render: broken.render }));
    expect(seen).toHaveLength(0);
    expect(outcomes.map((outcome) => outcome.error)).toEqual([null, null]);
    expect(outcomes[0].record?.decisions).toMatchObject({ stop: { reason: "exception", from_earlier_page: false } });
    expect(outcomes[1].record?.decisions).toMatchObject({ stop: { reason: "exception", from_earlier_page: true } });
    expect(broken.calls.legend).toBe(1);
  });

  it("lets the job's own check before a call (lease, active tenant) stop the job", async () => {
    const { decide } = fakeDecide(() => ({ value: "autre", confidence: 0.9 }));
    let checks = 0;
    const beforeCall = async () => {
      checks += 1;
      if (checks === 2) throw new Error("Fictional lost lease.");
    };
    await expect(read([[page(1, 80)]], hook(decide, { beforeCall }))).rejects.toThrow("Fictional lost lease.");
  });

  it("measures a class answered at 0.8 and keeps one under 0.8 as a proposal, with their source and confidence", async () => {
    const { decide } = fakeDecide((alias) => (alias === "groupe_01" ? { value: "EU", confidence: 0.8 } : { value: "EU", confidence: 0.79 }));
    const [outcome] = await read([[page(1, 2, { scale: true })]], hook(decide));
    const record = VectorPageRecordSchema.parse(outcome.record);
    expect(record.scale).toMatchObject({ status: "format", denominator: 50 });
    const [first, second] = record.groups;
    expect(first).toMatchObject({ class: "EU", source: "decisions", confidence: 0.8 });
    expect(second).toMatchObject({ class: "EU", source: "decisions", confidence: 0.79 });
    // Only the first group is measured: 900 pt at 1/50.
    const network = outcome.items.filter((item) => item.geometry.kind === "network");
    expect(network).toHaveLength(1);
    // The item names the groups it measures: never the proposal under 0.8.
    expect(network[0].geometry).toMatchObject({ network: "EU", groups: [first.id] });
    expect(network[0].geometry.length_m).toBeCloseTo((900 * 25.4 / 72) * 50 / 1000, 2);
    expect(record.detection).toBeCloseTo(900 / (900 + 899), 3);
    expect(record.decisions).toMatchObject({ prompt_version: "takeoff-vector-groups-v1", candidates: 2, answered: 2,
      calls: { batch: 1, dedicated: 0, failed: 0 }, total_tokens: 1000, stop: null });
    expect(JSON.stringify(record)).not.toContain("AAAA");
  });

  it("asks nothing for a raster page", async () => {
    const { decide, seen } = fakeDecide(() => ({ value: "EU", confidence: 0.9 }));
    const [outcome] = await read([[page(1, 5, { raster: true })]], hook(decide));
    expect(seen).toHaveLength(0);
    expect(outcome.record?.mode).toBe("raster");
    expect(outcome.record?.decisions).toBeUndefined();
  });

  it("stops rendering for the job without canvas", async () => {
    const { decide, seen } = fakeDecide(() => ({ value: "EU", confidence: 0.9 }));
    const noCanvas = fakeRender({ sheets: async (plans) => ({ images: plans.map(() => null), issue: "canvas_unavailable", render_ms: plans.map(() => null), duration_ms: 1 }) });
    const outcomes = await read([[page(1, 5), page(2, 5)], [page(1, 5)]], hook(decide, { render: noCanvas.render }));
    expect(seen).toHaveLength(0);
    expect(noCanvas.calls).toEqual({ legend: 1, sheets: 1 });
    expect(outcomes.map((outcome) => outcome.record?.decisions?.stop?.reason)).toEqual(["canvas_unavailable", "canvas_unavailable", "canvas_unavailable"]);
  });
});
