import { aggregateItemReadings, type ItemAggregateState, type ItemAnswerOutcome, type ItemPlanReading } from "./item-answer-aggregation";
import { takeoffHypothesisCause } from "./hypothesis";
import { compareQuantityPairs } from "./quantity-policy";
import type { QuantityEntryCategory } from "./quantity-entry";
import type { TakeoffUnitState } from "./launch-request-coverage";
import { toUnitToken } from "./units";

/**
 * The table of items of an affaire's takeoff (lot 4, section 3.3 of its specification): the lines of a page, from what
 * the database's table reader gives (public.read_takeoff_item_table: the items in the scope, filtered, ordered and paged
 * in SQL, each with its state and its decision as SQL decides them, its readings per plan, their answers, decisions and
 * entries), and what each review gesture may do with them. A pure model: the server builds the lines it returns and
 * builds them again, on the items a command names, before the database writes; the screen only displays them.
 *
 * Scope: the affaire (every plan the item was asked about) or one plan (the item's answer on it). A review command acts
 * in the scope it was shown in; its targets name each current answer with its decision's revision, and the scope's entry
 * with its revision.
 */

export const ITEM_ANSWER_ANOMALIES = [
  /** A contribution is an hypothesis (estimated, or a quantity the plan cannot show). */
  "hypothesis",
  /** Alternative readings of one object still to choose between. */
  "source_choice",
  /** A confidence below the tenant's threshold. */
  "low_confidence",
  /** A located proof (evidence or page) missing. */
  "missing_evidence",
  /** A control rule that fails, or rules to evaluate again. */
  "rule_failed",
  "rules_stale",
  /** A remark of the reading on a measured answer (a duplicate reading, a vector reading alone…), or a positive row excluded. */
  "alert",
  /** A page already in the estimate waits for its decision. */
  "page_decision",
  /** The answer's unit is not the item's expected unit. */
  "unit_mismatch",
] as const;
export type ItemAnswerAnomaly = (typeof ITEM_ANSWER_ANOMALIES)[number];

export const ITEM_SET_ASIDE_REASONS = ["out_of_scope", "duplicate", "reading_error", "other"] as const;
export type ItemSetAsideReason = (typeof ITEM_SET_ASIDE_REASONS)[number];

export const ITEM_REVIEW_GESTURES = ["accept_measured", "set_aside", "reinstate", "enter_quantity", "include_entry", "remeasure"] as const;
export type ItemReviewGesture = (typeof ITEM_REVIEW_GESTURES)[number];

/** What one review command may hold: beyond it the member narrows the filter, nothing is cut silently. */
export const ITEM_REVIEW_LIMITS = { items: 1_000, answers: 20_000 } as const;

export type ItemTablePoste = {
  id: string;
  /** Its place in the list revision (document order), from 0. */
  position: number;
  label: string;
  expectedUnit: string | null;
  /** The titles of its sections, from the outermost. */
  sectionPath: readonly string[];
  referenceQuantity: number | null;
  /** The DPGF row's own reference (« 3.1.2 »), for an item of the DPGF. */
  dpgfReference: string | null;
  origin: "dpgf" | "template" | "manual";
};

export type ItemTablePlan = {
  /** The plan's logical identity (the launch manifest's `logical_id`): stable across copies. */
  key: string;
  name: string;
  location: { key: string; label: string } | null;
};

export type ItemObservationView = {
  observationId: string;
  /** contribution: counted in the answer's total; candidate: an indication; alternative: another reading, never added. */
  role: "contribution" | "candidate" | "alternative";
  quantity: number;
  unit: string;
  page: number | null;
  evidence: string | null;
  confidence: number | null;
  method: string | null;
  /** A contribution's row of the job (what the targeted review corrects). */
  takeoffItemId: string | null;
};

