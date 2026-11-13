// @vitest-environment node

// The test filters of the TesterArmy critical configuration and the narrowing of a pull request's selection by
// the decision model (scripts/tester-army/impact-filter.ts, decision-listing.ts, select-journeys.ts
// narrowSelection; docs/testing/tester-army-ci.md, "Filtre par modèle de décision").
//
// A model now removes journeys from a pull request's check. What no campaign can show on demand, each pinned here:
// 1. the runner's impact filter and the army-select job disagree: a journey the job plans is left out by the
//    runner, or a journey the map does not know is left out because no rule names it;
// 2. the model is asked about a change to the shared core or to what the runner loads (dependencies, fixtures,
//    runner, its stack bootstrap, layout, auth, calculation engine, migrations), whose diff says nothing about
//    which journey it reaches; or the job asks it where the filter itself would refuse to judge;
// 3. documentation, unit tests or generated types reach the model: the diff passes the size it accepts and it
//    judges nothing, or it judges on files that cannot change a journey;
// 4. a journey a map rule ties to a changed file is left out because the model rated it low, or because the
//    pull request itself removed it from that rule;
// 5. a weak link (8 to 19 %) or a reason without a rating is treated as "not affected";
// 6. a model failure, a missing key or an unreadable listing removes journeys instead of keeping them all, or
//    a model that did not answer is reported as having left nothing out;
// 7. the narrowed plan loses the login setup or the anchor (the runner refuses a selection without an
//    authenticated business journey, before any stack), keeps a job for journeys that no longer run, or removes
//    a journey the listing did not leave out;
// 8. a listing made for another base, a forced or fail-safe selection, or a push is narrowed all the same;
// 9. (review) the model is asked about a file the shared core loads (money, the server client) or one the map does
//    not know, which the selection by impact runs the whole suite for; a pull request that edits the map beyond its
//    rules (its full, docs or non-runtime globs) hides a file from the guards; the anchor the change itself reaches is
//    dropped once the model leaves out the rest.
import { describe, expect, it } from "vitest";

import { DECISION_FILTER, decisionFromPairs } from "../../scripts/tester-army/decision-listing";
import { DECISION_KEY, DECISION_MIN_PERCENT, armyDecisionFilter, armyImpactFilter } from "../../scripts/tester-army/impact-filter";
import {
  MAP_PATH, buildSourceGraph, classifyPath, decisionSkipped, expandJourneys, listRepositoryFiles, loadImpactMap, mapChangesBeyondRules,
  matchesAny, narrowSelection, selectFromRepository, type DecisionListing, type DecisionSuite, type ImpactMap, type Selection,
} from "../../scripts/tester-army/select-journeys";

const root = process.cwd();
const { map } = loadImpactMap(root);
const repositoryFiles = listRepositoryFiles(root);
const setup = map.suite.setup;
const anchor = map.suite.anchor;
const BASE = "b".repeat(40);

type Candidate = { id: string; file: string; titlePath: string[]; tags: string[] };
const candidate = (file: string, index = 0): Candidate => ({ id: `${file}#${index}`, file, titlePath: [file], tags: ["critical"] });
const context = (files: string[]) => ({
  projectRoot: root, changes: { base: "HEAD", root, files: [...files].sort() }, configFile: "e2e.config.ts",
  signal: new AbortController().signal, log: () => undefined, redact: (text: string) => text,
});

/**
 * A runtime source file that a rule with journeys names, outside the shared core and the non-runtime paths,
 * whose selection by impact on a pull request holds some journeys, not all.
 */
let ruled: { file: string; journeys: string[]; selection: Selection } | undefined;
function ruledFile(): { file: string; journeys: string[]; selection: Selection } {
  if (ruled) return ruled;
  for (const rule of map.rules) {
    const journeys = expandJourneys(map, rule.journeys).filter((journey) => map.suite.journeys.includes(journey) && journey !== setup);
    if (!journeys.length) continue;
    const file = repositoryFiles.find((name) => name.startsWith("src/") && matchesAny(name, rule.paths) && !matchesAny(name, map.full)
      && !matchesAny(name, map.nonRuntime) && !matchesAny(name, map.docs));
    if (!file) continue;
    const selection = selectFromRepository(root, { event: "pull_request", base: BASE, paths: [file], repositoryFiles });
    const authenticated = selection.files.filter((journey) => journey !== setup && journey !== anchor && !map.suite.anonymous.includes(journey));
    if (selection.mode === "files" && authenticated.length > 1) return (ruled = { file, journeys, selection });
  }
  throw new Error("No rule of the impact map names a runtime source file that selects some journeys.");
}

