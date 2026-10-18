import { resolveEstimateEngineVersionForDisplay } from "@/lib/estimates/calc-engine-version";
import type { EstimateEngineVersion } from "@/lib/estimates/engine/capabilities";
import type { TakeoffDocumentRecommendation } from "@/lib/takeoff/document-classifier";

// Sous-lot 2.10a (N3, D-f) : le moteur de chaque cible dit au lancement du métré qu'une v3 n'en reçoit pas.
export type TakeoffLaunchContext = {
  currentVersion: {
    id: string;
    status: string;
    versionNumber: number;
    calcEngineVersion?: EstimateEngineVersion | null;
  } | null;
  plansContext: {
    defaultPlanSetId: string | null;
    defaultPlanSetName?: string | null;
    defaultPlanSetSource?: string | null;
    defaultPlanSetFileCount?: number;
    launchRecommendation?: TakeoffDocumentRecommendation | null;
  } | null;
  availableVersions: Array<{
    id: string;
    versionNumber: number;
    calcEngineVersion?: EstimateEngineVersion | null;
  }>;
};

export function buildTakeoffLaunchContext(input: {
  currentVersion?: {
    id: string;
    status: string;
    versionNumber: number;
    calcEngineVersion?: EstimateEngineVersion | null;
  } | null;
  versions: Array<{ id: string; version_number: number; calc_engine_version?: number | null }>;
  plansSummary?: {
    defaultPlanSetId: string | null;
    defaultPlanSetName?: string | null;
    defaultPlanSetSource?: string | null;
    defaultPlanSetFileCount?: number;
    launchRecommendation?: TakeoffDocumentRecommendation | null;
  } | null;
}): TakeoffLaunchContext {
  return {
    currentVersion: input.currentVersion ?? null,
    plansContext: input.plansSummary
      ? {
          defaultPlanSetId: input.plansSummary.defaultPlanSetId,
          defaultPlanSetName: input.plansSummary.defaultPlanSetName,
          defaultPlanSetSource: input.plansSummary.defaultPlanSetSource,
          defaultPlanSetFileCount: input.plansSummary.defaultPlanSetFileCount,
          launchRecommendation:
            input.plansSummary.launchRecommendation ?? null,
        }
      : null,
    availableVersions: input.versions.map((version) => ({
      id: version.id,
      versionNumber: version.version_number,
      ...(version.calc_engine_version !== undefined
        ? { calcEngineVersion: resolveEstimateEngineVersionForDisplay(version) }
        : {}),
    })),
  };
}
