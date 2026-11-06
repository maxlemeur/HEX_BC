import type { SupabaseClient } from "@supabase/supabase-js";
import type { FixedDiscountVersion } from "@/lib/estimates/effective-discount";
import type { EstimateReadinessCategory } from "@/lib/estimates/readiness";
import type { Database, Json } from "@/types/database";

export type TenantRole = Database["public"]["Enums"]["tenant_role"];

export type EstimateVersionRow = Database["public"]["Tables"]["estimate_versions"]["Row"];

export type EstimateProjectRow = Database["public"]["Tables"]["estimate_projects"]["Row"];

export type EstimateItemRow = Database["public"]["Tables"]["estimate_items"]["Row"];

export type TenantMembershipAccessRow = Pick<
  Database["public"]["Tables"]["tenant_memberships"]["Row"],
  "tenant_id" | "user_id" | "role" | "is_default" | "created_at"
>;

export type EstimateRuleType = "min_margin" | "max_discount" | "require_approval";

export type ExtendedEstimateRuleType =
  | EstimateRuleType
  | "critical_exceptions_max"
  | "missing_line_evidence_max"
  | "dpgf_coverage_min"
  | "takeoff_evidence_coverage_min";

export type EstimateRuleScopeType = "global" | "category" | "client";

export type EstimateRuleAction = "warn" | "block" | "require_approval";

export type EstimateApprovalStatus = "pending" | "approved" | "rejected";

export type EstimateReviewDecision =
  | "approved"
  | "approved_with_reservations"
  | "changes_requested";

export type EstimateReviewCommentScope =
  | "project"
  | "lot"
  | "line"
  | "exception"
  | "hypothesis"
  | "approval_rule";

export type EstimateReviewCorrectionStatus =
  | "pending"
  | "corrected"
  | "to_discuss";

export type EstimateVersionApprovalStatus =
  Database["public"]["Enums"]["estimate_version_approval_status"];

export type EstimateRuleRow = Database["public"]["Tables"]["estimate_rules"]["Row"];

export type EstimateRuleInsert = Database["public"]["Tables"]["estimate_rules"]["Insert"];

export type EstimateRuleUpdate = Database["public"]["Tables"]["estimate_rules"]["Update"];

export type EstimateApprovalRow = {
  id: string;
  created_at: string;
  updated_at: string;
  tenant_id: string;
  version_id: string;
  rule_id: string;
  requested_by: string;
  approved_by: string | null;
  status: EstimateApprovalStatus;
  decided_at: string | null;
  approved_content_revision: number | string | null;
  review_cycle_id: string | null;
  superseded_at: string | null;
};

export type EstimateReviewCycleRow = {
  id: string;
  created_at: string;
  updated_at: string;
  tenant_id: string;
  version_id: string;
  cycle_number: number;
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decision: EstimateReviewDecision | null;
  decided_at: string | null;
  carried_over_from_cycle_id: string | null;
  submission_message: string | null;
  assigned_reviewer_id: string | null;
  requested_content_revision: number | string | null;
  superseded_at: string | null;
  superseded_by: string | null;
  superseded_by_cycle_id: string | null;
};

export type EstimateReviewCommentRow = {
  id: string;
  created_at: string;
  tenant_id: string;
  version_id: string;
  cycle_id: string;
  scope_type: EstimateReviewCommentScope;
  scope_id: string | null;
  scope_label: string;
  comment: string;
  created_by: string;
};

export type EstimateReviewCorrectionItemRow = {
  id: string;
  created_at: string;
  updated_at: string;
  tenant_id: string;
  version_id: string;
  cycle_id: string;
  source_comment_id: string;
  scope_type: EstimateReviewCommentScope;
  scope_id: string | null;
  scope_label: string;
  comment: string;
  status: EstimateReviewCorrectionStatus;
  last_treated_at: string | null;
  last_treated_by: string | null;
  last_treatment_note: string | null;
};

export type EstimateReviewCorrectionEventRow = {
  id: string;
  created_at: string;
  tenant_id: string;
  version_id: string;
  cycle_id: string;
  item_id: string;
  actor_user_id: string;
  previous_status: EstimateReviewCorrectionStatus;
  next_status: EstimateReviewCorrectionStatus;
  note: string | null;
};

export type EstimateRiskAlertTargetRow = {
  id: string;
  takeoff_job_id: string;
  line_id: string | null;
  lot_id: string | null;
  scope_type: "project" | "lot" | "line";
  scope_id: string | null;
  scope_label: string;
  severity: string;
  status: string;
  is_active: boolean;
};

