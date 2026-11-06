import { isRecord, toNumber, toStringValue, getRootPayload, pickArray } from "@/lib/estimates/client-json";
import { isEstimateApprovalDecisionFilter, type EstimateApprovalDecisionComment, type EstimateApprovalDecisionEvent, type EstimateApprovalDecisionJournal, type EstimateApprovalDecisionRule, type EstimateApprovalDecisionScope } from "@/lib/estimates/approval-decision-journal";

function normalizeApprovalDecisionScope(
  value: unknown
): EstimateApprovalDecisionScope | null {
  if (!isRecord(value)) return null;

  const scopeType = toStringValue(value.scopeType) ?? toStringValue(value.scope_type);
  const scopeLabel = toStringValue(value.scopeLabel) ?? toStringValue(value.scope_label);
  const scopeId = toStringValue(value.scopeId) ?? toStringValue(value.scope_id) ?? null;

  if (
    scopeType !== "project" &&
    scopeType !== "lot" &&
    scopeType !== "line" &&
    scopeType !== "exception" &&
    scopeType !== "hypothesis" &&
    scopeType !== "approval_rule"
  ) {
    return null;
  }

  if (!scopeLabel) {
    return null;
  }

  return {
    scopeType,
    scopeId,
    scopeLabel,
  };
}

function normalizeApprovalDecisionComment(
  value: unknown
): EstimateApprovalDecisionComment | null {
  if (!isRecord(value)) return null;

  const scope = normalizeApprovalDecisionScope(value);
  const comment = toStringValue(value.comment);
  if (!scope || !comment) {
    return null;
  }

  return {
    ...scope,
    comment,
  };
}

function normalizeApprovalDecisionRule(
  value: unknown
): EstimateApprovalDecisionRule | null {
  if (!isRecord(value)) return null;

  const ruleId = toStringValue(value.ruleId) ?? toStringValue(value.rule_id);
  const label = toStringValue(value.label);
  const signalKey = toStringValue(value.signalKey) ?? toStringValue(value.signal_key);
  const message = toStringValue(value.message);
  const thresholdValue = toNumber(value.thresholdValue) ?? toNumber(value.threshold_value);
  const actualValue = toNumber(value.actualValue) ?? toNumber(value.actual_value);
  const sourceState =
    toStringValue(value.sourceState) ?? toStringValue(value.source_state);
  const approvalStatus =
    toStringValue(value.approvalStatus) ?? toStringValue(value.approval_status);

  if (
    !ruleId ||
    !label ||
    !signalKey ||
    !message ||
    thresholdValue === null
  ) {
    return null;
  }

  return {
    ruleId,
    label,
    signalKey,
    message,
    thresholdValue,
    actualValue,
    sourceState: sourceState === "unavailable" ? "unavailable" : "ready",
    approvalStatus:
      approvalStatus === "missing" ||
      approvalStatus === "pending" ||
      approvalStatus === "approved" ||
      approvalStatus === "rejected"
        ? approvalStatus
        : null,
  };
}

function normalizeEstimateApprovalDecisionEvent(
  value: unknown
): EstimateApprovalDecisionEvent | null {
  if (!isRecord(value)) return null;

  const id = toStringValue(value.id);
  const estimateVersionId =
    toStringValue(value.estimateVersionId) ??
    toStringValue(value.estimate_version_id);
  const occurredAt =
    toStringValue(value.occurredAt) ??
    toStringValue(value.occurred_at);
  const createdAt =
    toStringValue(value.createdAt) ??
    toStringValue(value.created_at);
  const decisionRaw = toStringValue(value.decision);
  const approvalOutcome =
    toStringValue(value.approvalOutcome) ??
    toStringValue(value.approval_outcome);
  const commentCount = toNumber(value.commentCount) ?? toNumber(value.comment_count);
  const scopeCount = toNumber(value.scopeCount) ?? toNumber(value.scope_count);
  const perimeterLabel =
    toStringValue(value.perimeterLabel) ??
    toStringValue(value.perimeter_label);
  const scopes = pickArray(value, ["scopes"])
    .map((entry) => normalizeApprovalDecisionScope(entry))
    .filter((entry): entry is EstimateApprovalDecisionScope => entry !== null);
  const comments = pickArray(value, ["comments"])
    .map((entry) => normalizeApprovalDecisionComment(entry))
    .filter((entry): entry is EstimateApprovalDecisionComment => entry !== null);
  const rulesTriggered = pickArray(value, ["rulesTriggered", "rules_triggered"])
    .map((entry) => normalizeApprovalDecisionRule(entry))
    .filter((entry): entry is EstimateApprovalDecisionRule => entry !== null);

  if (
    !id ||
    !estimateVersionId ||
    !occurredAt ||
    !createdAt ||
    !decisionRaw ||
    !isEstimateApprovalDecisionFilter(decisionRaw) ||
    !perimeterLabel ||
    (approvalOutcome !== "approved" && approvalOutcome !== "rejected")
  ) {
    return null;
  }

  return {
    id,
    estimateVersionId,
    occurredAt,
    createdAt,
    actorUserId:
      toStringValue(value.actorUserId) ??
      toStringValue(value.actor_user_id) ??
      null,
    actorName:
      toStringValue(value.actorName) ??
      toStringValue(value.actor_name) ??
      null,
    decision: decisionRaw,
    approvalOutcome,
    cycleId:
      toStringValue(value.cycleId) ??
      toStringValue(value.cycle_id) ??
      null,
    cycleNumber:
      toNumber(value.cycleNumber) ?? toNumber(value.cycle_number) ?? null,
    commentCount: commentCount !== null ? Math.max(0, Math.trunc(commentCount)) : 0,
    scopeCount: scopeCount !== null ? Math.max(0, Math.trunc(scopeCount)) : 0,
    perimeterLabel,
    scopes,
    comments,
    rulesTriggered,
  };
}

export function parseEstimateApprovalDecisionJournal(
  payload: unknown
): EstimateApprovalDecisionJournal | null {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return null;

  const events = pickArray(root, ["events"])
    .map((entry) => normalizeEstimateApprovalDecisionEvent(entry))
    .filter((entry): entry is EstimateApprovalDecisionEvent => entry !== null);
  const availableAuthors = pickArray(root, ["availableAuthors", "available_authors"])
    .map((entry) => {
      if (!isRecord(entry)) return null;
      const userId = toStringValue(entry.userId) ?? toStringValue(entry.user_id);
      const actorName =
        toStringValue(entry.actorName) ?? toStringValue(entry.actor_name);
      if (!userId || !actorName) return null;
      return {
        userId,
        actorName,
      };
    })
    .filter(
      (entry): entry is EstimateApprovalDecisionJournal["availableAuthors"][number] =>
        entry !== null
    );
  const filtersNode = isRecord(root.filters) ? root.filters : {};
  const decisionRaw =
    toStringValue(filtersNode.decision) ?? toStringValue(filtersNode.status);
  const decision =
    decisionRaw && isEstimateApprovalDecisionFilter(decisionRaw)
      ? decisionRaw
      : null;

  return {
    events,
    availableAuthors,
    filters: {
      actorUserId:
        toStringValue(filtersNode.actorUserId) ??
        toStringValue(filtersNode.actor_user_id) ??
        null,
      decision,
    },
  };
}
