import { expect, test as base, type Page } from "@playwright/test";
import {
  apiJson, assertOwned, captureBusinessScreen, createConnectedRun, loginAndVerifyIdentity,
  ownFixture, persistConnectedRun, recordConnectedStep, type ConnectedRun,
} from "./demo-eight-connected.helpers";

type Product = { id: string; reference: string; designation: string; unit_price_cents: number; reference_price_validation_id?: string | null };
type Offer = { id: string; supplier_id: string; product_id: string; supplier_sku: string | null; product_url: string | null; unit: string; min_quantity: number; unit_price_cents: number; transport_mode: string | null; valid_from: string; valid_to: string; is_active: boolean };
type Estimate = {
  project: { id: string; name: string };
  version: { id: string; updated_at: string; margin_multiplier: number; total_ht_cents: number };
  items: Array<{ id: string; item_type: string; selected_supplier_price_id: string | null; quantity: number; description: string; unit_price_ht_cents: number; line_total_ht_cents: number }>;
};
const test = base.extend<{ run: ConnectedRun }>({
  run: async ({ page }, runTest, testInfo) => {
    const run = await createConnectedRun(testInfo, "catalogue");
    let result = "failed";
    try {
      await loginAndVerifyIdentity(page, run);
      await runTest(run);
      result = testInfo.status ?? "failed";
    } finally {
      run.manifest.result = result;
      run.manifest.finishedAt = new Date().toISOString();
      await persistConnectedRun(run);
      await testInfo.attach("business-manifest", { path: run.manifestPath, contentType: "application/json" });
    }
  },
});

async function createProduct(page: Page, run: ConnectedRun, label: string, reference: string | null = null) {
  assertOwned(run);
  const designation = `${run.prefix} ${label}`;
  const result = await apiJson<{ item: Product }>(page, "/api/products", {
    method: "POST", data: { action: "create", item: { designation, reference, unit: "u", unit_price_cents: 0 } },
  });
  await ownFixture(run, "product", result.item.id, designation);
  return result.item;
}
async function readProduct(page: Page, id: string) {
  const result = await apiJson<{ items: Product[] }>(page, `/api/catalogue?id=${id}&include_inactive=true&limit=1`);
  expect(result.items).toHaveLength(1);
  expect(result.items[0].id).toBe(id);
  return result.items[0];
}
async function readOffers(page: Page, productId: string) {
  // Same current-metadata projection as the interface; legacy list retains
  // the price-row's historical supplier_sku snapshot by design.
  return (await apiJson<{ items: Offer[] }>(page, `/api/prices?view=page&product_id=${productId}&size=25`)).items;
}
async function createOffers(page: Page, run: ConnectedRun) {
  const product = await createProduct(page, run, "Article offres");
  const suppliers: Array<{ id: string; name: string }> = [];
  const offers: Offer[] = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const [index, label] of ["Alpha", "Beta"].entries()) {
    const name = `${run.prefix} ${label}`;
    assertOwned(run);
    const supplier = (await apiJson<{ item: { id: string; name: string } }>(page, "/api/suppliers", {
      method: "POST", data: { action: "create", item: { name, is_active: true } },
    })).item;
    await ownFixture(run, "supplier", supplier.id, name);
    suppliers.push(supplier);
    assertOwned(run, supplier.id, product.id);
    const offer = (await apiJson<{ item: Offer }>(page, "/api/prices", {
      method: "POST", data: { action: "create", item: {
        supplier_id: supplier.id, product_id: product.id, supplier_sku: `${label}-ARMY`,
        product_url: `https://example.invalid/${label.toLowerCase()}`, unit: "u", min_quantity: 1,
        unit_price_cents: 1000 + index * 200, currency: "EUR", valid_from: today,
      } },
    })).item;
    await ownFixture(run, "offer", offer.id, `${run.prefix} offre ${label}`);
    offers.push(offer);
  }
  expect(new Set(offers.map((offer) => offer.id)).size).toBe(2);
  return { product, suppliers, offers };
}
function offerValues(offer: Offer) {
  return { id: offer.id, supplier_id: offer.supplier_id, product_id: offer.product_id,
    supplier_sku: offer.supplier_sku, product_url: offer.product_url, unit: offer.unit,
    min_quantity: offer.min_quantity, unit_price_cents: offer.unit_price_cents,
    transport_mode: offer.transport_mode, valid_from: offer.valid_from, valid_to: offer.valid_to, is_active: offer.is_active };
}
async function editOffer(page: Page, run: ConnectedRun, offerId: string, patch: Record<string, unknown>) {
  assertOwned(run, offerId);
  return (await apiJson<{ item: Offer }>(page, "/api/prices", {
    method: "POST", data: { action: "update-offer", id: offerId, item: patch },
  })).item;
}

