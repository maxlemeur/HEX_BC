/**
 * The words of a purchase order line and of its delivery, without any dependency: the order screens read them, and
 * their bundles carry no validation schema for it (the « orders » page has a size budget). schemas.ts and the
 * material-request order contracts re-export them.
 *
 * TI-691, lot 2 « l'achat », delivery 3a: a line is an article, the supplier's shipping or a global discount, its price
 * given for 1, 10, 100 or 1 000 units; an order made from a material request is delivered at the request's place.
 */
export const PURCHASE_ORDER_LINE_KINDS = ["article", "shipping", "discount"] as const;
export type PurchaseOrderLineKind = (typeof PURCHASE_ORDER_LINE_KINDS)[number];
export const PURCHASE_ORDER_PRICE_PER = [1, 10, 100, 1000] as const;
export type PurchaseOrderPricePer = (typeof PURCHASE_ORDER_PRICE_PER)[number];
/** What a shipping or discount line is called, and its unit, when the client leaves them empty. */
export const PURCHASE_ORDER_AMOUNT_LINE_DESIGNATIONS: Record<Exclude<PurchaseOrderLineKind, "article">, string> = {
  shipping: "Port",
  discount: "Remise",
};
export const PURCHASE_ORDER_AMOUNT_LINE_UNIT = "forfait";
export const PURCHASE_ORDER_IMPUTATIONS = ["project", "overhead"] as const;

/** How an order made from a material request is delivered: the request's delivery place, copied. */
export const PURCHASE_ORDER_DELIVERY_MODES = ["site", "office", "counter"] as const;
export type PurchaseOrderDeliveryMode = (typeof PURCHASE_ORDER_DELIVERY_MODES)[number];
export const PURCHASE_ORDER_DELIVERY_MODE_LABELS: Record<PurchaseOrderDeliveryMode, string> = {
  site: "Livraison sur chantier",
  office: "Livraison au bureau",
  counter: "Retrait au comptoir",
};
