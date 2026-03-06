export type EstimateApprovalDecisionScopeType =
  | "project"
  | "lot"
  | "line"
  | "approval_rule";

export type EstimateApprovalDecisionBusinessState =
  | "approved"
  | "approved_with_reservations"
  | "changes_requested";

export const APPROVAL_DECISION_FILTER_VALUES = [
  "approved",
  "approved_with_reservations",
  "changes_requested",
] as const;

export const APPROVAL_DECISION_JOURNAL_AUTHOR_QUERY_PARAM =
  "approvalJournalAuthor";
export const APPROVAL_DECISION_JOURNAL_STATUS_QUERY_PARAM =
  "approvalJournalStatus";

export type EstimateApprovalDecisionFilter =
  (typeof APPROVAL_DECISION_FILTER_VALUES)[number];

export type EstimateApprovalDecisionOutcome = "approved" | "rejected";

export type EstimateApprovalDecisionScope = {
  scopeType: EstimateApprovalDecisionScopeType;
  scopeId: string | null;
  scopeLabel: string;
};

export type EstimateApprovalDecisionComment = EstimateApprovalDecisionScope & {
  comment: string;
};

export type EstimateApprovalDecisionRule = {
  ruleId: string;
  label: string;
  signalKey: string;
  message: string;
  thresholdValue: number;
  actualValue: number | null;
  sourceState: "ready" | "unavailable";
  approvalStatus: "missing" | "pending" | "approved" | "rejected" | null;
};

export type EstimateApprovalDecisionEvent = {
  id: string;
  estimateVersionId: string;
  occurredAt: string;
  createdAt: string;
  actorUserId: string | null;
  actorName: string | null;
  decision: EstimateApprovalDecisionFilter;
  approvalOutcome: EstimateApprovalDecisionOutcome;
  cycleId: string | null;
  cycleNumber: number | null;
  commentCount: number;
  scopeCount: number;
  perimeterLabel: string;
  scopes: EstimateApprovalDecisionScope[];
  comments: EstimateApprovalDecisionComment[];
  rulesTriggered: EstimateApprovalDecisionRule[];
};

export type EstimateApprovalDecisionJournal = {
  events: EstimateApprovalDecisionEvent[];
  availableAuthors: Array<{
    userId: string;
    actorName: string;
  }>;
  filters: {
    actorUserId: string | null;
    decision: EstimateApprovalDecisionFilter | null;
  };
};

export function isEstimateApprovalDecisionFilter(
  value: string
): value is EstimateApprovalDecisionFilter {
  return (
    APPROVAL_DECISION_FILTER_VALUES as readonly string[]
  ).includes(value);
}

export function normalizeEstimateApprovalDecision(
  value: unknown
): EstimateApprovalDecisionFilter | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (isEstimateApprovalDecisionFilter(normalized)) {
    return normalized;
  }

  if (normalized === "rejected") {
    return "changes_requested";
  }

  return null;
}

export function resolveApprovalDecisionOutcome(
  decision:
    | EstimateApprovalDecisionBusinessState
    | EstimateApprovalDecisionFilter
): EstimateApprovalDecisionOutcome {
  return decision === "changes_requested" ? "rejected" : "approved";
}

function firstSearchParamValue(value: string | string[] | null | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

export function parseApprovalDecisionJournalAuthorSearchParam(
  value: string | string[] | null | undefined
) {
  const normalized = firstSearchParamValue(value)?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

export function parseApprovalDecisionJournalStatusSearchParam(
  value: string | string[] | null | undefined
): EstimateApprovalDecisionFilter | null {
  const normalized = firstSearchParamValue(value)?.trim() ?? "";
  return isEstimateApprovalDecisionFilter(normalized) ? normalized : null;
}
