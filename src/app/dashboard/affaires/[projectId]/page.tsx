import { notFound } from "next/navigation";

import { AffaireHub } from "@/components/affaires/AffaireHub";
import { getUserContext } from "@/lib/auth/server";
import { fetchAffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import {
  fetchAffaireHubDpgfSource,
  fetchAffaireHubMarginAnalysis,
  fetchAffaireHubPlansSummary,
  fetchAffaireHubSummary,
  fetchAffaireHubTimeline,
} from "@/lib/affaires/server";
import {
  APPROVAL_DECISION_JOURNAL_AUTHOR_QUERY_PARAM,
  APPROVAL_DECISION_JOURNAL_STATUS_QUERY_PARAM,
  parseApprovalDecisionJournalAuthorSearchParam,
  parseApprovalDecisionJournalStatusSearchParam,
} from "@/lib/estimates/approval-decision-journal";
import {
  getEstimateApprovalSummary,
  listEstimateApprovalDecisionJournal,
} from "@/lib/estimates/rules-engine";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";

type Props = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AffaireHubPage({ params, searchParams }: Props) {
  const [{ projectId }, search, { tenantId, profile }] = await Promise.all([
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
  const approvalJournalAuthor = parseApprovalDecisionJournalAuthorSearchParam(
    search[APPROVAL_DECISION_JOURNAL_AUTHOR_QUERY_PARAM]
  );
  const approvalJournalDecision = parseApprovalDecisionJournalStatusSearchParam(
    search[APPROVAL_DECISION_JOURNAL_STATUS_QUERY_PARAM]
  );

  const summaryPromise = fetchAffaireHubSummary(projectId);
  const timelinePromise = fetchAffaireHubTimeline(projectId, timelinePage);
  const dpgfSourcePromise = fetchAffaireHubDpgfSource(projectId);
  const marginAnalysisPromise = fetchAffaireHubMarginAnalysis(projectId);
  const takeoffEnabledPromise = isTakeoffEnabled(tenantId);
  const intakeWorkspacePromise = fetchAffaireIntakeWorkspace(projectId);

  const [
    summaryResult,
    timelineResult,
    dpgfSourceResult,
    marginResult,
    takeoffEnabledResult,
    intakeWorkspaceResult,
  ] = await Promise.allSettled([
    summaryPromise,
    timelinePromise,
    dpgfSourcePromise,
    marginAnalysisPromise,
    takeoffEnabledPromise,
    intakeWorkspacePromise,
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
  const approvalSummary = summary.currentVersion
    ? await getEstimateApprovalSummary(summary.currentVersion.id).catch(() => null)
    : null;
  const approvalJournal = summary.currentVersion
    ? await listEstimateApprovalDecisionJournal({
        versionId: summary.currentVersion.id,
        actorUserId: approvalJournalAuthor,
        decision: approvalJournalDecision,
      }).catch(() => null)
    : null;
  const viewerRole = profile?.tenant_role ?? null;
  const isReadOnlyReview = viewerRole === "director";

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

  const intakeWorkspace: AffaireIntakeWorkspace | null =
    intakeWorkspaceResult.status === "fulfilled"
      ? intakeWorkspaceResult.value
      : null;

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
    <AffaireHub
      summary={summary}
      timeline={timeline}
      dpgfSource={dpgfSource}
      marginAnalysis={marginAnalysis}
      approvalSummary={approvalSummary}
      approvalJournal={approvalJournal}
      isReadOnlyReview={isReadOnlyReview}
      plansSummary={plansSummary}
      takeoffEnabled={takeoffEnabled}
      sectionErrors={sectionErrors}
      justCreated={justCreated}
      intakeWorkspace={intakeWorkspace}
    />
  );
}
