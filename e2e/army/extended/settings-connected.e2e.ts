import { expect } from "e2e";

import { apiRequest, armyTest, readEstimate, recordEvidence, type ArmyEstimate, type ArmyItem } from "../critical/fixtures";
import { connectedApi, connectedEstimate, connectedLine, connectedOpen, connectedSession, connectedSettings, retainFixture, type Envelope } from "./connected-support";

const options = { session: "army", tags: ["critical", "extended", "settings-connected"], trace: "off" as const, timeout: 360_000 };
type Tier = { id: string; threshold_cents: number; multiplier: number };
const money = (snapshot: ArmyEstimate) => ({
  ht: snapshot.version.total_ht_cents, tax: snapshot.version.total_tax_cents, ttc: snapshot.version.total_ttc_cents,
  lines: snapshot.items.filter(item => item.item_type === "line").map(item => ({ id: item.id, quantity: item.quantity, price: item.unit_price_ht_cents, ht: item.line_total_ht_cents })),
});

armyTest("SET-C01 tenant tiers persist at exact threshold and labor inputs preserve revision protection", options, async ui => {
  const created = await connectedEstimate(ui, "Barème pilote", { margin_mode: "tiered" });
  const versionId = created.version.id;
  await connectedOpen(ui, versionId);
  let drawer = await connectedSettings(ui);
  const manager = ui.browser.locator('[role="dialog"] .dashboard-card').filter({ has: ui.screen.getByRole("heading", "Tranches de marge", { exact: true }) });
  const baseEuros = 500_000 + Number.parseInt(ui.army.runPrefix.slice(-6), 16) % 100_000;
  const tiers: Tier[] = [];
  const requests: string[] = [];
  await ui.browser.route("**/api/margin-tiers", async route => {
    if (route.request.method === "POST") requests.push("POST");
    await route.fallback();
  });
  await manager.getByRole("button", "Ajouter", { exact: true }).click();
  await expect(manager.getByRole("alert")).toHaveText(/Le seuil doit être/);
  expect(requests).toHaveLength(0);
  for (const [index, multiplier] of [1.3, 1.1].entries()) {
    await manager.getByLabel("Seuil de coût HT (EUR)", { exact: true }).fill(String(baseEuros + index));
    await manager.getByLabel("Coefficient", { exact: true }).fill(String(multiplier));
    const saved = ui.browser.waitForResponse("**/api/margin-tiers");
    await manager.getByRole("button", "Ajouter", { exact: true }).click();
    const response = await saved;
    expect([200, 201]).toContain(response.status);
    const tier = (await response.json<Envelope<{ margin_tier: Tier }>>()).data.margin_tier;
    await retainFixture(ui.army, "margin-tier", tier.id, `${ui.army.runPrefix} seuil ${baseEuros + index}`);
    expect(tier).toMatchObject({ threshold_cents: (baseEuros + index) * 100, multiplier });
    tiers.push(tier);
    await expect(manager.getByLabel("Seuil de coût HT (EUR)", { exact: true })).toHaveValue("");
  }
  await manager.getByLabel("Seuil de coût HT (EUR)", { exact: true }).fill(String(baseEuros));
  await manager.getByLabel("Coefficient", { exact: true }).fill("1.2");
  await manager.getByRole("button", "Ajouter", { exact: true }).click();
  await expect(manager.getByRole("alert")).toHaveText(/Une tranche avec ce seuil existe déjà/);
  expect(requests).toHaveLength(2);
  await manager.getByLabel("Seuil de coût HT (EUR)", { exact: true }).fill(String(baseEuros + 2));
  await manager.getByLabel("Coefficient", { exact: true }).fill("101");
  await manager.getByRole("button", "Ajouter", { exact: true }).click();
  await expect(manager.getByRole("alert")).toHaveText(/entre 0 et 100/);
  expect(requests).toHaveLength(2);
  await connectedOpen(ui, versionId, true);
  drawer = await connectedSettings(ui);
  for (const tier of tiers) {
    const value = (tier.threshold_cents / 100).toFixed(2);
    await expect(manager.getByLabel(`Seuil de coût HT de la tranche ${value} EUR`, { exact: true })).toHaveValue(value);
  }
  await drawer.getByTestId("estimate-editor-drawer-close-button").click();
  const threshold = tiers[1].threshold_cents;
  const half = threshold / 2;
  const first = await connectedLine(ui, versionId, { quantity: 1, unit_price_ht_cents: half, label: "Fournitures A" });
  const second = await connectedLine(ui, versionId, { quantity: 1, unit_price_ht_cents: half, label: "Fournitures B" });
  const expectedTotal = Math.round(threshold * 1.1);
  await expect.poll(async () => (await readEstimate(ui.browser, versionId)).version.total_ht_cents, { timeout: 90_000 }).toBe(expectedTotal);
  const atBoundary = await readEstimate(ui.browser, versionId);
  for (const line of atBoundary.items.filter(item => item.item_type === "line")) {
    expect(line).toMatchObject({ quantity: 1, unit_price_ht_cents: half, line_total_ht_cents: Math.round(half * 1.1) });
  }
  const price = ui.screen.getByLabel(`Prix d’achat unitaire HT pour ${second.title}`, { exact: true });
  await ui.browser.locator(`[data-cell-id="${second.id}::unit_price"]`).dblclick();
  await expect(price).toBeFocused();
  await price.fill(String((half - 100) / 100));
  await price.press("Tab");
  await ui.browser.keyboard.press("Control+s");
  const lowerTotal = Math.round((threshold - 100) * 1.3);
  await expect.poll(async () => (await readEstimate(ui.browser, versionId)).version.total_ht_cents, { timeout: 90_000 }).toBe(lowerTotal);
  const lower = await readEstimate(ui.browser, versionId);
  expect(lower.items.find(item => item.id === first.id)?.line_total_ht_cents).toBe(Math.round(half * 1.3));
  expect(lower.items.find(item => item.id === second.id)?.line_total_ht_cents).toBe(Math.round((half - 100) * 1.3));
  await connectedOpen(ui, versionId, true);
  const tenantId = String(created.version.tenant_id);
  expect(tenantId).toMatch(/^[0-9a-f-]{36}$/i);
  const flags = await connectedApi<{ flags: Array<{ flag_key: string; enabled: boolean }> }>(ui, "GET", `/api/feature-flags?tenant_id=${tenantId}`);
  const splitEnabled = flags.flags.find(flag => flag.flag_key === "EST_031_LABOR_SPLIT")?.enabled === true;
  const headers = await connectedSession(ui, versionId);
  const roles: Array<{ id: string; name: string; hourly_rate_cents: number }> = [];
  for (const [name, hourlyRate] of [["Atelier", 3000], ["Chantier", 5000]] as const) {
    const role = (await connectedApi<{ labor_role: typeof roles[number] }>(ui, "POST", `/api/estimates/${versionId}/labor-roles`, {
      name: `${ui.army.runPrefix} ${name}`, hourly_rate_cents: hourlyRate,
    }, headers)).labor_role;
    await retainFixture(ui.army, "labor-role", role.id, role.name);
    expect(role.hourly_rate_cents).toBe(hourlyRate);
    roles.push(role);
  }
  const beforeSplit = await readEstimate(ui.browser, versionId);
  const splitFields = { h_mo_atelier: 2, k_mo_atelier: 1.5, labor_role_atelier_id: roles[0].id,
    h_mo_chantier: 3, k_mo_chantier: 2, labor_role_chantier_id: roles[1].id };
  await connectedApi(ui, "PATCH", `/api/estimates/${versionId}/items`, { id: first.id, line_nature: "supply_and_labor", ...splitFields },
    { ...headers, "If-Match": beforeSplit.version.updated_at });
  const laborCost = splitEnabled ? 2 * 1.5 * 3000 + 3 * 2 * 5000 : 0;
  const multiplier = splitEnabled ? 1.1 : 1.3;
  const expectedFirst = Math.round((half + laborCost) * multiplier);
  const expectedSecond = Math.round((half - 100) * multiplier);
  const afterSplit = await readEstimate(ui.browser, versionId);
  expect(afterSplit.items.find(item => item.id === first.id)).toMatchObject({ ...splitFields, line_total_ht_cents: expectedFirst });
  expect(afterSplit.items.find(item => item.id === second.id)?.line_total_ht_cents).toBe(expectedSecond);
  expect(afterSplit.version).toMatchObject({ total_ht_cents: expectedFirst + expectedSecond, total_tax_cents: 0, total_ttc_cents: expectedFirst + expectedSecond });
  const stale = await apiRequest<Envelope<unknown>>(ui.browser, "PATCH", `/api/estimates/${versionId}/items`, { id: first.id, h_mo_atelier: 99 },
    { ...headers, "If-Match": beforeSplit.version.updated_at });
  expect(stale.status).toBe(409);
  expect(stale.body.error?.code).toBe("VERSION_CONFLICT");
  await connectedOpen(ui, versionId, true);
  await expect(ui.screen.getByTestId("estimate-line-row")).toHaveCount(2);
  const reloaded = await readEstimate(ui.browser, versionId);
  expect(reloaded.items.find(item => item.id === first.id)).toMatchObject({ ...splitFields, line_total_ht_cents: expectedFirst });
  expect(reloaded.version.total_ht_cents).toBe(expectedFirst + expectedSecond);
  await recordEvidence(ui.army, "tiers-boundary-and-labor", { tiers, postCount: requests.length, threshold, expectedTotal, atBoundary: money(atBoundary), lower: money(lower), splitEnabled, laborCost, splitFields, expectedFirst, expectedSecond, reloaded: money(reloaded), staleStatus: stale.status, limitation: "Six labor values use ordinary HTTP with the editor lease; no feature activation or split-column interaction." });
});

