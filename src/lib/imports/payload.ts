export const IMPORT_ROW_PROVENANCE_KEY = "_timax_provenance";
export const IMPORT_ROW_STRUCTURE_KEY = "_timax_structure";

export type ImportRowProvenance = {
  source_page: number;
  table_index: number;
  source_file_name: string | null;
  source_document_id: string | null;
};

export type ImportRowStructure = {
  sheet_name: string | null;
  source_row_number: number;
  bold_columns: string[];
  merged_columns: string[];
  outline_level: number | null;
  column_order: string[];
};

const IMPORT_RESERVED_KEYS = new Set([
  IMPORT_ROW_PROVENANCE_KEY,
  IMPORT_ROW_STRUCTURE_KEY,
]);

export function isImportReservedKey(key: string) {
  return IMPORT_RESERVED_KEYS.has(key.trim());
}

export function attachImportRowProvenance<T extends Record<string, unknown>>(
  row: T,
  provenance: ImportRowProvenance | null | undefined
) {
  if (!provenance) {
    return row;
  }

  return {
    ...row,
    [IMPORT_ROW_PROVENANCE_KEY]: provenance,
  };
}

export function attachImportRowStructure<T extends Record<string, unknown>>(
  row: T,
  structure: ImportRowStructure | null | undefined
) {
  if (!structure) {
    return row;
  }

  return {
    ...row,
    [IMPORT_ROW_STRUCTURE_KEY]: structure,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (typeof entry !== "string") return [];
    const normalized = entry.trim();
    return normalized.length > 0 ? [normalized] : [];
  });
}

export function readImportRowStructure(
  row: Record<string, unknown> | null | undefined
): ImportRowStructure | null {
  const structure = asRecord(row?.[IMPORT_ROW_STRUCTURE_KEY]);
  if (!structure) return null;

  const sourceRowNumber = Number(structure.source_row_number);
  if (!Number.isInteger(sourceRowNumber) || sourceRowNumber <= 0) {
    return null;
  }

  const outlineLevel = Number(structure.outline_level);

  return {
    sheet_name:
      typeof structure.sheet_name === "string" && structure.sheet_name.trim().length > 0
        ? structure.sheet_name.trim()
        : null,
    source_row_number: sourceRowNumber,
    bold_columns: normalizeStringArray(structure.bold_columns),
    merged_columns: normalizeStringArray(structure.merged_columns),
    outline_level:
      Number.isInteger(outlineLevel) && outlineLevel > 0 ? outlineLevel : null,
    column_order: normalizeStringArray(structure.column_order),
  };
}
