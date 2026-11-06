import type { ServerSupabaseClient as Supabase } from "@/lib/auth/tenant-context";
import { linkTakeoffJobsFromSourceVersionToTargetVersion } from "@/lib/takeoff/version-links";

/** Carry-over is best-effort; every failure keeps its diagnostic, including test doubles. */
export async function tryCarryOverTakeoffJobsToNewVersion(input: {
  supabase: Supabase;
  tenantId: string;
  userId: string;
  sourceVersionId: string | null;
  targetVersionId: string;
}) {
  if (!input.sourceVersionId) {
    return;
  }

  try {
    await linkTakeoffJobsFromSourceVersionToTargetVersion({
      supabase: input.supabase,
      tenantId: input.tenantId,
      userId: input.userId,
      sourceVersionId: input.sourceVersionId,
      targetVersionId: input.targetVersionId,
    });
  } catch (error) {
    console.warn("takeoff carry-over skipped", {
      sourceVersionId: input.sourceVersionId,
      targetVersionId: input.targetVersionId,
      error,
    });
  }
}
