import type { ItemSendPreviewRequest, ItemSendPreviewResponse } from "@/lib/takeoff/item-send-contracts";
import type { ItemSendBreakdown, ItemSendChoice, ITEM_SEND_KEEP_BOTH_REASONS } from "@/lib/takeoff/item-send-plan";

// Lot 4, PR 5c: what the screen of the send of one plan by item keeps of the member's gestures between two reads of its
// preview: each explicit choice, by the point it answers, and each page decision, by its page. The server computes the
// plan again from the stored facts and these choices only; a choice it does not offer any more is never applied there.
// After a stale preview the screen keeps the choices the new preview still applies, drops the others and says which,
// and says what moved between the two previews.

type ToResolve = ItemSendPreviewResponse["to_resolve"][number];
type KeepBothReason = (typeof ITEM_SEND_KEEP_BOTH_REASONS)[number];

/** A page decision as the member is taking it: « Garder les deux » waits for its reason (and a complementary scope for its note). */
export type ItemSendPendingPageDecision = { page: number | null; decision: "replace" }
  | { page: number | null; decision: "keep_both"; reasonCode: KeepBothReason | null; note: string | null };

export type ItemSendScreenChoices = {
  /** Each explicit choice, by the key of the point it answers, with that point as it was shown. */
  resolutions: ReadonlyMap<string, { choice: ItemSendChoice; point: ToResolve }>;
  /** Each page decision, by its page. */
  pageDecisions: ReadonlyMap<string, ItemSendPendingPageDecision>;
};

export const EMPTY_ITEM_SEND_CHOICES: ItemSendScreenChoices = { resolutions: new Map(), pageDecisions: new Map() };

export const itemSendPageKey = (page: number | null) => `page:${page ?? "all"}`;

/** The shortest note « Garder les deux » takes for a complementary scope (the contract's rule). */
export const ITEM_SEND_KEEP_BOTH_NOTE_MIN = 10;

/** Whether a page decision can be asked: « Remplacer », or « Garder les deux » with its reason (and its note). */
export function itemSendPageDecisionComplete(decision: ItemSendPendingPageDecision) {
  if (decision.decision === "replace") return true;
  if (!decision.reasonCode) return false;
  return decision.reasonCode !== "complementary_scope" || (decision.note ?? "").trim().length >= ITEM_SEND_KEEP_BOTH_NOTE_MIN;
}

/** The member's choice for one point (null withdraws it). */
export function withItemSendResolution(choices: ItemSendScreenChoices, point: ToResolve, choice: ItemSendChoice | null): ItemSendScreenChoices {
  const resolutions = new Map(choices.resolutions);
  if (choice) resolutions.set(point.key, { choice, point });
  else resolutions.delete(point.key);
  return { ...choices, resolutions };
}

/** The member's decision for one page (`decision: null` withdraws it). */
export function withItemSendPageDecision(choices: ItemSendScreenChoices,
  decision: ItemSendPendingPageDecision | { page: number | null; decision: null }): ItemSendScreenChoices {
  const pageDecisions = new Map(choices.pageDecisions);
  if (decision.decision === null) pageDecisions.delete(itemSendPageKey(decision.page));
  else pageDecisions.set(itemSendPageKey(decision.page), decision);
  return { ...choices, pageDecisions };
}

/** The preview's request: the destination and breakdown asked, each choice made, each page decision complete. */
export function itemSendRequestOf(input: { destination?: ItemSendPreviewRequest["destination"]; breakdown?: ItemSendBreakdown;
  choices: ItemSendScreenChoices }): ItemSendPreviewRequest {
  const resolutions = [...input.choices.resolutions.entries()].map(([key, { choice }]) => ({ key,
    choice: choice.kind === "line" ? { kind: "line" as const, estimate_item_id: choice.estimateItemId } : choice }));
  const decisions = [...input.choices.pageDecisions.values()].filter(itemSendPageDecisionComplete).map((decision) =>
    decision.decision === "replace" ? { page: decision.page, decision: "replace" as const }
      : { page: decision.page, decision: "keep_both" as const, reason_code: decision.reasonCode!,
        note: decision.note?.trim() ? decision.note.trim() : null });
  return {
    ...(input.destination ? { destination: input.destination } : {}),
    ...(input.breakdown ? { breakdown: input.breakdown } : {}),
    ...(resolutions.length > 0 ? { resolutions } : {}),
    ...(decisions.length > 0 ? { page_decisions: decisions } : {}),
  };
}

const lower = (value: string | null | undefined) => (value ?? "").toLowerCase();
const onPage = (pages: readonly number[], page: number | null) => page === null || pages.length === 0 || pages.includes(page);
const pointName = (point: ToResolve) => (point.label ? `« ${point.label} »` : point.page !== null ? `Page ${point.page}` : "Un point");
const pageName = (page: number | null) => (page === null ? "Toutes les pages" : `Page ${page}`);