/** One stored answer of an item on a plan (its raw reading), with the anomalies the server found for its review. */
export type ItemAnswerView = {
  answerId: string;
  /** The digest of the raw answer, as the database gives it; a command names the answer's id, which is unique. */
  revision: string;
  jobId: string;
  outcome: ItemAnswerOutcome;
  /** A measured answer's total: the sum of its contributions. */
  quantity: { quantity: number; unit: string } | null;
  reasonCode: string | null;
  reasonText: string | null;
  searchedPages: number[];
  unreadablePages: number[];
  observations: ItemObservationView[];
  /** An uncertain answer's candidate value: never a measured quantity. */
  candidate: { quantity: number; unit: string } | null;
  anomalies: ItemAnswerAnomaly[];
  readAt: string;
};

export type ItemAnswerDecision =
  | { kind: "accepted"; revision: number; actorId: string; at: string }
  | { kind: "set_aside"; revision: number; reason: ItemSetAsideReason; note: string | null; actorId: string; at: string };

/**
 * One plan's reading of one item, as the database gives it: the plan, the latest job asked and its unit's state, whether
 * the pair is answered, in flight or ended, the current answer (also while a new reading runs), its decision and the
 * revision of its decision (which goes on after a reinstatement), and the plan's entry.
 */
export type ItemReadingInput = {
  itemId: string;
  planKey: string;
  planName: string;
  location: string | null;
  unit: TakeoffUnitState;
  reading: "answered" | "in_flight" | "ended";
  answer: ItemAnswerView | null;
  decision: ItemAnswerDecision | null;
  decisionRevision: number;
  entry: ItemEntryView | null;
};

/** A quantity entered by a member for the whole item (affaire) or for its answer on one plan. */
export type ItemEntryView = {
  itemId: string;
  scope: "affaire" | "plan";
  planKey: string | null;
  revision: number;
  quantity: number;
  unit: string;
  category: QuantityEntryCategory;
  note: string | null;
  /** An hypothesis counts only once a member included it by its own decision. */
  included: boolean;
  actorId: string;
  at: string;
  previous: { quantity: number; unit: string } | null;
};

export type ItemTableScope = { kind: "affaire" } | { kind: "plan"; planKey: string };

export const ITEM_LINE_DECISIONS = ["pending", "accepted", "set_aside", "entered", "none"] as const;
/** pending: an answer waits for a decision; none: nothing to decide yet (not read, or being read). SQL decides it. */
export type ItemLineDecision = (typeof ITEM_LINE_DECISIONS)[number];

export type ItemTableFilter = {
  states?: ItemAggregateState[];
  /** Section paths, as « Plomberie / Robinetterie ». */
  families?: string[];
  /** Plan locations (their key): the items read on a plan there. */
  locations?: string[];
  decisions?: ItemLineDecision[];
};

/** One item of a page as the database gives it: its facts, its state and its decision (SQL's), its readings, its entry. */
export type ItemTableRow = {
  item: ItemTablePoste;
  state: ItemAggregateState;
  coverage: { expected: number; answered: number; inFlight: number; ended: number };
  decision: ItemLineDecision;
  readings: readonly ItemReadingInput[];
  /** The scope's entry: the whole item's in the affaire's scope, the plan's in a plan's scope. */
  entry: ItemEntryView | null;
};

/** Why a gesture does not apply to a line, by its code: the screen words each one. */
export const ITEM_INELIGIBILITIES = [
  "not_measured", "coverage_incomplete", "anomaly", "dpgf_gap", "unit_conflict", "already_decided", "entered", "no_answer",
  "already_set_aside", "not_set_aside", "not_entry_state", "no_entry_to_include", "reading", "no_plan",
] as const;
export type ItemIneligibility = (typeof ITEM_INELIGIBILITIES)[number];

export type ItemGestureEligibility = { eligible: boolean; reason: ItemIneligibility | null };

export type ItemReviewTarget = {
  itemId: string;
  /** The revision of the entry of the scope (0 without one). */
  entryRevision: number;
  answers: Array<{ answerId: string; answerRevision: string; decisionRevision: number }>;
};

