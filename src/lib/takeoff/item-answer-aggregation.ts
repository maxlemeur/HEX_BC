import { TAKEOFF_ITEM_ANSWER_OUTCOMES } from "./item-answers";
import { aggregatePosteAnswers, POSTE_AFFAIRE_STATUSES, type PosteAffaireStatus, type PostePlanWork } from "./poste-aggregation";
import { toUnitToken } from "./units";

/**
 * How the answers of one item on each plan make the item's state on the affaire (lot 4, section 3.2 of its
 * specification), as the table of items reads it. The database decides the state the table shows (B1's states function
 * through private.takeoff_item_state); the reading's rule, aggregatePosteAnswers, gives the same state on the same plans
 * (item-answer-aggregation.test.ts runs both on the database tests' cases). This module reads the table's plans through
 * that rule and gives the table its observed total in one unit.
 *
 * - While a plan the item was asked about is not read, the observed total stays partial and no absence is certified on
 *   the affaire.
 * - At full coverage, one uncertain answer makes the item uncertain; otherwise one measured contribution makes it
 *   measured; every plan searched without a clue makes it not found.
 * - The candidate value of an uncertain answer is never a measured quantity, and two units are never added together.
 */

/** The outcomes of a stored answer (B1's). */
export const ITEM_ANSWER_OUTCOMES = TAKEOFF_ITEM_ANSWER_OUTCOMES;
export type ItemAnswerOutcome = (typeof ITEM_ANSWER_OUTCOMES)[number];

/**
 * One plan's reading of one item, as the database counts it: its unit of work still queued or read (in_flight), ended
 * without an answer for the item (ended), or the answer it published. `quantity` is the answer's measured quantity (null
 * for « not found »; for an uncertain answer, its candidate value, which is never added).
 */
export type ItemPlanReading =
  | { reading: "in_flight" }
  | { reading: "ended" }
  | { reading: "answered"; outcome: ItemAnswerOutcome; quantity: number | null; unit: string | null };

/**
 * The item on the affaire. to_measure: no plan was asked about it yet; reading: a plan is still queued or read;
 * incomplete: a plan ended without an answer while others answered; failed: no plan answered and none is still read;
 * measured, uncertain, not_found: the verdict of a full coverage.
 */
export const ITEM_AGGREGATE_STATES = POSTE_AFFAIRE_STATUSES;
export type ItemAggregateState = PosteAffaireStatus;

export type ItemAggregate = {
  state: ItemAggregateState;
  coverage: { expected: number; answered: number; inFlight: number; ended: number };
  /** The measured contributions added, in their one unit; partial while the coverage is missing. */
  observed: { quantity: number; unit: string; partial: boolean } | null;
  /** Measured contributions in two units: no total is given. */
  unitConflict: boolean;
};

export function aggregateItemReadings(readings: readonly ItemPlanReading[]): ItemAggregate {
  const coverage = { expected: readings.length, answered: 0, inFlight: 0, ended: 0 };
  // The unit as first written, for each unit token the rule adds under (« m² » and « M2 » are one unit).
  const units = new Map<string, string>();
  const plans = readings.map((reading, index): PostePlanWork => {
    const planKey = String(index);
    if (reading.reading === "in_flight") {
      coverage.inFlight += 1;
      return { planKey, state: "reading" };
    }
    if (reading.reading === "ended") {
      coverage.ended += 1;
      return { planKey, state: "incomplete" };
    }
    coverage.answered += 1;
    const value = reading.quantity !== null && reading.unit ? { value: reading.quantity, unit: toUnitToken(reading.unit) } : null;
    if (value && !units.has(value.unit)) units.set(value.unit, reading.unit!);
    return { planKey, state: "answered", outcome: reading.outcome, quantity: reading.outcome === "measured" ? value : null,
      candidate: reading.outcome === "uncertain" ? value : null };
  });

  const aggregate = aggregatePosteAnswers(plans);
  const [total, ...others] = aggregate.observed;
  const unitConflict = others.length > 0;
  const observed = total && !unitConflict
    ? { quantity: total.value, unit: units.get(total.unit) ?? total.unit, partial: aggregate.partial } : null;
  return { state: aggregate.status, coverage, observed, unitConflict };
}
