import type { EstimateItemRow, TenantMembershipAccessRow, EstimateApprovalStatus, EstimateReviewDecision, EstimateReviewCorrectionStatus, EstimateApprovalRow, EstimateReviewCycleRow, EstimateRiskAlertTargetRow, AffaireRegisterHypothesisTargetRow, AuthenticatedContext, EmbeddedReviewerProfile, EmbeddedApprovalProjectAccess, VersionAccessRow, EstimateReviewCycleWithProfilesRow, EstimateReviewCommentWithProfilesRow, EstimateReviewCorrectionItemWithProfilesRow, EstimateReviewCorrectionEventWithProfilesRow, RulesEngineItemAccess, ApprovalSummaryReason, EstimateApprovalCorrectionEvent, EstimateApprovalCorrectionItem, EstimateApprovalReviewComment, EstimateApprovalReviewer, EstimateApprovalReviewCycle, EstimateApprovalSummary } from "@/lib/estimates/approval-types";
import { readAllRows, readAllRowsInChunks } from "@/lib/supabase/read-all";
import { createOptionalServiceRoleClient } from "@/lib/supabase/service-role";
import { computeEstimateItemNumbering } from "@/lib/estimates/numbering";
import { badRequest, forbidden, mapSupabaseError, notFound } from "@/lib/http/api-response";
import { resolveEmbeddedOne } from "@/lib/supabase/embedded";
import {
  ESTIMATE_APPROVAL_ROLES,
  getAuthenticatedContext,
  getVersionAccessOrThrow,
} from "@/lib/estimates/server-context";
import { APPROVAL_VERSION_ACCESS } from "@/lib/estimates/approval-version-access";

export function normalizeReviewCycle(
  row: EstimateReviewCycleWithProfilesRow
): Omit<EstimateApprovalReviewCycle, "comments"> {
  const assignedReviewerProfile = resolveEmbeddedOne(row.assigned_reviewer_profile);

  return {
    id: row.id,
    cycleNumber: row.cycle_number,
    requestedAt: row.requested_at,
    requestedBy: row.requested_by,
    requesterName: resolveEmbeddedOne(row.requested_by_profile)?.full_name ?? null,
    decision: row.decision!,
    decidedAt: row.decided_at!,
    decidedBy: row.decided_by!,
    deciderName: resolveEmbeddedOne(row.decided_by_profile)?.full_name ?? null,
    carriedOverFromCycleId: row.carried_over_from_cycle_id,
    submissionMessage: row.submission_message,
    assignedReviewer: assignedReviewerProfile
      ? {
          userId: assignedReviewerProfile.id,
          fullName:
            assignedReviewerProfile.full_name?.trim() || "Validateur",
          workEmail: assignedReviewerProfile.work_email ?? null,
        }
      : null,
  };
}

export function normalizeAssignedReviewer(
  row: Pick<EstimateReviewCycleWithProfilesRow, "assigned_reviewer_profile">
) {
  const assignedReviewerProfile = resolveEmbeddedOne(row.assigned_reviewer_profile);
  return assignedReviewerProfile
    ? {
        userId: assignedReviewerProfile.id,
        fullName: assignedReviewerProfile.full_name?.trim() || "Validateur",
        workEmail: assignedReviewerProfile.work_email ?? null,
      }
    : null;
}

export function normalizeReviewComment(
  row: EstimateReviewCommentWithProfilesRow
): EstimateApprovalReviewComment {
  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    scopeLabel: row.scope_label,
    comment: row.comment,
    createdAt: row.created_at,
    createdBy: row.created_by,
    authorName: resolveEmbeddedOne(row.created_by_profile)?.full_name ?? null,
  };
}

