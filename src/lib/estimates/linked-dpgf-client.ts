import { requestJson } from "@/lib/estimates/client-requests";
import { toAffaireLinkedDpgfSourceClient, toImportLinkedDpgfSourceClient, type AffaireLinkedDpgfSource } from "@/lib/estimates/linked-dpgf-contracts";
import { parseLinkedDpgfSourceResponse, parseImportLinkedDpgfResponse } from "@/lib/estimates/section-copy-response";
import type { ImportLinkedDpgfSourceResult } from "@/lib/estimates/schemas";

export type ImportLinkedDpgfSourcePayload = {
  sectionTitle?: string | null;
};

export async function fetchAffaireLinkedDpgfSource(
  projectId: string,
  options?: { signal?: AbortSignal }
): Promise<AffaireLinkedDpgfSource> {
  const payload = await requestJson(
    `/api/affaires/${encodeURIComponent(projectId)}/dpgf-source`,
    {
      method: "GET",
      signal: options?.signal,
    },
    "Impossible de charger la source DPGF de l'affaire.",
    parseLinkedDpgfSourceResponse
  );

  return toAffaireLinkedDpgfSourceClient(payload);
}

export async function importLinkedDpgfSource(
  targetVersionId: string,
  input: ImportLinkedDpgfSourcePayload = {}
): Promise<ImportLinkedDpgfSourceResult> {
  const payload = await requestJson(
    `/api/estimates/${targetVersionId}/import-linked-dpgf`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sectionTitle: input.sectionTitle ?? null,
      }),
    },
    "Impossible d'importer la source DPGF liée.",
    value => parseImportLinkedDpgfResponse(value, targetVersionId),
    { mutation: { versionId: targetVersionId, structural: true } }
  );

  return toImportLinkedDpgfSourceClient(payload);
}
