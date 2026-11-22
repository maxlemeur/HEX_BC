import { aggregateItemReadings, type ItemAggregateState, type ItemAnswerOutcome, type ItemPlanReading } from "./item-answer-aggregation";
import { compareQuantityPairs } from "./quantity-policy";
import type { QuantityEntryCategory } from "./quantity-entry";
import type { TakeoffUnitState } from "./launch-request-coverage";
import { toUnitToken } from "./units";

/**
 * The table of items of an affaire's takeoff (lot 4, section 3.3 of its specification): a line per item of the list,
 * from the stored list revision and the answers each plan gave, and what each review gesture may do with it. A pure
 * model: the server builds it for the page it returns and builds it again, on the frozen selection a command names,
 * before it writes; the screen only displays what it computed.
 *
 * Scope: the affaire (every plan the item was asked about) or one plan (the item's answer on it). A review command acts
 * in the scope it was shown in; its targets name each answer with its revision and its decision's revision.
 */

export const ITEM_ANSWER_ANOMALIES = [
  /** A contribution is an hypothesis (estimated, or a quantity the plan cannot show). */
  "hypothesis",
  /** Alternative readings of one object (PDF, vectors) still to choose between. */
  "source_choice",
  /** A confidence below the tenant's threshold. */
  "low_confidence",
  /** A located proof (evidence or page) missing. */
  "missing_evidence",
  /** A control rule that fails, or rules to evaluate again. */
  "rule_failed",
  "rules_stale",
  /** An alert of the reading nobody decided. */
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
  /** The plan's logical identity (its dossier piece, or the copy uploaded to the plan set): stable across copies. */
  key: string;
  name: string;
  location: { key: string; label: string } | null;
};

export type ItemObservationView = {
  observationId: string;
  quantity: number;
  unit: string;
  page: number | null;
  evidence: string | null;
  confidence: number | null;
  method: string | null;
};

