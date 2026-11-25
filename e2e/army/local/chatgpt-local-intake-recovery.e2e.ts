import { activateOwnedPlanDispatch, deactivateOwnedPlanDispatch, readOwnedPlanJobs } from "../takeoff/plan-dispatch-support";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { PDFDocument, PDFName } from "pdf-lib";
import { afterAll, beforeAll, test } from "@e2e-dev/web";
import { expect } from "e2e";

import { createEstimateViaWizard, recordEvidence } from "../critical/fixtures";
import { hydratedUi, signIn } from "../critical/hydration-support";
import { takeoffZone } from "../critical/preparation-support";
import {
  chatGptLocalServer, liveProbePath, localChatGptClient, writeDecisionsControl, writePlanFixture, type ChatGptLiveProbe, type ChatGptLocalServer,
} from "./chatgpt-local-journey-support";
import { createLocalChatGptOwner, TAKEOFF_JOURNEY_WAVES } from "./chatgpt-server-support";
import { querySql } from "./calculation-gate-support";
import { callServerAction, serverActionId } from "./engine-v3-creators-support";
import { makeOwnedDirector, ownedPlanChoices, readOwnedBrief, readOwnedLaunchRequests } from "./automatic-start-support";
import { createIntakePlanActions, DEV_SERVER_WORK } from "./chatgpt-local-intake-support";

// Interrupted dossier launches and explicitly selected plan rereads.
const server = chatGptLocalServer();
let serverState: ChatGptLocalServer;
const { signInAs, uploadDossierPlan, openBriefConfirmation, planReads, forbiddenRequests } = createIntakePlanActions(() => serverState);
let localOrigin: string;
let fixtureStore: string | undefined;
let liveProbe: ChatGptLiveProbe | null = null;
let transportLog: string;
let recoverySecret: string;
let decisionsControl: string;
let fixtureEmail: string;
let serverWorkspace: { id: string } | undefined;
const actionManifest = () => `.build/tester-army/next-${serverWorkspace!.id}/dev/server/server-reference-manifest.json`;
const localClient = () => localChatGptClient(fixtureEmail);
const setDecisionsControl = (input: Parameters<typeof writeDecisionsControl>[1]) => writeDecisionsControl(decisionsControl, input);
/** Writes the owner's temporary ChatGPT profile unless a test of this file already left one. */
async function preparePlanFixture(unsetPreferences = false) {
  if (fixtureStore) return false;
  fixtureStore = await writePlanFixture(fixtureEmail, liveProbe, unsetPreferences);
  return true;
}

beforeAll(async () => {
  serverState = await server.start();
  ({ origin: localOrigin, email: fixtureEmail, liveProbe, transportLog, recoverySecret, decisionsControl, workspace: serverWorkspace } = serverState);
});
// The dossier opens the affaire and its takeoff options. Keep the route warmups in separate hooks.
for (const wave of TAKEOFF_JOURNEY_WAVES) beforeAll(() => server.compileTakeoffRoutes(wave));
// The intake tests' own routes: in the body of the first of them, their compiles held its reclassification (INTRETRY01).
beforeAll(() => server.compileIntakeRoutes());

afterAll(() => server.stop(fixtureStore));

