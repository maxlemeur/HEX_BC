import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { apiFailure, toErrorResponse } from "@/lib/http/api-response";
import { validateFileForUpload } from "@/lib/file-validation";
import {
  canWritePurchaseOrders,
  getAccessiblePurchaseOrderOrNull,
} from "@/lib/purchase-orders/access";
import type { OrderStatus } from "@/lib/purchase-orders/lifecycle";
import { toDevisResponseItem } from "@/lib/purchase-orders/devis-response";
import { DEVIS_BUCKET } from "@/lib/storage/buckets";

const SIGNED_URL_TTL_SECONDS = 60 * 10;

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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let context;
  try {
    context = await getAuthenticatedTenantContext();
  } catch (error) {
    return toErrorResponse(error);
  }

  const { supabase } = context;

  const order = await getAccessiblePurchaseOrderOrNull<{ id: string }>(
    supabase,
    id,
    "id"
  );

  if (!order) {
    return apiFailure(404, "NOT_FOUND", "Bon de commande introuvable.");
  }

  const { data: devisData, error: devisError } = await supabase
    .from("purchase_order_devis")
    .select(
      "id, created_at, name, original_filename, storage_path, file_size_bytes, mime_type, position"
    )
    .eq("purchase_order_id", id)
    .order("position", { ascending: true });

  if (devisError) {
    console.error("Impossible de charger les devis de la commande.", devisError);
    return apiFailure(400, "BAD_REQUEST", "Impossible de charger les devis de la commande.");
  }

  const devis = devisData ?? [];

  if (devis.length === 0) {
    return NextResponse.json({ items: [] });
  }

  const signedResults = await Promise.all(
    devis.map((item) =>
      supabase.storage.from(DEVIS_BUCKET).createSignedUrl(
        item.storage_path,
        SIGNED_URL_TTL_SECONDS
      )
    )
  );

  const signedError = signedResults.find((result) => result.error)?.error;
  if (signedError) {
    console.error("Impossible de générer les liens des devis.", signedError);
    return apiFailure(500, "INTERNAL_ERROR", "Impossible de générer les liens des devis.");
  }

  const items = devis.map((item, index) => {
    const signedUrl = signedResults[index]?.data?.signedUrl ?? null;
    return toDevisResponseItem(item, signedUrl);
  });

  return NextResponse.json({ items });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let context;
  let formData;
  try {
    [context, formData] = await Promise.all([
      getAuthenticatedTenantContext(),
      request.formData().catch(() => null),
    ]);
  } catch (error) {
    return toErrorResponse(error);
  }

  const { supabase, userId, tenantId } = context;

  if (!formData) {
    return apiFailure(400, "BAD_REQUEST", "Invalid form payload");
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return apiFailure(400, "BAD_REQUEST", "Aucun fichier fourni.");
  }

  const validation = validateFileForUpload(file);
  if (!validation.valid) {
    return apiFailure(400, "BAD_REQUEST", validation.error);
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
    return apiFailure(403, "FORBIDDEN", "Les bons de commande annules n'acceptent plus de devis.");
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
    .from(DEVIS_BUCKET)
    .upload(storagePath, file, {
      contentType: getUploadContentType(file),
      upsert: false,
    });

  if (uploadError) {
    console.error("Impossible d’envoyer le fichier du devis.", uploadError);
    return apiFailure(400, "BAD_REQUEST", "Impossible d’envoyer le fichier du devis.");
  }

  const { data: inserted, error: insertError } = await supabase
    .from("purchase_order_devis")
    .insert({
      purchase_order_id: id,
      user_id: userId,
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
    await supabase.storage.from(DEVIS_BUCKET).remove([storagePath]);
    console.error("Impossible d’enregistrer le devis.", insertError);
    return apiFailure(400, "BAD_REQUEST", "Impossible d’enregistrer le devis.");
  }

  const { data: signedData } = await supabase.storage
    .from(DEVIS_BUCKET)
    .createSignedUrl(inserted.storage_path, SIGNED_URL_TTL_SECONDS);

  const item = toDevisResponseItem(inserted, signedData?.signedUrl ?? null);

  return NextResponse.json({ item }, { status: 201 });
}
