import { describe, expect, it } from "vitest";

import { evaluateTakeoffRules, type RuleLine, type RulePage } from "@/lib/takeoff/rules/evaluate";
import { ruleInputsFromVector } from "@/lib/takeoff/rules/inputs";

const page: RulePage = { key: "p", job_id: "j", order: 1, level: "RDC", zone: "Z1", anchors: null,
  scale: { status: "verified", reason: null } };
function area(room: string, measured: number, printed: number, priced = measured) {
  const line: RuleLine = { id: "i", job_id: "j", page_key: "p", designation: "Revêtement de sol", unit: "m2",
    quantity: priced, is_excluded: false, frozen: false,
    inputs: ruleInputsFromVector({ kind: "surface", network: null, material: null, dn: null, quantity: measured,
      room, printed_m2: printed }),
    geometry: { segments_m: [], polygon_m: [0, 0, 4, 0, 4, 5, 0, 5], length_m: null, area_m2: measured } };
  return evaluateTakeoffRules({ pages: [page], lines: [line] }).results.get("i")?.find(entry => entry.rule === "area_printed");
}
describe("TI-680 surface bases", () => {
  it("cannot erase an unknown printed basis by copying its quantity", () => {
    expect(area("Bureau", 19.5, 20, 20)).toMatchObject({ status: "fail", details: { cause: "basis_unknown" } });
    expect(area("Bureau", 20, 20, 20)).toMatchObject({ status: "fail" });
  });
  it("does not compare SHAB to the measured net floor", () => {
    expect(area("Bureau SHAB", 20, 20)).toMatchObject({ status: "fail", details: { cause: "basis_mismatch" } });
  });
  it("keeps the original measurement when the price quantity changes", () => {
    expect(area("Bureau sol net", 19.5, 20, 20)).toMatchObject({ status: "fail", details: { measured_m2: 19.5 } });
    expect(area("Bureau sol net", 19.85, 20, 20)).toMatchObject({ status: "pass", details: { measured_m2: 19.85 } });
  });
});