test("INTRIGHT01 a payer demoted during a classification loses the launch and its two unread pieces wait again", {
  tags: ["critical", "local", "chatgpt", "intake"], session: "army", timeout: 180_000,
}, async ({ app, screen, browser }) => {
  if (liveProbe) throw new Error("This journey requires the fictional transport.");
  const { client, userId: owner } = await localClient();
  const payer = await createLocalChatGptOwner();
  await makeOwnedDirector(owner, payer.userId);
  await querySql(`update public.tenant_memberships set role='admin' where user_id='${payer.userId}' and is_default`);
  const store = await writePlanFixture(payer.email, null, false);
  try {
    await setDecisionsControl({ holdClassification: true });
    await signIn({ app, screen, browser }, localOrigin, fixtureEmail);
    const name = `ARMY-intake-right-${Date.now()}`;
    const ui = hydratedUi({ app, screen, browser }, localOrigin);
    const { projectId } = await createEstimateViaWizard(ui, { projectName: name, title: name },
      { runPrefix: name, projectName: name, ownedEstimates: [] });
    await ui.app.open(`/dashboard/affaires/${projectId}?view=dossier`);
    const pdf = await readFile(path.resolve("e2e/fixtures/sample-plan.pdf"));
    const directory = path.resolve(".e2e/army/critical/artifacts/fixtures", name);
    await mkdir(directory, { recursive: true });
    const files = ["Plan A.pdf", "Plan B.pdf"].map(file => path.join(directory, file));
    await Promise.all(files.map(file => writeFile(file, Buffer.concat([pdf, Buffer.from(`\n% ${path.basename(file)}\n`)]))));
    await browser.locator('input[type="file"][aria-label="Ajouter des pièces à l\'affaire"]').first().setInputFiles(files);
    await expect(screen.getByText("2 pièces en attente de lancement", { exact: true }).first()).toBeVisible();
    await signInAs({ app, screen, browser }, payer.email);
    await ui.app.open(`/dashboard/affaires/${projectId}?view=dossier`);
    const sends = async () => (await readFile(transportLog, "utf8")).split("\n").filter(Boolean)
      .map(line => JSON.parse(line)).filter(entry => entry.provider === "chatgpt-fixture");
    const before = (await sends()).length;
    await screen.getByRole("button", "Lancer l’analyse", { exact: true }).click();
    await expect.poll(async () => (await sends()).slice(before).map(entry => entry.inputKind), DEV_SERVER_WORK)
      .toEqual(["intake-classification"]);
    await querySql(`update public.tenant_memberships set role='director' where user_id='${payer.userId}' and is_default`);
    await setDecisionsControl({});
    await expect.poll(async () => (await client.from("affaire_intake_uploads").select("status,last_error")
      .eq("project_id", projectId).eq("created_by", payer.userId).single()).data, DEV_SERVER_WORK)
      .toEqual({ status: "failed", last_error: "payer_access_lost" });
    const docs = await client.from("affaire_intake_documents").select("analysis_launch_id,classification_status")
      .eq("project_id", projectId);
    expect(docs.data).toEqual(Array(2).fill({ analysis_launch_id: null, classification_status: "awaiting_launch" }));
    expect((await sends()).slice(before).map(entry => entry.inputKind)).toEqual(["intake-classification"]);
  } finally {
    await setDecisionsControl({});
    await rm(store, { force: true });
  }
});

