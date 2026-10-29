import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect } from "e2e";

import {
  apiRequest, armyTest, ownEstimate, readEstimate, recordEvidence, waitForAutoSave,
  type ArmyEstimate, type ArmyItem, type ArmyState,
} from "../critical/fixtures";
import { expectStoredTotalsMatchLines } from "../critical/version-totals-support";

// Sub-lot 2.2 (A7, P-08). Contract written before the fix: docs/testing/estimate-engine-v3-2.2.md.
// Failure modes exposed here, on catalogue records seeded for the calc-v3 "offers-zero-price" phase:
// - an unmarked 0 € offer wins the best price, is preselected, heads the suggestion popover
//   or is applied from the article sheet (the line is priced 0 €);
// - the popover writes the article designation into the line unit;
// - an offer at 0 € marked "Inclus" from the offer form is not usable or not labelled;
// - a line in "ML" linked to an offer in "ml" cannot be ordered, and a line linked to an
//   unmarked 0 € offer can.
type Fixture = {
  schemaVersion: string; status: string; prefix: string; apiUrl: string;
  owner: { userId: string; tenantId: string };
  suppliers: { zero: string; priced: string; included: string };
  products: Record<"p1" | "p2" | "p3", { id: string; designation: string }>;
  offers: Record<"p1Zero" | "p1Priced" | "p2Zero" | "p3Zero", { id: string; supplierId: string; productId: string; cents: number }>;
  deliverySite: { id: string; updatedAt: string };
  estimates: Record<EstimateKey, { projectId: string; versionId: string; sectionId: string }>;
  lines: Record<"compareP1" | "compareP2" | "popover" | "sheet" | "linkedZero" | "popoverSquare" | "compareP3" | "sheetIncluded" |
    "purchaseMl" | "purchaseZero" | "legacyV1",
    { id: string; title: string; unit: string; estimate: EstimateKey }>;
};
type EstimateKey = "oz01" | "oz02" | "oz03" | "oz04";
type Envelope<T> = { ok: boolean; data: T; error?: { code: string; message: string } };
type Alternative = { supplier_price_id: string; adjusted_unit_price_cents: number; zero_price_kind?: string | null };
type Comparisons = {
  coverage_summary: { total_items: number; covered_items: number; ambiguous_items: number; no_price_items: number; stale_items: number };
  comparisons: Array<{ item_id: string; best_supplier_price_id: string | null; coverage_status: string; risk_flags: string[];
    alternatives: Alternative[] }>;
  bulk_preselection: { proposals: Array<{ item_id: string; proposed_alternative: Alternative;
    patch: { unit_price_ht_cents: number; selected_supplier_price_id: string } }> };
};
type Preparation = {
  summary: { draftable_lines: number };
  groups: Array<{ supplier_id: string; total_ht_cents: number; total_tax_cents: number; total_ttc_cents: number;
    lines: Array<{ item_id: string; review_fingerprint: string }> }>;
  blocked_lines: Array<{ item_id: string; reason: string; reason_detail?: string }>;
};
type CataloguePage = {
  items: Array<{ id: string; _bestSupplierPriceCents: number | null; _bestSupplierName: string | null; _priceStatus: string;
    _supplierPriceCount: number }>;
  counters: { active: number; covered: number; withoutSupplierPrice: number; stale: number };
};

const options = { session: "army", tags: ["calc-v3", "supplier-offers"], trace: "off" as const, timeout: 300_000 };

async function loadFixture(): Promise<Fixture> {
  const file = process.env.E2E_SUPPLIER_OFFERS_FIXTURE_PATH;
  if (!file) throw new Error("Explicit supplier-offer fixture required.");
  const fixture = JSON.parse(await readFile(file, "utf8")) as Fixture;
  if (fixture.schemaVersion !== "calc-v3-supplier-offers-1" || fixture.status !== "ready" ||
    !fixture.prefix.startsWith("ARMY-OZ-") || fixture.apiUrl !== process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error("Supplier-offer fixture differs from the calc-v3 offers-zero-price profile.");
  }
  return fixture;
}

const lineOf = (snapshot: ArmyEstimate, id: string) => snapshot.items.find((item) => item.id === id) as ArmyItem;
const priced = (item: ArmyItem) => ({
  title: item.title, unit: item.description, price: item.unit_price_ht_cents,
  selected: item.selected_supplier_price_id, product: item.product_id,
});

