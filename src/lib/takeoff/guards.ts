import type { TakeoffJobItem } from "@/lib/takeoff/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.5;
export const MEDIUM_CONFIDENCE_CEILING = 0.8;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GuardBlockedItem = {
  item_id: string;
  designation: string;
  confidence: number | null;
  is_verified: boolean;
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

// ---------------------------------------------------------------------------
// Pure guard check
// ---------------------------------------------------------------------------

/**
 * Pure function: checks whether low-confidence unverified items exist among
 * included items. Returns a result describing which items are blocked and
 * which are medium-confidence (warning-only).
 *
 * - Blocked = confidence < threshold AND is_verified === false
 * - Medium  = threshold ≤ confidence < MEDIUM_CONFIDENCE_CEILING AND is_verified === false
 * - `passed` is true when no blocked items exist.
 */
export function checkApplyGuard(
  items: Pick<
    TakeoffJobItem,
    "id" | "designation" | "confidence" | "is_verified" | "is_excluded"
  >[],
  threshold: number = DEFAULT_LOW_CONFIDENCE_THRESHOLD
): ApplyGuardResult {
  const blocked_items: GuardBlockedItem[] = [];
  const medium_items: GuardMediumItem[] = [];

  for (const item of items) {
    // Only consider included items
    if (item.is_excluded) continue;

    // Already verified → skip
    if (item.is_verified) continue;

    const conf = item.confidence;

    // null confidence is treated as low-confidence (blocked)
    if (conf === null || conf < threshold) {
      blocked_items.push({
        item_id: item.id,
        designation: item.designation,
        confidence: conf,
        is_verified: false,
      });
    } else if (conf < MEDIUM_CONFIDENCE_CEILING) {
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