test("INTHOST01 a signed-out host leaves a launch for its authorised host, and an orphan can be launched again", {
  tags: ["critical", "local", "chatgpt", "intake"], session: "army", timeout: 180_000,
}, async ({ app, screen, browser }) => {
  if (liveProbe || !await preparePlanFixture()) throw new Error("A fictional plan is required.");
  const store = fixtureStore!;
  const selected = await readFile(store, "utf8");
  const signedOut = JSON.stringify({ selectedId: null, profiles: [] });
  const sweep = () => fetch(new URL("/api/internal/workflows/recover", localOrigin), { headers: { authorization: `Bearer ${recoverySecret}` } });
  try {
    await signIn({ app, screen, browser }, localOrigin, fixtureEmail);
    const name = `ARMY-host-recovery-${Date.now()}`;
    const ui = hydratedUi({ app, screen, browser }, localOrigin);
    const { projectId } = await createEstimateViaWizard(ui, { projectName: name, title: name },
      { runPrefix: name, projectName: name, ownedEstimates: [] });
    const { client } = await localClient();
    await ui.app.open(`/dashboard/affaires/${projectId}?view=dossier`);
    const depositAndReserve = async (firstDeposit: boolean) => {
      if (firstDeposit) {
        await browser.locator('input[type="file"][aria-label="Ajouter des pièces à l\'affaire"]').first()
          .setInputFiles(path.resolve("e2e/fixtures/sample-plan.pdf"));
      } else {
        const directory = path.resolve(".e2e/army/critical/artifacts/fixtures", name);
        await mkdir(directory, { recursive: true });
        const file = path.join(directory, "Plan annexe.pdf");
        const bytes = await readFile(path.resolve("e2e/fixtures/sample-plan.pdf"));
        await writeFile(file, Buffer.concat([bytes, Buffer.from("\n% Plan annexe\n")]));
        await screen.getByRole("button", "Ajouter des pièces", { exact: true }).click();
        await screen.getByRole("dialog", "Ajouter des documents", { exact: true })
          .getByLabel("Ajouter des pièces à l'affaire", { exact: true }).setInputFiles(file);
      }
      await expect(screen.getByText("1 pièce en attente de lancement", { exact: true }).first()).toBeVisible();
      // Interrupt immediately after reservation, before Next's after() takes the lot.
      const result = await client.rpc("start_affaire_intake_analysis", { p_project_id: projectId, p_read_scans: true });
      expect(result.data?.[0].outcome).toBe("launched");
      return result.data![0].launch_id;
    };
    const batch = async (id: string) => (await client.from("affaire_intake_uploads").select("status,attempt_count,last_error").eq("id", id).single()).data;
    const first = await depositAndReserve(true);
    // Both filesystem snapshots belong to this same user/tenant on two Macs.
    await writeFile(store, signedOut, { mode: 0o600 });
    await sweep();
    expect(await batch(first)).toMatchObject({ status: "launch_queued", attempt_count: 0 });
    await writeFile(store, selected, { mode: 0o600 });
    await expect.poll(async () => { await sweep(); return (await batch(first))?.status; }, DEV_SERVER_WORK).toBe("ready");
    await ui.app.open(`/dashboard/affaires/${projectId}?view=dossier`);
    const orphan = await depositAndReserve(false);
    await writeFile(store, signedOut, { mode: 0o600 });
    await querySql(`update public.affaire_intake_uploads set next_retry_at=clock_timestamp()-interval '31 minutes' where id='${orphan}'`);
    await expect.poll(async () => { await sweep(); return batch(orphan); }, DEV_SERVER_WORK)
      .toMatchObject({ status: "failed", attempt_count: 0, last_error: "connection_unavailable" });
    const waiting = await client.from("affaire_intake_documents").select("analysis_launch_id,issues")
      .eq("project_id", projectId).eq("classification_status", "awaiting_launch").single();
    expect(waiting.data).toMatchObject({ analysis_launch_id: null, issues: expect.arrayContaining([expect.stringContaining("aucune connexion ChatGPT")]) });
    await ui.app.open(`/dashboard/affaires/${projectId}?view=dossier`);
    await screen.getByRole("button", "Lancer l’analyse", { exact: true }).click();
    await expect.poll(async () => (await client.from("affaire_intake_uploads").select("status").eq("project_id", projectId)
      .eq("launch_read_scans", false).single()).data?.status, DEV_SERVER_WORK).toMatch(/^(ready|partial_failure)$/);
  } finally {
    await rm(store, { force: true });
    fixtureStore = undefined;
  }
});

