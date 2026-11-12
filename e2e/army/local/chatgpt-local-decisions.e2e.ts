import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { afterAll, beforeAll, test } from "@e2e-dev/web";
import { expect } from "e2e";

import {
  apiRequest, createEstimateViaWizard, createLineViaApi, readEstimate, recordEvidence, restrictCriticalBrowser,
} from "../critical/fixtures";
import { hydratedUi, signIn, waitForHydration } from "../critical/hydration-support";
import { fillTakeoffPreparation, saveTakeoffPreparation } from "../critical/preparation-support";
import { createPlanSet, readPlanFiles, readPlanSets, uploadSamplePlan } from "../critical/plans-support";
import type { TakeoffPreparation } from "@/lib/takeoff/preparation";
import {
  chatGptLocalServer, isAbsorbedClientAbort, LAB_VECTOR_DOCUMENT, liveProbePath, localChatGptClient, writeDecisionsControl, writePlanFixture,
  type ChatGptLiveProbe,
} from "./chatgpt-local-journey-support";
import { createLocalChatGptOwner } from "./chatgpt-server-support";
import { verifyPriceReuseArbitration } from "./engine-v3-price-reuse-support";
import { querySql } from "./calculation-gate-support";
import { LAB_VECTOR_PLAN } from "./lab-vector-plan-fixture";
import { labSessionCookies, rawLabRequest } from "./takeoff-lab-support";

// The assistance of the ChatGPT local journeys, on this file's own development server: the Decisions proposals of
// the preparation (DEC01, TRI01), the lab's vectors page (VEC01), the price reuse arbitration (PRX02) and the intake
// reanalysis (INTRETRY01, INTWORD01). The takeoff jobs run in chatgpt-local-takeoff.e2e.ts, on a second server
// (chatgpt-local-journey-support.ts says why they are two files). Each test that needs a ChatGPT profile writes its
// own and removes it: DEC01 starts without one, and the lab's output holds the runs of VEC01 alone.
const server = chatGptLocalServer();
let localOrigin: string;
let fixtureStore: string | undefined;
let liveProbe: ChatGptLiveProbe | null = null;
let transportLog: string;
let decisionsControl: string;
let fixtureEmail: string;
let labOutputDir: string;
// The intake journeys wait for work of their own development server: a page refresh after a reclassification, an
// analysis of each piece. A CI runner shares its processors with the second worker and the built application: the
// same requests that answer in under a second locally took 11 to 15 s there (run 42822760346, both attempts, and
// 13.2 s in the green run 42822852964), the whole default assertion budget. The outcome asserted stays the same.
const DEV_SERVER_WORK = { timeout: 60_000 };
const localClient = () => localChatGptClient(fixtureEmail);
const setDecisionsControl = (input: { hold?: boolean; timeoutWriting?: boolean }) => writeDecisionsControl(decisionsControl, input);
/** Writes the owner's temporary ChatGPT profile unless a test of this file already left one. */
async function preparePlanFixture(unsetPreferences = false) {
  if (fixtureStore) return false;
  fixtureStore = await writePlanFixture(fixtureEmail, liveProbe, unsetPreferences);
  return true;
}

beforeAll(async () => {
  ({ origin: localOrigin, email: fixtureEmail, liveProbe, transportLog, decisionsControl, labOutputDir } = await server.start());
});

afterAll(() => server.stop(fixtureStore));

