import * as XLSX from "xlsx";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";

import { mapSupabaseError } from "@/lib/estimates/errors";
import { getAuthenticatedContext } from "@/lib/estimates/server";
import { resolveHeaderRowIndex } from "@/lib/imports/header-row";
import {
  buildPdfChunks,
  createPdfChunkBytes,
  getPdfPageCount,
  mergeTakeoffChunkExchanges,
  type TakeoffPdfChunk,
} from "@/lib/takeoff/chunking";
import {
  logTakeoffAuditEvent,
  takeoffAuditMetadataBuilders,
} from "@/lib/takeoff/audit";
import {
  callGeminiStructured,
  pollGeminiBatchStructuredOnce,
  submitGeminiBatchStructured,
  type CallGeminiStructuredOptions,
  type CallGeminiStructuredResult,
  type GeminiBatchLifecycleEvent,
  type GeminiTokenUsageBreakdown,
  type GeminiThinkingLevel,
} from "@/lib/takeoff/gemini-client";
import {
  TakeoffError,
  TakeoffErrorCode,
  toTakeoffError,
} from "@/lib/takeoff/errors";
import {
  buildTakeoffPdfNotInterpretableMessage,
  inspectTakeoffPdfBytes,
  resolveTakeoffPdfMimeType,
} from "@/lib/takeoff/pdf-validation";
import {
  getTakeoffChunkingConfigForTenant,
  getTakeoffEscalationConfigForTenant,
  getTakeoffGeminiDeliveryConfigForTenant,
  getTakeoffLevelCProcessingConfigForTenant,
  type TakeoffEscalationConfig,
} from "@/lib/takeoff/feature-flags";
import {
  getTakeoffEscalationModelConfig,
  getTakeoffLevelConfig,
  getTakeoffPrompt,
  type TakeoffEscalationModelConfig,
  type TakeoffModelConfig,
} from "@/lib/takeoff/prompts";
import {
  TakeoffChunkExchangeSchema,
  TakeoffExchangeSchema,
  TakeoffWarningSchema,
} from "@/lib/takeoff/schemas";
import {
  normalizeGeminiProviderBatchState,
  normalizeTakeoffProcessingStrategy,
  persistTakeoffProviderBatchSnapshot,
  resolveExecutableTakeoffProcessingStrategy,
  resolveTakeoffProcessingStrategy,
} from "@/lib/takeoff/provider-batch";
import type {
  TakeoffExchange,
  TakeoffProcessingStrategy,
  TakeoffProviderBatchState,
  TakeoffWarning,
} from "@/lib/takeoff/types";
import { toUnitToken } from "@/lib/takeoff/units";

type Supabase = Awaited<ReturnType<typeof getAuthenticatedContext>>["supabase"];

type CallGeminiStructuredFn = <T>(
  options: CallGeminiStructuredOptions<T>
) => Promise<CallGeminiStructuredResult<T>>;

type SubmitGeminiBatchStructuredFn = typeof submitGeminiBatchStructured;
type PollGeminiBatchStructuredOnceFn = typeof pollGeminiBatchStructuredOnce;

const TAKEOFF_FILES_BUCKET = "takeoff-files";
const PLAN_FILES_BUCKET = "plan-files";
const TAKEOFF_LEVEL_A = "A";
const TAKEOFF_LEVEL_B = "B";
const TAKEOFF_LEVEL_C = "C";
const DEFAULT_GEMINI_TIMEOUT_MS = 60_000;
const MAX_GEMINI_TIMEOUT_MS = 180_000;
const ATOMIC_PERSISTENCE_ROLLBACK_MARKER = "atomic_persistence_rollback_applied";

const TAKEOFF_JOB_PROCESSING_SELECT = [
  "id",
  "tenant_id",
  "estimate_version_id",
  "level",
  "status",
  "source_file_name",
  "source_file_path",
  "source_file_type",
  "plan_set_id",
  "prompt_version",
  "schema_version",
  "model",
  "thinking_level",
  "processing_strategy",
  "provider_batch_id",
  "provider_batch_state",
  "provider_batch_updated_at",
  "provider_reconcile_due_at",
  "provider_reconcile_attempt_count",
  "provider_reconcile_lease_token",
  "provider_reconcile_lease_expires_at",
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
  plan_set_id: z.string().uuid().nullable().optional(),
  prompt_version: z.string().nullable(),
  schema_version: z.string().nullable(),
  model: z.string().nullable().optional(),
  thinking_level: z.string().nullable().optional(),
  processing_strategy: z.string().nullable().optional(),
  provider_batch_id: z.string().nullable().optional(),
  provider_batch_state: z.string().nullable().optional(),
  provider_batch_updated_at: z.string().nullable().optional(),
  provider_reconcile_due_at: z.string().nullable().optional(),
  provider_reconcile_attempt_count: z.number().int().nonnegative().nullable().optional(),
  provider_reconcile_lease_token: z.string().uuid().nullable().optional(),
  provider_reconcile_lease_expires_at: z.string().nullable().optional(),
  retry_count: z.number().int().nonnegative().nullable().optional(),
  created_by: z.string().uuid().nullable().optional(),
});

type TakeoffJobProcessingRow = z.infer<typeof takeoffJobProcessingSchema> & {
  retry_count: number;
  created_by: string | null;
  processing_strategy: TakeoffProcessingStrategy | null;
  provider_batch_id: string | null;
  provider_batch_state: TakeoffProviderBatchState | null;
  provider_batch_updated_at: string | null;
  provider_reconcile_due_at: string | null;
  provider_reconcile_attempt_count: number;
  provider_reconcile_lease_token: string | null;
  provider_reconcile_lease_expires_at: string | null;
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
  sourceFileNamesByPage?: string[];
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

type ProcessLevelContext = {
  supabase: Supabase;
  tenantId: string | null;
  userId: string | null;
};

type GeminiDeliveryMode = "sync" | "batch";

type ProcessableTakeoffLevel =
  | typeof TAKEOFF_LEVEL_A
  | typeof TAKEOFF_LEVEL_B
  | typeof TAKEOFF_LEVEL_C;

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
  submitGeminiBatch?: SubmitGeminiBatchStructuredFn;
  pollGeminiBatchOnce?: PollGeminiBatchStructuredOnceFn;
};

type ProcessLevelCompletedResult = {
  jobId: string;
  resultId: string;
  status: "completed";
  itemsCount: number;
  warningsCount: number;
  tokenCount: number;
  costCents: number;
  durationMs: number;
};

type ProcessLevelSubmittedToProviderResult = {
  jobId: string;
  status: "submitted_to_provider";
  providerBatchId: string;
  providerBatchStateRaw: string;
  durationMs: number;
};

type ProcessLevelAwaitingProviderResult = {
  jobId: string;
  status: "awaiting_provider_result";
  providerBatchId: string;
  providerBatchStateRaw: string;
  durationMs: number;
};

export type ProcessLevelAResult =
  | ProcessLevelCompletedResult
  | ProcessLevelSubmittedToProviderResult;

export type ProcessLevelBOptions = ProcessLevelAOptions;
export type ProcessLevelCOptions = ProcessLevelAOptions;

export type ProcessLevelBResult = ProcessLevelCompletedResult & {
  tablesCount: number;
};

export type ProcessLevelCMetricsSummary = {
  inputTokens: number;
  reasoningTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type ProcessLevelCResult = ProcessLevelBResult & {
  chunksCount: number;
  pageCount: number;
  metricsSummary?: ProcessLevelCMetricsSummary;
};

type ProcessLevelInternalCompletedResult = ProcessLevelCompletedResult & {
  tablesCount?: number;
  chunksCount?: number;
  pageCount?: number;
  metricsSummary?: ProcessLevelCMetricsSummary;
};

type ProcessLevelInternalResult =
  | ProcessLevelInternalCompletedResult
  | ProcessLevelSubmittedToProviderResult;

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

/**
 * Build a lookup that maps (source_page, item_index_within_page) → { table_index, row_index }
 * for Level B exchanges. Items are correlated to tables by matching source_page to table.page
 * and their sequential position within that page to the table row order.
 */
function buildLevelBTableMapping(tables: TakeoffExchange["tables"]) {
  if (!tables || tables.length === 0) return null;

  // Track cumulative item counter per page to correlate sequential items
  const pageItemCounters = new Map<number, number>();
  // Map: "page:itemIndexInPage" → { table_index, row_index }
  const mapping = new Map<string, { table_index: number; row_index: number }>();

  tables.forEach((table, tableIndex) => {
    const pageItemsBefore = pageItemCounters.get(table.page) ?? 0;
    table.rows.forEach((row, rowOffset) => {
      const key = `${table.page}:${pageItemsBefore + rowOffset}`;
      mapping.set(key, { table_index: tableIndex, row_index: row.row_index });
    });
    pageItemCounters.set(table.page, pageItemsBefore + table.rows.length);
  });

  return { mapping, pageItemCounters: new Map<number, number>() };
}

function normalizeTableTextToken(value: string | null | undefined) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function buildLevelBTableSignature(table: NonNullable<TakeoffExchange["tables"]>[number]) {
  const headersSignature = table.headers
    .map((header) => normalizeTableTextToken(header))
    .join("||");
  const rowsSignature = table.rows
    .map((row) => {
      const cellsSignature = row.cells
        .map((cell) => normalizeTableTextToken(cell))
        .join("|");
      return `${row.row_index}:${cellsSignature}`;
    })
    .join("##");

  return `${table.page}::${normalizeTableTextToken(table.title)}::${headersSignature}::${rowsSignature}`;
}

function dedupeLevelBTables(tables: TakeoffExchange["tables"]) {
  if (!tables || tables.length === 0) {
    return tables;
  }

  const seen = new Set<string>();
  const deduped: NonNullable<TakeoffExchange["tables"]> = [];

  tables.forEach((table) => {
    const signature = buildLevelBTableSignature(table);
    if (seen.has(signature)) {
      return;
    }
    seen.add(signature);
    deduped.push(table);
  });

  return deduped.length > 0 ? deduped : undefined;
}

function normalizeTakeoffExchange(input: {
  exchange: TakeoffExchange;
  sourceFileName: string | null;
  sourceFileNamesByPage?: readonly string[];
  parseWarnings: TakeoffWarning[];
}): {
  exchange: TakeoffExchange;
  itemsForInsert: NormalizedTakeoffItemForInsert[];
} {
  const extraWarnings: TakeoffWarning[] = [...input.parseWarnings];
  const normalizedExchangeItems: TakeoffExchange["items"] = [];
  const itemsForInsert: NormalizedTakeoffItemForInsert[] = [];

  const isLevelB = input.exchange.metadata.level === "B";
  const tableMapping = isLevelB
    ? buildLevelBTableMapping(input.exchange.tables)
    : null;
  // Runtime counter per page for matching items to table rows
  const pageItemCounters = new Map<number, number>();

  input.exchange.items.forEach((item, index) => {
    const pageMappedSourceFileName =
      item.source_page === undefined || item.source_page === null || !input.sourceFileNamesByPage
        ? null
        : input.sourceFileNamesByPage[item.source_page - 1] ?? null;
    const sourceFileName =
      normalizeNullableText(item.source_file) ??
      normalizeNullableText(pageMappedSourceFileName) ??
      input.sourceFileName;
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

    // Level B: resolve table_index / row_index from page position
    let tableMeta: { table_index: number; row_index: number } | undefined;
    if (tableMapping && normalizedItem.source_page != null) {
      const page = normalizedItem.source_page;
      const posInPage = pageItemCounters.get(page) ?? 0;
      pageItemCounters.set(page, posInPage + 1);
      const found = tableMapping.mapping.get(`${page}:${posInPage}`);
      if (found) {
        tableMeta = found;
      }
    }

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
        ...(tableMeta != null
          ? { table_index: tableMeta.table_index, row_index: tableMeta.row_index }
          : {}),
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
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

function isPdfMimeType(mimeType: string) {
  const mediaType = mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mediaType === "application/pdf";
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

function normalizeGeminiThinkingLevel(
  value: string | null | undefined,
  fallback: GeminiThinkingLevel
): GeminiThinkingLevel {
  return value === "low" || value === "medium" || value === "high" ? value : fallback;
}

function parseTakeoffJobRow(data: unknown): TakeoffJobProcessingRow {
  const parsed = takeoffJobProcessingSchema.parse(data);

  return {
    ...parsed,
    processing_strategy: normalizeTakeoffProcessingStrategy(
      parsed.processing_strategy
    ),
    provider_batch_id: parsed.provider_batch_id ?? null,
    provider_batch_state:
      parsed.provider_batch_state === null ||
      parsed.provider_batch_state === undefined
        ? null
        : normalizeGeminiProviderBatchState(parsed.provider_batch_state),
    provider_batch_updated_at: parsed.provider_batch_updated_at ?? null,
    provider_reconcile_due_at: parsed.provider_reconcile_due_at ?? null,
    provider_reconcile_attempt_count: parsed.provider_reconcile_attempt_count ?? 0,
    provider_reconcile_lease_token: parsed.provider_reconcile_lease_token ?? null,
    provider_reconcile_lease_expires_at:
      parsed.provider_reconcile_lease_expires_at ?? null,
    retry_count: parsed.retry_count ?? 0,
    created_by: parsed.created_by ?? null,
  };
}

async function fetchCurrentTakeoffJobStatus(input: {
  supabase: Supabase;
  job: Pick<TakeoffJobProcessingRow, "id" | "tenant_id">;
  level: ProcessableTakeoffLevel;
}) {
  const { data, error } = await input.supabase
    .from("takeoff_jobs" as never)
    .select("status" as never)
    .eq("id" as never, input.job.id as never)
    .eq("tenant_id" as never, input.job.tenant_id as never)
    .maybeSingle();

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(
        error,
        "Impossible de verifier le statut courant du job takeoff."
      ),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.job.id,
        level: input.level,
      }
    );
  }

  if (!data || typeof data !== "object" || !("status" in data)) {
    return null;
  }

  const status = (data as { status?: unknown }).status;
  return typeof status === "string" ? status : null;
}

function buildProcessingStatusConflictError(input: {
  jobId: string;
  currentStatus: string | null;
  operation: string;
  level: ProcessableTakeoffLevel;
}) {
  return new TakeoffError({
    status: 409,
    code: TakeoffErrorCode.CONFLICT,
    message:
      input.currentStatus === "canceled"
        ? "Le job a ete annule pendant le traitement."
        : "Le job n'est plus en cours de traitement.",
    details: {
      expected_status: "processing",
      current_status: input.currentStatus,
      operation: input.operation,
    },
    retryable: false,
    jobId: input.jobId,
    level: input.level,
  });
}

async function clearResultsAfterCanceledTransition(input: {
  supabase: Supabase;
  job: TakeoffJobProcessingRow;
  operation: string;
  level: ProcessableTakeoffLevel;
}) {
  try {
    await clearPreviousResultsForJob({
      supabase: input.supabase,
      job: input.job,
      level: input.level,
    });
  } catch (cleanupError) {
    console.error("Impossible de nettoyer les resultats apres annulation du job.", {
      job_id: input.job.id,
      operation: input.operation,
      error: cleanupError,
    });
  }
}

function isCanceledDuringProcessingConflict(error: TakeoffError) {
  if (error.code !== TakeoffErrorCode.CONFLICT) {
    return false;
  }

  const details = error.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return false;
  }

  return (details as Record<string, unknown>).current_status === "canceled";
}

async function resolveContext(
  options: ProcessLevelAOptions
): Promise<ProcessLevelContext> {
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

async function persistGeminiBatchLifecycleEvent(input: {
  supabase: Supabase;
  job: TakeoffJobProcessingRow;
  event: GeminiBatchLifecycleEvent;
}): Promise<TakeoffJobProcessingRow> {
  const providerBatchState = normalizeGeminiProviderBatchState(
    input.event.providerBatchStateRaw
  );
  const snapshot = await persistTakeoffProviderBatchSnapshot({
    supabase: input.supabase,
    jobId: input.job.id,
    tenantId: input.job.tenant_id,
    estimateVersionId: input.job.estimate_version_id,
    provider: "gemini",
    currentSnapshot: {
      processing_strategy: input.job.processing_strategy,
      provider_batch_id: input.job.provider_batch_id,
      provider_batch_state: input.job.provider_batch_state,
      provider_batch_updated_at: input.job.provider_batch_updated_at,
      provider_state_raw: null,
    },
    processingStrategy: "batch",
    providerBatchId: input.event.providerBatchId,
    providerBatchState,
    providerStateRaw: input.event.providerBatchStateRaw,
    observedAtIso: input.event.observedAt,
    message: input.event.message,
    metadata: {
      provider: input.event.provider,
      is_terminal: input.event.isTerminal,
    },
  });

  return {
    ...input.job,
    processing_strategy: snapshot.processing_strategy,
    provider_batch_id: snapshot.provider_batch_id,
    provider_batch_state: snapshot.provider_batch_state,
    provider_batch_updated_at: snapshot.provider_batch_updated_at,
  };
}

async function getTakeoffJobForProcessing(input: {
  supabase: Supabase;
  jobId: string;
  tenantId: string | null;
  level: ProcessableTakeoffLevel;
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
        level: input.level,
      }
    );
  }

  if (!data) {
    throw new TakeoffError({
      code: TakeoffErrorCode.TAKEOFF_JOB_NOT_FOUND,
      message: "Job takeoff introuvable.",
      retryable: false,
      jobId: input.jobId,
      level: input.level,
    });
  }

  return parseTakeoffJobRow(data);
}

