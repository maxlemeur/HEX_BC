import { launchPreparedPlanSet } from "../takeoff/prepared-takeoff";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { afterAll, beforeAll, test } from "@e2e-dev/web";
import { expect } from "e2e";
import * as XLSX from "xlsx";

import { COSTING_WORKBOOK_SHEET } from "@/lib/catalogue/costing-workbook";

import {
  apiRequest, createEstimateViaWizard, createLineViaApi, readEstimate, recordEvidence, restrictCriticalBrowser,
} from "../critical/fixtures";
import { hydratedUi, signIn, waitForHydration } from "../critical/hydration-support";
import { fillTakeoffPreparation, openTakeoffOptions, saveTakeoffPreparation, takeoffZone } from "../critical/preparation-support";
import { createPlanSet, ownedTakeoffJobs, readPlanFiles, uploadSamplePlan } from "../critical/plans-support";
import type { TakeoffPreparation } from "@/lib/takeoff/preparation";
import {
  chatGptLocalServer, isAbsorbedClientAbort, LAB_VECTOR_DOCUMENT, liveProbePath, localChatGptClient, openProjectAssistant, writeDecisionsControl, writePlanFixture,
  type ChatGptLiveProbe,
} from "./chatgpt-local-journey-support";
import { compileChatGptRoutes, createLocalChatGptOwner, TAKEOFF_JOURNEY_WAVES } from "./chatgpt-server-support";
import { verifyPriceReuseArbitration } from "./engine-v3-price-reuse-support";
import { querySql } from "./calculation-gate-support";
import { LAB_VECTOR_PLAN } from "./lab-vector-plan-fixture";
import { labSessionCookies, launchLabRun, rawLabRequest } from "./takeoff-lab-support";

// Decisions proposals, the vectors lab, price reuse, material requests and the estimate assistant.
// Each chatgpt-local-intake-* journey file starts its own server.
const server = chatGptLocalServer();
let localOrigin: string;
let fixtureStore: string | undefined;
let liveProbe: ChatGptLiveProbe | null = null;
let transportLog: string;
let decisionsControl: string;
let fixtureEmail: string;
let labOutputDir: string;
// These requests share the CI runner with the other worker and the built application.
const DEV_SERVER_WORK = { timeout: 60_000 };
const localClient = () => localChatGptClient(fixtureEmail);
const setDecisionsControl = (input: Parameters<typeof writeDecisionsControl>[1]) => writeDecisionsControl(decisionsControl, input);
/** Writes the owner's temporary ChatGPT profile unless a test of this file already left one. */
async function preparePlanFixture(unsetPreferences = false) {
  if (fixtureStore) return false;
  fixtureStore = await writePlanFixture(fixtureEmail, liveProbe, unsetPreferences);
  return true;
}

beforeAll(async () => {
  ({ origin: localOrigin, email: fixtureEmail, liveProbe, transportLog, decisionsControl, labOutputDir } = await server.start());
});
// ASSIST02 launches a job and reads its review. Warm the takeoff routes in bounded waves.
for (const wave of TAKEOFF_JOURNEY_WAVES) beforeAll(() => server.compileTakeoffRoutes(wave));
beforeAll(() => compileChatGptRoutes(localOrigin, fixtureEmail, "takeoff-activity"));

afterAll(() => server.stop(fixtureStore));