// This test uses a fictional Decisions response on an owned backend. It never calls the paid API.
if (!existsSync(liveProbePath)) test("DEC01 Decisions classifications are visible for review without changing the preparation", {
  tags: ["critical", "local", "chatgpt", "premetre"], session: "army", timeout: 180_000,
}, async ({ app, screen, browser }) => {
  // Count only this scenario's Decisions calls.
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

  // Development aliases work; non-admin members and anonymous requests remain refused.
  const otherHost = await rawLabRequest(port, { method: "GET", path: vectorsApi, host: `localhost:${port}`, cookie: admin.header });
  expect(otherHost.status).toBe(200);
  const otherHostPage = await rawLabRequest(port, { method: "GET", path: `${lab}/vectors`, host: `localhost:${port}`, cookie: admin.header });
  expect(otherHostPage.body).not.toContain("Labo métré indisponible");
  expect(otherHostPage.body).toContain("Classer avec Decisions");
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

// Assistant (lot 1): a question asked in the estimate editor is answered from what the application's engine computed,
// streamed with the reads it took, cited by line, and kept in a conversation private to its author. The provider is
// the fixture: it proves the loop, the rights and the persistence, not the quality of a real model's answer.
if (!existsSync(liveProbePath)) test("ASSIST01 the assistant answers in the estimate editor from the engine's amounts and keeps the conversation", {
  tags: ["critical", "local", "chatgpt"], session: "army", timeout: 420_000,
}, async ({ app, screen, browser }) => {
  if (!await preparePlanFixture()) throw new Error("ASSIST01 requires its own temporary ChatGPT fixture.");
  try {
    await signIn({ app, screen, browser }, localOrigin, fixtureEmail);
    const { client } = await localClient();
    const prefix = `ARMY-local-assistant-${Date.now()}`;
    const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
    const ui = hydratedUi({ app, screen, browser }, localOrigin);
    await restrictCriticalBrowser(browser, ui.app, army);
    const ids = await createEstimateViaWizard(ui, { projectName: prefix, title: "Assistant" }, army);
    const line = await createLineViaApi(browser, ids.versionId, "ARMY tube cuivre assistant", { quantity: 3, unit_price_ht_cents: 1250 });
    // Independent truth: the totals the estimate API stores for this draft, not what the assistant says.
    const estimate = await readEstimate(browser, ids.versionId);
    expect(estimate.version.total_ht_cents).toBeGreaterThan(0);
    const euros = (cents: number) => `${Math.trunc(cents / 100)},${String(cents % 100).padStart(2, "0")} €`;
    const total = euros(estimate.version.total_ht_cents);
    const readTransport = async () => (await readFile(transportLog, "utf8")).trim().split("\n").filter(Boolean)
      .map((entry) => JSON.parse(entry) as Record<string, unknown>).filter((entry) => !isAbsorbedClientAbort(entry));

    // A conversation cannot be written into by its identifier alone.
    const unknownThread = await apiRequest(browser, "POST", "/api/assistant/threads/00000000-0000-4000-8000-0000000000a5/messages",
      { content: "Question sans conversation" });
    expect(unknownThread.status).toBe(404);

    await ui.app.open(`/dashboard/estimates/${ids.versionId}/edit`);
    const question = "Quel est le total de ce devis ?";
    await screen.getByTestId("assistant-toggle").click();
    const panel = screen.getByTestId("assistant-panel");
    await expect(panel).toBeVisible();
    await panel.getByTestId("assistant-input").fill(question);
    await panel.getByTestId("assistant-send").click();
    const answer = panel.getByTestId("assistant-message-assistant");
    await expect(answer).toContainText(`Le total HT du devis est de ${total}.`, DEV_SERVER_WORK);
    await expect(answer).toHaveAttribute("data-status", "complete");
    await expect(answer.getByTestId("assistant-activity")).toContainText("Lecture du devis");
    await expect(answer.getByTestId("assistant-activity")).toContainText("Lecture des lignes du devis");
    await expect(panel.getByTestId("assistant-message-user")).toHaveText(question);
    // The page behind the docked panel stays usable: the editor's own toolbar still answers.
    await expect(screen.getByTestId("estimate-page-toolbar-more-actions-button")).toBeEnabled();
    const screenshot = await app.screenshot("assistant-estimate-answer");

    // Three requests reached the plan: two reads asked by the model, then its answer; nothing else.
    const sent = (await readTransport()).filter((entry) => entry.task === "assistant");
    expect(sent.map((entry) => entry.step)).toEqual([0, 1, 2]);
    expect(sent.every((entry) => entry.question === question && entry.toolChoice === "auto" && entry.model === "army-plan-model")).toBe(true);
    expect((await readTransport()).filter((entry) => entry.provider === "forbidden")).toEqual([]);

    // Persistence, as its author: the question, then the complete answer with what it read.
    const saved = await client.from("assistant_messages").select("role, status, content, activity, model").order("created_at");
    expect(saved.error).toBeNull();
    expect(saved.data).toEqual([
      { role: "user", status: "complete", content: question, activity: [], model: null },
      { role: "assistant", status: "complete", model: "army-plan-model",
        content: `Le total HT du devis est de ${total}. La ligne [[ligne:${ids.versionId}/${line.id}|${line.title}]] vaut ${total}.`,
        activity: [{ name: "lire_devis", activity: "Lecture du devis", ok: true },
          { name: "lire_lignes_devis", activity: "Lecture des lignes du devis", ok: true }] },
    ]);

    // The cited line opens in the editor, and the conversation is found again after a real reload.
    const citation = answer.getByTestId("assistant-line-link");
    await expect(citation).toHaveText(line.title);
    await citation.click();
    await expect(ui.browser).toHaveURL(new RegExp(`focusItemId=${line.id}`));
    await ui.browser.reload();
    await screen.getByTestId("assistant-toggle").click();
    await expect(panel.getByTestId("assistant-empty")).toBeVisible();
    await panel.getByTestId("assistant-thread-select").selectOption({ label: question });
    await expect(panel.getByTestId("assistant-message-assistant")).toContainText(`Le total HT du devis est de ${total}.`, DEV_SERVER_WORK);

    // Its author deletes it, messages included.
    const remove = panel.getByTestId("assistant-delete-thread");
    await remove.click();
    await remove.click();
    await expect(panel.getByTestId("assistant-empty")).toBeVisible();
    await expect.poll(async () => (await client.from("assistant_messages").select("id")).data?.length, DEV_SERVER_WORK).toBe(0);
    expect((await client.from("assistant_threads").select("id")).data).toEqual([]);

    await recordEvidence(army, "assistant-estimate-answer", { ids, lineId: line.id, totalHtCents: estimate.version.total_ht_cents,
      providerRequests: sent.length, provider: "fixture", liveModel: false, screenshot });
  } finally {
    if (fixtureStore) await rm(fixtureStore, { force: true });
    fixtureStore = undefined;
  }
});


// A finished fictional CSV job is read from the review screen, then refused from another affaire.
if (!existsSync(liveProbePath)) test("ASSIST02 takeoff review reads its job and rejects another affaire", {
  tags: ["critical", "local", "chatgpt"], session: "army", timeout: 420_000,
}, async ({ app, screen, browser }) => {
  if (!await preparePlanFixture()) throw new Error("ASSIST02 requires its temporary fixture.");
  try {
    await signIn({ app, screen, browser }, localOrigin, fixtureEmail);
    const prefix = `ARMY-assistant-takeoff-${Date.now()}`;
    const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
    const ui = hydratedUi({ app, screen, browser }, localOrigin);
    const ids = await createEstimateViaWizard(ui, { projectName: prefix, title: "Métré assistant" }, army);
    const csv = path.resolve(`.e2e/army/critical/artifacts/${prefix}.csv`);
    await writeFile(csv, "designation;quantity;unit\nARMY copper pipe;12.5;m\n");
    await ui.app.open(`/dashboard/estimates/${ids.versionId}/takeoff/new`);
    const source = screen.getByLabel("Fichier source", { exact: true });
    await expect(source).toBeEnabled();
    await source.setInputFiles(csv);
    await expect(screen.getByText(path.basename(csv), { exact: true })).toBeVisible();
    await fillTakeoffPreparation({ ...ui, army }, { sources: [path.basename(csv)], objective: "extract_quantities", unit: "Unités des lignes sources",
      inclusions: "Toutes les lignes du fichier", levels: "Tous", zones: "Toutes", exclusions: "", processing: { level: "A" } }, browser.locator("form").last());
    const [created] = await Promise.all([browser.waitForResponse("**/api/takeoff/jobs"),
      screen.getByRole("button", "Confirmer et lancer le métré", { exact: true }).tap()]);
    expect(created.status).toBe(201);
    const jobId = (await created.json<{ data: { id: string } }>()).data.id;
    const read = () => apiRequest<{ data: { job: { status: string }; items: { data: Array<{ designation: string; quantity: number; unit: string }> } } }>(browser, "GET", `/api/takeoff/jobs/${jobId}`);
    await expect.poll(async () => (await read()).body.data.job.status, { timeout: 120_000 }).toBe("completed");
    const detail = (await read()).body.data;
    expect(detail.items.data).toEqual(expect.arrayContaining([expect.objectContaining({ designation: "ARMY copper pipe", quantity: 12.5, unit: "m" })]));
    const other = await createEstimateViaWizard(ui, { projectName: `${prefix}-other`, title: "Autre affaire" }, army);
    await ui.app.open(`/dashboard/affaires/${ids.projectId}/takeoff/${jobId}/review?versionId=${ids.versionId}`);
    await screen.getByTestId("assistant-toggle").click();
    const panel = screen.getByTestId("assistant-panel");
    await panel.getByTestId("assistant-input").fill(`ASSIST02 ${jobId}`);
    await panel.getByTestId("assistant-send").click();
    const answer = panel.getByTestId("assistant-message-assistant");
    await expect(answer).toContainText("ARMY copper pipe : 12.5 m", DEV_SERVER_WORK);
    await expect(answer).toHaveAttribute("data-status", "complete");
    await expect(answer.getByTestId("assistant-activity")).toContainText("Lecture du métré");
    const screenshot = await app.screenshot("assistant-takeoff-answer");
    await ui.app.open(`/dashboard/estimates/${other.versionId}/edit`);
    await screen.getByTestId("assistant-toggle").click();
    await panel.getByTestId("assistant-input").fill(`ASSIST02 ${jobId}`);
    await panel.getByTestId("assistant-send").click();
    await expect(answer).toContainText("Ce métré n’appartient pas à l’affaire de cette conversation.", DEV_SERVER_WORK);
    await expect(answer).not.toContainText("ARMY copper pipe");
    await recordEvidence(army, "assistant-takeoff-answer", { ids, other, jobId, quantity: 12.5, provider: "fixture", screenshot });
  } finally {
    if (fixtureStore) await rm(fixtureStore, { force: true });
    fixtureStore = undefined;
  }
});


if (!existsSync(liveProbePath)) test("ASSIST03 timeout is explained and retry keeps one question", {
  tags: ["critical", "local", "chatgpt"], session: "army", timeout: 300_000,
}, async ({ app, screen, browser }) => {
  if (!await preparePlanFixture()) throw new Error("ASSIST03 requires its temporary fixture.");
  try {
    await signIn({ app, screen, browser }, localOrigin, fixtureEmail);
    const { client } = await localClient();
    const prefix = `ARMY-assistant-timeout-${Date.now()}`;
    const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
    const ui = hydratedUi({ app, screen, browser }, localOrigin);
    const ids = await createEstimateViaWizard(ui, { projectName: prefix, title: "Assistant délai" }, army);
    await createLineViaApi(browser, ids.versionId, "ARMY tube délai", { quantity: 3, unit_price_ht_cents: 1250 });
    const total = (await readEstimate(browser, ids.versionId)).version.total_ht_cents;
    const euros = `${Math.trunc(total / 100)},${String(total % 100).padStart(2, "0")} €`;
    await ui.app.open(`/dashboard/estimates/${ids.versionId}/edit`);
    await screen.getByTestId("assistant-toggle").click();
    const panel = screen.getByTestId("assistant-panel");
    const question = "Quel est le total après délai ?";
    await setDecisionsControl({ timeoutWriting: true });
    await panel.getByTestId("assistant-input").fill(question);
    await panel.getByTestId("assistant-send").click();
    await expect(panel.getByTestId("assistant-error")).toHaveText("La réponse a dépassé le délai autorisé. Réessayez avec une question plus ciblée.", DEV_SERVER_WORK);
    await expect(panel.getByTestId("assistant-message-user")).toHaveText(question);
    await setDecisionsControl({});
    await panel.getByTestId("assistant-retry").click();
    await expect(panel.getByTestId("assistant-message-assistant").last()).toContainText(`Le total HT du devis est de ${euros}.`, DEV_SERVER_WORK);
    const thread = await client.from("assistant_threads").select("id").eq("project_id", ids.projectId).single();
    expect(thread.error).toBeNull();
    await expect.poll(async () => (await client.from("assistant_messages").select("role, status, content").eq("thread_id", thread.data!.id).order("created_at")).data, DEV_SERVER_WORK)
      .toEqual(expect.arrayContaining([expect.objectContaining({ role: "assistant", status: "complete" })]));
    const saved = await client.from("assistant_messages").select("role, status, content, error_code").eq("thread_id", thread.data!.id).order("created_at");
    expect(saved.error).toBeNull();
    expect(saved.data?.filter(message => message.role === "user")).toEqual([
      { role: "user", status: "complete", content: question, error_code: null },
    ]);
    expect(saved.data?.filter(message => message.status === "failed")).toEqual([
      expect.objectContaining({ role: "assistant", error_code: "AI_TIMEOUT" }),
    ]);
    await recordEvidence(army, "assistant-timeout-retry", { ids, questionCount: 1, provider: "fixture", screenshot: await app.screenshot("assistant-timeout-retry") });
  } finally {
    await setDecisionsControl({});
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
    // The document desk keeps the dialog busy while its server answers the reclassification (the form stays open
    // until then) and refreshes the page. Wait for that work first, with its budget; the button comes back with it.
    await expect(details).toHaveAttribute("aria-busy", "false", DEV_SERVER_WORK);
    await expect(details.getByRole("button", "Reclasser", { exact: true })).toBeVisible();
    const before = (await documents())[0];
    const sets = await readPlanSets(browser, ids.projectId);
    expect(sets).toHaveLength(1);
    const copiesBefore = await readPlanFiles(browser, sets[0].id);
    expect(copiesBefore).toHaveLength(1);
    await details.getByRole("button", "Fermer", { exact: true }).click();
    await expect(details).not.toBeVisible();
    const retry = screen.getByRole("button", "Relancer l’analyse (1)", { exact: true });
    await expect(retry).toBeEnabled();
    await retry.click();
    await expect(screen.getByText(/1 classement manuel conservé/)).toBeVisible(DEV_SERVER_WORK);
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
      // As in INTRETRY01: the server's work first, with its budget, then the button it gives back.
      await expect(details).toHaveAttribute("aria-busy", "false", DEV_SERVER_WORK);
      await expect(details.getByRole("button", "Reclasser", { exact: true })).toBeVisible();
      await details.getByRole("button", "Fermer", { exact: true }).click();
      await expect(details).not.toBeVisible();
    }
    await screen.getByRole("button", "Relancer l’analyse (4)", { exact: true }).click();
    await expect(screen.getByText(/3 pièces analysées. 1 pièce non analysée./)).toBeVisible(DEV_SERVER_WORK);
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
