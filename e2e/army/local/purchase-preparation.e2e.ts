import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { test } from "@e2e-dev/web";
import { expect } from "e2e";

import { apiRequest, readEstimate, recordEvidence, type ArmyState } from "../critical/fixtures";

type Browser = Parameters<typeof apiRequest>[0];
type Envelope<T> = { ok: boolean; data: T; error?: { code: string; message: string } };
type FixtureLine = {
  label: string; lineId: string; supplierId: string; productId: string; priceId: string;
  quantity: number; unitPriceCents: number; cataloguePriceCents: number; ht: number; tax: number; ttc: number;
};
type ScenarioFixture = {
  projectId: string; versionId: string; deliverySiteId: string; deliverySiteUpdatedAt: string; prefix: string;
  lines: FixtureLine[]; sourceOrderIds: string[];
};
type CampaignFixture = {
  status: string; apiUrl: string; tenantId: string; userId: string;
  scenarios: Record<string, ScenarioFixture>;
  browserRequests: Array<{ pathname: string; method: string }>;
};
type Preparation = {
  summary: { draftable_lines: number; blocked_lines: number };
  groups: Array<{
    supplier_id: string; total_ht_cents: number; total_tax_cents: number; total_ttc_cents: number;
    lines: Array<{ item_id: string; quantity: number; unit_price_ht_cents: number; review_fingerprint?: string }>;
  }>;
  blocked_lines: Array<{ item_id: string; reason: string }>;
  transferred_lines?: Array<{
    item_id: string; item_title: string; purchase_order_id: string;
    reference: string; status: string; quantity: number;
  }>;
};
type Order = { id: string; status: string; total_ht_cents: number; suppliers: { id: string } | null };

