// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ALERT_WORKFLOWS } from "../../scripts/tester-army/nightly-alert";
import { loadImpactMap } from "../../scripts/tester-army/select-journeys";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

// A push to main runs the critical suite only. The full and calc-v3 campaigns
// follow it on main, but the account runs 20 jobs at once and a busy day brings
// two dozen pushes: they must stay one at a time, few jobs wide, and never be
// started or superseded by a push that changes documentation only.
describe("full and calc-v3 campaigns of main after a push", () => {
  const campaigns = [
    { file: ".github/workflows/e2e-army-full.yml", group: "army-full", job: "army-full-shard" },
    { file: ".github/workflows/e2e-army-calc-v3.yml", group: "army-calc-v3", job: "army-calc-v3-phase" },
  ];

  it("covers exactly the workflows whose red result on main raises the alert", () => {
    expect(campaigns.map((campaign) => campaign.file).sort()).toEqual(Object.values(ALERT_WORKFLOWS).map((workflow) => workflow.file).sort());
  });

  for (const { file, group, job } of campaigns) {
    it(`${file} follows every push to main except documentation only`, () => {
      const workflow = read(file);
      const push = /^ {2}push:\n {4}branches: \[main\]\n {4}paths-ignore:\n((?: {6}- .+\n)+)/mu.exec(workflow);
      expect(push, file).not.toBeNull();
      const ignored = push![1].trim().split("\n").map((line) => line.trim().replace(/^- /u, "").replace(/^"|"$/gu, ""));
      // The documentation globs of the impact map: what a push to main already skips the critical suite for.
      expect(ignored).toEqual(loadImpactMap(root).map.docs);
    });

    it(`${file} runs one push campaign at a time, the newest waiting, two jobs wide`, () => {
      const workflow = read(file);
      // One group for every push: GitHub then keeps one run in progress and the newest pending.
      expect(workflow).toContain(
        `\nconcurrency:\n  group: ${group}-\${{ github.event_name == 'pull_request' && github.ref || github.event_name == 'push' && 'main-push' || github.run_id }}\n` +
        "  cancel-in-progress: ${{ github.event_name == 'pull_request' }}\n");
      // A running campaign of main is never cancelled: its result is the one the alert reads.
      expect(workflow).not.toContain("cancel-in-progress: true");
      const matrixJob = workflow.slice(workflow.indexOf(`\n  ${job}:\n`));
      const strategy = matrixJob.slice(matrixJob.indexOf("\n    strategy:\n"), matrixJob.indexOf("\n    env:\n"));
      expect(strategy).toContain("\n      fail-fast: false\n");
      expect(strategy).toContain("\n      max-parallel: ${{ github.event_name == 'push' && 2 || 20 }}\n");
    });
  }
});
