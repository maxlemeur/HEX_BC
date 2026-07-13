import { beforeEach, describe, expect, it, vi } from "vitest";

const acquireEstimateDraftLockMock = vi.hoisted(() => vi.fn());
const isEstimateApiErrorMock = vi.hoisted(() => vi.fn());
const renewEstimateDraftLockMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/estimates/client", () => ({
  acquireEstimateDraftLock: acquireEstimateDraftLockMock,
  isEstimateApiError: isEstimateApiErrorMock,
  renewEstimateDraftLock: renewEstimateDraftLockMock,
}));

import { ensureTakeoffApplyDraftLock } from "@/lib/takeoff/apply-draft-lock";

const VERSION_ID = "77777777-7777-4777-8777-777777777777";

describe("ensureTakeoffApplyDraftLock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reuses a lock already owned by the current user", async () => {
    renewEstimateDraftLockMock.mockResolvedValue({
      renewed: true,
      lock: { isOwnedByCurrentUser: true },
    });

    await expect(ensureTakeoffApplyDraftLock(VERSION_ID)).resolves.toEqual({
      acquired: true,
      shouldRelease: false,
      errorMessage: null,
    });
    expect(acquireEstimateDraftLockMock).not.toHaveBeenCalled();
  });

  it("acquires a missing lock and asks the caller to release it", async () => {
    const notFoundError = Object.assign(new Error("Lock absent"), { status: 404 });
    renewEstimateDraftLockMock.mockRejectedValue(notFoundError);
    isEstimateApiErrorMock.mockImplementation((error) => error === notFoundError);
    acquireEstimateDraftLockMock.mockResolvedValue({
      acquired: true,
      lock: { isOwnedByCurrentUser: true },
    });

    await expect(ensureTakeoffApplyDraftLock(VERSION_ID)).resolves.toEqual({
      acquired: true,
      shouldRelease: true,
      errorMessage: null,
    });
    expect(acquireEstimateDraftLockMock).toHaveBeenCalledWith(VERSION_ID);
  });

  it("reports the holder when another user owns the lock", async () => {
    renewEstimateDraftLockMock.mockResolvedValue({
      renewed: false,
      lock: {
        isOwnedByCurrentUser: false,
        holderName: "Camille",
      },
    });

    await expect(ensureTakeoffApplyDraftLock(VERSION_ID)).resolves.toEqual({
      acquired: false,
      shouldRelease: false,
      errorMessage: "La version cible est verrouillee par Camille.",
    });
  });
});
