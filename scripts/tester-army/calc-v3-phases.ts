// Phase table shared by the calc-v3 TesterArmy profile (e2e/army/local/calc-v3.config.ts)
// and its owned-stack campaign (scripts/tester-army/calc-v3-campaign.ts). Pure data:
// the profile loads it at config time, so it must not import clients or fixtures.
// Contract and failure modes: docs/testing/tester-army-calc-v3.md.

export const CALC_V3_PHASES = ["journeys", "components", "numeric", "resume", "access", "offers", "emission", "emission-v3"] as const;
export type CalcV3Phase = (typeof CALC_V3_PHASES)[number];

/** The developers' long-running local recipe stack (API 45585, DB 33485): never a calc-v3 target. */
export const CALC_V3_FORBIDDEN_PORTS: ReadonlySet<string> = new Set(["45585", "33485"]);

export const CALC_V3_EMAIL_FROM = "ARMY Local <offer@army.invalid>";

export type CalcV3PhaseDefinition = {
  /** production: owned build + next start; development: next dev (sandbox terms, emission phases only). */
  serverMode: "production" | "development";
  /**
   * The phase sends real offers: the campaign starts the sentinel collector, the profile loads the
   * offer network guard and the collected PDFs are read back (emission and emission-v3 only).
   */
  sentinelCollector?: boolean;
  /** The first file is the phase's own login setup; each phase runs in its own TesterArmy invocation. */
  tests: readonly string[];
  setupTitle: string;
  /** Passed results expected per file in an unfiltered run, setup included. */
  expected: Readonly<Record<string, number>>;
  /** Applied when no --grep is given; the expected counts describe this selection. */
  defaultGrep?: string;
  /**
   * Journeys red on the unmodified 2.0 base (98408ef0) for a recorded pre-existing
   * reason, kept out of defaultGrep and copied into every phase.json. Reproduce with
   * `--phase <phase> --grep <grep>`; docs/testing/tester-army-calc-v3.md records each cause.
   */
  knownRedAtBase?: { grep: string; journeys: readonly string[] };
  /**
   * Text every PDF received by the sentinel collector must contain in an unfiltered run:
   * the business content of the default selection, not merely a readable file.
   */
  collectedPdfMustContain?: readonly RegExp[];
  maxDuration: number;
};

const CRITICAL_SETUP = "e2e/army/critical/auth.setup.e2e.ts";
const CRITICAL_SETUP_TITLE = "authenticate the existing E2E account without provisioning memberships";

