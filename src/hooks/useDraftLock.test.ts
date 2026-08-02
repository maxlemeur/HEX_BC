// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDraftLock } from "@/hooks/useDraftLock";
import type { EstimateDraftLock } from "@/lib/estimates/client";

const mocks = vi.hoisted(() => ({
  acquireDraftLock: vi.fn(),
  renewDraftLock: vi.fn(),
  releaseDraftLock: vi.fn(),
  isEstimateApiError: vi.fn(),
}));

vi.mock("@/lib/estimates/client", () => ({
  acquireEstimateDraftLock: mocks.acquireDraftLock,
  renewEstimateDraftLock: mocks.renewDraftLock,
  releaseEstimateDraftLock: mocks.releaseDraftLock,
  isEstimateApiError: mocks.isEstimateApiError,
}));

const HEARTBEAT_INTERVAL_MS = 30 * 1000;
const ACQUIRE_RETRY_INTERVAL_MS = 5 * 1000;

type ApiLikeError = {
  __estimateApiError: true;
  message: string;
};

function createApiError(message: string): ApiLikeError {
  return {
    __estimateApiError: true,
    message,
  };
}

function createLock(
  overrides: Partial<EstimateDraftLock> = {}
): EstimateDraftLock {
  return {
    versionId: "version-1",
    userId: "user-1",
    holderName: "Alice Martin",
    lockedAt: "2026-07-15T10:00:00.000Z",
    expiresAt: "2026-07-15T10:15:00.000Z",
    isOwnedByCurrentUser: true,
    isOwnedByCurrentSession: true,
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useDraftLock", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.isEstimateApiError.mockImplementation(
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "__estimateApiError" in error
    );
    mocks.acquireDraftLock.mockResolvedValue({
      acquired: true,
      lock: createLock(),
    });
    mocks.renewDraftLock.mockResolvedValue({
      renewed: true,
      lock: createLock(),
    });
    mocks.releaseDraftLock.mockResolvedValue({ released: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("acquires the lock and exposes explicit ownership", async () => {
    const { result } = renderHook(() =>
      useDraftLock({
        versionId: "version-1",
        currentUserId: "user-1",
      })
    );

    await waitFor(() => {
      expect(result.current.isOwnedByCurrentUser).toBe(true);
    });

    expect(mocks.acquireDraftLock).toHaveBeenCalledWith("version-1");
    expect(result.current.lock).toEqual(createLock());
    expect(result.current.holderName).toBe("Alice Martin");
    expect(result.current.isLockedByOther).toBe(false);
    expect(result.current.isAcquiring).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("reacquires the lock after the StrictMode effect replay", async () => {
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(StrictMode, null, children);
    const { result } = renderHook(
      () =>
        useDraftLock({
          versionId: "version-1",
          currentUserId: "user-1",
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isOwnedByCurrentUser).toBe(true);
    });

    expect(mocks.acquireDraftLock).toHaveBeenCalledWith("version-1");
    expect(result.current.lock).toEqual(createLock());
    expect(result.current.isAcquiring).toBe(false);
  });

  it("falls back to user ids when the API omits the ownership flag", async () => {
    mocks.acquireDraftLock.mockResolvedValueOnce({
      acquired: true,
      lock: createLock({
        isOwnedByCurrentUser: null,
        isOwnedByCurrentSession: null,
        userId: "user-current",
      }),
    });

    const { result } = renderHook(() =>
      useDraftLock({
        versionId: "version-1",
        currentUserId: "user-current",
      })
    );

    await waitFor(() => {
      expect(result.current.isOwnedByCurrentUser).toBe(true);
    });

    expect(result.current.isLockedByOther).toBe(false);
  });

  it("reports a lock held by another user as a conflict", async () => {
    const otherLock = createLock({
      userId: "user-other",
      holderName: "Bob Dupont",
      isOwnedByCurrentUser: false,
    });
    mocks.acquireDraftLock.mockResolvedValueOnce({
      acquired: false,
      lock: otherLock,
    });

    const { result } = renderHook(() =>
      useDraftLock({
        versionId: "version-1",
        currentUserId: "user-current",
      })
    );

    await waitFor(() => {
      expect(result.current.isLockedByOther).toBe(true);
    });

    expect(result.current.lock).toEqual(otherLock);
    expect(result.current.holderName).toBe("Bob Dupont");
    expect(result.current.isOwnedByCurrentUser).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("treats another page of the same user as a conflicting editor", async () => {
    const otherPageLock = createLock({
      isOwnedByCurrentUser: true,
      isOwnedByCurrentSession: false,
    });
    mocks.acquireDraftLock.mockResolvedValueOnce({
      acquired: false,
      lock: otherPageLock,
    });

    const { result } = renderHook(() =>
      useDraftLock({
        versionId: "version-1",
        currentUserId: "user-1",
      })
    );

    await waitFor(() => {
      expect(result.current.isLockedByOther).toBe(true);
    });

    expect(result.current.isOwnedByCurrentUser).toBe(false);
    expect(result.current.holderName).toBe(
      "vous dans un autre onglet ou appareil"
    );
  });

  it("automatically acquires after the other page releases the lock", async () => {
    vi.useFakeTimers();
    const otherPageLock = createLock({
      isOwnedByCurrentUser: true,
      isOwnedByCurrentSession: false,
    });
    mocks.acquireDraftLock
      .mockResolvedValueOnce({ acquired: false, lock: otherPageLock })
      .mockResolvedValueOnce({ acquired: true, lock: createLock() });

    const { result } = renderHook(() =>
      useDraftLock({
        versionId: "version-1",
        currentUserId: "user-1",
      })
    );

    await flushAsyncWork();
    expect(result.current.isLockedByOther).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACQUIRE_RETRY_INTERVAL_MS);
    });

    expect(mocks.acquireDraftLock).toHaveBeenCalledTimes(2);
    expect(result.current.isOwnedByCurrentUser).toBe(true);
    expect(result.current.isLockedByOther).toBe(false);
  });

  it("surfaces acquisition errors and clears them after a successful retry", async () => {
    mocks.acquireDraftLock.mockRejectedValueOnce(
      createApiError("Verrou temporairement indisponible.")
    );

    const { result } = renderHook(() =>
      useDraftLock({
        versionId: "version-1",
        currentUserId: "user-1",
      })
    );

    await waitFor(() => {
      expect(result.current.error).toBe("Verrou temporairement indisponible.");
    });
    expect(result.current.isOwnedByCurrentUser).toBe(false);
    expect(result.current.isLockedByOther).toBe(false);
    expect(result.current.lock).toBeNull();

    let acquired = false;
    await act(async () => {
      acquired = await result.current.acquire();
    });

    expect(acquired).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.isOwnedByCurrentUser).toBe(true);
  });

  it("renews on heartbeat, reports an error, then reflects ownership loss", async () => {
    vi.useFakeTimers();
    const otherLock = createLock({
      userId: "user-other",
      holderName: "Bob Dupont",
      isOwnedByCurrentUser: false,
    });
    mocks.renewDraftLock
      .mockRejectedValueOnce(createApiError("Renouvellement impossible."))
      .mockResolvedValueOnce({
        renewed: false,
        lock: otherLock,
      });

    const { result } = renderHook(() =>
      useDraftLock({
        versionId: "version-1",
        currentUserId: "user-1",
      })
    );

    await flushAsyncWork();
    expect(result.current.isOwnedByCurrentUser).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    });

    expect(mocks.renewDraftLock).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe("Renouvellement impossible.");
    expect(result.current.isOwnedByCurrentUser).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    });

    expect(mocks.renewDraftLock).toHaveBeenCalledTimes(2);
    expect(result.current.lock).toEqual(otherLock);
    expect(result.current.isOwnedByCurrentUser).toBe(false);
    expect(result.current.isLockedByOther).toBe(true);
  });

  it("releases the previous lock with keepalive when the version changes", async () => {
    const versionTwoLock = createLock({
      versionId: "version-2",
    });
    mocks.acquireDraftLock.mockImplementation(async (versionId: string) => ({
      acquired: true,
      lock: versionId === "version-2" ? versionTwoLock : createLock(),
    }));

    const { result, rerender } = renderHook(
      ({ versionId }: { versionId: string }) =>
        useDraftLock({
          versionId,
          currentUserId: "user-1",
        }),
      {
        initialProps: { versionId: "version-1" },
      }
    );

    await waitFor(() => {
      expect(result.current.isOwnedByCurrentUser).toBe(true);
    });
    mocks.releaseDraftLock.mockClear();

    rerender({ versionId: "version-2" });

    await waitFor(() => {
      expect(result.current.lock?.versionId).toBe("version-2");
    });

    expect(mocks.releaseDraftLock).toHaveBeenCalledWith("version-1", {
      keepalive: true,
    });
    expect(mocks.acquireDraftLock).toHaveBeenCalledWith("version-2");
  });

  it("waits for an old A release before reacquiring A after A to B to A", async () => {
    const oldVersionOneRelease = createDeferred<{ released: boolean }>();
    const versionTwoLock = createLock({ versionId: "version-2" });
    let versionOneAcquireCount = 0;
    let versionOneReleaseCount = 0;
    let versionOneServerLockExists = false;

    mocks.acquireDraftLock.mockImplementation(async (versionId: string) => {
      if (versionId === "version-1") {
        versionOneAcquireCount += 1;
        versionOneServerLockExists = true;
        return {
          acquired: true,
          lock: createLock(),
        };
      }

      return {
        acquired: true,
        lock: versionTwoLock,
      };
    });
    mocks.releaseDraftLock.mockImplementation((versionId: string) => {
      if (versionId === "version-1" && versionOneReleaseCount === 0) {
        versionOneReleaseCount += 1;
        return oldVersionOneRelease.promise.then((result) => {
          versionOneServerLockExists = false;
          return result;
        });
      }
      return Promise.resolve({ released: true });
    });

    const { result, rerender } = renderHook(
      ({ versionId }: { versionId: string }) =>
        useDraftLock({
          versionId,
          currentUserId: "user-1",
        }),
      {
        initialProps: { versionId: "version-1" },
      }
    );

    await waitFor(() => {
      expect(result.current.isOwnedByCurrentUser).toBe(true);
    });

    rerender({ versionId: "version-2" });
    await waitFor(() => {
      expect(result.current.lock?.versionId).toBe("version-2");
    });

    rerender({ versionId: "version-1" });
    await flushAsyncWork();

    expect(versionOneAcquireCount).toBe(1);
    expect(versionOneServerLockExists).toBe(true);

    await act(async () => {
      oldVersionOneRelease.resolve({ released: true });
      await oldVersionOneRelease.promise;
    });

    await waitFor(() => {
      expect(versionOneAcquireCount).toBe(2);
      expect(result.current.lock?.versionId).toBe("version-1");
    });

    expect(versionOneServerLockExists).toBe(true);
    expect(mocks.releaseDraftLock).toHaveBeenCalledWith("version-1", {
      keepalive: true,
    });
  });

  it("ignores an old acquisition after a route switch and releases it", async () => {
    const oldAcquisition = createDeferred<{
      acquired: boolean;
      lock: EstimateDraftLock | null;
    }>();
    const versionTwoLock = createLock({ versionId: "version-2" });
    mocks.acquireDraftLock
      .mockReturnValueOnce(oldAcquisition.promise)
      .mockResolvedValueOnce({
        acquired: true,
        lock: versionTwoLock,
      });

    const { result, rerender } = renderHook(
      ({ versionId }: { versionId: string }) =>
        useDraftLock({
          versionId,
          currentUserId: "user-1",
        }),
      {
        initialProps: { versionId: "version-1" },
      }
    );

    expect(mocks.acquireDraftLock).toHaveBeenCalledWith("version-1");
    rerender({ versionId: "version-2" });

    await waitFor(() => {
      expect(result.current.lock?.versionId).toBe("version-2");
    });
    mocks.releaseDraftLock.mockClear();

    await act(async () => {
      oldAcquisition.resolve({
        acquired: true,
        lock: createLock(),
      });
      await oldAcquisition.promise;
    });

    expect(result.current.lock).toEqual(versionTwoLock);
    expect(result.current.isOwnedByCurrentUser).toBe(true);
    expect(mocks.releaseDraftLock).toHaveBeenCalledWith("version-1", {
      keepalive: true,
    });
  });

  it("does not let an old release clear the new route lock", async () => {
    const oldRelease = createDeferred<{ released: boolean }>();
    const versionTwoLock = createLock({ versionId: "version-2" });
    mocks.acquireDraftLock.mockImplementation(async (versionId: string) => ({
      acquired: true,
      lock: versionId === "version-2" ? versionTwoLock : createLock(),
    }));

    const { result, rerender } = renderHook(
      ({ versionId }: { versionId: string }) =>
        useDraftLock({
          versionId,
          currentUserId: "user-1",
        }),
      {
        initialProps: { versionId: "version-1" },
      }
    );

    await waitFor(() => {
      expect(result.current.isOwnedByCurrentUser).toBe(true);
    });
    mocks.releaseDraftLock.mockReturnValueOnce(oldRelease.promise);

    rerender({ versionId: "version-2" });

    await waitFor(() => {
      expect(result.current.lock?.versionId).toBe("version-2");
    });

    await act(async () => {
      oldRelease.resolve({ released: true });
      await oldRelease.promise;
    });

    expect(result.current.lock).toEqual(versionTwoLock);
    expect(result.current.isOwnedByCurrentUser).toBe(true);
    expect(result.current.isLockedByOther).toBe(false);
  });

  it("ignores an old heartbeat after a route switch", async () => {
    vi.useFakeTimers();
    const oldRenewal = createDeferred<{
      renewed: boolean;
      lock: EstimateDraftLock | null;
    }>();
    const versionTwoLock = createLock({ versionId: "version-2" });
    mocks.acquireDraftLock.mockImplementation(async (versionId: string) => ({
      acquired: true,
      lock: versionId === "version-2" ? versionTwoLock : createLock(),
    }));
    mocks.renewDraftLock.mockReturnValueOnce(oldRenewal.promise);

    const { result, rerender } = renderHook(
      ({ versionId }: { versionId: string }) =>
        useDraftLock({
          versionId,
          currentUserId: "user-1",
        }),
      {
        initialProps: { versionId: "version-1" },
      }
    );

    await flushAsyncWork();
    expect(result.current.isOwnedByCurrentUser).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
    });
    expect(mocks.renewDraftLock).toHaveBeenCalledWith("version-1");

    rerender({ versionId: "version-2" });
    await flushAsyncWork();
    expect(result.current.lock).toEqual(versionTwoLock);
    mocks.releaseDraftLock.mockClear();

    await act(async () => {
      oldRenewal.resolve({
        renewed: true,
        lock: createLock(),
      });
      await oldRenewal.promise;
    });

    expect(result.current.lock).toEqual(versionTwoLock);
    expect(result.current.isOwnedByCurrentUser).toBe(true);
    expect(mocks.releaseDraftLock).toHaveBeenCalledWith("version-1", {
      keepalive: true,
    });
  });

  it("invalidates a pending acquisition when locking is disabled", async () => {
    const oldAcquisition = createDeferred<{
      acquired: boolean;
      lock: EstimateDraftLock | null;
    }>();
    mocks.acquireDraftLock.mockReturnValueOnce(oldAcquisition.promise);

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useDraftLock({
          versionId: "version-1",
          currentUserId: "user-1",
          enabled,
        }),
      {
        initialProps: { enabled: true },
      }
    );

    rerender({ enabled: false });
    await flushAsyncWork();
    mocks.releaseDraftLock.mockClear();

    await act(async () => {
      oldAcquisition.resolve({
        acquired: true,
        lock: createLock(),
      });
      await oldAcquisition.promise;
    });

    expect(result.current.lock).toBeNull();
    expect(result.current.isOwnedByCurrentUser).toBe(false);
    expect(result.current.isLockedByOther).toBe(false);
    expect(result.current.isAcquiring).toBe(false);
    expect(mocks.releaseDraftLock).toHaveBeenCalledWith("version-1", {
      keepalive: true,
    });
  });

  it("releases an owned lock with keepalive on unmount", async () => {
    const { result, unmount } = renderHook(() =>
      useDraftLock({
        versionId: "version-1",
        currentUserId: "user-1",
      })
    );

    await waitFor(() => {
      expect(result.current.isOwnedByCurrentUser).toBe(true);
    });
    mocks.releaseDraftLock.mockClear();

    unmount();
    await flushAsyncWork();

    expect(mocks.releaseDraftLock).toHaveBeenCalledTimes(1);
    expect(mocks.releaseDraftLock).toHaveBeenCalledWith("version-1", {
      keepalive: true,
    });
  });

  it("releases with keepalive before the document unloads", async () => {
    const { result } = renderHook(() =>
      useDraftLock({
        versionId: "version-1",
        currentUserId: "user-1",
      })
    );

    await waitFor(() => {
      expect(result.current.isOwnedByCurrentUser).toBe(true);
    });
    mocks.releaseDraftLock.mockClear();

    act(() => {
      window.dispatchEvent(new Event("beforeunload"));
    });

    expect(mocks.releaseDraftLock).toHaveBeenCalledTimes(1);
    expect(mocks.releaseDraftLock).toHaveBeenCalledWith("version-1", {
      keepalive: true,
    });
  });

  it("compensates an acquisition that resolves after unmount", async () => {
    const deferred = createDeferred<{
      acquired: boolean;
      lock: EstimateDraftLock | null;
    }>();
    mocks.acquireDraftLock.mockReturnValueOnce(deferred.promise);

    const { unmount } = renderHook(() =>
      useDraftLock({
        versionId: "version-1",
        currentUserId: "user-1",
      })
    );

    expect(mocks.acquireDraftLock).toHaveBeenCalledWith("version-1");
    unmount();
    await flushAsyncWork();
    mocks.releaseDraftLock.mockClear();

    await act(async () => {
      deferred.resolve({
        acquired: true,
        lock: createLock(),
      });
      await deferred.promise;
    });

    expect(mocks.releaseDraftLock).toHaveBeenCalledTimes(1);
    expect(mocks.releaseDraftLock).toHaveBeenCalledWith("version-1", {
      keepalive: true,
    });
  });

  it("forces release and reacquires the lock successfully", async () => {
    const { result } = renderHook(() =>
      useDraftLock({
        versionId: "version-1",
        currentUserId: "user-1",
      })
    );

    await waitFor(() => {
      expect(result.current.isOwnedByCurrentUser).toBe(true);
    });
    mocks.acquireDraftLock.mockClear();
    mocks.releaseDraftLock.mockClear();

    let acquired = false;
    await act(async () => {
      acquired = await result.current.forceUnlockAndAcquire();
    });

    expect(acquired).toBe(true);
    expect(mocks.releaseDraftLock).toHaveBeenCalledWith("version-1", {
      force: true,
    });
    expect(mocks.acquireDraftLock).toHaveBeenCalledTimes(1);
    expect(result.current.isForcingUnlock).toBe(false);
    expect(result.current.isOwnedByCurrentUser).toBe(true);
  });

  it("stops force unlock when the forced release fails", async () => {
    const { result } = renderHook(() =>
      useDraftLock({
        versionId: "version-1",
        currentUserId: "user-1",
      })
    );

    await waitFor(() => {
      expect(result.current.isOwnedByCurrentUser).toBe(true);
    });
    mocks.acquireDraftLock.mockClear();
    mocks.releaseDraftLock.mockResolvedValueOnce({ released: false });

    let acquired = true;
    await act(async () => {
      acquired = await result.current.forceUnlockAndAcquire();
    });

    expect(acquired).toBe(false);
    expect(mocks.releaseDraftLock).toHaveBeenCalledWith("version-1", {
      force: true,
    });
    expect(mocks.acquireDraftLock).not.toHaveBeenCalled();
    expect(result.current.isForcingUnlock).toBe(false);
    expect(result.current.isOwnedByCurrentUser).toBe(true);
  });

  it("keeps keepalive release errors silent but reports manual failures", async () => {
    const { result } = renderHook(() =>
      useDraftLock({
        versionId: "version-1",
        currentUserId: "user-1",
      })
    );

    await waitFor(() => {
      expect(result.current.isOwnedByCurrentUser).toBe(true);
    });
    mocks.releaseDraftLock.mockRejectedValue(
      createApiError("Impossible de liberer ce verrou.")
    );

    let released = true;
    await act(async () => {
      released = await result.current.release({ keepalive: true });
    });

    expect(released).toBe(false);
    expect(result.current.error).toBeNull();

    await act(async () => {
      released = await result.current.release();
    });

    expect(released).toBe(false);
    expect(result.current.error).toBe("Impossible de liberer ce verrou.");
  });
});
