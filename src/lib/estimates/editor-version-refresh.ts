import type { EstimateEditorData } from "@/lib/estimates/client";

type FetchEstimateEditorData = (versionId: string) => Promise<EstimateEditorData>;

type RefreshVersionTokenAfterAssemblyInsertOptions = {
  fetchEstimateEditorData: FetchEstimateEditorData;
  onVersionToken: (updatedAt: string) => void;
  onError: (error: unknown) => void;
};

export async function refreshVersionTokenAfterAssemblyInsert(
  versionId: string,
  options: RefreshVersionTokenAfterAssemblyInsertOptions
) {
  try {
    const refreshed = await options.fetchEstimateEditorData(versionId);
    options.onVersionToken(refreshed.version.updated_at);
  } catch (error) {
    options.onError(error);
  }
}
