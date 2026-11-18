import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ApiKeyError, apiKeyErrorMessage, type ApiKeyErrorCode } from "@/lib/ai/access/api-key-errors";
import { ApiKeySecret } from "@/lib/ai/access/api-key-secret";
import { createOpenAiApiKeyAccess, strictOpenAiSchema, type OpenAiApiKeyDeps } from "@/lib/ai/access/openai-api";
import { SecretStoreError, type SecretItem, type SecretStore } from "@/lib/ai/access/secret-store";
import { normalizeReportedError } from "@/lib/observability/error-reporter";
import { TakeoffExchangeSchema } from "@/lib/takeoff/schemas";

// A member's OpenAI key from « Mon profil » to one billed call, with an
// injected Keychain and a fake OpenAI at the HTTP boundary (no real key, no
// real call). Failure modes, written before the adapter:
// - a key refused by OpenAI, or one that cannot be stored, saved anyway;
// - a key that may not list models called invalid (or saved unchecked);
// - a failed replacement that loses the key in service;
// - a removed key still used, or a call made when the price or the ceiling
//   does not allow it;
// - a provider failure shown as its raw text, or without its fixed message;
// - an expired subscription spending on the key, or a refused key falling
//   back to the subscription;
// - the key in a response, a log line, an error report or a stored file.

const OWNER = { userId: "11111111-1111-4111-8111-111111111111", tenantId: "22222222-2222-4222-8222-222222222222" };
const INSTALLATION = "urn:uuid:33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-11-18T13:00:00.000Z");
const fictionalKey = () => `sk-proj-${randomBytes(30).toString("base64url")}`;

type Sent = { url: string; method: string; authorization: string | null; body: Record<string, unknown> | null };
type Reply = Response | (() => Response) | Error;

/** OpenAI at its HTTP boundary: per key, what /v1/models and /v1/responses answer. */
function fakeOpenAi(routes: (key: string, path: string, body: Record<string, unknown> | null) => Reply) {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const authorization = new Headers(init?.headers).get("authorization");
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null;
    sent.push({ url: url.href, method: init?.method ?? "GET", authorization, body });
    const reply = routes(authorization?.replace(/^Bearer /, "") ?? "", url.pathname, body);
    if (reply instanceof Error) throw reply;
    return typeof reply === "function" ? reply() : reply;
  });
  return { fetch, sent };
}

const listed = (ids = ["gpt-6.1-terra", "gpt-6.1-sol", "gpt-4o-mini"]) =>
  Response.json({ object: "list", data: ids.map((id) => ({ id, object: "model", created: 1, owned_by: "openai" })) }, { headers: { "x-request-id": "req_list" } });
const providerError = (status: number, error: { type?: string; code?: string; message?: string }, headers: Record<string, string> = {}) =>
  Response.json({ error: { message: "Incorrect API key provided: sk-proj-****. You can find your API key at …", ...error } }, { status, headers: { "x-request-id": "req_err", ...headers } });
const answered = (text: string, options: { model?: string; status?: string; usage?: Record<string, unknown> | null; refusal?: boolean } = {}) => Response.json({
  id: "resp_1", object: "response", status: options.status ?? "completed", model: options.model ?? "gpt-6.1-terra-2026-10-01",
  output: [{ type: "reasoning", summary: [] }, { type: "message", role: "assistant", content: [options.refusal
    ? { type: "refusal", refusal: "Je ne peux pas." } : { type: "output_text", text, annotations: [] }] }],
  usage: options.usage === null ? null : options.usage ?? { input_tokens: 1_200, input_tokens_details: { cached_tokens: 200 }, output_tokens: 300,
    output_tokens_details: { reasoning_tokens: 100 }, total_tokens: 1_500 },
  ...(options.status === "incomplete" ? { incomplete_details: { reason: "max_output_tokens" } } : {}),
}, { headers: { "x-request-id": "req_resp" } });

