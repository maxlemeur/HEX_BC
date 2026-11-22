import { describe, expect, it } from "vitest";

import { resolveEstimateRowShortcut } from "@/components/estimates/hooks/useEstimateKeyboardShortcuts";

const key = (value: string, modifiers: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>> = {}) => ({
  key: value,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...modifiers,
});

describe("resolveEstimateRowShortcut", () => {
  it("answers to ⌘ on a Mac as to Ctrl elsewhere", () => {
    for (const command of [{ metaKey: true }, { ctrlKey: true }]) {
      expect(resolveEstimateRowShortcut(key("Enter", command))).toBe("insertLine");
      expect(resolveEstimateRowShortcut(key("Enter", { ...command, shiftKey: true }))).toBe("insertSection");
      // Shift makes the browser report « D ».
      expect(resolveEstimateRowShortcut(key("D", { ...command, shiftKey: true }))).toBe("duplicateLine");
    }
  });

  it("moves a line with Alt+Shift+Up/Down (⌥⇧ on a Mac)", () => {
    expect(resolveEstimateRowShortcut(key("ArrowUp", { altKey: true, shiftKey: true }))).toBe("moveUp");
    expect(resolveEstimateRowShortcut(key("ArrowDown", { altKey: true, shiftKey: true }))).toBe("moveDown");
  });

  it("leaves the keys other editor commands own", () => {
    // Fill down, the cell list, Mission Control and range extension.
    expect(resolveEstimateRowShortcut(key("d", { metaKey: true }))).toBeNull();
    expect(resolveEstimateRowShortcut(key("ArrowDown", { altKey: true }))).toBeNull();
    expect(resolveEstimateRowShortcut(key("ArrowUp", { ctrlKey: true }))).toBeNull();
    expect(resolveEstimateRowShortcut(key("ArrowUp", { shiftKey: true }))).toBeNull();
    // Enter alone moves down a cell; an AltGr-like Ctrl+Alt+Enter is not a shortcut.
    expect(resolveEstimateRowShortcut(key("Enter"))).toBeNull();
    expect(resolveEstimateRowShortcut(key("Enter", { ctrlKey: true, altKey: true }))).toBeNull();
    expect(resolveEstimateRowShortcut(key("ArrowUp", { metaKey: true, altKey: true, shiftKey: true }))).toBeNull();
  });
});
