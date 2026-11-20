import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/server", () => ({
  listTakeoffJobs: vi.fn(), getTakeoffJobDetails: vi.fn(),
  cancelTakeoffJob: vi.fn(), resubmitTakeoffJob: vi.fn(),
  parseListTakeoffJobsQuery: (input: unknown) => listTakeoffJobsQuerySchema.parse(input),
  parseGetTakeoffJobDetailsQuery: (input: unknown) => getTakeoffJobDetailsQuerySchema.parse(input),
}));
vi.mock("@/lib/auth/tenant-context", () => ({ getAuthenticatedContext: vi.fn() }));
vi.mock("@/lib/takeoff/edge-trigger", () => ({ triggerTakeoffJobProcessing: vi.fn() }));
vi.mock("@/lib/takeoff/dispatch-state", () => ({ persistTakeoffDispatchOutcome: vi.fn() }));

import { POST as resubmitJob } from "@/app/api/takeoff/jobs/[jobId]/resubmit/route";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { persistTakeoffDispatchOutcome } from "@/lib/takeoff/dispatch-state";
import { triggerTakeoffJobProcessing } from "@/lib/takeoff/edge-trigger";
import {
  appliedJobFixture, JOB_ID, OTHER_ID, ACTOR_ID,
} from "@/lib/takeoff/response-contracts.test-fixtures";
import { getTakeoffJobDetailsQuerySchema, listTakeoffJobsQuerySchema } from "@/lib/takeoff/schemas";
import { resubmitTakeoffJob } from "@/lib/takeoff/server";

const acceptedTrigger = { triggered: true, correlationId: OTHER_ID, statusCode: 202, outcome: "accepted" as const };
const context = () => ({ params: Promise.resolve({ jobId: JOB_ID }) });
const actionRequest = (action: string) => new Request(`http://localhost/api/takeoff/jobs/${JOB_ID}/${action}`, { method: "POST" });

function action(command: "resubmit") {
  return { job: { ...appliedJobFixture(), status: "pending" }, command, outcome: "applied" };
}

const routes = [
  {
    name: "resubmit", producer: vi.mocked(resubmitTakeoffJob), valid: () => action("resubmit"),
    invoke: () => resubmitJob(actionRequest("resubmit"), context()), status: 200,
  },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.mocked(getAuthenticatedContext).mockResolvedValue({ supabase: {}, tenantId: ACTOR_ID, userId: ACTOR_ID, tenantRole: "admin" } as never);
  vi.mocked(triggerTakeoffJobProcessing).mockResolvedValue(acceptedTrigger);
  vi.mocked(persistTakeoffDispatchOutcome).mockResolvedValue(true);
  for (const route of routes) route.producer.mockResolvedValue(route.valid() as never);
});
afterEach(() => vi.restoreAllMocks());

describe.each(routes)("takeoff $name dispatch receipt", (route) => {
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
