// Daily npm audit of main (.github/workflows/dependency-audit-alert.yml). A pull request that
// does not change a dependency file only gets a warning from the audit (src/test/dependency-audit-scope.ts),
// so a new advisory against main reaches nobody by itself. This keeps one issue,
// « Audit des dépendances rouge sur main »: a red audit opens it, or comments it while it is
// open; the first clean audit closes it. Contract: docs/testing/tester-army-ci.md,
// section "Audit des dépendances".
//
// Red means what the Quality Gate would block on: an unexcepted moderate, high or critical
// advisory, or an expired or unused exception. An audit that cannot run fails this run and
// writes nothing. It only simulates unless ALERT_WRITE is "true" and the run is on main.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runDependencyAudit, type DependencyAuditFinding } from "../src/test/dependency-audit";
import { alertIssues, type AlertPlan } from "./tester-army/nightly-alert";

export const AUDIT_ALERT_TITLE = "Audit des dépendances rouge sur main";
const POLICY_PATH = "config/dependency-audit-policy.json";
const LISTED = 100;

export type AuditAlertInput = {
  runUrl: string;
  revision: string;
  /** When the audit ran (ISO 8601). */
  date: string;
  /** The blocking advisories no active exception covers. */
  findings: DependencyAuditFinding[];
  /** Expired or unused exceptions. */
  exceptionErrors: string[];
  /** The open alert issue, if any. */
  openIssue: number | null;
};

/** A code span: advisory text can neither mention a user nor format the issue. */
const inert = (text: string) => `\`${text.replaceAll("`", "'").replace(/\s+/gu, " ").trim().slice(0, 300)}\``;

function findingLine(finding: DependencyAuditFinding) {
  const title = finding.title ? ` : ${inert(finding.title)}` : "";
  const url = finding.url && /^https:\/\/[^\s<>()[\]]+$/u.test(finding.url) ? ` ${finding.url}` : "";
  return `- ${inert(finding.severity)} ${inert(finding.package)} source ${finding.source}${title}${url}`;
}

function listed<T>(heading: string, entries: T[], line: (entry: T) => string) {
  if (!entries.length) return [];
  const lines = ["", `### ${heading} (${entries.length})`, "", ...entries.slice(0, LISTED).map(line)];
  if (entries.length > LISTED) lines.push("", `… et ${entries.length - LISTED} autres, dans le résumé du run.`);
  return lines;
}

export function planDependencyAuditAlert(input: AuditAlertInput): AlertPlan {
  const revision = `\`${input.revision.slice(0, 8)}\``;
  const day = input.date.slice(0, 10);
  if (!input.findings.length && !input.exceptionErrors.length) {
    return input.openIssue === null ? { action: "none" } : { action: "close", issue: input.openIssue,
      body: `L'audit des dépendances de \`main\` est de nouveau propre sur ${revision} (audit du ${day}).\n\nRun : ${input.runUrl}\n` };
  }
  const body = [
    `L'audit des dépendances de \`main\` est rouge sur ${revision} (audit du ${day}).`, "", `Run : ${input.runUrl}`,
    ...listed("Avis bloquants", input.findings, findingLine),
    ...listed("Exceptions à revoir", input.exceptionErrors, (error) => `- ${inert(error)}`),
    "",
    `Les pull requests qui ne modifient pas les fichiers de dépendances ne sont pas bloquées par ces avis. Pour corriger : mettre à jour la dépendance (\`npm update\`, \`overrides\`), ou déclarer une exception datée dans \`${POLICY_PATH}\` ; la pull request qui le fait passe l'audit bloquant.`,
    "",
    "Ce ticket reçoit un commentaire à chaque audit quotidien rouge et se ferme seul au premier audit propre.",
    "",
  ].join("\n");
  return input.openIssue === null ? { action: "create", title: AUDIT_ALERT_TITLE, body } : { action: "comment", issue: input.openIssue, body };
}

/** Why this run only simulates, or null when it writes: only a run on main asked to write does. */
export function alertSimulation(environment: Record<string, string | undefined>): string | null {
  if (environment.ALERT_WRITE !== "true") return "simulation, rien n'est écrit";
  if (environment.GITHUB_REF !== "refs/heads/main") return `simulation : run sur « ${environment.GITHUB_REF ?? ""} », seul un audit de main écrit`;
  return null;
}

function gh(args: string[]): string {
  const result = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`gh ${args.slice(0, 3).join(" ")} failed: ${(result.stderr || result.error?.message || "").trim()}`);
  return result.stdout;
}

function main() {
  const repository = process.env.GITHUB_REPOSITORY ?? "";
  const runId = process.env.GITHUB_RUN_ID ?? "";
  const revision = process.env.GITHUB_SHA ?? "";
  if (!/^[\w.-]+\/[\w.-]+$/u.test(repository) || !/^\d+$/u.test(runId) || !/^[0-9a-f]{40}$/u.test(revision)) {
    throw new Error("GITHUB_REPOSITORY (owner/name), a numeric GITHUB_RUN_ID and GITHUB_SHA are required.");
  }
  const runUrl = `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${repository}/actions/runs/${runId}`;
  const evaluation = runDependencyAudit();
  const simulated = alertSimulation(process.env);
  const open = alertIssues(JSON.parse(gh(["issue", "list", "--repo", repository, "--state", "open", "--search", `in:title "${AUDIT_ALERT_TITLE}"`,
    "--json", "number,title,author", "--limit", "50"])), [AUDIT_ALERT_TITLE]);
  const plan = planDependencyAuditAlert({ runUrl, revision, date: new Date().toISOString(), findings: evaluation.unexceptedFindings,
    exceptionErrors: evaluation.exceptionErrors, openIssue: open[0] ?? null });

  const report = ["### Audit des dépendances de main", "",
    `${evaluation.errors.length ? `Rouge : ${evaluation.errors.length} erreur(s)` : "Propre"}, ${evaluation.exceptedFindings.length} exception(s) active(s). Décision : ${plan.action}${simulated ? ` (${simulated})` : ""}.`, "",
    ...("body" in plan ? ["title" in plan ? `Titre : ${plan.title}` : `Ticket : #${plan.issue}`, "", plan.body] : [])].join("\n");
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  console.log(report);
  if (simulated || plan.action === "none") return;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dependency-audit-alert-")), "body.md");
  fs.writeFileSync(file, plan.body);
  if (plan.action === "create") {
    const created = gh(["issue", "create", "--repo", repository, "--title", plan.title, "--body-file", file]).trim();
    // Assigned afterwards: a login that cannot be assigned must not cost the alert itself.
    const assignees = (process.env.ALERT_ASSIGNEES ?? "").split(",").map((login) => login.trim()).filter((login) => /^[A-Za-z0-9-]+$/u.test(login));
    const number = /\/issues\/(\d+)$/u.exec(created)?.[1];
    if (assignees.length && number) {
      try { gh(["issue", "edit", number, "--repo", repository, "--add-assignee", assignees.join(",")]); } catch (error) {
        console.log(`::warning title=Dependency audit alert::${(error as Error).message.replace(/\r?\n/gu, " ")}`);
      }
    }
  } else if (plan.action === "comment") {
    gh(["issue", "comment", String(plan.issue), "--repo", repository, "--body-file", file]);
  } else {
    // Every open alert closes, should a second one ever have been opened.
    for (const issue of open) {
      gh(["issue", "comment", String(issue), "--repo", repository, "--body-file", file]);
      gh(["issue", "close", String(issue), "--repo", repository]);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