test("INTPROFILE01 a second usable profile cannot take or pay for the first profile’s interrupted launch", {
  tags: ["critical", "local", "chatgpt", "intake"], session: "army", timeout: 240_000,
}, async ({ app, screen, browser }) => {
  if (liveProbe || !await preparePlanFixture()) throw new Error("Two fictional profiles are required.");
  const store = fixtureStore!;
  const saved = JSON.parse(await readFile(store, "utf8"));
  const primary = { ...saved.profiles[0], authorizationId: "army-first-grant" };
  const secondary = { ...primary, id: "army-second-profile", authorizationId: "army-second-grant", accessToken: "army-chatgpt-fixture-second" };
  const select = (id: string) => writeFile(store, JSON.stringify({ selectedId: id, profiles: [primary, secondary] }), { mode: 0o600 });
  const transport = async () => (await readFile(transportLog, "utf8")).split("\n").filter(Boolean)
    .map(line => JSON.parse(line)).filter(row => row.provider === "chatgpt-fixture" || row.provider === "decisions-fixture");
  const sends = async () => (await transport()).length;
  const sweep = () => fetch(new URL("/api/internal/workflows/recover", localOrigin), { headers: { authorization: `Bearer ${recoverySecret}` } });
  try {
    await select(primary.id);
    await querySql("insert into private.intake_current_brief_activation(active_from) values(clock_timestamp())");
    await setDecisionsControl({ holdClassification: true });
    await signIn({ app, screen, browser }, localOrigin, fixtureEmail);
    const name = `ARMY-pinned-${Date.now()}`;
    const ui = hydratedUi({ app, screen, browser }, localOrigin);
    const { projectId } = await createEstimateViaWizard(ui, { projectName: name, title: name },
      { runPrefix: name, projectName: name, ownedEstimates: [] });
    const { client } = await localClient();
    await ui.app.open(`/dashboard/affaires/${projectId}?view=dossier`);
    await browser.locator('input[type="file"]').first().setInputFiles(path.resolve("e2e/fixtures/sample-plan.pdf"));
    const before = await sends();
    await screen.getByRole("button", "Lancer l’analyse", { exact: true }).first().click();
    await expect.poll(sends, DEV_SERVER_WORK).toBe(before + 1);
    const batch = async () => (await client.from("affaire_intake_uploads").select("id,status,attempt_count,last_error")
      .eq("project_id", projectId).eq("launch_read_scans",true).single()).data!;
    const lot = (await batch()).id;
    expect(await querySql(`select profile_id || '/' || authorization_id from private.affaire_intake_launch_selections where upload_id='${lot}'`))
      .toEqual([`${primary.id}/${primary.authorizationId}`]);
    await select(secondary.id);
    await querySql(`update public.affaire_intake_uploads set processing_lease_expires_at=clock_timestamp()-interval '1 second' where id='${lot}'`);
    await setDecisionsControl({});
    await sweep();
    expect(await batch()).toMatchObject({ attempt_count: 1, status: "launch_processing" });
    expect(await sends()).toBe(before + 1);
    // Withdrawing the cut-over cannot change the payer's original mandate.
    await querySql("delete from private.intake_current_brief_activation where singleton");
    await sweep();
    expect(await batch()).toMatchObject({ attempt_count: 1, status: "launch_processing" });
    expect(await sends()).toBe(before + 1);
    await querySql(`update public.affaire_intake_uploads set processing_lease_expires_at=clock_timestamp()-interval '31 minutes' where id='${lot}'`);
    await expect.poll(async () => { await sweep(); return batch(); }, DEV_SERVER_WORK)
      .toMatchObject({ attempt_count: 1, status: "failed", last_error: "connection_unavailable" });
    expect(await sends()).toBe(before + 1);
    await ui.app.open(`/dashboard/affaires/${projectId}?view=dossier`);
    await expect(screen.getByText("Analyse interrompue. La connexion ChatGPT choisie au lancement n’est plus disponible.", { exact: true }).first()).toBeVisible();
    await querySql("insert into private.intake_current_brief_activation(active_from) values(clock_timestamp())");
    // A later deposit cannot erase the explanation for the outstanding launch.
    const late = await browser.evaluate(async project => {
      const form = new FormData();
      form.set("files", new File(["Notice fictive"], "Notice.txt", { type: "text/plain" }));
      const response = await fetch(`/api/affaires/${project}/intake/files`, { method: "POST", body: form });
      if (!response.ok) throw new Error(`Deposit failed: ${response.status}`);
      return (await response.json()).data.files[0].documentId as string;
    }, projectId);
    expect((await callServerAction(browser, await serverActionId("reclassifyAffaireDocument", actionManifest()), {
      projectId, documentId: late, category: "annexes",
    }))).toMatchObject({ status: 200, digest: null });
    await ui.app.open(`/dashboard/affaires/${projectId}?view=dossier`);
    await expect(screen.getByText("Analyse interrompue. La connexion ChatGPT choisie au lancement n’est plus disponible.", { exact: true }).first()).toBeVisible();
    await expect(screen.getByText("1 pièce en attente de lancement", { exact: true }).first()).toBeVisible();
    await screen.getByRole("button", "Lancer l’analyse", { exact: true }).first().click();
    await expect.poll(async () => (await client.from("affaire_briefs").select("id").eq("project_id",projectId)).data?.length, DEV_SERVER_WORK).toBe(1);
    await ui.app.open(`/dashboard/affaires/${projectId}?view=dossier`);
    await expect(screen.getByText("Analyse interrompue. La connexion ChatGPT choisie au lancement n’est plus disponible.", { exact: true })).toHaveCount(0);
    expect((await transport()).slice(before + 1).map(row => [row.inputKind, row.fixtureProfile])).toEqual([
      ["intake-classification", "second"], ["intake-brief", "second"],
    ]);
    expect(await querySql(`select count(*) from private.affaire_intake_launch_selections s join public.affaire_intake_uploads u on u.id=s.upload_id
      where u.project_id='${projectId}' and s.profile_id='army-second-profile' and s.authorization_id='army-second-grant'`)).toEqual(["1"]);
  } finally {
    await setDecisionsControl({});
    await querySql("delete from private.intake_current_brief_activation where singleton");
    await rm(store, { force: true });
    fixtureStore = undefined;
  }
});

