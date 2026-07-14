import { EstimateEditorPage } from "@/components/estimates/editor/EstimateEditorPage";
import type { SettingsSection } from "@/components/estimates/EstimateSettingsSummaryBar";

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
  const openSettingsValue = resolvedSearchParams.openSettings;
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
  const requestedSettingsSection =
    typeof openSettingsValue === "string"
      ? openSettingsValue
      : Array.isArray(openSettingsValue)
        ? (openSettingsValue[0] ?? "")
        : "";
  const autoOpenSettingsSection: SettingsSection | null =
    requestedSettingsSection === "margin" ||
    requestedSettingsSection === "discount" ||
    requestedSettingsSection === "tax" ||
    requestedSettingsSection === "rounding" ||
    requestedSettingsSection === "general"
      ? requestedSettingsSection
      : null;

  return (
    <EstimateEditorPage
      versionId={versionId}
      focusItemId={focusItemId}
      autoOpenVersionZero={autoOpenVersionZero}
      autoOpenStructureDraft={autoOpenStructureDraft}
      autoOpenSettingsSection={autoOpenSettingsSection}
    />
  );
}
