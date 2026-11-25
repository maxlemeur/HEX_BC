// The TesterArmy journey lists and the selections built from them, as globs the e2e CLI reads. The runner's
// configurations run them (e2e.config.ts, the offer profiles), the calc-v3 phases reuse them, the impact
// selection maps and shards them (select-journeys.ts), and the journey preflight checks that they and the calc-v3
// phases collect every local journey (journey-preflight.mjs). Plain data, loaded without a build step by the
// runner, plain Node and Vitest.

/** The login setup every authenticated selection starts with. */
export const LOGIN_SETUP = "e2e/army/critical/auth.setup.e2e.ts";
const CRITICAL_JOURNEYS = "e2e/army/critical/**/*.e2e.ts";
/** The takeoff (métré) journeys: only the full selection runs them, so the impact selection calls them full-only. */
export const TAKEOFF_JOURNEYS = "e2e/army/takeoff/**/*.e2e.ts";

const LOCAL_BUSINESS_JOURNEYS = [
  "e2e/army/local/tech-debt-lock-boundaries.e2e.ts",
  "e2e/army/local/estimate-create-calculation-gate.e2e.ts",
  "e2e/army/local/engine-v3-*.e2e.ts",
  "e2e/army/local/estimate-copy-row-limit.e2e.ts",
  "e2e/army/local/estimate-row-limit-reads.e2e.ts",
  "e2e/army/local/supplier-preselection-v1-totals.e2e.ts",
  "e2e/army/local/bulk-actions-v1-totals.e2e.ts",
  "e2e/army/local/large-row-completeness.e2e.ts",
  "e2e/army/local/estimate-copy-large-v2.e2e.ts",
  "e2e/army/local/affaire-hub-fresh-start.e2e.ts",
  "e2e/army/local/estimate-reorder-move-large-v2.e2e.ts",
  "e2e/army/local/legacy-*-parity.e2e.ts",
  "e2e/army/local/article-association.e2e.ts",
  "e2e/army/local/brief-evidence.e2e.ts",
  "e2e/army/local/affaire-workbench.e2e.ts",
  "e2e/army/local/affaire-register.e2e.ts",
  "e2e/army/local/intake-cad.e2e.ts",
  "e2e/army/local/chatgpt-local-takeoff.e2e.ts",
  "e2e/army/local/chatgpt-local-decisions.e2e.ts",
  "e2e/army/local/chatgpt-local-intake.e2e.ts",
  "e2e/army/local/takeoff-lab.e2e.ts",
  "e2e/army/local/profile-polish.e2e.ts",
  "e2e/army/local/catalogue-provenance.e2e.ts",
  "e2e/army/local/purchase-decimals.e2e.ts",
  "e2e/army/local/purchase-draft-eligibility.e2e.ts",
  "e2e/army/local/purchase-preparation.e2e.ts",
  "e2e/army/local/purchase-readiness.e2e.ts",
  "e2e/army/local/reference-price.e2e.ts",
  "e2e/army/local/source-reference-read.e2e.ts",
  "e2e/army/local/source-reference.e2e.ts",
  "e2e/army/local/business-lifecycle.e2e.ts",
];

/**
 * The critical suite (E2E_ARMY_SUITE=critical) without a named selection: its critical journeys, joined by the
 * local business journeys when the backend is an owned loopback stack, as in every CI and local campaign.
 */
const CRITICAL_SUITE = [CRITICAL_JOURNEYS];
export const LOCAL_BUSINESS_SUITE = [CRITICAL_JOURNEYS, ...LOCAL_BUSINESS_JOURNEYS];

/** The named selections of the critical suite (E2E_ARMY_CRITICAL_SELECTION, set by scripts/run-tester-army.mjs). */
const NAMED_SELECTIONS = {
  full: [CRITICAL_JOURNEYS, "e2e/army/extended/**/*.e2e.ts", TAKEOFF_JOURNEYS, ...LOCAL_BUSINESS_JOURNEYS],
  development: [LOGIN_SETUP, "e2e/army/development/**/*.e2e.ts"],
  polish: [LOGIN_SETUP, "e2e/army/polish/**/*.e2e.ts"],
};
export const FULL_SELECTION = NAMED_SELECTIONS.full;

/**
 * The tests of a critical run. A selection name this module does not know is refused: the default list would
 * otherwise run under the name the launcher records.
 * @param {string | undefined} selection E2E_ARMY_CRITICAL_SELECTION; unset or empty, the critical suite.
 * @param {boolean} localBusiness The backend is an owned loopback stack.
 * @returns {readonly string[]}
 */
