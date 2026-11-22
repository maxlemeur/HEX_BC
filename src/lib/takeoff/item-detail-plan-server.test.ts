import { beforeEach, describe, expect, it, vi } from "vitest";

import { createInMemoryRestApi } from "@/test/in-memory-rest-api";

// The server resolution of the plan a detail of an item shows (lot 5). Ways it could show the wrong bytes or the wrong
// affaire's plan, written with the resolver:
// - a reading of another affaire, or a plan that reading did not read, answered as if it belonged here;
// - a superseded reading shown on the dossier's current copy instead of the copy it sealed;
// - a version-launched analysis never sent served attested bytes it never attested;
// - a plan of the dossier with several current copies, none, or since replaced (another generation) drawn anyway;
// - a key foreign to the dossier answered instead of « not found ».
// The member's session and the service's are two in-memory REST APIs over fictional rows.

const TENANT = "10000000-0000-4000-8000-000000000001";
const PROJECT = "20000000-0000-4000-8000-000000000002";
const OTHER_PROJECT = "20000000-0000-4000-8000-000000000003";
const SET = "30000000-0000-4000-8000-000000000004";
const JOB = "40000000-0000-4000-8000-000000000005";
const FOREIGN_JOB = "40000000-0000-4000-8000-000000000006";
const VERSION_JOB = "40000000-0000-4000-8000-000000000007";
const PIECE = "50000000-0000-4000-8000-000000000008";
const LONE_PIECE = "50000000-0000-4000-8000-000000000009";
const COPY_A = "60000000-0000-4000-8000-00000000000a";
const COPY_B = "60000000-0000-4000-8000-00000000000b";
const UPLOAD = "60000000-0000-4000-8000-00000000000c";
const DIGEST = "a".repeat(64);

const { access, service } = vi.hoisted(() => ({
  access: { current: null as null | (() => unknown) },
  service: { current: null as unknown },
}));
vi.mock("@/lib/affaires/access-server", () => ({
  requireAffaireAccess: vi.fn(async (projectId: string) => {
    if (projectId !== PROJECT) {
      const { notFound } = await import("@/lib/http/api-error");
      throw notFound("Affaire introuvable.");
    }
    return access.current!();
  }),
}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => service.current }));

import { resolveItemDetailPlan } from "@/lib/takeoff/item-detail-plan-server";
import { createTakeoffPreparationSnapshot, takeoffPreparationSourceSchema } from "@/lib/takeoff/preparation";
import { confirmedPreparationFixture } from "@/lib/takeoff/preparation.test-utils";

/** A confirmed preparation sealing these plan copies of the plan set (the real snapshot builder, fictional values). */
function snapshot(sources: Array<{ id: string; name: string; pages?: number[] }>) {
  const confirmed = confirmedPreparationFixture();
  const preparation = { ...confirmed.preparation, sources: sources.map((source) => takeoffPreparationSourceSchema.parse({
    document_id: source.id, document_name: source.name, kind: "plan", revision: "A", source_version: "v1",
    pages: source.pages ?? [], active: true, confirmed: true, plan_set_id: SET,
    file_path: `${TENANT}/${SET}/${source.id}/${source.name}`, page_count: 9, content_hash: DIGEST,
    source_updated_at: "2026-11-19T08:00:00.000Z", mime_type: "application/pdf",
  })) };
  return createTakeoffPreparationSnapshot({ preparation, confirmedBy: TENANT, confirmedAt: "2026-11-20T10:00:00.000Z", revision: 1 });
}

type Copy = { id: string; current: boolean; generation?: string; piece?: string };

