import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { register } from "tsx/cjs/api";
import { createClient } from "@supabase/supabase-js";

// Test-only worker entrypoint. The application keeps its Edge dispatch guard.
// Invoke exactly one newly owned job; never scan a queue or seed its outcome.
const [projectId, versionId, jobId, prefix, mode = "success"] = process.argv.slice(2);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
assert([projectId, versionId, jobId].every((value) => uuid.test(value ?? "")));
assert(/^ARMY-[A-Za-z0-9-]+$/.test(prefix ?? ""));
assert(["success", "transient", "terminal", "hold"].includes(mode));
assert.equal(process.env.E2E_ARMY_TAKEOFF_WORKER, "1", "Dedicated owned-worker profile required.");
assert.equal(process.env.E2E_ARMY_BLOCK_WORKERS, "1", "The ordinary app must keep blocking Edge workers.");
const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
const database = new URL(process.env.E2E_ARMY_LOCAL_DB_URL ?? "");
for (const url of [backend, database]) assert(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
assert.equal(backend.protocol, "http:");
assert(["postgres:", "postgresql:"].includes(database.protocol));
assert.equal(backend.hostname, process.env.E2E_ALLOWED_SUPABASE_HOST);
assert(!["45585", "33485"].includes(backend.port) && !["45585", "33485"].includes(database.port), "Long-lived recipe stack is not a worker target.");
await import("./coverage-network-guard.mjs");
process.env.GEMINI_API_KEY = "";
process.env.GOOGLE_GENERATIVE_AI_API_KEY = "";
process.env.SENTRY_DSN = "";

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const user = createClient(backend.origin, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, clientOptions);
const login = await user.auth.signInWithPassword({ email: process.env.E2E_LOGIN_EMAIL, password: process.env.E2E_LOGIN_PASSWORD });
assert.equal(login.error, null, "Ordinary fixture authentication failed.");
const version = await user.from("estimate_versions").select("id, project_id, tenant_id, calc_engine_version").eq("id", versionId).single();
assert.equal(version.error, null);
assert.equal(version.data.project_id, projectId);
assert.equal(version.data.calc_engine_version, 2, "Positive worker journeys require an actual compatible v2.");
const project = await user.from("estimate_projects").select("id, name, user_id").eq("id", projectId).single();
assert.equal(project.error, null);
assert(project.data.name.startsWith(prefix));
assert.equal(project.data.user_id, login.data.user.id);
const tenant = await user.from("tenants").select("name").eq("id", version.data.tenant_id).single();
assert.equal(tenant.error, null);
assert(/^ARMY\b/.test(tenant.data.name));
const visibleJob = await user.from("takeoff_jobs").select("id, tenant_id, estimate_version_id, created_by").eq("id", jobId).single();
assert.equal(visibleJob.error, null);
assert.equal(visibleJob.data.estimate_version_id, versionId);
assert.equal(visibleJob.data.tenant_id, version.data.tenant_id);
assert.equal(visibleJob.data.created_by, login.data.user.id);

const worker = createClient(backend.origin, process.env.SUPABASE_SERVICE_ROLE_KEY, clientOptions);
const readJob = async () => {
  const { data, error } = await worker.from("takeoff_jobs").select("id, status, level, estimate_version_id, tenant_id, source_file_name, source_file_path, retry_count, error_code, next_retry_at, processing_lease_token").eq("id", jobId).single();
  assert.equal(error, null);
  assert.equal(data.estimate_version_id, versionId);
  assert.equal(data.tenant_id, version.data.tenant_id);
  return data;
};
// One module graph preserves TakeoffError identity across provider, processor
// and async worker. Separate tsImport calls create separate namespaces and can
// mistakenly reclassify an explicitly non-retryable provider error.
const runtime = register({ namespace: "army-owned-takeoff-worker" });
const load = (file) => runtime.require(file, import.meta.url);
const { processTakeoffJobAttempt } = load("../../src/lib/takeoff/async-worker.ts");
const { processLevelA, processLevelB } = load("../../src/lib/takeoff/processor.ts");
const { TakeoffError, TakeoffErrorCode } = load("../../src/lib/takeoff/errors.ts");
const events = [];
const emit = (event) => process.stdout.write("ARMY_WORKER " + JSON.stringify(event) + "\n");
let release;
const released = new Promise((resolve) => { release = resolve; });
const input = createInterface({ input: process.stdin });
input.on("line", (line) => { if (line === "release") release(); });
let timer;
const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Owned worker provider barrier timed out.")), 45_000); });
const callGemini = async (options) => {
  assert.equal(options.context.jobId, jobId);
  assert.equal(options.context.tenantId, version.data.tenant_id);
  const current = await readJob();
  assert.equal(current.status, "processing");
  assert(current.processing_lease_token, "Real processing lease required before provider.");
  const sourceProof = options.files?.map((file) => ({ mimeType: file.mimeType, bytes: Buffer.from(file.data, "base64").length,
    sha256: createHash("sha256").update(Buffer.from(file.data, "base64")).digest("hex") })) ?? [];
  if (current.level === "A") assert(options.files?.some((file) => {
    const csv = Buffer.from(file.data, "base64").toString("utf8");
    return file.mimeType === "text/csv" && csv.includes("ARMY worker pipe") && csv.includes("12.5");
  }), "Real uploaded CSV must reach the provider boundary.");
  else assert(sourceProof.some((file) => file.mimeType === "application/pdf" && file.bytes > 100), "Real stored PDF must reach the provider boundary.");
  const event = { event: "provider", jobId, status: current.status, mode, sourceProof };
  events.push(event);
  emit(event);
  if (mode === "hold") await Promise.race([released, timeout]);
  if (mode === "transient" || mode === "terminal") throw new TakeoffError({
    code: mode === "transient" ? TakeoffErrorCode.AI_TIMEOUT : TakeoffErrorCode.AI_PROVIDER,
    message: mode === "transient" ? "ARMY controlled provider timeout" : "ARMY controlled terminal provider failure",
    retryable: mode === "transient", jobId, level: current.level,
  });
  const data = options.schema.parse({
    items: [
      { designation: "ARMY worker pipe", quantity: 12.5, unit: "m", source_page: 1, confidence: 0.99, evidence: "Pipe row, page 1" },
      { designation: "ARMY worker valve", quantity: 3, unit: "u", source_page: 1, confidence: 0.99, evidence: "Valve row, page 1" },
    ],
    warnings: [],
    tables: [{ page: 1, title: "ARMY quantities", headers: ["designation", "quantity", "unit"],
      rows: [{ row_index: 0, cells: ["ARMY worker pipe", "12.5", "m"] }, { row_index: 1, cells: ["ARMY worker valve", "3", "u"] }] }],
    metadata: { level: current.level, prompt_version: options.context.promptVersion, file_type: current.level === "A" ? "csv" : "pdf", schema_version: "v1" },
  });
  return { data, tokenCount: 0, tokenUsage: { inputTokens: 0, reasoningTokens: 0, outputTokens: 0, totalTokens: 0 },
    costCents: 0, durationMs: 1, model: options.context.model, promptVersion: options.context.promptVersion, providerBatchId: null, providerBatchStateRaw: null };
};
try {
  const outcome = await processTakeoffJobAttempt(jobId, {
    correlationId: randomUUID(), trigger: "create",
    processLevelAFn: (id, options) => processLevelA(id, { ...options, callGemini }),
    processLevelBFn: (id, options) => processLevelB(id, { ...options, callGemini }),
  });
  const job = await readJob();
  const results = await worker.from("takeoff_results").select("id").eq("job_id", jobId);
  const items = await worker.from("takeoff_items").select("id, designation, quantity, unit, source_file_name, source_page").eq("job_id", jobId).order("designation");
  assert.equal(results.error, null);
  assert.equal(items.error, null);
  emit({ event: "result", outcome, job: { id: job.id, status: job.status, level: job.level, retryCount: job.retry_count,
    errorCode: job.error_code, nextRetryAt: job.next_retry_at }, resultIds: results.data.map((row) => row.id), items: items.data, providerCalls: events.length });
} finally {
  clearTimeout(timer);
  input.close();
  runtime.unregister();
}