/** Whether the preview shows the choice applied: the line it feeds as chosen, or the item left out. */
function reflected(key: string, choice: ItemSendChoice, point: ToResolve, response: ItemSendPreviewResponse) {
  if (choice.kind === "leave_out") {
    if (point.kind === "page_decision") {
      return response.parts_not_sent.some((part) => part.reason === "left_out" && onPage(part.pages, point.page));
    }
    return response.not_sent.some((entry) => lower(entry.item_id) === lower(point.item_id) && entry.reason === "left_out")
      || response.parts_not_sent.some((part) => lower(part.item_id) === lower(point.item_id) && part.reason === "left_out");
  }
  const targetKey = key.slice(key.indexOf(":") + 1);
  const line = response.lines.find((candidate) => candidate.key === targetKey);
  if (!line) return false;
  if (key.startsWith("entry:")) {
    return choice.kind === "keep_entry" ? line.kept_entry : choice.kind === "use_retained" && line.entered !== null && !line.kept_entry;
  }
  if (key.startsWith("target:")) {
    return choice.kind === "line" ? lower(line.estimate_item_id) === lower(choice.estimateItemId) : choice.kind === "new_line" && line.change === "created";
  }
  return false;
}

/**
 * After a new preview (a stale one read again): the choices it still applies, and a sentence for each one dropped,
 * because its point is asked again (its option is no longer offered), because its point is gone, or because its page no
 * longer waits for a decision.
 */
export function reconcileItemSendChoices(choices: ItemSendScreenChoices, response: ItemSendPreviewResponse) {
  const dropped: string[] = [];
  const resolutions = new Map<string, { choice: ItemSendChoice; point: ToResolve }>();
  for (const [key, entry] of choices.resolutions) {
    if (response.to_resolve.some((point) => point.key === key)) {
      dropped.push(`${pointName(entry.point)} : votre choix ne s’applique plus, choisissez de nouveau.`);
    } else if (reflected(key, entry.choice, entry.point, response)) {
      resolutions.set(key, entry);
    } else {
      dropped.push(`${pointName(entry.point)} : ce point n’est plus à trancher.`);
    }
  }
  const pageDecisions = new Map<string, ItemSendPendingPageDecision>();
  for (const [key, decision] of choices.pageDecisions) {
    if (response.invalid_page_decisions.some((invalid) => invalid.reason === "page_not_held" && invalid.page === decision.page)) {
      dropped.push(`${pageName(decision.page)} : elle n’attend plus de décision.`);
    } else {
      pageDecisions.set(key, decision);
    }
  }
  return { choices: { resolutions, pageDecisions } satisfies ItemSendScreenChoices, dropped };
}

const quantity = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });
const range = (before: number | null, after: number, unit: string) =>
  `${before === null ? "" : `${quantity.format(before)} → `}${quantity.format(after)} ${unit}`;

/** What moved between two previews of the same plan, line by line, in the member's words. */
export function itemSendPreviewChanges(previous: ItemSendPreviewResponse, next: ItemSendPreviewResponse): string[] {
  const changes: string[] = [];
  if (previous.destination_label !== next.destination_label && next.destination_label) {
    changes.push(`Destination : ${next.destination_label}${previous.destination_label ? ` (au lieu de ${previous.destination_label})` : ""}.`);
  }
  const before = new Map(previous.lines.map((line) => [line.key, line]));
  const after = new Set(next.lines.map((line) => line.key));
  for (const line of next.lines) {
    const earlier = before.get(line.key);
    if (!earlier) {
      changes.push(`« ${line.label} » : envoyé maintenant (${range(null, line.quantity_after, line.unit)}).`);
    } else if (earlier.quantity_before !== line.quantity_before || earlier.quantity_after !== line.quantity_after) {
      changes.push(`« ${line.label} » : ${range(line.quantity_before, line.quantity_after, line.unit)} (l’aperçu précédent montrait `
        + `${range(earlier.quantity_before, earlier.quantity_after, earlier.unit)}).`);
    }
  }
  const asked = new Set(previous.to_resolve.map((point) => point.key));
  const said = new Set<string>();
  for (const line of previous.lines) {
    if (after.has(line.key)) continue;
    // A line that now asks a choice is said once, with what it holds now when it was typed by hand.
    const point = next.to_resolve.find((candidate) => !asked.has(candidate.key) && candidate.item_id === line.item_id);
    if (!point) { changes.push(`« ${line.label} » : n’est plus envoyé par cette confirmation.`); continue; }
    said.add(point.key);
    const entered = point.facts?.entered ?? null;
    changes.push(entered !== null && line.quantity_before !== null && entered !== line.quantity_before
      ? `« ${line.label} » : la ligne du devis tient maintenant ${range(null, entered, line.unit)} (${range(null, line.quantity_before, line.unit)} `
        + "à l’aperçu précédent) : un choix est à faire."
      : `« ${line.label} » : un choix est à faire.`);
  }
  for (const point of next.to_resolve) {
    if (asked.has(point.key) || said.has(point.key)) continue;
    changes.push(point.kind === "page_decision" ? `${pageName(point.page)} : une décision de page est à prendre.`
      : `${pointName(point)} : un choix est à faire.`);
  }
  if (next.blocked && next.blocked.reason !== previous.blocked?.reason) changes.push(next.blocked.message);
  return changes;
}
