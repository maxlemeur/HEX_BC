import * as XLSX from "xlsx";
import { z } from "zod";

import { mapSupabaseError } from "@/lib/estimates/errors";
import { getAuthenticatedContext } from "@/lib/estimates/server";
import { resolveHeaderRowIndex } from "@/lib/imports/header-row";
import {
  logTakeoffAuditEvent,
  takeoffAuditMetadataBuilders,
} from "@/lib/takeoff/audit";
import {
  callGeminiStructured,
  type CallGeminiStructuredOptions,
  type CallGeminiStructuredResult,
} from "@/lib/takeoff/gemini-client";
import {
  TakeoffError,
  TakeoffErrorCode,
  toTakeoffError,
} from "@/lib/takeoff/errors";
import { getTakeoffLevelConfig, getTakeoffPrompt } from "@/lib/takeoff/prompts";
import { TakeoffExchangeSchema, TakeoffWarningSchema } from "@/lib/takeoff/schemas";
import type { TakeoffExchange, TakeoffWarning } from "@/lib/takeoff/types";

type Supabase = Awaited<ReturnType<typeof getAuthenticatedContext>>["supabase"];

type CallGeminiStructuredFn = <T>(
  options: CallGeminiStructuredOptions<T>
) => Promise<CallGeminiStructuredResult<T>>;

const TAKEOFF_FILES_BUCKET = "takeoff-files";
const TAKEOFF_LEVEL_A = "A";
const DEFAULT_GEMINI_TIMEOUT_MS = 60_000;
const MAX_GEMINI_TIMEOUT_MS = 180_000;

const TAKEOFF_JOB_PROCESSING_SELECT = [
  "id",
  "tenant_id",
  "estimate_version_id",
  "level",
  "status",
  "source_file_name",
  "source_file_path",
  "source_file_type",
  "prompt_version",
  "schema_version",
  "model",
  "thinking_level",
  "retry_count",
  "created_by",
].join(", ");

const takeoffJobProcessingSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  estimate_version_id: z.string().uuid(),
  level: z.string(),
  status: z.string(),
  source_file_name: z.string().nullable(),
  source_file_path: z.string().nullable(),
  source_file_type: z.string().nullable(),
  prompt_version: z.string().nullable(),
  schema_version: z.string().nullable(),
  model: z.string().nullable().optional(),
  thinking_level: z.string().nullable().optional(),
  retry_count: z.number().int().nonnegative().nullable().optional(),
  created_by: z.string().uuid().nullable().optional(),
});

type TakeoffJobProcessingRow = z.infer<typeof takeoffJobProcessingSchema> & {
  retry_count: number;
  created_by: string | null;
};

const takeoffResultIdSchema = z.object({
  id: z.string().uuid(),
});

type ParsedTakeoffSheet = {
  sheetName: string;
  headers: string[];
  rows: string[][];
  csvText: string;
  headerRowIndex: number;
};

type ParsedTakeoffWorkbook = {
  sheets: ParsedTakeoffSheet[];
  warnings: TakeoffWarning[];
};

type DownloadedTakeoffFile = {
  fileName: string;
  mimeType: string;
  bytes: ArrayBuffer;
};

type NormalizedTakeoffItemForInsert = {
  designation: string;
  quantity: number;
  unit: string;
  confidence: number | null;
  evidence: string | null;
  source_file_name: string | null;
  source_page: number | null;
  metadata: Record<string, unknown>;
};

type ProcessLevelAContext = {
  supabase: Supabase;
  tenantId: string | null;
  userId: string | null;
};

const UNIT_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  m: ["m", "metre", "metres", "meter", "meters", "m."],
  ml: ["ml", "m.l", "ml.", "metre lineaire", "metres lineaires", "linear meter"],
  m2: ["m2", "m²", "metre carre", "metres carres", "sqm", "sq m"],
  m3: ["m3", "m³", "metre cube", "metres cubes", "cbm", "cubic meter"],
  u: ["u", "unite", "unit", "piece", "pieces", "pcs", "pc", "ea"],
  kg: ["kg", "kilogramme", "kilogrammes", "kilo", "kilogram"],
  t: ["t", "tonne", "tonnes", "ton", "tons"],
  l: ["l", "litre", "litres", "liter", "liters"],
  h: ["h", "heure", "heures", "hour", "hours"],
  m2j: ["m2j", "m²/j", "m2/j"],
  forfait: ["forfait", "lot", "ens", "ensemble", "package"],
};

