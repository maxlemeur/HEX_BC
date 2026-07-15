import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resolveEstimateEditorAutoOpenDialogs,
  useEstimateEditorAiImportCoordinator,
} from "@/hooks/useEstimateEditorAiImportCoordinator";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

type RefreshResult = {
  itemIds: string[];
  updatedAt: string;
};

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    routeVersionId: "version-a",
    autoOpenVersionZero: false,
    autoOpenStructureDraft: false,
    ensureGroupedActionCanProceed: vi.fn().mockResolvedValue(true),
    openGeneratedOuvrageDialog: vi.fn(() => true),
    openVersionZeroDialog: vi.fn(() => true),
    dismissAiDialogs: vi.fn(),
    openImportFromEstimateDialog: vi.fn(() => true),
    closeImportFromEstimateDialog: vi.fn(),
    openEstimateStructureDraftDialog: vi.fn(() => true),
    closeEstimateStructureDraftDialog: vi.fn(),
    clearImportSummary: vi.fn(),
    refreshAfterAiMutation: vi.fn<
      (versionId: string) => Promise<RefreshResult>
    >(),
    applyAiMutationRefresh: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("resolveEstimateEditorAutoOpenDialogs", () => {
  it("gives version zero priority when both deep links are present", () => {
    expect(
      resolveEstimateEditorAutoOpenDialogs({
        autoOpenVersionZero: true,
        autoOpenStructureDraft: true,
      })
    ).toEqual({
      autoOpenVersionZero: true,
      autoOpenStructureDraft: false,
    });
  });
});

describe("useEstimateEditorAiImportCoordinator dialog exclusivity", () => {
  it.each([
    ["generated ouvrage", "openGeneratedOuvrageDialog"],
    ["version zero", "openVersionZeroDialog"],
  ] as const)(
    "only dismisses import UI after a successful %s open",
    async (_label, actionName) => {
      const refusedInput = createInput({
        [actionName]: vi.fn(() => false),
      });
      const refused = renderHook(() =>
        useEstimateEditorAiImportCoordinator(refusedInput)
      );

      await act(async () => {
        await refused.result.current.actions[actionName]();
      });

      expect(refusedInput.closeImportFromEstimateDialog).not.toHaveBeenCalled();
      expect(
        refusedInput.closeEstimateStructureDraftDialog
      ).not.toHaveBeenCalled();
      expect(refusedInput.clearImportSummary).not.toHaveBeenCalled();
      refused.unmount();

      const openedInput = createInput();
      const opened = renderHook(() =>
        useEstimateEditorAiImportCoordinator(openedInput)
      );

      await act(async () => {
        await opened.result.current.actions[actionName]();
      });

      expect(openedInput.closeImportFromEstimateDialog).toHaveBeenCalledTimes(1);
      expect(
        openedInput.closeEstimateStructureDraftDialog
      ).toHaveBeenCalledTimes(1);
      expect(openedInput.clearImportSummary).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    ["estimate", "openImportFromEstimateDialog"],
    ["structure", "openEstimateStructureDraftDialog"],
  ] as const)(
    "only dismisses AI dialogs after a successful %s import open",
    (_label, actionName) => {
      const refusedInput = createInput({
        [actionName]: vi.fn(() => false),
      });
      const refused = renderHook(() =>
        useEstimateEditorAiImportCoordinator(refusedInput)
      );

      act(() => {
        refused.result.current.actions[actionName]();
      });
      expect(refusedInput.dismissAiDialogs).not.toHaveBeenCalled();
      refused.unmount();

      const openedInput = createInput();
      const opened = renderHook(() =>
        useEstimateEditorAiImportCoordinator(openedInput)
      );

      act(() => {
        opened.result.current.actions[actionName]();
      });
      expect(openedInput.dismissAiDialogs).toHaveBeenCalledTimes(1);
    }
  );

  it("does not open an AI dialog when the autosave barrier fails", async () => {
    const input = createInput({
      ensureGroupedActionCanProceed: vi.fn().mockResolvedValue(false),
    });
    const { result } = renderHook(() =>
      useEstimateEditorAiImportCoordinator(input)
    );

    await act(async () => {
      await result.current.actions.openVersionZeroDialog();
    });

    expect(input.openVersionZeroDialog).not.toHaveBeenCalled();
    expect(input.clearImportSummary).not.toHaveBeenCalled();
  });
});

describe("useEstimateEditorAiImportCoordinator invalidation scope", () => {
  it("ignores a stale refresh after an A to B to A route cycle", async () => {
    const staleRefresh = createDeferred<RefreshResult>();
    const input = createInput({
      refreshAfterAiMutation: vi.fn(() => staleRefresh.promise),
    });
    const { result, rerender } = renderHook(
      (props) => useEstimateEditorAiImportCoordinator(props),
      { initialProps: input }
    );

    let stalePromise!: Promise<void>;
    act(() => {
      stalePromise = result.current.actions.invalidateAfterAiMutation({
        versionId: "version-a",
        source: "generated-ouvrage",
      });
    });

    rerender({ ...input, routeVersionId: "version-b" });
    rerender({ ...input, routeVersionId: "version-a" });

    await act(async () => {
      staleRefresh.resolve({
        itemIds: ["stale-item"],
        updatedAt: "2026-07-15T10:00:00.000Z",
      });
      await stalePromise;
    });

    expect(input.applyAiMutationRefresh).not.toHaveBeenCalled();
  });

  it("keeps only the latest refresh on the same route", async () => {
    const firstRefresh = createDeferred<RefreshResult>();
    const secondRefresh = createDeferred<RefreshResult>();
    const input = createInput({
      refreshAfterAiMutation: vi
        .fn()
        .mockReturnValueOnce(firstRefresh.promise)
        .mockReturnValueOnce(secondRefresh.promise),
    });
    const { result } = renderHook(() =>
      useEstimateEditorAiImportCoordinator(input)
    );

    let firstPromise!: Promise<void>;
    let secondPromise!: Promise<void>;
    act(() => {
      firstPromise = result.current.actions.invalidateAfterAiMutation({
        versionId: "version-a",
        source: "generated-ouvrage",
      });
      secondPromise = result.current.actions.invalidateAfterAiMutation({
        versionId: "version-a",
        source: "version-zero",
      });
    });

    const latest = {
      itemIds: ["latest-item"],
      updatedAt: "2026-07-15T10:00:02.000Z",
    };
    await act(async () => {
      secondRefresh.resolve(latest);
      await secondPromise;
    });
    await act(async () => {
      firstRefresh.resolve({
        itemIds: ["stale-item"],
        updatedAt: "2026-07-15T10:00:01.000Z",
      });
      await firstPromise;
    });

    expect(input.applyAiMutationRefresh).toHaveBeenCalledTimes(1);
    expect(input.applyAiMutationRefresh).toHaveBeenCalledWith(latest);
  });
});
