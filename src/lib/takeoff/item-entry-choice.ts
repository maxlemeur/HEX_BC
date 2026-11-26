import type { ItemEntryView, ItemReviewTarget, ItemTableLine } from "./item-table";
import type { ItemReviewCommand } from "./item-table-contracts";
import type { QuantityEntry } from "./quantity-entry";

export function entryFacts(entry: ItemEntryView | null, names: Record<string, string>) {
  if (!entry) return null;
  const { quantity, unit, category, revision, at, note } = entry;
  return { quantity, unit, category, revision, at, note, author: names[entry.actorId] ?? "Un membre" };
}

export function entryPlans(line: ItemTableLine, names: Record<string, string> = {}) {
  return line.readings.flatMap(({ planKey, planName, answer, sent, entry }) => answer ? [{
    key: planKey, name: planName, answerId: answer.answerId, entry: entryFacts(entry, names),
    eligible: !sent && (answer.outcome === "not_found" || answer.outcome === "uncertain"),
  }] : []);
}

export function canChooseEntryScope(line: ItemTableLine) {
  return line.eligibility.enter_quantity.eligible || entryPlans(line).some(plan => plan.eligible);
}

export type EntryChoiceItem = {
  target: ItemReviewTarget;
  plans: ReturnType<typeof entryPlans>;
  wholeEligible: boolean;
  wholeEntry: ReturnType<typeof entryFacts>;
};

export function entryDestination(item: EntryChoiceItem, key: string) {
  if (key === "affaire") {
    return item.wholeEligible && item.target.entryRevision === (item.wholeEntry?.revision ?? 0)
      ? { key, target: item.target, existing: item.wholeEntry } : null;
  }
  const plan = item.plans.find(p => p.key === key && p.eligible);
  const answer = plan && item.target.answers.find(a => a.answerId === plan.answerId);
  if (!answer || answer.entryRevision !== (plan.entry?.revision ?? 0)) return null;
  const target = { itemId: item.target.itemId, entryRevision: answer.entryRevision, answers: [{ ...answer, entryRevision: 0 }] };
  return { key, target, existing: plan.entry };
}

type EntryCommand = Extract<ItemReviewCommand, { gesture: "enter_quantity" }>;
export function groupEntryCommands(rows: Array<{ destination: NonNullable<ReturnType<typeof entryDestination>>;
  quantity: number; unit: string }>, entry: QuantityEntry): EntryCommand[] {
  const commands = new Map<string, EntryCommand>();
  for (const { destination: { key, target }, quantity, unit } of rows) {
    let command = commands.get(key);
    if (!command) {
      command = { command_version: 1, intent_key: crypto.randomUUID(), gesture: "enter_quantity",
        scope: key === "affaire" ? { kind: "affaire" } : { kind: "plan", planKey: key }, entry, targets: [], values: [] };
      commands.set(key, command);
    }
    command.targets.push(target);
    command.values.push({ item_id: target.itemId, quantity, unit });
  }
  return [...commands.values()];
}