export type ItemTableLine = {
  itemId: string;
  position: number;
  label: string;
  expectedUnit: string | null;
  sectionPath: string[];
  family: string | null;
  origin: ItemTablePoste["origin"];
  reference: { quantity: number; dpgfReference: string | null } | null;
  state: ItemAggregateState;
  coverage: { expected: number; answered: number; inFlight: number; ended: number };
  observed: { quantity: number; unit: string; partial: boolean } | null;
  retained: { quantity: number; unit: string; source: "measured" | "entered" | "mixed"; partial: boolean } | null;
  entry: ItemEntryView | null;
  gap: { quantity: number; percent: number | null; requiresReview: boolean } | null;
  reasons: string[];
  planCount: number;
  decision: ItemLineDecision;
  readings: Array<Omit<ItemReadingInput, "itemId" | "reading" | "decisionRevision">>;
  targets: ItemReviewTarget;
  remeasurePlans: string[];
  eligibility: Record<ItemReviewGesture, ItemGestureEligibility>;
};

export type ItemTableFacets = {
  states: Record<ItemAggregateState, number>;
  decisions: Record<ItemLineDecision, number>;
  families: Array<{ value: string; count: number }>;
  locations: Array<{ value: string; label: string; count: number }>;
  plans: Array<{ key: string; name: string; count: number }>;
};

const SCALE = 1e6;
const sum = (values: readonly number[]) => values.reduce((total, value) => total + Math.round(value * SCALE), 0) / SCALE;
const yes: ItemGestureEligibility = { eligible: true, reason: null };
const no = (reason: ItemIneligibility): ItemGestureEligibility => ({ eligible: false, reason });

/** One plan's reading as the state rule reads it (the same as SQL's: an answer counts once its pair is answered). */
function asPlanReading(reading: ItemReadingInput): ItemPlanReading {
  if (reading.reading === "in_flight") return { reading: "in_flight" };
  if (reading.reading === "ended" || !reading.answer) return { reading: "ended" };
  return { reading: "answered", outcome: reading.answer.outcome, quantity: reading.answer.quantity?.quantity ?? null,
    unit: reading.answer.quantity?.unit ?? null };
}

type LineReading = ItemTableLine["readings"][number];

function retainedOf(readings: readonly LineReading[], entry: ItemEntryView | null, complete: boolean): ItemTableLine["retained"] {
  if (entry) {
    return entry.included ? { quantity: entry.quantity, unit: entry.unit, source: "entered", partial: false } : null;
  }
  const parts: Array<{ quantity: number; unit: string; source: "measured" | "entered" }> = [];
  let undecided = !complete;
  for (const reading of readings) {
    if (!reading.answer) continue;
    if (reading.entry) {
      if (reading.entry.included) parts.push({ quantity: reading.entry.quantity, unit: reading.entry.unit, source: "entered" });
      continue;
    }
    if (reading.decision?.kind === "set_aside") continue;
    const measured = reading.answer.outcome === "measured" ? reading.answer.quantity : null;
    if (reading.decision?.kind === "accepted" && measured) parts.push({ ...measured, source: "measured" });
    else if (!reading.decision) undecided = true;
  }
  if (!parts.length) return null;
  const token = toUnitToken(parts[0].unit);
  if (parts.some(({ unit }) => toUnitToken(unit) !== token)) return null;
  const sources = new Set(parts.map(({ source }) => source));
  return { quantity: sum(parts.map(({ quantity }) => quantity)), unit: parts[0].unit,
    source: sources.size > 1 ? "mixed" : parts[0].source, partial: undecided };
}

