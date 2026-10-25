import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/affaires/intake-server", () => ({ requireAffaireProjectOwnerOrAdmin: vi.fn() }));
import { requireAffaireProjectOwnerOrAdmin } from "@/lib/affaires/intake-server";
import { driveRequestSchema, DRIVE_MAX_BATCH_BYTES, DRIVE_MAX_FILES } from "./contracts";
import { driveState, executeDriveRequest } from "./server";
import { driveBatchUploadId, driveCopyId, persistDriveCopy } from "./store";
import { fakeDrive, memoryBackend } from "./memory.test-utils";

describe("Drive folder copies (Google and persistence simulated, no OAuth grants)", () => {
  let backend: ReturnType<typeof memoryBackend>;
  let google: ReturnType<typeof fakeDrive>;
  const auth = vi.mocked(requireAffaireProjectOwnerOrAdmin);
  const signal = () => new AbortController().signal;
  const selection = (id = "plan_demo", version = "1", newVersion = false) => ({ id, version, newVersion });
  const request = (files = [selection()]) => executeDriveRequest("project_demo", {
    action: "import", token: "fictitious-not-a-token", folderId: "folder_demo", files,
  }, signal());
  const lotUploadId = (files = [selection()]) => driveBatchUploadId("tenant_demo", "project_demo", files);
  beforeEach(() => {
    backend = memoryBackend(); google = fakeDrive();
    vi.stubGlobal("fetch", google.fetchMock);
    vi.stubEnv("MERGEONE_GOOGLE_DRIVE_ENABLED", "true");
    vi.stubEnv("MERGEONE_GOOGLE_DRIVE_CLIENT_ID", "fictitious-client");
    auth.mockReset().mockResolvedValue(backend.access as never);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  it("lists folder metadata without downloading content or creating documents", async () => {
    const result = await executeDriveRequest("project_demo", { action: "list", token: "fiction", folderId: "root" }, signal());
    expect(result).toMatchObject({ listing: { folder: { id: "folder_demo" }, files: [{ id: "plan_demo" }, { id: "cctp_demo" }] } });
    expect(google.fetchMock.mock.calls.every(([url]) => !String(url).includes("alt=media"))).toBe(true);
    expect(backend.objects.size).toBe(0); expect(backend.tables.size).toBe(0);
  });
  it("persists exact copies and provenance, survives reload and replays without another download", async () => {
    const result = await request();
    expect(result.results[0]).toMatchObject({ status: "imported", fileId: "plan_demo" });
    expect(backend.objects.size).toBe(1);
    expect(await [...backend.objects.values()][0].text()).toBe("plans");
    const reloaded = await driveState("project_demo");
    expect(reloaded.history).toHaveLength(1);
    expect(reloaded.history[0].source).toMatchObject({ fileId: "plan_demo", revision: "1", tenantId: "tenant_demo",
      projectId: "project_demo", importedBy: "user_demo", sha256: createHash("sha256").update("plans").digest("hex") });
    expect(JSON.stringify(reloaded)).not.toContain("fictitious-not-a-token");
    const downloads = google.fetchMock.mock.calls.filter(([url]) => String(url).includes("alt=media")).length;
    expect((await request()).results[0].status).toBe("already_imported");
    expect(google.fetchMock.mock.calls.filter(([url]) => String(url).includes("alt=media"))).toHaveLength(downloads);
    expect(backend.rows("affaire_intake_documents").size).toBe(1);
    expect(backend.queries.filter((query) => query.operation === "select").every((query) =>
      query.filters.some(([key, value]) => key === "tenant_id" && value === "tenant_demo") &&
      query.filters.some(([key, value]) => key === "project_id" && value === "project_demo"))).toBe(true);
  });
  it("concurrent restoration uses one storage generation and retries the same completed event", async () => {
    await request();
    const history = (await driveState("project_demo")).history[0];
    const document = backend.rows("affaire_intake_documents").get(history.documentId)!;
    const oldPath = document.storage_path;
    backend.objects.clear();
    Object.assign(document, { deleted_at: new Date().toISOString(), storage_path: null, upload_status: "rejected" });
    const file = new File(["plans"], "plan-fictif.pdf", { type: "application/pdf" });
    const results = await Promise.all([persistDriveCopy(backend.access as never, file, history.source, lotUploadId()), persistDriveCopy(backend.access as never, file, history.source, lotUploadId())]);
    expect(results.every((result) => ["imported", "already_imported"].includes(result.status))).toBe(true);
    expect(document.storage_path).not.toBe(oldPath);
    expect(backend.objects.size).toBe(1);
    expect(backend.objects.has(String(document.storage_path))).toBe(true);
    const completions = () => [...backend.rows("affaire_intake_events").values()].filter((row) => row.event_type === "document.uploaded");
    expect(completions()).toHaveLength(2);
    // Lost final acknowledgement retains the generation and its completion identity.
    document.upload_status = "pending";
    await persistDriveCopy(backend.access as never, file, history.source, lotUploadId());
    expect(completions()).toHaveLength(2);
  });
  it("lets an administrator restore the owner's deleted copy and keeps the owner's import provenance", async () => {
    await request();
    const documentId = driveCopyId("tenant_demo", "project_demo", "plan_demo", "1");
    const document = backend.rows("affaire_intake_documents").get(documentId)!;
    const oldPath = document.storage_path;
    // Tombstone as written by the verified deletion, its private object removed.
    backend.objects.clear();
    Object.assign(document, { deleted_at: new Date().toISOString(), storage_path: null, upload_status: "rejected", document_priority: "secondary" });
    backend.access.context.userId = "admin_demo";
    const restored = await request();
    expect(restored.results[0]).toMatchObject({ status: "imported", documentId });
    expect(document).toMatchObject({ created_by: "admin_demo", deleted_at: null, upload_status: "uploaded" });
    expect(document.storage_path).not.toBe(oldPath);
    expect(await backend.objects.get(String(document.storage_path))?.text()).toBe("plans");
    const events = [...backend.rows("affaire_intake_events").values()].filter((event) => event.document_id === documentId);
    expect(events.filter((event) => event.event_type === "upload.created")).toEqual([
      expect.objectContaining({ actor_user_id: "user_demo", after_payload: { drive: expect.objectContaining({ importedBy: "user_demo" }) } })]);
    expect(events.filter((event) => event.event_type === "document.uploaded").map((event) => event.actor_user_id)).toEqual(["user_demo", "admin_demo"]);
    expect((await driveState("project_demo")).history.map((entry) => entry.documentId)).toEqual([documentId]);
  });
  it("keeps partial successes and retries only the failed copy", async () => {
    backend.failStorage.add("cctp-fictif.txt");
    const first = await request([selection(), selection("cctp_demo")]);
    expect(first.results.map((file) => file.status)).toEqual(["imported", "failed"]);
    expect((await driveState("project_demo")).history).toHaveLength(1);
    backend.failStorage.clear();
    const retry = await request([selection("cctp_demo")]);
    expect(retry.results[0].status).toBe("imported");
    expect(backend.objects.size).toBe(2);
    expect(backend.rows("affaire_intake_documents").size).toBe(2);
    expect((await driveState("project_demo")).history).toHaveLength(2);
    // The retried piece keeps the upload of its original lot.
    expect(first.results[0].uploadId).toBe(lotUploadId([selection(), selection("cctp_demo")]));
    expect(retry.results[0].uploadId).toBe(first.results[0].uploadId);
    expect(retry.uploads).toEqual([first.results[0].uploadId]);
    expect(backend.rows("affaire_intake_uploads").size).toBe(1);
  });
  it("imports a confirmed selection as one intake upload armed once after its last copy", async () => {
    const result = await request([selection(), selection("cctp_demo")]);
    expect(backend.rows("affaire_intake_uploads").size).toBe(1);
    expect(result.results.map((file) => [file.status, file.uploadId])).toEqual([["imported", result.uploads[0]], ["imported", result.uploads[0]]]);
    expect(result.uploads).toEqual([lotUploadId([selection("cctp_demo"), selection()])]);
    const queries = backend.queries.map((query, index) => ({ ...query, index }));
    const arming = queries.filter((query) => query.table === "affaire_intake_uploads" && query.operation === "update");
    const lastCopy = queries.filter((query) => query.table === "affaire_intake_events" && query.operation === "insert").at(-1)!;
    expect(arming).toHaveLength(1); expect(arming[0].index).toBeGreaterThan(lastCopy.index);
    expect([...backend.rows("affaire_intake_uploads").values()][0]).toMatchObject({ status: "queued", completed_at: null });
  });
  it("rearms a processed lot when one of its failed pieces is retried later", async () => {
    backend.failStorage.add("cctp-fictif.txt");
    const first = await request([selection(), selection("cctp_demo")]);
    const lot = backend.rows("affaire_intake_uploads").get(first.uploads[0])!;
    lot.status = "ready"; lot.completed_at = new Date().toISOString();
    backend.failStorage.clear();
    expect((await request([selection("cctp_demo")])).uploads).toEqual([first.uploads[0]]);
    expect(lot).toMatchObject({ status: "queued", completed_at: null });
  });
  it("refuses a copy whose immutable provenance belongs to another upload", async () => {
    const provenance = driveCopyId("tenant_demo", "project_demo", "plan_demo", "1", "provenance");
    backend.rows("affaire_intake_events").set(provenance, { id: provenance, tenant_id: "tenant_demo", project_id: "project_demo",
      upload_id: "foreign_upload", document_id: driveCopyId("tenant_demo", "project_demo", "plan_demo", "1"), event_type: "upload.created",
      after_payload: { drive: { provider: "google_drive", sha256: createHash("sha256").update("plans").digest("hex") } } });
    expect((await request()).results).toEqual([expect.objectContaining({ status: "failed", message: expect.stringContaining("provenance Drive") })]);
    expect(backend.objects.size).toBe(0);
  });
  it("ignores a forged event parent and never schedules its upload", async () => {
    await request();
    const completed = [...backend.rows("affaire_intake_events").values()].find((event) => event.event_type === "document.uploaded")!;
    completed.upload_id = "foreign_upload";
    expect((await driveState("project_demo")).history).toEqual([]);
    const replay = await request();
    expect(replay.uploads).not.toContain("foreign_upload");
    expect(replay.results[0].uploadId).toBe(lotUploadId());
  });
  it("ignores Drive provenance rebound to another document or upload", async () => {
    await request();
    const documents = backend.rows("affaire_intake_documents");
    const events = backend.rows("affaire_intake_events");
    const completed = [...events.values()].find((event) => event.event_type === "document.uploaded")!;
    const copy = documents.get(String(completed.document_id))!;
    documents.set("other_document", { ...copy, id: "other_document" });
    events.set("rebound_document", { ...completed, id: "rebound_document", document_id: "other_document" });
    expect((await driveState("project_demo")).history.map((entry) => entry.documentId)).toEqual([copy.id]);
    copy.upload_id = "foreign_upload";
    events.set("rebound_upload", { ...completed, id: "rebound_upload", upload_id: "foreign_upload" });
    expect((await driveState("project_demo")).history).toEqual([]);
  });
  it("rearms a failed parent after an interrupted copy", async () => {
    await request();
    const parent = [...backend.rows("affaire_intake_uploads").values()][0];
    parent.status = "failed"; parent.completed_at = new Date().toISOString();
    const replay = await request();
    expect(replay.results[0].status).toBe("already_imported");
    expect(parent.status).toBe("queued"); expect(parent.completed_at).toBeNull();
  });
  it("rearms the parent when a finalized copy is replayed without trusted provenance", async () => {
    await request();
    const completed = [...backend.rows("affaire_intake_events").values()].find((event) => event.event_type === "document.uploaded")!;
    completed.upload_id = "foreign_upload";
    const parent = [...backend.rows("affaire_intake_uploads").values()][0];
    parent.status = "failed"; parent.completed_at = new Date().toISOString();
    expect((await request()).results).toEqual([expect.objectContaining({ status: "already_imported" })]);
    expect(parent).toMatchObject({ status: "queued", completed_at: null });
  });
  it("reports a single outcome when resuming an imported revision fails or succeeds", async () => {
    await request();
    backend.failures.set("affaire_intake_uploads", "simulated_requeue_failure");
    const interrupted = await request();
    expect(interrupted.results).toEqual([expect.objectContaining({ fileId: "plan_demo", status: "failed",
      message: "Copie conservée, reprise du classement interrompue. Reprenez cette pièce." })]);
    expect(interrupted.uploads).toEqual([]);
    backend.failures.clear();
    const resumed = await request();
    expect(resumed.results).toEqual([expect.objectContaining({ fileId: "plan_demo", status: "already_imported" })]);
    expect(resumed.uploads).toEqual([lotUploadId()]);
  });
  it("requires explicit new revision confirmation and keeps both private versions", async () => {
    await request(); google.files.get("plan_demo")!.version = "2";
    const stale = await request();
    expect(stale.results[0]).toMatchObject({ status: "failed", message: expect.stringContaining("modifiée") });
    expect((await request([selection("plan_demo", "2")])).results[0].message).toContain("nouvelle version");
    expect((await request([selection("plan_demo", "2", true)])).results[0].status).toBe("imported");
    expect(backend.objects.size).toBe(2);
    expect((await driveState("project_demo")).history.map((entry) => entry.source.revision).sort()).toEqual(["1", "2"]);
  });
  it("deduplicates concurrent confirmations by persisted identity", async () => {
    const results = await Promise.all([request(), request()]);
    expect(results.every((result) => result.results[0].status !== "failed")).toBe(true);
    expect(backend.objects.size).toBe(1); expect(backend.rows("affaire_intake_documents").size).toBe(1);
    expect(backend.rows("affaire_intake_events").size).toBe(2);
  });
  it("resumes a stored copy after a lost database acknowledgement without overwriting it", async () => {
    const upload = backend.upload.getMockImplementation()!;
    backend.upload.mockImplementationOnce(async (path, file) => {
      const result = await upload(path, file); backend.failures.set("affaire_intake_documents", "simulated_update_failure"); return result;
    });
    expect((await request()).results[0].status).toBe("failed");
    expect(backend.objects.size).toBe(1);
    backend.failures.clear();
    expect((await request()).results[0].status).toBe("imported");
    expect(backend.objects.size).toBe(1);
    expect((await driveState("project_demo")).history).toHaveLength(1);
    expect([...backend.rows("affaire_intake_uploads").values()]).toEqual([expect.objectContaining({ status: "queued", completed_at: null })]);
  });
  it("returns the store's actionable message as an API error when provenance cannot be read", async () => {
    backend.failures.set("affaire_intake_events", "simulated_read_failure");
    await expect(driveState("project_demo")).rejects.toMatchObject({ name: "ApiError", status: 500,
      message: "Impossible de lire la provenance des copies Drive." });
  });
  it("fails closed when required provenance cannot be saved", async () => {
    backend.failures.set("affaire_intake_events", "simulated_audit_failure");
    expect((await request()).results[0].status).toBe("failed");
    expect(backend.objects.size).toBe(0);
  });
  it("refuses another tenant/affaire before any Google or storage access", async () => {
    auth.mockRejectedValue(new Error("cross-tenant denied"));
    await expect(request()).rejects.toThrow("cross-tenant denied");
    expect(google.fetchMock).not.toHaveBeenCalled(); expect(backend.objects.size).toBe(0);
  });
  it("fails only the pieces of a folder that became unavailable in a multi-folder lot", async () => {
    google.files.set("folder_trashed", { id: "folder_trashed", name: "Dossier supprimé", mimeType: "application/vnd.google-apps.folder", trashed: true });
    google.files.get("cctp_demo")!.parents = ["folder_trashed"];
    const lot = [selection(), { ...selection("cctp_demo"), folderId: "folder_trashed" }];
    const result = await request(lot);
    expect(result.results.map(({ fileId, status }) => [fileId, status])).toEqual([["plan_demo", "imported"], ["cctp_demo", "failed"]]);
    expect(result.results[1].message).toContain("dossier personnel Google Drive accessible");
    expect(result.uploads).toEqual([lotUploadId(lot)]);
    expect(backend.objects.size).toBe(1);
    expect(backend.rows("affaire_intake_documents").size).toBe(1);
  });
  it("rejects a valid file from another folder", async () => {
    google.files.get("plan_demo")!.parents = ["other_folder"];
    expect((await request()).results[0]).toMatchObject({ status: "failed", message: expect.stringContaining("extérieure") });
    expect(backend.objects.size).toBe(0);
  });
  it("does not start new content reads after cancellation", async () => {
    const abort = new AbortController(); abort.abort();
    await expect(executeDriveRequest("project_demo", { action: "import", token: "fiction", folderId: "folder_demo", files: [selection()] }, abort.signal))
      .rejects.toMatchObject({ name: "ApiError", code: "DRIVE_NETWORK" });
    expect(backend.objects.size).toBe(0);
  });
  it("does not contact Google when disabled", async () => {
    vi.stubEnv("MERGEONE_GOOGLE_DRIVE_ENABLED", "false");
    await expect(request()).rejects.toMatchObject({ code: "DRIVE_DISABLED" });
    expect(google.fetchMock).not.toHaveBeenCalled();
    expect(await driveState("project_demo")).toMatchObject({ enabled: false, clientId: undefined });
  });
  it("rejects excessive cumulative size before reading any content", async () => {
    google.files.get("plan_demo")!.size = String(DRIVE_MAX_BATCH_BYTES);
    await expect(request([selection(), selection("cctp_demo")])).rejects.toThrow("100 Mo");
    expect(google.fetchMock.mock.calls.every(([url]) => !String(url).includes("alt=media"))).toBe(true);
    expect(backend.objects.size).toBe(0);
  });
  it("limits the request and isolates stable identities by tenant and affaire", () => {
    const body = { action: "import", token: "fiction", folderId: "folder_demo", files: Array.from({ length: DRIVE_MAX_FILES + 1 }, () => selection()) };
    expect(driveRequestSchema.safeParse(body).success).toBe(false);
    expect(driveCopyId("tenant_a", "project_a", "file", "1")).not.toBe(driveCopyId("tenant_b", "project_a", "file", "1"));
    expect(driveCopyId("tenant_a", "project_a", "file", "1")).not.toBe(driveCopyId("tenant_a", "project_b", "file", "1"));
    const lot = [selection(), selection("cctp_demo")];
    expect(driveBatchUploadId("tenant_a", "project_a", lot)).toBe(driveBatchUploadId("tenant_a", "project_a", [...lot].reverse()));
    expect(driveBatchUploadId("tenant_a", "project_a", lot)).not.toBe(driveBatchUploadId("tenant_b", "project_a", lot));
    expect(driveBatchUploadId("tenant_a", "project_a", lot)).not.toBe(driveBatchUploadId("tenant_a", "project_b", lot));
    expect(driveBatchUploadId("tenant_a", "project_a", lot)).not.toBe(driveBatchUploadId("tenant_a", "project_a", [selection(), selection("cctp_demo", "2")]));
  });
});
