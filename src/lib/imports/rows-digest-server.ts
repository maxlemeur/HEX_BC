import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service-role";

/** What a confirmation of an import is bound to, read by the database in one statement. */
export type DpgfImportReviewState = {
  /** The import's latest mapping, null when it has none. */
  mappingId: string | null;
  /** Its columns, as stored. */
  columnMapping: unknown;
  /**
   * The digest of the import's rows as a confirmation consumes them, computed by the database alone
   * (public.dpgf_import_rows_sha256): every mapped row whatever its status, in the order the server reads them, whole
   * but for the catalogue linker's keys, with its raw row.
   */
  rowsDigest: string;
};

/**
 * The import's latest mapping and the digest of its rows, read together (public.dpgf_import_review_state), with the
 * server's role after the caller's own access check to the import. The confirmation's record checks both again under
 * the import's lock and refuses any difference.
 */
export async function readDpgfImportReviewState(input: { tenantId: string; importId: string }): Promise<DpgfImportReviewState> {
  const { data, error } = await createServiceRoleClient().rpc("dpgf_import_review_state", {
    p_tenant_id: input.tenantId,
    p_import_id: input.importId,
  });
  const state = Array.isArray(data) && data.length === 1 ? data[0] : null;
  if (error || !state || typeof state.rows_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(state.rows_sha256)
    || (state.mapping_id !== null && typeof state.mapping_id !== "string")) {
    throw new Error("Impossible de lire l'empreinte des lignes de l'import.");
  }
  return { mappingId: state.mapping_id, columnMapping: state.column_mapping, rowsDigest: state.rows_sha256 };
}
