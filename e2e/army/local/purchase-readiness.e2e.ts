import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { test } from "@e2e-dev/web";
import { expect } from "e2e";

import { apiRequest, readEstimate, recordEvidence, type ArmyState } from "../critical/fixtures";

type Browser = Parameters<typeof apiRequest>[0];
type Envelope<T> = { ok: boolean; data: T };
type Counts = { total_supplier_lines: number; draftable_lines: number; transferred_lines: number; blocked_lines: number };
type Line = { label: string; lineId: string; productId: string; priceId: string; reference: string;
  quantity: number; price: number; ht: number; tax: number; ttc: number };
type Fixture = { status: string; apiUrl: string; prefix: string; projectId: string; versionId: string;
  supplierId: string; noteOrderId: string; deliverySiteId: string; lines: Line[];
  requests: Array<{ pathname: string; method: string }>;
  previewReads: number; completedOverrides: Array<{ pathname: string; method: string; status: number }>;
  onOverride?: () => void;
  responseOverride: { status: number; body: unknown } | null };
type Preparation = { summary: Counts; groups: Array<{ supplier_id: string;
  total_ht_cents: number; total_tax_cents: number; total_ttc_cents: number;
  lines: Array<{ item_id: string; quantity: number; unit: string; unit_price_ht_cents: number; review_fingerprint: string }> }>;
  blocked_lines: Array<{ item_id: string; reason: string; reason_detail: string | null }>;
  transferred_lines: Array<{ item_id: string; purchase_order_id: string; quantity: number }> };

// Failure plan and exact UI contract were agreed before implementation.
function readinessTestFor(fixtureFileVariable: string) {
  const fixtureTest = test.extend<{ fixture: Fixture }>({
    fixture: async ({ app, browser }, provide) => {
      const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
      if ((backend.protocol !== "http:" || backend.hostname !== "127.0.0.1") || backend.username || backend.password) throw new Error("Exact isolated readiness backend required.");
      const file = process.env[fixtureFileVariable];
      if (!file) throw new Error("An explicit fresh readiness fixture is required.");
      const fixture = JSON.parse(await readFile(file, "utf8")) as Fixture;
      expect(fixture.status).toBe("ready");
      expect(fixture.apiUrl).toBe(backend.origin);
      expect(fixture.prefix).toMatch(/^ARMY-DECIMAL-/);
      fixture.requests = [];
      fixture.previewReads = 0;
      fixture.completedOverrides = [];
      fixture.responseOverride = null;
      const origin = new URL(app.baseUrl!).origin;
      await browser.route("**/*", async (route) => {
        const url = new URL(route.request.url);
        if (url.origin === origin && url.pathname.startsWith("/api/")) {
          fixture.requests.push({ pathname: url.pathname + url.search, method: route.request.method });
        }
        if (url.origin === origin && url.pathname === `/api/estimates/${fixture.versionId}/purchase-order-drafts` &&
          !url.search && route.request.method === "GET" && fixture.responseOverride) {
          const injected = fixture.responseOverride;
          await route.fulfill({ status: injected.status, headers: { "content-type": "application/json" },
            body: JSON.stringify(injected.body) });
          fixture.completedOverrides.push({ pathname: url.pathname, method: route.request.method, status: injected.status });
          fixture.onOverride?.();
          return;
        }
        if (url.hostname === "api.fontshare.com" && url.pathname === "/v2/css" && route.request.method === "GET") {
          await route.fulfill({ headers: { "content-type": "text/css" }, body: "" });
          return;
        }
        const readOnly = ["GET", "HEAD", "OPTIONS"].includes(route.request.method);
        const auth = url.origin === backend.origin && url.pathname.startsWith("/auth/v1/");
        const lookup = readOnly && url.origin === backend.origin && url.pathname === "/rest/v1/delivery_sites";
        const forbidden = !readOnly && /\/(send|email-dispatch|approve|status|invite|invitations|portal-tokens)(\/|$)/.test(url.pathname);
        if ((url.origin !== origin && !auth && !lookup) || forbidden) {
          await route.abort();
          throw new Error("Readiness campaign rejected a request outside its isolated scope.");
        }
        await route.continue();
      });
      await provide(fixture);
    },
  });
  const readinessTest = fixtureTest.extend<{ army: ArmyState }>({
    army: async ({ fixture }, provide) => {
      const army: ArmyState = { runPrefix: `ARMY-READINESS-${Date.now()}-${randomUUID().slice(0, 8)}`,
        projectName: fixture.prefix, ownedEstimates: [{ projectId: fixture.projectId, versionId: fixture.versionId }] };
      try { await provide(army); }
      finally { await recordEvidence(army, "readiness-fixture", { fixture, traces: "off", modelCalls: 0, emails: "none" }); }
    },
  });
  return readinessTest;
}
const readinessTest = readinessTestFor("E2E_PURCHASE_READINESS_FIXTURE_PATH");
const failureTest = readinessTestFor("E2E_PURCHASE_READINESS_FAILURE_FIXTURE_PATH");

