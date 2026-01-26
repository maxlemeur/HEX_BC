import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

const SIGNED_URL_TTL_SECONDS = 60 * 10;

type DevisRecord = {
  id: string;
  created_at: string;
  name: string;
  original_filename: string;
  storage_path: string;
  file_size_bytes: number;
  mime_type: string;
  position: number;
};

type DevisResponseItem = {
  id: string;
  name: string;
  originalFilename: string;
  fileSizeBytes: number;
  mimeType: string;
  createdAt: string;
  position: number;
  downloadUrl: string | null;
};

function toResponseItem(record: DevisRecord, downloadUrl: string | null): DevisResponseItem {
  return {
    id: record.id,
    name: record.name,
    originalFilename: record.original_filename,
    fileSizeBytes: record.file_size_bytes,
    mimeType: record.mime_type,
    createdAt: record.created_at,
    position: record.position,
    downloadUrl,
  };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; devisId: string }> }
) {
  const { id, devisId } = await params;
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: { name?: string };
  try {
    payload = (await request.json()) as { name?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (!name) {
    return NextResponse.json(
      { error: "Le nom du devis est obligatoire." },
      { status: 400 }
    );
  }

  const { data: order, error: orderError } = await supabase
    .from("purchase_orders")
    .select("id, status")
    .eq("id", id)
    .single();

  if (orderError || !order) {
    return NextResponse.json(
      { error: "Bon de commande introuvable." },
      { status: 404 }
    );
  }

  if (order.status !== "draft") {
    return NextResponse.json(
      { error: "Seuls les bons de commande en brouillon acceptent des devis." },
      { status: 403 }
    );
  }

  const { data: updated, error: updateError } = await supabase
    .from("purchase_order_devis")
    .update({ name })
    .eq("id", devisId)
    .eq("purchase_order_id", id)
    .select(
      "id, created_at, name, original_filename, storage_path, file_size_bytes, mime_type, position"
    )
    .single();

  if (updateError || !updated) {
    return NextResponse.json(
      { error: "Devis introuvable." },
      { status: 404 }
    );
  }

  const { data: signedData } = await supabase.storage
    .from("devis")
    .createSignedUrl(updated.storage_path, SIGNED_URL_TTL_SECONDS);

  const item = toResponseItem(updated, signedData?.signedUrl ?? null);

  return NextResponse.json({ item });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; devisId: string }> }
) {
  const { id, devisId } = await params;
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: order, error: orderError } = await supabase
    .from("purchase_orders")
    .select("id, status")
    .eq("id", id)
    .single();

  if (orderError || !order) {
    return NextResponse.json(
      { error: "Bon de commande introuvable." },
      { status: 404 }
    );
  }

  if (order.status !== "draft") {
    return NextResponse.json(
      { error: "Seuls les bons de commande en brouillon acceptent des devis." },
      { status: 403 }
    );
  }

  const { data: devis, error: devisError } = await supabase
    .from("purchase_order_devis")
    .select("id, storage_path")
    .eq("id", devisId)
    .eq("purchase_order_id", id)
    .single();

  if (devisError || !devis) {
    return NextResponse.json({ error: "Devis introuvable." }, { status: 404 });
  }

  const { error: removeError } = await supabase.storage
    .from("devis")
    .remove([devis.storage_path]);

  if (removeError) {
    return NextResponse.json({ error: removeError.message }, { status: 400 });
  }

  const { error: deleteError } = await supabase
    .from("purchase_order_devis")
    .delete()
    .eq("id", devisId)
    .eq("purchase_order_id", id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
