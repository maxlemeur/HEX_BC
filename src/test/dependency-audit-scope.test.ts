// @vitest-environment node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DEPENDENCY_AUDIT_TRIGGER_FILES,
  dependencyAuditVerdict,
  resolveDependencyAuditScope,
} from "@/test/dependency-audit-scope";

const root = process.cwd();
const ZERO = "0".repeat(40);

function git(directory: string, ...args: string[]) {
  const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function commit(directory: string, files: Record<string, string>, message: string) {
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.writeFileSync(path.join(directory, file), content);
  }
  git(directory, "add", "-A");
  git(directory, "commit", "-q", "-m", message);
  return git(directory, "rev-parse", "HEAD");
}

/**
 * A repository shaped like the Quality Gate's checkout:
 *   base ── source (src only) ── lock (package-lock.json) ── npmrc (.npmrc) ── policy (audit exceptions)
 *     └── mainDeps (package.json on main after the branch started)
 */
let repository: string;
const sha: Record<string, string> = {};

beforeAll(() => {
  repository = fs.mkdtempSync(path.join(os.tmpdir(), "dependency-audit-scope-"));
  git(repository, "init", "-q", "-b", "main");
  git(repository, "config", "user.email", "ci@example.test");
  git(repository, "config", "user.name", "CI");
  git(repository, "config", "commit.gpgsign", "false");
  sha.base = commit(repository, {
    "package.json": '{"name":"fixture"}\n',
    "package-lock.json": '{"lockfileVersion":3}\n',
    ".npmrc": "audit=true\n",
    "config/dependency-audit-policy.json": '{"version":1,"exceptions":[]}\n',
    "src/a.ts": "export const a = 1;\n",
  }, "base");
  sha.mainDeps = commit(repository, { "package.json": '{"name":"fixture","version":"2.0.0"}\n' }, "main changes package.json");
  git(repository, "checkout", "-q", "-b", "feature", sha.base);
  sha.source = commit(repository, { "src/a.ts": "export const a = 2;\n" }, "source only");
  sha.lock = commit(repository, { "package-lock.json": '{"lockfileVersion":3,"packages":{}}\n' }, "lockfile");
  sha.npmrc = commit(repository, { ".npmrc": "audit=true\nfund=false\n" }, "npmrc");
  sha.policy = commit(repository, { "config/dependency-audit-policy.json": '{"version":1,"exceptions":[{}]}\n' }, "policy");
});

afterAll(() => {
  fs.rmSync(repository, { force: true, recursive: true });
});

function scopeAt(head: string, environment: Record<string, string | undefined>) {
  git(repository, "checkout", "-q", "--detach", head);
  return resolveDependencyAuditScope({ environment, rootDirectory: repository });
}

