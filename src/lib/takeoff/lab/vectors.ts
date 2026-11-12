import "server-only";

import { z } from "zod";

import { callOpenAiDecisions, type OpenAiDecisionsResult } from "@/lib/ai/decisions";
import { createDecisionsTokenBudget } from "@/lib/ai/decisions-budget";
import { badRequest, conflict, unprocessableEntity } from "@/lib/estimates/errors";
import {
  LAB_VECTOR_MAX_SEGMENTS, LAB_VECTOR_TASK_ID, type LabAnswer, type LabConfigId, type LabConfigResult, type LabElement, type LabRun,
  type LabVectorGroup, type LabVectorPage,
} from "@/lib/takeoff/lab/contracts";
import { assertCropPage, type LabDocument } from "@/lib/takeoff/lab/dataset";
import type { LabAccess } from "@/lib/takeoff/lab/runs";
import { elementIdOf, sha256Hex } from "@/lib/takeoff/lab/storage";
import type { LabTask } from "@/lib/takeoff/lab/tasks";
import { classifyByKeywords, isVectorClass, type DecisionsAnswer, type GroupClass } from "@/lib/takeoff/vectors/classify";
import { extractVectorPage, VectorExtractionError, type VectorPageExtraction } from "@/lib/takeoff/vectors/extraction";
import { pointsToMetres } from "@/lib/takeoff/vectors/geometry";
import {
  classifyVectorGroups, GROUP_DECISIONS_CALL_ESTIMATE_TOKENS, type GroupDecisionsDecide, type GroupDecisionsRender,
  type GroupDecisionsStop,
} from "@/lib/takeoff/vectors/group-decisions-server";
import { buildPageModel, type GroupStats, type PageModel } from "@/lib/takeoff/vectors/page-model";
import { readVectorPage, type VectorPageReading } from "@/lib/takeoff/vectors/pipeline";

// The vectors page of the takeoff lab (TI-662 L3c) and its task « classe de
// calque », on a document page of the lab (dataset or fixture):
// - the page is extracted (extraction.ts, child process, 15 s) and read with
//   keywords (pipeline.ts readVectorPage); with a « classe de calque » run of
//   that document page, read again with the run's answers (readVectorPage's
//   `decisions`): a Decisions class is applied, classified and measured only
//   under classify.ts rules (network at confidence ≥ 0.8);
// - the task runs group-decisions-server.ts classifyVectorGroups once, within
//   what TAKEOFF_LAB_DECISIONS_MAX_TOKENS leaves (asked before each call), its
//   images drawn by the server; the first failed or unavailable call stops it,
//   never retried. A stop after answers (provider, ceiling or a dedicated
//   render) is a partial configuration that keeps them, its message the stop's;
//   an answer's probabilities come from the call whose answer is kept. Its run
//   keeps every call's normalized result (no image, no key) and one question
//   element per asked group, so the verdicts and stats of the lab read it like
//   any choice;
// - the geometry sent to the page is bounded: LAB_VECTOR_MAX_SEGMENTS segments
//   per page, longest groups first, a cut group says so.
// The lab never writes the dataset: « Copier la sélection » gives the JSON of
// truth/groups for a person to write.

type VectorExtract = (bytes: Uint8Array, page: number) => Promise<VectorPageExtraction>;

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

const width = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

/** Layer name, else colour, width and dash: how a person finds the group in the PDF. */
export function vectorGroupName(group: Pick<GroupStats, "layer" | "layerName" | "colors" | "width" | "dash">) {
  if (group.layer !== null) return group.layerName?.trim() || `Calque ${group.layer}`;
  return `${group.colors[0] ?? "?"} · ${width.format(group.width)} pt${group.dash ? " · tirets" : ""}`;
}

async function extractOrRefuse(bytes: Uint8Array, page: number, extract: VectorExtract) {
  try {
    return await extract(bytes, page);
  } catch (error) {
    if (error instanceof VectorExtractionError) {
      throw unprocessableEntity(`Lecture vectorielle de la page ${page} impossible : ${error.message}`, { reason: error.reason }, "TAKEOFF_LAB_VECTORS");
    }
    throw error;
  }
}

