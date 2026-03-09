"use client";

import { useCallback, useState } from "react";

import type { CockpitSuggestion } from "@/lib/cockpit/suggestions";

const STORAGE_KEY_PREFIX = "cockpit-cmd-hidden-";
const MAX_VISIBLE = 3;

function readHiddenIds(projectId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${projectId}`);
    if (!raw) return new Set();
    const arr: string[] = JSON.parse(raw);
    return new Set(arr);
  } catch {
    return new Set();
  }
}

function writeHiddenIds(projectId: string, ids: Set<string>) {
  try {
    localStorage.setItem(
      `${STORAGE_KEY_PREFIX}${projectId}`,
      JSON.stringify([...ids]),
    );
  } catch {}
}

export function useCockpitCommandBar(
  suggestions: CockpitSuggestion[],
  projectId: string,
) {
  const [hiddenVersion, setHiddenVersion] = useState(0);
  const [previewSuggestion, setPreviewSuggestion] =
    useState<CockpitSuggestion | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  void hiddenVersion;
  const hiddenIds = readHiddenIds(projectId);

  const allVisible = suggestions.filter((s) => !hiddenIds.has(s.actionId));
  const filteredSuggestions = allVisible.slice(0, MAX_VISIBLE);
  const overflowSuggestions = allVisible.slice(MAX_VISIBLE);

  const execute = useCallback(
    (suggestion: CockpitSuggestion): CockpitSuggestion | null => {
      if (suggestion.requiresConfirmation) {
        setPreviewSuggestion(suggestion);
        return null;
      }
      return suggestion;
    },
    [],
  );

  const confirmPreview = useCallback((): CockpitSuggestion | null => {
    const s = previewSuggestion;
    setPreviewSuggestion(null);
    return s;
  }, [previewSuggestion]);

  const cancelPreview = useCallback(() => {
    setPreviewSuggestion(null);
  }, []);

  const hideAction = useCallback(
    (actionId: string) => {
      const next = new Set(readHiddenIds(projectId));
      next.add(actionId);
      writeHiddenIds(projectId, next);
      setHiddenVersion((prev) => prev + 1);
    },
    [projectId],
  );

  const showAction = useCallback(
    (actionId: string) => {
      const next = new Set(readHiddenIds(projectId));
      if (!next.has(actionId)) {
        return;
      }
      next.delete(actionId);
      writeHiddenIds(projectId, next);
      setHiddenVersion((prev) => prev + 1);
    },
    [projectId],
  );

  const resetHidden = useCallback(() => {
    try {
      localStorage.removeItem(`${STORAGE_KEY_PREFIX}${projectId}`);
    } catch {}
    setHiddenVersion((prev) => prev + 1);
  }, [projectId]);

  return {
    filteredSuggestions,
    overflowSuggestions,
    previewSuggestion,
    activeIndex,
    setActiveIndex,
    execute,
    confirmPreview,
    cancelPreview,
    hideAction,
    showAction,
    resetHidden,
  };
}
