import { act, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { useEstimateKeyboardShortcuts } from "@/components/estimates/hooks/useEstimateKeyboardShortcuts";

describe("useEstimateKeyboardShortcuts", () => {
  it("handles Ctrl+A to select all visible lines", () => {
    const selectAllVisibleLines = vi.fn();
    const tableCardRef = createRef<HTMLDivElement>();
    tableCardRef.current = document.createElement("div");
    document.body.appendChild(tableCardRef.current);

    renderHook(() =>
      useEstimateKeyboardShortcuts({
        tableCardRef,
        hasSelectedLines: false,
        visibleLineIdList: ["line-1", "line-2"],
        isReadOnly: false,
        isUndoRedoBusy: false,
        canUndo: false,
        canRedo: false,
        isSupplierComparisonMenuOpen: false,
        onResolveShortcutScope: () => ({
          canHandleAnyShortcut: true,
          canHandleSelectAllShortcut: true,
          canHandleBulkSelectionShortcut: true,
        }),
        selectAllVisibleLines,
        clearLineSelection: vi.fn(),
        onBulkDeleteSelection: vi.fn().mockResolvedValue(undefined),
        onCopySelectedRowsToClipboard: vi.fn().mockResolvedValue(undefined),
        onUndo: vi.fn().mockResolvedValue(undefined),
        onRedo: vi.fn().mockResolvedValue(undefined),
      })
    );

    act(() => {
      const event = new KeyboardEvent("keydown", {
        key: "a",
        ctrlKey: true,
        bubbles: true,
      });
      document.dispatchEvent(event);
    });

    expect(selectAllVisibleLines).toHaveBeenCalledWith(["line-1", "line-2"]);
    tableCardRef.current.remove();
  });

  it("handles Ctrl+A to select all visible lines when focus is on a checkbox", () => {
    const selectAllVisibleLines = vi.fn();
    const tableCardRef = createRef<HTMLDivElement>();
    tableCardRef.current = document.createElement("div");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    tableCardRef.current.appendChild(checkbox);
    document.body.appendChild(tableCardRef.current);

    renderHook(() =>
      useEstimateKeyboardShortcuts({
        tableCardRef,
        hasSelectedLines: false,
        visibleLineIdList: ["line-1", "line-2"],
        isReadOnly: false,
        isUndoRedoBusy: false,
        canUndo: false,
        canRedo: false,
        isSupplierComparisonMenuOpen: false,
        onResolveShortcutScope: () => ({
          canHandleAnyShortcut: true,
          canHandleSelectAllShortcut: true,
          canHandleBulkSelectionShortcut: true,
        }),
        selectAllVisibleLines,
        clearLineSelection: vi.fn(),
        onBulkDeleteSelection: vi.fn().mockResolvedValue(undefined),
        onCopySelectedRowsToClipboard: vi.fn().mockResolvedValue(undefined),
        onUndo: vi.fn().mockResolvedValue(undefined),
        onRedo: vi.fn().mockResolvedValue(undefined),
      })
    );

    act(() => {
      const event = new KeyboardEvent("keydown", {
        key: "a",
        ctrlKey: true,
        bubbles: true,
      });
      checkbox.dispatchEvent(event);
    });

    expect(selectAllVisibleLines).toHaveBeenCalledWith(["line-1", "line-2"]);
    tableCardRef.current.remove();
  });

  it("handles Escape for bulk selection clear", () => {
    const clearLineSelection = vi.fn();
    const tableCardRef = createRef<HTMLDivElement>();
    tableCardRef.current = document.createElement("div");

    renderHook(() =>
      useEstimateKeyboardShortcuts({
        tableCardRef,
        hasSelectedLines: true,
        visibleLineIdList: ["line-1"],
        isReadOnly: false,
        isUndoRedoBusy: false,
        canUndo: false,
        canRedo: false,
        isSupplierComparisonMenuOpen: false,
        onResolveShortcutScope: () => ({
          canHandleAnyShortcut: true,
          canHandleSelectAllShortcut: true,
          canHandleBulkSelectionShortcut: true,
        }),
        selectAllVisibleLines: vi.fn(),
        clearLineSelection,
        onBulkDeleteSelection: vi.fn().mockResolvedValue(undefined),
        onCopySelectedRowsToClipboard: vi.fn().mockResolvedValue(undefined),
        onUndo: vi.fn().mockResolvedValue(undefined),
        onRedo: vi.fn().mockResolvedValue(undefined),
      })
    );

    act(() => {
      const event = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      });
      document.dispatchEvent(event);
    });

    expect(clearLineSelection).toHaveBeenCalledTimes(1);
  });
});
