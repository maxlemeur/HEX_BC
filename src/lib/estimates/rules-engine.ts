import type { TenantRole, EstimateItemRow, TenantMembershipAccessRow, ExtendedEstimateRuleType, EstimateRuleScopeType, EstimateRuleAction, EstimateApprovalStatus, EstimateReviewDecision, EstimateReviewCorrectionStatus, EstimateVersionApprovalStatus, EstimateRuleRow, EstimateRuleInsert, EstimateRuleUpdate, EstimateApprovalRow, EstimateReviewCycleRow, EstimateReviewCorrectionItemRow, EstimateRiskAlertTargetRow, AffaireRegisterHypothesisTargetRow, EstimateAuditLogRow, DecideEstimateReviewCycleResult, Supabase, AuthenticatedContext, EmbeddedReviewerProfile, EmbeddedApprovalProjectAccess, VersionAccessRow, EstimateReviewCycleWithProfilesRow, EstimateReviewCommentWithProfilesRow, EstimateReviewCorrectionItemWithProfilesRow, EstimateReviewCorrectionEventWithProfilesRow, EstimateApprovalDecisionEventRow, RulesEngineVersion, RulesEngineProject, RulesEngineItemAccess, EstimateRuleViolation, EvaluateRulesResult, EstimateApprovalDecisionCommentInput, SubmitEstimateApprovalInput, SubmitEstimateApprovalResult, RuleSignalContext, ApprovalSummaryReason, EstimateApprovalCommentTarget, EstimateApprovalCorrectionEvent, EstimateApprovalCorrectionItem, EstimateApprovalChangeField, EstimateApprovalChangesSinceLastCycle, EstimateApprovalReviewComment, EstimateApprovalReviewer, EstimateApprovalReviewCycle, EstimateApprovalSubmissionSignal, EstimateApprovalSummaryCore, EstimateApprovalSummary, ApprovalAuditTrigger, EstimateRulesWithApprovals, NormalizedDecisionComment } from "@/lib/estimates/approval-types";
import { evaluateLoadedRules, resolveLatestApprovalByRule, normalizeThresholdValue, formatPercentBp, formatEuroCents } from "@/lib/estimates/rule-evaluation";
import { readAllRows, readAllRowsInChunks } from "@/lib/supabase/read-all";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAffaireRegisterHubHref } from "@/lib/affaires/register";
import { createOptionalServiceRoleClient } from "@/lib/supabase/service-role";
import { startConcurrentRead } from "@/lib/supabase/concurrent-read";
import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { buildAffaireRegisterSubmissionSignalMessage, fetchAffaireRegisterGateSummary } from "@/lib/affaires/register-server";
import { sendApprovalReviewRequestNotification } from "@/lib/email/send-approval-review-request";
import { freezeApprovalV2DraftIfRequired } from "@/lib/estimates/approval-v2-snapshot";
import { openEstimateReviewCycle } from "@/lib/estimates/review-cycle-submission";
import { requireEstimateEngineVersion } from "@/lib/estimates/engine/capabilities";
import { loadV3MarginEvidence, type V3MarginEvidence } from "@/lib/estimates/v3-margin-evidence-server";
import { type CanonicalFixedDiscountEvidence } from "@/lib/estimates/effective-discount";
import { loadCanonicalFixedDiscountEvidence } from "@/lib/estimates/fixed-discount-evidence-server";
import type { EstimateReadinessCategory } from "@/lib/estimates/readiness";
import { fetchVersionZeroDraftSummary } from "@/lib/estimates/version-zero-drafts";
import { isEstimateAiDraftEnabled } from "@/lib/estimates/ai-draft-availability";
import { normalizeEstimateApprovalDecision, resolveApprovalDecisionOutcome, type EstimateApprovalDecisionComment, type EstimateApprovalDecisionEvent, type EstimateApprovalDecisionFilter, type EstimateApprovalDecisionJournal, type EstimateApprovalDecisionRule, type EstimateApprovalDecisionScope } from "@/lib/estimates/approval-decision-journal";
import type { Database, Json } from "@/types/database";
import { computeEstimateItemNumbering } from "@/lib/estimates/numbering";
import { badRequest, conflict, forbidden, mapSupabaseError, notFound } from "./errors";
import { readAllEstimateItems } from "./read-all-items-server";

