import { NextResponse } from "next/server";
import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { ApiError, apiFailure, toErrorResponse } from "@/lib/http/api-response";
import { getAccessiblePurchaseOrderOrNull } from "@/lib/purchase-orders/access";
import { purchaseOrderItemHistorySchema } from "@/lib/purchase-orders/schemas";
import { purchaseOrderWriteError } from "@/lib/purchase-orders/write";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let context;
  try {
    context = await getAuthenticatedTenantContext();
  } catch (error) {
    if (error instanceof ApiError) {
      return toErrorResponse(error);
    }
    throw error;
  }
  const order = await getAccessiblePurchaseOrderOrNull<{ tenant_id: string }>(context.supabase, id, "tenant_id");
  if (!order || order.tenant_id !== context.tenantId) {
    return apiFailure(404, "NOT_FOUND", "Bon de commande introuvable.");
  }
  const { data, error } = await context.supabase.rpc("get_purchase_order_item_history", { p_order_id: id });
  if (error) {
    const failure = purchaseOrderWriteError(error);
    return apiFailure(failure.status, failure.code, failure.message);
  }
  const history = purchaseOrderItemHistorySchema.safeParse(data);
  if (!history.success) {
    return apiFailure(500, "INTERNAL_ERROR", "Impossible de lire l'historique des lignes.");
  }
  return NextResponse.json({ ok: true, data: history.data }, { headers: { "Cache-Control": "private, no-store" } });
}
