import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/job-read-server", () => ({ getAuthenticatedTakeoffContext: vi.fn(), getTakeoffJobDetailByIdOrThrow: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/pdf/page-render-server", () => ({ renderPdfPages: vi.fn() }));
vi.mock("@/lib/takeoff/page-triage-server", () => ({
  TAKEOFF_PAGE_TRIAGE_TEXT: { maxTextItemsPerPage: 1000, textRegion: { x0: 0.8, y0: 0.8, x1: 1, y1: 1, maxChars: 2000 } },
  takeoffPageTriageRenderLimits: () => ({}),
}));

import { renderPdfPages } from "@/lib/pdf/page-render-server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getAuthenticatedTakeoffContext, getTakeoffJobDetailByIdOrThrow } from "@/lib/takeoff/job-read-server";
import { authenticatedContext, createSupabaseFake, filterValue, M3_JOB_ID, M3_PLAN_SET_ID, M3_PROJECT_ID, M3_TENANT_ID, M3_USER_ID,
  type FakeQuery } from "@/lib/takeoff/metre-m3.test-utils";
import { readTakeoffJobPlanLocations, readTakeoffPlanFileLocation, saveTakeoffPlanFileLocation } from "@/lib/takeoff/plan-location-server";
import { createEmptyTakeoffPreparation, createTakeoffPreparationSnapshot } from "@/lib/takeoff/preparation";

const FILE_ID = "99999999-9999-4999-8999-999999999991";
const NEW_COPY_ID = "99999999-9999-4999-8999-999999999992";
const PIECE_ID = "99999999-9999-4999-8999-999999999993";
const ATTESTATION_ID = "99999999-9999-4999-8999-999999999994";
const ORIGIN_ID = "99999999-9999-4999-8999-999999999995";
const BYTES = new Uint8Array([37, 80, 68, 70, 1, 2, 3]);
const HASH = createHash("sha256").update(BYTES).digest("hex");
const canonical = (fileId: string, name = "plan.pdf") => `${M3_TENANT_ID}/${M3_PLAN_SET_ID}/${fileId}/${name}`;

type Setup = {
  files?: Array<Record<string, unknown>>;
  source?: (fileId: string) => Record<string, unknown> | null;
  annotations?: Array<Record<string, unknown>>;
};

function harness(setup: Setup = {}) {
  const files = setup.files ?? [{ id: FILE_ID, plan_set_id: M3_PLAN_SET_ID, file_name: "plan.pdf", file_path: canonical(FILE_ID),
    file_size_bytes: BYTES.length, page_count: 1, metadata: { original_file_name: "P-101_BAT-B.pdf" } }];
  const memberFake = createSupabaseFake({
    tables: {
      plan_sets: () => ({ data: { id: M3_PLAN_SET_ID, project_id: M3_PROJECT_ID }, error: null }),
      plan_files: (query: FakeQuery) => {
        const id = filterValue(query, "id");
        const rows = id ? files.filter((file) => file.id === id) : files;
        return query.cardinality === "maybeSingle" ? { data: rows[0] ?? null, error: null } : { data: rows, error: null, count: rows.length };
      },
      takeoff_plan_locations: () => ({ data: setup.annotations ?? [], error: null, count: (setup.annotations ?? []).length }),
      takeoff_preparations: () => ({ data: null, error: null }),
      takeoff_jobs: () => ({ data: { preparation_snapshot: null }, error: null }),
      profiles: () => ({ data: [], error: null }),
    },
    storage: { "plan-files": () => ({ data: null, error: { message: "member Storage must not be used" } }) },
    rpc: {
      read_takeoff_plan_location_source: (args) => {
        const fileId = (args as { p_plan_file_id: string }).p_plan_file_id;
        const row = setup.source ? setup.source(fileId) : { source_kind: "plan_file", source_id: fileId, plan_file_id: fileId, current_copy: true, can_write: true };
        return { data: row ? [row] : [], error: null };
      },
      set_takeoff_plan_location: () => ({ data: null, error: null }),
    },
  });
  const serviceFake = createSupabaseFake({
    storage: { "plan-files": () => ({ data: new Blob([BYTES]), error: null }) },
    rpc: { attest_takeoff_plan_revision: () => ({ data: ATTESTATION_ID, error: null }) },
  });
  vi.mocked(getAuthenticatedTakeoffContext).mockResolvedValue(authenticatedContext(memberFake, "engineer") as never);
  vi.mocked(createServiceRoleClient).mockReturnValue(serviceFake.client as never);
  return { memberFake, serviceFake };
}

beforeEach(() => {
  vi.mocked(renderPdfPages).mockResolvedValue({ status: "complete", pageCount: 1, timedOut: false, canvasAvailable: false, durationMs: 1,
    missingPages: [], pages: [{ page: 1, text: "", textTruncated: false, regionText: "BÂTIMENT A NIVEAU L00", image: null, imageIssue: null,
      droppedImages: 0, renderMs: 1, failed: false }] } as never);
});

