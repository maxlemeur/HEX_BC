import { NextResponse } from "next/server";

import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { apiFailure, toErrorResponse } from "@/lib/http/api-response";
import {
  canWritePurchaseOrders,
  getAccessiblePurchaseOrderOrNull,
} from "@/lib/purchase-orders/access";
import type { OrderStatus } from "@/lib/purchase-orders/lifecycle";
import { toDevisResponseItem } from "@/lib/purchase-orders/devis-response";
import { DEVIS_BUCKET } from "@/lib/storage/buckets";

const SIGNED_URL_TTL_SECONDS = 60 * 10;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; devisId: string }> }
) {
  const { id, devisId } = await params;
  let context;
  try {
    context = await getAuthenticatedTenantContext();
  } catch (error) {
    return toErrorResponse(error);
  }

  const { supabase, userId, tenantId } = context;

  let payload: { name?: string };
  try {
    payload = (await request.json()) as { name?: string };
  } catch {
    return apiFailure(400, "BAD_REQUEST", "Invalid JSON payload");
  }

  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (!name) {
    return apiFailure(400, "BAD_REQUEST", "Le nom du devis est obligatoire.");
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
    return apiFailure(404, "NOT_FOUND", "Devis introuvable.");
  }

  const { data: signedData } = await supabase.storage
    .from(DEVIS_BUCKET)
    .createSignedUrl(updated.storage_path, SIGNED_URL_TTL_SECONDS);

  const item = toDevisResponseItem(updated, signedData?.signedUrl ?? null);

  return NextResponse.json({ item });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; devisId: string }> }
) {
  const { id, devisId } = await params;
  let context;
  try {
    context = await getAuthenticatedTenantContext();
  } catch (error) {
    return toErrorResponse(error);
  }

  const { supabase, userId, tenantId } = context;

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

  const { data: devis, error: devisError } = await supabase
    .from("purchase_order_devis")
    .select("id, storage_path")
    .eq("id", devisId)
    .eq("purchase_order_id", id)
    .single();

  if (devisError || !devis) {
    return apiFailure(404, "NOT_FOUND", "Devis introuvable.");
  }

  // TI-691: the proof of a confirmed order is kept (its foreign key refuses the row); say so before the file is
  // removed, or the confirmation would name a document without its file.
  const { data: proofs, error: proofError } = await supabase
    .from("purchase_order_confirmations")
    .select("purchase_order_id")
    .eq("document_id", devisId)
    .limit(1);

  if (proofError) {
    return apiFailure(400, "BAD_REQUEST", "Impossible de vérifier ce document. Réessayez.");
  }
  if (proofs && proofs.length > 0) {
    return apiFailure(409, "CONFLICT", "Ce document prouve la commande confirmée : il ne peut pas être supprimé.");
  }

  const { error: removeError } = await supabase.storage
    .from(DEVIS_BUCKET)
    .remove([devis.storage_path]);

  if (removeError) {
    // A confirmation committed since the check above: the database keeps the file of a proof.
    if (removeError.message.includes("PURCHASE_ORDER_PROOF_FILE_KEPT")) {
      return apiFailure(409, "CONFLICT", "Ce document prouve la commande confirmée : il ne peut pas être supprimé.");
    }
    console.error("Impossible de supprimer le fichier du devis.", removeError);
    return apiFailure(400, "BAD_REQUEST", "Impossible de supprimer le fichier du devis.");
  }

  const { error: deleteError } = await supabase
    .from("purchase_order_devis")
    .delete()
    .eq("id", devisId)
    .eq("purchase_order_id", id);

  if (deleteError) {
    console.error("Impossible de supprimer le devis de la commande.", deleteError);
    return apiFailure(400, "BAD_REQUEST", "Impossible de supprimer le devis de la commande.");
  }

  return NextResponse.json({ success: true });
}