async function startTwoPlanRequest({ app, screen, browser }: Parameters<typeof hydratedUi>[0],
  owner: Awaited<ReturnType<typeof createLocalChatGptOwner>>, control: Parameters<typeof setDecisionsControl>[0]) {
  await signInAs({ app, screen, browser }, owner.email);
  const prefix = `ARMY-relaunch-${Date.now()}`;
  const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
  const ui = hydratedUi({ app, screen, browser }, localOrigin);
  const { projectId } = await createEstimateViaWizard(ui, { projectName: prefix, title: "Relance de plans fictifs" }, army);
  const markedPlan = async (marker: string) => {
    const pdf = await PDFDocument.load(await readFile("e2e/fixtures/sample-plan.pdf"));
    pdf.getPage(0).node.set(PDFName.of("ArmyPlanChoice"), PDFName.of(marker));
    return pdf.save();
  };
  await uploadDossierPlan(ui, projectId, "N01.pdf", owner.email, "empty", "classified", undefined, await markedPlan("N01"));
  await uploadDossierPlan(ui, projectId, "N02.pdf", owner.email, "opened", "classified", undefined, await markedPlan("N02"));
  await expect.poll(async () => (await readOwnedBrief(projectId))?.status, DEV_SERVER_WORK).toBe("a_confirmer");
  await expect.poll(async () => (await ownedPlanChoices(projectId)).length, DEV_SERVER_WORK).toBe(2);
  const [first, second] = await ownedPlanChoices(projectId);
  expect(first && second).toBeTruthy();
  await (await openBriefConfirmation(ui, projectId, owner.userId, true)).click();
  const brief = screen.getByRole("alertdialog", "Confirmer ce brief ?", { exact: true });
  await brief.getByRole("checkbox", /N01\.pdf/).check();
  await brief.getByRole("checkbox", /N02\.pdf/).check();
  const readsBefore = await planReads();
  await setDecisionsControl(control);
  await brief.getByRole("button", "Confirmer et analyser 2 plans", { exact: true }).click();
  return { ui, army, projectId, first, second, readsBefore };
}

