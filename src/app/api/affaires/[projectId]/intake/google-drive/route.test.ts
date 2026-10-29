import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/affaires/google-drive/server", () => ({ driveState: vi.fn(), executeDriveRequest: vi.fn() }));
vi.mock("@/lib/affaires/intake-server", () => ({ processAffaireIntakeUpload: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({ ...await importOriginal<typeof import("next/server")>(), after: vi.fn() }));
import { after } from "next/server";
import { driveState, executeDriveRequest } from "@/lib/affaires/google-drive/server";
import { GET, POST } from "./route";
const url = "http://localhost:3000/api/affaires/11111111-1111-4111-8111-111111111111/intake/google-drive";
const context = { params: Promise.resolve({ projectId: "11111111-1111-4111-8111-111111111111" }) };
const body = { action: "list", connectionId: "22222222-2222-4222-8222-222222222222", location: { kind: "folder", folderId: "folder_demo" } };
const request = (data: unknown = body, origin = "http://localhost:3000") => new Request(url, {
  method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(data),
});
beforeEach(() => {
  vi.mocked(driveState).mockResolvedValue({ enabled: false, projectName: "Fictif", connections: [], folder: null, links: [] });
  vi.mocked(executeDriveRequest).mockResolvedValue({ results: [], uploads: [] });
});
afterEach(() => vi.clearAllMocks());
describe("Google Drive HTTP boundary", () => {
  it("marks configuration and provenance private and uncached", async () => {
    const response = await GET(new Request(url), context);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(driveState).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
  });
  it("rejects another origin before the connector", async () => {
    expect((await POST(request(body, "https://example.invalid"), context)).status).toBe(400);
    expect(executeDriveRequest).not.toHaveBeenCalled();
  });
  it("bounds streamed JSON, not just content-length", async () => {
    expect((await POST(request({ ...body, pageToken: "x".repeat(33 * 1024) }), context)).status).toBe(400);
    expect(executeDriveRequest).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON and arbitrary fields", async () => {
    const invalid = request(); Object.defineProperty(invalid, "body", { value: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("{")); controller.close(); } }) });
    expect((await POST(invalid, context)).status).toBe(400);
    expect((await POST(request({ ...body, sourceUrl: "https://example.invalid" }), context)).status).toBe(400);
    // A Google token never travels from the browser: the request names a stored account only.
    expect((await POST(request({ ...body, token: "fictitious" }), context)).status).toBe(400);
    expect(executeDriveRequest).not.toHaveBeenCalled();
  });
  it("schedules the existing classifier only for the returned owned uploads", async () => {
    vi.mocked(executeDriveRequest).mockResolvedValue({ results: [], uploads: ["44444444-4444-4444-8444-444444444444"] });
    expect((await POST(request(), context)).status).toBe(200);
    expect(after).toHaveBeenCalledTimes(1);
  });
});
