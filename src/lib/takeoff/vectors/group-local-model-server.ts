import "server-only";

import { getLocalChatGptCredential } from "@/lib/ai/chatgpt-local-auth";
import {
  assertLocalChatGptOverride, callLocalChatGptStructured, LocalChatGptOverrideUnavailableError, type LocalChatGptOverride, type LocalChatGptRawResult,
} from "@/lib/ai/chatgpt-local-inference";
import type { ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import type { ChatGptReasoningEffort } from "@/lib/ai/chatgpt-model-preferences";
import { ChatGptSignInError } from "@/lib/ai/chatgpt-sign-in-errors";
import { StructuredAiError } from "@/lib/ai/structured-ai-diagnostic";
import type { VectorPageExtraction } from "@/lib/takeoff/vectors/extraction";
import { decisionBatches, selectDecisionCandidates } from "@/lib/takeoff/vectors/group-decisions";
import {
  GROUP_DECISIONS_CALL_IMAGE_BYTES, GROUP_DECISIONS_LEGEND_IMAGES, streamedBatches, streamImages, type GroupDecisionsAnswer, type GroupDecisionsCall,
  type GroupDecisionsOutcome, type GroupDecisionsRender, type GroupDecisionsStop,
} from "@/lib/takeoff/vectors/group-decisions-server";
import { buildGroupEvidence, evidenceLayout, type CandidateEvidence } from "@/lib/takeoff/vectors/group-evidence";
import { planEvidenceImages } from "@/lib/takeoff/vectors/group-evidence-images";
import { startGroupEvidenceRender, type GroupEvidenceSession, type GroupImage } from "@/lib/takeoff/vectors/group-evidence-render-server";
import {
  GROUP_LOCAL_MODEL, GROUP_LOCAL_MODEL_LIMITS, groupLocalModelSchema, localModelEntries, localModelPrompt, readLocalModelAnswer, readLocalModelEntries, GROUP_LOCAL_MODEL_PROMPT_VERSION,
  type GroupLocalModelAnswer, type LocalModelEntries,
} from "@/lib/takeoff/vectors/group-local-model";
import { ruleClassOf } from "@/lib/takeoff/vectors/group-rules";
import { buildPageModel } from "@/lib/takeoff/vectors/page-model";
import type { VectorPageReading } from "@/lib/takeoff/vectors/pipeline";

// The local-mode classification of one page's vector groups (TI-704 option
// B): the local ChatGPT plan of the user the job runs for, never a server key.
// - The candidates, their evidence and their images are those of
//   group-decisions-server.ts (drawn once per page, the page analysed while the
//   evidence is computed, by the caller's session or one started here). Every
//   candidate is asked: no rule decides before the model.
// - 8 groups per request (fewer when their images pass a call's bytes),
//   GROUP_LOCAL_MODEL_CONCURRENCY at once, started in their order, each once
//   its own images are drawn (TI-704 latency); `beforeCall` before each start
//   (the job's lease, tenant and creator's membership), the account checked
//   before each request (the profile the job started with).
// - An image that cannot be drawn stops the page at its request: none from it
//   on, the answers before it kept, the rest to the rules (render_failed). A
//   stop, the job check's error or nothing to draw end the drawing here.
// - A request that fails, and a group its answer leaves out or gets wrong, keep
//   their groups for the rules (same colour, band, source « rule »): the
//   measured fallback. A quota or a rate limit, a refused access or a model the
//   account does not offer stops the requests, never retried; the rest falls
//   back to the rules.
// - The plan's tokens are counted, not the Decisions budget's.

/** Requests in flight at once for a page: 3 to 4 per heavy page were measured at about 10 s each. */
export const GROUP_LOCAL_MODEL_CONCURRENCY = 4;

/** One request to the local plan: its words and images, its answer read group by group and its usage. */
export type LocalGroupsCall = (request: { prompt: string; images: GroupImage[] }) => Promise<{ data: LocalModelEntries; totalTokens: number }>;

/** Why a request stops the job's plan: its quota or rate limit, its access, or the measured model not offered. */
export class LocalGroupsStop extends Error {
  constructor(readonly reason: "local_quota" | "local_access" | "local_model_unavailable", message: string) {
    super(message);
  }
}

/** A request whose answer could not be read: its groups follow the rules, the tokens it consumed are kept. */
export class LocalGroupsRequestError extends Error {
  constructor(message: string, readonly totalTokens: number) {
    super(message);
  }
}

/** The profile a job runs with (as level C pins it, chatgpt-takeoff.ts): another account or model selected mid-job stops it. */
export type LocalGroupsSelection = { profileId: string; model: string; reasoningEffort?: ChatGptReasoningEffort | null };

const ACCESS_LOST = "Le forfait ChatGPT n’est plus accessible : reconnectez-le dans Mon profil.";

/** The account before a request: its credential (renewed when due), the profile and model the job started with. */
async function accountOf(owner: ChatGptOwner, selection?: LocalGroupsSelection) {
  let credential: Awaited<ReturnType<typeof getLocalChatGptCredential>> = null;
  for (let attempt = 1; ; attempt += 1) {
    try {
      credential = await getLocalChatGptCredential(owner);
      break;
    } catch (error) {
      // A blip reaching OpenAI while the credential is renewed is read again once; a refused renewal, a plan access
      // withdrawn or an unreadable store is final.
      if (attempt === 1 && error instanceof ChatGptSignInError && error.reason === "network") continue;
      throw new LocalGroupsStop("local_access", ACCESS_LOST);
    }
  }
  if (!credential) throw new LocalGroupsStop("local_access", "Connectez votre forfait ChatGPT dans Mon profil.");
  if (selection && (credential.profileId !== selection.profileId || credential.model !== selection.model
    || (credential.reasoningEffort ?? null) !== (selection.reasoningEffort ?? null))) {
    throw new LocalGroupsStop("local_access", "Le compte ou le modèle ChatGPT a changé pendant le métré.");
  }
  return credential;
}

/** What a failure of the plan means for the job: its quota or rate limit, a refused access; null for a failed request only. */
function planStop(error: unknown): LocalGroupsStop | null {
  if (error instanceof LocalGroupsStop) return error;
  if (error instanceof ChatGptSignInError) return new LocalGroupsStop("local_access", ACCESS_LOST);
  if (!(error instanceof StructuredAiError)) return null;
  if (error.code === "AI_QUOTA" || error.code === "AI_RATE_LIMIT") return new LocalGroupsStop("local_quota", error.message);
  return error.code === "AI_AUTH_REQUIRED" ? new LocalGroupsStop("local_access", error.message) : null;
}

/**
 * The local plan of `owner` with the measured model and effort, checked once (LocalGroupsStop when it cannot start),
 * pinned to `selection` (the job's profile) or else to the profile selected now.
 */
export async function localGroupsCall(owner: ChatGptOwner, selection?: LocalGroupsSelection): Promise<LocalGroupsCall> {
  const credential = await accountOf(owner, selection);
  let override: LocalChatGptOverride | null = null;
  // Read once per job, the listing is read again once after a failure that is no answer of the account (a network
  // blip, an unreadable listing): one blip would otherwise leave the whole job to the rules. The account's answers (the
  // model not offered, a quota, a rate limit, a refused access) are final.
  for (let attempt = 1; override === null; attempt += 1) {
    try {
      override = await assertLocalChatGptOverride(owner, credential, { model: GROUP_LOCAL_MODEL.model, reasoningEffort: GROUP_LOCAL_MODEL.reasoningEffort });
    } catch (error) {
      // Only the account's answer that it lacks the model is a model not offered; any failure of the listing is an access.
      if (error instanceof LocalChatGptOverrideUnavailableError) {
        throw new LocalGroupsStop("local_model_unavailable", `Le modèle ${GROUP_LOCAL_MODEL.model} n’est pas proposé par ce forfait ChatGPT.`);
      }
      const stop = planStop(error);
      if (stop) throw stop;
      if (attempt >= 2) throw new LocalGroupsStop("local_access", "Le forfait ChatGPT n’a pas répondu à la lecture de ses modèles.");
    }
  }
  if (!selection && !credential.model) throw new LocalGroupsStop("local_access", "Choisissez un modèle ChatGPT dans Mon profil.");
  const pinned: LocalGroupsSelection = selection
    ?? { profileId: credential.profileId, model: credential.model as string, reasoningEffort: credential.reasoningEffort ?? null };
  return async ({ prompt, images }) => {
    await accountOf(owner, pinned);
    let result: LocalChatGptRawResult<GroupLocalModelAnswer>;
    try {
      result = await callLocalChatGptStructured(owner, {
        prompt, schema: groupLocalModelSchema, timeoutMs: GROUP_LOCAL_MODEL.timeoutMs,
        files: images.map((image) => ({ mimeType: image.mimeType, data: image.data })),
        context: { promptVersion: GROUP_LOCAL_MODEL_PROMPT_VERSION },
      }, pinned, override, { returnRawOnSchemaError: true });
    } catch (error) {
      throw planStop(error) ?? error;
    }
    if (result.schemaError === null) return { data: localModelEntries(result.data), totalTokens: result.tokenCount };
    // The schema's refusal (a percentage for a probability, a missing field): read group by group, never all lost.
    let entries: LocalModelEntries | null = null;
    if (!(result.schemaError instanceof SyntaxError)) {
      try {
        entries = readLocalModelEntries(JSON.parse(result.rawText));
      } catch {
        entries = null;
      }
    }
    if (!entries) throw new LocalGroupsRequestError("La réponse ChatGPT n’est pas un objet JSON lisible.", result.tokenCount);
    return { data: entries, totalTokens: result.tokenCount };
  };
}

/** Classifies one page's candidate groups through the local plan; never throws but for the job's own check (`beforeCall`). */
export async function classifyVectorGroupsLocal(input: {
  bytes: Uint8Array;
  extraction: VectorPageExtraction;
  /** The keyword reading of the page (readVectorPage without decisions). */
  reading: VectorPageReading;
  /**
   * The local plan's request (localGroupsCall), the stop that kept it from starting, or null for the rules alone (a
   * page after the job's stop: no drawing, no request, no stop of its own).
   */
  call: LocalGroupsCall | LocalGroupsStop | null;
  render?: GroupDecisionsRender;
  /** Requests this page may send (what its document has left, GROUP_LOCAL_MODEL_LIMITS); the page's limit at most. */
  limits?: { maxRequests: number };
  beforeCall?: () => Promise<void>;
  /** The page's drawing started by the caller (the worker, once the extraction ended): drawn with, or cancelled here. */
  session?: GroupEvidenceSession | null;
  clock?: () => number;
  log?: (line: string) => void;
}): Promise<GroupDecisionsOutcome> {
  // The page's drawing: the caller's, or started here; ended here unless drawn to its end (nothing to draw, a stop,
  // the job check's error, an exception).
  let session: GroupEvidenceSession | null = input.session ?? null;
  let feed: ReturnType<typeof streamImages> | null = null;
  try {
    const render = input.render ?? ((bytes: Uint8Array, page: number) => startGroupEvidenceRender(bytes, page));
    const clock = input.clock ?? (() => performance.now());
    const maxRequests = Math.max(0, Math.min(GROUP_LOCAL_MODEL_LIMITS.requestsPerPage, Math.floor(input.limits?.maxRequests ?? Number.POSITIVE_INFINITY)));
    const model = buildPageModel(input.extraction);
    const selection = selectDecisionCandidates(model, input.reading);
    const filtered: GroupDecisionsOutcome["filtered"] = {};
    for (const entry of selection.filtered) filtered[entry.reason] = (filtered[entry.reason] ?? 0) + 1;
    const outcome: GroupDecisionsOutcome = {
      answers: new Map(), calls: [], stop: null, candidates: selection.candidates.length, eligible: selection.eligible, left_out: selection.left_out,
      filtered, ruled: { same_colour: 0, band: 0, propagated: 0 }, render: { page_ms: null, legends_ms: [], groups_ms: [], dropped_images: 0 }, calls_ms: null,
    };
    if (selection.candidates.length === 0) return outcome;
    const callable = typeof input.call === "function" ? input.call : null;
    // The page is analysed for its images while its evidence is computed (once the child has the PDF), as for Decisions.
    if (callable && maxRequests > 0 && !session) {
      try {
        session = render(input.bytes, input.extraction.page);
      } catch {
        session = null;
      }
    }
    if (callable && maxRequests > 0) await session?.ready;
    // Every candidate is asked: the groups drawn are known before their evidence. The plan (legend blocks, each group's
    // focus) leaves first, the rest of the evidence is computed while they are drawn (TI-704 latency).
    const layout = evidenceLayout(model, input.reading, selection.candidates);
    const sent = callable ? decisionBatches(selection.candidates, GROUP_LOCAL_MODEL.groupsPerRequest).slice(0, maxRequests).flat() : [];
    if (session && sent.length > 0) {
      try {
        const blocks = layout.blocks.slice(0, GROUP_DECISIONS_LEGEND_IMAGES);
        feed = streamImages(session, planEvidenceImages(model, input.extraction.page, blocks,
          sent.map((candidate) => ({ alias: candidate.alias, group: candidate.group, focus: layout.focus.get(candidate.group)!.focus }))));
      } catch {
        // A plan that cannot be made: no request, the session cancelled.
        feed = null;
      }
    }
    // The plan reaches the drawing before the evidence holds this event loop (it leaves only while the loop runs).
    if (feed) await session?.sent?.();
    const evidence = buildGroupEvidence(model, input.reading, selection.candidates, new Set(selection.unclassed), layout);
    const askedById = new Map(evidence.candidates.map((candidate) => [candidate.id, candidate]));
    /**
     * The rules' class for the groups no answer reached: the request failed, stopped or was never sent, or its answer
     * left the group out, answered it twice or wrongly (step 7 of option B: the rules as the fallback of a failed call).
     */
    const fallBack = (groups: readonly CandidateEvidence[]) => {
      for (const candidate of groups) {
        if (outcome.answers.get(candidate.id)?.status === "answered") continue;
        const rule = ruleClassOf(candidate);
        if (!rule) continue;
        outcome.ruled[rule.rule] += 1;
        outcome.answers.set(candidate.id, { class: rule.class, confidence: null, status: "answered", proposal: null, alias: candidate.alias, via: "rule", rule: rule.rule });
      }
    };
    const stopWith = (stop: GroupDecisionsStop) => {
      outcome.stop ??= stop;
    };
    if (!callable) {
      if (input.call instanceof LocalGroupsStop) stopWith({ reason: input.call.reason, message: input.call.message } as GroupDecisionsStop);
      fallBack(evidence.candidates);
      return outcome;
    }
    outcome.left_out += evidence.candidates.length - sent.length;
    if (sent.length === 0) {
      fallBack(evidence.candidates);
      return outcome;
    }
    /** The drawing's times, once it has ended (cancelled first when a stop left it running). */
    const recordDrawing = async () => {
      if (!feed) return;
      if (!feed.ended()) session?.cancel();
      const drawn = await feed.done;
      outcome.render = { page_ms: drawn.render_ms.page, legends_ms: drawn.render_ms.legends.map((value) => value ?? 0),
        groups_ms: drawn.render_ms.groups.map((value) => value ?? 0), dropped_images: drawn.dropped_images };
    };
    const renderFailure = (): GroupDecisionsStop => ({ reason: feed?.ended()?.issue === "canvas_unavailable" ? "canvas_unavailable" : "render_failed",
      message: "Les images des groupes n’ont pas pu être dessinées : les groupes suivent les règles ou restent à revoir." });
    const legends = feed ? await feed.legends() : null;
    if (!feed || !legends) {
      stopWith(renderFailure());
      await recordDrawing();
      fallBack(evidence.candidates);
      return outcome;
    }
    const images = feed;
    // The legend images within half a request's image bytes, in their order; then the requests within those bytes, as
    // their images are drawn.
    let legendBytes = 0;
    const legendImages: GroupImage[] = [];
    for (const image of legends) {
      if (legendBytes + image.data.length > GROUP_DECISIONS_CALL_IMAGE_BYTES / 2) continue;
      legendBytes += image.data.length;
      legendImages.push(image);
    }
    const imageOf = new Map<string, GroupImage>();
    const batches = streamedBatches(sent, (index) => images.group(index), legendBytes, GROUP_LOCAL_MODEL.groupsPerRequest);
    const stopDrawing = () => {
      if (!images.ended()) session?.cancel();
    };
    const busy = { inFlight: 0, since: 0, total: 0, calls: 0 };
    /** One request: its log entry, its answers, or the stop it makes; throws only the job check's error. */
    const send = async (groups: readonly CandidateEvidence[]) => {
      const started = clock();
      busy.calls += 1;
      if (busy.inFlight++ === 0) busy.since = started;
      let entry: GroupDecisionsCall;
      let answers: Map<string, GroupDecisionsAnswer> | null = null;
      let stop: GroupDecisionsStop | null = null;
      try {
        const result = await callable({ prompt: localModelPrompt(evidence, groups, legendImages.length),
          images: [...legendImages, ...groups.map((group) => imageOf.get(group.alias) as GroupImage)] });
        answers = new Map();
        for (const [id, read] of readLocalModelAnswer(evidence, groups, result.data)) {
          const alias = groups.find((group) => group.id === id)?.alias ?? "";
          answers.set(id, { class: read.class, confidence: read.confidence, status: read.status, proposal: read.proposal, alias, via: "local" });
        }
        entry = { kind: "batch", questions: groups.length, status: "available", usage: { input_tokens: 0, output_tokens: 0, total_tokens: result.totalTokens },
          latency_ms: 0, render_ms: null };
      } catch (error) {
        const reason = error instanceof LocalGroupsStop ? error.reason : null;
        if (reason) stop = { reason, message: (error as Error).message } as GroupDecisionsStop;
        // An answer that could not be read still consumed the plan's tokens.
        const tokens = error instanceof LocalGroupsRequestError ? error.totalTokens : null;
        entry = { kind: "batch", questions: groups.length, status: "failed", usage: tokens === null ? null : { input_tokens: 0, output_tokens: 0, total_tokens: tokens },
          latency_ms: 0, render_ms: null, error: (error instanceof Error ? error.message : "Demande ChatGPT échouée.").slice(0, 300) };
      }
      const ended = clock();
      if (--busy.inFlight === 0) busy.total += ended - busy.since;
      entry.latency_ms = Math.max(0, Math.round(ended - started));
      input.log?.(`chatgpt local ${groups.length} groupe(s): ${entry.status}${entry.usage ? `, ${entry.usage.total_tokens} jetons` : ""}`);
      return { entry, answers, stop };
    };
    const results: Array<Awaited<ReturnType<typeof send>> | undefined> = [];
    // Started in their order, each once its images are drawn, the job's check one at a time before each start,
    // GROUP_LOCAL_MODEL_CONCURRENCY in flight at most, maxRequests in all.
    const running = new Set<Promise<void>>();
    let halted = false;
    let capped = false;
    let drawingFailed = false;
    let checkError: { error: unknown } | null = null;
    try {
      for (let index = 0; ; index += 1) {
        if (index >= maxRequests) {
          capped = true;
          break;
        }
        const formed = await batches.next();
        if (halted || formed === null) break;
        if (formed === "failed") {
          drawingFailed = true;
          break;
        }
        const groups = formed.map((entry) => askedById.get(entry.group.id) as CandidateEvidence);
        for (const entry of formed) imageOf.set(entry.group.alias, entry.image);
        while (running.size >= GROUP_LOCAL_MODEL_CONCURRENCY) await Promise.race(running);
        if (halted) break;
        try {
          await input.beforeCall?.();
        } catch (error) {
          checkError = { error };
          break;
        }
        if (halted) break;
        const pending: Promise<void> = send(groups).then((result) => {
          results[index] = result;
          if (result.stop) {
            halted = true;
            stopDrawing();
          }
        }).finally(() => {
          running.delete(pending);
        });
        running.add(pending);
      }
    } finally {
      if (checkError) stopDrawing();
      await Promise.all(running);
    }
    if (checkError) throw (checkError as { error: unknown }).error;
    if (capped) outcome.left_out += sent.length - batches.taken();
    await recordDrawing();
    for (const [index, result] of results.entries()) {
      if (!result) continue;
      outcome.calls.push(result.entry);
      if (result.answers) for (const [id, answer] of result.answers) outcome.answers.set(id, answer);
      if (result.stop) stopWith(result.stop);
      else if (result.entry.status === "failed") input.log?.(`chatgpt local : demande ${index + 1} en échec, ses groupes suivent les règles`);
    }
    // A drawing that failed after the requests before it: they keep their answers, the rest follows the rules.
    if (drawingFailed && !halted) stopWith(renderFailure());
    if (busy.calls > 0) outcome.calls_ms = Math.max(0, Math.round(busy.total));
    // The groups a failed, stopped or unsent request leaves, or its answer: the rules' class, the measured fallback.
    fallBack(evidence.candidates);
    return outcome;
  } finally {
    if (session && !feed?.ended()) session.cancel();
  }
}
