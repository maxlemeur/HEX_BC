import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect } from "e2e";

import {
  apiRequest, armyTest, ownEstimate, readEstimate, recordEvidence, waitForAutoSave,
  type ArmyEstimate, type ArmyItem,
} from "../critical/fixtures";

// Sub-lot 2.9 (P-18). Contract written before the fix: docs/testing/estimate-engine-v3-2.9.md.
// Failure modes exposed here, on the catalogue records of the calc-v3 "offers" phase:
// - the offer form cannot declare a bar of 3 m (estimate unit, quantity per purchase unit, rounding);
// - an offer sold by the bar is refused for a line in linear metres, or prices it per bar;
// - an order counts metres at the metre price instead of whole bars at the bar price, ignores the
//   negotiated line price, or misses the rounding to whole bars.
type Offer = { id: string; supplierId: string; productId: string; cents: number };
type Fixture = {
  schemaVersion: string; status: string; prefix: string; apiUrl: string;
  suppliers: { priced: string };
  products: Record<"p4" | "p5", { id: string; designation: string }>;
  offers: Record<"p4Bar" | "p5Bar", Offer>;
  deliverySite: { id: string; updatedAt: string };
  estimates: Record<"pu" | "pu04" | "pu05", { projectId: string; versionId: string; sectionId: string }>;
  lines: Record<"puPopover" | "puSmall" | "puNegotiated" | "puBarSheet" | "puBarOrdered" | "puUiConverted" | "puV3",
    { id: string; title: string; unit: string }>;
};
type Envelope<T> = { ok: boolean; data: T; error?: { code: string; message: string } };
type PriceItem = { id: string; unit: string | null; estimate_unit_code?: string | null;
  estimate_units_per_purchase_unit?: number | string | null; purchase_rounding?: string | null };
type Preparation = {
  groups: Array<{ supplier_id: string; lines: Array<{ item_id: string; review_fingerprint: string }> }>;
  blocked_lines: Array<{ item_id: string; reason: string; reason_detail?: string }>;
};
type Created = { orders: Array<{ purchase_order_id: string; total_ht_cents: number; total_tax_cents: number; total_ttc_cents: number }> };
type OrderItem = { source_estimate_item_id: string | null; quantity: number; unit: string | null; price_unit: string | null;
  unit_price_ht_cents: number; line_total_ht_cents: number };

const options = { session: "army", tags: ["calc-v3", "supplier-offers", "purchase-unit"], trace: "off" as const, timeout: 300_000 };

async function loadFixture(): Promise<Fixture> {
  const file = process.env.E2E_SUPPLIER_OFFERS_FIXTURE_PATH;
  if (!file) throw new Error("Explicit supplier-offer fixture required.");
  const fixture = JSON.parse(await readFile(file, "utf8")) as Fixture;
  if (fixture.schemaVersion !== "calc-v3-supplier-offers-1" || fixture.status !== "ready" ||
    !fixture.prefix.startsWith("ARMY-OZ-") || fixture.apiUrl !== process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error("Supplier-offer fixture differs from the calc-v3 offers profile.");
  }
  return fixture;
}

const lineOf = (snapshot: ArmyEstimate, id: string) => snapshot.items.find((item) => item.id === id) as ArmyItem;

async function priceItem(browser: Parameters<typeof apiRequest>[0], fixture: Fixture, offerId: string) {
  const response = await apiRequest<Envelope<{ items: PriceItem[] }>>(browser, "GET", `/api/prices?supplier_id=${fixture.suppliers.priced}`);
  expect(response.status).toBe(200);
  return response.body.data.items.find((item) => item.id === offerId);
}

async function orderLines(browser: Parameters<typeof apiRequest>[0], fixture: Fixture, itemIds: string[],
  estimate = fixture.estimates.pu) {
  const endpoint = `/api/estimates/${estimate.versionId}/purchase-order-drafts`;
  const preview = await apiRequest<Envelope<Preparation>>(browser, "GET", endpoint);
  expect(preview.status).toBe(200);
  const reviewed = preview.body.data.groups.flatMap((group) => group.lines).filter((line) => itemIds.includes(line.item_id));
  expect(reviewed.map((line) => line.item_id).sort(), JSON.stringify(preview.body.data.blocked_lines)).toEqual([...itemIds].sort());
  const created = await apiRequest<Envelope<Created>>(browser, "POST", endpoint, { idempotency_key: randomUUID(),
    reviewed_lines: reviewed.map((line) => ({ item_id: line.item_id, review_fingerprint: line.review_fingerprint })),
    groups: [{ supplier_id: fixture.suppliers.priced, delivery_site_id: fixture.deliverySite.id,
      delivery_site_updated_at: fixture.deliverySite.updatedAt, item_ids: itemIds, expected_delivery_date: null, notes: "ARMY PU" }] });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const order = created.body.data.orders[0];
  const persisted = await apiRequest<Envelope<{ items: OrderItem[] }>>(browser, "GET", `/api/orders?view=items&order_id=${order.purchase_order_id}`);
  expect(persisted.status).toBe(200);
  return { preview: preview.body.data, order, items: persisted.body.data.items };
}

