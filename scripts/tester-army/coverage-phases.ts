import type { CalcV3PhaseDefinition } from "./calc-v3-phases.ts";

export const COVERAGE_PHASES = ["source-coverage", "generated-atomic", "generated-recovery", "navigation-lease", "batch-client", "assembly-totals", "mobile"] as const;
export type CoveragePhase = (typeof COVERAGE_PHASES)[number];
const setup = "e2e/army/critical/auth.setup.e2e.ts";
const phase = (file: string, count: number): CalcV3PhaseDefinition => ({
  serverMode: "production",
  tests: [setup, file],
  setupTitle: "authenticate the existing E2E account without provisioning memberships",
  expected: { [setup]: 1, [file]: count },
  maxDuration: 3_600_000,
});

// Standing selections for the former manual coverage recipes. Each phase owns
// fresh prerequisites on the campaign's ephemeral stack and verifies real writes.
export const COVERAGE_PHASE_DEFINITIONS: Readonly<Record<CoveragePhase, CalcV3PhaseDefinition>> = {
  mobile: { ...phase("e2e/army/local/mobile-journeys.e2e.ts", 3), target: "chromium-mobile" },
  "source-coverage": phase("e2e/army/local/source-coverage.e2e.ts", 11),
  "generated-atomic": phase("e2e/army/local/estimate-generated-atomic.e2e.ts", 2),
  "generated-recovery": phase("e2e/army/local/estimate-generated-recovery.e2e.ts", 6),
  "navigation-lease": phase("e2e/army/local/editor-navigation-lease.e2e.ts", 2),
  "batch-client": phase("e2e/army/local/estimate-batch-client.e2e.ts", 4),
  "assembly-totals": phase("e2e/army/local/assembly-totals.e2e.ts", 2),
};
