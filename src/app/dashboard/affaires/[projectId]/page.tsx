import { notFound } from "next/navigation";

import { AffaireHub } from "@/components/affaires/AffaireHub";
import { getUserContext } from "@/lib/auth/server";
import { fetchAffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import {
  parseAffaireRegisterCursorSearchParam,
  parseAffaireRegisterFocusSearchParam,
  parseAffaireRegisterKindSearchParam,
  parseAffaireRegisterSeveritySearchParam,
  parseAffaireRegisterStatusSearchParam,
} from "@/lib/affaires/register";
import {
  fetchAffaireRegisterPage,
  fetchAffaireRegisterScopeOptions,
  fetchAffaireRegisterSummary,
  fetchAffaireRegisterTimeline,
} from "@/lib/affaires/register-server";
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
  const registerStatus = parseAffaireRegisterStatusSearchParam(search.registerStatus);
  const registerSeverity = parseAffaireRegisterSeveritySearchParam(
    search.registerSeverity
  );
  const registerKind = parseAffaireRegisterKindSearchParam(search.registerKind);
  const registerCursor = parseAffaireRegisterCursorSearchParam(search.registerCursor);
  const registerFocusEntryId = parseAffaireRegisterFocusSearchParam(
    search.registerFocus
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
  const currentVersionId = summary.currentVersion?.id ?? null;
  const [
    approvalSummaryResult,
    approvalJournalResult,
    registerPageResult,
    registerScopeOptionsResult,
    registerSummaryResult,
    registerTimelineResult,
  ] = await Promise.allSettled([
    currentVersionId ? getEstimateApprovalSummary(currentVersionId) : Promise.resolve(null),
    currentVersionId
      ? listEstimateApprovalDecisionJournal({
          versionId: currentVersionId,
          actorUserId: approvalJournalAuthor,
          decision: approvalJournalDecision,
        })
      : Promise.resolve(null),
    fetchAffaireRegisterPage({
      projectId,
      versionId: currentVersionId,
      status: registerStatus,
      severity: registerSeverity,
      kind: registerKind,
      cursor: registerCursor,
      focusEntryId: registerFocusEntryId,
    }),
    fetchAffaireRegisterScopeOptions({
      projectId,
      versionId: currentVersionId,
    }),
    fetchAffaireRegisterSummary({
      projectId,
      versionId: currentVersionId,
    }),
    fetchAffaireRegisterTimeline({
      projectId,
      versionId: currentVersionId,
    }),
  ]);
  const approvalSummary =
    approvalSummaryResult.status === "fulfilled" ? approvalSummaryResult.value : null;
  const approvalJournal =
    approvalJournalResult.status === "fulfilled" ? approvalJournalResult.value : null;
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
  const registerPage =
    registerPageResult.status === "fulfilled" ? registerPageResult.value : null;
  const registerScopeOptions =
    registerScopeOptionsResult.status === "fulfilled"
      ? registerScopeOptionsResult.value
      : { lots: [], lines: [] };
  const registerSummary =
    registerSummaryResult.status === "fulfilled" ? registerSummaryResult.value : null;
  const registerTimeline =
    registerTimelineResult.status === "fulfilled" ? registerTimelineResult.value : [];

  const sectionErrors: {
    timeline?: string;
    dpgfSource?: string;
    marginAnalysis?: string;
    plansSummary?: string;
    register?: string;
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
  if (
    registerPageResult.status === "rejected" ||
    registerScopeOptionsResult.status === "rejected" ||
    registerSummaryResult.status === "rejected" ||
    registerTimelineResult.status === "rejected"
  ) {
    sectionErrors.register =
      "Impossible de charger le registre affaire pour le moment.";
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
      registerPage={registerPage}
      registerScopeOptions={registerScopeOptions}
      registerSummary={registerSummary}
      registerTimeline={registerTimeline}
    />
  );
}
