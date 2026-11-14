import { randomUUID } from "node:crypto";

import { expect } from "e2e";

import { apiRequest, armyTest, recordEvidence } from "../critical/fixtures";
import type { Envelope } from "../critical/order-draft-support";
import {
  attachedOrderText,
  collectedMessages,
  draftOrderOfAnAffaire,
  inventedAddress,
  openSendDialog,
  recipientsOf,
  sendFromDialog,
  sendThroughApi,
} from "./purchase-order-send-support";

// The send of a purchase order to its supplier by e-mail, where the provider is the local collector and the
// application delivers as written (calc-v3 phase `order-send`, docs/testing/purchase-order-send.md). Failure modes,
// written before the journeys were first run against the product:
// - the supplier's address, the subject or the message the user corrected is not what leaves, or the order is not
//   attached, or the attached PDF is not this order (its reference, its lines at the quote's price, its total);
// - the order says « Envoyée » before the provider accepted the message, or stays a draft after it did;
// - the send is not on the order afterwards (who, when, to whom), or a sent order can still be edited or sent;
// - the same request again, or a second request, makes a second message leave;
// - a sent order of an affaire can no longer be confirmed;
// - a supplier without address is sent somewhere, or the refusal does not say what to fix, or it changes the order.

const options = { session: "army", trace: "off" as const, tags: ["order-send"], timeout: 300_000 };

armyTest(
  "BC01 a draft order of an affaire is sent once to its supplier, as corrected, with the order attached",
  options,
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const supplierEmail = inventedAddress(army, "commandes");
    const { one, order } = await draftOrderOfAnAffaire(ui, army, "envoi", supplierEmail);
    const subject = `${army.runPrefix} commande ${order.reference}`;

    // The dialog proposes the supplier's address, a subject and a message; the user corrects them.
    const dialog = await openSendDialog(ui, order);
    await expect(dialog.getByLabel("Destinataire", { exact: true })).toHaveValue(supplierEmail);
    await expect(dialog.getByLabel("Objet", { exact: true })).toHaveValue(`Bon de commande ${order.reference} - HYDRO EXPRESS SAS`);
    await expect(dialog.getByLabel("Message", { exact: true })).toHaveValue(new RegExp(`notre bon de commande ${order.reference} pour l’affaire ${army.projectName}`));
    await expect(dialog.getByText(/Mode test/)).toHaveCount(0);
    await dialog.getByLabel("Objet", { exact: true }).fill(subject);
    await dialog.getByLabel("Message", { exact: true }).fill("Bonjour,\n\nCommande inventée, merci de confirmer vos prix.\n\nLe bureau");
    const sent = await sendFromDialog(ui, dialog, order.id);
    expect(sent.status, JSON.stringify(sent.body.error ?? null)).toBe(200);
    expect([sent.body.data.order.status, sent.body.data.send.status, sent.body.data.send.redirected, sent.body.data.replayed])
      .toEqual(["sent", "sent", false, false]);

    // The order is « Envoyée », says so with its send, and is no longer edited or sent; it can be confirmed.
    await expect(screen.getByText("Envoyée", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByText(new RegExp(`^Envoyé le \\d{2}/\\d{2}/\\d{4} à \\d{2}:\\d{2}(?: par .+)? à ${supplierEmail.replaceAll(".", "\\.")}$`)))
      .toBeVisible();
    await expect(screen.getByRole("button", "Envoyer au fournisseur…", { exact: true })).toHaveCount(0);
    await expect(screen.getByRole("link", "Modifier", { exact: true })).toHaveCount(0);
    await expect(screen.getByRole("button", "Confirmer la commande…", { exact: true })).toBeVisible();
    const summary = await apiRequest<Envelope<{ orders: Array<{ id: string; status: string }> }>>(browser, "GET", `${one}/orders`);
    expect(summary.body.data.orders.map((entry) => [entry.id, entry.status])).toEqual([[order.id, "sent"]]);

    // One message left, to the supplier, as corrected, with this order as a PDF.
    const [message, ...others] = await collectedMessages(subject);
    expect(others).toEqual([]);
    expect(recipientsOf(message)).toEqual([supplierEmail]);
    expect(message.payload.subject).toBe(subject);
    expect(message.payload.text).toContain("Commande inventée, merci de confirmer vos prix.");
    expect(message.payload.html).toContain("Commande inventée, merci de confirmer vos prix.");
    expect(message.idempotencyKey).toBe(`purchase-order-send/${sent.body.data.send.id}`);
    expect(message.payload.attachments.map((attachment) => attachment.filename)).toEqual([`Bon_de_commande_${order.reference}.pdf`]);
    const pdf = await attachedOrderText(message);
    for (const expected of ["BON DE COMMANDE", order.reference, `${army.runPrefix} Négoce envoi`, supplierEmail, "Livraison sur chantier",
      `Affaire : ${army.projectName}`, "10 u 11,50 € 115,00 €", "125 u 3,42 € les 100 4,28 €", "Total HT 119,28 €", "Total TTC 143,14 €"]) {
      expect(pdf).toContain(expected);
    }

    // The same request again answers what was sent; a new one is refused: nothing more leaves.
    const replayed = await sendThroughApi(browser, order.id, {
      expected_revision: 0, idempotency_key: sent.body.data.send.id, recipient: supplierEmail, subject, message: "Bonjour",
    });
    expect([replayed.status, replayed.body.data?.replayed, replayed.body.data?.send.id]).toEqual([200, true, sent.body.data.send.id]);
    const again = await sendThroughApi(browser, order.id, {
      expected_revision: sent.body.data.order.edit_revision, idempotency_key: randomUUID(), recipient: supplierEmail, subject, message: "Bonjour",
    });
    expect([again.status, again.body.error?.code]).toEqual([409, "PURCHASE_ORDER_SEND_NOT_DRAFT"]);
    expect(await collectedMessages(subject)).toHaveLength(1);

    await recordEvidence(army, "purchase-order-send", {
      orderId: order.id, reference: order.reference, status: sent.body.data.order.status, send: sent.body.data.send,
      collected: { id: message.id, recipients: recipientsOf(message), subject: message.payload.subject,
        attachment: message.payload.attachments[0]!.filename }, replay: replayed.status, second_request: again.body.error?.code,
    });
  },
);