export type AffaireRegisterHypothesisTargetRow = {
  id: string;
  project_id: string;
  version_id: string | null;
  kind: "assumption" | "missing_piece";
  text: string;
  scope_type: "project" | "lot" | "line" | "exception";
  scope_id: string | null;
  scope_label: string;
  severity: string;
  status: string;
  is_active: boolean;
};

export type EstimateAuditLogRow = {
  created_at: string;
  table_name: string;
  record_id: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  before_data: Json | null;
  after_data: Json | null;
};

export type DecideEstimateReviewCycleResult = {
  cycle_id: string;
  cycle_number: number;
  approval_ids: string[];
  rule_ids: string[];
  comment_count: number;
};

export type Supabase = SupabaseClient<Database>;

export type AuthenticatedContext = {
  supabase: Supabase;
  userId: string;
  tenantId: string;
  tenantRole: TenantRole;
};

export type EmbeddedProfileName = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "full_name"
>;

export type EmbeddedReviewerProfile = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "full_name" | "work_email"
>;

export type EmbeddedApprovalProjectAccess = Pick<
  EstimateProjectRow,
  "id" | "tenant_id" | "user_id" | "name" | "client_name"
>;

export type VersionAccessRow = Pick<
  EstimateVersionRow,
  | "id"
  | "tenant_id"
  | "status"
  | "updated_at"
  | "content_revision"
  | "calc_engine_version"
  | "calc_snapshot_content_revision"
  | "calc_snapshot_context"
  | "version_number"
  | "project_id"
  | "title"
  | "date_devis"
  | "validite_jours"
  | "total_ht_cents"
  | "margin_bp"
  | "global_coefficient"
  | "margin_multiplier"
  | "margin_mode"
  | "discount_bp"
  | "discount_amount_cents"
  | "currency"
  | "tax_rate_bp"
  | "rounding_mode"
  | "rounding_step_cents"
  | "approval_status"
  | "approval_summary"
  | "approval_evaluated_at"
  | "gross_ht_cents"
  | "discount_applied_cents"
> & {
  estimate_projects:
    | EmbeddedApprovalProjectAccess
    | EmbeddedApprovalProjectAccess[]
    | null;
};

export type EstimateReviewCycleWithProfilesRow = EstimateReviewCycleRow & {
  requested_by_profile: EmbeddedProfileName | EmbeddedProfileName[] | null;
  decided_by_profile: EmbeddedProfileName | EmbeddedProfileName[] | null;
  assigned_reviewer_profile: EmbeddedReviewerProfile | EmbeddedReviewerProfile[] | null;
};

export type EstimateReviewCommentWithProfilesRow = EstimateReviewCommentRow & {
  created_by_profile: EmbeddedProfileName | EmbeddedProfileName[] | null;
};

export type EstimateReviewCorrectionItemWithProfilesRow = EstimateReviewCorrectionItemRow & {
  last_treated_by_profile: EmbeddedProfileName | EmbeddedProfileName[] | null;
};

export type EstimateReviewCorrectionEventWithProfilesRow = EstimateReviewCorrectionEventRow & {
  actor_profile: EmbeddedProfileName | EmbeddedProfileName[] | null;
};

export type EstimateVersionEventAuthor = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "full_name"
>;

export type EstimateApprovalDecisionEventRow = Pick<
  Database["public"]["Tables"]["estimate_version_events"]["Row"],
  | "id"
  | "estimate_version_id"
  | "event_type"
  | "metadata"
  | "created_by"
  | "occurred_at"
  | "created_at"
> & {
  profiles: EstimateVersionEventAuthor | EstimateVersionEventAuthor[] | null;
};

export type RulesEngineVersion = Pick<
  EstimateVersionRow,
  "id" | "project_id" | "total_ht_cents"
> & FixedDiscountVersion & {
  margin_bp?: number | null;
  margin_multiplier?: number | null;
  discount_bp?: number | null;
  calc_engine_version?: number | null;
  content_revision?: number | string | null;
  calc_snapshot_content_revision?: number | string | null;
  calc_snapshot_context?: Json | null;
  margin_mode?: "fixed" | "tiered" | null;
};

export type RulesEngineProject = Pick<EstimateProjectRow, "id" | "client_name">;

export type RulesEngineItem = Pick<EstimateItemRow, "id" | "category_id">;

export type RulesEngineItemAccess = Pick<
  EstimateItemRow,
  "id" | "category_id"
> &
  Partial<Pick<EstimateItemRow, "item_type" | "title" | "parent_id" | "position">>;

export type RuleViolationSeverity = "blocking" | "warning";

