import { z } from "zod";

import { isOneMailbox } from "@/lib/email/outgoing-routing";

import { PURCHASE_ORDER_SEND_MESSAGE_MAX, PURCHASE_ORDER_SEND_SUBJECT_MAX, type PurchaseOrderSendRecord } from "./send";

/**
 * Body of POST /api/purchase-orders/{id}/send, and the answers of the two database functions behind it
 * (supabase/migrations/20261114121243_purchase_order_sends.sql). Server only: the screens read send.ts.
 */

// A line break or another control character in a recipient or a subject would write a header of the message.
const CONTROL = /[\u0000-\u001f\u007f]/;

export const sendPurchaseOrderSchema = z.object({
  /** The edit revision the screen read: a draft changed since is not sent. */
  expected_revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  /** Chosen by the screen for one send: the same request again never sends twice. */
  idempotency_key: z.string().uuid(),
  /** One mailbox. Left out or empty: the address of the supplier's record. */
  recipient: z.string().trim().max(320).optional()
    .refine((value) => !value || isOneMailbox(value), "Une seule adresse e-mail valide est attendue."),
  subject: z.string().trim().min(1, "L’objet est requis.").max(PURCHASE_ORDER_SEND_SUBJECT_MAX)
    .refine((value) => !CONTROL.test(value), "L’objet tient sur une ligne."),
  message: z.string().max(PURCHASE_ORDER_SEND_MESSAGE_MAX).transform((value) => value.replace(/\r\n?/g, "\n").trimEnd()),
}).strict();
export type SendPurchaseOrderInput = z.input<typeof sendPurchaseOrderSchema>;
export type SendPurchaseOrderData = z.output<typeof sendPurchaseOrderSchema>;

const sendRowSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["sending", "sent", "failed", "unconfirmed"]),
  recipient: z.string(),
  subject: z.string(),
  message: z.string(),
  redirected: z.boolean(),
  requested_by_name: z.string().nullable(),
  requested_at: z.string(),
  settled_at: z.string().nullable(),
});
export type PurchaseOrderSendRow = z.output<typeof sendRowSchema>;

export const beginSendAnswerSchema = z.object({ state: z.enum(["claimed", "sent", "unconfirmed"]), send: sendRowSchema });
export const finishSendAnswerSchema = z.object({
  send: sendRowSchema,
  order: z.object({
    id: z.string().uuid(),
    status: z.enum(["draft", "sent", "confirmed", "received", "canceled"]),
    edit_revision: z.number().int().min(0),
  }),
});

/** What the screens are given of a send: never its message, nor anything of the routing but « redirected ». */
export function toSendRecord(row: PurchaseOrderSendRow): PurchaseOrderSendRecord {
  return {
    id: row.id, status: row.status, recipient: row.recipient, subject: row.subject, redirected: row.redirected,
    requested_by_name: row.requested_by_name, requested_at: row.requested_at, settled_at: row.settled_at,
  };
}
