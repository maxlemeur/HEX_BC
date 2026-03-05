import { notFound } from "next/navigation";

import { AffaireHub } from "@/components/affaires/AffaireHub";
import { LastAffaireTracker } from "@/components/affaires/LastAffaireTracker";
import { getUserContext } from "@/lib/auth/server";
import {
  fetchAffaireHubDpgfSource,
  fetchAffaireHubMarginAnalysis,
  fetchAffaireHubPlansSummary,
  fetchAffaireHubSummary,
  fetchAffaireHubTimeline,
} from "@/lib/affaires/server";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";

type Props = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AffaireHubPage({ params, searchParams }: Props) {
  const [{ projectId }, search, { tenantId }] = await Promise.all([
    params,
    searchParams,
    getUserContext(),
  ]);

  if (!tenantId) {
    notFound();
  }

  const justCreated =
    typeof search.created === "string" && search.created === "1";

  const timelinePageRaw =
    typeof search.timelinePage === "string"
      ? Number.parseInt(search.timelinePage, 10)
      : undefined;
  const timelinePage =
    typeof timelinePageRaw === "number" &&
    Number.isInteger(timelinePageRaw) &&
    timelinePageRaw > 0
      ? timelinePageRaw
      : undefined;

  const summaryPromise = fetchAffaireHubSummary(projectId);
  const timelinePromise = fetchAffaireHubTimeline(projectId, timelinePage);
  const dpgfSourcePromise = fetchAffaireHubDpgfSource(projectId);
  const marginAnalysisPromise = fetchAffaireHubMarginAnalysis(projectId);
  const takeoffEnabledPromise = isTakeoffEnabled(tenantId);

  const [
    summaryResult,
    timelineResult,
    dpgfSourceResult,
    marginResult,
    takeoffEnabledResult,
  ] = await Promise.allSettled([
    summaryPromise,
    timelinePromise,
    dpgfSourcePromise,
    marginAnalysisPromise,
    takeoffEnabledPromise,
  ]);

  if (summaryResult.status === "rejected") {
    const err = summaryResult.reason as unknown;
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

  const summary = summaryResult.value;

  const timeline =
    timelineResult.status === "fulfilled" ? timelineResult.value : null;
  const dpgfSource =
    dpgfSourceResult.status === "fulfilled" ? dpgfSourceResult.value : null;
  const marginAnalysis =
    marginResult.status === "fulfilled" ? marginResult.value : null;
  const takeoffEnabled =
    takeoffEnabledResult.status === "fulfilled" && takeoffEnabledResult.value;

  let plansSummary: Awaited<ReturnType<typeof fetchAffaireHubPlansSummary>> | null =
    null;

  const sectionErrors: {
    timeline?: string;
    dpgfSource?: string;
    marginAnalysis?: string;
    plansSummary?: string;
  } = {};

  if (timelineResult.status === "rejected") {
    sectionErrors.timeline =
      "Impossible de charger la timeline des versions pour le moment.";
  }

  if (dpgfSourceResult.status === "rejected") {
    sectionErrors.dpgfSource =
      "Impossible de charger la section Source DPGF pour le moment.";
  }

  if (marginResult.status === "rejected") {
    sectionErrors.marginAnalysis =
      "Impossible de charger l'analyse de marge pour le moment.";
  }

  if (takeoffEnabled) {
    const plansSummaryResult = await Promise.allSettled([
      fetchAffaireHubPlansSummary(projectId),
    ]);

    if (plansSummaryResult[0].status === "fulfilled") {
      plansSummary = plansSummaryResult[0].value;
    } else {
      sectionErrors.plansSummary =
        "Impossible de charger le resume plans & metres pour le moment.";
    }
  }

  return (
    <>
      <LastAffaireTracker projectId={projectId} />
      <AffaireHub
        summary={summary}
        timeline={timeline}
        dpgfSource={dpgfSource}
        marginAnalysis={marginAnalysis}
        plansSummary={plansSummary}
        takeoffEnabled={takeoffEnabled}
        sectionErrors={sectionErrors}
        justCreated={justCreated}
      />
    </>
  );
}
