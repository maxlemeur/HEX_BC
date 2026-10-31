import { notFound } from "next/navigation";

import { JourneyPageHeader } from "@/components/journey/JourneyPage";
import TakeoffActivityCenter from "@/components/takeoff/TakeoffActivityCenter";
import { TakeoffFlowHierarchyPanel } from "@/components/takeoff/TakeoffFlowHierarchyPanel";
import { getUserContext } from "@/lib/auth/server";
import {
  fetchAffaireHubPlansSummary,
  fetchAffaireHubSummary,
  fetchAffaireProjectBasic,
  fetchProjectVersionList,
} from "@/lib/affaires/server";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { countLegacyPlanSets } from "@/lib/takeoff/flow-hierarchy";
import { buildTakeoffLaunchContext } from "@/lib/takeoff/launch-context";
import { fetchPlanSetsForProject } from "@/lib/takeoff/plans";

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
    // Lot 3.2 : le métré n'affiche pas la marge, il ne recalcule pas un brouillon v3 pour elle.
    fetchAffaireHubSummary(projectId, { liveV3Margin: false }),
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
  const launchContext = buildTakeoffLaunchContext({
    currentVersion: hubSummary?.currentVersion
      ? {
          id: hubSummary.currentVersion.id,
          status: hubSummary.currentVersion.status,
          versionNumber: hubSummary.currentVersion.versionNumber,
        }
      : null,
    versions,
    plansSummary,
  });

  return (
    <TakeoffActivityCenter
      projectId={projectId}
      header={
        <JourneyPageHeader
          breadcrumbs={[
            { label: "Affaires", href: "/dashboard/affaires" },
            {
              label: project.name,
              href: `/dashboard/affaires/${projectId}`,
            },
            { label: "Métrés" },
          ]}
          title="Métrés"
          stage="Étude"
          context="L’IA lit vos plans et propose les quantités. Vous les vérifiez avant de les reporter au devis."
        />
      }
      help={
        <TakeoffFlowHierarchyPanel
          currentKind="adjacent"
          legacyPlanSetCount={countLegacyPlanSets(planSets)}
        />
      }
      versions={versions}
      launchContext={launchContext}
      latestJobContext={
        plansSummary?.latestJob
          ? {
              jobId: plansSummary.latestJob.jobId,
              reviewVersionId: plansSummary.latestJob.reviewVersionId,
              failureReasonLabel: plansSummary.failureReasonLabel,
            }
          : null
      }
      initialHasAnalyses={Boolean(plansSummary?.latestJob)}
      planSets={planSets.map((ps) => ({
        id: ps.id,
        name: ps.name,
        metadata: ps.metadata,
        fileCount: ps.file_count,
      }))}
    />
  );
}