function memoryKeychain() {
  const items = new Map<string, ApiKeySecret>();
  const id = (item: SecretItem) => `${item.service}\u0000${item.account}`;
  const state = { locked: false, failWrite: false };
  const store: SecretStore = {
    kind: "macos-keychain", placeLabel: "Sur ce Mac",
    async read(item) { if (state.locked) throw new SecretStoreError("locked"); return items.get(id(item)) ?? null; },
    async write(item, secret) {
      if (state.locked) throw new SecretStoreError("locked");
      if (state.failWrite) throw new SecretStoreError("failed");
      items.set(id(item), secret);
    },
    async remove(item) { if (state.locked) throw new SecretStoreError("locked"); items.delete(id(item)); },
  };
  return { store, items, state };
}

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "ai-access-test-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

function access(fetch: OpenAiApiKeyDeps["fetch"], keychain = memoryKeychain(), overrides: Partial<OpenAiApiKeyDeps> = {}) {
  const service = createOpenAiApiKeyAccess({ secretStore: () => keychain.store, fetch, now: () => NOW,
    installationId: async () => INSTALLATION, directory: () => directory, ...overrides });
  return { service, keychain };
}

async function storedFiles() {
  const names = await readdir(directory).catch(() => []);
  return Promise.all(names.filter((name) => name.endsWith(".json")).map((name) => readFile(path.join(directory, name), "utf8")));
}

async function failure(promise: Promise<unknown>): Promise<ApiKeyError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiKeyError) return error;
    throw error;
  }
  throw new Error("Expected an ApiKeyError.");
}

describe("add and verify a key", () => {
  it("lists the models without attachment or generation, saves the key in the Keychain and shows it masked", async () => {
    const key = fictionalKey();
    const openai = fakeOpenAi((_key, pathname) => (pathname === "/v1/models" ? listed() : new Response(null, { status: 500 })));
    const { service, keychain } = access(openai.fetch);
    const result = await service.save(OWNER, { key });
    expect(openai.sent).toEqual([{ url: "https://api.openai.com/v1/models", method: "GET", authorization: `Bearer ${key}`, body: null }]);
    expect(result).toMatchObject({ outcome: "saved", state: { status: "saved", connection: {
      provider: "openai", place: "local", placeLabel: "Sur ce Mac", suffix: key.slice(-4), verification: "models_listed", version: 1,
      savedAt: NOW.toISOString(), lastTest: null, lastUsedAt: null } } });
    // The offer: qualified and listed; a listed model this code does not price is never offered.
    expect(result.outcome === "saved" && result.models.map((model) => [model.id, model.verified])).toEqual([["gpt-6.1-terra", true], ["gpt-6.1-sol", true]]);
    const [item] = [...keychain.items.entries()];
    expect(item[0]).toBe(`fr.mergeone.ai-api-key\u0000${INSTALLATION.slice(9)}:${OWNER.userId}:${OWNER.tenantId}:openai`);
    expect(item[1].reveal("openai-request")).toBe(key);
    expect(await service.state(OWNER)).toEqual(result.outcome === "saved" ? result.state : null);
  });

  it("refuses a key OpenAI refuses, and keeps nothing", async () => {
    const openai = fakeOpenAi(() => providerError(401, { code: "invalid_api_key" }));
    const { service, keychain } = access(openai.fetch);
    const error = await failure(service.save(OWNER, { key: fictionalKey() }));
    expect([error.code, error.message]).toEqual(["AI_KEY_REFUSED", "OpenAI a refusé cette clé. Remplacez-la dans Mon profil pour poursuivre."]);
    expect(keychain.items.size).toBe(0);
    expect(await service.state(OWNER)).toEqual({ status: "empty", placeLabel: "Sur ce Mac" });
  });

  it("does not call a key that may not list models invalid: it asks for one explicit model test", async () => {
    const key = fictionalKey();
    const openai = fakeOpenAi((_key, pathname, body) => pathname === "/v1/models"
      ? providerError(403, { message: "You have insufficient permissions for this operation. Missing scopes: api.model.read." })
      : answered(JSON.stringify({ connexion: "ok" }), { model: String(body?.model) }));
    const { service, keychain } = access(openai.fetch);
    const first = await service.save(OWNER, { key });
    expect(first).toEqual({ outcome: "needs_model_test", models: [
      expect.objectContaining({ id: "gpt-6.1-terra", verified: false }), expect.objectContaining({ id: "gpt-6.1-sol", verified: false })] });
    expect(keychain.items.size).toBe(0);
    expect(openai.sent).toHaveLength(1);

    const second = await service.save(OWNER, { key, testModel: "gpt-6.1-sol" });
    expect(second).toMatchObject({ outcome: "saved", state: { status: "saved", connection: {
      verification: "model_tested", lastTest: { at: NOW.toISOString(), model: "gpt-6.1-sol" } } } });
    expect(keychain.items.size).toBe(1);
  });

  it("keeps a key the Keychain could not store out of the saved state", async () => {
    const keychain = memoryKeychain();
    keychain.state.failWrite = true;
    const { service } = access(fakeOpenAi(() => listed()).fetch, keychain);
    expect((await failure(service.save(OWNER, { key: fictionalKey() }))).code).toBe("AI_KEY_KEYCHAIN_FAILED");
    expect(await service.state(OWNER)).toEqual({ status: "empty", placeLabel: "Sur ce Mac" });
  });

  it("refuses a value that is not an OpenAI key before any request", async () => {
    const openai = fakeOpenAi(() => listed());
    const { service } = access(openai.fetch);
    expect((await failure(service.save(OWNER, { key: "pk_live_not-a-key" }))).code).toBe("AI_KEY_FORMAT");
    expect(openai.fetch).not.toHaveBeenCalled();
  });
});

