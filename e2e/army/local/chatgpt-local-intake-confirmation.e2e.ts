import type { AnalysisProgress } from "@/lib/affaires/analysis-progress-contract";
import { activateOwnedPlanDispatch, deactivateOwnedPlanDispatch } from "../takeoff/plan-dispatch-support";
import { readFile, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { PDFDocument, PDFName } from "pdf-lib";
import { afterAll, beforeAll, test } from "@e2e-dev/web";
import { expect } from "e2e";

import {
  apiRequest, createEstimateViaWizard, readEstimate, recordEvidence,
} from "../critical/fixtures";
import { hydratedUi, waitForHydration } from "../critical/hydration-support";
import { takeoffZone } from "../critical/preparation-support";
import { readPlanFiles, readPlanSets } from "../critical/plans-support";
import {
  chatGptLocalServer, liveProbePath, writeDecisionsControl, writePlanFixture, type ChatGptLocalServer,
} from "./chatgpt-local-journey-support";
import { createLocalChatGptOwner, TAKEOFF_JOURNEY_WAVES } from "./chatgpt-server-support";
import { openOwnedSqlSession, querySql } from "./calculation-gate-support";
import { callServerAction, serverActionId } from "./engine-v3-creators-support";
import {
  ownedPlanChoices, makeOwnedDirector, readOwnedAffaireJobs, readOwnedAffaireNotices,
  readOwnedBrief, readOwnedLaunchRequests, readOwnedPayerNoticeBasis, readOwnedVersionCount,
} from "./automatic-start-support";
import { createIntakePlanActions, DEV_SERVER_WORK, PAYER_NOTICE } from "./chatgpt-local-intake-support";

// The automatic start of the takeoff (lot 2, migration 20261121170448_takeoff_launch_requests.sql). Each journey has
// owners of its own (createLocalChatGptOwner): their analyses count against no other journey's admission budget, and the
// file's owner keeps no profile for them. The automatic start is activated for the journey only.
const server = chatGptLocalServer();
let serverState: ChatGptLocalServer;
const { signInAs, uploadDossierPlan, openBriefConfirmation, planReads, forbiddenRequests } = createIntakePlanActions(() => serverState);
let localOrigin: string;
let transportLog: string;
let decisionsControl: string;
let serverWorkspace: { id: string } | undefined;
const actionManifest = () => `.build/tester-army/next-${serverWorkspace!.id}/dev/server/server-reference-manifest.json`;
const setDecisionsControl = (input: Parameters<typeof writeDecisionsControl>[1]) => writeDecisionsControl(decisionsControl, input);
beforeAll(async () => {
  serverState = await server.start();
  ({ origin: localOrigin, transportLog, decisionsControl, workspace: serverWorkspace } = serverState);
});
// The dossier opens the affaire and its takeoff options. Keep the route warmups in separate hooks.
for (const wave of TAKEOFF_JOURNEY_WAVES) beforeAll(() => server.compileTakeoffRoutes(wave));
// The intake tests' own routes: in the body of the first of them, their compiles held its reclassification (INTRETRY01).
beforeAll(() => server.compileIntakeRoutes());

afterAll(() => server.stop());

if (!existsSync(liveProbePath)) test("AUTO01 choosing one of two plans reads it once on the confirmer’s subscription", {
  tags: ["critical", "local", "chatgpt", "intake", "premetre"], session: "army", trace: "off", timeout: 300_000,
}, async ({ app, screen, browser }) => {
  const owner = await createLocalChatGptOwner();
  const store = await writePlanFixture(owner.email, null, false);
  await activateOwnedPlanDispatch();
  try {
    await signInAs({ app, screen, browser }, owner.email);
    const prefix = `ARMY-auto-start-${Date.now()}`;
    const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
    const ui = hydratedUi({ app, screen, browser }, localOrigin);
    const ids = await createEstimateViaWizard(ui, { projectName: prefix, title: "Démarrage automatique" }, army);
    const before = await readEstimate(browser, ids.versionId);
    await uploadDossierPlan(ui, ids.projectId, `${prefix}-plan-rdc.pdf`, owner.email);
    await uploadDossierPlan(ui, ids.projectId, `${prefix}-plan-toiture.pdf`, owner.email, "opened");
    await expect.poll(async () => (await readOwnedBrief(ids.projectId))?.status ?? null, DEV_SERVER_WORK).toBe("a_confirmer");
    // Classification of the second PDF can finish while the first brief is still visible.
    await expect.poll(async () => (await owner.client.from("affaire_intake_uploads").select("id").eq("project_id", ids.projectId)
      .in("status", ["launch_queued", "launch_processing"])).data, DEV_SERVER_WORK).toEqual([]);
    expect(await readOwnedLaunchRequests(ids.projectId)).toEqual([]);
    const readsBefore = await planReads();

    // The member who confirms is told who pays, at the gesture.
    const confirm = await openBriefConfirmation(ui, ids.projectId, owner.userId, true);
    await confirm.click();
    const dialog = screen.getByRole("alertdialog", "Confirmer ce brief ?", { exact: true });
    await expect(dialog.getByRole("checkbox")).toHaveCount(2);
    await expect(dialog).not.toContainText(PAYER_NOTICE);
    await dialog.getByRole("checkbox", /plan-rdc\.pdf/).check();
    await expect(dialog).toContainText(PAYER_NOTICE);
    const briefBefore = (await readOwnedBrief(ids.projectId))!;
    await dialog.getByRole("button", "Confirmer et analyser 1 plan", { exact: true }).click();

    // One request, one detailed analysis of the dossier's plan without a version, on the confirmer's subscription.
    await expect.poll(async () => (await readOwnedLaunchRequests(ids.projectId)).map(request => [request.origin, request.state, request.outcome]),
      { timeout: 180_000 }).toEqual([["automatic", "closed", "success"]]);
    const [request] = await readOwnedLaunchRequests(ids.projectId);
    expect(request).toMatchObject({ confirmed_by: owner.userId, payer_id: owner.userId,
      mandate_kind: "confirmation", units_expected: 1 });
    const jobs = await readOwnedAffaireJobs(ids.projectId);
    expect(jobs).toEqual([expect.objectContaining({ launch_request_id: request.id, launch_unit_key: `plan:${request.manifest_plans![0]}`, estimate_version_id: null,
      created_by: owner.userId, status: "completed", analysis_outcome: "success", execution_host_id: request.execution_host_id })]);
    expect(await planReads() - readsBefore).toBe(1);
    expect(await readOwnedAffaireNotices(ids.projectId)).toEqual([expect.objectContaining({ subject_kind: "request", request_id: request.id,
      job_id: null, recipient_user_id: owner.userId, outcome: "success" })]);
    expect((await readEstimate(browser, ids.versionId)).items).toEqual(before.items);

    // The review of the automatic analysis reads its plan as it reads a confirmed one: its location and its original PDF,
    // at the bytes the seal attested (those the analysis read).
    const planHash = createHash("sha256").update(await readFile(path.resolve(".e2e/army/critical/artifacts/fixtures", ids.projectId,
      `${prefix}-plan-rdc.pdf`))).digest("hex");
    const [sealedPlan] = request.manifest_plans ?? [];
    const locations = await apiRequest<{ data: { without_preparation: boolean; plans: Array<{ plan_file_id: string; status: string;
      revision: { content_hash: string } | null }> } }>(browser, "GET", `/api/takeoff/jobs/${jobs[0].id}/plan-locations`);
    expect(locations.status).toBe(200);
    expect({ without: locations.body.data.without_preparation, plans: locations.body.data.plans.map((plan) => ({ id: plan.plan_file_id,
      status: plan.status, hash: plan.revision?.content_hash ?? null })) })
      .toEqual({ without: false, plans: [{ id: sealedPlan, status: "current", hash: planHash }] });
    const original = await browser.evaluate(async ({ job, file }) => {
      const response = await fetch(`/api/takeoff/jobs/${job}/vector-plans/${file}`);
      const sha256 = response.ok
        ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await response.arrayBuffer())),
          (byte) => byte.toString(16).padStart(2, "0")).join("") : null;
      return { status: response.status, sha256 };
    }, { job: jobs[0].id, file: sealedPlan });
    expect(original).toEqual({ status: 200, sha256: planHash });

    await ui.app.open(`/dashboard/affaires/${ids.projectId}?view=overview`);
    const zone = takeoffZone({ screen });
    await expect(zone).toContainText(`${prefix}-plan-toiture.pdf (non lu dans cette demande)`, DEV_SERVER_WORK);
    await expect(zone).not.toContainText("Dossier modifié depuis l’analyse");

    // The member's identical submission of the revision they confirmed (a second tab, or an answer lost on the way)
    // gets the first one's answer and starts nothing more; a form of any other revision is refused.
    const confirmAction = await serverActionId("confirmAffaireBrief", actionManifest());
    const plans = (await ownedPlanChoices(ids.projectId)).filter(({ id }) => id === sealedPlan);
    expect(plans).toHaveLength(1);
    const replay = await callServerAction(browser, confirmAction, { projectId: ids.projectId, expectedUpdatedAt: briefBefore.updated_at, plans, payerNotice: null });
    expect(replay).toMatchObject({ ok: true, errorCode: null });
    const stale = await callServerAction(browser, confirmAction,
      { projectId: ids.projectId, plans, payerNotice: null, expectedUpdatedAt: new Date(Date.parse(briefBefore.updated_at) - 1_000).toISOString() });
    expect(stale.ok).not.toBe(true);
    expect(await readOwnedLaunchRequests(ids.projectId)).toHaveLength(1);

    // A plan added after the analysis is not in its sealed manifest, and nothing is spent on it without a gesture.
    await uploadDossierPlan(ui, ids.projectId, `${prefix}-plan-etage.pdf`, owner.email, "opened");
    const [planSet] = await readPlanSets(browser, ids.projectId);
    await expect.poll(async () => (await readPlanFiles(browser, planSet.id)).length, DEV_SERVER_WORK).toBe(3);
    const added = (await readPlanFiles(browser, planSet.id)).filter(file => !(request.manifest_plans ?? []).includes(file.id));
    expect(added.map(file => file.file_name).sort()).toEqual([`${prefix}-plan-etage.pdf`, `${prefix}-plan-toiture.pdf`]);
    // The request is consumed: the database never hands it to the Mac's loop again (takeoff-launch-requests.test.sql).
    expect(await readOwnedAffaireJobs(ids.projectId)).toHaveLength(1);
    expect(await readOwnedLaunchRequests(ids.projectId)).toEqual([expect.objectContaining({ id: request.id, state: "closed" })]);
    expect(await planReads() - readsBefore).toBe(1);
    expect(await forbiddenRequests()).toBe(0);
    await recordEvidence(army, "AUTO01-automatic-start", { ids, request, jobs, planReads: 1, review: { locations: locations.body.data.plans, original },
      replayedConfirmation: replay, staleConfirmation: stale,
      addedAfterAnalysis: added.map(file => file.id), boundary: "Fictional dossier and ChatGPT transport fixture on an owned local backend." });
  } finally {
    // The next journey signs its own account in: leave no session of these owners.
    await browser.clearCookies({ domain: new URL(localOrigin).hostname });
    await deactivateOwnedPlanDispatch();
    await rm(store, { force: true });
  }
});

