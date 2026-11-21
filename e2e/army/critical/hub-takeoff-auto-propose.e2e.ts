import { expect } from "e2e";

import { armyTest, createEstimateViaWizard, createLineViaApi, recordEvidence, type ArmyState } from "./fixtures";
import { waitForHydration } from "./hydration-support";
import { createPlanSet, duplicateHubVersion, markOwnedPlansAsIntake, ownedTakeoffJobs, requireLocalPlansBackend, uploadSamplePlan } from "./plans-support";
import { fillTakeoffPreparation, openTakeoffOptionsDialog, openTakeoffPreparation, takeoffZone } from "./preparation-support";

type Ui = Parameters<typeof createEstimateViaWizard>[0] & { army: ArmyState };
const options = { session: "army", trace: "off" as const, tags: ["critical", "local", "hub-auto-propose"], timeout: 180_000 };

// The takeoff of an affaire has one place on its page, its zone (lot 2): its state, the access to its options and,
// once the automatic start is on, the gesture its request allows. The former proposal, its 24-hour snooze and its
// permanent dismissal are gone; every former « Préparer le métré » leads to the zone and launches nothing. This
// campaign runs before the automatic start is activated: the options still launch on a version.
async function openHubZone(ui: Ui, caseId: string, syncedIntake = false) {
  requireLocalPlansBackend();
  const estimate = await createEstimateViaWizard(ui, { projectName: `${ui.army.runPrefix}-${caseId}`, title: "ARMY zone du métré" }, ui.army);
  // The current hub exposes its plans sidebar once the estimate has a working base.
  await createLineViaApi(ui.browser, estimate.versionId, `${ui.army.runPrefix}-BASE`);
  const set = await createPlanSet(ui, ui.army, estimate, "Plans synchronises dossier");
  const file = await uploadSamplePlan(ui, ui.army, set);
  if (syncedIntake) await markOwnedPlansAsIntake(ui.army, estimate, set, file);
  await ui.app.open(`/dashboard/affaires/${estimate.projectId}#plans`);
  await waitForHydration(ui.browser);
  const zone = takeoffZone(ui);
  const plansSection = ui.browser.locator("section").filter({ has: ui.screen.getByRole("heading", "Plans, preuves & exceptions", { exact: true }) });
  await expect(zone).toBeVisible();
  await expect(plansSection).toBeVisible();
  return { estimate, set, file, zone, plansSection };
}

async function readAutoProposeKeys(ui: Ui) {
  return ui.browser.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("takeoff-auto-propose")));
}

armyTest("HUB06 the takeoff's zone stays after a reload: no snooze, no dismissal, nothing launched by reading it", options, async (ui) => {
  const { estimate, set, zone } = await openHubZone(ui, "HUB06");
  const jobs = ownedTakeoffJobs(ui.browser, estimate);
  await expect(zone.getByText("Non démarré", { exact: true })).toBeVisible();
  await expect(zone.getByText("Aucune analyse des plans pour le moment. Lancez-la depuis les options du métré.", { exact: true })).toBeVisible();
  await expect(ui.screen.getByRole("button", "Me rappeler plus tard", { exact: true })).toHaveCount(0);
  await expect(ui.screen.getByRole("button", "Ne plus proposer pour cette affaire", { exact: true })).toHaveCount(0);
  await expect(ui.screen.getByRole("region", "Préparation du métré", { exact: true })).toHaveCount(0);
  await ui.browser.reload();
  await waitForHydration(ui.browser);
  await expect(zone).toBeVisible();
  await expect(zone.getByRole("button", "Options du métré", { exact: true })).toBeVisible();
  expect(await readAutoProposeKeys(ui)).toEqual([]);
  expect(await jobs.list()).toEqual([]);
  await recordEvidence(ui.army, "HUB06-zone-persistent", { estimate, planSetId: set.id, snoozeKeys: [], jobsAfterReads: 0 });
});

