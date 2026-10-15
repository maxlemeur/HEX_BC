import { expect } from "e2e";

import { armyTest, readEstimate, recordEvidence } from "../critical/fixtures";
import { connectedApi, connectedEstimate, connectedLine, connectedOpen, retainFixture, type ConnectedUi, type Envelope } from "./connected-support";

type Product = { id: string; reference: string; designation: string; unit_price_cents: number; reference_price_validation_id?: string | null };
type Offer = { id: string; supplier_id: string; product_id: string; supplier_sku: string | null; product_url: string | null;
  unit: string; min_quantity: number; unit_price_cents: number; transport_mode: string | null; valid_from: string; valid_to: string; is_active: boolean };
const options = { session: "army", tags: ["critical", "extended", "catalogue-connected"], trace: "off" as const, timeout: 300_000 };

async function createProduct(ui: ConnectedUi, label: string) {
  const designation = `${ui.army.runPrefix} ${label}`;
  const { item } = await connectedApi<{ item: Product }>(ui, "POST", "/api/products", {
    action: "create", item: { designation, reference: null, unit: "u", unit_price_cents: 0 },
  });
  await retainFixture(ui.army, "product", item.id, designation);
  return item;
}
async function readProduct(ui: ConnectedUi, id: string) {
  const { items } = await connectedApi<{ items: Product[] }>(ui, "GET", `/api/catalogue?id=${id}&include_inactive=true&limit=1`);
  expect(items).toHaveLength(1);
  expect(items[0].id).toBe(id);
  return items[0];
}
async function readOffers(ui: ConnectedUi, productId: string) {
  return (await connectedApi<{ items: Offer[] }>(ui, "GET", `/api/prices?view=page&product_id=${productId}&size=25`)).items;
}
function offerValues(offer: Offer) {
  return { id: offer.id, supplier_id: offer.supplier_id, product_id: offer.product_id, supplier_sku: offer.supplier_sku,
    product_url: offer.product_url, unit: offer.unit, min_quantity: offer.min_quantity, unit_price_cents: offer.unit_price_cents,
    transport_mode: offer.transport_mode, valid_from: offer.valid_from, valid_to: offer.valid_to, is_active: offer.is_active };
}
async function createOffers(ui: ConnectedUi) {
  await ui.app.open("/dashboard/products");
  const product = await createProduct(ui, "Article offres");
  const suppliers: Array<{ id: string; name: string }> = [];
  const offers: Offer[] = [];
  for (const [index, label] of ["Alpha", "Beta"].entries()) {
    const name = `${ui.army.runPrefix} ${label}`;
    const supplier = (await connectedApi<{ item: typeof suppliers[number] }>(ui, "POST", "/api/suppliers", {
      action: "create", item: { name, is_active: true },
    })).item;
    suppliers.push(supplier);
    await retainFixture(ui.army, "supplier", supplier.id, name);
    const offer = (await connectedApi<{ item: Offer }>(ui, "POST", "/api/prices", { action: "create", item: {
      supplier_id: supplier.id, product_id: product.id, supplier_sku: `${label}-ARMY`, product_url: `https://example.invalid/${label.toLowerCase()}`,
      unit: "u", min_quantity: 1, unit_price_cents: 1000 + index * 200, currency: "EUR", valid_from: new Date().toISOString().slice(0, 10),
    } })).item;
    offers.push(offer);
    await retainFixture(ui.army, "offer", offer.id, `${ui.army.runPrefix} offre ${label}`);
  }
  expect(new Set(offers.map(offer => offer.id)).size).toBe(2);
  return { product, suppliers, offers };
}
async function editOffer(ui: ConnectedUi, owned: Offer[], id: string, item: Record<string, unknown>) {
  expect(owned.some(offer => offer.id === id)).toBe(true);
  return (await connectedApi<{ item: Offer }>(ui, "POST", "/api/prices", { action: "update-offer", id, item })).item;
}

