import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ApiKeyError, apiKeyErrorMessage, type ApiKeyErrorCode } from "@/lib/ai/access/api-key-errors";
import type { ApiKeySecret } from "@/lib/ai/access/api-key-secret";
import { writeAiAccessFile } from "@/lib/ai/access/api-key-store";
import { createOpenAiApiKeyAccess, strictOpenAiSchema, type OpenAiApiKeyDeps } from "@/lib/ai/access/openai-api";
import { SecretStoreError, type SecretItem, type SecretStore } from "@/lib/ai/access/secret-store";
import { normalizeReportedError } from "@/lib/observability/error-reporter";
import { TakeoffExchangeSchema } from "@/lib/takeoff/schemas";

// A member's OpenAI key from « Mon profil » to one billed call, with an
// injected Keychain and a fake OpenAI at the HTTP boundary (no real key, no
// real call). Failure modes, the first round's and the review's:
// - a key refused by OpenAI, or one that cannot be stored, saved anyway; a key
//   lacking only a permission (403, or a 401 that says so) called invalid;
// - a replacement that overwrites the key in service before the candidate is
//   proven, or leaves it unusable when interrupted (Keychain timeout, metadata
//   failure, process stop), with no recovery at the next operation;
// - a removed key still used, or a call made when the price, the count or the
//   ceiling does not allow it; an output budget that ignores the counted input;
// - a tier other than Standard, or cache writes, priced as Standard input;
// - a provider failure shown as its raw text; an answer, model id or request
//   id that echoes the key stored or returned;
// - the page drawn from a Keychain read or an OpenAI call;
// - the key in a response, a log line, an error report or a stored file.

const OWNER = { userId: "11111111-1111-4111-8111-111111111111", tenantId: "22222222-2222-4222-8222-222222222222" };
const INSTALLATION = "urn:uuid:33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-11-18T13:00:00.000Z");
const fictionalKey = () => `sk-proj-${randomBytes(30).toString("base64url")}`;
const itemName = (version: number) => `fr.mergeone.ai-api-key\u0000${INSTALLATION.slice(9)}:${OWNER.userId}:${OWNER.tenantId}:openai:v${version}`;

type Sent = { url: string; method: string; authorization: string | null; body: Record<string, unknown> | null };
type Reply = Response | (() => Response) | Error;

/** OpenAI at its HTTP boundary: per key, what /v1/models, /v1/responses/input_tokens and /v1/responses answer. */
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

const listed = (ids = ["gpt-6.1-terra", "gpt-6.1-sol", "gpt-6.2-sol", "gpt-4o-mini"]) =>
  Response.json({ object: "list", data: ids.map((id) => ({ id, object: "model", created: 1, owned_by: "openai" })) }, { headers: { "x-request-id": "req_list" } });
const counted = (inputTokens: number) => Response.json({ object: "response.input_tokens", input_tokens: inputTokens });
const providerError = (status: number, error: { type?: string; code?: string | null; message?: string }, headers: Record<string, string> = {}) =>
  Response.json({ error: { message: "Incorrect API key provided: sk-proj-****. You can find your API key at …", ...error } }, { status, headers: { "x-request-id": "req_err", ...headers } });
const answered = (text: string, options: { model?: string; status?: string; usage?: Record<string, unknown> | null; refusal?: boolean;
  tier?: string | null; requestId?: string } = {}) => Response.json({
  id: "resp_1", object: "response", status: options.status ?? "completed", model: options.model ?? "gpt-6.1-terra-2026-10-01",
  service_tier: options.tier === undefined ? "default" : options.tier,
  output: [{ type: "reasoning", summary: [] }, { type: "message", role: "assistant", content: [options.refusal
    ? { type: "refusal", refusal: "Je ne peux pas." } : { type: "output_text", text, annotations: [] }] }],
  usage: options.usage === null ? null : options.usage ?? { input_tokens: 1_200, input_tokens_details: { cached_tokens: 200, cache_write_tokens: 0 },
    output_tokens: 300, output_tokens_details: { reasoning_tokens: 100 }, total_tokens: 1_500 },
  ...(options.status === "incomplete" ? { incomplete_details: { reason: "max_output_tokens" } } : {}),
}, { headers: { "x-request-id": options.requestId ?? "req_resp" } });
/** A key that lists models, counts 40 000 input tokens and answers `text`. */
const usual = (text: string) => (_key: string, pathname: string) =>
  pathname === "/v1/models" ? listed() : pathname === "/v1/responses/input_tokens" ? counted(40_000) : answered(text);

