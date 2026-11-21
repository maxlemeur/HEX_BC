import type { EstimateApprovalStatus, EstimateReviewDecision, EstimateRuleRow, EstimateApprovalRow, DecideEstimateReviewCycleResult, AuthenticatedContext, EmbeddedReviewerProfile, EmbeddedApprovalProjectAccess, VersionAccessRow, EstimateApprovalDecisionCommentInput, SubmitEstimateApprovalInput, SubmitEstimateApprovalResult, EstimateApprovalCommentTarget, EstimateApprovalReviewer, EstimateApprovalSummaryCore, EstimateApprovalSummary, NormalizedDecisionComment } from "@/lib/estimates/approval-types";
import { readAllRowsInChunks } from "@/lib/supabase/read-all";
import { sendApprovalReviewRequestNotification } from "@/lib/email/send-approval-review-request";
import { freezeApprovalV2DraftIfRequired } from "@/lib/estimates/approval-v2-snapshot";
import { openEstimateReviewCycle } from "@/lib/estimates/review-cycle-submission";
import { loadV3MarginEvidence } from "@/lib/estimates/v3-margin-evidence-server";
import { loadCanonicalFixedDiscountEvidence } from "@/lib/estimates/fixed-discount-evidence-server";
import type { Json } from "@/types/database";
import { badRequest, conflict, forbidden, mapSupabaseError, notFound } from "@/lib/http/api-response";
import {
  canAccessOwnerResource,
  getAuthenticatedContext,
  getVersionAccessOrThrow,
  hasEstimateApprovalRole,
} from "@/lib/estimates/server-context";
import { listAvailableEstimateApprovalReviewers, findLatestReviewCycle, listEstimateReviewCorrectionItems, listRuleIdsForReviewCycle, findOpenReviewCycle, listPendingApprovalsForVersion, loadApprovalCommentTargetContext, buildEstimateReviewCommentTargets, resolveApprovalStatusFromReviewDecision } from "@/lib/estimates/approval-review-server";
import { APPROVAL_VERSION_ACCESS } from "@/lib/estimates/approval-version-access";
import { loadApprovalSummaryItems, evaluateApprovalSummary, syncEstimateApprovalSummary } from "@/lib/estimates/approval-summary-server";
import { resolveApprovalSummaryLabel } from "@/lib/estimates/rule-evaluation";
import { evaluateSubmissionReadiness } from "@/lib/estimates/approval-submission-readiness-server";

async function loadProfileIdentity(input: {
  context: AuthenticatedContext;
  userId: string;
}) {
  const { data, error } = await input.context.supabase
    .from("profiles")
    .select("id, full_name, work_email")
    .in("id", [input.userId]);

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger le profil utilisateur.");
  }

  const profile = ((data ?? []) as EmbeddedReviewerProfile[]).find(
    (candidate) => candidate.id === input.userId
  );
  if (!profile) {
    throw notFound("Profil utilisateur introuvable.");
  }

  return profile;
}

function assertRequesterRole(context: Pick<AuthenticatedContext, "tenantRole">) {
  if (hasEstimateApprovalRole(context.tenantRole, "request")) {
    return;
  }
  throw forbidden("Action réservée aux demandeurs d'approbation.");
}

function assertApproverRole(context: Pick<AuthenticatedContext, "tenantRole">) {
  if (hasEstimateApprovalRole(context.tenantRole, "approve")) {
    return;
  }
  throw forbidden("Action réservée aux rôles de validation.");
}

function normalizeOptionalUuid(value: string | undefined) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildReviewCommentTargetLookup(
  targets: EstimateApprovalSummary["commentTargets"]
) {
  const lookup = new Map<string, EstimateApprovalCommentTarget>();
  const pushTarget = (target: EstimateApprovalCommentTarget) => {
    lookup.set(`${target.scopeType}:${target.scopeId ?? "project"}`, target);
  };

  pushTarget(targets.project);
  targets.lots.forEach(pushTarget);
  targets.lines.forEach(pushTarget);
  targets.exceptions.forEach(pushTarget);
  targets.hypotheses.forEach(pushTarget);
  targets.approvalRules.forEach(pushTarget);

  return lookup;
}

