import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { CALC_V3_PHASES, parseCalcV3Phases } from "../../scripts/tester-army/calc-v3-phases";
import {
  CALC_V3_OWN_INPUTS, CALC_V3_RUNNER_ENTRIES, groupMatrix, loadCalcV3GroupDurations, loadCalcV3Repository, planCalcV3, planCalcV3Groups,
  planOutputs, selectCalcV3, selectCalcV3FromRepository, validateCalcV3GroupDurations,
  type CalcV3GroupDurations, type CalcV3Repository,
} from "../../scripts/tester-army/select-calc-v3";

const root = process.cwd();
describe("calc-v3 impact selection", () => {
  // The working tree read once: git ls-files and every source file scanned took 0.15 s a selection here (18 cores,
  // idle). Read again for each of the 40 paths below, that is 2.2 s for the 18 paths of one test alone, and over
  // 5 s, its timeout, beside the rest of the Node project on a CI runner or on a loaded machine.
  let repository: CalcV3Repository;
  beforeAll(() => { repository = loadCalcV3Repository(root); });
  const select = (paths: string[]) => selectCalcV3FromRepository(repository, paths);

  it("claims no execution for docs and runs all on unknown, shared or unavailable inputs", () => {
    expect(select(["docs/testing/new-notes.md"]).phases).toEqual([]);
    for (const paths of [[], ["src/new-unknown-runtime.ts"], ["src/lib/estimate-calculations.ts"], ["supabase/migrations/new.sql"]]) {
      expect(select(paths).phases).toEqual(CALC_V3_PHASES);
    }
    // The command reads the working tree itself and decides the same.
    for (const paths of [[], ["docs/testing/new-notes.md"], ["e2e/army/local/mobile-journeys.e2e.ts"]]) {
      expect(selectCalcV3(root, paths), paths.join()).toEqual(select(paths));
    }
  });
  it("selects the directly changed journey, including formerly manual and mobile ones", () => {
    expect(select(["e2e/army/local/mobile-journeys.e2e.ts"]).phases).toEqual(["mobile"]);
    expect(select(["e2e/army/local/estimate-generated-atomic.e2e.ts"]).phases).toContain("generated-atomic");
    expect(select(["e2e/army/local/source-coverage-support.ts"]).phases).toEqual(expect.arrayContaining(["source-coverage-decisions", "source-coverage-edits", "source-coverage-recovery"]));
  });
  // What the selection could get wrong without any journey noticing. Too wide: every phase for a change no
  // phase can load (a unit test, a journey of another suite, a tooling file), nineteen phases of runner time
  // each time. Too narrow: the phases of one test that happens to reach the change, while a page no rule maps
  // loads it too; or no phase for calc-v3's own workflow and profile, which the critical map calls non-runtime.
  it("runs no phase for a change no phase loads: unit tests, the other suites' journeys, tooling", () => {
    for (const file of [
      "src/lib/browser-download.test.ts", "src/test/army-app-port.test.ts", "eslint.config.mjs", ".github/workflows/quality-gate.yml",
      "e2e/army/local/chatgpt-local-decisions.e2e.ts", "e2e/army/critical/dashboard-ux.e2e.ts",
      "e2e/army/takeoff/import-flow-carry-over.e2e.ts", "e2e/army/takeoff/native-ui.ts",
    ]) expect(select([file]).phases, file).toEqual([]);
    // A unit test whose name matches a domain rule (src/**/pdf*) is still a unit test.
    expect(select(["src/lib/estimates/pdf-generator.test.ts"]).phases).toEqual([]);
    // Beside the journey of a phase, such a change adds nothing; beside an unknown one, it removes nothing.
    expect(select(["src/lib/browser-download.test.ts", "e2e/army/local/mobile-journeys.e2e.ts"]).phases).toEqual(["mobile"]);
    expect(select(["src/lib/browser-download.test.ts", "src/new-unknown-runtime.ts"]).phases).toEqual(CALC_V3_PHASES);
  });
  it("runs every phase for application code that reaches no phase, even when only other suites' journeys name it", () => {
    // Only a takeoff journey names this route. The graph sees static imports and API literals, not every way
    // the application can reach a route: no phase is proven for runtime code that none is known to load.
    expect(select(["src/app/api/takeoff/health/route.ts"]).phases).toEqual(CALC_V3_PHASES);
  });
  it("runs every phase for a path absent from the tree: nothing shows what still imports a deleted file", () => {
    for (const file of ["e2e/army/local/deleted-support.ts", "src/lib/deleted.test.ts", "src/lib/estimates/pdf-deleted.ts"]) {
      expect(select([file]).phases, file).toEqual(CALC_V3_PHASES);
    }
  });
  it("runs every phase for what each calc-v3 job runs or reads before its phases, although the critical map calls it non-runtime", () => {
    for (const file of [
      ...CALC_V3_OWN_INPUTS, ...CALC_V3_RUNNER_ENTRIES,
      // Spawned by the stack preparation (local-supabase-ci.ts), read by path by the campaign scripts
      // (cctp-native-contract.mjs, check-offer-contract-sql.py) and by a journey (dpgf-import.e2e.ts).
      "src/test/large-estimate-workbook.ts", "src/test/fixtures/source-coverage-regression.sql",
      "src/test/fixtures/estimate-offer-contract-regression.sql", "e2e/fixtures/dpgf-minimal.csv",
      // Type-checked by the owned build of every phase, which only leaves the unit tests out.
      "src/types/side-effect-imports.d.ts", "src/lib/cad/dxf.test-utils.ts", "src/test/vitest.setup.ts",
    ]) {
      // A renamed input would otherwise leave its list silently: the old path selects every phase as a deleted one.
      expect(fs.existsSync(path.join(root, file)), file).toBe(true);
      expect(select([file]).phases, file).toEqual(CALC_V3_PHASES);
    }
  });
  it("runs every phase when the change reaches an entry point no phase accounts for, whatever one test reaches", () => {
    // The emission-v3 journey names an API route that loads the vector extraction; the takeoff pages load it too.
    expect(select(["src/lib/takeoff/vectors/extraction.ts"]).phases).toEqual(CALC_V3_PHASES);
  });
  it("keeps to the phases of support code that journeys of other suites share", () => {
    const phases = select(["e2e/army/critical/hydration-support.ts"]).phases;
    expect(phases).toContain("emission-v3");
    expect(phases).not.toEqual(CALC_V3_PHASES);
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
