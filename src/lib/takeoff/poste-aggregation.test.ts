import { describe, expect, it } from "vitest";

import {
  aggregatePosteAnswers,
  describePosteReason,
  describePosteStatus,
  POSTE_AFFAIRE_STATUSES,
  type PostePlanWork,
} from "@/lib/takeoff/poste-aggregation";
import { POSTE_NOT_FOUND_REASONS, POSTE_UNCERTAIN_REASONS } from "@/lib/takeoff/poste-exchange";
import { POSTE_WORKER_REASONS } from "@/lib/takeoff/poste-exchange-merge";

const measured = (planKey: string, value: number, unit = "u"): PostePlanWork =>
  ({ planKey, state: "answered", outcome: "measured", quantity: { value, unit }, candidate: null });
const uncertain = (planKey: string, candidate: { value: number; unit: string } | null = null): PostePlanWork =>
  ({ planKey, state: "answered", outcome: "uncertain", quantity: null, candidate });
const notFound = (planKey: string): PostePlanWork => ({ planKey, state: "answered", outcome: "not_found", quantity: null, candidate: null });

describe("aggregatePosteAnswers", () => {
  it("adds the plans' measures once every plan is read: 3 lavabos on A and 2 on B give 5", () => {
    expect(aggregatePosteAnswers([measured("plan:a", 3), measured("plan:b", 2)])).toEqual({
      status: "measured", complete: true, partial: false,
      plans: { expected: 2, answered: 2, measured: 2, uncertain: 0, notFound: 0 },
      observed: [{ unit: "u", value: 5 }], candidates: [],
    });
  });

  it("keeps a partial total while a plan is still read, and never a false absence", () => {
    const reading = aggregatePosteAnswers([measured("plan:a", 3), { planKey: "plan:b", state: "reading" }]);
    expect(reading).toMatchObject({ status: "reading", complete: false, partial: true, observed: [{ unit: "u", value: 3 }],
      plans: { expected: 2, answered: 1 } });

    // Not found on A, B not read yet: nothing certifies the absence on the affaire.
    expect(aggregatePosteAnswers([notFound("plan:a"), { planKey: "plan:b", state: "to_measure" }]).status).toBe("to_measure");
    expect(aggregatePosteAnswers([notFound("plan:a"), { planKey: "plan:b", state: "reading" }]).status).toBe("reading");
  });

  it("names the work still without a verdict as the database does: a plan still read first", () => {
    expect(aggregatePosteAnswers([]).status).toBe("to_measure");
    expect(aggregatePosteAnswers([{ planKey: "plan:a", state: "to_measure" }, { planKey: "plan:b", state: "reading" }]).status)
      .toBe("reading");
    expect(aggregatePosteAnswers([{ planKey: "plan:a", state: "incomplete" }, { planKey: "plan:b", state: "reading" }]).status)
      .toBe("reading");
    expect(aggregatePosteAnswers([{ planKey: "plan:a", state: "failed" }, { planKey: "plan:b", state: "to_measure" }]).status)
      .toBe("to_measure");
    // Ended plans: failed while no plan answered, incomplete once one did, whatever stopped them.
    expect(aggregatePosteAnswers([{ planKey: "plan:a", state: "incomplete" }, { planKey: "plan:b", state: "failed" }]).status)
      .toBe("failed");
    expect(aggregatePosteAnswers([{ planKey: "plan:a", state: "incomplete" }, { planKey: "plan:b", state: "failed" },
      measured("plan:c", 1)])).toMatchObject({ status: "incomplete", partial: true, observed: [{ unit: "u", value: 1 }] });
  });

  it("lets one uncertain plan make the item uncertain at full coverage, its candidate never added to the measure", () => {
    expect(aggregatePosteAnswers([measured("plan:a", 3), uncertain("plan:b", { value: 2, unit: "u" }),
      uncertain("plan:c", { value: 4, unit: "u" }), notFound("plan:d")])).toMatchObject({
      status: "uncertain", complete: true, observed: [{ unit: "u", value: 3 }],
      candidates: [{ planKey: "plan:b", unit: "u", value: 2 }, { planKey: "plan:c", unit: "u", value: 4 }],
      plans: { expected: 4, answered: 4, measured: 1, uncertain: 2, notFound: 1 },
    });
  });

  it("gives not found only when every expected plan was searched without any indication", () => {
    expect(aggregatePosteAnswers([notFound("plan:a"), notFound("plan:b")])).toMatchObject({ status: "not_found", complete: true,
      observed: [], candidates: [] });
    expect(aggregatePosteAnswers([notFound("plan:a"), measured("plan:b", 4)]).status).toBe("measured");
  });

  it("keeps measures in two units apart, never added: two totals, the state the database gives", () => {
    expect(aggregatePosteAnswers([measured("plan:a", 3, "u"), measured("plan:b", 1, "ens")])).toMatchObject({
      status: "measured", observed: [{ unit: "ens", value: 1 }, { unit: "u", value: 3 }] });
  });

  it("refuses two answers for one plan instead of counting them twice", () => {
    expect(() => aggregatePosteAnswers([measured("plan:a", 3), measured("plan:a", 3)])).toThrow(/plan:a/);
  });
});

describe("the wording PR 4 shows", () => {
  it("says every status and every reason in French", () => {
    for (const status of POSTE_AFFAIRE_STATUSES) expect(describePosteStatus(status)).toMatch(/^[A-ZÀ-Ý]/u);
    for (const code of [...POSTE_UNCERTAIN_REASONS, ...POSTE_NOT_FOUND_REASONS, ...POSTE_WORKER_REASONS]) {
      expect(describePosteReason(code)).toMatch(/\.$/);
    }
    expect(describePosteStatus("uncertain")).toBe("Incertain");
    expect(describePosteReason("PAGES_UNREADABLE")).toMatch(/illisible/);
  });
});
