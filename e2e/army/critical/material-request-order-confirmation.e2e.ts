import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Browser } from "@e2e-dev/web";
import { expect } from "e2e";

import {
  apiRequest,
  armyTest,
  createEstimateViaWizard,
  ownEstimate,
  recordEvidence,
  type ArmyState,
} from "./fixtures";

type Ui = Parameters<typeof createEstimateViaWizard>[0];

type Envelope<T> = { ok: boolean; data: T; error?: { code: string; message: string } };
type Line = { id: string; status: string; unit_price_ht_cents: number | null; price_per: number };
type Created = { orders: Array<{ id: string; reference: string; total_ht_cents: number }>; replayed: boolean };
type Item = {
  id: string; material_request_line_id?: string | null; quantity: number; unit_price_ht_cents: number; price_per?: number;
  line_total_ht_cents: number;
};
type OrderHeader = { id: string; status: string; total_ht_cents: number; edit_revision: number; expected_delivery_date: string | null };
type Document = { id: string; name: string };
type SupplyCostRow = { kind: string; budget_cents: number | null; ordered_cents: number; pending_cents: number };
type SupplyCost = {
  budget_version: unknown; rows: SupplyCostRow[];
  totals: { budget_cents: number | null; ordered_cents: number; pending_cents: number };
};

// TI-691, lot 2 « l'achat », delivery 3b-1 « commander et recevoir ». Failure modes, written before the journeys were
// first run against the product:
// - the order is confirmed at the quote's price instead of the price the supplier confirmed, or a price for 100 units
//   is multiplied as if it were for one;
// - the order is confirmed without the supplier's confirmation joined to it, or the proof can be deleted afterwards;
// - the request line loses the quote's price when the order takes the real one;
// - a confirmed order still offers to be confirmed, or its reception is not offered;
// - the reception is not dated, its note for what is still to come is lost, it is recorded twice, or the received order
//   can still be deleted.
// TI-691, delivery 4 « coût par affaire »:
// - the affaire's supply cost shows a budget while its client has accepted no version, or loses an order line without
//   article instead of putting it under « non classé »;
// - a draft counts as ordered, or a confirmed order stays « en cours » at its quote's price instead of its real one.

