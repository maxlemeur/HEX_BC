// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ALERT_WORKFLOWS } from "../../scripts/tester-army/nightly-alert";
import { loadImpactMap, matchesAny } from "../../scripts/tester-army/select-journeys";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

type Github = { event_name: string; ref: string; run_id: number };

/**
 * What GitHub computes for a workflow value: each `${{ }}` expression evaluated for one event.
 * The expressions of these workflows only use comparisons, `&&`, `||`, `!`, literals and the
 * `github` context, which JavaScript evaluates the same way.
 */
function evaluate(value: string, github: Github): string {
  const text = value.trim().replace(/^(["'])(.*)\1$/u, "$2");
  return text.replace(/\$\{\{(.+?)\}\}/gu, (_, expression: string) =>
    String(new Function("github", "inputs", `return (${expression});`)(github, {})));
}

/** The value of a key of a workflow, at one indentation, within a block that starts at a given line. */
function valueOf(workflow: string, block: RegExp, key: string): string {
  const start = block.exec(workflow);
  if (!start) throw new Error(`No block ${block}.`);
  const value = new RegExp(`^ +${key}: *(.+)$`, "mu").exec(workflow.slice(start.index));
  if (!value) throw new Error(`No ${key} under ${block}.`);
  return value[1];
}

/** The globs of a block list under `paths-ignore` of the push trigger, in either list style. */
function pushPathsIgnored(workflow: string): string[] {
  const push = /^ {2}push:\n((?: {4,}.*\n|\n)+)/mu.exec(workflow)?.[1] ?? "";
  const list = /^ {4}paths-ignore:(?: *\[(.*)\]\n|\n((?: {6,}- .+\n)+))/mu.exec(push);
  if (!list) return [];
  const entries = list[1] !== undefined ? list[1].split(",") : list[2].split("\n").map((line) => line.replace(/^ *- /u, ""));
  return entries.map((entry) => entry.trim().replace(/^(["'])(.*)\1$/u, "$2")).filter(Boolean);
}

const event = (event_name: string, ref = "refs/heads/main", run_id = 1): Github => ({ event_name, ref, run_id });

// The Critical run of a push to main leaves out the takeoff, extended and development journeys
// and the calc-v3 phases. The full and calc-v3 campaigns follow the push on main, but the account
// runs 20 jobs at once and a busy day brings more than twenty pushes: they must stay one at a
// time, few jobs wide, and never be started or superseded by a push of documentation only.
describe("full and calc-v3 campaigns of main after a push", () => {
  const shards = JSON.parse(read("scripts/tester-army/army-shards.json")) as { suites: { full: { maxShards: number } }; calcV3: { maxGroups: number } };
  const campaigns = [
    { file: ".github/workflows/e2e-army-full.yml", job: /^ {2}army-full-shard:$/mu, widest: shards.suites.full.maxShards },
    { file: ".github/workflows/e2e-army-calc-v3.yml", job: /^ {2}army-calc-v3-group:$/mu, widest: shards.calcV3.maxGroups },
  ];

  it("covers exactly the workflows whose red result on main raises the alert", () => {
    expect(campaigns.map((campaign) => campaign.file).sort()).toEqual(Object.values(ALERT_WORKFLOWS).map((workflow) => workflow.file).sort());
  });

  for (const { file, job, widest } of campaigns) {
    const workflow = read(file);

    it(`${file} follows a push to main unless it changes documentation only`, () => {
      expect(valueOf(workflow, /^ {2}push:$/mu, "branches")).toBe("[main]");
      const ignored = pushPathsIgnored(workflow);
      // GitHub starts the workflow when one changed path escapes the ignored globs.
      const starts = (paths: string[]) => paths.some((changed) => !matchesAny(changed, ignored));
      expect(starts(["docs/testing/tester-army-ci.md", "README.md", "src/components/affaires/notes.md"])).toBe(false);
      for (const code of ["src/components/affaires/AffaireHub.tsx", "e2e/army/takeoff/intake-dossier.e2e.ts", "supabase/migrations/1.sql", "package.json"]) {
        expect(starts(["docs/testing/tester-army-ci.md", code]), code).toBe(true);
      }
      // The same documentation paths as the critical selection of a push: one definition of "documentation only".
      const { docs } = loadImpactMap(root).map;
      for (const sample of ["docs/a.md", "docs/deep/b.png", "AGENTS.md", "src/x/y.md", "src/x/y.ts", "docs.ts", ".github/workflows/a.yml"]) {
        expect(matchesAny(sample, ignored), sample).toBe(matchesAny(sample, docs));
      }
    });

    it(`${file} runs one push campaign at a time and never cancels a running one`, () => {
      const group = (github: Github) => evaluate(valueOf(workflow, /^concurrency:$/mu, "group"), github);
      const cancels = (github: Github) => evaluate(valueOf(workflow, /^concurrency:$/mu, "cancel-in-progress"), github);
      // Every push shares one group: GitHub then keeps one run in progress and the newest pending.
      expect(group(event("push", "refs/heads/main", 1))).toBe(group(event("push", "refs/heads/main", 2)));
      expect(cancels(event("push"))).toBe("false");
      // The scheduled and dispatched campaigns stay outside that queue, each on its own.
      for (const name of ["schedule", "workflow_dispatch"]) {
        expect(group(event(name, "refs/heads/main", 1)), name).not.toBe(group(event(name, "refs/heads/main", 2)));
        expect(group(event(name)), name).not.toBe(group(event("push")));
        expect(cancels(event(name)), name).toBe("false");
      }
      // A pull request keeps its own group per branch, where a new push replaces the run in progress.
      expect(group(event("pull_request", "refs/pull/1/merge", 1))).toBe(group(event("pull_request", "refs/pull/1/merge", 2)));
      expect(group(event("pull_request", "refs/pull/1/merge"))).not.toBe(group(event("pull_request", "refs/pull/2/merge")));
      expect(group(event("pull_request", "refs/pull/1/merge"))).not.toBe(group(event("push")));
      expect(cancels(event("pull_request", "refs/pull/1/merge"))).toBe("true");
    });

    it(`${file} runs a push campaign two journey jobs wide and the others at full width`, () => {
      const width = (github: Github) => Number(evaluate(valueOf(workflow, job, "max-parallel"), github));
      expect(width(event("push"))).toBe(2);
      // Elsewhere every planned job may run at once, as before the limit existed.
      for (const name of ["schedule", "workflow_dispatch", "pull_request"]) expect(width(event(name)), name).toBeGreaterThanOrEqual(widest);
      // A red job never cancels the others of the campaign.
      expect(valueOf(workflow, job, "fail-fast")).toBe("false");
    });
  }
});
