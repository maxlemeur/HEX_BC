import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { E2E_SECRET_STORE } from "@/lib/ai/access/secret-store";
import { openAiApiKeyAccess } from "@/lib/ai/access/openai-api";
import { callStructuredAi } from "@/lib/ai/structured-ai";

// No silent change of payer, from the subscription's side: every journey that
// calls callStructuredAi (dossier, estimate helpers, takeoff) stays on the
// ChatGPT subscription. With the subscription expired or never connected, and
// a key saved for the same member, it refuses — it never sends a request with
// the key (nor any request at all).

const OWNER = { userId: "11111111-1111-4111-8111-111111111111", tenantId: "22222222-2222-4222-8222-222222222222" };
let root: string;
const fetchSpy = vi.fn();

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "payer-isolation-"));
  vi.spyOn(process, "cwd").mockReturnValue(root);
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("E2E_ARMY", "1");
  const values = new Map<string, string>();
  (globalThis as Record<symbol, unknown>)[E2E_SECRET_STORE] = { kind: "e2e-memory", placeLabel: "Trousseau de test",
    read: (service: string, account: string) => values.get(`${service}|${account}`) ?? null,
    write: (service: string, account: string, value: string) => { values.set(`${service}|${account}`, value); },
    remove: (service: string, account: string) => { values.delete(`${service}|${account}`); } };
  // The key is verified once with OpenAI's model list, then saved for the same member and tenant.
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [{ id: "gpt-6.1-terra" }] })));
  await openAiApiKeyAccess().save(OWNER, { key: `sk-proj-${randomBytes(30).toString("base64url")}` });
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete (globalThis as Record<symbol, unknown>)[E2E_SECRET_STORE];
  await rm(root, { recursive: true, force: true });
});

const options = { prompt: "Classe la pièce.", schema: z.object({ kind: z.string() }) };

describe("the subscription never spends on the key", () => {
  it("refuses with a never-connected subscription", async () => {
    expect(await openAiApiKeyAccess().state(OWNER)).toMatchObject({ status: "saved" });
    await expect(callStructuredAi(options, OWNER)).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses with an expired subscription", async () => {
    const directory = path.join(root, ".private", "chatgpt-local");
    await mkdir(directory, { recursive: true });
    const owner = createHash("sha256").update(JSON.stringify([OWNER.userId, OWNER.tenantId])).digest("hex");
    await writeFile(path.join(directory, `${owner}.json`), JSON.stringify({ selectedId: "p", profiles: [{ id: "p", clientId: "c", issuer: "https://auth.openai.com",
      subject: "s", email: "fixture@example.test", model: "gpt-6.1-terra", reasoningEffort: null, accessToken: "expired-plan-token",
      expiresAt: Date.now() - 60_000, scopes: ["chatgpt.tokens.use.direct"] }] }));
    await expect(callStructuredAi(options, OWNER)).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
