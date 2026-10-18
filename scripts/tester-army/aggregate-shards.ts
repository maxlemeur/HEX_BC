// Aggregate check of parallel TesterArmy jobs: army-critical (shards of the
// critical selection), army-full (shards of the nightly full suite and its
// development job) and army-calc-v3 (one job per phase). Runs with plain Node
// (type stripping, builtins only), after `actions/download-artifact` put each
// job's evidence in <evidence>/<artifact name>/. Contract:
// docs/testing/tester-army-ci.md, "Jobs parallèles"; failure modes:
// src/test/army-shard-aggregate.test.ts.
//
// Green only when every job it depends on succeeded, every planned unit left
// its own passing, privacy-checked evidence whose bytes match the unit's
// inventory, all units tested the same sources, each shard ran exactly its
// planned files, and the shards together ran the plan's files, no file twice.
// A sharded whole suite must also list exactly the files the e2e CLI
// discovered: every shard's report records the whole discovery, the tests
// outside its positional files skipped as unselected.
// It writes <out>/manifest.json (each unit's manifest SHA-256) beside a copy of
// every unit's evidence, so one artifact keeps the whole run.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type AggregateSuite = "critical" | "full" | "calc-v3";
export type AggregateInput = {
  suite: AggregateSuite;
  /** critical: the selection (selection.json, its shards); full: the shard plan; calc-v3: the planned phase names. */
  plan: unknown;
  /** Directory holding one subdirectory per downloaded artifact. */
  evidence: string;
  /** Output directory of the aggregate evidence (created only when a unit was planned). */
  out: string;
  /** Result of each job the aggregate needs (needs.<job>.result). */
  results: Record<string, string>;
  /** The tested commit (GITHUB_SHA). */
  revision?: string;
};
export type AggregateResult = {
  status: "passed" | "failed" | "not-run";
  problems: string[];
  /** The aggregate evidence directory to retain, null when nothing was planned. */
  evidence: string | null;
};

type PlannedShard = { shard: number; total: number; files: string[] };
type Plan = { files: string[]; workers: number | null; shards: PlannedShard[]; development?: string; reason?: string };
type Unit = {
  id: string;
  artifact: string;
  kind: "shard" | "development" | "calc-v3";
  shard?: PlannedShard;
  phase?: string;
};
/** files: what its selected results ran; discovered: every file the e2e CLI discovered, selected or not. */
type Report = { path: string; sha256: string; summary: unknown; files: string[]; discovered: string[] };
type UnitRecord = {
  id: string;
  artifact: string;
  kind: Unit["kind"];
  status: "passed" | "failed" | "missing";
  manifestSha256?: string;
  scope?: string;
  journeyFiles?: string[];
  phases?: string[];
  reports?: Report[];
  source?: { revision: unknown; diffSha256: unknown; inputsSha256: string };
};

const SETUP = "e2e/army/critical/auth.setup.e2e.ts";
/** The jobs each aggregate needs, by workflow job id (the guard checks the workflows against it). */
export const AGGREGATE_JOBS: Record<AggregateSuite, { plan: string; units: string; development?: string }> = {
  critical: { plan: "army-select", units: "army-critical-shard" },
  full: { plan: "army-full-plan", units: "army-full-shard", development: "army-full-development" },
  "calc-v3": { plan: "army-calc-v3-plan", units: "army-calc-v3-phase" },
};

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const sorted = (values: Iterable<string>) => [...new Set(values)].sort();
const same = (a: readonly string[], b: readonly string[]) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
const strings = (value: unknown): string[] | undefined => (Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : undefined);

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function listFiles(directory: string, base = directory): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) return [`${path.relative(base, file).replaceAll("\\", "/")} (symlink)`];
    return entry.isDirectory() ? listFiles(file, base) : [path.relative(base, file).replaceAll("\\", "/")];
  });
}

function readPlan(value: unknown, problems: string[]): Plan | undefined {
  const plan = record(value);
  const shards = Array.isArray(plan.shards) ? plan.shards.map(record) : undefined;
  const files = strings(plan.files);
  if (plan.schemaVersion !== "army-shard-plan-1" || !shards || !files ||
    shards.some((shard) => !Number.isInteger(shard.shard) || !Number.isInteger(shard.total) || !strings(shard.files))) {
    problems.push("The shard plan is unreadable (army-shard-plan-1 expected).");
    return undefined;
  }
  return {
    files, workers: typeof plan.workers === "number" ? plan.workers : null, reason: String(plan.reason ?? ""),
    development: typeof plan.development === "string" ? plan.development : undefined,
    shards: shards.map((shard) => ({ shard: shard.shard as number, total: shard.total as number, files: strings(shard.files)! })),
  };
}

