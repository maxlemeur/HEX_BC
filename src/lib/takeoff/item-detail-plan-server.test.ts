import { beforeEach, describe, expect, it, vi } from "vitest";

import { createInMemoryRestApi } from "@/test/in-memory-rest-api";

// The server resolution of the plan a detail of an item shows (lot 5). Ways it could show the wrong bytes or the wrong
// affaire's plan, written with the resolver:
// - a reading of another affaire, or a plan that reading did not read, answered as if it belonged here;
// - a superseded reading shown on the dossier's current copy instead of the copy it sealed;
// - a version-launched analysis never sent served attested bytes it never attested;
// - a plan of the dossier with several current copies, none, or since replaced (another generation) drawn anyway;
// - a key foreign to the dossier answered instead of « not found ».
// Review of PR 2, written before the fixes:
// - the module turned off for the tenant still answered (both byte routes refuse);
// - a sealed copy whose row is gone answered « attested », and a copy the member may not read « no copy »;
// - a date shown as a generation;
// - `source` naming a copy dropped in a plan set, a copy named alone when its piece has two current copies, and the name of
//   a deleted piece.
// The member's session and the service's are two in-memory REST APIs over fictional rows; the plan centre's own read
// (getPlanFileDetail) runs on the member's.

const TENANT = "10000000-0000-4000-8000-000000000001";
const MEMBER = "10000000-0000-4000-8000-0000000000aa";
const PROJECT = "20000000-0000-4000-8000-000000000002";
const OTHER_PROJECT = "20000000-0000-4000-8000-000000000003";
const SET = "30000000-0000-4000-8000-000000000004";
const JOB = "40000000-0000-4000-8000-000000000005";
const FOREIGN_JOB = "40000000-0000-4000-8000-000000000006";
const VERSION_JOB = "40000000-0000-4000-8000-000000000007";
const PIECE = "50000000-0000-4000-8000-000000000008";
const LONE_PIECE = "50000000-0000-4000-8000-000000000009";
const DELETED_PIECE = "50000000-0000-4000-8000-00000000000f";
const COPY_A = "60000000-0000-4000-8000-00000000000a";
const COPY_B = "60000000-0000-4000-8000-00000000000b";
const UPLOAD = "60000000-0000-4000-8000-00000000000c";
const FOREIGN_COPY = "60000000-0000-4000-8000-00000000000d";
const FOREIGN_PIECE = "50000000-0000-4000-8000-0000000000ff";
const ITEM = "70000000-0000-4000-8000-000000000011";
const OTHER_ITEM = "70000000-0000-4000-8000-000000000012";
const DIGEST = "a".repeat(64);
const STAMP = "2026-11-19T08:00:00.000Z";

const { access, service } = vi.hoisted(() => ({
  access: { member: null as unknown, disabled: false },
  service: { current: null as unknown },
}));
vi.mock("@/lib/affaires/access-server", () => ({
  requireAffaireAccess: vi.fn(async (projectId: string) => {
    if (projectId !== PROJECT) {
      const { notFound } = await import("@/lib/http/api-error");
      throw notFound("Affaire introuvable.");
    }
    return { context: { supabase: access.member, tenantId: TENANT, userId: MEMBER, tenantRole: "director" }, project: { id: PROJECT } };
  }),
}));
vi.mock("@/lib/takeoff/job-read-server", async (original) => ({
  ...(await original<typeof import("@/lib/takeoff/job-read-server")>()),
  getAuthenticatedTakeoffContext: vi.fn(async () => {
    if (access.disabled) {
      const { forbidden } = await import("@/lib/http/api-error");
      throw forbidden("Le module Takeoff est désactivé pour ce tenant.", undefined, "TAKEOFF_MODULE_DISABLED");
    }
    return { supabase: access.member, tenantId: TENANT, userId: MEMBER, tenantRole: "director" };
  }),
}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => service.current }));

import { resolveItemDetailPlan } from "@/lib/takeoff/item-detail-plan-server";
import { createTakeoffPreparationSnapshot, takeoffPreparationSourceSchema } from "@/lib/takeoff/preparation";
import { confirmedPreparationFixture } from "@/lib/takeoff/preparation.test-utils";
import { buildPlanFileStoragePath } from "@/lib/takeoff/plan-file-display-name";