const UNIT_LOOKUP = new Map<string, string>();

for (const [canonical, aliases] of Object.entries(UNIT_SYNONYMS)) {
  UNIT_LOOKUP.set(toUnitToken(canonical), canonical);
  aliases.forEach((alias) => {
    UNIT_LOOKUP.set(toUnitToken(alias), canonical);
  });
}

export type ProcessLevelAOptions = {
  supabase?: Supabase;
  tenantId?: string;
  userId?: string;
  now?: () => Date;
  callGemini?: CallGeminiStructuredFn;
};

export type ProcessLevelAResult = {
  jobId: string;
  resultId: string;
  status: "completed";
  itemsCount: number;
  warningsCount: number;
  tokenCount: number;
  costCents: number;
  durationMs: number;
};

function toUnitToken(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeNullableText(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toCsvCell(value: string) {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, "\"\"")}"`;
}

function csvRowsToText(rows: string[][]) {
  return rows.map((row) => row.map(toCsvCell).join(",")).join("\n");
}

function normalizeHeaderCell(value: unknown, index: number) {
  const raw =
    typeof value === "string"
      ? value.trim()
      : value === null || value === undefined
      ? ""
      : String(value).trim();

  if (raw.length === 0) {
    return `column_${index + 1}`;
  }

  const normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized.length > 0 ? normalized : `column_${index + 1}`;
}

function dedupeHeaders(headers: string[]) {
  const collisions = new Map<string, number>();

  return headers.map((header) => {
    const nextCount = (collisions.get(header) ?? 0) + 1;
    collisions.set(header, nextCount);
    return nextCount === 1 ? header : `${header}_${nextCount}`;
  });
}

function normalizeSheetCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value).trim();
}

function rowHasValues(row: string[]) {
  return row.some((cell) => cell.trim().length > 0);
}

function getColumnCount(matrix: unknown[][]) {
  return matrix.reduce((max, row) => {
    if (!Array.isArray(row)) return max;
    return Math.max(max, row.length);
  }, 0);
}

function warning(input: {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
  itemIndex?: number;
  tableIndex?: number;
}): TakeoffWarning {
  return TakeoffWarningSchema.parse({
    code: input.code,
    message: input.message,
    severity: input.severity,
    item_index: input.itemIndex,
    table_index: input.tableIndex,
  });
}

function normalizeTakeoffUnit(input: {
  unit: string;
  itemIndex: number;
}): { normalizedUnit: string; warning?: TakeoffWarning } {
  const raw = input.unit.trim();
  const token = toUnitToken(raw);
  const mapped = UNIT_LOOKUP.get(token);

  if (mapped) {
    return { normalizedUnit: mapped };
  }

  const fallback = raw.length > 0 ? raw.toLowerCase() : "u";

  return {
    normalizedUnit: fallback,
    warning: warning({
      code: "UNIT_NORMALIZATION_UNKNOWN",
      message: `Unite '${raw || "vide"}' non reconnue, conservee telle quelle.`,
      severity: "warning",
      itemIndex: input.itemIndex,
    }),
  };
}

