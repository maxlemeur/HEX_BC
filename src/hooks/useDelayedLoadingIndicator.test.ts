import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SLOW_LOADING_DELAY_MS,
  useDelayedLoadingIndicator,
} from "@/hooks/useDelayedLoadingIndicator";

describe("useDelayedLoadingIndicator", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("announces a slow load after the bounded grace period", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useDelayedLoadingIndicator(true));

    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(SLOW_LOADING_DELAY_MS));
    expect(result.current).toBe(true);
  });

  it("clears the slow state as soon as loading ends", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ loading }) => useDelayedLoadingIndicator(loading),
      { initialProps: { loading: true } }
    );

    act(() => vi.advanceTimersByTime(SLOW_LOADING_DELAY_MS));
    expect(result.current).toBe(true);
    rerender({ loading: false });
    expect(result.current).toBe(false);
  });
});
