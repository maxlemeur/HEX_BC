import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { test } from "@e2e-dev/web";
import { expect } from "e2e";

import { apiRequest, readEstimate, recordEvidence, type ArmyState } from "../critical/fixtures";

type LocalFixture = {
  apiUrl: string;
  projectId: string;
  versionId: string;
  lineId: string;
  supplierId: string;
  priceId: string;
  deliverySiteId: string;
  deliverySiteUpdatedAt: string;
};
type Envelope<T> = { ok: boolean; data: T; error?: { code: string; details?: unknown } };
type Preparation = {
  summary: { draftable_lines: number; blocked_lines: number };
  groups: Array<{ supplier_id: string; total_ht_cents: number; total_tax_cents: number; total_ttc_cents: number;
    lines: Array<{ item_id: string; review_fingerprint: string }> }>;
  blocked_lines: Array<{ item_id: string; reason: string; reason_detail: string }>;
};

// Failure modes preceded the implementation in purchase-draft-eligibility.md.
// Only the isolated native Supabase runtime may host these fixtures.
test("local purchase drafts recheck current supplier conditions without changing the estimate", {
  session: "army", trace: "off", timeout: 300_000,
}, async ({ app, screen, browser }) => {
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (backend.protocol !== "http:" || backend.hostname !== "127.0.0.1" || backend.username || backend.password) {
    throw new Error("Purchase-draft fixtures require the isolated loopback Supabase runtime.");
  }
  const fixtureFile = process.env.E2E_PURCHASE_DRAFT_FIXTURE_PATH;
  if (!fixtureFile) throw new Error("An explicit fresh eligibility fixture is required; completed fixtures must not be reused.");
  const fixture = JSON.parse(await readFile(fixtureFile, "utf8")) as LocalFixture;
  expect(fixture.apiUrl).toBe(backend.origin);
  expect(Number.isFinite(Date.parse(fixture.deliverySiteUpdatedAt))).toBe(true);
  for (const id of [fixture.projectId, fixture.versionId, fixture.lineId, fixture.supplierId, fixture.priceId, fixture.deliverySiteId]) {
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) throw new Error("Invalid local fixture identity.");
  }
  const origin = new URL(app.baseUrl!).origin;
  // One guard owns this local scenario. Installing a second, broader critical
  // guard would still reject this panel lookup regardless of the narrow route.
  await browser.route("**/*", async (route) => {
    const requestUrl = new URL(route.request.url);
    if (requestUrl.hostname === "api.fontshare.com" && requestUrl.pathname === "/v2/css" && route.request.method === "GET") {
      await route.fulfill({ headers: { "content-type": "text/css" }, body: "" });
      return;
    }
    const readOnly = ["GET", "HEAD", "OPTIONS"].includes(route.request.method);
    const auth = requestUrl.origin === backend.origin && requestUrl.pathname.startsWith("/auth/v1/");
    const deliveryLookup = readOnly && requestUrl.origin === backend.origin &&
      requestUrl.pathname === "/rest/v1/delivery_sites";
    const forbiddenMutation = !readOnly && /\/(send|email-dispatch|approve|status|invite|invitations|portal-tokens)(\/|$)/.test(requestUrl.pathname);
    if ((requestUrl.origin !== origin && !auth && !deliveryLookup) || forbiddenMutation) {
      await route.abort();
      throw new Error("Purchase-draft journey blocked a request outside its isolated scope.");
    }
    await route.continue();
  });
  const army: ArmyState = {
    runPrefix: "ARMY-purchase-draft-" + Date.now() + "-" + randomUUID().slice(0, 8),
    projectName: "ARMY purchase-draft eligibility",
    ownedEstimates: [{ projectId: fixture.projectId, versionId: fixture.versionId }],
  };
  await recordEvidence(army, "purchase-draft-fixtures", {
    fixture, retained: true, cleanup: "none", emails: "none", environment: "isolated-loopback",
  });
  const hubPath = "/dashboard/affaires/" + fixture.projectId;
  await app.open(hubPath);
  const before = await readEstimate(browser, fixture.versionId);
  expect(before.project.id).toBe(fixture.projectId);
  expect(before.project.name.startsWith("ARMY-")).toBe(true);
  const line = before.items.find((item) => item.id === fixture.lineId)!;
  expect(line).toMatchObject({ description: "m", quantity: 2, unit_price_ht_cents: 1200,
    selected_supplier_price_id: fixture.priceId, tax_rate_bp: 2000 });
  const suppliers = await apiRequest<Envelope<{ items: Array<{ id: string; name: string }> }>>(browser, "GET", "/api/suppliers");
  expect(suppliers.status).toBe(200);
  expect(suppliers.body.data.items.find((supplier) => supplier.id === fixture.supplierId)?.name.startsWith("ARMY-")).toBe(true);
  const prices = await apiRequest<Envelope<{ items: Array<{ id: string; supplier_id: string }> }>>(browser, "GET", "/api/prices?supplier_id=" + fixture.supplierId);
  expect(prices.status).toBe(200);
  expect(prices.body.data.items.find((offer) => offer.id === fixture.priceId)?.supplier_id).toBe(fixture.supplierId);

  const endpoint = "/api/estimates/" + fixture.versionId + "/purchase-order-drafts";
  const requestFor = (preparation: Preparation) => {
    const reviewed = preparation.groups.flatMap((group) => group.lines).find((item) => item.item_id === fixture.lineId);
    expect(reviewed?.review_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    return { idempotency_key: randomUUID(), reviewed_lines: [{ item_id: fixture.lineId,
      review_fingerprint: reviewed!.review_fingerprint }],
    groups: [{ supplier_id: fixture.supplierId, delivery_site_id: fixture.deliverySiteId,
      delivery_site_updated_at: fixture.deliverySiteUpdatedAt,
      item_ids: [fixture.lineId], expected_delivery_date: null, notes: "ARMY SITE-01" }] };
  };
  const observations: unknown[] = [];
  const evidenceDirectory = path.resolve(".e2e/purchase-draft-eligibility/artifacts", army.runPrefix);
  await mkdir(evidenceDirectory, { recursive: true });
  const record = async () => {
    const body = JSON.stringify({ fixture, observations }, null, 2) + "\n";
    await writeFile(path.join(evidenceDirectory, "business-results.json"), body);
    await writeFile(path.join(evidenceDirectory, "business-results.sha256"), createHash("sha256").update(body).digest("hex") + "\n");
  };
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const nextMonth = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const applicable = { unit: "m", min_quantity: 1, currency: "EUR", is_active: true,
    valid_from: today, valid_to: nextMonth, unit_price_cents: 1800 };
  const updateOffer = async (patch: Record<string, unknown>) => {
    const response = await apiRequest(browser, "POST", "/api/prices", { action: "update-offer", id: fixture.priceId, item: patch });
    expect(response.status).toBe(200);
  };
  const supplierOrderIds = async () => {
    const response = await apiRequest<Envelope<{ items: Array<{ id: string; suppliers: { id: string } | null }> }>>(browser, "GET", "/api/orders");
    expect(response.status).toBe(200);
    return response.body.data.items.filter((order) => order.suppliers?.id === fixture.supplierId).map((order) => order.id).sort();
  };
  const stableEstimate = (snapshot: typeof before) => ({
    versionId: snapshot.version.id, updatedAt: snapshot.version.updated_at,
    currency: snapshot.version.currency, ht: snapshot.version.total_ht_cents,
    tax: snapshot.version.total_tax_cents, ttc: snapshot.version.total_ttc_cents,
    lines: snapshot.items.map((item) => ({ id: item.id, quantity: item.quantity,
      unit: item.description, cost: item.unit_price_ht_cents, selected: item.selected_supplier_price_id,
      ht: item.line_total_ht_cents, tax: item.line_tax_cents, ttc: item.line_total_ttc_cents })),
  });
  expect(await supplierOrderIds()).toEqual([]);
  await updateOffer(applicable);
  const preview = await apiRequest<Envelope<Preparation>>(browser, "GET", endpoint);
  expect(preview.status).toBe(200);
  expect(preview.body.data.summary.draftable_lines).toBe(1);
  expect(preview.body.data.groups[0]).toMatchObject({ total_ht_cents: 2400, total_tax_cents: 480, total_ttc_cents: 2880 });
  const request = requestFor(preview.body.data);
  observations.push({ stage: "applicable-preview", request, expected: { ht: 2400, tax: 480, ttc: 2880 }, actual: preview.body.data });
  await record();

  const cases = [
    { label: "minimum", patch: { min_quantity: 3 }, reason: "Minimum 3 m" },
    { label: "unit", patch: { unit: "kg" }, reason: "Unité différente du devis" },
    { label: "currency", patch: { currency: "USD" }, reason: "Conversion de devise requise" },
    { label: "expired", patch: { valid_from: yesterday, valid_to: yesterday }, reason: "Offre expirée" },
    { label: "future", patch: { valid_from: tomorrow, valid_to: nextMonth }, reason: "Offre pas encore valable" },
    { label: "offer-archived", patch: { is_active: false }, reason: "Offre archivée" },
    { label: "supplier-archived", patch: {}, reason: "Fournisseur archivé ou inaccessible" },
  ];
  for (const scenario of cases) {
    await updateOffer({ ...applicable, ...scenario.patch });
    if (scenario.label === "supplier-archived") {
      expect((await apiRequest(browser, "POST", "/api/suppliers", {
        action: "update", id: fixture.supplierId, item: { is_active: false },
      })).status).toBe(200);
    }
    const preparation = await apiRequest<Envelope<Preparation>>(browser, "GET", endpoint);
    expect(preparation.status).toBe(200);
    expect(preparation.body.data.groups).toEqual([]);
    expect(preparation.body.data.blocked_lines).toEqual([expect.objectContaining({
      item_id: fixture.lineId, reason: "supplier_offer_ineligible", reason_detail: scenario.reason,
    })]);
    await app.open(hubPath);
    await expect(screen.getByText(scenario.reason, { exact: true })).toBeVisible();
    const rejected = await apiRequest<Envelope<unknown>>(browser, "POST", endpoint, request);
    expect(rejected.status).toBe(409);
    expect(rejected.body.error?.code).toBe("ORDER_DRAFT_PREPARATION_STALE");
    expect(await supplierOrderIds()).toEqual([]);
    const preserved = await readEstimate(browser, fixture.versionId);
    expect(stableEstimate(preserved)).toEqual(stableEstimate(before));
    observations.push({ stage: scenario.label, expectedReason: scenario.reason,
      preparation: preparation.body.data, rejected, estimate: stableEstimate(preserved), orderIds: [] });
    await record();
  }

  expect((await apiRequest(browser, "POST", "/api/suppliers", {
    action: "update", id: fixture.supplierId, item: { is_active: true },
  })).status).toBe(200);
  await updateOffer(applicable);
  const refreshed = await apiRequest<Envelope<Preparation>>(browser, "GET", endpoint);
  expect(refreshed.status).toBe(200);
  expect(refreshed.body.data.summary.draftable_lines).toBe(1);
  const freshRequest = requestFor(refreshed.body.data);
  const created = await apiRequest<Envelope<{ summary: { draft_orders_created: number }; orders: Array<{ purchase_order_id: string; total_ht_cents: number; total_tax_cents: number; total_ttc_cents: number; ordered_source_item_ids: string[] }> }>>(browser, "POST", endpoint, freshRequest);
  expect(created.status).toBe(201);
  expect(created.body.data.summary.draft_orders_created).toBe(1);
  const order = created.body.data.orders[0];
  expect(order).toMatchObject({ total_ht_cents: 2400, total_tax_cents: 480, total_ttc_cents: 2880,
    ordered_source_item_ids: [fixture.lineId] });
  const persisted = await apiRequest<Envelope<{ items: unknown[] }>>(browser, "GET", "/api/orders?view=items&order_id=" + order.purchase_order_id);
  expect(persisted.status).toBe(200);
  expect(persisted.body.data.items).toEqual([expect.objectContaining({ quantity: 2, unit_price_ht_cents: 1200, line_total_ht_cents: 2400 })]);
  expect(await supplierOrderIds()).toEqual([order.purchase_order_id]);
  expect(stableEstimate(await readEstimate(browser, fixture.versionId))).toEqual(stableEstimate(before));
  observations.push({ stage: "created-and-reread", refreshed: refreshed.body.data, freshRequest,
    created: created.body.data, persisted: persisted.body.data });
  await record();
});