export function normalizeReviewCorrectionEvent(
  row: EstimateReviewCorrectionEventWithProfilesRow
): EstimateApprovalCorrectionEvent {
  return {
    id: row.id,
    previousStatus: row.previous_status,
    nextStatus: row.next_status,
    note: row.note,
    createdAt: row.created_at,
    actorUserId: row.actor_user_id,
    actorName: resolveEmbeddedOne(row.actor_profile)?.full_name ?? null,
  };
}

export function normalizeReviewCorrectionItem(input: {
  row: EstimateReviewCorrectionItemWithProfilesRow;
  href: string | null;
  history: EstimateApprovalCorrectionEvent[];
}): EstimateApprovalCorrectionItem {
  return {
    id: input.row.id,
    sourceCommentId: input.row.source_comment_id,
    scopeType: input.row.scope_type,
    scopeId: input.row.scope_id,
    scopeLabel: input.row.scope_label,
    comment: input.row.comment,
    status: input.row.status,
    href: input.href,
    lastTreatedAt: input.row.last_treated_at,
    lastTreatedBy: input.row.last_treated_by,
    lastTreatedByName:
      resolveEmbeddedOne(input.row.last_treated_by_profile)?.full_name ?? null,
    lastTreatmentNote: input.row.last_treatment_note,
    history: input.history,
  };
}

function normalizeAvailableReviewer(input: {
  membership: TenantMembershipAccessRow;
  profile: EmbeddedReviewerProfile | null;
}): EstimateApprovalReviewer {
  return {
    userId: input.membership.user_id,
    fullName:
      input.profile?.full_name?.trim() ||
      input.profile?.work_email?.trim() ||
      `Utilisateur ${input.membership.user_id.slice(0, 8)}`,
    workEmail: input.profile?.work_email ?? null,
  };
}

export async function listAvailableEstimateApprovalReviewers(input: {
  context: AuthenticatedContext;
}) {
  const reviewerClient = createOptionalServiceRoleClient() ?? input.context.supabase;
  const { data: membershipRows, error: membershipError } = await reviewerClient
    .from("tenant_memberships")
    .select("tenant_id, user_id, role, is_default, created_at")
    .eq("tenant_id", input.context.tenantId)
    .in("role", ESTIMATE_APPROVAL_ROLES.approve)
    .order("role", { ascending: true })
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });

  if (membershipError) {
    throw mapSupabaseError(
      membershipError,
      "Impossible de charger les validateurs disponibles."
    );
  }

  const memberships = (membershipRows ?? []) as TenantMembershipAccessRow[];
  if (memberships.length === 0) {
    return [] as EstimateApprovalReviewer[];
  }

  const reviewerUserIds = [...new Set(memberships.map((membership) => membership.user_id))];
  const { data: profileRows, error: profileError } = await reviewerClient
    .from("profiles")
    .select("id, full_name, work_email")
    .in("id", reviewerUserIds);

  if (profileError) {
    throw mapSupabaseError(
      profileError,
      "Impossible de charger les profils des validateurs."
    );
  }

  const profileById = new Map<string, EmbeddedReviewerProfile>();
  ((profileRows ?? []) as EmbeddedReviewerProfile[]).forEach((profile) => {
    profileById.set(profile.id, profile);
  });

  return memberships
    .filter(
      (membership, index, all) =>
        all.findIndex((candidate) => candidate.user_id === membership.user_id) === index
    )
    .map((membership) =>
      normalizeAvailableReviewer({
        membership,
        profile: profileById.get(membership.user_id) ?? null,
      })
    )
    .sort((left, right) => left.fullName.localeCompare(right.fullName));
}

