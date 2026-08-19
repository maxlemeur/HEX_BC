import { NextResponse } from "next/server";

import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { isValidDateOnly } from "@/lib/date-only";
import { ApiError } from "@/lib/estimates/errors";
import { computeTotalsFromInputs } from "@/lib/order-calculations";
import { canWritePurchaseOrders } from "@/lib/purchase-orders";
import { buildPurchaseOrderReference } from "@/lib/reference";

function jsonApiError(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  throw error;
}

type LinePayload = {
  designation: string;
  quantity: number;
  unitPriceCents: number;
  taxRateBp: number;
};

type CreatePurchaseOrderPayload = {
  supplierId: string;
  deliverySiteId: string;
  expectedDeliveryDate?: string | null;
  notes?: string | null;
  items: LinePayload[];
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

export async function POST(request: Request) {
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

  if (!(await canWritePurchaseOrders(supabase, userId, tenantId))) {
    return NextResponse.json(
      { error: "Cette action est reservee aux administrateurs et aux chiffreurs." },
      { status: 403 }
    );
  }

  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }
  const parsedPayload = payload as CreatePurchaseOrderPayload;

  if (!parsedPayload?.supplierId || !parsedPayload?.deliverySiteId) {
    return NextResponse.json(
      { error: "Supplier and delivery site are required." },
      { status: 400 }
    );
  }

  let expectedDeliveryDate: string | null;
  try {
    expectedDeliveryDate = parseExpectedDeliveryDate(parsedPayload.expectedDeliveryDate);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Date de livraison invalide." },
      { status: 400 }
    );
  }

  const items = Array.isArray(parsedPayload.items) ? parsedPayload.items : [];
  const cleanedItems = items
    .map((item) => ({
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
      { error: "At least one valid item is required." },
      { status: 400 }
    );
  }

  // Ne pas arrondir silencieusement la quantité : un arrondi sur/sous-commande
  // de la matière chez le fournisseur (2,5 t -> 3 t) et peut tomber à 0 (viol
  // du CHECK quantity > 0). On rejette explicitement, comme le pipeline de
  // brouillon (non_integer_quantity).
  if (cleanedItems.some((item) => !Number.isInteger(item.quantity))) {
    return NextResponse.json(
      {
        error:
          "Les quantités doivent être des nombres entiers. Ajustez la quantité ou l'unité de commande.",
      },
      { status: 400 }
    );
  }

  const lineInputs = cleanedItems.map((item) => ({
    quantity: item.quantity,
    unitPriceHtCents: Math.round(item.unitPriceCents),
    taxRateBp: Math.round(item.taxRateBp),
  }));

  const { lineTotals, orderTotals } = computeTotalsFromInputs(lineInputs);

  // Insert order with temporary reference, get order_number
  const orderDate = new Date();
  const tempReference = `TEMP-${Date.now()}`;

  const { data: insertedOrder, error: insertError } = await supabase
    .from("purchase_orders")
    .insert({
      reference: tempReference,
      user_id: userId,
      supplier_id: parsedPayload.supplierId,
      delivery_site_id: parsedPayload.deliverySiteId,
      status: "draft",
      expected_delivery_date: expectedDeliveryDate,
      notes: toNullableString(parsedPayload.notes),
      total_ht_cents: orderTotals.totalHtCents,
      total_tax_cents: orderTotals.totalTaxCents,
      total_ttc_cents: orderTotals.totalTtcCents,
      currency: "EUR",
    })
    .select("id, order_number")
    .single();

  if (insertError || !insertedOrder) {
    return NextResponse.json(
      { error: insertError?.message ?? "Unable to create purchase order." },
      { status: 400 }
    );
  }

  const orderId = insertedOrder.id;
  const orderNumber = insertedOrder.order_number as number;

  // Generate final reference using order_number: C-AAMM-XXX
  const finalReference = buildPurchaseOrderReference(orderNumber, orderDate);

  // Update order with final reference
  const { error: updateError } = await supabase
    .from("purchase_orders")
    .update({ reference: finalReference })
    .eq("id", orderId);

  if (updateError) {
    await supabase.from("purchase_orders").delete().eq("id", orderId);
    return NextResponse.json(
      { error: "Unable to set order reference." },
      { status: 400 }
    );
  }

  // Insert order items
  const itemsToInsert = cleanedItems.map((item, index) => {
    const totals = lineTotals[index];
    return {
      purchase_order_id: orderId,
      position: index + 1,
      designation: item.designation,
      unit_price_ht_cents: Math.round(item.unitPriceCents),
      tax_rate_bp: Math.round(item.taxRateBp),
      quantity: item.quantity,
      line_total_ht_cents: totals.lineTotalHtCents,
      line_tax_cents: totals.lineTaxCents,
      line_total_ttc_cents: totals.lineTotalTtcCents,
    };
  });

  const { error: itemsError } = await supabase
    .from("purchase_order_items")
    .insert(itemsToInsert);

  if (itemsError) {
    await supabase.from("purchase_orders").delete().eq("id", orderId);
    return NextResponse.json({ error: itemsError.message }, { status: 400 });
  }

  return NextResponse.json({ id: orderId, reference: finalReference });
}
