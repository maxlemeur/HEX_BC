import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

const db = vi.hoisted(() => ({
  member: {} as Record<string, Row[]>,
  service: {} as Record<string, Row[]>,
  statements: [] as string[],
  rpc: vi.fn(),
  dossierChange: vi.fn(),
  viewer: { userId: "", tenantRole: "engineer", ownerId: "" },
  host: "urn:uuid:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as string | null,
}));

/** A query on rows the client may read, with the filters the reader uses. Each `from` is one statement. */
function client(scope: "member" | "service") {
  const query = (table: string) => {
    db.statements.push(`${scope}:${table}`);
    const filters: Array<(row: Row) => boolean> = [];
    const order: Array<[string, boolean]> = [];
    let window: [number, number] | null = null;
    let single = false;
    const run = () => {
      const rows = (db[scope][table] ?? []).filter((row) => filters.every((filter) => filter(row)))
        .sort((left, right) => {
          for (const [column, ascending] of order) {
            const comparison = String(left[column] ?? "").localeCompare(String(right[column] ?? ""));
            if (comparison) return ascending ? comparison : -comparison;
          }
          return 0;
        });
      const data = window ? rows.slice(window[0], window[1] + 1) : rows;
      return { data: single ? data[0] ?? null : data, error: null };
    };
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return builder; },
      neq: (column: string, value: unknown) => { filters.push((row) => row[column] !== value); return builder; },
      in: (column: string, values: unknown[]) => { filters.push((row) => values.includes(row[column])); return builder; },
      is: (column: string, value: unknown) => { filters.push((row) => (row[column] ?? null) === value); return builder; },
      // The one disjunction the reader writes: "status.neq.failed,next_retry_at.not.is.null".
      or: (expression: string) => {
        expect(expression).toBe("status.neq.failed,next_retry_at.not.is.null");
        filters.push((row) => row.status !== "failed" || row.next_retry_at != null);
        return builder;
      },
      order: (column: string, options?: { ascending?: boolean }) => { order.push([column, options?.ascending ?? true]); return builder; },
      limit: (count: number) => { window = [0, count - 1]; return builder; },
      range: (start: number, end: number) => { window = [start, end]; return builder; },
      maybeSingle: () => { single = true; return builder; },
      then: (resolve: (value: ReturnType<typeof run>) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    };
    return builder;
  };
  return {
    from: query,
    rpc: (name: string, args: unknown) => { db.statements.push(`${scope}:rpc:${name}`); return Promise.resolve(db.rpc(name, args)); },
  };
}

vi.mock("@/lib/affaires/access-server", () => ({
  requireAffaireAccess: vi.fn(async () => ({
    context: { supabase: client("member"), tenantId: TENANT, userId: db.viewer.userId, tenantRole: db.viewer.tenantRole },
    project: { id: PROJECT, user_id: db.viewer.ownerId, is_archived: false },
  })),
  canAccessAffaire: (member: { userId: string; tenantRole: string }, ownerId: string) =>
    member.tenantRole === "admin" || (member.tenantRole === "engineer" && member.userId === ownerId),
}));
vi.mock("@/lib/takeoff/feature-flags", () => ({ assertTakeoffEnabled: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => client("service") }));
vi.mock("@/lib/takeoff/launch-request-server", () => ({ readDossierChangeSinceAnalysis: db.dossierChange }));
vi.mock("@/lib/takeoff/resume-viewer-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/takeoff/resume-viewer-server")>()),
  readTakeoffExecution: vi.fn(async () => ({ hostId: db.host, planStatus: db.host ? "ready" : null })),
}));

import { readTakeoffRequestActivity } from "@/lib/takeoff/request-activity-server";
import { takeoffRequestActivityResponseSchema } from "@/lib/takeoff/request-activity-contracts";

const TENANT = "10000000-0000-4000-8000-000000000001";
const PROJECT = "20000000-0000-4000-8000-000000000001";
const OWNER = "11111111-1111-4111-8111-111111111111";
const DIRECTOR = "22222222-2222-4222-8222-222222222222";
const PLAN_SET = "40000000-0000-4000-8000-000000000001";
const HOST = "urn:uuid:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const id = (prefix: string, index: number) => `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`;
const REQUEST = id("30000000", 1);

type JobState = "pending" | "processing" | "completed" | "failed";

