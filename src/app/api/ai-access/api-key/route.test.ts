import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiKeySecret } from "@/lib/ai/access/api-key-secret";
import type { SecretItem, SecretStore } from "@/lib/ai/access/secret-store";

// The key routes with two members of one tenant and one member of two tenants.
// The key belongs to a member in a tenant; the session decides both, never the
// request. Failure modes: a colleague, or the same person in another tenant,
// reads the masked state, tests (and so spends on) or removes someone else's key.

const session = vi.hoisted(() => ({ userId: "", tenantId: "" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "127.0.0.1:3000" }) }));
vi.mock("@/lib/auth/tenant-context", () => ({ getAuthenticatedContext: async () => ({ userId: session.userId, tenantId: session.tenantId }) }));

const fixture = vi.hoisted(() => ({ items: new Map<string, unknown>(), sent: [] as string[], directory: "" }));
vi.mock("@/lib/ai/access/openai-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/access/openai-api")>();
  const store: SecretStore = {
    kind: "macos-keychain", placeLabel: "Sur ce Mac",
    read: async (item: SecretItem) => (fixture.items.get(`${item.service}|${item.account}`) as ApiKeySecret | undefined) ?? null,
    write: async (item: SecretItem, secret: ApiKeySecret) => { fixture.items.set(`${item.service}|${item.account}`, secret); },
    remove: async (item: SecretItem) => { fixture.items.delete(`${item.service}|${item.account}`); },
  };
  const access = actual.createOpenAiApiKeyAccess({
    secretStore: () => store, installationId: async () => "urn:uuid:33333333-3333-4333-8333-333333333333", directory: () => fixture.directory,
    fetch: async (input, init) => {
      fixture.sent.push(`${new URL(input).pathname} ${new Headers(init?.headers).get("authorization")}`);
      return new URL(input).pathname === "/v1/models" ? Response.json({ data: [{ id: "gpt-6.1-terra" }] })
        : Response.json({ status: "completed", model: "gpt-6.1-terra", service_tier: "default",
          output: [{ type: "message", content: [{ type: "output_text", text: "{\"connexion\":\"ok\"}" }] }],
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } });
    },
  });
  return { ...actual, openAiApiKeyAccess: () => access };
});

const keyRoute = await import("@/app/api/ai-access/api-key/route");
const testRoute = await import("@/app/api/ai-access/api-key/test/route");

const TENANT_1 = "22222222-2222-4222-8222-222222222222";
const TENANT_2 = "66666666-6666-4666-8666-666666666666";
const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "44444444-4444-4444-8444-444444444444";
const ORIGIN = "http://127.0.0.1:3000";
const url = `${ORIGIN}/api/ai-access/api-key`;
const json = { origin: ORIGIN, "content-type": "application/json" };

const as = (userId: string, tenantId: string) => { session.userId = userId; session.tenantId = tenantId; };
const body = async (response: Response) => (await response.json()) as { ok: boolean; data?: { status?: string }; error?: { code: string } };

beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "development");
  fixture.directory = await mkdtemp(path.join(tmpdir(), "ai-access-route-"));
  fixture.items.clear();
  fixture.sent = [];
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(fixture.directory, { recursive: true, force: true });
});

describe("key routes, by member and tenant", () => {
  it("never lets a colleague or the same member in another tenant read, test or remove a key", async () => {
    const key = `sk-proj-${randomBytes(30).toString("base64url")}`;
    as(ALICE, TENANT_1);
    const saved = await keyRoute.PUT(new Request(url, { method: "PUT", headers: json, body: JSON.stringify({ provider: "openai", key }) }));
    expect([saved.status, (await body(saved)).data]).toMatchObject([200, { outcome: "saved" }]);
    const sentAfterSave = fixture.sent.length;

    for (const [userId, tenantId] of [[BOB, TENANT_1], [ALICE, TENANT_2]]) {
      as(userId, tenantId);
      expect((await body(await keyRoute.GET(new Request(url)))).data).toEqual({ status: "empty", placeLabel: "Sur ce Mac" });
      const tested = await testRoute.POST(new Request(`${url}/test`, { method: "POST", headers: json, body: JSON.stringify({ provider: "openai", model: "gpt-6.1-terra" }) }));
      expect([tested.status, (await body(tested)).error?.code]).toEqual([409, "AI_KEY_MISSING"]);
      const removed = await keyRoute.DELETE(new Request(url, { method: "DELETE", headers: { origin: ORIGIN } }));
      expect((await body(removed)).data).toEqual({ status: "empty", placeLabel: "Sur ce Mac" });
    }
    // No request reached OpenAI on Alice's key, and her key is still hers.
    expect(fixture.sent).toHaveLength(sentAfterSave);
    as(ALICE, TENANT_1);
    expect((await body(await keyRoute.GET(new Request(url)))).data).toMatchObject({ status: "saved", connection: { suffix: key.slice(-4) } });
    expect(fixture.items.size).toBe(1);
  });
});
