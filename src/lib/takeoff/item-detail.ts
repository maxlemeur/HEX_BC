import type { ItemTableLineResponse, ItemTableResponse, ItemTableResponseLine } from "@/lib/takeoff/item-table-contracts";

/**
 * The detail of an item on its plan (lot 5, second depth of the review): what one line of the table of items (lot 4's
 * read contract, GET /api/affaires/{projectId}/takeoff/items) shows once opened on one of its plans. A pure model: the
 * screen draws it, the server decides every gesture again. Its types are the table's contract itself.
 */

export type ItemDetailLine = ItemTableResponseLine;
export type ItemDetailReading = ItemDetailLine["readings"][number];
export type ItemDetailAnswer = NonNullable<ItemDetailReading["answer"]>;
export type ItemDetailObservation = ItemDetailAnswer["observations"][number];
export type ItemDetailEntry = NonNullable<ItemDetailLine["entry"]>;
export type ItemDetailGesture = keyof ItemDetailLine["eligibility"];

/** A page of the table's lines as the table reads it: its page, its plans, the authors' names and the member's right. */
export type ItemDetailQueuePage = Pick<ItemTableResponse, "page" | "canReview" | "names" | "plans">;
/**
 * One item read alone (outside the table's filter, or again after a command), with the member's right the reply carries:
 * `line` is null when the reply no longer holds the item (it left the list or the plan's scope), the right still read.
 */
export type ItemDetailLineRead = Pick<ItemTableLineResponse, "canReview" | "names" | "plans"> & { line: ItemDetailLine | null };


/**
 * What the centre shows for the line: a plan read by an analysis, a plan of the dossier still to measure, or nothing; or
 * `mismatch` when the address names a plan, an answer or an observation that is not this item's: such an address opens
 * nothing (a stale bookmark never shows another evidence as its own).
 */
export type ItemDetailPlanChoice =
  | { kind: "reading"; planKey: string; planName: string; jobId: string; reading: ItemDetailReading; current: boolean;
    observationId: string | null }
  | { kind: "dossier"; planKey: string; planName: string | null; reading: ItemDetailReading | null }
  | { kind: "source"; documentId: string; generation: string | null }
  | { kind: "none" }
  | { kind: "mismatch" };

type DetailIdentifiers = {
  planKey: string | null; jobId: string | null; source: { documentId: string; generation: string | null } | null;
  answerId?: string | null; observationId?: string | null; page?: number | null;
};

/** The plans of an item: those asked about it and those a new measure would read, by their logical identity. */
export function itemDetailPlanKeys(line: ItemDetailLine): Set<string> {
  return new Set([...line.readings.map(({ planKey }) => planKey), ...line.remeasurePlans]);
}

/**
 * The plan the detail opens for a line: the one the address names, with its reading (an earlier one too: an old bookmark
 * opens the old reading's plan, without its evidence until answers are readable by their identity), else the first plan
 * that answered, else the first plan asked, else the first plan a new measure would read (« À mesurer »). Every
 * identifier named is checked to be the item's: a plan or a piece of another item, an answer that is not the reading's,
 * or an observation that is not the answer's is a mismatch. A dossier piece the item has since been read on opens the
 * item's sealed reading of that plan: an old dossier bookmark never shows today's copy as a plan nobody read.
 */