function choiceLabel(task: LabTask, value: unknown) {
  return task.question?.choices.find((choice) => choice.value === value)?.label ?? String(value);
}

const StoredAnswerSchema = z.looseObject({
  group: z.string(),
  answer: z.looseObject({ class: z.string().nullable(), confidence: z.number().nullable(), status: z.string() }),
});

/** The answered classes of a « classe de calque » run, by group id (what readVectorPage applies). */
export function decisionsOfLabRun(run: LabRun): Map<string, DecisionsAnswer> {
  const decisions = new Map<string, DecisionsAnswer>();
  for (const config of run.configs) {
    if (config.provider !== "decisions") continue;
    for (const element of config.elements) {
      const parsed = StoredAnswerSchema.safeParse(element.json);
      if (!parsed.success) continue;
      const { class: value, confidence, status } = parsed.data.answer;
      if (status === "answered" && value !== null && confidence !== null && isVectorClass(value)) {
        decisions.set(parsed.data.group, { class: value, confidence });
      }
    }
  }
  return decisions;
}

function groupStats(model: PageModel, reading: VectorPageReading, index: number) {
  const group = model.groups[index];
  const denominator = reading.scale.denominator;
  return {
    layer: group.layerName, colors: group.colors.slice(0, 8), width: group.width, dash: group.dash, grey: group.grey, near_white: group.nearWhite,
    hidden: group.hidden, paths: group.paths, segments: group.segments, closed: group.closed, length_pt: round(group.visibleLength_pt, 1),
    length_m: denominator === null ? null : round(pointsToMetres(group.visibleLength_pt, denominator), 2),
    share: model.visibleLength_pt > 0 ? round(group.visibleLength_pt / model.visibleLength_pt, 4) : null,
  };
}

function keywordGuess(entry: GroupClass | undefined): LabVectorGroup["keyword"] {
  if (!entry || entry.class === null) return { class: null, source: null };
  return { class: entry.class, source: entry.source === "legend" ? "legend" : "keyword" };
}

export type VectorGroupsConfig = Pick<LabConfigResult, "status" | "message" | "latency_ms" | "usage" | "raw" | "answers" | "elements">
  & { stop: GroupDecisionsStop | null };

