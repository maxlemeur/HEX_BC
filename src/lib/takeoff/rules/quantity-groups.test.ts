import { describe, expect, it } from "vitest";
import { evaluateTakeoffRules, type RuleLine, type RulePage } from "@/lib/takeoff/rules/evaluate";
import { ruleInputsFromVector } from "@/lib/takeoff/rules/inputs";
import { ruleFailureKeys } from "@/lib/takeoff/rules/failure-keys";

const page: RulePage = { key: "p", job_id: "j", order: 1, level: "RDC", zone: "Z1", anchors: null,
  scale: { status: "verified", reason: null } };
function room(id: string, measured: number, printed: number): RuleLine & { quantity_line_key: string } {
  return { id, job_id: "j", page_key: "p", designation: "Revêtement de sol", unit: "m2", quantity: Math.max(measured, printed),
    quantity_line_key: "same-price-line", is_excluded: false, frozen: false,
    inputs: ruleInputsFromVector({ kind: "surface", network: null, material: null, dn: null, quantity: measured,
      room: "Local sol net", printed_m2: printed }),
    geometry: { segments_m: [], polygon_m: null, length_m: null, area_m2: measured } };
}
function results(lines: RuleLine[]) { return evaluateTakeoffRules({ pages: [page], lines }).results; }

describe("TI-680 quantity control per price line", () => {
  it("does not ask for a local 3cm equivalent gap when it is negligible on that same line", () => {
    const evaluated = results([room("small", 0.17, 0.2), room("rest", 2999.8, 2999.8)]);
    expect(evaluated.get("small")?.find(entry => entry.rule === "area_printed")).toMatchObject({ status: "pass" });
    const otherLine = { ...room("rest", 2999.8, 2999.8), quantity_line_key: "another-price-line" };
    expect(results([room("small", 0.17, 0.2), otherLine]).get("small")?.find(entry => entry.rule === "area_printed"))
      .toMatchObject({ status: "fail" });
  });
  it("never cancels opposite errors and changes the acceptance identity when a partner quantity changes", () => {
    const first = results([room("a", 51, 50), room("b", 49, 50)]);
    const changed = results([room("a", 51, 50), room("b", 45, 50)]);
    expect(first.get("a")?.find(entry => entry.rule === "area_printed")).toMatchObject({ status: "fail" });
    expect(ruleFailureKeys(first.get("a"))).not.toEqual(ruleFailureKeys(changed.get("a")));
  });
});
