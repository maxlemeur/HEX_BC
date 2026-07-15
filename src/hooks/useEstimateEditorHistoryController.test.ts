// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useEstimateEditorHistoryController } from "@/hooks/useEstimateEditorHistoryController";

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
});

describe("useEstimateEditorHistoryController", () => {
  it("pushes, undoes and redoes editor commands", async () => {
    const reportError = vi.fn();
    const undo = vi.fn().mockResolvedValue(undefined);
    const redo = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useEstimateEditorHistoryController({ scopeKey: "version-1", reportError })
    );

    act(() => {
      result.current.actions.push({ label: "patch-line", undo, redo });
    });
    expect(result.current.state).toMatchObject({
      canUndo: true,
      canRedo: false,
    });

    await act(async () => {
      await result.current.actions.undo();
    });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(result.current.state).toMatchObject({
      canUndo: false,
      canRedo: true,
    });

    await act(async () => {
      await result.current.actions.redo();
    });
    expect(redo).toHaveBeenCalledTimes(1);
    expect(result.current.state).toMatchObject({
      canUndo: true,
      canRedo: false,
    });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("reports a failed undo and keeps the command available", async () => {
    const reportError = vi.fn();
    const { result } = renderHook(() =>
      useEstimateEditorHistoryController({ scopeKey: "version-1", reportError })
    );

    act(() => {
      result.current.actions.push({
        undo: vi.fn().mockRejectedValue(new Error("undo failed")),
        redo: vi.fn().mockResolvedValue(undefined),
      });
    });

    await act(async () => {
      await result.current.actions.undo();
    });

    expect(reportError).toHaveBeenCalledWith(
      "Impossible d'annuler la derniere action."
    );
    expect(result.current.state.canUndo).toBe(true);
    expect(result.current.state.canRedo).toBe(false);
  });

  it("ignores duplicate history actions while one is executing", async () => {
    const deferred = createDeferred();
    const undo = vi.fn(() => deferred.promise);
    const { result } = renderHook(() =>
      useEstimateEditorHistoryController({
        scopeKey: "version-1",
        reportError: vi.fn(),
      })
    );

    act(() => {
      result.current.actions.push({
        undo,
        redo: vi.fn().mockResolvedValue(undefined),
      });
    });

    let firstUndo!: Promise<void>;
    act(() => {
      firstUndo = result.current.actions.undo();
    });
    await waitFor(() => {
      expect(result.current.state.isExecuting).toBe(true);
    });

    await act(async () => {
      await result.current.actions.undo();
    });
    expect(undo).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferred.resolve();
      await firstUndo;
    });
    expect(result.current.state.isExecuting).toBe(false);
  });

  it("invalidates the running command context when the version scope changes", async () => {
    const deferred = createDeferred();
    const lateWrite = vi.fn();
    const reportError = vi.fn();
    const { result, rerender } = renderHook(
      ({ scopeKey }: { scopeKey: string }) =>
        useEstimateEditorHistoryController({ scopeKey, reportError }),
      { initialProps: { scopeKey: "version-1" } }
    );

    act(() => {
      result.current.actions.push({
        undo: async (context) => {
          await deferred.promise;
          if (context?.isCurrentScope()) lateWrite();
        },
        redo: vi.fn().mockResolvedValue(undefined),
      });
    });

    let undoPromise!: Promise<void>;
    act(() => {
      undoPromise = result.current.actions.undo();
    });
    await waitFor(() => {
      expect(result.current.state.isExecuting).toBe(true);
    });

    rerender({ scopeKey: "version-2" });
    rerender({ scopeKey: "version-1" });
    await act(async () => {
      deferred.resolve();
      await undoPromise;
    });

    expect(lateWrite).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(result.current.state.canUndo).toBe(false);
      expect(result.current.state.canRedo).toBe(false);
    });
  });

  it("clears the history through the controller action", () => {
    const { result } = renderHook(() =>
      useEstimateEditorHistoryController({
        scopeKey: "version-1",
        reportError: vi.fn(),
      })
    );

    act(() => {
      result.current.actions.push({
        undo: vi.fn().mockResolvedValue(undefined),
        redo: vi.fn().mockResolvedValue(undefined),
      });
      result.current.actions.clear();
    });

    expect(result.current.state).toMatchObject({
      canUndo: false,
      canRedo: false,
      isExecuting: false,
    });
  });

  it("clears commands when the edited version changes", async () => {
    const { result, rerender } = renderHook(
      ({ scopeKey }: { scopeKey: string }) =>
        useEstimateEditorHistoryController({
          scopeKey,
          reportError: vi.fn(),
        }),
      { initialProps: { scopeKey: "version-1" } }
    );

    act(() => {
      result.current.actions.push({
        undo: vi.fn().mockResolvedValue(undefined),
        redo: vi.fn().mockResolvedValue(undefined),
      });
    });
    expect(result.current.state.canUndo).toBe(true);

    rerender({ scopeKey: "version-2" });

    await waitFor(() => {
      expect(result.current.state.canUndo).toBe(false);
      expect(result.current.state.canRedo).toBe(false);
    });
  });

  it("ignores a late command from the previous version scope", () => {
    const { result, rerender } = renderHook(
      ({ scopeKey }: { scopeKey: string }) =>
        useEstimateEditorHistoryController({
          scopeKey,
          reportError: vi.fn(),
        }),
      { initialProps: { scopeKey: "version-1" } }
    );
    const stalePush = result.current.actions.push;

    rerender({ scopeKey: "version-2" });
    act(() => {
      stalePush({
        undo: vi.fn().mockResolvedValue(undefined),
        redo: vi.fn().mockResolvedValue(undefined),
      });
    });

    expect(result.current.state.canUndo).toBe(false);
    expect(result.current.state.canRedo).toBe(false);
  });
});
