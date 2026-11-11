// Plain Node type stripping: no dependency install or model is needed to decide CI.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CALC_V3_PHASES, CALC_V3_PHASE_DEFINITIONS, isCalcV3Phase, type CalcV3Phase } from "./calc-v3-phases.ts";
import { SOURCE_COVERAGE_PHASES } from "./coverage-phases.ts";
import {
  buildSourceGraph, isEntryPoint, listRepositoryFiles, loadImpactMap, matchesAny, reverseClosure, SHARDS_PATH,
  type ImpactMap, type SourceGraph,
} from "./select-journeys.ts";

export type CalcSelection = { phases: (CalcV3Phase | "all")[]; reason: string; changedPaths: string[] };
/** army-shards.json, calcV3: the most group jobs of a campaign and the measured journey seconds of each phase. */
export type CalcV3GroupDurations = { note?: string; measured?: string[]; maxGroups: number; defaultSeconds: number; seconds: Record<string, number> };
/** One job: its phases run one after another on one owned stack; seconds: their measured journeys, without the stack. */
export type CalcV3Group = { group: number; total: number; phases: (CalcV3Phase | "all")[]; seconds: number };
export type CalcV3GroupPlan = { grouping: string; groups: CalcV3Group[] };
const all = (reason: string, changedPaths: string[] = []): CalcSelection => ({ phases: [...CALC_V3_PHASES], reason, changedPaths });
const rules: { paths: string[]; phases: CalcV3Phase[] }[] = [
  { paths: ["src/**/generated-ouvrage*", "src/**/generated-ouvrage*/**", "src/**/GeneratedOuvrage*", "src/**/estimate-generation*"], phases: ["components", "numeric", "resume", "access", "generated-atomic", "generated-recovery", "assembly-totals", ...SOURCE_COVERAGE_PHASES] },
  { paths: ["src/**/source-coverage*", "src/**/source-review/**", "src/**/SourceCoverage*", "src/**/source-requirement*", "e2e/fixtures/source-coverage/**"], phases: [...SOURCE_COVERAGE_PHASES] },
  { paths: ["src/**/draft-lock*", "src/**/useEstimateDraftLock*", "src/**/useEstimateBatch*", "src/**/batch-operations*"], phases: ["journeys", "navigation-lease", "batch-client", "generated-atomic", "generated-recovery", "resume"] },
  { paths: ["src/**/email*", "src/**/portal*", "src/**/resend*", "src/**/send-route*", "src/**/send/**", "src/**/pdf*", "src/**/pdf/**", "src/**/Portal*"], phases: ["emission", "emission-v3", "resend-portal"] },
  { paths: ["src/**/supplier-offer*", "src/**/supplier-pric*", "src/**/SupplierOffer*"], phases: ["offers-zero-price", "offers-purchase-unit"] },
];

/**
 * Non-runtime for the critical map, yet what every calc-v3 job runs before its first phase: its workflow and
 * profile, the RLS matrix and its Vitest configuration (src/test/local-supabase-ci.ts, runRlsMatrix), and the
 * OpenAPI document the owned build validates first (local-recipe-common.mjs, buildCommands).
 */
export const CALC_V3_OWN_INPUTS = [
  ".github/workflows/e2e-army-calc-v3.yml", "e2e.calc-v3.config.ts", "openapi.json", "vitest.config.ts", "src/lib/estimates/rls.e2e.test.ts",
];
/** The profile, the campaign and this selector: what they import can alter every phase. */
export const CALC_V3_RUNNER_ENTRIES = ["e2e/army/local/calc-v3.config.ts", "scripts/tester-army/calc-v3-campaign.ts", "scripts/tester-army/select-calc-v3.ts"];
/** Journey code of the critical suite: a phase runs one of its journeys only when its table lists the file. */
const CRITICAL_JOURNEY_CODE = /^e2e\/army\/critical\/.+\.ts$/u;
/**
 * Under src/, only a unit test is outside the phases. The owned build of every phase type-checks the rest of
 * what the map calls non-runtime there (declarations, test utilities, the helpers of src/test), and the stack
 * preparation and campaign scripts spawn or read some by path (large-estimate-workbook.ts, src/test/fixtures).
 */
