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
import { TakeoffEarlierAnalysesPanel, TakeoffEarlierAnalysisScreen } from "@/components/takeoff/TakeoffEarlierAnalysis";
import { TakeoffLinkNotice } from "@/components/takeoff/TakeoffLinkNotice";
import { getUserContext } from "@/lib/auth/server";
import {
  fetchAffaireHubPlansSummary,
  fetchAffaireHubSummary,
  fetchAffaireProjectBasic,
  fetchProjectVersionList,
} from "@/lib/affaires/server";
import { readEarlierAnalysisParam } from "@/lib/takeoff/earlier-analysis";
import { readEarlierTakeoffAnalysis } from "@/lib/takeoff/earlier-analysis-server";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { itemTableReturnHref } from "@/lib/takeoff/item-detail-address";
import { buildTakeoffLaunchContext } from "@/lib/takeoff/launch-context";
import { isTakeoffLaunchActive } from "@/lib/takeoff/launch-request-server";
import { isTakeoffPlanDispatchActive } from "@/lib/takeoff/local-dispatcher";
import { fetchPlanSetsForProject } from "@/lib/takeoff/plans";
import { TAKEOFF_ITEM_DETAIL_PARAMS } from "@/lib/takeoff/review-href";
import { resolveTakeoffReviewLink } from "@/lib/takeoff/review-link";

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

  // Once the automatic start is on, this page's former launch links (`launch=1`, old bookmarks) lead to the affaire's options.
  // A failed read of the activation is taken as « on »: the zone decides from its own read.
  const query = (await searchParams) ?? {};
  const launchRequestsActive = await isTakeoffLaunchActive().catch(() => true);
  const takeoffZoneHref = `/dashboard/affaires/${projectId}?view=overview`;
  if (launchRequestsActive && query.launch === "1") {
    const planSet = typeof query.launchPlanSet === "string" ? `&launchPlanSet=${encodeURIComponent(query.launchPlanSet)}` : "";
    redirect(`${takeoffZoneHref}&metreOptions=1${planSet}#metre`);
  }

  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) search.append(name, entry);
  }

  // The detail of an item opened from the table of items (`?poste=…`): the same page, its address and its reads
  // (the table's routes, which check the member's access to the affaire), the table one step back.
  if (query[TAKEOFF_ITEM_DETAIL_PARAMS.itemId] !== undefined) {
    const project = await fetchAffaireProjectBasic(projectId).catch((err: unknown) => {
      if (err !== null && typeof err === "object" && "code" in err && (err as { code: string }).code === "NOT_FOUND") notFound();
      throw err;
    });
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

  // An analysis of the affaire not read against its list, read only as it was kept (`?anterieure=…`), the table one
  // step back. A job read against the list is not one: the table shows it, as its review's link does.
  const earlierJob = readEarlierAnalysisParam(search);
  if (earlierJob !== null) {
    const project = await fetchAffaireProjectBasic(projectId).catch((err: unknown) => {
      if (err !== null && typeof err === "object" && "code" in err && (err as { code: string }).code === "NOT_FOUND") notFound();
      throw err;
    });
    const earlier = earlierJob === "invalid" ? null : await readEarlierTakeoffAnalysis(project.id, earlierJob).catch((err: unknown) => {
      if (err !== null && typeof err === "object" && "status" in err && [403, 404].includes((err as { status: number }).status)) return null;
      throw err;
    });
    if (!earlier) notFound();
    if (earlier.kind === "list") redirect(resolveTakeoffReviewLink({ projectId: earlier.projectId, jobId: earlierJob }, earlier.facts).href);
    return <TakeoffEarlierAnalysisScreen projectId={project.id} projectName={project.name} view={earlier.view} query={search} />;
  }

  const [
    projectResult,
    versionsResult,
    planSetsResult,
    hubSummaryResult,
    plansSummaryResult,
    planDispatchResult,
  ] = await Promise.allSettled([
    fetchAffaireProjectBasic(projectId),
    fetchProjectVersionList(projectId),
    fetchPlanSetsForProject(projectId),
    // Lot 3.2 : le métré n'affiche pas la marge, il ne recalcule pas un brouillon v3 pour elle.
    fetchAffaireHubSummary(projectId, { liveV3Margin: false }),
    fetchAffaireHubPlansSummary(projectId),
    launchRequestsActive && isTakeoffPlanDispatchActive(),
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
  const planDispatch = planDispatchResult.status === "fulfilled" && planDispatchResult.value;
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
      planDispatch={planDispatch}
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
          <Suspense>
            {/* Why the table opened as it did, after a link to the review of an analysis read against the list. */}
            <TakeoffLinkNotice projectId={projectId} query={search} />
          </Suspense>
          {launchRequestsActive ? (
            <p className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              Les options du métré sont disponibles sur la page de l’affaire.
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
      earlier={(
        <Suspense>
          {/* Beside the table, once the affaire has a list: its analyses that were not read against it. */}
          <TakeoffEarlierAnalysesPanel projectId={projectId} query={search} />
        </Suspense>
      )}
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
