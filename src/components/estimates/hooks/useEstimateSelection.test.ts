import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useEstimateSelection } from "@/components/estimates/hooks/useEstimateSelection";

describe("useEstimateSelection", () => {
  it("supports select all and clear", () => {
    const { result } = renderHook(() =>
      useEstimateSelection({
        visibleLineIdList: ["line-1", "line-2"],
        isReadOnly: false,
        onApplyBulkMajoration: vi.fn().mockResolvedValue(undefined),
        onBulkDeleteLines: vi.fn().mockResolvedValue(undefined),
        onBulkMoveLines: vi.fn().mockResolvedValue(undefined),
        onBulkSetCategory: vi.fn().mockResolvedValue(undefined),
        onBulkSetLaborRole: vi.fn().mockResolvedValue(undefined),
      })
    );

    act(() => {
      result.current.toggleAllVisibleLines(true);
    });
    expect(result.current.selectedLineIdList).toEqual(["line-1", "line-2"]);
    expect(result.current.allVisibleSelected).toBe(true);

    act(() => {
      result.current.toggleAllVisibleLines(false);
    });
    expect(result.current.selectedLineIdList).toEqual([]);
    expect(result.current.hasSelectedLines).toBe(false);
  });

  it("calls bulk handlers with selected ids", async () => {
    const onApplyBulkMajoration = vi.fn().mockResolvedValue(undefined);
    const onBulkMoveLines = vi.fn().mockResolvedValue(undefined);
    const onBulkSetCategory = vi.fn().mockResolvedValue(undefined);
    const onBulkSetLaborRole = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useEstimateSelection({
        visibleLineIdList: ["line-1", "line-2"],
        isReadOnly: false,
        onApplyBulkMajoration,
        onBulkDeleteLines: vi.fn().mockResolvedValue(undefined),
        onBulkMoveLines,
        onBulkSetCategory,
        onBulkSetLaborRole,
      })
    );

    act(() => {
      result.current.handleLineSelectionInteraction({ id: "line-2", ctrlKey: true });
      result.current.setBulkMajorationPercent("120");
      result.current.setBulkMoveParentId("section-1");
      result.current.setBulkCategoryId("cat-1");
      result.current.setBulkLaborRoleId("role-1");
    });

    await act(async () => {
      await result.current.handleApplyBulkMajoration();
      await result.current.handleApplyBulkMove();
      await result.current.handleApplyBulkCategory();
      await result.current.handleApplyBulkLaborRole();
    });

    expect(onApplyBulkMajoration).toHaveBeenCalledWith(["line-2"], 1.2);
    expect(onBulkMoveLines).toHaveBeenCalledWith(["line-2"], "section-1");
    expect(onBulkSetCategory).toHaveBeenCalledWith(["line-2"], "cat-1");
    expect(onBulkSetLaborRole).toHaveBeenCalledWith(["line-2"], "role-1");
  });

  it("deletes selected lines after confirmation is handled by the caller", async () => {
    const onBulkDeleteLines = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useEstimateSelection({
        visibleLineIdList: ["line-1"],
        isReadOnly: false,
        onApplyBulkMajoration: vi.fn().mockResolvedValue(undefined),
        onBulkDeleteLines,
        onBulkMoveLines: vi.fn().mockResolvedValue(undefined),
        onBulkSetCategory: vi.fn().mockResolvedValue(undefined),
        onBulkSetLaborRole: vi.fn().mockResolvedValue(undefined),
      })
    );

    act(() => {
      result.current.handleLineSelectionInteraction({ id: "line-1", ctrlKey: true });
    });

    await act(async () => {
      await result.current.handleBulkDeleteSelection();
    });

    expect(onBulkDeleteLines).toHaveBeenCalledWith(["line-1"]);
  });
});