/** A pull request's selection by impact that holds some journeys, not all. */
const partialSelection = (): Selection => structuredClone(ruledFile().selection);
/** The same change, selecting every journey as an unmapped entry point would: full, and still the model's to narrow. */
const fullSelection = (): Selection => ({ ...partialSelection(), mode: "full", reason: "1 path(s) require the full suite", files: [],
  fullOnly: { mode: "all", reason: "every full-only journey", files: [setup, ...map.fullOnly.journeys].sort() } });
const suite = (files: string[] = [], failure: string | null = null): DecisionSuite => ({
  judged: files.length, leftOut: files.map((file) => ({ file, reason: "5% likely affected" })), notes: ["army-decision kept 0 of 9 tests, left out 9"], failure });
const listing = (overrides: Partial<DecisionListing> = {}): DecisionListing => ({
  schemaVersion: "army-decision-1", model: "gpt-6-luna", minPercent: DECISION_MIN_PERCENT, base: BASE, critical: suite(), takeoff: null, ...overrides,
});

describe("the runner's impact filter", () => {
  it("leaves out exactly the journeys the army-select job does not plan, and none the map does not know", () => {
    const { file } = ruledFile();
    const selection = selectFromRepository(root, { event: "pull_request", paths: [file], repositoryFiles });
    expect(selection.mode).toBe("files");
    const unknown = "e2e/army/critical/not-in-the-map.e2e.ts";
    const journeys = [...map.suite.journeys, ...map.fullOnly.journeys, unknown];
    const result = armyImpactFilter.filter(journeys.map((journey) => candidate(journey)), context([file]));
    const planned = new Set([...selection.files, ...selection.fullOnly.files]);
    expect(Object.keys(result.exclude).sort()).toEqual(journeys.filter((journey) => journey !== unknown && !planned.has(journey)).map((journey) => `${journey}#0`).sort());
    expect(Object.keys(result.exclude).length).toBeGreaterThan(0);
    expect(result.exclude[`${setup}#0`]).toBeUndefined();
    expect(result.note).toContain(selection.reason);
  });

  it("leaves nothing out when the selection is the full suite", () => {
    const result = armyImpactFilter.filter(map.suite.journeys.map((journey) => candidate(journey)), context(["package.json"]));
    expect(result.exclude).toEqual({});
    expect(result.note).toMatch(/^every journey runs: /u);
  });
});

