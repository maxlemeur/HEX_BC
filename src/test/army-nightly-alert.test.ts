// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ALERT_EVENTS, ALERT_WORKFLOWS, alertIssues, alertTitle, planAlert, supersededBy, type AlertInput } from "../../scripts/tester-army/nightly-alert";

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
    ], title)).toEqual([22, 40]);
  });

  it("watches exactly the campaigns of main its workflow is triggered by, each with its aggregate evidence", () => {
    const workflow = fs.readFileSync(path.join(root, ".github/workflows/ci-night-alert.yml"), "utf8");
    const watched = /^ {4}workflows: \[(.+)\]$/mu.exec(workflow)?.[1].split(",").map((name) => name.trim().replace(/^"|"$/gu, ""));
    expect(watched?.sort()).toEqual(Object.keys(ALERT_WORKFLOWS).sort());
    for (const [name, { file, artifact }] of Object.entries(ALERT_WORKFLOWS)) {
      const watchedWorkflow = fs.readFileSync(path.join(root, file), "utf8");
      expect(watchedWorkflow, file).toMatch(new RegExp(`^name: ${name}$`, "mu"));
      expect(watchedWorkflow, file).toContain(artifact);
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
});