if (!existsSync(liveProbePath)) test("AUTO02 a director can confirm without analysing and cannot select another member’s hidden copy", {
  tags: ["critical", "local", "chatgpt", "intake", "premetre"], session: "army", trace: "off", timeout: 240_000,
}, async ({ app, screen, browser }) => {
  const owner = await createLocalChatGptOwner();
  const director = await createLocalChatGptOwner();
  await makeOwnedDirector(owner.userId, director.userId);
  // Both have a connected subscription on this Mac: the director's is never used.
  const stores = [await writePlanFixture(owner.email, null, false), await writePlanFixture(director.email, null, false)];
  await activateOwnedPlanDispatch();
  try {
    await signInAs({ app, screen, browser }, owner.email);
    const prefix = `ARMY-auto-director-${Date.now()}`;
    const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
    const ui = hydratedUi({ app, screen, browser }, localOrigin);
    const ids = await createEstimateViaWizard(ui, { projectName: prefix, title: "Confirmation par un directeur" }, army);
    await uploadDossierPlan(ui, ids.projectId, `${prefix}-plan.pdf`, owner.email);
    await expect.poll(async () => (await readOwnedBrief(ids.projectId))?.status ?? null, DEV_SERVER_WORK).toBe("a_confirmer");
    const readsBefore = await planReads();
    // The director's hub shows no confirmation button; the confirmation itself is open to every reader of the affaire.
    await signInAs({ app, screen, browser }, director.email);
    await ui.app.open(`/dashboard/affaires/${ids.projectId}`);
    const action = await serverActionId("confirmAffaireBrief", actionManifest());
    const input = { projectId: ids.projectId, expectedUpdatedAt: (await readOwnedBrief(ids.projectId))!.updated_at, payerNotice: null };
    const plans = await ownedPlanChoices(ids.projectId);
    expect(plans).toHaveLength(1);
    expect((await callServerAction(browser, action, { ...input, plans })).ok).toBe(false);
    expect((await readOwnedBrief(ids.projectId))?.status).toBe("a_confirmer");
    expect((await callServerAction(browser, action, { ...input, plans: [] })).ok).toBe(true);
    expect(await readOwnedBrief(ids.projectId)).toMatchObject({ status: "confirme", confirmed_by: director.userId });
    expect(await readOwnedLaunchRequests(ids.projectId)).toEqual([]);
    expect(await readOwnedAffaireJobs(ids.projectId)).toEqual([]);
    expect(await planReads()).toBe(readsBefore);
    const hidden = randomUUID();
    await querySql(`insert into public.takeoff_jobs (id,tenant_id,estimate_version_id,created_by,level,status,source_file_name)
      select '${hidden}',p.tenant_id,'${ids.versionId}',p.user_id,'C','processing','ARMY-prive.pdf'
      from public.estimate_projects p where p.id='${ids.projectId}'`);
    const hiddenRead = await director.client.from("takeoff_jobs").select("id").eq("id", hidden);
    expect(hiddenRead.error).toBeNull();
    expect(hiddenRead.data).toEqual([]);
    await ui.app.open(`/dashboard/affaires/${ids.projectId}?view=overview`);
    const zone = takeoffZone({ screen });
    await expect(zone.getByText("Une analyse de l’affaire est en cours.", { exact: true })).toBeVisible(DEV_SERVER_WORK);
    await expect(zone).not.toContainText("Métré non demandé");
    await expect(zone).not.toContainText("ARMY-prive.pdf");
    expect(await forbiddenRequests()).toBe(0);
    await recordEvidence(army, "AUTO02-director-confirmation", { ids, request: (await readOwnedLaunchRequests(ids.projectId))[0],
      jobsAfterConfirmation: 0, hiddenVersionJobReportedAsRunning: true, planReads: 0,
      boundary: "Fictional dossier, two owned members, ChatGPT transport fixture on an owned local backend." });
  } finally {
    // The next journey signs its own account in: leave no session of these owners.
    await browser.clearCookies({ domain: new URL(localOrigin).hostname });
    await deactivateOwnedPlanDispatch();
    for (const store of stores) await rm(store, { force: true });
  }
});

