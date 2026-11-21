import type { EstimateReviewDecision, EstimateVersionApprovalStatus, EstimateReviewCorrectionItemRow, EstimateRiskAlertTargetRow, Supabase, AuthenticatedContext, EmbeddedApprovalProjectAccess, VersionAccessRow, EstimateReviewCycleWithProfilesRow, RulesEngineVersion, RulesEngineProject, RulesEngineItemAccess, EstimateRuleViolation, EvaluateRulesResult, EstimateApprovalCorrectionEvent, EstimateApprovalCorrectionItem, EstimateApprovalReviewComment, EstimateApprovalSubmissionSignal, EstimateApprovalSummaryCore, EstimateApprovalSummary, ApprovalAuditTrigger, EstimateRulesWithApprovals } from "@/lib/estimates/approval-types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAffaireRegisterHubHref } from "@/lib/affaires/register";
import { createOptionalServiceRoleClient } from "@/lib/supabase/service-role";
import { startConcurrentRead } from "@/lib/supabase/concurrent-read";
import { requireEstimateEngineVersion } from "@/lib/estimates/engine/capabilities";
import { loadV3MarginEvidence, type V3MarginEvidence } from "@/lib/estimates/v3-margin-evidence-server";
import type { CanonicalFixedDiscountEvidence } from "@/lib/estimates/effective-discount";
import { loadCanonicalFixedDiscountEvidence } from "@/lib/estimates/fixed-discount-evidence-server";
import type { Database, Json } from "@/types/database";
import { mapSupabaseError } from "@/lib/http/api-response";
import { takeoffReviewHref } from "@/lib/takeoff/review-href";
import { readAllEstimateItems } from "./read-all-items-server";
import { resolveEmbeddedOne } from "@/lib/supabase/embedded";
import {
  canAccessOwnerResource,
  getAuthenticatedContext,
  getVersionAccessOrThrow,
  hasEstimateApprovalRole,
} from "@/lib/estimates/server-context";
import { isApprovalWorkflowSignal, resolveApprovalSummaryLabel } from "@/lib/estimates/rule-evaluation";
import { evaluateRules, loadEstimateRulesWithApprovals } from "@/lib/estimates/rule-evaluation-server";
import { buildSubmissionReadinessFromRulesEvaluation, loadSubmissionReadinessRegisterContext, applySubmissionReadinessRegisterContext } from "@/lib/estimates/approval-submission-readiness-server";
import { listEstimateReviewCycles, loadApprovalCommentTargetContext, listAvailableEstimateApprovalReviewers, listEstimateReviewComments, listEstimateReviewCorrectionItems, listEstimateReviewCorrectionEvents, normalizeReviewComment, normalizeReviewCorrectionEvent, normalizeReviewCorrectionItem, listPendingApprovalsForVersion, normalizeReviewCycle, listRuleIdsForReviewCycle, normalizeAssignedReviewer, resolveApprovalStatusFromReviewDecision, buildEstimateReviewCommentTargets } from "@/lib/estimates/approval-review-server";
import { buildChangesSinceLastCycle } from "@/lib/estimates/approval-cycle-changes-server";
import { APPROVAL_VERSION_ACCESS } from "@/lib/estimates/approval-version-access";

function sortJsonValue(value: Json | null): Json | null {
  if (value === null) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry as Json)) as Json;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right)
    );

    return Object.fromEntries(
      entries.map(([key, entryValue]) => [key, sortJsonValue(entryValue as Json)])
    ) as Json;
  }

  return value;
}

function stableJsonStringify(value: Json | null) {
  return JSON.stringify(sortJsonValue(value));
}

function buildEstimateEditorHref(input: {
  versionId: string;
  itemId: string;
}) {
  const params = new URLSearchParams({
    focusItemId: input.itemId,
  });
  return `/dashboard/estimates/${input.versionId}/edit?${params.toString()}`;
}

function buildTakeoffExceptionHref(input: {
  projectId: string;
  versionId: string;
  alert: EstimateRiskAlertTargetRow;
}) {
  return takeoffReviewHref({
    projectId: input.projectId,
    jobId: input.alert.takeoff_job_id,
    versionId: input.versionId,
    line: input.alert.line_id || undefined,
  });
}

