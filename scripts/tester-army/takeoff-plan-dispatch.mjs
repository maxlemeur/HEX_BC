import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { register } from "tsx/cjs/api";
import { createClient } from "@supabase/supabase-js";

// Test-only worker of the owned takeoff journeys (lot 3, one analysis per plan): one pass of this Mac's dispatcher
// (runLocalTakeoffDispatcherPass), the real claim, slot, ledger, processor, persistence and end of each unit, with a
// controlled local provider in place of the creator's ChatGPT plan. The provider keeps its contract with the worker: it
// reserves each paid call in the job's ledger before « sending » it and settles it with its usage after. Its outcome per
// job comes from ARMY_TAKEOFF_PLAN_MODES: success, terminal (a definitive failure), hold (its call is held, a barrier
// the journey observes, until its job is no longer processing, then settled), or release (its call is held until the
// journey creates ARMY_TAKEOFF_HOLD_RELEASE_FILE, then answered as a success); each call lasts
// ARMY_TAKEOFF_PROVIDER_DELAY_MS. ARMY_TAKEOFF_PLAN_ITEMS may give a job the lines its reading returns (designation,
// quantity, unit, page local to the copied PDF). A job that reads its plan against its request's sealed list (lot 4, the
// second measuring order) is answered item by item from the manifest of each call, as the model would
// (poste-reading.test-fixtures.ts): « not found » on every page the call owns unless ARMY_TAKEOFF_ITEM_ANSWERS gives the
// job, by item label, a measure, an uncertain answer or « omit » (no answer for the item). Pages are local to the copied PDF;
// its `truncate` cuts the answer in half, as a reading cut short.
const [projectId, prefix] = process.argv.slice(2);
assert(/^[0-9a-f-]{36}$/.test(projectId ?? ""));
assert(/^ARMY-[A-Za-z0-9-]+$/.test(prefix ?? ""));
assert.equal(process.env.E2E_ARMY_TAKEOFF_WORKER, "1", "Dedicated owned-worker profile required.");
assert.equal(process.env.E2E_ARMY_BLOCK_WORKERS, "1", "The ordinary app must keep blocking Edge workers.");
assert.equal(process.env.MERGEONE_CHATGPT_LOCAL, "1", "The owned worker claims local jobs as this host.");
const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
const database = new URL(process.env.E2E_ARMY_LOCAL_DB_URL ?? "");
for (const url of [backend, database]) assert(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
assert.equal(backend.protocol, "http:");
assert.equal(backend.hostname, process.env.E2E_ALLOWED_SUPABASE_HOST);
assert(!["45585", "33485"].includes(backend.port) && !["45585", "33485"].includes(database.port), "Long-lived recipe stack is not a worker target.");
await import("./coverage-network-guard.mjs");
assert(!process.env.OPENAI_DECISIONS_API_KEY, "The owned worker holds no Decisions key.");
process.env.SENTRY_DSN = "";
const modes = JSON.parse(process.env.ARMY_TAKEOFF_PLAN_MODES ?? "{}");
assert(Object.values(modes).every((mode) => ["success", "terminal", "hold", "release"].includes(mode)));
const releaseFile = process.env.ARMY_TAKEOFF_HOLD_RELEASE_FILE ?? "";
assert(!Object.values(modes).includes("release") || releaseFile.length > 0, "A released hold names its release file.");
const planItems = JSON.parse(process.env.ARMY_TAKEOFF_PLAN_ITEMS ?? "{}");
assert(Object.values(planItems).every((items) => Array.isArray(items) && items.every((item) => typeof item.designation === "string"
  && Number.isFinite(item.quantity) && typeof item.unit === "string" && Number.isInteger(item.source_page))));
const itemAnswers = JSON.parse(process.env.ARMY_TAKEOFF_ITEM_ANSWERS ?? "{}");
const hasFigure = (answer) => Number.isFinite(answer?.quantity) && typeof answer.unit === "string";
const isItemAnswer = (answer) => {
  if (answer === "omit") return true;
  if (!Number.isInteger(answer?.page)) return false;
  if (!answer.uncertain) return hasFigure(answer);
  return typeof answer.text === "string" && (answer.uncertain === "PARTIAL_QUANTITY" ? hasFigure(answer.figure)
    : answer.uncertain === "QUALIFIER_UNREADABLE" && (answer.figure === undefined || hasFigure(answer.figure)));
};
assert(Object.values(itemAnswers).every((spec) => spec && typeof spec === "object" && Object.values(spec.items ?? {}).every(isItemAnswer)));
const delayMs = Number(process.env.ARMY_TAKEOFF_PROVIDER_DELAY_MS ?? "0");
assert(Number.isInteger(delayMs) && delayMs >= 0 && delayMs <= 5_000);

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const user = createClient(backend.origin, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, clientOptions);
const login = await user.auth.signInWithPassword({ email: process.env.E2E_LOGIN_EMAIL, password: process.env.E2E_LOGIN_PASSWORD });
assert.equal(login.error, null, "Ordinary fixture authentication failed.");
const project = await user.from("estimate_projects").select("id, name, user_id, tenant_id").eq("id", projectId).single();
assert.equal(project.error, null);
assert(project.data.name.startsWith(prefix));
assert.equal(project.data.user_id, login.data.user.id);
const tenantId = project.data.tenant_id;
const worker = createClient(backend.origin, process.env.SUPABASE_SERVICE_ROLE_KEY, clientOptions);

const runtime = register({ namespace: "army-owned-takeoff-dispatch" });
const load = (file) => runtime.require(file, import.meta.url);
const { processTakeoffJobAttempt } = load("../../src/lib/takeoff/async-worker.ts");
const { processLevelC } = load("../../src/lib/takeoff/processor.ts");
const { runLocalTakeoffDispatcherPass } = load("../../src/lib/takeoff/local-dispatcher.ts");
const { TakeoffError, TakeoffErrorCode } = load("../../src/lib/takeoff/errors.ts");
const { POSTE_EXCHANGE_PROMPT_VERSION } = load("../../src/lib/takeoff/poste-exchange.ts");
const { posteMeasured, posteNotFound, readPosteManifest } = load("../../src/lib/takeoff/poste-reading.test-fixtures.ts");
const emit = (event) => process.stdout.write("ARMY_DISPATCH " + JSON.stringify(event) + "\n");
const calls = [];
let inFlight = 0;
let maxInFlight = 0;

const resolveProvider = async (_supabase, job, hooks) => {
  assert.equal(job.tenant_id, tenantId);
  assert.equal(job.execution_provider, "chatgpt_local");
  assert(hooks?.ledger, "The execution scope gives every attempt its ledger.");
  const selection = { profileId: "army-worker-profile", model: "army-worker-model", reasoningEffort: null };
  const call = async (options) => {
    assert.equal(options.context.jobId, job.id);
    const { data: current, error } = await worker.from("takeoff_jobs").select("status, processing_lease_token, preparation_snapshot")
      .eq("id", job.id).single();
    assert.equal(error, null);
    assert.equal(current.status, "processing");
    assert(current.processing_lease_token, "Real processing lease required before provider.");
    const paid = await hooks.ledger.beforePaidCall("pdf");
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const startedAt = Date.now();
    const files = (options.files ?? []).map((file) => ({ mimeType: file.mimeType, bytes: Buffer.from(file.data, "base64").length,
      sha256: createHash("sha256").update(Buffer.from(file.data, "base64")).digest("hex") }));
    if (delayMs) await sleep(delayMs);
    const mode = modes[job.id] ?? "success";
    if (mode === "hold") {
      for (let waited = 0; waited < 60_000; waited += 100) {
        const { data: held } = await worker.from("takeoff_jobs").select("status").eq("id", job.id).single();
        if (held?.status !== "processing") break;
        await sleep(100);
      }
    }
    if (mode === "release") {
      for (let waited = 0; waited < 120_000 && !existsSync(releaseFile); waited += 100) await sleep(100);
      assert(existsSync(releaseFile), "The journey never released the held reading.");
    }
    inFlight -= 1;
    calls.push({ jobId: job.id, startedAt, endedAt: Date.now(), files, mode });
    await hooks.ledger.recordPaidUsage(paid, { totalTokens: 1_000, costCents: 0 });
    if (mode === "terminal") {
      throw new TakeoffError({ code: TakeoffErrorCode.AI_PROVIDER, message: "ARMY controlled terminal provider failure", retryable: false,
        jobId: job.id, level: "C" });
    }
    if (options.context.promptVersion === POSTE_EXCHANGE_PROMPT_VERSION) {
      const manifest = readPosteManifest(options.prompt);
      const spec = itemAnswers[job.id] ?? {};
      const responses = manifest.requested_posts.flatMap((post) => {
        const entry = { key: post.post_id, owned: manifest.page_scope.owned_pages };
        const answer = spec.items?.[post.label];
        if (answer === "omit") return [];
        if (answer?.uncertain) return [{ ...posteNotFound(entry), outcome: "uncertain", reason_code: answer.uncertain, reason_text: answer.text,
          observations: [{ page: answer.page, evidence: answer.text, method: answer.figure ? "symbol_count" : "annotation", confidence: 0.5,
            quantity: answer.figure?.quantity ?? null, unit: answer.figure?.unit ?? null, measurement_basis: null,
            counts_as: "distinct", basis_as_requested: false }] }];
        return [answer ? posteMeasured(entry, [{ page: answer.page, quantity: answer.quantity, unit: answer.unit }]) : posteNotFound(entry)];
      });
      const text = JSON.stringify({ schema_version: manifest.schema_version, prompt_version: manifest.prompt_version,
        chunk_id: manifest.chunk_id, responses, unreadable_pages: [], unlisted_findings: [], warnings: [] });
      // A truncated reading is no JSON: the local reader's parse refuses it, and the local provider names it as the job's
      // schema failure (src/lib/ai/chatgpt-takeoff.ts), definitive, as here.
      let data;
      try {
        data = options.schema.parse(JSON.parse(spec.truncate ? text.slice(0, Math.floor(text.length / 2)) : text));
      } catch {
        throw new TakeoffError({ code: TakeoffErrorCode.AI_SCHEMA, retryable: false, jobId: job.id,
          message: "ARMY controlled unreadable answer", details: { provider: "chatgpt" } });
      }
      return { data, tokenCount: 1_000, tokenUsage: { inputTokens: 900, reasoningTokens: 0, outputTokens: 100, totalTokens: 1_000 },
        costCents: 0, durationMs: Math.max(1, Date.now() - startedAt), model: options.context.model, promptVersion: options.context.promptVersion };
    }
    const plan = (current.preparation_snapshot?.preparation?.sources ?? []).find((source) => source.kind === "plan" && source.active);
    const data = options.schema.parse({
      // Pages local to the PDF the worker copied from the retained pages (1, 2): it gives them back as the plan's originals.
      items: planItems[job.id]
        ? planItems[job.id].map((item) => ({ ...item, confidence: 0.99, evidence: `${item.designation}, page ${item.source_page}` }))
        : [
          { designation: `ARMY ${plan?.document_name} réseau`, quantity: 4, unit: "m", source_page: 1, confidence: 0.99, evidence: "Ligne page 1" },
          ...((plan?.pages ?? []).length > 1
            ? [{ designation: `ARMY ${plan.document_name} vanne`, quantity: 2, unit: "u", source_page: 2, confidence: 0.99, evidence: "Vanne page 2" }] : []),
        ],
      warnings: [], tables: [],
      metadata: { level: "C", prompt_version: options.context.promptVersion, file_type: "pdf", schema_version: "v1" },
      confidence: 0.95,
    });
    return { data, tokenCount: 1_000, tokenUsage: { inputTokens: 900, reasoningTokens: 0, outputTokens: 100, totalTokens: 1_000 },
      costCents: 0, durationMs: Math.max(1, Date.now() - startedAt), model: options.context.model, promptVersion: options.context.promptVersion };
  };
  return { model: selection.model, reasoningEffort: null, selection, assertOwnerActive: async () => {}, call };
};

try {
  const pass = await runLocalTakeoffDispatcherPass({
    attempt: (jobId, trigger) => processTakeoffJobAttempt(jobId, { trigger, correlationId: randomUUID(),
      processLevelCFn: (id, options) => processLevelC(id, { ...options, resolveProvider }) }),
  });
  if (process.env.E2E_TAKEOFF_MAIL_COLLECTOR_ORIGIN) {
    const { data: notices, error } = await worker.from("takeoff_completion_notifications").select("id")
      .eq("project_id", projectId).eq("subject_kind", "request").eq("delivery_state", "pending");
    assert.equal(error, null);
    const { drainTakeoffCompletionEmails } = load("../../src/lib/takeoff/completion-email.ts");
    for (const notice of notices) await drainTakeoffCompletionEmails({ id: notice.id });
  }
  emit({ event: "result", pass, calls, maxInFlight });
} finally {
  runtime.unregister();
}