// Polls the persisted estimate and records the stored version totals without asserting them.
// Applying a supplier preselection now writes its lines and the version totals in one RPC
// (fixed in 0bc35c46); OZ04 and V1PT01 (V1) and the critical P1 journey (V2) assert those totals
// right after the write: docs/testing/version-totals-after-preselection.md.
async function waitForPersisted(browser: Parameters<typeof apiRequest>[0], army: ArmyState, versionId: string,
  label: string, predicate: (snapshot: ArmyEstimate) => boolean) {
  const deadline = Date.now() + 90_000;
  let snapshot = await readEstimate(browser, versionId);
  while (!predicate(snapshot) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    snapshot = await readEstimate(browser, versionId);
  }
  await recordEvidence(army, `${label}-persisted`, { matched: predicate(snapshot), lines: snapshot.items.map(priced),
    totals: [snapshot.version.total_ht_cents, snapshot.version.total_tax_cents, snapshot.version.total_ttc_cents] });
  expect(predicate(snapshot)).toBe(true);
  return snapshot;
}

// Catalogue products page (catalogue_products_page) and its counters (catalogue_products_summary).
async function cataloguePage(browser: Parameters<typeof apiRequest>[0], prefix: string) {
  const response = await apiRequest<Envelope<CataloguePage>>(browser, "GET",
    `/api/catalogue?view=page&q=${encodeURIComponent(prefix)}&size=25`);
  expect(response.status).toBe(200);
  const page = response.body.data;
  const row = (id: string) => {
    const entry = page.items.find((item) => item.id === id);
    return entry && { best: entry._bestSupplierPriceCents, supplier: entry._bestSupplierName, status: entry._priceStatus,
      offers: entry._supplierPriceCount };
  };
  return { page, row };
}

async function compare(browser: Parameters<typeof apiRequest>[0], versionId: string, itemIds: string[]) {
  const response = await apiRequest<Envelope<Comparisons>>(browser, "POST",
    `/api/estimates/${versionId}/supplier-comparisons`, { item_ids: itemIds });
  expect(response.status).toBe(200);
  return response.body.data;
}

