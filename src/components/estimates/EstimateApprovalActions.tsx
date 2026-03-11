"use client";

import type { EstimateApprovalSummary } from "@/lib/estimates/rules-engine";

import { EstimateApprovalActiveCycleSection } from "./estimate-approval/EstimateApprovalActiveCycleSection";
import { EstimateApprovalCorrectionChecklistSection } from "./estimate-approval/EstimateApprovalCorrectionChecklistSection";
import { EstimateApprovalDecisionComposerSection } from "./estimate-approval/EstimateApprovalDecisionComposerSection";
import { EstimateApprovalReviewHistorySection } from "./estimate-approval/EstimateApprovalReviewHistorySection";
import { EstimateApprovalSubmissionPanel } from "./estimate-approval/EstimateApprovalSubmissionPanel";
import type { EstimateApprovalSubmissionOverview } from "./estimate-approval/shared";
import { useEstimateApprovalActions } from "./estimate-approval/useEstimateApprovalActions";

export type { EstimateApprovalSubmissionOverview } from "./estimate-approval/shared";

export function EstimateApprovalActions({
  versionId,
  projectId,
  summary,
  submissionOverview,
  isEmpty = false,
}: Readonly<{
  versionId: string;
  projectId: string;
  summary: EstimateApprovalSummary;
  submissionOverview: EstimateApprovalSubmissionOverview;
  isEmpty?: boolean;
}>) {
  const approval = useEstimateApprovalActions({
    versionId,
    projectId,
    summary,
  });

  if (!approval.showPanel) {
    return null;
  }

  return (
    <div className="space-y-4">
      <EstimateApprovalActiveCycleSection
        activeCycle={approval.activeCycle}
        changesSinceLastCycle={summary.changesSinceLastCycle}
      />

      <EstimateApprovalCorrectionChecklistSection
        correctionChecklist={approval.correctionChecklist}
        activeCycle={approval.activeCycle}
        changesSinceLastCycle={summary.changesSinceLastCycle}
        canInteractWithChecklist={approval.canInteractWithChecklist}
        isPending={approval.isPending}
        onUpdateItem={approval.runCorrectionItemUpdate}
      />

      {summary.permissions.canPrepareRequest ? (
        <EstimateApprovalSubmissionPanel
          versionId={versionId}
          projectId={projectId}
          summary={summary}
          submissionOverview={submissionOverview}
          submitPanelId={approval.submitPanelId}
          showSubmitPanel={approval.showSubmitPanel}
          isPending={approval.isPending}
          isEmpty={isEmpty}
          isResubmission={approval.isResubmission}
          correctionChecklist={approval.correctionChecklist}
          requestableReasonsCount={approval.requestableReasons.length}
          assignedReviewerUserId={approval.assignedReviewerUserId}
          submissionMessage={approval.submissionMessage}
          onAssignedReviewerUserIdChange={approval.setAssignedReviewerUserId}
          onSubmissionMessageChange={approval.handleSubmissionMessageChange}
          onTogglePanel={approval.toggleSubmitPanel}
          onSubmit={approval.runSubmitAction}
        />
      ) : null}

      {summary.permissions.canDecide ? (
        <EstimateApprovalDecisionComposerSection
          activeCycle={approval.activeCycle}
          projectLabel={summary.commentTargets.project.label}
          draftScopeType={approval.draftScopeType}
          draftScopeId={approval.draftScopeId}
          scopeOptions={approval.scopeOptions}
          draftComment={approval.draftComment}
          draftComments={approval.draftComments}
          formError={approval.formError}
          pendingConfirm={approval.pendingConfirm}
          isPending={approval.isPending}
          onScopeTypeChange={approval.handleScopeTypeChange}
          onScopeIdChange={approval.handleScopeIdChange}
          onCommentChange={approval.handleDraftCommentChange}
          onAddComment={approval.handleAddComment}
          onClearComments={approval.clearDraftComments}
          onRemoveComment={approval.removeDraftComment}
          onApprove={() => approval.runDecision("approved")}
          onApproveWithReservations={() =>
            approval.runDecision("approved_with_reservations")
          }
          onRequestChanges={approval.prepareChangesRequestedDecision}
          onConfirmRequestChanges={approval.confirmChangesRequestedDecision}
          onCancelRequestChanges={approval.cancelChangesRequestedDecision}
        />
      ) : null}

      <EstimateApprovalReviewHistorySection
        latestReview={approval.latestReview}
        olderReviews={approval.olderReviews}
      />
    </div>
  );
}
