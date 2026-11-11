// Plain Node type stripping: no dependency install or model is needed to decide CI.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CALC_V3_PHASES, CALC_V3_PHASE_DEFINITIONS, isCalcV3Phase, type CalcV3Phase } from "./calc-v3-phases.ts";
import { SOURCE_COVERAGE_PHASES } from "./coverage-phases.ts";
import { buildSourceGraph, listRepositoryFiles, loadImpactMap, matchesAny, reverseClosure, SHARDS_PATH } from "./select-journeys.ts";

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

export function selectCalcV3(root: string, paths: string[]): CalcSelection {
  if (!paths.length) return all("Empty or unavailable diff: all phases.");
  try {
    const { map } = loadImpactMap(root), repository = listRepositoryFiles(root);
    if (paths.every((file) => matchesAny(file, map.docs))) return { phases: [], reason: "Documentation only; no journey execution claimed.", changedPaths: paths };
    const graph = buildSourceGraph(root, map, repository), selected = new Set<CalcV3Phase>();
    for (const file of paths) {
      if (matchesAny(file, map.docs)) continue;
      // Global runners, migrations, calculations and unknown dependencies must
      // exercise every phase; a map miss must never silently discard a journey.
      if (matchesAny(file, map.full)) return all(`Shared input: ${file}`, paths);
      const closure = reverseClosure(graph, file);
      closure.add(file);
      let reached = false;
      for (const candidate of closure) {
        for (const phase of CALC_V3_PHASES) {
          if (CALC_V3_PHASE_DEFINITIONS[phase].tests.includes(candidate)) { selected.add(phase); reached = true; }
        }
        for (const rule of rules) if (matchesAny(candidate, rule.paths)) {
          rule.phases.forEach((phase) => selected.add(phase)); reached = true;
        }
      }
      if (!reached) return all(`Impact not mapped: ${file}`, paths);
    }
    return { phases: CALC_V3_PHASES.filter((phase) => selected.has(phase)), reason: "Affected phases from imports, API references and domain rules.", changedPaths: paths };
  } catch (error) { return all(`Selection failed: ${error instanceof Error ? error.message : String(error)}`, paths); }
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