describe("the decision filter behind its guards", () => {
  const journeys = map.suite.journeys.filter((journey) => journey !== setup);
  const recording = (exclude: Record<string, string> = {}) => {
    const calls: string[][] = [];
    const filter = armyDecisionFilter(async () => ({ name: "stock", filter: (_tests, given) => { calls.push([...given.changes.files]); return { exclude, note: "stock note" }; } }));
    return { calls, filter };
  };

  it("does not ask the model about the shared core, what the runner loads, or a change without a runtime file", async () => {
    const { file } = ruledFile();
    // Every `full` glob of the map names at least one of these, and the runner loads the last two itself.
    const loadedByRunner = [...buildSourceGraph(root, map).runnerClosure].filter((name) => !matchesAny(name, map.full));
    expect(loadedByRunner).toEqual(expect.arrayContaining(["src/test/local-supabase-ci.ts"]));
    const first = (glob: string) => repositoryFiles.find((name) => matchesAny(name, [glob]))!;
    const core = [
      "scripts/run-tester-army-ci.ts", "package-lock.json", "e2e/army/critical/fixtures.ts", ".github/workflows/e2e-army-critical.yml", "e2e.config.ts",
      first("supabase/migrations/**"), "src/app/layout.tsx", first("src/lib/auth/**"), "src/lib/estimate-calculations.ts",
      "src/types/database.ts", "src/test/local-supabase-ci.ts", "src/types/database.generated.ts",
    ];
    expect(core.every((name) => repositoryFiles.includes(name)), core.join(" ")).toBe(true);
    for (const changed of core) {
      const { calls, filter } = recording({ [`${journeys[0]}#0`]: "0% likely affected" });
      const result = await filter.filter([candidate(journeys[0])], context([file, changed]));
      expect(calls, changed).toEqual([]);
      expect(result.exclude, changed).toEqual({});
      expect(result.note, changed).toContain(`the model judges nothing: ${changed} runs every journey`);
      // The army-select job agrees and does not even install: its selection says the model is not asked.
      const selection = selectFromRepository(root, { event: "pull_request", base: BASE, paths: [file, changed], repositoryFiles });
      expect(decisionSkipped(selection), changed).toContain(`${changed} runs every journey`);
    }
    const { calls, filter } = recording({ [`${journeys[0]}#0`]: "0% likely affected" });
    const idle = await filter.filter([candidate(journeys[0])], context(["docs/testing/tester-army-ci.md", "src/lib/estimates/gating.test.ts"]));
    expect(calls).toEqual([]);
    expect(idle).toEqual({ exclude: {}, note: "the model judges nothing: no runtime file changed" });
    expect(decisionSkipped(partialSelection())).toBeNull();
  });

  it("does not ask the model about a file the shared core loads, nor about one the map does not know", async () => {
    const { file } = ruledFile();
    const graph = buildSourceGraph(root, map);
    const sources = repositoryFiles.filter((name) => name.startsWith("src/") && !matchesAny(name, map.full)
      && !matchesAny(name, map.nonRuntime) && !matchesAny(name, map.docs) && !graph.runnerClosure.has(name));
    const decisions = sources.map((name) => classifyPath(map, graph, name, "pull_request"));
    const loaded = decisions.find((decision) => decision.class === "full" && decision.reason.startsWith("loaded by the shared core"));
    const unmapped = decisions.find((decision) => decision.class === "unmapped");
    expect(loaded, "a source file the shared core loads").toBeDefined();
    for (const changed of [loaded!, unmapped].filter((decision) => decision !== undefined).map((decision) => decision!.path)) {
      const { calls, filter } = recording({ [`${journeys[0]}#0`]: "0% likely affected" });
      const result = await filter.filter([candidate(journeys[0])], context([file, changed]));
      expect(calls, changed).toEqual([]);
      expect(result.exclude, changed).toEqual({});
      expect(result.note, changed).toContain(`the model judges nothing: ${changed} runs every journey`);
      const selection = selectFromRepository(root, { event: "pull_request", base: BASE, paths: [file, changed], repositoryFiles });
      expect(decisionSkipped(selection), changed).toContain(`${changed} runs every journey`);
    }
  });

  it("names what a map edit changes beyond its rules, which the model then does not judge", () => {
    const before = structuredClone(map) as ImpactMap;
    const rulesOnly = structuredClone(map) as ImpactMap;
    rulesOnly.rules = [...rulesOnly.rules, { id: "review-only-rule", paths: ["src/review-only/**"], journeys: [] }];
    expect(mapChangesBeyondRules(before, rulesOnly)).toEqual([]);
    const widened = structuredClone(map) as ImpactMap;
    widened.nonRuntime = [...widened.nonRuntime, "src/lib/money.ts"];
    widened.full = widened.full.slice(1);
    expect(mapChangesBeyondRules(before, widened)).toEqual(["full", "nonRuntime"]);
  });

  it("shows the model only what can change the application, a changed journey file included", async () => {
    const { file } = ruledFile();
    const journey = map.suite.journeys.find((name) => name.startsWith("e2e/army/local/"))!;
    const { calls, filter } = recording();
    await filter.filter([candidate(journeys[0])], context([
      file, journey, "docs/metier/cycle-de-vie.md", "src/lib/estimates/gating.test.ts", "scripts/tester-army/army-shards.json",
    ]));
    expect(calls).toEqual([[file, journey].sort()]);
  });

  it("keeps a journey a map rule ties to a changed file, a rating at the threshold and a reason it cannot read", async () => {
    const { file, journeys: tied } = ruledFile();
    const others = journeys.filter((journey) => !tied.includes(journey));
    const [low, weak, unrated, decimal] = others;
    const { filter } = recording({
      [`${tied[0]}#0`]: "0% likely affected",
      [`${low}#0`]: `${DECISION_MIN_PERCENT - 1}% likely affected`,
      [`${weak}#0`]: `${DECISION_MIN_PERCENT}% likely affected`,
      [`${unrated}#0`]: "the test file is unchanged",
      [`${decimal}#0`]: "7.9% likely affected",
      "not-a-test-of-this-run": "0% likely affected",
    });
    const result = await filter.filter([tied[0], low, weak, unrated, decimal].map((journey) => candidate(journey)), context([file]));
    expect(result.exclude).toEqual({ [`${low}#0`]: `${DECISION_MIN_PERCENT - 1}% likely affected`, [`${decimal}#0`]: "7.9% likely affected" });
    expect(result.note).toBe("stock note; 1 test(s) kept: a map rule ties their journey to a changed file; " +
      `2 test(s) kept: rated ${DECISION_MIN_PERCENT} % or more, or without a rating`);
  });

  it("counts the rules of the base when the pull request edits the map, and judges nothing when the base cannot be read", async () => {
    const { file, journeys: tied } = ruledFile();
    // The map of HEAD is the base here: the journeys it ties to the file stay, whatever the working tree's map says.
    const { calls, filter } = recording({ [`${tied[0]}#0`]: "0% likely affected" });
    const kept = await filter.filter([candidate(tied[0])], context([file, MAP_PATH]));
    expect(calls).toEqual([[file]]);
    expect(kept.exclude).toEqual({});
    const unreadable = recording({ [`${tied[0]}#0`]: "0% likely affected" });
    const refused = await unreadable.filter.filter([candidate(tied[0])], { ...context([file, MAP_PATH]), changes: { base: "0".repeat(40), root, files: [file, MAP_PATH].sort() } });
    expect(unreadable.calls).toEqual([]);
    expect(refused).toEqual({ exclude: {}, note: "the model judges nothing: the impact map changed and its base version cannot be read" });
  });

  it("throws, so that the runner leaves nothing out, when the model fails or its key is missing", async () => {
    const { file } = ruledFile();
    const failing = armyDecisionFilter(async () => ({ name: "stock", filter: () => { throw new Error("model unavailable"); } }));
    await expect(failing.filter([candidate(journeys[0])], context([file]))).rejects.toThrow("model unavailable");
    const key = process.env[DECISION_KEY];
    delete process.env[DECISION_KEY];
    try {
      await expect(armyDecisionFilter().filter([candidate(journeys[0])], context([file]))).rejects.toThrow(`${DECISION_KEY} is not set`);
    } finally {
      if (key !== undefined) process.env[DECISION_KEY] = key;
    }
  });
});