async function relaunchAfterProviderTimeout({ app, screen, browser }: Parameters<typeof hydratedUi>[0], untickSecond: boolean) {
  const owner = await createLocalChatGptOwner();
  const store = await writePlanFixture(owner.email, null, false);
  await activateOwnedPlanDispatch();
  try {
    const { ui, army, projectId, first, second } = await startTwoPlanRequest({ app, screen, browser }, owner, { timeoutWriting: true });
    await expect.poll(async () => (await readOwnedLaunchRequests(projectId))[0], { timeout: 180_000 }).toMatchObject({
      state: "closed", units_expected: 2, units_failed: 1, units_not_started: 1, manifest_plans: [first.id, second.id],
    });
    const failedJobs = await readOwnedPlanJobs(projectId);
    expect(failedJobs.map((job) => [job.plans, job.error_code])).toEqual([
      [[first.id], "AI_PROVIDER"], [[second.id], "TAKEOFF_USAGE_UNRECORDED"],
    ]);

    const dialog = screen.getByRole("dialog", "Préparer le métré", { exact: true });
    const n01 = dialog.getByRole("checkbox", "N01.pdf Échec", { exact: true });
    const n02 = dialog.getByRole("checkbox", "N02.pdf Non lu", { exact: true });
    const launchLabel = (count: number) => `Relancer ${count} plan${count > 1 ? "s" : ""} avec mon forfait`;
    const launchButton = (count: number) => dialog.getByRole("button", launchLabel(count), { exact: true });
    if (untickSecond) {
      await ui.app.open(`/dashboard/affaires/${projectId}/takeoff`);
      const row = screen.getByTestId(`takeoff-tracking-job-${failedJobs[1].id}`);
      await expect(row).toContainText("N02.pdf", DEV_SERVER_WORK);
      await row.getByRole("button", "Relancer ce plan", { exact: true }).click();
      await expect(n02).toBeChecked(DEV_SERVER_WORK);
      await expect(n01).not.toBeChecked();
      await expect(launchButton(1)).toBeEnabled();
      await browser.keyboard.press("Escape");
      await expect(dialog).toBeHidden(DEV_SERVER_WORK);
      expect(await readOwnedLaunchRequests(projectId)).toHaveLength(1);
    }

    await ui.app.open(`/dashboard/affaires/${projectId}?view=overview`);
    await takeoffZone({ screen }).getByRole("button", "Options du métré", { exact: true }).click();
    await expect(n01).toBeChecked(DEV_SERVER_WORK);
    await expect(n02).toBeChecked();
    await expect(launchButton(2)).toBeEnabled();
    const screenshots: string[] = [];
    if (untickSecond) {
      await n02.uncheck();
      await n01.uncheck();
      await expect(launchButton(0)).toBeDisabled();
      await expect(dialog.getByText("Cochez au moins un plan à relancer.", { exact: true })).toBeVisible();
      await n01.check();
      await expect(dialog.getByText(/^N01\.pdf · indice/)).toBeVisible();
      await expect(dialog.getByText(/^N02\.pdf · indice/)).toHaveCount(0);
    } else {
      for (const width of [1440, 390]) {
        await browser.setViewport({ width, height: 844 });
        expect(await browser.evaluate(() => {
          const frame = document.querySelector("[role=dialog]");
          if (!frame) return false;
          const bounds = frame.getBoundingClientRect();
          return bounds.left >= 0 && bounds.right <= window.innerWidth && frame.scrollWidth <= frame.clientWidth;
        })).toBe(true);
        screenshots.push(await app.screenshot(`relance-plans-${width}`));
      }
    }

    const selected = untickSecond ? [first.id] : [first.id, second.id];
    const readsBefore = await planReads();
    await setDecisionsControl({ holdPlanReading: true });
    await launchButton(selected.length).click();
    await expect(dialog.getByText("Analyse transmise au traitement", { exact: true })).toBeVisible(DEV_SERVER_WORK);
    await ui.app.open(`/dashboard/affaires/${projectId}/takeoff`);
    const coverage = screen.getByTestId("takeoff-request-coverage");
    await expect(coverage).toContainText(untickSecond ? "N01.pdf · En lecture" : "0 plan lu sur 2", DEV_SERVER_WORK);
    if (untickSecond) {
      await expect(screen.getByTestId("takeoff-request-current")).toContainText("« N02.pdf » (non lu dans cette demande)");
    }
    await setDecisionsControl({});
    await expect.poll(async () => (await readOwnedLaunchRequests(projectId))[1], { timeout: 180_000 }).toMatchObject({
      state: "closed", outcome: "success", payer_id: owner.userId, units_expected: selected.length, manifest_plans: selected,
    });
    await expect(coverage).toContainText(untickSecond ? "N01.pdf · Lu" : "2 plans lus sur 2", DEV_SERVER_WORK);
    const requests = await readOwnedLaunchRequests(projectId);
    const jobs = (await readOwnedPlanJobs(projectId)).filter((job) => job.launch_request_id === requests[1].id);
    expect(jobs.map((job) => [job.plans, job.status])).toEqual(selected.map((id) => [[id], "completed"]));
    expect(await planReads() - readsBefore).toBe(selected.length);
    expect(await forbiddenRequests()).toBe(0);
    await recordEvidence(army, untickSecond ? "RELANCE02-selection-reduite" : "RELANCE01-deux-plans", {
      projectId, requests, failedJobs, jobs, screenshots, reads: selected.length,
      boundary: "Fictional PDFs, owned backend and simulated ChatGPT transport.",
    });
  } finally {
    await setDecisionsControl({});
    await browser.clearCookies({ domain: new URL(localOrigin).hostname });
    await deactivateOwnedPlanDispatch();
    await rm(store, { force: true });
  }
}

if (!existsSync(liveProbePath)) test("RELANCE01 a failed and an unstarted plan are both checked and read on the clicker's subscription", {
  tags: ["critical", "local", "chatgpt", "intake", "premetre"], session: "army", trace: "off", timeout: 360_000,
}, (ui) => relaunchAfterProviderTimeout(ui, false));

if (!existsSync(liveProbePath)) test("RELANCE02 a plan row checks just its own plan and the affaire relaunch reads only what remains checked", {
  tags: ["critical", "local", "chatgpt", "intake", "premetre"], session: "army", trace: "off", timeout: 360_000,
}, (ui) => relaunchAfterProviderTimeout(ui, true));

