/**
 * What the screens of an order need to send it to its supplier by e-mail, without any dependency: the order pages are
 * under a bundle budget, so the validation schema stays in send-contracts.ts, on the server.
 *
 * From a draft, the user sends the order with the order attached as a PDF, after reading and correcting the
 * recipient, the subject and the message. The order becomes « envoyée » only when the e-mail provider accepted the
 * message. While the outgoing e-mails are redirected (docs/testing/email-redirection.md), the message goes to the
 * test mailbox, the supplier named in its subject, and the send is recorded as redirected.
 */

export const PURCHASE_ORDER_SEND_SUBJECT_MAX = 160;
export const PURCHASE_ORDER_SEND_MESSAGE_MAX = 5000;

/** A send as the order shows it. The mailbox a redirected message really went to is never part of it. */
export type PurchaseOrderSendRecord = {
  id: string;
  /** sending: claimed, the provider not yet answered; unconfirmed: no answer, the message may have left. */
  status: "sending" | "sent" | "failed" | "unconfirmed";
  /** The recipient and the subject as the user wrote them. */
  recipient: string;
  subject: string;
  /** The outgoing e-mails were redirected to the test mailbox: the recipient received nothing. */
  redirected: boolean;
  requested_by_name: string | null;
  requested_at: string;
  settled_at: string | null;
};

/** Answer of POST /api/purchase-orders/{id}/send. */
export type PurchaseOrderSent = {
  send: PurchaseOrderSendRecord;
  order: { id: string; status: "draft" | "sent" | "confirmed" | "received" | "canceled"; edit_revision: number };
  /** The request had already been accepted: nothing was sent again. */
  replayed: boolean;
};

/** Where the server's e-mails go: to their recipients, to the test mailbox, or nowhere until it is configured. */
export type PurchaseOrderSendRouting = "live" | "redirect" | "unconfigured";

/** « Bon_de_commande_C-2611-007.pdf »: the reference, without anything a file name refuses. */
export function purchaseOrderPdfFilename(reference: string): string {
  const safe = reference.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `Bon_de_commande_${safe || "commande"}.pdf`;
}

export function defaultSendSubject(input: { reference: string; companyName: string }): string {
  return `Bon de commande ${input.reference} - ${input.companyName}`.slice(0, PURCHASE_ORDER_SEND_SUBJECT_MAX).trim();
}

export function defaultSendMessage(input: {
  reference: string;
  affaireName: string | null;
  /** AAAA-MM-JJ, « TBD » or nothing. */
  expectedDeliveryDate: string | null;
  issuerName: string | null;
}): string {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.expectedDeliveryDate ?? "");
  return [
    "Bonjour,",
    "",
    `Veuillez trouver ci-joint notre bon de commande ${input.reference}${input.affaireName ? ` pour l’affaire ${input.affaireName}` : ""}.`,
    ...(day ? [`Livraison souhaitée le ${day[3]}/${day[2]}/${day[1]}.`] : []),
    "",
    "Merci de nous en accuser réception en nous confirmant vos prix et votre délai de livraison.",
    "",
    "Cordialement,",
    ...(input.issuerName ? [input.issuerName] : []),
  ].join("\n");
}

/** « 2026-11-14T09:30:00+00:00 » → « 14/11/2026 à 10:30 », in Paris. */
export function formatSendMoment(value: string | null | undefined): string {
  const date = new Date(value ?? "");
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.day}/${parts.month}/${parts.year} à ${parts.hour}:${parts.minute}`;
}

/** One line of the order's history: « Envoyé le 14/11/2026 à 10:30 par Dominique à commandes@… (boîte de test) ». */
export function describeSend(send: PurchaseOrderSendRecord): string {
  const moment = formatSendMoment(send.settled_at ?? send.requested_at);
  const by = send.requested_by_name ? ` par ${send.requested_by_name}` : "";
  const to = ` à ${send.recipient}`;
  switch (send.status) {
    case "sent":
      return send.redirected
        ? `Envoi de test le ${moment}${by} : redirigé vers la boîte de test, ${send.recipient} n’a rien reçu`
        : `Envoyé le ${moment}${by}${to}`;
    case "failed":
      return `Envoi refusé par le service d’e-mail le ${moment}${by}${to} : rien n’est parti`;
    case "unconfirmed":
      return `Envoi non confirmé le ${moment}${by}${to} : vérifiez qu’il n’est pas arrivé avant de renvoyer`;
    default:
      return `Envoi en cours depuis le ${formatSendMoment(send.requested_at)}${by}${to}`;
  }
}
