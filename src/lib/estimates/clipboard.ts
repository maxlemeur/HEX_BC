export const CLIPBOARD_TARGET_FIELDS = [
  "designation",
  "quantity",
  "unit",
  "unit_price_ht",
  "supply_type",
  "k_fo",
  "h_mo",
  "k_mo",
  "h_mo_majoration",
] as const;

export type ClipboardTargetField = (typeof CLIPBOARD_TARGET_FIELDS)[number];
export type ClipboardFormat = "bdc_v1_1" | "optima" | "generic";
export type ClipboardColumnMapping = Record<string, ClipboardTargetField>;

export type ClipboardTsvMatrix = {
  headers: string[];
  rows: string[][];
  columnCount: number;
};

export type ClipboardPreviewValues = {
  designation: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price_ht: number | null;
  supply_type: string | null;
  k_fo: number | null;
  h_mo: number | null;
  k_mo: number | null;
  h_mo_majoration: number | null;
};

export type ClipboardPreviewRow = {
  lineNumber: number;
  status: "valid" | "invalid";
  reasons: string[];
  rawValues: Record<string, string>;
  values: ClipboardPreviewValues;
};

export type ClipboardPreviewResult = {
  rows: ClipboardPreviewRow[];
  totalRows: number;
  validCount: number;
  invalidCount: number;
};

export type ClipboardPreviewOptions = {
  limit?: number;
};

export type ClipboardSerializableRow = Partial<
  Record<ClipboardTargetField, string | number | null | undefined>
>;

export type SerializeSelectedRowsOptions = {
  fields?: ClipboardTargetField[];
  includeHeader?: boolean;
};

export const DEFAULT_CLIPBOARD_FIELD_ORDER: ClipboardTargetField[] = [
  ...CLIPBOARD_TARGET_FIELDS,
];

const TARGET_FIELD_ALIASES: Record<ClipboardTargetField, string[]> = {
  designation: [
    "designation",
    "libelle",
    "intitule",
    "description",
    "title",
    "article",
    "item",
  ],
  quantity: ["quantite", "qte", "qt", "quantity", "qty"],
  unit: ["unite", "unit", "uom", "u"],
  unit_price_ht: [
    "unit_price_ht",
    "unit price ht",
    "unit price",
    "prix unitaire ht",
    "prix ht",
    "pu ht",
    "pu",
    "price ht",
  ],
  supply_type: ["supply_type", "supply type", "type fo", "famille fo"],
  k_fo: ["k_fo", "k fo", "coef fo", "coefficient fo"],
  h_mo: ["h_mo", "h mo", "heure mo", "heures mo", "mo hours", "labor hours"],
  k_mo: ["k_mo", "k mo", "coef mo", "coefficient mo"],
  h_mo_majoration: [
    "h_mo_majoration",
    "h mo majoration",
    "majoration mo",
    "majoration mo %",
    "temps majore",
    "temps majoration",
    "majoration",
  ],
};

const BDC_HEADER_MARKERS = new Set<string>([
  "designation",
  "quantite",
  "quantity",
  "unite",
  "unit",
  "prix unitaire ht eur",
  "unit price ht eur",
  "type fo",
  "k fo",
  "h mo",
  "k mo",
  "majoration mo",
  "majoration mo %",
]);

const OPTIMA_HEADER_MARKERS = new Set<string>([
  "famille fo",
  "type fo",
  "temps majore",
  "temps majoration",
  "qte",
  "qt",
  "pu ht",
  "prix unit ht",
]);

const BDC_CANONICAL_HEADERS: Partial<Record<ClipboardTargetField, string[]>> = {
  designation: ["designation"],
  quantity: ["quantite", "quantity"],
  unit: ["unite", "unit"],
  unit_price_ht: ["prix unitaire ht eur", "unit price ht eur"],
  supply_type: ["type fo"],
  k_fo: ["k fo"],
  h_mo: ["h mo"],
  k_mo: ["k mo"],
  h_mo_majoration: ["majoration mo %", "majoration mo"],
};

const OPTIMA_CANONICAL_HEADERS: Partial<Record<ClipboardTargetField, string[]>> = {
  designation: ["libelle", "designation"],
  quantity: ["qte", "qt"],
  unit: ["unite", "u"],
  unit_price_ht: ["pu ht", "prix unit ht"],
  supply_type: ["famille fo", "type fo"],
  h_mo_majoration: ["temps majore", "majoration mo"],
};

