// Guard of the TesterArmy journey selection before any stack starts
// (scripts/tester-army/journey-preflight.mjs, docs/testing/tester-army-ci.md).
//
// On 18/10/2026 a local critical run passed without executing the journeys it
// was started for (run .e2e/army/ci/2026-10-18T16-46-35-432Z-critical): the
// new file was in no e2e.config.ts list, the --grep alternative naming it
// matched nothing, and nothing said so. An E2E run cannot show these gaps,
// since by construction it reports only what it ran. Ways the selection can
// still lose a journey silently, each pinned below:
// 1. a journey file under e2e/army/local/ (any depth) that no standing
//    selection collects (e2e.config.ts, the calc-v3 phases, the offer-emission
//    and resend-portal configs) and that is not listed as run elsewhere;
// 2. a stale exclusion: the listed file is collected after all (the double
//    entry would hide its later removal from the selection), no longer
//    exists, or names no existing run document;
// 3. a --grep alternative, top-level or inside an unquantified group, that
//    selects no runnable test while another one selects some, so the run
//    passes on a subset;
// 4. a requested --files entry that selects no runnable test (outside the
//    config globs, every test skipped or filtered out by tag);
// 5. an unsound alternative split: a bar inside a character class, an escaped
//    bar, a lookaround, a quantified group or a pattern with a backreference
//    split anyway (a false gap or a hidden one), or a combinatorial explosion;
// 6. untracked journey or support files left out of the run manifest's source
//    identity (its diffSha256 covers tracked changes only).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  LOCAL_JOURNEYS_OUTSIDE_SELECTIONS,
  grepAlternatives,
  listArmySelection,
  localJourneyCoverageProblems,
  selectionPreflightProblems,
} from "../../scripts/tester-army/journey-preflight.mjs";
import { untrackedJourneyInputs } from "../../scripts/tester-army/local-recipe-common.mjs";

const root = process.cwd();
const SETUP = "e2e/army/critical/auth.setup.e2e.ts";

function tree(files: Record<string, string>) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "army-preflight-"));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.writeFileSync(path.join(directory, file), text);
  }
  return directory;
}

type Pair = { file: string; titlePath: string[]; kind: "test" | "setup"; tags: string[]; disposition: "run" | "skip" };
const pair = (file: string, title: string, overrides: Partial<Pair> = {}): Pair =>
  ({ file, titlePath: [title], kind: "test", tags: ["critical", "local"], disposition: "run", ...overrides });
const setup = pair(SETUP, "authenticate the existing E2E account without provisioning memberships", { kind: "setup" });