/** The plan's own consistency: numbered 1..n, a setup per listed shard, disjoint, together its files. */
function checkPlan(plan: Plan, problems: string[]) {
  if (plan.shards.length === 0) {
    if (plan.files.length) problems.push("A plan without shards lists no file.");
    return;
  }
  plan.shards.forEach((shard, index) => {
    if (shard.shard !== index + 1 || shard.total !== plan.shards.length) {
      problems.push(`The plan numbers shard ${index + 1} as ${shard.shard}/${shard.total}.`);
    }
  });
  if (plan.files.length === 0) {
    if (plan.shards.length !== 1 || plan.shards[0].files.length) problems.push("An unsharded plan must be one shard of the runner's own suite.");
    return;
  }
  const owners = new Map<string, number>();
  for (const shard of plan.shards) {
    if (!shard.files.includes(SETUP)) problems.push(`Planned shard ${shard.shard} lacks the login setup.`);
    for (const file of shard.files) if (file !== SETUP) owners.set(file, (owners.get(file) ?? 0) + 1);
  }
  const doubled = [...owners].filter(([, count]) => count > 1).map(([file]) => file);
  if (doubled.length) problems.push(`Files planned in 2 shards: ${doubled.join(", ")}.`);
  if (!same([...owners.keys(), SETUP], plan.files)) problems.push("The shards' files are not the plan's files.");
}

/** Units the plan expects, with their artifact directories. */
/** wholeSuite: a sharded listing of the whole suite, which every shard's CLI discovery must equal. */
function plannedUnits(input: AggregateInput, problems: string[]): { units: Unit[]; plan?: Plan; scope: string; wholeSuite?: boolean } {
  if (input.suite === "calc-v3") {
    const phases = strings(input.plan);
    if (!phases || phases.length === 0 || phases.some((phase) => !/^[a-z0-9-]+$/u.test(phase)) || new Set(phases).size !== phases.length) {
      problems.push("The calc-v3 plan must list distinct phase names.");
      return { units: [], scope: "calc-v3" };
    }
    return { scope: "calc-v3", units: phases.map((phase) => ({ id: `calc-v3 ${phase}`, artifact: `army-calc-v3-${phase}-evidence`, kind: "calc-v3", phase })) };
  }
  const selection = record(input.plan);
  const plan = readPlan(input.suite === "critical" ? selection.shards : input.plan, problems);
  if (!plan) return { units: [], scope: input.suite };
  checkPlan(plan, problems);
  let scope: string = input.suite;
  if (input.suite === "critical") {
    if (selection.schemaVersion !== "army-impact-selection-3" || !["none", "files", "full"].includes(String(selection.mode))) {
      problems.push("The selection is unreadable (army-impact-selection-3 expected).");
    }
    if (selection.mode === "none" && plan.shards.length) problems.push("A none selection plans no shard.");
    if (selection.mode !== "none" && plan.shards.length === 0) problems.push(`A ${String(selection.mode)} selection plans at least one shard.`);
    if (selection.mode === "files" && plan.files.length && !same(plan.files, strings(selection.files) ?? [])) {
      problems.push("The plan does not cover the selection: its files differ from the selected journeys.");
    }
    scope = selection.mode === "files" && plan.files.length ? "filtered-critical" : "critical";
  } else {
    if (!["separate", "in-shard", "none"].includes(String(plan.development))) problems.push("The full plan does not say where its development phase runs.");
    if (plan.development === "separate" && plan.files.length === 0) problems.push("A full plan with a development job lists its shards' files.");
    if (plan.development !== "separate" && plan.files.length) problems.push("A sharded full plan runs its development phase in its own job.");
    scope = plan.development === "none" ? "filtered-full" : "full";
  }
  const prefix = input.suite === "critical" ? "army-critical" : "army-full";
  const units: Unit[] = plan.shards.map((shard) => ({ id: `shard ${shard.shard}/${shard.total}`, artifact: `${prefix}-shard-${shard.shard}-evidence`, kind: "shard", shard }));
  if (input.suite === "full" && plan.development === "separate") {
    units.push({ id: "development", artifact: "army-full-development-evidence", kind: "development", phase: "development" });
  }
  const wholeSuite = plan.files.length > 0 && (input.suite === "critical" ? selection.mode === "full" : plan.development === "separate");
  return { units, plan, scope, wholeSuite };
}

