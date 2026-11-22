import "server-only";

import type { StructuredCall } from "@/lib/ai/structured-call";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { readSealedItemListItems } from "@/lib/takeoff/item-list-server";
import type { TakeoffJobProcessingRow } from "@/lib/takeoff/job-lifecycle";
import { readTakeoffLaunchUnit } from "@/lib/takeoff/launch-request";
import { buildLevelCRunMetricRows } from "@/lib/takeoff/level-c-chunk-metrics";
import { prepareLevelCReading, type ProcessLevelCMetricsSummary } from "@/lib/takeoff/level-c-reading";
import type { Poste } from "@/lib/takeoff/poste-list";
import { buildTakeoffItemAnswersPublication, publishTakeoffItemAnswers } from "@/lib/takeoff/poste-publication-server";
import { finishPlanReading, posteVectorReadings, readPlanAgainstItemList, type PosteReadingReference } from "@/lib/takeoff/poste-reading";
import { logCompletedAuditEvent } from "@/lib/takeoff/processing-audit";
import { TAKEOFF_LEVEL_C, type Supabase } from "@/lib/takeoff/processing-context";
import { refreshTakeoffRulesAfterResult } from "@/lib/takeoff/result-finalization";
import type { DownloadedTakeoffFile, TakeoffSourceDocumentRef } from "@/lib/takeoff/source-loader";
import type { VectorPageOutcome } from "@/lib/takeoff/vectors/worker-server";

/**
 * The worker's side of the second measuring order (lot 4): a job of one analysis per plan whose request sealed the
 * affaire's list of items reads its plan against that list (`poste-reading.ts`), with the vector reading of the plan's own
 * pages, then publishes one answer per item and its end in one command under its lease (`poste-publication-server.ts`).
 * A job of the free extraction reads as before: the processor asks `readTakeoffItemListOrder` first.
 */

/** The list of items a job's request sealed (lot 4, the second measuring order): read by the worker, never by the model. */
export type TakeoffItemListOrder = { requestId: string; revisionId: string; revision: number; itemCount: number; contentSha256: string };

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
  const order = (data.manifest as { order?: { kind?: unknown; version?: unknown; list?: Record<string, unknown> | null } } | null)?.order;
  // A manifest sealed before the measuring orders were recorded, or of the free extraction: read as before.
  if (!order || order.kind === "free_extraction") return null;
  const list = order.kind === "item_list" && order.version === 2 ? order.list : null;
  if (!list || typeof list.revision_id !== "string" || typeof list.revision !== "number" || typeof list.item_count !== "number"
    || typeof list.content_sha256 !== "string" || data.item_list_revision_id !== list.revision_id
    || (job.project_id && data.project_id !== job.project_id)) {
    throw failure(job.id, "La commande de mesure de cette analyse est invalide : relancez la lecture de ce plan.");
  }
  return { requestId: data.id, revisionId: list.revision_id, revision: list.revision, itemCount: list.item_count,
    contentSha256: list.content_sha256 };
}

/**
 * The stop of a job of the second order while the publication of its answers is not delivered (lot 4 PR 3c removes it):
 * the processor ends the job once claimed, before its plan is read and before any paid call. The second order is not
 * activated before then.
 */
export function takeoffItemListReadingNotDelivered(jobId: string) {
  return new TakeoffError({ status: 422, code: TakeoffErrorCode.TAKEOFF_LEVEL_UNSUPPORTED, retryable: false, jobId, level: TAKEOFF_LEVEL_C,
    message: "La lecture contre la liste des postes n’est pas encore disponible : l’analyse s’arrête avant tout appel, sans rien dépenser." });
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
  const { config } = await prepareLevelCReading({ supabase: input.supabase, job, sourceFile });
  if (!job.project_id) throw failure(job.id, "L’affaire de cette analyse est introuvable.");
  let items: Poste[];
  try {
    items = await readSealedItemListItems(input.supabase, { tenantId: job.tenant_id, projectId: job.project_id,
      revisionId: input.order.revisionId, itemCount: input.order.itemCount });
  } catch {
    throw failure(job.id, "La liste des postes scellée par cette analyse n’a pas pu être lue.");
  }
  // Each context file with its kind (the reading keeps the CCTP only); a file whose kind is not known is never attached.
  const references: PosteReadingReference[] = (sourceFile.contextFiles ?? []).map((file, index) => ({ ...file,
    ...(sourceFile.contextReferences?.[index] ?? { kind: "other" as const, name: "Pièce", revision: null }) }));
  const reading = await readPlanAgainstItemList({ call: input.call, job, items, listRevision: input.order.revision, model: input.model,
    config, references, preparation: sourceFile.preparationSnapshot,
    pdf: { fileName: sourceFile.fileName, bytes: sourceFile.bytes, originalPageNumbers: sourceFile.sourcePageNumbersByPage } });
  const vectorOutcomes = await input.readVectors();
  const plan = finishPlanReading(reading, items, posteVectorReadings(vectorOutcomes, planFile.plan_file_id), job.id);
  await input.renewLease();
  const completedAt = input.now();
  const totalDurationMs = Math.max(reading.durationMs, completedAt.getTime() - input.processingStartedAt.getTime());
  const publication = buildTakeoffItemAnswersPublication({ job, items, reading, plan, planFile, vectorOutcomes, completedAt,
    totalDurationMs, model: input.model, fileName: sourceFile.fileName, mimeType: sourceFile.mimeType,
    list: { revisionId: input.order.revisionId, revision: input.order.revision, itemCount: input.order.itemCount },
    runMetrics: buildLevelCRunMetricRows({ supabase: input.supabase, job, metrics: reading.metrics,
      hint: { sourceFileName: sourceFile.fileName } }) });
  const resultId = await publishTakeoffItemAnswers(input.supabase, publication);
  await logCompletedAuditEvent({ supabase: input.supabase, userId: input.userId, job, resultId, itemsCount: publication.p_items.length,
    warningsCount: publication.p_result.warnings.length, durationMs: totalDurationMs });
  await refreshTakeoffRulesAfterResult({ supabase: input.supabase, job });
  return {
    jobId: job.id, resultId, status: "completed", itemsCount: publication.p_items.length, warningsCount: publication.p_result.warnings.length,
    tokenCount: reading.tokenUsage.totalTokens, costCents: reading.costCents, durationMs: totalDurationMs, tablesCount: 0,
    chunksCount: reading.chunksCount, pageCount: reading.pageCount, metricsSummary: { ...reading.tokenUsage },
  };
}