describe("local journey coverage", () => {
  it("collects or explicitly excludes every e2e/army/local journey of this tree", () => {
    expect(localJourneyCoverageProblems(root)).toEqual([]);
  });

  it("reports a journey no selection collects, at any depth, and stale exclusions", () => {
    const directory = tree({
      "e2e.config.ts": 'export default { tests: ["e2e/army/local/a-*.e2e.ts"] };\n',
      "e2e/army/local/a-1.e2e.ts": "",
      "e2e/army/local/b.e2e.ts": "",
      "e2e/army/local/nested/c.e2e.ts": "",
      "e2e/army/local/b-support.ts": "",
      "e2e/army/local/run-elsewhere.e2e.ts": "",
      "docs/testing/run-elsewhere.md": "",
    });
    try {
      const problems = localJourneyCoverageProblems(directory, {
        collectors: ["e2e.config.ts"],
        outsideSelections: {
          "e2e/army/local/run-elsewhere.e2e.ts": "docs/testing/run-elsewhere.md",
          "e2e/army/local/a-1.e2e.ts": "docs/testing/run-elsewhere.md",
          "e2e/army/local/gone.e2e.ts": "docs/testing/run-elsewhere.md",
        },
      }).join("\n");
      expect(problems).toContain("e2e/army/local/b.e2e.ts is collected by no");
      expect(problems).toContain("e2e/army/local/nested/c.e2e.ts is collected by no");
      expect(problems).toContain("e2e/army/local/a-1.e2e.ts is listed as run outside the selections but");
      expect(problems).toContain("e2e/army/local/gone.e2e.ts is listed as run outside the selections but does not exist");
      expect(problems).not.toContain("b-support.ts");
      expect(problems).not.toContain("run-elsewhere.e2e.ts");
      expect(localJourneyCoverageProblems(directory, {
        collectors: ["e2e.config.ts"],
        outsideSelections: { "e2e/army/local/b.e2e.ts": "docs/testing/missing.md", "e2e/army/local/nested/c.e2e.ts": "docs/testing/run-elsewhere.md",
          "e2e/army/local/run-elsewhere.e2e.ts": "docs/testing/run-elsewhere.md" },
      })).toEqual(["e2e/army/local/b.e2e.ts names docs/testing/missing.md, which does not exist."]);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("--grep alternatives", () => {
  const sources = (pattern: string) => grepAlternatives(pattern).map((regexp) => regexp.source);

  it("splits top-level bars and unquantified groups, keeping prefix and suffix", () => {
    expect(sources("^(V3C01|HFS0[12]) ")).toEqual(["^(?:V3C01) ", "^(?:HFS0[12]) "]);
    expect(sources("GEN01|^(?:A|B)$")).toEqual(["GEN01", "^(?:A)$", "^(?:B)$"]);
    expect(sources("^(?<id>A|B(C|D)) ")).toEqual(["^(?:A) ", "^(?:B(?:C)) ", "^(?:B(?:D)) "]);
    expect(grepAlternatives("/^(a|b)/i").map((regexp) => [regexp.source, regexp.flags])).toEqual([["^(?:a)", "i"], ["^(?:b)", "i"]]);
  });

  it("never splits what is not an alternative of the whole pattern", () => {
    expect(sources("^[A|B] ")).toEqual(["^[A|B] "]);
    expect(sources("^A\\|B")).toEqual(["^A\\|B"]);
    expect(sources("^(?:A|B)+ ")).toEqual(["^(?:A|B)+ "]);
    expect(sources("^(A|B){2} ")).toEqual(["^(A|B){2} "]);
    expect(sources("^X(?=A|B)")).toEqual(["^X(?=A|B)"]);
    expect(sources("^(?<!A|B)X")).toEqual(["^(?<!A|B)X"]);
    expect(sources("^(A|B) \\1")).toEqual(["^(A|B) \\1"]);
    expect(sources("^(?<x>A|B) \\k<x>")).toEqual(["^(?<x>A|B) \\k<x>"]);
    // 2^8 combinations: checked as one pattern rather than enumerated.
    const wide = "(a|b)".repeat(8);
    expect(sources(wide)).toEqual([wide]);
  });
});

describe("selection preflight", () => {
  it("reports an alternative or a file that selects no runnable test", () => {
    const pairs = [setup, pair("e2e/army/local/engine-v3-creators.e2e.ts", "V3C01 the wizard"),
      pair("e2e/army/local/skipped.e2e.ts", "SKP01 skipped", { disposition: "skip" })];
    expect(selectionPreflightProblems({ pairs, grep: "^(V3C01|HFS0[12]|SKP01) ", files: [] })).toEqual([
      "--grep alternative /^(?:HFS0[12]) / selects no runnable test.",
      "--grep alternative /^(?:SKP01) / selects no runnable test.",
    ]);
    expect(selectionPreflightProblems({ pairs, files: ["e2e/army/local/engine-v3-creators.e2e.ts", "e2e/army/local/skipped.e2e.ts"] }))
      .toEqual(["--files e2e/army/local/skipped.e2e.ts selects no runnable test."]);
    expect(selectionPreflightProblems({ pairs, grep: "^V3C01 ", files: [] })).toEqual([]);
    // Shard and takeoff jobs name the login setup among their files, as the post-run check accepts.
    expect(selectionPreflightProblems({ pairs, files: [SETUP, "e2e/army/local/engine-v3-creators.e2e.ts"] })).toEqual([]);
  });

  it("refuses a selection without an authenticated business test", () => {
    const anonymous = pair("e2e/army/critical/access-boundaries.e2e.ts", "ANON01 refuses", { tags: ["critical", "anonymous"] });
    expect(selectionPreflightProblems({ pairs: [setup, anonymous], grep: "^ANON01 ", files: [] }))
      .toEqual(["The selection runs no authenticated business test (critical, not anonymous)."]);
  });

  it("reports the 18/10 gap from the real critical selection, before any stack", async () => {
    // The 18/10 pattern '^(V3C01|HFS0[12]) ', with an ID no journey will ever take (HFS01/02 are due to land).
    const grep = "^(V3C01|ZZZ9[89]) ";
    const pairs = await listArmySelection({ root, suite: "critical", grep, files: [], env: process.env });
    expect(pairs.some((entry) => entry.file === "e2e/army/local/engine-v3-creators.e2e.ts" && entry.disposition === "run")).toBe(true);
    expect(selectionPreflightProblems({ pairs, grep, files: [] }))
      .toEqual(["--grep alternative /^(?:ZZZ9[89]) / selects no runnable test."]);
  }, 120_000);

  it("refuses a requested file outside the critical selection globs", async () => {
    // An exclusion is, by the coverage contract above, collected by no selection.
    const outside = Object.keys(LOCAL_JOURNEYS_OUTSIDE_SELECTIONS)[0];
    const files = ["e2e/army/local/engine-v3-creators.e2e.ts", outside];
    const pairs = await listArmySelection({ root, suite: "critical", files, env: process.env });
    expect(selectionPreflightProblems({ pairs, files })).toEqual([`--files ${outside} selects no runnable test.`]);
  }, 120_000);
});

describe("journey source identity", () => {
  it("records untracked journey, support and config files with their digests", () => {
    const directory = tree({
      "e2e/army/local/tracked.e2e.ts": "tracked\n",
      "e2e/army/local/new.e2e.ts": "new journey\n",
      "e2e/army/local/new-support.ts": "support\n",
      "e2e.extra.config.ts": "config\n",
      "src/untracked.ts": "app source, recorded by buildSourceEvidence\n",
      ".gitignore": "ignored/\n",
      "e2e/ignored/x.e2e.ts": "",
    });
    try {
      fs.appendFileSync(path.join(directory, ".gitignore"), "e2e/ignored/\n");
      const git = (...args: string[]) => spawnSync("git", ["-c", "user.email=army@example.invalid", "-c", "user.name=army", ...args],
        { cwd: directory, encoding: "utf8" });
      git("init", "-q");
      git("add", ".gitignore", "e2e/army/local/tracked.e2e.ts");
      git("commit", "-qm", "base");
      const inputs = untrackedJourneyInputs(directory);
      expect(inputs.map((input: { path: string }) => input.path)).toEqual([
        "e2e.extra.config.ts", "e2e/army/local/new-support.ts", "e2e/army/local/new.e2e.ts",
      ]);
      expect(inputs[2].sha256).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