function checkJobs(input: AggregateInput, units: Unit[], plan: Plan | undefined, problems: string[]) {
  const jobs = AGGREGATE_JOBS[input.suite];
  const expect = (job: string, wanted: string) => {
    const actual = input.results[job];
    if (actual === undefined) problems.push(`No result was given for the job ${job}.`);
    else if (actual !== wanted) problems.push(`Job ${job} ${actual}, expected ${wanted}.`);
  };
  expect(jobs.plan, "success");
  expect(jobs.units, units.some((unit) => unit.kind !== "development") ? "success" : "skipped");
  if (jobs.development) expect(jobs.development, plan?.development === "separate" ? "success" : "skipped");
}

/** Phases a unit must have run, each with its report under <phase>/report.json. */
function expectedPhases(input: AggregateInput, unit: Unit, plan: Plan | undefined): string[] {
  if (unit.kind === "development") return ["development"];
  if (input.suite === "critical") return ["critical"];
  return plan?.development === "in-shard" ? ["full", "development"] : ["full"];
}

function expectedScope(input: AggregateInput, unit: Unit, plan: Plan | undefined): string {
  if (unit.kind === "calc-v3") return unit.phase === "all" ? "calc-v3" : `calc-v3-${unit.phase}`;
  if (unit.kind === "development") return "full-development";
  if (unit.shard?.files.length) return `filtered-${input.suite}`;
  return input.suite === "full" && plan?.development === "none" ? "filtered-full" : input.suite;
}

function checkReport(unitDirectory: string, phase: string, where: string, problems: string[]): Report | undefined {
  const relative = `${phase}/report.json`;
  const file = path.join(unitDirectory, relative);
  if (!fs.existsSync(file)) {
    problems.push(`${where} has no ${relative}.`);
    return undefined;
  }
  const bytes = fs.readFileSync(file);
  let run: Record<string, unknown>;
  try { run = record(record(JSON.parse(bytes.toString("utf8"))).run); } catch {
    problems.push(`${where} ${relative} is not JSON.`);
    return undefined;
  }
  const results = (Array.isArray(run.results) ? run.results : []).map(record).filter((result) => result.selected === true);
  const summary = record(run.summary);
  if (results.length === 0) problems.push(`${where} ${relative} has no selected result.`);
  const red = results.filter((result) => result.status !== "passed");
  if (red.length) problems.push(`${where} ${relative}: ${red.length} selected result(s) not passed, first ${String(red[0].file)} (${String(red[0].status)}).`);
  if (["failed", "skipped", "flaky", "interrupted"].some((key) => (summary[key] ?? 0) !== 0) ||
    ["selected", "executed", "passed"].some((key) => summary[key] !== results.length) || run.exitCode !== 0) {
    problems.push(`${where} ${relative} counts do not add up to every selected result executed and passed.`);
  }
  const discovered = (Array.isArray(run.results) ? run.results : []).map((result) => String(record(result).file));
  return { path: relative, sha256: sha256(bytes), summary, files: sorted(results.map((result) => String(result.file))), discovered: sorted(discovered) };
}

/** Checks one unit's evidence and returns what the aggregate manifest records of it. */
/**
 * Where each unit's artifact was downloaded: <evidence>/<artifact>/, except
 * that actions/download-artifact extracts the only artifact a pattern matches
 * into <evidence> itself. That flat directory is read as the single planned
 * unit, whose manifest identity (shard, phase, scope) is then checked as any
 * other's; flat beside several planned units, none can be told apart.
 */
function unitDirectories(input: AggregateInput, units: Unit[], problems: string[]): Map<Unit, string> {
  const flat = fs.existsSync(path.join(input.evidence, "manifest.json"));
  if (flat && units.length > 1) problems.push(`The evidence holds one artifact, extracted flat, for ${units.length} planned units.`);
  return new Map(units.map((unit) => [unit, flat && units.length === 1 ? input.evidence : path.join(input.evidence, unit.artifact)]));
}