/** A one-page PDF with a line of invented text, as a supplier's acknowledgement would be. */
function inventedPdf(text: string): Buffer {
  const content = `BT /F1 14 Tf 24 100 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 160] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

/** Today in Paris, as the database dates an order and a reception: AAAA-MM-JJ, and JJ/MM/AAAA as the screen writes it. */
function parisToday() {
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date());
  return { iso, shown: `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` };
}

/**
 * The state both journeys start from, arranged through the API: an affaire of its own, a request of 10 elbows and 125
 * screws quoted by one invented supplier (11,50 € each, 3,42 € the hundred), retained, and its draft order.
 */
async function draftOrderOfAnAffaire(ui: Ui, army: ArmyState, label: string) {
  const { browser } = ui;
  const ids = await createEstimateViaWizard(ui, { projectName: army.projectName, title: `${army.runPrefix} ${label}` }, army);
  ownEstimate(army, ids);
  const base = `/api/affaires/${ids.projectId}/material-requests`;
  const supplierName = `${army.runPrefix} Négoce ${label}`;
  const supplier = await apiRequest<Envelope<{ item: { id: string } }>>(browser, "POST", "/api/suppliers", {
    action: "create", item: { name: supplierName, is_active: true },
  });
  expect(supplier.status, JSON.stringify(supplier.body.error ?? null)).toBe(201);
  const created = await apiRequest<Envelope<{ request: { id: string } }>>(browser, "POST", base, {
    source_text: "Demande inventée", delivery_place: "site",
  });
  expect(created.status, JSON.stringify(created.body.error ?? null)).toBe(201);
  const requestId = created.body.data.request.id;
  const one = `${base}/${requestId}`;
  const added = await apiRequest<Envelope<{ lines: Line[] }>>(browser, "POST", `${one}/lines`, {
    lines: [
      { original_text: "10 coudes inox 50", quantity: 10, unit: "u", product_type: "Coude 90°", dimension: "DN 50", material: "Inox 316L" },
      { original_text: "125 vis M10", quantity: 125, unit: "u", product_type: "Vis tête hexagonale", dimension: "M10", material: "Acier zingué" },
    ],
  });
  expect(added.status, JSON.stringify(added.body.error ?? null)).toBe(201);
  const [elbows, screws] = added.body.data.lines.map((line) => line.id);
  const validated = await apiRequest<Envelope<{ lines: Line[] }>>(browser, "POST", `${one}/lines/validate`, { ids: [elbows, screws] });
  expect(validated.status, JSON.stringify(validated.body.error ?? null)).toBe(200);
  const asked = await apiRequest<Envelope<{ item: { id: string } }>>(browser, "POST", `${one}/quotes`, {
    supplier_id: supplier.body.data.item.id, line_ids: [elbows, screws], with_references: false, message: "Demande de prix inventée",
  });
  expect(asked.status, JSON.stringify(asked.body.error ?? null)).toBe(201);
  const quoteId = asked.body.data.item.id;
  const priced = await apiRequest<Envelope<unknown>>(browser, "PATCH", `${one}/quotes/${quoteId}`, {
    received: true, lines: [
      { line_id: elbows, unit_price_ht_cents: 1150, price_per: 1 },
      { line_id: screws, unit_price_ht_cents: 342, price_per: 100 },
    ],
  });
  expect(priced.status, JSON.stringify(priced.body.error ?? null)).toBe(200);
  const retained = await apiRequest<Envelope<unknown>>(browser, "POST", `${one}/quotes/${quoteId}/retain`);
  expect(retained.status, JSON.stringify(retained.body.error ?? null)).toBe(200);
  const ordered = await apiRequest<Envelope<Created>>(browser, "POST", `${one}/orders`, { idempotency_key: randomUUID() });
  expect(ordered.status, JSON.stringify(ordered.body.error ?? null)).toBe(201);
  const [order] = ordered.body.data.orders;
  // 10 × 11,50 € + 125 × 3,42 € ÷ 100 = 115,00 € + 4,275 € → 4,28 €.
  expect(order.total_ht_cents).toBe(11500 + 428);
  (army.ownedPurchaseOrders ??= []).push({ orderId: order.id, projectId: ids.projectId, versionId: ids.versionId });
  return { ids, requestId, one, elbows, screws, order, supplierName };
}

async function readOrder(browser: Browser, orderId: string) {
  const response = await apiRequest<Envelope<{ orders: OrderHeader[]; items: Item[] }>>(
    browser, "GET", `/api/orders?view=items&order_id=${orderId}`,
  );
  expect(response.status, JSON.stringify(response.body.error ?? null)).toBe(200);
  return { header: response.body.data.orders[0], items: response.body.data.items };
}

async function documentsOf(browser: Browser, orderId: string) {
  const response = await apiRequest<{ items: Document[] }>(browser, "GET", `/api/purchase-orders/${orderId}/devis`);
  expect(response.status).toBe(200);
  return response.body.items;
}

armyTest(
  "MR07 a draft order of an affaire is confirmed at the price the supplier confirmed, with its confirmation as proof",
  { session: "army", tags: ["critical", "material-requests"], timeout: 300_000 },
  async ({ app, screen, browser, army }) => {
    const { requestId, one, screws, order } = await draftOrderOfAnAffaire({ app, screen, browser }, army, "confirmation");
    const today = parisToday();

    // The supplier confirms the screws at 3,52 € the hundred (the quote said 3,42 €), with its acknowledgement.
    await browser.goto(`/dashboard/orders/${order.id}`, { waitUntil: "domcontentloaded" });
    await screen.getByRole("button", "Confirmer la commande…", { exact: true }).tap({ timeout: 60_000 });
    const dialog = screen.getByRole("dialog", `Confirmer la commande ${order.reference}`, { exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Prix réel HT, ligne 2", { exact: true })).toHaveValue("3.42");
    await dialog.getByLabel("Prix réel HT, ligne 2", { exact: true }).fill("3,52");
    // 10 × 11,50 € + 125 × 3,52 € ÷ 100 = 115,00 € + 4,40 €.
    await expect(dialog.getByText(/^119,40\s€$/)).toBeVisible();
    await dialog.getByLabel("Référence du fournisseur", { exact: true }).fill("AR-4471");
    const directory = path.resolve(".e2e/army/critical/artifacts/fixtures", army.runPrefix);
    await mkdir(directory, { recursive: true });
    const proofPath = path.join(directory, "accuse-reception.pdf");
    await writeFile(proofPath, inventedPdf("Accuse de reception invente AR-4471 : vis 3,52 les 100"));
    await browser.locator('[role="dialog"] input[type="file"]').first().setInputFiles([proofPath]);
    await dialog.getByRole("button", "Confirmer la commande", { exact: true }).tap();

    // The page says how the order was passed; the order holds the real price and its total.
    await expect(screen.getByText(
      `Commandée le ${today.shown} · référence du fournisseur AR-4471 · preuve : Confirmation de commande`, { exact: true },
    )).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole("button", "Confirmer la commande…", { exact: true })).toHaveCount(0);
    await expect(screen.getByRole("button", "Enregistrer la réception…", { exact: true })).toBeVisible();
    const confirmed = await readOrder(browser, order.id);
    expect([confirmed.header.status, confirmed.header.total_ht_cents]).toEqual(["confirmed", 11500 + 440]);
    const screwItem = confirmed.items.find((item) => item.material_request_line_id === screws)!;
    expect([screwItem.unit_price_ht_cents, screwItem.price_per, screwItem.line_total_ht_cents]).toEqual([352, 100, 440]);

    // The proof is joined to the order and stays: its deletion is refused, the file is still there.
    const [proof] = (await documentsOf(browser, order.id)).filter((document) => document.name === "Confirmation de commande");
    expect(proof).toBeDefined();
    const deletion = await apiRequest<{ error?: string }>(browser, "DELETE", `/api/purchase-orders/${order.id}/devis/${proof.id}`);
    expect([deletion.status, deletion.body.error]).toEqual([409, "Ce document prouve la commande confirmée : il ne peut pas être supprimé."]);
    expect((await documentsOf(browser, order.id)).map((document) => document.id)).toContain(proof.id);

    // The request line keeps the quote's price; the request sees its order confirmed.
    const detail = await apiRequest<Envelope<{ lines: Line[] }>>(browser, "GET", one);
    const requestScrews = detail.body.data.lines.find((line) => line.id === screws)!;
    expect([requestScrews.unit_price_ht_cents, requestScrews.price_per]).toEqual([342, 100]);
    const summary = await apiRequest<Envelope<{ orders: Array<{ id: string; status: string }> }>>(browser, "GET", `${one}/orders`);
    expect(summary.body.data.orders.map((entry) => [entry.id, entry.status])).toEqual([[order.id, "confirmed"]]);

    await recordEvidence(army, "material-request-order-confirmation", {
      requestId, orderId: order.id, reference: order.reference, status: confirmed.header.status,
      total_ht_cents: confirmed.header.total_ht_cents, screws: { unit_price_ht_cents: 352, price_per: 100, line_total_ht_cents: 440 },
      proof_deletion_status: deletion.status,
    });
  },
);

armyTest(
  "MR08 a confirmed order of an affaire is received whole on a date, with a note for what is still to come",
  { session: "army", tags: ["critical", "material-requests"], timeout: 300_000 },
  async ({ app, screen, browser, army }) => {
    const { requestId, order } = await draftOrderOfAnAffaire({ app, screen, browser }, army, "réception");
    const today = parisToday();

    // Arranged through the API: the acknowledgement joined, the order confirmed at the quote's prices today.
    const pdf = inventedPdf("Accuse de reception invente");
    const uploaded = await browser.evaluate(async ({ orderId, bytes }) => {
      const form = new FormData();
      form.set("file", new File([new Uint8Array(bytes)], "accuse.pdf", { type: "application/pdf" }));
      form.set("name", "Accusé de réception");
      const response = await fetch(`/api/purchase-orders/${orderId}/devis`, { method: "POST", body: form, credentials: "same-origin" });
      return { status: response.status, body: await response.json() as { item?: { id: string } } };
    }, { orderId: order.id, bytes: [...pdf] });
    expect(uploaded.status).toBe(201);
    const draft = await readOrder(browser, order.id);
    const confirmation = await apiRequest<Envelope<{ status: string }>>(browser, "POST", `/api/purchase-orders/${order.id}/confirmation`, {
      expected_revision: draft.header.edit_revision, ordered_on: today.iso, document_id: uploaded.body.item!.id, lines: [],
    });
    expect([confirmation.status, confirmation.body.data?.status]).toEqual([200, "confirmed"]);

    // The goods come today, but 25 screws are still to come.
    await browser.goto(`/dashboard/orders/${order.id}`, { waitUntil: "domcontentloaded" });
    await screen.getByRole("button", "Enregistrer la réception…", { exact: true }).tap({ timeout: 60_000 });
    const dialog = screen.getByRole("dialog", `Réception de ${order.reference}`, { exact: true });
    await expect(dialog.getByLabel("Date de réception", { exact: true })).toHaveValue(today.iso);
    await dialog.getByLabel("Reste à venir (facultatif)", { exact: true }).fill("Reliquat : 25 vis à suivre");
    await dialog.getByRole("button", "Enregistrer la réception", { exact: true }).tap();

    await expect(screen.getByText(`Reçue le ${today.shown} · reste à venir : Reliquat : 25 vis à suivre`, { exact: true }))
      .toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole("button", "Enregistrer la réception…", { exact: true })).toHaveCount(0);
    const received = await readOrder(browser, order.id);
    expect([received.header.status, received.header.total_ht_cents]).toEqual(["received", 11500 + 428]);

    // Received once, and kept: a second reception and the deletion are refused.
    const again = await apiRequest<Envelope<never>>(browser, "POST", `/api/purchase-orders/${order.id}/reception`, {
      expected_revision: received.header.edit_revision, received_on: today.iso,
    });
    expect([again.status, again.body.error?.code]).toEqual([409, "PURCHASE_ORDER_RECEPTION_NOT_CONFIRMED"]);
    const deletion = await apiRequest<unknown>(browser, "DELETE", `/api/purchase-orders/${order.id}`);
    expect(deletion.status).not.toBe(200);
    expect((await readOrder(browser, order.id)).header.status).toBe("received");

    await recordEvidence(army, "material-request-order-reception", {
      requestId, orderId: order.id, reference: order.reference, status: received.header.status,
      second_reception: again.body.error?.code, deletion_status: deletion.status,
    });
  },
);

armyTest(
  "MR09 an affaire's supply cost shows its draft order « en cours », then « commandé » at the price the supplier confirmed",
  { session: "army", tags: ["critical", "material-requests"], timeout: 300_000 },
  async ({ app, screen, browser, army }) => {
    const { ids, requestId, screws, order } = await draftOrderOfAnAffaire({ app, screen, browser }, army, "coût");
    const today = parisToday();
    const costPath = `/api/affaires/${ids.projectId}/supply-cost`;

    // The estimate is a draft: no budget. The draft order (119,28 € at the quote's prices) is « en cours », under
    // « non classé » since its lines have no article.
    const before = await apiRequest<Envelope<SupplyCost>>(browser, "GET", costPath);
    expect(before.status, JSON.stringify(before.body.error ?? null)).toBe(200);
    expect(before.body.data.budget_version).toBeNull();
    expect(before.body.data.rows.map((row) => [row.kind, row.budget_cents, row.ordered_cents, row.pending_cents]))
      .toEqual([["unclassified", null, 0, 11928]]);
    await browser.goto(`/dashboard/affaires/${ids.projectId}/demandes-materiel`, { waitUntil: "domcontentloaded" });
    const section = screen.getByRole("region", "Coût des fournitures", { exact: true });
    await expect(section.getByText("Budget en attente du devis accepté : le commandé et l’en-cours sont affichés sans budget.", { exact: true }))
      .toBeVisible({ timeout: 60_000 });
    const table = section.getByRole("table", "Budget et commandé par type de fourniture", { exact: true });
    await expect(table.getByRole("row", /^Non classé\s+—\s+0,00\s€\s+119,28\s€\s+—$/)).toBeVisible();

    // Arranged through the API: the acknowledgement joined, the order confirmed with the screws at 3,52 € the hundred
    // (the quote said 3,42 €).
    const pdf = inventedPdf("Accuse de reception invente : vis 3,52 les 100");
    const uploaded = await browser.evaluate(async ({ orderId, bytes }) => {
      const form = new FormData();
      form.set("file", new File([new Uint8Array(bytes)], "accuse.pdf", { type: "application/pdf" }));
      form.set("name", "Accusé de réception");
      const response = await fetch(`/api/purchase-orders/${orderId}/devis`, { method: "POST", body: form, credentials: "same-origin" });
      return { status: response.status, body: await response.json() as { item?: { id: string } } };
    }, { orderId: order.id, bytes: [...pdf] });
    expect(uploaded.status).toBe(201);
    const draft = await readOrder(browser, order.id);
    const screwItem = draft.items.find((item) => item.material_request_line_id === screws)!;
    const confirmation = await apiRequest<Envelope<{ status: string }>>(browser, "POST", `/api/purchase-orders/${order.id}/confirmation`, {
      expected_revision: draft.header.edit_revision, ordered_on: today.iso, document_id: uploaded.body.item!.id,
      lines: [{ id: screwItem.id, unit_price_ht_cents: 352, price_per: 100 }],
    });
    expect([confirmation.status, confirmation.body.data?.status]).toEqual([200, "confirmed"]);

    // The confirmed order is « commandé » at its real price, 115,00 € + 4,40 €; nothing is left « en cours ».
    await browser.goto(`/dashboard/affaires/${ids.projectId}/demandes-materiel`, { waitUntil: "domcontentloaded" });
    await expect(table.getByRole("row", /^Non classé\s+—\s+119,40\s€\s+0,00\s€\s+—$/)).toBeVisible({ timeout: 60_000 });
    await expect(table.getByRole("row", /^Total HT\s+—\s+119,40\s€\s+0,00\s€\s+—$/)).toBeVisible();
    const after = await apiRequest<Envelope<SupplyCost>>(browser, "GET", costPath);
    expect(after.body.data.totals).toEqual({ budget_cents: null, ordered_cents: 11940, pending_cents: 0 });

    await recordEvidence(army, "affaire-supply-cost", {
      requestId, orderId: order.id, before: before.body.data.totals, after: after.body.data.totals,
    });
  },
);
