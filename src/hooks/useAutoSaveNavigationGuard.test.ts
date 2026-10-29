// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useAutoSaveNavigationGuard,
  type UseAutoSaveNavigationGuardOptions,
} from "@/hooks/useAutoSaveNavigationGuard";

type GuardHarnessProps = UseAutoSaveNavigationGuardOptions;

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

describe("useAutoSaveNavigationGuard behavior", () => {
  it("does not resume a pending navigation after the guard unmounts", async () => {
    let finishSave!: (saved: boolean) => void;
    const onNavigate = vi.fn();
    const { unmount } = renderNavigationGuard({ enabled: true, hasPendingChanges: true, isSaving: false,
      onBeforeNavigation: () => new Promise<boolean>((resolve) => { finishSave = resolve; }),
      onNavigate, onBlockedNavigation: vi.fn() });
    dispatchAnchorClick(appendAnchor({ href: "/dashboard/products" }).child);
    unmount();
    await act(async () => { finishSave(true); });
    expect(onNavigate).not.toHaveBeenCalled();
  });
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
});
