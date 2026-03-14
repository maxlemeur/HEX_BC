import { EstimateEditorPage } from "@/components/estimates/editor/EstimateEditorPage";

type EditEstimateRoutePageProps = {
  params: Promise<{ versionId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EditEstimateRoutePage({
  params,
  searchParams,
}: Readonly<EditEstimateRoutePageProps>) {
  const { versionId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const focusItemIdValue = resolvedSearchParams.focusItemId;
  const openVersionZeroValue = resolvedSearchParams.openVersionZero;
  const openStructureDraftValue = resolvedSearchParams.openStructureDraft;
  const importLinkedDpgfValue = resolvedSearchParams.importLinkedDpgf;
  const focusItemId =
    typeof focusItemIdValue === "string"
      ? focusItemIdValue
      : Array.isArray(focusItemIdValue)
        ? (focusItemIdValue[0] ?? null)
        : null;
  const autoOpenVersionZero =
    typeof openVersionZeroValue === "string"
      ? openVersionZeroValue === "1" || openVersionZeroValue === "true"
      : Array.isArray(openVersionZeroValue)
        ? (openVersionZeroValue[0] ?? "") === "1" ||
          (openVersionZeroValue[0] ?? "") === "true"
        : false;
  const autoOpenStructureDraft =
    typeof openStructureDraftValue === "string"
      ? openStructureDraftValue === "1" || openStructureDraftValue === "true"
      : Array.isArray(openStructureDraftValue)
        ? (openStructureDraftValue[0] ?? "") === "1" ||
          (openStructureDraftValue[0] ?? "") === "true"
        : false;
  const autoImportLinkedDpgf =
    typeof importLinkedDpgfValue === "string"
      ? importLinkedDpgfValue === "1" || importLinkedDpgfValue === "true"
      : Array.isArray(importLinkedDpgfValue)
        ? (importLinkedDpgfValue[0] ?? "") === "1" ||
          (importLinkedDpgfValue[0] ?? "") === "true"
        : false;

  return (
    <EstimateEditorPage
      versionId={versionId}
      focusItemId={focusItemId}
      autoOpenVersionZero={autoOpenVersionZero}
      autoOpenStructureDraft={autoOpenStructureDraft}
      autoImportLinkedDpgf={autoImportLinkedDpgf}
    />
  );
}
