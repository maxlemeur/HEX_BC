import { expect } from "e2e";

import type { TakeoffPreparation } from "../../../src/lib/takeoff/preparation";

import { localClient } from "../takeoff/native-ui";
import { armyTest, createEstimateViaWizard, createLineViaApi, recordEvidence, type ArmyState } from "./fixtures";
import { createPlanSet, ownedTakeoffJobs, requireLocalPlansBackend, uploadSamplePlan } from "./plans-support";
import { fillTakeoffPreparation, openTakeoffPreparation, saveTakeoffPreparation } from "./preparation-support";

type Ui = Parameters<typeof createEstimateViaWizard>[0] & { army: ArmyState };
type PreparationRow = {
  revision: number;
  draft: TakeoffPreparation;
  confirmed_at: string | null;
  confirmed_snapshot: { preparation_revision: number; preparation: TakeoffPreparation } | null;
};
const options = { session: "army", trace: "off" as const, tags: ["critical", "local", "hub-launch", "premetre"], timeout: 180_000 };

async function setup(ui: Ui, caseId: string) {
  requireLocalPlansBackend();
  if (process.env.E2E_ARMY_BLOCK_WORKERS !== "1") throw new Error("Premetre requires the campaign's worker-blocking server guard.");
  const estimate = await createEstimateViaWizard(ui, { projectName: `${ui.army.runPrefix}-${caseId}`, title: "Préparation du métré" }, ui.army);
  await createLineViaApi(ui.browser, estimate.versionId, `${ui.army.runPrefix}-BASE`);
  const planSet = await createPlanSet(ui, ui.army, estimate, `${ui.army.runPrefix} plans`);
  const file = await uploadSamplePlan(ui, ui.army, planSet);
  await ui.app.open(`/dashboard/affaires/${estimate.projectId}`);
  await expect(ui.screen.getByRole("heading", "Ajoutez le dossier de consultation", { exact: true })).toHaveCount(0);
  await expect(ui.screen.getByRole("button", "Préparer le métré", { exact: true })).toHaveCount(1);
  const dialog = await openTakeoffPreparation(ui);
  const { client } = await localClient();
  const read = async () => {
    const result = await client.from("takeoff_preparations").select("revision,draft,confirmed_at,confirmed_snapshot").eq("project_id", estimate.projectId).single();
    if (result.error) throw new Error(`Owned preparation read failed: ${result.error.code}`);
    return result.data as PreparationRow;
  };
  return { estimate, planSet, file, dialog, client, read, jobs: ownedTakeoffJobs(ui.browser, estimate) };
}