async function markJobAsProcessing(input: {
  supabase: Supabase;
  job: TakeoffJobProcessingRow;
  tenantId: string | null;
  startedAtIso: string;
  processingStrategy: TakeoffProcessingStrategy;
  model: string;
  thinkingLevel: string;
  promptVersion: string;
  level: ProcessableTakeoffLevel;
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
      next_retry_at: null,
      last_error_at: null,
      provider_batch_id: null,
      provider_batch_state: null,
      provider_batch_updated_at: null,
      provider_reconcile_due_at: null,
      provider_reconcile_attempt_count: 0,
      provider_reconcile_lease_token: null,
      provider_reconcile_lease_expires_at: null,
      model: input.model,
      thinking_level: input.thinkingLevel,
      prompt_version: input.promptVersion,
      processing_strategy: input.processingStrategy,
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
        level: input.level,
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
      level: input.level,
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
  level: ProcessableTakeoffLevel;
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
      next_retry_at: null,
      provider_reconcile_due_at: null,
      provider_reconcile_attempt_count: 0,
      provider_reconcile_lease_token: null,
      provider_reconcile_lease_expires_at: null,
    } as never)
    .eq("id" as never, input.job.id as never)
    .eq("status" as never, "processing" as never)
    .select("id" as never);

  if (input.tenantId) {
    query = query.eq("tenant_id" as never, input.tenantId as never);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de finaliser le job takeoff."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.job.id,
        level: input.level,
      }
    );
  }

  if (data) {
    return;
  }

  const currentStatus = await fetchCurrentTakeoffJobStatus({
    supabase: input.supabase,
    job: input.job,
    level: input.level,
  });

  if (currentStatus === "canceled") {
    await clearResultsAfterCanceledTransition({
      supabase: input.supabase,
      job: input.job,
      operation: "complete_job",
      level: input.level,
    });
  }

  throw buildProcessingStatusConflictError({
    jobId: input.job.id,
    currentStatus,
    operation: "complete_job",
    level: input.level,
  });
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
      provider_reconcile_due_at: null,
      provider_reconcile_attempt_count: 0,
      provider_reconcile_lease_token: null,
      provider_reconcile_lease_expires_at: null,
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

async function scheduleBatchReconcile(input: {
  supabase: Supabase;
  job: TakeoffJobProcessingRow;
  tenantId: string | null;
  dueAtIso: string;
  attemptCount?: number;
}): Promise<TakeoffJobProcessingRow> {
  let query = input.supabase
    .from("takeoff_jobs" as never)
    .update({
      provider_reconcile_due_at: input.dueAtIso,
      provider_reconcile_attempt_count: input.attemptCount ?? 0,
      provider_reconcile_lease_token: null,
      provider_reconcile_lease_expires_at: null,
    } as never)
    .eq("id" as never, input.job.id as never)
    .eq("status" as never, "processing" as never)
    .select(TAKEOFF_JOB_PROCESSING_SELECT as never);

  if (input.tenantId) {
    query = query.eq("tenant_id" as never, input.tenantId as never);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(
        error,
        "Impossible de planifier la reconciliation provider du job takeoff."
      ),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.job.id,
      }
    );
  }

  if (!data) {
    throw new TakeoffError({
      code: TakeoffErrorCode.CONFLICT,
      message: "Le job n'est plus dans un etat compatible avec la reconciliation batch.",
      retryable: false,
      jobId: input.job.id,
    });
  }

  return parseTakeoffJobRow(data);
}

function canRecoverAcceptedBatchSubmission(input: {
  error: TakeoffError;
  job: TakeoffJobProcessingRow;
  submission: {
    providerBatchId: string;
    providerBatchStateRaw: string;
  };
}) {
  return (
    input.error.code !== TakeoffErrorCode.CONFLICT &&
    input.job.status === "processing" &&
    input.job.processing_strategy === "batch" &&
    input.job.provider_batch_id === input.submission.providerBatchId
  );
}

async function downloadTakeoffSourceFile(input: {
  supabase: Supabase;
  job: TakeoffJobProcessingRow;
  level: ProcessableTakeoffLevel;
}): Promise<DownloadedTakeoffFile> {
  const planSetId = normalizeNullableText(input.job.plan_set_id);
  if (planSetId) {
    const { data: planFilesData, error: planFilesError } = await input.supabase
      .from("plan_files" as never)
      .select("file_path, file_name, file_type" as never)
      .eq("tenant_id" as never, input.job.tenant_id as never)
      .eq("plan_set_id" as never, planSetId as never)
      .order("created_at" as never, { ascending: true });

    if (planFilesError) {
      throw toTakeoffError(
        mapSupabaseError(planFilesError, "Impossible de charger les fichiers du jeu de plans."),
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

      return {
        fileName:
          normalizeNullableText(singleFile.file_name) ??
          normalizeNullableText(input.job.source_file_name) ??
          "plan.pdf",
        mimeType:
          resolveTakeoffPdfMimeType({
            fileName:
              normalizeNullableText(singleFile.file_name) ??
              normalizeNullableText(input.job.source_file_name) ??
              "plan.pdf",
            mimeType:
              normalizeNullableText(data.type) ??
              normalizeNullableText(singleFile.file_type),
          }) ??
          "application/pdf",
        bytes: await data.arrayBuffer(),
      };
    }

    const mergedPdf = await PDFDocument.create();
    const sourceFileNamesByPage: string[] = [];
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

      let sourcePdf: PDFDocument;
      try {
        sourcePdf = await PDFDocument.load(await data.arrayBuffer());
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

      const copiedPages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
      for (const copiedPage of copiedPages) {
        mergedPdf.addPage(copiedPage);
        sourceFileNamesByPage.push(
          normalizeNullableText(planFile.file_name) ?? `plan-${sourceFileNamesByPage.length + 1}.pdf`
        );
      }
    }

    return {
      fileName: `plan-set-${planSetId}.pdf`,
      mimeType: "application/pdf",
      bytes: toArrayBuffer(await mergedPdf.save()),
      sourceFileNamesByPage,
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
      code: isNotFound
        ? TakeoffErrorCode.NOT_FOUND
        : TakeoffErrorCode.INTERNAL_ERROR,
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

  const fallbackFileName = normalizeNullableText(input.job.source_file_name) ?? "upload";
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

async function clearPreviousResultsForJob(input: {
  supabase: Supabase;
  job: TakeoffJobProcessingRow;
  level: ProcessableTakeoffLevel;
}) {
  const { error: deleteMetricsError } = await input.supabase
    .from("takeoff_run_metrics" as never)
    .delete()
    .eq("tenant_id" as never, input.job.tenant_id as never)
    .eq("job_id" as never, input.job.id as never);

  if (deleteMetricsError) {
    throw toTakeoffError(
      mapSupabaseError(
        deleteMetricsError,
        "Impossible de nettoyer les metriques takeoff precedentes."
      ),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.job.id,
        level: input.level,
      }
    );
  }

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
        level: input.level,
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
        level: input.level,
      }
    );
  }
}

type PersistedTakeoffResultSnapshotRow = {
  id: string;
  tenant_id: string;
  job_id: string;
  extracted_json: unknown;
  warnings: unknown[];
  tables: unknown[];
  provider_meta: Record<string, unknown>;
  raw_response: unknown;
  confidence: number | null;
  token_count: number | null;
  cost_cents: number | null;
  duration_ms: number | null;
};

type PersistedTakeoffItemSnapshotRow = {
  id: string;
  tenant_id: string;
  job_id: string;
  result_id: string | null;
  designation: string;
  quantity: number;
  unit: string;
  confidence: number | null;
  evidence: string | null;
  source_file_name: string | null;
  source_page: number | null;
  metadata: Record<string, unknown>;
  is_excluded: boolean;
  exclusion_reason: string | null;
  is_verified: boolean;
  verified_at: string | null;
  verified_by: string | null;
};

type PersistedTakeoffRunMetricSnapshotRow = {
  id: string;
  tenant_id: string;
  job_id: string;
  result_id: string | null;
  level: string;
  provider: string;
  model: string;
  chunk_index: number;
  chunk_start_page: number;
  chunk_end_page: number;
  input_tokens: number;
  reasoning_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_cents: number;
  duration_ms: number;
  timed_out: boolean;
  budget_exceeded: boolean;
  metadata: Record<string, unknown>;
};

type TakeoffPersistenceSnapshot = {
  results: PersistedTakeoffResultSnapshotRow[];
  items: PersistedTakeoffItemSnapshotRow[];
  runMetrics: PersistedTakeoffRunMetricSnapshotRow[];
};