function parseTakeoffWorkbook(input: {
  bytes: ArrayBuffer;
  fileName: string;
}): ParsedTakeoffWorkbook {
  let workbook: XLSX.WorkBook;

  try {
    workbook = XLSX.read(input.bytes, {
      type: "array",
      raw: false,
      cellDates: false,
    });
  } catch (error) {
    throw new TakeoffError({
      code: TakeoffErrorCode.TAKEOFF_FILE_TYPE_INVALID,
      message: "Impossible de parser le fichier source takeoff.",
      details: error,
      retryable: false,
    });
  }

  const sheets: ParsedTakeoffSheet[] = [];
  const warnings: TakeoffWarning[] = [];

  workbook.SheetNames.forEach((sheetName, sheetIndex) => {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) {
      warnings.push(
        warning({
          code: "SHEET_NOT_FOUND",
          message: `La feuille ${sheetName} est introuvable dans le classeur.`,
          severity: "warning",
          tableIndex: sheetIndex,
        })
      );
      return;
    }

    const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      raw: false,
      defval: null,
      blankrows: true,
    }) as unknown[][];

    if (matrix.length === 0) {
      warnings.push(
        warning({
          code: "SHEET_EMPTY",
          message: `La feuille ${sheetName} est vide et a ete ignoree.`,
          severity: "warning",
          tableIndex: sheetIndex,
        })
      );
      return;
    }

    const columnCount = getColumnCount(matrix);
    if (columnCount === 0) {
      warnings.push(
        warning({
          code: "SHEET_NO_COLUMNS",
          message: `La feuille ${sheetName} ne contient aucune colonne exploitable.`,
          severity: "warning",
          tableIndex: sheetIndex,
        })
      );
      return;
    }

    const headerRowIndex = resolveHeaderRowIndex(matrix);
    const headerRow = Array.isArray(matrix[headerRowIndex])
      ? matrix[headerRowIndex]
      : [];
    const headers = dedupeHeaders(
      Array.from({ length: columnCount }, (_, index) =>
        normalizeHeaderCell(headerRow[index], index)
      )
    );
    const bodyRows = matrix.slice(headerRowIndex + 1);

    const rows = bodyRows
      .map((row) => {
        const values = Array.isArray(row) ? row : [];
        return Array.from({ length: columnCount }, (_, index) =>
          normalizeSheetCell(values[index])
        );
      })
      .filter((row) => rowHasValues(row));

    if (rows.length === 0) {
      warnings.push(
        warning({
          code: "SHEET_NO_DATA_ROWS",
          message: `La feuille ${sheetName} ne contient pas de donnees exploitables.`,
          severity: "warning",
          tableIndex: sheetIndex,
        })
      );
      return;
    }

    const csvText = csvRowsToText([headers, ...rows]);
    sheets.push({
      sheetName,
      headers,
      rows,
      csvText,
      headerRowIndex,
    });
  });

  if (sheets.length === 0) {
    throw new TakeoffError({
      code: TakeoffErrorCode.TAKEOFF_FILE_TYPE_INVALID,
      message: "Le fichier ne contient aucune feuille exploitable.",
      retryable: false,
    });
  }

  return { sheets, warnings };
}

function normalizeTakeoffExchange(input: {
  exchange: TakeoffExchange;
  sourceFileName: string | null;
  parseWarnings: TakeoffWarning[];
}): {
  exchange: TakeoffExchange;
  itemsForInsert: NormalizedTakeoffItemForInsert[];
} {
  const extraWarnings: TakeoffWarning[] = [...input.parseWarnings];
  const normalizedExchangeItems: TakeoffExchange["items"] = [];
  const itemsForInsert: NormalizedTakeoffItemForInsert[] = [];

  input.exchange.items.forEach((item, index) => {
    const sourceFileName =
      normalizeNullableText(item.source_file) ?? input.sourceFileName;
    const normalizedUnit = normalizeTakeoffUnit({
      unit: item.unit,
      itemIndex: index,
    });

    if (normalizedUnit.warning) {
      extraWarnings.push(normalizedUnit.warning);
    }

    const normalizedItem = {
      ...item,
      unit: normalizedUnit.normalizedUnit,
      category: normalizeNullableText(item.category) ?? null,
      source_file: sourceFileName ?? undefined,
    };

    normalizedExchangeItems.push(normalizedItem);
    itemsForInsert.push({
      designation: normalizedItem.designation,
      quantity: normalizedItem.quantity,
      unit: normalizedItem.unit,
      confidence: normalizedItem.confidence ?? null,
      evidence: normalizeNullableText(normalizedItem.evidence),
      source_file_name: sourceFileName,
      source_page: normalizedItem.source_page ?? null,
      metadata: {
        category: normalizedItem.category ?? null,
        original_unit: item.unit,
        normalized_unit: normalizedItem.unit,
        source_file: sourceFileName,
      },
    });
  });

  return {
    exchange: {
      ...input.exchange,
      items: normalizedExchangeItems,
      warnings: [...input.exchange.warnings, ...extraWarnings],
    },
    itemsForInsert,
  };
}

function inferMimeTypeFromFilename(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  return "application/octet-stream";
}

function getFileNameFromStoragePath(path: string, fallback: string) {
  const segments = path.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last) return fallback;
  return last.replace(/^[a-f0-9]{64}-/i, "") || fallback;
}

function resolveGeminiTimeoutMs() {
  const envValue = Number(process.env.TAKEOFF_GEMINI_TIMEOUT_MS ?? "");
  if (!Number.isFinite(envValue) || envValue <= 0) {
    return DEFAULT_GEMINI_TIMEOUT_MS;
  }
  return Math.min(Math.trunc(envValue), MAX_GEMINI_TIMEOUT_MS);
}