armyTest("HUB01 retained PDF counting preparation persists exclusions and one immutable Standard request", options, async (ui) => {
  const { estimate, planSet, file, read, jobs, client } = await setup(ui, "HUB01");
  let launched = false;
  try {
    let dialog = await fillTakeoffPreparation(ui, { sources: [file.file_name] });
    await expect(dialog.getByRole("button", "Confirmer et lancer le métré", { exact: true })).toBeEnabled();
    await dialog.getByRole("button", /Mes documents$/).click();
    const documentsScreenshot = await ui.app.screenshot("HUB01-preparation-documents");
    await dialog.getByRole("button", /Points à préciser$/).click();
    const questionsScreenshot = await ui.app.screenshot("HUB01-preparation-questions");
    await dialog.getByRole("button", /Vérifier et lancer$/).click();
    const summaryScreenshot = await ui.app.screenshot("HUB01-preparation-summary");
    await saveTakeoffPreparation(ui);
    const saved = await read();
    expect(saved.draft).toMatchObject({ objective: "count", objective_confirmed: true,
      scope: { levels: ["R+1"], zones: ["Zone 1"], exclusions: ["RDC", "Zone 2"], confirmed: true },
      conventions: { unit: "u", measurement_basis: "documented", calibration: null },
      destination: { estimate_version_id: estimate.versionId } });
    expect(saved.draft.sources.filter((source) => source.active).map((source) => source.kind)).toEqual(["plan"]);
    expect(saved.confirmed_at).toBeNull();
    expect(saved.confirmed_snapshot).toBeNull();
    expect(await jobs.list()).toEqual([]);

    await ui.browser.reload();
    dialog = await openTakeoffPreparation(ui);
    await dialog.getByRole("button", /Ce que je veux mesurer$/).click();
    await expect(dialog.getByLabel("Objectif du métré", { exact: true })).toHaveValue("count");
    await expect(dialog.getByLabel("Exclusions", { exact: true })).toHaveValue("RDC, Zone 2");
    await expect(dialog.getByLabel("Je confirme ce périmètre", { exact: true })).toBeChecked();
    await dialog.getByRole("button", /Vérifier et lancer$/).click();
    await expect(dialog.getByLabel("Version cible", { exact: true })).toHaveValue(estimate.versionId);
    await dialog.getByText("Options avancées", { exact: true }).click();
    await dialog.getByRole("radio", "Standard", { exact: true }).check();
    launched = true;
    await dialog.getByRole("button", "Confirmer et lancer le métré", { exact: true }).click();
    await expect.poll(async () => (await jobs.list()).length, { timeout: 45_000 }).toBe(1);
    const [job] = await jobs.list();
    expect(job).toMatchObject({ estimate_version_id: estimate.versionId, level: "B", source_file_name: "sample-plan.pdf" });
    const storedJob = await client.from("takeoff_jobs").select("preparation_snapshot").eq("id", job.id).single();
    expect(storedJob.error).toBeNull();
    const snapshot = storedJob.data!.preparation_snapshot as NonNullable<PreparationRow["confirmed_snapshot"]>;
    expect({ ...snapshot.preparation, sources: [] }).toEqual({ ...saved.draft, sources: [] });
    expect(snapshot.preparation.sources.map((source) => ({ ...source, content_hash: null })))
      .toEqual(saved.draft.sources.map((source) => ({ ...source, content_hash: null })));
    expect(snapshot.preparation.sources[0].content_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.preparation_revision).toBeGreaterThan(saved.revision);
    expect(snapshot.preparation.sources.filter((source) => source.active)).toHaveLength(1);
    expect(snapshot.preparation.sources[0]).toMatchObject({ document_id: file.id, revision: "A", plan_set_id: planSet.id });
    await recordEvidence(ui.army, "HUB01-preparation-snapshot", { estimate, planSetId: planSet.id, file, saved, job, snapshot,
      screenshots: [documentsScreenshot, questionsScreenshot, summaryScreenshot],
      boundary: "Real manual preparation, persistence and launch snapshot; no external AI or worker measurement runs. Plan-only counting needs neither DPGF nor calibration." });
    await jobs.cancel();
    const activityPath = `/dashboard/affaires/${estimate.projectId}/takeoff`;
    const activityLink = dialog.getByRole("link", /Centre d'activit/i);
    await expect(activityLink).toHaveAttribute("href", activityPath);
    await activityLink.click();
    await expect(ui.browser).toHaveURL(activityPath);
    const canceled = await jobs.list();
    expect(canceled).toEqual([expect.objectContaining({ id: job.id, status: "canceled" })]);
    await ui.browser.reload();
    expect(await jobs.list()).toEqual(canceled);
    expect((await client.from("takeoff_jobs").select("preparation_snapshot").eq("id", job.id).single()).data!.preparation_snapshot).toEqual(snapshot);
  } finally {
    if (launched) await jobs.cancel();
    await recordEvidence(ui.army, "HUB01-fixture", { estimate, planSetId: planSet.id, fileId: file.id, jobs: await jobs.list() });
  }
});

armyTest("PRE01 geometry requires a usable measurement basis and DPGF is required only for comparison", options, async (ui) => {
  const { estimate, file, jobs } = await setup(ui, "PRE01");
  const dialog = await fillTakeoffPreparation(ui, { sources: [file.file_name], objective: "measure_length", unit: "m" });
  const launch = dialog.getByRole("button", "Confirmer et lancer le métré", { exact: true });
  await expect(launch).toBeDisabled();
  await expect(dialog.getByText("Une mesure géométrique nécessite des cotes fiables ou une calibration.", { exact: true })).toBeVisible();
  await dialog.getByRole("button", /Points à préciser$/).click();
  await dialog.getByLabel("Base de mesure", { exact: true }).selectOption({ value: "dimensioned" });
  await dialog.getByLabel("Je confirme les conventions de mesure", { exact: true }).check();
  await dialog.getByRole("button", /Vérifier et lancer$/).click();
  await expect(launch).toBeEnabled();
  await dialog.getByRole("button", /Ce que je veux mesurer$/).click();
  await dialog.getByLabel("Objectif du métré", { exact: true }).selectOption({ value: "compare_dpgf" });
  await dialog.getByLabel("Je confirme cet objectif", { exact: true }).check();
  await dialog.getByRole("button", /Points à préciser$/).click();
  await dialog.getByLabel("Je confirme les conventions de mesure", { exact: true }).check();
  await dialog.getByRole("button", /Vérifier et lancer$/).click();
  await expect(launch).toBeDisabled();
  await expect(dialog.getByText("La comparaison nécessite le DPGF de référence.", { exact: true })).toBeVisible();
  expect(await jobs.list()).toEqual([]);
  await saveTakeoffPreparation(ui);
  await recordEvidence(ui.army, "PRE01-conditional-prerequisites", { estimate, noJobCreated: true, geometricWithoutCalibrationBlocked: true, dimensionedGeometryReady: true, comparisonWithoutDpgfBlocked: true });
});

armyTest("PRE02 purchase preparation retains unknown losses across reload and accepts an explicit zero", options, async (ui) => {
  const { estimate, file, read, jobs } = await setup(ui, "PRE02");
  let dialog = await fillTakeoffPreparation(ui, { sources: [file.file_name], objective: "prepare_purchase", unit: "m" });
  await dialog.getByRole("button", /Points à préciser$/).click();
  await dialog.getByLabel("Déductions", { exact: true }).fill("Aucune déduction");
  await dialog.getByLabel("Arrondi d'achat", { exact: true }).fill("Au mètre supérieur");
  await dialog.getByLabel("Conditionnement", { exact: true }).fill("Barres de 3 m");
  await expect(dialog.getByLabel("Pertes (%)", { exact: true })).toHaveValue("");
  await dialog.getByLabel("Je confirme les conventions de mesure", { exact: true }).check();
  await saveTakeoffPreparation(ui);
  expect((await read()).draft.conventions.purchase?.waste_percent).toBeNull();
  await ui.browser.reload();
  dialog = await openTakeoffPreparation(ui);
  await dialog.getByRole("button", /Points à préciser$/).click();
  await expect(dialog.getByLabel("Pertes (%)", { exact: true })).toHaveValue("");
  await dialog.getByRole("button", /Vérifier et lancer$/).click();
  await expect(dialog.getByRole("button", "Confirmer et lancer le métré", { exact: true })).toBeDisabled();
  await expect(dialog.getByText(/zéro perte doit être indiqué explicitement/)).toBeVisible();
  await dialog.getByRole("button", /Points à préciser$/).click();
  await dialog.getByLabel("Pertes (%)", { exact: true }).fill("0");
  await dialog.getByLabel("Je confirme les conventions de mesure", { exact: true }).check();
  await saveTakeoffPreparation(ui);
  const persisted = await read();
  expect(persisted.draft.conventions.purchase).toEqual({ deductions: "Aucune déduction", waste_percent: 0, rounding: "Au mètre supérieur", packaging: "Barres de 3 m" });
  await dialog.getByRole("button", /Vérifier et lancer$/).click();
  await expect(dialog.getByRole("button", "Confirmer et lancer le métré", { exact: true })).toBeEnabled();
  expect(await jobs.list()).toEqual([]);
  await recordEvidence(ui.army, "PRE02-unknown-and-zero", { estimate, persisted, unknownLossesSurviveReload: true, explicitZeroReady: true });
});

armyTest("PRE03 a source changed after preparation blocks launch and retains the recorded scope", options, async (ui) => {
  const { estimate, file, read, jobs, client } = await setup(ui, "PRE03");
  const dialog = await fillTakeoffPreparation(ui, { sources: [file.file_name] });
  await saveTakeoffPreparation(ui);
  const before = await read();
  const changed = await client.from("plan_files").update({ file_hash: "b".repeat(64) }).eq("id", file.id).select("id,file_hash").single();
  expect(changed.error).toBeNull();
  expect(changed.data!.file_hash).toBe("b".repeat(64));
  await dialog.getByRole("button", "Confirmer et lancer le métré", { exact: true }).click();
  await expect(dialog.getByRole("button", "Reprendre la dernière préparation", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/La source.*sample-plan\.pdf.*a changé/).first()).toBeVisible();
  await expect(dialog.getByText(/Vérifiez sa version avant de confirmer/).first()).toBeVisible();
  await expect(dialog.getByText(/Minified React error/)).toHaveCount(0);
  expect(await jobs.list()).toEqual([]);
  const retained = await read();
  expect(retained.draft.scope).toEqual(before.draft.scope);
  expect(retained.confirmed_snapshot).toBeNull();
  await recordEvidence(ui.army, "PRE03-source-change", { estimate, fileId: file.id, before, retained,
    boundary: "Owned plan metadata identity changed after saving. Launch must reject stale source selection before creating any job; the original Storage bytes are unchanged." });
});

armyTest("PRE04 unavailable writing AI and Decisions preserve the manually prepared answers", options, async (ui) => {
  const { estimate, file, read, jobs } = await setup(ui, "PRE04");
  const dialog = await fillTakeoffPreparation(ui, { sources: [file.file_name] });
  await saveTakeoffPreparation(ui);
  const before = await read();
  await dialog.getByText("Assistance au cadrage", { exact: true }).click();
  await dialog.getByLabel("Décrire le périmètre ou corriger le cadrage", { exact: true }).fill("Compter les vannes au R+1, zone 1, sans le RDC.");
  await dialog.getByRole("button", "Proposer un cadrage", { exact: true }).click();
  await expect(dialog.getByText(/Aucune assistance rédactionnelle n.est configurée/).first()).toBeVisible();
  await expect(dialog.getByText(/Decisions :.*Accès API distinct de la connexion ChatGPT/)).toBeVisible();
  await expect(dialog.getByRole("button", "Confirmer et lancer le métré", { exact: true })).toBeEnabled();
  await expect(dialog.getByRole("button", /^Utiliser la proposition/)).toHaveCount(0);
  const after = await read();
  expect(after.draft).toEqual(before.draft);
  expect(after.confirmed_snapshot).toBeNull();
  expect(await jobs.list()).toEqual([]);
  await ui.browser.reload();
  await openTakeoffPreparation(ui);
  expect((await read()).draft).toEqual(before.draft);
  await recordEvidence(ui.army, "PRE04-manual-fallback", { estimate, before, after,
    boundary: "External AI keys and ChatGPT are unavailable in the owned campaign. Real server capability handling preserves the manual answers; no AI response is simulated and no paid provider is called." });
});