export function buildEstimateReviewCommentTargets(input: {
  project: EmbeddedApprovalProjectAccess;
  items: RulesEngineItemAccess[];
  exceptions: EstimateRiskAlertTargetRow[];
  hypotheses: AffaireRegisterHypothesisTargetRow[];
  reasons: ApprovalSummaryReason[];
}): EstimateApprovalSummary["commentTargets"] {
  const titledItems = input.items.filter(
    (item): item is RulesEngineItemAccess & Required<Pick<EstimateItemRow, "title" | "position">> =>
      typeof item.title === "string" &&
      item.title.trim().length > 0 &&
      typeof item.position === "number" &&
      Number.isFinite(item.position)
  );
  const numberedItems = titledItems
    .filter(
      (item): item is typeof item & Required<Pick<EstimateItemRow, "item_type">> =>
        item.item_type === "section" || item.item_type === "line"
    )
    .map((item) => ({
      id: item.id,
      parent_id: item.parent_id ?? null,
      position: item.position,
      item_type: item.item_type,
    }));
  const numberingById = computeEstimateItemNumbering(numberedItems);
  const withLabel = (
    item: RulesEngineItemAccess & Required<Pick<EstimateItemRow, "title">>
  ) => {
    const prefix = numberingById[item.id];
    return prefix ? `${prefix} - ${item.title}` : item.title;
  };

  return {
    project: {
      scopeType: "project",
      scopeId: null,
      label: input.project.name ?? input.project.client_name ?? "Affaire",
    },
    lots: titledItems
      .filter((item) => item.item_type === "section")
      .sort((left, right) => left.position - right.position)
      .map((item) => ({
        scopeType: "lot" as const,
        scopeId: item.id,
        label: withLabel(item),
      })),
    lines: titledItems
      .filter((item) => item.item_type === "line")
      .sort((left, right) => left.position - right.position)
      .map((item) => ({
        scopeType: "line" as const,
        scopeId: item.id,
        label: withLabel(item),
      })),
    exceptions: input.exceptions
      .filter((entry) => entry.is_active)
      .sort((left, right) => left.scope_label.localeCompare(right.scope_label))
      .map((entry) => ({
        scopeType: "exception" as const,
        scopeId: entry.id,
        label: entry.scope_label,
      })),
    hypotheses: input.hypotheses
      .filter((entry) => entry.is_active && entry.kind === "assumption")
      .sort((left, right) => left.scope_label.localeCompare(right.scope_label))
      .map((entry) => ({
        scopeType: "hypothesis" as const,
        scopeId: entry.id,
        label: entry.text,
      })),
    approvalRules: input.reasons.map((reason) => ({
      scopeType: "approval_rule" as const,
      scopeId: reason.ruleId,
      label: reason.label,
    })),
  };
}

export function resolveApprovalStatusFromReviewDecision(
  decision: EstimateReviewDecision
): EstimateApprovalStatus {
  return decision === "changes_requested" ? "rejected" : "approved";
}

export async function listEstimateReviewCycles(input: {
  context: AuthenticatedContext;
  versionId: string;
}) {
  const { data, error } = await readAllRows(() => input.context.supabase
    .from("estimate_review_cycles")
    .select(
      ([
        "id",
        "created_at",
        "updated_at",
        "tenant_id",
        "version_id",
        "cycle_number",
        "requested_by",
        "requested_at",
        "submission_message",
        "assigned_reviewer_id",
        "decided_by",
        "decision",
        "decided_at",
        "carried_over_from_cycle_id",
        "requested_content_revision",
        "superseded_at",
        "superseded_by",
        "superseded_by_cycle_id",
        "requested_by_profile:requested_by(full_name)",
        "decided_by_profile:decided_by(full_name)",
        "assigned_reviewer_profile:assigned_reviewer_id(id, full_name, work_email)",
      ].join(", ") + ", id"),
      { count: "exact" }
    )
    .eq("tenant_id", input.context.tenantId)
    .eq("version_id", input.versionId)
    .order("cycle_number", { ascending: false }));

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les cycles de revue.");
  }

  return ((data ?? []) as unknown) as EstimateReviewCycleWithProfilesRow[];
}

