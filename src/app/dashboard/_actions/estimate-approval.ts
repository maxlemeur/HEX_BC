"use server";

import {
  submitEstimateApproval,
  type EstimateApprovalDecisionCommentInput,
  type SubmitEstimateReviewRequestResult,
  type EstimateReviewDecision,
  type EstimateReviewCorrectionStatus,
  updateEstimateReviewCorrectionItemStatus,
} from "@/lib/estimates/rules-engine";
import { revalidatePath } from "next/cache";

function revalidateApprovalPaths(versionId: string, projectId: string) {
  revalidatePath(`/dashboard/estimates/${versionId}`);
  revalidatePath(`/dashboard/affaires/${projectId}`);
  revalidatePath("/dashboard/approvals");
}

export async function requestEstimateApprovalAction(input: {
  versionId: string;
  projectId: string;
  ruleIds: string[];
}) {
  let lastResult: Awaited<ReturnType<typeof submitEstimateApproval>> | null = null;

  for (const ruleId of input.ruleIds) {
    lastResult = await submitEstimateApproval({
      versionId: input.versionId,
      action: "request",
      ruleId,
    });
  }

  revalidateApprovalPaths(input.versionId, input.projectId);
  return lastResult;
}

export async function submitEstimateForReviewAction(input: {
  versionId: string;
  projectId: string;
  ruleIds: string[];
  submissionMessage?: string | null;
  assignedReviewerUserId?: string | null;
}): Promise<SubmitEstimateReviewRequestResult> {
  const result = await submitEstimateApproval({
    versionId: input.versionId,
    action: "submit_for_review",
    ruleIds: input.ruleIds,
    submissionMessage: input.submissionMessage ?? null,
    assignedReviewerUserId: input.assignedReviewerUserId ?? null,
  });

  revalidateApprovalPaths(input.versionId, input.projectId);

  if (!result.cycle || !result.requestedApprovalCount || !result.requestedRuleIds) {
    throw new Error("Soumission de revue incomplete.");
  }

  return {
    cycle: result.cycle,
    requestedApprovalCount: result.requestedApprovalCount,
    requestedRuleIds: result.requestedRuleIds,
  };
}

export async function decideEstimateApprovalAction(input: {
  versionId: string;
  projectId: string;
  decision: EstimateReviewDecision;
  comments: EstimateApprovalDecisionCommentInput[];
}) {
  const result = await submitEstimateApproval({
    versionId: input.versionId,
    action: "decide",
    decision: input.decision,
    comments: input.comments,
  });

  revalidateApprovalPaths(input.versionId, input.projectId);
  return result;
}

export async function updateEstimateReviewCorrectionItemStatusAction(input: {
  versionId: string;
  projectId: string;
  itemId: string;
  status: Exclude<EstimateReviewCorrectionStatus, "pending">;
  note?: string | null;
}) {
  const result = await updateEstimateReviewCorrectionItemStatus({
    versionId: input.versionId,
    itemId: input.itemId,
    status: input.status,
    note: input.note ?? null,
  });

  revalidateApprovalPaths(input.versionId, input.projectId);
  return result;
}
