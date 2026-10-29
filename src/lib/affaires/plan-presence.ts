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

/** Verify the bytes behind a classified intake plan before counting it. */
export async function hasStoredIntakePlan(input: {
  supabase: SupabaseClient<Database>;
  documents: Array<{ storage_path: string | null; size_bytes: number }>;
}) {
  for (const document of input.documents) {
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