export type EstimateRuleViolation = {
  rule_id: string;
  rule_type: ExtendedEstimateRuleType;
  scope_type: EstimateRuleScopeType;
  scope_id: string | null;
  threshold_value: number;
  action: EstimateRuleAction;
  severity: RuleViolationSeverity;
  metric_key:
    | "margin_bp"
    | "discount_bp"
    | "total_ht_cents"
    | "critical_exceptions_count"
    | "missing_line_evidence_count"
    | "dpgf_coverage_bp"
    | "takeoff_evidence_coverage_bp";
  actual_value: number;
  comparator: ">=" | "<=";
  approval_status: EstimateApprovalStatus | "missing" | null;
  approval_id: string | null;
  approval_created_at: string | null;
  approval_decided_at: string | null;
  source_state: "ready";
  message: string;
};

export type EstimateRuleUnavailableSignal = {
  rule_id: string;
  rule_type: ExtendedEstimateRuleType;
  scope_type: EstimateRuleScopeType;
  scope_id: string | null;
  threshold_value: number;
  action: EstimateRuleAction;
  metric_key:
    | "margin_bp"
    | "discount_bp"
    | "critical_exceptions_count"
    | "missing_line_evidence_count"
    | "dpgf_coverage_bp"
    | "takeoff_evidence_coverage_bp";
  comparator: ">=" | "<=";
  source_state: "unavailable";
  message: string;
};

export type EvaluateRulesResult = {
  violations: EstimateRuleViolation[];
  blockingViolations: EstimateRuleViolation[];
  warningViolations: EstimateRuleViolation[];
  unavailableSignals: EstimateRuleUnavailableSignal[];
};

export type EstimateRuleRecord = EstimateRuleRow;

export type EstimateApprovalDecisionCommentInput = {
  scopeType: EstimateReviewCommentScope;
  scopeId: string | null;
  comment: string;
};

export type SubmitEstimateApprovalAction =
  | "request"
  | "submit_for_review"
  | "approve"
  | "reject"
  | "decide";

export type SubmitEstimateApprovalInput =
  | {
      versionId: string;
      action: "submit_for_review";
      ruleIds: string[];
      submissionMessage?: string | null;
      assignedReviewerUserId?: string | null;
    }
  | {
      versionId: string;
      action: "request";
      ruleId: string;
    }
  | {
      versionId: string;
      action: "submit_for_review";
      ruleIds: string[];
      submissionMessage?: string;
      assignedReviewerUserId?: string | null;
    }
  | {
      versionId: string;
      action: "approve" | "reject";
      ruleId?: string;
      approvalId?: string;
    }
  | {
      versionId: string;
      action: "decide";
      decision: EstimateReviewDecision;
      comments: EstimateApprovalDecisionCommentInput[];
    };

export type SubmitEstimateApprovalResult = {
  approval: EstimateApprovalRow;
  cycle?: SubmitEstimateReviewRequestResult["cycle"];
  requestedApprovalCount?: number;
  requestedRuleIds?: string[];
};

export type SubmitEstimateReviewRequestInput = {
  versionId: string;
  submissionMessage?: string | null;
  assignedReviewerId?: string | null;
};

export type SubmitEstimateReviewRequestResult = {
  cycle: {
    id: string;
    cycleNumber: number;
    requestedAt: string;
    submissionMessage: string | null;
    assignedReviewer: EstimateApprovalReviewer;
  };
  requestedApprovalCount: number;
  requestedRuleIds: string[];
};

export type RuleCheckInput = {
  actualValue: number;
  threshold: number;
};

export type RuleCheckResult = {
  violated: boolean;
  actualValue: number;
  threshold: number;
};

export type RuleSignalContext = {
  criticalExceptionsCount: number | null;
  missingLineEvidenceCount: number | null;
  dpgfCoverageBp: number | null;
  takeoffEvidenceCoverageBp: number | null;
};

export type ApprovalSummaryReason = {
  ruleId: string;
  label: string;
  signalKey: EstimateRuleViolation["metric_key"];
  thresholdValue: number;
  actualValue: number | null;
  sourceState: "ready" | "unavailable";
  message: string;
  action: EstimateRuleAction;
  approvalStatus: EstimateRuleViolation["approval_status"] | null;
  approvalId: string | null;
  approvalCreatedAt: string | null;
  approvalDecidedAt: string | null;
};

export type EstimateApprovalCommentTarget = {
  scopeType: EstimateReviewCommentScope;
  scopeId: string | null;
  label: string;
};

export type EstimateApprovalCorrectionEvent = {
  id: string;
  previousStatus: EstimateReviewCorrectionStatus;
  nextStatus: EstimateReviewCorrectionStatus;
  note: string | null;
  createdAt: string;
  actorUserId: string;
  actorName: string | null;
};

