import "server-only";

import { createHash } from "node:crypto";

import type { ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import { callOpenAiDecisions, OPENAI_DECISIONS_MODEL, type OpenAiDecisionAnswer, type OpenAiDecisionsResult } from "@/lib/ai/decisions";
import type { DecisionsTokenBudget } from "@/lib/ai/decisions-budget";
import { renderPdfPages, type PdfRenderedPage, type PdfRenderLimits } from "@/lib/pdf/page-render-server";
import {
  buildTakeoffPageTriageQuestions,
  decideTakeoffPageTriage,
  extractTakeoffLevelZoneCandidates,
  TAKEOFF_PAGE_TRIAGE_UNKNOWN,
  TAKEOFF_PAGE_TYPES,
  type TakeoffPageTriage,
  type TakeoffPageTriageCallStatus,
  type TakeoffPageTriagePage,
  type TakeoffPageTriageReviewReason,
} from "@/lib/takeoff/page-triage";

/** Version of the questions and evidence sent per page; bump on any change. */
export const TAKEOFF_PAGE_TRIAGE_PROMPT_VERSION = "takeoff-page-triage-v1";
/** One Decisions call per page, at most this many in flight. */
export const TAKEOFF_PAGE_TRIAGE_CONCURRENCY = 4;
/** Product token ceiling of one triage (one document). */
export const TAKEOFF_PAGE_TRIAGE_MAX_TOKENS = 200_000;
/** Reserve per call before the first answer (thumbnail + 12 000 characters). */
export const TAKEOFF_PAGE_TRIAGE_CALL_ESTIMATE_TOKENS = 8_000;
/** No new call starts after this delay from the start of a triage (server action limit 300 s). */
export const TAKEOFF_PAGE_TRIAGE_DEADLINE_MS = 200_000;
/** Above this page count the triage is refused; the manual selection stays available. */
export const TAKEOFF_PAGE_TRIAGE_MAX_PAGES = 60;

/**
 * Page reader bounds for plans, calibrated on the heaviest dataset files
 * (25 MB A0, 81 716 paths on one page): 5-6 s and 1.4 GB RSS per page with a
 * 384 MB heap, which fails at the historical 192 MB. Kept at 2× heap, ~3× time.
 * Embedded rasters above 8 MP stay skipped (a 12-20 MP scan needs 2.7 GB);
 * the blank thumbnail is then flagged and the page stays « À vérifier ».
 */
export function takeoffPageTriageRenderLimits(pageCount: number): PdfRenderLimits {
  return {
    maxInputBytes: 50 * 1024 * 1024,
    maxPages: TAKEOFF_PAGE_TRIAGE_MAX_PAGES,
    timeoutMs: Math.min(120_000, 20_000 + 10_000 * Math.max(1, pageCount)),
    maxHeapMb: 768,
    maxEmbeddedImagePixels: 8_000_000,
  };
}

export const TAKEOFF_PAGE_TRIAGE_THUMBNAIL = { maxEdgePx: 1200, jpegQualities: [75, 60, 45], maxBytes: 1_500_000 } as const;
export const TAKEOFF_PAGE_TRIAGE_TEXT = { maxTextCharsPerPage: 12_000, maxTextItemsPerPage: 200_000 } as const;

export type TakeoffPageTriageDecide = (input: Parameters<typeof callOpenAiDecisions>[0]) => Promise<OpenAiDecisionsResult>;

type AnswerRecord = { status: OpenAiDecisionAnswer["status"]; value: OpenAiDecisionAnswer["value"]; confidence: number | null } | null;

export type TakeoffPageTriageCall = {
  page: number;
  status: "cached" | TakeoffPageTriageCallStatus | "skipped";
  duration_ms: number | null;
  render_ms: number | null;
  usage: { input_tokens: number; output_tokens: number; total_tokens: number } | null;
  request_fingerprint: string | null;
  answers: { type: AnswerRecord; level: AnswerRecord; zone: AnswerRecord };
  proposal: TakeoffPageTriagePage["proposal"];
  reason: TakeoffPageTriageReviewReason | null;
  thumbnail: { width: number; height: number; bytes: number; blank: boolean } | null;
  text_chars: number;
  message: string | null;
};

export type TakeoffPageTriageStop = {
  reason: "call_failed" | "budget_reached" | "time_limit" | "render_failed" | "page_limit" | "page_count_mismatch";
  message: string;
};

export type TakeoffPageTriageRun = {
  /** `usage` accumulates the tokens of the previous triage it continues; `run_usage` is this run's. */
  triage: TakeoffPageTriage | null;
  run_usage: { input_tokens: number; output_tokens: number; total_tokens: number };
  calls: TakeoffPageTriageCall[];
  render: { status: "complete" | "partial" | "failed"; page_count: number | null; duration_ms: number; timed_out: boolean; canvas_available: boolean };
  stop: TakeoffPageTriageStop | null;
};

const NOT_CACHEABLE: ReadonlySet<TakeoffPageTriageReviewReason> = new Set(["call_failed", "unavailable", "exception", "budget_reached", "time_limit", "stopped", "render_failed"]);
const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

function record(answer: OpenAiDecisionAnswer | undefined): AnswerRecord {
  return answer ? { status: answer.status, value: answer.value, confidence: answer.confidence } : null;
}

function token(answer: OpenAiDecisionAnswer | undefined) {
  return answer?.status === "answered" && typeof answer.value === "string" && answer.value !== TAKEOFF_PAGE_TRIAGE_UNKNOWN ? answer.value : null;
}

/**
 * Triage every page of one PDF: render text and thumbnail, one Decisions call
 * per page (bounded concurrency and token ceiling), reuse unchanged pages, and
 * stop starting calls after the first failed one. Never throws for a provider
 * or limit error; pages that could not be decided stay « À vérifier ».
 */
export async function runTakeoffPageTriage(input: {
  owner: ChatGptOwner;
  projectId: string;
  bytes: Uint8Array;
  fileName: string;
  sourceVersion: string;
  scope: { levels: string[]; zones: string[] };
  previous: TakeoffPageTriage | null;
  budget: DecisionsTokenBudget;
  concurrency?: number;
  stopOnFailure?: boolean;
  maxPages?: number;
  pageCountHint?: number | null;
  /** Page count the preparation already stores: a different read is refused before any call. */
  expectedPageCount?: number | null;
  /** Wall-clock limit from the start; the bench passes Infinity. */
  deadlineMs?: number;
  onProgress?: (event: { done: number; total: number; page: number; status: TakeoffPageTriageCall["status"] }) => void;
  decide?: TakeoffPageTriageDecide;
}): Promise<TakeoffPageTriageRun> {
  const decide = input.decide ?? callOpenAiDecisions;
  const startedAt = performance.now();
  const deadlineMs = input.deadlineMs ?? TAKEOFF_PAGE_TRIAGE_DEADLINE_MS;
  const maxPages = Math.min(input.maxPages ?? TAKEOFF_PAGE_TRIAGE_MAX_PAGES, TAKEOFF_PAGE_TRIAGE_MAX_PAGES);
  const requested = Array.from({ length: maxPages }, (_, index) => index + 1);
  const rendered = await renderPdfPages(input.bytes, {
    pages: requested,
    ...TAKEOFF_PAGE_TRIAGE_TEXT,
    textItemOverflow: "truncate",
    image: { mode: "each", ...TAKEOFF_PAGE_TRIAGE_THUMBNAIL, jpegQualities: [...TAKEOFF_PAGE_TRIAGE_THUMBNAIL.jpegQualities] },
    limits: { ...takeoffPageTriageRenderLimits(input.pageCountHint ?? maxPages), maxPages },
    maxDocumentPages: maxPages,
  });
  const render: TakeoffPageTriageRun["render"] = {
    status: rendered.status, page_count: rendered.pageCount, duration_ms: rendered.durationMs,
    timed_out: rendered.timedOut, canvas_available: rendered.canvasAvailable,
  };
  const noRun = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  if (rendered.pageCount !== null && rendered.pageCount > maxPages) {
    return { triage: null, run_usage: noRun, calls: [], render, stop: { reason: "page_limit", message: `Ce document compte ${rendered.pageCount} pages : le tri automatique est limité à ${maxPages} pages. Sélectionnez les pages manuellement.` } };
  }
  if (rendered.pageCount === null || !rendered.pages.length) {
    return { triage: null, run_usage: noRun, calls: [], render, stop: { reason: "render_failed", message: "Le PDF n’a pas pu être lu pour le tri. La sélection manuelle des pages reste disponible." } };
  }
  if (input.expectedPageCount != null && rendered.pageCount !== input.expectedPageCount) {
    return { triage: null, run_usage: noRun, calls: [], render, stop: { reason: "page_count_mismatch",
      message: `Le PDF lu compte ${rendered.pageCount} pages, le dossier en indique ${input.expectedPageCount} : vérifiez le fichier. La sélection manuelle des pages reste disponible.` } };
  }
  const pageCount = rendered.pageCount;
  const scope = { levels: input.scope.levels.slice(0, 200), zones: input.scope.zones.slice(0, 200) };
  const scopeCandidates = extractTakeoffLevelZoneCandidates("", scope);
  const questionsFingerprint = sha256(JSON.stringify({
    prompt: TAKEOFF_PAGE_TRIAGE_PROMPT_VERSION, model: OPENAI_DECISIONS_MODEL, types: TAKEOFF_PAGE_TYPES, scope: scopeCandidates,
  }));
  const previous = input.previous?.source_version === input.sourceVersion && input.previous.page_count === pageCount ? input.previous : null;
  const byPage = new Map<number, PdfRenderedPage>(rendered.pages.map((page) => [page.page, page]));
  const calls = new Map<number, TakeoffPageTriageCall>();
  const entries = new Map<number, TakeoffPageTriagePage>();
  const usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  let stop: TakeoffPageTriageStop | null = null;
  let done = 0;
  const progress = (page: number, status: TakeoffPageTriageCall["status"]) => {
    done += 1;
    input.onProgress?.({ done, total: pageCount, page, status });
  };
  const empty = { type: null, level: null, zone: null };
  // A correction stays « Corrigée » even when its page is asked again: a later acceptance keeps the user's choice.
  const corrected = new Set(previous?.pages.filter((entry) => entry.status === "corrected").map((entry) => entry.page) ?? []);
  const settle = (page: number, call: Omit<TakeoffPageTriageCall, "page">, entry: Omit<TakeoffPageTriagePage, "page" | "status"> & { status?: TakeoffPageTriagePage["status"] }) => {
    calls.set(page, { page, ...call });
    entries.set(page, { page, ...entry, status: entry.status ?? (corrected.has(page) ? "corrected" : entry.proposal === "review" ? "to_review" : "proposed") });
    progress(page, call.status);
  };
  const review = (reason: TakeoffPageTriageReviewReason) => ({ request_fingerprint: null, type: null, level: null, zone: null, confidence: null, proposal: "review" as const, reason });

  const queue: Array<{ page: number; rendered: PdfRenderedPage; fingerprint: string }> = [];
  for (let page = 1; page <= pageCount; page += 1) {
    const current = byPage.get(page);
    if (!current || current.failed) {
      settle(page, { status: "skipped", duration_ms: null, render_ms: current?.renderMs ?? null, usage: null, request_fingerprint: null, answers: empty, proposal: "review", reason: "render_failed", thumbnail: null, text_chars: 0, message: !current && rendered.timedOut ? "Lecture de la page limitée dans le temps." : "Page illisible." }, review("render_failed"));
      continue;
    }
    const image = current.image && !current.image.blank ? current.image : null;
    const questions = buildTakeoffPageTriageQuestions(extractTakeoffLevelZoneCandidates(current.text, scope));
    const fingerprint = sha256(JSON.stringify({
      prompt: TAKEOFF_PAGE_TRIAGE_PROMPT_VERSION, model: OPENAI_DECISIONS_MODEL, source: input.sourceVersion, page, file: input.fileName,
      questions, text: sha256(current.text), image: image ? sha256(image.data) : null,
    }));
    const cached = previous?.pages.find((entry) => entry.page === page);
    if (cached && cached.request_fingerprint === fingerprint && !(cached.reason && NOT_CACHEABLE.has(cached.reason))) {
      settle(page, { status: "cached", duration_ms: null, render_ms: current.renderMs, usage: null, request_fingerprint: fingerprint, answers: empty, proposal: cached.proposal, reason: cached.reason, thumbnail: null, text_chars: current.text.length, message: null }, cached);
      continue;
    }
    queue.push({ page, rendered: current, fingerprint });
  }

  const thumbnailOf = (page: PdfRenderedPage) => page.image ? { width: page.image.width, height: page.image.height, bytes: page.image.bytes, blank: page.image.blank } : null;
  const work = async (job: (typeof queue)[number]) => {
    const { page, rendered: current, fingerprint } = job;
    const thumbnail = thumbnailOf(current);
    const image = current.image && !current.image.blank ? current.image : null;
    const base = { render_ms: current.renderMs, request_fingerprint: fingerprint, thumbnail, text_chars: current.text.length };
    if (!stop && performance.now() - startedAt > deadlineMs) {
      stop = { reason: "time_limit", message: "La durée maximale du tri est atteinte : les pages restantes sont à vérifier." };
    }
    if (stop) {
      const reason = stop.reason === "budget_reached" || stop.reason === "time_limit" ? stop.reason : "stopped";
      settle(page, { ...base, status: "skipped", duration_ms: null, usage: null, answers: empty, proposal: "review", reason, message: null }, { ...review(reason), request_fingerprint: fingerprint });
      return;
    }
    if (!input.budget.tryStart()) {
      stop ??= { reason: "budget_reached", message: "Le plafond de jetons du tri est atteint : les pages restantes sont à vérifier." };
      settle(page, { ...base, status: "skipped", duration_ms: null, usage: null, answers: empty, proposal: "review", reason: "budget_reached", message: null }, { ...review("budget_reached"), request_fingerprint: fingerprint });
      return;
    }
    const questions = buildTakeoffPageTriageQuestions(extractTakeoffLevelZoneCandidates(current.text, scope));
    const started = performance.now();
    let result: OpenAiDecisionsResult | null = null;
    let status: TakeoffPageTriageCallStatus;
    let message: string | null = null;
    try {
      result = await decide({
        owner: input.owner,
        context: { tenantId: input.owner.tenantId, projectId: input.projectId, preparationFingerprint: sha256(`${input.sourceVersion}:${TAKEOFF_PAGE_TRIAGE_PROMPT_VERSION}`) },
        evidence: {
          task: "takeoff_page_triage",
          prompt_version: TAKEOFF_PAGE_TRIAGE_PROMPT_VERSION,
          document: { file_name: input.fileName, page, page_count: pageCount },
          page: page,
          page_text: current.text,
          page_text_truncated: current.textTruncated,
          thumbnail: Boolean(image),
        },
        images: image ? [{ mimeType: image.mimeType, data: image.data }] : [],
        questions,
      });
      status = result.status;
      message = result.message;
    } catch (error) {
      status = "exception";
      message = error instanceof Error ? error.message.slice(0, 300) : "Demande Decisions refusée avant l’envoi.";
    }
    const callUsage = result?.provenance.usage ?? null;
    input.budget.finish(callUsage);
    if (callUsage) {
      usage.input_tokens += callUsage.input_tokens;
      usage.output_tokens += callUsage.output_tokens;
      usage.total_tokens += callUsage.total_tokens;
    }
    if ((status === "failed" || status === "unavailable") && (input.stopOnFailure ?? true)) {
      stop ??= { reason: "call_failed", message: message ?? "La demande Decisions a échoué." };
    }
    const answers = result?.answers ?? [];
    const typeAnswer = answers.find((entry) => entry.name === "page_type");
    const decision = decideTakeoffPageTriage({ callStatus: status, thumbnail: Boolean(image), type: typeAnswer ?? null });
    const type = typeAnswer?.status === "answered" && (TAKEOFF_PAGE_TYPES as readonly unknown[]).includes(typeAnswer.value) ? typeAnswer.value as TakeoffPageTriagePage["type"] : null;
    const levelAnswer = answers.find((entry) => entry.name === "page_level");
    const zoneAnswer = answers.find((entry) => entry.name === "page_zone");
    settle(page, {
      ...base, status, duration_ms: Math.round(performance.now() - started), usage: callUsage,
      answers: { type: record(typeAnswer), level: record(levelAnswer), zone: record(zoneAnswer) },
      proposal: decision.proposal, reason: decision.reason, message,
    }, {
      request_fingerprint: fingerprint, type, level: token(levelAnswer), zone: token(zoneAnswer),
      confidence: typeAnswer?.status === "answered" ? typeAnswer.confidence : null, proposal: decision.proposal, reason: decision.reason,
    });
  };
  const workers = Math.max(1, Math.min(input.concurrency ?? TAKEOFF_PAGE_TRIAGE_CONCURRENCY, TAKEOFF_PAGE_TRIAGE_CONCURRENCY, queue.length || 1));
  let next = 0;
  await Promise.all(Array.from({ length: workers }, async () => {
    while (next < queue.length) await work(queue[next++]);
  }));

  const pages = Array.from({ length: pageCount }, (_, index) => entries.get(index + 1)!);
  const allCached = [...calls.values()].every((call) => call.status === "cached");
  const cumulative = previous ? {
    input_tokens: previous.usage.input_tokens + usage.input_tokens,
    output_tokens: previous.usage.output_tokens + usage.output_tokens,
    total_tokens: previous.usage.total_tokens + usage.total_tokens,
  } : usage;
  return {
    triage: {
      source_version: input.sourceVersion, page_count: pageCount, questions_fingerprint: questionsFingerprint,
      model: OPENAI_DECISIONS_MODEL, prompt_version: TAKEOFF_PAGE_TRIAGE_PROMPT_VERSION, usage: cumulative,
      generated_at: new Date().toISOString(), accepted: Boolean(previous?.accepted && allCached), pages,
    },
    run_usage: usage,
    calls: Array.from({ length: pageCount }, (_, index) => calls.get(index + 1)!),
    render,
    stop,
  };
}