/** One admitted request of `count` plans in format 2, its jobs in `states` (the rest queued), and their rows by reader. */
function seed(input: { count: number; states?: JobState[]; requestState?: string; hiddenFromMember?: number[]; older?: number }) {
  const plans = Array.from({ length: input.count }, (_, index) => ({
    entry_key: id("50000000", index + 1), name: `Plan ${index + 1}.pdf`, plan_file_id: id("50000000", index + 1),
    logical_id: id("50000000", index + 1), pages: [index + 1],
  }));
  const manifest = {
    format_version: 2,
    units: plans.map((plan, index) => ({ key: `plan:${plan.entry_key}`, ordinal: index + 1, plans: [plan.entry_key], pages: plan.pages })),
    plans, coverage: { plans_retained: input.count, plans_omitted: [] },
  };
  const request = (index: number, createdAt: string, state: string): Row => ({
    id: id("30000000", index), tenant_id: TENANT, project_id: PROJECT, origin: index === 1 ? "automatic" : "manual",
    intent: "initial", state, reason_code: null, reason_details: {}, outcome: state === "closed" ? "success" : null,
    mandate_revision: 1, units_expected: input.count, created_at: createdAt, admitted_at: createdAt,
    closed_at: state === "closed" ? createdAt : null,
  });
  const requests = [request(1, "2026-11-21T09:00:00.000Z", input.requestState ?? "admitted"),
    ...Array.from({ length: input.older ?? 0 }, (_, index) => request(index + 2, `2026-11-1${index}T09:00:00.000Z`, "closed"))];
  const jobs = plans.map((plan, index) => {
    const status = input.states?.[index] ?? "pending";
    return {
      id: id("60000000", index + 1), tenant_id: TENANT, project_id: PROJECT, launch_request_id: REQUEST,
      launch_unit_key: `plan:${plan.entry_key}`, plan_set_id: PLAN_SET, estimate_version_id: null, status,
      started_at: status === "pending" ? null : "2026-11-21T09:01:00.000Z",
      completed_at: status === "completed" || status === "failed" ? "2026-11-21T09:02:00.000Z" : null,
      next_retry_at: null, analysis_outcome: status === "completed" ? "success" : status === "failed" ? "failure" : null,
      error_code: status === "failed" ? "TAKEOFF_PDF_CORRUPTED" : null, retry_count: 0, processing_strategy: "sync",
      execution_provider: "chatgpt_local", execution_host_id: HOST, created_by: OWNER, updated_at: "2026-11-21T09:02:00.000Z",
      items: [{ count: status === "completed" ? 2 : 0 }],
    };
  });
  const hidden = new Set(input.hiddenFromMember ?? []);
  db.service = {
    takeoff_launch_requests: requests.map((row) => ({ ...row, ...(row.id === REQUEST ? manifest : {}) })),
    takeoff_jobs: jobs,
  } satisfies Tables;
  db.member = {
    takeoff_launch_requests: requests,
    takeoff_jobs: jobs.filter((_, index) => !hidden.has(index)),
  } satisfies Tables;
}

beforeEach(() => {
  db.statements = [];
  db.rpc.mockReset().mockReturnValue({ data: "none", error: null });
  db.dossierChange.mockReset().mockResolvedValue(null);
  db.viewer = { userId: OWNER, tenantRole: "engineer", ownerId: OWNER };
  db.host = HOST;
});