const UNIT_TEST = /\.test\.tsx?$/u;

/** The files the calc-v3 profile, campaign and selector load, transitively. */
export function calcV3RunnerClosure(graph: SourceGraph): Set<string> {
  const closure = new Set<string>();
  const pending = CALC_V3_RUNNER_ENTRIES.filter((file) => graph.files.has(file));
  while (pending.length) {
    const file = pending.pop()!;
    if (closure.has(file)) continue;
    closure.add(file);
    for (const target of graph.imports.get(file) ?? []) pending.push(target);
  }
  return closure;
}

/**
 * The phases one changed file can alter, or why every phase must run. The file's impact is everything that
 * loads it or names its API route. Each entry point it reaches must be accounted for: the journey of a phase,
 * a domain rule, or an entry point no phase loads (what the critical map calls non-runtime, and the journeys
 * of the critical suite). One the selector does not know runs every phase, whatever else was reached: a page
 * no rule maps is not proven by the phases of a test that happens to name the same API.
 * No phase at all is the answer only for a file that is itself outside the phases (a unit test, tooling, a
 * journey of another suite). Application code that reaches none still runs every phase, and so does a path
 * absent from the tree: the graph sees the static imports and API literals of the tree, not every way a file
 * is loaded, nor what still imports a deleted one.
 */
export function calcV3Impact(map: ImpactMap, graph: SourceGraph, runner: Set<string>, file: string): { phases: CalcV3Phase[] } | { all: string } {
  // Global runners, migrations, calculations and unknown dependencies must
  // exercise every phase; a map miss must never silently discard a journey.
  if (matchesAny(file, map.full)) return { all: `Shared input: ${file}` };
  if (!graph.files.has(file)) return { all: `Deleted or unknown path: ${file}` };
  const outsidePhases = (member: string) => CRITICAL_JOURNEY_CODE.test(member) ||
    (matchesAny(member, map.nonRuntime) && (!member.startsWith("src/") || UNIT_TEST.test(member)));
  const phases = new Set<CalcV3Phase>();
  for (const member of [...reverseClosure(graph, file)].sort()) {
    const through = member === file ? file : `${file} (through ${member})`;
    if (graph.runnerClosure.has(member)) return { all: `Loaded by the critical runner, whose fixtures the phases share: ${through}` };
    if (runner.has(member) || CALC_V3_OWN_INPUTS.includes(member)) return { all: `calc-v3 input: ${through}` };
    if (member !== file && matchesAny(member, map.full) && !matchesAny(member, map.graph.escalationExcluded)) return { all: `Shared input: ${through}` };
    // A non-runtime file (a unit test beside the code of a domain rule) matches no rule: the app never loads it.
    const reached = [
      ...CALC_V3_PHASES.filter((phase) => CALC_V3_PHASE_DEFINITIONS[phase].tests.includes(member)),
      ...(matchesAny(member, map.nonRuntime) ? [] : rules.filter((rule) => matchesAny(member, rule.paths)).flatMap((rule) => rule.phases)),
    ];
    reached.forEach((phase) => phases.add(phase));
    if (reached.length || !isEntryPoint(graph, member) || outsidePhases(member)) continue;
    return { all: `Impact not mapped: ${through}` };
  }
  if (!phases.size && !outsidePhases(file)) return { all: `Impact not mapped: ${file}` };
  return { phases: CALC_V3_PHASES.filter((phase) => phases.has(phase)) };
}

/** What a selection reads from the working tree: the impact map, its source graph and the closure of the calc-v3 runner. */
export type CalcV3Repository = { map: ImpactMap; graph: SourceGraph; runner: Set<string> };

/**
 * Reads the working tree once: git ls-files, then every source file for its imports and API literals (about
 * 0.15 s on 3,200 files, 18 cores, idle). A caller deciding for several diffs of one tree builds it once and
 * hands it to selectCalcV3FromRepository.
 */
export function loadCalcV3Repository(root: string, map = loadImpactMap(root).map, files = listRepositoryFiles(root)): CalcV3Repository {
  const graph = buildSourceGraph(root, map, files);
  return { map, graph, runner: calcV3RunnerClosure(graph) };
}

