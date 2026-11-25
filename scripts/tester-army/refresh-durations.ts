// Runs with plain Node against downloaded green main aggregate artifacts.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { durationCeiling, measuredSeconds, WARNING_SECONDS } from "./file-durations.ts";
import { FULL_JOURNEY_FILE } from "./journey-files.mjs";
import { LOGIN_SETUP } from "./journey-selections.mjs";
import { listRepositoryFiles, SHARDS_PATH, type ShardDurations, validateShardDurations } from "./select-journeys.ts";

type Source = { suite: string; run: string; revision: string; directory: string };

export function readMeasurements({ suite, revision, directory }: Source): Record<string, number> {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
  if (manifest.schemaVersion !== "army-ci-aggregate-1" || manifest.suite !== suite || manifest.scope !== suite ||
      manifest.revision !== revision || manifest.status !== "passed" || !["critical", "full"].includes(suite)) {
    throw new Error(`Expected a passed, whole ${suite} aggregate for ${revision}.`);
  }
  const seconds: Record<string, number> = {};
  for (const unit of manifest.units) {
    if (unit.kind !== "shard") continue;
    if (!new RegExp(`^army-${suite}-shard-[1-9][0-9]*-evidence$`).test(unit.artifact)) throw new Error("Invalid shard artifact.");
    const report = unit.reports.find((item: { path: string }) => item.path === `${suite}/report.json`);
    const bytes = fs.readFileSync(path.join(directory, "units", unit.artifact, suite, "report.json"));
    if (report?.sha256 !== createHash("sha256").update(bytes).digest("hex")) throw new Error("Shard report checksum mismatch.");
    for (const [file, value] of Object.entries(measuredSeconds(JSON.parse(bytes.toString()).run.results))) {
      if (file === LOGIN_SETUP) continue; // repeated on every shard, excluded from packing
      if (!FULL_JOURNEY_FILE.test(file) || Object.hasOwn(seconds, file)) throw new Error(`Unexpected or repeated journey: ${file}`);
      seconds[file] = value;
    }
  }
  if (!Object.keys(seconds).length) throw new Error(`No usable ${suite} timings in ${directory}.`);
  return seconds;
}

type Measurement = { file: string; seconds: number; run: string; suite: string };

export function refreshDurations(config: ShardDurations, measurements: Measurement[]) {
  const changes = measurements.filter(({ file, seconds }) => {
    const old = config.seconds[file];
    const crosses = (threshold: number) => (old > threshold) !== (seconds > threshold);
    return old === undefined || crosses(WARNING_SECONDS) || crosses(durationCeiling(file)) ||
      Math.abs(seconds - old) >= Math.max(10, old * 0.2);
  });
  if (!changes.length) return config;
  const seconds = { ...config.seconds };
  const provenance = new Map<string, string[]>();
  for (const change of changes) {
    seconds[change.file] = change.seconds;
    const source = `${change.suite} run ${change.run}`;
    if (!provenance.has(source)) provenance.set(source, []);
    provenance.get(source)!.push(change.file);
  }
  return { ...config, seconds: Object.fromEntries(Object.keys(seconds).sort().map((file) => [file, seconds[file]])),
    measured: [...provenance].map(([source, files]) => `Green main ${source}, selected tests in seconds: ${files.sort().join(", ")}.`)
      .concat(config.measured ?? []) };
}

/** The write-capable job accepts data only. Keep every setting, duration key and historical measurement. */
export function validateProposal(base: ShardDurations, proposal: ShardDurations, files: string[]) {
  const { seconds, measured, ...settings } = proposal;
  const { seconds: previousSeconds, measured: history = [], ...originalSettings } = base;
  if (!isDeepStrictEqual(settings, originalSettings)) throw new Error("Only seconds and measured may change.");
  if (!seconds || Array.isArray(seconds) || typeof seconds !== "object" ||
      Object.keys(previousSeconds).some((file) => !Object.hasOwn(seconds, file))) throw new Error("Missing file duration.");
  const problems = validateShardDurations(proposal, files.filter((file) => FULL_JOURNEY_FILE.test(file)));
  if (problems.length) throw new Error(problems.join("\n"));
  if (!Array.isArray(measured) || measured.length <= history.length ||
      !measured.every((note) => typeof note === "string" && note.trim()) ||
      !isDeepStrictEqual(measured.slice(measured.length - history.length), history)) throw new Error("Invalid measurement history.");
}

function main(args: string[]) {
  if (args[0] === "--apply-proposal" && args.length === 2) {
    const base = JSON.parse(fs.readFileSync(SHARDS_PATH, "utf8"));
    const proposal = JSON.parse(fs.readFileSync(args[1], "utf8"));
    validateProposal(base, proposal, listRepositoryFiles(process.cwd()));
    fs.writeFileSync(SHARDS_PATH, JSON.stringify(proposal, null, 2) + "\n");
    return;
  }
  if (!args.length || args.length % 4) throw new Error("Expected one or more groups of: suite run-id revision aggregate-directory.");
  const measurements = new Map<string, Measurement>();
  for (let i = 0; i < args.length; i += 4) {
    const [suite, run, revision, directory] = args.slice(i, i + 4);
    if (!/^\d+$/.test(run) || !/^[0-9a-f]{40}$/.test(revision)) throw new Error("Invalid run identity.");
    const changed = new Set(execFileSync("git", ["diff", "--name-only", "--no-renames", "-z", revision, "HEAD", "--", "e2e/army"],
      { encoding: "utf8" }).split("\0"));
    for (const [file, seconds] of Object.entries(readMeasurements({ suite, run, revision, directory }))) {
      // The first source wins (Critical runs the same two workers used by its planner).
      if (!changed.has(file) && fs.existsSync(file) && !measurements.has(file)) measurements.set(file, { file, seconds, run, suite });
    }
  }
  const config = JSON.parse(fs.readFileSync(SHARDS_PATH, "utf8")) as ShardDurations;
  const updated = refreshDurations(config, [...measurements.values()]);
  const summary = [`Read ${measurements.size} current journey measurements.\n`];
  if (updated !== config) {
    for (const { file, run, seconds } of measurements.values()) {
      if (config.seconds[file] !== updated.seconds[file]) summary.push(`- \`${file}\`: ${config.seconds[file] ?? "default"} → ${seconds} s (run ${run})`);
    }
    fs.writeFileSync(SHARDS_PATH, JSON.stringify(updated, null, 2) + "\n");
  }
  console.log(summary.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join("\n") + "\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
