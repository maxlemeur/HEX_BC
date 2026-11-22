import { toUnitToken } from "./units";

/**
 * How the answers of one item on each plan make the item's state on the affaire (lot 4, section 3.2 of its
 * specification): a pure rule, read by the table of items. The reading of a plan against the list of items delivers its
 * own copy of this rule; this module is the table's until then, with the same contract, and is replaced by it.
 *
 * - While a plan the item was asked about is not read, the observed total stays partial and no absence is certified on
 *   the affaire.
 * - At full coverage, one uncertain answer makes the item uncertain; otherwise one measured contribution makes it
 *   measured; every plan searched without a clue makes it not found.
 * - The candidate value of an uncertain answer is never a measured quantity, and two units are never added together.
 */

export const ITEM_ANSWER_OUTCOMES = ["measured", "uncertain", "not_found"] as const;
export type ItemAnswerOutcome = (typeof ITEM_ANSWER_OUTCOMES)[number];

/**
 * One plan's reading of one item: where the plan's unit of work stands while it has no answer for the item, or the
 * answer it published. `quantity` is the sum of the answer's positive observations (null for « not found », and for an
 * uncertain answer the candidate value, which is never added).
 */
export type ItemPlanReading =
  | { reading: "queued" | "running" }
  | { reading: "failed" | "canceled" | "not_started" }
  | { reading: "answered"; outcome: ItemAnswerOutcome; quantity: number | null; unit: string | null };

/**
 * The item on the affaire. to_measure: no plan was asked about it yet; reading: a plan is still queued or read;
 * incomplete: a plan ended without an answer while others answered; failed: no plan answered and none is still read;
 * measured, uncertain, not_found: the verdict of a full coverage.
 */
export const ITEM_AGGREGATE_STATES = ["to_measure", "reading", "incomplete", "failed", "measured", "uncertain", "not_found"] as const;
export type ItemAggregateState = (typeof ITEM_AGGREGATE_STATES)[number];

export type ItemAggregate = {
  state: ItemAggregateState;
  coverage: { expected: number; answered: number; inFlight: number; ended: number };
  /** The measured contributions added, in their one unit; partial while the coverage is missing. */
  observed: { quantity: number; unit: string; partial: boolean } | null;
  /** Measured contributions in two units: no total is given. */
  unitConflict: boolean;
};

/** Decimal quantities added without drift (lengths in metres to the micrometre). */
const SCALE = 1e6;

export function aggregateItemReadings(readings: readonly ItemPlanReading[]): ItemAggregate {
  const coverage = { expected: readings.length, answered: 0, inFlight: 0, ended: 0 };
  let uncertain = false;
  let measured = false;
  let unit: string | null = null;
  let unitToken: string | null = null;
  let unitConflict = false;
  let scaled = 0;
  for (const reading of readings) {
    if (reading.reading === "queued" || reading.reading === "running") {
      coverage.inFlight += 1;
      continue;
    }
    if (reading.reading !== "answered") {
      coverage.ended += 1;
      continue;
    }
    coverage.answered += 1;
    if (reading.outcome === "uncertain") uncertain = true;
    if (reading.outcome !== "measured" || reading.quantity === null || !reading.unit) continue;
    measured = true;
    const token = toUnitToken(reading.unit);
    if (unitToken === null) {
      unitToken = token;
      unit = reading.unit;
    } else if (unitToken !== token) {
      unitConflict = true;
    }
    scaled += Math.round(reading.quantity * SCALE);
  }

  const complete = coverage.expected > 0 && coverage.answered === coverage.expected;
  const state: ItemAggregateState = coverage.expected === 0 ? "to_measure"
    : complete ? (uncertain ? "uncertain" : measured ? "measured" : "not_found")
      : coverage.inFlight > 0 ? "reading"
        : coverage.answered === 0 ? "failed" : "incomplete";
  const observed = measured && !unitConflict && unit !== null
    ? { quantity: scaled / SCALE, unit, partial: !complete } : null;
  return { state, coverage, observed, unitConflict };
}
