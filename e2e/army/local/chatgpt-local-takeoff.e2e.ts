import { launchPreparedPlanSet } from "../takeoff/prepared-takeoff";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, test } from "@e2e-dev/web";
import { expect } from "e2e";

import { apiRequest, createEstimateViaWizard, readEstimate, recordEvidence, restrictCriticalBrowser, type ArmyState } from "../critical/fixtures";
import { hydratedUi, signIn, waitForHydration } from "../critical/hydration-support";
import { fillTakeoffPreparation, saveTakeoffPreparation } from "../critical/preparation-support";
import { createPlanSet, ownedTakeoffJobs, readPlanFiles, uploadPlansUnderNames, uploadSamplePlan } from "../critical/plans-support";
import type { TakeoffPreparation } from "@/lib/takeoff/preparation";
import type { TakeoffJobDetailResponse } from "@/lib/takeoff/types";
import { TakeoffExchangeSchema } from "@/lib/takeoff/schemas";
import {
  chatGptLocalServer, liveProbePath, localChatGptClient, writeDecisionsControl, writePlanFixture,
  type ChatGptLiveProbe,
} from "./chatgpt-local-journey-support";
import { TAKEOFF_JOURNEY_WAVES } from "./chatgpt-server-support";
import { callServerAction, serverActionId } from "./engine-v3-creators-support";
import { verifyV3TakeoffCreation } from "./engine-v3-takeoff-journey";
import { localTakeoffWorkerClient } from "../takeoff/fixtures";
import { activateOwnedTakeoffNotices, readOwnedTakeoffNotice } from "../takeoff/completion-support";

// The takeoff jobs of the ChatGPT local journeys, on this file's own development server: the local-only provider
// rules (LOCAL01 to LOCAL06), the launch of a second plan set (LOCAL07), the profile's OAuth start, the PDF takeoff
// on the plan, and V3C08.
// The Decisions, lab, price reuse and intake journeys run in chatgpt-local-decisions.e2e.ts, on a second server
// (chatgpt-local-journey-support.ts says why they are two files). The order matters: LOCAL01 and the OAuth start
// need an owner without a ChatGPT profile, and the PDF takeoff leaves the profile that the private business witness
// and V3C08 reuse, which V3C08 removes.
const server = chatGptLocalServer();
let localOrigin: string;
let diagnostics: readonly string[] = [];
let fixtureStore: string | undefined;
let liveProbe: ChatGptLiveProbe | null = null;
let livePdfWitnessPassed = false;
const businessProbePath = path.resolve(".private/chatgpt-local-business-probe.json");
let transportLog: string;
let decisionsControl: string;
let fixtureEmail: string;
let serverWorkspace: { id: string } | undefined;
const localClient = () => localChatGptClient(fixtureEmail);
const actionManifest = () => `.build/tester-army/next-${serverWorkspace!.id}/dev/server/server-reference-manifest.json`;
const setDecisionsControl = (input: { hold?: boolean; timeoutWriting?: boolean }) => writeDecisionsControl(decisionsControl, input);
/** Writes the owner's temporary ChatGPT profile unless a test of this file already left one. */
async function preparePlanFixture(unsetPreferences = false) {
  if (fixtureStore) return false;
  fixtureStore = await writePlanFixture(fixtureEmail, liveProbe, unsetPreferences);
  return true;
}

beforeAll(async () => {
  ({ origin: localOrigin, email: fixtureEmail, liveProbe, transportLog, decisionsControl, workspace: serverWorkspace, diagnostics } = await server.start());
});
// One hook per wave: each has its own time limit, and the start with every compile does not fit in one.
for (const wave of TAKEOFF_JOURNEY_WAVES) beforeAll(() => server.compileTakeoffRoutes(wave));

