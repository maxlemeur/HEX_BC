// Test-only transport. Only the dedicated local browser test preloads this file.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { appendFile } from "node:fs/promises";
import { z } from "zod";

const preparationText = z.string().trim().min(1).max(1000);
const preparationSourceIds = z.array(z.string().min(1).max(4000)).max(20);
const preparationResponse = z.object({
  proposals: z.array(z.object({
    field: z.enum(["objective", "scope.lots", "scope.networks", "scope.levels", "scope.zones", "scope.inclusions", "scope.exclusions", "conventions.unit"]),
    values: z.array(preparationText).min(1).max(20),
    source_document_ids: preparationSourceIds.min(1),
    explanation: preparationText,
  }).strict()).max(30),
  questions: z.array(z.object({
    question: preparationText, source_document_ids: preparationSourceIds, explanation: preparationText,
  }).strict()).max(30),
}).strict();
const preparationResponseSchema = z.toJSONSchema(preparationResponse, { unrepresentable: "any" });
const canonicalSchema = value => JSON.stringify(value, (_key, entry) => entry && !Array.isArray(entry) && typeof entry === "object"
  ? Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left.localeCompare(right))) : entry);

// Observe a copy only. Never log headers, identifiers, credentials or the raw stream.
export async function readPreparationObservation(response, model, reasoningEffort) {
  assert(response.ok && response.body, "Preparation observation requires a successful response.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const texts = new Map();
  let pending = "";
  let bytes = 0;
  let completed = null;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      assert(bytes <= 8 * 1024 * 1024, "Preparation observation exceeds its bound.");
      pending = (pending + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
      let end;
      while ((end = pending.indexOf("\n\n")) !== -1) {
        const event = pending.slice(0, end);
        pending = pending.slice(end + 2);
        const data = event.split("\n").filter(line => line.startsWith("data:"))
          .map(line => line.slice(5).trimStart()).join("\n");
        if (!data || data === "[DONE]") continue;
        const parsed = JSON.parse(data);
        assert(!["response.failed", "response.incomplete", "error"].includes(parsed.type), "Preparation response failed.");
        if (parsed.type === "response.completed") completed = parsed.response;
        const part = `${parsed.output_index ?? 0}:${parsed.content_index ?? 0}`;
        if (parsed.type === "response.output_text.delta" && typeof parsed.delta === "string") texts.set(part, (texts.get(part) ?? "") + parsed.delta);
        if (parsed.type === "response.output_text.done" && typeof parsed.text === "string") texts.set(part, parsed.text);
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  assert(completed?.status === "completed", "Preparation response has no successful terminal event.");
  const finalText = (completed.output ?? []).filter(item => item.type === "message").flatMap(item => item.content ?? [])
    .filter(item => item.type === "output_text").map(item => item.text ?? "").join("");
  const result = preparationResponse.parse(JSON.parse(finalText || [...texts.values()].join("")));
  const usage = z.object({ input_tokens: z.number(), output_tokens: z.number(), total_tokens: z.number() }).parse(completed.usage);
  return { entryType: "preparation-result", provider: "chatgpt-live", model,
    ...(reasoningEffort ? { reasoningEffort } : {}), ...result, usage };
}

let liveProbe = null;
try { liveProbe = JSON.parse(readFileSync(path.resolve(".private/chatgpt-local-live-probe.json"), "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw new Error("Invalid live probe configuration."); }
let businessProbe = null;
try { businessProbe = JSON.parse(readFileSync(path.resolve(".private/chatgpt-local-business-probe.json"), "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw new Error("Invalid private business probe configuration."); }
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
  let preparation = false;
  if (liveProbe && businessProbe && body && !pdf) {
    const developer = body.input.find(entry => entry.role === "developer")?.content;
    const user = body.input.find(entry => entry.role === "user")?.content;
    if (typeof developer === "string" && developer.startsWith("Schéma JSON : ")) {
      const schema = JSON.parse(developer.slice("Schéma JSON : ".length));
      if (canonicalSchema(schema) === canonicalSchema(preparationResponseSchema)) {
        const prompt = user?.find(part => part.type === "input_text")?.text;
        const evidence = typeof prompt === "string" ? JSON.parse(prompt.split("\n").at(-1)) : null;
        preparation = evidence?.user_request === `${businessProbe.inclusions} ${businessProbe.exclusions}` &&
          evidence.preparation?.scope?.levels?.includes("R+1") && evidence.preparation?.scope?.zones?.includes("Zone 1") &&
          evidence.sources?.some(source => source.document_name === path.basename(businessProbe.pdfPath));
      }
    }
  }
  const sourceMatched = () => pdf || preparation || (JSON.stringify(body.input).includes("ARMY copper pipe") && JSON.stringify(body.input).includes("12.5"));
  const transportEntry = (provider) => ({ provider, model: body.model, sourceMatched: true,
    ...(liveProbe ? { reasoningEffort: body.reasoning?.effort ?? null } : {}),
    ...(pdf ? { inputKind: "pdf" } : preparation ? { inputKind: "preparation" } : {}) });
  if (liveProbe) {
    assert(new Headers(init?.headers).get("authorization") === `Bearer ${liveProbe.accessToken}`, "Unexpected live plan credential.");
    assert(["/v1/models", "/v1/responses"].includes(url.pathname), "Unexpected OpenAI endpoint.");
    if (url.pathname === "/v1/models") return originalFetch(input, init);
    assert(body.model === liveProbe.model && body.store === false && body.stream === true, "Invalid live plan request.");
    assert((body.reasoning?.effort ?? null) === (liveProbe.reasoningEffort ?? null), "Unexpected live reasoning effort.");
    assert(sourceMatched(), "Uploaded source must reach the plan request.");
    await appendFile(process.env.ARMY_CHATGPT_TRANSPORT_LOG, JSON.stringify(transportEntry("chatgpt-live")) + "\n");
    const response = await originalFetch(input, init);
    if (preparation) {
      void readPreparationObservation(response.clone(), body.model, body.reasoning?.effort)
        .then(observation => appendFile(process.env.ARMY_CHATGPT_TRANSPORT_LOG, JSON.stringify(observation) + "\n"))
        .catch(() => appendFile(process.env.ARMY_CHATGPT_TRANSPORT_LOG, JSON.stringify({ entryType: "preparation-observation-error" }) + "\n"));
    }
    return response;
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
    // Level C requires a global confidence besides the per-item one.
    data.confidence = 0.99;
  }
  const output = JSON.stringify(data);
  await appendFile(process.env.ARMY_CHATGPT_TRANSPORT_LOG, JSON.stringify(transportEntry("chatgpt-fixture")) + "\n");
  return new Response([
    { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: output },
    { type: "response.completed", response: { status: "completed", output: [], usage: { input_tokens: 24, output_tokens: 18, total_tokens: 42 } } },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
};
