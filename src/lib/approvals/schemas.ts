import { z } from "zod";

const uuidSchema = z.string().uuid();

const approvalTargetByRuleSchema = z.object({
  rule_id: uuidSchema,
  approval_id: uuidSchema.optional(),
});

const approvalTargetByApprovalSchema = z.object({
  rule_id: uuidSchema.optional(),
  approval_id: uuidSchema,
});

function approvalDecisionActionSchema(action: "approve" | "reject") {
  return z.union([
    z
      .object({ action: z.literal(action) })
      .extend(approvalTargetByRuleSchema.shape),
    z
      .object({ action: z.literal(action) })
      .extend(approvalTargetByApprovalSchema.shape),
  ]);
}

const approvalProjectCommentSchema = z.object({
  scope_type: z.literal("project"),
  scope_id: uuidSchema.nullable().optional(),
  comment: z.string().trim().min(1),
});

const approvalScopedCommentSchema = z.object({
  scope_type: z.enum([
    "lot",
    "line",
    "exception",
    "hypothesis",
    "approval_rule",
  ]),
  scope_id: uuidSchema,
  comment: z.string().trim().min(1),
});

export const approvalDecisionCommentSchema = z.union([
  approvalProjectCommentSchema,
  approvalScopedCommentSchema,
]);

export const estimateApprovalActionSchema = z.union([
  z.object({ action: z.literal("request"), rule_id: uuidSchema }),
  z.object({
    action: z.literal("submit_for_review"),
    rule_ids: z.array(uuidSchema).default([]),
    submission_message: z.string().trim().max(2000).optional(),
    assigned_reviewer_user_id: uuidSchema.nullable().optional(),
  }),
  approvalDecisionActionSchema("approve"),
  approvalDecisionActionSchema("reject"),
  z.object({
    action: z.literal("decide"),
    decision: z.enum([
      "approved",
      "approved_with_reservations",
      "changes_requested",
    ]),
    comments: z.array(approvalDecisionCommentSchema).default([]),
  }),
]);

const SORT_BY_VALUES = ["priority", "amount", "margin", "age"] as const;
export type ApprovalQueueSortBy = (typeof SORT_BY_VALUES)[number];
export type ApprovalQueueSortDirection = "asc" | "desc";

export const APPROVAL_QUEUE_DEFAULT_DIRECTIONS: Record<
  ApprovalQueueSortBy,
  ApprovalQueueSortDirection
> = {
  priority: "desc",
  amount: "desc",
  margin: "asc",
  age: "asc",
};

export type ApprovalQueueQuery = {
  sortBy: ApprovalQueueSortBy;
  sortDir: ApprovalQueueSortDirection;
  onlyExceptions: boolean;
};

function isSortBy(value: unknown): value is ApprovalQueueSortBy {
  return typeof value === "string" && (SORT_BY_VALUES as readonly string[]).includes(value);
}

function isSortDirection(value: unknown): value is ApprovalQueueSortDirection {
  return value === "asc" || value === "desc";
}

export function parseApprovalQueueQuery(
  params: Record<string, string | string[] | undefined>
): ApprovalQueueQuery {
  const rawSort = typeof params.sortBy === "string" ? params.sortBy : undefined;
  const rawSortDir = typeof params.sortDir === "string" ? params.sortDir : undefined;
  const rawExceptions = typeof params.onlyExceptions === "string" ? params.onlyExceptions : undefined;
  const sortBy = isSortBy(rawSort) ? rawSort : "priority";

  return {
    sortBy,
    sortDir: isSortDirection(rawSortDir)
      ? rawSortDir
      : APPROVAL_QUEUE_DEFAULT_DIRECTIONS[sortBy],
    onlyExceptions: rawExceptions === "true",
  };
}
