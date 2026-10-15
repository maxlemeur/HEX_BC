import { expect } from "e2e";

import {
  apiRequest, armyTest, createEstimateViaWizard, createLineViaApi,
  readEstimate, recordEvidence, setLineCoreValues, waitForAutoSave,
} from "../critical/fixtures";

const options = { session: "army", tags: ["critical", "extended", "settings-contracts"], trace: "off" as const, timeout: 180_000 };
type Ui = Parameters<typeof createEstimateViaWizard>[0];

async function openSettings(ui: Ui) {
  await ui.screen.getByRole("tab", "Affichage & contrôle", { exact: true }).click();
  await ui.screen.getByTestId("estimate-editor-display-button", { visible: true }).click();
  await ui.screen.getByTestId("estimate-editor-settings-button", { visible: true }).click();
  const dialog = ui.screen.getByRole("dialog", "Paramétrage du devis", { exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

armyTest("SET01 tenant admin can edit tiers while the old V0 deep link remains dormant", options, async (ui) => {
  const ids = await createEstimateViaWizard(ui, { projectName: ui.army.projectName, title: `${ui.army.runPrefix} settings access` }, ui.army);
  const v0Requests: string[] = [];
  await ui.browser.route("**/api/estimates/**/version-zero-drafts**", async (route) => {
    v0Requests.push(route.request.method);
    await route.abort();
  });
  await ui.app.open(`/dashboard/estimates/${ids.versionId}/edit?openVersionZero=1`);
  await expect(ui.screen.getByTestId("estimate-editor-table", { visible: true })).toBeVisible();
  await expect(ui.screen.getByRole("dialog", /version z[ée]ro|V0/i)).toHaveCount(0);
  await expect(ui.screen.getByRole("button", /version z[ée]ro|Générer.*V0/i)).toHaveCount(0);
  const dialog = await openSettings(ui);
  await expect(dialog.getByRole("heading", "Tranches de marge", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Seuil de coût HT (EUR)", { exact: true })).toBeEnabled();
  const manager = ui.browser.locator('[role="dialog"] .dashboard-card').filter({ has: ui.screen.getByRole("heading", "Tranches de marge", { exact: true }) });
  await expect(manager.getByRole("button", "Ajouter", { exact: true })).toBeEnabled();
  await expect(dialog.getByRole("button", /cascade/i)).toHaveCount(0);
  expect(v0Requests).toEqual([]);
  await recordEvidence(ui.army, "settings-admin-v0", { ids, v0Requests, tierInputsEnabled: true, tierWrites: 0 });
});

armyTest("SET02 a frozen read uses its captured coefficient without changing the persisted draft", options, async (ui) => {
  const title = `${ui.army.runPrefix} frozen coefficient`;
  const ids = await createEstimateViaWizard(ui, { projectName: ui.army.projectName, title }, ui.army);
  const line = await createLineViaApi(ui.browser, ids.versionId, title);
  await ui.browser.reload();
  await setLineCoreValues(ui, title, { quantity: "3", unitPriceHt: "10,00" });
  const baseline = await waitForAutoSave(ui, ids.versionId, (snapshot) => snapshot.items.some((item) =>
    item.id === line.id && item.line_total_ht_cents === 3000), ui.army);
  const response = await apiRequest<{ ok: boolean; data: { version: Record<string, unknown>; items: Array<Record<string, unknown>> } }>(ui.browser, "GET", `/api/estimates/${ids.versionId}`);
  expect(response.status).toBe(200); expect(response.body.ok).toBe(true);
  const variant = structuredClone(response.body);
  Object.assign(variant.data.version, {
    status: "sent", margin_mode: "tiered", calc_engine_version: 2,
    calc_snapshot_content_revision: variant.data.version.content_revision,
    calc_snapshot_context: { ...(variant.data.version.calc_snapshot_context as object ?? {}), effective_margin_multiplier: 1.7 },
    total_ht_cents: 5100, total_tax_cents: 0, total_ttc_cents: 5100,
  });
  for (const item of variant.data.items) if (item.item_type === "line") Object.assign(item, {
    line_total_ht_cents: 5100, line_tax_cents: 0, line_total_ttc_cents: 5100,
    snapshot_pu_ht_cents: 1700, snapshot_fo_ht_cents: 5100, snapshot_mo_ht_cents: 0,
    snapshot_mo_atelier_ht_cents: 0, snapshot_mo_chantier_ht_cents: 0,
  });
  const pattern = `**/api/estimates/${ids.versionId}`;
  let syntheticReads = 0;
  await ui.browser.route(pattern, async (route) => {
    if (route.request.method !== "GET") return route.fallback();
    syntheticReads += 1;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(variant) });
  });
  await ui.browser.reload();
  const dialog = await openSettings(ui);
  await expect(dialog.getByText(/Coefficient appliqué au devis figé : ×1[.,]70/)).toBeVisible();
  await expect(dialog.getByText(/Pour ce devis : coût/)).toHaveCount(0);
  await expect(ui.screen.getByRole("button", /^Total HT :/)).toHaveText(/51[,.]00/);
  expect(syntheticReads).toBeGreaterThan(0);
  await ui.browser.unroute(pattern);
  const persisted = await readEstimate(ui.browser, ids.versionId);
  expect(persisted.version.status).toBe("draft");
  expect(persisted.version.total_ht_cents).toBe(3000);
  expect(persisted.version.total_ht_cents).toBe(baseline.version.total_ht_cents);
  expect(persisted.items).toEqual(baseline.items);
  await recordEvidence(ui.army, "settings-frozen-read", {
    ids, syntheticReads, expected: { snapshotCoefficient: 1.7, visibleHtCents: 5100, persistedHtCents: 3000, persistedStatus: "draft" },
    actual: { persistedHtCents: persisted.version.total_ht_cents, persistedStatus: persisted.version.status },
    scope: "synthetic browser GET only; no sent-status or SQL proof",
  });
});