export function chooseItemDetailPlan(line: ItemDetailLine, address: DetailIdentifiers): ItemDetailPlanChoice {
  const plans = itemDetailPlanKeys(line);
  if (address.source) {
    if (!plans.has(address.source.documentId) || address.answerId || address.observationId) return { kind: "mismatch" };
    const read = fromReading(line.readings.find((reading) => reading.planKey === address.source!.documentId) ?? null);
    if (read) return withEvidence(read, { ...address, source: null });
    return { kind: "source", documentId: address.source.documentId, generation: address.source.generation };
  }
  if (address.planKey && !plans.has(address.planKey)) return { kind: "mismatch" };
  const named = address.planKey ? line.readings.find((reading) => reading.planKey === address.planKey) ?? null : null;
  let choice: ItemDetailPlanChoice;
  if (address.planKey && address.jobId) {
    // A reading named is one of this item's readings of that plan (its current one, or an earlier one an old bookmark
    // names): a plan the item was never read on names no reading of it, whatever job read the plan for another item.
    if (!named) return { kind: "mismatch" };
    choice = { kind: "reading", planKey: address.planKey, planName: named.planName, jobId: address.jobId,
      reading: named, current: named.answer?.jobId === address.jobId, observationId: null };
  } else if (address.planKey) {
    choice = fromReading(named) ?? { kind: "dossier", planKey: address.planKey, planName: named?.planName ?? null, reading: named };
  } else {
    const answered = line.readings.find((reading) => reading.answer !== null);
    const first = answered ?? line.readings[0] ?? null;
    const planKey = line.remeasurePlans[0];
    choice = first ? fromReading(first) ?? { kind: "dossier", planKey: first.planKey, planName: first.planName, reading: first }
      : planKey ? { kind: "dossier", planKey, planName: null, reading: null } : { kind: "none" };
  }
  return withEvidence(choice, address);
}

/** The answer and the observation an address names, checked against the reading shown; an earlier reading shows neither. */
function withEvidence(choice: ItemDetailPlanChoice, address: DetailIdentifiers): ItemDetailPlanChoice {
  if (!address.answerId && !address.observationId) return choice;
  if (choice.kind !== "reading") return { kind: "mismatch" };
  if (!choice.current) return choice;
  const answer = choice.reading.answer;
  if (address.answerId && answer?.answerId !== address.answerId) return { kind: "mismatch" };
  const observation = address.observationId ? answer?.observations.find(({ observationId }) => observationId === address.observationId) : null;
  if (address.observationId && !observation) return { kind: "mismatch" };
  // An observation is shown on its page: an address that names it with another page has two meanings.
  if (observation && address.page != null && observation.page !== null && observation.page !== address.page) return { kind: "mismatch" };
  return { ...choice, observationId: address.observationId ?? null };
}

/** The gestures the detail asks for (its buttons and its keys); the table's command decides them again. */
export type ItemDetailOfferedGesture = Extract<ItemDetailGesture, "accept_measured" | "set_aside" | "include_entry" | "enter_quantity">;

export type ItemDetailGestureOffer =
  | { offered: true }
  | { offered: false; reason: "reader" | "not_shown" | "earlier_reading" }
  | { offered: false; reason: "ineligible"; ineligibility: ItemDetailLine["eligibility"][ItemDetailGesture]["reason"] };

/**
 * Whether a review gesture is offered on what the detail shows: to an operator of the affaire's takeoff (`canReview`, the
 * latest read's), on the item's current state (never under an earlier reading, nor where nothing of the item is shown),
 * where its line admits it. The one rule the buttons, the keys and the confirmations read; the server decides again.
 */
export function itemDetailGestureOffer(input: { line: ItemDetailLine; choice: ItemDetailPlanChoice; canReview: boolean },
  gesture: ItemDetailOfferedGesture): ItemDetailGestureOffer {
  if (!input.canReview) return { offered: false, reason: "reader" };
  if (input.choice.kind === "mismatch") return { offered: false, reason: "not_shown" };
  if (input.choice.kind === "reading" && !input.choice.current) return { offered: false, reason: "earlier_reading" };
  if (gesture === "accept_measured" && input.line.quantityOptions && input.choice.kind === "reading"
    && (input.line.quantityOptions.allowCount || input.line.quantityOptions.allowAlternative)) return { offered: true };
  const eligibility = input.line.eligibility[gesture];
  return eligibility.eligible ? { offered: true } : { offered: false, reason: "ineligible", ineligibility: eligibility.reason };
}

function fromReading(reading: ItemDetailReading | null): ItemDetailPlanChoice | null {
  if (!reading?.answer) return null;
  return { kind: "reading", planKey: reading.planKey, planName: reading.planName, jobId: reading.answer.jobId, reading, current: true,
    observationId: null };
}

/** The identifiers that name what the centre shows, written into every address the screen makes, so that each parses. */
export function itemDetailChoiceAddress(choice: ItemDetailPlanChoice): Pick<DetailIdentifiers, "planKey" | "jobId" | "source"> {
  switch (choice.kind) {
    case "reading": return { planKey: choice.planKey, jobId: choice.jobId, source: null };
    case "dossier": return { planKey: choice.planKey, jobId: null, source: null };
    case "source": return { planKey: null, jobId: null, source: { documentId: choice.documentId, generation: choice.generation } };
    default: return { planKey: null, jobId: null, source: null };
  }
}

