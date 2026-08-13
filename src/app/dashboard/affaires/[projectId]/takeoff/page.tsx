import { notFound } from "next/navigation";

import { ProductionRibbonHeader } from "@/components/dashboard/ProductionRibbon";
import TakeoffActivityCenter from "@/components/takeoff/TakeoffActivityCenter";
import { TakeoffFlowHierarchyPanel } from "@/components/takeoff/TakeoffFlowHierarchyPanel";
import { TakeoffRouteHierarchyBanner } from "@/components/takeoff/TakeoffRouteHierarchyBanner";
import { getUserContext } from "@/lib/auth/server";
import {
  fetchAffaireHubPlansSummary,
  fetchAffaireHubSummary,
  fetchAffaireProjectBasic,
  fetchProjectVersionList,
} from "@/lib/affaires/server";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { countLegacyPlanSets } from "@/lib/takeoff/flow-hierarchy";
import { fetchPlanSetsForProject } from "@/lib/takeoff/plans";
import { buildTakeoffRouteHierarchy } from "@/lib/takeoff/route-hierarchy";

type Props = {
  params: Promise<{ projectId: string }>;
};

export default async function AffaireTakeoffPage({ params }: Props) {
  const [{ projectId }, { tenantId }] = await Promise.all([
    params,
    getUserContext(),
  ]);

  if (!tenantId) {
    notFound();
  }

  const takeoffEnabled = await isTakeoffEnabled(tenantId);
  if (!takeoffEnabled) {
    notFound();
  }

  const [
    projectResult,
    versionsResult,
    planSetsResult,
    hubSummaryResult,
    plansSummaryResult,
  ] = await Promise.allSettled([
    fetchAffaireProjectBasic(projectId),
    fetchProjectVersionList(projectId),
    fetchPlanSetsForProject(projectId),
    fetchAffaireHubSummary(projectId),
    fetchAffaireHubPlansSummary(projectId),
  ]);

  if (projectResult.status === "rejected") {
    const err = projectResult.reason as unknown;
    if (
      err !== null &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "NOT_FOUND"
    ) {
      notFound();
    }
    throw err;
  }

  const project = projectResult.value;
  const versions =
    versionsResult.status === "fulfilled" ? versionsResult.value : [];
  const planSets =
    planSetsResult.status === "fulfilled" ? planSetsResult.value : [];
  const hubSummary =
    hubSummaryResult.status === "fulfilled" ? hubSummaryResult.value : null;
  const plansSummary =
    plansSummaryResult.status === "fulfilled" ? plansSummaryResult.value : null;
  const launchContext =
    plansSummary?.defaultPlanSetId &&
    (hubSummary?.currentVersion || versions.length > 0)
      ? {
          currentVersion: hubSummary?.currentVersion
            ? {
                id: hubSummary.currentVersion.id,
                status: hubSummary.currentVersion.status,
                versionNumber: hubSummary.currentVersion.versionNumber,
              }
            : null,
          plansContext: {
            defaultPlanSetId: plansSummary.defaultPlanSetId,
            defaultPlanSetName: plansSummary.defaultPlanSetName,
            defaultPlanSetSource: plansSummary.defaultPlanSetSource,
            defaultPlanSetFileCount: plansSummary.defaultPlanSetFileCount,
            launchRecommendation: plansSummary.launchRecommendation ?? null,
          },
          availableVersions: versions.map((version) => ({
            id: version.id,
            versionNumber: version.version_number,
          })),
        }
      : null;

  return (
    <div className="min-w-0">
      <TakeoffActivityCenter
        projectId={projectId}
        ribbonHeader={
          <ProductionRibbonHeader
            breadcrumbs={[
              { label: "Mes affaires", href: "/dashboard/affaires" },
              {
                label: project.name,
                href: `/dashboard/affaires/${projectId}`,
              },
              { label: "Métrés" },
            ]}
            title="Centre d'activité — Métrés"
            description="Analyses de plans, exceptions et historique d'application"
          />
        }
        ribbonPreamble={
          <>
            <TakeoffRouteHierarchyBanner
              descriptor={buildTakeoffRouteHierarchy({
                kind: "affaire_takeoff",
              })}
            />
            <TakeoffFlowHierarchyPanel
              currentKind="adjacent"
              legacyPlanSetCount={countLegacyPlanSets(planSets)}
            />
          </>
        }
        versions={versions}
        launchContext={launchContext}
        planSets={planSets.map((ps) => ({
          id: ps.id,
          name: ps.name,
          metadata: ps.metadata,
          fileCount: ps.file_count,
        }))}
      />
    </div>
  );
}
