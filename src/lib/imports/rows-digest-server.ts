import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * The digest of an import's rows as a confirmation consumes them, computed by the database alone
 * (public.dpgf_import_rows_sha256): every mapped row whatever its status, in the order the server reads them, whole,
 * with its raw row. Read with the server's role, after the caller's own access check to the import. The confirmation's
 * record recomputes it under the import's lock and refuses any difference.
 */
export async function readDpgfImportRowsDigest(input: { tenantId: string; importId: string }): Promise<string> {
  const { data, error } = await createServiceRoleClient().rpc("dpgf_import_rows_sha256", {
    p_tenant_id: input.tenantId,
    p_import_id: input.importId,
  });
  if (error || typeof data !== "string" || !/^[0-9a-f]{64}$/.test(data)) {
    throw new Error("Impossible de lire l'empreinte des lignes de l'import.");
  }
  return data;
}
