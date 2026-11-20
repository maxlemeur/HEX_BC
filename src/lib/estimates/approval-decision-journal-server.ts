import type { EmbeddedApprovalProjectAccess, VersionAccessRow, EstimateApprovalDecisionEventRow, NormalizedDecisionComment } from "@/lib/estimates/approval-types";
import { normalizeThresholdValue } from "@/lib/estimates/rule-evaluation";
import { normalizeEstimateApprovalDecision, resolveApprovalDecisionOutcome, type EstimateApprovalDecisionComment, type EstimateApprovalDecisionEvent, type EstimateApprovalDecisionFilter, type EstimateApprovalDecisionJournal, type EstimateApprovalDecisionRule, type EstimateApprovalDecisionScope } from "@/lib/estimates/approval-decision-journal";
import { mapSupabaseError } from "@/lib/http/api-response";
import { resolveEmbeddedOne } from "@/lib/supabase/embedded";
import {
  getAuthenticatedContext,
  getVersionAccessOrThrow,
} from "@/lib/estimates/server-context";
import { APPROVAL_VERSION_ACCESS } from "@/lib/estimates/approval-version-access";

function toDecisionAuditScopeSnapshots(
  comments: NormalizedDecisionComment[]
): EstimateApprovalDecisionScope[] {
  const seen = new Set<string>();

  return comments
    .map((comment) => ({
      scopeType: comment.scopeType,
      scopeId: comment.scopeId,
      scopeLabel: comment.scopeLabel,
    }))
    .filter((scope) => {
      const key = `${scope.scopeType}:${scope.scopeId ?? "project"}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function resolveDecisionEventPerimeterLabel(input: {
  scopes: EstimateApprovalDecisionScope[];
  rulesTriggered: EstimateApprovalDecisionRule[];
}) {
  const labels = [
    ...input.scopes.map((scope) => scope.scopeLabel.trim()),
    ...(input.scopes.length === 0
      ? input.rulesTriggered.map((rule) => rule.label.trim())
      : []),
  ].filter((label) => label.length > 0);

  const distinctLabels = [...new Set(labels)];
  if (distinctLabels.length === 0) {
    return "Affaire complete";
  }

  if (distinctLabels.length === 1) {
    return distinctLabels[0]!;
  }

  return `${distinctLabels[0]} + ${distinctLabels.length - 1} autres`;
}

function normalizeDecisionEventScope(
  value: unknown
): EstimateApprovalDecisionScope | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const scopeType = "scopeType" in value ? value.scopeType : null;
  const scopeLabel = "scopeLabel" in value ? value.scopeLabel : null;
  const scopeId = "scopeId" in value ? value.scopeId : null;

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

  if (typeof scopeLabel !== "string" || scopeLabel.trim().length === 0) {
    return null;
  }

  return {
    scopeType,
    scopeId: typeof scopeId === "string" && scopeId.trim().length > 0 ? scopeId : null,
    scopeLabel: scopeLabel.trim(),
  };
}

function normalizeDecisionEventComment(
  value: unknown
): EstimateApprovalDecisionComment | null {
  const scope = normalizeDecisionEventScope(value);
  if (!scope || !value || typeof value !== "object") {
    return null;
  }

  const comment = "comment" in value ? value.comment : null;
  if (typeof comment !== "string" || comment.trim().length === 0) {
    return null;
  }

  return {
    ...scope,
    comment: comment.trim(),
  };
}

function normalizeDecisionEventRule(
  value: unknown
): EstimateApprovalDecisionRule | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const ruleId = "ruleId" in value ? value.ruleId : null;
  const label = "label" in value ? value.label : null;
  const signalKey = "signalKey" in value ? value.signalKey : null;
  const message = "message" in value ? value.message : null;
  const thresholdValue = "thresholdValue" in value ? value.thresholdValue : null;
  const actualValue = "actualValue" in value ? value.actualValue : null;
  const sourceState = "sourceState" in value ? value.sourceState : null;
  const approvalStatus = "approvalStatus" in value ? value.approvalStatus : null;

  if (
    typeof ruleId !== "string" ||
    ruleId.trim().length === 0 ||
    typeof label !== "string" ||
    label.trim().length === 0 ||
    typeof signalKey !== "string" ||
    signalKey.trim().length === 0 ||
    typeof message !== "string" ||
    message.trim().length === 0
  ) {
    return null;
  }

  const normalizedThresholdValue = normalizeThresholdValue(thresholdValue);
  if (normalizedThresholdValue === null) {
    return null;
  }

  const normalizedActualValue =
    actualValue === null ? null : normalizeThresholdValue(actualValue);

  return {
    ruleId: ruleId.trim(),
    label: label.trim(),
    signalKey: signalKey.trim(),
    message: message.trim(),
    thresholdValue: normalizedThresholdValue,
    actualValue: normalizedActualValue,
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

function resolveDecisionEventActorLabel(input: {
  actorUserId: string | null;
  actorName: string | null;
}) {
  if (input.actorName && input.actorName.trim().length > 0) {
    return input.actorName.trim();
  }

  if (input.actorUserId && input.actorUserId.trim().length > 0) {
    return `Utilisateur ${input.actorUserId.slice(0, 8)}`;
  }

  return "Système";
}

function normalizeApprovalOutcome(
  value: unknown
): EstimateApprovalDecisionEvent["approvalOutcome"] | null {
  if (value === "approved" || value === "rejected") {
    return value;
  }

  return null;
}

function normalizeEstimateApprovalDecisionEventRow(
  row: EstimateApprovalDecisionEventRow
): EstimateApprovalDecisionEvent {
  const profile = resolveEmbeddedOne(row.profiles);
  const actorName = profile?.full_name?.trim() ?? null;
  const metadata: Record<string, unknown> =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};
  const comments = Array.isArray(metadata.comments)
    ? metadata.comments
        .map((comment) => normalizeDecisionEventComment(comment))
        .filter((comment): comment is EstimateApprovalDecisionComment => comment !== null)
    : [];
  const scopesFromMetadata = Array.isArray(metadata.scopes)
    ? metadata.scopes
        .map((scope) => normalizeDecisionEventScope(scope))
        .filter((scope): scope is EstimateApprovalDecisionScope => scope !== null)
    : [];
  const scopes =
    scopesFromMetadata.length > 0
      ? scopesFromMetadata
      : toDecisionAuditScopeSnapshots(
          comments.map((comment) => ({
            scopeType: comment.scopeType,
            scopeId: comment.scopeId,
            scopeLabel: comment.scopeLabel,
            comment: comment.comment,
          }))
        );
  const rulesTriggered = Array.isArray(metadata.rulesTriggered)
    ? metadata.rulesTriggered
        .map((rule) => normalizeDecisionEventRule(rule))
        .filter((rule): rule is EstimateApprovalDecisionRule => rule !== null)
    : [];
  const decision =
    normalizeEstimateApprovalDecision(metadata.decision) ??
    (normalizeApprovalOutcome(metadata.approvalOutcome) === "rejected"
      ? "changes_requested"
      : "approved");
  const approvalOutcome =
    normalizeApprovalOutcome(metadata.approvalOutcome) ??
    resolveApprovalDecisionOutcome(decision);
  const perimeterLabel =
    typeof metadata.perimeterLabel === "string" && metadata.perimeterLabel.trim().length > 0
      ? metadata.perimeterLabel.trim()
      : resolveDecisionEventPerimeterLabel({
          scopes,
          rulesTriggered,
        });
  const cycleId =
    typeof metadata.cycleId === "string" && metadata.cycleId.trim().length > 0
      ? metadata.cycleId
      : null;
  const cycleNumber = normalizeThresholdValue(metadata.cycleNumber);
  const commentCount = normalizeThresholdValue(metadata.commentCount) ?? comments.length;
  const scopeCount = normalizeThresholdValue(metadata.scopeCount) ?? scopes.length;

  return {
    id: row.id,
    estimateVersionId: row.estimate_version_id,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
    actorUserId: row.created_by,
    actorName,
    decision,
    approvalOutcome,
    cycleId,
    cycleNumber: cycleNumber !== null ? Math.trunc(cycleNumber) : null,
    commentCount: Math.max(0, Math.trunc(commentCount)),
    scopeCount: Math.max(0, Math.trunc(scopeCount)),
    perimeterLabel,
    scopes,
    comments,
    rulesTriggered,
  };
}

function escapeCsvCell(value: string) {
  const safeValue = /^[=+\-@]/.test(value) ? `'${value}` : value;

  if (!/[;"\n\r]/.test(safeValue)) {
    return safeValue;
  }

  return `"${safeValue.replace(/"/g, "\"\"")}"`;
}

function toApprovalDecisionCsvLine(values: string[]) {
  return values.map((value) => escapeCsvCell(value)).join(";");
}

function toApprovalDecisionCsvDecisionLabel(
  decision: EstimateApprovalDecisionFilter
) {
  if (decision === "approved") {
    return "Approuvée";
  }

  if (decision === "approved_with_reservations") {
    return "Approuvée sous réserve";
  }

  return "Retour correction";
}

export function buildEstimateApprovalDecisionJournalCsv(
  journal: Pick<EstimateApprovalDecisionJournal, "events">
) {
  const lines = [
    toApprovalDecisionCsvLine([
      "date_decision",
      "decision",
      "auteur",
      "cycle",
      "perimetre",
      "portees",
      "commentaires",
      "regles_declenchees",
      "nb_commentaires",
      "nb_portees",
    ]),
    ...journal.events.map((event) =>
      toApprovalDecisionCsvLine([
        event.occurredAt,
        toApprovalDecisionCsvDecisionLabel(event.decision),
        resolveDecisionEventActorLabel({
          actorUserId: event.actorUserId,
          actorName: event.actorName,
        }),
        event.cycleNumber !== null ? `Cycle ${event.cycleNumber}` : "-",
        event.perimeterLabel,
        event.scopes.length > 0
          ? event.scopes
              .map((scope) => `${scope.scopeType}:${scope.scopeLabel}`)
              .join(" | ")
          : "-",
        event.comments.length > 0
          ? event.comments
              .map((comment) => `${comment.scopeLabel}: ${comment.comment}`)
              .join(" | ")
          : "-",
        event.rulesTriggered.length > 0
          ? event.rulesTriggered.map((rule) => rule.label).join(" | ")
          : "-",
        String(event.commentCount),
        String(event.scopeCount),
      ])
    ),
  ];

  return `${lines.join("\n")}\n`;
}

export async function listEstimateApprovalDecisionJournal(input: {
  versionId: string;
  actorUserId?: string | null;
  decision?: EstimateApprovalDecisionFilter | null;
}): Promise<EstimateApprovalDecisionJournal> {
  const context = await getAuthenticatedContext();
  await getVersionAccessOrThrow<VersionAccessRow, EmbeddedApprovalProjectAccess>(
    context.supabase, input.versionId, context, APPROVAL_VERSION_ACCESS
  );

  const baseEventsQuery = context.supabase
    .from("estimate_version_events")
    .select(
      "id, estimate_version_id, event_type, metadata, created_by, occurred_at, created_at, profiles:created_by(full_name)"
    )
    .eq("tenant_id", context.tenantId)
    .eq("estimate_version_id", input.versionId)
    .eq("event_type", "approval_decided")
    .order("occurred_at", { ascending: false });

  const eventsQuery = input.actorUserId
    ? baseEventsQuery.eq("created_by", input.actorUserId)
    : baseEventsQuery;
  const filteredEventsQuery = input.decision
    ? eventsQuery.eq("metadata->>decision", input.decision)
    : eventsQuery;

  const { data, error } = await filteredEventsQuery.order("created_at", { ascending: false });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger le journal de décision.");
  }

  const authorQuery = context.supabase
    .from("estimate_version_events")
    .select("created_by, profiles:created_by(full_name)")
    .eq("tenant_id", context.tenantId)
    .eq("estimate_version_id", input.versionId)
    .eq("event_type", "approval_decided");
  const { data: authorRows, error: authorError } = await authorQuery;

  if (authorError) {
    throw mapSupabaseError(
      authorError,
      "Impossible de charger les auteurs du journal de décision."
    );
  }

  const events = (((data ?? []) as unknown) as EstimateApprovalDecisionEventRow[]).map((row) =>
    normalizeEstimateApprovalDecisionEventRow(row)
  );
  const availableAuthors = [...new Map(
    ((((authorRows ?? []) as unknown) as Pick<
      EstimateApprovalDecisionEventRow,
      "created_by" | "profiles"
    >[]))
      .filter((row) => row.created_by)
      .map((row) => [
        row.created_by!,
        {
          userId: row.created_by!,
          actorName: resolveDecisionEventActorLabel({
            actorUserId: row.created_by,
            actorName: resolveEmbeddedOne(row.profiles)?.full_name ?? null,
          }),
        },
      ])
  ).values()].sort((left, right) => left.actorName.localeCompare(right.actorName));

  return {
    events,
    availableAuthors,
    filters: {
      actorUserId: input.actorUserId ?? null,
      decision: input.decision ?? null,
    },
  };
}