function annotateAtomicPersistenceRollbackError(error: TakeoffError) {
  const details: Record<string, unknown> =
    error.details && typeof error.details === "object" && !Array.isArray(error.details)
      ? { ...(error.details as Record<string, unknown>) }
      : { cause: error.details };

  details[ATOMIC_PERSISTENCE_ROLLBACK_MARKER] = true;

  return new TakeoffError({
    code: error.code,
    status: error.status,
    message: error.message,
    details,
    retryable: error.retryable,
    jobId: error.jobId,
    level: error.level,
  });
}

function hasAtomicPersistenceRollbackError(error: TakeoffError) {
  if (!error.details || typeof error.details !== "object" || Array.isArray(error.details)) {
    return false;
  }

  return (
    (error.details as Record<string, unknown>)[ATOMIC_PERSISTENCE_ROLLBACK_MARKER] === true
  );
}

async function snapshotTakeoffPersistenceState(input: {
  supabase: Supabase;
  job: TakeoffJobProcessingRow;
  level: ProcessableTakeoffLevel;
}): Promise<TakeoffPersistenceSnapshot> {
  const [resultsResponse, itemsResponse, runMetricsResponse] = await Promise.all([
    input.supabase
      .from("takeoff_results" as never)
      .select(
        "id, tenant_id, job_id, extracted_json, warnings, tables, provider_meta, raw_response, confidence, token_count, cost_cents, duration_ms" as never
      )
      .eq("tenant_id" as never, input.job.tenant_id as never)
      .eq("job_id" as never, input.job.id as never),
    input.supabase
      .from("takeoff_items" as never)
      .select(
        "id, tenant_id, job_id, result_id, designation, quantity, unit, confidence, evidence, source_file_name, source_page, metadata, is_excluded, exclusion_reason, is_verified, verified_at, verified_by" as never
      )
      .eq("tenant_id" as never, input.job.tenant_id as never)
      .eq("job_id" as never, input.job.id as never),
    input.supabase
      .from("takeoff_run_metrics" as never)
      .select(
        "id, tenant_id, job_id, result_id, level, provider, model, chunk_index, chunk_start_page, chunk_end_page, input_tokens, reasoning_tokens, output_tokens, total_tokens, cost_cents, duration_ms, timed_out, budget_exceeded, metadata" as never
      )
      .eq("tenant_id" as never, input.job.tenant_id as never)
      .eq("job_id" as never, input.job.id as never),
  ]);

  if (resultsResponse.error) {
    throw toTakeoffError(
      mapSupabaseError(
        resultsResponse.error,
        "Impossible de lire le snapshot des resultats takeoff."
      ),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.job.id,
        level: input.level,
      }
    );
  }

  if (itemsResponse.error) {
    throw toTakeoffError(
      mapSupabaseError(itemsResponse.error, "Impossible de lire le snapshot des items takeoff."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.job.id,
        level: input.level,
      }
    );
  }

  if (runMetricsResponse.error) {
    throw toTakeoffError(
      mapSupabaseError(
        runMetricsResponse.error,
        "Impossible de lire le snapshot des metriques takeoff."
      ),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.job.id,
        level: input.level,
      }
    );
  }

  return {
    results: Array.isArray(resultsResponse.data)
      ? (resultsResponse.data as PersistedTakeoffResultSnapshotRow[])
      : [],
    items: Array.isArray(itemsResponse.data)
      ? (itemsResponse.data as PersistedTakeoffItemSnapshotRow[])
      : [],
    runMetrics: Array.isArray(runMetricsResponse.data)
      ? (runMetricsResponse.data as PersistedTakeoffRunMetricSnapshotRow[])
      : [],
  };
}

async function restoreTakeoffPersistenceState(input: {
  supabase: Supabase;
  job: TakeoffJobProcessingRow;
  snapshot: TakeoffPersistenceSnapshot;
  level: ProcessableTakeoffLevel;
}) {
  await clearPreviousResultsForJob({
    supabase: input.supabase,
    job: input.job,
    level: input.level,
  });

  for (const resultRow of input.snapshot.results) {
    const { error } = await input.supabase
      .from("takeoff_results" as never)
      .insert(resultRow as never);

    if (error) {
      throw toTakeoffError(
        mapSupabaseError(error, "Impossible de restaurer les resultats takeoff."),
        {
          fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
          retryable: false,
          jobId: input.job.id,
          level: input.level,
        }
      );
    }
  }

  if (input.snapshot.items.length > 0) {
    const { error } = await input.supabase
      .from("takeoff_items" as never)
      .insert(input.snapshot.items as never);

    if (error) {
      throw toTakeoffError(
        mapSupabaseError(error, "Impossible de restaurer les items takeoff."),
        {
          fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
          retryable: false,
          jobId: input.job.id,
          level: input.level,
        }
      );
    }
  }

  if (input.snapshot.runMetrics.length > 0) {
    const { error } = await input.supabase
      .from("takeoff_run_metrics" as never)
      .insert(input.snapshot.runMetrics as never);

    if (error) {
      throw toTakeoffError(
        mapSupabaseError(error, "Impossible de restaurer les metriques takeoff."),
        {
          fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
          retryable: false,
          jobId: input.job.id,
          level: input.level,
        }
      );
    }
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
  level: ProcessableTakeoffLevel;
}): Promise<{
  resultId: string;
  itemsCount: number;
  warningsCount: number;
}> {
  const statusBeforePersist = await fetchCurrentTakeoffJobStatus({
    supabase: input.supabase,
    job: input.job,
    level: input.level,
  });

  if (statusBeforePersist !== "processing") {
    throw buildProcessingStatusConflictError({
      jobId: input.job.id,
      currentStatus: statusBeforePersist,
      operation: "persist_results_before_write",
      level: input.level,
    });
  }

  const shouldEnforceAtomicRollback = input.level === TAKEOFF_LEVEL_A;
  const initialSnapshot = shouldEnforceAtomicRollback
    ? await snapshotTakeoffPersistenceState({
        supabase: input.supabase,
        job: input.job,
        level: input.level,
      })
    : null;

  let resultId: string;

  try {
    await clearPreviousResultsForJob({
      supabase: input.supabase,
      job: input.job,
      level: input.level,
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
          level: input.level,
        }
      );
    }

    const parsedResult = takeoffResultIdSchema.parse(insertedResult);
    resultId = parsedResult.id;

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
            level: input.level,
          }
        );
      }
    }
  } catch (error) {
    const mapped = toTakeoffError(error, {
      fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
      jobId: input.job.id,
      level: input.level,
      retryable: false,
    });

    if (!shouldEnforceAtomicRollback || !initialSnapshot) {
      throw mapped;
    }

    try {
      await restoreTakeoffPersistenceState({
        supabase: input.supabase,
        job: input.job,
        snapshot: initialSnapshot,
        level: input.level,
      });
    } catch (restoreError) {
      const restoreMapped = toTakeoffError(restoreError, {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        fallbackMessage:
          "Impossible de restaurer l'etat precedent apres echec de persistance takeoff.",
        retryable: false,
        jobId: input.job.id,
        level: input.level,
      });

      throw new TakeoffError({
        code: TakeoffErrorCode.INTERNAL_ERROR,
        status: 500,
        message:
          "La persistance takeoff a echoue et la restauration atomique n'a pas pu etre completee.",
        details: {
          original_error: mapped.details,
          rollback_error: restoreMapped.details,
          [ATOMIC_PERSISTENCE_ROLLBACK_MARKER]: false,
        },
        retryable: false,
        jobId: input.job.id,
        level: input.level,
      });
    }

    throw annotateAtomicPersistenceRollbackError(mapped);
  }

  const statusAfterPersist = await fetchCurrentTakeoffJobStatus({
    supabase: input.supabase,
    job: input.job,
    level: input.level,
  });

  if (statusAfterPersist !== "processing") {
    if (statusAfterPersist === "canceled") {
      await clearResultsAfterCanceledTransition({
        supabase: input.supabase,
        job: input.job,
        operation: "persist_results_after_write",
        level: input.level,
      });
    }

    throw buildProcessingStatusConflictError({
      jobId: input.job.id,
      currentStatus: statusAfterPersist,
      operation: "persist_results_after_write",
      level: input.level,
    });
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
  level: ProcessableTakeoffLevel;
}): Promise<boolean> {
  const rawResponse = extractRawResponseFromTakeoffError(input.error);
  if (rawResponse === undefined || rawResponse === null) {
    return false;
  }

  let clearedPreviousResults = false;

  try {
    await clearPreviousResultsForJob({
      supabase: input.supabase,
      job: input.job,
      level: input.level,
    });
    clearedPreviousResults = true;

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

  return clearedPreviousResults;
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

type LevelCChunkMetric = {
  index: number;
  start: number;
  end: number;
  input_tokens: number;
  reasoning_tokens: number;
  output_tokens: number;
  token_count: number;
  cost_cents: number;
  duration_ms: number;
  model: string;
  timed_out: boolean;
  budget_exceeded: boolean;
  status: "success" | "failed";
  error_code?: string;
  error_message?: string;
};

type LevelCChunkMetricPersistenceHint = {
  errorDetails?: unknown;
  sourceFileName: string;
};

type LevelCChunkMetricWriteInput = {
  supabase: Supabase;
  job: TakeoffJobProcessingRow;
  metrics: LevelCChunkMetric[];
  resultId?: string | null;
  hint: LevelCChunkMetricPersistenceHint;
};

type LevelCProcessingError = TakeoffError & {
  levelCChunkMetrics?: LevelCChunkMetric[];
};

type ProcessLevelCGeminiAggregate = {
  normalizedExchange: TakeoffExchange;
  itemsForInsert: NormalizedTakeoffItemForInsert[];
  tokenCount: number;
  tokenUsage: ProcessLevelCMetricsSummary;
  costCents: number;
  durationMs: number;
  tablesCount: number;
  pageCount: number;
  chunksCount: number;
  chunkMetrics: LevelCChunkMetric[];
  providerMeta: Record<string, unknown>;
};

function createChunkPromptSourceHint(input: {
  fileName: string;
  chunk: TakeoffPdfChunk;
  totalChunks: number;
}) {
  return `${input.fileName} | chunk ${input.chunk.index + 1}/${input.totalChunks} | pages ${
    input.chunk.startPage
  }-${input.chunk.endPage}`;
}

function remapChunkLocalPagesToAbsolute(input: {
  chunk: TakeoffPdfChunk;
  exchange: TakeoffExchange;
}): TakeoffExchange {
  const pageOffset = input.chunk.startPage - 1;

  return {
    ...input.exchange,
    items: input.exchange.items.map((item) => ({
      ...item,
      source_page: item.source_page === undefined ? undefined : item.source_page + pageOffset,
    })),
    tables: input.exchange.tables?.map((table) => ({
      ...table,
      page: table.page + pageOffset,
    })),
  };
}

async function upsertDetectedPlanFilePageCount(input: {
  supabase: Supabase;
  tenantId: string;
  sourceFilePath: string | null;
  pageCount: number;
}) {
  const sourceFilePath = normalizeNullableText(input.sourceFilePath);
  if (!sourceFilePath) {
    return;
  }

  const { data, error } = await input.supabase
    .from("plan_files" as never)
    .select("id, page_count, metadata" as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("file_path" as never, sourceFilePath as never)
    .maybeSingle();

  if (error) {
    console.error("Impossible de lire le metadata plan_files pour page_count.", {
      tenant_id: input.tenantId,
      source_file_path: sourceFilePath,
      error,
    });
    return;
  }

  if (!data || typeof data !== "object") {
    return;
  }

  const row = data as {
    id?: unknown;
    page_count?: unknown;
    metadata?: unknown;
  };
  const planFileId = typeof row.id === "string" ? row.id : null;
  if (!planFileId) {
    return;
  }

  const currentPageCount =
    typeof row.page_count === "number" && Number.isInteger(row.page_count)
      ? row.page_count
      : null;
  const existingMetadata =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};

  const updatePayload: Record<string, unknown> = {
    metadata: {
      ...existingMetadata,
      detected_page_count: input.pageCount,
      detected_page_count_at: new Date().toISOString(),
    },
  };

  if (currentPageCount !== input.pageCount) {
    updatePayload.page_count = input.pageCount;
  }

  const { error: updateError } = await input.supabase
    .from("plan_files" as never)
    .update(updatePayload as never)
    .eq("id" as never, planFileId as never)
    .eq("tenant_id" as never, input.tenantId as never);

  if (updateError) {
    console.error("Impossible de persister page_count sur plan_files.", {
      tenant_id: input.tenantId,
      source_file_path: sourceFilePath,
      page_count: input.pageCount,
      error: updateError,
    });
  }
}

function cloneLevelCChunkMetrics(metrics: LevelCChunkMetric[]) {
  return metrics.map((metric) => ({ ...metric }));
}

function isLevelCChunkMetric(value: unknown): value is LevelCChunkMetric {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.index === "number" &&
    typeof record.start === "number" &&
    typeof record.end === "number" &&
    typeof record.input_tokens === "number" &&
    typeof record.reasoning_tokens === "number" &&
    typeof record.output_tokens === "number" &&
    typeof record.token_count === "number" &&
    typeof record.cost_cents === "number" &&
    typeof record.duration_ms === "number" &&
    typeof record.model === "string" &&
    typeof record.timed_out === "boolean" &&
    typeof record.budget_exceeded === "boolean" &&
    (record.status === "success" || record.status === "failed")
  );
}

function extractLevelCChunkMetricsFromError(error: unknown): LevelCChunkMetric[] {
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return [];
  }

  const record = error as { levelCChunkMetrics?: unknown };
  if (!Array.isArray(record.levelCChunkMetrics)) {
    return [];
  }

  const metrics = record.levelCChunkMetrics.filter(isLevelCChunkMetric);
  return cloneLevelCChunkMetrics(metrics);
}

