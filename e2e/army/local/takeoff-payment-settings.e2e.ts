import { readFile, rm } from "node:fs/promises";
import { afterAll, beforeAll, describe, test, type Browser } from "@e2e-dev/web";
import { expect, secrets } from "e2e";

import type { ApiKeyAccessState } from "@/lib/ai/access/contracts";
import { apiRequest, createEstimateViaWizard, recordEvidence } from "../critical/fixtures";
import { hydratedUi, waitForHydration } from "../critical/hydration-support";
import { createPlanSet, ownedTakeoffJobs, uploadSamplePlan } from "../critical/plans-support";
import { takeoffZone } from "../critical/preparation-support";
import { activateOwnedPlanDispatch, deactivateOwnedPlanDispatch } from "../takeoff/plan-dispatch-support";
import { ownedPlanChoices, readOwnedAffaireJobs, readOwnedBrief, readOwnedLaunchRequests } from "./automatic-start-support";
import { querySql } from "./calculation-gate-support";
import { chatGptLocalServer, writeDecisionsControl, writePlanFixture, type ChatGptLocalServer } from "./chatgpt-local-journey-support";
import { createIntakePlanActions, DEV_SERVER_WORK } from "./chatgpt-local-intake-support";
import { createLocalChatGptOwner, TAKEOFF_JOURNEY_WAVES } from "./chatgpt-server-support";
import { callServerAction, serverActionId } from "./engine-v3-creators-support";

const server = chatGptLocalServer({ apiKeyFixture: true });
let local: ChatGptLocalServer;
const dossier = createIntakePlanActions(() => local);
const PROFILE = "/api/ai-access/api-key";
const PLAN_NAME = "Plan plomberie fictif.pdf";
const defaultSettings = { billingSource: "personal_api_key", apiModel: "gpt-6.1-terra", apiReasoningEffort: "medium" };

async function readProfile(browser: Browser) {
  const profile = await apiRequest<{ data: ApiKeyAccessState }>(browser, "GET", PROFILE);
  expect(profile.status).toBe(200);
  return profile.body.data;
}

async function saveProfileKey(ui: ReturnType<typeof hydratedUi>) {
  await ui.app.open("/dashboard/profile");
  await waitForHydration(ui.browser);
  const key = ui.screen.getByRole("region", "Clé API", { exact: true });
  await key.getByLabel("Clé API OpenAI", { exact: true }).fill(secrets.get("lab-api-key"));
  await key.getByRole("button", "Vérifier et enregistrer", { exact: true }).click();
  await expect(key.getByText("Clé reconnue", { exact: true })).toBeVisible(DEV_SERVER_WORK);
  const profile = await readProfile(ui.browser);
  if (profile.status !== "saved") throw new Error("Fictional key missing.");
  const { status } = await apiRequest(ui.browser, "PATCH", PROFILE, { ...defaultSettings, connectionId: profile.connection.connectionId });
  expect(status).toBe(200);
}

async function prepares(fixtures: Parameters<typeof hydratedUi>[0], label: string) {
  const owner = await createLocalChatGptOwner();
  await dossier.signInAs(fixtures, owner.email);
  const ui = hydratedUi(fixtures, local.origin);
  const prefix = `ARMY-cle-metre-${label}-${Date.now()}`;
  const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
  const ids = await createEstimateViaWizard(ui, { projectName: prefix, title: "École fictive" }, army);
  return { ui, owner, army, ids };
}

type PaymentSurface = ReturnType<Parameters<typeof hydratedUi>[0]["screen"]["getByRole"]>;

async function showOverride(surface: PaymentSurface, scope = "cette demande") {
  const source = surface.getByRole("combobox", "Source IA", { exact: true });
  const model = surface.getByRole("combobox", "Modèle", { exact: true });
  const effort = surface.getByRole("combobox", "Effort de raisonnement", { exact: true });
  await expect(source).toHaveValue("personal_api_key", DEV_SERVER_WORK);
  await expect(model).toHaveValue(defaultSettings.apiModel);
  await expect(effort).toHaveValue(defaultSettings.apiReasoningEffort);
  await expect(surface.getByText(new RegExp(`Plafond pour ${scope} avec votre clé API OpenAI.*25.*US`))).toBeVisible();
  await model.selectOption({ value: "gpt-6.1-sol" });
  await effort.selectOption({ value: "high" });
}

async function assertSealedPayingChoice(projectId: string) {
  if (!/^[0-9a-f-]{36}$/u.test(projectId)) throw new Error("Invalid fixture affaire.");
  expect(await querySql(`select distinct settings->>'model', settings->>'reasoningEffort', settings->>'maxNanoUsd'
    from private.takeoff_api_mandates where project_id = '${projectId}';`)).toEqual(["gpt-6.1-sol|high|25000000000"]);
}

