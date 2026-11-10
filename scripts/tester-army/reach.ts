// Lists the journeys a change reaches that a push to main does not run, with the local command of
// each, so a direct push can prove them first (docs/testing/tester-army-ci.md, "Avant un push
// direct sur main"). A push runs the critical suite only:
// - the takeoff journeys and the calc-v3 phases otherwise wait for a pull request, whose selection
//   (select-journeys.ts, select-calc-v3.ts) is the one used here;
// - the development phase and the extended journeys only run in the scheduled full campaign. No
//   rule maps a source file to them: a changed journey file is listed, and the development phase
//   follows the takeoff journeys, which drive the same affaire hub.
// Plain Node (type stripping, no npm install): node builtins and erasable TypeScript syntax.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CALC_V3_PHASES } from "./calc-v3-phases.ts";
import { selectCalcV3 } from "./select-calc-v3.ts";
import { loadImpactMap, selectFromRepository } from "./select-journeys.ts";

export type Reach = {
  /** Changed paths compared. */
  paths: number;
  /** Takeoff journey files, without the login setup the runner adds. */
  takeoff: string[];
  /** Changed extended journey files that still exist. */
  extended: string[];
  development: boolean;
  calcV3: string[];
  /**
   * Every journey of the suite, because a path is shared or unmapped rather than because a rule
   * names them: what a pull request runs in parallel, not what the change is known to alter.
   */
  everyTakeoff: boolean;
  everyCalcV3: boolean;
  reasons: { takeoff: string; calcV3: string };
};

const DEVELOPMENT_JOURNEY = /^e2e\/army\/development\//u;
const EXTENDED_JOURNEY = /^e2e\/army\/extended\/.+\.e2e\.ts$/u;

export function reachOutsideCritical(root: string, paths: string[], exists: (file: string) => boolean = () => true): Reach {
  const none = { takeoff: [], extended: [], development: false, calcV3: [], everyTakeoff: false, everyCalcV3: false };
  if (paths.length === 0) return { paths: 0, ...none, reasons: { takeoff: "no change", calcV3: "no change" } };
  const { map } = loadImpactMap(root);
  const selection = selectFromRepository(root, { event: "pull_request", paths });
  // An unlistable fail-safe selection means every takeoff journey.
  const takeoff = selection.fullOnly.mode === "none" ? []
    : (selection.fullOnly.files.length ? selection.fullOnly.files : map.fullOnly.journeys).filter((file) => file !== map.suite.setup).sort();
  const calc = selectCalcV3(root, paths);
  const calcV3 = calc.phases.filter((phase) => phase !== "all");
  return { paths: paths.length, takeoff, extended: paths.filter((file) => EXTENDED_JOURNEY.test(file) && exists(file)).sort(),
    development: takeoff.length > 0 || paths.some((file) => DEVELOPMENT_JOURNEY.test(file)), calcV3,
    everyTakeoff: selection.fullOnly.mode === "all", everyCalcV3: calcV3.length === CALC_V3_PHASES.length,
    reasons: { takeoff: selection.fullOnly.reason, calcV3: calc.reason } };
}

export function formatReach(reach: Reach): string[] {
  if (!reach.takeoff.length && !reach.extended.length && !reach.development && !reach.calcV3.length) {
    return [`This change (${reach.paths} path(s)) reaches no takeoff, extended or development journey and no calc-v3 phase.`];
  }
  const lines = [`This change (${reach.paths} path(s)) reaches journeys a push to main does not run.`];
  const fallback = "No rule maps the change to it: a pull request would run all of it. Run what the change can alter.";
  if (reach.takeoff.length) {
    lines.push("", reach.everyTakeoff ? `Takeoff: every journey (${reach.reasons.takeoff}). ${fallback}` : `Takeoff: ${reach.takeoff.length} file(s) mapped to the change. Run them:`,
      `  npm run e2e:army:ci -- full --files ${reach.takeoff.join(",")}`);
  }
  if (reach.extended.length) lines.push("", "Extended: the changed journey file(s). Run them:", `  npm run e2e:army:ci -- full --files ${reach.extended.join(",")}`);
  if (reach.development) lines.push("", "Development phase: it drives the affaire hub, as the takeoff journeys do. Run it with them:", "  npm run e2e:army:ci -- full --phase development");
  if (reach.calcV3.length) {
    lines.push("", ...(reach.everyCalcV3
      ? [`calc-v3: every phase (${reach.reasons.calcV3}). ${fallback}`, `  npm run e2e:army:calc-v3 -- --phase <${reach.calcV3.join("|")}>`]
      : [`calc-v3: ${reach.calcV3.length} phase(s) mapped to the change. Run them:`, ...reach.calcV3.map((phase) => `  npm run e2e:army:calc-v3 -- --phase ${phase}`)]));
  }
  return lines;
}

/** Committed, staged, unstaged and untracked paths of the working tree since it left the base. */
function changedPaths(root: string, base: string): string[] {
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
    return result.stdout;
  };
  const fork = git("merge-base", base, "HEAD").trim();
  const names = (output: string) => output.split("\0").filter(Boolean);
  return [...new Set([...names(git("diff", "--name-only", "--no-renames", "-z", fork)),
    ...names(git("ls-files", "--others", "--exclude-standard", "-z"))])].sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--base")) throw new Error("Usage: node scripts/tester-army/reach.ts [--base REV] (default origin/main)");
    const root = process.cwd();
    console.log(formatReach(reachOutsideCritical(root, changedPaths(root, args[1] ?? "origin/main"), (file) => fs.existsSync(path.join(root, file)))).join("\n"));
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 2;
  }
}
