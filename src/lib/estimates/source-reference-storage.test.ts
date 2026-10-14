import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import type { SourceReferenceReview } from "@/lib/estimates/source-reference-contracts";
import { readSourceReferenceReview } from "@/lib/estimates/source-reference-review";
import { createSourceReferenceStorage } from "@/lib/estimates/source-reference-storage";

vi.mock("@/lib/estimates/source-reference-review", () => ({ readSourceReferenceReview: vi.fn() }));

// Written before implementation. Transport/socket gaps and proof limits are in
// docs/testing/source-reference-storage.md; these are not Auth/RLS assertions.
const ids = {
  actorId: "627ef300-1111-4111-8111-111111111111", tenantId: "627ef300-2222-4222-8222-222222222222",
  projectId: "627ef300-3333-4333-8333-333333333333", versionId: "627ef300-4444-4444-8444-444444444444",
  copyId: "627ef300-5555-4555-8555-555555555555", uploadId: "627ef300-6666-4666-8666-666666666666",
  documentId: "627ef300-7777-4777-8777-777777777777",
};
const destinationLocator = { bucket: "estimate-source-references" as const, path: `${ids.tenantId}/${ids.projectId}/${ids.versionId}/${ids.copyId}/reference.pdf` };
const sourceLocator = { bucket: "affaire-intake" as const, path: `${ids.tenantId}/${ids.projectId}/${ids.uploadId}/${ids.documentId}/CCTP.pdf` };
const authorization = {
  ...ids, purpose: "prepare" as const, destinationLocator,
  reservation: { copy_id: ids.copyId, version_id: ids.versionId, review_revision: 0, state: "pending" as const, replayed: false, source_locator: sourceLocator, destination_locator: destinationLocator },
};
const getSession = vi.fn(), getUser = vi.fn();
const context = {
  userId: ids.actorId, tenantId: ids.tenantId, tenantRole: "engineer",
  supabase: { auth: { getSession, getUser } },
} as unknown as AuthenticatedTenantContext;
const pendingReview: SourceReferenceReview = {
  versionId: ids.versionId, projectId: ids.projectId, revision: 0, activeReference: null,
  selectedCopy: { copyId: ids.copyId, fileName: "CCTP.pdf", createdAt: "2026-10-12T00:00:00Z", state: "pending", sha256: null, byteSize: null, pageCount: null, verifiedAt: null },
  history: [], nextBeforeRevision: null, confirmationReceipt: null,
};
const servers: Server[] = [];
const timers: ReturnType<typeof setInterval>[] = [];
const requests: { url: string; method: string; auth?: string; upsert?: string }[] = [];

