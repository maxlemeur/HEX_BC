import { z } from "zod";

/**
 * Ordering and receiving a purchase order of an affaire (TI-691, lot 2 « l'achat », delivery 3b-1). The office passes
 * the order of a draft (by phone, WhatsApp or on the supplier's site), then records it with its real prices and the
 * supplier's confirmation as proof: the draft becomes « confirmée ». When the goods come, it records the reception of
 * the whole order, dated, with a free note for what is still to come: « reçue ». Once ordered, an order of an affaire
 * is neither canceled nor deleted. This module is the contract shared by the server, the API and the screens; nothing
 * here touches the network.
 *
 * Money is in integer cents excluding tax (HT); a price is for 1, 10, 100 or 1 000 units (`price_per`), and the amount
 * of a line is quantity × price ÷ price_per, rounded half away from zero to the cent (the database computes it).
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date au format AAAA-MM-JJ.");
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
/** Blank is no value: the database keeps a trimmed text or null. */
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional()
  .transform((value) => (value ? value : null));

export const PURCHASE_ORDER_PRICE_PERS = [1, 10, 100, 1000] as const;
export type PurchaseOrderPricePer = (typeof PURCHASE_ORDER_PRICE_PERS)[number];
export const PURCHASE_ORDER_SUPPLIER_REFERENCE_MAX = 120;
export const PURCHASE_ORDER_RECEPTION_NOTE_MAX = 2000;

/** Body of POST /api/purchase-orders/{id}/confirmation. */
export const confirmPurchaseOrderSchema = z.object({
  /** The edit revision the screen read: a draft changed since is refused. */
  expected_revision: revision,
  /** The day the order was passed: today at the latest (Paris). */
  ordered_on: isoDate,
  /** The delivery the supplier announced, not before the order; left out, the draft's date stays. */
  expected_delivery_date: isoDate.nullable().optional(),
  /** The supplier's own reference for the order (acknowledgement, web order number). */
  supplier_reference: optionalText(PURCHASE_ORDER_SUPPLIER_REFERENCE_MAX),
  /** A document joined to the order that proves it was passed (purchase order devis). */
  document_id: z.string().uuid(),
  /** The real price and lot of each line given; the others keep theirs. */
  lines: z.array(z.object({
    id: z.string().uuid(),
    unit_price_ht_cents: z.number().int().min(0).max(2_147_483_647),
    price_per: z.union([z.literal(1), z.literal(10), z.literal(100), z.literal(1000)]),
  }).strict()).max(1000).default([]),
}).strict();
export type ConfirmPurchaseOrderInput = z.input<typeof confirmPurchaseOrderSchema>;
export type ConfirmPurchaseOrderData = z.output<typeof confirmPurchaseOrderSchema>;

/** Body of POST /api/purchase-orders/{id}/reception. */
export const receivePurchaseOrderSchema = z.object({
  expected_revision: revision,
  /** The day the whole order came: between its order date and today (Paris). */
  received_on: isoDate,
  /** What is still to come, in words. */
  note: optionalText(PURCHASE_ORDER_RECEPTION_NOTE_MAX),
}).strict();
export type ReceivePurchaseOrderInput = z.input<typeof receivePurchaseOrderSchema>;
export type ReceivePurchaseOrderData = z.output<typeof receivePurchaseOrderSchema>;

/** Answer of the confirmation: the order as it now stands. */
export type PurchaseOrderConfirmed = {
  id: string;
  status: "confirmed";
  edit_revision: number;
  order_date: string;
  /** AAAA-MM-JJ, or « TBD » for a delivery still to be determined (the draft editor's value). */
  expected_delivery_date: string | null;
  total_ht_cents: number;
  total_tax_cents: number;
  total_ttc_cents: number;
};

/** Answer of the reception. */
export type PurchaseOrderReceived = { id: string; status: "received"; edit_revision: number };

/** The codes an API refusal carries, named after the database's own refusals. */
export const PURCHASE_ORDER_LIFECYCLE_CODES = [
  "PURCHASE_ORDER_AFFAIRE_ONLY",
  "PURCHASE_ORDER_CONFIRMATION_NOT_DRAFT",
  "PURCHASE_ORDER_REVISION_CONFLICT",
  "PURCHASE_ORDER_CONFIRMATION_DATE_INVALID",
  "PURCHASE_ORDER_CONFIRMATION_PROOF_REQUIRED",
  "PURCHASE_ORDER_ITEMS_INVALID",
  "PURCHASE_ORDER_CONFIRMATION_EMPTY",
  "PURCHASE_ORDER_TOTAL_NEGATIVE",
  "PURCHASE_ORDER_AMOUNT_OUT_OF_RANGE",
  "PURCHASE_ORDER_RECEPTION_NOT_CONFIRMED",
  "PURCHASE_ORDER_RECEPTION_DATE_INVALID",
] as const;
export type PurchaseOrderLifecycleCode = (typeof PURCHASE_ORDER_LIFECYCLE_CODES)[number];