async function providerReads() {
  return (await readFile(local.transportLog, "utf8")).trim().split("\n").filter(Boolean)
    .map((line) => JSON.parse(line)).filter((entry) => entry.provider === "api-key-fixture" && entry.operation === "responses" && entry.inputKind === "pdf");
}

describe("Paid takeoff request settings", () => {
  beforeAll(async () => { local = await server.start(); });
  for (const wave of TAKEOFF_JOURNEY_WAVES) beforeAll(() => server.compileTakeoffRoutes(wave));
  beforeAll(() => server.compileIntakeRoutes());
  afterAll(() => server.stop());

  const options = { tags: ["critical", "local", "chatgpt", "premetre"], session: "army", trace: "off", timeout: 300_000 } as const;

  test("PAIDMETRE01 a draft's preparation sends the chosen key model under the cap shown at 375 px", options, async (fixtures) => {
    const { ui, army, ids } = await prepares(fixtures, "lancement");
    const plans = await createPlanSet(ui, army, ids, "Plans fictifs");
    await uploadSamplePlan(ui, army, plans);
    await saveProfileKey(ui);
    await ui.browser.setViewport({ width: 375, height: 812 });
    await ui.app.open(`/dashboard/affaires/${ids.projectId}?view=estimate`);
    await waitForHydration(ui.browser);
    await takeoffZone(ui).getByRole("button", "Options du métré", { exact: true }).click();
    const dialog = ui.screen.getByRole("dialog", "Préparer le métré", { exact: true });
    await showOverride(dialog);
    expect(await ui.browser.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const screenshot = await fixtures.app.screenshot("paidmetre01-lancement-375");
    const before = (await providerReads()).length;

    await dialog.getByRole("button", "Confirmer et lancer le métré", { exact: true }).click();

    await expect(dialog.getByText("Analyse transmise au traitement", { exact: true })).toBeVisible(DEV_SERVER_WORK);
    await expect.poll(async () => (await ownedTakeoffJobs(ui.browser, ids).list()).map((job) => job.status),
      { timeout: 120_000 }).toEqual(["completed"]);
    expect((await providerReads()).slice(before)).toMatchObject([{ model: "gpt-6.1-sol", reasoningEffort: "high" }]);
    await assertSealedPayingChoice(ids.projectId);
    expect((await readProfile(ui.browser)).analysisPreferences).toMatchObject(defaultSettings);
    await recordEvidence(army, "paidmetre01-lancement", { screenshot, observed: { width: 375, ceilingUsd: 25, unchangedProfile: true } });
  });

  test("PAIDMETRE02 the brief confirms the payer notice for the specifically selected key settings", options, async (fixtures) => {
    await activateOwnedPlanDispatch();
    try {
      const { ui, army, ids, owner } = await prepares(fixtures, "brief");
      await dossier.uploadDossierPlan(ui, ids.projectId, PLAN_NAME, owner.email);
      await dossier.waitForDossierAnalysis(ui, ids.projectId);
      await saveProfileKey(ui);
      await (await dossier.openBriefConfirmation(ui, ids.projectId, owner.userId, true)).click();
      const dialog = ui.screen.getByRole("alertdialog", "Confirmer ce brief ?", { exact: true });
      await dialog.getByRole("checkbox", /Plan plomberie fictif/).check();
      await showOverride(dialog);
      await expect(dialog.getByText(/Vous autorisez le métré à utiliser votre clé API OpenAI, avec un plafond de 25/)).toBeVisible();
      const screenshot = await fixtures.app.screenshot("paidmetre02-brief");

      await dialog.getByRole("button", "Confirmer et analyser 1 plan", { exact: true }).click();

      await expect.poll(async () => (await readOwnedLaunchRequests(ids.projectId)).map((request) => [request.state, request.payer_id, request.mandate_kind]),
        { timeout: 120_000 }).toEqual([["closed", owner.userId, "confirmation"]]);
      await assertSealedPayingChoice(ids.projectId);
      expect((await readOwnedBrief(ids.projectId))?.status).toBe("confirme");
      await recordEvidence(army, "paidmetre02-brief", { screenshot, observed: { ceilingUsd: 25, plans: 1 } });
    } finally {
      await deactivateOwnedPlanDispatch();
    }
  });

  test("PAIDMETRE03 the member takes the waiting plan on with their key and reads it within the shown cap", options, async (fixtures) => {
    await activateOwnedPlanDispatch();
    try {
      const { ui, army, ids, owner } = await prepares(fixtures, "prise-en-charge");
      await dossier.uploadDossierPlan(ui, ids.projectId, PLAN_NAME, owner.email);
      await dossier.openBriefConfirmation(ui, ids.projectId, owner.userId, true);
      const brief = (await readOwnedBrief(ids.projectId))!;
      const manifest = `.build/tester-army/next-${local.workspace.id}/dev/server/server-reference-manifest.json`;
      const reserved = await callServerAction(ui.browser, await serverActionId("confirmAffaireBrief", manifest),
        { projectId: ids.projectId, expectedUpdatedAt: brief.updated_at, plans: await ownedPlanChoices(ids.projectId), payerNotice: null });
      expect(reserved.ok).toBe(true);
      await expect.poll(async () => (await readOwnedLaunchRequests(ids.projectId)).map((request) => request.reason_code),
        DEV_SERVER_WORK).toEqual(["MANDATE_REQUIRED"]);
      await saveProfileKey(ui);
      await ui.app.open(`/dashboard/affaires/${ids.projectId}?view=overview`);
      const zone = takeoffZone(ui);
      await showOverride(zone, "les lectures que vous prenez en charge");
      const screenshot = await fixtures.app.screenshot("paidmetre03-prise-en-charge");

      await zone.getByRole("button", "Prendre en charge avec ma clé API", { exact: true }).click();

      await expect.poll(async () => (await readOwnedLaunchRequests(ids.projectId)).map((request) => [request.state, request.payer_id]),
        { timeout: 120_000 }).toEqual([["closed", owner.userId]]);
      await assertSealedPayingChoice(ids.projectId);
      await recordEvidence(army, "paidmetre03-prise-en-charge", { screenshot, observed: { ceilingUsd: 25, plans: 1 } });
    } finally {
      await deactivateOwnedPlanDispatch();
    }
  });

  test("PAIDMETRE04 relaunching a failed plan opens a fresh key choice scoped to that plan", options, async (fixtures) => {
    await activateOwnedPlanDispatch();
    let subscription: string | undefined;
    try {
      const { ui, army, ids, owner } = await prepares(fixtures, "relance");
      subscription = await writePlanFixture(owner.email, null, false);
      await dossier.uploadDossierPlan(ui, ids.projectId, PLAN_NAME, owner.email);
      await (await dossier.openBriefConfirmation(ui, ids.projectId, owner.userId, true)).click();
      const brief = ui.screen.getByRole("alertdialog", "Confirmer ce brief ?", { exact: true });
      await brief.getByRole("checkbox", /Plan plomberie fictif/).check();
      await writeDecisionsControl(local.decisionsControl, { timeoutWriting: true });
      await brief.getByRole("button", "Confirmer et analyser 1 plan", { exact: true }).click();
      await expect.poll(async () => (await readOwnedLaunchRequests(ids.projectId))[0],
        { timeout: 120_000 }).toMatchObject({ state: "closed", units_failed: 1 });
      await writeDecisionsControl(local.decisionsControl, {});
      const [failed] = await readOwnedAffaireJobs(ids.projectId);
      await saveProfileKey(ui);
      await ui.app.open(`/dashboard/affaires/${ids.projectId}/takeoff`);
      const row = ui.screen.getByTestId(`takeoff-tracking-job-${failed.id}`);
      await row.getByRole("button", "Relancer ce plan", { exact: true }).click();
      const dialog = ui.screen.getByRole("dialog", "Préparer le métré", { exact: true });
      await expect(dialog.getByRole("checkbox", /Plan plomberie fictif/)).toBeChecked(DEV_SERVER_WORK);
      await showOverride(dialog);
      const screenshot = await fixtures.app.screenshot("paidmetre04-relance");

      await dialog.getByRole("button", "Relancer 1 plan avec ma clé API", { exact: true }).click();

      await expect(dialog.getByText("Analyse transmise au traitement", { exact: true })).toBeVisible(DEV_SERVER_WORK);
      await expect.poll(async () => (await readOwnedLaunchRequests(ids.projectId)).map((request) => [request.state, request.units_expected]),
        { timeout: 120_000 }).toEqual([["closed", 1], ["closed", 1]]);
      await assertSealedPayingChoice(ids.projectId);
      expect((await readOwnedLaunchRequests(ids.projectId))[1].manifest_plans).toEqual((await readOwnedLaunchRequests(ids.projectId))[0].manifest_plans);
      await recordEvidence(army, "paidmetre04-relance", { screenshot, observed: { ceilingUsd: 25, plans: 1 } });
    } finally {
      await writeDecisionsControl(local.decisionsControl, {});
      if (subscription) await rm(subscription, { force: true });
      await deactivateOwnedPlanDispatch();
    }
  });
});
