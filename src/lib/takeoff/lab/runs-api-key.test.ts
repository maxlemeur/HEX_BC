import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiKeySecret } from "@/lib/ai/access/api-key-secret";
import type { SecretItem, SecretStore } from "@/lib/ai/access/secret-store";
import type { LabConfigInput } from "@/lib/takeoff/lab/contracts";
import type { LabDocument } from "@/lib/takeoff/lab/dataset";
import { executeLabRun } from "@/lib/takeoff/lab/runs";
import { findLabTask } from "@/lib/takeoff/lab/tasks";

// An extraction of the takeoff lab paid with the member's OpenAI key, ChatGPT
// disconnected. OpenAI is faked at its HTTP boundary, the Keychain in memory.
// Failure modes, the first round's and the review's:
// - the essai needs the subscription (or calls it) to run on the key; a
//   refused key falls back to the subscription; a lost response is resent;
// - a bound guessed instead of counted, or a fixed output budget: the run
//   accepts a document whose input alone passes the ceiling; two
//   configurations each take the whole ceiling;
// - an answer that costs more than the ceiling shown as a silent « Terminé »,
//   with the next configurations still sent;
// - a page drawn before the key was replaced in another tab launches on the new key;
// - a run stores the amount without its currency, loses the usage of an answer
//   the schema rejected, stores the key or provider text, or omits the tenant.

const subscription = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/ai/chatgpt-local-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/chatgpt-local-auth")>()),
  getLocalChatGptCredential: async () => { subscription.calls += 1; return null; },
}));
vi.mock("@/lib/ai/chatgpt-local-inference", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/chatgpt-local-inference")>()),
  callLocalChatGptStructured: async () => { subscription.calls += 1; throw new Error("The subscription must not be called."); },
  listLocalChatGptModels: async () => { subscription.calls += 1; throw new Error("The subscription must not be called."); },
}));
vi.mock("@/lib/ai/decisions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/decisions")>()),
  callOpenAiDecisions: () => { throw new Error("Decisions is not part of this essai."); },
}));

const DOCUMENT: LabDocument = {
  summary: { id: "army-chatgpt-plan", source: "fixture", label: "Plan fictif", pages: 1, truth: null },
  bytes: Buffer.from("%PDF-1.7 fictional plan"), sha256: "a".repeat(64),
};
vi.mock("@/lib/takeoff/lab/dataset", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/takeoff/lab/dataset")>()),
  readLabDocument: async () => DOCUMENT,
}));

type Sent = { path: string; authorization: string | null; body: Record<string, unknown> | null };
const provider = vi.hoisted(() => ({
  sent: [] as Sent[],
  counted: 40_000,
  countFails: (() => false) as () => boolean,
  reply: (() => new Response(null, { status: 500 })) as (path: string) => Response | Error,
}));
const keychain = vi.hoisted(() => ({ items: new Map<string, unknown>(), reads: 0 }));
let directory: string;
vi.mock("@/lib/ai/access/openai-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/access/openai-api")>();
  const store: SecretStore = {
    kind: "macos-keychain", placeLabel: "Sur ce Mac",
    read: async (item: SecretItem) => { keychain.reads += 1; return (keychain.items.get(`${item.service}|${item.account}`) as ApiKeySecret | undefined) ?? null; },
    write: async (item: SecretItem, secret: ApiKeySecret) => { keychain.items.set(`${item.service}|${item.account}`, secret); },
    remove: async (item: SecretItem) => { keychain.items.delete(`${item.service}|${item.account}`); },
  };
  const access = actual.createOpenAiApiKeyAccess({
    secretStore: () => store, now: () => new Date("2026-11-18T13:00:00.000Z"),
    installationId: async () => "urn:uuid:33333333-3333-4333-8333-333333333333", directory: () => directory,
    fetch: async (input, init) => {
      const url = new URL(input);
      provider.sent.push({ path: url.pathname, authorization: new Headers(init?.headers).get("authorization"),
        body: typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null });
      const reply = url.pathname === "/v1/models"
        ? Response.json({ object: "list", data: [{ id: "gpt-6.1-terra" }, { id: "gpt-6.1-sol" }, { id: "gpt-4o-mini" }] })
        : url.pathname === "/v1/responses/input_tokens" ? (provider.countFails() ? new Response("{}", { status: 500 })
          : Response.json({ object: "response.input_tokens", input_tokens: provider.counted }))
        : provider.reply(url.pathname);
      if (reply instanceof Error) throw reply;
      return reply;
    },
  });
  return { ...actual, openAiApiKeyAccess: () => access };
});