if (!existsSync(liveProbePath)) test("AUTO03 a confirmer whose ChatGPT connection goes while the dialog is open engages nobody, sees why, and nothing is spent", {
  tags: ["critical", "local", "chatgpt", "intake", "premetre"], session: "army", trace: "off", timeout: 240_000,
}, async ({ app, screen, browser }) => {
  const owner = await createLocalChatGptOwner();
  // The dossier's classification runs on a connected subscription; the connection is gone at the confirmation.
  const store = await writePlanFixture(owner.email, null, false);
  await activateOwnedPlanDispatch();
  try {
    await signInAs({ app, screen, browser }, owner.email);
    const prefix = `ARMY-auto-offline-${Date.now()}`;
    const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
    const ui = hydratedUi({ app, screen, browser }, localOrigin);
    const ids = await createEstimateViaWizard(ui, { projectName: prefix, title: "Sans forfait connecté" }, army);
    await uploadDossierPlan(ui, ids.projectId, `${prefix}-plan.pdf`, owner.email);
    await expect.poll(async () => (await readOwnedBrief(ids.projectId))?.status ?? null, DEV_SERVER_WORK).toBe("a_confirmer");
    const readsBefore = await planReads();
    // The dialog tells the member who pays, for the subscription connected now; the connection goes while it is open
    // (the dossier was classified and its brief written while it existed): the notice shown no longer holds.
    const confirm = await openBriefConfirmation(ui, ids.projectId, owner.userId, true);
    await confirm.click();
    const dialog = screen.getByRole("alertdialog", "Confirmer ce brief ?", { exact: true });
    await dialog.getByRole("checkbox", /plan\.pdf/).check();
    await expect(dialog).toContainText(PAYER_NOTICE);
    await rm(store, { force: true });
    await dialog.getByRole("button", "Confirmer et analyser 1 plan", { exact: true }).click();
    await expect(screen.getByText(/Brief confirmé\. Métré non démarré — la confirmation du dossier n’a engagé aucun forfait ChatGPT/)).toBeVisible(DEV_SERVER_WORK);
    await expect.poll(async () => (await readOwnedLaunchRequests(ids.projectId)).map(request => [request.state, request.reason_code]),
      DEV_SERVER_WORK).toEqual([["blocked", "MANDATE_REQUIRED"]]);
    expect((await readOwnedLaunchRequests(ids.projectId))[0]).toMatchObject({ payer_id: null, execution_host_id: null });
    // Without a mandate the request has no Mac: no loop claims it until a gesture (takeoff-launch-requests.test.sql).
    expect(await readOwnedAffaireJobs(ids.projectId)).toEqual([]);
    expect(await planReads()).toBe(readsBefore);
    expect(await forbiddenRequests()).toBe(0);
    await recordEvidence(army, "AUTO03-stale-notice", { ids, request: (await readOwnedLaunchRequests(ids.projectId))[0], jobs: 0,
      planReads: 0, boundary: "Fictional dossier and ChatGPT transport fixture on an owned local backend; no API key or other provider." });
  } finally {
    // The next journey signs its own account in: leave no session of these owners.
    await browser.clearCookies({ domain: new URL(localOrigin).hostname });
    await deactivateOwnedPlanDispatch();
    await rm(store, { force: true });
  }
});