describe("the bytes read for a plan's location", () => {
  // Written before the fix: the service-role download trusted the stored path.
  it("are never read from a stored path outside the plan file's own scope", async () => {
    const { serviceFake } = harness({ files: [{ id: FILE_ID, plan_set_id: M3_PLAN_SET_ID, file_name: "plan.pdf",
      file_path: `${M3_TENANT_ID}/another-set/another-file/plan.pdf`, file_size_bytes: BYTES.length, page_count: 1, metadata: {} }] });
    await expect(readTakeoffPlanFileLocation({ setId: M3_PLAN_SET_ID, fileId: FILE_ID })).rejects.toMatchObject({ status: 404 });
    expect(serviceFake.storageCalls).toEqual([]);
  });

  it("of an analysis's plan are read only once the affaire names its source", async () => {
    const { serviceFake } = harness({ source: () => null });
    vi.mocked(getTakeoffJobDetailByIdOrThrow).mockResolvedValue({ id: M3_JOB_ID, project_id: M3_PROJECT_ID } as never);
    const fake = createSupabaseFake({ tables: {
      takeoff_jobs: () => ({ data: { preparation_snapshot: analysisSnapshot() }, error: null }),
      takeoff_plan_locations: () => ({ data: [], error: null, count: 0 }),
      plan_files: () => ({ data: { file_path: canonical(FILE_ID), file_size_bytes: BYTES.length, metadata: {} }, error: null }),
    }, rpc: { read_takeoff_plan_location_source: () => ({ data: [], error: null }) } });
    vi.mocked(getAuthenticatedTakeoffContext).mockResolvedValue(authenticatedContext(fake, "director") as never);
    const read = await readTakeoffJobPlanLocations(M3_JOB_ID);
    expect(read.plans).toMatchObject([{ plan_file_id: FILE_ID, status: "unavailable", revision: null }]);
    expect(serviceFake.storageCalls).toEqual([]);
  });

  // Written before the fix: the review of an analysis whose copy the dossier replaced only said the plan
  // was no longer available, and offered no way to its current copy.
  it("of an analysis whose copy the dossier replaced name the current copy, and the piece's correction still applies", async () => {
    harness();
    vi.mocked(getTakeoffJobDetailByIdOrThrow).mockResolvedValue({ id: M3_JOB_ID, project_id: M3_PROJECT_ID } as never);
    const annotation = { id: ORIGIN_ID, source_kind: "intake_document", source_id: PIECE_ID, content_hash: HASH, revision: 1,
      building_choice: "value", building: "A", building_carried: false, building_set_by: M3_USER_ID, building_set_at: "2026-11-21T00:00:00Z",
      building_set_revision: 1, level_choice: "reading", level: null, level_carried: false, level_set_by: M3_USER_ID,
      level_set_at: "2026-11-21T00:00:00Z", level_set_revision: 1, carried_from_id: null, carried_from_revision: null,
      document_name: "plan.pdf", updated_by: M3_USER_ID, updated_at: "2026-11-21T00:00:00Z", created_at: "2026-11-21T00:00:00Z" };
    const fake = createSupabaseFake({ tables: {
      takeoff_jobs: () => ({ data: { preparation_snapshot: analysisSnapshot() }, error: null }),
      takeoff_plan_locations: () => ({ data: [annotation], error: null, count: 1 }),
      plan_files: (query: FakeQuery) => filterValue(query, "id") === FILE_ID ? { data: null, error: null }
        : { data: [{ id: NEW_COPY_ID, plan_set_id: M3_PLAN_SET_ID }], error: null },
      profiles: () => ({ data: [], error: null }),
    }, rpc: { read_takeoff_plan_location_source: (args) => {
      const fileId = (args as { p_plan_file_id: string }).p_plan_file_id;
      return { data: [{ source_kind: "intake_document", source_id: PIECE_ID, plan_file_id: fileId, current_copy: fileId === NEW_COPY_ID,
        can_write: true }], error: null };
    } } });
    vi.mocked(getAuthenticatedTakeoffContext).mockResolvedValue(authenticatedContext(fake, "engineer") as never);
    const read = await readTakeoffJobPlanLocations(M3_JOB_ID);
    expect(read.can_edit).toBe(true);
    expect(read.plans).toMatchObject([{ plan_file_id: FILE_ID, status: "unavailable",
      revision: { source_kind: "intake_document", source_id: PIECE_ID, content_hash: HASH },
      replacement: { plan_set_id: M3_PLAN_SET_ID, plan_file_id: NEW_COPY_ID },
      annotation: { id: ORIGIN_ID, building: { choice: "value", value: "A" } }, location: { building: { value: "A", state: "corrected" } } }]);
  });
});

