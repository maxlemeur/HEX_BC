import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createElement, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToastProvider, useToast } from "@/components/ui-legacy/Toast";

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

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function renderHarness() {
  let toastApi: ToastApi | null = null;

  render(
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

  const getToastApi = () => {
    if (!toastApi) {
      throw new Error("Toast API unavailable");
    }
    return toastApi;
  };

  return { getToastApi };
}

/* ── Helpers ── */

function countToasts() {
  return document.querySelectorAll("[data-toast-id]").length;
}

function getToastTitles() {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-toast-id] p.font-semibold")
  ).map((node) => node.textContent ?? "");
}

/* ── Tests ── */

describe("ui/Toast", () => {
  it("falls back to a noop toast api when rendered without provider", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let toastApi: ToastApi | null = null;

    render(
      createElement(ToastHarness, {
        captureToast: (toast) => {
          toastApi = toast;
        },
      })
    );

    expect(toastApi).not.toBeNull();
    expect(toastApi!.success({ title: "Saved" })).toBe("missing-toast-provider");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "useToast called without ToastProvider. Toasts will be ignored."
    );
  });

  it("pushes and auto-dismisses toasts", async () => {
    vi.useFakeTimers();

    await renderHarness();

    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));

    expect(countToasts()).toBe(1);

    // Auto-dismiss fires after durationMs (100ms)
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    // Exit animation fallback removes after 250ms
    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    expect(countToasts()).toBe(0);
  });

  it("limits visible toasts to 3 (queues the rest)", async () => {
    vi.useFakeTimers();

    const { getToastApi } = await renderHarness();
    const toastApi = getToastApi();

    // Push 5 toasts with long duration so they don't auto-dismiss
    await act(async () => {
      for (let i = 0; i < 5; i++) {
        toastApi.success({ title: `Toast ${i}`, durationMs: 60_000 });
      }
    });

    // Only 3 should be rendered
    expect(countToasts()).toBe(3);
    expect(getToastTitles()).toEqual(["Toast 0", "Toast 1", "Toast 2"]);
  });

  it("advances queue when a visible toast is dismissed", async () => {
    vi.useFakeTimers();

    const { getToastApi } = await renderHarness();
    const toastApi = getToastApi();

    const ids: string[] = [];

    await act(async () => {
      for (let i = 0; i < 4; i++) {
        ids.push(toastApi.success({ title: `Toast ${i}`, durationMs: 60_000 }));
      }
    });

    expect(countToasts()).toBe(3);

    // Dismiss first toast
    await act(async () => {
      toastApi.dismiss(ids[0]);
    });

    // Wait for exit animation fallback
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // Toast 3 should now be visible
    expect(countToasts()).toBe(3);
    expect(getToastTitles()).toEqual(["Toast 1", "Toast 2", "Toast 3"]);
  });

  it("dismisses a queued toast by id without rendering it as exiting", async () => {
    vi.useFakeTimers();

    const { getToastApi } = await renderHarness();
    const toastApi = getToastApi();

    const ids: string[] = [];
    await act(async () => {
      for (let i = 0; i < 4; i++) {
        ids.push(toastApi.success({ title: `Toast ${i}`, durationMs: 60_000 }));
      }
    });

    expect(countToasts()).toBe(3);
    expect(getToastTitles()).toEqual(["Toast 0", "Toast 1", "Toast 2"]);

    // Dismiss queued toast (Toast 3). It must not appear briefly as exiting.
    await act(async () => {
      toastApi.dismiss(ids[3]);
    });

    expect(countToasts()).toBe(3);
    expect(getToastTitles()).toEqual(["Toast 0", "Toast 1", "Toast 2"]);

    // Dismissing a visible toast should no longer promote Toast 3 because it is already removed.
    await act(async () => {
      toastApi.dismiss(ids[0]);
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(countToasts()).toBe(2);
    expect(getToastTitles()).toEqual(["Toast 1", "Toast 2"]);
  });

  it("handles rapid-fire pushes via functional setState", async () => {
    vi.useFakeTimers();

    const { getToastApi } = await renderHarness();
    const toastApi = getToastApi();

    // Push 3 toasts in one batch
    await act(async () => {
      toastApi.success({ title: "A", durationMs: 60_000 });
      toastApi.error({ title: "B", durationMs: 60_000 });
      toastApi.warning({ title: "C", durationMs: 60_000 });
    });

    // All 3 should be visible (within max)
    expect(countToasts()).toBe(3);
    expect(getToastTitles()).toEqual(["A", "B", "C"]);
  });

  it("queued toast gets its own auto-dismiss timer only when promoted", async () => {
    vi.useFakeTimers();

    const { getToastApi } = await renderHarness();
    const toastApi = getToastApi();

    // Push 4 toasts: first 3 with 200ms, 4th with 500ms
    await act(async () => {
      toastApi.info({ title: "Fast 1", durationMs: 200 });
      toastApi.info({ title: "Fast 2", durationMs: 200 });
      toastApi.info({ title: "Fast 3", durationMs: 200 });
      toastApi.info({ title: "Slow 4", durationMs: 500 });
    });

    expect(countToasts()).toBe(3);

    // After 200ms, first 3 start exiting
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    // After exit fallback (250ms more), first 3 are removed, Slow 4 promoted
    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    expect(countToasts()).toBe(1);
    expect(getToastTitles()).toEqual(["Slow 4"]);

    // Slow 4 gets its own 500ms timer starting NOW (when promoted)
    // So it should still be visible after 300ms
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(countToasts()).toBe(1);

    // After 200ms more (total 500ms from promotion), it starts exiting
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    // After exit fallback
    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    expect(countToasts()).toBe(0);
  });
});