const NULL_LIKE_TOKENS = new Set<string>(["na", "n a", "null", "none", "vide"]);

const FIELD_LABELS: Record<ClipboardTargetField, string> = {
  designation: "Designation",
  quantity: "Quantite",
  unit: "Unite",
  unit_price_ht: "Prix unitaire HT",
  supply_type: "Type FO",
  k_fo: "K FO",
  h_mo: "h MO",
  k_mo: "K MO",
  h_mo_majoration: "Majoration MO",
};

type ClipboardNumericField = Exclude<
  ClipboardTargetField,
  "designation" | "unit" | "supply_type"
>;

const NUMERIC_FIELDS = new Set<ClipboardNumericField>([
  "quantity",
  "unit_price_ht",
  "k_fo",
  "h_mo",
  "k_mo",
  "h_mo_majoration",
]);

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function dedupeHeaders(headers: string[]) {
  const counts = new Map<string, number>();

  return headers.map((header) => {
    const count = counts.get(header) ?? 0;
    const nextCount = count + 1;
    counts.set(header, nextCount);
    return nextCount === 1 ? header : `${header}_${nextCount}`;
  });
}

function parseTsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === "\"") {
      if (inQuotes && line[index + 1] === "\"") {
        current += "\"";
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (character === "\t" && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  cells.push(current.trim());
  return cells;
}

function normalizeRowLength(row: string[], columnCount: number): string[] {
  return Array.from({ length: columnCount }, (_, index) => (row[index] ?? "").trim());
}

function buildHeaders(headerRow: string[], columnCount: number): string[] {
  const rawHeaders = Array.from({ length: columnCount }, (_, index) => {
    const rawHeader = (headerRow[index] ?? "").trim();
    return rawHeader.length > 0 ? rawHeader : `column_${index + 1}`;
  });

  return dedupeHeaders(rawHeaders);
}

function hasExactNormalizedMatch(normalizedHeader: string, aliases?: string[]) {
  if (!aliases || aliases.length === 0) return false;
  return aliases.some(
    (alias) => normalizeClipboardHeader(alias) === normalizedHeader
  );
}

function scoreAliasMatch(normalizedHeader: string, alias: string): number {
  const normalizedAlias = normalizeClipboardHeader(alias);
  if (!normalizedAlias) return 0;

  if (normalizedAlias.length <= 1) {
    return normalizedHeader === normalizedAlias ? 220 : 0;
  }

  if (normalizedHeader === normalizedAlias) {
    return 200 + normalizedAlias.length;
  }

  if (normalizedHeader.startsWith(normalizedAlias)) {
    return 170 + normalizedAlias.length;
  }

  if (normalizedHeader.includes(normalizedAlias)) {
    return 140 + normalizedAlias.length;
  }

  const headerWords = normalizedHeader.split(" ").filter(Boolean);
  const aliasWords = normalizedAlias.split(" ").filter(Boolean);

  if (aliasWords.length > 1 && aliasWords.every((word) => headerWords.includes(word))) {
    return 110 + aliasWords.length;
  }

  if (headerWords.length > 1 && headerWords.every((word) => aliasWords.includes(word))) {
    return 90 + headerWords.length;
  }

  return 0;
}

function normalizeSingleSeparatorNumber(
  value: string,
  separator: "," | "."
): string | null {
  const parts = value.split(separator);
  if (parts.length === 1) return value;

  if (parts.length === 2) {
    let left = parts[0] ?? "";
    const right = parts[1] ?? "";

    if (!/^\d*$/.test(left) || !/^\d*$/.test(right)) {
      return null;
    }

    if (right.length === 0) {
      return left.length > 0 ? left : "0";
    }

    if (left.length === 0) {
      left = "0";
    }

    if (right.length === 3 && left !== "0") {
      return `${left}${right}`;
    }

    return `${left}.${right}`;
  }

  const head = parts.slice(0, -1);
  const last = parts[parts.length - 1] ?? "";

  if (!/^\d+$/.test(last)) {
    return null;
  }

  const groupedHead = head.every((segment, index) =>
    index === 0 ? /^\d+$/.test(segment) : /^\d{3}$/.test(segment)
  );

  if (!groupedHead) {
    return null;
  }

  if (last.length === 3) {
    return `${head.join("")}${last}`;
  }

  if (last.length >= 1 && last.length <= 6) {
    return `${head.join("")}.${last}`;
  }

  return null;
}

function isNumericField(field: ClipboardTargetField): field is ClipboardNumericField {
  return NUMERIC_FIELDS.has(field as ClipboardNumericField);
}

function createEmptyPreviewValues(): ClipboardPreviewValues {
  return {
    designation: null,
    quantity: null,
    unit: null,
    unit_price_ht: null,
    supply_type: null,
    k_fo: null,
    h_mo: null,
    k_mo: null,
    h_mo_majoration: null,
  };
}

function toNullableText(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (isNullLikeToken(trimmed)) return null;
  return trimmed;
}

function isNullLikeToken(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  const normalized = normalizeClipboardHeader(trimmed);
  if (normalized.length === 0) return true;
  return NULL_LIKE_TOKENS.has(normalized);
}

function invertColumnMapping(
  mapping: ClipboardColumnMapping
): Partial<Record<ClipboardTargetField, string>> {
  const fieldToSource: Partial<Record<ClipboardTargetField, string>> = {};

  for (const [sourceHeader, field] of Object.entries(mapping)) {
    const normalizedSource = sourceHeader.trim();
    if (!normalizedSource) continue;
    if (fieldToSource[field]) continue;
    fieldToSource[field] = normalizedSource;
  }

  return fieldToSource;
}

function coerceMajorationToCoefficient(
  parsedValue: number,
  rawCell: string,
  sourceHeader: string
) {
  const normalizedHeader = normalizeClipboardHeader(sourceHeader);
  const isPercentHeader =
    rawCell.includes("%") ||
    normalizedHeader.includes("%") ||
    normalizedHeader.includes("pourcent") ||
    normalizedHeader.includes("percent") ||
    normalizedHeader.includes("pct");

  if (isPercentHeader || parsedValue > 10) {
    return parsedValue / 100;
  }

  return parsedValue;
}

function dedupeReasons(reasons: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const reason of reasons) {
    if (seen.has(reason)) continue;
    seen.add(reason);
    deduped.push(reason);
  }

  return deduped;
}

function sanitizeTsvCell(value: string): string {
  return value.replace(/[\t\r\n]+/g, " ").trim();
}

function formatSerializableValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  return sanitizeTsvCell(value);
}

