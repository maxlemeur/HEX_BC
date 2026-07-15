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

type DraftLockTarget = {
  versionId: string;
  generation: number;
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

  const currentUserIdRef = useRef<string | null | undefined>(currentUserId);
  const isOwnedByCurrentUserRef = useRef(false);
  const targetGenerationRef = useRef(0);
  const activeTargetRef = useRef<DraftLockTarget | null>(null);
  const releaseQueueByVersionRef = useRef(
    new Map<string, Promise<unknown>>()
  );

  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);

  const updateOwnershipState = useCallback((ownsLock: boolean) => {
    isOwnedByCurrentUserRef.current = ownsLock;
    setIsOwnedByCurrentUser(ownsLock);
  }, []);

  const isCurrentTarget = useCallback((target: DraftLockTarget) => {
    const activeTarget = activeTargetRef.current;
    return (
      activeTarget?.generation === target.generation &&
      activeTarget.versionId === target.versionId
    );
  }, []);

  const queueReleaseRequest = useCallback(
    (
      targetVersionId: string,
      options: ReleaseEstimateDraftLockOptions
    ) => {
      const previousRelease =
        releaseQueueByVersionRef.current.get(targetVersionId);
      const releaseOperation = (async () => {
        if (previousRelease) {
          try {
            await previousRelease;
          } catch {
            // A later release must still run after an earlier failed attempt.
          }
        }
        return releaseEstimateDraftLock(targetVersionId, options);
      })();

      releaseQueueByVersionRef.current.set(targetVersionId, releaseOperation);
      void releaseOperation.finally(() => {
        if (
          releaseQueueByVersionRef.current.get(targetVersionId) ===
          releaseOperation
        ) {
          releaseQueueByVersionRef.current.delete(targetVersionId);
        }
      }).catch(() => undefined);
      return releaseOperation;
    },
    []
  );

  const waitForQueuedReleases = useCallback((targetVersionId: string) => {
    const initialRelease =
      releaseQueueByVersionRef.current.get(targetVersionId);
    if (!initialRelease) return null;

    return (async () => {
      let queuedRelease: Promise<unknown> | undefined = initialRelease;
      while (queuedRelease) {
        try {
          await queuedRelease;
        } catch {
          // Acquisition can retry after the release failure has been observed.
        }
        queuedRelease =
          releaseQueueByVersionRef.current.get(targetVersionId);
      }
    })();
  }, []);

  const releaseStaleOwnedTarget = useCallback(
    (target: DraftLockTarget) => {
      if (activeTargetRef.current?.versionId === target.versionId) return;
      void queueReleaseRequest(target.versionId, {
        keepalive: true,
      }).catch(() => false);
    },
    [queueReleaseRequest]
  );

  const releaseForVersion = useCallback(
    async (
      targetVersionId: string,
      options: ReleaseEstimateDraftLockOptions,
      target: DraftLockTarget
    ): Promise<boolean> => {
      if (!targetVersionId) return false;
      if (
        !options.force &&
        !options.keepalive &&
        !isOwnedByCurrentUserRef.current
      ) {
        return false;
      }

      try {
        const result = await queueReleaseRequest(targetVersionId, options);
        if (!isCurrentTarget(target)) {
          return result.released;
        }

        if (!options.force) {
          updateOwnershipState(false);
          setLock(null);
          setIsLockedByOther(false);
        }

        return result.released;
      } catch (releaseError) {
        if (!options.keepalive && isCurrentTarget(target)) {
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
    [isCurrentTarget, queueReleaseRequest, updateOwnershipState]
  );

  const acquireForTarget = useCallback(async (target: DraftLockTarget) => {
    if (!isCurrentTarget(target)) return false;

    setIsAcquiring(true);
    setError(null);

    try {
      const releaseBarrier = waitForQueuedReleases(target.versionId);
      if (releaseBarrier) {
        await releaseBarrier;
        if (!isCurrentTarget(target)) return false;
      }

      const result = await acquireEstimateDraftLock(target.versionId);
      const ownership = resolveLockOwnership(result.lock, currentUserIdRef.current);
      const lockedByOther = !result.acquired || ownership === false;
      const ownsLock = result.acquired && !lockedByOther;

      if (!isCurrentTarget(target)) {
        if (ownsLock) {
          releaseStaleOwnedTarget(target);
        }
        return false;
      }

      setLock(result.lock);
      updateOwnershipState(ownsLock);
      setIsLockedByOther(lockedByOther);

      return ownsLock;
    } catch (acquireError) {
      if (!isCurrentTarget(target)) return false;

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
      if (isCurrentTarget(target)) {
        setIsAcquiring(false);
      }
    }
  }, [
    isCurrentTarget,
    releaseStaleOwnedTarget,
    updateOwnershipState,
    waitForQueuedReleases,
  ]);

  const acquire = useCallback(async (): Promise<boolean> => {
    const target = activeTargetRef.current;
    if (!enabled || !versionId || !target || target.versionId !== versionId) {
      return false;
    }

    return acquireForTarget(target);
  }, [acquireForTarget, enabled, versionId]);

  const renewForTarget = useCallback(async (target: DraftLockTarget) => {
    if (!isCurrentTarget(target) || !isOwnedByCurrentUserRef.current) {
      return false;
    }

    try {
      const result = await renewEstimateDraftLock(target.versionId);
      const ownership = resolveLockOwnership(result.lock, currentUserIdRef.current);
      const lockedByOther = !result.renewed || ownership === false;
      const ownsLock = result.renewed && !lockedByOther;

      if (!isCurrentTarget(target)) {
        if (ownsLock) {
          releaseStaleOwnedTarget(target);
        }
        return false;
      }

      setLock((previous) => result.lock ?? previous);
      updateOwnershipState(ownsLock);
      setIsLockedByOther(lockedByOther);

      if (ownsLock) {
        setError(null);
      }

      return ownsLock;
    } catch (renewError) {
      if (!isCurrentTarget(target)) return false;

      setError(
        resolveDraftLockErrorMessage(
          renewError,
          "Impossible de renouveler le verrou de brouillon."
        )
      );
      return false;
    }
  }, [isCurrentTarget, releaseStaleOwnedTarget, updateOwnershipState]);

  const release = useCallback(
    async (options: ReleaseEstimateDraftLockOptions = {}) => {
      const target = activeTargetRef.current;
      if (!versionId || !target || target.versionId !== versionId) return false;
      return releaseForVersion(versionId, options, target);
    },
    [releaseForVersion, versionId]
  );

  const forceUnlockAndAcquire = useCallback(async (): Promise<boolean> => {
    const target = activeTargetRef.current;
    if (!versionId || !target || target.versionId !== versionId) return false;

    setIsForcingUnlock(true);
    setError(null);

    try {
      const released = await releaseForVersion(
        versionId,
        { force: true },
        target
      );
      if (!released || !isCurrentTarget(target)) {
        return false;
      }

      return await acquireForTarget(target);
    } finally {
      if (isCurrentTarget(target)) {
        setIsForcingUnlock(false);
      }
    }
  }, [acquireForTarget, isCurrentTarget, releaseForVersion, versionId]);

  useEffect(() => {
    const target = enabled && versionId
      ? {
          versionId,
          generation: targetGenerationRef.current + 1,
        }
      : null;
    targetGenerationRef.current += 1;
    activeTargetRef.current = target;

    setIsForcingUnlock(false);

    if (!target) {
      setLock(null);
      setError(null);
      updateOwnershipState(false);
      setIsLockedByOther(false);
      setIsAcquiring(false);
      return;
    }

    setLock(null);
    setError(null);
    updateOwnershipState(false);
    setIsLockedByOther(false);
    void acquireForTarget(target);

    return () => {
      if (activeTargetRef.current?.generation === target.generation) {
        activeTargetRef.current = null;
      }
      void releaseForVersion(
        target.versionId,
        { keepalive: true },
        target
      );
    };
  }, [acquireForTarget, enabled, releaseForVersion, updateOwnershipState, versionId]);

  useEffect(() => {
    if (!enabled || !versionId || !isOwnedByCurrentUser) {
      return;
    }
    const target = activeTargetRef.current;
    if (!target || target.versionId !== versionId) return;

    const intervalId = window.setInterval(() => {
      void renewForTarget(target);
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [enabled, isOwnedByCurrentUser, renewForTarget, versionId]);

  useEffect(() => {
    if (!enabled || !versionId) return;
    const target = activeTargetRef.current;
    if (!target || target.versionId !== versionId) return;

    const handleBeforeUnload = () => {
      void releaseForVersion(versionId, { keepalive: true }, target);
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [enabled, releaseForVersion, versionId]);

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