/** The pages worth turning to on a plan: those of the observations first, then the pages searched, in order. */
export function itemDetailPagesOfInterest(answer: ItemDetailAnswer | null, pagesRead: readonly number[] = []): number[] {
  const pages = [...(answer?.observations ?? []).flatMap(({ page }) => (page === null ? [] : [page])), ...(answer?.searchedPages ?? []),
    ...pagesRead];
  return [...new Set(pages)].sort((left, right) => left - right);
}

/**
 * The page the centre opens: the address's when it has one, else the first observation's, else the first page searched
 * or read, else the plan's first page. A page beyond a known page count is not shown in its place: the first is.
 */
export function itemDetailOpeningPage(input: { requested: number | null; answer: ItemDetailAnswer | null; pagesRead: readonly number[];
  pageCount: number | null; observationId?: string | null }): { page: number; requestedMissing: boolean } {
  const within = (page: number) => input.pageCount === null || page <= input.pageCount;
  if (input.requested !== null) {
    if (within(input.requested)) return { page: input.requested, requestedMissing: false };
    return { page: 1, requestedMissing: true };
  }
  const chosen = input.observationId ? input.answer?.observations.find(({ observationId }) => observationId === input.observationId) : null;
  const observed = chosen?.page ?? input.answer?.observations.find(({ page }) => page !== null)?.page ?? null;
  const candidate = observed ?? input.answer?.searchedPages[0] ?? input.pagesRead[0] ?? 1;
  return { page: within(candidate) ? candidate : 1, requestedMissing: false };
}

/** Where a line is in the frozen queue: its index over every page, and the lines before and after it, when loaded. */
export type ItemDetailQueuePosition = { index: number; total: number; previous: string | null; next: string | null };

/**
 * The frozen queue of the detail: the pages of the table read so far, kept as they were read (a poll or a decision does
 * not move a line while the detail is open), and the neighbours of an item across a page boundary.
 */
export class ItemDetailQueue {
  private readonly pages = new Map<number, ItemDetailQueuePage>();

  constructor(private readonly maxPages = 20) {}

  /** Keeps a page as read the first time; a page read again later does not replace it. */
  add(page: ItemDetailQueuePage) {
    if (this.pages.has(page.page.offset)) return this.pages.get(page.page.offset)!;
    if (this.pages.size >= this.maxPages) {
      const oldest = this.pages.keys().next().value;
      if (oldest !== undefined) this.pages.delete(oldest);
    }
    this.pages.set(page.page.offset, page);
    return page;
  }

  page(offset: number) {
    return this.pages.get(offset) ?? null;
  }

  find(itemId: string): { page: ItemDetailQueuePage; index: number } | null {
    for (const page of this.pages.values()) {
      const index = page.page.lines.findIndex((line) => line.itemId === itemId);
      if (index >= 0) return { page, index };
    }
    return null;
  }

  /** The item before or after, and the offset of the page to read first when it is on a page not read yet. */
  neighbour(itemId: string, step: -1 | 1): { itemId: string } | { offset: number } | null {
    const found = this.find(itemId);
    if (!found) return null;
    const { page, index } = found;
    const within = page.page.lines[index + step];
    if (within) return { itemId: within.itemId };
    const offset = step > 0 ? page.page.offset + page.page.limit : page.page.offset - page.page.limit;
    if (offset < 0 || offset >= page.page.total) return null;
    const other = this.pages.get(offset);
    if (!other) return { offset };
    const line = step > 0 ? other.page.lines[0] : other.page.lines.at(-1);
    return line ? { itemId: line.itemId } : null;
  }

  position(itemId: string): ItemDetailQueuePosition | null {
    const found = this.find(itemId);
    if (!found) return null;
    const { page, index } = found;
    return { index: page.page.offset + index, total: page.page.total, previous: page.page.lines[index - 1]?.itemId ?? null,
      next: page.page.lines[index + 1]?.itemId ?? null };
  }
}
