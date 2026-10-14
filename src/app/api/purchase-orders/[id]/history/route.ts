import { NextResponse } from "next/server";
import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { ApiError } from "@/lib/estimates/errors";
import { getAccessiblePurchaseOrderOrNull } from "@/lib/purchase-orders";
import { purchaseOrderItemHistorySchema } from "@/lib/purchase-orders/schemas";
import { purchaseOrderWriteError } from "@/lib/purchase-orders/write";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let context;
  try {
    context = await getAuthenticatedTenantContext();
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
  const order = await getAccessiblePurchaseOrderOrNull<{ tenant_id: string }>(context.supabase, id, "tenant_id");
  if (!order || order.tenant_id !== context.tenantId) {
    return NextResponse.json({ error: "Bon de commande introuvable." }, { status: 404 });
  }
  const { data, error } = await context.supabase.rpc("get_purchase_order_item_history", { p_order_id: id });
  if (error) {
    const failure = purchaseOrderWriteError(error);
    return NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.status });
  }
  const history = purchaseOrderItemHistorySchema.safeParse(data);
  if (!history.success) {
    return NextResponse.json({ error: "Impossible de lire l'historique des lignes." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, data: history.data }, { headers: { "Cache-Control": "private, no-store" } });
}