armyTest("PU01 the offer form declares a bar of 3 m rounded up to whole bars", options, async ({ app, screen, browser, army }) => {
  const fixture = await loadFixture();
  const { products, offers } = fixture;
  await app.open(`/dashboard/prices?q=${encodeURIComponent(products.p4.designation)}`);
  const offerList = screen.getByRole("list", "Offres fournisseurs", { exact: true });
  await expect(offerList.getByText(products.p4.designation, { exact: true })).toBeVisible({ timeout: 30_000 });
  await offerList.getByRole("button", "Voir / modifier l’offre", { exact: true }).first().tap();
  await screen.getByLabel("Unité du devis", { exact: true }).selectOption({ value: "ml" });
  await screen.getByLabel("Quantité par unité d'achat", { exact: true }).fill("3");
  await screen.getByLabel("Arrondi à l'unité d'achat", { exact: true }).selectOption({ value: "ceil" });
  await screen.getByRole("button", "Enregistrer l’offre", { exact: true }).tap();
  await expect(offerList.getByText("3 ml par barre", { exact: false }).first()).toBeVisible({ timeout: 30_000 });
  const saved = await priceItem(browser, fixture, offers.p4Bar.id);
  await recordEvidence(army, "pu01-offer", saved);
  expect(saved).toMatchObject({ unit: "barre", estimate_unit_code: "ml", purchase_rounding: "ceil" });
  expect(Number(saved?.estimate_units_per_purchase_unit)).toBe(3);
});

armyTest("PU02 a line of 282 ml is priced 87,48 €/ml from the bar and ordered as 94 bars at 262,45 €", options,
  async ({ app, screen, browser, army }) => {
    const fixture = await loadFixture();
    const estimate = fixture.estimates.pu;
    ownEstimate(army, { projectId: estimate.projectId, versionId: estimate.versionId });
    const { lines, offers, products } = fixture;
    await app.open(`/dashboard/estimates/${estimate.versionId}/edit`);
    await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
    const title = browser.locator(`[data-testid="estimate-line-title-input"][title="${lines.puPopover.title}"]`);
    await title.fill(products.p4.designation);
    await expect(screen.getByRole("listbox").first().getByText(products.p4.designation, { exact: true }).first())
      .toBeVisible({ timeout: 30_000 });
    await browser.keyboard.press("Enter");
    const priced = await waitForAutoSave({ screen, browser }, estimate.versionId, (snapshot) =>
      lineOf(snapshot, lines.puPopover.id).selected_supplier_price_id === offers.p4Bar.id, army);
    const line = lineOf(priced, lines.puPopover.id);
    expect({ unit: line.description, price: line.unit_price_ht_cents, product: line.product_id })
      .toEqual({ unit: "ml", price: 8748, product: products.p4.id });

    const ordered = await orderLines(browser, fixture, [lines.puPopover.id]);
    await recordEvidence(army, "pu02-order", ordered);
    expect(ordered.order).toMatchObject({ total_ht_cents: 2467030, total_tax_cents: 493406, total_ttc_cents: 2960436 });
    expect(ordered.items).toEqual([expect.objectContaining({ quantity: 94, unit: "barre", price_unit: "barre",
      unit_price_ht_cents: 26245, line_total_ht_cents: 2467030 })]);
  });

armyTest("PU03 10 ml order 4 bars of 27,00 €, and a negotiated 80,00 €/ml orders bars at 240,00 €", options,
  async ({ app, browser, army }) => {
    const fixture = await loadFixture();
    const estimate = fixture.estimates.pu;
    ownEstimate(army, { projectId: estimate.projectId, versionId: estimate.versionId });
    const { lines, offers } = fixture;
    await app.open("/dashboard");
    const declared = await apiRequest<Envelope<unknown>>(browser, "POST", "/api/prices", { action: "update-offer", id: offers.p5Bar.id,
      item: { estimate_unit_code: "ml", estimate_units_per_purchase_unit: 3, purchase_rounding: "ceil" } });
    expect(declared.status, JSON.stringify(declared.body)).toBe(200);

    const ordered = await orderLines(browser, fixture, [lines.puSmall.id, lines.puNegotiated.id]);
    await recordEvidence(army, "pu03-order", ordered);
    const bySource = Object.fromEntries(ordered.items.map((item) => [item.source_estimate_item_id, item]));
    expect(bySource[lines.puSmall.id]).toMatchObject({ quantity: 4, unit: "barre", unit_price_ht_cents: 2700, line_total_ht_cents: 10800 });
    expect(bySource[lines.puNegotiated.id]).toMatchObject({ quantity: 94, unit: "barre", unit_price_ht_cents: 24000,
      line_total_ht_cents: 2256000 });
    expect(ordered.order.total_ht_cents).toBe(10800 + 2256000);
    const after = await readEstimate(browser, estimate.versionId);
    expect([lineOf(after, lines.puSmall.id).unit_price_ht_cents, lineOf(after, lines.puNegotiated.id).unit_price_ht_cents])
      .toEqual([900, 8000]);
  });