const preparedMessage = "Toutes les lignes fournisseur ont déjà été transférées. Consultez les commandes existantes.";
const unavailableMessage = "Préparation indisponible. Rechargez pour vérifier les lignes.";
function countText(counts: Counts) {
  return `${counts.draftable_lines} ligne${counts.draftable_lines > 1 ? "s" : ""} préparable${counts.draftable_lines > 1 ? "s" : ""} · ` +
    `${counts.transferred_lines} ligne${counts.transferred_lines > 1 ? "s" : ""} déjà transférée${counts.transferred_lines > 1 ? "s" : ""} · ` +
    `${counts.blocked_lines} ligne${counts.blocked_lines > 1 ? "s" : ""} à corriger.`;
}
async function preview(browser: Browser, fixture: Fixture, army: ArmyState) {
  const response = await apiRequest<Envelope<Preparation>>(browser, "GET", `/api/estimates/${fixture.versionId}/purchase-order-drafts`);
  await recordEvidence(army, `readiness-preview-${++fixture.previewReads}`, { response });
  expect(response.status).toBe(200);
  expect(response.body.ok).toBe(true);
  return response.body.data;
}
async function surfaces(browser: Browser) {
  return browser.evaluate(() => {
    const normalize = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
    const headings = Array.from(document.querySelectorAll("h3"))
      .filter((heading) => ["Prêt à commander", "Préparation des achats"].includes(normalize(heading.textContent)));
    const heading = headings[0];
    // Both the old and agreed new title identify the actual pilotage card.
    // Its recorded DOM has header > title wrapper > h3, then a summary sibling.
    const card = heading?.parentElement?.parentElement?.parentElement;
    const panel = document.querySelector("#finish-line-orders");
    const snapshot = (element: Element | null | undefined) => ({
      text: normalize((element as HTMLElement | undefined)?.innerText),
      badge: normalize((element?.firstElementChild?.lastElementChild as HTMLElement | undefined)?.innerText),
    });
    return { headingCount: headings.length, cardTitle: normalize(heading?.textContent), card: snapshot(card), panel: snapshot(panel) };
  });
}
async function assertCounts(browser: Browser, army: ArmyState, label: string, counts: Counts, badge: string) {
  const observed = await surfaces(browser);
  await recordEvidence(army, label, { expected: { counts, text: countText(counts), badge }, observed });
  expect.soft(observed.headingCount).toBe(1);
  expect.soft(observed.cardTitle).toBe("Préparation des achats");
  for (const surface of [observed.card, observed.panel]) {
    expect.soft(surface.text).toContain(countText(counts));
    expect.soft(surface.badge).toBe(badge);
    expect.soft(surface.text.includes("sont déjà commandables")).toBe(false);
    expect.soft(surface.text.includes("fournisseur preparables sans ressaisie")).toBe(false);
    if (badge === "Déjà préparé") expect.soft(surface.text).toContain(preparedMessage);
  }
}
function sourceValues(source: Awaited<ReturnType<typeof readEstimate>>) {
  return source.items.map((item) => ({ id: item.id, parentId: item.parent_id, position: item.position,
    title: item.title, quantity: item.quantity, price: item.unit_price_ht_cents, taxRate: item.tax_rate_bp,
    productId: item.product_id, selectedPriceId: item.selected_supplier_price_id, description: item.description,
  })).sort((left, right) => left.id.localeCompare(right.id));
}

