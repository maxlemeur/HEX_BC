import type { TakeoffUnitState } from "@/lib/takeoff/launch-request-coverage";

/**
 * The detail of an item on its plan (lot 5, second depth of the review): what one line of the table of items (lot 4's
 * read contract, GET /api/affaires/{projectId}/takeoff/items) shows once opened on one of its plans. A pure model: the
 * screen draws it, the server decides every gesture again.
 *
 * The types below are the part of lot 4's line the detail reads, field for field: a line of that contract is one of
 * them. Until lot 4's table is on main, its words for the codes are repeated here (item-detail-labels.ts).
 */

export type ItemDetailState = "to_measure" | "reading" | "incomplete" | "failed" | "measured" | "uncertain" | "not_found";
export type ItemDetailLineDecision = "pending" | "accepted" | "set_aside" | "entered" | "none";
export type ItemDetailGesture = "accept_measured" | "set_aside" | "reinstate" | "enter_quantity" | "include_entry" | "remeasure";

export type ItemDetailObservation = {
  observationId: string;
  quantity: number;
  unit: string;
  page: number | null;
  evidence: string | null;
  confidence: number | null;
  method: string | null;
};

export type ItemDetailAnswer = {
  answerId: string;
  revision: string;
  jobId: string;
  outcome: "measured" | "uncertain" | "not_found";
  reasonCode: string | null;
  reasonText: string | null;
  searchedPages: number[];
  unreadablePages: number[];
  observations: ItemDetailObservation[];
  candidate: { quantity: number; unit: string } | null;
  anomalies: string[];
  readAt: string;
};

export type ItemDetailDecision =
  | { kind: "accepted"; revision: number; actorId: string; at: string }
  | { kind: "set_aside"; revision: number; reason: string; note: string | null; actorId: string; at: string };

export type ItemDetailEntry = {
  itemId: string;
  scope: "affaire" | "plan";
  planKey: string | null;
  revision: number;
  quantity: number;
  unit: string;
  category: string;
  note: string | null;
  included: boolean;
  actorId: string;
  at: string;
  previous: { quantity: number; unit: string } | null;
};

export type ItemDetailReading = {
  planKey: string;
  planName: string;
  location: string | null;
  unit: TakeoffUnitState;
  answer: ItemDetailAnswer | null;
  decision: ItemDetailDecision | null;
  entry: ItemDetailEntry | null;
};

export type ItemDetailLine = {
  itemId: string;
  position: number;
  label: string;
  expectedUnit: string | null;
  sectionPath: string[];
  family: string | null;
  state: ItemDetailState;
  coverage: { expected: number; answered: number; inFlight: number; ended: number };
  observed: { quantity: number; unit: string; partial: boolean } | null;
  retained: { quantity: number; unit: string; source: "measured" | "entered" | "mixed"; partial: boolean } | null;
  entry: ItemDetailEntry | null;
  reasons: string[];
  planCount: number;
  decision: ItemDetailLineDecision;
  readings: ItemDetailReading[];
  remeasurePlans: string[];
  eligibility: Record<ItemDetailGesture, { eligible: boolean; reason: string | null }>;
};

/** A page of the table's lines, in the order and the filter the table showed them. */
export type ItemDetailQueuePage = {
  lines: ItemDetailLine[];
  total: number;
  offset: number;
  limit: number;
  canReview: boolean;
  /** The authors of the decisions and entries shown, by member. */
  names: Record<string, string>;
  /** The plans the list was read on, with the names the dossier gives them. */
  plans: Array<{ key: string; name: string }>;
};

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
  answerId?: string | null; observationId?: string | null;
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
 * or an observation that is not the answer's is a mismatch.
 */
export function chooseItemDetailPlan(line: ItemDetailLine, address: DetailIdentifiers): ItemDetailPlanChoice {
  const plans = itemDetailPlanKeys(line);
  if (address.source) {
    if (!plans.has(address.source.documentId) || address.answerId || address.observationId) return { kind: "mismatch" };
    return { kind: "source", documentId: address.source.documentId, generation: address.source.generation };
  }
  if (address.planKey && !plans.has(address.planKey)) return { kind: "mismatch" };
  const named = address.planKey ? line.readings.find((reading) => reading.planKey === address.planKey) ?? null : null;
  let choice: ItemDetailPlanChoice;
  if (address.planKey && address.jobId) {
    choice = { kind: "reading", planKey: address.planKey, planName: named?.planName ?? "Plan", jobId: address.jobId,
      reading: named ?? emptyReading(address.planKey), current: named?.answer?.jobId === address.jobId, observationId: null };
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
  if (address.observationId && !answer?.observations.some(({ observationId }) => observationId === address.observationId)) {
    return { kind: "mismatch" };
  }
  return { ...choice, observationId: address.observationId ?? null };
}

function fromReading(reading: ItemDetailReading | null): ItemDetailPlanChoice | null {
  if (!reading?.answer) return null;
  return { kind: "reading", planKey: reading.planKey, planName: reading.planName, jobId: reading.answer.jobId, reading, current: true,
    observationId: null };
}

function emptyReading(planKey: string): ItemDetailReading {
  return { planKey, planName: "Plan", location: null, unit: "succeeded", answer: null, decision: null, entry: null };
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
    if (this.pages.has(page.offset)) return this.pages.get(page.offset)!;
    if (this.pages.size >= this.maxPages) {
      const oldest = this.pages.keys().next().value;
      if (oldest !== undefined) this.pages.delete(oldest);
    }
    this.pages.set(page.offset, page);
    return page;
  }

  page(offset: number) {
    return this.pages.get(offset) ?? null;
  }

  find(itemId: string): { page: ItemDetailQueuePage; index: number } | null {
    for (const page of this.pages.values()) {
      const index = page.lines.findIndex((line) => line.itemId === itemId);
      if (index >= 0) return { page, index };
    }
    return null;
  }

  /** The item before or after, and the offset of the page to read first when it is on a page not read yet. */
  neighbour(itemId: string, step: -1 | 1): { itemId: string } | { offset: number } | null {
    const found = this.find(itemId);
    if (!found) return null;
    const { page, index } = found;
    const within = page.lines[index + step];
    if (within) return { itemId: within.itemId };
    const offset = step > 0 ? page.offset + page.limit : page.offset - page.limit;
    if (offset < 0 || offset >= page.total) return null;
    const other = this.pages.get(offset);
    if (!other) return { offset };
    const line = step > 0 ? other.lines[0] : other.lines.at(-1);
    return line ? { itemId: line.itemId } : null;
  }

  position(itemId: string): ItemDetailQueuePosition | null {
    const found = this.find(itemId);
    if (!found) return null;
    const { page, index } = found;
    return { index: page.offset + index, total: page.total, previous: page.lines[index - 1]?.itemId ?? null,
      next: page.lines[index + 1]?.itemId ?? null };
  }
}
