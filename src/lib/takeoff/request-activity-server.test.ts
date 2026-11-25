import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
type Failure = { code: string; message: string };

// The database at its boundary only: the member's client (its own rules, here the rows it may read) and the server's.
// The access to the affaire, the membership, the module, the dossier's difference and the visibility of the plans run
// as they do on the server. Each executed query or call is one statement.
const db = vi.hoisted(() => ({
  member: {} as Record<string, Row[]>,
  service: {} as Record<string, Row[]>,
  statements: [] as string[],
  failures: {} as Record<string, Failure>,
  rpc: {} as Record<string, unknown>,
  /** Each call, with the arguments it was made with. */
  rpcCalls: [] as Array<[string, unknown]>,
  /** The Auth service's answer to the session lookup: a user, or this error. */
  authError: null as unknown,
  userId: "",
  host: "urn:uuid:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as string | null,
}));

function client(scope: "member" | "service") {
  const query = (table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    const order: Array<[string, boolean]> = [];
    let window: [number, number] | null = null;
    let single = false;
    let countRequested = false;
    let retainedLinesOnly = false;
    const run = () => {
      db.statements.push(`${scope}:${table}`);
      const failure = db.failures[`${scope}:${table}`];
      if (failure) return { data: null, count: null, error: failure };
      const rows = (db[scope][table] ?? []).filter((row) => filters.every((filter) => filter(row)))
        .map((row) => table === "takeoff_jobs" && "lines" in row
          ? { ...row, items: [{ count: (row.lines as Array<{ excluded: boolean }>).filter((line) => !retainedLinesOnly || !line.excluded).length }] }
          : row)
        .sort((left, right) => {
          for (const [column, ascending] of order) {
            const comparison = String(left[column] ?? "").localeCompare(String(right[column] ?? ""));
            if (comparison) return ascending ? comparison : -comparison;
          }
          return 0;
        });
      const data = window ? rows.slice(window[0], window[1] + 1) : rows;
      return { data: single ? data[0] ?? null : data, count: countRequested ? rows.length : null, error: null };
    };
    const builder = {
      select: (_columns?: string, options?: { count?: string }) => { countRequested = options?.count === "exact"; return builder; },
      eq: (column: string, value: unknown) => {
        if (column === "items.is_excluded") retainedLinesOnly = value === false;
        else filters.push((row) => column.includes(".") || row[column] === value);
        return builder;
      },
      neq: (column: string, value: unknown) => { filters.push((row) => row[column] !== value); return builder; },
      in: (column: string, values: unknown[]) => { filters.push((row) => values.includes(row[column])); return builder; },
      is: (column: string, value: unknown) => { filters.push((row) => (row[column] ?? null) === value); return builder; },
      or: (expression: string) => {
        if (expression === "reason_code.is.null,reason_code.neq.ANALYSIS_NOT_REQUESTED") {
          filters.push((row) => row.reason_code !== "ANALYSIS_NOT_REQUESTED");
          return builder;
        }
        expect(expression).toBe("status.neq.failed,next_retry_at.not.is.null");
        filters.push((row) => row.status !== "failed" || row.next_retry_at != null);
        return builder;
      },
      order: (column: string, options?: { ascending?: boolean }) => { order.push([column, options?.ascending ?? true]); return builder; },
      limit: (count: number) => { window = [0, count - 1]; return builder; },
      range: (start: number, end: number) => { window = [start, end]; return builder; },
      maybeSingle: () => { single = true; return builder; },
      single: () => { single = true; return builder; },
      then: (resolve: (value: ReturnType<typeof run>) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve().then(run).then(resolve, reject),
    };
    return builder;
  };
  return {
    from: query,
    rpc: (name: string, args?: unknown) => {
      db.statements.push(`${scope}:rpc:${name}`);
      db.rpcCalls.push([`${scope}:rpc:${name}`, args]);
      const failure = db.failures[`${scope}:rpc:${name}`];
      return Promise.resolve(failure ? { data: null, error: failure } : { data: db.rpc[name] ?? null, error: null });
    },
    auth: { getUser: async () => db.authError
      ? { data: { user: null }, error: db.authError }
      : { data: { user: { id: db.userId } }, error: null } },
  };
}

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client("member") }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => client("service") }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ host: "127.0.0.1:3000" })) }));
vi.mock("@/lib/ai/chatgpt-local-auth", () => ({
  isLocalChatGptEnabled: () => true, assertLocalChatGptHost: () => undefined, hasLocalChatGptPlanAccess: () => true,
}));
vi.mock("@/lib/ai/chatgpt-local-store", () => ({
  readChatGptHostId: async () => db.host,
  getChatGptHostId: async () => { throw new Error("A read never creates the Mac's identifier."); },
  readChatGptStore: async () => ({ selectedId: "p", profiles: [{ id: "p", accessToken: "fixture", model: "fixture-model" }] }),
}));