/** The one Decisions configuration of a « classe de calque » essai; never throws for a provider, budget or render failure. */
export async function runVectorGroupsConfig(input: {
  access: LabAccess;
  runId: string;
  configId: LabConfigId;
  task: LabTask;
  document: LabDocument;
  page: number;
  promptVersion: string;
  /** Tokens TAKEOFF_LAB_DECISIONS_MAX_TOKENS still allows (pre-flight: at least 1). */
  remainingTokens: number;
  extract?: VectorExtract;
  /** Tests only: a Decisions fake and fake renders (production: callOpenAiDecisions, group-sheet-server.ts). */
  decide?: GroupDecisionsDecide;
  render?: GroupDecisionsRender;
}): Promise<VectorGroupsConfig> {
  const { task, document, page } = input;
  const bytes = new Uint8Array(document.bytes);
  const extraction = await extractOrRefuse(bytes, page, input.extract ?? ((source, number) => extractVectorPage(source, number)));
  const reading = readVectorPage(extraction);
  const model = buildPageModel(extraction);
  const keywords = classifyByKeywords(model, reading.legend);
  /** Each call's result in the order the calls started (they may end in any order: TI-704); null for one that threw. */
  const results: Array<OpenAiDecisionsResult | null> = [];
  const budget = createDecisionsTokenBudget(Math.max(1, input.remainingTokens), GROUP_DECISIONS_CALL_ESTIMATE_TOKENS);
  const outcome = await classifyVectorGroups({
    bytes, extraction, reading, owner: input.access.owner, budget, render: input.render,
    context: { tenantId: input.access.owner.tenantId, projectId: "takeoff-lab",
      preparationFingerprint: sha256Hex(`${document.sha256}\u0000${task.id}\u0000${input.promptVersion}`) },
    decide: async (request) => {
      const slot = results.push(null) - 1;
      const result = await (input.decide ?? callOpenAiDecisions)(request);
      results[slot] = result;
      return result;
    },
  });
  const indexOf = new Map(model.groups.map((group, index) => [group.id, index]));
  const asked = [...outcome.answers].sort(([, left], [, right]) => (left.alias < right.alias ? -1 : left.alias > right.alias ? 1 : 0));
  const answers: LabAnswer[] = [];
  const elements: LabElement[] = [];
  for (const [groupId, entry] of asked) {
    const index = indexOf.get(groupId) as number;
    const name = vectorGroupName(model.groups[index]);
    // The probabilities of the call the kept answer comes from (group-decisions-server.ts): the dedicated one when it
    // replaced the batch answer, never a failed call's nor one sent after the stop.
    const probabilities = entry.status === "answered" && entry.probabilities ? entry.probabilities.map((option) => ({
      value: String(option.value), label: choiceLabel(task, option.value), probability: option.probability,
    })).sort((left, right) => right.probability - left.probability) : null;
    const answer: LabAnswer = {
      name: entry.alias, label: name, status: entry.status, value: entry.class, value_label: entry.class === null ? null : choiceLabel(task, entry.class),
      confidence: entry.confidence, probabilities,
    };
    answers.push(answer);
    elements.push({
      id: elementIdOf(input.runId, input.configId, "question", groupId), kind: "question", key: groupId, label: name,
      detail: answer.value_label ?? `Réponse ${entry.status === "refused" ? "refusée" : entry.status === "missing" ? "manquante" : "invalide"}`,
      source_page: page, evidence: null, schema_error: false, answer,
      json: { group: groupId, alias: entry.alias, page, answer: { class: entry.class, confidence: entry.confidence, status: entry.status, via: entry.via },
        stats: groupStats(model, reading, index), keyword: keywordGuess(keywords[index]) },
    });
  }
  const withUsage = outcome.calls.filter((call) => call.usage !== null);
  const usage = withUsage.length === 0 ? null : withUsage.reduce((total, call) => ({
    input: total.input + (call.usage?.input_tokens ?? 0), output: total.output + (call.usage?.output_tokens ?? 0), reasoning: 0,
    total: total.total + (call.usage?.total_tokens ?? 0),
  }), { input: 0, output: 0, reasoning: 0, total: 0 });
  // The time the calls took together (TI-704: they run in parallel), as the other configurations' elapsed time.
  const latency = outcome.calls_ms;
  const stop = outcome.stop;
  const incomplete = answers.some((answer) => answer.status !== "answered");
  // A stop after answers (provider, ceiling or a dedicated render) keeps them: they are paid, applied and judged.
  const status: LabConfigResult["status"] = stop ? (answers.length > 0 ? "partial" : "failed") : incomplete ? "partial" : "ok";
  const message = stop?.message
    ?? (outcome.candidates === 0 ? (reading.mode === "raster" ? "Page raster : aucun groupe vectoriel à classer." : "Aucun groupe à classer : les mots-clés ont classé toute la page.")
      : incomplete ? "Classement partiel : les groupes sans réponse restent à revoir." : null);
  return {
    status, message, latency_ms: latency, usage, answers, elements: status === "failed" ? [] : elements, stop,
    raw: JSON.stringify({
      page, mode: reading.mode, candidates: outcome.candidates, eligible: outcome.eligible, left_out: outcome.left_out, stop, render: outcome.render,
      calls: outcome.calls, results: results.filter((result) => result !== null),
    }, null, 2),
  };
}

/** Bounded geometry of the groups: their segments, longest groups first, LAB_VECTOR_MAX_SEGMENTS for the page. */
function boundedGeometry(model: PageModel, cap: number) {
  const perGroup: number[][] = model.groups.map(() => []);
  for (let index = 0; index < model.segments.length; index += 1) {
    const segment = model.segments[index];
    perGroup[model.segmentGroup[index]].push(round(segment.x0, 1), round(segment.y0, 1), round(segment.x1, 1), round(segment.y1, 1));
  }
  const order = model.groups.map((group, index) => ({ index, length: group.visibleLength_pt })).sort((left, right) => right.length - left.length);
  let left = cap;
  const shown = model.groups.map(() => ({ geometry: [] as number[], capped: false }));
  for (const { index } of order) {
    const count = perGroup[index].length / 4;
    const take = Math.min(count, left);
    shown[index] = { geometry: take === count ? perGroup[index] : perGroup[index].slice(0, take * 4), capped: take < count };
    left -= take;
  }
  return { shown, total: model.segments.length, drawn: cap - left };
}

