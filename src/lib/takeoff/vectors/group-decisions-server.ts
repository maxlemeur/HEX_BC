import "server-only";

import type { ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import { callOpenAiDecisions, type OpenAiDecisionImage, type OpenAiDecisionsResult } from "@/lib/ai/decisions";
import type { DecisionsTokenBudget } from "@/lib/ai/decisions-budget";
import type { DecisionsAnswer } from "@/lib/takeoff/vectors/classify";
import type { VectorPageExtraction } from "@/lib/takeoff/vectors/extraction";
import {
  decisionBatches,
  GROUP_DECISIONS_LIMITS,
  groupEvidence,
  groupQuestions,
  nearestLabelTexts,
  needsDedicated,
  readGroupAnswers,
  selectDecisionCandidates,
  type DecisionCandidate,
  type DecisionsCallKind,
  type GroupAnswer,
} from "@/lib/takeoff/vectors/group-decisions";
import { legendCrop, planContactSheet, planDedicated, type SheetPlan } from "@/lib/takeoff/vectors/group-sheet";
import {
  renderGroupSheets,
  renderLegendExtract,
  type GroupImage,
  type GroupLegendResult,
  type GroupSheetsResult,
} from "@/lib/takeoff/vectors/group-sheet-server";
import { buildPageModel } from "@/lib/takeoff/vectors/page-model";
import type { VectorPageReading } from "@/lib/takeoff/vectors/pipeline";

// The Decisions classification of one page's vector groups (TI-662 L3c), for
// the bench and, later, the takeoff worker. Per document page:
// - the candidates of the keyword reading (group-decisions.ts), at most 10
//   batch calls of 36 groups, each with two images: the legend extract (or the
//   page thumbnail without a legend) and the contact sheet of its groups;
// - then at most 50 dedicated calls, one group each with its own 1200 px
//   render, for the groups whose batch answer is missing, refused, invalid or
//   under 0.5; a dedicated answer replaces the batch one;
// - the token budget is asked before each call and given its usage after it;
//   a refusal stops the loop (budget_reached). The first failed or unavailable
//   result, or an exception before sending, stops it too, never retried;
// - without canvas, or when an image cannot be rendered, no call is sent for
//   the page (canvas_unavailable, render_failed).
// Whatever stops, the groups without an answer stay « à revoir »; the reading
// takes the answers through readVectorPage's `decisions` (decisionsOfOutcome).
// The call log holds counts, statuses, usage and timings: never the evidence,
// the images nor a key.

/** Reserve per call before the first answer (two images of up to 1.5 MB and up to 36 groups of evidence). */
export const GROUP_DECISIONS_CALL_ESTIMATE_TOKENS = 20_000;
/** Dedicated renders drawn per child process: the loop may stop before the next ones are needed. */
export const GROUP_DECISIONS_DEDICATED_RENDER_CHUNK = 10;

export type GroupDecisionsDecide = (input: Parameters<typeof callOpenAiDecisions>[0]) => Promise<OpenAiDecisionsResult>;
export type GroupDecisionsRender = {
  legend: (input: { bytes: Uint8Array; page: number; crop: ReturnType<typeof legendCrop> }) => Promise<GroupLegendResult>;
  sheets: (plans: readonly SheetPlan[]) => Promise<GroupSheetsResult>;
};

export type GroupDecisionsStopReason = "budget_reached" | "call_failed" | "decisions_unavailable" | "exception" | "canvas_unavailable" | "render_failed";
export type GroupDecisionsStop = { reason: GroupDecisionsStopReason; message: string };
export type GroupDecisionsCall = {
  kind: DecisionsCallKind;
  questions: number;
  status: OpenAiDecisionsResult["status"] | "exception";
  usage: { input_tokens: number; output_tokens: number; total_tokens: number } | null;
  latency_ms: number;
  render_ms: number | null;
  error?: string;
};
export type GroupDecisionsAnswer = GroupAnswer & { alias: string; via: DecisionsCallKind };
export type GroupDecisionsOutcome = {
  /** By group id. */
  answers: Map<string, GroupDecisionsAnswer>;
  calls: GroupDecisionsCall[];
  stop: GroupDecisionsStop | null;
  candidates: number;
  eligible: number;
  left_out: number;
  render: { legend_ms: number | null; sheets_ms: number[] };
};

/** Stops that end a series of pages (bench run, worker job): the provider or the ceiling, not a page's render. */
export function isDecisionsRunStop(reason: GroupDecisionsStopReason) {
  return reason === "budget_reached" || reason === "call_failed" || reason === "decisions_unavailable" || reason === "exception";
}

/** The answers the reading applies: answered classes only, by group id. */
export function decisionsOfOutcome(outcome: Pick<GroupDecisionsOutcome, "answers">): Map<string, DecisionsAnswer> {
  const decisions = new Map<string, DecisionsAnswer>();
  for (const [id, answer] of outcome.answers) {
    if (answer.status === "answered" && answer.class !== null && answer.confidence !== null) decisions.set(id, { class: answer.class, confidence: answer.confidence });
  }
  return decisions;
}

const DEFAULT_RENDER: GroupDecisionsRender = {
  legend: ({ bytes, page, crop }) => renderLegendExtract(bytes, page, crop),
  sheets: (plans) => renderGroupSheets(plans),
};

const RENDER_MESSAGES: Record<string, string> = {
  canvas_unavailable: "Le module de dessin n’est pas installé sur ce serveur : les groupes restent à revoir.",
  render_failed: "Les images des groupes n’ont pas pu être dessinées : les groupes restent à revoir.",
  too_large: "Les images des groupes dépassent la taille envoyée à Decisions : les groupes restent à revoir.",
  timeout: "Les images des groupes n’ont pas été dessinées à temps : les groupes restent à revoir.",
};

function renderStop(issue: string | null): GroupDecisionsStop {
  return { reason: issue === "canvas_unavailable" ? "canvas_unavailable" : "render_failed", message: RENDER_MESSAGES[issue ?? "render_failed"] ?? RENDER_MESSAGES.render_failed };
}

const asImage = (image: GroupImage): OpenAiDecisionImage => ({ mimeType: image.mimeType, data: image.data });

/** Classifies one page's candidate groups; never throws for a provider, budget or render failure. */
export async function classifyVectorGroups(input: {
  bytes: Uint8Array;
  extraction: VectorPageExtraction;
  /** The keyword reading of the page (readVectorPage without decisions). */
  reading: VectorPageReading;
  owner: ChatGptOwner;
  context: { tenantId: string; projectId: string; preparationFingerprint: string };
  budget: DecisionsTokenBudget;
  decide?: GroupDecisionsDecide;
  render?: GroupDecisionsRender;
  clock?: () => number;
  log?: (line: string) => void;
}): Promise<GroupDecisionsOutcome> {
  const decide = input.decide ?? callOpenAiDecisions;
  const render = input.render ?? DEFAULT_RENDER;
  const clock = input.clock ?? (() => performance.now());
  const model = buildPageModel(input.extraction);
  const selection = selectDecisionCandidates(model, input.reading);
  const outcome: GroupDecisionsOutcome = {
    answers: new Map(), calls: [], stop: null, candidates: selection.candidates.length, eligible: selection.eligible, left_out: selection.left_out,
    render: { legend_ms: null, sheets_ms: [] },
  };
  if (selection.candidates.length === 0) return outcome;
  const { candidates } = selection;
  const labels = nearestLabelTexts(model, input.reading, candidates);
  const crop = input.reading.mode === "colours" ? legendCrop(input.reading.legend.boxes, input.extraction.width, input.extraction.height) : null;
  const legendImage = crop ? "legend_crop" as const : "page_thumbnail" as const;
  const safely = async <T>(work: () => Promise<T>): Promise<T | null> => {
    try {
      return await work();
    } catch {
      return null;
    }
  };
  const legend = await safely(() => render.legend({ bytes: input.bytes, page: input.extraction.page, crop }));
  outcome.render.legend_ms = legend?.duration_ms ?? null;
  if (!legend?.image) {
    outcome.stop = renderStop(legend?.issue ?? null);
    return outcome;
  }
  const batches = decisionBatches(candidates).slice(0, GROUP_DECISIONS_LIMITS.maxBatchCalls);
  const sheets = await safely(() => render.sheets(batches.map((batch) => planContactSheet(model, batch))));
  if (!sheets || sheets.issue !== null || sheets.images.some((image) => image === null)) {
    outcome.stop = renderStop(sheets?.issue ?? null);
    return outcome;
  }
  outcome.render.sheets_ms.push(...sheets.render_ms.map((value) => value ?? 0));

  /** One call; false when the loop stops. */
  const ask = async (kind: DecisionsCallKind, group: readonly DecisionCandidate[], image: GroupImage, renderMs: number | null) => {
    if (!input.budget.tryStart()) {
      outcome.stop = { reason: "budget_reached", message: "Le plafond de jetons Decisions est atteint : les groupes restants sont à revoir." };
      return false;
    }
    const started = clock();
    let result: OpenAiDecisionsResult | null = null;
    let error: string | undefined;
    try {
      result = await decide({
        owner: input.owner, context: input.context,
        evidence: groupEvidence({ model, reading: input.reading, candidates: group, labels, call: kind, legendImage }),
        images: [asImage(legend.image as GroupImage), asImage(image)],
        questions: groupQuestions(model, group, kind),
      });
    } catch (thrown) {
      error = thrown instanceof Error ? thrown.message.slice(0, 300) : "Demande Decisions refusée avant l’envoi.";
    }
    const usage = result?.provenance.usage ?? null;
    input.budget.finish(usage);
    const status = result?.status ?? "exception";
    outcome.calls.push({ kind, questions: group.length, status, usage, latency_ms: Math.max(0, Math.round(clock() - started)), render_ms: renderMs,
      ...(error !== undefined ? { error } : status === "failed" || status === "unavailable" ? { error: result?.message.slice(0, 300) } : {}) });
    input.log?.(`decisions ${kind} ${group.length} groupe(s): ${status}${usage ? `, ${usage.total_tokens} jetons` : ""}`);
    if (!result) {
      outcome.stop = { reason: "exception", message: error ?? "Demande Decisions refusée avant l’envoi." };
      return false;
    }
    if (status === "failed" || status === "unavailable") {
      // No answer of a failed call replaces a batch answer: those groups keep what they had, or stay « à revoir ».
      outcome.stop = { reason: status === "failed" ? "call_failed" : "decisions_unavailable", message: result.message };
      return false;
    }
    for (const [id, answer] of readGroupAnswers(model, group, result.answers)) {
      const alias = group.find((candidate) => candidate.id === id)?.alias ?? "";
      outcome.answers.set(id, { ...answer, alias, via: kind });
    }
    return true;
  };

  for (const [index, batch] of batches.entries()) {
    if (!(await ask("batch", batch, sheets.images[index] as GroupImage, sheets.render_ms[index] ?? null))) return outcome;
  }
  const again = candidates.filter((candidate) => outcome.answers.has(candidate.id) && needsDedicated(outcome.answers.get(candidate.id)))
    .slice(0, GROUP_DECISIONS_LIMITS.maxDedicatedCalls);
  for (const chunk of decisionBatches(again, GROUP_DECISIONS_DEDICATED_RENDER_CHUNK)) {
    const renders = await safely(() => render.sheets(chunk.map((candidate) => planDedicated(model, candidate))));
    if (!renders || renders.issue !== null || renders.images.some((image) => image === null)) {
      outcome.stop = renderStop(renders?.issue ?? null);
      return outcome;
    }
    outcome.render.sheets_ms.push(...renders.render_ms.map((value) => value ?? 0));
    for (const [index, candidate] of chunk.entries()) {
      if (!(await ask("dedicated", [candidate], renders.images[index] as GroupImage, renders.render_ms[index] ?? null))) return outcome;
    }
  }
  return outcome;
}
