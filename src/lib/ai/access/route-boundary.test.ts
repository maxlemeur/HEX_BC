import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The routes of « Mon profil › Clé API »: local host, session, and for a write
// the page's own origin. Failure modes: a removal (DELETE, no body) refused
// for its missing JSON content type (seen in LAB05), a write from another
// origin or a non-JSON body accepted, a request through another host accepted.

const host = vi.hoisted(() => ({ value: "127.0.0.1:3000" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: host.value }) }));
vi.mock("@/lib/auth/tenant-context", () => ({ getAuthenticatedContext: async () => ({ userId: "user-1", tenantId: "tenant-1" }) }));

const { requireApiKeyOwner } = await import("@/lib/ai/access/route-boundary");

const request = (method: string, headers: Record<string, string>) => new Request("http://127.0.0.1:3000/api/ai-access/api-key", { method, headers });

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  host.value = "127.0.0.1:3000";
});
afterEach(() => vi.unstubAllEnvs());

describe("requireApiKeyOwner", () => {
  it("accepts a removal from the page's origin without a body", async () => {
    await expect(requireApiKeyOwner(request("DELETE", { origin: "http://127.0.0.1:3000" }), { write: true, json: false }))
      .resolves.toEqual({ userId: "user-1", tenantId: "tenant-1" });
  });

  it("requires the page's origin for every write, and JSON where a body is read", async () => {
    await expect(requireApiKeyOwner(request("DELETE", {}), { write: true, json: false })).rejects.toMatchObject({ code: "AI_KEY_ORIGIN" });
    await expect(requireApiKeyOwner(request("PUT", { origin: "http://127.0.0.1:3001", "content-type": "application/json" }), { write: true, json: true }))
      .rejects.toMatchObject({ code: "AI_KEY_ORIGIN" });
    await expect(requireApiKeyOwner(request("PUT", { origin: "http://127.0.0.1:3000", "content-type": "text/plain" }), { write: true, json: true }))
      .rejects.toMatchObject({ code: "AI_KEY_BODY" });
    await expect(requireApiKeyOwner(request("PUT", { origin: "http://127.0.0.1:3000", "content-type": "application/json; charset=utf-8" }),
      { write: true, json: true })).resolves.toMatchObject({ userId: "user-1" });
  });

  it("refuses another host before reading the session", async () => {
    host.value = "192.168.1.20:3000";
    await expect(requireApiKeyOwner(request("GET", {}), { write: false })).rejects.toMatchObject({ code: "AI_KEY_LOCAL_ONLY" });
  });
});
