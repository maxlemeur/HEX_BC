// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isPrimaryNavigationClick,
  shouldBlockInternalNavigation,
  shouldGuardAnchorNavigation,
  useAutoSaveNavigationGuard,
} from "@/hooks/useAutoSaveNavigationGuard";

type GuardHarnessProps = {
  enabled: boolean;
  hasPendingChanges: boolean;
  isSaving: boolean;
  onBlockedNavigation: () => void;
};

function renderNavigationGuard(initialProps: GuardHarnessProps) {
  return renderHook(
    (props: GuardHarnessProps) => useAutoSaveNavigationGuard(props),
    { initialProps }
  );
}

function appendAnchor({
  href,
  target,
  download = false,
}: {
  href: string;
  target?: string;
  download?: boolean;
}) {
  const anchor = document.createElement("a");
  anchor.href = href;
  if (target) anchor.target = target;
  if (download) anchor.setAttribute("download", "estimate.csv");
  const child = document.createElement("span");
  child.textContent = "Destination";
  anchor.appendChild(child);
  document.body.appendChild(anchor);
  return { anchor, child };
}

function dispatchAnchorClick(
  target: HTMLElement,
  init: MouseEventInit = {}
) {
  const anchor = target.closest("a") ?? target;
  const reachedAnchor = vi.fn((event: Event) => {
    event.preventDefault();
  });
  anchor.addEventListener("click", reachedAnchor);
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...init,
  });

  act(() => {
    target.dispatchEvent(event);
  });

  anchor.removeEventListener("click", reachedAnchor);
  return { event, reachedAnchor };
}

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

