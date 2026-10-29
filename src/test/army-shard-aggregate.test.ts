// Guard of the aggregation of parallel TesterArmy jobs
// (scripts/tester-army/aggregate-shards.ts, docs/testing/tester-army-ci.md).
//
// A sharded run is green only through its aggregate job (army-critical,
// army-takeoff, army-full, army-calc-v3): the check name branch tooling and watchers read.
// The CI can only show the happy path; these are the failures it cannot
// produce on demand, each of which would otherwise turn a partial run into a
// green check:
// 1. a planned shard (or the development job, or a calc-v3 phase) left no
//    evidence: its job was skipped, cancelled, timed out or never uploaded;
// 2. a job the aggregate depends on did not succeed (plan, shards), or shards
//    ran although the selection was an explicit "none";
// 3. a shard ran other files than planned (one missing, one extra), two
//    shards ran the same file, or the shards together miss part of the
//    selection (a plan that does not cover it);
// 4. a shard is red, failed its privacy check, skipped or interrupted a test,
//    or reports counts that do not add up;
// 5. evidence that is not what the shard wrote: a file whose bytes differ
//    from the shard's own inventory, a file the inventory does not list;
// 6. shards of different revisions or sources, a revision other than the
//    tested commit, a shard directory holding another shard's manifest, or a
//    worker count other than the plan's;
// 7. an unsharded whole-suite plan whose single shard ran a filtered list, or
//    a sharded whole-suite plan that misses a journey the e2e CLI discovers
//    (each shard's report lists every discovered test, unselected ones
//    skipped as outside its positional files);
// 8. the full suite qualified without its development phase, or a filtered
//    (--grep) dispatch recorded as the full suite;
// 9. a calc-v3 phase red, missing, or recorded under another phase;
// 10. a single unit read as missing because actions/download-artifact puts the
//    only artifact a pattern matches directly in its path (no subdirectory;
//    run 39120187109), or a flat download taken for one of several units;
// 11. takeoff shards: a plan that drops a selected full-only journey, shards
//    planned for an explicit "none", a shard that is not the full runner's
//    filtered run of its files, or a fail-safe unsharded run without the
//    development phase its whole full selection includes.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { aggregateEvidence, type AggregateInput } from "../../scripts/tester-army/aggregate-shards";

const root = process.cwd();
const AGGREGATOR = "scripts/tester-army/aggregate-shards.ts";
const SETUP = "e2e/army/critical/auth.setup.e2e.ts";
const REVISION = "a".repeat(40);
const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

let directory: string;
let evidence: string;
let out: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "army-aggregate-"));
  evidence = path.join(directory, "evidence");
  out = path.join(directory, "out");
  fs.mkdirSync(evidence);
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

type UnitOptions = {
  suite: "critical" | "full" | "calc-v3";
  artifact: string;
  scope: string;
  phases: string[];
  /** Report files per phase: the files its selected results ran. */
  ran?: Record<string, string[]>;
  /** Files the e2e CLI also discovered, outside the shard's positional files (unselected, skipped). */
  discovered?: string[];
  journeyFiles?: string[];
  shard?: { index: number; total: number };
  workers?: number;
  extra?: Record<string, unknown>;
  revision?: string;
  calcV3?: { phases: { phase: string; status: string }[] };
  results?: (file: string) => { status: string };
  summary?: Record<string, number>;
};

