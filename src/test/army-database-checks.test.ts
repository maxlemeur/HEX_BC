// @vitest-environment node

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveDelegatedDatabaseChecks } from "../../scripts/tester-army/database-checks";

// On a pull request and on a push to main, pgTAP and the behavioral RLS matrix run once, in `rls-matrix`
// (required on a pull request), and the Army jobs of that event delegate them to it (docs/testing/tester-army-ci.md,
// "Pile, confidentialité et diagnostic"). Failure modes: a job delegates where no `rls-matrix` run covers it
// (a push to another branch, a scheduled or dispatched campaign, a local run); `rls-matrix` skips, narrows or
// cancels its checks for an event whose Army jobs delegated them; a job of such an event still repeats them.

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
/**
 * What GitHub computes for a workflow value: each `${{ }}` expression evaluated for one event. The expression
 * read here only uses comparisons, `&&`, `||`, literals and the `github` context, which JavaScript evaluates
 * the same way (as src/test/army-main-campaign.test.ts does for the concurrency groups).
 */
function evaluate(value: string, github: { event_name: string; ref: string; run_id?: number }): string {
  const text = value.trim().replace(/^(["'])(.*)\1$/u, "$2");
  return text.replace(/\$\{\{(.+?)\}\}/gu, (_, expression: string) => String(new Function("github", `return (${expression});`)(github)));
}

/** The steps of a workflow, each from its `- name:` line. */
function steps(workflow: string): string[] {
  return workflow.split(/^\s+- name:/mu).slice(1);
}

describe("delegated database checks", () => {
  const pullRequest = { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "pull_request", GITHUB_REF: "refs/pull/7/merge" };
  const mainPush = { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main" };

  it("delegates only inside the checks of a pull request or of a push to main, to the check that runs them", () => {
    expect(resolveDelegatedDatabaseChecks({})).toBeUndefined();
    expect(resolveDelegatedDatabaseChecks({ ...pullRequest, ARMY_DATABASE_CHECKS_DELEGATED_TO: "" })).toBeUndefined();
    expect(resolveDelegatedDatabaseChecks({ ...pullRequest, ARMY_DATABASE_CHECKS_DELEGATED_TO: "rls-matrix" })).toBe("rls-matrix");
    expect(resolveDelegatedDatabaseChecks({ ...mainPush, ARMY_DATABASE_CHECKS_DELEGATED_TO: "rls-matrix" })).toBe("rls-matrix");
  });

  it("refuses a delegation nothing covers", () => {
    const delegated = { ARMY_DATABASE_CHECKS_DELEGATED_TO: "rls-matrix" };
    // A local run, a push to another branch, a scheduled or dispatched campaign: no `rls-matrix` run answers for it.
    expect(() => resolveDelegatedDatabaseChecks(delegated)).toThrow("push to main");
    for (const refused of [
      { ...mainPush, GITHUB_REF: "refs/heads/release" },
      { ...mainPush, GITHUB_REF: "refs/tags/v1.0.0" },
      { ...mainPush, GITHUB_REF: undefined },
      { ...mainPush, GITHUB_EVENT_NAME: "schedule" },
      { ...mainPush, GITHUB_EVENT_NAME: "workflow_dispatch" },
      { ...mainPush, GITHUB_ACTIONS: undefined },
      { ...pullRequest, GITHUB_ACTIONS: undefined },
    ]) {
      expect(() => resolveDelegatedDatabaseChecks({ ...delegated, ...refused }), JSON.stringify(refused)).toThrow("push to main");
    }
    expect(() => resolveDelegatedDatabaseChecks({ ...pullRequest, ARMY_DATABASE_CHECKS_DELEGATED_TO: "army-critical" })).toThrow("rls-matrix");
  });

  it("makes every Army job of a pull request and of a push to main delegate, and no scheduled or dispatched campaign", () => {
    const running = (file: string) => steps(read(file)).filter((step) => step.trimStart().startsWith("Run native database and TesterArmy"));
    const critical = running(".github/workflows/e2e-army-critical.yml");
    const calcV3 = running(".github/workflows/e2e-army-calc-v3.yml");
    const full = running(".github/workflows/e2e-army-full.yml");
    expect(critical.map((step) => step.trimStart().split("\n")[0])).toEqual([
      "Run native database and TesterArmy critical journeys", "Run native database and TesterArmy takeoff journeys",
    ]);
    expect(calcV3).toHaveLength(1);
    // The Full shards and its development job: each runs the database checks on its own stack.
    expect(full.map((step) => step.trimStart().split("\n")[0])).toEqual([
      "Run native database and TesterArmy full journeys", "Run native database and TesterArmy development journeys",
    ]);
    // What the runner receives for each event, and what it then does with it: the wiring, not its spelling.
    const events = [
      { event_name: "pull_request", ref: "refs/pull/7/merge", delegated: "rls-matrix" },
      { event_name: "push", ref: "refs/heads/main", delegated: "rls-matrix" },
      { event_name: "push", ref: "refs/heads/release", delegated: "" },
      { event_name: "schedule", ref: "refs/heads/main", delegated: "" },
      { event_name: "workflow_dispatch", ref: "refs/heads/main", delegated: "" },
    ];
    for (const step of [...critical, ...calcV3, ...full]) {
      const name = step.trimStart().split("\n")[0];
      const value = /^\s+ARMY_DATABASE_CHECKS_DELEGATED_TO:(.*)$/mu.exec(step)?.[1];
      expect(value, name).toBeDefined();
      for (const { delegated, ...github } of events) {
        const received = { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: github.event_name, GITHUB_REF: github.ref,
          ARMY_DATABASE_CHECKS_DELEGATED_TO: evaluate(value!, github) };
        expect(received.ARMY_DATABASE_CHECKS_DELEGATED_TO, `${name} ${github.event_name} ${github.ref}`).toBe(delegated);
        expect(resolveDelegatedDatabaseChecks(received), `${name} ${github.event_name} ${github.ref}`).toBe(delegated || undefined);
      }
    }
  });
});

describe("the check the Army jobs of a pull request delegate to", () => {
  const workflow = read(".github/workflows/e2e-rls-matrix.yml");
  const job = workflow.slice(workflow.indexOf("\n  rls-matrix:\n"));

  // A scope that skipped the database checks for "documentation only" let Army jobs delegate to a check that
  // ran nothing: the label army-full, an empty diff and a selector fail-safe all start Army jobs on such a diff.
  it("runs the complete database checks on every event, with no condition to skip them", () => {
    expect(workflow).toMatch(/\n {2}pull_request:\n {4}branches: \["main"\]\n/u);
    expect(workflow).not.toMatch(/\n {2}pull_request:\n(?: {4}.*\n)* {4}paths(?:-ignore)?:/u);
    expect(job).not.toMatch(/^\s+if:/mu);
    expect(job).not.toContain("steps.scope");
    // The whole pgTAP folder, the CI statement ceilings and the RLS matrix: no --files, no --skip-rls.
    expect(job).toMatch(/^ {8}run: npm run db:ci:local$/mu);
    expect(job.match(/db:ci:local/gu)).toHaveLength(1);
    expect(workflow).not.toContain("continue-on-error");
  });

  // The Army jobs of a push to main delegate too: every push they run for must start this check, and nothing
  // may cancel it. Their own push trigger skips only documentation (docs/**, **/*.md), and so does this one.
  it("runs on every push to main the Army workflows run for, and never cancels a push run", () => {
    const push = (file: string) => /\n {2}push:\n((?: {4}.*\n)+)/u.exec(read(file))?.[1];
    expect(push(".github/workflows/e2e-rls-matrix.yml")).toBe('    branches: [main]\n    paths-ignore:\n      - "docs/**"\n      - "**/*.md"\n');
    for (const army of [".github/workflows/e2e-army-critical.yml", ".github/workflows/e2e-army-calc-v3.yml", ".github/workflows/e2e-army-full.yml"]) {
      expect(push(army), army).toBe(push(".github/workflows/e2e-rls-matrix.yml"));
    }
    const concurrency = /\nconcurrency:\n {2}group: (.+)\n {2}cancel-in-progress: (.+)\n/u.exec(workflow);
    expect(concurrency).not.toBeNull();
    const push42 = { event_name: "push", ref: "refs/heads/main", run_id: 42 };
    const push43 = { ...push42, run_id: 43 };
    expect(evaluate(concurrency![1], push42)).not.toBe(evaluate(concurrency![1], push43));
    expect(evaluate(concurrency![2], push42)).toBe("false");
    // The scheduled run is kept, and so is the dispatch.
    expect(workflow).toMatch(/\n {2}schedule:\n/u);
    expect(workflow).toMatch(/\n {2}workflow_dispatch:\n/u);
  });

  it("is the only job of that name among the workflows", () => {
    const directory = path.join(root, ".github/workflows");
    const owners = fs.readdirSync(directory).filter((file) => /^ {2}rls-matrix:$/mu.test(fs.readFileSync(path.join(directory, file), "utf8")));
    expect(owners).toEqual(["e2e-rls-matrix.yml"]);
  });
});
