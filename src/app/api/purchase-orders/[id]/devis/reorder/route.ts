import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOwnedPurchaseOrderOrNull } from "../../route";

type ReorderRequestBody = {
  orderedIds: string[];
};

export async function PATCH(
  request: Request,
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

  let body: ReorderRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const { orderedIds } = body;

  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return NextResponse.json(
      { error: "orderedIds must be a non-empty array" },
      { status: 400 }
    );
  }

  const uniqueOrderedIds = new Set(orderedIds);
  if (uniqueOrderedIds.size !== orderedIds.length) {
    return NextResponse.json(
      { error: "orderedIds doit contenir des identifiants uniques." },
      { status: 400 }
    );
  }

  const order = await getOwnedPurchaseOrderOrNull<{
    id: string;
    status: "draft" | "sent" | "confirmed" | "received" | "canceled";
  }>(supabase, id, user.id, "id, status");

  if (!order) {
    return NextResponse.json(
      { error: "Bon de commande introuvable." },
      { status: 404 }
    );
  }

  if (order.status !== "draft") {
    return NextResponse.json(
      { error: "Seuls les bons de commande en brouillon peuvent etre reordonnes." },
      { status: 403 }
    );
  }

  const { data: existingDevis, error: fetchError } = await supabase
    .from("purchase_order_devis")
    .select("id")
    .eq("purchase_order_id", id)
    .eq("user_id", user.id);

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 400 });
  }

  const existing = existingDevis ?? [];
  const existingIds = new Set(existing.map((d) => d.id));

  if (existing.length === 0) {
    return NextResponse.json(
      { error: "Aucun devis a reordonner pour cette commande." },
      { status: 400 }
    );
  }

  if (orderedIds.length !== existing.length) {
    return NextResponse.json(
      { error: "La liste de reordonnancement est incomplete." },
      { status: 400 }
    );
  }

  for (const devisId of orderedIds) {
    if (!existingIds.has(devisId)) {
      return NextResponse.json(
        { error: `Devis ${devisId} non trouve dans cette commande.` },
        { status: 400 }
      );
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
    return NextResponse.json({ error: reorderError.message }, { status: 400 });
  }

  if ((updatedCount ?? 0) !== orderedIds.length) {
    return NextResponse.json(
      { error: "La liste de reordonnancement est desynchronisee." },
      { status: 409 }
    );
  }

  return NextResponse.json({ success: true });
}
