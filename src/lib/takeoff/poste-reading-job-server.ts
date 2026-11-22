import "server-only";

import type { StructuredCall } from "@/lib/ai/structured-call";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { readSealedItemListItems } from "@/lib/takeoff/item-list-server";
import type { TakeoffJobProcessingRow } from "@/lib/takeoff/job-lifecycle";
import type { TakeoffChunkingRuntimeConfig } from "@/lib/takeoff/chunking";
import { TAKEOFF_PAID_CALL_ESTIMATE_TOKENS } from "@/lib/takeoff/launch-call-ledger";
import { describeTakeoffLaunchReason, readTakeoffLaunchUnit, type AnyTakeoffLaunchManifest } from "@/lib/takeoff/launch-request";
import { planPosteBatches } from "@/lib/takeoff/poste-exchange";
import { boundPosteReadingRequest, describePosteReadingBounds, posteReadingBoundsOfManifest } from "@/lib/takeoff/poste-reading-bounds";
import { buildLevelCRunMetricRows } from "@/lib/takeoff/level-c-chunk-metrics";
import { prepareLevelCReading, type ProcessLevelCMetricsSummary } from "@/lib/takeoff/level-c-reading";
import type { Poste } from "@/lib/takeoff/poste-list";
import { buildTakeoffItemAnswersPublication, publishTakeoffItemAnswers } from "@/lib/takeoff/poste-publication-server";
import {
  finishPlanReading, planPagesOf, posteVectorReadings, readPlanAgainstItemList, type PosteReadingReference,
} from "@/lib/takeoff/poste-reading";
import { logCompletedAuditEvent } from "@/lib/takeoff/processing-audit";
import { TAKEOFF_LEVEL_C, type Supabase } from "@/lib/takeoff/processing-context";
import { refreshTakeoffRulesAfterResult } from "@/lib/takeoff/result-finalization";
import type { DownloadedTakeoffFile, TakeoffSourceDocumentRef } from "@/lib/takeoff/source-loader";
import { storableVectorOutcomes } from "@/lib/takeoff/vectors/worker-persistence-server";
import { takeoffVectorGroupCallsBound, type VectorPageOutcome } from "@/lib/takeoff/vectors/worker-server";

/**
 * The worker's side of the second measuring order (lot 4): a job of one analysis per plan whose request sealed the
 * affaire's list of items reads its plan against that list (`poste-reading.ts`), with the vector reading of the plan's own
 * pages, then publishes one answer per item and its end in one command under its lease (`poste-publication-server.ts`).
 * A job of the free extraction reads as before: the processor asks `readTakeoffItemListOrder` first.
 */

/**
 * The list of items a job's request sealed (lot 4, the second measuring order): read by the worker, never by the model;
 * with the request's sealed manifest, whose every unit its re-check before a paid call plans again.
 */
export type TakeoffItemListOrder = { requestId: string; revisionId: string; revision: number; itemCount: number; contentSha256: string;
  manifest: AnyTakeoffLaunchManifest };

const failure = (jobId: string, message: string, retryable = false) =>
  new TakeoffError({ code: TakeoffErrorCode.INTERNAL_ERROR, retryable, jobId, level: TAKEOFF_LEVEL_C, message });

/**
 * The measuring order of a job's request: none for a job without a request or one of the free extraction (nothing is
 * read for a job without a request). The list sealed is checked against the one the database recorded at the admission.
 */
