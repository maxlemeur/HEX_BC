import { formatSendMoment } from "@/lib/purchase-orders/send";

/**
 * The last estimate e-mail the provider accepted, as its page shows it (TI-691). The test mailbox itself never is.
 * `redirected` is null for a send recorded before its routing was; `bounced`, when the message came back undelivered.
 */
export type EstimateLastSend = { recipient: string; sentAt: string | null; redirected: boolean | null; bounced: boolean };

/**
 * « Envoyé par e-mail le 14/11/2026 à 10:30 à client@… », or, when the outgoing e-mails were redirected,
 * « Envoi de test le 14/11/2026 à 10:30 : redirigé vers la boîte de test, client@… n’a rien reçu ».
 */
export function describeEstimateSend(send: EstimateLastSend): string {
  const moment = formatSendMoment(send.sentAt);
  const when = moment ? ` le ${moment}` : "";
  if (send.redirected === true) {
    return send.bounced
      ? `Envoi de test${when} : redirigé vers la boîte de test, revenu non distribué`
      : `Envoi de test${when} : redirigé vers la boîte de test, ${send.recipient} n’a rien reçu`;
  }
  if (send.bounced) return `Envoi par e-mail${when} à ${send.recipient} : revenu non distribué`;
  return send.redirected === false
    ? `Envoyé par e-mail${when} à ${send.recipient}`
    // Recorded before the routing was: since outgoing e-mails are redirected by default, it may have gone to the test mailbox.
    : `Envoi par e-mail${when} à ${send.recipient}, enregistré avant le suivi des envois de test : il a pu être redirigé`;
}