describe("test a model", () => {
  it("sends a minimal structured question, no document, store false, bounded output", async () => {
    const key = fictionalKey();
    const openai = fakeOpenAi((_key, pathname, body) => pathname === "/v1/models" ? listed() : answered(JSON.stringify({ connexion: "ok" }), { model: String(body?.model) }));
    const { service } = access(openai.fetch);
    await service.save(OWNER, { key });
    const result = await service.test(OWNER, "gpt-6.1-terra");
    const request = openai.sent.at(-1)!;
    expect(request.url).toBe("https://api.openai.com/v1/responses");
    expect(request.body).toMatchObject({ model: "gpt-6.1-terra", store: false, max_output_tokens: 1_024, reasoning: { effort: "none" },
      text: { format: { type: "json_schema", strict: true, name: "mergeone_model_test" } } });
    expect(JSON.stringify(request.body)).not.toContain("input_file");
    expect(result).toMatchObject({ model: "gpt-6.1-terra", at: NOW.toISOString(), state: { connection: { lastTest: { model: "gpt-6.1-terra" } } } });
    // 1 000 input + 200 cached + 300 output at Terra's rates.
    expect(result.costNanoUsd).toBe(1_000 * 1_000 + 200 * 50 + 300 * 5_000);
    // A test is not a use in MergeOne.
    expect(result.state.status === "saved" && result.state.connection.lastUsedAt).toBeNull();
  });

  it("starts Sol at its lowest effort and refuses a model this code does not price", async () => {
    const openai = fakeOpenAi((_key, pathname, body) => pathname === "/v1/models" ? listed() : answered(JSON.stringify({ connexion: "ok" }), { model: String(body?.model) }));
    const { service } = access(openai.fetch);
    await service.save(OWNER, { key: fictionalKey() });
    await service.test(OWNER, "gpt-6.1-sol");
    expect(openai.sent.at(-1)!.body).toMatchObject({ reasoning: { effort: "low" } });
    const sent = openai.sent.length;
    expect((await failure(service.test(OWNER, "gpt-4o-mini"))).code).toBe("AI_KEY_PRICE_UNKNOWN");
    expect(openai.sent).toHaveLength(sent);
  });
});