describe("which runs of the dependency audit block", () => {
  it("blocks a pull request only when it changes a dependency file or the audit exceptions", () => {
    const pullRequest = (head: string) => scopeAt(head, { DEPENDENCY_AUDIT_EVENT: "pull_request", DEPENDENCY_AUDIT_BASE: sha.base });
    expect(pullRequest(sha.source)).toMatchObject({ blocking: false, changedFiles: [] });
    expect(pullRequest(sha.lock)).toMatchObject({ blocking: true, changedFiles: ["package-lock.json"] });
    expect(pullRequest(sha.npmrc)).toMatchObject({ blocking: true, changedFiles: [".npmrc", "package-lock.json"] });
    expect(pullRequest(sha.policy).changedFiles).toContain("config/dependency-audit-policy.json");
    expect(DEPENDENCY_AUDIT_TRIGGER_FILES).toEqual(["package.json", "package-lock.json", ".npmrc", "config/dependency-audit-policy.json"]);
  });

  it("judges a pull request by its own changes, not by what main changed since it started", () => {
    // The base main has moved to a package.json change; the pull request itself changed only source.
    expect(scopeAt(sha.source, { DEPENDENCY_AUDIT_EVENT: "pull_request", DEPENDENCY_AUDIT_BASE: sha.mainDeps }))
      .toMatchObject({ blocking: false, changedFiles: [] });
  });

  it("blocks a push to main only when its before..after range changes a dependency file", () => {
    const push = (before: string, head: string, forced = "false") =>
      scopeAt(head, { DEPENDENCY_AUDIT_EVENT: "push", DEPENDENCY_AUDIT_BASE: before, DEPENDENCY_AUDIT_FORCED: forced });
    expect(push(sha.base, sha.source)).toMatchObject({ blocking: false, changedFiles: [] });
    // Only the pushed range counts: package-lock.json changed before `lock`, not in lock..npmrc.
    expect(push(sha.lock, sha.npmrc)).toMatchObject({ blocking: true, changedFiles: [".npmrc"] });
    expect(push(sha.source, sha.lock)).toMatchObject({ blocking: true, changedFiles: ["package-lock.json"] });
  });

  it("counts a forced or first push as a dependency change", () => {
    const push = (before: string | undefined, head: string, forced?: string) =>
      scopeAt(head, { DEPENDENCY_AUDIT_EVENT: "push", DEPENDENCY_AUDIT_BASE: before, DEPENDENCY_AUDIT_FORCED: forced });
    // GitHub says so for a forced push.
    expect(push(sha.base, sha.source, "true")).toMatchObject({ blocking: true });
    // A rewritten history, even unflagged: the old head is no ancestor of the new one.
    expect(push(sha.mainDeps, sha.source, "false")).toMatchObject({ blocking: true });
    // The first push of a branch has no before.
    expect(push(ZERO, sha.source)).toMatchObject({ blocking: true });
    expect(push("", sha.source)).toMatchObject({ blocking: true });
    expect(push(undefined, sha.source)).toMatchObject({ blocking: true });
  });

  it("blocks whenever the changes cannot be known", () => {
    const unknown = "1234567890abcdef1234567890abcdef12345678";
    for (const [event, base] of [["pull_request", ""], ["pull_request", "main"], ["pull_request", unknown], ["push", "not-a-sha"], ["push", unknown]]) {
      expect(scopeAt(sha.source, { DEPENDENCY_AUDIT_EVENT: event, DEPENDENCY_AUDIT_BASE: base }).blocking, `${event} ${base}`).toBe(true);
    }
  });

  it("keeps blocking outside a pull request or a push: a manual run, a schedule, a local gate", () => {
    for (const event of ["workflow_dispatch", "schedule", "", undefined]) {
      expect(scopeAt(sha.source, { DEPENDENCY_AUDIT_EVENT: event, DEPENDENCY_AUDIT_BASE: sha.base }).blocking, String(event)).toBe(true);
    }
  });
});

describe("what the audit step reports", () => {
  const notBlocking = { blocking: false, changedFiles: [], reason: "aucun fichier de dépendances modifié" };
  const blocking = { blocking: true, changedFiles: ["package-lock.json"], reason: "modifie package-lock.json" };
  const failure = "Dependency audit gate failed:\n- high vulnerability: left-pad source 1234\n- 100% of nothing";

  it("turns advisories into a warning and a summary line when no dependency file changed", () => {
    const verdict = dependencyAuditVerdict(notBlocking, failure);
    expect(verdict.exitCode).toBe(0);
    // One workflow command: its newlines and percent signs are escaped, never a second command.
    expect(verdict.annotation).toBe("::warning title=Audit des dépendances (non bloquant)::Dependency audit gate failed:%0A- high vulnerability: left-pad source 1234%0A- 100%25 of nothing");
    expect(verdict.summary).toContain("non bloquant");
    expect(verdict.summary).toContain("aucun fichier de dépendances modifié");
    expect(verdict.summary).toContain("high vulnerability: left-pad source 1234");
  });

  it("fails the step when a dependency file changed", () => {
    const verdict = dependencyAuditVerdict(blocking, failure);
    expect(verdict).toMatchObject({ exitCode: 1, annotation: null });
    expect(verdict.summary).toContain("bloquant");
    expect(verdict.summary).toContain("modifie package-lock.json");
  });

  it("passes a clean audit whatever the scope", () => {
    for (const scope of [notBlocking, blocking]) {
      expect(dependencyAuditVerdict(scope, null)).toMatchObject({ exitCode: 0, annotation: null });
    }
  });
});

