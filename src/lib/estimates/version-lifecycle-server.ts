import "server-only";

import { resolveEstimateEngineVersion } from "@/lib/estimates/calc-engine-version";
import { engineFreezesSnapshot } from "@/lib/estimates/engine/capabilities";
import { ApiError, badRequest, conflict } from "@/lib/estimates/errors";
import { evaluateEstimateSendGating } from "@/lib/estimates/gating";
import { normalizeEstimateDraftLockSessionId } from "@/lib/estimates/lock-session";
import { loadVerifiedOfferDocument } from "@/lib/estimates/offer-document";
import type { DocumentProof1 } from "@/lib/estimates/offer-contract";
import { generateEstimatePdfNow } from "@/lib/estimates/pdf-generator";
import type { PatchEstimateStatusInput } from "@/lib/estimates/schemas";
import {
  assertDraftLockOwnedByCurrentUser,
  assertDraftStatus,
  getAuthenticatedContext,
  getVersionAccessOrThrow,
  isTenantAdmin,
} from "@/lib/estimates/server-context";
import { freezeEstimateV2Snapshot } from "@/lib/estimates/v2-snapshot-server";
import {
  assertVersionConcurrencyToken,
  normalizeConcurrencyToken,
} from "@/lib/estimates/version-concurrency";
import {
  assertEstimateForceSendAllowed,
  assertEstimateStatusTransition,
  resolveEstimateSendOverride,
  resolveStatusEventType,
} from "@/lib/estimates/version-lifecycle-plan";
import {
  loadEstimateVersionForStatus,
  transitionEstimateVersionStatusAtomically,
} from "@/lib/estimates/version-lifecycle-repository";
import { getServiceRoleSupabaseClient } from "@/lib/estimates/version-workflow-client-server";
import { assertCanWriteEstimateWorkflows } from "@/lib/estimates/write-access";
import type { Json } from "@/types/database";

export async function getEstimateSendGating(versionId: string) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;
  const { version, project } = await getVersionAccessOrThrow(
    supabase,
    versionId,
    context
  );

  const gating = await evaluateEstimateSendGating({
    supabase,
    tenantId,
    version,
    project,
  });

  return {
    gating,
  };
}

export async function freezeEstimateV2SnapshotForSend(
  versionId: string,
  concurrencyToken: string,
  options: { draftLockSessionId?: string | null } = {}
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  assertCanWriteEstimateWorkflows(context.tenantRole);
  const { version } = await getVersionAccessOrThrow(
    supabase,
    versionId,
    context
  );
  assertVersionConcurrencyToken(version.updated_at, concurrencyToken);
  const requestedUpdatedAt = normalizeConcurrencyToken(concurrencyToken);
  if (!requestedUpdatedAt) throw badRequest("Le devis doit être relu avant l'envoi.");
  const draftLockSessionId = normalizeEstimateDraftLockSessionId(options.draftLockSessionId);
  if (!draftLockSessionId) {
    throw conflict("Cette page doit détenir le verrou du devis avant l'envoi.", undefined, "LOCK_REQUIRED");
  }
  assertDraftStatus(version.status);
  try {
    await assertDraftLockOwnedByCurrentUser({
      supabase,
      tenantId,
      versionId,
      userId,
      draftLockSessionId,
    });
  } catch (error) {
    if (
      error instanceof ApiError && error.code === "CONFLICT" &&
      typeof error.details === "object" && error.details !== null && "lock" in error.details
    ) {
      const lock = error.details.lock;
      if (typeof lock === "object" && lock !== null && "is_current_session" in lock && lock.is_current_session === false) {
        throw conflict(error.message, undefined, "LOCK_REQUIRED");
      }
    }
    throw error;
  }
  // Lot 2, sous-lot 2.7 : la v3 fige aussi son document (freeze_estimate_v3_document_snapshot).
  if (!engineFreezesSnapshot(resolveEstimateEngineVersion(version))) {
    return version;
  }
  return freezeEstimateV2Snapshot({
    supabase,
    rpcClient: getServiceRoleSupabaseClient(),
    tenantId,
    versionId,
    expectedUpdatedAt: requestedUpdatedAt,
    expectedContentRevision: version.content_revision,
    actorUserId: userId,
    purpose: "document",
    draftLockSessionId,
  });
}