describe("replace and remove", () => {
  it("verifies the candidate first: a refused one leaves the key in service usable", async () => {
    const [current, candidate] = [fictionalKey(), fictionalKey()];
    const openai = fakeOpenAi((key, pathname) => key === candidate ? providerError(401, { code: "invalid_api_key" })
      : pathname === "/v1/models" ? listed() : answered(JSON.stringify({ connexion: "ok" })));
    const { service } = access(openai.fetch);
    await service.save(OWNER, { key: current });
    expect((await failure(service.save(OWNER, { key: candidate }))).code).toBe("AI_KEY_REFUSED");
    await service.test(OWNER, "gpt-6.1-terra");
    expect(openai.sent.at(-1)!.authorization).toBe(`Bearer ${current}`);
    expect(await service.state(OWNER)).toMatchObject({ connection: { suffix: current.slice(-4), version: 1 } });
  });

  it("replaces in place with a new version, then removing stops every call", async () => {
    const [first, second] = [fictionalKey(), fictionalKey()];
    const openai = fakeOpenAi((_key, pathname) => pathname === "/v1/models" ? listed() : answered(JSON.stringify({ connexion: "ok" })));
    const { service, keychain } = access(openai.fetch);
    await service.save(OWNER, { key: first });
    await service.test(OWNER, "gpt-6.1-terra");
    const replaced = await service.save(OWNER, { key: second });
    expect(replaced).toMatchObject({ state: { connection: { suffix: second.slice(-4), version: 2, lastTest: null } } });
    expect([...keychain.items.values()].map((secret) => secret.reveal("openai-request"))).toEqual([second]);

    expect(await service.remove(OWNER)).toEqual({ status: "empty", placeLabel: "Sur ce Mac" });
    expect(keychain.items.size).toBe(0);
    const sent = openai.sent.length;
    expect((await failure(service.test(OWNER, "gpt-6.1-terra"))).code).toBe("AI_KEY_MISSING");
    expect(openai.sent).toHaveLength(sent);
    // Added again, the key takes a new version: an essai frozen on version 2 cannot use it.
    await service.save(OWNER, { key: first });
    expect(await service.state(OWNER)).toMatchObject({ connection: { version: 3 } });
  });

  it("asks to unlock a locked Keychain and changes nothing", async () => {
    const openai = fakeOpenAi((_key, pathname) => pathname === "/v1/models" ? listed() : answered(JSON.stringify({ connexion: "ok" })));
    const { service, keychain } = access(openai.fetch);
    await service.save(OWNER, { key: fictionalKey() });
    keychain.state.locked = true;
    for (const attempt of [() => service.save(OWNER, { key: fictionalKey() }), () => service.test(OWNER, "gpt-6.1-terra"), () => service.remove(OWNER)]) {
      const error = await failure(attempt());
      expect([error.code, error.message]).toEqual(["AI_KEY_KEYCHAIN_LOCKED", "Déverrouillez le Trousseau de ce Mac, puis réessayez."]);
    }
    expect(await service.state(OWNER)).toMatchObject({ status: "saved", connection: { version: 1 } });
  });

  it("says the key works on the Mac installation only where there is no Keychain, and never stores it elsewhere", async () => {
    const openai = fakeOpenAi(() => listed());
    const service = createOpenAiApiKeyAccess({ secretStore: () => null, fetch: openai.fetch, now: () => NOW,
      installationId: async () => INSTALLATION, directory: () => directory });
    expect(await service.state(OWNER)).toEqual({ status: "unavailable", reason: "no_keychain",
      message: apiKeyErrorMessage("AI_KEY_KEYCHAIN_UNAVAILABLE") });
    expect((await failure(service.save(OWNER, { key: fictionalKey() }))).code).toBe("AI_KEY_KEYCHAIN_UNAVAILABLE");
    expect(openai.fetch).not.toHaveBeenCalled();
    expect(await storedFiles()).toEqual([]);
  });
});

