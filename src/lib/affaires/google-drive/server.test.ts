import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/affaires/intake-server", () => ({ requireAffaireProjectOwnerOrAdmin: vi.fn() }));
import { requireAffaireProjectOwnerOrAdmin } from "@/lib/affaires/intake-server";
import { driveRequestSchema, DRIVE_MAX_BATCH_BYTES, DRIVE_MAX_FILES } from "./contracts";
import { driveState, executeDriveRequest } from "./server";
import { driveCopyId } from "./store";
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
  });
  it("ignores a forged event parent and never schedules its upload", async () => {
    await request();
    const completed = [...backend.rows("affaire_intake_events").values()].find((event) => event.event_type === "document.uploaded")!;
    completed.upload_id = "foreign_upload";
    expect((await driveState("project_demo")).history).toEqual([]);
    const replay = await request();
    expect(replay.uploads).not.toContain("foreign_upload");
    expect(replay.results[0].uploadId).toBe(driveCopyId("tenant_demo", "project_demo", "plan_demo", "1", "upload"));
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
    expect(resumed.uploads).toEqual([driveCopyId("tenant_demo", "project_demo", "plan_demo", "1", "upload")]);
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
  it("rejects a valid file from another folder", async () => {
    google.files.get("plan_demo")!.parents = ["other_folder"];
    expect((await request()).results[0]).toMatchObject({ status: "failed", message: expect.stringContaining("extérieure") });
    expect(backend.objects.size).toBe(0);
  });
  it("does not start new content reads after cancellation", async () => {
    const abort = new AbortController(); abort.abort();
    await expect(executeDriveRequest("project_demo", { action: "import", token: "fiction", folderId: "folder_demo", files: [selection()] }, abort.signal)).rejects.toThrow();
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
  });
});