armyTest("SET-C02 changing title preserves historical cascade discounts and exact financial values", options, async ui => {
  const created = await connectedEstimate(ui, "Remises historiques", { discount_mode: "cascade", discount_steps: [500, 1000], global_coefficient: 1.02 });
  const versionId = created.version.id;
  await connectedOpen(ui, versionId);
  await connectedLine(ui, versionId);
  await expect.poll(async () => (await readEstimate(ui.browser, versionId)).version.total_ht_cents, { timeout: 90_000 }).toBeGreaterThan(0);
  const before = await readEstimate(ui.browser, versionId);
  const drawer = await connectedSettings(ui);
  await expect(drawer.getByText("Remises historiques conservées", { exact: true })).toBeVisible();
  await expect(drawer.getByText(/Remises : 5 % puis 10 %/)).toBeVisible();
  const title = `${ui.army.runPrefix} Titre modifié`;
  await ui.browser.locator('[role="dialog"] #estimate-title').fill(title);
  await drawer.getByRole("button", "Enregistrer le paramétrage", { exact: true }).click();
  await expect.poll(async () => (await readEstimate(ui.browser, versionId)).version.title).toBe(title);
  await connectedOpen(ui, versionId, true);
  const after = await readEstimate(ui.browser, versionId);
  const financials = (value: ArmyEstimate) => ({ discountMode: value.version.discount_mode, steps: value.version.discount_steps,
    coefficient: value.version.global_coefficient, engine: value.version.calc_engine_version, ...money(value) });
  expect(financials(after)).toEqual(financials(before));
  await connectedSettings(ui);
  await recordEvidence(ui.army, "historical-discounts-preserved", { expected: financials(before), actual: financials(after) });
});

