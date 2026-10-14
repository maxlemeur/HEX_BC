import { NextResponse } from "next/server";

import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { ApiError } from "@/lib/estimates/errors";
import { computeTotalsFromInputs } from "@/lib/order-calculations";
import { canWritePurchaseOrders } from "@/lib/purchase-orders";
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
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
  const { supabase, userId, tenantId } = context;
  if (!(await canWritePurchaseOrders(supabase, userId, tenantId))) {
    return NextResponse.json({ error: "Cette action est réservée aux administrateurs et aux chiffreurs." }, { status: 403 });
  }
  const parsed = createPurchaseOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: purchaseOrderInputError(parsed.error.issues) }, { status: 400 });
  }
  const payload = parsed.data;
  try {
    computeTotalsFromInputs(payload.items.map((item) => ({
      quantity: item.quantity, unitPriceHtCents: item.unitPriceCents, taxRateBp: item.taxRateBp,
    })));
  } catch {
    return NextResponse.json({ error: "Le montant dépasse la capacité d'une commande." }, { status: 400 });
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
    return NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.status });
  }
  const receipt = purchaseOrderWriteReceiptSchema.safeParse(data);
  if (!receipt.success || !receipt.data.reference) {
    return NextResponse.json({ error: "Réponse de création invalide. Vérifiez la liste des commandes avant de réessayer." }, { status: 500 });
  }
  return NextResponse.json({ id: receipt.data.id, reference: receipt.data.reference, editRevision: receipt.data.edit_revision });
}
