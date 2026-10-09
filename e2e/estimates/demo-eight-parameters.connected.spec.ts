import { expect, test as base } from "@playwright/test";
import {
  apiJson, captureBusinessScreen, createConnectedRun, loginAndVerifyIdentity,
  persistConnectedRun, recordConnectedStep, type ConnectedRun,
  ownFixture, assertOwned,
} from "./demo-eight-connected.helpers";
import {
  addConnectedSupplyLine, createConnectedEstimate, openConnectedEstimate, openConnectedSettings,
  type ConnectedEstimate,
} from "./demo-eight-estimate.connected.helpers";

// Failure modes were recorded in docs/demo-eight-recette-parametres.md before implementation.
const test = base.extend<{ run: ConnectedRun }>({
  run: async ({ page }, runTest, testInfo) => {
    const run = await createConnectedRun(testInfo, "parametres");
    run.manifest.command = "npx playwright test --config=e2e/demo-eight.connected.config.ts demo-eight-parameters.connected.spec.ts";
    let completed = false;
    try {
      await loginAndVerifyIdentity(page, run);
      await runTest(run);
      completed = true;
    } finally {
      run.manifest.result = completed ? testInfo.status ?? "failed" : "failed";
      run.manifest.finishedAt = new Date().toISOString();
      await persistConnectedRun(run);
      await testInfo.attach("business-manifest", { path: run.manifestPath, contentType: "application/json" });
    }
  },
});

test("TI-576 admin du tenant peut paramétrer les tranches sans rôle global admin", async ({ page, run }, testInfo) => {
  const created = await createConnectedEstimate(page, run, "Droits tranches");
  await openConnectedEstimate(page, created.version.id);
  const drawer = await openConnectedSettings(page);
  const manager = drawer.locator(".dashboard-card").filter({ has:
    page.getByRole("heading", { name: "Tranches de marge", exact: true }) });
  const threshold = manager.getByLabel("Seuil de coût HT (EUR)", { exact: true });
  await expect(threshold).toBeVisible();
  await expect(threshold).toBeEnabled();
  await expect(manager.getByRole("button", { name: "Ajouter", exact: true })).toBeEnabled();
  await expect(drawer.getByRole("button", { name: /cascade/i })).toHaveCount(0);
  await recordConnectedStep(run, "Tenant administrator controls", { role: "admin", inputsEnabled: true, barèmeWrites: 0 },
    { thresholdVisible: await threshold.isVisible(), thresholdEnabled: await threshold.isEnabled(), barèmeWrites: 0 });
  await captureBusinessScreen(page, testInfo, "marge-droits-admin-tenant");
});

