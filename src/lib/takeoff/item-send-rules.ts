import { computeTakeoffMappingPreview } from "@/lib/takeoff/mapping-engine";
import type { TakeoffJobItem, TakeoffMappingRule } from "@/lib/takeoff/types";

/**
 * Lot 4, PR 5a: the administrator's mapping rules as the send by item reads them — the one projection for the review,
 * the impact preview and, later, the commit. The first active matching rule wins, in the mapping engine's own order
 * (priority, creation, identifier), matched on the item's label. In this journey no rule has a financial effect:
 * - « Fixer le prix » selected: without effect, reported as such, and the next rule is not read in its place;
 * - « Remplacer par un ouvrage »: the item keeps its quantity, the ouvrage is shown as an indication only;
 * - « Renommer » names a line the send creates, « Catégoriser » annotates it; neither touches an existing line (a DPGF
 *   line keeps its title and place);
 * - « Ignorer » leaves the item out, by the rule's identifier and name.
 * Pure and client-safe.
 */

export type ItemSendRuleAction = "none" | "rename" | "set_category" | "skip" | "set_price" | "apply_assembly";
export type ItemSendRuleEffectKind = "none" | "renamed" | "categorized" | "skipped" | "price_ignored" | "assembly_indicated";

export type ItemSendRuleEffect = {
  ruleId: string | null;
  ruleName: string | null;
  /** The rule's version (its last change), compared by the confirmation with its identifier. */
  ruleVersion: string | null;
  action: ItemSendRuleAction;
  effect: ItemSendRuleEffectKind;
  /** The title of a line the send creates for the item: the rule's name for it, else the item's label. */
  designation: string;
  categoryId: string | null;
  /** The ouvrage a rule names: an indication, never inserted nor priced here. */
  assemblyId: string | null;
};

const EFFECTS: Record<ItemSendRuleAction, ItemSendRuleEffectKind> = {
  none: "none", rename: "renamed", set_category: "categorized", skip: "skipped", set_price: "price_ignored",
  apply_assembly: "assembly_indicated",
};

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim().replace(/\s+/g, " ") : null);

/** Each item's rule effect, keyed by item id. */
export function projectItemSendRules(items: ReadonlyArray<{ id: string; label: string }>, rules: readonly TakeoffMappingRule[]):
  Map<string, ItemSendRuleEffect> {
  // The engine reads takeoff lines: the item is handed as one, by its label alone (no quantity, no price, no exclusion).
  const lines: TakeoffJobItem[] = items.map((item, index) => ({
    id: item.id, designation: item.label, quantity: 1, unit: "u", confidence: null, evidence: null, source_file_name: null, source_page: null,
    metadata: {}, is_excluded: false, exclusion_reason: null, is_verified: false, verified_at: null, verified_by: null,
    created_at: new Date(Date.UTC(2000, 0, 1, 0, 0, index)).toISOString(), updated_at: new Date(Date.UTC(2000, 0, 1)).toISOString(),
  }));
  const { items: mapped } = computeTakeoffMappingPreview({ items: lines, rules: [...rules] });
  const versions = new Map(rules.map((rule) => [rule.id, rule.updated_at]));
  const projected = new Map<string, ItemSendRuleEffect>();
  for (const entry of mapped) {
    const label = items.find((item) => item.id === entry.item_id)!.label.trim().replace(/\s+/g, " ");
    const action = (entry.action in EFFECTS ? entry.action : "none") as ItemSendRuleAction;
    projected.set(entry.item_id, {
      ruleId: action === "none" ? null : entry.rule_id,
      ruleName: action === "none" ? null : entry.rule_name,
      ruleVersion: action === "none" || !entry.rule_id ? null : versions.get(entry.rule_id) ?? null,
      action,
      effect: EFFECTS[action],
      designation: action === "rename" ? text(entry.action_params.designation) ?? label : label,
      categoryId: action === "set_category" ? text(entry.action_params.category_id) : null,
      assemblyId: action === "apply_assembly" ? text(entry.action_params.assembly_id) : null,
    });
  }
  return projected;
}
