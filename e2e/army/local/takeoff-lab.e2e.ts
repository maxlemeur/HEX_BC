import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createServerClient } from "@supabase/ssr";
import { afterAll, beforeAll, test, type Browser } from "@e2e-dev/web";
import { credentials, expect } from "e2e";

import { LAB_DATASET_LAYOUT } from "@/lib/takeoff/lab/contracts";
import { apiRequest } from "../critical/fixtures";
import { querySql } from "./calculation-gate-support";
import { createLocalChatGptOwner, prepareChatGptServerWorkspace } from "./chatgpt-server-support";

// Takeoff lab (TI-661), on the owned local stack and the local ChatGPT server
// (scripts/dev-chatgpt-local.mjs on 127.0.0.1) with the ARMY provider fixture:
// no real ChatGPT or Decisions call. TAKEOFF_LAB_DATASET_DIR is a fictional
// dataset built here from e2e/fixtures/takeoff/army-chatgpt-plan.pdf, never the
// private one; TAKEOFF_LAB_OUTPUT_DIR starts empty. Both live under
// .e2e/army/critical/artifacts/<id>/. The journeys assert the stored files, not
// only the screen: runs, verdicts and stats are read back from the output.

let server: ChildProcess;
let origin: string;
let port: number;
let owner: { email: string; userId: string; tenantId: string };
let store: string | undefined;
let artifacts: string;
let datasetDir: string;
let outputDir: string;
let transportLog: string;
let workspace: Awaited<ReturnType<typeof prepareChatGptServerWorkspace>> | undefined;
const diagnostics: string[] = [];
const DOCUMENT = "army-chatgpt-plan";
const MAIN_CAMPAIGN = `${DOCUMENT}-e2e`;
const CHOICE_CAMPAIGN = "lot-technique-e2e";
const LAB = "/dashboard/admin/takeoff/lab";

async function tenantOf(email: string) {
  const cookies = await sessionCookies(email);
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => [...cookies.jar].map(([name, value]) => ({ name, value })), setAll: () => undefined },
  });
  const user = (await client.auth.getUser()).data.user!;
  const membership = await client.from("tenant_memberships").select("tenant_id").eq("user_id", user.id).eq("is_default", true).single();
  if (membership.error) throw new Error("The lab fixture owner has no default tenant.");
  return membership.data.tenant_id as string;
}

/** Supabase SSR cookies of a local account, as the browser would hold them; nothing is logged. */
async function sessionCookies(email: string) {
  const jar = new Map<string, string>();
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (values) => { for (const { name, value } of values) jar.set(name, value); } },
  });
  const login = await client.auth.signInWithPassword({ email, password: process.env.E2E_LOGIN_PASSWORD! });
  if (login.error) throw new Error("Lab fixture login failed.");
  return { jar, header: [...jar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ") };
}

/** A request with an explicit Host header (fetch cannot set one), to prove the host check. */
function rawRequest(input: { method: string; path: string; host: string; cookie?: string; body?: unknown; origin?: string; contentType?: string }) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const payload = input.body === undefined ? undefined : JSON.stringify(input.body);
    const request = httpRequest({ host: "127.0.0.1", port, method: input.method, path: input.path,
      headers: { host: input.host, ...(input.cookie ? { cookie: input.cookie } : {}), ...(input.origin ? { origin: input.origin } : {}),
        ...(payload ? { "content-type": input.contentType ?? "application/json" } : {}) } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
    });
    request.on("error", reject);
    request.setTimeout(120_000, () => request.destroy(new Error("Lab request timed out.")));
    request.end(payload);
  });
}