export async function readTakeoffItemListOrder(supabase: Supabase,
  job: Pick<TakeoffJobProcessingRow, "id" | "tenant_id" | "project_id" | "launch_request_id">): Promise<TakeoffItemListOrder | null> {
  if (!job.launch_request_id) return null;
  const { data, error } = await supabase.from("takeoff_launch_requests").select("id, project_id, manifest, item_list_revision_id")
    .eq("id", job.launch_request_id).eq("tenant_id", job.tenant_id).maybeSingle();
  // A read that failed is tried again, as the request's budget is (launch-request-budget.ts); a request that is not
  // what it should be ends the job.
  if (error) throw failure(job.id, "Impossible de lire la commande de mesure de cette analyse.", true);
  if (!data) throw failure(job.id, "La demande de cette analyse est introuvable.");
  const manifest = data.manifest as { order?: { kind?: unknown; version?: unknown; list?: Record<string, unknown> | null };
    units?: unknown; plans?: unknown; budget?: { tokens?: unknown } } | null;
  const order = manifest?.order;
  // A manifest sealed before the measuring orders were recorded, or of the free extraction: read as before.
  if (!order || order.kind === "free_extraction") return null;
  const list = order.kind === "item_list" && order.version === 2 ? order.list : null;
  // The database sealed the manifest's shape (assert_takeoff_launch_seal); its units, plans and envelope are checked present.
  if (!list || typeof list.revision_id !== "string" || typeof list.revision !== "number" || typeof list.item_count !== "number"
    || typeof list.content_sha256 !== "string" || data.item_list_revision_id !== list.revision_id
    || !Array.isArray(manifest.units) || !Array.isArray(manifest.plans) || typeof manifest.budget?.tokens !== "number"
    || (job.project_id && data.project_id !== job.project_id)) {
    throw failure(job.id, "La commande de mesure de cette analyse est invalide : relancez la lecture de ce plan.");
  }
  return { requestId: data.id, revisionId: list.revision_id, revision: list.revision, itemCount: list.item_count,
    contentSha256: list.content_sha256, manifest: manifest as AnyTakeoffLaunchManifest };
}

/**
 * Before its first paid call, the whole request planned again with the settings the worker will use (the tenant's
 * fragmenting now, which may differ from the admission's; the pages counted on its own plan's PDF), every unit of its
 * manifest and every paid call counted (each fragment times each batch of the items, and the vector classifier's), within
 * the same bounds as its admission: the ceilings of a plan's and of the request's reading, each plan's share, the
 * request's envelope; then its own plan's calls against the attempt's budget, what its sealed share has left (the
 * ledger's balance). Beyond them it stops with the bounds' own reason, nothing spent: past a ceiling the plans to reduce,
 * past the budget what is left (a request whose earlier attempts spent its share is relaunched).
 */
function assertReadingWithinBounds(job: TakeoffJobProcessingRow, input: { manifest: AnyTakeoffLaunchManifest; items: readonly Poste[];
  pageCount: number; maxPage: number; config: TakeoffChunkingRuntimeConfig & { maxTotalTokens: number }; planFile: { plan_file_id: string }; fileName: string }) {
  const unit = readTakeoffLaunchUnit(job.preparation_snapshot)!;
  const request = posteReadingBoundsOfManifest(input.manifest, input.config, TAKEOFF_PAID_CALL_ESTIMATE_TOKENS, input.items,
    takeoffVectorGroupCallsBound, new Map([[unit.key, input.pageCount]]));
  const own = request?.units.find((entry) => entry.key === unit.key);
  if (!request || !own) throw failure(job.id, "Le plan de cette analyse n’est pas une unité de sa demande : relancez la lecture de ce plan.");
  const attempt = boundPosteReadingRequest({ batches: planPosteBatches(input.items).map((batch) => batch.length),
    units: [{ key: unit.key, pieces: [{ id: input.planFile.plan_file_id, name: input.fileName }], pages: input.pageCount,
      maxPage: input.maxPage,
      budgetTokens: unit.budget?.tokens ?? input.config.maxTotalTokens, vectorCalls: own.calls - own.fragments * own.batches }],
    requestBudgetTokens: input.config.maxTotalTokens, chunking: input.config, estimateTokensPerCall: TAKEOFF_PAID_CALL_ESTIMATE_TOKENS });
  const bounds = !request.ok ? request : attempt;
  if (bounds.ok) return;
  const exceeded = [...bounds.exceeded, ...bounds.units.flatMap((entry) => entry.exceeded)];
  const tooLarge = exceeded.some((limit) => limit !== "budget");
  throw new TakeoffError({ status: 422, retryable: false, jobId: job.id, level: TAKEOFF_LEVEL_C,
    code: tooLarge ? TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE : TakeoffErrorCode.TAKEOFF_LEVEL_C_BUDGET_EXCEEDED,
    message: tooLarge ? describeTakeoffLaunchReason("PLAN_SET_TOO_LARGE", bounds.pieces, bounds)
      : `${describePosteReadingBounds({ ...bounds, ok: true })} Le budget qui reste à cette analyse ne permet plus ses appels : `
        + "relancez-la depuis les options du métré.",
    details: { reading_calls: bounds.readingCalls, calls: bounds.calls, tokens: bounds.tokens, budget_tokens: bounds.requestBudgetTokens,
      exceeded } });
}

