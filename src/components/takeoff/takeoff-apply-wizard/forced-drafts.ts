"use client";

import {
  forcedItemError,
  forceRulesOf,
  packForcedItems,
  type ForcedEntry,
  type ForcedOverride,
  type ForceReason,
} from "@/lib/takeoff/force-reasons";
import type { GuardBlockedItem } from "@/lib/takeoff/guards";
import type { TakeoffRuleId } from "@/lib/takeoff/rules/types";

// TI-686 D10: what the administrator is writing for each blocked line in the guard panel, kept by the wizard across its
// steps. A line is complete when its reason holds for it (force-reasons.ts, as the route checks it).

export type ForcedDraft = {
  /** In the selection « Appliquer à la sélection » writes to. */
  selected: boolean;
  reason: ForceReason | "";
  /** The rules at fault of a false positive; one blocking rule is taken without being chosen. */
  rules: TakeoffRuleId[];
  justification: string;
};

export type ForcedDrafts = Record<string, ForcedDraft>;

export const EMPTY_FORCED_DRAFT: ForcedDraft = { selected: true, reason: "", rules: [], justification: "" };

export function forcedDraftOf(drafts: ForcedDrafts, itemId: string): ForcedDraft {
  return drafts[itemId] ?? EMPTY_FORCED_DRAFT;
}

/** The rules a false positive of this line names: those chosen, or its only blocking rule. */
export function falsePositiveRules(line: GuardBlockedItem, draft: ForcedDraft): TakeoffRuleId[] {
  if (draft.rules.length > 0) return draft.rules;
  const rules = forceRulesOf(line);
  return rules.length === 1 ? rules : [];
}

/** The line's forced entry, or why it is not complete yet (null: no reason chosen). */
export function forcedEntryOf(line: GuardBlockedItem, draft: ForcedDraft): { entry: ForcedEntry } | { error: string | null } {
  if (draft.reason === "") return { error: null };
  const false_positive_rules = draft.reason === "rule_false_positive" ? falsePositiveRules(line, draft) : undefined;
  const error = forcedItemError(line, { reason_code: draft.reason, false_positive_rules, justification_index: 0 },
    [draft.justification]);
  if (error) return { error };
  return { entry: { item_id: line.item_id, reason_code: draft.reason, false_positive_rules, justification: draft.justification } };
}

/** The override the request carries once every blocked line is complete; null before. */
export function forcedOverrideOf(blocked: readonly GuardBlockedItem[], drafts: ForcedDrafts): ForcedOverride | null {
  const entries: ForcedEntry[] = [];
  for (const line of blocked) {
    const result = forcedEntryOf(line, forcedDraftOf(drafts, line.item_id));
    if (!("entry" in result)) return null;
    entries.push(result.entry);
  }
  return entries.length > 0 ? packForcedItems(entries) : null;
}
