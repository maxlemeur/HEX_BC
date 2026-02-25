import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchTakeoffJobMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/takeoff/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/takeoff/client")>(
    "@/lib/takeoff/client"
  );

  return {
    ...actual,
    fetchTakeoffJob: fetchTakeoffJobMock,
  };
});

import { TakeoffApiError } from "@/lib/takeoff/client";
import { useTakeoffJobPolling } from "@/lib/takeoff/use-takeoff-job-polling";

describe("useTakeoffJobPolling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops polling immediately on 401 errors", async () => {
    fetchTakeoffJobMock.mockRejectedValueOnce(
      new TakeoffApiError(
        "Session expiree. Veuillez vous reconnecter.",
        401,
        null,
        "AUTH_REQUIRED"
      )
    );

    const { result } = renderHook(() =>
      useTakeoffJobPolling("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.errorStatus).toBe(401);
    expect(result.current.error).toContain("Session expiree");
    expect(result.current.isPolling).toBe(false);
    expect(fetchTakeoffJobMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(fetchTakeoffJobMock).toHaveBeenCalledTimes(1);
  });
});