function stage(input: { copies: Copy[]; sent?: boolean }) {
  const jobs = [
    { id: JOB, tenant_id: TENANT, project_id: PROJECT, plan_set_id: SET, estimate_version_id: null, status: "succeeded",
      completed_at: "2026-11-20T11:00:00.000Z", preparation_snapshot: snapshot([{ id: COPY_A, name: "Plan RDC indice A.pdf", pages: [7, 2] }]) },
    { id: FOREIGN_JOB, tenant_id: TENANT, project_id: OTHER_PROJECT, plan_set_id: SET, estimate_version_id: null, status: "succeeded",
      completed_at: null, preparation_snapshot: snapshot([{ id: COPY_A, name: "Plan RDC indice A.pdf" }]) },
    { id: VERSION_JOB, tenant_id: TENANT, project_id: PROJECT, plan_set_id: SET, estimate_version_id: "70000000-0000-4000-8000-00000000000d",
      status: "succeeded", completed_at: null, preparation_snapshot: snapshot([{ id: COPY_A, name: "Plan RDC indice A.pdf" }]) },
  ];
  const files = input.copies.map((copy) => ({ id: copy.id, tenant_id: TENANT, plan_set_id: SET, file_name: `${copy.id}.pdf`,
    page_count: 9, metadata: copy.generation ? { intake_generation: copy.generation } : {} }));
  const member = createInMemoryRestApi({
    takeoff_jobs: jobs,
    plan_files: files,
    plan_sets: [{ id: SET, tenant_id: TENANT, project_id: PROJECT }],
    takeoff_send_receipts: input.sent ? [{ id: "r", tenant_id: TENANT, job_id: VERSION_JOB, command_kind: "send" }] : [],
    affaire_intake_documents: [
      { id: PIECE, tenant_id: TENANT, project_id: PROJECT, file_name: "Plan RDC.pdf", document_kind: "plans" },
      { id: LONE_PIECE, tenant_id: TENANT, project_id: PROJECT, file_name: "Plan R+1.pdf", document_kind: "plans" },
    ],
  }, {
    "rpc/read_takeoff_plan_location_source": () => {
      const body = member.requests.at(-1)!.body as { p_plan_file_id: string };
      const copy = input.copies.find(({ id }) => id === body.p_plan_file_id);
      return copy ? [{ source_kind: copy.piece ? "intake_document" : "plan_file", source_id: copy.piece ?? copy.id,
        plan_file_id: copy.id, current_copy: copy.current, can_write: false }] : [];
    },
  });
  const sources = createInMemoryRestApi({
    takeoff_plan_location_sources: [COPY_A, COPY_B].map((id) => ({ plan_file_id: id, tenant_id: TENANT, plan_set_id: SET,
      project_id: PROJECT, source_kind: "intake_document", source_id: PIECE })),
  });
  access.current = () => ({ context: { supabase: member.client, tenantId: TENANT }, project: { id: PROJECT } });
  service.current = sources.client;
  return member;
}

const reading = (jobId: string, planKey: string) => resolveItemDetailPlan(PROJECT, { planKey, jobId, source: null });
const dossier = (planKey: string) => resolveItemDetailPlan(PROJECT, { planKey, jobId: null, source: null });
const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: { status: number; code: string }) =>
  ({ status: error.status, code: error.code }));

beforeEach(() => {
  access.current = null;
  service.current = null;
});

