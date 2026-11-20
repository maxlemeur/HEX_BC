import { requestJson } from "@/lib/estimates/client-requests";
import type { EstimateItem } from "@/lib/estimates/editor-read-client";
import { parseSaveEstimateVersionResponse } from "@/lib/estimates/write-response-contracts";
import type { Database } from "@/types/database";
import type { EstimateVersionRow } from "@/lib/estimates/editor-items";

export async function saveEstimateVersion(
  versionId: string,
  updates: Database["public"]["Tables"]["estimate_versions"]["Update"],
  updatedAtToken: string,
  expectedContentRevision: number
): Promise<{ version: EstimateVersionRow; items: EstimateItem[] }> {
  const payload = await requestJson(
    `/api/estimates/${versionId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "If-Match": updatedAtToken,
      },
      body: JSON.stringify({
        ...updates,
        updated_at: updatedAtToken,
        expected_content_revision: expectedContentRevision,
      }),
    },
    "Impossible de sauvegarder le chiffrage.",
    value => parseSaveEstimateVersionResponse(value, versionId),
    { mutation: { versionId: versionId, structural: false } }
  );

  return payload;
}
