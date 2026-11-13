import { z } from "zod";
import { isValidDateOnly } from "@/lib/date-only";
import { MAX_ORDER_AMOUNT_CENTS } from "@/lib/order-calculations";
import {
  PURCHASE_ORDER_AMOUNT_LINE_DESIGNATIONS,
  PURCHASE_ORDER_AMOUNT_LINE_UNIT,
  PURCHASE_ORDER_DELIVERY_MODES,
  PURCHASE_ORDER_IMPUTATIONS,
  PURCHASE_ORDER_LINE_KINDS,
  PURCHASE_ORDER_PRICE_PER,
  type PurchaseOrderLineKind,
  type PurchaseOrderPricePer,
} from "@/lib/purchase-orders/line-kinds";
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

/**
 * TI-691, delivery 3a: a line is an article (the default), the supplier's shipping or a global discount. Shipping and
 * discounts are amounts of the order, not articles (no productId): their unit price is the amount, kept >= 0, and a
 * discount is subtracted (the database stores its totals negative). A price may be given for 10, 100 or 1 000 units
 * (`pricePer`); the line total is quantity x price / pricePer, rounded half away from zero to the cent. An existing
 * line keeps its kind, its lot when `pricePer` is left out, and what a material request gave it (request line,
 * imputation, affaire, category), which this payload never carries.
 */
export {
  PURCHASE_ORDER_AMOUNT_LINE_DESIGNATIONS,
  PURCHASE_ORDER_AMOUNT_LINE_UNIT,
  PURCHASE_ORDER_DELIVERY_MODES,
  PURCHASE_ORDER_IMPUTATIONS,
  PURCHASE_ORDER_LINE_KINDS,
  PURCHASE_ORDER_PRICE_PER,
  type PurchaseOrderLineKind,
  type PurchaseOrderPricePer,
};

const pricePerSchema = z.union([z.literal(1), z.literal(10), z.literal(100), z.literal(1000)]);

const purchaseOrderLineObject = z.object({
  id: z.string().uuid(UUID_ERROR_MESSAGE).nullable().optional(),
  productId: z.string().uuid(UUID_ERROR_MESSAGE).nullable().optional(),
  reference: z.string().nullable().optional(),
  designation: z.string().trim(),
  quantity: z.number().finite().positive().max(MAX_ORDER_QUANTITY).refine(isValidOrderQuantity, {
    message: "La quantité doit avoir au plus trois décimales.",
  }).describe("Quantité positive, au plus trois décimales effectives, sans arrondi implicite."),
  unit: z.string().refine((value) => value.trim().length > 0, "L'unité est requise.").nullable().optional(),
  unitPriceCents: z.number().int().min(0).max(MAX_ORDER_AMOUNT_CENTS),
  taxRateBp: z.number().int().min(0).max(10000),
  lineKind: z.enum(PURCHASE_ORDER_LINE_KINDS).optional()
    .describe("article (défaut), shipping (port) ou discount (remise, soustraite) ; ne change pas sur une ligne existante."),
  pricePer: pricePerSchema.optional()
    .describe("Le prix HT s'entend pour 1 (défaut), 10, 100 ou 1 000 unités ; laissé absent, une ligne existante garde le sien."),
}).strict();

type LineObject = z.infer<typeof purchaseOrderLineObject>;

function isAmountLine(item: Pick<LineObject, "lineKind">): item is { lineKind: "shipping" | "discount" } {
  return item.lineKind === "shipping" || item.lineKind === "discount";
}

function checkLine(item: Omit<LineObject, "id"> & { id?: string | null }, context: z.RefinementCtx) {
  if (isAmountLine(item)) {
    if (item.productId) context.addIssue({
      code: z.ZodIssueCode.custom, path: ["productId"], message: "Un port ou une remise ne porte pas d'article.",
    });
    // A lump sum: its amount is its price. The database holds the same rule for a line kept without its kind.
    if (item.quantity !== 1) context.addIssue({
      code: z.ZodIssueCode.custom, path: ["quantity"], message: "Un port ou une remise est un forfait : sa quantité est 1.",
    });
    return;
  }
  if (item.designation.length === 0) context.addIssue({
    code: z.ZodIssueCode.custom, path: ["designation"], message: "La désignation est requise.",
  });
}

/** Shipping and discounts get their usual name and a lump-sum unit when the client leaves them empty. */
function withAmountDefaults<T extends Omit<LineObject, "id"> & { id?: string | null }>(item: T): T {
  if (!isAmountLine(item)) return item;
  return {
    ...item,
    designation: item.designation || PURCHASE_ORDER_AMOUNT_LINE_DESIGNATIONS[item.lineKind],
    ...(!item.id && !item.unit?.trim() ? { unit: PURCHASE_ORDER_AMOUNT_LINE_UNIT } : {}),
  };
}

export const purchaseOrderLineSchema = purchaseOrderLineObject.superRefine(checkLine).transform(withAmountDefaults);

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
  items: z.array(purchaseOrderLineObject.omit({ id: true }).superRefine(checkLine).transform(withAmountDefaults))
    .min(1).max(1000),
}).strict().superRefine((payload, context) => requireNewLineUnit(payload.items, context));

export const updatePurchaseOrderSchema = z.object({
  ...headerShape,
  supplierId: headerShape.supplierId.optional(),
  // An order made from a material request may have no site (its delivery mode says how it is delivered): left out,
  // the order keeps what it has.
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
  // An order made from a material request may have no site.
  suppliers: orderLookupSchema.nullable(), delivery_sites: orderLookupSchema.nullable(),
  /** TI-691: the affaire of an order made from a material request (project: null when the caller cannot read it). */
  project_id: z.string().uuid().nullable(),
  project: orderLookupSchema.nullable(),
  delivery_mode: z.enum(PURCHASE_ORDER_DELIVERY_MODES).nullable(),
});

export const purchaseOrderStoredItemSchema = z.object({
  id: z.string().uuid(), purchase_order_id: z.string().uuid(),
  designation: z.string(), reference: z.string().nullable(), quantity: z.number().finite().positive(),
  unit: z.string().nullable(), price_unit: z.string().nullable(), product_id: z.string().uuid().nullable(),
  is_source_linked: z.boolean(), source_estimate_item_id: z.string().uuid().nullable(),
  source_selected_supplier_price_id: z.string().uuid().nullable(), tax_rate_bp: z.number().int(),
  unit_price_ht_cents: z.number().int(),
  // A discount's totals are negative: it is subtracted.
  line_total_ht_cents: z.number().int(),
  line_tax_cents: z.number().int(), line_total_ttc_cents: z.number().int(),
  /** TI-691: article, shipping or discount; the lot the unit price is for. */
  line_kind: z.enum(PURCHASE_ORDER_LINE_KINDS),
  price_per: pricePerSchema,
  /** TI-691: the material request line it orders (its request: material_request_id, when the caller reads it). */
  material_request_line_id: z.string().uuid().nullable(),
  material_request_id: z.string().uuid().nullable(),
  /** TI-691: what its cost is imputed to (null on orders without an affaire), and the article's supply type. */
  project_id: z.string().uuid().nullable(),
  imputation: z.enum(PURCHASE_ORDER_IMPUTATIONS).nullable(),
  overhead_category: z.string().nullable(),
  supply_type_id: z.string().uuid().nullable(),
  supply_type_name: z.string().nullable(),
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
