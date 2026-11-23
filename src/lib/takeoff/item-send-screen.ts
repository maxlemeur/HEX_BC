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

/**
 * What a choice was applied on, once a preview showed it applied: its line and the quantities shown. A choice is kept
 * across a new preview only while they are the same; otherwise the member chooses again.
 */
export type ItemSendAppliedOn = { estimateItemId: string | null; entered: number | null; measured: number; retained: number };
type Resolution = { choice: ItemSendChoice; point: ToResolve; appliedOn?: ItemSendAppliedOn };

export type ItemSendScreenChoices = {
  /** Each explicit choice, by the key of the point it answers, with that point as it was shown. */
  resolutions: ReadonlyMap<string, Resolution>;
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

/**
 * What a question about a quantity typed by hand showed when the member answered it: the line it names and its quantities.
 * The choice is bound to them from that moment, never to the first preview that applies it.
 */
function madeOnOf(point: ToResolve): ItemSendAppliedOn | undefined {
  if (point.kind !== "entered_quantity" || !point.facts || point.earlier_lines.length !== 1) return undefined;
  return { estimateItemId: point.earlier_lines[0].estimate_item_id, entered: point.facts.entered, measured: point.facts.measured,
    retained: point.facts.retained };
}

/** The member's choice for one point (null withdraws it), bound to what its question showed. */
export function withItemSendResolution(choices: ItemSendScreenChoices, point: ToResolve, choice: ItemSendChoice | null): ItemSendScreenChoices {
  const resolutions = new Map(choices.resolutions);
  const appliedOn = choice ? madeOnOf(point) : undefined;
  if (choice) resolutions.set(point.key, appliedOn ? { choice, point, appliedOn } : { choice, point });
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

/**
 * The preview's request: the destination and breakdown asked, each choice made, each page decision complete, in one
 * canonical order (choices by key, decisions by page), as the server reads them: the same choices made in another order
 * are the same request, and the same intention key.
 */
export function itemSendRequestOf(input: { destination?: ItemSendPreviewRequest["destination"]; breakdown?: ItemSendBreakdown;
  choices: ItemSendScreenChoices }): ItemSendPreviewRequest {
  const resolutions = [...input.choices.resolutions.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, { choice }]) => ({ key,
      choice: choice.kind === "line" ? { kind: "line" as const, estimate_item_id: choice.estimateItemId } : choice }));
  const decisions = [...input.choices.pageDecisions.values()].filter(itemSendPageDecisionComplete)
    .sort((left, right) => (left.page ?? Number.MAX_SAFE_INTEGER) - (right.page ?? Number.MAX_SAFE_INTEGER)).map((decision) =>
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

type Line = ItemSendPreviewResponse["lines"][number];
type Outcome = { kind: "kept"; appliedOn: ItemSendAppliedOn | null } | { kind: "moved" | "changed" | "gone" };

/**
 * Whether the preview shows the choice applied: the line it feeds as chosen, the item left out, or what the choice led to
 * (a second point on the same item, a line suspended, a part that cannot be cut). « kept » when it is applied on what it
 * was made on; « moved » when its point is asked again; « changed » when the line or the quantities it was made on are no
 * longer those (another line, an entry typed again, another measure or retained quantity); « gone » when its point is gone.
 */
function outcomeOf(key: string, entry: Resolution, response: ItemSendPreviewResponse): Outcome {
  const { choice, point } = entry;
  if (choice.kind === "leave_out" && point.kind === "page_decision") {
    return response.parts_not_sent.some((part) => part.reason === "left_out" && onPage(part.pages, point.page))
      ? { kind: "kept", appliedOn: null } : { kind: "gone" };
  }
  const item = lower(point.item_id);
  const notSent = response.not_sent.filter((candidate) => lower(candidate.item_id) === item);
  if (choice.kind === "leave_out") {
    return notSent.some((candidate) => candidate.reason === "left_out")
      || response.parts_not_sent.some((part) => lower(part.item_id) === item && part.reason === "left_out")
      ? { kind: "kept", appliedOn: null } : { kind: "gone" };
  }
  const targetKey = key.slice(key.indexOf(":") + 1);
  const line = response.lines.find((candidate) => candidate.key === targetKey);
  if (line && key.startsWith("entry:")) {
    // The member chose about the line typed then, at the quantities shown then: a change of either asks again.
    if (!sameQuantities(point, line) || (entry.appliedOn && !sameAppliedOn(entry.appliedOn, line))) return { kind: "changed" };
    if (choice.kind === "keep_entry" ? line.kept_entry : choice.kind === "use_retained" && line.entered !== null && !line.kept_entry) {
      return { kind: "kept", appliedOn: appliedOnOf(line) };
    }
  }
  if (line && key.startsWith("target:")) {
    if (choice.kind === "line" ? lower(line.estimate_item_id) === lower(choice.estimateItemId)
      : choice.kind === "new_line" && line.change === "created") return { kind: "kept", appliedOn: null };
  }
  // What the choice led to: another point asked about the same item, the line suspended by the server, a part not cut.
  if (response.to_resolve.some((other) => other.key !== key && lower(other.item_id) === item)) return { kind: "kept", appliedOn: null };
  if (notSent.some((candidate) => candidate.reason === "entry_suspended")) return { kind: "kept", appliedOn: null };
  if (response.invalid_page_decisions.some((invalid) => invalid.reason === "part_indivisible")) return { kind: "kept", appliedOn: null };
  return { kind: "gone" };
}

const appliedOnOf = (line: Line): ItemSendAppliedOn => ({ estimateItemId: line.estimate_item_id, entered: line.entered,
  measured: line.measured, retained: line.retained });
const sameAppliedOn = (on: ItemSendAppliedOn, line: Line) => lower(on.estimateItemId) === lower(line.estimate_item_id)
  && on.entered === line.entered && on.measured === line.measured && on.retained === line.retained;
/** The quantities the point showed when the member chose: typed, measured and retained. */
function sameQuantities(point: ToResolve, line: Line) {
  const facts = point.facts;
  if (!facts) return true;
  // An entry gone (the line holds what the sends wrote again) is a point gone, not a choice about another entry.
  if (line.entered === null) return true;
  return facts.entered === line.entered && facts.measured === line.measured && facts.retained === line.retained;
}

/**
 * After a new preview (a stale one read again): the choices it still applies, each with what it is applied on, and a
 * sentence for each one dropped, because its point is asked again (its option is no longer offered), because the line
 * or the quantities it was made on changed since, because its point is gone, or because its page no longer waits for a
 * decision.
 */
export function reconcileItemSendChoices(choices: ItemSendScreenChoices, response: ItemSendPreviewResponse) {
  const dropped: string[] = [];
  const resolutions = new Map<string, Resolution>();
  let recorded = false;
  for (const [key, entry] of choices.resolutions) {
    const outcome: Outcome = response.to_resolve.some((point) => point.key === key) ? { kind: "moved" } : outcomeOf(key, entry, response);
    if (outcome.kind === "kept") {
      const appliedOn = entry.appliedOn ?? outcome.appliedOn ?? undefined;
      recorded ||= appliedOn !== entry.appliedOn;
      resolutions.set(key, appliedOn ? { ...entry, appliedOn } : entry);
    } else {
      dropped.push(outcome.kind === "moved" ? `${pointName(entry.point)} : votre choix ne s’applique plus, choisissez de nouveau.`
        : outcome.kind === "changed" ? `${pointName(entry.point)} : la ligne ou les quantités sur lesquelles vous aviez choisi ont changé, `
          + "choisissez de nouveau."
          : `${pointName(entry.point)} : ce point n’est plus à trancher.`);
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
  if (dropped.length === 0 && !recorded) return { choices, dropped };
  return { choices: { resolutions, pageDecisions } satisfies ItemSendScreenChoices, dropped };
}

/**
 * Whether what a page holds in the estimate changed since the member decided it: its lines or their quantities, or the
 * items of this plan held on it. A decision is asked again then: « Remplacer » would take out something else.
 */
export function itemSendPageHolderChanged(decidedOn: ToResolve, now: ToResolve) {
  const lines = (point: ToResolve) => JSON.stringify([...point.earlier_lines].map((line) => [lower(line.estimate_item_id), line.quantity])
    .sort((left, right) => String(left[0]).localeCompare(String(right[0]))));
  const items = (point: ToResolve) => JSON.stringify([...point.held_item_ids].map(lower).sort());
  return lines(decidedOn) !== lines(now) || items(decidedOn) !== items(now);
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
