import { expect } from "e2e";

import { armyTest, createEstimateViaWizard, createLineViaApi, recordEvidence, type ArmyState } from "./fixtures";
import { createPlanSet, duplicateHubVersion, markOwnedPlansAsIntake, ownedTakeoffJobs, requireLocalPlansBackend, uploadSamplePlan } from "./plans-support";

type Ui = Parameters<typeof createEstimateViaWizard>[0] & { army: ArmyState };
const options = { session: "army", trace: "off" as const, tags: ["critical", "local", "hub-auto-propose"], timeout: 180_000 };

async function openHubPrompt(ui: Ui, caseId: string) {
  requireLocalPlansBackend();
  const estimate = await createEstimateViaWizard(ui, { projectName: `${ui.army.runPrefix}-${caseId}`, title: "ARMY hub auto-propose" }, ui.army);
  // The current hub exposes its plans sidebar once the estimate has a working base.
  await createLineViaApi(ui.browser, estimate.versionId, `${ui.army.runPrefix}-BASE`);
  const set = await createPlanSet(ui, ui.army, estimate, "Plans synchronises dossier");
  const file = await uploadSamplePlan(ui, ui.army, set);
  await markOwnedPlansAsIntake(ui.army, estimate, set, file);
  await ui.app.open(`/dashboard/affaires/${estimate.projectId}`);
  const prompt = ui.screen.getByRole("region", "Proposition d'analyse automatique", { exact: true });
  const plansSection = ui.browser.locator("section").filter({ has: ui.screen.getByRole("heading", "Plans, preuves & exceptions", { exact: true }) });
  await expect(prompt).toBeVisible();
  await expect(plansSection).toBeVisible();
  await expectManualAnalysisAvailable(ui);
  return { estimate, set, file, prompt, plansSection };
}

async function expectManualAnalysisAvailable(ui: Ui) {
  await ui.screen.getByRole("button", "Plus", { exact: true }).click();
  const action = ui.screen.getByRole("menuitem", "Analyser les plans", { exact: true });
  await expect(action).toBeVisible();
  await expect(action).toBeEnabled();
  await ui.browser.keyboard.press("Escape");
  await expect(action).toBeHidden();
}

async function openLaunchDialog(ui: Ui) {
  await ui.screen.getByRole("button", "Plus", { exact: true }).click();
  await ui.screen.getByRole("menuitem", "Analyser les plans", { exact: true }).click();
  const dialog = ui.screen.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

armyTest("HUB06 a temporary prompt dismissal persists its 24-hour snooze after reload", options, async (ui) => {
  const { estimate, set, prompt } = await openHubPrompt(ui, "HUB06");
  const before = await ui.browser.evaluate(() => Date.now());
  await prompt.getByRole("button", "Me rappeler plus tard", { exact: true }).click();
  const readSnooze = () => ui.browser.evaluate((projectId) => {
    const key = Object.keys(localStorage).find((entry) => entry.startsWith("takeoff-auto-propose:v2:snooze:") && entry.endsWith(`:${projectId}:hub`));
    const value = key ? JSON.parse(localStorage.getItem(key)!) as { until: string; scopeKey: string } : null;
    return { now: Date.now(), until: value?.until ?? null, scopeKey: value?.scopeKey ?? null };
  }, estimate.projectId);
  const snooze = await readSnooze();
  const expiresAt = Date.parse(snooze.until ?? "");
  expect(expiresAt).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000);
  expect(expiresAt).toBeLessThanOrEqual(snooze.now + 24 * 60 * 60 * 1000);
  expect(snooze.scopeKey).toContain(set.id);
  expect(snooze.scopeKey).toContain(estimate.versionId);
  await expect(prompt).toBeHidden();
  await expectManualAnalysisAvailable(ui);
  await ui.browser.reload();
  await expectManualAnalysisAvailable(ui);
  await expect(prompt).toBeHidden();
  const afterReload = await readSnooze();
  expect(afterReload).toMatchObject({ until: snooze.until, scopeKey: snooze.scopeKey });
  await recordEvidence(ui.army, "HUB06-snooze", { estimate, planSetId: set.id, before, snooze, afterReload, remainsHiddenAfterReload: true });
});

armyTest("HUB07 permanent prompt dismissal keeps the manual analysis action after reload", options, async (ui) => {
  const { estimate, prompt } = await openHubPrompt(ui, "HUB07");
  await prompt.getByRole("button", "Ne pas proposer pour cette affaire", { exact: true }).click();
  await expect(prompt).toBeHidden();
  await expectManualAnalysisAvailable(ui);
  await ui.browser.reload();
  await expectManualAnalysisAvailable(ui);
  await expect(prompt).toBeHidden();
  await recordEvidence(ui.army, "HUB07-permanent-dismissal", { estimate, remainsHiddenAfterReload: true, manualActionVisible: true });
});

