import { notFound } from "next/navigation";

import { HubBreadcrumb } from "@/components/HubBreadcrumb";
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
      <HubBreadcrumb
        hubHref="/dashboard/affaires"
        hubLabel="Mes affaires"
        intermediateHref={`/dashboard/affaires/${projectId}`}
        intermediateLabel={project.name}
        currentLabel="Métrés"
      />

      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--slate-900)]">
          Centre d&apos;activité &mdash; Métrés
        </h1>
        <p className="mt-1 text-sm text-[var(--slate-500)]">
          Suivez les analyses de plans, les exceptions et l&apos;historique
          d&apos;application.
        </p>
      </div>

      <TakeoffRouteHierarchyBanner
        descriptor={buildTakeoffRouteHierarchy({ kind: "affaire_takeoff" })}
      />

      <TakeoffFlowHierarchyPanel
        currentKind="adjacent"
        legacyPlanSetCount={countLegacyPlanSets(planSets)}
      />

      <TakeoffActivityCenter
        projectId={projectId}
        versions={versions}
        launchContext={launchContext}
        planSets={planSets.map((ps) => ({
          id: ps.id,
          name: ps.name,
          metadata: ps.metadata,
        }))}
      />
    </div>
  );
}