function parseTakeoffJobRow(data: unknown): TakeoffJobProcessingRow {
  const parsed = takeoffJobProcessingSchema.parse(data);

  return {
    ...parsed,
    retry_count: parsed.retry_count ?? 0,
    created_by: parsed.created_by ?? null,
  };
}

async function resolveContext(
  options: ProcessLevelAOptions
): Promise<ProcessLevelAContext> {
  if (options.supabase) {
    return {
      supabase: options.supabase,
      tenantId: options.tenantId ?? null,
      userId: options.userId ?? null,
    };
  }

  const authenticatedContext = await getAuthenticatedContext();
  return {
    supabase: authenticatedContext.supabase,
    tenantId: options.tenantId ?? authenticatedContext.tenantId,
    userId: options.userId ?? authenticatedContext.userId,
  };
}

async function getTakeoffJobForProcessing(input: {
  supabase: Supabase;
  jobId: string;
  tenantId: string | null;
}): Promise<TakeoffJobProcessingRow> {
  let query = input.supabase
    .from("takeoff_jobs" as never)
    .select(TAKEOFF_JOB_PROCESSING_SELECT as never)
    .eq("id" as never, input.jobId as never);

  if (input.tenantId) {
    query = query.eq("tenant_id" as never, input.tenantId as never);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de charger le job takeoff."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.jobId,
        level: TAKEOFF_LEVEL_A,
      }
    );
  }

  if (!data) {
    throw new TakeoffError({
      code: TakeoffErrorCode.TAKEOFF_JOB_NOT_FOUND,
      message: "Job takeoff introuvable.",
      retryable: false,
      jobId: input.jobId,
      level: TAKEOFF_LEVEL_A,
    });
  }

  return parseTakeoffJobRow(data);
}

async function markJobAsProcessing(input: {
  supabase: Supabase;
  job: TakeoffJobProcessingRow;
  tenantId: string | null;
  startedAtIso: string;
  model: string;
  thinkingLevel: string;
  promptVersion: string;
}): Promise<TakeoffJobProcessingRow> {
  const retryCount =
    input.job.status === "failed" ? input.job.retry_count + 1 : input.job.retry_count;

  let query = input.supabase
    .from("takeoff_jobs" as never)
    .update({
      status: "processing",
      started_at: input.startedAtIso,
      completed_at: null,
      error_code: null,
      error_message: null,
      model: input.model,
      thinking_level: input.thinkingLevel,
      prompt_version: input.promptVersion,
      retry_count: retryCount,
    } as never)
    .eq("id" as never, input.job.id as never)
    .in("status" as never, ["pending", "failed"] as never)
    .select(TAKEOFF_JOB_PROCESSING_SELECT as never);

  if (input.tenantId) {
    query = query.eq("tenant_id" as never, input.tenantId as never);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(
        error,
        "Impossible de basculer le job en traitement (processing)."
      ),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.job.id,
        level: TAKEOFF_LEVEL_A,
      }
    );
  }

  if (!data) {
    throw new TakeoffError({
      code: TakeoffErrorCode.CONFLICT,
      message: `Le job ne peut pas etre traite depuis le statut '${input.job.status}'.`,
      details: {
        current_status: input.job.status,
      },
      retryable: false,
      jobId: input.job.id,
      level: TAKEOFF_LEVEL_A,
    });
  }

  return parseTakeoffJobRow(data);
}

async function updateJobAsCompleted(input: {
  supabase: Supabase;
  job: TakeoffJobProcessingRow;
  tenantId: string | null;
  completedAtIso: string;
  tokenCount: number;
  costCents: number;
  durationMs: number;
  model: string;
  thinkingLevel: string;
  promptVersion: string;
}) {
  let query = input.supabase
    .from("takeoff_jobs" as never)
    .update({
      status: "completed",
      completed_at: input.completedAtIso,
      token_count: input.tokenCount,
      cost_cents: input.costCents,
      duration_ms: input.durationMs,
      model: input.model,
      thinking_level: input.thinkingLevel,
      prompt_version: input.promptVersion,
      error_code: null,
      error_message: null,
    } as never)
    .eq("id" as never, input.job.id as never)
    .eq("status" as never, "processing" as never);

  if (input.tenantId) {
    query = query.eq("tenant_id" as never, input.tenantId as never);
  }

  const { error } = await query;

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de finaliser le job takeoff."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.job.id,
        level: TAKEOFF_LEVEL_A,
      }
    );
  }
}

