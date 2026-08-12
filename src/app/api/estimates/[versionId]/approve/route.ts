import { z } from "zod";

import { estimateApprovalActionSchema } from "@/lib/approvals/schemas";
import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import {
  submitEstimateApproval,
  type SubmitEstimateApprovalInput,
} from "@/lib/estimates/rules-engine";

const versionIdParamSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
});

async function getVersionId(paramsPromise: Promise<{ versionId: string }>) {
  const params = await paramsPromise;
  return versionIdParamSchema.parse(params).versionId;
}

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("Payload JSON invalide.");
  }
}

function toSubmitInput(input: {
  versionId: string;
  body: z.infer<typeof estimateApprovalActionSchema>;
}): SubmitEstimateApprovalInput {
  if (input.body.action === "request") {
    return {
      versionId: input.versionId,
      action: "request",
      ruleId: input.body.rule_id,
    };
  }

  if (input.body.action === "submit_for_review") {
    return {
      versionId: input.versionId,
      action: "submit_for_review",
      ruleIds: input.body.rule_ids,
      submissionMessage: input.body.submission_message,
      assignedReviewerUserId: input.body.assigned_reviewer_user_id ?? null,
    };
  }

  if (input.body.action === "decide") {
    return {
      versionId: input.versionId,
      action: "decide",
      decision: input.body.decision,
      comments: input.body.comments.map((comment) => ({
        scopeType: comment.scope_type,
        scopeId: comment.scope_id ?? null,
        comment: comment.comment,
      })),
    };
  }

  return {
    versionId: input.versionId,
    action: input.body.action,
    ruleId: input.body.rule_id,
    approvalId: input.body.approval_id,
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await getVersionId(params);
    const body = estimateApprovalActionSchema.parse(await parseJsonBody(request));
    const payload = toSubmitInput({
      versionId,
      body,
    });

    const data = await submitEstimateApproval(payload);
    return ok(
      data,
      payload.action === "request" || payload.action === "submit_for_review" ? 201 : 200
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
