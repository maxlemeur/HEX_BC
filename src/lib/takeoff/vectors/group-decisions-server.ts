import "server-only";

import type { ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import { callOpenAiDecisions, type OpenAiDecisionAnswer, type OpenAiDecisionImage, type OpenAiDecisionsResult } from "@/lib/ai/decisions";
import type { DecisionsTokenBudget } from "@/lib/ai/decisions-budget";
import type { CandidateFilterReason } from "@/lib/takeoff/vectors/candidate-filter";
import { DECISIONS_ACCEPTED_MARGIN, type DecisionsAnswer } from "@/lib/takeoff/vectors/classify";
import type { VectorPageExtraction } from "@/lib/takeoff/vectors/extraction";
import {
  decisionBatches,
  decisionsAnswerOf,
  GROUP_DECISIONS_DEVELOPER,
  GROUP_DECISIONS_LIMITS,
  groupQuestions,
  readGroupAnswers,
  selectDecisionCandidates,
  type DecisionsCallKind,
  type GroupAnswer,
} from "@/lib/takeoff/vectors/group-decisions";
import { buildGroupEvidence, pageJson, type CandidateEvidence } from "@/lib/takeoff/vectors/group-evidence";
import { planEvidenceImages } from "@/lib/takeoff/vectors/group-evidence-images";
import {
  startGroupEvidenceRender, type GroupEvidenceImages, type GroupEvidenceSession, type GroupImage,
} from "@/lib/takeoff/vectors/group-evidence-render-server";
import { propagateSameColour, ruleClassOf, type ChainEntry, type RuleSource } from "@/lib/takeoff/vectors/group-rules";
import { buildPageModel } from "@/lib/takeoff/vectors/page-model";
import type { VectorPageReading } from "@/lib/takeoff/vectors/pipeline";

// The classification of one page's vector groups (TI-662 L3c, TI-704 option A
// of 12/11/2026), for the bench, the lab and the takeoff worker
// (worker-server.ts). Per document page:
// - the candidates of the keyword reading (group-decisions.ts) and their
//   evidence (group-evidence.ts), computed once;
// - the rules first (group-rules.ts): same colour, band; their classes need
//   no call and stay whatever happens to the calls;
// - the others asked of Decisions, at most 20 per call and maxBatchCalls
//   calls, each group with its own image, the page's JSON and legend blocks
//   shared; their images drawn once (group-evidence-render-server.ts) before
//   the first call, the page analysed while the evidence is computed (the
//   session is cancelled when no group is asked); answers read at
//   DECISIONS_ACCEPTED_MARGIN;
// - then the propagation of the same colour, over every candidate;
// - the worker gives fewer calls (`limits`): what its document has left; the
//   groups past them stay « à revoir », counted in `left_out`;
// - the calls run GROUP_DECISIONS_CONCURRENCY at a time, started in their
//   order, none further than that from the oldest in flight, the page's
//   first call alone;
// - `beforeCall` runs before each start, one at a time, outside of the call's
//   own failure: the worker renews its lease there, and its failure stops the
//   job: no call starts after it, the calls in flight are waited for, then its
//   error leaves this function, whatever they returned;
// - the token budget reserves each call before it starts and is given its
//   usage after it; while calls are in flight, a start the ceiling cannot hold
//   (each call in flight counted at GROUP_DECISIONS_BATCH_RESERVE_MARGIN times
//   the largest call seen) waits for one of them to end; a refusal with none
//   in flight stops the page (budget_reached), as in a row. The first failed or
//   unavailable result, or an exception before sending, stops it too, never
//   retried;
// - the first stop in call order decides: no call starts once a stop is known,
//   the calls in flight end, the answers of those after the stop are not
//   applied (logged `after_stop`). Answers, their order and the stop are those
//   of the same calls one after the other, whatever order they end in; the
//   call log, its tokens and `calls_ms` keep every call sent;
// - without canvas, or when an image cannot be drawn, no call is sent for the
//   page (canvas_unavailable, render_failed); the rules' classes stay.
// Whatever stops, the groups without an answer stay « à revoir »; the reading
// takes the answers through readVectorPage's `decisions` (decisionsOfOutcome).
// The call log holds counts, statuses, usage and timings: never the evidence,
// the images nor a key.

/** Reserve per call before the first answer (20 groups with their low-detail image: about 27 500 tokens measured). */
export const GROUP_DECISIONS_CALL_ESTIMATE_TOKENS = 30_000;
/**
 * Decisions calls in flight at once for a page (TI-704). A page sends few calls since v2 (20 groups each, the rules
 * deciding first: 2 on the heaviest development page); 8 keeps the parallel start of the pages that send more, within
 * the job's ceiling (each call in flight holds the budget's reserve). The provider's rate limits for this model are not
 * known here: a 429 stays a failed call that stops the job's Decisions, never retried (decisions.ts).
 */
export const GROUP_DECISIONS_CONCURRENCY = 8;
/**
 * A call that starts beside others counts each call in flight at this many times the largest call seen (TI-704). The
 * page's first call, its largest (20 groups when it has more), runs alone: the budget has then seen a call of the page.
 * Calls of one size still differ by their groups' evidence: 25 % leaves room for that.
 */
export const GROUP_DECISIONS_BATCH_RESERVE_MARGIN = 1.25;
/** Legend block images a call shares at most (the adapter's own bound). */
export const GROUP_DECISIONS_LEGEND_IMAGES = 6;
/** A call's deadline: 20 groups and their images weigh a few MB. */
export const GROUP_DECISIONS_CALL_TIMEOUT_MS = 45_000;
/**
 * Base64 bytes of the images of one call at most, the legend's included (under the adapter's 12 MB): a batch whose
 * images pass it is split, the legend images past half of it are not sent. A refused call would stop the job's calls.
 */
export const GROUP_DECISIONS_CALL_IMAGE_BYTES = 10 * 1024 * 1024;

/** The calls of the groups asked: in their order, at most batchSize each, their images and the legend's within `maxBytes`. */
export function callBatches<T>(groups: readonly T[], bytesOf: (group: T) => number, legendBytes: number,
  batchSize: number = GROUP_DECISIONS_LIMITS.batchSize, maxBytes: number = GROUP_DECISIONS_CALL_IMAGE_BYTES): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let bytes = legendBytes;
  for (const group of groups) {
    const size = bytesOf(group);
    if (current.length > 0 && (current.length >= batchSize || bytes + size > maxBytes)) {
      batches.push(current);
      current = [];
      bytes = legendBytes;
    }
    current.push(group);
    bytes += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export type GroupDecisionsDecide = (input: Parameters<typeof callOpenAiDecisions>[0]) => Promise<OpenAiDecisionsResult>;
/** Starts a page's drawing session (group-evidence-render-server.ts startGroupEvidenceRender). */
export type GroupDecisionsRender = (bytes: Uint8Array, page: number) => GroupEvidenceSession;

/** Calls one classification may send: GROUP_DECISIONS_LIMITS by default, what a document has left in the worker. */
export type GroupDecisionsCallLimits = { maxBatchCalls: number };

export type GroupDecisionsStopReason = "budget_reached" | "call_failed" | "decisions_unavailable" | "exception" | "canvas_unavailable" | "render_failed";
export type GroupDecisionsStop = { reason: GroupDecisionsStopReason; message: string };
export type GroupDecisionsCall = {
  kind: "batch";
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
  /** A rule's class: which rule gave it. */
  rule?: RuleSource;
  /** The probabilities Decisions gave with an answered class, from its call (the lab shows them). */
  probabilities?: NonNullable<OpenAiDecisionAnswer["probabilities"]>;
};
export type GroupDecisionsOutcome = {
  /** By group id: every candidate the rules or a call answered. */
  answers: Map<string, GroupDecisionsAnswer>;
  calls: GroupDecisionsCall[];
  stop: GroupDecisionsStop | null;
  candidates: number;
  eligible: number;
  left_out: number;
  /** Groups the selection never asks, by reason (candidate-filter.ts). */
  filtered: Partial<Record<CandidateFilterReason, number>>;
  /** Candidates the rules classed: before any call (same colour, band), then by propagation. */
  ruled: { same_colour: number; band: number; propagated: number };
  render: { page_ms: number | null; legends_ms: number[]; groups_ms: number[]; dropped_images: number };
  /** Time with at least one call in flight: the calls' latencies, those run together counted once; null without a call. */
  calls_ms: number | null;
};

/** Stops that end a series of pages (bench run, worker job): the provider or the ceiling, not a page's render. */
export function isDecisionsRunStop(reason: GroupDecisionsStopReason) {
  return reason === "budget_reached" || reason === "call_failed" || reason === "decisions_unavailable" || reason === "exception";
}

/** The answers the reading applies, by group id: the rules' classes, Decisions' classes and proposals. */
export function decisionsOfOutcome(outcome: Pick<GroupDecisionsOutcome, "answers">): Map<string, DecisionsAnswer> {
  const decisions = new Map<string, DecisionsAnswer>();
  for (const [id, answer] of outcome.answers) {
    const applied = decisionsAnswerOf(answer);
    if (applied) decisions.set(id, applied);
  }
  return decisions;
}

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

/** A call that ended: its log entry, and its answers or the stop it makes. */
type SentCall = { call: GroupDecisionsCall; answers: Map<string, GroupDecisionsAnswer> | null; stop: GroupDecisionsStop | null };
/** The calls that started, by their index, and the first stop in call order. */
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
  const render = input.render ?? ((bytes: Uint8Array, page: number) => startGroupEvidenceRender(bytes, page));
  const clock = input.clock ?? (() => performance.now());
  const maxBatchCalls = input.limits?.maxBatchCalls === undefined ? GROUP_DECISIONS_LIMITS.maxBatchCalls
    : Math.max(0, Math.min(GROUP_DECISIONS_LIMITS.maxBatchCalls, Math.floor(input.limits.maxBatchCalls)));
  const model = buildPageModel(input.extraction);
  const selection = selectDecisionCandidates(model, input.reading);
  const filtered: GroupDecisionsOutcome["filtered"] = {};
  for (const entry of selection.filtered) filtered[entry.reason] = (filtered[entry.reason] ?? 0) + 1;
  const outcome: GroupDecisionsOutcome = {
    answers: new Map(), calls: [], stop: null, candidates: selection.candidates.length, eligible: selection.eligible, left_out: selection.left_out,
    filtered, ruled: { same_colour: 0, band: 0, propagated: 0 }, render: { page_ms: null, legends_ms: [], groups_ms: [], dropped_images: 0 }, calls_ms: null,
  };
  /** Time with at least one call in flight (clock), for calls_ms: neither the renders nor the checks between calls. */
  const busy = { calls: 0, inFlight: 0, since: 0, total: 0 };
  if (selection.candidates.length === 0) return outcome;
  // The page is analysed for its images while its evidence is computed (once the child has the PDF); a session that
  // cannot start is a drawing failure.
  let session: GroupEvidenceSession | null = null;
  try {
    session = maxBatchCalls > 0 ? render(input.bytes, input.extraction.page) : null;
  } catch {
    session = null;
  }
  await session?.ready;
  let evidence: ReturnType<typeof buildGroupEvidence>;
  try {
    evidence = buildGroupEvidence(model, input.reading, selection.candidates, new Set(selection.unclassed));
  } catch (error) {
    session?.cancel();
    throw error;
  }
  const byId = new Map(evidence.candidates.map((candidate) => [candidate.id, candidate]));
  // The rules first: no call for the groups they class.
  const asked: CandidateEvidence[] = [];
  for (const candidate of evidence.candidates) {
    const rule = ruleClassOf(candidate);
    if (!rule) {
      asked.push(candidate);
      continue;
    }
    outcome.ruled[rule.rule] += 1;
    outcome.answers.set(candidate.id, { class: rule.class, confidence: null, status: "answered", proposal: null, alias: candidate.alias, via: "rule", rule: rule.rule });
  }
  const propagate = () => {
    const entries = new Map<string, ChainEntry>();
    for (const [id, answer] of outcome.answers) {
      if (answer.status === "answered") entries.set(id, { class: answer.class, confidence: answer.confidence, source: answer.via === "rule" ? "rule" : "model" });
    }
    const accepted = (entry: ChainEntry) => entry.class !== null && (entry.source === "rule" || (entry.confidence ?? 0) >= DECISIONS_ACCEPTED_MARGIN);
    for (const [id, network] of propagateSameColour(evidence.candidates, entries, accepted)) {
      const candidate = byId.get(id) as CandidateEvidence;
      outcome.ruled.propagated += 1;
      const earlier = outcome.answers.get(id);
      outcome.answers.set(id, { class: network, confidence: null, status: "answered", proposal: null, alias: candidate.alias, via: "rule", rule: "propagated",
        ...(earlier?.probabilities ? { probabilities: earlier.probabilities } : {}) });
    }
  };
  const done = () => {
    propagate();
    if (busy.calls > 0) outcome.calls_ms = Math.max(0, Math.round(busy.total));
    return outcome;
  };
  const sent = decisionBatches(asked).slice(0, maxBatchCalls).flat();
  outcome.left_out += asked.length - sent.length;
  if (sent.length === 0) {
    session?.cancel();
    return done();
  }
  // The images of the groups asked, drawn once for the page before the first call.
  let images: GroupEvidenceImages | null = null;
  try {
    const blocks = evidence.legend_blocks.slice(0, GROUP_DECISIONS_LEGEND_IMAGES);
    images = session ? await session.draw(planEvidenceImages(model, input.extraction.page, blocks, sent)) : null;
  } catch {
    // A plan that cannot be made leaves no drawing behind.
    session?.cancel();
    images = null;
  }
  if (images) {
    outcome.render = { page_ms: images.render_ms.page, legends_ms: images.render_ms.legends.map((value) => value ?? 0),
      groups_ms: images.render_ms.groups.map((value) => value ?? 0), dropped_images: images.dropped_images };
    if (images.dropped_images > 0) input.log?.(`page : ${images.dropped_images} image(s) du PDF absente(s) du rendu (trop lourdes ou illisibles)`);
  }
  if (!images || images.issue !== null || images.legends.some((image) => image === null) || images.groups.some((image) => image === null)) {
    outcome.stop = renderStop(images?.issue ?? null);
    return done();
  }
  const drawn = images;
  // The legend images within half a call's image bytes, in their order.
  let legendBytes = 0;
  const legendImages: OpenAiDecisionImage[] = [];
  for (const image of drawn.legends as GroupImage[]) {
    if (legendBytes + image.data.length > GROUP_DECISIONS_CALL_IMAGE_BYTES / 2) continue;
    legendBytes += image.data.length;
    legendImages.push({ ...asImage(image), detail: "low" });
  }
  const groupImages = new Map(sent.map((candidate, index) => [candidate.alias, asImage(drawn.groups[index] as GroupImage)]));
  const batches = callBatches(sent, (candidate) => groupImages.get(candidate.alias)?.data.length ?? 0, legendBytes);
  const shared = pageJson(evidence, legendImages.length);

  /** One call, started: its log entry, and its answers or the stop it makes. Never throws. */
  const send = async (group: readonly CandidateEvidence[]): Promise<SentCall> => {
    const started = clock();
    busy.calls += 1;
    if (busy.inFlight++ === 0) busy.since = started;
    let result: OpenAiDecisionsResult | null = null;
    let error: string | undefined;
    try {
      result = await decide({
        owner: input.owner, context: input.context, developer: GROUP_DECISIONS_DEVELOPER, timeoutMs: GROUP_DECISIONS_CALL_TIMEOUT_MS,
        evidence: shared, images: legendImages, questions: groupQuestions(evidence, group, groupImages),
      });
    } catch (thrown) {
      error = thrown instanceof Error ? thrown.message.slice(0, 300) : "Demande Decisions refusée avant l’envoi.";
    }
    const usage = result?.provenance.usage ?? null;
    input.budget.finish(usage);
    const status = result?.status ?? "exception";
    const ended = clock();
    if (--busy.inFlight === 0) busy.total += ended - busy.since;
    const call: GroupDecisionsCall = { kind: "batch", questions: group.length, status, usage, latency_ms: Math.max(0, Math.round(ended - started)),
      render_ms: null,
      ...(error !== undefined ? { error } : status === "failed" || status === "unavailable" ? { error: result?.message.slice(0, 300) } : {}) };
    input.log?.(`decisions ${group.length} groupe(s): ${status}${usage ? `, ${usage.total_tokens} jetons` : ""}`);
    if (!result) return { call, answers: null, stop: { reason: "exception", message: error ?? "Demande Decisions refusée avant l’envoi." } };
    if (status === "failed" || status === "unavailable") {
      return { call, answers: null, stop: { reason: status === "failed" ? "call_failed" : "decisions_unavailable", message: result.message } };
    }
    const answers = new Map<string, GroupDecisionsAnswer>();
    for (const [id, answer] of readGroupAnswers(evidence, group, result.answers)) {
      const alias = byId.get(id)?.alias ?? "";
      const probabilities = answer.status === "answered" ? result.answers.find((entry) => entry.name === alias)?.probabilities : undefined;
      answers.set(id, { ...answer, alias, via: "batch", ...(probabilities ? { probabilities } : {}) });
    }
    return { call, answers, stop: null };
  };

  /**
   * The calls, GROUP_DECISIONS_CONCURRENCY at a time, started in their order: each waits for a free slot, room in the
   * budget while calls are in flight (once the first has ended, each counted at the margin), the job's check and the
   * budget's reserve. Ends once every call started has; throws the job check's error then.
   */
  const inParallel = async (groups: readonly (readonly CandidateEvidence[])[]): Promise<Phase> => {
    const phase: Phase = { sent: [], stop: null };
    const stopAt = (index: number, stop: GroupDecisionsStop) => {
      if (phase.stop === null || index < phase.stop.index) phase.stop = { index, stop };
    };
    /** The job's check failed, or (never expected: send does not throw) a call threw: no call starts, the error leaves once all ended. */
    const halt: { check: { error: unknown } | null; call: { error: unknown } | null } = { check: null, call: null };
    const halted = () => phase.stop !== null || halt.check !== null || halt.call !== null;
    /** The calls in flight, with their index. */
    const running = new Map<Promise<void>, number>();
    let ended = 0;
    const oneEnds = () => Promise.race(running.keys());
    /**
     * A call starts at most GROUP_DECISIONS_CONCURRENCY - 1 places after the oldest in flight (so never more than that
     * many in flight): a slow call that then fails leaves at most that many calls sent after it, their answers unused.
     */
    const inWindow = (index: number) => running.size === 0 || index < Math.min(...running.values()) + GROUP_DECISIONS_CONCURRENCY;
    const fitsBeside = () => ended > 0 && input.budget.fits(Math.ceil(GROUP_DECISIONS_BATCH_RESERVE_MARGIN * input.budget.snapshot().largest_call_tokens));
    try {
      starts: for (const [index, group] of groups.entries()) {
        while (!inWindow(index)) await oneEnds();
        if (halted()) break;
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
        const call: Promise<void> = send(group).then((entry) => {
          phase.sent[index] = entry;
          if (entry.stop) stopAt(index, entry.stop);
        }, (error: unknown) => {
          halt.call ??= { error };
        }).finally(() => {
          ended += 1;
          running.delete(call);
        });
        running.set(call, index);
      }
    } finally {
      await Promise.all(running.keys());
    }
    const failure = halt.check ?? halt.call;
    if (failure) throw failure.error;
    return phase;
  };

  const phase = await inParallel(batches);
  for (const [index, entry] of phase.sent.entries()) {
    const after = phase.stop !== null && index > phase.stop.index;
    outcome.calls.push(after ? { ...entry.call, after_stop: true } : entry.call);
    if (!after && entry.answers) for (const [id, answer] of entry.answers) outcome.answers.set(id, answer);
  }
  if (phase.stop) outcome.stop = phase.stop.stop;
  return done();
}