export async function listEstimateReviewComments(input: {
  context: AuthenticatedContext;
  versionId: string;
  cycleIds: string[];
}) {
  if (input.cycleIds.length === 0) {
    return [] as EstimateReviewCommentWithProfilesRow[];
  }

  const { data, error } = await readAllRowsInChunks(input.cycleIds, (pageIds) => input.context.supabase
    .from("estimate_review_comments")
    .select(
      [
        "id",
        "created_at",
        "tenant_id",
        "version_id",
        "cycle_id",
        "scope_type",
        "scope_id",
        "scope_label",
        "comment",
        "created_by",
        "created_by_profile:created_by(full_name)",
      ].join(", "),
      { count: "exact" }
    )
    .eq("tenant_id", input.context.tenantId)
    .eq("version_id", input.versionId)
    .in("cycle_id", pageIds)
    .order("created_at", { ascending: true }), { order: [{ column: "created_at", ascending: true }] });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les commentaires de revue.");
  }

  return ((data ?? []) as unknown) as EstimateReviewCommentWithProfilesRow[];
}

export async function listEstimateReviewCorrectionItems(input: {
  context: AuthenticatedContext;
  versionId: string;
  cycleIds: string[];
}) {
  if (input.cycleIds.length === 0) {
    return [] as EstimateReviewCorrectionItemWithProfilesRow[];
  }

  const { data, error } = await readAllRowsInChunks(input.cycleIds, (pageIds) => input.context.supabase
    .from("estimate_review_correction_items")
    .select(
      ([
        "id",
        "created_at",
        "updated_at",
        "tenant_id",
        "version_id",
        "cycle_id",
        "source_comment_id",
        "scope_type",
        "scope_id",
        "scope_label",
        "comment",
        "status",
        "last_treated_at",
        "last_treated_by",
        "last_treatment_note",
        "last_treated_by_profile:last_treated_by(full_name)",
      ].join(", ") + ", id"),
      { count: "exact" }
    )
    .eq("tenant_id", input.context.tenantId)
    .eq("version_id", input.versionId)
    .in("cycle_id", pageIds)
    .order("created_at", { ascending: true }), { order: [{ column: "created_at", ascending: true }] });

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de charger la checklist de correction."
    );
  }

  return ((data ?? []) as unknown) as EstimateReviewCorrectionItemWithProfilesRow[];
}

export async function listEstimateReviewCorrectionEvents(input: {
  context: AuthenticatedContext;
  versionId: string;
  cycleIds: string[];
}) {
  if (input.cycleIds.length === 0) {
    return [] as EstimateReviewCorrectionEventWithProfilesRow[];
  }

  const { data, error } = await readAllRowsInChunks(input.cycleIds, (pageIds) => input.context.supabase
    .from("estimate_review_correction_events")
    .select(
      [
        "id",
        "created_at",
        "tenant_id",
        "version_id",
        "cycle_id",
        "item_id",
        "actor_user_id",
        "previous_status",
        "next_status",
        "note",
        "actor_profile:actor_user_id(full_name)",
      ].join(", "),
      { count: "exact" }
    )
    .eq("tenant_id", input.context.tenantId)
    .eq("version_id", input.versionId)
    .in("cycle_id", pageIds)
    .order("created_at", { ascending: true }), { order: [{ column: "created_at", ascending: true }] });

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de charger l'historique des corrections."
    );
  }

  return ((data ?? []) as unknown) as EstimateReviewCorrectionEventWithProfilesRow[];
}

