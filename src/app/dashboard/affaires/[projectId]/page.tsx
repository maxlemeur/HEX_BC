import { notFound } from "next/navigation";

import { AffaireHub } from "@/components/affaires/AffaireHub";
import { getUserContext } from "@/lib/auth/server";
import { fetchAffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import { fetchDirectionProjectSignals } from "@/lib/direction/server";
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
} from "@/lib/affaires/register-server";
import {
  fetchAffaireHubDpgfSource,
  fetchAffaireHubFinishLineSummary,
  fetchAffaireHubMarginAnalysis,
  fetchAffaireHubPlansSummary,
  fetchAffaireHubSummary,
  fetchAffaireHubTimeline,
  fetchProjectVersionList,
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
import { fetchVersionZeroDraftSummary } from "@/lib/estimates/version-zero-drafts";
import { fetchCockpitCommandPreferences } from "@/lib/cockpit/preferences";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { computeCockpitSuggestions } from "@/lib/cockpit/suggestions";

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
    directionSignalsResult,
    registerPageResult,
    registerScopeOptionsResult,
    versionZeroSummaryResult,
    cockpitPreferencesResult,
    finishLineSummaryResult,
  ] = await Promise.allSettled([
    currentVersionId ? getEstimateApprovalSummary(currentVersionId) : Promise.resolve(null),
    currentVersionId
      ? listEstimateApprovalDecisionJournal({
          versionId: currentVersionId,
          actorUserId: approvalJournalAuthor,
          decision: approvalJournalDecision,
        })
      : Promise.resolve(null),
    currentVersionId
      ? fetchDirectionProjectSignals(projectId, currentVersionId)
      : Promise.resolve({ latestJobId: null, alerts: [] }),
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
    currentVersionId && summary.currentVersion?.status === "draft"
      ? fetchVersionZeroDraftSummary({ versionId: currentVersionId })
      : Promise.resolve(null),
    fetchCockpitCommandPreferences(projectId),
    currentVersionId ? fetchAffaireHubFinishLineSummary(currentVersionId) : Promise.resolve(null),
  ]);
  const approvalSummary =
    approvalSummaryResult.status === "fulfilled" ? approvalSummaryResult.value : null;
  const approvalJournal =
    approvalJournalResult.status === "fulfilled" ? approvalJournalResult.value : null;
  const directionSignals =
    directionSignalsResult.status === "fulfilled"
      ? directionSignalsResult.value
      : { latestJobId: null, alerts: [] };
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
  let projectVersions: Array<{ id: string; version_number: number }> = [];
  const registerPage =
    registerPageResult.status === "fulfilled" ? registerPageResult.value : null;
  const registerScopeOptions =
    registerScopeOptionsResult.status === "fulfilled"
      ? registerScopeOptionsResult.value
      : { lots: [], lines: [] };
  const versionZeroSummary =
    versionZeroSummaryResult.status === "fulfilled"
      ? versionZeroSummaryResult.value
      : null;
  const cockpitPreferences =
    cockpitPreferencesResult.status === "fulfilled"
      ? cockpitPreferencesResult.value
      : [];
  const finishLineSummary =
    finishLineSummaryResult.status === "fulfilled"
      ? finishLineSummaryResult.value
      : null;
  const registerSummary = registerPage?.summary ?? null;
  const registerTimeline = registerPage?.timeline ?? [];

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
    registerScopeOptionsResult.status === "rejected"
  ) {
    sectionErrors.register =
      "Impossible de charger le registre affaire pour le moment.";
  }

  const intakeWorkspace: AffaireIntakeWorkspace | null =
    intakeWorkspaceResult.status === "fulfilled"
      ? intakeWorkspaceResult.value
      : null;
  const hasIntakeWorkspaceError = intakeWorkspaceResult.status === "rejected";

  if (takeoffEnabled) {
    const [plansSummaryResult, projectVersionsResult] = await Promise.allSettled([
      fetchAffaireHubPlansSummary(projectId),
      fetchProjectVersionList(projectId),
    ]);

    if (plansSummaryResult.status === "fulfilled") {
      plansSummary = plansSummaryResult.value;
    } else {
      sectionErrors.plansSummary =
        "Impossible de charger le resume plans & metres pour le moment.";
    }

    if (projectVersionsResult.status === "fulfilled") {
      projectVersions = projectVersionsResult.value;
    }
  }

  const cockpitSuggestions = computeCockpitSuggestions({
    projectId,
    takeoffEnabled,
    isReadOnlyReview,
    plansSummary,
    registerSummary,
    approvalSummary,
    hasIntakeWorkspaceError,
    intakeWorkspace,
    versionZeroSummary,
    currentVersion: summary.currentVersion
      ? {
          id: summary.currentVersion.id,
          status: summary.currentVersion.status,
        }
      : null,
    lineCount: summary.lineCount,
    preferences: cockpitPreferences,
  });

  return (
    <AffaireHub
      summary={summary}
      timeline={timeline}
      dpgfSource={dpgfSource}
      marginAnalysis={marginAnalysis}
      approvalSummary={approvalSummary}
      approvalJournal={approvalJournal}
      directionSignals={directionSignals}
      isReadOnlyReview={isReadOnlyReview}
      plansSummary={plansSummary}
      takeoffEnabled={takeoffEnabled}
      projectVersions={projectVersions.map((version) => ({
        id: version.id,
        versionNumber: version.version_number,
      }))}
      sectionErrors={sectionErrors}
      justCreated={justCreated}
      intakeWorkspace={intakeWorkspace}
      registerPage={registerPage}
      registerScopeOptions={registerScopeOptions}
      registerSummary={registerSummary}
      registerTimeline={registerTimeline}
      versionZeroSummary={versionZeroSummary}
      finishLineSummary={finishLineSummary}
      cockpitSuggestions={cockpitSuggestions}
      viewerProfileId={profile?.id ?? null}
    />
  );
}
