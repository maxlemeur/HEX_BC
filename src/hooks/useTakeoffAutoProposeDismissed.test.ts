import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTakeoffAutoProposeDismissed } from "@/hooks/useTakeoffAutoProposeDismissed";

describe("useTakeoffAutoProposeDismissed", () => {
  const PROJECT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const PROJECT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns dismissed: false when no localStorage key", () => {
    const { result } = renderHook(() =>
      useTakeoffAutoProposeDismissed(PROJECT_A),
    );
    expect(result.current.dismissed).toBe(false);
  });

  it('returns dismissed: true when localStorage has "1"', () => {
    localStorage.setItem(
      `takeoff-auto-propose-dismissed-${PROJECT_A}`,
      "1",
    );
    const { result } = renderHook(() =>
      useTakeoffAutoProposeDismissed(PROJECT_A),
    );
    expect(result.current.dismissed).toBe(true);
  });

  it('dismissPermanently() writes "1" to correct key', () => {
    const { result } = renderHook(() =>
      useTakeoffAutoProposeDismissed(PROJECT_A),
    );

    act(() => {
      result.current.dismissPermanently();
    });

    expect(result.current.dismissed).toBe(true);
    expect(
      localStorage.getItem(`takeoff-auto-propose-dismissed-${PROJECT_A}`),
    ).toBe("1");
  });

  it("different projectIds are independent", () => {
    localStorage.setItem(
      `takeoff-auto-propose-dismissed-${PROJECT_A}`,
      "1",
    );

    const { result: resultA } = renderHook(() =>
      useTakeoffAutoProposeDismissed(PROJECT_A),
    );
    const { result: resultB } = renderHook(() =>
      useTakeoffAutoProposeDismissed(PROJECT_B),
    );

    expect(resultA.current.dismissed).toBe(true);
    expect(resultB.current.dismissed).toBe(false);
  });
});
