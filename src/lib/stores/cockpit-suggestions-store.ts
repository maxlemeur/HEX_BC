import type { CockpitSuggestion } from "@/lib/cockpit/suggestions";

export type CockpitSuggestionsSnapshot = {
  projectId: string | null;
  suggestions: CockpitSuggestion[];
};

let state: CockpitSuggestionsSnapshot = {
  projectId: null,
  suggestions: [],
};
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function setCockpitSuggestions(snapshot: CockpitSuggestionsSnapshot) {
  state = snapshot;
  emit();
}

export function clearCockpitSuggestions() {
  state = {
    projectId: null,
    suggestions: [],
  };
  emit();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): CockpitSuggestionsSnapshot {
  return state;
}

export function getServerSnapshot(): CockpitSuggestionsSnapshot {
  return {
    projectId: null,
    suggestions: [],
  };
}

/** Reset internal state — only for tests. */
export function _resetForTest() {
  state = {
    projectId: null,
    suggestions: [],
  };
  listeners.clear();
}
