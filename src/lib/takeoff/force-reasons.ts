import { z } from "zod";

import type { GuardBlockedItem } from "@/lib/takeoff/guards";
import { ACCEPTANCE_NOTE, noteText, validNote } from "@/lib/takeoff/rules/verification";
import { TAKEOFF_RULE_IDS, type TakeoffRuleId } from "@/lib/takeoff/rules/types";

// TI-686 D10 (H7): an administrator forces each line the apply guard blocks with a coded reason and a justification of
// 10 to 500 characters (the acceptance notes' rule, noteText). The reasons that name a rule hold on the failures that
// block the line as TI-681 defines them: the guard's rule_failures (blockingRules without the quantity warnings, the
// plan's exclusions left out), on results that are readable and not to compute again (the route reads unreadable
// results as none and stale). The four other reasons always hold. Twin of private.takeoff_apply_forced_item_valid
// (migration …_takeoff_apply_force_reasons.sql), which the apply trigger checks; the SQL is never stricter: it reads
// the stored results as they are, where this side refuses what it cannot read.

/** The coded reasons of an override, as the guard panel offers them (labels pending the business owner's agreement). */
export const FORCE_REASONS = {
  rule_false_positive: "Faux positif de règle",
  additional_evidence: "Preuve complémentaire",
  engineer_or_client_confirmation: "Confirmation BET ou client",
  controlled_correction: "Correction contrôlée",
  duplicate_resolved: "Doublon résolu",
  priced_hypothesis: "Hypothèse chiffrée",
} as const;

export type ForceReason = keyof typeof FORCE_REASONS;
export const FORCE_REASON_CODES = Object.keys(FORCE_REASONS) as [ForceReason, ...ForceReason[]];

/** A resolved duplicate needs one of these rules among the failures that block the line. */
const OVERLAP_RULES: ReadonlySet<TakeoffRuleId> = new Set(["zone_overlap", "room_overlap"]);

export const FORCE_MESSAGES = {
  overrideReasons: `Chaque ligne forcée exige un motif codé qui s’applique à elle et une justification de ${ACCEPTANCE_NOTE.min} `
    + `à ${ACCEPTANCE_NOTE.max} caractères.`,
  falsePositive: "Un faux positif désigne une règle dont l’échec bloque la ligne, sur des résultats à jour.",
  falsePositiveRules: "Désignez, une fois chacune, la ou les règles fautives parmi celles dont l’échec bloque la ligne.",
  falsePositiveRulesForbidden: "La règle fautive ne se désigne que pour un faux positif de règle.",
  duplicateResolved: "Un doublon résolu suppose un doublon ou un chevauchement qui bloque la ligne, sur des résultats à jour.",
  justification: `Une justification de ${ACCEPTANCE_NOTE.min} à ${ACCEPTANCE_NOTE.max} caractères est obligatoire.`,
} as const;

/** A justification as the request and the audit carry it: without its blanks at the ends, 10 to 500 code points. */
export const forcedJustificationSchema = z.string().overwrite(noteText)
  .refine(validNote, FORCE_MESSAGES.justification)
  .meta({ minLength: ACCEPTANCE_NOTE.min, maxLength: ACCEPTANCE_NOTE.max });

/** One forced line: its coded reason, the rules at fault for a false positive, and the index of its justification. */
export const forcedItemSchema = z.object({
  item_id: z.string().uuid("item_id invalide."),
  reason_code: z.enum(FORCE_REASON_CODES),
  false_positive_rules: z.array(z.enum(TAKEOFF_RULE_IDS)).optional(),
  justification_index: z.number().int().nonnegative(),
}).strict();

export type ForcedItem = z.infer<typeof forcedItemSchema>;
export type ForcedOverride = { forced_justifications: string[]; forced_items: ForcedItem[] };

/** A blocked line as the apply guard reports it (checkApplyGuard). */
type BlockedLine = Pick<GuardBlockedItem, "reasons" | "rule_failures">;

/** The rules whose failure blocks the line, on results to trust (readable, not to compute again); none otherwise. */
export function forceRulesOf(line: BlockedLine): TakeoffRuleId[] {
  if (line.reasons.includes("rules_stale")) return [];
  return [...new Set((line.rule_failures ?? []).map((failure) => failure.rule))];
}

/** The reasons an administrator may give to force this line, in the panel's order. */
export function forceReasonsFor(line: BlockedLine): ForceReason[] {
  const rules = forceRulesOf(line);
  return FORCE_REASON_CODES.filter((code) => {
    if (code === "rule_false_positive") return rules.length > 0;
    if (code === "duplicate_resolved") return rules.some((rule) => OVERLAP_RULES.has(rule));
    return true;
  });
}

/** Why this forced entry does not hold for its line (null when it does), against the request's justifications. */
export function forcedItemError(line: BlockedLine, forced: Omit<ForcedItem, "item_id">,
  justifications: readonly string[]): string | null {
  const reasons = forceReasonsFor(line);
  if (forced.reason_code === "rule_false_positive") {
    if (!reasons.includes("rule_false_positive")) return FORCE_MESSAGES.falsePositive;
    const named = forced.false_positive_rules ?? [];
    const rules = forceRulesOf(line);
    if (named.length === 0 || new Set(named).size !== named.length || named.some((rule) => !rules.includes(rule))) {
      return FORCE_MESSAGES.falsePositiveRules;
    }
  } else {
    if (forced.false_positive_rules !== undefined) return FORCE_MESSAGES.falsePositiveRulesForbidden;
    if (!reasons.includes(forced.reason_code)) return FORCE_MESSAGES.duplicateResolved;
  }
  const text = Number.isInteger(forced.justification_index) && forced.justification_index >= 0
    ? justifications[forced.justification_index] : undefined;
  return typeof text === "string" && validNote(text) ? null : FORCE_MESSAGES.justification;
}

/** A forced line with its own text, before the texts are stored once. */
export type ForcedEntry = Omit<ForcedItem, "justification_index"> & { justification: string };

/**
 * The override as the audit stores it (H7): the lines sorted by id, each justification stored once (without its blanks
 * at the ends) and every line pointing to it. No cap on the number of lines.
 */
export function packForcedItems(entries: readonly ForcedEntry[]): ForcedOverride {
  const forced_justifications: string[] = [];
  const indexes = new Map<string, number>();
  const forced_items = [...entries]
    .sort((left, right) => (left.item_id < right.item_id ? -1 : left.item_id > right.item_id ? 1 : 0))
    .map(({ item_id, reason_code, false_positive_rules, justification }) => {
      const text = noteText(justification);
      let justification_index = indexes.get(text);
      if (justification_index === undefined) {
        justification_index = forced_justifications.push(text) - 1;
        indexes.set(text, justification_index);
      }
      return { item_id, reason_code, ...(false_positive_rules ? { false_positive_rules: [...false_positive_rules] } : {}),
        justification_index };
    });
  return { forced_justifications, forced_items };
}