test("ASSIST05 workbook reliability filters Excel in the assistant and requires confirmation", {
  tags: ["critical", "local", "chatgpt", "catalogue"], session: "army", timeout: 180_000,
}, async ({ app, screen, browser }) => {
  const prefix = "ARMY-assistant-reliability-" + Date.now();
  const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
  const directory = path.join(path.dirname(transportLog), "workbook-reliability");
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, "fiabilite.xlsx");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["ID", "Type_ligne", "Caractéristique", "Matériau", "Unité", "PR. FO", "Fiabilité (/10)"],
    [prefix + "-ZERO", "Art", "Tube à écarter", "Inox", "m", 10, 0],
    [prefix + "-NOTE", "Art", "Tube à garder", "Inox", "m", 10, 8],
    [prefix + "-VIDE", "Art", "Tube sans note", "Inox", "m", 10, null],
  ]), COSTING_WORKBOOK_SHEET);
  await writeFile(filename, XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer);
  const callsBefore = await readFile(transportLog, "utf8");

  await signIn({ app, screen, browser }, localOrigin, fixtureEmail);
  await hydratedUi({ app, screen, browser }, localOrigin).app.open("/dashboard/products/import-workbook");
  await screen.getByRole("button", "Choisir un fichier Excel", { exact: true }).setInputFiles(filename);
  await screen.getByRole("dialog", "Colonnes à afficher", { exact: true })
    .getByRole("button", "Afficher l’aperçu", { exact: true }).tap(DEV_SERVER_WORK);
  const importThree = screen.getByRole("button", "Importer 3 brouillons", { exact: true });
  await expect(importThree).toBeEnabled(DEV_SERVER_WORK);
  const entry = screen.getByRole("banner").getByTestId("assistant-toggle");
  await expect(entry).toHaveAttribute("aria-expanded", "false");
  await entry.click();
  await expect(entry).toHaveAttribute("aria-expanded", "true");
  await screen.getByRole("textbox", "Votre message à l’assistant", { exact: true }).fill("Écarte les lignes dont la fiabilité est à zéro");
  await screen.getByRole("button", "Envoyer", { exact: true }).click();
  const preview = screen.getByRole("dialog", "Lignes dont la fiabilité Excel est à zéro", { exact: true });
  await expect(preview.getByText("1 ligne proposée sur 3 lignes analysées", { exact: true })).toBeVisible();
  await expect(preview.getByRole("button", "Écarter les lignes sélectionnées", { exact: true })).toBeDisabled();
  await preview.getByRole("checkbox", /^Ligne Excel 2\b/).check();
  await preview.getByRole("button", "Écarter 1 ligne de l’import", { exact: true }).click();
  await expect(screen.getByRole("button", "Importer 2 brouillons", { exact: true })).toBeEnabled(DEV_SERVER_WORK);
  expect(await readFile(transportLog, "utf8")).toBe(callsBefore);
  await recordEvidence(army, "assistant-workbook-reliability", { analysed: 3, retained: 2, excludedExcelRow: 2, providerRequests: 0 });
});

