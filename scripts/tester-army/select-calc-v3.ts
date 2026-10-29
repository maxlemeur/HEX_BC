// Plain Node type stripping: no dependency install or model is needed to decide CI.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CALC_V3_PHASES, CALC_V3_PHASE_DEFINITIONS, isCalcV3Phase, type CalcV3Phase } from "./calc-v3-phases.ts";
import { SOURCE_COVERAGE_PHASES } from "./coverage-phases.ts";
import { buildSourceGraph, listRepositoryFiles, loadImpactMap, matchesAny, reverseClosure } from "./select-journeys.ts";

export type CalcSelection = { phases: (CalcV3Phase | "all")[]; reason: string; changedPaths: string[] };
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
  if (environment.EVENT_NAME !== "pull_request") return all("Scheduled or manually requested campaign.");
  if (environment.ARMY_FULL_LABEL === "true") return all("Label army-full.");
  const git = (...args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  const second = git("rev-parse", "--verify", "HEAD^2");
  if (second.status !== 0 || second.stdout.trim() !== environment.PR_HEAD_SHA) return all("Unproven pull-request merge commit.");
  const diff = git("diff", "--name-only", "--no-renames", "-z", "HEAD^1", "HEAD");
  return diff.status === 0 ? selectCalcV3(root, diff.stdout.split("\0").filter(Boolean)) : all("Git diff failed.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const plan = planCalcV3(process.cwd(), process.env);
  const directory = path.resolve(".e2e/army/ci");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "calc-v3-selection.json"), `${JSON.stringify(plan, null, 2)}\n`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `phases=${JSON.stringify(plan.phases)}\n`);
  console.log(JSON.stringify(plan));
}
