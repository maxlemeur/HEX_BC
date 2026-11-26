import type { ItemReviewTarget, ItemTableLine } from "./item-table";

export function entryPlans(line: ItemTableLine) {
  return line.readings.flatMap(({ planKey, planName, answer, sent }) => answer ? [{
    key: planKey, name: planName, answerId: answer.answerId,
    eligible: !sent && (answer.outcome === "not_found" || answer.outcome === "uncertain"),
  }] : []);
}

export type EntryChoiceItem = { target: ItemReviewTarget; plans: ReturnType<typeof entryPlans>; wholeEligible: boolean };

/** The affair's frozen vector includes each plan entry's revision in its answer. In plan scope it belongs on the target. */
export function planEntryTarget(item: EntryChoiceItem, key: string): ItemReviewTarget | null {
  const plan = item.plans.find(p => p.key === key && p.eligible);
  const answer = plan && item.target.answers.find(a => a.answerId === plan.answerId);
  return answer ? { itemId: item.target.itemId, entryRevision: answer.entryRevision, answers: [{ ...answer, entryRevision: 0 }] } : null;
}
