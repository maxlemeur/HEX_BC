"use client";

import { useCallback, useMemo, useState } from "react";

import {
  computeCockpitSuggestions,
  type CockpitCommandPreference,
  type CockpitSuggestion,
  type ComputeCockpitSuggestionsInput,
} from "@/lib/cockpit/suggestions";

export type HubCockpitInput = Omit<ComputeCockpitSuggestionsInput, "preferences">;

// The hub's suggestions: the server's, or, while a read of the dossier is on screen (TI-722), the
// same computation over what the read brought. A pin or a hide is saved without rendering the page
// again, so the preferences of the last server render may predate it: the person's choices made
// since that render are kept over it, until the next render brings the preferences as saved.
export function useHubCockpitSuggestions({ serverSuggestions, fromRead, input, preferences }: {
  serverSuggestions: CockpitSuggestion[] | undefined;
  fromRead: boolean;
  // Memoized by the caller: a new object computes the suggestions again.
  input: HubCockpitInput;
  preferences: CockpitCommandPreference[] | undefined;
}) {
  const [chosen, setChosen] = useState<{ base: CockpitCommandPreference[] | undefined; byAction: Record<string, CockpitCommandPreference> }>({
    base: preferences, byAction: {},
  });
  const byAction = chosen.base === preferences ? chosen.byAction : null;
  const merged = useMemo(() => {
    if (byAction === null) return preferences ?? [];
    const entries = new Map((preferences ?? []).map((preference) => [preference.actionId, preference] as const));
    for (const preference of Object.values(byAction)) entries.set(preference.actionId, preference);
    return [...entries.values()];
  }, [byAction, preferences]);
  const suggestions = useMemo(
    () => fromRead ? computeCockpitSuggestions({ ...input, preferences: merged }) : serverSuggestions,
    [fromRead, input, merged, serverSuggestions],
  );
  const notePreference = useCallback((preference: CockpitCommandPreference) => {
    setChosen((prior) => ({
      base: preferences,
      byAction: { ...(prior.base === preferences ? prior.byAction : {}), [preference.actionId]: preference },
    }));
  }, [preferences]);
  return { suggestions, notePreference };
}