// Failure plan: docs/testing/purchase-preparation.md. The fixture is local only;
// all observed behavior below uses the normal authenticated application APIs.
const campaignTest = test.extend<{ campaign: CampaignFixture }>({
  campaign: async ({ app, browser }, provide) => {
    const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    if (backend.protocol !== "http:" || backend.hostname !== "127.0.0.1" || backend.username || backend.password) {
      throw new Error("Purchase preparation requires the isolated loopback Supabase.");
    }
    const file = process.env.E2E_PURCHASE_PREPARATION_FIXTURE_PATH;
    if (!file) throw new Error("An explicit new purchase preparation fixture is required.");
    const fixture = JSON.parse(await readFile(file, "utf8")) as CampaignFixture;
    fixture.browserRequests = [];
    expect(fixture.status).toBe("ready");
    expect(fixture.apiUrl).toBe(backend.origin);
    const appOrigin = new URL(app.baseUrl!).origin;
    await browser.route("**/*", async (route) => {
      const url = new URL(route.request.url);
      if (url.origin === appOrigin && url.pathname.endsWith("/purchase-order-drafts")) {
        fixture.browserRequests.push({ pathname: url.pathname + url.search, method: route.request.method });
      }
      if (url.hostname === "api.fontshare.com" && url.pathname === "/v2/css" && route.request.method === "GET") {
        await route.fulfill({ headers: { "content-type": "text/css" }, body: "" });
        return;
      }
      const readOnly = ["GET", "HEAD", "OPTIONS"].includes(route.request.method);
      const auth = url.origin === backend.origin && url.pathname.startsWith("/auth/v1/");
      const deliveryLookup = readOnly && url.origin === backend.origin && url.pathname === "/rest/v1/delivery_sites";
      const forbiddenMutation = !readOnly && /\/(send|email-dispatch|approve|status|invite|invitations|portal-tokens)(\/|$)/.test(url.pathname);
      if ((url.origin !== appOrigin && !auth && !deliveryLookup) || forbiddenMutation) {
        await route.abort();
        throw new Error(`Local purchase campaign rejected ${route.request.method} ${url.hostname}${url.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[id]")}`);
      }
      await route.continue();
    });
    await provide(fixture);
  },
});
const purchaseTest = campaignTest.extend<{ army: ArmyState }>({
  army: async ({ campaign }, provide) => {
    const runPrefix = `ARMY-PURCHASE-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const army: ArmyState = { runPrefix, projectName: runPrefix, ownedEstimates: [] };
    try { await provide(army); }
    finally { await recordEvidence(army, "purchase-fixtures", { campaign, retained: true, emails: "none" }); }
  },
});

function scenario(campaign: CampaignFixture, name: string, army: ArmyState) {
  const fixture = campaign.scenarios[name];
  if (!fixture?.prefix.startsWith("ARMY-PURCHASE-")) throw new Error(`Missing owned fixture: ${name}`);
  army.ownedEstimates.push({ projectId: fixture.projectId, versionId: fixture.versionId });
  return fixture;
}

function requestFor(fixture: ScenarioFixture, preparation: Preparation) {
  const preparedLines = new Map(preparation.groups.flatMap((group) => group.lines).map((line) => [line.item_id, line]));
  return {
    idempotency_key: randomUUID(),
    // The old API ignores these new fields and exposes no fingerprint. The
    // explicit sentinel reproduces its accepted stale POST; it is not evidence
    // that the legacy API supplied or checked a fingerprint.
    reviewed_lines: fixture.lines.map((line) => ({ item_id: line.lineId,
      review_fingerprint: preparedLines.get(line.lineId)?.review_fingerprint ?? "0".repeat(64),
    })),
    groups: fixture.lines.map((line) => ({
      supplier_id: line.supplierId, delivery_site_id: fixture.deliverySiteId,
      delivery_site_updated_at: fixture.deliverySiteUpdatedAt,
      item_ids: [line.lineId], expected_delivery_date: null, notes: "ARMY preparation reviewed",
    })),
  };
}

async function readPreparation(browser: Browser, fixture: ScenarioFixture) {
  const response = await apiRequest<Envelope<Preparation>>(browser, "GET", `/api/estimates/${fixture.versionId}/purchase-order-drafts`);
  expect(response.status).toBe(200);
  expect(response.body.ok).toBe(true);
  return response.body.data;
}

async function readOrders(browser: Browser, fixture: ScenarioFixture) {
  const response = await apiRequest<Envelope<{ items: Order[] }>>(browser, "GET", "/api/orders");
  expect(response.status).toBe(200);
  const supplierIds = new Set(fixture.lines.map((line) => line.supplierId));
  return response.body.data.items.filter((order) => order.suppliers && supplierIds.has(order.suppliers.id)).sort((a, b) => a.id.localeCompare(b.id));
}

async function orderEvidence(browser: Browser, fixture: ScenarioFixture) {
  const orders = await readOrders(browser, fixture);
  const lines = await Promise.all(orders.map(async (order) => {
    const response = await apiRequest(browser, "GET", `/api/orders?view=items&order_id=${order.id}`);
    expect(response.status).toBe(200);
    return { orderId: order.id, response };
  }));
  return { orders, lines };
}

for (const mutation of [
  { scenario: "stale-quantity", patch: { quantity: 3 }, expectedQuantity: 3, expectedPrice: 1200 },
  { scenario: "stale-cost", patch: { unit_price_ht_cents: 1300 }, expectedQuantity: 2, expectedPrice: 1300 },
]) {
  purchaseTest(`local purchase preparation rejects ${mutation.scenario} after the buyer preview`, {
    session: "army", tags: ["critical", "local", "business-corpus"], trace: "off", timeout: 180_000,
  }, async ({ app, browser, campaign, army }) => {
    const fixture = scenario(campaign, mutation.scenario, army);
    await app.open(`/dashboard/affaires/${fixture.projectId}`);
    const before = await readEstimate(browser, fixture.versionId);
    expect(await readOrders(browser, fixture)).toEqual([]);
    const preview = await readPreparation(browser, fixture);
    expect(preview.summary.draftable_lines).toBe(2);
    for (const line of fixture.lines) {
      expect(preview.groups.find((group) => group.supplier_id === line.supplierId)).toMatchObject({
        total_ht_cents: line.ht, total_tax_cents: line.tax, total_ttc_cents: line.ttc,
        lines: [expect.objectContaining({ item_id: line.lineId, quantity: line.quantity, unit_price_ht_cents: line.unitPriceCents })],
      });
    }
    const request = requestFor(fixture, preview);
    expect((await apiRequest(browser, "POST", `/api/estimates/${fixture.versionId}/lock`)).status).toBe(201);
    const mutationResponse = await apiRequest(browser, "PATCH", `/api/estimates/${fixture.versionId}/items`, {
      id: fixture.lines[0].lineId, ...mutation.patch,
    });
    expect(mutationResponse.status).toBe(200);
    const updated = await readEstimate(browser, fixture.versionId);
    expect(updated.items.find((item) => item.id === fixture.lines[0].lineId)).toMatchObject({
      quantity: mutation.expectedQuantity, unit_price_ht_cents: mutation.expectedPrice,
    });
    const response = await apiRequest<Envelope<unknown>>(browser, "POST", `/api/estimates/${fixture.versionId}/purchase-order-drafts`, request);
    const orders = await orderEvidence(browser, fixture);
    const after = await readEstimate(browser, fixture.versionId);
    await recordEvidence(army, mutation.scenario, {
      fixture, before, preview, request, mutationResponse, updated, response, orders, after,
      expected: { status: 409, orderCount: 0, estimate: updated },
    });
    expect.soft(response.status, "A purchase request must match the reviewed quantities and costs").toBe(409);
    expect.soft(response.body.error?.code).toBe("ORDER_DRAFT_PREPARATION_STALE");
    expect.soft(orders.orders).toEqual([]);
    expect.soft(after).toEqual(updated);
  });
}

for (const status of ["sent", "confirmed", "received", "canceled"]) {
purchaseTest(`local purchase preparation does not transfer already ${status} source lines again`, {
  session: "army", tags: ["critical", "local", "business-corpus"], trace: "off", timeout: 180_000,
}, async ({ app, browser, campaign, army }) => {
  const fixture = scenario(campaign, status, army);
  await app.open(`/dashboard/affaires/${fixture.projectId}`);
  const before = await readEstimate(browser, fixture.versionId);
  const prior = await orderEvidence(browser, fixture);
  expect(prior.orders.map((order) => order.id).sort()).toEqual([...fixture.sourceOrderIds].sort());
  expect(prior.orders.every((order) => order.status === status)).toBe(true);
  const preview = await readPreparation(browser, fixture);
  const request = requestFor(fixture, preview);
  const response = await apiRequest<Envelope<unknown>>(browser, "POST", `/api/estimates/${fixture.versionId}/purchase-order-drafts`, request);
  const afterOrders = await orderEvidence(browser, fixture);
  const afterEstimate = await readEstimate(browser, fixture.versionId);
  await recordEvidence(army, `${status}-source-retransfer`, {
    fixture, before, prior, preview, request, response, afterOrders, afterEstimate,
    expected: { status: 409, orderCount: 2, draftableLines: 0 },
  });
  // Retain the demonstrated duplicate before repairing only these newly
  // created ARMY drafts. Historical sent orders remain untouched, and the
  // migration can subsequently validate a dataset without seeded duplicates.
  const priorIds = new Set(prior.orders.map((order) => order.id));
  for (const duplicate of afterOrders.orders.filter((order) => !priorIds.has(order.id))) {
    expect(duplicate.status, "Only a fresh draft created by this request may be removed").toBe("draft");
    const deleted = await apiRequest(browser, "DELETE", `/api/purchase-orders/${duplicate.id}`);
    await recordEvidence(army, `${status}-duplicate-repair-${duplicate.id}`, { duplicate, deleted });
    expect(deleted.status).toBe(200);
  }
  const repaired = await orderEvidence(browser, fixture);
  await recordEvidence(army, `${status}-owned-duplicates-repaired`, { expected: prior, actual: repaired });
  expect(repaired).toEqual(prior);
  expect.soft(preview.summary.draftable_lines).toBe(0);
  expect.soft(preview.groups).toEqual([]);
  expect.soft(response.status).toBe(409);
  expect.soft(response.body.error?.code).toBe("ORDER_DRAFT_ALREADY_EXISTS");
  for (const [index, line] of fixture.lines.entries()) {
    expect.soft(preview.transferred_lines?.find((entry) => entry.item_id === line.lineId)).toMatchObject({
      item_id: line.lineId, item_title: `${fixture.prefix} ligne ${line.label}`,
      purchase_order_id: fixture.sourceOrderIds[index], status, quantity: line.quantity,
    });
  }
  expect.soft(afterOrders).toEqual(prior);
  expect.soft(afterEstimate).toEqual(before);
});
}

type CreationResult = {
  idempotency_key: string;
  replayed: boolean;
  source_version_id: string;
  summary: { draft_orders_created: number; draft_lines_created: number };
  orders: Array<{
    purchase_order_id: string; supplier_id: string; current_status: string;
    delivery_site_id: string; item_count: number; ordered_source_item_ids: string[];
    total_ht_cents: number; total_tax_cents: number; total_ttc_cents: number;
  }>;
};

function assertRealReview(preview: Preparation, fixture: ScenarioFixture) {
  expect(preview.summary.draftable_lines).toBe(2);
  const lines = preview.groups.flatMap((group) => group.lines);
  expect(lines.map((line) => line.item_id).sort()).toEqual(fixture.lines.map((line) => line.lineId).sort());
  for (const line of lines) {
    expect(line.review_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(line.review_fingerprint).not.toBe("0".repeat(64));
  }
}

async function assertCreatedOrders(browser: Browser, fixture: ScenarioFixture, result: CreationResult) {
  expect(result.source_version_id).toBe(fixture.versionId);
  expect(result.summary).toMatchObject({ draft_orders_created: 2, draft_lines_created: 2 });
  expect(result.orders).toHaveLength(2);
  const persisted = await orderEvidence(browser, fixture);
  expect(persisted.orders.map((order) => order.id).sort()).toEqual(result.orders.map((order) => order.purchase_order_id).sort());
  expect(persisted.orders.every((order) => order.status === "draft")).toBe(true);
  for (const line of fixture.lines) {
    const order = result.orders.find((candidate) => candidate.supplier_id === line.supplierId)!;
    expect(order).toMatchObject({ current_status: "draft", delivery_site_id: fixture.deliverySiteId,
      item_count: 1, total_ht_cents: line.ht, total_tax_cents: line.tax, total_ttc_cents: line.ttc,
      ordered_source_item_ids: [line.lineId],
    });
    const response = await apiRequest<Envelope<{ items: Array<Record<string, unknown>> }>>(browser, "GET", `/api/orders?view=items&order_id=${order.purchase_order_id}`);
    expect(response.status).toBe(200);
    expect(response.body.data.items).toEqual([expect.objectContaining({
      quantity: line.quantity, unit_price_ht_cents: line.unitPriceCents, line_total_ht_cents: line.ht,
    })]);
  }
  expect(result.orders.reduce((sum, order) => sum + order.total_ht_cents, 0)).toBe(4731);
  expect(result.orders.reduce((sum, order) => sum + order.total_tax_cents, 0)).toBe(946);
  expect(result.orders.reduce((sum, order) => sum + order.total_ttc_cents, 0)).toBe(5677);
  return persisted;
}

purchaseTest("local purchase preparation records two exact drafts and recovers the same receipt", {
  session: "army", tags: ["critical", "local", "business-corpus"], trace: "off", timeout: 180_000,
}, async ({ app, browser, campaign, army }) => {
  const fixture = scenario(campaign, "valid", army);
  await app.open(`/dashboard/affaires/${fixture.projectId}`);
  expect(await readOrders(browser, fixture)).toEqual([]);
  const before = await readEstimate(browser, fixture.versionId);
  const preview = await readPreparation(browser, fixture);
  assertRealReview(preview, fixture);
  const request = requestFor(fixture, preview);
  const endpoint = `/api/estimates/${fixture.versionId}/purchase-order-drafts`;
  const receiptEndpoint = `${endpoint}?idempotency_key=${request.idempotency_key}`;
  const absent = await apiRequest<Envelope<CreationResult | null>>(browser, "GET", receiptEndpoint);
  expect(absent.status).toBe(200);
  expect(absent.body.data).toBeNull();
  const created = await apiRequest<Envelope<CreationResult>>(browser, "POST", endpoint, request);
  expect(created.status).toBe(201);
  expect(created.body.data.idempotency_key).toBe(request.idempotency_key);
  expect(created.body.data.replayed).toBe(false);
  const persisted = await assertCreatedOrders(browser, fixture, created.body.data);
  const retry = await apiRequest<Envelope<CreationResult>>(browser, "POST", endpoint, request);
  expect(retry.status).toBe(200);
  expect(retry.body.data.replayed).toBe(true);
  expect(retry.body.data.orders).toEqual(created.body.data.orders);
  const uppercaseRequest = {
    ...request,
    idempotency_key: request.idempotency_key.toUpperCase(),
    reviewed_lines: request.reviewed_lines.map((line) => ({ ...line, item_id: line.item_id.toUpperCase() })),
    groups: request.groups.map((group) => ({ ...group, supplier_id: group.supplier_id.toUpperCase(),
      delivery_site_id: group.delivery_site_id.toUpperCase(), item_ids: group.item_ids.map((id) => id.toUpperCase()),
    })),
  };
  const uppercaseEndpoint = `/api/estimates/${fixture.versionId.toUpperCase()}/purchase-order-drafts`;
  const uppercaseRetry = await apiRequest<Envelope<CreationResult>>(browser, "POST", uppercaseEndpoint, uppercaseRequest);
  expect(uppercaseRetry.status).toBe(200);
  expect(uppercaseRetry.body.data.replayed).toBe(true);
  expect(uppercaseRetry.body.data.idempotency_key).toBe(request.idempotency_key);
  expect(uppercaseRetry.body.data.orders).toEqual(created.body.data.orders);
  const uppercaseReceipt = await apiRequest<Envelope<CreationResult>>(browser, "GET", `${uppercaseEndpoint}?idempotency_key=${request.idempotency_key.toUpperCase()}`);
  expect(uppercaseReceipt.status).toBe(200);
  expect(uppercaseReceipt.body.data.idempotency_key).toBe(request.idempotency_key);
  expect(uppercaseReceipt.body.data.orders).toEqual(created.body.data.orders);
  const receipt = await apiRequest<Envelope<CreationResult>>(browser, "GET", receiptEndpoint);
  expect(receipt.status).toBe(200);
  expect(receipt.body.data.idempotency_key).toBe(request.idempotency_key);
  expect(receipt.body.data.orders).toEqual(created.body.data.orders);
  const changedRequest = { ...request, groups: request.groups.map((group) => ({ ...group, notes: "Different human intention" })) };
  const mismatch = await apiRequest<Envelope<unknown>>(browser, "POST", endpoint, changedRequest);
  expect(mismatch.status).toBe(409);
  expect(mismatch.body.error?.code).toBe("ORDER_DRAFT_IDEMPOTENCY_CONFLICT");
  const afterOrders = await orderEvidence(browser, fixture);
  const after = await readEstimate(browser, fixture.versionId);
  const transferred = await readPreparation(browser, fixture);
  await recordEvidence(army, "purchase-receipt-recovery", { fixture, before, preview, request, created, persisted,
    retry, uppercaseRequest, uppercaseRetry, uppercaseReceipt, receipt, changedRequest, mismatch, afterOrders, after, transferred });
  expect(afterOrders).toEqual(persisted);
  expect(after).toEqual(before);
  expect(transferred.summary.draftable_lines).toBe(0);
});

purchaseTest("local purchase preparation coalesces concurrent calls for the same intent", {
  session: "army", tags: ["critical", "local", "business-corpus"], trace: "off", timeout: 180_000,
}, async ({ app, browser, campaign, army }) => {
  const fixture = scenario(campaign, "same-intent", army);
  await app.open(`/dashboard/affaires/${fixture.projectId}`);
  expect(await readOrders(browser, fixture)).toEqual([]);
  const before = await readEstimate(browser, fixture.versionId);
  const preview = await readPreparation(browser, fixture);
  assertRealReview(preview, fixture);
  const request = requestFor(fixture, preview);
  const endpoint = `/api/estimates/${fixture.versionId}/purchase-order-drafts`;
  const results = await Promise.all([
    apiRequest<Envelope<CreationResult>>(browser, "POST", endpoint, request),
    apiRequest<Envelope<CreationResult>>(browser, "POST", endpoint, request),
  ]);
  const afterOrders = await orderEvidence(browser, fixture);
  const after = await readEstimate(browser, fixture.versionId);
  await recordEvidence(army, "purchase-same-intent-concurrent", { fixture, preview, request, before, results, afterOrders, after });
  expect(results.map((result) => result.status).sort()).toEqual([200, 201]);
  expect(results.map((result) => result.body.data.replayed).sort()).toEqual([false, true]);
  expect(results[0].body.data.orders).toEqual(results[1].body.data.orders);
  await assertCreatedOrders(browser, fixture, results[0].body.data);
  expect(after).toEqual(before);
});

purchaseTest("local purchase preparation prevents distinct concurrent intents from transferring the same lines", {
  session: "army", tags: ["critical", "local", "business-corpus"], trace: "off", timeout: 180_000,
}, async ({ app, browser, campaign, army }) => {
  const fixture = scenario(campaign, "different-intents", army);
  await app.open(`/dashboard/affaires/${fixture.projectId}`);
  expect(await readOrders(browser, fixture)).toEqual([]);
  const before = await readEstimate(browser, fixture.versionId);
  const preview = await readPreparation(browser, fixture);
  assertRealReview(preview, fixture);
  const requests = [requestFor(fixture, preview), requestFor(fixture, preview)];
  const endpoint = `/api/estimates/${fixture.versionId}/purchase-order-drafts`;
  const results = await Promise.all(requests.map((request) => apiRequest<Envelope<CreationResult>>(browser, "POST", endpoint, request)));
  const afterOrders = await orderEvidence(browser, fixture);
  const after = await readEstimate(browser, fixture.versionId);
  await recordEvidence(army, "purchase-different-intents-concurrent", { fixture, preview, requests, before, results, afterOrders, after });
  expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
  const success = results.find((result) => result.status === 201)!;
  expect(results.find((result) => result.status === 409)?.body.error?.code).toBe("ORDER_DRAFT_ALREADY_EXISTS");
  await assertCreatedOrders(browser, fixture, success.body.data);
  expect(after).toEqual(before);
});

purchaseTest("local purchase preparation requires review and recovers a lost response without a second creation", {
  session: "army", tags: ["critical", "local", "business-corpus"], trace: "off", timeout: 240_000,
}, async ({ app, screen, browser, campaign, army }) => {
  const fixture = scenario(campaign, "ui-recovery", army);
  const hub = `/dashboard/affaires/${fixture.projectId}`;
  await app.open(hub);
  const before = await readEstimate(browser, fixture.versionId);
  expect(await readOrders(browser, fixture)).toEqual([]);
  const checkbox = screen.getByRole("checkbox", "J’ai vérifié les lignes, les montants et la livraison.", { exact: true });
  const create = screen.getByRole("button", "Créer 2 brouillons", { exact: true });
  await expect(checkbox).toBeVisible();
  await screen.getByLabel("Chantier de livraison", { exact: true }).selectOption({ value: fixture.deliverySiteId });
  await expect(create).toBeDisabled();
  for (const line of fixture.lines) {
    await expect(screen.getByRole("rowheader", `${fixture.prefix} ligne ${line.label} Réf. ${fixture.prefix}-${line.label}`, { exact: true })).toBeVisible();
  }
  await checkbox.check();
  await expect(create).toBeEnabled();
  await screen.getByLabel("Note reprise sur chaque brouillon (optionnel)", { exact: true }).fill("ARMY reviewed delivery note");
  await expect(checkbox).not.toBeChecked();
  await expect(create).toBeDisabled();
  await checkbox.check();
  await expect(create).toBeEnabled();
  const endpoint = `/api/estimates/${fixture.versionId}/purchase-order-drafts`;
  // This test-only transport interruption happens after the real HTTP response
  // is received. It never changes product state or bypasses authorization.
  await browser.evaluate((target) => {
    const scope = window as typeof window & { __purchaseRecoveryProbe?: {
      requests: unknown[]; response: unknown; count: number;
      receiptReads: Array<{ actualStatus: number; delivered: string }>;
    } };
    const original = window.fetch.bind(window);
    scope.__purchaseRecoveryProbe = { requests: [], response: null, count: 0, receiptReads: [] };
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.href);
      if (url.origin === window.location.origin && url.pathname === target && init?.method?.toUpperCase() === "POST") {
        const probe = scope.__purchaseRecoveryProbe!;
        probe.count += 1;
        probe.requests.push(typeof init.body === "string" ? JSON.parse(init.body) : null);
        const result = await original(input, init);
        probe.response = { status: result.status, body: await result.clone().json() };
        if (probe.count === 1) throw new TypeError("ARMY deliberately discarded the first response after server persistence");
        return result;
      }
      if (url.origin === window.location.origin && url.pathname === target &&
        url.searchParams.has("idempotency_key") && (init?.method ?? "GET").toUpperCase() === "GET") {
        const probe = scope.__purchaseRecoveryProbe!;
        const result = await original(input, init);
        const firstReceiptRead = probe.receiptReads.length === 0;
        probe.receiptReads.push({ actualStatus: result.status, delivered: firstReceiptRead ? "malformed-json" : "original" });
        if (firstReceiptRead) return new Response("{", { status: 200, headers: { "content-type": "application/json" } });
        return result;
      }
      return original(input, init);
    };
    return true;
  }, endpoint);
  await create.tap();
  await expect(screen.getByText("Le résultat de la préparation reste à vérifier. Reprenez cette même demande avant d’en préparer une autre.", { exact: true })).toBeVisible();
  const probe = await browser.evaluate(() => (window as typeof window & { __purchaseRecoveryProbe: { requests: Array<{ idempotency_key: string }>; response: { status: number; body: Envelope<CreationResult> }; count: number } }).__purchaseRecoveryProbe);
  expect(probe.count).toBe(1);
  expect(probe.response.status).toBe(201);
  const persisted = await assertCreatedOrders(browser, fixture, probe.response.body.data);
  const key = probe.requests[0].idempotency_key;
  const storage = await browser.evaluate((versionId) => JSON.parse(localStorage.getItem(`estimate-purchase-intent:v1:${versionId}`) ?? "null"), fixture.versionId);
  expect(storage).toEqual({ versionId: fixture.versionId, idempotencyKey: key });
  await screen.getByRole("button", "Vérifier et reprendre la préparation", { exact: true }).tap();
  await expect(screen.getByText("La réponse de vérification est illisible. Vérifiez à nouveau la préparation.", { exact: true })).toBeVisible();
  const unreadableReceiptProbe = await browser.evaluate(() => (window as typeof window & {
    __purchaseRecoveryProbe: { count: number; receiptReads: Array<{ actualStatus: number; delivered: string }> };
  }).__purchaseRecoveryProbe);
  expect(unreadableReceiptProbe.count).toBe(1);
  expect(unreadableReceiptProbe.receiptReads).toEqual([{ actualStatus: 200, delivered: "malformed-json" }]);
  expect(await orderEvidence(browser, fixture)).toEqual(persisted);
  await expect(browser.locator("#finish-line-orders").getByRole("button", /^Créer(?: |$)/)).toHaveCount(0);
  await expect(screen.getByRole("button", "Vérifier et reprendre la préparation", { exact: true })).toBeEnabled();
  await screen.getByRole("button", "Vérifier et reprendre la préparation", { exact: true }).tap();
  await expect(screen.getByText("Préparation déjà enregistrée", { exact: true })).toBeVisible();
  const afterRetry = await orderEvidence(browser, fixture);
  expect(afterRetry).toEqual(persisted);
  expect(await browser.evaluate(() => (window as typeof window & { __purchaseRecoveryProbe: { count: number } }).__purchaseRecoveryProbe.count)).toBe(1);
  await app.open(hub);
  await expect(screen.getByText("Préparation déjà enregistrée", { exact: true })).toBeVisible();
  const afterReload = await orderEvidence(browser, fixture);
  const after = await readEstimate(browser, fixture.versionId);
  await recordEvidence(army, "purchase-ui-recovery", { fixture, before, probe, storage, unreadableReceiptProbe,
    persisted, afterRetry, afterReload, after, network: campaign.browserRequests });
  expect(campaign.browserRequests.filter((entry) => entry.method === "POST" && entry.pathname === endpoint)).toHaveLength(1);
  expect(campaign.browserRequests.filter((entry) => entry.method === "GET" && entry.pathname === `${endpoint}?idempotency_key=${key}`).length).toBeGreaterThanOrEqual(3);
  expect(afterReload).toEqual(persisted);
  expect(after).toEqual(before);
});
