import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, test } from "@e2e-dev/web";
import { credentials, expect } from "e2e";

import { apiRequest, createEstimateViaWizard, readEstimate, recordEvidence } from "../critical/fixtures";
import { fillTakeoffPreparation, saveTakeoffPreparation } from "../critical/preparation-support";
import { createPlanSet, readPlanFiles, uploadSamplePlan } from "../critical/plans-support";
import type { TakeoffJobDetailResponse } from "@/lib/takeoff/types";
import { TakeoffExchangeSchema } from "@/lib/takeoff/schemas";
import { createLocalChatGptOwner, prepareChatGptServerWorkspace, warmChatGptServer } from "./chatgpt-server-support";

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
let serverWorkspace: Awaited<ReturnType<typeof prepareChatGptServerWorkspace>> | undefined;
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
  localServer = spawn(process.execPath, ["scripts/dev-chatgpt-local.mjs", "--port", String(port), "--webpack"], {
    cwd: process.cwd(), env: { ...process.env, CI: "", VERCEL: "", NODE_ENV: "development", E2E_ARMY_SERVER_MODE: "development", ...serverWorkspace.environment,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(path.resolve("e2e/army/local/chatgpt-provider-fixture.mjs")).href}`,
      ARMY_CHATGPT_TRANSPORT_LOG: transportLog,
      ...(!liveProbe ? { MERGEONE_OPENAI_DECISIONS: "1", OPENAI_DECISIONS_API_KEY: "army-decisions-fixture", ARMY_DECISIONS_CONTROL: decisionsControl } : {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [localServer.stdout, localServer.stderr]) stream?.on("data", (chunk) => {
    diagnostics.push(String(chunk).replace(/code=[^&\s]+/g, "code=[redacted]"));
    if (diagnostics.length > 100) diagnostics.shift();
  });
  await expect.poll(async () => {
    if (localServer.exitCode !== null) throw new Error("ChatGPT local server exited before readiness.");
    return fetch(`${localOrigin}/login`).then((response) => response.ok).catch(() => false);
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
      /(?:Compiling|Ready in|Local Next process exited|restarting|Restarting|FATAL ERROR|heap limit|allocation failed|(?:GET|POST) \/(?:dashboard|login)(?:[/? ]))/.test(line))
      .map(line => line.replace(/(\/(?:dashboard|login)[^?\s]*)\?[^\s]*/g, "$1?[redacted]"));
    await mkdir(path.dirname(transportLog), { recursive: true });
    await writeFile(path.join(path.dirname(transportLog), `chatgpt-local-server-${new URL(localOrigin).port}.log`), timings.join("\n"));
  }
  await serverWorkspace?.cleanup();
});

// This test uses a fictional Decisions response on an owned backend. It never calls the paid API.
if (!existsSync(liveProbePath)) test("DEC01 Decisions classifications are visible for review without changing the preparation", {
  tags: ["critical", "local", "chatgpt", "premetre"], session: "army", timeout: 180_000,
}, async ({ app, screen, browser }) => {
  const account = { ...credentials.user("army"), username: fixtureEmail };
  await app.open(`${localOrigin}/login`);
  await screen.getByLabel("Email", { exact: true }).fill(account.username);
  await screen.getByLabel(/Mot de passe/).fill(account.password);
  await screen.getByRole("button", "Se connecter", { exact: true }).tap();
  await expect(browser).toHaveURL(/\/dashboard/);
  const prefix = `ARMY-decisions-${Date.now()}`;
  const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
  const ui = { app: { ...app, open: (url: string) => app.open(new URL(url, localOrigin).href) } as typeof app, screen, browser };
  const estimate = await createEstimateViaWizard(ui, { projectName: prefix, title: "Préparation Decisions" }, army);
  const planSet = await createPlanSet(ui, army, estimate, `${prefix} plans`);
  const file = await uploadSamplePlan(ui, army, planSet);
  await ui.app.open(`/dashboard/affaires/${estimate.projectId}`);
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
  expect(observed.filter(entry => entry.provider === "decisions-fixture")).toHaveLength(1);
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
      await expect.poll(async () => (await readFile(transportLog, "utf8")).trim().split("\n")
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

test("ChatGPT local: profile starts PKCE authorization and recovers from declined consent", {
  tags: ["critical", "local", "chatgpt"], session: "army", timeout: 180_000,
}, async ({ app, screen, browser }) => {
  const account = { ...credentials.user("army"), username: fixtureEmail };
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
  await app.open(`${localOrigin}/login`);
  const showPassword = screen.getByRole("button", "Afficher le mot de passe", { exact: true });
  await showPassword.tap();
  await expect(screen.getByRole("button", "Masquer le mot de passe", { exact: true })).toBeVisible();
  await screen.getByLabel("Email", { exact: true }).fill(account.username);
  await screen.getByLabel(/Mot de passe/).fill(account.password);
  await screen.getByRole("button", "Se connecter", { exact: true }).tap();
  await expect(browser).toHaveURL(/\/dashboard/);
  await app.open(`${localOrigin}/dashboard/profile`);
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
  const account = { ...credentials.user("army"), username: fixtureEmail };
  await app.open(`${localOrigin}/login`);
  await screen.getByRole("button", "Afficher le mot de passe", { exact: true }).tap();
  await screen.getByLabel("Email", { exact: true }).fill(account.username);
  await screen.getByLabel(/Mot de passe/).fill(account.password);
  await screen.getByRole("button", "Se connecter", { exact: true }).tap();
  await expect(browser).toHaveURL(/\/dashboard/);
  const prefix = `ARMY-chatgpt-${Date.now()}`;
  const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
  const ui = { app: { ...app, open: (url: string) => app.open(new URL(url, localOrigin).href) } as typeof app, screen, browser };
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
  expect(transport.slice(transportStart)).toEqual([
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
  const account = { ...credentials.user("army"), username: fixtureEmail };
  await app.open(`${localOrigin}/login`);
  await screen.getByRole("button", "Afficher le mot de passe", { exact: true }).tap();
  await screen.getByLabel("Email", { exact: true }).fill(account.username);
  await screen.getByLabel(/Mot de passe/).fill(account.password);
  await screen.getByRole("button", "Se connecter", { exact: true }).tap();
  await expect(browser).toHaveURL(/\/dashboard/);
  const prefix = `ARMY-chatgpt-pdf-${Date.now()}`;
  const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
  const ui = { app: { ...app, open: (url: string) => app.open(new URL(url, localOrigin).href) } as typeof app, screen, browser };
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
  await picker.selectOption({ value: "gemini" });
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
  expect(transport.filter(entry => entry.inputKind === "pdf")).toEqual([
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
  const account = { ...credentials.user("army"), username: fixtureEmail };
  await app.open(`${localOrigin}/login`);
  await screen.getByRole("button", "Afficher le mot de passe", { exact: true }).tap();
  await screen.getByLabel("Email", { exact: true }).fill(account.username);
  await screen.getByLabel(/Mot de passe/).fill(account.password);
  await screen.getByRole("button", "Se connecter", { exact: true }).tap();
  await expect(browser).toHaveURL(/\/dashboard/);
  const prefix = `ARMY-chatgpt-business-${Date.now()}`;
  const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
  const ui = { app: { ...app, open: (url: string) => app.open(new URL(url, localOrigin).href) } as typeof app, screen, browser };
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
  await ui.app.open(`/dashboard/affaires/${ids.projectId}`);
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
