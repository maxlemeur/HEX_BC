import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const backendRef = vi.hoisted(() => ({ current: undefined as undefined | { supabase: unknown } }));
vi.mock("@/lib/affaires/intake-server", () => ({ requireAffaireProjectOwnerOrAdmin: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => backendRef.current!.supabase }));
import { requireAffaireProjectOwnerOrAdmin } from "@/lib/affaires/intake-server";
import { saveDriveConnection } from "./connections";
import { readLinkedDriveDocument, readLinkedDriveFile } from "./content";
import type { DriveRequest } from "./contracts";
import { driveState, executeDriveRequest } from "./server";
import { driveConfiguration } from "./secrets";
import { fakeDrive, memoryBackend } from "./memory.test-utils";
import { rearmLotsFailedWithConnection } from "./store";

const TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");
describe("Drive accounts kept on the server and pieces linked without copies (Google simulated)", () => {
  let backend: ReturnType<typeof memoryBackend>;
  let google: ReturnType<typeof fakeDrive>;
  let connectionId: string;
  const auth = vi.mocked(requireAffaireProjectOwnerOrAdmin);
  const execute = (request: DriveRequest) => executeDriveRequest("project_demo", request, new AbortController().signal);
  const link = (files: Array<{ id: string; folderId?: string }> = [{ id: "plan_demo", folderId: "folder_demo" }]) =>
    execute({ action: "link_files", connectionId, files }) as Promise<{ results: Array<{ fileId: string; status: string; message: string }>; uploads: string[] }>;
  const downloads = () => google.fetchMock.mock.calls.filter(([url]) => String(url).includes("alt=media")).length;
  const configuration = () => driveConfiguration() as Extract<ReturnType<typeof driveConfiguration>, { enabled: true }>;
  beforeEach(async () => {
    backend = memoryBackend(); google = fakeDrive(); backendRef.current = backend;
    vi.stubGlobal("fetch", google.fetchMock);
    vi.stubEnv("MERGEONE_GOOGLE_DRIVE_ENABLED", "true");
    vi.stubEnv("MERGEONE_GOOGLE_DRIVE_CLIENT_ID", "fictitious-client");
    vi.stubEnv("MERGEONE_GOOGLE_DRIVE_CLIENT_SECRET", "fictitious-secret");
    vi.stubEnv("MERGEONE_GOOGLE_DRIVE_TOKEN_KEY", TOKEN_KEY);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fictitious-service-role");
    auth.mockReset().mockResolvedValue(backend.access as never);
    // An expired access token: every use must go through the stored refresh token.
    connectionId = await saveDriveConnection(backend.access.context, configuration(),
      { permissionId: "google_account_demo", emailAddress: "poc@example.invalid", displayName: "Compte fictif" },
      { refreshToken: "fictitious-refresh-token", accessToken: "expired", expiresAt: 0 });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("keeps an added account between visits without ever exposing its token", async () => {
    const secret = backend.rows("google_drive_connection_secrets").get(connectionId)!;
    expect(String(secret.refresh_token_ciphertext)).toMatch(/^v1\./);
    expect(JSON.stringify([...backend.tables.entries()].map(([, table]) => [...table.values()]))).not.toContain("fictitious-refresh-token");
    const state = await driveState("project_demo");
    expect(state.connections).toEqual([{ id: connectionId, email: "poc@example.invalid", displayName: "Compte fictif", status: "active" }]);
    expect(JSON.stringify(state)).not.toMatch(/fictitious-refresh-token|access-|v1\./);
    // Back on the affaire: the browser names the account only; the server renews access itself.
    const result = await execute({ action: "list", connectionId, location: { kind: "folder", folderId: "folder_demo" } });
    expect(result).toMatchObject({ listing: { folder: { id: "folder_demo" }, files: [{ id: "plan_demo" }, { id: "cctp_demo" }] } });
    expect(google.tokens).toEqual([{ grant_type: "refresh_token", refresh_token: "fictitious-refresh-token", client_id: "fictitious-client", client_secret: "fictitious-secret" }]);
    expect(JSON.stringify(result)).not.toContain("access-");
    expect(downloads()).toBe(0);
    expect(backend.rows("affaire_intake_documents").size).toBe(0);
  });
  it("browses files shared with the member and shared drives", async () => {
    google.files.set("shared_demo", { id: "shared_demo", name: "Drive de Maxime", mimeType: "application/vnd.google-apps.folder" });
    google.sharedWithMe.add("shared_demo");
    expect(await execute({ action: "list", connectionId, location: { kind: "shared_with_me" } }))
      .toMatchObject({ listing: { location: { kind: "shared_with_me" }, files: [{ id: "shared_demo", name: "Drive de Maxime" }] } });
    expect(await execute({ action: "list", connectionId, location: { kind: "shared_drives" } }))
      .toMatchObject({ listing: { files: [{ id: "shared_drive_demo", name: "Drive partagé fictif", driveId: "shared_drive_demo" }] } });
    const listings = google.fetchMock.mock.calls.map(([url]) => new URL(String(url))).filter((url) => url.pathname.endsWith("/files"));
    expect(listings.every((url) => url.searchParams.get("supportsAllDrives") === "true")).toBe(true);
  });
  it("links files as pieces without transferring their content, once per file", async () => {
    const first = await link();
    expect(first.results).toEqual([expect.objectContaining({ fileId: "plan_demo", status: "linked" })]);
    expect(first.uploads).toHaveLength(1);
    expect(downloads()).toBe(0);
    const [document] = [...backend.rows("affaire_intake_documents").values()];
    expect(document).toMatchObject({ storage_path: null, upload_status: "uploaded", classification_status: "queued", source_provider: "google_drive",
      drive_connection_id: connectionId, drive_file_id: "plan_demo", drive_folder_id: "folder_demo", drive_folder_name: "Dossier fictif POC", drive_revision: "1" });
    expect(backend.rows("affaire_intake_uploads").get(first.uploads[0])).toMatchObject({ status: "queued", last_error: null });
    const replay = await link();
    expect(replay.results[0].status).toBe("already_linked");
    expect(replay.uploads).toEqual([]);
    expect(backend.rows("affaire_intake_documents").size).toBe(1);
    const state = await driveState("project_demo");
    expect(state.links).toEqual([expect.objectContaining({ documentId: document.id,
      source: expect.objectContaining({ fileId: "plan_demo", sourceUrl: "https://drive.google.com/file/d/plan_demo/view", revision: "1", connectionAvailable: true }) })]);
  });
  it("fails only the pieces that cannot be linked", async () => {
    google.files.set("native_demo", { id: "native_demo", name: "Note", mimeType: "application/vnd.google-apps.document", version: "1", parents: ["folder_demo"] });
    google.files.set("elsewhere_demo", { id: "elsewhere_demo", name: "ailleurs.txt", mimeType: "text/plain", size: "5", version: "1", parents: ["root_demo"] });
    const result = await link([{ id: "plan_demo", folderId: "folder_demo" }, { id: "native_demo", folderId: "folder_demo" },
      { id: "elsewhere_demo", folderId: "folder_demo" }, { id: "cctp_demo" }]);
    expect(Object.fromEntries(result.results.map(({ fileId, status }) => [fileId, status])))
      .toEqual({ plan_demo: "linked", cctp_demo: "linked", native_demo: "failed", elsewhere_demo: "failed" });
    expect(result.results.find((item) => item.fileId === "elsewhere_demo")!.message).toContain("plus dans le dossier");
    expect([...backend.rows("affaire_intake_documents").values()].find((row) => row.drive_file_id === "cctp_demo")).toMatchObject({ drive_folder_id: null });
    await expect(link([{ id: "plan_demo" }, { id: "plan_demo" }])).rejects.toMatchObject({ status: 400 });
  });
  it("remembers the affaire's Drive folder until it is unlinked", async () => {
    expect(await execute({ action: "link_folder", connectionId, folderId: "folder_demo" }))
      .toMatchObject({ folder: { folderId: "folder_demo", folderName: "Dossier fictif POC", connectionId, url: "https://drive.google.com/drive/folders/folder_demo" } });
    expect((await driveState("project_demo")).folder).toMatchObject({ folderId: "folder_demo" });
    await expect(execute({ action: "link_folder", connectionId, folderId: "plan_demo" })).rejects.toMatchObject({ code: "DRIVE_NOT_FOLDER" });
    await execute({ action: "unlink_folder" });
    expect((await driveState("project_demo")).folder).toBeNull();
  });
  it("never uses another member's account", async () => {
    backend.access.context.userId = "other_member";
    await expect(execute({ action: "list", connectionId, location: { kind: "folder", folderId: "root" } }))
      .rejects.toMatchObject({ status: 404, code: "DRIVE_CONNECTION_NOT_FOUND" });
    expect((await driveState("project_demo")).connections).toEqual([]);
    expect(google.fetchMock).not.toHaveBeenCalled();
  });
  it("asks to reconnect an account whose grant Google revoked", async () => {
    google.responses.set("refresh_token", 400);
    await expect(execute({ action: "list", connectionId, location: { kind: "folder", folderId: "root" } }))
      .rejects.toMatchObject({ status: 401, code: "DRIVE_RECONNECT" });
    expect(backend.rows("google_drive_connections").get(connectionId)).toMatchObject({ status: "reconnect_required" });
    expect((await driveState("project_demo")).connections[0].status).toBe("reconnect_required");
  });
  it("revokes the grant at Google and removes the account, keeping the linked pieces", async () => {
    await link();
    expect(await execute({ action: "disconnect", connectionId })).toEqual({ revoked: true, stillUsed: false });
    expect(google.tokens.at(-1)).toEqual({ token: "fictitious-refresh-token" });
    expect(backend.rows("google_drive_connections").size).toBe(0);
    expect(backend.rows("affaire_intake_documents").size).toBe(1);
  });
  it("keeps the Google grant when the same account stays connected elsewhere", async () => {
    // Google revokes a grant for every token of that account: another tenant's connection would break.
    backend.rows("google_drive_connections").set("other_tenant_connection", { id: "other_tenant_connection", tenant_id: "another_tenant",
      user_id: "user_demo", google_account_id: "google_account_demo", email: "poc@example.invalid", display_name: "Compte fictif", status: "active" });
    expect(await execute({ action: "disconnect", connectionId })).toEqual({ revoked: false, stillUsed: true });
    expect(google.fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/revoke"))).toHaveLength(0);
    expect(backend.rows("google_drive_connections").has(connectionId)).toBe(false);
  });
  it("attaches a link whose account was removed to the account chosen again, without a second piece", async () => {
    await link();
    const [document] = [...backend.rows("affaire_intake_documents").values()];
    document.drive_connection_id = null;
    const again = await link();
    expect(again.results).toEqual([expect.objectContaining({ fileId: "plan_demo", status: "linked", message: "Lien rattaché à ce compte Google." })]);
    expect(again.uploads).toEqual([]);
    expect(backend.rows("affaire_intake_documents").size).toBe(1);
    expect(document.drive_connection_id).toBe(connectionId);
  });
  it("analyses again a reattached piece whose analysis failed without its account", async () => {
    const first = await link();
    const upload = backend.rows("affaire_intake_uploads").get(first.uploads[0])!;
    const [document] = [...backend.rows("affaire_intake_documents").values()];
    Object.assign(upload, { status: "failed", attempt_count: 3 });
    Object.assign(document, { drive_connection_id: null, classification_status: "failed" });
    const again = await link();
    expect(again.results).toEqual([expect.objectContaining({ fileId: "plan_demo", status: "linked", message: "Lien rattaché à ce compte Google. Analyse relancée." })]);
    expect(again.uploads).toEqual(first.uploads);
    expect(upload).toMatchObject({ status: "queued", last_error: null, attempt_count: 0 });
    expect(document.drive_connection_id).toBe(connectionId);
  });
  it("analyses again, after a reconnection, the pieces whose analysis failed with that account", async () => {
    const first = await link([{ id: "plan_demo" }]);
    const other = await link([{ id: "cctp_demo" }]);
    const upload = backend.rows("affaire_intake_uploads").get(first.uploads[0])!;
    const untouched = backend.rows("affaire_intake_uploads").get(other.uploads[0])!;
    const [plan, cctp] = [...backend.rows("affaire_intake_documents").values()];
    Object.assign(upload, { status: "failed", attempt_count: 1 });
    Object.assign(plan, { classification_status: "failed" });
    Object.assign(untouched, { status: "ready" });
    Object.assign(cctp, { classification_status: "classified" });
    expect(await rearmLotsFailedWithConnection(backend.access.context, connectionId)).toEqual(first.uploads);
    expect(upload).toMatchObject({ status: "queued", last_error: null, attempt_count: 0 });
    expect(untouched).toMatchObject({ status: "ready" });
    // Pieces linked with another account are left alone.
    expect(await rearmLotsFailedWithConnection(backend.access.context, "another_connection")).toEqual([]);
  });
  it("arms again a lot that an interrupted request left being recorded", async () => {
    const first = await link();
    const upload = backend.rows("affaire_intake_uploads").get(first.uploads[0])!;
    Object.assign(upload, { status: "failed", last_error: "Liens Drive en cours d'enregistrement.", created_at: new Date(Date.now() - 60_000).toISOString() });
    expect((await link()).uploads).toEqual([]);
    upload.created_at = new Date(Date.now() - 180_000).toISOString();
    const resumed = await link();
    expect(resumed.results[0].status).toBe("already_linked");
    expect(resumed.uploads).toEqual(first.uploads);
    expect(upload).toMatchObject({ status: "queued", last_error: null });
  });
  it("arms again such a lot when the Drive panel opens, since its files can no longer be selected", async () => {
    const first = await link();
    const upload = backend.rows("affaire_intake_uploads").get(first.uploads[0])!;
    Object.assign(upload, { status: "failed", last_error: "Liens Drive en cours d'enregistrement.", created_at: new Date(Date.now() - 60_000).toISOString() });
    await driveState("project_demo");
    expect(upload).toMatchObject({ status: "failed" });
    upload.created_at = new Date(Date.now() - 180_000).toISOString();
    expect((await driveState("project_demo")).links).toHaveLength(1);
    expect(upload).toMatchObject({ status: "queued", last_error: null });
  });
  it("renews an access token that Google stopped accepting", async () => {
    const list = () => execute({ action: "list", connectionId, location: { kind: "folder", folderId: "folder_demo" } });
    await list();
    google.responses.set("folder_demo", 401);
    await expect(list()).rejects.toMatchObject({ status: 401 });
    google.responses.delete("folder_demo");
    await list();
    expect(google.tokens.filter((body) => body.grant_type === "refresh_token")).toHaveLength(2);
  });
  it("stays closed while OAuth, the token key or the service role is missing", async () => {
    vi.stubEnv("MERGEONE_GOOGLE_DRIVE_TOKEN_KEY", Buffer.alloc(16).toString("base64"));
    await expect(execute({ action: "list", connectionId, location: { kind: "shared_with_me" } })).rejects.toMatchObject({ status: 503, code: "DRIVE_DISABLED" });
    expect((await driveState("project_demo")).enabled).toBe(false);
    expect(google.fetchMock).not.toHaveBeenCalled();
  });
  it("refuses a stored token sealed for another member or account", async () => {
    const secret = backend.rows("google_drive_connection_secrets").get(connectionId)!;
    backend.rows("google_drive_connections").get(connectionId)!.google_account_id = "another_account";
    await expect(execute({ action: "list", connectionId, location: { kind: "shared_with_me" } })).rejects.toThrow("illisible");
    expect(String(secret.refresh_token_ciphertext)).toMatch(/^v1\./);
    expect(google.fetchMock).not.toHaveBeenCalled();
  });
  it("lets the classifier read a linked piece with the linker's account, bounded and unchanged", async () => {
    await link();
    const [document] = [...backend.rows("affaire_intake_documents").values()] as Array<{ tenant_id: string; mime_type: string | null; drive_connection_id: string | null; drive_file_id: string | null }>;
    const read = await readLinkedDriveDocument(document);
    expect(read.bytes.toString()).toBe("plans");
    expect(read.file.version).toBe("1");
    await expect(readLinkedDriveDocument({ ...document, tenant_id: "another_tenant" })).rejects.toMatchObject({ code: "DRIVE_CONNECTION_REMOVED" });
    await expect(readLinkedDriveDocument({ ...document, drive_connection_id: null })).rejects.toThrow("a été retiré");
    await expect(readLinkedDriveDocument({ ...document, mime_type: "text/csv" })).rejects.toMatchObject({ status: 409, code: "DRIVE_FORMAT_CHANGED" });
    google.files.get("plan_demo")!.size = "50";
    await expect(readLinkedDriveDocument(document)).rejects.toThrow("incomplète");
  });
  it("asks the linker, not the reader, to reconnect an account Google stopped accepting", async () => {
    await link();
    const [document] = [...backend.rows("affaire_intake_documents").values()] as Array<{ tenant_id: string; mime_type: string | null; drive_connection_id: string | null; drive_file_id: string | null }>;
    google.responses.set("plan_demo", 401);
    const failure = await readLinkedDriveFile(document).catch((error: unknown) => error);
    expect(failure).toMatchObject({ status: 409, code: "DRIVE_EXPIRED" });
    expect((failure as Error).message).toContain("son membre doit reconnecter ce compte");
  });
});