export type EstimateApprovalCorrectionItem = {
  id: string;
  sourceCommentId: string;
  scopeType: EstimateReviewCommentScope;
  scopeId: string | null;
  scopeLabel: string;
  comment: string;
  status: EstimateReviewCorrectionStatus;
  href: string | null;
  lastTreatedAt: string | null;
  lastTreatedBy: string | null;
  lastTreatedByName: string | null;
  lastTreatmentNote: string | null;
  history: EstimateApprovalCorrectionEvent[];
};

export type EstimateApprovalCorrectionChecklist = {
  sourceCycleId: string;
  sourceCycleNumber: number;
  decisionAt: string;
  totalCount: number;
  pendingCount: number;
  correctedCount: number;
  toDiscussCount: number;
  allTreated: boolean;
  canResubmit: boolean;
  items: EstimateApprovalCorrectionItem[];
};

export type EstimateApprovalChangeField = {
  field: string;
  label: string;
  before: string;
  after: string;
};

export type EstimateApprovalChangesSinceLastCycle = {
  sourceCycleId: string;
  sourceCycleNumber: number;
  decidedAt: string;
  treatedItemsCount: number;
  toDiscussCount: number;
  totalHtDeltaCents: number | null;
  addedLotsCount: number;
  updatedLotsCount: number;
  removedLotsCount: number;
  addedLinesCount: number;
  updatedLinesCount: number;
  removedLinesCount: number;
  touchedLabels: string[];
  settingsChanges: EstimateApprovalChangeField[];
};

export type EstimateApprovalReviewComment = {
  id: string;
  scopeType: EstimateReviewCommentScope;
  scopeId: string | null;
  scopeLabel: string;
  comment: string;
  createdAt: string;
  createdBy: string;
  authorName: string | null;
};

export type EstimateApprovalReviewer = {
  userId: string;
  fullName: string;
  workEmail: string | null;
};

export type EstimateApprovalReviewCycle = {
  id: string;
  cycleNumber: number;
  requestedAt: string;
  requestedBy: string;
  requesterName: string | null;
  decision: EstimateReviewDecision;
  decidedAt: string;
  decidedBy: string;
  deciderName: string | null;
  carriedOverFromCycleId: string | null;
  submissionMessage: string | null;
  assignedReviewer: EstimateApprovalReviewer | null;
  comments: EstimateApprovalReviewComment[];
};

export type EstimateApprovalSubmissionSignal = {
  id: string;
  label: string;
  message: string;
  category?: EstimateReadinessCategory;
  actionLabel?: string;
  actionHref?: string;
};

export type EstimateApprovalSummaryCore = {
  approvalStatus: EstimateVersionApprovalStatus;
  requiresApproval: boolean;
  evaluatedAt: string;
  reasons: ApprovalSummaryReason[];
  latestDecision: {
    approvalId: string | null;
    status: EstimateApprovalStatus;
    decidedAt: string | null;
    createdAt: string;
    decision: EstimateReviewDecision | null;
    cycleId: string | null;
    cycleNumber: number | null;
    commentCount: number;
  } | null;
  unavailableSignals: string[];
};

export type EstimateApprovalSummary = EstimateApprovalSummaryCore & {
  permissions: {
    canPrepareRequest: boolean;
    canRequest: boolean;
    canDecide: boolean;
  };
  activeCycle: {
    id: string;
    cycleNumber: number;
    requestedAt: string;
    requestedBy: string;
    requesterName: string | null;
    pendingApprovalCount: number;
    submissionMessage: string | null;
    assignedReviewer: EstimateApprovalReviewer | null;
    carriedOverFromCycleId: string | null;
  } | null;
  reviewHistory: EstimateApprovalReviewCycle[];
  availableReviewers: EstimateApprovalReviewer[];
  submissionReadiness: {
    blockers: EstimateApprovalSubmissionSignal[];
    alerts: EstimateApprovalSubmissionSignal[];
  };
  correctionChecklist: EstimateApprovalCorrectionChecklist | null;
  changesSinceLastCycle: EstimateApprovalChangesSinceLastCycle | null;
  commentTargets: {
    project: EstimateApprovalCommentTarget;
    lots: EstimateApprovalCommentTarget[];
    lines: EstimateApprovalCommentTarget[];
    exceptions: EstimateApprovalCommentTarget[];
    hypotheses: EstimateApprovalCommentTarget[];
    approvalRules: EstimateApprovalCommentTarget[];
  };
};

export type ApprovalAuditTrigger = "read" | "approval_request" | "approval_decision";

export type EstimateRulesWithApprovals = {
  rules: EstimateRuleRow[];
  approvals: EstimateApprovalRow[];
};

export type NormalizedDecisionComment = {
  scopeType: EstimateReviewCommentScope;
  scopeId: string | null;
  scopeLabel: string;
  comment: string;
};