export function criticalSelection(selection, localBusiness) {
  if (!selection) return localBusiness ? LOCAL_BUSINESS_SUITE : CRITICAL_SUITE;
  if (!Object.hasOwn(NAMED_SELECTIONS, selection)) {
    throw new Error(`Unknown E2E_ARMY_CRITICAL_SELECTION "${selection}": expected ${Object.keys(NAMED_SELECTIONS).join(", ").replace(/, (?=[^,]+$)/u, " or ")}.`);
  }
  return NAMED_SELECTIONS[selection];
}

export const PERFORMANCE_SELECTION = [LOGIN_SETUP, "e2e/army/performance/**/*.e2e.ts"];
/** The anonymous pilot and the agent suite: the journeys at the root of e2e/army. */
export const ANONYMOUS_SELECTION = ["e2e/army/*.e2e.ts"];

/**
 * The journey of each coverage scenario set (E2E_COVERAGE_SCENARIO_SET, scripts/tester-army/coverage-profile.mjs);
 * generated-components runs one of three files, by E2E_GENERATED_COMPONENTS_SELECTION. The calc-v3 coverage phases
 * run the same journeys.
 */
export const COVERAGE_JOURNEYS = {
  "source-coverage": "e2e/army/local/source-coverage.e2e.ts",
  "create-atomic": "e2e/army/local/estimate-create-atomic.e2e.ts",
  "batch-atomic": "e2e/army/local/estimate-batch*.e2e.ts",
  "generated-atomic": "e2e/army/local/estimate-generated-atomic.e2e.ts",
  "generated-recovery": "e2e/army/local/estimate-generated-recovery.e2e.ts",
  "navigation-lease": "e2e/army/local/editor-navigation-lease.e2e.ts",
  "generated-components": "e2e/army/local/generated-ouvrage-components.e2e.ts",
};
export const ASSEMBLY_TOTALS_JOURNEY = "e2e/army/local/assembly-totals.e2e.ts";
const NUMERIC_ENTRY_JOURNEY = "e2e/army/local/generated-ouvrage-numeric-entry.e2e.ts";
const NUMERIC_COMPONENT_SELECTIONS = ["numeric-price", "numeric-decimals", "numeric-loss", "numeric-all"];

/**
 * The tests of a coverage run: the login setup and the journey of its scenario set; any other set, source coverage.
 * @param {string | undefined} scenarioSet E2E_COVERAGE_SCENARIO_SET
 * @param {string | undefined} componentSelection E2E_GENERATED_COMPONENTS_SELECTION
 * @returns {readonly string[]}
 */
export function coverageSelection(scenarioSet, componentSelection) {
  if (scenarioSet === "generated-components") {
    if (componentSelection === "assembly-totals") return [LOGIN_SETUP, ASSEMBLY_TOTALS_JOURNEY];
    if (NUMERIC_COMPONENT_SELECTIONS.includes(componentSelection ?? "")) return [LOGIN_SETUP, NUMERIC_ENTRY_JOURNEY];
  }
  const journey = scenarioSet !== undefined && Object.hasOwn(COVERAGE_JOURNEYS, scenarioSet)
    ? COVERAGE_JOURNEYS[scenarioSet]
    : COVERAGE_JOURNEYS["source-coverage"];
  return [LOGIN_SETUP, journey];
}

/** The login of the offer profiles and of the calc-v3 phases that send offers or orders. */
export const OFFER_LOGIN_SETUP = "e2e/army/local/offer-emission-auth.setup.e2e.ts";
export const OFFER_EMISSION_JOURNEY = "e2e/army/local/offer-emission.e2e.ts";
export const RESEND_PORTAL_JOURNEY = "e2e/army/local/resend-portal.e2e.ts";
/** The offer emission profile (e2e.offer.config.ts) and the resend portal profile; calc-v3 runs them as phases too. */
export const OFFER_EMISSION_SELECTION = [OFFER_LOGIN_SETUP, OFFER_EMISSION_JOURNEY];
export const RESEND_PORTAL_SELECTION = [OFFER_LOGIN_SETUP, RESEND_PORTAL_JOURNEY];

/** Every glob a selection of this module runs, whatever its environment. */
export const SELECTION_GLOBS = [...new Set([
  ...CRITICAL_SUITE, ...LOCAL_BUSINESS_SUITE, ...Object.values(NAMED_SELECTIONS).flat(), ...PERFORMANCE_SELECTION,
  ...ANONYMOUS_SELECTION, LOGIN_SETUP, ...Object.values(COVERAGE_JOURNEYS), ASSEMBLY_TOTALS_JOURNEY, NUMERIC_ENTRY_JOURNEY,
  ...OFFER_EMISSION_SELECTION, ...RESEND_PORTAL_SELECTION,
])];