function resolveApprovalWorkflowStatus(input: {
  approvalReasons: EstimateRuleViolation[];
}): EstimateVersionApprovalStatus {
  if (input.approvalReasons.length === 0) {
    return "not_required";
  }

  if (input.approvalReasons.some((reason) => reason.approval_status === "rejected")) {
    return "changes_requested";
  }

  if (input.approvalReasons.every((reason) => reason.approval_status === "approved")) {
    return "approved";
  }

  if (input.approvalReasons.some((reason) => reason.approval_status === "pending")) {
    return "in_review";
  }

  return "required";
}

function buildApprovalSummaryFromRulesEvaluation(input: {
  rulesEvaluation: EvaluateRulesResult;
  evaluatedAt: string;
}): EstimateApprovalSummaryCore {
  const approvalReasons = input.rulesEvaluation.violations.filter((violation) =>
    isApprovalWorkflowSignal({
      action: violation.action,
      ruleType: violation.rule_type,
    })
  );

  const unavailableSignals = input.rulesEvaluation.unavailableSignals
    .filter((signal) =>
      isApprovalWorkflowSignal({
        action: signal.action,
        ruleType: signal.rule_type,
      })
    )
    .map((signal) => signal.metric_key)
    .sort((left, right) => left.localeCompare(right));

  const latestDecision = [...approvalReasons]
    .filter(
      (reason) =>
        reason.approval_id &&
        reason.approval_created_at &&
        (reason.approval_status === "pending" ||
          reason.approval_status === "approved" ||
          reason.approval_status === "rejected")
    )
    .sort((left, right) => {
      const leftTimestamp = Date.parse(left.approval_decided_at ?? left.approval_created_at ?? "");
      const rightTimestamp = Date.parse(
        right.approval_decided_at ?? right.approval_created_at ?? ""
      );
      return rightTimestamp - leftTimestamp;
    })[0];
  const latestDecisionStatus =
    latestDecision?.approval_status === "pending" ||
    latestDecision?.approval_status === "approved" ||
    latestDecision?.approval_status === "rejected"
      ? latestDecision.approval_status
      : null;

  return {
    approvalStatus: resolveApprovalWorkflowStatus({
      approvalReasons,
    }),
    requiresApproval: approvalReasons.length > 0,
    evaluatedAt: input.evaluatedAt,
    reasons: approvalReasons.map((reason) => ({
      ruleId: reason.rule_id,
      label: resolveApprovalSummaryLabel(reason.rule_type),
      signalKey: reason.metric_key,
      thresholdValue: reason.threshold_value,
      actualValue: reason.actual_value,
      sourceState: reason.source_state,
      message: reason.message,
      action: reason.action,
      approvalStatus: reason.approval_status,
      approvalId: reason.approval_id,
      approvalCreatedAt: reason.approval_created_at,
      approvalDecidedAt: reason.approval_decided_at,
    })),
    latestDecision:
      latestDecisionStatus && latestDecision?.approval_created_at
        ? {
            approvalId: latestDecision.approval_id,
            status: latestDecisionStatus,
            decidedAt: latestDecision.approval_decided_at,
            createdAt: latestDecision.approval_created_at,
            decision: null,
            cycleId: null,
            cycleNumber: null,
            commentCount: 0,
          }
        : null,
    unavailableSignals,
  };
}

async function evaluateApprovalSummaryBundle(input: {
  supabase: SupabaseClient<Database> | Supabase;
  tenantId: string;
  version: RulesEngineVersion;
  project: RulesEngineProject;
  items: RulesEngineItemAccess[];
  evaluatedAt?: string;
  fixedDiscountEvidence?: CanonicalFixedDiscountEvidence | null;
  v3MarginEvidence?: V3MarginEvidence | null;
  rulesWithApprovals?: Promise<EstimateRulesWithApprovals>;
}) {
  const evaluatedAt = input.evaluatedAt ?? new Date().toISOString();
  const rulesEvaluation = await evaluateRules({
    supabase: input.supabase,
    tenantId: input.tenantId,
    version: input.version,
    project: input.project,
    items: input.items,
    preserveApprovedRequiresApproval: true,
    fixedDiscountEvidence: input.fixedDiscountEvidence,
    v3MarginEvidence: input.v3MarginEvidence,
    rulesWithApprovals: input.rulesWithApprovals,
  });

  return {
    summary: buildApprovalSummaryFromRulesEvaluation({
      rulesEvaluation,
      evaluatedAt,
    }),
    submissionReadiness: buildSubmissionReadinessFromRulesEvaluation({
      rulesEvaluation,
    }),
  };
}