armyTest("CAT-C01 UI references persist and concurrent automatic allocations stay unique", options, async ui => {
  await ui.app.open("/dashboard/products");
  await ui.screen.getByRole("button", "Ajouter", { exact: true }).click();
  const dialog = ui.screen.getByRole("dialog", "Ajouter un produit");
  await expect(dialog.getByText(/Une référence sera générée automatiquement/)).toBeVisible();
  await expect(dialog.getByLabel("Référence", { exact: true })).toHaveValue("");
  await dialog.getByLabel("Désignation *", { exact: true }).fill(`${ui.army.runPrefix} Référence vide UI`);
  const automaticResponse = ui.browser.waitForResponse("**/api/products");
  await dialog.getByRole("button", "Ajouter le produit", { exact: true }).click();
  const response = await automaticResponse;
  expect(response.status).toBe(201);
  const automatic = (await response.json<Envelope<{ item: Product }>>()).data.item;
  await retainFixture(ui.army, "product", automatic.id, automatic.designation);
  expect(automatic.reference).toMatch(/^ART-\d{6,}$/);
  await expect(ui.screen.getByText(new RegExp(`Référence : ${automatic.reference}`))).toBeVisible();
  await ui.app.open(`/dashboard/products?product_id=${automatic.id}`);
  const reopened = ui.screen.getByRole("dialog", "Modifier le produit");
  await expect(reopened.getByLabel("Référence", { exact: true })).toHaveValue(automatic.reference);
  await reopened.getByRole("button", "Fermer le formulaire produit").click();
  await ui.app.open("/dashboard/products");
  await ui.screen.getByRole("button", "Ajouter", { exact: true }).click();
  const manualReference = `${ui.army.runPrefix} REF-MANUELLE`;
  await dialog.getByLabel("Référence", { exact: true }).fill(manualReference);
  await dialog.getByLabel("Désignation *", { exact: true }).fill(`${ui.army.runPrefix} Référence manuelle UI`);
  const manualResponse = ui.browser.waitForResponse("**/api/products");
  await dialog.getByRole("button", "Ajouter le produit", { exact: true }).click();
  const manual = (await (await manualResponse).json<Envelope<{ item: Product }>>()).data.item;
  await retainFixture(ui.army, "product", manual.id, manual.designation);
  expect(manual.reference).toBe(manualReference);
  expect((await readProduct(ui, manual.id)).reference).toBe(manualReference);
  const allocated = await Promise.all([createProduct(ui, "Concurrent A"), createProduct(ui, "Concurrent B")]);
  expect(new Set([automatic.reference, ...allocated.map(item => item.reference)]).size).toBe(3);
  for (const item of allocated) expect((await readProduct(ui, item.id)).reference).toBe(item.reference);
  await recordEvidence(ui.army, "references-concurrent", { automatic, manual, allocated, expectedDistinctAutomatic: 3 });
});

