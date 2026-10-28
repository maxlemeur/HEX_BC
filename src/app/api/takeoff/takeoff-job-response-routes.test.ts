import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/server", () => ({
  createTakeoffJobFromFormData: vi.fn(), hasAccessibleTakeoffJobForIdempotencyKey: vi.fn(),
  listTakeoffJobs: vi.fn(), getTakeoffJobDetails: vi.fn(), retryTakeoffJob: vi.fn(),
  cancelTakeoffJob: vi.fn(), reconcileTakeoffJobNow: vi.fn(), resubmitTakeoffJob: vi.fn(),
  parseListTakeoffJobsQuery: (input: unknown) => listTakeoffJobsQuerySchema.parse(input),
  parseGetTakeoffJobDetailsQuery: (input: unknown) => getTakeoffJobDetailsQuerySchema.parse(input),
}));
vi.mock("@/lib/auth/tenant-context", () => ({ getAuthenticatedContext: vi.fn() }));
vi.mock("@/lib/takeoff/feature-flags", () => ({ assertTakeoffEnabled: vi.fn() }));
vi.mock("@/lib/takeoff/edge-trigger", () => ({ triggerTakeoffJobProcessing: vi.fn() }));
vi.mock("@/lib/takeoff/dispatch-state", () => ({ persistTakeoffDispatchOutcome: vi.fn() }));

import { GET as listJobs, POST as createJob } from "@/app/api/takeoff/jobs/route";
import { GET as getJob } from "@/app/api/takeoff/jobs/[jobId]/route";
import { POST as retryJob } from "@/app/api/takeoff/jobs/[jobId]/retry/route";
import { POST as cancelJob } from "@/app/api/takeoff/jobs/[jobId]/cancel/route";
import { POST as reconcileJob } from "@/app/api/takeoff/jobs/[jobId]/reconcile/route";
import { POST as resubmitJob } from "@/app/api/takeoff/jobs/[jobId]/resubmit/route";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { persistTakeoffDispatchOutcome } from "@/lib/takeoff/dispatch-state";
import { triggerTakeoffJobProcessing } from "@/lib/takeoff/edge-trigger";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { assertTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import {
  appliedJobFixture, takeoffItemFixture, JOB_ID, VERSION_ID, OTHER_ID, LINE_ID, ACTOR_ID, NOW,
} from "@/lib/takeoff/response-contracts.test-fixtures";
import { getTakeoffJobDetailsQuerySchema, listTakeoffJobsQuerySchema } from "@/lib/takeoff/schemas";
import {
  createTakeoffJobFromFormData, hasAccessibleTakeoffJobForIdempotencyKey,
  listTakeoffJobs, getTakeoffJobDetails, retryTakeoffJob,
  cancelTakeoffJob, reconcileTakeoffJobNow, resubmitTakeoffJob,
} from "@/lib/takeoff/server";

const acceptedTrigger = { triggered: true, correlationId: OTHER_ID, statusCode: 202, outcome: "accepted" as const };
const acceptedDispatch = { status: "accepted", correlation_id: OTHER_ID, persisted: true };
const context = () => ({ params: Promise.resolve({ jobId: JOB_ID }) });
const actionRequest = (action: string) => new Request(`http://localhost/api/takeoff/jobs/${JOB_ID}/${action}`, { method: "POST" });

function creation() {
  return { id: JOB_ID, estimate_version_id: VERSION_ID, status: "pending", level: "A", source_file_name: "plans.csv", created_at: NOW };
}
function createRequest() {
  const body = new FormData();
  body.set("estimate_version_id", VERSION_ID);
  body.set("level", "A");
  body.set("file", new File(["designation;quantity;unit\nTube;12;m"], "plans.csv", { type: "text/csv" }));
  return new Request("http://localhost/api/takeoff/jobs", { method: "POST", body });
}
function detail() {
  return { job: appliedJobFixture(), result: {
    id: LINE_ID, extracted_json: { items: [] }, warnings: [], tables: [], provider_meta: { source: "provider" }, raw_response: null,
    confidence: 0.9, token_count: 100, cost_cents: 1, duration_ms: 1000, created_at: NOW, updated_at: NOW,
  }, items: { data: [takeoffItemFixture()], pagination: { limit: 50, offset: 0, total: 1 } } };
}
function listing() {
  return { jobs: [appliedJobFixture()], counters: { total: 1, processing: 0, completed: 0, failed: 0, canceled: 0 },
    pagination: { limit: 20, offset: 0, total: 1 } };
}
function action(command: "retry" | "cancel" | "reconcile" | "resubmit") {
  return { job: { ...appliedJobFixture(), status: command === "cancel" ? "canceled" : command === "reconcile" ? "processing" : "pending" },
    command, outcome: "applied" };
}

const routes = [
  {
    name: "create", producer: vi.mocked(createTakeoffJobFromFormData), valid: creation,
    invoke: () => createJob(createRequest()), status: 201, dispatch: true,
    inconsistent: () => ({ ...creation(), estimate_version_id: OTHER_ID }),
  },
  {
    name: "detail", producer: vi.mocked(getTakeoffJobDetails), valid: detail,
    invoke: () => getJob(new Request(`http://localhost/api/takeoff/jobs/${JOB_ID}`), context()), status: 200, dispatch: false,
    inconsistent: () => ({ ...detail(), job: { ...appliedJobFixture(), id: OTHER_ID } }),
  },
  {
    name: "list", producer: vi.mocked(listTakeoffJobs), valid: listing,
    invoke: () => listJobs(new Request("http://localhost/api/takeoff/jobs")), status: 200, dispatch: false,
    inconsistent: () => ({ ...listing(), counters: { ...listing().counters, failed: 2 } }),
  },
  {
    name: "retry", producer: vi.mocked(retryTakeoffJob), valid: () => action("retry"),
    invoke: () => retryJob(actionRequest("retry"), context()), status: 200, dispatch: true,
    inconsistent: () => ({ ...action("retry"), command: "cancel" }),
  },
  {
    name: "cancel", producer: vi.mocked(cancelTakeoffJob), valid: () => action("cancel"),
    invoke: () => cancelJob(actionRequest("cancel"), context()), status: 200, dispatch: false,
    inconsistent: () => ({ ...action("cancel"), job: { ...appliedJobFixture(), status: "pending" } }),
  },
  {
    name: "reconcile", producer: vi.mocked(reconcileTakeoffJobNow), valid: () => action("reconcile"),
    invoke: () => reconcileJob(actionRequest("reconcile"), context()), status: 200, dispatch: true,
    inconsistent: () => ({ ...action("reconcile"), job: { ...appliedJobFixture(), status: "pending" } }),
  },
  {
    name: "resubmit", producer: vi.mocked(resubmitTakeoffJob), valid: () => action("resubmit"),
    invoke: () => resubmitJob(actionRequest("resubmit"), context()), status: 200, dispatch: true,
    inconsistent: () => ({ ...action("resubmit"), job: { ...appliedJobFixture(), id: OTHER_ID, status: "pending" } }),
  },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.mocked(getAuthenticatedContext).mockResolvedValue({ supabase: {}, tenantId: ACTOR_ID, userId: ACTOR_ID, tenantRole: "admin" } as never);
  vi.mocked(assertTakeoffEnabled).mockResolvedValue(undefined);
  vi.mocked(hasAccessibleTakeoffJobForIdempotencyKey).mockResolvedValue(false);
  vi.mocked(triggerTakeoffJobProcessing).mockResolvedValue(acceptedTrigger);
  vi.mocked(persistTakeoffDispatchOutcome).mockResolvedValue(true);
  for (const route of routes) route.producer.mockResolvedValue(route.valid() as never);
});
afterEach(() => vi.restoreAllMocks());

