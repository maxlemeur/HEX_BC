// @vitest-environment node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

import { CALC_V3_PHASES } from "../../scripts/tester-army/calc-v3-phases";
import { LOGIN_SETUP } from "../../scripts/tester-army/journey-selections.mjs";
import { planCalcV3 } from "../../scripts/tester-army/select-calc-v3";
import { MAP_PATH, selectFromRepository, type StoredImpactMap } from "../../scripts/tester-army/select-journeys";

it("selects Critical, Takeoff and calc-v3 against the immediate parent of each PR merge commit", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "army-stack-selection-"));
  const git = (...args: string[]) => execFileSync("git", [
    "-c", "user.name=TesterArmy", "-c", "user.email=army@example.com", "-c", "commit.gpgsign=false", ...args,
  ], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const write = (file: string, contents: string) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  };
  const commit = (message: string) => {
    git("add", ".");
    git("commit", "-m", message);
    return git("rev-parse", "HEAD");
  };
  const sharedInput = "src/lib/estimate-calculations.ts";
  const anchor = "e2e/army/critical/stale-save.e2e.ts";
  const takeoff = "e2e/army/takeoff/contracts.e2e.ts";
  const map: StoredImpactMap = {
    schemaVersion: 1,
    suite: { anchor, anonymous: [] },
    fullOnly: {},
    docs: ["docs/**"],
    nonRuntime: [],
    full: [sharedInput],
    runnerEntries: [],
    graph: {
      sourceRoots: ["src", "e2e"], extraFiles: [], apiRouteRoot: "src/app/api",
      apiCallers: [], apiCallersExcluded: [], importersExcluded: [], escalationExcluded: [],
    },
    groups: {},
    rules: [
      { id: "anchor", paths: [anchor], journeys: [anchor] },
      { id: "takeoff", paths: [takeoff], journeys: [takeoff] },
    ],
  };

  try {
    git("init", "--initial-branch=main");
    write(MAP_PATH, JSON.stringify(map));
    for (const file of [LOGIN_SETUP, anchor, takeoff, sharedInput]) write(file, "export {};\n");
    const trunk = commit("Create the test repository");
    git("switch", "-c", "lower");
    write(sharedInput, "export const revised = true;\n");
    const lower = commit("Change a shared input");
    git("switch", "-c", "upper");
    const upperDoc = "docs/upper.md";
    write(upperDoc, "# Upper layer\n");
    const upper = commit("Change documentation");

    const merge = (base: string, head: string) => {
      git("switch", "--detach", base);
      git("merge", "--no-ff", "--no-edit", head);
      return git("rev-parse", "HEAD");
    };
    const select = () => selectFromRepository(root, {
      event: "pull_request", base: git("rev-parse", "HEAD^1"), head: git("rev-parse", "HEAD"),
    });
    const plan = (head: string) => planCalcV3(root, { NODE_ENV: "test", EVENT_NAME: "pull_request", PR_HEAD_SHA: head });

    const lowerMerge = merge(trunk, lower);
    expect(select()).toMatchObject({
      base: trunk, mode: "full", fullOnly: { mode: "all" }, changedPaths: [{ path: sharedInput }],
    });
    expect(plan(lower)).toMatchObject({ phases: CALC_V3_PHASES, changedPaths: [sharedInput] });

    // GitHub may use either the lower branch or its synthetic PR merge commit.
    for (const base of [lower, lowerMerge]) {
      merge(base, upper);
      expect(select()).toMatchObject({
        base, mode: "none", fullOnly: { mode: "none" }, changedPaths: [{ path: upperDoc }],
      });
      expect(plan(upper)).toMatchObject({ phases: [], changedPaths: [upperDoc] });
    }

    merge(trunk, upper);
    expect(select()).toMatchObject({ base: trunk, mode: "full", fullOnly: { mode: "all" } });
    expect(plan(upper)).toMatchObject({ phases: CALC_V3_PHASES, changedPaths: [upperDoc, sharedInput] });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
