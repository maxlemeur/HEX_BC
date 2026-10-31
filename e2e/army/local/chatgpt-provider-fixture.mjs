// Test-only transport. Only the dedicated local browser test preloads this file.
import assert from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { appendFile } from "node:fs/promises";
import { z } from "zod";

// Preserve crash locations without raw errors, provider payloads, URLs or tokens.
const processDiagnostic = (kind, code, error, origin) => {
  const frames = (error?.stack ?? new Error().stack ?? "").split("\n").slice(1)
    .flatMap(line => [...line.matchAll(/([^/\s():]+\.(?:[cm]?js|ts)):(\d+):(\d+)/g)]
      .map(match => `${match[1]}:${match[2]}:${match[3]}`)).slice(0, 12);
  const name = ["Error", "TypeError", "RangeError", "SyntaxError", "AbortError", "TimeoutError", "ResponseAborted"].includes(error?.name) ? error.name : null;
  const nodeCode = ["ECONNRESET", "EPIPE", "ENOENT", "EACCES", "EADDRINUSE", "ABORT_ERR", "ERR_INVALID_STATE",
    "ERR_INVALID_ARG_TYPE", "ERR_INVALID_URL", "ERR_STREAM_DESTROYED", "ERR_STREAM_PREMATURE_CLOSE", "ERR_HTTP_HEADERS_SENT"].includes(error?.code) ? error.code : null;
  const controlFlow = ["NEXT_REDIRECT", "NEXT_HTTP_ERROR_FALLBACK", "NEXT_NOT_FOUND"].find(value =>
    typeof error?.digest === "string" && error.digest.startsWith(value + ";")) ?? null;
  const messageKind = ["aborted", "socket hang up", "The operation was aborted", "This operation was aborted"].includes(error?.message)
    ? error.message : null;
  try { appendFileSync(process.env.ARMY_CHATGPT_TRANSPORT_LOG, JSON.stringify({ provider: "process-diagnostic", kind,
    timestamp: Date.now(), pid: process.pid, ppid: process.ppid,
    role: ["next", "next-dev.js", "start-server.js", "processChild.js", "_tsc.js", "detached-flush.js", "dev-chatgpt-local.mjs"].find(value => value === path.basename(process.argv[1] ?? "")) ?? "other",
    code: typeof code === "number" ? code : null, name, nodeCode, controlFlow, messageKind,
    origin: ["uncaughtException", "unhandledRejection", "application-hook"].includes(origin) ? origin : null,
    errorType: typeof error, frames }) + "\n"); } catch { /* Preserve the original exit. */ }
};
process.on("uncaughtExceptionMonitor", (error, origin) => processDiagnostic("uncaught", null, error, origin));
const originalConsoleError = console.error;
console.error = (...args) => {
  if (args[0] === "[error-reporter]" && args[1] === "uncaughtException") {
    processDiagnostic("application-uncaught", null, args[2], "application-hook");
  }
  return originalConsoleError(...args);
};
const originalExit = process.exit.bind(process);
process.exit = code => { processDiagnostic("exit", typeof code === "number" ? code : process.exitCode); return originalExit(code); };

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
  if (!liveProbe && url.pathname === "/v1/decisions") {
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer army-decisions-fixture");
    const request = JSON.parse(init.body);
    assert.equal(request.model, "gpt-6-luna");
    await appendFile(process.env.ARMY_CHATGPT_TRANSPORT_LOG, JSON.stringify({ provider: "decisions-fixture", questions: request.questions.length }) + "\n");
    const deadline = Date.now() + 15_000;
    while (JSON.parse(readFileSync(process.env.ARMY_DECISIONS_CONTROL, "utf8")).hold) {
      if (Date.now() >= deadline) throw new Error("The controlled Decisions response was not released.");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const answers = request.questions.map((question) => {
      if (question.type === "choice") {
        const preferred = question.name.startsWith("document_") ? "plans" : "sources";
        // Reprise des prix (PRX02) : le dernier candidat, différent de la proposition du rapprochement (le premier).
        const choice = question.name.startsWith("ligne_")
          ? question.choices.filter((candidate) => candidate.value !== "aucun").at(-1)
          : question.choices.find((candidate) => candidate.value === preferred) ?? question.choices[0];
        return { name: question.name, type: "choice", choice: choice.value, confidence: 0.8,
          probabilities: question.choices.map((candidate) => ({ value: candidate.value, probability: candidate.value === choice.value ? 1 : 0 })) };
      }
      assert.equal(question.type, "score");
      return { name: question.name, type: "score", score: 2, confidence: 0.8,
        probabilities: question.levels.map((level, value) => ({ label: level.label, value, probability: value === 2 ? 1 : 0 })) };
    });
    return Response.json({ model: "gpt-6-luna", answers, usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 } });
  }
  if (!liveProbe && url.pathname === "/v1/responses" && JSON.parse(readFileSync(process.env.ARMY_DECISIONS_CONTROL, "utf8")).timeoutWriting) {
    await appendFile(process.env.ARMY_CHATGPT_TRANSPORT_LOG, JSON.stringify({ provider: "chatgpt-fixture-timeout" }) + "\n");
    throw new DOMException("Simulated provider timeout", "TimeoutError");
  }
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
  // Reprise des prix (PRX02) : aucun document ; le dernier candidat de chaque ligne à vérifier, avant « aucun ».
  const priceReuseSchema = body.input.find(entry => entry.role === "developer")?.content;
  if (typeof priceReuseSchema === "string" && priceReuseSchema.includes("\"price_reuse_answers\"")) {
    const prompt = body.input.find(entry => entry.role === "user")?.content?.find(part => part.type === "input_text")?.text ?? "";
    const evidence = JSON.parse(prompt.split("\n").at(-1));
    const answers = evidence.lignes.map(line => ({ ligne: line.ligne, choix: line.choix.at(-2), confiance: 0.7 }));
    await appendFile(process.env.ARMY_CHATGPT_TRANSPORT_LOG,
      JSON.stringify({ provider: "chatgpt-fixture", task: "price-reuse", lines: answers.length, model: body.model }) + "\n");
    return new Response([
      { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: JSON.stringify({ price_reuse_answers: answers }) },
      { type: "response.completed", response: { status: "completed", output: [], usage: { input_tokens: 12, output_tokens: 6, total_tokens: 18 } } },
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
  }
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
    if (JSON.stringify(body.input).includes("Niveau B: tables est requis")) {
      data.metadata = { level: "B", prompt_version: "takeoff-b-v1", file_type: "pdf", schema_version: "v1" };
      data.tables = [{ page: 1, title: "Quantités fictives", headers: ["Désignation", "Quantité", "Unité"], rows: [
        { row_index: 0, cells: ["Tuyauterie cuivre DN20", "12.5", "m"] },
        { row_index: 1, cells: ["Vanne isolement DN20", "4", "u"] },
      ] }];
    }
  }
  const output = JSON.stringify(data);
  await appendFile(process.env.ARMY_CHATGPT_TRANSPORT_LOG, JSON.stringify(transportEntry("chatgpt-fixture")) + "\n");
  return new Response([
    { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: output },
    { type: "response.completed", response: { status: "completed", output: [], usage: { input_tokens: 24, output_tokens: 18, total_tokens: 42 } } },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
};