function mapToLevelCNormalizedError(input: {
  error: unknown;
  jobId: string;
  chunkMetrics: LevelCChunkMetric[];
}): TakeoffError {
  const mapped = toTakeoffError(input.error, {
    fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
    jobId: input.jobId,
    level: TAKEOFF_LEVEL_C,
  });

  let normalized = mapped;
  if (mapped.code === TakeoffErrorCode.AI_TIMEOUT) {
    normalized = new TakeoffError({
      code: TakeoffErrorCode.TAKEOFF_LEVEL_C_TIMEOUT,
      status: 500,
      message: mapped.message,
      details: mapped.details,
      retryable: mapped.retryable,
      jobId: input.jobId,
      level: TAKEOFF_LEVEL_C,
    });
  } else if (
    mapped.code === TakeoffErrorCode.AI_SCHEMA ||
    mapped.code === TakeoffErrorCode.VALIDATION_ERROR
  ) {
    normalized = new TakeoffError({
      code: TakeoffErrorCode.TAKEOFF_LEVEL_C_INVALID_SCHEMA,
      status: 422,
      message: mapped.message,
      details: mapped.details,
      retryable: false,
      jobId: input.jobId,
      level: TAKEOFF_LEVEL_C,
    });
  }

  const enriched = normalized as LevelCProcessingError;
  enriched.levelCChunkMetrics = cloneLevelCChunkMetrics(input.chunkMetrics);
  return enriched;
}

function logLevelCChunkMetric(input: {
  job: TakeoffJobProcessingRow;
  metric: LevelCChunkMetric;
}) {
  const payload = {
    job_id: input.job.id,
    tenant_id: input.job.tenant_id,
    level: TAKEOFF_LEVEL_C,
    chunk_index: input.metric.index,
    chunk_start_page: input.metric.start,
    chunk_end_page: input.metric.end,
    model: input.metric.model,
    input_tokens: input.metric.input_tokens,
    reasoning_tokens: input.metric.reasoning_tokens,
    output_tokens: input.metric.output_tokens,
    total_tokens: input.metric.token_count,
    cost_cents: input.metric.cost_cents,
    duration_ms: input.metric.duration_ms,
    timed_out: input.metric.timed_out,
    budget_exceeded: input.metric.budget_exceeded,
    status: input.metric.status,
    error_code: input.metric.error_code ?? null,
  };

  if (input.metric.status === "failed") {
    console.error("takeoff.level_c.chunk", payload);
    return;
  }

  console.info("takeoff.level_c.chunk", payload);
}

async function persistLevelCRunMetrics(input: LevelCChunkMetricWriteInput) {
  if (input.metrics.length === 0) {
    return;
  }

  const payload = input.metrics.map((metric) => ({
    tenant_id: input.job.tenant_id,
    job_id: input.job.id,
    result_id: input.resultId ?? null,
    level: TAKEOFF_LEVEL_C,
    provider: "gemini",
    model: metric.model,
    chunk_index: metric.index,
    chunk_start_page: metric.start,
    chunk_end_page: metric.end,
    input_tokens: metric.input_tokens,
    reasoning_tokens: metric.reasoning_tokens,
    output_tokens: metric.output_tokens,
    total_tokens: metric.token_count,
    cost_cents: metric.cost_cents,
    duration_ms: metric.duration_ms,
    timed_out: metric.timed_out,
    budget_exceeded: metric.budget_exceeded,
    metadata: {
      status: metric.status,
      source_file_name: input.hint.sourceFileName,
      error_code: metric.error_code ?? null,
      error_message: metric.error_message ?? null,
      error_details: input.hint.errorDetails ?? null,
    },
  }));

  const { error } = await input.supabase
    .from("takeoff_run_metrics" as never)
    .insert(payload as never);

  if (error) {
    console.error("Impossible de persister les metriques takeoff_run_metrics.", {
      job_id: input.job.id,
      tenant_id: input.job.tenant_id,
      metrics_count: input.metrics.length,
      error,
    });
  }
}