export async function evaluateApprovalSummary(input: {
  supabase: SupabaseClient<Database> | Supabase;
  tenantId: string;
  version: RulesEngineVersion;
  project: RulesEngineProject;
  items: RulesEngineItemAccess[];
  evaluatedAt?: string;
  fixedDiscountEvidence?: CanonicalFixedDiscountEvidence | null;
  v3MarginEvidence?: V3MarginEvidence | null;
}): Promise<EstimateApprovalSummaryCore> {
  const { summary } = await evaluateApprovalSummaryBundle(input);
  return summary;
}

function toApprovalSummaryStorage(summary: EstimateApprovalSummaryCore): NonNullable<Json> {
  return {
    requiresApproval: summary.requiresApproval,
    reasons: summary.reasons.map((reason) => ({
      ruleId: reason.ruleId,
      label: reason.label,
      signalKey: reason.signalKey,
      thresholdValue: reason.thresholdValue,
      actualValue: reason.actualValue,
      sourceState: reason.sourceState,
      message: reason.message,
      action: reason.action,
      approvalStatus: reason.approvalStatus,
      approvalId: reason.approvalId,
      approvalCreatedAt: reason.approvalCreatedAt,
      approvalDecidedAt: reason.approvalDecidedAt,
    })),
    latestDecision: summary.latestDecision,
    unavailableSignals: summary.unavailableSignals,
  } satisfies Json;
}

function buildCorrectionItemHref(input: {
  projectId: string;
  versionId: string;
  item: EstimateReviewCorrectionItemRow;
  exceptionById: Map<string, EstimateRiskAlertTargetRow>;
}) {
  if (input.item.scope_type === "lot" || input.item.scope_type === "line") {
    return input.item.scope_id
      ? buildEstimateEditorHref({
          versionId: input.versionId,
          itemId: input.item.scope_id,
        })
      : null;
  }

  if (input.item.scope_type === "hypothesis") {
    return input.item.scope_id
      ? buildAffaireRegisterHubHref({
          projectId: input.projectId,
          status: "open",
          kind: "assumption",
          focusEntryId: input.item.scope_id,
        })
      : null;
  }

  if (input.item.scope_type === "exception") {
    if (!input.item.scope_id) {
      return null;
    }
    const alert = input.exceptionById.get(input.item.scope_id);
    return alert
      ? buildTakeoffExceptionHref({
          projectId: input.projectId,
          versionId: input.versionId,
          alert,
        })
      : `/dashboard/affaires/${input.projectId}/takeoff`;
  }

  return null;
}

/**
 * The first review reads of the approval panel depend only on the version and project, never on
 * the rule evaluation, and none of them reads what the approval projection writes (approval
 * columns of the version, version events): they start with the summary instead of after it.
 */
function startApprovalReviewReads(input: {
  context: AuthenticatedContext;
  versionId: string;
  projectId: string;
}) {
  return {
    cycleRows: startConcurrentRead(listEstimateReviewCycles({
      context: input.context,
      versionId: input.versionId,
    })),
    targetContext: startConcurrentRead(loadApprovalCommentTargetContext({
      context: input.context,
      versionId: input.versionId,
      projectId: input.projectId,
    })),
    availableReviewers: startConcurrentRead(listAvailableEstimateApprovalReviewers({
      context: input.context,
    })),
  };
}

