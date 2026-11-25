import { releaseEstimateDraftLock, type EstimateDraftLock } from "@/lib/estimates/client-locks";
import { isOrphanedTabEstimateDraftLockSession } from "@/lib/estimates/draft-lock-session-client";

/**
 * TI-665 : le bail refusé est tenu, pour le même utilisateur, par une identité
 * antérieure de cet onglet dont le document n'existe plus (il est parti pendant
 * son chargement après avoir demandé le bail). Ce bail est libéré sous cette
 * identité, scopée côté serveur, pour que la page le redemande sous la sienne :
 * aucune identité n'est partagée et une ancienne libération en retard ne peut
 * pas retirer le nouveau bail. Faux dans tout autre cas, erreur comprise.
 */
export async function releaseOrphanedTabDraftLock(
  versionId: string,
  lock: EstimateDraftLock | null
) {
  if (
    lock?.isOwnedByCurrentUser !== true ||
    lock.isOwnedByCurrentSession !== false ||
    !lock.sessionId ||
    !(await isOrphanedTabEstimateDraftLockSession(versionId, lock.sessionId))
  ) {
    return false;
  }

  try {
    await releaseEstimateDraftLock(versionId, { sessionId: lock.sessionId });
    return true;
  } catch {
    return false;
  }
}
