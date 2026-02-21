"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  acquireEstimateDraftLock,
  isEstimateApiError,
  releaseEstimateDraftLock,
  renewEstimateDraftLock,
  type EstimateDraftLock,
  type ReleaseEstimateDraftLockOptions,
} from "@/lib/estimates/client";

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

type UseDraftLockOptions = {
  versionId: string;
  enabled?: boolean;
  currentUserId?: string | null;
};

export type UseDraftLockResult = {
  lock: EstimateDraftLock | null;
  holderName: string | null;
  isOwnedByCurrentUser: boolean;
  isLockedByOther: boolean;
  isAcquiring: boolean;
  isForcingUnlock: boolean;
  error: string | null;
  acquire: () => Promise<boolean>;
  release: (options?: ReleaseEstimateDraftLockOptions) => Promise<boolean>;
  forceUnlockAndAcquire: () => Promise<boolean>;
};

function resolveLockOwnership(
  lock: EstimateDraftLock | null,
  currentUserId: string | null | undefined
): boolean | null {
  if (!lock) return null;

  if (typeof lock.isOwnedByCurrentUser === "boolean") {
    return lock.isOwnedByCurrentUser;
  }

  if (currentUserId && lock.userId) {
    return currentUserId === lock.userId;
  }

  return null;
}

function resolveDraftLockErrorMessage(error: unknown, fallback: string) {
  if (isEstimateApiError(error)) {
    return error.message;
  }

  if (error instanceof Error) {
    const trimmed = error.message.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return fallback;
}

export function useDraftLock({
  versionId,
  enabled = true,
  currentUserId,
}: UseDraftLockOptions): UseDraftLockResult {
  const [lock, setLock] = useState<EstimateDraftLock | null>(null);
  const [isOwnedByCurrentUser, setIsOwnedByCurrentUser] = useState(false);
  const [isLockedByOther, setIsLockedByOther] = useState(false);
  const [isAcquiring, setIsAcquiring] = useState(false);
  const [isForcingUnlock, setIsForcingUnlock] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  const currentUserIdRef = useRef<string | null | undefined>(currentUserId);
  const isOwnedByCurrentUserRef = useRef(false);

  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);

  const updateOwnershipState = useCallback((ownsLock: boolean) => {
    isOwnedByCurrentUserRef.current = ownsLock;
    setIsOwnedByCurrentUser(ownsLock);
  }, []);

  const releaseForVersion = useCallback(
    async (
      targetVersionId: string,
      options: ReleaseEstimateDraftLockOptions = {}
    ): Promise<boolean> => {
      if (!targetVersionId) return false;
      if (!options.force && !isOwnedByCurrentUserRef.current) return false;

      try {
        const result = await releaseEstimateDraftLock(targetVersionId, options);
        if (!isMountedRef.current) {
          return result.released;
        }

        if (!options.force) {
          updateOwnershipState(false);
          setLock(null);
          setIsLockedByOther(false);
        }

        return result.released;
      } catch (releaseError) {
        if (!options.keepalive && isMountedRef.current) {
          setError(
            resolveDraftLockErrorMessage(
              releaseError,
              "Impossible de liberer le verrou de brouillon."
            )
          );
        }
        return false;
      }
    },
    [updateOwnershipState]
  );

  const acquire = useCallback(async (): Promise<boolean> => {
    if (!enabled || !versionId) return false;

    setIsAcquiring(true);
    setError(null);

    try {
      const result = await acquireEstimateDraftLock(versionId);
      if (!isMountedRef.current) return false;

      const ownership = resolveLockOwnership(result.lock, currentUserIdRef.current);
      const lockedByOther = !result.acquired || ownership === false;
      const ownsLock = result.acquired && !lockedByOther;

      setLock(result.lock);
      updateOwnershipState(ownsLock);
      setIsLockedByOther(lockedByOther);

      return ownsLock;
    } catch (acquireError) {
      if (!isMountedRef.current) return false;

      updateOwnershipState(false);
      setIsLockedByOther(false);
      setLock(null);
      setError(
        resolveDraftLockErrorMessage(
          acquireError,
          "Impossible d'acquerir le verrou de brouillon."
        )
      );
      return false;
    } finally {
      if (isMountedRef.current) {
        setIsAcquiring(false);
      }
    }
  }, [enabled, updateOwnershipState, versionId]);

  const renew = useCallback(async (): Promise<boolean> => {
    if (!enabled || !versionId || !isOwnedByCurrentUser) {
      return false;
    }

    try {
      const result = await renewEstimateDraftLock(versionId);
      if (!isMountedRef.current) return false;

      const ownership = resolveLockOwnership(result.lock, currentUserIdRef.current);
      const lockedByOther = !result.renewed || ownership === false;
      const ownsLock = result.renewed && !lockedByOther;

      setLock((previous) => result.lock ?? previous);
      updateOwnershipState(ownsLock);
      setIsLockedByOther(lockedByOther);

      if (ownsLock) {
        setError(null);
      }

      return ownsLock;
    } catch (renewError) {
      if (!isMountedRef.current) return false;

      setError(
        resolveDraftLockErrorMessage(
          renewError,
          "Impossible de renouveler le verrou de brouillon."
        )
      );
      return false;
    }
  }, [enabled, isOwnedByCurrentUser, updateOwnershipState, versionId]);

  const release = useCallback(
    async (options: ReleaseEstimateDraftLockOptions = {}) => {
      if (!versionId) return false;
      return releaseForVersion(versionId, options);
    },
    [releaseForVersion, versionId]
  );

  const forceUnlockAndAcquire = useCallback(async (): Promise<boolean> => {
    if (!versionId) return false;

    setIsForcingUnlock(true);
    setError(null);

    try {
      const released = await releaseForVersion(versionId, { force: true });
      if (!released) {
        return false;
      }

      return await acquire();
    } finally {
      if (isMountedRef.current) {
        setIsForcingUnlock(false);
      }
    }
  }, [acquire, releaseForVersion, versionId]);

  useEffect(() => {
    if (!enabled || !versionId) {
      setLock(null);
      setError(null);
      updateOwnershipState(false);
      setIsLockedByOther(false);
      setIsAcquiring(false);
      return;
    }

    void acquire();

    return () => {
      void releaseForVersion(versionId, { keepalive: true });
    };
  }, [acquire, enabled, releaseForVersion, updateOwnershipState, versionId]);

  useEffect(() => {
    if (!enabled || !versionId || !isOwnedByCurrentUser) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void renew();
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [enabled, isOwnedByCurrentUser, renew, versionId]);

  useEffect(() => {
    if (!enabled || !versionId) return;

    const handleBeforeUnload = () => {
      if (!isOwnedByCurrentUser) return;
      void releaseForVersion(versionId, { keepalive: true });
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [enabled, isOwnedByCurrentUser, releaseForVersion, versionId]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const holderName = useMemo(() => {
    return lock?.holderName ?? null;
  }, [lock?.holderName]);

  return {
    lock,
    holderName,
    isOwnedByCurrentUser,
    isLockedByOther,
    isAcquiring,
    isForcingUnlock,
    error,
    acquire,
    release,
    forceUnlockAndAcquire,
  };
}
