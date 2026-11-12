import { randomUUID } from "node:crypto";

import type { Browser } from "@e2e-dev/web";
import { expect } from "e2e";

import {
  apiRequest,
  armyTest,
  createEstimateViaWizard,
  ownEstimate,
  recordEvidence,
} from "./fixtures";

type Envelope<T> = { ok: boolean; data: T; error?: { code: string; message: string } };
type Line = { id: string; position: number; status: string; supplier_id: string | null; price_quote_id: string | null };
type Detail = { request: { id: string; requested_on: string }; lines: Line[] };
type Summary = {
  ready_line_ids: string[];
  not_ready: Array<{ line_id: string; reason: string }>;
  ordered: Array<{ line_id: string; purchase_order_id: string; purchase_order_reference: string; status: string }>;
  orders: Array<{ id: string; reference: string; supplier_name: string; status: string; total_ht_cents: number; line_count: number }>;
};
type Created = { orders: Array<{ id: string; reference: string; supplier_name: string; line_count: number; total_ht_cents: number }>; replayed: boolean };
type Item = {
  id: string; designation: string; quantity: number; unit_price_ht_cents: number; line_total_ht_cents: number;
  price_per?: number; line_kind?: string; imputation?: string; overhead_category?: string | null;
  material_request_line_id?: string | null;
};
type OrderHeader = { id: string; total_ht_cents: number; project_id?: string | null; delivery_mode?: string | null };

// TI-691, lot 2 « l'achat », delivery 3a « bons de commande depuis les demandes ». Failure modes, written before the
// journey was first run against the product:
// - the lines of two suppliers' retained quotes go into one order, or one supplier's lines into two;
// - the overhead line is left out, put in an order of its own, or imputed to the affaire;
// - a price given for 100 units is multiplied as if it were for one, or rounded otherwise than half away from zero
//   to the cent; a total is not in integer cents;
// - a double click, or a retry of the same creation, creates a second set of drafts;
// - a shipping line added on a draft does not count in its total;
// - the printed order of a draft without a site shows an empty address instead of how it is delivered.

/** Records each body the page sends to create the drafts; the request itself is the page's. */
async function observeCreations(browser: Browser) {
  const installed = await browser.evaluate(() => {
    const scope = window as typeof window & { __orderCreations?: string[] };
    if (scope.__orderCreations) return true;
    const bodies: string[] = [];
    scope.__orderCreations = bodies;
    const original = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if ((init?.method ?? "GET") === "POST" && /\/material-requests\/[0-9a-f-]{36}\/orders$/i.test(url)) {
        bodies.push(typeof init?.body === "string" ? init.body : "");
      }
      return original(input, init);
    };
    return true;
  });
  if (!installed) throw new Error("Creation observation is missing.");
  return () => browser.evaluate(() => {
    const bodies = (window as typeof window & { __orderCreations?: string[] }).__orderCreations;
    if (!bodies) throw new Error("Creation observation is missing.");
    return bodies;
  });
}