/** A confirmed preparation sealing these plan copies of the plan set (the real snapshot builder, fictional values). */
function snapshot(sources: Array<{ id: string; name: string; pages?: number[] }>) {
  const confirmed = confirmedPreparationFixture();
  const preparation = { ...confirmed.preparation, sources: sources.map((source) => takeoffPreparationSourceSchema.parse({
    document_id: source.id, document_name: source.name, kind: "plan", revision: "A", source_version: "v1",
    pages: source.pages ?? [], active: true, confirmed: true, plan_set_id: SET,
    file_path: pathOf(source.id), page_count: 9, content_hash: DIGEST, source_updated_at: STAMP, mime_type: "application/pdf",
  })) };
  return createTakeoffPreparationSnapshot({ preparation, confirmedBy: TENANT, confirmedAt: "2026-11-20T10:00:00.000Z", revision: 1 });
}

const pathOf = (fileId: string) => buildPlanFileStoragePath({ tenantId: TENANT, setId: SET, fileId, fileName: `${fileId}.pdf` });

type Copy = {
  id: string;
  current: boolean;
  generation?: string;
  piece?: string;
  /** The plan centre's rule hides the copy's row from this member (a director who is not the owner). */
  hidden?: boolean;
  /** The copy's row is gone (only its recorded source remains). */
  gone?: boolean;
  /** A dossier copy whose piece belongs to another affaire: its source was never recorded here. */
  foreignPiece?: string;
};

function planFileRow(copy: Copy) {
  return { id: copy.id, created_at: STAMP, updated_at: STAMP, tenant_id: TENANT, plan_set_id: SET, file_path: pathOf(copy.id),
    file_name: `${copy.id}.pdf`, file_type: "application/pdf", file_size_bytes: 1000, page_count: 9, file_hash: null,
    metadata: {
      ...(copy.piece || copy.foreignPiece ? { source: "affaire-intake", intake_document_id: copy.piece ?? copy.foreignPiece } : {}),
      ...(copy.generation ? { intake_generation: copy.generation } : {}),
    }, created_by: null };
}

const pieces = [
  { id: PIECE, tenant_id: TENANT, project_id: PROJECT, file_name: "Plan RDC.pdf", document_kind: "plans", upload_status: "uploaded",
    deleted_at: null, deletion_token: null },
  { id: LONE_PIECE, tenant_id: TENANT, project_id: PROJECT, file_name: "Plan R+1.pdf", document_kind: "plans", upload_status: "uploaded",
    deleted_at: null, deletion_token: null },
  { id: DELETED_PIECE, tenant_id: TENANT, project_id: PROJECT, file_name: "Plan supprimé.pdf", document_kind: "plans",
    upload_status: "uploaded", deleted_at: STAMP, deletion_token: null },
  { id: FOREIGN_PIECE, tenant_id: TENANT, project_id: OTHER_PROJECT, file_name: "Plan d’une autre affaire.pdf", document_kind: "plans",
    upload_status: "uploaded", deleted_at: null, deletion_token: null },
];

/**
 * The rows of both sessions. `signing`: what Storage answers the member's signing request (ok, an answer shaped as a
 * missing object, an explicit denial, or no answer at all); `stored`: whether the object exists, as the service sees it.
 */
/** The answers a job published, by item and plan (its logical identity): by default the item read by both jobs. */
type Answer = { job: string; item: string; plan: string };
const ANSWERED: Answer[] = [JOB, VERSION_JOB].flatMap((job) => [PIECE, COPY_A].map((plan) => ({ job, item: ITEM, plan })));