function gapOf(item: ItemTablePoste, basis: { quantity: number } | null, complete: boolean): ItemTableLine["gap"] {
  if (item.referenceQuantity === null || item.referenceQuantity < 0 || !basis || !complete) return null;
  const pair = compareQuantityPairs([{ reference: item.referenceQuantity, measured: basis.quantity }])!;
  const quantity = (Math.round(basis.quantity * SCALE) - Math.round(item.referenceQuantity * SCALE)) / SCALE;
  return { quantity, percent: item.referenceQuantity > 0 ? Math.round(quantity / item.referenceQuantity * 100 * 100) / 100 : null,
    requiresReview: pair.requiresReview };
}

function eligibility(line: Omit<ItemTableLine, "eligibility" | "remeasurePlans">, plans: readonly ItemTablePlan[], scope: ItemTableScope) {
  const answered = line.readings.filter(({ answer }) => answer);
  const undecided = answered.filter(({ decision, entry }) => !decision && !entry);
  const complete = line.coverage.expected > 0 && line.coverage.answered === line.coverage.expected;

  const accept = (() => {
    if (line.state === "reading" || line.state === "incomplete" || line.state === "failed") return no("coverage_incomplete");
    if (line.state !== "measured") return no("not_measured");
    if (line.entry) return no("entered");
    if (!undecided.length) return no("already_decided");
    if (undecided.some(({ answer }) => answer!.anomalies.length > 0)) return no("anomaly");
    if (line.gap?.requiresReview) return no("dpgf_gap");
    if (line.reasons.includes("unit_conflict")) return no("unit_conflict");
    return yes;
  })();
  const setAside = !answered.length ? no("no_answer")
    : answered.some(({ decision }) => decision?.kind !== "set_aside") ? yes : no("already_set_aside");
  const reinstate = answered.some(({ decision }) => decision?.kind === "set_aside") ? yes : no("not_set_aside");
  const enter = complete && (line.state === "not_found" || line.state === "uncertain") ? yes : no("not_entry_state");
  const includeEntry = line.entry && !line.entry.included ? yes : no("no_entry_to_include");

  const remeasurePlans = scope.kind === "plan"
    ? plans.some(({ key }) => key === scope.planKey) || line.readings.length ? [scope.planKey] : []
    : line.readings.length ? line.readings.map(({ planKey }) => planKey) : plans.map(({ key }) => key);
  const remeasure = line.coverage.inFlight > 0 ? no("reading") : remeasurePlans.length ? yes : no("no_plan");

  return {
    remeasurePlans,
    eligibility: { accept_measured: accept, set_aside: setAside, reinstate, enter_quantity: enter, include_entry: includeEntry,
      remeasure },
  };
}

function buildLine(row: ItemTableRow, plans: readonly ItemTablePlan[], scope: ItemTableScope): ItemTableLine {
  const { item } = row;
  const lineReadings: LineReading[] = row.readings.map((reading) => ({
    planKey: reading.planKey,
    planName: reading.planName,
    location: reading.location,
    unit: reading.unit,
    answer: reading.answer,
    decision: reading.decision,
    // In a plan's scope the entry of the plan is the line's own: it is not also a part of a reading.
    entry: scope.kind === "plan" ? null : reading.entry,
  }));
  const aggregate = aggregateItemReadings(row.readings.map(asPlanReading));
  const complete = row.coverage.expected > 0 && row.coverage.answered === row.coverage.expected;
  const retained = retainedOf(lineReadings, row.entry, complete);
  const gap = gapOf(item, retained && !retained.partial ? retained : aggregate.observed, complete);

  const reasons = new Set<string>();
  for (const reading of row.readings) {
    const { answer } = reading;
    if (!answer) {
      if (reading.reading === "ended") reasons.add("reading_ended");
      continue;
    }
    if (answer.reasonCode && answer.outcome !== "measured") reasons.add(`answer_reason:${answer.reasonCode}`);
    for (const anomaly of answer.anomalies) reasons.add(`anomaly:${anomaly}`);
    if (answer.unreadablePages.length) reasons.add("unreadable_pages");
  }
  if (aggregate.unitConflict) reasons.add("unit_conflict");
  if (gap?.requiresReview) reasons.add("dpgf_gap");
  if (row.entry && !row.entry.included) reasons.add("hypothesis_to_include");

  const base = {
    itemId: item.id,
    position: item.position,
    label: item.label,
    expectedUnit: item.expectedUnit,
    sectionPath: [...item.sectionPath],
    family: item.sectionPath.length ? item.sectionPath.join(" / ") : null,
    origin: item.origin,
    reference: item.referenceQuantity === null ? null : { quantity: item.referenceQuantity, dpgfReference: item.dpgfReference },
    state: row.state,
    coverage: row.coverage,
    observed: aggregate.observed,
    retained,
    entry: row.entry,
    gap,
    reasons: [...reasons],
    planCount: new Set(row.readings.map(({ planKey }) => planKey)).size,
    decision: row.decision,
    readings: lineReadings,
    targets: {
      itemId: item.id,
      entryRevision: row.entry?.revision ?? 0,
      answers: row.readings.flatMap(({ answer, decisionRevision }) => answer
        ? [{ answerId: answer.answerId, answerRevision: answer.revision, decisionRevision }] : []),
    },
  };
  return { ...base, ...eligibility(base, plans, scope) };
}