function normalizeDecisionComments(input: {
  decision: EstimateReviewDecision;
  comments: EstimateApprovalDecisionCommentInput[];
  targets: EstimateApprovalSummary["commentTargets"];
}) {
  const lookup = buildReviewCommentTargetLookup(input.targets);
  const normalized = input.comments.map((entry) => {
    const scopeType = entry.scopeType;
    const scopeId =
      scopeType === "project" ? null : normalizeOptionalUuid(entry.scopeId ?? undefined);
    const comment = entry.comment.trim();

    if (comment.length === 0) {
      throw badRequest("Chaque commentaire de revue doit contenir un texte.");
    }

    if (scopeType !== "project" && !scopeId) {
      throw badRequest(
        "Chaque commentaire cible doit pointer vers un lot, une ligne, une exception ou une hypothèse."
      );
    }

    const target = lookup.get(`${scopeType}:${scopeId ?? "project"}`);
    if (!target) {
      throw badRequest("Une cible de commentaire n'est plus valide pour cette version.");
    }

    return {
      scopeType,
      scopeId,
      scopeLabel: target.label,
      comment,
    } satisfies NormalizedDecisionComment;
  });

  if (input.decision === "changes_requested" && normalized.length === 0) {
    throw badRequest("Un retour correction doit contenir au moins un commentaire.");
  }

  if (input.decision === "approved_with_reservations" && normalized.length === 0) {
    throw badRequest("Une approbation sous reserve doit contenir au moins un commentaire.");
  }

  return normalized;
}

async function decideReviewCycleAtomically(input: {
  context: AuthenticatedContext;
  cycleId: string;
  decision: EstimateReviewDecision;
  comments: NormalizedDecisionComment[];
}) {
  const { data, error } = await input.context.supabase.rpc(
    "decide_estimate_review_cycle",
    {
      p_cycle_id: input.cycleId,
      p_decision: input.decision,
      p_comments: input.comments.map((comment) => ({
        scope_type: comment.scopeType,
        scope_id: comment.scopeId,
        scope_label: comment.scopeLabel,
        comment: comment.comment,
      })),
    }
  );

  if (error) {
    if (error.message.includes("ESTIMATE_REVIEW_SNAPSHOT_STALE")) {
      throw conflict(
        "Le devis a été modifié depuis sa soumission. Une nouvelle revue est requise.",
        undefined,
        "ESTIMATE_REVIEW_SNAPSHOT_STALE"
      );
    }

    if (error.message.includes("ESTIMATE_APPROVALS_PENDING_NOT_FOUND")) {
      throw badRequest("Aucune approbation en attente n'est disponible.");
    }

    if (
      error.message.includes("ESTIMATE_REVIEW_CYCLE_ALREADY_CLOSED") ||
      error.message.includes("ESTIMATE_REVIEW_CYCLE_NOT_FOUND")
    ) {
      throw badRequest("Aucun cycle de revue actif n'est disponible.");
    }

    throw mapSupabaseError(error, "Impossible d'enregistrer la décision d'approbation.");
  }

  const row = Array.isArray(data)
    ? ((data[0] as unknown) as DecideEstimateReviewCycleResult | undefined)
    : undefined;
  if (!row) {
    throw badRequest("Impossible d'enregistrer la décision d'approbation.");
  }

  return row;
}

