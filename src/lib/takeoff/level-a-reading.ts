import type { StructuredCall, TokenUsage } from "@/lib/ai/structured-call";
import {
  normalizeTakeoffExchange,
  takeoffSourceProvenance,
  type NormalizedTakeoffItemForInsert,
} from "@/lib/takeoff/exchange-normalization";
import type { TakeoffJobProcessingRow } from "@/lib/takeoff/job-lifecycle";
import type { TAKEOFF_LEVEL_A } from "@/lib/takeoff/processing-context";
import { getTakeoffPrompt } from "@/lib/takeoff/prompts";
import { TakeoffExchangeSchema } from "@/lib/takeoff/schemas";
import type { DownloadedTakeoffFile } from "@/lib/takeoff/source-loader";
import type {
  TakeoffExchange,
  TakeoffWarning,
} from "@/lib/takeoff/types";
import { parseTakeoffWorkbook, type ParsedTakeoffSheet } from "@/lib/takeoff/workbook-parsing";

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

type PreparedTakeoffLevelInput = {
  files: Array<{ data: string; mimeType: string }>;
  parseWarnings: TakeoffWarning[];
  sourceHint: string;
  providerMeta: Record<string, unknown>;
};

export type StructuredTakeoffRunResult = {
  normalizedExchange: TakeoffExchange;
  itemsForInsert: NormalizedTakeoffItemForInsert[];
  tokenCount: number;
  tokenUsage: TokenUsage;
  costCents: number;
  durationMs: number;
  tablesCount: number;
  model: string;
  promptVersion: string;
  providerMeta: Record<string, unknown>;
};

export async function executeStructuredTakeoffRun(input: {
  level: typeof TAKEOFF_LEVEL_A;
  job: TakeoffJobProcessingRow;
  sourceFile: DownloadedTakeoffFile;
  call: StructuredCall;
  schemaVersion: string;
  model: string;
  promptVersion: string;
}): Promise<StructuredTakeoffRunResult> {
  const preparedLevelInput = prepareTakeoffLevelInput({
    sourceFile: input.sourceFile,
  });

  const prompt = getTakeoffPrompt(input.level, {
    preparation: input.sourceFile.preparationSnapshot,
    contextSourceHints: input.sourceFile.contextSourceHints,
    fileType: input.sourceFile.mimeType,
    schemaVersion: input.schemaVersion,
    sourceHint: preparedLevelInput.sourceHint,
  });

  const result = await input.call<TakeoffExchange>({
    prompt,
    schema: TakeoffExchangeSchema,
    files: [...(input.sourceFile.contextFiles ?? []), ...preparedLevelInput.files],
    context: {
      jobId: input.job.id,
      tenantId: input.job.tenant_id,
      level: input.level,
      promptVersion: input.promptVersion,
      model: input.model,
    },
  });

  const strictExchange = TakeoffExchangeSchema.parse(result.data);
  const normalized = normalizeTakeoffExchange({
    exchange: strictExchange,
    ...takeoffSourceProvenance(input.job, input.sourceFile),
    parseWarnings: preparedLevelInput.parseWarnings,
  });
  const tablesCount = normalized.exchange.tables?.length ?? 0;

  return {
    normalizedExchange: normalized.exchange,
    itemsForInsert: normalized.itemsForInsert,
    tokenCount: result.tokenCount,
    tokenUsage: result.tokenUsage,
    costCents: result.costCents,
    durationMs: result.durationMs,
    tablesCount,
    model: result.model,
    promptVersion: result.promptVersion,
    providerMeta: {
      ...preparedLevelInput.providerMeta,
      provider: "chatgpt",
    },
  };
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