async function readTransport() {
  return (await readFile(transportLog, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function storedRuns() {
  const directory = path.join(outputDir, "runs");
  const files = (await readdir(directory).catch(() => [])).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(files.map(async (name) => ({ name, mode: (await stat(path.join(directory, name))).mode & 0o777,
    run: JSON.parse(await readFile(path.join(directory, name), "utf8")) })));
}

async function storedVerdicts(campaign: string) {
  const directory = path.join(outputDir, "verdicts", campaign);
  const files = (await readdir(directory).catch(() => [])).filter((name) => name.endsWith(".json"));
  return Promise.all(files.map(async (name) => ({ name, mode: (await stat(path.join(directory, name))).mode & 0o777,
    verdict: JSON.parse(await readFile(path.join(directory, name), "utf8")) })));
}

async function noPageScroll(browser: Browser) {
  const [scrollHeight, innerHeight] = await browser.evaluate(() => [document.scrollingElement!.scrollHeight, window.innerHeight]);
  expect(scrollHeight).toBeLessThanOrEqual(innerHeight);
}

beforeAll(async () => {
  // The campaign's disposable local backend only, never ambient .env credentials.
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(backend.hostname)) throw new Error("Local backend required.");
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", resolve); });
  const address = reservation.address();
  if (!address || typeof address === "string") throw new Error("Port reservation failed.");
  port = address.port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  origin = `http://127.0.0.1:${port}`;
  const created = await createLocalChatGptOwner();
  owner = { email: created.email, userId: created.userId, tenantId: await tenantOf(created.email) };
  workspace = await prepareChatGptServerWorkspace();
  artifacts = path.resolve(".e2e/army/critical/artifacts", workspace.id);
  datasetDir = path.join(artifacts, "dataset");
  outputDir = path.join(artifacts, "output");
  transportLog = path.join(artifacts, "chatgpt-transport.jsonl");
  const decisionsControl = path.join(artifacts, "decisions-control.json");
  const pdf = path.join(datasetDir, LAB_DATASET_LAYOUT.raw(DOCUMENT));
  const truth = path.join(datasetDir, LAB_DATASET_LAYOUT.lineTruth(DOCUMENT));
  await mkdir(path.dirname(pdf), { recursive: true });
  await mkdir(path.dirname(truth), { recursive: true });
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  await copyFile(path.resolve("e2e/fixtures/takeoff/army-chatgpt-plan.pdf"), pdf);
  const bytes = await readFile(pdf);
  await writeFile(path.join(datasetDir, LAB_DATASET_LAYOUT.manifest), JSON.stringify({ schema_version: 1, documents: [{
    id: DOCUMENT, file_type: "pdf", raw_status: "binary", raw_path: LAB_DATASET_LAYOUT.raw(DOCUMENT), file_size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"), pages: 1, kind: "plan", role: "truth",
  }] }));
  // Whole designations: « cuivre » alone would match « Tuyauterie cuivre DN20 » at 0.5 < 0.8.
  await writeFile(truth, JSON.stringify({ schema_version: 1, document: DOCUMENT, items: [
    { designation: "Tuyauterie cuivre DN20", quantity: 12.5, unit: "m" },
    { designation: "Vanne isolement DN20", quantity: 4, unit: "u" },
  ] }));
  await writeFile(transportLog, "");
  const temporary = `${decisionsControl}.tmp`;
  await writeFile(temporary, JSON.stringify({ hold: false, timeoutWriting: false }));
  await rename(temporary, decisionsControl);
  // The owner's own ChatGPT profile, with a model and no effort (the lab never writes it).
  const key = createHash("sha256").update(JSON.stringify([owner.userId, owner.tenantId])).digest("hex");
  await mkdir(path.resolve(".private/chatgpt-local"), { recursive: true, mode: 0o700 });
  store = path.resolve(".private/chatgpt-local", `${key}.json`);
  const profileId = randomUUID();
  await writeFile(store, JSON.stringify({ selectedId: profileId, profiles: [{ id: profileId, clientId: "army-fixture", issuer: "https://auth.openai.com",
    subject: "army-fixture", email: "fixture@example.test", model: "army-plan-model", reasoningEffort: null, accessToken: "army-chatgpt-fixture",
    expiresAt: Date.now() + 3_600_000, scopes: ["chatgpt.tokens.use.direct"] }] }), { mode: 0o600, flag: "wx" });
  server = spawn(process.execPath, ["scripts/dev-chatgpt-local.mjs", "--port", String(port), "--webpack"], {
    cwd: process.cwd(), env: { ...process.env, CI: "", VERCEL: "", NODE_ENV: "development", E2E_ARMY_SERVER_MODE: "development", ...workspace.environment,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(path.resolve("e2e/army/local/chatgpt-provider-fixture.mjs")).href}`,
      ARMY_CHATGPT_TRANSPORT_LOG: transportLog, GEMINI_API_KEY: "army-disabled-provider-fixture", TAKEOFF_WORKER_SECRET: "army-worker-fixture",
      MERGEONE_OPENAI_DECISIONS: "1", OPENAI_DECISIONS_API_KEY: "army-decisions-fixture", ARMY_DECISIONS_CONTROL: decisionsControl,
      TAKEOFF_LAB_DATASET_DIR: datasetDir, TAKEOFF_LAB_OUTPUT_DIR: outputDir, TAKEOFF_LAB_DECISIONS_MAX_TOKENS: "",
      TAKEOFF_LAB_BENCH_REPORTS_DIR: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [server.stdout, server.stderr]) stream?.on("data", (chunk) => {
    diagnostics.push(String(chunk).replace(/code=[^&\s]+/g, "code=[redacted]"));
    if (diagnostics.length > 100) diagnostics.shift();
  });
  await expect.poll(async () => {
    if (server.exitCode !== null) throw new Error("Lab server exited before readiness.");
    return fetch(`${origin}/favicon.ico`).then((response) => response.ok).catch(() => false);
  }, { timeout: 90_000 }).toBe(true);
  await workspace.assertReady();
  // Compile the lab's pages and routes before the journeys, in one batch.
  const { header } = await sessionCookies(owner.email);
  const warm = await Promise.all([`${LAB}`, `${LAB}/verdicts`, `${LAB}/stats`, "/api/admin/takeoff/lab", "/api/admin/takeoff/lab/models",
    `/api/admin/takeoff/lab/documents/${DOCUMENT}`, "/api/admin/takeoff/lab/runs", "/api/admin/takeoff/lab/stats", "/api/admin/takeoff/lab/bench-reports",
    `/api/admin/takeoff/lab/campaigns/${MAIN_CAMPAIGN}`, "/dashboard", "/login"]
    // The login page is compiled anonymously: a signed-in session is redirected from it.
    .map((pathname) => fetch(new URL(pathname, origin), { headers: pathname === "/login" ? {} : { cookie: header }, redirect: "manual",
      signal: AbortSignal.timeout(120_000) }).then(async (response) => { await response.arrayBuffer(); return [pathname, response.status] as const; })));
  expect(warm.filter(([, status]) => status !== 200)).toEqual([]);
});

afterAll(async () => {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise<void>((resolve) => server.once("exit", () => resolve()));
  }
  if (store) await rm(store, { force: true });
  if (artifacts) {
    const timings = diagnostics.join("").split("\n").filter((line) =>
      /(?:Compiling|Ready in|exited|FATAL ERROR|heap limit|out of memory|(?:GET|POST|PUT) \/(?:dashboard|api\/admin\/takeoff\/lab)(?:[/? ]))/.test(line));
    await writeFile(path.join(artifacts, `takeoff-lab-server-${port}.log`), timings.join("\n")).catch(() => undefined);
  }
  await workspace?.cleanup();
});


test("LAB01 lab compares two efforts, records keyboard verdicts and reads its stats back", {
  tags: ["critical", "local", "chatgpt", "takeoff-lab"], session: "army", timeout: 300_000,
}, async ({ app, screen, browser }) => {
  const account = { ...credentials.user("army"), username: owner.email };
  await browser.setViewport({ width: 1440, height: 900 });
  await app.open(`${origin}/login`);
  await screen.getByLabel("Email", { exact: true }).fill(account.username);
  await screen.getByLabel(/Mot de passe/).fill(account.password);
  await screen.getByRole("button", "Se connecter", { exact: true }).tap();
  await expect(browser).toHaveURL(/\/dashboard/);
  const transportStart = (await readTransport()).length;

  await app.open(`${origin}${LAB}`);
  await expect(screen.getByRole("heading", "Labo métré")).toBeVisible();
  await expect(screen.getByText("Dataset configuré", { exact: true })).toBeVisible();
  await noPageScroll(browser);
  await screen.getByLabel("Document", { exact: true }).selectOption({ value: DOCUMENT });
  await screen.getByLabel("Campagne", { exact: true }).fill(MAIN_CAMPAIGN);
  await expect(screen.getByRole("radio", "Extraction ChatGPT (niveau C)", { exact: false })).toBeChecked();
  // The efforts come from the account's model list (fixture: low and high), never from the profile.
  await expect.poll(() => browser.evaluate(() => [...document.querySelectorAll("select")].some((select) =>
    [...select.options].some((option) => option.value === "high"))), { timeout: 30_000 }).toBe(true);
  await screen.getByRole("group", "Configuration A").getByLabel("Effort").selectOption({ value: "low" });
  await screen.getByRole("button", "Ajouter une configuration").click();
  await screen.getByRole("group", "Configuration B").getByLabel("Effort").selectOption({ value: "high" });
  const [launched] = await Promise.all([browser.waitForResponse("**/api/admin/takeoff/lab/runs", { timeout: 120_000 }),
    screen.getByRole("button", "Lancer · 2 configurations").click()]);
  expect(launched.status).toBe(201);

  for (const [id, effort] of [["A", "low"], ["B", "high"]] as const) {
    const column = screen.getByRole("region", `Configuration ${id} · army-plan-model · ${effort}`);
    await expect(column).toContainText("Terminé");
    await expect(column).toContainText("Précision 1,00 · Rappel 1,00 · Quantités 1,00");
    await expect(column.getByRole("list", `Éléments ${id}`).getByRole("listitem")).toHaveCount(2);
    await expect(column).toContainText("Tuyauterie cuivre DN20");
  }
  // Both efforts reached the provider, each with the whole PDF; the profile (no effort) was not used.
  const sent = (await readTransport()).slice(transportStart).filter((entry) => entry.provider === "chatgpt-fixture");
  expect(sent.map((entry) => [entry.model, entry.reasoningEffort, entry.inputKind])).toEqual([
    ["army-plan-model", "low", "pdf"], ["army-plan-model", "high", "pdf"],
  ]);
  const profile = JSON.parse(await readFile(store!, "utf8"));
  expect(profile.profiles[0]).toMatchObject({ model: "army-plan-model", reasoningEffort: null });

  const runs = await storedRuns();
  expect(runs).toHaveLength(1);
  expect(runs[0].mode).toBe(0o600);
  expect((await stat(path.join(outputDir, "runs"))).mode & 0o777).toBe(0o700);
  const run = runs[0].run;
  expect(run).toMatchObject({ campaign: MAIN_CAMPAIGN, status: "complete", crop: null,
    task: { id: "extraction-niveau-c", kind: "extraction" }, document: { id: DOCUMENT, source: "dataset", pages: 1 },
    author: { user_id: owner.userId }, prompt: { base: "takeoff-c-v1" } });
  expect(run.prompt.version).toBe(`takeoff-c-v1+${createHash("sha256").update(run.prompt.text).digest("hex")}`);
  expect(run.configs.map((config: { id: string; reasoning_effort: string; status: string; elements: unknown[]; usage: { total: number };
    score: { precision: number; recall: number; matched: number } }) => [config.id, config.reasoning_effort, config.status, config.elements.length,
    config.usage.total, config.score.precision, config.score.recall, config.score.matched]))
    .toEqual([["A", "low", "ok", 2, 42, 1, 1, 2], ["B", "high", "ok", 2, 42, 1, 1, 2]]);
  const elementId = (configId: string, index: number) => createHash("sha256").update(JSON.stringify([run.id, configId, "item", index])).digest("hex");
  expect(run.configs[0].elements.map((element: { id: string }) => element.id)).toEqual([elementId("A", 0), elementId("A", 1)]);
  await expect(screen.getByRole("status", "Chargement du plan")).toBeHidden();
  const essaiScreenshot = await app.screenshot("takeoff-lab-essai-1440");

  // Verdicts at the keyboard: G, G, B on the first three of the four elements.
  await screen.getByRole("link", "Verdicts").click();
  await expect(browser).toHaveURL(/\/dashboard\/admin\/takeoff\/lab\/verdicts$/);
  const progress = (text: string) => expect(screen.getByRole("status").filter({ hasText: "évalués" })).toHaveText(text);
  await progress("0 / 4 évalués · 0 bon · 0 pas bon · 4 à parcourir");
  await noPageScroll(browser);
  await browser.keyboard.press("g");
  await progress("1 / 4 évalués · 1 bon · 0 pas bon · 3 à parcourir");
  await browser.keyboard.press("g");
  await progress("2 / 4 évalués · 2 bons · 0 pas bon · 2 à parcourir");
  await browser.keyboard.press("b");
  await progress("3 / 4 évalués · 2 bons · 1 pas bon · 1 à parcourir");
  const verdicts = await storedVerdicts(MAIN_CAMPAIGN);
  expect(verdicts.map(({ name, mode, verdict }) => [name, mode, verdict.verdict, verdict.reasoning_effort]).sort()).toEqual([
    [`${elementId("A", 0)}.json`, 0o600, "good", "low"], [`${elementId("A", 1)}.json`, 0o600, "good", "low"],
    [`${elementId("B", 0)}.json`, 0o600, "bad", "high"],
  ].sort());
  for (const { verdict } of verdicts) {
    expect(verdict).toMatchObject({ campaign: MAIN_CAMPAIGN, task: "extraction-niveau-c", model: "army-plan-model", provider: "chatgpt",
      author: { user_id: owner.userId }, prompt_version: run.prompt.version, document_id: DOCUMENT, document_sha256: run.document.sha256, run_id: run.id });
    expect(Number.isFinite(Date.parse(verdict.at))).toBe(true);
  }
  await browser.reload();
  await progress("3 / 4 évalués · 2 bons · 1 pas bon · 1 à parcourir");
  await expect(screen.getByRole("article", "Élément à juger")).toContainText("Vanne isolement DN20");
  await expect(screen.getByRole("status", "Chargement du plan")).toBeHidden();
  const verdictsScreenshot = await app.screenshot("takeoff-lab-verdicts-1440");

  // Stats read back from the output: low 2 good of 2, high 0 good of 1.
  await screen.getByRole("link", "Stats").click();
  const bars = screen.getByRole("list", "Part jugée bonne par configuration");
  await expect(bars.getByRole("listitem")).toHaveCount(2);
  // Row by row: « 100 % » must not satisfy the « 0 % » of the other configuration.
  await expect(bars.getByRole("listitem").filter({ hasText: "army-plan-model · low" }).getByText(/^100\s%\s·\sn = 2$/)).toBeVisible();
  await expect(bars.getByRole("listitem").filter({ hasText: "army-plan-model · high" }).getByText(/^0\s%\s·\sn = 1$/)).toBeVisible();
  const stats = await apiRequest<{ data: { groups: Array<{ label: string; good: number; bad: number; judged: number; rate: number }> } }>(
    browser, "GET", `/api/admin/takeoff/lab/stats?campaign=${MAIN_CAMPAIGN}`);
  expect(stats.body.data.groups.map((group) => [group.label, group.good, group.bad, group.judged, group.rate])).toEqual([
    ["army-plan-model · low", 2, 0, 2, 1], ["army-plan-model · high", 0, 1, 1, 0],
  ]);
  await noPageScroll(browser);
  await screen.getByRole("button", /army-plan-model · low.*100\s%/).hover();
  await expect(screen.getByText("Sur la frontière de Pareto", { exact: true })).toBeVisible();
  // The capture waits for the end of the tooltip's fade-in.
  await expect.poll(() => browser.evaluate(() => getComputedStyle(document.querySelector("[data-slot=tooltip-content]")!).opacity)).toBe("1");
  const statsScreenshot = await app.screenshot("takeoff-lab-stats-tooltip-1440");

  await browser.setViewport({ width: 1920, height: 1080 });
  await noPageScroll(browser);
  const wideStats = await app.screenshot("takeoff-lab-stats-1920");
  await screen.getByRole("link", "Essai").click();
  await expect(screen.getByRole("button", /Lancer/)).toBeVisible();
  await noPageScroll(browser);
  await screen.getByRole("button", /Historique et comparaison · 1 rapport/).click();
  await expect(screen.getByRole("region", "Historique et comparaison")).toContainText(MAIN_CAMPAIGN);
  await expect(screen.getByRole("status", "Chargement du plan")).toBeHidden();
  await noPageScroll(browser);
  const wideEssai = await app.screenshot("takeoff-lab-essai-history-1920");
  await writeFile(path.join(artifacts, "lab01-evidence.json"), JSON.stringify({ runId: run.id, runFile: runs[0].name, verdicts: verdicts.length,
    screenshots: { essaiScreenshot, verdictsScreenshot, statsScreenshot, wideStats, wideEssai } }, null, 2));
});

test("LAB02 a Decisions choice shows its probabilities and a ChatGPT schema error stays judgeable", {
  tags: ["critical", "local", "chatgpt", "takeoff-lab"], session: "army", timeout: 240_000,
}, async ({ app, screen, browser }) => {
  const account = { ...credentials.user("army"), username: owner.email };
  await browser.setViewport({ width: 1440, height: 900 });
  await app.open(`${origin}/login`);
  await screen.getByLabel("Email", { exact: true }).fill(account.username);
  await screen.getByLabel(/Mot de passe/).fill(account.password);
  await screen.getByRole("button", "Se connecter", { exact: true }).tap();
  await expect(browser).toHaveURL(/\/dashboard/);
  const transportStart = (await readTransport()).length;
  const runsBefore = (await storedRuns()).length;

  await app.open(`${origin}${LAB}`);
  await screen.getByLabel("Document", { exact: true }).selectOption({ value: DOCUMENT });
  await screen.getByLabel("Campagne", { exact: true }).fill(CHOICE_CAMPAIGN);
  await screen.getByRole("radio", "Lot technique du plan (question choice)", { exact: false }).check();
  await expect(screen.getByRole("group", "Configuration A").getByLabel("Fournisseur")).toHaveValue("decisions");
  await screen.getByRole("button", "Ajouter une configuration").click();
  const configB = screen.getByRole("group", "Configuration B");
  await configB.getByLabel("Fournisseur").selectOption({ value: "chatgpt" });
  await configB.getByLabel("Modèle").selectOption({ value: "army-plan-model" });
  // Decisions reads a rendered page: « Lancer » stays disabled until the canvas has loaded the plan (TI-673).
  await expect(screen.getByRole("button", "Lancer · 2 configurations")).toBeEnabled({ timeout: 30_000 });
  const [launched] = await Promise.all([browser.waitForResponse("**/api/admin/takeoff/lab/runs", { timeout: 120_000 }),
    screen.getByRole("button", "Lancer · 2 configurations").click()]);
  expect(launched.status).toBe(201);

  const decisions = screen.getByRole("region", "Configuration A · Decisions · gpt-6-luna");
  await expect(decisions).toContainText("Terminé");
  const bars = decisions.getByRole("list", "Probabilités · Lot technique");
  await expect(bars.getByRole("listitem")).toHaveCount(6);
  await expect(bars.getByRole("listitem").first()).toContainText(/Plomberie.*100\s%/);
  const chatgpt = screen.getByRole("region", "Configuration B · army-plan-model · auto");
  await expect(chatgpt).toContainText("Erreur de schéma");
  // The raw answer stays readable even though it failed the choice schema.
  await expect(chatgpt).toContainText("Tuyauterie cuivre DN20");
  await expect(screen.getByText(/Decisions 1 \/ 2\s000\s000 jetons/)).toBeVisible();

  const sent = (await readTransport()).slice(transportStart);
  expect(sent.filter((entry) => entry.provider === "decisions-fixture")).toEqual([{ provider: "decisions-fixture", questions: 1 }]);
  expect(sent.filter((entry) => entry.provider === "chatgpt-fixture").map((entry) => [entry.model, entry.reasoningEffort ?? null, entry.inputKind]))
    .toEqual([["army-plan-model", null, "pdf"]]);
  const runs = await storedRuns();
  expect(runs).toHaveLength(runsBefore + 1);
  const run = runs.map((entry) => entry.run).find((entry) => entry.campaign === CHOICE_CAMPAIGN);
  expect(run.prompt.base).toBeNull();
  const [decisionsConfig, chatgptConfig] = run.configs;
  expect(decisionsConfig).toMatchObject({ provider: "decisions", model: "gpt-6-luna", reasoning_effort: null, status: "ok",
    usage: { total: 1 }, answers: [{ name: "lot_technique", status: "answered", value: "plomberie", confidence: 0.8 }] });
  expect(decisionsConfig.answers[0].probabilities).toHaveLength(6);
  expect(decisionsConfig.answers[0].probabilities[0]).toEqual({ value: "plomberie", label: "Plomberie", probability: 1 });
  expect(chatgptConfig).toMatchObject({ provider: "chatgpt", status: "schema_error", usage: { total: 42 }, schema_error: { name: "ZodError" } });
  expect(chatgptConfig.raw).toContain("Tuyauterie cuivre DN20");
  expect(chatgptConfig.elements).toHaveLength(1);
  expect(chatgptConfig.elements[0]).toMatchObject({ kind: "question", key: "lot_technique", schema_error: true });
  const state = await apiRequest<{ data: { decisions: { budget: { used: number; calls_without_usage: number } } } }>(browser, "GET", "/api/admin/takeoff/lab");
  expect(state.body.data.decisions.budget).toMatchObject({ used: 1, calls_without_usage: 0 });

  // Both answers are elements of the campaign: the schema error is judged like any answer.
  await screen.getByRole("link", "Verdicts").click();
  await expect(browser).toHaveURL(/\/dashboard\/admin\/takeoff\/lab\/verdicts$/);
  const heading = screen.getByRole("heading", "Un résultat. Votre verdict.");
  await expect(heading).toBeVisible();
  await screen.getByLabel("Campagne", { exact: true }).selectOption({ value: CHOICE_CAMPAIGN });
  // Leave the select: the shortcuts are ignored while a field has the focus.
  await heading.click();
  await expect(screen.getByRole("status").filter({ hasText: "évalués" })).toHaveText("0 / 2 évalués · 0 bon · 0 pas bon · 2 à parcourir");
  await browser.keyboard.press("s");
  await expect(screen.getByRole("status").filter({ hasText: "évalués" })).toHaveText("0 / 2 évalués · 0 bon · 0 pas bon · 1 à parcourir");
  await expect(screen.getByRole("article", "Élément à juger")).toContainText("Erreur de schéma");
  await browser.keyboard.press("b");
  await expect(screen.getByRole("status").filter({ hasText: "évalués" })).toHaveText("1 / 2 évalués · 0 bon · 1 pas bon · 0 à parcourir");
  await browser.keyboard.press("Escape");
  await expect(screen.getByRole("status").filter({ hasText: "évalués" })).toHaveText("0 / 2 évalués · 0 bon · 0 pas bon · 1 à parcourir");
  expect(await storedVerdicts(CHOICE_CAMPAIGN)).toEqual([]);
  const screenshot = await app.screenshot("takeoff-lab-decisions-1440");
  await writeFile(path.join(artifacts, "lab02-evidence.json"), JSON.stringify({ runId: run.id, screenshot }, null, 2));
});

test("LAB03 the lab refuses another host, a non-admin member and an anonymous request", {
  tags: ["critical", "local", "chatgpt", "takeoff-lab"], timeout: 120_000,
}, async () => {
  const runsBefore = (await storedRuns()).length;
  const admin = await sessionCookies(owner.email);
  const routes = [
    { method: "GET", path: "/api/admin/takeoff/lab" },
    { method: "GET", path: `/api/admin/takeoff/lab/documents/${DOCUMENT}` },
    { method: "POST", path: "/api/admin/takeoff/lab/runs", body: { documentId: DOCUMENT, campaign: "refused", taskId: "extraction-niveau-c", crop: null,
      prompt: "x", configs: [{ provider: "chatgpt", model: "army-plan-model", reasoningEffort: null }], image: null } },
    { method: "PUT", path: `/api/admin/takeoff/lab/campaigns/${MAIN_CAMPAIGN}/verdicts/${"0".repeat(64)}`, body: { verdict: "good" } },
    { method: "POST", path: `/api/admin/takeoff/lab/campaigns/${MAIN_CAMPAIGN}/undo` },
  ];
  // The same admin session from another host than 127.0.0.1.
  for (const host of [`localhost:${port}`, `192.168.1.20:${port}`]) {
    for (const route of routes) {
      const response = await rawRequest({ ...route, host, cookie: admin.header });
      expect([route.path, host, response.status, JSON.parse(response.body).error?.code]).toEqual([route.path, host, 403, "TAKEOFF_LAB_LOCAL_ONLY"]);
    }
  }
  const page = await rawRequest({ method: "GET", path: LAB, host: `localhost:${port}`, cookie: admin.header });
  expect(page.body).toContain("Labo métré indisponible");
  expect(page.body).not.toContain("Résultats bruts");
  // A member of their tenant who is not its admin.
  const member = await createLocalChatGptOwner();
  await querySql(`update public.tenant_memberships set role='engineer' where user_id='${member.userId}';`);
  const engineer = await sessionCookies(member.email);
  for (const route of routes) {
    const response = await rawRequest({ ...route, host: `127.0.0.1:${port}`, cookie: engineer.header });
    expect([route.path, response.status, JSON.parse(response.body).error?.code]).toEqual([route.path, 403, "TAKEOFF_LAB_ADMIN_ONLY"]);
    const anonymous = await rawRequest({ ...route, host: `127.0.0.1:${port}` });
    expect([route.path, anonymous.status]).toEqual([route.path, 403]);
  }
  const memberPage = await rawRequest({ method: "GET", path: LAB, host: `127.0.0.1:${port}`, cookie: engineer.header });
  expect(memberPage.body).toContain("réservé aux administrateurs");
  // The admin's own session, from another page of 127.0.0.1 (same-site cookies): writes need the lab's origin.
  const writes = routes.filter((route) => route.method !== "GET");
  for (const foreign of [undefined, `http://127.0.0.1:${port + 1}`, `http://localhost:${port}`]) {
    for (const route of writes) {
      const response = await rawRequest({ ...route, host: `127.0.0.1:${port}`, cookie: admin.header, origin: foreign });
      expect([route.path, foreign ?? null, response.status, JSON.parse(response.body).error?.code])
        .toEqual([route.path, foreign ?? null, 403, "TAKEOFF_LAB_ORIGIN"]);
    }
  }
  // The lab's own origin with a non-JSON body (a « simple » cross-site form or fetch would send text/plain).
  const textPlain = await rawRequest({ ...writes[0], host: `127.0.0.1:${port}`, cookie: admin.header, origin, contentType: "text/plain" });
  expect([textPlain.status, JSON.parse(textPlain.body).error?.message]).toEqual([400, "Corps JSON requis (application/json)."]);
  // Refused requests wrote nothing.
  expect((await storedRuns()).length).toBe(runsBefore);
  expect(await storedVerdicts("refused")).toEqual([]);
});
