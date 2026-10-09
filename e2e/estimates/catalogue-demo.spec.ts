import { expect, test, type Page, type Route } from "@playwright/test";

// UI contract tests: all catalogue writes are intercepted. SQL/RLS invariants
// are covered separately by isolated PostgreSQL fixtures while Docker is absent.
const productId = "33333333-3333-4333-8333-333333333333";
const supplierId = "22222222-2222-4222-8222-222222222222";
const product = {
  id: productId, created_at: "2026-10-01T10:00:00Z", reference: "ART-000001",
  designation: "Tube de démonstration", unit: "m", unit_price_cents: 1000,
  is_active: true, _status: "active", _priceStatus: "fresh", _supplierPriceCount: 2,
  _bestSupplierPriceCents: 1000, _bestSupplierName: "Fournisseur Alpha",
};
const offer = {
  id: "44444444-4444-4444-8444-444444444444", supplier_id: supplierId, product_id: productId,
  supplier_catalog_item_id: "55555555-5555-4555-8555-555555555555",
  supplier_sku: "AL-018", product_url: "https://example.test/alpha",
  unit: "m", min_quantity: 5, unit_price_cents: 1000, currency: "EUR",
  transport_mode: null,
  valid_from: "2026-10-02", valid_to: "2027-04-02", _supplierName: "Fournisseur Alpha",
  _productName: product.designation, _freshnessLevel: "fresh", _ageDays: 0,
};
const success = (route: Route, data: unknown) => route.fulfill({ json: { ok: true, data } });

async function mockCatalogue(page: Page) {
  await page.route("**/api/catalogue?**", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("id")) return success(route, { items: [product] });
    const items = Array.from({ length: 40 }, (_, index) => ({
      ...product,
      id: index === 0 ? productId : `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`,
      designation: index === 0 ? product.designation : `Article de démonstration ${index}`,
    }));
    return success(route, {
      items, pagination: { page: 1, size: 50, totalItems: 40, totalPages: 1 },
      counters: { active: 40, covered: 40, withoutSupplierPrice: 0, stale: 0 },
      facets: { materials: [], categories: [], units: ["m"] },
    });
  });
  await page.route("**/api/products/reference-suggestion", (route) => success(route, { reference: "ART-000002" }));
  await page.route("**/api/prices/lookups?**", (route) => {
    const kind = new URL(route.request().url()).searchParams.get("kind");
    return success(route, { items: [{ id: kind === "supplier" ? supplierId : productId, label: kind === "supplier" ? "Fournisseur Alpha" : product.designation }] });
  });
  await page.route("**/api/prices?**", (route) => success(route, {
    items: [offer], pagination: { page: 1, size: 25, totalItems: 1, totalPages: 1 },
    counters: { total: 1, fresh: 1, aging: 0, stale: 0, uniqueSuppliers: 1 },
  }));
  // A reference-price panel may load on a focused product; never mutate it here.
  await page.route("**/api/catalogue/reference-price/**", (route) => route.fulfill({
    status: 503, json: { ok: false, error: { message: "Prix de référence indisponible dans cette fixture UI." } },
  }));
}

test.beforeEach(async ({ page }) => { await mockCatalogue(page); });

test("TI-578 propose une référence, respecte la saisie et confirme l’allocation si vide", async ({ page }) => {
  const writes: Array<{ item: { reference: string | null; designation: string } }> = [];
  await page.route("**/api/products", async (route) => {
    const body = route.request().postDataJSON();
    writes.push(body);
    return success(route, { item: { ...product, reference: body.item.reference || "ART-000003" } });
  });
  await page.goto("/dashboard/products");
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Ajouter un produit" });
  await expect(dialog.getByText("ART-000002", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Utiliser", exact: true }).click();
  await expect(dialog.getByLabel("Référence", { exact: true })).toHaveValue("ART-000002");
  await dialog.getByLabel("Référence", { exact: true }).fill("MANUEL-1");
  await dialog.getByLabel("Désignation *", { exact: true }).fill("Article manuel");
  await dialog.getByRole("button", { name: "Ajouter le produit", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(writes[0].item.reference).toBe("MANUEL-1");
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await dialog.getByLabel("Désignation *", { exact: true }).fill("Article automatique");
  await dialog.getByRole("button", { name: "Ajouter le produit", exact: true }).click();
  expect(writes[1].item.reference).toBeNull();
  await expect(page.getByText(/Référence : ART-000003/)).toBeVisible();
});

test("TI-579 ouvre une seule offre et enregistre son tarif et sa référence ensemble", async ({ page }) => {
  const writes: Array<{ action: string; id: string; item: Record<string, unknown> }> = [];
  const lookupRequests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/prices/lookups")) lookupRequests.push(request.url()); });
  await page.route("**/api/prices", (route) => {
    const body = route.request().postDataJSON();
    writes.push(body);
    return success(route, { item: { ...offer, ...body.item } });
  });
  await page.goto("/dashboard/prices");
  await page.getByRole("button", { name: "Voir / modifier l’offre", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Référence fournisseur", { exact: true })).toBeEnabled();
  await dialog.getByLabel("Référence fournisseur", { exact: true }).fill("AL-019");
  await dialog.getByLabel("Prix unitaire HT *", { exact: true }).fill("11,50");
  await dialog.getByRole("button", { name: "Enregistrer l’offre", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ action: "update-offer", id: offer.id, item: { supplier_sku: "AL-019", unit_price_cents: 1150 } });
  expect(lookupRequests).toHaveLength(0);
  await expect(page.getByRole("button", { name: "Fiche fournisseur", exact: true })).toHaveCount(0);
});

test("TI-581 libère le défilement après plusieurs retours à la fiche produit", async ({ page }) => {
  for (let index = 0; index < 3; index++) {
    await page.goto(`/dashboard/prices?product_id=${productId}`);
    await page.getByRole("button", { name: "Voir / modifier l’offre", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Annuler", exact: true }).click();
    await page.getByRole("link", { name: "Retour à la fiche produit", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Modifier le produit" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Fermer le formulaire produit", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
    await expect.poll(() => page.evaluate(() => Boolean(document.querySelector("main")?.closest("[inert]")))).toBe(false);
    await page.evaluate(() => window.scrollTo(0, 400));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  }
});