export async function loadApprovalCommentTargetContext(input: {
  context: AuthenticatedContext;
  versionId: string;
  projectId: string;
}) {
  const [exceptionResult, hypothesisResult] = await Promise.all([
    readAllRows(() => input.context.supabase
      .from("estimate_risk_alerts")
      .select(
        "id, takeoff_job_id, line_id, lot_id, scope_type, scope_id, scope_label, severity, status, is_active",
        { count: "exact" }
      )
      .eq("tenant_id", input.context.tenantId)
      .eq("version_id", input.versionId)
      .eq("is_active", true)
      .order("scope_label", { ascending: true })),
    readAllRows(() => input.context.supabase
      .from("affaire_register_entries")
      .select(
        "id, project_id, version_id, kind, text, scope_type, scope_id, scope_label, severity, status, is_active",
        { count: "exact" }
      )
      .eq("tenant_id", input.context.tenantId)
      .eq("project_id", input.projectId)
      .eq("kind", "assumption")
      .eq("is_active", true)
      .order("updated_at", { ascending: false })),
  ]);

  if (exceptionResult.error) {
    throw mapSupabaseError(
      exceptionResult.error,
      "Impossible de charger les exceptions pour l'approbation."
    );
  }

  if (hypothesisResult.error) {
    throw mapSupabaseError(
      hypothesisResult.error,
      "Impossible de charger les hypothèses pour l'approbation."
    );
  }

  return {
    exceptions: (exceptionResult.data ?? []) as EstimateRiskAlertTargetRow[],
    hypotheses: (hypothesisResult.data ?? []) as AffaireRegisterHypothesisTargetRow[],
  };
}

export async function updateEstimateReviewCorrectionItemStatus(input: {
  versionId: string;
  itemId: string;
  status: Exclude<EstimateReviewCorrectionStatus, "pending">;
  note?: string | null;
}) {
  const context = await getAuthenticatedContext();
  const access = await getVersionAccessOrThrow<VersionAccessRow, EmbeddedApprovalProjectAccess>(
    context.supabase, input.versionId, context, APPROVAL_VERSION_ACCESS
  );

  if (access.project.user_id !== context.userId) {
    throw forbidden("Action réservée au proprietaire du chiffrage.");
  }

  const { data, error } = await context.supabase.rpc(
    "record_estimate_review_correction_action",
    {
      p_item_id: input.itemId,
      p_status: input.status,
      p_note: input.note?.trim() || null,
    }
  );

  if (error) {
    if (error.message.includes("ESTIMATE_REVIEW_CORRECTION_OWNER_REQUIRED")) {
      throw forbidden("Action réservée au proprietaire du chiffrage.");
    }

    if (error.message.includes("ESTIMATE_REVIEW_CORRECTION_STATUS_UNCHANGED")) {
      throw badRequest("Le statut de correction est déjà appliqué.");
    }

    if (error.message.includes("ESTIMATE_REVIEW_CORRECTION_ITEM_NOT_FOUND")) {
      throw notFound("Élément de correction introuvable.");
    }

    throw mapSupabaseError(
      error,
      "Impossible d'enregistrer le traitement de correction."
    );
  }

  const row = Array.isArray(data)
    ? (data[0] as
        | {
            item_id?: string;
            cycle_id?: string;
            version_id?: string;
            status?: EstimateReviewCorrectionStatus;
            treated_at?: string;
          }
        | undefined)
    : undefined;

  if (!row?.item_id) {
    throw badRequest("Impossible d'enregistrer le traitement de correction.");
  }

  return {
    itemId: row.item_id,
    cycleId: row.cycle_id ?? null,
    versionId: row.version_id ?? input.versionId,
    status: row.status ?? input.status,
    treatedAt: row.treated_at ?? new Date().toISOString(),
  };
}

export async function findOpenReviewCycle(input: {
  context: AuthenticatedContext;
  versionId: string;
}) {
  const { data, error } = await input.context.supabase
    .from("estimate_review_cycles")
    .select(
      "id, created_at, updated_at, tenant_id, version_id, cycle_number, requested_by, requested_at, submission_message, assigned_reviewer_id, decided_by, decision, decided_at, carried_over_from_cycle_id, requested_content_revision, superseded_at, superseded_by, superseded_by_cycle_id"
    )
    .eq("tenant_id", input.context.tenantId)
    .eq("version_id", input.versionId)
    .is("decision", null)
    .is("superseded_at", null)
    .order("cycle_number", { ascending: false })
    .limit(1);

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger le cycle de revue actif.");
  }

  return ((data ?? [])[0] as EstimateReviewCycleRow | undefined) ?? null;
}