/** The lines of a page, in the order the database gave its rows. */
export function buildItemLines(rows: readonly ItemTableRow[], context: { plans: readonly ItemTablePlan[]; scope: ItemTableScope }) {
  return rows.map((row) => buildLine(row, context.plans, context.scope));
}

/** A positive row of a measured answer, as its anomalies read it (takeoff_items, the row the targeted review corrects). */
export type ItemContributionRow = {
  id: string;
  isExcluded: boolean;
  rulesStale: boolean;
  ruleResults: unknown;
  confidence: number | null;
  evidence: string | null;
  sourcePage: number | null;
  metadata: unknown;
  quantityEntryCategory: string | null;
};

/**
 * What keeps an answer out of the bulk acceptance, from its own facts and its positive rows: an hypothesis, rules to
 * evaluate again or failing, a confidence below the tenant's threshold, a located proof missing, a positive row
 * excluded or a remark of the reading on a measured answer, a unit other than the item's.
 */
export function itemAnswerAnomalies(answer: Pick<ItemAnswerView, "outcome" | "quantity" | "reasonCode" | "observations">,
  rows: ReadonlyMap<string, ItemContributionRow>, context: { expectedUnit: string | null; lowConfidenceThreshold: number }) {
  const anomalies = new Set<ItemAnswerAnomaly>();
  if (answer.outcome === "measured") {
    if (answer.reasonCode) anomalies.add("alert");
    if (context.expectedUnit && answer.quantity && toUnitToken(answer.quantity.unit) !== toUnitToken(context.expectedUnit)) {
      anomalies.add("unit_mismatch");
    }
  }
  for (const observation of answer.observations) {
    if (observation.role !== "contribution" || !observation.takeoffItemId) continue;
    const row = rows.get(observation.takeoffItemId);
    if (!row) {
      anomalies.add("missing_evidence");
      continue;
    }
    if (takeoffHypothesisCause({ metadata: row.metadata, quantity_entry_category: row.quantityEntryCategory })) anomalies.add("hypothesis");
    if (row.rulesStale) anomalies.add("rules_stale");
    if (Array.isArray(row.ruleResults) && row.ruleResults.some((result) =>
      result && typeof result === "object" && (result as { status?: unknown }).status === "fail")) anomalies.add("rule_failed");
    if (row.confidence !== null && row.confidence < context.lowConfidenceThreshold) anomalies.add("low_confidence");
    if (!row.evidence?.trim() || row.sourcePage === null || row.sourcePage < 1) anomalies.add("missing_evidence");
    if (row.isExcluded) anomalies.add("alert");
  }
  return ITEM_ANSWER_ANOMALIES.filter((anomaly) => anomalies.has(anomaly));
}

export type ItemSelectionCounts = Record<ItemReviewGesture, number>;

