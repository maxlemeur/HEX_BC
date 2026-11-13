import { afterEach, describe, expect, it, vi } from "vitest";

// The local plan's credential, model listing and request (TI-704 option B): mocks, never the network. Only the test of
// the plan's first use reaches them; every other local test injects `local.call`.
vi.mock("@/lib/ai/chatgpt-local-auth", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/ai/chatgpt-local-auth")>(), getLocalChatGptCredential: vi.fn(),
}));
vi.mock("@/lib/ai/chatgpt-local-inference", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/ai/chatgpt-local-inference")>(), assertLocalChatGptOverride: vi.fn(), callLocalChatGptStructured: vi.fn(),
}));

import { getLocalChatGptCredential } from "@/lib/ai/chatgpt-local-auth";
import { assertLocalChatGptOverride, callLocalChatGptStructured } from "@/lib/ai/chatgpt-local-inference";
import type { OpenAiDecisionsResult } from "@/lib/ai/decisions";
import type { DownloadedTakeoffFile } from "@/lib/takeoff/source-loader";
import type { VectorGroupKey, VectorPageExtraction, VectorPath, VectorText } from "@/lib/takeoff/vectors/extraction";
import { GROUP_DECISIONS_CALL_ESTIMATE_TOKENS, type GroupDecisionsDecide, type GroupDecisionsRender } from "@/lib/takeoff/vectors/group-decisions-server";
import type { EvidenceImagePlan } from "@/lib/takeoff/vectors/group-evidence-images";
import type { GroupEvidenceImages, GroupImage } from "@/lib/takeoff/vectors/group-evidence-render-server";
import { VectorPageRecordSchema } from "@/lib/takeoff/vectors/persistence";
import { LocalGroupsStop, type LocalGroupsCall } from "@/lib/takeoff/vectors/group-local-model-server";
import {
  readTakeoffVectorPages,
  TAKEOFF_VECTOR_DECISIONS_LIMITS,
  TAKEOFF_VECTOR_LOCAL_LIMITS,
  takeoffVectorDecisionsHook,
  takeoffVectorLocalGroupsHook,
  type TakeoffVectorDecisionsHook,
} from "@/lib/takeoff/vectors/worker-server";

// Ways the classification of vector groups in the takeoff worker (TI-662,
// worker-server.ts; TI-704 v2) could overspend, retry or fail a job, written
// before the code. Decisions, the render and the extraction are fakes (no
// network, no child process); pages are fictional hand-built extractions.
// - without the hook (MERGEONE_TAKEOFF_DECISIONS off), a call is sent, or the
//   page record changes;
// - the caps are per page instead of per document and run: more than 10 calls
//   for one document of several pages, or a second document without its own
//   caps;
// - after the first failed or unavailable result, a later page or document of
//   the job still calls (a retry by another name), or a page is dropped instead
//   of keeping its keyword reading with its groups « à revoir »;
// - the token ceiling is per page instead of per job;
// - an error of the Decisions step fails the page or the job, or the job's own
//   check before a call (lease, active tenant) is swallowed instead of stopping
//   the job;
// - a class answered at a margin under 0.5 is classified or measured, or one
//   at 0.5 is not; the page record loses the source or the confidence of a
//   class; an item names a proposal among the groups it measures;
// - the rules' class needs a call, or is lost from the record; a « hors_liste »
//   proposal is lost; the page record lacks the rules version, the groups the
//   filter kept out by reason, or the groups the rules classed (TI-704);
// - without canvas, every later page draws again;
// - the page record holds the evidence or the images (only counts, tokens,
//   timings and the stop);
// - the hook is on without MERGEONE_TAKEOFF_DECISIONS, the vector reading,
//   Decisions configured, or a user to act for.

const A3 = { width: 1190.55, height: 841.89 };
const OWNER = { userId: "user-fixture", tenantId: "tenant-fixture" };
const IMAGE: GroupImage = { mimeType: "image/jpeg", data: "AAAA", width: 10, height: 10, bytes: 3 };
const H = 8;
const hex = (value: number) => value.toString(16).padStart(2, "0");

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

