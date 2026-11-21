import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTakeoffExecutionSelection } from "@/lib/ai/chatgpt-takeoff";
import { renderPdfPages } from "@/lib/pdf/page-render-server";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createEmptyTakeoffPreparation, createTakeoffPreparationSnapshot } from "@/lib/takeoff/preparation";
import { confirmedPreparationFixture } from "@/lib/takeoff/preparation.test-utils";
import { assertConfirmedTakeoffPreparation as assertConfirmedTakeoffPreparationServer, confirmTakeoffPreparation, loadTakeoffPreparation, saveTakeoffPreparation } from "@/lib/takeoff/preparation-server";
import type { PreparationRecordRow } from "@/lib/takeoff/preparation-repository";
import { toPreparationPlanSource, toPreparationIntakeSource, type PreparationPlanFile, type PreparationIntakeDocument } from "@/lib/takeoff/preparation-sources";
import { hasTakeoffPreparationCopyReceipt } from "@/lib/takeoff/preparation-copy-provenance-server";
import { authenticatedContext, createSupabaseFake, filterValue, M3_PLAN_SET_ID, M3_PROJECT_ID, M3_TENANT_ID, M3_USER_ID, M3_VERSION_ID } from "@/lib/takeoff/metre-m3.test-utils";

vi.mock("@/lib/ai/chatgpt-takeoff", () => ({ getTakeoffExecutionSelection: vi.fn() }));
vi.mock("@/lib/pdf/page-render-server", () => ({ renderPdfPages: vi.fn() }));
vi.mock("@/lib/auth/tenant-context", () => ({ getAuthenticatedContext: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/takeoff/preparation-assistance-server", () => ({ generateTakeoffPreparationAssistance: vi.fn() }));
vi.mock("@/lib/takeoff/preparation-copy-provenance-server", () => ({ hasTakeoffPreparationCopyReceipt: vi.fn().mockResolvedValue(false) }));

function assertConfirmedTakeoffPreparation(input: Omit<Parameters<typeof assertConfirmedTakeoffPreparationServer>[0], "level" | "provider"> & Partial<Pick<Parameters<typeof assertConfirmedTakeoffPreparationServer>[0], "level" | "provider">>) {
  return assertConfirmedTakeoffPreparationServer({ level: "B", provider: "auto", ...input });
}

function fixture() {
  let record: PreparationRecordRow | null = null;
  let targetProjectId = M3_PROJECT_ID;
  let missingMigration = false;
  let onDownload = () => {};
  const intake: PreparationIntakeDocument[] = [];
  const content = Buffer.from("fictitious confirmed source bytes");
  const file: PreparationPlanFile = {
    id: "77777777-7777-4777-8777-777777777777", plan_set_id: M3_PLAN_SET_ID,
    file_name: "Plan fictif.pdf", file_path: `${M3_TENANT_ID}/plan.pdf`, file_size_bytes: content.length,
    file_hash: null, page_count: 1, updated_at: "2026-10-29T00:00:00Z", metadata: { revision: "A" },
  };
  const files = [file];
  const contents = new Map([[file.file_path!, content]]);
  const user = createSupabaseFake({
    tables: {
      estimate_projects: (query) => ({ data: filterValue(query, "id") === M3_PROJECT_ID && filterValue(query, "tenant_id") === M3_TENANT_ID ? { id: M3_PROJECT_ID } : null, error: null }),
      estimate_versions: () => ({ data: { id: M3_VERSION_ID, project_id: targetProjectId, parent_version_id: null }, error: null }),
      plan_sets: () => {
        const ids = [...new Set(files.map(({ plan_set_id }) => plan_set_id))];
        return { data: ids.map((id) => ({ id })), error: null, count: ids.length };
      },
      plan_files: () => ({ data: files, error: null, count: files.length }),
      affaire_briefs: () => ({ data: null, error: null }),
      affaire_intake_documents: () => ({ data: intake, error: null, count: intake.length }),
      takeoff_preparations: () => ({ data: record, error: missingMigration ? { code: "42P01", message: "missing table" } : null }),
    },
    storage: {
      "plan-files": ({ paths }) => { onDownload(); return { data: new Blob([contents.get(paths[0]) ?? content]), error: null }; },
      "affaire-intake": () => ({ data: new Blob(["CCTP fictif : lot plomberie."]), error: null }),
    },
  });
  const server = createSupabaseFake({ tables: {
    takeoff_preparations: (query) => {
      const expected = filterValue(query, "revision");
      if ((query.operation === "insert" && record) || (query.operation === "update" && record?.revision !== expected)) {
        return { data: null, error: query.operation === "insert" ? { code: "23505", message: "already exists" } : null };
      }
      record = query.payload as PreparationRecordRow;
      return { data: record, error: null };
    },
  } });
  const context = authenticatedContext(user) as unknown as Awaited<ReturnType<typeof getAuthenticatedContext>>;
  vi.mocked(getAuthenticatedContext).mockResolvedValue(context);
  vi.mocked(createServiceRoleClient).mockReturnValue(server.client as never);
  const ready = confirmedPreparationFixture().preparation;
  ready.objective = "count";
  ready.processing = { level: "B", provider: "auto" };
  ready.sources = [{ ...toPreparationPlanSource(file), active: true, confirmed: true }];
  return {
    user, server, context, file, files, contents, ready, content, intake, getRecord: () => record,
    seedRecord: (row: PreparationRecordRow) => { record = row; },
    setTargetProject: (id: string) => { targetProjectId = id; },
    setMissingMigration: () => { missingMigration = true; },
    onDownload: (callback: () => void) => { onDownload = callback; },
  };
}

const selection = { profileId: "alice", model: "gpt-5.4", reasoningEffort: "medium", hostId: "mac", authorizationId: "connexion-alice" } as const;
const observedFingerprint = createHash("sha256").update(JSON.stringify([selection.profileId, selection.hostId, selection.model, selection.reasoningEffort])).digest("hex");
const confirmation = { projectId: M3_PROJECT_ID, expectedRevision: 1, expectedExecutionFingerprint: observedFingerprint };
const OTHER_PLAN_SET_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** A second plan set of the same affaire, with one plan of its own. */
function addOtherPlanSet(f: ReturnType<typeof fixture>) {
  const plan = { ...f.file, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", plan_set_id: OTHER_PLAN_SET_ID,
    file_name: "Plan autre jeu.pdf", file_path: `${M3_TENANT_ID}/plan-autre-jeu.pdf`, metadata: { revision: "C" } };
  f.files.push(plan);
  f.contents.set(plan.file_path, Buffer.from("plan of the other set"));
  return plan;
}

/** What the launch dialog does when a plan set is selected: open it, save the deduced draft, confirm. */
async function confirmPlanSet(planSetId: string) {
  const opened = await loadTakeoffPreparation(M3_PROJECT_ID, planSetId);
  const saved = await saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft: opened.draft, expectedRevision: opened.revision });
  return confirmTakeoffPreparation({ ...confirmation, expectedRevision: saved.revision! });
}

function launchPlanSet(f: ReturnType<typeof fixture>, planSetId: string, preparationRevision: number | null) {
  return assertConfirmedTakeoffPreparation({ context: f.context, estimateVersionId: M3_VERSION_ID, planSetId,
    preparationRevision, level: "C", provider: "chatgpt" });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getTakeoffExecutionSelection).mockResolvedValue(selection);
  vi.mocked(renderPdfPages).mockResolvedValue({ pages: [{ regionText: "" }] } as never);
});

