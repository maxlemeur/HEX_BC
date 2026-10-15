import { expect } from "e2e";

import { armyTest, recordEvidence } from "../critical/fixtures";

const productId = "33333333-3333-4333-8333-333333333333";
const supplierId = "22222222-2222-4222-8222-222222222222";
const product = {
  id: productId, created_at: "2026-10-01T10:00:00Z", reference: "ART-000001",
  designation: "ARMY synthetic catalogue article", unit: "m", unit_price_cents: 1000,
  is_active: true, _status: "active", _priceStatus: "fresh", _supplierPriceCount: 2,
  _bestSupplierPriceCents: 1000, _bestSupplierName: "ARMY Supplier Alpha",
};
const offer = {
  id: "44444444-4444-4444-8444-444444444444", supplier_id: supplierId, product_id: productId,
  supplier_catalog_item_id: "55555555-5555-4555-8555-555555555555",
  supplier_sku: "AL-018", product_url: "https://example.invalid/alpha",
  unit: "m", min_quantity: 5, unit_price_cents: 1000, currency: "EUR", transport_mode: null,
  valid_from: "2026-10-02", valid_to: "2027-04-02", _supplierName: "ARMY Supplier Alpha",
  _productName: product.designation, _freshnessLevel: "fresh", _ageDays: 0,
};
const options = { session: "army", tags: ["critical", "extended", "catalogue-ui"], trace: "off" as const, timeout: 120_000 };
type Ui = Parameters<Parameters<typeof armyTest>[2]>[0];

async function catalogue(ui: Ui) {
  const writes: Array<{ action?: string; id?: string; item: Record<string, unknown> }> = [];
  const lookups: string[] = [];
  await ui.browser.route("**/api/**", async (route) => {
    const url = new URL(route.request.url);
    const success = async (data: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data }) });
    if (url.pathname === "/api/catalogue") {
      if (url.searchParams.has("id")) return success({ items: [product] });
      return success({
        items: Array.from({ length: 40 }, (_, index) => ({ ...product,
          id: index === 0 ? productId : `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`,
          designation: index === 0 ? product.designation : `ARMY synthetic article ${index}`,
        })),
        pagination: { page: 1, size: 50, totalItems: 40, totalPages: 1 },
        counters: { active: 40, covered: 40, withoutSupplierPrice: 0, stale: 0 },
        facets: { materials: [], categories: [], units: ["m"] },
      });
    }
    if (url.pathname === "/api/products/reference-suggestion") return success({ reference: "ART-000002" });
    if (url.pathname === "/api/products" && route.request.method === "POST") {
      const body = JSON.parse(route.request.postData ?? "{}") as (typeof writes)[number];
      writes.push(body);
      return success({ item: { ...product, reference: body.item.reference || "ART-000003" } });
    }
    if (url.pathname === "/api/prices/lookups") {
      const kind = url.searchParams.get("kind"); lookups.push(kind ?? "");
      return success({ suppliers: [{ id: supplierId, name: "ARMY Supplier Alpha" }], products: [{ id: productId, designation: product.designation, reference: product.reference }] });
    }
    if (url.pathname === "/api/prices") {
      if (route.request.method === "POST") {
        const body = JSON.parse(route.request.postData ?? "{}") as (typeof writes)[number];
        writes.push(body); return success({ item: { ...offer, ...body.item } });
      }
      return success({ items: [offer], pagination: { page: 1, size: 25, totalItems: 1, totalPages: 1 },
        counters: { total: 1, fresh: 1, aging: 0, stale: 0, uniqueSuppliers: 1 } });
    }
    if (url.pathname === "/api/catalogue/reference-price" || url.pathname.startsWith("/api/catalogue/reference-price/")) return route.fulfill({
      status: 503, json: { ok: false, error: { message: "Synthetic reference-price panel unavailable." } },
    });
    // Only synthetic endpoints above may mutate during this UI contract.
    if (!["GET", "HEAD", "OPTIONS"].includes(route.request.method)) {
      await route.abort(); throw new Error(`Unexpected catalogue UI write: ${route.request.method} ${url.pathname}`);
    }
    await route.fallback();
  });
  return { writes, lookups };
}

