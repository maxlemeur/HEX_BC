import { beforeEach, describe, expect, it, vi } from "vitest";

import { launchTakeoffItemRemeasure, type TakeoffItemRemeasurePlan } from "./item-remeasure-server";

const fixture = vi.hoisted(() => {
  const id = (n: number) => `f2000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const state = { attest: null as null | { message: string }, admission: null as null | { message: string } };
  const rpc = vi.fn(async (name: string) => {
    if (name === "attest_takeoff_count_mark_pages") return { data: null, error: state.attest };
    if (name === "launch_takeoff_item_remeasure") {
      return { data: state.admission ? null : [{ outcome: "replayed", request_id: id(9), stale: null }], error: state.admission };
    }
    throw new Error(`Unexpected RPC: ${name}`);
  });
  return { id, state, rpc };
});

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc: fixture.rpc }) }));
vi.mock("@/lib/takeoff/launch-request-server", async (original) => ({
  ...await original<typeof import("./launch-request-server")>(),
  planUnitJobs: async (_service: unknown, input: { manifest: unknown }) => ({ manifest: input.manifest, jobs: [] }),
}));

const context = { tenantId: fixture.id(1), userId: fixture.id(2) } as never;
const selection = { source: "personal_api_key", profileId: fixture.id(3), authorizationId: fixture.id(3),
  hostId: `urn:uuid:${fixture.id(4)}`, model: "personal_api_key", reasoningEffort: null } as const;
const plan = (marks: boolean) => ({
  planSetId: fixture.id(5), preparationRevision: 2, planFileIds: [fixture.id(6)], planKeys: ["plan-fictif"], predecessorJobId: fixture.id(7),
  listRevisionId: fixture.id(8), askedItemIds: [], snapshot: {},
  manifest: { plans: [{ plan_file_id: fixture.id(6), logical_id: "plan-fictif", content_sha256: "c".repeat(64) }], units: [] },
  ...(marks && { markFrames: [] }),
}) as unknown as TakeoffItemRemeasurePlan;
const admit = (marks: boolean, beforeAdmission: () => Promise<void>) => launchTakeoffItemRemeasure(context, {
  projectId: fixture.id(10), intentKey: fixture.id(11), plan: plan(marks), selection, targets: [],
  confirmation: { preview_digest: "d".repeat(64), setting: null }, beforeAdmission });

beforeEach(() => {
  fixture.state.attest = null;
  fixture.state.admission = null;
  fixture.rpc.mockClear();
});

// The caller records a key's mandate in `beforeAdmission`: it runs once the admission's own refusals have passed.
describe("the step that runs immediately before the admission of a new measure", () => {
  it("runs after the page geometry was attested and before the request is created", async () => {
    const order: string[] = [];
    const beforeAdmission = async () => { order.push(...fixture.rpc.mock.calls.map(([name]) => name), "beforeAdmission"); };
    await expect(admit(true, beforeAdmission)).resolves.toMatchObject({ outcome: "replayed" });
    expect(order).toEqual(["attest_takeoff_count_mark_pages", "beforeAdmission"]);
    expect(fixture.rpc.mock.calls.map(([name]) => name)).toEqual(["attest_takeoff_count_mark_pages", "launch_takeoff_item_remeasure"]);
  });

  it("does not run when the page geometry is refused", async () => {
    fixture.state.attest = { message: "TAKEOFF_MARKS_PAGE_GEOMETRY_CONFLICT" };
    const beforeAdmission = vi.fn(async () => {});
    await expect(admit(true, beforeAdmission)).rejects.toMatchObject({ status: 409 });
    expect(beforeAdmission).not.toHaveBeenCalled();
    expect(fixture.rpc.mock.calls.map(([name]) => name)).toEqual(["attest_takeoff_count_mark_pages"]);
  });
});