afterAll(() => server.stop(fixtureStore));

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
  const dialog = await fillTakeoffPreparation({ ...ui, army }, { sources: [file.file_name] });
  await expect(browser.locator('select option[value="gemini"]')).toHaveCount(0);
  await dialog.getByText("Assistance au cadrage", { exact: true }).click();
  await dialog.getByRole("button", "Proposer un cadrage", { exact: true }).click();
  await expect(dialog.getByText(/Aucune assistance rédactionnelle n.est configurée/).first()).toBeVisible();
  await dialog.getByRole("button", "Confirmer et lancer le métré", { exact: true }).click();
  await expect(dialog.getByText(/Connectez votre forfait ChatGPT/).first()).toBeVisible();
  expect(await jobs.list()).toEqual([]);
  const forged = await callServerAction(browser, await serverActionId("launchPreparedTakeoffFromPlanSetAction", actionManifest()),
    { projectId: estimate.projectId, planSetId: planSet.id, versionId: estimate.versionId, level: "B", provider: "gemini" });
  expect(forged).toMatchObject({ ok: false, errorStatus: 422, errorCode: "AI_PROVIDER" });
  expect(await jobs.list()).toEqual([]);
  const transport = (await readFile(transportLog, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  expect(transport.filter(entry => entry.provider === "forbidden")).toEqual([]);
  await recordEvidence(army, "local-only-no-provider", { estimate, geminiKeyFixturePresent: true,
    noGeminiOption: true, assistanceUnavailable: true, noJobsCreated: true, forgedProviderRejected: forged.errorStatus, forbiddenRequests: 0 });
});

