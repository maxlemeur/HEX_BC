import { computeEstimateLineValues } from "@/lib/estimate-calculations";

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
  mappedRowId: string;
  rowIndex: number;
  title: string;
  description: string | null;
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

export type NormalizeImportFlowRowsResult = {
  totalRows: number;
  validLines: ValidImportFlowLine[];
  invalidLines: InvalidImportFlowLine[];
};

export type ImportFlowStats = {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  insertedRows: number;
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

export function normalizeMappedRowsForEstimateCreation(
  rows: ImportFlowMappedRowInput[],
  context: ImportFlowLineValuesContext
): NormalizeImportFlowRowsResult {
  const validLines: ValidImportFlowLine[] = [];
  const invalidLines: InvalidImportFlowLine[] = [];

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

    const designation = normalizeText(mappedRow.designation);
    const reference = normalizeText(mappedRow.reference ?? mappedRow.hex_code);
    const title = designation || reference;

    if (title.length === 0) {
      invalidLines.push({
        mappedRowId: row.id,
        rowIndex,
        reason: "missing_title",
      });
      return;
    }

    const quantity = parseLocalizedNumber(mappedRow.quantity);
    if (quantity === null || quantity <= 0) {
      invalidLines.push({
        mappedRowId: row.id,
        rowIndex,
        reason: "invalid_quantity",
      });
      return;
    }

    const roundedQuantity = Math.round(quantity * 1000) / 1000;
    const unitPriceRaw = parseLocalizedNumber(mappedRow.unit_price_ht);
    const totalHtRaw = parseLocalizedNumber(mappedRow.total_ht);

    const resolvedUnitPrice =
      unitPriceRaw !== null
        ? unitPriceRaw
        : totalHtRaw !== null
          ? totalHtRaw / roundedQuantity
          : null;

    if (resolvedUnitPrice === null || !Number.isFinite(resolvedUnitPrice) || resolvedUnitPrice < 0) {
      invalidLines.push({
        mappedRowId: row.id,
        rowIndex,
        reason: "invalid_unit_price",
      });
      return;
    }

    const taxRateBp = toSafeRateBp(mappedRow.tax_rate_bp, context.defaultTaxRateBp);
    if (taxRateBp === null) {
      invalidLines.push({
        mappedRowId: row.id,
        rowIndex,
        reason: "invalid_tax_rate",
      });
      return;
    }

    const kFo = Math.max(parseLocalizedNumber(mappedRow.k_fo) ?? 1, 0);
    const hMo = Math.max(parseLocalizedNumber(mappedRow.labor_hours ?? mappedRow.h_mo) ?? 0, 0);
    const hMoMajoration = Math.max(parseLocalizedNumber(mappedRow.h_mo_majoration) ?? 1, 0);
    const kMo = Math.max(parseLocalizedNumber(mappedRow.k_mo) ?? 1, 0);

    const lineValues = computeEstimateLineValues(
      {
        quantity: roundedQuantity,
        unit_price_ht_cents: toMoneyCents(resolvedUnitPrice),
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
        // Import : lignes FO + MO legacy, sans payload atelier/chantier.
        isLaborSplitEnabled: false,
      }
    );

    validLines.push({
      mappedRowId: row.id,
      rowIndex,
      title,
      description: normalizeOptionalText(mappedRow.notes),
      quantity: roundedQuantity,
      unitPriceHtCents: toMoneyCents(resolvedUnitPrice),
      taxRateBp,
      kFo,
      hMo,
      hMoMajoration,
      kMo,
      puHtCents: lineValues.puHtCents,
      lineTotalHtCents: lineValues.saleLineCents,
      lineTaxCents: lineValues.taxLineCents,
      lineTotalTtcCents: lineValues.ttcLineCents,
    });
  });

  return {
    totalRows: rows.length,
    validLines,
    invalidLines,
  };
}

export function buildImportFlowStats(
  normalized: NormalizeImportFlowRowsResult,
  insertedRows: number
): ImportFlowStats {
  const safeInsertedRows = Math.max(insertedRows, 0);
  const skippedRows = Math.max(normalized.totalRows - safeInsertedRows, 0);

  return {
    totalRows: normalized.totalRows,
    validRows: normalized.validLines.length,
    invalidRows: normalized.invalidLines.length,
    insertedRows: safeInsertedRows,
    skippedRows,
  };
}