armyTest("PU04 a converted offer serves both units, the comparison and purchase review show bars, the catalogue compares per metre",
  options, async ({ app, screen, browser, army }) => {
    const fixture = await loadFixture();
    const estimate = fixture.estimates.pu04;
    ownEstimate(army, { projectId: estimate.projectId, versionId: estimate.versionId });
    const { lines, offers, products, prefix } = fixture;

    // Catalogue best price per estimate unit: the bar of 3 m at 262,45 € is 87,48 € per metre.
    await app.open("/dashboard");
    const catalogue = await apiRequest<Envelope<{ items: Array<{ id: string; _bestSupplierPriceCents: number | null }> }>>(browser, "GET",
      `/api/catalogue?view=page&q=${encodeURIComponent(prefix)}&size=25`);
    expect(catalogue.status).toBe(200);
    expect(catalogue.body.data.items.find((item) => item.id === products.p4.id)?._bestSupplierPriceCents).toBe(8748);

    // Article sheet on a line written in bars: it keeps its bars at the bar price.
    await app.open(`/dashboard/estimates/${estimate.versionId}/edit`);
    await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
    await screen.getByRole("button", `Plus d'actions pour ${lines.puBarSheet.title}`, { exact: true }).tap();
    const associate = screen.getByRole("menuitem", "Associer ou remplacer l’article", { exact: true });
    await expect(associate).toBeEnabled({ timeout: 30_000 });
    await associate.tap();
    await screen.getByLabel("Rechercher dans le catalogue", { exact: true }).fill(products.p4.designation);
    await screen.getByRole("dialog").getByText(products.p4.designation, { exact: true }).first().tap();
    const associated = await waitForAutoSave({ screen, browser }, estimate.versionId, (snapshot) =>
      lineOf(snapshot, lines.puBarSheet.id).product_id === products.p4.id, army);
    const barLine = lineOf(associated, lines.puBarSheet.id);
    expect({ unit: barLine.description, quantity: barLine.quantity, price: barLine.unit_price_ht_cents, offer: barLine.selected_supplier_price_id })
      .toEqual({ unit: "barre", quantity: 94, price: 26245, offer: offers.p4Bar.id });

    // Comparison panel on a line in metres: the converted price is labelled per metre.
    await browser.reload();
    await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
    await screen.getByRole("button", `Changer d’offre pour ${lines.puUiConverted.title}`, { exact: true }).tap();
    const panel = screen.getByRole("dialog", "Comparer fournisseurs");
    await expect(panel.getByText("/ ml", { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByText("/ barre", { exact: false })).toHaveCount(0);
    await browser.keyboard.press("Escape");

    // Purchase review in the affaire: the converted line is shown as ordered (10 bars at 262,45 €).
    await app.open(`/dashboard/affaires/${estimate.projectId}`);
    await expect(screen.getByText("10 barre", { exact: true }).first()).toBeVisible({ timeout: 60_000 });

    // A line written in bars is ordered as such.
    const ordered = await orderLines(browser, fixture, [lines.puBarOrdered.id], estimate);
    await recordEvidence(army, "pu04-order", ordered);
    expect(ordered.items).toEqual([expect.objectContaining({ quantity: 94, unit: "barre", price_unit: "barre",
      unit_price_ht_cents: 26245, line_total_ht_cents: 2467030 })]);
  });

// After 2.5 (M4): the unit of an engine 3 line lives in unit_code, not in description. Purchase
// preparation reads it there: 282 ml are ordered as 94 bars of the converted offer.
armyTest("PU05 a v3 line in ml (unit_code) is ordered as 94 bars of the converted offer", options,
  async ({ app, browser, army }) => {
    const fixture = await loadFixture();
    const estimate = fixture.estimates.pu05;
    ownEstimate(army, { projectId: estimate.projectId, versionId: estimate.versionId });
    await app.open("/dashboard");
    const ordered = await orderLines(browser, fixture, [fixture.lines.puV3.id], estimate);
    await recordEvidence(army, "pu05-order", ordered);
    expect(ordered.items).toEqual([expect.objectContaining({ quantity: 94, unit: "barre", price_unit: "barre",
      unit_price_ht_cents: 26245, line_total_ht_cents: 2467030 })]);
    expect(ordered.order.total_ht_cents).toBe(2467030);
  });