export function normalizeClipboardHeader(value: string): string {
  return stripAccents(value)
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9%]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function parseTsvMatrix(input: string): ClipboardTsvMatrix {
  const normalizedInput = input
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");

  if (normalizedInput.trim().length === 0) {
    return {
      headers: [],
      rows: [],
      columnCount: 0,
    };
  }

  const rawLines = normalizedInput.split("\n");
  while (rawLines.length > 0 && rawLines[0].trim().length === 0) {
    rawLines.shift();
  }
  while (rawLines.length > 0 && rawLines[rawLines.length - 1]?.trim().length === 0) {
    rawLines.pop();
  }

  if (rawLines.length === 0) {
    return {
      headers: [],
      rows: [],
      columnCount: 0,
    };
  }

  const matrix = rawLines.map((line) => parseTsvLine(line));
  const columnCount = matrix.reduce((max, row) => Math.max(max, row.length), 0);

  if (columnCount === 0) {
    return {
      headers: [],
      rows: [],
      columnCount: 0,
    };
  }

  const headers = buildHeaders(matrix[0] ?? [], columnCount);
  const rows = matrix.slice(1).map((row) => normalizeRowLength(row, columnCount));

  return {
    headers,
    rows,
    columnCount,
  };
}

export function detectClipboardFormat(headers: string[]): ClipboardFormat {
  const normalizedHeaders = headers
    .map((header) => normalizeClipboardHeader(header))
    .filter((header) => header.length > 0);

  if (normalizedHeaders.length === 0) {
    return "generic";
  }

  if (normalizedHeaders.includes("bdc v1 1")) {
    return "bdc_v1_1";
  }

  const headerSet = new Set(normalizedHeaders);

  let bdcScore = 0;
  let optimaScore = 0;

  for (const marker of BDC_HEADER_MARKERS) {
    if (headerSet.has(marker)) {
      bdcScore += 2;
    }
  }

  for (const marker of OPTIMA_HEADER_MARKERS) {
    if (headerSet.has(marker)) {
      optimaScore += 2;
    }
  }

  if (normalizedHeaders.some((header) => header.includes("prix unitaire ht"))) {
    bdcScore += 2;
  }
  if (normalizedHeaders.some((header) => header.includes("majoration mo"))) {
    bdcScore += 2;
    optimaScore += 1;
  }
  if (normalizedHeaders.some((header) => header.includes("temps major"))) {
    optimaScore += 2;
  }
  if (normalizedHeaders.some((header) => header.includes("famille fo"))) {
    optimaScore += 2;
  }

  if (bdcScore >= 10) {
    return "bdc_v1_1";
  }

  if (optimaScore >= 6 && bdcScore < 10) {
    return "optima";
  }

  if (bdcScore >= 6 && optimaScore <= 4) {
    return "bdc_v1_1";
  }

  if (optimaScore >= 4) {
    return "optima";
  }

  return "generic";
}

