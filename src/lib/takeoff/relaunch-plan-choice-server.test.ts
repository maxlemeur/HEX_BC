import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createSupabaseFake, M3_PROJECT_ID, M3_TENANT_ID, M3_PLAN_SET_ID } from "./metre-m3.test-utils";
import { readRelaunchPlanChoice } from "./relaunch-plan-choice-server";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("./preparation-repository", () => ({ assertPreparationProjectAccess: vi.fn() }));

const id = "00000000-0000-4000-8000-000000000001";
const name = "Plan.pdf";
const oldBytes = "PDF fictif A";
const newBytes = "PDF fictif B";
const hash = (bytes: string) => createHash("sha256").update(bytes).digest("hex");

it.each([
  { scenario: "different current bytes of the same length", digest: hash(oldBytes), denied: false, read: false },
  { scenario: "matching bytes", digest: hash(newBytes), denied: false, read: true },
  { scenario: "a snapshot without a digest", digest: null, denied: false, read: false },
  { scenario: "a refused download", digest: hash(newBytes), denied: true, read: false },
])("compares a successful older job with $scenario at the same plan UUID", async ({ digest, denied, read }) => {
  const key = `plan:${id}`;
  const predecessor = { id: "failed-job", launch_request_id: "request", plan_set_id: M3_PLAN_SET_ID,
    launch_unit_key: key, status: "failed", analysis_outcome: "failure", started_at: "2026-01-02" };
  const request = { id: "request", created_at: "2026-01-02", state: "closed", takeoff_jobs: [predecessor],
    manifest: { format_version: 2, plans: [{ entry_key: id, plan_file_id: id, content_sha256: hash(newBytes), name }],
      units: [{ key, plans: [id] }] } };
  const older = { id: "older-job", status: "completed", launch_request_id: null,
    preparation_snapshot: { preparation: { sources: [{ kind: "plan", active: true, plan_set_id: M3_PLAN_SET_ID,
      document_id: id, document_name: name, content_hash: digest }] } } };
  const file = { id, plan_set_id: M3_PLAN_SET_ID, file_name: name, file_size_bytes: newBytes.length,
    file_path: `${M3_TENANT_ID}/${M3_PLAN_SET_ID}/${id}/${name}` };
  const fake = createSupabaseFake({
    tables: {
      takeoff_jobs: query => query.cardinality === "many" ? { data: [older], count: 1, error: null } : { data: predecessor, error: null },
      takeoff_launch_requests: () => ({ data: [request], count: 1, error: null }),
      plan_sets: () => ({ data: [{ id: M3_PLAN_SET_ID }], count: 1, error: null }),
      plan_files: () => ({ data: [file], count: 1, error: null }),
    },
    rpc: {
      can_access_takeoff_project: () => ({ data: true, error: null }),
      read_takeoff_plan_location_source: () => ({ data: [{ source_kind: "plan_file", source_id: id, current_copy: true }], error: null }),
    },
    storage: { "plan-files": () => denied ? { data: null, error: { message: "Refusé" } } : { data: new Blob([newBytes]), error: null } },
  });
  vi.mocked(createServiceRoleClient).mockReturnValue(fake.client as never);
  const options = await readRelaunchPlanChoice({ tenantId: M3_TENANT_ID, supabase: fake.client } as never,
    M3_PROJECT_ID, predecessor.id, false);
  expect(options.states[id]).toBe(read ? "analysed" : "failed");
  expect(options.defaultIds).toEqual(read ? [] : [id]);
  expect(options.readThrough).toEqual({});
});
