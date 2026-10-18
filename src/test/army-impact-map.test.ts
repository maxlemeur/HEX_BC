// Guardrail for the impact selection of TesterArmy critical journeys
// (scripts/tester-army/select-journeys.ts, docs/testing/tester-army-ci.md).
//
// A pull request now runs only the journeys its files reach, so the selection
// itself becomes part of the evidence. Ways it can silently lose coverage,
// each pinned below:
// 1. a critical journey the CI runs (e2e.config.ts) is missing from the map,
//    so no source change ever selects it: the selector itself must then run
//    the full suite, since this guard alone cannot block a merge;
// 2. a journey is in the map but no rule reaches it, so only an edit of the
//    journey file itself selects it;
// 3. the map names a path that no longer exists (renamed journey, deleted
//    route): its rule matches nothing and the impact it described is lost;
// 4. a fail-safe default weakens: a shared-core path, an unknown, deleted or
//    unmapped path, an empty diff, an unknown event, a git error or a code push
//    stops forcing the full suite;
// 5. a dependency of the shared core (root layout, auth, calculation engine,
//    journey fixtures) is treated as a local change;
// 6. a journey reads a fixture by path that the map does not route to it;
// 7. the workflow skips the journeys for anything but an explicit "none", or
//    leaks the worker count or the build-cache save outside their scope;
// 8. a takeoff journey (e2e/army/takeoff/**, run only by the full selection of
//    e2e.config.ts) that a pull request reaches is not run by its CI: missing
//    from the map's fullOnly list, reached by no rule, dropped when the
//    selector is unsure, skipped by the takeoff job for anything but an
//    explicit "none", or listed in a form (a subfolder, for example) the
//    runner's full --files refuses before running anything.
// 9. the partition of a selection into parallel shard jobs (army-shards.json,
//    planShards) loses or doubles a journey: a selected file in no shard or in
//    two, a shard without the login setup or without an authenticated business
//    journey (the runner refuses it), a plan that depends on the order of its
//    input, a list the runner's --files would refuse or that cannot be
//    established still sharded instead of one shard running the runner's own
//    whole suite, a nightly full listing taken from the map instead of
//    e2e.config.ts and the working tree (an unregistered journey would never
//    run), or a matrix output the workflow cannot read.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  buildSourceGraph,
  classifyPath,
  criticalSuiteJourneys,
  expandJourneys,
  fullOnlySuiteJourneys,
  fullSelectionGlobs,
  globToRegExp,
  listRepositoryFiles,
  loadImpactMap,
  loadShardDurations,
  matchesAny,
  planFullSuite,
  planShards,
  selectFromRepository,
  selectJourneys,
  shardMatrix,
  validateImpactMap,
  validateShardDurations,
  type ImpactMap,
  type ShardDurations,
  type ShardPlan,
  type SourceGraph,
} from "../../scripts/tester-army/select-journeys";
import { CRITICAL_JOURNEY_FILE, FULL_JOURNEY_FILE, FULL_ONLY_JOURNEY_FILE } from "../../scripts/tester-army/journey-files.mjs";

const root = process.cwd();
const SELECTOR = "scripts/tester-army/select-journeys.ts";

// Owner decision of 17/10/2026: these paths always run the full suite.
const REQUIRED_FULL = [
  "package.json",
  "package-lock.json",
  "next.config.ts",
  "tsconfig.json",
  "e2e.config.ts",
  "e2e/army/critical/fixtures.ts",
  "scripts/run-tester-army-ci.ts",
  "scripts/run-tester-army.mjs",
  "scripts/tester-army/select-journeys.ts",
  "scripts/tester-army/army-impact-map.json",
  "scripts/tester-army/build-local.mjs",
  "scripts/next-build.mjs",
  "scripts/next-build-env.mjs",
  "src/proxy.ts",
  "src/app/layout.tsx",
  "src/lib/auth/server.ts",
  "src/lib/estimate-calculations.ts",
  "src/lib/estimate-v2-snapshot.ts",
  "src/types/database.ts",
  "supabase/migrations/29991231000000_new_migration.sql",
] as const;

let map: ImpactMap;
let files: string[];
let fileSet: Set<string>;
let graph: SourceGraph;

beforeAll(() => {
  map = loadImpactMap(root).map;
  files = listRepositoryFiles(root);
  fileSet = new Set(files);
  graph = buildSourceGraph(root, map, files);
});

function select(paths: string[], event = "pull_request") {
  return selectJourneys({ map, graph, event, paths });
}

/** Brace alternatives expanded; only patterns without * or ? remain literal paths. */
function expandBraces(glob: string): string[] {
  const start = glob.indexOf("{");
  if (start === -1) return [glob];
  const end = glob.indexOf("}", start);
  return glob.slice(start + 1, end).split(",")
    .flatMap((alternative) => expandBraces(`${glob.slice(0, start)}${alternative}${glob.slice(end + 1)}`));
}

function mapGlobs(): Array<{ where: string; glob: string }> {
  return [
    ...map.docs.map((glob) => ({ where: "docs", glob })),
    ...map.nonRuntime.map((glob) => ({ where: "nonRuntime", glob })),
    ...map.full.map((glob) => ({ where: "full", glob })),
    ...map.fullOnly.globs.map((glob) => ({ where: "fullOnly", glob })),
    ...map.rules.flatMap((rule) => rule.paths.map((glob) => ({ where: `rule ${rule.id}`, glob }))),
  ];
}

function criticalSuiteFromConfig(): string[] {
  return criticalSuiteJourneys(fs.readFileSync(path.join(root, "e2e.config.ts"), "utf8"), files);
}

