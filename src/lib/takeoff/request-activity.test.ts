import { describe, expect, it } from "vitest";

import type { TakeoffLaunchRequestUnits, TakeoffRequestUnitView } from "@/lib/takeoff/launch-request-coverage";
import type { TakeoffResumeViewer } from "@/lib/takeoff/operator-state";
import {
  buildTakeoffRequestActivity,
  deriveTakeoffRequestUnits,
  describeTakeoffRequestActivityCoverage,
  describeTakeoffRequestPages,
  describeTakeoffRequestUnitState,
  parseTakeoffRequestManifest,
  reviewableTakeoffRequestUnits,
  takeoffRequestRefreshInterval,
  TAKEOFF_REQUEST_LIVE_REFRESH_MS,
  TAKEOFF_REQUEST_WAITING_REFRESH_MS,
  type TakeoffRequestJobRow,
  type TakeoffRequestRow,
  type TakeoffRequestUnitJobRow,
} from "@/lib/takeoff/request-activity";
import {
  takeoffRequestActivityResponseSchema,
  type TakeoffRequestActivity,
  type TakeoffRequestActivityResponse,
} from "@/lib/takeoff/request-activity-contracts";

const NOW = new Date("2026-11-21T10:00:00.000Z");
const LAUNCHER = "11111111-1111-4111-8111-111111111111";
const READER = "22222222-2222-4222-8222-222222222222";
const THIS_MAC = "urn:uuid:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REQUEST = "30000000-0000-4000-8000-000000000001";
const PLAN_SET = "40000000-0000-4000-8000-000000000001";
const PLAN_A = "50000000-0000-4000-8000-00000000000a";
const PLAN_B = "50000000-0000-4000-8000-00000000000b";
const PLAN_C = "50000000-0000-4000-8000-00000000000c";
const JOB = (letter: string) => `60000000-0000-4000-8000-00000000000${letter}`;

const operator: TakeoffResumeViewer = { userId: LAUNCHER, tenantRole: "engineer", canWriteAffaire: true, executionHostId: THIS_MAC, planStatus: "ready" };
const reader: TakeoffResumeViewer = { userId: READER, tenantRole: "director", canWriteAffaire: false, executionHostId: THIS_MAC, planStatus: "ready" };

const entry = (id: string, name: string, pages: number[]) => ({
  entry_key: id, name, logical_id: id, intake_document_id: null, plan_file_id: id, generation: null,
  content_sha256: id.slice(-1).repeat(64), pages, page_count: 9,
});
const plans = [entry(PLAN_A, "A — Rez-de-chaussée.pdf", [2, 7]), entry(PLAN_B, "B — Étage 1.pdf", []), entry(PLAN_C, "C — Sous-sol.pdf", [1])];
const base = {
  intent: "initial", order: { kind: "free_extraction", version: 1, list: null }, references: [],
  coverage: { plans_retained: 3, plans_omitted: [{ id: "d", name: "D — ancien indice.pdf", reason: "alternate" }], references_omitted: [] },
  preparation: { revision: 1, rule_version: 1 }, budget: { tokens: 400_000, cost_cents: 2_500 },
};
/** Lot 2's format 1: one grouped unit holding the retained plans. */
const groupedManifest = { ...base, format_version: 1, units: [{ key: "grouped", plans: [PLAN_A, PLAN_B, PLAN_C] }], plans };
/** Format 2, shaped as buildTakeoffPlanLaunchManifest seals it: one unit per plan, in the recorded order (C first here). */
const perPlanManifest = {
  ...base, format_version: 2, dispatch: { order: "display_name", version: 1 },
  plans: [plans[2], plans[0], plans[1]],
  units: [
    { key: `plan:${PLAN_C}`, ordinal: 1, plans: [PLAN_C], pages: [1], page_count: 9, budget: { tokens: 1, cost_cents: 1 } },
    { key: `plan:${PLAN_A}`, ordinal: 2, plans: [PLAN_A], pages: [7, 2], page_count: 9, budget: { tokens: 1, cost_cents: 1 } },
    { key: `plan:${PLAN_B}`, ordinal: 3, plans: [PLAN_B], pages: [], page_count: 9, budget: { tokens: 1, cost_cents: 1 } },
  ],
};