async function server(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const instance = createServer((req, res) => {
    requests.push({ url: req.url ?? "", method: req.method ?? "", auth: req.headers.authorization, upsert: req.headers["x-upsert"] as string | undefined });
    handler(req, res);
  });
  servers.push(instance);
  await new Promise<void>((resolve) => instance.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(instance.address() as AddressInfo).port}`;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", origin);
  return origin;
}

function endless(res: ServerResponse, byteCount: number) {
  let sent = 0;
  res.flushHeaders();
  const timer = setInterval(() => {
    if (res.destroyed || sent >= byteCount) { clearInterval(timer); return; }
    if (res.writableLength > 256 * 1024) return;
    const size = Math.min(65536, byteCount - sent);
    res.write(Buffer.alloc(size, 65)); sent += size;
  }, 1);
  timers.push(timer);
}

beforeEach(() => {
  requests.length = 0;
  getSession.mockReset().mockResolvedValue({ data: { session: { access_token: "fixture-user-token", user: { id: ids.actorId } } }, error: null });
  getUser.mockReset().mockResolvedValue({ data: { user: { id: ids.actorId } }, error: null });
  vi.mocked(readSourceReferenceReview).mockReset().mockResolvedValue(pendingReview);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "fixture-public-key");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture-service-key");
});

afterEach(async () => {
  for (const timer of timers.splice(0)) clearInterval(timer);
  await Promise.all(servers.splice(0).map(async (instance) => {
    instance.closeAllConnections();
    await new Promise<void>((resolve) => instance.close(() => resolve()));
  }));
  vi.unstubAllEnvs();
});

describe.sequential("source reference Storage transport boundaries", () => {
  it("closes a success stream on the first byte beyond 50 MiB without waiting for EOF", async () => {
    let closed = false, finished = false;
    await server((_req, res) => {
      res.on("close", () => { closed = true; }); res.on("finish", () => { finished = true; });
      endless(res, 50 * 1024 * 1024 + 1);
    });
    const storage = await createSourceReferenceStorage({ context, authorization });
    await expect(storage.readSource()).rejects.toMatchObject({ code: "STORAGE_TOO_LARGE" });
    await vi.waitFor(() => expect(closed).toBe(true), { timeout: 2000 });
    expect(finished).toBe(false); expect(requests).toHaveLength(1);
  }, 10_000);

  it("closes a huge error body at 64 KiB and hides its private content", async () => {
    let closed = false;
    await server((_req, res) => { res.statusCode = 400; res.on("close", () => { closed = true; }); endless(res, 65537); });
    const storage = await createSourceReferenceStorage({ context, authorization });
    await expect(storage.readCopy()).rejects.toMatchObject({ code: "STORAGE_INVALID_RESPONSE", message: "Réponse du stockage invalide." });
    await vi.waitFor(() => expect(closed).toBe(true), { timeout: 2000 });
    expect(requests).toHaveLength(1);
  }, 10_000);

  it("aborts an open body after headers and actually closes the upstream connection", async () => {
    const controller = new AbortController(); let closed = false;
    let sawBody!: () => void;
    const started = new Promise<void>((resolve) => { sawBody = resolve; });
    await server((_req, res) => { res.on("close", () => { closed = true; }); res.write(Buffer.alloc(1024)); sawBody(); });
    const storage = await createSourceReferenceStorage({ context, authorization, signal: controller.signal });
    const task = storage.readCopy();
    const refused = expect(task).rejects.toMatchObject({ code: "STORAGE_ABORTED" });
    await started; controller.abort(); await refused;
    await vi.waitFor(() => expect(closed).toBe(true), { timeout: 2000 });
    expect(requests).toHaveLength(1);
  }, 10_000);

  it("refuses a redirect without ever contacting its target", async () => {
    let targetRequests = 0;
    const origin = await server((req, res) => {
      if (req.url === "/redirect-target") { targetRequests += 1; res.end("private"); return; }
      res.writeHead(302, { location: `${origin}/redirect-target` }); res.end();
    });
    const storage = await createSourceReferenceStorage({ context, authorization });
    await expect(storage.readCopy()).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(targetRequests).toBe(0); expect(requests).toHaveLength(1);
  }, 10_000);

  it("keeps a forbidden source on the user credential without a service retry", async () => {
    await server((_req, res) => { res.writeHead(403, { "content-type": "application/json" }); res.end(JSON.stringify({ code: "AccessDenied", message: "PRIVATE_LOCATOR_fixture" })); });
    const storage = await createSourceReferenceStorage({ context, authorization });
    await expect(storage.readSource()).rejects.toMatchObject({ code: "STORAGE_ACCESS_DENIED", message: "Accès au document refusé." });
    expect(requests).toHaveLength(1); expect(requests[0].auth).toBe("Bearer fixture-user-token");
    expect(getUser).toHaveBeenCalledWith("fixture-user-token");
  }, 10_000);

  it.each(["unverified-session", "copy-inaccessible", "path-traversal"])("emits no Storage request for %s", async (failure) => {
    await server((_req, res) => res.end("must not be requested"));
    if (failure === "unverified-session") getUser.mockResolvedValue({ data: { user: null }, error: { message: "PRIVATE_AUTH_DETAIL" } });
    if (failure === "copy-inaccessible") vi.mocked(readSourceReferenceReview).mockResolvedValue({ ...pendingReview, selectedCopy: null });
    const scoped = failure === "path-traversal" ? { ...authorization, destinationLocator: { ...destinationLocator, path: `${destinationLocator.path}/../../other` } } : authorization;
    await expect(createSourceReferenceStorage({ context, authorization: scoped })).rejects.toBeInstanceOf(Error);
    expect(requests).toHaveLength(0);
  }, 10_000);

  it("reports an upload conflict after one service POST with exact bytes and no upsert", async () => {
    const input = Uint8Array.from([37, 80, 68, 70]).buffer; let received = Buffer.alloc(0);
    await server((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => { received = Buffer.concat(chunks); res.writeHead(409, { "content-type": "application/json" }); res.end(JSON.stringify({ code: "ResourceAlreadyExists" })); });
    });
    const storage = await createSourceReferenceStorage({ context, authorization });
    expect(await storage.uploadCopy({ bytes: input, byteSize: input.byteLength, pageCount: 1 })).toBe("conflict");
    expect(received).toEqual(Buffer.from(input)); expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: "POST", auth: "Bearer fixture-service-key", upsert: "false" });
  }, 10_000);

  it("never recreates an unavailable verified copy even during preparation", async () => {
    await server((_req, res) => { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ code: "NoSuchKey", statusCode: "404", error: "Object not found", message: "Object not found" })); });
    vi.mocked(readSourceReferenceReview).mockResolvedValue({ ...pendingReview, selectedCopy: { ...pendingReview.selectedCopy!, state: "verified", sha256: "a".repeat(64), byteSize: 4, pageCount: 1, verifiedAt: "2026-10-12T00:00:00Z" } });
    const storage = await createSourceReferenceStorage({ context, authorization: { ...authorization, reservation: { ...authorization.reservation, state: "verified" } } });
    await expect(storage.readCopy()).rejects.toMatchObject({ code: "STORAGE_SOURCE_UNAVAILABLE" });
    await expect(storage.readSource()).rejects.toMatchObject({ code: "STORAGE_ACCESS_DENIED" });
    await expect(storage.uploadCopy({ bytes: new ArrayBuffer(4), byteSize: 4, pageCount: 1 })).rejects.toMatchObject({ code: "STORAGE_ACCESS_DENIED" });
    expect(requests).toHaveLength(1);
  }, 10_000);
});
