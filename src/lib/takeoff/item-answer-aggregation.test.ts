import { describe, expect, it } from "vitest";

import { aggregateItemReadings, type ItemPlanReading } from "./item-answer-aggregation";

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
    const aggregate = aggregateItemReadings([measured(3), { reading: "running" }]);
    expect(aggregate.state).toBe("reading");
    expect(aggregate.observed).toEqual({ quantity: 3, unit: "u", partial: true });
    expect(aggregate.coverage).toEqual({ expected: 2, answered: 1, inFlight: 1, ended: 0 });

    // A plan read and found nothing while the other is still queued: no « not found » on the affaire.
    expect(aggregateItemReadings([notFound, { reading: "queued" }]).state).toBe("reading");
  });

  it("says « incomplete » when a plan ended without an answer, « failed » when no plan answered", () => {
    expect(aggregateItemReadings([notFound, { reading: "failed" }]).state).toBe("incomplete");
    expect(aggregateItemReadings([measured(2), { reading: "canceled" }])).toMatchObject({ state: "incomplete",
      observed: { quantity: 2, unit: "u", partial: true } });
    expect(aggregateItemReadings([{ reading: "failed" }, { reading: "not_started" }]).state).toBe("failed");
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