const documentationOnly = (map: ImpactMap, paths: string[]) => paths.every((file) => matchesAny(file, map.docs));
const docsSelection = (paths: string[]): CalcSelection => ({ phases: [], reason: "Documentation only; no journey execution claimed.", changedPaths: paths });
const failedSelection = (error: unknown, paths: string[]) => all(`Selection failed: ${error instanceof Error ? error.message : String(error)}`, paths);

/** The phases a diff reaches in an already read working tree; selectCalcV3 without reading the tree again. */
export function selectCalcV3FromRepository({ map, graph, runner }: CalcV3Repository, paths: string[]): CalcSelection {
  if (!paths.length) return all("Empty or unavailable diff: all phases.");
  try {
    if (documentationOnly(map, paths)) return docsSelection(paths);
    const selected = new Set<CalcV3Phase>();
    for (const file of paths) {
      if (matchesAny(file, map.docs)) continue;
      const impact = calcV3Impact(map, graph, runner, file);
      if ("all" in impact) return all(impact.all, paths);
      impact.phases.forEach((phase) => selected.add(phase));
    }
    return selected.size
      ? { phases: CALC_V3_PHASES.filter((phase) => selected.has(phase)), reason: "Affected phases from imports, API references and domain rules.", changedPaths: paths }
      : { phases: [], reason: "No phase loads the change: unit tests, tooling or journeys of other suites only.", changedPaths: paths };
  } catch (error) { return failedSelection(error, paths); }
}

export function selectCalcV3(root: string, paths: string[]): CalcSelection {
  if (!paths.length) return all("Empty or unavailable diff: all phases.");
  try {
    const { map } = loadImpactMap(root), files = listRepositoryFiles(root);
    // A documentation-only diff needs no source graph.
    if (documentationOnly(map, paths)) return docsSelection(paths);
    return selectCalcV3FromRepository(loadCalcV3Repository(root, map, files), paths);
  } catch (error) { return failedSelection(error, paths); }
}