// Owner request of 18/10/2026: the takeoff (métré) journeys join the map.
const TAKEOFF_GLOB = "e2e/army/takeoff/**/*.e2e.ts";
const TEAM_B = "e2e/army/takeoff/team-b-user-stories.e2e.ts";

function fullOnlySuiteFromConfig(): string[] {
  return fullOnlySuiteJourneys(fs.readFileSync(path.join(root, "e2e.config.ts"), "utf8"), map.fullOnly.globs, files);
}

describe("TesterArmy critical impact map", () => {
  it("is structurally valid and names only existing paths", () => {
    expect(validateImpactMap(map, (file) => fileSet.has(file), criticalSuiteFromConfig(), fullOnlySuiteFromConfig())).toEqual([]);
    const stale: string[] = [];
    for (const { where, glob } of mapGlobs()) {
      const alternatives = expandBraces(glob);
      // Every literal path exists; a wildcard glob matches at least one file.
      for (const literal of alternatives.filter((pattern) => !/[*?]/u.test(pattern))) {
        if (!fileSet.has(literal)) stale.push(`${where}: ${literal}`);
      }
      const patterns = alternatives.filter((pattern) => /[*?]/u.test(pattern));
      if (patterns.length && !files.some((file) => patterns.some((pattern) => globToRegExp(pattern).test(file)))) {
        stale.push(`${where}: ${glob}`);
      }
    }
    expect(stale).toEqual([]);
  });

  it("lists exactly the journeys the CI critical suite runs, each reachable from a rule", () => {
    // The CI stack is loopback, so the localBusiness branch is the one CI runs.
    const suite = criticalSuiteFromConfig();
    expect(suite).toContain("e2e/army/critical/stale-save.e2e.ts");
    expect(suite).toContain("e2e/army/local/tech-debt-lock-boundaries.e2e.ts");
    expect([...map.suite.journeys].sort()).toEqual(suite);
    const reached = new Set(map.rules
      .filter((rule) => !rule.journeys.includes("*"))
      .flatMap((rule) => expandJourneys(map, rule.journeys)));
    const unreachable = map.suite.journeys.filter((journey) => journey !== map.suite.setup && !reached.has(journey));
    expect(unreachable).toEqual([]);
  });

  it("lists exactly the takeoff journeys only the full selection runs, each reachable from a rule", () => {
    expect(map.fullOnly.globs).toEqual([TAKEOFF_GLOB]);
    const fullOnly = fullOnlySuiteFromConfig();
    expect(fullOnly).toContain(TEAM_B);
    expect([...map.fullOnly.journeys].sort()).toEqual(fullOnly);
    expect(fullOnly.filter((journey) => map.suite.journeys.includes(journey))).toEqual([]);
    const reached = new Set(map.rules
      .filter((rule) => !rule.journeys.includes("*"))
      .flatMap((rule) => expandJourneys(map, rule.journeys)));
    expect(fullOnly.filter((journey) => !reached.has(journey))).toEqual([]);
    // "*" (the application shell) reaches them too.
    expect(expandJourneys(map, ["*"])).toEqual(expect.arrayContaining([...map.suite.journeys, ...fullOnly]));

    // A glob the full selection no longer runs, or an unreadable list, invalidates the map.
    const config = fs.readFileSync(path.join(root, "e2e.config.ts"), "utf8");
    expect(() => fullOnlySuiteJourneys(config, ["e2e/army/zz-gone/**/*.e2e.ts"], files)).toThrow(/zz-gone/u);
    expect(() => fullOnlySuiteJourneys("export default {};", map.fullOnly.globs, files)).toThrow(/full/u);
    expect(validateImpactMap(map, (file) => fileSet.has(file), criticalSuiteFromConfig(), [])).toContain(
      `The map lists ${TEAM_B} as full-only, which the full selection does not run.`,
    );
  });

  it("keeps the owner's shared-core paths on the full suite", () => {
    for (const file of REQUIRED_FULL) {
      expect(matchesAny(file, map.full), `${file} in the full globs`).toBe(true);
      expect(classifyPath(map, graph, file, "pull_request").class, file).toBe("full");
      expect(select([file, "docs/testing/tester-army-ci.md"]).mode, file).toBe("full");
    }
  });

  it("fails safe on unknown, deleted, unmapped or undeterminable changes", () => {
    expect(select(["src/feature-without-rule/new-module.ts"]).mode).toBe("full");
    expect(select(["deleted-root-file.cfg"]).mode).toBe("full");
    expect(select([]).mode).toBe("full");
    expect(select(["docs/README.md"], "workflow_dispatch").mode).toBe("full");
    expect(select(["docs/README.md"], "schedule").mode).toBe("full");
    expect(selectJourneys({ map, graph, event: "pull_request", paths: ["docs/README.md"], forceFull: "label army-full" }).mode)
      .toBe("full");
    // A push skips nothing the pull request did not prove: only docs are skipped.
    expect(select(["src/app/dashboard/estimates/[versionId]/edit/page.tsx"], "push").mode).toBe("full");
    expect(select(["src/app/portal/page.tsx"], "push").mode).toBe("full");
    expect(select(["docs/testing/tester-army-ci.md", "AGENTS.md"], "push").mode).toBe("none");

    // A new entry point (route, page, script) that no rule covers.
    const synthetic: SourceGraph = {
      files: new Set(["src/app/api/new-endpoint/route.ts", "src/lib/new-endpoint.ts"]),
      importers: new Map([["src/lib/new-endpoint.ts", new Set(["src/app/api/new-endpoint/route.ts"])]]),
      apiCallers: new Map(),
      runnerClosure: new Set(),
    };
    for (const file of synthetic.files) {
      expect(selectJourneys({ map, graph: synthetic, event: "pull_request", paths: [file] }).mode, file).toBe("full");
    }
  });

  it("runs the full suite when the CI runs a journey the map does not list, or the reverse", () => {
    // A filtered run would otherwise skip that journey and still be recorded as
    // a passing filtered-critical proof (a merge is not blocked by this guard).
    const editor = ["src/app/dashboard/estimates/[versionId]/edit/page.tsx"];
    expect(selectFromRepository(root, { event: "pull_request", paths: editor, repositoryFiles: files }).mode).toBe("files");

    const unmapped = "e2e/army/critical/zz-unmapped-journey.e2e.ts";
    expect(criticalSuiteJourneys(fs.readFileSync(path.join(root, "e2e.config.ts"), "utf8"), [...files, unmapped]))
      .toContain(unmapped);
    const added = selectFromRepository(root, { event: "pull_request", paths: editor, repositoryFiles: [...files, unmapped] });
    expect(added).toMatchObject({ mode: "full", files: [] });
    expect(added.reason).toMatch(/^fail-safe: Invalid impact map: /u);
    expect(added.reason).toContain(unmapped);

    const removedJourney = "e2e/army/critical/dpgf-import.e2e.ts";
    const removed = selectFromRepository(root, {
      event: "pull_request", paths: editor, repositoryFiles: files.filter((file) => file !== removedJourney),
    });
    expect(removed.mode).toBe("full");
    expect(removed.reason).toContain(removedJourney);

    // An e2e.config.ts list the selector cannot read leaves every journey unproven.
    expect(validateImpactMap(map, (file) => fileSet.has(file), [], fullOnlySuiteFromConfig())).toContain(
      `The map lists ${map.suite.setup}, which the critical suite does not run.`,
    );
    expect(() => criticalSuiteJourneys("export default {};", files)).toThrow(/localBusiness/u);
  });

  it("escalates every dependency of the shared core to the full suite", () => {
    const reverse = new Map<string, string[]>();
    for (const [target, importers] of graph.importers) {
      for (const importer of importers) reverse.set(importer, [...(reverse.get(importer) ?? []), target]);
    }
    for (const core of ["src/app/layout.tsx", "src/lib/auth/server.ts", "src/lib/estimate-calculations.ts", "e2e/army/critical/fixtures.ts"]) {
      const dependencies = reverse.get(core) ?? [];
      expect(dependencies.length, `${core} imports`).toBeGreaterThan(0);
      for (const dependency of dependencies) {
        expect(select([dependency]).mode, `${dependency} (loaded by ${core})`).toBe("full");
      }
    }
  });

  it("selects only what a change reaches, with the login setup", () => {
    const docs = select(["docs/testing/tester-army-ci.md", "README.md", "maquette/notes.md"]);
    expect(docs.mode).toBe("none");

    const test = select(["src/app/dashboard/estimates/[versionId]/edit/page.test.tsx"]);
    expect(test.mode).toBe("none");

    const editor = select(["src/app/dashboard/estimates/[versionId]/edit/page.tsx"]);
    expect(editor.mode).toBe("files");
    expect(editor.files).toContain(map.suite.setup);
    expect(editor.files).toContain("e2e/army/critical/numeric-entry.e2e.ts");
    expect(editor.files).not.toContain("e2e/army/critical/dashboard-ux.e2e.ts");
    expect(editor.files.length).toBeLessThan(map.suite.journeys.length);

    // Lever 3 of docs/testing/ci-retro-2026-10-18.md: the V1 totals journeys ran only in the full
    // suite, so a PR on the editor's bulk, suggestion or supplier controllers needed a manual one.
    const v1Totals = ["e2e/army/local/bulk-actions-v1-totals.e2e.ts", "e2e/army/local/supplier-preselection-v1-totals.e2e.ts"];
    for (const controller of ["Bulk", "Suggestions", "Supplier"]) {
      const hook = `src/hooks/useEstimateEditor${controller}Controller.ts`;
      expect(select([hook]).files, hook).toEqual(expect.arrayContaining(v1Totals));
    }
    // Their stored-totals oracle reads the affaire hub and the affaires list (PR #58 review).
    for (const page of ["src/app/dashboard/affaires/[projectId]/page.tsx", "src/app/dashboard/affaires/page.tsx"]) {
      expect(select([page]).files, page).toEqual(expect.arrayContaining(v1Totals));
    }

    // A journey edit runs that journey; an anonymous one also needs an
    // authenticated business journey for the runner's proof.
    expect(select(["e2e/army/critical/dpgf-import.e2e.ts"]).files)
      .toEqual([map.suite.setup, "e2e/army/critical/dpgf-import.e2e.ts"].sort());
    expect(select(["e2e/army/critical/auth-rejection.e2e.ts"]).files)
      .toEqual([map.suite.setup, map.suite.anchor, "e2e/army/critical/auth-rejection.e2e.ts"].sort());
  });

  it("runs every takeoff journey a pull request reaches, and all of them when unsure", () => {
    const all = [map.suite.setup, ...map.fullOnly.journeys].sort();

    // PR #39: the supplier CSV import of the affaire prices page (US-4.1, -b, -c)
    // reached only dashboard-ux, so its three journeys needed the 30-minute nightly.
    const catalogue = select([
      "e2e/army/takeoff/team-b-user-stories.e2e.ts",
      "src/components/catalogue/PricesManager.tsx",
      "src/components/catalogue/price-book-csv-import/usePriceBookCsvWorkflow.ts",
      "src/components/catalogue/prices-manager/usePriceLookups.ts",
    ]);
    expect(catalogue.mode).toBe("files");
    expect(catalogue.files).not.toContain(TEAM_B);
    expect(catalogue.fullOnly.mode).toBe("files");
    expect(catalogue.fullOnly.files).toContain(TEAM_B);
    expect(catalogue.fullOnly.files).toContain(map.suite.setup);
    expect(catalogue.fullOnly.files.length).toBeLessThan(all.length);
    expect(select(["src/app/dashboard/affaires/[projectId]/prices/page.tsx"]).fullOnly.files).toContain(TEAM_B);

    // A journey or helper edit runs the journeys that load it, not the critical suite.
    const contracts = "e2e/army/takeoff/contracts.e2e.ts";
    expect(select([contracts])).toMatchObject({ mode: "none", files: [], fullOnly: { mode: "files", files: [map.suite.setup, contracts].sort() } });
    expect(select(["e2e/army/takeoff/native-ui.ts"]).fullOnly.files)
      .toEqual(expect.arrayContaining([TEAM_B, "e2e/army/takeoff/takeoff-dpgf-review.e2e.ts"]));
    // Shared pages: the editor, which the estimate wizard opens, reaches the wizard's takeoff journeys.
    expect(select(["src/app/dashboard/estimates/[versionId]/edit/page.tsx"]).fullOnly.files)
      .toEqual(expect.arrayContaining([contracts, TEAM_B, "e2e/army/takeoff/generated-review.e2e.ts"]));
    expect(select(["src/app/dashboard/estimates/[versionId]/takeoff/[jobId]/page.tsx"]).fullOnly.files).toContain(contracts);

    // Documentation and tests reach nothing.
    expect(select(["docs/testing/tester-army-ci.md", "e2e/army/takeoff/team-b-fixture-contract.md"]).fullOnly)
      .toEqual({ mode: "none", reason: expect.any(String), files: [] });
    expect(select(["src/components/catalogue/PriceBookCsvImport.test.ts"]).fullOnly.mode).toBe("none");

    // Unsure (shared core, unmapped path, empty diff, other event, forced, or
    // changes that reach every critical journey): all of them.
    const everyCriticalJourney = select(map.suite.journeys.filter((journey) => journey !== map.suite.setup));
    expect(everyCriticalJourney.mode).toBe("full");
    for (const unsure of [
      everyCriticalJourney,
      select(["scripts/run-tester-army-ci.ts"]),
      select(["src/feature-without-rule/new-module.ts"]),
      select([]),
      select(["docs/README.md"], "workflow_dispatch"),
      selectJourneys({ map, graph, event: "pull_request", paths: ["docs/README.md"], forceFull: "label army-full" }),
    ]) {
      expect(unsure.fullOnly).toMatchObject({ mode: "all", files: all });
    }
    // A push to main keeps its critical suite; takeoff journeys stay with the nightly full suite.
    expect(select(["src/components/catalogue/PricesManager.tsx"], "push")).toMatchObject({ mode: "full", fullOnly: { mode: "none", files: [] } });
    expect(select(["docs/README.md"], "push").fullOnly.mode).toBe("none");
  });

  it("runs a takeoff journey the map does not list, never one the checkout lacks", () => {
    const editor = ["src/app/dashboard/estimates/[versionId]/edit/page.tsx"];
    const added = "e2e/army/takeoff/zz-unmapped-journey.e2e.ts";
    const unlisted = selectFromRepository(root, { event: "pull_request", paths: editor, repositoryFiles: [...files, added] });
    expect(unlisted.mode).toBe("full");
    expect(unlisted.reason).toContain(added);
    expect(unlisted.fullOnly.mode).toBe("all");
    expect(unlisted.fullOnly.files).toEqual([map.suite.setup, ...map.fullOnly.journeys, added].sort());

    const removed = "e2e/army/takeoff/contracts.e2e.ts";
    const missing = selectFromRepository(root, {
      event: "pull_request", paths: editor, repositoryFiles: files.filter((file) => file !== removed),
    });
    expect(missing.mode).toBe("full");
    expect(missing.reason).toContain(removed);
    expect(missing.fullOnly).toMatchObject({ mode: "all" });
    expect(missing.fullOnly.files).not.toContain(removed);
    expect(missing.fullOnly.files).toContain(TEAM_B);

    const push = selectFromRepository(root, { event: "push", paths: editor, repositoryFiles: [...files, added] });
    expect(push).toMatchObject({ mode: "full", fullOnly: { mode: "none", files: [] } });
  });

  it("hands the takeoff job only paths the runner's full --files accepts, subfolders included", () => {
    const refusedBy = (selection: { fullOnly: { files: string[] } }) =>
      selection.fullOnly.files.filter((file) => !FULL_ONLY_JOURNEY_FILE.test(file));
    const editor = ["src/app/dashboard/estimates/[versionId]/edit/page.tsx"];
    for (const selection of [select(editor), select(["e2e/army/takeoff/native-ui.ts"]), select(["scripts/run-tester-army-ci.ts"])]) {
      expect(selection.fullOnly.files.length).toBeGreaterThan(0);
      expect(refusedBy(selection)).toEqual([]);
    }

    // e2e.config.ts globs e2e/army/takeoff/**: a journey in a subfolder runs,
    // unlisted (fail-safe) as listed (its own change selects it).
    const nested = "e2e/army/takeoff/metre/new-journey.e2e.ts";
    const unlisted = selectFromRepository(root, { event: "pull_request", paths: editor, repositoryFiles: [...files, nested] });
    expect(unlisted.fullOnly.mode).toBe("all");
    expect(unlisted.fullOnly.files).toContain(nested);
    expect(refusedBy(unlisted)).toEqual([]);
    const listedMap: ImpactMap = { ...map, fullOnly: { ...map.fullOnly, journeys: [...map.fullOnly.journeys, nested] } };
    expect(validateImpactMap(listedMap, (file) => file === nested || fileSet.has(file), criticalSuiteFromConfig(),
      [...fullOnlySuiteFromConfig(), nested].sort())).toEqual([]);
    const listed = selectJourneys({ map: listedMap, graph, event: "pull_request", paths: [nested] });
    expect(listed.fullOnly).toEqual({ mode: "files", reason: expect.any(String), files: [map.suite.setup, nested].sort() });
    expect(refusedBy(listed)).toEqual([]);

    // A takeoff file the runner refuses (folder starting with "_", a space)
    // invalidates the map, and the fail-safe runs the whole full selection.
    for (const refused of ["e2e/army/takeoff/_draft/new-journey.e2e.ts", "e2e/army/takeoff/US 4.1.e2e.ts"]) {
      expect(FULL_ONLY_JOURNEY_FILE.test(refused), refused).toBe(false);
      const oddMap: ImpactMap = { ...map, fullOnly: { ...map.fullOnly, journeys: [...map.fullOnly.journeys, refused] } };
      expect(validateImpactMap(oddMap, (file) => file === refused || fileSet.has(file), criticalSuiteFromConfig(),
        [...fullOnlySuiteFromConfig(), refused].sort())).toContain(`The runner's full --files refuses the full-only journey ${refused}.`);
      const selection = selectFromRepository(root, { event: "pull_request", paths: editor, repositoryFiles: [...files, refused] });
      expect(selection.mode).toBe("full");
      expect(selection.fullOnly).toMatchObject({ mode: "all", files: [] });
    }
    // Traversal, hidden entries, other folders and line suffixes stay refused.
    for (const outside of ["e2e/army/takeoff/../critical/smoke.e2e.ts", "e2e/army/takeoff/.cache/x.e2e.ts",
      "e2e/army/extended/x.e2e.ts", "e2e/army/takeoff/x.e2e.ts:12", "e2e/army/takeoff//x.e2e.ts", "e2e/army/critical/fixtures.e2e.ts"]) {
      expect(FULL_ONLY_JOURNEY_FILE.test(outside), outside).toBe(false);
    }
  });

  it("routes every fixture a journey reads by path to that journey", () => {
    const forward = new Map<string, Set<string>>();
    for (const [target, importers] of graph.importers) {
      for (const importer of importers) forward.set(importer, new Set([...(forward.get(importer) ?? []), target]));
    }
    const fixtures = files.filter((file) => file.startsWith("e2e/fixtures/") && !file.endsWith("/.gitignore"));
    const misrouted: string[] = [];
    let found = 0;
    for (const journey of [...map.suite.journeys, ...map.fullOnly.journeys]) {
      // The journey and the critical or same-directory helpers it imports name
      // the fixtures they read; shared multi-entry harnesses
      // (extended/component-fixture.ts) list every entry, so the journey's own
      // argument is what counts there.
      const helpers = journey.startsWith("e2e/army/takeoff/") ? ["e2e/army/critical/", "e2e/army/takeoff/"] : ["e2e/army/critical/"];
      const reach = new Set<string>();
      const pending = [journey];
      while (pending.length) {
        const file = pending.pop()!;
        if (reach.has(file) || (!helpers.some((helper) => file.startsWith(helper)) && file !== journey)) continue;
        reach.add(file);
        forward.get(file)?.forEach((next) => pending.push(next));
      }
      const text = [...reach].map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
      for (const fixture of fixtures) {
        // Named in a string: a path (`fixtures/x.csv`) or a stem whose extension
        // is added in code ("deslop-client-list" for `${entry}.tsx`).
        const stem = path.posix.basename(fixture).replace(/\.[^.]+$/u, "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
        if (!new RegExp(`(?<=["'\`/])${stem}(?=["'\`.])`, "u").test(text)) continue;
        found += 1;
        const decision = classifyPath(map, graph, fixture, "pull_request");
        if (decision.class !== "full" && decision.class !== "unmapped" && !decision.journeys?.includes(journey)) {
          misrouted.push(`${fixture} -> ${journey} (${decision.class})`);
        }
      }
    }
    expect(misrouted).toEqual([]);
    // dpgf-minimal.csv, sample-plan.pdf and the deslop entries at least.
    expect(found).toBeGreaterThanOrEqual(4);
  });

  it("falls back to the full suite from the command line when git cannot answer", () => {
    const environment = { ...process.env };
    delete environment.GITHUB_OUTPUT;
    delete environment.GITHUB_STEP_SUMMARY;
    const run = (args: string[]) => spawnSync(process.execPath, [SELECTOR, ...args], {
      cwd: root, encoding: "utf8", env: environment, windowsHide: true,
    });

    const missing = run(["--event", "pull_request", "--base", "0".repeat(40), "--head", "HEAD"]);
    expect(missing.status, missing.stderr).toBe(0);
    expect(JSON.parse(missing.stdout)).toMatchObject({ mode: "full", reason: expect.stringMatching(/^fail-safe: /u) });

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "army-impact-"));
    try {
      const paths = path.join(directory, "paths.txt");
      fs.writeFileSync(paths, "docs/testing/tester-army-ci.md\nAGENTS.md\n");
      const docs = run(["--event", "pull_request", "--paths-file", paths]);
      expect(docs.status, docs.stderr).toBe(0);
      expect(JSON.parse(docs.stdout)).toMatchObject({ mode: "none", files: [] });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }

    expect(run(["--event", "pull_request", "--force-full"]).status).toBe(2);
    expect(run(["--event", "pull_request", "--unknown", "x"]).status).toBe(2);
  });
});