async function enrichEstimateApprovalSummary(input: {
  context: AuthenticatedContext;
  version: VersionAccessRow;
  project: EmbeddedApprovalProjectAccess;
  items: RulesEngineItemAccess[];
  summary: EstimateApprovalSummaryCore;
  submissionReadiness: {
    blockers: EstimateApprovalSubmissionSignal[];
    alerts: EstimateApprovalSubmissionSignal[];
  };
  reviewReads: ReturnType<typeof startApprovalReviewReads>;
}): Promise<EstimateApprovalSummary> {
  const [cycleRows, targetContext] = await Promise.all([
    input.reviewReads.cycleRows,
    input.reviewReads.targetContext,
  ]);
  const cycleIds = cycleRows.map((cycle) => cycle.id);
  const [resolvedCommentRows, correctionItemRows, correctionEventRows] =
    cycleIds.length === 0
      ? [[], [], []]
      : await Promise.all([
          listEstimateReviewComments({
            context: input.context,
            versionId: input.version.id,
            cycleIds,
          }),
          listEstimateReviewCorrectionItems({
            context: input.context,
            versionId: input.version.id,
            cycleIds,
          }),
          listEstimateReviewCorrectionEvents({
            context: input.context,
            versionId: input.version.id,
            cycleIds,
          }),
        ]);
  const commentsByCycleId = new Map<string, EstimateApprovalReviewComment[]>();

  resolvedCommentRows.forEach((row) => {
    const comment = normalizeReviewComment(row);
    const list = commentsByCycleId.get(row.cycle_id);
    if (list) {
      list.push(comment);
      return;
    }
    commentsByCycleId.set(row.cycle_id, [comment]);
  });

  const correctionEventsByItemId = new Map<string, EstimateApprovalCorrectionEvent[]>();
  correctionEventRows.forEach((row) => {
    const event = normalizeReviewCorrectionEvent(row);
    const list = correctionEventsByItemId.get(row.item_id);
    if (list) {
      list.push(event);
      return;
    }
    correctionEventsByItemId.set(row.item_id, [event]);
  });

  const exceptionById = new Map(
    targetContext.exceptions.map((entry) => [entry.id, entry] as const)
  );
  const correctionItemsByCycleId = new Map<string, EstimateApprovalCorrectionItem[]>();
  correctionItemRows.forEach((row) => {
    const item = normalizeReviewCorrectionItem({
      row,
      href: buildCorrectionItemHref({
        projectId: input.project.id,
        versionId: input.version.id,
        item: row,
        exceptionById,
      }),
      history: correctionEventsByItemId.get(row.id) ?? [],
    });
    const list = correctionItemsByCycleId.get(row.cycle_id);
    if (list) {
      list.push(item);
      return;
    }
    correctionItemsByCycleId.set(row.cycle_id, [item]);
  });

  const activeCycleRow =
    cycleRows.find(
      (cycle) => cycle.decision === null && cycle.superseded_at == null
    ) ?? null;
  const activeCyclePendingApprovals =
    activeCycleRow !== null
      ? await listPendingApprovalsForVersion({
          context: input.context,
          versionId: input.version.id,
        })
      : [];
  const reviewHistory = cycleRows
    .filter((cycle): cycle is EstimateReviewCycleWithProfilesRow & { decision: EstimateReviewDecision; decided_at: string; decided_by: string } => cycle.decision !== null && cycle.decided_at !== null && cycle.decided_by !== null)
    .map((cycle) => ({
      ...normalizeReviewCycle(cycle),
      comments: commentsByCycleId.get(cycle.id) ?? [],
    }));
  const latestCompletedCycle = reviewHistory[0] ?? null;
  const pendingApprovalCount = activeCyclePendingApprovals.length;
  const availableReviewers = await input.reviewReads.availableReviewers;
  const canPrepareRequest =
    hasEstimateApprovalRole(input.context.tenantRole, "request") &&
    canAccessOwnerResource({
      context: input.context,
      resourceUserId: input.project.user_id,
    });
  const submissionBlockers = [...input.submissionReadiness.blockers];
  if (availableReviewers.length === 0) {
    submissionBlockers.push({
      id: "reviewer:none",
      label: "Validateur indisponible",
      message:
        "Aucun rôle admin ou director n'est disponible pour prendre la revue.",
    });
  }
  const correctionSourceCycleId =
    activeCycleRow?.carried_over_from_cycle_id ??
    (latestCompletedCycle?.decision === "changes_requested"
      ? latestCompletedCycle.id
      : null);
  const correctionSourceCycle =
    correctionSourceCycleId !== null
      ? reviewHistory.find((cycle) => cycle.id === correctionSourceCycleId) ?? null
      : null;
  const correctionItems = correctionSourceCycle
    ? correctionItemsByCycleId.get(correctionSourceCycle.id) ?? []
    : [];
  const correctionPendingCount = correctionItems.filter(
    (item) => item.status === "pending"
  ).length;
  const correctionCorrectedCount = correctionItems.filter(
    (item) => item.status === "corrected"
  ).length;
  const correctionToDiscussCount = correctionItems.filter(
    (item) => item.status === "to_discuss"
  ).length;
  const allCorrectionsTreated = correctionPendingCount === 0;
  const currentRequestableRuleIds = input.summary.reasons
    .filter((reason) => reason.approvalStatus === "missing" || reason.approvalStatus === "rejected")
    .map((reason) => reason.ruleId);
  const carriedOverRuleIds =
    correctionSourceCycle !== null
      ? await listRuleIdsForReviewCycle({
          context: input.context,
          versionId: input.version.id,
          cycleId: correctionSourceCycle.id,
          requestedAt: correctionSourceCycle.requestedAt,
          decidedAt: correctionSourceCycle.decidedAt,
        })
      : [];
  const requestableRuleIds = [...new Set([...currentRequestableRuleIds, ...carriedOverRuleIds])];
  const canRequest =
    canPrepareRequest &&
    activeCycleRow === null &&
    requestableRuleIds.length > 0 &&
    (!correctionSourceCycle || allCorrectionsTreated) &&
    submissionBlockers.length === 0;
  const canDecide =
    hasEstimateApprovalRole(input.context.tenantRole, "approve") &&
    activeCycleRow !== null &&
    pendingApprovalCount > 0;
  const activeCycle =
    activeCycleRow !== null
      ? {
          id: activeCycleRow.id,
          cycleNumber: activeCycleRow.cycle_number,
          requestedAt: activeCycleRow.requested_at,
          requestedBy: activeCycleRow.requested_by,
          requesterName:
            resolveEmbeddedOne(activeCycleRow.requested_by_profile)?.full_name ?? null,
          pendingApprovalCount,
          submissionMessage: activeCycleRow.submission_message,
          assignedReviewer: normalizeAssignedReviewer(activeCycleRow),
          carriedOverFromCycleId: activeCycleRow.carried_over_from_cycle_id,
        }
      : null;

  let latestDecision = input.summary.latestDecision;
  if (latestCompletedCycle) {
    latestDecision = {
      approvalId: latestDecision?.approvalId ?? null,
      status: resolveApprovalStatusFromReviewDecision(latestCompletedCycle.decision),
      decidedAt: latestCompletedCycle.decidedAt,
      createdAt: latestCompletedCycle.requestedAt,
      decision: latestCompletedCycle.decision,
      cycleId: latestCompletedCycle.id,
      cycleNumber: latestCompletedCycle.cycleNumber,
      commentCount: latestCompletedCycle.comments.length,
    };
  } else if (activeCycle) {
    latestDecision = {
      approvalId: latestDecision?.approvalId ?? null,
      status: "pending",
      decidedAt: null,
      createdAt: activeCycle.requestedAt,
      decision: null,
      cycleId: activeCycle.id,
      cycleNumber: activeCycle.cycleNumber,
      commentCount: 0,
    };
  }

  const correctionChecklist =
    correctionSourceCycle !== null
      ? {
          sourceCycleId: correctionSourceCycle.id,
          sourceCycleNumber: correctionSourceCycle.cycleNumber,
          decisionAt: correctionSourceCycle.decidedAt,
          totalCount: correctionItems.length,
          pendingCount: correctionPendingCount,
          correctedCount: correctionCorrectedCount,
          toDiscussCount: correctionToDiscussCount,
          allTreated: allCorrectionsTreated,
          canResubmit:
            activeCycleRow === null &&
            allCorrectionsTreated &&
            submissionBlockers.length === 0 &&
            availableReviewers.length > 0 &&
            requestableRuleIds.length > 0,
          items: correctionItems,
        }
      : null;
  const changesSinceLastCycle =
    correctionSourceCycle !== null
      ? await buildChangesSinceLastCycle({
          context: input.context,
          version: input.version,
          sourceCycle: correctionSourceCycle,
          correctionItems,
        })
      : null;

  return {
    ...input.summary,
    latestDecision,
    permissions: {
      canPrepareRequest,
      canRequest,
      canDecide,
    },
    activeCycle,
    reviewHistory,
    availableReviewers,
    submissionReadiness: {
      blockers: submissionBlockers,
      alerts: input.submissionReadiness.alerts,
    },
    correctionChecklist,
    changesSinceLastCycle,
    commentTargets: buildEstimateReviewCommentTargets({
      project: input.project,
      items: input.items,
      exceptions: targetContext.exceptions,
      hypotheses: targetContext.hypotheses,
      reasons: input.summary.reasons,
    }),
  };
}