async function updateJobAsFailed(input: {
  supabase: Supabase;
  job: TakeoffJobProcessingRow;
  tenantId: string | null;
  completedAtIso: string;
  durationMs: number;
  error: TakeoffError;
}) {
  let query = input.supabase
    .from("takeoff_jobs" as never)
    .update({
      status: "failed",
      completed_at: input.completedAtIso,
      duration_ms: input.durationMs,
      error_code: input.error.code,
      error_message: input.error.message,
    } as never)
    .eq("id" as never, input.job.id as never)
    .eq("status" as never, "processing" as never);

  if (input.tenantId) {
    query = query.eq("tenant_id" as never, input.tenantId as never);
  }

  const { error } = await query;

  if (error) {
    console.error("Impossible de marquer le job takeoff en echec.", {
      job_id: input.job.id,
      tenant_id: input.tenantId,
      error,
    });
  }
}

async function downloadTakeoffSourceFile(input: {
  supabase: Supabase;
  job: TakeoffJobProcessingRow;
}): Promise<DownloadedTakeoffFile> {
  const sourcePath = normalizeNullableText(input.job.source_file_path);
  if (!sourcePath) {
    throw new TakeoffError({
      code: TakeoffErrorCode.TAKEOFF_FILE_REQUIRED,
      message: "Le job takeoff ne reference aucun fichier source.",
      retryable: false,
      jobId: input.job.id,
      level: TAKEOFF_LEVEL_A,
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
      code: isNotFound
        ? TakeoffErrorCode.NOT_FOUND
        : TakeoffErrorCode.INTERNAL_ERROR,
      message: "Impossible de telecharger le fichier source takeoff.",
      details: error ?? { message: "Fichier source introuvable." },
      retryable: false,
      jobId: input.job.id,
      level: TAKEOFF_LEVEL_A,
    });
  }

  const bytes = await data.arrayBuffer();
  if (bytes.byteLength === 0) {
    throw new TakeoffError({
      code: TakeoffErrorCode.TAKEOFF_FILE_REQUIRED,
      message: "Le fichier source takeoff est vide.",
      retryable: false,
      jobId: input.job.id,
      level: TAKEOFF_LEVEL_A,
    });
  }

  const fallbackFileName = normalizeNullableText(input.job.source_file_name) ?? "upload";
  const fileName = getFileNameFromStoragePath(sourcePath, fallbackFileName);
  const mimeType =
    normalizeNullableText(data.type) ??
    normalizeNullableText(input.job.source_file_type) ??
    inferMimeTypeFromFilename(fileName);

  return {
    fileName,
    mimeType,
    bytes,
  };
}

async function clearPreviousResultsForJob(input: {
  supabase: Supabase;
  job: TakeoffJobProcessingRow;
}) {
  const { error: deleteItemsError } = await input.supabase
    .from("takeoff_items" as never)
    .delete()
    .eq("tenant_id" as never, input.job.tenant_id as never)
    .eq("job_id" as never, input.job.id as never);

  if (deleteItemsError) {
    throw toTakeoffError(
      mapSupabaseError(
        deleteItemsError,
        "Impossible de nettoyer les items takeoff precedents."
      ),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.job.id,
        level: TAKEOFF_LEVEL_A,
      }
    );
  }

  const { error: deleteResultsError } = await input.supabase
    .from("takeoff_results" as never)
    .delete()
    .eq("tenant_id" as never, input.job.tenant_id as never)
    .eq("job_id" as never, input.job.id as never);

  if (deleteResultsError) {
    throw toTakeoffError(
      mapSupabaseError(
        deleteResultsError,
        "Impossible de nettoyer les resultats takeoff precedents."
      ),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.job.id,
        level: TAKEOFF_LEVEL_A,
      }
    );
  }
}

