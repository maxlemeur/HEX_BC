import { readFile } from "node:fs/promises";

import { expect } from "e2e";

import { requiredFixturePath } from "./owned-business-inputs";

import type { ReferencePriceResponse } from "../../../src/lib/catalogue/reference-price-schemas";
import { apiRequest, armyTest, createEstimateViaWizard, createLineViaApi, readEstimate, recordEvidence } from "../critical/fixtures";

type Envelope<T> = { ok: boolean; data: T; error?: { code: string; message: string } };
type Item = { id: string; valid_from: string; valid_to: string; unit_price_cents: number; [key: string]: unknown };

function requireLocal() {
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (backend.protocol !== "http:" || backend.hostname !== "127.0.0.1" || backend.username || backend.password) {
    throw new Error("Reference-price writes require the isolated loopback Supabase runtime.");
  }
}

// Failure plan and exact oracles precede implementation in price-reference-next-slice.md.
// Fixtures are created through ordinary authenticated application APIs, never shared data.
armyTest("local reference price excludes zero while preserving human validation and existing estimates", {
  session: "army", tags: ["critical", "local", "business-corpus"], trace: "off", timeout: 240_000,
}, async ({ app, screen, browser, army }) => {
  requireLocal();
  const localOwner = JSON.parse(await readFile(requiredFixturePath("E2E_LOCAL_ARTICLE_FIXTURE_PATH"), "utf8")) as { userId: string; apiUrl: string };
  expect(localOwner.apiUrl).toBe(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin);
  await app.open("/dashboard/products");
  const product = await apiRequest<Envelope<{ item: Item }>>(browser, "POST", "/api/products", {
    action: "create", item: { designation: `${army.runPrefix} reference tube`, unit: "m", unit_price_cents: 777 },
  });
  expect(product.status).toBe(201);
  const productId = product.body.data.item.id;
  const priceIds: string[] = [];
  const supplierIds: string[] = [];
  await recordEvidence(army, "reference-product", { productId, originalCents: 777 });
  for (const [index, cents] of [1000, 1100, 0].entries()) {
    const supplier = await apiRequest<Envelope<{ item: Item }>>(browser, "POST", "/api/suppliers", {
      action: "create", item: { name: `${army.runPrefix} supplier ${index + 1}` },
    });
    expect(supplier.status).toBe(201);
    supplierIds.push(supplier.body.data.item.id);
    const price = await apiRequest<Envelope<{ item: Item }>>(browser, "POST", "/api/prices", {
      action: "create", item: { product_id: productId, supplier_id: supplierIds[index],
        supplier_sku: `${army.runPrefix}-${index}`, unit: "m", min_quantity: 1, unit_price_cents: cents, currency: "EUR" },
    });
    expect(price.status).toBe(201);
    priceIds.push(price.body.data.item.id);
    expect((await apiRequest(browser, "POST", "/api/prices", { action: "update-offer", id: priceIds[index],
      item: { transport_mode: "excluded" } })).status).toBe(200);
    await recordEvidence(army, `reference-offer-${index}`, { productId, supplierId: supplierIds[index], priceId: priceIds[index], cents });
  }
  const endpoint = `/api/catalogue/reference-price?product_id=${productId}&quantity=100&transport_mode=excluded`;
  const proposal = async () => {
    const response = await apiRequest<Envelope<ReferencePriceResponse>>(browser, "GET", endpoint);
    expect(response.status).toBe(200);
    return response.body.data;
  };
  const initial = await proposal();
  expect(initial.proposal).toMatchObject({ proposed_price_cents: 1050, current_price_cents: 777,
    offer_count: 2, zero_price_requires_review: true, validation_id: null });
  expect(initial.proposal.offers.find((offer) => offer.id === priceIds[2])?.exclusion).toBe("zero_price");
  await recordEvidence(army, "reference-proposal", { expectedCents: 1050, actual: initial });

  const estimate = await createEstimateViaWizard({ app, screen, browser }, {
    projectName: army.projectName, title: `${army.runPrefix} existing negotiated estimate`,
  }, army);
  const line = await createLineViaApi(browser, estimate.versionId, `${army.runPrefix} negotiated tube`, {
    product_id: productId, description: "m", unit_price_ht_cents: 777,
  });
  const estimateBefore = await readEstimate(browser, estimate.versionId);
  // A modification after inspection must invalidate that exact proposal.
  expect((await apiRequest(browser, "POST", "/api/prices", { action: "update-offer", id: priceIds[0],
    item: { unit_price_cents: 1001 } })).status).toBe(200);
  const stale = await apiRequest(browser, "POST", "/api/catalogue/reference-price", {
    action: "validate", product_id: productId, quantity: 100, transport_mode: "excluded", fingerprint: initial.proposal.fingerprint,
  });
  expect(stale.status).toBe(409);
  expect((await proposal()).proposal).toMatchObject({ current_price_cents: 777, validation_id: null });
  expect((await apiRequest(browser, "POST", "/api/prices", { action: "update-offer", id: priceIds[0],
    item: { unit_price_cents: 1000 } })).status).toBe(200);
  await recordEvidence(army, "reference-stale-rejected", { stale, estimate, lineId: line.id });

  const openPanel = async () => {
    await app.open(`/dashboard/products?q=${encodeURIComponent(army.runPrefix)}`);
    await screen.getByRole("button", `Examiner le prix de ${army.runPrefix} reference tube`, { exact: true }).tap();
    await expect(screen.getByRole("region", "Prix de référence", { exact: true })).toBeVisible();
  };
  await openPanel();
  await screen.getByLabel("Quantité de référence (m)", { exact: true }).fill("100");
  await screen.getByLabel("Base de comparaison", { exact: true }).selectOption({ value: "excluded" });
  await screen.getByRole("button", "Calculer la moyenne", { exact: true }).tap();
  const panel = screen.getByRole("region", "Prix de référence", { exact: true });
  await expect(panel.getByText("10,50 € / m", { exact: true })).toBeVisible();
  await expect(panel.getByText("2 fournisseurs retenus", { exact: true })).toBeVisible();
  await expect(panel.getByRole("alert").filter({ hasText: "clarifier" })).toBeVisible();
  const zeroRow = panel.getByRole("row").filter({ hasText: `${army.runPrefix} supplier 3` });
  await expect(zeroRow.getByRole("cell", /Prix nul exclu · à clarifier/)).toBeVisible();
  await expect(zeroRow.getByRole("link", "Examiner l’offre à corriger", { exact: true })).toHaveAttribute(
    "href", `/dashboard/prices?product_id=${productId}&supplier_id=${supplierIds[2]}`,
  );
  expect((await proposal()).proposal.current_price_cents).toBe(777);
  await screen.getByRole("button", "Valider la moyenne comme référence", { exact: true }).tap();
  await expect(panel.getByText("Prix de référence validé. Les devis existants conservent leurs coûts.", { exact: true })).toBeVisible();
  const validated = await proposal();
  expect(validated.proposal).toMatchObject({ current_price_cents: 1050, proposed_price_cents: 1050, zero_price_requires_review: true });
  expect(validated.latest_validation).toMatchObject({ unit_price_cents: 1050, mode: "average" });
  expect(validated.latest_validation?.validated_by).toBe(localOwner.userId);
  expect(Number.isFinite(Date.parse(validated.latest_validation!.validated_at))).toBe(true);
  await openPanel();
  await expect(panel.getByRole("alert").filter({ hasText: "clarifier" })).toBeVisible();
  await expect(panel.getByText(/Moyenne validée le/)).toBeVisible();
  expect((await readEstimate(browser, estimate.versionId)).items).toEqual(estimateBefore.items);
  expect((await readEstimate(browser, estimate.versionId)).version).toEqual(estimateBefore.version);
  await recordEvidence(army, "reference-validated", { productId, priceIds, supplierIds, validated,
    estimateVersionId: estimate.versionId, preservedLine: line, expectedCents: 1050 });

  for (const id of priceIds.slice(0, 2)) {
    expect((await apiRequest(browser, "POST", "/api/prices", { action: "update-offer", id, item: { is_active: false } })).status).toBe(200);
  }
  await openPanel();
  await expect(panel.getByText("Aucune offre comparable", { exact: true })).toBeVisible();
  await expect(panel.getByText("Référence actuelle · à actualiser", { exact: true })).toBeVisible();
  await expect(panel.getByText("10,50 € / m", { exact: true })).toBeVisible();
  await expect(panel.getByRole("alert").filter({ hasText: "clarifier" })).toBeVisible();
  await expect(screen.getByRole("button", "Valider la moyenne comme référence", { exact: true })).toBeDisabled();
  const zeroOnly = await proposal();
  expect(zeroOnly.proposal).toMatchObject({ proposed_price_cents: null, current_price_cents: 1050, offer_count: 0, zero_price_requires_review: true });
  expect(zeroOnly.latest_validation).toEqual(validated.latest_validation);
  await recordEvidence(army, "reference-zero-only", { expected: { currentCents: 1050, proposed: null }, actual: zeroOnly });

  // Reintroduce the two offers and test both sides of the exact dispersion threshold.
  const setUpperPrice = async (cents: number) => {
    expect((await apiRequest(browser, "POST", "/api/prices", { action: "update-offer", id: priceIds[1],
      item: { is_active: true, unit_price_cents: cents } })).status).toBe(200);
    return (await proposal()).proposal;
  };
  expect((await apiRequest(browser, "POST", "/api/prices", { action: "update-offer", id: priceIds[0],
    item: { is_active: true } })).status).toBe(200);
  const boundary = await setUpperPrice(1150);
  expect(boundary).toMatchObject({ minimum_cents: 1000, maximum_cents: 1150, dispersion_percent: 15,
    dispersion_alert: false, offer_count: 2, proposed_price_cents: 1075, current_price_cents: 1050 });
  const overBoundary = await setUpperPrice(1151);
  expect(overBoundary).toMatchObject({ minimum_cents: 1000, maximum_cents: 1151, dispersion_percent: 15.1,
    dispersion_alert: true, offer_count: 2, proposed_price_cents: 1076, current_price_cents: 1050 });
  expect(overBoundary.offers.find((offer) => offer.id === priceIds[1])?.exclusion).toBe(null);

  await openPanel();
  await expect(panel.getByRole("alert").filter({ hasText: "Écart supérieur à 15 %" })).toBeVisible();
  await screen.getByRole("button", "Valider la moyenne comme référence", { exact: true }).tap();
  await expect(panel.getByText("Prix de référence validé. Les devis existants conservent leurs coûts.", { exact: true })).toBeVisible();
  const replacement = await proposal();
  expect(replacement.latest_validation?.unit_price_cents).toBe(1076);
  const historyEndpoint = `/api/catalogue/reference-price/history?product_id=${productId}`;
  type History = { events: {
    id: string; operation: string; actor_id: string; unit_price_cents: number; occurred_at: string;
    offers: { id: string; unit_price_cents: number }[];
  }[] };
  const history = async () => {
    const response = await apiRequest<Envelope<History>>(browser, "GET", historyEndpoint);
    expect(response.status).toBe(200);
    return response.body.data.events;
  };
  await panel.getByText("Historique des prix de référence", { exact: true }).tap();
  await expect(panel.getByText("Moyenne validée · 10,50 € / m", { exact: true })).toBeVisible();
  const beforeWithdrawal = await history();
  expect(beforeWithdrawal.map(({ operation, unit_price_cents }) => [operation, unit_price_cents])).toEqual([
    ["average", 1076], ["average", 1050],
  ]);
  expect(beforeWithdrawal.map((event) => event.offers.find((offer) => offer.id === priceIds[1])?.unit_price_cents))
    .toEqual([1151, 1100]);

  const withdrawButton = panel.getByRole("button", "Retirer le prix de référence", { exact: true });
  const confirmation = screen.getByRole("alertdialog", "Retirer le prix de référence ?", { exact: true });
  await withdrawButton.tap();
  await confirmation.getByRole("button", "Annuler", { exact: true }).tap();
  expect((await proposal()).proposal.current_price_cents).toBe(1076);
  expect(await history()).toEqual(beforeWithdrawal);

  await withdrawButton.tap();
  await confirmation.getByRole("button", "Confirmer le retrait", { exact: true }).tap();
  await expect(panel.getByText("Prix de référence manquant", { exact: true })).toBeVisible();
  await expect(panel.getByText("Retrait de la référence", { exact: true })).toBeVisible();
  const withdrawn = await proposal();
  expect(withdrawn.proposal).toMatchObject({ current_price_cents: null, validation_id: null, proposed_price_cents: 1076 });
  expect(withdrawn.latest_validation).toBe(null);
  const historyScreenshot = await app.screenshot("reference-price-withdrawal-history");
  const afterWithdrawal = await history();
  expect(afterWithdrawal).toHaveLength(3);
  const [withdrawal, ...previousValidations] = afterWithdrawal;
  expect(withdrawal).toMatchObject({ operation: "withdrawal", unit_price_cents: 1076, actor_id: localOwner.userId });
  expect(Number.isFinite(Date.parse(withdrawal.occurred_at))).toBe(true);
  expect(previousValidations).toEqual(beforeWithdrawal);
  await openPanel();
  await expect(panel.getByText("Prix de référence manquant", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", "Retirer le prix de référence", { exact: true })).not.toBeVisible();
  expect((await readEstimate(browser, estimate.versionId)).items).toEqual(estimateBefore.items);
  expect((await readEstimate(browser, estimate.versionId)).version).toEqual(estimateBefore.version);
  await recordEvidence(army, "reference-withdrawal", {
    productId, estimateVersionId: estimate.versionId, boundary, overBoundary, withdrawal, previousValidations,
    preservedLineId: line.id, estimateVersionAndItemsUnchanged: true, historyScreenshot,
  });

});

armyTest("local supplier validity enforces six calendar months on create partial updates and bulk import", {
  session: "army", tags: ["critical", "local", "business-corpus"], trace: "off", timeout: 180_000,
}, async ({ app, browser, army }) => {
  requireLocal();
  await app.open("/dashboard/prices");
  const product = await apiRequest<Envelope<{ item: Item }>>(browser, "POST", "/api/products", {
    action: "create", item: { designation: `${army.runPrefix} validity tube`, unit: "m", unit_price_cents: 777 },
  });
  expect(product.status).toBe(201);
  const supplier = await apiRequest<Envelope<{ item: Item }>>(browser, "POST", "/api/suppliers", {
    action: "create", item: { name: `${army.runPrefix} validity supplier` },
  });
  expect(supplier.status).toBe(201);
  const productId = product.body.data.item.id;
  const supplierId = supplier.body.data.item.id;
  const base = { product_id: productId, supplier_id: supplierId, supplier_sku: `${army.runPrefix}-validity`,
    unit: "m", unit_price_cents: 1000, currency: "EUR" };
  await recordEvidence(army, "validity-fixtures", { productId, supplierId });
  const created = await apiRequest<Envelope<{ item: Item }>>(browser, "POST", "/api/prices", {
    action: "create", item: { ...base, valid_from: "2026-08-31" },
  });
  expect(created.status).toBe(201);
  expect(created.body.data.item).toMatchObject({ valid_from: "2026-08-31", valid_to: "2027-02-28" });
  const id = created.body.data.item.id;
  const offers = async () => {
    const response = await apiRequest<Envelope<{ items: Item[] }>>(browser, "GET", `/api/prices?product_id=${productId}`);
    expect(response.status).toBe(200);
    return response.body.data.items;
  };
  const read = async () => (await offers()).find((offer) => offer.id === id)!;
  const observations: unknown[] = [{ stage: "created", actual: await read() }];
  for (const action of ["update", "update-offer"]) {
    const before = await read();
    const invalid = await apiRequest(browser, "POST", "/api/prices", { action, id, item: { valid_to: "2027-03-01" } });
    expect(invalid.status).toBe(400);
    expect(await read()).toEqual(before);
    expect((await apiRequest(browser, "POST", "/api/prices", { action, id, item: { valid_to: "2026-12-31" } })).status).toBe(200);
    expect((await apiRequest(browser, "POST", "/api/prices", { action, id, item: { notes: "ARMY preserve expiry" } })).status).toBe(200);
    expect((await read()).valid_to).toBe("2026-12-31");
    expect((await apiRequest(browser, "POST", "/api/prices", { action, id, item: { valid_to: null } })).status).toBe(200);
    expect((await read()).valid_to).toBe("2027-02-28");
    const dateChange = await apiRequest(browser, "POST", "/api/prices", { action, id, item: { valid_from: "2026-07-31" } });
    expect(dateChange.status).toBe(400);
    expect((await read()).valid_from).toBe("2026-08-31");
    observations.push({ stage: action, invalid, dateChange, actual: await read() });
    await recordEvidence(army, "validity-partial-updates", { productId, supplierId, id, observations });
  }
  const countBefore = (await offers()).length;
  const invalidBulk = await apiRequest(browser, "POST", "/api/prices", { action: "bulk-create-atomic", items: [
    { ...base, valid_from: "2027-08-31" }, { ...base, valid_from: "2027-08-31", valid_to: "2028-03-01" },
  ] });
  expect(invalidBulk.status).toBe(400);
  expect((await offers()).length).toBe(countBefore);
  const bulk = await apiRequest<Envelope<{ created_count: number }>>(browser, "POST", "/api/prices", {
    action: "bulk-create-atomic", items: [{ ...base, valid_from: "2027-08-31" }],
  });
  expect(bulk.status).toBe(200);
  expect(bulk.body.data.created_count).toBe(1);
  const all = await offers();
  expect(all).toHaveLength(countBefore + 1);
  expect(all.find((offer) => offer.valid_from === "2027-08-31")?.valid_to).toBe("2028-02-29");
  await recordEvidence(army, "validity-bulk", { productId, supplierId, expectedExpiry: "2028-02-29", invalidBulk, bulk, actual: all });
});
