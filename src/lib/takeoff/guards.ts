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
  | TakeoffVerificationIssue;

export const APPLY_GUARD_REASON_LABELS: Record<ApplyGuardBlockReason, string> = {
  low_confidence: "Confiance faible non vérifiée",
  missing_evidence: "Preuve manquante",
  missing_source_page: "Page source manquante",
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

/**
 * Pure function: checks whether included Level C items are safe to apply.
 * A low-confidence item needs explicit human verification, while every item
 * must keep a textual proof and a page source so the result remains auditable.
 *
 * - Blocked = missing proof/source, or confidence < threshold while unverified
 * - Medium  = threshold ≤ confidence < MEDIUM_CONFIDENCE_CEILING AND is_verified === false
 * - `passed` is true when no blocked items exist.
 */
export function checkApplyGuard(
  items: Pick<
    TakeoffJobItem,
    | "id"
    | "designation"
    | "confidence"
    | "evidence"
    | "source_page"
    | "is_verified"
    | "is_excluded"
  >[],
  threshold: number = DEFAULT_LOW_CONFIDENCE_THRESHOLD
): ApplyGuardResult {
  const blocked_items: GuardBlockedItem[] = [];
  const medium_items: GuardMediumItem[] = [];

  for (const item of items) {
    // Only consider included items
    if (item.is_excluded) continue;

    const conf = item.confidence;
    const verificationReadiness = getTakeoffVerificationReadiness(item);
    const reasons: ApplyGuardBlockReason[] = [...verificationReadiness.issues];

    if (!item.is_verified && (conf === null || conf < threshold)) {
      reasons.unshift("low_confidence");
    }

    if (reasons.length > 0) {
      blocked_items.push({
        item_id: item.id,
        designation: item.designation,
        confidence: conf,
        is_verified: item.is_verified,
        reasons,
      });
    } else if (
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