async function decideApprovalAtomically(input: {
  context: AuthenticatedContext;
  approvalId: string;
  status: "approved" | "rejected";
}) {
  const { data, error } = await input.context.supabase.rpc(
    "decide_estimate_approval",
    {
      p_approval_id: input.approvalId,
      p_status: input.status,
    }
  );

  if (error) {
    if (error.message.includes("ESTIMATE_REVIEW_SNAPSHOT_STALE")) {
      throw conflict(
        "Le devis a été modifié depuis sa soumission. Une nouvelle revue est requise.",
        undefined,
        "ESTIMATE_REVIEW_SNAPSHOT_STALE"
      );
    }

    if (
      error.message.includes("ESTIMATE_APPROVAL_PENDING_NOT_FOUND") ||
      error.message.includes("ESTIMATE_REVIEW_CYCLE_NOT_FOUND")
    ) {
      throw badRequest("Aucune approbation en attente n'est disponible.");
    }

    throw mapSupabaseError(
      error,
      "Impossible d'enregistrer la décision d'approbation."
    );
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw badRequest("Impossible d'enregistrer la décision d'approbation.");
  }

  return row as unknown as EstimateApprovalRow;
}

async function findRuleForTenant(input: {
  context: AuthenticatedContext;
  ruleId: string;
}) {
  const { data, error } = await input.context.supabase
    .from("estimate_rules")
    .select(
      "id, created_at, updated_at, tenant_id, rule_type, scope_type, scope_id, threshold_value, action, is_active"
    )
    .eq("tenant_id", input.context.tenantId)
    .eq("id", input.ruleId)
    .single();

  if (error || !data) {
    throw notFound("Règle introuvable.");
  }

  return data as EstimateRuleRow;
}

async function findRulesForTenant(input: {
  context: AuthenticatedContext;
  ruleIds: string[];
}) {
  if (input.ruleIds.length === 0) {
    return [] as EstimateRuleRow[];
  }

  const { data, error } = await readAllRowsInChunks(input.ruleIds, (pageIds) => input.context.supabase
    .from("estimate_rules")
    .select(
      "id, created_at, updated_at, tenant_id, rule_type, scope_type, scope_id, threshold_value, action, is_active",
      { count: "exact" }
    )
    .eq("tenant_id", input.context.tenantId)
    .in("id", pageIds)
    .order("created_at", { ascending: true }), { order: [{ column: "created_at", ascending: true }] });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les règles ciblees.");
  }

  return (data ?? []) as EstimateRuleRow[];
}

async function findLatestApprovalForRule(input: {
  context: AuthenticatedContext;
  versionId: string;
  ruleId: string;
  status?: EstimateApprovalStatus;
}) {
  let query = input.context.supabase
    .from("estimate_approvals")
    .select(
      "id, created_at, updated_at, tenant_id, version_id, rule_id, requested_by, approved_by, status, decided_at, approved_content_revision, review_cycle_id, superseded_at"
    )
    .eq("tenant_id", input.context.tenantId)
    .eq("version_id", input.versionId)
    .eq("rule_id", input.ruleId)
    .is("superseded_at", null)
    .order("created_at", { ascending: false })
    .limit(1);

  if (input.status) {
    query = query.eq("status", input.status);
  }

  const { data, error } = await query;

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les approbations.");
  }

  const row = (data ?? [])[0] as EstimateApprovalRow | undefined;
  return row ?? null;
}

async function resolveAssignedReviewerOrThrow(input: {
  context: AuthenticatedContext;
  reviewerUserId: string | null;
}) {
  const availableReviewers = await listAvailableEstimateApprovalReviewers({
    context: input.context,
  });
  if (availableReviewers.length === 0) {
    throw badRequest("Aucun validateur n'est disponible pour ce tenant.");
  }

  if (!input.reviewerUserId) {
    return availableReviewers[0]!;
  }

  const assignedReviewer =
    availableReviewers.find((reviewer) => reviewer.userId === input.reviewerUserId) ?? null;
  if (!assignedReviewer) {
    throw badRequest("Le validateur assigné n'est pas autorisé dans cette organisation.");
  }

  return assignedReviewer;
}

type VersionApprovalAccess = { version: VersionAccessRow; project: EmbeddedApprovalProjectAccess };