test("TI-576 explication d'un snapshot synthétique utilise son coefficient conservé", async ({ page, run }, testInfo) => {
  const created = await createConnectedEstimate(page, run, "Snapshot synthétique");
  const versionId = created.version.id;
  await openConnectedEstimate(page, versionId);
  await addConnectedSupplyLine(page, run, versionId);
  await expect.poll(async () => (await apiJson<ConnectedEstimate>(page,
    `/api/estimates/${versionId}`)).version.total_ht_cents,
  { timeout: 90_000, message: "The real editor must persist its financial baseline" }).toBe(4500);
  const baseline = await apiJson<ConnectedEstimate>(page, `/api/estimates/${versionId}`);
  // Read-only browser response variant. No persisted status, financial or barème change.
  let syntheticReads = 0;
  await page.route(`**/api/estimates/${versionId}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const payload = await response.json();
    payload.data.version.status = "sent";
    payload.data.version.margin_mode = "tiered";
    payload.data.version.calc_engine_version = 2;
    payload.data.version.content_revision = Math.max(1, Number(payload.data.version.content_revision));
    payload.data.version.calc_snapshot_content_revision = payload.data.version.content_revision;
    payload.data.version.calc_snapshot_context = {
      ...payload.data.version.calc_snapshot_context, effective_margin_multiplier: 1.7,
    };
    payload.data.version.total_ht_cents = 5100;
    payload.data.version.total_tax_cents = 0;
    payload.data.version.total_ttc_cents = 5100;
    for (const item of payload.data.items) {
      if (item.item_type !== "line") continue;
      Object.assign(item, { line_total_ht_cents: 5100, line_tax_cents: 0, line_total_ttc_cents: 5100,
        snapshot_pu_ht_cents: 1700, snapshot_fo_ht_cents: 5100, snapshot_mo_ht_cents: 0,
        snapshot_mo_atelier_ht_cents: 0, snapshot_mo_chantier_ht_cents: 0 });
    }
    syntheticReads += 1;
    await route.fulfill({ response, json: payload });
  });
  await page.reload();
  const drawer = await openConnectedSettings(page);
  await expect(drawer.getByText(/Coefficient appliqué au devis figé : ×1[.,]70/)).toBeVisible();
  await expect(drawer.getByText(/Pour ce devis : coût/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Total HT :/ })).toHaveText(/51[,.]00/);
  expect(syntheticReads).toBeGreaterThan(0);
  const persisted = await apiJson<ConnectedEstimate>(page, `/api/estimates/${versionId}`);
  expect(persisted.version.status).toBe("draft");
  expect(persisted.version.total_ht_cents).toBe(baseline.version.total_ht_cents);
  await recordConnectedStep(run, "Synthetic frozen explanation", { snapshotCoefficient: 1.7,
    syntheticTotalCents: 5100, configuredCoefficient: 1.5, persistedTotalCents: 4500, persistedStatus: "draft" },
    { syntheticReads, configuredCoefficient: persisted.version.margin_multiplier,
      persistedTotalCents: persisted.version.total_ht_cents, snapshotCoefficient: 1.7, syntheticTotalCents: 5100,
      persistedStatus: persisted.version.status, limitation: "Browser GET variant; no real sent-status/RLS proof" });
  await captureBusinessScreen(page, testInfo, "marge-coefficient-snapshot-synthetique");
});

test("TI-582 ancien lien V0 reste masqué sans chargement automatique", async ({ page, run }, testInfo) => {
  const created = await createConnectedEstimate(page, run, "Veille IA");
  const requests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.includes("version-zero-drafts")) requests.push(`${request.method()} ${pathname}`);
  });
  await page.goto(`/dashboard/estimates/${created.version.id}/edit?openVersionZero=1`);
  await expect(page.getByTestId("estimate-editor-table")).toBeVisible();
  await expect(page.getByRole("dialog", { name: /version z[ée]ro|V0/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /version z[ée]ro|Générer.*V0/i })).toHaveCount(0);
  await openConnectedSettings(page);
  expect(requests).toEqual([]);
  await recordConnectedStep(run, "V0 parked UI", { requests: [], openDialog: false }, { requests, openDialog: false });
  await captureBusinessScreen(page, testInfo, "veille-v0-parametrage-manuel");
});

test("TI-576 barème enregistré, retrouvé et appliqué exactement au seuil", async ({ page, run }, testInfo) => {
  const created = await createConnectedEstimate(page, run, "Barème pilote", { margin_mode: "tiered" });
  const versionId = created.version.id;
  await openConnectedEstimate(page, versionId);
  let drawer = await openConnectedSettings(page);
  let manager = drawer.locator(".dashboard-card").filter({ has:
    page.getByRole("heading", { name: "Tranches de marge", exact: true }) });
  const baseEuros = 500_000 + Number.parseInt(run.prefix.slice(-6), 16) % 100_000;
  const createdTiers: Array<{ id: string; threshold_cents: number; multiplier: number }> = [];
  const requests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/margin-tiers" && request.method() === "POST") requests.push("POST");
  });
  await manager.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(manager.getByRole("alert")).toHaveText(/Le seuil doit être/);
  expect(requests).toHaveLength(0);
  for (const [index, multiplier] of [1.3, 1.1].entries()) {
    await manager.getByLabel("Seuil de coût HT (EUR)", { exact: true }).fill(String(baseEuros + index));
    await manager.getByLabel("Coefficient", { exact: true }).fill(String(multiplier));
    const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/margin-tiers" && response.request().method() === "POST");
    await manager.getByRole("button", { name: "Ajouter", exact: true }).click();
    const response = await responsePromise;
    expect(response.ok()).toBe(true);
    const tier = (await response.json()).data.margin_tier as typeof createdTiers[number];
    await ownFixture(run, "margin-tier", tier.id, `${run.prefix} seuil ${baseEuros + index}`);
    expect(tier).toMatchObject({ threshold_cents: (baseEuros + index) * 100, multiplier });
    createdTiers.push(tier);
    await expect(manager.getByLabel("Seuil de coût HT (EUR)", { exact: true })).toHaveValue("");
  }
  await manager.getByLabel("Seuil de coût HT (EUR)", { exact: true }).fill(String(baseEuros));
  await manager.getByLabel("Coefficient", { exact: true }).fill("1.2");
  await manager.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(manager.getByRole("alert")).toHaveText(/Une tranche avec ce seuil existe déjà/);
  expect(requests).toHaveLength(2);
  await manager.getByLabel("Seuil de coût HT (EUR)", { exact: true }).fill(String(baseEuros + 2));
  await manager.getByLabel("Coefficient", { exact: true }).fill("101");
  await manager.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(manager.getByRole("alert")).toHaveText(/entre 0 et 100/);
  expect(requests).toHaveLength(2);
  await page.reload();
  drawer = await openConnectedSettings(page);
  manager = drawer.locator(".dashboard-card").filter({ has:
    page.getByRole("heading", { name: "Tranches de marge", exact: true }) });
  for (const tier of createdTiers) {
    const label = `Seuil de coût HT de la tranche ${(tier.threshold_cents / 100).toFixed(2)} EUR`;
    await expect(manager.getByLabel(label, { exact: true })).toHaveValue((tier.threshold_cents / 100).toFixed(2));
  }
  await captureBusinessScreen(page, testInfo, "bareme-retrouve-admin-tenant");
  await drawer.getByTestId("estimate-editor-drawer-close-button").click();
  const threshold = createdTiers[1].threshold_cents;
  const half = threshold / 2;
  const first = await addConnectedSupplyLine(page, run, versionId, { quantity: 1, unit_price_ht_cents: half, label: "Fournitures A" });
  const second = await addConnectedSupplyLine(page, run, versionId, { quantity: 1, unit_price_ht_cents: half, label: "Fournitures B" });
  const expectedTotal = Math.round(threshold * 1.1);
  await expect.poll(async () => (await apiJson<ConnectedEstimate>(page, `/api/estimates/${versionId}`)).version.total_ht_cents,
    { timeout: 90_000 }).toBe(expectedTotal);
  const after = await apiJson<ConnectedEstimate>(page, `/api/estimates/${versionId}`);
  const appliedLines = after.items.filter((item) => item.item_type === "line");
  for (const line of appliedLines) expect(line).toMatchObject({ quantity: 1, unit_price_ht_cents: half,
    line_total_ht_cents: Math.round(half * 1.1) });
  const priceInput = page.getByLabel(`Prix d’achat unitaire HT pour ${second.title}`, { exact: true });
  await priceInput.locator('xpath=ancestor::*[@role="gridcell"][1]').dblclick();
  await expect(priceInput).toBeFocused();
  await priceInput.fill(String((half - 100) / 100));
  await priceInput.press("Tab");
  await page.keyboard.press("Control+s");
  const lowerTotal = Math.round((threshold - 100) * 1.3);
  await expect.poll(async () => (await apiJson<ConnectedEstimate>(page, `/api/estimates/${versionId}`)).version.total_ht_cents,
    { timeout: 90_000 }).toBe(lowerTotal);
  const lower = await apiJson<ConnectedEstimate>(page, `/api/estimates/${versionId}`);
  expect(lower.items.find((item) => item.id === first.id)?.line_total_ht_cents).toBe(Math.round(half * 1.3));
  expect(lower.items.find((item) => item.id === second.id)?.line_total_ht_cents).toBe(Math.round((half - 100) * 1.3));
  await page.reload();
  await expect(page.getByTestId("estimate-line-row")).toHaveCount(2);
  // HTTP integration of the six persisted inputs, using this editor's ordinary
  // lease. The tenant feature flag is read, never enabled by the test.
  const flags = await apiJson<{ flags: Array<{ flag_key: string; enabled: boolean }> }>(page,
    `/api/feature-flags?tenant_id=${run.manifest.tenantId}`);
  const splitEnabled = flags.flags.find((flag) => flag.flag_key === "EST_031_LABOR_SPLIT")?.enabled === true;
  const sessionId = await page.evaluate((id) => sessionStorage.getItem(
    `__miaouffrageEstimateDraftLockSession:${id}`), versionId);
  expect(sessionId).toMatch(/^[0-9a-f-]{36}$/i);
  const roles: Array<{ id: string; name: string; hourly_rate_cents: number }> = [];
  for (const [name, hourlyRate] of [["Atelier", 3000], ["Chantier", 5000]] as const) {
    const role = (await apiJson<{ labor_role: typeof roles[number] }>(page,
      `/api/estimates/${versionId}/labor-roles`, { method: "POST",
        headers: { "x-estimate-draft-lock-session-id": sessionId! },
        data: { name: `${run.prefix} ${name}`, hourly_rate_cents: hourlyRate },
      })).labor_role;
    await ownFixture(run, "labor-role", role.id, role.name);
    expect(role.hourly_rate_cents).toBe(hourlyRate);
    roles.push(role);
  }
  assertOwned(run, versionId, first.id, ...roles.map((role) => role.id));
  const beforeSplit = await apiJson<ConnectedEstimate>(page, `/api/estimates/${versionId}`);
  const splitFields = { h_mo_atelier: 2, k_mo_atelier: 1.5, labor_role_atelier_id: roles[0].id,
    h_mo_chantier: 3, k_mo_chantier: 2, labor_role_chantier_id: roles[1].id };
  await apiJson(page, `/api/estimates/${versionId}/items`, { method: "PATCH",
    headers: { "If-Match": beforeSplit.version.updated_at,
      "x-estimate-draft-lock-session-id": sessionId! },
    data: { id: first.id, line_nature: "supply_and_labor", ...splitFields },
  });
  const afterSplit = await apiJson<ConnectedEstimate>(page, `/api/estimates/${versionId}`);
  const laborCost = splitEnabled ? 2 * 1.5 * 3000 + 3 * 2 * 5000 : 0;
  const splitCoefficient = splitEnabled ? 1.1 : 1.3;
  const expectedFirst = Math.round((half + laborCost) * splitCoefficient);
  const expectedSecond = Math.round((half - 100) * splitCoefficient);
  expect(afterSplit.items.find((item) => item.id === first.id)).toMatchObject({
    ...splitFields, line_total_ht_cents: expectedFirst,
  });
  expect(afterSplit.items.find((item) => item.id === second.id)?.line_total_ht_cents).toBe(expectedSecond);
  expect(afterSplit.version).toMatchObject({ total_ht_cents: expectedFirst + expectedSecond,
    total_tax_cents: 0, total_ttc_cents: expectedFirst + expectedSecond });
  const staleResponse = await page.request.patch(`/api/estimates/${versionId}/items`, {
    headers: { "If-Match": beforeSplit.version.updated_at,
      "x-estimate-draft-lock-session-id": sessionId! }, data: { id: first.id, h_mo_atelier: 99 },
  });
  expect(staleResponse.status()).toBe(409);
  expect((await staleResponse.json()).error.code).toBe("VERSION_CONFLICT");
  await page.reload();
  await expect(page.getByTestId("estimate-line-row")).toHaveCount(2);
  const reloadedSplit = await apiJson<ConnectedEstimate>(page, `/api/estimates/${versionId}`);
  expect(reloadedSplit.items.find((item) => item.id === first.id)).toMatchObject({
    ...splitFields, line_total_ht_cents: expectedFirst,
  });
  expect(reloadedSplit.version.total_ht_cents).toBe(expectedFirst + expectedSecond);
  await recordConnectedStep(run, "Six labor inputs persisted through ordinary HTTP and reload",
    { splitFields, totalCents: expectedFirst + expectedSecond, staleStatus: 409 },
    { splitEnabled, laborCostCents: laborCost, totalCents: reloadedSplit.version.total_ht_cents,
      inputs: splitFields, staleStatus: staleResponse.status(),
      limitation: "HTTP mutation with the normal page lease; no split-column input or feature-flag activation" });
  await recordConnectedStep(run, "New tenant tiers persisted and boundary total", {
    createdTiers, rejectedInputPostCount: 0, thresholdCents: threshold, expectedTotalCents: expectedTotal,
  }, { createdTiers, totalPostCount: requests.length, actualTotalCents: after.version.total_ht_cents,
    lineTotalCents: appliedLines.map((item) => item.line_total_ht_cents), lowerTotalCents: lower.version.total_ht_cents,
    lowerLineTotals: lower.items.filter((item) => item.item_type === "line").map((item) => item.line_total_ht_cents), retained: true });
});

test("TI-576 sauvegarde du titre conserve les remises historiques synthétiques", async ({ page, run }, testInfo) => {
  const created = await createConnectedEstimate(page, run, "Remises historiques", {
    discount_mode: "cascade", discount_steps: [500, 1000], global_coefficient: 1.02,
  });
  const versionId = created.version.id;
  await openConnectedEstimate(page, versionId);
  await addConnectedSupplyLine(page, run, versionId);
  await expect.poll(async () => (await apiJson<ConnectedEstimate>(page, `/api/estimates/${versionId}`)).version.total_ht_cents,
    { timeout: 90_000 }).toBeGreaterThan(0);
  const before = await apiJson<ConnectedEstimate>(page, `/api/estimates/${versionId}`);
  const drawer = await openConnectedSettings(page);
  await expect(drawer.getByText("Remises historiques conservées", { exact: true })).toBeVisible();
  await expect(drawer.getByText(/Remises : 5 % puis 10 %/)).toBeVisible();
  await drawer.locator("#estimate-title").fill(`${run.prefix} Titre modifié`);
  await drawer.getByRole("button", { name: "Enregistrer le parametrage", exact: true }).click();
  await expect.poll(async () => (await apiJson<{ version: { title: string } }>(page,
    `/api/estimates/${versionId}`)).version.title).toBe(`${run.prefix} Titre modifié`);
  await page.reload();
  const after = await apiJson<ConnectedEstimate>(page, `/api/estimates/${versionId}`);
  const financials = (estimate: ConnectedEstimate) => ({
    discountMode: estimate.version.discount_mode, steps: estimate.version.discount_steps,
    coefficient: estimate.version.global_coefficient, engine: estimate.version.calc_engine_version,
    ht: estimate.version.total_ht_cents, tax: estimate.version.total_tax_cents, ttc: estimate.version.total_ttc_cents,
    lines: estimate.items.filter((item) => item.item_type === "line").map((item) => ({
      id: item.id, quantity: item.quantity, price: item.unit_price_ht_cents, total: item.line_total_ht_cents,
    })),
  });
  expect(financials(after)).toEqual(financials(before));
  await openConnectedSettings(page);
  await captureBusinessScreen(page, testInfo, "remises-historiques-apres-titre");
  await recordConnectedStep(run, "Synthetic legacy settings preserved", financials(before), financials(after));
});

test("TI-576 PATCH d'un AID tiered conserve sa valeur et les montants", async ({ page, run }) => {
  const created = await createConnectedEstimate(page, run, "AID tiered", { margin_mode: "tiered" });
  const versionId = created.version.id;
  await openConnectedEstimate(page, versionId);
  const sessionId = await page.evaluate((id) => sessionStorage.getItem(
    `__miaouffrageEstimateDraftLockSession:${id}`), versionId);
  expect(sessionId).toMatch(/^[0-9a-f-]{36}$/i);
  // A zero-cost API fixture isolates AID persistence from grid input setup.
  // It is never presented as proof of quantity editing or financial autosave.
  const section = (await apiJson<{ item: { id: string } }>(page,
    `/api/estimates/${versionId}/items`, { method: "POST",
      headers: { "x-estimate-draft-lock-session-id": sessionId! },
      data: { item_type: "section", title: `${run.prefix} Section AID` },
    })).item;
  await ownFixture(run, "estimate-section", section.id, `${run.prefix} Section AID`);
  const line = (await apiJson<{ item: { id: string } }>(page,
    `/api/estimates/${versionId}/items`, { method: "POST",
      headers: { "x-estimate-draft-lock-session-id": sessionId! },
      data: { item_type: "line", parent_id: section.id, title: `${run.prefix} Ligne AID`, description: "u",
        quantity: 1, unit_price_ht_cents: 0, tax_rate_bp: 0, k_fo: 1, h_mo: 0, k_mo: 1,
        line_nature: "supply_only" },
    })).item;
  await ownFixture(run, "estimate-line", line.id, `${run.prefix} Ligne AID`);
  const before = await apiJson<ConnectedEstimate>(page, `/api/estimates/${versionId}`);
  assertOwned(run, versionId, line.id);
  const aid = `ARMY.AID.${100 + Number.parseInt(run.prefix.slice(-6), 16) % 9000}`;
  await apiJson(page, `/api/estimates/${versionId}/items`, { method: "PATCH",
    headers: { "If-Match": before.version.updated_at,
      "x-estimate-draft-lock-session-id": sessionId! }, data: { id: line.id, aid },
  });
  const after = await apiJson<ConnectedEstimate>(page, `/api/estimates/${versionId}`);
  expect(after.items.find((item) => item.id === line.id)).toMatchObject({ aid });
  const money = (estimate: ConnectedEstimate) => ({
    ht: estimate.version.total_ht_cents, tax: estimate.version.total_tax_cents, ttc: estimate.version.total_ttc_cents,
    lines: estimate.items.filter((item) => item.item_type === "line").map((item) => ({
      id: item.id, quantity: item.quantity, price: item.unit_price_ht_cents, ht: item.line_total_ht_cents,
    })),
  });
  expect(money(after)).toEqual(money(before));
  const reloadAidLease = page.waitForResponse((response) => new URL(response.url()).pathname ===
    `/api/estimates/${versionId}/lock` && response.request().method() === "POST");
  await page.reload();
  expect((await reloadAidLease).ok()).toBe(true);
  await expect(page.getByTestId("estimate-line-row")).toHaveCount(1);
  const reloaded = await apiJson<ConnectedEstimate>(page, `/api/estimates/${versionId}`);
  expect(reloaded.items.find((item) => item.id === line.id)).toMatchObject({ aid });
  expect(money(reloaded)).toEqual(money(before));
  await recordConnectedStep(run, "AID persisted through normal tiered PATCH", { aid, ...money(before) },
    { aid, ...money(reloaded) });
  const replacedAid = aid.replace(/\d+$/, (digits) => String(Number(digits) + 1));
  let current = reloaded;
  for (const nextAid of [replacedAid, null]) {
    const currentSession = await page.evaluate((id) => sessionStorage.getItem(
      `__miaouffrageEstimateDraftLockSession:${id}`), versionId);
    expect(currentSession).toMatch(/^[0-9a-f-]{36}$/i);
    await apiJson(page, `/api/estimates/${versionId}/items`, { method: "PATCH",
      headers: { "If-Match": current.version.updated_at,
        "x-estimate-draft-lock-session-id": currentSession! }, data: { id: line.id, aid: nextAid },
    });
    current = await apiJson<ConnectedEstimate>(page, `/api/estimates/${versionId}`);
    expect(current.items.find((item) => item.id === line.id)).toMatchObject({ aid: nextAid });
    expect(money(current)).toEqual(money(before));
    await recordConnectedStep(run, "AID replacement or explicit clearing", { aid: nextAid, ...money(before) },
      { aid: nextAid, ...money(current) });
  }

  // The ordinary context-menu edit must compose with the same tiered PATCH,
  // persist beyond an optimistic display, and leave financial values unchanged.
  const reloadForAidMenu = page.waitForResponse((response) => new URL(response.url()).pathname ===
    `/api/estimates/${versionId}/lock` && response.request().method() === "POST");
  await page.reload();
  expect((await reloadForAidMenu).ok()).toBe(true);
  await expect(page.getByTestId("estimate-line-row")).toHaveCount(1);
  await page.getByTestId("estimate-line-row").getByRole("gridcell").first().click({ button: "right" });
  const aidField = page.getByLabel("Identifiant AID de la ligne", { exact: true });
  await expect(aidField).toBeVisible();
  await expect(aidField).toHaveValue("");
  const menuAid = aid.replace(/\d+$/, (digits) => String(Number(digits) + 2));
  const aidMenuSave = page.waitForResponse((response) => new URL(response.url()).pathname ===
    `/api/estimates/${versionId}/batch` && response.request().method() === "POST");
  await aidField.fill(menuAid);
  await aidField.press("Enter");
  await page.getByRole("link", { name: "Affaires", exact: true }).first().click();
  await page.waitForURL(/\/dashboard\/affaires(?:$|[/?#])/);
  const aidMenuResponse = await aidMenuSave;
  expect(aidMenuResponse.ok()).toBe(true);
  expect(aidMenuResponse.request().postDataJSON().operations).toEqual(expect.arrayContaining([
    expect.objectContaining({ op: "update", id: line.id, data: expect.objectContaining({ aid: menuAid }) }),
  ]));
  await expect.poll(async () => (await apiJson<ConnectedEstimate>(page,
    `/api/estimates/${versionId}`)).items.find((item) => item.id === line.id)).toMatchObject({ aid: menuAid });
  const reloadAfterAidMenu = page.waitForResponse((response) => new URL(response.url()).pathname ===
    `/api/estimates/${versionId}/lock` && response.request().method() === "POST");
  await page.goto(`/dashboard/estimates/${versionId}/edit`);
  expect((await reloadAfterAidMenu).ok()).toBe(true);
  await expect(page.getByTestId("estimate-line-row")).toHaveCount(1);
  await page.getByTestId("estimate-line-row").getByRole("gridcell").first().click({ button: "right" });
  await expect(aidField).toHaveValue(menuAid);
  const menuReloaded = await apiJson<ConnectedEstimate>(page, `/api/estimates/${versionId}`);
  expect(money(menuReloaded)).toEqual(money(before));
  await recordConnectedStep(run, "Context-menu AID persisted through reload", { aid: menuAid, ...money(before) },
    { aid: menuAid, ...money(menuReloaded) });
});
