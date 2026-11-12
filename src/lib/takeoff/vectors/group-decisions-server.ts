import "server-only";

import type { ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import { callOpenAiDecisions, type OpenAiDecisionAnswer, type OpenAiDecisionImage, type OpenAiDecisionsResult } from "@/lib/ai/decisions";
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
// the bench and the takeoff worker (worker-server.ts). Per document page:
// - the candidates of the keyword reading (group-decisions.ts), at most 10
//   batch calls of 36 groups, each with two images: the legend extract (or the
//   page thumbnail without a legend) and the contact sheet of its groups;
// - then at most 50 dedicated calls, one group each with its own 1200 px
//   render, for the groups whose batch answer is missing, refused, invalid or
//   under 0.5; a dedicated answer replaces the batch one;
// - the worker gives fewer (`limits`): what its document has left of its caps
//   per run; the groups past the batch caps are counted in `left_out`, those
//   whose weak answer is not asked again alone in `dedicated_left_out`;
// - the calls of each phase run GROUP_DECISIONS_CONCURRENCY at a time (TI-704),
//   started in their order, the dedicated ones once every batch call has
//   ended; the dedicated renders are drawn by chunks, one child process at a
//   time, the next chunk once the calls reach the current one;
// - `beforeCall` runs before each start, one at a time, outside of the call's
//   own failure: the worker renews its lease there, and its failure stops the
//   job: no call starts after it, the calls in flight are waited for, then its
//   error leaves this function, whatever they returned;
// - the token budget reserves each call before it starts and is given its
//   usage after it; while calls are in flight, a start the ceiling cannot hold
//   (a batch call counting each at GROUP_DECISIONS_BATCH_RESERVE_TOKENS at
//   least) waits for one of them to end; a refusal with none in flight stops
//   the page (budget_reached), as in a row. The first failed or unavailable
//   result, or an exception before sending, stops it too, never retried;
// - the first stop in call order decides: no call starts once a stop is known,
//   the calls in flight end, the answers of those after the stop are not
//   applied (logged `after_stop`). Answers, their order and the stop are those
//   of the same calls one after the other, whatever order they end in;
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
/**
 * Decisions calls in flight at once for a page (TI-704). The 5/11 bench page with the most calls sent 52 (2 batch,
 * 50 dedicated) in 38.6 s, one after the other at 0.5 to 1.9 s each; at 8, its real latencies end in 6.6 s, at 10 in
 * 5.9 s. 8 keeps:
 * - the calls in flight and the chunk drawn ahead within two dedicated chunks of images (8 ≤
 *   GROUP_DECISIONS_DEDICATED_RENDER_CHUNK), one render child at a time, its heap unchanged;
 * - the provider's rate at about 11 calls and 40 000 tokens per second on the dedicated calls (3 to 4 000 tokens
 *   each), 8 times the rate the 5/11 run sent in a row without a 429. A 429 stays a failed call that stops the
 *   job's Decisions, never retried (decisions.ts): the bench records this value (rules.vector.decisions) and a real
 *   pass that meets a 429 lowers it;
 * - the job ceiling's say: each call in flight holds the budget's reserve, the largest call seen (about 33 000 tokens
 *   after a full batch call), so under TAKEOFF_VECTOR_DECISIONS_MAX_TOKENS fewer run at once as the job spends.
 */
export const GROUP_DECISIONS_CONCURRENCY = 8;
/**
 * What each call in flight counts for at least when a batch call starts beside others (TI-704): a batch call of 36
 * groups cost 32 700 tokens on the 5/11 run, more than the estimate a budget reserves before it has seen one. Batch
 * calls started together thus never pass the ceiling unless one costs more than this. A dedicated call (2 to 4 000
 * tokens) needs none: the budget's reserve is never under GROUP_DECISIONS_CALL_ESTIMATE_TOKENS.
 */
export const GROUP_DECISIONS_BATCH_RESERVE_TOKENS = 40_000;

export type GroupDecisionsDecide = (input: Parameters<typeof callOpenAiDecisions>[0]) => Promise<OpenAiDecisionsResult>;
export type GroupDecisionsRender = {
  legend: (input: { bytes: Uint8Array; page: number; crop: ReturnType<typeof legendCrop> }) => Promise<GroupLegendResult>;
  sheets: (plans: readonly SheetPlan[]) => Promise<GroupSheetsResult>;
};

/** Calls one classification may send: GROUP_DECISIONS_LIMITS by default, what a document has left in the worker. */
export type GroupDecisionsCallLimits = { maxBatchCalls: number; maxDedicatedCalls: number };

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
  /** Sent before the stop of an earlier call was known (TI-704): its answers are not applied. */
  after_stop?: true;
};
export type GroupDecisionsAnswer = GroupAnswer & {
  alias: string;
  via: DecisionsCallKind;
  /** The probabilities Decisions gave with an answered class, from the call whose answer this is (the lab shows them). */
  probabilities?: NonNullable<OpenAiDecisionAnswer["probabilities"]>;
};
export type GroupDecisionsOutcome = {
  /** By group id. */
  answers: Map<string, GroupDecisionsAnswer>;
  calls: GroupDecisionsCall[];
  stop: GroupDecisionsStop | null;
  candidates: number;
  eligible: number;
  left_out: number;
  /** Groups whose batch answer needed a dedicated call past the dedicated caps: they keep it (« à revoir » under 0.8). */
  dedicated_left_out: number;
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

type CallImage = { image: GroupImage; renderMs: number | null };
/** A call that ended: its log entry, and its answers or the stop it makes. */
type SentCall = { call: GroupDecisionsCall; answers: Map<string, GroupDecisionsAnswer> | null; stop: GroupDecisionsStop | null };
/** The calls of a phase that started, by their index, and its first stop in call order. */
type Phase = { sent: SentCall[]; stop: { index: number; stop: GroupDecisionsStop } | null };

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
  /** At most GROUP_DECISIONS_LIMITS, never more. */
  limits?: GroupDecisionsCallLimits;
  /** Before each call; an error thrown here is not a Decisions failure: it leaves this function. */
  beforeCall?: () => Promise<void>;
  clock?: () => number;
  log?: (line: string) => void;
}): Promise<GroupDecisionsOutcome> {
  const decide = input.decide ?? callOpenAiDecisions;
  const render = input.render ?? DEFAULT_RENDER;
  const clock = input.clock ?? (() => performance.now());
  const cap = (value: number | undefined, max: number) => (value === undefined ? max : Math.max(0, Math.min(max, Math.floor(value))));
  const limits = {
    ...GROUP_DECISIONS_LIMITS,
    maxBatchCalls: cap(input.limits?.maxBatchCalls, GROUP_DECISIONS_LIMITS.maxBatchCalls),
    maxDedicatedCalls: cap(input.limits?.maxDedicatedCalls, GROUP_DECISIONS_LIMITS.maxDedicatedCalls),
  };
  const model = buildPageModel(input.extraction);
  const selection = selectDecisionCandidates(model, input.reading, limits);
  const outcome: GroupDecisionsOutcome = {
    answers: new Map(), calls: [], stop: null, candidates: selection.candidates.length, eligible: selection.eligible, left_out: selection.left_out,
    dedicated_left_out: 0, render: { legend_ms: null, sheets_ms: [] },
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
  const batches = decisionBatches(candidates).slice(0, limits.maxBatchCalls);
  const sheets = await safely(() => render.sheets(batches.map((batch) => planContactSheet(model, batch))));
  if (!sheets || sheets.issue !== null || sheets.images.some((image) => image === null)) {
    outcome.stop = renderStop(sheets?.issue ?? null);
    return outcome;
  }
  outcome.render.sheets_ms.push(...sheets.render_ms.map((value) => value ?? 0));

  /** One call, started: its log entry, and its answers or the stop it makes. Never throws. */
  const send = async (kind: DecisionsCallKind, group: readonly DecisionCandidate[], image: CallImage): Promise<SentCall> => {
    const started = clock();
    let result: OpenAiDecisionsResult | null = null;
    let error: string | undefined;
    try {
      result = await decide({
        owner: input.owner, context: input.context,
        evidence: groupEvidence({ model, reading: input.reading, candidates: group, labels, call: kind, legendImage }),
        images: [asImage(legend.image as GroupImage), asImage(image.image)],
        questions: groupQuestions(model, group, kind),
      });
    } catch (thrown) {
      error = thrown instanceof Error ? thrown.message.slice(0, 300) : "Demande Decisions refusée avant l’envoi.";
    }
    const usage = result?.provenance.usage ?? null;
    input.budget.finish(usage);
    const status = result?.status ?? "exception";
    const call: GroupDecisionsCall = { kind, questions: group.length, status, usage, latency_ms: Math.max(0, Math.round(clock() - started)),
      render_ms: image.renderMs,
      ...(error !== undefined ? { error } : status === "failed" || status === "unavailable" ? { error: result?.message.slice(0, 300) } : {}) };
    input.log?.(`decisions ${kind} ${group.length} groupe(s): ${status}${usage ? `, ${usage.total_tokens} jetons` : ""}`);
    if (!result) return { call, answers: null, stop: { reason: "exception", message: error ?? "Demande Decisions refusée avant l’envoi." } };
    // No answer of a failed call replaces a batch answer: those groups keep what they had, or stay « à revoir ».
    if (status === "failed" || status === "unavailable") {
      return { call, answers: null, stop: { reason: status === "failed" ? "call_failed" : "decisions_unavailable", message: result.message } };
    }
    const answers = new Map<string, GroupDecisionsAnswer>();
    for (const [id, answer] of readGroupAnswers(model, group, result.answers)) {
      const alias = group.find((candidate) => candidate.id === id)?.alias ?? "";
      const probabilities = answer.status === "answered" ? result.answers.find((entry) => entry.name === alias)?.probabilities : undefined;
      answers.set(id, { ...answer, alias, via: kind, ...(probabilities ? { probabilities } : {}) });
    }
    return { call, answers, stop: null };
  };

  /**
   * The calls of one phase, GROUP_DECISIONS_CONCURRENCY at a time, started in their order: each waits for a free
   * slot, its image (`imageOf`: a render failure stops there), room in the budget while calls are in flight, the job's
   * check and the budget's reserve. Ends once every call started has; throws the job check's error then.
   */
  const inParallel = async (kind: DecisionsCallKind, groups: readonly (readonly DecisionCandidate[])[],
    imageOf: (index: number) => Promise<CallImage | GroupDecisionsStop>): Promise<Phase> => {
    const phase: Phase = { sent: [], stop: null };
    const stopAt = (index: number, stop: GroupDecisionsStop) => {
      if (phase.stop === null || index < phase.stop.index) phase.stop = { index, stop };
    };
    /** The job's check failed (or, never expected, a call threw): no call starts, the error leaves once all ended. */
    const halt: Array<{ error: unknown }> = [];
    const halted = () => phase.stop !== null || halt.length > 0;
    const running = new Set<Promise<void>>();
    const oneEnds = () => Promise.race(running);
    const fitsBeside = () => input.budget.fits(kind === "batch" ? GROUP_DECISIONS_BATCH_RESERVE_TOKENS : 0);
    try {
      starts: for (const [index, group] of groups.entries()) {
        while (running.size >= GROUP_DECISIONS_CONCURRENCY) await oneEnds();
        if (halted()) break;
        const image = await imageOf(index);
        if ("reason" in image) {
          stopAt(index, image);
          break;
        }
        for (;;) {
          while (running.size > 0 && !fitsBeside()) await oneEnds();
          if (halted()) break starts;
          try {
            await input.beforeCall?.();
          } catch (error) {
            halt.push({ error });
            break starts;
          }
          if (halted()) break starts;
          // A call that ended during the check may have raised the reserve: wait again rather than refuse.
          if (running.size === 0 || fitsBeside()) break;
        }
        if (!input.budget.tryStart()) {
          stopAt(index, { reason: "budget_reached", message: "Le plafond de jetons Decisions est atteint : les groupes restants sont à revoir." });
          break;
        }
        const call: Promise<void> = send(kind, group, image).then((entry) => {
          phase.sent[index] = entry;
          if (entry.stop) stopAt(index, entry.stop);
        }, (error: unknown) => {
          halt.push({ error });
        }).finally(() => running.delete(call));
        running.add(call);
      }
    } finally {
      await Promise.all(running);
    }
    if (halt.length > 0) throw halt[0].error;
    return phase;
  };

  /** The calls of a phase in their order: answers before its stop applied, the stop kept. False when it stopped. */
  const apply = (phase: Phase) => {
    for (const [index, entry] of phase.sent.entries()) {
      const after = phase.stop !== null && index > phase.stop.index;
      outcome.calls.push(after ? { ...entry.call, after_stop: true } : entry.call);
      if (!after && entry.answers) for (const [id, answer] of entry.answers) outcome.answers.set(id, answer);
    }
    if (phase.stop) outcome.stop = phase.stop.stop;
    return phase.stop === null;
  };

  const batchImages = sheets.images as GroupImage[];
  if (!apply(await inParallel("batch", batches, async (index) => ({ image: batchImages[index], renderMs: sheets.render_ms[index] ?? null })))) return outcome;
  const needing = candidates.filter((candidate) => outcome.answers.has(candidate.id) && needsDedicated(outcome.answers.get(candidate.id)));
  const again = needing.slice(0, limits.maxDedicatedCalls);
  outcome.dedicated_left_out = needing.length - again.length;
  const chunks = decisionBatches(again, GROUP_DECISIONS_DEDICATED_RENDER_CHUNK);
  // Chunk n + 1 is drawn after chunk n, once the calls reach chunk n: one child at a time, one chunk ahead.
  const renders: Array<Promise<GroupSheetsResult | null>> = [];
  const renderOf = (chunk: number): Promise<GroupSheetsResult | null> => (renders[chunk] ??= (chunk === 0 ? Promise.resolve() : renderOf(chunk - 1))
    .then(() => safely(() => render.sheets(chunks[chunk].map((candidate) => planDedicated(model, candidate))))));
  /** Render times of the chunks the calls reached, by chunk. */
  const reached: number[][] = [];
  const dedicatedImage = async (index: number): Promise<CallImage | GroupDecisionsStop> => {
    const chunk = Math.floor(index / GROUP_DECISIONS_DEDICATED_RENDER_CHUNK);
    const at = index % GROUP_DECISIONS_DEDICATED_RENDER_CHUNK;
    const drawn = await renderOf(chunk);
    if (!drawn || drawn.issue !== null || drawn.images.some((image) => image === null)) return renderStop(drawn?.issue ?? null);
    if (at === 0) {
      reached[chunk] = drawn.render_ms.map((value) => value ?? 0);
      if (chunk + 1 < chunks.length) void renderOf(chunk + 1);
    }
    return { image: drawn.images[at] as GroupImage, renderMs: drawn.render_ms[at] ?? null };
  };
  let dedicated: Phase;
  try {
    dedicated = await inParallel("dedicated", again.map((candidate) => [candidate]), dedicatedImage);
  } finally {
    // No render child outlives the page.
    await Promise.all(renders);
  }
  // The renders of the chunks reached up to the stop, as in a row: never one only calls after the stop reached.
  for (const [chunk, renderMs] of reached.entries()) {
    if (renderMs && (dedicated.stop === null || chunk * GROUP_DECISIONS_DEDICATED_RENDER_CHUNK <= dedicated.stop.index)) outcome.render.sheets_ms.push(...renderMs);
  }
  apply(dedicated);
  return outcome;
}