describe("the Quality Gate audit step", () => {
  function step(workflow: string, name: string) {
    const match = new RegExp(`^ {6}- name: ${name}\\n((?: {8}.*\\n)+)`, "mu").exec(workflow);
    if (!match) throw new Error(`step ${name} not found`);
    return match[1];
  }

  it("hands the event, its base and the forced flag to the audit, and nothing lets it pass by itself", () => {
    const workflow = fs.readFileSync(path.join(root, ".github/workflows/quality-gate.yml"), "utf8");
    expect(step(workflow, "Audit dependencies")).toBe([
      "        if: ${{ !cancelled() }}",
      "        env:",
      "          DEPENDENCY_AUDIT_EVENT: ${{ github.event_name }}",
      "          DEPENDENCY_AUDIT_BASE: ${{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || github.event.before }}",
      "          DEPENDENCY_AUDIT_FORCED: ${{ github.event.forced }}",
      "        run: npm run audit:dependencies",
      "",
    ].join("\n"));
    // The signatures check is untouched and always blocks.
    expect(step(workflow, "Verify dependency signatures")).toBe("        if: ${{ !cancelled() }}\n        run: npm run audit:signatures\n");
    // The static job keeps its full history, which the base needs.
    expect(workflow).toMatch(/^ {2}static:\n(?: {4}.*\n|\n)*? {10}fetch-depth: 0\n/mu);
  });

  // The real command, in a repository with a blocking advisory: npm is replaced by a script that prints it.
  it("cannot fail the job when no dependency file changed, and fails it when one did", () => {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), "dependency-audit-npm-"));
    try {
      const report = {
        auditReportVersion: 2,
        vulnerabilities: { "left-pad": { name: "left-pad", severity: "high", via: [{ dependency: "left-pad", name: "left-pad", severity: "high", source: 1234, title: "ReDoS", url: "https://example.test/1234" }] } },
        metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 } },
      };
      fs.writeFileSync(path.join(bin, "report.json"), JSON.stringify(report));
      fs.writeFileSync(path.join(bin, "npm"), `#!/bin/sh\ncat "${path.join(bin, "report.json")}"\nexit 1\n`);
      fs.chmodSync(path.join(bin, "npm"), 0o755);
      const run = (head: string) => {
        git(repository, "checkout", "-q", "--detach", head);
        const summary = path.join(bin, `summary-${head}.md`);
        const result = spawnSync(process.execPath, ["--import", path.join(root, "node_modules/tsx/dist/loader.mjs"), path.join(root, "scripts/check-dependency-audit.ts")], {
          cwd: repository, encoding: "utf8",
          env: { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`, HOME: process.env.HOME, GITHUB_STEP_SUMMARY: summary,
            DEPENDENCY_AUDIT_EVENT: "pull_request", DEPENDENCY_AUDIT_BASE: sha.base, DEPENDENCY_AUDIT_FORCED: "" },
        });
        return { ...result, summary: fs.existsSync(summary) ? fs.readFileSync(summary, "utf8") : "" };
      };
      const unrelated = run(sha.source);
      expect(unrelated.status, unrelated.stdout + unrelated.stderr).toBe(0);
      expect(unrelated.stdout).toContain("::warning title=Audit des dépendances (non bloquant)::");
      expect(unrelated.stdout).toContain("high vulnerability: left-pad source 1234");
      expect(unrelated.summary).toContain("non bloquant");

      const lockfile = run(sha.lock);
      expect(lockfile.status, lockfile.stdout + lockfile.stderr).toBe(1);
      expect(lockfile.stdout).not.toContain("::warning");
      expect(lockfile.stderr).toContain("high vulnerability: left-pad source 1234");
      expect(lockfile.summary).toContain("modifie package-lock.json");
    } finally {
      fs.rmSync(bin, { force: true, recursive: true });
    }
  });
});