describe("the journey files a listing shows the model left out", () => {
  const pairs = [
    { file: "a.e2e.ts", disposition: "filtered", filter: DECISION_FILTER, reason: "2% likely affected" },
    { file: "a.e2e.ts", disposition: "filtered", filter: DECISION_FILTER, reason: "6% likely affected" },
    { file: "b.e2e.ts", disposition: "filtered", filter: DECISION_FILTER, reason: "5% likely affected" },
    { file: "b.e2e.ts", disposition: "run" },
    { file: "c.e2e.ts", disposition: "filtered", filter: "army-impact", reason: "3 of 84 journey files selected" },
    { file: "d.e2e.ts", disposition: "run" },
    { file: "e.e2e.ts", disposition: "skipped" },
  ];

  it("names a file only when the model left out every test of it", () => {
    expect(decisionFromPairs(pairs, ["judging 3 files changed since abc", "army-decision kept 2 of 5 tests, left out 3 (1 call)", "an unrelated line"])).toEqual({
      judged: 3, leftOut: [{ file: "a.e2e.ts", reason: "6% likely affected" }],
      notes: ["judging 3 files changed since abc", "army-decision kept 2 of 5 tests, left out 3 (1 call)"], failure: null,
    });
    expect(decisionFromPairs(pairs, ["army-decision left out all 5 tests (2 calls)"]).failure).toBeNull();
  });

  it("says the model did not answer when the runner warns about the filter or gives no account of it", () => {
    const warning = "warning: army-decision failed, so it leaves nothing out: 401 Incorrect API key";
    expect(decisionFromPairs([{ file: "d.e2e.ts", disposition: "run" }], ["army-impact kept all 1 test", warning])).toEqual({
      judged: 1, leftOut: [], notes: ["army-impact kept all 1 test", warning], failure: warning });
    expect(decisionFromPairs([{ file: "d.e2e.ts", disposition: "run" }], ["army-impact kept all 1 test"]).failure)
      .toBe("the runner printed no account of the army-decision filter");
    expect(decisionFromPairs([], []).failure).toBe("the runner printed no account of the army-decision filter");
  });
});

