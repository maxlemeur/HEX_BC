import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";
import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { PLAN_FILES_BUCKET } from "@/lib/storage/buckets";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { createTakeoffPreparationSnapshot, takeoffPreparationSchema, type TakeoffPreparationSnapshot } from "@/lib/takeoff/preparation";
import { getPreparationPlanSourceVersion, type PreparationPlanFile } from "@/lib/takeoff/preparation-sources";
import { inspectPlanSetResourceBudget } from "@/lib/takeoff/plans";
import { readAllRows } from "@/lib/supabase/read-all";
import type { TakeoffJobProcessingRow } from "@/lib/takeoff/job-lifecycle";
import type { DownloadedTakeoffFile, TakeoffSourceDocumentRef } from "@/lib/takeoff/source-loader";

export function parsePreparationSnapshot(value: unknown): TakeoffPreparationSnapshot | null {
  if (value === null || value === undefined) return null;
  const stored = z.object({
    schema_version: z.literal(1), preparation_revision: z.number().int().positive(),
    confirmed_by: z.string().uuid(), confirmed_at: z.string(), preparation: takeoffPreparationSchema,
  }).parse(value);
  return createTakeoffPreparationSnapshot({
    preparation: stored.preparation, revision: stored.preparation_revision,
    confirmedBy: stored.confirmed_by, confirmedAt: stored.confirmed_at,
  });
}

function changedSource(job: TakeoffJobProcessingRow, message: string): never {
  throw new TakeoffError({
    status: 409, code: TakeoffErrorCode.CONFLICT, message,
    details: { reason: "PREPARATION_SOURCE_CHANGED" }, retryable: false, jobId: job.id,
  });
}

/** Reads exact confirmed documents, verifies their bytes, and copies only selected pages. */
export async function loadPreparedPlanSource(input: {
  supabase: AuthenticatedTenantContext["supabase"]; job: TakeoffJobProcessingRow;
  snapshot: TakeoffPreparationSnapshot; maxPages: number;
}): Promise<DownloadedTakeoffFile> {
  const selected = input.snapshot.preparation.sources.filter((source) => source.active && source.kind === "plan");
  if (!selected.length || selected.some((source) => source.plan_set_id !== input.job.plan_set_id)) {
    changedSource(input.job, "Les sources confirmées ne correspondent pas au jeu de plans de l'analyse.");
  }
  const { data, error } = await readAllRows(() => input.supabase.from("plan_files")
    .select("id,plan_set_id,file_path,file_name,file_size_bytes,file_hash,page_count,updated_at,metadata", { count: "exact" })
    .eq("tenant_id", input.job.tenant_id).eq("plan_set_id", input.job.plan_set_id!)
    .in("id", selected.map((source) => source.document_id)).order("id"));
  if (error) changedSource(input.job, "Impossible de vérifier les sources confirmées.");
  const files = new Map((data as PreparationPlanFile[] ?? []).map((file) => [file.id, file]));
  const loaded: Array<{ pdf: PDFDocument; bytes: ArrayBuffer; pages: number[]; source: typeof selected[number] }> = [];
  const actualSizes: Array<{ file_size_bytes: number; page_count: number }> = [];
  for (const source of selected) {
    const file = files.get(source.document_id);
    if (!file || source.source_version !== getPreparationPlanSourceVersion(file) || source.file_path !== file.file_path) {
      changedSource(input.job, `Le plan « ${source.document_name} » a changé depuis la confirmation. Préparez une nouvelle analyse.`);
    }
    const { data: blob, error: downloadError } = await input.supabase.storage.from(PLAN_FILES_BUCKET).download(file.file_path);
    if (downloadError || !blob) changedSource(input.job, `Le plan confirmé « ${source.document_name} » est introuvable.`);
    const bytes = await blob.arrayBuffer();
    const digest = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
    if (!source.content_hash || digest !== source.content_hash) {
      changedSource(input.job, `Le contenu du plan « ${source.document_name} » ne correspond plus au fichier confirmé.`);
    }
    let pdf: PDFDocument;
    try { pdf = await PDFDocument.load(bytes); } catch {
      throw new TakeoffError({ code: TakeoffErrorCode.TAKEOFF_PDF_CORRUPTED, message: "Un plan confirmé est invalide ou protégé.", retryable: false, jobId: input.job.id });
    }
    const pages = source.pages.length ? source.pages : Array.from({ length: pdf.getPageCount() }, (_, i) => i + 1);
    if (pages.some((page) => page < 1 || page > pdf.getPageCount())) changedSource(input.job, "Une page confirmée n'existe plus dans le plan.");
    actualSizes.push({ file_size_bytes: bytes.byteLength, page_count: pdf.getPageCount() });
    const budget = inspectPlanSetResourceBudget(actualSizes, { maxPages: input.maxPages });
    if (budget.violation) throw new TakeoffError({ status: 413, code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE, message: "Les plans confirmés dépassent les limites de traitement.", retryable: false, jobId: input.job.id });
    loaded.push({ pdf, bytes, pages, source });
  }
  const merged = await PDFDocument.create();
  const sourceFileNamesByPage: string[] = [];
  const sourceDocumentsByPage: TakeoffSourceDocumentRef[] = [];
  const sourcePageNumbersByPage: number[] = [];
  for (const { pdf, pages, source } of loaded) {
    for (const [index, page] of (await merged.copyPages(pdf, pages.map((page) => page - 1))).entries()) {
      merged.addPage(page);
      sourceFileNamesByPage.push(source.document_name);
      sourceDocumentsByPage.push({ kind: "plan_file", plan_file_id: source.document_id });
      sourcePageNumbersByPage.push(pages[index]);
    }
  }
  const bytes = await merged.save();
  return {
    fileName: loaded.length === 1 ? loaded[0].source.document_name : `plan-set-${input.job.plan_set_id}.pdf`,
    mimeType: "application/pdf", bytes: Uint8Array.from(bytes).buffer,
    sourceFileNamesByPage, sourceDocumentsByPage, sourcePageNumbersByPage,
    sourcePlanFilePageCounts: loaded.map(({ source, pdf }) => ({ filePath: source.file_path!, pageCount: pdf.getPageCount() })),
    preparationSnapshot: input.snapshot,
  };
}

export function assertPreparedUploadBytes(job: TakeoffJobProcessingRow, snapshot: TakeoffPreparationSnapshot, bytes: ArrayBuffer) {
  const selected = snapshot.preparation.sources.filter((source) => source.active);
  const hash = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
  if (selected.length !== 1 || selected[0].document_id !== `upload:${hash}` || selected[0].content_hash !== hash) {
    changedSource(job, "Le fichier de l'analyse ne correspond pas à la source confirmée.");
  }
}
