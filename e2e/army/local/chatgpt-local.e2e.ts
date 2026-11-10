import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { afterAll, beforeAll, test } from "@e2e-dev/web";
import { expect } from "e2e";

import { apiRequest, createEstimateViaWizard, readEstimate, recordEvidence, restrictCriticalBrowser } from "../critical/fixtures";
import { hydratedUi, signIn, waitForHydration } from "../critical/hydration-support";
import { fillTakeoffPreparation, saveTakeoffPreparation } from "../critical/preparation-support";
import { createPlanSet, ownedTakeoffJobs, readPlanFiles, readPlanSets, uploadSamplePlan } from "../critical/plans-support";
import type { TakeoffJobDetailResponse } from "@/lib/takeoff/types";
import { TakeoffExchangeSchema } from "@/lib/takeoff/schemas";
import type { TakeoffPreparation } from "@/lib/takeoff/preparation";
import { buildTakeoffUploadPath, deriveDeterministicJobId, prepareTakeoffUploadSource } from "@/lib/takeoff/job-creation-input";
import { createLocalChatGptOwner, prepareChatGptServerWorkspace, warmChatGptServer } from "./chatgpt-server-support";
import { verifyV3TakeoffCreation } from "./engine-v3-takeoff-journey";
import { verifyPriceReuseArbitration } from "./engine-v3-price-reuse-support";
import { localTakeoffWorkerClient } from "../takeoff/fixtures";
import { LAB_DATASET_LAYOUT } from "@/lib/takeoff/lab/contracts";
import { querySql } from "./calculation-gate-support";
import { buildLabVectorPlanPdf, LAB_VECTOR_PLAN } from "./lab-vector-plan-fixture";
import { labSessionCookies, rawLabRequest } from "./takeoff-lab-support";

let localServer: ChildProcess;
let localOrigin: string;
const diagnostics: string[] = [];
let fixtureStore: string | undefined;
// Explicit opt-in for an owner-authorized live probe on the disposable backend.
// The private file contains only a short-lived access token, never refresh/ID tokens.
const liveProbePath = path.resolve(".private/chatgpt-local-live-probe.json");
let liveProbe: { accessToken: string; model: string; expiresAt: number; reasoningEffort?: string | null } | null = null;
let livePdfWitnessPassed = false;
const businessProbePath = path.resolve(".private/chatgpt-local-business-probe.json");
let transportLog: string;
let decisionsControl: string;
let fixtureEmail: string;
let labDatasetDir: string;
let labOutputDir: string;
const LAB_VECTOR_DOCUMENT = "fictif-plan-calques";
let serverWorkspace: Awaited<ReturnType<typeof prepareChatGptServerWorkspace>> | undefined;
/** The fixture also logs a client that left a proxied request; the server absorbs it and keeps serving (TI-667). */
const isAbsorbedClientAbort = (entry: Record<string, unknown>) => entry.provider === "process-diagnostic"
  && entry.kind === "uncaught" && entry.nodeCode === "ECONNRESET" && entry.messageKind === "aborted";
async function localClient() {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const login = await client.auth.signInWithPassword({ email: fixtureEmail, password: process.env.E2E_LOGIN_PASSWORD! });
  if (login.error) throw new Error("ChatGPT fixture login failed.");
  return { client, userId: login.data.user!.id };
}
async function setDecisionsControl(input: { hold?: boolean; timeoutWriting?: boolean }) {
  const temporary = `${decisionsControl}.tmp`;
  await writeFile(temporary, JSON.stringify({ hold: false, timeoutWriting: false, ...input }));
  await rename(temporary, decisionsControl);
}

