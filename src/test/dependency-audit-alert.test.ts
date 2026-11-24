// @vitest-environment node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  AUDIT_ALERT_TITLE, alertSimulation, listOpenAuditAlerts, planDependencyAuditAlert, type AuditAlertInput,
} from "../../scripts/dependency-audit-alert";

const root = process.cwd();
const RUN = "https://github.com/example/repository/actions/runs/77";
const red = (overrides: Partial<AuditAlertInput> = {}): AuditAlertInput => ({
  runUrl: RUN, revision: "df20b136d3c91ebac5212fba2f9eecd773a462ef", date: "2026-11-25T05:45:12Z",
  findings: [{ package: "left-pad", severity: "high", source: 1234, title: "ReDoS in left-pad", url: "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz" }],
  exceptionErrors: [], openIssue: null, ...overrides,
});

describe("daily alert of the dependency audit of main", () => {
  it("opens one issue that names the run, the revision and every blocking advisory", () => {
    const plan = planDependencyAuditAlert(red());
    expect(plan).toMatchObject({ action: "create", title: "Audit des dépendances rouge sur main" });
    expect(AUDIT_ALERT_TITLE).toBe("Audit des dépendances rouge sur main");
    if (plan.action !== "create") throw new Error("unreachable");
    expect(plan.body).toContain("`df20b136`");
    expect(plan.body).toContain("audit du 2026-11-25");
    expect(plan.body).toContain(RUN);
    expect(plan.body).toContain("### Avis bloquants (1)");
    expect(plan.body).toContain("- `high` `left-pad` source 1234 : `ReDoS in left-pad` https://github.com/advisories/GHSA-xxxx-yyyy-zzzz");
    expect(plan.body).toContain("config/dependency-audit-policy.json");
  });

  it("comments the open issue instead of opening a second one", () => {
    expect(planDependencyAuditAlert(red({ openIssue: 312 }))).toMatchObject({ action: "comment", issue: 312 });
  });

  it("reports an expired or unused exception as red, like the gate does", () => {
    const plan = planDependencyAuditAlert(red({ findings: [], exceptionErrors: ["expired exception: left-pad source 1234 expired at 2026-11-20T00:00:00Z"] }));
    expect(plan.action).toBe("create");
    if (plan.action !== "create") throw new Error("unreachable");
    expect(plan.body).toContain("### Exceptions à revoir (1)");
    expect(plan.body).toContain("- `expired exception: left-pad source 1234 expired at 2026-11-20T00:00:00Z`");
    expect(plan.body).not.toContain("### Avis bloquants");
  });

  it("closes the open issue on the first clean audit and stays silent when none is open", () => {
    const closed = planDependencyAuditAlert(red({ findings: [], openIssue: 312 }));
    expect(closed).toMatchObject({ action: "close", issue: 312 });
    if (closed.action !== "close") throw new Error("unreachable");
    expect(closed.body).toContain(RUN);
    expect(planDependencyAuditAlert(red({ findings: [] }))).toEqual({ action: "none" });
  });

  it("keeps advisory text inert and the body within an issue's size", () => {
    const plan = planDependencyAuditAlert(red({
      findings: [
        { package: "evil", severity: "critical", source: 1, title: "pings @someone with `code`\nand a second line", url: "javascript:alert(1)" },
        ...Array.from({ length: 150 }, (_, index) => ({ package: `pkg-${index}`, severity: "moderate" as const, source: 100 + index, title: "x".repeat(2_000) })),
      ],
    }));
    if (plan.action !== "create") throw new Error("unreachable");
    expect(plan.body).toContain("- `critical` `evil` source 1 : `pings @someone with 'code' and a second line`\n");
    expect(plan.body).not.toContain("javascript:");
    expect(plan.body).toContain("### Avis bloquants (151)");
    expect(plan.body).toContain("… et 51 autres, dans le résumé du run.");
    expect(plan.body.length).toBeLessThan(60_000);
  });

  it("runs every day on main with the least privileges, and writes only for a run of main", () => {
    const workflow = fs.readFileSync(path.join(root, ".github/workflows/dependency-audit-alert.yml"), "utf8");
    expect(workflow).toMatch(/^name: Dependency audit alert$/mu);
    expect(workflow).toMatch(/^ {2}schedule:\n {4}- cron: "45 5 \* \* \*"\n/mu);
    expect(workflow).toMatch(/^ {2}workflow_dispatch:\n/mu);
    expect(workflow).not.toMatch(/^ {2}(pull_request|pull_request_target|push|workflow_run):/mu);
    // The token that writes issues belongs to the one job that needs it.
    expect(workflow).toMatch(/^permissions:\n {2}contents: read\n/mu);
    expect(workflow).toMatch(/^ {4}permissions:\n {6}contents: read\n {6}issues: write\n {4}\S/mu);
    // A dispatch only simulates unless asked to write, and the script refuses to write outside main.
    expect(workflow).toContain("ALERT_WRITE: ${{ github.event_name == 'schedule' || inputs.write }}");
    expect(workflow).toContain("run: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/dependency-audit-alert.ts");
    expect(alertSimulation({ ALERT_WRITE: "true", GITHUB_REF: "refs/heads/main" })).toBeNull();
    expect(alertSimulation({ ALERT_WRITE: "false", GITHUB_REF: "refs/heads/main" })).toContain("simulation");
    expect(alertSimulation({ GITHUB_REF: "refs/heads/main" })).toContain("simulation");
    expect(alertSimulation({ ALERT_WRITE: "true", GITHUB_REF: "refs/heads/ci/branch" })).toContain("refs/heads/ci/branch");
    expect(alertSimulation({ ALERT_WRITE: "true" })).toContain("simulation");
  });
});

