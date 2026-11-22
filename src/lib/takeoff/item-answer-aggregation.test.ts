import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { aggregateItemReadings, ITEM_AGGREGATE_STATES, type ItemPlanReading } from "./item-answer-aggregation";
import { TAKEOFF_ITEM_READING_STATES } from "./item-answers";
import { aggregatePosteAnswers, type PostePlanWork } from "./poste-aggregation";

// One state rule, in SQL (private.takeoff_item_state, which the database's readers give the table), in the reading's
// rule (aggregatePosteAnswers) and in the table's reading of it. The vectors are the pgTAP suite's, read in its file:
// every side runs the same cases, and SQL's state is the one expected.
const PGTAP = path.join(process.cwd(), "supabase/tests/database/takeoff-item-review.test.sql");
const VECTOR_ROW = /^\s*\((\d+), '((?:[^']|'')*)', (\d+), (\d+), (\d+), (\d+), (\d+), '([a-z_]+)'\)[,;]$/;

function stateVectors() {
  const sql = fs.readFileSync(PGTAP, "utf8");
  const start = sql.indexOf("insert into item_state_vectors values");
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf(";\n", start) + 1).split("\n").slice(1).map((line) => {
    const match = VECTOR_ROW.exec(line);
    expect(match, line).not.toBeNull();
    const [, position, label, expected, answered, inFlight, uncertain, measured, state] = match!;
    return { position: Number(position), label: label.replace(/''/g, "'"), expected: Number(expected), answered: Number(answered),
      inFlight: Number(inFlight), uncertain: Number(uncertain), measured: Number(measured), state };
  });
}
type Vector = ReturnType<typeof stateVectors>[number];

const outcomeOf = (vector: Vector, index: number) =>
  index < vector.uncertain ? "uncertain" as const : index < vector.uncertain + vector.measured ? "measured" as const : "not_found" as const;

/** The readings a vector counts: its uncertain and measured answers, the others not found, those in flight, those ended. */
function readingsOf(vector: Vector): ItemPlanReading[] {
  const answered = Array.from({ length: vector.answered }, (_, index): ItemPlanReading => {
    const outcome = outcomeOf(vector, index);
    return { reading: "answered", outcome, quantity: outcome === "not_found" ? null : 1, unit: outcome === "not_found" ? null : "u" };
  });
  const inFlight = Array.from({ length: vector.inFlight }, (): ItemPlanReading => ({ reading: "in_flight" }));
  const ended = Array.from({ length: vector.expected - vector.answered - vector.inFlight }, (): ItemPlanReading => ({ reading: "ended" }));
  return [...ended, ...inFlight, ...answered];
}

/** The same plans as the reading's rule knows them; a plan ended without an answer, as « failed » or « incomplete ». */
function plansOf(vector: Vector, ended: "failed" | "incomplete"): PostePlanWork[] {
  return readingsOf(vector).map((reading, index): PostePlanWork => {
    const planKey = `plan:${index}`;
    if (reading.reading === "in_flight") return { planKey, state: "reading" };
    if (reading.reading === "ended") return { planKey, state: ended };
    const value = reading.quantity === null ? null : { value: reading.quantity, unit: reading.unit! };
    return { planKey, state: "answered", outcome: reading.outcome, quantity: reading.outcome === "measured" ? value : null,
      candidate: reading.outcome === "uncertain" ? value : null };
  });
}

describe("the state rule, against SQL's", () => {
  const vectors = stateVectors();

  it("names the same states as the stored readings (B1) and the reading's rule", () => {
    expect([...ITEM_AGGREGATE_STATES].sort()).toEqual([...TAKEOFF_ITEM_READING_STATES].sort());
  });

  it("reads every vector of the pgTAP suite, in order", () => {
    expect(vectors.map(({ position }) => position)).toEqual(vectors.map((_, index) => index + 1));
    expect(vectors.length).toBeGreaterThanOrEqual(10);
  });

  it.each(vectors)("vector $position: $label", (vector) => {
    expect(aggregateItemReadings(readingsOf(vector)).state).toBe(vector.state);
    expect(aggregatePosteAnswers(plansOf(vector, "failed")).status).toBe(vector.state);
    expect(aggregatePosteAnswers(plansOf(vector, "incomplete")).status).toBe(vector.state);
  });
});

