import { requestJson } from "@/lib/estimates/client-requests";
import { toEstimateImportSourceClient, toEstimateImportSectionClient, toImportEstimateSectionsClient, toDuplicateSectionClient, type EstimateImportSourceVersion, type EstimateImportSectionPreview, type DuplicateEstimateSectionResult } from "@/lib/estimates/section-copy-contracts";
import { parseImportSourcesResponse, parseImportSectionsPreviewResponse, parseImportSectionsResponse, parseDuplicateSectionResponse } from "@/lib/estimates/section-copy-response";
import type { ImportEstimateSectionsResult } from "@/lib/estimates/schemas";
import { isOlderEstimateVersionToken } from "@/lib/estimates/editor-mutations";

export type ImportEstimateSectionsMode = "merge" | "append";

export type ImportEstimateSectionsPayload = {
  sourceVersionId: string;
  sectionIds: string[];
  mode: ImportEstimateSectionsMode;
};

export async function fetchEstimateImportSources(options?: {
  excludeVersionId?: string;
}): Promise<EstimateImportSourceVersion[]> {
  const params = new URLSearchParams();
  if (options?.excludeVersionId?.trim()) {
    params.set("excludeVersionId", options.excludeVersionId.trim());
  }

  const query = params.toString();
  const path = query.length > 0
    ? `/api/estimates/import-sources?${query}`
    : "/api/estimates/import-sources";

  const payload = await requestJson(
    path,
    {
      method: "GET",
    },
    "Impossible de charger les devis sources.",
    parseImportSourcesResponse
  );

  return payload.items.map(toEstimateImportSourceClient).sort((left, right) =>
    (isOlderEstimateVersionToken(left.updatedAt, right.updatedAt) ? 1
      : isOlderEstimateVersionToken(right.updatedAt, left.updatedAt) ? -1 : 0) || right.versionNumber - left.versionNumber);
}

export async function fetchEstimateImportableSections(
  sourceVersionId: string
): Promise<EstimateImportSectionPreview[]> {
  const payload = await requestJson(
    `/api/estimates/${sourceVersionId}/sections`,
    {
      method: "GET",
    },
    "Impossible de charger les sections importables.",
    value => parseImportSectionsPreviewResponse(value, sourceVersionId)
  );

  return payload.items.map(toEstimateImportSectionClient).sort((left, right) => left.position - right.position);
}

export async function importEstimateSections(
  targetVersionId: string,
  input: ImportEstimateSectionsPayload
): Promise<ImportEstimateSectionsResult> {
  const payload = await requestJson(
    `/api/estimates/${targetVersionId}/import-sections`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourceVersionId: input.sourceVersionId,
        sectionIds: input.sectionIds,
        mode: input.mode,
      }),
    },
    "Impossible d'importer les sections.",
    value => parseImportSectionsResponse(value, { sourceVersionId: input.sourceVersionId, targetVersionId, mode: input.mode }),
    { mutation: { versionId: targetVersionId, structural: true } }
  );

  return toImportEstimateSectionsClient(payload);
}

export async function duplicateEstimateSection(
  versionId: string,
  sectionId: string,
  options?: { targetVersionId?: string | null }
): Promise<DuplicateEstimateSectionResult> {
  const payload = await requestJson(
    `/api/estimates/${versionId}/sections/${sectionId}/duplicate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        targetVersionId: options?.targetVersionId ?? null,
      }),
    },
    "Impossible de dupliquer la section.",
    value => parseDuplicateSectionResponse(value, { sourceVersionId: versionId, targetVersionId: options?.targetVersionId ?? versionId }),
    { mutation: { versionId: options?.targetVersionId ?? versionId, structural: true } }
  );

  return toDuplicateSectionClient(payload);
}