type SubmitForReviewInput = Extract<SubmitEstimateApprovalInput, { action: "submit_for_review" }>;

type RequestRuleApprovalInput = Extract<SubmitEstimateApprovalInput, { action: "request" }>;

type DecideReviewCycleInput = Extract<SubmitEstimateApprovalInput, { action: "decide" }>;

type DecideApprovalInput = Extract<SubmitEstimateApprovalInput, { action: "approve" | "reject" }>;

type RequestedReviewRule = { ruleId: string; label: string };

function assertCanRequestApproval(input: {
  context: AuthenticatedContext;
  access: VersionApprovalAccess;
}) {
  assertRequesterRole(input.context);

  if (
    !canAccessOwnerResource({
      context: input.context,
      resourceUserId: input.access.project.user_id,
    })
  ) {
    throw forbidden("Action réservée au proprietaire du chiffrage.");
  }
}

/** Avant soumission d'une v2/v3, le moteur fige son snapshot ; la version est alors relue. */
async function freezeDraftSnapshotIfRequired(input: {
  context: AuthenticatedContext;
  versionId: string;
  access: VersionApprovalAccess;
}) {
  if (await freezeApprovalV2DraftIfRequired(input.context, input.access.version))
    return getVersionAccessOrThrow<VersionAccessRow, EmbeddedApprovalProjectAccess>(
      input.context.supabase, input.versionId, input.context, APPROVAL_VERSION_ACCESS
    );
  return input.access;
}

async function loadApprovalEvaluationSources(input: {
  context: AuthenticatedContext;
  versionId: string;
  access: VersionApprovalAccess;
}) {
  const items = await loadApprovalSummaryItems({
    context: input.context,
    versionId: input.versionId,
  });
  const fixedDiscountEvidence = await loadCanonicalFixedDiscountEvidence({
    supabase: input.context.supabase, tenantId: input.context.tenantId,
    projectUserId: input.access.project.user_id, authorizedVersion: input.access.version,
  });
  const v3MarginEvidence = await loadV3MarginEvidence({
    supabase: input.context.supabase, tenantId: input.context.tenantId,
    projectUserId: input.access.project.user_id, authorizedVersion: input.access.version,
  });
  return { items, fixedDiscountEvidence, v3MarginEvidence };
}

type ApprovalEvaluationSources = Awaited<ReturnType<typeof loadApprovalEvaluationSources>>;

function buildApprovalEvaluationInput(input: {
  context: AuthenticatedContext;
  access: VersionApprovalAccess;
  sources: ApprovalEvaluationSources;
}) {
  const { context, access, sources } = input;
  return {
    supabase: context.supabase,
    tenantId: context.tenantId,
    fixedDiscountEvidence: sources.fixedDiscountEvidence,
    v3MarginEvidence: sources.v3MarginEvidence,
    version: {
      id: access.version.id,
      project_id: access.version.project_id,
      total_ht_cents: access.version.total_ht_cents,
      margin_bp: access.version.margin_bp,
      margin_multiplier: access.version.margin_multiplier,
      margin_mode: access.version.margin_mode,
      discount_bp: access.version.discount_bp,
      discount_amount_cents: access.version.discount_amount_cents,
      gross_ht_cents: access.version.gross_ht_cents,
      discount_applied_cents: access.version.discount_applied_cents,
      tenant_id: access.version.tenant_id,
      status: access.version.status,
      updated_at: access.version.updated_at,
      calc_engine_version: access.version.calc_engine_version,
      content_revision: access.version.content_revision,
      calc_snapshot_content_revision:
        access.version.calc_snapshot_content_revision,
      calc_snapshot_context: access.version.calc_snapshot_context,
    },
    project: {
      id: access.project.id,
      client_name: access.project.client_name,
    },
    items: sources.items,
  };
}

