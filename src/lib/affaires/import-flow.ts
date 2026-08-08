import { computeEstimateLineValues } from "@/lib/estimate-calculations";
import {
  IMPORT_ROW_PROVENANCE_KEY,
  IMPORT_ROW_STRUCTURE_KEY,
  readImportRowStructure,
} from "@/lib/imports/payload";
import {
  resolveImportStructure,
  type ImportStructureDecision,
  type ImportStructureLevel,
  type ImportStructureRow,
} from "@/lib/imports/structure";

type JsonRecord = Record<string, unknown>;

export type ImportFlowLineValuesContext = {
  marginMultiplier: number;
  defaultTaxRateBp: number;
};

export type ImportFlowMappedRowInput = {
  id: string;
  payload: unknown;
};

export type ValidImportFlowLine = {
  itemType: "line";
  mappedRowId: string;
  rowIndex: number;
  title: string;
  description: string | null;
  notes: string | null;
  sourcePage: number | null;
  sourceMetadata: JsonRecord;
  quantity: number;
  unitPriceHtCents: number;
  taxRateBp: number;
  kFo: number;
  hMo: number;
  hMoMajoration: number;
  kMo: number;
  puHtCents: number;
  lineTotalHtCents: number;
  lineTaxCents: number;
  lineTotalTtcCents: number;
};

export type ValidImportFlowSection = {
  itemType: "section";
  mappedRowId: string;
  rowIndex: number;
  title: string;
  level: ImportStructureLevel;
  sourcePage: number | null;
  sourceMetadata: JsonRecord;
};

export type ValidImportFlowItem = ValidImportFlowLine | ValidImportFlowSection;

export type InvalidImportFlowLine = {
  mappedRowId: string;
  rowIndex: number;
  reason:
    | "missing_title"
    | "invalid_quantity"
    | "invalid_unit_price"
    | "invalid_tax_rate"
    | "invalid_row_payload";
};

export type IgnoredImportFlowRow = {
  mappedRowId: string;
  rowIndex: number;
  reason: "footer" | "user_ignored";
};

export type NormalizeImportFlowRowsResult = {
  totalRows: number;
  validLines: ValidImportFlowLine[];
  validSections: ValidImportFlowSection[];
  validItems: ValidImportFlowItem[];
  invalidLines: InvalidImportFlowLine[];
  ignoredRows: IgnoredImportFlowRow[];
  zeroPriceRows: number;
};

export type NormalizeImportFlowRowsOptions = {
  detectStructure?: boolean;
  structureDecisions?: ImportStructureDecision[];
};

export type ImportFlowStats = {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  insertedRows: number;
  insertedSections: number;
  zeroPriceRows: number;
  ignoredRows: number;
  ignoredFooterRows: number;
  skippedRows: number;
};

const MAX_TAX_RATE_BP = 10_000;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as JsonRecord;
}

function normalizeText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return "";
}

function normalizeOptionalText(value: unknown): string | null {
  const text = normalizeText(value);
  return text.length > 0 ? text : null;
}

function normalizeDecimalString(raw: string): string {
  const withoutSpaces = raw.replace(/[\s\u00A0]/g, "");
  const cleaned = withoutSpaces.replace(/[^0-9,.\-]/g, "");
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");

  if (!hasComma && !hasDot) {
    return cleaned;
  }

  if (hasComma && hasDot) {
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const digitsOnly = cleaned.replace(/[.,]/g, "");

    if (decimalSeparator === ",") {
      const decimalLength = cleaned.length - lastComma - 1;
      if (decimalLength <= 0) return digitsOnly;
      const integerPart = digitsOnly.slice(0, digitsOnly.length - decimalLength);
      const decimalPart = digitsOnly.slice(digitsOnly.length - decimalLength);
      return `${integerPart}.${decimalPart}`;
    }

    const decimalLength = cleaned.length - lastDot - 1;
    if (decimalLength <= 0) return digitsOnly;
    const integerPart = digitsOnly.slice(0, digitsOnly.length - decimalLength);
    const decimalPart = digitsOnly.slice(digitsOnly.length - decimalLength);
    return `${integerPart}.${decimalPart}`;
  }

  if (hasComma) {
    const commaCount = (cleaned.match(/,/g) ?? []).length;
    if (commaCount > 1) {
      return cleaned.replace(/,/g, "");
    }
    return cleaned.replace(",", ".");
  }

  const dotCount = (cleaned.match(/\./g) ?? []).length;
  if (dotCount > 1) {
    return cleaned.replace(/\./g, "");
  }

  return cleaned;
}

