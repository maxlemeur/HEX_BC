import { NextResponse } from "next/server";

import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { ApiError } from "@/lib/estimates/errors";
import { drainProcurementStorageCleanupOutbox } from "@/lib/procurement/storage-cleanup-outbox";
import {
  canWritePurchaseOrders,
  getAccessiblePurchaseOrderOrNull,
} from "@/lib/purchase-orders";
import { computeTotalsFromInputs } from "@/lib/order-calculations";
import { updatePurchaseOrderSchema, purchaseOrderWriteReceiptSchema } from "@/lib/purchase-orders/schemas";
import { purchaseOrderInputError, purchaseOrderWriteError, toPurchaseOrderLinePayload } from "@/lib/purchase-orders/write";
import type { Database, Json } from "@/types/database";

function jsonApiError(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  throw error;
}

type PurchaseOrderStatus = Database["public"]["Tables"]["purchase_orders"]["Row"]["status"];

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
    return jsonApiError(error);
  }

  const { supabase, userId, tenantId } = context;

  // Fetch existing order
  const existingOrder = await getAccessiblePurchaseOrderOrNull<{
    id: string;
    status: PurchaseOrderStatus;
    tenant_id: string;
  }>(supabase, id, "id, status, tenant_id");

  if (!existingOrder) {
    return NextResponse.json(
      { error: "Bon de commande introuvable." },
      { status: 404 }
    );
  }

  if (existingOrder.tenant_id !== tenantId) {
    return NextResponse.json(
      { error: "Bon de commande introuvable." },
      { status: 404 }
    );
  }

  if (!(await canWritePurchaseOrders(supabase, userId, existingOrder.tenant_id))) {
    return NextResponse.json(
      { error: "Cette action est réservée aux administrateurs et aux chiffreurs." },
      { status: 403 }
    );
  }

  // Check if order is in draft status
  if (existingOrder.status !== "draft") {
    return NextResponse.json(
      { error: "Seuls les bons de commande en brouillon peuvent être modifiés." },
      { status: 403 }
    );
  }

  const parsed = updatePurchaseOrderSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: purchaseOrderInputError(parsed.error.issues) }, { status: 400 });
  }
  const input = parsed.data;
  const header: Record<string, Json> = {};
  if (input.supplierId !== undefined) header.supplier_id = input.supplierId;
  if (input.deliverySiteId !== undefined) header.delivery_site_id = input.deliverySiteId;
  if (input.expectedDeliveryDate !== undefined) header.expected_delivery_date = input.expectedDeliveryDate;
  if (input.notes !== undefined) header.notes = input.notes || null;
  try {
    if (input.items) computeTotalsFromInputs(input.items.map((item) => ({
      quantity: item.quantity, unitPriceHtCents: item.unitPriceCents, taxRateBp: item.taxRateBp,
    })));
  } catch {
    return NextResponse.json({ error: "Le montant dépasse la capacité d'une commande." }, { status: 400 });
  }
  const { data, error } = await supabase.rpc("replace_purchase_order_draft", {
    p_order_id: id,
    p_header_patch: header,
    p_items: input.items?.map(toPurchaseOrderLinePayload) ?? null,
    p_expected_revision: input.expectedRevision,
  });
  if (error) {
    const failure = purchaseOrderWriteError(error);
    return NextResponse.json(
      { error: failure.message, ...(failure.code === "PURCHASE_ORDER_DRAFT_NOT_EDITABLE" ? {} : { code: failure.code }) },
      { status: failure.status }
    );
  }
  const receipt = purchaseOrderWriteReceiptSchema.safeParse(data);
  if (!receipt.success || receipt.data.id !== id.toLowerCase()) {
    return NextResponse.json({ error: "Réponse de sauvegarde invalide. Rechargez la commande avant de réessayer." }, { status: 500 });
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
    return jsonApiError(error);
  }

  const { supabase, userId, tenantId } = context;

  // Fetch existing order
  const existingOrder = await getAccessiblePurchaseOrderOrNull<{
    id: string;
    status: PurchaseOrderStatus;
    tenant_id: string;
  }>(supabase, id, "id, status, tenant_id");

  if (!existingOrder) {
    return NextResponse.json(
      { error: "Bon de commande introuvable." },
      { status: 404 }
    );
  }

  if (existingOrder.tenant_id !== tenantId) {
    return NextResponse.json(
      { error: "Bon de commande introuvable." },
      { status: 404 }
    );
  }

  if (!(await canWritePurchaseOrders(supabase, userId, existingOrder.tenant_id))) {
    return NextResponse.json(
      { error: "Cette action est réservée aux administrateurs et aux chiffreurs." },
      { status: 403 }
    );
  }

  // Check if order is in draft status
  if (existingOrder.status !== "draft") {
    return NextResponse.json(
      { error: "Seuls les bons de commande en brouillon peuvent être supprimés." },
      { status: 403 }
    );
  }

  const { error: deleteError } = await supabase.rpc(
    "delete_purchase_order_draft_atomic",
    { p_order_id: id }
  );

  if (deleteError) {
    if (deleteError.message.includes("PURCHASE_ORDER_DRAFT_NOT_DELETABLE")) {
      return NextResponse.json(
        { error: "Seuls les bons de commande en brouillon peuvent être supprimés." },
        { status: 403 }
      );
    }

    return NextResponse.json({ error: deleteError.message }, { status: 400 });
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
