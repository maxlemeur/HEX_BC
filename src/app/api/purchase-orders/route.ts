import { NextResponse } from "next/server";

import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { ApiError, apiFailure, toErrorResponse } from "@/lib/http/api-response";
import { computeTotalsFromInputs, OrderTotalNegativeError } from "@/lib/order-calculations";
import { canWritePurchaseOrders } from "@/lib/purchase-orders/access";
import { createPurchaseOrderSchema, purchaseOrderWriteReceiptSchema } from "@/lib/purchase-orders/schemas";
import { purchaseOrderInputError, purchaseOrderWriteError, toPurchaseOrderLinePayload } from "@/lib/purchase-orders/write";

export async function POST(request: Request) {
  let context;
  let body: unknown;
  try {
    [context, body] = await Promise.all([
      getAuthenticatedTenantContext(), request.json().catch(() => null),
    ]);
  } catch (error) {
    if (error instanceof ApiError) {
      return toErrorResponse(error);
    }
    throw error;
  }
  const { supabase, userId, tenantId } = context;
  if (!(await canWritePurchaseOrders(supabase, userId, tenantId))) {
    return apiFailure(403, "FORBIDDEN", "Cette action est réservée aux administrateurs et aux chiffreurs.");
  }
  const parsed = createPurchaseOrderSchema.safeParse(body);
  if (!parsed.success) {
    return apiFailure(400, "VALIDATION_ERROR", purchaseOrderInputError(parsed.error.issues));
  }
  const payload = parsed.data;
  try {
    computeTotalsFromInputs(payload.items.map((item) => ({
      quantity: item.quantity, unitPriceHtCents: item.unitPriceCents, taxRateBp: item.taxRateBp,
      pricePer: item.pricePer, kind: item.lineKind,
    })));
  } catch (error) {
    return apiFailure(400, "BAD_REQUEST", error instanceof OrderTotalNegativeError ? error.message : "Le montant dépasse la capacité d'une commande.");
  }
  const { data, error } = await supabase.rpc("create_purchase_order_draft", {
    p_header: {
      supplier_id: payload.supplierId,
      delivery_site_id: payload.deliverySiteId,
      expected_delivery_date: payload.expectedDeliveryDate ?? null,
      notes: payload.notes || null,
    },
    p_items: payload.items.map(toPurchaseOrderLinePayload),
  });
  if (error) {
    const failure = purchaseOrderWriteError(error);
    return apiFailure(failure.status, failure.code, failure.message);
  }
  const receipt = purchaseOrderWriteReceiptSchema.safeParse(data);
  if (!receipt.success || !receipt.data.reference) {
    return apiFailure(500, "INTERNAL_ERROR", "Réponse de création invalide. Vérifiez la liste des commandes avant de réessayer.");
  }
  return NextResponse.json({ id: receipt.data.id, reference: receipt.data.reference, editRevision: receipt.data.edit_revision });
}
