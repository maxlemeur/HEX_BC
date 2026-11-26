import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { conflict, internalError, mapSupabaseError } from "@/lib/http/api-response";
import type { Database } from "@/types/database";

export async function withEstimateGenerationExecution<T>(input: {
  supabase: SupabaseClient<Database>;
  versionId: string;
  operation: "structure_draft" | "version_zero_draft";
  pageSessionId: string | null | undefined;
  useAi: boolean;
  run: () => Promise<T>;
}) {
  const pageLockRequired = () =>
    conflict("Le verrou de cette page n’est plus actif. Réessayez depuis cette page.", undefined, "LOCK_REQUIRED");
  if (!input.pageSessionId) throw pageLockRequired();

  const tokenArgs = {
    p_version_id: input.versionId,
    p_operation: input.operation,
    p_token: randomUUID(),
  };
  const { data, error } = await input.supabase.rpc("acquire_estimate_generation_execution", {
    ...tokenArgs,
    p_draft_lock_session_id: input.pageSessionId,
    p_use_ai: input.useAi,
  });

  if (error?.message === "estimate_generation_page_lock_required") throw pageLockRequired();
  if (error) {
    throw mapSupabaseError(error, "Impossible de réserver la génération du devis.");
  }

  const admission = data?.[0];
  if (admission?.status === "busy") {
    throw conflict(
      "Une génération est déjà en cours pour cette version.",
      { retry_after_seconds: admission.retry_after_seconds },
      "ESTIMATE_GENERATION_IN_PROGRESS"
    );
  }
  if (admission?.status === "quota_exceeded" && input.useAi) {
    throw conflict(
      "Une génération IA a déjà été lancée récemment. Réessayez après le délai indiqué.",
      { retry_after_seconds: admission.retry_after_seconds },
      "ESTIMATE_AI_GENERATION_BUDGET_EXCEEDED"
    );
  }
  if (admission?.status !== "acquired") {
    throw internalError("Impossible de réserver la génération du devis.");
  }

  try {
    return await input.run();
  } finally {
    try {
      const { error: releaseError } = await input.supabase.rpc("release_estimate_generation_execution", tokenArgs);
      if (releaseError) throw releaseError;
    } catch (releaseError) {
      console.error("estimate.generation.execution_release_failed", {
        operation: input.operation,
        version_id: input.versionId,
        error: releaseError,
      });
    }
  }
}
