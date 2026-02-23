import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

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
type EstimateRuleScopeType = "global" | "category" | "client";
type EstimateRuleAction = "warn" | "block" | "require_approval";
type EstimateApprovalStatus = "pending" | "approved" | "rejected";

type EstimateRuleRow = {
  id: string;
  created_at: string;
  updated_at: string;
  tenant_id: string;
  rule_type: EstimateRuleType;
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
  rule_type: EstimateRuleType;
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

type DatabaseWithRules = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Database["public"]["Tables"] & {
      estimate_rules: EstimateRulesTable;
      estimate_approvals: EstimateApprovalsTable;
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

type EmbeddedProjectAccess = Pick<EstimateProjectRow, "id" | "tenant_id" | "user_id">;

type VersionAccessRow = Pick<
  EstimateVersionRow,
  "id" | "tenant_id" | "status" | "project_id"
> & {
  estimate_projects: EmbeddedProjectAccess | EmbeddedProjectAccess[] | null;
};

const TENANT_ADMIN_ROLE: TenantRole = "admin";

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

export type RuleViolationSeverity = "blocking" | "warning";

export type EstimateRuleViolation = {
  rule_id: string;
  rule_type: EstimateRuleType;
  scope_type: EstimateRuleScopeType;
  scope_id: string | null;
  threshold_value: number;
  action: EstimateRuleAction;
  severity: RuleViolationSeverity;
  metric_key: "margin_bp" | "discount_bp" | "total_ht_cents";
  actual_value: number;
  comparator: ">=" | "<=";
  approval_status: EstimateApprovalStatus | "missing" | null;
  approval_id: string | null;
  message: string;
};

export type EvaluateRulesResult = {
  violations: EstimateRuleViolation[];
  blockingViolations: EstimateRuleViolation[];
  warningViolations: EstimateRuleViolation[];
};

export type EstimateRuleRecord = EstimateRuleRow;

export type SubmitEstimateApprovalAction = "request" | "approve" | "reject";

export type SubmitEstimateApprovalInput = {
  versionId: string;
  action: SubmitEstimateApprovalAction;
  ruleId?: string;
  approvalId?: string;
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

function resolveEmbeddedOne<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
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

function canAccessOwnerResource(input: {
  context: Pick<AuthenticatedContext, "userId" | "tenantRole">;
  resourceUserId: string;
}) {
  return (
    input.resourceUserId === input.context.userId ||
    isTenantAdmin(input.context.tenantRole)
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
}):
  | {
      metricKey: EstimateRuleViolation["metric_key"];
      check: RuleCheckResult;
      comparator: EstimateRuleViolation["comparator"];
    }
  | null {
  const { rule, version } = input;
  const thresholdValue = rule.threshold_value;

  if (rule.rule_type === "min_margin") {
    return {
      metricKey: "margin_bp",
      check: checkMarginRule({
        actualValue: resolveVersionMarginBp(version),
        threshold: thresholdValue,
      }),
      comparator: ">=",
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
  const base = `Regle ${input.rule.rule_type} (${input.metricKey}) non respectee: ${input.actualValue} (seuil ${input.thresholdValue}).`;

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
  items: RulesEngineItem[];
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
    };
  }

  const categoryIdSet = new Set<string>();
  input.items.forEach((item) => {
    const categoryId = item.category_id ?? null;
    if (typeof categoryId !== "string" || categoryId.length === 0) {
      return;
    }
    categoryIdSet.add(categoryId);
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

  rules.forEach((rule) => {
    if (!isRuleInScope({ rule, project: input.project, categoryIdSet })) {
      return;
    }

    const metric = resolveMetricForRule({
      rule,
      version: input.version,
    });

    if (!metric || !metric.check.violated) {
      return;
    }

    const latestApproval = latestApprovalByRule.get(rule.id) ?? null;
    const requiresApproval =
      rule.action === "require_approval" || rule.rule_type === "require_approval";

    if (requiresApproval && latestApproval?.status === "approved") {
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
  };
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
): Promise<{ version: VersionAccessRow; project: EmbeddedProjectAccess }> {
  const { data, error } = await context.supabase
    .from("estimate_versions")
    .select("id, tenant_id, status, project_id, estimate_projects!inner(id, tenant_id, user_id)")
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
    !canAccessOwnerResource({
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

function normalizeOptionalUuid(value: string | undefined) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
  await getVersionAccessOrThrow(context, input.versionId);

  if (input.action === "request") {
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

    const existingPending = await findLatestApprovalForRule({
      context,
      versionId: input.versionId,
      ruleId,
      status: "pending",
    });

    if (existingPending) {
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

    return {
      approval: data as EstimateApprovalRow,
    };
  }

  assertAdminRole(context);

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

  const nextStatus: EstimateApprovalStatus =
    input.action === "approve" ? "approved" : "rejected";

  const updatePayload: EstimateApprovalUpdate = {
    status: nextStatus,
    approved_by: context.userId,
    decided_at: new Date().toISOString(),
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
  rule_type: EstimateRuleType;
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
    rule_type?: EstimateRuleType;
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