export async function patchEstimateStatus(
  versionId: string,
  input: PatchEstimateStatusInput,
  concurrencyToken: string | undefined,
  options: { draftLockSessionId?: string | null } = {}
) {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  // Les transitions de statut sont des écritures de workflow : réservées aux
  // rôles écrivains (admin/engineer). getVersionAccessOrThrow n'autorise que
  // propriétaire OU admin, ce qui laisserait un propriétaire rétrogradé
  // (director/viewer) sceller/accepter/archiver via le client service-role.
  assertCanWriteEstimateWorkflows(context.tenantRole);
  let { version, project } = await getVersionAccessOrThrow(
    supabase,
    versionId,
    context
  );
  assertVersionConcurrencyToken(version.updated_at, concurrencyToken);
  const requestedUpdatedAt = normalizeConcurrencyToken(concurrencyToken);
  if (!requestedUpdatedAt) {
    throw badRequest("Jeton de concurrence manquant.");
  }
  const draftLockSessionId = normalizeEstimateDraftLockSessionId(options.draftLockSessionId);
  if (version.status === "draft") {
    await assertDraftLockOwnedByCurrentUser({
      supabase,
      tenantId,
      versionId,
      userId,
      draftLockSessionId,
    });
  }

  if (version.status === input.status) {
    return {
      version: await loadEstimateVersionForStatus({ supabase, tenantId, versionId }),
    };
  }

  assertEstimateStatusTransition(version.status, input.status);

  let sealHash: string | null = null;
  let emittedDocument: DocumentProof1 | null = null;
  let emissionPayloadVersion: number | null = null;
  let forcedByAdmin = false;
  let forcedBlockingFlags: string[] = [];
  let transitionExpectedUpdatedAt = requestedUpdatedAt;

  if (version.status === "draft" && input.status === "sent") {
    if (!draftLockSessionId) {
      throw conflict("Le verrou de cette page est requis pour émettre le devis.", undefined, "LOCK_REQUIRED");
    }
    assertEstimateForceSendAllowed(input.force, isTenantAdmin(context.tenantRole));

    // Lot 2, sous-lot 2.7 : une v3 fige son document comme une v2 (gel v3, bail de la page).
    if (engineFreezesSnapshot(resolveEstimateEngineVersion(version))) {
      const frozen = await freezeEstimateV2Snapshot({
        supabase,
        rpcClient: getServiceRoleSupabaseClient(),
        tenantId,
        versionId,
        expectedUpdatedAt: requestedUpdatedAt,
        expectedContentRevision: version.content_revision,
        actorUserId: userId,
        purpose: "document",
        draftLockSessionId,
      });
      transitionExpectedUpdatedAt = frozen.updated_at;
      ({ version, project } = await getVersionAccessOrThrow(
        supabase,
        versionId,
        context
      ));
    }

    const gating = await evaluateEstimateSendGating({
      supabase,
      tenantId,
      version,
      project,
    });

    ({ forcedByAdmin, forcedBlockingFlags } = resolveEstimateSendOverride(gating, input.force));

    await generateEstimatePdfNow(versionId, {
      force: true,
      triggeredBy: "send",
    });

    const offer = await loadVerifiedOfferDocument({
      supabase,
      tenantId,
      versionId,
      requireSealed: false,
    });
    // Contrat 1 (v1/v2) ou contrat 2 (v3) : l'appariement au moteur est prouvé par la relecture.
    if (offer.proof.clientContractVersion === null) {
      throw badRequest("La nouvelle émission exige une copie commerciale complète.", undefined, "OFFER_DOCUMENT_CONTRACT_INVALID");
    }
    sealHash = offer.sealHash;
    emittedDocument = offer.proof;
    emissionPayloadVersion = 5;
  } else {
    const offer = await loadVerifiedOfferDocument({ supabase, tenantId, versionId });
    emittedDocument = offer.proof;
    emissionPayloadVersion = offer.sealPayloadVersion;
  }

  const statusEventType = resolveStatusEventType(input.status);
  if (!statusEventType) {
    throw badRequest(
      `Transition de statut invalide: ${version.status} -> ${input.status}.`
    );
  }

  const statusEventMetadata: Record<string, unknown> = {};
  if (forcedByAdmin) {
    statusEventMetadata.forced_by_admin = true;
    statusEventMetadata.forced_blocking_flags = forcedBlockingFlags;
  }

  const data = await transitionEstimateVersionStatusAtomically({
    versionId,
    tenantId,
    expectedUpdatedAt: transitionExpectedUpdatedAt,
    nextStatus: input.status,
    sealHash,
    actorUserId: userId,
    eventMetadata: statusEventMetadata as Json,
    occurredAt: new Date().toISOString(),
    sealPayloadVersion: emissionPayloadVersion,
    expectedDocumentContract: emittedDocument,
    draftLockSessionId: version.status === "draft" ? draftLockSessionId : null,
  });

  return {
    version: data,
  };
}