function request(overrides: Partial<TakeoffRequestRow> = {}): TakeoffRequestRow {
  return {
    id: REQUEST, origin: "automatic", intent: "initial", state: "admitted", reason_code: null, reason_details: {}, outcome: null,
    mandate_revision: 1, units_expected: 3, created_at: "2026-11-21T09:00:00.000Z", admitted_at: "2026-11-21T09:00:05.000Z",
    closed_at: null, ...overrides,
  };
}

function unitJob(letter: string, unitKey: string, overrides: Partial<TakeoffRequestUnitJobRow> = {}): TakeoffRequestUnitJobRow {
  return {
    id: JOB(letter), launch_request_id: REQUEST, launch_unit_key: unitKey, status: "pending", started_at: null,
    next_retry_at: null, analysis_outcome: null, error_code: null, updated_at: "2026-11-21T09:00:05.000Z", ...overrides,
  };
}

function memberJob(letter: string, overrides: Partial<TakeoffRequestJobRow> = {}): TakeoffRequestJobRow {
  return {
    id: JOB(letter), launch_request_id: REQUEST, plan_set_id: PLAN_SET, estimate_version_id: null, status: "pending",
    processing_strategy: "sync", execution_provider: "chatgpt_local", execution_host_id: THIS_MAC, analysis_outcome: null,
    next_retry_at: null, retry_count: 0, error_code: null, created_by: LAUNCHER, completed_at: null, item_count: 0, ...overrides,
  };
}

/** A unit as the dispatcher's reading contract returns it. */
function unit(letter: string, ordinal: number, overrides: Partial<TakeoffRequestUnitView> = {}): TakeoffRequestUnitView {
  return {
    key: `plan:${JOB(letter)}`, ordinal, planFileId: null, logicalId: null, name: `Plan ${letter.toUpperCase()}.pdf`, pages: [],
    jobId: JOB(letter), state: "queued", reasonCode: null, retryAt: null, updatedAt: "2026-11-21T09:00:05.000Z", reviewable: false,
    ...overrides,
  };
}

function units(list: TakeoffRequestUnitView[], format: "grouped" | "per_plan" = "per_plan"): TakeoffLaunchRequestUnits {
  const coverage = { expected: list.length, queued: 0, running: 0, succeeded: 0, failed: 0, canceled: 0, not_started: 0 };
  for (const entry of list) coverage[entry.state] += 1;
  return { requestId: REQUEST, format, units: list, coverage, usage: { tokensObserved: 0, costCentsObserved: 0, unknownCalls: 0 } };
}

const success = { state: "succeeded" as const, reviewable: true, updatedAt: "2026-11-21T09:05:00.000Z" };

function activity(list: TakeoffRequestUnitView[], jobs: TakeoffRequestJobRow[], viewer = operator, overrides: Partial<TakeoffRequestRow> = {}) {
  return buildTakeoffRequestActivity({ request: request(overrides), units: units(list), manifest: null, jobs, viewer, now: NOW });
}

function response(current: TakeoffRequestActivity | null, extra: Partial<TakeoffRequestActivityResponse> = {}): TakeoffRequestActivityResponse {
  return {
    view: "current", observedAt: NOW.toISOString(), live: true, signature: "s", current, history: [], historyHasOlder: false,
    historyOffset: 0, standalone: { running: 0, waiting: 0 }, ...extra,
  };
}