function toApprovalSummaryAuditMetadata(input: {
  summary: EstimateApprovalSummaryCore;
  trigger: ApprovalAuditTrigger;
  previousStatus: EstimateVersionApprovalStatus;
}): Json {
  return {
    trigger: input.trigger,
    previousStatus: input.previousStatus,
    approvalStatus: input.summary.approvalStatus,
    evaluatedAt: input.summary.evaluatedAt,
    summary: toApprovalSummaryStorage(input.summary),
  } satisfies Json;
}

async function logEstimateApprovalEvent(input: {
  versionId: string;
  eventType:
    | "approval_rules_evaluated"
    | "approval_status_changed"
    | "approval_decided";
  actorUserId: string | null;
  metadata?: Json;
  occurredAt?: string;
}) {
  const rpcClient = createOptionalServiceRoleClient();
  if (!rpcClient) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
      );
    }

    return;
  }

  const { error } = await rpcClient.rpc("log_estimate_version_event", {
    p_estimate_version_id: input.versionId,
    p_event_type: input.eventType,
    p_created_by: input.actorUserId,
    p_metadata: input.metadata ?? {},
    p_occurred_at: input.occurredAt ?? new Date().toISOString(),
  });

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible d'enregistrer l'événement d'approbation."
    );
  }
}

