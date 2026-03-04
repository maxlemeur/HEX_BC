import { EstimateEditorPage } from "@/components/estimates/editor/EstimateEditorPage";

type EditEstimateRoutePageProps = {
  params: Promise<{ versionId: string }>;
};

export default async function EditEstimateRoutePage({
  params,
}: Readonly<EditEstimateRoutePageProps>) {
  const { versionId } = await params;

  return <EstimateEditorPage versionId={versionId} />;
}
