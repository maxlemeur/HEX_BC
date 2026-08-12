import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database } from "@/types/database";

import { freezeEstimateV2Snapshot } from "./v2-snapshot-server";

type ApprovalSnapshotContext = {
  supabase: unknown;
  tenantId: string;
  userId: string;
};

type ApprovalSnapshotVersion = Pick<
  Database["public"]["Tables"]["estimate_versions"]["Row"],
  "id" | "status" | "updated_at" | "content_revision" | "calc_engine_version"
>;

/**
 * Fige un brouillon v2 avant toute capture d'approbation. La valeur de retour
 * indique au workflow qu'il doit relire la version apres le CAS serveur.
 */
export async function freezeApprovalV2DraftIfRequired(
  context: ApprovalSnapshotContext,
  version: ApprovalSnapshotVersion
) {
  if (version.status !== "draft" || version.calc_engine_version !== 2) return false;

  const supabase = context.supabase as SupabaseClient<Database>;
  await freezeEstimateV2Snapshot({
    supabase,
    rpcClient: createServiceRoleClient(),
    tenantId: context.tenantId,
    versionId: version.id,
    expectedUpdatedAt: version.updated_at,
    expectedContentRevision: version.content_revision,
    actorUserId: context.userId,
    purpose: "approval",
  });
  return true;
}
