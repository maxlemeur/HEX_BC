import { preload } from "react-dom";

import { EstimateEditorPage } from "@/components/estimates/editor/EstimateEditorPage";
import { EstimateEngineUnavailableNotice } from "@/components/estimates/EstimateEngineUnavailableNotice";
import type { SettingsSection } from "@/components/estimates/EstimateSettingsSummaryBar";
import { resolveEstimateEngineVersionForDisplay } from "@/lib/estimates/calc-engine-version";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type EditEstimateRoutePageProps = {
  params: Promise<{ versionId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Lot 2, sous-lot 2.1, puis 2.6 : l'éditeur calcule en moteur 1, 2 ou 3 (la v3 délègue au moteur
 * pur et à ses écrivains). Seul un moteur inconnu (au-delà de 3) est remplacé par le bandeau avant
 * tout chargement de l'éditeur (ni verrou, ni normalisation, ni sauvegarde). Une lecture en échec
 * laisse l'éditeur signaler sa propre erreur.
 */
async function readEngineUnavailableVersion(versionId: string) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("estimate_versions")
      .select("version_number, project_id, calc_engine_version, estimate_projects ( name )")
      .eq("id", versionId)
      .maybeSingle();
    if (!data || resolveEstimateEngineVersionForDisplay(data) !== null) return null;
    const project = Array.isArray(data.estimate_projects) ? data.estimate_projects[0] : data.estimate_projects;
    return { versionNumber: data.version_number, projectId: data.project_id, projectName: project?.name ?? null };
  } catch {
    return null;
  }
}

const VERSION_ID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

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

  // La première lecture de l'éditeur part avec la page plutôt qu'après le chargement de ses scripts :
  // sa propre requête vers cette URL (même identifiant en minuscules) reçoit alors cette réponse.
  // Demandée avant la lecture du moteur, elle n'attend pas celle-ci.
  if (VERSION_ID_PATTERN.test(versionId)) {
    preload(`/api/estimates/${versionId.toLowerCase()}`, { as: "fetch", crossOrigin: "anonymous" });
  }

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
