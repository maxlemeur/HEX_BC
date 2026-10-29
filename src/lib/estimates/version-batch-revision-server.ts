import { ESTIMATE_VERSION_CONFLICT_MESSAGE } from "@/lib/estimates/constants";
import { badRequest, conflict, mapSupabaseError } from "@/lib/estimates/errors";
import { normalizeConcurrencyToken } from "@/lib/estimates/version-concurrency";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function claimEstimateBatchRevision(
  versionId: string,
  concurrencyToken: string | undefined
) {
  const normalizedToken = normalizeConcurrencyToken(concurrencyToken);
  if (!normalizedToken) {
    throw badRequest("Jeton de concurrence manquant.");
  }
  if (!Number.isFinite(new Date(normalizedToken).getTime())) {
    throw badRequest("Jeton de concurrence invalide.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(
    "claim_estimate_batch_revision" as never,
    {
      p_version_id: versionId,
      p_expected_updated_at: normalizedToken,
    } as never
  );

  if (error) {
    if (
      error.code === "40001" ||
      error.message.includes("ESTIMATE_BATCH_REVISION_CONFLICT")
    ) {
      throw conflict(ESTIMATE_VERSION_CONFLICT_MESSAGE, {
        updated_at: normalizedToken,
      }, "VERSION_CONFLICT");
    }
    throw mapSupabaseError(
      error,
      "Impossible de réserver la révision du traitement par lot."
    );
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw conflict(ESTIMATE_VERSION_CONFLICT_MESSAGE, {
      updated_at: normalizedToken,
    }, "VERSION_CONFLICT");
  }

  return row as unknown as { id: string; updated_at: string };
}