armyTest("OZ01 an unmarked 0 € offer never prices a line: best price, preselection, popover and article sheet", options,
  async ({ app, screen, browser, army }) => {
    const fixture = await loadFixture();
    const estimate = fixture.estimates.oz01;
    ownEstimate(army, { projectId: estimate.projectId, versionId: estimate.versionId });
    const { lines, offers, products } = fixture;
    await app.open("/dashboard");

    // Best price and preselection proposals.
    const comparison = await compare(browser, estimate.versionId, [lines.compareP1.id, lines.compareP2.id, lines.linkedZero.id]);
    await recordEvidence(army, "oz01-comparisons", comparison);
    const p1 = comparison.comparisons.find((entry) => entry.item_id === lines.compareP1.id)!;
    const p2 = comparison.comparisons.find((entry) => entry.item_id === lines.compareP2.id)!;
    expect(p1.best_supplier_price_id, "best price of P1").toBe(offers.p1Priced.id);
    expect(p1.alternatives.map((entry) => entry.supplier_price_id)).not.toContain(offers.p1Zero.id);
    expect(p2.best_supplier_price_id, "P2 has no usable price").toBeNull();
    const linked = comparison.comparisons.find((entry) => entry.item_id === lines.linkedZero.id)!;
    expect(linked.best_supplier_price_id, "a line linked to the 0 € offer sees the 12,40 € best price").toBe(offers.p1Priced.id);
    expect(linked.risk_flags).toContain("selected_not_best_price");
    // Coverage indicator: a line priced by the unmarked 0 € offer is never counted as covered.
    expect(linked.coverage_status, "a line linked to the unmarked 0 € offer is not covered").toBe("ambiguous");
    expect(comparison.coverage_summary).toEqual({ total_items: 3, covered_items: 0, ambiguous_items: 2, no_price_items: 1, stale_items: 0 });
    const proposals = comparison.bulk_preselection.proposals;
    expect(proposals.filter((proposal) => proposal.item_id === lines.compareP2.id)).toEqual([]);
    expect(proposals.find((proposal) => proposal.item_id === lines.compareP1.id)?.patch)
      .toEqual({ unit_price_ht_cents: 1240, selected_supplier_price_id: offers.p1Priced.id });

    // Preselection applied from the editor, reread from the database.
    await app.open(`/dashboard/estimates/${estimate.versionId}/edit`);
    await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
    // The tab name carries a count badge when the editor has controls to show.
    await screen.getByRole("tab", /^Affichage & contrôle(?: \d+)?$/).tap();
    await screen.getByTestId("estimate-editor-display-button").tap();
    const preselect = screen.getByTestId("estimate-editor-supplier-preselection-button");
    await expect(preselect).toBeEnabled({ timeout: 30_000 });
    await preselect.tap();
    await screen.getByRole("button", "Appliquer la sélection", { exact: true }).tap();
    const preselected = await waitForPersisted(browser, army, estimate.versionId, "oz01-preselection", (snapshot) =>
      lineOf(snapshot, lines.compareP1.id).selected_supplier_price_id === offers.p1Priced.id);
    expect(priced(lineOf(preselected, lines.compareP1.id))).toMatchObject({ unit: "ML", price: 1240, selected: offers.p1Priced.id });
    expect(priced(lineOf(preselected, lines.compareP2.id))).toMatchObject({ unit: "ml", price: 0, selected: null });
    const preselectedLine = lineOf(preselected, lines.compareP1.id);
    expect([preselectedLine.line_total_ht_cents, preselectedLine.line_tax_cents, preselectedLine.line_total_ttc_cents])
      .toEqual([2480, 496, 2976]);
    await browser.reload();
    await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();

    // Suggestion popover: the head suggestion applied with Enter keeps the line unit.
    const popoverTitle = browser.locator(`[data-testid="estimate-line-title-input"][title="${lines.popover.title}"]`);
    await popoverTitle.fill(products.p1.designation);
    await expect(screen.getByRole("listbox").first()).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole("listbox").first().getByText(products.p1.designation, { exact: true }).first())
      .toBeVisible({ timeout: 30_000 });
    await browser.keyboard.press("Enter");
    const suggested = await waitForAutoSave({ screen, browser }, estimate.versionId, (snapshot) =>
      lineOf(snapshot, lines.popover.id).product_id === products.p1.id, army);
    expect(priced(lineOf(suggested, lines.popover.id))).toEqual({ title: products.p1.designation, unit: "ML", price: 1240,
      selected: offers.p1Priced.id, product: products.p1.id });

    // Comparison panel: the linked 0 € offer is shown ineligible and the 12,40 € offer can be retained.
    await browser.reload();
    await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
    await screen.getByRole("button", `Changer d’offre pour ${lines.linkedZero.title}`, { exact: true }).tap();
    const panel = screen.getByRole("dialog", "Comparer fournisseurs");
    await expect(panel.getByText("Offre à 0 € non marquée", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    const retain = panel.getByRole("button", "Retenir cette offre", { exact: true });
    await expect(retain).toBeEnabled({ timeout: 30_000 });
    await retain.tap();
    const retained = await waitForPersisted(browser, army, estimate.versionId, "oz01-retained", (snapshot) =>
      lineOf(snapshot, lines.linkedZero.id).selected_supplier_price_id === offers.p1Priced.id);
    expect(priced(lineOf(retained, lines.linkedZero.id))).toMatchObject({ price: 1240, selected: offers.p1Priced.id });

    // Suggestion popover on a line in m2: an offer in ml is refused, with its reason, and nothing is written.
    await browser.reload();
    await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
    const squareTitle = browser.locator(`[data-testid="estimate-line-title-input"][title="${lines.popoverSquare.title}"]`);
    await squareTitle.fill(products.p1.designation);
    await expect(screen.getByRole("listbox").first().getByText(products.p1.designation, { exact: true }).first())
      .toBeVisible({ timeout: 30_000 });
    await browser.keyboard.press("Enter");
    await expect(screen.getByRole("listbox").first().getByText("Unité différente du devis", { exact: false }).first())
      .toBeVisible({ timeout: 10_000 });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const refused = await readEstimate(browser, estimate.versionId);
    expect(priced(lineOf(refused, lines.popoverSquare.id))).toMatchObject({ unit: "m2", price: 0, selected: null, product: null });
    await browser.keyboard.press("Escape");

    // Article sheet association: the article's eligible offer, never the 0 € one.
    await browser.reload();
    await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
    await screen.getByRole("button", `Plus d'actions pour ${lines.sheet.title}`, { exact: true }).tap();
    const associate = screen.getByRole("menuitem", "Associer ou remplacer l’article", { exact: true });
    await expect(associate).toBeEnabled({ timeout: 30_000 });
    await associate.tap();
    const search = screen.getByLabel("Rechercher dans le catalogue", { exact: true });
    await search.fill(products.p1.designation);
    await screen.getByRole("dialog").getByText(products.p1.designation, { exact: true }).first().tap();
    const associated = await waitForAutoSave({ screen, browser }, estimate.versionId, (snapshot) =>
      lineOf(snapshot, lines.sheet.id).product_id === products.p1.id, army);
    expect(priced(lineOf(associated, lines.sheet.id))).toEqual({ title: products.p1.designation, unit: "ml", price: 1240,
      selected: offers.p1Priced.id, product: products.p1.id });
    await recordEvidence(army, "oz01-lines", {
      preselected: priced(lineOf(preselected, lines.compareP1.id)), untouched: priced(lineOf(preselected, lines.compareP2.id)),
      popover: priced(lineOf(suggested, lines.popover.id)), sheet: priced(lineOf(associated, lines.sheet.id)),
    });
  });

armyTest("OZ02 an offer at 0 € marked Inclus from the offer form is usable and labelled, and stays out of the reference price", options,
  async ({ app, screen, browser, army }) => {
    const fixture = await loadFixture();
    const estimate = fixture.estimates.oz02;
    ownEstimate(army, { projectId: estimate.projectId, versionId: estimate.versionId });
    const { lines, offers, products } = fixture;

    // Before marking: the 0 € offer of P3 is not proposed.
    await app.open("/dashboard");
    const before = await compare(browser, estimate.versionId, [lines.compareP3.id]);
    expect(before.bulk_preselection.proposals).toEqual([]);

    // Catalogue products page: an unmarked 0 € offer is still counted as an offer, never as the best
    // price, and leaves its article without supplier price in the counters.
    const supplierName = (key: keyof Fixture["suppliers"]) => `${fixture.prefix} fournisseur ${key}`;
    const catalogueBefore = await cataloguePage(browser, fixture.prefix);
    expect(catalogueBefore.row(products.p1.id), "P1 best price").toEqual({ best: 1240, supplier: supplierName("priced"),
      status: "fresh", offers: 2 });
    expect(catalogueBefore.row(products.p2.id), "P2 has no usable supplier price").toEqual({ best: null, supplier: null,
      status: "none", offers: 1 });
    expect(catalogueBefore.row(products.p3.id), "P3 before marking").toEqual({ best: null, supplier: null, status: "none", offers: 1 });

    // A marking sent alone on a priced offer is refused with a validation error, not a database failure.
    const refusedMarking = await apiRequest<Envelope<unknown>>(browser, "POST", "/api/prices",
      { action: "update-offer", id: offers.p1Priced.id, item: { zero_price_kind: "free" } });
    expect(refusedMarking.status).toBe(400);
    expect(refusedMarking.body.error?.message).toBe("Le marquage « Inclus » ou « Gratuit » exige un prix à 0 €.");

    // Mark it from the catalogue offer form.
    await app.open(`/dashboard/prices?q=${encodeURIComponent(products.p3.designation)}`);
    const offerList = screen.getByRole("list", "Offres fournisseurs", { exact: true });
    await expect(offerList.getByText(products.p3.designation, { exact: true })).toBeVisible({ timeout: 30_000 });
    await offerList.getByRole("button", "Voir / modifier l’offre", { exact: true }).first().tap();
    await screen.getByLabel("Offre à 0 €", { exact: true }).selectOption({ value: "included" });
    await screen.getByRole("button", "Enregistrer l’offre", { exact: true }).tap();
    await expect(offerList.getByText("Inclus / ml", { exact: true }).first()).toBeVisible({ timeout: 30_000 });

    // Marked, the offer becomes P3's best price and moves P3 from "without supplier price" to "covered".
    const catalogueAfter = await cataloguePage(browser, fixture.prefix);
    await recordEvidence(army, "oz02-catalogue", { before: catalogueBefore.page, after: catalogueAfter.page });
    expect(catalogueAfter.row(products.p3.id), "P3 after marking").toEqual({ best: 0, supplier: supplierName("included"),
      status: "fresh", offers: 1 });
    const [countersBefore, countersAfter] = [catalogueBefore.page.counters, catalogueAfter.page.counters];
    expect({
      active: countersAfter.active - countersBefore.active,
      covered: countersAfter.covered - countersBefore.covered,
      withoutSupplierPrice: countersAfter.withoutSupplierPrice - countersBefore.withoutSupplierPrice,
    }, "the marking alone moves P3 into the covered counter").toEqual({ active: 0, covered: 1, withoutSupplierPrice: -1 });

    const after = await compare(browser, estimate.versionId, [lines.compareP3.id]);
    await recordEvidence(army, "oz02-comparisons", { before, after });
    expect(after.bulk_preselection.proposals.map((proposal) => ({
      item: proposal.item_id, offer: proposal.proposed_alternative.supplier_price_id,
      kind: proposal.proposed_alternative.zero_price_kind, patch: proposal.patch,
    }))).toEqual([{ item: lines.compareP3.id, offer: offers.p3Zero.id, kind: "included",
      patch: { unit_price_ht_cents: 0, selected_supplier_price_id: offers.p3Zero.id } }]);

    // The article sheet labels and applies the marked offer.
    await app.open(`/dashboard/estimates/${estimate.versionId}/edit`);
    await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
    await screen.getByRole("button", `Plus d'actions pour ${lines.sheetIncluded.title}`, { exact: true }).tap();
    const associate = screen.getByRole("menuitem", "Associer ou remplacer l’article", { exact: true });
    await expect(associate).toBeEnabled({ timeout: 30_000 });
    await associate.tap();
    await screen.getByLabel("Rechercher dans le catalogue", { exact: true }).fill(products.p3.designation);
    const sheet = screen.getByRole("dialog");
    await expect(sheet.getByText("Inclus", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await sheet.getByText(products.p3.designation, { exact: true }).first().tap();
    const associated = await waitForAutoSave({ screen, browser }, estimate.versionId, (snapshot) =>
      lineOf(snapshot, lines.sheetIncluded.id).product_id === products.p3.id, army);
    expect(priced(lineOf(associated, lines.sheetIncluded.id))).toEqual({ title: products.p3.designation, unit: "ml", price: 0,
      selected: offers.p3Zero.id, product: products.p3.id });

    // Reference price: a free or included offer is not a purchase price.
    const reference = await apiRequest<Envelope<{ proposal: { proposed_price_cents: number | null;
      offers: Array<{ id: string; exclusion: string | null }> } }>>(browser, "GET",
      `/api/catalogue/reference-price?product_id=${products.p3.id}`);
    expect(reference.status).toBe(200);
    // The offer is excluded and never averaged; its exact "zero_price" reason needs freight conditions that only
    // a tenant admin may seed, and is asserted by pgTAP (supplier-offer-eligibility.test.sql).
    expect(reference.body.data.proposal.offers.find((offer) => offer.id === offers.p3Zero.id)?.exclusion).not.toBeNull();
    expect(reference.body.data.proposal.proposed_price_cents).toBeNull();
    await recordEvidence(army, "oz02-lines", { sheet: priced(lineOf(associated, lines.sheetIncluded.id)), reference: reference.body.data });
  });

armyTest("OZ03 purchase preparation orders an ML line on an ml offer and refuses a line on an unmarked 0 € offer", options,
  async ({ app, browser, army }) => {
    const fixture = await loadFixture();
    const estimate = fixture.estimates.oz03;
    ownEstimate(army, { projectId: estimate.projectId, versionId: estimate.versionId });
    const { lines, offers, suppliers, deliverySite } = fixture;
    await app.open("/dashboard");
    const endpoint = `/api/estimates/${estimate.versionId}/purchase-order-drafts`;
    const preview = await apiRequest<Envelope<Preparation>>(browser, "GET", endpoint);
    expect(preview.status).toBe(200);
    await recordEvidence(army, "oz03-preview", preview.body.data);
    const blocked = preview.body.data.blocked_lines.find((entry) => entry.item_id === lines.purchaseZero.id);
    expect(blocked?.reason_detail).toBe("Offre à 0 € non marquée");
    const group = preview.body.data.groups.find((entry) => entry.lines.some((entry2) => entry2.item_id === lines.purchaseMl.id));
    expect(group, "the ML line on the ml offer is draftable").toBeDefined();
    expect(group!.supplier_id).toBe(suppliers.priced);
    expect(preview.body.data.groups.flatMap((entry) => entry.lines.map((entry2) => entry2.item_id))).not.toContain(lines.purchaseZero.id);

    const reviewed = group!.lines.find((entry) => entry.item_id === lines.purchaseMl.id)!;
    const created = await apiRequest<Envelope<{ summary: { draft_orders_created: number };
      orders: Array<{ purchase_order_id: string; total_ht_cents: number; total_tax_cents: number; total_ttc_cents: number; ordered_source_item_ids: string[] }> }>>(
      browser, "POST", endpoint, { idempotency_key: randomUUID(),
        reviewed_lines: [{ item_id: lines.purchaseMl.id, review_fingerprint: reviewed.review_fingerprint }],
        groups: [{ supplier_id: suppliers.priced, delivery_site_id: deliverySite.id, delivery_site_updated_at: deliverySite.updatedAt,
          item_ids: [lines.purchaseMl.id], expected_delivery_date: null, notes: "ARMY OZ03" }] });
    await recordEvidence(army, "oz03-created", created);
    expect(created.status).toBe(201);
    expect(created.body.data.orders).toEqual([expect.objectContaining({ total_ht_cents: 2480, total_tax_cents: 496,
      total_ttc_cents: 2976, ordered_source_item_ids: [lines.purchaseMl.id] })]);
    const order = created.body.data.orders[0];
    const persisted = await apiRequest<Envelope<{ items: Array<Record<string, unknown>> }>>(browser, "GET",
      `/api/orders?view=items&order_id=${order.purchase_order_id}`);
    expect(persisted.status).toBe(200);
    expect(persisted.body.data.items).toEqual([expect.objectContaining({ quantity: 2, unit: "ML",
      unit_price_ht_cents: 1240, line_total_ht_cents: 2480 })]);
    const after = await readEstimate(browser, estimate.versionId);
    expect(priced(lineOf(after, lines.purchaseZero.id))).toMatchObject({ price: 500, selected: offers.p2Zero.id });
  });

// Version totals after a supplier preselection (docs/testing/version-totals-after-preselection.md).
// V1 path: the public creation schema only makes V2 drafts, so oz04 is a seeded legacy V1 draft
// (fixed margin 1, 20 % VAT, no discount, totals 0 like its single line at 0 €).
armyTest("OZ04 a supplier preselection on a legacy V1 draft stores the version totals with its lines", options,
  async ({ app, screen, browser, army }) => {
    const fixture = await loadFixture();
    const estimate = fixture.estimates.oz04;
    ownEstimate(army, { projectId: estimate.projectId, versionId: estimate.versionId });
    const { lines, offers } = fixture;
    await app.open("/dashboard");
    const before = await readEstimate(browser, estimate.versionId);
    expect(before.version.calc_engine_version, "legacy V1 draft").toBe(1);
    expect([before.version.total_ht_cents, before.version.total_tax_cents, before.version.total_ttc_cents]).toEqual([0, 0, 0]);

    await app.open(`/dashboard/estimates/${estimate.versionId}/edit`);
    await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
    await screen.getByRole("tab", /^Affichage & contrôle(?: \d+)?$/).tap();
    await screen.getByTestId("estimate-editor-display-button").tap();
    const preselect = screen.getByTestId("estimate-editor-supplier-preselection-button");
    await expect(preselect).toBeEnabled({ timeout: 30_000 });
    await preselect.tap();
    await screen.getByRole("button", "Appliquer la sélection", { exact: true }).tap();
    await waitForPersisted(browser, army, estimate.versionId, "oz04-preselection", (snapshot) =>
      lineOf(snapshot, lines.legacyV1.id).selected_supplier_price_id === offers.p1Priced.id);
    // 2 ML at 12,40 €: 24,80 € HT, 4,96 € VAT, 29,76 € TTC, stored with the preselection itself.
    await expectStoredTotalsMatchLines({ app, screen, browser }, army, {
      estimate, projectName: `${fixture.prefix} oz04`, step: "oz04", expected: [2480, 496, 2976],
    });
  });