armyTest("CAT01 reference suggestion preserves human input and confirms automatic allocation", options, async (ui) => {
  const { writes } = await catalogue(ui);
  await ui.app.open("/dashboard/products");
  await ui.screen.getByRole("button", "Ajouter", { exact: true }).click();
  const dialog = ui.screen.getByRole("dialog", "Ajouter un produit", { exact: true });
  await expect(dialog.getByText("ART-000002", { exact: true })).toBeVisible();
  await dialog.getByRole("button", "Utiliser", { exact: true }).click();
  await expect(dialog.getByLabel("Référence", { exact: true })).toHaveValue("ART-000002");
  await dialog.getByLabel("Référence", { exact: true }).fill("ARMY-MANUAL-1");
  await dialog.getByLabel("Désignation *", { exact: true }).fill("ARMY manual article");
  await dialog.getByRole("button", "Ajouter le produit", { exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(writes).toHaveLength(1); expect(writes[0].item.reference).toBe("ARMY-MANUAL-1");
  await ui.screen.getByRole("button", "Ajouter", { exact: true }).click();
  await dialog.getByLabel("Désignation *", { exact: true }).fill("ARMY automatic article");
  await dialog.getByRole("button", "Ajouter le produit", { exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(writes).toHaveLength(2); expect(writes[1].item.reference).toBeNull();
  await expect(ui.screen.getByText(/Référence : ART-000003/)).toBeVisible();
  await recordEvidence(ui.army, "catalogue-reference-ui", { writes, scope: "real page, synthetic API; no allocation SQL proof" });
});

armyTest("CAT02 one offer edit saves exact cents and supplier reference without lookup requests", options, async (ui) => {
  const { writes, lookups } = await catalogue(ui);
  await ui.app.open("/dashboard/prices");
  await ui.screen.getByRole("button", "Voir / modifier l’offre", { exact: true }).click();
  const dialog = ui.screen.getByRole("dialog", "Modifier l’offre fournisseur", { exact: true });
  await expect(dialog.getByLabel("Référence fournisseur", { exact: true })).toBeEnabled();
  await dialog.getByLabel("Référence fournisseur", { exact: true }).fill("AL-019");
  await dialog.getByLabel("Prix unitaire HT *", { exact: true }).fill("11,50");
  await dialog.getByRole("button", "Enregistrer l’offre", { exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ action: "update-offer", id: offer.id, item: { supplier_sku: "AL-019", unit_price_cents: 1150 } });
  expect(lookups).toEqual([]);
  await expect(ui.screen.getByRole("button", "Fiche fournisseur", { exact: true })).toHaveCount(0);
  await recordEvidence(ui.army, "catalogue-single-offer-ui", { writes, lookups, databaseWrites: 0 });
});

armyTest("CAT03 repeated offer-to-product navigation releases scroll and inert state", options, async (ui) => {
  const { writes } = await catalogue(ui);
  const observations: Array<{ overflow: string; inert: boolean; scrollY: number }> = [];
  for (let index = 0; index < 3; index++) {
    await ui.app.open(`/dashboard/prices?product_id=${productId}`);
    await ui.screen.getByRole("button", "Voir / modifier l’offre", { exact: true }).click();
    await ui.screen.getByRole("dialog", "Modifier l’offre fournisseur", { exact: true }).getByRole("button", "Annuler", { exact: true }).click();
    await ui.screen.getByRole("link", "Retour à la fiche produit", { exact: true }).click();
    const dialog = ui.screen.getByRole("dialog", "Modifier le produit", { exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", "Fermer le formulaire produit", { exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect.poll(() => ui.browser.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
    await expect.poll(() => ui.browser.evaluate(() => Boolean(document.querySelector("main")?.closest("[inert]")))).toBe(false);
    await ui.browser.evaluate(() => { window.scrollTo(0, 400); return true; });
    await expect.poll(() => ui.browser.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    observations.push(await ui.browser.evaluate(() => ({ overflow: document.body.style.overflow, inert: Boolean(document.querySelector("main")?.closest("[inert]")), scrollY: window.scrollY })));
  }
  expect(writes).toEqual([]);
  await recordEvidence(ui.army, "catalogue-scroll-ui", { observations, writes, databaseWrites: 0 });
});
