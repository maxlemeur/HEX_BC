import "server-only";
import { createHash } from "node:crypto";

import { AFFAIRE_INTAKE_BUCKET } from "@/lib/affaires/intake";
import type { requireAffaireProjectOwnerOrAdmin } from "@/lib/affaires/intake-server";
import { internalError } from "@/lib/estimates/api-error";
import { readAllRows } from "@/lib/supabase/read-all";

type Access = Awaited<ReturnType<typeof requireAffaireProjectOwnerOrAdmin>>;

export const INTAKE_DUPLICATE_MESSAGE = "Ce document est déjà présent dans le dossier (contenu identique). Aucun nouvel exemplaire n’a été ajouté.";

export const INTAKE_DUPLICATE_PENDING_MESSAGE = "Un envoi de ce contenu est déjà en cours. Aucun nouvel exemplaire n’a été ajouté. Réessayez si cet envoi échoue.";
const PENDING_RESERVATION_MAX_AGE_MS = 15 * 60_000;

export async function hashIntakeContent(blob: Blob): Promise<string> {
  const hash = createHash("sha256");
  const reader = blob.stream().getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
    }
    return hash.digest("hex");
  } finally {
    reader.releaseLock();
  }
}

/** Reads through the caller's RLS and Storage permissions, after project authorization.
 * Drive links retain their provider identity: linking one does not import its bytes.
 * A deletion in progress still reserves its bytes until the copy is actually gone.
 */
export async function findDuplicateIntakeDocument({ context, project }: Access, sha256: string, sizeBytes: number) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existing = await context.supabase.from("affaire_intake_documents")
      .select("id,upload_status,created_at,updated_at").eq("tenant_id", context.tenantId).eq("project_id", project.id)
      .eq("content_sha256", sha256).is("deleted_at", null).in("upload_status", ["pending", "uploaded"])
      .limit(1).maybeSingle();
    if (existing.error) throw internalError("Impossible de vérifier les doublons du dossier.");
    const row = existing.data;
    if (!row) break;
    if (row.upload_status !== "pending" || Date.parse(row.created_at) > Date.now() - PENDING_RESERVATION_MAX_AGE_MS) {
      return { documentId: row.id, message: row.upload_status === "pending" ? INTAKE_DUPLICATE_PENDING_MESSAGE : INTAKE_DUPLICATE_MESSAGE };
    }
    // An interrupted request may leave a pending reservation without any bytes.
    // Compare-and-swap it; the original writer must also CAS its final transition.
    const released = await context.supabase.from("affaire_intake_documents")
      .update({ upload_status: "rejected", classification_status: "failed", rejection_reason: "Transfert interrompu. Vous pouvez renvoyer ce document." })
      .eq("tenant_id", context.tenantId).eq("project_id", project.id).eq("id", row.id)
      .eq("upload_status", "pending").eq("updated_at", row.updated_at).is("deleted_at", null).select("id");
    if (released.error) throw internalError("Impossible de reprendre le transfert interrompu. Réessayez.");
    if (released.data?.length) break;
    if (attempt === 2) throw internalError("Le transfert a changé pendant la vérification. Réessayez.");
  }

  // Old rows predate fingerprints. Size narrows candidates without assuming that
  // names or MIME types identify content. Pagination avoids the PostgREST row cap.
  const legacy = await readAllRows(() => context.supabase.from("affaire_intake_documents")
    .select("id,storage_path", { count: "exact" }).eq("tenant_id", context.tenantId).eq("project_id", project.id)
    .is("content_sha256", null).is("source_provider", null).is("deleted_at", null)
    .eq("upload_status", "uploaded").eq("size_bytes", sizeBytes));
  if (legacy.error) throw internalError("Impossible de vérifier les anciens documents du dossier.");
  for (const row of legacy.data ?? []) {
    if (!row.storage_path) throw internalError("Impossible de vérifier le contenu d’un ancien document du dossier.");
    const stored = await context.supabase.storage.from(AFFAIRE_INTAKE_BUCKET).download(row.storage_path);
    // Fail closed: unavailable old bytes cannot be treated as different content.
    if (stored.error || !stored.data) throw internalError("Impossible de vérifier le contenu d’un ancien document du dossier. Réessayez.");
    if (await hashIntakeContent(stored.data) === sha256) return { documentId: row.id, message: INTAKE_DUPLICATE_MESSAGE };
  }
  return null;
}