if (!existsSync(liveProbePath)) test("RELANCE03 stopping a request offers its interrupted and unstarted plans and reads the checked plan", {
  tags: ["critical", "local", "chatgpt", "intake", "premetre"], session: "army", trace: "off", timeout: 360_000,
}, async ({ app, screen, browser }) => {
  const owner = await createLocalChatGptOwner();
  const store = await writePlanFixture(owner.email, null, false);
  await activateOwnedPlanDispatch();
  try {
    const { ui, projectId, first, second, readsBefore } = await startTwoPlanRequest({ app, screen, browser }, owner, { holdPlanReading: true });
    await expect.poll(async () => (await readOwnedPlanJobs(projectId)).map((job) => [job.plans, job.status]), DEV_SERVER_WORK)
      .toEqual([[[first.id], "processing"], [[second.id], "pending"]]);
    await expect.poll(planReads, DEV_SERVER_WORK).toBe(readsBefore + 1);
    const [request] = await readOwnedLaunchRequests(projectId);
    expect(await querySql(`select outcome from public.stop_takeoff_launch_request(
      (select tenant_id from public.estimate_projects where id = '${projectId}'),
      '${projectId}', '${owner.userId}', '${request.id}');`)).toContain("stopped");
    await setDecisionsControl({});
    await expect.poll(async () => (await readOwnedPlanJobs(projectId)).map((job) => job.status), DEV_SERVER_WORK)
      .toEqual(["canceled", "canceled"]);

    await ui.app.open(`/dashboard/affaires/${projectId}?view=overview`);
    await takeoffZone({ screen }).getByRole("button", "Options du métré", { exact: true }).click();
    const dialog = screen.getByRole("dialog", "Préparer le métré", { exact: true });
    const interrupted = dialog.getByRole("checkbox", /N01\.pdf.*Échec/);
    const unstarted = dialog.getByRole("checkbox", /N02\.pdf.*Non lu/);
    await expect(unstarted).toBeChecked(DEV_SERVER_WORK);
    await expect(interrupted).toBeChecked();
    await expect(dialog).toContainText("Arrêté avant le démarrage");
    await expect(dialog).toContainText("Lecture arrêtée");
    await interrupted.uncheck();
    await dialog.getByRole("button", "Relancer 1 plan avec mon forfait", { exact: true }).click();
    await expect.poll(async () => (await readOwnedLaunchRequests(projectId))[1], DEV_SERVER_WORK)
      .toMatchObject({ state: "closed", outcome: "success", manifest_plans: [second.id] });
    expect(await planReads() - readsBefore).toBe(2);
  } finally {
    await setDecisionsControl({});
    await browser.clearCookies({ domain: new URL(localOrigin).hostname });
    await deactivateOwnedPlanDispatch();
    await rm(store, { force: true });
  }
});

if (!existsSync(liveProbePath)) test("RELANCE04 a stale default is cleared before paying again and a deliberate reread can proceed", {
  tags: ["critical", "local", "chatgpt", "intake", "premetre"], session: "army", trace: "off", timeout: 360_000,
}, async ({ app, screen, browser }) => {
  const owner = await createLocalChatGptOwner();
  const store = await writePlanFixture(owner.email, null, false);
  await activateOwnedPlanDispatch();
  try {
    const { ui, projectId, first } = await startTwoPlanRequest({ app, screen, browser }, owner, { timeoutWriting: true });
    await expect.poll(async () => (await readOwnedLaunchRequests(projectId))[0], DEV_SERVER_WORK)
      .toMatchObject({ state: "closed", units_failed: 1, units_not_started: 1 });
    await setDecisionsControl({});
    const readsBefore = await planReads();
    const openRelaunch = async () => {
      await ui.app.open(`/dashboard/affaires/${projectId}?view=overview`);
      await takeoffZone({ screen }).getByRole("button", "Options du métré", { exact: true }).click();
      await expect(screen.getByRole("dialog", "Préparer le métré", { exact: true }).getByRole("checkbox", "N01.pdf Échec", { exact: true }))
        .toBeChecked(DEV_SERVER_WORK);
      await screen.getByRole("dialog", "Préparer le métré", { exact: true }).getByRole("checkbox", "N02.pdf Non lu", { exact: true }).uncheck();
    };
    const dialog = screen.getByRole("dialog", "Préparer le métré", { exact: true });
    const launch = dialog.getByRole("button", "Relancer 1 plan avec mon forfait", { exact: true });
    await openRelaunch();
    const firstTab = browser.tabs().find((tab) => tab.isActive())!;
    const other = await browser.newTab();
    try {
      await other.activate();
      await openRelaunch();
      await launch.click();
      await expect.poll(async () => (await readOwnedLaunchRequests(projectId))[1], DEV_SERVER_WORK)
        .toMatchObject({ state: "closed", outcome: "success", manifest_plans: [first.id] });
      await firstTab.activate();
      await expect(dialog.getByRole("checkbox", "N01.pdf Échec", { exact: true })).toBeChecked();
      await launch.click();
      const read = dialog.getByRole("checkbox", "N01.pdf Lu", { exact: true });
      await expect(read).toBeVisible(DEV_SERVER_WORK);
      await expect(read).not.toBeChecked();
      await expect(dialog).toContainText("La sélection a été actualisée");
      expect(await readOwnedLaunchRequests(projectId)).toHaveLength(2);
      expect(await planReads() - readsBefore).toBe(1);

      await read.check();
      await launch.click();
      await expect.poll(async () => (await readOwnedLaunchRequests(projectId))[2], DEV_SERVER_WORK)
        .toMatchObject({ state: "closed", outcome: "success", manifest_plans: [first.id] });
      expect(await planReads() - readsBefore).toBe(2);
    } finally {
      await other.close();
    }
  } finally {
    await setDecisionsControl({});
    await browser.clearCookies({ domain: new URL(localOrigin).hostname });
    await deactivateOwnedPlanDispatch();
    await rm(store, { force: true });
  }
});

