import {
  acquireEstimateDraftLock,
  isEstimateApiError,
  renewEstimateDraftLock,
} from "@/lib/estimates/client";

export type EnsureTakeoffApplyDraftLockResult = {
  acquired: boolean;
  shouldRelease: boolean;
  errorMessage: string | null;
};

function resolveLockedByOtherMessage(holderName: string | null | undefined) {
  const normalizedHolder = holderName?.trim() ?? "";
  const holder = normalizedHolder.length > 0 ? normalizedHolder : "un autre utilisateur";
  return `La version cible est verrouillee par ${holder}.`;
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
    };
  } catch (renewError) {
    if (!isEstimateApiError(renewError) || renewError.status !== 404) {
      return {
        acquired: false,
        shouldRelease: false,
        errorMessage:
          renewError instanceof Error
            ? renewError.message
            : "Impossible de verifier le verrou de brouillon de la version cible.",
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
      };
    }

    return {
      acquired: false,
      shouldRelease: false,
      errorMessage: resolveLockedByOtherMessage(acquireResult.lock?.holderName),
    };
  } catch (acquireError) {
    return {
      acquired: false,
      shouldRelease: false,
      errorMessage:
        acquireError instanceof Error
          ? acquireError.message
          : "Impossible d'acquerir le verrou de brouillon.",
    };
  }
}
