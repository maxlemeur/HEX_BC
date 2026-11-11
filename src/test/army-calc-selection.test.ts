import { describe, expect, it } from "vitest";
import { CALC_V3_PHASES, parseCalcV3Phases } from "../../scripts/tester-army/calc-v3-phases";
import {
  groupMatrix, loadCalcV3GroupDurations, planCalcV3, planCalcV3Groups, planOutputs, selectCalcV3, validateCalcV3GroupDurations,
  type CalcV3GroupDurations,
} from "../../scripts/tester-army/select-calc-v3";

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

// The selected phases run in a few group jobs, each group on one owned stack
// (docs/testing/tester-army-ci.md, "Jobs parallèles"). What the partition could
// get wrong without any journey noticing: a selected phase in no group or in two
// (coverage lost, or a phase run twice), an empty group (a job that starts a
// stack for nothing), more jobs than the limit, a different partition from one
// run to the next, or a matrix value the runner's --phase refuses.
describe("calc-v3 groups", () => {
  const measured = loadCalcV3GroupDurations(root);
  const synthetic: CalcV3GroupDurations = { maxGroups: 3, defaultSeconds: 50,
    seconds: { journeys: 100, components: 90, numeric: 80, resume: 30, access: 20, emission: 10 } };
  const partitioned = (phases: readonly string[], groups: { phases: readonly string[] }[]) =>
    expect(groups.flatMap((group) => group.phases).sort()).toEqual([...phases].sort());

  it("times only calc-v3 phases, with usable values, in the repository's durations", () => {
    expect(measured).not.toBeNull();
    expect(validateCalcV3GroupDurations(measured)).toEqual([]);
    // Every current phase carries its own measure: the default only serves a phase added since.
    expect(Object.keys(measured!.seconds).sort()).toEqual([...CALC_V3_PHASES].sort());
    const invalid: Array<[unknown, string]> = [
      [undefined, "calcV3"],
      [{ ...synthetic, maxGroups: 0 }, "maxGroups"],
      [{ ...synthetic, maxGroups: 2.5 }, "maxGroups"],
      [{ ...synthetic, defaultSeconds: 0 }, "defaultSeconds"],
      [{ ...synthetic, seconds: { journeys: -1 } }, "journeys"],
      [{ ...synthetic, seconds: { "not-a-phase": 10 } }, "not-a-phase"],
      [{ ...synthetic, seconds: [] }, "seconds"],
    ];
    for (const [durations, named] of invalid) expect(validateCalcV3GroupDurations(durations).join(" "), named).toContain(named);
  });

  it("runs the whole campaign in five balanced groups, every phase in exactly one", () => {
    const { groups, grouping } = planCalcV3Groups(CALC_V3_PHASES, measured);
    expect(groups).toHaveLength(5);
    expect(grouping).toContain("5 groups");
    partitioned(CALC_V3_PHASES, groups);
    groups.forEach((group, index) => {
      expect(group).toMatchObject({ group: index + 1, total: 5 });
      expect(group.phases.length).toBeGreaterThan(0);
      expect(group.seconds).toBe(group.phases.reduce((sum, phase) => sum + measured!.seconds[phase], 0));
      // Within a group, the order of the campaign's phase table.
      expect(group.phases).toEqual(CALC_V3_PHASES.filter((phase) => (group.phases as string[]).includes(phase)));
    });
    // Balanced: no group is more than a tenth above the mean, so no job sets the campaign's duration alone.
    const loads = groups.map((group) => group.seconds);
    const mean = loads.reduce((sum, load) => sum + load, 0) / loads.length;
    expect(Math.max(...loads)).toBeLessThanOrEqual(mean * 1.1);
    // The same input gives the same partition.
    expect(planCalcV3Groups([...CALC_V3_PHASES], measured)).toEqual({ groups, grouping });
  });

  it("puts the longest phases first onto the least loaded group, ties in the order of the selection", () => {
    const phases = ["journeys", "components", "numeric", "resume", "access", "emission", "mobile"] as const;
    const { groups } = planCalcV3Groups(phases, synthetic);
    // 100, 90 and 80 open the three groups; mobile (default 50) joins 80, resume 30 joins 90, access 20 joins 100,
    // then emission 10 joins the first of the two groups at 120.
    expect(groups).toEqual([
      { group: 1, total: 3, phases: ["journeys", "access", "emission"], seconds: 130 },
      { group: 2, total: 3, phases: ["components", "resume"], seconds: 120 },
      { group: 3, total: 3, phases: ["numeric", "mobile"], seconds: 130 },
    ]);
    expect(groupMatrix(groups)).toEqual([
      { group: 1, total: 3, phases: "journeys,access,emission" },
      { group: 2, total: 3, phases: "components,resume" },
      { group: 3, total: 3, phases: "numeric,mobile" },
    ]);
  });

  it("never plans an empty group: as many groups as phases below the limit, none without a phase", () => {
    expect(planCalcV3Groups([], measured).groups).toEqual([]);
    expect(groupMatrix(planCalcV3Groups(["mobile"], measured).groups)).toEqual([{ group: 1, total: 1, phases: "mobile" }]);
    expect(groupMatrix(planCalcV3Groups(["access", "mobile"], measured).groups))
      .toEqual([{ group: 1, total: 2, phases: "mobile" }, { group: 2, total: 2, phases: "access" }]);
    for (let count = 1; count <= CALC_V3_PHASES.length; count += 1) {
      const phases = CALC_V3_PHASES.slice(CALC_V3_PHASES.length - count);
      const { groups } = planCalcV3Groups(phases, measured);
      expect(groups, `${count} phases`).toHaveLength(Math.min(5, count));
      expect(groups.every((group) => group.phases.length > 0 && group.total === groups.length), `${count} phases`).toBe(true);
      partitioned(phases, groups);
    }
  });

  it("keeps an explicit complete campaign in one job, and one group without usable durations", () => {
    expect(groupMatrix(planCalcV3Groups(["all"], measured).groups)).toEqual([{ group: 1, total: 1, phases: "all" }]);
    const unmeasured = planCalcV3Groups(CALC_V3_PHASES, null);
    expect(unmeasured.grouping).toContain("no usable measured durations");
    expect(groupMatrix(unmeasured.groups)).toEqual([{ group: 1, total: 1, phases: CALC_V3_PHASES.join(",") }]);
  });

  it("hands the workflow a matrix whose every group the runner's --phase accepts", () => {
    const phases = planCalcV3(root, { NODE_ENV: "test", EVENT_NAME: "schedule" }).phases;
    const plan = planCalcV3Groups(phases, measured);
    const outputs = Object.fromEntries(planOutputs({ phases, ...plan }).trimEnd().split("\n").map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), JSON.parse(line.slice(index + 1)) as unknown];
    }));
    expect(outputs.phases).toEqual(CALC_V3_PHASES);
    const matrix = outputs.groups as { group: number; total: number; phases: string }[];
    expect(matrix).toHaveLength(5);
    expect(matrix.flatMap((group) => parseCalcV3Phases(group.phases)).sort()).toEqual([...CALC_V3_PHASES].sort());
    // Documentation only: no group job; an explicit phase: its own job.
    expect(planOutputs({ phases: [], ...planCalcV3Groups([], measured) })).toBe("phases=[]\ngroups=[]\n");
    expect(planOutputs({ phases: ["access"], ...planCalcV3Groups(["access"], measured) }))
      .toBe('phases=["access"]\ngroups=[{"group":1,"total":1,"phases":"access"}]\n');
  });
});