if (!existsSync(liveProbePath)) test("AUTO04 a confirmation from a dialog shown without the payer notice engages nobody, and nothing is spent", {
  tags: ["critical", "local", "chatgpt", "intake", "premetre"], session: "army", trace: "off", timeout: 240_000,
}, async ({ app, screen, browser }) => {
  const owner = await createLocalChatGptOwner();
  const store = await writePlanFixture(owner.email, null, false);
  // The notices' cut-off only: the automatic start is off while the member reads the affaire.
  await activateOwnedPlanDispatch();
  await deactivateOwnedPlanDispatch();
  try {
    await signInAs({ app, screen, browser }, owner.email);
    const prefix = `ARMY-auto-unnotified-${Date.now()}`;
    const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
    const ui = hydratedUi({ app, screen, browser }, localOrigin);
    const ids = await createEstimateViaWizard(ui, { projectName: prefix, title: "Confirmation sans mention du forfait" }, army);
    const markedPdf = async (marker: string) => {
      const pdf = await PDFDocument.load(await readFile("e2e/fixtures/sample-plan.pdf"));
      pdf.getPage(0).node.set(PDFName.of("ArmyPlanChoice"), PDFName.of(marker));
      return pdf.save();
    };
    await uploadDossierPlan(ui, ids.projectId, `${prefix}-plan.pdf`, owner.email, "empty", "classified", undefined, await markedPdf("A"));
    await uploadDossierPlan(ui, ids.projectId, `${prefix}-plan-toiture.pdf`, owner.email, "opened", "classified", undefined, await markedPdf("B"));
    await expect.poll(async () => (await readOwnedBrief(ids.projectId))?.status ?? null, DEV_SERVER_WORK).toBe("a_confirmer");
    const readsBefore = await planReads();
    const confirm = await openBriefConfirmation(ui, ids.projectId, owner.userId, false);
    await confirm.click();
    const dialog = screen.getByRole("alertdialog", "Confirmer ce brief ?", { exact: true });
    await expect(dialog).toBeVisible();
    // The dialog has answered who pays (its read at the opening) before its absence is read and the start turned on.
    const confirmOnly = dialog.getByRole("button", "Confirmer sans analyser", { exact: true });
    await expect(confirmOnly).toBeEnabled(DEV_SERVER_WORK);
    await expect(dialog).not.toContainText(PAYER_NOTICE);
    await activateOwnedPlanDispatch();
    await confirmOnly.click();
    await expect.poll(async () => (await readOwnedBrief(ids.projectId))?.status, DEV_SERVER_WORK).toBe("confirme");
    await ui.app.open(`/dashboard/affaires/${ids.projectId}?view=overview`);
    const zone = takeoffZone({ screen });
    await expect(zone.getByText("Métré non demandé", { exact: true })).toBeVisible(DEV_SERVER_WORK);
    expect(await readOwnedLaunchRequests(ids.projectId)).toEqual([]);
    expect(await readOwnedAffaireJobs(ids.projectId)).toEqual([]);
    expect(await planReads()).toBe(readsBefore);
    const progress = await apiRequest<{ data: AnalysisProgress }>(browser, "GET", "/api/affaires/analysis-progress");
    expect(progress.status).toBe(200);
    expect(progress.body.data.affaires.find((affaire) => affaire.id === ids.projectId)?.lines.filter((line) => line.kind === "takeoff") ?? []).toEqual([]);
    await zone.getByRole("button", "Options du métré", { exact: true }).click();
    const manual = screen.getByRole("dialog", "Préparer le métré", { exact: true });
    const launch = manual.getByRole("button", "Confirmer et lancer le métré", { exact: true });
    await expect(launch).toBeDisabled();
    await expect(manual.getByRole("checkbox", /plan-toiture\.pdf/)).toBeVisible();
    const firstTab = browser.tabs().find(tab => tab.isActive())!;
    const other = await browser.newTab();
    await other.activate();
    try {
      await ui.app.open(`/dashboard/affaires/${ids.projectId}?view=overview`);
      await takeoffZone({ screen }).getByRole("button", "Options du métré", { exact: true }).click();
      await manual.getByRole("checkbox", /plan-toiture\.pdf/).check();
      const action = await serverActionId("relaunchTakeoffAction", actionManifest());
      const url = `**/dashboard/affaires/${ids.projectId}*`;
      await browser.route(url, async route => {
        if (route.request.headers["next-action"] === action) await route.abort();
        else await route.fallback();
      });
      try {
        await launch.click();
        await expect(manual).toContainText("Impossible de lancer l'analyse.", DEV_SERVER_WORK);
      } finally { await browser.unroute(url); }
    } finally { await other.close(); await firstTab.activate(); }
    await browser.reload();
    await waitForHydration(browser);
    await zone.getByRole("button", "Options du métré", { exact: true }).click();
    await manual.getByRole("checkbox", /plan\.pdf/).check();
    await launch.click();
    const discard = manual.getByRole("button", "Le mettre de côté", { exact: true });
    await expect(discard).toBeVisible(DEV_SERVER_WORK);
    await manual.getByRole("checkbox", /plan\.pdf/).uncheck();
    await manual.getByRole("checkbox", /plan-toiture\.pdf/).check();
    await discard.click();
    await expect(launch).toBeEnabled();
    expect(await readOwnedLaunchRequests(ids.projectId)).toEqual([]);
    await launch.click();
    await expect.poll(async () => (await readOwnedLaunchRequests(ids.projectId)).map((r) => [r.origin, r.payer_id, r.units_expected, r.outcome]),
      { timeout: 180_000 }).toEqual([["manual", owner.userId, 1, "success"]]);
    const [set] = await readPlanSets(browser, ids.projectId);
    const files = await readPlanFiles(browser, set.id);
    const chosen = files.find(f => f.file_name.endsWith("-plan-toiture.pdf"))!.id;
    expect((await readOwnedLaunchRequests(ids.projectId))[0].manifest_plans).toEqual([chosen]);
    expect((await readOwnedAffaireJobs(ids.projectId)).map(j => j.launch_unit_key)).toEqual([`plan:${chosen}`]);
    const sends = (await readFile(transportLog, "utf8")).trim().split("\n").map(line => JSON.parse(line))
      .filter(row => row.provider === "chatgpt-fixture" && row.inputKind === "pdf").slice(readsBefore);
    expect(sends.map(row => row.planChoice)).toEqual(["B"]);
    await ui.app.open(`/dashboard/affaires/${ids.projectId}?view=overview`);
    await expect(zone).toContainText(`${prefix}-plan.pdf (non lu dans cette demande)`, DEV_SERVER_WORK);
    await expect(zone).not.toContainText("Dossier modifié depuis l’analyse");
    await uploadDossierPlan(ui, ids.projectId, `${prefix}-extension.pdf`, owner.email, "opened");
    await ui.app.open(`/dashboard/affaires/${ids.projectId}?view=overview`);
    await expect(zone.getByText(`Ajoutés : ${prefix}-extension.pdf`, { exact: true })).toBeVisible(DEV_SERVER_WORK);
    expect(await forbiddenRequests()).toBe(0);
    await recordEvidence(army, "AUTO04-unnotified-confirmation", { ids, requests: await readOwnedLaunchRequests(ids.projectId),
      manualJobs: 1, manualPlanId: chosen, transportPlans: sends.map(row => row.planChoice), automaticReads: 0, boundary: "Fictional dossier and ChatGPT transport fixture on an owned local backend; no API key or other provider." });
  } finally {
    await browser.clearCookies({ domain: new URL(localOrigin).hostname });
    await deactivateOwnedPlanDispatch();
    await rm(store, { force: true });
  }
});

