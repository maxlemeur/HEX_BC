"use server";

import {
  submitEstimateApproval,
  type EstimateApprovalDecisionCommentInput,
  type EstimateReviewDecision,
} from "@/lib/estimates/rules-engine";
import { revalidatePath } from "next/cache";

function revalidateApprovalPaths(versionId: string, projectId: string) {
  revalidatePath(`/dashboard/estimates/${versionId}`);
  revalidatePath(`/dashboard/affaires/${projectId}`);
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