const ACCESS = { owner: { userId: "11111111-1111-4111-8111-111111111111", tenantId: "22222222-2222-4222-8222-222222222222" }, email: null };
const ITEMS = { items: [
  { designation: "Tuyauterie cuivre DN20", quantity: 12.5, unit: "m", source_page: 1, confidence: 0.99, evidence: "Cotes 5,00 m et 7,50 m" },
  { designation: "Vanne isolement DN20", quantity: 4, unit: "u", source_page: 1, confidence: 0.99, evidence: "Repères V1 à V4" },
], warnings: [], confidence: 0.99, metadata: { level: "C", prompt_version: "takeoff-c-v1", file_type: "pdf", schema_version: "v1" } };
const answer = (text: string, options: { usage?: Record<string, unknown>; model?: string; requestId?: string; tier?: string } = {}) => Response.json({
  status: "completed", model: options.model ?? "gpt-6.1-terra-2026-10-01", service_tier: options.tier ?? "default",
  output: [{ type: "message", content: [{ type: "output_text", text }] }],
  usage: options.usage ?? { input_tokens: 4_000, input_tokens_details: { cached_tokens: 1_000, cache_write_tokens: 0 }, output_tokens: 900,
    output_tokens_details: { reasoning_tokens: 600 }, total_tokens: 4_900 },
}, { headers: { "x-request-id": options.requestId ?? "req_lab" } });

let root: string;
let key: string;
/** The opaque identity of the key the lab page showed (random, per saved key and owner). */
let shown: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "lab-api-key-test-"));
  directory = path.join(root, "ai-access");
  vi.stubEnv("TAKEOFF_LAB_DATASET_DIR", path.join(root, "dataset"));
  vi.stubEnv("TAKEOFF_LAB_OUTPUT_DIR", path.join(root, "output"));
  await mkdir(path.join(root, "output"), { recursive: true });
  provider.sent = [];
  provider.counted = 40_000;
  provider.countFails = () => false;
  provider.reply = () => answer(JSON.stringify(ITEMS));
  keychain.items.clear();
  keychain.reads = 0;
  subscription.calls = 0;
  key = `sk-proj-${randomBytes(30).toString("base64url")}`;
  const { openAiApiKeyAccess } = await import("@/lib/ai/access/openai-api");
  const saved = await openAiApiKeyAccess().save(ACCESS.owner, { key });
  shown = saved.outcome === "saved" && saved.state.status === "saved" ? saved.state.connection.connectionId : "";
  provider.sent = [];
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

function essai(configs: LabConfigInput[], access = ACCESS) {
  const task = findLabTask("extraction-niveau-c")!;
  return executeLabRun(access, { documentId: DOCUMENT.summary.id, campaign: "cle-api", taskId: task.id, crop: null,
    prompt: task.defaultPrompt, configs, image: null });
}
type Effort = "medium" | "high" | "max";
const keyed = (model: "gpt-6.1-terra" | "gpt-6.1-sol", effort: Effort = "medium", connectionId?: string): LabConfigInput =>
  ({ provider: "api_key", apiProvider: "openai", model, reasoningEffort: effort, connectionId: connectionId ?? shown });
const terra = (effort: Effort = "medium") => keyed("gpt-6.1-terra", effort);

async function storedRunTexts() {
  const runs = path.join(root, "output", "runs");
  const names = await readdir(runs).catch(() => []);
  return Promise.all(names.map((name) => readFile(path.join(runs, name), "utf8")));
}

async function expectNoSecretStored() {
  const texts = [...await storedRunTexts(), ...await Promise.all((await readdir(directory)).filter((name) => name.endsWith(".json"))
    .map((name) => readFile(path.join(directory, name), "utf8")))];
  for (const text of texts) {
    expect(text).not.toContain(key);
    expect(text).not.toContain("Incorrect API key");
  }
}

const generations = () => provider.sent.filter((request) => request.path === "/v1/responses");