describe("failures of a paid call", () => {
  const prepare = async (reply: Reply) => {
    const key = fictionalKey();
    const openai = fakeOpenAi((_key, pathname) => (pathname === "/v1/models" ? listed() : reply));
    const { service } = access(openai.fetch);
    await service.save(OWNER, { key });
    return { service, openai, key };
  };
  const cases: Array<[string, Reply, ApiKeyErrorCode, string]> = [
    ["401", providerError(401, { code: "invalid_api_key" }), "AI_KEY_REFUSED", "OpenAI a refusé cette clé. Remplacez-la dans Mon profil pour poursuivre."],
    ["403", providerError(403, { code: "model_not_allowed" }), "AI_KEY_MODEL_FORBIDDEN",
      "Cette clé ne donne pas accès au modèle choisi. Choisissez un modèle disponible ou vérifiez ses autorisations."],
    ["404 model", providerError(404, { code: "model_not_found" }), "AI_KEY_MODEL_FORBIDDEN",
      "Cette clé ne donne pas accès au modèle choisi. Choisissez un modèle disponible ou vérifiez ses autorisations."],
    ["429 credit", providerError(429, { type: "insufficient_quota", code: "credit_balance_exhausted" }), "AI_KEY_SPEND_LIMIT",
      "Votre compte API a atteint sa limite de dépense. Les résultats déjà obtenus sont conservés."],
    ["429 project cap", providerError(429, { type: "invalid_request_error", code: "project_spend_limit_exceeded" }), "AI_KEY_SPEND_LIMIT",
      "Votre compte API a atteint sa limite de dépense. Les résultats déjà obtenus sont conservés."],
    ["429 with delay", providerError(429, { code: "rate_limit_exceeded" }, { "retry-after": "1920" }), "AI_KEY_RATE_LIMITED",
      "OpenAI reçoit trop de demandes. Vous pourrez reprendre à 14 h 32."],
    ["429 without delay", providerError(429, { code: "rate_limit_exceeded" }), "AI_KEY_RATE_LIMITED",
      "OpenAI reçoit trop de demandes. Réessayez plus tard ; rien n’a été relancé automatiquement."],
    ["400", providerError(400, { code: "unsupported_value" }), "AI_KEY_REQUEST_REJECTED",
      "OpenAI a refusé la demande (format, taille ou réglage du modèle). Vérifiez le modèle et l’effort choisis."],
    ["500", providerError(500, { type: "server_error" }), "AI_KEY_PROVIDER_FAILED", "OpenAI n’a pas terminé la demande. Réessayez plus tard."],
    ["not sent", Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) }),
      "AI_KEY_UNREACHABLE", "OpenAI est injoignable depuis ce Mac. Aucun appel n’a été envoyé."],
    ["lost after sending", new DOMException("The operation was aborted due to timeout", "TimeoutError"), "AI_KEY_RESPONSE_LOST",
      "La réponse n’a pas été reçue. Cet appel a pu être facturé : consommation à confirmer. MergeOne ne l’a pas renvoyé."],
    ["cut at its output limit", answered("{\"connexion\":", { status: "incomplete" }), "AI_KEY_OUTPUT_LIMIT",
      "La réponse a atteint la taille maximale prévue avant d’être complète. Réduisez la zone ou l’effort."],
  ];
  for (const [label, reply, code, message] of cases) {
    it(`${label} → ${code}, its fixed message, sent once`, async () => {
      const { service, openai } = await prepare(reply);
      const error = await failure(service.test(OWNER, "gpt-6.1-terra"));
      expect([error.code, error.message]).toEqual([code, message]);
      expect(error.cause).toBeUndefined();
      // No automatic resend, whatever the failure.
      expect(openai.sent.filter((request) => request.url.endsWith("/v1/responses"))).toHaveLength(1);
    });
  }

  it("keeps the usage of a response cut at its output limit: it was billed", async () => {
    const { service } = await prepare(answered("{", { status: "incomplete" }));
    const error = await failure(service.test(OWNER, "gpt-6.1-terra"));
    expect(error.usage).toEqual({ input: 1_200, cachedInput: 200, output: 300, reasoning: 100, total: 1_500 });
    expect(error.model).toBe("gpt-6.1-terra-2026-10-01");
  });
});

