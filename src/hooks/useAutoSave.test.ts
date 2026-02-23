import { describe, expect, it } from "vitest";

import {
  isSaveShortcutKey,
  resolveAutoSaveStatusLabel,
  shouldBlockBeforeUnload,
} from "@/hooks/useAutoSave";

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
    expect(resolveAutoSaveStatusLabel("saving")).toBe("Sauvegarde en cours\u2026");
    expect(resolveAutoSaveStatusLabel("saved")).toBe("Sauvegardé");
    expect(resolveAutoSaveStatusLabel("idle")).toBe("Sauvegarde auto");
    expect(resolveAutoSaveStatusLabel("error")).toBe("Erreur de sauvegarde");
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
});