function memoryKeychain() {
  const items = new Map<string, ApiKeySecret>();
  const id = (item: SecretItem) => `${item.service}\u0000${item.account}`;
  const state = { locked: false, failWrite: false, reads: 0 };
  const store: SecretStore = {
    kind: "macos-keychain", placeLabel: "Sur ce Mac",
    async read(item) { state.reads += 1; if (state.locked) throw new SecretStoreError("locked"); return items.get(id(item)) ?? null; },
    async write(item, secret) {
      if (state.locked) throw new SecretStoreError("locked");
      if (state.failWrite) throw new SecretStoreError("locked");
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

async function metadata() {
  const [file] = await storedFiles();
  return JSON.parse(file) as { next_version: number; pending: Array<{ version: number }>; retired: Array<{ version: number }>;
    connections: { openai?: { version: number; suffix: string } } };
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

const keysIn = (keychain: ReturnType<typeof memoryKeychain>) =>
  [...keychain.items.entries()].map(([name, secret]) => [name, secret.reveal("openai-request")]);

describe("add and verify a key", () => {
  it("lists the models without attachment or generation, saves the key as a versioned item and shows it masked", async () => {
    const key = fictionalKey();
    const openai = fakeOpenAi((_key, pathname) => (pathname === "/v1/models" ? listed() : new Response(null, { status: 500 })));
    const { service, keychain } = access(openai.fetch);
    const result = await service.save(OWNER, { key });
    expect(openai.sent).toEqual([{ url: "https://api.openai.com/v1/models", method: "GET", authorization: `Bearer ${key}`, body: null }]);
    expect(result).toMatchObject({ outcome: "saved", state: { status: "saved", connection: {
      provider: "openai", place: "local", placeLabel: "Sur ce Mac", suffix: key.slice(-4), verification: "models_listed", version: 1,
      savedAt: NOW.toISOString(), lastTest: null, lastUsedAt: null } } });
    // The offer: qualified and listed; a listed model this code does not price is never offered.
    expect(result.outcome === "saved" && result.models.map((model) => [model.id, model.verified])).toEqual([["gpt-6.1-terra", true], ["gpt-6.2-sol", true]]);
    expect(keysIn(keychain)).toEqual([[itemName(1), key]]);
    expect(await metadata()).toMatchObject({ next_version: 2, pending: [], retired: [] });
  });

  it("draws the saved state, models included, without opening the Keychain or calling OpenAI", async () => {
    const openai = fakeOpenAi(usual("{}"));
    const { service, keychain } = access(openai.fetch);
    await service.save(OWNER, { key: fictionalKey() });
    const reads = keychain.state.reads;
    const sent = openai.sent.length;
    const state = await service.state(OWNER);
    expect(state.status === "saved" && state.connection.offeredModels.map((model) => model.id)).toEqual(["gpt-6.1-terra", "gpt-6.2-sol"]);
    expect([keychain.state.reads, openai.sent.length]).toEqual([reads, sent]);
  });

  it("refreshes an existing key’s catalog using a single discovery request", async () => {
    let models = listed();
    const openai = fakeOpenAi(() => models.clone());
    const { service, keychain } = access(openai.fetch);
    await service.save(OWNER, { key: fictionalKey() });
    models = listed(["gpt-6.1-terra", "gpt-6.2-astra", "gpt-6.2-sol", "gpt-4o-mini"]);
    const refreshed = await service.refreshModels(OWNER);
    expect(refreshed).toMatchObject({ status: "saved", connection: { version: 1, lastTest: null, lastUsedAt: null,
      offeredModels: ["gpt-6.1-terra", "gpt-6.2-astra", "gpt-6.2-sol"].map((id) => expect.objectContaining({ id, verified: true })) } });
    expect(await service.state(OWNER)).toEqual(refreshed);
    expect(keychain.items.size).toBe(1);
    expect(openai.sent.map(({ url, method, body }) => [url, method, body])).toEqual([
      ["https://api.openai.com/v1/models", "GET", null], ["https://api.openai.com/v1/models", "GET", null],
    ]);
  });

  it("leaves the last known catalog in place when OpenAI denies discovery", async () => {
    let models = listed();
    const { service } = access(fakeOpenAi(() => models.clone()).fetch);
    await service.save(OWNER, { key: fictionalKey() });
    const before = await service.state(OWNER);
    models = providerError(403, { code: "missing_scope" });
    expect((await failure(service.refreshModels(OWNER))).code).toBe("AI_KEY_MODELS_PERMISSION");
    expect(await service.state(OWNER)).toEqual(before);
  });

  it("refuses a key OpenAI refuses definitively, and keeps nothing", async () => {
    // Review round 2, item J: OpenAI's published example puts ip_not_authorized in error.type.
    for (const refusal of [providerError(401, { code: "invalid_api_key" }), providerError(401, { type: "invalid_request_error", code: "ip_not_authorized" }),
      providerError(401, { type: "ip_not_authorized", code: null })]) {
      const { service, keychain } = access(fakeOpenAi(() => refusal.clone()).fetch);
      const error = await failure(service.save(OWNER, { key: fictionalKey() }));
      expect([error.code, error.message]).toEqual(["AI_KEY_REFUSED", "OpenAI a refusé cette clé. Remplacez-la dans Mon profil pour poursuivre."]);
      expect(keychain.items.size).toBe(0);
      expect(await service.state(OWNER)).toEqual({ status: "empty", placeLabel: "Sur ce Mac" });
    }
  });

  it("offers one explicit model test to a key that may not list models, whether OpenAI says so with a 403 or a 401", async () => {
    const lacking = [
      providerError(403, { message: "You have insufficient permissions for this operation. Missing scopes: api.model.read." }),
      providerError(401, { message: "You have insufficient permissions for this operation. Missing scopes: api.model.read.", code: null }),
      providerError(401, { code: "missing_scope" }),
    ];
    for (const refusal of lacking) {
      const key = fictionalKey();
      const openai = fakeOpenAi((_key, pathname, body) => pathname === "/v1/models" ? refusal.clone()
        : answered(JSON.stringify({ connexion: "ok" }), { model: String(body?.model) }));
      const { service, keychain } = access(openai.fetch);
      const first = await service.save(OWNER, { key });
      expect(first).toEqual({ outcome: "needs_model_test", models: [
        ...["gpt-6.1-terra", "gpt-6.2-astra", "gpt-6.2-sol"].map((id) => expect.objectContaining({ id, verified: false }))] });
      expect(keychain.items.size).toBe(0);
      expect(openai.sent).toHaveLength(1);
      const second = await service.save(OWNER, { key, testModel: "gpt-6.2-sol" });
      expect(second).toMatchObject({ outcome: "saved", state: { status: "saved", connection: {
        verification: "model_tested", lastTest: { at: NOW.toISOString(), model: "gpt-6.2-sol" } } } });
      expect(keychain.items.size).toBe(1);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not save a permission-limited key whose model test fails", async () => {
    const openai = fakeOpenAi((_key, pathname) => pathname === "/v1/models" ? providerError(403, {}) : providerError(401, { code: "invalid_api_key" }));
    const { service, keychain } = access(openai.fetch);
    expect((await failure(service.save(OWNER, { key: fictionalKey(), testModel: "gpt-6.1-terra" }))).code).toBe("AI_KEY_REFUSED");
    expect(keychain.items.size).toBe(0);
  });

  it("refuses a value that is not an OpenAI key before any request", async () => {
    const openai = fakeOpenAi(() => listed());
    const { service } = access(openai.fetch);
    expect((await failure(service.save(OWNER, { key: "pk_live_not-a-key" }))).code).toBe("AI_KEY_FORMAT");
    expect(openai.fetch).not.toHaveBeenCalled();
  });
});

describe("test a model", () => {
  it("sends a minimal structured question, no document, store false, Standard tier, no cache write, bounded output", async () => {
    const key = fictionalKey();
    const openai = fakeOpenAi((_key, pathname, body) => pathname === "/v1/models" ? listed() : answered(JSON.stringify({ connexion: "ok" }), { model: String(body?.model) }));
    const { service } = access(openai.fetch);
    await service.save(OWNER, { key });
    const result = await service.test(OWNER, "gpt-6.1-terra");
    const request = openai.sent.at(-1)!;
    expect(request.url).toBe("https://api.openai.com/v1/responses");
    expect(request.body).toMatchObject({ model: "gpt-6.1-terra", store: false, max_output_tokens: 1_024, reasoning: { effort: "none" },
      service_tier: "default", prompt_cache_options: { mode: "explicit" },
      text: { format: { type: "json_schema", strict: true, name: "mergeone_model_test" } } });
    expect(JSON.stringify(request.body)).not.toContain("input_file");
    expect(result).toMatchObject({ model: "gpt-6.1-terra", at: NOW.toISOString(), state: { connection: { lastTest: { model: "gpt-6.1-terra" } } } });
    // 1 000 input + 200 cached + 300 output at Terra's rates.
    expect(result.costNanoUsd).toBe(1_000 * 1_000 + 200 * 50 + 300 * 5_000);
    expect(result.state.status === "saved" && result.state.connection.lastUsedAt).toBeNull();
  });

  it("leaves the cost « à confirmer » when OpenAI served another tier than Standard", async () => {
    const openai = fakeOpenAi((_key, pathname) => pathname === "/v1/models" ? listed() : answered(JSON.stringify({ connexion: "ok" }), { tier: "priority" }));
    const { service } = access(openai.fetch);
    await service.save(OWNER, { key: fictionalKey() });
    expect((await service.test(OWNER, "gpt-6.1-terra")).costNanoUsd).toBeNull();
  });

  it("starts Sol at its lowest effort and refuses a model this code does not price", async () => {
    const openai = fakeOpenAi((_key, pathname, body) => pathname === "/v1/models" ? listed() : answered(JSON.stringify({ connexion: "ok" }), { model: String(body?.model) }));
    const { service } = access(openai.fetch);
    await service.save(OWNER, { key: fictionalKey() });
    await service.test(OWNER, "gpt-6.2-sol");
    expect(openai.sent.at(-1)!.body).toMatchObject({ reasoning: { effort: "low" } });
    const sent = openai.sent.length;
    expect((await failure(service.test(OWNER, "gpt-6.1-sol"))).code).toBe("AI_KEY_PRICE_UNKNOWN");
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

  it("writes the candidate to its own item and only then switches: a Keychain failure leaves the key in service", async () => {
    const [current, candidate] = [fictionalKey(), fictionalKey()];
    const openai = fakeOpenAi((_key, pathname) => pathname === "/v1/models" ? listed() : answered(JSON.stringify({ connexion: "ok" })));
    const { service, keychain } = access(openai.fetch);
    await service.save(OWNER, { key: current });
    keychain.state.failWrite = true;
    const error = await failure(service.save(OWNER, { key: candidate }));
    expect([error.code, error.message]).toEqual(["AI_KEY_KEYCHAIN_LOCKED", "Déverrouillez le Trousseau de ce Mac, puis réessayez."]);
    expect(keysIn(keychain)).toEqual([[itemName(1), current]]);
    keychain.state.failWrite = false;
    await service.test(OWNER, "gpt-6.1-terra");
    expect(openai.sent.at(-1)!.authorization).toBe(`Bearer ${current}`);
  });

  it("keeps the key in service when the metadata switch fails right after the Keychain write, and recovers the stray item", async () => {
    const [current, candidate] = [fictionalKey(), fictionalKey()];
    const openai = fakeOpenAi((_key, pathname) => pathname === "/v1/models" ? listed() : answered(JSON.stringify({ connexion: "ok" })));
    const keychain = memoryKeychain();
    let failSwitch = false;
    const { service } = access(openai.fetch, keychain, { writeMetadata: async (dir, owner, file) => {
      // The switch is the write that names a new active version.
      if (failSwitch && file.connections.openai && file.connections.openai.version > 1) throw new Error("disk full");
      await writeAiAccessFile(dir, owner, file);
    } });
    await service.save(OWNER, { key: current });
    failSwitch = true;
    // The process also fails to delete the new item at once: it stays, recorded as pending.
    const remove = keychain.store.remove;
    keychain.store.remove = async () => { throw new SecretStoreError("locked"); };
    expect((await failure(service.save(OWNER, { key: candidate }))).code).toBe("AI_KEY_KEYCHAIN_FAILED");
    keychain.store.remove = remove;
    failSwitch = false;
    expect(await metadata()).toMatchObject({ connections: { openai: { version: 1, suffix: current.slice(-4) } }, pending: [{ version: 2 }] });
    expect(keysIn(keychain)).toEqual([[itemName(1), current], [itemName(2), candidate]]);
    await service.test(OWNER, "gpt-6.1-terra");
    expect(openai.sent.at(-1)!.authorization).toBe(`Bearer ${current}`);
    // The next operation that opens the Keychain under the lock deletes the stray candidate.
    await service.save(OWNER, { key: current });
    expect(keysIn(keychain)).toEqual([[itemName(3), current]]);
    expect(await metadata()).toMatchObject({ connections: { openai: { version: 3 } }, pending: [], retired: [] });
  });

  // Review round 2, item F: the removal is committed before the item is deleted; a crash in between leaves no key shown
  // that no longer exists, only a retired item cleaned at the next Keychain opening.
  it("commits the removal before deleting the Keychain item, and cleans the item later if its deletion fails", async () => {
    const openai = fakeOpenAi((_key, pathname) => pathname === "/v1/models" ? listed() : answered(JSON.stringify({ connexion: "ok" })));
    const { service, keychain } = access(openai.fetch);
    const key = fictionalKey();
    await service.save(OWNER, { key });
    const remove = keychain.store.remove;
    keychain.store.remove = async () => { throw new SecretStoreError("locked"); };
    expect(await service.remove(OWNER)).toEqual({ status: "empty", placeLabel: "Sur ce Mac",
      notice: "Clé retirée de MergeOne : aucun nouvel appel ne l’utilisera. Son élément du Trousseau sera supprimé à la prochaine ouverture du Trousseau." });
    expect(await metadata()).toMatchObject({ connections: {}, retired: [{ version: 1 }] });
    expect(keysIn(keychain)).toEqual([[itemName(1), key]]);
    keychain.store.remove = remove;
    await service.save(OWNER, { key: fictionalKey() });
    expect(keysIn(keychain).map(([name]) => name)).toEqual([itemName(2)]);
    expect(await metadata()).toMatchObject({ retired: [], pending: [] });
  });

  it("refuses a save whose starting key was replaced or removed while the candidate was being verified", async () => {
    let releaseList!: () => void;
    const listing = new Promise<void>((resolve) => { releaseList = resolve; });
    let hold = false;
    const openai = fakeOpenAi((_key, pathname) => pathname === "/v1/models"
      ? (hold ? () => { throw new Error("replaced below"); } : listed()) : answered(JSON.stringify({ connexion: "ok" })));
    const slowFetch: OpenAiApiKeyDeps["fetch"] = async (input, init) => {
      if (hold && new URL(input).pathname === "/v1/models") { await listing; return listed(); }
      return openai.fetch(input, init as RequestInit);
    };
    const { service, keychain } = access(slowFetch);
    await service.save(OWNER, { key: fictionalKey() });
    hold = true;
    const saving = service.save(OWNER, { key: fictionalKey() });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await service.remove(OWNER);
    releaseList();
    const error = await failure(saving);
    expect([error.code, error.message]).toEqual(["AI_KEY_CHANGED_DURING_SAVE",
      "La clé a été remplacée ou retirée pendant la vérification de la nouvelle : rien n’a été enregistré. Rechargez la page et recommencez."]);
    expect(await service.state(OWNER)).toEqual({ status: "empty", placeLabel: "Sur ce Mac" });
    expect(keychain.items.size).toBe(0);
  });

  it("cleans items left by a replacement when the key is next used, not only at the next save", async () => {
    const openai = fakeOpenAi((_key, pathname) => pathname === "/v1/models" ? listed() : pathname === "/v1/responses/input_tokens" ? counted(1_000)
      : answered(JSON.stringify({ connexion: "ok" })));
    const { service, keychain } = access(openai.fetch);
    await service.save(OWNER, { key: fictionalKey() });
    // The old item cannot be deleted during the replacement: it stays, retired.
    const remove = keychain.store.remove;
    keychain.store.remove = async () => { throw new SecretStoreError("locked"); };
    const second = fictionalKey();
    await service.save(OWNER, { key: second });
    keychain.store.remove = remove;
    expect(keysIn(keychain).map(([name]) => name)).toEqual([itemName(1), itemName(2)]);
    await service.test(OWNER, "gpt-6.1-terra");
    expect(keysIn(keychain)).toEqual([[itemName(2), second]]);
    expect(await metadata()).toMatchObject({ retired: [], pending: [] });
  });

  // Review round 2, item G: an unreadable record must not lock the member out.
  it("treats an unreadable record as no key saved, says so, and lets a new save overwrite it", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { createHash } = await import("node:crypto");
    await mkdir(directory, { recursive: true });
    const record = path.join(directory, `${createHash("sha256").update(JSON.stringify([OWNER.userId, OWNER.tenantId])).digest("hex")}.json`);
    await writeFile(record, "{ not a record");
    const { service } = access(fakeOpenAi(() => listed()).fetch);
    const notice = "Le descriptif local de la clé était illisible : aucune clé n’est considérée comme enregistrée. Enregistrez-la de nouveau.";
    expect(await service.state(OWNER)).toEqual({ status: "empty", placeLabel: "Sur ce Mac", notice });
    const { service: withoutKeychain } = access(fakeOpenAi(() => listed()).fetch, undefined, { secretStore: () => null });
    expect(await withoutKeychain.state(OWNER)).toMatchObject({ status: "unavailable", notice });
    expect(await service.remove(OWNER)).toMatchObject({ status: "empty" });
    await writeFile(record, JSON.stringify({ schema_version: 1, next_version: "two", connections: {} }));
    const key = fictionalKey();
    expect(await service.save(OWNER, { key })).toMatchObject({ outcome: "saved", state: { connection: { suffix: key.slice(-4) } } });
    expect(await service.state(OWNER)).toMatchObject({ status: "saved" });
  });

  it("recovers a lock left by a process that stopped", async () => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { createHash } = await import("node:crypto");
    const owner = createHash("sha256").update(JSON.stringify([OWNER.userId, OWNER.tenantId])).digest("hex");
    const lock = path.join(directory, `${owner}.lock`);
    await mkdir(lock, { recursive: true });
    // A pid no process holds on this machine.
    await writeFile(path.join(lock, "owner.json"), JSON.stringify({ pid: 2 ** 22 + 12_345 }));
    const { service } = access(fakeOpenAi(() => listed()).fetch);
    await expect(service.save(OWNER, { key: fictionalKey() })).resolves.toMatchObject({ outcome: "saved" });
  });

  it("replaces with a new versioned item, deletes the old one, then removing stops every call", async () => {
    const [first, second] = [fictionalKey(), fictionalKey()];
    const openai = fakeOpenAi((_key, pathname) => pathname === "/v1/models" ? listed() : answered(JSON.stringify({ connexion: "ok" })));
    const { service, keychain } = access(openai.fetch);
    await service.save(OWNER, { key: first });
    await service.test(OWNER, "gpt-6.1-terra");
    const replaced = await service.save(OWNER, { key: second });
    expect(replaced).toMatchObject({ state: { connection: { suffix: second.slice(-4), version: 2, lastTest: null } } });
    expect(keysIn(keychain)).toEqual([[itemName(2), second]]);
    expect(await service.remove(OWNER)).toEqual({ status: "empty", placeLabel: "Sur ce Mac" });
    expect(keychain.items.size).toBe(0);
    const sent = openai.sent.length;
    expect((await failure(service.test(OWNER, "gpt-6.1-terra"))).code).toBe("AI_KEY_MISSING");
    expect(openai.sent).toHaveLength(sent);
    await service.save(OWNER, { key: first });
    expect(await service.state(OWNER)).toMatchObject({ connection: { version: 3 } });
  });

  it("asks to unlock a locked Keychain and changes nothing", async () => {
    const openai = fakeOpenAi((_key, pathname) => pathname === "/v1/models" ? listed() : answered(JSON.stringify({ connexion: "ok" })));
    const { service, keychain } = access(openai.fetch);
    await service.save(OWNER, { key: fictionalKey() });
    keychain.state.locked = true;
    for (const attempt of [() => service.save(OWNER, { key: fictionalKey() }), () => service.test(OWNER, "gpt-6.1-terra")]) {
      const error = await failure(attempt());
      expect([error.code, error.message]).toEqual(["AI_KEY_KEYCHAIN_LOCKED", "Déverrouillez le Trousseau de ce Mac, puis réessayez."]);
    }
    expect(await service.state(OWNER)).toMatchObject({ status: "saved", connection: { version: 1 } });
  });

  it("says the key works on the Mac installation only where there is no Keychain, and never stores it elsewhere", async () => {
    const openai = fakeOpenAi(() => listed());
    const service = createOpenAiApiKeyAccess({ secretStore: () => null, fetch: openai.fetch, now: () => NOW,
      installationId: async () => INSTALLATION, directory: () => directory });
    expect(await service.state(OWNER)).toEqual({ status: "unavailable",
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
    ["401 permission", providerError(401, { code: "missing_scope" }), "AI_KEY_MODEL_FORBIDDEN",
      "Cette clé ne donne pas accès au modèle choisi. Choisissez un modèle disponible ou vérifiez ses autorisations."],
    ["404 model", providerError(404, { code: "model_not_found" }), "AI_KEY_MODEL_FORBIDDEN",
      "Cette clé ne donne pas accès au modèle choisi. Choisissez un modèle disponible ou vérifiez ses autorisations."],
    ["429 credit", providerError(429, { type: "insufficient_quota", code: "credit_balance_exhausted" }), "AI_KEY_SPEND_LIMIT",
      "Votre compte API a atteint sa limite de dépense. Les résultats déjà obtenus sont conservés."],
    ["429 project cap", providerError(429, { type: "invalid_request_error", code: "project_spend_limit_exceeded" }), "AI_KEY_SPEND_LIMIT",
      "Votre compte API a atteint sa limite de dépense. Les résultats déjà obtenus sont conservés."],
    ["429 organization usage limit", providerError(429, { type: "requests", code: "organization_usage_limit_exceeded" }), "AI_KEY_SPEND_LIMIT",
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
      expect(openai.sent.filter((request) => request.url.endsWith("/v1/responses"))).toHaveLength(1);
    });
  }

  it("keeps the usage of a response cut at its output limit: it was billed", async () => {
    const { service } = await prepare(answered("{", { status: "incomplete" }));
    const error = await failure(service.test(OWNER, "gpt-6.1-terra"));
    expect(error.usage).toEqual({ input: 1_200, cachedInput: 200, cacheWrite: 0, cacheWrite12h: 0, output: 300, reasoning: 100, total: 1_500 });
    expect(error.model).toBe("gpt-6.1-terra-2026-10-01");
  });
});

describe("a structured call for the lab", () => {
  const pdf = { data: Buffer.from("%PDF-1.7 fictional").toString("base64"), mimeType: "application/pdf" as const };
  const items = { items: [
    { designation: "Tuyauterie cuivre DN20", quantity: 12.5, unit: "m", source_page: 1, confidence: 0.99, evidence: "Cotes 5,00 m et 7,50 m" },
    { designation: "Vanne isolement DN20", quantity: 4, unit: "u", source_page: 1, confidence: 0.99, evidence: "Repères V1 à V4" },
  ], warnings: [], confidence: 0.9, metadata: { level: "C", prompt_version: "takeoff-c-v1", file_type: "pdf", schema_version: "v1" } };
  const prepareCall = (service: ReturnType<typeof access>["service"], overrides: Record<string, unknown> = {}) => service.prepare(OWNER, {
    expectedVersion: 1, model: "gpt-6.1-terra", reasoningEffort: "medium", prompt: "Extrais les quantités.", schema: TakeoffExchangeSchema,
    files: [pdf], allotmentNanoUsd: 1_000_000_000, outputCap: 32_000, minOutputTokens: 8_000, ...overrides,
  });

  it("counts the exact request first, then sends the same input with an output budget the allotment can pay", async () => {
    const openai = fakeOpenAi(usual(JSON.stringify(items)));
    const { service } = access(openai.fetch);
    await service.save(OWNER, { key: fictionalKey() });
    const prepared = await prepareCall(service);
    const count = openai.sent.at(-1)!;
    expect(count.url).toBe("https://api.openai.com/v1/responses/input_tokens");
    expect(prepared).toMatchObject({ inputTokens: 40_000, maxOutputTokens: 32_000, connectionVersion: 1,
      boundNanoUsd: 40_000 * 2_500 + 32_000 * 5_000 });
    expect(openai.sent.filter((request) => request.url.endsWith("/v1/responses"))).toEqual([]);
    const result = await service.execute<z.infer<typeof TakeoffExchangeSchema>>(OWNER, prepared, { timeoutMs: 60_000 });
    const generation = openai.sent.at(-1)!.body!;
    expect(generation).toMatchObject({ model: "gpt-6.1-terra", store: false, max_output_tokens: 32_000, reasoning: { effort: "medium" },
      service_tier: "default", prompt_cache_options: { mode: "explicit" }, text: { format: { type: "json_object" } } });
    // The counted request is the sent request: model, effort, output format and input.
    for (const field of ["model", "reasoning", "text", "input"]) expect([field, generation[field]]).toEqual([field, count.body![field]]);
    expect(String((generation.input as Array<{ content: unknown }>)[0].content)).toContain("Schéma JSON : ");
    expect(result).toMatchObject({ model: "gpt-6.1-terra-2026-10-01", schemaError: null, requestId: "req_resp", serviceTier: "default",
      usage: { input: 1_200, cachedInput: 200, output: 300, reasoning: 100, total: 1_500 } });
    expect(result.data?.items.map((item) => [item.designation, item.quantity, item.unit, item.source_page])).toEqual([
      ["Tuyauterie cuivre DN20", 12.5, "m", 1], ["Vanne isolement DN20", 4, "u", 1]]);
    expect(result.costNanoUsd).toBe(1_000 * 1_000 + 200 * 50 + 300 * 5_000);
    expect(await service.state(OWNER)).toMatchObject({ connection: { lastUsedAt: NOW.toISOString() } });
  });

  // Review round 2, item C: what was counted is what is sent, once.
  it("sends what was counted even if the caller changes its files afterwards, and only once", async () => {
    const openai = fakeOpenAi(usual(JSON.stringify(items)));
    const { service } = access(openai.fetch);
    await service.save(OWNER, { key: fictionalKey() });
    const files = [{ ...pdf }];
    const prepared = await service.prepare(OWNER, { expectedVersion: 1, model: "gpt-6.1-terra", reasoningEffort: "medium", prompt: "Extrais.",
      schema: TakeoffExchangeSchema, files, allotmentNanoUsd: 1_000_000_000, outputCap: 32_000, minOutputTokens: 8_000 });
    const counted = openai.sent.at(-1)!.body!;
    files[0].data = Buffer.from("%PDF-1.7 another, larger document").toString("base64");
    files.push({ ...pdf });
    await service.execute(OWNER, prepared, { timeoutMs: 60_000 });
    expect(openai.sent.at(-1)!.body!.input).toEqual(counted.input);
    expect((await failure(service.execute(OWNER, prepared, { timeoutMs: 60_000 }))).code).toBe("AI_KEY_UNEXPECTED");
    expect(openai.sent.filter((request) => request.url.endsWith("/v1/responses"))).toHaveLength(1);
  });

  it("lowers the output budget to what the allotment leaves, and refuses below a useful answer", async () => {
    const huge = fakeOpenAi((_key, pathname) => pathname === "/v1/models" ? listed() : pathname === "/v1/responses/input_tokens" ? counted(300_000) : answered("{}"));
    const { service } = access(huge.fetch);
    await service.save(OWNER, { key: fictionalKey() });
    const refused = await failure(prepareCall(service, { model: "gpt-6.2-sol", reasoningEffort: "max", outputCap: 64_000 }));
    expect(refused.code).toBe("AI_KEY_CEILING");
    expect(refused.message).toMatch(/^Cette analyse pourrait dépasser votre plafond de 1,00 \$ US \(borne prudente : \d+,\d\d \$ US\)\./);
    expect(huge.sent.filter((request) => request.url.endsWith("/v1/responses"))).toEqual([]);

    const half = fakeOpenAi(usual(JSON.stringify(items)));
    const second = access(half.fetch);
    await second.service.save(OWNER, { key: fictionalKey() }).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
    await second.service.save(OWNER, { key: fictionalKey() });
    // Sol, 40 000 counted tokens, half the ceiling: 0,20 $ of input (12-hour write rate) leaves 0,30 $, 30 000 output tokens.
    expect(await prepareCall(second.service, { model: "gpt-6.2-sol", reasoningEffort: "max", outputCap: 64_000, allotmentNanoUsd: 500_000_000 }))
      .toMatchObject({ maxOutputTokens: 30_000, boundNanoUsd: 500_000_000 });
  });

  it("generates nothing when OpenAI cannot count the input", async () => {
    for (const reply of [providerError(500, { type: "server_error" }), new DOMException("timeout", "TimeoutError"), Response.json({ unexpected: true })]) {
      const openai = fakeOpenAi((_key, pathname) => pathname === "/v1/models" ? listed() : pathname === "/v1/responses/input_tokens" ? reply : answered("{}"));
      const { service } = access(openai.fetch);
      await rm(directory, { recursive: true, force: true });
      await service.save(OWNER, { key: fictionalKey() });
      const error = await failure(prepareCall(service));
      expect([error.code, error.message]).toEqual(["AI_KEY_COUNT_UNAVAILABLE",
        "OpenAI n’a pas pu compter l’entrée avant l’analyse : la dépense ne peut pas être plafonnée, rien n’a été généré. Réessayez plus tard."]);
      expect(openai.sent.filter((request) => request.url.endsWith("/v1/responses"))).toEqual([]);
    }
  });

  it("returns a response the schema rejects with its usage and cost", async () => {
    const openai = fakeOpenAi((_key, pathname) => pathname === "/v1/models" ? listed() : pathname === "/v1/responses/input_tokens" ? counted(1_000)
      : answered(JSON.stringify({ items: "none" })));
    const { service } = access(openai.fetch);
    await service.save(OWNER, { key: fictionalKey() });
    const result = await service.execute(OWNER, await prepareCall(service), { timeoutMs: 60_000 });
    expect(result.data).toBeNull();
    expect(result.schemaError?.name).toBe("ZodError");
    expect(result.costNanoUsd).toBe(1_000 * 1_000 + 200 * 50 + 300 * 5_000);
  });

  // Review round 2, item B: the documented buckets are ttl_30m_tokens and ttl_12h_tokens; a written token no recognised
  // bucket accounts for is priced at the 12-hour rate. A decoder that recognises nothing fails the first case.
  it("prices cache writes from the documented buckets, and anything unaccounted for at the 12-hour rate", async () => {
    const cases: Array<[Record<string, number> | null, number]> = [
      [{ ttl_30m_tokens: 400, ttl_12h_tokens: 0 }, 400 * 1_250],
      [{ ttl_30m_tokens: 100, ttl_12h_tokens: 300 }, 100 * 1_250 + 300 * 2_500],
      [{ ttl_5m_tokens: 400 }, 400 * 2_500],
      [null, 400 * 2_500],
    ];
    for (const [details, written] of cases) {
      await rm(directory, { recursive: true, force: true });
      const openai = fakeOpenAi((_key, pathname) => pathname === "/v1/models" ? listed() : pathname === "/v1/responses/input_tokens" ? counted(1_000)
        : answered(JSON.stringify(items), { usage: { input_tokens: 1_000, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 400,
          ...(details ? { cache_write_tokens_details: details } : {}) }, output_tokens: 100, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 1_100 } }));
      const { service } = access(openai.fetch);
      await service.save(OWNER, { key: fictionalKey() });
      const result = await service.execute(OWNER, await prepareCall(service), { timeoutMs: 60_000 });
      expect([details, result.costNanoUsd]).toEqual([details, 600 * 1_000 + written + 100 * 5_000]);
    }
  });

  it("refuses a key replaced since the page was drawn, before reading the Keychain", async () => {
    const openai = fakeOpenAi(usual(JSON.stringify(items)));
    const { service, keychain } = access(openai.fetch);
    await service.save(OWNER, { key: fictionalKey() });
    await service.save(OWNER, { key: fictionalKey() });
    const [sent, reads] = [openai.sent.length, keychain.state.reads];
    expect((await failure(prepareCall(service, { expectedVersion: 1 }))).code).toBe("AI_KEY_CHANGED");
    expect([openai.sent.length, keychain.state.reads]).toEqual([sent, reads]);
  });

  it("masks the key and any credential echoed in the answer, the model id and the request id", async () => {
    const key = fictionalKey();
    const other = `sk-proj-${"x".repeat(30)}`;
    const echoed = { ...items, items: [{ ...items.items[0], designation: `Tuyauterie ${key}`, evidence: `Bearer ${other}` }, items.items[1]] };
    const openai = fakeOpenAi((_key, pathname) => pathname === "/v1/models" ? listed() : pathname === "/v1/responses/input_tokens" ? counted(1_000)
      : answered(JSON.stringify(echoed), { model: key, requestId: key }));
    const { service } = access(openai.fetch);
    await service.save(OWNER, { key });
    const result = await service.execute<z.infer<typeof TakeoffExchangeSchema>>(OWNER, await prepareCall(service), { timeoutMs: 60_000 });
    const text = JSON.stringify(result);
    expect(text).not.toContain(key);
    expect(text).not.toContain(other);
    expect(result).toMatchObject({ model: "gpt-6.1-terra", requestId: null });
    expect(result.data?.items[0].designation).toBe("Tuyauterie [clé masquée]");
  });

  // Review round 2, item H: masking applies to decoded values, and only to the key and real OpenAI key shapes.
  it("masks a key the answer escapes in its JSON, which parsing would decode", async () => {
    const key = fictionalKey();
    const echoed = { ...items, items: [{ ...items.items[0], designation: `Tuyauterie ${key}` }, items.items[1]] };
    // The answer writes the key's first letter as a JSON escape: the serialized text never contains the key itself.
    const escaped = JSON.stringify(echoed).replace(key, `\\u0073${key.slice(1)}`);
    expect(escaped).not.toContain(key);
    const openai = fakeOpenAi((_key, pathname) => pathname === "/v1/models" ? listed() : pathname === "/v1/responses/input_tokens" ? counted(1_000)
      : answered(escaped));
    const { service } = access(openai.fetch);
    await service.save(OWNER, { key });
    const result = await service.execute<z.infer<typeof TakeoffExchangeSchema>>(OWNER, await prepareCall(service), { timeoutMs: 60_000 });
    expect(result.data?.items[0].designation).toBe("Tuyauterie [clé masquée]");
    expect(JSON.stringify(result)).not.toContain(key);
    expect(JSON.stringify(JSON.parse(result.rawText))).not.toContain(key);
  });

  it("leaves legitimate plan text that merely contains « Bearer » unchanged", async () => {
    const plan = { ...items, items: [{ ...items.items[0], designation: "Support Bearer bracket DN20", evidence: "Bearer bracket 4 u, repère B1" },
      items.items[1]] };
    const openai = fakeOpenAi((_key, pathname) => pathname === "/v1/models" ? listed() : pathname === "/v1/responses/input_tokens" ? counted(1_000)
      : answered(JSON.stringify(plan)));
    const { service } = access(openai.fetch);
    await service.save(OWNER, { key: fictionalKey() });
    const result = await service.execute<z.infer<typeof TakeoffExchangeSchema>>(OWNER, await prepareCall(service), { timeoutMs: 60_000 });
    expect([result.data?.items[0].designation, result.data?.items[0].evidence]).toEqual(["Support Bearer bracket DN20", "Bearer bracket 4 u, repère B1"]);
    expect(JSON.parse(result.rawText)).toEqual(plan);
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
    let mode: "ok" | "refused" | "throw" | "echo" = "ok";
    const openai = fakeOpenAi((_key, pathname) => {
      if (mode === "throw") return Object.assign(new TypeError(`fetch failed for Bearer ${key}`), { cause: new Error(`socket ${key}`) });
      if (mode === "refused") return providerError(401, { code: "invalid_api_key", message: `Incorrect API key provided: ${key}` });
      if (mode === "echo" && pathname === "/v1/responses") return answered(`{"connexion":"ok","echo":"${key}"}`, { model: key, requestId: key });
      if (pathname === "/v1/responses/input_tokens") return counted(1_000);
      return pathname === "/v1/models" ? listed() : answered(JSON.stringify({ connexion: "ok" }));
    });
    const keychain = memoryKeychain();
    let failMetadata = false;
    const { service } = access(openai.fetch, keychain, { writeMetadata: async (dir, owner, file) => {
      if (failMetadata) throw new Error(`disk full near ${key}`);
      await writeAiAccessFile(dir, owner, file);
    } });
    const outputs: unknown[] = [];
    const errors: unknown[] = [];
    const settle = async (promise: Promise<unknown>) => { try { outputs.push(await promise); } catch (error) { errors.push(error); } };
    await settle(service.save(OWNER, { key }));
    await settle(service.state(OWNER));
    await settle(service.test(OWNER, "gpt-6.1-terra"));
    const prepared = await service.prepare(OWNER, { expectedVersion: 1, model: "gpt-6.1-terra", reasoningEffort: null, prompt: "p",
      schema: z.object({ connexion: z.string() }), files: [], allotmentNanoUsd: 1_000_000_000, outputCap: 32_000, minOutputTokens: 1_000 });
    outputs.push(prepared);
    mode = "echo";
    await settle(service.execute(OWNER, prepared, { timeoutMs: 1_000 }));
    mode = "refused";
    await settle(service.test(OWNER, "gpt-6.1-terra"));
    await settle(service.save(OWNER, { key: `${key.slice(0, -1)}x` }));
    mode = "ok";
    failMetadata = true;
    await settle(service.save(OWNER, { key: `${key.slice(0, -1)}y` }));
    failMetadata = false;
    mode = "throw";
    await settle(service.test(OWNER, "gpt-6.1-terra"));
    await settle(service.remove(OWNER));
    expect(errors.length).toBeGreaterThanOrEqual(4);
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

  it("aborts an in-flight execute call immediately when the caller's signal aborts", async () => {
    const controller = new AbortController();
    let seenSignal: AbortSignal | null | undefined;
    const openai = fakeOpenAi((_key, pathname) => {
      if (pathname === "/v1/models") return listed();
      if (pathname === "/v1/responses/input_tokens") return counted(1_000);
      return answered(JSON.stringify({ connexion: "ok" }));
    });
    const abortableFetch: OpenAiApiKeyDeps["fetch"] = async (input, init) => {
      if (new URL(input).pathname === "/v1/responses") {
        seenSignal = init.signal;
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          controller.abort();
        });
      }
      return openai.fetch(input, init);
    };
    const { service, keychain } = access(abortableFetch);
    await service.save(OWNER, { key: fictionalKey() });
    const prepared = await service.prepare(OWNER, {
      expectedVersion: 1, model: "gpt-6.1-terra", reasoningEffort: null, prompt: "p",
      schema: z.object({ connexion: z.string() }), files: [], allotmentNanoUsd: 1_000_000_000, outputCap: 32_000, minOutputTokens: 1_000,
      signal: controller.signal,
    });
    await expect(service.execute(OWNER, prepared, { timeoutMs: 30_000, signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(seenSignal?.aborted).toBe(true);
    expect((await service.state(OWNER))).toMatchObject({ status: "saved", connection: { lastUsedAt: expect.any(String) } });

    const preAborted = new AbortController();
    preAborted.abort();
    const readSpy = vi.spyOn(keychain.store, "read");
    await expect(service.prepare(OWNER, {
      expectedVersion: 1, model: "gpt-6.1-terra", reasoningEffort: null, prompt: "p",
      schema: z.object({ connexion: z.string() }), files: [], allotmentNanoUsd: 1_000_000_000, outputCap: 32_000, minOutputTokens: 1_000,
      signal: preAborted.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(readSpy).not.toHaveBeenCalled();
  });
});
