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
//   started in their order, the page's first batch call alone, the dedicated
//   ones once every batch call has ended; the dedicated renders are drawn by
//   chunks, one child process at a time, the next chunk once the first call
//   of the current one has started, and no longer held once its calls have
//   their images;
// - `beforeCall` runs before each start, one at a time, outside of the call's
//   own failure: the worker renews its lease there, and its failure stops the
//   job: no call starts after it, the calls in flight are waited for, then its
//   error leaves this function, whatever they returned;
// - the token budget reserves each call before it starts and is given its
//   usage after it; while calls are in flight, a start the ceiling cannot hold
//   (a batch call counting each at GROUP_DECISIONS_BATCH_RESERVE_MARGIN times
//   the largest call seen) waits for one of them to end; a refusal with none
//   in flight stops the page (budget_reached), as in a row. The first failed or
//   unavailable result, or an exception before sending, stops it too, never
//   retried;
// - the first stop in call order decides: no call starts once a stop is known,
//   the calls in flight end, the answers of those after the stop are not
//   applied (logged `after_stop`). Answers, their order and the stop are those
//   of the same calls one after the other, whatever order they end in; the
//   call log, its tokens and `calls_ms` keep every call sent, so after a stop
//   they count the calls that were in flight then;
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
 * 50 dedicated) in 38.6 s, one after the other at 0.5 to 1.9 s each. Replayed with those latencies (measured one call
 * at a time; 8 in flight may lengthen them), its calls end in 7.8 s at 8, 11.1 s at 4 and 6.9 s at 10; at 8 the page
 * may meet TI-662's 15 s, at 4 it cannot. 8 keeps:
 * - the dedicated images in memory within the chunk being sent, the chunk drawn ahead and the calls in flight
 *   (8 ≤ GROUP_DECISIONS_DEDICATED_RENDER_CHUNK), one render child at a time, its heap unchanged;
 * - the job ceiling's say: each call in flight holds the budget's reserve, the largest call seen (about 33 000 tokens
 *   after a full batch call), so under TAKEOFF_VECTOR_DECISIONS_MAX_TOKENS fewer run at once as the job spends.
 * The provider's rate limits for this model are not known here. On the dedicated calls (3 to 4 000 tokens each), 8
 * in flight send about 11 calls and 40 000 tokens per second, 8 times the rate of the 5/11 run, which sent its calls
 * in a row and met no 429. A 429 stays a failed call that stops the job's Decisions, never retried (decisions.ts).
 * The bench records this value (rules.vector.decisions): the first real pass checks its calls for a 429 before the
 * worker relies on it, and lowers it if one comes.
 */
export const GROUP_DECISIONS_CONCURRENCY = 8;
/**
 * A batch call that starts beside others counts each call in flight at this many times the largest call seen (TI-704).
 * The page's first batch call, its largest (36 groups when it has more), runs alone: the budget has then seen a batch
 * call of the page, and not only the estimate or an earlier page's smaller calls (a 36-group call cost 32 700 tokens
 * on 5/11, the estimate is 20 000). Batch calls of one size still differ by their labels and layer names: 25 % leaves
 * room for that. While no batch call costs more than this, batch calls started together spend and stop exactly as in a
 * row. A dedicated call (2 to 4 000 tokens) needs no margin: the budget never reserves less than
 * GROUP_DECISIONS_CALL_ESTIMATE_TOKENS.
 */