armyTest("CAT-C02 targeted offer edit persists without changing another offer or product reference price", options, async ui => {
  const { product, suppliers, offers } = await createOffers(ui);
  // The historical connected tenant already had a full catalogue page. Create
  // only owned rows so the same wheel-scroll oracle is valid on a fresh CI tenant.
  for (let index = 1; index <= 24; index += 1) await createProduct(ui, `Article défilement ${index}`);
  const beforeProduct = await readProduct(ui, product.id);
  const beforeOffers = await readOffers(ui, product.id);
  const untouched = offerValues(beforeOffers.find(item => item.id === offers[1].id)!);
  const lookups: string[] = [];
  let phase = "page";
  await ui.browser.route("**/api/prices/lookups**", async route => { lookups.push(phase); await route.fallback(); });
  await ui.app.open(`/dashboard/prices?product_id=${product.id}`);
  const row = ui.browser.locator('[aria-label="Offres fournisseurs"] li').filter({ hasText: suppliers[0].name });
  await expect(row).toBeVisible();
  phase = "editing";
  await row.getByRole("button", "Voir / modifier l’offre", { exact: true }).click();
  const dialog = ui.screen.getByRole("dialog", "Modifier l’offre fournisseur", { exact: true });
  await expect(dialog.getByLabel("Référence fournisseur", { exact: true })).toHaveValue("Alpha-ARMY");
  await expect(dialog.getByLabel("Transport", { exact: true })).toBeEnabled();
  await dialog.getByLabel("Référence fournisseur", { exact: true }).fill("Alpha-ARMY-MODIF");
  await dialog.getByLabel("URL fournisseur", { exact: true }).fill("https://example.invalid/alpha-modifie");
  await dialog.getByLabel("Prix unitaire HT *", { exact: true }).fill("11,50");
  await dialog.getByLabel("Transport", { exact: true }).selectOption({ value: "included" });
  expect(lookups.filter(value => value === "editing")).toEqual([]);
  phase = "saved";
  await dialog.getByRole("button", "Enregistrer l’offre", { exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const after = await readOffers(ui, product.id);
  const changed = after.find(item => item.id === offers[0].id)!;
  expect(changed).toMatchObject({ unit_price_cents: 1150, supplier_sku: "Alpha-ARMY-MODIF", product_url: "https://example.invalid/alpha-modifie", transport_mode: "included" });
  expect(offerValues(after.find(item => item.id === offers[1].id)!)).toEqual(untouched);
  const afterProduct = await readProduct(ui, product.id);
  expect(afterProduct.unit_price_cents).toBe(beforeProduct.unit_price_cents);
  expect(afterProduct.reference_price_validation_id).toBe(beforeProduct.reference_price_validation_id);
  await ui.browser.reload();
  await expect(row).toBeVisible();
  phase = "reopened-editing";
  await row.getByRole("button", "Voir / modifier l’offre", { exact: true }).click();
  for (const [label, value] of [["Prix unitaire HT *", "11,50"], ["Référence fournisseur", "Alpha-ARMY-MODIF"], ["URL fournisseur", "https://example.invalid/alpha-modifie"], ["Transport", "included"]]) {
    await expect(dialog.getByLabel(label, { exact: true })).toHaveValue(value);
  }
  expect(lookups.filter(value => value.endsWith("editing"))).toEqual([]);
  phase = "closed";
  await dialog.getByRole("button", "Annuler", { exact: true }).click();
  await ui.screen.getByRole("link", "Retour à la fiche produit", { exact: true }).click();
  const productDialog = ui.screen.getByRole("dialog", "Modifier le produit");
  await expect(productDialog.getByLabel("Référence", { exact: true })).toHaveValue(product.reference);
  await productDialog.getByRole("button", "Fermer le formulaire produit").click();
  await expect.poll(() => ui.browser.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  await expect.poll(() => ui.browser.evaluate(() => Boolean(document.querySelector("main")?.closest("[inert]")))).toBe(false);
  await expect.poll(() => ui.browser.evaluate(() => document.documentElement.scrollHeight > innerHeight)).toBe(true);
  const scroll = await ui.browser.evaluate(() => ({ top: scrollY, height: document.documentElement.scrollHeight, width: innerWidth, viewport: innerHeight }));
  await ui.browser.mouse.move(scroll.width * 0.75, scroll.viewport * 0.75);
  await ui.browser.mouse.wheel(0, scroll.top >= scroll.height - scroll.viewport - 2 ? -450 : 450);
  await expect.poll(() => ui.browser.evaluate(() => scrollY)).not.toBe(scroll.top);
  await recordEvidence(ui.army, "offer-targeted-persistence", { changed, untouchedBefore: untouched, untouchedAfter: offerValues(after.find(item => item.id === offers[1].id)!), beforeProduct, afterProduct, lookups, scrollBefore: scroll.top, scrollAfter: await ui.browser.evaluate(() => scrollY) });
});

async function retained(ui: ConnectedUi, versionId: string, lineId: string, offerId: string, cost: number) {
  const snapshot = await readEstimate(ui.browser, versionId);
  expect(snapshot.items.find(item => item.id === lineId)).toMatchObject({ quantity: 3, selected_supplier_price_id: offerId, unit_price_ht_cents: cost, line_total_ht_cents: Math.round(3 * cost * 1.5) });
  expect(snapshot.version.total_ht_cents).toBe(Math.round(3 * cost * 1.5));
  return { updated_at: snapshot.version.updated_at, ht: snapshot.version.total_ht_cents, line: snapshot.items.find(item => item.id === lineId) };
}

armyTest("CAT-C03 selected supplier survives navigation and later catalogue changes stay explicit", options, async ui => {
  const { product, suppliers, offers } = await createOffers(ui);
  const created = await connectedEstimate(ui, "Devis offres", { tax_rate_bp: 2000 });
  const versionId = created.version.id;
  await connectedOpen(ui, versionId);
  const line = await connectedLine(ui, versionId, { label: "Ligne offres", product_id: product.id, selected_supplier_price_id: offers[0].id, tax_rate_bp: 2000 });
  await expect.poll(async () => (await readEstimate(ui.browser, versionId)).version.total_ht_cents).toBe(4500);
  await retained(ui, versionId, line.id, offers[0].id, 1000);
  const row = ui.screen.getByTestId("estimate-line-row").filter({
    has: ui.screen.getByLabel(`Quantité pour ${line.title}`, { exact: true }),
  });
  const change = row.getByRole("button", `Changer d’offre pour ${line.title}`, { exact: true });
  await expect(change).toBeEnabled();
  const comparison = ui.browser.waitForResponse(`**/api/estimates/${versionId}/supplier-comparisons`);
  await change.click();
  expect((await comparison).status).toBe(200);
  const dialog = ui.screen.getByRole("dialog", "Comparer fournisseurs");
  const beta = ui.browser.locator('[role="dialog"] article').filter({ hasText: suppliers[1].name });
  await expect(beta).toContainText("Beta-ARMY");
  await expect(beta).toContainText(/Total fourniture.*36,00/);
  await expect(beta.getByRole("button", "Retenir cette offre", { exact: true })).toBeEnabled();
  await beta.getByRole("button", "Retenir cette offre", { exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await ui.screen.getByRole("link", "Affaires", { exact: true }).first().click();
  await expect(ui.browser).toHaveURL(/\/dashboard\/affaires(?:$|[/?#])/);
  const afterNavigation = await retained(ui, versionId, line.id, offers[1].id, 1200);
  await connectedOpen(ui, versionId);
  await expect(row.getByTestId("estimate-line-selected-supplier")).toContainText(suppliers[1].name);
  const persisted = await retained(ui, versionId, line.id, offers[1].id, 1200);
  const catalogueBeta = await editOffer(ui, offers, offers[1].id, { unit_price_cents: 1250 });
  expect(catalogueBeta.unit_price_cents).toBe(1250);
  await connectedOpen(ui, versionId, true);
  const preserved = await retained(ui, versionId, line.id, offers[1].id, 1200);
  expect(preserved.updated_at).toBe(persisted.updated_at);
  await change.click();
  await expect(beta.getByRole("button", "Actualiser cette offre", { exact: true })).toBeEnabled();
  await expect(dialog).toContainText(/Coût retenu.*12,00/);
  await dialog.getByRole("button", "Fermer", { exact: true }).click();
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const observations = [];
  for (const [label, patch, reason] of [
    ["unit", { unit: "m", min_quantity: 1 }, "Unité différente du devis"],
    ["minimum", { unit: "u", min_quantity: 10 }, "Minimum 10 u"],
    ["validity", { unit: "u", min_quantity: 1, valid_from: yesterday, valid_to: yesterday }, "Offre expirée"],
  ] as const) {
    const updated = await editOffer(ui, offers, offers[1].id, patch);
    const stored = (await connectedApi<{ items: Offer[] }>(ui, "GET", `/api/prices?product_id=${product.id}`)).items.find(item => item.id === offers[1].id);
    const projected = await connectedApi<{ comparisons: Array<{ item_id: string; alternatives: Array<Partial<Offer> & { supplier_price_id: string }> }> }>(ui, "POST", `/api/estimates/${versionId}/supplier-comparisons`, { item_ids: [line.id] });
    const compared = projected.comparisons.find(item => item.item_id === line.id)?.alternatives.find(item => item.supplier_price_id === offers[1].id);
    expect(updated).toMatchObject(patch);
    expect(stored).toMatchObject(patch);
    expect(compared).toMatchObject(patch);
    await connectedOpen(ui, versionId, true);
    await change.click();
    await expect(beta).toContainText(reason);
    await expect(beta.getByRole("button", "Actualiser cette offre", { exact: true })).toBeDisabled();
    const unchanged = await retained(ui, versionId, line.id, offers[1].id, 1200);
    expect(unchanged.updated_at).toBe(persisted.updated_at);
    observations.push({ label, patch, updated, stored, compared, unchanged });
    await dialog.getByRole("button", "Fermer", { exact: true }).click();
  }
  await recordEvidence(ui.army, "offer-selection-preserved", { afterNavigation, persisted, preserved, catalogueBeta, observations });
});