describe("useAutoSaveNavigationGuard behavior", () => {
  beforeEach(() => {
    window.history.replaceState(
      { page: "edit" },
      "",
      "/dashboard/estimates/1/edit?tab=editor"
    );
    document.body.replaceChildren();
  });

  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
    window.history.replaceState(null, "", "/");
  });

  it("blocks a real primary same-origin anchor click", () => {
    const onBlockedNavigation = vi.fn();
    renderNavigationGuard({
      enabled: true,
      hasPendingChanges: true,
      isSaving: false,
      onBlockedNavigation,
    });
    const { child } = appendAnchor({
      href: "/dashboard/estimates/1",
    });

    const { event, reachedAnchor } = dispatchAnchorClick(child);

    expect(event.defaultPrevented).toBe(true);
    expect(reachedAnchor).not.toHaveBeenCalled();
    expect(onBlockedNavigation).toHaveBeenCalledTimes(1);
  });

  it("allows modified, external, hash, download and non-self navigation", () => {
    const onBlockedNavigation = vi.fn();
    renderNavigationGuard({
      enabled: true,
      hasPendingChanges: true,
      isSaving: false,
      onBlockedNavigation,
    });
    const cases: Array<{
      anchor: ReturnType<typeof appendAnchor>;
      event?: MouseEventInit;
    }> = [
      {
        anchor: appendAnchor({ href: "/dashboard/estimates/1" }),
        event: { ctrlKey: true },
      },
      {
        anchor: appendAnchor({ href: "https://external.example.org/path" }),
      },
      {
        anchor: appendAnchor({
          href: "/dashboard/estimates/1/edit?tab=editor#section-2",
        }),
      },
      {
        anchor: appendAnchor({
          href: "/dashboard/estimates/1",
          download: true,
        }),
      },
      {
        anchor: appendAnchor({
          href: "/dashboard/estimates/1",
          target: "_blank",
        }),
      },
    ];

    for (const testCase of cases) {
      const { reachedAnchor } = dispatchAnchorClick(
        testCase.anchor.child,
        testCase.event
      );
      expect(reachedAnchor).toHaveBeenCalledTimes(1);
    }
    expect(onBlockedNavigation).not.toHaveBeenCalled();
  });

  it("reacts to pending and saving changes and calls the latest callback", () => {
    const firstCallback = vi.fn();
    const latestCallback = vi.fn();
    const { rerender } = renderNavigationGuard({
      enabled: true,
      hasPendingChanges: false,
      isSaving: false,
      onBlockedNavigation: firstCallback,
    });
    const { child } = appendAnchor({
      href: "/dashboard/estimates/1",
    });

    const cleanClick = dispatchAnchorClick(child);
    expect(cleanClick.reachedAnchor).toHaveBeenCalledTimes(1);
    expect(firstCallback).not.toHaveBeenCalled();

    rerender({
      enabled: true,
      hasPendingChanges: true,
      isSaving: false,
      onBlockedNavigation: latestCallback,
    });
    const pendingClick = dispatchAnchorClick(child);
    expect(pendingClick.reachedAnchor).not.toHaveBeenCalled();
    expect(firstCallback).not.toHaveBeenCalled();
    expect(latestCallback).toHaveBeenCalledTimes(1);

    rerender({
      enabled: true,
      hasPendingChanges: false,
      isSaving: true,
      onBlockedNavigation: latestCallback,
    });
    const savingClick = dispatchAnchorClick(child);
    expect(savingClick.reachedAnchor).not.toHaveBeenCalled();
    expect(latestCallback).toHaveBeenCalledTimes(2);

    rerender({
      enabled: true,
      hasPendingChanges: false,
      isSaving: false,
      onBlockedNavigation: latestCallback,
    });
    const savedClick = dispatchAnchorClick(child);
    expect(savedClick.reachedAnchor).toHaveBeenCalledTimes(1);
    expect(latestCallback).toHaveBeenCalledTimes(2);
  });

  it("restores guarded history on popstate and refreshes the clean baseline", () => {
    const onBlockedNavigation = vi.fn();
    const { rerender } = renderNavigationGuard({
      enabled: true,
      hasPendingChanges: true,
      isSaving: false,
      onBlockedNavigation,
    });
    const downstreamPopState = vi.fn();
    window.addEventListener("popstate", downstreamPopState);

    try {
      window.history.pushState(
        { page: "detail" },
        "",
        "/dashboard/estimates/1"
      );
      act(() => {
        window.dispatchEvent(
          new PopStateEvent("popstate", { state: { page: "detail" } })
        );
      });

      expect(onBlockedNavigation).toHaveBeenCalledTimes(1);
      expect(downstreamPopState).not.toHaveBeenCalled();
      expect(`${window.location.pathname}${window.location.search}`).toBe(
        "/dashboard/estimates/1/edit?tab=editor"
      );
      expect(window.history.state).toEqual({ page: "edit" });

      rerender({
        enabled: true,
        hasPendingChanges: false,
        isSaving: false,
        onBlockedNavigation,
      });
      window.history.pushState(
        { page: "detail-clean" },
        "",
        "/dashboard/estimates/1?from=editor"
      );
      act(() => {
        window.dispatchEvent(
          new PopStateEvent("popstate", {
            state: { page: "detail-clean" },
          })
        );
      });

      expect(onBlockedNavigation).toHaveBeenCalledTimes(1);
      expect(downstreamPopState).toHaveBeenCalledTimes(1);
      expect(`${window.location.pathname}${window.location.search}`).toBe(
        "/dashboard/estimates/1?from=editor"
      );

      rerender({
        enabled: true,
        hasPendingChanges: false,
        isSaving: true,
        onBlockedNavigation,
      });
      window.history.pushState({ page: "home" }, "", "/dashboard");
      act(() => {
        window.dispatchEvent(
          new PopStateEvent("popstate", { state: { page: "home" } })
        );
      });

      expect(onBlockedNavigation).toHaveBeenCalledTimes(2);
      expect(downstreamPopState).toHaveBeenCalledTimes(1);
      expect(`${window.location.pathname}${window.location.search}`).toBe(
        "/dashboard/estimates/1?from=editor"
      );
      expect(window.history.state).toEqual({ page: "detail-clean" });
    } finally {
      window.removeEventListener("popstate", downstreamPopState);
    }
  });

  it("removes click and popstate listeners on unmount", () => {
    const onBlockedNavigation = vi.fn();
    const { unmount } = renderNavigationGuard({
      enabled: true,
      hasPendingChanges: true,
      isSaving: false,
      onBlockedNavigation,
    });
    const { child } = appendAnchor({
      href: "/dashboard/estimates/1",
    });

    unmount();

    const click = dispatchAnchorClick(child);
    expect(click.reachedAnchor).toHaveBeenCalledTimes(1);

    window.history.pushState({ page: "detail" }, "", "/dashboard/estimates/1");
    act(() => {
      window.dispatchEvent(
        new PopStateEvent("popstate", { state: { page: "detail" } })
      );
    });

    expect(onBlockedNavigation).not.toHaveBeenCalled();
    expect(`${window.location.pathname}${window.location.search}`).toBe(
      "/dashboard/estimates/1"
    );
  });
});