import { AuthRetryableFetchError, AuthSessionMissingError } from "@supabase/supabase-js";

import { GET } from "@/app/api/takeoff/activity-center/requests/route";
import { normalizeFeatureFlagKey } from "@/lib/feature-flag-keys";
import { TAKEOFF_MODULE_ENABLED_FLAG_KEY } from "@/lib/takeoff/constants";
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
const OLDER = id("30000000", 2);

type JobState = "pending" | "processing" | "completed" | "failed";

/** One admitted request of `count` plans in format 2, its jobs in `states` (the rest queued), as each client reads them. */
function seed(input: { count: number; states?: JobState[]; requestState?: string; hiddenJobs?: number[]; older?: number;
  role?: "engineer" | "director"; lines?: Array<{ excluded: boolean }>; itemList?: boolean }) {
  const plans = Array.from({ length: input.count }, (_, index) => ({
    entry_key: id("50000000", index + 1), name: `Plan ${String.fromCharCode(65 + index)}.pdf`, plan_file_id: id("50000000", index + 1),
    logical_id: id("50000000", index + 1), intake_document_id: null, pages: [index + 1],
  }));
  const manifest = {
    format_version: 2,
    units: plans.map((plan, index) => ({ key: `plan:${plan.entry_key}`, ordinal: index + 1, plans: [plan.entry_key], pages: plan.pages })),
    plans, coverage: { plans_retained: input.count, plans_omitted: [] },
    // The sealed order's kind, as the server selects it (`order_kind:manifest->order->>kind`).
    ...(input.itemList ? { order_kind: "item_list" } : {}),
  };
  const request = (requestId: string, createdAt: string, state: string): Row => ({
    id: requestId, tenant_id: TENANT, project_id: PROJECT, origin: requestId === REQUEST ? "automatic" : "manual",
    intent: "initial", state, reason_code: null, reason_details: {}, outcome: state === "closed" ? "success" : null,
    mandate_revision: 1, units_expected: input.count, created_at: createdAt, admitted_at: createdAt,
    closed_at: state === "closed" ? createdAt : null,
  });
  const requests = [request(REQUEST, "2026-11-21T09:00:00.000Z", input.requestState ?? "admitted"),
    ...Array.from({ length: input.older ?? 0 }, (_, index) => request(id("30000000", index + 2), `2026-11-1${index}T09:00:00.000Z`, "closed"))];
  const jobs = plans.map((plan, index) => {
    const status = input.states?.[index] ?? "pending";
    return {
      id: id("60000000", index + 1), tenant_id: TENANT, project_id: PROJECT, launch_request_id: REQUEST,
      launch_unit_key: `plan:${plan.entry_key}`, plan_set_id: PLAN_SET, estimate_version_id: null, status,
      created_at: "2026-11-21T09:00:00.000Z", started_at: status === "pending" ? null : "2026-11-21T09:01:00.000Z",
      completed_at: status === "completed" || status === "failed" ? "2026-11-21T09:02:00.000Z" : null,
      analysis_finished_at: status === "completed" || status === "failed" ? "2026-11-21T09:02:00.000Z" : null,
      next_retry_at: null, analysis_outcome: status === "completed" ? "success" : status === "failed" ? "failure" : null,
      error_code: status === "failed" ? "TAKEOFF_PDF_CORRUPTED" : null, retry_count: 0, processing_strategy: "sync",
      execution_provider: "chatgpt_local", execution_host_id: HOST, created_by: OWNER, updated_at: "2026-11-21T09:02:00.000Z",
      lines: status === "completed" ? input.lines ?? [{ excluded: false }, { excluded: false }] : [],
    };
  });
  const hidden = new Set(input.hiddenJobs ?? []);
  const member = input.role === "director" ? DIRECTOR : OWNER;
  db.userId = member;
  db.rpc = { can_access_takeoff_project: input.role !== "director", takeoff_launch_request_action: "none" };
  const planFileRows = plans.map((plan) => ({ id: plan.plan_file_id, tenant_id: TENANT, plan_set_id: PLAN_SET, file_name: plan.name,
    file_path: `${TENANT}/${PLAN_SET}/${plan.plan_file_id}/x.pdf`, file_size_bytes: 1, metadata: {}, updated_at: "2026-11-21T08:00:00.000Z" }));
  db.service = {
    takeoff_launch_requests: requests.map((row) => ({ ...row, ...(row.id === REQUEST ? manifest : {}), manifest: row.id === REQUEST ? manifest : null })),
    takeoff_jobs: jobs,
    plan_sets: [{ id: PLAN_SET, tenant_id: TENANT, project_id: PROJECT, estimate_version_id: null, name: "Plans",
      metadata: { source: "affaire-intake", default_import_plan_set: true },
      updated_at: "2026-11-21T08:00:00.000Z", plan_files: [{ count: planFileRows.length }] }],
    plan_files: planFileRows,
    affaire_intake_documents: [],
  };
  db.member = {
    tenant_memberships: [{ id: "m", tenant_id: TENANT, user_id: member, role: input.role ?? "engineer", is_default: true,
      created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", "tenants.is_active": true, tenants: { is_active: true, name: "T" } }],
    estimate_projects: [{ id: PROJECT, tenant_id: TENANT, user_id: OWNER, name: "Affaire", reference: null, client_name: null, is_archived: false }],
    feature_flags: [{ tenant_id: TENANT, flag_key: normalizeFeatureFlagKey(TAKEOFF_MODULE_ENABLED_FLAG_KEY), enabled: true }],
    takeoff_launch_requests: requests,
    takeoff_jobs: jobs.filter((_, index) => !hidden.has(index)),
    // A director reads a plan file only where an analysis they read attests it (the evidence policy): here plan A alone.
    plan_files: input.role === "director" ? planFileRows.slice(0, 1) : planFileRows,
    affaire_intake_documents: [],
  };
}

const read = (input: Partial<Parameters<typeof readTakeoffRequestActivity>[0]> = {}) =>
  readTakeoffRequestActivity({ projectId: PROJECT, ...input });

beforeEach(() => {
  db.statements = [];
  db.failures = {};
  db.rpcCalls = [];
  db.authError = null;
  db.host = HOST;
  vi.stubEnv("TAKEOFF_MODULE_FORCE_ENABLED", "");
  vi.stubEnv("TAKEOFF_MODULE_ENABLED_BY_DEFAULT", "");
});

describe("readTakeoffRequestActivity: one light projection", () => {
  it("shows plan A read while plan B is read and plan C waits, in the recorded order, without the Mac", async () => {
    seed({ count: 3, states: ["completed", "processing"] });
    const answer = await read();
    expect(takeoffRequestActivityResponseSchema.safeParse(answer).success).toBe(true);
    expect(answer.current?.units?.units.map((unit) => [unit.ordinal, unit.name, unit.state, unit.reviewable])).toEqual([
      [1, "Plan A.pdf", "succeeded", true], [2, "Plan B.pdf", "running", false], [3, "Plan C.pdf", "queued", false],
    ]);
    expect(answer.current?.jobs.find((job) => job.jobId === id("60000000", 1))).toMatchObject({ itemCount: 2 });
    expect(answer.inFlightJobIds.sort()).toEqual([id("60000000", 2), id("60000000", 3)]);
    expect(answer.live).toBe(true);
    expect(JSON.stringify(answer)).not.toContain(HOST);
  });

  // Fix round 1, point 6: the whole endpoint (membership, access, module, visibility, dossier), not its mocks.
  it("makes as many statements for 20 plans and several failures as for one plan, the endpoint's own checks included", async () => {
    // A plan read and another being read: the dossier's difference waits for the end of the reading.
    seed({ count: 2, states: ["completed", "processing"] });
    await read();
    const one = [...db.statements].sort();
    db.statements = [];
    seed({ count: 20, states: ["failed", "failed", "failed", "completed", "processing"] });
    const many = await read();
    expect([...db.statements].sort()).toEqual(one);
    expect(one).toEqual([
      "member:estimate_projects", "member:feature_flags", "member:rpc:can_access_takeoff_project", "member:takeoff_jobs",
      "member:takeoff_jobs", "member:takeoff_launch_requests", "member:tenant_memberships",
      "service:rpc:read_takeoff_launch_unknown_calls", "service:takeoff_jobs", "service:takeoff_jobs",
      "service:takeoff_launch_requests",
    ]);
    expect(many.current?.units?.coverage).toMatchObject({ expected: 20, failed: 3, succeeded: 1, running: 1, queued: 15 });
  });

  // Lot 3 fix round 1: a call whose consumption stayed unknown freezes its request; the page tells how many, read once for
  // all its requests (read_takeoff_launch_unknown_calls), never per request.
  it("tells the calls of unknown consumption of the page's requests, read once for all of them", async () => {
    seed({ count: 3, states: ["completed", "processing"] });
    db.rpc.read_takeoff_launch_unknown_calls = [{ request_id: REQUEST, unknown_calls: 2 }];
    const answer = await read();
    expect(answer.current?.units?.unknownCalls).toBe(2);
    expect(db.rpcCalls.filter(([name]) => name === "service:rpc:read_takeoff_launch_unknown_calls")).toEqual([
      ["service:rpc:read_takeoff_launch_unknown_calls", expect.objectContaining({ p_tenant_id: TENANT, p_project_id: PROJECT,
        p_request_ids: expect.arrayContaining([REQUEST]) })]]);
  });

  it("says a request read against the list, and reads the send's write rule once, only for such a request", async () => {
    seed({ count: 2, states: ["completed", "processing"], itemList: true });
    db.rpc.takeoff_item_list_may_write = true;
    const answer = await read();
    expect(takeoffRequestActivityResponseSchema.safeParse(answer).success).toBe(true);
    expect(answer.current?.order).toBe("item_list");
    expect(answer.current?.jobs.map((job) => job.canSendItems)).toEqual([true, false]);
    expect(db.rpcCalls.filter(([name]) => name === "service:rpc:takeoff_item_list_may_write")).toEqual([
      ["service:rpc:takeoff_item_list_may_write", { p_tenant_id: TENANT, p_project_id: PROJECT, p_actor: OWNER }]]);
    // Without the write right, no entry; a request of today's formats reads no right at all.
    db.rpcCalls = [];
    db.rpc.takeoff_item_list_may_write = false;
    expect((await read()).current?.jobs.some((job) => job.canSendItems)).toBe(false);
    seed({ count: 2, states: ["completed", "processing"] });
    db.rpcCalls = [];
    const free = await read();
    expect([free.current?.order, free.current?.jobs.some((job) => job.canSendItems)]).toEqual(["free", false]);
    expect(db.rpcCalls.some(([name]) => name === "service:rpc:takeoff_item_list_may_write")).toBe(false);
  });

  it("computes the dossier's difference once, then again only when the dossier moved", async () => {
    seed({ count: 2, states: ["completed", "completed"], requestState: "closed" });
    db.service.plan_files.push({ id: id("50000000", 9), tenant_id: TENANT, plan_set_id: PLAN_SET, file_name: "Plan ajouté.pdf",
      file_path: "x", file_size_bytes: 1, metadata: {}, updated_at: "2026-11-21T10:00:00.000Z" });
    const first = await read();
    expect(first.current?.dossierChanged?.added).toEqual([{ id: id("50000000", 9), name: "Plan ajouté.pdf" }]);
    expect(first.live).toBe(false);
    const position = first.reused.dossierPosition;
    expect(position).toBeTruthy();
    db.statements = [];
    const again = await read({ dossierSeen: position });
    expect(again.reused).toMatchObject({ dossier: true, dossierPosition: position });
    expect(again.current?.dossierChanged).toBeNull();
    // Only the position (plan sets, plan files, pieces) was read, never the dossier's rows again (the unit sources, with
    // their calls of unknown consumption, are read at each poll).
    expect(db.statements.filter((statement) => statement.startsWith("service:") && !statement.endsWith("takeoff_jobs")
      && !statement.endsWith("takeoff_launch_requests") && !statement.endsWith("read_takeoff_launch_unknown_calls")).sort()).toEqual([
      "service:affaire_intake_documents", "service:plan_files", "service:plan_sets",
    ]);
    db.service.plan_files.push({ id: id("50000000", 10), tenant_id: TENANT, plan_set_id: PLAN_SET, file_name: "Encore un.pdf",
      file_path: "y", file_size_bytes: 1, metadata: {}, updated_at: "2026-11-21T10:05:00.000Z" });
    const moved = await read({ dossierSeen: position });
    expect(moved.reused.dossier).toBe(false);
    expect(moved.current?.dossierChanged?.added.map((plan) => plan.name)).toEqual(["Plan ajouté.pdf", "Encore un.pdf"]);
  });

  it("reads the gesture before an admission again only for another state or after 30 s", async () => {
    seed({ count: 1 });
    db.member.takeoff_launch_requests = [{ ...db.member.takeoff_launch_requests[0], state: "blocked", admitted_at: null,
      reason_code: "MANDATE_REQUIRED" }];
    db.rpc.takeoff_launch_request_action = "take_on";
    const first = await read();
    expect(first.current?.action).toEqual({ kind: "take_on", label: "Prendre en charge avec mon forfait", mandateRevision: 1 });
    // Closing round, point 1: the gesture is the one the database allows this member on this request.
    expect(db.rpcCalls).toContainEqual(["service:rpc:takeoff_launch_request_action", { p_request_id: REQUEST, p_actor: OWNER }]);
    db.statements = [];
    const again = await read({ actionSeen: first.reused.actionKey, actionSeenAt: first.observedAt });
    expect(again.reused.action).toBe(true);
    expect(db.statements).not.toContain("service:rpc:takeoff_launch_request_action");
    const stale = await read({ actionSeen: first.reused.actionKey, actionSeenAt: new Date(Date.now() - 31_000).toISOString() });
    expect(stale.reused.action).toBe(false);
    expect(db.statements).toContain("service:rpc:takeoff_launch_request_action");
  });

  // Closing round, point 9: the page's clock never keeps an old gesture.
  it("reads the gesture again for a time later than the server's", async () => {
    seed({ count: 1 });
    db.member.takeoff_launch_requests = [{ ...db.member.takeoff_launch_requests[0], state: "blocked", admitted_at: null,
      reason_code: "MANDATE_REQUIRED" }];
    db.rpc.takeoff_launch_request_action = "take_on";
    const first = await read();
    db.statements = [];
    const ahead = await read({ actionSeen: first.reused.actionKey, actionSeenAt: new Date(Date.now() + 3_600_000).toISOString() });
    expect(ahead.reused.action).toBe(false);
    expect(db.statements).toContain("service:rpc:takeoff_launch_request_action");
    expect(ahead.current?.action?.kind).toBe("take_on");
  });

  // Closing round, point 1: an analysis the member does not read leaves its unit's state, never its decisions.
  it("keeps a unit whose analysis the member does not read, without a decision for it", async () => {
    seed({ count: 2, states: ["completed", "completed"], hiddenJobs: [0] });
    const answer = await read();
    expect(answer.current?.units?.units.map((unit) => unit.state)).toEqual(["succeeded", "succeeded"]);
    expect(answer.current?.jobs.map((job) => job.jobId)).toEqual([id("60000000", 2)]);
  });

  // Fix round 1, point 2: reading the affaire does not name its plans.
  // Closing round, point 3: nor sends the identifier of a source they may not read, anywhere in the answer.
  it("names to a director only the plans they may read, the dossier's changes included", async () => {
    seed({ count: 2, states: ["completed", "completed"], requestState: "closed", role: "director", older: 1 });
    db.service.plan_files.push({ id: id("50000000", 9), tenant_id: TENANT, plan_set_id: PLAN_SET, file_name: "Ajouté sans pièce.pdf",
      file_path: "x", file_size_bytes: 1, metadata: {}, updated_at: "2026-11-21T10:00:00.000Z" });
    // The older request sealed the same plans: its history names them by the same rule.
    const sealed = db.service.takeoff_launch_requests.find((row) => row.id === REQUEST)!;
    db.service.takeoff_launch_requests = db.service.takeoff_launch_requests.map((row) => row.id === OLDER ? { ...row,
      format_version: sealed.format_version, units: sealed.units, plans: sealed.plans, coverage: sealed.coverage, manifest: sealed.manifest } : row);
    db.service.takeoff_jobs.push(...db.service.takeoff_jobs.map((job, index) => ({ ...job, id: id("60000000", 50 + index), launch_request_id: OLDER })));
    const answer = await read();
    expect(answer.current?.units?.units.map((unit) => [unit.name, unit.pages])).toEqual([["Plan A.pdf", [1]], ["Plan 2", []]]);
    expect(answer.current?.dossierChanged?.added.map((plan) => plan.name)).toEqual(["Plan 1"]);
    const history = await read({ view: "history" });
    expect(history.history[0]?.units?.units.map((unit) => unit.name)).toEqual(["Plan A.pdf", "Plan 2"]);
    for (const serialized of [JSON.stringify(answer), JSON.stringify(history)]) {
      expect(serialized).not.toContain(id("50000000", 2));
      expect(serialized).not.toContain(id("50000000", 9));
      expect(serialized).not.toContain("Ajouté sans pièce");
      expect(serialized).not.toContain("Plan B.pdf");
      // The plan the director reads keeps its identity.
      expect(serialized).toContain(id("50000000", 1));
    }
    expect(answer.current?.jobs.every((job) => !job.canCancel && !job.canResubmit)).toBe(true);
  });

  // Closing round, point 4: a name the shared reader gave the member is never masked again.
  it("names to a director a plan added after the seal that they read", async () => {
    seed({ count: 2, states: ["completed", "completed"], requestState: "closed", role: "director" });
    const added = { id: id("50000000", 9), tenant_id: TENANT, plan_set_id: PLAN_SET, file_name: "Ajouté lisible.pdf",
      file_path: "x", file_size_bytes: 1, metadata: {}, updated_at: "2026-11-21T10:00:00.000Z" };
    db.service.plan_files.push(added);
    db.member.plan_files.push(added);
    expect((await read()).current?.dossierChanged?.added).toEqual([{ id: id("50000000", 9), name: "Ajouté lisible.pdf" }]);
  });

  it("gives the engineer who owns the affaire every name and the stop of a plan being read", async () => {
    seed({ count: 2, states: ["completed", "processing"] });
    const answer = await read();
    expect(answer.current?.units?.units.map((unit) => unit.name)).toEqual(["Plan A.pdf", "Plan B.pdf"]);
    expect(answer.current?.jobs.find((job) => job.jobId === id("60000000", 2))?.canCancel).toBe(true);
  });

  // Fix round 1, point 7: a reading that kept only excluded lines retains none.
  it("counts the retained lines only", async () => {
    seed({ count: 1, states: ["completed"], lines: [{ excluded: true }, { excluded: true }] });
    expect((await read()).current?.jobs[0].itemCount).toBe(0);
  });

  // Fix round 1, point 4: a link to an older request still follows the latest one, its plans included.
  it("follows the latest execution's plans from a link to an older request", async () => {
    seed({ count: 2, states: ["processing"], older: 1 });
    const named = await read({ view: "request", requestId: OLDER });
    expect(named.current?.id).toBe(OLDER);
    expect(named.currentIsLatest).toBe(false);
    expect(named.elsewhere).toEqual({ running: true, waiting: false });
    expect(named.inFlightJobIds).toContain(id("60000000", 1));
    db.service.takeoff_jobs[0] = { ...db.service.takeoff_jobs[0], status: "completed", analysis_outcome: "success" };
    expect((await read({ view: "request", requestId: OLDER })).signature).not.toBe(named.signature);
    const ofJob = await read({ view: "job", jobId: id("60000000", 2) });
    expect([ofJob.current?.id, ofJob.currentIsLatest]).toEqual([REQUEST, true]);
  });

  it("pages the older requests apart from the current one", async () => {
    seed({ count: 1, states: ["completed"], older: 7 });
    const answer = await read({ view: "history", limit: 5 });
    expect(answer.current).toBeNull();
    expect([answer.history.length, answer.historyHasOlder]).toEqual([5, true]);
    expect([(await read({ view: "history", limit: 5, offset: 5 })).history.length]).toEqual([2]);
  });

  it("answers no request for an analysis without one, and follows it while it runs", async () => {
    seed({ count: 1 });
    db.member.takeoff_jobs.push({ id: id("60000000", 99), tenant_id: TENANT, project_id: PROJECT, launch_request_id: null,
      status: "processing", execution_provider: "chatgpt_local", retry_count: 0, updated_at: "2026-11-21T09:00:00.000Z" });
    expect((await read({ view: "job", jobId: id("60000000", 99) })).current).toBeNull();
    const answer = await read();
    expect(answer.standalone.running).toBe(1);
    expect(answer.inFlightJobIds).toContain(id("60000000", 99));
  });

  it("changes its signature with a transition, never with a lease renewal", async () => {
    seed({ count: 2, states: ["processing"] });
    const first = await read();
    db.service.takeoff_jobs[0] = { ...db.service.takeoff_jobs[0], updated_at: "2026-11-21T09:59:59.000Z" };
    expect((await read()).signature).toBe(first.signature);
    db.service.takeoff_jobs[0] = { ...db.service.takeoff_jobs[0], status: "completed", analysis_outcome: "success" };
    expect((await read()).signature).not.toBe(first.signature);
  });
});

// Fix round 1, point 5: only a refusal stops the page's reads; a timeout is a read to try again.
describe("GET /api/takeoff/activity-center/requests: errors", () => {
  const get = (query = "") => GET(new Request(`http://localhost/api/takeoff/activity-center/requests?project_id=${PROJECT}${query}`));

  it("answers a statement timeout as a read to try again, never as a refusal", async () => {
    seed({ count: 1 });
    db.failures["member:takeoff_launch_requests"] = { code: "57014", message: "canceling statement due to statement timeout" };
    const response = await get();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toMatchObject({ retryable: true });
    expect(JSON.stringify(body)).not.toContain("canceling statement");
  });

  it("answers a timeout of the access check itself the same way", async () => {
    seed({ count: 1 });
    db.failures["member:estimate_projects"] = { code: "57014", message: "canceling statement due to statement timeout" };
    expect((await get()).status).toBe(503);
  });

  // Closing round, point 5: a read of the module's flag or of the session that failed is not an answer.
  it("answers a timeout reading the module's flag as a read to try again, and a flag that is off as a refusal", async () => {
    seed({ count: 1 });
    db.failures["member:feature_flags"] = { code: "57014", message: "canceling statement due to statement timeout" };
    const failed = await get();
    expect(failed.status).toBe(503);
    expect((await failed.json()).error).toMatchObject({ retryable: true });
    delete db.failures["member:feature_flags"];
    db.member.feature_flags = [{ ...db.member.feature_flags[0], enabled: false }];
    const off = await get();
    expect(off.status).toBe(403);
    expect((await off.json()).error).toMatchObject({ code: "TAKEOFF_MODULE_DISABLED" });
  });

  it("answers an Auth service that did not answer as a read to try again, and a missing session as a refusal", async () => {
    seed({ count: 1 });
    db.authError = new AuthRetryableFetchError("fetch failed", 0);
    const failed = await get();
    expect(failed.status).toBe(503);
    expect((await failed.json()).error).toMatchObject({ retryable: true });
    db.authError = new AuthSessionMissingError();
    expect((await get()).status).toBe(401);
  });

  it("answers a refusal as a refusal", async () => {
    seed({ count: 1 });
    db.failures["member:takeoff_launch_requests"] = { code: "42501", message: "permission denied" };
    expect((await get()).status).toBe(403);
  });
});