/** What a selection above its bound is told. */
export const ITEM_SELECTION_TOO_LARGE = "Une sélection tient en 1\u202f000 postes au plus : affinez le filtre.";

const eligibleGestures = (line: ItemTableLine) => ITEM_REVIEW_GESTURES.filter((gesture) => line.eligibility[gesture].eligible);

/**
 * A frozen selection of lines (every result of a filter, or the items a member ticked), each with the revisions a command
 * will name and the gestures that apply to it. Above its bound the selection is refused, never cut.
 */
export function freezeItemSelection(lines: readonly ItemTableLine[], requested: readonly string[] | null = null) {
  if (lines.length > ITEM_REVIEW_LIMITS.items
    || lines.reduce((total, line) => total + line.targets.answers.length, 0) > ITEM_REVIEW_LIMITS.answers) {
    throw new RangeError(ITEM_SELECTION_TOO_LARGE);
  }
  const found = new Set(lines.map(({ itemId }) => itemId));
  const items = lines.map((line) => ({ itemId: line.itemId, label: line.label, target: line.targets,
    eligible: eligibleGestures(line) }));
  const eligible = Object.fromEntries(ITEM_REVIEW_GESTURES.map((gesture) =>
    [gesture, items.filter((item) => item.eligible.includes(gesture)).length])) as ItemSelectionCounts;
  return { count: items.length, items, eligible, missing: requested ? [...new Set(requested)].filter((id) => !found.has(id)) : [] };
}

const answerKey = (answer: ItemReviewTarget["answers"][number]) => `${answer.answerId.toLowerCase()}#${answer.decisionRevision}`;

/**
 * The targets of a command that no longer describe what the table holds: an item gone from the scope, an answer read
 * again or arrived, a decision or an entry written since. The database is the judge (it compares again under its lock);
 * the server uses this to word what it sends.
 */
export function checkItemReviewTargets(lines: readonly ItemTableLine[], targets: readonly ItemReviewTarget[]) {
  const byId = new Map(lines.map((line) => [line.itemId, line]));
  const stale = targets.flatMap((target) => {
    const line = byId.get(target.itemId);
    if (!line) return [{ itemId: target.itemId, label: null as string | null }];
    const current = line.targets;
    const same = current.entryRevision === target.entryRevision && current.answers.length === target.answers.length
      && current.answers.map(answerKey).sort().join() === target.answers.map(answerKey).sort().join();
    return same ? [] : [{ itemId: target.itemId, label: line.label as string | null }];
  });
  return { stale };
}

export type ItemReviewPlan =
  | { kind: "stale"; stale: Array<{ itemId: string; label: string | null }> }
  | { kind: "planned"; apply: Array<{ itemId: string; label: string }>;
    skipped: Array<{ itemId: string; label: string; reason: ItemIneligibility }> };

/**
 * What a review command applies to, decided on the lines built again: nothing on a stale selection; otherwise the
 * eligible lines, and the others named with their reason.
 */
export function planItemReviewCommand(lines: readonly ItemTableLine[], command: { gesture: Exclude<ItemReviewGesture, "remeasure">;
  targets: readonly ItemReviewTarget[] }): ItemReviewPlan {
  const { stale } = checkItemReviewTargets(lines, command.targets);
  if (stale.length) return { kind: "stale", stale };
  const byId = new Map(lines.map((line) => [line.itemId, line]));
  const apply: Extract<ItemReviewPlan, { kind: "planned" }>["apply"] = [];
  const skipped: Extract<ItemReviewPlan, { kind: "planned" }>["skipped"] = [];
  for (const target of command.targets) {
    const line = byId.get(target.itemId)!;
    const verdict = line.eligibility[command.gesture];
    if (verdict.eligible) apply.push({ itemId: line.itemId, label: line.label });
    else skipped.push({ itemId: line.itemId, label: line.label, reason: verdict.reason! });
  }
  return { kind: "planned", apply, skipped };
}