function checkUnit(input: AggregateInput, unit: Unit, directory: string, plan: Plan | undefined, problems: string[]): UnitRecord {
  const where = unit.kind === "shard" ? unit.id : `${unit.id} (${unit.artifact})`;
  const manifestFile = path.join(directory, "manifest.json");
  if (!fs.existsSync(manifestFile)) {
    problems.push(`${where} left no evidence: ${unit.artifact}/manifest.json is missing.`);
    return { id: unit.id, artifact: unit.artifact, kind: unit.kind, status: "missing" };
  }
  const before = problems.length;
  const bytes = fs.readFileSync(manifestFile);
  let manifest: Record<string, unknown>;
  try { manifest = record(JSON.parse(bytes.toString("utf8"))); } catch {
    problems.push(`${where} ${unit.artifact}/manifest.json is not JSON.`);
    return { id: unit.id, artifact: unit.artifact, kind: unit.kind, status: "failed", manifestSha256: sha256(bytes) };
  }
  const suite = input.suite === "calc-v3" ? "calc-v3" : input.suite;
  if (manifest.schemaVersion !== "army-native-ci-1" || manifest.suite !== suite) problems.push(`${where} is not a ${suite} runner manifest.`);
  if (manifest.status !== "passed") {
    const error = typeof manifest.error === "string" ? `: ${manifest.error.slice(0, 300)}` : "";
    problems.push(`${where} status ${String(manifest.status)}${error}.`);
  }
  if (manifest.privacy !== "passed") problems.push(`${where} did not pass its privacy check.`);
  const scope = expectedScope(input, unit, plan);
  if (manifest.scope !== scope) problems.push(`${where} has scope ${String(manifest.scope)}, expected ${scope}.`);

  // Integrity: the downloaded bytes are the unit's own inventory, nothing more.
  const inventory = Array.isArray(manifest.files) ? manifest.files.map(record) : [];
  const listed = new Set<string>();
  for (const entry of inventory) {
    const relative = String(entry.path ?? "");
    if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/u).includes("..")) {
      problems.push(`${where} inventory names an unsafe path ${relative}.`);
      continue;
    }
    listed.add(relative);
    const file = path.join(directory, relative);
    if (!fs.existsSync(file) || sha256(fs.readFileSync(file)) !== entry.sha256) problems.push(`${where} ${relative} does not match its inventory.`);
  }
  if (inventory.length === 0) problems.push(`${where} has no evidence inventory.`);
  for (const file of listFiles(directory)) {
    if (file !== "manifest.json" && !listed.has(file)) problems.push(`${where} ${file} is not in its inventory.`);
  }

  const source = record(manifest.source);
  const result: UnitRecord = {
    id: unit.id, artifact: unit.artifact, kind: unit.kind, status: "passed", manifestSha256: sha256(bytes), scope: String(manifest.scope),
    source: { revision: source.revision, diffSha256: source.diffSha256, inputsSha256: sha256(JSON.stringify(source.inputs ?? null)) },
  };
  if (unit.kind === "calc-v3") {
    if (unit.phase !== "all" && manifest.calcV3Phase !== unit.phase) problems.push(`${where} records calc-v3 phase ${String(manifest.calcV3Phase)}.`);
    if (unit.phase === "all" && manifest.calcV3Phase !== undefined) problems.push(`${where} records one phase for the whole campaign.`);
    const campaignFile = path.join(directory, "calc-v3.json");
    let campaign: Record<string, unknown> = {};
    try { campaign = record(readJson(campaignFile)); } catch { problems.push(`${where} has no readable calc-v3.json.`); }
    const phases = (Array.isArray(campaign.phases) ? campaign.phases : []).map(record);
    result.phases = phases.map((phase) => String(phase.phase));
    if (phases.length === 0 || phases.some((phase) => phase.status !== "passed")) {
      problems.push(`${where} calc-v3.json: phases ${phases.map((phase) => `${String(phase.phase)} ${String(phase.status)}`).join(", ") || "none"}.`);
    }
    if (unit.phase !== "all" && !same(result.phases, [unit.phase!])) problems.push(`${where} calc-v3.json ran ${result.phases.join(", ")}.`);
  } else {
    if (unit.kind === "shard") {
      const shard = record(manifest.shard);
      if (shard.index !== unit.shard!.shard || shard.total !== unit.shard!.total) {
        problems.push(`${where}: its manifest records shard ${String(shard.index)}/${String(shard.total)}.`);
      }
    }
    if (plan?.workers != null && manifest.workers !== plan.workers) problems.push(`${where} ran ${String(manifest.workers)} workers, planned ${plan.workers}.`);
    const planned = unit.shard?.files ?? [];
    const journeyFiles = strings(manifest.journeyFiles);
    result.journeyFiles = journeyFiles;
    if (planned.length ? !journeyFiles || !same(journeyFiles, planned) : journeyFiles !== undefined) {
      problems.push(`${where} recorded journey files ${journeyFiles?.join(",") ?? "(none)"}, planned ${planned.join(",") || "(the runner's own suite)"}.`);
    }
    if (input.suite === "full" && plan?.development === "none" && typeof manifest.grep !== "string") problems.push(`${where} is not a --grep run.`);
    const phases = (Array.isArray(manifest.phases) ? manifest.phases : []).map(record);
    const wanted = expectedPhases(input, unit, plan);
    result.phases = phases.map((phase) => String(phase.phase));
    if (!same(result.phases, wanted) || phases.length !== wanted.length || phases.some((phase) => phase.status !== "passed")) {
      problems.push(`${where} phases ${phases.map((phase) => `${String(phase.phase)} ${String(phase.status)}`).join(", ") || "none"}, expected ${wanted.join(", ")} passed.`);
    }
    result.reports = wanted.flatMap((phase) => checkReport(directory, phase, where, problems) ?? []);
    const ran = result.reports.find((report) => report.path === `${wanted[0]}/report.json`)?.files ?? [];
    if (planned.length) {
      for (const file of planned) if (!ran.includes(file)) problems.push(`${where} did not run ${file}.`);
      for (const file of ran) if (!planned.includes(file)) problems.push(`${where} ran ${file}, which its plan does not list.`);
    }
  }
  if (problems.length > before) result.status = "failed";
  return result;
}

