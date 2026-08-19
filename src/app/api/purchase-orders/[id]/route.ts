import { NextResponse } from "next/server";

import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { isValidDateOnly } from "@/lib/date-only";
import { ApiError } from "@/lib/estimates/errors";
import { drainProcurementStorageCleanupOutbox } from "@/lib/procurement/storage-cleanup-outbox";
import {
  canWritePurchaseOrders,
  getAccessiblePurchaseOrderOrNull,
} from "@/lib/purchase-orders";
import type { Database } from "@/types/database";

function jsonApiError(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  throw error;
}

type PurchaseOrderStatus = Database["public"]["Tables"]["purchase_orders"]["Row"]["status"];

type LinePayload = {
  productId: string | null;
  reference?: string | null;
  designation: string;
  quantity: number;
  unitPriceCents: number;
  taxRateBp: number;
};

type UpdatePurchaseOrderPayload = {
  supplierId?: string;
  deliverySiteId?: string;
  expectedDeliveryDate?: string | null;
  notes?: string | null;
  items?: LinePayload[];
};

type CleanedLineItem = {
  productId: string | null;
  reference: string | null;
  designation: string;
  quantity: number;
  unitPriceCents: number;
  taxRateBp: number;
};

function toNullableString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseExpectedDeliveryDate(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error("Date de livraison invalide.");
  }

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.toUpperCase() === "TBD") return "TBD";

  if (!isValidDateOnly(trimmed)) {
    throw new Error("Date de livraison invalide (YYYY-MM-DD attendu).");
  }

  return trimmed;
}

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
      { error: "Cette action est reservee aux administrateurs et aux chiffreurs." },
      { status: 403 }
    );
  }

  // Check if order is in draft status
  if (existingOrder.status !== "draft") {
    return NextResponse.json(
      { error: "Seuls les bons de commande en brouillon peuvent etre modifies." },
      { status: 403 }
    );
  }

  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }
  const parsedPayload = payload as UpdatePurchaseOrderPayload;

  // Build update object for header fields
  const headerUpdate: Database["public"]["Tables"]["purchase_orders"]["Update"] = {};

  if (parsedPayload.supplierId !== undefined) {
    headerUpdate.supplier_id = parsedPayload.supplierId;
  }
  if (parsedPayload.deliverySiteId !== undefined) {
    headerUpdate.delivery_site_id = parsedPayload.deliverySiteId;
  }
  if (parsedPayload.expectedDeliveryDate !== undefined) {
    try {
      headerUpdate.expected_delivery_date = parseExpectedDeliveryDate(
        parsedPayload.expectedDeliveryDate
      );
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Date de livraison invalide." },
        { status: 400 }
      );
    }
  }
  if (parsedPayload.notes !== undefined) {
    headerUpdate.notes = toNullableString(parsedPayload.notes);
  }

  let itemsToReplace: Array<{
    product_id: string | null;
    reference: string | null;
    designation: string;
    quantity: number;
    unit_price_ht_cents: number;
    tax_rate_bp: number;
  }> | null = null;

  if (parsedPayload.items !== undefined) {
    const items = Array.isArray(parsedPayload.items) ? parsedPayload.items : [];
    const cleanedItems: CleanedLineItem[] = items
      .map((item) => ({
        productId: item.productId ?? null,
        reference: toNullableString(item.reference ?? null),
        designation: typeof item.designation === "string" ? item.designation.trim() : "",
        quantity: Number(item.quantity),
        unitPriceCents: Number(item.unitPriceCents),
        taxRateBp: Number(item.taxRateBp),
      }))
      .filter(
        (item) =>
          item.designation.length > 0 &&
          Number.isFinite(item.quantity) &&
          Number.isFinite(item.unitPriceCents) &&
          Number.isFinite(item.taxRateBp) &&
          item.quantity > 0 &&
          item.unitPriceCents >= 0 &&
          item.taxRateBp >= 0 &&
          item.taxRateBp <= 10000
      );

    if (cleanedItems.length === 0) {
      return NextResponse.json(
        { error: "Au moins une ligne valide est requise." },
        { status: 400 }
      );
    }

    if (cleanedItems.some((item) => !Number.isInteger(item.quantity))) {
      return NextResponse.json(
        {
          error:
            "Les quantités doivent être des nombres entiers. Ajustez la quantité ou l'unité de commande.",
        },
        { status: 400 }
      );
    }

    itemsToReplace = cleanedItems.map((item) => ({
        product_id: item.productId,
        reference: item.reference,
        designation: item.designation,
        unit_price_ht_cents: Math.round(item.unitPriceCents),
        tax_rate_bp: Math.round(item.taxRateBp),
        quantity: item.quantity,
    }));
  }

  const { error: replaceError } = await supabase.rpc(
    "replace_purchase_order_draft",
    {
      p_order_id: id,
      p_header_patch: headerUpdate,
      p_items: itemsToReplace,
    }
  );

  if (replaceError) {
    if (replaceError.message.includes("PURCHASE_ORDER_DRAFT_NOT_EDITABLE")) {
      return NextResponse.json(
        { error: "Seuls les bons de commande en brouillon peuvent etre modifies." },
        { status: 403 }
      );
    }

    return NextResponse.json({ error: replaceError.message }, { status: 400 });
  }

  return NextResponse.json({ success: true, id });
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
      { error: "Cette action est reservee aux administrateurs et aux chiffreurs." },
      { status: 403 }
    );
  }

  // Check if order is in draft status
  if (existingOrder.status !== "draft") {
    return NextResponse.json(
      { error: "Seuls les bons de commande en brouillon peuvent etre supprimes." },
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
        { error: "Seuls les bons de commande en brouillon peuvent etre supprimes." },
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