test("TI-578 références UI persistées et deux allocations concurrentes uniques", async ({ page, run }, testInfo) => {
  await page.goto("/dashboard/products");
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Ajouter un produit" });
  await expect(dialog.getByText(/Une référence sera générée automatiquement/)).toBeVisible();
  await expect(dialog.getByLabel("Référence", { exact: true })).toHaveValue("");
  await dialog.getByLabel("Désignation *", { exact: true }).fill(`${run.prefix} Référence vide UI`);
  const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/products" && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Ajouter le produit", exact: true }).click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  const automatic = (await response.json()).data.item as Product;
  await ownFixture(run, "product", automatic.id, automatic.designation);
  expect(automatic.reference).toMatch(/^ART-\d{6,}$/);
  await expect(page.getByText(new RegExp(`Référence : ${automatic.reference}`))).toBeVisible();
  await page.goto(`/dashboard/products?product_id=${automatic.id}`);
  const reopened = page.getByRole("dialog", { name: "Modifier le produit" });
  await expect(reopened.getByLabel("Référence", { exact: true })).toHaveValue(automatic.reference);
  await captureBusinessScreen(page, testInfo, "reference-automatique-reouverte");
  await reopened.getByRole("button", { name: "Fermer le formulaire produit" }).click();
  await page.goto("/dashboard/products");
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  const manualReference = `${run.prefix} REF-MANUELLE`;
  await dialog.getByLabel("Référence", { exact: true }).fill(manualReference);
  await dialog.getByLabel("Désignation *", { exact: true }).fill(`${run.prefix} Référence manuelle UI`);
  const manualResponse = page.waitForResponse((res) => new URL(res.url()).pathname === "/api/products" && res.request().method() === "POST");
  await dialog.getByRole("button", { name: "Ajouter le produit", exact: true }).click();
  const manual = (await (await manualResponse).json()).data.item as Product;
  await ownFixture(run, "product", manual.id, manual.designation);
  expect(manual.reference).toBe(manualReference);
  expect((await readProduct(page, manual.id)).reference).toBe(manualReference);
  const allocated = await Promise.all([createProduct(page, run, "Concurrent A"), createProduct(page, run, "Concurrent B")]);
  expect(new Set([automatic.reference, ...allocated.map((item) => item.reference)]).size).toBe(3);
  for (const item of allocated) expect((await readProduct(page, item.id)).reference).toBe(item.reference);
  await recordConnectedStep(run, "references persisted and concurrent", { automaticPattern: "ART-sequence", manual: manualReference, distinctAutomaticCount: 3 }, {
    automatic: { id: automatic.id, reference: automatic.reference }, manual: { id: manual.id, reference: manual.reference },
    concurrent: allocated.map(({ id, reference }) => ({ id, reference })),
  });
});

