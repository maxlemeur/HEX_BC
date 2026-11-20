import { requestJson } from "@/lib/estimates/client-requests";
import { parseEstimateVersionIdResponse, parsePromoteEstimateVariantResponse } from "@/lib/estimates/write-response-contracts";

export async function duplicateEstimateVersion(
  versionId: string
): Promise<string> {
  const payload = await requestJson(
    `/api/estimates/${versionId}/duplicate`,
    {
      method: "POST",
    },
    "Impossible de dupliquer le chiffrage.",
    value => parseEstimateVersionIdResponse(value, versionId)
  );

  return payload.version_id;
}

export async function createEstimateVariant(
  versionId: string
): Promise<string> {
  const payload = await requestJson(
    `/api/estimates/${versionId}/variants`,
    {
      method: "POST",
    },
    "Impossible de créer la variante.",
    value => parseEstimateVersionIdResponse(value, versionId)
  );

  return payload.version_id;
}

export async function promoteEstimateVariant(
  versionId: string
): Promise<string> {
  const payload = await requestJson(
    `/api/estimates/${versionId}/variants`,
    {
      method: "PATCH",
    },
    "Impossible de promouvoir la variante.",
    value => parsePromoteEstimateVariantResponse(value, versionId)
  );

  return payload.version.id;
}