async function getAuthenticatedContext(): Promise<AuthenticatedContext> {
  const context = await getAuthenticatedTenantContext();

  return {
    supabase: context.supabase,
    userId: context.userId,
    tenantId: context.tenantId,
    tenantRole: context.tenantRole,
  };
}

const TENANT_ADMIN_ROLE: TenantRole = "admin";
const TENANT_DIRECTOR_ROLE: TenantRole = "director";

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

const APPROVAL_CHANGE_FIELD_LABELS: Record<string, string> = {
  margin_bp: "Marge",
  discount_bp: "Remise",
  discount_amount_cents: "Remise fixe",
  validite_jours: "Validité",
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
  currency?: string;
}) {
  if (input.value === null || input.value === undefined) {
    return "-";
  }

  if (input.field === "discount_amount_cents") {
    const currency = ["EUR", "USD", "GBP"].includes(input.currency ?? "") ? input.currency! : "EUR";
    return typeof input.value === "number" && Number.isFinite(input.value)
      ? new Intl.NumberFormat("fr-FR", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(input.value / 100)
      : String(input.value);
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
  return supabase;
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
    readAllRows(() => input.supabase
      .from("takeoff_jobs")
      .select("id", { count: "exact" })
      .eq("tenant_id", input.tenantId)
      .eq("estimate_version_id", input.versionId)),
    readAllRows(() => input.supabase
      .from("takeoff_version_links")
      .select("takeoff_job_id, id", { count: "exact" })
      .eq("tenant_id", input.tenantId)
      .eq("target_version_id", input.versionId)),
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
    const { data, error } = await readAllRowsInChunks(relatedJobIds, (pageIds) => input.supabase
      .from("takeoff_items")
      .select("id, evidence", { count: "exact" })
      .eq("tenant_id", input.tenantId)
      .in("job_id", pageIds));

    if (error) {
      throw mapSupabaseError(
        error,
        "Impossible de charger les preuves takeoff pour les règles d'approbation."
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
    const { data, error } = await readAllRowsInChunks(relatedJobIds, (pageIds) => input.supabase
      .from("takeoff_dpgf_links")
      .select("estimate_item_id, id", { count: "exact" })
      .eq("tenant_id", input.tenantId)
      .eq("version_id", input.versionId)
      .in("takeoff_job_id", pageIds));

    if (error) {
      throw mapSupabaseError(
        error,
        "Impossible de charger la couverture DPGF pour les règles d'approbation."
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

async function loadCurrentEstimateContentRevision(input: {
  supabase: Supabase;
  versionId: string;
}) {
  const { data, error } = await input.supabase.rpc(
    "get_estimate_content_revision",
    {
      p_version_id: input.versionId,
    }
  );

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de vérifier la révision du devis."
    );
  }

  const revision = Number(data);
  if (!Number.isSafeInteger(revision) || revision <= 0) {
    throw badRequest("Impossible de vérifier la révision du devis.");
  }

  return revision;
}

/** The tenant's active rules and the version's current approvals for them: no item is needed. */
async function loadEstimateRulesWithApprovals(input: {
  supabase: SupabaseClient<Database> | Supabase;
  tenantId: string;
  versionId: string;
}): Promise<EstimateRulesWithApprovals> {
  const supabase = toRulesSupabaseClient(input.supabase);

  const { data: rulesData, error: rulesError } = await readAllRows(() => supabase
    .from("estimate_rules")
    .select(
      "id, created_at, updated_at, tenant_id, rule_type, scope_type, scope_id, threshold_value, action, is_active",
      { count: "exact" }
    )
    .eq("tenant_id", input.tenantId)
    .eq("is_active", true)
    .order("created_at", { ascending: true }));

  if (rulesError) {
    throw mapSupabaseError(rulesError, "Impossible de charger les règles de devis.");
  }

  const rules = ((rulesData ?? []) as EstimateRuleRow[]).map((rule) => {
    const normalizedThreshold = normalizeThresholdValue(rule.threshold_value);
    return {
      ...rule,
      threshold_value: normalizedThreshold ?? 0,
    } satisfies EstimateRuleRow;
  });

  if (rules.length === 0) {
    return { rules, approvals: [] };
  }

  const relevantRuleIds = rules.map((rule) => rule.id);
  const { data: approvalsData, error: approvalsError } = await readAllRowsInChunks(relevantRuleIds, (pageIds) => supabase
    .from("estimate_approvals")
    .select(
      "id, created_at, updated_at, tenant_id, version_id, rule_id, requested_by, approved_by, status, decided_at, approved_content_revision, review_cycle_id, superseded_at",
      { count: "exact" }
    )
    .eq("tenant_id", input.tenantId)
    .eq("version_id", input.versionId)
    .in("rule_id", pageIds)
    .is("superseded_at", null)
    .order("created_at", { ascending: false }), { order: [{ column: "created_at", ascending: false }] });

  if (approvalsError) {
    throw mapSupabaseError(
      approvalsError,
      "Impossible de charger les approbations de devis."
    );
  }

  return { rules, approvals: (approvalsData ?? []) as EstimateApprovalRow[] };
}

export async function evaluateRules(input: {
  supabase: SupabaseClient<Database> | Supabase;
  tenantId: string;
  version: RulesEngineVersion;
  project: RulesEngineProject;
  items: RulesEngineItemAccess[];
  preserveApprovedRequiresApproval?: boolean;
  fixedDiscountEvidence?: CanonicalFixedDiscountEvidence | null;
  v3MarginEvidence?: V3MarginEvidence | null;
  /** Started earlier by a caller that reads them alongside its items. */
  rulesWithApprovals?: Promise<EstimateRulesWithApprovals>;
}): Promise<EvaluateRulesResult> {
  const supabase = toRulesSupabaseClient(input.supabase);
  const { rules, approvals } = await (input.rulesWithApprovals ?? loadEstimateRulesWithApprovals({
    supabase,
    tenantId: input.tenantId,
    versionId: input.version.id,
  }));

  if (rules.length === 0) {
    return {
      violations: [],
      blockingViolations: [],
      warningViolations: [],
      unavailableSignals: [],
    };
  }

  const lineItemIds: string[] = [];
  input.items.forEach((item) => {
    if (item.item_type === "line") {
      lineItemIds.push(item.id);
    }
  });

  const signalContext = await loadRuleSignalContext({
    supabase,
    tenantId: input.tenantId,
    versionId: input.version.id,
    lineItemIds,
    rules,
  });

  const latestApprovalByRule = resolveLatestApprovalByRule({
    approvals,
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

  return evaluateLoadedRules({
    rules, latestApprovalByRule, version: input.version, project: input.project, items: input.items,
    signalContext, currentContentRevision,
    preserveApprovedRequiresApproval: input.preserveApprovedRequiresApproval,
    fixedDiscountEvidence: input.fixedDiscountEvidence,
    v3MarginEvidence: input.v3MarginEvidence,
  });
}

function resolveApprovalSummaryLabel(ruleType: ExtendedEstimateRuleType) {
  if (ruleType === "min_margin") return "Marge minimum";
  if (ruleType === "max_discount") return "Remise maximum";
  if (ruleType === "require_approval") return "Seuil montant HT";
  if (ruleType === "dpgf_coverage_min") return "Couverture DPGF minimum";
  if (ruleType === "takeoff_evidence_coverage_min") return "Couverture minimale des preuves de métré";
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

async function loadSubmissionReadinessRegisterContext(input: {
  supabase: SupabaseClient<Database> | Supabase;
  projectId: string;
  versionId: string;
}) {
  const [registerSummary, versionZeroSummary] = await Promise.all([
    fetchAffaireRegisterGateSummary({
      supabase: input.supabase,
      projectId: input.projectId,
      versionId: input.versionId,
    }),
    fetchVersionZeroDraftSummary({ versionId: input.versionId }).catch(() => null),
  ]);
  return { registerSummary, versionZeroSummary };
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
  return applySubmissionReadinessRegisterContext({
    ...input,
    ...(await loadSubmissionReadinessRegisterContext(input)),
  });
}

function applySubmissionReadinessRegisterContext(input: {
  projectId: string;
  versionId: string;
  submissionReadiness: {
    blockers: EstimateApprovalSubmissionSignal[];
    alerts: EstimateApprovalSubmissionSignal[];
  };
} & Awaited<ReturnType<typeof loadSubmissionReadinessRegisterContext>>) {
  const { registerSummary, versionZeroSummary } = input;
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
          intro: "Des pièces critiques restent manquantes avant soumission.",
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
          intro: "Des pièces manquantes restent ouvertes avant validation.",
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
          intro: "Des hypothèses restent ouvertes avant validation.",
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
          intro: "Des pièces restent à demander au client avant envoi externe.",
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
            "Des points restent à clarifier avec le client avant envoi externe.",
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
            : "Une V0 IA active doit être matérialisée ou abandonnée avant soumission.",
        category: "estimate_quality",
        actionLabel: isEstimateAiDraftEnabled() ? "Ouvrir la V0" : undefined,
        actionHref: isEstimateAiDraftEnabled()
          ? `/dashboard/estimates/${input.versionId}/edit?openVersionZero=1`
          : undefined,
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

async function evaluateSubmissionReadiness(input: {
  supabase: SupabaseClient<Database> | Supabase;
  tenantId: string;
  version: RulesEngineVersion;
  project: RulesEngineProject;
  items: RulesEngineItemAccess[];
  fixedDiscountEvidence?: CanonicalFixedDiscountEvidence | null;
  v3MarginEvidence?: V3MarginEvidence | null;
}) {
  const rulesEvaluation = await evaluateRules({
    supabase: input.supabase,
    tenantId: input.tenantId,
    version: input.version,
    project: input.project,
    items: input.items,
    preserveApprovedRequiresApproval: true,
    fixedDiscountEvidence: input.fixedDiscountEvidence,
    v3MarginEvidence: input.v3MarginEvidence,
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

async function listEstimateReviewComments(input: {
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

async function listEstimateReviewCorrectionItems(input: {
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

async function listEstimateReviewCorrectionEvents(input: {
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

  const { data, error } = await readAllRows(() => auditClient
    .from("audit_logs")
    .select("created_at, table_name, record_id, action, before_data, after_data, id", { count: "exact" })
    .eq("estimate_version_id", input.version.id)
    .gte("created_at", input.sourceCycle.decidedAt)
    .in("table_name", ["estimate_versions", "estimate_items"])
    .order("created_at", { ascending: true }));

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
    "discount_amount_cents",
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
        before: formatChangeFieldValue({ field, value: baseline, currency: input.version.currency }),
        after: formatChangeFieldValue({ field, value: current, currency: input.version.currency }),
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
      "Impossible d'enregistrer l'événement d'approbation."
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
  const items = await readAllEstimateItems({
    supabase: input.context.supabase,
    tenantId: input.context.tenantId,
    versionId: input.versionId,
  });
  return items.map(({ id, category_id, item_type, title, parent_id, position }) => ({
    id, category_id, item_type, title, parent_id, position,
  })) satisfies RulesEngineItemAccess[];
}

async function loadApprovalCommentTargetContext(input: {
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

async function syncEstimateApprovalSummary(input: {
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
    reviewReads,
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

async function getVersionAccessOrThrow(
  context: AuthenticatedContext,
  versionId: string
): Promise<{ version: VersionAccessRow; project: EmbeddedApprovalProjectAccess }> {
  const { data, error } = await context.supabase
    .from("estimate_versions")
    .select(
      "id, tenant_id, status, updated_at, content_revision, calc_engine_version, calc_snapshot_content_revision, calc_snapshot_context, version_number, project_id, title, date_devis, validite_jours, total_ht_cents, margin_bp, global_coefficient, margin_multiplier, margin_mode, discount_bp, discount_amount_cents, gross_ht_cents, discount_applied_cents, currency, tax_rate_bp, rounding_mode, rounding_step_cents, approval_status, approval_summary, approval_evaluated_at, estimate_projects!inner(id, tenant_id, user_id, name, client_name)"
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
  throw forbidden("Action réservée aux administrateurs.");
}

function assertRequesterRole(context: Pick<AuthenticatedContext, "tenantRole">) {
  if (context.tenantRole === "admin" || context.tenantRole === "engineer") {
    return;
  }
  throw forbidden("Action réservée aux demandeurs d'approbation.");
}

function assertApproverRole(context: Pick<AuthenticatedContext, "tenantRole">) {
  if (isTenantApprover(context.tenantRole)) {
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
      throw forbidden("Action réservée au proprietaire du chiffrage.");
    }

    if (await freezeApprovalV2DraftIfRequired(context, access.version))
      access = await getVersionAccessOrThrow(context, input.versionId);
    const items = await loadApprovalSummaryItems({
      context,
      versionId: input.versionId,
    });
    const fixedDiscountEvidence = await loadCanonicalFixedDiscountEvidence({
      supabase: context.supabase, tenantId: context.tenantId,
      projectUserId: access.project.user_id, authorizedVersion: access.version,
    });
    const v3MarginEvidence = await loadV3MarginEvidence({
      supabase: context.supabase, tenantId: context.tenantId,
      projectUserId: access.project.user_id, authorizedVersion: access.version,
    });
    const [summary, submissionReadiness, assignedReviewer] = await Promise.all([
      evaluateApprovalSummary({
        supabase: context.supabase,
        tenantId: context.tenantId,
        fixedDiscountEvidence,
        v3MarginEvidence,
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
        items,
      }),
      evaluateSubmissionReadiness({
        supabase: context.supabase,
        tenantId: context.tenantId,
        fixedDiscountEvidence,
        v3MarginEvidence,
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
        items,
      }),
      resolveAssignedReviewerOrThrow({
        context,
        reviewerUserId: normalizeOptionalUuid(input.assignedReviewerUserId ?? undefined),
      }),
    ]);

    if (submissionReadiness.blockers.length > 0) {
      throw badRequest("Des blocants restent à lever avant la soumission.");
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
        throw badRequest("Tous les items de correction doivent être traités avant la resoumission.");
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
      throw badRequest("Aucune règle de validation ne peut être soumise.");
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
          : "Règle de validation",
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
      throw forbidden("Action réservée au proprietaire du chiffrage.");
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
      throw badRequest("La règle ciblee est inactive.");
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
    const fixedDiscountEvidence = await loadCanonicalFixedDiscountEvidence({
      supabase: context.supabase, tenantId: context.tenantId,
      projectUserId: access.project.user_id, authorizedVersion: access.version,
    });
    const v3MarginEvidence = await loadV3MarginEvidence({
      supabase: context.supabase, tenantId: context.tenantId,
      projectUserId: access.project.user_id, authorizedVersion: access.version,
    });
    const summary = await evaluateApprovalSummary({
      supabase: context.supabase,
      tenantId: context.tenantId,
      fixedDiscountEvidence,
      v3MarginEvidence,
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
      throw badRequest("rule_id ou approval_id est requis pour une décision.");
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

  const { data, error } = await readAllRows(() => context.supabase
    .from("estimate_rules")
    .select(
      "id, created_at, updated_at, tenant_id, rule_type, scope_type, scope_id, threshold_value, action, is_active",
      { count: "exact" }
    )
    .eq("tenant_id", context.tenantId)
    .order("created_at", { ascending: true }));

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les règles.");
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
    throw badRequest("Aucun champ à mettre à jour.");
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
      throw notFound("Règle introuvable.");
    }

    if (error) {
      throw mapSupabaseError(error, "Impossible de mettre à jour la règle.");
    }

    throw notFound("Règle introuvable.");
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
      throw notFound("Règle introuvable.");
    }

    if (error) {
      throw mapSupabaseError(error, "Impossible de supprimer la règle.");
    }

    throw notFound("Règle introuvable.");
  }

  return {
    deleted_id: data.id,
  };
}

export type { EstimateReviewDecision, EstimateReviewCommentScope, EstimateReviewCorrectionStatus, EstimateVersionApprovalStatus, RulesEngineVersion, RulesEngineProject, RulesEngineItem, RulesEngineItemAccess, RuleViolationSeverity, EstimateRuleViolation, EstimateRuleUnavailableSignal, EvaluateRulesResult, EstimateRuleRecord, EstimateApprovalDecisionCommentInput, SubmitEstimateApprovalAction, SubmitEstimateApprovalInput, SubmitEstimateApprovalResult, SubmitEstimateReviewRequestInput, SubmitEstimateReviewRequestResult, EstimateApprovalCommentTarget, EstimateApprovalCorrectionEvent, EstimateApprovalCorrectionItem, EstimateApprovalCorrectionChecklist, EstimateApprovalChangeField, EstimateApprovalChangesSinceLastCycle, EstimateApprovalReviewComment, EstimateApprovalReviewer, EstimateApprovalReviewCycle, EstimateApprovalSubmissionSignal, EstimateApprovalSummary } from "@/lib/estimates/approval-types";
export { checkMarginRule, checkDiscountRule, checkApprovalRule } from "@/lib/estimates/rule-evaluation";