/** Union, overlap and source identity across the units. */
function checkAcrossUnits(input: AggregateInput, plan: Plan | undefined, records: UnitRecord[], problems: string[], wholeSuite = false) {
  const sources = records.filter((unit) => unit.source);
  const revisions = sorted(sources.map((unit) => JSON.stringify(unit.source)));
  if (revisions.length > 1) problems.push(`Units tested different sources (revision, diff or inputs): ${sorted(sources.map((unit) => String(unit.source!.revision))).join(", ")}.`);
  if (input.revision && sources.some((unit) => unit.source!.revision !== input.revision)) {
    problems.push(`A unit's revision differs from the tested commit ${input.revision}.`);
  }
  if (!plan || plan.files.length === 0) return undefined;
  const owners = new Map<string, string[]>();
  for (const unit of records.filter((entry) => entry.kind === "shard" && entry.reports)) {
    for (const file of unit.reports![0]?.files ?? []) if (file !== SETUP) owners.set(file, [...(owners.get(file) ?? []), unit.id]);
  }
  const executed = sorted([...owners.keys(), ...(owners.size ? [SETUP] : [])]);
  const union = {
    expected: plan.files, executed,
    missing: plan.files.filter((file) => !executed.includes(file)),
    unexpected: executed.filter((file) => !plan.files.includes(file)),
    duplicated: [...owners].filter(([, units]) => units.length > 1).map(([file]) => file),
  };
  if (union.missing.length) problems.push(`Planned files missing from every shard: ${union.missing.join(", ")}.`);
  if (union.unexpected.length) problems.push(`Files run outside the plan: ${union.unexpected.join(", ")}.`);
  if (union.duplicated.length) problems.push(`Files run by two shards: ${union.duplicated.join(", ")}.`);
  if (!wholeSuite) return union;
  // Each shard's report lists every test the e2e CLI discovered for the suite,
  // unselected ones skipped: the listing must be exactly that discovery.
  const discoveries = records.filter((entry) => entry.kind === "shard" && entry.reports?.[0]).map((entry) => entry.reports![0].discovered);
  const discovered = sorted(discoveries.flat());
  const unlisted = sorted(discoveries.flatMap((files) => files.filter((file) => !plan.files.includes(file))));
  const undiscovered = sorted(discoveries.flatMap((files) => plan.files.filter((file) => !files.includes(file))));
  if (unlisted.length) problems.push(`The e2e CLI discovers journeys the plan does not list: ${unlisted.join(", ")}.`);
  if (undiscovered.length) problems.push(`The plan lists journeys the e2e CLI does not discover: ${undiscovered.join(", ")}.`);
  return { ...union, discovered };
}