/**
 * Le dernier cycle renvoyé en correction : refuse la resoumission tant qu'un de ses items reste à
 * traiter, sinon rend ses règles, reconduites dans la nouvelle revue.
 */
async function loadResubmissionSourceOrThrow(input: {
  context: AuthenticatedContext;
  versionId: string;
}) {
  const latestCycle = await findLatestReviewCycle({
    context: input.context,
    versionId: input.versionId,
  });
  const rejectedSourceCycle =
    latestCycle?.decision === "changes_requested" && latestCycle.decided_at
      ? latestCycle
      : null;
  let carriedOverRuleIds: string[] = [];

  if (rejectedSourceCycle) {
    const correctionRows = await listEstimateReviewCorrectionItems({
      context: input.context,
      versionId: input.versionId,
      cycleIds: [rejectedSourceCycle.id],
    });
    const hasPendingCorrections = correctionRows.some(
      (row) => row.status === "pending"
    );
    if (hasPendingCorrections) {
      throw badRequest("Tous les items de correction doivent être traités avant la resoumission.");
    }

    carriedOverRuleIds = await listRuleIdsForReviewCycle({
      context: input.context,
      versionId: input.versionId,
      cycleId: rejectedSourceCycle.id,
      requestedAt: rejectedSourceCycle.requested_at,
      decidedAt: rejectedSourceCycle.decided_at,
    });
  }

  return { rejectedSourceCycle, carriedOverRuleIds };
}

/**
 * Les règles soumises à la revue : celles que le résumé rend demandables (manquantes ou rejetées)
 * et celles reconduites du cycle renvoyé en correction, limitées aux règles demandées quand il y en a.
 */
async function resolveRequestedReviewRules(input: {
  context: AuthenticatedContext;
  ruleIds: string[];
  reasons: EstimateApprovalSummaryCore["reasons"];
  carriedOverRuleIds: string[];
}) {
  const requestedRuleIdSet = new Set(
    input.ruleIds
      .map((ruleId) => normalizeOptionalUuid(ruleId))
      .filter((ruleId): ruleId is string => ruleId !== null)
  );
  const currentRequestableReasons = input.reasons.filter(
    (reason) =>
      (reason.approvalStatus === "missing" || reason.approvalStatus === "rejected") &&
      (requestedRuleIdSet.size === 0 || requestedRuleIdSet.has(reason.ruleId))
  );

  const requestedRuleIds = [
    ...new Set([
      ...currentRequestableReasons.map((reason) => reason.ruleId),
      ...input.carriedOverRuleIds,
    ]),
  ].filter((ruleId) => requestedRuleIdSet.size === 0 || requestedRuleIdSet.has(ruleId));

  if (requestedRuleIds.length === 0) {
    throw badRequest("Aucune règle de validation ne peut être soumise.");
  }

  const requestableReasonByRuleId = new Map(
    currentRequestableReasons.map((reason) => [reason.ruleId, reason] as const)
  );
  const missingRuleIds = requestedRuleIds.filter(
    (ruleId) => !requestableReasonByRuleId.has(ruleId)
  );
  const carriedOverRules = await findRulesForTenant({
    context: input.context,
    ruleIds: missingRuleIds,
  });
  const carriedOverRuleById = new Map(
    carriedOverRules.map((rule) => [rule.id, rule] as const)
  );
  const requestedRules = requestedRuleIds.map((ruleId): RequestedReviewRule => {
    const activeReason = requestableReasonByRuleId.get(ruleId);
    if (activeReason) {
      return {
        ruleId,
        label: activeReason.label,
      };
    }

    const carriedOverRule = carriedOverRuleById.get(ruleId);
    return {
      ruleId,
      label: carriedOverRule
        ? resolveApprovalSummaryLabel(carriedOverRule.rule_type)
        : "Règle de validation",
    };
  });

  return requestedRules;
}