async function persistTakeoffResultAndItems(input: {
  supabase: Supabase;
  job: TakeoffJobProcessingRow;
  exchange: TakeoffExchange;
  itemsForInsert: NormalizedTakeoffItemForInsert[];
  tokenCount: number;
  costCents: number;
  durationMs: number;
  rawResponse: unknown;
  providerMeta: Record<string, unknown>;
}): Promise<{
  resultId: string;
  itemsCount: number;
  warningsCount: number;
}> {
  await clearPreviousResultsForJob({
    supabase: input.supabase,
    job: input.job,
  });

  const { data: insertedResult, error: insertResultError } = await input.supabase
    .from("takeoff_results" as never)
    .insert({
      tenant_id: input.job.tenant_id,
      job_id: input.job.id,
      extracted_json: input.exchange,
      warnings: input.exchange.warnings,
      tables: input.exchange.tables ?? [],
      provider_meta: input.providerMeta,
      raw_response: input.rawResponse,
      confidence: input.exchange.confidence ?? null,
      token_count: input.tokenCount,
      cost_cents: input.costCents,
      duration_ms: input.durationMs,
    } as never)
    .select("id" as never)
    .single();

  if (insertResultError || !insertedResult) {
    throw toTakeoffError(
      mapSupabaseError(
        insertResultError ?? {
          code: "NOT_FOUND",
          details: null,
          hint: null,
          message: "Insertion takeoff_results invalide.",
        },
        "Impossible de persister le resultat takeoff."
      ),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.job.id,
        level: TAKEOFF_LEVEL_A,
      }
    );
  }

  const parsedResult = takeoffResultIdSchema.parse(insertedResult);
  const resultId = parsedResult.id;

  if (input.itemsForInsert.length > 0) {
    const { error: insertItemsError } = await input.supabase
      .from("takeoff_items" as never)
      .insert(
        input.itemsForInsert.map((item) => ({
          tenant_id: input.job.tenant_id,
          job_id: input.job.id,
          result_id: resultId,
          designation: item.designation,
          quantity: item.quantity,
          unit: item.unit,
          confidence: item.confidence,
          evidence: item.evidence,
          source_file_name: item.source_file_name,
          source_page: item.source_page,
          metadata: item.metadata,
        })) as never
      );

    if (insertItemsError) {
      throw toTakeoffError(
        mapSupabaseError(insertItemsError, "Impossible de persister les items takeoff."),
        {
          fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
          retryable: false,
          jobId: input.job.id,
          level: TAKEOFF_LEVEL_A,
        }
      );
    }
  }

  return {
    resultId,
    itemsCount: input.itemsForInsert.length,
    warningsCount: input.exchange.warnings.length,
  };
}

function extractRawResponseFromTakeoffError(error: TakeoffError): unknown {
  const details = error.details;
  if (!details || typeof details !== "object") {
    return details ?? null;
  }

  const record = details as Record<string, unknown>;

  if ("provider_details" in record) {
    return record.provider_details;
  }

  if ("cause" in record) {
    return record.cause;
  }

  return record;
}

async function persistFailureSnapshotIfNeeded(input: {
  supabase: Supabase;
  job: TakeoffJobProcessingRow;
  error: TakeoffError;
  durationMs: number;
  model: string;
  promptVersion: string;
  thinkingLevel: string;
}) {
  const rawResponse = extractRawResponseFromTakeoffError(input.error);
  if (rawResponse === undefined || rawResponse === null) {
    return;
  }

  try {
    await clearPreviousResultsForJob({
      supabase: input.supabase,
      job: input.job,
    });

    await input.supabase.from("takeoff_results" as never).insert({
      tenant_id: input.job.tenant_id,
      job_id: input.job.id,
      extracted_json: {},
      warnings: [
        warning({
          code: "PROCESSING_FAILED",
          message: input.error.message,
          severity: input.error.retryable ? "warning" : "error",
        }),
      ],
      tables: [],
      provider_meta: {
        status: "failed",
        model: input.model,
        prompt_version: input.promptVersion,
        thinking_level: input.thinkingLevel,
        error_code: input.error.code,
      },
      raw_response: rawResponse,
      token_count: 0,
      cost_cents: 0,
      duration_ms: input.durationMs,
    } as never);
  } catch (snapshotError) {
    console.error("Impossible de persister le snapshot d'echec takeoff.", {
      job_id: input.job.id,
      error: snapshotError,
    });
  }
}

function buildPromptSourceHint(fileName: string, sheets: ParsedTakeoffSheet[]) {
  const summary = sheets
    .slice(0, 8)
    .map((sheet) => `${sheet.sheetName}(${sheet.rows.length})`)
    .join(", ");

  if (summary.length === 0) {
    return fileName;
  }

  return `${fileName} | sheets: ${summary}`;
}