async function processLevelCGeminiChunks(input: {
  supabase: Supabase;
  job: TakeoffJobProcessingRow;
  sourceFile: DownloadedTakeoffFile;
  callGemini: CallGeminiStructuredFn;
  schemaVersion: string;
  model: string;
  promptVersion: string;
  thinkingLevel: GeminiThinkingLevel;
  deliveryMode: GeminiDeliveryMode;
  onBatchLifecycleEvent?: (
    event: GeminiBatchLifecycleEvent
  ) => Promise<void>;
}): Promise<ProcessLevelCGeminiAggregate> {
  if (!isPdfMimeType(input.sourceFile.mimeType)) {
    throw new TakeoffError({
      code: TakeoffErrorCode.TAKEOFF_FILE_TYPE_INVALID,
      message: "Le processor Level C requiert un fichier PDF source.",
      retryable: false,
      jobId: input.job.id,
      level: TAKEOFF_LEVEL_C,
      details: {
        file_type: input.sourceFile.mimeType,
        source_file_name: input.sourceFile.fileName,
      },
    });
  }

  let pageCount: number;
  try {
    pageCount = await getPdfPageCount(input.sourceFile.bytes);
  } catch {
    const pdfInspection = await inspectTakeoffPdfBytes(input.sourceFile.bytes);
    throw new TakeoffError({
      code: TakeoffErrorCode.TAKEOFF_PDF_CORRUPTED,
      message: pdfInspection.valid
        ? "Le PDF est invalide ou incomplet. Reexportez-le avant de relancer l'analyse."
        : pdfInspection.message,
      retryable: false,
      jobId: input.job.id,
      level: TAKEOFF_LEVEL_C,
      details: pdfInspection.valid
        ? {
            reason: "invalid_pdf_page_count",
            source_file_name: input.sourceFile.fileName,
          }
        : pdfInspection.details,
    });
  }

  const levelCProcessingConfig = await getTakeoffLevelCProcessingConfigForTenant(
    input.job.tenant_id,
    {
      supabase: input.supabase,
    }
  );

  if (pageCount > levelCProcessingConfig.maxPdfPages) {
    throw new TakeoffError({
      status: 413,
      code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE,
      message: `Le PDF contient ${pageCount} pages et depasse la limite de ${levelCProcessingConfig.maxPdfPages} pages.`,
      retryable: false,
      jobId: input.job.id,
      level: TAKEOFF_LEVEL_C,
      details: {
        page_count: pageCount,
        max_pdf_pages: levelCProcessingConfig.maxPdfPages,
      },
    });
  }

  await upsertDetectedPlanFilePageCount({
    supabase: input.supabase,
    tenantId: input.job.tenant_id,
    sourceFilePath: input.job.source_file_path,
    pageCount,
  });

  const chunks = buildPdfChunks(pageCount, {
    thresholdPages: levelCProcessingConfig.thresholdPages,
    chunkSizePages: levelCProcessingConfig.chunkSizePages,
    overlapPages: levelCProcessingConfig.overlapPages,
  });

  const chunkExchanges: Array<{
    chunk: TakeoffPdfChunk;
    exchange: TakeoffExchange;
  }> = [];
  const chunkMetrics: LevelCChunkMetric[] = [];
  const tokenUsage: ProcessLevelCMetricsSummary = {
    inputTokens: 0,
    reasoningTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
  let costCents = 0;
  let durationMs = 0;

  for (const chunk of chunks) {
    const chunkPrompt = getTakeoffPrompt(TAKEOFF_LEVEL_C, {
      fileType: input.sourceFile.mimeType,
      schemaVersion: input.schemaVersion,
      sourceHint: createChunkPromptSourceHint({
        fileName: input.sourceFile.fileName,
        chunk,
        totalChunks: chunks.length,
      }),
    });

    try {
      const chunkBytes = await createPdfChunkBytes({
        bytes: input.sourceFile.bytes,
        chunk,
      });

      const geminiResult = await input.callGemini<TakeoffExchange>({
        prompt: chunkPrompt,
        schema: TakeoffExchangeSchema,
        files: [
          {
            data: Buffer.from(chunkBytes).toString("base64"),
            mimeType: "application/pdf",
          },
        ],
        thinkingLevel: input.thinkingLevel,
        timeoutMs: levelCProcessingConfig.timeoutMs,
        deliveryMode: input.deliveryMode,
        onBatchLifecycleEvent: input.onBatchLifecycleEvent,
        context: {
          jobId: input.job.id,
          tenantId: input.job.tenant_id,
          level: TAKEOFF_LEVEL_C,
          promptVersion: input.promptVersion,
          model: input.model,
        },
      });

      const parsedExchange = TakeoffExchangeSchema.parse(geminiResult.data);
      chunkExchanges.push({
        chunk,
        exchange: remapChunkLocalPagesToAbsolute({
          chunk,
          exchange: parsedExchange,
        }),
      });

      const chunkTokenUsage: GeminiTokenUsageBreakdown = geminiResult.tokenUsage;
      tokenUsage.inputTokens += chunkTokenUsage.inputTokens;
      tokenUsage.reasoningTokens += chunkTokenUsage.reasoningTokens;
      tokenUsage.outputTokens += chunkTokenUsage.outputTokens;
      tokenUsage.totalTokens += chunkTokenUsage.totalTokens;

      costCents += geminiResult.costCents;
      durationMs += geminiResult.durationMs;

      const tokenBudgetExceeded = tokenUsage.totalTokens > levelCProcessingConfig.maxTotalTokens;
      const costBudgetExceeded = costCents > levelCProcessingConfig.maxCostCents;
      const isBudgetExceeded = tokenBudgetExceeded || costBudgetExceeded;

      const metric: LevelCChunkMetric = {
        index: chunk.index,
        start: chunk.startPage,
        end: chunk.endPage,
        input_tokens: chunkTokenUsage.inputTokens,
        reasoning_tokens: chunkTokenUsage.reasoningTokens,
        output_tokens: chunkTokenUsage.outputTokens,
        token_count: chunkTokenUsage.totalTokens,
        cost_cents: geminiResult.costCents,
        duration_ms: geminiResult.durationMs,
        model: geminiResult.model,
        timed_out: false,
        budget_exceeded: isBudgetExceeded,
        status: isBudgetExceeded ? "failed" : "success",
        error_code: isBudgetExceeded
          ? TakeoffErrorCode.TAKEOFF_LEVEL_C_BUDGET_EXCEEDED
          : undefined,
        error_message: isBudgetExceeded
          ? "Le budget Level C configure est depasse."
          : undefined,
      };
      chunkMetrics.push(metric);
      logLevelCChunkMetric({
        job: input.job,
        metric,
      });

      if (isBudgetExceeded) {
        throw new TakeoffError({
          code: TakeoffErrorCode.TAKEOFF_LEVEL_C_BUDGET_EXCEEDED,
          status: 422,
          message: "Le budget Level C configure est depasse.",
          retryable: false,
          jobId: input.job.id,
          level: TAKEOFF_LEVEL_C,
          details: {
            chunk_index: chunk.index,
            chunk_start_page: chunk.startPage,
            chunk_end_page: chunk.endPage,
            consumed: {
              input_tokens: tokenUsage.inputTokens,
              reasoning_tokens: tokenUsage.reasoningTokens,
              output_tokens: tokenUsage.outputTokens,
              total_tokens: tokenUsage.totalTokens,
              cost_cents: costCents,
            },
            budget: {
              max_total_tokens: levelCProcessingConfig.maxTotalTokens,
              max_cost_cents: levelCProcessingConfig.maxCostCents,
            },
            exceeded: {
              total_tokens: tokenBudgetExceeded,
              cost_cents: costBudgetExceeded,
            },
          },
        });
      }
    } catch (error) {
      const normalized = mapToLevelCNormalizedError({
        error,
        jobId: input.job.id,
        chunkMetrics,
      });

      const alreadyTracked = chunkMetrics.some((metric) => metric.index === chunk.index);
      if (!alreadyTracked) {
        const fallbackMetric: LevelCChunkMetric = {
          index: chunk.index,
          start: chunk.startPage,
          end: chunk.endPage,
          input_tokens: 0,
          reasoning_tokens: 0,
          output_tokens: 0,
          token_count: 0,
          cost_cents: 0,
          duration_ms: 0,
          model: input.model,
          timed_out: normalized.code === TakeoffErrorCode.TAKEOFF_LEVEL_C_TIMEOUT,
          budget_exceeded:
            normalized.code === TakeoffErrorCode.TAKEOFF_LEVEL_C_BUDGET_EXCEEDED,
          status: "failed",
          error_code: normalized.code,
          error_message: normalized.message,
        };
        chunkMetrics.push(fallbackMetric);
        logLevelCChunkMetric({
          job: input.job,
          metric: fallbackMetric,
        });
      }

      (normalized as LevelCProcessingError).levelCChunkMetrics = cloneLevelCChunkMetrics(
        chunkMetrics
      );
      throw normalized;
    }
  }

  const merged = mergeTakeoffChunkExchanges(chunkExchanges);
  const normalized = normalizeTakeoffExchange({
    exchange: merged.exchange,
    sourceFileName: normalizeNullableText(input.job.source_file_name),
    sourceFileNamesByPage: input.sourceFile.sourceFileNamesByPage,
    parseWarnings: [],
  });
  const tablesCount = normalized.exchange.tables?.length ?? 0;

  return {
    normalizedExchange: normalized.exchange,
    itemsForInsert: normalized.itemsForInsert,
    tokenCount: tokenUsage.totalTokens,
    tokenUsage,
    costCents,
    durationMs,
    tablesCount,
    pageCount,
    chunksCount: chunks.length,
    chunkMetrics,
    providerMeta: {
      file_type: input.sourceFile.mimeType,
      source_file_name: input.sourceFile.fileName,
      delivery_mode: input.deliveryMode,
      processing_mode: chunks.length > 1 ? "pdf_vision_chunked" : "pdf_vision",
      page_count: pageCount,
      chunks_count: chunks.length,
      deduplicated_items: merged.deduplicatedItems,
      duplicate_items: merged.duplicateItems,
      chunking_config: {
        threshold_pages: levelCProcessingConfig.thresholdPages,
        chunk_size_pages: levelCProcessingConfig.chunkSizePages,
        chunk_overlap_pages: levelCProcessingConfig.overlapPages,
        max_pdf_pages: levelCProcessingConfig.maxPdfPages,
      },
      runtime_config: {
        timeout_ms: levelCProcessingConfig.timeoutMs,
        max_total_tokens: levelCProcessingConfig.maxTotalTokens,
        max_cost_cents: levelCProcessingConfig.maxCostCents,
      },
      token_usage: {
        input_tokens: tokenUsage.inputTokens,
        reasoning_tokens: tokenUsage.reasoningTokens,
        output_tokens: tokenUsage.outputTokens,
        total_tokens: tokenUsage.totalTokens,
      },
      chunks: chunkMetrics,
    },
  };
}

type ProcessLevelBGeminiAggregate = {
  normalizedExchange: TakeoffExchange;
  itemsForInsert: NormalizedTakeoffItemForInsert[];
  tokenCount: number;
  tokenUsage: GeminiTokenUsageBreakdown;
  costCents: number;
  durationMs: number;
  tablesCount: number;
  pageCount: number | null;
  chunksCount: number;
  model: string;
  thinkingLevel: GeminiThinkingLevel;
  promptVersion: string;
  providerMeta: Record<string, unknown>;
};

type PreparedTakeoffLevelInput = {
  files: Array<{ data: string; mimeType: string }>;
  parseWarnings: TakeoffWarning[];
  sourceHint: string;
  providerMeta: Record<string, unknown>;
};

function getProcessorLevelLabel(level: ProcessableTakeoffLevel) {
  return `Level ${level}`;
}

function isEscalationCandidateError(error: unknown) {
  const mapped = error instanceof TakeoffError ? error : toTakeoffError(error);
  return (
    mapped.code === TakeoffErrorCode.AI_SCHEMA ||
    mapped.code === TakeoffErrorCode.AI_TIMEOUT
  );
}

function canUseEscalationBudget(
  config: TakeoffEscalationConfig,
  spentCostCents: number
) {
  if (!config.enabled) return false;
  return spentCostCents < config.maxCostCents;
}

type TakeoffEscalationBudgetDecisionReason =
  | "within_budget"
  | "budget_blocked"
  | "escalation_disabled";

type TakeoffEscalationBudgetDecision = {
  decision: "allow" | "block";
  reason: TakeoffEscalationBudgetDecisionReason;
  observedCostCents: number;
  estimatedEscalationCostCents: number;
  projectedTotalCostCents: number;
  maxAllowedCostCents: number;
};

function estimateGeminiCostCentsForUsage(input: {
  model: string;
  tokenUsage: GeminiTokenUsageBreakdown;
}) {
  const normalizedModel = input.model.trim().toLowerCase();
  let pricing: { input: number; output: number } | null = null;

  if (normalizedModel === "gemini-3.1-pro-preview") {
    pricing =
      input.tokenUsage.inputTokens > 200_000
        ? { input: 4, output: 18 }
        : { input: 2, output: 12 };
  } else if (normalizedModel === "gemini-3-flash-preview") {
    pricing = { input: 0.5, output: 3 };
  } else if (normalizedModel === "gemini-3.1-flash-lite-preview") {
    pricing = { input: 0.25, output: 1.5 };
  } else if (normalizedModel === "gemini-3-pro-preview") {
    pricing = { input: 2, output: 12 };
  }

  if (!pricing) {
    return 0;
  }

  const usd =
    (input.tokenUsage.inputTokens / 1_000_000) * pricing.input +
    (input.tokenUsage.outputTokens / 1_000_000) * pricing.output;

  return Math.max(0, Math.round(usd * 100));
}

function evaluateEscalationBudget(input: {
  config: TakeoffEscalationConfig;
  observedCostCents: number;
  estimatedEscalationCostCents: number;
}): TakeoffEscalationBudgetDecision {
  const observedCostCents = Math.max(0, Math.trunc(input.observedCostCents));
  const estimatedEscalationCostCents = Math.max(
    0,
    Math.trunc(input.estimatedEscalationCostCents)
  );
  const projectedTotalCostCents = observedCostCents + estimatedEscalationCostCents;

  if (!input.config.enabled) {
    return {
      decision: "block",
      reason: "escalation_disabled",
      observedCostCents,
      estimatedEscalationCostCents,
      projectedTotalCostCents,
      maxAllowedCostCents: input.config.maxCostCents,
    };
  }

  if (projectedTotalCostCents > input.config.maxCostCents) {
    return {
      decision: "block",
      reason: "budget_blocked",
      observedCostCents,
      estimatedEscalationCostCents,
      projectedTotalCostCents,
      maxAllowedCostCents: input.config.maxCostCents,
    };
  }

  return {
    decision: "allow",
    reason: "within_budget",
    observedCostCents,
    estimatedEscalationCostCents,
    projectedTotalCostCents,
    maxAllowedCostCents: input.config.maxCostCents,
  };
}

function sumGeminiTokenUsage(
  ...usages: readonly GeminiTokenUsageBreakdown[]
): GeminiTokenUsageBreakdown {
  return usages.reduce<GeminiTokenUsageBreakdown>(
    (accumulator, usage) => ({
      inputTokens: accumulator.inputTokens + usage.inputTokens,
      reasoningTokens: accumulator.reasoningTokens + usage.reasoningTokens,
      outputTokens: accumulator.outputTokens + usage.outputTokens,
      totalTokens: accumulator.totalTokens + usage.totalTokens,
    }),
    {
      inputTokens: 0,
      reasoningTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    }
  );
}

function shouldEscalateLevelBResult(
  result: ProcessLevelBGeminiAggregate,
  config: TakeoffEscalationConfig
) {
  if (!config.enabled) {
    return false;
  }

  const confidence =
    typeof result.normalizedExchange.confidence === "number"
      ? result.normalizedExchange.confidence
      : null;

  if (confidence !== null && confidence < config.minConfidence) {
    return true;
  }

  if (result.tablesCount === 0) return true;
  if (result.itemsForInsert.length === 0) return true;
  return result.normalizedExchange.warnings.some(
    (warning) => warning.severity === "error"
  );
}

type StructuredTakeoffRunResult = {
  normalizedExchange: TakeoffExchange;
  itemsForInsert: NormalizedTakeoffItemForInsert[];
  tokenCount: number;
  tokenUsage: GeminiTokenUsageBreakdown;
  costCents: number;
  durationMs: number;
  tablesCount: number;
  model: string;
  thinkingLevel: GeminiThinkingLevel;
  promptVersion: string;
  providerMeta: Record<string, unknown>;
};

function assertPdfResultIsInterpretable(input: {
  job: TakeoffJobProcessingRow;
  level: "B" | "C";
  sourceFile: DownloadedTakeoffFile;
  tablesCount: number;
  itemsCount: number;
  providerMeta?: Record<string, unknown>;
}) {
  const isInterpretable =
    input.level === "C"
      ? input.itemsCount > 0
      : input.tablesCount > 0 && input.itemsCount > 0;

  if (isInterpretable) {
    return;
  }

  throw new TakeoffError({
    code: TakeoffErrorCode.TAKEOFF_PDF_NOT_INTERPRETABLE,
    message: buildTakeoffPdfNotInterpretableMessage(input.level),
    retryable: false,
    jobId: input.job.id,
    level: input.level,
    details: {
      source_file_name: input.sourceFile.fileName,
      tables_count: input.tablesCount,
      items_count: input.itemsCount,
      provider_meta: input.providerMeta ?? null,
    },
  });
}

async function processLevelBGeminiChunks(input: {
  supabase: Supabase;
  job: TakeoffJobProcessingRow;
  sourceFile: DownloadedTakeoffFile;
  callGemini: CallGeminiStructuredFn;
  schemaVersion: string;
  model: string;
  promptVersion: string;
  thinkingLevel: GeminiThinkingLevel;
  deliveryMode: GeminiDeliveryMode;
  onBatchLifecycleEvent?: (
    event: GeminiBatchLifecycleEvent
  ) => Promise<void>;
}): Promise<ProcessLevelBGeminiAggregate> {
  if (!isPdfMimeType(input.sourceFile.mimeType)) {
    throw new TakeoffError({
      code: TakeoffErrorCode.TAKEOFF_FILE_TYPE_INVALID,
      message: "Le processor Level B requiert un fichier PDF source.",
      retryable: false,
      jobId: input.job.id,
      level: TAKEOFF_LEVEL_B,
      details: {
        file_type: input.sourceFile.mimeType,
        source_file_name: input.sourceFile.fileName,
      },
    });
  }

  const chunkingConfig = await getTakeoffChunkingConfigForTenant(input.job.tenant_id, {
    supabase: input.supabase,
  });

  let pageCount: number | null = null;
  try {
    pageCount = await getPdfPageCount(input.sourceFile.bytes);
  } catch {
    const pdfInspection = await inspectTakeoffPdfBytes(input.sourceFile.bytes);
    throw new TakeoffError({
      code: TakeoffErrorCode.TAKEOFF_PDF_CORRUPTED,
      message: pdfInspection.valid
        ? "Le PDF est invalide ou incomplet. Reexportez-le avant de relancer l'analyse."
        : pdfInspection.message,
      retryable: false,
      jobId: input.job.id,
      level: TAKEOFF_LEVEL_B,
      details: pdfInspection.valid
        ? {
            reason: "invalid_pdf_page_count",
            source_file_name: input.sourceFile.fileName,
          }
        : pdfInspection.details,
    });
  }

  if (pageCount !== null && pageCount > chunkingConfig.maxPdfPages) {
    throw new TakeoffError({
      status: 413,
      code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE,
      message: `Le PDF contient ${pageCount} pages et depasse la limite de ${chunkingConfig.maxPdfPages} pages.`,
      retryable: false,
      jobId: input.job.id,
      level: TAKEOFF_LEVEL_B,
      details: {
        page_count: pageCount,
        max_pdf_pages: chunkingConfig.maxPdfPages,
      },
    });
  }

  if (pageCount !== null) {
    await upsertDetectedPlanFilePageCount({
      supabase: input.supabase,
      tenantId: input.job.tenant_id,
      sourceFilePath: input.job.source_file_path,
      pageCount,
    });
  }

  const chunks: TakeoffPdfChunk[] =
    pageCount !== null
      ? buildPdfChunks(pageCount, {
          thresholdPages: chunkingConfig.thresholdPages,
          chunkSizePages: chunkingConfig.chunkSizePages,
          overlapPages: chunkingConfig.overlapPages,
        })
      : [{ index: 0, startPage: 1, endPage: 1 }];

  const chunkExchanges: Array<{
    chunk: TakeoffPdfChunk;
    exchange: TakeoffExchange;
  }> = [];
  const tokenUsage: GeminiTokenUsageBreakdown = {
    inputTokens: 0,
    reasoningTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
  let costCents = 0;
  let durationMs = 0;

  for (const chunk of chunks) {
    const sourceHint =
      pageCount !== null
        ? createChunkPromptSourceHint({
            fileName: input.sourceFile.fileName,
            chunk,
            totalChunks: chunks.length,
          })
        : input.sourceFile.fileName;
    const prompt = getTakeoffPrompt(TAKEOFF_LEVEL_B, {
      fileType: input.sourceFile.mimeType,
      schemaVersion: input.schemaVersion,
      sourceHint,
    });
    const bytesForChunk =
      pageCount !== null
        ? await createPdfChunkBytes({
            bytes: input.sourceFile.bytes,
            chunk,
          })
        : new Uint8Array(input.sourceFile.bytes);

    const geminiResult = await input.callGemini<TakeoffExchange>({
      prompt,
      schema: TakeoffChunkExchangeSchema,
      files: [
        {
          data: Buffer.from(bytesForChunk).toString("base64"),
          mimeType: "application/pdf",
        },
      ],
      thinkingLevel: input.thinkingLevel,
      timeoutMs: resolveGeminiTimeoutMs(),
      deliveryMode: input.deliveryMode,
      onBatchLifecycleEvent: input.onBatchLifecycleEvent,
      context: {
        jobId: input.job.id,
        tenantId: input.job.tenant_id,
        level: TAKEOFF_LEVEL_B,
        promptVersion: input.promptVersion,
        model: input.model,
      },
    });

    const parsedExchange = TakeoffChunkExchangeSchema.parse(geminiResult.data);
    chunkExchanges.push({
      chunk,
      exchange:
        pageCount !== null
          ? remapChunkLocalPagesToAbsolute({
              chunk,
              exchange: parsedExchange,
            })
          : parsedExchange,
    });

    tokenUsage.inputTokens += geminiResult.tokenUsage.inputTokens;
    tokenUsage.reasoningTokens += geminiResult.tokenUsage.reasoningTokens;
    tokenUsage.outputTokens += geminiResult.tokenUsage.outputTokens;
    tokenUsage.totalTokens += geminiResult.tokenUsage.totalTokens;
    costCents += geminiResult.costCents;
    durationMs += geminiResult.durationMs;
  }

  const merged =
    chunkExchanges.length > 1
      ? mergeTakeoffChunkExchanges(chunkExchanges)
      : {
          exchange: chunkExchanges[0].exchange,
          deduplicatedItems: chunkExchanges[0].exchange.items.length,
          duplicateItems: 0,
        };
  const strictMergedExchange = TakeoffExchangeSchema.parse({
    ...merged.exchange,
    tables: dedupeLevelBTables(merged.exchange.tables),
  });
  const normalized = normalizeTakeoffExchange({
    exchange: strictMergedExchange,
    sourceFileName: normalizeNullableText(input.job.source_file_name),
    sourceFileNamesByPage: input.sourceFile.sourceFileNamesByPage,
    parseWarnings: [],
  });
  const tablesCount = normalized.exchange.tables?.length ?? 0;

  const providerMeta: Record<string, unknown> = {
    file_type: input.sourceFile.mimeType,
    source_file_name: input.sourceFile.fileName,
    delivery_mode: input.deliveryMode,
    processing_mode: chunkExchanges.length > 1 ? "pdf_vision_chunked" : "pdf_vision",
    chunks_count: chunkExchanges.length,
    deduplicated_items: merged.deduplicatedItems,
    duplicate_items: merged.duplicateItems,
  };

  if (pageCount !== null) {
    providerMeta.page_count = pageCount;
    providerMeta.chunking_config = {
      threshold_pages: chunkingConfig.thresholdPages,
      chunk_size_pages: chunkingConfig.chunkSizePages,
      chunk_overlap_pages: chunkingConfig.overlapPages,
      max_pdf_pages: chunkingConfig.maxPdfPages,
    };
  }

  return {
    normalizedExchange: normalized.exchange,
    itemsForInsert: normalized.itemsForInsert,
    tokenCount: tokenUsage.totalTokens,
    tokenUsage,
    costCents,
    durationMs,
    tablesCount,
    pageCount,
    chunksCount: chunkExchanges.length,
    model: input.model,
    thinkingLevel: input.thinkingLevel,
    promptVersion: input.promptVersion,
    providerMeta,
  };
}

async function finalizeCompletedLevelAJob(input: {
  supabase: Supabase;
  tenantId: string | null;
  userId: string | null;
  job: TakeoffJobProcessingRow;
  processingStartedAt: Date;
  now: () => Date;
  levelAResult: StructuredTakeoffRunResult;
}): Promise<ProcessLevelCompletedResult> {
  const persisted = await persistTakeoffResultAndItems({
    supabase: input.supabase,
    job: input.job,
    exchange: input.levelAResult.normalizedExchange,
    itemsForInsert: input.levelAResult.itemsForInsert,
    tokenCount: input.levelAResult.tokenCount,
    costCents: input.levelAResult.costCents,
    durationMs: input.levelAResult.durationMs,
    rawResponse: null,
    providerMeta: {
      ...input.levelAResult.providerMeta,
      model: input.levelAResult.model,
      prompt_version: input.levelAResult.promptVersion,
      thinking_level: input.levelAResult.thinkingLevel,
      tables_count: input.levelAResult.tablesCount,
    },
    level: TAKEOFF_LEVEL_A,
  });

  const completedAt = input.now();
  const totalDurationMs = Math.max(
    input.levelAResult.durationMs,
    completedAt.getTime() - input.processingStartedAt.getTime()
  );

  await updateJobAsCompleted({
    supabase: input.supabase,
    job: input.job,
    tenantId: input.tenantId,
    completedAtIso: completedAt.toISOString(),
    tokenCount: input.levelAResult.tokenCount,
    costCents: input.levelAResult.costCents,
    durationMs: totalDurationMs,
    model: input.levelAResult.model,
    thinkingLevel: input.levelAResult.thinkingLevel,
    promptVersion: input.levelAResult.promptVersion,
    level: TAKEOFF_LEVEL_A,
  });

  await logCompletedAuditEvent({
    supabase: input.supabase,
    userId: input.userId,
    job: input.job,
    resultId: persisted.resultId,
    itemsCount: persisted.itemsCount,
    warningsCount: persisted.warningsCount,
    durationMs: totalDurationMs,
  });

  return {
    jobId: input.job.id,
    resultId: persisted.resultId,
    status: "completed",
    itemsCount: persisted.itemsCount,
    warningsCount: persisted.warningsCount,
    tokenCount: input.levelAResult.tokenCount,
    costCents: input.levelAResult.costCents,
    durationMs: totalDurationMs,
  };
}

async function executeStructuredTakeoffRun(input: {
  level: typeof TAKEOFF_LEVEL_A;
  job: TakeoffJobProcessingRow;
  sourceFile: DownloadedTakeoffFile;
  callGemini: CallGeminiStructuredFn;
  schemaVersion: string;
  modelConfig: TakeoffModelConfig;
  promptVersion: string;
  deliveryMode: GeminiDeliveryMode;
  onBatchLifecycleEvent?: (
    event: GeminiBatchLifecycleEvent
  ) => Promise<void>;
}): Promise<StructuredTakeoffRunResult> {
  const preparedLevelInput = prepareTakeoffLevelInput({
    sourceFile: input.sourceFile,
  });

  const prompt = getTakeoffPrompt(input.level, {
    fileType: input.sourceFile.mimeType,
    schemaVersion: input.schemaVersion,
    sourceHint: preparedLevelInput.sourceHint,
  });

  const geminiResult = await input.callGemini<TakeoffExchange>({
    prompt,
    schema: TakeoffExchangeSchema,
    files: preparedLevelInput.files,
    thinkingLevel: input.modelConfig.thinkingLevel,
    timeoutMs: resolveGeminiTimeoutMs(),
    deliveryMode: input.deliveryMode,
    onBatchLifecycleEvent: input.onBatchLifecycleEvent,
    context: {
      jobId: input.job.id,
      tenantId: input.job.tenant_id,
      level: input.level,
      promptVersion: input.promptVersion,
      model: input.modelConfig.model,
    },
  });

  const strictExchange = TakeoffExchangeSchema.parse(geminiResult.data);
  const normalized = normalizeTakeoffExchange({
    exchange: strictExchange,
    sourceFileName: normalizeNullableText(input.job.source_file_name),
    sourceFileNamesByPage: input.sourceFile.sourceFileNamesByPage,
    parseWarnings: preparedLevelInput.parseWarnings,
  });
  const tablesCount = normalized.exchange.tables?.length ?? 0;

  return {
    normalizedExchange: normalized.exchange,
    itemsForInsert: normalized.itemsForInsert,
    tokenCount: geminiResult.tokenCount,
    tokenUsage: geminiResult.tokenUsage,
    costCents: geminiResult.costCents,
    durationMs: geminiResult.durationMs,
    tablesCount,
    model: geminiResult.model,
    thinkingLevel: input.modelConfig.thinkingLevel,
    promptVersion: geminiResult.promptVersion,
    providerMeta: {
      ...preparedLevelInput.providerMeta,
      delivery_mode: input.deliveryMode,
      routing: {
        strategy: "single_model_with_fallback",
        selected_model: geminiResult.model,
        selected_thinking_level: input.modelConfig.thinkingLevel,
      },
    },
  };
}

async function executeLevelBWithRouting(input: {
  supabase: Supabase;
  job: TakeoffJobProcessingRow;
  sourceFile: DownloadedTakeoffFile;
  callGemini: CallGeminiStructuredFn;
  schemaVersion: string;
  primaryConfig: TakeoffModelConfig;
  primaryPromptVersion: string;
  escalationConfig: TakeoffEscalationModelConfig | null;
  escalationPolicy: TakeoffEscalationConfig;
  deliveryMode: GeminiDeliveryMode;
  onBatchLifecycleEvent?: (
    event: GeminiBatchLifecycleEvent
  ) => Promise<void>;
}): Promise<ProcessLevelBGeminiAggregate> {
  try {
    const primaryResult = await processLevelBGeminiChunks({
      supabase: input.supabase,
      job: input.job,
      sourceFile: input.sourceFile,
      callGemini: input.callGemini,
      schemaVersion: input.schemaVersion,
      model: input.primaryConfig.model,
      promptVersion: input.primaryPromptVersion,
      thinkingLevel: input.primaryConfig.thinkingLevel,
      deliveryMode: input.deliveryMode,
      onBatchLifecycleEvent: input.onBatchLifecycleEvent,
    });

    if (
      input.escalationConfig &&
      shouldEscalateLevelBResult(primaryResult, input.escalationPolicy)
    ) {
      const budgetDecision = evaluateEscalationBudget({
        config: input.escalationPolicy,
        observedCostCents: primaryResult.costCents,
        estimatedEscalationCostCents: estimateGeminiCostCentsForUsage({
          model: input.escalationConfig.model,
          tokenUsage: primaryResult.tokenUsage,
        }),
      });

      if (budgetDecision.decision === "block") {
        return {
          ...primaryResult,
          providerMeta: {
            ...primaryResult.providerMeta,
            routing: {
              strategy: "primary_then_escalation",
              primary_model: input.primaryConfig.model,
              primary_thinking_level: input.primaryConfig.thinkingLevel,
              escalation_candidate: true,
              escalated: false,
              escalation_trigger: "weak_level_b_result",
              escalation_block_reason: budgetDecision.reason,
              delivery_mode: input.deliveryMode,
              final_model: primaryResult.model,
              final_thinking_level: primaryResult.thinkingLevel,
              budget: {
                decision: budgetDecision.decision,
                reason: budgetDecision.reason,
                observed_cost_cents: budgetDecision.observedCostCents,
                estimated_escalation_cost_cents:
                  budgetDecision.estimatedEscalationCostCents,
                projected_total_cost_cents:
                  budgetDecision.projectedTotalCostCents,
                max_allowed_cost_cents: budgetDecision.maxAllowedCostCents,
              },
            },
          },
        };
      }

      const escalatedResult = await processLevelBGeminiChunks({
        supabase: input.supabase,
        job: input.job,
        sourceFile: input.sourceFile,
        callGemini: input.callGemini,
        schemaVersion: input.schemaVersion,
        model: input.escalationConfig.model,
        promptVersion: input.primaryPromptVersion,
        thinkingLevel: input.escalationConfig.thinkingLevel,
        deliveryMode: input.deliveryMode,
        onBatchLifecycleEvent: input.onBatchLifecycleEvent,
      });

      return {
        ...escalatedResult,
        tokenCount: primaryResult.tokenCount + escalatedResult.tokenCount,
        tokenUsage: sumGeminiTokenUsage(primaryResult.tokenUsage, escalatedResult.tokenUsage),
        costCents: primaryResult.costCents + escalatedResult.costCents,
        durationMs: primaryResult.durationMs + escalatedResult.durationMs,
        providerMeta: {
          ...escalatedResult.providerMeta,
          routing: {
            strategy: "primary_then_escalation",
            primary_model: input.primaryConfig.model,
            primary_thinking_level: input.primaryConfig.thinkingLevel,
            escalated: true,
            escalation_reason: input.escalationConfig.reason,
            escalation_trigger: "weak_level_b_result",
            delivery_mode: input.deliveryMode,
            final_model: escalatedResult.model,
            final_thinking_level: escalatedResult.thinkingLevel,
            budget: {
              decision: budgetDecision.decision,
              reason: budgetDecision.reason,
              observed_cost_cents: budgetDecision.observedCostCents,
              estimated_escalation_cost_cents:
                budgetDecision.estimatedEscalationCostCents,
              projected_total_cost_cents:
                budgetDecision.projectedTotalCostCents,
              max_allowed_cost_cents: budgetDecision.maxAllowedCostCents,
            },
          },
        },
      };
    }

    return {
      ...primaryResult,
      providerMeta: {
        ...primaryResult.providerMeta,
        routing: {
          strategy: "primary_then_escalation",
          primary_model: input.primaryConfig.model,
          primary_thinking_level: input.primaryConfig.thinkingLevel,
          escalated: false,
          delivery_mode: input.deliveryMode,
          final_model: primaryResult.model,
          final_thinking_level: primaryResult.thinkingLevel,
        },
      },
    };
  } catch (error) {
    if (
      !input.escalationConfig ||
      !canUseEscalationBudget(input.escalationPolicy, 0) ||
      !isEscalationCandidateError(error)
    ) {
      throw error;
    }

    const escalatedResult = await processLevelBGeminiChunks({
      supabase: input.supabase,
      job: input.job,
      sourceFile: input.sourceFile,
      callGemini: input.callGemini,
      schemaVersion: input.schemaVersion,
      model: input.escalationConfig.model,
      promptVersion: input.primaryPromptVersion,
      thinkingLevel: input.escalationConfig.thinkingLevel,
      deliveryMode: input.deliveryMode,
      onBatchLifecycleEvent: input.onBatchLifecycleEvent,
    });

    return {
      ...escalatedResult,
      providerMeta: {
        ...escalatedResult.providerMeta,
        routing: {
          strategy: "primary_then_escalation",
          primary_model: input.primaryConfig.model,
          primary_thinking_level: input.primaryConfig.thinkingLevel,
          escalated: true,
          escalation_reason: input.escalationConfig.reason,
          escalation_trigger: "primary_model_error",
          delivery_mode: input.deliveryMode,
          final_model: escalatedResult.model,
          final_thinking_level: escalatedResult.thinkingLevel,
        },
      },
    };
  }
}

function prepareTakeoffLevelInput(input: {
  sourceFile: DownloadedTakeoffFile;
}): PreparedTakeoffLevelInput {
  const parsedWorkbook = parseTakeoffWorkbook({
    bytes: input.sourceFile.bytes,
    fileName: input.sourceFile.fileName,
  });

  return {
    files: parsedWorkbook.sheets.map((sheet) => ({
      data: Buffer.from(sheet.csvText, "utf8").toString("base64"),
      mimeType: "text/csv",
    })),
    parseWarnings: parsedWorkbook.warnings,
    sourceHint: buildPromptSourceHint(input.sourceFile.fileName, parsedWorkbook.sheets),
    providerMeta: {
      file_type: input.sourceFile.mimeType,
      source_file_name: input.sourceFile.fileName,
      sheet_count: parsedWorkbook.sheets.length,
      sheets: parsedWorkbook.sheets.map((sheet) => ({
        name: sheet.sheetName,
        header_row_index: sheet.headerRowIndex,
        rows: sheet.rows.length,
        columns: sheet.headers.length,
      })),
    },
  };
}

async function processTakeoffLevel(
  level: ProcessableTakeoffLevel,
  jobId: string,
  options: ProcessLevelAOptions = {}
): Promise<ProcessLevelInternalResult> {
  const normalizedJobId = jobId.trim();
  if (normalizedJobId.length === 0) {
    throw new TakeoffError({
      code: TakeoffErrorCode.BAD_REQUEST,
      message: "jobId est requis.",
      retryable: false,
      level,
    });
  }

  const context = await resolveContext(options);
  const callGemini = options.callGemini ?? callGeminiStructured;
  const submitGeminiBatch = options.submitGeminiBatch ?? submitGeminiBatchStructured;
  const now = options.now ?? (() => new Date());
  let levelConfig = getTakeoffLevelConfig(level);
  const escalationConfig = getTakeoffEscalationModelConfig(level);
  const processingStartedAt = now();
  let attemptedModel = levelConfig.model;
  let attemptedThinkingLevel = levelConfig.thinkingLevel;
  let attemptedPromptVersion: string = levelConfig.promptVersion;
  let processingStrategy: TakeoffProcessingStrategy | null = null;

  let job: TakeoffJobProcessingRow | null = null;
  let enteredProcessing = false;
  let levelCChunkMetrics: LevelCChunkMetric[] = [];
  let levelCRunMetricsPersisted = false;
  let levelCSourceFileName: string | null = null;

  try {
    job = await getTakeoffJobForProcessing({
      supabase: context.supabase,
      jobId: normalizedJobId,
      tenantId: context.tenantId,
      level,
    });

    if (job.level !== level) {
      throw new TakeoffError({
        code: TakeoffErrorCode.TAKEOFF_LEVEL_UNSUPPORTED,
        message: `Le processor ${getProcessorLevelLabel(
          level
        )} ne peut traiter que les jobs de niveau ${level}.`,
        retryable: false,
        jobId: normalizedJobId,
        level,
      });
    }

    const geminiDeliveryConfig = await getTakeoffGeminiDeliveryConfigForTenant(
      job.tenant_id,
      level,
      {
        supabase: context.supabase,
      }
    );
    const escalationPolicy = await getTakeoffEscalationConfigForTenant(job.tenant_id, {
      supabase: context.supabase,
    });
    levelConfig = getTakeoffLevelConfig(level, {
      preferEscalationPrimary: escalationPolicy.enabled && escalationConfig !== null,
    });
    const requestedProcessingStrategy =
      job.processing_strategy ??
      resolveTakeoffProcessingStrategy(geminiDeliveryConfig.useBatchApi);
    processingStrategy = resolveExecutableTakeoffProcessingStrategy(
      level,
      requestedProcessingStrategy
    );

    job = await markJobAsProcessing({
      supabase: context.supabase,
      job,
      tenantId: context.tenantId,
      startedAtIso: processingStartedAt.toISOString(),
      processingStrategy,
      model: levelConfig.model,
      thinkingLevel: levelConfig.thinkingLevel,
      promptVersion: levelConfig.promptVersion,
      level,
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
      level,
    });
    if (level === TAKEOFF_LEVEL_C) {
      levelCSourceFileName = sourceFile.fileName;
    }
    const schemaVersion = normalizeNullableText(job.schema_version) ?? "v1";
    const deliveryMode: GeminiDeliveryMode = processingStrategy;
    const onBatchLifecycleEvent =
      deliveryMode === "batch"
        ? async (event: GeminiBatchLifecycleEvent) => {
            if (!job) {
              return;
            }
            job = await persistGeminiBatchLifecycleEvent({
              supabase: context.supabase,
              job,
              event,
            });
          }
        : undefined;

    if (level === TAKEOFF_LEVEL_C) {
      const levelCResult = await processLevelCGeminiChunks({
        supabase: context.supabase,
        job,
        sourceFile,
        callGemini,
        schemaVersion,
        model: levelConfig.model,
        promptVersion: levelConfig.promptVersion,
        thinkingLevel: levelConfig.thinkingLevel,
        deliveryMode,
        onBatchLifecycleEvent,
      });
      levelCChunkMetrics = cloneLevelCChunkMetrics(levelCResult.chunkMetrics);

      assertPdfResultIsInterpretable({
        job,
        level: TAKEOFF_LEVEL_C,
        sourceFile,
        tablesCount: levelCResult.tablesCount,
        itemsCount: levelCResult.itemsForInsert.length,
        providerMeta: levelCResult.providerMeta,
      });

      const persisted = await persistTakeoffResultAndItems({
        supabase: context.supabase,
        job,
        exchange: levelCResult.normalizedExchange,
        itemsForInsert: levelCResult.itemsForInsert,
        tokenCount: levelCResult.tokenCount,
        costCents: levelCResult.costCents,
        durationMs: levelCResult.durationMs,
        rawResponse: null,
        providerMeta: {
          ...levelCResult.providerMeta,
          model: levelConfig.model,
          prompt_version: levelConfig.promptVersion,
          thinking_level: levelConfig.thinkingLevel,
          tables_count: levelCResult.tablesCount,
        },
        level,
      });

      await persistLevelCRunMetrics({
        supabase: context.supabase,
        job,
        resultId: persisted.resultId,
        metrics: levelCResult.chunkMetrics,
        hint: {
          sourceFileName: sourceFile.fileName,
        },
      });
      levelCRunMetricsPersisted = true;

      const completedAt = now();
      const totalDurationMs = Math.max(
        levelCResult.durationMs,
        completedAt.getTime() - processingStartedAt.getTime()
      );

      await updateJobAsCompleted({
        supabase: context.supabase,
        job,
        tenantId: context.tenantId,
        completedAtIso: completedAt.toISOString(),
        tokenCount: levelCResult.tokenCount,
        costCents: levelCResult.costCents,
        durationMs: totalDurationMs,
        model: levelConfig.model,
        thinkingLevel: levelConfig.thinkingLevel,
        promptVersion: levelConfig.promptVersion,
        level,
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
        tokenCount: levelCResult.tokenCount,
        costCents: levelCResult.costCents,
        durationMs: totalDurationMs,
        tablesCount: levelCResult.tablesCount,
        chunksCount: levelCResult.chunksCount,
        pageCount: levelCResult.pageCount,
        metricsSummary: levelCResult.tokenUsage,
      };
    }

    if (level === TAKEOFF_LEVEL_B) {
      const levelBResult = await executeLevelBWithRouting({
        supabase: context.supabase,
        job,
        sourceFile,
        callGemini,
        schemaVersion,
        primaryConfig: levelConfig,
        primaryPromptVersion: levelConfig.promptVersion,
        escalationConfig,
        escalationPolicy,
        deliveryMode,
        onBatchLifecycleEvent,
      });
      attemptedModel = levelBResult.model;
      attemptedThinkingLevel = levelBResult.thinkingLevel;
      attemptedPromptVersion = levelBResult.promptVersion;

      assertPdfResultIsInterpretable({
        job,
        level: TAKEOFF_LEVEL_B,
        sourceFile,
        tablesCount: levelBResult.tablesCount,
        itemsCount: levelBResult.itemsForInsert.length,
        providerMeta: levelBResult.providerMeta,
      });

      const persisted = await persistTakeoffResultAndItems({
        supabase: context.supabase,
        job,
        exchange: levelBResult.normalizedExchange,
        itemsForInsert: levelBResult.itemsForInsert,
        tokenCount: levelBResult.tokenCount,
        costCents: levelBResult.costCents,
        durationMs: levelBResult.durationMs,
        rawResponse: null,
        providerMeta: {
          ...levelBResult.providerMeta,
          model: levelBResult.model,
          prompt_version: levelBResult.promptVersion,
          thinking_level: levelBResult.thinkingLevel,
          tables_count: levelBResult.tablesCount,
        },
        level,
      });

      const completedAt = now();
      const totalDurationMs = Math.max(
        levelBResult.durationMs,
        completedAt.getTime() - processingStartedAt.getTime()
      );

      await updateJobAsCompleted({
        supabase: context.supabase,
        job,
        tenantId: context.tenantId,
        completedAtIso: completedAt.toISOString(),
        tokenCount: levelBResult.tokenCount,
        costCents: levelBResult.costCents,
        durationMs: totalDurationMs,
        model: levelBResult.model,
        thinkingLevel: levelBResult.thinkingLevel,
        promptVersion: levelBResult.promptVersion,
        level,
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
        tokenCount: levelBResult.tokenCount,
        costCents: levelBResult.costCents,
        durationMs: totalDurationMs,
        tablesCount: levelBResult.tablesCount,
      };
    }

    if (deliveryMode === "batch") {
      const preparedLevelInput = prepareTakeoffLevelInput({
        sourceFile,
      });
      const prompt = getTakeoffPrompt(TAKEOFF_LEVEL_A, {
        fileType: sourceFile.mimeType,
        schemaVersion,
        sourceHint: preparedLevelInput.sourceHint,
      });
      const submission = await submitGeminiBatch<TakeoffExchange>({
        prompt,
        schema: TakeoffExchangeSchema,
        files: preparedLevelInput.files,
        thinkingLevel: levelConfig.thinkingLevel,
        timeoutMs: resolveGeminiTimeoutMs(),
        onBatchLifecycleEvent,
        context: {
          jobId: job.id,
          tenantId: job.tenant_id,
          level: TAKEOFF_LEVEL_A,
          promptVersion: levelConfig.promptVersion,
          model: levelConfig.model,
        },
      });
      try {
        job = await scheduleBatchReconcile({
          supabase: context.supabase,
          job,
          tenantId: context.tenantId,
          dueAtIso: now().toISOString(),
        });
      } catch (error) {
        const scheduleError = toTakeoffError(error, {
          fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
          fallbackMessage:
            "Impossible de planifier la reconciliation provider du job takeoff.",
          jobId: job.id,
          level,
        });

        if (!canRecoverAcceptedBatchSubmission({ error: scheduleError, job, submission })) {
          throw scheduleError;
        }

        console.warn(
          "Takeoff batch accepted by provider but reconcile scheduling failed; keeping job in processing for recovery.",
          {
            job_id: job.id,
            tenant_id: job.tenant_id,
            provider_batch_id: submission.providerBatchId,
            provider_batch_state: job.provider_batch_state,
            error_code: scheduleError.code,
          }
        );
      }

      return {
        jobId: job.id,
        status: "submitted_to_provider",
        providerBatchId: submission.providerBatchId,
        providerBatchStateRaw: submission.providerBatchStateRaw,
        durationMs: Math.max(
          submission.durationMs,
          now().getTime() - processingStartedAt.getTime()
        ),
      };
    }

    let levelAResult: StructuredTakeoffRunResult;
    try {
      attemptedModel = levelConfig.model;
      attemptedThinkingLevel = levelConfig.thinkingLevel;
      attemptedPromptVersion = levelConfig.promptVersion;
      levelAResult = await executeStructuredTakeoffRun({
        level: TAKEOFF_LEVEL_A,
        job,
        sourceFile,
        callGemini,
        schemaVersion,
        modelConfig: levelConfig,
        promptVersion: levelConfig.promptVersion,
        deliveryMode,
        onBatchLifecycleEvent,
      });
    } catch (error) {
      if (
        level !== TAKEOFF_LEVEL_A ||
        !escalationConfig ||
        !canUseEscalationBudget(escalationPolicy, 0) ||
        !isEscalationCandidateError(error)
      ) {
        throw error;
      }

      attemptedModel = escalationConfig.model;
      attemptedThinkingLevel = escalationConfig.thinkingLevel;
      levelAResult = await executeStructuredTakeoffRun({
        level: TAKEOFF_LEVEL_A,
        job,
        sourceFile,
        callGemini,
        schemaVersion,
        modelConfig: escalationConfig,
        promptVersion: levelConfig.promptVersion,
        deliveryMode,
        onBatchLifecycleEvent,
      });

      levelAResult = {
        ...levelAResult,
        providerMeta: {
          ...levelAResult.providerMeta,
          routing: {
            strategy: "single_model_with_fallback",
            primary_model: levelConfig.model,
            primary_thinking_level: levelConfig.thinkingLevel,
            escalated: true,
            escalation_reason: escalationConfig.reason,
            escalation_trigger: "primary_model_error",
            delivery_mode: deliveryMode,
            final_model: levelAResult.model,
            final_thinking_level: levelAResult.thinkingLevel,
          },
        },
      };
    }

    return await finalizeCompletedLevelAJob({
      supabase: context.supabase,
      tenantId: context.tenantId,
      userId: actorUserId,
      job,
      processingStartedAt,
      now,
      levelAResult,
    });
  } catch (error) {
    const levelCChunkMetricsFromError =
      level === TAKEOFF_LEVEL_C ? extractLevelCChunkMetricsFromError(error) : [];
    const chunkMetricsToPersist =
      levelCChunkMetricsFromError.length > 0
        ? levelCChunkMetricsFromError
        : cloneLevelCChunkMetrics(levelCChunkMetrics);

    const mappedError = toTakeoffError(error, {
      fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
      jobId: normalizedJobId,
      level,
    });

    if (enteredProcessing && job && !isCanceledDuringProcessingConflict(mappedError)) {
      const completedAt = now();
      const durationMs = Math.max(0, completedAt.getTime() - processingStartedAt.getTime());

      const skipFailureSnapshotPersist =
        level === TAKEOFF_LEVEL_A && hasAtomicPersistenceRollbackError(mappedError);

      const failureSnapshotClearedResults = skipFailureSnapshotPersist
        ? false
        : await persistFailureSnapshotIfNeeded({
            supabase: context.supabase,
            job,
            error: mappedError,
            durationMs,
            model: attemptedModel,
            promptVersion: attemptedPromptVersion,
            thinkingLevel: attemptedThinkingLevel,
            level,
          });

      await updateJobAsFailed({
        supabase: context.supabase,
        job,
        tenantId: context.tenantId,
        completedAtIso: completedAt.toISOString(),
        durationMs,
        error: mappedError,
      });

      if (
        level === TAKEOFF_LEVEL_C &&
        (!levelCRunMetricsPersisted || failureSnapshotClearedResults) &&
        chunkMetricsToPersist.length > 0
      ) {
        await persistLevelCRunMetrics({
          supabase: context.supabase,
          job,
          metrics: chunkMetricsToPersist,
          hint: {
            sourceFileName:
              levelCSourceFileName ??
              normalizeNullableText(job.source_file_name) ??
              "unknown",
            errorDetails: mappedError.details,
          },
        });
      }

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

export async function processLevelA(
  jobId: string,
  options: ProcessLevelAOptions = {}
): Promise<ProcessLevelAResult> {
  const result = await processTakeoffLevel(TAKEOFF_LEVEL_A, jobId, options);
  if (result.status === "submitted_to_provider") {
    return result;
  }

  return {
    jobId: result.jobId,
    resultId: result.resultId,
    status: result.status,
    itemsCount: result.itemsCount,
    warningsCount: result.warningsCount,
    tokenCount: result.tokenCount,
    costCents: result.costCents,
    durationMs: result.durationMs,
  };
}

export async function reconcileTakeoffBatchJob(
  jobId: string,
  options: ProcessLevelAOptions = {}
): Promise<ProcessLevelCompletedResult | ProcessLevelAwaitingProviderResult> {
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
  const pollGeminiBatchOnce = options.pollGeminiBatchOnce ?? pollGeminiBatchStructuredOnce;
  const now = options.now ?? (() => new Date());
  const processingStartedAt = now();
  let job = await getTakeoffJobForProcessing({
    supabase: context.supabase,
    jobId: normalizedJobId,
    tenantId: context.tenantId,
    level: TAKEOFF_LEVEL_A,
  });

  const defaultLevelConfig = getTakeoffLevelConfig(TAKEOFF_LEVEL_A);
  const model = normalizeNullableText(job.model) ?? defaultLevelConfig.model;
  const thinkingLevel = normalizeGeminiThinkingLevel(
    normalizeNullableText(job.thinking_level),
    defaultLevelConfig.thinkingLevel
  );
  const promptVersion =
    normalizeNullableText(job.prompt_version) ?? defaultLevelConfig.promptVersion;

  if (job.level !== TAKEOFF_LEVEL_A) {
    throw new TakeoffError({
      code: TakeoffErrorCode.TAKEOFF_LEVEL_UNSUPPORTED,
      message: "La reconciliation batch durable est uniquement supportee pour le niveau A.",
      retryable: false,
      jobId: normalizedJobId,
      level: TAKEOFF_LEVEL_A,
    });
  }

  if (job.status !== "processing") {
    throw new TakeoffError({
      code: TakeoffErrorCode.CONFLICT,
      message: "Le job n'est plus en cours de traitement batch.",
      retryable: false,
      jobId: normalizedJobId,
      level: TAKEOFF_LEVEL_A,
    });
  }

  if (job.processing_strategy !== "batch" || !job.provider_batch_id) {
    throw new TakeoffError({
      code: TakeoffErrorCode.BAD_REQUEST,
      message: "Le job ne possede pas de batch provider reconcilable.",
      retryable: false,
      jobId: normalizedJobId,
      level: TAKEOFF_LEVEL_A,
    });
  }

  const actorUserId = context.userId ?? job.created_by;

  try {
    const pollResult = await pollGeminiBatchOnce<TakeoffExchange>({
      prompt: "takeoff batch reconcile",
      schema: TakeoffExchangeSchema,
      providerBatchId: job.provider_batch_id,
      timeoutMs: resolveGeminiTimeoutMs(),
      onBatchLifecycleEvent: async (event: GeminiBatchLifecycleEvent) => {
        job = await persistGeminiBatchLifecycleEvent({
          supabase: context.supabase,
          job,
          event,
        });
      },
      context: {
        jobId: job.id,
        tenantId: job.tenant_id,
        level: TAKEOFF_LEVEL_A,
        promptVersion,
        model,
      },
    });

    if (pollResult.status === "pending") {
      return {
        jobId: job.id,
        status: "awaiting_provider_result",
        providerBatchId: pollResult.providerBatchId,
        providerBatchStateRaw: pollResult.providerBatchStateRaw,
        durationMs: Math.max(
          pollResult.durationMs,
          now().getTime() - processingStartedAt.getTime()
        ),
      };
    }

    if (
      pollResult.status === "failed" ||
      pollResult.status === "cancelled" ||
      pollResult.status === "expired"
    ) {
      throw new TakeoffError({
        code: TakeoffErrorCode.AI_PROVIDER,
        message: `Le batch Gemini a termine avec l'etat ${pollResult.providerBatchStateRaw}.`,
        retryable: false,
        details: pollResult.details,
        jobId: job.id,
        level: TAKEOFF_LEVEL_A,
      });
    }

    if (pollResult.status !== "succeeded") {
      throw new TakeoffError({
        code: TakeoffErrorCode.AI_PROVIDER,
        message: "Etat batch Gemini inattendu lors de la reconciliation.",
        retryable: false,
        jobId: job.id,
        level: TAKEOFF_LEVEL_A,
      });
    }

    const sourceFile = await downloadTakeoffSourceFile({
      supabase: context.supabase,
      job,
      level: TAKEOFF_LEVEL_A,
    });
    const preparedLevelInput = prepareTakeoffLevelInput({
      sourceFile,
    });
    const strictExchange = TakeoffExchangeSchema.parse(pollResult.data);
    const normalized = normalizeTakeoffExchange({
      exchange: strictExchange,
      sourceFileName: normalizeNullableText(job.source_file_name),
      sourceFileNamesByPage: sourceFile.sourceFileNamesByPage,
      parseWarnings: preparedLevelInput.parseWarnings,
    });
    const levelAResult: StructuredTakeoffRunResult = {
      normalizedExchange: normalized.exchange,
      itemsForInsert: normalized.itemsForInsert,
      tokenCount: pollResult.tokenCount,
      tokenUsage: pollResult.tokenUsage,
      costCents: pollResult.costCents,
      durationMs: pollResult.durationMs,
      tablesCount: normalized.exchange.tables?.length ?? 0,
      model: pollResult.model,
      thinkingLevel,
      promptVersion: pollResult.promptVersion,
      providerMeta: {
        ...preparedLevelInput.providerMeta,
        delivery_mode: "batch",
        routing: {
          strategy: "single_model_with_fallback",
          selected_model: pollResult.model,
          selected_thinking_level: thinkingLevel,
        },
      },
    };

    return await finalizeCompletedLevelAJob({
      supabase: context.supabase,
      tenantId: context.tenantId,
      userId: actorUserId,
      job,
      processingStartedAt,
      now,
      levelAResult,
    });
  } catch (error) {
    const mappedError = toTakeoffError(error, {
      fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
      jobId: normalizedJobId,
      level: TAKEOFF_LEVEL_A,
    });

    if (mappedError.retryable) {
      throw mappedError;
    }

    const completedAt = now();
    await updateJobAsFailed({
      supabase: context.supabase,
      job,
      tenantId: context.tenantId,
      completedAtIso: completedAt.toISOString(),
      durationMs: Math.max(0, completedAt.getTime() - processingStartedAt.getTime()),
      error: mappedError,
    });

    await logFailedAuditEvent({
      supabase: context.supabase,
      userId: actorUserId,
      job,
      error: mappedError,
    });

    throw mappedError;
  }
}

export async function processLevelB(
  jobId: string,
  options: ProcessLevelBOptions = {}
): Promise<ProcessLevelBResult> {
  const result = await processTakeoffLevel(TAKEOFF_LEVEL_B, jobId, options);
  if (result.status !== "completed") {
    throw new TakeoffError({
      code: TakeoffErrorCode.INTERNAL_ERROR,
      message: "Le niveau B ne doit pas retourner un statut batch intermediaire.",
      retryable: false,
      jobId,
      level: TAKEOFF_LEVEL_B,
    });
  }

  return {
    ...result,
    tablesCount: result.tablesCount ?? 0,
  };
}

export async function processLevelC(
  jobId: string,
  options: ProcessLevelCOptions = {}
): Promise<ProcessLevelCResult> {
  const result = await processTakeoffLevel(TAKEOFF_LEVEL_C, jobId, options);
  if (result.status !== "completed") {
    throw new TakeoffError({
      code: TakeoffErrorCode.INTERNAL_ERROR,
      message: "Le niveau C ne doit pas retourner un statut batch intermediaire.",
      retryable: false,
      jobId,
      level: TAKEOFF_LEVEL_C,
    });
  }

  return {
    jobId: result.jobId,
    resultId: result.resultId,
    status: result.status,
    itemsCount: result.itemsCount,
    warningsCount: result.warningsCount,
    tokenCount: result.tokenCount,
    costCents: result.costCents,
    durationMs: result.durationMs,
    tablesCount: result.tablesCount ?? 0,
    chunksCount: result.chunksCount ?? 1,
    pageCount: result.pageCount ?? 0,
    metricsSummary: result.metricsSummary,
  };
}
