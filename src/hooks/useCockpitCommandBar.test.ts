import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";

import type { CockpitSuggestion } from "@/lib/cockpit/suggestions";

import { useCockpitCommandBar } from "./useCockpitCommandBar";

/* ------------------------------------------------------------------ */
/*  Mock localStorage                                                  */
/* ------------------------------------------------------------------ */

const storage: Record<string, string> = {};

Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => {
      storage[key] = value;
    },
    removeItem: (key: string) => {
      delete storage[key];
    },
  },
  writable: true,
});

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeSuggestion(
  overrides: Partial<CockpitSuggestion> = {},
): CockpitSuggestion {
  return {
    actionId: "action-1",
    label: "Label",
    intent: "analyze_plans",
    preview: "Preview text",
    target: { kind: "open_dialog", dialogId: "dlg-1" },
    requiresConfirmation: false,
    confirmTone: "info",
    ...overrides,
  };
}

function makeSuggestions(count: number): CockpitSuggestion[] {
  return Array.from({ length: count }, (_, i) =>
    makeSuggestion({
      actionId: `action-${i}`,
      label: `Label ${i}`,
    }),
  );
}

const PROJECT_ID = "proj-42";

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  for (const key of Object.keys(storage)) {
    delete storage[key];
  }
});

describe("useCockpitCommandBar", () => {
  it("returns filtered suggestions when none are hidden", () => {
    const suggestions = makeSuggestions(2);
    const { result } = renderHook(() =>
      useCockpitCommandBar(suggestions, PROJECT_ID),
    );

    expect(result.current.filteredSuggestions).toHaveLength(2);
    expect(result.current.overflowSuggestions).toHaveLength(0);
  });

  it("filters out hidden suggestions", () => {
    const suggestions = makeSuggestions(3);
    const { result } = renderHook(() =>
      useCockpitCommandBar(suggestions, PROJECT_ID),
    );

    act(() => {
      result.current.hideAction("action-1");
    });

    expect(result.current.filteredSuggestions).toHaveLength(2);
    expect(
      result.current.filteredSuggestions.find((s) => s.actionId === "action-1"),
    ).toBeUndefined();
  });

  it("limits visible to MAX_VISIBLE (3), rest in overflow", () => {
    const suggestions = makeSuggestions(5);
    const { result } = renderHook(() =>
      useCockpitCommandBar(suggestions, PROJECT_ID),
    );

    expect(result.current.filteredSuggestions).toHaveLength(3);
    expect(result.current.overflowSuggestions).toHaveLength(2);
  });

  it("execute() returns null and sets preview for requiresConfirmation suggestions", () => {
    const suggestion = makeSuggestion({
      actionId: "confirm-me",
      requiresConfirmation: true,
    });
    const { result } = renderHook(() =>
      useCockpitCommandBar([suggestion], PROJECT_ID),
    );

    let returned: CockpitSuggestion | null = null;
    act(() => {
      returned = result.current.execute(suggestion);
    });

    expect(returned).toBeNull();
    expect(result.current.previewSuggestion).toEqual(suggestion);
  });

  it("execute() returns the suggestion directly for non-confirmation", () => {
    const suggestion = makeSuggestion({
      actionId: "direct",
      requiresConfirmation: false,
    });
    const { result } = renderHook(() =>
      useCockpitCommandBar([suggestion], PROJECT_ID),
    );

    let returned: CockpitSuggestion | null = null;
    act(() => {
      returned = result.current.execute(suggestion);
    });

    expect(returned).toEqual(suggestion);
    expect(result.current.previewSuggestion).toBeNull();
  });

  it("confirmPreview() returns previewed suggestion and clears preview", () => {
    const suggestion = makeSuggestion({
      actionId: "confirm-me",
      requiresConfirmation: true,
    });
    const { result } = renderHook(() =>
      useCockpitCommandBar([suggestion], PROJECT_ID),
    );

    act(() => {
      result.current.execute(suggestion);
    });
    expect(result.current.previewSuggestion).toEqual(suggestion);

    let confirmed: CockpitSuggestion | null = null;
    act(() => {
      confirmed = result.current.confirmPreview();
    });

    expect(confirmed).toEqual(suggestion);
    expect(result.current.previewSuggestion).toBeNull();
  });

  it("cancelPreview() clears preview", () => {
    const suggestion = makeSuggestion({
      actionId: "confirm-me",
      requiresConfirmation: true,
    });
    const { result } = renderHook(() =>
      useCockpitCommandBar([suggestion], PROJECT_ID),
    );

    act(() => {
      result.current.execute(suggestion);
    });
    expect(result.current.previewSuggestion).toEqual(suggestion);

    act(() => {
      result.current.cancelPreview();
    });
    expect(result.current.previewSuggestion).toBeNull();
  });

  it("hideAction() adds to hiddenIds and persists to localStorage", () => {
    const suggestions = makeSuggestions(3);
    const { result } = renderHook(() =>
      useCockpitCommandBar(suggestions, PROJECT_ID),
    );

    act(() => {
      result.current.hideAction("action-0");
    });

    expect(result.current.filteredSuggestions).toHaveLength(2);
    expect(
      result.current.filteredSuggestions.find((s) => s.actionId === "action-0"),
    ).toBeUndefined();

    const stored = JSON.parse(
      storage[`cockpit-cmd-hidden-${PROJECT_ID}`] ?? "[]",
    );
    expect(stored).toContain("action-0");
  });

  it("resetHidden() clears all hidden and removes localStorage key", () => {
    const suggestions = makeSuggestions(3);
    const { result } = renderHook(() =>
      useCockpitCommandBar(suggestions, PROJECT_ID),
    );

    act(() => {
      result.current.hideAction("action-0");
      result.current.hideAction("action-1");
    });
    expect(result.current.filteredSuggestions).toHaveLength(1);

    act(() => {
      result.current.resetHidden();
    });

    expect(result.current.filteredSuggestions).toHaveLength(3);
    expect(storage[`cockpit-cmd-hidden-${PROJECT_ID}`]).toBeUndefined();
  });
});
