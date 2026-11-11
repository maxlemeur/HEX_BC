import { describe, expect, it } from "vitest";

import { measuredKey, measuredLengthsByScope } from "@/lib/takeoff/bench/measured";
import { MeasuredTruthFileSchema, type MeasuredTruthFile } from "@/lib/takeoff/bench/schemas";

// Lengths measured by hand along the drawn line (TI-662, decision of 11 Nov). Every figure below is invented.
// Ways a hand measurement could judge a reading wrongly:
// - a truth of several plans (a level, a lot) judged on the measurement of its plans: a key drawn on one plan only,
//   or carrying the zone of one plan, has no length on the others, so it would be dropped or judged on a part of
//   its length; such a scope is named and left to its devis, whether one plan or all of them were measured;
// - a line without length (the measurer could not follow it on the plan) read as a length;
// - a length of 0, or a negative one, read as a measurement (a pipe that is not measured is said so, never 0);
// - a misspelt field or an unknown network kept silently, the key then never judged;
// - two lines of one file for one key, the second replacing or doubling the first.

const EF = { zone: "Z1", level: "R+1", network: "EF", material: "cuivre", dn: "DN 22" } as const;
const EU = { zone: "Z1", level: "R+1", network: "EUV", material: "pvc", dn: "DN 40" } as const;

function file(document: string, lines: Array<Record<string, unknown>>): MeasuredTruthFile {
  return MeasuredTruthFileSchema.parse({
    schema_version: 1, document, method: "Along the axis of the drawn pipe, plan view, no drop, no allowance.",
    measured_by: "Fictional estimator", measured_on: "2026-11-12", lines,
  });
}

describe("hand-measured lengths of the takeoff bench", () => {
  it("gives a scope of one plan the lengths its measurement gives, by key", () => {
    const measured = measuredLengthsByScope([file("a-plan-01", [{ ...EF, length_m: 11.2 }, { ...EU, length_m: 20.6 }, { ...EU, dn: "DN 50", length_m: null }])],
      [{ id: "truth/a-plan-01.json", documents: ["a-plan-01"] }, { id: "truth/b-plan-01.json", documents: ["b-plan-01"] }]);
    expect([...measured.by_scope.keys()]).toEqual(["truth/a-plan-01.json"]);
    // The line without length is no measurement: its key is left to the devis.
    expect(Object.fromEntries(measured.by_scope.get("truth/a-plan-01.json")!)).toEqual({ [measuredKey(EF)]: 11.2, [measuredKey(EU)]: 20.6 });
    expect(measured.several_plans).toEqual([]);
    // The key is the truth key of a length: zone, level, network, material and diameter.
    expect(measuredKey(EF)).not.toBe(measuredKey({ ...EF, zone: "Z2" }));
    expect(measuredKey(EF)).not.toBe(measuredKey({ ...EF, dn: "DN 28" }));
  });

  it("does not judge a scope of several plans, measured whole or in part, and names it", () => {
    const scopes = [{ id: "truth/a-level-01.json", documents: ["a-plan-01", "a-plan-02"] }, { id: "truth/b-level-01.json", documents: ["b-plan-01", "b-plan-02"] },
      { id: "truth/c-level-01.json", documents: ["c-plan-01", "c-plan-02"] }];
    const measured = measuredLengthsByScope([
      file("b-plan-02", [{ ...EF, length_m: 3.3 }]),
      file("a-plan-01", [{ ...EF, length_m: 11.2 }]), file("a-plan-02", [{ ...EF, length_m: 3.3 }]),
    ], scopes);
    expect(measured.by_scope.size).toBe(0);
    expect(measured.several_plans).toEqual(["truth/a-level-01.json", "truth/b-level-01.json"]);
  });

  it("refuses a length of 0 or below, an unknown key, a misspelt field and a key listed twice", () => {
    const parse = (lines: unknown[], extra: Record<string, unknown> = {}) => MeasuredTruthFileSchema.safeParse({
      schema_version: 1, document: "a-plan-01", method: "Fictional method", measured_by: "Fictional estimator", measured_on: "2026-11-12", lines, ...extra,
    });
    expect(parse([{ ...EF, length_m: 11.2 }]).success).toBe(true);
    expect(parse([{ ...EF, length_m: null }]).success).toBe(true);
    expect(parse([{ ...EF, length_m: 0 }]).success).toBe(false);
    expect(parse([{ ...EF, length_m: -2 }]).success).toBe(false);
    expect(parse([{ ...EF, network: "ef", length_m: 2 }]).success).toBe(false);
    expect(parse([{ ...EF, dn: "DN 23", length_m: 2 }]).success).toBe(false);
    expect(parse([{ ...EF, length: 2 }]).success).toBe(false);
    expect(parse([{ ...EF, length_m: 2 }], { measured_on: "12/11/2026" }).success).toBe(false);
    expect(parse([]).success).toBe(false);
    const twice = parse([{ ...EF, length_m: 2 }, { ...EF, length_m: 3 }]);
    expect(twice.success).toBe(false);
    expect(twice.error?.issues[0]).toMatchObject({ path: ["lines", 1], message: expect.stringMatching(/same key as lines\[0\]/) });
  });
});
