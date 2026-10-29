import type { SupabaseClient } from "@supabase/supabase-js";

import { AFFAIRE_INTAKE_BUCKET } from "@/lib/affaires/intake";
import { internalError, mapSupabaseError } from "@/lib/estimates/errors";
import { PLAN_FILES_BUCKET } from "@/lib/storage/buckets";
import { readAllRows } from "@/lib/supabase/read-all";
import type { Database } from "@/types/database";

/** Intake-sourced plans are accounted for by their live intake document instead. */
export async function hasStoredStandalonePlan(input: {
  supabase: SupabaseClient<Database>;
  projectId: string;
  tenantId: string;
}) {
  const { data, error } = await readAllRows(() => input.supabase
    .from("plan_files" as never)
    .select("id, file_path, file_size_bytes, metadata, plan_sets!inner(project_id)" as never, { count: "exact" })
    .eq("tenant_id", input.tenantId)
    .eq("plan_sets.project_id", input.projectId));
  if (error) throw mapSupabaseError(error, "Impossible de vérifier les plans de l'affaire.");

  for (const row of (data ?? []) as unknown as Array<{
    file_path: string;
    file_size_bytes: number;
    metadata: Record<string, unknown> | null;
  }>) {
    if (row.metadata?.source === "affaire-intake" || row.metadata?.intake_cleanup_pending === true) continue;
    const { data: object, error: storageError } = await input.supabase.storage
      .from(PLAN_FILES_BUCKET).info(row.file_path);
    if (storageError) {
      const status = Number(storageError.statusCode ?? storageError.status);
      if (status === 400 || status === 404) continue;
      throw internalError("Impossible de vérifier le stockage des plans.", storageError);
    }
    if (object && object.size === row.file_size_bytes && row.file_size_bytes > 0) return true;
  }
  return false;
}

type IntakePlanDocument = { id?: string; storage_path: string | null; size_bytes: number;
  source_provider?: string | null; drive_file_id?: string | null; plan_copy_generation?: string | null };

/** A Drive plan has no stored bytes in the dossier: it counts through its complete métré working copy, in this affaire. */
async function hasDrivePlanWorkingCopy(supabase: SupabaseClient<Database>, projectId: string, document: IntakePlanDocument) {
  if (!document.id || !document.drive_file_id || !document.plan_copy_generation) return false;
  const { data, error } = await supabase.from("plan_files" as never)
    .select("file_path, file_size_bytes, metadata, plan_sets!inner(project_id)" as never)
    .eq("plan_sets.project_id", projectId)
    .contains("metadata", { source: "affaire-intake", intake_document_id: document.id, intake_drive_file_id: document.drive_file_id,
      intake_generation: document.plan_copy_generation } as never);
  if (error) throw mapSupabaseError(error, "Impossible de vérifier la copie de travail du plan Drive.");
  for (const row of (data ?? []) as unknown as Array<{ file_path: string; file_size_bytes: number; metadata: Record<string, unknown> | null }>) {
    if (row.metadata?.intake_cleanup_pending === true || row.file_size_bytes <= 0) continue;
    const { data: object, error: storageError } = await supabase.storage.from(PLAN_FILES_BUCKET).info(row.file_path);
    if (storageError) {
      const status = Number(storageError.statusCode ?? storageError.status);
      if (status === 400 || status === 404) continue;
      throw internalError("Impossible de vérifier le stockage des plans.", storageError);
    }
    if (object && object.size === row.file_size_bytes) return true;
  }
  return false;
}

/** Verify the bytes behind a classified intake plan before counting it. */
export async function hasStoredIntakePlan(input: {
  supabase: SupabaseClient<Database>;
  /**
   * Reads Drive working copies across takeoff RLS once affaire access has been checked, so
   * a reader of the dossier without takeoff rights gets the same presence boolean.
   */
  serverClient: () => SupabaseClient<Database>;
  projectId: string;
  documents: IntakePlanDocument[];
}) {
  for (const document of input.documents) {
    if (document.source_provider === "google_drive" && !document.storage_path) {
      if (await hasDrivePlanWorkingCopy(input.serverClient(), input.projectId, document)) return true;
      continue;
    }
    if (!document.storage_path || document.size_bytes <= 0) continue;
    const { data: object, error } = await input.supabase.storage
      .from(AFFAIRE_INTAKE_BUCKET).info(document.storage_path);
    if (error) {
      const status = Number(error.statusCode ?? error.status);
      if (status === 400 || status === 404) continue;
      throw internalError("Impossible de vérifier le stockage des plans du dossier.", error);
    }
    if (object && object.size === document.size_bytes) return true;
  }
  return false;
}