describe("TesterArmy shard plans", () => {
  let durations: ShardDurations;

  beforeAll(() => {
    durations = loadShardDurations(root).durations;
  });

  /** A plan's shards: numbered 1..n, each with the setup and an authenticated journey, disjoint, together the plan's files. */
  function expectPartition(plan: ShardPlan, expected: readonly string[], label: string) {
    const setup = map.suite.setup;
    const anonymous = new Set(map.suite.anonymous);
    expect(plan.files, label).toEqual([...expected].sort());
    expect(plan.shards.map((shard) => [shard.shard, shard.total]), label)
      .toEqual(plan.shards.map((_, index) => [index + 1, plan.shards.length]));
    const owners = new Map<string, number[]>();
    for (const shard of plan.shards) {
      expect(shard.files, `${label} shard ${shard.shard}`).toContain(setup);
      expect(shard.files.some((file) => file !== setup && !anonymous.has(file)), `${label} shard ${shard.shard} authenticated`).toBe(true);
      expect(shard.files, `${label} shard ${shard.shard} sorted`).toEqual([...shard.files].sort());
      for (const file of shard.files) if (file !== setup) owners.set(file, [...(owners.get(file) ?? []), shard.shard]);
    }
    expect([...owners].filter(([, shards]) => shards.length !== 1), `${label} overlap`).toEqual([]);
    expect([...owners.keys(), setup].sort(), `${label} union`).toEqual([...expected].sort());
  }

  it("partitions every selected journey into exactly one shard, with the login setup and an authenticated journey in each", () => {
    expect(validateShardDurations(durations, [...map.suite.journeys, ...fullOnlySuiteFromConfig(),
      ...fullSelectionListing()])).toEqual([]);
    const settings = durations.suites.critical;

    // The full critical suite (a shared-core path): the e2e.config.ts listing, split.
    const full = selectFromRepository(root, { event: "pull_request", paths: ["scripts/run-tester-army-ci.ts"], repositoryFiles: files });
    expect(full.mode).toBe("full");
    expect(full.shards.shards.length).toBeGreaterThan(1);
    expect(full.shards.shards.length).toBeLessThanOrEqual(settings.maxShards);
    expect(full.shards.workers).toBe(settings.workers);
    expectPartition(full.shards, criticalSuiteFromConfig(), "full critical suite");

    // An impact selection: exactly its files, the anchor of an anonymous change included.
    for (const paths of [["src/app/dashboard/estimates/[versionId]/edit/page.tsx"], ["e2e/army/critical/auth-rejection.e2e.ts"]]) {
      const selection = selectFromRepository(root, { event: "pull_request", paths, repositoryFiles: files });
      expect(selection.mode, paths[0]).toBe("files");
      expectPartition(selection.shards, selection.files, paths[0]);
    }
    // A small selection stays one job: no shard costs a stack and a build for seconds of journeys.
    const small = selectFromRepository(root, { event: "pull_request", paths: ["e2e/army/critical/dpgf-import.e2e.ts"], repositoryFiles: files });
    expect(small.shards.shards).toEqual([{ shard: 1, total: 1, files: small.files, seconds: expect.any(Number) }]);

    // Nothing to run: no shard, so the matrix job is skipped and the aggregate claims nothing.
    const none = selectFromRepository(root, { event: "pull_request", paths: ["docs/testing/tester-army-ci.md"], repositoryFiles: files });
    expect(none.mode).toBe("none");
    expect(none.shards).toMatchObject({ files: [], shards: [] });
  });

  it("plans the same shards whatever the order of the selection, the heaviest journeys spread first", () => {
    const listing = criticalSuiteFromConfig();
    const plan = (order: string[]) => planShards({ suite: "critical", files: order, wholeSuite: true, setup: map.suite.setup,
      anonymous: map.suite.anonymous, accepts: CRITICAL_JOURNEY_FILE, durations });
    const reference = plan(listing);
    expect(plan([...listing].reverse())).toEqual(reference);
    expect(plan([...listing].sort((a, b) => b.length - a.length || a.localeCompare(b)))).toEqual(reference);
    // Longest-first assignment: no shard exceeds another by more than the heaviest journey.
    const weight = (file: string) => durations.seconds[file] ?? durations.defaultSeconds;
    const heaviest = Math.max(...listing.filter((file) => file !== map.suite.setup).map(weight));
    const loads = reference.shards.map((shard) => shard.seconds);
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(heaviest);
    expect(reference.shards.map((shard) => shard.seconds))
      .toEqual(reference.shards.map((shard) => shard.files.filter((file) => file !== map.suite.setup).reduce((sum, file) => sum + weight(file), 0)));
  });

  it("runs one unsharded shard, never a partial list, when the list is refused by the runner or cannot be established", () => {
    const listing = criticalSuiteFromConfig();
    const base = { suite: "critical" as const, setup: map.suite.setup, anonymous: map.suite.anonymous, accepts: CRITICAL_JOURNEY_FILE };
    const whole = { files: [], shards: [{ shard: 1, total: 1, files: [], seconds: 0 }] };
    // A path the runner's critical --files refuses (subfolder): the runner's own whole suite.
    expect(planShards({ ...base, files: [...listing, "e2e/army/critical/nested/x.e2e.ts"], wholeSuite: true, durations }))
      .toMatchObject(whole);
    // No measured durations: one shard; the whole suite runs the runner's own selection, a selection its files.
    expect(planShards({ ...base, files: listing, wholeSuite: true, durations: null })).toMatchObject(whole);
    const editor = selectFromRepository(root, { event: "pull_request", paths: ["src/app/dashboard/estimates/[versionId]/edit/page.tsx"], repositoryFiles: files });
    expect(planShards({ ...base, files: editor.files, wholeSuite: false, durations: null }))
      .toMatchObject({ files: editor.files, shards: [{ shard: 1, total: 1, files: editor.files }] });
    // A selection without its login setup is not a runner selection either.
    expect(planShards({ ...base, files: editor.files.filter((file) => file !== map.suite.setup), wholeSuite: false, durations }))
      .toMatchObject(whole);

    // Fail-safe of the selector (a journey the map does not list): full suite, one unsharded shard.
    const unmapped = selectFromRepository(root, {
      event: "pull_request", paths: ["src/app/dashboard/estimates/[versionId]/edit/page.tsx"],
      repositoryFiles: [...files, "e2e/army/critical/zz-unmapped-journey.e2e.ts"],
    });
    expect(unmapped.mode).toBe("full");
    expect(unmapped.shards).toMatchObject(whole);
  });

  it("shards the nightly full suite from e2e.config.ts and the working tree, its development phase in its own job", () => {
    const added = "e2e/army/extended/zz-unregistered-journey.e2e.ts";
    const plan = planFullSuite(root, { repositoryFiles: [...files, added] });
    expect(plan.development).toBe("separate");
    expect(plan.workers).toBe(durations.suites.full.workers);
    expect(plan.shards.length).toBeGreaterThan(1);
    expect(plan.shards.length).toBeLessThanOrEqual(durations.suites.full.maxShards);
    expect(plan.files).toContain(added);
    expectPartition(plan, [...fullSelectionListing(), added], "full suite");
    expect(plan.files.filter((file) => !FULL_JOURNEY_FILE.test(file))).toEqual([]);

    // A filtered dispatch (--grep) is one unsharded shard without the development phase.
    expect(planFullSuite(root, { repositoryFiles: files, unsharded: "dispatch --grep" }))
      .toMatchObject({ files: [], development: "none", shards: [{ shard: 1, total: 1, files: [] }] });
    // An unreadable full list: one unsharded shard running both phases on its stack, as before sharding.
    expect(planFullSuite(root, { repositoryFiles: files, config: "export default {};" }))
      .toMatchObject({ files: [], development: "in-shard", shards: [{ shard: 1, total: 1, files: [] }] });
  });

  it("names only journeys of the suites and keeps every limit usable", () => {
    const known = [...map.suite.journeys, ...fullSelectionListing()];
    expect(validateShardDurations({ ...durations, seconds: { ...durations.seconds, "e2e/army/critical/zz-gone.e2e.ts": 5 } }, known))
      .toEqual(["army-shards.json times e2e/army/critical/zz-gone.e2e.ts, which no suite runs."]);
    expect(validateShardDurations({ ...durations, suites: { ...durations.suites, full: { maxShards: 0, secondsPerShard: 320, workers: 1 } } }, known))
      .toEqual(["army-shards.json suite full needs maxShards from 1 to 8, secondsPerShard above 0 and workers from 1 to 4."]);
  });

  it("hands the workflow one matrix entry per shard, its files comma-joined", () => {
    const environment = { ...process.env };
    delete environment.GITHUB_STEP_SUMMARY;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "army-shards-"));
    try {
      const readOutputs = (args: string[]) => {
        const output = path.join(directory, `${args.join("-").replace(/[^a-z]+/gu, "-")}.txt`);
        const result = spawnSync(process.execPath, [SELECTOR, ...args], {
          cwd: root, encoding: "utf8", env: { ...environment, GITHUB_OUTPUT: output }, windowsHide: true,
        });
        expect(result.status, result.stderr).toBe(0);
        return Object.fromEntries(fs.readFileSync(output, "utf8").trim().split("\n").map((line) => {
          const index = line.indexOf("=");
          return [line.slice(0, index), line.slice(index + 1)];
        }));
      };
      const paths = path.join(directory, "paths.txt");
      fs.writeFileSync(paths, "scripts/run-tester-army-ci.ts\n");
      const critical = readOutputs(["--event", "pull_request", "--paths-file", paths]);
      expect(critical.mode).toBe("full");
      const matrix = JSON.parse(critical.critical_shards) as Array<{ shard: number; total: number; files: string }>;
      const selection = selectFromRepository(root, { event: "pull_request", paths: ["scripts/run-tester-army-ci.ts"] });
      expect(matrix).toEqual(shardMatrix(selection.shards));
      expect(matrix.map((entry) => entry.files.split(",")).flat().filter((file) => file !== map.suite.setup).sort())
        .toEqual(criticalSuiteFromConfig().filter((file) => file !== map.suite.setup));

      fs.writeFileSync(paths, "docs/testing/tester-army-ci.md\n");
      expect(readOutputs(["--event", "pull_request", "--paths-file", paths])).toMatchObject({ mode: "none", critical_shards: "[]" });

      const nightly = readOutputs(["--plan", "full"]);
      expect(nightly.development).toBe("separate");
      expect(JSON.parse(nightly.shards)).toEqual(shardMatrix(planFullSuite(root, {})));
      expect(readOutputs(["--plan", "full", "--unsharded", "dispatch --grep"]))
        .toMatchObject({ development: "none", shards: JSON.stringify([{ shard: 1, total: 1, files: "" }]) });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

/** Journey files the e2e.config.ts full selection runs in this working tree. */
function fullSelectionListing(): string[] {
  const globs = fullSelectionGlobs(fs.readFileSync(path.join(root, "e2e.config.ts"), "utf8"));
  return files.filter((file) => globs.some((glob) => globToRegExp(glob).test(file))).sort();
}

describe("TesterArmy critical workflow wiring", () => {
  const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
  const steps = (workflow: string) => workflow.split(/^\s+- name:/mu).slice(1);

  it("skips the journeys only on an explicit none and keeps workers and cache saves in scope", () => {
    const workflow = read(".github/workflows/e2e-army-critical.yml");
    const jobs = jobBlocks(workflow);
    // One decision, before any install: a "none" selection starts no shard.
    const select = steps(jobs["army-select"]);
    expect(select.some((step) => /^\s+node .*scripts\/tester-army\/select-journeys\.ts /mu.test(step))).toBe(true);
    expect(select.some((step) => /^\s+run: npm ci\b/mu.test(step))).toBe(false);
    for (const output of ["mode", "files", "full_only_mode", "full_only_files", "critical_shards"]) {
      expect(jobs["army-select"]).toContain(`\n      ${output}: \${{ steps.select.outputs.${output} }}\n`);
    }
    // An empty or missing selector output must run the journeys: only an
    // explicit none skips the shards (an empty matrix then fails, never passes).
    const shard = jobs["army-critical-shard"];
    expect(shard).toMatch(/^ {4}if: needs\.army-select\.outputs\.mode != 'none'$/mu);
    expect(shard).not.toMatch(/mode == /u);
    expect(shard).toContain("\n        include: ${{ fromJSON(needs.army-select.outputs.critical_shards) }}\n");
    const journeys = steps(shard).find((step) => step.trimStart().startsWith("Run native database and TesterArmy critical journeys"));
    expect(journeys).toBeDefined();
    expect(journeys).toMatch(/^\s+E2E_ARMY_WORKERS: "2"$/mu);
    expect(journeys).toMatch(/^\s+ARMY_FILES: \$\{\{ matrix\.files \}\}$/mu);
    expect(journeys).toContain('run: node --import tsx scripts/run-tester-army-ci.ts critical --shard "$ARMY_SHARD" ${ARMY_FILES:+--files "$ARMY_FILES"}');

    for (const file of fs.readdirSync(path.join(root, ".github/workflows"))) {
      const other = read(`.github/workflows/${file}`);
      const count = other.split("E2E_ARMY_WORKERS").length - 1;
      expect(count, file).toBe(file === "e2e-army-critical.yml" ? 1 : 0);
    }

    // Only shard 1 of a push to main saves: the caches are the same in every shard.
    const saves = steps(workflow).filter((step) => /uses: actions\/cache\/save@/u.test(step));
    expect(saves.length).toBeGreaterThan(0);
    for (const save of saves) {
      expect(save).toMatch(/if: .*github\.event_name == 'push' && github\.ref == 'refs\/heads\/main' && matrix\.shard == 1\b/u);
      expect(shard).toContain(save);
    }
    expect(workflow).not.toMatch(/uses: actions\/cache@/u);
  });

  it("runs the takeoff journeys a change reaches in a parallel job, at one worker, skipping only an explicit none", () => {
    const workflow = read(".github/workflows/e2e-army-critical.yml");
    const jobs = jobBlocks(workflow);
    expect(Object.keys(jobs)).toEqual(["army-select", "army-critical-shard", "army-takeoff", "army-critical"]);
    const takeoff = steps(jobs["army-takeoff"]);
    // Same decision as the critical shards: army-select's, read once, never recomputed.
    expect(jobs["army-takeoff"]).toMatch(/^ {4}needs: army-select$/mu);
    expect(jobs["army-takeoff"]).not.toMatch(/scripts\/tester-army\/select-journeys\.ts/u);
    expect(jobs["army-takeoff"]).not.toMatch(/^ {4}if:/mu);

    const gated = takeoff.slice(1).filter((step) => !step.trimStart().startsWith("No takeoff journey"));
    expect(gated.length).toBeGreaterThan(0);
    for (const step of gated) {
      // An empty or missing output runs the journeys (fail-safe).
      expect(step).toMatch(/^\s+if: .*needs\.army-select\.outputs\.full_only_mode != 'none'/mu);
      expect(step).not.toMatch(/full_only_mode == /u);
      expect(step).not.toMatch(/uses: actions\/cache\/save@/u);
    }
    const run = takeoff.find((step) => step.trimStart().startsWith("Run native database and TesterArmy takeoff journeys"));
    expect(run).toBeDefined();
    expect(run).toMatch(/^\s+ARMY_FILES: \$\{\{ needs\.army-select\.outputs\.full_only_files \}\}$/mu);
    expect(run).toContain('run: node --import tsx scripts/run-tester-army-ci.ts full ${ARMY_FILES:+--files "$ARMY_FILES"}');
    // One worker, as in the nightly full suite where these journeys are qualified.
    expect(jobs["army-takeoff"]).not.toContain("E2E_ARMY_WORKERS");
  });
});

/** Job bodies of a workflow, by job id, in file order. */
function jobBlocks(workflow: string): Record<string, string> {
  const body = workflow.slice(workflow.search(/^jobs:\s*$/mu));
  const parts = body.split(/^ {2}([A-Za-z0-9_-]+):\s*$/mu).slice(1);
  const jobs: Record<string, string> = {};
  for (let index = 0; index < parts.length; index += 2) jobs[parts[index]] = parts[index + 1];
  return jobs;
}
