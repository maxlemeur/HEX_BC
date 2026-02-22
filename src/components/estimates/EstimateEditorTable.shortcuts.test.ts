import { describe, expect, it } from "vitest";

import { resolveEstimateTableShortcutScope } from "@/components/estimates/EstimateEditorTable";

describe("estimate editor table shortcut scope", () => {
  it("keeps select-all table-scoped while still handling table focus", () => {
    const scope = resolveEstimateTableShortcutScope({
      withinTable: true,
      hasSelectedLines: false,
      isPageLevelTarget: false,
    });

    expect(scope).toEqual({
      canHandleAnyShortcut: true,
      canHandleSelectAllShortcut: true,
      canHandleBulkSelectionShortcut: false,
    });
  });

  it("allows bulk shortcuts when selection exists and focus falls back to page target", () => {
    const scope = resolveEstimateTableShortcutScope({
      withinTable: false,
      hasSelectedLines: true,
      isPageLevelTarget: true,
    });

    expect(scope).toEqual({
      canHandleAnyShortcut: true,
      canHandleSelectAllShortcut: false,
      canHandleBulkSelectionShortcut: true,
    });
  });

  it("ignores shortcuts outside the table when no page-level bulk selection context exists", () => {
    const scope = resolveEstimateTableShortcutScope({
      withinTable: false,
      hasSelectedLines: true,
      isPageLevelTarget: false,
    });

    expect(scope).toEqual({
      canHandleAnyShortcut: false,
      canHandleSelectAllShortcut: false,
      canHandleBulkSelectionShortcut: false,
    });
  });
});