/** The keyword reading of a document page, or, with a « classe de calque » run of that page, the reading with its answers. */
export async function readLabVectorPage(input: { document: LabDocument; page: number; run: LabRun | null; extract?: VectorExtract }): Promise<LabVectorPage> {
  const { document, page, run } = input;
  assertCropPage(document, page);
  if (run) {
    if (run.task.id !== LAB_VECTOR_TASK_ID) throw badRequest("Cet essai n’est pas une « classe de calque ».");
    if (run.document.id !== document.summary.id || (run.crop?.page ?? 1) !== page) throw badRequest("Cet essai porte sur une autre page ou un autre document.");
    if (run.document.sha256 !== document.sha256) {
      throw conflict("Ce document a changé depuis l’essai (SHA-256 différent) : ses réponses ne s’appliquent plus.", undefined, "TAKEOFF_LAB_DOCUMENT_CHANGED");
    }
  }
  const extraction = await extractOrRefuse(new Uint8Array(document.bytes), page, input.extract ?? ((source, number) => extractVectorPage(source, number)));
  const model = buildPageModel(extraction);
  const keywordReading = readVectorPage(extraction);
  const decisions = run ? decisionsOfLabRun(run) : new Map<string, DecisionsAnswer>();
  const reading = decisions.size > 0 ? readVectorPage(extraction, { decisions }) : keywordReading;
  const keywords = classifyByKeywords(model, keywordReading.legend);
  const geometry = boundedGeometry(model, LAB_VECTOR_MAX_SEGMENTS);
  const denominator = reading.scale.denominator;
  const groups: LabVectorGroup[] = model.groups.map((group, index) => {
    const entry = reading.groups[index];
    return {
      id: group.id, name: vectorGroupName(group), layer: group.layer, colors: group.colors.slice(0, 8), width: group.width, dash: group.dash,
      visible: !group.hidden, near_white: group.nearWhite, grey: group.grey,
      class: entry.class, source: entry.source, confidence: entry.confidence, candidates: entry.candidates,
      keyword: keywordGuess(keywords[index]),
      length_pt: round(group.visibleLength_pt, 1),
      length_m: denominator === null ? null : round(pointsToMetres(group.visibleLength_pt, denominator), 2),
      segments: group.segments, geometry: geometry.shown[index].geometry, geometry_capped: geometry.shown[index].capped,
    };
  });
  return {
    document: { id: document.summary.id, sha256: document.sha256, pages: document.summary.pages },
    page, mode: reading.mode, size_pt: reading.size_pt,
    scale: { status: reading.scale.status, reason: reading.scale.reason, denominator, cartouche: reading.scale.cartouche?.text ?? null,
      cotes: reading.scale.cotes.length, consistent_cotes: reading.scale.cotes.filter((cote) => cote.consistent).length },
    detection: reading.detection,
    groups,
    segments: { total: geometry.total, shown: geometry.drawn, cap: LAB_VECTOR_MAX_SEGMENTS, capped: geometry.drawn < geometry.total },
    networks: (reading.networks?.totals ?? []).map((total) => ({ network: total.network, material: total.material, dn: total.dn, runs: total.runs,
      length_pt: round(total.length_pt, 1), length_m: total.length_m === null ? null : round(total.length_m, 2) })),
    surfaces: reading.surfaces.map((surface) => ({ room: surface.room, printed_m2: surface.printed_m2, polygon_m2: surface.polygon_m2, deviation: surface.deviation })),
    run: run ? { id: run.id, campaign: run.campaign, created_at: run.created_at, answers: decisions.size,
      applied: reading.groups.filter((entry) => entry.source === "decisions").length } : null,
    timings: { extraction_ms: extraction.timings.total_ms, reading_ms: reading.timings.reading_ms },
  };
}
