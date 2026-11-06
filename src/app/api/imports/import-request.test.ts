import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as importFile } from "@/app/api/imports/route";
import { POST as reviewFile } from "@/app/api/imports/tabular-pdf/review-file/route";
import { POST as reviewTables } from "@/app/api/imports/tabular-pdf/review/route";
import { readActiveTenantMembership, readAuthenticatedUser } from "@/lib/auth/tenant-context";
import { createImportFromJsonBody, createImportFromMultipartFormData, reviewTabularPdfImportFile } from "@/lib/imports/server";

vi.mock("@/lib/auth/tenant-context", () => ({
  readAuthenticatedUser: vi.fn(),
  readActiveTenantMembership: vi.fn(),
}));
vi.mock("@/lib/imports/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/imports/server")>(),
  createImportFromJsonBody: vi.fn(async () => ({ id: "created" })),
  createImportFromMultipartFormData: vi.fn(async () => ({ id: "created" })),
  reviewTabularPdfImportFile: vi.fn(async () => ({ tables: [] })),
}));

const MiB = 1024 * 1024;
const url = "http://localhost/api/imports";

function session(role: "engineer" | "viewer" | null) {
  vi.mocked(readAuthenticatedUser).mockResolvedValue({
    user: role ? { id: "user" } : null, error: null, supabase: {},
  } as Awaited<ReturnType<typeof readAuthenticatedUser>>);
  vi.mocked(readActiveTenantMembership).mockResolvedValue({
    membership: { tenant_id: "tenant", role }, error: null,
  } as Awaited<ReturnType<typeof readActiveTenantMembership>>);
}

function unreadRequest(type: string) {
  const read = vi.fn(() => { throw new Error("body accessed"); });
  return { read, request: { headers: new Headers({ "content-type": type }), get body() { return read(); },
    json: read, formData: read } as unknown as Request };
}

function chunked(bytes: number, type: string, declared?: string) {
  const chunk = new Uint8Array(MiB).fill(32);
  let remaining = bytes;
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (remaining === 0) return controller.close();
      const length = Math.min(remaining, chunk.byteLength);
      controller.enqueue(chunk.subarray(0, length));
      remaining -= length;
    },
    cancel,
  }, { highWaterMark: 0 });
  const headers = new Headers({ "content-type": type });
  if (declared) headers.set("content-length", declared);
  const init: RequestInit & { duplex: "half" } = { method: "POST", headers, body, duplex: "half" };
  return { request: new Request(url, init), cancel };
}

beforeEach(() => { vi.clearAllMocks(); session("engineer"); });

describe("import request admission", () => {
  it.each([
    [importFile, "multipart/form-data; boundary=probe"],
    [importFile, "application/json"],
    [reviewFile, "multipart/form-data; boundary=probe"],
  ] as const)("refuses anonymous calls before reading the body (%s, %s)", async (post, type) => {
    session(null);
    const { read, request } = unreadRequest(type);
    const response = await post(request);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(read).not.toHaveBeenCalled();
  });

  it("reviews caller-supplied JSON without a session", async () => {
    session(null);
    const body = { tables: [{ page: 1, tableIndex: 0, headers: ["Désignation", "Quantité"],
      rows: [{ rowIndex: 0, cells: ["Robinet", "2"] }] }] };
    const response = await reviewTables(new Request(url, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body) }));
    expect(response.status).toBe(200);
    expect((await response.json()).data.summary.total_rows).toBe(1);
    expect(readAuthenticatedUser).not.toHaveBeenCalled();
  });

  it.each(["application/json", "multipart/form-data; boundary=probe"])("refuses a viewer before importing %s", async (type) => {
    session("viewer");
    const { read, request } = unreadRequest(type);
    expect((await importFile(request)).status).toBe(403);
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    [importFile, "multipart/form-data; boundary=probe", 51 * MiB, undefined],
    [reviewFile, "multipart/form-data; boundary=probe", 51 * MiB, "1"],
    [importFile, "application/json", 50 * MiB, "1"],
    [reviewTables, "application/json", 10 * MiB, undefined],
  ] as const)("rejects excess streamed bytes (%s, %s)", async (post, type, limit, declared) => {
    // Two extra chunks so the server must stop before the stream ends.
    const { request, cancel } = chunked(limit + 2 * MiB, type, declared);
    const response = await post(request);
    expect(response.status).toBe(413);
    expect(cancel).toHaveBeenCalled();
    expect(createImportFromMultipartFormData).not.toHaveBeenCalled();
    expect(createImportFromJsonBody).not.toHaveBeenCalled();
    expect(reviewTabularPdfImportFile).not.toHaveBeenCalled();
  });

  it("rejects a declared excess without consuming the stream", async () => {
    const { read, request } = unreadRequest("application/json");
    request.headers.set("content-length", String(50 * MiB + 1));
    expect((await importFile(request)).status).toBe(413);
    expect(read).not.toHaveBeenCalled();
  });

  it("accepts a JSON body at its byte limit, including multibyte text", async () => {
    const input = { filename: "Étage.csv", rows: [] };
    const json = JSON.stringify(input);
    const exact = json + " ".repeat(50 * MiB - Buffer.byteLength(json));
    const response = await importFile(new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: exact }));
    expect(response.status).toBe(201);
    expect(vi.mocked(createImportFromJsonBody).mock.calls[0][0]).toEqual(input);
  });

  it.each(["csv", "xls", "xlsx", "pdf"])("passes the browser's file and import fields to the domain (%s)", async (ext) => {
    const form = new FormData();
    form.append("file", new File(["sample"], `pièce.${ext}`));
    form.append("headerRowNumber", "2");
    expect((await importFile(new Request(url, { method: "POST", body: form }))).status).toBe(201);
    const passed = vi.mocked(createImportFromMultipartFormData).mock.calls[0][0];
    const file = passed.get("file") as File;
    expect([file.name, await file.text(), passed.get("headerRowNumber")]).toEqual([`pièce.${ext}`, "sample", "2"]);
  });

  it("accepts a viewer's PDF at the existing file limit for a read-only review", async () => {
    session("viewer");
    const form = new FormData();
    form.set("file", new File(["%PDF-", new Uint8Array(50 * MiB - 5)], "plan.pdf", { type: "application/pdf" }));
    expect((await reviewFile(new Request(url, { method: "POST", body: form }))).status).toBe(200);
    expect(vi.mocked(reviewTabularPdfImportFile).mock.calls[0][0].file.size).toBe(50 * MiB);
  });

  it("retains invalid JSON and malformed multipart errors for admitted callers", async () => {
    for (const type of ["application/json", "multipart/form-data; boundary=missing"]) {
      const response = await importFile(new Request(url, { method: "POST", headers: { "content-type": type }, body: "{" }));
      expect(response.status).toBe(400);
    }
  });
});
