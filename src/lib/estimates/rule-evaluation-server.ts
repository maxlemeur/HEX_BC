import type { ExtendedEstimateRuleType, EstimateRuleRow, EstimateApprovalRow, Supabase, RulesEngineVersion, RulesEngineProject, RulesEngineItemAccess, EvaluateRulesResult, RuleSignalContext, EstimateRulesWithApprovals } from "@/lib/estimates/approval-types";
import { evaluateLoadedRules, resolveLatestApprovalByRule, normalizeThresholdValue } from "@/lib/estimates/rule-evaluation";
import { readAllRows, readAllRowsInChunks } from "@/lib/supabase/read-all";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { V3MarginEvidence } from "@/lib/estimates/v3-margin-evidence-server";
import type { CanonicalFixedDiscountEvidence } from "@/lib/estimates/effective-discount";
import type { Database } from "@/types/database";
import { badRequest, mapSupabaseError } from "@/lib/http/api-response";

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
export async function loadEstimateRulesWithApprovals(input: {
  supabase: SupabaseClient<Database> | Supabase;
  tenantId: string;
  versionId: string;
}): Promise<EstimateRulesWithApprovals> {
  const supabase = input.supabase;

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
  const supabase = input.supabase;
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
