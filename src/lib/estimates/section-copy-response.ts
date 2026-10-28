import {
  copyResponseFields, copyResponseRoot, normalizeCopyResult, parseCopyResponse, sameCopyIdentity,
} from "@/lib/estimates/copy-response-contract";
import {
  duplicateSectionResponseSchema, importEstimateSectionsResponseSchema,
  listEstimateImportSectionsResultSchema, listEstimateImportSourcesResultSchema,
} from "@/lib/estimates/section-copy-contracts";
import { affaireLinkedDpgfSourceResponseSchema, importLinkedDpgfSourceResponseSchema } from "@/lib/estimates/linked-dpgf-contracts";

function collection(value: unknown, aliases: string[]) {
  const root = copyResponseRoot(value);
  if (!root || typeof root !== "object" || Array.isArray(root)) return root;
  const record = root as Record<string, unknown>;
  const key = ["items", ...aliases].find((key) => key in record);
  return { ...record, items: key ? record[key] : undefined };
}

export function parseImportSourcesResponse(value: unknown) {
  const root = collection(value, ["versions", "sources"]);
  if (!root || typeof root !== "object" || !("items" in root) || !Array.isArray(root.items)) {
    return parseCopyResponse(listEstimateImportSourcesResultSchema, root);
  }
  return parseCopyResponse(listEstimateImportSourcesResultSchema, { ...root, items: root.items.map((row) => {
    const normalized = copyResponseFields(row, { project_id: "projectId", project_name: "projectName",
      version_number: "versionNumber", updated_at: "updatedAt", total_ht_cents: "totalHtCents" });
    if (!normalized || typeof normalized !== "object") return normalized;
    const record = normalized as Record<string, unknown>;
    const relation = Array.isArray(record.estimate_projects) ? record.estimate_projects[0] : record.estimate_projects;
    if (!relation || typeof relation !== "object") return record;
    const project = relation as Record<string, unknown>;
    return { ...record, project_id: record.project_id ?? project.id, project_name: record.project_name ?? project.name };
  }) });
}

export function parseImportSectionsPreviewResponse(value: unknown, sourceVersionId: string) {
  const root = copyResponseFields(collection(value, ["sections"]), { source_version_id: "sourceVersionId" });
  const result = parseCopyResponse(listEstimateImportSectionsResultSchema,
    root && typeof root === "object" && "items" in root && Array.isArray(root.items)
      ? { ...root, items: root.items.map((row) => copyResponseFields(row, { line_count: "lineCount", total_ht_cents: "totalHtCents" })) }
      : root);
  if (!sameCopyIdentity(result.source_version_id, sourceVersionId)) throw new Error("Les sections reçues appartiennent à un autre devis source.");
  return result;
}

export function parseImportSectionsResponse(value: unknown, expected: { sourceVersionId: string; targetVersionId: string; mode: "merge" | "append" }) {
  const result = parseCopyResponse(importEstimateSectionsResponseSchema, copyResponseFields(normalizeCopyResult(value), {
    source_version_id: "sourceVersionId", target_version_id: "targetVersionId",
    imported_sections_count: "importedSectionsCount", imported_lines_count: "importedLinesCount",
    created_section_ids: "createdSectionIds", created_line_ids: "createdLineIds",
  }));
  if (!sameCopyIdentity(result.source_version_id, expected.sourceVersionId) ||
      !sameCopyIdentity(result.target_version_id, expected.targetVersionId) || result.mode !== expected.mode) {
    throw new Error("La confirmation ne correspond pas à l'import demandé.");
  }
  return result;
}

export function parseDuplicateSectionResponse(value: unknown, expected: { sourceVersionId: string; targetVersionId: string }) {
  const result = parseCopyResponse(duplicateSectionResponseSchema, copyResponseFields(normalizeCopyResult(value), {
    duplicated_section_id: "duplicatedSectionId", source_version_id: "sourceVersionId",
    target_version_id: "targetVersionId", copied_item_count: "copiedItemCount",
  }));
  if (!sameCopyIdentity(result.source_version_id, expected.sourceVersionId) ||
      !sameCopyIdentity(result.target_version_id, expected.targetVersionId)) {
    throw new Error("La confirmation ne correspond pas à la copie demandée.");
  }
  return result;
}

export function parseLinkedDpgfSourceResponse(value: unknown) {
  return parseCopyResponse(affaireLinkedDpgfSourceResponseSchema, copyResponseFields(copyResponseRoot(value), {
    import_id: "importId", source_format: "sourceFormat", import_status: "importStatus", mapping_status: "mappingStatus",
    imported_at: "importedAt", mapping_updated_at: "mappingUpdatedAt", parse_mode: "parseMode",
    row_count: "rowCount", mapped_row_count: "mappedRowCount",
  }));
}

export function parseImportLinkedDpgfResponse(value: unknown, targetVersionId: string) {
  const result = parseCopyResponse(importLinkedDpgfSourceResponseSchema, copyResponseFields(normalizeCopyResult(value), {
    source_import_id: "sourceImportId", target_version_id: "targetVersionId", created_section_id: "createdSectionId",
    created_line_ids: "createdLineIds", imported_lines_count: "importedLinesCount", skipped_lines_count: "skippedLinesCount",
  }));
  if (!sameCopyIdentity(result.target_version_id, targetVersionId)) throw new Error("La confirmation DPGF appartient à un autre devis.");
  return result;
}
