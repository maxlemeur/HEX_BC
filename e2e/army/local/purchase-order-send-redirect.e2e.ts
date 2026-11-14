import { expect } from "e2e";

import { CALC_V3_EMAIL_REDIRECT_TO } from "../../../scripts/tester-army/calc-v3-phases";
import { armyTest, recordEvidence } from "../critical/fixtures";
import {
  attachedOrderText,
  collectedMessages,
  draftOrderOfAnAffaire,
  inventedAddress,
  openSendDialog,
  recipientsOf,
  sendFromDialog,
} from "./purchase-order-send-support";

// The send of a purchase order while the application redirects its outgoing e-mails to the test mailbox, its default
// in development and in production (calc-v3 phase `order-send-redirect`, docs/testing/email-redirection.md). Failure
// modes, written before the journey was first run against the product:
// - the supplier receives the message;
// - the test mailbox receives nothing, or a message that does not name the supplier it was written to;
// - the screen does not say, before the send, that the supplier will receive nothing, or says afterwards that the
//   order was sent to the supplier;
// - the send is recorded with the test mailbox instead of what the user wrote, or the mailbox reaches the browser.

armyTest(
  "BC10 while e-mails are redirected, the test mailbox receives the order, the supplier nothing, and the order says so",
  { session: "army", trace: "off", tags: ["order-send"], timeout: 300_000 },
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const supplierEmail = inventedAddress(army, "commandes");
    const { order } = await draftOrderOfAnAffaire(ui, army, "redirigé", supplierEmail);
    const subject = `${army.runPrefix} commande redirigée`;

    const dialog = await openSendDialog(ui, order);
    await expect(dialog.getByText(
      "Mode test : les e-mails sont redirigés vers la boîte de test. Le fournisseur ne recevra rien ; son adresse apparaîtra dans l’objet du message reçu par la boîte de test.",
    )).toBeVisible();
    await expect(dialog.getByLabel("Destinataire", { exact: true })).toHaveValue(supplierEmail);
    await dialog.getByLabel("Objet", { exact: true }).fill(subject);
    const sent = await sendFromDialog(ui, dialog, order.id);
    expect(sent.status, JSON.stringify(sent.body.error ?? null)).toBe(200);
    // Recorded as written, and as redirected; the test mailbox itself is not answered to the browser.
    expect([sent.body.data.order.status, sent.body.data.send.recipient, sent.body.data.send.subject, sent.body.data.send.redirected])
      .toEqual(["sent", supplierEmail, subject, true]);
    expect(JSON.stringify(sent.body)).not.toContain(CALC_V3_EMAIL_REDIRECT_TO);

    await expect(screen.getByText("Envoyée", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByText(new RegExp(
      `^Envoi de test le \\d{2}/\\d{2}/\\d{4} à \\d{2}:\\d{2}(?: par .+)? : redirigé vers la boîte de test, ${supplierEmail.replaceAll(".", "\\.")} n’a rien reçu$`,
    ))).toBeVisible();
    await expect(screen.getByText(CALC_V3_EMAIL_REDIRECT_TO)).toHaveCount(0);

    // One message left: to the test mailbox, the supplier named in its subject, the order attached.
    const [message, ...others] = await collectedMessages(subject);
    expect(others).toEqual([]);
    expect(recipientsOf(message)).toEqual([CALC_V3_EMAIL_REDIRECT_TO]);
    expect(message.payload.cc ?? []).toEqual([]);
    expect(message.payload.subject).toBe(`[TEST → ${supplierEmail}] ${subject}`);
    expect(await attachedOrderText(message)).toContain(order.reference);

    await recordEvidence(army, "purchase-order-send-redirected", {
      orderId: order.id, send: sent.body.data.send, collected: { recipients: recipientsOf(message), subject: message.payload.subject },
    });
  },
);
