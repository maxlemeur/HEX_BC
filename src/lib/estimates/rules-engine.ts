import type { SupabaseClient } from "@supabase/supabase-js";

import { buildAffaireRegisterHubHref } from "@/lib/affaires/register";
import { createOptionalServiceRoleClient } from "@/lib/supabase/service-role";
import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import {
  buildAffaireRegisterSubmissionSignalMessage,
  fetchAffaireRegisterGateSummary,
} from "@/lib/affaires/register-server";
import { sendApprovalReviewRequestNotification } from "@/lib/email/send-approval-review-request";
import { freezeApprovalV2DraftIfRequired } from "@/lib/estimates/approval-v2-snapshot";
import { openEstimateReviewCycle } from "@/lib/estimates/review-cycle-submission";
import { resolveEffectiveMarginBp } from "@/lib/estimates/effective-margin";
import type { EstimateReadinessCategory } from "@/lib/estimates/readiness";
import { fetchVersionZeroDraftSummary } from "@/lib/estimates/version-zero-drafts";
import {
  normalizeEstimateApprovalDecision,
  resolveApprovalDecisionOutcome,
  type EstimateApprovalDecisionComment,
  type EstimateApprovalDecisionEvent,
  type EstimateApprovalDecisionFilter,
  type EstimateApprovalDecisionJournal,
  type EstimateApprovalDecisionRule,
  type EstimateApprovalDecisionScope,
} from "@/lib/estimates/approval-decision-journal";
import type { Database, Json } from "@/types/database";
import { computeEstimateItemNumbering } from "@/lib/estimates/numbering";

import { badRequest, conflict, forbidden, mapSupabaseError, notFound } from "./errors";

type TenantRole = Database["public"]["Enums"]["tenant_role"];
type EstimateVersionRow = Database["public"]["Tables"]["estimate_versions"]["Row"];
type EstimateProjectRow = Database["public"]["Tables"]["estimate_projects"]["Row"];
type EstimateItemRow = Database["public"]["Tables"]["estimate_items"]["Row"];
type TenantMembershipAccessRow = Pick<
  Database["public"]["Tables"]["tenant_memberships"]["Row"],
  "tenant_id" | "user_id" | "role" | "is_default" | "created_at"
>;

type EstimateRuleType = "min_margin" | "max_discount" | "require_approval";
type ExtendedEstimateRuleType =
  | EstimateRuleType
  | "critical_exceptions_max"
  | "missing_line_evidence_max"
  | "dpgf_coverage_min"
  | "takeoff_evidence_coverage_min";
type EstimateRuleScopeType = "global" | "category" | "client";
type EstimateRuleAction = "warn" | "block" | "require_approval";
type EstimateApprovalStatus = "pending" | "approved" | "rejected";
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

type EstimateRuleRow = {
  id: string;
  created_at: string;
  updated_at: string;
  tenant_id: string;
  rule_type: ExtendedEstimateRuleType;
  scope_type: EstimateRuleScopeType;
  scope_id: string | null;
  threshold_value: number;
  action: EstimateRuleAction;
  is_active: boolean;
};

type EstimateRuleInsert = {
  id?: string;
  created_at?: string;
  updated_at?: string;
  tenant_id?: string;
  rule_type: ExtendedEstimateRuleType;
  scope_type?: EstimateRuleScopeType;
  scope_id?: string | null;
  threshold_value: number;
  action: EstimateRuleAction;
  is_active?: boolean;
};

type EstimateRuleUpdate = Partial<EstimateRuleInsert>;

