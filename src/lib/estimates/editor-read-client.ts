import type { Database } from "@/types/database";
import type { EstimateLineTruth } from "@/lib/estimates/line-truth";
import { getRootPayload, pickArray } from "@/lib/estimates/client-json";
import { requestJsonUncoordinated as requestJson } from "@/lib/estimates/client-http";
import { parseEstimateEditorData, type EstimateEditorData } from "@/lib/estimates/editor-read-contracts";

export type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"] & {
  selected_supplier_details?: import("@/lib/estimates/supplier-offer-conditions").SelectedSupplierDetails | null;
  source_provider?: string | null;
  source_job_id?: string | null;
  source_file_name?: string | null;
  source_page?: number | null;
  source_level?: string | null;
  source_version_number?: number | null;
  source_extracted_at?: string | null;
  source_metadata?: unknown;
  line_truth?: EstimateLineTruth | null;
};

export function parseEstimateItems(payload: unknown): EstimateItem[] {
  const root = getRootPayload(payload);
  const rows = pickArray(root, ["items", "estimateItems", "estimate_items"]);
  return rows as EstimateItem[];
}

export async function fetchEstimateItemsForVersion(
  versionId: string
): Promise<EstimateItem[]> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/items`,
    {
      method: "GET",
    },
    "Impossible de charger les lignes."
  );

  return parseEstimateItems(payload);
}

export async function fetchEstimateEditorData(
  versionId: string
): Promise<EstimateEditorData> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}`,
    {
      method: "GET",
    },
    "Impossible de charger le chiffrage."
  );

  return parseEstimateEditorData(payload, versionId);
}