describe("deriveTakeoffRequestUnits: the dispatcher's shape from a sealed manifest", () => {
  it("lists one unit per plan in the recorded order, with its original pages, A read while B is read and C waits", () => {
    const derived = deriveTakeoffRequestUnits({ requestId: REQUEST, manifest: parseTakeoffRequestManifest(perPlanManifest), jobs: [
      unitJob("a", `plan:${PLAN_A}`, { status: "completed", started_at: "2026-11-21T09:01:00.000Z", analysis_outcome: "success" }),
      unitJob("b", `plan:${PLAN_B}`, { status: "processing", started_at: "2026-11-21T09:05:01.000Z" }),
      unitJob("c", `plan:${PLAN_C}`),
    ] })!;
    expect(derived.format).toBe("per_plan");
    expect(derived.units.map((entry) => [entry.ordinal, entry.name, entry.pages, entry.state, entry.reviewable])).toEqual([
      [1, "C — Sous-sol.pdf", [1], "queued", false],
      [2, "A — Rez-de-chaussée.pdf", [2, 7], "succeeded", true],
      [3, "B — Étage 1.pdf", [], "running", false],
    ]);
    expect(derived.units[1]).toMatchObject({ planFileId: PLAN_A, logicalId: PLAN_A, jobId: JOB("a") });
    expect(derived.coverage).toEqual({ expected: 3, queued: 1, running: 1, succeeded: 1, failed: 0, canceled: 0, not_started: 0 });
  });

  it("puts each unit in exactly one state from its job, never from its result rows", () => {
    const derived = deriveTakeoffRequestUnits({ requestId: REQUEST, manifest: parseTakeoffRequestManifest(perPlanManifest), jobs: [
      unitJob("a", `plan:${PLAN_A}`, { status: "failed", analysis_outcome: "failure", error_code: "TAKEOFF_PDF_CORRUPTED" }),
      unitJob("b", `plan:${PLAN_B}`, { status: "canceled", started_at: "2026-11-21T09:05:01.000Z", analysis_outcome: "canceled" }),
      unitJob("c", `plan:${PLAN_C}`, { status: "canceled", analysis_outcome: "canceled", error_code: "PRIVATE_DETAIL" }),
    ] })!;
    expect(derived.units.map((entry) => [entry.state, entry.reasonCode])).toEqual([
      ["not_started", null], ["failed", "TAKEOFF_PDF_CORRUPTED"], ["canceled", null],
    ]);
    expect(describeTakeoffRequestActivityCoverage({ units: { ...derived, unknownCalls: null }, groupedPlans: [] }))
      .toBe("0 plan lu sur 3 · 1 en échec · 1 non démarré · 1 arrêté");
  });

  it("keeps a technical retry due later in the queue, with its due time", () => {
    const derived = deriveTakeoffRequestUnits({ requestId: REQUEST, manifest: parseTakeoffRequestManifest(perPlanManifest), jobs: [
      unitJob("a", `plan:${PLAN_A}`, { status: "failed", next_retry_at: "2026-11-21T10:00:30.000Z", error_code: "AI_RATE_LIMIT" }),
    ] })!;
    expect(derived.units).toEqual([expect.objectContaining({ state: "queued", retryAt: "2026-11-21T10:00:30.000Z", reasonCode: null })]);
    expect(describeTakeoffRequestUnitState(derived.units[0], null)).toBe("Nouvelle tentative programmée");
  });

  it("keeps lot 2's grouped analysis one analysis of three plans, never three analyses or three successes", () => {
    const manifest = parseTakeoffRequestManifest(groupedManifest);
    const derived = deriveTakeoffRequestUnits({ requestId: REQUEST, manifest, jobs: [
      unitJob("d", "grouped", { status: "completed", started_at: "2026-11-21T09:01:00.000Z", analysis_outcome: "success" }),
    ] })!;
    expect(derived.format).toBe("grouped");
    expect(derived.units).toHaveLength(1);
    expect(derived.units[0]).toMatchObject({ key: "grouped", name: "Analyse groupée de 3 plans", planFileId: null, state: "succeeded" });
    expect(derived.coverage).toMatchObject({ expected: 1, succeeded: 1 });
    const view = buildTakeoffRequestActivity({ request: request({ units_expected: 1 }), units: derived, manifest,
      jobs: [memberJob("d", { status: "completed", item_count: 5 })], viewer: reader, now: NOW });
    expect(view.groupedPlans.map((plan) => [plan.name, plan.pages])).toEqual([
      ["A — Rez-de-chaussée.pdf", [2, 7]], ["B — Étage 1.pdf", []], ["C — Sous-sol.pdf", [1]],
    ]);
    expect(describeTakeoffRequestActivityCoverage(view)).toBe("Analyse groupée de 3 plans · lue");
    expect(view.plansOmitted).toEqual([{ name: "D — ancien indice.pdf", reason: "alternate" }]);
  });

  it("reads nothing from a manifest it cannot read", () => {
    expect(parseTakeoffRequestManifest({ format_version: 9, plans })).toBeNull();
    expect(parseTakeoffRequestManifest({ units: [{ key: 1 }] })).toBeNull();
    expect(deriveTakeoffRequestUnits({ requestId: REQUEST, manifest: null, jobs: [unitJob("a", "x")] })).toBeNull();
  });
});

