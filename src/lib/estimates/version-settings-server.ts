import { badRequest, conflict } from "@/lib/estimates/errors";
import { normalizeEstimateDraftLockSessionId } from "@/lib/estimates/lock-session";
import type { PatchEstimateVersionInput } from "@/lib/estimates/schemas";
import {
  assertDraftLockOwnedByCurrentUser,
  assertDraftStatus,
  getAuthenticatedContext,
  getVersionAccessOrThrow,
} from "@/lib/estimates/server-context";
import { persistAtomicEstimateSettings } from "@/lib/estimates/settings-atomic";
import { assertVersionConcurrencyToken, normalizeConcurrencyToken } from "@/lib/estimates/version-concurrency";
import { prepareEstimateVersionSettingsPatch } from "@/lib/estimates/version-settings-plan";
import { getServiceRoleSupabaseClient } from "@/lib/estimates/version-workflow-client-server";
import { assertCanWriteEstimateWorkflows } from "@/lib/estimates/write-access";

export async function patchEstimateVersion(
  versionId: string,
  input: PatchEstimateVersionInput,
  concurrencyToken?: string
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  // Comme patchEstimateStatus : l'ecriture passe par le client service-role et
  // contourne donc la RLS. getVersionAccessOrThrow n'autorise que proprietaire
  // OU admin, ce qui laisserait un proprietaire retrograde (director/viewer)
  // modifier marge, remise, coefficient et conditions d'un devis.
  assertCanWriteEstimateWorkflows(context.tenantRole);
  const { version, project } = await getVersionAccessOrThrow(supabase, versionId, context);

  assertDraftStatus(version.status);
  const lock = await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId,
    userId,
  });
  assertVersionConcurrencyToken(version.updated_at, concurrencyToken);

  const expectedUpdatedAt = normalizeConcurrencyToken(concurrencyToken);
  const sessionId = normalizeEstimateDraftLockSessionId(lock.session_id);
  if (!expectedUpdatedAt || !sessionId) {
    throw conflict("Un verrou actif de cette page est requis pour enregistrer le devis.", { lock: null }, "LOCK_REQUIRED");
  }
  if (!Number.isSafeInteger(input.expected_content_revision) || input.expected_content_revision < 0) {
    throw badRequest("La révision initiale du devis est requise.");
  }

  const payload = prepareEstimateVersionSettingsPatch(input);
  return persistAtomicEstimateSettings({
    applyTaxRateToLines: input.apply_tax_rate_to_lines === true,
    supabase,
    rpcClient: getServiceRoleSupabaseClient(),
    tenantId,
    actorUserId: userId,
    projectUserId: project.user_id,
    authorizedVersion: version,
    expectedUpdatedAt,
    expectedContentRevision: input.expected_content_revision,
    draftLockSessionId: sessionId,
    patch: payload,
  });
}
