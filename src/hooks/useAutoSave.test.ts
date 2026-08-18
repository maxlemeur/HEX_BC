// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isSaveShortcutKey,
  resolveAutoSaveRetryDelay,
  resolveAutoSaveStatusLabel,
  shouldAutomaticallyRetry,
  shouldBlockBeforeUnload,
  useAutoSave,
  type AutoSaveResult,
} from "@/hooks/useAutoSave";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

describe("useAutoSave helpers", () => {
  it("detects save shortcut for ctrl/cmd + s", () => {
    expect(
      isSaveShortcutKey({
        key: "s",
        ctrlKey: true,
        metaKey: false,
      })
    ).toBe(true);
    expect(
      isSaveShortcutKey({
        key: "S",
        ctrlKey: false,
        metaKey: true,
      })
    ).toBe(true);
    expect(
      isSaveShortcutKey({
        key: "x",
        ctrlKey: true,
        metaKey: false,
      })
    ).toBe(false);
    expect(
      isSaveShortcutKey({
        ctrlKey: true,
        metaKey: false,
      })
    ).toBe(false);
  });

  it("maps autosave statuses to the expected french labels", () => {
    expect(resolveAutoSaveStatusLabel("pending")).toBe("En attente");
    expect(resolveAutoSaveStatusLabel("saving")).toBe("Synchronisation\u2026");
    expect(resolveAutoSaveStatusLabel("saved")).toBe("Sauvegardé");
    expect(resolveAutoSaveStatusLabel("idle")).toBe("À jour");
    expect(resolveAutoSaveStatusLabel("error")).toBe(
      "Échec de synchronisation"
    );
    expect(resolveAutoSaveStatusLabel("offline")).toBe("Hors ligne");
    expect(resolveAutoSaveStatusLabel("disabled")).toBe("Auto désactivée");
    expect(resolveAutoSaveStatusLabel("blocked")).toBe(
      "Synchronisation bloquée"
    );
  });

  it("prevents regressions to legacy autosave labels", () => {
    const savingLabel = resolveAutoSaveStatusLabel("saving");
    expect(savingLabel).toContain("\u2026");
    expect(savingLabel).not.toContain("...");
    expect(resolveAutoSaveStatusLabel("saved")).not.toBe("Sauvegarde");
    expect(resolveAutoSaveStatusLabel("idle")).not.toBe("Sauvegarde");
  });

  it("blocks beforeunload only when data may be lost", () => {
    expect(shouldBlockBeforeUnload(true, false)).toBe(true);
    expect(shouldBlockBeforeUnload(false, true)).toBe(true);
    expect(shouldBlockBeforeUnload(false, false)).toBe(false);
  });

  it("retries transient errors with a capped exponential delay", () => {
    expect(shouldAutomaticallyRetry("error")).toBe(true);
    expect(shouldAutomaticallyRetry("blocked")).toBe(false);
    expect(shouldAutomaticallyRetry("saved")).toBe(false);
    expect(shouldAutomaticallyRetry("noop")).toBe(false);

    expect(resolveAutoSaveRetryDelay(2_000, 0)).toBe(2_000);
    expect(resolveAutoSaveRetryDelay(2_000, 1)).toBe(4_000);
    expect(resolveAutoSaveRetryDelay(2_000, 2)).toBe(8_000);
    expect(resolveAutoSaveRetryDelay(2_000, 10)).toBe(30_000);
  });
});