armyTest("HUB08 launching from the prompt persists a request and hides the prompt after reload", options, async (ui) => {
  if (process.env.E2E_ARMY_BLOCK_WORKERS !== "1") throw new Error("Auto-propose requires the campaign's worker-blocking server guard.");
  const { estimate, set, file, prompt, plansSection } = await openHubPrompt(ui, "HUB08");
  const jobs = ownedTakeoffJobs(ui.browser, estimate);
  expect(await jobs.list()).toEqual([]);
  let launchAttempted = false;
  try {
    await prompt.getByRole("radio", "Standard", { exact: true }).check();
    launchAttempted = true;
    await prompt.getByRole("button", "Analyser maintenant", { exact: true }).click();
    await expect(ui.browser.locator('[data-slot="toast"]').getByText("Analyse enregistrée, démarrage en attente", { exact: true })).toBeVisible();
    await expect.poll(async () => (await jobs.list()).length, { timeout: 45_000 }).toBe(1);
    const [job] = await jobs.list();
    expect(job).toMatchObject({ estimate_version_id: estimate.versionId, source_file_name: "sample-plan.pdf", level: "B", status: "pending" });
    await expect(prompt).toBeHidden();
    await expect(plansSection.getByRole("link", "Suivre l'analyse", { exact: true })).toBeVisible();
    await expect(plansSection.getByText("En file", { exact: true })).toBeVisible();
    await ui.browser.reload();
    await expect(plansSection).toBeVisible();
    await expect(prompt).toBeHidden();
    await expect(plansSection.getByText("En file", { exact: true })).toBeVisible();
    await expect(plansSection.getByRole("link", "Suivre l'analyse", { exact: true })).toHaveAttribute("href", `/dashboard/affaires/${estimate.projectId}/takeoff`);
    await ui.app.open(`/dashboard/affaires/${estimate.projectId}/takeoff`);
    await expect(ui.browser).toHaveURL(`/dashboard/affaires/${estimate.projectId}/takeoff`);
    await expect(ui.screen.getByText(/Jobs|Centre d'activit[ée]|Activit[ée]/i).first()).toBeVisible();
    await recordEvidence(ui.army, "HUB08-prompt-launch", { estimate, planSetId: set.id, fileId: file.id, job, hiddenAfterReload: true });
  } finally {
    if (launchAttempted) {
      await jobs.cancel();
      const remaining = await jobs.list();
      expect(remaining.every((job) => job.status === "canceled")).toBe(true);
      await recordEvidence(ui.army, "HUB08-cleanup", { estimate, jobs: remaining });
    }
  }
});

armyTest("HUB09 intake-synced plans retain provenance and analysis choices in the launch dialog", options, async (ui) => {
  const { estimate, set, plansSection } = await openHubPrompt(ui, "HUB09");
  const provenance = /synchronis|depuis le dossier|sans reupload|affaire-intake/i;
  await expect(plansSection.getByText(provenance).first()).toBeVisible();
  const dialog = await openLaunchDialog(ui);
  await expect(dialog.getByText("Jeu de plans à analyser", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Plans synchronises dossier", { exact: true })).toBeVisible();
  await expect(dialog.getByText(provenance).first()).toBeVisible();
  await expect(dialog.getByRole("combobox", "Version cible", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Niveau d'analyse", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("radio", "Standard", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("radio", "Détaillé", { exact: true })).toBeVisible();
  await recordEvidence(ui.army, "HUB09-intake-provenance", { estimate, planSetId: set.id, hubProvenance: true, dialogProvenance: true, levels: ["B", "C"] });
});

armyTest("HUB10 launch dialog selects an older version as the source of a new draft", options, async (ui) => {
  const { estimate } = await openHubPrompt(ui, "HUB10");
  const current = await duplicateHubVersion(ui.browser, ui.army, estimate);
  await ui.browser.reload();
  const dialog = await openLaunchDialog(ui);
  const selector = dialog.getByRole("combobox", "Version cible", { exact: true });
  await expect(selector).toBeVisible();
  const labels = await ui.browser.locator("#launch-metre-target-version option").allTextContents();
  expect(labels.length).toBeGreaterThan(1);
  await expect(selector).toHaveValue(current.versionId);
  await selector.selectOption({ value: estimate.versionId });
  await expect(selector).toHaveValue(estimate.versionId);
  await expect(dialog.getByRole("button", "Créer un brouillon et analyser", { exact: true })).toBeVisible();
  await recordEvidence(ui.army, "HUB10-version-target", { source: estimate, current, labels, selectedSourceVersionId: estimate.versionId });
});