export const GROUP_DECISIONS_BATCH_RESERVE_MARGIN = 1.25;

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
  /** From the first call's start to the last call's end (the calls run together: not the sum of their latencies); null without a call. */
  calls_ms: number | null;
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
    dedicated_left_out: 0, render: { legend_ms: null, sheets_ms: [] }, calls_ms: null,
  };
  /** When the calls started and last ended (clock), for calls_ms. */
  const span = { first: null as number | null, last: 0 };
  const done = () => {
    if (span.first !== null) outcome.calls_ms = Math.max(0, Math.round(span.last - span.first));
    return outcome;
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
    span.first ??= started;
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
    const ended = clock();
    span.last = Math.max(span.last, ended);
    const call: GroupDecisionsCall = { kind, questions: group.length, status, usage, latency_ms: Math.max(0, Math.round(ended - started)),
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
   * slot, its image (`imageOf`: a render failure stops there), room in the budget while calls are in flight (a batch
   * call: once the first has ended, each counted at the margin), the job's check and the budget's reserve; `started`
   * runs as it starts. Ends once every call started has; throws the job check's error then.
   */
  const inParallel = async (kind: DecisionsCallKind, groups: readonly (readonly DecisionCandidate[])[],
    imageOf: (index: number) => Promise<CallImage | GroupDecisionsStop>, started?: (index: number) => void): Promise<Phase> => {
    const phase: Phase = { sent: [], stop: null };
    const stopAt = (index: number, stop: GroupDecisionsStop) => {
      if (phase.stop === null || index < phase.stop.index) phase.stop = { index, stop };
    };
    /** The job's check failed, or (never expected: send does not throw) a call threw: no call starts, the error leaves once all ended. */
    const halt: { check: { error: unknown } | null; call: { error: unknown } | null } = { check: null, call: null };
    const halted = () => phase.stop !== null || halt.check !== null || halt.call !== null;
    const running = new Set<Promise<void>>();
    let ended = 0;
    const oneEnds = () => Promise.race(running);
    const fitsBeside = () => (kind === "dedicated" ? input.budget.fits()
      : ended > 0 && input.budget.fits(Math.ceil(GROUP_DECISIONS_BATCH_RESERVE_MARGIN * input.budget.snapshot().largest_call_tokens)));
    try {
      starts: for (const [index, group] of groups.entries()) {
        while (running.size >= GROUP_DECISIONS_CONCURRENCY) await oneEnds();
        if (halted()) break;
        const image = await imageOf(index);
        if ("reason" in image) {
          stopAt(index, image);
          break;
        }
        // The check may run again for one start: a call that ended during it may have raised the reserve.
        for (;;) {
          while (running.size > 0 && !fitsBeside()) await oneEnds();
          if (halted()) break starts;
          try {
            await input.beforeCall?.();
          } catch (error) {
            halt.check = { error };
            break starts;
          }
          if (halted()) break starts;
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
          halt.call ??= { error };
        }).finally(() => {
          ended += 1;
          running.delete(call);
        });
        running.add(call);
        started?.(index);
      }
    } finally {
      await Promise.all(running);
    }
    const failure = halt.check ?? halt.call;
    if (failure) throw failure.error;
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
  if (!apply(await inParallel("batch", batches, async (index) => ({ image: batchImages[index], renderMs: sheets.render_ms[index] ?? null })))) return done();
  const needing = candidates.filter((candidate) => outcome.answers.has(candidate.id) && needsDedicated(outcome.answers.get(candidate.id)));
  const again = needing.slice(0, limits.maxDedicatedCalls);
  outcome.dedicated_left_out = needing.length - again.length;
  const chunks = decisionBatches(again, GROUP_DECISIONS_DEDICATED_RENDER_CHUNK);
  // One render child at a time: each chunk is drawn after the one before. `drawing` ends with the last one started and
  // holds no image; a chunk's images are dropped once its last call has taken its own.
  let drawing: Promise<unknown> = Promise.resolve();
  const drawn = new Map<number, Promise<GroupSheetsResult | null>>();
  const draw = (chunk: number) => {
    let result = drawn.get(chunk);
    if (!result) {
      result = drawing.then(() => safely(() => render.sheets(chunks[chunk].map((candidate) => planDedicated(model, candidate)))));
      drawing = result.then(() => undefined);
      drawn.set(chunk, result);
    }
    return result;
  };
  /** Render times of the chunks the calls reached, by chunk. */
  const reached: number[][] = [];
  const dedicatedImage = async (index: number): Promise<CallImage | GroupDecisionsStop> => {
    const chunk = Math.floor(index / GROUP_DECISIONS_DEDICATED_RENDER_CHUNK);
    const at = index % GROUP_DECISIONS_DEDICATED_RENDER_CHUNK;
    const result = await draw(chunk);
    if (!result || result.issue !== null || result.images.some((image) => image === null)) return renderStop(result?.issue ?? null);
    if (at === 0) reached[chunk] = result.render_ms.map((value) => value ?? 0);
    // Only the calls of a later chunk ask for one again, never this one's.
    if (at === chunks[chunk].length - 1) drawn.delete(chunk);
    return { image: result.images[at] as GroupImage, renderMs: result.render_ms[at] ?? null };
  };
  // The next chunk is drawn once the first call of this one has started: never after a stop, one chunk ahead.
  const drawAhead = (index: number) => {
    const chunk = index / GROUP_DECISIONS_DEDICATED_RENDER_CHUNK;
    if (Number.isInteger(chunk) && chunk + 1 < chunks.length) void draw(chunk + 1);
  };
  let dedicated: Phase;
  try {
    dedicated = await inParallel("dedicated", again.map((candidate) => [candidate]), dedicatedImage, drawAhead);
  } finally {
    // No render child outlives the page.
    await drawing;
  }
  // The renders of the chunks reached up to the stop, as in a row: never one only calls after the stop reached.
  for (const [chunk, renderMs] of reached.entries()) {
    if (renderMs && (dedicated.stop === null || chunk * GROUP_DECISIONS_DEDICATED_RENDER_CHUNK <= dedicated.stop.index)) outcome.render.sheets_ms.push(...renderMs);
  }
  apply(dedicated);
  return done();
}
