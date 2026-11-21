import type { TakeoffRequestUnitView } from "@/lib/takeoff/launch-request-coverage";
import type {
  TakeoffRequestActivity,
  TakeoffRequestActivityJob,
  TakeoffRequestActivityResponse,
} from "@/lib/takeoff/request-activity-contracts";

// Fictional requests of one affaire, shaped as the activity's reader returns them (units in the dispatcher's shape).

export const FIXTURE_PROJECT = "20000000-0000-4000-8000-000000000001";
export const FIXTURE_REQUEST = "30000000-0000-4000-8000-000000000001";
export const FIXTURE_PLAN_SET = "40000000-0000-4000-8000-000000000001";
export const fixturePlanFile = (letter: string) => `50000000-0000-4000-8000-00000000000${letter}`;
export const fixtureJob = (letter: string) => `60000000-0000-4000-8000-00000000000${letter}`;

export function fixtureUnit(letter: string, ordinal: number, overrides: Partial<TakeoffRequestUnitView> = {}): TakeoffRequestUnitView {
  return {
    key: `plan:${fixturePlanFile(letter)}`, ordinal, planFileId: fixturePlanFile(letter), logicalId: fixturePlanFile(letter),
    name: `Plan ${letter.toUpperCase()} — niveau ${ordinal}.pdf`, pages: [], jobId: fixtureJob(letter), state: "queued",
    reasonCode: null, retryAt: null, updatedAt: "2026-11-21T09:00:05.000Z", reviewable: false, ...overrides,
  };
}

export function fixtureActivityJob(letter: string, overrides: Partial<TakeoffRequestActivityJob> = {}): TakeoffRequestActivityJob {
  return {
    jobId: fixtureJob(letter), planSetId: FIXTURE_PLAN_SET, estimateVersionId: null, itemCount: 0, applied: false, errorCode: null,
    retryCount: 0, resume: null, canCancel: false, canResubmit: false, ...overrides,
  };
}

export function fixtureRequest(units: TakeoffRequestUnitView[] | null, jobs: TakeoffRequestActivityJob[],
  overrides: Partial<TakeoffRequestActivity> = {}): TakeoffRequestActivity {
  const coverage = { expected: units?.length ?? 0, queued: 0, running: 0, succeeded: 0, failed: 0, canceled: 0, not_started: 0 };
  for (const unit of units ?? []) coverage[unit.state] += 1;
  return {
    id: FIXTURE_REQUEST, origin: "automatic", intent: "initial", state: units ? "admitted" : "blocked", outcome: null, reason: null,
    createdAt: "2026-11-21T09:00:00.000Z", admittedAt: units ? "2026-11-21T09:00:05.000Z" : null, closedAt: null,
    units: units ? { format: "per_plan", units, coverage, unknownCalls: null } : null,
    groupedPlans: [], plansOmitted: [], jobs, action: null, dossierChanged: null, ...overrides,
  };
}

export function fixtureActivityResponse(current: TakeoffRequestActivity | null,
  overrides: Partial<TakeoffRequestActivityResponse> = {}): TakeoffRequestActivityResponse {
  return {
    view: "current", observedAt: "2026-11-21T09:06:00.000Z", live: true, signature: "s", current, history: [],
    historyHasOlder: false, historyOffset: 0, standalone: { running: 0, waiting: 0 }, elsewhere: { waiting: false },
    ...overrides,
  };
}

/** A ready, B read, C waiting: the operator launched them; `reader` sees the same states without an action. */
export function fixtureThreePlans(input: { reader?: boolean; bDone?: boolean } = {}) {
  const units = [
    fixtureUnit("a", 1, { state: "succeeded", reviewable: true, pages: [2, 7], updatedAt: "2026-11-21T09:05:00.000Z" }),
    fixtureUnit("b", 2, input.bDone
      ? { state: "succeeded", reviewable: true, updatedAt: "2026-11-21T09:08:00.000Z" }
      : { state: "running", updatedAt: "2026-11-21T09:05:01.000Z" }),
    fixtureUnit("c", 3),
  ];
  const jobs = [
    fixtureActivityJob("a", { itemCount: 3 }),
    fixtureActivityJob("b", input.bDone ? { itemCount: 2 } : { canCancel: !input.reader }),
    fixtureActivityJob("c", { canCancel: !input.reader }),
  ];
  return fixtureRequest(units, jobs);
}