test("TI-579 modification ciblée réelle, autre offre et référence article conservées", async ({ page, run }, testInfo) => {
  const { product, suppliers, offers } = await createOffers(page, run);
  const baselineProduct = await readProduct(page, product.id);
  const baselineOffers = await readOffers(page, product.id);
  const untouched = offerValues(baselineOffers.find((item) => item.id === offers[1].id)!);
  let lookupPhase = "page";
  const lookupRequests: Array<{ phase: string; query: string }> = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/prices/lookups") lookupRequests.push({ phase: lookupPhase, query: url.search });
  });
  await page.goto(`/dashboard/prices?product_id=${product.id}`);
  const row = page.getByRole("list", { name: "Offres fournisseurs" }).locator("li").filter({ hasText: suppliers[0].name });
  await expect(row).toBeVisible();
  lookupPhase = "editing";
  await row.getByRole("button", { name: "Voir / modifier l’offre", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Référence fournisseur", { exact: true })).toHaveValue("Alpha-ARMY");
  await expect(dialog.getByLabel("Transport", { exact: true })).toBeEnabled();
  await dialog.getByLabel("Référence fournisseur", { exact: true }).fill("Alpha-ARMY-MODIF");
  await dialog.getByLabel("URL fournisseur", { exact: true }).fill("https://example.invalid/alpha-modifie");
  await dialog.getByLabel("Prix unitaire HT *", { exact: true }).fill("11,50");
  await dialog.getByLabel("Transport", { exact: true }).selectOption("included");
  await captureBusinessScreen(page, testInfo, "offre-ciblee-avant-enregistrement");
  await recordConnectedStep(run, "targeted editing lookups", { editingLookups: 0 }, [...lookupRequests]);
  expect(lookupRequests.filter((request) => request.phase === "editing")).toHaveLength(0);
  lookupPhase = "saved";
  await dialog.getByRole("button", { name: "Enregistrer l’offre", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const after = await readOffers(page, product.id);
  const changed = after.find((item) => item.id === offers[0].id)!;
  const rawPrices = await apiJson<{ items: Offer[] }>(page, `/api/prices?product_id=${product.id}`);
  await recordConnectedStep(run, "persisted offer and UI read model", {
    price: 1150, reference: "Alpha-ARMY-MODIF", url: "https://example.invalid/alpha-modifie", transport: "included",
  }, {
    uiProjection: offerValues(changed),
    uiProjectionHasTransport: Object.prototype.hasOwnProperty.call(changed, "transport_mode"),
    persistedTransport: rawPrices.items.find((item) => item.id === offers[0].id)?.transport_mode,
  });
  expect(changed).toMatchObject({ unit_price_cents: 1150, supplier_sku: "Alpha-ARMY-MODIF", product_url: "https://example.invalid/alpha-modifie", transport_mode: "included" });
  expect(offerValues(after.find((item) => item.id === offers[1].id)!)).toEqual(untouched);
  const afterProduct = await readProduct(page, product.id);
  expect(afterProduct.unit_price_cents).toBe(baselineProduct.unit_price_cents);
  expect(afterProduct.reference_price_validation_id).toBe(baselineProduct.reference_price_validation_id);
  await page.reload();
  await expect(row).toBeVisible();
  lookupPhase = "reopened-editing";
  await row.getByRole("button", { name: "Voir / modifier l’offre", exact: true }).click();
  await expect(dialog.getByLabel("Prix unitaire HT *", { exact: true })).toHaveValue("11,50");
  await expect(dialog.getByLabel("Référence fournisseur", { exact: true })).toHaveValue("Alpha-ARMY-MODIF");
  await expect(dialog.getByLabel("URL fournisseur", { exact: true })).toHaveValue("https://example.invalid/alpha-modifie");
  await expect(dialog.getByLabel("Transport", { exact: true })).toHaveValue("included");
  await captureBusinessScreen(page, testInfo, "offre-ciblee-reouverte");
  await recordConnectedStep(run, "reopened targeted editing lookups", { editingLookups: 0 }, [...lookupRequests]);
  expect(lookupRequests.filter((request) => request.phase.endsWith("editing"))).toHaveLength(0);
  lookupPhase = "closed";
  await dialog.getByRole("button", { name: "Annuler", exact: true }).click();
  await page.getByRole("link", { name: "Retour à la fiche produit", exact: true }).click();
  const productDialog = page.getByRole("dialog", { name: "Modifier le produit" });
  await expect(productDialog.getByLabel("Référence", { exact: true })).toHaveValue(product.reference);
  await productDialog.getByRole("button", { name: "Fermer le formulaire produit" }).click();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  await expect.poll(() => page.evaluate(() => Boolean(document.querySelector("main")?.closest("[inert]")))).toBe(false);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight), {
    message: "The retained catalogue fixtures must provide a real page scroll range",
  }).toBe(true);
  const beforeScroll = await page.evaluate(() => ({
    top: window.scrollY, height: document.documentElement.scrollHeight, viewport: window.innerHeight,
  }));
  const viewport = page.viewportSize()!;
  await page.mouse.move(viewport.width * 0.75, viewport.height * 0.75);
  const wheelDelta = beforeScroll.top >= beforeScroll.height - beforeScroll.viewport - 2 ? -450 : 450;
  await page.mouse.wheel(0, wheelDelta);
  await expect.poll(() => page.evaluate(() => window.scrollY), {
    message: "A real wheel gesture must scroll the product page after returning and closing its form",
  }).not.toBe(beforeScroll.top);
  const afterScroll = await page.evaluate(() => ({ top: window.scrollY, overflow: document.body.style.overflow }));
  await recordConnectedStep(run, "product page scroll after return", { pageMoved: true, wheelDelta }, {
    before: beforeScroll, after: afterScroll,
  });
  await captureBusinessScreen(page, testInfo, "retour-produit-defilement-reel");
  await recordConnectedStep(run, "targeted persisted edit", { changedPrice: 1150, transport: "included", otherOfferUnchanged: true, referencePriceUnchanged: true, lookups: 0 }, {
    changed: offerValues(changed), untouchedBefore: untouched, untouchedAfter: offerValues(after.find((item) => item.id === offers[1].id)!),
    referencePriceBefore: baselineProduct.unit_price_cents, referencePriceAfter: afterProduct.unit_price_cents,
    editingLookupCount: lookupRequests.filter((request) => request.phase.endsWith("editing")).length, lookupRequests,
  });
});

