import { randomUUID } from "node:crypto";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import { conflict, mapSupabaseError } from "@/lib/http/api-response";
import type { Database } from "@/types/database";

type Supabase = SupabaseClient<Database>;

export type EstimateAiGenerationOperation =
  | "structure_draft"
  | "version_zero_draft";

type EstimateAiGenerationRpc = (
  functionName: string,
  args: Record<string, unknown>
) => Promise<{
  data: unknown;
  error: PostgrestError | null;
}>;

type EstimateAiGenerationLeaseRow = {
  claimed: boolean;
  retry_after_seconds: number | null;
};

function estimateAiGenerationRpc(supabase: Supabase) {
  return supabase.rpc.bind(supabase) as unknown as EstimateAiGenerationRpc;
}

function readEstimateAiGenerationLeaseRow(
  value: unknown
): EstimateAiGenerationLeaseRow | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") {
    return null;
  }

  const candidate = row as Partial<EstimateAiGenerationLeaseRow>;
  if (typeof candidate.claimed !== "boolean") {
    return null;
  }

  return {
    claimed: candidate.claimed,
    retry_after_seconds:
      typeof candidate.retry_after_seconds === "number"
        ? Math.max(1, Math.trunc(candidate.retry_after_seconds))
        : null,
  };
}

export async function withEstimateAiGenerationLease<T>(input: {
  supabase: Supabase;
  versionId: string;
  operation: EstimateAiGenerationOperation;
  run: () => Promise<T>;
}) {
  const leaseToken = randomUUID();
  const rpc = estimateAiGenerationRpc(input.supabase);
  const { data, error } = await rpc("acquire_estimate_ai_generation_lease", {
    p_version_id: input.versionId,
    p_operation: input.operation,
    p_lease_token: leaseToken,
  });

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de réserver le budget de génération IA."
    );
  }

  const lease = readEstimateAiGenerationLeaseRow(data);
  if (!lease?.claimed) {
    throw conflict(
      "Une generation IA est déjà en cours ou a été lancee recemment pour cette version.",
      { retry_after_seconds: lease?.retry_after_seconds ?? null },
      "ESTIMATE_AI_GENERATION_BUDGET_EXCEEDED"
    );
  }

  try {
    return await input.run();
  } finally {
    const completion = await rpc("complete_estimate_ai_generation_lease", {
      p_version_id: input.versionId,
      p_operation: input.operation,
      p_lease_token: leaseToken,
    });
    if (completion.error) {
      console.error("estimate.ai_generation.lease_completion_failed", {
        operation: input.operation,
        version_id: input.versionId,
        code: completion.error.code,
      });
    }
  }
}
