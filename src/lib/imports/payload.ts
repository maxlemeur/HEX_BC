export const IMPORT_ROW_PROVENANCE_KEY = "_timax_provenance";

export type ImportRowProvenance = {
  source_page: number;
  table_index: number;
  source_file_name: string | null;
  source_document_id: string | null;
};

export function isImportReservedKey(key: string) {
  return key.trim() === IMPORT_ROW_PROVENANCE_KEY;
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
