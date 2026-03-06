import type { SupabaseClient } from "@supabase/supabase-js";

import { createOptionalServiceRoleClient } from "@/lib/supabase/service-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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

import {
  badRequest,
  forbidden,
  mapSupabaseError,
  notFound,
  unauthorized,
} from "./errors";

type TenantRole = Database["public"]["Enums"]["tenant_role"];
type EstimateVersionRow = Database["public"]["Tables"]["estimate_versions"]["Row"];
type EstimateProjectRow = Database["public"]["Tables"]["estimate_projects"]["Row"];
type EstimateItemRow = Database["public"]["Tables"]["estimate_items"]["Row"];
type TenantMembershipRow = Pick<
  Database["public"]["Tables"]["tenant_memberships"]["Row"],
  "tenant_id" | "role" | "is_default" | "created_at"
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
  | "approval_rule";
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
};

type EstimateApprovalInsert = {
  id?: string;
  created_at?: string;
  updated_at?: string;
  tenant_id?: string;
  version_id: string;
  rule_id: string;
  requested_by: string;
  approved_by?: string | null;
  status?: EstimateApprovalStatus;
  decided_at?: string | null;
};

type EstimateApprovalUpdate = Partial<EstimateApprovalInsert>;

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
};

type EstimateReviewCycleInsert = {
  id?: string;
  created_at?: string;
  updated_at?: string;
  tenant_id?: string;
  version_id: string;
  cycle_number: number;
  requested_by: string;
  requested_at?: string;
  decided_by?: string | null;
  decision?: EstimateReviewDecision | null;
  decided_at?: string | null;
  carried_over_from_cycle_id?: string | null;
};

type EstimateReviewCycleUpdate = Partial<EstimateReviewCycleInsert>;

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
  Insert: EstimateApprovalInsert;
  Update: EstimateApprovalUpdate;
  Relationships: [];
};

type EstimateReviewCyclesTable = {
  Row: EstimateReviewCycleRow;
  Insert: EstimateReviewCycleInsert;
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

type EmbeddedProfileName = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "full_name"
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
  | "project_id"
  | "total_ht_cents"
  | "margin_bp"
  | "margin_multiplier"
  | "discount_bp"
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
};

