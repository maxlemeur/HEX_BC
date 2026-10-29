import { z } from "zod";

import { copiedIdsSchema, copyCountSchema, copyTimestampSchema, copyTotalsSchema, copyUuidSchema, copyVersionSchema, sameCopyIdentity } from "@/lib/estimates/copy-response-contract";

export const affaireLinkedDpgfSourceResponseSchema = z.object({
  import_id: copyUuidSchema, filename: z.string(), source_format: z.string(), import_status: z.string(),
  mapping_status: z.string().nullable(), imported_at: copyTimestampSchema, mapping_updated_at: copyTimestampSchema.nullable(),
  parse_mode: z.string(), row_count: copyCountSchema, mapped_row_count: copyCountSchema,
}).nullable();
export const importLinkedDpgfSourceResponseSchema = z.object({
  source_import_id: copyUuidSchema, target_version_id: copyUuidSchema, created_section_id: copyUuidSchema,
  created_line_ids: copiedIdsSchema, imported_lines_count: copyCountSchema, skipped_lines_count: copyCountSchema,
  totals: copyTotalsSchema, version: copyVersionSchema,
}).refine((result) => sameCopyIdentity(result.version.id, result.target_version_id) && result.imported_lines_count === result.created_line_ids.length &&
  !result.created_line_ids.some((id) => sameCopyIdentity(id, result.created_section_id)), "La confirmation d'import DPGF est incohérente.");
export type AffaireLinkedDpgfSourceResult = z.infer<typeof affaireLinkedDpgfSourceResponseSchema>;
export type ImportLinkedDpgfSourceResult = z.infer<typeof importLinkedDpgfSourceResponseSchema>;

export const importLinkedDpgfSourceClientResultSchema = z.object({
  sourceImportId: copyUuidSchema, targetVersionId: copyUuidSchema, createdSectionId: copyUuidSchema,
  createdLineIds: copiedIdsSchema, importedLinesCount: copyCountSchema, skippedLinesCount: copyCountSchema,
  totals: z.object({ totalHtCents: copyCountSchema, totalTaxCents: copyCountSchema, totalTtcCents: copyCountSchema }),
  versionToken: copyVersionSchema.nullable(),
});
export type ImportLinkedDpgfSourceClientResult = z.infer<typeof importLinkedDpgfSourceClientResultSchema>;
export function toAffaireLinkedDpgfSourceClient(source: AffaireLinkedDpgfSourceResult) {
  if (!source) return null;
  return { importId: source.import_id, filename: source.filename, sourceFormat: source.source_format,
    importStatus: source.import_status, mappingStatus: source.mapping_status, importedAt: source.imported_at,
    mappingUpdatedAt: source.mapping_updated_at, parseMode: source.parse_mode,
    rowCount: source.row_count, mappedRowCount: source.mapped_row_count };
}
export function toImportLinkedDpgfSourceClient(result: ImportLinkedDpgfSourceResult): ImportLinkedDpgfSourceClientResult {
  return { sourceImportId: result.source_import_id, targetVersionId: result.target_version_id,
    createdSectionId: result.created_section_id, createdLineIds: result.created_line_ids,
    importedLinesCount: result.imported_lines_count, skippedLinesCount: result.skipped_lines_count,
    totals: { totalHtCents: result.totals.total_ht_cents, totalTaxCents: result.totals.total_tax_cents, totalTtcCents: result.totals.total_ttc_cents },
    versionToken: result.version };
}
export type AffaireLinkedDpgfSource = ReturnType<typeof toAffaireLinkedDpgfSourceClient>;
