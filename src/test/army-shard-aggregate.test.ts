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
// 9. calc-v3 groups (several phases on one stack per job): a group without
//    evidence, a red phase inside a group, a planned phase no group ran, a
//    phase run by two groups or by none of the plan's, a group whose manifest
//    or campaign does not list its planned phases, or a group plan that does
//    not partition the selected phases (one left out, one twice, an empty group);
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
  results?: (file: string) => { status: string; titlePath?: string[]; attempts?: { status: string }[]; expectedFailure?: { reason: string } };
  summary?: Record<string, number>;
  /** Other evidence files of the unit, by relative path. */
  files?: Record<string, string>;
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
  for (const [relative, text] of Object.entries(options.files ?? {})) write(relative, text);
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

  it("names every journey that did not pass, in the result and in the job summary", () => {
    // Without the names, a red aggregate only says "N selected result(s) not
    // passed, first <file>": finding which journeys means downloading the
    // evidence artifact and reading report.json.
    writeCriticalShards(undefined, (index) => (index === 1 ? {
      results: (file) => (file === A ? { status: "failed", titlePath: ["A01 the hub opens"] }
        : file === C ? { status: "interrupted", titlePath: ["a suite", "C02 the export downloads"] } : { status: "passed" }),
      summary: { passed: 1, failed: 1, interrupted: 1 },
    } : {}));
    const result = aggregateEvidence(critical(criticalSelection()));
    expect(result.status).toBe("failed");
    expect(result.notPassed).toEqual([
      "shard 1/2 : a.e2e.ts : A01 the hub opens (failed)",
      "shard 1/2 : c.e2e.ts : a suite > C02 the export downloads (interrupted)",
    ]);
    const selection = path.join(directory, "selection.json");
    fs.writeFileSync(selection, JSON.stringify(criticalSelection()));
    const summary = path.join(directory, "github-summary.md");
    const run = spawnSync(process.execPath, [AGGREGATOR, "critical", "--plan", selection, "--evidence", evidence,
      "--out", out, "--results", "army-select=success,army-critical-shard=failure", "--revision", REVISION], {
      cwd: root, encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: "", GITHUB_STEP_SUMMARY: summary }, windowsHide: true,
    });
    expect(run.status).toBe(1);
    const written = fs.readFileSync(summary, "utf8");
    // The retained manifest carries them too: the alert of a scheduled campaign reads them there.
    expect(JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8")).notPassed).toEqual(result.notPassed);
    expect(written).toContain("Parcours non passés (2)");
    expect(written).toContain("- shard 1/2 : a.e2e.ts : A01 the hub opens (failed)");
    expect(written).toContain("- shard 1/2 : c.e2e.ts : a suite > C02 the export downloads (interrupted)");
    // A green aggregate lists none.
    fs.rmSync(evidence, { recursive: true, force: true });
    writeCriticalShards();
    expect(aggregateEvidence(critical(criticalSelection())).notPassed).toEqual([]);
  });

  it("tells a journey that passed on its retry from one that failed both attempts, and keeps both red", () => {
    // The e2e CLI exits 0 on a run whose only non-pass is flaky: a shard that let it through would have a clean
    // exit code and manifest, and only its report would say that a journey needed its retry.
    writeCriticalShards(undefined, (index) => (index === 1 ? {
      results: (file) => (file === A ? { status: "flaky", titlePath: ["A01 the hub opens"], attempts: [{ status: "failed" }, { status: "passed" }] }
        : file === C ? { status: "failed", titlePath: ["C02 the export downloads"], attempts: [{ status: "failed" }, { status: "failed" }] } : { status: "passed" }),
      summary: { passed: 1, failed: 1, flaky: 1 },
    } : {}));
    const result = aggregateEvidence(critical(criticalSelection()));
    expect(result.status).toBe("failed");
    expect(result.notPassed).toEqual([
      "shard 1/2 : a.e2e.ts : A01 the hub opens (intermittent: failed on attempt 1, passed on attempt 2)",
      "shard 1/2 : c.e2e.ts : C02 the export downloads (failed on both attempts)",
    ]);
    expect(result.problems.join("\n")).toContain(`shard 1/2 critical/report.json: 2 selected result(s) not passed, first ${A} (intermittent: failed on attempt 1, passed on attempt 2).`);

    // A flaky journey alone, with the exit code 0 the CLI gives it, is red too.
    fs.rmSync(evidence, { recursive: true, force: true });
    writeCriticalShards(undefined, (index) => (index === 1 ? {
      results: (file) => (file === A ? { status: "flaky", titlePath: ["A01 the hub opens"], attempts: [{ status: "failed" }, { status: "passed" }] } : { status: "passed" }),
      summary: { passed: 2, flaky: 1 },
    } : {}));
    const selection = path.join(directory, "selection.json");
    fs.writeFileSync(selection, JSON.stringify(criticalSelection()));
    const summary = path.join(directory, "github-summary.md");
    const run = spawnSync(process.execPath, [AGGREGATOR, "critical", "--plan", selection, "--evidence", evidence,
      "--out", out, "--results", "army-select=success,army-critical-shard=success", "--revision", REVISION], {
      cwd: root, encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: "", GITHUB_STEP_SUMMARY: summary }, windowsHide: true,
    });
    expect(run.status).toBe(1);
    const written = fs.readFileSync(summary, "utf8");
    expect(written).toContain("Parcours non passés (1)");
    expect(written).toContain("- shard 1/2 : a.e2e.ts : A01 the hub opens (intermittent: failed on attempt 1, passed on attempt 2)");
    expect(written).toContain("« intermittent »");
  });

  it("lists the quarantined journeys with their ticket in a green aggregate, and refuses one without a ticket", () => {
    // The runner reports an expected failure as passed: the counts add up and nothing else says the journey proves nothing.
    const quarantine = (reason: string) => (index: number): Partial<UnitOptions> => (index === 1 ? {
      results: (file) => (file === A ? { status: "passed", titlePath: ["A01 the hub opens"], expectedFailure: { reason } } : { status: "passed" }),
    } : {});
    writeCriticalShards(undefined, quarantine("TI-681: the hub does not open"));
    const result = aggregateEvidence(critical(criticalSelection()));
    expect(result).toMatchObject({ status: "passed", problems: [], notPassed: [] });
    expect(result.quarantined).toEqual(["TI-681 : shard 1/2 : a.e2e.ts : A01 the hub opens (TI-681: the hub does not open)"]);
    expect(JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8")).quarantined).toEqual(result.quarantined);

    const selection = path.join(directory, "selection.json");
    fs.writeFileSync(selection, JSON.stringify(criticalSelection()));
    const summary = path.join(directory, "github-summary.md");
    const run = spawnSync(process.execPath, [AGGREGATOR, "critical", "--plan", selection, "--evidence", evidence,
      "--out", out, "--results", "army-select=success,army-critical-shard=success", "--revision", REVISION], {
      cwd: root, encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: "", GITHUB_STEP_SUMMARY: summary }, windowsHide: true,
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("::warning title=TesterArmy quarantine::TI-681 : shard 1/2 : a.e2e.ts : A01 the hub opens (TI-681: the hub does not open)");
    const written = fs.readFileSync(summary, "utf8");
    expect(written).toContain("Parcours en quarantaine (1)");
    expect(written).toContain("- TI-681 : shard 1/2 : a.e2e.ts : A01 the hub opens (TI-681: the hub does not open)");
    // A green aggregate without quarantine says nothing about it.
    fs.rmSync(evidence, { recursive: true, force: true });
    writeCriticalShards();
    expect(aggregateEvidence(critical(criticalSelection())).quarantined).toEqual([]);

    // An expected failure without a ticket is not a quarantine: the shard that let it through is refused here too.
    fs.rmSync(evidence, { recursive: true, force: true });
    writeCriticalShards(undefined, quarantine("expected to fail"));
    const refused = aggregateEvidence(critical(criticalSelection()));
    expect(refused.status).toBe("failed");
    expect(refused.problems.join("\n")).toContain(`shard 1/2 critical/report.json: ${A} > A01 the hub opens is expected to fail without a ticket (reason "expected to fail")`);
    expect(refused.quarantined).toEqual(["no ticket : shard 1/2 : a.e2e.ts : A01 the hub opens (expected to fail)"]);
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

  const calcResults = { "army-calc-v3-plan": "success", "army-calc-v3-group": "success" };
  const groupMatrix = (groups: string[][]) => groups.map((phases, index) => ({ group: index + 1, total: groups.length, phases: phases.join(",") }));
  /** A calc-v3 plan as the plan job hands it: the selected phases and the matrix of its group jobs. */
  const calc = (groups: string[][], overrides: { phases?: string[]; groups?: unknown; results?: Record<string, string> } = {}): AggregateInput => ({
    suite: "calc-v3", plan: { phases: overrides.phases ?? groups.flat(), groups: "groups" in overrides ? overrides.groups : groupMatrix(groups) },
    evidence, out, results: overrides.results ?? calcResults, revision: REVISION,
  });
  /** A group job's evidence: the runner manifest of its --phase list and the campaign's calc-v3.json. */
  const writeGroup = (group: number, planned: string[], options: {
    /** Phases calc-v3.json lists, with their status; the planned ones, passed, by default. */
    ran?: [phase: string, status: string][];
    extra?: Record<string, unknown>;
    files?: Record<string, string>;
    artifact?: string;
  } = {}) => {
    const ran = options.ran ?? planned.map((phase): [string, string] => [phase, "passed"]);
    return writeUnit({
      suite: "calc-v3", artifact: options.artifact ?? `army-calc-v3-group-${group}-evidence`, scope: `calc-v3-${planned.join(",")}`, phases: [],
      extra: { calcV3Phases: planned, calcV3: "calc-v3.json", ...(ran.every(([, status]) => status === "passed") ? {} : { status: "failed" }), ...options.extra },
      calcV3: { phases: ran.map(([phase, status]) => ({ phase, status })) }, files: options.files,
    });
  };
  const reset = () => {
    fs.rmSync(evidence, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(evidence);
  };
  const PLAN = [["journeys", "resume"], ["components"]];

  it("records calc-v3 none only with a successful plan, no group and skipped group jobs", () => {
    const none = calc([], { phases: ["none"], results: { "army-calc-v3-plan": "success", "army-calc-v3-group": "skipped" } });
    expect(aggregateEvidence(none)).toMatchObject({ status: "not-run", problems: [], evidence: null });
    expect(aggregateEvidence({ ...none, results: { ...none.results, "army-calc-v3-plan": "failure" } }).status).toBe("failed");
    expect(aggregateEvidence({ ...none, results: { ...none.results, "army-calc-v3-group": "success" } }).status).toBe("failed");
    expect(aggregateEvidence(calc([], { results: none.results })).status).toBe("failed");
    expect(problems(calc([["journeys"]], { phases: ["none"], results: none.results })))
      .toMatchObject({ status: "failed", problems: expect.stringContaining("without phases plans no group") });
  });

  it("passes calc-v3 when the groups together ran exactly the planned phases, each once and passed", () => {
    writeGroup(1, PLAN[0]);
    writeGroup(2, PLAN[1]);
    const result = aggregateEvidence(calc(PLAN));
    expect(result).toMatchObject({ status: "passed", problems: [], notPassed: [] });
    const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
    expect(manifest).toMatchObject({
      suite: "calc-v3", scope: "calc-v3", status: "passed",
      plan: { phases: ["journeys", "resume", "components"], groups: groupMatrix(PLAN) },
      union: { expected: ["components", "journeys", "resume"], executed: ["components", "journeys", "resume"], missing: [], unexpected: [], duplicated: [] },
    });
    expect(manifest.units.map((unit: { id: string; artifact: string; phases: string[] }) => [unit.id, unit.artifact, unit.phases])).toEqual([
      ["group 1/2", "army-calc-v3-group-1-evidence", ["journeys", "resume"]],
      ["group 2/2", "army-calc-v3-group-2-evidence", ["components"]],
    ]);
    // Each group's evidence is retained under its artifact name.
    expect(fs.existsSync(path.join(out, "units", "army-calc-v3-group-2-evidence", "calc-v3.json"))).toBe(true);
  });

  it("reads the flat download of a single calc-v3 group, and a complete campaign dispatched in one job", () => {
    writeGroup(1, ["mobile"], { artifact: "" });
    expect(aggregateEvidence(calc([["mobile"]]))).toMatchObject({ status: "passed", problems: [] });
    // The flat evidence of another group's phases is refused by its own identity.
    expect(problems(calc([["access"]]))).toMatchObject({ status: "failed", problems: expect.stringContaining("records calc-v3 phases mobile, planned access") });

    reset();
    const whole = () => writeUnit({ suite: "calc-v3", artifact: "army-calc-v3-group-1-evidence", scope: "calc-v3", phases: [],
      extra: { calcV3: "calc-v3.json" }, calcV3: { phases: ["journeys", "components", "mobile"].map((phase) => ({ phase, status: "passed" })) } });
    whole();
    expect(aggregateEvidence(calc([["all"]]))).toMatchObject({ status: "passed", problems: [] });
    // A --phase run cannot stand for the complete campaign.
    reset();
    writeGroup(1, ["journeys", "components", "mobile"]);
    const listed = problems(calc([["all"]]));
    expect(listed.status).toBe("failed");
    expect(listed.problems).toContain("scope calc-v3-journeys,components,mobile, expected calc-v3");
    expect(listed.problems).toContain("records phases for the whole campaign");
  });

  it("fails calc-v3 when a group left no evidence, a group job did not succeed or a phase inside a group is red", () => {
    writeGroup(1, PLAN[0]);
    const missing = problems(calc(PLAN));
    expect(missing.status).toBe("failed");
    expect(missing.problems).toContain("army-calc-v3-group-2-evidence/manifest.json is missing");
    expect(missing.problems).toContain("Planned phases missing from every group: components.");

    writeGroup(2, PLAN[1]);
    for (const result of ["failure", "cancelled", "skipped"]) {
      expect(problems(calc(PLAN, { results: { ...calcResults, "army-calc-v3-group": result } })), result)
        .toMatchObject({ status: "failed", problems: expect.stringContaining(`army-calc-v3-group ${result}`) });
    }
    expect(problems(calc(PLAN, { results: { ...calcResults, "army-calc-v3-plan": "failure" } })))
      .toMatchObject({ status: "failed", problems: expect.stringContaining("army-calc-v3-plan failure") });

    // A red phase does not hide the group's other phases: it is named, and its red journeys with it, read from
    // the report of its own e2e run (the alert of a scheduled campaign has nothing else to read them from).
    reset();
    writeGroup(1, PLAN[0], { ran: [["journeys", "passed"], ["resume", "failed"]], files: { "resume/sdk/report.json": JSON.stringify({ run: { results: [
      { file: "e2e/army/local/generated-ouvrage-resume.e2e.ts", selected: true, status: "failed", titlePath: ["GR02 resumes the draft"] },
      { file: "e2e/army/local/generated-ouvrage-resume.e2e.ts", selected: true, status: "passed", titlePath: ["GR04 keeps the page"] },
      { file: "e2e/army/local/generated-ouvrage-resume.e2e.ts", selected: false, status: "skipped", titlePath: ["GR01 another selection"] },
    ] } }) } });
    writeGroup(2, PLAN[1]);
    const red = aggregateEvidence(calc(PLAN));
    expect(red.status).toBe("failed");
    expect(red.problems.join("\n")).toContain("group 1/2 (army-calc-v3-group-1-evidence) calc-v3.json: phases journeys passed, resume failed.");
    expect(red.notPassed).toEqual(["calc-v3 resume : generated-ouvrage-resume.e2e.ts : GR02 resumes the draft (failed)"]);
    expect(JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8")).units.map((unit: { status: string }) => unit.status)).toEqual(["failed", "passed"]);
  });

  it("names the intermittent and the quarantined journeys of a calc-v3 phase from its own report", () => {
    const file = "e2e/army/local/generated-ouvrage-resume.e2e.ts";
    writeGroup(1, PLAN[0], { files: { "resume/sdk/report.json": JSON.stringify({ run: { results: [
      { file, selected: true, status: "passed", titlePath: ["GR03 keeps the draft"], expectedFailure: { reason: "red on main, #204" } },
      { file, selected: true, status: "passed", titlePath: ["GR04 keeps the page"] },
    ] } }) } });
    writeGroup(2, PLAN[1]);
    const green = aggregateEvidence(calc(PLAN));
    expect(green).toMatchObject({ status: "passed", problems: [], notPassed: [] });
    expect(green.quarantined).toEqual(["#204 : calc-v3 resume : generated-ouvrage-resume.e2e.ts : GR03 keeps the draft (red on main, #204)"]);

    reset();
    writeGroup(1, PLAN[0], { ran: [["journeys", "passed"], ["resume", "failed"]], files: { "resume/sdk/report.json": JSON.stringify({ run: { results: [
      { file, selected: true, status: "flaky", titlePath: ["GR02 resumes the draft"], attempts: [{ status: "timed-out" }, { status: "passed" }] },
    ] } }) } });
    writeGroup(2, PLAN[1]);
    expect(aggregateEvidence(calc(PLAN)).notPassed).toEqual([
      "calc-v3 resume : generated-ouvrage-resume.e2e.ts : GR02 resumes the draft (intermittent: timed-out on attempt 1, passed on attempt 2)",
    ]);

    // The aggregate does not rely on the phase's verdict: a phase recorded as passed whose report holds a
    // journey that needed its retry is red here too.
    reset();
    writeGroup(1, PLAN[0], { files: { "resume/sdk/report.json": JSON.stringify({ run: { results: [
      { file, selected: true, status: "flaky", titlePath: ["GR02 resumes the draft"], attempts: [{ status: "failed" }, { status: "passed" }] },
    ] } }) } });
    writeGroup(2, PLAN[1]);
    const retried = aggregateEvidence(calc(PLAN));
    expect(retried.status).toBe("failed");
    expect(retried.problems.join("\n")).toContain("calc-v3 resume: 1 selected result(s) not passed, first e2e/army/local/generated-ouvrage-resume.e2e.ts (intermittent");
  });

  it("fails calc-v3 on a missing, duplicated or unplanned phase and on a group that does not list its planned phases", () => {
    const cases: Array<[label: string, write: () => void, expected: string[]]> = [
      ["a planned phase its group did not run", () => { writeGroup(1, PLAN[0], { ran: [["journeys", "passed"]] }); writeGroup(2, PLAN[1]); },
        ["group 1/2 (army-calc-v3-group-1-evidence) calc-v3.json did not run resume.", "Planned phases missing from every group: resume."]],
      ["a phase outside the plan", () => { writeGroup(1, PLAN[0]); writeGroup(2, PLAN[1], { ran: [["components", "passed"], ["numeric", "passed"]] }); },
        ["group 2/2 (army-calc-v3-group-2-evidence) calc-v3.json ran numeric, which its plan does not list.", "Phases run outside the plan: numeric."]],
      ["a phase run by two groups", () => { writeGroup(1, PLAN[0]); writeGroup(2, PLAN[1], { ran: [["components", "passed"], ["journeys", "passed"]] }); },
        ["group 2/2 (army-calc-v3-group-2-evidence) calc-v3.json ran journeys, which its plan does not list.", "Phases run by two groups: journeys."]],
      ["a phase run twice in its group", () => { writeGroup(1, PLAN[0], { ran: [["journeys", "passed"], ["resume", "passed"], ["resume", "passed"]] }); writeGroup(2, PLAN[1]); },
        ["group 1/2 (army-calc-v3-group-1-evidence) calc-v3.json ran resume more than once."]],
      ["a manifest that records other phases than planned", () => { writeGroup(1, PLAN[0], { extra: { calcV3Phases: ["journeys"] } }); writeGroup(2, PLAN[1]); },
        ["group 1/2 (army-calc-v3-group-1-evidence) records calc-v3 phases journeys, planned journeys,resume."]],
      ["a manifest that records no phase list", () => { writeGroup(1, PLAN[0], { extra: { calcV3Phases: undefined } }); writeGroup(2, PLAN[1]); },
        ["group 1/2 (army-calc-v3-group-1-evidence) records calc-v3 phases (none), planned journeys,resume."]],
      ["another group's evidence under this group's name", () => { writeGroup(1, PLAN[0]); writeGroup(1, PLAN[0], { artifact: "army-calc-v3-group-2-evidence" }); },
        ["group 2/2 (army-calc-v3-group-2-evidence) has scope calc-v3-journeys,resume, expected calc-v3-components.",
          "group 2/2 (army-calc-v3-group-2-evidence) records calc-v3 phases journeys,resume, planned components.",
          "Planned phases missing from every group: components.", "Phases run by two groups: journeys, resume."]],
      ["a campaign without phases", () => { writeGroup(1, PLAN[0], { ran: [] }); writeGroup(2, PLAN[1]); },
        ["group 1/2 (army-calc-v3-group-1-evidence) calc-v3.json: phases none.", "calc-v3.json did not run journeys, resume."]],
    ];
    for (const [label, write, expected] of cases) {
      reset();
      write();
      const result = problems(calc(PLAN));
      expect(result.status, label).toBe("failed");
      for (const message of expected) expect(result.problems, label).toContain(message);
    }
  });

  it("fails calc-v3 on a group plan that does not partition the selected phases", () => {
    writeGroup(1, PLAN[0]);
    writeGroup(2, PLAN[1]);
    const cases: Array<[label: string, input: AggregateInput, expected: string]> = [
      ["a selected phase in no group", calc(PLAN, { phases: ["journeys", "resume", "components", "numeric"] }), "Selected phases planned in no group: numeric."],
      ["a phase in two groups", calc([["journeys", "resume"], ["components", "journeys"]], { phases: ["journeys", "resume", "components"] }), "Phases planned in 2 groups: journeys."],
      ["a phase the selection does not list", calc(PLAN, { phases: ["journeys", "components"] }), "Groups plan phases the selection does not list: resume."],
      ["an empty group", calc(PLAN, { groups: [...groupMatrix(PLAN), { group: 3, total: 3, phases: "" }] }), "Planned group 3 must list at least one phase"],
      ["a group numbered out of sequence", calc(PLAN, { groups: [{ group: 1, total: 2, phases: "journeys,resume" }, { group: 3, total: 2, phases: "components" }] }), "The plan numbers group 2 as 3/2."],
      ["phases selected and no group", calc(PLAN, { groups: [] }), "The calc-v3 plan selects phases but plans no group."],
      ["an unreadable matrix", calc(PLAN, { groups: undefined }), "The calc-v3 group plan is unreadable"],
      ["a matrix of phase arrays", calc(PLAN, { groups: [{ group: 1, total: 1, phases: ["journeys"] }] }), "The calc-v3 group plan is unreadable"],
      ["duplicated selected phases", calc(PLAN, { phases: ["journeys", "journeys", "resume", "components"] }), "The calc-v3 plan must list distinct phase names."],
    ];
    for (const [label, input, expected] of cases) {
      expect(problems(input), label).toMatchObject({ status: "failed", problems: expect.stringContaining(expected) });
    }
  });

  it("aggregates calc-v3 from the plan job's outputs on the command line", () => {
    writeGroup(1, PLAN[0]);
    writeGroup(2, PLAN[1]);
    const run = (groups: string | undefined, results = "army-calc-v3-plan=success,army-calc-v3-group=success") => spawnSync(process.execPath,
      [AGGREGATOR, "calc-v3", "--phases", "journeys,resume,components", ...(groups === undefined ? [] : ["--groups", groups]),
        "--evidence", evidence, "--out", out, "--results", results, "--revision", REVISION],
      { cwd: root, encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: "", GITHUB_STEP_SUMMARY: "" }, windowsHide: true });
    const passed = run(JSON.stringify(groupMatrix(PLAN)));
    expect(passed.status, `${passed.stdout}${passed.stderr}`).toBe(0);
    expect(passed.stdout).toContain("TesterArmy calc-v3 aggregate passed");
    const unreadable = run("[{");
    expect(unreadable.status).toBe(1);
    expect(unreadable.stdout).toContain("The calc-v3 group plan is unreadable");
    expect(run(JSON.stringify(groupMatrix([["journeys", "resume", "components"]]))).status).toBe(1);
    // Without the group matrix there is nothing to check the jobs against: a usage error, never a green check.
    expect(run(undefined).status).toBe(2);
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