export function aggregateEvidence(input: AggregateInput): AggregateResult {
  const startedAt = new Date().toISOString();
  const problems: string[] = [];
  const { units, plan, scope, wholeSuite } = plannedUnits(input, problems);
  checkJobs(input, units, plan, problems);
  if (units.length === 0) {
    // An explicit none: nothing ran, nothing is claimed.
    return { status: problems.length ? "failed" : "not-run", problems, evidence: null };
  }
  const directories = unitDirectories(input, units, problems);
  const records = units.map((unit) => checkUnit(input, unit, directories.get(unit)!, plan, problems));
  const union = checkAcrossUnits(input, plan, records, problems, wholeSuite);
  fs.rmSync(input.out, { recursive: true, force: true });
  for (const unit of units) {
    const source = directories.get(unit)!;
    if (fs.existsSync(source)) fs.cpSync(source, path.join(input.out, "units", unit.artifact), { recursive: true });
  }
  const status = problems.length ? "failed" : "passed";
  const manifest = {
    schemaVersion: "army-ci-aggregate-1", suite: input.suite, scope, status, revision: input.revision ?? null,
    startedAt, finishedAt: new Date().toISOString(), jobs: input.results,
    plan: input.suite === "calc-v3" ? { phases: input.plan } : { reason: plan?.reason, files: plan?.files, workers: plan?.workers,
      development: plan?.development, shards: plan?.shards },
    units: records, ...(union ? { union } : {}), problems,
  };
  fs.mkdirSync(input.out, { recursive: true });
  fs.writeFileSync(path.join(input.out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { status, problems, evidence: input.out };
}

function summary(input: AggregateInput, result: AggregateResult): string {
  const title = { critical: "TesterArmy critical", full: "TesterArmy full", "calc-v3": "TesterArmy calc-v3" }[input.suite];
  const lines = [`### ${title} : agrégation des jobs parallèles`, ""];
  if (result.status === "not-run") return `${[...lines, "Aucun parcours sélectionné : aucun job lancé, aucune preuve revendiquée.", ""].join("\n")}\n`;
  lines.push(result.status === "passed" ? "Tous les jobs prévus ont réussi, leurs preuves sont intègres et couvrent la sélection." : "Agrégation en échec :", "");
  for (const problem of result.problems.slice(0, 50)) lines.push(`- ${problem}`);
  return `${lines.join("\n")}\n`;
}

function main() {
  const [suite, ...args] = process.argv.slice(2);
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    if (!["--plan", "--phases", "--evidence", "--out", "--results", "--revision"].includes(args[index]) || values.has(args[index]) || !args[index + 1]) {
      throw new Error(`Unknown, repeated or empty argument ${args[index]}.`);
    }
    values.set(args[index], args[index + 1]);
  }
  if (!["critical", "full", "calc-v3"].includes(suite) || !values.get("--evidence") || !values.get("--out") || !values.has("--results") ||
    (suite === "calc-v3" ? !values.has("--phases") : !values.has("--plan"))) {
    throw new Error("Usage: node scripts/tester-army/aggregate-shards.ts critical|full --plan FILE | calc-v3 --phases A,B " +
      "--evidence DIR --out DIR --results job=result,... [--revision SHA]");
  }
  const results = Object.fromEntries(values.get("--results")!.split(",").filter(Boolean).map((pair) => {
    const index = pair.indexOf("=");
    return [pair.slice(0, index), pair.slice(index + 1)];
  }));
  let plan: unknown;
  try {
    plan = suite === "calc-v3" ? values.get("--phases")!.split(",").filter(Boolean) : readJson(values.get("--plan")!);
  } catch {
    plan = undefined;
  }
  const input: AggregateInput = { suite: suite as AggregateSuite, plan, evidence: path.resolve(values.get("--evidence")!),
    out: path.resolve(values.get("--out")!), results, revision: values.get("--revision") };
  const result = aggregateEvidence(input);
  if (process.env.GITHUB_OUTPUT && result.evidence) fs.appendFileSync(process.env.GITHUB_OUTPUT, `evidence=${result.evidence}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(input, result));
  for (const problem of result.problems) console.log(`::error title=TesterArmy aggregate::${problem.replace(/\r?\n/gu, " ")}`);
  console.log(`TesterArmy ${suite} aggregate ${result.status}${result.evidence ? `; evidence: ${result.evidence}` : ""}.`);
  if (result.status === "failed") process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 2;
  }
}