if (!existsSync(liveProbePath)) test("LOCALREV01 a chosen plan revision supplies both detailed and vector reads with the pinned profile", {
  tags: ["critical", "local", "chatgpt", "premetre"], session: "army", timeout: 240_000,
}, async ({ app, screen, browser }) => {
  if (!await preparePlanFixture()) throw new Error("The revision journey requires its own temporary profile.");
  const setEffort = async (effort: "medium" | "high") => {
    const store = JSON.parse(await readFile(fixtureStore!, "utf8"));
    store.profiles.find((profile: { id: string }) => profile.id === store.selectedId).reasoningEffort = effort;
    await writeFile(fixtureStore!, JSON.stringify(store), { mode: 0o600 });
  };
  await setEffort("medium");
  // Provider calls and any other process diagnostic; a client leaving a proxied request is absorbed (TI-667), as in
  // this file's other journeys, and is not a call.
  const readTransport = async () => (await readFile(transportLog, "utf8")).trim().split("\n").filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>).filter((entry) => !isAbsorbedClientAbort(entry));
  const start = (await readTransport()).length;
  try {
    await signIn({ app, screen, browser }, localOrigin, fixtureEmail);
    const prefix = `ARMY-revision-${Date.now()}`;
    const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
    const ui = hydratedUi({ app, screen, browser }, localOrigin);
    const estimate = await createEstimateViaWizard(ui, { projectName: prefix, title: "Deux indices de plan" }, army);
    const set = await createPlanSet(ui, army, estimate, `${prefix} plans`);
    const directory = path.join(path.dirname(transportLog), "revision-plans");
    await mkdir(directory, { recursive: true });
    const a = "Réseau RDC - Indice A.pdf";
    const b = "RESEAU RDC - rev B.pdf";
    const { buildLabVectorPlanPdf } = await import("./lab-vector-plan-fixture");
    const kept = await buildLabVectorPlanPdf();
    const replaced = await PDFDocument.load(kept);
    replaced.addPage();
    await writeFile(path.join(directory, a), await replaced.save());
    await writeFile(path.join(directory, b), kept);
    await screen.getByRole("heading", set.name, { exact: true }).click();
    await browser.locator("input[type='file'][accept*='pdf']").first().setInputFiles([path.join(directory, a), path.join(directory, b)]);
    for (const name of [a, b]) await expect(screen.getByRole("button", `Supprimer ${name}`, { exact: true })).toBeVisible({ timeout: 60_000 });
    const files = await readPlanFiles(browser, set.id);
    const jobs = ownedTakeoffJobs(browser, estimate);
    await ui.app.open(`/dashboard/affaires/${estimate.projectId}?view=estimate`);
    await takeoffZone({ screen }).getByRole("button", "Options du métré", { exact: true }).click();
    const dialog = screen.getByRole("dialog", "Préparer le métré", { exact: true });
    await dialog.getByRole("button", "Confirmer et lancer le métré", { exact: true }).click();
    await expect(dialog.getByText("Quelle version retenir ?", { exact: true })).toBeVisible();
    expect(await jobs.list()).toEqual([]);
    expect((await readTransport()).slice(start)).toEqual([]);
    const screenshot = await app.screenshot("localrev01-plan-choice");
    await dialog.getByRole("button", `Retenir ${b}`, { exact: true }).click();
    await dialog.getByRole("button", /Vérifier et lancer$/).click();
    await expect(dialog.getByText(/army-plan-model · Effort moyen[.]/)).toBeVisible();
    await setEffort("high");
    await dialog.getByRole("button", "Confirmer et lancer le métré", { exact: true }).click();
    await expect(dialog.getByText(/Le compte, le modèle ou l’effort ChatGPT a changé[.]/)).toBeVisible();
    await expect(dialog.getByText(/army-plan-model · Effort élevé[.]/)).toBeVisible();
    expect(await jobs.list()).toEqual([]);
    expect((await readTransport()).slice(start)).toEqual([]);
    await dialog.getByRole("button", "Confirmer et lancer le métré", { exact: true }).click();
    await expect(dialog.getByText(/— 1 fichier de plan[.]/)).toBeVisible();
    await expect.poll(async () => (await jobs.list()).find((job) => job.level === "C")?.status, { timeout: 150_000 }).toBe("completed");
    const [job] = await jobs.list();
    const { client } = await localClient();
    const { data: row, error: rowError } = await client.from("takeoff_jobs").select("preparation_snapshot").eq("id", job.id).single();
    const { data: pages, error: pageError } = await client.from("takeoff_vector_pages").select("plan_file_id,source_page").eq("job_id", job.id);
    expect(rowError).toBeNull();
    expect(pageError).toBeNull();
    expect(row?.preparation_snapshot).toMatchObject({ execution_selection: { model: "army-plan-model", reasoningEffort: "high" } });
    const { preparation } = row!.preparation_snapshot as unknown as { preparation: TakeoffPreparation };
    const selected = preparation.sources.filter((source) => source.active);
    const selectedFile = files.find((file) => file.file_size_bytes === kept.length)!;
    expect(selected).toMatchObject([{ document_id: selectedFile.id, revision: "B", pages: [] }]);
    expect(pages).toEqual([{ plan_file_id: selectedFile.id, source_page: 1 }]);
    const { data: quantities, error: quantityError } = await client.from("takeoff_items")
      .select("designation,quantity,unit,source_page").eq("job_id", job.id);
    expect(quantityError).toBeNull();
    expect(quantities).toEqual(expect.arrayContaining([
      { designation: "Tuyauterie cuivre DN20", quantity: 12.5, unit: "m", source_page: 1 },
      { designation: "Vanne isolement DN20", quantity: 4, unit: "u", source_page: 1 },
    ]));
    const calls = (await readTransport()).slice(start);
    expect(calls.filter((entry) => entry.provider === "forbidden" || entry.provider === "decisions-fixture")).toEqual([]);
    expect(calls.filter((entry) => entry.inputKind === "pdf")).toMatchObject([{ model: "army-plan-model", reasoningEffort: "high" }]);
    expect(calls.filter((entry) => entry.task === "vector-groups")).toMatchObject([{ model: "army-plan-model", reasoningEffort: "high" }]);
    await recordEvidence(army, "pinned-plan-revision", { estimate, jobId: job.id, pages, quantities, calls, screenshot });
  } finally {
    if (fixtureStore) await rm(fixtureStore, { force: true });
    fixtureStore = undefined;
  }
});

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
  await takeoffZone({ screen }).getByRole("button", "Options du métré", { exact: true }).click();
  const dialog = screen.getByRole("dialog", "Préparer le métré", { exact: true });
  await saveTakeoffPreparation({ ...ui, army });
  const { client } = await localClient();
  const read = async () => {
    const result = await client.from("takeoff_preparations").select("revision,draft,confirmed_snapshot").eq("project_id", estimate.projectId).single();
    expect(result.error).toBeNull();
    return result.data!;
  };
  const before = await read();
  const scopeStep = dialog.getByRole("button", /Ce que je veux mesurer$/);
  await scopeStep.click();
  await dialog.getByText("Assistance au cadrage", { exact: true }).click();
  await dialog.getByRole("button", "Proposer un cadrage", { exact: true }).click();
  await expect(dialog.getByText(/Decisions : Classement proposé à confirmer/)).toBeVisible();
  const classifications = dialog.getByRole("list", "Propositions de classement des pièces", { exact: true });
  await expect(classifications).toBeVisible();
  await expect(classifications.getByText(file.file_name, { exact: true })).toBeVisible();
  await expect(classifications.getByText("Plans · À confirmer", { exact: true })).toBeVisible();
  await dialog.getByRole("button", /Points à préciser$/).click();
  await expect(classifications).toBeHidden();
  await scopeStep.click();
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
      displayed: "Plans · À confirmer", resultVisibleOnReturnToScope: true, unchangedPreparation: true, timeoutRecoveryVisible: true, staleResultRemovedAfterSourceChange: true, externalApiCalled: false,
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
  plan.drawText("PLAN PLOMBERIE Zone 1 (fictif)", { x: 60, y: 540, size: 18, font });
  // The title block follows more than 12,000 characters in PDF reading order.
  for (let index = 0; index < 140; index++) {
    plan.drawText(`REPERE ${index}: CONDUITE FICTIVE AVEC ISOLANT, ROBINET DE VIDANGE ET SUPPORT DE FIXATION (EXEMPLE)`,
      { x: 60, y: 500 - 3 * index, size: 7, font });
  }
  plan.drawText("NIVEAU R+7 - ZONE 1", { x: 700, y: 40, size: 10, font });
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
  await takeoffZone({ screen }).getByRole("button", "Options du métré", { exact: true }).click();
  const dialog = await fillTakeoffPreparation({ ...ui, army }, { sources: [name] });
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
  await expect(table.getByRole("row", /^Page 2\b.*Plan de réseau.*R\+7.*Z1.*À garder.*Proposée/)).toBeVisible();
  // One call per page, each with its rendered thumbnail; scope R+1 / Zone 1 adds the level and zone questions.
  expect((await triageCalls()).sort((left, right) => Number(left.page) - Number(right.page))).toEqual([
    { provider: "decisions-fixture", questions: 3, task: "page-triage", page: 1, images: 1 },
    { provider: "decisions-fixture", questions: 3, task: "page-triage", page: 2, images: 1 },
  ]);
  const proposed = await read();
  expect(proposed.source).toMatchObject({ active: true, pages: [], page_triage: { accepted: false, page_count: 2 } });
  expect(proposed.source.page_triage?.pages.map((page) => [page.page, page.type, page.level, page.zone, page.proposal, page.status]))
    .toEqual([[1, "facade", "R+1", "Z1", "exclude", "proposed"], [2, "reseau", "R+7", "Z1", "keep", "proposed"]]);
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
  await takeoffZone({ screen }).getByRole("button", "Options du métré", { exact: true }).click();
  const reopened = await openTakeoffOptions({ ...ui, army });
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

  // « Classer avec Decisions »: one call for the one group the keywords leave, its image drawn by the server.
  const launch = screen.getByRole("button", "Classer avec Decisions", { exact: true });
  await expect(launch).toBeEnabled();
  const launched = await launchLabRun(browser, () => launch.click());
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
  // The bars show Decisions' probabilities (EU 0.9); the class, its margin over the next one (0.8).
  await expect(bars.getByRole("listitem").first()).toContainText(/EU.*90\s%/);
  const sent = (await readTransport()).slice(transportStart);
  expect(sent.filter((entry) => entry.provider === "decisions-fixture")).toEqual([
    { provider: "decisions-fixture", questions: 1, task: "vector-groups", images: 1 },
  ]);
  expect((await readTransport()).filter((entry) => entry.provider === "forbidden")).toEqual([]);

  // The stored run: one Decisions configuration, its usage the call's, one question element for the group asked.
  const runFiles = (await readdir(path.join(labOutputDir, "runs"))).filter((name) => name.endsWith(".json"));
  expect(runFiles).toHaveLength(1);
  const run = JSON.parse(await readFile(path.join(labOutputDir, "runs", runFiles[0]), "utf8"));
  const reseau = keywordGroups[decisions.layer];
  expect(run).toMatchObject({ status: "complete", stop: null, crop: null, task: { id: "classe-de-calque", kind: "choice" },
    document: { id: LAB_VECTOR_DOCUMENT, source: "dataset", pages: 1 }, prompt: { base: "takeoff-vector-groups-v2" } });
  expect(run.prompt.version).toMatch(/^takeoff-vector-groups-v2\+[0-9a-f]{64}$/);
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
  let relaunched: Awaited<ReturnType<typeof launchLabRun>>;
  try {
    relaunched = await launchLabRun(browser, async () => {
      await launch.click();
      await expect.poll(async () => (await readTransport()).slice(heldStart).filter((entry) => entry.provider === "decisions-fixture").length).toBe(1);
      await screen.getByLabel("Document", { exact: true }).selectOption({ value: otherDocument });
      await setDecisionsControl({});
    });
  } finally {
    await setDecisionsControl({});
  }
  expect(relaunched.status).toBe(201);
  const staleRunId = (relaunched.body as { data: { id: string } }).data.id;
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

