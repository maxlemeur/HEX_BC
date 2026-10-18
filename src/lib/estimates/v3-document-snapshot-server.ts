import type { SupabaseClient } from "@supabase/supabase-js";

import { conflict } from "@/lib/estimates/errors";
import {
  prepareEstimateV3FreezeArguments,
  toEstimateV3FreezeError,
  toEstimateV3FreezeResult,
  type EstimateV3FreezeResult,
} from "@/lib/estimates/v3-snapshot-server";
import type { Database } from "@/types/database";

/**
 * Lot 2, sous-lot 2.7 - gel du document d'émission d'une v3 (conception D15, M5) par
 * `public.freeze_estimate_v3_document_snapshot`, jumelle de `freeze_estimate_v2_document_snapshot`
 * (même signature, même bail exact de la page). Le TS calcule par le moteur pur (calcul commun au
 * gel d'approbation) ; PostgreSQL recalcule le devis complet, refuse tout écart d'un centime et
 * ouvre la session de document que la publication du PDF et l'émission exigent fraîche.
 */

type Supabase = SupabaseClient<Database>;

export type FreezeEstimateV3DocumentSnapshotInput = {
  supabase: Supabase;
  rpcClient: Supabase;
  tenantId: string;
  versionId: string;
  expectedUpdatedAt: string;
  expectedContentRevision: number;
  actorUserId: string;
  draftLockSessionId: string;
};

export async function freezeEstimateV3DocumentSnapshot(
  input: FreezeEstimateV3DocumentSnapshotInput
): Promise<EstimateV3FreezeResult> {
  const computed = await prepareEstimateV3FreezeArguments(input);
  const { data, error } = await input.rpcClient.rpc("freeze_estimate_v3_document_snapshot", {
    p_version_id: input.versionId,
    p_tenant_id: input.tenantId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_expected_content_revision: input.expectedContentRevision,
    p_actor_user_id: input.actorUserId,
    p_draft_lock_session_id: input.draftLockSessionId,
    ...computed,
  });
  if (error) {
    if (error.message.includes("ESTIMATE_DRAFT_LOCK_REQUIRED")) {
      throw conflict("Le verrou de cette page n’est plus actif. Réessayez depuis cette page.", undefined, "LOCK_REQUIRED");
    }
    throw toEstimateV3FreezeError(error, input.expectedUpdatedAt);
  }
  return toEstimateV3FreezeResult(data, input.expectedUpdatedAt);
}
