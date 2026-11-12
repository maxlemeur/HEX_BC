// @vitest-environment node

// The test filters of the TesterArmy critical configuration and the narrowing of a pull request's selection by
// the decision model (scripts/tester-army/impact-filter.ts, decision-listing.ts, select-journeys.ts
// narrowSelection; docs/testing/tester-army-ci.md, "Filtre par modèle de décision").
//
// A model now removes journeys from a pull request's check. What no campaign can show on demand, each pinned here:
// 1. the runner's impact filter and the army-select job disagree: a journey the job plans is left out by the
//    runner, or a journey the map does not know is left out because no rule names it;
// 2. the model is asked about a change to the test infrastructure (runner, fixtures, dependencies, workflows),
//    whose diff says nothing about which journey it reaches;
// 3. documentation, unit tests or generated types reach the model: the diff passes the size it accepts and it
//    judges nothing, or it judges on files that cannot change a journey;
// 4. a journey a map rule ties to a changed file is left out because the model rated it low;
// 5. a weak link (8 to 19 %) or a reason without a rating is treated as "not affected";
// 6. a model failure, a missing key or an unreadable listing removes journeys instead of keeping them all;
// 7. the narrowed plan loses the login setup, runs without an authenticated business journey, keeps a job for
//    journeys that no longer run, or removes a journey the listing did not leave out;
// 8. a listing made for another base, a forced or fail-safe selection, or a push is narrowed all the same.
import { describe, expect, it } from "vitest";

import { DECISION_FILTER, decisionFromPairs } from "../../scripts/tester-army/decision-listing";
import { DECISION_INFRASTRUCTURE, DECISION_KEY, DECISION_MIN_PERCENT, armyDecisionFilter, armyImpactFilter } from "../../scripts/tester-army/impact-filter";
import {
  expandJourneys, listRepositoryFiles, loadImpactMap, matchesAny, narrowSelection, selectFromRepository,
  type DecisionListing, type Selection,
} from "../../scripts/tester-army/select-journeys";

const root = process.cwd();
const { map } = loadImpactMap(root);
const repositoryFiles = listRepositoryFiles(root);
const setup = map.suite.setup;

type Candidate = { id: string; file: string; titlePath: string[]; tags: string[] };
const candidate = (file: string, index = 0): Candidate => ({ id: `${file}#${index}`, file, titlePath: [file], tags: ["critical"] });
const context = (files: string[]) => ({
  projectRoot: root, changes: { base: "b".repeat(40), root, files: [...files].sort() }, configFile: "e2e.config.ts",
  signal: new AbortController().signal, log: () => undefined, redact: (text: string) => text,
});

/**
 * A runtime source file that a rule with journeys names, that no infrastructure or non-runtime glob does, and
 * whose selection by impact on a pull request holds some journeys, not all.
 */
let ruled: { file: string; journeys: string[]; selection: Selection } | undefined;
function ruledFile(): { file: string; journeys: string[]; selection: Selection } {
  if (ruled) return ruled;
  for (const rule of map.rules) {
    const journeys = expandJourneys(map, rule.journeys).filter((journey) => map.suite.journeys.includes(journey) && journey !== setup);
    if (!journeys.length) continue;
    const file = repositoryFiles.find((name) => name.startsWith("src/") && matchesAny(name, rule.paths) && !matchesAny(name, map.full)
      && !matchesAny(name, map.nonRuntime) && !matchesAny(name, map.docs) && !matchesAny(name, DECISION_INFRASTRUCTURE));
    if (!file) continue;
    const selection = selectFromRepository(root, { event: "pull_request", base: "b".repeat(40), paths: [file], repositoryFiles });
    const authenticated = selection.files.filter((journey) => journey !== setup && !map.suite.anonymous.includes(journey));
    if (selection.mode === "files" && authenticated.length > 1) return (ruled = { file, journeys, selection });
  }
  throw new Error("No rule of the impact map names a runtime source file that selects some journeys.");
}

