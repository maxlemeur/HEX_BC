import { acquireEstimateDraftLock, renewEstimateDraftLock } from "@/lib/estimates/client-locks";
import { isEstimateApiError } from "@/lib/estimates/client-errors";

export type EnsureTakeoffApplyDraftLockResult = {
  acquired: boolean;
  shouldRelease: boolean;
  errorMessage: string | null;
  /**
   * An acquisition was sent, whatever its answer: a lost answer may still have granted the lease, which is then the
   * caller's to release (the lease send by item tracks it). False when the lease was renewed or refused before that.
   */
  acquireAttempted?: boolean;
  /** Another member holds the draft (the message names them); otherwise a refusal is an error to try again. */
  lockedByOther?: boolean;
};

function resolveLockedByOtherMessage(holderName: string | null | undefined) {
  const normalizedHolder = holderName?.trim() ?? "";
  const holder = normalizedHolder.length > 0 ? normalizedHolder : "un autre utilisateur";
  return `La version cible est verrouillée par ${holder}.`;
}

export async function ensureTakeoffApplyDraftLock(
  versionId: string
): Promise<EnsureTakeoffApplyDraftLockResult> {
  try {
    const renewResult = await renewEstimateDraftLock(versionId);
    const isOwnedByCurrentUser = renewResult.lock?.isOwnedByCurrentUser !== false;

    if (renewResult.renewed && isOwnedByCurrentUser) {
      return {
        acquired: true,
        shouldRelease: false,
        errorMessage: null,
      };
    }

    return {
      acquired: false,
      shouldRelease: false,
      errorMessage: resolveLockedByOtherMessage(renewResult.lock?.holderName),
      lockedByOther: true,
    };
  } catch (renewError) {
    if (!isEstimateApiError(renewError) || renewError.status !== 404) {
      return {
        acquired: false,
        shouldRelease: false,
        errorMessage:
          renewError instanceof Error
            ? renewError.message
            : "Impossible de vérifier le verrou de brouillon de la version cible.",
      };
    }
  }

  try {
    const acquireResult = await acquireEstimateDraftLock(versionId);
    const isOwnedByCurrentUser = acquireResult.lock?.isOwnedByCurrentUser !== false;

    if (acquireResult.acquired && isOwnedByCurrentUser) {
      return {
        acquired: true,
        shouldRelease: true,
        errorMessage: null,
        acquireAttempted: true,
      };
    }

    return {
      acquired: false,
      shouldRelease: false,
      errorMessage: resolveLockedByOtherMessage(acquireResult.lock?.holderName),
      acquireAttempted: true,
      lockedByOther: true,
    };
  } catch (acquireError) {
    return {
      acquired: false,
      shouldRelease: false,
      errorMessage:
        acquireError instanceof Error
          ? acquireError.message
          : "Impossible d'acquérir le verrou de brouillon.",
      acquireAttempted: true,
    };
  }
}