/** Writes a unit's evidence as the runner does: phase reports, then the inventory, then manifest.json. */
function writeUnit(options: UnitOptions) {
  const unit = path.join(evidence, options.artifact);
  fs.mkdirSync(unit, { recursive: true });
  const write = (relative: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(unit, relative)), { recursive: true });
    fs.writeFileSync(path.join(unit, relative), text);
  };
  write("database.log", "Database pgTAP tests passed.\n");
  for (const phase of options.calcV3 ? [] : options.phases) {
    const files = options.ran?.[phase] ?? [];
    const results = files.map((file) => ({
      file, kind: file === SETUP ? "setup" : "test", selected: true, status: "passed",
      titlePath: [`${file} journey`], tags: ["critical"], targetId: "chromium-desktop", ...(options.results?.(file) ?? {}),
    }));
    const unselected = (options.discovered ?? []).filter((file) => !files.includes(file)).map((file) => ({
      file, kind: "test", selected: false, status: "skipped", skip: { cause: "filtered", reason: "file not selected by a positional argument" },
      titlePath: [`${file} journey`], tags: ["critical"], targetId: "chromium-desktop",
    }));
    const summary = { discovered: results.length + unselected.length, selected: results.length, executed: results.length, passed: results.length,
      failed: 0, interrupted: 0, flaky: 0, skipped: 0, ...(options.summary ?? {}) };
    write(`${phase}/report.json`, `${JSON.stringify({ schemaVersion: 1, run: { exitCode: 0, errors: [], summary, results: [...results, ...unselected] } }, null, 2)}\n`);
  }
  if (options.calcV3) write("calc-v3.json", `${JSON.stringify({ schemaVersion: "calc-v3-campaign-1", ...options.calcV3 }, null, 2)}\n`);
  const inventory: { path: string; sha256: string }[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) walk(file);
      else inventory.push({ path: path.relative(unit, file).replaceAll("\\", "/"), sha256: sha256(fs.readFileSync(file)) });
    }
  };
  walk(unit);
  const manifest = {
    schemaVersion: "army-native-ci-1", suite: options.suite, scope: options.scope, status: "passed", privacy: "passed",
    workers: options.workers ?? (options.suite === "critical" ? 2 : 1),
    ...(options.journeyFiles ? { journeyFiles: options.journeyFiles } : {}),
    ...(options.shard ? { shard: options.shard } : {}),
    source: { revision: options.revision ?? REVISION, diffSha256: sha256(""), inputs: [{ path: "package.json", sha256: sha256("{}") }] },
    phases: options.phases.map((phase) => ({ phase, status: "passed", result: {} })),
    files: inventory,
    ...(options.extra ?? {}),
  };
  write("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  return unit;
}

const A = "e2e/army/critical/a.e2e.ts";
const B = "e2e/army/critical/b.e2e.ts";
const C = "e2e/army/local/c.e2e.ts";

function criticalSelection(overrides: Record<string, unknown> = {}, shards = [[SETUP, A, C], [SETUP, B]]) {
  const files = [...new Set(shards.flat())].sort();
  return {
    schemaVersion: "army-impact-selection-4", event: "pull_request", mode: "files", reason: "test", files,
    shards: {
      schemaVersion: "army-shard-plan-1", suite: "critical", reason: "test", files, workers: 2, durationsSha256: null,
      shards: shards.map((list, index) => ({ shard: index + 1, total: shards.length, files: [...list].sort(), seconds: 10 })),
    },
    ...overrides,
  };
}

function writeCriticalShards(shards = [[SETUP, A, C], [SETUP, B]], options: (index: number) => Partial<UnitOptions> = () => ({})) {
  shards.forEach((list, index) => writeUnit({
    suite: "critical", artifact: `army-critical-shard-${index + 1}-evidence`, scope: "filtered-critical", phases: ["critical"],
    ran: { critical: list }, journeyFiles: [...list].sort(), shard: { index: index + 1, total: shards.length },
    extra: {}, ...options(index + 1),
  }));
}

function critical(selection: unknown, results: Record<string, string> = { "army-select": "success", "army-critical-shard": "success" }): AggregateInput {
  return { suite: "critical", plan: selection, evidence, out, results, revision: REVISION };
}

function problems(input: AggregateInput) {
  const result = aggregateEvidence(input);
  return { status: result.status, problems: result.problems.join("\n") };
}

