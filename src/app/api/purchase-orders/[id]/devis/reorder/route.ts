import { readAllRows } from "@/lib/supabase/read-all";
import { NextResponse } from "next/server";

import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { apiFailure, toErrorResponse } from "@/lib/http/api-response";
import {
  canWritePurchaseOrders,
  getAccessiblePurchaseOrderOrNull,
} from "@/lib/purchase-orders/access";
import type { OrderStatus } from "@/lib/purchase-orders/lifecycle";

type ReorderRequestBody = {
  orderedIds: string[];
};

export async function PATCH(
  request: Request,
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

  let body: ReorderRequestBody;
  try {
    body = await request.json();
  } catch {
    return apiFailure(400, "BAD_REQUEST", "Invalid JSON payload");
  }

  const { orderedIds } = body;

  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return apiFailure(400, "BAD_REQUEST", "orderedIds must be a non-empty array");
  }

  const uniqueOrderedIds = new Set(orderedIds);
  if (uniqueOrderedIds.size !== orderedIds.length) {
    return apiFailure(400, "BAD_REQUEST", "orderedIds doit contenir des identifiants uniques.");
  }

  const order = await getAccessiblePurchaseOrderOrNull<{
    id: string;
    tenant_id: string;
    status: OrderStatus;
  }>(supabase, id, "id, tenant_id, status");

  if (!order) {
    return apiFailure(404, "NOT_FOUND", "Bon de commande introuvable.");
  }

  if (order.tenant_id !== tenantId) {
    return apiFailure(404, "NOT_FOUND", "Bon de commande introuvable.");
  }

  if (!(await canWritePurchaseOrders(supabase, userId, order.tenant_id))) {
    return apiFailure(403, "FORBIDDEN", "Cette action est réservée aux administrateurs et aux chiffreurs.");
  }

  if (order.status === "canceled") {
    return apiFailure(403, "FORBIDDEN", "Les bons de commande annules ne peuvent plus être reordonnes.");
  }

  const { data: existingDevis, error: fetchError } = await readAllRows(() => supabase
    .from("purchase_order_devis")
    .select("id", { count: "exact" })
    .eq("purchase_order_id", id));

  if (fetchError) {
    console.error("Impossible de charger la liste des devis.", fetchError);
    return apiFailure(400, "BAD_REQUEST", "Impossible de charger la liste des devis.");
  }

  const existing = existingDevis ?? [];
  const existingIds = new Set(existing.map((d) => d.id));

  if (existing.length === 0) {
    return apiFailure(400, "BAD_REQUEST", "Aucun devis à reordonner pour cette commande.");
  }

  if (orderedIds.length !== existing.length) {
    return apiFailure(400, "BAD_REQUEST", "La liste de reordonnancement est incomplete.");
  }

  for (const devisId of orderedIds) {
    if (!existingIds.has(devisId)) {
      return apiFailure(400, "BAD_REQUEST", `Devis ${devisId} non trouve dans cette commande.`);
    }
  }

  const { data: updatedCount, error: reorderError } = await supabase.rpc(
    "reorder_purchase_order_devis",
    {
      target_purchase_order_id: id,
      ordered_devis_ids: orderedIds,
    }
  );

  if (reorderError) {
    console.error("Impossible de réordonner les devis.", reorderError);
    return apiFailure(400, "BAD_REQUEST", "Impossible de réordonner les devis.");
  }

  if ((updatedCount ?? 0) !== orderedIds.length) {
    return apiFailure(409, "CONFLICT", "La liste de reordonnancement est desynchronisee.");
  }

  return NextResponse.json({ success: true });
}