describe("resolveItemDetailPlan, a reading", () => {
  it("shows the copy the reading sealed, by its piece or its copy, with its digest, pages and attested bytes", async () => {
    stage({ copies: [{ id: COPY_A, current: false, generation: "1", piece: PIECE }, { id: COPY_B, current: true, generation: "2", piece: PIECE }] });
    const expected = {
      plan: { key: PIECE, name: "Plan RDC indice A.pdf", planFileId: COPY_A, generation: "1", contentSha256: DIGEST, pageCount: 9,
        pagesRead: [2, 7] },
      reading: { jobId: JOB, status: "succeeded", finishedAt: "2026-11-20T11:00:00.000Z" },
      document: { kind: "attested", href: `/api/takeoff/jobs/${JOB}/vector-plans/${COPY_A}` },
    };
    // Superseded since (copy B is the dossier's now): the reading still shows what it read.
    expect(await reading(JOB, PIECE)).toEqual(expected);
    expect(await reading(JOB, COPY_A.toUpperCase())).toEqual(expected);
  });

  it("finds neither a reading of another affaire nor a plan that reading did not read", async () => {
    stage({ copies: [{ id: COPY_A, current: true, piece: PIECE }] });
    expect(await failure(reading(FOREIGN_JOB, PIECE))).toEqual({ status: 404, code: "TAKEOFF_ITEM_DETAIL_READING_NOT_FOUND" });
    expect(await failure(reading(JOB, LONE_PIECE))).toEqual({ status: 404, code: "TAKEOFF_ITEM_DETAIL_PLAN_NOT_FOUND" });
    expect(await failure(resolveItemDetailPlan(OTHER_PROJECT, { planKey: PIECE, jobId: FOREIGN_JOB, source: null })))
      .toEqual({ status: 404, code: "NOT_FOUND" });
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
  it("shows the one current copy of the plan's piece, for its generation", async () => {
    stage({ copies: [{ id: COPY_A, current: false, generation: "1", piece: PIECE }, { id: COPY_B, current: true, generation: "2", piece: PIECE }] });
    expect(await dossier(PIECE)).toEqual({
      plan: { key: PIECE, name: `${COPY_B}.pdf`, planFileId: COPY_B, generation: "2", contentSha256: null, pageCount: 9, pagesRead: [] },
      reading: null,
      document: { kind: "dossier", planSetId: SET, planFileId: COPY_B },
    });
    expect((await resolveItemDetailPlan(PROJECT, { planKey: null, jobId: null, source: { documentId: PIECE, generation: "2" } })).document)
      .toEqual({ kind: "dossier", planSetId: SET, planFileId: COPY_B });
    expect((await resolveItemDetailPlan(PROJECT, { planKey: null, jobId: null, source: { documentId: PIECE, generation: "1" } })).document)
      .toEqual({ kind: "unavailable", reason: "generation_replaced" });
  });

  it("draws nothing when the piece has several current copies, or none", async () => {
    stage({ copies: [{ id: COPY_A, current: true, piece: PIECE }, { id: COPY_B, current: true, piece: PIECE }] });
    expect(await dossier(PIECE)).toMatchObject({ plan: { planFileId: null }, document: { kind: "unavailable", reason: "several_copies" } });
    stage({ copies: [{ id: COPY_A, current: false, piece: PIECE }] });
    expect(await dossier(PIECE)).toMatchObject({ plan: { planFileId: null }, document: { kind: "unavailable", reason: "no_current_copy" } });
  });

  it("names a plan of the dossier with no copy yet, and finds nothing for a key foreign to it", async () => {
    stage({ copies: [{ id: COPY_A, current: true, piece: PIECE }] });
    expect(await dossier(LONE_PIECE)).toEqual({
      plan: { key: LONE_PIECE, name: "Plan R+1.pdf", planFileId: null, generation: null, contentSha256: null, pageCount: null, pagesRead: [] },
      reading: null, document: { kind: "unavailable", reason: "no_current_copy" },
    });
    expect(await failure(dossier("80000000-0000-4000-8000-00000000000e"))).toEqual({ status: 404, code: "TAKEOFF_ITEM_DETAIL_PLAN_NOT_FOUND" });
    expect(await failure(dossier("plan:p-101"))).toEqual({ status: 404, code: "TAKEOFF_ITEM_DETAIL_PLAN_NOT_FOUND" });
  });

  it("shows a copy uploaded to the plan set as its own plan", async () => {
    stage({ copies: [{ id: UPLOAD, current: true }] });
    expect(await dossier(UPLOAD)).toMatchObject({ plan: { key: UPLOAD, planFileId: UPLOAD },
      document: { kind: "dossier", planSetId: SET, planFileId: UPLOAD } });
  });

  it("refuses a request that names a piece beside a plan or a reading, or a reading without its plan", async () => {
    stage({ copies: [] });
    for (const request of [
      { planKey: PIECE, jobId: null, source: { documentId: PIECE, generation: null } },
      { planKey: null, jobId: JOB, source: null },
      { planKey: null, jobId: null, source: null },
    ]) {
      expect(await failure(resolveItemDetailPlan(PROJECT, request))).toEqual({ status: 422, code: "TAKEOFF_ITEM_DETAIL_ADDRESS_INVALID" });
    }
  });
});
