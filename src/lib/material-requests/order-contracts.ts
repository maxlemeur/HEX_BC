import { z } from "zod";

import type { MaterialRequestDeliveryPlace } from "./contracts";

/**
 * Purchase orders from a material request (TI-691, lot 2 « l'achat », delivery 3a « bons de commande depuis les
 * demandes »). The office turns the lines that are ready into draft purchase orders, one per supplier, all imputed to
 * the request's affaire; the lines imputed to overhead (frais généraux) follow in their supplier's draft, imputed to
 * overhead. Each order line keeps its request line (and so the technician), the retained quote's price for its lot
 * (`price_per` units) and the imputation of the line. This module is the contract shared by the server, the API and
 * the screens; nothing here touches the network.
 *
 * A line is ready when it is validated, priced by a retained quote (which gave it its supplier) and not yet in an
 * order that is not canceled. A line is ordered once: canceling its order makes it ready again. Money is in integer
 * cents excluding tax (HT); the amount of a line is quantity x price / price_per, rounded half away from zero to the
 * cent. The tax rate of a new order line is 20 % (2 000 basis points), as the manual order form proposes it.
 */

/** A request line held by an order that is not canceled: the order and its status. */
export type MaterialRequestOrderLine = {
  line_id: string;
  purchase_order_id: string;
  purchase_order_reference: string;
  status: string;
};

/** Why a line that is not ordered cannot be ordered yet, in the order the office settles them. */
export const MATERIAL_REQUEST_ORDER_NOT_READY_REASONS = ["not_validated", "no_supplier", "not_priced"] as const;
export type MaterialRequestOrderNotReadyReason = (typeof MATERIAL_REQUEST_ORDER_NOT_READY_REASONS)[number];

/** Answer of GET …/orders: where each line of the request stands, and the orders made from it. */
export type MaterialRequestOrdersSummary = {
  /** Validated, priced by a retained quote, not in an order that is not canceled; in the request's order. */
  ready_line_ids: string[];
  /** Every other line that is not ordered, with the first thing it lacks; in the request's order. */
  not_ready: Array<{ line_id: string; reason: MaterialRequestOrderNotReadyReason }>;
  /** Lines held by an order that is not canceled; in the request's order. */
  ordered: MaterialRequestOrderLine[];
  /** The caller may create orders here: a writer of the request (owner of the affaire or admin) who may buy (admin or engineer). */
  can_create: boolean;
  /**
   * Every order holding a line of this request, canceled ones included, oldest first. `line_count` counts the lines of
   * this request it holds (not its shipping or discount lines); `total_ht_cents` is the order's whole total.
   */
  orders: Array<{
    id: string;
    reference: string;
    supplier_name: string;
    status: string;
    total_ht_cents: number;
    line_count: number;
  }>;
};

/** One draft created by POST …/orders. */
export type MaterialRequestCreatedOrder = {
  id: string;
  reference: string;
  supplier_name: string;
  /** « draft » when created; on a replay, the order's status as it now stands. */
  status: string;
  /** Lines of the request it holds. */
  line_count: number;
  total_ht_cents: number;
};

/** Answer of POST …/orders: 201 when created, 200 when the same key was already answered (`replayed`). */
export type MaterialRequestOrdersCreated = {
  orders: MaterialRequestCreatedOrder[];
  replayed: boolean;
};

/** The body of POST …/orders. A new key per click: the same key gives the same answer and creates nothing. */
export const createMaterialRequestOrdersSchema = z
  .object({ idempotency_key: z.string().uuid("Clé d'idempotence invalide.") })
  .strict();
export type CreateMaterialRequestOrdersInput = z.input<typeof createMaterialRequestOrdersSchema>;
export type CreateMaterialRequestOrdersData = z.output<typeof createMaterialRequestOrdersSchema>;

/** How an order made from a request is delivered: the request's delivery place, copied. */
export type PurchaseOrderDeliveryMode = MaterialRequestDeliveryPlace;
export const PURCHASE_ORDER_DELIVERY_MODE_LABELS: Record<PurchaseOrderDeliveryMode, string> = {
  site: "Livraison sur chantier",
  office: "Livraison au bureau",
  counter: "Retrait au comptoir",
};

/** The tax rate of the lines of a draft made from a request, as the manual order form proposes it. */
export const MATERIAL_REQUEST_ORDER_TAX_RATE_BP = 2000;

/** Error codes of the order routes, beside the generic ones (FORBIDDEN, NOT_FOUND, VALIDATION_ERROR). */
/** 422: no line of the request is ready to be ordered. */
export const MATERIAL_REQUEST_ORDER_NOTHING_READY = "MATERIAL_REQUEST_ORDER_NOTHING_READY";
/** 409: a line is already in an order that is not canceled (another session ordered it meanwhile). */
export const MATERIAL_REQUEST_LINE_ALREADY_ORDERED = "MATERIAL_REQUEST_LINE_ALREADY_ORDERED";
/** 422: the supplier of ready lines is archived; details.supplier_names names them. */
export const MATERIAL_REQUEST_ORDER_SUPPLIER_INACTIVE = "MATERIAL_REQUEST_ORDER_SUPPLIER_INACTIVE";
/** 409: the key was used by another member; a new key is needed. */
export const MATERIAL_REQUEST_ORDER_KEY_TAKEN = "MATERIAL_REQUEST_ORDER_KEY_TAKEN";
/** 409: another write on the same lines was in progress; nothing was created, try again. */
export const MATERIAL_REQUEST_ORDER_BUSY = "MATERIAL_REQUEST_ORDER_BUSY";
/** 409 on DELETE of a request: lines of it are in an order that is not canceled. */
export const MATERIAL_REQUEST_ORDERED = "MATERIAL_REQUEST_ORDERED";
/**
 * 409 on the line routes: a line in an order that is not canceled does not return to draft, neither reopened nor by
 * an edit of what it says (zone, imputation, the technician's words); details: line_ids, positions, references.
 */
export const MATERIAL_REQUEST_LINE_ORDERED = "MATERIAL_REQUEST_LINE_ORDERED";