function stage(input: { copies: Copy[]; sent?: boolean; itemSend?: boolean; signing?: "ok" | "missing" | "denied" | "transport"; stored?: boolean;
  answers?: Answer[] }) {
  const jobs = [
    { id: JOB, tenant_id: TENANT, project_id: PROJECT, plan_set_id: SET, estimate_version_id: null, status: "succeeded",
      completed_at: "2026-11-20T11:00:00.000Z", preparation_snapshot: snapshot([{ id: COPY_A, name: "Plan RDC indice A.pdf", pages: [7, 2] }]) },
    { id: FOREIGN_JOB, tenant_id: TENANT, project_id: OTHER_PROJECT, plan_set_id: SET, estimate_version_id: null, status: "succeeded",
      completed_at: null, preparation_snapshot: snapshot([{ id: COPY_A, name: "Plan RDC indice A.pdf" }]) },
    { id: VERSION_JOB, tenant_id: TENANT, project_id: PROJECT, plan_set_id: SET, estimate_version_id: "70000000-0000-4000-8000-00000000000d",
      status: "succeeded", completed_at: null, preparation_snapshot: snapshot([{ id: COPY_A, name: "Plan RDC indice A.pdf" }]) },
  ];
  const set = { id: SET, created_at: STAMP, updated_at: STAMP, tenant_id: TENANT, project_id: PROJECT, estimate_version_id: null,
    name: "Plans", description: null, metadata: {}, created_by: null };
  const present = input.copies.filter((copy) => !copy.gone);
  const member = createInMemoryRestApi({
    takeoff_jobs: jobs,
    plan_files: present.filter((copy) => !copy.hidden).map(planFileRow),
    plan_sets: [set],
    takeoff_item_send_receipts: input.itemSend ? [{ id: "s", tenant_id: TENANT, job_id: VERSION_JOB, command_kind: "send" }] : [],
    takeoff_send_receipts: input.sent ? [{ id: "r", tenant_id: TENANT, job_id: VERSION_JOB, command_kind: "send" }] : [],
    affaire_intake_documents: pieces,
    takeoff_item_answers: (input.answers ?? ANSWERED).map((answer, index) => ({ id: `answer-${index}`, tenant_id: TENANT, project_id: PROJECT,
      job_id: answer.job, item_id: answer.item, plan_logical_id: answer.plan, searched_pages: [7, 2], unreadable_pages: [9, 7] })),
  }, {
    "rpc/read_takeoff_plan_location_source": () => {
      const body = member.requests.at(-1)!.body as { p_plan_file_id: string };
      const copy = present.find(({ id }) => id === body.p_plan_file_id);
      return copy ? [{ source_kind: copy.piece ? "intake_document" : "plan_file", source_id: copy.piece ?? copy.id,
        plan_file_id: copy.id, current_copy: copy.current, can_write: false }] : [];
    },
  }, (url) => {
    if (input.signing === "transport") throw new TypeError("fetch failed");
    if (input.signing === "missing") {
      return new Response(JSON.stringify({ statusCode: "404", error: "not_found", message: "Object not found" }), { status: 400 });
    }
    if (input.signing === "denied") {
      return new Response(JSON.stringify({ statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" }),
        { status: 400 });
    }
    return new Response(JSON.stringify({ signedURL: `${url.pathname.replace("/storage/v1", "")}?token=fictional` }), { status: 200 });
  });
  const sources = createInMemoryRestApi({
    plan_sets: [set],
    plan_files: present.map(planFileRow),
    takeoff_plan_location_sources: input.copies.filter((copy) => !copy.foreignPiece).map((copy) => ({ plan_file_id: copy.id,
      tenant_id: TENANT, plan_set_id: SET, project_id: PROJECT, source_kind: copy.piece ? "intake_document" : "plan_file",
      source_id: copy.piece ?? copy.id, recorded_at: STAMP })),
  }, {}, (url) => (input.stored === false
    ? new Response(JSON.stringify({ statusCode: "404", error: "not_found", message: "Object not found" }), { status: 400 })
    : new Response(JSON.stringify({ id: "o", name: url.pathname, size: 1000 }), { status: 200 })));
  access.member = member.client;
  service.current = sources.client;
  return member;
}

const reading = (jobId: string, planKey: string, itemId: string | null = ITEM) =>
  resolveItemDetailPlan(PROJECT, { itemId, planKey, jobId, source: null });
const dossier = (planKey: string) => resolveItemDetailPlan(PROJECT, { itemId: ITEM, planKey, jobId: null, source: null });
const piece = (documentId: string, generation: string | null = null) =>
  resolveItemDetailPlan(PROJECT, { itemId: ITEM, planKey: null, jobId: null, source: { documentId, generation } });
const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: { status: number; code: string }) =>
  ({ status: error.status, code: error.code }));

beforeEach(() => {
  access.member = null;
  access.disabled = false;
  service.current = null;
});