/**
 * `count` groups of distinct colours (none shares a colour, so nothing propagates), the first the longest; a raster
 * page when `raster`; after them, when asked: a group on a layer hidden in the document's default configuration, `tiny`
 * groups 0.5 pt long, a 50 pt group on a visible layer FICTIF_EF (classified EF by keyword) and, with `sameColour`, a
 * stroke of that layer's colour outside it (the rules class it EF), `grey` grey groups (kept out by the filter).
 */
function page(number: number, count: number, options: { raster?: boolean; scale?: boolean; hidden?: boolean; tiny?: number; keyword?: boolean;
  sameColour?: boolean; grey?: number } = {}): VectorPageExtraction {
  const groups: VectorGroupKey[] = [];
  const paths: VectorPath[] = [];
  const coordinates: number[] = [];
  for (let index = 0; index < count; index += 1) {
    groups.push({ layer: null, color: `#${hex(30 + (index % 200))}${hex(40 * Math.floor(index / 200))}ff`, width: 0.01 * (index + 1), dash: null });
    paths.push({ group: index, start: coordinates.length / 2, count: 2, closed: false });
    coordinates.push(100, 10 + 1.5 * index, 1000 - index, 10 + 1.5 * index);
  }
  const extra = (layer: string | null, length: number, total: number, y: number, color = "#00a0a0") => {
    for (let index = 0; index < total; index += 1) {
      paths.push({ group: groups.length, start: coordinates.length / 2, count: 2, closed: false });
      groups.push({ layer, color, width: 0.3 + 0.01 * index, dash: null });
      coordinates.push(100, y + 1.5 * index, 100 + length, y + 1.5 * index);
    }
  };
  extra("hidden-layer", 900, options.hidden ? 1 : 0, 700);
  extra(null, 0.5, options.tiny ?? 0, 760);
  extra("ef-layer", 50, options.keyword || options.sameColour ? 1 : 0, 800);
  extra(null, 400, options.sameColour ? 1 : 0, 820);
  extra(null, 400, options.grey ?? 0, 600, "#808080");
  const layers = [...(options.hidden ? [{ id: "hidden-layer", name: "FICTIF_MASQUE", visible: false }] : []),
    ...(options.keyword || options.sameColour ? [{ id: "ef-layer", name: "FICTIF_EF", visible: true }] : [])];
  return {
    page: number, pages: 3, width: A3.width, height: A3.height, userUnit: 1, rotate: 0, layers, groups,
    texts: options.scale ? cartouche() : [], paths, points: Float32Array.from(coordinates),
    counts: { operators: 0, strokePaths: paths.length, fillPaths: 0, clipPaths: 0, images: options.raster ? 1 : 0, imageCoverage: options.raster ? 0.95 : 0 },
    timings: { operators_ms: 0, walk_ms: 0, text_ms: 0, total_ms: 0 }, memory: { max_rss_kb: 0, heap_used_mb: 0 },
  };
}

/** A group's answer: a value at a margin (its probability (1 + margin) / 2, the rest on another value). */
type Answer = { value: string; margin: number } | "missing";
type Status = OpenAiDecisionsResult["status"] | "throw";

