// Tells someone when a TesterArmy campaign of main (scheduled, or following a push) is red, and
// when it is green again. Runs with plain Node (type stripping, no npm install): node builtins,
// the runner's `gh` and erasable TypeScript syntax. Contract: docs/testing/tester-army-ci.md,
// section "Alerte des campagnes de main".
//
// One issue per watched workflow, found by its exact title among the open issues this alert
// opened: a red campaign opens it, or adds a comment when it is already open; the first green
// campaign closes it. A campaign that did not conclude (cancelled, skipped) changes nothing, nor
// does one that finishes after another gave its verdict on a later revision of main.
// The issue names the run, its failed jobs and every journey that did not pass, read from the
// manifest of the aggregate evidence. It only simulates unless ALERT_WRITE is "true" and the
// run is a campaign of main: a pull request's or a filtered run's result never reaches the issue.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The campaigns watched, by workflow name: their file and the artifact of their aggregate job. */
export const ALERT_WORKFLOWS: Record<string, { file: string; artifact: string }> = {
  "TesterArmy Full": { file: ".github/workflows/e2e-army-full.yml", artifact: "army-full-evidence" },
  "TesterArmy calc-v3": { file: ".github/workflows/e2e-army-calc-v3.yml", artifact: "army-calc-v3-evidence" },
};
/**
 * The events whose run of a watched workflow is a campaign of main: the schedule, and a push,
 * which those workflows only accept on main. Each runs the whole unfiltered campaign.
 */
export const ALERT_EVENTS = ["schedule", "push"];

export type AlertInput = {
  workflow: string;
  /** The run's conclusion, as the GitHub API gives it. */
  conclusion: string;
  runUrl: string;
  revision: string;
  /** When the run started (ISO 8601). */
  date: string;
  failedJobs: string[];
  /** The aggregate's journeys that did not pass; null when its evidence could not be read. */
  notPassed: string[] | null;
  /** The open issue of this workflow, if any. */
  openIssue: number | null;
};
export type AlertPlan =
  | { action: "none" }
  | { action: "create"; title: string; body: string }
  | { action: "comment"; issue: number; body: string }
  | { action: "close"; issue: number; body: string };

const RED = new Set(["failure", "timed_out", "startup_failure"]);
const LISTED = 100;

export const alertTitle = (workflow: string) => `CI rouge sur main : ${workflow}`;

