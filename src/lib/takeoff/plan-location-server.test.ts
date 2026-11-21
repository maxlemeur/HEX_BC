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
import { createEmptyTakeoffPreparation, createTakeoffPreparationSnapshot, type TakeoffPreparationSource } from "@/lib/takeoff/preparation";

const FILE_ID = "99999999-9999-4999-8999-999999999991";
const NEW_COPY_ID = "99999999-9999-4999-8999-999999999992";
const PIECE_ID = "99999999-9999-4999-8999-999999999993";
const ATTESTATION_ID = "99999999-9999-4999-8999-999999999994";
const ORIGIN_ID = "99999999-9999-4999-8999-999999999995";
const EARLIER_FILE_ID = "99999999-9999-4999-8999-999999999996";
const MANUAL_ID = "99999999-9999-4999-8999-999999999997";
const ALICE = "99999999-9999-4999-8999-9999999999a1";
const BOB = "99999999-9999-4999-8999-9999999999b2";
const EARLIER_HASH = "b".repeat(64);
const BYTES = new Uint8Array([37, 80, 68, 70, 1, 2, 3]);
const HASH = createHash("sha256").update(BYTES).digest("hex");
const canonical = (fileId: string, name = "plan.pdf") => `${M3_TENANT_ID}/${M3_PLAN_SET_ID}/${fileId}/${name}`;

type Setup = {
  files?: Array<Record<string, unknown>>;
  source?: (fileId: string) => Record<string, unknown> | null;
  annotations?: Array<Record<string, unknown>>;
  draft?: unknown;
  profiles?: Array<{ id: string; full_name: string }>;
  download?: () => { data: unknown; error: unknown };
  set?: () => { data: unknown; error: unknown };
};

/** A stored annotation row: an earlier revision's correction unless told otherwise. */
function annotationRow(overrides: Record<string, unknown> = {}) {
  return { id: ORIGIN_ID, source_kind: "plan_file", source_id: FILE_ID, content_hash: EARLIER_HASH, revision: 2,
    building_choice: "value", building: "A", building_carried: false, building_set_by: M3_USER_ID, building_set_at: "2026-11-20T08:00:00Z",
    building_set_revision: 1, level_choice: "value", level: "L02", level_carried: false, level_set_by: M3_USER_ID,
    level_set_at: "2026-11-20T09:00:00Z", level_set_revision: 2, carried_from_id: null, carried_from_revision: null,
    document_name: "P-101_BAT-B_R+1.pdf", updated_by: M3_USER_ID, updated_at: "2026-11-20T09:00:00Z", created_at: "2026-11-20T08:00:00Z",
    ...overrides };
}

/** A dossier piece (PIECE_ID) whose copy FILE_ID is current at first, then replaced by NEW_COPY_ID. */
function rotatingPiece(candidate = NEW_COPY_ID, candidateSource = { source_kind: "intake_document", source_id: PIECE_ID }) {
  let reads = 0;
  return (fileId: string) => {
    if (fileId === FILE_ID) {
      reads += 1;
      return { source_kind: "intake_document", source_id: PIECE_ID, plan_file_id: FILE_ID, current_copy: reads === 1, can_write: true };
    }
    return fileId === candidate ? { ...candidateSource, plan_file_id: fileId, current_copy: true, can_write: true } : null;
  };
}
const pieceCopy = (id: string) => ({ id, plan_set_id: M3_PLAN_SET_ID, file_name: "plan.pdf", file_path: canonical(id), file_size_bytes: BYTES.length,
  page_count: 1, metadata: { source: "affaire-intake", intake_document_id: PIECE_ID } });