// Review of #483 (written before the fix): a job that read only another item on the plan was resolved for any item, and
// shown as this item's earlier reading. A reading is resolved for an item only when that job answered it on that plan.
describe("resolveItemDetailPlan, a reading of the item asked", () => {
  it("resolves a reading only for an item its job answered on that plan, and asks for the item", async () => {
    stage({ copies: [{ id: COPY_A, current: true, piece: PIECE }], answers: [{ job: JOB, item: OTHER_ITEM, plan: PIECE }] });
    expect(await failure(reading(JOB, PIECE))).toEqual({ status: 404, code: "TAKEOFF_ITEM_DETAIL_READING_NOT_FOUND" });
    expect(await reading(JOB, PIECE, OTHER_ITEM)).toMatchObject({ reading: { jobId: JOB }, document: { kind: "attested" } });
    expect(await failure(reading(JOB, PIECE, null))).toEqual({ status: 422, code: "TAKEOFF_ITEM_DETAIL_ADDRESS_INVALID" });
  });
});

describe("resolveItemDetailPlan, the rights of the routes that serve the bytes", () => {
  it("answers nothing while the takeoff module is turned off for the tenant, as both byte routes", async () => {
    stage({ copies: [{ id: COPY_A, current: true, piece: PIECE }] });
    access.disabled = true;
    expect(await failure(reading(JOB, PIECE))).toEqual({ status: 403, code: "TAKEOFF_MODULE_DISABLED" });
    expect(await failure(dossier(PIECE))).toEqual({ status: 403, code: "TAKEOFF_MODULE_DISABLED" });
  });

  // Review of PR 2 (written before the fix): a hidden sealed copy still gave its generation from the service's row.
  it("returns nothing of a sealed copy the member may not read but « not available to you »", async () => {
    stage({ copies: [{ id: COPY_A, current: true, generation: "1", piece: PIECE, hidden: true }] });
    expect(await reading(JOB, PIECE)).toMatchObject({ plan: { generation: null }, document: { kind: "unavailable", reason: "not_available_to_you" } });
  });

  // Review of PR 2 (written before the fix): an explicit signing denial was a 500, an answer shaped as a missing object
  // was « no copy » even for an object Storage hides from the member.
  it("says why a current copy cannot be signed: not available to you, missing bytes, or a failure to retry", async () => {
    const copies = [{ id: COPY_A, current: true, piece: PIECE }];
    stage({ copies, signing: "denied" });
    expect((await dossier(PIECE)).document).toEqual({ kind: "unavailable", reason: "not_available_to_you" });
    stage({ copies, signing: "missing", stored: true });
    expect((await dossier(PIECE)).document).toEqual({ kind: "unavailable", reason: "not_available_to_you" });
    stage({ copies, signing: "missing", stored: false });
    expect((await dossier(PIECE)).document).toEqual({ kind: "unavailable", reason: "copy_missing" });
    stage({ copies, signing: "transport" });
    expect(await failure(dossier(PIECE))).toEqual({ status: 503, code: "TAKEOFF_ITEM_DETAIL_PLAN_RETRY" });
  });

  // Review of PR 2 (written before the fix): a copy whose dossier piece belongs to another affaire was read as an upload
  // and named, while its piece was not found.
  it("confirms nothing of a copy whose dossier piece belongs to another affaire, by the copy or by its piece", async () => {
    stage({ copies: [{ id: FOREIGN_COPY, current: true, foreignPiece: FOREIGN_PIECE }] });
    expect(await failure(dossier(FOREIGN_COPY))).toEqual({ status: 404, code: "TAKEOFF_ITEM_DETAIL_PLAN_NOT_FOUND" });
    expect(await failure(dossier(FOREIGN_PIECE))).toEqual({ status: 404, code: "TAKEOFF_ITEM_DETAIL_PLAN_NOT_FOUND" });
    expect(await failure(piece(FOREIGN_PIECE))).toEqual({ status: 404, code: "TAKEOFF_ITEM_DETAIL_PLAN_NOT_FOUND" });
  });

  it("says « not available to you », apart from « no copy », for a current copy the plan centre does not serve this member", async () => {
    stage({ copies: [{ id: COPY_A, current: false, piece: PIECE }, { id: COPY_B, current: true, piece: PIECE, hidden: true }] });
    expect(await dossier(PIECE)).toMatchObject({ plan: { key: PIECE, name: "Plan RDC.pdf", planFileId: null },
      document: { kind: "unavailable", reason: "not_available_to_you" } });
    stage({ copies: [{ id: COPY_A, current: true, piece: PIECE, hidden: true }] });
    expect((await reading(JOB, PIECE)).document).toEqual({ kind: "unavailable", reason: "not_available_to_you" });
  });
});

