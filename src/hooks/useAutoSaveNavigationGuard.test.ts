import { describe, expect, it } from "vitest";

import {
  isPrimaryNavigationClick,
  shouldBlockInternalNavigation,
  shouldGuardAnchorNavigation,
} from "@/hooks/useAutoSaveNavigationGuard";

describe("useAutoSaveNavigationGuard helpers", () => {
  it("blocks internal navigation only when autosave can still lose data", () => {
    expect(shouldBlockInternalNavigation(true, false)).toBe(true);
    expect(shouldBlockInternalNavigation(false, true)).toBe(true);
    expect(shouldBlockInternalNavigation(false, false)).toBe(false);
  });

  it("handles only primary non-modified clicks", () => {
    expect(
      isPrimaryNavigationClick({
        button: 0,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        defaultPrevented: false,
      })
    ).toBe(true);

    expect(
      isPrimaryNavigationClick({
        button: 1,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        defaultPrevented: false,
      })
    ).toBe(false);

    expect(
      isPrimaryNavigationClick({
        button: 0,
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        defaultPrevented: false,
      })
    ).toBe(false);

    expect(
      isPrimaryNavigationClick({
        button: 0,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        defaultPrevented: true,
      })
    ).toBe(false);
  });

  it("guards only same-origin route changes", () => {
    expect(
      shouldGuardAnchorNavigation({
        currentHref: "https://app.example.com/dashboard/estimates/1/edit",
        destinationHref: "https://app.example.com/dashboard/estimates/1",
      })
    ).toBe(true);

    expect(
      shouldGuardAnchorNavigation({
        currentHref: "https://app.example.com/dashboard/estimates/1/edit",
        destinationHref:
          "https://app.example.com/dashboard/estimates/1/edit#section-2",
      })
    ).toBe(false);

    expect(
      shouldGuardAnchorNavigation({
        currentHref: "https://app.example.com/dashboard/estimates/1/edit",
        destinationHref: "https://external.example.org/path",
      })
    ).toBe(false);

    expect(
      shouldGuardAnchorNavigation({
        currentHref: "https://app.example.com/dashboard/estimates/1/edit",
        destinationHref: "https://app.example.com/dashboard",
        target: "_blank",
      })
    ).toBe(false);

    expect(
      shouldGuardAnchorNavigation({
        currentHref: "https://app.example.com/dashboard/estimates/1/edit",
        destinationHref: "https://app.example.com/dashboard",
        hasDownloadAttribute: true,
      })
    ).toBe(false);
  });
});
