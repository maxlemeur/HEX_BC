import "server-only";

import { createHash } from "node:crypto";

import type { ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import { createDecisionsTokenBudget, type DecisionsTokenBudget } from "@/lib/ai/decisions-budget";
import { getPdfPageCount } from "@/lib/takeoff/chunking";
import type { TakeoffPreparationSnapshot } from "@/lib/takeoff/preparation";
import type { DownloadedTakeoffFile, TakeoffSourceDocumentRef } from "@/lib/takeoff/source-loader";
import { getTakeoffDecisionsCapability } from "@/lib/takeoff/takeoff-decisions-server";
import { extractVectorPage, VectorExtractionError, type VectorPageExtraction } from "@/lib/takeoff/vectors/extraction";
import { GROUP_DECISIONS_PROMPT_VERSION } from "@/lib/takeoff/vectors/group-decisions";
import {
  classifyVectorGroups,
  decisionsOfOutcome,
  GROUP_DECISIONS_CALL_ESTIMATE_TOKENS,
  isDecisionsRunStop,
  type GroupDecisionsDecide,
  type GroupDecisionsOutcome,
  type GroupDecisionsRender,
} from "@/lib/takeoff/vectors/group-decisions-server";
import {
  budgetVectorItems,
  locationFromFileName,
  vectorItemRecords,
  vectorPageRecord,
  type VectorItemRecord,
  type VectorPageDecisions,
  type VectorPageRecord,
} from "@/lib/takeoff/vectors/persistence";
import { readVectorPage, type VectorPageReading } from "@/lib/takeoff/vectors/pipeline";
import { TAKEOFF_VECTOR_READ_LIMITS } from "@/lib/takeoff/vectors/read-contracts";
import type { PageCalibration } from "@/lib/takeoff/vectors/scale";
import { pageAnchors, type PageAnchors } from "@/lib/takeoff/rules/registration";
import { isTakeoffRulesEnabled } from "@/lib/takeoff/rules/recompute-server";

// The vector reading in the takeoff worker (TI-662), opt-in with
// MERGEONE_TAKEOFF_VECTORS=1 and level C only: each retained page of each
// original PDF (never the merged copy, which loses its layer names) is
// extracted in its killable process and read with keywords. With
// MERGEONE_TAKEOFF_DECISIONS=1 too (and Decisions configured,
// getTakeoffDecisionsCapability), the groups left without class are then
// classified by Decisions (group-decisions-server.ts) and the page read again
// with its answers (a class under 0.8 is a proposal: kept with its confidence
// in the page record and counted « à revoir », neither classified nor
// measured):
// - per document and run, at most 10 batch and 50 dedicated calls over its
//   pages (TAKEOFF_VECTOR_DECISIONS_LIMITS); the groups past them stay « à
//   revoir » (stop « call_limit »): not asked, or their weak batch answer not
//   asked again alone;
// - per job, one token ceiling (TAKEOFF_VECTOR_DECISIONS_MAX_TOKENS);
// - the first failed or unavailable result, an exception, the ceiling or a
//   server without canvas stops Decisions for the rest of the job, never
//   retried: the later pages keep their keyword reading, « à revoir », and say
//   why;
// - any error of this step keeps the page's keyword reading and stops
//   Decisions for the job: it never fails the page nor the job. Only the job's
//   own check before each call (its lease, its tenant) stops the job, as
//   anywhere else.
// The page record keeps each group's class, source and confidence, and the
// page's Decisions summary (calls, tokens, latency, stop). A page calibration comes from the preparation's conventions when
// it names that page of that document: its plan file, or for a direct upload
// `upload:` and the SHA-256 of the original bytes read (never the snapshot's
// word for it). A page that fails or is raster gives no item; the level C
// reading of the same job is unchanged beside it (pipeline step 5), the rules
// of TI-664 decide between both. Any error of a page fails that page only,
// logged: the vector reading never fails the level C job it joins. The job's
// items stay within what its review reads (budgetVectorItems): a page past
// those limits keeps its record without its items, logged.

export const TAKEOFF_VECTOR_MAX_PAGES = 60;
/** Decisions calls per document and run (TI-662 step 3, default caps that Thanh may change). */
export const TAKEOFF_VECTOR_DECISIONS_LIMITS = { batchCalls: 10, dedicatedCalls: 50 } as const;
/**
 * Decisions tokens per job (TI-658: a named ceiling per run, no tenant flag). Starting value, to recalibrate on the
 * real pass: one document at its caps (10 batch and 50 dedicated calls) with room for a second.
 */
export const TAKEOFF_VECTOR_DECISIONS_MAX_TOKENS = 400_000;

export function isTakeoffVectorReadingEnabled() {
  return process.env.MERGEONE_TAKEOFF_VECTORS === "1";
}

/** The Decisions classification of a job's vector groups (readTakeoffVectorPages `decisions`). */
export type TakeoffVectorDecisionsHook = {
  owner: ChatGptOwner;
  /** Provenance of the calls (`takeoff-job:<id>`). */
  projectId: string;
  /** The job's own check before each call (lease renewal, active tenant): its failure stops the job. */
  beforeCall?: () => Promise<void>;
  maxTokens?: number;
  decide?: GroupDecisionsDecide;
  render?: GroupDecisionsRender;
};

/**
 * The hook of a level C job when MERGEONE_TAKEOFF_VECTORS=1, MERGEONE_TAKEOFF_DECISIONS=1 and Decisions is configured
 * (MERGEONE_OPENAI_DECISIONS=1 and its key), with the user the job acts for; otherwise none: no call, the groups
 * without keyword class stay « à revoir ».
 */
export function takeoffVectorDecisionsHook(input: { jobId: string; tenantId: string; userId: string | null; beforeCall?: () => Promise<void> }):
  TakeoffVectorDecisionsHook | undefined {
  if (!isTakeoffVectorReadingEnabled() || !input.userId || getTakeoffDecisionsCapability().status !== "available") return undefined;
  return { owner: { tenantId: input.tenantId, userId: input.userId }, projectId: `takeoff-job:${input.jobId}`, beforeCall: input.beforeCall };
}

export type VectorPageOutcome = {
  document: TakeoffSourceDocumentRef;
  fileName: string;
  page: number;
  record: VectorPageRecord | null;
  items: VectorItemRecord[];
  error: string | null;
  /** Registration anchors of a measurable page (TI-664), kept only when the fixed rules run. */
  anchors?: PageAnchors | null;
};

/**
 * The preparation's identity of an original PDF: its plan file, or for a direct upload `upload:` and the SHA-256 of
 * the bytes read (TakeoffUploadForm), the identity the loader already held them to (assertPreparedUploadBytes).
 */
export function preparationDocumentId(document: TakeoffSourceDocumentRef, bytes: ArrayBuffer): string {
  return document.kind === "plan_file" ? document.plan_file_id : `upload:${createHash("sha256").update(Buffer.from(bytes)).digest("hex")}`;
}

/** conventions.calibration of a confirmed preparation, when complete and on this document's page (docs/metier/preparation-metre.md). */
export function preparationCalibration(snapshot: TakeoffPreparationSnapshot | undefined, documentId: string | null, page: number): PageCalibration | null {
  const conventions = snapshot?.preparation.conventions;
  const calibration = conventions?.calibration;
  if (!conventions || conventions.measurement_basis !== "calibrated" || !calibration) return null;
  if (documentId === null || calibration.document_id !== documentId || calibration.page !== page) return null;
  const { reference_length, reference_unit, measured_span, measured_span_unit } = calibration;
  if (!reference_length || !reference_unit || !measured_span || !measured_span_unit) return null;
  const metres = reference_length * (reference_unit === "m" ? 1 : reference_unit === "cm" ? 0.01 : 0.001);
  const sheetMm = measured_span_unit === "pdf_points" ? measured_span * (25.4 / 72) : measured_span;
  const denominator = (metres * 1000) / sheetMm;
  return Number.isFinite(denominator) && denominator > 0 ? { page, denominator, source: "conventions.calibration de la préparation" } : null;
}

/** A page's stop: one of classifyVectorGroups, or its document's caps reached (« call_limit »). */
type PageStop = { reason: NonNullable<VectorPageDecisions["stop"]>["reason"]; message: string };
const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
/**
 * What the review says of a stop: the worker's own words (the provider's messages speak of the preparation), the
 * render messages of classifyVectorGroups kept.
 */
const STOP_MESSAGES: Partial<Record<PageStop["reason"], string>> = {
  budget_reached: "Le plafond de jetons Decisions de ce métré est atteint : les groupes restants sont à revoir.",
  call_failed: "Un appel Decisions a échoué, aucun autre n’a été envoyé : les groupes restants sont à revoir.",
  decisions_unavailable: "Decisions est indisponible, aucun autre appel n’a été envoyé : les groupes restants sont à revoir.",
  exception: "Le classement Decisions a échoué, aucun autre appel n’a été envoyé : les groupes restants sont à revoir.",
  call_limit: "Le plafond d’appels Decisions de ce document est atteint : les groupes restants sont à revoir.",
};
const stopOf = (reason: PageStop["reason"], message: string): PageStop => ({ reason, message: STOP_MESSAGES[reason] ?? message });

/** The Decisions state of a job: one token budget, the stop that ends its calls, and each document's calls left. */
type DecisionsRun = {
  hook: TakeoffVectorDecisionsHook;
  budget: DecisionsTokenBudget;
  stop: PageStop | null;
  /** Set when the job's own check before a call failed: rethrown, never taken for a Decisions failure. */
  jobError: { error: unknown } | null;
  calls: number;
};

function pageDecisionsSummary(outcome: GroupDecisionsOutcome, stop: PageStop | null): VectorPageDecisions {
  const calls = { batch: 0, dedicated: 0, failed: 0 };
  let tokens = 0, latency = 0;
  for (const call of outcome.calls) {
    calls[call.kind] += 1;
    if (call.status === "failed" || call.status === "unavailable" || call.status === "exception") calls.failed += 1;
    tokens += call.usage?.total_tokens ?? 0;
    latency += call.latency_ms;
  }
  const answered = [...outcome.answers.values()].filter((answer) => answer.status === "answered" && answer.class !== null).length;
  return {
    prompt_version: GROUP_DECISIONS_PROMPT_VERSION, candidates: outcome.candidates, eligible: outcome.eligible, left_out: outcome.left_out,
    dedicated_left_out: outcome.dedicated_left_out, calls, answered, total_tokens: tokens, latency_ms: Math.round(latency),
    stop: stop === null ? null : { reason: stop.reason, message: stop.message, from_earlier_page: false },
  };
}

/** A page not asked because the job's Decisions stopped before it. */
function stoppedSummary(stop: PageStop): VectorPageDecisions {
  return {
    prompt_version: GROUP_DECISIONS_PROMPT_VERSION, candidates: null, eligible: null, left_out: null, dedicated_left_out: null,
    calls: { batch: 0, dedicated: 0, failed: 0 }, answered: 0, total_tokens: 0, latency_ms: 0,
    stop: { reason: stop.reason, message: stop.message, from_earlier_page: true },
  };
}

/**
 * Classifies one page's groups within its document's calls left (`allowance`, decremented) and reads the page again
 * with the answers. Never throws but for the job's own check (run.jobError): any other error keeps the keyword
 * reading and stops Decisions for the job.
 */
async function decidePage(run: DecisionsRun, input: {
  bytes: Uint8Array;
  extraction: VectorPageExtraction;
  reading: VectorPageReading;
  readOptions: Parameters<typeof readVectorPage>[1];
  allowance: { batch: number; dedicated: number };
  fingerprint: () => string;
  log: { jobId: string | null; tenantId: string | null; document: TakeoffSourceDocumentRef; page: number };
}): Promise<{ reading: VectorPageReading; decisions: VectorPageDecisions }> {
  if (run.stop) return { reading: input.reading, decisions: stoppedSummary(run.stop) };
  // Its calls and tokens stay on the page even when an error follows them.
  let outcome: GroupDecisionsOutcome | null = null;
  try {
    outcome = await classifyVectorGroups({
      bytes: input.bytes, extraction: input.extraction, reading: input.reading, owner: run.hook.owner,
      context: { tenantId: run.hook.owner.tenantId, projectId: run.hook.projectId, preparationFingerprint: input.fingerprint() },
      budget: run.budget, decide: run.hook.decide, render: run.hook.render,
      limits: { maxBatchCalls: input.allowance.batch, maxDedicatedCalls: input.allowance.dedicated },
      beforeCall: run.hook.beforeCall && (async () => {
        try {
          await run.hook.beforeCall?.();
        } catch (error) {
          run.jobError = { error };
          throw error;
        }
      }),
    });
    for (const call of outcome.calls) input.allowance[call.kind] -= 1;
    run.calls += outcome.calls.length;
    // The provider, the ceiling or a server without canvas end the job's calls; a page's render failure, that page's.
    const stop = outcome.stop ? stopOf(outcome.stop.reason, outcome.stop.message)
      : outcome.left_out > 0 || outcome.dedicated_left_out > 0 ? stopOf("call_limit", "") : null;
    if (outcome.stop && (isDecisionsRunStop(outcome.stop.reason) || outcome.stop.reason === "canvas_unavailable")) run.stop = stop;
    const answers = decisionsOfOutcome(outcome);
    const reading = answers.size > 0 ? readVectorPage(input.extraction, { ...input.readOptions, decisions: answers }) : input.reading;
    return { reading, decisions: pageDecisionsSummary(outcome, stop) };
  } catch (error) {
    if (run.jobError) throw run.jobError.error;
    console.error("takeoff.vector.decisions_failed", { job_id: input.log.jobId, tenant_id: input.log.tenantId, document: input.log.document,
      page: input.log.page, message: (error instanceof Error ? error.message : String(error)).slice(0, 500) });
    run.stop = stopOf("exception", "");
    if (outcome) return { reading: input.reading, decisions: pageDecisionsSummary(outcome, run.stop) };
    return { reading: input.reading, decisions: { ...stoppedSummary(run.stop), stop: { ...run.stop, from_earlier_page: false } } };
  }
}

export async function readTakeoffVectorPages(source: DownloadedTakeoffFile, options: {
  onPage?: () => Promise<void>;
  /** Identity of the job, for the log of a failed page. */
  context?: { jobId: string; tenantId: string };
  /** Decisions for the groups without keyword class (takeoffVectorDecisionsHook); none: keywords only. */
  decisions?: TakeoffVectorDecisionsHook;
  /** The extraction of a page (tests); its killable child process by default. */
  extract?: (bytes: Uint8Array, page: number) => Promise<VectorPageExtraction>;
} = {}): Promise<VectorPageOutcome[]> {
  const extract = options.extract ?? ((bytes: Uint8Array, page: number) => extractVectorPage(bytes, page));
  const run: DecisionsRun | null = options.decisions ? {
    hook: options.decisions, stop: null, jobError: null, calls: 0,
    budget: createDecisionsTokenBudget(options.decisions.maxTokens ?? TAKEOFF_VECTOR_DECISIONS_MAX_TOKENS, GROUP_DECISIONS_CALL_ESTIMATE_TOKENS),
  } : null;
  const outcomes: VectorPageOutcome[] = [];
  read: for (const original of source.originalPdfSources ?? []) {
    const bytes = new Uint8Array(original.bytes);
    // Hashed once per file, and only when a preparation may name it.
    const documentId = source.preparationSnapshot ? preparationDocumentId(original.document, original.bytes) : null;
    const pages = original.pages.length ? original.pages : Array.from({ length: await getPdfPageCount(original.bytes) }, (_, index) => index + 1);
    const location = locationFromFileName(original.fileName);
    // This document's Decisions calls left for the run, over its pages.
    const allowance = { batch: TAKEOFF_VECTOR_DECISIONS_LIMITS.batchCalls, dedicated: TAKEOFF_VECTOR_DECISIONS_LIMITS.dedicatedCalls };
    let fingerprint: string | null = null;
    for (const page of pages) {
      if (outcomes.length >= TAKEOFF_VECTOR_MAX_PAGES) break read;
      // The lease renewal is the job's own: its failure stops the job, as everywhere else.
      await options.onPage?.();
      try {
        const extraction = await extract(bytes, page);
        const readOptions = { calibration: preparationCalibration(source.preparationSnapshot, documentId, page) };
        let reading = readVectorPage(extraction, readOptions);
        let decisions: VectorPageDecisions | undefined;
        if (run && reading.mode !== "raster") {
          ({ reading, decisions } = await decidePage(run, {
            bytes, extraction, reading, readOptions, allowance,
            fingerprint: () => (fingerprint ??= sha256(`${GROUP_DECISIONS_PROMPT_VERSION}:${sha256(bytes)}`)),
            log: { jobId: options.context?.jobId ?? null, tenantId: options.context?.tenantId ?? null, document: original.document, page },
          }));
        }
        // TI-664 (MERGEONE_TAKEOFF_RULES=1): the page's registration anchors, read with the classes of its final reading.
        const anchors = isTakeoffRulesEnabled() && reading.scale.denominator !== null && reading.mode !== "raster"
          ? pageAnchors(extraction, reading.scale.denominator, new Map(reading.groups.map((group) => [group.id, group.class]))) : null;
        outcomes.push({ document: original.document, fileName: original.fileName, page, record: vectorPageRecord(reading, location, decisions),
          items: vectorItemRecords(reading, location), error: null, anchors });
      } catch (error) {
        if (run?.jobError) throw run.jobError.error;
        const reason = error instanceof VectorExtractionError ? error.reason : "reading_failed";
        const message = error instanceof Error ? error.message : String(error);
        console.error("takeoff.vector.page_failed", { job_id: options.context?.jobId ?? null, tenant_id: options.context?.tenantId ?? null,
          document: original.document, page, reason, message: message.slice(0, 500) });
        outcomes.push({ document: original.document, fileName: original.fileName, page, record: null, items: [], error: `${reason}: ${message}`.slice(0, 500) });
      }
    }
  }
  if (run) {
    const spent = run.budget.snapshot();
    console.info("takeoff.vector.decisions", { job_id: options.context?.jobId ?? null, tenant_id: options.context?.tenantId ?? null,
      calls: run.calls, total_tokens: spent.spent_tokens, max_tokens: spent.max_tokens, stop: run.stop?.reason ?? null });
  }
  const budgeted = budgetVectorItems(outcomes, TAKEOFF_VECTOR_READ_LIMITS);
  budgeted.forEach((outcome, index) => {
    if (outcome.items.length === outcomes[index].items.length) return;
    console.error("takeoff.vector.page_items_dropped", { job_id: options.context?.jobId ?? null, tenant_id: options.context?.tenantId ?? null,
      document: outcome.document, page: outcome.page, reason: outcome.error });
  });
  return budgeted;
}