/**
 * The pages a request sealed for a unit of one plan, as the publication command reads them (private.
 * takeoff_item_answer_plans): the plan's retained pages, sorted, else its pages 1 to its page count; none when unknown.
 */
function sealedUnitPages(manifest: AnyTakeoffLaunchManifest, unitKey: string): number[] | null {
  const unit = manifest.units.find((entry) => entry.key === unitKey);
  const plan = unit?.plans.length === 1 ? manifest.plans.find((entry) => entry.entry_key === unit.plans[0]) : undefined;
  if (!plan) return null;
  if (plan.pages.length) return [...plan.pages].sort((left, right) => left - right);
  const count = plan.page_count;
  return count !== null && Number.isInteger(count) && count >= 1 && count <= 2_000
    ? Array.from({ length: count }, (_, index) => index + 1) : null;
}

/**
 * Before its first paid call, the original pages the job will read (its PDF's pages, mapped to the plan's) against those
 * its request sealed: the command publishes the answers of the sealed pages only. A plan whose PDF holds other pages (its
 * file replaced, a page count stored wrong) is stopped here, nothing spent, never read then refused.
 */
function assertSealedPages(job: TakeoffJobProcessingRow, manifest: AnyTakeoffLaunchManifest, read: readonly number[]) {
  const sealed = sealedUnitPages(manifest, readTakeoffLaunchUnit(job.preparation_snapshot)!.key);
  const pages = [...read].sort((left, right) => left - right);
  if (sealed && sealed.length === pages.length && sealed.every((value, index) => value === pages[index])) return;
  throw new TakeoffError({ code: TakeoffErrorCode.TAKEOFF_PREPARATION_SOURCE_CHANGED, retryable: false, jobId: job.id,
    level: TAKEOFF_LEVEL_C, message: "Les pages de ce plan ne sont plus celles que sa demande a scellées : il n’a pas été lu. "
      + "Relancez-le pour lire sa version actuelle.", details: { sealed_pages: sealed?.length ?? null, read_pages: pages.length } });
}

export type ProcessItemListResult = {
  jobId: string; resultId: string; status: "completed"; itemsCount: number; warningsCount: number; tokenCount: number;
  costCents: number; durationMs: number; tablesCount: number; chunksCount: number; pageCount: number;
  metricsSummary: ProcessLevelCMetricsSummary;
};

/** The one plan file a plan's unit reads: its source, or the same file on every page of its PDF. */
function unitPlanFile(job: TakeoffJobProcessingRow, sourceFile: DownloadedTakeoffFile): Extract<TakeoffSourceDocumentRef, { kind: "plan_file" }> {
  const documents = sourceFile.sourceDocumentsByPage ?? (sourceFile.sourceDocument ? [sourceFile.sourceDocument] : []);
  const files = new Set(documents.map((document) => document.kind === "plan_file" ? document.plan_file_id : null));
  const [planFileId] = [...files];
  if (files.size !== 1 || !planFileId) throw failure(job.id, "Le plan de cette analyse ne correspond pas à un seul fichier du jeu de plans.");
  return { kind: "plan_file", plan_file_id: planFileId };
}

/**
 * A job of the second order: its unit must be one plan (the list is answered plan by plan), checked before any paid call;
 * the sealed revision read again on each attempt; the reading's calls made through the job's local provider; the
 * answers merged with the vector reading; the lease renewed; then the one publication of the answers and the end.
 */