describe("lab extraction on the member's API key", () => {
  it("runs with ChatGPT disconnected and records quantities, source page, model used, usage, tenant and cost in US dollars", async () => {
    const run = await essai([terra()]);
    expect(subscription.calls).toBe(0);
    // Counted, then generated: no model list (the key's models were recorded when it was saved).
    expect(provider.sent.map((request) => [request.path, request.authorization])).toEqual([
      ["/v1/responses/input_tokens", `Bearer ${key}`], ["/v1/responses", `Bearer ${key}`]]);
    expect(provider.sent[1].body).toMatchObject({ model: "gpt-6.1-terra", store: false, max_output_tokens: 32_000, reasoning: { effort: "medium" },
      service_tier: "default" });
    expect(run.author).toEqual({ user_id: ACCESS.owner.userId, tenant_id: ACCESS.owner.tenantId, email: null });
    const [config] = run.configs;
    expect(config).toMatchObject({ provider: "api_key", api_provider: "openai", model: "gpt-6.1-terra", reasoning_effort: "medium", status: "ok",
      error_code: null, message: null, usage: { input: 4_000, output: 300, reasoning: 600, total: 4_900 },
      billing: { source: "personal_api_key", provider: "openai", place: "local", currency: "USD", price_table: "openai-standard-2026-11-22",
        model_used: "gpt-6.1-terra-2026-10-01", service_tier: "default", ceiling_nano_usd: 1_000_000_000, allotment_nano_usd: 1_000_000_000,
        input_tokens_counted: 40_000, max_output_tokens: 32_000, bound_nano_usd: 40_000 * 2_500 + 32_000 * 5_000,
        connection_version: 1, request_id: "req_lab",
        usage: { input: 4_000, cached_input: 1_000, cache_write: 0, output: 900, reasoning: 600, total: 4_900 },
        cost_nano_usd: 3_000 * 1_000 + 1_000 * 50 + 900 * 5_000 } });
    expect(config.elements.map((element) => [element.label, element.detail, element.source_page])).toEqual([
      ["Tuyauterie cuivre DN20", "12.5 m", 1], ["Vanne isolement DN20", "4 u", 1]]);
    await expectNoSecretStored();
  });

  it("refuses the essai before any generation when the counted input leaves too little of the ceiling", async () => {
    // 300 000 counted tokens on Sol: the input alone costs 1,50 $.
    provider.counted = 300_000;
    await expect(essai([keyed("gpt-6.1-sol", "max")])).rejects.toMatchObject({ status: 409, code: "AI_KEY_CEILING",
      message: expect.stringMatching(/^Cette analyse pourrait dépasser votre plafond de 1,00 \$ US \(borne prudente : \d+,\d\d \$ US\)/) });
    expect(generations()).toEqual([]);
    expect(await storedRunTexts()).toEqual([]);
  });

  it("splits the ceiling between key configurations: their bounds together never pass it", async () => {
    const run = await essai([keyed("gpt-6.1-sol", "max"), terra("max")]);
    const bounds = run.configs.map((config) => config.billing!.bound_nano_usd ?? Number.POSITIVE_INFINITY);
    expect(run.configs.map((config) => config.billing!.allotment_nano_usd)).toEqual([500_000_000, 500_000_000]);
    expect(bounds.reduce((sum, bound) => sum + bound, 0)).toBeLessThanOrEqual(1_000_000_000);
    // Sol: 0,20 $ of counted input (12-hour write rate) leaves 0,30 $, 30 000 output tokens; Terra keeps its cap of 64 000.
    expect(generations().map((request) => request.body!.max_output_tokens)).toEqual([30_000, 64_000]);
  });

  it("says so in plain French and stops when an answer costs more than the ceiling, never a silent « Terminé »", async () => {
    const costly = { input_tokens: 40_000, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens: 250_000,
      output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 290_000 };
    provider.reply = () => answer(JSON.stringify(ITEMS), { usage: costly });
    const run = await essai([terra(), terra("high")]);
    expect(run.status).toBe("stopped");
    // Only what OpenAI announced is presented as spent.
    expect(run.stop).toEqual({ reason: "api_key_ceiling_exceeded", message: "Dépassement du plafond : OpenAI a annoncé 1,29 $ US pour cet essai, "
      + "au-delà de votre plafond de 1,00 $ US. Les configurations suivantes n’ont pas été lancées ; vérifiez votre consommation OpenAI." });
    expect(run.configs[0]).toMatchObject({ status: "ok", error_code: "AI_KEY_CEILING_EXCEEDED", message: run.stop!.message,
      billing: { cost_nano_usd: 40_000 * 1_000 + 250_000 * 5_000 } });
    expect(run.configs[1]).toMatchObject({ status: "not_run" });
    expect(generations()).toHaveLength(1);
  });

  // Review round 2, item A: the next configuration is sent only if its reservation fits what OpenAI verifiably announced.
  it("does not send the next configuration when the announced spend leaves too little for its reservation", async () => {
    // A announces 0,70 $ (140 000 output tokens at Terra's 5 $ / M) against a 0,50 $ share.
    const overShare = { input_tokens: 4_000, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens: 140_000,
      output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 144_000 };
    provider.reply = () => answer(JSON.stringify(ITEMS), { usage: overShare });
    // B (Sol, Maximum) reserves its whole 0,50 $ share: 0,70 $ + 0,50 $ would pass 1,00 $.
    const run = await essai([terra(), keyed("gpt-6.1-sol", "max")]);
    expect(generations()).toHaveLength(1);
    expect(run.status).toBe("stopped");
    expect(run.stop?.reason).toBe("api_key_ceiling_exceeded");
    expect(run.stop?.message).toMatch(/^OpenAI a annoncé 0,70 \$ US pour les configurations précédentes ; la suivante réserve jusqu’à \d+,\d\d \$ US, ce qui dépasserait votre plafond de 1,00 \$ US\. Elle n’a pas été lancée\.$/);
    expect(run.configs.map((config) => config.status)).toEqual(["ok", "not_run"]);
  });

  it("stops the remaining configurations when a reply's cost is unknown, as « consommation à confirmer »", async () => {
    provider.reply = () => answer(JSON.stringify(ITEMS), { tier: "priority" });
    const run = await essai([terra(), terra("high")]);
    expect(generations()).toHaveLength(1);
    expect(run.stop).toEqual({ reason: "api_key_failed", message: "Le coût de cet appel n’est pas connu : consommation à confirmer. "
      + "Les configurations suivantes n’ont pas été lancées." });
    expect(run.configs.map((config) => config.status)).toEqual(["ok", "not_run"]);
  });

  it("prepares every configuration before any generation: a count refused for the second sends nothing", async () => {
    let counts = 0;
    const failSecondCount = vi.fn(() => (counts += 1) === 2);
    provider.countFails = failSecondCount;
    await expect(essai([terra(), keyed("gpt-6.1-sol")])).rejects.toMatchObject({ code: "AI_KEY_COUNT_UNAVAILABLE" });
    expect(generations()).toEqual([]);
    expect(failSecondCount).toHaveBeenCalledTimes(2);
  });

  it("refuses a page drawn before the key was replaced, before reading the Keychain or calling OpenAI", async () => {
    const { openAiApiKeyAccess } = await import("@/lib/ai/access/openai-api");
    await openAiApiKeyAccess().save(ACCESS.owner, { key: `sk-proj-${randomBytes(30).toString("base64url")}` });
    provider.sent = [];
    keychain.reads = 0;
    await expect(essai([terra()])).rejects.toMatchObject({ status: 409, code: "AI_KEY_PAGE_STALE",
      message: "La clé API a changé depuis l’ouverture de cette page. Rechargez la page pour lancer avec la clé en service." });
    expect([provider.sent.length, keychain.reads]).toEqual([0, 0]);
  });

  // Review round 2, item D: every owner's first key is version 1; the page is bound to an identity unique across owners.
  it("refuses a page that showed another member's key, even when both hold a version-1 key", async () => {
    const { openAiApiKeyAccess } = await import("@/lib/ai/access/openai-api");
    for (const owner of [{ userId: "44444444-4444-4444-8444-444444444444", tenantId: ACCESS.owner.tenantId },
      { userId: ACCESS.owner.userId, tenantId: "55555555-5555-4555-8555-555555555555" }]) {
      const own = await openAiApiKeyAccess().save(owner, { key: `sk-proj-${randomBytes(30).toString("base64url")}` });
      expect(own).toMatchObject({ state: { connection: { version: 1 } } });
      provider.sent = [];
      keychain.reads = 0;
      // The session is now this owner; the open page still shows the first member's key.
      await expect(essai([terra()], { owner, email: null })).rejects.toMatchObject({ code: "AI_KEY_PAGE_STALE" });
      expect([provider.sent.length, keychain.reads]).toEqual([0, 0]);
    }
  });

  it("refuses a model whose price this code does not know, even when the key lists it", async () => {
    await expect(essai([{ provider: "api_key", apiProvider: "openai", model: "gpt-4o-mini", reasoningEffort: null, connectionId: shown }]))
      .rejects.toMatchObject({ code: "AI_KEY_PRICE_UNKNOWN" });
    expect(provider.sent).toEqual([]);
  });

  it("stops on a refused key and never falls back to the subscription", async () => {
    provider.reply = () => Response.json({ error: { message: `Incorrect API key provided: ${key}`, code: "invalid_api_key" } }, { status: 401 });
    const run = await essai([terra(), terra("high")]);
    expect(run.status).toBe("stopped");
    expect(run.stop).toEqual({ reason: "api_key_failed", message: "OpenAI a refusé cette clé. Remplacez-la dans Mon profil pour poursuivre." });
    expect(run.configs.map((config) => [config.status, config.error_code ?? null])).toEqual([["failed", "AI_KEY_REFUSED"], ["not_run", null]]);
    expect(run.configs[0].billing).toMatchObject({ cost_nano_usd: 0, usage: null });
    expect(generations()).toHaveLength(1);
    expect(subscription.calls).toBe(0);
    await expectNoSecretStored();
  });

  it("keeps the usage and cost of an answer the schema rejects", async () => {
    provider.reply = () => answer(JSON.stringify({ items: "aucun" }));
    const [config] = (await essai([terra()])).configs;
    expect(config).toMatchObject({ status: "schema_error", usage: { total: 4_900 }, billing: { cost_nano_usd: 7_550_000 } });
    expect(config.raw).toBe(JSON.stringify({ items: "aucun" }));
  });

  it("stores no key or credential a provider echoes in its answer, model id or request id", async () => {
    const echoed = { ...ITEMS, items: [{ ...ITEMS.items[0], designation: `Tuyauterie ${key}` }, ITEMS.items[1]] };
    provider.reply = () => answer(JSON.stringify(echoed), { model: key, requestId: key });
    const run = await essai([terra()]);
    expect(JSON.stringify(run)).not.toContain(key);
    expect(run.configs[0]).toMatchObject({ billing: { model_used: "gpt-6.1-terra", request_id: null } });
    await expectNoSecretStored();
  });

  it("stores no key an answer escapes in its JSON (a decoded value), and keeps « Bearer » plan text as written", async () => {
    const echoed = { ...ITEMS, items: [{ ...ITEMS.items[0], designation: `Tuyauterie ${key}` },
      { ...ITEMS.items[1], designation: "Vanne Bearer bracket DN20" }] };
    provider.reply = () => answer(JSON.stringify(echoed).replace(key, `\\u0073${key.slice(1)}`));
    const run = await essai([terra()]);
    expect(JSON.stringify(run)).not.toContain(key);
    expect(run.configs[0].elements.map((element) => element.label)).toEqual(["Tuyauterie [clé masquée]", "Vanne Bearer bracket DN20"]);
    await expectNoSecretStored();
  });

  it("leaves the cost « à confirmer » when OpenAI served another tier than Standard", async () => {
    provider.reply = () => answer(JSON.stringify(ITEMS), { tier: "priority" });
    const [config] = (await essai([terra()])).configs;
    expect(config.billing).toMatchObject({ service_tier: "priority", cost_nano_usd: null });
  });

  it("marks a response lost after sending « à confirmer » and never resends it", async () => {
    provider.reply = () => new DOMException("The operation was aborted due to timeout", "TimeoutError");
    const run = await essai([terra(), terra("high")]);
    expect(run.configs[0]).toMatchObject({ status: "failed", error_code: "AI_KEY_RESPONSE_LOST",
      message: "La réponse n’a pas été reçue. Cet appel a pu être facturé : consommation à confirmer. MergeOne ne l’a pas renvoyé.",
      billing: { cost_nano_usd: null, usage: null } });
    expect(run.stop?.reason).toBe("api_key_failed");
    expect(generations()).toHaveLength(1);
  });

  it("refuses the essai when no key is saved, without asking the subscription", async () => {
    const { openAiApiKeyAccess } = await import("@/lib/ai/access/openai-api");
    await openAiApiKeyAccess().remove(ACCESS.owner);
    provider.sent = [];
    await expect(essai([terra()])).rejects.toMatchObject({ code: "AI_KEY_MISSING" });
    expect(provider.sent).toEqual([]);
    expect(subscription.calls).toBe(0);
  });
});