// The AI reading of a material request's photo: the office asks, the photo it sees (turned or not) reaches the member's
// plan as stored, and what the model read becomes draft lines through the routes of the lines, added or, on the
// office's choice, in place of the drafts. The provider is the fixture: it proves the chain, the shape of the request
// and what becomes of a loose answer, not what a real model reads on a sheet.
if (!existsSync(liveProbePath)) test("MRIA01 the photo of a material request is read on the ChatGPT plan into draft lines, added then replaced on the office's choice", {
  tags: ["critical", "local", "chatgpt", "material-requests"], session: "army", timeout: 420_000,
}, async ({ app, screen, browser }) => {
  if (!await preparePlanFixture()) throw new Error("MRIA01 requires its own temporary ChatGPT fixture.");
  try {
    await signIn({ app, screen, browser }, localOrigin, fixtureEmail);
    const prefix = `ARMY-local-mria-${Date.now()}`;
    const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
    const ui = hydratedUi({ app, screen, browser }, localOrigin);
    await restrictCriticalBrowser(browser, ui.app, army);
    const ids = await createEstimateViaWizard(ui, { projectName: prefix, title: "Demande photo" }, army);
    const readTransport = async () => (await readFile(transportLog, "utf8")).trim().split("\n").filter(Boolean)
      .map((entry) => JSON.parse(entry) as Record<string, unknown>).filter((entry) => !isAbsorbedClientAbort(entry));
    const readings = async () => (await readTransport()).filter((entry) => entry.task === "material-request-photo");
    await setDecisionsControl({ materialPhotoModels: true });
    const choosePhotoModel = async (modelId: string, reasoningEffort: string) => {
      const original = screen.getByRole("dialog", "Original de la demande", { exact: true });
      const settings = original.getByRole("button", "Réglages IA", { exact: true });
      await settings.click(DEV_SERVER_WORK);
      const options = screen.getByRole("dialog", "Réglages IA", { exact: true });
      const model = options.getByRole("combobox", "Modèle d’analyse", { exact: true });
      const effort = options.getByRole("combobox", "Effort de raisonnement", { exact: true });
      await model.selectOption({ value: modelId });
      await expect(model).toHaveValue(modelId);
      await expect(effort.getByRole("option", "Sans raisonnement", { exact: true })).toHaveCount(0);
      await effort.selectOption({ value: reasoningEffort });
      await expect(effort).toHaveValue(reasoningEffort);
      await settings.click();
    };

    type RequestLine = { id: string; position: number; original_text: string | null; quantity: number | null; quantity_doubtful: boolean;
      unit: string | null; dimension: string | null; product_type: string | null; material: string | null; material_precision: string | null;
      zone: string | null; status: string };
    type RequestDetail = { request: { id: string }; files: { id: string; rotation: number }[]; lines: RequestLine[];
      photoAnalysis: { status: string } | null };
    type Envelope<T> = { ok: boolean; data: T };
    const base = `/api/affaires/${ids.projectId}/material-requests`;
    const created = await apiRequest<Envelope<RequestDetail>>(browser, "POST", base, {});
    expect(created.status).toBe(201);
    const requestId = created.body.data.request.id;
    const read = async () => {
      const response = await apiRequest<Envelope<RequestDetail>>(browser, "GET", `${base}/${requestId}`);
      expect(response.status).toBe(200);
      return response.body.data;
    };
    // The request says that its screen may offer the reading: the member's plan is connected on this instance.
    expect((await read()).photoAnalysis).toMatchObject({ status: "available" });

    const openOriginal = async () => {
      await ui.app.open(`/dashboard/affaires/${ids.projectId}/demandes-materiel/${requestId}`);
      await screen.getByRole("button", "Voir l’original", { exact: true }).click(DEV_SERVER_WORK);
    };
    await openOriginal();
    const original = screen.getByRole("dialog", "Original de la demande", { exact: true });
    // No photo, no reading to offer.
    await expect(original.getByText("Aucune pièce jointe.", { exact: true })).toBeVisible();
    await expect(original.getByRole("button", "Analyser la photo avec l’IA", { exact: true })).toHaveCount(0);

    // A 1x1 PNG, generated here: no real photograph in a public repository.
    const directory = path.resolve(".e2e/army/critical/artifacts/fixtures", prefix);
    await mkdir(directory, { recursive: true });
    const photo = path.join(directory, "demande-papier.png");
    await writeFile(photo, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
    await browser.locator('input[type="file"][aria-label="Fichiers à ajouter"]').first().setInputFiles([photo]);
    await expect.poll(async () => (await read()).files.length, DEV_SERVER_WORK).toBe(1);
    // The office turns the photo: the bytes stay as stored, and the model is told how to read them upright.
    await original.getByRole("button", "Tourner à droite", { exact: true }).click();
    await expect.poll(async () => (await read()).files[0].rotation, DEV_SERVER_WORK).toBe(90);
    expect(await readings()).toEqual([]);

    const analyze = original.getByRole("button", "Analyser la photo avec l’IA", { exact: true });
    await choosePhotoModel("gpt-6.2-astra", "xhigh");
    await analyze.click();
    await expect.poll(async () => (await read()).lines.length, { timeout: 120_000 }).toBe(2);
    const columns = (line: RequestLine) => [line.position, line.original_text, line.quantity, line.quantity_doubtful, line.unit,
      line.dimension, line.product_type, line.material, line.material_precision, line.zone, line.status];
    const READ = [
      [1, "12 coudes cuivre Ø22 à sertir", 12, false, "u", "Ø 22", "coude", "cuivre", "à sertir", "R+3", "draft"],
      // A quantity given as text and flagged, a size given as a number, a material the model could not read.
      [2, "7 vannes [illisible] 20", 7, true, null, "20", "vanne", null, null, null, "draft"],
    ];
    const first = await read();
    expect(first.lines.map(columns)).toEqual(READ);
    const reading = { provider: "chatgpt-fixture", task: "material-request-photo", detail: "high", turned: true };
    const astra = { ...reading, model: "gpt-6.2-astra", reasoningEffort: "xhigh" };
    expect(await readings()).toEqual([astra]);
    await expect(original.getByRole("status").filter({ hasText: "2 lignes créées en brouillon" })).toBeVisible();
    const screenshot = await app.screenshot("material-request-photo-analysis");

    // Drafts exist: nothing is read again before the office has chosen, and its choice replaces exactly those drafts.
    await choosePhotoModel("gpt-6.2-sol", "high");
    await analyze.click();
    const replace = original.getByRole("button", "Remplacer les 2 lignes", { exact: true });
    await expect(replace).toBeVisible();
    await expect(original.getByRole("button", "Ajouter à la suite", { exact: true })).toBeVisible();
    expect(await readings()).toHaveLength(1);
    await replace.click();
    const firstIds = first.lines.map((line) => line.id);
    await expect.poll(async () => {
      const lines = (await read()).lines;
      return lines.length === 2 && lines.every((line) => !firstIds.includes(line.id));
    }, { timeout: 120_000 }).toBe(true);
    expect((await read()).lines.map(columns)).toEqual(READ);
    expect(await readings()).toEqual([astra, { ...reading, model: "gpt-6.2-sol", reasoningEffort: "high" }]);

    // Adding a PDF original beside the photo: rendered without rotation buttons and read alongside the photo.
    const pdfOriginal = path.join(directory, "liste-materiel.pdf");
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage().drawText("4 brides inox DN 50 - Local technique");
    await writeFile(pdfOriginal, await pdfDoc.save());
    await browser.locator('input[type="file"][aria-label="Fichiers à ajouter"]').first().setInputFiles([pdfOriginal]);
    await expect.poll(async () => (await read()).files.length, DEV_SERVER_WORK).toBe(2);
    await expect(original.getByText("Original 2 sur 2", { exact: true })).toBeVisible();
    await expect(original.getByRole("button", "Tourner à droite", { exact: true })).toHaveCount(0);
    await expect(original.getByRole("link", "Télécharger", { exact: true })).toBeVisible();
    await original.getByRole("button", "Analyser les originaux avec l’IA", { exact: true }).click();
    await original.getByRole("button", "Remplacer les 2 lignes", { exact: true }).click();
    await expect.poll(async () => (await read()).lines.length, { timeout: 120_000 }).toBe(3);
    const WITH_PDF = [
      ...READ,
      [3, "4 brides inox DN 50", 4, false, "u", "DN 50", "bride", "inox", null, "Local technique", "draft"],
    ];
    expect((await read()).lines.map(columns)).toEqual(WITH_PDF);
    expect((await readTransport()).filter((entry) => entry.provider === "forbidden")).toEqual([]);

    await recordEvidence(army, "material-request-photo-analysis", {
      projectId: ids.projectId, requestId, lines: WITH_PDF, readings: await readings(), screenshot, provider: "fixture",
    });
  } finally {
    await setDecisionsControl({});
    if (fixtureStore) await rm(fixtureStore, { force: true });
    fixtureStore = undefined;
  }
});

if (!existsSync(liveProbePath)) test("MRIA02 a supplier quote PDF is compared with the sent request without changing the lines or quote", {
  tags: ["critical", "local", "chatgpt", "material-requests"], session: "army", timeout: 420_000,
}, async ({ app, screen, browser }) => {
  if (!await preparePlanFixture()) throw new Error("MRIA02 requires its own temporary ChatGPT fixture.");
  const prefix = `ARMY-local-quote-${Date.now()}`;
  const directory = path.resolve(".e2e/army/critical/artifacts/fixtures", prefix);
  try {
    await signIn({ app, screen, browser }, localOrigin, fixtureEmail);
    const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
    const ui = hydratedUi({ app, screen, browser }, localOrigin);
    await restrictCriticalBrowser(browser, ui.app, army);
    const ids = await createEstimateViaWizard(ui, { projectName: prefix, title: "Comparaison de devis" }, army);
    type Envelope<T> = { ok: boolean; data: T };
    type Line = { id: string; quantity: number };
    type Quote = { id: string; status: string; files: unknown[]; lines: { unit_price_ht_cents: number | null }[] };
    const base = `/api/affaires/${ids.projectId}/material-requests`;
    const created = await apiRequest<Envelope<{ request: { id: string } }>>(browser, "POST", base, {});
    expect(created.status).toBe(201);
    const requestId = created.body.data.request.id;
    const requestPath = `${base}/${requestId}`;
    const lines = await apiRequest<Envelope<{ lines: Line[] }>>(browser, "POST", `${requestPath}/lines`, {
      lines: [
        { product_type: "Rondelle M8", quantity: 100, unit: "u" },
        { product_type: "Tube DN 75", quantity: 2, unit: "ml" },
      ],
    });
    expect(lines.status).toBe(201);
    const [first, second] = lines.body.data.lines;
    const supplierName = `${prefix} Comptoir fictif`;
    const supplier = await apiRequest<Envelope<{ item: { id: string } }>>(browser, "POST", "/api/suppliers", {
      action: "create", item: { name: supplierName, is_active: true },
    });
    expect(supplier.status).toBe(201);
    const message = "Bonjour, pouvez-vous me faire un prix :\n- 100 u Rondelle M8\n- 2 ml Tube DN 75\nRetrait au comptoir\nMerci !";
    const quote = await apiRequest<Envelope<{ item: Quote }>>(browser, "POST", `${requestPath}/quotes`, {
      supplier_id: supplier.body.data.item.id, line_ids: [first.id, second.id], message, with_references: false,
    });
    expect(quote.status).toBe(201);
    expect((await apiRequest(browser, "PATCH", `${requestPath}/lines/${first.id}`, { quantity: 70 })).status).toBe(200);

    await ui.app.open(`/dashboard/affaires/${ids.projectId}/demandes-materiel/${requestId}?etape=devis`);
    const comparisonCard = screen.getByRole("article", `Devis ${supplierName}`, { exact: true });
    await expect(comparisonCard).toBeVisible(DEV_SERVER_WORK);
    await mkdir(directory, { recursive: true });
    const pdfPath = path.join(directory, "devis-fictif.pdf");
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText("ARMY-Q2 - Rondelles M8 - 1 boite de 50 - 4,20 EUR HT");
    await writeFile(pdfPath, await pdf.save());
    const picker = browser.locator(`input[type="file"][aria-label="Pièces à joindre au devis ${supplierName}"]`).first();
    await picker.setInputFiles([pdfPath]);

    const compare = comparisonCard.getByRole("button", "Comparer le devis à la demande", { exact: true });
    await expect(compare).toBeEnabled(DEV_SERVER_WORK);
    await compare.click();

    const table = comparisonCard.getByRole("table").filter({ hasText: "Proposé dans la pièce" });
    await expect(table.getByText("Quantité insuffisante", { exact: true })).toBeVisible(DEV_SERVER_WORK);
    await expect(table.getByText("50 u / 100 u (-50)", { exact: true })).toBeVisible();
    await expect(table.getByText("Absent du devis", { exact: true })).toBeVisible();
    await expect(table.getByText("· p. 1", { exact: true })).toBeVisible();
    const after = await apiRequest<Envelope<{ lines: Line[] }>>(browser, "GET", requestPath);
    expect(after.body.data.lines.map((line) => line.quantity)).toEqual([70, 2]);
    const saved = await apiRequest<Envelope<{ items: Quote[] }>>(browser, "GET", `${requestPath}/quotes`);
    expect(saved.body.data.items[0]).toMatchObject({
      status: "requested", lines: [{ unit_price_ht_cents: null }, { unit_price_ht_cents: null }],
    });
    const screenshot = await app.screenshot("material-request-quote-comparison");
    await recordEvidence(army, "material-request-quote-comparison", {
      projectId: ids.projectId, requestId, provider: "fixture", requested: 100, offered: 50, difference: -50, screenshot,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
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
    const panel = await openProjectAssistant(screen);
    const settings = screen.getByRole("region", "Assistant MergeOne", { exact: true })
      .getByRole("button", "Réglages IA", { exact: true });
    await settings.click();
    await expect(screen.getByLabel("Source d’IA", { exact: true })).toHaveValue("chatgpt_plan", DEV_SERVER_WORK);
    await settings.click();
    const modelOptions = screen.getByRole("button", { name: "Modèle et effort", exact: true });
    await modelOptions.click();
    await expect(screen.getByLabel("Modèle", { exact: true })).toHaveValue("army-plan-model");
    await screen.getByLabel("Effort de raisonnement", { exact: true }).selectOption({ value: "high" });
    await modelOptions.click();
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
    expect(sent.map((entry) => entry.reasoningEffort)).toEqual(["high", "high", "high"]);
    expect((await readTransport()).filter((entry) => entry.provider === "forbidden")).toEqual([]);

    // Persistence, as its author: the question, then the complete answer with what it read.
    const saved = await client.from("assistant_messages").select("role, status, content, activity, model, token_usage").order("created_at");
    expect(saved.error).toBeNull();
    expect(saved.data).toEqual([
      { role: "user", status: "complete", content: question, activity: [], model: null, token_usage: null },
      { role: "assistant", status: "complete", model: "army-plan-model",
        token_usage: expect.objectContaining({ reasoningEffort: "high" }),
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
    await openProjectAssistant(screen);
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


// A finished fictional plan job is read from the review screen, then refused from another affaire.
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
    const { jobId } = await launchPreparedPlanSet(ui, army, ids);
    const read = () => apiRequest<{ data: { job: { status: string }; items: { data: Array<{ designation: string; quantity: number; unit: string }> } } }>(browser, "GET", `/api/takeoff/jobs/${jobId}`);
    await expect.poll(async () => (await read()).body.data.job.status, { timeout: 120_000 }).toBe("completed");
    const detail = (await read()).body.data;
    expect(detail.items.data).toEqual(expect.arrayContaining([expect.objectContaining({ designation: "Tuyauterie cuivre DN20", quantity: 12.5, unit: "m" })]));
    const other = await createEstimateViaWizard(ui, { projectName: `${prefix}-other`, title: "Autre affaire" }, army);
    await ui.app.open(`/dashboard/affaires/${ids.projectId}/takeoff/${jobId}/review?versionId=${ids.versionId}`);
    const panel = await openProjectAssistant(screen);
    await panel.getByTestId("assistant-input").fill(`ASSIST02 ${jobId}`);
    await panel.getByTestId("assistant-send").click();
    const answer = panel.getByTestId("assistant-message-assistant");
    await expect(answer).toContainText("Tuyauterie cuivre DN20 : 12.5 m", DEV_SERVER_WORK);
    await expect(answer).toHaveAttribute("data-status", "complete");
    await expect(answer.getByTestId("assistant-activity")).toContainText("Lecture du métré");
    const screenshot = await app.screenshot("assistant-takeoff-answer");
    await ui.app.open(`/dashboard/estimates/${other.versionId}/edit`);
    await openProjectAssistant(screen);
    await panel.getByTestId("assistant-input").fill(`ASSIST02 ${jobId}`);
    await panel.getByTestId("assistant-send").click();
    await expect(answer).toContainText("Ce métré n’appartient pas à l’affaire de cette conversation.", DEV_SERVER_WORK);
    await expect(answer).not.toContainText("Tuyauterie cuivre DN20");
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
    const panel = await openProjectAssistant(screen);
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


// Assistant (lot 2): a question on the dossier lists the affaire's documents, reads a page range of its fictional PDF and
// answers with a page citation that opens the dossier's preview; a citation of a page it never read stays plain text;
// the same document asked from another affaire is refused. The provider is the fixture: it proves the reads, the rights,
// the framing of the document as data and the citation check, not what a real model understands of a CCTP.
