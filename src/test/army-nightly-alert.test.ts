// @vitest-environment node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it } from "vitest";

import { ALERT_EVENTS, ALERT_WORKFLOWS, alertIssues, alertTitle, alertTitles, alertVerdict, planAlert, supersededBy, type AlertInput } from "../../scripts/tester-army/nightly-alert";

const root = process.cwd();
const RUN = "https://github.com/example/repository/actions/runs/42";
const red = (overrides: Partial<AlertInput> = {}): AlertInput => ({
  workflow: "TesterArmy Full", conclusion: "failure", runUrl: RUN, revision: "df20b136d3c91ebac5212fba2f9eecd773a462ef",
  date: "2026-11-10T11:15:56Z", failedJobs: ["army-full shard 3/6", "army-full development"],
  notPassed: ["shard 3/6 : cockpit-command-bar.e2e.ts : EST-374 > ouvre le preview (failed)"], openIssue: null, ...overrides,
});

describe("alert of a red TesterArmy campaign of main", () => {
  it("opens one issue per workflow that names the run, the failed jobs and every journey that did not pass", () => {
    const plan = planAlert(red());
    expect(plan).toMatchObject({ action: "create", title: "CI rouge sur main : TesterArmy Full" });
    if (plan.action !== "create") throw new Error("unreachable");
    expect(plan.body).toContain("`df20b136`");
    expect(plan.body).toContain("campagne du 2026-11-10");
    expect(plan.body).toContain(RUN);
    expect(plan.body).toContain("`army-full shard 3/6`, `army-full development`");
    expect(plan.body).toContain("### Parcours non passés (1)");
    expect(plan.body).toContain("- `shard 3/6 : cockpit-command-bar.e2e.ts : EST-374 > ouvre le preview (failed)`");
    expect(alertTitle("TesterArmy calc-v3")).toBe("CI rouge sur main : TesterArmy calc-v3");
  });

  it("comments the open issue of the workflow instead of opening a second one", () => {
    const plan = planAlert(red({ openIssue: 187, conclusion: "timed_out" }));
    expect(plan).toMatchObject({ action: "comment", issue: 187 });
    if (plan.action !== "comment") throw new Error("unreachable");
    expect(plan.body).toContain("### Parcours non passés (1)");
  });

  it("closes the open issue on the first green campaign and stays silent when none is open", () => {
    const closed = planAlert(red({ conclusion: "success", openIssue: 187, failedJobs: [], notPassed: [] }));
    expect(closed).toMatchObject({ action: "close", issue: 187 });
    if (closed.action !== "close") throw new Error("unreachable");
    expect(closed.body).toContain(RUN);
    expect(planAlert(red({ conclusion: "success", failedJobs: [], notPassed: [] }))).toEqual({ action: "none" });
  });

  it("claims nothing for a campaign that did not conclude", () => {
    for (const conclusion of ["cancelled", "skipped", "neutral", "action_required", ""]) {
      expect(planAlert(red({ conclusion, openIssue: 187 })), conclusion).toEqual({ action: "none" });
    }
  });

  it("says so when the journeys could not be read, rather than listing none", () => {
    const plan = planAlert(red({ notPassed: null, failedJobs: [] }));
    if (plan.action !== "create") throw new Error("unreachable");
    expect(plan.body).toContain("n'ont pas pu être lus");
    expect(plan.body).toContain("Aucun job en échec n'a pu être listé");
    expect(plan.body).not.toContain("### Parcours non passés");
    // Jobs failed before any journey ran (setup, build): no journey is red, and the body says that too.
    const setup = planAlert(red({ notPassed: [] }));
    if (setup.action !== "create") throw new Error("unreachable");
    expect(setup.body).toContain("Les preuves ne nomment aucun parcours rouge");
  });

  it("keeps journey titles inert and the body within an issue's size", () => {
    const plan = planAlert(red({
      notPassed: ["shard 1/6 : a.e2e.ts : notifies @someone with `code` (failed)",
        ...Array.from({ length: 150 }, (_, index) => `shard 1/6 : b.e2e.ts : journey ${index} (failed)`)],
    }));
    if (plan.action !== "create") throw new Error("unreachable");
    // A code span neither mentions a user nor ends on a backquote of the title.
    expect(plan.body).toContain("- `shard 1/6 : a.e2e.ts : notifies @someone with 'code' (failed)`");
    expect(plan.body).toContain("### Parcours non passés (151)");
    expect(plan.body.split("\n").filter((line) => line.startsWith("- `shard"))).toHaveLength(100);
    expect(plan.body).toContain("… et 51 autres, dans le résumé du run.");
    // 100 entries of the longest title kept still fit an issue (65 536 characters).
    const longest = planAlert(red({ notPassed: Array.from({ length: 150 }, () => `shard 1/6 : a.e2e.ts : ${"x".repeat(2_000)} (failed)`) }));
    if (longest.action !== "create") throw new Error("unreachable");
    expect(longest.body.length).toBeLessThan(60_000);
  });

  it("drops the result of a campaign once a later revision has had its verdict", () => {
    // Revisions in the order of main: a scheduled campaign of "old" may finish after the push campaign of "new".
    const order = ["old", "middle", "new"];
    const isAhead = (base: string, head: string) => order.indexOf(head) > order.indexOf(base);
    const campaign = (id: number, head_sha: string) => ({ id, head_sha, html_url: `https://example.test/runs/${id}` });
    const concluded = [campaign(3, "new"), campaign(2, "middle"), campaign(1, "old")];
    // The older green must not close what the newer red opened, nor the older red reopen what the newer green closed.
    expect(supersededBy(campaign(1, "old"), concluded, isAhead)).toEqual(campaign(3, "new"));
    expect(supersededBy(campaign(2, "middle"), concluded, isAhead)).toEqual(campaign(3, "new"));
    // The newest revision speaks, and so does a second campaign of that same revision.
    expect(supersededBy(campaign(3, "new"), concluded, isAhead)).toBeNull();
    expect(supersededBy(campaign(4, "new"), concluded, isAhead)).toBeNull();
    // Each other revision is compared once, however many campaigns it had.
    const compared: string[] = [];
    supersededBy(campaign(3, "new"), [campaign(2, "middle"), campaign(5, "middle"), campaign(1, "old")],
      (base, head) => { compared.push(head); return isAhead(base, head); });
    expect(compared).toEqual(["middle", "old"]);
  });

  it("recognises only the issues it opened itself, on a repository anyone can open issues in", () => {
    const title = alertTitle("TesterArmy Full");
    const bot = { login: "app/github-actions", is_bot: true };
    expect(alertIssues([
      { number: 12, title, author: { login: "someone", is_bot: false } },
      { number: 15, title, author: { login: "app/other-app", is_bot: true } },
      { number: 31, title: `${title} (suite)`, author: bot },
      { number: 40, title, author: bot },
      { number: 22, title, author: bot },
    ], alertTitles("TesterArmy Full"))).toEqual([22, 40]);
  });

  it("still finds an alert opened under the title used when only the scheduled campaigns raised it", () => {
    const bot = { login: "app/github-actions", is_bot: true };
    const titles = alertTitles("TesterArmy Full");
    expect(titles[0]).toBe(alertTitle("TesterArmy Full"));
    // It is commented and closed like the others, never left open beside a new one; another workflow's is not taken.
    expect(alertIssues([
      { number: 9, title: "CI nocturne rouge : TesterArmy calc-v3", author: bot },
      { number: 7, title: "CI nocturne rouge : TesterArmy Full", author: bot },
      { number: 8, title: "CI nocturne rouge : TesterArmy Full", author: { login: "someone", is_bot: false } },
      { number: 11, title: alertTitle("TesterArmy Full"), author: bot },
    ], titles)).toEqual([7, 11]);
  });

  // pgTAP and the RLS matrix of a push to main run only in `rls-matrix` (the Army jobs delegate them), and its
  // schedule is the only run that measures the CI statement ceilings on main: a red one reaches the issue too.
  it("raises a red rls-matrix run of main, which names no journey, without claiming its evidence was lost", () => {
    expect(ALERT_WORKFLOWS["E2E RLS Matrix"]).toEqual({ file: ".github/workflows/e2e-rls-matrix.yml", artifact: null });
    const plan = planAlert(red({ workflow: "E2E RLS Matrix", event: "push", failedJobs: ["rls-matrix"], notPassed: null, journeys: false }));
    expect(plan).toMatchObject({ action: "create", title: "CI rouge sur main : E2E RLS Matrix" });
    if (plan.action !== "create") throw new Error("unreachable");
    expect(plan.body).toContain("`rls-matrix`");
    expect(plan.body).toContain("pgTAP");
    expect(plan.body).not.toContain("n'ont pas pu être lus");
    expect(plan.body).not.toContain("Parcours non passés");
    // It is a run, not a campaign: the issue names it so.
    expect(plan.body).toContain("run du 2026-11-10");
    expect(plan.body).toContain("à chaque run rouge de main");
    expect(plan.body).not.toContain("campagne");
    const closed = planAlert(red({ workflow: "E2E RLS Matrix", conclusion: "success", openIssue: 301, failedJobs: [], notPassed: [], journeys: false }));
    expect(closed).toMatchObject({ action: "close", issue: 301 });
    if (closed.action !== "close") throw new Error("unreachable");
    expect(closed.body).toContain("run du 2026-11-10");
    expect(closed.body).not.toContain("campagne");
  });

  // The Army jobs of a push delegate pgTAP and the RLS matrix to the rls-matrix run of the same push: when that run
  // is cancelled, nothing checked the database of that revision.
  it("raises a cancelled rls-matrix push run as red, saying the database checks were cancelled", () => {
    const cancelled = { workflow: "E2E RLS Matrix", event: "push", conclusion: "cancelled", failedJobs: ["rls-matrix"], notPassed: [], journeys: false };
    expect(alertVerdict("E2E RLS Matrix", "push", "cancelled")).toBe("red");
    const plan = planAlert(red(cancelled));
    expect(plan).toMatchObject({ action: "create", title: "CI rouge sur main : E2E RLS Matrix" });
    if (plan.action !== "create") throw new Error("unreachable");
    expect(plan.body).toContain("annulé");
    expect(plan.body).toContain("délégués");
    expect(plan.body).toContain("`rls-matrix`");
    expect(planAlert(red({ ...cancelled, openIssue: 301 }))).toMatchObject({ action: "comment", issue: 301 });
    // Only the push run carries delegated checks: a cancelled scheduled run, or a cancelled Army campaign, changes nothing.
    expect(alertVerdict("E2E RLS Matrix", "schedule", "cancelled")).toBeNull();
    expect(planAlert(red({ ...cancelled, event: "schedule", openIssue: 301 }))).toEqual({ action: "none" });
    for (const workflow of ["TesterArmy Full", "TesterArmy calc-v3"]) {
      expect(alertVerdict(workflow, "push", "cancelled"), workflow).toBeNull();
      expect(planAlert(red({ workflow, event: "push", conclusion: "cancelled", openIssue: 187 })), workflow).toEqual({ action: "none" });
    }
    expect(alertVerdict("E2E RLS Matrix", "push", "skipped")).toBeNull();
    expect(alertVerdict("E2E RLS Matrix", "push", "success")).toBe("green");
    expect(alertVerdict("TesterArmy Full", "schedule", "timed_out")).toBe("red");
  });

  // Every rls-matrix push run completes on its own, in parallel with the others. Were their alerts queued in one
  // concurrency group, a newer pending alert would cancel an older pending one: a red could be lost.
  it("gives each rls-matrix alert its own concurrency group, and keeps one queue per Army campaign workflow", () => {
    const workflow = fs.readFileSync(path.join(root, ".github/workflows/ci-night-alert.yml"), "utf8");
    const expression = /^ {2}group: ci-night-alert-\$\{\{ (.+) \}\}$/mu.exec(workflow)?.[1];
    expect(expression).toBeDefined();
    expect(workflow).toMatch(/^ {2}cancel-in-progress: false$/mu);
    // GitHub's == and != compare strings as === and !== do; && and || return an operand, as in JavaScript.
    const group = (name: string, event: string, runId: number) => `ci-night-alert-${String(vm.runInNewContext(
      expression!.replace(/([!=])=/gu, "$1=="), { github: { run_id: runId, event: { workflow_run: { name, event } } } }))}`;
    expect(group("E2E RLS Matrix", "push", 1)).not.toBe(group("E2E RLS Matrix", "push", 2));
    expect(group("E2E RLS Matrix", "schedule", 3)).not.toBe(group("E2E RLS Matrix", "push", 4));
    for (const name of ["TesterArmy Full", "TesterArmy calc-v3"]) {
      expect(group(name, "push", 1), name).toBe(`ci-night-alert-${name}`);
      expect(group(name, "schedule", 2), name).toBe(`ci-night-alert-${name}`);
      // Pull-request completions start skipped runs that stay out of the queue.
      expect(group(name, "pull_request", 3), name).toBe("ci-night-alert-3");
    }
    expect(group("E2E RLS Matrix", "pull_request", 5)).toBe("ci-night-alert-5");

    // The review's scenario. A's alert runs, B (red, newest revision) completes, then C (green, older revision).
    // B's alert is never cancelled; C's alert, run in parallel, writes nothing, and B's red reaches the issue.
    const order = ["a", "c", "b"];
    const isAhead = (base: string, head: string) => order.indexOf(head) > order.indexOf(base);
    const run = (id: number, head_sha: string) => ({ id, head_sha, html_url: `https://example.test/runs/${id}` });
    const concluded = [run(3, "c"), run(2, "b"), run(1, "a")];
    expect(supersededBy(run(3, "c"), concluded, isAhead)).toEqual(run(2, "b"));
    expect(supersededBy(run(2, "b"), concluded, isAhead)).toBeNull();
    expect(planAlert(red({ workflow: "E2E RLS Matrix", event: "push", journeys: false, notPassed: [], openIssue: 301 })))
      .toMatchObject({ action: "comment", issue: 301 });
  });

  it("watches exactly the runs of main its workflow is triggered by, each with its aggregate evidence when it runs journeys", () => {
    const workflow = fs.readFileSync(path.join(root, ".github/workflows/ci-night-alert.yml"), "utf8");
    const watched = /^ {4}workflows: \[(.+)\]$/mu.exec(workflow)?.[1].split(",").map((name) => name.trim().replace(/^"|"$/gu, ""));
    expect(watched?.sort()).toEqual(Object.keys(ALERT_WORKFLOWS).sort());
    expect(watched).toContain("E2E RLS Matrix");
    for (const [name, { file, artifact }] of Object.entries(ALERT_WORKFLOWS)) {
      const watchedWorkflow = fs.readFileSync(path.join(root, file), "utf8");
      expect(watchedWorkflow, file).toMatch(new RegExp(`^name: ${name}$`, "mu"));
      if (artifact !== null) expect(watchedWorkflow, file).toContain(artifact);
      // Each event that writes is one the watched workflow runs its whole campaign for, and a push only on main.
      for (const event of ALERT_EVENTS) expect(watchedWorkflow, `${file} ${event}`).toMatch(new RegExp(`^ {2}${event}:$`, "mu"));
      expect(watchedWorkflow, file).toMatch(/^ {2}push:\n {4}branches: \[main\]\n/mu);
    }
    // Only a campaign of main, or a replay someone asks for, reaches the issue tracker.
    expect(workflow).toContain(`if: github.event_name == 'workflow_dispatch' || ${
      ALERT_EVENTS.map((event) => `github.event.workflow_run.event == '${event}'`).join(" || ")}\n`);
    // The token that writes issues belongs to the one job that needs it.
    expect(workflow).toMatch(/^permissions:\n {2}contents: read\n/mu);
    expect(workflow).toMatch(/^ {4}permissions:\n {6}contents: read\n {6}actions: read\n {6}issues: write\n/mu);
  });

  describe("main(), against a stand-in gh", () => {
    const temporary: string[] = [];
    afterEach(() => { for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

    // Each response answers the gh calls whose arguments start with `match`; a list answers successive calls in order.
    type Response = { match: string; out: string | string[] };
    const FAKE_GH = `#!/usr/bin/env node
const fs = require("node:fs");
const { responses, log } = JSON.parse(fs.readFileSync(process.env.FAKE_GH_FIXTURE, "utf8"));
const args = process.argv.slice(2);
const line = args.join(" ");
const bodyFile = args.indexOf("--body-file");
const previous = fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\\n").filter(Boolean).map((entry) => JSON.parse(entry).line) : [];
fs.appendFileSync(log, JSON.stringify({ line, body: bodyFile < 0 ? undefined : fs.readFileSync(args[bodyFile + 1], "utf8") }) + "\\n");
const response = responses.find((entry) => line.startsWith(entry.match));
if (!response) { if (/^issue (create|comment|close|edit) /.test(line)) process.exit(0); process.stderr.write("unexpected gh " + line); process.exit(1); }
const outs = Array.isArray(response.out) ? response.out : [response.out];
const seen = previous.filter((entry) => entry.startsWith(response.match)).length;
process.stdout.write(outs[Math.min(seen, outs.length - 1)]);
`;
    const REPOSITORY = "example/repository";
    const bot = { login: "app/github-actions", is_bot: true };
    const runOf = (id: number, name: string, event: string, conclusion: string, head_sha: string) => ({
      id, name, event, conclusion, head_sha, head_branch: "main", html_url: `https://github.com/${REPOSITORY}/actions/runs/${id}`,
      run_started_at: "2026-11-24T10:00:00Z",
    });
    function alert(run: ReturnType<typeof runOf>, responses: Response[], write = true) {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "army-alert-test-"));
      temporary.push(directory);
      const log = path.join(directory, "calls.jsonl");
      fs.writeFileSync(path.join(directory, "gh"), FAKE_GH, { mode: 0o755 });
      fs.writeFileSync(path.join(directory, "fixture.json"), JSON.stringify({ log, responses: [
        { match: `api repos/${REPOSITORY}/actions/runs/${run.id}`, out: JSON.stringify(run) }, ...responses] }));
      const result = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", path.join(root, "scripts/tester-army/nightly-alert.ts")], {
        encoding: "utf8", env: {
          PATH: [directory, path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter), FAKE_GH_FIXTURE: path.join(directory, "fixture.json"),
          ALERT_REPOSITORY: REPOSITORY, ALERT_RUN_ID: String(run.id), ALERT_WRITE: String(write), TMPDIR: directory,
        },
      });
      expect(result.status, result.stderr).toBe(0);
      const calls = fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((entry) => JSON.parse(entry) as { line: string; body?: string });
      return { stdout: result.stdout, calls, lines: calls.map((call) => call.line) };
    }
    const listed = (file: string, runs: ReturnType<typeof runOf>[]): Response =>
      ({ match: `api repos/${REPOSITORY}/actions/workflows/${file}/runs?branch=main&status=completed`, out: JSON.stringify({ workflow_runs: runs }) });
    const jobs = (id: number, names: string[]): Response => ({ match: `api --paginate repos/${REPOSITORY}/actions/runs/${id}/jobs`, out: names.map((name) => `${name}\n`).join("") });
    const issues = (open: { number: number; title: string }[]): Response =>
      ({ match: "issue list", out: JSON.stringify(open.map((issue) => ({ ...issue, author: bot }))) });

    it("reads no journey evidence for rls-matrix, and the aggregate evidence of an Army campaign", () => {
      const rls = runOf(51, "E2E RLS Matrix", "push", "failure", "b".repeat(40));
      const { stdout, lines } = alert(rls, [listed("e2e-rls-matrix.yml", [rls]), jobs(51, ["rls-matrix"]), issues([])], false);
      expect(stdout).toContain("Décision : create (simulation, rien n'est écrit)");
      expect(stdout).toContain("Ce workflow ne lance aucun parcours");
      expect(lines.some((line) => line.includes("/artifacts"))).toBe(false);

      const full = runOf(52, "TesterArmy Full", "push", "failure", "b".repeat(40));
      const army = alert(full, [listed("e2e-army-full.yml", [full]), jobs(52, ["army-full shard 1/6"]), issues([]),
        { match: `api repos/${REPOSITORY}/actions/runs/52/artifacts?name=army-full-evidence`, out: JSON.stringify({ artifacts: [] }) }], false);
      expect(army.lines.some((line) => line.includes("/actions/runs/52/artifacts?name=army-full-evidence"))).toBe(true);
      expect(army.stdout).toContain("n'ont pas pu être lus");
    });

    it("opens the issue for a cancelled rls-matrix push run and names its cancelled job", () => {
      const rls = runOf(61, "E2E RLS Matrix", "push", "cancelled", "c".repeat(40));
      const { calls } = alert(rls, [listed("e2e-rls-matrix.yml", [rls]), jobs(61, ["rls-matrix"]), issues([])]);
      const created = calls.find((call) => call.line.startsWith("issue create"));
      expect(created?.line).toContain("--title CI rouge sur main : E2E RLS Matrix");
      expect(created?.body).toContain("annulé");
      expect(created?.body).toContain("`rls-matrix`");
    });

    it("lets a newer revision's cancelled rls-matrix push run supersede an older green one", () => {
      const older = runOf(71, "E2E RLS Matrix", "push", "success", "a".repeat(40));
      const newer = runOf(72, "E2E RLS Matrix", "push", "cancelled", "d".repeat(40));
      const { stdout, lines } = alert(older, [listed("e2e-rls-matrix.yml", [newer, older]),
        { match: `api repos/${REPOSITORY}/compare/${older.head_sha}...${newer.head_sha}`, out: "ahead\n" },
        issues([{ number: 301, title: alertTitle("E2E RLS Matrix") }])]);
      expect(stdout).toContain("résultat dépassé");
      expect(lines.some((line) => /^issue (comment|close) /u.test(line))).toBe(false);
    });

    it("closes every open alert of the workflow on a green run, duplicates included", () => {
      const green = runOf(81, "E2E RLS Matrix", "schedule", "success", "e".repeat(40));
      const { lines } = alert(green, [listed("e2e-rls-matrix.yml", [green]),
        issues([{ number: 305, title: alertTitle("E2E RLS Matrix") }, { number: 301, title: alertTitle("E2E RLS Matrix") }])]);
      expect(lines.filter((line) => line.startsWith("issue close "))).toEqual([
        `issue close 301 --repo ${REPOSITORY}`, `issue close 305 --repo ${REPOSITORY}`]);
    });

    // Alerts of rls-matrix run in parallel: a newer red may conclude while an older green's alert is running. Checked
    // again right before writing, the older green then closes nothing, and the newer red's alert keeps the issue open.
    it("writes nothing when a newer revision concluded while the alert was running", () => {
      const older = runOf(91, "E2E RLS Matrix", "push", "success", "a".repeat(40));
      const newer = runOf(92, "E2E RLS Matrix", "push", "failure", "f".repeat(40));
      const { stdout, lines } = alert(older, [
        { match: `api repos/${REPOSITORY}/actions/workflows/e2e-rls-matrix.yml/runs?branch=main&status=completed`,
          out: [JSON.stringify({ workflow_runs: [older] }), JSON.stringify({ workflow_runs: [newer, older] })] },
        { match: `api repos/${REPOSITORY}/compare/${older.head_sha}...${newer.head_sha}`, out: "ahead\n" },
        issues([{ number: 301, title: alertTitle("E2E RLS Matrix") }])]);
      expect(stdout).toContain("résultat dépassé");
      expect(lines.some((line) => /^issue (comment|close) /u.test(line))).toBe(false);
    });
  });
});