describe("resolveItemDetailPlan, a reading", () => {
  // Follow-ups of lot 5: the reading proved the job answered the item on that plan, and names that answer, with the pages
  // it covered (its marks' scope): an earlier reading shows its own marks, read only.
  it("shows the copy the reading sealed, by its piece or its copy, with its digest, pages, attested bytes and answer", async () => {
    stage({ copies: [{ id: COPY_A, current: false, generation: "1", piece: PIECE }, { id: COPY_B, current: true, generation: "2", piece: PIECE }] });
    const expected = {
      plan: { key: PIECE, name: "Plan RDC indice A.pdf", planFileId: COPY_A, generation: "1", contentSha256: DIGEST, pageCount: 9,
        pagesRead: [2, 7] },
      reading: { jobId: JOB, status: "succeeded", finishedAt: "2026-11-20T11:00:00.000Z",
        answer: { answerId: "answer-0", scopePages: [2, 7, 9] } },
      document: { kind: "attested", href: `/api/takeoff/jobs/${JOB}/vector-plans/${COPY_A}` },
    };
    // Superseded since (copy B is the dossier's now): the reading still shows what it read.
    expect(await reading(JOB, PIECE)).toEqual(expected);
    expect(await reading(JOB, COPY_A.toUpperCase())).toEqual(expected);
  });

  it("does not claim attested bytes once the sealed copy's row is gone, nor a date as a generation", async () => {
    stage({ copies: [{ id: COPY_A, current: false, piece: PIECE, gone: true }] });
    expect(await reading(JOB, PIECE)).toMatchObject({ plan: { generation: null }, document: { kind: "unavailable", reason: "original_unavailable" } });
    stage({ copies: [{ id: COPY_A, current: true, piece: PIECE }] });
    expect(await reading(JOB, PIECE)).toMatchObject({ plan: { generation: null }, document: { kind: "attested" } });
  });

  it("finds neither a reading of another affaire nor a plan that reading did not read", async () => {
    stage({ copies: [{ id: COPY_A, current: true, piece: PIECE }] });
    expect(await failure(reading(FOREIGN_JOB, PIECE))).toEqual({ status: 404, code: "TAKEOFF_ITEM_DETAIL_READING_NOT_FOUND" });
    expect(await failure(reading(JOB, LONE_PIECE))).toEqual({ status: 404, code: "TAKEOFF_ITEM_DETAIL_PLAN_NOT_FOUND" });
    expect(await failure(resolveItemDetailPlan(OTHER_PROJECT, { itemId: ITEM, planKey: PIECE, jobId: FOREIGN_JOB, source: null })))
      .toEqual({ status: 404, code: "NOT_FOUND" });
  });

  it("serves the same attested sheet to the member after an item send", async () => {
    stage({ copies: [{ id: COPY_A, current: true, piece: PIECE }], itemSend: true });
    expect((await reading(VERSION_JOB, PIECE)).document).toEqual({ kind: "attested",
      href: `/api/takeoff/jobs/${VERSION_JOB}/vector-plans/${COPY_A}` });
  });

  it("serves a version-launched analysis's bytes only once it was sent", async () => {
    stage({ copies: [{ id: COPY_A, current: true, piece: PIECE }] });
    expect((await reading(VERSION_JOB, PIECE)).document).toEqual({ kind: "unavailable", reason: "original_unavailable" });
    stage({ copies: [{ id: COPY_A, current: true, piece: PIECE }], sent: true });
    expect((await reading(VERSION_JOB, PIECE)).document).toEqual({ kind: "attested",
      href: `/api/takeoff/jobs/${VERSION_JOB}/vector-plans/${COPY_A}` });
  });
});