beforeAll(async () => {
  // Use the campaign's disposable local backend, never ambient .env credentials.
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(backend.hostname)) throw new Error("Local backend required.");
  liveProbe = await readFile(liveProbePath, "utf8").then((text) => JSON.parse(text)).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw new Error("Invalid live probe configuration.");
  });
  if (liveProbe && (!liveProbe.accessToken || !liveProbe.model || liveProbe.expiresAt < Date.now() + 300_000)) {
    throw new Error("Live probe requires a selected model and a valid short-lived token.");
  }
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", resolve); });
  const address = reservation.address();
  if (!address || typeof address === "string") throw new Error("Port reservation failed.");
  const port = address.port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  localOrigin = `http://127.0.0.1:${port}`;
  fixtureEmail = (await createLocalChatGptOwner()).email;
  serverWorkspace = await prepareChatGptServerWorkspace();
  const artifacts = path.resolve(".e2e/army/critical/artifacts", serverWorkspace.id);
  transportLog = path.join(artifacts, "chatgpt-transport.jsonl");
  decisionsControl = path.join(artifacts, "decisions-control.json");
  await mkdir(path.dirname(transportLog), { recursive: true });
  await writeFile(transportLog, "");
  await setDecisionsControl({});
  // The takeoff lab of VEC01: a fictional dataset of one layered plan, and an empty output, under this run's artifacts.
  labDatasetDir = path.join(artifacts, "lab-dataset");
  labOutputDir = path.join(artifacts, "lab-output");
  const labPdf = path.join(labDatasetDir, LAB_DATASET_LAYOUT.raw(LAB_VECTOR_DOCUMENT));
  await mkdir(path.dirname(labPdf), { recursive: true });
  await mkdir(labOutputDir, { recursive: true, mode: 0o700 });
  const labBytes = await buildLabVectorPlanPdf();
  await writeFile(labPdf, labBytes);
  await writeFile(path.join(labDatasetDir, LAB_DATASET_LAYOUT.manifest), JSON.stringify({ schema_version: 1, documents: [{
    id: LAB_VECTOR_DOCUMENT, file_type: "pdf", raw_status: "binary", raw_path: LAB_DATASET_LAYOUT.raw(LAB_VECTOR_DOCUMENT), file_size: labBytes.length,
    sha256: createHash("sha256").update(labBytes).digest("hex"), pages: 1, kind: "plan", role: "truth",
  }] }));
  localServer = spawn(process.execPath, ["scripts/dev-chatgpt-local.mjs", "--port", String(port), "--webpack"], {
    cwd: process.cwd(), env: { ...process.env, CI: "", VERCEL: "", NODE_ENV: "development", E2E_ARMY_SERVER_MODE: "development", ...serverWorkspace.environment,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(path.resolve("e2e/army/local/chatgpt-provider-fixture.mjs")).href}`,
      ARMY_CHATGPT_TRANSPORT_LOG: transportLog, GEMINI_API_KEY: "army-disabled-provider-fixture", TAKEOFF_WORKER_SECRET: "army-worker-fixture",
      TAKEOFF_LAB_DATASET_DIR: labDatasetDir, TAKEOFF_LAB_OUTPUT_DIR: labOutputDir,
      ...(!liveProbe ? { MERGEONE_OPENAI_DECISIONS: "1", MERGEONE_TAKEOFF_DECISIONS: "1", OPENAI_DECISIONS_API_KEY: "army-decisions-fixture", ARMY_DECISIONS_CONTROL: decisionsControl } : {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [localServer.stdout, localServer.stderr]) stream?.on("data", (chunk) => {
    diagnostics.push(String(chunk).replace(/code=[^&\s]+/g, "code=[redacted]"));
    if (diagnostics.length > 100) diagnostics.shift();
  });
  await expect.poll(async () => {
    if (localServer.exitCode !== null) throw new Error("ChatGPT local server exited before readiness.");
    return fetch(`${localOrigin}/favicon.ico`).then((response) => response.ok).catch(() => false);
  }, { timeout: 90_000 }).toBe(true);
  await serverWorkspace.assertReady();
  await warmChatGptServer(localOrigin, fixtureEmail);
});

afterAll(async () => {
  if (localServer && localServer.exitCode === null) {
    localServer.kill("SIGTERM");
    await new Promise<void>((resolve) => localServer.once("exit", () => resolve()));
  }
  if (fixtureStore) await rm(fixtureStore, { force: true });
  if (localOrigin && transportLog) {
    // Keep only compilation/readiness and non-sensitive dashboard/login timings.
    const timings = diagnostics.join("").split("\n").filter(line =>
      /(?:Compiling|Ready in|Local Next process exited|restarting|Restarting|FATAL ERROR|heap limit|allocation failed|worker.*exited|SIGKILL|ENOMEM|out of memory|(?:GET|POST) \/(?:dashboard|login)(?:[/? ]))/.test(line))
      .map(line => line.replace(/(\/(?:dashboard|login)[^?\s]*)\?[^\s]*/g, "$1?[redacted]"));
    await mkdir(path.dirname(transportLog), { recursive: true });
    await writeFile(path.join(path.dirname(transportLog), `chatgpt-local-server-${new URL(localOrigin).port}.log`), timings.join("\n"));
  }
  await serverWorkspace?.cleanup();
});

// Regression: even if an old server key exists, no connection must never create
// a billable Gemini job or route drafting assistance to that API.
test("LOCAL01 no ChatGPT connection never launches or offers Gemini", {
  tags: ["critical", "local", "chatgpt", "premetre"], session: "army", timeout: 180_000,
}, async ({ app, screen, browser }) => {
  await signIn({ app, screen, browser }, localOrigin, fixtureEmail);
  const prefix = `ARMY-local-only-${Date.now()}`;
  const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
  const ui = hydratedUi({ app, screen, browser }, localOrigin);
  const estimate = await createEstimateViaWizard(ui, { projectName: prefix, title: "Sans forfait connecté" }, army);
  const planSet = await createPlanSet(ui, army, estimate, `${prefix} plans`);
  const file = await uploadSamplePlan(ui, army, planSet);
  const jobs = ownedTakeoffJobs(browser, estimate);
  await ui.app.open(`/dashboard/affaires/${estimate.projectId}?view=estimate`);
  await screen.getByRole("button", "Préparer le métré", { exact: true }).click();
  const dialog = await fillTakeoffPreparation({ ...ui, army }, { sources: [file.file_name], processing: { level: "B" } });
  await expect(browser.locator('select option[value="gemini"]')).toHaveCount(0);
  await dialog.getByText("Assistance au cadrage", { exact: true }).click();
  await dialog.getByRole("button", "Proposer un cadrage", { exact: true }).click();
  await expect(dialog.getByText(/Aucune assistance rédactionnelle n.est configurée/).first()).toBeVisible();
  await dialog.getByRole("button", "Confirmer et lancer le métré", { exact: true }).click();
  await expect(dialog.getByText(/Connectez votre forfait ChatGPT/).first()).toBeVisible();
  expect(await jobs.list()).toEqual([]);
  const forged = await browser.evaluate(async (versionId) => {
    const form = new FormData();
    form.set("file", new File(["designation;quantity;unit\nTube;12;m"], "fixture.csv", { type: "text/csv" }));
    form.set("estimate_version_id", versionId);
    form.set("level", "A");
    form.set("provider", "gemini");
    const response = await fetch("/api/takeoff/jobs", { method: "POST", body: form });
    return { status: response.status, body: await response.json() };
  }, estimate.versionId);
  expect(forged.status).toBe(422);
  expect(forged.body.error.code).toBe("AI_PROVIDER");
  expect(await jobs.list()).toEqual([]);
  const transport = (await readFile(transportLog, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  expect(transport.filter(entry => entry.provider === "forbidden")).toEqual([]);
  await recordEvidence(army, "local-only-no-provider", { estimate, geminiKeyFixturePresent: true,
    noGeminiOption: true, assistanceUnavailable: true, noJobsCreated: true, forgedProviderRejected: forged.status, forbiddenRequests: 0 });
});

test("LOCAL02 an old Gemini draft can be reselected and launched on ChatGPT", {
  tags: ["critical", "local", "chatgpt", "premetre"], session: "army", timeout: 240_000,
}, async ({ app, screen, browser }) => {
  if (!await preparePlanFixture()) throw new Error("LOCAL02 requires a separate temporary ChatGPT profile.");
  try {
    await signIn({ app, screen, browser }, localOrigin, fixtureEmail);
    const prefix = `ARMY-local-legacy-${Date.now()}`;
    const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
    const ui = hydratedUi({ app, screen, browser }, localOrigin);
    const estimate = await createEstimateViaWizard(ui, { projectName: prefix, title: "Ancienne préparation" }, army);
    const planSet = await createPlanSet(ui, army, estimate, `${prefix} plans`);
    const file = await uploadSamplePlan(ui, army, planSet);
    await ui.app.open(`/dashboard/affaires/${estimate.projectId}?view=estimate`);
    await screen.getByRole("button", "Préparer le métré", { exact: true }).click();
    await fillTakeoffPreparation({ ...ui, army }, { sources: [file.file_name], processing: { level: "B" } });
    await saveTakeoffPreparation({ ...ui, army });
    const { client } = await localClient();
    const row = await client.from("takeoff_preparations").select("draft,revision").eq("project_id", estimate.projectId).single();
    expect(row.error).toBeNull();
    const draft = row.data!.draft as { processing: { level: string; provider: string } };
    draft.processing.provider = "gemini";
    const { client: worker } = await localTakeoffWorkerClient(army, estimate.versionId, fixtureEmail);
    const update = await worker.from("takeoff_preparations").update({ draft, revision: row.data!.revision + 1 }).eq("project_id", estimate.projectId).select("project_id").single();
    expect(update.error).toBeNull();
    await browser.reload();
    await waitForHydration(browser);
    await screen.getByRole("button", "Préparer le métré", { exact: true }).click();
    const dialog = screen.getByRole("dialog", "Préparer le métré", { exact: true });
    await dialog.getByRole("button", /Vérifier et lancer$/).click();
    await dialog.getByText("Options avancées", { exact: true }).click();
    const picker = dialog.getByLabel("Fournisseur IA", { exact: true });
    await expect(picker).toHaveValue("gemini");
    await expect(dialog.getByText(/ancien fournisseur.*indisponible/i).first()).toBeVisible();
    await picker.selectOption({ value: "chatgpt" });
    await expect(picker).toHaveValue("chatgpt");
    await dialog.getByRole("button", "Confirmer et lancer le métré", { exact: true }).click();
    const jobs = ownedTakeoffJobs(browser, estimate);
    await expect.poll(async () => (await jobs.list()).length, { timeout: 45_000 }).toBe(1);
    const [job] = await jobs.list();
    const detail = () => apiRequest<{ data: TakeoffJobDetailResponse }>(browser, "GET", `/api/takeoff/jobs/${job.id}`);
    await expect.poll(async () => {
      const job = (await detail()).body.data.job;
      if (job.status === "failed") throw new Error(`Local plan-set fixture failed: ${job.error_code ?? "unknown"}`);
      return job.status;
    }, { timeout: 150_000 }).toBe("completed");
    const result = (await detail()).body.data;
    expect(result.result?.provider_meta).toMatchObject({ provider: "chatgpt" });
    const stored = await client.from("takeoff_jobs").select("execution_provider,preparation_snapshot").eq("id", job.id).single();
    expect(stored.error).toBeNull();
    expect(stored.data).toMatchObject({ execution_provider: "chatgpt_local", preparation_snapshot: { preparation: { processing: { level: "B", provider: "chatgpt" } } } });
    const snapshot = stored.data!.preparation_snapshot as unknown as { preparation_revision: number; preparation: { sources: Array<{ active: boolean; content_hash: string; document_id: string; revision: string; plan_set_id: string }> } };
    const activeSources = snapshot.preparation.sources.filter(source => source.active);
    expect(snapshot.preparation_revision).toBeGreaterThan(0);
    expect(activeSources).toHaveLength(1);
    expect(activeSources[0]).toMatchObject({ document_id: file.id, revision: "A", plan_set_id: planSet.id });
    expect(activeSources[0].content_hash).toMatch(/^[a-f0-9]{64}$/);
    const transport = (await readFile(transportLog, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
    expect(transport.filter(entry => entry.provider === "forbidden")).toEqual([]);
    await recordEvidence(army, "local-only-legacy-draft", { estimate, jobId: job.id, restoredLegacyChoice: true,
      chosenProvider: "chatgpt", resultProvider: result.result?.provider_meta, forbiddenRequests: 0,
      boundary: "Fictional plan and ChatGPT transport fixture on an owned local backend." });
  } finally {
    if (fixtureStore) await rm(fixtureStore, { force: true });
    fixtureStore = undefined;
  }
});

for (const [testId, failure] of [["LOCAL04", "disconnected"], ["LOCAL06", "expired"]] as const) test(`${testId} an unusable selected ChatGPT profile does not create a job`, {
  tags: ["critical", "local", "chatgpt", "premetre"], session: "army", timeout: 180_000,
}, async ({ app, screen, browser }) => {
  if (!await preparePlanFixture()) throw new Error("LOCAL04 requires a separate temporary ChatGPT profile.");
  try {
    const store = JSON.parse(await readFile(fixtureStore!, "utf8"));
    const selected = store.profiles.find((profile: { id: string }) => profile.id === store.selectedId);
    if (failure === "disconnected") delete selected.accessToken;
    else { selected.expiresAt = 0; delete selected.refreshToken; }
    await writeFile(fixtureStore!, JSON.stringify(store), { mode: 0o600 });
    await signIn({ app, screen, browser }, localOrigin, fixtureEmail);
    const prefix = `ARMY-local-disconnected-${Date.now()}`;
    const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
    const ui = hydratedUi({ app, screen, browser }, localOrigin);
    const estimate = await createEstimateViaWizard(ui, { projectName: prefix, title: "Compte déconnecté" }, army);
    const planSet = await createPlanSet(ui, army, estimate, `${prefix} plans`);
    const file = await uploadSamplePlan(ui, army, planSet);
    await ui.app.open(`/dashboard/affaires/${estimate.projectId}?view=estimate`);
    await screen.getByRole("button", "Préparer le métré", { exact: true }).click();
    const dialog = await fillTakeoffPreparation({ ...ui, army }, { sources: [file.file_name], processing: { level: "B" } });
    await dialog.getByText("Assistance au cadrage", { exact: true }).click();
    await dialog.getByRole("button", "Proposer un cadrage", { exact: true }).click();
    await expect(dialog.getByText(/Reconnectez.*ChatGPT/i).first()).toBeVisible();
    await dialog.getByRole("button", "Confirmer et lancer le métré", { exact: true }).click();
    await expect(dialog.getByText(/Reconnectez.*ChatGPT/i).first()).toBeVisible();
    expect(await ownedTakeoffJobs(browser, estimate).list()).toEqual([]);
    const transport = (await readFile(transportLog, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
    expect(transport.filter(entry => entry.provider === "forbidden")).toEqual([]);
    await recordEvidence(army, "local-disconnected-profile", { estimate, selectedModelRetained: true, failure,
      noJobCreated: true, forbiddenRequests: 0 });
  } finally {
    if (fixtureStore) await rm(fixtureStore, { force: true });
    fixtureStore = undefined;
  }
});

test("LOCAL03 historical Gemini jobs remain readable but cannot be restarted", {
  tags: ["critical", "local", "chatgpt", "premetre"], session: "army", timeout: 180_000,
}, async ({ app, screen, browser }) => {
  await signIn({ app, screen, browser }, localOrigin, fixtureEmail);
  const prefix = `ARMY-local-history-${Date.now()}`;
  const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
  const ui = hydratedUi({ app, screen, browser }, localOrigin);
  const estimate = await createEstimateViaWizard(ui, { projectName: prefix, title: "Historique fournisseur" }, army);
  const beforeEstimate = await readEstimate(browser, estimate.versionId);
  const { userId } = await localClient();
  const { client, tenantId } = await localTakeoffWorkerClient(army, estimate.versionId, fixtureEmail);
  const jobId = randomUUID();
  const job = await client.from("takeoff_jobs").insert({ id: jobId, tenant_id: tenantId, estimate_version_id: estimate.versionId,
    created_by: userId, level: "A", status: "failed", source_file_name: "historique.csv", source_file_type: "text/csv",
    source_file_size_bytes: 20, execution_provider: "gemini", processing_strategy: "batch", provider_batch_id: "batches/army-history",
    provider_batch_state: "running", provider_reconcile_due_at: "2020-01-01T00:00:00Z", error_code: "AI_TIMEOUT" }).select("id").single();
  expect(job.error).toBeNull();
  const read = async () => {
    const result = await client.from("takeoff_jobs").select("status,retry_count,provider_batch_id,provider_batch_state,provider_reconcile_due_at,error_code,dispatch_status")
      .eq("id", jobId).single();
    expect(result.error).toBeNull();
    return result.data;
  };
  const before = await read();
  const detail = await apiRequest<{ data: TakeoffJobDetailResponse }>(browser, "GET", `/api/takeoff/jobs/${jobId}`);
  expect(detail.status).toBe(200);
  expect(detail.body.data.job).toMatchObject({ id: jobId, can_resubmit: false, can_reconcile: false });
  for (const command of ["retry", "resubmit", "reconcile"]) {
    const response = await apiRequest<{ error: { code: string } }>(browser, "POST", `/api/takeoff/jobs/${jobId}/${command}`);
    expect([response.status, response.body.error.code]).toEqual([422, "AI_PROVIDER"]);
    expect(await read()).toEqual(before);
  }
  const internal = await fetch(`${localOrigin}/api/internal/takeoff/process-job`, { method: "POST",
    headers: { "content-type": "application/json", "x-takeoff-worker-secret": "army-worker-fixture" },
    body: JSON.stringify({ job_id: jobId, trigger: "reconcile" }) });
  expect(internal.status).toBe(422);
  expect(await read()).toEqual(before);
  const key = `legacy-${randomUUID()}`;
  const csv = "designation;quantity;unit\nTube;12;m";
  const file = new File([csv], "legacy.csv", { type: "text/csv" });
  const fingerprint = prepareTakeoffUploadSource({ file, content: Buffer.from(csv), estimateVersionId: estimate.versionId,
    level: "A", provider: "auto" }).payloadFingerprint;
  const replayId = deriveDeterministicJobId(tenantId, key);
  const replayPath = buildTakeoffUploadPath({ tenantId, jobId: replayId, payloadFingerprint: fingerprint,
    attemptId: randomUUID(), sourceFileName: file.name });
  const legacyReplay = await client.from("takeoff_jobs").insert({ id: replayId, tenant_id: tenantId, estimate_version_id: estimate.versionId,
    created_by: userId, level: "A", status: "pending", source_file_name: file.name, source_file_type: file.type,
    source_file_size_bytes: file.size, source_file_path: replayPath, execution_provider: "gemini" }).select("id").single();
  expect(legacyReplay.error).toBeNull();
  const replay = await browser.evaluate(async ({ versionId, keyValue, csvValue }) => {
    const form = new FormData();
    form.set("file", new File([csvValue], "legacy.csv", { type: "text/csv" }));
    form.set("estimate_version_id", versionId);
    form.set("level", "A");
    const response = await fetch("/api/takeoff/jobs", { method: "POST", headers: { "idempotency-key": keyValue }, body: form });
    return { status: response.status, body: await response.json() };
  }, { versionId: estimate.versionId, keyValue: key, csvValue: csv });
  expect([replay.status, replay.body.error.code]).toEqual([422, "AI_PROVIDER"]);
  if (!await preparePlanFixture()) throw new Error("The foreign-host test requires its own temporary profile.");
  try {
    const foreignKey = `foreign-${randomUUID()}`;
    const foreignId = deriveDeterministicJobId(tenantId, foreignKey);
    const foreignPath = buildTakeoffUploadPath({ tenantId, jobId: foreignId, payloadFingerprint: fingerprint,
      attemptId: randomUUID(), sourceFileName: file.name });
    const foreign = await client.from("takeoff_jobs").insert({ id: foreignId, tenant_id: tenantId, estimate_version_id: estimate.versionId,
      created_by: userId, level: "A", status: "pending", source_file_name: file.name, source_file_type: file.type,
      source_file_size_bytes: file.size, source_file_path: foreignPath, execution_provider: "chatgpt_local",
      execution_host_id: "urn:uuid:ffffffff-ffff-4fff-8fff-ffffffffffff", processing_strategy: "sync" }).select("id").single();
    expect(foreign.error).toBeNull();
    const foreignReplay = await browser.evaluate(async ({ versionId, keyValue, csvValue }) => {
      const form = new FormData();
      form.set("file", new File([csvValue], "legacy.csv", { type: "text/csv" }));
      form.set("estimate_version_id", versionId);
      form.set("level", "A");
      const response = await fetch("/api/takeoff/jobs", { method: "POST", headers: { "idempotency-key": keyValue }, body: form });
      return { status: response.status, body: await response.json() };
    }, { versionId: estimate.versionId, keyValue: foreignKey, csvValue: csv });
    expect([foreignReplay.status, foreignReplay.body.error.code]).toEqual([422, "AI_PROVIDER"]);
    const failedForeign = await client.from("takeoff_jobs").update({ status: "failed", error_code: "AI_TIMEOUT" }).eq("id", foreignId).select("status,dispatch_status,retry_count").single();
    expect(failedForeign.error).toBeNull();
    const refusedRetry = await apiRequest<{ error: { code: string } }>(browser, "POST", `/api/takeoff/jobs/${foreignId}/retry`);
    expect([refusedRetry.status, refusedRetry.body.error.code]).toEqual([422, "AI_PROVIDER"]);
    const afterForeign = await client.from("takeoff_jobs").select("status,dispatch_status,retry_count").eq("id", foreignId).single();
    expect(afterForeign.data).toEqual(failedForeign.data);
  } finally {
    if (fixtureStore) await rm(fixtureStore, { force: true });
    fixtureStore = undefined;
  }
  const finishedKey = `finished-${randomUUID()}`;
  const finishedId = deriveDeterministicJobId(tenantId, finishedKey);
  const finishedPath = buildTakeoffUploadPath({ tenantId, jobId: finishedId, payloadFingerprint: fingerprint,
    attemptId: randomUUID(), sourceFileName: file.name });
  const finished = await client.from("takeoff_jobs").insert({ id: finishedId, tenant_id: tenantId, estimate_version_id: estimate.versionId,
    created_by: userId, level: "A", status: "pending", source_file_name: file.name, source_file_type: file.type,
    source_file_size_bytes: file.size, source_file_path: finishedPath, execution_provider: "chatgpt_local",
    execution_host_id: "urn:uuid:ffffffff-ffff-4fff-8fff-ffffffffffff", processing_strategy: "sync" }).select("id").single();
  expect(finished.error).toBeNull();
  const markFinished = await client.from("takeoff_jobs").update({ status: "completed" }).eq("id", finishedId).select("status,dispatch_status").single();
  expect(markFinished.error).toBeNull();
  const finishedReplay = await browser.evaluate(async ({ versionId, keyValue, csvValue }) => {
    const form = new FormData();
    form.set("file", new File([csvValue], "legacy.csv", { type: "text/csv" }));
    form.set("estimate_version_id", versionId);
    form.set("level", "A");
    const response = await fetch("/api/takeoff/jobs", { method: "POST", headers: { "idempotency-key": keyValue }, body: form });
    return { status: response.status, body: await response.json() };
  }, { versionId: estimate.versionId, keyValue: finishedKey, csvValue: csv });
  expect(finishedReplay.status).toBe(201);
  expect(finishedReplay.body.data).toMatchObject({ id: finishedId, status: "completed" });
  expect(finishedReplay.body.data.dispatch).toBeUndefined();
  const afterFinished = await client.from("takeoff_jobs").select("status,dispatch_status").eq("id", finishedId).single();
  expect(afterFinished.data).toEqual(markFinished.data);
  const explicitKey = `explicit-${randomUUID()}`;
  const explicitId = deriveDeterministicJobId(tenantId, explicitKey);
  const explicitFingerprint = prepareTakeoffUploadSource({ file, content: Buffer.from(csv), estimateVersionId: estimate.versionId,
    level: "A", provider: "gemini" }).payloadFingerprint;
  const explicitPath = buildTakeoffUploadPath({ tenantId, jobId: explicitId, payloadFingerprint: explicitFingerprint,
    attemptId: randomUUID(), sourceFileName: file.name });
  const explicitJob = await client.from("takeoff_jobs").insert({ id: explicitId, tenant_id: tenantId, estimate_version_id: estimate.versionId,
    created_by: userId, level: "A", status: "completed", source_file_name: file.name, source_file_type: file.type,
    source_file_size_bytes: file.size, source_file_path: explicitPath, execution_provider: "gemini" }).select("id").single();
  expect(explicitJob.error).toBeNull();
  const explicitReplay = await browser.evaluate(async ({ versionId, keyValue, csvValue }) => {
    const form = new FormData();
    form.set("file", new File([csvValue], "legacy.csv", { type: "text/csv" }));
    form.set("estimate_version_id", versionId);
    form.set("level", "A");
    form.set("provider", "gemini");
    const response = await fetch("/api/takeoff/jobs", { method: "POST", headers: { "idempotency-key": keyValue }, body: form });
    return { status: response.status, body: await response.json() };
  }, { versionId: estimate.versionId, keyValue: explicitKey, csvValue: csv });
  expect(explicitReplay.status).toBe(201);
  expect(explicitReplay.body.data).toMatchObject({ id: explicitId, status: "completed" });
  expect(explicitReplay.body.data.dispatch).toBeUndefined();
  expect((await readEstimate(browser, estimate.versionId)).items).toEqual(beforeEstimate.items);
  const transport = (await readFile(transportLog, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  expect(transport.filter(entry => entry.provider === "forbidden")).toEqual([]);
  await recordEvidence(army, "local-historical-provider", { estimate, jobId, before, after: await read(),
    rejected: ["retry", "resubmit", "reconcile", "internal-worker", "legacy-upload-replay", "foreign-host-replay", "foreign-host-retry"],
    finishedReceiptReplay: true, finishedExplicitGeminiReplay: true, resultRemainsReadable: true, forbiddenRequests: 0 });
});

if (!existsSync(liveProbePath)) test("LOCAL05 a failed ChatGPT job can be resubmitted once concurrently", {
  tags: ["critical", "local", "chatgpt", "premetre"], session: "army", timeout: 240_000,
}, async ({ app, screen, browser }) => {
  if (!await preparePlanFixture()) throw new Error("LOCAL05 requires a separate temporary ChatGPT profile.");
  try {
    await signIn({ app, screen, browser }, localOrigin, fixtureEmail);
    const prefix = `ARMY-local-retry-${Date.now()}`;
    const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
    const ui = hydratedUi({ app, screen, browser }, localOrigin);
    const estimate = await createEstimateViaWizard(ui, { projectName: prefix, title: "Reprise ChatGPT locale" }, army);
    const before = await readEstimate(browser, estimate.versionId);
    const csv = path.resolve(`.e2e/army/critical/artifacts/${prefix}.csv`);
    await writeFile(csv, "designation;quantity;unit\nARMY copper pipe;12.5;m\n");
    await ui.app.open(`/dashboard/estimates/${estimate.versionId}/takeoff/new`);
    const source = screen.getByLabel("Fichier source", { exact: true });
    await expect(source).toBeEnabled();
    await source.setInputFiles(csv);
    await fillTakeoffPreparation({ ...ui, army }, { sources: [path.basename(csv)], objective: "extract_quantities", unit: "Unités des lignes sources",
      inclusions: "Toutes les lignes du fichier", levels: "Tous", zones: "Toutes", exclusions: "", processing: { level: "A" } }, browser.locator("form").last());
    await setDecisionsControl({ timeoutWriting: true });
    const [created] = await Promise.all([browser.waitForResponse("**/api/takeoff/jobs"),
      screen.getByRole("button", "Confirmer et lancer le métré", { exact: true }).tap()]);
    expect(created.status).toBe(201);
    const jobId = (await created.json<{ data: { id: string } }>()).data.id;
    const read = () => apiRequest<{ data: TakeoffJobDetailResponse }>(browser, "GET", `/api/takeoff/jobs/${jobId}`);
    await expect.poll(async () => (await read()).body.data.job.status, { timeout: 120_000 }).toBe("failed");
    const failed = (await read()).body.data;
    expect(failed.items.data).toEqual([]);
    expect(failed.job.completed_at).toBeTruthy();
    await expect.poll(() => Date.now() >= Date.parse(failed.job.completed_at!) + 5_000, { timeout: 20_000 }).toBe(true);
    await setDecisionsControl({});
    const attempts = await Promise.all([0, 1].map(() => apiRequest(browser, "POST", `/api/takeoff/jobs/${jobId}/resubmit`)));
    expect(attempts.map(attempt => attempt.status).sort()).toEqual([200, 409]);
    await expect.poll(async () => (await read()).body.data.job.status, { timeout: 120_000 }).toBe("completed");
    const completed = (await read()).body.data;
    expect(completed.job.retry_count).toBe(1);
    expect(completed.result?.provider_meta).toMatchObject({ provider: "chatgpt" });
    expect(completed.items.data).toEqual(expect.arrayContaining([expect.objectContaining({ designation: "ARMY copper pipe", quantity: 12.5, unit: "m" })]));
    expect((await readEstimate(browser, estimate.versionId)).items).toEqual(before.items);
    const transport = (await readFile(transportLog, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
    expect(transport.filter(entry => entry.provider === "forbidden")).toEqual([]);
    await recordEvidence(army, "local-concurrent-resubmit", { estimate, jobId, attemptStatuses: attempts.map(attempt => attempt.status),
      finalStatus: completed.job.status, retryCount: completed.job.retry_count, provider: "chatgpt", estimateUnchanged: true,
      boundary: "Simulated Responses timeout and success on an owned local backend; no paid API." });
  } finally {
    await setDecisionsControl({});
    if (fixtureStore) await rm(fixtureStore, { force: true });
    fixtureStore = undefined;
  }
});

// This test uses a fictional Decisions response on an owned backend. It never calls the paid API.
if (!existsSync(liveProbePath)) test("DEC01 Decisions classifications are visible for review without changing the preparation", {
  tags: ["critical", "local", "chatgpt", "premetre"], session: "army", timeout: 180_000,
}, async ({ app, screen, browser }) => {
  // Earlier LOCAL journeys also use Decisions; count only this scenario's calls.
  const transportBefore = (await readFile(transportLog, "utf8")).trim();
  const transportStart = transportBefore ? transportBefore.split("\n").length : 0;
  await signIn({ app, screen, browser }, localOrigin, fixtureEmail);
  const prefix = `ARMY-decisions-${Date.now()}`;
  const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
  const ui = hydratedUi({ app, screen, browser }, localOrigin);
  const estimate = await createEstimateViaWizard(ui, { projectName: prefix, title: "Préparation Decisions" }, army);
  const planSet = await createPlanSet(ui, army, estimate, `${prefix} plans`);
  const file = await uploadSamplePlan(ui, army, planSet);
  await ui.app.open(`/dashboard/affaires/${estimate.projectId}?view=estimate`);
  await screen.getByRole("button", "Préparer le métré", { exact: true }).click();
  const dialog = screen.getByRole("dialog", "Préparer le métré", { exact: true });
  await saveTakeoffPreparation({ ...ui, army });
  const { client } = await localClient();
  const read = async () => {
    const result = await client.from("takeoff_preparations").select("revision,draft,confirmed_snapshot").eq("project_id", estimate.projectId).single();
    expect(result.error).toBeNull();
    return result.data!;
  };
  const before = await read();
  await dialog.getByText("Assistance au cadrage", { exact: true }).click();
  await dialog.getByRole("button", "Proposer un cadrage", { exact: true }).click();
  await expect(dialog.getByText(/Decisions : Classement proposé à confirmer/)).toBeVisible();
  const classifications = dialog.getByRole("list", "Propositions de classement des pièces", { exact: true });
  await expect(classifications).toBeVisible();
  await expect(classifications.getByText(file.file_name, { exact: true })).toBeVisible();
  await expect(classifications.getByText("Plans · À confirmer", { exact: true })).toBeVisible();
  expect(await read()).toEqual(before);
  expect(before.confirmed_snapshot).toBeNull();
  const observed = (await readFile(transportLog, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  expect(observed.slice(transportStart).filter(entry => entry.provider === "decisions-fixture")).toHaveLength(1);
  expect(observed.filter(entry => entry.provider === "forbidden")).toEqual([]);
  // A provider timeout leaves the draft intact and gives the user a route to
  // adjust the account's effort; it does not change that setting implicitly.
  if (!await preparePlanFixture()) throw new Error("DEC01 requires its own temporary ChatGPT fixture.");
  try {
    await setDecisionsControl({ timeoutWriting: true });
    await dialog.getByRole("button", "Proposer un cadrage", { exact: true }).click();
    await expect(dialog.getByText(/L.assistance ChatGPT a dépassé son délai/)).toBeVisible();
    await expect(dialog.getByRole("link", "Ouvrir Mon profil", { exact: true })).toHaveAttribute("href", "/dashboard/profile");
    await expect(classifications.getByText("Plans · À confirmer", { exact: true })).toBeVisible();
    expect(await read()).toEqual(before);
    await setDecisionsControl({ hold: true });
    try {
      await dialog.getByRole("button", "Proposer un cadrage", { exact: true }).click();
      await expect.poll(async () => (await readFile(transportLog, "utf8")).trim().split("\n").slice(transportStart)
        .map(line => JSON.parse(line)).filter(entry => entry.provider === "decisions-fixture").length).toBe(3);
      const changed = await client.from("plan_files").update({ file_hash: "b".repeat(64) }).eq("id", file.id).select("id").single();
      expect(changed.error).toBeNull();
    } finally {
      await setDecisionsControl({});
    }
    await expect(dialog.getByText(/Les sources ou la préparation ont changé pendant l.assistance/)).toBeVisible();
    await expect(classifications).toHaveCount(0);
    await expect(dialog.getByRole("button", "Voir la prochaine étape proposée", { exact: true })).toHaveCount(0);
    await recordEvidence(army, "decisions-classification", { estimate, planSetId: planSet.id, file,
      displayed: "Plans · À confirmer", unchangedPreparation: true, timeoutRecoveryVisible: true, staleResultRemovedAfterSourceChange: true, externalApiCalled: false,
      screenshot: await app.screenshot("decisions-classification") });
  } finally {
    await setDecisionsControl({});
    if (fixtureStore) await rm(fixtureStore, { force: true });
    fixtureStore = undefined;
  }
});

// Fictional two-page sheet (facade, then plan) and fictional Decisions answers on an owned backend; never the paid API.
if (!existsSync(liveProbePath)) test("TRI01 Decisions page triage is accepted, corrected and kept after reload without a new call", {
  tags: ["critical", "local", "chatgpt", "premetre"], session: "army", timeout: 240_000,
}, async ({ app, screen, browser }) => {
  const readTransport = async () => (await readFile(transportLog, "utf8")).trim().split("\n").filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const transportStart = (await readTransport()).length;
  const triageCalls = async () => (await readTransport()).slice(transportStart).filter((entry) => entry.provider === "decisions-fixture");
  await signIn({ app, screen, browser }, localOrigin, fixtureEmail);
  const prefix = `ARMY-triage-${Date.now()}`;
  const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
  const ui = hydratedUi({ app, screen, browser }, localOrigin);
  const estimate = await createEstimateViaWizard(ui, { projectName: prefix, title: "Tri des pages" }, army);
  const planSet = await createPlanSet(ui, army, estimate, `${prefix} plans`);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const facade = pdf.addPage([842, 595]);
  facade.drawText("FACADE NORD - ELEVATION (fictive)", { x: 60, y: 540, size: 18, font });
  for (let index = 0; index < 4; index++) facade.drawRectangle({ x: 80 + index * 180, y: 120, width: 150, height: 300, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 3 });
  const plan = pdf.addPage([842, 595]);
  plan.drawText("PLAN PLOMBERIE R+1 Zone 1 (fictif)", { x: 60, y: 540, size: 18, font });
  plan.drawLine({ start: { x: 80, y: 300 }, end: { x: 760, y: 300 }, thickness: 4, color: rgb(0, 0, 0.8) });
  plan.drawLine({ start: { x: 400, y: 120 }, end: { x: 400, y: 480 }, thickness: 4, color: rgb(0.8, 0, 0) });
  const pdfPath = path.resolve(".e2e/army/critical/artifacts", `${prefix}-facade-et-plan.pdf`);
  await mkdir(path.dirname(pdfPath), { recursive: true });
  await writeFile(pdfPath, await pdf.save());
  const name = path.basename(pdfPath);
  await screen.getByRole("heading", planSet.name, { exact: true }).click();
  const [uploaded] = await Promise.all([
    browser.waitForResponse(`**/storage/v1/object/upload/sign/plan-files/${planSet.tenant_id}/${planSet.id}/**`),
    browser.locator("input[type='file'][accept*='pdf']").first().setInputFiles(pdfPath),
  ]);
  expect(uploaded.status).toBe(200);
  await expect(screen.getByRole("button", `Supprimer ${name}`, { exact: true })).toBeVisible();
  const [planFile] = await readPlanFiles(browser, planSet.id);
  await ui.app.open(`/dashboard/affaires/${estimate.projectId}?view=estimate`);
  await screen.getByRole("button", "Préparer le métré", { exact: true }).click();
  const dialog = await fillTakeoffPreparation({ ...ui, army }, { sources: [name], processing: { level: "C" } });
  await dialog.getByRole("button", /Mes documents$/).click();
  await saveTakeoffPreparation({ ...ui, army });
  const { client } = await localClient();
  const read = async () => {
    const result = await client.from("takeoff_preparations").select("revision,draft,confirmed_snapshot").eq("project_id", estimate.projectId).single();
    expect(result.error).toBeNull();
    const draft = result.data!.draft as TakeoffPreparation;
    return { row: result.data!, source: draft.sources.find((entry) => entry.document_id === planFile.id)! };
  };
  const triage = dialog.getByRole("region", "Tri des pages", { exact: true });
  const propose = triage.getByRole("button", "Proposer le tri des pages", { exact: true });
  await expect(propose).toBeEnabled();
  expect(await triageCalls()).toEqual([]);
  await propose.click();
  const table = triage.getByRole("table", `Tri proposé pour ${name}`, { exact: true });
  await expect(table.getByRole("row", /^Page 1\b.*Façade.*À écarter.*Proposée/)).toBeVisible();
  await expect(table.getByRole("row", /^Page 2\b.*Plan de réseau.*R\+1.*Z1.*À garder.*Proposée/)).toBeVisible();
  // One call per page, each with its rendered thumbnail; scope R+1 / Zone 1 adds the level and zone questions.
  expect((await triageCalls()).sort((left, right) => Number(left.page) - Number(right.page))).toEqual([
    { provider: "decisions-fixture", questions: 3, task: "page-triage", page: 1, images: 1 },
    { provider: "decisions-fixture", questions: 3, task: "page-triage", page: 2, images: 1 },
  ]);
  const proposed = await read();
  expect(proposed.source).toMatchObject({ active: true, pages: [], page_triage: { accepted: false, page_count: 2 } });
  expect(proposed.source.page_triage?.pages.map((page) => [page.page, page.type, page.level, page.zone, page.proposal, page.status]))
    .toEqual([[1, "facade", "R+1", "Z1", "exclude", "proposed"], [2, "reseau", "R+1", "Z1", "keep", "proposed"]]);
  expect(proposed.row.confirmed_snapshot).toBeNull();
  await triage.getByRole("button", `Accepter le tri de ${name}`, { exact: true }).click();
  await saveTakeoffPreparation({ ...ui, army });
  const accepted = await read();
  expect(accepted.source).toMatchObject({ active: true, pages: [2], confirmed: false, page_triage: { accepted: true } });
  expect(accepted.row.confirmed_snapshot).toBeNull();
  await triage.getByLabel(`Retenir la page 1 de ${name}`, { exact: true }).check();
  await saveTakeoffPreparation({ ...ui, army });
  const corrected = await read();
  expect(corrected.source.active).toBe(true);
  expect(["[]", "[1,2]"].includes(JSON.stringify(corrected.source.pages))).toBe(true);
  expect(corrected.source.page_triage?.pages.map((page) => page.status)).toEqual(["corrected", "proposed"]);
  const callsBeforeReload = (await triageCalls()).length;
  await browser.reload();
  await waitForHydration(browser);
  await screen.getByRole("button", "Préparer le métré", { exact: true }).click();
  const reopened = screen.getByRole("dialog", "Préparer le métré", { exact: true });
  await reopened.getByRole("button", /Mes documents$/).click();
  const reloadedTable = reopened.getByRole("region", "Tri des pages", { exact: true }).getByRole("table", `Tri proposé pour ${name}`, { exact: true });
  await expect(reloadedTable.getByRole("row", /^Page 1\b.*Corrigée/)).toBeVisible();
  await expect(reopened.getByLabel(`Retenir la page 1 de ${name}`, { exact: true })).toBeChecked();
  const reloaded = await read();
  expect(reloaded.source.pages).toEqual(corrected.source.pages);
  expect(reloaded.source.page_triage?.pages[0].status).toBe("corrected");
  expect((await triageCalls()).length).toBe(callsBeforeReload);
  expect((await readTransport()).filter((entry) => entry.provider === "forbidden")).toEqual([]);
  await reloadedTable.scrollIntoView();
  await recordEvidence(army, "page-triage", { estimate, planSetId: planSet.id, planFileId: planFile.id,
    proposed: proposed.source.page_triage, acceptedPages: accepted.source.pages, correctedPages: corrected.source.pages,
    decisionsCalls: callsBeforeReload, externalApiCalled: false, screenshot: await app.screenshot("page-triage") });
});

// TI-662 acceptance: the takeoff lab's vectors page on a fictional layered plan (lab-vector-plan-fixture.ts), its
// « classe de calque » task on the Decisions fixture (every group EU at 0.8), never the paid API.
if (!existsSync(liveProbePath)) test("VEC01 the lab's vectors page reads layers by keywords, classes the rest with Decisions and measures them", {
  tags: ["critical", "local", "chatgpt", "takeoff-lab"], session: "army", timeout: 240_000,
}, async ({ app, screen, browser }) => {
  const readTransport = async () => (await readFile(transportLog, "utf8")).trim().split("\n").filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const transportStart = (await readTransport()).length;
  const port = Number(new URL(localOrigin).port);
  const lab = "/dashboard/admin/takeoff/lab";
  const vectorsApi = `/api/admin/takeoff/lab/vectors/${LAB_VECTOR_DOCUMENT}?page=1`;
  const { cote, keyword, decisions } = LAB_VECTOR_PLAN;
  type Reading = { scale: { status: string; denominator: number | null; cotes: number; consistent_cotes: number }; detection: number;
    groups: Array<{ id: string; name: string; class: string | null; source: string | null; confidence: number | null; keyword: { class: string | null };
      length_m: number | null; segments: number; geometry: number[] }>;
    networks: Array<{ network: string; length_m: number | null }>; run: { id: string; answers: number; applied: number } | null };
  const byName = (reading: Reading) => Object.fromEntries(reading.groups.map((group) => [group.name, group]));
  // Compile the lab's vectors page and routes before the browser asserts on them, in one batch (as takeoff-lab.e2e.ts does).
  const admin = await labSessionCookies(fixtureEmail);
  const warm = await Promise.all([`${lab}/vectors`, `${lab}/verdicts`, "/api/admin/takeoff/lab", "/api/admin/takeoff/lab/runs", vectorsApi,
    `/api/admin/takeoff/lab/documents/${LAB_VECTOR_DOCUMENT}`]
    .map((pathname) => fetch(new URL(pathname, localOrigin), { headers: { cookie: admin.header }, redirect: "manual", signal: AbortSignal.timeout(120_000) })
      .then(async (response) => { await response.arrayBuffer(); return [pathname, response.status] as const; })));
  expect(warm.filter(([, status]) => status !== 200)).toEqual([]);

  await browser.setViewport({ width: 1440, height: 900 });
  await signIn({ app, screen, browser }, localOrigin, fixtureEmail);
  const prefix = `ARMY-lab-vectors-${Date.now()}`;
  const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };

  // Keywords alone: the cote verifies 1/50, FICTIF_EF is EF and measured, FICTIF_RESEAU_2 is left to Decisions.
  const keywordReading = await apiRequest<{ data: Reading }>(browser, "GET", vectorsApi);
  expect(keywordReading.status).toBe(200);
  expect(keywordReading.body.data.scale).toMatchObject({ status: "verified", denominator: LAB_VECTOR_PLAN.denominator, cotes: 1, consistent_cotes: 1 });
  const keywordGroups = byName(keywordReading.body.data);
  expect(Object.keys(keywordGroups).sort()).toEqual([cote.layer, keyword.layer, decisions.layer].sort());
  expect(keywordGroups[keyword.layer]).toMatchObject({ class: "EF", source: "keyword", keyword: { class: "EF" }, length_m: 5, segments: 1 });
  expect(keywordGroups[cote.layer]).toMatchObject({ class: "cotation", source: "keyword" });
  expect(keywordGroups[decisions.layer]).toMatchObject({ class: null, source: null, keyword: { class: null }, length_m: 3, segments: 1 });
  expect(keywordGroups[decisions.layer].geometry).toHaveLength(4);
  expect(keywordReading.body.data.networks.map((entry) => [entry.network, entry.length_m])).toEqual([["EF", 5]]);
  expect(keywordReading.body.data.run).toBeNull();

  await app.open(`${localOrigin}${lab}/vectors`);
  await waitForHydration(browser);
  await expect(screen.getByRole("link", "Vecteurs", { exact: true })).toHaveAttribute("aria-current", "page");
  await screen.getByLabel("Document", { exact: true }).selectOption({ value: LAB_VECTOR_DOCUMENT });
  const rows = screen.getByRole("list", "Groupes de tracés", { exact: true }).getByRole("listitem");
  const row = (layer: string) => rows.filter({ hasText: layer });
  const shown = screen.getByText(/éléments affichés$/);
  const lengths = screen.getByRole("list", "Longueurs mesurées", { exact: true });
  const drawn = browser.locator("svg[aria-label='Groupes de tracés affichés'] path");
  await expect(screen.getByText("Échelle 1/50 vérifiée par une cote", { exact: true })).toBeVisible();
  await expect(screen.getByText("Détection 78 %", { exact: true })).toBeVisible();
  await expect(rows).toHaveCount(3);
  await expect(row(keyword.layer)).toContainText("EF · mots-clés");
  await expect(row(cote.layer)).toContainText("cotation · mots-clés");
  await expect(row(decisions.layer)).toContainText("à revoir");
  await expect(lengths.getByRole("listitem")).toHaveCount(1);
  await expect(lengths).toContainText("EF 5,00 m");
  await expect(shown).toHaveText("3 / 3 éléments affichés");
  await expect(drawn).toHaveCount(3);
  await expect.poll(() => browser.evaluate(() => [document.scrollingElement!.scrollHeight, window.innerHeight])
    .then(([scrollHeight, innerHeight]) => scrollHeight <= innerHeight)).toBe(true);

  // « Classer avec Decisions »: one batch call for the one group the keywords leave, its images drawn by the server.
  const launch = screen.getByRole("button", "Classer avec Decisions", { exact: true });
  await expect(launch).toBeEnabled();
  const [launched] = await Promise.all([browser.waitForResponse("**/api/admin/takeoff/lab/runs", { timeout: 120_000 }), launch.click()]);
  expect(launched.status).toBe(201);
  await expect(row(decisions.layer)).toContainText(/EU\s80\s%\s·\sDecisions/);
  await expect(row(keyword.layer)).toContainText("EF · mots-clés");
  await expect(lengths.getByRole("listitem")).toHaveCount(2);
  await expect(lengths).toContainText("EF 5,00 m");
  await expect(lengths).toContainText("EU 3,00 m");
  await expect(screen.getByText("Détection 100 %", { exact: true })).toBeVisible();
  const panel = screen.getByRole("region", "Classement Decisions", { exact: true });
  await expect(panel).toContainText("Terminé");
  const bars = panel.getByRole("list", `Probabilités · ${decisions.layer}`, { exact: true });
  await expect(bars.getByRole("listitem").first()).toContainText(/EU.*80\s%/);
  const sent = (await readTransport()).slice(transportStart);
  expect(sent.filter((entry) => entry.provider === "decisions-fixture")).toEqual([
    { provider: "decisions-fixture", questions: 1, task: "vector-groups", images: 2 },
  ]);
  expect((await readTransport()).filter((entry) => entry.provider === "forbidden")).toEqual([]);

  // The stored run: one Decisions configuration, its usage the call's, one question element for the group asked.
  const runFiles = (await readdir(path.join(labOutputDir, "runs"))).filter((name) => name.endsWith(".json"));
  expect(runFiles).toHaveLength(1);
  const run = JSON.parse(await readFile(path.join(labOutputDir, "runs", runFiles[0]), "utf8"));
  const reseau = keywordGroups[decisions.layer];
  expect(run).toMatchObject({ status: "complete", stop: null, crop: null, task: { id: "classe-de-calque", kind: "choice" },
    document: { id: LAB_VECTOR_DOCUMENT, source: "dataset", pages: 1 }, prompt: { base: "takeoff-vector-groups-v1" } });
  expect(run.prompt.version).toMatch(/^takeoff-vector-groups-v1\+[0-9a-f]{64}$/);
  expect(run.configs).toHaveLength(1);
  expect(run.configs[0]).toMatchObject({ provider: "decisions", model: "gpt-6-luna", status: "ok", usage: { total: 1 } });
  expect(run.configs[0].elements.map((element: { kind: string; key: string; label: string; detail: string; json: { answer: unknown } }) =>
    [element.kind, element.key, element.label, element.detail, element.json.answer])).toEqual([
    ["question", reseau.id, decisions.layer, "EU", { class: "EU", confidence: 0.8, status: "answered", via: "batch" }],
  ]);
  expect(JSON.parse(run.configs[0].raw).results).toHaveLength(1);
  const applied = await apiRequest<{ data: Reading }>(browser, "GET", `${vectorsApi}&run=${run.id}`);
  expect(applied.status).toBe(200);
  expect(byName(applied.body.data)[decisions.layer]).toMatchObject({ class: "EU", source: "decisions", confidence: 0.8, keyword: { class: null } });
  expect(applied.body.data.networks.map((entry) => [entry.network, entry.length_m])).toEqual([["EF", 5], ["EU", 3]]);
  expect(applied.body.data.run).toMatchObject({ id: run.id, answers: 1, applied: 1 });

  // Alt-click on a layer's box shows that layer alone.
  await screen.getByRole("checkbox", `Afficher ${keyword.layer}`, { exact: true }).click({ modifiers: ["Alt"] });
  await expect(shown).toHaveText("1 / 3 éléments affichés");
  await expect(drawn).toHaveCount(1);
  await expect(screen.getByRole("checkbox", `Afficher ${decisions.layer}`, { exact: true })).not.toBeChecked();
  await screen.getByRole("button", "Tout afficher", { exact: true }).click();
  await expect(shown).toHaveText("3 / 3 éléments affichés");
  await expect(screen.getByRole("status", "Chargement du plan")).toBeHidden();
  const screenshot1440 = await app.screenshot("lab-vectors-1440");
  await browser.setViewport({ width: 1920, height: 1080 });
  await expect.poll(() => browser.evaluate(() => [document.scrollingElement!.scrollHeight, window.innerHeight])
    .then(([scrollHeight, innerHeight]) => scrollHeight <= innerHeight)).toBe(true);
  await expect(screen.getByRole("status", "Chargement du plan")).toBeHidden();
  const screenshot1920 = await app.screenshot("lab-vectors-1920");

  // The run's element is judged like any lab answer.
  await screen.getByRole("link", "Verdicts", { exact: true }).click();
  await expect(browser).toHaveURL(/\/dashboard\/admin\/takeoff\/lab\/verdicts$/);
  await screen.getByLabel("Campagne", { exact: true }).selectOption({ value: run.campaign });
  await expect(screen.getByLabel("Tâche", { exact: true })).toContainText("Classe de calque (groupes de tracés)");
  await expect(screen.getByRole("article", "Élément à juger")).toContainText(decisions.layer);

  // The vectors page and its API refuse another host than 127.0.0.1, a non-admin member and an anonymous request.
  const otherHost = await rawLabRequest(port, { method: "GET", path: vectorsApi, host: `localhost:${port}`, cookie: admin.header });
  expect([otherHost.status, JSON.parse(otherHost.body).error?.code]).toEqual([403, "TAKEOFF_LAB_LOCAL_ONLY"]);
  const otherHostPage = await rawLabRequest(port, { method: "GET", path: `${lab}/vectors`, host: `localhost:${port}`, cookie: admin.header });
  expect(otherHostPage.body).toContain("Labo métré indisponible");
  expect(otherHostPage.body).not.toContain("Classer avec Decisions");
  const member = await createLocalChatGptOwner();
  await querySql(`update public.tenant_memberships set role='engineer' where user_id='${member.userId}';`);
  const engineer = await labSessionCookies(member.email);
  const memberApi = await rawLabRequest(port, { method: "GET", path: vectorsApi, host: `127.0.0.1:${port}`, cookie: engineer.header });
  expect([memberApi.status, JSON.parse(memberApi.body).error?.code]).toEqual([403, "TAKEOFF_LAB_ADMIN_ONLY"]);
  const memberPage = await rawLabRequest(port, { method: "GET", path: `${lab}/vectors`, host: `127.0.0.1:${port}`, cookie: engineer.header });
  expect(memberPage.body).toContain("réservé aux administrateurs");
  expect(memberPage.body).not.toContain("Classer avec Decisions");
  const anonymous = await rawLabRequest(port, { method: "GET", path: vectorsApi, host: `127.0.0.1:${port}` });
  expect(anonymous.status).toBe(403);
  expect((await readdir(path.join(labOutputDir, "runs"))).filter((name) => name.endsWith(".json"))).toHaveLength(1);

  // An essai answered after the document changed stays with its own page: the new selection is never read with it.
  const otherDocument = "fixture-army-chatgpt-plan";
  await app.open(`${localOrigin}${lab}/vectors`);
  await waitForHydration(browser);
  await screen.getByLabel("Document", { exact: true }).selectOption({ value: LAB_VECTOR_DOCUMENT });
  await expect(rows).toHaveCount(3);
  const heldStart = (await readTransport()).length;
  await setDecisionsControl({ hold: true });
  let relaunched: Awaited<ReturnType<typeof browser.waitForResponse>>;
  try {
    const answered = browser.waitForResponse("**/api/admin/takeoff/lab/runs", { timeout: 120_000 });
    await launch.click();
    await expect.poll(async () => (await readTransport()).slice(heldStart).filter((entry) => entry.provider === "decisions-fixture").length).toBe(1);
    await screen.getByLabel("Document", { exact: true }).selectOption({ value: otherDocument });
    await setDecisionsControl({});
    relaunched = await answered;
  } finally {
    await setDecisionsControl({});
  }
  expect(relaunched.status).toBe(201);
  const staleRunId = ((await relaunched.json()) as { data: { id: string } }).data.id;
  await expect(screen.getByText(/Ce classement porte sur une autre sélection/)).toBeVisible();
  await expect(screen.getByLabel("Document", { exact: true })).toHaveValue(otherDocument);
  await expect(panel).toContainText("« Classer avec Decisions » demande une classe");
  await expect(screen.getByText("Cet essai porte sur une autre page ou un autre document.", { exact: true })).toHaveCount(0);
  const staleRun = JSON.parse(await readFile(path.join(labOutputDir, "runs", `lab-${staleRunId}.json`), "utf8"));
  expect(staleRun).toMatchObject({ status: "complete", document: { id: LAB_VECTOR_DOCUMENT }, configs: [{ status: "ok" }] });
  expect((await readdir(path.join(labOutputDir, "runs"))).filter((name) => name.endsWith(".json"))).toHaveLength(2);
  await recordEvidence(army, "lab-vectors-classification", { document: LAB_VECTOR_DOCUMENT, runId: run.id, promptVersion: run.prompt.version,
    keywordReading: { scale: keywordReading.body.data.scale, networks: keywordReading.body.data.networks },
    classified: { group: reseau.id, class: "EU", confidence: 0.8, networks: applied.body.data.networks },
    decisionsCalls: sent.filter((entry) => entry.provider === "decisions-fixture"), externalApiCalled: false,
    refusals: { otherHost: otherHost.status, member: memberApi.status, anonymous: anonymous.status },
    staleRun: { id: staleRunId, document: staleRun.document.id, shownOn: otherDocument, appliedToNewSelection: false },
    screenshots: { screenshot1440, screenshot1920 } });
});

