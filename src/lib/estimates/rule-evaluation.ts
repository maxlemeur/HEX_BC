import { resolveEffectiveMarginBp, resolveV3NetMarginBp } from "@/lib/estimates/effective-margin";
import { usesSaleCoefficients } from "@/lib/estimates/engine/capabilities";
import { resolveEstimateEngineVersionForDisplay } from "@/lib/estimates/calc-engine-version";
import { type V3MarginEvidence } from "@/lib/estimates/v3-margin-evidence-server";
import { exceedsDiscountThreshold, fixedDiscountBasisPoints, resolveFixedDiscountSignal, type CanonicalFixedDiscountEvidence } from "@/lib/estimates/effective-discount";
import type { EstimateRuleAction, EstimateRuleRow, EstimateApprovalRow, RulesEngineVersion, RulesEngineProject, RulesEngineItemAccess, RuleViolationSeverity, EstimateRuleViolation, EstimateRuleUnavailableSignal, EvaluateRulesResult, RuleCheckInput, RuleCheckResult, RuleSignalContext } from "@/lib/estimates/approval-types";

export function toFiniteNumber(value: unknown, fallback = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

export function normalizeThresholdValue(value: unknown) {
  const normalized = toFiniteNumber(value, NaN);
  if (!Number.isFinite(normalized)) {
    return null;
  }
  return normalized;
}

export const PERCENT_FORMATTER = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export const CURRENCY_FORMATTER = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatPercentBp(value: number) {
  return `${PERCENT_FORMATTER.format(value / 100)}%`;
}

export function formatEuroCents(value: number) {
  return CURRENCY_FORMATTER.format(value / 100);
}

export function isRuleInScope(input: {
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

export function isApprovalRule(rule: EstimateRuleRow) {
  return rule.action === "require_approval" || rule.rule_type === "require_approval";
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
    violated: actualValue >= threshold,
    actualValue,
    threshold,
  };
}

export function resolveSeverityForRuleAction(action: EstimateRuleAction): RuleViolationSeverity {
  if (action === "warn") return "warning";
  return "blocking";
}

export function resolveMetricForRule(input: {
  rule: EstimateRuleRow;
  version: RulesEngineVersion;
  signalContext: RuleSignalContext;
  fixedDiscountEvidence?: CanonicalFixedDiscountEvidence | null;
  v3MarginEvidence?: V3MarginEvidence | null;
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
    // Lot 2, sous-lot 2.5 (D5, F20) : marque nette v3 depuis sa preuve ou un gel frais ; sans elle,
    // le signal est indisponible, jamais une marge de 0. Les v1/v2 ne changent pas.
    const engine = resolveEstimateEngineVersionForDisplay(version);
    if (engine !== null && usesSaleCoefficients(engine)) {
      const netMarginBp = resolveV3NetMarginBp(version, input.v3MarginEvidence);
      if (netMarginBp === null) return { metricKey: "margin_bp", comparator: ">=", sourceState: "unavailable" };
      return {
        metricKey: "margin_bp",
        check: checkMarginRule({ actualValue: netMarginBp, threshold: thresholdValue }),
        comparator: ">=",
        sourceState: "ready",
      };
    }
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
    const fixed = resolveFixedDiscountSignal(version, input.fixedDiscountEvidence);
    if (fixed.state === "unavailable") return {
      metricKey: "discount_bp", comparator: "<=", sourceState: "unavailable",
    };
    if (fixed.state === "ready") return {
      metricKey: "discount_bp", comparator: "<=", sourceState: "ready",
      check: { violated: exceedsDiscountThreshold(fixed, thresholdValue),
        actualValue: fixedDiscountBasisPoints(fixed), threshold: Math.max(0, thresholdValue) },
    };
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

export function resolveViolationMessage(input: {
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
    base = `Couverture des preuves de métré ${formatPercentBp(input.actualValue)} sous le minimum ${formatPercentBp(input.thresholdValue)}.`;
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

  return `${base} Approbation enregistrée.`;
}

export function resolveUnavailableSignalMessage(input: {
  rule: EstimateRuleRow;
  metricKey: EstimateRuleUnavailableSignal["metric_key"];
}) {
  if (input.rule.rule_type === "max_discount") {
    return "Signal indisponible : l'assiette et le montant appliqué de la remise fixe ne peuvent pas être vérifiés pour cette version.";
  }
  if (input.rule.rule_type === "min_margin") {
    return "Signal indisponible : la marge nette de cette version ne peut pas être prouvée pour sa révision courante.";
  }
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

export function resolveLatestApprovalByRule(input: {
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

/** Evaluate already-authorized evidence; no database, authentication, or notification work. */
export function evaluateLoadedRules(input: {
  rules: EstimateRuleRow[];
  latestApprovalByRule: ReadonlyMap<string, EstimateApprovalRow>;
  version: RulesEngineVersion;
  project: RulesEngineProject;
  items: RulesEngineItemAccess[];
  signalContext: RuleSignalContext;
  currentContentRevision: number | null;
  preserveApprovedRequiresApproval?: boolean;
  fixedDiscountEvidence?: CanonicalFixedDiscountEvidence | null;
  v3MarginEvidence?: V3MarginEvidence | null;
}): EvaluateRulesResult {
  const { rules, latestApprovalByRule, signalContext, currentContentRevision } = input;
  const categoryIdSet = new Set(input.items.map(item => item.category_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0));
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
      fixedDiscountEvidence: input.fixedDiscountEvidence,
      v3MarginEvidence: input.v3MarginEvidence,
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
        rule.rule_type !== "max_discount" &&
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
