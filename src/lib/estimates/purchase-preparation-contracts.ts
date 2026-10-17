import { z } from "zod";

export const purchaseTransferStatusSchema = z.enum([
  "draft", "sent", "confirmed", "received", "canceled", "deleted",
]);

export const purchaseTransferSchema = z.object({
  item_id: z.string().uuid(),
  item_title: z.string(),
  purchase_order_id: z.string().uuid(),
  reference: z.string(),
  status: purchaseTransferStatusSchema,
  quantity: z.number().positive().finite(),
  can_open: z.boolean(),
});

const centsSchema = z.number().int().nonnegative().safe();

export const purchaseReceiptOrderSchema = z.object({
  purchase_order_id: z.string().uuid(),
  reference: z.string(),
  supplier_id: z.string().uuid(),
  supplier_name: z.string(),
  delivery_site_id: z.string().uuid(),
  item_count: z.number().int().positive(),
  total_ht_cents: centsSchema,
  total_tax_cents: centsSchema,
  total_ttc_cents: centsSchema,
  ordered_source_item_ids: z.array(z.string().uuid()).min(1),
  current_status: purchaseTransferStatusSchema,
  can_open: z.boolean(),
});

export const purchaseReceiptSchema = z.object({
  source_version_id: z.string().uuid(),
  idempotency_key: z.string().uuid(),
  replayed: z.boolean(),
  summary: z.object({
    draft_orders_created: z.number().int().positive(),
    draft_lines_created: z.number().int().positive(),
  }),
  orders: z.array(purchaseReceiptOrderSchema).min(1),
});

// The review is returned by the same canonical SQL snapshot used under locks
// at creation. These fields must agree with the visible preparation first.
export const purchaseReviewSchema = z.object({
  lines: z.array(z.object({
    item_id: z.string(),
    item_title: z.string(),
    quantity: z.number().finite(),
    unit_price_ht_cents: centsSchema,
    tax_rate_bp: z.number().int().nonnegative(),
    unit: z.string(),
    selected_supplier_price_id: z.string(),
    supplier_id: z.string(),
    supplier_name: z.string(),
    supplier_reference: z.string().nullable(),
    review_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    // 2.9: what the draft orders, computed from the fingerprinted snapshot.
    ordered_quantity: z.number().finite().nullable(),
    ordered_unit: z.string().nullable(),
    ordered_unit_price_ht_cents: centsSchema.nullable(),
  })),
});