/** A plan source of a preparation draft, at the given bytes. */
function planSource(id: string, name: string, contentHash: string, active: boolean): TakeoffPreparationSource {
  return { document_id: id, document_name: name, kind: "plan", revision: "A", source_version: "v", pages: [], active, confirmed: true,
    plan_set_id: M3_PLAN_SET_ID, file_path: canonical(id), page_count: 1, logical_document_id: null, content_hash: contentHash,
    source_updated_at: null, mime_type: "application/pdf", page_triage: null };
}

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
      takeoff_preparations: () => ({ data: setup.draft ? { draft: setup.draft } : null, error: null }),
      takeoff_jobs: () => ({ data: { preparation_snapshot: null }, error: null }),
      profiles: () => ({ data: setup.profiles ?? [], error: null }),
    },
    storage: { "plan-files": () => ({ data: null, error: { message: "member Storage must not be used" } }) },
    rpc: {
      read_takeoff_plan_location_source: (args) => {
        const fileId = (args as { p_plan_file_id: string }).p_plan_file_id;
        const row = setup.source ? setup.source(fileId) : { source_kind: "plan_file", source_id: fileId, plan_file_id: fileId, current_copy: true, can_write: true };
        return { data: row ? [row] : [], error: null };
      },
      set_takeoff_plan_location: setup.set ?? (() => ({ data: null, error: null })),
    },
  });
  const serviceFake = createSupabaseFake({
    storage: { "plan-files": setup.download ?? (() => ({ data: new Blob([BYTES]), error: null })) },
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
      // A real row, whose canonical path holds: only the affaire naming no source keeps its bytes unread.
      plan_files: () => ({ data: { id: FILE_ID, plan_set_id: M3_PLAN_SET_ID, file_name: "plan.pdf", file_path: canonical(FILE_ID),
        file_size_bytes: BYTES.length, page_count: 1, metadata: {} }, error: null }),
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

describe("the digest a save writes", () => {
  // Catches a save that attests the digest the request names instead of the one of the bytes the server reads.
  it("is the one of the bytes the server reads: another digest is refused and nothing is attested", async () => {
    const { memberFake, serviceFake } = harness();
    const otherHash = createHash("sha256").update("other bytes").digest("hex");
    await expect(saveTakeoffPlanFileLocation({ setId: M3_PLAN_SET_ID, fileId: FILE_ID, body: { content_hash: otherHash, expected_revision: 0,
      building: { choice: "value", value: "A" }, level: { choice: "reading", value: null } } }))
      .rejects.toMatchObject({ status: 409, details: { reason: "TAKEOFF_PLAN_LOCATION_REVISION_CHANGED" } });
    expect(serviceFake.rpcCalls).toEqual([]);
    expect(memberFake.rpcCalls.filter((call) => call.fn === "set_takeoff_plan_location")).toEqual([]);
  });
});

describe("a plan file's reading", () => {
  // Catches a reading that takes the row's Storage name for the name the plan was uploaded under: sanitized, « R+1 »
  // becomes « R-1 », another level.
  it("reads no level in the Storage name of a row that names no original upload", async () => {
    harness({ files: [{ id: FILE_ID, plan_set_id: M3_PLAN_SET_ID, file_name: "P-101_BAT-B_R-1.pdf",
      file_path: canonical(FILE_ID, "P-101_BAT-B_R-1.pdf"), file_size_bytes: BYTES.length, page_count: 1, metadata: {} }] });
    vi.mocked(renderPdfPages).mockResolvedValue({ status: "complete", pageCount: 1, timedOut: false, canvasAvailable: false, durationMs: 1,
      missingPages: [], pages: [{ page: 1, text: "", textTruncated: false, regionText: "BÂTIMENT A", image: null, imageIssue: null,
        droppedImages: 0, renderMs: 1, failed: false }] } as never);
    const read = await readTakeoffPlanFileLocation({ setId: M3_PLAN_SET_ID, fileId: FILE_ID });
    expect(read.reading).toMatchObject({ title_block_read: true, level: [], building: [{ value: "A", source: "title_block", pages: [1] }] });
    expect(read.location.level).toMatchObject({ value: null, state: "unknown", candidates: [] });
  });
});

describe("the correction offered from an earlier revision", () => {
  // Written first, failing: an earlier correction that set no value was offered with two empty values, and the
  // dialogue proposed « Valider pour cette version » with nothing to carry.
  it("is offered only when it sets at least one value", async () => {
    harness({ annotations: [annotationRow({ building_choice: "reading", building: null, level_choice: "unknown", level: null })] });
    const read = await readTakeoffPlanFileLocation({ setId: M3_PLAN_SET_ID, fileId: FILE_ID });
    expect(read).toMatchObject({ annotation: null, carry_over: null, location: { level: { value: "L00", origin: "title_block" } } });
  });

  // Written first, failing: the preview credited the last editor of the row, and their date, for both fields.
  it("credits each field to the member who set it", async () => {
    harness({
      annotations: [annotationRow({ building_set_by: ALICE, level_set_by: BOB, updated_by: BOB })],
      profiles: [{ id: ALICE, full_name: "Alice Fictive" }, { id: BOB, full_name: "Bob Fictif" }],
    });
    const read = await readTakeoffPlanFileLocation({ setId: M3_PLAN_SET_ID, fileId: FILE_ID });
    expect(read.carry_over).toMatchObject({ id: ORIGIN_ID, revision: 2,
      building: { value: "A", set_by_name: "Alice Fictive", set_at: "2026-11-20T08:00:00Z" },
      level: { value: "L02", set_by_name: "Bob Fictif", set_at: "2026-11-20T09:00:00Z" } });
  });

  // Written first, failing: the reader validated the decision against every source of the draft, so a plan the member
  // set aside (inactive, an alternate of nothing) still gave its correction through a pair the preparation drops.
  it("comes through a revision decision only between plans the preparation can retain", async () => {
    const draft = (earlierActive: boolean) => {
      const preparation = createEmptyTakeoffPreparation({ estimateVersionId: null });
      preparation.sources = [planSource(EARLIER_FILE_ID, "P-101_BAT-B_R+1.pdf", EARLIER_HASH, earlierActive),
        planSource(FILE_ID, "P-101_BAT-B_R+1_indice-B.pdf", HASH, true)];
      preparation.plan_revision_decisions = [{ left: { document_id: EARLIER_FILE_ID, content_hash: EARLIER_HASH },
        right: { document_id: FILE_ID, content_hash: HASH }, choice: "right" }];
      return preparation;
    };
    const earlier = annotationRow({ source_id: EARLIER_FILE_ID });
    harness({ annotations: [earlier], draft: draft(false) });
    expect(await readTakeoffPlanFileLocation({ setId: M3_PLAN_SET_ID, fileId: FILE_ID })).toMatchObject({ carry_over: null });
    harness({ annotations: [earlier], draft: draft(true) });
    expect(await readTakeoffPlanFileLocation({ setId: M3_PLAN_SET_ID, fileId: FILE_ID })).toMatchObject({
      carry_over: { id: ORIGIN_ID, same_source: false, content_hash: EARLIER_HASH } });
  });
});

describe("a copy the dossier replaces during a read or a save", () => {
  const body = { content_hash: HASH, expected_revision: 0, building: { choice: "value", value: "A" }, level: { choice: "reading", value: null } };
  const replaced = { status: 409, details: { reason: "TAKEOFF_PLAN_LOCATION_SOURCE_STALE",
    replacement: { plan_set_id: M3_PLAN_SET_ID, plan_file_id: NEW_COPY_ID } } };

  // Written first, failing: the cleanup removed the bytes after the row was read, and the member got a 404.
  it("whose bytes are gone by the download says the plan was replaced and names its current copy", async () => {
    harness({ files: [pieceCopy(FILE_ID), pieceCopy(NEW_COPY_ID)], source: rotatingPiece(),
      download: () => ({ data: null, error: { message: "Object not found", status: 404 } }) });
    await expect(readTakeoffPlanFileLocation({ setId: M3_PLAN_SET_ID, fileId: FILE_ID })).rejects.toMatchObject(replaced);
  });

  // Written first, failing: the command refused the stale copy and the member got a 409 without its current copy.
  it("refused by the command says the plan was replaced and names its current copy", async () => {
    harness({ files: [pieceCopy(FILE_ID), pieceCopy(NEW_COPY_ID)], source: rotatingPiece(),
      set: () => ({ data: null, error: { message: "TAKEOFF_PLAN_LOCATION_SOURCE_STALE", code: "40001" } }) });
    await expect(saveTakeoffPlanFileLocation({ setId: M3_PLAN_SET_ID, fileId: FILE_ID, body })).rejects.toMatchObject(replaced);
  });

  // Written first, failing: a plan uploaded outside the dossier whose metadata names the piece was taken for its copy,
  // although its own source is the file itself.
  it("names as current copy only a copy whose resolved source is the same piece", async () => {
    const manual = { ...pieceCopy(MANUAL_ID), file_name: "televerse.pdf", file_path: canonical(MANUAL_ID, "televerse.pdf") };
    harness({ files: [manual], source: rotatingPiece(MANUAL_ID, { source_kind: "plan_file", source_id: MANUAL_ID }) });
    const refusal = await saveTakeoffPlanFileLocation({ setId: M3_PLAN_SET_ID, fileId: FILE_ID, body }).catch((error: unknown) => error);
    expect(refusal).toMatchObject({ status: 409, details: { reason: "TAKEOFF_PLAN_LOCATION_SOURCE_STALE", replacement: null } });
  });
});

describe("a current copy whose bytes the dossier has not uploaded yet", () => {
  // Written first, failing: the sync commits the copy's row before it uploads the bytes, and in between the member got a
  // 404 for the current copy the dialogue had just followed.
  it("is answered as being prepared, to try again in a moment, never as missing", async () => {
    harness({ files: [pieceCopy(FILE_ID)],
      source: () => ({ source_kind: "intake_document", source_id: PIECE_ID, plan_file_id: FILE_ID, current_copy: true, can_write: true }),
      download: () => ({ data: null, error: { message: "Object not found", status: 404 } }) });
    await expect(readTakeoffPlanFileLocation({ setId: M3_PLAN_SET_ID, fileId: FILE_ID })).rejects.toMatchObject({ status: 409,
      message: "La copie de ce plan est en cours de préparation dans le dossier : réessayez dans un instant.",
      details: { reason: "TAKEOFF_PLAN_LOCATION_COPY_PENDING", replacement: { plan_set_id: M3_PLAN_SET_ID, plan_file_id: FILE_ID } } });
  });

  // The counterexample: a plan uploaded outside the dossier whose object is gone is missing, not being prepared.
  it("leaves a missing upload outside the dossier answered as missing", async () => {
    harness({ download: () => ({ data: null, error: { message: "Object not found", status: 404 } }) });
    await expect(readTakeoffPlanFileLocation({ setId: M3_PLAN_SET_ID, fileId: FILE_ID })).rejects.toMatchObject({ status: 404 });
  });
});

describe("a carry the command refuses because another field carries from another origin", () => {
  // Written first, failing: the command's named refusal reached the member as an internal error.
  it("tells the member to type the other field first", async () => {
    harness({ set: () => ({ data: null, error: { message: "TAKEOFF_PLAN_LOCATION_CARRY_OVER_MIXED", code: "22023" } }) });
    await expect(saveTakeoffPlanFileLocation({ setId: M3_PLAN_SET_ID, fileId: FILE_ID, body: { content_hash: HASH, expected_revision: 1,
      building: { choice: "value", value: "A" }, level: { choice: "reading", value: null } } })).rejects.toMatchObject({ status: 422,
      message: "Un autre champ de ce plan est repris d’une autre correction : saisissez-le ou choisissez la lecture du plan avant de reprendre celui-ci." });
  });
});