export async function processItemListLevelC(input: {
  supabase: Supabase;
  job: TakeoffJobProcessingRow;
  sourceFile: DownloadedTakeoffFile;
  call: StructuredCall;
  model: string;
  order: TakeoffItemListOrder;
  userId: string | null;
  processingStartedAt: Date;
  now: () => Date;
  renewLease: () => Promise<void>;
  /** The vector reading of the job's pages, as the processor makes it for the first format. */
  readVectors: () => Promise<VectorPageOutcome[]>;
}): Promise<ProcessItemListResult> {
  const { job, sourceFile } = input;
  if (!readTakeoffLaunchUnit(job.preparation_snapshot)?.key.startsWith("plan:")) {
    throw new TakeoffError({ code: TakeoffErrorCode.TAKEOFF_LEVEL_UNSUPPORTED, retryable: false, jobId: job.id, level: TAKEOFF_LEVEL_C,
      message: "La lecture contre la liste des postes se fait plan par plan : une analyse groupée ne la lit pas." });
  }
  const planFile = unitPlanFile(job, sourceFile);
  const prepared = await prepareLevelCReading({ supabase: input.supabase, job, sourceFile });
  const { pageCount, requestBudget } = prepared;
  const readPages = planPagesOf(pageCount, sourceFile.sourcePageNumbersByPage);
  assertSealedPages(job, input.order.manifest, readPages);
  if (!requestBudget) throw failure(job.id, "Le budget de la demande de cette analyse est introuvable.");
  // Its budget is what its sealed share has left (sized from its admitted calls), never the first format's per-job budget.
  const config = { ...prepared.config, maxTotalTokens: requestBudget.remainingTokens, maxCostCents: requestBudget.remainingCostCents };
  if (!job.project_id) throw failure(job.id, "L’affaire de cette analyse est introuvable.");
  let items: Poste[];
  try {
    items = await readSealedItemListItems(input.supabase, { tenantId: job.tenant_id, projectId: job.project_id,
      revisionId: input.order.revisionId, itemCount: input.order.itemCount });
  } catch {
    throw failure(job.id, "La liste des postes scellée par cette analyse n’a pas pu être lue.");
  }
  assertReadingWithinBounds(job, { manifest: input.order.manifest, items, pageCount, maxPage: Math.max(...readPages), config, planFile,
    fileName: sourceFile.fileName });
  // Each context file with its kind (the reading keeps the CCTP only); a file whose kind is not known is never attached.
  const references: PosteReadingReference[] = (sourceFile.contextFiles ?? []).map((file, index) => ({ ...file,
    ...(sourceFile.contextReferences?.[index] ?? { kind: "other" as const, name: "Pièce", revision: null }) }));
  const reading = await readPlanAgainstItemList({ call: input.call, job, items, listRevision: input.order.revision, model: input.model,
    config, references, preparation: sourceFile.preparationSnapshot,
    pdf: { fileName: sourceFile.fileName, bytes: sourceFile.bytes, originalPageNumbers: sourceFile.sourcePageNumbersByPage } });
  // The vector reading travels with the answers: what the database could not store of it is left out before the call.
  const vectors = storableVectorOutcomes(await input.readVectors());
  const vectorOutcomes = vectors.outcomes;
  const plan = finishPlanReading(reading, items, posteVectorReadings(vectorOutcomes, planFile.plan_file_id), job.id);
  // Every call is paid: a renewal that could not be made (a transport error is reported as a conflict) never discards the
  // reading. The command checks the lease under its lock, and only its own answer that the lease is lost ends the attempt.
  await input.renewLease().catch(() => undefined);
  const completedAt = input.now();
  const totalDurationMs = Math.max(reading.durationMs, completedAt.getTime() - input.processingStartedAt.getTime());
  const publication = buildTakeoffItemAnswersPublication({ job, items, reading, plan, planFile, vectorOutcomes,
    vectorLeftOut: vectors.leftOut, completedAt,
    totalDurationMs, model: input.model, fileName: sourceFile.fileName, mimeType: sourceFile.mimeType,
    list: { revisionId: input.order.revisionId, revision: input.order.revision, itemCount: input.order.itemCount },
    runMetrics: buildLevelCRunMetricRows({ supabase: input.supabase, job, metrics: reading.metrics,
      hint: { sourceFileName: sourceFile.fileName } }) });
  const resultId = await publishTakeoffItemAnswers(input.supabase, publication, { renewLease: input.renewLease });
  await logCompletedAuditEvent({ supabase: input.supabase, userId: input.userId, job, resultId, itemsCount: publication.p_items.length,
    warningsCount: publication.p_result.warnings.length, durationMs: totalDurationMs });
  await refreshTakeoffRulesAfterResult({ supabase: input.supabase, job });
  return {
    jobId: job.id, resultId, status: "completed", itemsCount: publication.p_items.length, warningsCount: publication.p_result.warnings.length,
    tokenCount: reading.tokenUsage.totalTokens, costCents: reading.costCents, durationMs: totalDurationMs, tablesCount: 0,
    chunksCount: reading.chunksCount, pageCount: reading.pageCount, metricsSummary: { ...reading.tokenUsage },
  };
}