async function createEstimateWithLine(page: Page, run: ConnectedRun, product: Product, alpha: Offer) {
  assertOwned(run, product.id, alpha.id);
  const created = await apiJson<Estimate>(page, "/api/estimates", { method: "POST", data: {
    creation_mode: "blank", project: { name: `${run.prefix} Devis offres` },
    version: { title: `${run.prefix} Version offres`, margin_mode: "fixed", margin_multiplier: 1.5, global_coefficient: 1,
      discount_bp: 0, tax_rate_bp: 2000, currency: "EUR", rounding_mode: "none" },
  } });
  await ownFixture(run, "project", created.project.id, created.project.name);
  await ownFixture(run, "estimate-version", created.version.id, `${run.prefix} Version offres`);
  const lockResponse = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/estimates/${created.version.id}/lock` && response.request().method() === "POST");
  await page.goto(`/dashboard/estimates/${created.version.id}/edit`);
  expect((await lockResponse).ok(), "Normal editor lease must be acquired").toBe(true);
  await expect(page.getByRole("grid", { name: "Lignes de devis" })).toBeVisible();
  const initial = await apiJson<Estimate>(page, `/api/estimates/${created.version.id}`);
  let parentId = initial.items.find((item) => item.item_type === "section")?.id ?? null;
  const leaseId = await page.evaluate((versionId) => sessionStorage.getItem(`__miaouffrageEstimateDraftLockSession:${versionId}`), created.version.id);
  expect(leaseId, "Editor page lease is required; no cookie or auth token is read").toMatch(/^[0-9a-f-]{36}$/i);
  if (parentId === null) {
    const title = `${run.prefix} Section offres`;
    const section = (await apiJson<{ item: { id: string } }>(page, `/api/estimates/${created.version.id}/items`, {
      method: "POST", headers: { "x-estimate-draft-lock-session-id": leaseId! },
      data: { item_type: "section", title, position: 1 },
    })).item;
    await ownFixture(run, "estimate-section", section.id, title);
    parentId = section.id;
  }
  const line = (await apiJson<{ item: Estimate["items"][number] }>(page, `/api/estimates/${created.version.id}/items`, {
    method: "POST", headers: { "x-estimate-draft-lock-session-id": leaseId! }, data: {
    item_type: "line", parent_id: parentId, title: product.designation, description: "u", quantity: 4,
    unit_price_ht_cents: 1000, tax_rate_bp: 2000, k_fo: 1, h_mo: 0, k_mo: 1,
    line_nature: "supply_only", product_id: product.id, selected_supplier_price_id: alpha.id,
  } })).item;
  await ownFixture(run, "estimate-line", line.id, product.designation);
  const reloadLease = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/estimates/${created.version.id}/lock` && response.request().method() === "POST");
  await page.reload();
  expect((await reloadLease).ok()).toBe(true);
  const quantity = page.getByRole("textbox", { name: `Quantité pour ${product.designation}`, exact: true });
  await expect(quantity).toBeEnabled();
  await quantity.locator('xpath=ancestor::*[@role="gridcell"][1]').click();
  await expect(quantity).toBeFocused();
  await expect(quantity).toHaveCSS("opacity", "1");
  await quantity.fill("3");
  await quantity.press("Tab");
  // Establish the baseline fixture with an explicit save. The later Beta
  // selection/navigation deliberately never uses Ctrl+S and proves that path.
  await page.keyboard.press("Control+s");
  await expect.poll(async () => {
    const saved = await apiJson<Estimate>(page, `/api/estimates/${created.version.id}`);
    const persisted = saved.items.find((item) => item.id === line.id);
    return { quantity: persisted?.quantity, cost: persisted?.unit_price_ht_cents,
      selected: persisted?.selected_supplier_price_id, lineHt: persisted?.line_total_ht_cents,
      versionHt: saved.version.total_ht_cents };
  }, { timeout: 60_000 }).toEqual({ quantity: 3, cost: 1000, selected: alpha.id, lineHt: 4500, versionHt: 4500 });
  await recordConnectedStep(run, "Alpha baseline saved through UI and Ctrl+S fixture setup", { quantity: 3, cost: 1000, margin: 1.5, ht: 4500 },
    await assertRetained(page, created.version.id, line.id, alpha.id, 1000));
  return { versionId: created.version.id, lineId: line.id };
}
async function assertRetained(page: Page, versionId: string, lineId: string, supplierPriceId: string, cost: number) {
  const snapshot = await apiJson<Estimate>(page, `/api/estimates/${versionId}`);
  const line = snapshot.items.find((item) => item.id === lineId);
  expect(line).toMatchObject({ selected_supplier_price_id: supplierPriceId, quantity: 3, description: "u", unit_price_ht_cents: cost, line_total_ht_cents: cost * 3 * 1.5 });
  expect(snapshot.version.margin_multiplier).toBe(1.5);
  expect(snapshot.version.total_ht_cents).toBe(cost * 3 * 1.5);
  return { versionId, lineId, updated_at: snapshot.version.updated_at, selected_supplier_price_id: line!.selected_supplier_price_id,
    unit_price_ht_cents: line!.unit_price_ht_cents, quantity: line!.quantity, unit: line!.description,
    line_total_ht_cents: line!.line_total_ht_cents, total_ht_cents: snapshot.version.total_ht_cents };
}