describe("persisted preparation server boundary", () => {
  it("requires a new click when the ChatGPT model changes after the recap", async () => {
    const f = fixture();
    const { draft } = await loadTakeoffPreparation(M3_PROJECT_ID, M3_PLAN_SET_ID);
    await saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft, expectedRevision: null });
    vi.mocked(getTakeoffExecutionSelection).mockResolvedValue({ ...selection, model: "gpt-5.5" });
    await expect(confirmTakeoffPreparation(confirmation)).rejects.toMatchObject({ status: 409 });
    expect(f.getRecord()?.confirmed_snapshot).toBeNull();
  });

  it("reopens selection for a plan and CCTP added before the first save", async () => {
    const f = fixture();
    const { draft } = await loadTakeoffPreparation(M3_PROJECT_ID, M3_PLAN_SET_ID);
    f.files.push({ ...f.file, id: "88888888-8888-4888-8888-888888888888", file_name: "Plan B.pdf" });
    f.intake.push({ id: "99999999-9999-4999-8999-999999999999", file_name: "CCTP.txt",
      storage_path: `${M3_TENANT_ID}/CCTP.txt`, document_kind: "cctp", mime_type: "text/plain", size_bytes: 10, updated_at: "2026-11-20T00:00:00Z" });
    await expect(saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft, expectedRevision: null })).rejects.toMatchObject({ status: 409 });
    expect(f.getRecord()).toBeNull();
    const refreshed = await loadTakeoffPreparation(M3_PROJECT_ID, M3_PLAN_SET_ID);
    expect(refreshed.draft.sources.filter(({ active }) => active).map(({ document_name }) => document_name))
      .toEqual(expect.arrayContaining(["Plan fictif.pdf", "Plan B.pdf", "CCTP.txt"]));
  });

  it.each(["cctp", "dpgf"])("treats an attachment reclassified as %s as a new dossier piece", async (kind) => {
    const f = fixture();
    const attachment = { id: "99999999-9999-4999-8999-999999999999", file_name: "Pièce jointe.txt", storage_path: `${M3_TENANT_ID}/piece.txt`,
      document_kind: "other", mime_type: "text/plain", size_bytes: 10, updated_at: "2026-11-20T00:00:00Z" };
    f.intake.push(attachment);
    const { draft } = await loadTakeoffPreparation(M3_PROJECT_ID, M3_PLAN_SET_ID);
    expect(draft.sources.find(({ document_id }) => document_id === attachment.id)).toMatchObject({ kind: "other", active: false });
    const saved = await saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft, expectedRevision: null });
    const confirmed = await confirmTakeoffPreparation({ ...confirmation, expectedRevision: saved.revision! });
    const launch = { context: f.context, estimateVersionId: M3_VERSION_ID, planSetId: M3_PLAN_SET_ID,
      preparationRevision: confirmed.revision, level: "C", provider: "chatgpt" } as const;
    await expect(assertConfirmedTakeoffPreparation(launch)).resolves.toBeTruthy();
    attachment.document_kind = kind;
    await expect(assertConfirmedTakeoffPreparation(launch)).rejects.toMatchObject({ status: 409 });
    await expect(saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft: confirmed.draft, expectedRevision: confirmed.revision }))
      .rejects.toMatchObject({ status: 409 });
    const reloaded = await loadTakeoffPreparation(M3_PROJECT_ID, M3_PLAN_SET_ID);
    expect(reloaded.draft.sources.find(({ document_id }) => document_id === attachment.id)).toMatchObject({ kind, active: true });
    expect(reloaded.changedSourceIds).toContain(attachment.id);
    expect(reloaded.confirmedAt).toBeNull();
  });

  it.each(["cctp", "dpgf"])("includes an attachment of an old draft reclassified as %s on its first opening", async (kind) => {
    const f = fixture();
    const attachment = { id: "99999999-9999-4999-8999-999999999999", file_name: "Pièce jointe.txt", storage_path: `${M3_TENANT_ID}/piece.txt`,
      document_kind: "other", mime_type: "text/plain", size_bytes: 10, updated_at: "2026-11-20T00:00:00Z" };
    f.intake.push(attachment);
    // A draft as the previous application saved it: no dossier provenance, the attachment left out.
    const legacy = { ...f.ready, sources: [...f.ready.sources, { ...toPreparationIntakeSource(attachment), active: false }] };
    f.seedRecord({ revision: 1, draft: JSON.parse(JSON.stringify(legacy)), confirmed_at: null, confirmed_by: null, confirmed_snapshot: null });
    attachment.document_kind = kind;
    const opened = await loadTakeoffPreparation(M3_PROJECT_ID, M3_PLAN_SET_ID);
    expect(opened.draft.sources.find(({ document_id }) => document_id === attachment.id)).toMatchObject({ kind, active: true });
    expect(opened.changedSourceIds).toContain(attachment.id);
    const saved = await saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft: opened.draft, expectedRevision: opened.revision });
    const confirmed = await confirmTakeoffPreparation({ ...confirmation, expectedRevision: saved.revision! });
    const snapshot = await assertConfirmedTakeoffPreparation({ context: f.context, estimateVersionId: M3_VERSION_ID, planSetId: M3_PLAN_SET_ID,
      preparationRevision: confirmed.revision, level: "C", provider: "chatgpt" });
    expect(snapshot.preparation.sources.find(({ document_id }) => document_id === attachment.id)).toMatchObject({ kind, active: true });
  });

  it("reads and admits the historic upload format before adapting it to a dossier", async () => {
    const f = fixture();
    const hash = "a".repeat(64);
    const upload = { ...f.ready.sources[0], document_id: `upload:${hash}`, document_name: "Plan téléversé.pdf",
      source_version: hash, plan_set_id: null, file_path: null, pages: [3], page_count: 4 };
    f.ready.sources = [upload];
    f.ready.scope = { ...f.ready.scope, inclusions: [], zones: ["Ouest"] };
    const timestamp = "2026-10-29T00:00:00.000Z";
    const snapshot = createTakeoffPreparationSnapshot({
      preparation: f.ready, confirmedBy: M3_USER_ID, confirmedAt: timestamp, revision: 2,
    });
    const legacyDraft = JSON.parse(JSON.stringify(snapshot.preparation));
    f.seedRecord({ revision: 2, draft: legacyDraft, confirmed_at: timestamp, confirmed_by: M3_USER_ID,
      confirmed_snapshot: JSON.parse(JSON.stringify(snapshot)) });
    const original = { context: f.context, estimateVersionId: M3_VERSION_ID, preparationRevision: 2,
      upload: { hash, fileName: upload.document_name } };
    await expect(assertConfirmedTakeoffPreparation(original)).resolves.toMatchObject({
      preparation: { sources: [{ document_id: upload.document_id, active: true, pages: [3] }] },
    });
    delete legacyDraft.processing;
    f.seedRecord({ revision: 3, draft: legacyDraft, confirmed_at: null, confirmed_by: null, confirmed_snapshot: null });
    expect((await loadTakeoffPreparation(M3_PROJECT_ID)).draft.processing).toEqual({ level: null, provider: "auto" });
    const adapted = await loadTakeoffPreparation(M3_PROJECT_ID, M3_PLAN_SET_ID);
    expect(adapted.confirmedAt).toBeNull();
    expect(adapted.draft.scope).toEqual(f.ready.scope);
    expect(adapted.draft.sources.find(({ document_id }) => document_id === upload.document_id)).toMatchObject({ active: true, pages: [3] });
    expect(adapted.readiness.blockers).toContainEqual(expect.objectContaining({ code: "source_unavailable", source_document_id: upload.document_id }));
    const saved = await saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft: adapted.draft, expectedRevision: adapted.revision });
    expect(saved.draft.sources.find(({ document_id }) => document_id === upload.document_id)).toMatchObject({ active: true, pages: [3] });
    await expect(confirmTakeoffPreparation({ ...confirmation, expectedRevision: saved.revision! })).rejects.toMatchObject({
      readiness: { can_launch: false },
    });
  });

  it("keeps a declared index when the title-block text is only a finish description", async () => {
    const f = fixture();
    const { draft } = await loadTakeoffPreparation(M3_PROJECT_ID, M3_PLAN_SET_ID);
    await saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft, expectedRevision: null });
    vi.mocked(renderPdfPages).mockResolvedValue({ pages: [{ regionText: "Revêtement de sol" }] } as never);
    const confirmed = await confirmTakeoffPreparation(confirmation);
    expect(confirmed.draft.sources[0].revision).toBe("A");
    expect(f.getRecord()?.confirmed_snapshot).toBeTruthy();
  });

  it("keeps the operator's index and asks before applying a title block that reads another one", async () => {
    const f = fixture();
    f.file.metadata = {};
    const { draft } = await loadTakeoffPreparation(M3_PROJECT_ID, M3_PLAN_SET_ID);
    draft.sources[0].revision = "A";
    const saved = await saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft, expectedRevision: null });
    vi.mocked(renderPdfPages).mockResolvedValue({ pages: [{ regionText: "Indice : B" }] } as never);
    const pending = await confirmTakeoffPreparation({ ...confirmation, expectedRevision: saved.revision! });
    expect(pending.confirmedAt).toBeNull();
    expect(pending.draft.sources[0]).toMatchObject({ revision: "A", plan_identity: expect.objectContaining({ revision: "B" }) });
    expect(pending.readiness.blockers).toContainEqual(expect.objectContaining({ code: "source_revision_mismatch", source_document_id: f.file.id }));
    pending.draft.sources[0].revision_reading_settled = "B";
    const kept = await saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft: pending.draft, expectedRevision: pending.revision });
    const confirmed = await confirmTakeoffPreparation({ ...confirmation, expectedRevision: kept.revision! });
    expect(confirmed.confirmedAt).not.toBeNull();
    expect(confirmed.draft.sources[0].revision).toBe("A");
  });

  it("keeps the title block's index once the member chose it, on the next confirmation of the same bytes", async () => {
    const f = fixture();
    f.file.metadata = {};
    f.file.file_name = "P-101 rev A.pdf";
    const { draft } = await loadTakeoffPreparation(M3_PROJECT_ID, M3_PLAN_SET_ID);
    expect(draft.sources[0].revision).toBe("A");
    const saved = await saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft, expectedRevision: null });
    vi.mocked(renderPdfPages).mockResolvedValue({ pages: [{ regionText: "Indice : B" }] } as never);
    const pending = await confirmTakeoffPreparation({ ...confirmation, expectedRevision: saved.revision! });
    expect(pending.readiness.blockers).toContainEqual(expect.objectContaining({ code: "source_revision_mismatch" }));
    Object.assign(pending.draft.sources[0], { revision: "B", revision_reading_settled: "B" });
    const chosen = await saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft: pending.draft, expectedRevision: pending.revision });
    const confirmed = await confirmTakeoffPreparation({ ...confirmation, expectedRevision: chosen.revision! });
    expect(confirmed.confirmedAt).not.toBeNull();
    expect(confirmed.draft.sources[0].revision).toBe("B");
  });

  it("refuses launch when the discarded revision's bytes change after confirmation", async () => {
    const f = fixture();
    f.file.file_name = "Distribution rev A.pdf";
    const alternative = { ...f.file, id: "88888888-8888-4888-8888-888888888888",
      file_name: "Distribution rev B.pdf", file_path: `${M3_TENANT_ID}/plan-b.pdf`, metadata: { revision: "B" } };
    f.files.push(alternative);
    f.contents.set(alternative.file_path, Buffer.from("second revision"));
    const { draft } = await loadTakeoffPreparation(M3_PROJECT_ID, M3_PLAN_SET_ID);
    await saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft, expectedRevision: null });
    const unresolved = await confirmTakeoffPreparation(confirmation);
    const [left, right] = unresolved.draft.sources;
    unresolved.draft.plan_revision_decisions = [{
      left: { document_id: left.document_id, content_hash: left.content_hash! },
      right: { document_id: right.document_id, content_hash: right.content_hash! }, choice: "left",
    }];
    const saved = await saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft: unresolved.draft, expectedRevision: unresolved.revision });
    const confirmed = await confirmTakeoffPreparation({ ...confirmation, expectedRevision: saved.revision! });
    const launch = { context: f.context, estimateVersionId: M3_VERSION_ID, planSetId: M3_PLAN_SET_ID,
      preparationRevision: confirmed.revision, level: "C", provider: "chatgpt" } as const;
    expect(confirmed.draft.sources.filter(({ active }) => active)).toHaveLength(1);
    await expect(assertConfirmedTakeoffPreparation(launch)).resolves.toMatchObject({ preparation_revision: confirmed.revision });
    f.contents.set(alternative.file_path, Buffer.from("replacement bytes"));
    await expect(assertConfirmedTakeoffPreparation(launch)).rejects.toMatchObject({ status: 409 });
  });

  it("confirms and admits once a plan that left the dossier is removed from the preparation", async () => {
    const f = fixture();
    const second = { ...f.file, id: "88888888-8888-4888-8888-888888888888", file_name: "Plan second.pdf", file_path: `${M3_TENANT_ID}/plan-second.pdf` };
    f.files.push(second);
    f.contents.set(second.file_path, Buffer.from("second plan bytes"));
    const { draft } = await loadTakeoffPreparation(M3_PROJECT_ID, M3_PLAN_SET_ID);
    const saved = await saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft, expectedRevision: null });
    f.files.splice(f.files.indexOf(second), 1);
    const reopened = await loadTakeoffPreparation(M3_PROJECT_ID, M3_PLAN_SET_ID);
    expect(reopened.readiness.blockers).toContainEqual(expect.objectContaining({ code: "source_unavailable", source_document_id: second.id }));
    const removed = { ...reopened.draft, sources: reopened.draft.sources.filter(({ document_id }) => document_id !== second.id) };
    const resaved = await saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft: removed, expectedRevision: saved.revision });
    const confirmed = await confirmTakeoffPreparation({ ...confirmation, expectedRevision: resaved.revision! });
    expect(confirmed.confirmedAt).not.toBeNull();
    await expect(assertConfirmedTakeoffPreparation({ context: f.context, estimateVersionId: M3_VERSION_ID, planSetId: M3_PLAN_SET_ID,
      preparationRevision: confirmed.revision, level: "C", provider: "chatgpt" })).resolves.toBeTruthy();
  });

  it("refuses launch when a deduplicated identical copy later differs", async () => {
    const f = fixture();
    const copy = { ...f.file, id: "88888888-8888-4888-8888-888888888888", file_name: "Plan fictif copie.pdf", file_path: `${M3_TENANT_ID}/plan-copie.pdf` };
    f.files.push(copy);
    f.contents.set(copy.file_path, f.content);
    const { draft } = await loadTakeoffPreparation(M3_PROJECT_ID, M3_PLAN_SET_ID);
    const saved = await saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft, expectedRevision: null });
    const confirmed = await confirmTakeoffPreparation({ ...confirmation, expectedRevision: saved.revision! });
    expect(confirmed.draft.sources.filter(({ active }) => active)).toHaveLength(1);
    expect(confirmed.draft.sources.filter(({ alternate_of }) => alternate_of)).toHaveLength(1);
    const launch = { context: f.context, estimateVersionId: M3_VERSION_ID, planSetId: M3_PLAN_SET_ID,
      preparationRevision: confirmed.revision, level: "C", provider: "chatgpt" } as const;
    await expect(assertConfirmedTakeoffPreparation(launch)).resolves.toBeTruthy();
    const alternate = confirmed.draft.sources.find(({ alternate_of }) => alternate_of)!;
    f.contents.set(alternate.file_path!, Buffer.from("different bytes"));
    await expect(assertConfirmedTakeoffPreparation(launch)).rejects.toMatchObject({ status: 409 });
  });

  it("admits another plan set after a copy was set aside in the former one, and re-reads that copy on return", async () => {
    const f = fixture();
    const copy = { ...f.file, id: "88888888-8888-4888-8888-888888888888", file_name: "Plan fictif copie.pdf", file_path: `${M3_TENANT_ID}/plan-copie.pdf` };
    f.files.push(copy);
    f.contents.set(copy.file_path, f.content);
    const other = addOtherPlanSet(f);
    const first = await confirmPlanSet(M3_PLAN_SET_ID);
    expect(first.draft.sources.find(({ document_id }) => document_id === copy.id)).toMatchObject({ active: false, alternate_of: f.file.id });
    await expect(launchPlanSet(f, M3_PLAN_SET_ID, first.revision)).resolves.toBeTruthy();

    const switched = await confirmPlanSet(OTHER_PLAN_SET_ID);
    expect(switched.confirmedAt).not.toBeNull();
    expect(switched.draft.sources.filter(({ active, kind }) => active && kind === "plan").map(({ document_id }) => document_id)).toEqual([other.id]);
    // The former set keeps what it set aside, so that coming back to it restores the member's selection.
    expect(switched.draft.sources.find(({ document_id }) => document_id === copy.id)).toMatchObject({ active: false, alternate_of: f.file.id });
    await expect(launchPlanSet(f, OTHER_PLAN_SET_ID, switched.revision)).resolves.toMatchObject({ preparation_revision: switched.revision });

    const back = await confirmPlanSet(M3_PLAN_SET_ID);
    expect(back.draft.sources.filter(({ active, kind }) => active && kind === "plan").map(({ document_id }) => document_id)).toEqual([f.file.id]);
    await expect(launchPlanSet(f, M3_PLAN_SET_ID, back.revision)).resolves.toMatchObject({ preparation_revision: back.revision });
    f.contents.set(copy.file_path, Buffer.from("different bytes"));
    await expect(launchPlanSet(f, M3_PLAN_SET_ID, back.revision)).rejects.toMatchObject({ status: 409 });
  });

  it("admits another plan set after a revision was discarded in the former one, and asks again on return", async () => {
    const f = fixture();
    f.file.file_name = "Distribution rev A.pdf";
    const alternative = { ...f.file, id: "88888888-8888-4888-8888-888888888888",
      file_name: "Distribution rev B.pdf", file_path: `${M3_TENANT_ID}/plan-b.pdf`, metadata: { revision: "B" } };
    f.files.push(alternative);
    f.contents.set(alternative.file_path, Buffer.from("second revision"));
    const other = addOtherPlanSet(f);
    const unresolved = await confirmPlanSet(M3_PLAN_SET_ID);
    const [left, right] = unresolved.draft.sources.filter(({ plan_set_id }) => plan_set_id === M3_PLAN_SET_ID);
    unresolved.draft.plan_revision_decisions = [{
      left: { document_id: left.document_id, content_hash: left.content_hash! },
      right: { document_id: right.document_id, content_hash: right.content_hash! }, choice: "left",
    }];
    const chosen = await saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft: unresolved.draft, expectedRevision: unresolved.revision });
    const first = await confirmTakeoffPreparation({ ...confirmation, expectedRevision: chosen.revision! });
    expect(first.draft.sources.find(({ document_id }) => document_id === alternative.id)).toMatchObject({ active: false, alternate_of: f.file.id });
    await expect(launchPlanSet(f, M3_PLAN_SET_ID, first.revision)).resolves.toBeTruthy();

    const switched = await confirmPlanSet(OTHER_PLAN_SET_ID);
    expect(switched.confirmedAt).not.toBeNull();
    expect(switched.draft.sources.filter(({ active, kind }) => active && kind === "plan").map(({ document_id }) => document_id)).toEqual([other.id]);
    await expect(launchPlanSet(f, OTHER_PLAN_SET_ID, switched.revision)).resolves.toMatchObject({ preparation_revision: switched.revision });
    // The discarded revision is no longer part of what this launch measures.
    f.contents.set(alternative.file_path, Buffer.from("replacement bytes"));
    await expect(launchPlanSet(f, OTHER_PLAN_SET_ID, switched.revision)).resolves.toMatchObject({ preparation_revision: switched.revision });

    // Back on the former set, both revisions are candidates again: nothing is left out unseen.
    const back = await confirmPlanSet(M3_PLAN_SET_ID);
    expect(back.confirmedAt).toBeNull();
    expect(back.readiness.blockers).toContainEqual(expect.objectContaining({ code: "source_revision_conflict" }));
    const [retained, discarded] = back.draft.sources.filter(({ plan_set_id }) => plan_set_id === M3_PLAN_SET_ID);
    expect(discarded).toMatchObject({ document_id: alternative.id, active: true });
    back.draft.plan_revision_decisions = [{
      left: { document_id: retained.document_id, content_hash: retained.content_hash! },
      right: { document_id: discarded.document_id, content_hash: discarded.content_hash! }, choice: "left",
    }];
    const rechosen = await saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft: back.draft, expectedRevision: back.revision });
    const reconfirmed = await confirmTakeoffPreparation({ ...confirmation, expectedRevision: rechosen.revision! });
    await expect(launchPlanSet(f, M3_PLAN_SET_ID, reconfirmed.revision)).resolves.toMatchObject({ preparation_revision: reconfirmed.revision });
    f.contents.set(alternative.file_path, Buffer.from("third bytes"));
    await expect(launchPlanSet(f, M3_PLAN_SET_ID, reconfirmed.revision)).rejects.toMatchObject({ status: 409 });
  });

  it("autosaves incomplete values, survives reload, and uses a tenant/project compare-and-swap", async () => {
    const f = fixture();
    const draft = createEmptyTakeoffPreparation();
    draft.scope.levels = ["R+1"];
    draft.scope.exclusions = ["RDC"];
    draft.conventions.purchase = { deductions: "aucune", waste_percent: null, rounding: "", packaging: "" };
    const saved = await saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft, expectedRevision: null });
    const reloaded = await loadTakeoffPreparation(M3_PROJECT_ID);
    expect(saved.revision).toBe(1);
    expect(reloaded.draft.scope).toEqual(draft.scope);
    expect(reloaded.draft.conventions.purchase?.waste_percent).toBeNull();
    expect(reloaded.confirmedAt).toBeNull();
    await expect(saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft, expectedRevision: null })).rejects.toMatchObject({ status: 409 });
    await saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft, expectedRevision: 1 });
    expect(filterValue(f.server.queries.at(-1)!, "tenant_id")).toBe(M3_TENANT_ID);
    expect(filterValue(f.server.queries.at(-1)!, "project_id")).toBe(M3_PROJECT_ID);
    expect(filterValue(f.server.queries.at(-1)!, "revision")).toBe(1);
    expect(f.user.writesTo("takeoff_preparations")).toEqual([]);
  });

  it("hashes actual bytes at confirmation and requires that exact confirmed revision for launch", async () => {
    const f = fixture();
    await saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft: f.ready, expectedRevision: null });
    const confirmed = await confirmTakeoffPreparation({ projectId: M3_PROJECT_ID, expectedRevision: 1 });
    expect(confirmed.revision).toBe(2);
    expect((await confirmTakeoffPreparation({ projectId: M3_PROJECT_ID, expectedRevision: 2 })).revision).toBe(2);
    expect((await confirmTakeoffPreparation({ projectId: M3_PROJECT_ID, expectedRevision: 1 })).revision).toBe(2);
    expect(confirmed.confirmedBy).toBe(M3_USER_ID);
    expect(confirmed.draft.sources[0].content_hash).toBe(createHash("sha256").update(f.content).digest("hex"));
    const snapshot = await assertConfirmedTakeoffPreparation({ context: f.context, projectId: M3_PROJECT_ID, estimateVersionId: M3_VERSION_ID, planSetId: M3_PLAN_SET_ID, preparationRevision: 2 });
    expect(snapshot.preparation.scope.exclusions).toEqual(["Variantes non retenues"]);
    expect(snapshot.preparation_revision).toBe(2);
    await expect(assertConfirmedTakeoffPreparation({ context: f.context, estimateVersionId: M3_VERSION_ID, preparationRevision: 1 })).rejects.toMatchObject({ status: 409 });
    await saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft: confirmed.draft, expectedRevision: 2 });
    await expect(assertConfirmedTakeoffPreparation({ context: f.context, estimateVersionId: M3_VERSION_ID, preparationRevision: 3 })).rejects.toMatchObject({ status: 409 });
  });

  it("never confirms a geometric measure without dimensions or calibration", async () => {
    const f = fixture();
    f.ready.objective = "measure_length";
    f.ready.conventions.unit = "m";
    await saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft: f.ready, expectedRevision: null });
    await expect(confirmTakeoffPreparation({ projectId: M3_PROJECT_ID, expectedRevision: 1 })).rejects.toMatchObject({ readiness: { can_launch: false } });
    expect(f.getRecord()?.confirmed_snapshot).toBeNull();
    expect(f.server.writesTo("takeoff_preparations")).toHaveLength(1);
  });

  it("rejects mismatched snapshot confirmation provenance before launch", async () => {
    const f = fixture();
    await saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft: f.ready, expectedRevision: null });
    await confirmTakeoffPreparation({ projectId: M3_PROJECT_ID, expectedRevision: 1 });
    f.getRecord()!.confirmed_at = "2026-10-28T00:00:00+00:00";
    await expect(assertConfirmedTakeoffPreparation({ context: f.context, estimateVersionId: M3_VERSION_ID, preparationRevision: 2 })).rejects.toMatchObject({ status: 409 });
  });

  it("reopens changed sources on reload and rejects source changes both during confirmation and before launch", async () => {
    const f = fixture();
    await saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft: f.ready, expectedRevision: null });
    f.onDownload(() => { f.file.updated_at = "2026-10-29T01:00:00Z"; });
    await expect(confirmTakeoffPreparation({ projectId: M3_PROJECT_ID, expectedRevision: 1 })).rejects.toMatchObject({ status: 409 });
    expect(f.server.writesTo("takeoff_preparations")).toHaveLength(1);
    const state = await loadTakeoffPreparation(M3_PROJECT_ID);
    expect(state.changedSourceIds).toEqual([f.file.id]);
    expect(state.draft.sources[0].confirmed).toBe(false);
    expect(state.draft.scope).toEqual(f.ready.scope);
    await expect(assertConfirmedTakeoffPreparation({ context: f.context, estimateVersionId: M3_VERSION_ID, preparationRevision: 1 })).rejects.toMatchObject({ status: 409 });
  });

  it("binds target version, project and actual selected plan set", async () => {
    const f = fixture();
    await saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft: f.ready, expectedRevision: null });
    await confirmTakeoffPreparation({ projectId: M3_PROJECT_ID, expectedRevision: 1 });
    await expect(assertConfirmedTakeoffPreparation({ context: f.context, projectId: M3_PROJECT_ID, estimateVersionId: M3_VERSION_ID, planSetId: "different-set", preparationRevision: 2 })).rejects.toMatchObject({ status: 409 });
    f.setTargetProject("99999999-9999-4999-8999-999999999999");
    await expect(assertConfirmedTakeoffPreparation({ context: f.context, projectId: M3_PROJECT_ID, estimateVersionId: M3_VERSION_ID, preparationRevision: 2 })).rejects.toMatchObject({ status: 409 });
  });

  it("accepts an ordinary copied target with parent NULL only through its exact server receipt", async () => {
    const f = fixture();
    await saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft: f.ready, expectedRevision: null });
    await confirmTakeoffPreparation({ projectId: M3_PROJECT_ID, expectedRevision: 1 });
    const input = { context: f.context, projectId: M3_PROJECT_ID, estimateVersionId: M3_VERSION_ID,
      planSetId: M3_PLAN_SET_ID, sourceVersionId: "99999999-9999-4999-8999-999999999999", preparationRevision: 2 };
    await expect(assertConfirmedTakeoffPreparation(input)).rejects.toMatchObject({ status: 409 });
    vi.mocked(hasTakeoffPreparationCopyReceipt).mockResolvedValueOnce(true);
    await expect(assertConfirmedTakeoffPreparation(input)).resolves.toMatchObject({ preparation_revision: 2 });
    expect(hasTakeoffPreparationCopyReceipt).toHaveBeenCalledWith({ context: f.context, projectId: M3_PROJECT_ID,
      sourceVersionId: input.sourceVersionId, targetVersionId: M3_VERSION_ID, preparationRevision: 2 });
  });

  it("rejects a forged upload hash or a read-only actor before persistence", async () => {
    const f = fixture();
    const draft = structuredClone(f.ready);
    draft.sources[0] = { ...draft.sources[0], document_id: `upload:${"a".repeat(64)}`, source_version: "b".repeat(64), plan_set_id: null, file_path: null };
    await expect(saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft, expectedRevision: null })).rejects.toMatchObject({ status: 409 });
    vi.mocked(getAuthenticatedContext).mockResolvedValue({ ...f.context, tenantRole: "viewer" });
    await expect(saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft: f.ready, expectedRevision: null })).rejects.toMatchObject({ status: 403 });
    expect(f.server.queries).toEqual([]);
  });

  it("reports an unapplied migration without returning a launchable fallback", async () => {
    const f = fixture();
    f.setMissingMigration();
    await expect(loadTakeoffPreparation(M3_PROJECT_ID)).rejects.toMatchObject({ status: 503, message: expect.stringContaining("mise à jour de la base") });
    expect(f.server.queries).toEqual([]);
  });

  it("rejects unsupported contextual pieces before confirmation or launch", async () => {
    const f = fixture();
    const document: PreparationIntakeDocument = {
      id: "99999999-9999-4999-8999-999999999999", file_name: "Prescriptions.docx",
      storage_path: `${M3_TENANT_ID}/prescriptions.docx`, size_bytes: 100,
      mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      document_kind: "cctp", updated_at: "2026-10-29T00:00:00Z",
    };
    f.intake.push(document);
    f.ready.sources.push({ ...toPreparationIntakeSource(document), active: true, confirmed: true, revision: "A" });
    await saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft: f.ready, expectedRevision: null });
    await expect(confirmTakeoffPreparation({ projectId: M3_PROJECT_ID, expectedRevision: 1 })).rejects.toMatchObject({ status: 422, code: "TAKEOFF_FILE_TYPE_INVALID" });
    expect(f.user.storageCalls).toEqual([]);
    expect(f.getRecord()?.confirmed_snapshot).toBeNull();
  });

  it("persists processing choices and reopens confirmation only after an explicit settings edit", async () => {
    const f = fixture();
    await saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft: f.ready, expectedRevision: null });
    const confirmed = await confirmTakeoffPreparation({ projectId: M3_PROJECT_ID, expectedRevision: 1 });
    expect((await loadTakeoffPreparation(M3_PROJECT_ID)).draft.processing).toEqual({ level: "B", provider: "auto" });
    const changed = structuredClone(confirmed.draft);
    changed.processing = { level: "C", provider: "chatgpt" };
    const saved = await saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft: changed, expectedRevision: 2 });
    expect(saved.revision).toBe(3);
    expect(saved.confirmedAt).toBeNull();
    expect(saved.draft.scope).toEqual(confirmed.draft.scope);
    const reconfirmed = await confirmTakeoffPreparation({ projectId: M3_PROJECT_ID, expectedRevision: 3 });
    expect(reconfirmed.revision).toBe(4);
    await expect(assertConfirmedTakeoffPreparation({ context: f.context, estimateVersionId: M3_VERSION_ID,
      planSetId: M3_PLAN_SET_ID, preparationRevision: 4, level: "B", provider: "auto" })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("réglages de traitement") });
    await expect(assertConfirmedTakeoffPreparation({ context: f.context, estimateVersionId: M3_VERSION_ID,
      planSetId: M3_PLAN_SET_ID, preparationRevision: 4, level: "C", provider: "chatgpt" })).resolves.toMatchObject({ preparation: { processing: { level: "C", provider: "chatgpt" } } });
  });
});
