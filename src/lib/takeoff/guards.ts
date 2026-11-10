import { blockingRules, type LeftOut, type PartnerExclusion } from "@/lib/takeoff/rules/blocking";
import type { TakeoffRuleResult } from "@/lib/takeoff/rules/types";
import type { TakeoffJobItem } from "@/lib/takeoff/types";
import { isQuantityWarning } from "@/lib/takeoff/quantity-review-policy";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.5;
export const MEDIUM_CONFIDENCE_CEILING = 0.8;

/** The grammar the apply trigger accepts too (takeoff_low_confidence_threshold): a decimal, an exponent of 3 digits. */
const THRESHOLD_GRAMMAR = /^([+-]?)([0-9]*)(?:\.([0-9]*))?(?:[eE]([+-]?[0-9]{1,3}))?$/;
const THRESHOLD_MAX_LENGTH = 100;

/**
 * The tenant's low confidence threshold (flag TAKEOFF_LOW_CONFIDENCE_THRESHOLD) exactly as the apply trigger reads it
 * (TI-677): trimmed like JS trim(), a decimal of at most 100 characters (no hexadecimal, no « Infinity »), between 0
 * and 1, else the default; then rounded up to the 1e-4 the confidences are stored at (numeric(5,4)), which blocks
 * exactly the lines the exact value blocks, and keeps every digit of the flag (TS used to round past 17 digits). The
 * value an admin override's audit carries is this one, which the trigger compares exactly.
 */
export function parseLowConfidenceThreshold(raw: string | null | undefined): number {
  const text = typeof raw === "string" ? raw.trim() : "";
  const match = text.length <= THRESHOLD_MAX_LENGTH ? THRESHOLD_GRAMMAR.exec(text) : null;
  const digits = match ? match[2] + (match[3] ?? "") : "";
  if (!match || !digits) return DEFAULT_LOW_CONFIDENCE_THRESHOLD;
  // value × 10^4 = digits × 10^shift, rounded up: past five digits it is over 1 (the default).
  const shift = Number(match[4] ?? 0) - (match[3] ?? "").length + 4;
  const whole = (shift >= 0 ? digits + "0".repeat(shift) : digits.slice(0, shift)).replace(/^0+/, "");
  if (whole.length > 5) return DEFAULT_LOW_CONFIDENCE_THRESHOLD;
  const units = Number(whole) + (shift < 0 && /[1-9]/.test(digits.slice(shift)) ? 1 : 0);
  return (match[1] === "-" && units > 0) || units > 10_000 ? DEFAULT_LOW_CONFIDENCE_THRESHOLD : units / 10_000;
}

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
  confidence: number | null;
  rule_failures?: GuardBlockedItem["rule_failures"];
  source_page?: number | null;
  source_file_name?: string | null;
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

  // Blank as the database reads it (btrim strips spaces only): the apply and verification triggers count the same.
  if (!item.evidence?.replace(/^ +| +$/g, "")) {
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
  source_file_name?: string | null;
  /** Fixed-rule results of the line (TI-664); absent or empty: no rule reads it. */
  rule_results?: readonly TakeoffRuleResult[] | null;
  /** The line changed after its rules ran: they no longer hold until the server computes them again. */
  rules_stale?: boolean | null;
};

/**
 * Application protections mirrored by enforce_takeoff_apply_security in SQL.
 * Missing localized provenance, stale results, unknown failures and technical
 * restrictions remain protected. TI-681 quantity warnings and confidence only
 * recommend review; they never require an individual acknowledgement.
 */
export function checkApplyGuard(
  items: ApplyGuardItem[],
  threshold: number = DEFAULT_LOW_CONFIDENCE_THRESHOLD,
  context: {
    level?: string | null;
    /** Lines of other jobs a cross-line failure names, as the database holds them (excluded or not). */
    partnerExclusions?: ReadonlyMap<string, boolean>;
    /** The test of a failure whose partners are all left out (partner-exclusions.ts leftOutByPartners); none: it blocks. */
    leftOut?: (result: TakeoffRuleResult, excluded: PartnerExclusion) => boolean;
  } = {}
): ApplyGuardResult {
  const blocked_items: GuardBlockedItem[] = [];
  const medium_items: GuardMediumItem[] = [];
  const levelC = (context.level ?? "C") === "C";
  // The job's own lines as given (the plan's exclusions included), the others from the context; unknown: counted.
  const test = context.leftOut;
  const own = test ? new Map(items.map((item) => [item.id.toLowerCase(), item.is_excluded])) : null;
  const leftOut: LeftOut | undefined = test && own
    ? (entry) => test(entry, (id) => own.get(id) ?? context.partnerExclusions?.get(id)) : undefined;

  for (const item of items) {
    // Only consider included items
    if (item.is_excluded) continue;

    const conf = item.confidence;
    const reasons: ApplyGuardBlockReason[] = levelC ? [...getTakeoffVerificationReadiness(item).issues] : [];

    const failures = blockingRules(item.rule_results, item.is_verified, leftOut)
      .filter((entry) => !isQuantityWarning(entry.code));
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
      (conf === null || conf < Math.max(threshold, MEDIUM_CONFIDENCE_CEILING)
        || item.rule_results?.some(entry => entry.status === "fail" && isQuantityWarning(entry.code)))
    ) {
      medium_items.push({
        item_id: item.id,
        designation: item.designation,
        confidence: conf,
        ...(item.rule_results?.some(entry => entry.status === "fail" && isQuantityWarning(entry.code)) ? {
          rule_failures: item.rule_results.filter(entry => entry.status === "fail" && isQuantityWarning(entry.code))
            .map(({ rule, code, reason, acceptable }) => ({ rule, code, reason, acceptable })),
          source_page: item.source_page,
          ...(item.source_file_name !== undefined ? { source_file_name: item.source_file_name } : {}),
        } : {}),
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

export function hasBlockingTakeoffAnomaly(item: { designation: string; quantity: number }): boolean {
  return !item.designation.trim() || item.quantity <= 0;
}