describe("TesterArmy shard aggregation", () => {
  it("fails when a planned shard left no evidence or a job it depends on did not succeed", () => {
    writeCriticalShards([[SETUP, A, C]]);
    expect(problems(critical(criticalSelection()))).toMatchObject({ status: "failed",
      problems: expect.stringContaining("army-critical-shard-2-evidence") });

    writeCriticalShards();
    for (const [job, result] of [["army-critical-shard", "failure"], ["army-critical-shard", "cancelled"],
      ["army-critical-shard", "skipped"], ["army-select", "failure"]]) {
      const results = { "army-select": "success", "army-critical-shard": "success", [job]: result };
      expect(problems(critical(criticalSelection(), results)), `${job}=${result}`)
        .toMatchObject({ status: "failed", problems: expect.stringContaining(`${job} ${result}`) });
    }
    expect(problems(critical(criticalSelection(), { "army-select": "success" })))
      .toMatchObject({ status: "failed", problems: expect.stringContaining("army-critical-shard") });
  });

  it("fails when a shard ran other files than planned or the shards do not cover the selection", () => {
    // A planned file missing from the shard's run, and an unplanned file in another's report.
    const D = "e2e/army/critical/d.e2e.ts";
    writeCriticalShards([[SETUP, A, C], [SETUP, B]], (index) => index === 1
      ? { ran: { critical: [SETUP, A] }, journeyFiles: [SETUP, A] }
      : { ran: { critical: [SETUP, B, D] } });
    const wrong = problems(critical(criticalSelection()));
    expect(wrong.status).toBe("failed");
    expect(wrong.problems).toContain("shard 1/2 recorded journey files");
    expect(wrong.problems).toContain(`shard 1/2 did not run ${C}`);
    expect(wrong.problems).toContain(`shard 2/2 ran ${D}`);
    expect(wrong.problems).toContain(`missing from every shard: ${C}`);
    expect(wrong.problems).toContain(`outside the plan: ${D}`);

    // A plan that leaves part of the selection out, or gives a file to two shards.
    fs.rmSync(evidence, { recursive: true, force: true });
    writeCriticalShards();
    expect(problems(critical(criticalSelection({ files: [SETUP, A, B, C, "e2e/army/critical/d.e2e.ts"].sort() }))))
      .toMatchObject({ status: "failed", problems: expect.stringContaining("plan does not cover the selection") });
    fs.rmSync(evidence, { recursive: true, force: true });
    writeCriticalShards([[SETUP, A, C], [SETUP, A, B]]);
    expect(problems(critical(criticalSelection({}, [[SETUP, A, C], [SETUP, A, B]]))))
      .toMatchObject({ status: "failed", problems: expect.stringContaining(`planned in 2 shards: ${A}`) });
  });

  it("fails on a red, private, skipped or partial shard", () => {
    const cases: Array<[string, Partial<UnitOptions>]> = [
      ["status failed", { extra: { status: "failed", error: "journeys-critical failed" } }],
      ["privacy failed", { extra: { privacy: "failed" } }],
      ["phase failed", { extra: { phases: [{ phase: "critical", status: "failed" }] } }],
      ["a skipped test", { results: (file) => ({ status: file === A ? "skipped" : "passed" }) }],
      ["counts", { summary: { skipped: 1 } }],
    ];
    for (const [label, options] of cases) {
      fs.rmSync(evidence, { recursive: true, force: true });
      writeCriticalShards(undefined, (index) => (index === 1 ? options : {}));
      expect(problems(critical(criticalSelection())), label).toMatchObject({ status: "failed", problems: expect.stringContaining("shard 1/2") });
    }
  });

  it("fails on evidence that is not the shard's own, on other revisions and on a swapped shard", () => {
    writeCriticalShards();
    const report = path.join(evidence, "army-critical-shard-1-evidence", "critical", "report.json");
    fs.appendFileSync(report, " ");
    expect(problems(critical(criticalSelection()))).toMatchObject({ status: "failed",
      problems: expect.stringContaining("critical/report.json does not match its inventory") });

    fs.rmSync(evidence, { recursive: true, force: true });
    writeCriticalShards();
    fs.writeFileSync(path.join(evidence, "army-critical-shard-2-evidence", "unlisted.txt"), "x");
    expect(problems(critical(criticalSelection()))).toMatchObject({ status: "failed",
      problems: expect.stringContaining("unlisted.txt is not in its inventory") });

    const variants: Array<[string, (index: number) => Partial<UnitOptions>, string]> = [
      ["revision", (index) => (index === 2 ? { revision: "b".repeat(40) } : {}), "revision"],
      ["swapped", (index) => (index === 2 ? { shard: { index: 1, total: 2 } } : {}), "records shard 1/2"],
      ["workers", (index) => (index === 1 ? { workers: 3 } : {}), "3 workers"],
    ];
    for (const [label, options, message] of variants) {
      fs.rmSync(evidence, { recursive: true, force: true });
      writeCriticalShards(undefined, options);
      expect(problems(critical(criticalSelection())), label).toMatchObject({ status: "failed", problems: expect.stringContaining(message) });
    }
    fs.rmSync(evidence, { recursive: true, force: true });
    writeCriticalShards();
    expect(problems({ ...critical(criticalSelection()), revision: "c".repeat(40) }))
      .toMatchObject({ status: "failed", problems: expect.stringContaining("c".repeat(40)) });
  });

  it("claims nothing for an explicit none, and refuses a none whose shards ran", () => {
    const none = criticalSelection({ mode: "none", files: [], shards: { schemaVersion: "army-shard-plan-1", suite: "critical",
      reason: "none", files: [], workers: 2, durationsSha256: null, shards: [] } });
    const result = aggregateEvidence(critical(none, { "army-select": "success", "army-critical-shard": "skipped" }));
    expect(result).toMatchObject({ status: "not-run", problems: [], evidence: null });
    expect(fs.existsSync(out)).toBe(false);
    expect(problems(critical(none, { "army-select": "success", "army-critical-shard": "success" })))
      .toMatchObject({ status: "failed", problems: expect.stringContaining("army-critical-shard success") });
  });

  it("checks a sharded whole suite against the files the e2e CLI discovered in every shard", () => {
    const E = "e2e/army/critical/e.e2e.ts";
    const whole = criticalSelection({ mode: "full", files: [] });
    // The CLI discovers a journey the plan's listing missed: no shard ran it.
    writeCriticalShards(undefined, () => ({ discovered: [SETUP, A, B, C, E] }));
    expect(problems(critical(whole))).toMatchObject({ status: "failed",
      problems: expect.stringContaining(`discovers journeys the plan does not list: ${E}`) });

    fs.rmSync(evidence, { recursive: true, force: true });
    writeCriticalShards(undefined, () => ({ discovered: [SETUP, A, B, C] }));
    const result = aggregateEvidence(critical(whole));
    expect(result.problems).toEqual([]);
    const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
    expect(manifest).toMatchObject({ scope: "critical", union: { discovered: [SETUP, A, B, C].sort() } });

    // A plan file the CLI does not discover (its glob reading differs) is refused too.
    fs.rmSync(evidence, { recursive: true, force: true });
    writeCriticalShards(undefined, () => ({ discovered: [SETUP, A, B] }));
    expect(problems(critical(whole))).toMatchObject({ status: "failed",
      problems: expect.stringContaining(`lists journeys the e2e CLI does not discover: ${C}`) });
  });

  it("reads the flat download of a single planned unit, and only as that unit", () => {
    // One shard: download-artifact extracts the only matching artifact into the path itself.
    const single = criticalSelection({}, [[SETUP, A, C]]);
    writeUnit({ suite: "critical", artifact: "", scope: "filtered-critical", phases: ["critical"], ran: { critical: [SETUP, A, C] },
      journeyFiles: [SETUP, A, C].sort(), shard: { index: 1, total: 1 } });
    const result = aggregateEvidence(critical(single));
    expect(result.problems).toEqual([]);
    expect(fs.existsSync(path.join(out, "units", "army-critical-shard-1-evidence", "manifest.json"))).toBe(true);

    // A flat manifest of another shard is refused by its own identity.
    fs.rmSync(evidence, { recursive: true, force: true });
    writeUnit({ suite: "critical", artifact: "", scope: "filtered-critical", phases: ["critical"], ran: { critical: [SETUP, A, C] },
      journeyFiles: [SETUP, A, C].sort(), shard: { index: 2, total: 2 } });
    expect(problems(critical(single))).toMatchObject({ status: "failed", problems: expect.stringContaining("records shard 2/2") });

    // Two planned shards, one flat artifact: a shard is missing, whichever it is.
    expect(problems(critical(criticalSelection()))).toMatchObject({ status: "failed",
      problems: expect.stringContaining("one artifact, extracted flat, for 2 planned units") });
  });

  it("accepts an unsharded whole-suite plan only from a shard that ran the runner's own selection", () => {
    const whole = criticalSelection({ mode: "full", files: [], shards: { schemaVersion: "army-shard-plan-1", suite: "critical",
      reason: "fail-safe", files: [], workers: 2, durationsSha256: null, shards: [{ shard: 1, total: 1, files: [], seconds: 0 }] } });
    writeUnit({ suite: "critical", artifact: "army-critical-shard-1-evidence", scope: "critical", phases: ["critical"],
      ran: { critical: [SETUP, A, B] }, shard: { index: 1, total: 1 } });
    expect(aggregateEvidence(critical(whole))).toMatchObject({ status: "passed", problems: [] });
    expect(JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8")).scope).toBe("critical");

    fs.rmSync(evidence, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
    writeUnit({ suite: "critical", artifact: "army-critical-shard-1-evidence", scope: "filtered-critical", phases: ["critical"],
      ran: { critical: [SETUP, A] }, journeyFiles: [SETUP, A], shard: { index: 1, total: 1 } });
    expect(problems(critical(whole))).toMatchObject({ status: "failed", problems: expect.stringContaining("scope filtered-critical") });
  });
});

describe("TesterArmy full and calc-v3 aggregation", () => {
  const D = "e2e/army/extended/d.e2e.ts";
  const fullPlan = (development: "separate" | "in-shard" | "none", shards = [[SETUP, A, D], [SETUP, B]]) => ({
    schemaVersion: "army-shard-plan-1", suite: "full", reason: "test", workers: 1, durationsSha256: null, development,
    files: development === "separate" ? [...new Set(shards.flat())].sort() : [],
    shards: development === "separate"
      ? shards.map((list, index) => ({ shard: index + 1, total: shards.length, files: [...list].sort(), seconds: 10 }))
      : [{ shard: 1, total: 1, files: [], seconds: 0 }],
  });
  const fullResults = (development = "success") => ({ "army-full-plan": "success", "army-full-shard": "success", "army-full-development": development });
  const full = (plan: unknown, results = fullResults()): AggregateInput => ({ suite: "full", plan, evidence, out, results, revision: REVISION });
  const writeFullShards = () => [[SETUP, A, D], [SETUP, B]].forEach((list, index) => writeUnit({
    suite: "full", artifact: `army-full-shard-${index + 1}-evidence`, scope: "filtered-full", phases: ["full"], ran: { full: list },
    discovered: [SETUP, A, B, D],
    journeyFiles: [...list].sort(), shard: { index: index + 1, total: 2 },
    extra: { phasesNotRun: { development: "a filtered full run proves only the selected journeys of its production full phase" } },
  }));
  const writeDevelopment = (extra: Record<string, unknown> = {}) => writeUnit({
    suite: "full", artifact: "army-full-development-evidence", scope: "full-development", phases: ["development"],
    ran: { development: [SETUP, "e2e/army/development/team-a-hub.e2e.ts"] },
    extra: { phasesNotRun: { full: "--phase development runs the development phase alone" }, ...extra },
  });

  it("qualifies the sharded full suite only with its development job", () => {
    writeFullShards();
    expect(problems(full(fullPlan("separate")))).toMatchObject({ status: "failed",
      problems: expect.stringContaining("army-full-development-evidence") });
    writeDevelopment({ scope: "full" });
    expect(problems(full(fullPlan("separate")))).toMatchObject({ status: "failed", problems: expect.stringContaining("scope full") });
    fs.rmSync(path.join(evidence, "army-full-development-evidence"), { recursive: true, force: true });
    writeDevelopment();
    expect(problems(full(fullPlan("separate"), fullResults("skipped"))))
      .toMatchObject({ status: "failed", problems: expect.stringContaining("army-full-development skipped") });
    const result = aggregateEvidence(full(fullPlan("separate")));
    expect(result.problems).toEqual([]);
    expect(JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"))).toMatchObject({ suite: "full", scope: "full", status: "passed" });
  });

  it("records a filtered dispatch as filtered, and an unsharded plan with both phases on its stack as the full suite", () => {
    writeUnit({ suite: "full", artifact: "army-full-shard-1-evidence", scope: "filtered-full", phases: ["full"], ran: { full: [SETUP, A] },
      shard: { index: 1, total: 1 }, extra: { grep: "^VNEXT", phasesNotRun: { development: "filtered" } } });
    const filtered = aggregateEvidence(full(fullPlan("none"), fullResults("skipped")));
    expect(filtered.problems).toEqual([]);
    expect(JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8")).scope).toBe("filtered-full");
    // A filtered shard cannot qualify a plan that expects the full suite on one stack.
    expect(problems(full(fullPlan("in-shard"), fullResults("skipped")))).toMatchObject({ status: "failed",
      problems: expect.stringContaining("scope filtered-full") });

    fs.rmSync(evidence, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
    writeUnit({ suite: "full", artifact: "army-full-shard-1-evidence", scope: "full", phases: ["full", "development"],
      ran: { full: [SETUP, A, D], development: [SETUP, "e2e/army/development/team-a-hub.e2e.ts"] }, shard: { index: 1, total: 1 } });
    expect(aggregateEvidence(full(fullPlan("in-shard"), fullResults("skipped")))).toMatchObject({ status: "passed", problems: [] });
    expect(JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8")).scope).toBe("full");
  });

  it("records calc-v3 none only with a successful plan and skipped phases", () => {
    const input: AggregateInput = { suite: "calc-v3", plan: ["none"], evidence, out,
      results: { "army-calc-v3-plan": "success", "army-calc-v3-phase": "skipped" }, revision: REVISION };
    expect(aggregateEvidence(input)).toMatchObject({ status: "not-run" });
    expect(aggregateEvidence({ ...input, results: { ...input.results, "army-calc-v3-plan": "failure" } }).status).toBe("failed");
    expect(aggregateEvidence({ ...input, plan: [] }).status).toBe("failed");
    expect(aggregateEvidence({ ...input, results: { ...input.results, "army-calc-v3-phase": "success" } }).status).toBe("failed");
  });

  it("passes calc-v3 only when every planned phase passed on its own stack", () => {
    const calc = (phases: string[], results = { "army-calc-v3-plan": "success", "army-calc-v3-phase": "success" }): AggregateInput =>
      ({ suite: "calc-v3", plan: phases, evidence, out, results, revision: REVISION });
    const writePhase = (phase: string, status = "passed", recorded = phase) => writeUnit({
      suite: "calc-v3", artifact: `army-calc-v3-${phase}-evidence`, scope: `calc-v3-${phase}`, phases: [],
      extra: { calcV3Phase: phase, calcV3: "calc-v3.json", ...(status === "passed" ? {} : { status }) },
      calcV3: { phases: [{ phase: recorded, status }] },
    });
    writePhase("journeys");
    expect(problems(calc(["journeys", "components"]))).toMatchObject({ status: "failed",
      problems: expect.stringContaining("army-calc-v3-components-evidence") });
    writePhase("components", "failed");
    expect(problems(calc(["journeys", "components"]))).toMatchObject({ status: "failed", problems: expect.stringContaining("components") });
    fs.rmSync(path.join(evidence, "army-calc-v3-components-evidence"), { recursive: true, force: true });
    writePhase("components", "passed", "numeric");
    expect(problems(calc(["journeys", "components"]))).toMatchObject({ status: "failed", problems: expect.stringContaining("numeric") });
    fs.rmSync(path.join(evidence, "army-calc-v3-components-evidence"), { recursive: true, force: true });
    writePhase("components");
    expect(problems(calc(["journeys", "components"], { "army-calc-v3-plan": "success", "army-calc-v3-phase": "failure" })))
      .toMatchObject({ status: "failed", problems: expect.stringContaining("army-calc-v3-phase failure") });
    const result = aggregateEvidence(calc(["journeys", "components"]));
    expect(result.problems).toEqual([]);
    expect(JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8")).units.map((unit: { id: string }) => unit.id))
      .toEqual(["calc-v3 journeys", "calc-v3 components"]);
  });

  it("exits non-zero on a failed aggregate and hands the workflow the evidence directory to retain", () => {
    writeCriticalShards();
    const selection = path.join(directory, "selection.json");
    fs.writeFileSync(selection, JSON.stringify(criticalSelection()));
    const output = path.join(directory, "github-output.txt");
    const run = (results: string) => spawnSync(process.execPath, [AGGREGATOR, "critical", "--plan", selection, "--evidence", evidence,
      "--out", out, "--results", results, "--revision", REVISION], {
      cwd: root, encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: "" }, windowsHide: true,
    });
    const passed = run("army-select=success,army-critical-shard=success");
    expect(passed.status, passed.stderr).toBe(0);
    expect(fs.readFileSync(output, "utf8")).toBe(`evidence=${out}\n`);
    fs.rmSync(out, { recursive: true, force: true });
    fs.rmSync(output);
    const failed = run("army-select=success,army-critical-shard=failure");
    expect(failed.status).toBe(1);
    expect(failed.stdout).toContain("::error title=TesterArmy aggregate::");
    // A failed aggregate still hands over what it gathered, so the evidence is retained.
    expect(fs.readFileSync(output, "utf8")).toBe(`evidence=${out}\n`);
    expect(run("army-select=success").status).toBe(1);
  });
});

describe("TesterArmy takeoff aggregation", () => {
  const T1 = "e2e/army/takeoff/t1.e2e.ts";
  const T2 = "e2e/army/takeoff/t2.e2e.ts";
  const T3 = "e2e/army/takeoff/nested/t3.e2e.ts";
  const ok = { "army-select": "success", "army-takeoff-shard": "success" };

  function takeoffSelection(fullOnly: { mode: string; files: string[] }, shards: string[][]) {
    const files = [...new Set(shards.flat())].sort();
    return {
      schemaVersion: "army-impact-selection-4", event: "pull_request", mode: "none", reason: "test", files: [],
      fullOnly: { reason: "test", ...fullOnly },
      shards: { schemaVersion: "army-shard-plan-1", suite: "critical", reason: "test", files: [], workers: 2, durationsSha256: null, shards: [] },
      takeoffShards: {
        schemaVersion: "army-shard-plan-1", suite: "takeoff", reason: "test", files, workers: 1, durationsSha256: null,
        shards: shards.map((list, index) => ({ shard: index + 1, total: shards.length, files: [...list].sort(), seconds: 10 })),
      },
    };
  }

  function writeTakeoffShards(shards: string[][], options: (index: number) => Partial<UnitOptions> = () => ({})) {
    shards.forEach((list, index) => writeUnit({
      suite: "full", artifact: `army-takeoff-shard-${index + 1}-evidence`, scope: list.length ? "filtered-full" : "full",
      phases: list.length ? ["full"] : ["full", "development"], ran: { full: list.length ? list : [SETUP, T1], development: ["e2e/army/development/d.e2e.ts"] },
      ...(list.length ? { journeyFiles: [...list].sort() } : {}), shard: { index: index + 1, total: shards.length }, ...options(index + 1),
    }));
  }

  function takeoff(selection: unknown, results: Record<string, string> = ok): AggregateInput {
    return { suite: "takeoff", plan: selection, evidence, out, results, revision: REVISION };
  }

  it("passes when the takeoff shards ran exactly the selected full-only journeys, and fails when one left no evidence", () => {
    const plan = [[SETUP, T1, T3], [SETUP, T2]];
    const selection = takeoffSelection({ mode: "all", files: [SETUP, T1, T2, T3].sort() }, plan);
    writeTakeoffShards(plan.slice(0, 1));
    expect(problems(takeoff(selection))).toMatchObject({ status: "failed", problems: expect.stringContaining("army-takeoff-shard-2-evidence") });
    fs.rmSync(evidence, { recursive: true, force: true });
    writeTakeoffShards(plan);
    const result = aggregateEvidence(takeoff(selection));
    expect(result.problems).toEqual([]);
    expect(JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"))).toMatchObject({ suite: "takeoff", scope: "filtered-full",
      status: "passed", union: { executed: [SETUP, T1, T2, T3].sort(), missing: [], unexpected: [], duplicated: [] } });
  });

  it("fails when the plan drops a selected journey, plans shards for none or a shard is not the full runner's run of its files", () => {
    const plan = [[SETUP, T1], [SETUP, T2]];
    writeTakeoffShards(plan);
    expect(problems(takeoff(takeoffSelection({ mode: "all", files: [SETUP, T1, T2, T3].sort() }, plan))))
      .toMatchObject({ status: "failed", problems: expect.stringContaining("selected full-only journeys") });
    expect(problems(takeoff(takeoffSelection({ mode: "none", files: [] }, plan))))
      .toMatchObject({ status: "failed", problems: expect.stringContaining("A none full-only decision plans no shard.") });
    expect(problems(takeoff(takeoffSelection({ mode: "files", files: [SETUP, T1] }, []), { "army-select": "success", "army-takeoff-shard": "skipped" })))
      .toMatchObject({ status: "failed", problems: expect.stringContaining("A files full-only decision plans at least one shard.") });

    fs.rmSync(evidence, { recursive: true, force: true });
    writeTakeoffShards(plan, (index) => (index === 2 ? { suite: "critical", scope: "filtered-critical" } : {}));
    expect(problems(takeoff(takeoffSelection({ mode: "all", files: [SETUP, T1, T2].sort() }, plan))))
      .toMatchObject({ status: "failed", problems: expect.stringMatching(/shard 2\/2 is not a full runner manifest[\s\S]*scope filtered-critical, expected filtered-full/u) });
  });

  it("claims nothing for an explicit none and requires both phases from a fail-safe unsharded run", () => {
    expect(problems(takeoff(takeoffSelection({ mode: "none", files: [] }, []), { "army-select": "success", "army-takeoff-shard": "skipped" })))
      .toEqual({ status: "not-run", problems: "" });

    const failSafe = takeoffSelection({ mode: "all", files: [] }, [[]]);
    writeTakeoffShards([[]], () => ({ phases: ["full"] }));
    expect(problems(takeoff(failSafe))).toMatchObject({ status: "failed", problems: expect.stringContaining("expected full, development passed") });
    fs.rmSync(evidence, { recursive: true, force: true });
    writeTakeoffShards([[]]);
    expect(aggregateEvidence(takeoff(failSafe)).problems).toEqual([]);
  });
});