describe.each(routes)("takeoff job $name route output", (route) => {
  it("returns the full producer receipt and any completed dispatch orchestration", async () => {
    const response = await route.invoke();
    expect(response.status).toBe(route.status);
    expect(await response.json()).toEqual({ ok: true, data: {
      ...route.valid(), ...(route.dispatch ? { dispatch: acceptedDispatch } : {}),
    } });
    expect(route.producer).toHaveBeenCalledTimes(1);
    expect(triggerTakeoffJobProcessing).toHaveBeenCalledTimes(route.dispatch ? 1 : 0);
    expect(persistTakeoffDispatchOutcome).toHaveBeenCalledTimes(route.dispatch ? 1 : 0);
  });

  it("rejects malformed producer output as HTTP 500", async () => {
    route.producer.mockResolvedValue({ unexpected: "malformed" } as never);
    const response = await route.invoke();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
    expect(route.producer).toHaveBeenCalledTimes(1);
  });

  it("rejects an inconsistent identity, state or counter", async () => {
    route.producer.mockResolvedValue(route.inconsistent() as never);
    const response = await route.invoke();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
  });

  it("preserves domain refusals and does not dispatch a refused command", async () => {
    route.producer.mockRejectedValue(new TakeoffError({
      status: 403, code: TakeoffErrorCode.FORBIDDEN, message: "Accès refusé", retryable: false, jobId: JOB_ID,
    }));
    const response = await route.invoke();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "FORBIDDEN", message: "Accès refusé", retryable: false } });
    expect(triggerTakeoffJobProcessing).not.toHaveBeenCalled();
    expect(persistTakeoffDispatchOutcome).not.toHaveBeenCalled();
  });
});

describe.each(routes.filter((route) => route.dispatch))("takeoff $name dispatch receipt", (route) => {
  it("validates enrichment after the worker trigger and persistence attempt", async () => {
    vi.mocked(triggerTakeoffJobProcessing).mockResolvedValue({ ...acceptedTrigger, correlationId: "malformed" });
    const response = await route.invoke();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
    expect(triggerTakeoffJobProcessing).toHaveBeenCalledTimes(1);
    expect(persistTakeoffDispatchOutcome).toHaveBeenCalledTimes(1);
    expect(route.producer).toHaveBeenCalledTimes(1);
  });

  it("does not report a durable queue when dispatch persistence is unconfirmed", async () => {
    vi.mocked(triggerTakeoffJobProcessing).mockResolvedValue({ ...acceptedTrigger, triggered: false, statusCode: null, outcome: "timeout" });
    vi.mocked(persistTakeoffDispatchOutcome).mockResolvedValue(false);
    const response = await route.invoke();
    expect(response.status).toBe(route.status);
    expect(await response.json()).toMatchObject({ ok: true, data: { dispatch: {
      status: "persistence_unconfirmed", correlation_id: OTHER_ID, persisted: false,
    } } });
  });
});

it("returns a terminal reconciliation noop without triggering or inventing dispatch", async () => {
  const data = { job: appliedJobFixture(), command: "reconcile", outcome: "noop" };
  vi.mocked(reconcileTakeoffJobNow).mockResolvedValue(data as never);
  const response = await reconcileJob(actionRequest("reconcile"), context());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, data });
  expect(triggerTakeoffJobProcessing).not.toHaveBeenCalled();
  expect(persistTakeoffDispatchOutcome).not.toHaveBeenCalled();
});

it("preserves invalid list query errors as HTTP 400 before reading jobs", async () => {
  const response = await listJobs(new Request("http://localhost/api/takeoff/jobs?limit=0"));
  expect(response.status).toBe(400);
  expect(listTakeoffJobs).not.toHaveBeenCalled();
});
