import { readFile, rm } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, test, type Browser } from "@e2e-dev/web";
import { expect, secrets } from "e2e";

import type { ApiKeyAccessState } from "@/lib/ai/access/contracts";
import { apiRequest, createEstimateViaWizard, recordEvidence } from "../critical/fixtures";
import { hydratedUi, waitForHydration } from "../critical/hydration-support";
import { createPlanSet, ownedTakeoffJobs, uploadSamplePlan } from "../critical/plans-support";
import { takeoffZone } from "../critical/preparation-support";
import { activateOwnedPlanDispatch, deactivateOwnedPlanDispatch, fictionalPlanPdf } from "./plan-dispatch-support";
import { activateOwnedItemListOrder, deactivateOwnedItemListOrder, publishOwnedItemTemplate } from "./poste-reading-support";
import type { WorkerOwner } from "./worker-support";
import { ownedPlanChoices, readOwnedAffaireJobs, readOwnedBrief, readOwnedLaunchRequests } from "../local/automatic-start-support";
import { querySql } from "../local/calculation-gate-support";
import { chatGptLocalServer, writeDecisionsControl, writePlanFixture, type ChatGptLocalServer } from "../local/chatgpt-local-journey-support";
import { createIntakePlanActions, DEV_SERVER_WORK } from "../local/chatgpt-local-intake-support";
import { createLocalChatGptOwner, TAKEOFF_JOURNEY_WAVES } from "../local/chatgpt-server-support";
import { callServerAction, serverActionId } from "../local/engine-v3-creators-support";

const server = chatGptLocalServer({ apiKeyFixture: true });
let local: ChatGptLocalServer;
const dossier = createIntakePlanActions(() => local);
const PROFILE = "/api/ai-access/api-key";
const PLAN_NAME = "Plan plomberie fictif.pdf";
const defaultSettings = { billingSource: "personal_api_key", apiModel: "gpt-6.1-terra", apiReasoningEffort: "medium" };
const WC = "WC suspendu";
const ITEMS = [{ id: "lavabo-colonne", label: "Lavabo sur colonne", expectedUnit: "u" }, { id: "wc-suspendu", label: WC, expectedUnit: "u" }];

/**
 * The owner's tenant template made of the journey's two items (the list an affaire without a DPGF is read against), and
 * the tenant's own token ceiling for a detailed reading. A reading against the list bounds 25 calls of the vector
 * classifier beside its own (26 calls, 780 000 tokens estimated): a key's mandate carries the tenant's ceiling, and the
 * default of 400 000 tokens refuses that reading at the worker (TAKEOFF_LEVEL_C_BUDGET_EXCEEDED), whatever the plan.
 */
async function prepareItemList(userId: string) {
  const setup = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const member = await setup.from("tenant_memberships").select("tenant_id").eq("user_id", userId).single();
  if (member.error || !member.data) throw new Error("Fixture owner without a tenant.");
  await publishOwnedItemTemplate(setup, { tenantId: member.data.tenant_id, userId } as WorkerOwner, ITEMS);
  const ceiling = await setup.from("feature_flags").upsert({ tenant_id: member.data.tenant_id, flag_key: "TAKEOFF_C_MAX_TOTAL_TOKENS",
    enabled: true, value: "1000000" }, { onConflict: "tenant_id,flag_key" });
  if (ceiling.error) throw new Error("Fixture token ceiling not saved.");
}

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

async function prepareAffaire(fixtures: Parameters<typeof hydratedUi>[0], label: string) {
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
  await model.selectOption({ value: "gpt-6.2-sol" });
  await effort.selectOption({ value: "high" });
}