describe("readTakeoffRequestActivity: one light projection", () => {
  it("shows plan 1 read while plan 2 is read and plan 3 waits, in the recorded order", async () => {
    seed({ count: 3, states: ["completed", "processing"] });
    const answer = await readTakeoffRequestActivity({ projectId: PROJECT });
    expect(takeoffRequestActivityResponseSchema.safeParse(answer).success).toBe(true);
    expect(answer.current?.units?.units.map((unit) => [unit.ordinal, unit.name, unit.state, unit.reviewable])).toEqual([
      [1, "Plan 1.pdf", "succeeded", true], [2, "Plan 2.pdf", "running", false], [3, "Plan 3.pdf", "queued", false],
    ]);
    expect(answer.current?.jobs.find((job) => job.jobId === id("60000000", 1))).toMatchObject({ itemCount: 2 });
    expect(answer.live).toBe(true);
    // While its plans are read, the dossier's changes are not read on every poll.
    expect(db.dossierChange).not.toHaveBeenCalled();
    expect(JSON.stringify(answer)).not.toContain(HOST);
  });

  it("makes as many reads for 20 plans and several failures as for one queued plan", async () => {
    seed({ count: 1 });
    await readTakeoffRequestActivity({ projectId: PROJECT });
    const one = [...db.statements].sort();
    db.statements = [];
    seed({ count: 20, states: ["failed", "failed", "failed", "completed", "processing"] });
    const many = await readTakeoffRequestActivity({ projectId: PROJECT });
    expect([...db.statements].sort()).toEqual(one);
    expect(one).toEqual([
      "member:takeoff_jobs", "member:takeoff_jobs", "member:takeoff_launch_requests",
      "service:takeoff_jobs", "service:takeoff_launch_requests",
    ]);
    expect(many.current?.units?.coverage).toMatchObject({ expected: 20, failed: 3, succeeded: 1, running: 1, queued: 15 });
  });

  it("reads the dossier's changes once the plans are no longer read, and stops being live once closed", async () => {
    seed({ count: 2, states: ["completed", "completed"], requestState: "closed" });
    db.dossierChange.mockResolvedValue({ added: [{ id: id("50000000", 9), name: "Plan ajouté.pdf" }], replaced: [], removed: [] });
    const answer = await readTakeoffRequestActivity({ projectId: PROJECT });
    expect(answer.current?.dossierChanged?.added).toEqual([{ id: id("50000000", 9), name: "Plan ajouté.pdf" }]);
    expect(answer.live).toBe(false);
  });

  it("gives a director the states and the review, never an action", async () => {
    seed({ count: 2, states: ["completed", "processing"] });
    db.viewer = { userId: DIRECTOR, tenantRole: "director", ownerId: OWNER };
    const answer = await readTakeoffRequestActivity({ projectId: PROJECT });
    expect(answer.current?.units?.units.map((unit) => unit.reviewable)).toEqual([true, false]);
    expect(answer.current?.jobs.every((job) => !job.canCancel && !job.canResubmit)).toBe(true);
    expect(answer.current?.jobs.find((job) => job.jobId === id("60000000", 2))?.canCancel).toBe(false);
  });

  it("keeps a unit whose analysis the member does not read, without a decision for it", async () => {
    seed({ count: 2, states: ["completed", "completed"], hiddenFromMember: [0] });
    const answer = await readTakeoffRequestActivity({ projectId: PROJECT });
    expect(answer.current?.units?.units.map((unit) => unit.state)).toEqual(["succeeded", "succeeded"]);
    expect(answer.current?.jobs.map((job) => job.jobId)).toEqual([id("60000000", 2)]);
  });

  it("pages the older requests apart from the current one, without the standalone or the dossier reads", async () => {
    seed({ count: 1, states: ["completed"], older: 7 });
    const answer = await readTakeoffRequestActivity({ projectId: PROJECT, view: "history", limit: 5 });
    expect(answer.current).toBeNull();
    expect(answer.history.map((request) => request.id)).not.toContain(REQUEST);
    expect([answer.history.length, answer.historyHasOlder]).toEqual([5, true]);
    const next = await readTakeoffRequestActivity({ projectId: PROJECT, view: "history", limit: 5, offset: 5 });
    expect([next.history.length, next.historyHasOlder]).toEqual([2, false]);
    expect(db.dossierChange).not.toHaveBeenCalled();
  });

  it("opens the request an e-mail names, and the request of an analysis for its review", async () => {
    seed({ count: 2, states: ["completed", "pending"], older: 1 });
    const named = await readTakeoffRequestActivity({ projectId: PROJECT, view: "request", requestId: id("30000000", 2) });
    expect(named.current?.id).toBe(id("30000000", 2));
    const ofJob = await readTakeoffRequestActivity({ projectId: PROJECT, view: "job", jobId: id("60000000", 2) });
    expect(ofJob.current?.id).toBe(REQUEST);
    expect(ofJob.current?.units?.units).toHaveLength(2);
  });

  it("answers no request for an analysis without one", async () => {
    seed({ count: 1 });
    db.member.takeoff_jobs.push({ id: id("60000000", 99), tenant_id: TENANT, project_id: PROJECT, launch_request_id: null, status: "processing" });
    const answer = await readTakeoffRequestActivity({ projectId: PROJECT, view: "job", jobId: id("60000000", 99) });
    expect(answer.current).toBeNull();
  });

  it("follows an analysis without a request while it runs, and asks the database for the gesture of a blocked request", async () => {
    seed({ count: 1 });
    db.member.takeoff_launch_requests = [{ ...db.member.takeoff_launch_requests[0], state: "blocked", admitted_at: null,
      reason_code: "MANDATE_REQUIRED" }];
    db.member.takeoff_jobs = [{ id: id("60000000", 98), tenant_id: TENANT, project_id: PROJECT, launch_request_id: null,
      status: "processing", execution_provider: "chatgpt_local", retry_count: 0 }];
    db.rpc.mockReturnValue({ data: "take_on", error: null });
    const answer = await readTakeoffRequestActivity({ projectId: PROJECT });
    expect(answer.standalone).toEqual({ running: 1, waiting: 0 });
    expect(answer.current?.action).toEqual({ kind: "take_on", label: "Prendre en charge avec mon forfait", mandateRevision: 1 });
    expect(db.rpc).toHaveBeenCalledWith("takeoff_launch_request_action", { p_request_id: REQUEST, p_actor: OWNER });
    // Away from the Mac, the same decision opens MergeOne there.
    db.host = null;
    expect((await readTakeoffRequestActivity({ projectId: PROJECT })).current?.action?.kind).toBe("open_mac");
  });

  it("changes its signature with a transition, never with a lease renewal", async () => {
    seed({ count: 2, states: ["processing"] });
    const first = await readTakeoffRequestActivity({ projectId: PROJECT });
    db.service.takeoff_jobs[0] = { ...db.service.takeoff_jobs[0], updated_at: "2026-11-21T09:59:59.000Z" };
    expect((await readTakeoffRequestActivity({ projectId: PROJECT })).signature).toBe(first.signature);
    db.service.takeoff_jobs[0] = { ...db.service.takeoff_jobs[0], status: "completed", analysis_outcome: "success" };
    expect((await readTakeoffRequestActivity({ projectId: PROJECT })).signature).not.toBe(first.signature);
  });
});