export function suggestClipboardColumnMapping(headers: string[]): ClipboardColumnMapping {
  type Candidate = {
    sourceHeader: string;
    sourceIndex: number;
    field: ClipboardTargetField;
    score: number;
  };

  const format = detectClipboardFormat(headers);
  const candidates: Candidate[] = [];

  headers.forEach((sourceHeader, sourceIndex) => {
    const normalizedHeader = normalizeClipboardHeader(sourceHeader);
    if (!normalizedHeader) return;

    for (const field of CLIPBOARD_TARGET_FIELDS) {
      const aliases = TARGET_FIELD_ALIASES[field];
      let bestScore = 0;

      for (const alias of aliases) {
        bestScore = Math.max(bestScore, scoreAliasMatch(normalizedHeader, alias));
      }

      if (bestScore === 0) continue;

      if (
        format === "bdc_v1_1" &&
        hasExactNormalizedMatch(normalizedHeader, BDC_CANONICAL_HEADERS[field])
      ) {
        bestScore += 50;
      }

      if (
        format === "optima" &&
        hasExactNormalizedMatch(normalizedHeader, OPTIMA_CANONICAL_HEADERS[field])
      ) {
        bestScore += 45;
      }

      candidates.push({
        sourceHeader,
        sourceIndex,
        field,
        score: bestScore,
      });
    }
  });

  candidates.sort((left, right) => {
    if (left.score !== right.score) {
      return right.score - left.score;
    }
    return left.sourceIndex - right.sourceIndex;
  });

  const mapping: ClipboardColumnMapping = {};
  const usedSources = new Set<string>();
  const usedFields = new Set<ClipboardTargetField>();

  for (const candidate of candidates) {
    if (usedSources.has(candidate.sourceHeader)) continue;
    if (usedFields.has(candidate.field)) continue;

    mapping[candidate.sourceHeader] = candidate.field;
    usedSources.add(candidate.sourceHeader);
    usedFields.add(candidate.field);
  }

  return mapping;
}

