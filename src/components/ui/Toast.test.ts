import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToastProvider, useToast } from "@/components/ui/Toast";

type ToastApi = ReturnType<typeof useToast>;

function ToastHarness({ captureToast }: { captureToast: (toast: ToastApi) => void }) {
  const toast = useToast();

  useEffect(() => {
    captureToast(toast);
  }, [captureToast, toast]);

  return createElement(
    "button",
    {
      id: "trigger-toast",
      onClick: () => toast.success({ title: "Saved", description: "Done", durationMs: 100 }),
      type: "button",
    },
    "Trigger"
  );
}

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.useRealTimers();
});

async function renderHarness() {
  let renderer: ReactTestRenderer;
  let toastApi: ToastApi | null = null;

  await act(async () => {
    renderer = create(
      createElement(
        ToastProvider,
        null,
        createElement(ToastHarness, {
          captureToast: (toast) => {
            toastApi = toast;
          },
        })
      )
    );
  });

  const getToastApi = () => {
    if (!toastApi) {
      throw new Error("Toast API unavailable");
    }
    return toastApi;
  };

  return { renderer: renderer!, getToastApi };
}

/* ── Helpers ── */

function countToasts(renderer: ReactTestRenderer) {
  return renderer.root.findAll(
    (node) => node.props && node.props["data-toast-id"]
  ).length;
}

function getToastTitles(renderer: ReactTestRenderer) {
  return renderer.root
    .findAll(
      (node) =>
        node.type === "p" &&
        node.props.className?.includes("font-semibold") &&
        typeof node.children[0] === "string"
    )
    .map((n) => n.children[0] as string);
}

/* ── Tests ── */

describe("ui/Toast", () => {
  it("pushes and auto-dismisses toasts", async () => {
    vi.useFakeTimers();

    const { renderer } = await renderHarness();

    const trigger = renderer.root.findByProps({ id: "trigger-toast" });

    await act(async () => {
      trigger.props.onClick();
    });

    expect(countToasts(renderer)).toBe(1);

    // Auto-dismiss fires after durationMs (100ms)
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    // Exit animation fallback removes after 250ms
    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    expect(countToasts(renderer)).toBe(0);
  });

  it("limits visible toasts to 3 (queues the rest)", async () => {
    vi.useFakeTimers();

    const { renderer, getToastApi } = await renderHarness();
    const toastApi = getToastApi();

    // Push 5 toasts with long duration so they don't auto-dismiss
    await act(async () => {
      for (let i = 0; i < 5; i++) {
        toastApi.success({ title: `Toast ${i}`, durationMs: 60_000 });
      }
    });

    // Only 3 should be rendered
    expect(countToasts(renderer)).toBe(3);
    expect(getToastTitles(renderer)).toEqual(["Toast 0", "Toast 1", "Toast 2"]);
  });

  it("advances queue when a visible toast is dismissed", async () => {
    vi.useFakeTimers();

    const { renderer, getToastApi } = await renderHarness();
    const toastApi = getToastApi();

    const ids: string[] = [];

    await act(async () => {
      for (let i = 0; i < 4; i++) {
        ids.push(toastApi.success({ title: `Toast ${i}`, durationMs: 60_000 }));
      }
    });

    expect(countToasts(renderer)).toBe(3);

    // Dismiss first toast
    await act(async () => {
      toastApi.dismiss(ids[0]);
    });

    // Wait for exit animation fallback
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // Toast 3 should now be visible
    expect(countToasts(renderer)).toBe(3);
    expect(getToastTitles(renderer)).toEqual(["Toast 1", "Toast 2", "Toast 3"]);
  });

  it("handles rapid-fire pushes via functional setState", async () => {
    vi.useFakeTimers();

    const { renderer, getToastApi } = await renderHarness();
    const toastApi = getToastApi();

    // Push 3 toasts in one batch
    await act(async () => {
      toastApi.success({ title: "A", durationMs: 60_000 });
      toastApi.error({ title: "B", durationMs: 60_000 });
      toastApi.warning({ title: "C", durationMs: 60_000 });
    });

    // All 3 should be visible (within max)
    expect(countToasts(renderer)).toBe(3);
    expect(getToastTitles(renderer)).toEqual(["A", "B", "C"]);
  });

  it("queued toast gets its own auto-dismiss timer only when promoted", async () => {
    vi.useFakeTimers();

    const { renderer, getToastApi } = await renderHarness();
    const toastApi = getToastApi();

    // Push 4 toasts: first 3 with 200ms, 4th with 500ms
    await act(async () => {
      toastApi.info({ title: "Fast 1", durationMs: 200 });
      toastApi.info({ title: "Fast 2", durationMs: 200 });
      toastApi.info({ title: "Fast 3", durationMs: 200 });
      toastApi.info({ title: "Slow 4", durationMs: 500 });
    });

    expect(countToasts(renderer)).toBe(3);

    // After 200ms, first 3 start exiting
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    // After exit fallback (250ms more), first 3 are removed, Slow 4 promoted
    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    expect(countToasts(renderer)).toBe(1);
    expect(getToastTitles(renderer)).toEqual(["Slow 4"]);

    // Slow 4 gets its own 500ms timer starting NOW (when promoted)
    // So it should still be visible after 300ms
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(countToasts(renderer)).toBe(1);

    // After 200ms more (total 500ms from promotion), it starts exiting
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    // After exit fallback
    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    expect(countToasts(renderer)).toBe(0);
  });
});