if (!existsSync(liveProbePath)) test("AUTO08 unchecked 201-page PDF", {
  tags: ["critical", "local", "chatgpt", "intake", "premetre"], session: "army", trace: "off", timeout: 240_000,
}, async ({ app, screen, browser }) => {
  const owner = await createLocalChatGptOwner();
  const store = await writePlanFixture(owner.email, null, false);
  await activateOwnedPlanDispatch();
  try {
    await signInAs({ app, screen, browser }, owner.email);
    const prefix = `ARMY-AUTO08-${Date.now()}`;
    const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
    const ui = hydratedUi({ app, screen, browser }, localOrigin);
    const ids = await createEstimateViaWizard(ui, { projectName: prefix, title: "Périmètre du métré" }, army);
    const name = `${prefix}-plan.pdf`;
    await uploadDossierPlan(ui, ids.projectId, name, owner.email);
    await expect.poll(async () => (await ownedPlanChoices(ids.projectId)).length, DEV_SERVER_WORK).toBe(1);
    const [set] = await readPlanSets(browser, ids.projectId);
    const [first] = await readPlanFiles(browser, set.id);
    const extra = "Plan-long.pdf";
    const id = randomUUID();
    const filePath = `${set.tenant_id}/${set.id}/${id}/${extra}`;
    const pages = await PDFDocument.create();
    for (let i = 0; i < 201; i++) pages.addPage();
    const bytes = await pages.save();
    expect((await owner.client.from("plan_files").insert({ id, tenant_id: set.tenant_id, plan_set_id: set.id,
      file_name: extra, file_path: filePath, file_type: "application/pdf", file_size_bytes: bytes.length, page_count: null })).error).toBeNull();
    expect((await owner.client.storage.from("plan-files").upload(filePath, bytes, { contentType: "application/pdf" })).error).toBeNull();
    await (await openBriefConfirmation(ui, ids.projectId, owner.userId, true)).click();
    const dialog = screen.getByRole("alertdialog", "Confirmer ce brief ?", { exact: true });
    await expect(dialog.getByRole("checkbox")).toHaveCount(2);
    const before = await planReads();
    await dialog.getByRole("button", "Confirmer sans analyser", { exact: true }).click();
    await expect.poll(async () => (await readOwnedBrief(ids.projectId))?.status, DEV_SERVER_WORK).toBe("confirme");
    await ui.app.open(`/dashboard/affaires/${ids.projectId}?view=overview`);
    await takeoffZone({ screen }).getByRole("button", "Options du métré", { exact: true }).click();
    const options = screen.getByRole("dialog", "Préparer le métré", { exact: true });
    await expect(options.getByRole("checkbox", /Plan-long/)).not.toBeChecked();
    await options.getByRole("checkbox", /-plan\.pdf/).check();
    await options.getByRole("button", "Confirmer et lancer le métré", { exact: true }).click();
    await expect.poll(async () => (await readOwnedLaunchRequests(ids.projectId))[0]?.state, DEV_SERVER_WORK).toBe("closed");
    const [request] = await readOwnedLaunchRequests(ids.projectId);
    expect(request).toMatchObject({ outcome: "success", units_expected: 1, payer_id: owner.userId });
    expect(request.manifest_plans).toHaveLength(1);
    expect(request.manifest_plans).toEqual([first.id]);
    expect(await planReads() - before).toBe(1);
  } finally {
    await browser.clearCookies({ domain: new URL(localOrigin).hostname });
    await deactivateOwnedPlanDispatch();
    await rm(store, { force: true });
  }
});

const copyScenarios = [
  "AUTO09 two checked copies with identical bytes refuse confirmation",
  "AUTO10 a twin of a successful reading cannot be charged again",
  "AUTO11 replacing either checked copy while confirmation waits rolls back the gesture",
  "AUTO12 current brief activation refuses an obsolete publication",
] as const;

