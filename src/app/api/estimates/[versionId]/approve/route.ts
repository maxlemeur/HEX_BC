import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import {
  submitEstimateApproval,
  type SubmitEstimateApprovalInput,
} from "@/lib/estimates/rules-engine";

const versionIdParamSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
});

const requestApprovalSchema = z.object({
  action: z.literal("request"),
  rule_id: z.string().uuid("rule_id invalide."),
});

const submitForReviewSchema = z.object({
  action: z.literal("submit_for_review"),
  rule_ids: z.array(z.string().uuid("rule_ids invalide.")).min(1, "Au moins une regle est requise."),
  submission_message: z.string().trim().max(2000, "Le message est trop long.").optional(),
  assigned_reviewer_user_id: z.string().uuid("assigned_reviewer_user_id invalide.").nullable().optional(),
});

const approveRejectApprovalSchema = z
  .object({
    action: z.enum(["approve", "reject"]),
    rule_id: z.string().uuid("rule_id invalide.").optional(),
    approval_id: z.string().uuid("approval_id invalide.").optional(),
  })
  .superRefine((payload, ctx) => {
    if (payload.rule_id || payload.approval_id) {
      return;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "rule_id ou approval_id est requis.",
      path: ["rule_id"],
    });
  });

const decisionCommentSchema = z
  .object({
    scope_type: z.enum(["project", "lot", "line", "approval_rule"]),
    scope_id: z.string().uuid("scope_id invalide.").nullable().optional(),
    comment: z.string().trim().min(1, "Le commentaire est obligatoire."),
  })
  .superRefine((payload, ctx) => {
    if (payload.scope_type === "project") {
      return;
    }

    if (payload.scope_id) {
      return;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "scope_id est requis pour ce type de cible.",
      path: ["scope_id"],
    });
  });

const decideApprovalSchema = z.object({
  action: z.literal("decide"),
  decision: z.enum([
    "approved",
    "approved_with_reservations",
    "changes_requested",
  ]),
  comments: z.array(decisionCommentSchema).default([]),
});

const postApproveSchema = z.union([
  requestApprovalSchema,
  submitForReviewSchema,
  approveRejectApprovalSchema,
  decideApprovalSchema,
]);

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
  body: z.infer<typeof postApproveSchema>;
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
    const body = postApproveSchema.parse(await parseJsonBody(request));
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
