// Test-only. Preloaded with NODE_OPTIONS --import, after chatgpt-provider-fixture.mjs, by the takeoff lab's own
// development server (takeoff-lab.e2e.ts, LAB05). No product code imports it.
//
// 1. The Keychain's stand-in. CI runs on Linux, without a Keychain. This puts an in-memory store on the global
//    that src/lib/ai/access/secret-store.ts honours only in a development server with E2E_ARMY=1 (never a
//    production build, never CI test processes). It holds the key in this process's memory: no file, gone at exit.
// 2. OpenAI's API at its HTTP boundary, for a personal key: the API's model list (not the subscription's), and
//    Responses answered from the fictional plan's independent truth (12,5 m of copper pipe, four valves). Every
//    request is checked (fixed origin, key, store false, bounded output, model and effort the key may use).
//    The journey gives only the key's SHA-256 (ARMY_API_KEY_CONTROL); the transport log never holds the key.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { readFileSync } from "node:fs";

const values = new Map();
globalThis[Symbol.for("mergeone.e2e.aiSecretStore")] = {
  kind: "e2e-memory",
  placeLabel: "Trousseau de test",
  read: (service, account) => values.get(`${service}\u0000${account}`) ?? null,
  write: (service, account, value) => { values.set(`${service}\u0000${account}`, value); },
  remove: (service, account) => { values.delete(`${service}\u0000${account}`); },
};

const EFFORTS = { "gpt-6.1-terra": ["none", "low", "medium", "high", "xhigh", "max"], "gpt-6.1-sol": ["low", "medium", "high", "xhigh", "max"] };
const control = () => JSON.parse(readFileSync(process.env.ARMY_API_KEY_CONTROL, "utf8"));
const log = (entry) => appendFile(process.env.ARMY_CHATGPT_TRANSPORT_LOG, JSON.stringify({ provider: "api-key-fixture", ...entry }) + "\n");
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-request-id": "req_army_api_key" } });

const previousFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  const authorization = new Headers(init?.headers).get("authorization") ?? "";
  // The subscription's fixture keeps its own requests (Bearer army-chatgpt-fixture, Decisions).
  if (url.origin !== "https://api.openai.com" || !authorization.startsWith("Bearer sk-")) return previousFetch(input, init);
  const { keySha256, mode } = control();
  const sentKey = authorization.slice("Bearer ".length);
  assert.equal(createHash("sha256").update(sentKey).digest("hex"), keySha256, "Only the journey's fictional key may reach the API fixture.");
  assert.equal(init?.redirect, "error", "A request carrying a key never follows a redirect.");
  if (mode === "refused") {
    await log({ operation: url.pathname === "/v1/models" ? "models" : "responses", refused: true });
    return json({ error: { message: "Incorrect API key provided.", type: "invalid_request_error", code: "invalid_api_key" } }, 401);
  }
  if (url.pathname === "/v1/models") {
    assert.equal(init?.method ?? "GET", "GET");
    await log({ operation: "models" });
    return json({ object: "list", data: ["gpt-6.1-terra", "gpt-6.1-sol", "gpt-4o-mini"].map((id) => ({ id, object: "model", created: 1, owned_by: "openai" })) });
  }
  assert.equal(url.pathname, "/v1/responses");
  const body = JSON.parse(init.body);
  assert.equal(body.store, false, "Responses must not be stored at the provider.");
  assert(!body.stream, "The key's requests are not streamed.");
  assert(Number.isInteger(body.max_output_tokens) && body.max_output_tokens > 0 && body.max_output_tokens <= 64_000, "The output is bounded.");
  assert(Object.hasOwn(EFFORTS, body.model), "Only qualified models are sent.");
  if (body.reasoning) assert(EFFORTS[body.model].includes(body.reasoning.effort), "The effort is one the model accepts.");
  const parts = body.input.flatMap((entry) => (Array.isArray(entry.content) ? entry.content : []));
  const pdf = parts.find((part) => part.type === "input_file");
  const format = body.text?.format?.type;
  await log({ operation: "responses", model: body.model, reasoningEffort: body.reasoning?.effort ?? null, inputKind: pdf ? "pdf" : "none",
    format, store: body.store, maxOutputTokens: body.max_output_tokens });
  let text;
  if (pdf) {
    assert(pdf.file_data.startsWith("data:application/pdf;base64,JVBER"), "The plan reaches OpenAI inline.");
    assert.equal(format, "json_object");
    text = JSON.stringify({ items: [
      { designation: "Tuyauterie cuivre DN20", quantity: 12.5, unit: "m", source_page: 1, confidence: 0.99, evidence: "Cotes 5,00 m et 7,50 m" },
      { designation: "Vanne isolement DN20", quantity: 4, unit: "u", source_page: 1, confidence: 0.99, evidence: "Reperes V1 a V4" },
    ], warnings: [], confidence: 0.99, metadata: { level: "C", prompt_version: "takeoff-c-v1", file_type: "pdf", schema_version: "v1" } });
  } else {
    assert.deepEqual(body.text.format, { type: "json_schema", name: "mergeone_model_test", strict: true, schema: body.text.format.schema });
    text = JSON.stringify({ connexion: "ok" });
  }
  return json({ id: "resp_army", object: "response", status: "completed", model: `${body.model}-2026-10-01`,
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] }],
    usage: { input_tokens: 2_400, input_tokens_details: { cached_tokens: 400 }, output_tokens: 300, output_tokens_details: { reasoning_tokens: 120 }, total_tokens: 2_700 } });
};
