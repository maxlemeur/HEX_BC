import "server-only";
import { randomUUID } from "node:crypto";

import { AFFAIRE_INTAKE_BUCKET } from "@/lib/affaires/intake";
import { PLAN_FILES_BUCKET } from "@/lib/storage/buckets";
import { DriveStoreError } from "@/lib/affaires/google-drive/store";
import type { requireAffaireProjectOwnerOrAdmin } from "@/lib/affaires/intake-server";

type Access = Awaited<ReturnType<typeof requireAffaireProjectOwnerOrAdmin>>;
type DerivedStateRefresh = (removed: { uploadId: string; wasUploaded: boolean }) => Promise<void>;

// No Next imports: exercised against the owned local RLS and Storage backend.
// The caller's derived-state refresh runs once the bytes are gone, while the reservation still
// hides the piece: a tombstone therefore means it completed, and an interrupted refresh releases
// the reservation so that retrying the deletion runs it again.
export async function deleteIntakeDocumentCopy({ context, project }: Access, documentId: string, refreshDerivedState?: DerivedStateRefresh) {
  const database = context.supabase;
  const lookup = await database.from("affaire_intake_documents" as never)
    .select("id,upload_id,updated_at,storage_path,deleted_at,deletion_token,deletion_started_at,upload_status,classification_status")
    .eq("tenant_id", context.tenantId).eq("project_id", project.id).eq("id", documentId).maybeSingle();
  if (lookup.error) throw new DriveStoreError(500, "Impossible de charger le document à supprimer.");
  const document = lookup.data as { id: string; upload_id: string; storage_path: string | null;
    updated_at: string; deleted_at: string | null; deletion_token?: string | null; deletion_started_at?: string | null; upload_status: string; classification_status: string } | null;
  if (!document) throw new DriveStoreError(409, "Document introuvable dans cette affaire. Actualisez le dossier.");
  if (document.deleted_at) return { documentId, deleted: true as const };

  const upload = await database.from("affaire_intake_uploads" as never).select("status")
    .eq("tenant_id", context.tenantId).eq("project_id", project.id).eq("id", document.upload_id).single();
  if (upload.error) throw new DriveStoreError(500, "Impossible de vérifier le traitement du document.");
  if (["queued", "processing"].includes((upload.data as { status: string }).status) || document.upload_status === "pending") {
    throw new DriveStoreError(409, "Attendez la fin de l’import et du classement avant de supprimer cette pièce.");
  }

  // A fresh token fences an interrupted worker. Restored copies use new paths, so
  // an old storage request cannot delete bytes from a later import generation.
  const now = Date.now();
  if (document.deletion_token && (!document.deletion_started_at || now - Date.parse(document.deletion_started_at) < 120_000)) {
    throw new DriveStoreError(409, "Une suppression est en cours. Réessayez dans deux minutes si elle a été interrompue.");
  }
  const token = randomUUID();
  const reservation = await database.from("affaire_intake_documents" as never).update({ deletion_token: token, deletion_started_at: new Date(now).toISOString() } as never)
    .eq("tenant_id", context.tenantId).eq("project_id", project.id).eq("id", documentId)
    .is("deleted_at", null).eq("updated_at", document.updated_at).select("id");
  if (reservation.error || !(reservation.data as unknown[])?.length) {
    throw new DriveStoreError(409, "Une suppression est déjà en cours pour cette pièce. Actualisez le dossier.");
  }
  try {
    // Find only derived plan copies belonging to this exact intake document/tenant.
    const plans = await database.from("plan_files" as never).select("id,file_path")
      .eq("tenant_id", context.tenantId)
      .contains("metadata", { source: "affaire-intake", intake_document_id: documentId, intake_storage_path: document.storage_path });
    if (plans.error) throw new DriveStoreError(500, "Impossible de vérifier les copies du plan.");
    const planCopies = (plans.data ?? []) as { id: string; file_path: string }[];
    async function removeAndVerify(bucket: string, path: string) {
      const storage = database.storage.from(bucket);
      const removed = await storage.remove([path]);
      if (removed.error) throw new DriveStoreError(500, "Suppression du fichier interrompue. Reprenez la suppression.");
      // Storage may return success with no removed rows under RLS. Verify absence;
      // never hide a document on an unverified storage response.
      const remaining = await storage.download(path);
      const status = Number((remaining.error as { statusCode?: string; status?: number } | null)?.statusCode
        ?? (remaining.error as { status?: number } | null)?.status);
      if (remaining.data || !remaining.error || ![400, 404].includes(status)) {
        throw new DriveStoreError(500, "La suppression du fichier n’a pas pu être confirmée. Reprenez la suppression.");
      }
    }
    for (const plan of planCopies) {
      await removeAndVerify(PLAN_FILES_BUCKET, plan.file_path);
      const deleted = await database.from("plan_files" as never).delete()
        .eq("tenant_id", context.tenantId).eq("id", plan.id).select("id");
      if (deleted.error || !(deleted.data as unknown[])?.length) throw new DriveStoreError(500, "La copie du plan n’a pas pu être retirée.");
    }
    if (document.storage_path) await removeAndVerify(AFFAIRE_INTAKE_BUCKET, document.storage_path);
    try {
      await refreshDerivedState?.({ uploadId: document.upload_id, wasUploaded: document.upload_status === "uploaded" });
    } catch (cause) {
      console.error("Intake deletion refresh failed", { documentId, cause });
      throw new DriveStoreError(500, "Fichier retiré du stockage ; actualisation du dossier interrompue. Reprenez la suppression.");
    }

    const deleted = await database.from("affaire_intake_documents" as never).update({
      deleted_at: new Date().toISOString(), deletion_token: null, deletion_started_at: null, storage_path: null, upload_status: "rejected",
      document_priority: "secondary", rejection_reason: "Copie supprimée de l’affaire par l’utilisateur.",
      classification_status: "failed",
    } as never).eq("tenant_id", context.tenantId).eq("project_id", project.id).eq("id", documentId).eq("deletion_token", token).select("id");
    if (deleted.error || !(deleted.data as unknown[])?.length) {
      throw new DriveStoreError(500, "Fichier retiré du stockage ; actualisation du dossier interrompue. Reprenez la suppression.");
    }
    return { documentId, deleted: true as const };
  } catch (error) {
    const released = await database.from("affaire_intake_documents" as never).update({ deletion_token: null, deletion_started_at: null } as never)
      .eq("tenant_id", context.tenantId).eq("project_id", project.id).eq("id", documentId).eq("deletion_token", token);
    if (released.error) throw new DriveStoreError(500, "Suppression interrompue ; réservation conservée. Actualisez le dossier avant une nouvelle tentative.");
    throw error;
  }
}
