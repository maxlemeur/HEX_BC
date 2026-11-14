import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Browser } from "@e2e-dev/web";
import { expect } from "e2e";

import type { AffaireSupplyCost as SupplyCost } from "@/lib/material-requests/supply-cost-contracts";

import { apiRequest, armyTest, recordEvidence } from "./fixtures";
import { draftOrderOfAnAffaire, type Envelope } from "./order-draft-support";

type Line = { id: string; status: string; unit_price_ht_cents: number | null; price_per: number };
type Item = {
  id: string; material_request_line_id?: string | null; quantity: number; unit_price_ht_cents: number; price_per?: number;
  line_total_ht_cents: number;
};
type OrderHeader = { id: string; status: string; total_ht_cents: number; edit_revision: number; expected_delivery_date: string | null };
type Document = { id: string; name: string };

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
// TI-691, the owner's walkthrough of 14/11/2026 (order page):
// - the order does not lead back to the request it comes from;
// - the order does not say what comes next (send, confirm, receive);
// - a status selector beside « Confirmer la commande… » reads as a way to order without proof.

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

type RealPrice = { id: string; unit_price_ht_cents: number; price_per: number };

/**
 * Arranged through the API: an invented acknowledgement joined to the draft, then the order confirmed on `orderedOn`,
 * at the quote's prices except the real ones `realPrices` gives for some of its lines.
 */
async function confirmThroughApi(
  browser: Browser, orderId: string, text: string, orderedOn: string, realPrices: (items: Item[]) => RealPrice[] = () => [],
) {
  const pdf = inventedPdf(text);
  const uploaded = await browser.evaluate(async ({ id, bytes }) => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(bytes)], "accuse.pdf", { type: "application/pdf" }));
    form.set("name", "Accusé de réception");
    const response = await fetch(`/api/purchase-orders/${id}/devis`, { method: "POST", body: form, credentials: "same-origin" });
    return { status: response.status, body: await response.json() as { item?: { id: string } } };
  }, { id: orderId, bytes: [...pdf] });
  expect(uploaded.status).toBe(201);
  const draft = await readOrder(browser, orderId);
  const confirmation = await apiRequest<Envelope<{ status: string }>>(browser, "POST", `/api/purchase-orders/${orderId}/confirmation`, {
    expected_revision: draft.header.edit_revision, ordered_on: orderedOn, document_id: uploaded.body.item!.id,
    lines: realPrices(draft.items),
  });
  expect([confirmation.status, confirmation.body.data?.status]).toEqual([200, "confirmed"]);
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
    const { ids, requestId, one, screws, order } = await draftOrderOfAnAffaire({ app, screen, browser }, army, "confirmation");
    const today = parisToday();

    // The draft says its next step, leads back to its request, and names apart the status changes without proof.
    await browser.goto(`/dashboard/orders/${order.id}`, { waitUntil: "domcontentloaded" });
    const draftHead = screen.getByRole("region", "Envoyer le bon au fournisseur", { exact: true });
    await expect(draftHead).toBeVisible({ timeout: 60_000 });
    await expect(draftHead.getByText("Étape 1 sur 3 · Envoyer", { exact: true })).toBeVisible();
    const requestHref = `/dashboard/affaires/${ids.projectId}/demandes-materiel/${requestId}?etape=commande`;
    await expect(screen.getByRole("navigation", "Fil d'Ariane", { exact: true })
      .getByRole("link", /^Demande du \d{2}\/\d{2}\/\d{4}$/)).toHaveAttribute("href", requestHref);
    await expect(screen.getByLabel("Statut de la commande", { exact: true })).toHaveCount(0);
    await expect(draftHead.getByRole("button", "Annuler le bon…", { exact: true })).toBeVisible();
    await app.screenshot("MR07-draft-next-step");

    // The supplier confirms the screws at 3,52 € the hundred (the quote said 3,42 €), with its acknowledgement.
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
    // Ordered: the next step is the reception, and the order can no longer be canceled from here.
    await expect(screen.getByRole("region", "Enregistrer la réception", { exact: true })).toBeVisible();
    await expect(screen.getByRole("button", "Annuler le bon…", { exact: true })).toHaveCount(0);
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
    await confirmThroughApi(browser, order.id, "Accuse de reception invente", today.iso);

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
    await expect(screen.getByRole("region", "Commande reçue", { exact: true })).toBeVisible();
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
    // The affaire's totals lead the page; the table per supply type opens under them.
    const detail = section.getByRole("button", "Détail par type de fourniture", { exact: true });
    await detail.tap();
    const table = section.getByRole("table", "Budget et commandé par type de fourniture", { exact: true });
    await expect(table.getByRole("row", /^Non classé\s+—\s+0,00\s€\s+119,28\s€\s+—$/)).toBeVisible();

    // Arranged through the API: the acknowledgement joined, the order confirmed with the screws at 3,52 € the hundred
    // (the quote said 3,42 €).
    await confirmThroughApi(browser, order.id, "Accuse de reception invente : vis 3,52 les 100", today.iso, (items) => [
      { id: items.find((item) => item.material_request_line_id === screws)!.id, unit_price_ht_cents: 352, price_per: 100 },
    ]);

    // The confirmed order is « commandé » at its real price, 115,00 € + 4,40 €; nothing is left « en cours ».
    await browser.goto(`/dashboard/affaires/${ids.projectId}/demandes-materiel`, { waitUntil: "domcontentloaded" });
    await detail.tap({ timeout: 60_000 });
    await expect(table.getByRole("row", /^Non classé\s+—\s+119,40\s€\s+0,00\s€\s+—$/)).toBeVisible({ timeout: 60_000 });
    await expect(table.getByRole("row", /^Total HT\s+—\s+119,40\s€\s+0,00\s€\s+—$/)).toBeVisible();
    const after = await apiRequest<Envelope<SupplyCost>>(browser, "GET", costPath);
    expect(after.body.data.totals).toEqual({ budget_cents: null, ordered_cents: 11940, pending_cents: 0 });

    await recordEvidence(army, "affaire-supply-cost", {
      requestId, orderId: order.id, before: before.body.data.totals, after: after.body.data.totals,
    });
  },
);