async function logProcessingAuditEvent(input: {
  supabase: Supabase;
  userId: string | null;
  job: TakeoffJobProcessingRow;
}) {
  if (!input.userId) return;

  await logTakeoffAuditEvent({
    supabase: input.supabase,
    tenantId: input.job.tenant_id,
    userId: input.userId,
    jobId: input.job.id,
    estimateVersionId: input.job.estimate_version_id,
    action: "takeoff.job.processing",
    metadata: takeoffAuditMetadataBuilders["takeoff.job.processing"]({
      attempt: input.job.retry_count + 1,
      reason: input.job.retry_count > 0 ? "retry" : null,
    }),
    mode: "non-blocking",
  });
}

async function logCompletedAuditEvent(input: {
  supabase: Supabase;
  userId: string | null;
  job: TakeoffJobProcessingRow;
  resultId: string;
  itemsCount: number;
  warningsCount: number;
  durationMs: number;
}) {
  if (!input.userId) return;

  await logTakeoffAuditEvent({
    supabase: input.supabase,
    tenantId: input.job.tenant_id,
    userId: input.userId,
    jobId: input.job.id,
    estimateVersionId: input.job.estimate_version_id,
    action: "takeoff.job.completed",
    metadata: takeoffAuditMetadataBuilders["takeoff.job.completed"]({
      result_id: input.resultId,
      items_total: input.itemsCount,
      warnings_total: input.warningsCount,
      duration_ms: input.durationMs,
    }),
    mode: "non-blocking",
  });
}

async function logFailedAuditEvent(input: {
  supabase: Supabase;
  userId: string | null;
  job: TakeoffJobProcessingRow;
  error: TakeoffError;
}) {
  if (!input.userId) return;

  await logTakeoffAuditEvent({
    supabase: input.supabase,
    tenantId: input.job.tenant_id,
    userId: input.userId,
    jobId: input.job.id,
    estimateVersionId: input.job.estimate_version_id,
    action: "takeoff.job.failed",
    metadata: takeoffAuditMetadataBuilders["takeoff.job.failed"]({
      attempt: input.job.retry_count + 1,
      error_code: input.error.code,
      error_message: input.error.message,
      retryable: input.error.retryable,
    }),
    mode: "non-blocking",
  });
}