/** A pull request's selection by impact that holds some journeys, not all. */
const partialSelection = (): Selection => structuredClone(ruledFile().selection);
const listing = (overrides: Partial<DecisionListing> = {}): DecisionListing => ({
  schemaVersion: "army-decision-1", model: "gpt-6-luna", minPercent: DECISION_MIN_PERCENT, base: "b".repeat(40),
  critical: { judged: 0, leftOut: [], notes: [] }, takeoff: null, ...overrides,
});
const leftOut = (files: string[]) => ({ judged: files.length, leftOut: files.map((file) => ({ file, reason: "5% likely affected" })), notes: ["army-decision kept 0 tests"] });

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

  it("does not ask the model about a change to the test infrastructure or one without a runtime file", async () => {
    const { file } = ruledFile();
    for (const infrastructure of ["scripts/run-tester-army-ci.ts", "package-lock.json", "e2e/army/critical/fixtures.ts", ".github/workflows/e2e-army-critical.yml", "e2e.config.ts"]) {
      const { calls, filter } = recording({ [`${journeys[0]}#0`]: "0% likely affected" });
      const result = await filter.filter([candidate(journeys[0])], context([file, infrastructure]));
      expect(calls, infrastructure).toEqual([]);
      expect(result.exclude, infrastructure).toEqual({});
      expect(result.note, infrastructure).toContain(`${infrastructure} changes how the journeys run`);
    }
    const { calls, filter } = recording({ [`${journeys[0]}#0`]: "0% likely affected" });
    const idle = await filter.filter([candidate(journeys[0])], context(["docs/testing/tester-army-ci.md", "src/lib/estimates/gating.test.ts"]));
    expect(calls).toEqual([]);
    expect(idle).toEqual({ exclude: {}, note: "the model judges nothing: no runtime file changed" });
  });

  it("shows the model only what can change the application, a changed journey file included", async () => {
    const { file } = ruledFile();
    const journey = map.suite.journeys.find((name) => name.startsWith("e2e/army/local/"))!;
    const { calls, filter } = recording();
    await filter.filter([candidate(journeys[0])], context([
      file, journey, "docs/metier/cycle-de-vie.md", "src/lib/estimates/gating.test.ts", "src/types/database.generated.ts",
      "scripts/tester-army/army-impact-map.json", "scripts/tester-army/army-shards.json",
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
  it("names a file only when the model left out every test of it", () => {
    const pairs = [
      { file: "a.e2e.ts", disposition: "filtered", filter: DECISION_FILTER, reason: "2% likely affected" },
      { file: "a.e2e.ts", disposition: "filtered", filter: DECISION_FILTER, reason: "6% likely affected" },
      { file: "b.e2e.ts", disposition: "filtered", filter: DECISION_FILTER, reason: "5% likely affected" },
      { file: "b.e2e.ts", disposition: "run" },
      { file: "c.e2e.ts", disposition: "filtered", filter: "army-impact", reason: "3 of 84 journey files selected" },
      { file: "d.e2e.ts", disposition: "run" },
      { file: "e.e2e.ts", disposition: "skipped" },
    ];
    expect(decisionFromPairs(pairs, ["judging 3 files changed since abc", "army-decision kept 2 of 5 tests", "an unrelated warning"])).toEqual({
      judged: 3, leftOut: [{ file: "a.e2e.ts", reason: "6% likely affected" }],
      notes: ["judging 3 files changed since abc", "army-decision kept 2 of 5 tests"],
    });
    expect(decisionFromPairs([], [])).toEqual({ judged: 0, leftOut: [], notes: [] });
  });
});

describe("a selection narrowed by the decision model", () => {
  const covered = (selection: Selection) => [...new Set(selection.shards.shards.flatMap((shard) => shard.files))].sort();

  it("removes exactly the journeys left out, keeps the login setup and plans jobs for what remains", () => {
    const selection = partialSelection();
    const journeys = selection.files.filter((file) => file !== setup);
    const authenticated = journeys.filter((journey) => !map.suite.anonymous.includes(journey));
    expect(authenticated.length).toBeGreaterThan(1);
    const dropped = journeys.filter((journey) => journey !== authenticated[0]);
    const narrowed = narrowSelection({ map, selection, listing: listing({ critical: leftOut([...dropped, setup, "e2e/army/critical/never-selected.e2e.ts"]) }) });
    expect(narrowed.mode).toBe("files");
    expect(narrowed.files).toEqual([authenticated[0], setup].sort());
    expect(covered(narrowed)).toEqual(narrowed.files);
    expect(narrowed.shards.shards.length).toBeLessThanOrEqual(selection.shards.shards.length);
    expect(narrowed.reason).toContain(`the decision model left out ${dropped.length}`);
    expect(narrowed.decision).toMatchObject({ applied: true, model: "gpt-6-luna", minPercent: DECISION_MIN_PERCENT,
      leftOut: dropped.map((file) => ({ suite: "critical", file, reason: "5% likely affected" })) });
    // The selection by impact is not modified in place.
    expect(selection.files).toContain(dropped[0]);
  });

  it("starts no job when every journey is left out, and adds the anchor when only anonymous journeys remain", () => {
    const selection = partialSelection();
    const journeys = selection.files.filter((file) => file !== setup);
    const none = narrowSelection({ map, selection, listing: listing({ critical: leftOut(journeys) }) });
    expect(none).toMatchObject({ mode: "none", files: [] });
    expect(none.shards.shards).toEqual([]);

    const full = selectFromRepository(root, { event: "pull_request", base: "b".repeat(40), paths: ["package.json"], repositoryFiles });
    expect(full.mode).toBe("full");
    const anonymous = map.suite.anonymous[0];
    const anonymousOnly = narrowSelection({ map, selection: full,
      listing: listing({ critical: leftOut(map.suite.journeys.filter((journey) => journey !== anonymous)) }) });
    expect(anonymousOnly.mode).toBe("files");
    expect(anonymousOnly.files).toEqual([anonymous, map.suite.anchor, setup].sort());
    expect(covered(anonymousOnly)).toEqual(anonymousOnly.files);
  });

  it("narrows the full-only journeys from their own listing, and leaves a selection the model did not touch as it is", () => {
    const full = selectFromRepository(root, { event: "pull_request", base: "b".repeat(40), paths: ["package.json"], repositoryFiles });
    const fullOnly = full.fullOnly.files.filter((file) => file !== setup);
    expect(fullOnly.length).toBeGreaterThan(1);
    const narrowed = narrowSelection({ map, selection: full, listing: listing({ takeoff: leftOut(fullOnly.slice(1)) }) });
    expect(narrowed.mode).toBe("full");
    expect(narrowed.fullOnly).toMatchObject({ mode: "files", files: [fullOnly[0], setup].sort() });
    expect([...new Set(narrowed.takeoffShards.shards.flatMap((shard) => shard.files))].sort()).toEqual(narrowed.fullOnly.files);
    const emptied = narrowSelection({ map, selection: full, listing: listing({ takeoff: leftOut(fullOnly) }) });
    expect(emptied.fullOnly).toMatchObject({ mode: "none", files: [] });
    expect(emptied.takeoffShards.shards).toEqual([]);

    const untouched = narrowSelection({ map, selection: full, listing: listing() });
    expect({ ...untouched, decision: undefined }).toEqual({ ...full, decision: undefined });
    expect(untouched.decision).toMatchObject({ applied: true, leftOut: [], reason: "the decision model left out no journey file" });
  });

  it("keeps the selection by impact for another base, an unreadable listing, a forced or fail-safe selection and a push", () => {
    const selection = partialSelection();
    const journeys = selection.files.filter((file) => file !== setup);
    const refused: Array<[label: string, narrowed: Selection, reason: string]> = [
      ["another base", narrowSelection({ map, selection, listing: listing({ base: "c".repeat(40), critical: leftOut(journeys) }) }), "judged the change since"],
      ["no listing", narrowSelection({ map, selection, listing: null }), "the decision listing is unreadable"],
      ["another schema", narrowSelection({ map, selection, listing: { ...listing({ critical: leftOut(journeys) }), schemaVersion: "army-decision-0" } }), "unreadable"],
      ["a malformed suite", narrowSelection({ map, selection, listing: { ...listing(), critical: { judged: 1, leftOut: [{ file: 3 }], notes: [] } } }), "unreadable"],
      ["a forced full suite", narrowSelection({ map, listing: listing({ critical: leftOut(journeys) }),
        selection: selectFromRepository(root, { event: "pull_request", base: "b".repeat(40), paths: [ruledFile().file], forceFull: "label army-full", repositoryFiles }) }), "full suite forced: label army-full"],
      ["a fail-safe", narrowSelection({ map, selection: { ...selection, mode: "full", reason: "fail-safe: Invalid impact map" }, listing: listing({ critical: leftOut(journeys) }) }), "fail-safe"],
      ["a push", narrowSelection({ map, selection: { ...selection, event: "push" }, listing: listing({ critical: leftOut(journeys) }) }), "only a pull request is narrowed"],
      ["no base", narrowSelection({ map, selection: { ...selection, base: null }, listing: listing({ critical: leftOut(journeys) }) }), "no base commit"],
    ];
    for (const [label, narrowed, reason] of refused) {
      expect(narrowed.decision, label).toMatchObject({ applied: false, leftOut: [] });
      expect(narrowed.decision?.reason, label).toContain(reason);
      expect({ ...narrowed, decision: undefined }, label).toEqual({ ...narrowed, decision: undefined, files: narrowed.files });
      expect(narrowed.shards, label).toEqual(label === "a forced full suite" ? narrowed.shards : selection.shards);
      if (!["a forced full suite", "a fail-safe"].includes(label)) expect(narrowed.files, label).toEqual(selection.files);
    }
  });
});