const measured = (quantity: number, unit = "u"): ItemPlanReading =>
  ({ reading: "answered", outcome: "measured", quantity, unit });
const notFound: ItemPlanReading = { reading: "answered", outcome: "not_found", quantity: null, unit: null };
const uncertain: ItemPlanReading = { reading: "answered", outcome: "uncertain", quantity: null, unit: null };

describe("aggregateItemReadings", () => {
  it("leaves an item that no plan was asked about « to measure », never « not found »", () => {
    expect(aggregateItemReadings([])).toMatchObject({ state: "to_measure", observed: null,
      coverage: { expected: 0, answered: 0, inFlight: 0, ended: 0 } });
  });

  it("keeps the observed total partial while a plan is still read, and certifies no absence", () => {
    const aggregate = aggregateItemReadings([measured(3), { reading: "in_flight" }]);
    expect(aggregate.state).toBe("reading");
    expect(aggregate.observed).toEqual({ quantity: 3, unit: "u", partial: true });
    expect(aggregate.coverage).toEqual({ expected: 2, answered: 1, inFlight: 1, ended: 0 });

    // A plan read and found nothing while the other is still queued: no « not found » on the affaire.
    expect(aggregateItemReadings([notFound, { reading: "in_flight" }]).state).toBe("reading");
  });

  it("says « incomplete » when a plan ended without an answer, « failed » when no plan answered", () => {
    expect(aggregateItemReadings([notFound, { reading: "ended" }]).state).toBe("incomplete");
    expect(aggregateItemReadings([measured(2), { reading: "ended" }])).toMatchObject({ state: "incomplete",
      observed: { quantity: 2, unit: "u", partial: true } });
    expect(aggregateItemReadings([{ reading: "ended" }, { reading: "ended" }]).state).toBe("failed");
  });

  it("at full coverage: an uncertain answer wins, then a measured one, then « not found »", () => {
    expect(aggregateItemReadings([measured(3), uncertain]).state).toBe("uncertain");
    expect(aggregateItemReadings([measured(3), notFound])).toMatchObject({ state: "measured",
      observed: { quantity: 3, unit: "u", partial: false } });
    expect(aggregateItemReadings([notFound, notFound])).toMatchObject({ state: "not_found", observed: null });
  });

  it("adds the measured contributions of two plans: 3 on A and 2 on B give 5", () => {
    expect(aggregateItemReadings([measured(3), measured(2)]).observed).toEqual({ quantity: 5, unit: "u", partial: false });
    // Decimal lengths do not drift: 0.1 + 0.2 is 0.3.
    expect(aggregateItemReadings([measured(0.1, "ml"), measured(0.2, "ml")]).observed?.quantity).toBe(0.3);
  });

  it("never adds two units: a conflict gives no total", () => {
    const aggregate = aggregateItemReadings([measured(3, "ml"), measured(2, "u")]);
    expect(aggregate.observed).toBeNull();
    expect(aggregate.unitConflict).toBe(true);
    // The same unit written differently is one unit.
    expect(aggregateItemReadings([measured(3, "m²"), measured(1, "M2")]).observed).toEqual({ quantity: 4, unit: "m²",
      partial: false });
  });

  it("never counts an uncertain answer's candidate as measured", () => {
    const aggregate = aggregateItemReadings([measured(3), { reading: "answered", outcome: "uncertain", quantity: 4, unit: "u" }]);
    expect(aggregate.state).toBe("uncertain");
    expect(aggregate.observed).toEqual({ quantity: 3, unit: "u", partial: false });
  });
});
