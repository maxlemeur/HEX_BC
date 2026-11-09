import { describe, expect, it } from "vitest";
import { createEmptyTakeoffPreparation } from "@/lib/takeoff/preparation";
import { takeoffScopeCoverage } from "@/lib/takeoff/scope-coverage";

describe("TI-681 expected scope coverage", () => {
  it("does not hide an entirely missing floor behind proof coverage of the extracted rows", () => {
    const preparation = createEmptyTakeoffPreparation();
    preparation.scope.levels = ["RDC", "R+1"];
    const result = takeoffScopeCoverage(preparation, [{ id: "r0", designation: "EF cuivre DN 22", source_file_name: "Plan RDC.pdf",
      source_page: 1, evidence: "Tracé repéré", confidence: 0.95, is_excluded: false, metadata: {}, rule_results: [] }]);
    expect(result.known).toBe(true);
    expect(result.entries.find(entry => entry.label === "R+1")).toMatchObject({ status: "not_analysed", item_ids: [] });
    expect(result.entries.find(entry => entry.label === "RDC")?.item_ids).toEqual(["r0"]);
  });
  it("keeps absent scope and weak evidence visibly incomplete", () => {
    expect(takeoffScopeCoverage(null, []).known).toBe(false);
    const preparation = createEmptyTakeoffPreparation();
    preparation.scope.zones = ["Z1"];
    expect(takeoffScopeCoverage(preparation, [{ id: "z1", designation: "EF", source_file_name: "Z1.pdf", source_page: 1,
      evidence: "Lecture incertaine", confidence: 0.2, is_excluded: false, metadata: {}, rule_results: [] }]).entries[0].status)
      .toBe("incomplete");
  });
  it("does not assign every floor in a multi-floor file name to a single extracted item", () => {
    const preparation = createEmptyTakeoffPreparation();
    preparation.scope.levels = ["RDC", "R+1", "R+2"];
    const result = takeoffScopeCoverage(preparation, [{ id: "one", designation: "EF cuivre DN 22", source_file_name: "Plans RDC R+1 R+2.pdf",
      source_page: 1, evidence: "Une ligne", confidence: 0.95, is_excluded: false, metadata: {}, rule_results: [] }]);
    expect(result.entries.every(entry => entry.status !== "analysed")).toBe(true);
  });
});
