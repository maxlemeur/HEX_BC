import type { TakeoffDocumentRecommendation } from "@/lib/takeoff/document-classifier";

export type TakeoffLaunchContext = {
  currentVersion: {
    id: string;
    status: string;
    versionNumber: number;
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
  }>;
};

export function buildTakeoffLaunchContext(input: {
  currentVersion?: {
    id: string;
    status: string;
    versionNumber: number;
  } | null;
  versions: Array<{ id: string; version_number: number }>;
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
    })),
  };
}