export async function findLatestReviewCycle(input: {
  context: AuthenticatedContext;
  versionId: string;
}) {
  const { data, error } = await input.context.supabase
    .from("estimate_review_cycles")
    .select(
      "id, created_at, updated_at, tenant_id, version_id, cycle_number, requested_by, requested_at, submission_message, assigned_reviewer_id, decided_by, decision, decided_at, carried_over_from_cycle_id, requested_content_revision, superseded_at, superseded_by, superseded_by_cycle_id"
    )
    .eq("tenant_id", input.context.tenantId)
    .eq("version_id", input.versionId)
    .order("cycle_number", { ascending: false })
    .limit(1);

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger l'historique de revue.");
  }

  return ((data ?? [])[0] as EstimateReviewCycleRow | undefined) ?? null;
}

export async function listPendingApprovalsForVersion(input: {
  context: AuthenticatedContext;
  versionId: string;
}) {
  const { data, error } = await readAllRows(() => input.context.supabase
    .from("estimate_approvals")
    .select(
      "id, created_at, updated_at, tenant_id, version_id, rule_id, requested_by, approved_by, status, decided_at, approved_content_revision, review_cycle_id, superseded_at",
      { count: "exact" }
    )
    .eq("tenant_id", input.context.tenantId)
    .eq("version_id", input.versionId)
    .eq("status", "pending")
    .is("superseded_at", null)
    .order("created_at", { ascending: true }));

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les approbations en attente.");
  }

  return (data ?? []) as EstimateApprovalRow[];
}

async function listApprovalsForReviewCycle(input: {
  context: AuthenticatedContext;
  versionId: string;
  cycleId: string;
  requestedAt: string;
  decidedAt?: string | null;
}) {
  const selection =
    "id, created_at, updated_at, tenant_id, version_id, rule_id, requested_by, approved_by, status, decided_at, approved_content_revision, review_cycle_id, superseded_at";
  const linkedResult = await readAllRows(() => input.context.supabase
    .from("estimate_approvals")
    .select(selection, { count: "exact" })
    .eq("tenant_id", input.context.tenantId)
    .eq("version_id", input.versionId)
    .eq("review_cycle_id", input.cycleId)
    .order("created_at", { ascending: false }));

  if (linkedResult.error) {
    throw mapSupabaseError(
      linkedResult.error,
      "Impossible de charger les approbations du cycle de revue."
    );
  }

  if ((linkedResult.data ?? []).length > 0) {
    return (linkedResult.data ?? []) as EstimateApprovalRow[];
  }

  // Compatibility for cycles created before review_cycle_id existed. A
  // temporal window is used only when no governed linked row exists.
  let legacyQuery = input.context.supabase
    .from("estimate_approvals")
    .select(selection, { count: "exact" })
    .eq("tenant_id", input.context.tenantId)
    .eq("version_id", input.versionId)
    .is("review_cycle_id", null)
    .gte("created_at", input.requestedAt)
    .order("created_at", { ascending: false });

  if (input.decidedAt) {
    legacyQuery = legacyQuery.lte("created_at", input.decidedAt);
  }

  const legacyResult = await readAllRows(() => legacyQuery);
  if (legacyResult.error) {
    throw mapSupabaseError(
      legacyResult.error,
      "Impossible de charger les approbations historiques du cycle de revue."
    );
  }

  return (legacyResult.data ?? []) as EstimateApprovalRow[];
}

export async function listRuleIdsForReviewCycle(input: {
  context: AuthenticatedContext;
  versionId: string;
  cycleId: string;
  requestedAt: string;
  decidedAt?: string | null;
}) {
  const approvals = await listApprovalsForReviewCycle(input);
  return [...new Set(approvals.map((approval) => approval.rule_id))];
}