readinessTest("local purchase readiness counts remaining blocked and transferred lines before and after creation", {
  session: "army", tags: ["critical", "local", "business-corpus"], trace: "off", timeout: 240_000,
}, async ({ app, screen, browser, fixture, army }) => {
  const href = `/dashboard/affaires/${fixture.projectId}`;
  const endpoint = `/api/estimates/${fixture.versionId}/purchase-order-drafts`;
  const panel = browser.locator("#finish-line-orders");
  const lockHeaders = { "x-estimate-draft-lock-session-id": randomUUID() };
  const half = fixture.lines.find((line) => line.label === "half")!;
  expect(half.quantity).toBe(12.5);
  await app.open(href);
  const source = await readEstimate(browser, fixture.versionId);
  const before = await preview(browser, fixture, army);
  expect(before.summary).toMatchObject({ total_supplier_lines: 4, draftable_lines: 3, transferred_lines: 1, blocked_lines: 0 });
  await expect(panel.getByRole("rowheader", `${fixture.prefix} half Réf. ${half.reference}`, { exact: true })).toBeVisible();
  await assertCounts(browser, army, "readiness-before", before.summary, "Prêt");

  const lock = await apiRequest(browser, "POST", `/api/estimates/${fixture.versionId}/lock`, undefined, lockHeaders);
  await recordEvidence(army, "readiness-lock", { lock });
  expect(lock.status).toBe(201);
  const mutation = await apiRequest(browser, "PATCH", `/api/estimates/${fixture.versionId}/items`, { id: half.lineId, quantity: 0.5 }, lockHeaders);
  await recordEvidence(army, "readiness-quantity-mutation", { mutation });
  expect(mutation.status).toBe(200);
  const blocked = await preview(browser, fixture, army);
  await recordEvidence(army, "readiness-minimum-changed", { mutation, blocked, source: await readEstimate(browser, fixture.versionId) });
  expect(blocked.summary).toMatchObject({ total_supplier_lines: 4, draftable_lines: 2, transferred_lines: 1, blocked_lines: 1 });
  expect(blocked.blocked_lines).toEqual([expect.objectContaining({ item_id: half.lineId, reason: "supplier_offer_ineligible" })]);
  expect(blocked.groups[0]).toMatchObject({ total_ht_cents: 98, total_tax_cents: 19, total_ttc_cents: 117 });
  await app.open(href);
  await expect(panel.getByText(blocked.blocked_lines[0].reason_detail ?? "Conditions fournisseur à revalider", { exact: true })).toBeVisible();
  await assertCounts(browser, army, "readiness-below-minimum", blocked.summary, "Partiellement prêt");

  const restore = await apiRequest(browser, "PATCH", `/api/estimates/${fixture.versionId}/items`, { id: half.lineId, quantity: half.quantity }, lockHeaders);
  await recordEvidence(army, "readiness-quantity-restoration", { restore });
  expect(restore.status).toBe(200);
  await app.open(href);
  await expect(panel.getByRole("rowheader", `${fixture.prefix} half Réf. ${half.reference}`, { exact: true })).toBeVisible();
  const restored = await preview(browser, fixture, army);
  expect(restored.summary).toMatchObject({ total_supplier_lines: 4, draftable_lines: 3, transferred_lines: 1, blocked_lines: 0 });
  expect(restored.groups).toHaveLength(1);
  expect(restored.groups[0]).toMatchObject({ total_ht_cents: 1636, total_tax_cents: 327, total_ttc_cents: 1963 });
  for (const line of fixture.lines.filter((line) => line.label !== "integer")) {
    expect(restored.groups[0].lines.find((entry) => entry.item_id === line.lineId)).toMatchObject({
      quantity: line.quantity, unit: "m", unit_price_ht_cents: line.price,
    });
  }
  await screen.getByLabel("Chantier de livraison", { exact: true }).selectOption({ value: fixture.deliverySiteId });
  await panel.getByRole("checkbox", "J’ai vérifié les lignes, les montants et la livraison.", { exact: true }).check();
  await panel.getByRole("button", "Créer le brouillon", { exact: true }).tap();
  await expect(panel.getByText("Brouillons créés", { exact: true })).toBeVisible();
  await expect(panel.getByRole("listitem").filter({ hasText: "Quantité transférée :" })).toHaveCount(4);
  const after = await preview(browser, fixture, army);
  expect(after.summary).toMatchObject({ total_supplier_lines: 4, draftable_lines: 0, transferred_lines: 4, blocked_lines: 0 });
  await assertCounts(browser, army, "readiness-created-before-reload", after.summary, "Déjà préparé");
  await expect(panel.getByRole("button", /^Créer/)).toHaveCount(0);
  const orderIds = [...new Set(after.transferred_lines.map((line) => line.purchase_order_id))];
  expect(orderIds).toHaveLength(2);
  const createdId = orderIds.find((id) => id !== fixture.noteOrderId)!;
  const order = await apiRequest<Envelope<{ items: Array<Record<string, unknown>>; orders: Array<Record<string, unknown>> }>>(
    browser, "GET", `/api/orders?view=items&order_id=${createdId}`);
  expect(order.status).toBe(200);
  expect(order.body.data.orders).toEqual([expect.objectContaining({ id: createdId, total_ht_cents: 1636, total_tax_cents: 327, total_ttc_cents: 1963 })]);
  expect(order.body.data.items).toHaveLength(3);
  for (const line of fixture.lines.filter((line) => line.label !== "integer")) {
    expect(order.body.data.items.find((item) => item.source_estimate_item_id === line.lineId)).toMatchObject({
      reference: line.reference, product_id: line.productId, source_selected_supplier_price_id: line.priceId,
      quantity: line.quantity, unit: "m", price_unit: "m", unit_price_ht_cents: line.price,
      line_total_ht_cents: line.ht, line_tax_cents: line.tax, line_total_ttc_cents: line.ttc,
    });
  }
  await app.open(href);
  await expect(panel.getByRole("listitem").filter({ hasText: "Quantité transférée :" })).toHaveCount(4);
  await assertCounts(browser, army, "readiness-created-after-reload", (await preview(browser, fixture, army)).summary, "Déjà préparé");
  await expect(panel.getByRole("button", /^Créer/)).toHaveCount(0);
  const finalSource = await readEstimate(browser, fixture.versionId);
  await recordEvidence(army, "readiness-persisted", { source, finalSource, after, order, requests: fixture.requests });
  expect(sourceValues(finalSource)).toEqual(sourceValues(source));
  expect(fixture.requests.filter((request) => request.pathname === endpoint && request.method === "POST")).toHaveLength(1);
});