/** L'e-mail au validateur assigné ; son échec est journalisé sans annuler la soumission. */
async function emailAssignedReviewer(input: {
  context: AuthenticatedContext;
  access: VersionApprovalAccess;
  assignedReviewer: EstimateApprovalReviewer;
  recipientEmail: string;
  submissionMessage: string | null | undefined;
  requestedRules: RequestedReviewRule[];
}) {
  const { context, access, assignedReviewer } = input;
  try {
    const requesterProfile = await loadProfileIdentity({
      context,
      userId: context.userId,
    });
    await sendApprovalReviewRequestNotification({
      recipientEmail: input.recipientEmail,
      reviewerName: assignedReviewer.fullName,
      requesterName:
        requesterProfile.full_name?.trim() ||
        requesterProfile.work_email?.trim() ||
        `Utilisateur ${context.userId.slice(0, 8)}`,
      projectName:
        access.project.name?.trim() ||
        access.project.client_name?.trim() ||
        "Affaire",
      versionNumber: access.version.version_number,
      submissionMessage: input.submissionMessage?.trim() || null,
      ruleLabels: input.requestedRules.map((reason) => reason.label),
    });
  } catch (error) {
    console.error("Failed to send approval review request notification:", error);
  }
}

async function submitEstimateForReview(input: {
  context: AuthenticatedContext;
  access: VersionApprovalAccess;
  approvalInput: SubmitForReviewInput;
}): Promise<SubmitEstimateApprovalResult> {
  const { context, approvalInput } = input;
  assertCanRequestApproval({ context, access: input.access });

  const access = await freezeDraftSnapshotIfRequired({
    context,
    versionId: approvalInput.versionId,
    access: input.access,
  });
  const sources = await loadApprovalEvaluationSources({
    context,
    versionId: approvalInput.versionId,
    access,
  });
  const [summary, submissionReadiness, assignedReviewer] = await Promise.all([
    evaluateApprovalSummary(buildApprovalEvaluationInput({ context, access, sources })),
    evaluateSubmissionReadiness(buildApprovalEvaluationInput({ context, access, sources })),
    resolveAssignedReviewerOrThrow({
      context,
      reviewerUserId: normalizeOptionalUuid(approvalInput.assignedReviewerUserId ?? undefined),
    }),
  ]);

  if (submissionReadiness.blockers.length > 0) {
    throw badRequest("Des blocants restent à lever avant la soumission.");
  }

  const { rejectedSourceCycle, carriedOverRuleIds } = await loadResubmissionSourceOrThrow({
    context,
    versionId: approvalInput.versionId,
  });
  const requestedRules = await resolveRequestedReviewRules({
    context,
    ruleIds: approvalInput.ruleIds,
    reasons: summary.reasons,
    carriedOverRuleIds,
  });

  const submission = await openEstimateReviewCycle({
    versionId: approvalInput.versionId,
    tenantId: context.tenantId,
    actorUserId: context.userId,
    assignedReviewerId: assignedReviewer.userId,
    ruleIds: requestedRules.map((reason) => reason.ruleId),
    submissionMessage: approvalInput.submissionMessage ?? null,
    eventMetadata: {
      requestedRuleLabels: requestedRules.map((reason) => reason.label),
      assignedReviewerName: assignedReviewer.fullName,
      assignedReviewerEmail: assignedReviewer.workEmail,
      resubmissionOfCycleId: rejectedSourceCycle?.id ?? null,
      resubmissionOfCycleNumber: rejectedSourceCycle?.cycle_number ?? null,
      correctionChecklistCompleted: rejectedSourceCycle ? true : null,
      notificationChannels: {
        inApp: true,
        email: Boolean(assignedReviewer.workEmail),
      },
    } satisfies Json,
  });
  const latestApproval = submission.approvals.at(-1)!;

  if (submission.created && assignedReviewer.workEmail) {
    await emailAssignedReviewer({
      context,
      access,
      assignedReviewer,
      recipientEmail: assignedReviewer.workEmail,
      submissionMessage: approvalInput.submissionMessage,
      requestedRules,
    });
  }

  await syncEstimateApprovalSummary({
    context,
    version: access.version,
    project: access.project,
    trigger: "approval_request",
  });

  return {
    approval: latestApproval,
    cycle: {
      id: submission.cycle.id,
      cycleNumber: submission.cycle.cycle_number,
      requestedAt: submission.cycle.requested_at,
      submissionMessage: submission.cycle.submission_message,
      assignedReviewer,
    },
    requestedApprovalCount: requestedRules.length,
    requestedRuleIds: requestedRules.map((reason) => reason.ruleId),
  };
}