describe("resolveItemDetailPlan, a plan of the dossier", () => {
  it("shows the one current copy of the plan's piece, for its generation, by the plan centre's signed address", async () => {
    stage({ copies: [{ id: COPY_A, current: false, generation: "1", piece: PIECE }, { id: COPY_B, current: true, generation: "2", piece: PIECE }] });
    expect(await dossier(PIECE)).toEqual({
      plan: { key: PIECE, name: "Plan RDC.pdf", planFileId: COPY_B, generation: "2", contentSha256: null, pageCount: 9, pagesRead: [] },
      reading: null,
      document: { kind: "dossier", planSetId: SET, planFileId: COPY_B,
        url: expect.stringMatching(new RegExp(`^https://example\\.test/storage/v1/object/sign/plan-files/.*${COPY_B}.*token=fictional`)) },
    });
    expect((await piece(PIECE, "2")).document).toMatchObject({ kind: "dossier", planFileId: COPY_B });
    expect((await piece(PIECE, "1")).document).toEqual({ kind: "unavailable", reason: "generation_replaced" });
  });

  it("draws nothing when the piece has several current copies, or none, even when one copy is named", async () => {
    stage({ copies: [{ id: COPY_A, current: true, piece: PIECE }, { id: COPY_B, current: true, piece: PIECE }] });
    expect(await dossier(PIECE)).toMatchObject({ plan: { planFileId: null }, document: { kind: "unavailable", reason: "several_copies" } });
    expect(await dossier(COPY_A)).toMatchObject({ plan: { key: PIECE, planFileId: null },
      document: { kind: "unavailable", reason: "several_copies" } });
    stage({ copies: [{ id: COPY_A, current: false, piece: PIECE }] });
    expect(await dossier(PIECE)).toMatchObject({ plan: { planFileId: null }, document: { kind: "unavailable", reason: "no_current_copy" } });
    stage({ copies: [{ id: COPY_A, current: true, piece: PIECE }], signing: "missing", stored: false });
    expect((await dossier(PIECE)).document).toEqual({ kind: "unavailable", reason: "copy_missing" });
  });

  it("names a plan of the dossier with no copy yet, and finds nothing for a key foreign to it or a deleted piece", async () => {
    stage({ copies: [{ id: COPY_A, current: true, piece: PIECE }] });
    expect(await dossier(LONE_PIECE)).toEqual({
      plan: { key: LONE_PIECE, name: "Plan R+1.pdf", planFileId: null, generation: null, contentSha256: null, pageCount: null, pagesRead: [] },
      reading: null, document: { kind: "unavailable", reason: "no_current_copy" },
    });
    for (const key of ["80000000-0000-4000-8000-00000000000e", "plan:p-101", DELETED_PIECE]) {
      expect(await failure(dossier(key)), key).toEqual({ status: 404, code: "TAKEOFF_ITEM_DETAIL_PLAN_NOT_FOUND" });
    }
    expect(await failure(piece(DELETED_PIECE))).toEqual({ status: 404, code: "TAKEOFF_ITEM_DETAIL_PLAN_NOT_FOUND" });
  });

  it("shows a copy uploaded to the plan set as its own plan, never as a piece of the dossier", async () => {
    stage({ copies: [{ id: UPLOAD, current: true }] });
    expect(await dossier(UPLOAD)).toMatchObject({ plan: { key: UPLOAD, planFileId: UPLOAD },
      document: { kind: "dossier", planSetId: SET, planFileId: UPLOAD } });
    expect(await failure(piece(UPLOAD))).toEqual({ status: 404, code: "TAKEOFF_ITEM_DETAIL_PLAN_NOT_FOUND" });
  });

  it("refuses a request that names a piece beside a plan or a reading, or a reading without its plan", async () => {
    stage({ copies: [] });
    for (const request of [
      { itemId: ITEM, planKey: PIECE, jobId: null, source: { documentId: PIECE, generation: null } },
      { itemId: ITEM, planKey: null, jobId: JOB, source: null },
      { itemId: ITEM, planKey: null, jobId: null, source: null },
    ]) {
      expect(await failure(resolveItemDetailPlan(PROJECT, request))).toEqual({ status: 422, code: "TAKEOFF_ITEM_DETAIL_ADDRESS_INVALID" });
    }
  });
});