armyTest("SET-C03 tiered AID supports replace clear and menu navigation without changing money", options, async ui => {
  const created = await connectedEstimate(ui, "AID tiered", { margin_mode: "tiered" });
  const versionId = created.version.id;
  await connectedOpen(ui, versionId);
  const headers = await connectedSession(ui, versionId);
  const section = (await connectedApi<{ item: ArmyItem }>(ui, "POST", `/api/estimates/${versionId}/items`, { item_type: "section", title: `${ui.army.runPrefix} Section AID` }, headers)).item;
  const line = (await connectedApi<{ item: ArmyItem }>(ui, "POST", `/api/estimates/${versionId}/items`, {
    item_type: "line", parent_id: section.id, title: `${ui.army.runPrefix} Ligne AID`, description: "u", quantity: 1,
    unit_price_ht_cents: 0, tax_rate_bp: 0, k_fo: 1, h_mo: 0, k_mo: 1, line_nature: "supply_only",
  }, headers)).item;
  await retainFixture(ui.army, "estimate-line", line.id, line.title);
  const before = await readEstimate(ui.browser, versionId);
  const aid = `ARMY.AID.${100 + Number.parseInt(ui.army.runPrefix.slice(-6), 16) % 9000}`;
  let current = before;
  const observations = [];
  for (const value of [aid, aid.replace(/\d+$/, digits => String(Number(digits) + 1)), null]) {
    await connectedApi(ui, "PATCH", `/api/estimates/${versionId}/items`, { id: line.id, aid: value },
      { ...await connectedSession(ui, versionId), "If-Match": current.version.updated_at });
    current = await readEstimate(ui.browser, versionId);
    expect(current.items.find(item => item.id === line.id)).toMatchObject({ aid: value });
    expect(money(current)).toEqual(money(before));
    observations.push({ aid: value, actual: money(current) });
    if (value === aid) {
      await connectedOpen(ui, versionId, true);
      await expect(ui.screen.getByTestId("estimate-line-row")).toHaveCount(1);
      current = await readEstimate(ui.browser, versionId);
      expect(current.items.find(item => item.id === line.id)).toMatchObject({ aid });
      expect(money(current)).toEqual(money(before));
    }
  }
  await connectedOpen(ui, versionId, true);
  await ui.screen.getByTestId("estimate-line-row").getByRole("gridcell").first().secondaryTap();
  const field = ui.screen.getByLabel("Identifiant AID de la ligne", { exact: true });
  await expect(field).toBeVisible();
  await expect(field).toHaveValue("");
  const menuAid = aid.replace(/\d+$/, digits => String(Number(digits) + 2));
  const batches: Array<{ operations: Array<Record<string, unknown>> }> = [];
  await ui.browser.route(`**/api/estimates/${versionId}/batch`, async route => {
    if (route.request.method === "POST") batches.push(JSON.parse(route.request.postData ?? "{}") as typeof batches[number]);
    await route.fallback();
  });
  const saved = ui.browser.waitForResponse(`**/api/estimates/${versionId}/batch`);
  await field.fill(menuAid);
  await field.press("Enter");
  await ui.screen.getByRole("link", "Affaires", { exact: true }).first().click();
  await expect(ui.browser).toHaveURL(/\/dashboard\/affaires(?:$|[/?#])/);
  expect((await saved).status).toBe(200);
  expect(batches.flatMap(batch => batch.operations)).toEqual(expect.arrayContaining([
    expect.objectContaining({ op: "update", id: line.id, data: expect.objectContaining({ aid: menuAid }) }),
  ]));
  await expect.poll(async () => (await readEstimate(ui.browser, versionId)).items.find(item => item.id === line.id)).toMatchObject({ aid: menuAid });
  await connectedOpen(ui, versionId);
  await expect(ui.screen.getByTestId("estimate-line-row")).toHaveCount(1);
  await ui.screen.getByTestId("estimate-line-row").getByRole("gridcell").first().secondaryTap();
  await expect(field).toHaveValue(menuAid);
  const reloaded = await readEstimate(ui.browser, versionId);
  expect(money(reloaded)).toEqual(money(before));
  await recordEvidence(ui.army, "aid-tiered-persistence", { expected: money(before), observations, menuAid, batches, reloaded: money(reloaded) });
});
