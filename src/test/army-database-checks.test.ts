// @vitest-environment node

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveDelegatedDatabaseChecks } from "../../scripts/tester-army/database-checks";

// On a pull request, pgTAP and the behavioral RLS matrix run once, in the required check `rls-matrix`,
// and the Army jobs of that pull request delegate them to it (docs/testing/tester-army-ci.md, "Pile,
// confidentialité et diagnostic"). Failure modes: a job delegates where no `rls-matrix` run covers it
// (a push to main, a campaign, a local run); `rls-matrix` skips or narrows its checks on a pull request
// whose Army jobs delegated them; a job of a pull request still repeats them.

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
/**
 * What GitHub computes for a workflow value: each `${{ }}` expression evaluated for one event. The expression
 * read here only uses comparisons, `&&`, `||`, literals and the `github` context, which JavaScript evaluates
 * the same way (as src/test/army-main-campaign.test.ts does for the concurrency groups).
 */
function evaluate(value: string, github: { event_name: string }): string {
  const text = value.trim().replace(/^(["'])(.*)\1$/u, "$2");
  return text.replace(/\$\{\{(.+?)\}\}/gu, (_, expression: string) => String(new Function("github", `return (${expression});`)(github)));
}

/** The steps of a workflow, each from its `- name:` line. */
function steps(workflow: string): string[] {
  return workflow.split(/^\s+- name:/mu).slice(1);
}

describe("delegated database checks", () => {
  const pullRequest = { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "pull_request" };

  it("delegates only inside the checks of a pull request, to the check that runs them", () => {
    expect(resolveDelegatedDatabaseChecks({})).toBeUndefined();
    expect(resolveDelegatedDatabaseChecks({ ...pullRequest, ARMY_DATABASE_CHECKS_DELEGATED_TO: "" })).toBeUndefined();
    expect(resolveDelegatedDatabaseChecks({ ...pullRequest, ARMY_DATABASE_CHECKS_DELEGATED_TO: "rls-matrix" })).toBe("rls-matrix");
  });

  it("refuses a delegation nothing covers", () => {
    const delegated = { ARMY_DATABASE_CHECKS_DELEGATED_TO: "rls-matrix" };
    // A local run, a push to main, a campaign: no `rls-matrix` run answers for that revision.
    expect(() => resolveDelegatedDatabaseChecks(delegated)).toThrow("pull request");
    expect(() => resolveDelegatedDatabaseChecks({ ...delegated, GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "push" })).toThrow("pull request");
    expect(() => resolveDelegatedDatabaseChecks({ ...delegated, GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "schedule" })).toThrow("pull request");
    expect(() => resolveDelegatedDatabaseChecks({ ...delegated, GITHUB_EVENT_NAME: "pull_request" })).toThrow("pull request");
    expect(() => resolveDelegatedDatabaseChecks({ ...pullRequest, ARMY_DATABASE_CHECKS_DELEGATED_TO: "army-critical" })).toThrow("rls-matrix");
  });

  it("makes every Army job of a pull request delegate, and no campaign of main", () => {
    const running = (file: string) => steps(read(file)).filter((step) => step.trimStart().startsWith("Run native database and TesterArmy"));
    const critical = running(".github/workflows/e2e-army-critical.yml");
    const calcV3 = running(".github/workflows/e2e-army-calc-v3.yml");
    expect(critical.map((step) => step.trimStart().split("\n")[0])).toEqual([
      "Run native database and TesterArmy critical journeys", "Run native database and TesterArmy takeoff journeys",
    ]);
    expect(calcV3).toHaveLength(1);
    // What the runner receives for each event, and what it then does with it: the wiring, not its spelling.
    for (const step of [...critical, ...calcV3]) {
      const value = /^\s+ARMY_DATABASE_CHECKS_DELEGATED_TO:(.*)$/mu.exec(step)?.[1];
      expect(value, step.trimStart().split("\n")[0]).toBeDefined();
      const received = (event: string) => ({ GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: event,
        ARMY_DATABASE_CHECKS_DELEGATED_TO: evaluate(value!, { event_name: event }) });
      expect(resolveDelegatedDatabaseChecks(received("pull_request"))).toBe("rls-matrix");
      for (const event of ["push", "schedule", "workflow_dispatch"]) {
        expect(received(event).ARMY_DATABASE_CHECKS_DELEGATED_TO, event).toBe("");
        expect(resolveDelegatedDatabaseChecks(received(event)), event).toBeUndefined();
      }
    }
    // The Full campaign never runs on a pull request: its jobs keep their own checks.
    const full = running(".github/workflows/e2e-army-full.yml");
    expect(full).toHaveLength(2);
    for (const step of full) expect(step).not.toContain("ARMY_DATABASE_CHECKS_DELEGATED_TO");
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

  it("is the only job of that name among the workflows", () => {
    const directory = path.join(root, ".github/workflows");
    const owners = fs.readdirSync(directory).filter((file) => /^ {2}rls-matrix:$/mu.test(fs.readFileSync(path.join(directory, file), "utf8")));
    expect(owners).toEqual(["e2e-rls-matrix.yml"]);
  });
});