test("ChatGPT local: profile starts PKCE authorization and recovers from declined consent", {
  tags: ["critical", "local", "chatgpt"], session: "army", timeout: 180_000,
}, async ({ app, screen, browser }) => {
  let authorization: { host: string; clientId: string | null; challengeMethod: string | null; planScope: boolean } | null = null;
  await browser.route("https://auth.openai.com/**", async (route) => {
    // This is an injected consent refusal, not evidence of live ChatGPT sign-in.
    const url = new URL(route.request.url);
    authorization = { host: url.hostname, clientId: url.searchParams.get("client_id"),
      challengeMethod: url.searchParams.get("code_challenge_method"), planScope: (url.searchParams.get("scope") ?? "").includes("chatgpt.tokens.use.direct") };
    const callback = new URL(url.searchParams.get("redirect_uri")!);
    callback.search = new URLSearchParams({ error: "access_denied", state: url.searchParams.get("state")! }).toString();
    await route.fulfill({ status: 302, headers: { location: callback.toString() }, body: "" });
  });
  await signIn({ app, screen, browser }, localOrigin, fixtureEmail);
  await app.open(`${localOrigin}/dashboard/profile`);
  await waitForHydration(browser);
  await expect(screen.getByRole("heading", "Mon forfait ChatGPT", { exact: true })).toBeVisible();
  await screen.getByRole("button", "Continue with ChatGPT", { exact: true }).tap();
  await expect(screen.getByText("Vous avez annulé la connexion ChatGPT. Vous pouvez la relancer.", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Continue with ChatGPT", { exact: true })).toBeEnabled();
  expect(authorization).toEqual({ host: "auth.openai.com", clientId: "dynamic_agent_client", challengeMethod: "S256", planScope: true });
  expect(diagnostics.some((entry) => /GET \/auth\/chatgpt\/callback.*state=/.test(entry))).toBe(false);
  const prefix = `ARMY-chatgpt-${Date.now()}`;
  await recordEvidence({ runPrefix: prefix, projectName: prefix, ownedEstimates: [] }, "chatgpt-local", {
    outcome: "local OAuth start and injected consent refusal", liveChatGptSignIn: false, inference: false,
    authorization, callbackContainsSecretsInLog: diagnostics.some((entry) => /GET \/auth\/chatgpt\/callback.*state=/.test(entry)),
  });
});

async function preparePlanFixture(unsetPreferences = false) {
  if (fixtureStore) return false;
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (backend.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST) throw new Error("Owned local backend required.");
  const client = createClient(backend.origin, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const login = await client.auth.signInWithPassword({ email: fixtureEmail, password: process.env.E2E_LOGIN_PASSWORD! });
  expect(login.error).toBeNull();
  const userId = login.data.user!.id;
  const membership = await client.from("tenant_memberships").select("tenant_id, tenants!inner(is_active)").eq("user_id", userId)
    .eq("tenants.is_active", true).order("is_default", { ascending: false }).order("created_at").limit(1).single();
  expect(membership.error).toBeNull();
  const tenantId = membership.data!.tenant_id;
  const key = createHash("sha256").update(JSON.stringify([userId, tenantId])).digest("hex");
  const directory = path.resolve(".private/chatgpt-local");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${key}.json`);
  const id = randomUUID();
  const model = unsetPreferences ? null : liveProbe?.model ?? "army-plan-model";
  await writeFile(file, JSON.stringify({ selectedId: id, profiles: [{ id, clientId: "army-fixture", issuer: "https://auth.openai.com",
    subject: "army-fixture", email: "fixture@example.test", model,
    reasoningEffort: unsetPreferences ? null : liveProbe?.reasoningEffort ?? null, accessToken: liveProbe?.accessToken ?? "army-chatgpt-fixture",
    expiresAt: liveProbe?.expiresAt ?? Date.now() + 3_600_000, scopes: ["chatgpt.tokens.use.direct"] }] }), { mode: 0o600, flag: "wx" });
  fixtureStore = file;
  return true;
}

test("ChatGPT local: uploaded takeoff uses the creator plan and persists quantities", {
  tags: ["critical", "local", "chatgpt"], session: "army", timeout: 180_000,
}, async ({ app, screen, browser }) => {
  await preparePlanFixture();
  const transportBefore = (await readFile(transportLog, "utf8")).trim();
  const transportStart = transportBefore ? transportBefore.split("\n").length : 0;
  const model = liveProbe?.model ?? "army-plan-model";
  await signIn({ app, screen, browser }, localOrigin, fixtureEmail);
  const prefix = `ARMY-chatgpt-${Date.now()}`;
  const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
  const ui = hydratedUi({ app, screen, browser }, localOrigin);
  const ids = await createEstimateViaWizard(ui, { projectName: prefix, title: "Métré forfait local" }, army);
  expect((await readEstimate(browser, ids.versionId)).version.calc_engine_version).toBe(2);
  const csv = path.resolve(`.e2e/army/critical/artifacts/${prefix}.csv`);
  await writeFile(csv, "designation;quantity;unit\nARMY copper pipe;12.5;m\n");
  await ui.app.open(`/dashboard/estimates/${ids.versionId}/takeoff/new`);
  // The file input stays disabled until the form hydrates; a file set earlier is lost.
  const source = screen.getByLabel("Fichier source", { exact: true });
  await expect(source).toBeEnabled();
  await source.setInputFiles(csv);
  await expect(screen.getByText(path.basename(csv), { exact: true })).toBeVisible();
  await fillTakeoffPreparation({ ...ui, army }, { sources: [path.basename(csv)], objective: "extract_quantities", unit: "Unités des lignes sources",
    inclusions: "Toutes les lignes du fichier", levels: "Tous", zones: "Toutes", exclusions: "", processing: { level: "A" } }, browser.locator("form").last());
  await expect(screen.getByRole("button", "Confirmer et lancer le métré", { exact: true })).toBeEnabled();
  const [created] = await Promise.all([browser.waitForResponse("**/api/takeoff/jobs"),
    screen.getByRole("button", "Confirmer et lancer le métré", { exact: true }).tap()]);
  expect(created.status).toBe(201);
  const body = await created.json<{ data: { id: string } }>();
  const jobId = body.data.id;
  const read = () => apiRequest<{ ok: boolean; data: TakeoffJobDetailResponse }>(browser, "GET", `/api/takeoff/jobs/${jobId}`);
  await expect.poll(async () => (await read()).body.data.job.status, { timeout: 120_000 }).toBe("completed");
  const detail = (await read()).body.data;
  expect(detail.job).toMatchObject({ model, metrics: { cost_cents: 0 }, processing_strategy: "sync" });
  expect(detail.result?.provider_meta).toMatchObject({ provider: "chatgpt", model });
  expect(detail.items.data).toEqual(expect.arrayContaining([expect.objectContaining({ designation: "ARMY copper pipe", quantity: 12.5, unit: "m" })]));
  expect(detail.job.metrics.token_count).toBeGreaterThan(0);
  const transport = (await readFile(transportLog, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  expect(transport.filter(entry => entry.provider === "forbidden")).toEqual([]);
  expect(transport.slice(transportStart).filter(entry => !isAbsorbedClientAbort(entry))).toEqual([
    { provider: liveProbe ? "chatgpt-live" : "chatgpt-fixture", model, sourceMatched: true,
      ...(liveProbe ? { reasoningEffort: liveProbe.reasoningEffort ?? null } : {}) },
  ]);
  await recordEvidence(army, "chatgpt-takeoff", { ids, jobId, provider: "chatgpt", model: detail.job.model,
    quantity: 12.5, tokenCount: detail.job.metrics.token_count, livePlanInference: Boolean(liveProbe),
    transport: liveProbe ? "Live OpenAI Responses using authorized short-lived plan token; Gemini and Edge dispatch forbidden."
      : "Explicit fixture; real UI, Storage, worker, schema and persistence." });
});


test("ChatGPT local: PDF plan uses the chosen subscription provider and persists measured quantities", {
  tags: ["critical", "local", "chatgpt"], session: "army", timeout: 240_000,
}, async ({ app, screen, browser }) => {
  const newProfileWithoutPreferences = await preparePlanFixture(Boolean(liveProbe));
  const transportBefore = (await readFile(transportLog, "utf8")).trim();
  const transportStart = transportBefore ? transportBefore.split("\n").length : 0;
  await signIn({ app, screen, browser }, localOrigin, fixtureEmail);
  const prefix = `ARMY-chatgpt-pdf-${Date.now()}`;
  const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
  const ui = hydratedUi({ app, screen, browser }, localOrigin);
  if (liveProbe) {
    expect(liveProbe.model).toBe("gpt-6.1-terra");
    expect(liveProbe.reasoningEffort).toBe("medium");
    await ui.app.open("/dashboard/profile");
    await expect(screen.getByRole("combobox", "Modèle ChatGPT", { exact: true })).toHaveValue("gpt-6.1-terra");
    const effort = screen.getByRole("combobox", "Effort de raisonnement", { exact: true });
    await expect(effort).toHaveValue(newProfileWithoutPreferences ? "auto" : "medium");
    await effort.selectOption({ value: "medium" });
    await expect(screen.getByText("Préférences ChatGPT enregistrées.", { exact: true })).toBeVisible();
    await expect(effort).toBeEnabled();
    await ui.app.open("/dashboard/profile");
    await expect(screen.getByRole("combobox", "Modèle ChatGPT", { exact: true })).toHaveValue("gpt-6.1-terra");
    await expect(screen.getByRole("combobox", "Effort de raisonnement", { exact: true })).toHaveValue("medium");
    const stored = JSON.parse(await readFile(fixtureStore!, "utf8"));
    const selected = stored.profiles.find((profile: { id: string }) => profile.id === stored.selectedId);
    expect(selected).toMatchObject({ model: "gpt-6.1-terra", reasoningEffort: "medium" });
    const screenshot = await app.screenshot("chatgpt-profile-terra-medium");
    await recordEvidence(army, "chatgpt-profile-preferences", { defaultModel: "gpt-6.1-terra", newProfileWithoutPreferences,
      initialEffort: newProfileWithoutPreferences ? null : "medium",
      persisted: { model: selected.model, reasoningEffort: selected.reasoningEffort }, reopenedUiMatches: true, screenshot });
  }
  const ids = await createEstimateViaWizard(ui, { projectName: prefix, title: "Métré PDF forfait local" }, army);
  const file = path.resolve("e2e/fixtures/takeoff/army-chatgpt-plan.pdf");
  const truth = JSON.parse(await readFile(path.resolve("e2e/fixtures/takeoff/army-chatgpt-plan.expected.json"), "utf8"));
  expect(createHash("sha256").update(await readFile(file)).digest("hex")).toBe(truth.sha256);
  await ui.app.open(`/dashboard/estimates/${ids.versionId}/takeoff/new`);
  const source = screen.getByLabel("Fichier source", { exact: true });
  await expect(source).toBeEnabled();
  await source.setInputFiles(file);
  await expect(screen.getByText(path.basename(file), { exact: true })).toBeVisible();
  await fillTakeoffPreparation({ ...ui, army }, { sources: [path.basename(file)], objective: "extract_quantities", unit: "Unités des lignes sources",
    inclusions: "Toutes les quantités documentées", levels: "Tous", zones: "Toutes", exclusions: "", processing: { level: "C" } }, browser.locator("form").last());
  const picker = screen.getByLabel("Fournisseur IA", { exact: true });
  await expect(picker).toBeVisible();
  await expect(browser.locator('select option[value="gemini"]')).toHaveCount(0);
  await picker.selectOption({ value: "chatgpt" });
  await expect(picker).toHaveValue("chatgpt");
  const [created] = await Promise.all([browser.waitForResponse("**/api/takeoff/jobs"),
    screen.getByRole("button", "Confirmer et lancer le métré", { exact: true }).tap()]);
  const responseBody = await created.json<{ data: { id: string } }>();
  expect({ status: created.status, body: responseBody }).toMatchObject({ status: 201 });
  const jobId = responseBody.data.id;
  const read = () => apiRequest<{ ok: boolean; data: TakeoffJobDetailResponse }>(browser, "GET", `/api/takeoff/jobs/${jobId}`);
  await expect.poll(async () => (await read()).body.data.job.status, { timeout: 180_000 }).toBe("completed");
  const detail = (await read()).body.data;
  expect(detail.job).toMatchObject({ level: "C", model: liveProbe?.model ?? "army-plan-model", processing_strategy: "sync", metrics: { cost_cents: 0 } });
  expect(detail.result?.provider_meta).toMatchObject({ provider: "chatgpt" });
  const sum = (pattern: RegExp) => detail.items.data.filter(item => pattern.test(item.designation)).reduce((total, item) => total + item.quantity, 0);
  expect(sum(/cuivre/i)).toBe(12.5);
  expect(sum(/vanne/i)).toBe(4);
  for (const expected of truth.expected) {
    const matching = detail.items.data.filter(item => item.designation.toLowerCase().includes(expected.designationContains));
    expect(matching.length).toBeGreaterThan(0);
    for (const item of matching) expect(item.unit).toBe(expected.unit);
  }
  expect(detail.items.data.every(item => item.source_page === 1)).toBe(true);
  expect(detail.job.metrics.token_count).toBeGreaterThan(0);
  const transport = (await readFile(transportLog, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  expect(transport.filter(entry => entry.provider === "forbidden")).toEqual([]);
  expect(transport.slice(transportStart).filter(entry => entry.inputKind === "pdf")).toEqual([
    { provider: liveProbe ? "chatgpt-live" : "chatgpt-fixture", model: detail.job.model, sourceMatched: true, inputKind: "pdf",
      ...(liveProbe ? { reasoningEffort: liveProbe.reasoningEffort ?? null } : {}) },
  ]);
  await recordEvidence(army, "chatgpt-pdf-takeoff", { ids, jobId, provider: "chatgpt", model: detail.job.model,
    expected: truth.expected, actual: detail.items.data.map(item => ({ designation: item.designation, quantity: item.quantity, unit: item.unit, sourcePage: item.source_page })),
    tokenCount: detail.job.metrics.token_count, livePlanInference: Boolean(liveProbe), geminiRequests: 0, inputKind: "pdf",
    ...(liveProbe ? { reasoningEffort: liveProbe.reasoningEffort ?? null } : {}) });
  livePdfWitnessPassed = Boolean(liveProbe);
});

// Private business sources never enter the repository or ordinary CI selection.
// The independent expected count is read only by assertions, never sent as prompt context.
if (existsSync(businessProbePath)) test("ChatGPT local: private business PDF respects the independently frozen counting scope", {
  tags: ["critical", "local", "chatgpt", "live-business"], session: "army", timeout: 300_000,
}, async ({ app, screen, browser }) => {
  const selectedProbe = liveProbe;
  if (!selectedProbe || !livePdfWitnessPassed) throw new Error("The live technical PDF witness must pass before business inference.");
  const probe = JSON.parse(await readFile(businessProbePath, "utf8")) as {
    pdfPath: string; sha256: string; sourceRevision: string; inclusions: string; exclusions: string;
    expectedCount: number; expectedUnit: string; oracleSha256: string;
  };
  expect(createHash("sha256").update(await readFile(probe.pdfPath)).digest("hex")).toBe(probe.sha256);
  await preparePlanFixture();
  await signIn({ app, screen, browser }, localOrigin, fixtureEmail);
  const prefix = `ARMY-chatgpt-business-${Date.now()}`;
  const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
  const ui = hydratedUi({ app, screen, browser }, localOrigin);
  const ids = await createEstimateViaWizard(ui, { projectName: prefix, title: "Essai métier privé borné" }, army);
  const estimateBefore = await readEstimate(browser, ids.versionId);
  const planSet = await createPlanSet(ui, army, ids, `${prefix} plans R+1 Zone 1`);
  await screen.getByRole("heading", planSet.name, { exact: true }).click();
  const [uploaded] = await Promise.all([
    browser.waitForResponse(`**/storage/v1/object/upload/sign/plan-files/${planSet.tenant_id}/${planSet.id}/**`),
    browser.locator("input[type='file'][accept*='pdf']").first().setInputFiles(probe.pdfPath),
  ]);
  expect(uploaded.status).toBe(200);
  await expect(screen.getByRole("button", `Supprimer ${path.basename(probe.pdfPath)}`, { exact: true })).toBeVisible();
  const [planFile] = await readPlanFiles(browser, planSet.id);
  expect(planFile.file_size_bytes).toBe((await readFile(probe.pdfPath)).length);
  await ui.app.open(`/dashboard/affaires/${ids.projectId}?view=estimate`);
  await screen.getByRole("button", "Préparer le métré", { exact: true }).click();
  const preparationInput: Parameters<typeof fillTakeoffPreparation>[1] = { sources: [path.basename(probe.pdfPath)], sourceRevision: probe.sourceRevision,
    objective: "count", unit: "u", levels: "R+1", zones: "Zone 1", inclusions: probe.inclusions, exclusions: probe.exclusions,
    processing: { level: "C", provider: "chatgpt" } };
  const dialog = await fillTakeoffPreparation({ ...ui, army }, { ...preparationInput, confirm: false });
  await saveTakeoffPreparation({ ...ui, army });
  const { client } = await localClient();
  const readPreparation = async () => {
    const row = await client.from("takeoff_preparations").select("revision,draft,confirmed_snapshot").eq("project_id", ids.projectId).single();
    expect(row.error).toBeNull();
    return row.data!;
  };
  const beforeAssistance = await readPreparation();
  await dialog.getByText("Assistance au cadrage", { exact: true }).click();
  const instruction = `${probe.inclusions} ${probe.exclusions}`;
  await dialog.getByLabel("Décrire le périmètre ou corriger le cadrage", { exact: true }).fill(instruction);
  await dialog.getByRole("button", "Proposer un cadrage", { exact: true }).click();
  await expect(dialog.getByText("Propositions à confirmer : consultez les sources avant de compléter votre préparation.", { exact: true })).toBeVisible();
  const afterAssistance = await readPreparation();
  expect(afterAssistance).toEqual(beforeAssistance);
  expect(afterAssistance.confirmed_snapshot).toBeNull();
  await expect(dialog.getByRole("button", "Confirmer et lancer le métré", { exact: true })).toBeDisabled();
  // The server fixture observes a cloned upstream stream; no RSC response body is read.
  await expect.poll(async () => (await readFile(transportLog, "utf8")).trim().split("\n")
    .map(line => JSON.parse(line)).some(entry => entry.entryType === "preparation-result")).toBe(true);
  const observations = (await readFile(transportLog, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  expect(observations.filter(entry => entry.entryType === "preparation-observation-error")).toEqual([]);
  const preparationResults = observations.filter(entry => entry.entryType === "preparation-result");
  expect(preparationResults).toHaveLength(1);
  const assistance = preparationResults[0] as {
    provider: string; model: string; reasoningEffort?: string; proposals: unknown[]; questions: unknown[];
    usage: { input_tokens: number; output_tokens: number; total_tokens: number };
  };
  expect(assistance).toMatchObject({ provider: "chatgpt-live", model: selectedProbe.model, reasoningEffort: selectedProbe.reasoningEffort });
  expect(assistance.usage.total_tokens).toBeGreaterThan(0);
  const assistanceScreenshot = await app.screenshot("private-business-preparation-proposals");
  await recordEvidence(army, "chatgpt-private-assistance", { ids, planSetId: planSet.id, planFileId: planFile.id,
    assistance, evidenceBoundary: "Sanitized upstream response plus successful rendered UI; full server-action provenance is covered separately, not reconstructed here.",
    beforeAssistance, afterAssistance, acceptedProposalIds: [], screenshot: assistanceScreenshot });
  // Observe the suggestions without accepting them; manually confirm the independently fixed scope.
  await fillTakeoffPreparation({ ...ui, army }, { ...preparationInput, processing: undefined });
  await dialog.getByRole("button", "Confirmer et lancer le métré", { exact: true }).click();
  await expect(dialog.getByRole("link", /Centre d'activit/i)).toBeVisible();
  const jobs = await client.from("takeoff_jobs").select("id").eq("estimate_version_id", ids.versionId).eq("plan_set_id", planSet.id);
  expect(jobs.error).toBeNull();
  expect(jobs.data).toHaveLength(1);
  const jobId = jobs.data![0].id;
  const read = () => apiRequest<{ ok: boolean; data: TakeoffJobDetailResponse }>(browser, "GET", `/api/takeoff/jobs/${jobId}`);
  await expect.poll(async () => (await read()).body.data.job.status, { timeout: 180_000 }).toBe("completed");
  const detail = (await read()).body.data;
  const extracted = TakeoffExchangeSchema.parse(detail.result?.extracted_json);
  const estimateAfter = await readEstimate(browser, ids.versionId);
  const saved = await client.from("takeoff_jobs").select("execution_provider,preparation_snapshot").eq("id", jobId).single();
  expect(saved.error).toBeNull();
  const snapshot = saved.data!.preparation_snapshot as { preparation: { scope: unknown; processing: unknown; sources: unknown } };
  const businessEvidence = { ids, jobId, sourceSha256: probe.sha256, oracleSha256: probe.oracleSha256,
    livePlanInference: true, model: detail.job.model, reasoningEffort: selectedProbe.reasoningEffort ?? null, tokenCount: detail.job.metrics.token_count,
    expected: { quantity: probe.expectedCount, unit: probe.expectedUnit }, actual: detail.items.data, extracted,
    preparation: snapshot.preparation, assistance, acceptedProposalIds: [], executionProvider: saved.data!.execution_provider,
    estimateApplied: false, estimateItemsUnchanged: JSON.stringify(estimateBefore.items) === JSON.stringify(estimateAfter.items) };
  await recordEvidence(army, "chatgpt-private-business-pdf-data", businessEvidence);
  expect(saved.data!.execution_provider).toBe("chatgpt_local");
  expect(snapshot.preparation.processing).toEqual({ level: "C", provider: "chatgpt" });
  expect(snapshot.preparation.scope).toMatchObject({ levels: ["R+1"], zones: ["Zone 1"] });
  expect(snapshot.preparation.sources).toEqual(expect.arrayContaining([
    expect.objectContaining({ document_id: planFile.id, content_hash: probe.sha256, revision: probe.sourceRevision, active: true }),
  ]));
  expect(detail.job.model).toBe(selectedProbe.model);
  expect(detail.items.data.reduce((sum, item) => sum + item.quantity, 0)).toBe(probe.expectedCount);
  expect(detail.items.data.every(item => /\bWC\b|toilett|water.closet/i.test(item.designation) && item.unit === probe.expectedUnit && item.source_page === 1)).toBe(true);
  expect(extracted.items.every(item => /TYPE\s*H|Sanitaire\s*R\+1.*Femme/i.test(`${item.designation} ${item.evidence ?? ""}`))).toBe(true);
  expect(estimateAfter.items).toEqual(estimateBefore.items);
  const transport = (await readFile(transportLog, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  expect(transport.filter(entry => entry.provider === "forbidden")).toEqual([]);
  expect(transport.filter(entry => entry.provider === "chatgpt-live" && entry.inputKind === "pdf")).toHaveLength(2);
  expect(transport.filter(entry => entry.provider === "chatgpt-live" && entry.inputKind === "preparation")).toHaveLength(1);
  expect(transport.filter(entry => entry.inputKind === "pdf" || entry.inputKind === "preparation")
    .every(entry => entry.model === selectedProbe.model && entry.reasoningEffort === "medium")).toBe(true);
  await ui.app.open(`/dashboard/affaires/${ids.projectId}/takeoff/${jobId}/review?versionId=${ids.versionId}`);
  await screen.getByRole("tab", "Assisté : Revue guidée carte par carte", { exact: true }).click();
  for (const item of detail.items.data) {
    const card = screen.getByRole("article", item.designation, { exact: true });
    await expect(card).toBeVisible();
    await card.getByText(item.designation, { exact: true }).click();
    await expect(card.getByText(String(item.quantity), { exact: true })).toBeVisible();
  }
  const screenshot = await app.screenshot("private-business-pdf-result");
  await recordEvidence(army, "chatgpt-private-business-pdf", { ...businessEvidence, businessAssertionsPassedBeforeUi: true, screenshot });
});

// The creator/copy journey moved from the production fixture: new AI jobs are local-only.
// Keep its business assertions and timeout, using the same disposable realm as other ChatGPT journeys.
test("V3C08 a takeoff targeting a v3 is offered and launched like a v2 one, and a v3 source is copied as a v3", {
  tags: ["critical", "local", "chatgpt", "engine-v3", "creators"], session: "army", timeout: 600_000,
}, async ({ app, screen, browser }) => {
  await preparePlanFixture();
  try {
    await signIn({ app, screen, browser }, localOrigin, fixtureEmail);
    const { client, userId } = await localClient();
    const member = await client.from("tenant_memberships").select("tenant_id").eq("user_id", userId).single();
    expect(member.error).toBeNull();
    const prefix = `ARMY-local-v3-${Date.now()}`;
    const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
    const ui = hydratedUi({ app, screen, browser }, localOrigin);
    if (!serverWorkspace) throw new Error("Owned development workspace unavailable.");
    await restrictCriticalBrowser(browser, ui.app, army);
    await verifyV3TakeoffCreation(ui, army, { userId, tenantId: member.data!.tenant_id },
      path.resolve(`.e2e/army/next-${serverWorkspace.id}/dev/server/server-reference-manifest.json`));
  } finally {
    if (fixtureStore) await rm(fixtureStore, { force: true });
    fixtureStore = undefined;
  }
});

// Reprise des prix (docs/metier/reprise-des-prix.md) : Decisions et le forfait ChatGPT ne reçoivent que les lignes
// à vérifier, leurs réponses restent des propositions jusqu'à ce que l'utilisateur les retienne.
if (!existsSync(liveProbePath)) test("PRX02 Decisions and the ChatGPT plan arbitrate only the price reuse lines to review, as proposals", {
  tags: ["critical", "local", "chatgpt", "engine-v3"], session: "army", timeout: 600_000,
}, async ({ app, screen, browser }) => {
  if (!await preparePlanFixture()) throw new Error("PRX02 requires its own temporary ChatGPT fixture.");
  try {
    await signIn({ app, screen, browser }, localOrigin, fixtureEmail);
    const { client, userId } = await localClient();
    const member = await client.from("tenant_memberships").select("tenant_id").eq("user_id", userId).single();
    expect(member.error).toBeNull();
    const prefix = `ARMY-local-prx-${Date.now()}`;
    const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
    const ui = hydratedUi({ app, screen, browser }, localOrigin);
    await restrictCriticalBrowser(browser, ui.app, army);
    const readTransport = async () => (await readFile(transportLog, "utf8")).trim().split("\n").filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>).filter((entry) => !isAbsorbedClientAbort(entry));
    await verifyPriceReuseArbitration(ui, army, { userId, tenantId: member.data!.tenant_id }, readTransport);
    expect((await readTransport()).filter((entry) => entry.provider === "forbidden")).toEqual([]);
  } finally {
    if (fixtureStore) await rm(fixtureStore, { force: true });
    fixtureStore = undefined;
  }
});


test("INTRETRY01 ChatGPT reanalysis keeps validated manual document classification", {
  tags: ["critical", "local", "chatgpt", "intake"], session: "army", trace: "off", timeout: 240_000,
}, async ({ app, screen, browser }) => {
  if (liveProbe) throw new Error("INTRETRY01 uses only the fictional provider transport fixture.");
  if (!await preparePlanFixture()) throw new Error("INTRETRY01 requires its own temporary ChatGPT profile.");
  try {
    await signIn({ app, screen, browser }, localOrigin, fixtureEmail);
    const prefix = `ARMY-intake-retry-${Date.now()}`;
    const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
    const ui = hydratedUi({ app, screen, browser }, localOrigin);
    const ids = await createEstimateViaWizard(ui, { projectName: prefix, title: "Relance avec classement manuel" }, army);
    const { client } = await localClient();
    const documents = async () => {
      const result = await client.from("affaire_intake_documents")
        .select("id,document_kind,classification_status,classification_source,classified_by,classified_at,manually_overridden_at,confidence,document_priority,plan_copy_generation,extracted_metadata,issues,updated_at")
        .eq("project_id", ids.projectId);
      if (result.error) throw new Error(`Owned intake read failed: ${result.error.code}`);
      return result.data;
    };
    await ui.app.open(`/dashboard/affaires/${ids.projectId}`);
    const upload = browser.locator('input[type="file"][aria-label="Ajouter des pièces à l\'affaire"]').first();
    await upload.setInputFiles(path.resolve("e2e/fixtures/sample-plan.pdf"));
    await expect.poll(async () => (await documents()).filter(doc => doc.classification_status === "classified").length,
      { timeout: 60_000 }).toBe(1);
    const document = (await documents())[0];
    await ui.app.open(`/dashboard/affaires/${ids.projectId}?intakeDocument=${document.id}#intake`);
    await screen.getByRole("button", "Détails de sample-plan.pdf", { exact: true }).click();
    const details = screen.getByRole("dialog", "Document et détails", { exact: true });
    await details.getByRole("button", "Reclasser", { exact: true }).click();
    await details.getByLabel("Nouvelle catégorie", { exact: true }).selectOption({ value: "annexes" });
    await details.getByRole("button", "Valider", { exact: true }).click();
    await expect.poll(async () => (await documents())[0]).toMatchObject({ document_kind: "annexes", classification_source: "manual" });
    await details.getByRole("button", "Reclasser", { exact: true }).click();
    await details.getByLabel("Nouvelle catégorie", { exact: true }).selectOption({ value: "plans" });
    await details.getByRole("button", "Valider", { exact: true }).click();
    await expect.poll(async () => (await documents())[0]).toMatchObject({ document_kind: "plans", classification_source: "manual" });
    await expect(details.getByRole("button", "Reclasser", { exact: true })).toBeVisible();
    const before = (await documents())[0];
    const sets = await readPlanSets(browser, ids.projectId);
    expect(sets).toHaveLength(1);
    const copiesBefore = await readPlanFiles(browser, sets[0].id);
    expect(copiesBefore).toHaveLength(1);
    // The document desk keeps the dialog open while the reclassification is pending.
    await expect(details).toHaveAttribute("aria-busy", "false");
    await details.getByRole("button", "Fermer", { exact: true }).click();
    await expect(details).not.toBeVisible();
    const retry = screen.getByRole("button", "Relancer l’analyse (1)", { exact: true });
    await expect(retry).toBeEnabled();
    await retry.click();
    await expect(screen.getByText(/1 classement manuel conservé/)).toBeVisible();
    const after = (await documents())[0];
    for (const field of ["document_kind", "classification_status", "classification_source", "classified_by", "classified_at",
      "manually_overridden_at", "confidence", "document_priority", "plan_copy_generation"] as const) expect(after[field]).toEqual(before[field]);
    expect(after.updated_at).not.toBe(before.updated_at);
    expect(await readPlanFiles(browser, sets[0].id)).toEqual(copiesBefore);
    expect(after.extracted_metadata).toMatchObject({ clientName: "Client réanalyse fictif" });
    const events = await client.from("affaire_intake_events").select("after_payload,reason")
      .eq("document_id", document.id).eq("reason", "Analyse relancée manuellement.");
    expect(events.error).toBeNull();
    expect(events.data).toHaveLength(1);
    expect(events.data![0].after_payload).toMatchObject({ document_kind: "plans", proposed_document_kind: "plans", analysis_source: "ai" });
    await screen.getByRole("button", "Détails de sample-plan.pdf", { exact: true }).click();
    await expect(details.getByText(/Classement manuel « Plans » conservé/)).toBeVisible();
    await details.getByRole("button", "Fermer", { exact: true }).click();
    await setDecisionsControl({ timeoutWriting: true });
    try {
      await retry.click();
      await expect(screen.getByText(/0 pièce analysée. 1 pièce non analysée./)).toBeVisible();
      const failed = (await documents())[0];
      for (const field of ["document_kind", "classification_status", "classification_source", "classified_by", "classified_at",
        "manually_overridden_at", "confidence", "document_priority", "plan_copy_generation"] as const) expect(failed[field]).toEqual(before[field]);
      expect(failed.extracted_metadata).toEqual(after.extracted_metadata);
      expect(await readPlanFiles(browser, sets[0].id)).toEqual(copiesBefore);
    } finally { await setDecisionsControl({}); }
    const transport = (await readFile(transportLog, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
    expect(transport.filter(entry => entry.inputKind === "intake-classification").length).toBeGreaterThanOrEqual(2);
    await recordEvidence(army, "intake-manual-reanalysis", { documentId: document.id, manualCategory: after.document_kind,
      aiProposedCategory: "plans", preservedManualFields: true, provider: "chatgpt-fixture",
      boundary: "Owned ephemeral backend, fictional PDF and simulated ChatGPT transport; no private source or live inference." });
  } finally {
    if (fixtureStore) await rm(fixtureStore, { force: true });
    fixtureStore = undefined;
  }
});


test("INTWORD01 Word analysis reports per-file failures and preserves manual choice until a proposal is applied", {
  tags: ["critical", "local", "chatgpt", "intake"], session: "army", trace: "off", timeout: 240_000,
}, async ({ app, screen, browser }) => {
  if (liveProbe) throw new Error("INTWORD01 requires the fictional provider transport fixture.");
  if (!await preparePlanFixture()) throw new Error("INTWORD01 requires its own temporary profile.");
  try {
    await signIn({ app, screen, browser }, localOrigin, fixtureEmail);
    const prefix = `ARMY-word-${Date.now()}`;
    const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
    const ui = hydratedUi({ app, screen, browser }, localOrigin);
    const ids = await createEstimateViaWizard(ui, { projectName: prefix, title: "Word et propositions" }, army);
    const { client } = await localClient();
    const directory = path.resolve(".e2e/army/critical/artifacts/fixtures", prefix);
    await mkdir(directory, { recursive: true });
    const files = [
      { name: "01-corrompu.docx", bytes: Buffer.from([1, 2, 3]) },
      { name: "02-note.doc", bytes: await readFile("e2e/fixtures/word/intake-word.doc") },
      { name: "03-note.docx", bytes: await readFile("e2e/fixtures/word/intake-word.docx") },
      { name: "04-plan.pdf", bytes: await readFile("e2e/fixtures/sample-plan.pdf") },
    ];
    for (const file of files) await writeFile(path.join(directory, file.name), file.bytes);
    const documents = async () => {
      const result = await client.from("affaire_intake_documents")
        .select("id,file_name,classification_status,classification_source,document_kind,extracted_metadata,manually_overridden_at")
        .eq("project_id", ids.projectId).order("created_at");
      if (result.error) throw new Error(`Owned Word read failed: ${result.error.code}`);
      return result.data;
    };
    await ui.app.open(`/dashboard/affaires/${ids.projectId}`);
    await browser.locator('input[type="file"][aria-label="Ajouter des pièces à l\'affaire"]').first()
      .setInputFiles(files.map(file => path.join(directory, file.name)));
    await expect.poll(async () => {
      const rows = await documents();
      return rows.length === 4 && rows.every(row => !["queued", "processing"].includes(row.classification_status));
    }, { timeout: 60_000 }).toBe(true);
    for (const row of await documents()) {
      const category = row.file_name.endsWith(".pdf") ? "annexes" : "emails";
      await ui.app.open(`/dashboard/affaires/${ids.projectId}?intakeDocument=${row.id}#intake`);
      await screen.getByRole("button", `Détails de ${row.file_name}`, { exact: true }).click();
      const details = screen.getByRole("dialog", "Document et détails", { exact: true });
      await details.getByRole("button", "Reclasser", { exact: true }).click();
      await details.getByLabel("Nouvelle catégorie", { exact: true }).selectOption({ value: category });
      await details.getByRole("button", "Valider", { exact: true }).click();
      await expect.poll(async () => (await documents()).find(doc => doc.id === row.id)).toMatchObject({ document_kind: category, classification_source: "manual" });
      await expect(details.getByRole("button", "Reclasser", { exact: true })).toBeVisible();
      await expect(details).toHaveAttribute("aria-busy", "false");
      await details.getByRole("button", "Fermer", { exact: true }).click();
      await expect(details).not.toBeVisible();
    }
    await screen.getByRole("button", "Relancer l’analyse (4)", { exact: true }).click();
    await expect(screen.getByText(/3 pièces analysées. 1 pièce non analysée./)).toBeVisible();
    await expect(screen.getByText("01-corrompu.docx : Le fichier Word est invalide ou corrompu. Réenregistrez-le en DOCX ou exportez-le en PDF.", { exact: true })).toBeVisible();
    await expect(screen.getByText(/sélection restante/)).toHaveCount(0);
    const rows = await documents();
    expect(rows.filter(row => row.classification_source === "manual")).toHaveLength(4);
    for (const word of rows.filter(row => row.file_name.startsWith("02-") || row.file_name.startsWith("03-"))) {
      expect(word).toMatchObject({ document_kind: "emails", extracted_metadata: { clientName: "Client réanalyse fictif", aiCategoryProposal: { category: "cctp" } } });
    }
    const pdf = rows.find(row => row.file_name === "04-plan.pdf")!;
    expect(pdf.document_kind).toBe("annexes");
    await screen.getByRole("button", "Voir la proposition IA pour 04-plan.pdf", { exact: true }).click();
    const details = screen.getByRole("dialog", "Document et détails", { exact: true });
    const proposal = details.getByRole("region", "Proposition de catégorie IA", { exact: true });
    await expect(proposal.getByText("Proposition IA : Plans", { exact: true })).toBeVisible();
    await expect(proposal.getByText("Vue isométrique", { exact: true })).toBeVisible();
    await details.getByRole("button", "Fermer", { exact: true }).click();
    expect((await documents()).find(row => row.id === pdf.id)?.document_kind).toBe("annexes");
    await screen.getByRole("button", "Voir la proposition IA pour 04-plan.pdf", { exact: true }).click();
    await proposal.getByRole("button", "Appliquer la catégorie proposée", { exact: true }).click();
    await expect.poll(async () => (await documents()).find(row => row.id === pdf.id)).toMatchObject({ document_kind: "plans", classification_source: "manual" });
    await recordEvidence(army, "word-analysis-proposal", { supportedFormats: ["doc", "docx"], invalidFirstFileDidNotStopOthers: true,
      successful: 3, failed: "01-corrompu.docx", manualChoicePreservedBeforeAcceptance: true, categoryAfterExplicitAcceptance: "plans",
      boundary: "Fictional documents, isolated DB/Storage and simulated provider transport; no private file or live inference." });
  } finally {
    if (fixtureStore) await rm(fixtureStore, { force: true });
    fixtureStore = undefined;
  }
});