for (const scenario of copyScenarios) {
  // The current-brief flag is global. Exercise its activated state on a dedicated local campaign.
  if (existsSync(liveProbePath) || (scenario.startsWith("AUTO12") && Number(process.env.E2E_ARMY_WORKERS || 1) > 1)) continue;
  test(scenario, {
    tags: ["critical", "local", "chatgpt", "intake", "premetre"], session: "army", trace: "off", timeout: 240_000,
  }, async ({ app, browser, screen }) => {
    const owner = await createLocalChatGptOwner();
    const store = await writePlanFixture(owner.email, null, false);
    await activateOwnedPlanDispatch();
    try {
      expect(await querySql("select public.intake_current_brief_active();")).toContain("f");
      await signInAs({ app, screen, browser }, owner.email);
      const prefix = `ARMY-${scenario.slice(0, 6)}-${Date.now()}`;
      const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
      const ui = hydratedUi({ app, screen, browser }, localOrigin);
      const { projectId } = await createEstimateViaWizard(ui, { projectName: prefix, title: "Copies du dossier" }, army);
      const name = "Plan-original.pdf";
      const copy = "Plan-copie.pdf";
      await uploadDossierPlan(ui, projectId, name, owner.email);
      await expect.poll(async () => (await ownedPlanChoices(projectId)).length, DEV_SERVER_WORK).toBe(1);
      const [set] = await readPlanSets(browser, projectId);
      const id = randomUUID();
      const filePath = `${set.tenant_id}/${set.id}/${id}/${copy}`;
      const original = await readFile(path.resolve(".e2e/army/critical/artifacts/fixtures", projectId, name));
      const changed = Buffer.from(original);
      // Only the trailing PDF comment changes, preserving both the length and the validity of the PDF.
      changed[changed.length - 2] = 88;
      const bytes = scenario.startsWith("AUTO11") ? changed : original;
      expect((await owner.client.from("plan_files").insert({ id, tenant_id: set.tenant_id, plan_set_id: set.id,
        file_name: copy, file_path: filePath, file_type: "application/pdf", file_size_bytes: bytes.length })).error).toBeNull();
      const bucket = owner.client.storage.from("plan-files");
      expect((await bucket.upload(filePath, bytes, { contentType: "application/pdf" })).error).toBeNull();
      await (await openBriefConfirmation(ui, projectId, owner.userId, true)).click();
      const dialog = screen.getByRole("alertdialog", "Confirmer ce brief ?", { exact: true });
      const first = dialog.getByRole("checkbox", /Plan-original\.pdf/);
      const twin = dialog.getByRole("checkbox", /Plan-copie\.pdf/);
      await expect(twin).toBeEnabled(DEV_SERVER_WORK);
      const before = await planReads();
      const action = await serverActionId("confirmAffaireBrief", actionManifest());

      if (scenario.startsWith("AUTO09")) {
        await first.check();
        await twin.check();
        await dialog.getByRole("button", "Confirmer et analyser 2 plans", { exact: true }).click();
        await expect(dialog).toContainText(/gardez-en un seul/i);
        const refusal = dialog.getByText(/gardez-en un seul/i);
        await expect(refusal).toContainText(name);
        await expect(refusal).toContainText(copy);
        await expect(first).toBeChecked();
        await expect(twin).toBeChecked();
        await twin.uncheck();
        await expect(dialog.getByRole("button", "Confirmer et analyser 1 plan", { exact: true })).toBeEnabled();
      } else if (scenario.startsWith("AUTO10")) {
        const route = `**/dashboard/affaires/${projectId}*`;
        let payerNotice: string | null = null;
        await browser.route(route, async intercepted => {
          if (intercepted.request.headers["next-action"] === action) {
            payerNotice = JSON.parse(intercepted.request.postData!)[0].payerNotice;
          }
          await intercepted.fallback();
        });
        try {
          await first.check();
          await dialog.getByRole("button", "Confirmer et analyser 1 plan", { exact: true }).click();
          await expect.poll(async () => (await readOwnedLaunchRequests(projectId))[0]?.outcome, DEV_SERVER_WORK).toBe("success");
        } finally { await browser.unroute(route); }
        expect(payerNotice).toMatch(/^[a-f0-9]{64}$/);
        expect(await planReads() - before).toBe(1);
        await ui.app.open(`/dashboard/affaires/${projectId}#brief`);
        await browser.reload();
        await waitForHydration(browser);
        await screen.getByRole("button", "Modifier le brief", { exact: true }).click();
        await browser.locator(".brief-edit-body textarea").first().fill("Périmètre du dossier mis à jour.");
        await screen.getByRole("button", "Enregistrer", { exact: true }).click();
        await (await openBriefConfirmation(ui, projectId, owner.userId, true)).click();
        const selection = (await ownedPlanChoices(projectId)).filter(plan => plan.id === id);
        expect(selection).toHaveLength(1);
        // An already-open client can still submit B, with the genuine notice for this payer.
        const answer = await callServerAction(browser, action, { projectId, plans: selection, payerNotice,
          expectedUpdatedAt: (await readOwnedBrief(projectId))!.updated_at });
        expect(answer).toMatchObject({ ok: false, errorMessage: `Ce fichier a déjà été analysé sous le nom « ${name} ».` });
        await expect(twin).toBeDisabled();
        await expect(dialog.getByRole("checkbox", /Plan-copie\.pdf.*Déjà analysé/)).toBeDisabled();
        expect((await readOwnedBrief(projectId))?.status).toBe("a_confirmer");
        expect(await readOwnedLaunchRequests(projectId)).toHaveLength(1);
        expect(await readOwnedAffaireJobs(projectId)).toHaveLength(1);
        expect(await planReads() - before).toBe(1);
        expect((await bucket.update(filePath, changed, { contentType: "application/pdf" })).error).toBeNull();
        await (await openBriefConfirmation(ui, projectId, owner.userId, true)).click();
        await expect(twin).toBeEnabled();
        return;
      } else if (scenario.startsWith("AUTO11")) {
        await first.check();
        await twin.check();
        const plans = await ownedPlanChoices(projectId);
        expect(plans).toHaveLength(2);
        const expectedUpdatedAt = (await readOwnedBrief(projectId))!.updated_at;
        // Hold the brief row until the real confirmation RPC reaches it, after both files were hashed.
        const tag = `army_brief_${id}`;
        const holder = openOwnedSqlSession(90_000);
        holder.write(`set application_name='${tag}'; begin; select id from public.affaire_briefs where project_id='${projectId}' for update;\n`);
        const pending = async () => (await querySql(`select count(*) from pg_stat_activity b where b.application_name='${tag}'
          and exists(select 1 from pg_stat_activity w where b.pid=any(pg_blocking_pids(w.pid))
          and w.query ilike '%confirm_affaire_brief_plan_choice%');`))[0];
        let answer: ReturnType<typeof callServerAction> | undefined;
        try {
          await expect.poll(async () => (await querySql(`select count(*) from pg_stat_activity where application_name='${tag}' and state='idle in transaction';`))[0]).toBe("1");
          answer = callServerAction(browser, action, { projectId, expectedUpdatedAt, plans, payerNotice: null });
          await expect.poll(pending, DEV_SERVER_WORK).toBe("1");
          expect((await bucket.update(filePath, original, { contentType: "application/pdf" })).error).toBeNull();
        } finally {
          holder.end("rollback;\n");
          expect((await holder.done).code).toBe(0);
        }
        expect(await answer).toMatchObject({ ok: false, errorCode: "TAKEOFF_BRIEF_PLAN_CHANGED",
          errorMessage: "Un plan choisi a changé ou a été retiré. Rouvrez la liste des plans avant de confirmer." });
      } else {
        // The second working copy arrived after the published dossier brief.
        await querySql("insert into private.intake_current_brief_activation(active_from) values(clock_timestamp());");
        try {
          expect(await querySql("select public.intake_current_brief_active();")).toContain("t");
          await dialog.getByRole("button", "Confirmer sans analyser", { exact: true }).click();
          await expect(dialog).toContainText("Lancez l’analyse pour actualiser le brief avant de confirmer.");
        } finally { await querySql("delete from private.intake_current_brief_activation;"); }
      }
      expect((await readOwnedBrief(projectId))?.status).toBe("a_confirmer");
      expect(await readOwnedLaunchRequests(projectId)).toEqual([]);
      expect(await readOwnedAffaireJobs(projectId)).toEqual([]);
      expect(await planReads()).toBe(before);
    } finally {
      await browser.clearCookies({ domain: new URL(localOrigin).hostname });
      await deactivateOwnedPlanDispatch();
      await rm(store, { force: true });
    }
  });
}

