import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createEmptyTakeoffPreparation } from "@/lib/takeoff/preparation";
import { confirmedPreparationFixture } from "@/lib/takeoff/preparation.test-utils";
import { assertConfirmedTakeoffPreparation as assertConfirmedTakeoffPreparationServer, confirmTakeoffPreparation, loadTakeoffPreparation, saveTakeoffPreparation } from "@/lib/takeoff/preparation-server";
import type { PreparationRecordRow } from "@/lib/takeoff/preparation-repository";
import { toPreparationPlanSource, toPreparationIntakeSource, type PreparationPlanFile, type PreparationIntakeDocument } from "@/lib/takeoff/preparation-sources";
import { hasTakeoffPreparationCopyReceipt } from "@/lib/takeoff/preparation-copy-provenance-server";
import { authenticatedContext, createSupabaseFake, filterValue, M3_PLAN_SET_ID, M3_PROJECT_ID, M3_TENANT_ID, M3_USER_ID, M3_VERSION_ID } from "@/lib/takeoff/metre-m3.test-utils";

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
  const user = createSupabaseFake({
    tables: {
      estimate_projects: (query) => ({ data: filterValue(query, "id") === M3_PROJECT_ID && filterValue(query, "tenant_id") === M3_TENANT_ID ? { id: M3_PROJECT_ID } : null, error: null }),
      estimate_versions: () => ({ data: { id: M3_VERSION_ID, project_id: targetProjectId, parent_version_id: null }, error: null }),
      plan_sets: () => ({ data: [{ id: M3_PLAN_SET_ID }], error: null, count: 1 }),
      plan_files: () => ({ data: [file], error: null, count: 1 }),
      affaire_intake_documents: () => ({ data: intake, error: null, count: intake.length }),
      takeoff_preparations: () => ({ data: record, error: missingMigration ? { code: "42P01", message: "missing table" } : null }),
    },
    storage: { "plan-files": () => { onDownload(); return { data: new Blob([content]), error: null }; } },
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
    user, server, context, file, ready, content, intake, getRecord: () => record,
    setTargetProject: (id: string) => { targetProjectId = id; },
    setMissingMigration: () => { missingMigration = true; },
    onDownload: (callback: () => void) => { onDownload = callback; },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("persisted preparation server boundary", () => {
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

  it("preserves exact snapshot JSON when PostgREST returns an equivalent timestamp with a different format", async () => {
    const f = fixture();
    await saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft: f.ready, expectedRevision: null });
    await confirmTakeoffPreparation({ projectId: M3_PROJECT_ID, expectedRevision: 1 });
    const record = f.getRecord()!;
    const storedJson = JSON.stringify(record.confirmed_snapshot);
    record.confirmed_at = record.confirmed_at!.replace(/Z$/, "+00:00");
    const snapshot = await assertConfirmedTakeoffPreparation({ context: f.context, projectId: M3_PROJECT_ID, estimateVersionId: M3_VERSION_ID, planSetId: M3_PLAN_SET_ID, preparationRevision: 2 });
    expect(snapshot.confirmed_at).toMatch(/Z$/);
    expect(JSON.stringify(snapshot)).toBe(storedJson);
    expect(snapshot).not.toBe(record.confirmed_snapshot);
    snapshot.preparation.scope.exclusions.push("Consumer-local mutation");
    expect(JSON.stringify(record.confirmed_snapshot)).toBe(storedJson);
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

  it("requires choosing settings before confirming an old draft with an unset level", async () => {
    const f = fixture();
    f.ready.processing = { level: null, provider: "auto" };
    await saveTakeoffPreparation({ projectId: M3_PROJECT_ID, draft: f.ready, expectedRevision: null });
    await expect(confirmTakeoffPreparation({ projectId: M3_PROJECT_ID, expectedRevision: 1 })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Choisissez le niveau") });
    expect(f.getRecord()?.confirmed_snapshot).toBeNull();
    expect(f.user.storageCalls).toEqual([]);
  });
});
