"use client";

import { useMemo, useState } from "react";

import type { CockpitSuggestion } from "@/lib/cockpit/suggestions";

const MAX_VISIBLE = 3;

export function useCockpitCommandBar(suggestions: CockpitSuggestion[]) {
  const [activeIndex, setActiveIndex] = useState(0);

  const visibleSuggestions = useMemo(
    () => suggestions.filter((suggestion) => !suggestion.isHidden),
    [suggestions],
  );

  const filteredSuggestions = visibleSuggestions.slice(0, MAX_VISIBLE);
  const overflowSuggestions = visibleSuggestions.slice(MAX_VISIBLE);

  return {
    filteredSuggestions,
    overflowSuggestions,
    activeIndex,
    setActiveIndex,
  };
}
