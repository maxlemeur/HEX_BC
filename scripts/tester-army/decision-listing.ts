// What the decision model leaves out of a pull request's selection, for the army-select job (e2e-army-critical.yml).
//
// The job first selects by impact (select-journeys.ts, plain Node, no install). When journeys are selected, it
// installs the dependencies and runs this script: the e2e runner lists the selected journeys with
// `--changed-since <base>`, which calls the filters of e2e.config.ts (impact-filter.ts), the decision model last.
// The result is a JSON file select-journeys.ts reads back (--decision) to plan fewer jobs.
//
// Nothing here can add a journey or fail the selection: on any error the script exits 1 and the job keeps the
// selection by impact. Contract: docs/testing/tester-army-ci.md, "Filtre par modèle de décision".
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DECISION_KEY, DECISION_MIN_PERCENT, DECISION_MODEL } from "./impact-filter";
import { listArmySelection } from "./journey-preflight.mjs";
import { decisionSkipped, type DecisionListing, type DecisionSuite, type Selection } from "./select-journeys";

export const DECISION_FILTER = "army-decision";

type Pair = { file: string; disposition: string; filter?: string; reason?: string };

/** The files the decision filter left out entirely, from the pairs of one listing. */
export function decisionFromPairs(pairs: readonly Pair[], notes: readonly string[]): DecisionSuite {
  const files = new Map<string, { runs: boolean; reasons: string[] }>();
  for (const pair of pairs) {
    const decided = pair.disposition === "filtered" && pair.filter === DECISION_FILTER;
    // A pair another filter or the command line left out says nothing about the model.
    if (pair.disposition !== "run" && !decided) continue;
    const entry = files.get(pair.file) ?? { runs: false, reasons: [] };
    files.set(pair.file, entry);
    if (decided) entry.reasons.push(pair.reason ?? "");
    else entry.runs = true;
  }
  const percent = (reason: string) => Number(/^(\d+(?:\.\d+)?)%/u.exec(reason)?.[1] ?? -1);
  const leftOut = [...files].filter(([, entry]) => !entry.runs && entry.reasons.length)
    .map(([file, entry]) => ({ file, reason: [...entry.reasons].sort((a, b) => percent(b) - percent(a))[0] }))
    .sort((a, b) => a.file.localeCompare(b.file));
  const kept = notes.filter((line) => /^(?:army-|decision|judging |warning: )/u.test(line)).map((line) => line.slice(0, 1024));
  // The runner prints one account per filter it called ("army-decision kept …", "… left out all …") and a
  // warning when one failed or timed out. Without the account, the model did not answer and left nothing out.
  const warning = kept.find((line) => line.startsWith("warning: ") && line.includes(DECISION_FILTER));
  const answered = kept.some((line) => line.startsWith(`${DECISION_FILTER} kept `) || line.startsWith(`${DECISION_FILTER} left out `));
  return { judged: files.size, leftOut, notes: kept,
    failure: warning ?? (answered ? null : `the runner printed no account of the ${DECISION_FILTER} filter`) };
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name: string) => { const index = args.indexOf(name); return index === -1 ? undefined : args[index + 1]; };
  const selectionFile = option("--selection");
  const out = option("--out");
  if (!selectionFile || !out || args.length !== 4) throw new Error("Usage: node --import tsx scripts/tester-army/decision-listing.ts --selection FILE --out FILE");
  const root = process.cwd();
  const selection = JSON.parse(fs.readFileSync(selectionFile, "utf8")) as Selection;
  const skipped = decisionSkipped(selection);
  if (skipped) throw new Error(`The decision model is not asked: ${skipped}.`);
  if (!process.env[DECISION_KEY]?.trim()) throw new Error(`${DECISION_KEY} is not set.`);
  const base = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${selection.base}^{commit}`], { cwd: root, encoding: "utf8" });
  if (base.status !== 0) throw new Error(`The selection's base ${selection.base} is not in this checkout.`);
  const env = { ...process.env, E2E_ARMY_DECISION_FILTER: "1" };
  const list = async (suite: "critical" | "full", files: readonly string[]) => {
    let notes: string[] = [];
    const pairs = await listArmySelection({ root, suite, files, env, changedSince: base.stdout.trim(), onNotes: (lines) => { notes = lines; } });
    return decisionFromPairs(pairs, notes);
  };
  const listing: DecisionListing = {
    schemaVersion: "army-decision-1", model: DECISION_MODEL, minPercent: DECISION_MIN_PERCENT, base: base.stdout.trim(),
    // "full": no positional file, the runner lists its whole critical suite.
    critical: selection.mode === "none" ? null : await list("critical", selection.mode === "files" ? selection.files : []),
    // A fail-safe "all" without a list is the whole full selection: not narrowed.
    takeoff: selection.fullOnly.mode === "none" || selection.fullOnly.files.length === 0 ? null : await list("full", selection.fullOnly.files),
  };
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(listing, null, 2)}\n`);
  for (const [name, suite] of [["critical", listing.critical], ["takeoff", listing.takeoff]] as const) {
    if (suite) console.log(`Decision model, ${name}: ${suite.leftOut.length} of ${suite.judged} journey file(s) left out. ${suite.notes.join(" | ")}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(`::warning title=TesterArmy decision filter::${(error as Error).message.replace(/\r?\n/gu, " ")} The selection by impact is kept.`);
    process.exitCode = 1;
  });
}
