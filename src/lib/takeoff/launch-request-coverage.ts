/**
 * The coverage of a launch request (lot 3): one execution of an affaire's analysis on a sealed manifest, each unit of
 * which is analysed by its own job (one per plan in format 2, one grouped unit holding every plan in format 1). The
 * database decides the state of every unit in one place (private.takeoff_unit_state, migration
 * 20261121181031_takeoff_plan_dispatcher.sql): the reading contract of the affaire's activity
 * (`readTakeoffLaunchRequestUnits` in launch-request-units-server.ts) returns those states; this module only counts and
 * words them, for the server and the screens alike. It never infers a success from the presence of a result row.
 */

/**
 * Each unit is in exactly one state. queued: waiting for its turn on the Mac of the mandate, or for a technical retry
 * that is due later; running: read now under a lease; succeeded: a reading that can be reviewed (also once sent to the
 * estimate); failed: a reading that started and ended without a result; canceled: stopped by a member; not_started:
 * closed before any reading (its Mac never took it, or the request's budget was spent before its turn).
 */
export const TAKEOFF_UNIT_STATES = ["queued", "running", "succeeded", "failed", "canceled", "not_started"] as const;
export type TakeoffUnitState = (typeof TAKEOFF_UNIT_STATES)[number];

export type TakeoffRequestCoverage = { expected: number } & Record<TakeoffUnitState, number>;

export function isTakeoffUnitState(value: unknown): value is TakeoffUnitState {
  return typeof value === "string" && (TAKEOFF_UNIT_STATES as readonly string[]).includes(value);
}

/** A unit's state is final: its job recorded the end of its analysis. */
export function isFinalTakeoffUnitState(state: TakeoffUnitState) {
  return state !== "queued" && state !== "running";
}

/** One unit of a request, as the affaire's readers may see it: never the Mac, the account, the lease or the provider's text. */
export type TakeoffRequestUnitView = {
  key: string;
  /** Its place in the recorded order, from 1: the Mac reads the units in this order. */
  ordinal: number;
  /** The plan copy read and its logical identity (its dossier piece), and the name the dossier shows. */
  planFileId: string | null;
  logicalId: string | null;
  name: string;
  /** The original pages read, 1-based; empty for the whole plan. */
  pages: number[];
  jobId: string;
  state: TakeoffUnitState;
  /** The public code of a failure or a stop (TAKEOFF_PUBLIC_FAILURE_CODES); null otherwise or for a code without one. */
  reasonCode: string | null;
  /** When a queued unit's technical retry is due; null when it only waits for its turn. */
  retryAt: string | null;
  updatedAt: string;
  /** Its reading can be opened (« Revoir [plan] »), even while the other plans are still read. */
  reviewable: boolean;
};

/** What a request consumed: tokens observed after each answer, and calls whose consumption is unknown (sent, never answered). */
export type TakeoffRequestUsage = { tokensObserved: number; costCentsObserved: number; unknownCalls: number };

/** The reading contract of a request's units, for the affaire's activity (lot 3 PR 4). */
export type TakeoffLaunchRequestUnits = {
  requestId: string;
  /** grouped: lot 2's one unit holding every plan (shown as one grouped analysis); per_plan: one unit per plan. */
  format: "grouped" | "per_plan";
  units: TakeoffRequestUnitView[];
  coverage: TakeoffRequestCoverage;
  usage: TakeoffRequestUsage;
};

export function summarizeTakeoffCoverage(units: ReadonlyArray<{ state: TakeoffUnitState }>): TakeoffRequestCoverage {
  const coverage: TakeoffRequestCoverage = { expected: units.length, queued: 0, running: 0, succeeded: 0, failed: 0, canceled: 0, not_started: 0 };
  for (const unit of units) coverage[unit.state] += 1;
  return coverage;
}

const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? "s" : ""}`;

/**
 * The coverage of a request of plans in one line, in French: « 1 plan lu sur 3 · 1 en lecture · 1 en attente ». Progress is
 * counted in plans read, never as a percentage of pages or of elapsed time.
 */
export function describeTakeoffCoverage(coverage: TakeoffRequestCoverage) {
  const parts = [`${plural(coverage.succeeded, "plan")} ${coverage.succeeded > 1 ? "lus" : "lu"} sur ${coverage.expected}`];
  if (coverage.running) parts.push(`${coverage.running} en lecture`);
  if (coverage.queued) parts.push(`${coverage.queued} en attente`);
  if (coverage.failed) parts.push(`${coverage.failed} en échec`);
  if (coverage.not_started) parts.push(`${coverage.not_started} non ${coverage.not_started > 1 ? "démarrés" : "démarré"}`);
  if (coverage.canceled) parts.push(`${coverage.canceled} ${coverage.canceled > 1 ? "arrêtés" : "arrêté"}`);
  return parts.join(" · ");
}

/** The end of a request of plans, as its one notice and e-mail tell it to its requester. */
export function describeTakeoffRequestEnd(input: {
  outcome: "success" | "failure" | "canceled" | "partial";
  expected: number; read: number; failed: number; notStarted: number; canceled: number;
  /** A member stopped the rest of the request: its cancelled plans were stopped at their request. */
  stopped: boolean;
}) {
  if (input.outcome === "success") {
    return input.expected > 1 ? `Les ${input.expected} plans de votre analyse ont été lus.` : "Le plan de votre analyse a été lu.";
  }
  if (input.outcome === "canceled") return "Votre analyse a été arrêtée avant la lecture de ses plans.";
  if (input.stopped && input.canceled > 0 && input.read > 0) {
    // Only the cancelled plans were stopped at the member's request: one that failed or never started before is told apart.
    const parts = [`${plural(input.read, "plan")} ${input.read > 1 ? "disponibles" : "disponible"}`,
      `${input.canceled} ${input.canceled > 1 ? "arrêtés" : "arrêté"} à votre demande`];
    if (input.failed) parts.push(`${input.failed} en échec`);
    if (input.notStarted) parts.push(`${input.notStarted} non ${input.notStarted > 1 ? "démarrés" : "démarré"}`);
    return `${parts.join(", ")}.`;
  }
  if (input.outcome === "partial") return `${plural(input.read, "plan")} ${input.read > 1 ? "lus" : "lu"} sur ${input.expected}.`;
  return input.expected > 1 ? `Aucun des ${input.expected} plans n’a pu être lu.` : "Le plan n’a pas pu être lu.";
}