export function parseLocalizedNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const normalized = normalizeDecimalString(trimmed);
  if (normalized.length === 0) return null;

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function toMoneyCents(value: number): number {
  return Math.round(value * 100);
}

function toSafeRateBp(value: unknown, fallbackTaxRateBp: number): number | null {
  const parsed = parseLocalizedNumber(value);
  if (parsed === null) return fallbackTaxRateBp;
  if (parsed < 0) return null;

  const interpreted = parsed <= 100 ? Math.round(parsed * 100) : Math.round(parsed);
  if (interpreted < 0 || interpreted > MAX_TAX_RATE_BP) {
    return null;
  }

  return interpreted;
}

function resolveMappedPayload(payload: JsonRecord): JsonRecord | null {
  const embeddedMappedRow = asRecord(payload.mapped_row);
  return embeddedMappedRow ?? payload;
}

const EMPTY_NUMERIC_SENTINELS = new Set(["", "-", "--", "—", "–", "pm", "p.m.", "n/a", "na"]);

type PreparedImportFlowRow = ImportStructureRow & {
  payload: JsonRecord;
};

function isMissingNumericValue(value: unknown) {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string") return false;
  return EMPTY_NUMERIC_SENTINELS.has(value.trim().toLowerCase());
}

function parseOptionalNumericField(value: unknown): {
  status: "missing" | "invalid" | "value";
  value: number | null;
} {
  if (isMissingNumericValue(value)) return { status: "missing", value: null };
  const parsed = parseLocalizedNumber(value);
  if (parsed === null || parsed < 0) return { status: "invalid", value: null };
  return { status: "value", value: parsed };
}

function readSourcePage(rawRow: JsonRecord) {
  const provenance = asRecord(rawRow[IMPORT_ROW_PROVENANCE_KEY]);
  const sourcePage = Number(provenance?.source_page);
  return Number.isInteger(sourcePage) && sourcePage > 0 ? sourcePage : null;
}

function buildSourceMetadata(input: {
  mappedRowId: string;
  rowIndex: number;
  rawRow: JsonRecord;
  notes: string | null;
}) {
  const structure = readImportRowStructure(input.rawRow);
  const provenance = asRecord(input.rawRow[IMPORT_ROW_PROVENANCE_KEY]);

  return {
    mapped_row_id: input.mappedRowId,
    row_index: input.rowIndex,
    notes: input.notes,
    ...(structure
      ? {
          [IMPORT_ROW_STRUCTURE_KEY]: structure,
          sheet_name: structure.sheet_name,
          source_row_number: structure.source_row_number,
          bold_columns: structure.bold_columns,
          merged_columns: structure.merged_columns,
          outline_level: structure.outline_level,
        }
      : {}),
    ...(provenance ? { [IMPORT_ROW_PROVENANCE_KEY]: provenance } : {}),
  };
}

function sortImportFlowItems(items: ValidImportFlowItem[]) {
  return [...items].sort((left, right) => {
    if (left.rowIndex !== right.rowIndex) return left.rowIndex - right.rowIndex;
    if (left.itemType !== right.itemType) return left.itemType === "section" ? -1 : 1;
    return left.mappedRowId.localeCompare(right.mappedRowId);
  });
}