describe("a structured call for the lab", () => {
  const pdf = { data: Buffer.from("%PDF-1.7 fictional").toString("base64"), mimeType: "application/pdf" as const };
  const items = { items: [
    { designation: "Tuyauterie cuivre DN20", quantity: 12.5, unit: "m", source_page: 1, confidence: 0.99, evidence: "Cotes 5,00 m et 7,50 m" },
    { designation: "Vanne isolement DN20", quantity: 4, unit: "u", source_page: 1, confidence: 0.99, evidence: "Repères V1 à V4" },
  ], warnings: [], confidence: 0.9,
  metadata: { level: "C", prompt_version: "takeoff-c-v1", file_type: "pdf", schema_version: "v1" } };
  const call = (service: ReturnType<typeof access>["service"], overrides: Record<string, unknown> = {}) => service.callStructured(OWNER, {
    expectedVersion: 1, model: "gpt-6.1-terra", reasoningEffort: "medium", prompt: "Extrais les quantités.", schema: TakeoffExchangeSchema,
    files: [pdf], pages: 1, maxOutputTokens: 32_000, timeoutMs: 60_000, ceilingNanoUsd: 1_000_000_000, ...overrides,
  });

  it("sends the PDF with JSON mode and the schema, then validates it and prices the usage in US dollars", async () => {
    const openai = fakeOpenAi((_key, pathname) => pathname === "/v1/models" ? listed() : answered(JSON.stringify(items)));
    const { service } = access(openai.fetch);
    await service.save(OWNER, { key: fictionalKey() });
    const result = await call(service);
    const request = openai.sent.at(-1)!.body!;
    expect(request).toMatchObject({ model: "gpt-6.1-terra", store: false, max_output_tokens: 32_000, reasoning: { effort: "medium" },
      text: { format: { type: "json_object" } } });
    const input = request.input as Array<{ role: string; content: unknown }>;
    expect(input[0]).toMatchObject({ role: "developer" });
    expect(String(input[0].content)).toContain("Schéma JSON : ");
    expect(input[1].content).toEqual([{ type: "input_text", text: "Extrais les quantités." },
      { type: "input_file", filename: "document.pdf", file_data: `data:application/pdf;base64,${pdf.data}` }]);
    expect(result).toMatchObject({ model: "gpt-6.1-terra-2026-10-01", schemaError: null, requestId: "req_resp",
      usage: { input: 1_200, cachedInput: 200, output: 300, reasoning: 100, total: 1_500 } });
    expect(result.data?.items.map((item) => [item.designation, item.quantity, item.unit, item.source_page])).toEqual([
      ["Tuyauterie cuivre DN20", 12.5, "m", 1], ["Vanne isolement DN20", 4, "u", 1]]);
    expect(result.costNanoUsd).toBe(1_000 * 1_000 + 200 * 50 + 300 * 5_000);
    expect(await service.state(OWNER)).toMatchObject({ connection: { lastUsedAt: NOW.toISOString() } });
  });

  it("returns a response the schema rejects with its usage and cost", async () => {
    const openai = fakeOpenAi((_key, pathname) => pathname === "/v1/models" ? listed() : answered(JSON.stringify({ items: "none" })));
    const { service } = access(openai.fetch);
    await service.save(OWNER, { key: fictionalKey() });
    const result = await call(service);
    expect(result.data).toBeNull();
    expect(result.schemaError?.name).toBe("ZodError");
    expect(result.rawText).toBe(JSON.stringify({ items: "none" }));
    expect(result.costNanoUsd).toBeGreaterThan(0);
  });

  it("refuses before sending when the bound passes the ceiling or the price is unknown", async () => {
    const openai = fakeOpenAi((_key, pathname) => pathname === "/v1/models" ? listed() : answered(JSON.stringify(items)));
    const { service } = access(openai.fetch);
    await service.save(OWNER, { key: fictionalKey() });
    const before = openai.sent.length;
    const ceiling = await failure(call(service, { pages: 40 }));
    expect(ceiling.code).toBe("AI_KEY_CEILING");
    expect(ceiling.message).toMatch(/^Cette analyse pourrait dépasser votre plafond de 1,00 \$ US \(borne prudente : \d+,\d\d \$ US\)\./);
    expect((await failure(call(service, { model: "gpt-4o-mini" }))).code).toBe("AI_KEY_PRICE_UNKNOWN");
    expect(openai.sent).toHaveLength(before);
  });

  it("refuses a key replaced since the essai was prepared", async () => {
    const openai = fakeOpenAi((_key, pathname) => pathname === "/v1/models" ? listed() : answered(JSON.stringify(items)));
    const { service } = access(openai.fetch);
    await service.save(OWNER, { key: fictionalKey() });
    await service.save(OWNER, { key: fictionalKey() });
    const before = openai.sent.length;
    expect((await failure(call(service, { expectedVersion: 1 }))).code).toBe("AI_KEY_CHANGED");
    expect(openai.sent).toHaveLength(before);
  });

  it("uses a strict schema only where the schema allows it", () => {
    expect(strictOpenAiSchema(z.object({ connexion: z.literal("ok") }).strict())).toEqual({ type: "object",
      properties: { connexion: { type: "string", const: "ok" } }, required: ["connexion"], additionalProperties: false });
    expect(strictOpenAiSchema(TakeoffExchangeSchema)).toBeNull();
    expect(strictOpenAiSchema(z.object({ optional: z.string().optional() }).strict())).toBeNull();
  });
});

