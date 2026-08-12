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
import {
  inspectPlanSetResourceBudget,
  PLAN_SET_MAX_FILES,
  PLAN_SET_MAX_TOTAL_SIZE_BYTES,
  type PlanSetResourceBudget,
  type PlanSetResourceBudgetFile,
} from "@/lib/takeoff/plans";

type Supabase = Awaited<ReturnType<typeof getAuthenticatedContext>>["supabase"];

export type TakeoffSourceLevel = "A" | "B" | "C";

export type DownloadedTakeoffFile = {
  fileName: string;
  mimeType: string;
  bytes: ArrayBuffer;
  sourceFileNamesByPage?: string[];
  sourcePlanFilePageCounts?: Array<{
    filePath: string;
    pageCount: number;
  }>;
};

const TAKEOFF_FILES_BUCKET = "takeoff-files";
const PLAN_FILES_BUCKET = "plan-files";

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
  const planSetId = normalizeNullableText(input.job.plan_set_id);
  if (planSetId) {
    const { data: planFilesData, error: planFilesError } = await input.supabase
      .from("plan_files" as never)
      .select(
        "file_path, file_name, file_type, file_size_bytes, page_count" as never
      )
      .eq("tenant_id" as never, input.job.tenant_id as never)
      .eq("plan_set_id" as never, planSetId as never)
      .order("created_at" as never, { ascending: true });

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

    const planFiles = (planFilesData ?? []) as Array<{
      file_path?: string | null;
      file_name?: string | null;
      file_type?: string | null;
      file_size_bytes?: number | null;
      page_count?: number | null;
    }>;

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
          message: "Le jeu de plans du job ne reference aucun chemin source.",
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
          message: "Impossible de telecharger le fichier source du jeu de plans.",
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
        normalizeNullableText(singleFile.file_name) ??
        normalizeNullableText(input.job.source_file_name) ??
        "plan.pdf";
      return {
        fileName,
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
      filePath: string;
      pageCount: number;
    }> = [];

    for (const planFile of planFiles) {
      const sourcePath = normalizeNullableText(planFile.file_path);
      if (!sourcePath) {
        throw new TakeoffError({
          code: TakeoffErrorCode.TAKEOFF_FILE_REQUIRED,
          message: "Un fichier du jeu de plans ne reference aucun chemin source.",
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
          message: "Impossible de telecharger un fichier du jeu de plans.",
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
          normalizeNullableText(planFile.file_name) ??
          `plan-${validatedSources.length + 1}.pdf`,
        filePath: sourcePath,
        pageCount: sourcePdf.getPageCount(),
      });
    }

    // Delay allocation/copying until every object passes real byte/page budgets.
    const mergedPdf = await PDFDocument.create();
    const sourceFileNamesByPage: string[] = [];
    for (const source of validatedSources) {
      const copiedPages = await mergedPdf.copyPages(
        source.document,
        source.document.getPageIndices()
      );
      for (const copiedPage of copiedPages) {
        mergedPdf.addPage(copiedPage);
        sourceFileNamesByPage.push(source.fileName);
      }
    }

    return {
      fileName: `plan-set-${planSetId}.pdf`,
      mimeType: "application/pdf",
      bytes: toArrayBuffer(await mergedPdf.save()),
      sourceFileNamesByPage,
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
      message: "Le job takeoff ne reference aucun fichier source.",
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
      message: "Impossible de telecharger le fichier source takeoff.",
      details: error ?? { message: "Fichier source introuvable." },
      retryable: false,
      jobId: input.job.id,
      level: input.level,
    });
  }

  const bytes = await data.arrayBuffer();
  if (bytes.byteLength === 0) {
    throw new TakeoffError({
      code: TakeoffErrorCode.TAKEOFF_FILE_REQUIRED,
      message: "Le fichier source takeoff est vide.",
      retryable: false,
      jobId: input.job.id,
      level: input.level,
    });
  }

  const fallbackFileName =
    normalizeNullableText(input.job.source_file_name) ?? "upload";
  const fileName = getFileNameFromStoragePath(sourcePath, fallbackFileName);
  const mimeType =
    resolveTakeoffPdfMimeType({
      fileName,
      mimeType:
        normalizeNullableText(data.type) ??
        normalizeNullableText(input.job.source_file_type),
    }) ?? inferMimeTypeFromFilename(fileName);

  return {
    fileName,
    mimeType,
    bytes,
  };
}