/** One stored answer of an item on a plan (its raw reading), with the anomalies the server found for its review. */
export type ItemAnswerView = {
  answerId: string;
  /** Compared as is: a review command names the revision it saw. */
  revision: string;
  jobId: string;
  outcome: ItemAnswerOutcome;
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

/** One plan's reading of one item: the plan's unit of work, and the answer it published with its decision. */
export type ItemReadingInput = {
  itemId: string;
  planKey: string;
  unit: TakeoffUnitState;
  answer: ItemAnswerView | null;
  decision: ItemAnswerDecision | null;
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
/** pending: an answer waits for a decision; none: nothing to decide yet (not read, or being read). */
export type ItemLineDecision = (typeof ITEM_LINE_DECISIONS)[number];

export type ItemTableFilter = {
  states?: ItemAggregateState[];
  /** Section paths, as « Plomberie / Robinetterie ». */
  families?: string[];
  /** Plan locations: the items read on a plan there. */
  locations?: string[];
  decisions?: ItemLineDecision[];
};

export type ItemTableInput = {
  items: readonly ItemTablePoste[];
  plans: readonly ItemTablePlan[];
  readings: readonly ItemReadingInput[];
  entries: readonly ItemEntryView[];
  scope: ItemTableScope;
  filter?: ItemTableFilter;
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
  readings: Array<{
    planKey: string;
    planName: string;
    location: string | null;
    unit: TakeoffUnitState;
    answer: ItemAnswerView | null;
    decision: ItemAnswerDecision | null;
    entry: ItemEntryView | null;
  }>;
  targets: ItemReviewTarget;
  remeasurePlans: string[];
  eligibility: Record<ItemReviewGesture, ItemGestureEligibility>;
};

export type ItemTableView = {
  scope: ItemTableScope;
  lines: ItemTableLine[];
  facets: {
    states: Record<ItemAggregateState, number>;
    decisions: Record<ItemLineDecision, number>;
    families: Array<{ value: string; count: number }>;
    locations: Array<{ value: string; label: string; count: number }>;
    plans: Array<{ key: string; name: string; count: number }>;
  };
};

const SCALE = 1e6;
const sum = (values: readonly number[]) => values.reduce((total, value) => total + Math.round(value * SCALE), 0) / SCALE;
const yes: ItemGestureEligibility = { eligible: true, reason: null };
const no = (reason: ItemIneligibility): ItemGestureEligibility => ({ eligible: false, reason });

function answerQuantity(answer: ItemAnswerView) {
  if (answer.outcome !== "measured" || !answer.observations.length) return null;
  return { quantity: sum(answer.observations.map(({ quantity }) => quantity)), unit: answer.observations[0].unit };
}

function asPlanReading(reading: ItemReadingInput): ItemPlanReading {
  if (reading.answer) {
    const measured = answerQuantity(reading.answer);
    return { reading: "answered", outcome: reading.answer.outcome, quantity: measured?.quantity ?? null, unit: measured?.unit ?? null };
  }
  // A plan read without an answer for an item it was asked about ended without a verdict for it.
  if (reading.unit === "succeeded") return { reading: "failed" };
  return { reading: reading.unit };
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
    const measured = answerQuantity(reading.answer);
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

function lineDecision(readings: readonly LineReading[], entry: ItemEntryView | null): ItemLineDecision {
  const answered = readings.filter(({ answer }) => answer);
  if (!answered.length) return "none";
  if (entry) return "entered";
  if (answered.every(({ decision, entry: own }) => decision?.kind === "set_aside" && !own)) return "set_aside";
  if (answered.some(({ decision, entry: own }) => !decision && !own)) return "pending";
  return answered.some(({ entry: own }) => own) ? "entered" : "accepted";
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
    ? plans.some(({ key }) => key === scope.planKey) ? [scope.planKey] : []
    : line.readings.length ? line.readings.map(({ planKey }) => planKey) : plans.map(({ key }) => key);
  const remeasure = line.coverage.inFlight > 0 ? no("reading") : remeasurePlans.length ? yes : no("no_plan");

  return {
    remeasurePlans,
    eligibility: { accept_measured: accept, set_aside: setAside, reinstate, enter_quantity: enter, include_entry: includeEntry,
      remeasure },
  };
}

function buildLine(item: ItemTablePoste, readings: readonly ItemReadingInput[], entries: readonly ItemEntryView[],
  plans: ReadonlyMap<string, ItemTablePlan>, planOrder: readonly ItemTablePlan[], scope: ItemTableScope): ItemTableLine {
  const entryOf = (planKey: string | null) => entries.find((entry) => entry.itemId === item.id
    && (planKey === null ? entry.scope === "affaire" : entry.scope === "plan" && entry.planKey === planKey)) ?? null;
  const lineReadings: LineReading[] = readings.map((reading) => ({
    planKey: reading.planKey,
    planName: plans.get(reading.planKey)?.name ?? "Plan",
    location: plans.get(reading.planKey)?.location?.label ?? null,
    unit: reading.unit,
    answer: reading.answer,
    decision: reading.decision,
    entry: entryOf(reading.planKey),
  }));
  const entry = scope.kind === "affaire" ? entryOf(null) : entryOf(scope.planKey);
  // In a plan's scope the entry of the plan is the line's own: it is not also a part of a reading.
  if (scope.kind === "plan") for (const reading of lineReadings) reading.entry = null;
  const aggregate = aggregateItemReadings(readings.map(asPlanReading));
  const complete = aggregate.coverage.expected > 0 && aggregate.coverage.answered === aggregate.coverage.expected;
  const retained = retainedOf(lineReadings, entry, complete);
  const gap = gapOf(item, retained && !retained.partial ? retained : aggregate.observed, complete);

  const reasons = new Set<string>();
  for (const { answer, unit } of lineReadings) {
    if (!answer) {
      if (unit === "failed" || unit === "canceled" || unit === "not_started" || unit === "succeeded") reasons.add("reading_ended");
      continue;
    }
    if (answer.reasonCode && answer.outcome !== "measured") reasons.add(`answer_reason:${answer.reasonCode}`);
    for (const anomaly of answer.anomalies) reasons.add(`anomaly:${anomaly}`);
    if (answer.unreadablePages.length) reasons.add("unreadable_pages");
  }
  if (aggregate.unitConflict) reasons.add("unit_conflict");
  if (gap?.requiresReview) reasons.add("dpgf_gap");
  if (entry && !entry.included) reasons.add("hypothesis_to_include");

  const base = {
    itemId: item.id,
    position: item.position,
    label: item.label,
    expectedUnit: item.expectedUnit,
    sectionPath: [...item.sectionPath],
    family: item.sectionPath.length ? item.sectionPath.join(" / ") : null,
    origin: item.origin,
    reference: item.referenceQuantity === null ? null : { quantity: item.referenceQuantity, dpgfReference: item.dpgfReference },
    state: aggregate.state,
    coverage: aggregate.coverage,
    observed: aggregate.observed,
    retained,
    entry,
    gap,
    reasons: [...reasons],
    planCount: new Set(readings.map(({ planKey }) => planKey)).size,
    decision: lineDecision(lineReadings, entry),
    readings: lineReadings,
    targets: {
      itemId: item.id,
      entryRevision: entry?.revision ?? 0,
      answers: lineReadings.flatMap(({ answer, decision }) => answer
        ? [{ answerId: answer.answerId, answerRevision: answer.revision, decisionRevision: decision?.revision ?? 0 }] : []),
    },
  };
  return { ...base, ...eligibility(base, planOrder, scope) };
}

const DECISION_FIRST: Record<ItemLineDecision, number> = { pending: 0, accepted: 1, set_aside: 1, entered: 1, none: 1 };

function countBy<T extends string>(keys: readonly T[], values: readonly T[]) {
  const counts = Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
  for (const value of values) counts[value] += 1;
  return counts;
}

/**
 * The lines of the table in the scope, then filtered: the decisions to take first, the stable document order after. The
 * facets count the scope before the filters, so that a filter never hides its own options.
 */
export function buildItemTable(input: ItemTableInput): ItemTableView {
  const plans = new Map(input.plans.map((plan) => [plan.key, plan]));
  const planRank = new Map(input.plans.map(({ key }, index) => [key, index]));
  const readingsByItem = new Map<string, ItemReadingInput[]>();
  for (const reading of input.readings) {
    if (input.scope.kind === "plan" && reading.planKey !== input.scope.planKey) continue;
    const list = readingsByItem.get(reading.itemId) ?? [];
    list.push(reading);
    readingsByItem.set(reading.itemId, list);
  }
  for (const list of readingsByItem.values()) {
    list.sort((left, right) => (planRank.get(left.planKey) ?? Infinity) - (planRank.get(right.planKey) ?? Infinity));
  }
  const items = [...input.items].sort((left, right) => left.position - right.position)
    .filter(({ id }) => input.scope.kind === "affaire" || readingsByItem.has(id));
  const scoped = items.map((item) => buildLine(item, readingsByItem.get(item.id) ?? [], input.entries, plans, input.plans,
    input.scope));

  const filter = input.filter ?? {};
  const locationPlans = (locations: readonly string[]) => new Set(input.plans
    .filter(({ location }) => location && locations.includes(location.key)).map(({ key }) => key));
  const inLocation = filter.locations?.length ? locationPlans(filter.locations) : null;
  const lines = scoped.filter((line) => (!filter.states?.length || filter.states.includes(line.state))
    && (!filter.families?.length || (line.family !== null && filter.families.includes(line.family)))
    && (!inLocation || line.readings.some(({ planKey }) => inLocation.has(planKey)))
    && (!filter.decisions?.length || filter.decisions.includes(line.decision)))
    .sort((left, right) => DECISION_FIRST[left.decision] - DECISION_FIRST[right.decision] || left.position - right.position);

  const families = new Map<string, number>();
  for (const { family } of scoped) if (family) families.set(family, (families.get(family) ?? 0) + 1);
  const locations = new Map<string, { label: string; count: number }>();
  const planCounts = new Map<string, number>();
  for (const line of scoped) {
    const seen = new Set<string>();
    for (const { planKey } of line.readings) {
      planCounts.set(planKey, (planCounts.get(planKey) ?? 0) + 1);
      const location = plans.get(planKey)?.location;
      if (location && !seen.has(location.key)) {
        seen.add(location.key);
        locations.set(location.key, { label: location.label, count: (locations.get(location.key)?.count ?? 0) + 1 });
      }
    }
  }
  return {
    scope: input.scope,
    lines,
    facets: {
      states: countBy(["to_measure", "reading", "incomplete", "failed", "measured", "uncertain", "not_found"], scoped.map(({ state }) => state)),
      decisions: countBy(["pending", "accepted", "set_aside", "entered", "none"], scoped.map(({ decision }) => decision)),
      families: [...families].map(([value, count]) => ({ value, count })),
      locations: [...locations].map(([value, { label, count }]) => ({ value, label, count })),
      plans: input.plans.map(({ key, name }) => ({ key, name, count: planCounts.get(key) ?? 0 })),
    },
  };
}

/** A page of the lines; a focused item brings the page that holds it. */
export function pageItemTable(lines: readonly ItemTableLine[], input: { offset: number; limit: number; focusItemId?: string | null }) {
  const limit = Math.max(1, input.limit);
  const focusIndex = input.focusItemId ? lines.findIndex(({ itemId }) => itemId === input.focusItemId) : -1;
  const offset = focusIndex >= 0 ? Math.floor(focusIndex / limit) * limit : Math.min(Math.max(0, input.offset),
    Math.max(0, Math.floor(Math.max(0, lines.length - 1) / limit) * limit));
  return { lines: lines.slice(offset, offset + limit), total: lines.length, offset, limit, focusFound: focusIndex >= 0 };
}

export type ItemSelectionCounts = Record<ItemReviewGesture, number>;

const eligibleGestures = (line: ItemTableLine) => ITEM_REVIEW_GESTURES.filter((gesture) => line.eligibility[gesture].eligible);

/**
 * A frozen selection: every line of the filter (beyond the page shown), or the items a member ticked, each with the
 * revisions a command will name and the gestures that apply to it. Above its bound the selection is refused, never cut.
 */
export function freezeItemSelection(view: ItemTableView, selection: { kind: "filter" } | { kind: "items"; itemIds: readonly string[] }) {
  const byId = new Map(view.lines.map((line) => [line.itemId, line]));
  const chosen = selection.kind === "filter" ? view.lines
    : [...new Set(selection.itemIds)].flatMap((id) => byId.get(id) ?? []);
  const missing = selection.kind === "items" ? [...new Set(selection.itemIds)].filter((id) => !byId.has(id)) : [];
  if (chosen.length > ITEM_REVIEW_LIMITS.items
    || chosen.reduce((total, line) => total + line.targets.answers.length, 0) > ITEM_REVIEW_LIMITS.answers) {
    throw new RangeError("Une sélection tient en 1\u202f000 postes au plus : affinez le filtre.");
  }
  const items = chosen.map((line) => ({ itemId: line.itemId, label: line.label, target: line.targets,
    eligible: eligibleGestures(line) }));
  const eligible = Object.fromEntries(ITEM_REVIEW_GESTURES.map((gesture) =>
    [gesture, items.filter((item) => item.eligible.includes(gesture)).length])) as ItemSelectionCounts;
  return { count: items.length, items, eligible, missing };
}

const answerKey = (answer: ItemReviewTarget["answers"][number]) =>
  `${answer.answerId}@${answer.answerRevision}#${answer.decisionRevision}`;

/**
 * The targets of a command that no longer describe what the table holds: an item gone from the scope, an answer read
 * again or arrived, a decision or an entry written since. A command with one stale target applies nothing.
 */
export function checkItemReviewTargets(view: ItemTableView, targets: readonly ItemReviewTarget[]) {
  const byId = new Map(view.lines.map((line) => [line.itemId, line]));
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
  | { kind: "planned"; apply: Array<{ itemId: string; label: string; answers: string[] }>;
    skipped: Array<{ itemId: string; label: string; reason: ItemIneligibility }> };

/**
 * What a review command would write, decided on the table built again: nothing on a stale selection; otherwise the
 * eligible lines with the answers the gesture writes on, and the others named with their reason.
 */
export function planItemReviewCommand(view: ItemTableView, command: { gesture: Exclude<ItemReviewGesture, "remeasure">;
  targets: readonly ItemReviewTarget[] }): ItemReviewPlan {
  const { stale } = checkItemReviewTargets(view, command.targets);
  if (stale.length) return { kind: "stale", stale };
  const byId = new Map(view.lines.map((line) => [line.itemId, line]));
  const apply: Extract<ItemReviewPlan, { kind: "planned" }>["apply"] = [];
  const skipped: Extract<ItemReviewPlan, { kind: "planned" }>["skipped"] = [];
  for (const target of command.targets) {
    const line = byId.get(target.itemId)!;
    const verdict = line.eligibility[command.gesture];
    if (!verdict.eligible) {
      skipped.push({ itemId: line.itemId, label: line.label, reason: verdict.reason! });
      continue;
    }
    const answers = line.readings.filter(({ answer, decision, entry }) => answer && (
      command.gesture === "accept_measured" ? !decision && !entry
        : command.gesture === "set_aside" ? decision?.kind !== "set_aside"
          : command.gesture === "reinstate" ? decision?.kind === "set_aside"
            : true)).map(({ answer }) => answer!.answerId);
    apply.push({ itemId: line.itemId, label: line.label, answers });
  }
  return { kind: "planned", apply, skipped };
}
