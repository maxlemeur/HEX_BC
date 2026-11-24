// @vitest-environment node

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// The production QA reads production secrets, so its job runs only in the canonical repository, on a
// manual run of the protected `main`. Failure modes: a fork (which copies the workflow) runs it; a
// transfer of the repository to another owner skips it silently, as a check on the owner's name would;
// a run from another branch, an unprotected ref or another event reaches the secrets.

/** The numeric id of the canonical repository (`gh api repos/<owner>/HEX_BC --jq .id`). It survives a transfer; a fork has its own. */
const CANONICAL_REPOSITORY_ID = "1137812664";

const workflow = fs.readFileSync(path.join(process.cwd(), ".github/workflows/e2e-production-qa.yml"), "utf8");

type GitHubContext = {
  repository: string;
  repository_id: string;
  ref: string;
  ref_protected: boolean;
  event_name: string;
};

/**
 * Whether GitHub starts the job for one `github` context. The condition only uses `==`, `&&`, string
 * literals and the `github` context, which JavaScript evaluates the same way (as
 * src/test/army-database-checks.test.ts does for its expressions).
 */
function runs(github: GitHubContext): boolean {
  const condition = /^ {4}if: (.+)$/mu.exec(workflow)?.[1];
  expect(condition, "the production-qa job has an `if:`").toBeDefined();
  return Boolean(new Function("github", `return (${condition});`)(github));
}

const canonicalRun: GitHubContext = {
  repository: "maxlemeur/HEX_BC",
  repository_id: CANONICAL_REPOSITORY_ID,
  ref: "refs/heads/main",
  ref_protected: true,
  event_name: "workflow_dispatch",
};

describe("the production QA job", () => {
  it("runs on a manual run of the protected main of the canonical repository", () => {
    expect(runs(canonicalRun)).toBe(true);
  });

  it("still runs once the repository is transferred to another owner", () => {
    for (const repository of ["thannous/HEX_BC", "another-owner/renamed"]) {
      expect(runs({ ...canonicalRun, repository }), repository).toBe(true);
    }
  });

  it("does not run in a fork, whatever its name", () => {
    for (const repository of ["someone/HEX_BC", "maxlemeur/HEX_BC", "thannous/HEX_BC"]) {
      expect(runs({ ...canonicalRun, repository, repository_id: "987654321" }), repository).toBe(false);
    }
  });

  it("does not run from another ref, an unprotected ref or another event", () => {
    for (const ref of ["refs/heads/feature", "refs/tags/v1", "refs/pull/1/merge"]) {
      expect(runs({ ...canonicalRun, ref }), ref).toBe(false);
    }
    expect(runs({ ...canonicalRun, ref_protected: false })).toBe(false);
    for (const event_name of ["push", "pull_request", "pull_request_target", "schedule", "workflow_run"]) {
      expect(runs({ ...canonicalRun, event_name }), event_name).toBe(false);
    }
  });
});