describe("buildTakeoffRequestActivity: what each member sees and may do", () => {
  const list = [
    unit("a", 1, { ...success, name: "A — Rez-de-chaussée.pdf" }),
    unit("b", 2, { state: "running" }),
    unit("c", 3, { state: "failed", reasonCode: "AI_PROVIDER", updatedAt: "2026-11-21T09:06:00.000Z" }),
  ];
  const jobs = [
    memberJob("a", { status: "completed", analysis_outcome: "success", item_count: 3 }),
    memberJob("b", { status: "processing" }),
    memberJob("c", { status: "failed", analysis_outcome: "failure", completed_at: "2026-11-21T09:06:00.000Z", error_code: "AI_PROVIDER" }),
  ];

  it("offers an operator « Revoir A » while B is read, a new analysis of C and the stop of B", () => {
    const view = activity(list, jobs);
    expect(describeTakeoffRequestActivityCoverage(view)).toBe("1 plan lu sur 3 · 1 en lecture · 1 en échec");
    expect(reviewableTakeoffRequestUnits(view).map((entry) => entry.jobId)).toEqual([JOB("a")]);
    const byJob = new Map(view.jobs.map((job) => [job.jobId, job]));
    expect(byJob.get(JOB("a"))).toMatchObject({ itemCount: 3, resume: null, canCancel: false });
    expect(byJob.get(JOB("b"))).toMatchObject({ resume: null, canCancel: true, canResubmit: false });
    expect(byJob.get(JOB("c"))).toMatchObject({ resume: { action: "new_analysis", reason: "analysis_closed" }, canResubmit: false });
    expect(describeTakeoffRequestUnitState(view.units!.units[0], byJob.get(JOB("a"))!)).toBe("Prêt à revoir");
  });

  it("lets a reader open the review and tells them why they cannot act", () => {
    const view = activity(list, jobs, reader);
    expect(reviewableTakeoffRequestUnits(view).map((entry) => entry.jobId)).toEqual([JOB("a")]);
    const byJob = new Map(view.jobs.map((job) => [job.jobId, job]));
    expect(byJob.get(JOB("b"))).toMatchObject({ canCancel: false, canResubmit: false });
    expect(byJob.get(JOB("c"))).toMatchObject({ resume: { action: "none", reason: "analysis_closed" } });
  });

  it("offers no review of a read plan whose analysis the member does not read", () => {
    const view = activity(list, jobs.filter((job) => job.id !== JOB("a")), reader);
    expect(view.units!.units[0].reviewable).toBe(true);
    expect(reviewableTakeoffRequestUnits(view)).toEqual([]);
    expect(describeTakeoffRequestUnitState(view.units!.units[0], null)).toBe("Lu");
  });

  it("says a sent plan was sent and a plan without retained line has none, both still read", () => {
    const view = activity([unit("a", 1, success), unit("b", 2, success)], [
      memberJob("a", { status: "applied", estimate_version_id: "70000000-0000-4000-8000-000000000001", item_count: 3 }),
      memberJob("b", { status: "completed", item_count: 0 }),
    ], operator, { state: "closed", outcome: "success", closed_at: "2026-11-21T09:10:00.000Z" });
    const [a, b] = view.jobs;
    expect([describeTakeoffRequestUnitState(view.units!.units[0], a), describeTakeoffRequestUnitState(view.units!.units[1], b)])
      .toEqual(["Reporté au devis", "Lu, aucune ligne retenue"]);
    expect(reviewableTakeoffRequestUnits(view)).toHaveLength(2);
    expect(describeTakeoffRequestActivityCoverage(view)).toBe("2 plans lus sur 2");
  });

  it("never exposes the Mac, the profile or the provider of an analysis", () => {
    expect(JSON.stringify(activity(list, jobs))).not.toContain(THIS_MAC);
    expect(Object.keys(activity(list, jobs).jobs[0])).not.toContain("executionHostId");
  });

  it("shows a blocked request's reason with the pieces it names, and no unit", () => {
    const view = buildTakeoffRequestActivity({
      request: request({ state: "blocked", admitted_at: null, units_expected: null, reason_code: "PLAN_COPY_MISSING",
        reason_details: { pieces: [{ id: PLAN_B, name: "B — Étage 1.pdf" }] } }),
      units: null, manifest: null, jobs: [], viewer: reader, now: NOW,
    });
    expect(view).toMatchObject({ units: null, groupedPlans: [], jobs: [] });
    expect(view.reason?.message).toContain("« B — Étage 1.pdf »");
    expect(describeTakeoffRequestActivityCoverage(view)).toBeNull();
  });

  it("names the relaunch that set an automatic start aside", () => {
    const view = buildTakeoffRequestActivity({ request: request({ state: "superseded", admitted_at: null }), units: null,
      manifest: null, jobs: [], viewer: reader, now: NOW });
    expect(view.reason?.code).toBe("SUPERSEDED");
  });
});