describe("a selection narrowed by the decision model", () => {
  const covered = (selection: Selection) => [...new Set(selection.shards.shards.flatMap((shard) => shard.files))].sort();
  const journeysOf = (selection: Selection) => selection.files.filter((file) => file !== setup);

  it("removes exactly the journeys left out, keeps the login setup and plans jobs for what remains", () => {
    const selection = partialSelection();
    const journeys = journeysOf(selection).filter((journey) => journey !== anchor);
    const dropped = journeys.slice(1);
    const narrowed = narrowSelection({ map, selection, listing: listing({ critical: suite([...dropped, setup, "e2e/army/critical/never-selected.e2e.ts"]) }) });
    expect(narrowed.mode).toBe("files");
    expect(narrowed.files).toEqual(selection.files.filter((file) => !dropped.includes(file)));
    expect(narrowed.files).toEqual(expect.arrayContaining([journeys[0], setup]));
    expect(covered(narrowed)).toEqual(narrowed.files);
    expect(narrowed.shards.shards.length).toBeLessThanOrEqual(selection.shards.shards.length);
    expect(narrowed.reason).toContain(`the decision model left out ${dropped.length}`);
    expect(narrowed.decision).toMatchObject({ applied: true, model: "gpt-6-luna", minPercent: DECISION_MIN_PERCENT,
      leftOut: dropped.map((file) => ({ suite: "critical", file, reason: "5% likely affected" })) });
    // The selection by impact is not modified in place.
    expect(selection.files).toContain(dropped[0]);
  });

  it("never removes the anchor beside other journeys, adds it for anonymous ones, and starts no job for it alone", () => {
    const full = fullSelection();
    // The hub's fresh start uses no session of its own: left alone with the setup, the runner refuses the run.
    const lone = map.suite.journeys.find((journey) => journey !== setup && journey !== anchor && !map.suite.anonymous.includes(journey))!;
    const kept = narrowSelection({ map, selection: full, listing: listing({ critical: suite(map.suite.journeys.filter((journey) => journey !== lone)) }) });
    expect(kept.files).toEqual([anchor, lone, setup].sort());
    expect(kept.decision?.leftOut.map((entry) => entry.file)).not.toContain(anchor);
    expect(covered(kept)).toEqual(kept.files);

    const anonymous = map.suite.anonymous[0];
    const anonymousOnly = narrowSelection({ map, selection: { ...full, mode: "files", files: [anonymous, lone, setup].sort() },
      listing: listing({ critical: suite([lone]) }) });
    expect(anonymousOnly.files).toEqual([anonymous, anchor, setup].sort());

    const none = narrowSelection({ map, selection: full, listing: listing({ critical: suite(map.suite.journeys) }) });
    expect(none).toMatchObject({ mode: "none", files: [] });
    expect(none.shards.shards).toEqual([]);
    expect(none.reason).toContain("no critical journey runs");
    const partial = partialSelection();
    expect(narrowSelection({ map, selection: partial, listing: listing({ critical: suite(journeysOf(partial)) }) })).toMatchObject({ mode: "none", files: [] });

    // Review: when the change itself reaches the anchor, it is no mere companion and still runs alone with the setup.
    const reached = partialSelection();
    reached.files = [...new Set([...reached.files, anchor])].sort();
    reached.changedPaths = reached.changedPaths.map((decision) => decision.class === "journeys"
      ? { ...decision, journeys: [...new Set([...(decision.journeys ?? []), anchor])].sort() } : decision);
    const anchorKept = narrowSelection({ map, selection: reached, listing: listing({ critical: suite(journeysOf(reached)) }) });
    expect(anchorKept).toMatchObject({ mode: "files", files: [anchor, setup].sort() });
    expect(covered(anchorKept)).toEqual(anchorKept.files);
  });

  it("narrows the full-only journeys from their own listing, and leaves a selection the model did not touch as it is", () => {
    const full = fullSelection();
    const fullOnly = full.fullOnly.files.filter((file) => file !== setup);
    expect(fullOnly.length).toBeGreaterThan(1);
    const narrowed = narrowSelection({ map, selection: full, listing: listing({ takeoff: suite(fullOnly.slice(1)) }) });
    expect(narrowed.mode).toBe("full");
    expect(narrowed.fullOnly).toMatchObject({ mode: "files", files: [fullOnly[0], setup].sort() });
    expect([...new Set(narrowed.takeoffShards.shards.flatMap((shard) => shard.files))].sort()).toEqual(narrowed.fullOnly.files);
    const emptied = narrowSelection({ map, selection: full, listing: listing({ takeoff: suite(fullOnly) }) });
    expect(emptied.fullOnly).toMatchObject({ mode: "none", files: [] });
    expect(emptied.takeoffShards.shards).toEqual([]);

    const untouched = narrowSelection({ map, selection: full, listing: listing() });
    expect({ ...untouched, decision: undefined }).toEqual({ ...full, decision: undefined });
    expect(untouched.decision).toMatchObject({ applied: true, leftOut: [], reason: "the decision model left out no journey file" });
  });

  it("keeps the selection by impact for another base, an unreadable listing, a silent model, a forced, fail-safe or shared-core selection and a push", () => {
    const selection = partialSelection();
    const everything = suite(journeysOf(selection));
    const forced = selectFromRepository(root, { event: "pull_request", base: BASE, paths: [ruledFile().file], forceFull: "label army-full", repositoryFiles });
    const core = selectFromRepository(root, { event: "pull_request", base: BASE, paths: [ruledFile().file, "package.json"], repositoryFiles });
    const refused: Array<[label: string, given: Selection, listed: unknown, reason: string]> = [
      ["another base", selection, listing({ base: "c".repeat(40), critical: everything }), "judged the change since"],
      ["no listing", selection, null, "the decision listing is unreadable"],
      ["another schema", selection, { ...listing({ critical: everything }), schemaVersion: "army-decision-0" }, "unreadable"],
      ["a malformed suite", selection, { ...listing(), critical: { judged: 1, leftOut: [{ file: 3 }], notes: [], failure: null } }, "unreadable"],
      ["a suite without its failure field", selection, { ...listing(), critical: { judged: 1, leftOut: [], notes: [] } }, "unreadable"],
      ["a model that did not answer", selection, listing({ critical: suite(journeysOf(selection), "warning: army-decision failed, so it leaves nothing out: 401") }), "the decision model did not answer: warning: army-decision failed"],
      ["a silent takeoff listing", selection, listing({ critical: everything, takeoff: suite([], "the runner printed no account of the army-decision filter") }), "the decision model did not answer"],
      ["a forced full suite", forced, listing({ critical: suite(map.suite.journeys) }), "full suite forced: label army-full"],
      ["the shared core", core, listing({ critical: suite(map.suite.journeys) }), "package.json runs every journey"],
      ["a fail-safe", { ...selection, mode: "full", reason: "fail-safe: Invalid impact map" }, listing({ critical: everything }), "fail-safe"],
      ["a push", { ...selection, event: "push" }, listing({ critical: everything }), "only a pull request is narrowed"],
      ["no base", { ...selection, base: null }, listing({ critical: everything }), "no base commit"],
    ];
    for (const [label, given, listed, reason] of refused) {
      const narrowed = narrowSelection({ map, selection: given, listing: listed });
      expect(narrowed.decision, label).toMatchObject({ applied: false, leftOut: [] });
      expect(narrowed.decision?.reason, label).toContain(reason);
      expect({ ...narrowed, decision: undefined }, label).toEqual({ ...given, decision: undefined });
    }
  });
});