describe("the token that writes issues runs no third-party package code", () => {
  const script = path.join(root, "scripts/dependency-audit-alert.ts");

  it("installs nothing in the job: npm audit reads package-lock.json alone", () => {
    const workflow = fs.readFileSync(path.join(root, ".github/workflows/dependency-audit-alert.yml"), "utf8");
    const code = workflow.split("\n").filter((line) => !/^\s*#/u.test(line)).join("\n");
    // No install (whose packages' scripts would run), no package runner, no loader from node_modules.
    expect(code).not.toMatch(/\bnpm\s+(ci|install|i|exec|run|rebuild)\b|\bnpx\b|\btsx\b|\byarn\b|\bpnpm\b|--import|--require|NODE_OPTIONS/u);
    // Nor a dependency cache restored into the job.
    expect(code).not.toMatch(/^\s+cache:/mu);
    expect([...code.matchAll(/^\s+(?:- )?uses: ([^@\s]+)@/gmu)].map((match) => match[1])).toEqual(["actions/checkout", "actions/setup-node"]);
  });

  it("imports only Node built-ins and repository files, so plain node runs it", () => {
    const seen = new Set<string>();
    const queue = [script];
    while (queue.length) {
      const file = queue.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      const source = fs.readFileSync(file, "utf8");
      expect(source, path.relative(root, file)).not.toMatch(/\bimport\s*\(|\brequire\s*\(/u);
      for (const [, from, bare] of source.matchAll(/^\s*(?:import|export)\b[^"'`;=]*?\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']/gmu)) {
        const specifier = from ?? bare;
        if (specifier.startsWith("node:")) continue;
        expect(specifier, `${path.relative(root, file)} imports ${specifier}`).toMatch(/^\.\.?\/[^:]*\.ts$/u);
        queue.push(path.resolve(path.dirname(file), specifier));
      }
    }
    expect([...seen].map((file) => path.relative(root, file)).sort()).toEqual([
      "scripts/dependency-audit-alert.ts", "scripts/tester-army/nightly-alert.ts", "src/test/dependency-audit.ts",
    ]);
    // The workflow's command, without any loader: it reaches its own input check, before npm or gh.
    const run = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script], {
      cwd: root, encoding: "utf8", env: { NODE_ENV: "test", PATH: process.env.PATH, HOME: process.env.HOME },
    });
    expect(run.status, run.stderr).toBe(1);
    expect(run.stderr).toContain("GITHUB_REPOSITORY (owner/name)");
  });

  it("finds the open alert by its author and exact title, without the lagging search index", () => {
    const calls: string[][] = [];
    const bot = { login: "app/github-actions", is_bot: true };
    const open = listOpenAuditAlerts("owner/repository", (args) => {
      calls.push(args);
      return JSON.stringify([
        { number: 41, title: AUDIT_ALERT_TITLE, author: bot },
        { number: 40, title: `${AUDIT_ALERT_TITLE} (copie)`, author: bot },
        { number: 39, title: AUDIT_ALERT_TITLE, author: { login: "someone", is_bot: false } },
        { number: 12, title: AUDIT_ALERT_TITLE, author: bot },
      ]);
    });
    expect(open).toEqual([12, 41]);
    // gh reads --author through the issues connection (filterBy.createdBy), which wants the bot's
    // login: "app/github-actions" there matches nothing.
    expect(calls).toEqual([["issue", "list", "--repo", "owner/repository", "--state", "open", "--author", "github-actions[bot]",
      "--json", "number,title,author", "--limit", "200"]]);
    expect(calls[0]).not.toContain("--search");
  });
});

describe("Dependabot and the pinned Supabase CLI", () => {
  it("opens no pull request for the CLI, whose upgrade changes the pin, the bundle and the generated types together", () => {
    const config = fs.readFileSync(path.join(root, ".github/dependabot.yml"), "utf8");
    const npm = /^ {2}- package-ecosystem: "npm"\n((?: {4}.*\n|\n)+?)(?=^ {2}- |(?![\s\S]))/mu.exec(config)?.[1] ?? "";
    expect(npm).toMatch(/^ {4}ignore:\n {6}- dependency-name: "supabase"\n/mu);
    // Ignored outright, not only kept out of a group whose own pull request would still be red.
    expect(npm.match(/"supabase"/gu)).toHaveLength(1);
    const guide = fs.readFileSync(path.join(root, "docs/testing/tester-army-ci.md"), "utf8");
    const section = /^## Mise à jour du CLI Supabase\n([\s\S]*?)(?=^## )/mu.exec(guide)?.[1] ?? "";
    // The ignore also silences Dependabot's security updates: the daily audit alert is what reports the CLI.
    expect(section).toContain("mises à jour de sécurité");
    expect(section).toContain("Audit des dépendances rouge sur main");
  });
});