describe("takeoffRequestRefreshInterval: one conditional poll per page", () => {
  const blocked = (reason: string, state = "blocked") => buildTakeoffRequestActivity({
    request: request({ state, admitted_at: null, reason_code: reason }), units: null, manifest: null, jobs: [], viewer: reader, now: NOW,
  });
  const ended = [unit("a", 1, success), unit("b", 2, success)];

  it.each<[string, TakeoffRequestActivityResponse | undefined, boolean, number]>([
    ["no answer yet", undefined, false, 0],
    ["a plan is read", response(activity([unit("a", 1, { state: "running" })], [])), false, TAKEOFF_REQUEST_LIVE_REFRESH_MS],
    ["a plan waits behind one that just ended", response(activity([
      unit("a", 1, { ...success, updatedAt: "2026-11-21T09:59:40.000Z" }), unit("b", 2)], [])), false, TAKEOFF_REQUEST_LIVE_REFRESH_MS],
    ["plans wait for a Mac that has not moved for minutes", response(activity([unit("a", 1, success), unit("b", 2)], [])), false,
      TAKEOFF_REQUEST_WAITING_REFRESH_MS],
    ["the only waiting plan waits for a technical retry", response(activity([
      unit("a", 1, { ...success, updatedAt: "2026-11-21T09:59:40.000Z" }), unit("b", 2, { retryAt: "2026-11-21T10:00:30.000Z" })], [])),
    false, TAKEOFF_REQUEST_WAITING_REFRESH_MS],
    ["every plan ended, the request is not closed yet", response(activity(ended, [])), false, TAKEOFF_REQUEST_WAITING_REFRESH_MS],
    ["the request is closed", response(activity(ended, [], operator, { state: "closed", outcome: "success", closed_at: "2026-11-21T09:10:00.000Z" })),
      false, 0],
    ["the request is evaluated by its Mac", response(blocked("", "evaluating")), false, TAKEOFF_REQUEST_WAITING_REFRESH_MS],
    ["a passing cause holds the request", response(blocked("ANOTHER_ANALYSIS_RUNNING")), false, TAKEOFF_REQUEST_WAITING_REFRESH_MS],
    ["only a gesture can start the request", response(blocked("MANDATE_REQUIRED")), false, 0],
    ["the dossier is not confirmed", response(blocked("BRIEF_NOT_CONFIRMED", "not_eligible")), false, 0],
    ["the last read failed while a plan is read", response(activity([unit("a", 1, { state: "running" })], [])), true,
      TAKEOFF_REQUEST_WAITING_REFRESH_MS],
    ["an analysis without a request runs", response(null, { standalone: { running: 1, waiting: 0 } }), false, TAKEOFF_REQUEST_LIVE_REFRESH_MS],
    ["an analysis without a request waits for its retry", response(null, { standalone: { running: 0, waiting: 1 } }), false,
      TAKEOFF_REQUEST_WAITING_REFRESH_MS],
    ["nothing can change", response(null), false, 0],
  ])("%s", (_label, data, failedRead, expected) => {
    expect(takeoffRequestRefreshInterval(data, failedRead)).toBe(expected);
  });
});

describe("request activity contract", () => {
  it("accepts the projection of both formats and the dispatcher's units", () => {
    const manifest = parseTakeoffRequestManifest(groupedManifest);
    const grouped = buildTakeoffRequestActivity({
      request: request({ units_expected: 1 }), manifest, viewer: reader, now: NOW, jobs: [memberJob("d", { status: "completed" })],
      units: deriveTakeoffRequestUnits({ requestId: REQUEST, manifest, jobs: [unitJob("d", "grouped", { status: "completed" })] }),
    });
    const current = activity([unit("a", 1, success)], [memberJob("a", { status: "completed" })]);
    expect(takeoffRequestActivityResponseSchema.safeParse(response(current, { view: "history", history: [grouped] })).success).toBe(true);
  });

  it("words the pages of a plan", () => {
    expect([describeTakeoffRequestPages([]), describeTakeoffRequestPages([2]), describeTakeoffRequestPages([2, 7])])
      .toEqual(["toutes les pages", "page 2", "pages 2, 7"]);
  });
});
