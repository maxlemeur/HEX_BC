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
//    leaks the worker count or the build-cache save outside their scope.
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
  globToRegExp,
  listRepositoryFiles,
  loadImpactMap,
  matchesAny,
  selectFromRepository,
  selectJourneys,
  validateImpactMap,
  type ImpactMap,
  type SourceGraph,
} from "../../scripts/tester-army/select-journeys";

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
    ...map.rules.flatMap((rule) => rule.paths.map((glob) => ({ where: `rule ${rule.id}`, glob }))),
  ];
}

function criticalSuiteFromConfig(): string[] {
  return criticalSuiteJourneys(fs.readFileSync(path.join(root, "e2e.config.ts"), "utf8"), files);
}

describe("TesterArmy critical impact map", () => {
  it("is structurally valid and names only existing paths", () => {
    expect(validateImpactMap(map, (file) => fileSet.has(file), criticalSuiteFromConfig())).toEqual([]);
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
    expect(validateImpactMap(map, (file) => fileSet.has(file), [])).toContain(
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

    // A journey edit runs that journey; an anonymous one also needs an
    // authenticated business journey for the runner's proof.
    expect(select(["e2e/army/critical/dpgf-import.e2e.ts"]).files)
      .toEqual([map.suite.setup, "e2e/army/critical/dpgf-import.e2e.ts"].sort());
    expect(select(["e2e/army/critical/auth-rejection.e2e.ts"]).files)
      .toEqual([map.suite.setup, map.suite.anchor, "e2e/army/critical/auth-rejection.e2e.ts"].sort());
  });

  it("routes every fixture a journey reads by path to that journey", () => {
    const forward = new Map<string, Set<string>>();
    for (const [target, importers] of graph.importers) {
      for (const importer of importers) forward.set(importer, new Set([...(forward.get(importer) ?? []), target]));
    }
    const fixtures = files.filter((file) => file.startsWith("e2e/fixtures/") && !file.endsWith("/.gitignore"));
    const misrouted: string[] = [];
    let found = 0;
    for (const journey of map.suite.journeys) {
      // The journey and the critical helpers it imports name the fixtures they
      // read; shared multi-entry harnesses (extended/component-fixture.ts) list
      // every entry, so the journey's own argument is what counts there.
      const reach = new Set<string>();
      const pending = [journey];
      while (pending.length) {
        const file = pending.pop()!;
        if (reach.has(file) || (!file.startsWith("e2e/army/critical/") && file !== journey)) continue;
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

describe("TesterArmy critical workflow wiring", () => {
  const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
  const steps = (workflow: string) => workflow.split(/^\s+- name:/mu).slice(1);

  it("skips the journeys only on an explicit none and keeps workers and cache saves in scope", () => {
    const workflow = read(".github/workflows/e2e-army-critical.yml");
    const all = steps(workflow);
    const selectStep = all.findIndex((step) => /^\s+node .*scripts\/tester-army\/select-journeys\.ts /mu.test(step));
    const install = all.findIndex((step) => /^\s+run: npm ci\b/mu.test(step));
    const journeys = all.find((step) => step.trimStart().startsWith("Run native database and TesterArmy critical journeys"));
    expect(selectStep).toBeGreaterThan(-1);
    expect(selectStep).toBeLessThan(install);
    expect(journeys).toBeDefined();
    // An empty or missing selector output must run the full suite.
    expect(journeys).toContain("if: steps.select.outputs.mode != 'none'");
    expect(journeys).toMatch(/^\s+E2E_ARMY_WORKERS: "2"$/mu);

    for (const file of fs.readdirSync(path.join(root, ".github/workflows"))) {
      const other = read(`.github/workflows/${file}`);
      const count = other.split("E2E_ARMY_WORKERS").length - 1;
      expect(count, file).toBe(file === "e2e-army-critical.yml" ? 1 : 0);
    }

    const saves = all.filter((step) => /uses: actions\/cache\/save@/u.test(step));
    expect(saves.length).toBeGreaterThan(0);
    for (const save of saves) {
      expect(save).toMatch(/if: .*github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/u);
    }
    expect(workflow).not.toMatch(/uses: actions\/cache@/u);
  });
});