export function normalizeMappedRowsForEstimateCreation(
  rows: ImportFlowMappedRowInput[],
  context: ImportFlowLineValuesContext,
  options: NormalizeImportFlowRowsOptions = {}
): NormalizeImportFlowRowsResult {
  const validLines: ValidImportFlowLine[] = [];
  const validSections: ValidImportFlowSection[] = [];
  const validItems: ValidImportFlowItem[] = [];
  const invalidLines: InvalidImportFlowLine[] = [];
  const ignoredRows: IgnoredImportFlowRow[] = [];
  const preparedRows: PreparedImportFlowRow[] = [];
  let zeroPriceRows = 0;

  rows.forEach((row, index) => {
    const payload = asRecord(row.payload);
    const rowIndexRaw = payload?.row_index;
    const rowIndex = Number.isInteger(rowIndexRaw) ? Number(rowIndexRaw) : index + 1;

    if (!payload) {
      invalidLines.push({
        mappedRowId: row.id,
        rowIndex,
        reason: "invalid_row_payload",
      });
      return;
    }

    const mappedRow = resolveMappedPayload(payload);
    if (!mappedRow) {
      invalidLines.push({
        mappedRowId: row.id,
        rowIndex,
        reason: "invalid_row_payload",
      });
      return;
    }

    preparedRows.push({
      id: row.id,
      rowIndex,
      payload,
      rawRow: asRecord(payload.raw_row) ?? {},
      mappedRow,
    });
  });

  const structure = resolveImportStructure(
    preparedRows,
    options.detectStructure || (options.structureDecisions?.length ?? 0) > 0
      ? options.structureDecisions
      : []
  );
  const detectStructure =
    options.detectStructure || (options.structureDecisions?.length ?? 0) > 0;

  for (const row of preparedRows) {
    if (structure.footerRowIndexes.has(row.rowIndex)) {
      ignoredRows.push({
        mappedRowId: row.id,
        rowIndex: row.rowIndex,
        reason: "footer",
      });
      continue;
    }

    const structureDecision = detectStructure
      ? structure.decisionsByRowIndex.get(row.rowIndex)
      : undefined;
    if (structureDecision?.kind === "ignore") {
      ignoredRows.push({
        mappedRowId: row.id,
        rowIndex: row.rowIndex,
        reason: "user_ignored",
      });
      continue;
    }

    const designation = normalizeText(row.mappedRow.designation);
    const reference = normalizeText(
      row.mappedRow.reference ?? row.mappedRow.hex_code
    );
    const title = designation || reference;
    const notes = normalizeOptionalText(row.mappedRow.notes);
    const sourcePage = readSourcePage(row.rawRow);
    const sourceMetadata = buildSourceMetadata({
      mappedRowId: row.id,
      rowIndex: row.rowIndex,
      rawRow: row.rawRow,
      notes,
    });

    if (structureDecision?.kind === "section") {
      const section: ValidImportFlowSection = {
        itemType: "section",
        mappedRowId: row.id,
        rowIndex: row.rowIndex,
        title,
        level: structureDecision.level,
        sourcePage,
        sourceMetadata,
      };
      validSections.push(section);
      validItems.push(section);
      continue;
    }

    if (title.length === 0) {
      invalidLines.push({
        mappedRowId: row.id,
        rowIndex: row.rowIndex,
        reason: "missing_title",
      });
      continue;
    }

    const quantityField = parseOptionalNumericField(row.mappedRow.quantity);
    if (quantityField.status === "invalid") {
      invalidLines.push({
        mappedRowId: row.id,
        rowIndex: row.rowIndex,
        reason: "invalid_quantity",
      });
      continue;
    }

    const quantity = quantityField.value ?? 0;
    const roundedQuantity = Math.round(quantity * 1000) / 1000;
    const unitPriceField = parseOptionalNumericField(row.mappedRow.unit_price_ht);
    const totalHtField = parseOptionalNumericField(row.mappedRow.total_ht);
    if (unitPriceField.status === "invalid" || totalHtField.status === "invalid") {
      invalidLines.push({
        mappedRowId: row.id,
        rowIndex: row.rowIndex,
        reason: "invalid_unit_price",
      });
      continue;
    }

    if (
      unitPriceField.status === "missing" &&
      totalHtField.value !== null &&
      totalHtField.value > 0 &&
      roundedQuantity <= 0
    ) {
      invalidLines.push({
        mappedRowId: row.id,
        rowIndex: row.rowIndex,
        reason: "invalid_unit_price",
      });
      continue;
    }

    const resolvedUnitPrice =
      unitPriceField.value ??
      (totalHtField.value !== null && roundedQuantity > 0
        ? totalHtField.value / roundedQuantity
        : 0);
    const unitPriceHtCents = toMoneyCents(resolvedUnitPrice);

    const taxRateBp = toSafeRateBp(
      row.mappedRow.tax_rate_bp,
      context.defaultTaxRateBp
    );
    if (taxRateBp === null) {
      invalidLines.push({
        mappedRowId: row.id,
        rowIndex: row.rowIndex,
        reason: "invalid_tax_rate",
      });
      continue;
    }

    const kFo = Math.max(parseLocalizedNumber(row.mappedRow.k_fo) ?? 1, 0);
    const hMo = Math.max(
      parseLocalizedNumber(row.mappedRow.labor_hours ?? row.mappedRow.h_mo) ?? 0,
      0
    );
    const hMoMajoration = Math.max(
      parseLocalizedNumber(row.mappedRow.h_mo_majoration) ?? 1,
      0
    );
    const kMo = Math.max(parseLocalizedNumber(row.mappedRow.k_mo) ?? 1, 0);

    const lineValues = computeEstimateLineValues(
      {
        quantity: roundedQuantity,
        unit_price_ht_cents: unitPriceHtCents,
        tax_rate_bp: taxRateBp,
        k_fo: kFo,
        h_mo: hMo,
        h_mo_majoration: hMoMajoration,
        k_mo: kMo,
        pu_ht_cents: 0,
      },
      {
        marginMultiplier: context.marginMultiplier,
        taxRateBp,
        isLaborSplitEnabled: false,
      }
    );

    const line: ValidImportFlowLine = {
      itemType: "line",
      mappedRowId: row.id,
      rowIndex: row.rowIndex,
      title,
      description: normalizeOptionalText(row.mappedRow.unit),
      notes,
      sourcePage,
      sourceMetadata,
      quantity: roundedQuantity,
      unitPriceHtCents,
      taxRateBp,
      kFo,
      hMo,
      hMoMajoration,
      kMo,
      puHtCents: lineValues.puHtCents,
      lineTotalHtCents: lineValues.saleLineCents,
      lineTaxCents: lineValues.taxLineCents,
      lineTotalTtcCents: lineValues.ttcLineCents,
    };
    validLines.push(line);
    validItems.push(line);
    if (unitPriceHtCents === 0) zeroPriceRows += 1;
  }

  return {
    totalRows: rows.length,
    validLines,
    validSections,
    validItems: sortImportFlowItems(validItems),
    invalidLines,
    ignoredRows,
    zeroPriceRows,
  };
}

export function buildImportFlowStats(
  normalized: NormalizeImportFlowRowsResult,
  insertedRows: number,
  insertedSections = 0
): ImportFlowStats {
  const safeInsertedRows = Math.max(Math.trunc(insertedRows), 0);
  const safeInsertedSections = Math.max(Math.trunc(insertedSections), 0);
  const skippedRows = Math.max(
    normalized.totalRows - safeInsertedRows - safeInsertedSections,
    0
  );

  return {
    totalRows: normalized.totalRows,
    validRows: normalized.validLines.length + normalized.validSections.length,
    invalidRows: normalized.invalidLines.length,
    insertedRows: safeInsertedRows,
    insertedSections: safeInsertedSections,
    zeroPriceRows: normalized.zeroPriceRows,
    ignoredRows: normalized.ignoredRows.length,
    ignoredFooterRows: normalized.ignoredRows.filter((row) => row.reason === "footer").length,
    skippedRows,
  };
}