for (const failure of ["unavailable", "inconsistent-counts"] as const) {
  failureTest(`local purchase readiness ${failure} hides stale claims until canonical preview recovers`, {
    session: "army", tags: ["critical", "local", "business-corpus"], trace: "off", timeout: 150_000,
  }, async ({ app, screen, browser, fixture, army }) => {
    const href = `/dashboard/affaires/${fixture.projectId}`;
    const panel = browser.locator("#finish-line-orders");
    await app.open(href);
    const real = await preview(browser, fixture, army);
    expect(real.summary).toMatchObject({ total_supplier_lines: 4, draftable_lines: 3, transferred_lines: 1, blocked_lines: 0 });
    fixture.responseOverride = failure === "unavailable"
      ? { status: 503, body: { ok: false, error: { code: "ARMY_PREVIEW_UNAVAILABLE", message: "ARMY simulated browser preview failure" } } }
      : { status: 200, body: { ok: true, data: { ...real, summary: { ...real.summary, draftable_lines: real.summary.draftable_lines + 1 } } } };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fulfilled = new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("No readiness preview override was actually fulfilled.")), 15_000);
      fixture.onOverride = () => { clearTimeout(timer); resolve(); };
    });
    try { await Promise.all([fulfilled, app.open(href)]); }
    finally { clearTimeout(timer); fixture.onOverride = undefined; }
    await recordEvidence(army, `readiness-${failure}-before-recovery-wait`, {
      real, injected: fixture.responseOverride, completedOverrides: fixture.completedOverrides, observed: await surfaces(browser),
      proofBoundary: "Browser GET response only; captured before any recovery-control assertion.",
    });
    const reload = panel.getByRole("button", "Recharger la préparation", { exact: true });
    await expect.soft(reload).toBeVisible();
    const observed = await surfaces(browser);
    await recordEvidence(army, `readiness-${failure}`, { real, injected: fixture.responseOverride, observed,
      proofBoundary: "Browser GET response only; this does not inject an internal server read failure." });
    for (const surface of [observed.card, observed.panel]) {
      expect.soft(surface.badge).toBe("Indisponible");
      expect.soft(surface.text).toContain(unavailableMessage);
      expect.soft(surface.text.includes(countText(real.summary))).toBe(false);
      expect.soft(surface.text.includes("sont déjà commandables")).toBe(false);
    }
    await expect.soft(panel.getByRole("button", /^Créer/)).toHaveCount(0);
    fixture.responseOverride = null;
    // The baseline may omit the required recovery action; retain that failure,
    // then use an ordinary navigation to preserve the remaining read-only proof.
    if (await reload.count() === 1) await screen.getByRole("button", "Recharger la préparation", { exact: true }).tap();
    else await app.open(href);
    await expect(panel.getByRole("button", "Recharger la préparation", { exact: true })).toHaveCount(0);
    await expect(panel.getByRole("listitem").filter({ hasText: "Quantité transférée :" })).toHaveCount(real.summary.transferred_lines);
    await expect(panel.getByRole("rowheader")).toHaveCount(real.summary.draftable_lines);
    const recovered = await preview(browser, fixture, army);
    expect(recovered.summary).toEqual(real.summary);
    await assertCounts(browser, army, `readiness-${failure}-recovered`, recovered.summary,
      recovered.summary.blocked_lines > 0 ? "Partiellement prêt" : recovered.summary.draftable_lines > 0 ? "Prêt" : "Déjà préparé");
    const mutations = fixture.requests.filter((request) => !["GET", "HEAD", "OPTIONS"].includes(request.method));
    await recordEvidence(army, `readiness-${failure}-no-write`, { recovered, mutations });
    expect(mutations).toEqual([]);
  });
}
