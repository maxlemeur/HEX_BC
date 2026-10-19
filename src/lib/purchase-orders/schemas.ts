import { z } from "zod";
import { isValidDateOnly } from "@/lib/date-only";
import { MAX_ORDER_AMOUNT_CENTS } from "@/lib/order-calculations";
import { isValidOrderQuantity, MAX_ORDER_QUANTITY } from "@/lib/purchase-orders/quantities";

const UUID_ERROR_MESSAGE = "Identifiant invalide.";

export const ordersListQuerySchema = z
  .object({
    view: z.enum(["list", "page", "items", "lookups", "export"]).optional().default("list"),
    q: z.string().trim().max(200).default(""),
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    size: z.coerce.number().int().min(1).max(100).default(50),
    sort: z.enum(["created_at", "expected_delivery_date", "total_ht_cents", "reference"]).default("created_at"),
    direction: z.enum(["asc", "desc"]).default("desc"),
    status: z.array(z.enum(["draft", "sent", "confirmed", "received", "canceled"])).max(5).default([]),
    supplier_id: z.string().uuid(UUID_ERROR_MESSAGE).optional(),
    delivery_site_id: z.string().uuid(UUID_ERROR_MESSAGE).optional(),
    has_devis: z.enum(["with", "without"]).optional(),
    date_from: z.string().refine(isValidDateOnly, "Date de début invalide.").optional(),
    date_to: z.string().refine(isValidDateOnly, "Date de fin invalide.").optional(),
    order_id: z.array(z.string().uuid(UUID_ERROR_MESSAGE)).max(1000).default([]),
  })
  .superRefine((query, context) => {
    if (query.date_from && query.date_to && query.date_from > query.date_to) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["date_to"], message: "La date de fin précède la date de début." });
    }
    // `view=items` is a per-order detail fetch: never return every item of the tenant.
    if (query.view === "items" && query.order_id.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["order_id"],
        message: "Au moins un identifiant de commande est requis.",
      });
    }
  });

export type OrdersListQueryInput = z.infer<typeof ordersListQuerySchema>;

const expectedDeliveryDateSchema = z.string().trim().transform((value) =>
  value.toUpperCase() === "TBD" ? "TBD" : value || null
).refine((value) => value === null || value === "TBD" || isValidDateOnly(value), {
  message: "Date de livraison invalide (YYYY-MM-DD ou TBD attendu).",
}).nullable();

export const purchaseOrderLineSchema = z.object({
  id: z.string().uuid(UUID_ERROR_MESSAGE).nullable().optional(),
  productId: z.string().uuid(UUID_ERROR_MESSAGE).nullable().optional(),
  reference: z.string().nullable().optional(),
  designation: z.string().trim().min(1, "La désignation est requise."),
  quantity: z.number().finite().positive().max(MAX_ORDER_QUANTITY).refine(isValidOrderQuantity, {
    message: "La quantité doit avoir au plus trois décimales.",
  }).describe("Quantité positive, au plus trois décimales effectives, sans arrondi implicite."),
  unit: z.string().refine((value) => value.trim().length > 0, "L'unité est requise.").nullable().optional(),
  unitPriceCents: z.number().int().min(0).max(MAX_ORDER_AMOUNT_CENTS),
  taxRateBp: z.number().int().min(0).max(10000),
}).strict();

const headerShape = {
  supplierId: z.string().uuid(UUID_ERROR_MESSAGE),
  deliverySiteId: z.string().uuid(UUID_ERROR_MESSAGE),
  expectedDeliveryDate: expectedDeliveryDateSchema.optional(),
  notes: z.string().trim().nullable().optional(),
};

function requireNewLineUnit(items: z.infer<typeof purchaseOrderLineSchema>[], context: z.RefinementCtx) {
  items.forEach((item, index) => {
    if (!item.id && !item.unit?.trim()) context.addIssue({
      code: z.ZodIssueCode.custom, path: ["items", index, "unit"], message: "L'unité est requise pour une nouvelle ligne.",
    });
  });
}

export const createPurchaseOrderSchema = z.object({
  ...headerShape,
  items: z.array(purchaseOrderLineSchema.omit({ id: true }).extend({
    unit: z.string().trim().min(1, "L'unité est requise pour une nouvelle ligne."),
  })).min(1).max(1000),
}).strict();

export const updatePurchaseOrderSchema = z.object({
  ...headerShape,
  supplierId: headerShape.supplierId.optional(),
  deliverySiteId: headerShape.deliverySiteId.optional(),
  items: z.array(purchaseOrderLineSchema).min(1).max(1000).optional(),
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict().superRefine((payload, context) => {
  if (payload.items) requireNewLineUnit(payload.items, context);
});

export const purchaseOrderWriteReceiptSchema = z.object({
  id: z.string().uuid(),
  reference: z.string().optional(),
  edit_revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

export const purchaseOrderItemHistorySchema = z.object({
  events: z.array(z.object({
    id: z.string().uuid(),
    occurred_at: z.string(),
    actor_id: z.string().uuid().nullable(),
    actor_name: z.string().nullable(),
    operation: z.enum(["insert", "update", "delete"]),
    item_id: z.string().uuid(),
    before: z.record(z.string(), z.unknown()).nullable(),
    after: z.record(z.string(), z.unknown()).nullable(),
  })),
});

export type PurchaseOrderLineInput = z.infer<typeof purchaseOrderLineSchema>;

const orderLookupSchema = z.object({ id: z.string().uuid(), name: z.string() });
export const purchaseOrderDocumentHeaderSchema = z.object({
  id: z.string().uuid(), reference: z.string(), created_at: z.string(),
  status: z.enum(["draft", "sent", "confirmed", "received", "canceled"]),
  expected_delivery_date: z.string().nullable(),
  edit_revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  total_ht_cents: z.number().int(), total_tax_cents: z.number().int(), total_ttc_cents: z.number().int(),
  suppliers: orderLookupSchema.nullable(), delivery_sites: orderLookupSchema.nullable(),
});

export const purchaseOrderStoredItemSchema = z.object({
  id: z.string().uuid(), purchase_order_id: z.string().uuid(),
  designation: z.string(), reference: z.string().nullable(), quantity: z.number().finite().positive(),
  unit: z.string().nullable(), price_unit: z.string().nullable(), product_id: z.string().uuid().nullable(),
  is_source_linked: z.boolean(), source_estimate_item_id: z.string().uuid().nullable(),
  source_selected_supplier_price_id: z.string().uuid().nullable(), tax_rate_bp: z.number().int(),
  unit_price_ht_cents: z.number().int(), line_total_ht_cents: z.number().int(),
  line_tax_cents: z.number().int(), line_total_ttc_cents: z.number().int(),
});

export const purchaseOrderDocumentsSchema = z.object({
  orders: z.array(purchaseOrderDocumentHeaderSchema.extend({
    items: z.array(purchaseOrderStoredItemSchema),
  })).max(1000),
});

export const purchaseOrderItemsResponseSchema = z.object({
  orders: z.array(purchaseOrderDocumentHeaderSchema),
  items: z.array(purchaseOrderStoredItemSchema),
  itemsByOrderId: z.record(z.string(), z.array(purchaseOrderStoredItemSchema)),
});
