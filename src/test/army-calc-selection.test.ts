import { describe, expect, it } from "vitest";
import { CALC_V3_PHASES } from "../../scripts/tester-army/calc-v3-phases";
import { planCalcV3, selectCalcV3 } from "../../scripts/tester-army/select-calc-v3";

const root = process.cwd();
describe("calc-v3 impact selection", () => {
  it("claims no execution for docs and runs all on unknown, shared or unavailable inputs", () => {
    expect(selectCalcV3(root, ["docs/testing/new-notes.md"]).phases).toEqual([]);
    for (const paths of [[], ["src/new-unknown-runtime.ts"], ["src/lib/estimate-calculations.ts"], ["supabase/migrations/new.sql"]]) {
      expect(selectCalcV3(root, paths).phases).toEqual(CALC_V3_PHASES);
    }
  });
  it("selects the directly changed journey, including formerly manual and mobile ones", () => {
    expect(selectCalcV3(root, ["e2e/army/local/mobile-journeys.e2e.ts"]).phases).toEqual(["mobile"]);
    expect(selectCalcV3(root, ["e2e/army/local/estimate-generated-atomic.e2e.ts"]).phases).toContain("generated-atomic");
    expect(selectCalcV3(root, ["e2e/army/local/source-coverage-support.ts"]).phases).toEqual(expect.arrayContaining(["source-coverage-decisions", "source-coverage-edits", "source-coverage-recovery"]));
  });
  it("keeps scheduled, explicit and unprovable PR plans fail closed", () => {
    expect(planCalcV3(root, { NODE_ENV: "test", EVENT_NAME: "schedule" }).phases).toEqual(CALC_V3_PHASES);
    expect(planCalcV3(root, { NODE_ENV: "test", EVENT_NAME: "pull_request", PR_HEAD_SHA: "not-a-commit" }).phases).toEqual(CALC_V3_PHASES);
    for (const phase of CALC_V3_PHASES) expect(planCalcV3(root, { NODE_ENV: "test", CALC_V3_SELECTION: phase }).phases).toEqual([phase]);
    for (const invalid of ["absent", 'journeys","other', "journeys components", "$(id)"]) {
      expect(() => planCalcV3(root, { NODE_ENV: "test", CALC_V3_SELECTION: invalid })).toThrow("Unknown calc-v3 selection");
    }
  });
});