armyTest(
  "MR06 the lines priced by two suppliers' retained quotes become one draft per supplier, the overhead line in its supplier's draft, created once; a shipping line counts in its total and the print says how it is delivered",
  { session: "army", tags: ["critical", "material-requests"], timeout: 300_000 },
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const ids = await createEstimateViaWizard(ui, {
      projectName: army.projectName,
      title: `${army.runPrefix} commandes`,
    }, army);
    ownEstimate(army, ids);
    const base = `/api/affaires/${ids.projectId}/material-requests`;

    // Invented suppliers.
    const supplier = async (name: string) => {
      const response = await apiRequest<Envelope<{ item: { id: string } }>>(browser, "POST", "/api/suppliers", {
        action: "create", item: { name, is_active: true },
      });
      expect(response.status, JSON.stringify(response.body.error ?? null)).toBe(201);
      return response.body.data.item.id;
    };
    const alphaName = `${army.runPrefix} Négoce Alpha`;
    const betaName = `${army.runPrefix} Comptoir Bêta`;
    const alpha = await supplier(alphaName);
    const beta = await supplier(betaName);

    // A request delivered on site: elbows and screws for the affaire, gloves for overhead (PPE).
    const created = await apiRequest<Envelope<Detail>>(browser, "POST", base, {
      source_text: "Demande inventée", delivery_place: "site",
    });
    expect(created.status, JSON.stringify(created.body.error ?? null)).toBe(201);
    const requestId = created.body.data.request.id;
    const requestedOn = created.body.data.request.requested_on;
    const one = `${base}/${requestId}`;
    const added = await apiRequest<Envelope<{ lines: Line[] }>>(browser, "POST", `${one}/lines`, {
      lines: [
        { original_text: "10 coudes inox 50", quantity: 10, unit: "u", product_type: "Coude 90°", dimension: "DN 50", material: "Inox 316L" },
        { original_text: "125 vis M10", quantity: 125, unit: "u", product_type: "Vis tête hexagonale", dimension: "M10", material: "Acier zingué" },
        { original_text: "10 paires de gants", quantity: 10, unit: "paire", product_type: "Gants de manutention", no_dimension: true, imputation: "overhead", overhead_category: "EPI" },
      ],
    });
    expect(added.status, JSON.stringify(added.body.error ?? null)).toBe(201);
    const [elbows, screws, gloves] = added.body.data.lines.map((line) => line.id);
    const validated = await apiRequest<Envelope<{ lines: Line[] }>>(browser, "POST", `${one}/lines/validate`, {
      ids: [elbows, screws, gloves],
    });
    expect([validated.status, validated.body.data.lines.map((line) => line.status)]).toEqual([200, ["validated", "validated", "validated"]]);

    // Alpha quotes the elbows and the gloves; Bêta the screws, for 100 (3,42 € the hundred). Both retained.
    const quote = async (supplierId: string, lineIds: string[], prices: Array<{ line_id: string; unit_price_ht_cents: number; price_per: number }>) => {
      const asked = await apiRequest<Envelope<{ item: { id: string } }>>(browser, "POST", `${one}/quotes`, {
        supplier_id: supplierId, line_ids: lineIds, with_references: false, message: "Demande de prix inventée",
      });
      expect(asked.status, JSON.stringify(asked.body.error ?? null)).toBe(201);
      const quoteId = asked.body.data.item.id;
      const priced = await apiRequest<Envelope<unknown>>(browser, "PATCH", `${one}/quotes/${quoteId}`, { received: true, lines: prices });
      expect(priced.status, JSON.stringify(priced.body.error ?? null)).toBe(200);
      const retained = await apiRequest<Envelope<unknown>>(browser, "POST", `${one}/quotes/${quoteId}/retain`);
      expect(retained.status, JSON.stringify(retained.body.error ?? null)).toBe(200);
      return quoteId;
    };
    await quote(alpha, [elbows, gloves], [
      { line_id: elbows, unit_price_ht_cents: 1150, price_per: 1 },
      { line_id: gloves, unit_price_ht_cents: 420, price_per: 1 },
    ]);
    await quote(beta, [screws], [{ line_id: screws, unit_price_ht_cents: 342, price_per: 100 }]);
    const summary = async () => {
      const response = await apiRequest<Envelope<Summary>>(browser, "GET", `${one}/orders`);
      expect(response.status, JSON.stringify(response.body.error ?? null)).toBe(200);
      return response.body.data;
    };
    expect(await summary()).toEqual({ ready_line_ids: [elbows, screws, gloves], not_ready: [], ordered: [], orders: [] });

    // One double click: one creation, under one key.
    const page = `/dashboard/affaires/${ids.projectId}/demandes-materiel/${requestId}`;
    await browser.goto(page, { waitUntil: "domcontentloaded" });
    const create = screen.getByRole("button", "Créer les brouillons de commande (3)", { exact: true });
    await expect(create).toBeEnabled({ timeout: 60_000 });
    await expect(screen.getByText("3 lignes prêtes à commander.", { exact: true })).toBeVisible();
    const creations = await observeCreations(browser);
    await create.doubleTap();
    const list = screen.getByRole("list", "Bons de commande de la demande", { exact: true });
    await expect(list).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByText("Aucune ligne prête à commander.", { exact: true })).toBeVisible({ timeout: 30_000 });
    const bodies = await creations();
    expect(bodies).toHaveLength(1);
    const key = (JSON.parse(bodies[0]) as { idempotency_key: string }).idempotency_key;
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    // One draft per supplier; the gloves in Alpha's, the screws at 125 × 3,42 € ÷ 100 = 4,275 € → 4,28 €.
    const after = await summary();
    expect(after.ready_line_ids).toEqual([]);
    expect(after.orders).toHaveLength(2);
    const orderOf = (name: string) => after.orders.find((order) => order.supplier_name === name)!;
    const alphaOrder = orderOf(alphaName);
    const betaOrder = orderOf(betaName);
    expect([alphaOrder.status, alphaOrder.line_count, alphaOrder.total_ht_cents]).toEqual(["draft", 2, 10 * 1150 + 10 * 420]);
    expect([betaOrder.status, betaOrder.line_count, betaOrder.total_ht_cents]).toEqual(["draft", 1, 428]);
    expect(after.ordered.map((entry) => [entry.line_id, entry.purchase_order_id])).toEqual([
      [elbows, alphaOrder.id], [screws, betaOrder.id], [gloves, alphaOrder.id],
    ]);
    await expect(list.getByRole("link", alphaOrder.reference, { exact: true })).toHaveAttribute("href", `/dashboard/orders/${alphaOrder.id}`);
    await expect(screen.getByRole("link", `Commandé : ${alphaOrder.reference}`, { exact: true })).toHaveCount(2);
    await expect(screen.getByRole("link", `Commandé : ${betaOrder.reference}`, { exact: true })).toBeVisible();
    await expect(screen.getByRole("button", "Créer les brouillons de commande (0)", { exact: true })).toBeDisabled();

    // The same creation sent again answers what it made; a new one finds nothing left to order.
    const replay = await apiRequest<Envelope<Created>>(browser, "POST", `${one}/orders`, { idempotency_key: key });
    expect([replay.status, replay.body.data.replayed, replay.body.data.orders.map((order) => order.id).sort()]).toEqual([
      200, true, [alphaOrder.id, betaOrder.id].sort(),
    ]);
    const again = await apiRequest<Envelope<never>>(browser, "POST", `${one}/orders`, { idempotency_key: randomUUID() });
    expect([again.status, again.body.error?.code]).toEqual([422, "MATERIAL_REQUEST_ORDER_NOTHING_READY"]);
    expect((await summary()).orders.map((order) => order.id).sort()).toEqual([alphaOrder.id, betaOrder.id].sort());

    const items = async (orderId: string) => {
      const response = await apiRequest<Envelope<{ orders: OrderHeader[]; items: Item[] }>>(
        browser, "GET", `/api/orders?view=items&order_id=${orderId}`,
      );
      expect(response.status, JSON.stringify(response.body.error ?? null)).toBe(200);
      return response.body.data;
    };
    const alphaItems = (await items(alphaOrder.id)).items;
    const byLine = (lineId: string) => alphaItems.find((item) => item.material_request_line_id === lineId)!;
    expect([byLine(elbows).imputation, byLine(elbows).line_total_ht_cents]).toEqual(["project", 11500]);
    expect([byLine(gloves).imputation, byLine(gloves).overhead_category, byLine(gloves).line_total_ht_cents]).toEqual([
      "overhead", "EPI", 4200,
    ]);
    const [screwItem] = (await items(betaOrder.id)).items;
    expect([screwItem.material_request_line_id, screwItem.quantity, screwItem.unit_price_ht_cents, screwItem.price_per, screwItem.line_total_ht_cents])
      .toEqual([screws, 125, 342, 100, 428]);

    // The draft says where each line comes from, what it is imputed to, and the price for the lot.
    const day = `${requestedOn.slice(8, 10)}/${requestedOn.slice(5, 7)}`;
    await browser.goto(`/dashboard/orders/${alphaOrder.id}`, { waitUntil: "domcontentloaded" });
    await expect(screen.getByRole("link", `Demande du ${day}, ligne 3`, { exact: true })).toHaveAttribute("href", page, { timeout: 60_000 });
    await expect(screen.getByText("Frais généraux · EPI", { exact: true })).toBeVisible();
    await expect(screen.getByRole("link", `Affaire : ${army.projectName}`, { exact: true })).toHaveAttribute(
      "href", `/dashboard/affaires/${ids.projectId}`,
    );
    await browser.goto(`/dashboard/orders/${betaOrder.id}`, { waitUntil: "domcontentloaded" });
    await expect(screen.getByText(/^3,42\s€ les 100$/)).toBeVisible({ timeout: 60_000 });

    // The office adds Bêta's shipping, 15 €, on the draft: it counts in the total, the screws stay as quoted.
    (army.ownedPurchaseOrders ??= []).push(
      { orderId: alphaOrder.id, projectId: ids.projectId, versionId: ids.versionId },
      { orderId: betaOrder.id, projectId: ids.projectId, versionId: ids.versionId },
    );
    await browser.goto(`/dashboard/orders/${betaOrder.id}/edit`, { waitUntil: "domcontentloaded" });
    await screen.getByRole("button", "+ Ajouter un port", { exact: true }).tap({ timeout: 60_000 });
    await screen.getByLabel("Désignation, ligne 2", { exact: true }).fill("Frais de port");
    await screen.getByLabel("Montant HT, ligne 2", { exact: true }).fill("15");
    await screen.getByRole("button", "Enregistrer", { exact: true }).tap();
    await expect(browser).toHaveURL(new RegExp(`/dashboard/orders/${betaOrder.id}$`), { timeout: 30_000 });
    await expect.poll(async () => (await items(betaOrder.id)).orders[0]?.total_ht_cents, { timeout: 30_000 }).toBe(428 + 1500);
    const shipped = (await items(betaOrder.id)).items;
    expect(shipped).toHaveLength(2);
    const kept = shipped.find((item) => item.id === screwItem.id)!;
    expect([kept.line_kind, kept.material_request_line_id, kept.unit_price_ht_cents, kept.price_per, kept.line_total_ht_cents]).toEqual([
      "article", screws, 342, 100, 428,
    ]);
    const port = shipped.find((item) => item.id !== screwItem.id)!;
    expect([port.line_kind, port.designation, port.quantity, port.unit_price_ht_cents, port.line_total_ht_cents, port.imputation]).toEqual([
      "shipping", "Frais de port", 1, 1500, 1500, "project",
    ]);
    expect((await summary()).orders.find((order) => order.id === betaOrder.id)?.total_ht_cents).toBe(1928);

    // Printed for the supplier: how it is delivered, in place of an address; the price for the lot.
    await browser.goto(`/dashboard/orders/${betaOrder.id}/print`, { waitUntil: "domcontentloaded" });
    await expect(screen.getByText("Livraison sur chantier", { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByText(/^3,42\s€ les 100$/)).toBeVisible();
    await expect(screen.getByText("Port", { exact: true })).toBeVisible();
    await expect(screen.getByText(/Demande du/)).toHaveCount(0);

    await recordEvidence(army, "material-request-orders", {
      ...ids, requestId, suppliers: { alpha, beta }, lines: { elbows, screws, gloves },
      creations: bodies.length,
      orders: (await summary()).orders.map((order) => ({
        id: order.id, supplier_name: order.supplier_name, status: order.status, total_ht_cents: order.total_ht_cents, line_count: order.line_count,
      })),
      replay: { status: replay.status, replayed: replay.body.data.replayed },
    });
  },
);
