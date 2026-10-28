import "server-only";

import { loadVerifiedOfferDocument } from "@/lib/estimates/offer-document";
import {
  getAuthenticatedContext,
  getVersionAccessOrThrow,
} from "@/lib/estimates/server-context";
import {
  loadEstimateSealSource,
  logEstimateVersionEvent,
} from "@/lib/estimates/version-lifecycle-repository";
import { evaluateHistoricalEstimateSeal } from "@/lib/estimates/version-seal-plan";

export async function verifyEstimateSeal(versionId: string) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;

  await getVersionAccessOrThrow(supabase, versionId, context);

  const sealSource = await loadEstimateSealSource({
    supabase,
    tenantId,
    versionId,
  });
  if (sealSource.version.seal_payload_version === 5) {
    // Marker5 never enters the historical candidate/fallback path. The helper
    // also verifies the actual immutable PDF, not just the calculation hash.
    const offer = await loadVerifiedOfferDocument({ supabase, tenantId, versionId });
    await logEstimateVersionEvent({
      versionId, eventType: "seal_verified", actorUserId: userId,
      metadata: { valid: true, computed_hash: offer.sealHash, stored_hash: offer.sealHash, matched_seal_scheme: "v5" },
      occurredAt: new Date().toISOString(),
    });
    // Lot 2, sous-lot 2.7 : le contrat (1 ou 2) et la charge de calcul (4 ou 6) du marqueur 5.
    return { valid: true, computed_hash: offer.sealHash, stored_hash: offer.sealHash, seal_payload_version: 5,
      client_contract_version: offer.proof.clientContractVersion, calc_payload_version: offer.calculationPayloadVersion };
  }
  const { matched_seal_scheme, ...verification } = evaluateHistoricalEstimateSeal(sealSource);
  await logEstimateVersionEvent({
    versionId,
    eventType: "seal_verified",
    actorUserId: userId,
    metadata: {
      valid: verification.valid,
      computed_hash: verification.computed_hash,
      stored_hash: verification.stored_hash,
      matched_seal_scheme,
    },
    occurredAt: new Date().toISOString(),
  });

  return verification;
}