export const CALC_V3_PHASE_DEFINITIONS: Readonly<Record<CalcV3Phase, CalcV3PhaseDefinition>> = {
  journeys: {
    serverMode: "production",
    tests: [
      CRITICAL_SETUP,
      "e2e/army/critical/commercial-rounding.e2e.ts",
      "e2e/army/critical/dpgf-import.e2e.ts",
      "e2e/army/local/estimate-totals-order.e2e.ts",
      "e2e/army/local/estimate-create-atomic.e2e.ts",
      "e2e/army/local/estimate-batch-atomic.e2e.ts",
    ],
    setupTitle: CRITICAL_SETUP_TITLE,
    expected: {
      [CRITICAL_SETUP]: 1,
      "e2e/army/critical/commercial-rounding.e2e.ts": 2,
      "e2e/army/critical/dpgf-import.e2e.ts": 3,
      "e2e/army/local/estimate-totals-order.e2e.ts": 1,
      "e2e/army/local/estimate-create-atomic.e2e.ts": 3,
      "e2e/army/local/estimate-batch-atomic.e2e.ts": 1,
    },
    maxDuration: 2_400_000,
  },
  components: {
    serverMode: "production",
    tests: [CRITICAL_SETUP, "e2e/army/local/generated-ouvrage-components.e2e.ts"],
    setupTitle: CRITICAL_SETUP_TITLE,
    expected: { [CRITICAL_SETUP]: 1, "e2e/army/local/generated-ouvrage-components.e2e.ts": 4 },
    maxDuration: 2_400_000,
  },
  numeric: {
    serverMode: "production",
    tests: [CRITICAL_SETUP, "e2e/army/local/generated-ouvrage-numeric-entry.e2e.ts"],
    setupTitle: CRITICAL_SETUP_TITLE,
    expected: { [CRITICAL_SETUP]: 1, "e2e/army/local/generated-ouvrage-numeric-entry.e2e.ts": 3 },
    maxDuration: 2_400_000,
  },
  resume: {
    serverMode: "production",
    tests: [CRITICAL_SETUP, "e2e/army/local/generated-ouvrage-resume.e2e.ts"],
    setupTitle: CRITICAL_SETUP_TITLE,
    expected: { [CRITICAL_SETUP]: 1, "e2e/army/local/generated-ouvrage-resume.e2e.ts": 4 },
    defaultGrep: "^GR0[2468]\\s",
    // GR01, GR03, GR07 and GR09: forged requests or oracles predate the insertion,
    // rejection and error contracts committed with them in 28ccc857. GR05: its
    // waitForResponse can capture the late event of the response it fulfilled itself
    // just before. The doc records each exact cause.
    knownRedAtBase: { grep: "^GR0[13579]\\s", journeys: ["GR01", "GR03", "GR05", "GR07", "GR09"] },
    maxDuration: 3_600_000,
  },
  access: {
    serverMode: "production",
    tests: [CRITICAL_SETUP, "e2e/army/local/generated-ouvrage-access.e2e.ts"],
    setupTitle: CRITICAL_SETUP_TITLE,
    expected: { [CRITICAL_SETUP]: 1, "e2e/army/local/generated-ouvrage-access.e2e.ts": 1 },
    maxDuration: 900_000,
  },
  // Sub-lots 2.2 (A7, P-08) and 2.9 (P-18): zero-priced supplier offers, units and purchase units,
  // on catalogue records seeded for this phase only (docs/testing/estimate-engine-v3-2.2.md, -2.9.md).
  offers: {
    serverMode: "production",
    tests: [CRITICAL_SETUP, "e2e/army/local/supplier-offer-zero-price.e2e.ts", "e2e/army/local/supplier-offer-purchase-unit.e2e.ts"],
    setupTitle: CRITICAL_SETUP_TITLE,
    expected: { [CRITICAL_SETUP]: 1, "e2e/army/local/supplier-offer-zero-price.e2e.ts": 4,
      "e2e/army/local/supplier-offer-purchase-unit.e2e.ts": 5 },
    maxDuration: 1_200_000,
  },
  emission: {
    serverMode: "development",
    sentinelCollector: true,
    tests: ["e2e/army/local/offer-emission-auth.setup.e2e.ts", "e2e/army/local/offer-emission.e2e.ts"],
    setupTitle: "ordinary native ARMY login for local offer profile",
    expected: { "e2e/army/local/offer-emission-auth.setup.e2e.ts": 1, "e2e/army/local/offer-emission.e2e.ts": 5 },
    defaultGrep: "^OF0[0-24L]\\s",
    // OF03's header matchers expect "P.U. HT" or "Prix unitaire"; the PDF and the
    // portal both print "PU HT". PDFL, EF and NF stay opt-in through --grep.
    knownRedAtBase: { grep: "^OF03\\s", journeys: ["OF03"] },
    // OF00 to OF02 each send one ARMY-OFFER line of 1 u at 20,00 € HT with 20 % VAT.
    collectedPdfMustContain: [
      /ARMY-OFFER-/u,
      /Désignation\s+Qté\s+Unité\s+PU\s+HT\s+Total\s+HT/u,
      /\s1\s+u\s+20,00\s*€\s+20,00\s*€/u,
      /Total\s+HT\s+20,00\s*€\s+TVA\s+4,00\s*€\s+Total\s+TTC\s+24,00\s*€/u,
    ],
    maxDuration: 3_600_000,
  },
  // Sub-lot 2.7 (D14, D15, M5): a v3 issued under client contract 2 and calculation payload 6, on a
  // dedicated owner whose tenant policy is at engine 3, plus a v2 witness issued first under
  // contract 1 (docs/testing/estimate-engine-v3-2.7.md). Same next dev server, collector and offer
  // guard as `emission`. The phase sends the v2 witness and the v3 S2 and S5 offers (S5 twice):
  // their PDFs differ by design, so the content is asserted per PDF by the journey (V3M01), not by a
  // pattern shared by every collected PDF.
  "emission-v3": {
    serverMode: "development",
    sentinelCollector: true,
    tests: ["e2e/army/local/offer-emission-auth.setup.e2e.ts", "e2e/army/local/engine-v3-emission.e2e.ts"],
    setupTitle: "ordinary native ARMY login for local offer profile",
    expected: { "e2e/army/local/offer-emission-auth.setup.e2e.ts": 1, "e2e/army/local/engine-v3-emission.e2e.ts": 1 },
    maxDuration: 3_600_000,
  },
};

export function isCalcV3Phase(value: unknown): value is CalcV3Phase {
  return typeof value === "string" && (CALC_V3_PHASES as readonly string[]).includes(value);
}