export function planCalcV3(root: string, environment: NodeJS.ProcessEnv): CalcSelection {
  const selection = environment.CALC_V3_SELECTION ?? "nightly";
  if (selection === "all") return { phases: ["all"], reason: "Explicit complete campaign.", changedPaths: [] };
  if (isCalcV3Phase(selection)) return { phases: [selection], reason: "Explicit phase.", changedPaths: [] };
  if (selection !== "nightly") throw new Error("Unknown calc-v3 selection.");
  if (environment.EVENT_NAME !== "pull_request") return all("Push to main, scheduled or manually requested campaign.");
  if (environment.ARMY_FULL_LABEL === "true") return all("Label army-full.");
  const git = (...args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  const second = git("rev-parse", "--verify", "HEAD^2");
  if (second.status !== 0 || second.stdout.trim() !== environment.PR_HEAD_SHA) return all("Unproven pull-request merge commit.");
  const diff = git("diff", "--name-only", "--no-renames", "-z", "HEAD^1", "HEAD");
  return diff.status === 0 ? selectCalcV3(root, diff.stdout.split("\0").filter(Boolean)) : all("Git diff failed.");
}

/** Problems that make the calcV3 section of army-shards.json unusable. */
export function validateCalcV3GroupDurations(durations: unknown): string[] {
  const section = durations && typeof durations === "object" && !Array.isArray(durations) ? durations as Partial<CalcV3GroupDurations> : undefined;
  if (!section) return ["army-shards.json has no calcV3 section."];
  const problems: string[] = [];
  const positive = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0;
  if (!Number.isInteger(section.maxGroups) || section.maxGroups! < 1 || section.maxGroups! > 8) problems.push("army-shards.json calcV3 needs maxGroups from 1 to 8.");
  if (!positive(section.defaultSeconds)) problems.push("army-shards.json calcV3 defaultSeconds must be a positive number of seconds.");
  if (!section.seconds || typeof section.seconds !== "object" || Array.isArray(section.seconds)) {
    return [...problems, "army-shards.json calcV3 seconds must map phases to seconds."];
  }
  for (const [phase, seconds] of Object.entries(section.seconds)) {
    if (!positive(seconds)) problems.push(`army-shards.json calcV3 times ${phase} with ${seconds}, not a positive number of seconds.`);
    if (!isCalcV3Phase(phase)) problems.push(`army-shards.json calcV3 times ${phase}, which is not a calc-v3 phase.`);
  }
  return problems;
}

/** The calcV3 section of army-shards.json when it is readable and valid; null otherwise (every plan is then one group). */
export function loadCalcV3GroupDurations(root: string): CalcV3GroupDurations | null {
  try {
    const section = (JSON.parse(fs.readFileSync(path.join(root, SHARDS_PATH), "utf8")) as { calcV3?: unknown }).calcV3;
    return validateCalcV3GroupDurations(section).length ? null : section as CalcV3GroupDurations;
  } catch {
    return null;
  }
}

/**
 * Splits the selected phases into group jobs, each running its phases one after
 * another on one owned stack: as many groups as phases up to maxGroups, the
 * longest measured phase first onto the least loaded group. A phase is never
 * cut and no group is empty. Within a group, the order of the selection. One
 * group for the explicit complete campaign ("all") and without usable durations.
 */
export function planCalcV3Groups(phases: readonly (CalcV3Phase | "all")[], durations: CalcV3GroupDurations | null): CalcV3GroupPlan {
  const plan = (grouping: string, groups: (CalcV3Phase | "all")[][], seconds: number[]): CalcV3GroupPlan =>
    ({ grouping, groups: groups.map((list, index) => ({ group: index + 1, total: groups.length, phases: list, seconds: seconds[index] })) });
  const selected = [...new Set(phases)];
  if (selected.length === 0) return plan("no phase to run", [], []);
  const weight = (phase: CalcV3Phase | "all") => durations?.seconds[phase] ?? durations?.defaultSeconds ?? 0;
  if (selected.includes("all")) {
    return plan("one group: the explicit complete campaign runs in one job", [["all"]], [CALC_V3_PHASES.reduce((sum, phase) => sum + weight(phase), 0)]);
  }
  if (!durations) return plan(`one group: no usable measured durations (${SHARDS_PATH}, calcV3)`, [selected], [0]);
  const total = selected.reduce((sum, phase) => sum + weight(phase), 0);
  const count = Math.min(durations.maxGroups, selected.length);
  const bins = Array.from({ length: count }, () => ({ load: 0, phases: [] as (CalcV3Phase | "all")[] }));
  const longestFirst = [...selected].sort((a, b) => weight(b) - weight(a) || selected.indexOf(a) - selected.indexOf(b));
  for (const phase of longestFirst) {
    let target = 0;
    for (let index = 1; index < count; index += 1) if (bins[index].load < bins[target].load) target = index;
    bins[target].load += weight(phase);
    bins[target].phases.push(phase);
  }
  const plural = (number: number, noun: string) => `${number} ${noun}${number === 1 ? "" : "s"}`;
  return plan(`${plural(count, "group")}: ${total} s of measured journeys in ${plural(selected.length, "phase")}, at most ${durations.maxGroups}`,
    bins.map((bin) => selected.filter((phase) => bin.phases.includes(phase))), bins.map((bin) => bin.load));
}

/** One GitHub matrix entry per group; its phases comma-joined, the value of the runner's --phase ("all": none). */
export function groupMatrix(groups: readonly CalcV3Group[]): Array<{ group: number; total: number; phases: string }> {
  return groups.map(({ group, total, phases }) => ({ group, total, phases: phases.join(",") }));
}

/** What the plan job hands the workflow (GITHUB_OUTPUT): the selected phases and the matrix of its group jobs. */
export function planOutputs(plan: Pick<CalcSelection, "phases"> & Pick<CalcV3GroupPlan, "groups">): string {
  return `phases=${JSON.stringify(plan.phases)}\ngroups=${JSON.stringify(groupMatrix(plan.groups))}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const selection = planCalcV3(process.cwd(), process.env);
  const plan = { ...selection, ...planCalcV3Groups(selection.phases, loadCalcV3GroupDurations(process.cwd())) };
  const directory = path.resolve(".e2e/army/ci");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "calc-v3-selection.json"), `${JSON.stringify(plan, null, 2)}\n`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, planOutputs(plan));
  console.log(JSON.stringify(plan));
}
