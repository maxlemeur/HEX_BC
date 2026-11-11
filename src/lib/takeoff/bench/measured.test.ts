import { describe, expect, it } from "vitest";

import { measuredKey, measuredLengthsByScope } from "@/lib/takeoff/bench/measured";
import { MeasuredTruthFileSchema, type MeasuredTruthFile } from "@/lib/takeoff/bench/schemas";

// Lengths measured by hand along the drawn line (TI-662, decision of 11 Nov). Every figure below is invented.
// Ways a hand measurement could judge a reading wrongly:
// - a scope of two plans measured on one of them only: its keys would be compared with half their length;
// - a key one plan of the scope does not list, or lists as not drawn in plan view, judged on the other plans' sum;
// - a length of 0, or a negative one, read as a measurement (a pipe that is not drawn is said so, never 0);
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
  it("gives a scope the lengths of its plan, by key", () => {
    const measured = measuredLengthsByScope([file("a-plan-01", [{ ...EF, length_m: 11.2 }, { ...EU, length_m: 20.6 }])],
      [{ id: "truth/a-plan-01.json", documents: ["a-plan-01"] }, { id: "truth/b-plan-01.json", documents: ["b-plan-01"] }]);
    expect([...measured.by_scope.keys()]).toEqual(["truth/a-plan-01.json"]);
    expect(Object.fromEntries(measured.by_scope.get("truth/a-plan-01.json")!)).toEqual({ [measuredKey(EF)]: 11.2, [measuredKey(EU)]: 20.6 });
    // A plan nobody measured is not partial: it is simply judged on its devis.
    expect(measured.partial).toEqual([]);
    // The key is the truth key of a length: zone, level, network, material and diameter.
    expect(measuredKey(EF)).not.toBe(measuredKey({ ...EF, zone: "Z2" }));
    expect(measuredKey(EF)).not.toBe(measuredKey({ ...EF, dn: "DN 28" }));
  });

  it("adds the plans of a scope, and judges a key only when every plan gives it a length", () => {
    const scope = { id: "truth/a-level-01.json", documents: ["a-plan-01", "a-plan-02"] };
    const measured = measuredLengthsByScope([
      file("a-plan-01", [{ ...EF, length_m: 11.2 }, { ...EU, length_m: 20.6 }, { ...EU, dn: "DN 50", length_m: 4 }]),
      // The second plan does not list DN 40, and says DN 50 is not drawn in plan view.
      file("a-plan-02", [{ ...EF, length_m: 3.3 }, { ...EU, dn: "DN 50", length_m: null, notes: "non dessiné" }]),
    ], [scope]);
    expect(Object.fromEntries(measured.by_scope.get(scope.id)!)).toEqual({ [measuredKey(EF)]: 14.5 });
    expect(measured.partial).toEqual([]);
  });

  it("does not judge a scope measured on some of its plans only, and names it", () => {
    const measured = measuredLengthsByScope([file("a-plan-01", [{ ...EF, length_m: 11.2 }])],
      [{ id: "truth/a-level-01.json", documents: ["a-plan-01", "a-plan-02"] }]);
    expect(measured.by_scope.size).toBe(0);
    expect(measured.partial).toEqual(["truth/a-level-01.json"]);
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