describe("the key never leaves the adapter", () => {
  it("is absent from every result, error, log line, error report and stored file, including on failures", async () => {
    const key = fictionalKey();
    const logged: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { logged.push(args.map((arg) => inspect(arg, { depth: 8 })).join(" ")); });
    }
    let mode: "ok" | "refused" | "throw" = "ok";
    const openai = fakeOpenAi((_key, pathname) => {
      if (mode === "throw") return Object.assign(new TypeError(`fetch failed for Bearer ${key}`), { cause: new Error(`socket ${key}`) });
      if (mode === "refused") return providerError(401, { code: "invalid_api_key", message: `Incorrect API key provided: ${key}` });
      return pathname === "/v1/models" ? listed() : answered(JSON.stringify({ connexion: "ok" }));
    });
    const { service } = access(openai.fetch);
    const outputs: unknown[] = [];
    const errors: unknown[] = [];
    const settle = async (promise: Promise<unknown>) => { try { outputs.push(await promise); } catch (error) { errors.push(error); } };
    await settle(service.save(OWNER, { key }));
    await settle(service.state(OWNER));
    await settle(service.models(OWNER));
    await settle(service.test(OWNER, "gpt-6.1-terra"));
    mode = "refused";
    await settle(service.test(OWNER, "gpt-6.1-terra"));
    await settle(service.save(OWNER, { key: `${key.slice(0, -1)}x` }));
    mode = "throw";
    await settle(service.test(OWNER, "gpt-6.1-terra"));
    await settle(service.models(OWNER));
    await settle(service.remove(OWNER));
    expect(errors.length).toBeGreaterThanOrEqual(3);
    const seen = [
      ...outputs.map((output) => JSON.stringify(output)),
      ...errors.flatMap((error) => [JSON.stringify(error), String(error), inspect(error, { depth: 8 }),
        JSON.stringify(normalizeReportedError(error)), (error as Error).stack ?? ""]),
      ...logged,
      ...(await storedFiles()),
    ];
    for (const text of seen) expect(text).not.toContain(key);
    expect(seen.join("\n")).not.toContain(key.slice(8, 30));
  });
});
