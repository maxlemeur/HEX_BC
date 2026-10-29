import { readAllRows } from "@/lib/supabase/read-all";
import { PDFDocument } from "pdf-lib";

import type { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { mapSupabaseError } from "@/lib/estimates/errors";
import { TakeoffError, TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import {
  getTakeoffChunkingConfigForTenant,
  getTakeoffLevelCProcessingConfigForTenant,
} from "@/lib/takeoff/feature-flags";
import type { TakeoffJobProcessingRow } from "@/lib/takeoff/job-lifecycle";
import { resolveTakeoffPdfMimeType } from "@/lib/takeoff/pdf-validation";
import { PLAN_FILES_BUCKET } from "@/lib/storage/buckets";
import { getPlanFileDisplayName } from "@/lib/takeoff/plan-file-display-name";
import { assertPreparedUploadBytes, loadPreparedPlanSource, parsePreparationSnapshot } from "@/lib/takeoff/preparation-source-loader";
import { loadPreparationReferenceFiles } from "@/lib/takeoff/preparation-reference-loader";
import type { TakeoffPreparationSnapshot } from "@/lib/takeoff/preparation";
import {
  inspectPlanSetResourceBudget,
  PLAN_SET_MAX_FILES,
  PLAN_SET_MAX_TOTAL_SIZE_BYTES,
  type PlanSetResourceBudget,
  type PlanSetResourceBudgetFile,
} from "@/lib/takeoff/plans";

type Supabase = Awaited<ReturnType<typeof getAuthenticatedContext>>["supabase"];

export type TakeoffSourceLevel = "A" | "B" | "C";

/**
 * Référence durable d'un document source (M1b) : le fichier du jeu de plans, ou le fichier
 * téléversé pour ce job. Elle identifie le document, jamais par son nom affiché ni par son nom
 * nettoyé pour Storage (« Plan R+1.pdf » et « Plan R-1.pdf » y deviennent tous deux « Plan-R-1.pdf »).
 */
export type TakeoffSourceDocumentRef =
  | { kind: "plan_file"; plan_file_id: string }
  | { kind: "job_upload"; job_id: string };

export type DownloadedTakeoffFile = {
  /** Libellé d'origine du document (nom reçu), ou nom du PDF fusionné d'un jeu multi-fichiers. */
  fileName: string;
  mimeType: string;
  bytes: ArrayBuffer;
  /** Document d'une source unique (fichier téléversé, ou jeu de plans d'un seul fichier). */
  sourceDocument?: TakeoffSourceDocumentRef;
  /** Libellé d'origine du fichier de chaque page d'un jeu multi-fichiers. */
  sourceFileNamesByPage?: string[];
  /** Référence du fichier de chaque page d'un jeu multi-fichiers. */
  sourceDocumentsByPage?: TakeoffSourceDocumentRef[];
  sourcePageNumbersByPage?: number[];
  preparationSnapshot?: TakeoffPreparationSnapshot;
  contextFiles?: Array<{ data: string; mimeType: string }>;
  contextSourceHints?: string[];
  sourcePlanFilePageCounts?: Array<{
    filePath: string;
    pageCount: number;
  }>;
};

const TAKEOFF_FILES_BUCKET = "takeoff-files";

function normalizeNullableText(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  return arrayBuffer;
}

function inferMimeTypeFromFilename(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

type PlanFileSourceRow = {
  id?: string | null;
  file_path?: string | null;
  file_name?: string | null;
  file_type?: string | null;
  file_size_bytes?: number | null;
  page_count?: number | null;
  metadata?: Record<string, unknown> | null;
};

// M1a garde le nom reçu dans plan_files.metadata ; file_name reste la clé Storage nettoyée.
function getPlanFileSourceLabel(planFile: PlanFileSourceRow) {
  const fileName = normalizeNullableText(planFile.file_name);
  if (!fileName) return null;
  return getPlanFileDisplayName({
    file_name: fileName,
    metadata:
      planFile.metadata && typeof planFile.metadata === "object" && !Array.isArray(planFile.metadata)
        ? planFile.metadata
        : null,
  });
}

function getPlanFileSourceRef(planFile: PlanFileSourceRow): TakeoffSourceDocumentRef | undefined {
  const planFileId = normalizeNullableText(planFile.id);
  return planFileId ? { kind: "plan_file", plan_file_id: planFileId } : undefined;
}

function getFileNameFromStoragePath(path: string, fallback: string) {
  const segments = path.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last) return fallback;
  return last.replace(/^[a-f0-9]{64}-/i, "") || fallback;
}

function throwPlanSetResourceBudgetError(input: {
  budget: PlanSetResourceBudget;
  job: TakeoffJobProcessingRow;
  level: TakeoffSourceLevel;
  maxPages: number;
  phase: "metadata" | "download" | "pdf";
}): never {
  throw new TakeoffError({
    status: 413,
    code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE,
    message: "Le jeu de plans depasse les limites de traitement autorisees.",
    details: {
      phase: input.phase,
      violation: input.budget.violation,
      file_count: input.budget.fileCount,
      max_file_count: PLAN_SET_MAX_FILES,
      total_size_bytes: input.budget.totalSizeBytes,
      max_total_size_bytes: PLAN_SET_MAX_TOTAL_SIZE_BYTES,
      known_page_count: input.budget.knownPageCount,
      unknown_page_count: input.budget.unknownPageCount,
      max_pdf_pages: input.maxPages,
    },
    retryable: false,
    jobId: input.job.id,
    level: input.level,
  });
}

async function getPlanSetMaxPdfPages(input: {
  supabase: Supabase;
  tenantId: string;
  level: TakeoffSourceLevel;
}) {
  const config =
    input.level === "C"
      ? await getTakeoffLevelCProcessingConfigForTenant(input.tenantId, {
          supabase: input.supabase,
        })
      : await getTakeoffChunkingConfigForTenant(input.tenantId, {
          supabase: input.supabase,
        });
  return config.maxPdfPages;
}

/**
 * Loads the immutable input bytes for one takeoff attempt.
 *
 * This interface owns source metadata, Storage downloads, aggregate resource
 * budgets, multi-PDF validation/merge, and per-page provenance. It deliberately
 * does not own leases, job state transitions, provider calls, or result writes.
 */
export async function loadTakeoffSource(input: {
  supabase: Supabase;
  job: TakeoffJobProcessingRow;
  level: TakeoffSourceLevel;
}): Promise<DownloadedTakeoffFile> {
  const preparationSnapshot = parsePreparationSnapshot(input.job.preparation_snapshot);
  const planSetId = normalizeNullableText(input.job.plan_set_id);
  if (planSetId && preparationSnapshot) {
    const source = await loadPreparedPlanSource({
      supabase: input.supabase, job: input.job, snapshot: preparationSnapshot,
      maxPages: await getPlanSetMaxPdfPages({ supabase: input.supabase, tenantId: input.job.tenant_id, level: input.level }),
    });
    const context = await loadPreparationReferenceFiles({ supabase: input.supabase, job: input.job, snapshot: preparationSnapshot });
    return { ...source, contextFiles: context.files, contextSourceHints: context.sourceHints };
  }
  if (planSetId) {
    const { data: planFilesData, error: planFilesError } = await readAllRows(() => input.supabase
      .from("plan_files" as never)
      .select(
        "file_path, file_name, file_type, file_size_bytes, page_count, id, metadata" as never,
        { count: "exact" }
      )
      .eq("tenant_id" as never, input.job.tenant_id as never)
      .eq("plan_set_id" as never, planSetId as never)
      .order("created_at" as never, { ascending: true }));

    if (planFilesError) {
      throw toTakeoffError(
        mapSupabaseError(
          planFilesError,
          "Impossible de charger les fichiers du jeu de plans."
        ),
        {
          fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
          retryable: false,
          jobId: input.job.id,
          level: input.level,
        }
      );
    }

    const planFiles = (planFilesData ?? []) as PlanFileSourceRow[];

    if (planFiles.length === 0) {
      throw new TakeoffError({
        code: TakeoffErrorCode.TAKEOFF_FILE_REQUIRED,
        message: "Le jeu de plans du job ne contient aucun fichier source.",
        retryable: false,
        jobId: input.job.id,
        level: input.level,
      });
    }

    const maxPdfPages = await getPlanSetMaxPdfPages({
      supabase: input.supabase,
      tenantId: input.job.tenant_id,
      level: input.level,
    });
    const metadataBudget = inspectPlanSetResourceBudget(planFiles, {
      maxPages: maxPdfPages,
    });
    if (metadataBudget.violation) {
      throwPlanSetResourceBudgetError({
        budget: metadataBudget,
        job: input.job,
        level: input.level,
        maxPages: maxPdfPages,
        phase: "metadata",
      });
    }

    if (planFiles.length === 1) {
      const singleFile = planFiles[0];
      const sourcePath = normalizeNullableText(singleFile?.file_path);
      if (!sourcePath) {
        throw new TakeoffError({
          code: TakeoffErrorCode.TAKEOFF_FILE_REQUIRED,
          message: "Le jeu de plans du job ne référence aucun chemin source.",
          retryable: false,
          jobId: input.job.id,
          level: input.level,
        });
      }

      const { data, error } = await input.supabase.storage
        .from(PLAN_FILES_BUCKET)
        .download(sourcePath);

      if (error || !data) {
        throw new TakeoffError({
          code: TakeoffErrorCode.NOT_FOUND,
          message: "Impossible de télécharger le fichier source du jeu de plans.",
          details: error ?? { message: "Fichier source introuvable." },
          retryable: false,
          jobId: input.job.id,
          level: input.level,
        });
      }

      const downloadedBudget = inspectPlanSetResourceBudget(
        [
          {
            file_size_bytes: data.size,
            page_count: singleFile.page_count,
          },
        ],
        { maxPages: maxPdfPages }
      );
      if (downloadedBudget.violation) {
        throwPlanSetResourceBudgetError({
          budget: downloadedBudget,
          job: input.job,
          level: input.level,
          maxPages: maxPdfPages,
          phase: "download",
        });
      }
      const downloadedBytes = await data.arrayBuffer();
      const actualByteBudget = inspectPlanSetResourceBudget(
        [
          {
            file_size_bytes: downloadedBytes.byteLength,
            page_count: singleFile.page_count,
          },
        ],
        { maxPages: maxPdfPages }
      );
      if (actualByteBudget.violation) {
        throwPlanSetResourceBudgetError({
          budget: actualByteBudget,
          job: input.job,
          level: input.level,
          maxPages: maxPdfPages,
          phase: "download",
        });
      }

      const fileName =
        getPlanFileSourceLabel(singleFile) ??
        normalizeNullableText(input.job.source_file_name) ??
        "plan.pdf";
      const sourceDocument = getPlanFileSourceRef(singleFile);
      return {
        fileName,
        ...(sourceDocument ? { sourceDocument } : {}),
        mimeType:
          resolveTakeoffPdfMimeType({
            fileName,
            mimeType:
              normalizeNullableText(data.type) ??
              normalizeNullableText(singleFile.file_type),
          }) ?? "application/pdf",
        bytes: downloadedBytes,
      };
    }

    const actualBudgetFiles: PlanSetResourceBudgetFile[] = [];
    const validatedSources: Array<{
      document: PDFDocument;
      fileName: string;
      sourceDocument: TakeoffSourceDocumentRef | undefined;
      filePath: string;
      pageCount: number;
    }> = [];

    for (const planFile of planFiles) {
      const sourcePath = normalizeNullableText(planFile.file_path);
      if (!sourcePath) {
        throw new TakeoffError({
          code: TakeoffErrorCode.TAKEOFF_FILE_REQUIRED,
          message: "Un fichier du jeu de plans ne référence aucun chemin source.",
          retryable: false,
          jobId: input.job.id,
          level: input.level,
        });
      }

      const { data, error } = await input.supabase.storage
        .from(PLAN_FILES_BUCKET)
        .download(sourcePath);

      if (error || !data) {
        throw new TakeoffError({
          code: TakeoffErrorCode.NOT_FOUND,
          message: "Impossible de télécharger un fichier du jeu de plans.",
          details: error ?? { message: "Fichier source introuvable." },
          retryable: false,
          jobId: input.job.id,
          level: input.level,
        });
      }

      const actualBudgetEntry: PlanSetResourceBudgetFile = {
        file_size_bytes: data.size,
        page_count: null,
      };
      actualBudgetFiles.push(actualBudgetEntry);
      let actualBudget = inspectPlanSetResourceBudget(actualBudgetFiles, {
        maxPages: maxPdfPages,
      });
      if (actualBudget.violation) {
        throwPlanSetResourceBudgetError({
          budget: actualBudget,
          job: input.job,
          level: input.level,
          maxPages: maxPdfPages,
          phase: "download",
        });
      }

      const sourceBytes = await data.arrayBuffer();
      actualBudgetEntry.file_size_bytes = sourceBytes.byteLength;
      actualBudget = inspectPlanSetResourceBudget(actualBudgetFiles, {
        maxPages: maxPdfPages,
      });
      if (actualBudget.violation) {
        throwPlanSetResourceBudgetError({
          budget: actualBudget,
          job: input.job,
          level: input.level,
          maxPages: maxPdfPages,
          phase: "download",
        });
      }

      let sourcePdf: PDFDocument;
      try {
        sourcePdf = await PDFDocument.load(sourceBytes);
      } catch (pdfError) {
        throw new TakeoffError({
          code: TakeoffErrorCode.TAKEOFF_PDF_CORRUPTED,
          message:
            "Un fichier du jeu de plans est invalide ou protege. Reimportez un PDF exploitable avant de relancer.",
          details: pdfError,
          retryable: false,
          jobId: input.job.id,
          level: input.level,
        });
      }

      actualBudgetEntry.page_count = sourcePdf.getPageCount();
      actualBudget = inspectPlanSetResourceBudget(actualBudgetFiles, {
        maxPages: maxPdfPages,
      });
      if (actualBudget.violation) {
        throwPlanSetResourceBudgetError({
          budget: actualBudget,
          job: input.job,
          level: input.level,
          maxPages: maxPdfPages,
          phase: "pdf",
        });
      }

      validatedSources.push({
        document: sourcePdf,
        fileName:
          getPlanFileSourceLabel(planFile) ??
          `plan-${validatedSources.length + 1}.pdf`,
        sourceDocument: getPlanFileSourceRef(planFile),
        filePath: sourcePath,
        pageCount: sourcePdf.getPageCount(),
      });
    }

    // Delay allocation/copying until every object passes real byte/page budgets.
    const mergedPdf = await PDFDocument.create();
    const sourceFileNamesByPage: string[] = [];
    const sourceDocumentsByPage: Array<TakeoffSourceDocumentRef | undefined> = [];
    for (const source of validatedSources) {
      const copiedPages = await mergedPdf.copyPages(
        source.document,
        source.document.getPageIndices()
      );
      for (const copiedPage of copiedPages) {
        mergedPdf.addPage(copiedPage);
        sourceFileNamesByPage.push(source.fileName);
        sourceDocumentsByPage.push(source.sourceDocument);
      }
    }
    const everyPageReferenced = sourceDocumentsByPage.every(
      (ref): ref is TakeoffSourceDocumentRef => ref !== undefined
    );

    return {
      fileName: `plan-set-${planSetId}.pdf`,
      mimeType: "application/pdf",
      bytes: toArrayBuffer(await mergedPdf.save()),
      sourceFileNamesByPage,
      ...(everyPageReferenced
        ? { sourceDocumentsByPage: sourceDocumentsByPage as TakeoffSourceDocumentRef[] }
        : {}),
      sourcePlanFilePageCounts: validatedSources.map((source) => ({
        filePath: source.filePath,
        pageCount: source.pageCount,
      })),
    };
  }

  const sourcePath = normalizeNullableText(input.job.source_file_path);
  if (!sourcePath) {
    throw new TakeoffError({
      code: TakeoffErrorCode.TAKEOFF_FILE_REQUIRED,
      message: "Le job takeoff ne référence aucun fichier source.",
      retryable: false,
      jobId: input.job.id,
      level: input.level,
    });
  }

  const { data, error } = await input.supabase.storage
    .from(TAKEOFF_FILES_BUCKET)
    .download(sourcePath);

  if (error || !data) {
    const lowerMessage = (error?.message ?? "").toLowerCase();
    const isNotFound =
      lowerMessage.includes("not found") || lowerMessage.includes("introuvable");

    throw new TakeoffError({
      code: isNotFound ? TakeoffErrorCode.NOT_FOUND : TakeoffErrorCode.INTERNAL_ERROR,
      message: "Impossible de télécharger le fichier source takeoff.",
      details: error ?? { message: "Fichier source introuvable." },
      retryable: false,
      jobId: input.job.id,
      level: input.level,
    });
  }

  let bytes = await data.arrayBuffer();
  if (bytes.byteLength === 0) {
    throw new TakeoffError({
      code: TakeoffErrorCode.TAKEOFF_FILE_REQUIRED,
      message: "Le fichier source takeoff est vide.",
      retryable: false,
      jobId: input.job.id,
      level: input.level,
    });
  }

  // Le chemin est <empreinte>-<uuid>-<nom nettoyé> : il sert au type MIME, jamais de provenance.
  // Le libellé transmis est le nom reçu à la création du job (M1b).
  const jobFileName = normalizeNullableText(input.job.source_file_name);
  const storageFileName = getFileNameFromStoragePath(sourcePath, jobFileName ?? "upload");
  const mimeType =
    resolveTakeoffPdfMimeType({
      fileName: storageFileName,
      mimeType:
        normalizeNullableText(data.type) ??
        normalizeNullableText(input.job.source_file_type),
    }) ?? inferMimeTypeFromFilename(storageFileName);

  let sourcePageNumbersByPage: number[] | undefined;
  if (preparationSnapshot) {
    assertPreparedUploadBytes(input.job, preparationSnapshot, bytes);
    const pages = preparationSnapshot.preparation.sources.find((source) => source.active)?.pages ?? [];
    if (pages.length) {
      if (mimeType !== "application/pdf") {
        throw new TakeoffError({ code: TakeoffErrorCode.VALIDATION_ERROR, message: "La sélection de pages nécessite un PDF.", retryable: false, jobId: input.job.id });
      }
      const document = await PDFDocument.load(bytes);
      if (pages.some((page) => page > document.getPageCount())) {
        throw new TakeoffError({ code: TakeoffErrorCode.CONFLICT, message: "Une page confirmée n'existe pas dans le PDF.", retryable: false, jobId: input.job.id });
      }
      const selected = await PDFDocument.create();
      for (const page of await selected.copyPages(document, pages.map((page) => page - 1))) selected.addPage(page);
      bytes = toArrayBuffer(await selected.save());
      sourcePageNumbersByPage = pages;
    }
  }

  return {
    fileName: jobFileName?.normalize("NFC") ?? storageFileName,
    mimeType,
    bytes,
    sourceDocument: { kind: "job_upload", job_id: input.job.id },
    ...(preparationSnapshot ? { preparationSnapshot, sourcePageNumbersByPage } : {}),
  };
}
