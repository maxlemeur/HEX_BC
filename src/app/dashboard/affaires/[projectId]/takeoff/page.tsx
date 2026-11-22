import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";

import { JourneyPageHeader } from "@/components/journey/JourneyPage";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { NavigationLink as Link } from "@/components/navigation/NavigationFeedback";
import { buttonVariants } from "@/components/ui/button";
import { TakeoffItemListPanel } from "@/components/takeoff/TakeoffItemListPanel";
import TakeoffActivityCenter from "@/components/takeoff/TakeoffActivityCenter";
import { TakeoffFlowHierarchyPanel } from "@/components/takeoff/TakeoffFlowHierarchyPanel";
import { TakeoffItemDetailScreen } from "@/components/takeoff/item-detail/TakeoffItemDetailScreen";
import { getUserContext } from "@/lib/auth/server";
import {
  fetchAffaireHubPlansSummary,
  fetchAffaireHubSummary,
  fetchAffaireProjectBasic,
  fetchProjectVersionList,
} from "@/lib/affaires/server";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { itemTableReturnHref } from "@/lib/takeoff/item-detail-address";
import { buildTakeoffLaunchContext } from "@/lib/takeoff/launch-context";
import { isTakeoffLaunchActive } from "@/lib/takeoff/launch-request-server";
import { fetchPlanSetsForProject } from "@/lib/takeoff/plans";
import { TAKEOFF_ITEM_DETAIL_PARAMS } from "@/lib/takeoff/review-href";

type Props = {
  params: Promise<{ projectId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AffaireTakeoffPage({ params, searchParams }: Props) {
  const [{ projectId }, { tenantId, profile }] = await Promise.all([
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

  // Once the automatic start is on, an analysis is launched only from the options of the affaire's takeoff zone, as a
  // launch request: this page's launch links (`launch=1`, old bookmarks) lead there and it launches nothing itself.
  // A failed read of the activation is taken as « on »: the zone decides from its own read.
  const query = (await searchParams) ?? {};
  const launchRequestsActive = await isTakeoffLaunchActive().catch(() => true);
  const takeoffZoneHref = `/dashboard/affaires/${projectId}?view=overview`;
  if (launchRequestsActive && query.launch === "1") {
    const planSet = typeof query.launchPlanSet === "string" ? `&launchPlanSet=${encodeURIComponent(query.launchPlanSet)}` : "";
    redirect(`${takeoffZoneHref}&metreOptions=1${planSet}#metre`);
  }

  // The detail of an item opened from the table of items (`?poste=…`): the same page, its address and its reads
  // (the table's routes, which check the member's access to the affaire), the table one step back.
  if (query[TAKEOFF_ITEM_DETAIL_PARAMS.itemId] !== undefined) {
    const project = await fetchAffaireProjectBasic(projectId).catch((err: unknown) => {
      if (err !== null && typeof err === "object" && "code" in err && (err as { code: string }).code === "NOT_FOUND") notFound();
      throw err;
    });
    const search = new URLSearchParams();
    for (const [name, value] of Object.entries(query)) {
      for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) search.append(name, entry);
    }
    return (
      <div className="space-y-3">
        <Breadcrumbs items={[
          { label: "Affaires", href: "/dashboard/affaires" },
          { label: project.name, href: `/dashboard/affaires/${projectId}` },
          { label: "Métrés", href: itemTableReturnHref(projectId, search, null) },
          { label: "Détail du poste" },
        ]} />
        <Suspense>
          <TakeoffItemDetailScreen projectId={projectId} viewerKey={`${tenantId}:${profile?.id ?? ""}`} />
        </Suspense>
      </div>
    );
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
  const launchContext = launchRequestsActive ? null : buildTakeoffLaunchContext({
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
      viewerKey={`${tenantId}:${profile?.id ?? ""}`}
      header={
        <>
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
          {launchRequestsActive ? (
            <p className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              Le métré de l’affaire se lance et se relance depuis son état, sur la page de l’affaire.
              <Link href={`${takeoffZoneHref}#metre`} className={buttonVariants({ variant: "outline", size: "sm" })}>État du métré</Link>
            </p>
          ) : null}
          {versionsResult.status === "fulfilled" && (
            <Suspense>
              {/* The affaire's list of items, with or without an estimate: whole before the first estimate, one line
                  with a link to it after. */}
              <TakeoffItemListPanel projectId={projectId} query={query} compact={versions.length > 0} />
            </Suspense>
          )}
        </>
      }
      help={<TakeoffFlowHierarchyPanel />}
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
