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
  if (liveProbe) {
    assert(new Headers(init?.headers).get("authorization") === `Bearer ${liveProbe.accessToken}`, "Unexpected live plan credential.");
    assert(["/v1/models", "/v1/responses"].includes(url.pathname), "Unexpected OpenAI endpoint.");
    if (url.pathname === "/v1/models") return originalFetch(input, init);
    const body = JSON.parse(init.body);
    assert(body.model === liveProbe.model && body.store === false && body.stream === true, "Invalid live plan request.");
    const text = JSON.stringify(body.input);
    assert(text.includes("ARMY copper pipe") && text.includes("12.5"), "Uploaded source must reach the plan request.");
    await appendFile(process.env.ARMY_CHATGPT_TRANSPORT_LOG, JSON.stringify({ provider: "chatgpt-live", model: body.model, sourceMatched: true }) + "\n");
    return originalFetch(input, init);
  }
  assert.equal(new Headers(init?.headers).get("authorization"), "Bearer army-chatgpt-fixture");
  if (url.pathname === "/v1/models") return Response.json({ models: [{ slug: "army-plan-model", display_name: "ARMY plan model", visibility: "list" }] });
  assert.equal(url.pathname, "/v1/responses");
  const body = JSON.parse(init.body);
  assert.equal(body.model, "army-plan-model"); assert.equal(body.store, false); assert.equal(body.stream, true);
  const text = JSON.stringify(body.input);
  assert(text.includes("ARMY copper pipe") && text.includes("12.5"), "Uploaded source must reach the plan request.");
  const data = { items: [{ designation: "ARMY copper pipe", quantity: 12.5, unit: "m", source_page: 1 }], warnings: [],
    metadata: { level: "A", prompt_version: "takeoff-a-v1", file_type: "csv", schema_version: "v1" } };
  const output = JSON.stringify(data);
  await appendFile(process.env.ARMY_CHATGPT_TRANSPORT_LOG, JSON.stringify({ provider: "chatgpt-fixture", model: body.model, sourceMatched: true }) + "\n");
  return new Response([
    { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: output },
    { type: "response.completed", response: { status: "completed", output: [], usage: { input_tokens: 24, output_tokens: 18, total_tokens: 42 } } },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
};
