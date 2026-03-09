import type { CockpitSuggestion } from "@/lib/cockpit/suggestions";

let state: CockpitSuggestion[] = [];
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function setCockpitSuggestions(suggestions: CockpitSuggestion[]) {
  state = suggestions;
  emit();
}

export function clearCockpitSuggestions() {
  state = [];
  emit();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): CockpitSuggestion[] {
  return state;
}

export function getServerSnapshot(): CockpitSuggestion[] {
  return [];
}

/** Reset internal state — only for tests. */
export function _resetForTest() {
  state = [];
  listeners.clear();
}
