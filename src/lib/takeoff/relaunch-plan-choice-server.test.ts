import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createSupabaseFake, M3_PROJECT_ID, M3_TENANT_ID, M3_PLAN_SET_ID } from "./metre-m3.test-utils";
import { readRelaunchPlanChoice } from "./relaunch-plan-choice-server";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("./preparation-repository", () => ({ assertPreparationProjectAccess: vi.fn() }));

const id = "00000000-0000-4000-8000-00000000000a";
const otherId = "00000000-0000-4000-8000-00000000000b";
const name = "Plan.pdf";
const oldBytes = "PDF fictif A";
const newBytes = "PDF fictif B";
const hash = (bytes: string) => createHash("sha256").update(bytes).digest("hex");

function closedRequest(requestId: string, planId: string, digest: string | null, outcome: "success" | "failure") {
  const key = `plan:${planId}`;
  const job = { id: `job-${requestId}`, launch_request_id: requestId, plan_set_id: M3_PLAN_SET_ID, launch_unit_key: key,
    status: outcome === "success" ? "completed" : "failed", analysis_outcome: outcome, started_at: "2026-01-02" };
  return { id: requestId, created_at: outcome === "success" ? "2026-01-01" : "2026-01-02", state: "closed",
    takeoff_jobs: [job] as const, manifest: { format_version: 2,
      plans: [{ entry_key: planId, plan_file_id: planId, content_sha256: digest, name }], units: [{ key, plans: [planId] }] } };
}

type Request = ReturnType<typeof closedRequest>;

function arrange(predecessorRequest: Request, requests: Request[], olderJobs: object[] = [], denied = false) {
  const [predecessor] = predecessorRequest.takeoff_jobs;
  const ids = new Set([id, ...predecessorRequest.manifest.plans.map(plan => plan.plan_file_id)]);
  const files = [...ids].map(fileId => ({ id: fileId, plan_set_id: M3_PLAN_SET_ID, file_name: name,
    file_size_bytes: fileId === id ? newBytes.length : "Autre plan".length,
    file_path: `${M3_TENANT_ID}/${M3_PLAN_SET_ID}/${fileId}/${name}` }));
  const fake = createSupabaseFake({
    tables: {
      takeoff_jobs: query => query.cardinality === "many" ? { data: olderJobs, count: olderJobs.length, error: null } : { data: predecessor, error: null },
      takeoff_launch_requests: () => ({ data: requests, count: requests.length, error: null }),
      plan_sets: () => ({ data: [{ id: M3_PLAN_SET_ID }], count: 1, error: null }),
      plan_files: () => ({ data: files, count: files.length, error: null }),
    },
    rpc: {
      can_access_takeoff_project: () => ({ data: true, error: null }),
      read_takeoff_plan_location_source: () => ({ data: [{ source_kind: "plan_file", source_id: id, current_copy: true }], error: null }),
    },
    storage: { "plan-files": ({ paths }) => {
      if (denied) return { data: null, error: { message: "Refusé" } };
      const file = files.find(candidate => candidate.file_path === paths[0]);
      if (!file) throw new Error("Unknown plan path");
      return { data: new Blob([file.id === id ? newBytes : "Autre plan"]), error: null };
    } },
  });
  vi.mocked(createServiceRoleClient).mockReturnValue(fake.client as never);
  const read = () => readRelaunchPlanChoice({ tenantId: M3_TENANT_ID, supabase: fake.client } as never,
    M3_PROJECT_ID, predecessor.id, false);
  return { read, storageCalls: fake.storageCalls };
}

it.each([
  { scenario: "different current bytes of the same length", digest: hash(oldBytes), denied: false, read: false, downloads: 0 },
  { scenario: "matching bytes", digest: hash(newBytes), denied: false, read: true, downloads: 1 },
  { scenario: "a snapshot without a digest", digest: null, denied: false, read: false, downloads: 0 },
  { scenario: "a refused download", digest: hash(newBytes), denied: true, read: false, downloads: 1 },
])("compares a successful older job with $scenario at the same plan UUID", async ({ digest, denied, read, downloads }) => {
  const request = closedRequest("predecessor", id, hash(newBytes), "failure");
  const older = { id: "older-job", status: "completed", launch_request_id: null,
    preparation_snapshot: { preparation: { sources: [{ kind: "plan", active: true, plan_set_id: M3_PLAN_SET_ID,
      document_id: id, document_name: name, content_hash: digest }] } } };
  const fixture = arrange(request, [request], [older], denied);
  const options = await fixture.read();
  expect(options.states[id]).toBe(read ? "analysed" : "failed");
  expect(options.defaultIds).toEqual(read ? [] : [id]);
  expect(options.readThrough).toEqual({});
  expect(fixture.storageCalls).toHaveLength(downloads);
});

it.each([
  { scenario: "different sealed bytes at the same UUID and path", previous: hash(oldBytes), target: hash(newBytes), read: false, downloads: 0 },
  { scenario: "identical sealed bytes", previous: hash(newBytes), target: hash(newBytes), read: true, downloads: 0 },
  { scenario: "a success without a digest", previous: null, target: hash(newBytes), read: false, downloads: 0 },
  { scenario: "an unsealed predecessor and changed bytes", previous: hash(oldBytes), target: null, read: false, downloads: 1 },
  { scenario: "an unsealed predecessor and matching bytes", previous: hash(newBytes), target: null, read: true, downloads: 1 },
])("compares two closed requests with $scenario at open and refresh", async ({ previous, target, read, downloads }) => {
  const success = closedRequest("first", id, previous, "success");
  const failed = closedRequest("second", id, target, "failure");
  const fixture = arrange(failed, [failed, success]);
  for (const call of [1, 2]) {
    const options = await fixture.read();
    expect(options.states[id]).toBe(read ? "analysed" : "failed");
    expect(options.defaultIds).toEqual(read ? [] : [id]);
    expect(fixture.storageCalls).toHaveLength(call * downloads);
  }
});

it.each([
  { scenario: "replaced bytes", digest: hash(oldBytes), state: "not_analysed", denied: false },
  { scenario: "identical bytes", digest: hash(newBytes), state: "analysed", denied: false },
  { scenario: "a refused download", digest: hash(newBytes), state: "not_analysed", denied: true },
])("checks current bytes for a plan outside the predecessor with $scenario", async ({ digest, state, denied }) => {
  const failed = closedRequest("second", otherId, hash("Autre plan"), "failure");
  const success = closedRequest("first", id, digest, "success");
  const fixture = arrange(failed, [failed, success], [], denied);
  const options = await fixture.read();
  expect(options.states[id] ?? "not_analysed").toBe(state);
  expect(options.defaultIds).toEqual([otherId]);
  expect(fixture.storageCalls).toHaveLength(1);
});

it("recognizes the same plan in a sealed reading with an uppercase UUID", async () => {
  const failed = closedRequest("second", id, hash(newBytes), "failure");
  const success = closedRequest("first", id.toUpperCase(), hash(newBytes), "success");
  const fixture = arrange(failed, [failed, success]);
  const options = await fixture.read();
  expect(options.states[id]).toBe("analysed");
  expect(options.defaultIds).toEqual([]);
  expect(options.readThrough).toEqual({});
  expect(fixture.storageCalls).toHaveLength(0);
});
