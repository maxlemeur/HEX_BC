import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { CockpitSuggestion } from "@/lib/cockpit/suggestions";

import { useCockpitCommandBar } from "./useCockpitCommandBar";

function makeSuggestion(
  overrides: Partial<CockpitSuggestion> = {},
): CockpitSuggestion {
  return {
    actionId: "action-1",
    label: "Label",
    intent: "analyze_plans",
    preview: "Preview text",
    target: { kind: "open_surface", surfaceId: "launch-metre" },
    requiresConfirmation: false,
    confirmTone: "info",
    priority: 100,
    isPinned: false,
    isHidden: false,
    ...overrides,
  };
}

function makeSuggestions(count: number): CockpitSuggestion[] {
  return Array.from({ length: count }, (_, index) =>
    makeSuggestion({
      actionId: `action-${index}`,
      label: `Label ${index}`,
    }),
  );
}

describe("useCockpitCommandBar", () => {
  it("returns visible suggestions when none are hidden", () => {
    const suggestions = makeSuggestions(2);
    const { result } = renderHook(() => useCockpitCommandBar(suggestions));

    expect(result.current.filteredSuggestions).toHaveLength(2);
    expect(result.current.overflowSuggestions).toHaveLength(0);
  });

  it("filters out hidden suggestions from visible lists", () => {
    const suggestions = makeSuggestions(3);
    suggestions[1] = {
      ...suggestions[1],
      isHidden: true,
    };

    const { result } = renderHook(() => useCockpitCommandBar(suggestions));

    expect(result.current.filteredSuggestions).toHaveLength(2);
    expect(
      result.current.filteredSuggestions.find((suggestion) => suggestion.actionId === "action-1"),
    ).toBeUndefined();
  });

  it("limits visible suggestions to 3 and keeps the rest in overflow", () => {
    const suggestions = makeSuggestions(5);
    const { result } = renderHook(() => useCockpitCommandBar(suggestions));

    expect(result.current.filteredSuggestions).toHaveLength(3);
    expect(result.current.overflowSuggestions).toHaveLength(2);
  });

  it("returns no visible suggestions when every action is hidden", () => {
    const suggestions = makeSuggestions(2).map((suggestion) => ({
      ...suggestion,
      isHidden: true,
    }));

    const { result } = renderHook(() => useCockpitCommandBar(suggestions));

    expect(result.current.filteredSuggestions).toHaveLength(0);
    expect(result.current.overflowSuggestions).toHaveLength(0);
  });
});