test("TI-579/580 offre retenue, sauvegarde à la navigation et coût conservé après tarif", async ({ page, run }, testInfo) => {
  const { product, suppliers, offers } = await createOffers(page, run);
  const { versionId, lineId } = await createEstimateWithLine(page, run, product, offers[0]);
  const row = page.locator(`[data-estimate-item-id="${lineId}"]`);
  const changeButton = row.getByRole("button", { name: `Changer d’offre pour ${product.designation}`, exact: true });
  await expect(row.locator('[data-testid="estimate-line-selected-supplier"]')).toContainText(suppliers[0].name);
  const directComparison = await apiJson<{ comparisons: unknown }>(page, `/api/estimates/${versionId}/supplier-comparisons`, {
    method: "POST", data: { item_ids: [lineId] },
  });
  await recordConnectedStep(run, "comparison ordinary API before UI click", { betaId: offers[1].id }, directComparison.comparisons);
  await expect(changeButton).toBeEnabled();
  await changeButton.evaluate((button) => {
    const events: Array<{ type: string; button?: number; detail?: number; disabled: boolean; connected: boolean; focused: boolean; phase: string }> = [];
    (window as Window & { offerButtonEvents?: typeof events }).offerButtonEvents = events;
    for (const event of ["pointerdown", "mousedown", "mouseup", "click", "keydown", "focusin"]) {
      button.addEventListener(event, (domEvent) => {
        const mouse = domEvent instanceof MouseEvent ? domEvent : null;
        events.push({ type: event, button: mouse?.button, detail: mouse?.detail,
          disabled: (button as HTMLButtonElement).disabled, connected: button.isConnected,
          focused: document.activeElement === button, phase: "button-capture" });
      }, { capture: true });
    }
    for (const type of ["mousedown", "click", "focusin"]) {
      document.addEventListener(type, (event) => {
        const mouse = event instanceof MouseEvent ? event : null;
        if (event.target === button) events.push({ type, button: mouse?.button, detail: mouse?.detail,
          disabled: (button as HTMLButtonElement).disabled, connected: button.isConnected,
          focused: document.activeElement === button, phase: "document-bubble" });
      });
    }
  });
  const comparisonRequests: Array<{ method: string; failed?: string | null }> = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === `/api/estimates/${versionId}/supplier-comparisons`) {
      comparisonRequests.push({ method: request.method() });
    }
  });
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).pathname === `/api/estimates/${versionId}/supplier-comparisons`) {
      comparisonRequests.push({ method: request.method(), failed: request.failure()?.errorText });
    }
  });
  const comparisonResponse = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/estimates/${versionId}/supplier-comparisons`, { timeout: 20_000 }).catch(() => null);
  await changeButton.click();
  const comparisonHttp = await comparisonResponse;
  if (!comparisonHttp) {
    await captureBusinessScreen(page, testInfo, "changer-offre-clic-sans-comparaison");
    const pointerEvents = await page.evaluate(() => (window as Window & { offerButtonEvents?: unknown[] }).offerButtonEvents ?? []);
    const firstRequests = [...comparisonRequests];
    const secondResponse = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/estimates/${versionId}/supplier-comparisons`, { timeout: 5_000 }).catch(() => null);
    await changeButton.click();
    const secondHttp = await secondResponse;
    let focusedPointerHttp = null;
    let keyboardHttp = null;
    if (!secondHttp) {
      const focusedPointer = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/estimates/${versionId}/supplier-comparisons`, { timeout: 5_000 }).catch(() => null);
      await changeButton.focus();
      await expect(changeButton).toBeFocused();
      await changeButton.click();
      focusedPointerHttp = await focusedPointer;
      if (!focusedPointerHttp) {
        const keyboardResponse = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/estimates/${versionId}/supplier-comparisons`, { timeout: 5_000 }).catch(() => null);
        await changeButton.press("Enter");
        keyboardHttp = await keyboardResponse;
      }
    }
    await recordConnectedStep(run, "enabled offer button pointer and keyboard diagnosis", { pointerStartsComparison: true }, {
      pointerEvents, firstRequests, allRequests: comparisonRequests,
      pointerResponse: false, secondPointerResponse: secondHttp?.status() ?? null,
      focusedPointerResponse: focusedPointerHttp?.status() ?? null, keyboardResponse: keyboardHttp?.status() ?? null,
      laterEvents: await page.evaluate(() => (window as Window & { offerButtonEvents?: unknown[] }).offerButtonEvents ?? []),
      dialogVisible: await page.getByRole("dialog", { name: "Comparer fournisseurs" }).isVisible(),
      disabled: await changeButton.isDisabled(),
    });
  }
  expect(comparisonHttp, "Enabled Changer d’offre must open a comparison after a normal pointer click").not.toBeNull();
  if (!comparisonHttp) throw new Error("Enabled Changer d’offre did not start a comparison.");
  const comparisonBody = await comparisonHttp.json() as { ok: boolean; data?: { comparisons: unknown }; error?: { code?: string; message?: string } };
  await recordConnectedStep(run, "comparison API response", { success: true, alphaId: offers[0].id, betaId: offers[1].id }, {
    httpStatus: comparisonHttp.status(), ok: comparisonBody.ok, comparisons: comparisonBody.data?.comparisons,
    errorCode: comparisonBody.error?.code, errorMessage: comparisonBody.error?.message,
  });
  expect(comparisonBody.ok).toBe(true);
  const dialog = page.getByRole("dialog", { name: "Comparer fournisseurs" });
  const beta = dialog.locator("article").filter({ hasText: suppliers[1].name });
  await expect(beta).toContainText("Beta-ARMY");
  await expect(beta).toContainText(/Total fourniture.*36,00/);
  await expect(beta.getByRole("button", { name: "Retenir cette offre", exact: true })).toBeEnabled();
  await captureBusinessScreen(page, testInfo, "comparaison-alpha-beta");
  await beta.getByRole("button", { name: "Retenir cette offre", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("link", { name: "Affaires", exact: true }).first().click();
  await page.waitForURL(/\/dashboard\/affaires(?:$|[/?#])/);
  const afterNavigation = await assertRetained(page, versionId, lineId, offers[1].id, 1200);
  await page.goto(`/dashboard/estimates/${versionId}/edit`);
  await expect(row.locator('[data-testid="estimate-line-selected-supplier"]')).toContainText(suppliers[1].name);
  const persisted = await assertRetained(page, versionId, lineId, offers[1].id, 1200);
  await captureBusinessScreen(page, testInfo, "beta-retenue-devis-reouvert");
  const catalogueBeta = await editOffer(page, run, offers[1].id, { unit_price_cents: 1250 });
  expect(catalogueBeta.unit_price_cents).toBe(1250);
  await page.reload();
  await expect(row).toBeVisible();
  const preserved = await assertRetained(page, versionId, lineId, offers[1].id, 1200);
  expect(preserved.updated_at).toBe(persisted.updated_at);
  await changeButton.click();
  await expect(beta.getByRole("button", { name: "Actualiser cette offre", exact: true })).toBeEnabled();
  await expect(dialog).toContainText(/Coût retenu.*12,00/);
  await captureBusinessScreen(page, testInfo, "beta-catalogue-1250-devis-1200");
  await recordConnectedStep(run, "navigation persisted and catalogue does not rewrite estimate", { supplierPriceId: offers[1].id, retainedCost: 1200, totalHt: 5400, catalogueCost: 1250, versionUnchanged: true }, { afterNavigation, persisted, preserved, catalogueCost: catalogueBeta.unit_price_cents });
  await dialog.getByRole("button", { name: "Fermer", exact: true }).click();
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  for (const [label, patch, reason] of [
    ["unité", { unit: "m", min_quantity: 1 }, "Unité différente du devis"],
    ["minimum", { unit: "u", min_quantity: 10 }, "Minimum 10 u"],
    ["validité", { unit: "u", min_quantity: 1, valid_from: yesterday, valid_to: yesterday }, "Offre expirée"],
  ] as const) {
    const updated = await editOffer(page, run, offers[1].id, patch);
    const stored = (await apiJson<{ items: Offer[] }>(page, `/api/prices?product_id=${product.id}`))
      .items.find((item) => item.id === offers[1].id);
    const comparison = await apiJson<{
      comparisons: Array<{ item_id: string; alternatives: Array<Partial<Offer> & { supplier_price_id: string }> }>;
    }>(page, `/api/estimates/${versionId}/supplier-comparisons`, { method: "POST", data: { item_ids: [lineId] } });
    const compared = comparison.comparisons.find((item) => item.item_id === lineId)
      ?.alternatives.find((item) => item.supplier_price_id === offers[1].id);
    await recordConnectedStep(run, `incompatible ${label} persisted and projected`, patch, {
      updateResponse: offerValues(updated), stored: stored ? offerValues(stored) : null, compared,
    });
    expect(updated, "The ordinary offer update must retain the requested conditions").toMatchObject(patch);
    expect(stored, "Stored offer conditions must match before the UI oracle").toMatchObject(patch);
    expect(compared, "The comparison API must provide the persisted conditions").toMatchObject(patch);
    await page.reload();
    await changeButton.click();
    await expect(beta).toContainText(reason);
    await expect(beta.getByRole("button", { name: "Actualiser cette offre", exact: true })).toBeDisabled();
    await captureBusinessScreen(page, testInfo, `offre-incompatible-${label}`);
    const unchanged = await assertRetained(page, versionId, lineId, offers[1].id, 1200);
    expect(unchanged.updated_at).toBe(persisted.updated_at);
    await recordConnectedStep(run, `incompatible ${label}`, { disabled: true, reason, retainedCost: 1200 }, unchanged);
    await dialog.getByRole("button", { name: "Fermer", exact: true }).click();
  }
});