function analysisSnapshot() {
  const preparation = createEmptyTakeoffPreparation({ estimateVersionId: null });
  preparation.objective = "measure_length";
  preparation.objective_confirmed = true;
  preparation.scope = { ...preparation.scope, lots: ["Plomberie"], networks: ["EF"], confirmed: true };
  preparation.conventions = { unit: "m", measurement_basis: "dimensioned", calibration: null, purchase: null, confirmed: true };
  preparation.destination = { kind: "analysis_only", estimate_version_id: null, reviewer: null, confirmed: true };
  preparation.processing = { level: "C", provider: "chatgpt" };
  preparation.sources = [{ document_id: FILE_ID, document_name: "plan.pdf", kind: "plan", revision: "A", source_version: "v", pages: [],
    active: true, confirmed: true, plan_set_id: M3_PLAN_SET_ID, file_path: canonical(FILE_ID), page_count: 1, logical_document_id: null,
    content_hash: HASH, source_updated_at: null, mime_type: "application/pdf", page_triage: null }];
  return createTakeoffPreparationSnapshot({ preparation, revision: 1, confirmedBy: M3_USER_ID, confirmedAt: "2026-11-21T00:00:00Z" });
}

describe("a save of a plan's location", () => {
  const body = { content_hash: HASH, expected_revision: 0, building: { choice: "value", value: "A" }, level: { choice: "unknown", value: null } };

  // Written before the fix: the member's session wrote any digest it was given.
  it("is written on the server's attestation of the bytes it read, never on a digest from the session", async () => {
    const { memberFake, serviceFake } = harness();
    await saveTakeoffPlanFileLocation({ setId: M3_PLAN_SET_ID, fileId: FILE_ID, body });
    expect(serviceFake.rpcCalls).toEqual([{ fn: "attest_takeoff_plan_revision", args: { p_tenant_id: M3_TENANT_ID, p_actor_id: M3_USER_ID,
      p_project_id: M3_PROJECT_ID, p_plan_file_id: FILE_ID, p_content_hash: HASH, p_document_name: "P-101_BAT-B.pdf" } }]);
    expect(memberFake.rpcCalls.filter((call) => call.fn === "set_takeoff_plan_location")).toEqual([{ fn: "set_takeoff_plan_location",
      args: { p_attestation_id: ATTESTATION_ID, p_expected_revision: 0, p_building_choice: "value", p_building: "A",
        p_level_choice: "unknown", p_level: null, p_carried_fields: [] } }]);
  });

  // Written before the fix: only the origin's identifier was checked.
  it("refuses to carry an earlier correction at another generation than the one offered now", async () => {
    harness({ annotations: [{ id: ORIGIN_ID, source_kind: "plan_file", source_id: FILE_ID, content_hash: "a".repeat(64), revision: 4,
      building_choice: "value", building: "A", building_carried: false, building_set_by: M3_USER_ID, building_set_at: "2026-11-21T00:00:00Z",
      building_set_revision: 1, level_choice: "value", level: "L03", level_carried: false, level_set_by: M3_USER_ID,
      level_set_at: "2026-11-21T00:00:00Z", level_set_revision: 4, carried_from_id: null, carried_from_revision: null,
      document_name: "plan.pdf", updated_by: M3_USER_ID, updated_at: "2026-11-21T00:00:00Z", created_at: "2026-11-21T00:00:00Z" }] });
    await expect(saveTakeoffPlanFileLocation({ setId: M3_PLAN_SET_ID, fileId: FILE_ID, body: { ...body,
      level: { choice: "value", value: "L02" }, carried_from: { id: ORIGIN_ID, revision: 3, fields: ["level"] } } }))
      .rejects.toMatchObject({ status: 409, details: { reason: "TAKEOFF_PLAN_LOCATION_ORIGIN_MOVED" } });
  });

  // Written before the fix: a save through a copy the dossier sync removed answered 404.
  it("through a copy the dossier replaced says so and names the current copy", async () => {
    harness({
      files: [{ id: NEW_COPY_ID, plan_set_id: M3_PLAN_SET_ID, file_name: "plan.pdf", file_path: canonical(NEW_COPY_ID),
        file_size_bytes: BYTES.length, page_count: 1, metadata: { source: "affaire-intake", intake_document_id: PIECE_ID } }],
      source: (fileId) => ({ source_kind: "intake_document", source_id: PIECE_ID, plan_file_id: fileId,
        current_copy: fileId === NEW_COPY_ID, can_write: true }),
    });
    await expect(saveTakeoffPlanFileLocation({ setId: M3_PLAN_SET_ID, fileId: FILE_ID, body })).rejects.toMatchObject({
      status: 409, details: { reason: "TAKEOFF_PLAN_LOCATION_SOURCE_STALE", replacement: { plan_set_id: M3_PLAN_SET_ID, plan_file_id: NEW_COPY_ID } },
    });
  });
});