armyTest("HUB07 every former launch of the affaire leads to its zone, by keyboard too, and launches nothing", options, async (ui) => {
  const { estimate, zone, plansSection } = await openHubZone(ui, "HUB07");
  const jobs = ownedTakeoffJobs(ui.browser, estimate);
  await expect(ui.screen.getByRole("button", "Préparer le métré", { exact: true })).toHaveCount(0);
  // The « Plus » menu, by keyboard: its item focuses the zone.
  const more = ui.screen.getByRole("button", "Plus", { exact: true });
  await more.focus();
  await ui.browser.keyboard.press("Enter");
  const item = ui.screen.getByRole("menuitem", "État du métré", { exact: true });
  await expect(item).toBeVisible();
  await expect(ui.screen.getByRole("menuitem", "Préparer le métré", { exact: true })).toHaveCount(0);
  await item.focus();
  await ui.browser.keyboard.press("Enter");
  await expect(zone).toBeFocused();
  // The plans card leads there too.
  await plansSection.getByRole("button", "État du métré", { exact: true }).click();
  await expect(zone).toBeFocused();
  // The overview shows the same zone; its anchor lands on it from a link or a bookmark.
  await ui.app.open(`/dashboard/affaires/${estimate.projectId}#metre`);
  await waitForHydration(ui.browser);
  await expect(ui.screen.getByRole("navigation", "Navigation de l'affaire", { exact: true })
    .getByRole("button", "Vue d’ensemble", { exact: true })).toHaveAttribute("aria-current", "page");
  await expect(zone).toBeFocused();
  expect(await jobs.list()).toEqual([]);
  await recordEvidence(ui.army, "HUB07-zone-entries", { estimate, entries: ["menu", "plans-card", "anchor"], keyboard: true, jobs: 0 });
});

armyTest("HUB08 without a local plan the zone's options keep the preparation and create no request", options, async (ui) => {
  if (process.env.E2E_ARMY_BLOCK_WORKERS !== "1") throw new Error("The takeoff's zone requires the campaign's worker-blocking server guard.");
  const { estimate, set, file } = await openHubZone(ui, "HUB08");
  const jobs = ownedTakeoffJobs(ui.browser, estimate);
  expect(await jobs.list()).toEqual([]);
  await openTakeoffPreparation(ui);
  const dialog = await fillTakeoffPreparation(ui, { sources: [file.file_name] });
  await dialog.getByRole("button", "Confirmer et lancer le métré", { exact: true }).click();
  await expect(dialog.getByText(/forfait ChatGPT.*local/i).first()).toBeVisible();
  expect(await jobs.list()).toEqual([]);
  await recordEvidence(ui.army, "HUB08-zone-blocked", { estimate, planSetId: set.id, fileId: file.id, noJobCreated: true,
    boundary: "Successful plan-set creation and persisted snapshot are covered by LOCAL02 on a dedicated local server." });
});

armyTest("HUB09 intake-synced plans retain provenance and analysis choices in the zone's options", options, async (ui) => {
  const { estimate, set, plansSection } = await openHubZone(ui, "HUB09", true);
  const provenance = /synchronis|depuis le dossier|sans reupload|affaire-intake/i;
  await expect(plansSection.getByText(provenance).first()).toBeVisible();
  const dialog = await openTakeoffOptionsDialog(ui);
  await expect(dialog.getByLabel("Jeu de plans à analyser", { exact: true })).toHaveValue(set.id);
  await expect(dialog.getByText("Plans synchronisés depuis les pièces confirmées du dossier. Toutes les pages des plans retenus sont analysées par défaut.", { exact: true })).toBeVisible();
  // Before the automatic start is activated, the options still launch on a version.
  await expect(dialog.getByRole("combobox", "Version cible", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Analyse détaillée avec votre forfait ChatGPT", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("radio", "Standard", { exact: true })).toHaveCount(0);
  await recordEvidence(ui.army, "HUB09-intake-provenance", { estimate, planSetId: set.id, hubProvenance: true, dialogProvenance: true, level: "C" });
});

armyTest("HUB10 before the automatic start, the zone's options still copy an older version into a new draft only at launch", options, async (ui) => {
  const { estimate } = await openHubZone(ui, "HUB10");
  const current = await duplicateHubVersion(ui.browser, ui.army, estimate);
  await ui.browser.reload();
  await waitForHydration(ui.browser);
  const dialog = await openTakeoffOptionsDialog(ui);
  const selector = dialog.getByRole("combobox", "Version cible", { exact: true });
  await expect(selector).toBeVisible();
  const labels = await ui.browser.locator("#launch-metre-target-version option").allTextContents();
  expect(labels.length).toBeGreaterThan(1);
  await expect(selector).toHaveValue(current.versionId);
  await selector.selectOption({ value: estimate.versionId });
  await expect(selector).toHaveValue(estimate.versionId);
  await expect(dialog.getByText("Un nouveau brouillon sera créé depuis V1 avant lancement.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", "Confirmer et lancer le métré", { exact: true })).toBeEnabled();
  await recordEvidence(ui.army, "HUB10-version-target", { source: estimate, current, labels, selectedSourceVersionId: estimate.versionId,
    boundary: "Once the automatic start is on, the options launch a request without a version: AUTO06 (local) checks that no draft exists before the send." });
});
