import { NextResponse } from "next/server";

import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { apiFailure, toErrorResponse } from "@/lib/http/api-response";
import { drainProcurementStorageCleanupOutbox } from "@/lib/procurement/storage-cleanup-outbox";
import {
  canWritePurchaseOrders,
  getAccessiblePurchaseOrderOrNull,
} from "@/lib/purchase-orders/access";
import { computeTotalsFromInputs, OrderTotalNegativeError } from "@/lib/order-calculations";
import { updatePurchaseOrderSchema, purchaseOrderWriteReceiptSchema } from "@/lib/purchase-orders/schemas";
import type { OrderStatus } from "@/lib/purchase-orders/lifecycle";
import { purchaseOrderInputError, purchaseOrderWriteError, toPurchaseOrderLinePayload } from "@/lib/purchase-orders/write";
import type { Json } from "@/types/database";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let context;
  let payload;
  try {
    [context, payload] = await Promise.all([
      getAuthenticatedTenantContext(),
      request.json().catch(() => null),
    ]);
  } catch (error) {
    return toErrorResponse(error);
  }

  const { supabase, userId, tenantId } = context;

  const existingOrder = await getAccessiblePurchaseOrderOrNull<{
    id: string;
    status: OrderStatus;
    tenant_id: string;
  }>(supabase, id, "id, status, tenant_id");

  if (!existingOrder) {
    return apiFailure(404, "NOT_FOUND", "Bon de commande introuvable.");
  }

  if (existingOrder.tenant_id !== tenantId) {
    return apiFailure(404, "NOT_FOUND", "Bon de commande introuvable.");
  }

  if (!(await canWritePurchaseOrders(supabase, userId, existingOrder.tenant_id))) {
    return apiFailure(403, "FORBIDDEN", "Cette action est réservée aux administrateurs et aux chiffreurs.");
  }

  if (existingOrder.status !== "draft") {
    return apiFailure(403, "FORBIDDEN", "Seuls les bons de commande en brouillon peuvent être modifiés.");
  }

  const parsed = updatePurchaseOrderSchema.safeParse(payload);
  if (!parsed.success) {
    return apiFailure(400, "VALIDATION_ERROR", purchaseOrderInputError(parsed.error.issues));
  }
  const input = parsed.data;
  const header: Record<string, Json> = {};
  if (input.supplierId !== undefined) header.supplier_id = input.supplierId;
  if (input.deliverySiteId !== undefined) header.delivery_site_id = input.deliverySiteId;
  if (input.expectedDeliveryDate !== undefined) header.expected_delivery_date = input.expectedDeliveryDate;
  if (input.notes !== undefined) header.notes = input.notes || null;
  try {
    // A friendly check before the database, only when every line's lot is known: an existing line sent without its
    // lot keeps its own (a request line priced for 1 000), which only the database reads. It has the last word either
    // way (PURCHASE_ORDER_TOTAL_NEGATIVE, PURCHASE_ORDER_AMOUNT_OUT_OF_RANGE).
    if (input.items?.every((item) => !item.id || item.pricePer !== undefined)) computeTotalsFromInputs(input.items.map((item) => ({
      quantity: item.quantity, unitPriceHtCents: item.unitPriceCents, taxRateBp: item.taxRateBp,
      pricePer: item.pricePer, kind: item.lineKind,
    })));
  } catch (error) {
    return apiFailure(400, "BAD_REQUEST", error instanceof OrderTotalNegativeError ? error.message : "Le montant dépasse la capacité d'une commande.");
  }
  const { data, error } = await supabase.rpc("replace_purchase_order_draft", {
    p_order_id: id,
    p_header_patch: header,
    p_items: input.items?.map(toPurchaseOrderLinePayload) ?? null,
    p_expected_revision: input.expectedRevision,
  });
  if (error) {
    const failure = purchaseOrderWriteError(error);
    return apiFailure(failure.status, failure.code, failure.message);
  }
  const receipt = purchaseOrderWriteReceiptSchema.safeParse(data);
  if (!receipt.success || receipt.data.id !== id.toLowerCase()) {
    return apiFailure(500, "INTERNAL_ERROR", "Réponse de sauvegarde invalide. Rechargez la commande avant de réessayer.");
  }
  return NextResponse.json({ success: true, id: receipt.data.id, editRevision: receipt.data.edit_revision });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let context;
  try {
    context = await getAuthenticatedTenantContext();
  } catch (error) {
    return toErrorResponse(error);
  }

  const { supabase, userId, tenantId } = context;

  const existingOrder = await getAccessiblePurchaseOrderOrNull<{
    id: string;
    status: OrderStatus;
    tenant_id: string;
  }>(supabase, id, "id, status, tenant_id");

  if (!existingOrder) {
    return apiFailure(404, "NOT_FOUND", "Bon de commande introuvable.");
  }

  if (existingOrder.tenant_id !== tenantId) {
    return apiFailure(404, "NOT_FOUND", "Bon de commande introuvable.");
  }

  if (!(await canWritePurchaseOrders(supabase, userId, existingOrder.tenant_id))) {
    return apiFailure(403, "FORBIDDEN", "Cette action est réservée aux administrateurs et aux chiffreurs.");
  }

  if (existingOrder.status !== "draft") {
    return apiFailure(403, "FORBIDDEN", "Seuls les bons de commande en brouillon peuvent être supprimés.");
  }

  const { error: deleteError } = await supabase.rpc(
    "delete_purchase_order_draft_atomic",
    { p_order_id: id }
  );

  if (deleteError) {
    if (deleteError.message.includes("PURCHASE_ORDER_DRAFT_NOT_DELETABLE")) {
      return apiFailure(403, "FORBIDDEN", "Seuls les bons de commande en brouillon peuvent être supprimés.");
    }

    console.error("Impossible de supprimer le bon de commande.", deleteError);
    return apiFailure(400, "BAD_REQUEST", "Impossible de supprimer le bon de commande.");
  }

  try {
    await drainProcurementStorageCleanupOutbox({
      tenantId: existingOrder.tenant_id,
      limit: 25,
    });
  } catch (error) {
    console.error("Purchase order Storage cleanup drain failed", {
      orderId: id,
      tenantId: existingOrder.tenant_id,
      error,
    });
  }

  return NextResponse.json({ success: true });
}