type EstimateApprovalRow = {
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

type EstimateApprovalUpdate = Partial<EstimateApprovalRow>;

type EstimateReviewCycleRow = {
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

type EstimateReviewCycleUpdate = Partial<EstimateReviewCycleRow>;

type EstimateReviewCommentRow = {
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

type EstimateReviewCommentInsert = {
  id?: string;
  created_at?: string;
  tenant_id?: string;
  version_id: string;
  cycle_id: string;
  scope_type: EstimateReviewCommentScope;
  scope_id?: string | null;
  scope_label: string;
  comment: string;
  created_by: string;
};

type EstimateReviewCorrectionItemRow = {
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

type EstimateReviewCorrectionEventRow = {
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

type EstimateRiskAlertTargetRow = {
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

type AffaireRegisterHypothesisTargetRow = {
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

type EstimateAuditLogRow = {
  created_at: string;
  table_name: string;
  record_id: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  before_data: Json | null;
  after_data: Json | null;
};

type DecideEstimateReviewCycleResult = {
  cycle_id: string;
  cycle_number: number;
  approval_ids: string[];
  rule_ids: string[];
  comment_count: number;
};

type EstimateRulesTable = {
  Row: EstimateRuleRow;
  Insert: EstimateRuleInsert;
  Update: EstimateRuleUpdate;
  Relationships: [];
};

type EstimateApprovalsTable = {
  Row: EstimateApprovalRow;
  Insert: never;
  Update: EstimateApprovalUpdate;
  Relationships: [];
};

type EstimateReviewCyclesTable = {
  Row: EstimateReviewCycleRow;
  Insert: never;
  Update: EstimateReviewCycleUpdate;
  Relationships: [];
};

type EstimateReviewCommentsTable = {
  Row: EstimateReviewCommentRow;
  Insert: EstimateReviewCommentInsert;
  Update: Partial<EstimateReviewCommentInsert>;
  Relationships: [];
};

type DatabaseWithRules = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Database["public"]["Tables"] & {
      estimate_rules: EstimateRulesTable;
      estimate_approvals: EstimateApprovalsTable;
      estimate_review_cycles: EstimateReviewCyclesTable;
      estimate_review_comments: EstimateReviewCommentsTable;
    };
  };
};

type Supabase = SupabaseClient<DatabaseWithRules>;

type AuthenticatedContext = {
  supabase: Supabase;
  userId: string;
  tenantId: string;
  tenantRole: TenantRole;
};

async function getAuthenticatedContext(): Promise<AuthenticatedContext> {
  const context = await getAuthenticatedTenantContext();

  return {
    supabase: context.supabase as unknown as Supabase,
    userId: context.userId,
    tenantId: context.tenantId,
    tenantRole: context.tenantRole,
  };
}

type EmbeddedProfileName = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "full_name"
>;
type EmbeddedReviewerProfile = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "full_name" | "work_email"
>;

type EmbeddedApprovalProjectAccess = Pick<
  EstimateProjectRow,
  "id" | "tenant_id" | "user_id" | "name" | "client_name"
>;

type VersionAccessRow = Pick<
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
  | "tax_rate_bp"
  | "rounding_mode"
  | "rounding_step_cents"
  | "approval_status"
  | "approval_summary"
  | "approval_evaluated_at"
> & {
  estimate_projects:
    | EmbeddedApprovalProjectAccess
    | EmbeddedApprovalProjectAccess[]
    | null;
};

type EstimateReviewCycleWithProfilesRow = EstimateReviewCycleRow & {
  requested_by_profile: EmbeddedProfileName | EmbeddedProfileName[] | null;
  decided_by_profile: EmbeddedProfileName | EmbeddedProfileName[] | null;
  assigned_reviewer_profile: EmbeddedReviewerProfile | EmbeddedReviewerProfile[] | null;
};

type EstimateReviewCommentWithProfilesRow = EstimateReviewCommentRow & {
  created_by_profile: EmbeddedProfileName | EmbeddedProfileName[] | null;
};

type EstimateReviewCorrectionItemWithProfilesRow = EstimateReviewCorrectionItemRow & {
  last_treated_by_profile: EmbeddedProfileName | EmbeddedProfileName[] | null;
};

type EstimateReviewCorrectionEventWithProfilesRow = EstimateReviewCorrectionEventRow & {
  actor_profile: EmbeddedProfileName | EmbeddedProfileName[] | null;
};

type EstimateVersionEventAuthor = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "full_name"
>;

type EstimateApprovalDecisionEventRow = Pick<
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

const TENANT_ADMIN_ROLE: TenantRole = "admin";
const TENANT_DIRECTOR_ROLE: TenantRole = "director";

export type RulesEngineVersion = Pick<
  EstimateVersionRow,
  "id" | "project_id" | "total_ht_cents"
> & {
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

type RuleCheckInput = {
  actualValue: number;
  threshold: number;
};

type RuleCheckResult = {
  violated: boolean;
  actualValue: number;
  threshold: number;
};

type RuleSignalContext = {
  criticalExceptionsCount: number | null;
  missingLineEvidenceCount: number | null;
  dpgfCoverageBp: number | null;
  takeoffEvidenceCoverageBp: number | null;
};

type ApprovalSummaryReason = {
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

type EstimateApprovalSummaryCore = {
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

type ApprovalAuditTrigger = "read" | "approval_request" | "approval_decision";

function resolveEmbeddedOne<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

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

function toFiniteNumber(value: unknown, fallback = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

function normalizeThresholdValue(value: unknown) {
  const normalized = toFiniteNumber(value, NaN);
  if (!Number.isFinite(normalized)) {
    return null;
  }
  return normalized;
}

const PERCENT_FORMATTER = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const CURRENCY_FORMATTER = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function formatPercentBp(value: number) {
  return `${PERCENT_FORMATTER.format(value / 100)}%`;
}

function formatEuroCents(value: number) {
  return CURRENCY_FORMATTER.format(value / 100);
}

const APPROVAL_CHANGE_FIELD_LABELS: Record<string, string> = {
  margin_bp: "Marge",
  discount_bp: "Remise",
  validite_jours: "Validite",
  rounding_mode: "Mode d'arrondi",
  rounding_step_cents: "Pas d'arrondi",
  tax_rate_bp: "TVA",
  global_coefficient: "Coefficient global",
  margin_mode: "Mode de marge",
  margin_multiplier: "Coefficient de marge",
  title: "Titre du devis",
  date_devis: "Date du devis",
};

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
  const params = new URLSearchParams({
    versionId: input.versionId,
  });
  if (input.alert.line_id) {
    params.set("line", input.alert.line_id);
  }
  return `/dashboard/affaires/${input.projectId}/takeoff/${input.alert.takeoff_job_id}/review?${params.toString()}`;
}

function formatChangeFieldValue(input: {
  field: string;
  value: unknown;
}) {
  if (input.value === null || input.value === undefined) {
    return "-";
  }

  if (
    input.field === "margin_bp" ||
    input.field === "discount_bp" ||
    input.field === "tax_rate_bp"
  ) {
    return typeof input.value === "number" && Number.isFinite(input.value)
      ? formatPercentBp(input.value)
      : String(input.value);
  }

  if (
    input.field === "rounding_step_cents" ||
    input.field === "total_ht_cents" ||
    input.field === "discount_cents"
  ) {
    return typeof input.value === "number" && Number.isFinite(input.value)
      ? formatEuroCents(input.value)
      : String(input.value);
  }

  if (typeof input.value === "boolean") {
    return input.value ? "Oui" : "Non";
  }

  return String(input.value);
}

function toRulesSupabaseClient(
  supabase: SupabaseClient<Database> | Supabase
): Supabase {
  return supabase as unknown as Supabase;
}

function isTenantAdmin(tenantRole: TenantRole) {
  return tenantRole === TENANT_ADMIN_ROLE;
}

function isTenantDirector(tenantRole: TenantRole) {
  return tenantRole === TENANT_DIRECTOR_ROLE;
}

function isTenantApprover(tenantRole: TenantRole) {
  return isTenantAdmin(tenantRole) || isTenantDirector(tenantRole);
}

function canAccessOwnerResource(input: {
  context: Pick<AuthenticatedContext, "userId" | "tenantRole">;
  resourceUserId: string;
}) {
  return (
    input.resourceUserId === input.context.userId ||
    isTenantAdmin(input.context.tenantRole)
  );
}

function canAccessApprovalResource(input: {
  context: Pick<AuthenticatedContext, "userId" | "tenantRole">;
  resourceUserId: string;
}) {
  return (
    input.resourceUserId === input.context.userId ||
    isTenantApprover(input.context.tenantRole)
  );
}

function isRuleInScope(input: {
  rule: EstimateRuleRow;
  project: RulesEngineProject;
  categoryIdSet: Set<string>;
}) {
  const { rule, project, categoryIdSet } = input;

  if (rule.scope_type === "global") {
    return true;
  }

  if (rule.scope_type === "category") {
    return (
      typeof rule.scope_id === "string" &&
      rule.scope_id.length > 0 &&
      categoryIdSet.has(rule.scope_id)
    );
  }

  if (rule.scope_type === "client") {
    return (
      typeof rule.scope_id === "string" &&
      rule.scope_id.length > 0 &&
      rule.scope_id === project.id
    );
  }

  return false;
}

function isApprovalRule(rule: EstimateRuleRow) {
  return rule.action === "require_approval" || rule.rule_type === "require_approval";
}

function requiresTakeoffEvidenceCoverage(ruleType: ExtendedEstimateRuleType) {
  return ruleType === "takeoff_evidence_coverage_min";
}

function requiresDpgfCoverage(ruleType: ExtendedEstimateRuleType) {
  return ruleType === "dpgf_coverage_min";
}

function requiresUnavailableSignal(ruleType: ExtendedEstimateRuleType) {
  return (
    ruleType === "critical_exceptions_max" ||
    ruleType === "missing_line_evidence_max"
  );
}

async function resolveRelatedTakeoffJobIds(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
}) {
  const [directJobsResult, linkedJobsResult] = await Promise.all([
    input.supabase
      .from("takeoff_jobs" as never)
      .select("id" as never)
      .eq("tenant_id" as never, input.tenantId as never)
      .eq("estimate_version_id" as never, input.versionId as never),
    input.supabase
      .from("takeoff_version_links" as never)
      .select("takeoff_job_id" as never)
      .eq("tenant_id" as never, input.tenantId as never)
      .eq("target_version_id" as never, input.versionId as never),
  ]);

  if (directJobsResult.error) {
    throw mapSupabaseError(
      directJobsResult.error,
      "Impossible de charger les jobs takeoff de la version."
    );
  }

  if (linkedJobsResult.error) {
    throw mapSupabaseError(
      linkedJobsResult.error,
      "Impossible de charger les liens takeoff de la version."
    );
  }

  return Array.from(
    new Set(
      [
        ...((directJobsResult.data ?? []) as Array<{ id?: string | null }>).map(
          (row) => row.id ?? null
        ),
        ...((linkedJobsResult.data ?? []) as Array<{ takeoff_job_id?: string | null }>).map(
          (row) => row.takeoff_job_id ?? null
        ),
      ].filter((jobId): jobId is string => typeof jobId === "string" && jobId.length > 0)
    )
  );
}

async function loadRuleSignalContext(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
  lineItemIds: string[];
  rules: EstimateRuleRow[];
}): Promise<RuleSignalContext> {
  const shouldLoadUnavailableSignals = input.rules.some((rule) =>
    requiresUnavailableSignal(rule.rule_type)
  );
  const shouldLoadDpgfCoverage = input.rules.some((rule) =>
    requiresDpgfCoverage(rule.rule_type)
  );
  const shouldLoadTakeoffEvidenceCoverage = input.rules.some((rule) =>
    requiresTakeoffEvidenceCoverage(rule.rule_type)
  );

  const context: RuleSignalContext = {
    criticalExceptionsCount: shouldLoadUnavailableSignals ? null : null,
    missingLineEvidenceCount: shouldLoadUnavailableSignals ? null : null,
    dpgfCoverageBp: null,
    takeoffEvidenceCoverageBp: null,
  };

  if (!shouldLoadDpgfCoverage && !shouldLoadTakeoffEvidenceCoverage) {
    return context;
  }

  const relatedJobIds = await resolveRelatedTakeoffJobIds({
    supabase: input.supabase,
    tenantId: input.tenantId,
    versionId: input.versionId,
  });

  if (relatedJobIds.length === 0) {
    return context;
  }

  if (shouldLoadTakeoffEvidenceCoverage) {
    const { data, error } = await input.supabase
      .from("takeoff_items" as never)
      .select("id, evidence" as never)
      .eq("tenant_id" as never, input.tenantId as never)
      .in("job_id" as never, relatedJobIds as never);

    if (error) {
      throw mapSupabaseError(
        error,
        "Impossible de charger les preuves takeoff pour les regles d'approbation."
      );
    }

    const rows = (data ?? []) as Array<{ id?: string | null; evidence?: string | null }>;
    if (rows.length > 0) {
      const withEvidenceCount = rows.filter((row) => {
        const evidence = typeof row.evidence === "string" ? row.evidence.trim() : "";
        return evidence.length > 0;
      }).length;

      context.takeoffEvidenceCoverageBp = Math.round(
        (withEvidenceCount / rows.length) * 10000
      );
    }
  }

  if (shouldLoadDpgfCoverage && input.lineItemIds.length > 0) {
    const { data, error } = await input.supabase
      .from("takeoff_dpgf_links" as never)
      .select("estimate_item_id" as never)
      .eq("tenant_id" as never, input.tenantId as never)
      .eq("version_id" as never, input.versionId as never)
      .in("takeoff_job_id" as never, relatedJobIds as never);

    if (error) {
      throw mapSupabaseError(
        error,
        "Impossible de charger la couverture DPGF pour les regles d'approbation."
      );
    }

    const linkedItemIds = new Set(
      ((data ?? []) as Array<{ estimate_item_id?: string | null }>)
        .map((row) => row.estimate_item_id ?? null)
        .filter((itemId): itemId is string => typeof itemId === "string" && itemId.length > 0)
    );

    const linkedCount = input.lineItemIds.filter((itemId) => linkedItemIds.has(itemId)).length;
    context.dpgfCoverageBp = Math.round((linkedCount / input.lineItemIds.length) * 10000);
  }

  return context;
}

export function checkMarginRule(input: RuleCheckInput): RuleCheckResult {
  const actualValue = Math.max(0, toFiniteNumber(input.actualValue));
  const threshold = Math.max(0, toFiniteNumber(input.threshold));
  return {
    violated: actualValue < threshold,
    actualValue,
    threshold,
  };
}

export function checkDiscountRule(input: RuleCheckInput): RuleCheckResult {
  const actualValue = Math.max(0, toFiniteNumber(input.actualValue));
  const threshold = Math.max(0, toFiniteNumber(input.threshold));
  return {
    violated: actualValue > threshold,
    actualValue,
    threshold,
  };
}

export function checkApprovalRule(input: RuleCheckInput): RuleCheckResult {
  const actualValue = Math.max(0, toFiniteNumber(input.actualValue));
  const threshold = Math.max(0, toFiniteNumber(input.threshold));
  return {
    violated: actualValue > threshold,
    actualValue,
    threshold,
  };
}

function resolveSeverityForRuleAction(action: EstimateRuleAction): RuleViolationSeverity {
  if (action === "warn") return "warning";
  return "blocking";
}

function resolveMetricForRule(input: {
  rule: EstimateRuleRow;
  version: RulesEngineVersion;
  signalContext: RuleSignalContext;
}):
  | {
      metricKey: EstimateRuleViolation["metric_key"];
      check: RuleCheckResult;
      comparator: EstimateRuleViolation["comparator"];
      sourceState: "ready";
    }
  | {
      metricKey: EstimateRuleUnavailableSignal["metric_key"];
      comparator: EstimateRuleUnavailableSignal["comparator"];
      sourceState: "unavailable";
    }
  | null {
  const { rule, version, signalContext } = input;
  const thresholdValue = rule.threshold_value;

  if (rule.rule_type === "min_margin") {
    return {
      metricKey: "margin_bp",
      check: checkMarginRule({
        actualValue: resolveEffectiveMarginBp(version) ?? 0,
        threshold: thresholdValue,
      }),
      comparator: ">=",
      sourceState: "ready",
    };
  }

  if (rule.rule_type === "max_discount") {
    return {
      metricKey: "discount_bp",
      check: checkDiscountRule({
        actualValue: toFiniteNumber(version.discount_bp),
        threshold: thresholdValue,
      }),
      comparator: "<=",
      sourceState: "ready",
    };
  }

  if (rule.rule_type === "require_approval") {
    return {
      metricKey: "total_ht_cents",
      check: checkApprovalRule({
        actualValue: toFiniteNumber(version.total_ht_cents),
        threshold: thresholdValue,
      }),
      comparator: "<=",
      sourceState: "ready",
    };
  }

  if (rule.rule_type === "dpgf_coverage_min") {
    if (signalContext.dpgfCoverageBp === null) {
      return {
        metricKey: "dpgf_coverage_bp",
        comparator: ">=",
        sourceState: "unavailable",
      };
    }

    return {
      metricKey: "dpgf_coverage_bp",
      check: checkMarginRule({
        actualValue: signalContext.dpgfCoverageBp,
        threshold: thresholdValue,
      }),
      comparator: ">=",
      sourceState: "ready",
    };
  }

  if (rule.rule_type === "takeoff_evidence_coverage_min") {
    if (signalContext.takeoffEvidenceCoverageBp === null) {
      return {
        metricKey: "takeoff_evidence_coverage_bp",
        comparator: ">=",
        sourceState: "unavailable",
      };
    }

    return {
      metricKey: "takeoff_evidence_coverage_bp",
      check: checkMarginRule({
        actualValue: signalContext.takeoffEvidenceCoverageBp,
        threshold: thresholdValue,
      }),
      comparator: ">=",
      sourceState: "ready",
    };
  }

  if (rule.rule_type === "critical_exceptions_max") {
    return {
      metricKey: "critical_exceptions_count",
      comparator: "<=",
      sourceState: "unavailable",
    };
  }

  if (rule.rule_type === "missing_line_evidence_max") {
    return {
      metricKey: "missing_line_evidence_count",
      comparator: "<=",
      sourceState: "unavailable",
    };
  }

  return null;
}

function resolveViolationMessage(input: {
  rule: EstimateRuleRow;
  metricKey: EstimateRuleViolation["metric_key"];
  actualValue: number;
  thresholdValue: number;
  approvalStatus: EstimateRuleViolation["approval_status"];
}) {
  let base: string;

  if (input.rule.rule_type === "min_margin") {
    base = `Marge previsionnelle ${formatPercentBp(input.actualValue)} sous le seuil ${formatPercentBp(input.thresholdValue)}.`;
  } else if (input.rule.rule_type === "max_discount") {
    base = `Remise ${formatPercentBp(input.actualValue)} au-dessus du maximum ${formatPercentBp(input.thresholdValue)}.`;
  } else if (input.rule.rule_type === "require_approval") {
    base = `Montant HT ${formatEuroCents(input.actualValue)} au-dessus du seuil de validation ${formatEuroCents(input.thresholdValue)}.`;
  } else if (input.rule.rule_type === "dpgf_coverage_min") {
    base = `Couverture DPGF ${formatPercentBp(input.actualValue)} sous le minimum ${formatPercentBp(input.thresholdValue)}.`;
  } else if (input.rule.rule_type === "takeoff_evidence_coverage_min") {
    base = `Couverture preuves takeoff ${formatPercentBp(input.actualValue)} sous le minimum ${formatPercentBp(input.thresholdValue)}.`;
  } else if (input.rule.rule_type === "critical_exceptions_max") {
    base = `Exceptions critiques ${input.actualValue} au-dessus du maximum ${input.thresholdValue}.`;
  } else {
    base = `Lignes a enjeu sans preuve ${input.actualValue} au-dessus du maximum ${input.thresholdValue}.`;
  }

  if (input.approvalStatus === null) {
    return base;
  }

  if (input.approvalStatus === "missing") {
    return `${base} Approbation requise.`;
  }

  if (input.approvalStatus === "pending") {
    return `${base} Demande d'approbation en attente.`;
  }

  if (input.approvalStatus === "rejected") {
    return `${base} Demande d'approbation rejetee.`;
  }

  return `${base} Approbation enregistree.`;
}

function resolveUnavailableSignalMessage(input: {
  rule: EstimateRuleRow;
  metricKey: EstimateRuleUnavailableSignal["metric_key"];
}) {
  if (input.rule.rule_type === "critical_exceptions_max") {
    return "Signal indisponible: le comptage des exceptions critiques n'est pas encore stabilise pour cette version.";
  }

  if (input.rule.rule_type === "missing_line_evidence_max") {
    return "Signal indisponible: les lignes a enjeu sans preuve ne sont pas encore calculees de facon canonique.";
  }

  if (input.rule.rule_type === "dpgf_coverage_min") {
    return "Signal indisponible: aucune couverture DPGF exploitable n'est disponible pour cette version.";
  }

  return "Signal indisponible: aucune couverture de preuves takeoff exploitable n'est disponible pour cette version.";
}

function resolveLatestApprovalByRule(input: {
  approvals: EstimateApprovalRow[];
}) {
  const latestByRule = new Map<string, EstimateApprovalRow>();

  input.approvals.forEach((approval) => {
    if (!latestByRule.has(approval.rule_id)) {
      latestByRule.set(approval.rule_id, approval);
    }
  });

  return latestByRule;
}

async function loadCurrentEstimateContentRevision(input: {
  supabase: Supabase;
  versionId: string;
}) {
  const { data, error } = await input.supabase.rpc(
    "get_estimate_content_revision" as never,
    {
      p_version_id: input.versionId,
    } as never
  );

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de verifier la revision du devis."
    );
  }

  const revision = Number(data);
  if (!Number.isSafeInteger(revision) || revision <= 0) {
    throw badRequest("Impossible de verifier la revision du devis.");
  }

  return revision;
}

export async function evaluateRules(input: {
  supabase: SupabaseClient<Database> | Supabase;
  tenantId: string;
  version: RulesEngineVersion;
  project: RulesEngineProject;
  items: RulesEngineItemAccess[];
  preserveApprovedRequiresApproval?: boolean;
}): Promise<EvaluateRulesResult> {
  const supabase = toRulesSupabaseClient(input.supabase);

  const { data: rulesData, error: rulesError } = await supabase
    .from("estimate_rules")
    .select(
      "id, created_at, updated_at, tenant_id, rule_type, scope_type, scope_id, threshold_value, action, is_active"
    )
    .eq("tenant_id", input.tenantId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (rulesError) {
    throw mapSupabaseError(rulesError, "Impossible de charger les regles de devis.");
  }

  const rules = ((rulesData ?? []) as EstimateRuleRow[]).map((rule) => {
    const normalizedThreshold = normalizeThresholdValue(rule.threshold_value);
    return {
      ...rule,
      threshold_value: normalizedThreshold ?? 0,
    } satisfies EstimateRuleRow;
  });

  if (rules.length === 0) {
    return {
      violations: [],
      blockingViolations: [],
      warningViolations: [],
      unavailableSignals: [],
    };
  }

  const categoryIdSet = new Set<string>();
  const lineItemIds: string[] = [];
  input.items.forEach((item) => {
    if (item.item_type === "line") {
      lineItemIds.push(item.id);
    }
    const categoryId = item.category_id ?? null;
    if (typeof categoryId !== "string" || categoryId.length === 0) {
      return;
    }
    categoryIdSet.add(categoryId);
  });

  const signalContext = await loadRuleSignalContext({
    supabase,
    tenantId: input.tenantId,
    versionId: input.version.id,
    lineItemIds,
    rules,
  });

  const relevantRuleIds = rules.map((rule) => rule.id);
  const { data: approvalsData, error: approvalsError } = await supabase
    .from("estimate_approvals")
    .select(
      "id, created_at, updated_at, tenant_id, version_id, rule_id, requested_by, approved_by, status, decided_at, approved_content_revision, review_cycle_id, superseded_at"
    )
    .eq("tenant_id", input.tenantId)
    .eq("version_id", input.version.id)
    .in("rule_id", relevantRuleIds)
    .is("superseded_at", null)
    .order("created_at", { ascending: false });

  if (approvalsError) {
    throw mapSupabaseError(
      approvalsError,
      "Impossible de charger les approbations de devis."
    );
  }

  const latestApprovalByRule = resolveLatestApprovalByRule({
    approvals: (approvalsData ?? []) as EstimateApprovalRow[],
  });
  const needsApprovalFreshnessCheck =
    [...latestApprovalByRule.values()].some(
      (approval) => approval.status === "approved"
    );
  const currentContentRevision = needsApprovalFreshnessCheck
    ? await loadCurrentEstimateContentRevision({
        supabase,
        versionId: input.version.id,
      })
    : null;

  const violations: EstimateRuleViolation[] = [];
  const unavailableSignals: EstimateRuleUnavailableSignal[] = [];

  rules.forEach((rule) => {
    if (!isRuleInScope({ rule, project: input.project, categoryIdSet })) {
      return;
    }

    const metric = resolveMetricForRule({
      rule,
      version: input.version,
      signalContext,
    });

    if (!metric) {
      return;
    }

    const latestApproval = latestApprovalByRule.get(rule.id) ?? null;
    const requiresApproval = isApprovalRule(rule);
    const approvalIsFresh =
      latestApproval?.status === "approved" &&
      currentContentRevision !== null &&
      Number(latestApproval.approved_content_revision) === currentContentRevision;

    if (metric.sourceState === "unavailable") {
      if (
        rule.action === "require_approval" &&
        approvalIsFresh &&
        input.preserveApprovedRequiresApproval !== true
      ) {
        return;
      }

      unavailableSignals.push({
        rule_id: rule.id,
        rule_type: rule.rule_type,
        scope_type: rule.scope_type,
        scope_id: rule.scope_id,
        threshold_value: rule.threshold_value,
        action: rule.action,
        metric_key: metric.metricKey,
        comparator: metric.comparator,
        source_state: "unavailable",
        message: resolveUnavailableSignalMessage({
          rule,
          metricKey: metric.metricKey,
        }),
      });
      return;
    }

    if (!metric.check.violated) {
      return;
    }

    if (
      requiresApproval &&
      approvalIsFresh &&
      input.preserveApprovedRequiresApproval !== true
    ) {
      return;
    }

    const severity = requiresApproval
      ? "blocking"
      : resolveSeverityForRuleAction(rule.action);

    const approvalStatus: EstimateRuleViolation["approval_status"] = requiresApproval
      ? latestApproval?.status === "approved" && !approvalIsFresh
        ? "missing"
        : (latestApproval?.status ?? "missing")
      : null;

    violations.push({
      rule_id: rule.id,
      rule_type: rule.rule_type,
      scope_type: rule.scope_type,
      scope_id: rule.scope_id,
      threshold_value: metric.check.threshold,
      action: rule.action,
      severity,
      metric_key: metric.metricKey,
      actual_value: metric.check.actualValue,
      comparator: metric.comparator,
      approval_status: approvalStatus,
      approval_id: latestApproval?.id ?? null,
      approval_created_at: latestApproval?.created_at ?? null,
      approval_decided_at: latestApproval?.decided_at ?? null,
      source_state: "ready",
      message: resolveViolationMessage({
        rule,
        metricKey: metric.metricKey,
        actualValue: metric.check.actualValue,
        thresholdValue: metric.check.threshold,
        approvalStatus,
      }),
    });
  });

  const sorted = [...violations].sort((left, right) => {
    if (left.severity !== right.severity) {
      return left.severity === "blocking" ? -1 : 1;
    }
    return left.rule_id.localeCompare(right.rule_id);
  });

  return {
    violations: sorted,
    blockingViolations: sorted.filter((entry) => entry.severity === "blocking"),
    warningViolations: sorted.filter((entry) => entry.severity === "warning"),
    unavailableSignals,
  };
}

function resolveApprovalSummaryLabel(ruleType: ExtendedEstimateRuleType) {
  if (ruleType === "min_margin") return "Marge minimum";
  if (ruleType === "max_discount") return "Remise maximum";
  if (ruleType === "require_approval") return "Seuil montant HT";
  if (ruleType === "dpgf_coverage_min") return "Couverture DPGF minimum";
  if (ruleType === "takeoff_evidence_coverage_min") return "Couverture preuves takeoff minimum";
  if (ruleType === "critical_exceptions_max") return "Exceptions critiques maximum";
  return "Lignes sans preuve maximum";
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

function isApprovalWorkflowSignal(input: {
  action: EstimateRuleAction;
  ruleType: ExtendedEstimateRuleType;
}) {
  return input.action === "require_approval" || input.ruleType === "require_approval";
}

function toSubmissionReadinessSignal(input: {
  id: string;
  label: string;
  message: string;
  category?: EstimateReadinessCategory;
  actionLabel?: string;
  actionHref?: string;
}): EstimateApprovalSubmissionSignal {
  return {
    id: input.id,
    label: input.label,
    message: input.message,
    category: input.category,
    actionLabel: input.actionLabel,
    actionHref: input.actionHref,
  };
}

function dedupeSubmissionSignals(
  signals: EstimateApprovalSubmissionSignal[]
) {
  return [...new Map(signals.map((signal) => [signal.id, signal])).values()];
}

function buildSubmissionReadinessFromRulesEvaluation(input: {
  rulesEvaluation: EvaluateRulesResult;
}): {
  blockers: EstimateApprovalSubmissionSignal[];
  alerts: EstimateApprovalSubmissionSignal[];
} {
  const blockers = [
    ...input.rulesEvaluation.blockingViolations
      .filter(
        (violation) =>
          !isApprovalWorkflowSignal({
            action: violation.action,
            ruleType: violation.rule_type,
          })
      )
      .map((violation) =>
        toSubmissionReadinessSignal({
          id: `rule:${violation.rule_id}`,
          label: resolveApprovalSummaryLabel(violation.rule_type),
          message: violation.message,
          category: "approvals",
        })
      ),
    ...input.rulesEvaluation.unavailableSignals
      .filter((signal) => signal.action === "block")
      .map((signal) =>
        toSubmissionReadinessSignal({
          id: `signal:${signal.rule_id}`,
          label: resolveApprovalSummaryLabel(signal.rule_type),
          message: signal.message,
          category: "approvals",
        })
      ),
  ];

  const alerts = [
    ...input.rulesEvaluation.warningViolations.map((violation) =>
      toSubmissionReadinessSignal({
        id: `rule:${violation.rule_id}`,
        label: resolveApprovalSummaryLabel(violation.rule_type),
        message: violation.message,
        category: "approvals",
      })
    ),
    ...input.rulesEvaluation.unavailableSignals
      .filter((signal) => signal.action !== "block")
      .map((signal) =>
        toSubmissionReadinessSignal({
          id: `signal:${signal.rule_id}`,
          label: resolveApprovalSummaryLabel(signal.rule_type),
          message: signal.message,
          category: "approvals",
        })
      ),
  ];

  return {
    blockers: dedupeSubmissionSignals(blockers),
    alerts: dedupeSubmissionSignals(alerts),
  };
}

async function enrichSubmissionReadinessWithAffaireRegister(input: {
  supabase: SupabaseClient<Database> | Supabase;
  projectId: string;
  versionId: string;
  submissionReadiness: {
    blockers: EstimateApprovalSubmissionSignal[];
    alerts: EstimateApprovalSubmissionSignal[];
  };
}) {
  const [registerSummary, versionZeroSummary] = await Promise.all([
    fetchAffaireRegisterGateSummary({
      supabase: input.supabase as never,
      projectId: input.projectId,
      versionId: input.versionId,
    }),
    fetchVersionZeroDraftSummary({ versionId: input.versionId }).catch(() => null),
  ]);

  const blockers = [...input.submissionReadiness.blockers];
  const alerts = [...input.submissionReadiness.alerts];
  const criticalMissingPieceEntries = registerSummary.criticalOpenEntries.filter(
    (entry) => entry.kind === "missing_piece"
  );
  const criticalAssumptionEntries = registerSummary.criticalOpenEntries.filter(
    (entry) => entry.kind === "assumption"
  );
  const openMissingPieceEntries = registerSummary.nonCriticalOpenEntries.filter(
    (entry) => entry.kind === "missing_piece"
  );
  const openAssumptionEntries = registerSummary.nonCriticalOpenEntries.filter(
    (entry) => entry.kind === "assumption"
  );
  const clarifyMissingPieceEntries = registerSummary.clarifyWithClientEntries.filter(
    (entry) => entry.kind === "missing_piece"
  );
  const clarifyAssumptionEntries = registerSummary.clarifyWithClientEntries.filter(
    (entry) => entry.kind === "assumption"
  );

  if (criticalMissingPieceEntries.length > 0) {
    blockers.push(
      toSubmissionReadinessSignal({
        id: "register:critical_missing_pieces",
        label: "Documents",
        message: buildAffaireRegisterSubmissionSignalMessage({
          entries: criticalMissingPieceEntries,
          label: "Documents critiques manquants",
          intro: "Des pieces critiques restent manquantes avant soumission.",
        }),
        category: "documents",
        actionLabel: "Ouvrir les documents manquants",
        actionHref: buildAffaireRegisterHubHref({
          projectId: input.projectId,
          status: "open",
          severity: "critical",
          kind: "missing_piece",
          focusEntryId: criticalMissingPieceEntries[0]?.id ?? null,
        }),
      })
    );
  }

  if (criticalAssumptionEntries.length > 0) {
    blockers.push(
      toSubmissionReadinessSignal({
        id: "register:critical_open_questions",
        label: "Registre affaire",
        message: buildAffaireRegisterSubmissionSignalMessage({
          entries: criticalAssumptionEntries,
          label: "Questions critiques ouvertes",
          intro: "Des questions critiques restent ouvertes.",
        }),
        category: "register",
        actionLabel: "Ouvrir le registre",
        actionHref: buildAffaireRegisterHubHref({
          projectId: input.projectId,
          status: "open",
          severity: "critical",
          kind: "assumption",
          focusEntryId: criticalAssumptionEntries[0]?.id ?? null,
        }),
      })
    );
  }

  if (openMissingPieceEntries.length > 0) {
    alerts.push(
      toSubmissionReadinessSignal({
        id: "register:missing_pieces_pending",
        label: "Documents",
        message: buildAffaireRegisterSubmissionSignalMessage({
          entries: openMissingPieceEntries,
          label: "Documents manquants",
          intro: "Des pieces manquantes restent ouvertes avant validation.",
        }),
        category: "documents",
        actionLabel: "Ouvrir les documents manquants",
        actionHref: buildAffaireRegisterHubHref({
          projectId: input.projectId,
          status: "open",
          kind: "missing_piece",
          focusEntryId: openMissingPieceEntries[0]?.id ?? null,
        }),
      })
    );
  }

  if (openAssumptionEntries.length > 0) {
    alerts.push(
      toSubmissionReadinessSignal({
        id: "register:open_questions_pending",
        label: "Registre affaire",
        message: buildAffaireRegisterSubmissionSignalMessage({
          entries: openAssumptionEntries,
          label: "Questions ouvertes",
          intro: "Des hypotheses restent ouvertes avant validation.",
        }),
        category: "register",
        actionLabel: "Ouvrir le registre",
        actionHref: buildAffaireRegisterHubHref({
          projectId: input.projectId,
          status: "open",
          kind: "assumption",
          focusEntryId: openAssumptionEntries[0]?.id ?? null,
        }),
      })
    );
  }

  if (clarifyMissingPieceEntries.length > 0) {
    alerts.push(
      toSubmissionReadinessSignal({
        id: "register:client_missing_documents_required",
        label: "Documents",
        message: buildAffaireRegisterSubmissionSignalMessage({
          entries: clarifyMissingPieceEntries,
          label: "Documents attendus du client",
          intro: "Des pieces restent a demander au client avant envoi externe.",
        }),
        category: "documents",
        actionLabel: "Ouvrir les documents attendus",
        actionHref: buildAffaireRegisterHubHref({
          projectId: input.projectId,
          status: "clarify_with_client",
          kind: "missing_piece",
          focusEntryId: clarifyMissingPieceEntries[0]?.id ?? null,
        }),
      })
    );
  }

  if (clarifyAssumptionEntries.length > 0) {
    alerts.push(
      toSubmissionReadinessSignal({
        id: "register:client_clarification_required",
        label: "Registre affaire",
        message: buildAffaireRegisterSubmissionSignalMessage({
          entries: clarifyAssumptionEntries,
          label: "Clarifications client",
          intro:
            "Des points restent a clarifier avec le client avant envoi externe.",
        }),
        category: "register",
        actionLabel: "Ouvrir le registre",
        actionHref: buildAffaireRegisterHubHref({
          projectId: input.projectId,
          status: "clarify_with_client",
          kind: "assumption",
          focusEntryId: clarifyAssumptionEntries[0]?.id ?? null,
        }),
      })
    );
  }

  if (versionZeroSummary?.activeDraft) {
    blockers.push(
      toSubmissionReadinessSignal({
        id: "version-zero:review_pending",
        label: "V0 IA",
        message:
          versionZeroSummary.activeDraft.counts.pending > 0
            ? `La V0 IA comporte encore ${versionZeroSummary.activeDraft.counts.pending} ligne(s) en attente de validation humaine.`
            : "Une V0 IA active doit etre materialisee ou abandonnee avant soumission.",
        category: "estimate_quality",
        actionLabel: "Ouvrir la V0",
        actionHref: `/dashboard/estimates/${input.versionId}/edit?openVersionZero=1`,
      })
    );
  }

  return {
    blockers: dedupeSubmissionSignals(blockers),
    alerts: dedupeSubmissionSignals(alerts),
  };
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
}) {
  const evaluatedAt = input.evaluatedAt ?? new Date().toISOString();
  const rulesEvaluation = await evaluateRules({
    supabase: input.supabase,
    tenantId: input.tenantId,
    version: input.version,
    project: input.project,
    items: input.items,
    preserveApprovedRequiresApproval: true,
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
}): Promise<EstimateApprovalSummaryCore> {
  const { summary } = await evaluateApprovalSummaryBundle(input);
  return summary;
}

async function evaluateSubmissionReadiness(input: {
  supabase: SupabaseClient<Database> | Supabase;
  tenantId: string;
  version: RulesEngineVersion;
  project: RulesEngineProject;
  items: RulesEngineItemAccess[];
}) {
  const rulesEvaluation = await evaluateRules({
    supabase: input.supabase,
    tenantId: input.tenantId,
    version: input.version,
    project: input.project,
    items: input.items,
    preserveApprovedRequiresApproval: true,
  });

  return enrichSubmissionReadinessWithAffaireRegister({
    supabase: input.supabase,
    projectId: input.project.id,
    versionId: input.version.id,
    submissionReadiness: buildSubmissionReadinessFromRulesEvaluation({
      rulesEvaluation,
    }),
  });
}

function toApprovalSummaryStorage(summary: EstimateApprovalSummaryCore): Json {
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

function normalizeReviewCycle(
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

function normalizeAssignedReviewer(
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

function normalizeReviewComment(
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

function normalizeReviewCorrectionEvent(
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

function normalizeReviewCorrectionItem(input: {
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

async function listAvailableEstimateApprovalReviewers(input: {
  context: AuthenticatedContext;
}) {
  const reviewerClient = createOptionalServiceRoleClient() ?? input.context.supabase;
  const { data: membershipRows, error: membershipError } = await reviewerClient
    .from("tenant_memberships")
    .select("tenant_id, user_id, role, is_default, created_at")
    .eq("tenant_id", input.context.tenantId)
    .in("role", ["admin", "director"])
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

  return "Systeme";
}

function normalizeApprovalOutcome(
  value: unknown
): EstimateApprovalDecisionEvent["approvalOutcome"] | null {
  if (value === "approved" || value === "rejected") {
    return value;
  }

  return null;
}

function normalizeEstimateApprovalDecisionEvent(
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

function buildEstimateReviewCommentTargets(input: {
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

function resolveApprovalStatusFromReviewDecision(
  decision: EstimateReviewDecision
): EstimateApprovalStatus {
  return decision === "changes_requested" ? "rejected" : "approved";
}

async function listEstimateReviewCycles(input: {
  context: AuthenticatedContext;
  versionId: string;
}) {
  const { data, error } = await input.context.supabase
    .from("estimate_review_cycles")
    .select(
      [
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
      ].join(", ")
    )
    .eq("tenant_id", input.context.tenantId)
    .eq("version_id", input.versionId)
    .order("cycle_number", { ascending: false });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les cycles de revue.");
  }

  return ((data ?? []) as unknown) as EstimateReviewCycleWithProfilesRow[];
}

async function listEstimateReviewComments(input: {
  context: AuthenticatedContext;
  versionId: string;
  cycleIds: string[];
}) {
  if (input.cycleIds.length === 0) {
    return [] as EstimateReviewCommentWithProfilesRow[];
  }

  const { data, error } = await input.context.supabase
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
      ].join(", ")
    )
    .eq("tenant_id", input.context.tenantId)
    .eq("version_id", input.versionId)
    .in("cycle_id", input.cycleIds)
    .order("created_at", { ascending: true });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les commentaires de revue.");
  }

  return ((data ?? []) as unknown) as EstimateReviewCommentWithProfilesRow[];
}

async function listEstimateReviewCorrectionItems(input: {
  context: AuthenticatedContext;
  versionId: string;
  cycleIds: string[];
}) {
  if (input.cycleIds.length === 0) {
    return [] as EstimateReviewCorrectionItemWithProfilesRow[];
  }

  const { data, error } = await input.context.supabase
    .from("estimate_review_correction_items" as never)
    .select(
      [
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
      ].join(", ") as never
    )
    .eq("tenant_id" as never, input.context.tenantId as never)
    .eq("version_id" as never, input.versionId as never)
    .in("cycle_id" as never, input.cycleIds as never)
    .order("created_at" as never, { ascending: true });

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de charger la checklist de correction."
    );
  }

  return ((data ?? []) as unknown) as EstimateReviewCorrectionItemWithProfilesRow[];
}

async function listEstimateReviewCorrectionEvents(input: {
  context: AuthenticatedContext;
  versionId: string;
  cycleIds: string[];
}) {
  if (input.cycleIds.length === 0) {
    return [] as EstimateReviewCorrectionEventWithProfilesRow[];
  }

  const { data, error } = await input.context.supabase
    .from("estimate_review_correction_events" as never)
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
      ].join(", ") as never
    )
    .eq("tenant_id" as never, input.context.tenantId as never)
    .eq("version_id" as never, input.versionId as never)
    .in("cycle_id" as never, input.cycleIds as never)
    .order("created_at" as never, { ascending: true });

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de charger l'historique des corrections."
    );
  }

  return ((data ?? []) as unknown) as EstimateReviewCorrectionEventWithProfilesRow[];
}

function toJsonRecord(value: Json | null): Record<string, unknown> | null {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function toStringValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function toNumberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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

function collectTouchedLabels(
  rows: EstimateAuditLogRow[],
  limit = 6
) {
  const labels: string[] = [];

  rows.forEach((row) => {
    const afterData = toJsonRecord(row.after_data);
    const beforeData = toJsonRecord(row.before_data);
    const label =
      toStringValue(afterData?.title) ??
      toStringValue(beforeData?.title) ??
      toStringValue(afterData?.scope_label) ??
      toStringValue(beforeData?.scope_label);

    if (!label || labels.includes(label)) {
      return;
    }

    labels.push(label);
  });

  return labels.slice(0, limit);
}

async function buildChangesSinceLastCycle(input: {
  context: AuthenticatedContext;
  version: VersionAccessRow;
  sourceCycle: EstimateApprovalReviewCycle;
  correctionItems: EstimateApprovalCorrectionItem[];
}) {
  const auditClient = createOptionalServiceRoleClient();
  if (!auditClient) {
    return null;
  }

  const { data, error } = await auditClient
    .from("audit_logs")
    .select("created_at, table_name, record_id, action, before_data, after_data")
    .eq("estimate_version_id", input.version.id)
    .gte("created_at", input.sourceCycle.decidedAt)
    .in("table_name", ["estimate_versions", "estimate_items"])
    .order("created_at", { ascending: true });

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de charger le diff depuis le dernier cycle."
    );
  }

  const rows = (data ?? []) as EstimateAuditLogRow[];
  const versionRows = rows.filter((row) => row.table_name === "estimate_versions");
  const itemRows = rows.filter((row) => row.table_name === "estimate_items");
  const lineRows = itemRows.filter((row) => {
    const afterData = toJsonRecord(row.after_data);
    const beforeData = toJsonRecord(row.before_data);
    return (
      toStringValue(afterData?.item_type) === "line" ||
      toStringValue(beforeData?.item_type) === "line"
    );
  });
  const lotRows = itemRows.filter((row) => {
    const afterData = toJsonRecord(row.after_data);
    const beforeData = toJsonRecord(row.before_data);
    return (
      toStringValue(afterData?.item_type) === "section" ||
      toStringValue(beforeData?.item_type) === "section"
    );
  });
  const addedLotsCount = lotRows.filter((row) => row.action === "INSERT").length;
  const removedLotsCount = lotRows.filter((row) => row.action === "DELETE").length;
  const updatedLotsCount = lotRows.filter((row) => row.action === "UPDATE").length;
  const addedLinesCount = lineRows.filter((row) => row.action === "INSERT").length;
  const removedLinesCount = lineRows.filter((row) => row.action === "DELETE").length;
  const updatedLinesCount = lineRows.filter((row) => row.action === "UPDATE").length;
  const earliestVersionBaseline = versionRows
    .map((row) => toJsonRecord(row.before_data))
    .find((entry) => entry !== null);
  const baselineTotalHt =
    toNumberValue(earliestVersionBaseline?.total_ht_cents) ??
    input.version.total_ht_cents ??
    null;

  const changeFields = [
    "margin_bp",
    "discount_bp",
    "validite_jours",
    "rounding_mode",
    "rounding_step_cents",
    "tax_rate_bp",
    "global_coefficient",
    "margin_mode",
    "margin_multiplier",
    "title",
    "date_devis",
  ];
  const settingsChanges = changeFields
    .map((field) => {
      const baseline =
        earliestVersionBaseline?.[field] ??
        toJsonRecord(versionRows[0]?.before_data ?? null)?.[field] ??
        null;
      const current = (input.version as Record<string, unknown>)[field] ?? null;
      if (baseline === current) {
        return null;
      }

      return {
        field,
        label: APPROVAL_CHANGE_FIELD_LABELS[field] ?? field,
        before: formatChangeFieldValue({ field, value: baseline }),
        after: formatChangeFieldValue({ field, value: current }),
      } satisfies EstimateApprovalChangeField;
    })
    .filter((entry): entry is EstimateApprovalChangeField => entry !== null);

  return {
    sourceCycleId: input.sourceCycle.id,
    sourceCycleNumber: input.sourceCycle.cycleNumber,
    decidedAt: input.sourceCycle.decidedAt,
    treatedItemsCount: input.correctionItems.filter((item) => item.status !== "pending").length,
    toDiscussCount: input.correctionItems.filter((item) => item.status === "to_discuss").length,
    totalHtDeltaCents:
      baselineTotalHt === null || input.version.total_ht_cents === null
        ? null
        : input.version.total_ht_cents - baselineTotalHt,
    addedLotsCount,
    updatedLotsCount,
    removedLotsCount,
    addedLinesCount,
    updatedLinesCount,
    removedLinesCount,
    touchedLabels: collectTouchedLabels(itemRows),
    settingsChanges,
  } satisfies EstimateApprovalChangesSinceLastCycle;
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
    return "Approuvee";
  }

  if (decision === "approved_with_reservations") {
    return "Approuvee sous reserve";
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
  await getVersionAccessOrThrow(context, input.versionId);

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
    throw mapSupabaseError(error, "Impossible de charger le journal de decision.");
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
      "Impossible de charger les auteurs du journal de decision."
    );
  }

  const events = (((data ?? []) as unknown) as EstimateApprovalDecisionEventRow[]).map((row) =>
    normalizeEstimateApprovalDecisionEvent(row)
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
}): Promise<EstimateApprovalSummary> {
  const [cycleRows, targetContext] = await Promise.all([
    listEstimateReviewCycles({
      context: input.context,
      versionId: input.version.id,
    }),
    loadApprovalCommentTargetContext({
      context: input.context,
      versionId: input.version.id,
      projectId: input.project.id,
    }),
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
  const availableReviewers = await listAvailableEstimateApprovalReviewers({
    context: input.context,
  });
  const canPrepareRequest =
    (input.context.tenantRole === "admin" || input.context.tenantRole === "engineer") &&
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
        "Aucun role admin ou director n'est disponible pour prendre la revue.",
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
    isTenantApprover(input.context.tenantRole) &&
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

async function logEstimateVersionEvent(input: {
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
      "Impossible d'enregistrer l'evenement d'approbation."
    );
  }
}

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

async function loadApprovalSummaryItems(input: {
  context: AuthenticatedContext;
  versionId: string;
}) {
  const { data, error } = await input.context.supabase
    .from("estimate_items")
    .select("id, category_id, item_type, title, parent_id, position")
    .eq("tenant_id", input.context.tenantId)
    .eq("version_id", input.versionId);

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de charger les lignes pour le resume d'approbation."
    );
  }

  return (data ?? []) as RulesEngineItemAccess[];
}

async function loadApprovalCommentTargetContext(input: {
  context: AuthenticatedContext;
  versionId: string;
  projectId: string;
}) {
  const [exceptionResult, hypothesisResult] = await Promise.all([
    input.context.supabase
      .from("estimate_risk_alerts" as never)
      .select(
        "id, takeoff_job_id, line_id, lot_id, scope_type, scope_id, scope_label, severity, status, is_active" as never
      )
      .eq("tenant_id" as never, input.context.tenantId as never)
      .eq("version_id" as never, input.versionId as never)
      .eq("is_active" as never, true as never)
      .order("scope_label" as never, { ascending: true }),
    input.context.supabase
      .from("affaire_register_entries" as never)
      .select(
        "id, project_id, version_id, kind, text, scope_type, scope_id, scope_label, severity, status, is_active" as never
      )
      .eq("tenant_id" as never, input.context.tenantId as never)
      .eq("project_id" as never, input.projectId as never)
      .eq("kind" as never, "assumption" as never)
      .eq("is_active" as never, true as never)
      .order("updated_at" as never, { ascending: false }),
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
      "Impossible de charger les hypotheses pour l'approbation."
    );
  }

  return {
    exceptions: (exceptionResult.data ?? []) as EstimateRiskAlertTargetRow[],
    hypotheses: (hypothesisResult.data ?? []) as AffaireRegisterHypothesisTargetRow[],
  };
}

async function syncEstimateApprovalSummary(input: {
  context: AuthenticatedContext;
  version: VersionAccessRow;
  project: EmbeddedApprovalProjectAccess;
  trigger: ApprovalAuditTrigger;
  actorUserId?: string | null;
}): Promise<EstimateApprovalSummary> {
  const items = await loadApprovalSummaryItems({
    context: input.context,
    versionId: input.version.id,
  });
  const evaluatedAt = new Date().toISOString();
  const coreSummary = await evaluateApprovalSummary({
    supabase: input.context.supabase,
    tenantId: input.context.tenantId,
    version: {
      id: input.version.id,
      project_id: input.version.project_id,
      total_ht_cents: input.version.total_ht_cents,
      margin_bp: input.version.margin_bp,
      margin_multiplier: input.version.margin_multiplier,
      margin_mode: input.version.margin_mode,
      discount_bp: input.version.discount_bp,
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
  });
  const submissionReadiness = await evaluateSubmissionReadiness({
    supabase: input.context.supabase,
    tenantId: input.context.tenantId,
    version: {
      id: input.version.id,
      project_id: input.version.project_id,
      total_ht_cents: input.version.total_ht_cents,
      margin_bp: input.version.margin_bp,
      margin_multiplier: input.version.margin_multiplier,
      margin_mode: input.version.margin_mode,
      discount_bp: input.version.discount_bp,
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
      summary: {
        ...coreSummary,
        evaluatedAt: input.version.approval_evaluated_at ?? coreSummary.evaluatedAt,
      },
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
      "Impossible de projeter le resume d'approbation."
    );
  }

  await logEstimateVersionEvent({
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
    await logEstimateVersionEvent({
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
    summary: coreSummary,
  });
}

export async function getEstimateApprovalSummary(
  versionId: string
): Promise<EstimateApprovalSummary> {
  const context = await getAuthenticatedContext();
  const { version, project } = await getVersionAccessOrThrow(context, versionId);

  return syncEstimateApprovalSummary({
    context,
    version,
    project,
    trigger: "read",
  });
}

export async function updateEstimateReviewCorrectionItemStatus(input: {
  versionId: string;
  itemId: string;
  status: Exclude<EstimateReviewCorrectionStatus, "pending">;
  note?: string | null;
}) {
  const context = await getAuthenticatedContext();
  const access = await getVersionAccessOrThrow(context, input.versionId);

  if (access.project.user_id !== context.userId) {
    throw forbidden("Action reservee au proprietaire du chiffrage.");
  }

  const { data, error } = await context.supabase.rpc(
    "record_estimate_review_correction_action" as never,
    {
      p_item_id: input.itemId,
      p_status: input.status,
      p_note: input.note?.trim() || null,
    } as never
  );

  if (error) {
    if (error.message.includes("ESTIMATE_REVIEW_CORRECTION_OWNER_REQUIRED")) {
      throw forbidden("Action reservee au proprietaire du chiffrage.");
    }

    if (error.message.includes("ESTIMATE_REVIEW_CORRECTION_STATUS_UNCHANGED")) {
      throw badRequest("Le statut de correction est deja applique.");
    }

    if (error.message.includes("ESTIMATE_REVIEW_CORRECTION_ITEM_NOT_FOUND")) {
      throw notFound("Element de correction introuvable.");
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

async function getVersionAccessOrThrow(
  context: AuthenticatedContext,
  versionId: string
): Promise<{ version: VersionAccessRow; project: EmbeddedApprovalProjectAccess }> {
  const { data, error } = await context.supabase
    .from("estimate_versions")
    .select(
      "id, tenant_id, status, updated_at, content_revision, calc_engine_version, calc_snapshot_content_revision, calc_snapshot_context, version_number, project_id, title, date_devis, validite_jours, total_ht_cents, margin_bp, global_coefficient, margin_multiplier, margin_mode, discount_bp, tax_rate_bp, rounding_mode, rounding_step_cents, approval_status, approval_summary, approval_evaluated_at, estimate_projects!inner(id, tenant_id, user_id, name, client_name)"
    )
    .eq("id", versionId)
    .eq("tenant_id", context.tenantId)
    .single();

  if (error || !data) {
    throw notFound("Version de chiffrage introuvable.");
  }

  const version = data as unknown as VersionAccessRow;
  const project = resolveEmbeddedOne(version.estimate_projects);

  if (
    !project ||
    project.tenant_id !== context.tenantId ||
    !canAccessApprovalResource({
      context,
      resourceUserId: project.user_id,
    })
  ) {
    throw notFound("Version de chiffrage introuvable.");
  }

  return {
    version,
    project,
  };
}

function assertAdminRole(context: Pick<AuthenticatedContext, "tenantRole">) {
  if (isTenantAdmin(context.tenantRole)) {
    return;
  }
  throw forbidden("Action reservee aux administrateurs.");
}

function assertRequesterRole(context: Pick<AuthenticatedContext, "tenantRole">) {
  if (context.tenantRole === "admin" || context.tenantRole === "engineer") {
    return;
  }
  throw forbidden("Action reservee aux demandeurs d'approbation.");
}

function assertApproverRole(context: Pick<AuthenticatedContext, "tenantRole">) {
  if (isTenantApprover(context.tenantRole)) {
    return;
  }
  throw forbidden("Action reservee aux roles de validation.");
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

type NormalizedDecisionComment = {
  scopeType: EstimateReviewCommentScope;
  scopeId: string | null;
  scopeLabel: string;
  comment: string;
};

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
        "Chaque commentaire cible doit pointer vers un lot, une ligne, une exception ou une hypothese."
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

async function findOpenReviewCycle(input: {
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

async function findLatestReviewCycle(input: {
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

async function listPendingApprovalsForVersion(input: {
  context: AuthenticatedContext;
  versionId: string;
}) {
  const { data, error } = await input.context.supabase
    .from("estimate_approvals")
    .select(
      "id, created_at, updated_at, tenant_id, version_id, rule_id, requested_by, approved_by, status, decided_at, approved_content_revision, review_cycle_id, superseded_at"
    )
    .eq("tenant_id", input.context.tenantId)
    .eq("version_id", input.versionId)
    .eq("status", "pending")
    .is("superseded_at", null)
    .order("created_at", { ascending: true });

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
  const linkedResult = await input.context.supabase
    .from("estimate_approvals")
    .select(selection)
    .eq("tenant_id", input.context.tenantId)
    .eq("version_id", input.versionId)
    .eq("review_cycle_id", input.cycleId)
    .order("created_at", { ascending: false });

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
    .select(selection)
    .eq("tenant_id", input.context.tenantId)
    .eq("version_id", input.versionId)
    .is("review_cycle_id", null)
    .gte("created_at", input.requestedAt)
    .order("created_at", { ascending: false });

  if (input.decidedAt) {
    legacyQuery = legacyQuery.lte("created_at", input.decidedAt);
  }

  const legacyResult = await legacyQuery;
  if (legacyResult.error) {
    throw mapSupabaseError(
      legacyResult.error,
      "Impossible de charger les approbations historiques du cycle de revue."
    );
  }

  return (legacyResult.data ?? []) as EstimateApprovalRow[];
}

async function listRuleIdsForReviewCycle(input: {
  context: AuthenticatedContext;
  versionId: string;
  cycleId: string;
  requestedAt: string;
  decidedAt?: string | null;
}) {
  const approvals = await listApprovalsForReviewCycle(input);
  return [...new Set(approvals.map((approval) => approval.rule_id))];
}

async function decideReviewCycleAtomically(input: {
  context: AuthenticatedContext;
  cycleId: string;
  decision: EstimateReviewDecision;
  comments: NormalizedDecisionComment[];
}) {
  const { data, error } = await input.context.supabase.rpc(
    "decide_estimate_review_cycle" as never,
    {
      p_cycle_id: input.cycleId,
      p_decision: input.decision,
      p_comments: input.comments.map((comment) => ({
        scope_type: comment.scopeType,
        scope_id: comment.scopeId,
        scope_label: comment.scopeLabel,
        comment: comment.comment,
      })),
    } as never
  );

  if (error) {
    if (error.message.includes("ESTIMATE_REVIEW_SNAPSHOT_STALE")) {
      throw conflict(
        "Le devis a ete modifie depuis sa soumission. Une nouvelle revue est requise.",
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

    throw mapSupabaseError(error, "Impossible d'enregistrer la decision d'approbation.");
  }

  const row = Array.isArray(data)
    ? ((data[0] as unknown) as DecideEstimateReviewCycleResult | undefined)
    : undefined;
  if (!row) {
    throw badRequest("Impossible d'enregistrer la decision d'approbation.");
  }

  return row;
}

async function decideApprovalAtomically(input: {
  context: AuthenticatedContext;
  approvalId: string;
  status: "approved" | "rejected";
}) {
  const { data, error } = await input.context.supabase.rpc(
    "decide_estimate_approval" as never,
    {
      p_approval_id: input.approvalId,
      p_status: input.status,
    } as never
  );

  if (error) {
    if (error.message.includes("ESTIMATE_REVIEW_SNAPSHOT_STALE")) {
      throw conflict(
        "Le devis a ete modifie depuis sa soumission. Une nouvelle revue est requise.",
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
      "Impossible d'enregistrer la decision d'approbation."
    );
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw badRequest("Impossible d'enregistrer la decision d'approbation.");
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
    throw notFound("Regle introuvable.");
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

  const { data, error } = await input.context.supabase
    .from("estimate_rules")
    .select(
      "id, created_at, updated_at, tenant_id, rule_type, scope_type, scope_id, threshold_value, action, is_active"
    )
    .eq("tenant_id", input.context.tenantId)
    .in("id", input.ruleIds)
    .order("created_at", { ascending: true });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les regles ciblees.");
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
    throw badRequest("Le validateur assigne n'est pas autorise sur ce tenant.");
  }

  return assignedReviewer;
}

export async function submitEstimateApproval(
  input: SubmitEstimateApprovalInput
): Promise<SubmitEstimateApprovalResult> {
  const context = await getAuthenticatedContext();
  let access = await getVersionAccessOrThrow(context, input.versionId);

  if (input.action === "submit_for_review") {
    assertRequesterRole(context);

    if (
      !canAccessOwnerResource({
        context,
        resourceUserId: access.project.user_id,
      })
    ) {
      throw forbidden("Action reservee au proprietaire du chiffrage.");
    }

    if (await freezeApprovalV2DraftIfRequired(context, access.version))
      access = await getVersionAccessOrThrow(context, input.versionId);
    const items = await loadApprovalSummaryItems({
      context,
      versionId: input.versionId,
    });
    const [summary, submissionReadiness, assignedReviewer] = await Promise.all([
      evaluateApprovalSummary({
        supabase: context.supabase,
        tenantId: context.tenantId,
        version: {
          id: access.version.id,
          project_id: access.version.project_id,
          total_ht_cents: access.version.total_ht_cents,
          margin_bp: access.version.margin_bp,
          margin_multiplier: access.version.margin_multiplier,
          margin_mode: access.version.margin_mode,
          discount_bp: access.version.discount_bp,
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
        items,
      }),
      evaluateSubmissionReadiness({
        supabase: context.supabase,
        tenantId: context.tenantId,
        version: {
          id: access.version.id,
          project_id: access.version.project_id,
          total_ht_cents: access.version.total_ht_cents,
          margin_bp: access.version.margin_bp,
          margin_multiplier: access.version.margin_multiplier,
          margin_mode: access.version.margin_mode,
          discount_bp: access.version.discount_bp,
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
        items,
      }),
      resolveAssignedReviewerOrThrow({
        context,
        reviewerUserId: normalizeOptionalUuid(input.assignedReviewerUserId ?? undefined),
      }),
    ]);

    if (submissionReadiness.blockers.length > 0) {
      throw badRequest("Des blocants restent a lever avant la soumission.");
    }

    const requestedRuleIdSet = new Set(
      input.ruleIds
        .map((ruleId) => normalizeOptionalUuid(ruleId))
        .filter((ruleId): ruleId is string => ruleId !== null)
    );
    const currentRequestableReasons = summary.reasons.filter(
      (reason) =>
        (reason.approvalStatus === "missing" || reason.approvalStatus === "rejected") &&
        (requestedRuleIdSet.size === 0 || requestedRuleIdSet.has(reason.ruleId))
    );
    const latestCycle = await findLatestReviewCycle({
      context,
      versionId: input.versionId,
    });
    const rejectedSourceCycle =
      latestCycle?.decision === "changes_requested" && latestCycle.decided_at
        ? latestCycle
        : null;
    let carriedOverRuleIds: string[] = [];

    if (rejectedSourceCycle) {
      const correctionRows = await listEstimateReviewCorrectionItems({
        context,
        versionId: input.versionId,
        cycleIds: [rejectedSourceCycle.id],
      });
      const hasPendingCorrections = correctionRows.some(
        (row) => row.status === "pending"
      );
      if (hasPendingCorrections) {
        throw badRequest("Tous les items de correction doivent etre traites avant la resoumission.");
      }

      carriedOverRuleIds = await listRuleIdsForReviewCycle({
        context,
        versionId: input.versionId,
        cycleId: rejectedSourceCycle.id,
        requestedAt: rejectedSourceCycle.requested_at,
        decidedAt: rejectedSourceCycle.decided_at,
      });
    }

    const requestedRuleIds = [
      ...new Set([
        ...currentRequestableReasons.map((reason) => reason.ruleId),
        ...carriedOverRuleIds,
      ]),
    ].filter((ruleId) => requestedRuleIdSet.size === 0 || requestedRuleIdSet.has(ruleId));

    if (requestedRuleIds.length === 0) {
      throw badRequest("Aucune regle de validation ne peut etre soumise.");
    }

    const requestableReasonByRuleId = new Map(
      currentRequestableReasons.map((reason) => [reason.ruleId, reason] as const)
    );
    const missingRuleIds = requestedRuleIds.filter(
      (ruleId) => !requestableReasonByRuleId.has(ruleId)
    );
    const carriedOverRules = await findRulesForTenant({
      context,
      ruleIds: missingRuleIds,
    });
    const carriedOverRuleById = new Map(
      carriedOverRules.map((rule) => [rule.id, rule] as const)
    );
    const requestedRulePayload = requestedRuleIds.map((ruleId) => {
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
          : "Regle de validation",
      };
    });

    const submission = await openEstimateReviewCycle({
      versionId: input.versionId,
      tenantId: context.tenantId,
      actorUserId: context.userId,
      assignedReviewerId: assignedReviewer.userId,
      ruleIds: requestedRulePayload.map((reason) => reason.ruleId),
      submissionMessage: input.submissionMessage ?? null,
      eventMetadata: {
        requestedRuleLabels: requestedRulePayload.map((reason) => reason.label),
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
      try {
        const requesterProfile = await loadProfileIdentity({
          context,
          userId: context.userId,
        });
        await sendApprovalReviewRequestNotification({
          recipientEmail: assignedReviewer.workEmail,
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
          ruleLabels: requestedRulePayload.map((reason) => reason.label),
        });
      } catch (error) {
        console.error("Failed to send approval review request notification:", error);
      }
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
      requestedApprovalCount: requestedRulePayload.length,
      requestedRuleIds: requestedRulePayload.map((reason) => reason.ruleId),
    };
  }

  if (input.action === "request") {
    assertRequesterRole(context);

    if (
      !canAccessOwnerResource({
        context,
        resourceUserId: access.project.user_id,
      })
    ) {
      throw forbidden("Action reservee au proprietaire du chiffrage.");
    }

    const ruleId = normalizeOptionalUuid(input.ruleId);
    if (!ruleId) {
      throw badRequest("rule_id est obligatoire pour une demande d'approbation.");
    }

    const rule = await findRuleForTenant({
      context,
      ruleId,
    });

    if (!rule.is_active) {
      throw badRequest("La regle ciblee est inactive.");
    }

    if (await freezeApprovalV2DraftIfRequired(context, access.version))
      access = await getVersionAccessOrThrow(context, input.versionId);
    const assignedReviewer = await resolveAssignedReviewerOrThrow({
      context,
      reviewerUserId: null,
    });
    const submission = await openEstimateReviewCycle({
      versionId: input.versionId,
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

  if (input.action === "decide") {
    assertApproverRole(context);

    const activeCycle = await findOpenReviewCycle({
      context,
      versionId: input.versionId,
    });

    if (!activeCycle) {
      throw badRequest("Aucun cycle de revue actif n'est disponible.");
    }

    const pendingApprovals = await listPendingApprovalsForVersion({
      context,
      versionId: input.versionId,
    });

    if (pendingApprovals.length === 0) {
      throw badRequest("Aucune approbation en attente n'est disponible.");
    }

    const items = await loadApprovalSummaryItems({
      context,
      versionId: input.versionId,
    });
    const summary = await evaluateApprovalSummary({
      supabase: context.supabase,
      tenantId: context.tenantId,
      version: {
        id: access.version.id,
        project_id: access.version.project_id,
        total_ht_cents: access.version.total_ht_cents,
        margin_bp: access.version.margin_bp,
        margin_multiplier: access.version.margin_multiplier,
        margin_mode: access.version.margin_mode,
        discount_bp: access.version.discount_bp,
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
      items,
    });
    const targetContext = await loadApprovalCommentTargetContext({
      context,
      versionId: input.versionId,
      projectId: access.project.id,
    });
    const commentTargets = buildEstimateReviewCommentTargets({
      project: access.project,
      items,
      exceptions: targetContext.exceptions,
      hypotheses: targetContext.hypotheses,
      reasons: summary.reasons,
    });
    const normalizedComments = normalizeDecisionComments({
      decision: input.decision,
      comments: input.comments,
      targets: commentTargets,
    });
    const decidedAt = new Date().toISOString();
    const updatedApprovals = pendingApprovals.map((approval) => ({
      ...approval,
      status: resolveApprovalStatusFromReviewDecision(input.decision),
      approved_by: context.userId,
      decided_at: decidedAt,
      updated_at: decidedAt,
    }));
    await decideReviewCycleAtomically({
      context,
      cycleId: activeCycle.id,
      decision: input.decision,
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

  assertApproverRole(context);

  const ruleId = normalizeOptionalUuid(input.ruleId);
  const approvalId = normalizeOptionalUuid(input.approvalId);

  let targetApproval: EstimateApprovalRow | null = null;

  if (approvalId) {
    const { data, error } = await context.supabase
      .from("estimate_approvals")
      .select(
        "id, created_at, updated_at, tenant_id, version_id, rule_id, requested_by, approved_by, status, decided_at, approved_content_revision, review_cycle_id, superseded_at"
      )
      .eq("tenant_id", context.tenantId)
      .eq("version_id", input.versionId)
      .eq("id", approvalId)
      .is("superseded_at", null)
      .single();

    if (error || !data) {
      throw notFound("Demande d'approbation introuvable.");
    }

    targetApproval = data as EstimateApprovalRow;
  } else {
    if (!ruleId) {
      throw badRequest("rule_id ou approval_id est requis pour une decision.");
    }

    targetApproval = await findLatestApprovalForRule({
      context,
      versionId: input.versionId,
      ruleId,
      status: "pending",
    });

    if (!targetApproval) {
      throw notFound("Aucune demande d'approbation en attente.");
    }
  }

  if (targetApproval.status !== "pending") {
    throw badRequest("La demande d'approbation n'est plus en attente.");
  }

  const nextStatus: EstimateApprovalStatus =
    input.action === "approve" ? "approved" : "rejected";

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

export async function listEstimateRulesForCurrentTenant() {
  const context = await getAuthenticatedContext();
  assertAdminRole(context);

  const { data, error } = await context.supabase
    .from("estimate_rules")
    .select(
      "id, created_at, updated_at, tenant_id, rule_type, scope_type, scope_id, threshold_value, action, is_active"
    )
    .eq("tenant_id", context.tenantId)
    .order("created_at", { ascending: true });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les regles.");
  }

  return {
    tenant_id: context.tenantId,
    rules: (data ?? []) as EstimateRuleRow[],
  };
}

export async function createEstimateRuleForCurrentTenant(input: {
  rule_type: ExtendedEstimateRuleType;
  scope_type: EstimateRuleScopeType;
  scope_id: string | null;
  threshold_value: number;
  action: EstimateRuleAction;
  is_active?: boolean;
}) {
  const context = await getAuthenticatedContext();
  assertAdminRole(context);

  const payload: EstimateRuleInsert = {
    tenant_id: context.tenantId,
    rule_type: input.rule_type,
    scope_type: input.scope_type,
    scope_id: input.scope_id,
    threshold_value: input.threshold_value,
    action: input.action,
    is_active: input.is_active ?? true,
  };

  const { data, error } = await context.supabase
    .from("estimate_rules")
    .insert(payload)
    .select(
      "id, created_at, updated_at, tenant_id, rule_type, scope_type, scope_id, threshold_value, action, is_active"
    )
    .single();

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(error, "Impossible de créer la règle.");
    }

    throw badRequest("Impossible de créer la règle.");
  }

  return {
    rule: data as EstimateRuleRow,
  };
}

export async function updateEstimateRuleForCurrentTenant(input: {
  id: string;
  patch: {
    rule_type?: ExtendedEstimateRuleType;
    scope_type?: EstimateRuleScopeType;
    scope_id?: string | null;
    threshold_value?: number;
    action?: EstimateRuleAction;
    is_active?: boolean;
  };
}) {
  const context = await getAuthenticatedContext();
  assertAdminRole(context);

  const payload: EstimateRuleUpdate = {};
  if ("rule_type" in input.patch) {
    payload.rule_type = input.patch.rule_type;
  }
  if ("scope_type" in input.patch) {
    payload.scope_type = input.patch.scope_type;
  }
  if ("scope_id" in input.patch) {
    payload.scope_id = input.patch.scope_id ?? null;
  }
  if ("threshold_value" in input.patch) {
    payload.threshold_value = input.patch.threshold_value;
  }
  if ("action" in input.patch) {
    payload.action = input.patch.action;
  }
  if ("is_active" in input.patch) {
    payload.is_active = input.patch.is_active;
  }

  if (Object.keys(payload).length === 0) {
    throw badRequest("Aucun champ a mettre a jour.");
  }

  const { data, error } = await context.supabase
    .from("estimate_rules")
    .update(payload)
    .eq("tenant_id", context.tenantId)
    .eq("id", input.id)
    .select(
      "id, created_at, updated_at, tenant_id, rule_type, scope_type, scope_id, threshold_value, action, is_active"
    )
    .single();

  if (error || !data) {
    if (error?.code === "PGRST116") {
      throw notFound("Regle introuvable.");
    }

    if (error) {
      throw mapSupabaseError(error, "Impossible de mettre a jour la regle.");
    }

    throw notFound("Regle introuvable.");
  }

  return {
    rule: data as EstimateRuleRow,
  };
}

export async function deleteEstimateRuleForCurrentTenant(ruleId: string) {
  const context = await getAuthenticatedContext();
  assertAdminRole(context);

  const { data, error } = await context.supabase
    .from("estimate_rules")
    .delete()
    .eq("tenant_id", context.tenantId)
    .eq("id", ruleId)
    .select("id")
    .single();

  if (error || !data) {
    if (error?.code === "PGRST116") {
      throw notFound("Regle introuvable.");
    }

    if (error) {
      throw mapSupabaseError(error, "Impossible de supprimer la regle.");
    }

    throw notFound("Regle introuvable.");
  }

  return {
    deleted_id: data.id,
  };
}