armyTest(
  "BC02 a supplier without address refuses the send, says what to fix and leaves the draft; a typed recipient sends",
  options,
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const { one, order } = await draftOrderOfAnAffaire(ui, army, "sans adresse");
    const subject = `${army.runPrefix} commande sans adresse`;

    // The dialog says the record has no address; the server refuses a send without recipient, and says what to fix.
    const dialog = await openSendDialog(ui, order);
    await expect(dialog.getByLabel("Destinataire", { exact: true })).toHaveValue("");
    await expect(dialog.getByText(new RegExp(`${army.runPrefix} Négoce sans adresse n’a pas d’adresse e-mail sur sa fiche\\.`))).toBeVisible();
    await dialog.getByLabel("Objet", { exact: true }).fill(subject);
    await dialog.getByRole("button", "Envoyer le bon", { exact: true }).tap();
    await expect(dialog.getByRole("alert")).toHaveText(
      `${army.runPrefix} Négoce sans adresse n’a pas d’adresse e-mail : saisissez le destinataire, ou renseignez l’adresse sur la fiche du fournisseur.`);
    const refused = await sendThroughApi(browser, order.id, { expected_revision: 1, idempotency_key: randomUUID(), subject, message: "Bonjour" });
    expect([refused.status, refused.body.error?.code]).toEqual([422, "PURCHASE_ORDER_SEND_NO_RECIPIENT"]);
    expect(refused.body.error?.message).toBe(
      `${army.runPrefix} Négoce sans adresse n’a pas d’adresse e-mail : renseignez-la sur sa fiche (Fournisseurs), ou saisissez le destinataire de cet envoi. Le bon reste en brouillon.`);
    expect(await collectedMessages(subject)).toEqual([]);
    const before = await apiRequest<Envelope<{ orders: Array<{ id: string; status: string }> }>>(browser, "GET", `${one}/orders`);
    expect(before.body.data.orders.map((entry) => [entry.id, entry.status])).toEqual([[order.id, "draft"]]);

    // A recipient typed for this send: the order leaves to it.
    const typed = inventedAddress(army, "achats");
    await dialog.getByLabel("Destinataire", { exact: true }).fill(typed);
    const sent = await sendFromDialog(ui, dialog, order.id);
    expect(sent.status, JSON.stringify(sent.body.error ?? null)).toBe(200);
    await expect(screen.getByText("Envoyée", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    const messages = await collectedMessages(subject);
    expect(messages.map(recipientsOf)).toEqual([[typed]]);

    await recordEvidence(army, "purchase-order-send-without-address", {
      orderId: order.id, refusal: refused.body.error, sent_to: typed, status: sent.body.data.order.status,
    });
  },
);
