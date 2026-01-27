import { NextResponse } from "next/server";

import { computeTotalsFromInputs } from "@/lib/order-calculations";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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

function toNullableString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const userPromise = supabase.auth.getUser();
  const payloadPromise = request.json().catch(() => null);

  const [
    {
      data: { user },
    },
    payload,
  ] = await Promise.all([userPromise, payloadPromise]);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch existing order
  const { data: existingOrder, error: fetchError } = await supabase
    .from("purchase_orders")
    .select("id, status")
    .eq("id", id)
    .single();

  if (fetchError || !existingOrder) {
    return NextResponse.json(
      { error: "Bon de commande introuvable." },
      { status: 404 }
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
  const headerUpdate: Record<string, unknown> = {};

  if (parsedPayload.supplierId !== undefined) {
    headerUpdate.supplier_id = parsedPayload.supplierId;
  }
  if (parsedPayload.deliverySiteId !== undefined) {
    headerUpdate.delivery_site_id = parsedPayload.deliverySiteId;
  }
  if (parsedPayload.expectedDeliveryDate !== undefined) {
    headerUpdate.expected_delivery_date = toNullableString(parsedPayload.expectedDeliveryDate);
  }
  if (parsedPayload.notes !== undefined) {
    headerUpdate.notes = toNullableString(parsedPayload.notes);
  }

  // Update header if there are changes
  if (Object.keys(headerUpdate).length > 0) {
    const { error: updateError } = await supabase
      .from("purchase_orders")
      .update(headerUpdate)
      .eq("id", id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }
  }

  // If items are provided, replace all existing items
  if (parsedPayload.items !== undefined) {
    const items = Array.isArray(parsedPayload.items) ? parsedPayload.items : [];
    const cleanedItems = items
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

    // Delete existing items
    const { error: deleteError } = await supabase
      .from("purchase_order_items")
      .delete()
      .eq("purchase_order_id", id);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 400 });
    }

    // Calculate totals
    const lineInputs = cleanedItems.map((item) => ({
      quantity: Math.round(item.quantity),
      unitPriceHtCents: Math.round(item.unitPriceCents),
      taxRateBp: Math.round(item.taxRateBp),
    }));

    const { lineTotals, orderTotals } = computeTotalsFromInputs(lineInputs);

    // Insert new items
    const itemsToInsert = cleanedItems.map((item, index) => {
      const totals = lineTotals[index];
      return {
        purchase_order_id: id,
        position: index + 1,
        product_id: item.productId,
        reference: item.reference,
        designation: item.designation,
        unit_price_ht_cents: Math.round(item.unitPriceCents),
        tax_rate_bp: Math.round(item.taxRateBp),
        quantity: Math.round(item.quantity),
        line_total_ht_cents: totals.lineTotalHtCents,
        line_tax_cents: totals.lineTaxCents,
        line_total_ttc_cents: totals.lineTotalTtcCents,
      };
    });

    const { error: insertError } = await supabase
      .from("purchase_order_items")
      .insert(itemsToInsert);

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 400 });
    }

    // Update order totals
    const { error: totalsError } = await supabase
      .from("purchase_orders")
      .update({
        total_ht_cents: orderTotals.totalHtCents,
        total_tax_cents: orderTotals.totalTaxCents,
        total_ttc_cents: orderTotals.totalTtcCents,
      })
      .eq("id", id);

    if (totalsError) {
      return NextResponse.json({ error: totalsError.message }, { status: 400 });
    }
  }

  return NextResponse.json({ success: true, id });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch existing order
  const { data: existingOrder, error: fetchError } = await supabase
    .from("purchase_orders")
    .select("id, status")
    .eq("id", id)
    .single();

  if (fetchError || !existingOrder) {
    return NextResponse.json(
      { error: "Bon de commande introuvable." },
      { status: 404 }
    );
  }

  // Check if order is in draft status
  if (existingOrder.status !== "draft") {
    return NextResponse.json(
      { error: "Seuls les bons de commande en brouillon peuvent etre supprimes." },
      { status: 403 }
    );
  }

  // Delete the order (items are deleted via cascade)
  const { error: deleteError } = await supabase
    .from("purchase_orders")
    .delete()
    .eq("id", id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
