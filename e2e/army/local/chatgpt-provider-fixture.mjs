// Test-only transport. Only the dedicated local browser test preloads this file.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { appendFile } from "node:fs/promises";

let liveProbe = null;
try { liveProbe = JSON.parse(readFileSync(path.resolve(".private/chatgpt-local-live-probe.json"), "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw new Error("Invalid live probe configuration."); }
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname === "generativelanguage.googleapis.com" || url.pathname === "/functions/v1/process_takeoff_job") {
    await appendFile(process.env.ARMY_CHATGPT_TRANSPORT_LOG, JSON.stringify({ provider: "forbidden", host: url.hostname }) + "\n");
    throw new Error("ChatGPT probe forbids Gemini and Edge dispatch.");
  }
  if (url.origin !== "https://api.openai.com") return originalFetch(input, init);
  const body = url.pathname === "/v1/responses" ? JSON.parse(init.body) : null;
  const pdf = body?.input.flatMap(entry => Array.isArray(entry.content) ? entry.content : [])
    .find(part => part.type === "input_file");
  if (pdf) assert(pdf.file_data.startsWith("data:application/pdf;base64,JVBER"), "PDF must reach OpenAI inline.");
  const sourceMatched = () => pdf || (JSON.stringify(body.input).includes("ARMY copper pipe") && JSON.stringify(body.input).includes("12.5"));
  const transportEntry = (provider) => ({ provider, model: body.model, sourceMatched: true, ...(pdf ? { inputKind: "pdf" } : {}) });
  if (liveProbe) {
    assert(new Headers(init?.headers).get("authorization") === `Bearer ${liveProbe.accessToken}`, "Unexpected live plan credential.");
    assert(["/v1/models", "/v1/responses"].includes(url.pathname), "Unexpected OpenAI endpoint.");
    if (url.pathname === "/v1/models") return originalFetch(input, init);
    assert(body.model === liveProbe.model && body.store === false && body.stream === true, "Invalid live plan request.");
    assert(sourceMatched(), "Uploaded source must reach the plan request.");
    await appendFile(process.env.ARMY_CHATGPT_TRANSPORT_LOG, JSON.stringify(transportEntry("chatgpt-live")) + "\n");
    return originalFetch(input, init);
  }
  assert.equal(new Headers(init?.headers).get("authorization"), "Bearer army-chatgpt-fixture");
  if (url.pathname === "/v1/models") return Response.json({ models: [{ slug: "army-plan-model", display_name: "ARMY plan model", visibility: "list" }] });
  assert.equal(url.pathname, "/v1/responses");
  assert.equal(body.model, "army-plan-model"); assert.equal(body.store, false); assert.equal(body.stream, true);
  assert(sourceMatched(), "Uploaded source must reach the plan request.");
  const data = { items: [{ designation: "ARMY copper pipe", quantity: 12.5, unit: "m", source_page: 1 }], warnings: [],
    metadata: { level: "A", prompt_version: "takeoff-a-v1", file_type: "csv", schema_version: "v1" } };
  if (pdf) {
    data.items = [
      { designation: "Tuyauterie cuivre DN20", quantity: 12.5, unit: "m", source_page: 1, confidence: 0.99, evidence: "Cotes 5,00 m et 7,50 m" },
      { designation: "Vanne isolement DN20", quantity: 4, unit: "u", source_page: 1, confidence: 0.99, evidence: "Reperes V1 a V4" },
    ];
    data.metadata = { level: "C", prompt_version: "takeoff-c-v1", file_type: "pdf", schema_version: "v1" };
  }
  const output = JSON.stringify(data);
  await appendFile(process.env.ARMY_CHATGPT_TRANSPORT_LOG, JSON.stringify(transportEntry("chatgpt-fixture")) + "\n");
  return new Response([
    { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: output },
    { type: "response.completed", response: { status: "completed", output: [], usage: { input_tokens: 24, output_tokens: 18, total_tokens: 42 } } },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
};