async function requestRuleApproval(input: {
  context: AuthenticatedContext;
  access: VersionApprovalAccess;
  approvalInput: RequestRuleApprovalInput;
}): Promise<SubmitEstimateApprovalResult> {
  const { context, approvalInput } = input;
  assertCanRequestApproval({ context, access: input.access });

  const ruleId = normalizeOptionalUuid(approvalInput.ruleId);
  if (!ruleId) {
    throw badRequest("rule_id est obligatoire pour une demande d'approbation.");
  }

  const rule = await findRuleForTenant({
    context,
    ruleId,
  });

  if (!rule.is_active) {
    throw badRequest("La règle ciblee est inactive.");
  }

  const access = await freezeDraftSnapshotIfRequired({
    context,
    versionId: approvalInput.versionId,
    access: input.access,
  });
  const assignedReviewer = await resolveAssignedReviewerOrThrow({
    context,
    reviewerUserId: null,
  });
  const submission = await openEstimateReviewCycle({
    versionId: approvalInput.versionId,
    tenantId: context.tenantId,
    actorUserId: context.userId,
    assignedReviewerId: assignedReviewer.userId,
    ruleIds: [ruleId],
    submissionMessage: null,
    eventMetadata: {
      requestedRuleLabels: [resolveApprovalSummaryLabel(rule.rule_type)],
      assignedReviewerName: assignedReviewer.fullName,
      assignedReviewerEmail: assignedReviewer.workEmail,
      notificationChannels: {
        inApp: true,
        email: false,
      },
    },
  });

  await syncEstimateApprovalSummary({
    context,
    version: access.version,
    project: access.project,
    trigger: "approval_request",
  });

  return {
    approval: submission.approvals[0]!,
  };
}

async function decideOpenReviewCycle(input: {
  context: AuthenticatedContext;
  access: VersionApprovalAccess;
  approvalInput: DecideReviewCycleInput;
}): Promise<SubmitEstimateApprovalResult> {
  const { context, access, approvalInput } = input;
  assertApproverRole(context);

  const activeCycle = await findOpenReviewCycle({
    context,
    versionId: approvalInput.versionId,
  });

  if (!activeCycle) {
    throw badRequest("Aucun cycle de revue actif n'est disponible.");
  }

  const pendingApprovals = await listPendingApprovalsForVersion({
    context,
    versionId: approvalInput.versionId,
  });

  if (pendingApprovals.length === 0) {
    throw badRequest("Aucune approbation en attente n'est disponible.");
  }

  const sources = await loadApprovalEvaluationSources({
    context,
    versionId: approvalInput.versionId,
    access,
  });
  const summary = await evaluateApprovalSummary(
    buildApprovalEvaluationInput({ context, access, sources })
  );
  const targetContext = await loadApprovalCommentTargetContext({
    context,
    versionId: approvalInput.versionId,
    projectId: access.project.id,
  });
  const commentTargets = buildEstimateReviewCommentTargets({
    project: access.project,
    items: sources.items,
    exceptions: targetContext.exceptions,
    hypotheses: targetContext.hypotheses,
    reasons: summary.reasons,
  });
  const normalizedComments = normalizeDecisionComments({
    decision: approvalInput.decision,
    comments: approvalInput.comments,
    targets: commentTargets,
  });
  const decidedAt = new Date().toISOString();
  const updatedApprovals = pendingApprovals.map((approval) => ({
    ...approval,
    status: resolveApprovalStatusFromReviewDecision(approvalInput.decision),
    approved_by: context.userId,
    decided_at: decidedAt,
    updated_at: decidedAt,
  }));
  await decideReviewCycleAtomically({
    context,
    cycleId: activeCycle.id,
    decision: approvalInput.decision,
    comments: normalizedComments,
  });

  await syncEstimateApprovalSummary({
    context,
    version: access.version,
    project: access.project,
    trigger: "approval_decision",
  });

  return {
    approval: updatedApprovals[0]!,
  };
}

