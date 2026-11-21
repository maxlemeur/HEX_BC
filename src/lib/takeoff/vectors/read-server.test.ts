import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getAuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import { createSupabaseFake, M3_PLAN_SET_ID, M3_TENANT_ID } from "@/lib/takeoff/metre-m3.test-utils";
import { buildPlanFileStoragePath } from "@/lib/takeoff/plan-file-display-name";
import { PLAN_FILE_MAX_SIZE_BYTES } from "@/lib/takeoff/plans";
import { PLAN_FILES_BUCKET } from "@/lib/storage/buckets";
import { createEmptyTakeoffPreparation, createTakeoffPreparationSnapshot, takeoffPreparationSourceSchema } from "@/lib/takeoff/preparation";
import { readAttestedTakeoffPlan } from "@/lib/takeoff/vectors/read-server";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/takeoff/job-read-server", () => ({ getAuthenticatedTakeoffContext: vi.fn() }));

// The plan route serves the very bytes an analysis attested. Its reader checks the stored size before it reads the
// object: a plan replaced by an oversized object is refused without being downloaded into memory.
const JOB_ID = "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa";
const FILE_ID = "bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb";
const BYTES = new TextEncoder().encode("%PDF-1.4 plan fictif");
const FILE_PATH = buildPlanFileStoragePath({ tenantId: M3_TENANT_ID, setId: M3_PLAN_SET_ID, fileId: FILE_ID, fileName: "plan-fictif.pdf" });

function snapshot() {
  const preparation = createEmptyTakeoffPreparation();
  preparation.objective = "extract_quantities";
  preparation.objective_confirmed = true;
  preparation.scope.inclusions = ["Plan fictif"];
  preparation.scope.confirmed = true;
  preparation.conventions.unit = "u";
  preparation.conventions.confirmed = true;
  preparation.destination.confirmed = true;
  preparation.sources = [takeoffPreparationSourceSchema.parse({
    document_id: FILE_ID, document_name: "plan-fictif.pdf", kind: "plan", revision: "A", source_version: "fixture",
    pages: [], active: true, confirmed: true, plan_set_id: M3_PLAN_SET_ID, file_path: FILE_PATH,
    content_hash: createHash("sha256").update(BYTES).digest("hex"),
  })];
  return createTakeoffPreparationSnapshot({ preparation, confirmedBy: "11111111-1111-4111-8111-111111111111",
    confirmedAt: "2026-11-21T00:00:00.000Z", revision: 1 });
}

function storage(stored: { size: number } | null, served: Uint8Array) {
  const fake = createSupabaseFake({ storage: {
    [PLAN_FILES_BUCKET]: (call) => call.method === "info"
      ? { data: stored, error: stored ? null : { message: "missing" } }
      : { data: new Blob([served as BlobPart]), error: null },
  } });
  vi.mocked(createServiceRoleClient).mockReturnValue(fake.client as never);
  return fake;
}

beforeEach(() => {
  vi.clearAllMocks();
  const session = createSupabaseFake({ tables: {
    takeoff_jobs: () => ({ data: { plan_set_id: M3_PLAN_SET_ID, preparation_snapshot: snapshot(), estimate_version_id: null }, error: null }),
    plan_files: () => ({ data: { file_path: FILE_PATH, file_name: "plan-fictif.pdf" }, error: null }),
  } });
  vi.mocked(getAuthenticatedTakeoffContext).mockResolvedValue({ supabase: session.client, tenantId: M3_TENANT_ID } as never);
});

describe("readAttestedTakeoffPlan", () => {
  it("serves the attested bytes after checking their stored size", async () => {
    const fake = storage({ size: BYTES.byteLength }, BYTES);
    expect(new Uint8Array(await readAttestedTakeoffPlan(JOB_ID, FILE_ID))).toEqual(BYTES);
    expect(fake.storageCalls.map((call) => call.method)).toEqual(["info", "download"]);
  });

  it("never downloads an object larger than a plan may be", async () => {
    const fake = storage({ size: PLAN_FILE_MAX_SIZE_BYTES + 1 }, BYTES);
    await expect(readAttestedTakeoffPlan(JOB_ID, FILE_ID)).rejects.toMatchObject({ status: 404 });
    expect(fake.storageCalls.map((call) => call.method)).toEqual(["info"]);
  });

  it("refuses an object whose size changed between the check and the read", async () => {
    storage({ size: BYTES.byteLength }, new TextEncoder().encode("%PDF-1.4 plan fictif remplacé"));
    await expect(readAttestedTakeoffPlan(JOB_ID, FILE_ID)).rejects.toMatchObject({ status: 404 });
  });

  it("refuses an object the storage cannot describe", async () => {
    const fake = storage(null, BYTES);
    await expect(readAttestedTakeoffPlan(JOB_ID, FILE_ID)).rejects.toMatchObject({ status: 404 });
    expect(fake.storageCalls.map((call) => call.method)).toEqual(["info"]);
  });
});
