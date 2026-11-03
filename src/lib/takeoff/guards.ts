import { blockingRules } from "@/lib/takeoff/rules/blocking";
import type { TakeoffRuleResult } from "@/lib/takeoff/rules/types";
import type { TakeoffJobItem } from "@/lib/takeoff/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.5;
export const MEDIUM_CONFIDENCE_CEILING = 0.8;

export type TakeoffVerificationIssue =
  | "missing_evidence"
  | "missing_source_page";

export type ApplyGuardBlockReason =
  | "low_confidence"
  | TakeoffVerificationIssue
  | "rule_failed"
  | "rules_stale";

export const APPLY_GUARD_REASON_LABELS: Record<ApplyGuardBlockReason, string> = {
  low_confidence: "Confiance faible non vérifiée",
  missing_evidence: "Preuve manquante",
  missing_source_page: "Page source manquante",
  rule_failed: "Règle en échec",
  rules_stale: "Règles à recalculer",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GuardBlockedItem = {
  item_id: string;
  designation: string;
  confidence: number | null;
  is_verified: boolean;
  reasons: ApplyGuardBlockReason[];
  /** The failed rules that still block the line (TI-664), with their code and reason. */
  rule_failures?: Array<Pick<TakeoffRuleResult, "rule" | "code" | "reason" | "acceptable">>;
};

export type GuardMediumItem = {
  item_id: string;
  designation: string;
  confidence: number;
};

export type ApplyGuardResult = {
  passed: boolean;
  blocked_items: GuardBlockedItem[];
  medium_items: GuardMediumItem[];
  threshold: number;
};

export type TakeoffVerificationReadiness = {
  canVerify: boolean;
  issues: TakeoffVerificationIssue[];
  message: string | null;
};

export function getTakeoffVerificationReadiness(
  item: Pick<TakeoffJobItem, "evidence" | "source_page">
): TakeoffVerificationReadiness {
  const issues: TakeoffVerificationIssue[] = [];

  if (!item.evidence?.trim()) {
    issues.push("missing_evidence");
  }
  if (typeof item.source_page !== "number" || item.source_page < 1) {
    issues.push("missing_source_page");
  }

  let message: string | null = null;
  if (issues.length === 2) {
    message =
      "Ajoutez une preuve et localisez sa page source avant de valider cet item.";
  } else if (issues.includes("missing_evidence")) {
    message = "Ajoutez une preuve avant de valider cet item.";
  } else if (issues.includes("missing_source_page")) {
    message =
      "La page source est absente. Excluez l’item ou faites corriger l’extraction avant de le valider.";
  }

  return {
    canVerify: issues.length === 0,
    issues,
    message,
  };
}

// ---------------------------------------------------------------------------
// Pure guard check
// ---------------------------------------------------------------------------

export type ApplyGuardItem = Pick<
  TakeoffJobItem,
  | "id"
  | "designation"
  | "confidence"
  | "evidence"
  | "source_page"
  | "is_verified"
  | "is_excluded"
> & {
  /** Fixed-rule results of the line (TI-664); absent or empty: no rule reads it. */
  rule_results?: readonly TakeoffRuleResult[] | null;
  /** The line changed after its rules ran: they no longer hold until the server computes them again. */
  rules_stale?: boolean | null;
};

/**
 * Pure function: checks whether the included items of a job are safe to apply, line by line exactly as the database
 * trigger enforce_takeoff_apply_security counts them, so that both block the same lines (and an admin override's
 * audit, written from this result, matches the trigger's count).
 *
 * - Level C (the existing reasons): missing proof/source, or confidence < threshold while unverified.
 * - Every level (TI-664): stale rule results, or a failed rule while unverified, or a failed rule verifying never
 *   settles (a quantity to enter) — rules/blocking.ts, mirrored by takeoff_item_rule_blocked in SQL.
 * - Medium  = level C, threshold ≤ confidence < MEDIUM_CONFIDENCE_CEILING AND is_verified === false, not blocked.
 * - `passed` is true when no blocked items exist. Without a level, the job is read as level C (the only level the
 *   guard ran on before TI-664).
 */
export function checkApplyGuard(
  items: ApplyGuardItem[],
  threshold: number = DEFAULT_LOW_CONFIDENCE_THRESHOLD,
  context: { level?: string | null } = {}
): ApplyGuardResult {
  const blocked_items: GuardBlockedItem[] = [];
  const medium_items: GuardMediumItem[] = [];
  const levelC = (context.level ?? "C") === "C";

  for (const item of items) {
    // Only consider included items
    if (item.is_excluded) continue;

    const conf = item.confidence;
    const reasons: ApplyGuardBlockReason[] = levelC ? [...getTakeoffVerificationReadiness(item).issues] : [];

    if (levelC && !item.is_verified && (conf === null || conf < threshold)) {
      reasons.unshift("low_confidence");
    }
    const failures = blockingRules(item.rule_results, item.is_verified);
    if (failures.length > 0) reasons.push("rule_failed");
    if (item.rules_stale) reasons.push("rules_stale");

    if (reasons.length > 0) {
      blocked_items.push({
        item_id: item.id,
        designation: item.designation,
        confidence: conf,
        is_verified: item.is_verified,
        reasons,
        ...(failures.length > 0
          ? { rule_failures: failures.map(({ rule, code, reason, acceptable }) => ({ rule, code, reason, acceptable })) }
          : {}),
      });
    } else if (
      levelC &&
      !item.is_verified &&
      conf !== null &&
      conf < MEDIUM_CONFIDENCE_CEILING
    ) {
      medium_items.push({
        item_id: item.id,
        designation: item.designation,
        confidence: conf,
      });
    }
  }

  return {
    passed: blocked_items.length === 0,
    blocked_items,
    medium_items,
    threshold,
  };
}
