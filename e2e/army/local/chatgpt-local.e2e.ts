import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, test } from "@e2e-dev/web";
import { credentials, expect } from "e2e";

import { apiRequest, createEstimateViaWizard, readEstimate, recordEvidence } from "../critical/fixtures";
import { fillTakeoffPreparation } from "../critical/preparation-support";
import type { TakeoffJobDetailResponse } from "@/lib/takeoff/types";

let localServer: ChildProcess;
let localOrigin: string;
const diagnostics: string[] = [];
let fixtureStore: string | undefined;
// Explicit opt-in for an owner-authorized live probe on the disposable backend.
// The private file contains only a short-lived access token, never refresh/ID tokens.
const liveProbePath = path.resolve(".private/chatgpt-local-live-probe.json");
let liveProbe: { accessToken: string; model: string; expiresAt: number } | null = null;
const transportLog = path.resolve(".e2e/army/critical/artifacts/chatgpt-transport.jsonl");

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
  await mkdir(path.dirname(transportLog), { recursive: true });
  await writeFile(transportLog, "");
  localServer = spawn(process.execPath, ["scripts/dev-chatgpt-local.mjs", "--port", String(port)], {
    cwd: process.cwd(), env: { ...process.env, CI: "", VERCEL: "", NODE_ENV: "development", E2E_ARMY_SERVER_MODE: "development",
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(path.resolve("e2e/army/local/chatgpt-provider-fixture.mjs")).href}`,
      ARMY_CHATGPT_TRANSPORT_LOG: transportLog },
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
});

afterAll(async () => {
  if (localServer && localServer.exitCode === null) {
    localServer.kill("SIGTERM");
    await new Promise<void>((resolve) => localServer.once("exit", () => resolve()));
  }
  if (fixtureStore) await rm(fixtureStore, { force: true });
});

test("ChatGPT local: profile starts PKCE authorization and recovers from declined consent", {
  tags: ["critical", "local", "chatgpt"], session: "army", timeout: 180_000,
}, async ({ app, screen, browser }) => {
  const account = credentials.user("army");
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

async function preparePlanFixture() {
  if (fixtureStore) return;
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (backend.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST) throw new Error("Owned local backend required.");
  const client = createClient(backend.origin, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const login = await client.auth.signInWithPassword({ email: process.env.E2E_LOGIN_EMAIL!, password: process.env.E2E_LOGIN_PASSWORD! });
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
  const model = liveProbe?.model ?? "army-plan-model";
  await writeFile(file, JSON.stringify({ selectedId: id, profiles: [{ id, clientId: "army-fixture", issuer: "https://auth.openai.com",
    subject: "army-fixture", email: "fixture@example.test", model, accessToken: liveProbe?.accessToken ?? "army-chatgpt-fixture",
    expiresAt: liveProbe?.expiresAt ?? Date.now() + 3_600_000, scopes: ["chatgpt.tokens.use.direct"] }] }), { mode: 0o600, flag: "wx" });
  fixtureStore = file;
}

test("ChatGPT local: uploaded takeoff uses the creator plan and persists quantities", {
  tags: ["critical", "local", "chatgpt"], session: "army", timeout: 180_000,
}, async ({ app, screen, browser }) => {
  await preparePlanFixture();
  const model = liveProbe?.model ?? "army-plan-model";
  const account = credentials.user("army");
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
    inclusions: "Toutes les lignes du fichier", levels: "Tous", zones: "Toutes", exclusions: "" }, browser.locator("form").last());
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
  expect((await readFile(transportLog, "utf8")).trim().split("\n").map(line => JSON.parse(line))).toEqual([
    { provider: liveProbe ? "chatgpt-live" : "chatgpt-fixture", model, sourceMatched: true },
  ]);
  await recordEvidence(army, "chatgpt-takeoff", { ids, jobId, provider: "chatgpt", model: detail.job.model,
    quantity: 12.5, tokenCount: detail.job.metrics.token_count, livePlanInference: Boolean(liveProbe),
    transport: liveProbe ? "Live OpenAI Responses using authorized short-lived plan token; Gemini and Edge dispatch forbidden."
      : "Explicit fixture; real UI, Storage, worker, schema and persistence." });
});


test("ChatGPT local: PDF plan uses the chosen subscription provider and persists measured quantities", {
  tags: ["critical", "local", "chatgpt"], session: "army", timeout: 240_000,
}, async ({ app, screen, browser }) => {
  await preparePlanFixture();
  const account = credentials.user("army");
  await app.open(`${localOrigin}/login`);
  await screen.getByRole("button", "Afficher le mot de passe", { exact: true }).tap();
  await screen.getByLabel("Email", { exact: true }).fill(account.username);
  await screen.getByLabel(/Mot de passe/).fill(account.password);
  await screen.getByRole("button", "Se connecter", { exact: true }).tap();
  await expect(browser).toHaveURL(/\/dashboard/);
  const prefix = `ARMY-chatgpt-pdf-${Date.now()}`;
  const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
  const ui = { app: { ...app, open: (url: string) => app.open(new URL(url, localOrigin).href) } as typeof app, screen, browser };
  const ids = await createEstimateViaWizard(ui, { projectName: prefix, title: "Métré PDF forfait local" }, army);
  const file = path.resolve("e2e/fixtures/takeoff/army-chatgpt-plan.pdf");
  const truth = JSON.parse(await readFile(path.resolve("e2e/fixtures/takeoff/army-chatgpt-plan.expected.json"), "utf8"));
  expect(createHash("sha256").update(await readFile(file)).digest("hex")).toBe(truth.sha256);
  await ui.app.open(`/dashboard/estimates/${ids.versionId}/takeoff/new`);
  const source = screen.getByLabel("Fichier source", { exact: true });
  await expect(source).toBeEnabled();
  await source.setInputFiles(file);
  await expect(screen.getByText(path.basename(file), { exact: true })).toBeVisible();
  await screen.getByText("Options avancées du traitement", { exact: true }).click();
  await screen.getByRole("radio", /Niveau C/).check();
  const picker = screen.getByLabel("Fournisseur IA", { exact: true });
  await expect(picker).toBeVisible();
  await picker.selectOption({ value: "gemini" });
  await picker.selectOption({ value: "chatgpt" });
  await expect(picker).toHaveValue("chatgpt");
  await fillTakeoffPreparation({ ...ui, army }, { sources: [path.basename(file)], objective: "extract_quantities", unit: "Unités des lignes sources",
    inclusions: "Toutes les quantités documentées", levels: "Tous", zones: "Toutes", exclusions: "" }, browser.locator("form").last());
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
    { provider: liveProbe ? "chatgpt-live" : "chatgpt-fixture", model: detail.job.model, sourceMatched: true, inputKind: "pdf" },
  ]);
  await recordEvidence(army, "chatgpt-pdf-takeoff", { ids, jobId, provider: "chatgpt", model: detail.job.model,
    expected: truth.expected, actual: detail.items.data.map(item => ({ designation: item.designation, quantity: item.quantity, unit: item.unit, sourcePage: item.source_page })),
    tokenCount: detail.job.metrics.token_count, livePlanInference: Boolean(liveProbe), geminiRequests: 0, inputKind: "pdf" });
});
