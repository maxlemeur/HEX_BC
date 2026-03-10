import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTakeoffAutoProposeDismissed } from "@/hooks/useTakeoffAutoProposeDismissed";

describe("useTakeoffAutoProposeDismissed", () => {
  const PROJECT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const PROJECT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const PROFILE_A = "user-a";
  const PROFILE_B = "user-b";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T10:00:00.000Z"));
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns dismissed: false when no localStorage key", () => {
    const { result } = renderHook(() =>
      useTakeoffAutoProposeDismissed(PROJECT_A, {
        context: "hub",
        profileId: PROFILE_A,
        scopeKey: "scope-1",
      }),
    );
    expect(result.current.dismissed).toBe(false);
    expect(result.current.temporarilyDismissed).toBe(false);
  });

  it("returns dismissed: true when the permanent key exists for the same profile and context", () => {
    localStorage.setItem(
      "takeoff-auto-propose:v2:dismissed:user-a:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:hub",
      "1",
    );

    const { result } = renderHook(() =>
      useTakeoffAutoProposeDismissed(PROJECT_A, {
        context: "hub",
        profileId: PROFILE_A,
        scopeKey: "scope-1",
      }),
    );

    expect(result.current.dismissed).toBe(true);
  });

  it("dismissPermanently scopes the key by profile, project and context", () => {
    const { result } = renderHook(() =>
      useTakeoffAutoProposeDismissed(PROJECT_A, {
        context: "import",
        profileId: PROFILE_A,
        scopeKey: "scope-1",
      }),
    );

    act(() => {
      result.current.dismissPermanently();
    });

    expect(result.current.dismissed).toBe(true);
    expect(
      localStorage.getItem(
        "takeoff-auto-propose:v2:dismissed:user-a:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:import",
      ),
    ).toBe("1");
  });

  it("dismissTemporarily snoozes only the matching scope key", () => {
    const { result, rerender } = renderHook(
      ({ scopeKey }) =>
        useTakeoffAutoProposeDismissed(PROJECT_A, {
          context: "hub",
          profileId: PROFILE_A,
          scopeKey,
        }),
      {
        initialProps: { scopeKey: "scope-1" },
      },
    );

    act(() => {
      result.current.dismissTemporarily();
    });

    expect(result.current.temporarilyDismissed).toBe(true);

    rerender({ scopeKey: "scope-2" });
    expect(result.current.temporarilyDismissed).toBe(false);
  });

  it("expires temporary dismissal after 24h", () => {
    const { result } = renderHook(() =>
      useTakeoffAutoProposeDismissed(PROJECT_A, {
        context: "hub",
        profileId: PROFILE_A,
        scopeKey: "scope-1",
      }),
    );

    act(() => {
      result.current.dismissTemporarily();
    });
    expect(result.current.temporarilyDismissed).toBe(true);

    act(() => {
      vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    });

    const { result: refreshed } = renderHook(() =>
      useTakeoffAutoProposeDismissed(PROJECT_A, {
        context: "hub",
        profileId: PROFILE_A,
        scopeKey: "scope-1",
      }),
    );
    expect(refreshed.current.temporarilyDismissed).toBe(false);
  });

  it("different profile/context combinations stay isolated", () => {
    localStorage.setItem(
      "takeoff-auto-propose:v2:dismissed:user-a:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:hub",
      "1",
    );

    const { result: profileAHub } = renderHook(() =>
      useTakeoffAutoProposeDismissed(PROJECT_A, {
        context: "hub",
        profileId: PROFILE_A,
        scopeKey: "scope-1",
      }),
    );
    const { result: profileBHub } = renderHook(() =>
      useTakeoffAutoProposeDismissed(PROJECT_A, {
        context: "hub",
        profileId: PROFILE_B,
        scopeKey: "scope-1",
      }),
    );
    const { result: profileAImport } = renderHook(() =>
      useTakeoffAutoProposeDismissed(PROJECT_B, {
        context: "import",
        profileId: PROFILE_A,
        scopeKey: "scope-1",
      }),
    );

    expect(profileAHub.current.dismissed).toBe(true);
    expect(profileBHub.current.dismissed).toBe(false);
    expect(profileAImport.current.dismissed).toBe(false);
  });
});