export async function loadApprovalSummaryItems(input: {
  context: AuthenticatedContext;
  versionId: string;
}) {
  const items = await readAllEstimateItems({
    supabase: input.context.supabase,
    tenantId: input.context.tenantId,
    versionId: input.versionId,
  });
  return items.map(({ id, category_id, item_type, title, parent_id, position }) => ({
    id, category_id, item_type, title, parent_id, position,
  })) satisfies RulesEngineItemAccess[];
}

export async function syncEstimateApprovalSummary(input: {
  context: AuthenticatedContext;
  version: VersionAccessRow;
  project: EmbeddedApprovalProjectAccess;
  trigger: ApprovalAuditTrigger;
  actorUserId?: string | null;
}): Promise<EstimateApprovalSummary> {
  // Lot 2, sous-lot 2.5 : une v3 a sa preuve de marque nette (D5) ; le moteur reste exigé en clair.
  requireEstimateEngineVersion(input.version);
  // Reads that need neither the items nor the evidences start now, alongside them.
  const reviewReads = startApprovalReviewReads({
    context: input.context,
    versionId: input.version.id,
    projectId: input.project.id,
  });
  const registerContextPromise = startConcurrentRead(loadSubmissionReadinessRegisterContext({
    supabase: input.context.supabase,
    projectId: input.project.id,
    versionId: input.version.id,
  }));
  const rulesWithApprovals = startConcurrentRead(loadEstimateRulesWithApprovals({
    supabase: input.context.supabase,
    tenantId: input.context.tenantId,
    versionId: input.version.id,
  }));
  const evidenceInput = {
    supabase: input.context.supabase, tenantId: input.context.tenantId,
    projectUserId: input.project.user_id, authorizedVersion: input.version,
  };
  // The items and both evidences are independent reads of the same authorized version.
  const [items, fixedDiscountEvidence, v3MarginEvidence] = await Promise.all([
    loadApprovalSummaryItems({
      context: input.context,
      versionId: input.version.id,
    }),
    loadCanonicalFixedDiscountEvidence(evidenceInput),
    loadV3MarginEvidence(evidenceInput),
  ]);
  const evaluatedAt = new Date().toISOString();
  // One rule evaluation gives both the approval summary and the submission readiness.
  const { summary: coreSummary, submissionReadiness: rulesSubmissionReadiness } =
    await evaluateApprovalSummaryBundle({
      supabase: input.context.supabase,
      tenantId: input.context.tenantId,
      fixedDiscountEvidence,
      v3MarginEvidence,
      version: {
        id: input.version.id,
        project_id: input.version.project_id,
        total_ht_cents: input.version.total_ht_cents,
        margin_bp: input.version.margin_bp,
        margin_multiplier: input.version.margin_multiplier,
        margin_mode: input.version.margin_mode,
        discount_bp: input.version.discount_bp,
        discount_amount_cents: input.version.discount_amount_cents,
        gross_ht_cents: input.version.gross_ht_cents,
        discount_applied_cents: input.version.discount_applied_cents,
        tenant_id: input.version.tenant_id,
        status: input.version.status,
        updated_at: input.version.updated_at,
        calc_engine_version: input.version.calc_engine_version,
        content_revision: input.version.content_revision,
        calc_snapshot_content_revision:
          input.version.calc_snapshot_content_revision,
        calc_snapshot_context: input.version.calc_snapshot_context,
      },
      project: {
        id: input.project.id,
        client_name: input.project.client_name,
      },
      items,
      evaluatedAt,
      rulesWithApprovals,
    });
  const submissionReadiness = applySubmissionReadinessRegisterContext({
    projectId: input.project.id,
    versionId: input.version.id,
    submissionReadiness: rulesSubmissionReadiness,
    ...(await registerContextPromise),
  });

  const previousStatus = input.version.approval_status ?? "not_required";
  const storedSummary = (input.version.approval_summary ?? null) as Json | null;
  const nextSummary = toApprovalSummaryStorage(coreSummary);
  const summaryChanged =
    previousStatus !== coreSummary.approvalStatus ||
    stableJsonStringify(storedSummary) !== stableJsonStringify(nextSummary) ||
    !input.version.approval_evaluated_at;

  if (!summaryChanged) {
    return enrichEstimateApprovalSummary({
      context: input.context,
      version: input.version,
      project: input.project,
      items,
      submissionReadiness,
      reviewReads,
      summary: {
        ...coreSummary,
        evaluatedAt: input.version.approval_evaluated_at ?? coreSummary.evaluatedAt,
      },
    });
  }

  // Lot 2, sous-lot 2.7 (V3M01) : une version émise est en lecture seule
  // (guard_estimate_versions_readonly refuse toute colonne hors statut et sceau). Son résumé se
  // calcule pour l'affichage, sans l'écriture vouée au refus qui vidait le panneau d'approbation
  // d'une version jamais évaluée en brouillon (envoi par l'API).
  if (input.version.status !== "draft") {
    return enrichEstimateApprovalSummary({
      context: input.context,
      version: input.version,
      project: input.project,
      items,
      submissionReadiness,
      reviewReads,
      summary: coreSummary,
    });
  }

  const serviceRoleClient = createOptionalServiceRoleClient();
  if (!serviceRoleClient) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
      );
    }

    return enrichEstimateApprovalSummary({
      context: input.context,
      version: input.version,
      project: input.project,
      items,
      submissionReadiness,
      reviewReads,
      summary: coreSummary,
    });
  }

  const { error: updateError } = await serviceRoleClient
    .from("estimate_versions")
    .update({
      approval_status: coreSummary.approvalStatus,
      approval_summary: nextSummary,
      approval_evaluated_at: coreSummary.evaluatedAt,
    })
    .eq("tenant_id", input.context.tenantId)
    .eq("id", input.version.id);

  if (updateError) {
    throw mapSupabaseError(
      updateError,
      "Impossible de projeter le résumé d'approbation."
    );
  }

  await logEstimateApprovalEvent({
    versionId: input.version.id,
    eventType: "approval_rules_evaluated",
    actorUserId: input.actorUserId ?? input.context.userId,
    occurredAt: coreSummary.evaluatedAt,
    metadata: toApprovalSummaryAuditMetadata({
      summary: coreSummary,
      trigger: input.trigger,
      previousStatus,
    }),
  });

  if (previousStatus !== coreSummary.approvalStatus) {
    await logEstimateApprovalEvent({
      versionId: input.version.id,
      eventType: "approval_status_changed",
      actorUserId: input.actorUserId ?? input.context.userId,
      occurredAt: coreSummary.evaluatedAt,
      metadata: {
        previousStatus,
        nextStatus: coreSummary.approvalStatus,
        reasons: coreSummary.reasons.map((reason) => ({
          ruleId: reason.ruleId,
          approvalStatus: reason.approvalStatus,
          message: reason.message,
        })),
      } satisfies Json,
    });
  }

  return enrichEstimateApprovalSummary({
    context: input.context,
    version: input.version,
    project: input.project,
    items,
    submissionReadiness,
    reviewReads,
    summary: coreSummary,
  });
}

export async function getEstimateApprovalSummary(
  versionId: string
): Promise<EstimateApprovalSummary> {
  const context = await getAuthenticatedContext();
  const { version, project } = await getVersionAccessOrThrow<VersionAccessRow, EmbeddedApprovalProjectAccess>(
    context.supabase, versionId, context, APPROVAL_VERSION_ACCESS
  );

  return syncEstimateApprovalSummary({
    context,
    version,
    project,
    trigger: "read",
  });
}
