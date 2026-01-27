import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import { validateFileForUpload } from "@/lib/file-validation";
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

function normalizeDisplayName(value: FormDataEntryValue | null, fallback: string) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function sanitizeFilename(filename: string) {
  const normalized = filename
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

  return normalized.length > 0 ? normalized : "fichier";
}

function getUploadContentType(file: File) {
  const trimmedType = file.type?.trim();
  if (!trimmedType) return undefined;

  if (trimmedType.startsWith("message/")) {
    return "application/octet-stream";
  }

  return trimmedType;
}

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

export async function GET(
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

  const { data: order, error: orderError } = await supabase
    .from("purchase_orders")
    .select("id")
    .eq("id", id)
    .single();

  if (orderError || !order) {
    return NextResponse.json(
      { error: "Bon de commande introuvable." },
      { status: 404 }
    );
  }

  const { data: devisData, error: devisError } = await supabase
    .from("purchase_order_devis")
    .select(
      "id, created_at, name, original_filename, storage_path, file_size_bytes, mime_type, position"
    )
    .eq("purchase_order_id", id)
    .order("position", { ascending: true });

  if (devisError) {
    return NextResponse.json({ error: devisError.message }, { status: 400 });
  }

  const devis = devisData ?? [];

  if (devis.length === 0) {
    return NextResponse.json({ items: [] });
  }

  const signedResults = await Promise.all(
    devis.map((item) =>
      supabase.storage.from("devis").createSignedUrl(
        item.storage_path,
        SIGNED_URL_TTL_SECONDS
      )
    )
  );

  const signedError = signedResults.find((result) => result.error)?.error;
  if (signedError) {
    return NextResponse.json({ error: signedError.message }, { status: 500 });
  }

  const items = devis.map((item, index) => {
    const signedUrl = signedResults[index]?.data?.signedUrl ?? null;
    return toResponseItem(item, signedUrl);
  });

  return NextResponse.json({ items });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const userPromise = supabase.auth.getUser();
  const formDataPromise = request.formData().catch(() => null);

  const [
    {
      data: { user },
    },
    formData,
  ] = await Promise.all([userPromise, formDataPromise]);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!formData) {
    return NextResponse.json({ error: "Invalid form payload" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Aucun fichier fourni." },
      { status: 400 }
    );
  }

  const validation = validateFileForUpload(file);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
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

  const originalFilename = file.name || "fichier";
  const displayName = normalizeDisplayName(formData.get("name"), originalFilename);
  const safeFilename = sanitizeFilename(originalFilename);
  const storagePath = `purchase-orders/${id}/${randomUUID()}-${safeFilename}`;

  const { data: lastPositionData } = await supabase
    .from("purchase_order_devis")
    .select("position")
    .eq("purchase_order_id", id)
    .order("position", { ascending: false })
    .limit(1);

  const nextPosition = (lastPositionData?.[0]?.position ?? 0) + 1;

  const { error: uploadError } = await supabase.storage
    .from("devis")
    .upload(storagePath, file, {
      contentType: getUploadContentType(file),
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 400 });
  }

  const { data: inserted, error: insertError } = await supabase
    .from("purchase_order_devis")
    .insert({
      purchase_order_id: id,
      user_id: user.id,
      name: displayName,
      original_filename: originalFilename,
      storage_path: storagePath,
      file_size_bytes: file.size,
      mime_type: file.type || "application/octet-stream",
      position: nextPosition,
    })
    .select(
      "id, created_at, name, original_filename, storage_path, file_size_bytes, mime_type, position"
    )
    .single();

  if (insertError || !inserted) {
    await supabase.storage.from("devis").remove([storagePath]);
    return NextResponse.json(
      { error: insertError?.message ?? "Impossible d'enregistrer le devis." },
      { status: 400 }
    );
  }

  const { data: signedData } = await supabase.storage
    .from("devis")
    .createSignedUrl(inserted.storage_path, SIGNED_URL_TTL_SECONDS);

  const item = toResponseItem(inserted, signedData?.signedUrl ?? null);

  return NextResponse.json({ item }, { status: 201 });
}