export function parseClipboardNumber(
  value: string | number | null | undefined
): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (value === null || value === undefined) {
    return null;
  }

  let raw = value.trim();
  if (raw.length === 0) {
    return null;
  }

  raw = raw.replace(/[−–—]/g, "-");

  let isNegative = false;
  if (raw.startsWith("(") && raw.endsWith(")")) {
    isNegative = true;
    raw = raw.slice(1, -1).trim();
  }

  raw = raw
    .replace(/[^\d.,+'’`\-\s\u00A0\u202F]/g, "")
    .replace(/[\s\u00A0\u202F]/g, "")
    .replace(/['’`]/g, "");

  if (raw.startsWith("+")) {
    raw = raw.slice(1);
  }

  if (raw.startsWith("-")) {
    isNegative = !isNegative;
    raw = raw.slice(1);
  }

  if (raw.length === 0 || /[+\-]/.test(raw) || !/\d/.test(raw)) {
    return null;
  }

  const commaCount = (raw.match(/,/g) ?? []).length;
  const dotCount = (raw.match(/\./g) ?? []).length;
  let normalized = raw;

  if (commaCount > 0 && dotCount > 0) {
    const lastComma = raw.lastIndexOf(",");
    const lastDot = raw.lastIndexOf(".");
    const decimalSeparator: "," | "." = lastComma > lastDot ? "," : ".";
    const groupingRegex = decimalSeparator === "," ? /\./g : /,/g;

    normalized = raw.replace(groupingRegex, "");
    if (decimalSeparator === ",") {
      normalized = normalized.replace(/,/g, ".");
    }
  } else if (commaCount > 0) {
    const candidate = normalizeSingleSeparatorNumber(raw, ",");
    if (!candidate) return null;
    normalized = candidate;
  } else if (dotCount > 0) {
    const candidate = normalizeSingleSeparatorNumber(raw, ".");
    if (!candidate) return null;
    normalized = candidate;
  }

  if ((normalized.match(/\./g) ?? []).length > 1) {
    return null;
  }

  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return null;
  }

  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return isNegative ? -parsed : parsed;
}

export function buildClipboardPreviewRows(
  matrix: ClipboardTsvMatrix,
  mapping: ClipboardColumnMapping,
  options: ClipboardPreviewOptions = {}
): ClipboardPreviewResult {
  const headerIndexByName = new Map<string, number>();
  matrix.headers.forEach((header, index) => {
    headerIndexByName.set(header, index);
  });

  const fieldToSource = invertColumnMapping(mapping);
  const hasExplicitLimit =
    typeof options.limit === "number" && Number.isFinite(options.limit);
  const normalizedLimit = hasExplicitLimit
    ? Math.max(0, Math.floor(options.limit as number))
    : matrix.rows.length;
  const rowLimit = Math.min(matrix.rows.length, normalizedLimit);

  const previewRows: ClipboardPreviewRow[] = [];

  for (let rowIndex = 0; rowIndex < rowLimit; rowIndex += 1) {
    const row = matrix.rows[rowIndex] ?? [];
    const rawValues: Record<string, string> = {};
    const values = createEmptyPreviewValues();
    const reasons: string[] = [];
    let hasMappedValue = false;

    matrix.headers.forEach((header, columnIndex) => {
      rawValues[header] = (row[columnIndex] ?? "").trim();
    });

    for (const field of CLIPBOARD_TARGET_FIELDS) {
      const sourceHeader = fieldToSource[field];
      if (!sourceHeader) continue;

      const columnIndex = headerIndexByName.get(sourceHeader);
      if (columnIndex === undefined) continue;

      const rawCell = (row[columnIndex] ?? "").trim();
      if (!isNullLikeToken(rawCell)) {
        hasMappedValue = true;
      }

      if (isNumericField(field)) {
        if (isNullLikeToken(rawCell)) {
          values[field] = null;
          continue;
        }

        const parsed = parseClipboardNumber(rawCell);
        if (parsed === null) {
          reasons.push(`Nombre invalide pour ${FIELD_LABELS[field]}.`);
          continue;
        }

        const parsedValue =
          field === "h_mo_majoration"
            ? coerceMajorationToCoefficient(parsed, rawCell, sourceHeader)
            : parsed;

        if (parsedValue < 0) {
          reasons.push(`${FIELD_LABELS[field]} doit etre >= 0.`);
          continue;
        }

        values[field] = parsedValue;
        continue;
      }

      values[field] = toNullableText(rawCell);
    }

    if (!fieldToSource.designation) {
      reasons.push("Colonne designation non mappee.");
    } else if (!values.designation) {
      reasons.push("Designation manquante.");
    }

    if (!hasMappedValue) {
      reasons.push("Ligne vide.");
    }

    const dedupedReasons = dedupeReasons(reasons);
    const status = dedupedReasons.length === 0 ? "valid" : "invalid";

    previewRows.push({
      lineNumber: rowIndex + 2,
      status,
      reasons: dedupedReasons,
      rawValues,
      values,
    });
  }

  const validCount = previewRows.filter((row) => row.status === "valid").length;
  const invalidCount = previewRows.length - validCount;

  return {
    rows: previewRows,
    totalRows: previewRows.length,
    validCount,
    invalidCount,
  };
}

export function serializeSelectedRowsToTsv(
  rows: ClipboardSerializableRow[],
  options: SerializeSelectedRowsOptions = {}
): string {
  const includeHeader = options.includeHeader ?? true;
  const sourceFields =
    options.fields && options.fields.length > 0
      ? options.fields
      : DEFAULT_CLIPBOARD_FIELD_ORDER;
  const dedupedFields: ClipboardTargetField[] = [];
  const seen = new Set<ClipboardTargetField>();

  for (const field of sourceFields) {
    if (seen.has(field)) continue;
    seen.add(field);
    dedupedFields.push(field);
  }

  const lines: string[] = [];

  if (includeHeader) {
    lines.push(dedupedFields.join("\t"));
  }

  for (const row of rows) {
    const serializedRow = dedupedFields.map((field) =>
      formatSerializableValue(row[field])
    );
    lines.push(serializedRow.join("\t"));
  }

  return lines.join("\n");
}