export function planAlert(input: AlertInput): AlertPlan {
  const revision = `\`${input.revision.slice(0, 8)}\``;
  const day = input.date.slice(0, 10);
  if (input.conclusion === "success") {
    return input.openIssue === null ? { action: "none" } : { action: "close", issue: input.openIssue,
      body: `**${input.workflow}** est de nouveau vert sur ${revision} (campagne du ${day}).\n\nRun : ${input.runUrl}\n` };
  }
  if (!RED.has(input.conclusion)) return { action: "none" };
  const lines = [`**${input.workflow}** est rouge sur ${revision} (campagne du ${day}).`, "", `Run : ${input.runUrl}`, "",
    input.failedJobs.length
      ? `Jobs en échec : ${input.failedJobs.map((job) => `\`${job.replaceAll("`", "'")}\``).join(", ")}`
      : "Aucun job en échec n'a pu être listé : voir le run."];
  if (input.notPassed === null) {
    lines.push("", "Les parcours non passés n'ont pas pu être lus (preuves agrégées absentes ou illisibles) : voir le résumé du run.");
  } else if (input.notPassed.length === 0) {
    lines.push("", "Les preuves ne nomment aucun parcours rouge : l'échec peut précéder les parcours (préparation, build, base) ou tenir à l'agrégation des preuves.");
  } else {
    // A code span: a title can neither mention a user nor format the issue.
    lines.push("", `### Parcours non passés (${input.notPassed.length})`, "",
      ...input.notPassed.slice(0, LISTED).map((journey) => `- \`${journey.replaceAll("`", "'").replace(/\s+/gu, " ").slice(0, 300)}\``));
    if (input.notPassed.length > LISTED) lines.push("", `… et ${input.notPassed.length - LISTED} autres, dans le résumé du run.`);
  }
  lines.push("", "Ce ticket reçoit un commentaire à chaque campagne rouge de main (planifiée ou après un push) et se ferme seul à la première campagne verte.", "");
  const body = lines.join("\n");
  return input.openIssue === null ? { action: "create", title: alertTitle(input.workflow), body } : { action: "comment", issue: input.openIssue, body };
}

function gh(args: string[]): string {
  const result = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`gh ${args.slice(0, 3).join(" ")} failed: ${(result.stderr || result.error?.message || "").trim()}`);
  return result.stdout;
}

/**
 * The journeys the aggregate job recorded as not passed; null when its evidence cannot be read.
 * A re-run keeps the artifact of each attempt under one name: the newest is the one that matches
 * the run's conclusion and jobs.
 */
function readNotPassed(repository: string, runId: string, artifact: string): string[] | null {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "army-alert-"));
  try {
    const artifacts = (JSON.parse(gh(["api", `repos/${repository}/actions/runs/${runId}/artifacts?name=${artifact}&per_page=100`])) as
      { artifacts: { id: number; created_at: string; expired: boolean }[] }).artifacts.filter((entry) => !entry.expired)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (!artifacts.length) return null;
    const archive = path.join(directory, "evidence.zip");
    const download = spawnSync("gh", ["api", `repos/${repository}/actions/artifacts/${artifacts[0].id}/zip`], { maxBuffer: 512 * 1024 * 1024 });
    if (download.status !== 0) return null;
    fs.writeFileSync(archive, download.stdout);
    const manifest = spawnSync("unzip", ["-p", archive, "manifest.json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (manifest.status !== 0) return null;
    const notPassed = (JSON.parse(manifest.stdout) as { notPassed?: unknown }).notPassed;
    return Array.isArray(notPassed) && notPassed.every((entry) => typeof entry === "string") ? notPassed : null;
  } catch {
    return null;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

export type Campaign = { id: number; head_sha: string; html_url: string };

/**
 * The campaign that already gave its verdict on a later revision than this run's, if any. A
 * scheduled campaign and one that follows a push overlap: the older revision may finish last,
 * and its result must then neither close the alert a newer red one opened nor reopen one a
 * newer green one closed.
 */
export function supersededBy(run: { id: number; head_sha: string }, concluded: Campaign[],
  isAhead: (base: string, head: string) => boolean): Campaign | null {
  const shas = new Map<string, boolean>();
  for (const other of concluded) {
    if (other.id === run.id || other.head_sha === run.head_sha) continue;
    if (!shas.has(other.head_sha)) shas.set(other.head_sha, isAhead(run.head_sha, other.head_sha));
    if (shas.get(other.head_sha)) return other;
  }
  return null;
}

/** The open alert issues of a workflow: its exact title, opened by this workflow's token and by nobody else. */
export function alertIssues(issues: { number: number; title: string; author?: { login?: string; is_bot?: boolean } }[], title: string): number[] {
  return issues.filter((issue) => issue.title === title && issue.author?.is_bot === true &&
    ["app/github-actions", "github-actions", "github-actions[bot]"].includes(issue.author.login ?? ""))
    .map((issue) => issue.number).sort((a, b) => a - b);
}

function main() {
  const repository = process.env.ALERT_REPOSITORY ?? "";
  const runId = process.env.ALERT_RUN_ID ?? "";
  if (!/^[\w.-]+\/[\w.-]+$/u.test(repository) || !/^\d+$/u.test(runId)) throw new Error("ALERT_REPOSITORY (owner/name) and a numeric ALERT_RUN_ID are required.");
  const run = JSON.parse(gh(["api", `repos/${repository}/actions/runs/${runId}`])) as {
    id: number; name: string; event: string; conclusion: string | null; html_url: string; head_sha: string; head_branch: string; run_started_at: string;
  };
  const watched = ALERT_WORKFLOWS[run.name];
  if (!watched) throw new Error(`Run ${runId} belongs to « ${run.name} », which this alert does not watch.`);
  if (ALERT_EVENTS.includes(run.event) && (run.conclusion === "success" || RED.has(run.conclusion ?? ""))) {
    // The latest campaigns of main that concluded, newest first; a revision is compared once.
    const concluded = (JSON.parse(gh(["api", `repos/${repository}/actions/workflows/${path.basename(watched.file)}/runs?branch=${encodeURIComponent(run.head_branch)}&status=completed&per_page=30`])) as
      { workflow_runs: (Campaign & { event: string; conclusion: string | null })[] }).workflow_runs
      .filter((other) => ALERT_EVENTS.includes(other.event) && (other.conclusion === "success" || RED.has(other.conclusion ?? "")));
    const newer = supersededBy(run, concluded, (base, head) =>
      gh(["api", `repos/${repository}/compare/${base}...${head}`, "--jq", ".status"]).trim() === "ahead");
    if (newer) {
      const report = [`### Alerte ${run.name}`, "", `Run ${run.html_url} : résultat dépassé, rien n'est écrit. La campagne ${newer.html_url} a déjà rendu son verdict sur une révision plus récente (\`${newer.head_sha.slice(0, 8)}\`).`, ""].join("\n");
      if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
      console.log(report);
      return;
    }
  }
  // Only a campaign of main speaks for main: a pull request's or a dispatched (maybe filtered) run is simulated.
  const simulated = process.env.ALERT_WRITE !== "true" ? "simulation, rien n'est écrit"
    : !ALERT_EVENTS.includes(run.event) ? `simulation : run « ${run.event} », seule une campagne de main (planifiée ou après un push) écrit` : null;
  const conclusion = run.conclusion ?? "";
  // A job stopped by its time limit concludes "cancelled": in a red run it is named too.
  const failedJobs = RED.has(conclusion)
    ? gh(["api", "--paginate", `repos/${repository}/actions/runs/${runId}/jobs?per_page=100`, "--jq",
      '.jobs[] | select(.conclusion == "failure" or .conclusion == "timed_out" or .conclusion == "cancelled") | .name']).split("\n").filter(Boolean)
    : [];
  const title = alertTitle(run.name);
  const open = alertIssues(JSON.parse(gh(["issue", "list", "--repo", repository, "--state", "open", "--search", `in:title "${title}"`,
    "--json", "number,title,author", "--limit", "50"])), title);
  const plan = planAlert({ workflow: run.name, conclusion, runUrl: run.html_url, revision: run.head_sha, date: run.run_started_at,
    failedJobs, notPassed: RED.has(conclusion) ? readNotPassed(repository, runId, watched.artifact) : [], openIssue: open[0] ?? null });

  const report = [`### Alerte ${run.name}`, "", `Run ${run.html_url} : ${conclusion || "sans conclusion"}. Décision : ${plan.action}${simulated ? ` (${simulated})` : ""}.`, "",
    ...("body" in plan ? ["title" in plan ? `Titre : ${plan.title}` : `Ticket : #${plan.issue}`, "", plan.body] : [])].join("\n");
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  console.log(report);
  if (simulated || plan.action === "none") return;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "army-alert-body-")), "body.md");
  fs.writeFileSync(file, plan.body);
  if (plan.action === "create") {
    const created = gh(["issue", "create", "--repo", repository, "--title", plan.title, "--body-file", file]).trim();
    // Assigned afterwards: a login that cannot be assigned must not cost the alert itself.
    const assignees = (process.env.ALERT_ASSIGNEES ?? "").split(",").map((login) => login.trim()).filter((login) => /^[A-Za-z0-9-]+$/u.test(login));
    const number = /\/issues\/(\d+)$/u.exec(created)?.[1];
    if (assignees.length && number) {
      try { gh(["issue", "edit", number, "--repo", repository, "--add-assignee", assignees.join(",")]); } catch (error) {
        console.log(`::warning title=CI night alert::${(error as Error).message.replace(/\r?\n/gu, " ")}`);
      }
    }
  } else if (plan.action === "comment") {
    gh(["issue", "comment", String(plan.issue), "--repo", repository, "--body-file", file]);
  } else {
    // Every open alert of the workflow closes, should a second one ever have been opened.
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