if (!existsSync(liveProbePath)) test("AUTO05 a running dossier analysis refuses confirmation and requires a new gesture after reconnection", {
  tags: ["critical", "local", "chatgpt", "intake", "premetre"], session: "army", trace: "off", timeout: 300_000,
}, async ({ app, screen, browser }) => {
  const owner = await createLocalChatGptOwner();
  let store = await writePlanFixture(owner.email, null, false);
  await activateOwnedPlanDispatch();
  try {
    await signInAs({ app, screen, browser }, owner.email);
    const prefix = `ARMY-auto-reconnected-${Date.now()}`;
    const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
    const ui = hydratedUi({ app, screen, browser }, localOrigin);
    const ids = await createEstimateViaWizard(ui, { projectName: prefix, title: "Classement après la confirmation" }, army);
    await uploadDossierPlan(ui, ids.projectId, `${prefix}-plan-rdc.pdf`, owner.email);
    await expect.poll(async () => (await readOwnedBrief(ids.projectId))?.status ?? null, DEV_SERVER_WORK).toBe("a_confirmer");
    // A second plan is still being classified when the member confirms: the dossier is not ready.
    await setDecisionsControl({ holdClassification: true });
    await uploadDossierPlan(ui, ids.projectId, `${prefix}-plan-etage.pdf`, owner.email, "opened", "classifying");
    const readsBefore = await planReads();
    const confirm = await openBriefConfirmation(ui, ids.projectId, owner.userId, true);
    await confirm.click();
    const dialog = screen.getByRole("alertdialog", "Confirmer ce brief ?", { exact: true });
    await expect(dialog).not.toContainText(PAYER_NOTICE);
    await dialog.getByRole("button", "Confirmer sans analyser", { exact: true }).click();
    await expect(screen.getByText("Attendez la fin de l’analyse du dossier avant de confirmer.", { exact: true }).first()).toBeVisible(DEV_SERVER_WORK);
    expect(await readOwnedLaunchRequests(ids.projectId)).toEqual([]);
    await rm(store, { force: true });
    store = await writePlanFixture(owner.email, null, false);
    await setDecisionsControl({});
    await expect.poll(async () => (await owner.client.from("affaire_intake_uploads").select("id")
      .eq("project_id", ids.projectId).in("status", ["launch_queued", "launch_processing"])).data, DEV_SERVER_WORK).toEqual([]);
    expect(await readOwnedLaunchRequests(ids.projectId)).toEqual([]);
    expect(await readOwnedAffaireJobs(ids.projectId)).toEqual([]);
    expect(await planReads()).toBe(readsBefore);
    expect(await forbiddenRequests()).toBe(0);
    await recordEvidence(army, "AUTO05-reconnected-before-ready", { ids, requests: await readOwnedLaunchRequests(ids.projectId),
      jobs: 0, planReads: 0, boundary: "Fictional dossier and ChatGPT transport fixture on an owned local backend; no API key or other provider." });
  } finally {
    await setDecisionsControl({});
    await browser.clearCookies({ domain: new URL(localOrigin).hostname });
    await deactivateOwnedPlanDispatch();
    await rm(store, { force: true });
  }
});

