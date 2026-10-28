import { z } from "zod";

import {
  copiedIdsSchema, copyConvertedLineClientSchema, copyConvertedLineSchema, copyCountSchema,
  copyTimestampSchema, copyTotalsSchema, copyUuidSchema, copyVersionSchema, sameCopyIdentity,
} from "@/lib/estimates/copy-response-contract";
import { ESTIMATE_STATUS_VALUES } from "@/lib/estimates/status";

export const estimateImportSourceVersionSchema = z.object({
  id: copyUuidSchema, project_id: copyUuidSchema, project_name: z.string(),
  version_number: copyCountSchema, status: z.enum(ESTIMATE_STATUS_VALUES),
  title: z.string().nullable(), updated_at: copyTimestampSchema, total_ht_cents: copyCountSchema,
});
export const listEstimateImportSourcesResultSchema = z.object({
  items: z.array(estimateImportSourceVersionSchema).refine((rows) => new Set(rows.map((row) => row.id.toLowerCase())).size === rows.length),
});
export const estimateImportSectionPreviewSchema = z.object({
  id: copyUuidSchema, title: z.string(), line_count: copyCountSchema,
  total_ht_cents: copyCountSchema, position: copyCountSchema,
});
export const listEstimateImportSectionsResultSchema = z.object({
  source_version_id: copyUuidSchema,
  items: z.array(estimateImportSectionPreviewSchema).refine((rows) => new Set(rows.map((row) => row.id.toLowerCase())).size === rows.length),
});
export const importEstimateSectionsResponseSchema = z.object({
  source_version_id: copyUuidSchema, target_version_id: copyUuidSchema, mode: z.enum(["merge", "append"]),
  imported_sections_count: copyCountSchema, imported_lines_count: copyCountSchema,
  created_section_ids: copiedIdsSchema, created_line_ids: copiedIdsSchema,
  converted_lines: z.array(copyConvertedLineSchema).optional(), totals: copyTotalsSchema, version: copyVersionSchema,
}).superRefine((result, context) => {
  if (!sameCopyIdentity(result.version.id, result.target_version_id) || result.imported_lines_count !== result.created_line_ids.length ||
      new Set([...result.created_section_ids, ...result.created_line_ids].map((id) => id.toLowerCase())).size !== result.created_section_ids.length + result.created_line_ids.length) {
    context.addIssue({ code: "custom", message: "La confirmation d'import des sections est incohérente." });
  }
  // The section count is selected roots, not created sections: merge may create none, append may create descendants.
});
export const duplicateSectionResponseSchema = z.object({
  duplicated_section_id: copyUuidSchema, source_version_id: copyUuidSchema, target_version_id: copyUuidSchema,
  copied_item_count: copyCountSchema.refine((count) => count > 0),
  converted_lines: z.array(copyConvertedLineSchema).optional(), totals: copyTotalsSchema, version: copyVersionSchema,
}).refine((result) => sameCopyIdentity(result.version.id, result.target_version_id), "La copie appartient à un autre devis.");

export type EstimateImportSourceVersionItem = z.infer<typeof estimateImportSourceVersionSchema>;
export type ListEstimateImportSourcesResult = z.infer<typeof listEstimateImportSourcesResultSchema>;
export type EstimateImportSectionPreviewItem = z.infer<typeof estimateImportSectionPreviewSchema>;
export type ListEstimateImportSectionsResult = z.infer<typeof listEstimateImportSectionsResultSchema>;
export type ImportEstimateSectionsResult = z.infer<typeof importEstimateSectionsResponseSchema>;
export type DuplicateSectionResult = z.infer<typeof duplicateSectionResponseSchema>;

export const importEstimateSectionsClientResultSchema = z.object({
  sourceVersionId: copyUuidSchema, targetVersionId: copyUuidSchema,
  mode: importEstimateSectionsResponseSchema.shape.mode,
  importedSectionsCount: copyCountSchema, importedLinesCount: copyCountSchema,
  createdSectionIds: copiedIdsSchema, createdLineIds: copiedIdsSchema,
  versionToken: copyVersionSchema.nullable(), convertedLines: z.array(copyConvertedLineClientSchema).optional(),
});
export type ImportEstimateSectionsClientResult = z.infer<typeof importEstimateSectionsClientResultSchema>;

export function toEstimateImportSourceClient(row: EstimateImportSourceVersionItem) {
  return { id: row.id, projectId: row.project_id, projectName: row.project_name,
    versionNumber: row.version_number, status: row.status, title: row.title,
    updatedAt: row.updated_at, totalHtCents: row.total_ht_cents };
}
export function toEstimateImportSectionClient(row: EstimateImportSectionPreviewItem) {
  return { id: row.id, title: row.title, lineCount: row.line_count, totalHtCents: row.total_ht_cents, position: row.position };
}
export function toImportEstimateSectionsClient(result: ImportEstimateSectionsResult): ImportEstimateSectionsClientResult {
  return { sourceVersionId: result.source_version_id, targetVersionId: result.target_version_id,
    mode: result.mode, importedSectionsCount: result.imported_sections_count, importedLinesCount: result.imported_lines_count,
    createdSectionIds: result.created_section_ids, createdLineIds: result.created_line_ids, versionToken: result.version,
    convertedLines: (result.converted_lines ?? []).map((line) => ({ title: line.title, templateHours: line.template_hours, convertedHours: line.converted_hours })) };
}
export function toDuplicateSectionClient(result: DuplicateSectionResult) {
  return { duplicatedSectionId: result.duplicated_section_id, sourceVersionId: result.source_version_id,
    targetVersionId: result.target_version_id, copiedItemCount: result.copied_item_count, versionToken: result.version,
    convertedLines: (result.converted_lines ?? []).map((line) => ({ title: line.title, templateHours: line.template_hours, convertedHours: line.converted_hours })) };
}
export type EstimateImportSourceVersion = ReturnType<typeof toEstimateImportSourceClient>;
export type EstimateImportSectionPreview = ReturnType<typeof toEstimateImportSectionClient>;
export type DuplicateEstimateSectionResult = ReturnType<typeof toDuplicateSectionClient>;
