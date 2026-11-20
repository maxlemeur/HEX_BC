import { toNumber, getRootPayload, pickArray } from "@/lib/estimates/client-json";
import { isEstimateApprovalDecisionFilter, type EstimateApprovalDecisionComment, type EstimateApprovalDecisionEvent, type EstimateApprovalDecisionJournal, type EstimateApprovalDecisionRule, type EstimateApprovalDecisionScope } from "@/lib/estimates/approval-decision-journal";
import { isRecord, toNonEmptyString } from "@/lib/value-guards";

function normalizeApprovalDecisionScope(
  value: unknown
): EstimateApprovalDecisionScope | null {
  if (!isRecord(value)) return null;

  const scopeType = toNonEmptyString(value.scopeType) ?? toNonEmptyString(value.scope_type);
  const scopeLabel = toNonEmptyString(value.scopeLabel) ?? toNonEmptyString(value.scope_label);
  const scopeId = toNonEmptyString(value.scopeId) ?? toNonEmptyString(value.scope_id) ?? null;

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
  const comment = toNonEmptyString(value.comment);
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

  const ruleId = toNonEmptyString(value.ruleId) ?? toNonEmptyString(value.rule_id);
  const label = toNonEmptyString(value.label);
  const signalKey = toNonEmptyString(value.signalKey) ?? toNonEmptyString(value.signal_key);
  const message = toNonEmptyString(value.message);
  const thresholdValue = toNumber(value.thresholdValue) ?? toNumber(value.threshold_value);
  const actualValue = toNumber(value.actualValue) ?? toNumber(value.actual_value);
  const sourceState =
    toNonEmptyString(value.sourceState) ?? toNonEmptyString(value.source_state);
  const approvalStatus =
    toNonEmptyString(value.approvalStatus) ?? toNonEmptyString(value.approval_status);

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

  const id = toNonEmptyString(value.id);
  const estimateVersionId =
    toNonEmptyString(value.estimateVersionId) ??
    toNonEmptyString(value.estimate_version_id);
  const occurredAt =
    toNonEmptyString(value.occurredAt) ??
    toNonEmptyString(value.occurred_at);
  const createdAt =
    toNonEmptyString(value.createdAt) ??
    toNonEmptyString(value.created_at);
  const decisionRaw = toNonEmptyString(value.decision);
  const approvalOutcome =
    toNonEmptyString(value.approvalOutcome) ??
    toNonEmptyString(value.approval_outcome);
  const commentCount = toNumber(value.commentCount) ?? toNumber(value.comment_count);
  const scopeCount = toNumber(value.scopeCount) ?? toNumber(value.scope_count);
  const perimeterLabel =
    toNonEmptyString(value.perimeterLabel) ??
    toNonEmptyString(value.perimeter_label);
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
      toNonEmptyString(value.actorUserId) ??
      toNonEmptyString(value.actor_user_id) ??
      null,
    actorName:
      toNonEmptyString(value.actorName) ??
      toNonEmptyString(value.actor_name) ??
      null,
    decision: decisionRaw,
    approvalOutcome,
    cycleId:
      toNonEmptyString(value.cycleId) ??
      toNonEmptyString(value.cycle_id) ??
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
      const userId = toNonEmptyString(entry.userId) ?? toNonEmptyString(entry.user_id);
      const actorName =
        toNonEmptyString(entry.actorName) ?? toNonEmptyString(entry.actor_name);
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
    toNonEmptyString(filtersNode.decision) ?? toNonEmptyString(filtersNode.status);
  const decision =
    decisionRaw && isEstimateApprovalDecisionFilter(decisionRaw)
      ? decisionRaw
      : null;

  return {
    events,
    availableAuthors,
    filters: {
      actorUserId:
        toNonEmptyString(filtersNode.actorUserId) ??
        toNonEmptyString(filtersNode.actor_user_id) ??
        null,
      decision,
    },
  };
}
