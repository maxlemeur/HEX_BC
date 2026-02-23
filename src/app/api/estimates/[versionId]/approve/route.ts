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

const postApproveSchema = z.union([
  requestApprovalSchema,
  approveRejectApprovalSchema,
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
    return ok(data, payload.action === "request" ? 201 : 200);
  } catch (error) {
    return toErrorResponse(error);
  }
}
