import { NextResponse } from "next/server";

import { computeTotalsFromInputs } from "@/lib/order-calculations";
import { buildPurchaseOrderReference } from "@/lib/reference";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type LinePayload = {
  productId: string | null;
  reference?: string | null;
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

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: CreatePurchaseOrderPayload;
  try {
    payload = (await request.json()) as CreatePurchaseOrderPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (!payload?.supplierId || !payload?.deliverySiteId) {
    return NextResponse.json(
      { error: "Supplier and delivery site are required." },
      { status: 400 }
    );
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
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
      { error: "At least one valid item is required." },
      { status: 400 }
    );
  }

  const { data: supplier } = await supabase
    .from("suppliers")
    .select("name")
    .eq("id", payload.supplierId)
    .maybeSingle();

  const { data: deliverySite } = await supabase
    .from("delivery_sites")
    .select("project_code")
    .eq("id", payload.deliverySiteId)
    .maybeSingle();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  if (!supplier?.name) {
    return NextResponse.json(
      { error: "Supplier not found." },
      { status: 400 }
    );
  }

  const referenceBase = buildPurchaseOrderReference({
    supplierName: supplier.name,
    projectCode: deliverySite?.project_code ?? null,
    fullName: profile?.full_name ?? user.email ?? "Utilisateur",
  });

  const lineInputs = cleanedItems.map((item) => ({
    quantity: Math.round(item.quantity),
    unitPriceHtCents: Math.round(item.unitPriceCents),
    taxRateBp: Math.round(item.taxRateBp),
  }));

  const { lineTotals, orderTotals } = computeTotalsFromInputs(lineInputs);

  let orderId: string | null = null;
  let orderReference = referenceBase;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await supabase
      .from("purchase_orders")
      .insert({
        reference: orderReference,
        user_id: user.id,
        supplier_id: payload.supplierId,
        delivery_site_id: payload.deliverySiteId,
        status: "draft",
        expected_delivery_date: toNullableString(payload.expectedDeliveryDate),
        notes: toNullableString(payload.notes),
        total_ht_cents: orderTotals.totalHtCents,
        total_tax_cents: orderTotals.totalTaxCents,
        total_ttc_cents: orderTotals.totalTtcCents,
        currency: "EUR",
      })
      .select("id, reference")
      .single();

    if (!error && data?.id) {
      orderId = data.id;
      orderReference = data.reference;
      break;
    }

    if (error?.code === "23505") {
      orderReference = buildPurchaseOrderReference({
        supplierName: supplier.name,
        projectCode: deliverySite?.project_code ?? null,
        fullName: profile?.full_name ?? user.email ?? "Utilisateur",
        issuedAt: new Date(),
      });
      continue;
    }

    return NextResponse.json(
      { error: error?.message ?? "Unable to create purchase order." },
      { status: 400 }
    );
  }

  if (!orderId) {
    return NextResponse.json(
      { error: "Unable to generate a unique reference." },
      { status: 409 }
    );
  }

  const itemsToInsert = cleanedItems.map((item, index) => {
    const totals = lineTotals[index];
    return {
      purchase_order_id: orderId,
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

  const { error: itemsError } = await supabase
    .from("purchase_order_items")
    .insert(itemsToInsert);

  if (itemsError) {
    await supabase.from("purchase_orders").delete().eq("id", orderId);
    return NextResponse.json({ error: itemsError.message }, { status: 400 });
  }

  return NextResponse.json({ id: orderId, reference: orderReference });
}