describe("useAutoSave behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("debounces saves and restarts the delay when another change is scheduled", async () => {
    const onSave = vi.fn().mockResolvedValue("saved" satisfies AutoSaveResult);
    const { result } = renderHook(() =>
      useAutoSave({
        enabled: true,
        hasPendingChanges: true,
        debounceMs: 2_000,
        onSave,
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(onSave).not.toHaveBeenCalled();

    act(() => {
      result.current.scheduleSave();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_999);
    });
    expect(onSave).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("debounce");
  });

  it("exposes saving and saved states before returning to pending when changes remain", async () => {
    const deferredSave = createDeferred<AutoSaveResult>();
    const onSave = vi.fn().mockReturnValue(deferredSave.promise);
    const { result } = renderHook(() =>
      useAutoSave({
        enabled: true,
        hasPendingChanges: true,
        debounceMs: 2_000,
        onSave,
      })
    );

    expect(result.current.status).toBe("pending");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(result.current.status).toBe("saving");
    expect(result.current.isSaving).toBe(true);

    await act(async () => {
      deferredSave.resolve("saved");
      await deferredSave.promise;
    });
    expect(result.current.status).toBe("saved");
    expect(result.current.isSaving).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_999);
    });
    expect(result.current.status).toBe("saved");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.status).toBe("pending");
  });

  it("flushes immediately with Ctrl+S and cancels the pending debounce", async () => {
    const onSave = vi.fn().mockResolvedValue("saved" satisfies AutoSaveResult);
    renderHook(() =>
      useAutoSave({
        enabled: true,
        hasPendingChanges: true,
        debounceMs: 2_000,
        onSave,
      })
    );
    const event = new KeyboardEvent("keydown", {
      key: "s",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    await act(async () => {
      window.dispatchEvent(event);
      await Promise.resolve();
    });

    expect(event.defaultPrevented).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("manual");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("keeps manual save available when automatic saving is disabled", async () => {
    const onSave = vi.fn().mockResolvedValue("saved" satisfies AutoSaveResult);
    const { result } = renderHook(() =>
      useAutoSave({
        enabled: true,
        automaticEnabled: false,
        hasPendingChanges: true,
        debounceMs: 2_000,
        onSave,
      })
    );

    expect(result.current.status).toBe("pending");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(onSave).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.flushNow();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("manual");
    expect(result.current.status).toBe("saved");
  });

  it("prevents the browser Save As shortcut even when the editor is clean", () => {
    const onSave = vi.fn().mockResolvedValue("noop" satisfies AutoSaveResult);
    renderHook(() =>
      useAutoSave({
        enabled: true,
        hasPendingChanges: false,
        onSave,
      })
    );
    const event = new KeyboardEvent("keydown", {
      key: "s",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      window.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("prevents the browser Save As shortcut when saving is blocked", () => {
    const onSave = vi.fn().mockResolvedValue("blocked" satisfies AutoSaveResult);
    renderHook(() =>
      useAutoSave({
        enabled: false,
        hasPendingChanges: false,
        onSave,
      })
    );
    const event = new KeyboardEvent("keydown", {
      key: "s",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      window.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("resumes pending autosave as soon as the browser comes back online", async () => {
    let online = false;
    vi.spyOn(window.navigator, "onLine", "get").mockImplementation(
      () => online
    );
    const onSave = vi.fn().mockResolvedValue("saved" satisfies AutoSaveResult);
    const { result, rerender } = renderHook(
      ({ hasPendingChanges }) =>
        useAutoSave({
          enabled: true,
          hasPendingChanges,
          onSave,
        }),
      { initialProps: { hasPendingChanges: true } }
    );

    expect(result.current.status).toBe("offline");
    online = true;

    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await Promise.resolve();
    });
    rerender({ hasPendingChanges: false });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("reconnect");
    expect(result.current.status).toBe("idle");
  });

  it("queues one debounced save when another flush is requested in flight", async () => {
    const firstSave = createDeferred<AutoSaveResult>();
    const onSave = vi
      .fn()
      .mockReturnValueOnce(firstSave.promise)
      .mockResolvedValueOnce("saved" satisfies AutoSaveResult);
    const { result } = renderHook(() =>
      useAutoSave({
        enabled: true,
        hasPendingChanges: true,
        debounceMs: 2_000,
        onSave,
      })
    );
    let firstFlushPromise!: Promise<void>;

    act(() => {
      firstFlushPromise = result.current.flushNow();
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(result.current.isSaving).toBe(true);

    await act(async () => {
      await result.current.flushNow();
      await result.current.flushNow();
    });
    expect(onSave).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstSave.resolve("saved");
      await firstFlushPromise;
    });
    expect(onSave).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_999);
    });
    expect(onSave).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls.map(([reason]) => reason)).toEqual([
      "manual",
      "debounce",
    ]);
  });

  it("retries errors after 2, 4 and 8 seconds, then stops", async () => {
    const onSave = vi.fn().mockResolvedValue("error" satisfies AutoSaveResult);
    const { result } = renderHook(() =>
      useAutoSave({
        enabled: true,
        hasPendingChanges: true,
        debounceMs: 2_000,
        retryDelayMs: 2_000,
        maxAutomaticRetries: 3,
        onSave,
      })
    );

    await act(async () => {
      await result.current.flushNow();
    });
    expect(result.current.status).toBe("error");
    expect(onSave.mock.calls.map(([reason]) => reason)).toEqual(["manual"]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_999);
    });
    expect(onSave).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(onSave).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_999);
    });
    expect(onSave).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(onSave).toHaveBeenCalledTimes(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_999);
    });
    expect(onSave).toHaveBeenCalledTimes(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(onSave).toHaveBeenCalledTimes(4);
    expect(onSave.mock.calls.map(([reason]) => reason)).toEqual([
      "manual",
      "retry",
      "retry",
      "retry",
    ]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(onSave).toHaveBeenCalledTimes(4);
  });

  it("marks blocked saves explicitly without retrying", async () => {
    const onSave = vi.fn().mockResolvedValue("blocked" satisfies AutoSaveResult);
    const { result } = renderHook(() =>
      useAutoSave({
        enabled: true,
        hasPendingChanges: true,
        retryDelayMs: 2_000,
        onSave,
      })
    );

    await act(async () => {
      await result.current.flushNow();
    });

    expect(result.current.status).toBe("blocked");
    expect(onSave).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("guards beforeunload while changes are pending or a save is running", async () => {
    const deferredSave = createDeferred<AutoSaveResult>();
    const onSave = vi.fn().mockReturnValue(deferredSave.promise);
    const { result, rerender } = renderHook(
      ({ hasPendingChanges }) =>
        useAutoSave({
          enabled: true,
          hasPendingChanges,
          onSave,
        }),
      {
        initialProps: { hasPendingChanges: true },
      }
    );

    const pendingEvent = new Event("beforeunload", {
      cancelable: true,
    });
    act(() => {
      window.dispatchEvent(pendingEvent);
    });
    expect(pendingEvent.defaultPrevented).toBe(true);

    let flushPromise!: Promise<void>;
    act(() => {
      flushPromise = result.current.flushNow();
    });
    rerender({ hasPendingChanges: false });

    const savingEvent = new Event("beforeunload", {
      cancelable: true,
    });
    act(() => {
      window.dispatchEvent(savingEvent);
    });
    expect(savingEvent.defaultPrevented).toBe(true);

    await act(async () => {
      deferredSave.resolve("saved");
      await flushPromise;
    });

    const cleanEvent = new Event("beforeunload", {
      cancelable: true,
    });
    act(() => {
      window.dispatchEvent(cleanEvent);
    });
    expect(cleanEvent.defaultPrevented).toBe(false);
  });

  it("cancels timers and removes shortcut and unload listeners on unmount", async () => {
    const onSave = vi.fn().mockResolvedValue("saved" satisfies AutoSaveResult);
    const { unmount } = renderHook(() =>
      useAutoSave({
        enabled: true,
        hasPendingChanges: true,
        debounceMs: 2_000,
        onSave,
      })
    );

    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(onSave).not.toHaveBeenCalled();

    const shortcutEvent = new KeyboardEvent("keydown", {
      key: "s",
      ctrlKey: true,
      cancelable: true,
    });
    const unloadEvent = new Event("beforeunload", {
      cancelable: true,
    });
    act(() => {
      window.dispatchEvent(shortcutEvent);
      window.dispatchEvent(unloadEvent);
    });

    expect(shortcutEvent.defaultPrevented).toBe(false);
    expect(unloadEvent.defaultPrevented).toBe(false);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not retry an in-flight save that fails after unmount", async () => {
    const deferredSave = createDeferred<AutoSaveResult>();
    const onSave = vi.fn().mockReturnValue(deferredSave.promise);
    const { result, unmount } = renderHook(() =>
      useAutoSave({
        enabled: true,
        hasPendingChanges: true,
        retryDelayMs: 2_000,
        onSave,
      })
    );
    let flushPromise!: Promise<void>;

    act(() => {
      flushPromise = result.current.flushNow();
    });
    expect(onSave).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      deferredSave.resolve("error");
      await flushPromise;
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("drops a queued save when the active save resolves after unmount", async () => {
    const deferredSave = createDeferred<AutoSaveResult>();
    const onSave = vi.fn().mockReturnValue(deferredSave.promise);
    const { result, unmount } = renderHook(() =>
      useAutoSave({
        enabled: true,
        hasPendingChanges: true,
        debounceMs: 2_000,
        onSave,
      })
    );
    let flushPromise!: Promise<void>;

    act(() => {
      flushPromise = result.current.flushNow();
    });
    await act(async () => {
      await result.current.flushNow();
    });
    expect(onSave).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      deferredSave.resolve("saved");
      await flushPromise;
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
