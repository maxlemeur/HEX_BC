import { describe, expect, it, vi } from "vitest";
import { deleteIntakeDocumentCopy } from "./intake-document-store";

type Access = Parameters<typeof deleteIntakeDocumentCopy>[0];
function fixture() {
  const document = { id: "document", updated_at: "2026-10-25T17:00:00Z", upload_id: "upload", storage_path: "tenant/project/upload/document/file.pdf", deleted_at: null as string | null, deletion_token: null as string | null, deletion_started_at: null as string | null, upload_status: "uploaded", classification_status: "classified" };
  const bytes = new Map([["affaire-intake:" + document.storage_path, new Blob(["source"])], ["plan-files:plan-path", new Blob(["plan"])]]);
  let uploadStatus = "ready";
  let failRemoval = false;
  let silentRemoval = false;
  let primaryTaken = false;
  const plans = [{ id: "plan", file_path: "plan-path" }];
  const remove = vi.fn(async (bucket: string, paths: string[]) => {
    if (failRemoval) return { error: new Error("Storage unavailable") };
    if (!silentRemoval) paths.forEach((path) => bytes.delete(bucket + ":" + path));
    return { data: [], error: null };
  });
  const supabase = {
    storage: { from: (bucket: string) => ({ remove: (paths: string[]) => remove(bucket, paths), download: async (path: string) => ({ data: bytes.get(bucket + ":" + path) ?? null, error: bytes.has(bucket + ":" + path) ? null : { statusCode: "404" } }) }) },
    from: (table: string) => {
      let mutation: Record<string, unknown> | undefined;
      let deleting = false;
      const filters = new Map<string, unknown>();
      const nullFilters = new Set<string>();
      const result = () => {
        if (table === "affaire_intake_uploads") return { data: { status: uploadStatus }, error: null };
        if (table === "plan_files") { if (deleting) return { data: plans.splice(0), error: null }; return { data: [...plans], error: null }; }
        if (filters.get("tenant_id") !== "tenant" || filters.get("project_id") !== "project") return { data: null, error: null };
        if ([...nullFilters].some((column) => (document as unknown as Record<string, unknown>)[column] != null)) return { data: [], error: null };
        if (filters.has("deletion_token") && filters.get("deletion_token") !== document.deletion_token) return { data: [], error: null };
        // One principal per kind: another piece already holds the role.
        if (primaryTaken && mutation?.document_priority === "primary") return { data: null, error: { code: "23505" } };
        if (mutation) { Object.assign(document, mutation); return { data: [{ id: document.id }], error: null }; }
        return { data: { ...document }, error: null };
      };
      const query = { select: vi.fn(() => query), eq: vi.fn((name, value) => { filters.set(name, value); return query; }), is: vi.fn((column) => { nullFilters.add(column); return query; }), contains: vi.fn(() => query), delete: vi.fn(() => { deleting = true; return query; }), update: vi.fn((patch) => { mutation = patch; return query; }), maybeSingle: async () => result(), single: async () => result(), then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve) };
      return query;
    },
  };
  return { access: { context: { supabase, tenantId: "tenant", userId: "user" }, project: { id: "project" } } as unknown as Access,
    document, bytes, remove, processing: () => { uploadStatus = "processing"; }, fail: () => { failRemoval = true; }, silent: () => { silentRemoval = true; }, takePrimary: () => { primaryTaken = true; } };
}
describe("deleteIntakeDocumentCopy", () => {
  it("removes both private copies before marking the dossier document deleted; replay is harmless", async () => {
    const f = fixture();
    await expect(deleteIntakeDocumentCopy(f.access, "document")).resolves.toEqual({ documentId: "document", deleted: true });
    expect(f.bytes.size).toBe(0);
    expect(f.document.deleted_at).toBeTruthy();
    expect(f.document.storage_path).toBeNull();
    expect(f.document.upload_status).toBe("rejected");
    await deleteIntakeDocumentCopy(f.access, "document");
    expect(f.remove).toHaveBeenCalledTimes(2);
  });
  it("refreshes the derived state once the bytes are gone, while the piece is still reserved and no longer principal", async () => {
    const f = fixture();
    const document = Object.assign(f.document, { document_priority: "primary" });
    const seen: unknown[] = [];
    const refresh = vi.fn(async (removed: { uploadId: string; wasUploaded: boolean }) => {
      seen.push({ removed, bytes: f.bytes.size, deletedAt: document.deleted_at, reserved: Boolean(document.deletion_token), priority: document.document_priority });
    });
    await deleteIntakeDocumentCopy(f.access, "document", refresh);
    expect(seen).toEqual([{ removed: { uploadId: "upload", wasUploaded: true }, bytes: 0, deletedAt: null, reserved: true, priority: "secondary" }]);
    expect(f.document.deleted_at).toBeTruthy();
    // A replay on the tombstone, e.g. from a stale tab, does not refresh again.
    await deleteIntakeDocumentCopy(f.access, "document", refresh);
    expect(refresh).toHaveBeenCalledOnce();
  });
  it("releases the piece when its refresh is interrupted, and a retry completes both", async () => {
    const f = fixture();
    Object.assign(f.document, { document_priority: "primary" });
    const refresh = vi.fn().mockRejectedValueOnce(new Error("brief unavailable")).mockResolvedValue(undefined);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(deleteIntakeDocumentCopy(f.access, "document", refresh)).rejects.toThrow("actualisation du dossier interrompue. Reprenez la suppression");
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
    // Its bytes are gone: it stays out of the principal role the refresh already handed on.
    expect(f.document).toMatchObject({ deleted_at: null, deletion_token: null, document_priority: "secondary" });
    expect(f.bytes.size).toBe(0);
    await expect(deleteIntakeDocumentCopy(f.access, "document", refresh)).resolves.toEqual({ documentId: "document", deleted: true });
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(f.document.deleted_at).toBeTruthy();
  });
  it("tells the refresh that a rejected piece fed nothing derived", async () => {
    const f = fixture(); f.document.upload_status = "rejected";
    const refresh = vi.fn(async () => {});
    await deleteIntakeDocumentCopy(f.access, "document", refresh);
    expect(refresh).toHaveBeenCalledWith({ uploadId: "upload", wasUploaded: false });
  });
  it("keeps the document visible, and principal, when Storage fails", async () => {
    const f = fixture(); f.fail();
    Object.assign(f.document, { document_priority: "primary" });
    await expect(deleteIntakeDocumentCopy(f.access, "document")).rejects.toThrow("Suppression du fichier interrompue");
    expect(f.document).toMatchObject({ deleted_at: null, deletion_token: null, document_priority: "primary" });
    expect(f.bytes.size).toBe(2);
  });
  it("renews the reservation lease before the refresh", async () => {
    const f = fixture();
    const leases: Array<{ token: unknown; startedAt: unknown }> = [];
    const original = f.remove.getMockImplementation()!;
    f.remove.mockImplementation(async (bucket, paths) => {
      // The removal outlived most of its lease.
      f.document.deletion_started_at = new Date(Date.now() - 110_000).toISOString();
      leases.push({ token: f.document.deletion_token, startedAt: f.document.deletion_started_at });
      return original(bucket, paths);
    });
    await deleteIntakeDocumentCopy(f.access, "document", async () => {
      leases.push({ token: f.document.deletion_token, startedAt: f.document.deletion_started_at });
    });
    const [reserved, , refreshing] = leases;
    expect(refreshing.token).not.toBe(reserved.token);
    expect(Date.now() - Date.parse(String(refreshing.startedAt))).toBeLessThan(10_000);
    expect(f.document.deleted_at).toBeTruthy();
  });
  it("releases an early failure as secondary when another piece already became principal", async () => {
    const f = fixture(); f.fail(); f.takePrimary();
    Object.assign(f.document, { document_priority: "primary" });
    await expect(deleteIntakeDocumentCopy(f.access, "document")).rejects.toThrow("Suppression du fichier interrompue");
    expect(f.document).toMatchObject({ deleted_at: null, deletion_token: null, document_priority: "secondary" });
  });
  it("does not claim success when Storage silently keeps an object", async () => {
    const f = fixture(); f.silent();
    await expect(deleteIntakeDocumentCopy(f.access, "document")).rejects.toThrow("n’a pas pu être confirmée");
    expect(f.document.deleted_at).toBeNull();
  });
  it("refuses deletion during active processing before touching files", async () => {
    const f = fixture(); f.processing();
    await expect(deleteIntakeDocumentCopy(f.access, "document")).rejects.toThrow("Attendez la fin");
    expect(f.remove).not.toHaveBeenCalled();
  });
  it("does not touch another tenant's document", async () => {
    const f = fixture(); f.access.context.tenantId = "other";
    await expect(deleteIntakeDocumentCopy(f.access, "document")).rejects.toThrow("Document introuvable");
    expect(f.remove).not.toHaveBeenCalled();
  });
  it("does not allow a second deletion to race the reserved operation", async () => {
    const f = fixture();
    let resume: () => void = () => {};
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    const original = f.remove.getMockImplementation()!;
    f.remove.mockImplementationOnce(async (bucket, paths) => { await gate; return original(bucket, paths); });
    const first = deleteIntakeDocumentCopy(f.access, "document");
    await vi.waitFor(() => expect(f.document.deletion_token).toBeTruthy());
    await expect(deleteIntakeDocumentCopy(f.access, "document")).rejects.toThrow("suppression est en cours");
    resume();
    await first;
    expect(f.document.deleted_at).toBeTruthy();
  });

  it("recovers an expired reservation after an interrupted process", async () => {
    const f = fixture();
    f.document.deletion_token = "abandoned-token";
    f.document.deletion_started_at = new Date(Date.now() - 180_000).toISOString();
    await deleteIntakeDocumentCopy(f.access, "document");
    expect(f.document.deleted_at).toBeTruthy();
    expect(f.bytes.size).toBe(0);
  });
});
