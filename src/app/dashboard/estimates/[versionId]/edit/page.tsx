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
  const focusItemId =
    typeof focusItemIdValue === "string"
      ? focusItemIdValue
      : Array.isArray(focusItemIdValue)
        ? (focusItemIdValue[0] ?? null)
        : null;

  return <EstimateEditorPage versionId={versionId} focusItemId={focusItemId} />;
}
