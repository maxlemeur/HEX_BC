import type { CalcV3PhaseDefinition } from "./calc-v3-phases.ts";
import { ASSEMBLY_TOTALS_JOURNEY, COVERAGE_JOURNEYS, LOGIN_SETUP } from "./journey-selections.mjs";

export const SOURCE_COVERAGE_PHASES = ["source-coverage-decisions", "source-coverage-edits", "source-coverage-recovery"] as const;
export const COVERAGE_PHASES = [...SOURCE_COVERAGE_PHASES, "generated-atomic", "generated-recovery", "navigation-lease", "batch-client", "assembly-totals", "mobile"] as const;
export type CoveragePhase = (typeof COVERAGE_PHASES)[number];
const sourceCoverage = COVERAGE_JOURNEYS["source-coverage"];
const phase = (file: string, count: number): CalcV3PhaseDefinition => ({
  serverMode: "production",
  tests: [LOGIN_SETUP, file],
  setupTitle: "authenticate the existing E2E account without provisioning memberships",
  expected: { [LOGIN_SETUP]: 1, [file]: count },
  maxDuration: 3_600_000,
});

// Standing selections for the former manual coverage recipes. Each phase owns
// fresh prerequisites on the campaign's ephemeral stack and verifies real writes.
export const COVERAGE_PHASE_DEFINITIONS: Readonly<Record<CoveragePhase, CalcV3PhaseDefinition>> = {
  mobile: { ...phase("e2e/army/local/mobile-journeys.e2e.ts", 3), target: "chromium-mobile" },
  // SC01 to SC09 each take about a minute on their own fresh scenario: three
  // phases, which the plan spreads over its group jobs, keep the CCTP journeys
  // off the campaign's critical path.
  "source-coverage-decisions": { ...phase(sourceCoverage, 4), defaultGrep: "^SC0(1-03|2|4|5)\\s" },
  "source-coverage-edits": { ...phase(sourceCoverage, 4), defaultGrep: "^SC06\\s" },
  "source-coverage-recovery": { ...phase(sourceCoverage, 3), defaultGrep: "^SC0[789]\\s" },
  "generated-atomic": phase(COVERAGE_JOURNEYS["generated-atomic"], 2),
  "generated-recovery": phase(COVERAGE_JOURNEYS["generated-recovery"], 6),
  "navigation-lease": phase(COVERAGE_JOURNEYS["navigation-lease"], 5),
  "batch-client": phase("e2e/army/local/estimate-batch-client.e2e.ts", 4),
  "assembly-totals": phase(ASSEMBLY_TOTALS_JOURNEY, 2),
};