if (!existsSync(liveProbePath)) test("AUTO06 the affaire's zone: a reader sees why, an operator takes it on, its options relaunch without any draft", {
  tags: ["critical", "local", "chatgpt", "intake", "premetre"], session: "army", trace: "off", timeout: 420_000,
}, async ({ app, screen, browser }) => {
  const owner = await createLocalChatGptOwner();
  const director = await createLocalChatGptOwner();
  await makeOwnedDirector(owner.userId, director.userId);
  const stores = [await writePlanFixture(owner.email, null, false), await writePlanFixture(director.email, null, false)];
  await activateOwnedPlanDispatch();
  try {
    await signInAs({ app, screen, browser }, owner.email);
    const prefix = `ARMY-auto-zone-${Date.now()}`;
    const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
    const ui = hydratedUi({ app, screen, browser }, localOrigin);
    // An affaire without any version, created under the owner's own session: nothing of its takeoff may create one.
    const membership = await owner.client.from("tenant_memberships").select("tenant_id").eq("user_id", owner.userId).single();
    expect(membership.error).toBeNull();
    const created = await owner.client.from("estimate_projects")
      .insert({ tenant_id: membership.data!.tenant_id, user_id: owner.userId, name: prefix }).select("id").single();
    expect(created.error).toBeNull();
    const ids = { projectId: created.data!.id as string };
    expect(await readOwnedVersionCount(ids.projectId)).toBe(0);
    await uploadDossierPlan(ui, ids.projectId, `${prefix}-plan.pdf`, owner.email);
    await expect.poll(async () => (await readOwnedBrief(ids.projectId))?.status ?? null, DEV_SERVER_WORK).toBe("a_confirmer");
    const readsBefore = await planReads();
    // A confirmation naming the plan without a payer digest reserves only that copy.
    const plans = await ownedPlanChoices(ids.projectId);
    expect(plans).toHaveLength(1);
    const confirmed = await callServerAction(browser, await serverActionId("confirmAffaireBrief", actionManifest()),
      { projectId: ids.projectId, expectedUpdatedAt: (await readOwnedBrief(ids.projectId))!.updated_at, plans, payerNotice: null });
    expect(confirmed.ok).toBe(true);
    await expect.poll(async () => (await readOwnedLaunchRequests(ids.projectId)).map(request => [request.state, request.reason_code]),
      DEV_SERVER_WORK).toEqual([["blocked", "MANDATE_REQUIRED"]]);
    await signInAs({ app, screen, browser }, director.email);

    // The director reads why, with no gesture and no options, on a phone too; reading spends nothing.
    await browser.setViewport({ width: 390, height: 844 });
    await ui.app.open(`/dashboard/affaires/${ids.projectId}?view=overview`);
    await waitForHydration(browser);
    const zone = takeoffZone({ screen });
    await expect(zone.getByText(/la confirmation du dossier n’a engagé aucun forfait ChatGPT/)).toBeVisible(DEV_SERVER_WORK);
    await expect(zone.getByRole("button", "Prendre en charge avec mon forfait", { exact: true })).toHaveCount(0);
    await expect(zone.getByRole("button", "Options du métré", { exact: true })).toHaveCount(0);
    expect(await browser.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await browser.setViewport({ width: 1440, height: 900 });
    expect(await readOwnedAffaireJobs(ids.projectId)).toEqual([]);

    // An operator takes it on from the zone, on their own subscription: one analysis, its review and its notice there.
    await signInAs({ app, screen, browser }, owner.email);
    await ui.app.open(`/dashboard/affaires/${ids.projectId}?view=overview`);
    await waitForHydration(browser);
    await expect(screen.getByRole("button", "Préparer le métré", { exact: true })).toHaveCount(0);
    await zone.getByRole("button", "Prendre en charge avec mon forfait", { exact: true }).click();
    await expect.poll(async () => (await readOwnedLaunchRequests(ids.projectId)).map(request => [request.state, request.outcome, request.payer_id]),
      { timeout: 180_000 }).toEqual([["closed", "success", owner.userId]]);
    const [automatic] = await readOwnedAffaireJobs(ids.projectId);
    expect(automatic).toMatchObject({ estimate_version_id: null, created_by: owner.userId, status: "completed" });
    expect(await readOwnedVersionCount(ids.projectId)).toBe(0);
    await ui.browser.reload();
    await waitForHydration(browser);
    await expect(zone.getByText("Terminé", { exact: true })).toBeVisible(DEV_SERVER_WORK);
    await expect(zone.getByText("Analyse terminée", { exact: true })).toBeVisible();
    await expect(zone.getByRole("link", "Revoir l’analyse", { exact: true }))
      .toHaveAttribute("href", `/dashboard/affaires/${ids.projectId}/takeoff/${automatic!.id}/review`);

    // Its options relaunch it as a request on the clicker's subscription, without any version: no draft before the send.
    await zone.getByRole("button", "Options du métré", { exact: true }).click();
    const dialog = screen.getByRole("dialog", "Préparer le métré", { exact: true });
    const readAgain = dialog.getByRole("checkbox", new RegExp(prefix));
    await expect(readAgain).toBeVisible(DEV_SERVER_WORK);
    await expect(readAgain).not.toBeChecked();
    await readAgain.check();
    const relaunch = dialog.getByRole("button", "Relancer 1 plan avec mon forfait", { exact: true });
    await expect(relaunch).toBeEnabled(DEV_SERVER_WORK);
    await expect(dialog.getByRole("combobox", "Version cible", { exact: true })).toHaveCount(0);
    await relaunch.click();
    await expect(dialog.getByText("Analyse transmise au traitement", { exact: true })).toBeVisible(DEV_SERVER_WORK);
    await expect.poll(async () => (await readOwnedLaunchRequests(ids.projectId)).map(request => [request.origin, request.state, request.outcome]),
      { timeout: 180_000 }).toEqual([["automatic", "closed", "success"], ["manual", "closed", "success"]]);
    const jobs = await readOwnedAffaireJobs(ids.projectId);
    expect(jobs).toEqual([expect.objectContaining({ id: automatic!.id }),
      expect.objectContaining({ estimate_version_id: null, created_by: owner.userId, launch_unit_key: `plan:${plans[0].id}`, status: "completed" })]);
    expect(await readOwnedVersionCount(ids.projectId)).toBe(0);
    expect(await planReads() - readsBefore).toBe(2);

    // A former launch link of the takeoff page opens the zone's options and launches nothing.
    const [planSet] = await readPlanSets(browser, ids.projectId);
    await ui.app.open(`/dashboard/affaires/${ids.projectId}/takeoff?launch=1&launchPlanSet=${planSet!.id}`);
    await expect(screen.getByRole("dialog", "Préparer le métré", { exact: true })).toBeVisible(DEV_SERVER_WORK);
    expect(await browser.evaluate(() => `${location.pathname}${location.search}${location.hash}`))
      .toBe(`/dashboard/affaires/${ids.projectId}?view=overview&metreOptions=1&launchPlanSet=${planSet!.id}#metre`);
    expect(await readOwnedLaunchRequests(ids.projectId)).toHaveLength(2);
    expect(await readOwnedAffaireJobs(ids.projectId)).toHaveLength(2);
    expect(await readOwnedVersionCount(ids.projectId)).toBe(0);
    expect(await forbiddenRequests()).toBe(0);
    await recordEvidence(army, "AUTO06-affaire-zone", { ids, requests: await readOwnedLaunchRequests(ids.projectId), jobs,
      versions: 0, planReads: 2,
      boundary: "Fictional dossier, two owned members, ChatGPT transport fixture on an owned local backend." });
  } finally {
    await browser.setViewport({ width: 1440, height: 900 });
    await browser.clearCookies({ domain: new URL(localOrigin).hostname });
    await deactivateOwnedPlanDispatch();
    for (const store of stores) await rm(store, { force: true });
  }
});

if (!existsSync(liveProbePath)) test("AUTO07 a member who stays on the affaire while its brief arrives confirms it there and starts one analysis on their subscription", {
  tags: ["critical", "local", "chatgpt", "intake", "premetre"], session: "army", trace: "off", timeout: 300_000,
}, async ({ app, screen, browser }) => {
  const owner = await createLocalChatGptOwner();
  const store = await writePlanFixture(owner.email, null, false);
  await activateOwnedPlanDispatch();
  try {
    await signInAs({ app, screen, browser }, owner.email);
    const prefix = `ARMY-auto-stay-${Date.now()}`;
    const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
    const ui = hydratedUi({ app, screen, browser }, localOrigin);
    const ids = await createEstimateViaWizard(ui, { projectName: prefix, title: "Confirmation sur la page ouverte" }, army);
    // The member adds the plan on the affaire's page and stays there: the page is the one rendered before the brief
    // existed, marked before the plan is added, and nothing reloads it until the confirmation (the mark would be gone).
    await uploadDossierPlan(ui, ids.projectId, `${prefix}-plan-rdc.pdf`, owner.email, "empty", "classified", async () => {
      await browser.evaluate(() => { (window as unknown as { __auto07Page?: true }).__auto07Page = true; return true; });
    });
    await expect.poll(() => readOwnedPayerNoticeBasis(ids.projectId, owner.userId), DEV_SERVER_WORK)
      .toEqual({ brief: "a_confirmer", active: true, payer: true });
    expect(await readOwnedLaunchRequests(ids.projectId)).toEqual([]);
    const readsBefore = await planReads();

    // The brief reaches the page by the hub's own reads of the dossier; the member reviews it and confirms.
    await expect(screen.getByText(/^1 pièce reçue · Brief à confirmer$/)).toBeVisible(DEV_SERVER_WORK);
    await screen.getByRole("button", "Revoir le brief", { exact: true }).click();
    await screen.getByRole("button", "Confirmer le brief", { exact: true }).click();
    const dialog = screen.getByRole("alertdialog", "Confirmer ce brief ?", { exact: true });
    // Who pays is read when the dialog opens, for the brief as it is now.
    await dialog.getByRole("checkbox", /plan-rdc\.pdf/).check();
    await expect(dialog).toContainText(PAYER_NOTICE, DEV_SERVER_WORK);
    await dialog.getByRole("button", "Confirmer et analyser 1 plan", { exact: true }).click();
    expect(await browser.evaluate(() => (window as unknown as { __auto07Page?: true }).__auto07Page === true)).toBe(true);

    // One automatic request, one detailed analysis of the dossier's plan on the confirmer's subscription.
    await expect.poll(async () => (await readOwnedLaunchRequests(ids.projectId)).map(request => [request.origin, request.state, request.outcome]),
      { timeout: 180_000 }).toEqual([["automatic", "closed", "success"]]);
    const [request] = await readOwnedLaunchRequests(ids.projectId);
    expect(request).toMatchObject({ confirmed_by: owner.userId, payer_id: owner.userId, mandate_kind: "confirmation", units_expected: 1 });
    const jobs = await readOwnedAffaireJobs(ids.projectId);
    expect(jobs).toEqual([expect.objectContaining({ launch_request_id: request.id, estimate_version_id: null, created_by: owner.userId,
      status: "completed", analysis_outcome: "success" })]);
    expect(await planReads() - readsBefore).toBe(1);
    expect(await forbiddenRequests()).toBe(0);
    await recordEvidence(army, "AUTO07-confirmed-on-open-page", { ids, request, jobs, planReads: 1,
      boundary: "Fictional dossier and ChatGPT transport fixture on an owned local backend; no API key or other provider." });
  } finally {
    await browser.clearCookies({ domain: new URL(localOrigin).hostname });
    await deactivateOwnedPlanDispatch();
    await rm(store, { force: true });
  }
});