/** La demande en attente que vise une décision unitaire : par son identifiant, sinon la dernière de la règle. */
async function findPendingApprovalToDecide(input: {
  context: AuthenticatedContext;
  versionId: string;
  ruleId: string | null;
  approvalId: string | null;
}) {
  const { context } = input;
  let targetApproval: EstimateApprovalRow | null = null;

  if (input.approvalId) {
    const { data, error } = await context.supabase
      .from("estimate_approvals")
      .select(
        "id, created_at, updated_at, tenant_id, version_id, rule_id, requested_by, approved_by, status, decided_at, approved_content_revision, review_cycle_id, superseded_at"
      )
      .eq("tenant_id", context.tenantId)
      .eq("version_id", input.versionId)
      .eq("id", input.approvalId)
      .is("superseded_at", null)
      .single();

    if (error || !data) {
      throw notFound("Demande d'approbation introuvable.");
    }

    targetApproval = data as EstimateApprovalRow;
  } else {
    if (!input.ruleId) {
      throw badRequest("rule_id ou approval_id est requis pour une décision.");
    }

    targetApproval = await findLatestApprovalForRule({
      context,
      versionId: input.versionId,
      ruleId: input.ruleId,
      status: "pending",
    });

    if (!targetApproval) {
      throw notFound("Aucune demande d'approbation en attente.");
    }
  }

  if (targetApproval.status !== "pending") {
    throw badRequest("La demande d'approbation n'est plus en attente.");
  }

  return targetApproval;
}

async function decidePendingApproval(input: {
  context: AuthenticatedContext;
  access: VersionApprovalAccess;
  approvalInput: DecideApprovalInput;
}): Promise<SubmitEstimateApprovalResult> {
  const { context, access, approvalInput } = input;
  assertApproverRole(context);

  const targetApproval = await findPendingApprovalToDecide({
    context,
    versionId: approvalInput.versionId,
    ruleId: normalizeOptionalUuid(approvalInput.ruleId),
    approvalId: normalizeOptionalUuid(approvalInput.approvalId),
  });

  const nextStatus: EstimateApprovalStatus =
    approvalInput.action === "approve" ? "approved" : "rejected";

  const data = await decideApprovalAtomically({
    context,
    approvalId: targetApproval.id,
    status: nextStatus,
  });

  await syncEstimateApprovalSummary({
    context,
    version: access.version,
    project: access.project,
    trigger: "approval_decision",
  });

  return {
    approval: data,
  };
}

export async function submitEstimateApproval(
  input: SubmitEstimateApprovalInput
): Promise<SubmitEstimateApprovalResult> {
  const context = await getAuthenticatedContext();
  const access = await getVersionAccessOrThrow<VersionAccessRow, EmbeddedApprovalProjectAccess>(
    context.supabase, input.versionId, context, APPROVAL_VERSION_ACCESS
  );

  if (input.action === "submit_for_review") {
    return submitEstimateForReview({ context, access, approvalInput: input });
  }

  if (input.action === "request") {
    return requestRuleApproval({ context, access, approvalInput: input });
  }

  if (input.action === "decide") {
    return decideOpenReviewCycle({ context, access, approvalInput: input });
  }

  return decidePendingApproval({ context, access, approvalInput: input });
}
