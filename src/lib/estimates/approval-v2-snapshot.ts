import type { SupabaseClient } from "@supabase/supabase-js";

import {
  assertNever,
  requireEstimateEngineVersion,
} from "@/lib/estimates/engine/capabilities";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database } from "@/types/database";

import { freezeEstimateV2Snapshot } from "./v2-snapshot-server";
import { freezeEstimateV3Snapshot } from "./v3-snapshot-server";

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
 * Fige un brouillon v2 ou v3 avant toute capture d'approbation. La valeur de retour
 * indique au workflow qu'il doit relire la version apres le CAS serveur.
 */
export async function freezeApprovalV2DraftIfRequired(
  context: ApprovalSnapshotContext,
  version: ApprovalSnapshotVersion
) {
  // Lot 2, sous-lot 2.5 : une v3 est figee par son propre gel (D15), jamais par celui de la v2.
  const engine = requireEstimateEngineVersion(version);
  if (version.status !== "draft") return false;
  const freezeInput = () => ({
    supabase: context.supabase as SupabaseClient<Database>,
    rpcClient: createServiceRoleClient(),
    tenantId: context.tenantId,
    versionId: version.id,
    expectedUpdatedAt: version.updated_at,
    expectedContentRevision: version.content_revision,
    actorUserId: context.userId,
    purpose: "approval" as const,
  });
  switch (engine) {
    case 1:
      return false;
    case 2:
      await freezeEstimateV2Snapshot(freezeInput());
      return true;
    case 3:
      await freezeEstimateV3Snapshot(freezeInput());
      return true;
    default:
      return assertNever(engine);
  }
}
