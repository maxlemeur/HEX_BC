"use client";

import { useEffect, useEffectEvent, type RefObject } from "react";

type ShortcutScopeInput = {
  withinTable: boolean;
  hasSelectedLines: boolean;
  isPageLevelTarget: boolean;
};

type ShortcutScopeResult = {
  canHandleAnyShortcut: boolean;
  canHandleSelectAllShortcut: boolean;
  canHandleBulkSelectionShortcut: boolean;
};

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

function isTextEditingTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }

  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }

  if (target instanceof HTMLInputElement) {
    const inputType = target.type.toLowerCase();
    return !NON_TEXT_INPUT_TYPES.has(inputType);
  }

  if (target instanceof HTMLElement && target.isContentEditable) {
    return true;
  }

  return Boolean(
    target.closest(
      "[contenteditable=''],[contenteditable='true'],[contenteditable='plaintext-only']"
    )
  );
}

type UseEstimateKeyboardShortcutsParams = {
  tableCardRef: RefObject<HTMLDivElement | null>;
  hasSelectedLines: boolean;
  visibleLineIdList: string[];
  isReadOnly: boolean;
  isUndoRedoBusy: boolean;
  canUndo: boolean;
  canRedo: boolean;
  isSupplierComparisonMenuOpen: boolean;
  onResolveShortcutScope: (input: ShortcutScopeInput) => ShortcutScopeResult;
  selectAllVisibleLines: (ids: readonly string[]) => void;
  clearLineSelection: () => void;
  onBulkDeleteSelection: () => Promise<void>;
  onCopySelectedRowsToClipboard: () => Promise<void>;
  onUndo: () => Promise<void>;
  onRedo: () => Promise<void>;
  onOpenAssemblyPicker?: () => void;
};

export function useEstimateKeyboardShortcuts({
  tableCardRef,
  hasSelectedLines,
  visibleLineIdList,
  isReadOnly,
  isUndoRedoBusy,
  canUndo,
  canRedo,
  isSupplierComparisonMenuOpen,
  onResolveShortcutScope,
  selectAllVisibleLines,
  clearLineSelection,
  onBulkDeleteSelection,
  onCopySelectedRowsToClipboard,
  onUndo,
  onRedo,
  onOpenAssemblyPicker,
}: UseEstimateKeyboardShortcutsParams) {
  // An Effect Event runs the handlers of the last committed render. The listener used to be registered
  // again by a passive effect after every render (the editor passes an inline `onOpenAssemblyPicker`):
  // after lines shown outside a discrete event, such as a server answer, Ctrl+A selected the previous
  // lines and Ctrl+C copied them as they were until that effect ran.
  const handleKeyDown = useEffectEvent((event: globalThis.KeyboardEvent) => {
    const target = event.target;
    const withinTable =
      tableCardRef.current && target instanceof Node
        ? tableCardRef.current.contains(target)
        : false;
    const isPageLevelTarget =
      target === document.body || target === document.documentElement;
    const shortcutScope = onResolveShortcutScope({
      withinTable,
      hasSelectedLines,
      isPageLevelTarget,
    });

    if (!shortcutScope.canHandleAnyShortcut) {
      return;
    }

    if (
      (event.ctrlKey || event.metaKey) &&
      !event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === "a"
    ) {
      if (
        !shortcutScope.canHandleSelectAllShortcut ||
        isTextEditingTarget(target) ||
        visibleLineIdList.length === 0 ||
        isReadOnly
      ) {
        return;
      }
      event.preventDefault();
      selectAllVisibleLines(visibleLineIdList);
      return;
    }

    if (event.key === "Escape") {
      if (
        isTextEditingTarget(target) ||
        !shortcutScope.canHandleBulkSelectionShortcut ||
        isSupplierComparisonMenuOpen
      ) {
        return;
      }
      event.preventDefault();
      clearLineSelection();
      return;
    }

    if (event.key === "Delete") {
      if (
        event.repeat ||
        isReadOnly ||
        !shortcutScope.canHandleBulkSelectionShortcut ||
        isTextEditingTarget(target)
      ) {
        return;
      }
      event.preventDefault();
      void onBulkDeleteSelection();
      return;
    }

    if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      event.key.toLowerCase() === "c"
    ) {
      if (
        isTextEditingTarget(target) ||
        isUndoRedoBusy ||
        !shortcutScope.canHandleBulkSelectionShortcut ||
        !hasSelectedLines
      ) {
        return;
      }
      event.preventDefault();
      void onCopySelectedRowsToClipboard();
      return;
    }

    if (
      (event.ctrlKey || event.metaKey) &&
      !event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === "z"
    ) {
      if (
        isTextEditingTarget(target) ||
        !shortcutScope.canHandleSelectAllShortcut ||
        isUndoRedoBusy ||
        !canUndo
      ) {
        return;
      }
      event.preventDefault();
      void onUndo();
      return;
    }

    if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      ((event.shiftKey && event.key.toLowerCase() === "z") ||
        (!event.shiftKey && event.key.toLowerCase() === "y"))
    ) {
      if (
        isTextEditingTarget(target) ||
        !shortcutScope.canHandleSelectAllShortcut ||
        isUndoRedoBusy ||
        !canRedo
      ) {
        return;
      }
      event.preventDefault();
      void onRedo();
      return;
    }

    if (
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === "a"
    ) {
      if (isTextEditingTarget(target) || isReadOnly) {
        return;
      }
      event.preventDefault();
      onOpenAssemblyPicker?.();
      return;
    }
  });

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => handleKeyDown(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

export type UseEstimateKeyboardShortcutsResult = ReturnType<
  typeof useEstimateKeyboardShortcuts
>;
