import { EstimateEditorPage } from "@/components/estimates/editor/EstimateEditorPage";
import { EstimateEngineUnavailableNotice } from "@/components/estimates/EstimateEngineUnavailableNotice";
import type { SettingsSection } from "@/components/estimates/EstimateSettingsSummaryBar";
import { resolveCalcEngineVersionForDisplay } from "@/lib/estimates/calc-engine-version";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type EditEstimateRoutePageProps = {
  params: Promise<{ versionId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Lot 2, sous-lot 2.1 : l'éditeur ne sait calculer qu'en moteur 1 ou 2. Une version au moteur 3
 * est remplacée par le bandeau du moteur avant tout chargement de l'éditeur (ni verrou, ni
 * normalisation, ni sauvegarde). Une lecture en échec laisse l'éditeur signaler sa propre erreur ;
 * son chargement refuse lui aussi une v3 par son nom.
 */
async function readEngineUnavailableVersion(versionId: string) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("estimate_versions")
      .select("version_number, project_id, calc_engine_version, estimate_projects ( name )")
      .eq("id", versionId)
      .maybeSingle();
    if (!data || resolveCalcEngineVersionForDisplay(data) !== null) return null;
    const project = Array.isArray(data.estimate_projects) ? data.estimate_projects[0] : data.estimate_projects;
    return { versionNumber: data.version_number, projectId: data.project_id, projectName: project?.name ?? null };
  } catch {
    return null;
  }
}

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

  const engineUnavailableVersion = await readEngineUnavailableVersion(versionId);
  if (engineUnavailableVersion) {
    return <EstimateEngineUnavailableNotice {...engineUnavailableVersion} />;
  }

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
