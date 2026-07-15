import { NextResponse } from "next/server";

import { isValidDateOnly } from "@/lib/date-only";
import { computeTotalsFromInputs } from "@/lib/order-calculations";
import {
  canWritePurchaseOrders,
  getAccessiblePurchaseOrderOrNull,
} from "@/lib/purchase-orders";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

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

type ExistingPurchaseOrderItemTrace = {
  product_id: string | null;
  reference: string | null;
  designation: string;
  quantity: number;
  unit_price_ht_cents: number;
  tax_rate_bp: number;
  source_estimate_item_id: string | null;
  source_selected_supplier_price_id: string | null;
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

function buildTraceabilitySignature(item: {
  productId: string | null;
  reference: string | null;
  designation: string;
  quantity: number;
  unitPriceCents: number;
  taxRateBp: number;
}) {
  return JSON.stringify([
    item.productId,
    item.reference,
    item.designation,
    Math.round(item.quantity),
    Math.round(item.unitPriceCents),
    Math.round(item.taxRateBp),
  ]);
}

function buildExistingItemTraceabilityIndex(items: ExistingPurchaseOrderItemTrace[]) {
  const index = new Map<string, ExistingPurchaseOrderItemTrace[]>();

  for (const item of items) {
    const signature = buildTraceabilitySignature({
      productId: item.product_id,
      reference: toNullableString(item.reference),
      designation: item.designation,
      quantity: item.quantity,
      unitPriceCents: item.unit_price_ht_cents,
      taxRateBp: item.tax_rate_bp,
    });

    const bucket = index.get(signature);
    if (bucket) {
      bucket.push(item);
    } else {
      index.set(signature, [item]);
    }
  }

  return index;
}

function takeMatchingTraceability(
  index: Map<string, ExistingPurchaseOrderItemTrace[]>,
  item: CleanedLineItem
) {
  const signature = buildTraceabilitySignature(item);
  const bucket = index.get(signature);
  const match = bucket?.shift() ?? null;

  if (bucket && bucket.length === 0) {
    index.delete(signature);
  }

  return match;
}

function normalizeExistingItemTraceabilityRows(
  rows: unknown[] | null | undefined
): ExistingPurchaseOrderItemTrace[] {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") {
      return [];
    }

    const record = row as Record<string, unknown>;
    if (typeof record.designation !== "string") {
      return [];
    }

    return [
      {
        product_id: typeof record.product_id === "string" ? record.product_id : null,
        reference: toNullableString(record.reference),
        designation: record.designation,
        quantity: Number(record.quantity),
        unit_price_ht_cents: Number(record.unit_price_ht_cents),
        tax_rate_bp: Number(record.tax_rate_bp),
        source_estimate_item_id:
          typeof record.source_estimate_item_id === "string"
            ? record.source_estimate_item_id
            : null,
        source_selected_supplier_price_id:
          typeof record.source_selected_supplier_price_id === "string"
            ? record.source_selected_supplier_price_id
            : null,
      },
    ].filter(
      (item) =>
        Number.isFinite(item.quantity) &&
        Number.isFinite(item.unit_price_ht_cents) &&
        Number.isFinite(item.tax_rate_bp)
    );
  });
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

  if (!(await canWritePurchaseOrders(supabase, user.id, existingOrder.tenant_id))) {
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

    const { data: existingItems, error: existingItemsError } = await supabase
      .from("purchase_order_items")
      .select(
        [
          "product_id",
          "reference",
          "designation",
          "quantity",
          "unit_price_ht_cents",
          "tax_rate_bp",
          "source_estimate_item_id",
          "source_selected_supplier_price_id",
        ].join(", ")
      )
      .eq("purchase_order_id", id);

    if (existingItemsError) {
      return NextResponse.json({ error: existingItemsError.message }, { status: 400 });
    }

    const traceabilityIndex = buildExistingItemTraceabilityIndex(
      normalizeExistingItemTraceabilityRows(existingItems)
    );

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
      const traceability = takeMatchingTraceability(traceabilityIndex, item);
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
        source_estimate_item_id: traceability?.source_estimate_item_id ?? null,
        source_selected_supplier_price_id:
          traceability?.source_selected_supplier_price_id ?? null,
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

  if (!(await canWritePurchaseOrders(supabase, user.id, existingOrder.tenant_id))) {
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