async function assertSealedPayingChoice(projectId: string) {
  if (!/^[0-9a-f-]{36}$/u.test(projectId)) throw new Error("Invalid fixture affaire.");
  expect(await querySql(`select distinct settings->>'model', settings->>'reasoningEffort', settings->>'maxNanoUsd'
    from private.takeoff_api_mandates where project_id = '${projectId}';`)).toEqual(["gpt-6.2-sol|high|25000000000"]);
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

  test("PAIDMETRE01 a draft's preparation sends the chosen key model under the cap shown at 375 px", options, async ({ app, screen, browser }) => {
    const { ui, army, ids } = await prepareAffaire({ app, screen, browser }, "lancement");
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
    const launch = dialog.getByRole("button", "Confirmer et lancer le métré", { exact: true });
    await launch.scrollIntoView();
    const screenshot = await app.screenshot("paidmetre01-lancement-375");
    const before = (await providerReads()).length;

    await launch.click();

    await expect(dialog.getByText("Analyse transmise au traitement", { exact: true })).toBeVisible(DEV_SERVER_WORK);
    await expect.poll(async () => (await ownedTakeoffJobs(ui.browser, ids).list()).map((job) => job.status),
      { timeout: 120_000 }).toEqual(["completed"]);
    expect((await providerReads()).slice(before)).toMatchObject([{ model: "gpt-6.2-sol", reasoningEffort: "high" }]);
    await assertSealedPayingChoice(ids.projectId);
    expect((await readProfile(ui.browser)).analysisPreferences).toMatchObject(defaultSettings);
    await recordEvidence(army, "paidmetre01-lancement", { screenshot, observed: { width: 375, ceilingUsd: 25, unchangedProfile: true } });
  });

  test("PAIDMETRE02 the brief confirms the payer notice for the specifically selected key settings", options, async ({ app, screen, browser }) => {
    await activateOwnedPlanDispatch();
    try {
      const { ui, army, ids, owner } = await prepareAffaire({ app, screen, browser }, "brief");
      await dossier.uploadDossierPlan(ui, ids.projectId, PLAN_NAME, owner.email);
      await dossier.waitForDossierAnalysis(ui, ids.projectId);
      await saveProfileKey(ui);
      await (await dossier.openBriefConfirmation(ui, ids.projectId, owner.userId, true)).click();
      const dialog = ui.screen.getByRole("alertdialog", "Confirmer ce brief ?", { exact: true });
      await dialog.getByRole("checkbox", /Plan plomberie fictif/).check();
      await showOverride(dialog);
      await expect(dialog.getByText(/Vous autorisez le métré à utiliser votre clé API OpenAI, avec un plafond de 25/)).toBeVisible();
      const screenshot = await app.screenshot("paidmetre02-brief");

      await dialog.getByRole("button", "Confirmer et analyser 1 plan", { exact: true }).click();

      await expect.poll(async () => (await readOwnedLaunchRequests(ids.projectId)).map((request) => [request.state, request.payer_id, request.mandate_kind, request.outcome]),
        { timeout: 120_000 }).toEqual([["closed", owner.userId, "confirmation", "success"]]);
      await assertSealedPayingChoice(ids.projectId);
      expect((await readOwnedBrief(ids.projectId))?.status).toBe("confirme");
      await recordEvidence(army, "paidmetre02-brief", { screenshot, observed: { ceilingUsd: 25, plans: 1 } });
    } finally {
      await deactivateOwnedPlanDispatch();
    }
  });

  test("PAIDMETRE03 the member takes the waiting plan on with their key and reads it within the shown cap", options, async ({ app, screen, browser }) => {
    await activateOwnedPlanDispatch();
    try {
      const { ui, army, ids, owner } = await prepareAffaire({ app, screen, browser }, "prise-en-charge");
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
      const screenshot = await app.screenshot("paidmetre03-prise-en-charge");

      await zone.getByRole("button", "Prendre en charge avec ma clé API", { exact: true }).click();

      await expect.poll(async () => (await readOwnedLaunchRequests(ids.projectId)).map((request) => [request.state, request.payer_id, request.outcome]),
        { timeout: 120_000 }).toEqual([["closed", owner.userId, "success"]]);
      await assertSealedPayingChoice(ids.projectId);
      await recordEvidence(army, "paidmetre03-prise-en-charge", { screenshot, observed: { ceilingUsd: 25, plans: 1 } });
    } finally {
      await deactivateOwnedPlanDispatch();
    }
  });

  test("PAIDMETRE04 relaunching a failed plan opens a fresh key choice scoped to that plan", options, async ({ app, screen, browser }) => {
    await activateOwnedPlanDispatch();
    let subscription: string | undefined;
    try {
      const { ui, army, ids, owner } = await prepareAffaire({ app, screen, browser }, "relance");
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
      const relaunch = dialog.getByRole("button", "Relancer 1 plan avec ma clé API", { exact: true });
      await relaunch.scrollIntoView();
      const screenshot = await app.screenshot("paidmetre04-relance");

      await relaunch.click();

      await expect(dialog.getByText("Analyse transmise au traitement", { exact: true })).toBeVisible(DEV_SERVER_WORK);
      await expect.poll(async () => (await readOwnedLaunchRequests(ids.projectId)).map((request) => [request.state, request.units_expected]),
        { timeout: 120_000 }).toEqual([["closed", 1], ["closed", 1]]);
      await assertSealedPayingChoice(ids.projectId);
      expect((await readOwnedLaunchRequests(ids.projectId))[1].outcome).toBe("success");
      expect((await readOwnedLaunchRequests(ids.projectId))[1].manifest_plans).toEqual((await readOwnedLaunchRequests(ids.projectId))[0].manifest_plans);
      await recordEvidence(army, "paidmetre04-relance", { screenshot, observed: { ceilingUsd: 25, plans: 1 } });
    } finally {
      await writeDecisionsControl(local.decisionsControl, {});
      if (subscription) await rm(subscription, { force: true });
      await deactivateOwnedPlanDispatch();
    }
  });

  // A new measure needs the member's own confirmed preparation and a list of items. The brief's reading on the plan
  // fails (its provider times out); the member relaunches that plan with their key from the options of the takeoff, which
  // confirms their preparation: the plan is read against the affaire's list of two items, both « not found ». The member
  // then asks a new measure of one of them from the table: the dialog shows the key, the chosen model and effort and the
  // cap, its request is sealed for that item alone and read with those settings, and the table shows the item measured.
  // The plan is a page of text: nothing of it goes to the vector classifier, whose calls the fixture does not answer.
  test("PAIDMETRE05 a new measure of one item is previewed, sealed and read with the member's key", options, async ({ app, screen, browser }) => {
    await activateOwnedPlanDispatch();
    await activateOwnedItemListOrder();
    let subscription: string | undefined;
    try {
      const { ui, army, ids, owner } = await prepareAffaire({ app, screen, browser }, "remesure");
      subscription = await writePlanFixture(owner.email, null, false);
      await prepareItemList(owner.userId);
      await dossier.uploadDossierPlan(ui, ids.projectId, PLAN_NAME, owner.email, "empty", "classified", undefined,
        await fictionalPlanPdf("Plan plomberie fictif", 1));
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
      await ui.screen.getByTestId(`takeoff-tracking-job-${failed.id}`).getByRole("button", "Relancer ce plan", { exact: true }).click();
      const relaunch = ui.screen.getByRole("dialog", "Préparer le métré", { exact: true });
      await expect(relaunch.getByRole("checkbox", /Plan plomberie fictif/)).toBeChecked(DEV_SERVER_WORK);
      await showOverride(relaunch);
      await relaunch.getByRole("button", "Relancer 1 plan avec ma clé API", { exact: true }).click();
      await expect(relaunch.getByText("Analyse transmise au traitement", { exact: true })).toBeVisible(DEV_SERVER_WORK);
      const outcomes = async () => (await readOwnedLaunchRequests(ids.projectId)).map((request) => [request.state, request.payer_id, request.outcome]);
      // Each analysis with what ended it: a reading that failed says why here, before the request's outcome is compared.
      const analyses = async () => (await querySql(`select j.status || '|' || coalesce(j.error_code, '-') || '|' || coalesce(j.error_message, '-')
        from public.takeoff_jobs j where j.project_id = '${ids.projectId}' order by j.created_at;`)).slice(1);
      await expect.poll(async () => (await outcomes()).map(([state]) => state), { timeout: 120_000 }).toEqual(["closed", "closed"]);
      expect(await analyses()).toEqual(["completed|-|-"]);
      expect((await outcomes())[1]).toEqual(["closed", owner.userId, "success"]);
      expect((await providerReads()).at(-1)).toMatchObject({ model: "gpt-6.2-sol", reasoningEffort: "high", askedItems: ITEMS.length });

      await ui.app.open(`/dashboard/affaires/${ids.projectId}/takeoff`);
      await waitForHydration(ui.browser);
      await expect(ui.screen.getByRole("table", "Postes du métré", { exact: true })).toBeVisible(DEV_SERVER_WORK);
      const row = ui.browser.locator('table[aria-label="Postes du métré"] tr').filter({ hasText: WC });
      await expect(row).toContainText("Non trouvé");
      await ui.screen.getByRole("checkbox", `Sélectionner le poste « ${WC} »`, { exact: true }).check();
      await ui.screen.getByRole("button", "Demander une nouvelle mesure (1)", { exact: true }).click();
      const dialog = ui.screen.getByRole("dialog", /mesurer de nouveau la sélection/);
      await showOverride(dialog);
      await expect(dialog.getByText(/à votre nom et avec votre clé API OpenAI/)).toBeVisible();
      await expect(ui.screen.getByTestId("poste-remeasure-reading")).toContainText("Budget réservé pour cette demande", DEV_SERVER_WORK);
      const confirm = dialog.getByRole("button", "Confirmer la demande avec ma clé API", { exact: true });
      await expect(confirm).toBeEnabled(DEV_SERVER_WORK);
      const screenshot = await app.screenshot("paidmetre05-remesure");
      const before = (await providerReads()).length;

      await confirm.click();

      await expect.poll(async () => (await outcomes()).map(([state]) => state), { timeout: 120_000 }).toEqual(["closed", "closed", "closed"]);
      expect(await analyses()).toEqual(["completed|-|-", "completed|-|-"]);
      expect((await outcomes())[2]).toEqual(["closed", owner.userId, "success"]);
      // Read once, for the item asked alone, with the model and effort chosen in the dialog.
      expect((await providerReads()).slice(before)).toMatchObject([{ model: "gpt-6.2-sol", reasoningEffort: "high", askedItems: 1 }]);
      await assertSealedPayingChoice(ids.projectId);
      expect(await querySql(`select r.mandate_selection ->> 'source' || '|' || jsonb_array_length(r.manifest #> '{order,list,asked_item_ids}')
        from public.takeoff_launch_requests r where r.project_id = '${ids.projectId}' order by r.created_at desc limit 1;`)).toEqual(["personal_api_key|1"]);
      await ui.browser.reload();
      await waitForHydration(ui.browser);
      await expect(row).toContainText("Mesuré", DEV_SERVER_WORK);
      expect((await readProfile(ui.browser)).analysisPreferences).toMatchObject(defaultSettings);
      await recordEvidence(army, "paidmetre05-remesure", { screenshot, observed: { ceilingUsd: 25, items: 1, unchangedProfile: true } });
    } finally {
      await writeDecisionsControl(local.decisionsControl, {});
      if (subscription) await rm(subscription, { force: true });
      await deactivateOwnedItemListOrder();
      await deactivateOwnedPlanDispatch();
    }
  });

  // The member confirms the brief with the notice of a ChatGPT plan that is not connected on this Mac: the request is
  // theirs, and blocked. They resume it with their key instead, at 375 px: the gesture names the key, shows its cap and
  // keeps the full width of the zone's actions; the request is then read with the settings chosen.
  test("PAIDMETRE06 the payer resumes their blocked request with their key within the cap shown at 375 px", options, async ({ app, screen, browser }) => {
    await activateOwnedPlanDispatch();
    try {
      const { ui, army, ids, owner } = await prepareAffaire({ app, screen, browser }, "reprise");
      // The transport log is the file's: this journey's reads are those after the ones already there.
      const before = (await providerReads()).length;
      await dossier.uploadDossierPlan(ui, ids.projectId, PLAN_NAME, owner.email);
      await (await dossier.openBriefConfirmation(ui, ids.projectId, owner.userId, true)).click();
      const brief = ui.screen.getByRole("alertdialog", "Confirmer ce brief ?", { exact: true });
      await brief.getByRole("checkbox", /Plan plomberie fictif/).check();
      await brief.getByRole("button", "Confirmer et analyser 1 plan", { exact: true }).click();
      const requests = async () => (await readOwnedLaunchRequests(ids.projectId))
        .map((request) => [request.state, request.reason_code, request.payer_id, request.outcome]);
      await expect.poll(requests, DEV_SERVER_WORK).toEqual([["blocked", "CHATGPT_NOT_CONNECTED", owner.userId, null]]);
      expect((await providerReads()).slice(before)).toEqual([]);
      await saveProfileKey(ui);
      await ui.browser.setViewport({ width: 375, height: 812 });
      await ui.app.open(`/dashboard/affaires/${ids.projectId}?view=overview`);
      await waitForHydration(ui.browser);
      const zone = takeoffZone(ui);
      await showOverride(zone, "les lectures reprises");
      const resume = zone.getByRole("button", "Reprendre avec ma clé API", { exact: true });
      await resume.scrollIntoView();
      // The button, its wrapper and the row of the zone's actions share one width, and the page does not scroll sideways.
      const widths = await ui.browser.evaluate(() => {
        const button = [...document.querySelectorAll("button")].find((entry) => entry.textContent?.trim() === "Reprendre avec ma clé API");
        const actions = button?.parentElement?.parentElement;
        return button && actions ? { button: Math.round(button.getBoundingClientRect().width), actions: Math.round(actions.clientWidth),
          fits: document.documentElement.scrollWidth <= document.documentElement.clientWidth } : null;
      });
      expect(widths).toMatchObject({ fits: true });
      expect(widths!.button).toBe(widths!.actions);
      expect(widths!.button).toBeGreaterThan(280);
      const screenshot = await app.screenshot("paidmetre06-reprise-375");

      await resume.click();

      await expect.poll(requests, { timeout: 120_000 }).toEqual([["closed", null, owner.userId, "success"]]);
      expect((await providerReads()).slice(before)).toMatchObject([{ model: "gpt-6.2-sol", reasoningEffort: "high" }]);
      await assertSealedPayingChoice(ids.projectId);
      await recordEvidence(army, "paidmetre06-reprise", { screenshot, observed: { width: 375, buttonWidth: widths!.button, ceilingUsd: 25, plans: 1 } });
    } finally {
      await deactivateOwnedPlanDispatch();
    }
  });
});
