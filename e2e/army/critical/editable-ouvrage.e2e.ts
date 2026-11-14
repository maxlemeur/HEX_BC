import { expect } from "e2e";
import { apiRequest, armyTest, createEstimateViaWizard, createLineViaApi, readEstimate, recordEvidence, saveLineEditsWithShortcut, setLineCoreValues } from "./fixtures";
import { basisLaborRole } from "./version-totals-support";

type Envelope<T> = { ok: boolean; data: T };
// The owned role is 40 EUR/h. Composition: 2 units × 10 EUR + 1 total hour = 60 EUR.
// At quantity 3: 6 units × 10 EUR + 3 hours = 180 EUR. The ordinary anchor is 10 EUR.
armyTest("TI718 ouvrage insertion from line menu preserves editable quantity and expandable detail", {
  session: "army", trace: "on", tags: ["critical", "estimates", "ouvrages"], timeout: 180000,
}, async (ui) => {
  const { browser, screen, app, army } = ui;
  await browser.setViewport({ width: 1122, height: 983 });
  const target = await createEstimateViaWizard(ui, { projectName: army.projectName, title: `${army.runPrefix} TI718` }, army);
  const role = await basisLaborRole(browser, target.versionId);
  const engine = (await readEstimate(browser, target.versionId)).version.calc_engine_version;
  const anchor = await createLineViaApi(browser, target.versionId, "Ligne de référence", engine === 3 ? { k_fo_manual: true, unit_code: "u" } : {});
  const name = `${army.runPrefix} ouvrage`;
  const created = await apiRequest<Envelope<{ assembly: { id: string } }>>(browser, "POST", "/api/estimates/assemblies", {
    name, unit: "ml", items: [{ title: "Composant modifiable", position: 1, unit: "u", default_quantity: 2,
      unit_cost_ht_cents: 1000, h_mo: 1, k_fo: 1, k_mo: 1, labor_role_id: role.id, source_metadata: { k_fo_manual: true } }],
  });
  expect(created.status).toBe(201);
  await browser.reload();
  const anchorRow = browser.locator(`[data-estimate-item-id="${anchor.id}"]`);
  await anchorRow.getByTestId("estimate-line-more-trigger").click();
  await screen.getByRole("button", "Insérer un ouvrage après cette ligne", { exact: true }).click();
  const dialog = screen.getByRole("dialog", "Ajouter un ouvrage", { exact: true });
  await expect(dialog).toContainText("après « Ligne de référence »");
  const parentTitle = (await readEstimate(browser, target.versionId)).items.find(item => item.id === anchor.parent_id)?.title;
  expect(parentTitle).toBeTruthy();
  await expect(dialog).toContainText(parentTitle!);
  await dialog.getByRole("button", "Fermer le sélecteur d'ouvrages", { exact: true }).click();
  expect((await readEstimate(browser, target.versionId)).items.some(item => item.title === name)).toBe(false);
  // Closing the picker does not insert anything; reopen from the same line.
  await anchorRow.getByTestId("estimate-line-more-trigger").click();
  await screen.getByRole("button", "Insérer un ouvrage après cette ligne", { exact: true }).click();
  await dialog.getByLabel("Rechercher", { exact: true }).fill(name);
  await dialog.getByRole("button", name, { exact: false }).click();
  await dialog.getByRole("button", `Ajouter « ${name} »`, { exact: false }).click();
  await expect(dialog).not.toBeVisible();
  const ouvrage = screen.getByTestId("estimate-ouvrage-row");
  await expect(ouvrage).toHaveCount(1);
  await expect(browser.locator('[data-testid="estimate-ouvrage-row"] [data-estimate-column="unit"]')).toHaveText("ml");
  const quantity = ouvrage.getByLabel(`Quantité de l’ouvrage ${name}`, { exact: true });
  await expect(quantity).toHaveValue("1");
  await expect(screen.getByLabel("Quantité pour Composant modifiable", { exact: true })).not.toBeVisible();
  let snapshot = await readEstimate(browser, target.versionId);
  const aggregate = snapshot.items.find(item => item.title === name)!;
  expect(aggregate.parent_id).toBe(anchor.parent_id);
  expect(aggregate.position).toBe(anchor.position + 1);
  expect(snapshot.version.total_ht_cents).toBe(7000);
  await quantity.fill("3"); await quantity.press("Tab");
  await expect.poll(async () => (await readEstimate(browser, target.versionId)).version.total_ht_cents).toBe(19000);
  await expect(quantity).toBeEnabled();
  await ouvrage.getByRole("button", `Déplier le détail de ${name}`, { exact: true }).click();
  const componentQuantity = screen.getByLabel("Quantité pour Composant modifiable", { exact: true });
  await expect(componentQuantity).toHaveValue("6");
  await setLineCoreValues(ui, "Composant modifiable", { quantity: "6", unitPriceHt: "12" });
  await saveLineEditsWithShortcut(ui, target.versionId, "Composant modifiable", army);
  await expect.poll(async () => (await readEstimate(browser, target.versionId)).version.total_ht_cents).toBe(20200);
  // Editing detail does not collapse it.
  await expect(componentQuantity).toBeVisible();
  await ouvrage.getByRole("button", `Replier le détail de ${name}`, { exact: true }).click();
  await expect(componentQuantity).not.toBeVisible();
  await quantity.fill("1"); await quantity.press("Tab");
  await expect.poll(async () => (await readEstimate(browser, target.versionId)).version.total_ht_cents).toBe(7400);
  await expect(quantity).toBeEnabled();
  await screen.getByTestId("estimate-editor-undo-button", { visible: true }).click();
  await expect.poll(async () => (await readEstimate(browser, target.versionId)).version.total_ht_cents).toBe(20200);
  await browser.reload();
  await expect(quantity).toHaveValue("3");
  await ouvrage.getByRole("button", `Déplier le détail de ${name}`, { exact: true }).click();
  await expect(componentQuantity).toHaveValue("6");
  snapshot = await readEstimate(browser, target.versionId);
  const component = snapshot.items.find(item => item.title === "Composant modifiable")!;
  expect(component.unit_price_ht_cents).toBe(1200);
  expect(component.h_mo).toBe(3);
  expect(snapshot.version.total_ht_cents).toBe(20200);
  expect(component.source_provider).toBe("assembly_library");
  // A committed resize whose causal reread fails must block stale component writes.
  let failedReads = 0;
  await browser.route(`**/api/estimates/${target.versionId}`, async route => {
    if (route.request.method === "GET" && failedReads === 0) {
      failedReads += 1;
      await route.fulfill({ status: 503, json: { ok: false, error: { message: "Relecture interrompue (fixture)." } } });
    } else await route.fallback();
  });
  await quantity.fill("2"); await quantity.press("Tab");
  await expect.poll(() => failedReads).toBe(1);
  const recovery = screen.getByTestId("estimate-editor-alert-batch-recovery");
  await expect(recovery).toBeVisible();
  await expect(quantity).toBeDisabled();
  await expect(componentQuantity).toBeDisabled();
  expect((await readEstimate(browser, target.versionId)).version.total_ht_cents).toBe(13800);
  await recovery.getByRole("button", "Vérifier le résultat", { exact: true }).click();
  await expect(recovery).not.toBeVisible();
  await expect(screen.getByTestId("estimate-editor-alert-action-error")).not.toBeVisible();
  await expect(quantity).toBeEnabled();
  await expect(quantity).toHaveValue("2");
  await expect(componentQuantity).toHaveValue("4");
  snapshot = await readEstimate(browser, target.versionId);
  expect(snapshot.version.total_ht_cents).toBe(13800);
  await recordEvidence(army, "ti718-final", { target, engine: snapshot.version.calc_engine_version, aggregate, component,
    totals: [snapshot.version.total_ht_cents, snapshot.version.total_tax_cents, snapshot.version.total_ttc_cents] });
  await app.screenshot("ti718-expanded-1122");
  await app.open(`/dashboard/estimates/${target.versionId}/edit`);
});