if (!existsSync(liveProbePath)) test("LOCAL02 a legacy drafting choice converts to detailed ChatGPT with no data entry", {
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
    await saveTakeoffPreparation({ ...ui, army });
    const { client } = await localClient();
    const row = await client.from("takeoff_preparations").select("draft,revision").eq("project_id", estimate.projectId).single();
    expect(row.error).toBeNull();
    const draft = row.data!.draft as { processing: { level: string; provider: string }; provenance?: unknown };
    draft.processing = { level: "B", provider: "gemini" };
    delete draft.provenance;
    const { client: worker } = await localTakeoffWorkerClient(army, estimate.versionId, fixtureEmail);
    const update = await worker.from("takeoff_preparations").update({ draft, revision: row.data!.revision + 1 }).eq("project_id", estimate.projectId).select("project_id").single();
    expect(update.error).toBeNull();
    await browser.reload();
    await waitForHydration(browser);
    await screen.getByRole("button", "Préparer le métré", { exact: true }).click();
    const dialog = screen.getByRole("dialog", "Préparer le métré", { exact: true });
    await expect(dialog.getByText(/Préparation précédente adaptée/)).toBeVisible();
    await expect(dialog.getByText("Tout mesurer", { exact: true })).toBeVisible();
    await expect(dialog.getByText(/Unité par ouvrage/)).toBeVisible();
    await expect(dialog.getByLabel("Fournisseur IA", { exact: true })).toHaveCount(0);
    const transportStart = (await readFile(transportLog, "utf8")).trim().split("\n").filter(Boolean).length;
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
    expect(stored.data).toMatchObject({ execution_provider: "chatgpt_local", preparation_snapshot: { execution_selection: { model: "army-plan-model", reasoningEffort: null }, preparation: { processing: { level: "C", provider: "chatgpt" }, objective: "measure_all", conventions: { unit_mode: "per_item" }, provenance: { rule_version: 1, converted_from_legacy: true } } } });
    const snapshot = stored.data!.preparation_snapshot as unknown as { preparation_revision: number; preparation: { sources: Array<{ active: boolean; content_hash: string; document_id: string; revision: string; plan_set_id: string }> } };
    const activeSources = snapshot.preparation.sources.filter(source => source.active);
    expect(snapshot.preparation_revision).toBeGreaterThan(0);
    expect(activeSources).toHaveLength(1);
    expect(activeSources[0]).toMatchObject({ document_id: file.id, revision: null, plan_set_id: planSet.id });
    expect(activeSources[0].content_hash).toMatch(/^[a-f0-9]{64}$/);
    const transport = (await readFile(transportLog, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
    expect(transport.filter(entry => entry.provider === "forbidden")).toEqual([]);
    const calls = transport.slice(transportStart).filter(entry => entry.provider === "chatgpt-fixture" && entry.inputKind === "pdf");
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe("army-plan-model");
    expect(calls[0]).not.toHaveProperty("reasoningEffort");
    await recordEvidence(army, "local-only-legacy-draft", { estimate, jobId: job.id, convertedLegacyChoice: true, providerCalls: calls,
      chosenProvider: "chatgpt", resultProvider: result.result?.provider_meta, forbiddenRequests: 0,
      boundary: "Fictional plan and ChatGPT transport fixture on an owned local backend." });
  } finally {
    if (fixtureStore) await rm(fixtureStore, { force: true });
    fixtureStore = undefined;
  }
});

// Regression: the plan set the member left keeps the identical copy it set aside, which must not refuse the launch of
// the plan set chosen next.
if (!existsSync(liveProbePath)) test("LOCAL07 another plan set launches after the first one set an identical copy aside", {
  tags: ["critical", "local", "chatgpt", "premetre"], session: "army", timeout: 300_000,
}, async ({ app, screen, browser }) => {
  if (!await preparePlanFixture()) throw new Error("LOCAL07 requires a separate temporary ChatGPT profile.");
  try {
    await signIn({ app, screen, browser }, localOrigin, fixtureEmail);
    const prefix = `ARMY-local-plan-sets-${Date.now()}`;
    const army: ArmyState = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
    const ui = hydratedUi({ app, screen, browser }, localOrigin);
    const estimate = await createEstimateViaWizard(ui, { projectName: prefix, title: "Deux jeux de plans" }, army);
    const first = await createPlanSet(ui, army, estimate, `${prefix} plans A`);
    await screen.getByRole("heading", first.name, { exact: true }).click();
    const [original, copy] = await uploadPlansUnderNames(ui, army, first, ["Réseau RDC.pdf", "Réseau RDC copie.pdf"]);
    const created = await apiRequest<{ data: { plan_set: { id: string; tenant_id: string } } }>(browser, "POST", "/api/takeoff/plan-sets",
      { project_id: estimate.projectId, name: `${prefix} plans B` });
    expect(created.status).toBe(201);
    const second = { ...first, ...created.body.data.plan_set, name: `${prefix} plans B` };
    (army.ownedPlanSets ??= []).push({ projectId: estimate.projectId, planSetId: second.id, tenantId: second.tenant_id });
    await browser.reload();
    await waitForHydration(browser);
    await screen.getByRole("heading", second.name, { exact: true }).click();
    const [other] = await uploadPlansUnderNames(ui, army, second, ["Réseau R+1.pdf"]);
    const jobs = ownedTakeoffJobs(browser, estimate);
    const { client } = await localClient();
    const launchedJobs = async () => {
      const result = await client.from("takeoff_jobs").select("id,plan_set_id,status,error_code,preparation_snapshot")
        .eq("estimate_version_id", estimate.versionId).order("created_at");
      expect(result.error).toBeNull();
      return result.data!;
    };
    // Once an analysis exists, another plan set is analysed from the activity center's launch link (« Pour analyser un
    // autre jeu, ouvrez-le ci-dessous » in the plans center).
    const openLaunch = async (planSetId: string) => {
      await ui.app.open(`/dashboard/affaires/${estimate.projectId}/takeoff?launch=1&launchPlanSet=${planSetId}`);
      const dialog = screen.getByRole("dialog", "Préparer le métré", { exact: true });
      await expect(dialog.getByLabel("Jeu de plans à analyser", { exact: true })).toHaveValue(planSetId);
      return dialog;
    };

    const firstDialog = await openLaunch(first.id);
    await firstDialog.getByRole("button", "Confirmer et lancer le métré", { exact: true }).click();
    await expect(firstDialog.getByText(/— 1 fichier de plan[.]/)).toBeVisible({ timeout: 45_000 });
    await expect.poll(async () => (await launchedJobs()).length, { timeout: 45_000 }).toBe(1);
    const [firstJob] = await launchedJobs();
    const firstSources = (firstJob.preparation_snapshot as unknown as { preparation: TakeoffPreparation }).preparation.sources;
    expect(firstJob.plan_set_id).toBe(first.id);
    expect(firstSources.filter((source) => source.active).map((source) => source.document_id)).toEqual([original.id]);
    expect(firstSources.find((source) => source.document_id === copy.id)).toMatchObject({ active: false, alternate_of: original.id });

    // The member opens the first plan set again and selects the other one in the dialog.
    const secondDialog = await openLaunch(first.id);
    const planSetSelect = secondDialog.getByLabel("Jeu de plans à analyser", { exact: true });
    await planSetSelect.selectOption({ value: second.id });
    await expect(planSetSelect).toHaveValue(second.id);
    await secondDialog.getByRole("button", "Confirmer et lancer le métré", { exact: true }).click();
    await expect(secondDialog.getByText(/— 1 fichier de plan[.]/)).toBeVisible({ timeout: 45_000 });
    await expect(secondDialog.getByText(/Une version de plan a changé/)).toHaveCount(0);
    await expect.poll(async () => (await launchedJobs()).length, { timeout: 45_000 }).toBe(2);
    const secondJob = (await launchedJobs())[1];
    const secondSources = (secondJob.preparation_snapshot as unknown as { preparation: TakeoffPreparation }).preparation.sources;
    expect(secondJob.plan_set_id).toBe(second.id);
    expect(secondSources.filter((source) => source.active && source.kind === "plan").map((source) => source.document_id)).toEqual([other.id]);
    // The first plan set keeps the copy it set aside, for a return to it.
    expect(secondSources.find((source) => source.document_id === copy.id)).toMatchObject({ active: false, alternate_of: original.id });
    // Both analyses end before the next journey counts its provider calls.
    await expect.poll(async () => {
      const current = await launchedJobs();
      const failed = current.find((job) => job.status === "failed");
      if (failed) throw new Error(`Local plan-set fixture failed: ${failed.error_code ?? "unknown"}`);
      return current.map((job) => job.status);
    }, { timeout: 150_000 }).toEqual(["completed", "completed"]);
    await recordEvidence(army, "local-plan-set-switch", { estimate, firstPlanSetId: first.id, secondPlanSetId: second.id,
      setAsideCopy: copy.id, jobs: (await jobs.list()).map(({ id, status }) => ({ id, status })),
      boundary: "Fictional plans and ChatGPT transport fixture on an owned local backend." });
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
    const dialog = await fillTakeoffPreparation({ ...ui, army }, { sources: [file.file_name] });
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
  expect(detail.body.data.job).toMatchObject({ id: jobId, can_resubmit: false });
  const resubmit = await apiRequest<{ error: { code: string } }>(browser, "POST", `/api/takeoff/jobs/${jobId}/resubmit`);
  expect([resubmit.status, resubmit.body.error.code]).toEqual([422, "AI_PROVIDER"]);
  expect(await read()).toEqual(before);
  const internal = await fetch(`${localOrigin}/api/internal/takeoff/process-job`, { method: "POST",
    headers: { "content-type": "application/json", "x-takeoff-worker-secret": "army-worker-fixture" },
    body: JSON.stringify({ job_id: jobId, trigger: "reconcile" }) });
  expect(internal.status).toBe(422);
  expect(await read()).toEqual(before);
  if (!await preparePlanFixture()) throw new Error("The foreign-host test requires its own temporary profile.");
  try {
    // A local job of another Mac: the creator's plan is connected here, the job stays bound to its own host.
    const foreignId = randomUUID();
    const foreign = await client.from("takeoff_jobs").insert({ id: foreignId, tenant_id: tenantId, estimate_version_id: estimate.versionId,
      created_by: userId, level: "A", status: "pending", source_file_name: "autre-mac.csv", source_file_type: "text/csv",
      source_file_size_bytes: 20, source_file_path: `${tenantId}/${foreignId}/autre-mac.csv`, execution_provider: "chatgpt_local",
      execution_host_id: "urn:uuid:ffffffff-ffff-4fff-8fff-ffffffffffff", processing_strategy: "sync" }).select("id").single();
    expect(foreign.error).toBeNull();
    const failedForeign = await client.from("takeoff_jobs").update({ status: "failed", error_code: "AI_TIMEOUT" }).eq("id", foreignId).select("status,dispatch_status,retry_count").single();
    expect(failedForeign.error).toBeNull();
    const refusedResubmit = await apiRequest<{ error: { code: string } }>(browser, "POST", `/api/takeoff/jobs/${foreignId}/resubmit`);
    expect([refusedResubmit.status, refusedResubmit.body.error.code]).toEqual([422, "AI_PROVIDER"]);
    const afterForeign = await client.from("takeoff_jobs").select("status,dispatch_status,retry_count").eq("id", foreignId).single();
    expect(afterForeign.data).toEqual(failedForeign.data);
  } finally {
    if (fixtureStore) await rm(fixtureStore, { force: true });
    fixtureStore = undefined;
  }
  expect((await readEstimate(browser, estimate.versionId)).items).toEqual(beforeEstimate.items);
  const transport = (await readFile(transportLog, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  expect(transport.filter(entry => entry.provider === "forbidden")).toEqual([]);
  await recordEvidence(army, "local-historical-provider", { estimate, jobId, before, after: await read(),
    rejected: ["resubmit", "internal-worker", "foreign-host-resubmit"], resultRemainsReadable: true, forbiddenRequests: 0 });
});

if (!existsSync(liveProbePath)) test("LOCAL05 a definitively ended ChatGPT job rejects both concurrent relaunches", {
  tags: ["critical", "local", "chatgpt", "premetre"], session: "army", timeout: 240_000,
}, async ({ app, screen, browser }) => {
  if (!await preparePlanFixture()) throw new Error("LOCAL05 requires a separate temporary ChatGPT profile.");
  try {
    await activateOwnedTakeoffNotices();
    await signIn({ app, screen, browser }, localOrigin, fixtureEmail);
    const prefix = `ARMY-local-retry-${Date.now()}`;
    const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
    const ui = hydratedUi({ app, screen, browser }, localOrigin);
    const estimate = await createEstimateViaWizard(ui, { projectName: prefix, title: "Reprise ChatGPT locale" }, army);
    const before = await readEstimate(browser, estimate.versionId);
    await setDecisionsControl({ timeoutWriting: true });
    const { jobId } = await launchPreparedPlanSet(ui, army, estimate);
    const read = () => apiRequest<{ data: TakeoffJobDetailResponse }>(browser, "GET", `/api/takeoff/jobs/${jobId}`);
    await expect.poll(async () => (await read()).body.data.job.status, { timeout: 120_000 }).toBe("failed");
    const failed = (await read()).body.data;
    expect(failed.items.data).toEqual([]);
    expect(failed.job.completed_at).toBeTruthy();
    await expect.poll(() => Date.now() >= Date.parse(failed.job.completed_at!) + 5_000, { timeout: 20_000 }).toBe(true);
    await setDecisionsControl({});
    const attempts = await Promise.all([0, 1].map(() => apiRequest(browser, "POST", `/api/takeoff/jobs/${jobId}/resubmit`)));
    expect(attempts.map(attempt => attempt.status)).toEqual([409, 409]);
    for (const attempt of attempts) expect(JSON.stringify(attempt.body)).toContain("Préparez une nouvelle analyse");
    const after = (await read()).body.data;
    expect(after).toMatchObject({ job: { status: "failed", retry_count: failed.job.retry_count }, items: { data: [] } });
    expect(after.result?.id).toBe(failed.result?.id);
    expect(await readOwnedTakeoffNotice(jobId)).toMatchObject({ outcome: "failure" });
    expect((await readEstimate(browser, estimate.versionId)).items).toEqual(before.items);
    const transport = (await readFile(transportLog, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
    expect(transport.filter(entry => entry.provider === "forbidden")).toEqual([]);
    await recordEvidence(army, "local-concurrent-resubmit", { estimate, jobId, attemptStatuses: attempts.map(attempt => attempt.status),
      finalStatus: after.job.status, retryCount: after.job.retry_count, provider: "chatgpt", estimateUnchanged: true,
      boundary: "Simulated Responses timeout on an owned local backend; the ended job cannot be replayed." });
  } finally {
    await setDecisionsControl({});
    if (fixtureStore) await rm(fixtureStore, { force: true });
    fixtureStore = undefined;
  }
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
  const profileOrigin = localOrigin.replace("127.0.0.1", "localhost");
  // The runner session uses localhost too: cookies span ports, so isolate this fictional owner.
  await browser.clearCookies({ domain: "localhost" });
  await signIn({ app, screen, browser }, profileOrigin, fixtureEmail);
  await app.open(`${profileOrigin}/dashboard/profile`);
  await waitForHydration(browser);
  await expect(screen.getByRole("heading", "Abonnement ChatGPT", { exact: true })).toBeVisible();
  await screen.getByRole("button", "Continue with ChatGPT", { exact: true }).tap();
  await expect(screen.getByText("Vous avez annulé la connexion ChatGPT. Vous pouvez la relancer.", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Continue with ChatGPT", { exact: true })).toBeEnabled();
  expect(authorization).toEqual({ host: "auth.openai.com", clientId: "dynamic_agent_client", challengeMethod: "S256", planScope: true });
  expect(diagnostics.some((entry) => /GET \/auth\/chatgpt\/callback.*state=/.test(entry))).toBe(false);
  const prefix = `ARMY-chatgpt-${Date.now()}`;
  await recordEvidence({ runPrefix: prefix, projectName: prefix, ownedEstimates: [] }, "chatgpt-local", {
    outcome: "local OAuth start and injected consent refusal", liveChatGptSignIn: false, inference: false,
    pageOrigin: profileOrigin, callbackOrigin: localOrigin, standardDevWithoutOptIn: true,
    authorization, callbackContainsSecretsInLog: diagnostics.some((entry) => /GET \/auth\/chatgpt\/callback.*state=/.test(entry)),
  });
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
  const plans = await createPlanSet(ui, army, ids, `${prefix} plans`);
  await screen.getByRole("heading", plans.name, { exact: true }).click();
  await browser.locator("input[type='file'][accept*='pdf']").first().setInputFiles(file);
  await expect(screen.getByRole("button", `Supprimer ${path.basename(file)}`, { exact: true })).toBeVisible();
  await ui.app.open(`/dashboard/affaires/${ids.projectId}/takeoff?launch=1&launchPlanSet=${plans.id}`);
  const dialog = await fillTakeoffPreparation({ ...ui, army }, { sources: [path.basename(file)],
    objective: "extract_quantities", unit: "Unités des lignes sources", inclusions: "Toutes les quantités documentées",
    levels: "Tous", zones: "Toutes", exclusions: "" });
  await expect(browser.locator('[role="dialog"] select option[value="gemini"]')).toHaveCount(0);
  await dialog.getByRole("button", "Confirmer et lancer le métré", { exact: true }).click();
  await expect(dialog.getByRole("link", /Centre d'activit/i)).toBeVisible();
  const { client } = await localClient();
  const jobs = await client.from("takeoff_jobs").select("id").eq("estimate_version_id", ids.versionId).eq("plan_set_id", plans.id).single();
  expect(jobs.error).toBeNull();
  const jobId = jobs.data!.id;
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
  const preparationInput: Parameters<typeof fillTakeoffPreparation>[1] = { sources: [path.basename(probe.pdfPath)],
    objective: "count", unit: "u", levels: "R+1", zones: "Zone 1", inclusions: probe.inclusions, exclusions: probe.exclusions };
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
  await fillTakeoffPreparation({ ...ui, army }, preparationInput);
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
    expect.objectContaining({ document_id: planFile.id, content_hash: probe.sha256, active: true }),
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
      path.resolve(`.build/tester-army/next-${serverWorkspace.id}/dev/server/server-reference-manifest.json`), {
        unavailable: async (run) => {
          const store = await readFile(fixtureStore!, "utf8");
          await writeFile(fixtureStore!, JSON.stringify({ ...JSON.parse(store), selectedId: null }), { mode: 0o600 });
          try { return await run(); } finally { await writeFile(fixtureStore!, store, { mode: 0o600 }); }
        },
      });
  } finally {
    if (fixtureStore) await rm(fixtureStore, { force: true });
    fixtureStore = undefined;
  }
});