export async function processLevelA(
  jobId: string,
  options: ProcessLevelAOptions = {}
): Promise<ProcessLevelAResult> {
  const normalizedJobId = jobId.trim();
  if (normalizedJobId.length === 0) {
    throw new TakeoffError({
      code: TakeoffErrorCode.BAD_REQUEST,
      message: "jobId est requis.",
      retryable: false,
      level: TAKEOFF_LEVEL_A,
    });
  }

  const context = await resolveContext(options);
  const callGemini = options.callGemini ?? callGeminiStructured;
  const now = options.now ?? (() => new Date());
  const levelConfig = getTakeoffLevelConfig(TAKEOFF_LEVEL_A);
  const processingStartedAt = now();

  let job: TakeoffJobProcessingRow | null = null;
  let enteredProcessing = false;

  try {
    job = await getTakeoffJobForProcessing({
      supabase: context.supabase,
      jobId: normalizedJobId,
      tenantId: context.tenantId,
    });

    if (job.level !== TAKEOFF_LEVEL_A) {
      throw new TakeoffError({
        code: TakeoffErrorCode.TAKEOFF_LEVEL_UNSUPPORTED,
        message: "Le processor Level A ne peut traiter que les jobs de niveau A.",
        retryable: false,
        jobId: normalizedJobId,
        level: TAKEOFF_LEVEL_A,
      });
    }

    job = await markJobAsProcessing({
      supabase: context.supabase,
      job,
      tenantId: context.tenantId,
      startedAtIso: processingStartedAt.toISOString(),
      model: levelConfig.model,
      thinkingLevel: levelConfig.thinkingLevel,
      promptVersion: levelConfig.promptVersion,
    });
    enteredProcessing = true;

    const actorUserId = context.userId ?? job.created_by;
    await logProcessingAuditEvent({
      supabase: context.supabase,
      userId: actorUserId,
      job,
    });

    const sourceFile = await downloadTakeoffSourceFile({
      supabase: context.supabase,
      job,
    });
    const parsedWorkbook = parseTakeoffWorkbook({
      bytes: sourceFile.bytes,
      fileName: sourceFile.fileName,
    });

    const prompt = getTakeoffPrompt(TAKEOFF_LEVEL_A, {
      fileType: sourceFile.mimeType,
      schemaVersion: normalizeNullableText(job.schema_version) ?? "v1",
      sourceHint: buildPromptSourceHint(sourceFile.fileName, parsedWorkbook.sheets),
    });

    const geminiResult = await callGemini<TakeoffExchange>({
      prompt,
      schema: TakeoffExchangeSchema,
      files: parsedWorkbook.sheets.map((sheet) => ({
        data: Buffer.from(sheet.csvText, "utf8").toString("base64"),
        mimeType: "text/csv",
      })),
      thinkingLevel: levelConfig.thinkingLevel,
      timeoutMs: resolveGeminiTimeoutMs(),
      context: {
        jobId: job.id,
        tenantId: job.tenant_id,
        level: TAKEOFF_LEVEL_A,
        promptVersion: levelConfig.promptVersion,
        model: levelConfig.model,
      },
    });

    const strictExchange = TakeoffExchangeSchema.parse(geminiResult.data);
    const normalized = normalizeTakeoffExchange({
      exchange: strictExchange,
      sourceFileName: normalizeNullableText(job.source_file_name),
      parseWarnings: parsedWorkbook.warnings,
    });

    const persisted = await persistTakeoffResultAndItems({
      supabase: context.supabase,
      job,
      exchange: normalized.exchange,
      itemsForInsert: normalized.itemsForInsert,
      tokenCount: geminiResult.tokenCount,
      costCents: geminiResult.costCents,
      durationMs: geminiResult.durationMs,
      rawResponse: null,
      providerMeta: {
        model: geminiResult.model,
        prompt_version: geminiResult.promptVersion,
        thinking_level: levelConfig.thinkingLevel,
        file_type: sourceFile.mimeType,
        source_file_name: sourceFile.fileName,
        sheet_count: parsedWorkbook.sheets.length,
        sheets: parsedWorkbook.sheets.map((sheet) => ({
          name: sheet.sheetName,
          header_row_index: sheet.headerRowIndex,
          rows: sheet.rows.length,
          columns: sheet.headers.length,
        })),
      },
    });

    const completedAt = now();
    const totalDurationMs = Math.max(
      geminiResult.durationMs,
      completedAt.getTime() - processingStartedAt.getTime()
    );

    await updateJobAsCompleted({
      supabase: context.supabase,
      job,
      tenantId: context.tenantId,
      completedAtIso: completedAt.toISOString(),
      tokenCount: geminiResult.tokenCount,
      costCents: geminiResult.costCents,
      durationMs: totalDurationMs,
      model: geminiResult.model,
      thinkingLevel: levelConfig.thinkingLevel,
      promptVersion: geminiResult.promptVersion,
    });

    await logCompletedAuditEvent({
      supabase: context.supabase,
      userId: actorUserId,
      job,
      resultId: persisted.resultId,
      itemsCount: persisted.itemsCount,
      warningsCount: persisted.warningsCount,
      durationMs: totalDurationMs,
    });

    return {
      jobId: job.id,
      resultId: persisted.resultId,
      status: "completed",
      itemsCount: persisted.itemsCount,
      warningsCount: persisted.warningsCount,
      tokenCount: geminiResult.tokenCount,
      costCents: geminiResult.costCents,
      durationMs: totalDurationMs,
    };
  } catch (error) {
    const mappedError = toTakeoffError(error, {
      fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
      jobId: normalizedJobId,
      level: TAKEOFF_LEVEL_A,
    });

    if (enteredProcessing && job) {
      const completedAt = now();
      const durationMs = Math.max(0, completedAt.getTime() - processingStartedAt.getTime());

      await persistFailureSnapshotIfNeeded({
        supabase: context.supabase,
        job,
        error: mappedError,
        durationMs,
        model: levelConfig.model,
        promptVersion: levelConfig.promptVersion,
        thinkingLevel: levelConfig.thinkingLevel,
      });

      await updateJobAsFailed({
        supabase: context.supabase,
        job,
        tenantId: context.tenantId,
        completedAtIso: completedAt.toISOString(),
        durationMs,
        error: mappedError,
      });

      await logFailedAuditEvent({
        supabase: context.supabase,
        userId: context.userId ?? job.created_by,
        job,
        error: mappedError,
      });
    }

    throw mappedError;
  }
}