if (!existsSync(liveProbePath)) test("RELANCE05 a new document generation disables the old copy before another reading", {
  tags: ["critical", "local", "chatgpt", "intake", "premetre"], session: "army", trace: "off", timeout: 360_000,
}, async ({ app, screen, browser }) => {
  const owner = await createLocalChatGptOwner();
  const store = await writePlanFixture(owner.email, null, false);
  await activateOwnedPlanDispatch();
  try {
    const { ui, projectId, first, second } = await startTwoPlanRequest({ app, screen, browser }, owner, { timeoutWriting: true });
    await expect.poll(async () => (await readOwnedLaunchRequests(projectId))[0], DEV_SERVER_WORK)
      .toMatchObject({ state: "closed", units_failed: 1, units_not_started: 1 });
    await setDecisionsControl({});
    const readsBefore = await planReads();
    await ui.app.open(`/dashboard/affaires/${projectId}?view=overview`);
    await takeoffZone({ screen }).getByRole("button", "Options du métré", { exact: true }).click();
    const dialog = screen.getByRole("dialog", "Préparer le métré", { exact: true });
    const oldPlan = dialog.getByRole("checkbox", /N01\.pdf/);
    await expect(oldPlan).toBeChecked(DEV_SERVER_WORK);

    // Simulate the interval before synchronization has replaced the old plan file and its bytes.
    const changed = await querySql(`update public.affaire_intake_documents
      set classified_at = clock_timestamp()
      where project_id = '${projectId}' and id = (
        select (metadata ->> 'intake_document_id')::uuid from public.plan_files where id = '${first.id}'
      ) returning case when plan_copy_generation::text is distinct from (
        select metadata ->> 'intake_generation' from public.plan_files where id = '${first.id}'
      ) then 'generation changed' else 'generation unchanged' end;`);
    expect(changed).toContain("generation changed");
    await dialog.getByRole("button", "Relancer 2 plans avec mon forfait", { exact: true }).click();
    const stalePlan = dialog.getByRole("checkbox", /N01\.pdf.*Copie de travail manquante/);
    await expect(stalePlan).toBeDisabled(DEV_SERVER_WORK);
    await expect(stalePlan).not.toBeChecked();
    expect(await readOwnedLaunchRequests(projectId)).toHaveLength(1);
    expect(await planReads()).toBe(readsBefore);

    await dialog.getByRole("button", "Relancer 1 plan avec mon forfait", { exact: true }).click();
    await expect.poll(async () => (await readOwnedLaunchRequests(projectId))[1], DEV_SERVER_WORK)
      .toMatchObject({ state: "closed", outcome: "success", manifest_plans: [second.id] });
    expect(await planReads() - readsBefore).toBe(1);
  } finally {
    await setDecisionsControl({});
    await browser.clearCookies({ domain: new URL(localOrigin).hostname });
    await deactivateOwnedPlanDispatch();
    await rm(store, { force: true });
  }
});