type EstimateReviewCommentWithProfilesRow = EstimateReviewCommentRow & {
  created_by_profile: EmbeddedProfileName | EmbeddedProfileName[] | null;
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
  | "approve"
  | "reject"
  | "decide";

export type SubmitEstimateApprovalInput =
  | {
      versionId: string;
      action: "request";
      ruleId: string;
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
  comments: EstimateApprovalReviewComment[];
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
  } | null;
  reviewHistory: EstimateApprovalReviewCycle[];
  commentTargets: {
    project: EstimateApprovalCommentTarget;
    lots: EstimateApprovalCommentTarget[];
    lines: EstimateApprovalCommentTarget[];
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

function resolveVersionMarginBp(version: RulesEngineVersion) {
  const marginBp = toFiniteNumber(version.margin_bp, NaN);
  if (Number.isFinite(marginBp) && marginBp >= 0) {
    return marginBp;
  }

  const multiplier = toFiniteNumber(version.margin_multiplier, NaN);
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    return 0;
  }

  return Math.max(0, Math.round((1 - 1 / multiplier) * 10000));
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
        actualValue: resolveVersionMarginBp(version),
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
      "id, created_at, updated_at, tenant_id, version_id, rule_id, requested_by, approved_by, status, decided_at"
    )
    .eq("tenant_id", input.tenantId)
    .eq("version_id", input.version.id)
    .in("rule_id", relevantRuleIds)
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

    if (metric.sourceState === "unavailable") {
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

    const latestApproval = latestApprovalByRule.get(rule.id) ?? null;
    const requiresApproval = isApprovalRule(rule);

    if (
      requiresApproval &&
      latestApproval?.status === "approved" &&
      input.preserveApprovedRequiresApproval !== true
    ) {
      return;
    }

    const severity = requiresApproval
      ? "blocking"
      : resolveSeverityForRuleAction(rule.action);

    const approvalStatus: EstimateRuleViolation["approval_status"] = requiresApproval
      ? (latestApproval?.status ?? "missing")
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

export async function evaluateApprovalSummary(input: {
  supabase: SupabaseClient<Database> | Supabase;
  tenantId: string;
  version: RulesEngineVersion;
  project: RulesEngineProject;
  items: RulesEngineItemAccess[];
  evaluatedAt?: string;
}): Promise<EstimateApprovalSummaryCore> {
  const rulesEvaluation = await evaluateRules({
    supabase: input.supabase,
    tenantId: input.tenantId,
    version: input.version,
    project: input.project,
    items: input.items,
    preserveApprovedRequiresApproval: true,
  });

  const approvalReasons = rulesEvaluation.violations.filter((violation) =>
    violation.action === "require_approval" || violation.rule_type === "require_approval"
  );

  const unavailableSignals = rulesEvaluation.unavailableSignals
    .filter((signal) => signal.action === "require_approval" || signal.rule_type === "require_approval")
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
      const rightTimestamp = Date.parse(right.approval_decided_at ?? right.approval_created_at ?? "");
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
    evaluatedAt: input.evaluatedAt ?? new Date().toISOString(),
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
  };
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

function toDecisionAuditRuleSnapshots(
  summary: EstimateApprovalSummaryCore,
  ruleIds: string[]
): EstimateApprovalDecisionRule[] {
  const decidedRuleIds = new Set(ruleIds);

  return summary.reasons
    .filter((reason) => decidedRuleIds.has(reason.ruleId))
    .map((reason) => ({
      ruleId: reason.ruleId,
      label: reason.label,
      signalKey: reason.signalKey,
      message: reason.message,
      thresholdValue: reason.thresholdValue,
      actualValue: reason.actualValue,
      sourceState: reason.sourceState,
      approvalStatus: reason.approvalStatus,
    }));
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

function toApprovalDecisionAuditMetadata(input: {
  decision: EstimateReviewDecision;
  cycleId: string | null;
  cycleNumber: number | null;
  approvalIds: string[];
  ruleIds: string[];
  comments: NormalizedDecisionComment[];
  fallbackScopes?: EstimateApprovalDecisionScope[];
  summary: EstimateApprovalSummaryCore;
}): Json {
  const scopesFromComments = toDecisionAuditScopeSnapshots(input.comments);
  const scopes =
    scopesFromComments.length > 0 ? scopesFromComments : input.fallbackScopes ?? [];
  const comments: EstimateApprovalDecisionComment[] = input.comments.map((comment) => ({
    scopeType: comment.scopeType,
    scopeId: comment.scopeId,
    scopeLabel: comment.scopeLabel,
    comment: comment.comment,
  }));
  const rulesTriggered = toDecisionAuditRuleSnapshots(input.summary, input.ruleIds);

  return {
    decision: input.decision,
    approvalOutcome: resolveApprovalDecisionOutcome(input.decision),
    cycleId: input.cycleId,
    cycleNumber: input.cycleNumber,
    approvalIds: input.approvalIds,
    ruleIds: input.ruleIds,
    commentCount: comments.length,
    scopeCount: scopes.length,
    perimeterLabel: resolveDecisionEventPerimeterLabel({
      scopes,
      rulesTriggered,
    }),
    scopes,
    comments,
    rulesTriggered,
  } satisfies Json;
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
        "decided_by",
        "decision",
        "decided_at",
        "carried_over_from_cycle_id",
        "requested_by_profile:requested_by(full_name)",
        "decided_by_profile:decided_by(full_name)",
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
}): Promise<EstimateApprovalSummary> {
  const cycleRows = await listEstimateReviewCycles({
    context: input.context,
    versionId: input.version.id,
  });
  const cycleIds = cycleRows.map((cycle) => cycle.id);
  const resolvedCommentRows =
    cycleIds.length === 0
      ? []
      : await listEstimateReviewComments({
          context: input.context,
          versionId: input.version.id,
          cycleIds,
        });
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

  const activeCycleRow = cycleRows.find((cycle) => cycle.decision === null) ?? null;
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
  const requestableReasonCount = input.summary.reasons.filter(
    (reason) => reason.approvalStatus === "missing" || reason.approvalStatus === "rejected"
  ).length;
  const canRequest =
    (input.context.tenantRole === "admin" || input.context.tenantRole === "engineer") &&
    canAccessOwnerResource({
      context: input.context,
      resourceUserId: input.project.user_id,
    }) &&
    requestableReasonCount > 0;
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

  return {
    ...input.summary,
    latestDecision,
    permissions: {
      canRequest,
      canDecide,
    },
    activeCycle,
    reviewHistory,
    commentTargets: buildEstimateReviewCommentTargets({
      project: input.project,
      items: input.items,
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
      discount_bp: input.version.discount_bp,
    },
    project: {
      id: input.project.id,
      client_name: input.project.client_name,
    },
    items,
    evaluatedAt,
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

async function getAuthenticatedContext(): Promise<AuthenticatedContext> {
  const rawSupabase = await createSupabaseServerClient();
  const supabase = rawSupabase as unknown as Supabase;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw unauthorized();
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, role, is_default, created_at")
    .eq("user_id", user.id)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);

  if (membershipError) {
    throw mapSupabaseError(membershipError, "Impossible de charger le tenant courant.");
  }

  const membership = memberships?.[0] as TenantMembershipRow | undefined;

  if (!membership?.tenant_id || !membership.role) {
    throw forbidden("Aucun tenant actif pour cet utilisateur.");
  }

  return {
    supabase,
    userId: user.id,
    tenantId: membership.tenant_id,
    tenantRole: membership.role,
  };
}

async function getVersionAccessOrThrow(
  context: AuthenticatedContext,
  versionId: string
): Promise<{ version: VersionAccessRow; project: EmbeddedApprovalProjectAccess }> {
  const { data, error } = await context.supabase
    .from("estimate_versions")
    .select(
      "id, tenant_id, status, project_id, total_ht_cents, margin_bp, margin_multiplier, discount_bp, approval_status, approval_summary, approval_evaluated_at, estimate_projects!inner(id, tenant_id, user_id, name, client_name)"
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
      throw badRequest("Chaque commentaire cible doit pointer vers un lot, une ligne ou une exception.");
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
      "id, created_at, updated_at, tenant_id, version_id, cycle_number, requested_by, requested_at, decided_by, decision, decided_at, carried_over_from_cycle_id"
    )
    .eq("tenant_id", input.context.tenantId)
    .eq("version_id", input.versionId)
    .is("decision", null)
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
      "id, created_at, updated_at, tenant_id, version_id, cycle_number, requested_by, requested_at, decided_by, decision, decided_at, carried_over_from_cycle_id"
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

async function ensureOpenReviewCycle(input: {
  context: AuthenticatedContext;
  versionId: string;
}) {
  const existing = await findOpenReviewCycle(input);
  if (existing) {
    return existing;
  }

  const latestCycle = await findLatestReviewCycle(input);
  const payload: EstimateReviewCycleInsert = {
    tenant_id: input.context.tenantId,
    version_id: input.versionId,
    cycle_number: (latestCycle?.cycle_number ?? 0) + 1,
    requested_by: input.context.userId,
    requested_at: new Date().toISOString(),
    carried_over_from_cycle_id: latestCycle?.id ?? null,
  };

  const { data, error } = await input.context.supabase
    .from("estimate_review_cycles")
    .insert(payload)
    .select(
      "id, created_at, updated_at, tenant_id, version_id, cycle_number, requested_by, requested_at, decided_by, decision, decided_at, carried_over_from_cycle_id"
    )
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      const racedCycle = await findOpenReviewCycle(input);
      if (racedCycle) {
        return racedCycle;
      }
    }

    if (error) {
      throw mapSupabaseError(error, "Impossible d'ouvrir le cycle de revue.");
    }

    throw badRequest("Impossible d'ouvrir le cycle de revue.");
  }

  return data as EstimateReviewCycleRow;
}

async function listPendingApprovalsForVersion(input: {
  context: AuthenticatedContext;
  versionId: string;
}) {
  const { data, error } = await input.context.supabase
    .from("estimate_approvals")
    .select(
      "id, created_at, updated_at, tenant_id, version_id, rule_id, requested_by, approved_by, status, decided_at"
    )
    .eq("tenant_id", input.context.tenantId)
    .eq("version_id", input.versionId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les approbations en attente.");
  }

  return (data ?? []) as EstimateApprovalRow[];
}

async function listApprovalsForReviewCycle(input: {
  context: AuthenticatedContext;
  versionId: string;
  requestedAt: string;
}) {
  const { data, error } = await input.context.supabase
    .from("estimate_approvals")
    .select(
      "id, created_at, updated_at, tenant_id, version_id, rule_id, requested_by, approved_by, status, decided_at"
    )
    .eq("tenant_id", input.context.tenantId)
    .eq("version_id", input.versionId)
    .gte("created_at", input.requestedAt)
    .order("created_at", { ascending: false });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les approbations du cycle de revue.");
  }

  return (data ?? []) as EstimateApprovalRow[];
}

async function closeReviewCycle(input: {
  context: AuthenticatedContext;
  cycleId: string;
  decision: EstimateReviewDecision;
  decidedAt?: string;
}) {
  const decidedAt = input.decidedAt ?? new Date().toISOString();
  const { data, error } = await input.context.supabase
    .from("estimate_review_cycles")
    .update({
      decision: input.decision,
      decided_by: input.context.userId,
      decided_at: decidedAt,
    })
    .eq("tenant_id", input.context.tenantId)
    .eq("id", input.cycleId)
    .is("decision", null)
    .select(
      "id, created_at, updated_at, tenant_id, version_id, cycle_number, requested_by, requested_at, decided_by, decision, decided_at, carried_over_from_cycle_id"
    )
    .single();

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(error, "Impossible de cloturer le cycle de revue.");
    }

    throw badRequest("Impossible de cloturer le cycle de revue.");
  }

  return data as EstimateReviewCycleRow;
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

async function maybeCloseOpenReviewCycleAfterLegacyDecision(input: {
  context: AuthenticatedContext;
  versionId: string;
}) {
  const openCycle = await findOpenReviewCycle(input);
  if (!openCycle) {
    return null;
  }

  const pendingApprovals = await listPendingApprovalsForVersion(input);
  if (pendingApprovals.length > 0) {
    return null;
  }

  const cycleApprovals = await listApprovalsForReviewCycle({
    context: input.context,
    versionId: input.versionId,
    requestedAt: openCycle.requested_at,
  });
  const latestByRule = resolveLatestApprovalByRule({
    approvals: cycleApprovals,
  });
  const decision =
    [...latestByRule.values()].some((approval) => approval.status === "rejected")
      ? "changes_requested"
      : "approved";

  return closeReviewCycle({
    context: input.context,
    cycleId: openCycle.id,
    decision,
  });
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

async function findLatestApprovalForRule(input: {
  context: AuthenticatedContext;
  versionId: string;
  ruleId: string;
  status?: EstimateApprovalStatus;
}) {
  let query = input.context.supabase
    .from("estimate_approvals")
    .select(
      "id, created_at, updated_at, tenant_id, version_id, rule_id, requested_by, approved_by, status, decided_at"
    )
    .eq("tenant_id", input.context.tenantId)
    .eq("version_id", input.versionId)
    .eq("rule_id", input.ruleId)
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

export async function submitEstimateApproval(
  input: SubmitEstimateApprovalInput
): Promise<SubmitEstimateApprovalResult> {
  const context = await getAuthenticatedContext();
  const access = await getVersionAccessOrThrow(context, input.versionId);

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

    await ensureOpenReviewCycle({
      context,
      versionId: input.versionId,
    });

    const existingPending = await findLatestApprovalForRule({
      context,
      versionId: input.versionId,
      ruleId,
      status: "pending",
    });

    if (existingPending) {
      await syncEstimateApprovalSummary({
        context,
        version: access.version,
        project: access.project,
        trigger: "approval_request",
      });

      return {
        approval: existingPending,
      };
    }

    const payload: EstimateApprovalInsert = {
      tenant_id: context.tenantId,
      version_id: input.versionId,
      rule_id: ruleId,
      requested_by: context.userId,
      status: "pending",
      approved_by: null,
      decided_at: null,
    };

    const { data, error } = await context.supabase
      .from("estimate_approvals")
      .insert(payload)
      .select(
        "id, created_at, updated_at, tenant_id, version_id, rule_id, requested_by, approved_by, status, decided_at"
      )
      .single();

    if (error || !data) {
      if (error?.code === "23505") {
        const racedPending = await findLatestApprovalForRule({
          context,
          versionId: input.versionId,
          ruleId,
          status: "pending",
        });

        if (racedPending) {
          return {
            approval: racedPending,
          };
        }
      }

      if (error) {
        throw mapSupabaseError(error, "Impossible de creer la demande d'approbation.");
      }

      throw badRequest("Impossible de creer la demande d'approbation.");
    }

    await syncEstimateApprovalSummary({
      context,
      version: access.version,
      project: access.project,
      trigger: "approval_request",
    });

    return {
      approval: data as EstimateApprovalRow,
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
        discount_bp: access.version.discount_bp,
      },
      project: {
        id: access.project.id,
        client_name: access.project.client_name,
      },
      items,
    });
    const commentTargets = buildEstimateReviewCommentTargets({
      project: access.project,
      items,
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
    const decisionResult = await decideReviewCycleAtomically({
      context,
      cycleId: activeCycle.id,
      decision: input.decision,
      comments: normalizedComments,
    });

    await logEstimateVersionEvent({
      versionId: input.versionId,
      eventType: "approval_decided",
      actorUserId: context.userId,
      occurredAt: decidedAt,
      metadata: toApprovalDecisionAuditMetadata({
        decision: input.decision,
        cycleId: decisionResult.cycle_id,
        cycleNumber: decisionResult.cycle_number,
        approvalIds: decisionResult.approval_ids,
        ruleIds: decisionResult.rule_ids,
        comments: normalizedComments,
        fallbackScopes: summary.reasons
          .filter((reason) => decisionResult.rule_ids.includes(reason.ruleId))
          .map((reason) => ({
            scopeType: "approval_rule" as const,
            scopeId: reason.ruleId,
            scopeLabel: reason.label,
          })),
        summary,
      }),
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
        "id, created_at, updated_at, tenant_id, version_id, rule_id, requested_by, approved_by, status, decided_at"
      )
      .eq("tenant_id", context.tenantId)
      .eq("version_id", input.versionId)
      .eq("id", approvalId)
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

  const legacyItems = await loadApprovalSummaryItems({
    context,
    versionId: input.versionId,
  });
  const legacySummary = await evaluateApprovalSummary({
    supabase: context.supabase,
    tenantId: context.tenantId,
    version: {
      id: access.version.id,
      project_id: access.version.project_id,
      total_ht_cents: access.version.total_ht_cents,
      margin_bp: access.version.margin_bp,
      margin_multiplier: access.version.margin_multiplier,
      discount_bp: access.version.discount_bp,
    },
    project: {
      id: access.project.id,
      client_name: access.project.client_name,
    },
    items: legacyItems,
  });
  const legacyDecision: EstimateReviewDecision =
    input.action === "approve" ? "approved" : "changes_requested";
  const legacyRuleScope = legacySummary.reasons.find(
    (reason) => reason.ruleId === targetApproval.rule_id
  );
  const nextStatus: EstimateApprovalStatus =
    input.action === "approve" ? "approved" : "rejected";
  const decidedAt = new Date().toISOString();

  const updatePayload: EstimateApprovalUpdate = {
    status: nextStatus,
    approved_by: context.userId,
    decided_at: decidedAt,
  };

  const { data, error } = await context.supabase
    .from("estimate_approvals")
    .update(updatePayload)
    .eq("tenant_id", context.tenantId)
    .eq("id", targetApproval.id)
    .eq("status", "pending")
    .select(
      "id, created_at, updated_at, tenant_id, version_id, rule_id, requested_by, approved_by, status, decided_at"
    )
    .single();

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(error, "Impossible d'enregistrer la decision d'approbation.");
    }

    throw badRequest("Impossible d'enregistrer la decision d'approbation.");
  }

  const closedCycle = await maybeCloseOpenReviewCycleAfterLegacyDecision({
    context,
    versionId: input.versionId,
  });

  await logEstimateVersionEvent({
    versionId: input.versionId,
    eventType: "approval_decided",
    actorUserId: context.userId,
    occurredAt: (data as EstimateApprovalRow).decided_at ?? decidedAt,
    metadata: toApprovalDecisionAuditMetadata({
      decision: closedCycle?.decision ?? legacyDecision,
      cycleId: closedCycle?.id ?? null,
      cycleNumber: closedCycle?.cycle_number ?? null,
      approvalIds: [(data as EstimateApprovalRow).id],
      ruleIds: [(data as EstimateApprovalRow).rule_id],
      comments: [],
      fallbackScopes: legacyRuleScope
        ? [
            {
              scopeType: "approval_rule",
              scopeId: legacyRuleScope.ruleId,
              scopeLabel: legacyRuleScope.label,
            },
          ]
        : [],
      summary: legacySummary,
    }),
  });

  await syncEstimateApprovalSummary({
    context,
    version: access.version,
    project: access.project,
    trigger: "approval_decision",
  });

  return {
    approval: data as EstimateApprovalRow,
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
      throw mapSupabaseError(error, "Impossible de creer la regle.");
    }

    throw badRequest("Impossible de creer la regle.");
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