/** A Decisions fake: `answer(alias)` per question, `status(call)` per call; every call recorded. */
function fakeDecide(answer: (alias: string) => Answer, status: (call: number) => Status = () => "available") {
  const seen: Array<{ names: string[]; images: number; context: unknown }> = [];
  const decide: GroupDecisionsDecide = async (input) => {
    const call = seen.length;
    seen.push({ names: input.questions.map((question) => question.name), images: input.images?.length ?? 0, context: input.context });
    const outcome = status(call);
    if (outcome === "throw") throw new Error("Fictional exception before sending.");
    const answers = input.questions.map((question) => {
      const given = outcome === "available" || outcome === "partial" ? answer(question.name) : "missing";
      if (given === "missing") return { name: question.name, type: "choice" as const, status: "missing" as const, value: null, confidence: null };
      const other = given.value === "fond" ? "symbole" : "fond";
      return { name: question.name, type: "choice" as const, status: "answered" as const, value: given.value, confidence: given.margin,
        probabilities: [{ value: given.value, probability: (1 + given.margin) / 2 }, { value: other, probability: (1 - given.margin) / 2 }] };
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

/** A drawing session fake that counts its drawings, `override` in place of the default images. */
function fakeRender(override?: (plan: Omit<EvidenceImagePlan, "page">) => Promise<GroupEvidenceImages>) {
  const calls = { drawings: 0 };
  const render: GroupDecisionsRender = () => ({
    draw: async (plan) => {
      calls.drawings += 1;
      if (override) return override(plan);
      return { legends: plan.legends.map(() => IMAGE), groups: plan.groups.map(() => IMAGE), issue: null, dropped_images: 0,
        render_ms: { page: 30, legends: plan.legends.map(() => 5), groups: plan.groups.map(() => 7) }, duration_ms: 40 };
    },
    cancel: () => {},
  });
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

  it("caps the calls per document across its pages; the next document has its own cap", async () => {
    // 150 candidates per page: 8 calls of 20, then only 2 are left for page 2.
    const { decide, seen } = fakeDecide(() => ({ value: "autre", margin: 0.9 }));
    const outcomes = await read([[page(1, 150), page(2, 150)], [page(1, 150)]], hook(decide));
    expect(TAKEOFF_VECTOR_DECISIONS_LIMITS.batchCalls).toBe(10);
    expect(seen).toHaveLength(10 + 8);
    expect(seen.every((call) => call.images === 0 && call.names.length <= 20)).toBe(true);
    expect(outcomes.map((outcome) => outcome.record?.decisions?.calls.batch)).toEqual([8, 2, 8]);
    expect(outcomes[1].record?.decisions).toMatchObject({ candidates: 150, eligible: 150, left_out: 110, stop: { reason: "call_limit" } });
    expect(outcomes[2].record?.decisions).toMatchObject({ candidates: 150, left_out: 0, stop: null });
  });

  it("stops every later call of the job at the first failed or unavailable result, without retry, and reads every page", async () => {
    for (const [status, reason] of [["failed", "call_failed"], ["unavailable", "decisions_unavailable"], ["throw", "exception"]] as const) {
      const { decide, seen } = fakeDecide(() => ({ value: "autre", margin: 0.9 }), (call) => (call === 0 ? "available" : status));
      // 40 candidates: 2 calls, the first alone, the second fails. The later pages still take the rules' classes (TI-704).
      const outcomes = await read([[page(1, 40), page(2, 5, { sameColour: true })], [page(1, 5)]], hook(decide));
      expect(seen).toHaveLength(2);
      expect(outcomes.map((outcome) => outcome.error)).toEqual([null, null, null]);
      expect(outcomes[0].record?.decisions).toMatchObject({ calls: { batch: 2, dedicated: 0, failed: 1 }, total_tokens: 1000,
        stop: { reason, from_earlier_page: false } });
      expect(outcomes[1].record?.decisions).toMatchObject({ calls: { batch: 0, dedicated: 0, failed: 0 }, candidates: 6, ruled: { same_colour: 1 },
        stop: { reason, from_earlier_page: true } });
      expect(outcomes[1].record?.groups.filter((group) => group.class !== null)).toEqual([expect.objectContaining({ class: "EF", source: "rule" }),
        expect.objectContaining({ class: "EF", source: "keyword" })]);
      expect(outcomes[2].record?.decisions).toMatchObject({ calls: { batch: 0, dedicated: 0, failed: 0 }, candidates: 5, stop: { reason, from_earlier_page: true } });
      expect(outcomes[2].record?.groups.every((group) => group.class === null)).toBe(true);
    }
  });

  it("holds one token ceiling for the whole job", async () => {
    const { decide, seen } = fakeDecide(() => ({ value: "autre", margin: 0.9 }));
    // A reserve of 30 000 tokens per call and 1 000 spent per call: the third call of the job would pass 31 500, on whichever document.
    expect(GROUP_DECISIONS_CALL_ESTIMATE_TOKENS).toBe(30_000);
    const outcomes = await read([[page(1, 40)], [page(1, 40)]], hook(decide, { maxTokens: 31_500 }));
    expect(seen).toHaveLength(2);
    expect(outcomes[0].record?.decisions).toMatchObject({ calls: { batch: 2 }, total_tokens: 2000, stop: null });
    expect(outcomes[1].record?.decisions).toMatchObject({ calls: { batch: 0 }, stop: { reason: "budget_reached", from_earlier_page: false } });
  });

  it("never fails the page nor the job for an error of the Decisions step, and stops calling", async () => {
    const { decide, seen } = fakeDecide(() => ({ value: "autre", margin: 0.9 }));
    // A malformed drawing result throws inside the classification.
    const broken = fakeRender(async () => ({ issue: null }) as unknown as GroupEvidenceImages);
    const outcomes = await read([[page(1, 5), page(2, 5)]], hook(decide, { render: broken.render }));
    expect(seen).toHaveLength(0);
    expect(outcomes.map((outcome) => outcome.error)).toEqual([null, null]);
    expect(outcomes[0].record?.decisions).toMatchObject({ stop: { reason: "exception", from_earlier_page: false } });
    expect(outcomes[1].record?.decisions).toMatchObject({ stop: { reason: "exception", from_earlier_page: true } });
    expect(broken.calls.drawings).toBe(1);
  });

  it("lets the job's own check before a call (lease, active tenant) stop the job", async () => {
    const { decide } = fakeDecide(() => ({ value: "autre", margin: 0.9 }));
    let checks = 0;
    const beforeCall = async () => {
      checks += 1;
      if (checks === 2) throw new Error("Fictional lost lease.");
    };
    await expect(read([[page(1, 80)]], hook(decide, { beforeCall }))).rejects.toThrow("Fictional lost lease.");
  });

  it("measures a class answered at a margin of 0.5 and keeps one at 0.49 as a proposal, with their source and confidence", async () => {
    const { decide } = fakeDecide((alias) => (alias === "groupe_01" ? { value: "EU", margin: 0.5 } : { value: "EU", margin: 0.49 }));
    const [outcome] = await read([[page(1, 2, { scale: true, grey: 2 })]], hook(decide));
    const record = VectorPageRecordSchema.parse(outcome.record);
    expect(record.scale).toMatchObject({ status: "format", denominator: 50 });
    const [first, second] = record.groups;
    expect(first).toMatchObject({ class: "EU", source: "decisions", confidence: 0.5 });
    expect(second).toMatchObject({ class: "EU", source: "decisions", confidence: 0.49 });
    // Only the first group is measured: 900 pt at 1/50.
    const network = outcome.items.filter((item) => item.geometry.kind === "network");
    expect(network).toHaveLength(1);
    // The item names the groups it measures: never the proposal under the margin.
    expect(network[0].geometry).toMatchObject({ network: "EU", groups: [first.id] });
    expect(network[0].geometry.length_m).toBeCloseTo((900 * 25.4 / 72) * 50 / 1000, 2);
    expect(record.decisions).toEqual({ prompt_version: "takeoff-vector-groups-v2", rules_version: 3, filtered: { grey: 2 },
      ruled: { same_colour: 0, band: 0, propagated: 0 }, candidates: 2, eligible: 2, left_out: 0, dedicated_left_out: 0, answered: 2,
      calls: { batch: 1, dedicated: 0, failed: 0 }, total_tokens: 1000, latency_ms: 0, stop: null });
    // The proposal under the margin and the two grey groups stay « à revoir ».
    expect(record.to_review).toBe(3);
    expect(JSON.stringify(record)).not.toContain("AAAA");
  });

  it("classes by the rules without a call, and keeps a « hors_liste » proposal in the page record", async () => {
    const { decide, seen } = fakeDecide(() => ({ value: "hors_liste", margin: 0.8 }));
    const [outcome] = await read([[page(1, 1, { sameColour: true })]], hook(decide));
    const record = VectorPageRecordSchema.parse(outcome.record);
    expect(seen).toHaveLength(1);
    expect(seen[0].names).toEqual(["groupe_01"]);
    expect(record.groups.find((group) => group.source === "rule")).toMatchObject({ class: "EF", confidence: null, colors: ["#00a0a0"] });
    expect(record.groups.find((group) => group.proposal)).toMatchObject({ class: null, source: null, proposal: "canalisation hors nomenclature" });
    expect(record.decisions).toMatchObject({ ruled: { same_colour: 1, band: 0, propagated: 0 }, answered: 0 });
  });

  it("counts the groups à revoir on the whole page: past the 400 it keeps, never a hidden layer nor a group under 0.1 % (review of the PR)", async () => {
    const [outcome] = await read([[page(1, 450, { hidden: true, tiny: 3 })]]);
    expect(outcome.record?.groups).toHaveLength(400);
    expect(outcome.record?.groups_total).toBe(454);
    expect(outcome.record?.to_review).toBe(450);
  });

  it("keeps the classified groups among the 400 a page record holds, before longer unclassified ones (review of the PR)", async () => {
    // 450 groups longer than the EF one: by length alone, the group of the measured EF item would not be kept.
    const [outcome] = await read([[page(1, 450, { scale: true, keyword: true })]]);
    const measured = outcome.items.find((item) => item.geometry.network === "EF");
    expect(measured?.geometry.groups).toEqual(["oc:ef-layer"]);
    expect(outcome.record?.groups).toHaveLength(400);
    expect(outcome.record?.groups.find((group) => group.id === "oc:ef-layer")).toMatchObject({ class: "EF", source: "keyword" });
  });

  it("asks nothing for a raster page", async () => {
    const { decide, seen } = fakeDecide(() => ({ value: "EU", margin: 0.9 }));
    const [outcome] = await read([[page(1, 5, { raster: true })]], hook(decide));
    expect(seen).toHaveLength(0);
    expect(outcome.record?.mode).toBe("raster");
    expect(outcome.record?.decisions).toBeUndefined();
  });

  it("stops drawing for the job without canvas", async () => {
    const { decide, seen } = fakeDecide(() => ({ value: "EU", margin: 0.9 }));
    const noCanvas = fakeRender(async (plan) => ({ legends: plan.legends.map(() => null), groups: plan.groups.map(() => null), issue: "canvas_unavailable",
      dropped_images: 0, render_ms: { page: null, legends: [], groups: [] }, duration_ms: 1 }));
    const outcomes = await read([[page(1, 5), page(2, 5)], [page(1, 5)]], hook(decide, { render: noCanvas.render }));
    expect(seen).toHaveLength(0);
    expect(noCanvas.calls).toEqual({ drawings: 1 });
    expect(outcomes.map((outcome) => outcome.record?.decisions?.stop?.reason)).toEqual(["canvas_unavailable", "canvas_unavailable", "canvas_unavailable"]);
  });
});

// TI-704 option B, written before the code: a local ChatGPT job sends its groups to Decisions (a server key and its
// spending) instead of its creator's plan; the plan is read again for every page; a plan that cannot start (a model
// the account lacks) loses the rules' classes too, or fails the job; the record says « Decisions ».
describe("a local ChatGPT job's groups (worker-server.ts, TI-704 option B)", () => {
  /** The plan's fake: every group of a request at `classe`, 0.9; the requests it got. */
  function localPlan(classe: string) {
    const requests: number[] = [];
    let reads = 0;
    const call: LocalGroupsCall = async ({ prompt }) => {
      const aliases = [...prompt.matchAll(/"groupe":"(groupe_\d+)"/g)].map((match) => match[1]);
      requests.push(aliases.length);
      return { data: { groupes: aliases.map((groupe) => ({ groupe, classe, probabilite: 0.9 })) }, totalTokens: 50 };
    };
    return { requests, read: async () => { reads += 1; return call; }, reads: () => reads };
  }

  it("reads the groups with the creator's plan, 8 per request, the plan read once for the job, never Decisions", async () => {
    const { decide, seen } = fakeDecide(() => ({ value: "EU", margin: 0.9 }));
    const plan = localPlan("EU");
    const outcomes = await read([[page(1, 10, { scale: true }), page(2, 3)]], hook(decide, { local: { call: plan.read } }));
    expect(seen).toHaveLength(0);
    expect([plan.requests, plan.reads()]).toEqual([[8, 2, 3], 1]);
    const record = VectorPageRecordSchema.parse(outcomes[0].record);
    expect(record.groups.filter((group) => group.source === "chatgpt")).toHaveLength(10);
    expect(record.groups[0]).toMatchObject({ class: "EU", source: "chatgpt", confidence: 0.9 });
    expect(record.decisions).toMatchObject({ prompt_version: "takeoff-vector-groups-v2-local", calls: { batch: 2, failed: 0 }, answered: 10, total_tokens: 100 });
    expect(outcomes[0].items.some((item) => item.geometry.network === "EU")).toBe(true);
  });

  it("keeps the rules' classes when the plan cannot start, stops the job's plan, and never fails a page", async () => {
    const { decide, seen } = fakeDecide(() => ({ value: "EU", margin: 0.9 }));
    const missing = hook(decide, { local: { call: async () => { throw new LocalGroupsStop("local_model_unavailable", "Modèle absent."); } } });
    const outcomes = await read([[page(1, 1, { sameColour: true }), page(2, 2, { sameColour: true })]], missing);
    expect(seen).toHaveLength(0);
    expect(outcomes.map((outcome) => outcome.error)).toEqual([null, null]);
    expect(outcomes[0].record?.groups.find((group) => group.source === "rule")).toMatchObject({ class: "EF" });
    expect(outcomes[0].record?.decisions).toMatchObject({ prompt_version: "takeoff-vector-groups-v2-local",
      stop: { reason: "local_model_unavailable", message: "Le forfait ChatGPT ne propose pas le modèle mesuré : les groupes suivent les règles ou restent à revoir.",
        from_earlier_page: false } });
    // A later page takes the same fallback (the rules alone), never Decisions.
    expect(outcomes[1].record?.groups.find((group) => group.source === "rule")).toMatchObject({ class: "EF" });
    expect(outcomes[1].record?.decisions).toMatchObject({ prompt_version: "takeoff-vector-groups-v2-local", calls: { batch: 0 },
      stop: { reason: "local_model_unavailable", from_earlier_page: true } });
  });

  it("gives a document the plan's own allowance of requests, not Decisions' 10 calls, and names its plan when it is reached", async () => {
    const { decide } = fakeDecide(() => ({ value: "EU", margin: 0.9 }));
    const plan = localPlan("fond");
    // 3 pages of 30 candidates: 12 requests of the plan, none left out (Decisions' cap would have cut the third page).
    const outcomes = await read([[page(1, 30), page(2, 30), page(3, 30)]], hook(decide, { local: { call: plan.read } }));
    expect(plan.requests).toEqual([8, 8, 8, 6, 8, 8, 8, 6, 8, 8, 8, 6]);
    expect(outcomes.map((outcome) => outcome.record?.decisions?.stop ?? null)).toEqual([null, null, null]);
    // One document past its allowance (20 requests, then 20 of the 25 its second page asks): the remaining groups follow
    // the rules, the review names the plan.
    const heavy = localPlan("fond");
    const capped = await read([[page(1, 160), page(2, 200)]], hook(decide, { local: { call: heavy.read } }));
    expect([TAKEOFF_VECTOR_LOCAL_LIMITS.requestsPerDocument, heavy.requests.length]).toEqual([40, 40]);
    expect(capped[0].record?.decisions?.stop).toBeNull();
    expect(capped[1].record?.decisions).toMatchObject({ left_out: 40, stop: { reason: "call_limit", message: "Le plafond de demandes ChatGPT est atteint (25 par page, 40 par document) : les groupes restants suivent les règles ou restent à revoir." } });
  });

  it("checks the creator's membership before each plan request: a creator removed from the tenant stops the job, no image sent", async () => {
    vi.stubEnv("MERGEONE_TAKEOFF_VECTORS", "1");
    vi.stubEnv("MERGEONE_TAKEOFF_DECISIONS", "1");
    vi.stubEnv("NODE_ENV", "development");
    const plan = localPlan("EU");
    const checks: string[] = [];
    let member = true;
    const provider = {
      selection: { profileId: "profile-fixture", model: "fixture-profile-model", reasoningEffort: null },
      assertOwnerActive: async () => {
        checks.push("membership");
        if (!member) throw Object.assign(new Error("Le créateur du métré n’a plus d’accès actif au tenant."), { code: "FORBIDDEN" });
      },
    };
    const built = takeoffVectorLocalGroupsHook({ jobId: "job-fixture", tenantId: OWNER.tenantId, userId: OWNER.userId, provider,
      beforeCall: async () => { checks.push("job"); } })!;
    await read([[page(1, 10)]], { ...built, render: fakeRender().render, local: { ...built.local, call: plan.read } });
    // Once before the plan is first read (its credential and listing), then before each of its 2 requests.
    expect([plan.requests, checks]).toEqual([[8, 2], ["membership", "job", "membership", "job", "membership", "job"]]);
    member = false;
    const later = localPlan("EU");
    await expect(read([[page(1, 10)]], { ...built, render: fakeRender().render, local: { ...built.local, call: later.read } }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(later.requests).toEqual([]);
    vi.unstubAllEnvs();
  });

  it("checks the creator's membership and the job before the plan is first read: a creator removed never has their token used", async () => {
    vi.stubEnv("MERGEONE_TAKEOFF_VECTORS", "1");
    vi.stubEnv("MERGEONE_TAKEOFF_DECISIONS", "1");
    vi.stubEnv("NODE_ENV", "development");
    const selection = { profileId: "profile-fixture", model: "fixture-profile-model", reasoningEffort: null };
    const steps: string[] = [];
    let member = true;
    vi.mocked(getLocalChatGptCredential).mockImplementation(async () => {
      steps.push("credential");
      return { accessToken: "fixture-token", ...selection } as never;
    });
    vi.mocked(assertLocalChatGptOverride).mockImplementation(async () => {
      steps.push("listing");
      return Object.freeze({ model: "gpt-6.1-sol", reasoningEffort: "low" as const });
    });
    vi.mocked(callLocalChatGptStructured).mockImplementation(async (_owner, options) => {
      steps.push("request");
      const aliases = [...String(options.prompt).matchAll(/"groupe":"(groupe_\d+)"/g)].map((match) => match[1]);
      const data = { groupes: aliases.map((groupe) => ({ groupe, classe: "EU", probabilite: 0.9 })) };
      return { data, tokenCount: 40, rawText: JSON.stringify(data), schemaError: null } as never;
    });
    const provider = {
      selection,
      assertOwnerActive: async () => {
        steps.push("membership");
        if (!member) throw Object.assign(new Error("Le créateur du métré n’a plus d’accès actif au tenant."), { code: "FORBIDDEN" });
      },
    };
    const built = takeoffVectorLocalGroupsHook({ jobId: "job-fixture", tenantId: OWNER.tenantId, userId: OWNER.userId, provider,
      beforeCall: async () => { steps.push("job"); } })!;
    const outcomes = await read([[page(1, 3)]], { ...built, render: fakeRender().render });
    expect(steps.slice(0, 4)).toEqual(["membership", "job", "credential", "listing"]);
    expect(steps.filter((step) => step === "request")).toHaveLength(1);
    expect(outcomes[0].record?.groups.filter((group) => group.source === "chatgpt")).toHaveLength(3);
    steps.length = 0;
    member = false;
    await expect(read([[page(1, 3)]], { ...built, render: fakeRender().render })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(steps).toEqual(["membership"]);
    vi.unstubAllEnvs();
  });

  it("takes a building line for registration only from a class the plan's model gives at its accepted probability", async () => {
    vi.stubEnv("MERGEONE_TAKEOFF_RULES", "1");
    const { decide } = fakeDecide(() => ({ value: "EU", margin: 0.9 }));
    const wall = (probabilite: number) => {
      const call: LocalGroupsCall = async ({ prompt }) => {
        const aliases = [...prompt.matchAll(/"groupe":"(groupe_\d+)"/g)].map((match) => match[1]);
        return { data: { groupes: aliases.map((groupe) => ({ groupe, classe: "fond", probabilite })) }, totalTokens: 10 };
      };
      return hook(decide, { local: { call: async () => call } });
    };
    // Groups of saturated colours (never a building colour): only an accepted « fond » makes them building lines.
    const [unsure] = await read([[page(1, 3, { scale: true })]], wall(0.3));
    expect(unsure.record?.groups.filter((group) => group.class === "fond")).toHaveLength(3);
    expect(unsure.anchors?.lines).toEqual([]);
    const [sure] = await read([[page(1, 3, { scale: true })]], wall(0.9));
    expect(sure.anchors?.lines.length).toBeGreaterThan(0);
    vi.unstubAllEnvs();
  });

  it("logs the plan's requests and tokens for the job, never a Decisions budget", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { decide } = fakeDecide(() => ({ value: "EU", margin: 0.9 }));
    await read([[page(1, 10)]], hook(decide, { local: { call: localPlan("EU").read } }));
    expect(info).toHaveBeenCalledWith("takeoff.vector.decisions", { job_id: null, tenant_id: null, provider: "chatgpt_local", calls: 2, total_tokens: 100,
      max_tokens: null, stop: null });
    info.mockRestore();
  });
});

describe("the worker's local plan opt-in (takeoffVectorLocalGroupsHook)", () => {
  afterEach(() => vi.unstubAllEnvs());
  const on = { MERGEONE_TAKEOFF_VECTORS: "1", MERGEONE_TAKEOFF_DECISIONS: "1" };
  const selection = { profileId: "profile-fixture", model: "fixture-profile-model", reasoningEffort: null };
  const job = { jobId: "job-fixture", tenantId: "tenant-fixture", userId: "user-fixture", provider: { selection, assertOwnerActive: async () => {} } };

  it("is on wherever the local plan is (development since #293, or the explicit opt-in), for the job's creator and pinned profile; never in production", () => {
    vi.stubEnv("CI", "");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("OPENAI_DECISIONS_API_KEY", "");
    vi.stubEnv("MERGEONE_CHATGPT_LOCAL", "");
    for (const [name, value] of Object.entries(on)) vi.stubEnv(name, value);
    vi.stubEnv("NODE_ENV", "development");
    expect(takeoffVectorLocalGroupsHook(job)).toMatchObject({ owner: { tenantId: "tenant-fixture", userId: "user-fixture" }, local: { selection } });
    expect(takeoffVectorLocalGroupsHook({ ...job, userId: null })).toBeUndefined();
    for (const name of Object.keys(on)) {
      vi.stubEnv(name, "");
      expect(takeoffVectorLocalGroupsHook(job), name).toBeUndefined();
      vi.stubEnv(name, on[name as keyof typeof on]);
    }
    // Outside development, only the explicit opt-in turns the plan on; a production build never.
    vi.stubEnv("NODE_ENV", "test");
    expect(takeoffVectorLocalGroupsHook(job)).toBeUndefined();
    vi.stubEnv("MERGEONE_CHATGPT_LOCAL", "1");
    expect(takeoffVectorLocalGroupsHook(job)).toMatchObject({ local: { selection } });
    vi.stubEnv("NODE_ENV", "production");
    expect(takeoffVectorLocalGroupsHook(job)).toBeUndefined();
  });
});

describe("the worker's Decisions opt-in (takeoffVectorDecisionsHook)", () => {
  afterEach(() => vi.unstubAllEnvs());
  const on = { MERGEONE_TAKEOFF_VECTORS: "1", MERGEONE_TAKEOFF_DECISIONS: "1", MERGEONE_OPENAI_DECISIONS: "1", OPENAI_DECISIONS_API_KEY: "fictional-key" };
  const job = { jobId: "job-fixture", tenantId: "tenant-fixture", userId: "user-fixture" };

  it("is off unless the vector reading, the takeoff opt-in, Decisions and its key are all set, and a user is known", () => {
    for (const [name, value] of Object.entries(on)) vi.stubEnv(name, value);
    expect(takeoffVectorDecisionsHook(job)).toMatchObject({ owner: { tenantId: "tenant-fixture", userId: "user-fixture" }, projectId: "takeoff-job:job-fixture" });
    expect(takeoffVectorDecisionsHook({ ...job, userId: null })).toBeUndefined();
    for (const name of Object.keys(on)) {
      vi.stubEnv(name, "");
      expect(takeoffVectorDecisionsHook(job), name).toBeUndefined();
      vi.stubEnv(name, on[name as keyof typeof on]);
    }
  });
});
